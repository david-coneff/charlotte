"use strict";
// Crawl engine (DS-016 split from crawl.js): the async crawl(cfg, allow, ...) that
// drives the frontier + per-page visit, rate-limit backoff, the external-link and
// failed-link re-check passes, journaling, and live report checkpoints. Resume
// journal replay lives in ./resume.js; allowlist load/compile, the suggestion
// writer and multi-site path helpers are in sibling modules; the CLI entry (main)
// stays in ../crawl.js, which re-exports nothing — it just drives this.
const fs = require("fs");
const { URL } = require("url");
const { writeOutputs } = require("../report.js");
const { makeLogWriter, makeJournal } = require("../log.js");
const { extractLinks, extractDocLinks, sniffMagic } = require("../parse.js");
const { makeSeenStore } = require("../seen.js");
const { request, probe, linkDisposition } = require("../fetch.js");
const { sleep, normalize, sameDomain, makeRateLimiter, parseRetryAfter, makeThrottle, fetchCrawlDelay } = require("../netutil.js");
const { replayResume } = require("./resume.js");

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
  // --seeds (seedMode): start the frontier from every seed URL at depth 0 in one
  // crawl (shared seen-set + one report). Otherwise it's the single start URL.
  const seedUrls = (cfg.seedMode && Array.isArray(cfg.startUrls) && cfg.startUrls.length) ? cfg.startUrls : [cfg.startUrl];
  for (const s of seedUrls) seen.tryAdd(normalize(s));

  // Internal-host set: a --seeds combined crawl is ONE logical crawl over EVERY
  // seed host (e.g. the main site + a sibling document repo), so all seed hosts
  // are internal — not just startUrls[0]. Mirrors crawl-render.js discover
  // (AD-088); without it a sibling seed host's links are misclassified external
  // and never followed. A non-seed crawl keeps exactly the single start host.
  const internalHosts = new Set();
  for (const s of seedUrls) { try { internalHosts.add(new URL(s).hostname); } catch { /* skip a bad seed */ } }
  const isInternalHost = (host) => { for (const h of internalHosts) { if (sameDomain(host, h, cfg.includeSubdomains)) return true; } return false; };

  const state = {
    startHost,
    startUrl: cfg.startUrl,   // recorded in the JSON so a rebuild/re-check keeps this report's host
    pathPrefix,
    queue: seedUrls.map((u) => ({ url: u, depth: 0, parent: "(start)" })),
    seen,
    pages: [],
    external: new Map(),
    outOfScope: new Map(),   // same domain, outside pathPrefix: recorded, never followed
    refs: new Map(),         // target URL -> Set of every distinct referrer page
    errors: [],
    blocked: [],             // links our automated check couldn't confirm (likely OK in a browser)
    retries: 0,
    docUrls: new Set(),      // URLs that were scanned as documents (PDF/Office) — for the doc-link tally
    docLinkInstances: 0,     // running count of http(s) link instances found inside documents
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

  // ---- resume: rebuild the frontier + results from the journal (see ./resume.js). ----
  if (cfg.resume) replayResume(state, cfg, seen, addRef, logLine, J);

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
    let internalFound = 0, externalFound = 0, oosFound = 0;
    // When journaling, collect this page's discovered link targets so a resume can
    // rebuild the frontier + referrers + external/oos maps without re-crawling it.
    const inT = [], exT = [], ooT = [];
    for (const link of links) {
      if (link.protocol !== "http:" && link.protocol !== "https:") continue;
      if (isInternalHost(link.hostname)) {
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
          oosFound++;
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
    if (r.doc) {
      // A scanned document, counted like a page: tally the link instances inside it
      // (the GUI's Documents badge sums these live; the final # docsummary adds the
      // broken/blocked verdicts once every link has been checked).
      const inside = internalFound + externalFound + oosFound;
      state.docUrls.add(job.url);
      state.docLinkInstances += inside;
      logLine(`# docscan links=${inside} int=${internalFound} ext=${externalFound}`);
    }
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
  // Document-link tally (verdicts are final now): of the destinations found INSIDE
  // scanned documents, how many are unique, broken, or blocked. A destination is
  // "inside a document" if any of its referrers is a scanned-document URL.
  if (state.docUrls.size) {
    const errSet = new Set(state.errors.map((e) => e.url));
    const blkSet = new Set(state.blocked.map((b) => b.url));
    let uniq = 0, brk = 0, blk = 0;
    for (const [target, refs] of state.refs) {
      let inDoc = false;
      for (const ref of refs) { if (state.docUrls.has(ref)) { inDoc = true; break; } }
      if (!inDoc) continue;
      uniq++;
      if (errSet.has(target)) brk++; else if (blkSet.has(target)) blk++;
    }
    logLine(`# docsummary docs=${state.docUrls.size} instances=${state.docLinkInstances} unique=${uniq} broken=${brk} blocked=${blk}`);
  }
  logger.finalize(!sharedLogger);   // shared logger is finalized once by the caller
  seen.close();
  state.finishedMs = Date.now();   // freeze crawl runtime for the final report
  return state;
}

module.exports = { crawl };
