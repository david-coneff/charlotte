"use strict";
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { makeRateLimiter, makeThrottle, sleep } = require("./netutil.js");
const { request, probe, linkDisposition } = require("./fetch.js");
const { writeOutputs, buildReportJson, buildIndexReport, writeCombinedJson } = require("./report.js");
const { makeLogWriter } = require("./log.js");

// --recheck-from writes its results to a SEPARATE "*.recheck.json" sidecar first, and only
// rewrites the live crawl report once the whole re-check has finished — so an interrupted or
// failed re-probe never leaves the main report/JSON half-overwritten. Derive that sidecar
// path from a report/JSON path (foo.json -> foo.recheck.json; foo.html -> foo.recheck.json).
function recheckSidecarPath(p) {
  if (!p) return "";
  const ext = path.extname(p);
  return ext ? p.slice(0, -ext.length) + ".recheck.json" : p + ".recheck.json";
}
// Re-check honors the same Stop/Pause control files as a crawl. Clean them up at the end so a
// leftover Stop flag (from a stopped re-check) can't immediately halt the next run.
function cleanupControlFiles(cfg) {
  try { if (cfg.stopFile && fs.existsSync(cfg.stopFile)) fs.unlinkSync(cfg.stopFile); } catch { /* ignore */ }
  try { if (cfg.pauseFile && fs.existsSync(cfg.pauseFile)) fs.unlinkSync(cfg.pauseFile); } catch { /* ignore */ }
}

// ----------------------------- re-check broken links -----------------------------
// Reconstruct a crawl's state from a prior --json report so we can re-probe just the
// flagged links (no re-crawl) and rewrite a corrected report. Used by --recheck-from.
function loadStateFromJson(file) {
  const j = JSON.parse(fs.readFileSync(file, "utf8"));
  const refs = new Map();
  const addRefs = (url, foundOn) => { if (Array.isArray(foundOn) && foundOn.length) refs.set(url, new Set(foundOn)); };
  const external = new Map();
  for (const e of (j.externalLinks || [])) { external.set(e.url, { url: e.url, host: e.host, status: e.status }); addRefs(e.url, e.foundOn); }
  const outOfScope = new Map();
  for (const e of (j.outOfScopeLinks || [])) { outOfScope.set(e.url, { url: e.url }); addRefs(e.url, e.foundOn); }
  const toErr = (e) => ({ url: e.url, reason: e.reason, source: (e.foundOn && e.foundOn[0]) || "", kind: e.kind || "internal" });
  const errors = [...(j.errors || []), ...(j.suppressedErrors || [])].map((e) => { addRefs(e.url, e.foundOn); return toErr(e); });
  const blocked = (j.blocked || []).map((e) => { addRefs(e.url, e.foundOn); return toErr(e); });
  const pages = j.internalPages || [];
  let startHost = "";
  // Prefer the ORIGINAL start URL recorded in the JSON so a rewrite keeps the report's
  // identity (the triage-namespace host + the verdict-import gate). Falling back to
  // pages[0].url silently flips the host when the seed redirects (e.g. apex -> www),
  // orphaning every saved verdict and rejecting the verdicts file. (Older JSONs have no
  // startUrl -> the pages[0] fallback still applies; recover those with an explicit --start-url.)
  try { startHost = new URL(j.startUrl || (pages[0] && pages[0].url) || (errors[0] && errors[0].url) || "http://localhost/").hostname; } catch { /* ignore */ }
  const runtimeMs = j.summary && Number.isFinite(j.summary.runtimeMs) ? j.summary.runtimeMs : null;
  return {
    startHost, startUrl: j.startUrl || "", pathPrefix: (j.scope && j.scope !== "(whole domain)") ? j.scope : "",
    pages, external, outOfScope, refs, errors, blocked,
    retries: (j.summary && j.summary.retries) || 0, crawlDelay: 0, crawled: pages.length, queue: [],
    startedAt: j.crawledAt || new Date().toISOString(), startedMs: Date.now(), runtimeMs,
    // Original crawl settings (if this JSON was written by a current build) so a rebuild/re-check
    // rewrite shows the real config line, not this process's CLI defaults. See report.effSettings.
    settings: (j.settings && typeof j.settings === "object") ? j.settings : null,
    logParts: [], logManifest: "", logSingleFile: true,
  };
}

// Re-probe just the broken (and blocked) links of one loaded state with the CURRENT
// settings, mutating state.errors/blocked: each flagged URL is probed once and
// re-classified, links that now resolve are dropped, allowlisted (suppressed) errors
// are preserved untouched. Returns the tallies. `srcLabel` is appended to the header log.
async function reprobe(cfg, allow, state, srcLabel, logger) {
  const log = (s) => { if (logger) logger.line(s); };
  const isAllowed = (u) => allow.some((re) => re.test(u));
  const suppressed = state.errors.filter((e) => isAllowed(e.url));   // keep allowlisted as-is
  // Dedup the links to re-probe: non-allowlisted broken links + blocked, each once. Keep each
  // link's ORIGINAL reason + origin (error vs blocked) so a Stop mid-run can restore the ones we
  // never got to, unchanged — a stopped re-check must never silently drop a still-broken link.
  const flaggedMap = new Map();
  for (const e of state.errors) if (!isAllowed(e.url) && !flaggedMap.has(e.url)) flaggedMap.set(e.url, { url: e.url, kind: e.kind || "internal", source: e.source, reason: e.reason, origin: "error" });
  for (const b of state.blocked) if (!flaggedMap.has(b.url)) flaggedMap.set(b.url, { url: b.url, kind: b.kind || "internal", source: b.source, reason: b.reason, origin: "blocked" });
  const flagged = [...flaggedMap.values()];
  console.log(`Re-checking ${flagged.length} flagged link${flagged.length === 1 ? "" : "s"}${srcLabel || ""} (rate: ${cfg.rps ? cfg.rps + "/s" : "uncapped"}, ${cfg.concurrency} concurrent${cfg.browser ? ", browser UA" : ""})…`);
  // Progress markers for the GUI live feed (only hit disk when --log is set). Per-link lines use
  // a lowercase verdict token so they can't collide with a crawl's "URL OK/ERR/…" lines.
  log(`# recheck-start total=${flagged.length} host=${state.startHost || "?"}`);
  const limiter = makeRateLimiter(cfg.rps > 0 ? 1000 / cfg.rps : 0);
  const throttle = makeThrottle(cfg.maxBackoff * 1000);
  const newErrors = [], newBlocked = [];
  let i = 0, nowOk = 0, nowBlk = 0, stillBad = 0, stopped = false;
  // Stop = drain right away; Pause = block here until the flag clears (or Stop). Same control
  // files as a crawl (--stop-file / --pause-file), so the GUI's Pause/Stop buttons drive re-check too.
  async function control() {
    if (cfg.stopFile && fs.existsSync(cfg.stopFile)) { stopped = true; return; }
    while (cfg.pauseFile && fs.existsSync(cfg.pauseFile)) {
      if (cfg.stopFile && fs.existsSync(cfg.stopFile)) { stopped = true; return; }
      await sleep(400);
    }
  }
  async function worker() {
    while (true) {
      await control();
      if (stopped) break;
      const idx = i++;
      if (idx >= flagged.length) break;
      const f = flagged[idx];
      await throttle.gate(); await limiter();
      let disp, detail;
      if (f.kind === "external") {
        const { status, err } = await probe(f.url, cfg);
        disp = linkDisposition(status, err); detail = status > 0 ? "HTTP " + status : (err || "no response");
      } else {
        try { const r = await request(f.url, "GET", cfg); disp = linkDisposition(r.status, null); detail = "HTTP " + r.status; }
        catch (err) { const m = String(err && err.message || err); disp = linkDisposition(0, m); detail = m; }
      }
      f.done = true;
      const ent = state.external.get(f.url);
      if (disp === "ok") { nowOk++; if (ent) ent.status = "ok"; console.log(`  ok  ${f.url}`); log(`RECHK ok ${f.url}`); }
      else if (disp === "blocked") { nowBlk++; if (ent) ent.status = "blocked"; newBlocked.push({ url: f.url, reason: detail, source: f.source, kind: f.kind }); console.log(`  ?   ${f.url} — ${detail}`); log(`RECHK blocked ${f.url} — ${detail}`); }
      else { stillBad++; if (ent) ent.status = "err"; const reason = f.kind === "external" ? "external unreachable (" + detail + ")" : detail; newErrors.push({ url: f.url, reason, source: f.source, kind: f.kind }); console.log(`  x   ${f.url} — ${detail}`); log(`RECHK broken ${f.url} — ${detail}`); }
      if (cfg.delay) await sleep(cfg.delay);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, cfg.concurrency) }, worker));
  // Restore any links a Stop kept us from reaching, in their ORIGINAL state, so nothing is dropped.
  if (stopped) for (const f of flagged) {
    if (f.done) continue;
    if (f.origin === "blocked") newBlocked.push({ url: f.url, reason: f.reason, source: f.source, kind: f.kind });
    else newErrors.push({ url: f.url, reason: f.reason, source: f.source, kind: f.kind });
  }
  state.errors = suppressed.concat(newErrors);   // corrected + deduped: suppressed + still-broken
  state.blocked = newBlocked;
  state.finishedMs = Date.now();
  log(`# recheck-done checked=${nowOk + nowBlk + stillBad} ok=${nowOk} blocked=${nowBlk} broken=${stillBad}${stopped ? " stopped=1" : ""}`);
  return { flagged: flagged.length, nowOk, nowBlk, stillBad, stopped };
}

// --recheck-from entry point. Re-probes the broken links from a prior report with the
// CURRENT settings and rewrites the report(s) with the record corrected + deduped.
// Handles BOTH a single-site report JSON and a multi-site index JSON ({ sites: [...] }).
async function runRecheck(cfg, allow) {
  if (!fs.existsSync(cfg.recheckFrom)) { console.error("Error: --recheck-from file not found: " + cfg.recheckFrom); process.exit(1); }
  let j;
  try { j = JSON.parse(fs.readFileSync(cfg.recheckFrom, "utf8")); }
  catch (e) { console.error("Error: --recheck-from is not valid JSON: " + (e.message || e)); process.exit(1); }
  // One progress log for the whole re-check (the GUI tails it for the live feed). A no-op when
  // --log isn't set, so CLI runs without --log behave exactly as before.
  const logger = makeLogWriter(cfg, { run: "recheck", startUrl: cfg.startUrl || cfg.recheckFrom, startedAt: new Date().toISOString() });
  if (Array.isArray(j.sites)) { await runRecheckMulti(cfg, allow, j, logger); return; }

  // ---- single-site report ----
  const state = loadStateFromJson(cfg.recheckFrom);
  // Older JSONs recorded no startUrl: honor an explicit --start-url (the GUI passes its Start
  // URL) so the report's host isn't flipped by an apex->www redirect, which would orphan triage.
  if (!j.startUrl && cfg.startUrl) { try { state.startHost = new URL(cfg.startUrl).hostname; state.startUrl = cfg.startUrl; } catch { /* ignore */ } }
  if (!cfg.startUrl) cfg.startUrl = "http://" + state.startHost + "/ (re-check)";
  const r = await reprobe(cfg, allow, state, ` from ${cfg.recheckFrom}`, logger);
  // SAFETY (operator's request): write the corrected data to a SEPARATE re-check JSON first,
  // and only THEN rewrite the live report + JSON. The re-probe above is the part that can fail;
  // it runs before any of these writes, so a crash leaves the main report untouched.
  const sidecar = recheckSidecarPath(cfg.json || cfg.out);
  if (sidecar) { try { fs.writeFileSync(sidecar, buildReportJson(state, cfg, allow, false)); } catch (e) { console.error("Re-check JSON write failed: " + (e.message || e)); } }
  writeOutputs(state, cfg, allow, false);   // completion: rewrite the live crawl report + JSON
  logger.finalize(true);
  cleanupControlFiles(cfg);
  console.log(`\nRe-check ${r.stopped ? "stopped early" : "done"}: ${r.nowOk} now OK (removed), ${r.nowBlk} blocked/uncertain, ${r.stillBad} still broken.`);
  if (sidecar) console.log(`Re-check JSON: ${sidecar}`);
  console.log(`Report:  ${cfg.out}`);
  if (cfg.json) console.log(`JSON:    ${cfg.json}`);
}

// Multi-site index JSON: re-check each site from its full per-site JSON (written next to
// the index by a multi-site crawl), rewrite each per-site report, then rebuild the
// combined index + JSON. Per-site JSONs are resolved relative to the index JSON's folder.
async function runRecheckMulti(cfg, allow, j, logger) {
  const dir = path.dirname(cfg.recheckFrom);
  const sites = [], missing = [];
  for (const s of (j.sites || [])) {
    const jf = s.jsonFile ? path.join(dir, s.jsonFile) : "";
    if (!jf || !fs.existsSync(jf)) { missing.push(s.host || s.url || "?"); continue; }
    let state;
    try { state = loadStateFromJson(jf); } catch { missing.push(s.host || s.url || "?"); continue; }
    sites.push({ url: s.url, host: s.host, state, partial: false, reportFile: s.reportFile || "", jsonFile: s.jsonFile || "", reportPath: s.reportFile ? path.join(dir, s.reportFile) : "", jsonPath: jf });
  }
  if (missing.length) {
    console.error(`Re-check: ${missing.length} of ${(j.sites || []).length} site(s) have no per-site JSON next to the index (${missing.join(", ")}).`);
    console.error("Those per-site JSON files are written by a current multi-site crawl — re-run the crawl once to generate them, then re-check.");
  }
  if (!sites.length) { console.error("Re-check: no re-checkable per-site reports found — nothing was changed."); process.exit(1); }

  // Phase 1 — re-probe every site IN MEMORY and write each one's SEPARATE re-check JSON. The live
  // per-site reports + index are left untouched here, so a failure (or Stop) part-way through never
  // leaves the multi-site report set half-rewritten.
  let tOk = 0, tBlk = 0, tBad = 0, anyStopped = false;
  for (const s of sites) {
    console.log(`\n=== ${s.host} ===`);
    const r = await reprobe(cfg, allow, s.state, ` for ${s.host}`, logger);
    tOk += r.nowOk; tBlk += r.nowBlk; tBad += r.stillBad; anyStopped = anyStopped || r.stopped;
    const sidecar = recheckSidecarPath(s.jsonPath || s.reportPath);
    if (sidecar) { try { fs.writeFileSync(sidecar, buildReportJson(s.state, cfg, allow, false)); } catch (e) { console.error(`Re-check JSON write failed (${s.host}): ` + (e.message || e)); } }
    if (r.stopped) break;   // honor Stop: don't start the remaining sites
  }
  // Phase 2 (completion) — only now that the re-probing is finished, rewrite the live per-site
  // reports we actually re-checked plus the combined index + JSON, in one pass. Sites never
  // reached by a Stop keep their finishedMs unset and are left exactly as they were.
  for (const s of sites) {
    if (!s.state.finishedMs) continue;
    const perCfg = Object.assign({}, cfg, { out: s.reportPath, json: s.jsonPath, startUrl: s.url });
    writeOutputs(s.state, perCfg, allow, false);
  }
  const startedAt = j.crawledAt || new Date().toISOString();
  try { fs.writeFileSync(cfg.out, buildIndexReport(sites, cfg, allow, false, startedAt)); } catch (e) { console.error("Index write failed: " + (e.message || e)); }
  if (cfg.json) { try { writeCombinedJson(sites, cfg, allow); } catch (e) { console.error("Combined JSON write failed: " + (e.message || e)); } }
  logger.finalize(true);
  cleanupControlFiles(cfg);

  console.log(`\nRe-check ${anyStopped ? "stopped early" : "done"} across ${sites.length} site${sites.length === 1 ? "" : "s"}: ${tOk} now OK (removed), ${tBlk} blocked/uncertain, ${tBad} still broken.`);
  console.log(`Index:   ${cfg.out}`);
  if (cfg.json) console.log(`JSON:    ${cfg.json}`);
}

// --rebuild-from entry point. Regenerate the HTML report(s) from a prior --json report
// using THIS version's report features — no crawl, no network, no re-probe. Lets an old
// crawl's data get a fresh report with new features instead of re-crawling. Handles a
// single-site report JSON and a multi-site index JSON (rebuilds from per-site JSONs).
async function runRebuild(cfg, allow) {
  if (!fs.existsSync(cfg.rebuildFrom)) { console.error("Error: --rebuild-from file not found: " + cfg.rebuildFrom); process.exit(1); }
  let j;
  try { j = JSON.parse(fs.readFileSync(cfg.rebuildFrom, "utf8")); }
  catch (e) { console.error("Error: --rebuild-from is not valid JSON: " + (e.message || e)); process.exit(1); }
  if (Array.isArray(j.sites)) { await runRebuildMulti(cfg, allow, j); return; }

  const state = loadStateFromJson(cfg.rebuildFrom);
  state.finishedMs = Date.now();
  // Older JSONs recorded no startUrl: honor an explicit --start-url (the GUI passes its Start
  // URL) so the report's host isn't flipped by an apex->www redirect, which would orphan triage.
  if (!j.startUrl && cfg.startUrl) { try { state.startHost = new URL(cfg.startUrl).hostname; state.startUrl = cfg.startUrl; } catch { /* ignore */ } }
  if (!cfg.startUrl) cfg.startUrl = "http://" + state.startHost + "/ (rebuild)";
  writeOutputs(state, cfg, allow, false);
  console.log(`Rebuilt report from ${cfg.rebuildFrom}: ${state.pages.length} pages, ${state.external.size} external, ${state.errors.length} errors.`);
  console.log(`Report:  ${cfg.out}`);
  if (cfg.json) console.log(`JSON:    ${cfg.json}`);
}

async function runRebuildMulti(cfg, allow, j) {
  const dir = path.dirname(cfg.rebuildFrom);
  const sites = [], missing = [];
  for (const s of (j.sites || [])) {
    const jf = s.jsonFile ? path.join(dir, s.jsonFile) : "";
    if (!jf || !fs.existsSync(jf)) { missing.push(s.host || s.url || "?"); continue; }
    let state;
    try { state = loadStateFromJson(jf); } catch { missing.push(s.host || s.url || "?"); continue; }
    state.finishedMs = Date.now();
    sites.push({ url: s.url, host: s.host, state, partial: false, reportFile: s.reportFile || "", jsonFile: s.jsonFile || "", reportPath: s.reportFile ? path.join(dir, s.reportFile) : "", jsonPath: jf });
  }
  if (missing.length) {
    console.error(`Rebuild: ${missing.length} of ${(j.sites || []).length} site(s) have no per-site JSON next to the index (${missing.join(", ")}) — they can't be rebuilt without re-crawling.`);
  }
  if (!sites.length) { console.error("Rebuild: no per-site JSONs found — nothing was changed."); process.exit(1); }
  for (const s of sites) {
    const perCfg = Object.assign({}, cfg, { out: s.reportPath, json: s.jsonPath, startUrl: s.url });
    writeOutputs(s.state, perCfg, allow, false);
    console.log(`  rebuilt ${s.host} -> ${s.reportFile}`);
  }
  const startedAt = j.crawledAt || new Date().toISOString();
  try { fs.writeFileSync(cfg.out, buildIndexReport(sites, cfg, allow, false, startedAt)); } catch (e) { console.error("Index write failed: " + (e.message || e)); }
  if (cfg.json) { try { writeCombinedJson(sites, cfg, allow); } catch (e) { console.error("Combined JSON write failed: " + (e.message || e)); } }
  console.log(`\nRebuilt ${sites.length} site report(s) + index.`);
  console.log(`Index:   ${cfg.out}`);
  if (cfg.json) console.log(`JSON:    ${cfg.json}`);
}

module.exports = { runRecheck, runRebuild, loadStateFromJson };
