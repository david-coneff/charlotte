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
const { makeLogWriter, makeJournal, mergeLogs } = require("./log.js");
const { extractLinks, extractDocLinks, sniffMagic } = require("./parse.js");
const { makeSeenStore } = require("./seen.js");
const { request, probe, linkDisposition } = require("./fetch.js");
const { parseArgs, die } = require("./cli.js");
const { sleep, normalize, sameDomain, makeRateLimiter, parseRetryAfter, makeThrottle, fetchCrawlDelay } = require("./netutil.js");
const { runRecheck, runRebuild } = require("./recheck.js");


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

// ----------------------------- crawl -----------------------------
async function crawl(cfg, allow, sharedLogger, onProgress) {
  const startHost = new URL(cfg.startUrl).hostname;

  // Effective request spacing = the larger of --rps and the robots.txt (or
  // --crawl-delay) crawl-delay. Determined before the limiter is built.
  let crawlDelay = cfg.crawlDelay;
  let robotsDelay = 0;
  if (!cfg.crawlDelay && !cfg.ignoreRobots) { robotsDelay = await fetchCrawlDelay(cfg); crawlDelay = robotsDelay; }
  // Effective request spacing, recomputed each request so --tune-file can change
  // --rps / --crawl-delay mid-crawl (with --delay and --timeout) WITHOUT restarting.
  const effGapMs = () => {
    let g = 0;
    if (cfg.rps > 0) g = Math.max(g, 1000 / cfg.rps);
    if (crawlDelay > 0) g = Math.max(g, crawlDelay * 1000);
    return g;
  };
  const limiter = makeRateLimiter(effGapMs);
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
  if (journal.on && !cfg.resume) {
    try { fs.writeFileSync(cfg.state, ""); } catch { /* ignore */ }   // fresh journal: don't append to a previous run's
    J({ t: "meta", v: 1, run: runId, startUrl: cfg.startUrl, scope: pathPrefix || "", depth: cfg.maxDepth === Infinity ? null : cfg.maxDepth, subs: !!cfg.includeSubdomains, startedAt: state.startedAt });
  }
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
    const vSessions = new Map();          // url -> Set of resume-session indices it was attempted (visited) in
    let session = 0, quarantined = 0;     // poison-URL detection: attempted across >=2 sessions, never completed
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
      if (e.t === "r") { session++; continue; }                                // resume boundary marker
      if (e.t === "v") { let s = vSessions.get(e.u); if (!s) { s = new Set(); vSessions.set(e.u, s); } s.add(session); continue; }
      if (e.t !== "p" && e.t !== "k" && e.t !== "e" && e.t !== "b") continue;  // unknown: ignored here
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
    for (const [u, info] of enq) {
      if (doneSet.has(u)) continue;
      const sess = vSessions.get(u);
      if (sess && sess.size >= 2) {   // attempted in >=2 separate sessions, never completed: a page that crashes the crawler
        state.blocked.push({ url: u, reason: `quarantined — aborted the crawler ${sess.size}× without completing (likely a page that crashes it)`, source: info.parent, kind: "internal" });
        quarantined++;
        continue;
      }
      state.queue.push({ url: u, depth: info.depth, parent: info.parent });
    }
    // If the start URL was never reached (empty/partial journal), make sure it runs.
    const su = normalize(cfg.startUrl);
    if (!doneSet.has(su) && !enq.has(su)) state.queue.unshift({ url: su, depth: 0, parent: "(start)" });
    state.crawled = doneSet.size;
    J({ t: "r", at: new Date().toISOString() });   // mark this resume in the journal
    console.log(`Resumed from ${cfg.resume}: ${replayed} already done, ${state.queue.length} queued${quarantined ? `, ${quarantined} quarantined (crashing page${quarantined === 1 ? "" : "s"})` : ""}.`);
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

  // Live re-tuning: re-read --tune-file each control tick and, when its JSON changes,
  // apply new delay / rps / crawl-delay / timeout to the running crawl — so you can
  // pause, change the pacing, and resume WITHOUT restarting (the GUI Resume writes it).
  // The file's content at start is the baseline (not applied), so stale values can't
  // override the CLI args; a missing/invalid file or unknown keys are ignored.
  let lastTuneRaw = null;
  try { if (cfg.tuneFile && fs.existsSync(cfg.tuneFile)) lastTuneRaw = fs.readFileSync(cfg.tuneFile, "utf8"); } catch { /* ignore */ }
  const applyTune = () => {
    if (!cfg.tuneFile) return;
    let raw;
    try { raw = fs.readFileSync(cfg.tuneFile, "utf8"); } catch { return; }
    if (raw === lastTuneRaw) return;
    lastTuneRaw = raw;
    let t; try { t = JSON.parse(raw); } catch { return; }
    if (!t || typeof t !== "object") return;
    const ch = [];
    if (Number.isFinite(t.delay) && t.delay >= 0 && t.delay !== cfg.delay) { cfg.delay = t.delay; ch.push(`delay=${t.delay}ms`); }
    if (Number.isFinite(t.rps) && t.rps >= 0 && t.rps !== cfg.rps) { cfg.rps = t.rps; ch.push(`rps=${t.rps || "off"}`); }
    if (Number.isFinite(t.crawlDelay) && t.crawlDelay >= 0 && t.crawlDelay !== crawlDelay) { crawlDelay = t.crawlDelay; state.crawlDelay = t.crawlDelay; ch.push(`crawl-delay=${t.crawlDelay}s`); }
    if (Number.isFinite(t.timeout) && t.timeout >= 1000 && t.timeout !== cfg.timeout) { cfg.timeout = t.timeout; ch.push(`timeout=${t.timeout}ms`); }
    if (ch.length) { logLine(`# RETUNED ${new Date().toISOString()} ${ch.join(" ")}`); console.log("Re-tuned: " + ch.join(", ") + "."); }
  };

  // Poll the control files: stop -> graceful shutdown; pause/resume -> log the
  // transition (workers check isPaused() themselves); tune-file -> apply live.
  let pausedState = false;
  if (cfg.stopFile || cfg.pauseFile || cfg.tuneFile) {
    controlTimer = setInterval(() => {
      if (cfg.stopFile && fs.existsSync(cfg.stopFile)) { shutdown("STOPPED"); return; }
      applyTune();
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
        if (isPaused()) { await sleep(300); continue; }   // honor the Pause button here too
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
        if (isPaused()) { await sleep(300); continue; }   // honor the Pause button here too
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

  // ---- rebuild mode: regenerate the HTML report from a prior JSON (no crawl) ----
  if (cfg.rebuildFrom) { await runRebuild(cfg, allow); return; }

  // ---- re-check mode: re-probe only the flagged links from a prior report ----
  if (cfg.recheckFrom) { await runRecheck(cfg, allow); return; }

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
  const sites = cfg.startUrls.map((u, i) => ({ url: u, host: hostOf(u), state: null, partial: true, reportFile: sitePath(cfg.out, i, hostOf(u)), jsonFile: cfg.json ? sitePath(cfg.json, i, hostOf(u)) : "" }));
  const writeIndex = (partial) => { try { fs.writeFileSync(cfg.out, buildIndexReport(sites, cfg, allow, partial, startedAt)); if (cfg.json) writeCombinedJson(sites, cfg, allow); } catch { /* ignore */ } };

  console.log(`Crawling ${sites.length} sites sequentially -> index ${cfg.out}`);
  writeIndex(true);

  for (let i = 0; i < sites.length; i++) {
    logger.line(`# === site ${i + 1}/${sites.length} ${sites[i].url} ===`);
    console.log(`\n=== Site ${i + 1}/${sites.length}: ${sites[i].url} ===`);
    // Per-site resume journal, derived from --state like the per-site report from --out.
    const perState = cfg.state ? sitePath(cfg.state, i, sites[i].host) : "";
    // Per-site JSON (full state) so re-check (--recheck-from on the index JSON) can
    // re-probe each site and faithfully rewrite its report; the combined JSON references these.
    const siteCfg = Object.assign({}, cfg, { startUrl: sites[i].url, out: sites[i].reportFile, json: sites[i].jsonFile, state: perState, resume: cfg.resume ? perState : "" });
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
