"use strict";
// Fix-tracker stylesheet (DS-016 split from tracker-template.js). The exact bytes
// between the tracker document's <style> tags; concatenated back verbatim by the
// tracker-template assembler. No backticks / ${} / backslashes (see that file).
module.exports = `:root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--link:#8ec5ff;--good:#4ade80;--warn:#fbbf24;--bad:#f87171;--border:#2c3340;--accent-fg:#06121f}
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
.ltcol{width:84px}
.lt{display:inline-block;font-size:10px;text-transform:uppercase;letter-spacing:.03em;padding:1px 7px;border-radius:10px;border:1px solid var(--border);color:var(--muted);white-space:nowrap}
.lt-ext{color:var(--accent);border-color:var(--accent)}
/* Drag-resizable table columns — mirrors the crawl report (table-layout:fixed + a grip per header, the
   new width broadcast to that column across every group table, persisted per view, with a Reset control).
   Two table shapes share #panel-all: .gp (By page, 8 cols) and .gl (By broken link, 3 cols); each gets its
   own default widths via nth-child so a Reset reverts to them. No enforced minimum — drag as narrow as you like. */
.grp table.grptbl{table-layout:fixed;width:max-content;min-width:0;max-width:none}
.grptbl th,.grptbl td{min-width:0}
.grptbl th{position:relative}
#panel-all .grptbl.gp th:nth-child(1){width:54px}#panel-all .grptbl.gp th:nth-child(2){width:120px}#panel-all .grptbl.gp th:nth-child(3){width:120px}#panel-all .grptbl.gp th:nth-child(4){width:62px}#panel-all .grptbl.gp th:nth-child(5){width:62px}#panel-all .grptbl.gp th:nth-child(6){width:340px}#panel-all .grptbl.gp th:nth-child(7){width:92px}#panel-all .grptbl.gp th:nth-child(8){width:200px}
#panel-all .grptbl.gl th:nth-child(1){width:54px}#panel-all .grptbl.gl th:nth-child(2){width:120px}#panel-all .grptbl.gl th:nth-child(3){width:520px}
.colgrip{position:absolute;top:0;right:0;width:8px;height:100%;cursor:col-resize;user-select:none}
.colgrip:hover,.colgrip.drag{box-shadow:inset -2px 0 0 var(--accent)}
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
.grp .tablewrap{max-height:none;overflow-x:auto;overflow-y:hidden;border:none;border-top:1px solid var(--border);border-radius:0}
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
.muted{color:var(--muted)}.hidden{display:none}`;
