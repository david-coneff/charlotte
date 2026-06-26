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
// JS reference (SAT) navigated with location.replace — NOT name-based targeting, which
// breaks once the popup's opener is nulled (each click would spawn a fresh window). The
// window is positioned only on first open; reuse just navigates + focuses it. Intercepts
// target="_blank" clicks. Authored with no backticks / no ${} so it embeds cleanly.
const NEWWIN = "<script>(function(){var SAT=null;function place(href){var sc=window.screen||{};var sw=sc.availWidth||1440,sh=sc.availHeight||900,slx=sc.availLeft||0,sty=sc.availTop||0;var rx=(typeof window.screenX==='number'?window.screenX:window.screenLeft)||0,rw=window.outerWidth||Math.round(sw*0.6);var right=(slx+sw)-(rx+rw),left=rx-slx,MIN=480,w,x;if(right>=left&&right>=MIN){w=right;x=rx+rw;}else if(left>=MIN){w=left;x=slx;}else{w=Math.min(Math.max(MIN,Math.round(sw*0.42)),sw);x=(right>=left)?(slx+sw-w):slx;}w=Math.round(Math.min(w,sw));x=Math.round(x);var h=Math.round(sh),y=Math.round(sty);if(SAT&&!SAT.closed){try{SAT.location.replace(href);}catch(e){try{SAT.location.href=href;}catch(e2){SAT=null;}}if(SAT){try{SAT.focus();}catch(e){}return SAT;}}var nw=window.open(href,'charlotteLink','popup=yes,scrollbars=yes,resizable=yes,width='+w+',height='+h+',left='+x+',top='+y);if(nw){SAT=nw;try{nw.opener=null;}catch(e){}try{nw.moveTo(x,y);nw.resizeTo(w,h);}catch(e){}try{nw.focus();}catch(e){}}return nw;}document.addEventListener('click',function(e){var a=e.target;while(a&&a.nodeName!=='A')a=a.parentNode;if(!a||a.getAttribute('target')!=='_blank'||!a.href)return;e.preventDefault();place(a.href);},false);})();</script>";

const TRACKER_TEMPLATE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🕸️ Charlotte — Broken-link fix tracker</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Ctext%20y='.9em'%20font-size='90'%3E%F0%9F%95%B8%EF%B8%8F%3C/text%3E%3C/svg%3E">
<style>
:root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--good:#4ade80;--bad:#f87171;--border:#2c3340}
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--panel)}header h1{margin:0 0 4px;font-size:18px}header p{margin:0;color:var(--muted);font-size:13px}
main{max-width:1280px;margin:0 auto;padding:24px}.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px}
.bar{display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap}.grow{flex:1}
.tabs{display:flex;gap:6px}.tab{padding:7px 14px;border-radius:7px;background:var(--panel2);border:1px solid var(--border);cursor:pointer;font-size:13px;color:var(--fg)}.tab.active{background:var(--accent);color:#06121f;border-color:var(--accent)}
.btn{background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:6px 12px;font-size:13px;cursor:pointer}.btn:hover{border-color:var(--accent);color:var(--accent)}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;position:sticky;top:0;background:var(--panel)}
td a{color:var(--accent);text-decoration:none}td a:hover{text-decoration:underline}td{overflow-wrap:anywhere}
.tablewrap{max-height:72vh;overflow:auto;border:1px solid var(--border);border-radius:8px}
.c{width:54px;text-align:center}.c input{width:16px;height:16px;cursor:pointer}
.v{width:54px;text-align:center}.v input{width:16px;height:16px;cursor:pointer}
.ts,.ft{width:118px;white-space:nowrap;color:var(--muted);font-size:11px}
.notelbl{display:flex;align-items:center;gap:6px;flex:1;min-width:240px;color:var(--muted);font-size:12px}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%) translateY(20px);background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:9px 16px;font-size:13px;opacity:0;pointer-events:none;transition:opacity .2s,transform .2s;z-index:50}.toast.show{opacity:1;transform:translateX(-50%) translateY(0)}
.grp{border:1px solid var(--border);border-radius:8px;margin-bottom:14px;overflow:hidden}
.grphead{display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--panel2);flex-wrap:wrap}
.grphead .ref{font-weight:600;overflow-wrap:anywhere}.grphead .cnt{color:var(--muted);font-size:12px}
.grphead .pnote{flex:1;min-width:220px;background:var(--panel);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font:inherit;font-size:12px}.grphead .pnote:focus{outline:none;border-color:var(--accent)}
.grp .tablewrap{max-height:none;overflow:visible;border:none;border-top:1px solid var(--border);border-radius:0}
tr.done td:not(.c):not(.v):not(.ft):not(.ts){opacity:.5;text-decoration:line-through}
.muted{color:var(--muted)}.hidden{display:none}
</style>
</head><body>
<header><h1>🕸️ Charlotte <span class="muted" style="font-weight:400">· Broken-link fix tracker</span></h1><p id="sub"></p></header>
<main><div class="card">
 <div class="bar">
  <div class="tabs"><button class="tab active" data-t="int" type="button">Internal</button><button class="tab" data-t="ext" type="button">External</button></div>
  <span class="grow"></span><span id="prog" class="muted"></span><button id="reset" class="btn" type="button">Clear ticks</button><span style="width:1px;height:20px;background:var(--border)"></span><button id="cwExp" class="btn" type="button" title="Download this tracker's state (fixed + when, verdicts + when, notes) as JSON to share">⬇ Export</button><button id="cwImp" class="btn" type="button" title="Load a tracker-state JSON someone shared (merges by entry, then reloads)">⬆ Import</button><button id="cwCopy" class="btn" type="button" title="Save a self-contained copy of this tracker with all current state baked in — email that single file">💾 Save copy</button><input type="file" id="cwImpF" accept="application/json,.json" style="display:none">
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
      for(j=0;j<links.length;j++){var bk=links[j],pk=pkey(ref,bk.broken),ck=initChecked(ref,bk.broken),ft=initFt(pk),vd=initVerdict(bk.broken,bk.v),tv=initTs(bk.broken,bk.ts);
        rows+='<tr'+(ck?' class="done"':'')+' data-ref="'+esc(ref)+'" data-broken="'+esc(bk.broken)+'"><td class="c"><input type="checkbox" class="fx"'+(ck?' checked':'')+'></td><td class="ft">'+esc(ft)+'</td><td class="ts">'+esc(tv)+'</td><td class="v"><input type="checkbox" class="vb"'+(vd==='broken'?' checked':'')+' title="Manual check confirms it is broken"></td><td class="v"><input type="checkbox" class="vo"'+(vd==='working'?' checked':'')+' title="Manual check shows it works"></td><td>'+cell(bk.broken)+'</td><td class="muted">'+esc(bk.reason)+'</td></tr>';}
      html+='<div class="grp"><div class="grphead"><span class="ref">'+cell(ref)+'</span><span class="cnt">'+links.length+' broken link'+(links.length===1?'':'s')+'</span><span class="grow"></span><label class="notelbl">Notes <input type="text" class="pnote" data-ref="'+esc(ref)+'" placeholder="notes…" value="'+esc(initNote(ref))+'"></label></div><div class="tablewrap"><table><thead><tr><th class="c">Fixed</th><th class="ft">Fixed on</th><th class="ts">Last tested</th><th class="v">Broken</th><th class="v">Working</th><th>Broken link it points to</th><th>Reason</th></tr></thead><tbody>'+rows+'</tbody></table></div></div>';
    }
    return html;
  }
  function count(which){var list=(which==='int')?(DATA.internal||[]):(DATA.external||[]),g=groups(list),done=0,total=0,i,j;for(i=0;i<g.order.length;i++){var ref=g.order[i],links=g.map[ref];for(j=0;j<links.length;j++){total++;if(initChecked(ref,links[j].broken))done++;}}return {done:done,total:total,pages:g.order.length};}
  function progress(){var a=count('int'),b=count('ext');document.getElementById('prog').textContent='Fixed: internal '+a.done+'/'+a.total+' · external '+b.done+'/'+b.total;}
  function wire(){
    var boxes=document.querySelectorAll('.fx'),notes=document.querySelectorAll('.pnote'),vbs=document.querySelectorAll('.vb'),vos=document.querySelectorAll('.vo'),i;
    for(i=0;i<boxes.length;i++){boxes[i].addEventListener('change',function(){var tr=this.parentNode.parentNode,k=pkey(tr.getAttribute('data-ref'),tr.getAttribute('data-broken'));save(k,this.checked);var t=this.checked?nowStr():'';saveFt(k,t);var fc=tr.querySelector('.ft');if(fc)fc.textContent=t;tr.className=this.checked?'done':'';progress();});}
    for(i=0;i<notes.length;i++){notes[i].addEventListener('input',function(){saveNote(this.getAttribute('data-ref'),this.value);});}
    // Broken/Working verdict boxes: mutually exclusive, auto-stamp the time, synced per URL.
    for(i=0;i<vbs.length;i++){vbs[i].addEventListener('change',function(){var tr=this.parentNode.parentNode;setVerdict(tr.getAttribute('data-broken'),this.checked?'broken':'');});}
    for(i=0;i<vos.length;i++){vos[i].addEventListener('change',function(){var tr=this.parentNode.parentNode;setVerdict(tr.getAttribute('data-broken'),this.checked?'working':'');});}
  }
  function fill(){document.getElementById('panel-int').innerHTML=render('int');document.getElementById('panel-ext').innerHTML=render('ext');wire();progress();}
  var tabs=document.querySelectorAll('.tab'),i;
  for(i=0;i<tabs.length;i++){tabs[i].addEventListener('click',function(){var t=this.getAttribute('data-t'),j;for(j=0;j<tabs.length;j++)tabs[j].className='tab'+(tabs[j]===this?' active':'');document.getElementById('panel-int').className=(t==='int')?'':'hidden';document.getElementById('panel-ext').className=(t==='ext')?'':'hidden';});}
  document.getElementById('reset').addEventListener('click',function(){if(!window.confirm('Clear all Fixed ticks (and their times) in this tracker? Verdicts and notes are kept.'))return;var lists=(DATA.internal||[]).concat(DATA.external||[]),g=groups(lists),i,j;for(i=0;i<g.order.length;i++){var ref=g.order[i],links=g.map[ref];for(j=0;j<links.length;j++){var pk=pkey(ref,links[j].broken);save(pk,false);saveFt(pk,'');}}fill();});
  // ---- share this tracker's state: export/import JSON + bake a self-contained copy (like the report) ----
  var BS=String.fromCharCode(92);
  function toast(msg){var t=document.getElementById('cw-toast');if(!t){t=document.createElement('div');t.id='cw-toast';t.className='toast';document.body.appendChild(t);}t.textContent=msg;t.className='toast show';setTimeout(function(){t.className='toast';},2600);}
  function dl(blob,name){try{var u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();setTimeout(function(){document.body.removeChild(a);URL.revokeObjectURL(u);},0);return true;}catch(e){return false;}}
  function collectState(){var out={app:'charlotte-fix-tracker',host:(DATA.host||''),v:{}},s=lsObj();if(!s){var sd=SEED();if(sd&&sd.v){for(var kk in sd.v){if(sd.v.hasOwnProperty(kk))out.v[kk]=sd.v[kk];}}return out;}var i,k,n=0;try{n=s.length;}catch(e){n=0;}for(i=0;i<n;i++){try{k=s.key(i);}catch(e){k=null;}if(k&&k.indexOf(NS)===0)out.v[k]=s.getItem(k);}return out;}
  function countState(st){var n=0,k;for(k in st.v){if(st.v.hasOwnProperty(k))n++;}return n;}
  function exportState(){var st=collectState();if(!countState(st)){toast('Nothing to export yet — tick something first');return;}toast(dl(new Blob([JSON.stringify(st,null,2)],{type:'application/json'}),'charlotte-fix-tracker-'+(DATA.host||'state')+'.json')?'Exported tracker state':'Export failed');}
  function applyState(obj){var s=lsObj();if(!s||!obj||!obj.v)return 0;var k,c=0;for(k in obj.v){if(obj.v.hasOwnProperty(k)){try{s.setItem(k,obj.v[k]);c++;}catch(e){}}}return c;}
  function importState(file){if(!file)return;if(!lsObj()){toast('This browser blocks storage for local files — serve the tracker over a local web server to import');return;}var r=new FileReader();r.onload=function(){var obj;try{obj=JSON.parse(String(r.result));}catch(e){obj=null;}if(!obj||obj.app!=='charlotte-fix-tracker'||!obj.v){toast('Not a Charlotte fix-tracker state file');return;}if((obj.host||'')!==(DATA.host||'')){toast('That state is for a different site — not applied');return;}var c=countState(obj);applyState(obj);toast('Imported '+c+' entr'+(c===1?'y':'ies')+' — reloading…');setTimeout(function(){try{location.reload();}catch(e){}},700);};r.onerror=function(){toast('Could not read the file');};try{r.readAsText(file);}catch(e){toast('Could not read the file');}}
  function saveCopy(){var st=collectState();var SO='<scr'+'ipt>window.__CW_TRK_SEED__=',SC='</scr'+'ipt>';var seed=SO+JSON.stringify(st).split('<').join(BS+'u003c')+';'+SC;var src='<!doctype html>'+NL+document.documentElement.outerHTML,pos;while((pos=src.indexOf(SO))>=0){var en=src.indexOf(SC,pos);if(en<0)break;src=src.slice(0,pos)+src.slice(en+SC.length);}if(src.indexOf('</head>')>=0)src=src.replace('</head>',function(){return seed+'</head>';});else src=seed+src;toast(dl(new Blob([src],{type:'text/html;charset=utf-8'}),'charlotte-fix-tracker-'+(DATA.host||'state')+'-shared.html')?'Saved a self-contained copy with your state baked in':'Save failed');}
  // On opening a baked copy: prime localStorage from the seed unless this browser already has state.
  function seedFromCopy(){var sd=SEED();if(!sd||!sd.v||(sd.host||'')!==(DATA.host||''))return;var s=lsObj();if(!s)return;var i,k,n=0,has=false;try{n=s.length;}catch(e){n=0;}for(i=0;i<n;i++){try{k=s.key(i);}catch(e){k=null;}if(k&&k.indexOf(NS)===0){has=true;break;}}if(has)return;for(k in sd.v){if(sd.v.hasOwnProperty(k)){try{s.setItem(k,sd.v[k]);}catch(e){}}}}
  seedFromCopy();
  var be=document.getElementById('cwExp');if(be)be.addEventListener('click',exportState);
  var bcp=document.getElementById('cwCopy');if(bcp)bcp.addEventListener('click',saveCopy);
  var bi=document.getElementById('cwImp'),bif=document.getElementById('cwImpF');
  if(bi&&bif){bi.addEventListener('click',function(){bif.click();});bif.addEventListener('change',function(){var f=this.files&&this.files[0];importState(f);try{this.value='';}catch(e){}});}
  var ci=count('int'),ce=count('ext');
  document.getElementById('sub').textContent=(DATA.host||'')+' · generated '+(DATA.generatedAt||'')+' · '+(ci.pages+ce.pages)+' referrer page(s), '+(ci.total+ce.total)+' broken-link instance(s) · fixes, verdicts, times & notes saved in this browser';
  fill();
})();
</script>
` + NEWWIN + `
</body></html>`;

module.exports = { NEWWIN, TRACKER_TEMPLATE };
