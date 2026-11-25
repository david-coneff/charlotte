// Regression tests: which links the report's "Export fix tracker" puts in the tracker
// (src/report/page-scripts.js exportTracker), driven in jsdom on a report built from a fixture
// crawl (test/lib/report-fixture.mjs). SYNTHESIS §6 area "export inclusion rules":
//
//   One rule across Errors (assumed broken) and Blocked (uncertain): a link is in the tracker
//   unless it is marked Working. Blocked links are routed into the internal/external lists by their
//   kind. Each link carries its report verdict (v) and last-triaged time (ts) into the tracker, and
//   the tracker starts with no Fixed ticks.
import assert from "node:assert";
import { HOST, fixtureState, buildHtml, openReport, $, tick, exportTracker, run } from "./lib/report-fixture.mjs";

const P = (p) => `https://${HOST}${p}`;
const DOCS = P("/docs/gone"), OLD = P("/old"), MEMBERS = P("/members");
const EX = "https://ext.test/x", EY = "https://ext.test/y", OZ = "https://other.test/z", BQ = "https://blk.test/q";
const KT = (u) => `cwts:${HOST}:${u}`;

const html = buildHtml();
const open = (opts) => { const d = openReport(html, opts); assert.deepStrictEqual(d.errors.map((e) => e.message), []); return d; };
const urls = (list) => list.map((e) => e.url);
const toast = (dom) => ($(dom, "#cw-toast") || { textContent: "" }).textContent;

const tests = {
  async "untriaged: every broken AND blocked link is in, blocked routed by kind"() {
    const d = open();
    const { name, data } = await exportTracker(d);
    assert.match(name, /^charlotte-fix-tracker_\d{4}-\d\d-\d\d_\d\d-\d\d_\d\d\.html$/);
    assert.strictEqual(data.host, HOST);
    assert.deepStrictEqual(urls(data.internal), [DOCS, OLD, MEMBERS], "the blocked internal link joins the internal list");
    assert.deepStrictEqual(urls(data.external), [EX, EY, OZ, BQ], "the blocked external link joins the external list");
    assert.ok(!("blockedInt" in data) && !("blockedExt" in data), "the blocked lists are merged away");
    assert.deepStrictEqual(data.ticked, {}, "fix-tracking starts empty");
    assert.deepStrictEqual(data.internal.find((e) => e.url === DOCS).refs, [P("/"), P("/about/")], "referrers ride along");
    assert.strictEqual(toast(d), "Exported fix tracker");
    d.window.close();
  },

  async "a link marked Working is left out, on Errors and Blocked alike"() {
    const d = open();
    tick(d, OLD, "working"); tick(d, OZ, "working"); tick(d, MEMBERS, "working");
    const { data } = await exportTracker(d);
    assert.deepStrictEqual(urls(data.internal), [DOCS]);
    assert.deepStrictEqual(urls(data.external), [EX, EY, BQ]);
    assert.strictEqual(toast(d), "Exported fix tracker (3 links marked Working excluded)");
    d.window.close();
  },

  async "a link marked Broken stays in, and carries its verdict and time"() {
    const d = open();
    tick(d, BQ, "broken"); tick(d, EX, "broken");
    const { data } = await exportTracker(d);
    const by = Object.fromEntries([...data.internal, ...data.external].map((e) => [e.url, e]));
    assert.strictEqual(by[BQ].v, "broken");
    assert.strictEqual(by[EX].v, "broken");
    assert.strictEqual(by[EX].ts, d.window.localStorage.getItem(KT(EX)));
    assert.deepStrictEqual([by[EY].v, by[EY].ts], ["", ""], "untriaged: no verdict, no time");
    d.window.close();
  },

  async "the rule reads the boxes as restored from storage, not only fresh ticks"() {
    const d = open({ store: { [`cwok:${HOST}:${EY}`]: "1", [KT(EY)]: "2026-10-30 08:00" } });
    const { data } = await exportTracker(d);
    assert.deepStrictEqual(urls(data.external), [EX, OZ, BQ]);
    d.window.close();
  },

  async "the data island cannot close its own script"() {
    const st = fixtureState();
    const evil = "https://ext.test/</script><script>window.__PWNED__=1</script>";
    st.errors.push({ url: evil, reason: "HTTP 404", kind: "external", source: P("/") });
    st.external.set(evil, { url: evil, host: "ext.test", status: "err" });
    st.refs.set(evil, new Set([P("/")]));
    const d = openReport(buildHtml(st));
    const { src, data } = await exportTracker(d);
    assert.ok(urls(data.external).includes(evil), "the url survives intact");
    const t = openReport(src);
    assert.strictEqual(t.window.__PWNED__, undefined, "the url never runs as markup");
    d.window.close(); t.window.close();
  },
};

run(tests);
