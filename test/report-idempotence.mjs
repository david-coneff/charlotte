// Regression tests: the report's script-injected UI must survive a save-and-reopen cycle.
//
// "Save shareable copy" (src/report/triage-script.js) and the browser's own Save Page As both
// serialize document.documentElement.outerHTML -- the LIVE DOM, including anything the report's
// own scripts injected into it. Those scripts serialize with it (they sit inside <body>), so they
// re-run on open, over a DOM that already contains their previous output. Event listeners do NOT
// survive serialization, so a re-injected component leaves an inert copy of itself behind: the
// symptom is two pagination bars, the top one dead, the working one below it, compounding by one
// per save/reopen cycle.
//
// Plain node:assert + a minimal runner rather than node:test, so this still runs on the Node 14
// floor package.json declares. jsdom is a devDependency.
import assert from "node:assert";
import { createRequire } from "node:module";
import { JSDOM } from "jsdom";

const require = createRequire(import.meta.url);
const { pagerScriptFor } = require("../src/report/page-scripts.js");
const { triageScript } = require("../src/report/triage-script.js");

const load = (html) => new JSDOM(html, { runScripts: "dangerously", url: "https://x.test/" });
const reopen = (dom) => load("<!doctype html>\n" + dom.window.document.documentElement.outerHTML);
const count = (dom, sel) => dom.window.document.querySelectorAll(sel).length;

const tableRows = (n) =>
  Array.from({ length: n }, (_, i) => `<tr><td>row ${i}</td></tr>`).join("");
const wrap = (rows) =>
  `<div class="tablewrap"><table><thead><tr><th>URL</th></tr></thead><tbody>${rows}</tbody></table></div>`;

// Clicking a bar's own "Next" must move that bar's own label -- an inert bar reports unchanged.
const clickNext = (bar) => {
  const label = () => bar.querySelector(".pglabel")?.textContent ?? "";
  const before = label();
  [...bar.querySelectorAll("button")].find((b) => /Next/.test(b.textContent))?.click();
  return before !== label();
};

const tests = {
  "the pager bar does not duplicate across save/reopen cycles"() {
    const page = `<!doctype html><html><head><meta charset="utf-8"></head><body>
${wrap(tableRows(25))}
${pagerScriptFor({ paginate: true, pageSize: 10 })}</body></html>`;

    const first = load(page);
    assert.strictEqual(count(first, ".pager"), 1, "the report as written should have one bar");

    const shared = reopen(first);
    assert.strictEqual(count(shared, ".pager"), 1, "a saved copy must not stack a second bar");

    assert.strictEqual(count(reopen(shared), ".pager"), 1, "must not compound across generations");
  },

  "the surviving bar is the live one, not the inert baked-in one"() {
    const page = `<!doctype html><html><head><meta charset="utf-8"></head><body>
${wrap(tableRows(25))}
${pagerScriptFor({ paginate: true, pageSize: 10 })}</body></html>`;

    const shared = reopen(load(page));
    const bars = [...shared.window.document.querySelectorAll(".pager")];
    assert.strictEqual(bars.length, 1);
    assert.ok(clickNext(bars[0]), "the remaining bar must respond to Next (a dead bar does not)");
  },

  // The stale-bar sweep walks previousElementSibling, so it must stop at a neighbouring
  // tablewrap rather than eating that table's bar. Two tables under one parent is the case
  // that distinguishes a scoped sweep from a parent-wide one.
  "a sibling table's pager is left alone"() {
    const page = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="panel">${wrap(tableRows(25))}${wrap(tableRows(25))}</div>
${pagerScriptFor({ paginate: true, pageSize: 10 })}</body></html>`;

    const first = load(page);
    assert.strictEqual(count(first, ".pager"), 2, "two paginated tables should get two bars");

    const shared = reopen(first);
    assert.strictEqual(count(shared, ".pager"), 2, "still two after a save/reopen -- not 1, not 4");

    for (const [i, bar] of [...shared.window.document.querySelectorAll(".pager")].entries()) {
      assert.ok(clickNext(bar), `bar ${i + 1} of 2 must still be live after reopen`);
    }
  },

  "column grips do not accumulate across save/reopen cycles"() {
    const state = { startHost: "example.com", pages: ["/a"], external: new Set(["x"]) };
    const page = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div class="panel" id="panel-errint"><div class="tablewrap"><table class="haspick">
<thead><tr><th>Broken URL</th><th>Reason</th><th>Found on</th></tr></thead>
<tbody><tr data-url="http://x/1"><td>1</td><td>404</td><td>/a</td></tr></tbody></table></div></div>
${triageScript(state, 1)}</body></html>`;

    const first = load(page);
    assert.strictEqual(count(first, ".colgrip"), 3, "one grip per th");

    const shared = reopen(first);
    assert.strictEqual(count(shared, ".colgrip"), 3, "a saved copy must not double the grips");

    assert.strictEqual(count(reopen(shared), ".colgrip"), 3, "must not compound");
  },
};

let failed = 0;
for (const [name, fn] of Object.entries(tests)) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${e.message}`);
  }
}
console.log(`\n${Object.keys(tests).length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
