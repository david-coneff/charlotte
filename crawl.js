#!/usr/bin/env node
/*
 * crawl.js — standalone, zero-dependency domain crawler (Node)
 *
 * The headless counterpart to web-crawler.html. Because it runs in Node it has
 * NO CORS constraint: it crawls any domain directly, from anywhere. It applies
 * the same rules as the HTML version —
 *
 *   * follows internal links (same domain) up to --max-pages / --max-depth
 *   * records, but never follows, first-tier external links
 *   * emits a self-contained report.html you can open in a browser
 *
 * RATE LIMITING (all configurable):
 *   --concurrency N   how many requests in flight at once   (default 4)
 *   --delay MS        pause each worker between requests     (default 100)
 *   --rps N           global cap on requests/second (0 = off, default 0)
 *
 * ALLOWLIST (suppress known-broken links in future reports):
 *   --allowlist FILE  links matching these patterns are moved out of "Errors"
 *                     into a separate suppressed list      (default crawl-allowlist.txt)
 *   --suggest FILE    each run writes the broken links NOT already allowlisted
 *                     here, in ready-to-edit allowlist format
 *                                                          (default crawl-allowlist.suggested.txt)
 *   Workflow: run -> open the suggested file -> delete lines you still want to
 *   see flagged -> append the rest to your allowlist -> they won't come up again.
 *   Patterns support '*' wildcards; '#' starts a comment; blank lines ignored.
 *
 * Usage:
 *   node crawl.js https://example.com/
 *   node crawl.js https://example.com/ --max-pages 500 --rps 5 --check-external
 *   node crawl.js https://example.com/ --allowlist my-allow.txt --out site.html
 */
"use strict";
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { URL } = require("url");
const { writeOutputs, buildIndexReport, writeCombinedJson } = require("./report.js");

const MAX_REDIRECTS = 5;
const MAX_BYTES = 5 * 1024 * 1024; // cap page size we read into memory
// A current desktop-Chrome User-Agent. Some sites serve a 403/blank to unknown
// clients but a normal page to a real browser; --browser sends this honest
// browser identity (no spoofed cookies/JS) so legitimate link verification
// isn't tripped by naive UA filtering. Not an evasion of deliberate blocking.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// Memory backstops for large crawls — bound per-link and per-report growth so
// RAM scales with distinct-URL count, not with how interlinked the site is.
const TITLE_CAP = 300;             // max title chars retained per page

// ----------------------------- CLI parsing -----------------------------
function parseArgs(argv) {
  const cfg = {
    startUrl: null,
    startUrls: [],       // one or more sites, crawled sequentially with these settings
    maxPages: 200,
    maxDepth: 3,
    scope: "domain",     // "domain" = whole host, "path" = under start URL's path
    pathPrefix: "",      // explicit path prefix to confine the crawl to
    concurrency: 4,
    delay: 100,
    rps: 0,
    timeout: 20000,
    recheck: true,                   // after the crawl, re-test failed links once (transient timeouts)
    scanDocs: true,                  // open PDFs/Office docs and check the links inside them
    maxDocBytes: 25 * 1024 * 1024,   // don't download a document larger than this to scan
    maxRetries: 5,                   // re-tries for a rate-limited (429/503) page before giving up
    maxBackoff: 300,                 // cap (seconds) on the auto-backoff window
    crawlDelay: 0,                   // manual crawl-delay (s); 0 = use robots.txt
    ignoreRobots: false,             // skip robots.txt entirely
    maxUrls: 0,                      // hard cap on distinct internal URLs tracked (0 = derive from maxPages)
    maxReferrers: 0,                 // cap on distinct referrers kept per link (0 = unlimited)
    seen: "memory",                  // dedup backend: memory | compact | disk
    seenFile: "crawl-seen.idx",      // backing file for --seen disk
    checkpoint: 25,                  // rewrite report/JSON every N pages (0 = off)
    log: "crawl-progress.log",       // live append-only progress log ("" = off)
    logMaxBytes: 5 * 1024 * 1024,    // roll to a new log part at this size (0 = single file)
    stopFile: "",                    // if this file appears, stop gracefully (GUI Stop button)
    pauseFile: "",                   // while this file exists, pause crawling (GUI Pause button)
    includeSubdomains: false,
    checkExternal: false,
    browser: false,                  // send a desktop-browser UA + Accept headers
    userAgent: "charlotte-crawler/1.0 (+local)",
    userAgentSet: false,             // did --user-agent override the default?
    allowlist: "crawl-allowlist.txt",
    suggest: "crawl-allowlist.suggested.txt",
    out: "crawl-report.html",
    json: "",
    state: "",                       // resume journal path ("" = off); --state FILE to enable
    resume: "",                      // replay this journal, then continue ("" = fresh crawl)
  };
  const num = (v, name) => { const n = Number(v); if (!Number.isFinite(n)) die("Invalid number for " + name + ": " + v); return n; };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const arg = a[i];
    const next = () => { const v = a[++i]; if (v === undefined) die("Missing value for " + arg); return v; };
    switch (arg) {
      case "-h": case "--help": printHelp(); process.exit(0); break;
      case "--max-pages": {
        const pv = next();
        if (/^(none|unlimited|all|inf|infinity)$/i.test(pv) || Number(pv) < 0) cfg.maxPages = Infinity;
        else cfg.maxPages = Math.max(1, num(pv, arg));
        break;
      }
      case "--max-urls": cfg.maxUrls = Math.max(0, num(next(), arg)); break;
      case "--max-referrers": cfg.maxReferrers = Math.max(0, num(next(), arg)); break;
      case "--seen": {
        const sv = next().toLowerCase();
        if (sv !== "memory" && sv !== "compact" && sv !== "disk") die("--seen must be memory, compact, or disk");
        cfg.seen = sv;
        break;
      }
      case "--seen-file": cfg.seenFile = next(); break;
      case "--checkpoint": cfg.checkpoint = Math.max(0, num(next(), arg)); break;
      case "--log": cfg.log = next(); break;
      case "--no-log": cfg.log = ""; break;
      case "--log-max-bytes": cfg.logMaxBytes = Math.max(0, num(next(), arg)); break;
      case "--stop-file": cfg.stopFile = next(); break;
      case "--pause-file": cfg.pauseFile = next(); break;
      case "--max-depth": {
        const dv = next();
        if (/^(none|unlimited|all|inf|infinity)$/i.test(dv) || Number(dv) < 0) cfg.maxDepth = Infinity;
        else cfg.maxDepth = Math.max(0, num(dv, arg));
        break;
      }
      case "--scope": {
        const sv = next().toLowerCase();
        if (sv !== "domain" && sv !== "path") die("--scope must be 'domain' or 'path'");
        cfg.scope = sv;
        break;
      }
      case "--path-prefix": cfg.pathPrefix = next(); cfg.scope = "path"; break;
      case "--concurrency": cfg.concurrency = Math.max(1, Math.min(32, num(next(), arg))); break;
      case "--delay": cfg.delay = Math.max(0, num(next(), arg)); break;
      case "--rps": cfg.rps = Math.max(0, num(next(), arg)); break;
      case "--timeout": cfg.timeout = Math.max(1000, num(next(), arg)); break;
      case "--max-retries": cfg.maxRetries = Math.max(0, num(next(), arg)); break;
      case "--max-backoff": cfg.maxBackoff = Math.max(1, num(next(), arg)); break;
      case "--crawl-delay": cfg.crawlDelay = Math.max(0, num(next(), arg)); break;
      case "--ignore-robots": cfg.ignoreRobots = true; break;
      case "--recheck": cfg.recheck = true; break;
      case "--no-recheck": cfg.recheck = false; break;
      case "--scan-docs": cfg.scanDocs = true; break;
      case "--no-scan-docs": cfg.scanDocs = false; break;
      case "--max-doc-bytes": cfg.maxDocBytes = Math.max(0, num(next(), arg)); break;
      case "--include-subdomains": cfg.includeSubdomains = true; break;
      case "--check-external": cfg.checkExternal = true; break;
      case "--browser": cfg.browser = true; break;
      case "--user-agent": cfg.userAgent = next(); cfg.userAgentSet = true; break;
      case "--allowlist": cfg.allowlist = next(); break;
      case "--suggest": cfg.suggest = next(); break;
      case "--out": cfg.out = next(); break;
      case "--json": cfg.json = next(); break;
      case "--state": cfg.state = next(); break;
      case "--resume": cfg.resume = next(); if (!cfg.state) cfg.state = cfg.resume; break;
      default:
        if (arg.startsWith("-")) die("Unknown option: " + arg);
        else cfg.startUrls.push(arg);
    }
  }
  if (!cfg.startUrls.length) die("Missing start URL.\n");
  for (const u of cfg.startUrls) { try { new URL(u); } catch { die("Invalid start URL: " + u); } }
  cfg.startUrl = cfg.startUrls[0];
  // --browser implies the desktop-Chrome UA unless the user set one explicitly.
  if (cfg.browser && !cfg.userAgentSet) cfg.userAgent = BROWSER_UA;
  return cfg;
}

function die(msg) { console.error("Error: " + msg); printHelp(); process.exit(1); }
function printHelp() {
  console.log(`
crawl.js — standalone domain crawler

  node crawl.js <start-url> [more-urls...] [options]

  Multiple start URLs are crawled sequentially with the same settings; the
  report at --out becomes an index linking to a per-site report for each.

Options:
  --max-pages N           Max pages to crawl, 'none' (or -1) = unlimited
                                                        (default 200)
  --max-urls N            Hard cap on distinct internal URLs remembered, a
                          memory backstop for big crawls (default: derived
                          from --max-pages; set explicitly when unlimited)
  --max-referrers N       Cap on distinct referrers kept per link; every
                          referrer of a broken link is reported (default 0 =
                          unlimited; set a cap to bound memory on huge sites)
  --seen MODE             Dedup backend: memory (RAM, exact, fastest),
                          compact (RAM, 64-bit hashes, fixed footprint),
                          disk (hash table in a file, lowest RAM, slowest)
                                                        (default memory)
  --seen-file FILE        Backing file for --seen disk  (default crawl-seen.idx)
  --max-depth N           Max internal link depth, 0 = start only,
                          'none' (or -1) = unlimited     (default 3)
  --checkpoint N          Rewrite report/JSON every N pages, 0 = off (default 25)
  --state FILE            Write an append-only resume journal (frontier + results)
  --resume FILE           Replay a journal, then continue WITHOUT re-crawling pages
                          already done (appends to the same FILE)
  --log FILE              Live append-only progress log  (default crawl-progress.log)
  --log-max-bytes N       Roll to a new log part at this size, 0 = single file
                                                        (default 5242880 = 5 MB)
  --no-log                Disable the progress log
  --stop-file FILE        If this file appears mid-crawl, stop gracefully and
                          write a partial report (used by the GUI Stop button)
  --pause-file FILE       While this file exists, pause crawling; delete it to
                          resume (used by the GUI Pause button)

Reconstruct a partitioned log into one composite stream:
  node crawl.js --merge-logs <manifest-or-log-base> [--out FILE]
  (writes to stdout, or to FILE with --out)
  --scope domain|path     Confine crawl to whole host, or to the start
                          URL's path subsection          (default domain)
  --path-prefix STR       Confine crawl to this path prefix, e.g. /docs
                          (implies --scope path)
  --concurrency N         Requests in flight at once     (default 4)
  --delay MS              Per-worker pause between reqs   (default 100)
  --rps N                 Global requests/sec cap, 0=off (default 0)
  --timeout MS            Per-request timeout            (default 20000)
  --max-retries N         Retries for a rate-limited (429/503) page before
                          giving up                      (default 5)
  --max-backoff N         Cap (seconds) on the auto-backoff window (default 300)
  --crawl-delay N         Min seconds between requests; overrides robots.txt
                          (default 0 = use robots.txt)
  --ignore-robots         Don't fetch/honor robots.txt crawl-delay
  --recheck / --no-recheck  Re-test failed links once after the crawl, to clear
                          transient timeouts; corrects the report (default on)
  --scan-docs / --no-scan-docs  Open PDFs and Office docs (docx/xlsx/pptx, and
                          best-effort for older .doc/.xls/.ppt) and check the
                          links inside them (default on)
  --max-doc-bytes N       Skip documents larger than this (default 26214400 = 25 MB)
  --include-subdomains    Treat subdomains as internal
  --check-external        Verify external links resolve (HEAD, then GET)
  --browser               Send a desktop-browser User-Agent + Accept-Language
                          headers, so sites that 403 unknown clients still
                          verify. Honest identity — not cookie/JS spoofing.
  --user-agent STR        Custom User-Agent header (overrides --browser)
  --allowlist FILE        Suppress matching broken links (default crawl-allowlist.txt)
  --suggest FILE          Write editable broken-link list (default crawl-allowlist.suggested.txt)
  --out FILE              Output report HTML             (default crawl-report.html)
  --json FILE             Also write raw JSON results
  -h, --help              Show this help
`);
}

// ----------------------------- helpers -----------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function normalize(u) {
  try {
    const x = new URL(u);
    x.hash = "";
    let s = x.href;
    if (s.endsWith("/") && x.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch { return u; }
}

function sameDomain(host, startHost, includeSub) {
  if (host === startHost) return true;
  if (includeSub) return host.endsWith("." + startHost) || startHost.endsWith("." + host);
  return false;
}

// Global rate limiter: spaces request start times by minGapMs regardless of
// concurrency (derived from --rps and/or robots crawl-delay). Returns an async
// acquire() each request awaits before firing.
function makeRateLimiter(minGapMs) {
  if (!minGapMs || minGapMs <= 0) return async () => {};
  let next = 0;
  return async function acquire() {
    const now = Date.now();
    const slot = Math.max(now, next);
    next = slot + minGapMs;
    const wait = slot - now;
    if (wait > 0) await sleep(wait);
  };
}

// Parse a Retry-After header value into milliseconds (numeric seconds or HTTP date).
function parseRetryAfter(value, maxMs) {
  if (!value) return 0;
  const secs = Number(value);
  let ms;
  if (Number.isFinite(secs)) ms = secs * 1000;
  else { const t = Date.parse(value); ms = Number.isFinite(t) ? t - Date.now() : 0; }
  return Math.max(0, Math.min(ms, maxMs));
}

// Adaptive backoff controller. On a 429/503 it opens a backoff window (honoring
// Retry-After, else exponential 5s,10s,20s… capped at --max-backoff). Workers
// wait out the window via gate(), then auto-resume. Success slowly relaxes it.
function makeThrottle(maxBackoffMs) {
  const BASE = 5000;
  let backoffUntil = 0, streak = 0;
  return {
    async gate() {
      // Loop because the window may be extended by other workers while we wait.
      for (;;) {
        const wait = backoffUntil - Date.now();
        if (wait <= 0) return;
        await sleep(Math.min(wait, 2000));
      }
    },
    noteThrottle(retryMs) {
      streak++;
      let wait = retryMs > 0 ? retryMs : Math.min(maxBackoffMs, BASE * Math.pow(2, streak - 1));
      wait = Math.round(wait * (0.85 + 0.3 * Math.random())); // jitter to avoid lockstep
      backoffUntil = Math.max(backoffUntil, Date.now() + wait);
      return wait;
    },
    noteSuccess() { if (streak > 0) streak--; },
    activeMs() { return Math.max(0, backoffUntil - Date.now()); },
    get streak() { return streak; },
  };
}

// Fetch robots.txt for the start origin and return its crawl-delay (seconds, 0
// if none) for our User-Agent, falling back to the '*' group.
async function fetchCrawlDelay(cfg) {
  try {
    const u = new URL(cfg.startUrl);
    const r = await request(`${u.protocol}//${u.host}/robots.txt`, "GET", cfg);
    if (!r.html || r.status >= 400) return 0;
    return parseCrawlDelay(r.html, cfg.userAgent);
  } catch { return 0; }
}

function parseCrawlDelay(txt, ua) {
  const uaLower = (ua || "").toLowerCase();
  const groups = [];
  let cur = null, lastWasAgent = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (field === "user-agent") {
      if (!lastWasAgent || !cur) { cur = { agents: [], delay: null }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      if (cur && field === "crawl-delay") { const d = parseFloat(value); if (!Number.isNaN(d)) cur.delay = d; }
      lastWasAgent = false;
    }
  }
  let starDelay = null, specificDelay = null;
  for (const g of groups) {
    if (g.delay == null) continue;
    for (const a of g.agents) {
      if (a === "*") starDelay = g.delay;
      else if (uaLower && uaLower.indexOf(a) >= 0) specificDelay = g.delay;
    }
  }
  return specificDelay != null ? specificDelay : (starDelay != null ? starDelay : 0);
}

// ----------------------------- allowlist -----------------------------
function loadAllowlist(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return null;
      return t.split(/\s+#/)[0].trim(); // allow inline " # comment" but keep '#' inside URLs
    })
    .filter(Boolean);
}

function compileAllow(patterns) {
  return patterns.map((p) => {
    const re = "^" + p.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$";
    return new RegExp(re);
  });
}

// ----------------------------- partitioned progress log -----------------------------
// Writes the progress log as size-bounded parts (…​.part001.log, …​.part002.log).
// Each part starts with a "#META {json}" header so the set is self-describing,
// and a manifest (…​.manifest.json) indexes the parts in order. This keeps any
// single file small (bounded memory/disk per file) and lets --merge-logs
// reconstruct the full composite log even if a run was interrupted.
function makeLogWriter(cfg, meta) {
  if (!cfg.log) return { line() {}, finalize() {}, parts: [], manifestPath: "", singleFile: true };

  const dir = path.dirname(cfg.log);
  const ext = path.extname(cfg.log) || ".log";
  const stem = path.basename(cfg.log, ext);
  const maxBytes = cfg.logMaxBytes;
  const single = maxBytes <= 0;
  const manifestPath = single ? "" : path.join(dir, stem + ".manifest.json");
  const parts = [];
  const nowIso = () => new Date().toISOString();

  let idx = 0, curPath = null, curBytes = 0, curLines = 0;

  const partPath = (n) => single ? cfg.log : path.join(dir, stem + ".part" + String(n).padStart(3, "0") + ext);

  function writeManifest(complete) {
    if (single) return;
    if (parts.length) { parts[parts.length - 1].bytes = curBytes; parts[parts.length - 1].lines = curLines; }
    const m = { run: meta.run, startUrl: meta.startUrl, startedAt: meta.startedAt, base: stem, ext, maxBytes, parts, complete: !!complete, updatedAt: nowIso() };
    try { fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2)); } catch { /* ignore */ }
  }

  function roll() {
    if (parts.length) { parts[parts.length - 1].bytes = curBytes; parts[parts.length - 1].lines = curLines; }
    idx++;
    curPath = partPath(idx);
    curBytes = 0; curLines = 0;
    if (!single) {
      const header = "#META " + JSON.stringify({ run: meta.run, part: idx, base: stem, ext, startUrl: meta.startUrl, partStarted: nowIso() }) + "\n";
      try { fs.writeFileSync(curPath, header); } catch { /* ignore */ }
      curBytes += Buffer.byteLength(header);
    } else {
      try { fs.writeFileSync(curPath, ""); } catch { /* ignore */ }
    }
    parts.push({ part: idx, file: path.basename(curPath), started: nowIso(), bytes: curBytes, lines: 0 });
    writeManifest(false);
  }

  function line(s) {
    const buf = s + "\n";
    const len = Buffer.byteLength(buf);
    if (curPath === null) roll();
    else if (!single && curBytes + len > maxBytes) roll();
    try { fs.appendFileSync(curPath, buf); } catch { /* ignore */ }
    curBytes += len; curLines++;
  }

  return { line, finalize: writeManifest, parts, manifestPath, singleFile: single };
}

// ----------------------------- resume journal -----------------------------
// Append-only JSONL trail of discoveries (the frontier) and completions (results),
// written SYNCHRONOUSLY so an abrupt stop loses nothing already on disk. `--resume`
// replays it to rebuild the queue + results + seen-set and continue WITHOUT
// re-crawling anything already done. Enabled by `--state FILE` (and implied by
// `--resume FILE`, which appends to the same file). Event shapes (one JSON/line):
//   {t:"meta",v,run,startUrl,scope,depth,subs,startedAt}  once, on a fresh journal
//   {t:"v",u}                                              about to visit u (attempt)
//   {t:"p",u,s,d,ti,in:[..],ex:[[u,host]..],oo:[..]}       u crawled OK + its links
//   {t:"k",u,s,d,ct}                                       u recorded, non-HTML (skip)
//   {t:"e",u,r,k,src} / {t:"b",u,r,k,src}                  u errored / blocked-uncertain
function makeJournal(file) {
  if (!file) return { ev() {}, on: false };
  const ev = (obj) => { try { fs.appendFileSync(file, JSON.stringify(obj) + "\n"); } catch { /* ignore */ } };
  return { ev, on: true };
}

// Reconstruct a partitioned log into a single composite stream. Accepts the
// manifest path, the log base path, or a directory; falls back to scanning for
// parts (reading each part's #META header) if no manifest is present.
function mergeLogs(target, outFile) {
  let manifest = null, dir = ".", stem = "", ext = ".log";

  if (target && fs.existsSync(target) && fs.statSync(target).isFile() && target.endsWith(".json")) {
    manifest = JSON.parse(fs.readFileSync(target, "utf8"));
    dir = path.dirname(target);
    stem = manifest.base; ext = manifest.ext || ".log";
  } else {
    // Treat target as a log base path (or directory). Look for <stem>.manifest.json.
    const isDir = fs.existsSync(target) && fs.statSync(target).isDirectory();
    dir = isDir ? target : path.dirname(target);
    const baseGuess = isDir ? "" : path.basename(target, path.extname(target) || "");
    ext = isDir ? ".log" : (path.extname(target) || ".log");
    const mp = path.join(dir, (baseGuess || "crawl-progress") + ".manifest.json");
    if (fs.existsSync(mp)) { manifest = JSON.parse(fs.readFileSync(mp, "utf8")); stem = manifest.base; ext = manifest.ext || ".log"; }
    else stem = baseGuess;
  }

  let orderedFiles;
  if (manifest && Array.isArray(manifest.parts) && manifest.parts.length) {
    orderedFiles = manifest.parts.slice().sort((a, b) => a.part - b.part).map((p) => path.join(dir, p.file));
  } else {
    // No manifest: scan the directory for <stem>.partNNN<ext>, order by #META part number.
    const re = new RegExp("^" + stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.part(\\d+)" + ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
    const found = [];
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(re);
      if (m) found.push({ n: Number(m[1]), file: path.join(dir, f) });
    }
    found.sort((a, b) => a.n - b.n);
    orderedFiles = found.map((x) => x.file);
  }

  if (!orderedFiles.length) throw new Error("No log parts found for: " + target);

  const sink = outFile ? fs.createWriteStream(outFile) : process.stdout;
  const head = `# composite log reconstructed from ${orderedFiles.length} part(s)${manifest ? ` (run ${manifest.run}${manifest.complete ? "" : ", INCOMPLETE"})` : ""}\n`;
  sink.write(head);
  for (const file of orderedFiles) {
    const text = fs.readFileSync(file, "utf8");
    // Drop each part's #META header line; keep the rest verbatim, in order.
    const body = text.replace(/^#META [^\n]*\n?/, "");
    sink.write(body);
  }
  if (outFile) sink.end();
  return orderedFiles.length;
}

// ----------------------------- HTML parsing -----------------------------
// Decode the HTML entities that commonly appear in href attributes so URLs
// aren't kept malformed (e.g. ...?id=1&amp;y=2 -> ...?id=1&y=2).
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, ent) => {
    if (ent[0] === "#") {
      const code = (ent[1] === "x" || ent[1] === "X") ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : whole;
    }
    const map = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    return map[ent.toLowerCase()] || whole;
  });
}

function extractLinks(html, pageUrl) {
  const src = html.replace(/<!--[\s\S]*?-->/g, "");
  let base = pageUrl;
  const bm = src.match(/<base\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/i);
  if (bm) {
    const href = decodeEntities((bm[2] ?? bm[3] ?? bm[4] ?? "").trim());
    if (href) { try { base = new URL(href, pageUrl).href; } catch { /* ignore */ } }
  }
  const links = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/gi;
  let m;
  while ((m = re.exec(src))) {
    // Decode HTML entities in the href (e.g. &amp; -> &) so URLs aren't malformed.
    const raw = decodeEntities((m[2] ?? m[3] ?? m[4] ?? "").trim());
    if (!raw || raw.startsWith("#") || /^(javascript:|mailto:|tel:|data:)/i.test(raw)) continue;
    try { links.push(new URL(raw, base)); } catch { /* malformed href */ }
  }
  const tm = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = tm ? tm[1].replace(/\s+/g, " ").trim().slice(0, TITLE_CAP) : "";
  return { links, title };
}

// ----------------------------- document link extraction -----------------------------
// Classify a response as a document we can read links out of, by content-type or
// URL extension. Returns "pdf" | "ooxml" | "ole" | null.
function docTypeOf(ct, pathname) {
  const c = (ct || "").toLowerCase();
  const p = (pathname || "").toLowerCase();
  if (c.indexOf("pdf") >= 0 || /\.pdf(\?|$)/.test(p)) return "pdf";
  if (c.indexOf("openxmlformats") >= 0 || /\.(docx|xlsx|pptx)(\?|$)/.test(p)) return "ooxml";
  if (c.indexOf("msword") >= 0 || c.indexOf("ms-excel") >= 0 || c.indexOf("ms-powerpoint") >= 0 || c.indexOf("vnd.ms-") >= 0 || /\.(doc|xls|ppt)(\?|$)/.test(p)) return "ole";
  return null;
}

// Magic-byte sniff for when the server sends a generic content-type.
function sniffMagic(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "pdf";   // %PDF
  if (buf[0] === 0x50 && buf[1] === 0x4b) return "ooxml";                                       // PK (zip)
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return "ole";   // old Office
  return null;
}

// Minimal ZIP reader (central directory + stored/deflate), built on zlib — no
// dependency. Returns [{name, data}] for entries whose name passes `filter`.
function unzipEntries(buf, filter) {
  const out = [];
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lhOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (filter && !filter(name)) continue;
    if (lhOff + 30 > buf.length || buf.readUInt32LE(lhOff) !== 0x04034b50) continue;
    const lhNameLen = buf.readUInt16LE(lhOff + 26);
    const lhExtraLen = buf.readUInt16LE(lhOff + 28);
    const dataStart = lhOff + 30 + lhNameLen + lhExtraLen;
    const comp = buf.slice(dataStart, dataStart + compSize);
    try {
      out.push({ name, data: method === 0 ? comp : zlib.inflateRawSync(comp) });
    } catch { /* skip unreadable entry */ }
  }
  return out;
}

// Office (OOXML): external hyperlinks live in the *.rels parts as
// Target="http..." TargetMode="External".
function ooxmlLinks(buf) {
  const urls = [];
  for (const e of unzipEntries(buf, (n) => /\.rels$/i.test(n))) {
    const xml = e.data.toString("utf8");
    const re = /Target="([^"]+)"/g; let m;
    while ((m = re.exec(xml))) { if (/^https?:\/\//i.test(m[1])) urls.push(m[1].replace(/&amp;/g, "&")); }
  }
  return urls;
}

// PDF: clickable links are URI actions, stored as /URI(...) (often uncompressed).
function pdfLinks(buf) {
  const s = buf.toString("latin1");
  const urls = [];
  const re = /\/URI\s*\(((?:\\.|[^\\)])*)\)/g; let m;
  while ((m = re.exec(s))) urls.push(m[1].replace(/\\([()\\])/g, "$1"));
  return urls;
}

// Fallback for older binary Office (.doc/.xls/.ppt) and anything unknown: scan
// raw bytes for URLs, in both latin1 and UTF-16LE (old Office stores text as UTF-16).
function rawUrls(buf) {
  const urls = [];
  const re = /https?:\/\/[^\s"'<>)\]}\x00]{3,}/gi; let m;
  let s = buf.toString("latin1"); while ((m = re.exec(s))) urls.push(m[0]);
  re.lastIndex = 0;
  let s2 = buf.toString("utf16le"); while ((m = re.exec(s2))) urls.push(m[0]);
  return urls;
}

// Extract http(s) links found inside a document buffer, as URL objects.
function extractDocLinks(buf, docType, baseUrl) {
  let type = docType;
  if (!type || type === "sniff") type = sniffMagic(buf) || type;
  let raws;
  if (type === "ooxml") raws = ooxmlLinks(buf);
  else if (type === "pdf") raws = pdfLinks(buf);
  else raws = rawUrls(buf);
  const out = [], seen = new Set();
  for (const r of raws) {
    let s = String(r).trim().replace(/[).,;'">]+$/, "");   // trim trailing punctuation
    if (!s || /^(mailto:|tel:|javascript:)/i.test(s)) continue;
    try {
      const u = new URL(s, baseUrl);
      if ((u.protocol === "http:" || u.protocol === "https:") && !seen.has(u.href)) { seen.add(u.href); out.push(u); }
    } catch { /* malformed */ }
  }
  return out;
}

// ----------------------------- seen-set (dedup) backends -----------------------------
// A crawler must remember visited/queued URLs to avoid re-crawling. The default
// keeps the URL strings in RAM. For very large crawls, two lower-RAM backends
// store only a 64-bit hash per URL and trade speed (and a vanishingly small
// collision chance) for a bounded footprint:
//   compact — fixed-size open-addressing table of hashes in RAM
//   disk    — the same table in a file (RAM ~ O(1) + OS page cache), slowest
// Note: the progress logs can't serve as this index — they record only crawled
// pages, not the queued frontier, and scanning them per URL would be O(n^2).
function fnv1a64(str) {
  const prime = 0x100000001b3n, mask = 0xffffffffffffffffn;
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h = ((h ^ BigInt(c & 0xff)) * prime) & mask;
    if (c > 0xff) h = ((h ^ BigInt((c >> 8) & 0xff)) * prime) & mask;
  }
  return h === 0n ? 1n : h;  // reserve 0 as the empty-slot sentinel
}

// Returns a store with tryAdd(url) -> true if newly added (not seen before),
// false if already present OR the cap is reached. `size` is the live count.
function makeSeenStore(mode, maxItems, seenFile) {
  if (mode === "memory" || !Number.isFinite(maxItems)) {
    const s = new Set();
    return {
      mode: "memory",
      tryAdd(k) { if (s.has(k)) return false; if (s.size >= maxItems) return false; s.add(k); return true; },
      get size() { return s.size; },
      close() {},
    };
  }

  const slots = Math.max(1024, Math.ceil(maxItems / 0.7) + 1); // keep load factor < 0.7
  const slotsBig = BigInt(slots);
  let count = 0;

  if (mode === "disk") {
    const fd = fs.openSync(seenFile, "w+");
    fs.ftruncateSync(fd, slots * 8);   // preallocate; zero-filled = all empty
    const buf = Buffer.alloc(8);
    const read = (i) => { fs.readSync(fd, buf, 0, 8, i * 8); return buf.readBigUInt64BE(0); };
    const write = (i, h) => { buf.writeBigUInt64BE(h, 0); fs.writeSync(fd, buf, 0, 8, i * 8); };
    return {
      mode: "disk",
      tryAdd(k) {
        const h = fnv1a64(k); let i = Number(h % slotsBig);
        for (;;) {
          const v = read(i);
          if (v === 0n) { if (count >= maxItems) return false; write(i, h); count++; return true; }
          if (v === h) return false;
          i = (i + 1) % slots;
        }
      },
      get size() { return count; },
      close() { try { fs.closeSync(fd); fs.unlinkSync(seenFile); } catch { /* ignore */ } },
    };
  }

  // compact: in-RAM typed array of 64-bit hashes
  const table = new BigUint64Array(slots);
  return {
    mode: "compact",
    tryAdd(k) {
      const h = fnv1a64(k); let i = Number(h % slotsBig);
      for (;;) {
        const v = table[i];
        if (v === 0n) { if (count >= maxItems) return false; table[i] = h; count++; return true; }
        if (v === h) return false;
        i = (i + 1) % slots;
      }
    },
    get size() { return count; },
    close() {},
  };
}

// ----------------------------- fetching -----------------------------
// Request headers. With --browser we add the Accept/Accept-Language a desktop
// browser sends, alongside the browser UA — some servers gate on these too.
function requestHeaders(cfg) {
  if (cfg.browser) {
    return {
      "User-Agent": cfg.userAgent,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };
  }
  return { "User-Agent": cfg.userAgent, "Accept": "text/html,application/xhtml+xml,*/*" };
}

// Lightweight reachability check used for external/error links: just the status
// code, following redirects, without downloading a body. Resolves (never
// rejects) to {status, err}; status 0 means the request never got a response.
function rawStatus(target, method, cfg, redirects = 0) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(target); } catch { return resolve({ status: 0, err: "bad URL" }); }
    if (u.protocol !== "http:" && u.protocol !== "https:") return resolve({ status: 0, err: "unsupported protocol" });
    const lib = u.protocol === "https:" ? https : http;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = lib.request(u, { method, headers: requestHeaders(cfg) }, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && redirects < MAX_REDIRECTS) {
        res.resume();
        let nextUrl;
        try { nextUrl = new URL(res.headers.location, u).href; } catch { return finish({ status: 0, err: "bad redirect" }); }
        return finish(rawStatus(nextUrl, method, cfg, redirects + 1));
      }
      res.resume();              // drain so the socket can be reused/closed
      finish({ status: code, err: null });
    });
    req.setTimeout(cfg.timeout, () => req.destroy(new Error("timeout")));
    req.on("error", (e) => finish({ status: 0, err: String(e && e.message || e) }));
    req.end();
  });
}

// Probe a link the way a careful human would: try a cheap HEAD first, but many
// servers mishandle HEAD (405/501) or block bots at it while serving a real GET.
// So when HEAD looks bad, fall back to a GET before deciding. Body is discarded.
async function probe(target, cfg) {
  let { status, err } = await rawStatus(target, "HEAD", cfg);
  const headInconclusive = !!err || status === 0 || status === 400 || status === 403 ||
    status === 405 || status === 406 || status === 429 || status === 501 || status >= 500;
  if (headInconclusive) {
    const g = await rawStatus(target, "GET", cfg);
    if (g.status > 0) { status = g.status; err = g.err; }
    else if (status === 0) { err = g.err || err; }
  }
  return { status, err };
}

// Classify a probe result into ok / broken / blocked. "blocked" = the link very
// likely works in a browser but the server refused our automated check (auth,
// anti-bot, rate-limit, method/range quirks, timeouts) — reported separately so
// it isn't presented as a confirmed dead link.
function linkDisposition(status, err) {
  if (status >= 200 && status < 400) return "ok";
  if (status === 404 || status === 410) return "broken";
  if (status === 401 || status === 403 || status === 405 || status === 406 ||
      status === 408 || status === 409 || status === 429 || status === 451 ||
      status === 999 || (status >= 500 && status <= 599)) return "blocked";
  if (status === 0) return /timeout/i.test(err || "") ? "blocked" : "broken";
  if (status === 400) return "broken";
  return "broken";
}

function request(target, method, cfg, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(target); } catch { return reject(new Error("bad URL")); }
    if (u.protocol !== "http:" && u.protocol !== "https:") return reject(new Error("unsupported protocol"));
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, { method, headers: requestHeaders(cfg) }, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && redirects < MAX_REDIRECTS) {
        res.resume();
        let nextUrl;
        try { nextUrl = new URL(res.headers.location, u).href; } catch { return reject(new Error("bad redirect")); }
        return resolve(request(nextUrl, method, cfg, redirects + 1));
      }
      const ct = res.headers["content-type"] || "";
      const retryAfter = res.headers["retry-after"] || null;
      if (method === "HEAD") { res.resume(); return resolve({ status: code, contentType: ct, html: null, retryAfter }); }

      // Detect document type FIRST — note Office content-types contain "xml"
      // ("openxmlformats"), so the html/xml check must not claim them.
      const docType = docTypeOf(ct, u.pathname);
      const isHtml = !docType && ct && /html|xml|text\//i.test(ct);
      const knownDoc = (cfg.scanDocs && docType) ? docType : null;
      // Scan documents (known type, or a generic/octet-stream we'll sniff). Skip
      // obvious binaries (images/audio/video) without downloading them.
      const maybeDoc = cfg.scanDocs && !isHtml && !/^image\/|^video\/|^audio\//i.test(ct) &&
        (knownDoc || /octet-stream/i.test(ct) || ct === "");
      if (!isHtml && !maybeDoc) { res.resume(); return resolve({ status: code, contentType: ct, html: null, retryAfter }); }

      if (isHtml) {
        // Text: collect chunks and join once (avoids O(n^2) string growth).
        const chunks = [];
        let total = 0;
        res.setEncoding("utf8");
        res.on("data", (d) => { total += d.length; if (total > MAX_BYTES) { res.destroy(); return; } chunks.push(d); });
        res.on("end", () => resolve({ status: code, contentType: ct, html: chunks.join(""), retryAfter }));
        return;
      }

      // Document: download as binary (capped). If the type wasn't clear from the
      // headers, sniff the first chunk and bail on non-document binaries.
      const bufs = [];
      let total = 0, aborted = false;
      res.on("data", (d) => {
        if (aborted) return;
        if (!knownDoc && bufs.length === 0) {
          if (!sniffMagic(d)) { aborted = true; res.destroy(); resolve({ status: code, contentType: ct, html: null, retryAfter }); return; }
        }
        total += d.length;
        if (total > cfg.maxDocBytes) { aborted = true; res.destroy(); resolve({ status: code, contentType: ct, html: null, doc: Buffer.concat(bufs), docType: knownDoc, retryAfter }); return; }
        bufs.push(d);
      });
      res.on("end", () => { if (!aborted) resolve({ status: code, contentType: ct, html: null, doc: Buffer.concat(bufs), docType: knownDoc, retryAfter }); });
    });
    req.setTimeout(cfg.timeout, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

// ----------------------------- crawl -----------------------------
async function crawl(cfg, allow, sharedLogger, onProgress) {
  const startHost = new URL(cfg.startUrl).hostname;

  // Effective request spacing = the larger of --rps and the robots.txt (or
  // --crawl-delay) crawl-delay. Determined before the limiter is built.
  let crawlDelay = cfg.crawlDelay;
  let robotsDelay = 0;
  if (!cfg.crawlDelay && !cfg.ignoreRobots) { robotsDelay = await fetchCrawlDelay(cfg); crawlDelay = robotsDelay; }
  let minGapMs = 0;
  if (cfg.rps > 0) minGapMs = Math.max(minGapMs, 1000 / cfg.rps);
  if (crawlDelay > 0) minGapMs = Math.max(minGapMs, crawlDelay * 1000);
  const limiter = makeRateLimiter(minGapMs);
  const throttle = makeThrottle(cfg.maxBackoff * 1000);

  // Frontier cap: bound how many distinct internal URLs we remember, so memory
  // can't run away on a huge/unbounded crawl. Derived from --max-pages when
  // finite; otherwise use --max-urls (0 here means "no extra cap").
  const urlCap = cfg.maxUrls > 0 ? cfg.maxUrls : (cfg.maxPages === Infinity ? Infinity : cfg.maxPages * 50);

  // Resolve the crawl scope. Empty prefix => whole host. Otherwise only
  // same-host links whose path is at or under the prefix are followed.
  let pathPrefix = "";
  if (cfg.pathPrefix) pathPrefix = cfg.pathPrefix;
  else if (cfg.scope === "path") { try { pathPrefix = new URL(cfg.startUrl).pathname; } catch { /* ignore */ } }
  pathPrefix = pathPrefix.replace(/\/+$/, "");
  const inScope = (pathname) => !pathPrefix || pathname === pathPrefix || pathname.indexOf(pathPrefix + "/") === 0;

  // Pick the dedup backend. compact/disk need a finite cap to size their table;
  // if pages are unlimited and no --max-urls was given, default a bound.
  let storeCap = urlCap;
  if ((cfg.seen === "compact" || cfg.seen === "disk") && !Number.isFinite(storeCap)) {
    storeCap = 1000000;
    console.log(`Note: --seen ${cfg.seen} needs a bounded URL count; using ${storeCap.toLocaleString()}. Override with --max-urls.`);
  }
  const seen = makeSeenStore(cfg.seen, storeCap, cfg.seenFile);
  seen.tryAdd(normalize(cfg.startUrl));

  const state = {
    startHost,
    pathPrefix,
    queue: [{ url: cfg.startUrl, depth: 0, parent: "(start)" }],
    seen,
    pages: [],
    external: new Map(),
    outOfScope: new Map(),   // same domain, outside pathPrefix: recorded, never followed
    refs: new Map(),         // target URL -> Set of every distinct referrer page
    errors: [],
    blocked: [],             // links our automated check couldn't confirm (likely OK in a browser)
    retries: 0,
    crawlDelay,
    crawled: 0,
    startedAt: new Date().toISOString(),
    startedMs: Date.now(),
  };

  // Partitioned progress log — the durable trail: if the process is killed, the
  // parts already on disk show exactly where it left off. A shared logger may be
  // passed in (multi-site runs) so all sites append to one log.
  const runId = `${state.startedAt.replace(/[-:]/g, "").replace(/\..+/, "")}-${Math.random().toString(16).slice(2, 8)}`;
  const logger = sharedLogger || makeLogWriter(cfg, { run: runId, startUrl: cfg.startUrl, startedAt: state.startedAt });
  state.runId = runId;
  state.logParts = logger.parts;
  state.logManifest = logger.manifestPath;
  state.logSingleFile = logger.singleFile;

  // Resume journal (append-only; see makeJournal). On a fresh run write the meta
  // header; on --resume we append to the existing file (its meta is already there).
  const journal = makeJournal(cfg.state);
  const J = journal.ev;
  if (journal.on && !cfg.resume) J({ t: "meta", v: 1, run: runId, startUrl: cfg.startUrl, scope: pathPrefix || "", depth: cfg.maxDepth === Infinity ? null : cfg.maxDepth, subs: !!cfg.includeSubdomains, startedAt: state.startedAt });
  const logLine = (s) => logger.line(s);

  // Record that `ref` (a page) links to `target`. Every DISTINCT referrer is
  // kept (no dedup-to-first) so a broken link reports all pages that need fixing.
  // --max-referrers caps the set per target as a safety valve (0 = unlimited).
  function addRef(target, ref) {
    let s = state.refs.get(target);
    if (!s) { s = new Set(); state.refs.set(target, s); }
    if (cfg.maxReferrers <= 0 || s.size < cfg.maxReferrers) s.add(ref);
  }

  let interrupted = false;

  // ---- resume: replay the journal to rebuild the frontier + results, so we
  //      continue from where we stopped instead of starting over. Reuses the live
  //      addRef / seen.tryAdd so the reconstructed frontier + referrers match. ----
  if (cfg.resume) {
    const doneSet = new Set();            // URLs already terminally processed (skip these)
    const enq = new Map();                // url -> {depth, parent}: everything that entered the frontier
    const consider = (target, parentUrl, parentDepth) => {
      addRef(target, parentUrl);
      if (parentDepth < cfg.maxDepth && seen.tryAdd(target) && !enq.has(target)) enq.set(target, { depth: parentDepth + 1, parent: parentUrl });
    };
    let lines = [];
    try { lines = fs.readFileSync(cfg.resume, "utf8").split(/\r?\n/); } catch { /* no journal yet — resume behaves like a fresh crawl */ }
    let meta = null, replayed = 0;
    for (const ln of lines) {
      if (!ln) continue;
      let e; try { e = JSON.parse(ln); } catch { continue; }
      if (e.t === "meta") { if (!meta) meta = e; continue; }
      if (e.t !== "p" && e.t !== "k" && e.t !== "e" && e.t !== "b") continue;  // "v"/"r"/unknown: ignored here
      if (doneSet.has(e.u)) continue;     // idempotent: a URL completes at most once
      doneSet.add(e.u);
      replayed++;
      if (e.t === "p") {
        state.pages.push({ url: e.u, title: e.ti, status: e.s, depth: e.d, internal: (e.in || []).length, external: (e.ex || []).length });
        for (const t of (e.in || [])) consider(t, e.u, e.d);
        for (const pr of (e.ex || [])) { const u = pr[0]; if (!state.external.has(u)) state.external.set(u, { url: u, host: pr[1], status: null }); addRef(u, e.u); }
        for (const u of (e.oo || [])) { if (!state.outOfScope.has(u)) state.outOfScope.set(u, { url: u }); addRef(u, e.u); }
      } else if (e.t === "k") {
        state.pages.push({ url: e.u, title: "(non-HTML: " + (e.ct || "?") + ")", status: e.s, depth: e.d, internal: 0, external: 0 });
      } else if (e.t === "e") {
        state.errors.push({ url: e.u, reason: e.r, source: e.src, kind: e.k || "internal" });
      } else {
        state.blocked.push({ url: e.u, reason: e.r, source: e.src, kind: e.k || "internal" });
      }
    }
    if (meta && meta.startUrl && meta.startUrl !== cfg.startUrl) console.log(`Note: resume journal was for ${meta.startUrl}; now crawling ${cfg.startUrl}.`);
    // Frontier = everything that entered the queue but never completed.
    state.queue = [];
    for (const [u, info] of enq) { if (!doneSet.has(u)) state.queue.push({ url: u, depth: info.depth, parent: info.parent }); }
    // If the start URL was never reached (empty/partial journal), make sure it runs.
    const su = normalize(cfg.startUrl);
    if (!doneSet.has(su) && !enq.has(su)) state.queue.unshift({ url: su, depth: 0, parent: "(start)" });
    state.crawled = doneSet.size;
    J({ t: "r", at: new Date().toISOString() });   // mark this resume in the journal
    console.log(`Resumed from ${cfg.resume}: ${replayed} already done, ${state.queue.length} queued.`);
  }

  async function visit(job) {
    state.crawled++;
    J({ t: "v", u: job.url });
    await throttle.gate();   // wait out any active rate-limit backoff window
    await limiter();
    let r;
    try {
      r = await request(job.url, "GET", cfg);
    } catch (e) {
      const msg = String(e.message || e);
      if (linkDisposition(0, msg) === "blocked") {
        state.blocked.push({ url: job.url, reason: msg, source: job.parent, kind: "internal" });
        J({ t: "b", u: job.url, r: msg, k: "internal", src: job.parent });
        logLine(`${new Date().toISOString()} BLOCKED ${job.url} :: ${msg} :: found on ${job.parent}`);
        console.log(`  ?  ${job.url} — ${msg} (uncertain; found on ${job.parent})`);
      } else {
        state.errors.push({ url: job.url, reason: msg, source: job.parent, kind: "internal" });
        J({ t: "e", u: job.url, r: msg, k: "internal", src: job.parent });
        logLine(`${new Date().toISOString()} ERR ${job.url} :: ${msg} :: found on ${job.parent}`);
        console.log(`  x  ${job.url} — ${msg}  (found on ${job.parent})`);
      }
      return;
    }
    // Rate limited: back off and re-queue the page rather than discarding it.
    if (r.status === 429 || r.status === 503) {
      const waitMs = throttle.noteThrottle(parseRetryAfter(r.retryAfter, cfg.maxBackoff * 1000));
      job.attempts = (job.attempts || 0) + 1;
      if (job.attempts <= cfg.maxRetries) {
        state.crawled--;            // not a terminal visit — don't count it
        state.retries++;
        state.queue.push(job);      // try again after the backoff window
        const untilMs = Date.now() + throttle.activeMs();
        logLine(`# BACKOFF ${new Date().toISOString()} HTTP ${r.status} waitMs=${waitMs} untilMs=${untilMs} attempt=${job.attempts} url=${job.url}`);
        console.log(`  ~  [${r.status}] rate limited — backing off ${Math.round(waitMs / 1000)}s, will retry ${job.url}`);
        return;
      }
      state.errors.push({ url: job.url, reason: `rate limited (HTTP ${r.status}, gave up after ${cfg.maxRetries} retries)`, source: job.parent, kind: "internal" });
      J({ t: "e", u: job.url, r: `rate limited (HTTP ${r.status})`, k: "internal", src: job.parent });
      logLine(`${new Date().toISOString()} ERR ${job.url} :: HTTP ${r.status} (gave up after ${cfg.maxRetries} retries) :: found on ${job.parent}`);
      console.log(`  x  [${r.status}] ${job.url} — gave up after ${cfg.maxRetries} retries`);
      return;
    }
    throttle.noteSuccess();
    if (r.status >= 400) {
      // 429/503 were already handled above. A 403/401/5xx here likely means the
      // server blocked our automated fetch rather than a truly dead page.
      if (linkDisposition(r.status, null) === "blocked") {
        state.blocked.push({ url: job.url, reason: "HTTP " + r.status, source: job.parent, kind: "internal" });
        J({ t: "b", u: job.url, r: "HTTP " + r.status, k: "internal", src: job.parent });
        logLine(`${new Date().toISOString()} BLOCKED ${job.url} :: HTTP ${r.status} :: found on ${job.parent}`);
        console.log(`  ?  [${r.status}] ${job.url}  (uncertain; found on ${job.parent})`);
      } else {
        state.errors.push({ url: job.url, reason: "HTTP " + r.status, source: job.parent, kind: "internal" });
        J({ t: "e", u: job.url, r: "HTTP " + r.status, k: "internal", src: job.parent });
        logLine(`${new Date().toISOString()} ERR ${job.url} :: HTTP ${r.status} :: found on ${job.parent}`);
        console.log(`  x  [${r.status}] ${job.url}  (found on ${job.parent})`);
      }
      return;
    }
    let links, title;
    if (r.html) {
      const ex = extractLinks(r.html, job.url);
      links = ex.links; title = ex.title;
    } else if (r.doc) {
      // A document (PDF / Office file): read the links inside it.
      const dt = r.docType || sniffMagic(r.doc) || "doc";
      links = extractDocLinks(r.doc, dt, job.url);
      title = "(" + (dt === "ooxml" ? "office-doc" : dt) + ", " + links.length + " links)";
    } else {
      // Non-parseable binary (image/etc.) — record it as reachable, no links.
      state.pages.push({ url: job.url, title: "(non-HTML: " + (r.contentType || "?") + ")", status: r.status, depth: job.depth, internal: 0, external: 0 });
      J({ t: "k", u: job.url, s: r.status, d: job.depth, ct: r.contentType || "" });
      logLine(`${new Date().toISOString()} SKIP ${job.url} :: ${r.contentType || "non-HTML"}`);
      return;
    }
    let internalFound = 0, externalFound = 0;
    // When journaling, collect this page's discovered link targets so a resume can
    // rebuild the frontier + referrers + external/oos maps without re-crawling it.
    const inT = [], exT = [], ooT = [];
    for (const link of links) {
      if (link.protocol !== "http:" && link.protocol !== "https:") continue;
      if (sameDomain(link.hostname, startHost, cfg.includeSubdomains)) {
        if (inScope(link.pathname)) {
          // In-scope internal page. Record THIS page as a referrer of it (every
          // distinct referrer is kept — a broken page may need fixing on each),
          // then follow it once via tryAdd()'s dedup + frontier cap.
          internalFound++;
          const norm = normalize(link.href);
          addRef(norm, job.url);
          if (journal.on) inT.push(norm);
          if (job.depth < cfg.maxDepth && seen.tryAdd(norm)) state.queue.push({ url: norm, depth: job.depth + 1, parent: job.url });
        } else {
          // Same domain but outside the chosen subsection: record, never follow.
          if (!state.outOfScope.has(link.href)) state.outOfScope.set(link.href, { url: link.href });
          addRef(link.href, job.url);
          if (journal.on) ooT.push(link.href);
        }
      } else {
        // External domain: record only. Never followed — the crawl stops here,
        // and the deepest we ever look is an optional HEAD to see if it resolves.
        externalFound++;
        if (!state.external.has(link.href)) state.external.set(link.href, { url: link.href, host: link.hostname, status: null });
        addRef(link.href, job.url);
        if (journal.on) exT.push([link.href, link.hostname]);
      }
    }
    state.pages.push({ url: job.url, title, status: r.status, depth: job.depth, internal: internalFound, external: externalFound });
    J({ t: "p", u: job.url, s: r.status, d: job.depth, ti: title, in: inT, ex: exT, oo: ooT });
    logLine(`${new Date().toISOString()} OK d${job.depth} ${r.status} ${job.url} int=${internalFound} ext=${externalFound} extTotal=${state.external.size}`);
    console.log(`  ok [d${job.depth}] ${job.url}  (${internalFound} int, ${externalFound} ext)`);
  }

  // Pause control: while the pause file exists, workers idle instead of pulling
  // jobs. Toggled by the GUI Pause/Resume button (or any tool that creates the file).
  const isPaused = () => cfg.pauseFile && fs.existsSync(cfg.pauseFile);

  let inFlight = 0;
  let lastReportMs = Date.now();
  async function worker() {
    while (!interrupted) {
      if (isPaused()) { await sleep(300); continue; }
      if (state.crawled >= cfg.maxPages) return;
      const job = state.queue.shift();
      if (!job) {
        // Queue is momentarily empty — but an in-flight visit (e.g. one backing
        // off and re-queuing) may add more. Only finish when nothing is in flight.
        if (inFlight > 0) { await sleep(100); continue; }
        return;
      }
      inFlight++;
      try { await visit(job); } finally { inFlight--; }
      // Refresh the report/JSON on a checkpoint (every N pages) OR at least every
      // ~2s, so it visibly fills in even on a slow/rate-limited site.
      const dueByCount = cfg.checkpoint && state.crawled % cfg.checkpoint === 0;
      if (dueByCount || Date.now() - lastReportMs > 2000) {
        writeOutputs(state, cfg, allow, true);
        if (dueByCount) { logLine(`# checkpoint ${new Date().toISOString()} crawled=${state.crawled} queued=${state.queue.length} -> ${cfg.out}`); logger.finalize(false); }
        if (onProgress) try { onProgress(state); } catch { /* ignore */ }
        lastReportMs = Date.now();
      }
      if (cfg.delay) await sleep(cfg.delay);
    }
  }

  const depthLabel = cfg.maxDepth === Infinity ? "unlimited" : cfg.maxDepth;
  const pagesLabel = cfg.maxPages === Infinity ? "unlimited" : cfg.maxPages;
  const scopeLabel = pathPrefix ? `path ${pathPrefix}/` : "whole domain";

  // Start-of-run header line (lands in the first log part).
  logLine(`# crawl start ${state.startedAt} ${cfg.startUrl} scope=${scopeLabel} maxPages=${pagesLabel} maxDepth=${depthLabel} checkpoint=${cfg.checkpoint} crawlDelay=${crawlDelay}s run=${runId}`);
  if (crawlDelay > 0) console.log(`Crawl-delay: ${crawlDelay}s ${robotsDelay > 0 ? "(from robots.txt)" : "(manual)"} — ~${(1 / crawlDelay).toFixed(2)} req/sec`);
  // Write an initial (empty) partial report so it can be opened immediately and
  // then auto-refreshes as the crawl fills in.
  writeOutputs(state, cfg, allow, true);
  if (onProgress) try { onProgress(state); } catch { /* ignore */ }

  let controlTimer = null;
  function cleanupControlFiles() {
    try { if (cfg.stopFile && fs.existsSync(cfg.stopFile)) fs.unlinkSync(cfg.stopFile); } catch { /* ignore */ }
    try { if (cfg.pauseFile && fs.existsSync(cfg.pauseFile)) fs.unlinkSync(cfg.pauseFile); } catch { /* ignore */ }
  }

  // Graceful shutdown shared by Ctrl+C and the Stop control file: flush a partial
  // report/JSON, finalize the log, then exit 130. A second trigger forces exit.
  function shutdown(reason) {
    if (interrupted) process.exit(130);
    interrupted = true;
    if (controlTimer) { clearInterval(controlTimer); controlTimer = null; }
    console.log(`\n${reason} — flushing partial results (${state.pages.length} pages, ${state.queue.length} queued)…`);
    try {
      logLine(`# ${reason} ${new Date().toISOString()} crawled=${state.crawled} queued=${state.queue.length}`);
      logger.finalize(false);
      writeOutputs(state, cfg, allow, true);
      if (onProgress) onProgress(state);
      cleanupControlFiles();
    } catch { /* ignore */ }
    const logHint = cfg.log ? `\nProgress log:   ${logger.singleFile ? cfg.log : logger.manifestPath + ` (${logger.parts.length} part${logger.parts.length === 1 ? "" : "s"})`}` : "";
    console.log(`Partial report: ${cfg.out}${logHint}`);
    process.exit(130);
  }
  const onSigint = () => shutdown("INTERRUPTED");
  process.on("SIGINT", onSigint);

  // Poll the control files: stop -> graceful shutdown; pause/resume -> log the
  // transition (workers check isPaused() themselves).
  let pausedState = false;
  if (cfg.stopFile || cfg.pauseFile) {
    controlTimer = setInterval(() => {
      if (cfg.stopFile && fs.existsSync(cfg.stopFile)) { shutdown("STOPPED"); return; }
      const p = isPaused();
      if (p && !pausedState) { pausedState = true; logLine(`# PAUSED ${new Date().toISOString()} crawled=${state.crawled}`); console.log("Paused."); }
      else if (!p && pausedState) { pausedState = false; logLine(`# RESUMED ${new Date().toISOString()}`); console.log("Resumed."); }
    }, 400);
  }

  console.log(`Crawling ${cfg.startUrl} (host ${startHost}, scope: ${scopeLabel})`);
  console.log(`Limits: ${cfg.concurrency} concurrent, ${cfg.delay}ms delay, ${cfg.rps ? cfg.rps + " rps cap" : "no rps cap"}, max ${pagesLabel} pages / depth ${depthLabel}${cfg.checkpoint ? `, checkpoint every ${cfg.checkpoint}` : ""}, seen=${cfg.seen}\n`);
  await Promise.all(Array.from({ length: cfg.concurrency }, worker));
  process.removeListener("SIGINT", onSigint);
  if (controlTimer) { clearInterval(controlTimer); controlTimer = null; }
  cleanupControlFiles();

  if (cfg.checkExternal && !interrupted) {
    const exts = [...state.external.values()];
    console.log(`\nChecking ${exts.length} external links…`);
    logLine(`# extcheck start ${new Date().toISOString()} total=${exts.length}`);
    let i = 0, checked = 0, bad = 0, blockedN = 0;
    async function checker() {
      while (i < exts.length && !interrupted) {
        const e = exts[i++];
        await throttle.gate();
        await limiter();
        // HEAD-then-GET probe, then classify: confirmed-dead vs. blocked/uncertain.
        const { status, err } = await probe(e.url, cfg);
        const disp = linkDisposition(status, err);
        const detail = status > 0 ? "HTTP " + status : (err || "no response");
        checked++;
        const rf = state.refs.get(e.url);
        const source = rf ? [...rf][0] || "" : "";
        if (disp === "ok") { e.status = "ok"; }
        else if (disp === "blocked") {
          e.status = "blocked"; blockedN++;
          state.blocked.push({ url: e.url, reason: detail, source, kind: "external" });
        } else {
          e.status = "err"; bad++;
          state.errors.push({ url: e.url, reason: "external unreachable (" + detail + ")", source, kind: "external" });
        }
        logLine(`# extcheck ${checked}/${exts.length} ${e.status} ${detail} ${e.url}`);
        if (Date.now() - lastReportMs > 2000) { writeOutputs(state, cfg, allow, true); if (onProgress) try { onProgress(state); } catch { /* ignore */ } lastReportMs = Date.now(); }
        if (cfg.delay) await sleep(cfg.delay);
      }
    }
    await Promise.all(Array.from({ length: cfg.concurrency }, checker));
    logLine(`# extcheck done ${new Date().toISOString()} checked=${checked} unreachable=${bad} blocked=${blockedN}`);
    console.log(`Checked ${checked} external links, ${bad} unreachable, ${blockedN} blocked/uncertain.`);
  }

  // Second pass: re-test every failed link once. The first failure may have been
  // a transient timeout; if it works now, drop it from the errors and (for an
  // external link) flip its status to reachable, then rewrite the report so it
  // self-corrects.
  if (cfg.recheck && !interrupted && state.errors.length) {
    const toRecheck = state.errors.slice();
    console.log(`\nRe-checking ${toRecheck.length} failed link${toRecheck.length === 1 ? "" : "s"} (second pass)…`);
    logLine(`# recheck start ${new Date().toISOString()} count=${toRecheck.length}`);
    let i = 0, fixed = 0, moved = 0;
    async function rechecker() {
      while (i < toRecheck.length && !interrupted) {
        const e = toRecheck[i++];
        await throttle.gate();
        await limiter();
        // Re-probe with the same HEAD→GET + disposition logic, so a link that
        // only fails our automated check moves to blocked rather than staying
        // flagged as dead.
        let disp = "broken", detail = "";
        if (e.kind === "external") {
          const { status, err } = await probe(e.url, cfg);
          disp = linkDisposition(status, err);
          detail = status > 0 ? "HTTP " + status : (err || "no response");
        } else {
          try { const r = await request(e.url, "GET", cfg); disp = linkDisposition(r.status, null); detail = "HTTP " + r.status; }
          catch (err) { const m = String(err && err.message || err); disp = linkDisposition(0, m); detail = m; }
        }
        if (disp === "ok") {
          const idx = state.errors.indexOf(e);
          if (idx >= 0) state.errors.splice(idx, 1);
          if (e.kind === "external") { const ent = state.external.get(e.url); if (ent) ent.status = "ok"; }
          fixed++;
          logLine(`# recheck ${e.url} was=error now=ok`);
        } else if (disp === "blocked") {
          const idx = state.errors.indexOf(e);
          if (idx >= 0) state.errors.splice(idx, 1);
          if (e.kind === "external") { const ent = state.external.get(e.url); if (ent) ent.status = "blocked"; }
          state.blocked.push({ url: e.url, reason: detail, source: e.source, kind: e.kind });
          moved++;
          logLine(`# recheck ${e.url} was=error now=blocked`);
        } else {
          logLine(`# recheck ${e.url} still=error`);
        }
        if (Date.now() - lastReportMs > 2000) { writeOutputs(state, cfg, allow, true); if (onProgress) try { onProgress(state); } catch { /* ignore */ } lastReportMs = Date.now(); }
        if (cfg.delay) await sleep(cfg.delay);
      }
    }
    await Promise.all(Array.from({ length: cfg.concurrency }, rechecker));
    logLine(`# recheck done ${new Date().toISOString()} fixed=${fixed} blocked=${moved} stillBroken=${toRecheck.length - fixed - moved}`);
    console.log(`Re-check: ${fixed} of ${toRecheck.length} now OK, ${moved} blocked/uncertain, ${toRecheck.length - fixed - moved} still broken.`);
  }

  // Log every referrer of every broken link (complete now that the crawl is
  // done), so the on-disk log records each page that needs a fix, not just one.
  for (const e of state.errors) {
    const rf = state.refs.get(e.url);
    const list = rf && rf.size ? [...rf] : (e.source ? [e.source] : []);
    for (const ref of list) logLine(`# brokenref ${e.kind || "internal"} ${e.url} <- ${ref}`);
  }
  logLine(`# crawl done ${new Date().toISOString()} crawled=${state.crawled} pages=${state.pages.length} external=${state.external.size} errors=${state.errors.length}`);
  logger.finalize(!sharedLogger);   // shared logger is finalized once by the caller
  seen.close();
  state.finishedMs = Date.now();   // freeze crawl runtime for the final report
  return state;
}

// ----------------------------- allowlist suggestion -----------------------------
function writeSuggested(cfg, suppressedOut, activeErrors) {
  if (!activeErrors.length) {
    // Nothing new to suggest; leave any existing file untouched.
    return false;
  }
  const lines = [];
  lines.push("# Suggested allowlist — broken links found " + new Date().toISOString());
  lines.push("# These are NOT yet in " + cfg.allowlist + ".");
  lines.push("#");
  lines.push("# To stop a broken link from appearing in future reports, KEEP its");
  lines.push("# line here and append it to " + cfg.allowlist + " (or pass this file");
  lines.push("# via --allowlist). DELETE lines for issues you still want flagged.");
  lines.push("# '*' is a wildcard. '#' starts a comment. Blank lines are ignored.");
  lines.push("#");
  for (const e of activeErrors) {
    lines.push(`${e.url}   # ${e.reason} — found on: ${e.source || "(start)"}`);
  }
  fs.writeFileSync(cfg.suggest, lines.join("\n") + "\n");
  return true;
}

// ----------------------------- multi-site helpers -----------------------------
function hostOf(u) { try { return new URL(u).hostname; } catch { return u; } }

// Derive a per-site report path from the --out base: report.html -> report.1-host.html
function sitePath(out, i, host) {
  const ext = path.extname(out) || ".html";
  const stem = out.slice(0, out.length - ext.length);
  return `${stem}.${i + 1}-${host.replace(/[^a-z0-9.-]/gi, "_")}${ext}`;
}

// Combined index report listing each site with summary + a link to its report.
// ----------------------------- main -----------------------------
(async function main() {
  // Subcommand: reconstruct a partitioned log into one composite stream.
  const mi = process.argv.indexOf("--merge-logs");
  if (mi !== -1) {
    const target = process.argv[mi + 1];
    if (!target) die("--merge-logs needs a manifest or log base path");
    const oi = process.argv.indexOf("--out");
    const outFile = oi !== -1 ? process.argv[oi + 1] : "";
    const n = mergeLogs(target, outFile);
    if (outFile) console.error(`Merged ${n} part(s) -> ${outFile}`);
    return;
  }

  const cfg = parseArgs(process.argv);
  const allowPatterns = loadAllowlist(cfg.allowlist);
  const allow = compileAllow(allowPatterns);

  // ---- single site: report goes straight to --out (unchanged behavior) ----
  if (cfg.startUrls.length === 1) {
    const state = await crawl(cfg, allow);
    const suppressed = [], active = [];
    for (const e of state.errors) (allow.some((re) => re.test(e.url)) ? suppressed : active).push(e);
    writeOutputs(state, cfg, allow, false);
    const wroteSuggest = writeSuggested(cfg, suppressed, active);
    console.log(`\nDone. ${state.pages.length} pages, ${state.external.size} external links${state.outOfScope.size ? `, ${state.outOfScope.size} out-of-scope` : ""}, ${active.length} errors${suppressed.length ? `, ${suppressed.length} suppressed` : ""}${state.retries ? `, ${state.retries} rate-limit retries` : ""}.`);
    console.log(`Report:  ${cfg.out}`);
    if (cfg.json) console.log(`JSON:    ${cfg.json}`);
    if (cfg.log) {
      if (state.logSingleFile) console.log(`Log:     ${cfg.log}`);
      else console.log(`Log:     ${state.logManifest} (${state.logParts.length} part${state.logParts.length === 1 ? "" : "s"}; merge: node crawl.js --merge-logs ${state.logManifest})`);
    }
    if (allowPatterns.length) console.log(`Allowlist applied: ${cfg.allowlist} (${allowPatterns.length} pattern${allowPatterns.length === 1 ? "" : "s"})`);
    if (wroteSuggest) console.log(`New broken links to review: ${cfg.suggest} (edit, then append to ${cfg.allowlist})`);
    return;
  }

  // ---- multiple sites: crawl sequentially, --out becomes an index ----
  const startedAt = new Date().toISOString();
  const runId = `${startedAt.replace(/[-:]/g, "").replace(/\..+/, "")}-${Math.random().toString(16).slice(2, 8)}`;
  const logger = makeLogWriter(cfg, { run: runId, startUrl: cfg.startUrls.join(" "), startedAt });
  const sites = cfg.startUrls.map((u, i) => ({ url: u, host: hostOf(u), state: null, partial: true, reportFile: sitePath(cfg.out, i, hostOf(u)) }));
  const writeIndex = (partial) => { try { fs.writeFileSync(cfg.out, buildIndexReport(sites, cfg, allow, partial, startedAt)); if (cfg.json) writeCombinedJson(sites, cfg, allow); } catch { /* ignore */ } };

  console.log(`Crawling ${sites.length} sites sequentially -> index ${cfg.out}`);
  writeIndex(true);

  for (let i = 0; i < sites.length; i++) {
    logger.line(`# === site ${i + 1}/${sites.length} ${sites[i].url} ===`);
    console.log(`\n=== Site ${i + 1}/${sites.length}: ${sites[i].url} ===`);
    // Per-site resume journal, derived from --state like the per-site report from --out.
    const perState = cfg.state ? sitePath(cfg.state, i, sites[i].host) : "";
    const siteCfg = Object.assign({}, cfg, { startUrl: sites[i].url, out: sites[i].reportFile, json: "", state: perState, resume: cfg.resume ? perState : "" });
    const state = await crawl(siteCfg, allow, logger, (st) => { sites[i].state = st; sites[i].partial = true; writeIndex(true); });
    sites[i].state = state; sites[i].partial = false;
    writeOutputs(state, siteCfg, allow, false);   // final per-site report
    writeIndex(i < sites.length - 1);
  }
  logger.finalize(true);

  // Aggregate broken links across all sites for the suggested allowlist.
  const allActive = [], allSupp = [];
  for (const s of sites) for (const e of s.state.errors) (allow.some((re) => re.test(e.url)) ? allSupp : allActive).push(e);
  const wroteSuggest = writeSuggested(cfg, allSupp, allActive);

  console.log(`\nAll ${sites.length} sites done.`);
  console.log(`Index:   ${cfg.out}`);
  for (const s of sites) console.log(`  ${s.host}: ${s.state.pages.length} pages, ${s.state.errors.length} errors -> ${s.reportFile}`);
  if (cfg.json) console.log(`JSON:    ${cfg.json}`);
  if (cfg.log) console.log(`Log:     ${logger.singleFile ? cfg.log : logger.manifestPath}`);
  if (wroteSuggest) console.log(`New broken links to review: ${cfg.suggest} (edit, then append to ${cfg.allowlist})`);
})().catch((e) => { console.error("Fatal:", e.message || e); process.exit(1); });
