"use strict";
// NEWWIN — the reused side-docked link-window script appended to the report and tracker.
// Split from report-templates.js (AD-082). Constraints unchanged: no backtick / ${} / backslash / inner-IIFE.
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

module.exports = NEWWIN;
