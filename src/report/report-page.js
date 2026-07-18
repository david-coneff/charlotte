"use strict";
// buildReport — data aggregation, per-section row/group builders, and final assembly of
// the self-contained single-site report HTML. The stylesheet and the embedded client
// scripts live in sibling modules (page-css / page-scripts / triage-script); this module
// stitches them into the same bytes the monolithic report.js emitted (AD-083).
const { REF_PREVIEW, RENDER_CAP, BRAND, BRAND_ICON, THEME_HEAD, THEME_BTN, LEGEND_HINT, THEME_JS, esc } = require("./branding.js");
const { effSettings, settingsAreKnown } = require("./settings.js");
const { REPORT_CSS } = require("./page-css.js");
const { pagerScriptFor, stateScript, pickExportScript } = require("./page-scripts.js");
const { triageScript, collapseScript } = require("./triage-script.js");
// The side-docked link-window script (NEWWIN) and the standalone fix-tracker document
// (TRACKER_TEMPLATE) are large self-contained strings — kept in their own module (AD-036).
const { NEWWIN, TRACKER_TEMPLATE } = require("../report-templates");

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
  // Distinct referrer pages that link at least one assumed-broken error destination — the initial value
  // for the "Referrer pages with broken links" card (recomputeBroken keeps it live during triage).
  const brokenRefPagesInit = (() => { const s = new Set(); const add = (arr) => arr.forEach((e) => refsAll(e.url, e.source).forEach((r) => s.add(r))); add(activeInt); add(activeExt); return s.size; })();
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
  const errextHead = `<thead><tr>${showAllow ? `<th class="pickcol"><input type="checkbox" class="pickall" data-scope="errext" title="Select all"></th>` : ``}<th class="tscell" title="Date &amp; time you last marked the link Broken or Working (auto-filled, saved in this browser)">Last triaged</th><th class="tcol" title="Manual check confirms it's broken (it already counts by default)">Broken</th><th class="tcol" title="Manual check shows it works — dropped from the broken count + fix tracker">Working</th><th class="urlcol">External URL</th><th class="reasoncol">Reason</th><th class="foundcol">Found on</th></tr></thead>`;
  const errintHead = `<thead><tr>${showAllow ? `<th class="pickcol"><input type="checkbox" class="pickall" data-scope="errint" title="Select all"></th>` : ``}<th class="tscell" title="Date &amp; time you last marked the link Broken or Working (auto-filled, saved in this browser)">Last triaged</th><th class="tcol" title="Manual check confirms it's broken (it already counts by default)">Broken</th><th class="tcol" title="Manual check shows it works — dropped from the broken count + fix tracker">Working</th><th class="urlcol">Broken URL</th><th class="reasoncol">Reason</th><th class="foundcol">Found on</th></tr></thead>`;
  // Inner cells of a BLOCKED triage row (mirrors triageCells, but a neutral "uncertain" pill + a Kind
  // column; default is uncertain, so Broken CONFIRMS-dead and Working records that it loads).
  const blockedCells = (e) => { const kind = (e.kind || "internal") === "external" ? "external" : "internal"; return `<td class="tscell" title="Date & time you last marked this link Broken or Working (auto-filled)"></td><td class="tcol"><input type="checkbox" class="brokenbox" data-url="${esc(e.url)}" title="Manual check confirms it's broken — count it and add it to the fix tracker"></td><td class="tcol"><input type="checkbox" class="okbox" data-url="${esc(e.url)}" title="Manual check shows it works — leave it out of the broken count"></td><td>${link(e.url)}</td><td><span class="pill skip">${esc(e.reason)}</span></td><td>${kind}</td><td class="muted">${refCellFix(e.url, e.source)}</td>`; };
  const blockdHead = `<thead><tr><th class="tscell" title="Date &amp; time you last marked the link Broken or Working (auto-filled, saved in this browser)">Last triaged</th><th class="tcol" title="Manual check confirms it's broken — counts it + adds to the fix tracker">Broken</th><th class="tcol" title="Manual check shows it works">Working</th><th class="urlcol">URL</th><th class="reasoncol">Why uncertain</th><th class="kindcol">Kind</th><th class="foundcol">Found on</th></tr></thead>`;
  // Generalized per-domain collapsible grouping — used by BOTH the Errors·external and Blocked tabs.
  // Each header carries a collapse toggle, a live "triaged K/N" counter, the bulk-apply All:
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
      return `<div class="domgrp" ${dd}><div class="domhead"><button type="button" class="domtoggle"><span class="caret"></span> <span class="domname">${esc(host)}</span> <span class="muted">(${list.length})</span> <span class="muted domprog" ${dd}></span></button><span class="domverdict"><span class="domall muted">All:</span><label class="domlbl" title="Mark every link in this group Broken at once"><input type="checkbox" class="dombroken" ${dd}> Broken</label><label class="domlbl" title="Mark every link in this group Working at once"><input type="checkbox" class="domworking" ${dd}> Working</label><label class="domlbl ind" title="Indicator only — this group has a mix of Broken and Working verdicts"><input type="checkbox" class="dommixture" ${dd} disabled> Mixture of broken/working</label><label class="domlbl ind" title="Indicator only — every link in this group has been triaged (marked Broken or Working)"><input type="checkbox" class="domalltested" ${dd} disabled> all triaged</label></span></div><div class="tablewrap dombody"><table class="${tcls}">${headHtml}<tbody>${rows}</tbody></table></div></div>`;
    }).join("");
  };
  const domainTools = (scope) => `<div class="exptools"><button type="button" class="btn" id="${scope}Expand">Expand all</button><button type="button" class="btn" id="${scope}Collapse">Collapse all</button></div>`;
  // Wrap a grouped list in the fixed-height scroll viewport so every tab scrolls internally (consistent
  // with the flat .tablewrap tables) instead of stretching the page.
  const groupView = (inner) => `<div class="groupview">${inner}</div>`;
  const domainHelp = `<p class="muted" style="margin:2px 0 10px">Grouped by domain. Each header has an <strong>All: Broken / Working</strong> pair that applies to <em>every</em> link in that domain at once — handy when a whole site (e.g. a social network) is systematically misread by the automated check but works in a browser. The header also shows a live <strong>triaged K/N</strong> count, a <strong>Mixture</strong> flag (both verdicts present) and an <strong>all triaged</strong> flag, so you can scan progress with the groups collapsed.</p>`;
  const folderHelp = `<p class="muted" style="margin:2px 0 10px">Grouped by <strong>first-level folder</strong> (e.g. <code>site.gov/about/</code> vs <code>site.gov/blog/</code>; root pages group under the bare host). Each header has an <strong>All: Broken / Working</strong> pair that applies to <em>every</em> link in that section at once, plus a live <strong>triaged K/N</strong> count, a <strong>Mixture</strong> flag and an <strong>all triaged</strong> flag — so you can triage a whole section and scan progress with the groups collapsed.</p>`;
  // Toolbar above an Errors table: a live count + copy/export actions (disabled
  // until something is ticked). The select-all lives in the table header cell.
  // The fix-tracker export button now lives once in the always-visible share bar (below), not on
  // each tab. exportBar is just the (opt-in) allowlist-selection toolbar — empty when that's off.
  const exportBar = (scope) => showAllow ? `<div class="exportbar"><span class="selcount" data-scope="${scope}">0 selected</span><span class="grow"></span><button type="button" class="btn copybtn" data-scope="${scope}" disabled>⧉ Copy lines</button><button type="button" class="btn exportbtn" data-scope="${scope}" disabled>⬇ Export to allowlist…</button></div>` : ``;
  // Live manual-testing progress for an Errors tab (updated by the script below as the
  // Broken / Working boxes are ticked): how far testing has gotten + confirmed broken/working.
  const testBar = (scope) => `<div class="testbar"><span class="tcount" data-scope="${scope}">Manually triaged: 0 / 0 · confirmed broken: 0 · confirmed working: 0</span><button type="button" class="btn colreset" data-scope="${scope}" title="Restore the default column widths on this tab">↔ Reset column widths</button></div>`;
  const blockedHelp = `<p class="muted" style="margin:2px 0 10px">Two mutually-exclusive boxes per link: <strong>Broken</strong> confirms this uncertain link really is dead — confirmed ones join the <strong>Broken hyperlink instances</strong> count (routed internal/external by their kind); <strong>Working</strong> confirms it actually loads. Leave both unticked to keep it uncertain (not counted). <em>Until you mark one <strong>Working</strong>, an uncertain link stays in the fix-tracker export</em>, so the tracker is a complete to-review list. Either tick counts as triaged and auto-fills the <strong>Last triaged</strong> date &amp; time. Ticks are saved in this browser.</p>`;
  const blockedCounter = (scope) => `<div class="testbar"><span class="tcount" data-scope="${scope}">Manually triaged: 0 / 0 · confirmed broken: 0 · confirmed working: 0</span><button type="button" class="btn colreset" data-scope="${scope}" title="Restore the default column widths on this tab">↔ Reset column widths</button></div>`;
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
  const pickHelp = `<p class="muted" style="margin:2px 0 10px">${showAllow ? `First box selects a link for the <strong>allowlist</strong>. Then two` : `Two`} mutually-exclusive boxes: <strong>Broken</strong> confirms it's really broken (it already counts by default — this just marks it triaged); <strong>Working</strong> marks it actually loads — Working links drop out of the broken count and the fix tracker (so one false positive can't flood it). Leave both unticked to keep the default “assumed broken”. The <strong>Last triaged</strong> column auto-fills the date &amp; time of your latest verdict. <strong>Export fix tracker</strong> saves the still-broken links, grouped by referrer page, as a standalone editable checklist (one contact note per page, each broken link with its own Fixed checkbox). Verdicts are saved in this browser.</p>`;
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

  const pagerScript = pagerScriptFor(cfg);

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${partial ? "[crawling] " : ""}${BRAND_ICON} ${BRAND} · Crawl report — ${esc(state.startHost)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Ctext%20y='.9em'%20font-size='90'%3E%F0%9F%95%B8%EF%B8%8F%3C/text%3E%3C/svg%3E">
<style>
${REPORT_CSS}</style>
<script>(function(){try{var n=(location.hash||'').substring(1);if(!n){try{n=localStorage.getItem('charlotteTab')||'';}catch(e){}}if(n)document.documentElement.className='tab-'+n;}catch(e){}})();</script>
${THEME_HEAD}</head><body>${THEME_BTN}${hasTriage ? LEGEND_HINT : ""}
<header><h1>${partial ? "[crawling] " : ""}${BRAND_ICON} ${BRAND} <span class="muted" style="font-weight:400">· Crawl report</span> — ${esc(state.startHost)}</h1>
<p>${esc(cfg.startUrl)} · ${esc(state.startedAt)}<br>${esc(cfgLine)}</p>${banner}</header>
<main>
 <div class="card"><div class="stats">
  ${stat(brokenN("brokenInstN", brokenInstances, linkInstances), "Broken hyperlink instances", brokenInstances ? "bad" : "", "Hyperlink instances that point at a broken destination — each broken destination counted once per page that links to it (the real cleanup workload). The % is its share of all Hyperlink instances (the total below). Updates live as you mark Errors links “Working” or confirm Blocked links “Broken”. Outline: GREEN dashed once every internal + external + blocked link has been triaged (so this total is final); AMBER while some are still untriaged (it may yet change).")}
  ${stat(brokenN("brokenIntN", activeInt.length, state.pages.length), "Broken internal destinations", activeInt.length ? "bad" : "", "Unique broken internal destinations — pages on your site that don't load. The % is relative to Internal destinations (the total below). Updates live as you triage. Outline: GREEN dashed once every internal link (errors + blocked) has been triaged; AMBER while some are still untriaged.")}
  ${stat(brokenN("brokenExtN", activeExt.length, state.external.size), "Broken external destinations", activeExt.length ? "bad" : "", "Unique broken external destinations — off-site URLs that don't resolve. The % is its share of External destinations (the total below). Updates live as you triage. Outline: GREEN dashed once every external link (errors + blocked) has been triaged; AMBER while some are still untriaged.")}
  ${stat(brokenN("brokenTotN", activeInt.length + activeExt.length, state.pages.length + state.external.size), "Total unique destinations broken", (activeInt.length + activeExt.length) ? "bad" : "", "Total unique destinations confirmed broken — Broken · internal + Broken · external, each URL counted once. The % is its share of Total unique destinations (directly below). Updates live as you triage. Outline: GREEN dashed once every internal + external + blocked link has been triaged; AMBER while some are still untriaged.")}
  ${stat(`<span id="blockedN">${blocked.length.toLocaleString()}</span>`, "Blocked · uncertain", blocked.length ? "warn" : "", "Links the automated check couldn't confirm (auth, anti-bot, rate-limiting, timeouts) — very likely fine in a real browser. Not counted as broken until you confirm one. Sits apart from the broken/total matrix because it's neither. Outline: GREEN dashed once every blocked link has been triaged (marked Broken or Working); AMBER while some are still untriaged.")}
  ${stat(linkInstances.toLocaleString(), "Hyperlink instances", "", "Every hyperlink occurrence across all crawled pages (internal + external), NOT deduplicated — a destination linked from N pages counts N times. So this runs much larger than the unique destination counts.")}
  ${stat(state.pages.length.toLocaleString(), "Internal destinations", "", "Unique same-domain pages crawled — distinct destinations on your own site. (One per URL, however many pages link to it.)")}
  ${stat(state.external.size.toLocaleString(), "External destinations", "", "Unique off-site URLs your pages link to. Usually far fewer than the hyperlink instances — one destination is typically linked from many pages.")}
  ${stat((state.pages.length + state.external.size).toLocaleString(), "Total unique destinations", "", "Every distinct destination Charlotte saw — Internal destinations + External destinations, each URL counted once. The total whose broken subset sits directly above it.")}
  ${hasTriage ? stat(`<span id="brokenPgN">${brokenRefPagesInit.toLocaleString()}</span>`, "Referrer pages with broken links", brokenRefPagesInit ? "bad" : "", "Distinct pages that link at least one still-broken destination — the spread of the cleanup across your site (how many pages, and owners, need a fix), not just how many links. Drops as you mark links Working or clear a page's last broken link. Outline: GREEN dashed once every internal + external + blocked link has been triaged (so this is final); AMBER while some are still untriaged.") : ``}
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
${stateScript(partial)}${trackerEmbed}
${pickExportScript(cfg, state)}${triageScript(state, linkInstances)}${collapseScript(state)}${pagerScript}${NEWWIN}${THEME_JS}</body></html>`;
}

module.exports = { buildReport };
