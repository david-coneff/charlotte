// Regression tests: the standalone fix tracker's two views (src/report-templates/tracker-template.js),
// driven in jsdom on a tracker exported from a report built from a fixture crawl
// (test/lib/report-fixture.mjs). SYNTHESIS §6 area "tracker By-page/By-link sync":
//
//   By page lists each referrer page with ALL its broken links (internal and external together);
//   By broken link lists each link with every page that links to it. Both render the same
//   (page -> link) pairs, so a Fixed tick, a verdict, or a note made in one view is what the other
//   view shows. A URL's verdict is one value wherever the URL appears. Group counters, the
//   "All: Fixed" box, the amber needfix ring and the stat matrix all follow.
import assert from "node:assert";
import { HOST, buildHtml, openReport, $, $$, hasCls, storeOf, tick, exportTracker, until, run } from "./lib/report-fixture.mjs";

const P = (p) => `https://${HOST}${p}`;
const HOME = P("/"), ABOUT = P("/about/");
const DOCS = P("/docs/gone"), OLD = P("/old"), MEMBERS = P("/members");
const EX = "https://ext.test/x", EY = "https://ext.test/y", OZ = "https://other.test/z", BQ = "https://blk.test/q";
const NS = `cwfix:${HOST}:`, PAIR = (ref, url) => `${NS}${ref}\n${url}`;

// One tracker document for every test: the report's export with no verdicts made.
const report = openReport(buildHtml());
const { src: TRACKER } = await exportTracker(report);
report.window.close();

const open = (store) => { const d = openReport(TRACKER, { store }); assert.deepStrictEqual(d.errors.map((e) => e.message), []); return d; };
const view = (dom, g) => $(dom, `.gtab[data-g="${g}"]`).click();
const pairRow = (dom, ref, url) => $(dom, `tr[data-ref="${ref}"][data-broken="${url}"]`);
const fixBox = (dom, ref, url) => pairRow(dom, ref, url).querySelector(".fx");
const groupOf = (el) => { let n = el; while (n && !hasCls(n, "grp")) n = n.parentNode; return n; };
const groupTitled = (dom, title) => $$(dom, ".grp").find((g) => g.querySelector(".grphead .ref").textContent === title);
const verdictBoxes = (dom, url, c) => $$(dom, `.${c}[data-broken="${url}"]`);
const stat = (dom, id) => Number($(dom, `#st-${id}`).textContent);
const stats = (dom) => ["bInst", "bInt", "bExt", "bPg", "fInst", "fInt", "fExt", "fPg"].map((id) => stat(dom, id));

const tests = {
  "By page: one section per referrer page, internal and external links together"() {
    const d = open();
    const sections = $$(d, ".grp").map((g) => [g.querySelector(".ref").textContent, [...g.querySelectorAll("tr[data-ref]")].map((tr) => tr.getAttribute("data-broken"))]);
    assert.deepStrictEqual(sections, [
      [HOME, [BQ, DOCS, OLD, EX, OZ].sort()],
      [ABOUT, [MEMBERS, DOCS, EY, OZ].sort()],
    ]);
    const types = [...groupTitled(d, HOME).querySelectorAll(".ltcol .lt")].map((b) => b.textContent);
    assert.deepStrictEqual(types.sort(), ["external", "external", "external", "internal", "internal"], "a Type badge per row");
    assert.match($(d, "#sub").textContent, /2 referrer page\(s\), 9 broken-link instance\(s\)/);
    d.window.close();
  },

  "By broken link: one section per link, listing every page that links to it"() {
    const d = open();
    view(d, "link");
    const sections = Object.fromEntries($$(d, ".grp").map((g) => [g.querySelector(".ref").textContent, [...g.querySelectorAll("tr[data-ref]")].map((tr) => tr.getAttribute("data-ref"))]));
    assert.deepStrictEqual(Object.keys(sections).sort(), [BQ, DOCS, EX, EY, OZ, OLD, MEMBERS].sort());
    assert.deepStrictEqual(sections[OZ], [HOME, ABOUT]);
    assert.deepStrictEqual(sections[DOCS], [HOME, ABOUT]);
    assert.deepStrictEqual(sections[EY], [ABOUT]);
    d.window.close();
  },

  "a Fixed tick is one flag per (page -> link) pair, shared by both views"() {
    const d = open();
    fixBox(d, HOME, OZ).click();
    assert.strictEqual(storeOf(d)[PAIR(HOME, OZ)], "1");
    assert.match(pairRow(d, HOME, OZ).querySelector(".ft").textContent, /^\d{4}-\d\d-\d\d \d\d:\d\d$/, "Fixed on is stamped");
    assert.ok(hasCls(pairRow(d, HOME, OZ), "done"));
    view(d, "link");
    assert.strictEqual(fixBox(d, HOME, OZ).checked, true, "the same pair is ticked By link");
    assert.strictEqual(fixBox(d, ABOUT, OZ).checked, false, "the same link on another page is not");
    fixBox(d, ABOUT, OZ).click();
    view(d, "page");
    assert.strictEqual(fixBox(d, ABOUT, OZ).checked, true, "and back the other way");
    fixBox(d, HOME, OZ).click();
    assert.ok(!(PAIR(HOME, OZ) in storeOf(d)), "unticking clears the flag");
    assert.strictEqual(pairRow(d, HOME, OZ).querySelector(".ft").textContent, "");
    d.window.close();
  },

  "a verdict is one value per URL: every box for it follows, in either view"() {
    const d = open();
    const [vbHome] = verdictBoxes(d, DOCS, "vb");
    assert.strictEqual(verdictBoxes(d, DOCS, "vb").length, 2, "DOCS is linked from two pages");
    vbHome.click();
    assert.deepStrictEqual(verdictBoxes(d, DOCS, "vb").map((b) => b.checked), [true, true]);
    const tsd = $$(d, `.tsd[data-broken="${DOCS}"]`).map((t) => t.textContent);
    assert.ok(tsd[0] && tsd[0] === tsd[1], "Last triaged is stamped on both rows");
    verdictBoxes(d, DOCS, "vo")[1].click();
    assert.deepStrictEqual(verdictBoxes(d, DOCS, "vb").map((b) => b.checked), [false, false], "Working clears Broken everywhere");
    assert.deepStrictEqual(verdictBoxes(d, DOCS, "vo").map((b) => b.checked), [true, true]);
    assert.strictEqual(storeOf(d)[`${NS}vd:${DOCS}`], "working");
    view(d, "link");
    assert.deepStrictEqual(verdictBoxes(d, DOCS, "vo").map((b) => b.checked), [true], "By link shows it in the section header");
    verdictBoxes(d, DOCS, "vo")[0].click();
    view(d, "page");
    assert.deepStrictEqual(verdictBoxes(d, DOCS, "vo").map((b) => b.checked), [false, false], "and an untick there clears it here");
    assert.deepStrictEqual($$(d, `.tsd[data-broken="${DOCS}"]`).map((t) => t.textContent), ["", ""]);
    d.window.close();
  },

  "a verdict made in the report rides into the tracker until the tracker changes it"() {
    const r = openReport(buildHtml());
    tick(r, EY, "working"); tick(r, BQ, "broken");
    return exportTracker(r).then(({ src }) => {
      r.window.close();
      // EY is Working, so the export left it out; BQ arrives Broken.
      const d = openReport(src);
      assert.strictEqual(verdictBoxes(d, EY, "vo").length, 0);
      assert.deepStrictEqual(verdictBoxes(d, BQ, "vb").map((b) => b.checked), [true]);
      // Changing it to Working survives a reload.
      verdictBoxes(d, BQ, "vo")[0].click();
      const again = openReport(src, { store: storeOf(d) });
      assert.deepStrictEqual([verdictBoxes(again, BQ, "vb")[0].checked, verdictBoxes(again, BQ, "vo")[0].checked], [false, true], "the tracker's own change wins over the baked one");
      d.window.close(); again.window.close();
    });
  },

  async "clearing a baked verdict survives a reload and a state export/import"() {
    // charlotte-memory:pando-0011: un-ticking a verdict that came in with the report used to
    // remove its key, so the next open fell back to the baked verdict and re-ticked it.
    const r = openReport(buildHtml());
    tick(r, BQ, "broken");
    const { src } = await exportTracker(r);
    r.window.close();
    const d = openReport(src);
    const boxes = (dom) => [verdictBoxes(dom, BQ, "vb")[0].checked, verdictBoxes(dom, BQ, "vo")[0].checked];
    assert.deepStrictEqual(boxes(d), [true, false], "BQ arrives Broken");
    verdictBoxes(d, BQ, "vb")[0].click();
    assert.deepStrictEqual(boxes(d), [false, false], "the fixer cleared it");
    const reloaded = openReport(src, { store: storeOf(d) });
    assert.deepStrictEqual(boxes(reloaded), [false, false], "the cleared verdict survives a reload");
    reloaded.window.close();
    // Export this tracker's state and import it into a fresh browser: still cleared.
    $(d, "#cwExp").click();
    const text = await d.downloads[d.downloads.length - 1].blob.text();
    assert.strictEqual(JSON.parse(text).v[`${NS}vd:${BQ}`], "", "the export carries the cleared verdict");
    const fresh = openReport(src);
    const w = fresh.window, input = $(fresh, "#cwImpF");
    Object.defineProperty(input, "files", { configurable: true, value: [new w.File([text], "s.json", { type: "application/json" })] });
    input.dispatchEvent(new w.Event("change"));
    await until(() => fresh.window.localStorage.getItem(`${NS}vd:${BQ}`) !== null);
    const after = openReport(src, { store: storeOf(fresh) });
    assert.deepStrictEqual(boxes(after), [false, false], "the cleared verdict survives export/import");
    d.window.close(); fresh.window.close(); after.window.close();
  },

  "a section's counter, All: Fixed box and needfix ring follow its rows"() {
    const d = open();
    const g = groupTitled(d, ABOUT);
    assert.strictEqual(g.querySelector(".grpfix").textContent, "0/4 fixed");
    assert.ok(hasCls(g, "needfix"));
    fixBox(d, ABOUT, DOCS).click();
    assert.strictEqual(g.querySelector(".grpfix").textContent, "1/4 fixed");
    assert.strictEqual(g.querySelector(".grpfixall").indeterminate, true);
    // A Working verdict resolves a row without a fix.
    verdictBoxes(d, MEMBERS, "vo")[0].click(); verdictBoxes(d, EY, "vo")[0].click();
    assert.ok(hasCls(g, "needfix"), "OZ is still unresolved");
    fixBox(d, ABOUT, OZ).click();
    assert.ok(!hasCls(g, "needfix"), "every row Fixed or Working clears the ring");
    assert.strictEqual(g.querySelector(".grpfixall").checked, false, "All: Fixed counts Fixed boxes only");
    d.window.close();
  },

  "All: Fixed ticks every pair in its section, and only there"() {
    const d = open();
    view(d, "link");
    const g = groupTitled(d, OZ);
    g.querySelector(".grpfixall").click();
    assert.deepStrictEqual([fixBox(d, HOME, OZ).checked, fixBox(d, ABOUT, OZ).checked], [true, true]);
    assert.strictEqual(g.querySelector(".grpfix").textContent, "2/2 fixed");
    assert.deepStrictEqual(Object.keys(storeOf(d)).filter((k) => k.startsWith(NS) && !k.startsWith(`${NS}ft:`)).sort(), [PAIR(ABOUT, OZ), PAIR(HOME, OZ)].sort());
    view(d, "page");
    assert.deepStrictEqual([fixBox(d, HOME, OZ).checked, fixBox(d, ABOUT, OZ).checked, fixBox(d, HOME, EX).checked], [true, true, false]);
    d.window.close();
  },

  "the stat matrix: Broken follows verdicts, Fixed follows fixes, both live"() {
    const d = open();
    assert.deepStrictEqual(stats(d), [9, 3, 4, 2, 0, 0, 0, 0]);
    verdictBoxes(d, OZ, "vo")[0].click();   // 2 instances, external
    assert.deepStrictEqual(stats(d), [7, 3, 3, 2, 0, 0, 0, 0]);
    fixBox(d, HOME, DOCS).click();
    assert.deepStrictEqual(stats(d), [7, 3, 3, 2, 1, 0, 0, 0], "one of DOCS's two pairs: an instance, not yet a destination");
    fixBox(d, ABOUT, DOCS).click();
    assert.deepStrictEqual(stats(d), [7, 3, 3, 2, 2, 1, 0, 0]);
    for (const u of [MEMBERS, EY]) fixBox(d, ABOUT, u).click();
    assert.strictEqual(stat(d, "fPg"), 1, "/about/ is remediated: all its non-Working links are Fixed");
    assert.strictEqual($(d, "#st-fPgP").textContent, "(50.0%)");
    assert.strictEqual($(d, "#prog").textContent, "Fixed: 4/9 link references");
    d.window.close();
  },

  "a note is per referrer page and persists"() {
    const d = open();
    const n = $(d, `.pnote[data-ref="${ABOUT}"]`);
    n.value = "ask the web team";
    n.dispatchEvent(new d.window.Event("input"));
    assert.strictEqual(storeOf(d)[`${NS}n:${ABOUT}`], "ask the web team");
    const again = open(storeOf(d));
    assert.strictEqual($(again, `.pnote[data-ref="${ABOUT}"]`).value, "ask the web team");
    assert.strictEqual($(again, `.pnote[data-ref="${HOME}"]`).value, "");
    d.window.close(); again.window.close();
  },

  "Clear ticks clears every Fixed flag and time, and keeps verdicts and notes"() {
    const d = open({ [PAIR(HOME, EX)]: "1", [`${NS}ft:${HOME}\n${EX}`]: "2026-10-30 10:00", [`${NS}vd:${EX}`]: "broken", [`${NS}n:${HOME}`]: "owner: Pat" });
    assert.strictEqual(fixBox(d, HOME, EX).checked, true, "restored on open");
    d.window.confirm = () => true;
    $(d, "#reset").click();
    assert.strictEqual(fixBox(d, HOME, EX).checked, false);
    assert.deepStrictEqual(Object.keys(storeOf(d)).filter((k) => k.startsWith(NS)).sort(), [`${NS}n:${HOME}`, `${NS}vd:${EX}`].sort());
    d.window.close();
  },

  "Clear ticks does nothing when the confirm is declined"() {
    const d = open({ [PAIR(HOME, EX)]: "1" });
    d.window.confirm = () => false;
    $(d, "#reset").click();
    assert.strictEqual(fixBox(d, HOME, EX).checked, true);
    assert.strictEqual(storeOf(d)[PAIR(HOME, EX)], "1");
    d.window.close();
  },
};

run(tests);
