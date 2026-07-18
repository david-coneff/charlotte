"use strict";
// The full report's stylesheet, emitted by buildReport between its <style> tags.
// Extracted verbatim from report.js's template literal (AD-083); interpolates the
// shared light-theme override. Ends with a newline so `${REPORT_CSS}</style>`
// reproduces the original bytes exactly.
const { THEME_LIGHT_CSS } = require("./branding.js");

const REPORT_CSS = ` :root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--link:#8ec5ff;--good:#4ade80;--bad:#f87171;--warn:#fbbf24;--border:#2c3340;--accent-fg:#06121f}
${THEME_LIGHT_CSS}
 *{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
 header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--panel)}header h1{margin:0 0 4px;font-size:18px}header p{margin:0;color:var(--muted);font-size:13px}
 main{max-width:1500px;margin:0 auto;padding:24px}.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:18px;margin-bottom:20px}
 /* Two rows of broken-over-total pairs (col 1–4) + Blocked in col 5. Fixed 5 columns so each broken
    stat sits directly above its total; collapses to 2 columns on narrow screens. */
 .stats{display:grid;gap:12px;grid-template-columns:repeat(5,minmax(0,1fr))}
 @media (max-width:640px){.stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
 .stat{background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:14px;text-align:center}.stat .n{font-size:26px;font-weight:700}.stat .l{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
 .stat .n .pct{font-size:14px;font-weight:600;color:var(--muted)}
 .stat.good .n{color:var(--good)}.stat.bad .n{color:var(--bad)}.stat.warn .n{color:var(--warn)}
 /* Test-completeness outline on the three "broken" stats: green = every link in that category has a
    verdict (count is final); amber = some still untriaged (count may change). Inset outline -> no shift. */
 .stat.tested-all{outline:2px dashed var(--good);outline-offset:-1px}
 .stat.tested-partial{outline:2px dashed var(--warn);outline-offset:-1px}
 /* Outline-key legend, relocated to a compact fixed strip in the upper-right beside the theme toggle. */
 .leghint{position:fixed;top:13px;right:62px;z-index:30;display:flex;align-items:center;gap:5px;font-size:11px;color:var(--muted);background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:6px 10px}
 .leghint .leglbl{text-transform:uppercase;letter-spacing:.05em;font-size:10px}
 .leghint .legbox{flex:none;width:16px;height:11px;border:2px dashed var(--border);border-radius:3px;margin-left:5px}
 .leghint .legbox.lg-g{border-color:var(--good)}.leghint .legbox.lg-a{border-color:var(--warn)}
 @media (max-width:720px){.leghint{display:none}}
 table{width:100%;border-collapse:collapse;font-size:13px;min-width:820px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--border);vertical-align:top}
 th{color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.05em;position:sticky;top:0;background:var(--panel)}
 /* URL and Found-on columns get real width; long URLs wrap at sensible points, not every character */
 td{overflow-wrap:anywhere;word-break:normal}
 th:first-child,td:first-child{min-width:360px}
 td:last-child{min-width:300px}
 /* Internal-pages table: a 1–2 digit Depth and the small Status/Int/Ext cells shouldn't
    hog width — narrow them and give the space to URL + Title so those wrap far less. */
 td a,a{color:var(--link);text-decoration:none}td a:hover,a:hover{text-decoration:underline}
 /* Fixed-height scroll viewport. resize:vertical adds a bottom-right grip so the operator can drag the
    pane taller/shorter to taste (min-height keeps it from collapsing). Applies to flat tables here and to
    the grouped .groupview below. The triage groups' own .dombody is overflow:visible (no grip there). */
 /* Flat tables (Suppressed, log, read-only/partial fallback) size to content up to a cap, so a short list
    isn't a tall empty box; still drag-resizable. The big grouped lists use .groupview (definite height). */
 .tablewrap{max-height:460px;overflow:auto;border:1px solid var(--border);border-radius:8px;resize:vertical}
 /* Every tab's list lives in a FIXED-HEIGHT viewport that scrolls internally (consistent with the flat
    .tablewrap tables) — so a long grouped list scrolls in place instead of stretching the whole page. */
 .groupview{height:460px;min-height:160px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;resize:vertical}
 .groupview .domgrp:last-child{margin-bottom:0}
 .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:600}.pill.ok{background:rgba(74,222,128,.15);color:var(--good)}.pill.err{background:rgba(248,113,113,.15);color:var(--bad)}.pill.skip{background:rgba(251,191,36,.15);color:var(--warn)}
 .muted{color:var(--muted)}h2{font-size:15px;margin:0 0 12px}details summary{cursor:pointer;font-weight:600;padding:6px 0}
 .tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}.tab{padding:7px 14px;border-radius:7px;background:var(--panel2);border:1px solid var(--border);cursor:pointer;font-size:13px}.tab.active{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
 .hidden{display:none}code{background:var(--panel2);padding:1px 5px;border-radius:4px}
 .exptools{display:flex;align-items:center;gap:10px;margin:0 0 12px}
 /* Collapsible per-tab explanatory text — a muted, small disclosure so the (lengthy) help can be folded away. */
 .helpbox{margin:0 0 10px}
 .helpbox>summary{cursor:pointer;color:var(--muted);font-size:12px;font-weight:600;padding:4px 0}
 .helpbox>summary:hover{color:var(--accent)}
 .helpbox .helpbody{margin-top:4px}
 /* Triage tables — columns sized by CLASS so the layout holds with or without the (opt-in)
    allowlist pick column: .pickcol pick box · .tscell timestamp · .tcol Broken/Working · .urlcol URL. */
 .pickcol{width:34px;text-align:center}
 .tcol{width:80px;text-align:center}
 .tscell{width:140px;white-space:nowrap}
 td.tscell{font-size:13px;color:var(--muted)}
 th.tscell{white-space:nowrap}
 .urlcol{width:380px}
 .reasoncol{width:180px}
 /* Triage AND non-triage grouped tables (.grptbl) use a FIXED layout (predictable widths) and size to the
    SUM of their column widths (width:max-content) rather than stretching to 100% — so no column is starved
    and a very wide window no longer leaves a giant mid-table gap. Every column is RESIZABLE: drag the grip
    on a header's right edge. There is NO enforced minimum width — drag a column as narrow as you like.
    Widths persist per browser and broadcast across a tab's groups so they stay aligned; a "Reset column
    widths" button restores the defaults. */
 table.haspick,table.blkpick,table.grptbl{table-layout:fixed;width:max-content;min-width:0;max-width:none}
 table.haspick th,table.haspick td,table.blkpick th,table.blkpick td,table.grptbl th,table.grptbl td{min-width:0}
 /* Non-triage default column widths live in CSS (not inline) so "Reset column widths" — which clears the
    inline width the drag writes — reverts to these, exactly as the triage tables revert to .urlcol/etc. */
 #panel-internal .grptbl th:nth-child(1){width:64px}#panel-internal .grptbl th:nth-child(2){width:380px}#panel-internal .grptbl th:nth-child(3){width:320px}#panel-internal .grptbl th:nth-child(4){width:96px}#panel-internal .grptbl th:nth-child(5){width:64px}#panel-internal .grptbl th:nth-child(6){width:64px}
 #panel-external .grptbl th:nth-child(1){width:460px}#panel-external .grptbl th:nth-child(2){width:120px}#panel-external .grptbl th:nth-child(3){width:420px}
 #panel-outscope .grptbl th:nth-child(1){width:520px}#panel-outscope .grptbl th:nth-child(2){width:420px}
 .haspick th,.blkpick th,.grptbl th{position:relative}
 .colgrip{position:absolute;top:0;right:0;width:8px;height:100%;cursor:col-resize;user-select:none}
 .colgrip:hover,.colgrip.drag{box-shadow:inset -2px 0 0 var(--accent)}
 table.haspick .foundcol,table.blkpick .foundcol{width:236px}
 .blkpick .kindcol{width:92px}
 /* Errors·external is grouped into collapsible per-domain sections. A custom collapsible (not
    <details>): a .domtoggle button + the domain Broken/Working pair as siblings, so the checkbox
    clicks aren't eaten by a <summary> and the script can collapse via a .collapsed class. */
 .domgrp{border:1px solid var(--border);border-radius:8px;margin-bottom:10px;overflow:hidden}
 .domhead{display:flex;align-items:center;gap:10px;padding:6px 10px;background:var(--panel2);flex-wrap:wrap}
 /* Domains with untested links get a dashed-amber header (inset outline: no clip from the group's
    overflow:hidden, no layout shift); it clears once every link in the domain has a verdict. */
 .domgrp.untested .domhead{outline:2px dashed var(--warn);outline-offset:-2px}
 .domtoggle{flex:1;min-width:200px;background:none;border:none;color:var(--fg);font:inherit;font-weight:600;cursor:pointer;padding:4px 2px;text-align:left;overflow-wrap:anywhere}
 .domtoggle:hover{color:var(--accent)}
 .caret::before{content:"▼";display:inline-block;width:1em;font-size:11px;color:var(--muted);font-weight:400}
 .domgrp.collapsed .caret::before{content:"▶"}
 .domname{overflow-wrap:anywhere}
 .domverdict{font-weight:400;font-size:12px;color:var(--muted);display:inline-flex;flex-wrap:wrap;align-items:center}
 .domall{margin-right:2px}
 .domprog{font-size:12px}
 .domlbl{cursor:pointer;margin-left:14px;white-space:nowrap}
 .domlbl input{cursor:pointer;vertical-align:middle;margin:0 4px 0 0}
 /* Mixture + all-tested are read-only indicators (disabled); they go green when on. */
 .domlbl.ind{cursor:default}.domlbl.ind input{cursor:default}.domlbl.ind.on{color:var(--good)}
 .domgrp.collapsed .dombody{display:none}
 /* The domain's OWN table wrapper shows in full (no inner scrollbar); scope this to .dombody so it does
    NOT also hit the nested "Found on" <details> wrapper, whose inline max-height + scroll must stay. */
 .domgrp .dombody{height:auto;max-height:none;min-height:0;overflow:visible;border:none;border-top:1px solid var(--border);border-radius:0;resize:none}
 /* The drag-to-resize grip + min-height belong only to TOP-LEVEL viewports. Nested .tablewrap (the
    "Found on" referrer sublists, error subtables) must size to content and never sprout their own grip. */
 .tablewrap .tablewrap{height:auto;min-height:0;resize:none}
 .haspick input[type=checkbox],.blkpick input[type=checkbox]{cursor:pointer;width:15px;height:15px}
 .testbar{margin:0 0 12px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}.tcount{color:var(--muted);font-size:12px}
 .colreset,.grpcolreset{margin-left:auto;font-size:12px;padding:4px 10px}
 tr.notbroken td:not(.tcol):not(.tscell):not(.pickcol){opacity:.45;text-decoration:line-through}
 tr.confirmed td:not(.tcol):not(.tscell):not(.pickcol){color:var(--bad)}
 .exportbar{display:flex;align-items:center;gap:10px;margin:0 0 10px;flex-wrap:wrap}.exportbar .grow{flex:1}
 .sharebar{border-left:3px solid var(--accent);padding-top:12px;padding-bottom:12px}.sharebar .exportbar{margin:0}
 .selcount{color:var(--muted);font-size:12px}
 .btn{background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:7px;padding:6px 12px;font-size:13px;cursor:pointer}.btn:hover:not(:disabled){border-color:var(--accent);color:var(--accent)}.btn:disabled{opacity:.5;cursor:default}
 .btn.exportbtn:not(:disabled){background:var(--accent);color:var(--accent-fg);border-color:var(--accent);font-weight:600}
 /* The fix-tracker export is the primary triage output — make the one share-bar button stand out. */
 .sharebar .trackbtn{background:var(--accent);color:var(--accent-fg);border-color:var(--accent);font-weight:600}.sharebar .trackbtn:hover{color:var(--accent-fg);filter:brightness(1.08)}
 .toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:var(--panel2);border:1px solid var(--accent);color:var(--fg);padding:10px 16px;border-radius:8px;font-size:13px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:9}.toast.show{opacity:1}
 .vsep{display:inline-block;width:1px;height:20px;background:var(--border);margin:0 2px;vertical-align:middle}
 /* No-flash tab restore: a head script sets html.tab-NAME before first paint so
    the correct tab/panel renders immediately, not the default then a swap. */
 html[class*="tab-"] .panel{display:none}
 html.tab-internal #panel-internal,html.tab-external #panel-external,html.tab-outscope #panel-outscope,html.tab-errint #panel-errint,html.tab-errext #panel-errext,html.tab-blockd #panel-blockd,html.tab-suppressed #panel-suppressed{display:block}
 html[class*="tab-"] .tab{background:var(--panel2);color:var(--fg);border-color:var(--border)}
 html.tab-internal .tab[data-tab="internal"],html.tab-external .tab[data-tab="external"],html.tab-outscope .tab[data-tab="outscope"],html.tab-errint .tab[data-tab="errint"],html.tab-errext .tab[data-tab="errext"],html.tab-blockd .tab[data-tab="blockd"],html.tab-suppressed .tab[data-tab="suppressed"]{background:var(--accent);color:var(--accent-fg);border-color:var(--accent)}
 .subtable{width:100%;border-collapse:collapse}.subtable td{padding:4px 8px;border-bottom:1px solid var(--border)}
 details summary{color:var(--accent)}
 /* Client-side pagination bar (only present with --paginate, above any table over a page in size, incl. nested referrer lists). */
 .pager{display:flex;align-items:center;gap:8px;margin:0 0 8px;flex-wrap:wrap}.pager .grow{flex:1}.pager .pglabel{font-size:12px}
 .pager .pgjump{width:64px;background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:6px;padding:4px 6px;font:inherit;font-size:12px}
`;

module.exports = { REPORT_CSS };
