#!/usr/bin/env node
"use strict";
/*
 * crawl-render.js — the real-browser companion to crawl.js (Chromium/Playwright)
 * ----------------------------------------------------------------------------
 * crawl.js is a STATIC crawler: it reads the bytes the server sends and never
 * runs JavaScript. That's fast and dependency-free, but it can't see anything a
 * page builds client-side. This tool is the rendering escalation, in two modes:
 *
 *   1. VERIFY (default) — re-check links crawl.js flagged as dead/blocked.
 *      crawl.js separates "blocked / uncertain" links from confirmed-dead ones;
 *      this re-opens each suspect in a REAL headless browser, which runs the
 *      page's JS and presents a genuine browser identity, and reports whether it
 *      actually resolves — clearing false positives (a JS challenge, a
 *      client-rendered page, a server that gates unknown clients).
 *
 *   2. DISCOVER (--discover) — map a site whose navigation is built by JavaScript
 *      (a single-page app: Laserfiche WebLink, SharePoint, most modern doc
 *      portals). crawl.js stalls on these because the folder/links it would
 *      follow aren't in the static HTML — they're injected after an XHR. This
 *      mode renders each page, waits for the JS to settle, harvests the links
 *      from the LIVE DOM, and recurses the in-scope folder tree, then emits a
 *      flat seeds file you hand back to crawl.js (`--seeds`) for its verifying,
 *      document-scanning report. Render to find the links; let crawl.js do the
 *      rest.
 *
 * Neither mode defeats protection (no faked input, no fingerprint spoofing). If
 * a site refuses an honest, rendered browser, that's reported as blocked.
 *
 * Playwright is an OPTIONAL dependency, kept out of crawl.js so that stays
 * zero-dependency. Install once:
 *
 *     npm i playwright
 *     # then either let Playwright download Chromium:
 *     npx playwright install chromium
 *     # …or skip the download and use the Chrome you already have:
 *     node crawl-render.js ... --channel chrome
 *
 * Usage:
 *     node crawl-render.js --from-json crawl-report.json        # verify suspects
 *     node crawl-render.js https://a/page https://b/page ...    # verify specific URLs
 *     node crawl-render.js --discover https://site/ --seeds seeds.txt   # map a JS site
 *
 * Without a browser available you can still run --http-fallback: in VERIFY it's
 * a plain HTTP re-check; in DISCOVER it's a STATIC harvest (no JS) — same blind
 * spot as crawl.js, useful only to sanity-check the pipeline or on a non-JS site.
 */

const fs = require("fs");
const http = require("http");
const https = require("https");

const NAV_TIMEOUT = 30000;

// ----------------------------- args -----------------------------
function parseArgs(argv) {
  const cfg = {
    urls: [],            // explicit URLs on the command line
    fromJson: "",        // pull suspects from a crawl.js JSON report
    list: "",            // newline-delimited URL file
    which: "both",       // which buckets from --from-json: blocked | broken | both
    out: "crawl-render.json",
    html: "",            // optional self-contained HTML report
    timeout: NAV_TIMEOUT,
    delay: 500,          // pause between checks (politeness); single-threaded by default
    concurrency: 1,
    waitUntil: "domcontentloaded",  // load | domcontentloaded | networkidle | commit
    channel: "",         // Playwright browser channel, e.g. "chrome" / "msedge"
    browserPath: "",     // explicit browser executable path
    userAgent: "",       // override; default is the real browser's own UA
    headful: false,      // show the window (debugging)
    httpFallback: false, // no browser: plain HTTP re-check instead
    apply: "",           // rewrite this crawl JSON, clearing now-reachable links
    // ---- discover mode (--discover): render-to-find a JS-built site's links ----
    discover: false,     // switch from verify to discover
    seeds: "",           // discover output: newline-delimited URLs for crawl.js --seeds
    scope: "domain",     // domain = whole host | path = under the seed's path
    pathPrefix: "",      // explicit path prefix to confine discovery to (implies path scope)
    includeSubdomains: false, // treat subdomains of the seed host as internal
    maxPages: 200,       // cap on pages actually rendered (Infinity = unlimited)
    maxDepth: 8,         // cap on folder-tree link depth from the seed (Infinity = unlimited)
    settle: 0,           // extra ms to wait after load, for late XHR-driven rendering
    onclickScan: true,   // also harvest URL-ish onclick/data-* attributes (browser mode)
    ignoreCase: false,   // dedup URLs case-insensitively + sort query params (IIS/ASP.NET sites)
    waitUntilSet: false, // did the user pass --wait-until explicitly?
    outSet: false,       // did the user pass --out explicitly?
  };
  const num = (v, n) => { const x = Number(v); if (!Number.isFinite(x)) die("Invalid number for " + n + ": " + v); return x; };
  // Caps that accept 'none'/'unlimited'/'-1' = Infinity, mirroring crawl.js.
  const cap = (v, n) => { if (/^(none|unlimited|all|inf|infinity)$/i.test(v) || Number(v) < 0) return Infinity; return Math.max(0, num(v, n)); };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const arg = a[i];
    const next = () => { const v = a[++i]; if (v === undefined) die("Missing value for " + arg); return v; };
    switch (arg) {
      case "-h": case "--help": printHelp(); process.exit(0); break;
      case "--from-json": cfg.fromJson = next(); break;
      case "--list": cfg.list = next(); break;
      case "--which": {
        const w = next().toLowerCase();
        if (w !== "blocked" && w !== "broken" && w !== "both") die("--which must be blocked, broken, or both");
        cfg.which = w; break;
      }
      case "--out": cfg.out = next(); cfg.outSet = true; break;
      case "--html": cfg.html = next(); break;
      case "--timeout": cfg.timeout = Math.max(1000, num(next(), arg)); break;
      case "--delay": cfg.delay = Math.max(0, num(next(), arg)); break;
      case "--concurrency": cfg.concurrency = Math.max(1, Math.min(8, num(next(), arg))); break;
      case "--wait-until": {
        const w = next().toLowerCase();
        if (!["load", "domcontentloaded", "networkidle", "commit"].includes(w)) die("--wait-until must be load, domcontentloaded, networkidle, or commit");
        cfg.waitUntil = w; cfg.waitUntilSet = true; break;
      }
      case "--discover": cfg.discover = true; break;
      case "--seeds": cfg.seeds = next(); break;
      case "--scope": {
        const sv = next().toLowerCase();
        if (sv !== "domain" && sv !== "path") die("--scope must be 'domain' or 'path'");
        cfg.scope = sv; break;
      }
      case "--path-prefix": cfg.pathPrefix = next(); cfg.scope = "path"; break;
      case "--include-subdomains": cfg.includeSubdomains = true; break;
      case "--max-pages": cfg.maxPages = cap(next(), arg); break;
      case "--max-depth": cfg.maxDepth = cap(next(), arg); break;
      case "--settle": cfg.settle = Math.max(0, num(next(), arg)); break;
      case "--no-onclick-scan": cfg.onclickScan = false; break;
      case "--ignore-case": cfg.ignoreCase = true; break;
      case "--channel": cfg.channel = next(); break;
      case "--browser-path": cfg.browserPath = next(); break;
      case "--user-agent": cfg.userAgent = next(); break;
      case "--headful": cfg.headful = true; break;
      case "--http-fallback": cfg.httpFallback = true; break;
      case "--apply": cfg.apply = next(); break;
      default:
        if (arg.startsWith("-")) die("Unknown option: " + arg);
        else cfg.urls.push(arg);
    }
  }
  // Discover-mode defaults: a JS site needs its XHR to land before we read the
  // DOM, so prefer networkidle unless the user chose a wait; and keep discover's
  // manifest/seeds out of the verify-mode default filename.
  if (cfg.discover) {
    if (!cfg.waitUntilSet) cfg.waitUntil = "networkidle";
    if (!cfg.outSet) cfg.out = "crawl-render.discover.json";
    if (!cfg.seeds) cfg.seeds = "crawl-render.seeds.txt";
  }
  return cfg;
}

function die(msg) { console.error("Error: " + msg + "\n"); printHelp(); process.exit(1); }
function printHelp() {
  console.log(`
crawl-render.js — the real-browser companion to crawl.js (two modes)

  VERIFY (default):  re-check links crawl.js flagged as dead/blocked
    node crawl-render.js [--from-json FILE | --list FILE | <url>...] [options]

  DISCOVER (--discover):  map a JS-built site and emit seeds for crawl.js
    node crawl-render.js --discover <url>... [--seeds FILE] [options]

Verify sources (combine freely; duplicates are de-duped):
  --from-json FILE   Pull links to re-check from a crawl.js JSON report.
                     Uses the 'blocked' and/or 'errors' buckets (per --which).
                     Understands single-site and combined multi-site JSON.
  --list FILE        Newline-delimited URLs ('#' comments / blanks ignored).
  <url>...           One or more URLs given directly.
  --which WHICH      From --from-json, which buckets: blocked | broken | both
                                                        (default both)

Discover (--discover) — render a JS site and harvest its real links:
  <url>... | --list  One or more SEED URLs to start from.
  --seeds FILE       Write the discovered URLs (in-scope pages + documents),
                     one per line, for  node crawl.js --seeds FILE
                                                  (default crawl-render.seeds.txt)
  --scope domain|path   Confine discovery to the whole host, or to the seed
                     URL's path subsection                 (default domain)
  --path-prefix STR  Confine discovery to this path prefix (implies --scope path)
  --include-subdomains  Treat subdomains of the seed host as internal
  --max-pages N      Max pages to RENDER, 'none'/-1 = unlimited  (default 200)
  --max-depth N      Max folder-tree depth from the seed, 'none'/-1 = unlimited
                                                              (default 8)
  --settle MS        Extra wait after load for late XHR-driven rendering
                                                              (default 0)
  --no-onclick-scan  Don't harvest URL-ish onclick/data-* attributes (on by
                     default; helps SPAs whose entries navigate via JS handlers)
  --ignore-case      De-dupe URLs case-insensitively: treat paths differing only
                     in capitalization, or query strings differing only in
                     parameter order, as one page — so /Browse.aspx and
                     /browse.aspx aren't rendered twice. For IIS/ASP.NET sites
                     (Laserfiche WebLink, SharePoint). Off by default (unsafe on
                     case-sensitive servers).
  In discover mode --wait-until defaults to 'networkidle' and --out defaults to
  crawl-render.discover.json (a full JSON manifest of pages/documents/links).

Browser:
  --channel NAME     Use an installed browser channel instead of Playwright's
                     bundled Chromium — e.g. 'chrome' or 'msedge'. Avoids the
                     'playwright install' download if you already have Chrome.
  --browser-path P   Explicit browser executable to launch.
  --user-agent STR   Override the User-Agent (default: the browser's own).
  --wait-until WHEN  load | domcontentloaded | networkidle | commit (default
                     domcontentloaded)
  --headful          Show the browser window (for debugging).
  --http-fallback    No browser: do a plain HTTP re-check (HEAD→GET). Mainly for
                     environments with no browser installed.

Pacing (polite by default — this is verification, not scraping):
  --concurrency N    Pages checked at once, 1-8                 (default 1)
  --delay MS         Pause between checks                       (default 500)
  --timeout MS       Per-navigation timeout                     (default 30000)

Output:
  --out FILE         JSON verdicts                       (default crawl-render.json)
  --html FILE        Also write a self-contained HTML summary
  --apply FILE       Rewrite this crawl JSON in place, removing links now
                     confirmed reachable and moving error→blocked as warranted
  -h, --help         Show this help

Setup:
  npm i playwright && npx playwright install chromium
  (or use --channel chrome with an existing Chrome install)
`);
}

// ----------------------------- input gathering -----------------------------
// Collect {url, kind, was} suspects from all sources, de-duped by URL.
function gatherSuspects(cfg) {
  const out = [];
  const seen = new Set();
  const add = (url, kind, was) => {
    if (!url || seen.has(url)) return;
    try { const u = new URL(url); if (u.protocol !== "http:" && u.protocol !== "https:") return; } catch { return; }
    seen.add(url);
    out.push({ url, kind: kind || "unknown", was: was || "" });
  };

  for (const u of cfg.urls) add(u, "cli", "");

  if (cfg.list) {
    let txt = "";
    try { txt = fs.readFileSync(cfg.list, "utf8"); } catch { die("Can't read --list file: " + cfg.list); }
    for (const raw of txt.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, "").trim();
      if (line) add(line, "list", "");
    }
  }

  if (cfg.fromJson) {
    let data;
    try { data = JSON.parse(fs.readFileSync(cfg.fromJson, "utf8")); } catch (e) { die("Can't read/parse --from-json: " + (e.message || e)); }
    const wantBlocked = cfg.which === "blocked" || cfg.which === "both";
    const wantBroken = cfg.which === "broken" || cfg.which === "both";
    // A "site" object is either the top-level (single-site) report or one entry
    // of a combined report's `sites` array — both expose errors/blocked arrays.
    const pull = (site) => {
      if (wantBroken && Array.isArray(site.errors)) for (const e of site.errors) add(e.url, "error:" + (e.kind || "internal"), e.reason || "");
      if (wantBlocked && Array.isArray(site.blocked)) for (const b of site.blocked) add(b.url, "blocked:" + (b.kind || "internal"), b.reason || "");
    };
    if (Array.isArray(data.sites)) data.sites.forEach(pull); else pull(data);
  }

  return out;
}

// ----------------------------- classification -----------------------------
// Shared with crawl.js's spirit: ok (reachable) / broken (confirmed dead) /
// blocked (the check was refused or inconclusive — likely fine in a browser).
const CHALLENGE_RE = /just a moment|attention required|checking your browser|verify you are human|cf-browser-verification|please wait while|ddos protection|access denied|are you a robot/i;

function classify(status, err, title) {
  if (title && CHALLENGE_RE.test(title)) return { disp: "blocked", note: "challenge/interstitial: " + title.trim().slice(0, 80) };
  if (status >= 200 && status < 400) return { disp: "ok", note: "HTTP " + status };
  if (status === 404 || status === 410) return { disp: "broken", note: "HTTP " + status };
  if (status === 401 || status === 403 || status === 405 || status === 406 ||
      status === 408 || status === 409 || status === 429 || status === 451 ||
      status === 999 || (status >= 500 && status <= 599)) return { disp: "blocked", note: "HTTP " + status };
  if (status === 0) {
    const e = (err || "").toLowerCase();
    if (/timeout|timed out/.test(e)) return { disp: "blocked", note: "timeout" };
    // Genuinely-dead signals: DNS, refused, unreachable, TLS/cert failures.
    if (/name_not_resolved|enotfound|connection_refused|econnrefused|connection_closed|address_unreachable|ehostunreach|enetunreach|ssl|cert|err_cert|certificate/.test(e))
      return { disp: "broken", note: err || "no response" };
    // Unknown navigation failure → uncertain, not confirmed dead.
    return { disp: "blocked", note: err || "no response" };
  }
  if (status === 400) return { disp: "broken", note: "HTTP 400" };
  return { disp: "broken", note: "HTTP " + status };
}

// ----------------------------- discover helpers -----------------------------
// Pure URL classification for discover mode, exported for testing.

// Page chrome we never record or follow: stylesheets, scripts, fonts, icons.
const ASSET_EXT_RE = /\.(css|js|mjs|map|png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot)(\?|#|$)/i;
// Document payload — the leaves a doc portal exists to serve. Recorded, not
// recursed. (Mirrors crawl.js's doc-scanning targets, plus common archives.)
const DOC_EXT_RE = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|csv|tsv|txt|zip|7z|rar|gz|bz2|tar|tiff?)(\?|#|$)/i;

function isAsset(pathname) { return ASSET_EXT_RE.test(pathname || ""); }
function looksLikeDocument(pathname) { return DOC_EXT_RE.test(pathname || ""); }

// Keep a URL fragment only when it carries SPA routing state (#/, #!, #?, or a
// key=value), so e.g. WebLink's `…#?id=42` stays distinct per folder while a
// plain `#section` anchor collapses to the same page. crawl.js can't make this
// distinction (it drops all fragments) — which is part of why it stalls on SPAs.
function keepFragment(hash) {
  if (!hash || hash === "#") return false;
  return /^#[!/?]/.test(hash) || hash.includes("=");
}

// Canonical dedup key for a URL object: lowercased host, no default port, and a
// fragment kept only if it routes (keepFragment). Used so the same page seen via
// different casings/ports/anchors isn't rendered twice. With opts.ignoreCase, the
// path is also lowercased and query params sorted, so an IIS/ASP.NET site's
// /Browse.aspx?b=2&a=1 and /browse.aspx?a=1&b=2 collapse to one render. This only
// shapes the dedup KEY — the original-cased URL is still what gets fetched/recorded.
function canonicalize(u, opts) {
  let url;
  try { url = new URL(u.href || u); } catch { return String(u); }
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) url.port = "";
  if (!keepFragment(url.hash)) url.hash = "";
  if (opts && opts.ignoreCase) { url.pathname = url.pathname.toLowerCase(); url.searchParams.sort(); }
  return url.href;
}

// Is `host` the seed host (or a subdomain of it, when allowed)?
function hostMatches(host, startHost, includeSubdomains) {
  host = (host || "").toLowerCase(); startHost = (startHost || "").toLowerCase();
  if (host === startHost) return true;
  return !!includeSubdomains && host.endsWith("." + startHost);
}

// In-scope = internal AND (whole-domain scope, or path under the confining
// prefix). The prefix defaults to the seed URL's own directory.
function inScope(u, start, scope, pathPrefix) {
  if (scope !== "path") return true;
  let prefix = pathPrefix || start.pathname;
  if (!prefix.endsWith("/")) prefix = prefix.replace(/[^/]*$/, ""); // seed file -> its folder
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  const p = u.pathname || "/";
  return p === prefix.replace(/\/$/, "") || p.startsWith(prefix);
}

// Best-effort: pull URL-ish tokens out of an onclick="…"/data-* string, for SPA
// entries that navigate via a JS handler rather than a plain href. Resolved and
// scope-filtered by the caller, so over-capture here is harmless noise.
function scanUrlish(s) {
  const out = [];
  if (!s) return out;
  const re = /(https?:\/\/[^\s'"()<>]+|\/[A-Za-z0-9_][^\s'"()<>]*|[A-Za-z0-9_./-]+\.aspx[^\s'"()<>]*)/gi;
  let m;
  while ((m = re.exec(s))) { const t = m[0].replace(/[).,;'"]+$/, ""); if (t.length > 1) out.push(t); }
  return out;
}

// Merge a harvest observation into a deduped list of absolute http(s) URLs:
// the live-DOM <a href> set (already absolute) plus any onclick/data-* tokens,
// each resolved against the page's final URL.
function collectLinks(obs, baseUrl) {
  const base = obs.finalUrl || baseUrl;
  const seen = new Set(), out = [];
  const add = (raw) => {
    if (!raw) return;
    let u; try { u = new URL(raw, base); } catch { return; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    if (!seen.has(u.href)) { seen.add(u.href); out.push(u.href); }
  };
  for (const l of obs.domLinks || []) add(l);
  for (const s of obs.rawAttrs || []) for (const t of scanUrlish(s)) add(t);
  return out;
}

// Minimal static <a href> extraction for the no-browser fallback, mirroring
// src/parse.js: decode entities, skip #/javascript:/mailto: etc. Returns absolute.
function staticHrefs(html, base) {
  const src = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
  const out = [];
  const dec = (s) => s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|nbsp);/gi, (w, e) => {
    if (e[0] === "#") { const c = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) ? String.fromCharCode(c) : w; }
    return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " })[e.toLowerCase()] || w;
  });
  const re = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/gi;
  let m;
  while ((m = re.exec(src))) {
    const raw = dec((m[2] ?? m[3] ?? m[4] ?? "").trim());
    if (!raw || raw.startsWith("#") || /^(javascript:|mailto:|tel:|data:)/i.test(raw)) continue;
    out.push(raw);
  }
  return out;
}

// ----------------------------- drivers -----------------------------
// A driver checks one URL and returns {status, err, title, finalUrl}.

// Real headless browser via Playwright. Lazy-required so the tool loads (and
// --help / --http-fallback work) even when Playwright isn't installed.
async function makeBrowserDriver(cfg) {
  let playwright;
  // Resolve Playwright from the script's location first (the usual case: it's in
  // a node_modules above tools/), then fall back to the current directory, so it
  // works whether `npm i playwright` was run in the repo root or where you stand.
  try { playwright = require("playwright"); }
  catch {
    try { playwright = require(require("path").join(process.cwd(), "node_modules", "playwright")); }
    catch {
      throw new Error(
        "Playwright isn't installed (looked in this script's folder and " + process.cwd() + ").\n" +
        "  Install it with:  npm i playwright && npx playwright install chromium\n" +
        "  or use a browser you already have:  --channel chrome\n" +
        "  or run a plain HTTP re-check (no rendering):  --http-fallback"
      );
    }
  }
  const launchOpts = { headless: !cfg.headful };
  if (cfg.channel) launchOpts.channel = cfg.channel;
  if (cfg.browserPath) launchOpts.executablePath = cfg.browserPath;
  let browser;
  try { browser = await playwright.chromium.launch(launchOpts); }
  catch (e) {
    throw new Error(
      "Couldn't launch a browser: " + (e.message || e) + "\n" +
      "  If Chromium isn't downloaded, run:  npx playwright install chromium\n" +
      "  or point at an installed browser:   --channel chrome  (or --browser-path)"
    );
  }
  const ctxOpts = { ignoreHTTPSErrors: true };
  if (cfg.userAgent) ctxOpts.userAgent = cfg.userAgent;
  const context = await browser.newContext(ctxOpts);

  return {
    label: "chromium" + (cfg.channel ? " (" + cfg.channel + ")" : ""),
    async check(url) {
      const page = await context.newPage();
      let status = 0, err = null, title = "", finalUrl = url;
      try {
        const resp = await page.goto(url, { waitUntil: cfg.waitUntil, timeout: cfg.timeout });
        status = resp ? resp.status() : 0;
        finalUrl = page.url();
        try { title = await page.title(); } catch { /* ignore */ }
      } catch (e) {
        err = String(e && e.message || e);
        // A navigation can throw after a response is known (e.g. slow subresource
        // timeout); try to recover the status/title we did get.
        try { const r = page.url(); if (r) finalUrl = r; } catch { /* ignore */ }
        try { title = await page.title(); } catch { /* ignore */ }
      } finally {
        try { await page.close(); } catch { /* ignore */ }
      }
      return { status, err, title, finalUrl };
    },
    // Discover: render the page, let its JS settle, then read links from the LIVE
    // DOM (so JS-injected nav is captured). Harvest even if navigation throws —
    // a networkidle/subresource timeout still leaves a usable rendered document.
    async harvest(url) {
      const page = await context.newPage();
      let status = 0, err = null, title = "", finalUrl = url, domLinks = [], rawAttrs = [];
      try {
        const resp = await page.goto(url, { waitUntil: cfg.waitUntil, timeout: cfg.timeout });
        status = resp ? resp.status() : 0;
      } catch (e) { err = String(e && e.message || e); }
      if (cfg.settle) { try { await page.waitForTimeout(cfg.settle); } catch { /* ignore */ } }
      try { finalUrl = page.url(); } catch { /* ignore */ }
      try { title = await page.title(); } catch { /* ignore */ }
      try { domLinks = await page.$$eval("a[href]", (as) => as.map((a) => a.href).filter(Boolean)); } catch { /* ignore */ }
      if (cfg.onclickScan) {
        try {
          rawAttrs = await page.evaluate(() => {
            const acc = [];
            for (const el of document.querySelectorAll("[onclick],[data-href],[data-url],[data-link],[data-id]")) {
              for (const a of ["onclick", "data-href", "data-url", "data-link", "data-id"]) {
                const v = el.getAttribute && el.getAttribute(a);
                if (v) acc.push(v);
              }
            }
            return acc;
          });
        } catch { /* ignore */ }
      }
      try { await page.close(); } catch { /* ignore */ }
      return { status, err, title, finalUrl, domLinks, rawAttrs };
    },
    async close() { try { await context.close(); } catch { /* ignore */ } try { await browser.close(); } catch { /* ignore */ } },
  };
}

// Plain-HTTP fallback (no rendering): HEAD, then GET when HEAD is inconclusive.
function rawStatus(target, method, cfg, redirects = 0) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(target); } catch { return resolve({ status: 0, err: "bad URL", finalUrl: target }); }
    if (u.protocol !== "http:" && u.protocol !== "https:") return resolve({ status: 0, err: "unsupported protocol", finalUrl: target });
    const lib = u.protocol === "https:" ? https : http;
    const headers = { "User-Agent": cfg.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" };
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = lib.request(u, { method, headers }, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && redirects < 5) {
        res.resume();
        let nextUrl;
        try { nextUrl = new URL(res.headers.location, u).href; } catch { return finish({ status: 0, err: "bad redirect", finalUrl: u.href }); }
        return finish(rawStatus(nextUrl, method, cfg, redirects + 1));
      }
      res.resume();
      finish({ status: code, err: null, finalUrl: u.href });
    });
    req.setTimeout(cfg.timeout, () => req.destroy(new Error("timeout")));
    req.on("error", (e) => finish({ status: 0, err: String(e && e.message || e), finalUrl: u.href }));
    req.end();
  });
}
// GET a page and return its body (capped), following redirects — for the
// no-browser discover fallback, which harvests static <a href> only.
function rawGetBody(target, cfg, redirects = 0) {
  const MAX = 5 * 1024 * 1024;
  return new Promise((resolve) => {
    let u;
    try { u = new URL(target); } catch { return resolve({ status: 0, err: "bad URL", finalUrl: target, html: "", title: "" }); }
    if (u.protocol !== "http:" && u.protocol !== "https:") return resolve({ status: 0, err: "unsupported protocol", finalUrl: target, html: "", title: "" });
    const lib = u.protocol === "https:" ? https : http;
    const headers = { "User-Agent": cfg.userAgent || "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-US,en;q=0.9" };
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = lib.request(u, { method: "GET", headers }, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && redirects < 5) {
        res.resume();
        let nextUrl;
        try { nextUrl = new URL(res.headers.location, u).href; } catch { return finish({ status: 0, err: "bad redirect", finalUrl: u.href, html: "", title: "" }); }
        return finish(rawGetBody(nextUrl, cfg, redirects + 1));
      }
      const ct = res.headers["content-type"] || "";
      if (!/html|xml|text\//i.test(ct)) { res.resume(); return finish({ status: code, err: null, finalUrl: u.href, html: "", title: "" }); }
      const chunks = []; let total = 0;
      res.setEncoding("utf8");
      res.on("data", (d) => { total += d.length; if (total > MAX) { res.destroy(); return; } chunks.push(d); });
      res.on("end", () => { const html = chunks.join(""); const tm = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); finish({ status: code, err: null, finalUrl: u.href, html, title: tm ? tm[1].replace(/\s+/g, " ").trim() : "" }); });
    });
    req.setTimeout(cfg.timeout, () => req.destroy(new Error("timeout")));
    req.on("error", (e) => finish({ status: 0, err: String(e && e.message || e), finalUrl: u.href, html: "", title: "" }));
    req.end();
  });
}

function makeHttpDriver(cfg) {
  return {
    label: "http-fallback (no browser rendering)",
    async check(url) {
      let r = await rawStatus(url, "HEAD", cfg);
      const inconclusive = !!r.err || r.status === 0 || [400, 403, 405, 406, 429, 501].includes(r.status) || r.status >= 500;
      if (inconclusive) { const g = await rawStatus(url, "GET", cfg); if (g.status > 0) r = g; else if (r.status === 0) r.err = g.err || r.err; }
      return { status: r.status, err: r.err, title: "", finalUrl: r.finalUrl };
    },
    // Static harvest: GET the page and extract <a href> only. No JS runs, so this
    // sees exactly what crawl.js sees — useful to drive the pipeline on a
    // server-rendered site, not to map a true SPA.
    async harvest(url) {
      const r = await rawGetBody(url, cfg);
      return { status: r.status, err: r.err, title: r.title || "", finalUrl: r.finalUrl || url, domLinks: staticHrefs(r.html, r.finalUrl || url), rawAttrs: [] };
    },
    async close() { /* nothing */ },
  };
}

// ----------------------------- run -----------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(cfg) {
  const suspects = gatherSuspects(cfg);
  if (!suspects.length) die("No URLs to check. Provide --from-json, --list, or URLs.");

  const driver = cfg.httpFallback ? makeHttpDriver(cfg) : await makeBrowserDriver(cfg);
  console.log(`Re-checking ${suspects.length} link${suspects.length === 1 ? "" : "s"} via ${driver.label}…\n`);

  const results = new Array(suspects.length);
  let next = 0, doneN = 0;
  const counts = { ok: 0, broken: 0, blocked: 0 };

  async function worker() {
    while (next < suspects.length) {
      const idx = next++;
      const s = suspects[idx];
      let obs;
      try { obs = await driver.check(s.url); }
      catch (e) { obs = { status: 0, err: String(e && e.message || e), title: "", finalUrl: s.url }; }
      const c = classify(obs.status, obs.err, obs.title);
      counts[c.disp]++;
      results[idx] = {
        url: s.url, kind: s.kind, was: s.was,
        status: obs.status, disposition: c.disp, note: c.note,
        title: obs.title || "", finalUrl: obs.finalUrl || s.url,
      };
      doneN++;
      const mark = c.disp === "ok" ? "✓ reachable" : c.disp === "broken" ? "✗ dead     " : "? blocked  ";
      console.log(`  [${doneN}/${suspects.length}] ${mark}  ${s.url}${obs.status ? "  (HTTP " + obs.status + ")" : obs.err ? "  (" + obs.err.slice(0, 60) + ")" : ""}`);
      if (cfg.delay) await sleep(cfg.delay);
    }
  }
  await Promise.all(Array.from({ length: cfg.concurrency }, worker));
  await driver.close();

  const report = {
    renderedAt: new Date().toISOString(),
    driver: driver.label,
    source: cfg.fromJson || cfg.list || "(cli)",
    total: results.length,
    summary: counts,
    results,
  };
  fs.writeFileSync(cfg.out, JSON.stringify(report, null, 2));
  if (cfg.html) fs.writeFileSync(cfg.html, buildHtml(report));
  if (cfg.apply) applyToCrawlJson(cfg.apply, results);

  console.log(`\nDone. ${counts.ok} now reachable, ${counts.blocked} still blocked/uncertain, ${counts.broken} confirmed dead.`);
  console.log(`Report: ${cfg.out}${cfg.html ? "  ·  " + cfg.html : ""}`);
  if (counts.ok) console.log(`${counts.ok} link${counts.ok === 1 ? " was a" : "s were"} false positive${counts.ok === 1 ? "" : "s"} — it renders in a browser even though the simple check flagged it.`);
  return report;
}

// Reconcile a crawl.js JSON report with the render verdicts: drop links now
// confirmed reachable from errors/blocked, and move an error that's really just
// blocked into the blocked bucket. Writes the file back (a .bak is kept once).
function applyToCrawlJson(file, results) {
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { console.warn(`--apply: can't read/parse ${file}: ${e.message || e}`); return; }
  const verdict = new Map();
  for (const r of results) verdict.set(r.url, r.disposition);
  const sites = Array.isArray(data.sites) ? data.sites : [data];
  let cleared = 0, moved = 0;
  for (const site of sites) {
    const errs = Array.isArray(site.errors) ? site.errors : [];
    const blk = Array.isArray(site.blocked) ? site.blocked : (site.blocked = []);
    const keptErrs = [];
    for (const e of errs) {
      const v = verdict.get(e.url);
      if (v === "ok") { cleared++; continue; }
      if (v === "blocked") { blk.push(Object.assign({}, e, { reason: "blocked in browser (" + (e.reason || "") + ")" })); moved++; continue; }
      keptErrs.push(e);
    }
    if (Array.isArray(site.errors)) site.errors = keptErrs;
    if (Array.isArray(site.blocked)) site.blocked = blk.filter((b) => verdict.get(b.url) !== "ok");
    cleared += (Array.isArray(site.blocked) ? 0 : 0);
    if (site.summary) {
      if (typeof site.summary.errorsInternal === "number") site.summary.errorsInternal = keptErrs.filter((e) => (e.kind || "internal") !== "external").length;
      if (typeof site.summary.errorsExternal === "number") site.summary.errorsExternal = keptErrs.filter((e) => e.kind === "external").length;
      if (typeof site.summary.blocked === "number") site.summary.blocked = site.blocked.length;
    }
  }
  try { if (!fs.existsSync(file + ".bak")) fs.copyFileSync(file, file + ".bak"); } catch { /* ignore */ }
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
  console.log(`--apply: updated ${file} (cleared ${cleared} reachable, moved ${moved} error→blocked; backup at ${file}.bak)`);
}

// ----------------------------- html report -----------------------------
function buildHtml(report) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const link = (u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`;
  const pill = (d) => d === "ok" ? `<span class="pill ok">reachable</span>` : d === "broken" ? `<span class="pill bad">dead</span>` : `<span class="pill warn">blocked</span>`;
  const rows = report.results.map((r) =>
    `<tr><td>${pill(r.disposition)}</td><td>${link(r.url)}</td><td>${r.status || "—"}</td><td>${esc(r.note)}</td><td class="muted">${esc(r.kind)} · was: ${esc(r.was || "—")}</td></tr>`).join("");
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Browser re-check — ${report.total} links</title>
<style>
 :root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--good:#4ade80;--bad:#f87171;--warn:#fbbf24;--border:#2c3340}
 *{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
 header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--panel)}h1{margin:0 0 4px;font-size:18px}header p{margin:0;color:var(--muted);font-size:13px}
 main{max-width:1100px;margin:0 auto;padding:24px}
 .stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}
 .stat{background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px 16px;text-align:center;min-width:120px}.stat .n{font-size:24px;font-weight:700}.stat .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
 .stat.good .n{color:var(--good)}.stat.bad .n{color:var(--bad)}.stat.warn .n{color:var(--warn)}
 table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top;overflow-wrap:anywhere}
 th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
 a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}.muted{color:var(--muted)}
 .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600}.pill.ok{background:rgba(74,222,128,.15);color:var(--good)}.pill.bad{background:rgba(248,113,113,.15);color:var(--bad)}.pill.warn{background:rgba(251,191,36,.15);color:var(--warn)}
 .tablewrap{border:1px solid var(--border);border-radius:8px;overflow:auto}
</style></head><body>
<header><h1>Browser re-check</h1><p>${esc(report.renderedAt)} · via ${esc(report.driver)} · source: ${esc(report.source)}</p></header>
<main>
 <div class="stats">
  <div class="stat good"><div class="n">${report.summary.ok}</div><div class="l">Now reachable</div></div>
  <div class="stat warn"><div class="n">${report.summary.blocked}</div><div class="l">Still blocked</div></div>
  <div class="stat bad"><div class="n">${report.summary.broken}</div><div class="l">Confirmed dead</div></div>
 </div>
 <div class="tablewrap"><table><thead><tr><th>Verdict</th><th>URL</th><th>HTTP</th><th>Note</th><th>Origin</th></tr></thead><tbody>${rows}</tbody></table></div>
</main></body></html>`;
}

// ----------------------------- discover run -----------------------------
// Seeds come from CLI URLs + --list only (not --from-json, which is verify-mode).
function gatherSeeds(cfg) {
  const out = [], seen = new Set();
  const add = (u) => {
    if (!u || seen.has(u)) return;
    try { const x = new URL(u); if (x.protocol !== "http:" && x.protocol !== "https:") return; } catch { return; }
    seen.add(u); out.push(u);
  };
  for (const u of cfg.urls) add(u);
  if (cfg.list) {
    let txt = "";
    try { txt = fs.readFileSync(cfg.list, "utf8"); } catch { die("Can't read --list file: " + cfg.list); }
    for (const raw of txt.split(/\r?\n/)) { const line = raw.replace(/#.*$/, "").trim(); if (line) add(line); }
  }
  return out;
}

const fmtCap = (n) => (n === Infinity ? "unlimited" : String(n));

async function runDiscover(cfg) {
  const seeds = gatherSeeds(cfg);
  if (!seeds.length) die("discover: no seed URLs. Give a URL or --list FILE.");
  if (cfg.fromJson) console.warn("Note: --from-json is ignored in --discover mode (it expects seed URLs).\n");
  const start = new URL(seeds[0]);
  const driver = cfg.httpFallback ? makeHttpDriver(cfg) : await makeBrowserDriver(cfg);
  const canon = (u) => canonicalize(u, { ignoreCase: cfg.ignoreCase });  // dedup key honoring --ignore-case

  const seen = new Set();        // canonical keys already queued for rendering
  const renderedPages = [];      // {url,status,disposition,title,depth,links}
  const internal = new Map();    // canon -> {url, sources:Set, rendered, depth}  (in-scope HTML pages)
  const documents = new Map();   // canon -> {url, sources:Set}                   (payload leaves)
  const external = new Map();    // canon -> {url, sources:Set}
  const outOfScope = new Map();  // canon -> {url, sources:Set}                   (internal, off-path)
  const errors = [];             // {url, reason, source}
  const MAX_RECORD = 200000;     // memory backstop; reported, never silent
  let recordCapped = false;
  const recordRef = (map, u, src) => {
    const key = canon(u);
    let e = map.get(key);
    if (!e) { if (map.size >= MAX_RECORD) { recordCapped = true; return; } e = { url: u.href, sources: new Set() }; map.set(key, e); }
    if (src) e.sources.add(src);
  };

  // Seed frontier at depth 0; seeds are themselves in-scope pages.
  let frontier = [];
  for (const s of seeds) {
    const su = new URL(s), key = canon(su);
    if (!seen.has(key)) { seen.add(key); frontier.push({ url: su.href, depth: 0, key }); recordRef(internal, su, ""); }
  }

  console.log(`Discovering from ${seeds.length} seed${seeds.length === 1 ? "" : "s"} via ${driver.label}…`);
  console.log(`  scope=${cfg.scope}${cfg.scope === "path" ? " (" + (cfg.pathPrefix || start.pathname) + ")" : ""}  max-depth=${fmtCap(cfg.maxDepth)}  max-pages=${fmtCap(cfg.maxPages)}  wait=${cfg.waitUntil}\n`);

  let rendered = 0;
  while (frontier.length && rendered < cfg.maxPages) {
    const level = frontier;
    frontier = [];
    let idx = 0;
    const worker = async () => {
      while (idx < level.length && rendered < cfg.maxPages) {
        const job = level[idx++];
        let obs;
        try { obs = await driver.harvest(job.url); }
        catch (e) { obs = { status: 0, err: String(e && e.message || e), title: "", finalUrl: job.url, domLinks: [], rawAttrs: [] }; }
        rendered++;
        const c = classify(obs.status, obs.err, obs.title);
        const links = collectLinks(obs, job.url);
        renderedPages.push({ url: job.url, status: obs.status, disposition: c.disp, title: obs.title || "", depth: job.depth, links: links.length });
        const self = internal.get(job.key);
        if (self) { self.rendered = true; self.depth = job.depth; }
        if (c.disp === "broken") errors.push({ url: job.url, reason: c.note, source: job.depth === 0 ? "(seed)" : "(frontier)" });

        for (const href of links) {
          let u; try { u = new URL(href); } catch { continue; }
          if (isAsset(u.pathname)) continue;
          if (!hostMatches(u.hostname, start.hostname, cfg.includeSubdomains)) { recordRef(external, u, job.url); continue; }
          if (!inScope(u, start, cfg.scope, cfg.pathPrefix)) { recordRef(outOfScope, u, job.url); continue; }
          if (looksLikeDocument(u.pathname)) { recordRef(documents, u, job.url); continue; }
          // In-scope HTML page: record for the seeds payload; recurse if budget allows.
          recordRef(internal, u, job.url);
          const key = canon(u);
          if (!seen.has(key)) { seen.add(key); if (job.depth < cfg.maxDepth) frontier.push({ url: u.href, depth: job.depth + 1, key }); }
        }
        const mark = c.disp === "ok" ? "✓" : c.disp === "broken" ? "✗" : "?";
        console.log(`  [${rendered}${cfg.maxPages === Infinity ? "" : "/" + cfg.maxPages}] ${mark} d${job.depth}  ${job.url}  — ${links.length} link${links.length === 1 ? "" : "s"}${obs.status ? ", HTTP " + obs.status : obs.err ? ", " + obs.err.slice(0, 40) : ""}`);
        if (cfg.delay) await sleep(cfg.delay);
      }
    };
    await Promise.all(Array.from({ length: cfg.concurrency }, worker));
  }
  await driver.close();

  // Seeds for crawl.js = in-scope pages + documents, de-duped and sorted.
  const pageUrls = [...internal.values()].map((e) => e.url);
  const docUrls = [...documents.values()].map((e) => e.url);
  const seedUrls = [...new Set([...pageUrls, ...docUrls])].sort();
  const notRendered = [...internal.values()].filter((e) => !e.rendered).length;
  const ts = new Date().toISOString();

  const header = [
    `# ${seedUrls.length} URL(s) discovered by crawl-render.js --discover`,
    `# rendered ${renderedPages.length} page(s) from ${seeds[0]}${seeds.length > 1 ? ` (+${seeds.length - 1} more seed)` : ""} · ${ts}`,
    `# ${pageUrls.length} in-scope page(s) + ${docUrls.length} document(s) · scope=${cfg.scope}`,
    `# Hand to crawl.js (verify + scan these, don't re-crawl):`,
    `#   node crawl.js --seeds ${cfg.seeds} --max-depth 0 --check-external`,
    "",
  ].join("\n");
  fs.writeFileSync(cfg.seeds, header + seedUrls.join("\n") + (seedUrls.length ? "\n" : ""));

  const mapOut = (m) => [...m.values()].map((e) => ({ url: e.url, sources: [...e.sources] }));
  const report = {
    mode: "discover",
    renderedAt: ts,
    driver: driver.label,
    seeds,
    scope: cfg.scope === "path" ? { type: "path", prefix: cfg.pathPrefix || start.pathname } : { type: "domain", host: start.hostname },
    limits: { maxPages: cfg.maxPages === Infinity ? null : cfg.maxPages, maxDepth: cfg.maxDepth === Infinity ? null : cfg.maxDepth },
    summary: {
      rendered: renderedPages.length, internalPages: internal.size, documents: documents.size,
      externalLinks: external.size, outOfScope: outOfScope.size, errors: errors.length, seeds: seedUrls.length,
    },
    pages: renderedPages,
    documents: mapOut(documents),
    internalPages: mapOut(internal),
    external: mapOut(external),
    outOfScope: mapOut(outOfScope),
    errors,
  };
  fs.writeFileSync(cfg.out, JSON.stringify(report, null, 2));
  if (cfg.html) fs.writeFileSync(cfg.html, buildDiscoverHtml(report));

  console.log(`\nDiscovered ${internal.size} in-scope page(s), ${documents.size} document(s), ${external.size} external link(s).`);
  if (rendered >= cfg.maxPages && notRendered) console.log(`Stopped at --max-pages ${cfg.maxPages}: ${notRendered} discovered in-scope page(s) were not rendered (raise --max-pages / --max-depth to go further).`);
  else if (notRendered) console.log(`${notRendered} discovered in-scope page(s) were beyond --max-depth ${fmtCap(cfg.maxDepth)} and not rendered.`);
  if (recordCapped) console.log(`Note: hit the ${MAX_RECORD.toLocaleString()} URL record cap — some links beyond it were not recorded.`);
  if (driver.label.startsWith("http-fallback")) console.log(`(Static fallback: no JavaScript ran, so a true SPA's JS-built links were NOT seen — same blind spot as crawl.js.)`);
  console.log(`\nSeeds: ${cfg.seeds}  (${seedUrls.length} URL${seedUrls.length === 1 ? "" : "s"})  ·  Manifest: ${cfg.out}${cfg.html ? "  ·  " + cfg.html : ""}`);
  console.log(`Next:  node crawl.js --seeds ${cfg.seeds} --max-depth 0 --check-external   # verify the links + scan the documents`);
  return report;
}

// ----------------------------- discover html report -----------------------------
function buildDiscoverHtml(report) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const link = (u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`;
  const s = report.summary;
  const stat = (n, l, cls) => `<div class="stat ${cls || ""}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const docRows = report.documents.map((d) => `<tr><td>${link(d.url)}</td><td class="muted">${d.sources.length} page${d.sources.length === 1 ? "" : "s"}</td></tr>`).join("");
  const pageRows = report.pages.map((p) => {
    const pill = p.disposition === "ok" ? `<span class="pill ok">${p.status || "ok"}</span>` : p.disposition === "broken" ? `<span class="pill bad">${p.status || "dead"}</span>` : `<span class="pill warn">${p.status || "blocked"}</span>`;
    return `<tr><td>${pill}</td><td>d${p.depth}</td><td>${link(p.url)}</td><td>${p.links}</td><td class="muted">${esc(p.title)}</td></tr>`;
  }).join("");
  const scope = report.scope.type === "path" ? "path " + esc(report.scope.prefix) : "domain " + esc(report.scope.host);
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Discover — ${report.summary.documents} documents, ${report.summary.internalPages} pages</title>
<style>
 :root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--good:#4ade80;--bad:#f87171;--warn:#fbbf24;--border:#2c3340}
 *{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
 header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--panel)}h1{margin:0 0 4px;font-size:18px}header p{margin:0;color:var(--muted);font-size:13px}
 main{max-width:1100px;margin:0 auto;padding:24px}h2{font-size:14px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);margin:24px 0 8px}
 .stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:8px}
 .stat{background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px 16px;text-align:center;min-width:110px}.stat .n{font-size:24px;font-weight:700}.stat .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
 .stat.good .n{color:var(--good)}.stat.accent .n{color:var(--accent)}
 table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top;overflow-wrap:anywhere}
 th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
 a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}.muted{color:var(--muted)}
 .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600}.pill.ok{background:rgba(74,222,128,.15);color:var(--good)}.pill.bad{background:rgba(248,113,113,.15);color:var(--bad)}.pill.warn{background:rgba(251,191,36,.15);color:var(--warn)}
 .tablewrap{border:1px solid var(--border);border-radius:8px;overflow:auto}
</style></head><body>
<header><h1>Discover — rendered link map</h1><p>${esc(report.renderedAt)} · via ${esc(report.driver)} · scope: ${scope} · seed: ${esc(report.seeds[0])}</p></header>
<main>
 <div class="stats">
  ${stat(s.documents, "Documents", "good")}
  ${stat(s.internalPages, "In-scope pages", "accent")}
  ${stat(s.rendered, "Rendered")}
  ${stat(s.externalLinks, "External links")}
  ${stat(s.outOfScope, "Out of scope")}
  ${stat(s.errors, "Errors", s.errors ? "bad" : "")}
 </div>
 <p class="muted">Seeds written: ${s.seeds} URL(s) → feed to <code>node crawl.js --seeds …</code></p>
 <h2>Documents (${report.documents.length})</h2>
 <div class="tablewrap"><table><thead><tr><th>URL</th><th>Found on</th></tr></thead><tbody>${docRows || `<tr><td colspan="2" class="muted">No documents found.</td></tr>`}</tbody></table></div>
 <h2>Rendered pages (${report.pages.length})</h2>
 <div class="tablewrap"><table><thead><tr><th>Status</th><th>Depth</th><th>URL</th><th>Links</th><th>Title</th></tr></thead><tbody>${pageRows}</tbody></table></div>
</main></body></html>`;
}

// ----------------------------- main -----------------------------
if (require.main === module) {
  const cfg = parseArgs(process.argv);
  const fn = cfg.discover ? runDiscover : run;
  fn(cfg).catch((e) => { console.error("\nError: " + (e && e.message || e)); process.exit(1); });
}

module.exports = {
  classify, gatherSuspects, gatherSeeds, buildHtml, buildDiscoverHtml, applyToCrawlJson, makeHttpDriver, parseArgs,
  runDiscover, canonicalize, keepFragment, inScope, hostMatches, isAsset, looksLikeDocument, scanUrlish, collectLinks, staticHrefs,
};
