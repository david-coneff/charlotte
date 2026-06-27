"use strict";
// Report + output layer — extracted from crawl.js (AD-009) so the HTML/JSON report
// generation (the fastest-growing concern) lives on its own. Pure-ish: these take
// crawl state/cfg and either return report HTML (buildReport / buildIndexReport) or
// write the report + JSON to disk (writeOutputs / writeCombinedJson). No crawl-engine
// dependencies — only Node's fs plus the render caps and branding below.
const fs = require("fs");

const REF_PREVIEW = 3;             // referrers shown inline in the external/out-of-scope tables
const RENDER_CAP = Infinity;       // render every row in the HTML (no per-table cap); data is also in --json/--log
const PAGE_SIZE = 1000;            // rows per page when client-side pagination is enabled (cfg.paginate / --paginate)
const BRAND = "Charlotte";         // report branding — the project / repo name
const BRAND_ICON = "🕸️";           // spiderweb glyph: favicon + report header

// Light/dark theme. The palette lives in CSS custom properties (:root = dark default); a light override
// hangs off html[data-theme="light"]. We use a data-ATTRIBUTE (not a class) so it never collides with the
// no-flash tab restorer, which owns html.className (tab-<name>). A tiny head script applies the saved
// choice before first paint; a fixed top-right button toggles + persists it (charlotteTheme in localStorage).
const THEME_LIGHT_CSS = ` html[data-theme="light"]{--bg:#f4f6f9;--panel:#ffffff;--panel2:#eaeef3;--fg:#1c2230;--muted:#5b6675;--accent:#0969da;--link:#0a66c2;--good:#1a7f37;--warn:#9a6700;--bad:#cf222e;--border:#d0d7de;--accent-fg:#ffffff}
 .themebtn{position:fixed;top:12px;right:16px;z-index:30;background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 10px;cursor:pointer;font:inherit;font-size:15px;line-height:1}.themebtn:hover{border-color:var(--accent);color:var(--accent)}`;
const THEME_HEAD = `<script>try{if(localStorage.getItem('charlotteTheme')==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}</script>`;
const THEME_BTN = `<button id="themeToggle" class="themebtn" type="button" title="Toggle light / dark theme">🌙</button>`;
const THEME_JS = `<script>(function(){var b=document.getElementById('themeToggle');if(!b)return;function cur(){return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';}function paint(){b.textContent=cur()==='light'?'☀️':'🌙';b.title='Switch to '+(cur()==='light'?'dark':'light')+' theme';}paint();b.addEventListener('click',function(){if(cur()==='light'){document.documentElement.removeAttribute('data-theme');}else{document.documentElement.setAttribute('data-theme','light');}try{localStorage.setItem('charlotteTheme',cur());}catch(e){}paint();});})();</script>`;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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

// The side-docked link-window script (NEWWIN) and the standalone fix-tracker document
// (TRACKER_TEMPLATE) are large self-contained strings — kept in their own module (AD-036).
const { NEWWIN, TRACKER_TEMPLATE } = require("./report-templates");

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
  // Prefer a runtime carried in from a prior report (so --rebuild-from preserves it);
  // otherwise measure it live from the start/finish stamps.
  const elapsedMs = Number.isFinite(state.runtimeMs) ? state.runtimeMs : Math.max(0, (state.finishedMs || Date.now()) - startedMs);
  const fmtDur = (ms) => {
    const s = Math.round(ms / 1000);
    if (s < 60) return s + "s";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
  };
  // Selectable broken-link export (checkbox column + "export to allowlist") is a
  // final-report feature: partial reports auto-refresh, which would clear ticks.
  const showPick = !partial;
  // The allowlist EXPORT UI (pick checkboxes + "Export to allowlist…" / "Copy lines") is now
  // opt-in and OFF by default — superseded by the fix tracker and the Broken/Working verdict
  // tools. The crawler still ACCEPTS an allowlist as input (--allowlist) regardless; this only
  // governs the in-report export. Turn it back on with --allowlist-export (cfg.allowlistExport).
  const showAllow = showPick && !!cfg.allowlistExport;

  // Total link INSTANCES: every link occurrence — internal AND external — summed across
  // all crawled pages, NOT deduped, so a link in a sitewide nav/footer counts once per
  // page it appears on (twice if it appears twice on a page). Distinct from the unique
  // "Internal destinations" / "External destinations" counts. page.internal/external are the raw
  // per-page counts (extractLinks doesn't dedupe), so this is just their running sum.
  const linkInstances = state.pages.reduce((n, p) => n + (p.internal || 0) + (p.external || 0), 0);

  const stat = (n, label, cls, title) => `<div class="stat ${cls || ""}"${title ? ` title="${esc(title)}"` : ""}><div class="n">${n}</div><div class="l">${esc(label)}</div></div>`;
  // A "broken" stat's number paired with its share (%) of the matching total directly below it in the
  // matrix. The % updates live (setStat rewrites the .pct sibling as triage changes the count); the
  // denominator is the fixed row-2 total. Omitted when the denominator is 0 (nothing to be a share of).
  // fmtPct shows one decimal by default but expands precision so a small-but-nonzero share still shows
  // at least one significant digit (e.g. 0.03% rather than a misleading 0.0%). Kept ES5-clean + mirrored
  // verbatim in the report IIFE (see fmtPct there) so server-render and live updates format identically.
  const fmtPct = (p) => { if (!(p > 0)) return "0.0"; let d = 1; while (d < 10 && Number(p.toFixed(d)) === 0) d++; return p.toFixed(d); };
  const brokenN = (id, count, denom) => `<span id="${id}">${count.toLocaleString()}</span>${denom > 0 ? ` <span class="pct">(${fmtPct((count / denom) * 100)}%)</span>` : ""}`;
  const link = (u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`;
  // A "found on" referrer: clickable when it's a real URL, plain text otherwise.
  const srcLink = (s) => /^https?:\/\//i.test(s) ? link(s) : esc(s || "—");
  const refsOf = (url) => { const s = state.refs.get(url); return s ? [...s] : []; };
  // Broken link INSTANCES: every (page -> broken-link) reference, i.e. each broken link
  // counted once per page that links to it (min 1). This is the cleanup workload and the
  // number of fix-tracker rows. The header stat starts here and is recomputed live in the
  // browser as links are marked "Working" (each such link drops its instances).
  const brokenInstCount = (url) => refsOf(url).length || 1;
  const brokenInstances = active.reduce((n, e) => n + brokenInstCount(e.url), 0);
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
    const rows = arr.map((r) => `<tr><td>${link(r)}</td></tr>`).join("");
    return `<details><summary>${arr.length} pages link here</summary><div class="tablewrap" style="max-height:220px;margin-top:6px"><table class="subtable"><tbody>${rows}</tbody></table></div></details>`;
  };
  // Cap rows rendered per table so a huge crawl can't build a multi-hundred-MB
  // HTML string (and stress GC). Full data is always in --json / --log.
  const capNote = (total) => total > RENDER_CAP ? `<p class="muted">Showing first ${RENDER_CAP.toLocaleString()} of ${total.toLocaleString()} — full set in the JSON/log output.</p>` : "";

  const pages = state.pages.slice().sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
  const extVals = [...state.external.values()].slice(0, RENDER_CAP);

  const errRows = (arr) => arr.slice(0, RENDER_CAP).map((e) => `<tr><td>${link(e.url)}</td><td><span class="pill err">${esc(e.reason)}</span></td><td class="muted">${refCell(e.url, e.source)}</td></tr>`).join("");
  // Blocked rows: a neutral "uncertain" pill + the kind (internal/external).
  const blockedRows = (arr) => arr.slice(0, RENDER_CAP).map((e) => `<tr><td>${link(e.url)}</td><td><span class="pill skip">${esc(e.reason)}</span></td><td>${esc(e.kind || "internal")}</td><td class="muted">${refCell(e.url, e.source)}</td></tr>`).join("");
  // Blocked rows WITH manual-testing boxes (final report only). Same mutually-exclusive
  // Broken/Working pair as the Errors tabs, but the opposite default: blocked links start
  // UNCERTAIN (not counted), so ticking "Broken" CONFIRMS one is dead — counting it toward
  // the header's broken instances and adding it to the fix tracker (routed internal/external
  // by its kind) — while "Working" just records that it loads. data-inst = its referrer count.
  const blockedPickRows = (arr) => arr.slice(0, RENDER_CAP).map((e) => {
    const kind = (e.kind || "internal") === "external" ? "external" : "internal";
    return `<tr data-url="${esc(e.url)}" data-inst="${brokenInstCount(e.url)}" data-kind="${kind}"><td class="tscell" title="Date & time you last marked this link Broken or Working (auto-filled)"></td><td class="tcol"><input type="checkbox" class="brokenbox" data-url="${esc(e.url)}" title="Manual check confirms it's broken — count it and add it to the fix tracker"></td><td class="tcol"><input type="checkbox" class="okbox" data-url="${esc(e.url)}" title="Manual check shows it works — leave it out of the broken count"></td><td>${link(e.url)}</td><td><span class="pill skip">${esc(e.reason)}</span></td><td>${kind}</td><td class="muted">${refCellFix(e.url, e.source)}</td></tr>`;
  }).join("");
  // All referrers of a broken link (full list; capped only at render/embed sites).
  const refsAll = (url, fallback) => {
    const a = refsOf(url);
    if (a.length) return a;
    return [fallback && /^https?:\/\//i.test(fallback) ? fallback : (fallback || "(start)")];
  };
  // "Found on" cell for the Errors/Blocked triage tabs — the referrer page(s) that link to the broken
  // URL. (The per-referrer "Fixed" checkbox that used to sit here was removed: fix-tracking now lives
  // entirely in the standalone fix tracker.) refsAll still feeds the tracker's data (brokenFor).
  const refLink = (r) => /^https?:\/\//i.test(r) ? link(r) : esc(r);
  const refCellFix = (brokenUrl, fallback) => {
    const arr = refsAll(brokenUrl, fallback);
    if (arr.length === 1) return refLink(arr[0]);
    const rows = arr.map((r) => `<tr><td>${refLink(r)}</td></tr>`).join("");
    return `<details><summary>${arr.length} pages link here</summary><div class="tablewrap" style="max-height:220px;margin-top:6px"><table class="subtable"><tbody>${rows}</tbody></table></div></details>`;
  };
  // Error rows WITH a leading checkbox — only on the two "Errors" tabs. Each box
  // carries the data to render an allowlist line (url + reason + a representative
  // referrer), so a selection can be exported as an allowlist appendage.
  // Inner cells of a triage row, shared by the domain/folder-grouped Errors·internal, Errors·external,
  // and (via blockedCells) Blocked sections. data-url/data-inst go on the <tr> in domainGroups.
  const triageCells = (e) => `${showAllow ? `<td class="pickcol"><input type="checkbox" class="pickbox" data-url="${esc(e.url)}" data-reason="${esc(e.reason)}" data-source="${esc(refsOf(e.url)[0] || e.source || "(start)")}"></td>` : ``}<td class="tscell" title="Date & time you last marked this link Broken or Working (auto-filled)"></td><td class="tcol"><input type="checkbox" class="brokenbox" data-url="${esc(e.url)}" title="Manual check confirms it's broken (it already counts by default — this just marks it triaged)"></td><td class="tcol"><input type="checkbox" class="okbox" data-url="${esc(e.url)}" title="Manual check shows it works — drop it from the broken count and the fix tracker"></td><td class="urlcol">${link(e.url)}</td><td><span class="pill err">${esc(e.reason)}</span></td><td class="muted">${refCellFix(e.url, e.source)}</td>`;
  // Errors · external, grouped into collapsible per-domain sections. Each section header carries a
  // domain-level Broken/Working pair that bulk-applies to EVERY link in the domain (e.g. a social
  // site the automated check can't read but that works in a browser) — see the IIFE's wireDomains().
  // Rows carry data-domain so the script can find a domain's members; the box state is derived from
  // the per-link verdicts (no extra storage).
  const hostOf = (u) => { const m = /^[a-z][a-z0-9+.\-]*:\/\/([^/?#]+)/i.exec(String(u)); if (!m) return "(unknown host)"; let h = m[1]; const at = h.indexOf("@"); if (at >= 0) h = h.slice(at + 1); return h.replace(/:\d+$/, "").toLowerCase() || "(unknown host)"; };
  // Grouping key for INTERNAL links: host + first path folder (e.g. "site.gov/about/"), so the
  // Broken·internal tab groups by section the way the external tab groups by domain. Root pages
  // (no folder) group under the bare host. Subdomains naturally land in separate groups.
  const folderOf = (u) => { const m = /^[a-z][a-z0-9+.\-]*:\/\/([^/?#]+)([^?#]*)/i.exec(String(u)); if (!m) return "(unknown)"; let h = m[1]; const at = h.indexOf("@"); if (at >= 0) h = h.slice(at + 1); h = h.replace(/:\d+$/, "").toLowerCase(); const seg = (m[2] || "").split("/").filter(Boolean)[0]; return seg ? h + "/" + seg + "/" : h + "/"; };
  // ---- Non-triage tabs: simple folder/host-grouped collapsible sections ----------------------------
  // The External, Internal-destinations and Out-of-scope tabs aren't triaged (no Broken/Working), but a
  // flat multi-thousand-row table is hard to scan. Reuse the SAME .domgrp collapsible the triage tabs use
  // (caret + name + count) MINUS the verdict controls, wrapped in the same .groupview viewport — so every
  // tab looks, scrolls and collapses identically. keyOf picks the grouping key: hostOf groups External by
  // domain; folderOf groups Internal / Out-of-scope by first-level folder. A separate collapse-only IIFE
  // wires these — it never calls deriveDomain, so these groups never get the triage tabs' amber outline.
  const simpleGroups = (items, keyOf, headHtml, rowFn, tcls) => {
    const m = new Map();
    for (const it of items.slice(0, RENDER_CAP)) { const h = keyOf(it.url); if (!m.has(h)) m.set(h, []); m.get(h).push(it); }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([host, list]) => {
      const rows = list.map(rowFn).join("");
      return `<div class="domgrp"><div class="domhead"><button type="button" class="domtoggle"><span class="caret"></span> <span class="domname">${esc(host)}</span> <span class="muted">(${list.length.toLocaleString()})</span></button></div><div class="tablewrap dombody"><table${tcls ? ` class="${tcls}"` : ""}>${headHtml}<tbody>${rows}</tbody></table></div></div>`;
    }).join("");
  };
  const groupCount = (items, keyOf) => { const s = new Set(); for (const it of items.slice(0, RENDER_CAP)) s.add(keyOf(it.url)); return s.size; };
  // External — grouped by domain (host).
  const extRow = (e) => { const st = e.status === "ok" ? `<span class="pill ok">reachable</span>` : e.status === "err" ? `<span class="pill err">unreachable</span>` : `<span class="pill skip">not checked</span>`; return `<tr><td>${link(e.url)}</td><td>${st}</td><td class="muted">${srcCell(e.url)}</td></tr>`; };
  const extHead = `<thead><tr><th>External URL</th><th>Status</th><th>Found on</th></tr></thead>`;
  const extGroups = simpleGroups(extVals, hostOf, extHead, extRow, "grptbl");
  const extGroupN = groupCount(extVals, hostOf);
  // Internal destinations — grouped by first-level folder. Default column widths live in CSS
  // (#panel-internal .grptbl th:nth-child) so "Reset column widths" reverts to them.
  const pageRow = (p) => `<tr><td>${p.depth}</td><td>${link(p.url)}</td><td>${esc(p.title || "—")}</td><td><span class="pill ok">${p.status}</span></td><td>${p.internal}</td><td>${p.external}</td></tr>`;
  const internalHead = `<thead><tr><th>Depth</th><th>URL</th><th>Title</th><th>Status</th><th>Int</th><th>Ext</th></tr></thead>`;
  const intGroups = simpleGroups(pages, folderOf, internalHead, pageRow, "grptbl");
  const intGroupN = groupCount(pages, folderOf);
  const errextHead = `<thead><tr>${showAllow ? `<th class="pickcol"><input type="checkbox" class="pickall" data-scope="errext" title="Select all"></th>` : ``}<th class="tscell" title="Date &amp; time you last marked the link Broken or Working (auto-filled, saved in this browser)">Last tested</th><th class="tcol" title="Manual check confirms it's broken (it already counts by default)">Broken</th><th class="tcol" title="Manual check shows it works — dropped from the broken count + fix tracker">Working</th><th class="urlcol">External URL</th><th class="reasoncol">Reason</th><th class="foundcol">Found on</th></tr></thead>`;
  const errintHead = `<thead><tr>${showAllow ? `<th class="pickcol"><input type="checkbox" class="pickall" data-scope="errint" title="Select all"></th>` : ``}<th class="tscell" title="Date &amp; time you last marked the link Broken or Working (auto-filled, saved in this browser)">Last tested</th><th class="tcol" title="Manual check confirms it's broken (it already counts by default)">Broken</th><th class="tcol" title="Manual check shows it works — dropped from the broken count + fix tracker">Working</th><th class="urlcol">Broken URL</th><th class="reasoncol">Reason</th><th class="foundcol">Found on</th></tr></thead>`;
  // Inner cells of a BLOCKED triage row (mirrors triageCells, but a neutral "uncertain" pill + a Kind
  // column; default is uncertain, so Broken CONFIRMS-dead and Working records that it loads).
  const blockedCells = (e) => { const kind = (e.kind || "internal") === "external" ? "external" : "internal"; return `<td class="tscell" title="Date & time you last marked this link Broken or Working (auto-filled)"></td><td class="tcol"><input type="checkbox" class="brokenbox" data-url="${esc(e.url)}" title="Manual check confirms it's broken — count it and add it to the fix tracker"></td><td class="tcol"><input type="checkbox" class="okbox" data-url="${esc(e.url)}" title="Manual check shows it works — leave it out of the broken count"></td><td>${link(e.url)}</td><td><span class="pill skip">${esc(e.reason)}</span></td><td>${kind}</td><td class="muted">${refCellFix(e.url, e.source)}</td>`; };
  const blockdHead = `<thead><tr><th class="tscell" title="Date &amp; time you last marked the link Broken or Working (auto-filled, saved in this browser)">Last tested</th><th class="tcol" title="Manual check confirms it's broken — counts it + adds to the fix tracker">Broken</th><th class="tcol" title="Manual check shows it works">Working</th><th class="urlcol">URL</th><th class="reasoncol">Why uncertain</th><th class="kindcol">Kind</th><th class="foundcol">Found on</th></tr></thead>`;
  // Generalized per-domain collapsible grouping — used by BOTH the Errors·external and Blocked tabs.
  // Each header carries a collapse toggle, a live "tested K/N" counter, the bulk-apply All:
  // Broken/Working pair, a Mixture indicator (the domain has both verdicts), and an all-tested
  // indicator — so progress is scannable with the groups collapsed. Rows + controls carry data-domain
  // and data-scope so the IIFE finds a domain's members and derives its header state.
  const domainGroups = (arr, scope, headHtml, cellsFn, keyOf) => {
    const kf = keyOf || hostOf;
    const m = new Map();
    for (const e of arr.slice(0, RENDER_CAP)) { const h = kf(e.url); if (!m.has(h)) m.set(h, []); m.get(h).push(e); }
    const tcls = scope === "blockd" ? "blkpick" : "haspick";
    const dk = (e) => e.kind ? ` data-kind="${e.kind === "external" ? "external" : "internal"}"` : "";
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([host, list]) => {
      const rows = list.map((e) => `<tr data-url="${esc(e.url)}" data-inst="${brokenInstCount(e.url)}" data-domain="${esc(host)}" data-scope="${scope}"${dk(e)}>${cellsFn(e)}</tr>`).join("");
      const dd = `data-domain="${esc(host)}" data-scope="${scope}"`;
      // Custom collapsible (NOT <details>/<summary>): interactive controls inside a <summary> have
      // their clicks eaten by the disclosure toggle, so the verdict boxes wouldn't fire. A .collapsed
      // class on .domgrp drives show/hide deterministically.
      return `<div class="domgrp" ${dd}><div class="domhead"><button type="button" class="domtoggle"><span class="caret"></span> <span class="domname">${esc(host)}</span> <span class="muted">(${list.length})</span> <span class="muted domprog" ${dd}></span></button><span class="domverdict"><span class="domall muted">All:</span><label class="domlbl" title="Mark every link in this group Broken at once"><input type="checkbox" class="dombroken" ${dd}> Broken</label><label class="domlbl" title="Mark every link in this group Working at once"><input type="checkbox" class="domworking" ${dd}> Working</label><label class="domlbl ind" title="Indicator only — this group has a mix of Broken and Working verdicts"><input type="checkbox" class="dommixture" ${dd} disabled> Mixture of broken/working</label><label class="domlbl ind" title="Indicator only — every link in this group has been tested (marked Broken or Working)"><input type="checkbox" class="domalltested" ${dd} disabled> all tested</label></span></div><div class="tablewrap dombody"><table class="${tcls}">${headHtml}<tbody>${rows}</tbody></table></div></div>`;
    }).join("");
  };
  const domainTools = (scope) => `<div class="exptools"><button type="button" class="btn" id="${scope}Expand">Expand all</button><button type="button" class="btn" id="${scope}Collapse">Collapse all</button></div>`;
  // Wrap a grouped list in the fixed-height scroll viewport so every tab scrolls internally (consistent
  // with the flat .tablewrap tables) instead of stretching the page.
  const groupView = (inner) => `<div class="groupview">${inner}</div>`;
  const domainHelp = `<p class="muted" style="margin:2px 0 10px">Grouped by domain. Each header has an <strong>All: Broken / Working</strong> pair that applies to <em>every</em> link in that domain at once — handy when a whole site (e.g. a social network) is systematically misread by the automated check but works in a browser. The header also shows a live <strong>tested K/N</strong> count, a <strong>Mixture</strong> flag (both verdicts present) and an <strong>all tested</strong> flag, so you can scan progress with the groups collapsed.</p>`;
  const folderHelp = `<p class="muted" style="margin:2px 0 10px">Grouped by <strong>first-level folder</strong> (e.g. <code>site.gov/about/</code> vs <code>site.gov/blog/</code>; root pages group under the bare host). Each header has an <strong>All: Broken / Working</strong> pair that applies to <em>every</em> link in that section at once, plus a live <strong>tested K/N</strong> count, a <strong>Mixture</strong> flag and an <strong>all tested</strong> flag — so you can triage a whole section and scan progress with the groups collapsed.</p>`;
  // Toolbar above an Errors table: a live count + copy/export actions (disabled
  // until something is ticked). The select-all lives in the table header cell.
  // The fix-tracker export button now lives once in the always-visible share bar (below), not on
  // each tab. exportBar is just the (opt-in) allowlist-selection toolbar — empty when that's off.
  const exportBar = (scope) => showAllow ? `<div class="exportbar"><span class="selcount" data-scope="${scope}">0 selected</span><span class="grow"></span><button type="button" class="btn copybtn" data-scope="${scope}" disabled>⧉ Copy lines</button><button type="button" class="btn exportbtn" data-scope="${scope}" disabled>⬇ Export to allowlist…</button></div>` : ``;
  // Live manual-testing progress for an Errors tab (updated by the script below as the
  // Broken / Working boxes are ticked): how far testing has gotten + confirmed broken/working.
  const testBar = (scope) => `<div class="testbar"><span class="tcount" data-scope="${scope}">Manually tested: 0 / 0 · confirmed broken: 0 · confirmed working: 0</span><button type="button" class="btn colreset" data-scope="${scope}" title="Restore the default column widths on this tab">↔ Reset column widths</button></div>`;
  const blockedHelp = `<p class="muted" style="margin:2px 0 10px">Two mutually-exclusive boxes per link: <strong>Broken</strong> confirms this uncertain link really is dead — confirmed ones join the <strong>Broken hyperlink instances</strong> count (routed internal/external by their kind); <strong>Working</strong> confirms it actually loads. Leave both unticked to keep it uncertain (not counted). <em>Until you mark one <strong>Working</strong>, an uncertain link stays in the fix-tracker export</em>, so the tracker is a complete to-review list. Either tick counts as tested and auto-fills the <strong>Last tested</strong> date &amp; time. Ticks are saved in this browser.</p>`;
  const blockedCounter = (scope) => `<div class="testbar"><span class="tcount" data-scope="${scope}">Manually tested: 0 / 0 · confirmed broken: 0 · confirmed working: 0</span><button type="button" class="btn colreset" data-scope="${scope}" title="Restore the default column widths on this tab">↔ Reset column widths</button></div>`;
  // Embedded fix-tracker payload + self-rendering template (final report only).
  const brokenFor = (arr) => arr.slice(0, RENDER_CAP).map((e) => ({ url: e.url, reason: e.reason, refs: refsAll(e.url, e.source) }));
  // Embed blocked links split by kind too, so confirmed-broken ones can be routed into the
  // tracker's internal/external lists at export time (see exportTracker).
  const blockedInt = blocked.filter((e) => (e.kind || "internal") !== "external");
  const blockedExt = blocked.filter((e) => e.kind === "external");
  const trackerData = { host: state.startHost, generatedAt: state.startedAt, internal: brokenFor(activeInt), external: brokenFor(activeExt), blockedInt: brokenFor(blockedInt), blockedExt: brokenFor(blockedExt) };
  const trackerLiteral = JSON.stringify(TRACKER_TEMPLATE).replace(/</g, "\\u003c");
  const brokenLiteral = JSON.stringify(trackerData).replace(/</g, "\\u003c");
  const trackerEmbed = showPick
    ? `<script>window.__CW_BROKEN__=${brokenLiteral};window.__CW_TPL__=${trackerLiteral};</script>`
    : "";
  // Share toolbar — only meaningful when there are links to triage. Lets you carry your
  // Broken/Working verdicts (which live in localStorage, not the file) to someone else.
  const hasTriage = showPick && (activeInt.length || activeExt.length || blocked.length);
  const shareBar = `<div class="card sharebar"><div class="exportbar" style="margin-bottom:12px;align-items:baseline"><button type="button" class="btn trackbtn" title="Build one editable, self-contained checklist of every link still to fix — all broken + blocked links across internal AND external, except those you've marked Working — grouped by referrer page">🔧 Export fix tracker</button><span class="muted" style="font-size:12px">One checklist of everything still to fix — every broken &amp; blocked link (internal + external) <strong>except those you've marked Working</strong>, grouped by page. No need to open each tab.</span></div><p class="muted" style="margin:0 0 8px;font-size:13px"><strong>Share your testing verdicts.</strong> Your Broken/Working ticks &amp; timestamps are saved in <em>this</em> browser only — they don't travel if you just email this file. To hand them off:</p><div class="exportbar"><button type="button" class="btn" id="cwSaveCopy" title="Download a new self-contained report with your current verdicts baked in — email that file and the recipient just opens it">💾 Save shareable copy</button><span class="vsep"></span><button type="button" class="btn" id="cwExportV" title="Download your verdicts as a small JSON file to send alongside the report">⬇ Export verdicts</button><button type="button" class="btn" id="cwImportV" title="Load verdicts from a JSON file someone shared with you (merges by link, then reloads)">⬆ Import verdicts</button><input type="file" id="cwImportFile" accept="application/json,.json" style="position:fixed;left:-9999px;width:1px;height:1px;opacity:0"></div></div>`;
  // One-line helper under each Errors table explaining the two kinds of checkbox.
  const pickHelp = `<p class="muted" style="margin:2px 0 10px">${showAllow ? `First box selects a link for the <strong>allowlist</strong>. Then two` : `Two`} mutually-exclusive boxes: <strong>Broken</strong> confirms it's really broken (it already counts by default — this just marks it triaged); <strong>Working</strong> marks it actually loads — Working links drop out of the broken count and the fix tracker (so one false positive can't flood it). Leave both unticked to keep the default “assumed broken”. The <strong>Last tested</strong> column auto-fills the date &amp; time of your latest verdict. <strong>Export fix tracker</strong> saves the still-broken links, grouped by referrer page, as a standalone editable checklist (one contact note per page, each broken link with its own Fixed checkbox). Verdicts are saved in this browser.</p>`;
  // Collapsible wrapper for a tab's lengthy explanatory text — open by default, but the operator can
  // collapse it to reclaim screen space (the open/closed state persists with the other <details>).
  const helpBox = (inner) => `<details class="helpbox" open><summary>How this tab works</summary><div class="helpbody">${inner}</div></details>`;

  // Out-of-scope (same domain, outside the chosen subsection) — only shown when scoped.
  const scoped = !!state.pathPrefix;
  const oosItems = [...state.outOfScope.values()].sort((a, b) => a.url.localeCompare(b.url));
  const oosRow = (e) => `<tr><td>${link(e.url)}</td><td class="muted">${srcCell(e.url)}</td></tr>`;
  const oosHead = `<thead><tr><th>URL</th><th>Found on</th></tr></thead>`;
  const oosGroupN = groupCount(oosItems, folderOf);
  const oosStat = scoped ? stat(state.outOfScope.size, "Out of scope", "") : "";
  const oosTab = scoped ? `<div class="tab" data-tab="outscope">Out of scope (${state.outOfScope.size})</div>` : "";
  const oosPanel = scoped ? `<div class="panel hidden" id="panel-outscope">${state.outOfScope.size ? `<p class="muted">Same domain but outside <code>${esc(state.pathPrefix)}</code> — recorded, not crawled.</p>${capNote(state.outOfScope.size)}<div class="exptools"><button type="button" class="btn" id="oosExpand">Expand all</button><button type="button" class="btn" id="oosCollapse">Collapse all</button><span class="muted" style="font-size:12px">${oosGroupN} folder${oosGroupN === 1 ? "" : "s"}</span><button type="button" class="btn grpcolreset" data-scope="outscope" title="Restore the default column widths on this tab">↔ Reset column widths</button></div>${groupView(simpleGroups(oosItems, folderOf, oosHead, oosRow, "grptbl"))}` : `<p class="muted">No out-of-scope links found.</p>`}</div>` : "";

  // Header line = crawl settings + run metadata (runtime, suppressed). A FRESH crawl's cfg is real; a
  // --rebuild-from / --recheck-from rewrite restores the settings from the JSON's "settings" block
  // (AD-049). But a JSON written BEFORE that block existed has nothing to restore, so for such a rewrite
  // the cfg is only the rewrite process's CLI DEFAULTS (e.g. "max 200 pages") — fabricated, not the
  // crawl's. settingsKnown is false ONLY in that case; then we say so rather than show bogus limits.
  const settingsKnown = settingsAreKnown(state, cfg);
  const scopeLabel = scoped ? `scope ${esc(state.pathPrefix)}/` : "whole domain";
  const runMeta = `${partial ? `${fmtDur(elapsedMs)} so far` : `ran in ${fmtDur(elapsedMs)}`} · ${suppressed.length.toLocaleString()} suppressed`;
  let cfgLine;
  if (settingsKnown) {
    const settings = effSettings(state, cfg);
    const depthLabel = settings.maxDepth === Infinity ? "unlimited" : settings.maxDepth;
    const pagesLabel = settings.maxPages === Infinity ? "unlimited" : settings.maxPages;
    cfgLine = `${settings.concurrency} concurrent · ${settings.delay}ms delay · ${settings.rps ? settings.rps + " rps cap" : "no rps cap"}${state.crawlDelay ? ` · crawl-delay ${state.crawlDelay}s` : ""} · max ${pagesLabel} pages / depth ${depthLabel} · ${scopeLabel}${settings.includeSubdomains ? " · subdomains internal" : ""}${settings.checkExternal ? " · external checked" : ""}${state.retries ? ` · ${state.retries} rate-limit retries` : ""} · ${runMeta}`;
  } else {
    cfgLine = `crawl settings not recorded (rebuilt from an older crawl's JSON) · ${scopeLabel}${state.retries ? ` · ${state.retries} rate-limit retries` : ""} · ${runMeta}`;
  }
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

  // Optional client-side pagination (--paginate). All rows stay embedded; this only
  // shows PAGE_SIZE at a time (with Prev/Next/jump) so a huge report stays responsive.
  // Applies to every data table — including each broken link's nested "found on"
  // referrer list (which is otherwise uncapped, however many pages link there).
  // Display-only: selection/export read every row regardless of which page is shown.
  const pagerScript = cfg.paginate ? `<script>(function(){
  var PAGE_SIZE=${Number(cfg.pageSize) > 0 ? Math.floor(Number(cfg.pageSize)) : PAGE_SIZE};
  function rows(tb){ var o=[],c=tb.children,i; for(i=0;i<c.length;i++){ if(c[i].tagName==='TR') o.push(c[i]); } return o; }
  function el(t,c,x){ var e=document.createElement(t); if(c)e.className=c; if(x!=null)e.textContent=x; return e; }
  function setup(table){
    var tb=table.tBodies[0]; if(!tb) return;
    var rw=rows(tb); if(rw.length<=PAGE_SIZE) return;
    var pages=Math.ceil(rw.length/PAGE_SIZE), cur=-1, tw=table.parentNode;
    var bar=el('div','pager'), prev=el('button','btn','\\u2039 Prev'), next=el('button','btn','Next \\u203a');
    prev.type='button'; next.type='button';
    var label=el('span','muted pglabel'), grow=el('span','grow'), jl=el('span','muted','Go to'), jump=el('input','pgjump');
    jump.type='number'; jump.min='1'; jump.max=String(pages);
    bar.appendChild(prev); bar.appendChild(next); bar.appendChild(label); bar.appendChild(grow); bar.appendChild(jl); bar.appendChild(jump);
    function show(p){
      p=Math.max(0,Math.min(pages-1,p)); if(p===cur) return; cur=p;
      var start=cur*PAGE_SIZE, end=Math.min(rw.length,start+PAGE_SIZE), i;
      for(i=0;i<rw.length;i++){ rw[i].style.display=(i>=start&&i<end)?'':'none'; }
      label.textContent='Page '+(cur+1)+' of '+pages+' \\u00b7 rows '+(start+1).toLocaleString()+'\\u2013'+end.toLocaleString()+' of '+rw.length.toLocaleString();
      prev.disabled=(cur===0); next.disabled=(cur===pages-1); jump.value=String(cur+1);
      if(tw) tw.scrollTop=0;
    }
    prev.addEventListener('click',function(){ show(cur-1); });
    next.addEventListener('click',function(){ show(cur+1); });
    jump.addEventListener('change',function(){ var v=parseInt(jump.value,10); if(!isNaN(v)) show(v-1); });
    tw.parentNode.insertBefore(bar,tw);
    show(0);
  }
  var t=document.querySelectorAll('.tablewrap > table'),i;
  for(i=0;i<t.length;i++){ setup(t[i]); }
})();</script>
` : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${partial ? "[crawling] " : ""}${BRAND_ICON} ${BRAND} · Crawl report — ${esc(state.startHost)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Ctext%20y='.9em'%20font-size='90'%3E%F0%9F%95%B8%EF%B8%8F%3C/text%3E%3C/svg%3E">
<style>
 :root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--link:#8ec5ff;--good:#4ade80;--bad:#f87171;--warn:#fbbf24;--border:#2c3340;--accent-fg:#06121f}
${THEME_LIGHT_CSS}
 *{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
 header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--panel)}header h1{margin:0 0 4px;font-size:18px}header p{margin:0;color:var(--muted);font-size:13px}
 main{max-width:1500px;margin:0 auto;padding:24px}.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:20px}
 /* Two rows of broken-over-total pairs (col 1–4) + Blocked in col 5. Fixed 5 columns so each broken
    stat sits directly above its total; collapses to 2 columns on narrow screens. */
 .stats{display:grid;gap:12px;grid-template-columns:repeat(5,minmax(0,1fr))}
 @media (max-width:640px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
 .stat{background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center}.stat .n{font-size:26px;font-weight:700}.stat .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
 .stat .n .pct{font-size:14px;font-weight:600;color:var(--muted)}
 .stat.good .n{color:var(--good)}.stat.bad .n{color:var(--bad)}.stat.warn .n{color:var(--warn)}
 /* Test-completeness outline on the three "broken" stats: green = every link in that category has a
    verdict (count is final); amber = some still untested (count may change). Inset outline -> no shift. */
 .stat.tested-all{outline:2px dashed var(--good);outline-offset:-1px}
 .stat.tested-partial{outline:2px dashed var(--warn);outline-offset:-1px}
 /* Legend card (grey dashed) keying the green/amber outlines, in the empty row-2/col-5 slot. */
 .statleg{outline:2px dashed var(--muted);outline-offset:-1px;text-align:left;display:flex;flex-direction:column;justify-content:center;gap:5px}
 .legttl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
 .legrow{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--fg);line-height:1.15}
 .legbox{flex:none;width:18px;height:13px;border:2px dashed var(--border);border-radius:3px}
 .legbox.lg-g{border-color:var(--good)}.legbox.lg-a{border-color:var(--warn)}
 table{width:100%;border-collapse:collapse;font-size:13px;min-width:820px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
 th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;position:sticky;top:0;background:var(--panel)}
 /* URL and Found-on columns get real width; long URLs wrap at sensible points, not every character */
 td{overflow-wrap:anywhere;word-break:normal}
 th:first-child,td:first-child{min-width:360px}
 td:last-child{min-width:300px}
 /* Internal-pages table: a 1–2 digit Depth and the small Status/Int/Ext cells shouldn't
    hog width — narrow them and give the space to URL + Title so those wrap far less. */
 td a,a{color:var(--link);text-decoration:none}td a:hover,a:hover{text-decoration:underline}
 /* Fixed-height scroll viewport. resize:vertical adds a bottom-right grip so the operator can drag the
    pane taller/shorter to taste (min-height keeps it from collapsing). Applies to flat tables here and to
    the grouped .groupview below. The triage groups' own .dombody is overflow:visible (no grip there). */
 /* Flat tables (Suppressed, log, read-only/partial fallback) size to content up to a cap, so a short list
    isn't a tall empty box; still drag-resizable. The big grouped lists use .groupview (definite height). */
 .tablewrap{max-height:460px;overflow:auto;border:1px solid var(--border);border-radius:8px;resize:vertical}
 /* Every tab's list lives in a FIXED-HEIGHT viewport that scrolls internally (consistent with the flat
    .tablewrap tables) — so a long grouped list scrolls in place instead of stretching the whole page. */
 .groupview{height:460px;min-height:160px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;resize:vertical}
 .groupview .domgrp:last-child{margin-bottom:0}
 .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600}.pill.ok{background:rgba(74,222,128,.15);color:var(--good)}.pill.err{background:rgba(248,113,113,.15);color:var(--bad)}.pill.skip{background:rgba(251,191,36,.15);color:var(--warn)}
 .muted{color:var(--muted)}h2{font-size:15px;margin:0 0 12px}details summary{cursor:pointer;font-weight:600;padding:6px 0}
 .tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}.tab{padding:7px 14px;border-radius:7px;background:var(--panel2);border:1px solid var(--border);cursor:pointer;font-size:13px}.tab.active{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
 .hidden{display:none}code{background:var(--panel2);padding:1px 5px;border-radius:4px}
 .exptools{display:flex;align-items:center;gap:10px;margin:0 0 12px}
 /* Collapsible per-tab explanatory text — a muted, small disclosure so the (lengthy) help can be folded away. */
 .helpbox{margin:0 0 10px}
 .helpbox>summary{cursor:pointer;color:var(--muted);font-size:12px;font-weight:600;padding:4px 0}
 .helpbox>summary:hover{color:var(--accent)}
 .helpbox .helpbody{margin-top:4px}
 /* Triage tables — columns sized by CLASS so the layout holds with or without the (opt-in)
    allowlist pick column: .pickcol pick box · .tscell timestamp · .tcol Broken/Working · .urlcol URL. */
 .pickcol{width:34px;text-align:center}
 .tcol{width:80px;text-align:center}
 .tscell{width:140px;white-space:nowrap}
 td.tscell{font-size:13px;color:var(--muted)}
 th.tscell{white-space:nowrap}
 .urlcol{width:380px}
 .reasoncol{width:180px}
 /* Triage AND non-triage grouped tables (.grptbl) use a FIXED layout (predictable widths) and size to the
    SUM of their column widths (width:max-content) rather than stretching to 100% — so no column is starved
    and a very wide window no longer leaves a giant mid-table gap. Every column is RESIZABLE: drag the grip
    on a header's right edge. There is NO enforced minimum width — drag a column as narrow as you like.
    Widths persist per browser and broadcast across a tab's groups so they stay aligned; a "Reset column
    widths" button restores the defaults. */
 table.haspick,table.blkpick,table.grptbl{table-layout:fixed;width:max-content;min-width:0;max-width:none}
 table.haspick th,table.haspick td,table.blkpick th,table.blkpick td,table.grptbl th,table.grptbl td{min-width:0}
 /* Non-triage default column widths live in CSS (not inline) so "Reset column widths" — which clears the
    inline width the drag writes — reverts to these, exactly as the triage tables revert to .urlcol/etc. */
 #panel-internal .grptbl th:nth-child(1){width:64px}#panel-internal .grptbl th:nth-child(2){width:380px}#panel-internal .grptbl th:nth-child(3){width:320px}#panel-internal .grptbl th:nth-child(4){width:96px}#panel-internal .grptbl th:nth-child(5){width:64px}#panel-internal .grptbl th:nth-child(6){width:64px}
 #panel-external .grptbl th:nth-child(1){width:460px}#panel-external .grptbl th:nth-child(2){width:120px}#panel-external .grptbl th:nth-child(3){width:420px}
 #panel-outscope .grptbl th:nth-child(1){width:520px}#panel-outscope .grptbl th:nth-child(2){width:420px}
 .haspick th,.blkpick th,.grptbl th{position:relative}
 .colgrip{position:absolute;top:0;right:0;width:8px;height:100%;cursor:col-resize;user-select:none}
 .colgrip:hover,.colgrip.drag{box-shadow:inset -2px 0 0 var(--accent)}
 table.haspick .foundcol,table.blkpick .foundcol{width:236px}
 .blkpick .kindcol{width:92px}
 /* Errors·external is grouped into collapsible per-domain sections. A custom collapsible (not
    <details>): a .domtoggle button + the domain Broken/Working pair as siblings, so the checkbox
    clicks aren't eaten by a <summary> and the script can collapse via a .collapsed class. */
 .domgrp{border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow:hidden}
 .domhead{display:flex;align-items:center;gap:10px;padding:6px 10px;background:var(--panel2);flex-wrap:wrap}
 /* Domains with untested links get a dashed-amber header (inset outline: no clip from the group's
    overflow:hidden, no layout shift); it clears once every link in the domain has a verdict. */
 .domgrp.untested .domhead{outline:2px dashed var(--warn);outline-offset:-2px}
 .domtoggle{flex:1;min-width:200px;background:none;border:none;color:var(--fg);font:inherit;font-weight:600;cursor:pointer;padding:4px 2px;text-align:left;overflow-wrap:anywhere}
 .domtoggle:hover{color:var(--accent)}
 .caret::before{content:"▼";display:inline-block;width:1em;font-size:11px;color:var(--muted);font-weight:400}
 .domgrp.collapsed .caret::before{content:"▶"}
 .domname{overflow-wrap:anywhere}
 .domverdict{font-weight:400;font-size:12px;color:var(--muted);display:inline-flex;flex-wrap:wrap;align-items:center}
 .domall{margin-right:2px}
 .domprog{font-size:12px}
 .domlbl{cursor:pointer;margin-left:14px;white-space:nowrap}
 .domlbl input{cursor:pointer;vertical-align:middle;margin:0 4px 0 0}
 /* Mixture + all-tested are read-only indicators (disabled); they go green when on. */
 .domlbl.ind{cursor:default}.domlbl.ind input{cursor:default}.domlbl.ind.on{color:var(--good)}
 .domgrp.collapsed .dombody{display:none}
 /* The domain's OWN table wrapper shows in full (no inner scrollbar); scope this to .dombody so it does
    NOT also hit the nested "Found on" <details> wrapper, whose inline max-height + scroll must stay. */
 .domgrp .dombody{height:auto;max-height:none;min-height:0;overflow:visible;border:none;border-top:1px solid var(--border);border-radius:0;resize:none}
 /* The drag-to-resize grip + min-height belong only to TOP-LEVEL viewports. Nested .tablewrap (the
    "Found on" referrer sublists, error subtables) must size to content and never sprout their own grip. */
 .tablewrap .tablewrap{height:auto;min-height:0;resize:none}
 .haspick input[type=checkbox],.blkpick input[type=checkbox]{cursor:pointer;width:15px;height:15px}
 .testbar{margin:0 0 12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.tcount{color:var(--muted);font-size:12px}
 .colreset,.grpcolreset{margin-left:auto;font-size:12px;padding:4px 10px}
 tr.notbroken td:not(.tcol):not(.tscell):not(.pickcol){opacity:.45;text-decoration:line-through}
 tr.confirmed td:not(.tcol):not(.tscell):not(.pickcol){color:var(--bad)}
 .exportbar{display:flex;align-items:center;gap:10px;margin:0 0 10px;flex-wrap:wrap}.exportbar .grow{flex:1}
 .sharebar{border-left:3px solid var(--accent);padding-top:12px;padding-bottom:12px}.sharebar .exportbar{margin:0}
 .selcount{color:var(--muted);font-size:12px}
 .btn{background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:6px 12px;font-size:13px;cursor:pointer}.btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}.btn:disabled{opacity:.5;cursor:default}
 .btn.exportbtn:not(:disabled){background:var(--accent);color:var(--accent-fg);border-color:var(--accent);font-weight:600}
 /* The fix-tracker export is the primary triage output — make the one share-bar button stand out. */
 .sharebar .trackbtn{background:var(--accent);color:var(--accent-fg);border-color:var(--accent);font-weight:600}.sharebar .trackbtn:hover{color:var(--accent-fg);filter:brightness(1.08)}
 .toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--panel2);border:1px solid var(--accent);color:var(--fg);padding:10px 16px;border-radius:8px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:9}.toast.show{opacity:1}
 .vsep{display:inline-block;width:1px;height:20px;background:var(--border);margin:0 2px;vertical-align:middle}
 /* No-flash tab restore: a head script sets html.tab-NAME before first paint so
    the correct tab/panel renders immediately, not the default then a swap. */
 html[class*="tab-"] .panel{display:none}
 html.tab-internal #panel-internal,html.tab-external #panel-external,html.tab-outscope #panel-outscope,html.tab-errint #panel-errint,html.tab-errext #panel-errext,html.tab-blockd #panel-blockd,html.tab-suppressed #panel-suppressed{display:block}
 html[class*="tab-"] .tab{background:var(--panel2);color:var(--fg);border-color:var(--border)}
 html.tab-internal .tab[data-tab="internal"],html.tab-external .tab[data-tab="external"],html.tab-outscope .tab[data-tab="outscope"],html.tab-errint .tab[data-tab="errint"],html.tab-errext .tab[data-tab="errext"],html.tab-blockd .tab[data-tab="blockd"],html.tab-suppressed .tab[data-tab="suppressed"]{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
 .subtable{width:100%;border-collapse:collapse}.subtable td{padding:4px 8px;border-bottom:1px solid var(--border)}
 details summary{color:var(--accent)}
 /* Client-side pagination bar (only present with --paginate, above any table over a page in size, incl. nested referrer lists). */
 .pager{display:flex;align-items:center;gap:8px;margin:0 0 8px;flex-wrap:wrap}.pager .grow{flex:1}.pager .pglabel{font-size:12px}
 .pager .pgjump{width:64px;background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font:inherit;font-size:12px}
</style>
<script>(function(){try{var n=(location.hash||'').substring(1);if(!n){try{n=localStorage.getItem('charlotteTab')||'';}catch(e){}}if(n)document.documentElement.className='tab-'+n;}catch(e){}})();</script>
${THEME_HEAD}</head><body>${THEME_BTN}
<header><h1>${partial ? "[crawling] " : ""}${BRAND_ICON} ${BRAND} <span class="muted" style="font-weight:400">· Crawl report</span> — ${esc(state.startHost)}</h1>
<p>${esc(cfg.startUrl)} · ${esc(state.startedAt)}<br>${esc(cfgLine)}</p>${banner}</header>
<main>
 <div class="card"><div class="stats">
  ${stat(brokenN("brokenInstN", brokenInstances, linkInstances), "Broken hyperlink instances", brokenInstances ? "bad" : "", "Hyperlink instances that point at a broken destination — each broken destination counted once per page that links to it (the real cleanup workload). The % is its share of all Hyperlink instances (the total below). Updates live as you mark Errors links “Working” or confirm Blocked links “Broken”. Outline: GREEN dashed once every internal + external + blocked link has been tested (so this total is final); AMBER while some are still untested (it may yet change).")}
  ${stat(brokenN("brokenIntN", activeInt.length, state.pages.length), "Broken · internal", activeInt.length ? "bad" : "", "Unique broken internal destinations — pages on your site that don't load. The % is relative to Internal destinations (the total below). Updates live as you triage. Outline: GREEN dashed once every internal link (errors + blocked) has been tested; AMBER while some are still untested.")}
  ${stat(brokenN("brokenExtN", activeExt.length, state.external.size), "Broken · external", activeExt.length ? "bad" : "", "Unique broken external destinations — off-site URLs that don't resolve. The % is its share of External destinations (the total below). Updates live as you triage. Outline: GREEN dashed once every external link (errors + blocked) has been tested; AMBER while some are still untested.")}
  ${stat(brokenN("brokenTotN", activeInt.length + activeExt.length, state.pages.length + state.external.size), "Total unique destinations broken", (activeInt.length + activeExt.length) ? "bad" : "", "Total unique destinations confirmed broken — Broken · internal + Broken · external, each URL counted once. The % is its share of Total unique destinations (directly below). Updates live as you triage. Outline: GREEN dashed once every internal + external + blocked link has been tested; AMBER while some are still untested.")}
  ${stat(`<span id="blockedN">${blocked.length.toLocaleString()}</span>`, "Blocked · uncertain", blocked.length ? "warn" : "", "Links the automated check couldn't confirm (auth, anti-bot, rate-limiting, timeouts) — very likely fine in a real browser. Not counted as broken until you confirm one. Sits apart from the broken/total matrix because it's neither. Outline: GREEN dashed once every blocked link has been tested (marked Broken or Working); AMBER while some are still untested.")}
  ${stat(linkInstances.toLocaleString(), "Hyperlink instances", "", "Every hyperlink occurrence across all crawled pages (internal + external), NOT deduplicated — a destination linked from N pages counts N times. So this runs much larger than the unique destination counts.")}
  ${stat(state.pages.length.toLocaleString(), "Internal destinations", "", "Unique same-domain pages crawled — distinct destinations on your own site. (One per URL, however many pages link to it.)")}
  ${stat(state.external.size.toLocaleString(), "External destinations", "", "Unique off-site URLs your pages link to. Usually far fewer than the hyperlink instances — one destination is typically linked from many pages.")}
  ${stat((state.pages.length + state.external.size).toLocaleString(), "Total unique destinations", "", "Every distinct destination Charlotte saw — Internal destinations + External destinations, each URL counted once. The total whose broken subset sits directly above it.")}
  ${hasTriage ? `<div class="stat statleg" title="What the dashed outline around each broken / blocked card means"><div class="legttl">Outline key</div><div class="legrow"><span class="legbox lg-g"></span><span>all tested — count is final</span></div><div class="legrow"><span class="legbox lg-a"></span><span>some untested — may change</span></div></div>` : ``}
  ${oosStat}
  ${partial ? stat(state.queue.length, "Queued", "") : ""}
 </div>
 <p class="muted" style="margin:10px 2px 0;font-size:13px"><strong>Destinations</strong> are <em>unique</em> URLs (there are relatively few); <strong>instances</strong> count <em>every</em> hyperlink to them across all pages (there are many). One destination linked from 500 pages is <strong>1 destination</strong> but <strong>500 hyperlink instances</strong>.</p>
 </div>
 ${hasTriage ? shareBar : ""}
 <div class="card">
  <div class="tabs">
   <div class="tab active" data-tab="internal">Internal destinations (${state.pages.length.toLocaleString()})</div>
   <div class="tab" data-tab="external">External destinations (${state.external.size.toLocaleString()})</div>
   ${oosTab}
   <div class="tab" data-tab="errint">Broken · internal (${activeInt.length.toLocaleString()})</div>
   <div class="tab" data-tab="errext">Broken · external (${activeExt.length.toLocaleString()})</div>
   <div class="tab" data-tab="blockd">Blocked · uncertain (${blocked.length.toLocaleString()})</div>
   <div class="tab" data-tab="suppressed">Suppressed (${suppressed.length.toLocaleString()})</div>
  </div>
  <div class="panel" id="panel-internal">${pages.length ? `${capNote(pages.length)}<div class="exptools"><button type="button" class="btn" id="intExpand">Expand all</button><button type="button" class="btn" id="intCollapse">Collapse all</button><span class="muted" style="font-size:12px">${intGroupN} folder${intGroupN === 1 ? "" : "s"}</span><button type="button" class="btn grpcolreset" data-scope="internal" title="Restore the default column widths on this tab">↔ Reset column widths</button></div>${groupView(intGroups)}` : `<p class="muted">No pages crawled.</p>`}</div>
  <div class="panel hidden" id="panel-external">${state.external.size ? `${capNote(state.external.size)}<div class="exptools"><button type="button" class="btn" id="extExpand">Expand all</button><button type="button" class="btn" id="extCollapse">Collapse all</button><span class="muted" style="font-size:12px">${extGroupN} domain${extGroupN === 1 ? "" : "s"}</span><button type="button" class="btn grpcolreset" data-scope="external" title="Restore the default column widths on this tab">↔ Reset column widths</button></div>${groupView(extGroups)}` : `<p class="muted">No external links found.</p>`}</div>
  ${oosPanel}
  <div class="panel hidden" id="panel-errint">${activeInt.length ? `<p class="muted">Broken internal pages — these are yours to fix.</p>${showPick ? exportBar("errint") + helpBox(pickHelp + folderHelp) + testBar("errint") + domainTools("errint") + groupView(domainGroups(activeInt, "errint", errintHead, triageCells, folderOf)) : `<div class="tablewrap"><table><thead><tr><th>Broken URL</th><th class="reasoncol">Reason</th><th class="foundcol">Found on</th></tr></thead><tbody>${errRows(activeInt)}</tbody></table></div>`}` : `<p class="muted">No internal errors. 🎉</p>`}</div>
  <div class="panel hidden" id="panel-errext">${activeExt.length ? `<p class="muted">Unreachable external links — found on your pages, but the destination is down. Fix the link or remove it.</p>${showPick ? exportBar("errext") + helpBox(pickHelp + domainHelp) + testBar("errext") + domainTools("errext") + groupView(domainGroups(activeExt, "errext", errextHead, triageCells)) : `<div class="tablewrap"><table><thead><tr><th>External URL</th><th class="reasoncol">Reason</th><th class="foundcol">Found on</th></tr></thead><tbody>${errRows(activeExt)}</tbody></table></div>`}` : `<p class="muted">${cfg.checkExternal ? "No unreachable external links. 🎉" : "External links weren't verified — enable “Verify external links resolve”."}</p>`}</div>
  <div class="panel hidden" id="panel-blockd">${blocked.length ? `<p class="muted">Our automated check couldn't confirm these (auth, anti-bot, rate-limiting, or timeouts) — they very likely work in a real browser. Verify by hand before treating as broken. Re-running with <code>--browser</code> and a slower rate (<code>--concurrency 1 --rps 0.5</code>) clears many of them.</p>${showPick ? helpBox(blockedHelp + domainHelp) + blockedCounter("blockd") + domainTools("blockd") + groupView(domainGroups(blocked, "blockd", blockdHead, blockedCells)) : `${capNote(blocked.length)}<div class="tablewrap"><table><thead><tr><th>URL</th><th class="reasoncol">Why uncertain</th><th class="kindcol">Kind</th><th class="foundcol">Found on</th></tr></thead><tbody>${blockedRows(blocked)}</tbody></table></div>`}` : `<p class="muted">Nothing blocked or uncertain. 🎉</p>`}</div>
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
${trackerEmbed}
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
    // Only the allowlist actions depend on a selection; the fix-tracker export always
    // works (it exports every referrer -> broken-link pair, ticked or not).
    var btns=b.querySelectorAll('.copybtn,.exportbtn'); for(var i=0;i<btns.length;i++){ btns[i].disabled=(n===0); }
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

  // ---- standalone editable "fix tracker" export ----
  var BS=String.fromCharCode(92);
  function exportTracker(){
    var tpl=window.__CW_TPL__; if(!tpl){ toast('Tracker template unavailable'); return; }
    var data=JSON.parse(JSON.stringify(window.__CW_BROKEN__||{host:'',internal:[],external:[]}));
    // A link belongs in the fix tracker UNLESS it's been manually marked "Working" — one uniform
    // rule across Errors (assumed broken) AND Blocked (uncertain). So everything still untested is
    // included by default and the tracker is a complete to-review list; marking Working is what
    // drops a link. Scan the Working boxes on all three triage panels.
    var excl={}, ob=document.querySelectorAll('#panel-errint .okbox, #panel-errext .okbox, #panel-blockd .okbox'), z, nx=0;
    for(z=0;z<ob.length;z++){ if(ob[z].checked){ var du=ob[z].getAttribute('data-url'); if(!excl[du]){ nx++; } excl[du]=1; } }
    function keep(list){ var out=[],q; for(q=0;q<(list||[]).length;q++){ if(!excl[list[q].url]) out.push(list[q]); } return out; }
    // Blocked links are routed internal/external by kind, then merged into the same two tabs.
    data.internal=keep(data.internal).concat(keep(data.blockedInt));
    data.external=keep(data.external).concat(keep(data.blockedExt));
    delete data.blockedInt; delete data.blockedExt;
    // Carry each broken link's manual verdict (Broken/Working) + last-tested timestamp from the
    // report's localStorage into the tracker, so the standalone file shows them and can keep editing.
    function lg(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
    function annotate(list){ for(var q=0;q<list.length;q++){ var u=list[q].url; var vb=lg('cwbroken:'+HOST+':'+u)==='1', vo=lg('cwok:'+HOST+':'+u)==='1'; list[q].v=vb?'broken':(vo?'working':''); list[q].ts=lg('cwts:'+HOST+':'+u)||''; } }
    annotate(data.internal); annotate(data.external);
    data.ticked={};   // fix-tracking lives in the tracker now — nothing to seed from the report
    var inj=JSON.stringify(data).split('</').join('<'+BS+'/');
    var doc=tpl.replace('"__DATA__"', function(){ return inj; });
    try{
      var blob=new Blob([doc],{type:'text/html;charset=utf-8'}), url=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url; a.download='charlotte-fix-tracker.html'; document.body.appendChild(a); a.click();
      setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
      toast('Exported fix tracker'+(nx?' ('+nx+' link'+(nx===1?'':'s')+' marked Working excluded)':''));
    }catch(e){ toast('Tracker export failed'); }
  }
  var tb=document.querySelectorAll('.trackbtn');
  for(var ti=0;ti<tb.length;ti++){ tb[ti].addEventListener('click', exportTracker); }
})();
</script>
<script>(function(){
  // Manual-testing triage for all three tabs (Errors · internal/external + Blocked). Two
  // MUTUALLY-EXCLUSIVE boxes per link — "Broken" (confirms it's dead) and "Working"
  // (confirms it loads). Ticking one unticks the other; clearing both returns the row to
  // its default. "Tested" is implied by either box, so there's no separate Tested box.
  // The Errors tabs default to BROKEN: every flagged link counts toward the header until
  // you tick Working, which subtracts it and drops it from the fix tracker. The Blocked
  // tab defaults to UNCERTAIN (not counted): ticking Broken adds it and routes it into the
  // tracker by kind. A "Last tested" cell auto-fills the date+time of the latest verdict.
  // Ticks + timestamps persist in this browser (cwbroken: / cwok: / cwts: keys). Because that
  // state lives in localStorage (not the file), a share toolbar can export/import the verdicts as
  // JSON or bake them into a self-contained "shareable copy" (window.__CW_SEED__) for emailing.
  // Partial (auto-refreshing) reports render read-only error rows — no per-row data-url and no
  // triage boxes — so there is nothing to wire here, and running recomputeBroken() would wrongly
  // zero the server-rendered "Broken hyperlink instances" header. Bail when no triage rows exist.
  if(!document.querySelector('tr[data-url]')) return;
  var HOST=${JSON.stringify(state.startHost)}, SCOPES=['errint','errext','blockd'], ERRS=['errint','errext'];
  // Fixed row-2 totals — the denominators for each broken stat's live "(percent)".
  var DENOM={inst:${linkInstances}, int:${state.pages.length}, ext:${state.external.size}, tot:${state.pages.length + state.external.size}};
  function L(){ try{ return localStorage; }catch(e){ return null; } }
  function key(pfx,url){ return pfx+HOST+':'+url; }
  // __CW_SEED__ carries verdicts baked into a "shareable copy" (see saveShareableCopy). When this
  // browser exposes no localStorage (some file:// modes), getF/getS fall back to it so the copy
  // still displays the sender's verdicts read-only.
  function seedGet(k){ var sd=(typeof window!=='undefined'&&window)?window.__CW_SEED__:null; return (sd&&sd.v&&sd.v.hasOwnProperty(k))?sd.v[k]:null; }
  function getF(k){ var s=L(); if(!s){ var sv=seedGet(k); return sv!=null&&sv==='1'; } try{ return s.getItem(k)==='1'; }catch(e){ return false; } }
  function setF(k,v){ var s=L(); if(!s) return; try{ if(v) s.setItem(k,'1'); else s.removeItem(k); }catch(e){} }
  function panel(scope){ return document.getElementById('panel-'+scope); }
  function rowOf(el){ var n=el; while(n&&n.nodeName!=='TR') n=n.parentNode; return n; }
  function hasCls(el,c){ return (' '+el.className+' ').indexOf(' '+c+' ')>=0; }
  function addCls(el,c){ if(!hasCls(el,c)) el.className=(el.className?el.className+' ':'')+c; }
  function rmCls(el,c){ el.className=(' '+el.className+' ').split(' '+c+' ').join(' ').replace(/^ +| +$/g,''); }
  // String-valued persistence (for the "last tested" timestamp; getF/setF only do flags).
  function getS(k){ var s=L(); if(!s){ var sv=seedGet(k); return sv!=null?sv:''; } try{ return s.getItem(k)||''; }catch(e){ return ''; } }
  function setS(k,v){ var s=L(); if(!s) return; try{ if(v) s.setItem(k,v); else s.removeItem(k); }catch(e){} }
  // Auto-filled "Last tested" stamp = local date+time the row's latest verdict was set.
  // Updated whenever Broken or Working is ticked; cleared when the row returns to no verdict.
  function nowStr(){ var d=new Date(); function p(x){ return (x<10?'0':'')+x; } return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()); }
  function tsCell(tr){ return tr?tr.querySelector('.tscell'):null; }
  function setTs(tr,url){ var s=nowStr(), c=tsCell(tr); if(c) c.textContent=s; setS(key('cwts:',url), s); }
  function clrTs(tr,url){ var c=tsCell(tr); if(c) c.textContent=''; setS(key('cwts:',url), ''); }
  // ---- share testing verdicts (localStorage stays in THIS browser; the file doesn't carry it) ----
  function toast(msg){ var t=document.getElementById('cw-toast'); if(!t){ t=document.createElement('div'); t.id='cw-toast'; t.className='toast'; document.body.appendChild(t); } t.textContent=msg; t.className='toast show'; setTimeout(function(){ t.className='toast'; }, 2600); }
  function dl(blob,name){ try{ var url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 0); return true; }catch(e){ return false; } }
  // Snapshot every saved verdict (cwbroken: / cwok: / cwts:) for THIS crawl's host.
  function collectState(){ var out={app:'charlotte-verdicts', host:HOST, v:{}}, s=L(); if(!s) return out; var i,k,n=0; try{ n=s.length; }catch(e){ n=0; } for(i=0;i<n;i++){ try{ k=s.key(i); }catch(e){ k=null; } if(k&&(k.indexOf('cwbroken:'+HOST+':')===0||k.indexOf('cwok:'+HOST+':')===0||k.indexOf('cwts:'+HOST+':')===0)) out.v[k]=s.getItem(k); } return out; }
  function countVerdicts(st){ var links={}, k, pb='cwbroken:'+HOST+':', po='cwok:'+HOST+':', v=(st&&st.v)||{}; for(k in v){ if(!v.hasOwnProperty(k)) continue; if(k.indexOf(pb)===0) links[k.slice(pb.length)]=1; else if(k.indexOf(po)===0) links[k.slice(po.length)]=1; } var c=0,z; for(z in links){ if(links.hasOwnProperty(z)) c++; } return c; }
  function exportVerdicts(){ var st=collectState(), c=countVerdicts(st); if(!c){ toast('No verdicts to export yet — mark some links Broken or Working first'); return; } toast(dl(new Blob([JSON.stringify(st,null,2)],{type:'application/json'}), 'charlotte-verdicts-'+HOST+'.json') ? ('Exported '+c+' verdict'+(c===1?'':'s')) : 'Export failed'); }
  // Replace each url the file has an opinion on (clear its 3 keys, then set what the file holds);
  // urls the file doesn't mention are left as-is, so several people's exports merge cleanly.
  function applyState(obj){ var s=L(); if(!s||!obj||!obj.v) return 0; var pb='cwbroken:'+HOST+':', po='cwok:'+HOST+':', pt='cwts:'+HOST+':', urls={}, k; for(k in obj.v){ if(!obj.v.hasOwnProperty(k)) continue; if(k.indexOf(pb)===0) urls[k.slice(pb.length)]=1; else if(k.indexOf(po)===0) urls[k.slice(po.length)]=1; else if(k.indexOf(pt)===0) urls[k.slice(pt.length)]=1; } var u; for(u in urls){ if(urls.hasOwnProperty(u)){ try{ s.removeItem(pb+u); s.removeItem(po+u); s.removeItem(pt+u); }catch(e){} } } var c=0; for(k in obj.v){ if(obj.v.hasOwnProperty(k)){ try{ s.setItem(k,obj.v[k]); c++; }catch(e){} } } return c; }
  function importVerdicts(file){ if(!file) return; if(!L()){ toast('This browser blocks storage for local files — serve the report over a local web server to import'); return; } var r=new FileReader(); r.onload=function(){ var obj; try{ obj=JSON.parse(String(r.result)); }catch(e){ obj=null; } if(!obj||obj.app!=='charlotte-verdicts'||!obj.v){ toast('That isn\\'t a Charlotte verdicts file'); return; } if(obj.host!==HOST){ toast('That file is for “'+obj.host+'”, not “'+HOST+'” — not applied'); return; } var c=countVerdicts(obj); applyState(obj); toast('Imported '+c+' verdict'+(c===1?'':'s')+' — reloading…'); setTimeout(function(){ try{ location.reload(); }catch(e){} }, 700); }; r.onerror=function(){ toast('Could not read the file'); }; try{ r.readAsText(file); }catch(e){ toast('Could not read the file'); } }
  // Bake the current verdicts into a fresh self-contained copy of this report: serialize the page,
  // strip any prior seed, and inject window.__CW_SEED__ just before </head> so it runs first.
  function saveShareableCopy(){ var st=collectState(), c=countVerdicts(st); var SO='<scr'+'ipt>window.__CW_SEED__=', SC='</scr'+'ipt>'; var seed=SO+JSON.stringify(st).replace(/</g,'\\\\u003c')+';'+SC; var src='<!doctype html>\\n'+document.documentElement.outerHTML, pos; while((pos=src.indexOf(SO))>=0){ var en=src.indexOf(SC,pos); if(en<0) break; src=src.slice(0,pos)+src.slice(en+SC.length); } if(src.indexOf('</head>')>=0) src=src.replace('</head>', seed+'</head>'); else src=seed+src; toast(dl(new Blob([src],{type:'text/html;charset=utf-8'}), 'charlotte-report-'+HOST+'-shared.html') ? ('Saved a shareable copy with '+c+' verdict'+(c===1?'':'s')+' baked in') : 'Save failed'); }
  // On opening a shared copy: prime localStorage from the seed, but ONLY if this browser has no
  // verdicts for this host yet — never clobber a recipient's own triage.
  function seedFromCopy(){ var sd=(typeof window!=='undefined'&&window)?window.__CW_SEED__:null; if(!sd||!sd.v||sd.host!==HOST) return; var s=L(); if(!s) return; var i,k,n=0,has=false; try{ n=s.length; }catch(e){ n=0; } for(i=0;i<n;i++){ try{ k=s.key(i); }catch(e){ k=null; } if(k&&(k.indexOf('cwbroken:'+HOST+':')===0||k.indexOf('cwok:'+HOST+':')===0)){ has=true; break; } } if(has) return; for(k in sd.v){ if(sd.v.hasOwnProperty(k)){ try{ s.setItem(k,sd.v[k]); }catch(e){} } } }
  function update(scope){
    var p=panel(scope); if(!p) return;
    var trs=p.querySelectorAll('tr[data-url]'), n=0, tested=0, broke=0, ok=0, i;
    for(i=0;i<trs.length;i++){ n++; var b=trs[i].querySelector('.brokenbox'), o=trs[i].querySelector('.okbox'); var ib=!!(b&&b.checked), io=!!(o&&o.checked); if(ib||io) tested++; if(ib) broke++; if(io) ok++; }
    var el=p.querySelector('.tcount'); if(el) el.textContent='Manually tested: '+tested+' / '+n+' · confirmed broken: '+broke+' · confirmed working: '+ok;
    recomputeBroken();
  }
  // Percent with adaptive precision (mirrors report.js fmtPct): one decimal normally, more decimals if
  // needed so a small-but-nonzero share still shows a significant digit (0.03% not 0.0%).
  function fmtPct(p){ if(!(p>0)) return '0.0'; var d=1; while(d<10&&Number(p.toFixed(d))===0) d++; return p.toFixed(d); }
  // Set a header stat number, refresh its "(percent of total)" sibling (when a denom is given), and
  // keep its card's red "bad" highlight in sync with the count.
  function setStat(el, v, denom){ if(!el) return; el.textContent=(v.toLocaleString?v.toLocaleString():(''+v)); var nDiv=el.parentNode; if(typeof denom==='number'&&nDiv){ var pe=nDiv.querySelector('.pct'); if(pe) pe.textContent = denom>0 ? '('+fmtPct((v/denom)*100)+'%)' : ''; } var card=nDiv&&nDiv.parentNode; if(card&&typeof card.className==='string'){ var has=(' '+card.className+' ').indexOf(' bad ')>=0; if(v>0&&!has) card.className=card.className+' bad'; else if(v<=0&&has) card.className=(' '+card.className+' ').split(' bad ').join(' ').trim(); } }
  // Test-completeness outline on a "broken" stat card: GREEN dashed when every triageable link in the
  // category has a verdict (the count is final), AMBER dashed while any remain untested (the count may
  // still change), none when there's nothing to test. (Independent of setStat's 'bad' class.)
  function setTestState(el, tested, total){ if(!el) return; var card=el.parentNode&&el.parentNode.parentNode; if(!card||typeof card.className!=='string') return; var c=(' '+card.className+' ').split(' tested-all ').join(' ').split(' tested-partial ').join(' ').trim(); if(total>0) c+=(tested>=total?' tested-all':' tested-partial'); card.className=c; }
  // Live header stats, recomputed on load and on every verdict change. Errors tabs: each flagged
  // link counts (one unique destination + its referrer instances) UNLESS confirmed Working, so
  // clearing a false positive drops it from the instances total AND its Broken·internal/external
  // destination count. Blocked tab: only links confirmed Broken count (default uncertain), routed
  // internal/external by their kind. Keeps all three top-level broken stats accurate after triage.
  function recomputeBroken(){
    var inst=0, uInt=0, uExt=0, sc, p, trs, i;
    // Per-category test completeness for the green/amber outline: a row is "tested" if either box is
    // ticked. Internal = errint rows + blocked-internal; External = errext rows + blocked-external;
    // bT/bN = the Blocked·uncertain card's own completeness (all blocked rows, regardless of kind).
    var iT=0, iN=0, eT=0, eN=0, bT=0, bN=0;
    for(sc=0;sc<ERRS.length;sc++){ p=panel(ERRS[sc]); if(!p) continue; trs=p.querySelectorAll('tr[data-url]'); var isInt=(ERRS[sc]==='errint');
      for(i=0;i<trs.length;i++){ var b=trs[i].querySelector('.brokenbox'), o=trs[i].querySelector('.okbox'), td=(b&&b.checked)||(o&&o.checked);
        if(isInt){ iN++; if(td) iT++; } else { eN++; if(td) eT++; }
        if(o&&o.checked) continue;
        inst+=(parseInt(trs[i].getAttribute('data-inst'),10)||0);
        if(isInt) uInt++; else uExt++; } }
    p=panel('blockd'); if(p){ trs=p.querySelectorAll('tr[data-url]');
      for(i=0;i<trs.length;i++){ var bb=trs[i].querySelector('.brokenbox'), bo=trs[i].querySelector('.okbox'), ext=(trs[i].getAttribute('data-kind')==='external'), t2=(bb&&bb.checked)||(bo&&bo.checked);
        bN++; if(t2) bT++;
        if(ext){ eN++; if(t2) eT++; } else { iN++; if(t2) iT++; }
        if(!(bb&&bb.checked)) continue;
        inst+=(parseInt(trs[i].getAttribute('data-inst'),10)||0);
        if(ext) uExt++; else uInt++; } }
    setStat(document.getElementById('brokenInstN'), inst, DENOM.inst);
    setStat(document.getElementById('brokenIntN'), uInt, DENOM.int);
    setStat(document.getElementById('brokenExtN'), uExt, DENOM.ext);
    setStat(document.getElementById('brokenTotN'), uInt+uExt, DENOM.tot);   // total unique destinations broken
    setTestState(document.getElementById('brokenIntN'), iT, iN);
    setTestState(document.getElementById('brokenExtN'), eT, eN);
    // Broken hyperlink instances AND total unique destinations broken both span internal + external
    // (+ blocked), so their outlines need EVERY triageable link tested.
    setTestState(document.getElementById('brokenInstN'), iT+eT, iN+eN);
    setTestState(document.getElementById('brokenTotN'), iT+eT, iN+eN);
    setTestState(document.getElementById('blockedN'), bT, bN);   // Blocked·uncertain: green once all reviewed
  }
  // Apply a verdict to ONE row: set its boxes, persist the keys, swap classes, stamp/clear the
  // Last-tested time. want is 'broken' | 'working' | '' (clears it). Shared by the per-link change
  // handlers and the domain-level bulk control so both behave identically.
  function applyVerdict(tr, url, want){
    var b=tr.querySelector('.brokenbox'), o=tr.querySelector('.okbox');
    if(want==='broken'){ if(b)b.checked=true; if(o)o.checked=false; setF(key('cwbroken:',url),true); setF(key('cwok:',url),false); rmCls(tr,'notbroken'); addCls(tr,'confirmed'); setTs(tr,url); }
    else if(want==='working'){ if(o)o.checked=true; if(b)b.checked=false; setF(key('cwok:',url),true); setF(key('cwbroken:',url),false); rmCls(tr,'confirmed'); addCls(tr,'notbroken'); setTs(tr,url); }
    else { if(b)b.checked=false; if(o)o.checked=false; setF(key('cwbroken:',url),false); setF(key('cwok:',url),false); rmCls(tr,'confirmed'); rmCls(tr,'notbroken'); clrTs(tr,url); }
  }
  // Domain-level bulk control (Errors·external only). A domain's Broken/Working box applies the
  // verdict to every link in that domain; its checked state is DERIVED from the children (all broken
  // -> Broken, all working -> Working, mixed -> neither), so it survives reload from the per-link
  // verdicts with no extra storage.
  function rowsInDomain(host, scope){ var p=panel(scope); if(!p) return []; var all=p.querySelectorAll('tr[data-url]'), out=[], i; for(i=0;i<all.length;i++){ if(all[i].getAttribute('data-domain')===host) out.push(all[i]); } return out; }
  function domCtl(host, scope, cls){ var p=panel(scope); if(!p) return null; var xs=p.querySelectorAll(cls), i; for(i=0;i<xs.length;i++){ if(xs[i].getAttribute('data-domain')===host) return xs[i]; } return null; }
  // Set a disabled indicator box + toggle an 'on' class on its label (so it can be highlighted).
  function setInd(box, on){ if(!box) return; box.checked=on; var lbl=box.parentNode; if(lbl&&typeof lbl.className==='string'){ var has=(' '+lbl.className+' ').indexOf(' on ')>=0; if(on&&!has) lbl.className=lbl.className+' on'; else if(!on&&has) lbl.className=(' '+lbl.className+' ').split(' on ').join(' ').trim(); } }
  // Derive a domain header from its rows: the bulk Broken/Working boxes (checked when ALL broken /
  // ALL working), the Mixture indicator (both verdicts present), the all-tested indicator, and the
  // "tested K/N" counter. Runs on load and after any per-link or bulk verdict change.
  function deriveDomain(host, scope){
    var rs=rowsInDomain(host, scope), n=rs.length, br=0, wk=0, i;
    for(i=0;i<n;i++){ var b=rs[i].querySelector('.brokenbox'), o=rs[i].querySelector('.okbox'); if(b&&b.checked) br++; if(o&&o.checked) wk++; }
    var tested=br+wk, db=domCtl(host,scope,'.dombroken'), dw=domCtl(host,scope,'.domworking');
    if(db) db.checked=(n>0&&br===n);
    if(dw) dw.checked=(n>0&&wk===n);
    setInd(domCtl(host,scope,'.dommixture'), (br>0&&wk>0));
    setInd(domCtl(host,scope,'.domalltested'), (n>0&&tested===n));
    var pg=domCtl(host,scope,'.domprog'); if(pg) pg.textContent='· tested '+tested+'/'+n+' · '+br+' broken · '+wk+' working';
    // Dashed-amber the header while the domain still has untested links; clears once all are tested.
    var grp=domCtl(host,scope,'.domgrp'); if(grp) setCls(grp,'untested',(n>0&&tested<n));
  }
  function syncDomain(tr){ if(!tr) return; var h=tr.getAttribute('data-domain'), sc=tr.getAttribute('data-scope'); if(h&&sc) deriveDomain(h, sc); }
  function applyDomain(host, scope, want){ var rs=rowsInDomain(host, scope), i; for(i=0;i<rs.length;i++){ applyVerdict(rs[i], rs[i].getAttribute('data-url'), want); } deriveDomain(host, scope); update(scope); }
  function hasCls(el,c){ return !!(el&&typeof el.className==='string'&&(' '+el.className+' ').indexOf(' '+c+' ')>=0); }
  function setCls(el,c,on){ if(!el||typeof el.className!=='string') return; var has=hasCls(el,c); if(on&&!has) el.className=(el.className+' '+c).trim(); else if(!on&&has) el.className=(' '+el.className+' ').split(' '+c+' ').join(' ').trim(); }
  function grpOf(el){ var n=el; while(n){ if(hasCls(n,'domgrp')) return n; n=n.parentNode; } return null; }
  // Wire the domain controls on BOTH grouped tabs (Errors·external + Blocked·uncertain).
  function wireDomains(){ var sc=['errint','errext','blockd'], k; for(k=0;k<sc.length;k++) wireDomainScope(sc[k]); }
  function wireDomainScope(scope){
    var p=panel(scope); if(!p) return;
    var tgs=p.querySelectorAll('.domtoggle'), bs=p.querySelectorAll('.dombroken'), os=p.querySelectorAll('.domworking'), i;
    // Collapse/expand is a .collapsed class on .domgrp — under our control (no native <details>), so
    // Expand/Collapse all set every group with certainty.
    for(i=0;i<tgs.length;i++){ tgs[i].addEventListener('click', function(){ var g=grpOf(this); if(g) setCls(g,'collapsed',!hasCls(g,'collapsed')); }); }
    for(i=0;i<bs.length;i++){ bs[i].addEventListener('change', function(){ applyDomain(this.getAttribute('data-domain'), this.getAttribute('data-scope'), this.checked?'broken':''); }); }
    for(i=0;i<os.length;i++){ os[i].addEventListener('change', function(){ applyDomain(this.getAttribute('data-domain'), this.getAttribute('data-scope'), this.checked?'working':''); }); }
    var seen={}, all=p.querySelectorAll('tr[data-url]'); for(i=0;i<all.length;i++){ var h=all[i].getAttribute('data-domain'); if(h&&!seen[h]){ seen[h]=1; deriveDomain(h, scope); } }
    var grps=p.querySelectorAll('.domgrp');
    function setAll(yes){ for(var j=0;j<grps.length;j++) setCls(grps[j],'collapsed',yes); }
    var ex=document.getElementById(scope+'Expand'); if(ex) ex.addEventListener('click', function(){ setAll(false); });
    var co=document.getElementById(scope+'Collapse'); if(co) co.addEventListener('click', function(){ setAll(true); });
  }
  function wire(scope){
    var p=panel(scope); if(!p) return;
    var trs=p.querySelectorAll('tr[data-url]'), i;
    // Restore saved ticks. Broken wins if both keys are somehow set (keeps exclusivity).
    for(i=0;i<trs.length;i++){ var tr=trs[i], b=tr.querySelector('.brokenbox'), o=tr.querySelector('.okbox'); if(!b||!o) continue;
      var u=b.getAttribute('data-url'), wb=getF(key('cwbroken:',u)), wo=getF(key('cwok:',u));
      if(wb){ b.checked=true; addCls(tr,'confirmed'); if(wo){ setF(key('cwok:',u),false); } }
      else if(wo){ o.checked=true; addCls(tr,'notbroken'); }
      var c=tsCell(tr); if(c) c.textContent=getS(key('cwts:',u)); }
    var bs=p.querySelectorAll('.brokenbox'), os=p.querySelectorAll('.okbox');
    for(i=0;i<bs.length;i++){ bs[i].addEventListener('change', function(){ var tr=rowOf(this); applyVerdict(tr, this.getAttribute('data-url'), this.checked?'broken':''); syncDomain(tr); update(scope); }); }
    for(i=0;i<os.length;i++){ os[i].addEventListener('change', function(){ var tr=rowOf(this); applyVerdict(tr, this.getAttribute('data-url'), this.checked?'working':''); syncDomain(tr); update(scope); }); }
    update(scope);
  }
  seedFromCopy();
  for(var s=0;s<SCOPES.length;s++){ wire(SCOPES[s]); }
  wireDomains();   // domain-level Broken/Working controls on the Errors·external tab
  // ---- drag-resizable triage columns ----------------------------------------------------------
  // A triage tab can render several tables (one per domain group on Errors·external / Blocked), so a
  // resize broadcasts the new width to that column index in EVERY table of the tab, keeping the groups
  // aligned. Widths persist per tab in localStorage; "Reset column widths" clears them.
  function colKey(scope){ return 'cwcol:'+HOST+':'+scope; }
  function loadCols(scope){ var s=L(); if(!s) return null; try{ var v=s.getItem(colKey(scope)); return v?JSON.parse(v):null; }catch(e){ return null; } }
  function triTables(scope){ var p=panel(scope); if(!p) return []; return p.querySelectorAll('table.haspick, table.blkpick'); }
  function applyCol(scope, idx, px){ var ts=triTables(scope), t; for(t=0;t<ts.length;t++){ var hs=ts[t].querySelectorAll('thead th'); if(hs[idx]) hs[idx].style.width=px+'px'; } }
  function saveCol(scope, idx, px){ var s=L(); if(!s) return; var a=loadCols(scope)||[]; a[idx]=px; try{ s.setItem(colKey(scope), JSON.stringify(a)); }catch(e){} }
  function gripDown(scope, th, idx, grip, e){
    e.preventDefault(); e.stopPropagation();
    var startX=e.clientX, startW=th.offsetWidth, cur=startW; addCls(grip,'drag');
    function mv(ev){ cur=Math.max(16, startW+(ev.clientX-startX)); applyCol(scope, idx, cur); }
    function up(){ document.removeEventListener('mousemove',mv,true); document.removeEventListener('mouseup',up,true); rmCls(grip,'drag'); saveCol(scope, idx, cur); }
    document.addEventListener('mousemove',mv,true); document.addEventListener('mouseup',up,true);
  }
  function wireColResize(scope){
    var ts=triTables(scope); if(!ts.length) return;
    var saved=loadCols(scope), i; if(saved){ for(i=0;i<saved.length;i++){ if(saved[i]>0) applyCol(scope, i, saved[i]); } }
    var t; for(t=0;t<ts.length;t++){ var hs=ts[t].querySelectorAll('thead th'), j;
      for(j=0;j<hs.length;j++){ (function(th, idx){ var grip=document.createElement('span'); grip.className='colgrip'; grip.title='Drag to resize this column'; grip.addEventListener('mousedown', function(e){ gripDown(scope, th, idx, grip, e); }); th.appendChild(grip); })(hs[j], j); } }
  }
  function resetCols(scope){ var s=L(); if(s){ try{ s.removeItem(colKey(scope)); }catch(e){} } var ts=triTables(scope), t; for(t=0;t<ts.length;t++){ var hs=ts[t].querySelectorAll('thead th'), j; for(j=0;j<hs.length;j++) hs[j].style.width=''; } }
  for(var cz=0;cz<SCOPES.length;cz++) wireColResize(SCOPES[cz]);
  var crs=document.querySelectorAll('.colreset'); for(var cr=0;cr<crs.length;cr++){ crs[cr].addEventListener('click', function(){ resetCols(this.getAttribute('data-scope')); }); }
  // Wire the share toolbar (final report only; absent otherwise).
  var bCopy=document.getElementById('cwSaveCopy'); if(bCopy) bCopy.addEventListener('click', saveShareableCopy);
  var bExp=document.getElementById('cwExportV'); if(bExp) bExp.addEventListener('click', exportVerdicts);
  var bImp=document.getElementById('cwImportV'), fImp=document.getElementById('cwImportFile');
  if(bImp&&fImp){ bImp.addEventListener('click', function(){ fImp.click(); }); fImp.addEventListener('change', function(){ var f=this.files&&this.files[0]; importVerdicts(f); try{ this.value=''; }catch(e){} }); }
})();</script>
<script>(function(){
  // Non-triage tabs (External, Internal destinations, Out of scope) use the SAME .domgrp collapsibles as
  // the triage tabs but without verdict controls — so this wires just the caret toggle + Expand/Collapse
  // all. deriveDomain is deliberately NOT called here, so these groups never get the amber "untested" halo
  // (that's a triage-only signal). Each .domtoggle toggles its group's .collapsed class; the buttons set
  // every group at once (no state detection — a single toggle could desync and show the wrong label).
  function hasCls(el,c){ return (' '+(el.className||'')+' ').indexOf(' '+c+' ')>=0; }
  function setCls(el,c,on){ if(!el||typeof el.className!=='string') return; var has=hasCls(el,c); if(on&&!has) el.className=(el.className+' '+c).trim(); else if(!on&&has) el.className=(' '+el.className+' ').split(' '+c+' ').join(' ').trim(); }
  function grpOf(el){ var n=el; while(n){ if(hasCls(n,'domgrp')) return n; n=n.parentNode; } return null; }
  // ---- drag-resizable columns for the non-triage grouped tables (.grptbl) -----------------------------
  // The triage tabs' resize lives in a triage-only IIFE that bails when there are no verdict rows, so the
  // non-triage tables carry their own copy here. Same mechanic: a grip per header, the new width broadcast
  // to that column index across EVERY group table in the tab (keeping the groups aligned), persisted per
  // 'cwcol:host:scope'. No enforced minimum width — drag a column as narrow as you like.
  var HOST=${JSON.stringify(state.startHost)};
  function L(){ try{ return localStorage; }catch(e){ return null; } }
  function colKey(scope){ return 'cwcol:'+HOST+':'+scope; }
  function loadCols(scope){ var s=L(); if(!s) return null; try{ var v=s.getItem(colKey(scope)); return v?JSON.parse(v):null; }catch(e){ return null; } }
  function grpTables(scope){ var P=document.getElementById('panel-'+scope); return P? P.querySelectorAll('table.grptbl') : []; }
  function applyCol(scope, idx, px){ var ts=grpTables(scope), t; for(t=0;t<ts.length;t++){ var hs=ts[t].querySelectorAll('thead th'); if(hs[idx]) hs[idx].style.width=px+'px'; } }
  function saveCol(scope, idx, px){ var s=L(); if(!s) return; var a=loadCols(scope)||[]; a[idx]=px; try{ s.setItem(colKey(scope), JSON.stringify(a)); }catch(e){} }
  function gripDown(scope, th, idx, grip, e){ e.preventDefault(); e.stopPropagation(); var startX=e.clientX, startW=th.offsetWidth, cur=startW; setCls(grip,'drag',true);
    function mv(ev){ cur=Math.max(16, startW+(ev.clientX-startX)); applyCol(scope, idx, cur); }
    function up(){ document.removeEventListener('mousemove',mv,true); document.removeEventListener('mouseup',up,true); setCls(grip,'drag',false); saveCol(scope, idx, cur); }
    document.addEventListener('mousemove',mv,true); document.addEventListener('mouseup',up,true); }
  function wireResize(scope){ var ts=grpTables(scope); if(!ts.length) return; var saved=loadCols(scope), i; if(saved){ for(i=0;i<saved.length;i++){ if(saved[i]>0) applyCol(scope, i, saved[i]); } }
    var t; for(t=0;t<ts.length;t++){ var hs=ts[t].querySelectorAll('thead th'), j; for(j=0;j<hs.length;j++){ (function(th, idx){ var grip=document.createElement('span'); grip.className='colgrip'; grip.title='Drag to resize this column'; grip.addEventListener('mousedown', function(e){ gripDown(scope, th, idx, grip, e); }); th.appendChild(grip); })(hs[j], j); } } }
  function resetCols(scope){ var s=L(); if(s){ try{ s.removeItem(colKey(scope)); }catch(e){} } var ts=grpTables(scope), t; for(t=0;t<ts.length;t++){ var hs=ts[t].querySelectorAll('thead th'), j; for(j=0;j<hs.length;j++) hs[j].style.width=''; } }
  var TABS=[['panel-external','ext'],['panel-internal','int'],['panel-outscope','oos']], t;
  for(t=0;t<TABS.length;t++){ (function(pid, pre){
    var P=document.getElementById(pid); if(!P) return;
    var scope=pid.replace('panel-','');
    var tgs=P.querySelectorAll('.domtoggle'), i;
    for(i=0;i<tgs.length;i++){ tgs[i].addEventListener('click', function(){ var g=grpOf(this); if(g) setCls(g,'collapsed',!hasCls(g,'collapsed')); }); }
    var grps=P.querySelectorAll('.domgrp');
    function setAll(yes){ for(var j=0;j<grps.length;j++) setCls(grps[j],'collapsed',yes); }
    var ex=document.getElementById(pre+'Expand'); if(ex) ex.addEventListener('click', function(){ setAll(false); });
    var co=document.getElementById(pre+'Collapse'); if(co) co.addEventListener('click', function(){ setAll(true); });
    wireResize(scope);
  })(TABS[t][0], TABS[t][1]); }
  var rbs=document.querySelectorAll('.grpcolreset'); for(var r=0;r<rbs.length;r++){ rbs[r].addEventListener('click', function(){ resetCols(this.getAttribute('data-scope')); }); }
})();</script>
${pagerScript}${NEWWIN}${THEME_JS}</body></html>`;
}

// Write the report HTML and (optionally) JSON from current state. Used both for
// periodic checkpoints (partial=true) and the final write (partial=false).
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

function writeOutputs(state, cfg, allow, partial) {
  fs.writeFileSync(cfg.out, buildReport(state, cfg, allow, partial));
  if (cfg.json) fs.writeFileSync(cfg.json, buildReportJson(state, cfg, allow, partial));
}

function buildIndexReport(sites, cfg, allow, partial, startedAt) {
  const esc2 = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const done = sites.filter((s) => s.state && !s.partial).length;
  const totalInstances = sites.reduce((n, s) => n + (s.state ? s.state.pages.reduce((m, p) => m + (p.internal || 0) + (p.external || 0), 0) : 0), 0);
  // Broken link instances for a site: each non-allowlisted broken link counted once per
  // page that links to it (min 1) — the cleanup workload, summed across sites for the total.
  const biOf = (st) => { if (!st) return 0; let n = 0; for (const e of st.errors) { if (allow.some((re) => re.test(e.url))) continue; const s = st.refs && st.refs.get(e.url); n += (s ? s.size : 0) || 1; } return n; };
  const totalBroken = sites.reduce((n, s) => n + biOf(s.state), 0);
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
      const li = st.pages.reduce((n, p) => n + (p.internal || 0) + (p.external || 0), 0);
      const bi = biOf(st);
      status = s.partial ? `<span class="pill warn">crawling…</span>` : `<span class="pill ok">done</span>`;
      const file = s.reportFile.split(/[\\/]/).pop();
      body = `<div class="nums"><span><b>${st.pages.length.toLocaleString()}</b> internal destinations</span><span><b>${st.external.size.toLocaleString()}</b> external destinations</span><span><b>${li.toLocaleString()}</b> hyperlink instances</span><span class="${bi ? "bad" : ""}"><b>${bi.toLocaleString()}</b> broken hyperlink instances</span><span class="${ei ? "bad" : ""}"><b>${ei}</b> broken · internal</span><span class="${ee ? "bad" : ""}"><b>${ee}</b> broken · external</span><span><b>${bl}</b> blocked</span></div>
        <p><a href="${esc2(file)}">Open ${esc2(s.host)} report →</a></p>`;
    }
    return `<div class="card"><h2>${i + 1}. ${esc2(s.host)} ${status}</h2><p class="muted">${esc2(s.url)}</p>${body}</div>`;
  }).join("");
  const refresh = partial ? `<script>(function(){var I=2500,a=(new Date()).getTime();function b(){a=(new Date()).getTime();}['mousemove','mousedown','keydown','wheel','touchstart','scroll'].forEach(function(e){document.addEventListener(e,b,true);});try{if('scrollRestoration' in history)history.scrollRestoration='manual';var y=localStorage.getItem('bfIdxY');if(y!==null)window.scrollTo(0,parseInt(y,10)||0);}catch(e){}window.addEventListener('scroll',function(){try{localStorage.setItem('bfIdxY',String(window.pageYOffset||0));}catch(e){}});function t(){var s='';try{s=window.getSelection?String(window.getSelection()):'';}catch(_){}if((new Date()).getTime()-a<I||s!==''){setTimeout(t,600);return;}location.reload();}setTimeout(t,5000);})();</script>` : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${partial ? "[crawling] " : ""}Crawl report — ${sites.length} sites</title>
<style>
 :root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--link:#8ec5ff;--good:#4ade80;--bad:#f87171;--warn:#fbbf24;--border:#2c3340;--accent-fg:#06121f}
${THEME_LIGHT_CSS}
 *{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
 header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--panel)}header h1{margin:0 0 4px;font-size:20px}header p{margin:0;color:var(--muted);font-size:13px}
 main{max-width:1000px;margin:0 auto;padding:24px}.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:16px}
 h2{font-size:16px;margin:0 0 4px}.muted{color:var(--muted)}.bad b{color:var(--bad)}a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
 .nums{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0}.nums b{color:var(--accent)}
 .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;vertical-align:middle}
 .pill.ok{background:rgba(74,222,128,.15);color:var(--good)}.pill.warn{background:rgba(251,191,36,.15);color:var(--warn)}.pill.skip{background:rgba(154,164,178,.15);color:var(--muted)}
</style>${THEME_HEAD}</head><body>${THEME_BTN}
<header><h1>Crawl report — ${sites.length} sites</h1><p>${esc2(startedAt)} · ${done}/${sites.length} done${partial ? " · crawling… (auto-updates)" : ""} · <b>${totalInstances.toLocaleString()}</b> total hyperlink instances · <b>${totalBroken.toLocaleString()}</b> broken</p></header>
<main>${cards}</main>
${refresh}${NEWWIN}
${THEME_JS}</body></html>`;
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
        url: s.url, host: s.host, status: s.partial ? "crawling" : "done", reportFile: s.reportFile.split(/[\\/]/).pop(), jsonFile: s.jsonFile ? s.jsonFile.split(/[\\/]/).pop() : "",
        summary: { pagesCrawled: st.pages.length, externalLinks: st.external.size, linkInstances: st.pages.reduce((n, p) => n + (p.internal || 0) + (p.external || 0), 0), brokenLinkInstances: act.reduce((n, e) => { const r = st.refs && st.refs.get(e.url); return n + ((r ? r.size : 0) || 1); }, 0), errorsInternal: act.filter((e) => (e.kind || "internal") !== "external").length, errorsExternal: act.filter((e) => e.kind === "external").length, blocked: (st.blocked || []).length },
        errors: act.map((e) => errOut(st, e)),
        blocked: (st.blocked || []).map((e) => errOut(st, e)),
      };
    }),
  };
  fs.writeFileSync(cfg.json, JSON.stringify(data, null, 2));
}


module.exports = { buildReport, buildReportJson, writeOutputs, buildIndexReport, writeCombinedJson };
