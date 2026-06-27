"use strict";
// Large self-contained report strings, split out of report.js (AD-036) to keep that file
// focused on report assembly. NEWWIN = the side-docked, reused link-window script the report
// and tracker both append; TRACKER_TEMPLATE = the standalone broken-link fix-tracker document
// (which concatenates NEWWIN). Both are plain strings with no report.js dependencies.

// Standalone "fix tracker" document. The crawl report fills the "__DATA__"
// placeholder with a JSON island ({host, generatedAt, internal[], external[],
// ticked{}}) and downloads it; each link object also carries its manual verdict
// (v: 'broken'|'working'|'') and last-tested timestamp (ts), baked from the report.
// The tracker renders itself from that island: two tabs (internal/external), one row
// per referrer→broken-link pair, each with a Fixed checkbox (which stamps its own
// "Fixed on" time), a main-report-style Broken/Working verdict pair (mutually exclusive,
// auto-stamping the Last-tested time, synced per URL), and a per-page Notes field — all
// persisted in the opener's localStorage so a fixer can keep working across sessions. A
// share toolbar can export/import that state as JSON or bake it into a self-contained
// copy (window.__CW_TRK_SEED__ injected before </head>) for emailing — mirroring the report. Authored with no backticks / no ${} /
// no backslashes so it embeds cleanly inside the report's template + script.
// Report links open in a NEW WINDOW (not a new tab), docked to whichever side of the
// crawl-report window has more room, and REUSE a single satellite window so checking a
// link never covers the report and lands in the same spot every time. Reuse is by a held
// JS reference (SAT) navigated with location.replace. We DELIBERATELY do not null the
// popup's opener: doing so revokes the opener's permission to navigate it, so cross-origin
// SAT.location access throws and every click spawns a fresh window (the bug this had). The
// minor reverse-tabnabbing exposure is an accepted trade-off for a local link-checking tool.
// The window is positioned only on first open; reuse just navigates + focuses it. Each (re)use first
// shows a brief blob: interstitial naming the link being loaded, so testing several links that share an
// identical 404 page is visibly distinguishable. Authored with no backticks / no ${} / no backslashes
// (double-quotes come from String.fromCharCode(34)) so it embeds cleanly in the report's template.
const NEWWIN = "<script>(function(){var SAT=null,Q=String.fromCharCode(34);"
+ "function esc(s){return String(s).split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split(Q).join('&quot;');}"
// A tiny same-origin interstitial shown in the popup before each link loads, so testing several links
// that all return the SAME 404 page is visibly distinguishable (you can see a new load was started, and
// WHICH link). It is a blob: document (data: is blocked for top-level nav) that names the target then
// meta-refreshes to it after a beat — no script needed in the blob, so nothing to escape but HTML. The
// opener creates the blob, so it is same-origin with it and may navigate even a cross-origin popup to it
// (verified working from file://). go() falls back to a direct navigation if blobs are unavailable.
+ "function interURL(href){var h=esc(href);var d='<!doctype html><html lang=en><head><meta charset=utf-8>'"
+ "+'<meta http-equiv=refresh content='+Q+'0.6;url='+h+Q+'>'"
+ "+'<title>Loading next link…</title><style>'"
+ "+'html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center;background:#0f1115;color:#e6e9ef;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}'"
+ "+'.b{max-width:82%;text-align:center}'"
+ "+'.s{width:34px;height:34px;margin:0 auto 18px;border:3px solid #2c3340;border-top-color:#5db0ff;border-radius:50%;animation:sp .8s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}'"
+ "+'.t{color:#9aa4b2;font-size:12px;letter-spacing:.06em;text-transform:uppercase;margin:0 0 10px}'"
+ "+'.u{color:#8ec5ff;word-break:break-all;font-size:15px;margin:0 0 16px}'"
+ "+'.h{color:#9aa4b2;font-size:12px}.h a{color:#8ec5ff}'"
+ "+'</style></head><body><div class=b><div class=s></div>'"
+ "+'<p class=t>Loading next link…</p>'"
+ "+'<p class=u>'+h+'</p>'"
+ "+'<p class=h>Not loading? <a href='+Q+h+Q+'>Open it directly</a></p>'"
+ "+'</div></body></html>';try{return URL.createObjectURL(new Blob([d],{type:'text/html'}));}catch(e){return null;}}"
+ "function go(win,href){var u=null;try{u=interURL(href);}catch(e){u=null;}"
+ "if(u){try{win.location.replace(u);setTimeout(function(){try{URL.revokeObjectURL(u);}catch(e){}},6000);return true;}catch(e){}}"
+ "try{win.location.replace(href);return true;}catch(e){}try{win.location.href=href;return true;}catch(e){}return false;}"
+ "function place(href){var sc=window.screen||{};var sw=sc.availWidth||1440,sh=sc.availHeight||900,slx=sc.availLeft||0,sty=sc.availTop||0;var rx=(typeof window.screenX==='number'?window.screenX:window.screenLeft)||0,rw=window.outerWidth||Math.round(sw*0.6);var right=(slx+sw)-(rx+rw),left=rx-slx,MIN=480,w,x;if(right>=left&&right>=MIN){w=right;x=rx+rw;}else if(left>=MIN){w=left;x=slx;}else{w=Math.min(Math.max(MIN,Math.round(sw*0.42)),sw);x=(right>=left)?(slx+sw-w):slx;}w=Math.round(Math.min(w,sw));x=Math.round(x);var h=Math.round(sh),y=Math.round(sty);"
+ "if(SAT&&!SAT.closed){if(go(SAT,href)){try{SAT.focus();}catch(e){}return SAT;}SAT=null;}"
+ "var nw=window.open('','charlotteLink','popup=yes,scrollbars=yes,resizable=yes,width='+w+',height='+h+',left='+x+',top='+y);"
+ "if(nw){SAT=nw;try{nw.moveTo(x,y);nw.resizeTo(w,h);}catch(e){}go(nw,href);try{nw.focus();}catch(e){}return nw;}"
+ "nw=window.open(href,'charlotteLink');if(nw)SAT=nw;return nw;}"
// Intercept clicks on ANY http(s) link anywhere in the report/tracker (every tab routes through the one
// reused satellite window) — not just target=_blank, so a link that forgets that attribute still reuses it.
// Plain (#, blob: downloads, mailto:, relative file:// index links) anchors are left to the browser. Modified
// clicks (ctrl/cmd/shift/middle) fall through so power users can still open a real new tab.
+ "document.addEventListener('click',function(e){if(e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;var a=e.target;while(a&&a.nodeName!=='A')a=a.parentNode;if(!a||!a.href||!/^https?:/i.test(a.href))return;e.preventDefault();place(a.href);},false);})();</script>";

const TRACKER_TEMPLATE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🕸️ Charlotte — Broken-link fix tracker</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Ctext%20y='.9em'%20font-size='90'%3E%F0%9F%95%B8%EF%B8%8F%3C/text%3E%3C/svg%3E">
<style>
:root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--link:#8ec5ff;--good:#4ade80;--warn:#fbbf24;--bad:#f87171;--border:#2c3340;--accent-fg:#06121f}
html[data-theme="light"]{--bg:#f4f6f9;--panel:#ffffff;--panel2:#eaeef3;--fg:#1c2230;--muted:#5b6675;--accent:#0969da;--link:#0a66c2;--good:#1a7f37;--warn:#9a6700;--bad:#cf222e;--border:#d0d7de;--accent-fg:#ffffff}
.themebtn{position:fixed;top:12px;right:16px;z-index:30;background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 10px;cursor:pointer;font:inherit;font-size:15px;line-height:1}.themebtn:hover{border-color:var(--accent);color:var(--accent)}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--panel)}header h1{margin:0 0 4px;font-size:18px}header p{margin:0;color:var(--muted);font-size:13px}
main{max-width:1280px;margin:0 auto;padding:24px}.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px}
.statcard{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:18px}
.statrow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.statrow+.statrow{margin-top:10px}
.stat{background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px 14px;text-align:center}
.statn{font-size:24px;font-weight:700;line-height:1.1}
.statl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-top:5px}
.statpct{font-size:14px;font-weight:600;color:var(--muted)}
.stat.fixed .statn{color:var(--good)}.stat.broken .statn{color:var(--bad)}
.statnote{margin:12px 2px 0;color:var(--muted);font-size:12px}
.bar{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}.grow{flex:1}
.tabs{display:flex;gap:6px}.tab{padding:7px 14px;border-radius:7px;background:var(--panel2);border:1px solid var(--border);cursor:pointer;font-size:13px;color:var(--fg)}.tab.active{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
.gtab{padding:6px 12px;border-radius:7px;background:transparent;border:1px solid var(--border);cursor:pointer;font-size:12px;color:var(--muted)}.gtab.active{background:var(--panel2);color:var(--fg);border-color:var(--accent)}
.vlbl{display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:12px;margin-left:12px}.vlbl input{cursor:pointer}
.btn{background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:6px 12px;font-size:13px;cursor:pointer}.btn:hover{border-color:var(--accent);color:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;position:sticky;top:0;background:var(--panel)}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}td a{color:var(--link)}td{overflow-wrap:anywhere}
.tablewrap{max-height:72vh;overflow:auto;border:1px solid var(--border);border-radius:8px}
.c{width:54px;text-align:center}.c input{width:16px;height:16px;cursor:pointer}
.v{width:54px;text-align:center}.v input{width:16px;height:16px;cursor:pointer}
.ts,.ft{width:118px;white-space:nowrap;color:var(--muted);font-size:11px}
.notelbl{display:flex;align-items:center;gap:6px;flex:1;min-width:240px;color:var(--muted);font-size:12px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:9px 16px;font-size:13px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:50}.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
/* Two-level nesting: a folder/domain .parent wraps its page/link .grp sections (collapsible). */
.parent{border:1px solid var(--border);border-radius:9px;margin-bottom:14px;overflow:hidden;background:var(--bg)}
.parenthead{display:flex;align-items:center;gap:8px;padding:9px 12px;background:var(--panel2);font-weight:600;font-size:13px}
.parentname{overflow-wrap:anywhere}
.parenttoggle{background:none;border:none;color:var(--muted);cursor:pointer;padding:2px 4px;font:inherit;line-height:1}.parenttoggle:hover{color:var(--accent)}
.parent.collapsed .parentbody{display:none}
.parentbody{padding:10px 12px 2px}
.parentbody .grp:last-child{margin-bottom:2px}
.grp{border:1px solid var(--border);border-radius:8px;margin-bottom:14px;overflow:hidden}
/* The grouped key here is a full (often very long) URL, so the header stacks: the link on its own top
   row, then a left-aligned controls row (count, K/N fixed, All: Fixed, verdict), then (By page) a notes
   row — rather than the report's single right-aligned row. */
.grphead{display:flex;flex-direction:column;align-items:stretch;gap:7px;padding:10px 12px;background:var(--panel2)}
.grptop{display:flex;align-items:center;gap:10px}
.grpctl{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.grpnote{display:flex}
.grphead .ref{font-weight:600;overflow-wrap:anywhere}.grphead .cnt{color:var(--muted);font-size:12px}
.grpall{display:inline-flex;align-items:center;gap:5px;color:var(--muted);font-size:12px;font-weight:600;white-space:nowrap;cursor:pointer}.grpall input{width:15px;height:15px;cursor:pointer;margin:0}
.grpreason{padding:2px 12px 8px;font-size:12px;overflow-wrap:anywhere}
.grphead .pnote{flex:1;min-width:220px;background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font:inherit;font-size:12px}.grphead .pnote:focus{outline:none;border-color:var(--accent)}
.grp .tablewrap{max-height:none;overflow:visible;border:none;border-top:1px solid var(--border);border-radius:0}
/* Each tab's group list lives in a fixed-height viewport that scrolls internally (so thousands of groups
   don't stretch the page) and is user-resizable: drag the grip at the bottom-right corner to grow/shrink. */
.trkview{height:72vh;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:10px;resize:vertical;min-height:160px}
.trkview .parent:last-child{margin-bottom:0}
/* Collapsible groups: a caret button toggles a .collapsed class that hides the .grpbody. */
.grptoggle{background:none;border:none;color:var(--muted);cursor:pointer;padding:2px 4px;font:inherit;line-height:1}
.grptoggle:hover{color:var(--accent)}
.caret::before{content:"▼";display:inline-block;width:1em;font-size:11px;color:var(--muted)}
.grp.collapsed .caret::before,.parent.collapsed .caret::before{content:"▶"}
.grp.collapsed .grpbody{display:none}
.grpfix{color:var(--muted);font-size:12px;white-space:nowrap}
/* Completion outline (inset, so .grp's overflow:hidden never clips it): a translucent amber dashed ring
   while the section still has links that are neither Fixed nor marked Working; it simply disappears once
   every link is resolved (no separate "all done" color). */
.grp.needfix .grphead{outline:2px dashed rgba(251,191,36,.55);outline-offset:-2px}
.grpctl .vlbl{margin-left:0}
/* Group-level pagination — lives ABOVE the scroll viewport (in .pagerbar, outside .trkview) so Prev/Next
   stay visible no matter how far you scroll the current page's groups. Only shown when a tab exceeds PER_PAGE. */
.pagerbar{margin-bottom:10px}.pagerbar:empty{display:none}
.pager{display:flex;align-items:center;justify-content:center;gap:12px;padding:6px 8px;flex-wrap:wrap}
.pgnum{color:var(--muted);font-size:12px}
.pgbtn:disabled{opacity:.5;cursor:default}
tr.done td:not(.c):not(.v):not(.ft):not(.ts){opacity:.5;text-decoration:line-through}
.muted{color:var(--muted)}.hidden{display:none}
</style>
<script>try{if(localStorage.getItem('charlotteTheme')==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}</script></head><body><button id="themeToggle" class="themebtn" type="button" title="Toggle light / dark theme">🌙</button>
<header><h1>🕸️ Charlotte <span class="muted" style="font-weight:400">· Broken-link fix tracker</span></h1><p id="sub"></p></header>
<main>
<div class="statcard">
 <div class="statrow">
  <div class="stat fixed"><div class="statn"><span id="st-fInst">0</span> <span class="statpct" id="st-fInstP"></span></div><div class="statl">Fixed hyperlink instances</div></div>
  <div class="stat fixed"><div class="statn"><span id="st-fInt">0</span> <span class="statpct" id="st-fIntP"></span></div><div class="statl">Fixed internal destinations</div></div>
  <div class="stat fixed"><div class="statn"><span id="st-fExt">0</span> <span class="statpct" id="st-fExtP"></span></div><div class="statl">Fixed external destinations</div></div>
  <div class="stat fixed"><div class="statn"><span id="st-fPg">0</span> <span class="statpct" id="st-fPgP"></span></div><div class="statl">Pages remediated</div></div>
 </div>
 <div class="statrow">
  <div class="stat broken"><div class="statn" id="st-bInst">0</div><div class="statl">Broken hyperlink instances</div></div>
  <div class="stat broken"><div class="statn" id="st-bInt">0</div><div class="statl">Broken internal destinations</div></div>
  <div class="stat broken"><div class="statn" id="st-bExt">0</div><div class="statl">Broken external destinations</div></div>
  <div class="stat broken"><div class="statn" id="st-bPg">0</div><div class="statl">Pages with broken links</div></div>
 </div>
 <p class="statnote">Top row = how many references you've <strong>Fixed</strong> (remediated the link on the page), as a share of the <strong>Broken</strong> workload below. Marking a link <strong>Working</strong> drops it from the broken counts.</p>
</div>
<div class="card">
 <div class="bar">
  <div class="tabs"><button class="tab active" data-t="int" type="button">Internal</button><button class="tab" data-t="ext" type="button">External</button></div>
  <div class="tabs" style="margin-left:8px"><button class="gtab active" data-g="page" type="button" title="Group by referrer page, listing the broken links on each page — confirm a page has all its broken links fixed">By page</button><button class="gtab" data-g="link" type="button" title="Group by broken link, listing every page that links to it — confirm a broken link is resolved everywhere it appears">By broken link</button></div>
  <button id="expAll" class="btn" type="button" title="Expand every group on this tab">Expand all</button><button id="colAll" class="btn" type="button" title="Collapse every group on this tab">Collapse all</button>
  <span class="grow"></span><span id="prog" class="muted"></span><button id="reset" class="btn" type="button">Clear ticks</button><span style="width:1px;height:20px;background:var(--border)"></span><button id="cwExp" class="btn" type="button" title="Download this tracker's state (fixed + when, verdicts + when, notes) as JSON to share">⬇ Export</button><button id="cwImp" class="btn" type="button" title="Load one or more tracker-state JSON files (e.g. a folder of contributors' exports) — merges them all by entry, then reloads">⬆ Import</button><button id="cwCopy" class="btn" type="button" title="Save a self-contained copy of this tracker with all current state baked in — email that single file">💾 Save copy</button><button id="cwPages" class="btn" type="button" title="Batch-save one mini-tracker per referrer PAGE — each scoped to just that page's broken links and named after the page address — into a folder you pick. Hand a page's file to whoever owns it; they fix &amp; export, you Import their JSON back here.">🗂 Bulk export: per page</button><button id="cwFolders" class="btn" type="button" title="Batch-save one mini-tracker per tier-1 site SUBFOLDER — every page under e.g. /about/ goes in one file, scoped to those pages' broken links and named after the folder — into a folder you pick. For delegating a whole section of the site to one owner.">🗁 Bulk export: per subfolder</button><input type="file" id="cwImpF" accept="application/json,.json" multiple style="position:fixed;left:-9999px;width:1px;height:1px;opacity:0">
 </div>
 <div class="tabview" id="tv-int"><div class="pagerbar" id="pager-int"></div><div class="trkview" id="view-int"><div id="panel-int"></div></div></div>
 <div class="tabview hidden" id="tv-ext"><div class="pagerbar" id="pager-ext"></div><div class="trkview" id="view-ext"><div id="panel-ext"></div></div></div>
</div></main>
<script>
var DATA = /*CW_DATA_BOUNDS*/"__DATA__"/*CW_DATA_BOUNDS*/;
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
  // All tracker state (fixed flags + their "fixed on" times, verdicts + "last tested" times, notes)
  // lives under NS in this browser's localStorage. "Save copy" (below) can bake the whole set into
  // window.__CW_TRK_SEED__; when localStorage is unavailable, reads fall back to that seed so a shared
  // copy still shows the state read-only.
  function lsObj(){try{return localStorage;}catch(e){return null;}}
  function SEED(){return (typeof window!=='undefined'&&window)?window.__CW_TRK_SEED__:null;}
  function rawGet(fk){var s=lsObj();if(s){try{return s.getItem(fk);}catch(e){}}var sd=SEED();return (sd&&sd.v&&sd.v.hasOwnProperty(fk))?sd.v[fk]:null;}
  function rawSet(fk,v){var s=lsObj();if(!s)return;try{if(v)s.setItem(fk,v);else s.removeItem(fk);}catch(e){}}
  function stored(k){return rawGet(NS+k);}
  function save(k,v){rawSet(NS+k,v?'1':'');}
  function initChecked(ref,broken){var k=pkey(ref,broken),s=stored(k);if(s!=null)return s==='1';return !!(DATA.ticked&&DATA.ticked[k]);}
  // "Fixed on" timestamp — per (referrer → broken) pair, like the Fixed flag itself.
  function storedFt(k){return rawGet(NS+'ft:'+k);}
  function saveFt(k,t){rawSet(NS+'ft:'+k,t);}
  function initFt(k){var s=storedFt(k);return s!=null?s:'';}
  // Notes are PER REFERRER PAGE (free-form: who to contact, status, anything).
  function storedNote(ref){return rawGet(NS+'n:'+ref);}
  function saveNote(ref,v){rawSet(NS+'n:'+ref,v);}
  function initNote(ref){var s=storedNote(ref);if(s!=null)return s;return (DATA.notes&&DATA.notes[ref])||'';}
  // Per-BROKEN-URL manual verdict (Broken/Working) + last-tested timestamp, mirroring the main
  // report. Baked in at export from the report's localStorage; editable + persisted here too.
  function storedV(url){return rawGet(NS+'vd:'+url);}
  function saveV(url,v){rawSet(NS+'vd:'+url,v);}
  function initVerdict(url,baked){var s=storedV(url);if(s!=null)return s;return baked||'';}
  function storedT(url){return rawGet(NS+'vt:'+url);}
  function saveT(url,t){rawSet(NS+'vt:'+url,t);}
  function initTs(url,baked){var s=storedT(url);if(s!=null)return s;return baked||'';}
  function nowStr(){var d=new Date();function p(x){return (x<10?'0':'')+x;}return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes());}
  // Set the verdict for a URL everywhere it appears (a URL can be linked from several pages):
  // ticking one box clears the other, stamps the time (or clears it when no verdict remains).
  // Sync a URL's verdict everywhere it shows — boxes carry data-broken, so this works whether they
  // sit in a row (By page) or a group header (By broken link), and across both groupings at once.
  function setVerdict(url,v){saveV(url,v);saveT(url,v?nowStr():'');var t=initTs(url,''),i;var vbs=document.querySelectorAll('.vb'),vos=document.querySelectorAll('.vo'),tsd=document.querySelectorAll('.tsd');for(i=0;i<vbs.length;i++){if(vbs[i].getAttribute('data-broken')===url)vbs[i].checked=(v==='broken');}for(i=0;i<vos.length;i++){if(vos[i].getAttribute('data-broken')===url)vos[i].checked=(v==='working');}for(i=0;i<tsd.length;i++){if(tsd[i].getAttribute('data-broken')===url)tsd[i].textContent=t;}}
  function render(which){
    var list=(which==='int')?(DATA.internal||[]):(DATA.external||[]),g=groups(list),i,j;
    if(!g.order.length)return '<p class="muted">No '+(which==='int'?'internal':'external')+' broken links recorded. 🎉</p>';
    var out=[];
    for(i=0;i<g.order.length;i++){
      var ref=g.order[i],links=g.map[ref],rows='';
      for(j=0;j<links.length;j++){var bk=links[j],pk=pkey(ref,bk.broken),ck=initChecked(ref,bk.broken),ft=initFt(pk),vd=initVerdict(bk.broken,bk.v),tv=initTs(bk.broken,bk.ts);
        rows+='<tr'+(ck?' class="done"':'')+' data-ref="'+esc(ref)+'" data-broken="'+esc(bk.broken)+'"><td class="c"><input type="checkbox" class="fx"'+(ck?' checked':'')+'></td><td class="ft">'+esc(ft)+'</td><td class="ts tsd" data-broken="'+esc(bk.broken)+'">'+esc(tv)+'</td><td class="v"><input type="checkbox" class="vb" data-broken="'+esc(bk.broken)+'"'+(vd==='broken'?' checked':'')+' title="Manual check confirms it is broken"></td><td class="v"><input type="checkbox" class="vo" data-broken="'+esc(bk.broken)+'"'+(vd==='working'?' checked':'')+' title="Manual check shows it works"></td><td>'+cell(bk.broken)+'</td><td class="muted">'+esc(bk.reason)+'</td></tr>';}
      out.push({p:folderOf(ref),html:'<div class="grp"><div class="grphead"><div class="grptop"><button type="button" class="grptoggle" title="Show/hide this group"><span class="caret"></span></button><span class="ref">'+cell(ref)+'</span></div><div class="grpctl"><span class="cnt">'+links.length+' broken link'+(links.length===1?'':'s')+'</span><span class="grpfix"></span><label class="grpall" title="Tick to mark every broken link on this page Fixed at once (untick to clear them all)">All: <input type="checkbox" class="grpfixall"> Fixed</label></div><div class="grpnote"><label class="notelbl">Notes <input type="text" class="pnote" data-ref="'+esc(ref)+'" placeholder="notes…" value="'+esc(initNote(ref))+'"></label></div></div><div class="grpbody"><div class="tablewrap"><table><thead><tr><th class="c">Fixed</th><th class="ft">Fixed on</th><th class="ts">Last triaged</th><th class="v">Broken</th><th class="v">Working</th><th>Broken link it points to</th><th>Reason</th></tr></thead><tbody>'+rows+'</tbody></table></div></div></div>'});
    }
    return out;
  }
  // Reverse mapping: group BY the broken link, listing every page that links to it. The Fixed state
  // is keyed per (page -> link) pair just like the By-page view, so a tick in either grouping is the
  // same underlying flag — switch views and the equivalent box is already ticked.
  function groupsByLink(list){
    var map={}, order=[], i, j;
    for(i=0;i<list.length;i++){var e=list[i],r=e.refs||[];if(!map.hasOwnProperty(e.url)){map[e.url]={reason:e.reason,v:e.v||'',ts:e.ts||'',refs:[]};order.push(e.url);}for(j=0;j<r.length;j++)map[e.url].refs.push(r[j]);}
    order.sort();
    for(i=0;i<order.length;i++)map[order[i]].refs.sort();
    return {order:order,map:map};
  }
  function renderByLink(which){
    var list=(which==='int')?(DATA.internal||[]):(DATA.external||[]),g=groupsByLink(list),i,j;
    if(!g.order.length)return '<p class="muted">No '+(which==='int'?'internal':'external')+' broken links recorded. 🎉</p>';
    var out=[];
    for(i=0;i<g.order.length;i++){
      var url=g.order[i],info=g.map[url],refs=info.refs,vd=initVerdict(url,info.v),tv=initTs(url,info.ts),rows='';
      for(j=0;j<refs.length;j++){var ref=refs[j],pk=pkey(ref,url),ck=initChecked(ref,url),ft=initFt(pk);
        rows+='<tr'+(ck?' class="done"':'')+' data-ref="'+esc(ref)+'" data-broken="'+esc(url)+'"><td class="c"><input type="checkbox" class="fx"'+(ck?' checked':'')+'></td><td class="ft">'+esc(ft)+'</td><td>'+cell(ref)+'</td></tr>';}
      out.push({p:(which==='ext'?hostOf(url):folderOf(url)),html:'<div class="grp"><div class="grphead"><div class="grptop"><button type="button" class="grptoggle" title="Show/hide this group"><span class="caret"></span></button><span class="ref">'+cell(url)+'</span></div><div class="grpctl"><span class="cnt">'+refs.length+' page'+(refs.length===1?'':'s')+'</span><span class="grpfix"></span><label class="grpall" title="Tick to mark this broken link Fixed on every page that links to it (untick to clear them all)">All: <input type="checkbox" class="grpfixall"> Fixed</label><span class="vlbl">Last triaged <span class="tsd" data-broken="'+esc(url)+'">'+esc(tv)+'</span></span><label class="vlbl">Broken <input type="checkbox" class="vb" data-broken="'+esc(url)+'"'+(vd==='broken'?' checked':'')+' title="Manual check confirms it is broken"></label><label class="vlbl">Working <input type="checkbox" class="vo" data-broken="'+esc(url)+'"'+(vd==='working'?' checked':'')+' title="Manual check shows it works"></label></div></div><div class="grpbody"><div class="grpreason muted">'+esc(info.reason)+'</div><div class="tablewrap"><table><thead><tr><th class="c">Fixed</th><th class="ft">Fixed on</th><th>Page that links here</th></tr></thead><tbody>'+rows+'</tbody></table></div></div></div>'});
    }
    return out;
  }
  function count(which){var list=(which==='int')?(DATA.internal||[]):(DATA.external||[]),g=groups(list),done=0,total=0,i,j;for(i=0;i<g.order.length;i++){var ref=g.order[i],links=g.map[ref];for(j=0;j<links.length;j++){total++;if(initChecked(ref,links[j].broken))done++;}}return {done:done,total:total,pages:g.order.length};}
  function progress(){var a=count('int'),b=count('ext');document.getElementById('prog').textContent='Fixed: internal '+a.done+'/'+a.total+' · external '+b.done+'/'+b.total;recompute();}
  // Top-level stat matrix. BROKEN (bottom row) is verdict-driven: a link counts while its verdict is not
  // Working; instances = the sum of its referrer pages. FIXED (top row) is remediation-driven: an instance
  // is fixed when its (page->link) Fixed box is ticked, a destination when ALL its references are fixed —
  // counted only among broken links, so Fixed is always a share of Broken. Both update live as Fixed boxes
  // and Broken/Working verdicts change.
  function recompute(){
    var s={bInt:0,bExt:0,bInst:0,fInt:0,fExt:0,fInst:0}, pg={};
    // pg[referrer] tracks a page's broken links: it becomes a "broken page" once it has any non-Working
    // link, and is "remediated" only when EVERY one of those links is Fixed (across internal + external).
    function tally(list,isInt){var i,j;for(i=0;i<list.length;i++){var e=list[i],url=e.url,refs=e.refs||[];if(initVerdict(url,e.v)==='working')continue;if(isInt)s.bInt++;else s.bExt++;var allFixed=refs.length>0;for(j=0;j<refs.length;j++){var P=refs[j],fx=initChecked(P,url);s.bInst++;if(fx)s.fInst++;else allFixed=false;if(!pg.hasOwnProperty(P))pg[P]={af:true};if(!fx)pg[P].af=false;}if(allFixed){if(isInt)s.fInt++;else s.fExt++;}}}
    tally(DATA.internal||[],true);tally(DATA.external||[],false);
    var bPg=0,fPg=0,P;for(P in pg){if(pg.hasOwnProperty(P)){bPg++;if(pg[P].af)fPg++;}}
    function setN(id,v){var e=document.getElementById(id);if(e)e.textContent=v.toLocaleString();}
    // Mirror the report's adaptive percent convention (AD-056): at least one decimal, and expand the
    // precision when the fixed share is so small it would round to 0.0 at one decimal.
    function fmtPct(p){if(!(p>0))return '0.0';var d=1;while(d<10&&Number(p.toFixed(d))===0)d++;return p.toFixed(d);}
    function setP(id,num,den){var e=document.getElementById(id);if(e)e.textContent=den>0?'('+fmtPct(num/den*100)+'%)':'';}
    setN('st-bInst',s.bInst);setN('st-bInt',s.bInt);setN('st-bExt',s.bExt);setN('st-bPg',bPg);
    setN('st-fInst',s.fInst);setN('st-fInt',s.fInt);setN('st-fExt',s.fExt);setN('st-fPg',fPg);
    setP('st-fInstP',s.fInst,s.bInst);setP('st-fIntP',s.fInt,s.bInt);setP('st-fExtP',s.fExt,s.bExt);setP('st-fPgP',fPg,bPg);
  }
  // Tiny class helpers — no classList/closest, so the same code also runs under the DOM-stub tracker tests
  // (and matches the report IIFE's idiom). grpOf walks up to the enclosing .grp via exact-token matching,
  // so .grpbody / .grphead / .grpfix never false-match the 'grp' token.
  function hasCls(el,c){return !!(el&&el.className&&(' '+el.className+' ').indexOf(' '+c+' ')>=0);}
  function addCls(el,c){if(el&&!hasCls(el,c))el.className=el.className?el.className+' '+c:c;}
  function rmCls(el,c){if(!el||!hasCls(el,c))return;var p=el.className.split(' '),o=[],i;for(i=0;i<p.length;i++)if(p[i]&&p[i]!==c)o.push(p[i]);el.className=o.join(' ');}
  function toggleCls(el,c,on){if(on===undefined)on=!hasCls(el,c);if(on)addCls(el,c);else rmCls(el,c);}
  function ancByCls(el,c){var n=el;while(n){if(hasCls(n,c))return n;n=n.parentNode;}return null;}
  function grpOf(el){return ancByCls(el,'grp');}
  // ---- two-level nesting: page/link sections roll up under a folder (internal) / domain (external)
  // parent, mirroring the report's tabs. hostOf/folderOf are regex-free (the template forbids backslashes).
  function hostOf(u){u=String(u);var i=u.indexOf('://');if(i<0)return '(unknown host)';var r=u.slice(i+3),e=r.length,k;k=r.indexOf('/');if(k>=0&&k<e)e=k;k=r.indexOf('?');if(k>=0&&k<e)e=k;k=r.indexOf('#');if(k>=0&&k<e)e=k;var h=r.slice(0,e),at=h.indexOf('@');if(at>=0)h=h.slice(at+1);var c=h.indexOf(':');if(c>=0)h=h.slice(0,c);return h.toLowerCase()||'(unknown host)';}
  function folderOf(u){var h=hostOf(u);if(h==='(unknown host)')return '(unknown)';var i=String(u).indexOf('://'),r=String(u).slice(i+3),s=r.indexOf('/');if(s<0)return h+'/';var path=r.slice(s+1),k;k=path.indexOf('?');if(k>=0)path=path.slice(0,k);k=path.indexOf('#');if(k>=0)path=path.slice(0,k);var parts=path.split('/'),seg='',pi;for(pi=0;pi<parts.length;pi++){if(parts[pi]){seg=parts[pi];break;}}return seg?h+'/'+seg+'/':h+'/';}
  // Order sections so same-parent ones are contiguous; bigger parents first, then alpha (stable sub-order).
  function orderByParent(out){var cnt={},i;for(i=0;i<out.length;i++){out[i]._i=i;cnt[out[i].p]=(cnt[out[i].p]||0)+1;}out.sort(function(a,b){var d=cnt[b.p]-cnt[a.p];if(d)return d;if(a.p!==b.p)return a.p<b.p?-1:1;return a._i-b._i;});return out;}
  function parentWrap(name,total,inner){return '<div class="parent"><div class="parenthead"><button type="button" class="parenttoggle" title="Show/hide this folder/domain"><span class="caret"></span></button> <span class="parentname">'+esc(name)+'</span> <span class="muted">('+total+' section'+(total===1?'':'s')+')</span></div><div class="parentbody">'+inner+'</div></div>';}
  function setAllParents(collapsed){var ps=document.querySelectorAll('.parent'),i;for(i=0;i<ps.length;i++)toggleCls(ps[i],'collapsed',collapsed);}
  function wire(){
    var boxes=document.querySelectorAll('.fx'),notes=document.querySelectorAll('.pnote'),vbs=document.querySelectorAll('.vb'),vos=document.querySelectorAll('.vo'),fas=document.querySelectorAll('.grpfixall'),tgs=document.querySelectorAll('.grptoggle'),pps=document.querySelectorAll('.pgprev'),pns=document.querySelectorAll('.pgnext'),i;
    for(i=0;i<boxes.length;i++){boxes[i].addEventListener('change',function(){var tr=this.parentNode.parentNode,k=pkey(tr.getAttribute('data-ref'),tr.getAttribute('data-broken'));save(k,this.checked);var t=this.checked?nowStr():'';saveFt(k,t);var fc=tr.querySelector('.ft');if(fc)fc.textContent=t;tr.className=this.checked?'done':'';var g=grpOf(this);if(g)refreshGroup(g);progress();});}
    for(i=0;i<notes.length;i++){notes[i].addEventListener('input',function(){saveNote(this.getAttribute('data-ref'),this.value);});}
    // Broken/Working verdict boxes: mutually exclusive, auto-stamp the time, synced per URL. A Working
    // tick can resolve a section (no fix needed), so refresh every group's completion outline after.
    for(i=0;i<vbs.length;i++){vbs[i].addEventListener('change',function(){setVerdict(this.getAttribute('data-broken'),this.checked?'broken':'');refreshAllGroups();progress();});}
    for(i=0;i<vos.length;i++){vos[i].addEventListener('change',function(){setVerdict(this.getAttribute('data-broken'),this.checked?'working':'');refreshAllGroups();progress();});}
    // "All: Fixed" bulk box in each section header — ticks/unticks every Fixed box in that group at once.
    for(i=0;i<fas.length;i++){fas[i].addEventListener('change',function(){var g=grpOf(this);if(g)bulkFix(g,this.checked);});}
    // Collapsible group caret + parent (folder/domain) caret + group-level pagination prev/next.
    for(i=0;i<tgs.length;i++){tgs[i].addEventListener('click',function(){var g=grpOf(this);if(g)toggleCls(g,'collapsed');});}
    var pts=document.querySelectorAll('.parenttoggle');for(i=0;i<pts.length;i++){pts[i].addEventListener('click',function(){var pr=ancByCls(this,'parent');if(pr)toggleCls(pr,'collapsed');});}
    for(i=0;i<pps.length;i++){pps[i].addEventListener('click',function(){var pp=ancByCls(this,'pager');if(!pp)return;var w=pp.getAttribute('data-which');pageState[w]--;fill();});}
    for(i=0;i<pns.length;i++){pns[i].addEventListener('click',function(){var pp=ancByCls(this,'pager');if(!pp)return;var w=pp.getAttribute('data-which');pageState[w]++;fill();});}
  }
  // Is the broken link in this row marked Working? (By page the Working box sits in the row; By broken
  // link it sits in the section header — either way it carries data-broken, so look group-wide.)
  function rowWorking(g,tr){var url=tr.getAttribute('data-broken'),vos=g.querySelectorAll('.vo'),i;for(i=0;i<vos.length;i++){if(vos[i].getAttribute('data-broken')===url&&vos[i].checked)return true;}return false;}
  // Per-group "K/N fixed" counter (Fixed boxes), the "All: Fixed" box state, and the completion outline.
  // The amber ring shows while ANY link in the section is still unresolved — neither Fixed nor confirmed
  // Working — and simply clears once every link is resolved (no separate "all done" colour).
  function refreshGroup(g){var rows=g.querySelectorAll('tr[data-ref]'),n=rows.length,fixed=0,resolved=0,i;for(i=0;i<n;i++){var tr=rows[i],fx=tr.querySelector('.fx'),isF=!!(fx&&fx.checked);if(isF)fixed++;if(isF||rowWorking(g,tr))resolved++;}var f=g.querySelector('.grpfix');if(f)f.textContent=fixed+'/'+n+' fixed';toggleCls(g,'needfix',resolved<n);var a=g.querySelector('.grpfixall');if(a){a.checked=(n>0&&fixed>=n);a.indeterminate=(fixed>0&&fixed<n);}}
  // Bulk-apply Fixed to every (page -> link) row in a section: tick/untick its Fixed box, persist the
  // flag + stamp/clear the "Fixed on" time, then refresh the counter/outline + global progress.
  function bulkFix(g,on){var rows=g.querySelectorAll('tr[data-ref]'),i;for(i=0;i<rows.length;i++){var tr=rows[i],fx=tr.querySelector('.fx');if(!fx)continue;fx.checked=on;var k=pkey(tr.getAttribute('data-ref'),tr.getAttribute('data-broken')),t=on?nowStr():'';save(k,on);saveFt(k,t);var fc=tr.querySelector('.ft');if(fc)fc.textContent=t;tr.className=on?'done':'';}refreshGroup(g);progress();}
  function refreshAllGroups(){var gs=document.querySelectorAll('.grp'),i;for(i=0;i<gs.length;i++)refreshGroup(gs[i]);}
  function setAllGroups(collapsed){var gs=document.querySelectorAll('.grp'),i;for(i=0;i<gs.length;i++)toggleCls(gs[i],'collapsed',collapsed);}
  // viewMode = 'page' (referrer page -> its broken links) or 'link' (broken link -> the pages that
  // link to it). Both render the SAME (page,link) pairs, so the Fixed boxes share state across them.
  var viewMode='page';
  // Group-level pagination: with thousands of referrer pages / broken links, render at most PER_PAGE
  // groups per tab behind Prev/Next so the document stays light. The current page is tracked per tab.
  var PER_PAGE=50, pageState={int:0,ext:0};
  function rmode(which){var r=viewMode==='link'?renderByLink(which):render(which);return (typeof r==='string')?r:orderByParent(r);}
  function pager(which,p,pages,total){return '<div class="pager" data-which="'+which+'"><button type="button" class="btn pgbtn pgprev"'+(p<=0?' disabled':'')+'>‹ Prev</button><span class="pgnum">Page '+(p+1)+' of '+pages+' · '+total+' sections</span><button type="button" class="btn pgbtn pgnext"'+(p>=pages-1?' disabled':'')+'>Next ›</button></div>';}
  // The pager goes in the OUTSIDE .pagerbar (above the scroll viewport) so Prev/Next stay put while you
  // scroll. Sections are paginated (PER_PAGE/page); each page wraps its sections under their folder/domain
  // parent — a parent that straddles a page boundary just repeats its header on the next page.
  function fillPanel(which){var arr=rmode(which),host=document.getElementById('panel-'+which),pbar=document.getElementById('pager-'+which);if(typeof arr==='string'){host.innerHTML=arr;if(pbar)pbar.innerHTML='';return;}var totals={},i;for(i=0;i<arr.length;i++)totals[arr[i].p]=(totals[arr[i].p]||0)+1;var total=arr.length,pages=Math.max(1,Math.ceil(total/PER_PAGE));if(pageState[which]>=pages)pageState[which]=pages-1;if(pageState[which]<0)pageState[which]=0;var p=pageState[which],slice=arr.slice(p*PER_PAGE,p*PER_PAGE+PER_PAGE),html='',cur=null,buf='';for(i=0;i<slice.length;i++){if(slice[i].p!==cur){if(cur!==null)html+=parentWrap(cur,totals[cur],buf);buf='';cur=slice[i].p;}buf+=slice[i].html;}if(cur!==null)html+=parentWrap(cur,totals[cur],buf);if(pbar)pbar.innerHTML=(total>PER_PAGE)?pager(which,p,pages,total):'';host.innerHTML=html;}
  function fill(){fillPanel('int');fillPanel('ext');wire();refreshAllGroups();progress();}
  var tabs=document.querySelectorAll('.tab'),i;
  for(i=0;i<tabs.length;i++){tabs[i].addEventListener('click',function(){var t=this.getAttribute('data-t'),j;for(j=0;j<tabs.length;j++)tabs[j].className='tab'+(tabs[j]===this?' active':'');var ti=document.getElementById('tv-int'),te=document.getElementById('tv-ext');if(ti)ti.className=(t==='int')?'tabview':'tabview hidden';if(te)te.className=(t==='ext')?'tabview':'tabview hidden';});}
  var gtabs=document.querySelectorAll('.gtab'),gi;
  for(gi=0;gi<gtabs.length;gi++){gtabs[gi].addEventListener('click',function(){var g=this.getAttribute('data-g'),j;if(g===viewMode)return;viewMode=g;pageState={int:0,ext:0};for(j=0;j<gtabs.length;j++)gtabs[j].className='gtab'+(gtabs[j]===this?' active':'');fill();});}
  var bExp=document.getElementById('expAll');if(bExp)bExp.addEventListener('click',function(){setAllParents(false);setAllGroups(false);});
  var bCol=document.getElementById('colAll');if(bCol)bCol.addEventListener('click',function(){setAllParents(true);});
  document.getElementById('reset').addEventListener('click',function(){if(!window.confirm('Clear all Fixed ticks (and their times) in this tracker? Verdicts and notes are kept.'))return;var lists=(DATA.internal||[]).concat(DATA.external||[]),g=groups(lists),i,j;for(i=0;i<g.order.length;i++){var ref=g.order[i],links=g.map[ref];for(j=0;j<links.length;j++){var pk=pkey(ref,links[j].broken);save(pk,false);saveFt(pk,'');}}fill();});
  // ---- share this tracker's state: export/import JSON + bake a self-contained copy (like the report) ----
  var BS=String.fromCharCode(92);
  function toast(msg){var t=document.getElementById('cw-toast');if(!t){t=document.createElement('div');t.id='cw-toast';t.className='toast';document.body.appendChild(t);}t.textContent=msg;t.className='toast show';setTimeout(function(){t.className='toast';},2600);}
  function dl(blob,name){try{var u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(u);},0);return true;}catch(e){return false;}}
  // Save through the File System Access "Save As" PICKER (operator chooses folder + name); falls back to a
  // plain download where the API is unavailable/restricted. Cancelling the picker is silent.
  function saveBlob(blob,name,okMsg){var td=new Date(),tz=function(x){return (x<10?'0':'')+x;},ts=td.getFullYear()+'-'+tz(td.getMonth()+1)+'-'+tz(td.getDate())+'_'+tz(td.getHours())+'-'+tz(td.getMinutes())+'_'+tz(td.getSeconds()),tdot=name.lastIndexOf('.');name=(tdot<0)?(name+'_'+ts):(name.slice(0,tdot)+'_'+ts+name.slice(tdot));function fb(){toast(dl(blob,name)?okMsg:'Save failed');}if(window.showSaveFilePicker){var dot=name.lastIndexOf('.'),ext=dot>=0?name.slice(dot):'.txt',acc={};acc[ext==='.json'?'application/json':ext==='.html'?'text/html':'text/plain']=[ext];window.showSaveFilePicker({suggestedName:name,types:[{description:'File',accept:acc}]}).then(function(h){return h.createWritable();}).then(function(w){return w.write(blob).then(function(){return w.close();});}).then(function(){toast(okMsg);}).catch(function(e){if(e&&e.name==='AbortError')return;fb();});return;}fb();}
  function collectState(){var out={app:'charlotte-fix-tracker',host:(DATA.host||''),v:{}},s=lsObj();if(!s){var sd=SEED();if(sd&&sd.v){for(var kk in sd.v){if(sd.v.hasOwnProperty(kk))out.v[kk]=sd.v[kk];}}return out;}var i,k,n=0;try{n=s.length;}catch(e){n=0;}for(i=0;i<n;i++){try{k=s.key(i);}catch(e){k=null;}if(k&&k.indexOf(NS)===0)out.v[k]=s.getItem(k);}return out;}
  function countState(st){var n=0,k;for(k in st.v){if(st.v.hasOwnProperty(k))n++;}return n;}
  function exportState(){var st=collectState();if(!countState(st)){toast('Nothing to export yet — tick something first');return;}saveBlob(new Blob([JSON.stringify(st,null,2)],{type:'application/json'}),'charlotte-fix-tracker-'+(DATA.host||'state')+'.json','Exported tracker state');}
  // Apply only keys under THIS site's namespace — a dropped/merged file (e.g. one consolidated from
  // many contributors) can never write stray localStorage keys outside cwfix:<host>:. Returns the
  // count actually applied.
  function applyState(obj){var s=lsObj();if(!s||!obj||!obj.v)return 0;var k,c=0;for(k in obj.v){if(obj.v.hasOwnProperty(k)&&k.indexOf(NS)===0){try{s.setItem(k,obj.v[k]);c++;}catch(e){}}}return c;}
  function importState(file){if(!file)return;if(!lsObj()){toast('This browser blocks storage for local files — serve the tracker over a local web server to import');return;}var r=new FileReader();r.onload=function(){var obj;try{obj=JSON.parse(String(r.result));}catch(e){obj=null;}if(!obj||obj.app!=='charlotte-fix-tracker'||!obj.v){toast('Not a Charlotte fix-tracker state file');return;}if((obj.host||'')!==(DATA.host||'')){toast('That state is for a different site — not applied');return;}var c=countState(obj);applyState(obj);toast('Imported '+c+' entr'+(c===1?'y':'ies')+' — reloading…');setTimeout(function(){try{location.reload();}catch(e){}},700);};r.onerror=function(){toast('Could not read the file');};try{r.readAsText(file);}catch(e){toast('Could not read the file');}}
  // Import one OR MANY state files in a single action and merge them all, then reload once. Lets the
  // operator pull a whole folder of contributors' exports together (the manual counterpart to the
  // SharePoint/Power-Automate merge described in SHAREPOINT-MERGE.md) without importing one at a time.
  function importStateFiles(files){
    if(!files||!files.length)return;
    if(!lsObj()){toast('This browser blocks storage for local files — serve the tracker over a local web server to import');return;}
    var list=[],i;for(i=0;i<files.length;i++)list.push(files[i]);
    var total=list.length,done=0,okFiles=0,okEntries=0,skipBad=0,skipHost=0;
    function finish(){
      if(okFiles===0){toast(skipHost?('No files applied — '+skipHost+' for a different site'):'No valid fix-tracker state files');return;}
      var m='Imported '+okEntries+' entr'+(okEntries===1?'y':'ies')+' from '+okFiles+' file'+(okFiles===1?'':'s');
      if(skipHost)m+=' ('+skipHost+' for a different site, skipped)';
      if(skipBad)m+=' ('+skipBad+' not a tracker file, skipped)';
      toast(m+' — reloading…');
      setTimeout(function(){try{location.reload();}catch(e){}},900);
    }
    function tick(){if(++done===total)finish();}
    function one(file){
      var r=new FileReader();
      r.onload=function(){var obj;try{obj=JSON.parse(String(r.result));}catch(e){obj=null;}
        if(!obj||obj.app!=='charlotte-fix-tracker'||!obj.v){skipBad++;}
        else if((obj.host||'')!==(DATA.host||'')){skipHost++;}
        else {okFiles++;okEntries+=applyState(obj);}
        tick();};
      r.onerror=function(){skipBad++;tick();};
      try{r.readAsText(file);}catch(e){skipBad++;tick();}
    }
    for(i=0;i<list.length;i++)one(list[i]);
  }
  function saveCopy(){var st=collectState();var SO='<scr'+'ipt>window.__CW_TRK_SEED__=',SC='</scr'+'ipt>';var seed=SO+JSON.stringify(st).split('<').join(BS+'u003c')+';'+SC;var src='<!doctype html>'+NL+document.documentElement.outerHTML,pos;while((pos=src.indexOf(SO))>=0){var en=src.indexOf(SC,pos);if(en<0)break;src=src.slice(0,pos)+src.slice(en+SC.length);}if(src.indexOf('</head>')>=0)src=src.replace('</head>',function(){return seed+'</head>';});else src=seed+src;saveBlob(new Blob([src],{type:'text/html;charset=utf-8'}),'charlotte-fix-tracker-'+(DATA.host||'state')+'-shared.html','Saved a self-contained copy with your state baked in');}
  // ---- Per-page mini-trackers ------------------------------------------------------------------
  // Batch-export one self-contained tracker per referrer page, scoped to just that page's broken
  // links and seeded with this tracker's CURRENT state for them, so fix work can be delegated
  // page-by-page and each owner's exported JSON merged straight back here (same host + same per-pair
  // keys => Import just merges). Files go into a folder the operator picks (File System Access
  // getDirectory); each is named after its page address with slashes / other illegal characters
  // turned into underscores. Where the directory API is missing it falls back to individual downloads.
  function pageFileName(u){
    var s=String(u),sch=s.indexOf('://');if(sch>=0)s=s.slice(sch+3);
    var out='',i,c,code;
    for(i=0;i<s.length;i++){c=s.charAt(i);code=s.charCodeAt(i);
      var ok=(code>=48&&code<=57)||(code>=65&&code<=90)||(code>=97&&code<=122)||c==='-'||c==='.'||c==='_';
      out+=ok?c:'_';}
    while(out.indexOf('__')>=0)out=out.split('__').join('_');
    while(out.length&&(out.charAt(0)==='_'||out.charAt(0)==='.'))out=out.slice(1);
    while(out.length&&(out.charAt(out.length-1)==='_'||out.charAt(out.length-1)==='.'))out=out.slice(0,-1);
    if(out.length>120)out=out.slice(0,120);
    return out||'page';
  }
  // Keep only the state keys that belong to the given set of pages: fixed flag + fixed-on + note for
  // each page in pageSet, and the verdict + last-tested for every broken link those pages reference
  // (brokenSet). pageSet has one page (per-page export) or many (per-subfolder export).
  function scopedSeed(full,pageSet,brokenSet){
    var v={},k,suf;
    for(k in full.v){if(!full.v.hasOwnProperty(k)||k.indexOf(NS)!==0)continue;suf=k.slice(NS.length);var keep=false;
      if(suf.indexOf('vd:')===0||suf.indexOf('vt:')===0){keep=brokenSet.hasOwnProperty(suf.slice(3));}
      else if(suf.indexOf('ft:')===0){var rest=suf.slice(3),nl=rest.indexOf(NL);keep=(nl>=0&&pageSet.hasOwnProperty(rest.slice(0,nl)));}
      else if(suf.indexOf('n:')===0){keep=pageSet.hasOwnProperty(suf.slice(2));}
      else {var nl2=suf.indexOf(NL);keep=(nl2>=0&&pageSet.hasOwnProperty(suf.slice(0,nl2)));}
      if(keep)v[k]=full.v[k];}
    return {app:'charlotte-fix-tracker',host:(DATA.host||''),v:v};
  }
  // mode 'page'   -> one mini-tracker per referrer page.
  // mode 'folder' -> one mini-tracker per tier-1 site subfolder (folderOf): every page under e.g.
  //                  site/about/ goes into a single file, scoped to all of those pages' broken links.
  function saveBatch(mode){
    var gnoun=(mode==='folder')?'subfolder':'page', noun=gnoun+' tracker';
    var GI=groups(DATA.internal||[]),GE=groups(DATA.external||[]),full=collectState();
    // All referrer pages (union across both tabs).
    var seen={},pages=[],i;
    function addP(g){for(i=0;i<g.order.length;i++){var p=g.order[i];if(!seen.hasOwnProperty(p)){seen[p]=1;pages.push(p);}}}
    addP(GI);addP(GE);
    // Group those pages: each page is its own group (per-page) or its tier-1 folder (per-subfolder).
    var grpMap={},grpOrder=[];
    for(i=0;i<pages.length;i++){var pg=pages[i],key=(mode==='folder')?folderOf(pg):pg;if(!grpMap.hasOwnProperty(key)){grpMap[key]=[];grpOrder.push(key);}grpMap[key].push(pg);}
    // All broken links referenced by the pages in pageSet, each entry's refs reduced to that set.
    function collect(g,pageSet){var byU={},ord=[],k,j;for(k in pageSet){if(!pageSet.hasOwnProperty(k))continue;var L=g.map[k]||[];for(j=0;j<L.length;j++){var e=L[j],u=e.broken;if(!byU.hasOwnProperty(u)){byU[u]={url:u,reason:e.reason,v:e.v,ts:e.ts,refs:[],s:{}};ord.push(u);}var rec=byU[u];if(!rec.s.hasOwnProperty(k)){rec.s[k]=1;rec.refs.push(k);}}}var out=[],m;for(m=0;m<ord.length;m++){var r=byU[ord[m]];out.push({url:r.url,reason:r.reason,refs:r.refs,v:r.v,ts:r.ts});}return out;}
    // Build the work list: a group qualifies if it still has at least one link that is not Working.
    var jobs=[],used={},skipped=0;
    for(i=0;i<grpOrder.length;i++){
      var key=grpOrder[i],plist=grpMap[key],pset={},pp;
      for(pp=0;pp<plist.length;pp++)pset[plist[pp]]=1;
      var ints=collect(GI,pset),exts=collect(GE,pset),any=false,bs={},j;
      for(j=0;j<ints.length;j++){bs[ints[j].url]=1;if(initVerdict(ints[j].url,ints[j].v)!=='working')any=true;}
      for(j=0;j<exts.length;j++){bs[exts[j].url]=1;if(initVerdict(exts[j].url,exts[j].v)!=='working')any=true;}
      if(!any){skipped++;continue;}  // every link in this group is already marked Working — nothing to fix
      var nm=pageFileName(key),baseNm=nm,nn=2;while(used.hasOwnProperty(nm+'.html')){nm=baseNm+'-'+nn;nn++;}used[nm+'.html']=1;
      jobs.push({name:nm+'.html',data:{host:(DATA.host||''),generatedAt:(DATA.generatedAt||''),internal:ints,external:exts,ticked:{}},seed:scopedSeed(full,pset,bs)});}
    if(!jobs.length){toast('Nothing to export — every link is already marked Working');return;}
    // One shell, reused for every page: clone the document, blank the rendered lists (so no other
    // page's links ride along and the files stay small — fill() rebuilds the scoped view on open),
    // strip any baked seed island, then splice scoped DATA between the boundary markers per page.
    var clone=document.documentElement.cloneNode(true);
    function blank(id){var el=clone.querySelector('#'+id);if(el)el.innerHTML='';}
    blank('panel-int');blank('panel-ext');blank('pager-int');blank('pager-ext');
    var shell='<!doctype html>'+NL+clone.outerHTML;
    var SO='<scr'+'ipt>window.__CW_TRK_SEED__=',SC='</scr'+'ipt>',pos;
    while((pos=shell.indexOf(SO))>=0){var en=shell.indexOf(SC,pos);if(en<0)break;shell=shell.slice(0,pos)+shell.slice(en+SC.length);}
    var M='/*CW_DATA_BOUNDS*/',a=shell.indexOf(M),b=(a>=0)?shell.indexOf(M,a+M.length):-1;
    if(a<0||b<0){toast('Could not locate the data block to scope — export aborted');return;}
    var pre=shell.slice(0,a+M.length),post=shell.slice(b);
    function docFor(job){
      var dj=JSON.stringify(job.data).split('</').join('<'+BS+'/');
      var seed=SO+JSON.stringify(job.seed).split('<').join(BS+'u003c')+';'+SC;
      var head=(pre.indexOf('</head>')>=0)?pre.replace('</head>',function(){return seed+'</head>';}):(seed+pre);
      return head+dj+post;
    }
    function blobFor(job){return new Blob([docFor(job)],{type:'text/html;charset=utf-8'});}
    var skipNote=skipped?(' ('+skipped+' '+gnoun+(skipped===1?'':'s')+' skipped — all links already Working)'):'';
    function done(nw){toast('Wrote '+nw+' '+noun+(nw===1?'':'s')+' of '+jobs.length+skipNote);}
    function fallback(){
      toast('Folder export unavailable — downloading '+jobs.length+' file'+(jobs.length===1?'':'s')+' individually'+skipNote);
      var idx=0;function step(){if(idx>=jobs.length)return;var job=jobs[idx++];dl(blobFor(job),job.name);setTimeout(step,200);}
      step();
    }
    if(window.showDirectoryPicker){
      window.showDirectoryPicker().then(function(dir){
        var idx=0,nw=0;
        function step(){
          if(idx>=jobs.length){done(nw);return;}
          var job=jobs[idx++];
          dir.getFileHandle(job.name,{create:true})
            .then(function(fh){return fh.createWritable();})
            .then(function(w){return w.write(blobFor(job)).then(function(){return w.close();});})
            .then(function(){nw++;if(nw===1||nw%25===0)toast('Writing '+noun+'s… '+nw+'/'+jobs.length);step();})
            .catch(function(){step();});
        }
        toast('Writing '+jobs.length+' '+noun+(jobs.length===1?'':'s')+'…');step();
      }).catch(function(e){if(e&&e.name==='AbortError')return;fallback();});
    }else{fallback();}
  }
  // On opening a baked copy: prime localStorage from the seed unless this browser already has state.
  function seedFromCopy(){var sd=SEED();if(!sd||!sd.v||(sd.host||'')!==(DATA.host||''))return;var s=lsObj();if(!s)return;var i,k,n=0,has=false;try{n=s.length;}catch(e){n=0;}for(i=0;i<n;i++){try{k=s.key(i);}catch(e){k=null;}if(k&&k.indexOf(NS)===0){has=true;break;}}if(has)return;for(k in sd.v){if(sd.v.hasOwnProperty(k)){try{s.setItem(k,sd.v[k]);}catch(e){}}}}
  seedFromCopy();
  var be=document.getElementById('cwExp');if(be)be.addEventListener('click',exportState);
  var bcp=document.getElementById('cwCopy');if(bcp)bcp.addEventListener('click',saveCopy);
  var bpp=document.getElementById('cwPages');if(bpp)bpp.addEventListener('click',function(){saveBatch('page');});
  var bpf=document.getElementById('cwFolders');if(bpf)bpf.addEventListener('click',function(){saveBatch('folder');});
  var bi=document.getElementById('cwImp'),bif=document.getElementById('cwImpF');
  if(bi&&bif){bi.addEventListener('click',function(){bif.click();});bif.addEventListener('change',function(){importStateFiles(this.files);try{this.value='';}catch(e){}});}
  var ci=count('int'),ce=count('ext');
  // DISTINCT referrer pages across both tabs — a page that links both a broken internal AND a broken
  // external destination is ONE page, not two (counting ci.pages+ce.pages would double it). This is the
  // same set the per-page export enumerates, so the two numbers line up.
  function distinctRefPages(){var s={},n=0,add=function(list){var g=groups(list),i;for(i=0;i<g.order.length;i++){if(!s.hasOwnProperty(g.order[i])){s[g.order[i]]=1;n++;}}};add(DATA.internal||[]);add(DATA.external||[]);return n;}
  var refPages=distinctRefPages();
  document.getElementById('sub').textContent=(DATA.host||'')+' · generated '+(DATA.generatedAt||'')+' · '+refPages+' referrer page(s), '+(ci.total+ce.total)+' broken-link instance(s) · fixes, verdicts, times & notes saved in this browser';
  fill();
})();
</script>
` + NEWWIN + `
<script>(function(){var b=document.getElementById('themeToggle');if(!b)return;function cur(){return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';}function paint(){b.textContent=cur()==='light'?'☀️':'🌙';b.title='Switch to '+(cur()==='light'?'dark':'light')+' theme';}paint();b.addEventListener('click',function(){if(cur()==='light'){document.documentElement.removeAttribute('data-theme');}else{document.documentElement.setAttribute('data-theme','light');}try{localStorage.setItem('charlotteTheme',cur());}catch(e){}paint();});})();</script></body></html>`;

module.exports = { NEWWIN, TRACKER_TEMPLATE };
