// Regression tests: sharing triage verdicts (src/report/triage-script.js), driven in jsdom on a
// report built from a fixture crawl (test/lib/report-fixture.mjs). SYNTHESIS §6 area "verdict
// export/import/seed":
//
//   export   — "Export verdicts" saves this host's cwbroken:/cwok:/cwts: keys as a
//              charlotte-verdicts JSON, and nothing else from localStorage.
//   import   — only a charlotte-verdicts file for THIS host is applied; it replaces each url it
//              mentions and leaves the others, so several people's exports merge.
//   seed     — "Save shareable copy" bakes the verdicts into the page as window.__CW_SEED__; opening
//              the copy primes an empty browser, never overwrites a recipient's own verdicts, shows
//              them read-only where storage is blocked, and a copy of a copy carries one seed.
import assert from "node:assert";
import { HOST, buildHtml, openReport, $, row, storeOf, tick, until, run } from "./lib/report-fixture.mjs";

const EX = "https://ext.test/x", EY = "https://ext.test/y", OZ = "https://other.test/z", BQ = "https://blk.test/q";
const KB = (u) => `cwbroken:${HOST}:${u}`, KO = (u) => `cwok:${HOST}:${u}`, KT = (u) => `cwts:${HOST}:${u}`;
const STAMP = /_\d{4}-\d\d-\d\d_\d\d-\d\d_\d\d/;

const html = buildHtml();
const open = (src, opts) => { const d = openReport(src, opts); assert.deepStrictEqual(d.errors.map((e) => e.message), []); return d; };
const toast = (dom) => ($(dom, "#cw-toast") || { textContent: "" }).textContent;
const verdicts = (dom) => Object.fromEntries(Object.entries(storeOf(dom)).filter(([k]) => /^cw(broken|ok|ts):/.test(k)));
const boxes = (dom, url) => { const r = row(dom, url); return [r.querySelector(".brokenbox").checked, r.querySelector(".okbox").checked]; };
const SEED_RE = /<script>window\.__CW_SEED__=/g;

// Pick a file into the hidden import input, as the "Import verdicts" button's picker would.
function importFile(dom, text) {
  const w = dom.window, input = $(dom, "#cwImportFile");
  Object.defineProperty(input, "files", { configurable: true, value: [new w.File([text], "verdicts.json", { type: "application/json" })] });
  input.dispatchEvent(new w.Event("change"));
}

async function exportOf(dom) {
  $(dom, "#cwExportV").click();
  assert.strictEqual(dom.downloads.length, 1, "one file saved");
  const { name, blob } = dom.downloads[0];
  return { name, json: JSON.parse(await blob.text()) };
}

async function sharedCopyOf(dom) {
  $(dom, "#cwSaveCopy").click();
  const { name, blob } = dom.downloads[dom.downloads.length - 1];
  return { name, src: await blob.text() };
}

const tests = {
  // ---- export ---------------------------------------------------------------------------------
  "exporting with no verdicts saves nothing and says so"() {
    const d = open(html);
    $(d, "#cwExportV").click();
    assert.strictEqual(d.downloads.length, 0);
    assert.match(toast(d), /No verdicts to export yet/);
    d.window.close();
  },

  async "export writes this host's verdict keys, and only those"() {
    const d = open(html, { store: { [`cwok:b.test:${EX}`]: "1", [`cwcol:${HOST}:errext`]: "[80]", charlotteTab: "errext" } });
    tick(d, EX, "broken"); tick(d, EY, "working");
    const { name, json } = await exportOf(d);
    assert.match(name, new RegExp(`^charlotte-verdicts-${HOST}${STAMP.source}\\.json$`), "a versioned file name");
    assert.strictEqual(json.app, "charlotte-verdicts");
    assert.strictEqual(json.host, HOST);
    assert.deepStrictEqual(Object.keys(json.v).sort(), [KB(EX), KO(EY), KT(EX), KT(EY)].sort());
    assert.strictEqual(toast(d), "Exported 2 verdicts", "counted per link, not per key");
    d.window.close();
  },

  // ---- import ---------------------------------------------------------------------------------
  async "an import replaces each url it mentions and leaves the rest (merge)"() {
    const d = open(html, { store: { [KB(EX)]: "1", [KT(EX)]: "2026-10-01 10:00", [KB(EY)]: "1", [KT(EY)]: "2026-10-01 10:01" } });
    importFile(d, JSON.stringify({ app: "charlotte-verdicts", host: HOST, v: { [KO(EX)]: "1", [KT(EX)]: "2026-10-30 12:00", [KB(OZ)]: "1" } }));
    await until(() => /^Imported/.test(toast(d)));
    assert.strictEqual(toast(d), "Imported 2 verdicts — reloading…");
    assert.deepStrictEqual(verdicts(d), {
      [KO(EX)]: "1", [KT(EX)]: "2026-10-30 12:00",          // replaced: its Broken key is gone
      [KB(EY)]: "1", [KT(EY)]: "2026-10-01 10:01",          // not in the file: untouched
      [KB(OZ)]: "1",                                         // new
    });
    // The page reloads to show them; a fresh open over the same storage does that here.
    const again = open(html, { store: storeOf(d) });
    assert.deepStrictEqual([boxes(again, EX), boxes(again, EY), boxes(again, OZ)], [[false, true], [true, false], [true, false]]);
    d.window.close(); again.window.close();
  },

  async "an import for another host is refused, and nothing is applied"() {
    const d = open(html);
    importFile(d, JSON.stringify({ app: "charlotte-verdicts", host: "b.test", v: { [`cwok:b.test:${EX}`]: "1" } }));
    await until(() => toast(d) !== "");
    assert.strictEqual(toast(d), `That file is for “b.test”, not “${HOST}” — not applied`);
    assert.deepStrictEqual(verdicts(d), {});
    d.window.close();
  },

  async "a file that is not a verdicts export is refused"() {
    for (const text of ["not json", JSON.stringify({ app: "something-else", host: HOST, v: { [KB(EX)]: "1" } }), JSON.stringify({ app: "charlotte-verdicts", host: HOST })]) {
      const d = open(html);
      importFile(d, text);
      await until(() => toast(d) !== "");
      assert.strictEqual(toast(d), "That isn't a Charlotte verdicts file", text);
      assert.deepStrictEqual(verdicts(d), {});
      d.window.close();
    }
  },

  "with storage blocked, import says why instead of failing silently"() {
    const d = open(html, { noStorage: true });
    importFile(d, JSON.stringify({ app: "charlotte-verdicts", host: HOST, v: { [KB(EX)]: "1" } }));
    assert.match(toast(d), /blocks storage for local files/);
    d.window.close();
  },

  // ---- shareable copy (seed) ------------------------------------------------------------------
  async "a shareable copy carries the verdicts and primes an empty browser"() {
    const d = open(html);
    tick(d, EX, "broken"); tick(d, BQ, "broken"); tick(d, EY, "working");
    const { name, src } = await sharedCopyOf(d);
    assert.match(name, new RegExp(`^charlotte-report-${HOST}-shared${STAMP.source}\\.html$`));
    assert.strictEqual(toast(d), "Saved a shareable copy with 3 verdicts baked in");
    assert.strictEqual((src.match(SEED_RE) || []).length, 1);
    assert.ok(src.indexOf("window.__CW_SEED__") < src.indexOf("</head>"), "the seed runs before the page's scripts");
    const r = open(src);
    assert.deepStrictEqual(verdicts(r), verdicts(d), "the recipient's storage is primed from the seed");
    assert.deepStrictEqual([boxes(r, EX), boxes(r, BQ), boxes(r, EY)], [[true, false], [true, false], [false, true]]);
    d.window.close(); r.window.close();
  },

  async "a shareable copy never overwrites the recipient's own verdicts"() {
    const d = open(html);
    tick(d, EX, "broken");
    const { src } = await sharedCopyOf(d);
    const r = open(src, { store: { [KO(EY)]: "1" } });
    assert.deepStrictEqual(verdicts(r), { [KO(EY)]: "1" }, "the seed is skipped entirely");
    assert.deepStrictEqual(boxes(r, EX), [false, false]);
    d.window.close(); r.window.close();
  },

  async "where storage is blocked, a shareable copy shows the sender's verdicts read-only"() {
    const d = open(html);
    tick(d, EX, "broken"); tick(d, EY, "working");
    const { src } = await sharedCopyOf(d);
    const r = open(src, { noStorage: true });
    assert.deepStrictEqual([boxes(r, EX), boxes(r, EY), boxes(r, OZ)], [[true, false], [false, true], [false, false]]);
    assert.strictEqual(row(r, EX).querySelector(".tscell").textContent, verdicts(d)[KT(EX)]);
    d.window.close(); r.window.close();
  },

  async "a copy of a copy carries one seed, holding the latest verdicts"() {
    const d = open(html);
    tick(d, EX, "broken");
    const first = open((await sharedCopyOf(d)).src);
    tick(first, OZ, "working");
    const { src } = await sharedCopyOf(first);
    assert.strictEqual((src.match(SEED_RE) || []).length, 1, "the prior seed is stripped");
    const r = open(src);
    assert.deepStrictEqual([boxes(r, EX), boxes(r, OZ)], [[true, false], [false, true]]);
    d.window.close(); first.window.close(); r.window.close();
  },

  async "a seed for another host is ignored"() {
    const d = open(html);
    tick(d, EX, "broken");
    const { src } = await sharedCopyOf(d);
    const other = src.replace(/window\.__CW_SEED__=\{"app":"charlotte-verdicts","host":"a\.test"/, 'window.__CW_SEED__={"app":"charlotte-verdicts","host":"b.test"');
    assert.notStrictEqual(other, src, "the fixture's seed was rewritten");
    const r = open(other);
    assert.deepStrictEqual(verdicts(r), {});
    d.window.close(); r.window.close();
  },
};

run(tests);
