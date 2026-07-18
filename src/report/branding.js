"use strict";
// Render caps, report branding, the light/dark theme strings, and the HTML escaper —
// the constants every report surface (full report, multi-site index, embedded scripts)
// draws on. Extracted verbatim from report.js in the DS-016 partition (AD-083).
const REF_PREVIEW = 3;             // referrers shown inline in the external/out-of-scope tables
const RENDER_CAP = Infinity;       // render every row in the HTML (no per-table cap); data is also in --json/--log
const PAGE_SIZE = 1000;            // rows per page when client-side pagination is enabled (cfg.paginate / --paginate)
const BRAND = "Charlotte";         // report branding — the project / repo name
const BRAND_ICON = "🕸️";           // spiderweb glyph: favicon + report header

// Light/dark theme. The palette lives in CSS custom properties (:root = dark default); a light override
// hangs off html[data-theme="light"]. We use a data-ATTRIBUTE (not a class) so it never collides with the
// no-flash tab restorer, which owns html.className (tab-<name>). A tiny head script applies the saved
// choice before first paint; a fixed top-right button toggles + persists it (charlotteTheme in localStorage).
const THEME_LIGHT_CSS = ` html[data-theme="light"]{--bg:#f4f6f9;--panel:#ffffff;--panel2:#eaeef3;--fg:#1c2230;--muted:#5b6675;--accent:#0969da;--link:#0a66c2;--good:#1a7f37;--warn:#9a6700;--bad:#cf222e;--border:#d0d7de;--accent-fg:#ffffff}
 .themebtn{position:fixed;top:12px;right:16px;z-index:30;background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:6px 10px;cursor:pointer;font:inherit;font-size:15px;line-height:1}.themebtn:hover{border-color:var(--accent);color:var(--accent)}`;
const THEME_HEAD = `<script>try{if(localStorage.getItem('charlotteTheme')==='light')document.documentElement.setAttribute('data-theme','light');}catch(e){}</script>`;
const THEME_BTN = `<button id="themeToggle" class="themebtn" type="button" title="Toggle light / dark theme">🌙</button>`;
// Outline-key legend, shown (when there's triage) as a compact fixed strip in the upper-right by the theme toggle.
const LEGEND_HINT = `<div class="leghint" title="What the dashed outline around each broken / blocked card means"><span class="leglbl">Outline:</span><span class="legbox lg-g"></span>all triaged<span class="legbox lg-a"></span>some untriaged</div>`;
const THEME_JS = `<script>(function(){var b=document.getElementById('themeToggle');if(!b)return;function cur(){return document.documentElement.getAttribute('data-theme')==='light'?'light':'dark';}function paint(){b.textContent=cur()==='light'?'☀️':'🌙';b.title='Switch to '+(cur()==='light'?'dark':'light')+' theme';}paint();b.addEventListener('click',function(){if(cur()==='light'){document.documentElement.removeAttribute('data-theme');}else{document.documentElement.setAttribute('data-theme','light');}try{localStorage.setItem('charlotteTheme',cur());}catch(e){}paint();});})();</script>`;

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

module.exports = { REF_PREVIEW, RENDER_CAP, PAGE_SIZE, BRAND, BRAND_ICON, THEME_LIGHT_CSS, THEME_HEAD, THEME_BTN, LEGEND_HINT, THEME_JS, esc };
