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

const MAX_REDIRECTS = 5;
const MAX_BYTES = 5 * 1024 * 1024; // cap page size we read into memory
// A current desktop-Chrome User-Agent. Some sites serve a 403/blank to unknown
// clients but a normal page to a real browser; --browser sends this honest
// browser identity (no spoofed cookies/JS) so legitimate link verification
// isn't tripped by naive UA filtering. Not an evasion of deliberate blocking.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
// Memory backstops for large crawls — bound per-link and per-report growth so
// RAM scales with distinct-URL count, not with how interlinked the site is.
const REF_PREVIEW = 3;             // referrers shown inline in the external/out-of-scope tables
const REF_CAP = 500;              // max referrers listed in a broken-link's nested table
const RENDER_CAP = 5000;           // max rows rendered per report table (full data stays in --json/--log)
const TITLE_CAP = 300;             // max title chars retained per page
const BRAND = "Charlotte";         // report branding — the project / repo name
const BRAND_ICON = "🕸️";           // spiderweb glyph: favicon + report header

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
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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

  async function visit(job) {
    state.crawled++;
    await throttle.gate();   // wait out any active rate-limit backoff window
    await limiter();
    let r;
    try {
      r = await request(job.url, "GET", cfg);
    } catch (e) {
      const msg = String(e.message || e);
      if (linkDisposition(0, msg) === "blocked") {
        state.blocked.push({ url: job.url, reason: msg, source: job.parent, kind: "internal" });
        logLine(`${new Date().toISOString()} BLOCKED ${job.url} :: ${msg} :: found on ${job.parent}`);
        console.log(`  ?  ${job.url} — ${msg} (uncertain; found on ${job.parent})`);
      } else {
        state.errors.push({ url: job.url, reason: msg, source: job.parent, kind: "internal" });
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
        logLine(`${new Date().toISOString()} BLOCKED ${job.url} :: HTTP ${r.status} :: found on ${job.parent}`);
        console.log(`  ?  [${r.status}] ${job.url}  (uncertain; found on ${job.parent})`);
      } else {
        state.errors.push({ url: job.url, reason: "HTTP " + r.status, source: job.parent, kind: "internal" });
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
      logLine(`${new Date().toISOString()} SKIP ${job.url} :: ${r.contentType || "non-HTML"}`);
      return;
    }
    let internalFound = 0, externalFound = 0;
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
          if (job.depth < cfg.maxDepth && seen.tryAdd(norm)) state.queue.push({ url: norm, depth: job.depth + 1, parent: job.url });
        } else {
          // Same domain but outside the chosen subsection: record, never follow.
          if (!state.outOfScope.has(link.href)) state.outOfScope.set(link.href, { url: link.href });
          addRef(link.href, job.url);
        }
      } else {
        // External domain: record only. Never followed — the crawl stops here,
        // and the deepest we ever look is an optional HEAD to see if it resolves.
        externalFound++;
        if (!state.external.has(link.href)) state.external.set(link.href, { url: link.href, host: link.hostname, status: null });
        addRef(link.href, job.url);
      }
    }
    state.pages.push({ url: job.url, title, status: r.status, depth: job.depth, internal: internalFound, external: externalFound });
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

// ----------------------------- report -----------------------------
function buildReport(state, cfg, allow, partial) {
  const suppressed = [], active = [];
  for (const e of state.errors) (allow.some((re) => re.test(e.url)) ? suppressed : active).push(e);
  // Split actionable errors: broken internal pages (your fix) vs unreachable
  // external links (a content update). Missing kind defaults to internal.
  const activeInt = active.filter((e) => e.kind !== "external");
  const activeExt = active.filter((e) => e.kind === "external");
  // Blocked / uncertain: our automated check couldn't confirm these (auth,
  // anti-bot, rate-limit, timeouts). Likely fine in a real browser — reported
  // apart from confirmed-dead links so they aren't mistaken for them. Deduped.
  const blockedSeen = {};
  const blocked = (state.blocked || []).filter((b) => { if (blockedSeen[b.url]) return false; blockedSeen[b.url] = 1; return true; });

  // Crawl runtime — frozen at completion (state.finishedMs) for the final report;
  // counts up from the start while a partial report is still being written.
  const startedMs = state.startedMs || Date.parse(state.startedAt) || Date.now();
  const elapsedMs = Math.max(0, (state.finishedMs || Date.now()) - startedMs);
  const fmtDur = (ms) => {
    const s = Math.round(ms / 1000);
    if (s < 60) return s + "s";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
  };
  // Selectable broken-link export (checkbox column + "export to allowlist") is a
  // final-report feature: partial reports auto-refresh, which would clear ticks.
  const showPick = !partial;

  const stat = (n, label, cls) => `<div class="stat ${cls || ""}"><div class="n">${n}</div><div class="l">${esc(label)}</div></div>`;
  const link = (u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`;
  // A "found on" referrer: clickable when it's a real URL, plain text otherwise.
  const srcLink = (s) => /^https?:\/\//i.test(s) ? link(s) : esc(s || "—");
  const refsOf = (url) => { const s = state.refs.get(url); return s ? [...s] : []; };
  // Compact "found on" for the external / out-of-scope tables: first few + count.
  const srcCell = (url) => {
    const arr = refsOf(url);
    if (!arr.length) return "—";
    const shown = arr.slice(0, REF_PREVIEW).map(srcLink).join("<br>");
    return shown + (arr.length > REF_PREVIEW ? `<br><span class="muted">+${arr.length - REF_PREVIEW} more</span>` : "");
  };
  // "Found on" for a broken link: ALL referrers. One inline; many in a nested,
  // collapsible table inside the row so every page that needs fixing is listed.
  const refCell = (url, fallback) => {
    let arr = refsOf(url);
    if (!arr.length && fallback) arr = /^https?:\/\//i.test(fallback) ? [fallback] : [];
    if (!arr.length) return esc(fallback || "—");
    if (arr.length === 1) return link(arr[0]);
    const rows = arr.slice(0, REF_CAP).map((r) => `<tr><td>${link(r)}</td></tr>`).join("");
    const more = arr.length > REF_CAP ? `<tr><td class="muted">+${arr.length - REF_CAP} more — see JSON output</td></tr>` : "";
    return `<details><summary>${arr.length} pages link here</summary><div class="tablewrap" style="max-height:220px;margin-top:6px"><table class="subtable"><tbody>${rows}${more}</tbody></table></div></details>`;
  };
  // Cap rows rendered per table so a huge crawl can't build a multi-hundred-MB
  // HTML string (and stress GC). Full data is always in --json / --log.
  const capNote = (total) => total > RENDER_CAP ? `<p class="muted">Showing first ${RENDER_CAP.toLocaleString()} of ${total.toLocaleString()} — full set in the JSON/log output.</p>` : "";

  const pages = state.pages.slice().sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
  const rowsInternal = pages.slice(0, RENDER_CAP).map((p) =>
    `<tr><td>${p.depth}</td><td>${link(p.url)}</td><td>${esc(p.title || "—")}</td><td><span class="pill ok">${p.status}</span></td><td>${p.internal}</td><td>${p.external}</td></tr>`).join("");

  const extVals = [...state.external.values()].slice(0, RENDER_CAP);
  const byHost = new Map();
  for (const e of extVals) { if (!byHost.has(e.host)) byHost.set(e.host, []); byHost.get(e.host).push(e); }
  const extGroups = [...byHost.entries()].sort((a, b) => b[1].length - a[1].length).map(([host, list]) => {
    const rows = list.map((e) => {
      const st = e.status === "ok" ? `<span class="pill ok">reachable</span>` : e.status === "err" ? `<span class="pill err">unreachable</span>` : `<span class="pill skip">not checked</span>`;
      return `<tr><td>${link(e.url)}</td><td>${st}</td><td class="muted">${srcCell(e.url)}</td></tr>`;
    }).join("");
    return `<details open><summary>${esc(host)} <span class="muted">(${list.length})</span></summary><div class="tablewrap"><table><thead><tr><th>External URL</th><th>Status</th><th>Found on</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  }).join("");

  const errRows = (arr) => arr.slice(0, RENDER_CAP).map((e) => `<tr><td>${link(e.url)}</td><td><span class="pill err">${esc(e.reason)}</span></td><td class="muted">${refCell(e.url, e.source)}</td></tr>`).join("");
  // Blocked rows: a neutral "uncertain" pill + the kind (internal/external).
  const blockedRows = (arr) => arr.slice(0, RENDER_CAP).map((e) => `<tr><td>${link(e.url)}</td><td><span class="pill skip">${esc(e.reason)}</span></td><td>${esc(e.kind || "internal")}</td><td class="muted">${refCell(e.url, e.source)}</td></tr>`).join("");
  // Error rows WITH a leading checkbox — only on the two "Errors" tabs. Each box
  // carries the data to render an allowlist line (url + reason + a representative
  // referrer), so a selection can be exported as an allowlist appendage.
  const pickRows = (arr) => arr.slice(0, RENDER_CAP).map((e) => {
    const src = refsOf(e.url)[0] || e.source || "(start)";
    return `<tr><td><input type="checkbox" class="pickbox" data-url="${esc(e.url)}" data-reason="${esc(e.reason)}" data-source="${esc(src)}"></td><td>${link(e.url)}</td><td><span class="pill err">${esc(e.reason)}</span></td><td class="muted">${refCell(e.url, e.source)}</td></tr>`;
  }).join("");
  // Toolbar above an Errors table: a live count + copy/export actions (disabled
  // until something is ticked). The select-all lives in the table header cell.
  const exportBar = (scope) => `<div class="exportbar"><span class="selcount" data-scope="${scope}">0 selected</span><span class="grow"></span><button type="button" class="btn copybtn" data-scope="${scope}" disabled>⧉ Copy lines</button><button type="button" class="btn exportbtn" data-scope="${scope}" disabled>⬇ Export to allowlist…</button></div>`;

  // Out-of-scope (same domain, outside the chosen subsection) — only shown when scoped.
  const scoped = !!state.pathPrefix;
  const oosRows = [...state.outOfScope.values()].sort((a, b) => a.url.localeCompare(b.url)).slice(0, RENDER_CAP).map((e) =>
    `<tr><td>${link(e.url)}</td><td class="muted">${srcCell(e.url)}</td></tr>`).join("");
  const oosStat = scoped ? stat(state.outOfScope.size, "Out of scope", "") : "";
  const oosTab = scoped ? `<div class="tab" data-tab="outscope">Out of scope (${state.outOfScope.size})</div>` : "";
  const oosPanel = scoped ? `<div class="panel hidden" id="panel-outscope">${state.outOfScope.size ? `<p class="muted">Same domain but outside <code>${esc(state.pathPrefix)}</code> — recorded, not crawled.</p>${capNote(state.outOfScope.size)}<div class="tablewrap"><table><thead><tr><th>URL</th><th>Found on</th></tr></thead><tbody>${oosRows}</tbody></table></div>` : `<p class="muted">No out-of-scope links found.</p>`}</div>` : "";

  const depthLabel = cfg.maxDepth === Infinity ? "unlimited" : cfg.maxDepth;
  const pagesLabel = cfg.maxPages === Infinity ? "unlimited" : cfg.maxPages;
  const scopeLabel = scoped ? `scope ${esc(state.pathPrefix)}/` : "whole domain";
  const cfgLine = `${cfg.concurrency} concurrent · ${cfg.delay}ms delay · ${cfg.rps ? cfg.rps + " rps cap" : "no rps cap"}${state.crawlDelay ? ` · crawl-delay ${state.crawlDelay}s` : ""} · max ${pagesLabel} pages / depth ${depthLabel} · ${scopeLabel}${cfg.includeSubdomains ? " · subdomains internal" : ""}${cfg.checkExternal ? " · external checked" : ""}${state.retries ? ` · ${state.retries} rate-limit retries` : ""}`;
  // While a crawl is in progress the open report refreshes itself in JS (see the
  // script below) — but only when you're not interacting, and it restores your
  // tab/scroll. No <meta refresh>, so a reload never interrupts you mid-scroll.
  const banner = partial
    ? `<p style="color:#fbbf24">⏳ Crawl in progress — partial results, updating automatically (pauses while you're scrolling or selecting). ${state.crawled.toLocaleString()} crawled, ${state.queue.length.toLocaleString()} queued.</p>`
    : "";

  // Progress-log parts: list the partitioned log files and how to reconstruct
  // the composite log. (The report can't read disk, so it documents the parts.)
  const parts = state.logParts || [];
  const logCard = (!state.logSingleFile && parts.length)
    ? `<div class="card"><h2>Progress log — ${parts.length} part${parts.length === 1 ? "" : "s"} <span class="muted" style="font-weight:400">(run ${esc(state.runId || "")})</span></h2>
       <div class="tablewrap"><table><thead><tr><th>Part</th><th>File</th><th>Lines</th><th>Bytes</th></tr></thead><tbody>${
         parts.map((p) => `<tr><td>${p.part}</td><td>${esc(p.file)}</td><td>${(p.lines || 0).toLocaleString()}</td><td>${(p.bytes || 0).toLocaleString()}</td></tr>`).join("")
       }</tbody></table></div>
       <p class="muted">Reconstruct the full log: <code>node crawl.js --merge-logs ${esc(state.logManifest || "")}</code></p></div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${partial ? "[crawling] " : ""}${BRAND_ICON} ${BRAND} · Crawl report — ${esc(state.startHost)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Ctext%20y='.9em'%20font-size='90'%3E%F0%9F%95%B8%EF%B8%8F%3C/text%3E%3C/svg%3E">
<style>
 :root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--good:#4ade80;--bad:#f87171;--warn:#fbbf24;--border:#2c3340}
 *{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
 header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--panel)}header h1{margin:0 0 4px;font-size:18px}header p{margin:0;color:var(--muted);font-size:13px}
 main{max-width:1100px;margin:0 auto;padding:24px}.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:20px}
 .stats{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
 .stat{background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center}.stat .n{font-size:26px;font-weight:700}.stat .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
 .stat.good .n{color:var(--good)}.stat.bad .n{color:var(--bad)}.stat.warn .n{color:var(--warn)}
 table{width:100%;border-collapse:collapse;font-size:13px;min-width:820px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
 th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;position:sticky;top:0;background:var(--panel)}
 /* URL and Found-on columns get real width; long URLs wrap at sensible points, not every character */
 td{overflow-wrap:anywhere;word-break:normal}
 th:first-child,td:first-child{min-width:360px}
 td:last-child{min-width:300px}
 td a{color:var(--accent);text-decoration:none}td a:hover{text-decoration:underline}
 .tablewrap{max-height:460px;overflow:auto;border:1px solid var(--border);border-radius:8px}
 .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600}.pill.ok{background:rgba(74,222,128,.15);color:var(--good)}.pill.err{background:rgba(248,113,113,.15);color:var(--bad)}.pill.skip{background:rgba(251,191,36,.15);color:var(--warn)}
 .muted{color:var(--muted)}h2{font-size:15px;margin:0 0 12px}details summary{cursor:pointer;font-weight:600;padding:6px 0}
 .tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}.tab{padding:7px 14px;border-radius:7px;background:var(--panel2);border:1px solid var(--border);cursor:pointer;font-size:13px}.tab.active{background:var(--accent);color:#06121f;border-color:var(--accent)}
 .hidden{display:none}code{background:var(--panel2);padding:1px 5px;border-radius:4px}
 /* Errors tables with a leading checkbox column: keep the box narrow, URL wide. */
 .haspick th:first-child,.haspick td:first-child{min-width:34px;width:34px;text-align:center}
 .haspick th:nth-child(2),.haspick td:nth-child(2){min-width:360px}
 .haspick input[type=checkbox]{cursor:pointer;width:15px;height:15px}
 .exportbar{display:flex;align-items:center;gap:10px;margin:0 0 10px;flex-wrap:wrap}.exportbar .grow{flex:1}
 .selcount{color:var(--muted);font-size:12px}
 .btn{background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:6px 12px;font-size:13px;cursor:pointer}.btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}.btn:disabled{opacity:.5;cursor:default}
 .btn.exportbtn:not(:disabled){background:var(--accent);color:#06121f;border-color:var(--accent);font-weight:600}
 .toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--panel2);border:1px solid var(--accent);color:var(--fg);padding:10px 16px;border-radius:8px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:9}.toast.show{opacity:1}
 /* No-flash tab restore: a head script sets html.tab-NAME before first paint so
    the correct tab/panel renders immediately, not the default then a swap. */
 html[class*="tab-"] .panel{display:none}
 html.tab-internal #panel-internal,html.tab-external #panel-external,html.tab-outscope #panel-outscope,html.tab-errint #panel-errint,html.tab-errext #panel-errext,html.tab-blockd #panel-blockd,html.tab-suppressed #panel-suppressed{display:block}
 html[class*="tab-"] .tab{background:var(--panel2);color:var(--fg);border-color:var(--border)}
 html.tab-internal .tab[data-tab="internal"],html.tab-external .tab[data-tab="external"],html.tab-outscope .tab[data-tab="outscope"],html.tab-errint .tab[data-tab="errint"],html.tab-errext .tab[data-tab="errext"],html.tab-blockd .tab[data-tab="blockd"],html.tab-suppressed .tab[data-tab="suppressed"]{background:var(--accent);color:#06121f;border-color:var(--accent)}
 .subtable{width:100%;border-collapse:collapse}.subtable td{padding:4px 8px;border-bottom:1px solid var(--border)}
 details summary{color:var(--accent)}
</style>
<script>(function(){try{var n=(location.hash||'').substring(1);if(!n){try{n=localStorage.getItem('charlotteTab')||'';}catch(e){}}if(n)document.documentElement.className='tab-'+n;}catch(e){}})();</script>
</head><body>
<header><h1>${partial ? "[crawling] " : ""}${BRAND_ICON} ${BRAND} <span class="muted" style="font-weight:400">· Crawl report</span> — ${esc(state.startHost)}</h1>
<p>${esc(cfg.startUrl)} · ${esc(state.startedAt)}<br>${esc(cfgLine)}</p>${banner}</header>
<main>
 <div class="card"><div class="stats">
  ${stat(state.pages.length, "Internal pages", "good")}
  ${stat(state.external.size, "External links", "warn")}
  ${oosStat}
  ${stat(activeInt.length, "Errors · internal", activeInt.length ? "bad" : "")}
  ${stat(activeExt.length, "Errors · external", activeExt.length ? "bad" : "")}
  ${stat(blocked.length, "Blocked · uncertain", blocked.length ? "warn" : "")}
  ${stat(suppressed.length, "Suppressed", "")}
  ${partial ? stat(state.queue.length, "Queued", "") : stat(state.crawled, "Requests", "")}
  ${stat(fmtDur(elapsedMs), partial ? "Runtime · so far" : "Runtime", "")}
 </div></div>
 <div class="card">
  <div class="tabs">
   <div class="tab active" data-tab="internal">Internal pages (${state.pages.length})</div>
   <div class="tab" data-tab="external">External links (${state.external.size})</div>
   ${oosTab}
   <div class="tab" data-tab="errint">Errors · internal (${activeInt.length})</div>
   <div class="tab" data-tab="errext">Errors · external (${activeExt.length})</div>
   <div class="tab" data-tab="blockd">Blocked · uncertain (${blocked.length})</div>
   <div class="tab" data-tab="suppressed">Suppressed (${suppressed.length})</div>
  </div>
  <div class="panel" id="panel-internal">${pages.length ? `${capNote(pages.length)}<div class="tablewrap"><table><thead><tr><th>Depth</th><th>URL</th><th>Title</th><th>Status</th><th>Int</th><th>Ext</th></tr></thead><tbody>${rowsInternal}</tbody></table></div>` : `<p class="muted">No pages crawled.</p>`}</div>
  <div class="panel hidden" id="panel-external">${state.external.size ? `${capNote(state.external.size)}${extGroups}` : `<p class="muted">No external links found.</p>`}</div>
  ${oosPanel}
  <div class="panel hidden" id="panel-errint">${activeInt.length ? `<p class="muted">Broken internal pages — these are yours to fix.</p>${showPick ? exportBar("errint") : ""}<div class="tablewrap"><table${showPick ? ` class="haspick"` : ``}><thead><tr>${showPick ? `<th><input type="checkbox" class="pickall" data-scope="errint" title="Select all"></th>` : ``}<th>Broken URL</th><th>Reason</th><th>Found on</th></tr></thead><tbody>${showPick ? pickRows(activeInt) : errRows(activeInt)}</tbody></table></div>` : `<p class="muted">No internal errors. 🎉</p>`}</div>
  <div class="panel hidden" id="panel-errext">${activeExt.length ? `<p class="muted">Unreachable external links — found on your pages, but the destination is down. Fix the link or remove it.</p>${showPick ? exportBar("errext") : ""}<div class="tablewrap"><table${showPick ? ` class="haspick"` : ``}><thead><tr>${showPick ? `<th><input type="checkbox" class="pickall" data-scope="errext" title="Select all"></th>` : ``}<th>External URL</th><th>Reason</th><th>Found on</th></tr></thead><tbody>${showPick ? pickRows(activeExt) : errRows(activeExt)}</tbody></table></div>` : `<p class="muted">${cfg.checkExternal ? "No unreachable external links. 🎉" : "External links weren't verified — enable “Verify external links resolve”."}</p>`}</div>
  <div class="panel hidden" id="panel-blockd">${blocked.length ? `<p class="muted">Our automated check couldn't confirm these (auth, anti-bot, rate-limiting, or timeouts) — they very likely work in a real browser. Verify by hand before treating as broken. Re-running with <code>--browser</code> and a slower rate (<code>--concurrency 1 --rps 0.5</code>) clears many of them.</p>${capNote(blocked.length)}<div class="tablewrap"><table><thead><tr><th>URL</th><th>Why uncertain</th><th>Kind</th><th>Found on</th></tr></thead><tbody>${blockedRows(blocked)}</tbody></table></div>` : `<p class="muted">Nothing blocked or uncertain. 🎉</p>`}</div>
  <div class="panel hidden" id="panel-suppressed">${suppressed.length ? `<p class="muted">Hidden from Errors via <code>${esc(cfg.allowlist)}</code>.</p><div class="tablewrap"><table><thead><tr><th>URL</th><th>Reason</th><th>Found on</th></tr></thead><tbody>${errRows(suppressed)}</tbody></table></div>` : `<p class="muted">Nothing suppressed.</p>`}</div>
 </div>
 ${logCard}
</main>
<script>
(function(){
  var PARTIAL = ${partial ? "true" : "false"};
  var TKEY='charlotteTab';
  var tabs=document.querySelectorAll('.tab');
  function L(){ try{ return window.localStorage; }catch(e){ return null; } }

  // Active tab is driven by a class on <html> (html.tab-NAME) so the same CSS
  // that prevents the first-paint flash also handles live switching.
  function activate(name){
    var first=tabs.length?tabs[0].getAttribute('data-tab'):'', found=false, i;
    for(i=0;i<tabs.length;i++){ if(tabs[i].getAttribute('data-tab')===name) found=true; }
    if(!found) name=first;
    document.documentElement.className='tab-'+name;
    var s=L(); if(s){ try{ s.setItem(TKEY,name); }catch(e){} }
    try{ history.replaceState(null,'','#'+name); }catch(e){}
    return name;
  }
  for(var i=0;i<tabs.length;i++){ tabs[i].addEventListener('click', function(){ activate(this.getAttribute('data-tab')); }); }

  // ---- save/restore ALL in-tab state: every table's scroll, the page scroll,
  //      and which collapsible sections are open ----
  function allTW(){ return document.querySelectorAll('.tablewrap'); }
  function panelOf(el){ while(el && el!==document){ if(el.className && (' '+el.className+' ').indexOf(' panel ')>=0) return el; el=el.parentNode; } return null; }
  function twKey(tw){
    var panel=panelOf(tw), pid=panel?panel.id:'p', idx=0;
    var sibs=panel?panel.querySelectorAll('.tablewrap'):[tw];
    for(var k=0;k<sibs.length;k++){ if(sibs[k]===tw){ idx=k; break; } }
    return 'charlotteTW_'+pid+'_'+idx;
  }
  function saveState(){
    var s=L(); if(!s) return;
    try{
      s.setItem('charlotteWinY', String(window.pageYOffset||document.documentElement.scrollTop||0));
      var tw=allTW(); for(var i=0;i<tw.length;i++) s.setItem(twKey(tw[i]), String(tw[i].scrollTop));
      var d=document.querySelectorAll('details'); for(var j=0;j<d.length;j++) s.setItem('charlotteD_'+j, d[j].open?'1':'0');
    }catch(e){}
  }
  function restoreState(){
    var s=L(); if(!s) return;
    try{
      var d=document.querySelectorAll('details'); for(var j=0;j<d.length;j++){ var dv=s.getItem('charlotteD_'+j); if(dv!==null) d[j].open=(dv==='1'); }
      var tw=allTW(); for(var i=0;i<tw.length;i++){ var v=s.getItem(twKey(tw[i])); if(v!==null) tw[i].scrollTop=parseInt(v,10)||0; }
      var wy=s.getItem('charlotteWinY'); if(wy!==null) window.scrollTo(0, parseInt(wy,10)||0);
    }catch(e){}
  }

  // restore tab (hash, then storage) then state
  var want=(location.hash||'').substring(1), s=L();
  if(!want && s){ try{ want=s.getItem(TKEY)||''; }catch(e){} }
  activate(want);
  try{ if('scrollRestoration' in history) history.scrollRestoration='manual'; }catch(e){}
  restoreState();

  var tws=allTW(); for(var t=0;t<tws.length;t++) tws[t].addEventListener('scroll', saveState);
  window.addEventListener('scroll', saveState);
  var dets=document.querySelectorAll('details'); for(var dd=0;dd<dets.length;dd++) dets[dd].addEventListener('toggle', saveState);
  window.addEventListener('beforeunload', saveState);

  // ---- non-disruptive live refresh (partial reports only) ----
  // Reload to pull new data, but NEVER while you're interacting: defer until
  // there's been ~2.5s with no mouse/scroll/key activity and no text selected,
  // then save state and reload (which restores it). So a refresh can't interrupt
  // you mid-scroll, mid-read, or mid-selection.
  if(PARTIAL){
    var IDLE_MS=2500, lastAct=(new Date()).getTime();
    function bump(){ lastAct=(new Date()).getTime(); }
    var evs=['mousemove','mousedown','keydown','wheel','touchstart','scroll'];
    for(var e=0;e<evs.length;e++) document.addEventListener(evs[e], bump, true);
    function tick(){
      var idle=(new Date()).getTime()-lastAct, sel='';
      try{ sel=window.getSelection?String(window.getSelection()):''; }catch(_){}
      if(idle<IDLE_MS || sel!==''){ setTimeout(tick, 600); return; }
      saveState();
      location.reload();
    }
    setTimeout(tick, 5000);
  }
})();
</script>
<script>
/* Broken-link selection → allowlist appendage (final report only). Each ticked
   row on the two Errors tabs becomes an allowlist line; Export downloads them as
   a file to append to the allowlist, Copy puts them on the clipboard. */
(function(){
  var ALLOWLIST = ${JSON.stringify(cfg.allowlist)};
  var HOST = ${JSON.stringify(state.startHost)};
  var BRAND = ${JSON.stringify(BRAND)};
  var SCOPES = ['errint','errext'];
  function panel(scope){ return document.getElementById('panel-'+scope); }
  function boxes(scope){ var p=panel(scope); return p? p.querySelectorAll('.pickbox') : []; }
  function picked(scope){ var b=boxes(scope), o=[]; for(var i=0;i<b.length;i++){ if(b[i].checked) o.push(b[i]); } return o; }
  function bar(scope){ var p=panel(scope); return p? p.querySelector('.exportbar') : null; }
  function dlName(){ var b=ALLOWLIST.split('/').pop().replace(/\\.[^.]*$/,''); return (b||'crawl-allowlist')+'.append.txt'; }
  function refresh(scope){
    var all=boxes(scope), n=picked(scope).length, b=bar(scope); if(!b) return;
    var c=b.querySelector('.selcount'); if(c){ c.textContent=n+' selected'; }
    var btns=b.querySelectorAll('.btn'); for(var i=0;i<btns.length;i++){ btns[i].disabled=(n===0); }
    var pa=document.querySelector('.pickall[data-scope="'+scope+'"]');
    if(pa){ pa.checked=(n>0&&n===all.length); pa.indeterminate=(n>0&&n<all.length); }
  }
  function text(scope){
    var sel=picked(scope), out=[];
    out.push('# '+BRAND+' — allowlist appendage from crawl of '+HOST);
    out.push('# generated '+new Date().toISOString()+' — '+sel.length+' link(s)');
    out.push('# append to '+ALLOWLIST+' to suppress these in future scans, e.g.:');
    out.push('#   cat '+dlName()+' >> '+ALLOWLIST);
    out.push('#   ( *=wildcard   #=comment   blank lines ignored )');
    out.push('#');
    for(var i=0;i<sel.length;i++){
      out.push(sel[i].getAttribute('data-url')+'   # '+sel[i].getAttribute('data-reason')+' — found on: '+sel[i].getAttribute('data-source'));
    }
    return out.join('\\n')+'\\n';
  }
  function toast(msg){
    var t=document.getElementById('cw-toast');
    if(!t){ t=document.createElement('div'); t.id='cw-toast'; t.className='toast'; document.body.appendChild(t); }
    t.textContent=msg; t.className='toast show';
    setTimeout(function(){ t.className='toast'; }, 2400);
  }
  function doExport(scope){
    var txt=text(scope), name=dlName(), n=picked(scope).length;
    try{
      var blob=new Blob([txt],{type:'text/plain;charset=utf-8'}), url=URL.createObjectURL(blob);
      var a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click();
      setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
      toast('Exported '+n+' link(s) → '+name);
    }catch(e){ toast('Export failed'); }
  }
  function doCopy(scope){
    var txt=text(scope), n=picked(scope).length;
    function ok(){ toast('Copied '+n+' line(s) to clipboard'); }
    function legacy(){ var ta=document.createElement('textarea'); ta.value=txt; ta.style.position='fixed'; ta.style.opacity='0'; document.body.appendChild(ta); ta.focus(); ta.select(); var good=false; try{ good=document.execCommand('copy'); }catch(e){} document.body.removeChild(ta); good?ok():toast('Copy failed — use Export'); }
    if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt).then(ok,legacy); } else { legacy(); }
  }
  function wire(scope){
    var all=boxes(scope); if(!all.length) return;
    for(var i=0;i<all.length;i++){ all[i].addEventListener('change', function(){ refresh(scope); }); }
    var pa=document.querySelector('.pickall[data-scope="'+scope+'"]');
    if(pa){ pa.addEventListener('change', function(){ var b=boxes(scope); for(var k=0;k<b.length;k++){ b[k].checked=pa.checked; } refresh(scope); }); }
    var b=bar(scope); if(b){ var ex=b.querySelector('.exportbtn'), cp=b.querySelector('.copybtn');
      if(ex){ ex.addEventListener('click', function(){ doExport(scope); }); }
      if(cp){ cp.addEventListener('click', function(){ doCopy(scope); }); } }
    refresh(scope);
  }
  for(var i=0;i<SCOPES.length;i++){ wire(SCOPES[i]); }
})();
</script>
</body></html>`;
}

// Write the report HTML and (optionally) JSON from current state. Used both for
// periodic checkpoints (partial=true) and the final write (partial=false).
function writeOutputs(state, cfg, allow, partial) {
  fs.writeFileSync(cfg.out, buildReport(state, cfg, allow, partial));
  if (cfg.json) {
    const suppressed = [], active = [];
    for (const e of state.errors) (allow.some((re) => re.test(e.url)) ? suppressed : active).push(e);
    const refsOf = (url) => { const s = state.refs.get(url); return s ? [...s] : []; };
    const errOut = (e) => ({ url: e.url, reason: e.reason, kind: e.kind || "internal", foundOn: refsOf(e.url).length ? refsOf(e.url) : (e.source ? [e.source] : []) });
    fs.writeFileSync(cfg.json, JSON.stringify({
      crawledAt: state.startedAt, partial: !!partial, scope: state.pathPrefix || "(whole domain)",
      log: { manifest: state.logManifest || "", singleFile: !!state.logSingleFile, parts: state.logParts || [] },
      summary: { pagesCrawled: state.pages.length, queued: state.queue.length, externalLinks: state.external.size, outOfScope: state.outOfScope.size, errorsInternal: active.filter((e) => (e.kind || "internal") !== "external").length, errorsExternal: active.filter((e) => e.kind === "external").length, blocked: (state.blocked || []).length, suppressed: suppressed.length },
      internalPages: state.pages,
      externalLinks: [...state.external.values()].map((e) => ({ url: e.url, host: e.host, status: e.status, foundOn: refsOf(e.url) })),
      outOfScopeLinks: [...state.outOfScope.values()].map((e) => ({ url: e.url, foundOn: refsOf(e.url) })),
      errors: active.map(errOut), suppressedErrors: suppressed.map(errOut),
      blocked: (state.blocked || []).map((e) => ({ url: e.url, reason: e.reason, kind: e.kind || "internal", foundOn: refsOf(e.url).length ? refsOf(e.url) : (e.source ? [e.source] : []) })),
    }, null, 2));
  }
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
function buildIndexReport(sites, cfg, allow, partial, startedAt) {
  const esc2 = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const done = sites.filter((s) => s.state && !s.partial).length;
  const cards = sites.map((s, i) => {
    const st = s.state;
    let status, body;
    if (!st) { status = `<span class="pill skip">queued</span>`; body = `<p class="muted">Not started yet.</p>`; }
    else {
      const supp = [], act = [];
      for (const e of st.errors) (allow.some((re) => re.test(e.url)) ? supp : act).push(e);
      const ei = act.filter((e) => (e.kind || "internal") !== "external").length;
      const ee = act.filter((e) => e.kind === "external").length;
      const bl = (st.blocked || []).length;
      status = s.partial ? `<span class="pill warn">crawling…</span>` : `<span class="pill ok">done</span>`;
      const file = s.reportFile.split(/[\\/]/).pop();
      body = `<div class="nums"><span><b>${st.pages.length}</b> pages</span><span><b>${st.external.size}</b> external</span><span class="${ei ? "bad" : ""}"><b>${ei}</b> internal errors</span><span class="${ee ? "bad" : ""}"><b>${ee}</b> external errors</span><span><b>${bl}</b> blocked</span></div>
        <p><a href="${esc2(file)}">Open ${esc2(s.host)} report →</a></p>`;
    }
    return `<div class="card"><h2>${i + 1}. ${esc2(s.host)} ${status}</h2><p class="muted">${esc2(s.url)}</p>${body}</div>`;
  }).join("");
  const refresh = partial ? `<script>(function(){var I=2500,a=(new Date()).getTime();function b(){a=(new Date()).getTime();}['mousemove','mousedown','keydown','wheel','touchstart','scroll'].forEach(function(e){document.addEventListener(e,b,true);});try{if('scrollRestoration' in history)history.scrollRestoration='manual';var y=localStorage.getItem('bfIdxY');if(y!==null)window.scrollTo(0,parseInt(y,10)||0);}catch(e){}window.addEventListener('scroll',function(){try{localStorage.setItem('bfIdxY',String(window.pageYOffset||0));}catch(e){}});function t(){var s='';try{s=window.getSelection?String(window.getSelection()):'';}catch(_){}if((new Date()).getTime()-a<I||s!==''){setTimeout(t,600);return;}location.reload();}setTimeout(t,5000);})();</script>` : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${partial ? "[crawling] " : ""}Crawl report — ${sites.length} sites</title>
<style>
 :root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--good:#4ade80;--bad:#f87171;--warn:#fbbf24;--border:#2c3340}
 *{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
 header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--panel)}header h1{margin:0 0 4px;font-size:20px}header p{margin:0;color:var(--muted);font-size:13px}
 main{max-width:1000px;margin:0 auto;padding:24px}.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:16px}
 h2{font-size:16px;margin:0 0 4px}.muted{color:var(--muted)}.bad b{color:var(--bad)}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
 .nums{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0}.nums b{color:var(--accent)}
 .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;vertical-align:middle}
 .pill.ok{background:rgba(74,222,128,.15);color:var(--good)}.pill.warn{background:rgba(251,191,36,.15);color:var(--warn)}.pill.skip{background:rgba(154,164,178,.15);color:var(--muted)}
</style></head><body>
<header><h1>Crawl report — ${sites.length} sites</h1><p>${esc2(startedAt)} · ${done}/${sites.length} done${partial ? " · crawling… (auto-updates)" : ""}</p></header>
<main>${cards}</main>
${refresh}
</body></html>`;
}

function writeCombinedJson(sites, cfg, allow) {
  const errOut = (st, e) => { const s = st.refs.get(e.url); return { url: e.url, reason: e.reason, kind: e.kind || "internal", foundOn: s ? [...s] : (e.source ? [e.source] : []) }; };
  const data = {
    crawledAt: new Date().toISOString(),
    sites: sites.map((s, i) => {
      const st = s.state;
      if (!st) return { url: s.url, host: s.host, status: "queued" };
      const supp = [], act = [];
      for (const e of st.errors) (allow.some((re) => re.test(e.url)) ? supp : act).push(e);
      return {
        url: s.url, host: s.host, status: s.partial ? "crawling" : "done", reportFile: s.reportFile.split(/[\\/]/).pop(),
        summary: { pagesCrawled: st.pages.length, externalLinks: st.external.size, errorsInternal: act.filter((e) => (e.kind || "internal") !== "external").length, errorsExternal: act.filter((e) => e.kind === "external").length, blocked: (st.blocked || []).length },
        errors: act.map((e) => errOut(st, e)),
        blocked: (st.blocked || []).map((e) => errOut(st, e)),
      };
    }),
  };
  fs.writeFileSync(cfg.json, JSON.stringify(data, null, 2));
}

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
    const siteCfg = Object.assign({}, cfg, { startUrl: sites[i].url, out: sites[i].reportFile, json: "" });
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
