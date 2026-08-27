"use strict";
// Multi-site surfaces: buildIndexReport (the per-site card index page) and
// writeCombinedJson (the combined machine-readable index). Extracted verbatim (AD-096).
const fs = require("fs");
const { THEME_LIGHT_CSS, THEME_HEAD, THEME_BTN, THEME_JS } = require("./branding.js");
const { NEWWIN } = require("../report-templates");

function buildIndexReport(sites, cfg, allow, partial, startedAt) {
  const esc2 = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const done = sites.filter((s) => s.state && !s.partial).length;
  const totalInstances = sites.reduce((n, s) => n + (s.state ? s.state.pages.reduce((m, p) => m + (p.internal || 0) + (p.external || 0), 0) : 0), 0);
  // Broken link instances for a site: each non-allowlisted broken link counted once per
  // page that links to it (min 1) — the cleanup workload, summed across sites for the total.
  const biOf = (st) => { if (!st) return 0; let n = 0; for (const e of st.errors) { if (allow.some((re) => re.test(e.url))) continue; const s = st.refs && st.refs.get(e.url); n += (s ? s.size : 0) || 1; } return n; };
  const totalBroken = sites.reduce((n, s) => n + biOf(s.state), 0);
  const cards = sites.map((s, i) => {
    const st = s.state;
    let status, body;
    if (!st) { status = `<span class="pill skip">queued</span>`; body = `<p class="muted">Not started yet.</p>`; }
    else {
      const supp = [], act = [];
      for (const e of st.errors) (allow.some((re) => re.test(e.url)) ? supp : act).push(e);
      const ei = act.filter((e) => (e.kind || "internal") !== "external").length;
      const ee = act.filter((e) => e.kind === "external").length;
      const bl = (st.blocked || []).length;
      const li = st.pages.reduce((n, p) => n + (p.internal || 0) + (p.external || 0), 0);
      const bi = biOf(st);
      status = s.partial ? `<span class="pill warn">crawling…</span>` : `<span class="pill ok">done</span>`;
      const file = s.reportFile.split(/[\\/]/).pop();
      body = `<div class="nums"><span><b>${st.pages.length.toLocaleString()}</b> internal destinations</span><span><b>${st.external.size.toLocaleString()}</b> external destinations</span><span><b>${li.toLocaleString()}</b> hyperlink instances</span><span class="${bi ? "bad" : ""}"><b>${bi.toLocaleString()}</b> broken hyperlink instances</span><span class="${ei ? "bad" : ""}"><b>${ei}</b> broken · internal</span><span class="${ee ? "bad" : ""}"><b>${ee}</b> broken · external</span><span><b>${bl}</b> blocked</span></div>
        <p><a href="${esc2(file)}">Open ${esc2(s.host)} report →</a></p>`;
    }
    return `<div class="card"><h2>${i + 1}. ${esc2(s.host)} ${status}</h2><p class="muted">${esc2(s.url)}</p>${body}</div>`;
  }).join("");
  const refresh = partial ? `<script>(function(){var I=2500,a=(new Date()).getTime();function b(){a=(new Date()).getTime();}['mousemove','mousedown','keydown','wheel','touchstart','scroll'].forEach(function(e){document.addEventListener(e,b,true);});try{if('scrollRestoration' in history)history.scrollRestoration='manual';var y=localStorage.getItem('bfIdxY');if(y!==null)window.scrollTo(0,parseInt(y,10)||0);}catch(e){}window.addEventListener('scroll',function(){try{localStorage.setItem('bfIdxY',String(window.pageYOffset||0));}catch(e){}});function t(){var s='';try{s=window.getSelection?String(window.getSelection()):'';}catch(_){}if((new Date()).getTime()-a<I||s!==''){setTimeout(t,600);return;}location.reload();}setTimeout(t,5000);})();</script>` : "";
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${partial ? "[crawling] " : ""}Crawl report — ${sites.length} sites</title>
<style>
 :root{--bg:#0f1115;--panel:#1a1e26;--panel2:#222834;--fg:#e6e9ef;--muted:#9aa4b2;--accent:#5db0ff;--link:#8ec5ff;--good:#4ade80;--bad:#f87171;--warn:#fbbf24;--border:#2c3340;--accent-fg:#06121f}
${THEME_LIGHT_CSS}
 *{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--fg)}
 header{padding:20px 24px;border-bottom:1px solid var(--border);background:var(--panel)}header h1{margin:0 0 4px;font-size:20px}header p{margin:0;color:var(--muted);font-size:13px}
 main{max-width:1000px;margin:0 auto;padding:24px}.card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px 18px;margin-bottom:16px}
 h2{font-size:16px;margin:0 0 4px}.muted{color:var(--muted)}.bad b{color:var(--bad)}a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
 .nums{display:flex;gap:18px;flex-wrap:wrap;margin:8px 0}.nums b{color:var(--accent)}
 .pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;vertical-align:middle}
 .pill.ok{background:rgba(74,222,128,.15);color:var(--good)}.pill.warn{background:rgba(251,191,36,.15);color:var(--warn)}.pill.skip{background:rgba(154,164,178,.15);color:var(--muted)}
</style>${THEME_HEAD}</head><body>${THEME_BTN}
<header><h1>Crawl report — ${sites.length} sites</h1><p>${esc2(startedAt)} · ${done}/${sites.length} done${partial ? " · crawling… (auto-updates)" : ""} · <b>${totalInstances.toLocaleString()}</b> total hyperlink instances · <b>${totalBroken.toLocaleString()}</b> broken</p></header>
<main>${cards}</main>
${refresh}${NEWWIN}
${THEME_JS}</body></html>`;
}

function writeCombinedJson(sites, cfg, allow) {
  const errOut = (st, e) => { const s = st.refs.get(e.url); return { url: e.url, reason: e.reason, kind: e.kind || "internal", foundOn: s ? [...s] : (e.source ? [e.source] : []) }; };
  const data = {
    crawledAt: new Date().toISOString(),
    sites: sites.map((s, i) => {
      const st = s.state;
      if (!st) return { url: s.url, host: s.host, status: "queued" };
      const supp = [], act = [];
      for (const e of st.errors) (allow.some((re) => re.test(e.url)) ? supp : act).push(e);
      return {
        url: s.url, host: s.host, status: s.partial ? "crawling" : "done", reportFile: s.reportFile.split(/[\\/]/).pop(), jsonFile: s.jsonFile ? s.jsonFile.split(/[\\/]/).pop() : "",
        summary: { pagesCrawled: st.pages.length, externalLinks: st.external.size, linkInstances: st.pages.reduce((n, p) => n + (p.internal || 0) + (p.external || 0), 0), brokenLinkInstances: act.reduce((n, e) => { const r = st.refs && st.refs.get(e.url); return n + ((r ? r.size : 0) || 1); }, 0), errorsInternal: act.filter((e) => (e.kind || "internal") !== "external").length, errorsExternal: act.filter((e) => e.kind === "external").length, blocked: (st.blocked || []).length },
        errors: act.map((e) => errOut(st, e)),
        blocked: (st.blocked || []).map((e) => errOut(st, e)),
      };
    }),
  };
  fs.writeFileSync(cfg.json, JSON.stringify(data, null, 2));
}

module.exports = { buildIndexReport, writeCombinedJson };
