#!/usr/bin/env node
"use strict";
/*
 * crawl-render.js — headless-browser second-opinion verifier for crawl.js
 * ----------------------------------------------------------------------------
 * crawl.js verifies links with plain HTTP (HEAD, then GET). That's fast and
 * dependency-free, but some links that work fine in a real browser still look
 * dead to it: the server gates unknown clients, serves a JS challenge, or builds
 * the page client-side. crawl.js already separates those "blocked / uncertain"
 * links from confirmed-dead ones — this tool is the next step: it re-opens each
 * suspect link in a REAL headless browser (Chromium via Playwright), which runs
 * the page's JavaScript and presents a genuine browser identity, and reports
 * whether it actually resolves. It clears false positives; it does not try to
 * defeat protection (no faked input, no fingerprint spoofing). If a site still
 * refuses an honest, rendered browser, that's reported as blocked — verify by
 * hand or ask the site's operator for access.
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
 *     node crawl-render.js --from-json crawl-report.json        # re-check suspects
 *     node crawl-render.js https://a/page https://b/page ...    # specific URLs
 *     node crawl-render.js --list urls.txt --channel chrome
 *
 * Without a browser available you can still run a plain re-check with
 * --http-fallback (no JS rendering — mainly for environments with no browser).
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
  };
  const num = (v, n) => { const x = Number(v); if (!Number.isFinite(x)) die("Invalid number for " + n + ": " + v); return x; };
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
      case "--out": cfg.out = next(); break;
      case "--html": cfg.html = next(); break;
      case "--timeout": cfg.timeout = Math.max(1000, num(next(), arg)); break;
      case "--delay": cfg.delay = Math.max(0, num(next(), arg)); break;
      case "--concurrency": cfg.concurrency = Math.max(1, Math.min(8, num(next(), arg))); break;
      case "--wait-until": {
        const w = next().toLowerCase();
        if (!["load", "domcontentloaded", "networkidle", "commit"].includes(w)) die("--wait-until must be load, domcontentloaded, networkidle, or commit");
        cfg.waitUntil = w; break;
      }
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
  return cfg;
}

function die(msg) { console.error("Error: " + msg + "\n"); printHelp(); process.exit(1); }
function printHelp() {
  console.log(`
crawl-render.js — re-check suspect links in a real headless browser

  node crawl-render.js [--from-json FILE | --list FILE | <url>...] [options]

Sources (combine freely; duplicates are de-duped):
  --from-json FILE   Pull links to re-check from a crawl.js JSON report.
                     Uses the 'blocked' and/or 'errors' buckets (per --which).
                     Understands single-site and combined multi-site JSON.
  --list FILE        Newline-delimited URLs ('#' comments / blanks ignored).
  <url>...           One or more URLs given directly.
  --which WHICH      From --from-json, which buckets: blocked | broken | both
                                                        (default both)

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
function makeHttpDriver(cfg) {
  return {
    label: "http-fallback (no browser rendering)",
    async check(url) {
      let r = await rawStatus(url, "HEAD", cfg);
      const inconclusive = !!r.err || r.status === 0 || [400, 403, 405, 406, 429, 501].includes(r.status) || r.status >= 500;
      if (inconclusive) { const g = await rawStatus(url, "GET", cfg); if (g.status > 0) r = g; else if (r.status === 0) r.err = g.err || r.err; }
      return { status: r.status, err: r.err, title: "", finalUrl: r.finalUrl };
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

// ----------------------------- main -----------------------------
if (require.main === module) {
  const cfg = parseArgs(process.argv);
  run(cfg).catch((e) => { console.error("\nError: " + (e && e.message || e)); process.exit(1); });
}

module.exports = { classify, gatherSuspects, buildHtml, applyToCrawlJson, makeHttpDriver, parseArgs };
