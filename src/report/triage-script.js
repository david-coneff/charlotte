"use strict";
// The manual-triage (Broken/Working verdicts, share toolbar, resizable triage columns)
// IIFE and the non-triage collapse/resize IIFE that buildReport embeds. Each function
// returns the exact bytes report.js used to inline (including the trailing newline
// after </script>). Extracted verbatim (AD-083).

// Manual-testing triage for the Errors/Blocked tabs + live header stats + verdict sharing.
const triageScript = (state, linkInstances) => `<script>(function(){
  // Manual-testing triage for all three tabs (Errors · internal/external + Blocked). Two
  // MUTUALLY-EXCLUSIVE boxes per link — "Broken" (confirms it's dead) and "Working"
  // (confirms it loads). Ticking one unticks the other; clearing both returns the row to
  // its default. "Tested" is implied by either box, so there's no separate Tested box.
  // The Errors tabs default to BROKEN: every flagged link counts toward the header until
  // you tick Working, which subtracts it and drops it from the fix tracker. The Blocked
  // tab defaults to UNCERTAIN (not counted): ticking Broken adds it and routes it into the
  // tracker by kind. A "Last triaged" cell auto-fills the date+time of the latest verdict.
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
  // url -> its referrer pages (from the embedded broken-link data), memoized on first use — feeds the
  // "Referrer pages with broken links" card: as triage changes which links still count as broken, the
  // distinct spread of referrer pages is recomputed from the rows that still count.
  var REFMAP=null;
  function refMap(){ if(REFMAP) return REFMAP; REFMAP={}; var B=(typeof window!=='undefined')?window.__CW_BROKEN__:null; function add(a){ if(a) for(var i=0;i<a.length;i++) REFMAP[a[i].url]=a[i].refs||[]; } if(B){ add(B.internal); add(B.external); add(B.blockedInt); add(B.blockedExt); } return REFMAP; }
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
  // Auto-filled "Last triaged" stamp = local date+time the row's latest verdict was set.
  // Updated whenever Broken or Working is ticked; cleared when the row returns to no verdict.
  function nowStr(){ var d=new Date(); function p(x){ return (x<10?'0':'')+x; } return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+' '+p(d.getHours())+':'+p(d.getMinutes()); }
  function tsCell(tr){ return tr?tr.querySelector('.tscell'):null; }
  function setTs(tr,url){ var s=nowStr(), c=tsCell(tr); if(c) c.textContent=s; setS(key('cwts:',url), s); }
  function clrTs(tr,url){ var c=tsCell(tr); if(c) c.textContent=''; setS(key('cwts:',url), ''); }
  // ---- share testing verdicts (localStorage stays in THIS browser; the file doesn't carry it) ----
  function toast(msg){ var t=document.getElementById('cw-toast'); if(!t){ t=document.createElement('div'); t.id='cw-toast'; t.className='toast'; document.body.appendChild(t); } t.textContent=msg; t.className='toast show'; setTimeout(function(){ t.className='toast'; }, 2600); }
  function dl(blob,name){ try{ var url=URL.createObjectURL(blob), a=document.createElement('a'); a.href=url; a.download=name; document.body.appendChild(a); a.click(); setTimeout(function(){ document.body.removeChild(a); URL.revokeObjectURL(url); }, 0); return true; }catch(e){ return false; } }
  // Save a blob through the File System Access "Save As" PICKER so the operator chooses the folder + name
  // (instead of it landing in the default Downloads folder). Feature-detected: where the API is missing or
  // restricted it falls back to a plain download (dl). Cancelling the picker is silent. This is the additive,
  // download-as-fallback enhancement AD-034 left for "if revisited".
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
  // Snapshot every saved verdict (cwbroken: / cwok: / cwts:) for THIS crawl's host.
  function collectState(){ var out={app:'charlotte-verdicts', host:HOST, v:{}}, s=L(); if(!s) return out; var i,k,n=0; try{ n=s.length; }catch(e){ n=0; } for(i=0;i<n;i++){ try{ k=s.key(i); }catch(e){ k=null; } if(k&&(k.indexOf('cwbroken:'+HOST+':')===0||k.indexOf('cwok:'+HOST+':')===0||k.indexOf('cwts:'+HOST+':')===0)) out.v[k]=s.getItem(k); } return out; }
  function countVerdicts(st){ var links={}, k, pb='cwbroken:'+HOST+':', po='cwok:'+HOST+':', v=(st&&st.v)||{}; for(k in v){ if(!v.hasOwnProperty(k)) continue; if(k.indexOf(pb)===0) links[k.slice(pb.length)]=1; else if(k.indexOf(po)===0) links[k.slice(po.length)]=1; } var c=0,z; for(z in links){ if(links.hasOwnProperty(z)) c++; } return c; }
  function exportVerdicts(){ var st=collectState(), c=countVerdicts(st); if(!c){ toast('No verdicts to export yet — mark some links Broken or Working first'); return; } saveBlob(new Blob([JSON.stringify(st,null,2)],{type:'application/json'}), 'charlotte-verdicts-'+HOST+'.json', 'Exported '+c+' verdict'+(c===1?'':'s')); }
  // Replace each url the file has an opinion on (clear its 3 keys, then set what the file holds);
  // urls the file doesn't mention are left as-is, so several people's exports merge cleanly.
  function applyState(obj){ var s=L(); if(!s||!obj||!obj.v) return 0; var pb='cwbroken:'+HOST+':', po='cwok:'+HOST+':', pt='cwts:'+HOST+':', urls={}, k; for(k in obj.v){ if(!obj.v.hasOwnProperty(k)) continue; if(k.indexOf(pb)===0) urls[k.slice(pb.length)]=1; else if(k.indexOf(po)===0) urls[k.slice(po.length)]=1; else if(k.indexOf(pt)===0) urls[k.slice(pt.length)]=1; } var u; for(u in urls){ if(urls.hasOwnProperty(u)){ try{ s.removeItem(pb+u); s.removeItem(po+u); s.removeItem(pt+u); }catch(e){} } } var c=0; for(k in obj.v){ if(obj.v.hasOwnProperty(k)){ try{ s.setItem(k,obj.v[k]); c++; }catch(e){} } } return c; }
  function importVerdicts(file){ if(!file) return; if(!L()){ toast('This browser blocks storage for local files — serve the report over a local web server to import'); return; } var r=new FileReader(); r.onload=function(){ var obj; try{ obj=JSON.parse(String(r.result)); }catch(e){ obj=null; } if(!obj||obj.app!=='charlotte-verdicts'||!obj.v){ toast('That isn\\'t a Charlotte verdicts file'); return; } if(obj.host!==HOST){ toast('That file is for “'+obj.host+'”, not “'+HOST+'” — not applied'); return; } var c=countVerdicts(obj); applyState(obj); toast('Imported '+c+' verdict'+(c===1?'':'s')+' — reloading…'); setTimeout(function(){ try{ location.reload(); }catch(e){} }, 700); }; r.onerror=function(){ toast('Could not read the file'); }; try{ r.readAsText(file); }catch(e){ toast('Could not read the file'); } }
  // Bake the current verdicts into a fresh self-contained copy of this report: serialize the page,
  // strip any prior seed, and inject window.__CW_SEED__ just before </head> so it runs first.
  function saveShareableCopy(){ var st=collectState(), c=countVerdicts(st); var SO='<scr'+'ipt>window.__CW_SEED__=', SC='</scr'+'ipt>'; var seed=SO+JSON.stringify(st).replace(/</g,'\\\\u003c')+';'+SC; var src='<!doctype html>\\n'+document.documentElement.outerHTML, pos; while((pos=src.indexOf(SO))>=0){ var en=src.indexOf(SC,pos); if(en<0) break; src=src.slice(0,pos)+src.slice(en+SC.length); } if(src.indexOf('</head>')>=0) src=src.replace('</head>', seed+'</head>'); else src=seed+src; saveBlob(new Blob([src],{type:'text/html;charset=utf-8'}), 'charlotte-report-'+HOST+'-shared.html', 'Saved a shareable copy with '+c+' verdict'+(c===1?'':'s')+' baked in'); }
  // On opening a shared copy: prime localStorage from the seed, but ONLY if this browser has no
  // verdicts for this host yet — never clobber a recipient's own triage.
  function seedFromCopy(){ var sd=(typeof window!=='undefined'&&window)?window.__CW_SEED__:null; if(!sd||!sd.v||sd.host!==HOST) return; var s=L(); if(!s) return; var i,k,n=0,has=false; try{ n=s.length; }catch(e){ n=0; } for(i=0;i<n;i++){ try{ k=s.key(i); }catch(e){ k=null; } if(k&&(k.indexOf('cwbroken:'+HOST+':')===0||k.indexOf('cwok:'+HOST+':')===0)){ has=true; break; } } if(has) return; for(k in sd.v){ if(sd.v.hasOwnProperty(k)){ try{ s.setItem(k,sd.v[k]); }catch(e){} } } }
  function update(scope){
    var p=panel(scope); if(!p) return;
    var trs=p.querySelectorAll('tr[data-url]'), n=0, tested=0, broke=0, ok=0, i;
    for(i=0;i<trs.length;i++){ n++; var b=trs[i].querySelector('.brokenbox'), o=trs[i].querySelector('.okbox'); var ib=!!(b&&b.checked), io=!!(o&&o.checked); if(ib||io) tested++; if(ib) broke++; if(io) ok++; }
    var el=p.querySelector('.tcount'); if(el) el.textContent='Manually triaged: '+tested+' / '+n+' · confirmed broken: '+broke+' · confirmed working: '+ok;
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
    var inst=0, uInt=0, uExt=0, sc, p, trs, i, pset={};
    // pset collects the referrer pages of every link that STILL counts as broken — its size is the
    // "Referrer pages with broken links" card (distinct pages, so a page linking several broken URLs
    // counts once). Refs come from refMap() (the embedded broken-link data), keyed by the row's url.
    function addRefs(u){ var M=refMap(), r=u&&M[u]; if(r) for(var z=0;z<r.length;z++) pset[r[z]]=1; }
    // Per-category triage completeness for the green/amber outline: a row is "triaged" if either box is
    // ticked. Internal = errint rows + blocked-internal; External = errext rows + blocked-external;
    // bT/bN = the Blocked·uncertain card's own completeness (all blocked rows, regardless of kind).
    var iT=0, iN=0, eT=0, eN=0, bT=0, bN=0;
    for(sc=0;sc<ERRS.length;sc++){ p=panel(ERRS[sc]); if(!p) continue; trs=p.querySelectorAll('tr[data-url]'); var isInt=(ERRS[sc]==='errint');
      for(i=0;i<trs.length;i++){ var b=trs[i].querySelector('.brokenbox'), o=trs[i].querySelector('.okbox'), td=(b&&b.checked)||(o&&o.checked);
        if(isInt){ iN++; if(td) iT++; } else { eN++; if(td) eT++; }
        if(o&&o.checked) continue;
        inst+=(parseInt(trs[i].getAttribute('data-inst'),10)||0);
        addRefs(trs[i].getAttribute('data-url'));
        if(isInt) uInt++; else uExt++; } }
    p=panel('blockd'); if(p){ trs=p.querySelectorAll('tr[data-url]');
      for(i=0;i<trs.length;i++){ var bb=trs[i].querySelector('.brokenbox'), bo=trs[i].querySelector('.okbox'), ext=(trs[i].getAttribute('data-kind')==='external'), t2=(bb&&bb.checked)||(bo&&bo.checked);
        bN++; if(t2) bT++;
        if(ext){ eN++; if(t2) eT++; } else { iN++; if(t2) iT++; }
        if(!(bb&&bb.checked)) continue;
        inst+=(parseInt(trs[i].getAttribute('data-inst'),10)||0);
        addRefs(trs[i].getAttribute('data-url'));
        if(ext) uExt++; else uInt++; } }
    var pgN=0, pk; for(pk in pset){ if(pset.hasOwnProperty(pk)) pgN++; }
    setStat(document.getElementById('brokenInstN'), inst, DENOM.inst);
    setStat(document.getElementById('brokenIntN'), uInt, DENOM.int);
    setStat(document.getElementById('brokenExtN'), uExt, DENOM.ext);
    setStat(document.getElementById('brokenTotN'), uInt+uExt, DENOM.tot);   // total unique destinations broken
    setStat(document.getElementById('brokenPgN'), pgN);                     // referrer pages with broken links (no %)
    setTestState(document.getElementById('brokenIntN'), iT, iN);
    setTestState(document.getElementById('brokenExtN'), eT, eN);
    // Broken hyperlink instances, total unique destinations broken, AND referrer pages all span internal +
    // external (+ blocked), so their outlines need EVERY triageable link triaged.
    setTestState(document.getElementById('brokenInstN'), iT+eT, iN+eN);
    setTestState(document.getElementById('brokenTotN'), iT+eT, iN+eN);
    setTestState(document.getElementById('brokenPgN'), iT+eT, iN+eN);
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
  // "triaged K/N" counter. Runs on load and after any per-link or bulk verdict change.
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
`;

// Non-triage tabs (External / Internal destinations / Out of scope): collapse + column resize.
const collapseScript = (state) => `<script>(function(){
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
`;

module.exports = { triageScript, collapseScript };
