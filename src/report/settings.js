"use strict";
// Which crawl settings a report may truthfully display/persist (fresh crawl vs. a
// --rebuild-from / --recheck-from rewrite). Extracted verbatim from report.js (AD-083).
// The crawl settings shown in the report's config line. A fresh crawl reads them straight from
// cfg; but a --recheck-from / --rebuild-from REWRITE runs in a separate process whose cfg holds
// CLI defaults (it was only handed --recheck-from / --out / …), which used to overwrite the line
// with bogus defaults. So we persist these in the JSON (buildReportJson) and restore them onto
// state.settings (loadStateFromJson); when present they win, so a rewrite reports the ORIGINAL
// crawl's settings rather than the rewrite process's defaults. The live cfg still drives the
// re-probe itself — only the displayed/persisted settings come from here. (maxPages/maxDepth use
// null in JSON for Infinity, since JSON has no Infinity.)
function effSettings(state, cfg) {
  const s = (state && state.settings) || null;
  const num = (v, d) => (typeof v === "number" ? v : d);
  const bool = (v, d) => (typeof v === "boolean" ? v : d);
  if (!s) return { concurrency: cfg.concurrency, delay: cfg.delay, rps: cfg.rps, maxPages: cfg.maxPages, maxDepth: cfg.maxDepth, includeSubdomains: cfg.includeSubdomains, checkExternal: cfg.checkExternal };
  return {
    concurrency: num(s.concurrency, cfg.concurrency),
    delay: num(s.delay, cfg.delay),
    rps: num(s.rps, cfg.rps),
    maxPages: s.maxPages === null ? Infinity : num(s.maxPages, cfg.maxPages),
    maxDepth: s.maxDepth === null ? Infinity : num(s.maxDepth, cfg.maxDepth),
    includeSubdomains: bool(s.includeSubdomains, cfg.includeSubdomains),
    checkExternal: bool(s.checkExternal, cfg.checkExternal),
  };
}

// Are the crawl's settings genuinely known for this report? Yes for a fresh crawl (cfg IS the crawl's
// settings) or any rewrite whose JSON carried a "settings" block (restored to state.settings). No ONLY
// when a --rebuild-from / --recheck-from rewrite loaded a JSON written before settings were recorded —
// then cfg is just the rewrite process's CLI defaults. Gate both the displayed config line AND what
// buildReportJson persists, so those bogus defaults are never shown OR laundered into a fresh JSON.
function settingsAreKnown(state, cfg) { return !!(state && state.settings) || !(cfg && (cfg.rebuildFrom || cfg.recheckFrom)); }

module.exports = { effSettings, settingsAreKnown };
