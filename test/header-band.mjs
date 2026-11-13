// Regression tests: the fixed top-right controls (theme toggle, outline legend) never sit over page text
// (charlotte-memory:pando-0947). They stay fixed (AD-077); once the page scrolls, the theme script marks
// html[data-cwscrolled] and an opaque band (body::before) is drawn behind them, below their z-index, so
// text passes under a solid strip. At the top of the page there is no band and the header shows as before.
import assert from "node:assert";
import { buildHtml, openReport, exportTracker, run } from "./lib/report-fixture.mjs";

const report = openReport(buildHtml());
const { src: TRACKER } = await exportTracker(report);
report.window.close();

const zOf = (src, sel) => Number(new RegExp(sel.replace(".", "\\.") + "\\{[^}]*z-index:(\\d+)").exec(src)[1]);
const BAND = /html\[data-cwscrolled\] body::before\{[^}]*position:fixed;top:0;[^}]*z-index:(\d+);background:var\(--bg\)/;

function scrollTo(dom, y) {
  Object.defineProperty(dom.window, "pageYOffset", { configurable: true, value: y });
  dom.window.dispatchEvent(new dom.window.Event("scroll"));
}

function bandFollowsScroll(src) {
  const d = openReport(src);
  assert.deepStrictEqual(d.errors.map((e) => e.message), []);
  const de = d.window.document.documentElement;
  assert.ok(!de.hasAttribute("data-cwscrolled"), "no band at the top of the page");
  scrollTo(d, 300);
  assert.ok(de.hasAttribute("data-cwscrolled"), "scrolled: the band is on");
  scrollTo(d, 0);
  assert.ok(!de.hasAttribute("data-cwscrolled"), "back at the top: the band is off");
  d.window.close();
}

await run({
  "report: the band is drawn behind the fixed controls, below them"() {
    const src = buildHtml();
    const band = BAND.exec(src);
    assert.ok(band, "the band rule is in the report");
    assert.ok(Number(band[1]) < zOf(src, ".themebtn") && Number(band[1]) < zOf(src, ".leghint"));
  },
  "report: the band appears only once the page has scrolled"() { bandFollowsScroll(buildHtml()); },
  "tracker: the band is drawn behind the theme toggle, below it"() {
    const band = BAND.exec(TRACKER);
    assert.ok(band, "the band rule is in the tracker");
    assert.ok(Number(band[1]) < zOf(TRACKER, ".themebtn"));
  },
  "tracker: the band appears only once the page has scrolled"() { bandFollowsScroll(TRACKER); },
});
