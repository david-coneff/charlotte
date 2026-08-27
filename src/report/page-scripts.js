"use strict";
// Client-side script blocks embedded by buildReport: the optional pagination script,
// the tab/scroll-state + live-refresh IIFE, and the allowlist-selection + fix-tracker
// export IIFE. Each function returns the exact bytes report.js used to inline
// (including the trailing newline after </script>). Extracted verbatim (AD-096).
const { PAGE_SIZE, BRAND } = require("./branding.js");

  // Optional client-side pagination (--paginate). All rows stay embedded; this only
  // shows PAGE_SIZE at a time (with Prev/Next/jump) so a huge report stays responsive.
  // Applies to every data table — including each broken link's nested "found on"
  // referrer list (which is otherwise uncapped, however many pages link there).
  // Display-only: selection/export read every row regardless of which page is shown.
const pagerScriptFor = (cfg) => cfg.paginate ? `<script>(function(){
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

// Tab activation, scroll/collapse state save-restore, and the partial-report
// non-disruptive live refresh.
const stateScript = (partial) => `<script>
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
`;

// Broken-link selection -> allowlist appendage + the standalone fix-tracker export.
const pickExportScript = (cfg, state) => `<script>
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
  // dl + saveBlob duplicated here so this IIFE's exports (allowlist + fix-tracker) use the same Save-As
  // picker as the share toolbar's IIFE below (the two scripts are separate scopes — like toast above).
  function dl(blob,name){ try{ var url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 0); return true; }catch(e){ return false; } }
  function saveBlob(blob, name, okMsg){
    // Auto-append a filesystem-safe timestamp (YYYY-MM-DD_HH-MM_SS) before the extension so each export is
    // its own versioned file; the picker pre-fills it (the operator can still edit it).
    var td=new Date(), tz=function(x){return (x<10?'0':'')+x;}, ts=td.getFullYear()+'-'+tz(td.getMonth()+1)+'-'+tz(td.getDate())+'_'+tz(td.getHours())+'-'+tz(td.getMinutes())+'_'+tz(td.getSeconds()), tdot=name.lastIndexOf('.');
    name=(tdot<0)?(name+'_'+ts):(name.slice(0,tdot)+'_'+ts+name.slice(tdot));
    function fb(){ toast(dl(blob, name) ? okMsg : 'Save failed'); }
    if(window.showSaveFilePicker){
      var dot=name.lastIndexOf('.'), ext=dot>=0?name.slice(dot):'.txt', acc={};
      acc[ext==='.json'?'application/json':ext==='.html'?'text/html':'text/plain']=[ext];
      window.showSaveFilePicker({suggestedName:name, types:[{description:'File', accept:acc}]})
        .then(function(h){ return h.createWritable(); })
        .then(function(w){ return w.write(blob).then(function(){ return w.close(); }); })
        .then(function(){ toast(okMsg); })
        .catch(function(e){ if(e&&e.name==='AbortError') return; fb(); });
      return;
    }
    fb();
  }
  function doExport(scope){
    var txt=text(scope), name=dlName(), n=picked(scope).length;
    saveBlob(new Blob([txt],{type:'text/plain;charset=utf-8'}), name, 'Exported '+n+' link(s) → '+name);
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
    // rule across Errors (assumed broken) AND Blocked (uncertain). So everything still untriaged is
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
    saveBlob(new Blob([doc],{type:'text/html;charset=utf-8'}), 'charlotte-fix-tracker.html', 'Exported fix tracker'+(nx?' ('+nx+' link'+(nx===1?'':'s')+' marked Working excluded)':''));
  }
  var tb=document.querySelectorAll('.trackbtn');
  for(var ti=0;ti<tb.length;ti++){ tb[ti].addEventListener('click', exportTracker); }
})();
</script>
`;

module.exports = { pagerScriptFor, stateScript, pickExportScript };
