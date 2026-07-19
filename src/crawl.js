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
// FACADE / CLI entry (DS-016 monolith split). The crawler implementation was
// partitioned into src/crawl/: the engine (crawl), resume-journal replay, allowlist
// load/compile, and the suggestion writer + multi-site path helpers. This file keeps
// the build entry point (src/crawl.js -> generated root crawl.js) and require path
// stable, and owns the CLI: argument parsing, the merge-logs/rebuild/recheck
// subcommands, and the single- vs multi-site run flow. Pure code motion — see the
// DS-016 partition note; verified byte-identical on the golden fixtures.
const fs = require("fs");
const { writeOutputs, buildIndexReport, writeCombinedJson } = require("./report.js");
const { makeLogWriter, mergeLogs } = require("./log.js");
const { parseArgs, die } = require("./cli.js");
const { runRecheck, runRebuild } = require("./recheck.js");
const { loadAllowlist, compileAllow } = require("./crawl/allowlist.js");
const { crawl } = require("./crawl/engine.js");
const { writeSuggested, hostOf, sitePath } = require("./crawl/suggest.js");

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
