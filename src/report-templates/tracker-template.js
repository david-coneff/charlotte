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
// DS-016 monolith split: the <style> block and the main tracker IIFE moved into
// sibling string modules (tracker-css.js / tracker-script.js), mirroring report.js's
// page-css / page-scripts split (AD-083). This file is now a thin assembler that
// concatenates head + CSS + body + script + NEWWIN + theme-toggle, reproducing the
// original tracker document byte-for-byte. TRACKER_TEMPLATE is embedded verbatim into
// report.js's template literal, so the no-backtick/${}/backslash constraints still hold.
const NEWWIN = require("./newwin");
const TRACKER_CSS = require("./tracker-css");
const TRACKER_SCRIPT = require("./tracker-script");
const TRACKER_TEMPLATE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>🕸️ Charlotte — Broken-link fix tracker</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%20100%20100'%3E%3Ctext%20y='.9em'%20font-size='90'%3E%F0%9F%95%B8%EF%B8%8F%3C/text%3E%3C/svg%3E">
<style>
` + TRACKER_CSS + `
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
  <div class="tabs"><button class="gtab active" data-g="page" type="button" title="Group by referrer page, listing ALL its broken links (internal and external together) — fix a whole page at once">By page</button><button class="gtab" data-g="link" type="button" title="Group by broken link, listing every page that links to it — confirm a broken link is resolved everywhere it appears">By broken link</button></div>
  <button id="expAll" class="btn" type="button" title="Expand every group on this tab">Expand all</button><button id="colAll" class="btn" type="button" title="Collapse every group on this tab">Collapse all</button><button id="colReset" class="btn" type="button" title="Restore the default column widths">↔ Reset columns</button>
  <span class="grow"></span><span id="prog" class="muted"></span><button id="reset" class="btn" type="button">Clear ticks</button><span style="width:1px;height:20px;background:var(--border)"></span><button id="cwExp" class="btn" type="button" title="Download this tracker's state (fixed + when, verdicts + when, notes) as JSON to share">⬇ Export</button><button id="cwImp" class="btn" type="button" title="Load one or more tracker-state JSON files (e.g. a folder of contributors' exports) — merges them all by entry, then reloads">⬆ Import</button><button id="cwCopy" class="btn" type="button" title="Save a self-contained copy of this tracker with all current state baked in — email that single file">💾 Save copy</button><button id="cwPages" class="btn" type="button" title="Batch-save one mini-tracker per referrer PAGE — each scoped to just that page's broken links and named after the page address — into a folder you pick. Hand a page's file to whoever owns it; they fix &amp; export, you Import their JSON back here.">🗂 Bulk export: per page</button><button id="cwFolders" class="btn" type="button" title="Batch-save one mini-tracker per tier-1 site SUBFOLDER — every page under e.g. /about/ goes in one file, scoped to those pages' broken links and named after the folder — into a folder you pick. For delegating a whole section of the site to one owner.">🗁 Bulk export: per subfolder</button><input type="file" id="cwImpF" accept="application/json,.json" multiple style="position:fixed;left:-9999px;width:1px;height:1px;opacity:0">
 </div>
 <div class="tabview" id="tv-all"><div class="pagerbar" id="pager-all"></div><div class="trkview" id="view-all"><div id="panel-all"></div></div></div>
</div></main>
<script>
` + TRACKER_SCRIPT + `
</script>
` + NEWWIN + `
<script>(function(){var b=document.getElementById('themeToggle');if(!b)return;function cur(){return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';}function paint(){b.textContent=cur()==='light'?'☀️':'🌙';b.title='Switch to '+(cur()==='light'?'dark':'light')+' theme';}paint();b.addEventListener('click',function(){if(cur()==='light'){document.documentElement.removeAttribute('data-theme');}else{document.documentElement.setAttribute('data-theme','light');}try{localStorage.setItem('charlotteTheme',cur());}catch(e){}paint();});})();</script></body></html>`;

module.exports = TRACKER_TEMPLATE;
