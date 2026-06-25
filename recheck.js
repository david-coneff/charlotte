"use strict";
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { makeRateLimiter, makeThrottle, sleep } = require("./netutil.js");
const { request, probe, linkDisposition } = require("./fetch.js");
const { writeOutputs, buildIndexReport, writeCombinedJson } = require("./report.js");

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
  try { startHost = new URL((pages[0] && pages[0].url) || (errors[0] && errors[0].url) || "http://localhost/").hostname; } catch { /* ignore */ }
  return {
    startHost, pathPrefix: (j.scope && j.scope !== "(whole domain)") ? j.scope : "",
    pages, external, outOfScope, refs, errors, blocked,
    retries: 0, crawlDelay: 0, crawled: pages.length, queue: [],
    startedAt: j.crawledAt || new Date().toISOString(), startedMs: Date.now(),
    logParts: [], logManifest: "", logSingleFile: true,
  };
}

// Re-probe just the broken (and blocked) links of one loaded state with the CURRENT
// settings, mutating state.errors/blocked: each flagged URL is probed once and
// re-classified, links that now resolve are dropped, allowlisted (suppressed) errors
// are preserved untouched. Returns the tallies. `srcLabel` is appended to the header log.
async function reprobe(cfg, allow, state, srcLabel) {
  const isAllowed = (u) => allow.some((re) => re.test(u));
  const suppressed = state.errors.filter((e) => isAllowed(e.url));   // keep allowlisted as-is
  // Dedup the links to re-probe: non-allowlisted broken links + blocked, each once.
  const flaggedMap = new Map();
  for (const e of state.errors) if (!isAllowed(e.url) && !flaggedMap.has(e.url)) flaggedMap.set(e.url, { url: e.url, kind: e.kind || "internal", source: e.source });
  for (const b of state.blocked) if (!flaggedMap.has(b.url)) flaggedMap.set(b.url, { url: b.url, kind: b.kind || "internal", source: b.source });
  const flagged = [...flaggedMap.values()];
  console.log(`Re-checking ${flagged.length} flagged link${flagged.length === 1 ? "" : "s"}${srcLabel || ""} (rate: ${cfg.rps ? cfg.rps + "/s" : "uncapped"}, ${cfg.concurrency} concurrent${cfg.browser ? ", browser UA" : ""})…`);
  const limiter = makeRateLimiter(cfg.rps > 0 ? 1000 / cfg.rps : 0);
  const throttle = makeThrottle(cfg.maxBackoff * 1000);
  const newErrors = [], newBlocked = [];
  let i = 0, nowOk = 0, nowBlk = 0, stillBad = 0;
  async function worker() {
    while (i < flagged.length) {
      const f = flagged[i++];
      await throttle.gate(); await limiter();
      let disp, detail;
      if (f.kind === "external") {
        const { status, err } = await probe(f.url, cfg);
        disp = linkDisposition(status, err); detail = status > 0 ? "HTTP " + status : (err || "no response");
      } else {
        try { const r = await request(f.url, "GET", cfg); disp = linkDisposition(r.status, null); detail = "HTTP " + r.status; }
        catch (err) { const m = String(err && err.message || err); disp = linkDisposition(0, m); detail = m; }
      }
      const ent = state.external.get(f.url);
      if (disp === "ok") { nowOk++; if (ent) ent.status = "ok"; console.log(`  ok  ${f.url}`); }
      else if (disp === "blocked") { nowBlk++; if (ent) ent.status = "blocked"; newBlocked.push({ url: f.url, reason: detail, source: f.source, kind: f.kind }); console.log(`  ?   ${f.url} — ${detail}`); }
      else { stillBad++; if (ent) ent.status = "err"; newErrors.push({ url: f.url, reason: f.kind === "external" ? "external unreachable (" + detail + ")" : detail, source: f.source, kind: f.kind }); console.log(`  x   ${f.url} — ${detail}`); }
      if (cfg.delay) await sleep(cfg.delay);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, cfg.concurrency) }, worker));
  state.errors = suppressed.concat(newErrors);   // corrected + deduped: suppressed + still-broken
  state.blocked = newBlocked;
  state.finishedMs = Date.now();
  return { flagged: flagged.length, nowOk, nowBlk, stillBad };
}

// --recheck-from entry point. Re-probes the broken links from a prior report with the
// CURRENT settings and rewrites the report(s) with the record corrected + deduped.
// Handles BOTH a single-site report JSON and a multi-site index JSON ({ sites: [...] }).
async function runRecheck(cfg, allow) {
  if (!fs.existsSync(cfg.recheckFrom)) { console.error("Error: --recheck-from file not found: " + cfg.recheckFrom); process.exit(1); }
  let j;
  try { j = JSON.parse(fs.readFileSync(cfg.recheckFrom, "utf8")); }
  catch (e) { console.error("Error: --recheck-from is not valid JSON: " + (e.message || e)); process.exit(1); }
  if (Array.isArray(j.sites)) { await runRecheckMulti(cfg, allow, j); return; }

  // ---- single-site report ----
  const state = loadStateFromJson(cfg.recheckFrom);
  if (!cfg.startUrl) cfg.startUrl = "http://" + state.startHost + "/ (re-check)";
  const r = await reprobe(cfg, allow, state, ` from ${cfg.recheckFrom}`);
  writeOutputs(state, cfg, allow, false);
  console.log(`\nRe-check done: ${r.nowOk} now OK (removed), ${r.nowBlk} blocked/uncertain, ${r.stillBad} still broken.`);
  console.log(`Report:  ${cfg.out}`);
  if (cfg.json) console.log(`JSON:    ${cfg.json}`);
}

// Multi-site index JSON: re-check each site from its full per-site JSON (written next to
// the index by a multi-site crawl), rewrite each per-site report, then rebuild the
// combined index + JSON. Per-site JSONs are resolved relative to the index JSON's folder.
async function runRecheckMulti(cfg, allow, j) {
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

  let tOk = 0, tBlk = 0, tBad = 0;
  for (const s of sites) {
    console.log(`\n=== ${s.host} ===`);
    const r = await reprobe(cfg, allow, s.state, ` for ${s.host}`);
    tOk += r.nowOk; tBlk += r.nowBlk; tBad += r.stillBad;
    const perCfg = Object.assign({}, cfg, { out: s.reportPath, json: s.jsonPath, startUrl: s.url });
    writeOutputs(s.state, perCfg, allow, false);   // rewrite this site's HTML + JSON
  }
  // Rebuild the combined index + JSON from the re-checked per-site states.
  const startedAt = j.crawledAt || new Date().toISOString();
  try { fs.writeFileSync(cfg.out, buildIndexReport(sites, cfg, allow, false, startedAt)); } catch (e) { console.error("Index write failed: " + (e.message || e)); }
  if (cfg.json) { try { writeCombinedJson(sites, cfg, allow); } catch (e) { console.error("Combined JSON write failed: " + (e.message || e)); } }

  console.log(`\nRe-check done across ${sites.length} site${sites.length === 1 ? "" : "s"}: ${tOk} now OK (removed), ${tBlk} blocked/uncertain, ${tBad} still broken.`);
  console.log(`Index:   ${cfg.out}`);
  if (cfg.json) console.log(`JSON:    ${cfg.json}`);
}

module.exports = { runRecheck, loadStateFromJson };
