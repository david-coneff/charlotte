"use strict";
// Report + output layer — extracted from crawl.js (AD-009) so the HTML/JSON report
// generation (the fastest-growing concern) lives on its own. Pure-ish: these take
// crawl state/cfg and either return report HTML (buildReport / buildIndexReport) or
// write the report + JSON to disk (writeOutputs / writeCombinedJson). No crawl-engine
// dependencies — only Node's fs plus the render caps and branding below.
const fs = require("fs");

const REF_PREVIEW = 3;             // referrers shown inline in the external/out-of-scope tables
const REF_CAP = 500;              // max referrers listed in a broken-link's nested table
const RENDER_CAP = Infinity;       // render every row in the HTML (no per-table cap); data is also in --json/--log
const BRAND = "Charlotte";         // report branding — the project / repo name
const BRAND_ICON = "🕸️";           // spiderweb glyph: favicon + report header

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Standalone "fix tracker" document. The crawl report fills the "__DATA__"
// placeholder with a JSON island ({host, generatedAt, internal[], external[],
// ticked{}}) and downloads it. The tracker renders itself from that island:
// two tabs (internal/external), one row per referrer→broken-link pair, each with
// an editable checkbox whose state persists in the opener's localStorage — so a
// fixer can keep working across sessions. Authored with no backticks / no ${} /
// no backslashes so it embeds cleanly inside the report's template + script.
const TRACKER_TEMPLATE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🕸️ Charlotte — Broken-link fix tracker</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Ctext%20y='.9em'%20font-size='90'%3E%F0%9F%95%B8%EF%B8%8F%3C/text%3E%3C/svg%3E">
<style>
:root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--good:#4ade80;--bad:#f87171;--border:#2c3340}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--panel)}header h1{margin:0 0 4px;font-size:18px}header p{margin:0;color:var(--muted);font-size:13px}
main{max-width:1100px;margin:0 auto;padding:24px}.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px}
.bar{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}.grow{flex:1}
.tabs{display:flex;gap:6px}.tab{padding:7px 14px;border-radius:7px;background:var(--panel2);border:1px solid var(--border);cursor:pointer;font-size:13px;color:var(--fg)}.tab.active{background:var(--accent);color:#06121f;border-color:var(--accent)}
.btn{background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:6px 12px;font-size:13px;cursor:pointer}.btn:hover{border-color:var(--accent);color:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;position:sticky;top:0;background:var(--panel)}
td a{color:var(--accent);text-decoration:none}td a:hover{text-decoration:underline}td{overflow-wrap:anywhere}
.tablewrap{max-height:72vh;overflow:auto;border:1px solid var(--border);border-radius:8px}
.c{width:54px;text-align:center}.c input{width:16px;height:16px;cursor:pointer}
.ncol{min-width:220px}.note{width:100%;background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font:inherit;font-size:12px}.note:focus{outline:none;border-color:var(--accent)}
tr.done td:not(.c):not(.ncol){opacity:.5;text-decoration:line-through}
.muted{color:var(--muted)}.hidden{display:none}
</style>
</head><body>
<header><h1>🕸️ Charlotte <span class="muted" style="font-weight:400">· Broken-link fix tracker</span></h1><p id="sub"></p></header>
<main><div class="card">
 <div class="bar">
  <div class="tabs"><button class="tab active" data-t="int" type="button">Internal</button><button class="tab" data-t="ext" type="button">External</button></div>
  <span class="grow"></span><span id="prog" class="muted"></span><button id="reset" class="btn" type="button">Clear ticks</button>
 </div>
 <div id="panel-int"></div>
 <div id="panel-ext" class="hidden"></div>
</div></main>
<script>
var DATA = "__DATA__";
(function(){
  var NS='cwfix:'+(DATA.host||'')+':', NL=String.fromCharCode(10);
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function isUrl(s){return s.indexOf('http://')===0||s.indexOf('https://')===0;}
  function cell(s){return isUrl(s)?'<a href="'+esc(s)+'" target="_blank" rel="noopener">'+esc(s)+'</a>':esc(s);}
  function pairs(list){var out=[],i,j;for(i=0;i<list.length;i++){var e=list[i],r=e.refs||[];for(j=0;j<r.length;j++)out.push({ref:r[j],broken:e.url,reason:e.reason});}out.sort(function(a,b){return a.ref<b.ref?-1:a.ref>b.ref?1:(a.broken<b.broken?-1:1);});return out;}
  function key(p){return p.ref+NL+p.broken;}
  function stored(k){try{return localStorage.getItem(NS+k);}catch(e){return null;}}
  function save(k,v){try{if(v)localStorage.setItem(NS+k,'1');else localStorage.removeItem(NS+k);}catch(e){}}
  function initChecked(p){var s=stored(key(p));if(s!=null)return s==='1';return !!(DATA.ticked&&DATA.ticked[key(p)]);}
  function storedNote(k){try{return localStorage.getItem(NS+'n:'+k);}catch(e){return null;}}
  function saveNote(k,v){try{if(v)localStorage.setItem(NS+'n:'+k,v);else localStorage.removeItem(NS+'n:'+k);}catch(e){}}
  function initNote(p){var k=key(p),s=storedNote(k);if(s!=null)return s;return (DATA.notes&&DATA.notes[k])||'';}
  function render(which){
    var list=(which==='int')?(DATA.internal||[]):(DATA.external||[]),ps=pairs(list),i;
    if(!ps.length)return '<p class="muted">No '+(which==='int'?'internal':'external')+' broken links recorded. 🎉</p>';
    var rows='';
    for(i=0;i<ps.length;i++){var p=ps[i],ck=initChecked(p);
      rows+='<tr'+(ck?' class="done"':'')+' data-k="'+esc(key(p))+'"><td class="c"><input type="checkbox" class="fx"'+(ck?' checked':'')+'></td><td>'+cell(p.ref)+'</td><td>'+cell(p.broken)+'</td><td class="muted">'+esc(p.reason)+'</td><td class="ncol"><input type="text" class="note" placeholder="who to contact / status…" value="'+esc(initNote(p))+'"></td></tr>';}
    return '<div class="tablewrap"><table><thead><tr><th class="c">Fixed</th><th>Referrer page (fix this)</th><th>Broken link it points to</th><th>Reason</th><th class="ncol">Notes · who to contact</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
  }
  function count(which){var list=(which==='int')?(DATA.internal||[]):(DATA.external||[]),ps=pairs(list),done=0,i;for(i=0;i<ps.length;i++)if(initChecked(ps[i]))done++;return {done:done,total:ps.length};}
  function progress(){var a=count('int'),b=count('ext');document.getElementById('prog').textContent='Fixed: internal '+a.done+'/'+a.total+' · external '+b.done+'/'+b.total;}
  function wire(){
    var boxes=document.querySelectorAll('.fx'),notes=document.querySelectorAll('.note'),i;
    for(i=0;i<boxes.length;i++){boxes[i].addEventListener('change',function(){var tr=this.parentNode.parentNode,k=tr.getAttribute('data-k');save(k,this.checked);tr.className=this.checked?'done':'';progress();});}
    for(i=0;i<notes.length;i++){notes[i].addEventListener('input',function(){var tr=this.parentNode.parentNode,k=tr.getAttribute('data-k');saveNote(k,this.value);});}
  }
  function fill(){document.getElementById('panel-int').innerHTML=render('int');document.getElementById('panel-ext').innerHTML=render('ext');wire();progress();}
  var tabs=document.querySelectorAll('.tab'),i;
  for(i=0;i<tabs.length;i++){tabs[i].addEventListener('click',function(){var t=this.getAttribute('data-t'),j;for(j=0;j<tabs.length;j++)tabs[j].className='tab'+(tabs[j]===this?' active':'');document.getElementById('panel-int').className=(t==='int')?'':'hidden';document.getElementById('panel-ext').className=(t==='ext')?'':'hidden';});}
  document.getElementById('reset').addEventListener('click',function(){if(!window.confirm('Clear all ticks in this tracker?'))return;var list=(DATA.internal||[]).concat(DATA.external||[]),ps=pairs(list),i;for(i=0;i<ps.length;i++)save(key(ps[i]),false);fill();});
  var ci=count('int'),ce=count('ext');
  document.getElementById('sub').textContent=(DATA.host||'')+' · generated '+(DATA.generatedAt||'')+' · '+(ci.total+ce.total)+' referrer→broken pairs · ticks saved in this browser';
  fill();
})();
</script>
</body></html>`;

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
  const elapsedMs = Math.max(0, (state.finishedMs || Date.now()) - startedMs);
  const fmtDur = (ms) => {
    const s = Math.round(ms / 1000);
    if (s < 60) return s + "s";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}h ${m}m ${sec}s` : `${m}m ${sec}s`;
  };
  // Selectable broken-link export (checkbox column + "export to allowlist") is a
  // final-report feature: partial reports auto-refresh, which would clear ticks.
  const showPick = !partial;

  const stat = (n, label, cls) => `<div class="stat ${cls || ""}"><div class="n">${n}</div><div class="l">${esc(label)}</div></div>`;
  const link = (u) => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`;
  // A "found on" referrer: clickable when it's a real URL, plain text otherwise.
  const srcLink = (s) => /^https?:\/\//i.test(s) ? link(s) : esc(s || "—");
  const refsOf = (url) => { const s = state.refs.get(url); return s ? [...s] : []; };
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
    const rows = arr.slice(0, REF_CAP).map((r) => `<tr><td>${link(r)}</td></tr>`).join("");
    const more = arr.length > REF_CAP ? `<tr><td class="muted">+${arr.length - REF_CAP} more — see JSON output</td></tr>` : "";
    return `<details><summary>${arr.length} pages link here</summary><div class="tablewrap" style="max-height:220px;margin-top:6px"><table class="subtable"><tbody>${rows}${more}</tbody></table></div></details>`;
  };
  // Cap rows rendered per table so a huge crawl can't build a multi-hundred-MB
  // HTML string (and stress GC). Full data is always in --json / --log.
  const capNote = (total) => total > RENDER_CAP ? `<p class="muted">Showing first ${RENDER_CAP.toLocaleString()} of ${total.toLocaleString()} — full set in the JSON/log output.</p>` : "";

  const pages = state.pages.slice().sort((a, b) => a.depth - b.depth || a.url.localeCompare(b.url));
  const rowsInternal = pages.slice(0, RENDER_CAP).map((p) =>
    `<tr><td>${p.depth}</td><td>${link(p.url)}</td><td>${esc(p.title || "—")}</td><td><span class="pill ok">${p.status}</span></td><td>${p.internal}</td><td>${p.external}</td></tr>`).join("");

  const extVals = [...state.external.values()].slice(0, RENDER_CAP);
  const byHost = new Map();
  for (const e of extVals) { if (!byHost.has(e.host)) byHost.set(e.host, []); byHost.get(e.host).push(e); }
  const extGroups = [...byHost.entries()].sort((a, b) => b[1].length - a[1].length).map(([host, list]) => {
    const rows = list.map((e) => {
      const st = e.status === "ok" ? `<span class="pill ok">reachable</span>` : e.status === "err" ? `<span class="pill err">unreachable</span>` : `<span class="pill skip">not checked</span>`;
      return `<tr><td>${link(e.url)}</td><td>${st}</td><td class="muted">${srcCell(e.url)}</td></tr>`;
    }).join("");
    return `<details open><summary>${esc(host)} <span class="muted">(${list.length})</span></summary><div class="tablewrap"><table><thead><tr><th>External URL</th><th>Status</th><th>Found on</th></tr></thead><tbody>${rows}</tbody></table></div></details>`;
  }).join("");

  const errRows = (arr) => arr.slice(0, RENDER_CAP).map((e) => `<tr><td>${link(e.url)}</td><td><span class="pill err">${esc(e.reason)}</span></td><td class="muted">${refCell(e.url, e.source)}</td></tr>`).join("");
  // Blocked rows: a neutral "uncertain" pill + the kind (internal/external).
  const blockedRows = (arr) => arr.slice(0, RENDER_CAP).map((e) => `<tr><td>${link(e.url)}</td><td><span class="pill skip">${esc(e.reason)}</span></td><td>${esc(e.kind || "internal")}</td><td class="muted">${refCell(e.url, e.source)}</td></tr>`).join("");
  // All referrers of a broken link (full list; capped only at render/embed sites).
  const refsAll = (url, fallback) => {
    const a = refsOf(url);
    if (a.length) return a;
    return [fallback && /^https?:\/\//i.test(fallback) ? fallback : (fallback || "(start)")];
  };
  // "Found on" cell for the Errors tabs — each referrer carries a fix checkbox so
  // someone fixing referrer pages can tick them off (and export the set, below).
  const reffix = (r, brokenUrl) => `<label class="reffix"><input type="checkbox" class="fixbox" data-ref="${esc(r)}" data-broken="${esc(brokenUrl)}"><span>${/^https?:\/\//i.test(r) ? link(r) : esc(r)}</span></label>`;
  const refCellFix = (brokenUrl, fallback) => {
    const arr = refsAll(brokenUrl, fallback);
    if (arr.length === 1) return reffix(arr[0], brokenUrl);
    const rows = arr.slice(0, REF_CAP).map((r) => `<tr><td>${reffix(r, brokenUrl)}</td></tr>`).join("");
    const more = arr.length > REF_CAP ? `<tr><td class="muted">+${arr.length - REF_CAP} more — see JSON output</td></tr>` : "";
    return `<details><summary>${arr.length} pages link here</summary><div class="tablewrap" style="max-height:220px;margin-top:6px"><table class="subtable"><tbody>${rows}${more}</tbody></table></div></details>`;
  };
  // Error rows WITH a leading checkbox — only on the two "Errors" tabs. Each box
  // carries the data to render an allowlist line (url + reason + a representative
  // referrer), so a selection can be exported as an allowlist appendage.
  const pickRows = (arr) => arr.slice(0, RENDER_CAP).map((e) => {
    const src = refsOf(e.url)[0] || e.source || "(start)";
    return `<tr><td><input type="checkbox" class="pickbox" data-url="${esc(e.url)}" data-reason="${esc(e.reason)}" data-source="${esc(src)}"></td><td>${link(e.url)}</td><td><span class="pill err">${esc(e.reason)}</span></td><td class="muted">${refCellFix(e.url, e.source)}</td></tr>`;
  }).join("");
  // Toolbar above an Errors table: a live count + copy/export actions (disabled
  // until something is ticked). The select-all lives in the table header cell.
  const exportBar = (scope) => `<div class="exportbar"><span class="selcount" data-scope="${scope}">0 selected</span><span class="grow"></span><button type="button" class="btn copybtn" data-scope="${scope}" disabled>⧉ Copy lines</button><button type="button" class="btn exportbtn" data-scope="${scope}" disabled>⬇ Export to allowlist…</button><span class="vsep"></span><button type="button" class="btn trackbtn" title="Save an editable checklist (with notes) of every referrer → broken-link pair, internal + external, as a standalone HTML">🔧 Export fix tracker</button></div>`;
  // Embedded fix-tracker payload + self-rendering template (final report only).
  const refsCapped = (url, fallback) => refsAll(url, fallback).slice(0, REF_CAP);
  const brokenFor = (arr) => arr.slice(0, RENDER_CAP).map((e) => ({ url: e.url, reason: e.reason, refs: refsCapped(e.url, e.source) }));
  const trackerData = { host: state.startHost, generatedAt: state.startedAt, internal: brokenFor(activeInt), external: brokenFor(activeExt) };
  const trackerLiteral = JSON.stringify(TRACKER_TEMPLATE).replace(/</g, "\\u003c");
  const brokenLiteral = JSON.stringify(trackerData).replace(/</g, "\\u003c");
  const trackerEmbed = showPick
    ? `<script>window.__CW_BROKEN__=${brokenLiteral};window.__CW_TPL__=${trackerLiteral};</script>`
    : "";
  // One-line helper under each Errors table explaining the two kinds of checkbox.
  const pickHelp = `<p class="muted" style="margin:2px 0 10px">Left box selects a link for the <strong>allowlist</strong>. The box beside each “found on” page marks that referrer <strong>fixed</strong> — <strong>Export fix tracker</strong> saves those (with a notes field per row) as a standalone editable checklist.</p>`;

  // Out-of-scope (same domain, outside the chosen subsection) — only shown when scoped.
  const scoped = !!state.pathPrefix;
  const oosRows = [...state.outOfScope.values()].sort((a, b) => a.url.localeCompare(b.url)).slice(0, RENDER_CAP).map((e) =>
    `<tr><td>${link(e.url)}</td><td class="muted">${srcCell(e.url)}</td></tr>`).join("");
  const oosStat = scoped ? stat(state.outOfScope.size, "Out of scope", "") : "";
  const oosTab = scoped ? `<div class="tab" data-tab="outscope">Out of scope (${state.outOfScope.size})</div>` : "";
  const oosPanel = scoped ? `<div class="panel hidden" id="panel-outscope">${state.outOfScope.size ? `<p class="muted">Same domain but outside <code>${esc(state.pathPrefix)}</code> — recorded, not crawled.</p>${capNote(state.outOfScope.size)}<div class="tablewrap"><table><thead><tr><th>URL</th><th>Found on</th></tr></thead><tbody>${oosRows}</tbody></table></div>` : `<p class="muted">No out-of-scope links found.</p>`}</div>` : "";

  const depthLabel = cfg.maxDepth === Infinity ? "unlimited" : cfg.maxDepth;
  const pagesLabel = cfg.maxPages === Infinity ? "unlimited" : cfg.maxPages;
  const scopeLabel = scoped ? `scope ${esc(state.pathPrefix)}/` : "whole domain";
  const cfgLine = `${cfg.concurrency} concurrent · ${cfg.delay}ms delay · ${cfg.rps ? cfg.rps + " rps cap" : "no rps cap"}${state.crawlDelay ? ` · crawl-delay ${state.crawlDelay}s` : ""} · max ${pagesLabel} pages / depth ${depthLabel} · ${scopeLabel}${cfg.includeSubdomains ? " · subdomains internal" : ""}${cfg.checkExternal ? " · external checked" : ""}${state.retries ? ` · ${state.retries} rate-limit retries` : ""}`;
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

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${partial ? "[crawling] " : ""}${BRAND_ICON} ${BRAND} · Crawl report — ${esc(state.startHost)}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Ctext%20y='.9em'%20font-size='90'%3E%F0%9F%95%B8%EF%B8%8F%3C/text%3E%3C/svg%3E">
<style>
 :root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--good:#4ade80;--bad:#f87171;--warn:#fbbf24;--border:#2c3340}
 *{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
 header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--panel)}header h1{margin:0 0 4px;font-size:18px}header p{margin:0;color:var(--muted);font-size:13px}
 main{max-width:1100px;margin:0 auto;padding:24px}.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:20px}
 .stats{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
 .stat{background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center}.stat .n{font-size:26px;font-weight:700}.stat .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
 .stat.good .n{color:var(--good)}.stat.bad .n{color:var(--bad)}.stat.warn .n{color:var(--warn)}
 table{width:100%;border-collapse:collapse;font-size:13px;min-width:820px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
 th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;position:sticky;top:0;background:var(--panel)}
 /* URL and Found-on columns get real width; long URLs wrap at sensible points, not every character */
 td{overflow-wrap:anywhere;word-break:normal}
 th:first-child,td:first-child{min-width:360px}
 td:last-child{min-width:300px}
 td a{color:var(--accent);text-decoration:none}td a:hover{text-decoration:underline}
 .tablewrap{max-height:460px;overflow:auto;border:1px solid var(--border);border-radius:8px}
 .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600}.pill.ok{background:rgba(74,222,128,.15);color:var(--good)}.pill.err{background:rgba(248,113,113,.15);color:var(--bad)}.pill.skip{background:rgba(251,191,36,.15);color:var(--warn)}
 .muted{color:var(--muted)}h2{font-size:15px;margin:0 0 12px}details summary{cursor:pointer;font-weight:600;padding:6px 0}
 .tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}.tab{padding:7px 14px;border-radius:7px;background:var(--panel2);border:1px solid var(--border);cursor:pointer;font-size:13px}.tab.active{background:var(--accent);color:#06121f;border-color:var(--accent)}
 .hidden{display:none}code{background:var(--panel2);padding:1px 5px;border-radius:4px}
 .exptools{display:flex;align-items:center;gap:10px;margin:0 0 12px}
 /* Errors tables with a leading checkbox column: keep the box narrow, URL wide. */
 .haspick th:first-child,.haspick td:first-child{min-width:34px;width:34px;text-align:center}
 .haspick th:nth-child(2),.haspick td:nth-child(2){min-width:360px}
 .haspick input[type=checkbox]{cursor:pointer;width:15px;height:15px}
 .exportbar{display:flex;align-items:center;gap:10px;margin:0 0 10px;flex-wrap:wrap}.exportbar .grow{flex:1}
 .selcount{color:var(--muted);font-size:12px}
 .btn{background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:6px 12px;font-size:13px;cursor:pointer}.btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}.btn:disabled{opacity:.5;cursor:default}
 .btn.exportbtn:not(:disabled){background:var(--accent);color:#06121f;border-color:var(--accent);font-weight:600}
 .toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--panel2);border:1px solid var(--accent);color:var(--fg);padding:10px 16px;border-radius:8px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:9}.toast.show{opacity:1}
 .reffix{display:inline-flex;align-items:flex-start;gap:6px}.reffix input{margin-top:3px;cursor:pointer;flex:none}.reffix.done span{opacity:.55;text-decoration:line-through}
 .vsep{display:inline-block;width:1px;height:20px;background:var(--border);margin:0 2px;vertical-align:middle}
 /* No-flash tab restore: a head script sets html.tab-NAME before first paint so
    the correct tab/panel renders immediately, not the default then a swap. */
 html[class*="tab-"] .panel{display:none}
 html.tab-internal #panel-internal,html.tab-external #panel-external,html.tab-outscope #panel-outscope,html.tab-errint #panel-errint,html.tab-errext #panel-errext,html.tab-blockd #panel-blockd,html.tab-suppressed #panel-suppressed{display:block}
 html[class*="tab-"] .tab{background:var(--panel2);color:var(--fg);border-color:var(--border)}
 html.tab-internal .tab[data-tab="internal"],html.tab-external .tab[data-tab="external"],html.tab-outscope .tab[data-tab="outscope"],html.tab-errint .tab[data-tab="errint"],html.tab-errext .tab[data-tab="errext"],html.tab-blockd .tab[data-tab="blockd"],html.tab-suppressed .tab[data-tab="suppressed"]{background:var(--accent);color:#06121f;border-color:var(--accent)}
 .subtable{width:100%;border-collapse:collapse}.subtable td{padding:4px 8px;border-bottom:1px solid var(--border)}
 details summary{color:var(--accent)}
</style>
<script>(function(){try{var n=(location.hash||'').substring(1);if(!n){try{n=localStorage.getItem('charlotteTab')||'';}catch(e){}}if(n)document.documentElement.className='tab-'+n;}catch(e){}})();</script>
</head><body>
<header><h1>${partial ? "[crawling] " : ""}${BRAND_ICON} ${BRAND} <span class="muted" style="font-weight:400">· Crawl report</span> — ${esc(state.startHost)}</h1>
<p>${esc(cfg.startUrl)} · ${esc(state.startedAt)}<br>${esc(cfgLine)}</p>${banner}</header>
<main>
 <div class="card"><div class="stats">
  ${stat(state.pages.length, "Internal pages", "good")}
  ${stat(state.external.size, "External links", "warn")}
  ${oosStat}
  ${stat(activeInt.length, "Errors · internal", activeInt.length ? "bad" : "")}
  ${stat(activeExt.length, "Errors · external", activeExt.length ? "bad" : "")}
  ${stat(blocked.length, "Blocked · uncertain", blocked.length ? "warn" : "")}
  ${stat(suppressed.length, "Suppressed", "")}
  ${partial ? stat(state.queue.length, "Queued", "") : stat(state.crawled, "Requests", "")}
  ${stat(fmtDur(elapsedMs), partial ? "Runtime · so far" : "Runtime", "")}
 </div></div>
 <div class="card">
  <div class="tabs">
   <div class="tab active" data-tab="internal">Internal pages (${state.pages.length})</div>
   <div class="tab" data-tab="external">External links (${state.external.size})</div>
   ${oosTab}
   <div class="tab" data-tab="errint">Errors · internal (${activeInt.length})</div>
   <div class="tab" data-tab="errext">Errors · external (${activeExt.length})</div>
   <div class="tab" data-tab="blockd">Blocked · uncertain (${blocked.length})</div>
   <div class="tab" data-tab="suppressed">Suppressed (${suppressed.length})</div>
  </div>
  <div class="panel" id="panel-internal">${pages.length ? `${capNote(pages.length)}<div class="tablewrap"><table><thead><tr><th>Depth</th><th>URL</th><th>Title</th><th>Status</th><th>Int</th><th>Ext</th></tr></thead><tbody>${rowsInternal}</tbody></table></div>` : `<p class="muted">No pages crawled.</p>`}</div>
  <div class="panel hidden" id="panel-external">${state.external.size ? `${capNote(state.external.size)}<div class="exptools"><button type="button" class="btn" id="extToggle" data-mode="collapse">Collapse all</button><span class="muted" style="font-size:12px">${byHost.size} domain${byHost.size === 1 ? "" : "s"}</span></div>${extGroups}` : `<p class="muted">No external links found.</p>`}</div>
  ${oosPanel}
  <div class="panel hidden" id="panel-errint">${activeInt.length ? `<p class="muted">Broken internal pages — these are yours to fix.</p>${showPick ? exportBar("errint") + pickHelp : ""}<div class="tablewrap"><table${showPick ? ` class="haspick"` : ``}><thead><tr>${showPick ? `<th><input type="checkbox" class="pickall" data-scope="errint" title="Select all"></th>` : ``}<th>Broken URL</th><th>Reason</th><th>Found on</th></tr></thead><tbody>${showPick ? pickRows(activeInt) : errRows(activeInt)}</tbody></table></div>` : `<p class="muted">No internal errors. 🎉</p>`}</div>
  <div class="panel hidden" id="panel-errext">${activeExt.length ? `<p class="muted">Unreachable external links — found on your pages, but the destination is down. Fix the link or remove it.</p>${showPick ? exportBar("errext") + pickHelp : ""}<div class="tablewrap"><table${showPick ? ` class="haspick"` : ``}><thead><tr>${showPick ? `<th><input type="checkbox" class="pickall" data-scope="errext" title="Select all"></th>` : ``}<th>External URL</th><th>Reason</th><th>Found on</th></tr></thead><tbody>${showPick ? pickRows(activeExt) : errRows(activeExt)}</tbody></table></div>` : `<p class="muted">${cfg.checkExternal ? "No unreachable external links. 🎉" : "External links weren't verified — enable “Verify external links resolve”."}</p>`}</div>
  <div class="panel hidden" id="panel-blockd">${blocked.length ? `<p class="muted">Our automated check couldn't confirm these (auth, anti-bot, rate-limiting, or timeouts) — they very likely work in a real browser. Verify by hand before treating as broken. Re-running with <code>--browser</code> and a slower rate (<code>--concurrency 1 --rps 0.5</code>) clears many of them.</p>${capNote(blocked.length)}<div class="tablewrap"><table><thead><tr><th>URL</th><th>Why uncertain</th><th>Kind</th><th>Found on</th></tr></thead><tbody>${blockedRows(blocked)}</tbody></table></div>` : `<p class="muted">Nothing blocked or uncertain. 🎉</p>`}</div>
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
    var btns=b.querySelectorAll('.btn'); for(var i=0;i<btns.length;i++){ btns[i].disabled=(n===0); }
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

  // ---- per-referrer fix checkboxes + standalone editable "fix tracker" export ----
  var NL=String.fromCharCode(10), BS=String.fromCharCode(92);
  var fixes=document.querySelectorAll('.fixbox');
  for(var fi=0;fi<fixes.length;fi++){ fixes[fi].addEventListener('change', function(){ var l=this.parentNode; if(l){ l.className = this.checked ? 'reffix done' : 'reffix'; } }); }
  function exportTracker(){
    var tpl=window.__CW_TPL__; if(!tpl){ toast('Tracker template unavailable'); return; }
    var data=JSON.parse(JSON.stringify(window.__CW_BROKEN__||{host:'',internal:[],external:[]}));
    var ticked={}, fb=document.querySelectorAll('.fixbox'), j;
    for(j=0;j<fb.length;j++){ if(fb[j].checked){ ticked[fb[j].getAttribute('data-ref')+NL+fb[j].getAttribute('data-broken')]=1; } }
    data.ticked=ticked;
    var inj=JSON.stringify(data).split('</').join('<'+BS+'/');
    var doc=tpl.replace('"__DATA__"', function(){ return inj; });
    try{
      var blob=new Blob([doc],{type:'text/html;charset=utf-8'}), url=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url; a.download='charlotte-fix-tracker.html'; document.body.appendChild(a); a.click();
      setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
      var n=0,k; for(k in ticked){ if(ticked.hasOwnProperty(k)) n++; }
      toast('Exported fix tracker — '+n+' marked fixed');
    }catch(e){ toast('Tracker export failed'); }
  }
  var tb=document.querySelectorAll('.trackbtn');
  for(var ti=0;ti<tb.length;ti++){ tb[ti].addEventListener('click', exportTracker); }
})();
</script>
<script>(function(){
  // External-links tab: one control to expand/collapse all the per-domain sections.
  var P=document.getElementById('panel-external'), b=document.getElementById('extToggle');
  if(!P||!b) return;
  function dets(){ return P.getElementsByTagName('details'); }
  function sync(){
    var d=dets(), open=0, i;
    for(i=0;i<d.length;i++){ if(d[i].open) open++; }
    var allOpen = d.length>0 && open===d.length;
    b.setAttribute('data-mode', allOpen?'collapse':'expand');
    b.textContent = allOpen?'Collapse all':'Expand all';
  }
  b.addEventListener('click', function(){
    var open = b.getAttribute('data-mode')!=='collapse';   // mode 'collapse' -> close all; else open all
    var d=dets(), i; for(i=0;i<d.length;i++){ d[i].open=open; }
    sync();
  });
  var d=dets(), i; for(i=0;i<d.length;i++){ d[i].addEventListener('toggle', sync); }
  sync();
})();</script>
</body></html>`;
}

// Write the report HTML and (optionally) JSON from current state. Used both for
// periodic checkpoints (partial=true) and the final write (partial=false).
function writeOutputs(state, cfg, allow, partial) {
  fs.writeFileSync(cfg.out, buildReport(state, cfg, allow, partial));
  if (cfg.json) {
    const suppressed = [], active = [];
    for (const e of state.errors) (allow.some((re) => re.test(e.url)) ? suppressed : active).push(e);
    const refsOf = (url) => { const s = state.refs.get(url); return s ? [...s] : []; };
    const errOut = (e) => ({ url: e.url, reason: e.reason, kind: e.kind || "internal", foundOn: refsOf(e.url).length ? refsOf(e.url) : (e.source ? [e.source] : []) });
    fs.writeFileSync(cfg.json, JSON.stringify({
      crawledAt: state.startedAt, partial: !!partial, scope: state.pathPrefix || "(whole domain)",
      log: { manifest: state.logManifest || "", singleFile: !!state.logSingleFile, parts: state.logParts || [] },
      summary: { pagesCrawled: state.pages.length, queued: state.queue.length, externalLinks: state.external.size, outOfScope: state.outOfScope.size, errorsInternal: active.filter((e) => (e.kind || "internal") !== "external").length, errorsExternal: active.filter((e) => e.kind === "external").length, blocked: (state.blocked || []).length, suppressed: suppressed.length },
      internalPages: state.pages,
      externalLinks: [...state.external.values()].map((e) => ({ url: e.url, host: e.host, status: e.status, foundOn: refsOf(e.url) })),
      outOfScopeLinks: [...state.outOfScope.values()].map((e) => ({ url: e.url, foundOn: refsOf(e.url) })),
      errors: active.map(errOut), suppressedErrors: suppressed.map(errOut),
      blocked: (state.blocked || []).map((e) => ({ url: e.url, reason: e.reason, kind: e.kind || "internal", foundOn: refsOf(e.url).length ? refsOf(e.url) : (e.source ? [e.source] : []) })),
    }, null, 2));
  }
}

function buildIndexReport(sites, cfg, allow, partial, startedAt) {
  const esc2 = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const done = sites.filter((s) => s.state && !s.partial).length;
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
      status = s.partial ? `<span class="pill warn">crawling…</span>` : `<span class="pill ok">done</span>`;
      const file = s.reportFile.split(/[\\/]/).pop();
      body = `<div class="nums"><span><b>${st.pages.length}</b> pages</span><span><b>${st.external.size}</b> external</span><span class="${ei ? "bad" : ""}"><b>${ei}</b> internal errors</span><span class="${ee ? "bad" : ""}"><b>${ee}</b> external errors</span><span><b>${bl}</b> blocked</span></div>
        <p><a href="${esc2(file)}">Open ${esc2(s.host)} report →</a></p>`;
    }
    return `<div class="card"><h2>${i + 1}. ${esc2(s.host)} ${status}</h2><p class="muted">${esc2(s.url)}</p>${body}</div>`;
  }).join("");
  const refresh = partial ? `<script>(function(){var I=2500,a=(new Date()).getTime();function b(){a=(new Date()).getTime();}['mousemove','mousedown','keydown','wheel','touchstart','scroll'].forEach(function(e){document.addEventListener(e,b,true);});try{if('scrollRestoration' in history)history.scrollRestoration='manual';var y=localStorage.getItem('bfIdxY');if(y!==null)window.scrollTo(0,parseInt(y,10)||0);}catch(e){}window.addEventListener('scroll',function(){try{localStorage.setItem('bfIdxY',String(window.pageYOffset||0));}catch(e){}});function t(){var s='';try{s=window.getSelection?String(window.getSelection()):'';}catch(_){}if((new Date()).getTime()-a<I||s!==''){setTimeout(t,600);return;}location.reload();}setTimeout(t,5000);})();</script>` : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${partial ? "[crawling] " : ""}Crawl report — ${sites.length} sites</title>
<style>
 :root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--good:#4ade80;--bad:#f87171;--warn:#fbbf24;--border:#2c3340}
 *{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
 header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--panel)}header h1{margin:0 0 4px;font-size:20px}header p{margin:0;color:var(--muted);font-size:13px}
 main{max-width:1000px;margin:0 auto;padding:24px}.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:16px}
 h2{font-size:16px;margin:0 0 4px}.muted{color:var(--muted)}.bad b{color:var(--bad)}a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
 .nums{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0}.nums b{color:var(--accent)}
 .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;vertical-align:middle}
 .pill.ok{background:rgba(74,222,128,.15);color:var(--good)}.pill.warn{background:rgba(251,191,36,.15);color:var(--warn)}.pill.skip{background:rgba(154,164,178,.15);color:var(--muted)}
</style></head><body>
<header><h1>Crawl report — ${sites.length} sites</h1><p>${esc2(startedAt)} · ${done}/${sites.length} done${partial ? " · crawling… (auto-updates)" : ""}</p></header>
<main>${cards}</main>
${refresh}
</body></html>`;
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
        url: s.url, host: s.host, status: s.partial ? "crawling" : "done", reportFile: s.reportFile.split(/[\\/]/).pop(),
        summary: { pagesCrawled: st.pages.length, externalLinks: st.external.size, errorsInternal: act.filter((e) => (e.kind || "internal") !== "external").length, errorsExternal: act.filter((e) => e.kind === "external").length, blocked: (st.blocked || []).length },
        errors: act.map((e) => errOut(st, e)),
        blocked: (st.blocked || []).map((e) => errOut(st, e)),
      };
    }),
  };
  fs.writeFileSync(cfg.json, JSON.stringify(data, null, 2));
}


module.exports = { buildReport, writeOutputs, buildIndexReport, writeCombinedJson };
