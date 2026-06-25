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

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// Standalone "fix tracker" document. The crawl report fills the "__DATA__"
// placeholder with a JSON island ({host, generatedAt, internal[], external[],
// ticked{}}) and downloads it; each link object also carries its manual verdict
// (v: 'broken'|'working'|'') and last-tested timestamp (ts), baked from the report.
// The tracker renders itself from that island: two tabs (internal/external), one row
// per referrer→broken-link pair, each with a Fixed checkbox, a main-report-style
// Broken/Working verdict pair (mutually exclusive, auto-stamping the Last-tested time,
// synced per URL), all persisted in the opener's localStorage — so a fixer can keep
// working across sessions. Authored with no backticks / no ${} /
// no backslashes so it embeds cleanly inside the report's template + script.
// Report links open in a NEW WINDOW (not a new tab), docked to whichever side of the
// crawl-report window has more room and reusing one "charlotteLink" window, so checking
// a link never covers the report and lands in the same spot every time. Intercepts
// target="_blank" clicks. Authored with no backticks / no ${} so it embeds cleanly.
const NEWWIN = "<script>(function(){function place(href){var sc=window.screen||{};var sw=sc.availWidth||1440,sh=sc.availHeight||900,slx=sc.availLeft||0,sty=sc.availTop||0;var rx=(typeof window.screenX==='number'?window.screenX:window.screenLeft)||0,rw=window.outerWidth||Math.round(sw*0.6);var right=(slx+sw)-(rx+rw),left=rx-slx,MIN=480,w,x;if(right>=left&&right>=MIN){w=right;x=rx+rw;}else if(left>=MIN){w=left;x=slx;}else{w=Math.min(Math.max(MIN,Math.round(sw*0.42)),sw);x=(right>=left)?(slx+sw-w):slx;}w=Math.round(Math.min(w,sw));x=Math.round(x);var h=Math.round(sh),y=Math.round(sty);var nw=window.open(href,'charlotteLink','scrollbars=yes,resizable=yes,width='+w+',height='+h+',left='+x+',top='+y);if(nw){try{nw.opener=null;}catch(e){}try{nw.moveTo(x,y);nw.resizeTo(w,h);}catch(e){}try{nw.focus();}catch(e){}}return nw;}document.addEventListener('click',function(e){var a=e.target;while(a&&a.nodeName!=='A')a=a.parentNode;if(!a||a.getAttribute('target')!=='_blank'||!a.href)return;e.preventDefault();place(a.href);},false);})();</script>";

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
.v{width:54px;text-align:center}.v input{width:16px;height:16px;cursor:pointer}
.ts{width:118px;white-space:nowrap;color:var(--muted);font-size:11px}
.notelbl{display:flex;align-items:center;gap:6px;flex:1;min-width:240px;color:var(--muted);font-size:12px}
.grp{border:1px solid var(--border);border-radius:8px;margin-bottom:14px;overflow:hidden}
.grphead{display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--panel2);flex-wrap:wrap}
.grphead .ref{font-weight:600;overflow-wrap:anywhere}.grphead .cnt{color:var(--muted);font-size:12px}
.grphead .pnote{flex:1;min-width:220px;background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font:inherit;font-size:12px}.grphead .pnote:focus{outline:none;border-color:var(--accent)}
.grp .tablewrap{max-height:none;overflow:visible;border:none;border-top:1px solid var(--border);border-radius:0}
tr.done td:not(.c){opacity:.5;text-decoration:line-through}
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
  // Group broken links BY the referrer page that links to them: one person usually
  // owns a whole page, so its broken links sit together under a single contact note.
  function groups(list){
    var map={}, order=[], i, j;
    for(i=0;i<list.length;i++){var e=list[i],r=e.refs||[];for(j=0;j<r.length;j++){var ref=r[j];if(!map.hasOwnProperty(ref)){map[ref]=[];order.push(ref);}map[ref].push({broken:e.url,reason:e.reason,v:e.v||'',ts:e.ts||''});}}
    order.sort();
    for(i=0;i<order.length;i++)map[order[i]].sort(function(a,b){return a.broken<b.broken?-1:a.broken>b.broken?1:0;});
    return {order:order,map:map};
  }
  function pkey(ref,broken){return ref+NL+broken;}
  function stored(k){try{return localStorage.getItem(NS+k);}catch(e){return null;}}
  function save(k,v){try{if(v)localStorage.setItem(NS+k,'1');else localStorage.removeItem(NS+k);}catch(e){}}
  function initChecked(ref,broken){var k=pkey(ref,broken),s=stored(k);if(s!=null)return s==='1';return !!(DATA.ticked&&DATA.ticked[k]);}
  // Notes are PER REFERRER PAGE (free-form: who to contact, status, anything).
  function storedNote(ref){try{return localStorage.getItem(NS+'n:'+ref);}catch(e){return null;}}
  function saveNote(ref,v){try{if(v)localStorage.setItem(NS+'n:'+ref,v);else localStorage.removeItem(NS+'n:'+ref);}catch(e){}}
  function initNote(ref){var s=storedNote(ref);if(s!=null)return s;return (DATA.notes&&DATA.notes[ref])||'';}
  // Per-BROKEN-URL manual verdict (Broken/Working) + last-tested timestamp, mirroring the main
  // report. Baked in at export from the report's localStorage; editable + persisted here too.
  function storedV(url){try{return localStorage.getItem(NS+'vd:'+url);}catch(e){return null;}}
  function saveV(url,v){try{if(v)localStorage.setItem(NS+'vd:'+url,v);else localStorage.removeItem(NS+'vd:'+url);}catch(e){}}
  function initVerdict(url,baked){var s=storedV(url);if(s!=null)return s;return baked||'';}
  function storedT(url){try{return localStorage.getItem(NS+'vt:'+url);}catch(e){return null;}}
  function saveT(url,t){try{if(t)localStorage.setItem(NS+'vt:'+url,t);else localStorage.removeItem(NS+'vt:'+url);}catch(e){}}
  function initTs(url,baked){var s=storedT(url);if(s!=null)return s;return baked||'';}
  function nowStr(){var d=new Date();function p(x){return (x<10?'0':'')+x;}return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());}
  function rowsForUrl(url){var all=document.querySelectorAll('tr[data-broken]'),out=[],i;for(i=0;i<all.length;i++){if(all[i].getAttribute('data-broken')===url)out.push(all[i]);}return out;}
  // Set the verdict for a URL everywhere it appears (a URL can be linked from several pages):
  // ticking one box clears the other, stamps the time (or clears it when no verdict remains).
  function setVerdict(url,v){saveV(url,v);saveT(url,v?nowStr():'');var t=initTs(url,''),rs=rowsForUrl(url),i;for(i=0;i<rs.length;i++){var tr=rs[i],vb=tr.querySelector('.vb'),vo=tr.querySelector('.vo'),ts=tr.querySelector('.ts');if(vb)vb.checked=(v==='broken');if(vo)vo.checked=(v==='working');if(ts)ts.textContent=t;}}
  function render(which){
    var list=(which==='int')?(DATA.internal||[]):(DATA.external||[]),g=groups(list),i,j;
    if(!g.order.length)return '<p class="muted">No '+(which==='int'?'internal':'external')+' broken links recorded. 🎉</p>';
    var html='';
    for(i=0;i<g.order.length;i++){
      var ref=g.order[i],links=g.map[ref],rows='';
      for(j=0;j<links.length;j++){var bk=links[j],ck=initChecked(ref,bk.broken),vd=initVerdict(bk.broken,bk.v),tv=initTs(bk.broken,bk.ts);
        rows+='<tr'+(ck?' class="done"':'')+' data-ref="'+esc(ref)+'" data-broken="'+esc(bk.broken)+'"><td class="c"><input type="checkbox" class="fx"'+(ck?' checked':'')+'></td><td class="ts">'+esc(tv)+'</td><td class="v"><input type="checkbox" class="vb"'+(vd==='broken'?' checked':'')+' title="Manual check confirms it is broken"></td><td class="v"><input type="checkbox" class="vo"'+(vd==='working'?' checked':'')+' title="Manual check shows it works"></td><td>'+cell(bk.broken)+'</td><td class="muted">'+esc(bk.reason)+'</td></tr>';}
      html+='<div class="grp"><div class="grphead"><span class="ref">'+cell(ref)+'</span><span class="cnt">'+links.length+' broken link'+(links.length===1?'':'s')+'</span><span class="grow"></span><label class="notelbl">Notes <input type="text" class="pnote" data-ref="'+esc(ref)+'" placeholder="notes…" value="'+esc(initNote(ref))+'"></label></div><div class="tablewrap"><table><thead><tr><th class="c">Fixed</th><th class="ts">Last tested</th><th class="v">Broken</th><th class="v">Working</th><th>Broken link it points to</th><th>Reason</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
    }
    return html;
  }
  function count(which){var list=(which==='int')?(DATA.internal||[]):(DATA.external||[]),g=groups(list),done=0,total=0,i,j;for(i=0;i<g.order.length;i++){var ref=g.order[i],links=g.map[ref];for(j=0;j<links.length;j++){total++;if(initChecked(ref,links[j].broken))done++;}}return {done:done,total:total,pages:g.order.length};}
  function progress(){var a=count('int'),b=count('ext');document.getElementById('prog').textContent='Fixed: internal '+a.done+'/'+a.total+' · external '+b.done+'/'+b.total;}
  function wire(){
    var boxes=document.querySelectorAll('.fx'),notes=document.querySelectorAll('.pnote'),vbs=document.querySelectorAll('.vb'),vos=document.querySelectorAll('.vo'),i;
    for(i=0;i<boxes.length;i++){boxes[i].addEventListener('change',function(){var tr=this.parentNode.parentNode,k=pkey(tr.getAttribute('data-ref'),tr.getAttribute('data-broken'));save(k,this.checked);tr.className=this.checked?'done':'';progress();});}
    for(i=0;i<notes.length;i++){notes[i].addEventListener('input',function(){saveNote(this.getAttribute('data-ref'),this.value);});}
    // Broken/Working verdict boxes: mutually exclusive, auto-stamp the time, synced per URL.
    for(i=0;i<vbs.length;i++){vbs[i].addEventListener('change',function(){var tr=this.parentNode.parentNode;setVerdict(tr.getAttribute('data-broken'),this.checked?'broken':'');});}
    for(i=0;i<vos.length;i++){vos[i].addEventListener('change',function(){var tr=this.parentNode.parentNode;setVerdict(tr.getAttribute('data-broken'),this.checked?'working':'');});}
  }
  function fill(){document.getElementById('panel-int').innerHTML=render('int');document.getElementById('panel-ext').innerHTML=render('ext');wire();progress();}
  var tabs=document.querySelectorAll('.tab'),i;
  for(i=0;i<tabs.length;i++){tabs[i].addEventListener('click',function(){var t=this.getAttribute('data-t'),j;for(j=0;j<tabs.length;j++)tabs[j].className='tab'+(tabs[j]===this?' active':'');document.getElementById('panel-int').className=(t==='int')?'':'hidden';document.getElementById('panel-ext').className=(t==='ext')?'':'hidden';});}
  document.getElementById('reset').addEventListener('click',function(){if(!window.confirm('Clear all ticks in this tracker?'))return;var lists=(DATA.internal||[]).concat(DATA.external||[]),g=groups(lists),i,j;for(i=0;i<g.order.length;i++){var ref=g.order[i],links=g.map[ref];for(j=0;j<links.length;j++)save(pkey(ref,links[j].broken),false);}fill();});
  var ci=count('int'),ce=count('ext');
  document.getElementById('sub').textContent=(DATA.host||'')+' · generated '+(DATA.generatedAt||'')+' · '+(ci.pages+ce.pages)+' referrer page(s), '+(ci.total+ce.total)+' broken-link instance(s) · ticks, verdicts & notes saved in this browser';
  fill();
})();
</script>
` + NEWWIN + `
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
  // "Internal pages" / "External destinations" counts. page.internal/external are the raw
  // per-page counts (extractLinks doesn't dedupe), so this is just their running sum.
  const linkInstances = state.pages.reduce((n, p) => n + (p.internal || 0) + (p.external || 0), 0);

  const stat = (n, label, cls, title) => `<div class="stat ${cls || ""}"${title ? ` title="${esc(title)}"` : ""}><div class="n">${n}</div><div class="l">${esc(label)}</div></div>`;
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
  // "Found on" cell for the Errors tabs — each referrer carries a fix checkbox so
  // someone fixing referrer pages can tick them off (and export the set, below).
  const reffix = (r, brokenUrl) => `<label class="reffix"><input type="checkbox" class="fixbox" data-ref="${esc(r)}" data-broken="${esc(brokenUrl)}"><span>${/^https?:\/\//i.test(r) ? link(r) : esc(r)}</span></label>`;
  const refCellFix = (brokenUrl, fallback) => {
    const arr = refsAll(brokenUrl, fallback);
    if (arr.length === 1) return reffix(arr[0], brokenUrl);
    const rows = arr.map((r) => `<tr><td>${reffix(r, brokenUrl)}</td></tr>`).join("");
    return `<details><summary>${arr.length} pages link here</summary><div class="tablewrap" style="max-height:220px;margin-top:6px"><table class="subtable"><tbody>${rows}</tbody></table></div></details>`;
  };
  // Error rows WITH a leading checkbox — only on the two "Errors" tabs. Each box
  // carries the data to render an allowlist line (url + reason + a representative
  // referrer), so a selection can be exported as an allowlist appendage.
  const pickRows = (arr) => arr.slice(0, RENDER_CAP).map((e) => {
    const src = refsOf(e.url)[0] || e.source || "(start)";
    return `<tr data-url="${esc(e.url)}" data-inst="${brokenInstCount(e.url)}">${showAllow ? `<td class="pickcol"><input type="checkbox" class="pickbox" data-url="${esc(e.url)}" data-reason="${esc(e.reason)}" data-source="${esc(src)}"></td>` : ``}<td class="tscell" title="Date & time you last marked this link Broken or Working (auto-filled)"></td><td class="tcol"><input type="checkbox" class="brokenbox" data-url="${esc(e.url)}" title="Manual check confirms it's broken (it already counts by default — this just marks it triaged)"></td><td class="tcol"><input type="checkbox" class="okbox" data-url="${esc(e.url)}" title="Manual check shows it works — drop it from the broken count and the fix tracker"></td><td class="urlcol">${link(e.url)}</td><td><span class="pill err">${esc(e.reason)}</span></td><td class="muted">${refCellFix(e.url, e.source)}</td></tr>`;
  }).join("");
  // Toolbar above an Errors table: a live count + copy/export actions (disabled
  // until something is ticked). The select-all lives in the table header cell.
  const exportBar = (scope) => `<div class="exportbar">${showAllow ? `<span class="selcount" data-scope="${scope}">0 selected</span><span class="grow"></span><button type="button" class="btn copybtn" data-scope="${scope}" disabled>⧉ Copy lines</button><button type="button" class="btn exportbtn" data-scope="${scope}" disabled>⬇ Export to allowlist…</button><span class="vsep"></span>` : `<span class="grow"></span>`}<button type="button" class="btn trackbtn" title="Save an editable checklist (grouped by referrer page) of the broken links not marked 'Working', as a standalone HTML">🔧 Export fix tracker</button></div>`;
  // Live manual-testing progress for an Errors tab (updated by the script below as the
  // Broken / Working boxes are ticked): how far testing has gotten + confirmed broken/working.
  const testBar = (scope) => `<div class="testbar"><span class="tcount" data-scope="${scope}">Manually tested: 0 / 0 · confirmed broken: 0 · confirmed working: 0</span></div>`;
  // Blocked tab: just the fix-tracker button (no allowlist selection) + a live counter.
  const blockedBar = `<div class="exportbar"><span class="grow"></span><button type="button" class="btn trackbtn" title="Save the fix tracker — includes broken links plus the blocked links you've confirmed broken here, grouped by referrer page">🔧 Export fix tracker</button></div>`;
  const blockedHelp = `<p class="muted" style="margin:2px 0 10px">Two mutually-exclusive boxes per link: <strong>Broken</strong> confirms this uncertain link really is dead — confirmed ones are added to the <strong>Broken hyperlink instances</strong> count and the fix tracker (routed internal/external by their kind); <strong>Working</strong> confirms it actually loads. Leave both unticked to keep it uncertain (not counted). Either tick counts as tested and auto-fills the <strong>Last tested</strong> date &amp; time. Ticks are saved in this browser.</p>`;
  const blockedCounter = (scope) => `<div class="testbar"><span class="tcount" data-scope="${scope}">Manually tested: 0 / 0 · confirmed broken: 0 · confirmed working: 0</span></div>`;
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
  const shareBar = `<div class="card sharebar"><p class="muted" style="margin:0 0 8px;font-size:13px"><strong>Share your testing verdicts.</strong> Your Broken/Working ticks &amp; timestamps are saved in <em>this</em> browser only — they don't travel if you just email this file. To hand them off:</p><div class="exportbar"><button type="button" class="btn" id="cwSaveCopy" title="Download a new self-contained report with your current verdicts baked in — email that file and the recipient just opens it">💾 Save shareable copy</button><span class="vsep"></span><button type="button" class="btn" id="cwExportV" title="Download your verdicts as a small JSON file to send alongside the report">⬇ Export verdicts</button><button type="button" class="btn" id="cwImportV" title="Load verdicts from a JSON file someone shared with you (merges by link, then reloads)">⬆ Import verdicts</button><input type="file" id="cwImportFile" accept="application/json,.json" style="display:none"></div></div>`;
  // One-line helper under each Errors table explaining the two kinds of checkbox.
  const pickHelp = `<p class="muted" style="margin:2px 0 10px">${showAllow ? `First box selects a link for the <strong>allowlist</strong>. Then two` : `Two`} mutually-exclusive boxes: <strong>Broken</strong> confirms it's really broken (it already counts by default — this just marks it triaged); <strong>Working</strong> marks it actually loads — Working links drop out of the broken count and the fix tracker (so one false positive can't flood it). Leave both unticked to keep the default “assumed broken”. The <strong>Last tested</strong> column auto-fills the date &amp; time of your latest verdict. The box beside each “found on” page marks that referrer <strong>fixed</strong>. <strong>Export fix tracker</strong> saves the still-broken links, grouped by referrer page, as a standalone editable checklist (one contact note per page). Ticks are saved in this browser.</p>`;

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

  // Optional client-side pagination (--paginate). All rows stay embedded; this only
  // shows PAGE_SIZE at a time (with Prev/Next/jump) so a huge report stays responsive.
  // Applies to every data table — including each broken link's nested "found on"
  // referrer list (which is otherwise uncapped, however many pages link there).
  // Display-only: selection/export read every row regardless of which page is shown.
  const pagerScript = cfg.paginate ? `<script>(function(){
  var PAGE_SIZE=${PAGE_SIZE};
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
 :root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--good:#4ade80;--bad:#f87171;--warn:#fbbf24;--border:#2c3340}
 *{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
 header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--panel)}header h1{margin:0 0 4px;font-size:18px}header p{margin:0;color:var(--muted);font-size:13px}
 main{max-width:1500px;margin:0 auto;padding:24px}.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:20px}
 .stats{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(140px,1fr))}
 .stat{background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center}.stat .n{font-size:26px;font-weight:700}.stat .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
 .stat.good .n{color:var(--good)}.stat.bad .n{color:var(--bad)}.stat.warn .n{color:var(--warn)}
 table{width:100%;border-collapse:collapse;font-size:13px;min-width:820px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
 th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;position:sticky;top:0;background:var(--panel)}
 /* URL and Found-on columns get real width; long URLs wrap at sensible points, not every character */
 td{overflow-wrap:anywhere;word-break:normal}
 th:first-child,td:first-child{min-width:360px}
 td:last-child{min-width:300px}
 /* Internal-pages table: a 1–2 digit Depth and the small Status/Int/Ext cells shouldn't
    hog width — narrow them and give the space to URL + Title so those wrap far less. */
 .pagestbl th:first-child,.pagestbl td:first-child{min-width:0;width:64px}
 .pagestbl th:nth-child(2),.pagestbl td:nth-child(2){min-width:380px}
 .pagestbl th:nth-child(3),.pagestbl td:nth-child(3){min-width:300px}
 .pagestbl th:nth-child(4),.pagestbl td:nth-child(4){width:90px}
 .pagestbl th:nth-child(5),.pagestbl td:nth-child(5){width:58px}
 .pagestbl th:last-child,.pagestbl td:last-child{min-width:0;width:58px}
 td a{color:var(--accent);text-decoration:none}td a:hover{text-decoration:underline}
 .tablewrap{max-height:460px;overflow:auto;border:1px solid var(--border);border-radius:8px}
 .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600}.pill.ok{background:rgba(74,222,128,.15);color:var(--good)}.pill.err{background:rgba(248,113,113,.15);color:var(--bad)}.pill.skip{background:rgba(251,191,36,.15);color:var(--warn)}
 .muted{color:var(--muted)}h2{font-size:15px;margin:0 0 12px}details summary{cursor:pointer;font-weight:600;padding:6px 0}
 .tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}.tab{padding:7px 14px;border-radius:7px;background:var(--panel2);border:1px solid var(--border);cursor:pointer;font-size:13px}.tab.active{background:var(--accent);color:#06121f;border-color:var(--accent)}
 .hidden{display:none}code{background:var(--panel2);padding:1px 5px;border-radius:4px}
 .exptools{display:flex;align-items:center;gap:10px;margin:0 0 12px}
 /* Triage tables — columns sized by CLASS so the layout holds with or without the (opt-in)
    allowlist pick column: .pickcol pick box · .tscell timestamp · .tcol Broken/Working · .urlcol URL. */
 .pickcol{min-width:34px;width:34px;text-align:center}
 .tcol{min-width:62px;width:62px;text-align:center}
 .tscell{min-width:122px;width:122px;white-space:nowrap}
 td.tscell{font-size:11px;color:var(--muted)}
 .urlcol{min-width:340px}
 .haspick input[type=checkbox],.blkpick input[type=checkbox]{cursor:pointer;width:15px;height:15px}
 .testbar{margin:0 0 12px}.tcount{color:var(--muted);font-size:12px}
 tr.notbroken td:not(.tcol):not(.tscell):not(.pickcol){opacity:.45;text-decoration:line-through}
 tr.confirmed td:not(.tcol):not(.tscell):not(.pickcol){color:var(--bad)}
 .exportbar{display:flex;align-items:center;gap:10px;margin:0 0 10px;flex-wrap:wrap}.exportbar .grow{flex:1}
 .sharebar{border-left:3px solid var(--accent);padding-top:12px;padding-bottom:12px}.sharebar .exportbar{margin:0}
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
 /* Client-side pagination bar (only present with --paginate, above any table over a page in size, incl. nested referrer lists). */
 .pager{display:flex;align-items:center;gap:8px;margin:0 0 8px;flex-wrap:wrap}.pager .grow{flex:1}.pager .pglabel{font-size:12px}
 .pager .pgjump{width:64px;background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font:inherit;font-size:12px}
</style>
<script>(function(){try{var n=(location.hash||'').substring(1);if(!n){try{n=localStorage.getItem('charlotteTab')||'';}catch(e){}}if(n)document.documentElement.className='tab-'+n;}catch(e){}})();</script>
</head><body>
<header><h1>${partial ? "[crawling] " : ""}${BRAND_ICON} ${BRAND} <span class="muted" style="font-weight:400">· Crawl report</span> — ${esc(state.startHost)}</h1>
<p>${esc(cfg.startUrl)} · ${esc(state.startedAt)}<br>${esc(cfgLine)}</p>${banner}</header>
<main>
 <div class="card"><div class="stats">
  ${stat(state.pages.length.toLocaleString(), "Internal pages", "good", "Unique same-domain pages crawled — distinct destinations on your own site.")}
  ${stat(state.external.size.toLocaleString(), "External destinations", "warn", "Unique off-site URLs your pages link to. Usually far fewer than the hyperlink instances — one destination is typically linked from many pages.")}
  ${stat(linkInstances.toLocaleString(), "Hyperlink instances", "", "Every hyperlink occurrence across all crawled pages (internal + external), NOT deduplicated — a destination linked from N pages counts N times. So this runs much larger than the unique destination counts.")}
  ${stat(`<span id="brokenInstN">${brokenInstances.toLocaleString()}</span>`, "Broken hyperlink instances", brokenInstances ? "bad" : "", "Hyperlink instances that point at a broken destination — each broken destination counted once per page that links to it (the real cleanup workload). Updates live as you mark Errors links “Working” or confirm Blocked links “Broken”.")}
  ${oosStat}
  ${stat(activeInt.length.toLocaleString(), "Broken · internal", activeInt.length ? "bad" : "", "Unique broken internal destinations — pages on your site that don't load.")}
  ${stat(activeExt.length.toLocaleString(), "Broken · external", activeExt.length ? "bad" : "", "Unique broken external destinations — off-site URLs that don't resolve.")}
  ${stat(blocked.length, "Blocked · uncertain", blocked.length ? "warn" : "")}
  ${stat(suppressed.length, "Suppressed", "")}
  ${partial ? stat(state.queue.length, "Queued", "") : stat(state.crawled, "Requests", "")}
  ${stat(fmtDur(elapsedMs), partial ? "Runtime · so far" : "Runtime", "")}
 </div>
 <p class="muted" style="margin:10px 2px 0;font-size:13px"><strong>Destinations</strong> are <em>unique</em> URLs (there are relatively few); <strong>instances</strong> count <em>every</em> hyperlink to them across all pages (there are many). One destination linked from 500 pages is <strong>1 destination</strong> but <strong>500 hyperlink instances</strong>.</p>
 </div>
 ${hasTriage ? shareBar : ""}
 <div class="card">
  <div class="tabs">
   <div class="tab active" data-tab="internal">Internal pages (${state.pages.length.toLocaleString()})</div>
   <div class="tab" data-tab="external">External destinations (${state.external.size.toLocaleString()})</div>
   ${oosTab}
   <div class="tab" data-tab="errint">Broken · internal (${activeInt.length.toLocaleString()})</div>
   <div class="tab" data-tab="errext">Broken · external (${activeExt.length.toLocaleString()})</div>
   <div class="tab" data-tab="blockd">Blocked · uncertain (${blocked.length.toLocaleString()})</div>
   <div class="tab" data-tab="suppressed">Suppressed (${suppressed.length.toLocaleString()})</div>
  </div>
  <div class="panel" id="panel-internal">${pages.length ? `${capNote(pages.length)}<div class="tablewrap"><table class="pagestbl"><thead><tr><th>Depth</th><th>URL</th><th>Title</th><th>Status</th><th>Int</th><th>Ext</th></tr></thead><tbody>${rowsInternal}</tbody></table></div>` : `<p class="muted">No pages crawled.</p>`}</div>
  <div class="panel hidden" id="panel-external">${state.external.size ? `${capNote(state.external.size)}<div class="exptools"><button type="button" class="btn" id="extToggle" data-mode="collapse">Collapse all</button><span class="muted" style="font-size:12px">${byHost.size} domain${byHost.size === 1 ? "" : "s"}</span></div>${extGroups}` : `<p class="muted">No external links found.</p>`}</div>
  ${oosPanel}
  <div class="panel hidden" id="panel-errint">${activeInt.length ? `<p class="muted">Broken internal pages — these are yours to fix.</p>${showPick ? exportBar("errint") + pickHelp + testBar("errint") : ""}<div class="tablewrap"><table${showPick ? ` class="haspick"` : ``}><thead><tr>${showPick ? `${showAllow ? `<th class="pickcol"><input type="checkbox" class="pickall" data-scope="errint" title="Select all"></th>` : ``}<th class="tscell" title="Date &amp; time you last marked the link Broken or Working (auto-filled, saved in this browser)">Last tested</th><th class="tcol" title="Manual check confirms it's broken (it already counts by default)">Broken</th><th class="tcol" title="Manual check shows it works — dropped from the broken count + fix tracker">Working</th>` : ``}<th${showPick ? ` class="urlcol"` : ``}>Broken URL</th><th>Reason</th><th>Found on</th></tr></thead><tbody>${showPick ? pickRows(activeInt) : errRows(activeInt)}</tbody></table></div>` : `<p class="muted">No internal errors. 🎉</p>`}</div>
  <div class="panel hidden" id="panel-errext">${activeExt.length ? `<p class="muted">Unreachable external links — found on your pages, but the destination is down. Fix the link or remove it.</p>${showPick ? exportBar("errext") + pickHelp + testBar("errext") : ""}<div class="tablewrap"><table${showPick ? ` class="haspick"` : ``}><thead><tr>${showPick ? `${showAllow ? `<th class="pickcol"><input type="checkbox" class="pickall" data-scope="errext" title="Select all"></th>` : ``}<th class="tscell" title="Date &amp; time you last marked the link Broken or Working (auto-filled, saved in this browser)">Last tested</th><th class="tcol" title="Manual check confirms it's broken (it already counts by default)">Broken</th><th class="tcol" title="Manual check shows it works — dropped from the broken count + fix tracker">Working</th>` : ``}<th${showPick ? ` class="urlcol"` : ``}>External URL</th><th>Reason</th><th>Found on</th></tr></thead><tbody>${showPick ? pickRows(activeExt) : errRows(activeExt)}</tbody></table></div>` : `<p class="muted">${cfg.checkExternal ? "No unreachable external links. 🎉" : "External links weren't verified — enable “Verify external links resolve”."}</p>`}</div>
  <div class="panel hidden" id="panel-blockd">${blocked.length ? `<p class="muted">Our automated check couldn't confirm these (auth, anti-bot, rate-limiting, or timeouts) — they very likely work in a real browser. Verify by hand before treating as broken. Re-running with <code>--browser</code> and a slower rate (<code>--concurrency 1 --rps 0.5</code>) clears many of them.</p>${showPick ? blockedBar + blockedHelp + blockedCounter("blockd") : ""}${capNote(blocked.length)}<div class="tablewrap"><table${showPick ? ` class="blkpick"` : ``}><thead><tr>${showPick ? `<th class="tscell" title="Date &amp; time you last marked the link Broken or Working (auto-filled, saved in this browser)">Last tested</th><th class="tcol" title="Manual check confirms it's broken — counts it + adds to the fix tracker">Broken</th><th class="tcol" title="Manual check shows it works">Working</th>` : ``}<th${showPick ? ` class="urlcol"` : ``}>URL</th><th>Why uncertain</th><th>Kind</th><th>Found on</th></tr></thead><tbody>${showPick ? blockedPickRows(blocked) : blockedRows(blocked)}</tbody></table></div>` : `<p class="muted">Nothing blocked or uncertain. 🎉</p>`}</div>
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

  // ---- per-referrer fix checkboxes + standalone editable "fix tracker" export ----
  var NL=String.fromCharCode(10), BS=String.fromCharCode(92);
  var fixes=document.querySelectorAll('.fixbox');
  for(var fi=0;fi<fixes.length;fi++){ fixes[fi].addEventListener('change', function(){ var l=this.parentNode; if(l){ l.className = this.checked ? 'reffix done' : 'reffix'; } }); }
  function exportTracker(){
    var tpl=window.__CW_TPL__; if(!tpl){ toast('Tracker template unavailable'); return; }
    var data=JSON.parse(JSON.stringify(window.__CW_BROKEN__||{host:'',internal:[],external:[]}));
    // Drop Errors links marked "Working" (works on manual check) so a confirmed false
    // positive — especially one referenced from many pages — can't flood the tracker.
    // Scope to the Errors panels: Blocked "Working" ticks don't gate the tracker (blocked
    // links only enter it when confirmed Broken, below).
    var excl={}, ob=document.querySelectorAll('#panel-errint .okbox, #panel-errext .okbox'), z, nx=0;
    for(z=0;z<ob.length;z++){ if(ob[z].checked){ if(!excl[ob[z].getAttribute('data-url')]){ nx++; } excl[ob[z].getAttribute('data-url')]=1; } }
    function keep(list){ var out=[],q; for(q=0;q<list.length;q++){ if(!excl[list[q].url]) out.push(list[q]); } return out; }
    data.internal=keep(data.internal||[]); data.external=keep(data.external||[]);
    // Add blocked (uncertain) links the user CONFIRMED broken, routed internal/external by kind.
    var conf={}, bb=document.querySelectorAll('.brokenbox'), w;
    for(w=0;w<bb.length;w++){ if(bb[w].checked){ conf[bb[w].getAttribute('data-url')]=1; } }
    function pickConf(list){ var out=[],q; for(q=0;q<(list||[]).length;q++){ if(conf[list[q].url]) out.push(list[q]); } return out; }
    data.internal=data.internal.concat(pickConf(data.blockedInt));
    data.external=data.external.concat(pickConf(data.blockedExt));
    delete data.blockedInt; delete data.blockedExt;
    // Carry each broken link's manual verdict (Broken/Working) + last-tested timestamp from the
    // report's localStorage into the tracker, so the standalone file shows them and can keep editing.
    function lg(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
    function annotate(list){ for(var q=0;q<list.length;q++){ var u=list[q].url; var vb=lg('cwbroken:'+HOST+':'+u)==='1', vo=lg('cwok:'+HOST+':'+u)==='1'; list[q].v=vb?'broken':(vo?'working':''); list[q].ts=lg('cwts:'+HOST+':'+u)||''; } }
    annotate(data.internal); annotate(data.external);
    var ticked={}, fb=document.querySelectorAll('.fixbox'), j;
    for(j=0;j<fb.length;j++){ if(fb[j].checked){ ticked[fb[j].getAttribute('data-ref')+NL+fb[j].getAttribute('data-broken')]=1; } }
    data.ticked=ticked;
    var inj=JSON.stringify(data).split('</').join('<'+BS+'/');
    var doc=tpl.replace('"__DATA__"', function(){ return inj; });
    try{
      var blob=new Blob([doc],{type:'text/html;charset=utf-8'}), url=URL.createObjectURL(blob), a=document.createElement('a');
      a.href=url; a.download='charlotte-fix-tracker.html'; document.body.appendChild(a); a.click();
      setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
      toast('Exported fix tracker'+(nx?' ('+nx+' not-broken link'+(nx===1?'':'s')+' excluded)':''));
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
  var HOST=${JSON.stringify(state.startHost)}, SCOPES=['errint','errext','blockd'], ERRS=['errint','errext'];
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
  // Live header stat. Errors: every flagged link counts UNLESS confirmed Working, so
  // clearing a false positive drops its many referrer instances. Blocked: only the links
  // confirmed Broken count (default uncertain). Leaves the header accurate after triage.
  function recomputeBroken(){
    var el=document.getElementById('brokenInstN'); if(!el) return;
    var total=0, sc, p, trs, i;
    for(sc=0;sc<ERRS.length;sc++){ p=panel(ERRS[sc]); if(!p) continue; trs=p.querySelectorAll('tr[data-url]');
      for(i=0;i<trs.length;i++){ var o=trs[i].querySelector('.okbox'); if(o&&o.checked) continue; total+=(parseInt(trs[i].getAttribute('data-inst'),10)||0); } }
    p=panel('blockd'); if(p){ trs=p.querySelectorAll('tr[data-url]');
      for(i=0;i<trs.length;i++){ var b=trs[i].querySelector('.brokenbox'); if(b&&b.checked) total+=(parseInt(trs[i].getAttribute('data-inst'),10)||0); } }
    el.textContent=total.toLocaleString?total.toLocaleString():(''+total);
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
    for(i=0;i<bs.length;i++){ bs[i].addEventListener('change', function(){ var url=this.getAttribute('data-url'), tr=rowOf(this); setF(key('cwbroken:',url), this.checked); if(this.checked){ var o=tr.querySelector('.okbox'); if(o&&o.checked){ o.checked=false; setF(key('cwok:',url),false); rmCls(tr,'notbroken'); } addCls(tr,'confirmed'); setTs(tr,url); } else { rmCls(tr,'confirmed'); clrTs(tr,url); } update(scope); }); }
    for(i=0;i<os.length;i++){ os[i].addEventListener('change', function(){ var url=this.getAttribute('data-url'), tr=rowOf(this); setF(key('cwok:',url), this.checked); if(this.checked){ var b=tr.querySelector('.brokenbox'); if(b&&b.checked){ b.checked=false; setF(key('cwbroken:',url),false); rmCls(tr,'confirmed'); } addCls(tr,'notbroken'); setTs(tr,url); } else { rmCls(tr,'notbroken'); clrTs(tr,url); } update(scope); }); }
    update(scope);
  }
  seedFromCopy();
  for(var s=0;s<SCOPES.length;s++){ wire(SCOPES[s]); }
  // Wire the share toolbar (final report only; absent otherwise).
  var bCopy=document.getElementById('cwSaveCopy'); if(bCopy) bCopy.addEventListener('click', saveShareableCopy);
  var bExp=document.getElementById('cwExportV'); if(bExp) bExp.addEventListener('click', exportVerdicts);
  var bImp=document.getElementById('cwImportV'), fImp=document.getElementById('cwImportFile');
  if(bImp&&fImp){ bImp.addEventListener('click', function(){ fImp.click(); }); fImp.addEventListener('change', function(){ var f=this.files&&this.files[0]; importVerdicts(f); try{ this.value=''; }catch(e){} }); }
})();</script>
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
${pagerScript}${NEWWIN}</body></html>`;
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
      summary: { pagesCrawled: state.pages.length, queued: state.queue.length, externalLinks: state.external.size, linkInstances: state.pages.reduce((n, p) => n + (p.internal || 0) + (p.external || 0), 0), brokenLinkInstances: active.reduce((n, e) => n + (refsOf(e.url).length || 1), 0), outOfScope: state.outOfScope.size, errorsInternal: active.filter((e) => (e.kind || "internal") !== "external").length, errorsExternal: active.filter((e) => e.kind === "external").length, blocked: (state.blocked || []).length, suppressed: suppressed.length, retries: state.retries || 0, runtimeMs: Number.isFinite(state.runtimeMs) ? state.runtimeMs : Math.max(0, (state.finishedMs || Date.now()) - (state.startedMs || Date.parse(state.startedAt) || Date.now())) },
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
      body = `<div class="nums"><span><b>${st.pages.length.toLocaleString()}</b> internal pages</span><span><b>${st.external.size.toLocaleString()}</b> external destinations</span><span><b>${li.toLocaleString()}</b> hyperlink instances</span><span class="${bi ? "bad" : ""}"><b>${bi.toLocaleString()}</b> broken hyperlink instances</span><span class="${ei ? "bad" : ""}"><b>${ei}</b> broken · internal</span><span class="${ee ? "bad" : ""}"><b>${ee}</b> broken · external</span><span><b>${bl}</b> blocked</span></div>
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
<header><h1>Crawl report — ${sites.length} sites</h1><p>${esc2(startedAt)} · ${done}/${sites.length} done${partial ? " · crawling… (auto-updates)" : ""} · <b>${totalInstances.toLocaleString()}</b> total hyperlink instances · <b>${totalBroken.toLocaleString()}</b> broken</p></header>
<main>${cards}</main>
${refresh}${NEWWIN}
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
        url: s.url, host: s.host, status: s.partial ? "crawling" : "done", reportFile: s.reportFile.split(/[\\/]/).pop(), jsonFile: s.jsonFile ? s.jsonFile.split(/[\\/]/).pop() : "",
        summary: { pagesCrawled: st.pages.length, externalLinks: st.external.size, linkInstances: st.pages.reduce((n, p) => n + (p.internal || 0) + (p.external || 0), 0), brokenLinkInstances: act.reduce((n, e) => { const r = st.refs && st.refs.get(e.url); return n + ((r ? r.size : 0) || 1); }, 0), errorsInternal: act.filter((e) => (e.kind || "internal") !== "external").length, errorsExternal: act.filter((e) => e.kind === "external").length, blocked: (st.blocked || []).length },
        errors: act.map((e) => errOut(st, e)),
        blocked: (st.blocked || []).map((e) => errOut(st, e)),
      };
    }),
  };
  fs.writeFileSync(cfg.json, JSON.stringify(data, null, 2));
}


module.exports = { buildReport, writeOutputs, buildIndexReport, writeCombinedJson };
