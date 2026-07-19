"use strict";
// Fix-tracker client script (DS-016 split from tracker-template.js): the DATA island
// + the IIFE that renders the two grouped views, persists fixed/verdict/notes state in
// localStorage, and drives export/import + per-page/per-subfolder bulk export. The exact
// bytes between the tracker document's main <script> tags; concatenated back verbatim by
// the tracker-template assembler. No backticks / ${} / backslashes (see that file).
module.exports = `var DATA = /*CW_DATA_BOUNDS*/"__DATA__"/*CW_DATA_BOUNDS*/;
(function(){
  var NS='cwfix:'+(DATA.host||'')+':', NL=String.fromCharCode(10);
  function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
  function isUrl(s){return s.indexOf('http://')===0||s.indexOf('https://')===0;}
  function cell(s){return isUrl(s)?'<a href="'+esc(s)+'" target="_blank" rel="noopener">'+esc(s)+'</a>':esc(s);}
  // Internal and external broken links are worked TOGETHER: whoever owns a page fixes every broken
  // link on it regardless of type, so the views combine both lists and a Type column / badge records
  // which is which. allList() tags each entry with its type; the stat matrix still breaks out int/ext.
  function allList(){var out=[],a=DATA.internal||[],b=DATA.external||[],i;for(i=0;i<a.length;i++)out.push({url:a[i].url,reason:a[i].reason,refs:a[i].refs,v:a[i].v,ts:a[i].ts,type:'internal'});for(i=0;i<b.length;i++)out.push({url:b[i].url,reason:b[i].reason,refs:b[i].refs,v:b[i].v,ts:b[i].ts,type:'external'});return out;}
  function typeBadge(t){return t==='external'?'<span class="lt lt-ext">external</span>':'<span class="lt lt-int">internal</span>';}
  // Group broken links BY the referrer page that links to them: one person usually
  // owns a whole page, so its broken links sit together under a single contact note.
  function groups(list){
    var map={}, order=[], i, j;
    for(i=0;i<list.length;i++){var e=list[i],r=e.refs||[];for(j=0;j<r.length;j++){var ref=r[j];if(!map.hasOwnProperty(ref)){map[ref]=[];order.push(ref);}map[ref].push({broken:e.url,reason:e.reason,v:e.v||'',ts:e.ts||'',type:e.type||''});}}
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
  function render(){
    var g=groups(allList()),i,j;
    if(!g.order.length)return '<p class="muted">No broken links recorded. 🎉</p>';
    var out=[];
    for(i=0;i<g.order.length;i++){
      var ref=g.order[i],links=g.map[ref],rows='';
      for(j=0;j<links.length;j++){var bk=links[j],pk=pkey(ref,bk.broken),ck=initChecked(ref,bk.broken),ft=initFt(pk),vd=initVerdict(bk.broken,bk.v),tv=initTs(bk.broken,bk.ts);
        rows+='<tr'+(ck?' class="done"':'')+' data-ref="'+esc(ref)+'" data-broken="'+esc(bk.broken)+'"><td class="c"><input type="checkbox" class="fx"'+(ck?' checked':'')+'></td><td class="ft">'+esc(ft)+'</td><td class="ts tsd" data-broken="'+esc(bk.broken)+'">'+esc(tv)+'</td><td class="v"><input type="checkbox" class="vb" data-broken="'+esc(bk.broken)+'"'+(vd==='broken'?' checked':'')+' title="Manual check confirms it is broken"></td><td class="v"><input type="checkbox" class="vo" data-broken="'+esc(bk.broken)+'"'+(vd==='working'?' checked':'')+' title="Manual check shows it works"></td><td>'+cell(bk.broken)+'</td><td class="ltcol">'+typeBadge(bk.type)+'</td><td class="muted">'+esc(bk.reason)+'</td></tr>';}
      out.push({p:folderOf(ref),html:'<div class="grp"><div class="grphead"><div class="grptop"><button type="button" class="grptoggle" title="Show/hide this group"><span class="caret"></span></button><span class="ref">'+cell(ref)+'</span></div><div class="grpctl"><span class="cnt">'+links.length+' broken link'+(links.length===1?'':'s')+'</span><span class="grpfix"></span><label class="grpall" title="Tick to mark every broken link on this page Fixed at once (untick to clear them all)">All: <input type="checkbox" class="grpfixall"> Fixed</label></div><div class="grpnote"><label class="notelbl">Notes <input type="text" class="pnote" data-ref="'+esc(ref)+'" placeholder="notes…" value="'+esc(initNote(ref))+'"></label></div></div><div class="grpbody"><div class="tablewrap"><table class="grptbl gp"><thead><tr><th class="c">Fixed</th><th class="ft">Fixed on</th><th class="ts">Last triaged</th><th class="v">Broken</th><th class="v">Working</th><th>Broken link it points to</th><th class="ltcol">Type</th><th>Reason</th></tr></thead><tbody>'+rows+'</tbody></table></div></div></div>'});
    }
    return out;
  }
  // Reverse mapping: group BY the broken link, listing every page that links to it. The Fixed state
  // is keyed per (page -> link) pair just like the By-page view, so a tick in either grouping is the
  // same underlying flag — switch views and the equivalent box is already ticked.
  function groupsByLink(list){
    var map={}, order=[], i, j;
    for(i=0;i<list.length;i++){var e=list[i],r=e.refs||[];if(!map.hasOwnProperty(e.url)){map[e.url]={reason:e.reason,v:e.v||'',ts:e.ts||'',type:e.type||'',refs:[]};order.push(e.url);}for(j=0;j<r.length;j++)map[e.url].refs.push(r[j]);}
    order.sort();
    for(i=0;i<order.length;i++)map[order[i]].refs.sort();
    return {order:order,map:map};
  }
  function renderByLink(){
    var g=groupsByLink(allList()),i,j;
    if(!g.order.length)return '<p class="muted">No broken links recorded. 🎉</p>';
    var out=[];
    for(i=0;i<g.order.length;i++){
      var url=g.order[i],info=g.map[url],refs=info.refs,vd=initVerdict(url,info.v),tv=initTs(url,info.ts),rows='';
      for(j=0;j<refs.length;j++){var ref=refs[j],pk=pkey(ref,url),ck=initChecked(ref,url),ft=initFt(pk);
        rows+='<tr'+(ck?' class="done"':'')+' data-ref="'+esc(ref)+'" data-broken="'+esc(url)+'"><td class="c"><input type="checkbox" class="fx"'+(ck?' checked':'')+'></td><td class="ft">'+esc(ft)+'</td><td>'+cell(ref)+'</td></tr>';}
      out.push({p:(info.type==='external'?hostOf(url):folderOf(url)),html:'<div class="grp"><div class="grphead"><div class="grptop"><button type="button" class="grptoggle" title="Show/hide this group"><span class="caret"></span></button><span class="ref">'+cell(url)+'</span> '+typeBadge(info.type)+'</div><div class="grpctl"><span class="cnt">'+refs.length+' page'+(refs.length===1?'':'s')+'</span><span class="grpfix"></span><label class="grpall" title="Tick to mark this broken link Fixed on every page that links to it (untick to clear them all)">All: <input type="checkbox" class="grpfixall"> Fixed</label><span class="vlbl">Last triaged <span class="tsd" data-broken="'+esc(url)+'">'+esc(tv)+'</span></span><label class="vlbl">Broken <input type="checkbox" class="vb" data-broken="'+esc(url)+'"'+(vd==='broken'?' checked':'')+' title="Manual check confirms it is broken"></label><label class="vlbl">Working <input type="checkbox" class="vo" data-broken="'+esc(url)+'"'+(vd==='working'?' checked':'')+' title="Manual check shows it works"></label></div></div><div class="grpbody"><div class="grpreason muted">'+esc(info.reason)+'</div><div class="tablewrap"><table class="grptbl gl"><thead><tr><th class="c">Fixed</th><th class="ft">Fixed on</th><th>Page that links here</th></tr></thead><tbody>'+rows+'</tbody></table></div></div></div>'});
    }
    return out;
  }
  function count(){var g=groups(allList()),done=0,total=0,i,j;for(i=0;i<g.order.length;i++){var ref=g.order[i],links=g.map[ref];for(j=0;j<links.length;j++){total++;if(initChecked(ref,links[j].broken))done++;}}return {done:done,total:total,pages:g.order.length};}
  function progress(){var a=count();document.getElementById('prog').textContent='Fixed: '+a.done+'/'+a.total+' link reference'+(a.total===1?'':'s');recompute();}
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
  var PER_PAGE=50, pageState={all:0};
  // Drag-resizable columns (mirrors the crawl report): a grip per header; the new width broadcasts to that
  // column index across every group table in the current view and persists per view ('cwfixcol:host:page'
  // vs ':link', since the two views have different columns). wireCols() re-runs after each fill().
  function colKey(){return 'cwfixcol:'+(DATA.host||'')+':'+viewMode;}
  function loadCols(){var s=lsObj();if(!s)return null;try{var v=s.getItem(colKey());return v?JSON.parse(v):null;}catch(e){return null;}}
  function colTables(){var P=document.getElementById('panel-all');return P?P.querySelectorAll('table.grptbl'):[];}
  function applyCol(idx,px){var ts=colTables(),t;for(t=0;t<ts.length;t++){var hs=ts[t].querySelectorAll('thead th');if(hs[idx])hs[idx].style.width=px+'px';}}
  function saveCol(idx,px){var s=lsObj();if(!s)return;var a=loadCols()||[];a[idx]=px;try{s.setItem(colKey(),JSON.stringify(a));}catch(e){}}
  function gripDown(th,idx,grip,e){e.preventDefault();e.stopPropagation();var startX=e.clientX,startW=th.offsetWidth,cur=startW;addCls(grip,'drag');function mv(ev){cur=Math.max(16,startW+(ev.clientX-startX));applyCol(idx,cur);}function up(){document.removeEventListener('mousemove',mv,true);document.removeEventListener('mouseup',up,true);rmCls(grip,'drag');saveCol(idx,cur);}document.addEventListener('mousemove',mv,true);document.addEventListener('mouseup',up,true);}
  function wireCols(){var ts=colTables();if(!ts.length)return;var saved=loadCols(),i;if(saved){for(i=0;i<saved.length;i++){if(saved[i]>0)applyCol(i,saved[i]);}}var t;for(t=0;t<ts.length;t++){var hs=ts[t].querySelectorAll('thead th'),j;for(j=0;j<hs.length;j++){(function(th,idx){var grip=document.createElement('span');grip.className='colgrip';grip.title='Drag to resize this column';grip.addEventListener('mousedown',function(e){gripDown(th,idx,grip,e);});th.appendChild(grip);})(hs[j],j);}}}
  function resetCols(){var s=lsObj();if(s){try{s.removeItem(colKey());}catch(e){}}var ts=colTables(),t;for(t=0;t<ts.length;t++){var hs=ts[t].querySelectorAll('thead th'),j;for(j=0;j<hs.length;j++)hs[j].style.width='';}}
  function rmode(){var r=viewMode==='link'?renderByLink():render();return (typeof r==='string')?r:orderByParent(r);}
  function pager(which,p,pages,total){return '<div class="pager" data-which="'+which+'"><button type="button" class="btn pgbtn pgprev"'+(p<=0?' disabled':'')+'>‹ Prev</button><span class="pgnum">Page '+(p+1)+' of '+pages+' · '+total+' sections</span><button type="button" class="btn pgbtn pgnext"'+(p>=pages-1?' disabled':'')+'>Next ›</button></div>';}
  // The pager goes in the OUTSIDE .pagerbar (above the scroll viewport) so Prev/Next stay put while you
  // scroll. Sections are paginated (PER_PAGE/page); each page wraps its sections under their folder/domain
  // parent — a parent that straddles a page boundary just repeats its header on the next page.
  function fillPanel(which){var arr=rmode(),host=document.getElementById('panel-'+which),pbar=document.getElementById('pager-'+which);if(typeof arr==='string'){host.innerHTML=arr;if(pbar)pbar.innerHTML='';return;}var totals={},i;for(i=0;i<arr.length;i++)totals[arr[i].p]=(totals[arr[i].p]||0)+1;var total=arr.length,pages=Math.max(1,Math.ceil(total/PER_PAGE));if(pageState[which]>=pages)pageState[which]=pages-1;if(pageState[which]<0)pageState[which]=0;var p=pageState[which],slice=arr.slice(p*PER_PAGE,p*PER_PAGE+PER_PAGE),html='',cur=null,buf='';for(i=0;i<slice.length;i++){if(slice[i].p!==cur){if(cur!==null)html+=parentWrap(cur,totals[cur],buf);buf='';cur=slice[i].p;}buf+=slice[i].html;}if(cur!==null)html+=parentWrap(cur,totals[cur],buf);if(pbar)pbar.innerHTML=(total>PER_PAGE)?pager(which,p,pages,total):'';host.innerHTML=html;}
  function fill(){fillPanel('all');wire();refreshAllGroups();progress();wireCols();}
  var gtabs=document.querySelectorAll('.gtab'),gi;
  for(gi=0;gi<gtabs.length;gi++){gtabs[gi].addEventListener('click',function(){var g=this.getAttribute('data-g'),j;if(g===viewMode)return;viewMode=g;pageState={all:0};for(j=0;j<gtabs.length;j++)gtabs[j].className='gtab'+(gtabs[j]===this?' active':'');fill();});}
  var bExp=document.getElementById('expAll');if(bExp)bExp.addEventListener('click',function(){setAllParents(false);setAllGroups(false);});
  var bCol=document.getElementById('colAll');if(bCol)bCol.addEventListener('click',function(){setAllParents(true);});
  var bCR=document.getElementById('colReset');if(bCR)bCR.addEventListener('click',function(){resetCols();});
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
    blank('panel-all');blank('pager-all');
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
  // count() groups the COMBINED internal+external list, so .pages is the DISTINCT referrer-page count (a
  // page linking both an internal and an external broken link counts once) and .total is the broken-link
  // instance count — both line up with what the per-page export enumerates.
  var cAll=count();
  document.getElementById('sub').textContent=(DATA.host||'')+' · generated '+(DATA.generatedAt||'')+' · '+cAll.pages+' referrer page(s), '+cAll.total+' broken-link instance(s) · fixes, verdicts, times & notes saved in this browser';
  fill();
})();`;
