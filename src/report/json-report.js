"use strict";
// buildReportJson — the report's machine-readable full-crawl-state JSON, shared by
// writeOutputs and the --recheck-from sidecar. Extracted verbatim (AD-096).
const { effSettings, settingsAreKnown } = require("./settings.js");

// Build the report's machine-readable JSON (the full crawl state) as a string. Shared by
// writeOutputs and by --recheck-from's separate "re-check JSON" sidecar so both emit the
// identical shape (and a re-check sidecar can itself be re-fed to --rebuild-from).
function buildReportJson(state, cfg, allow, partial) {
  const suppressed = [], active = [];
  for (const e of state.errors) (allow.some((re) => re.test(e.url)) ? suppressed : active).push(e);
  const refsOf = (url) => { const s = state.refs.get(url); return s ? [...s] : []; };
  const errOut = (e) => ({ url: e.url, reason: e.reason, kind: e.kind || "internal", foundOn: refsOf(e.url).length ? refsOf(e.url) : (e.source ? [e.source] : []) });
  const st = settingsAreKnown(state, cfg) ? effSettings(state, cfg) : null;
  return JSON.stringify({
    crawledAt: state.startedAt, partial: !!partial, scope: state.pathPrefix || "(whole domain)",
    // The ORIGINAL start URL, so a later --rebuild-from / --recheck-from keeps the report's
    // identity (triage-namespace host + verdict-import gate) instead of re-deriving it from
    // pages[0] — which an apex->www redirect would flip, orphaning every saved verdict.
    startUrl: state.startUrl || cfg.startUrl || "",
    startHost: state.startHost,
    // The crawl's settings (only when genuinely known), so a later --rebuild-from / --recheck-from
    // rewrite shows the ORIGINAL run's config line instead of CLI defaults (Infinity -> null). OMITTED
    // when this write is itself a rewrite of a JSON that never recorded them — so the rewrite process's
    // bogus defaults are never laundered into a fresh settings block.
    ...(st ? { settings: { concurrency: st.concurrency, delay: st.delay, rps: st.rps, maxPages: st.maxPages === Infinity ? null : st.maxPages, maxDepth: st.maxDepth === Infinity ? null : st.maxDepth, includeSubdomains: !!st.includeSubdomains, checkExternal: !!st.checkExternal } } : {}),
    log: { manifest: state.logManifest || "", singleFile: !!state.logSingleFile, parts: state.logParts || [] },
    summary: { pagesCrawled: state.pages.length, queued: state.queue.length, externalLinks: state.external.size, linkInstances: state.pages.reduce((n, p) => n + (p.internal || 0) + (p.external || 0), 0), brokenLinkInstances: active.reduce((n, e) => n + (refsOf(e.url).length || 1), 0), outOfScope: state.outOfScope.size, errorsInternal: active.filter((e) => (e.kind || "internal") !== "external").length, errorsExternal: active.filter((e) => e.kind === "external").length, blocked: (state.blocked || []).length, suppressed: suppressed.length, retries: state.retries || 0, runtimeMs: Number.isFinite(state.runtimeMs) ? state.runtimeMs : Math.max(0, (state.finishedMs || Date.now()) - (state.startedMs || Date.parse(state.startedAt) || Date.now())) },
    internalPages: state.pages,
    externalLinks: [...state.external.values()].map((e) => ({ url: e.url, host: e.host, status: e.status, foundOn: refsOf(e.url) })),
    outOfScopeLinks: [...state.outOfScope.values()].map((e) => ({ url: e.url, foundOn: refsOf(e.url) })),
    errors: active.map(errOut), suppressedErrors: suppressed.map(errOut),
    blocked: (state.blocked || []).map((e) => ({ url: e.url, reason: e.reason, kind: e.kind || "internal", foundOn: refsOf(e.url).length ? refsOf(e.url) : (e.source ? [e.source] : []) })),
  }, null, 2);
}

module.exports = { buildReportJson };
