// Regression tests: sharing the fix tracker's state (src/report-templates/tracker-template.js),
// driven in jsdom on a tracker exported from a report built from a fixture crawl
// (test/lib/report-fixture.mjs). SYNTHESIS §6 area "tracker export/save-copy/multi-file import",
// plus the per-page and per-subfolder mini-tracker exports that delegate the work:
//
//   export      — "Export" saves this site's cwfix: keys as a charlotte-fix-tracker JSON.
//   save copy   — bakes them in as window.__CW_TRK_SEED__: primes an empty browser, never
//                 overwrites existing state, read-only where storage is blocked, one seed per copy.
//   import      — one or many files in one go: each valid file for this site is merged, others are
//                 skipped and counted, and no key outside cwfix:<host>: is ever written.
//   mini-trackers — one file per referrer page (or per first-level folder), scoped to its links
//                 and seeded with just their state, so an owner's export merges straight back.
import assert from "node:assert";
import { HOST, fixtureState, buildHtml, openReport, $, $$, storeOf, until, exportTracker, trackerData, run } from "./lib/report-fixture.mjs";

const P = (p) => `https://${HOST}${p}`;
const HOME = P("/"), ABOUT = P("/about/");
const DOCS = P("/docs/gone"), OLD = P("/old"), MEMBERS = P("/members");
const EX = "https://ext.test/x", EY = "https://ext.test/y", OZ = "https://other.test/z", BQ = "https://blk.test/q";
const NS = `cwfix:${HOST}:`, PAIR = (ref, url) => `${NS}${ref}\n${url}`;
const STATE = (v, host = HOST) => JSON.stringify({ app: "charlotte-fix-tracker", host, v });
const SEED_RE = /<script>window\.__CW_TRK_SEED__=/g;

const report = openReport(buildHtml());
const { src: TRACKER } = await exportTracker(report);
report.window.close();

const open = (src, opts) => { const d = openReport(src, opts); assert.deepStrictEqual(d.errors.map((e) => e.message), []); return d; };
const toast = (dom) => ($(dom, "#cw-toast") || { textContent: "" }).textContent;
const fixBox = (dom, ref, url) => $(dom, `tr[data-ref="${ref}"][data-broken="${url}"] .fx`);
const mine = (dom) => Object.fromEntries(Object.entries(storeOf(dom)).filter(([k]) => k.startsWith("cwfix:")));
const saved = async (dom, i = dom.downloads.length - 1) => ({ name: dom.downloads[i].name, text: await dom.downloads[i].blob.text() });

function importFiles(dom, texts) {
  const w = dom.window, input = $(dom, "#cwImpF");
  const files = texts.map((t, i) => new w.File([t], `state-${i}.json`, { type: "application/json" }));
  Object.defineProperty(input, "files", { configurable: true, value: files });
  input.dispatchEvent(new w.Event("change"));
}

const tests = {
  // ---- export ---------------------------------------------------------------------------------
  "exporting with no state saves nothing and says so"() {
    const d = open(TRACKER);
    $(d, "#cwExp").click();
    assert.strictEqual(d.downloads.length, 0);
    assert.match(toast(d), /Nothing to export yet/);
    d.window.close();
  },

  async "export writes this site's tracker keys, and only those"() {
    const d = open(TRACKER, { store: { [`cwfix:b.test:${HOME}\n${EX}`]: "1", [`cwbroken:${HOST}:${EX}`]: "1", [`cwfixcol:${HOST}:page`]: "[90]" } });
    fixBox(d, HOME, EX).click();
    $(d, "#cwExp").click();
    const { name, text } = await saved(d);
    const st = JSON.parse(text);
    assert.match(name, new RegExp(`^charlotte-fix-tracker-${HOST}_\\d{4}-\\d\\d-\\d\\d_\\d\\d-\\d\\d_\\d\\d\\.json$`));
    assert.deepStrictEqual([st.app, st.host], ["charlotte-fix-tracker", HOST]);
    assert.deepStrictEqual(Object.keys(st.v).sort(), [PAIR(HOME, EX), `${NS}ft:${HOME}\n${EX}`].sort());
    d.window.close();
  },

  // ---- multi-file import ----------------------------------------------------------------------
  // Which of two files wins a key they share depends on which FileReader finishes last, so the
  // files here touch distinct keys (merge-fix-state.js is the deterministic merger).
  async "several files merge in one import, over the state already here"() {
    const d = open(TRACKER, { store: { [PAIR(HOME, OLD)]: "1" } });
    importFiles(d, [
      STATE({ [PAIR(HOME, EX)]: "1", [`${NS}n:${HOME}`]: "Pat" }),
      STATE({ [PAIR(ABOUT, EY)]: "1", [`${NS}n:${ABOUT}`]: "Sam" }),
    ]);
    await until(() => /^Imported/.test(toast(d)));
    assert.strictEqual(toast(d), "Imported 4 entries from 2 files — reloading…");
    assert.deepStrictEqual(mine(d), { [PAIR(HOME, OLD)]: "1", [PAIR(HOME, EX)]: "1", [PAIR(ABOUT, EY)]: "1", [`${NS}n:${HOME}`]: "Pat", [`${NS}n:${ABOUT}`]: "Sam" });
    const again = open(TRACKER, { store: storeOf(d) });
    assert.deepStrictEqual([fixBox(again, HOME, OLD).checked, fixBox(again, HOME, EX).checked, fixBox(again, ABOUT, EY).checked], [true, true, true]);
    d.window.close(); again.window.close();
  },

  async "another site's file and a non-tracker file are skipped and counted"() {
    const d = open(TRACKER);
    importFiles(d, [STATE({ [PAIR(HOME, EX)]: "1" }), STATE({ [`cwfix:b.test:${HOME}\n${EX}`]: "1" }, "b.test"), "not json", JSON.stringify({ app: "charlotte-verdicts", host: HOST, v: {} })]);
    await until(() => /^Imported/.test(toast(d)));
    assert.strictEqual(toast(d), "Imported 1 entry from 1 file (1 for a different site, skipped) (2 not a tracker file, skipped) — reloading…");
    assert.deepStrictEqual(mine(d), { [PAIR(HOME, EX)]: "1" });
    d.window.close();
  },

  async "when no file applies, nothing is written and the toast says why"() {
    const d = open(TRACKER);
    importFiles(d, [STATE({ [PAIR(HOME, EX)]: "1" }, "b.test")]);
    await until(() => toast(d) !== "");
    assert.strictEqual(toast(d), "No files applied — 1 for a different site");
    const e = open(TRACKER);
    importFiles(e, ["{}"]);
    await until(() => toast(e) !== "");
    assert.strictEqual(toast(e), "No valid fix-tracker state files");
    assert.deepStrictEqual([mine(d), mine(e)], [{}, {}]);
    d.window.close(); e.window.close();
  },

  async "an import never writes a key outside this site's namespace"() {
    const d = open(TRACKER);
    importFiles(d, [STATE({ [PAIR(HOME, EX)]: "1", [`cwbroken:${HOST}:${EX}`]: "1", charlotteTheme: "light", [`cwfix:b.test:x`]: "1" })]);
    await until(() => /^Imported/.test(toast(d)));
    assert.strictEqual(toast(d), "Imported 1 entry from 1 file — reloading…");
    assert.deepStrictEqual(storeOf(d), { [PAIR(HOME, EX)]: "1" });
    d.window.close();
  },

  // ---- save copy (seed) -----------------------------------------------------------------------
  async "a saved copy primes an empty browser and never overwrites existing state"() {
    const d = open(TRACKER);
    fixBox(d, HOME, EX).click();
    $(d, "#cwCopy").click();
    const { name, text } = await saved(d);
    assert.match(name, new RegExp(`^charlotte-fix-tracker-${HOST}-shared_`));
    assert.strictEqual((text.match(SEED_RE) || []).length, 1);
    assert.ok(text.indexOf("__CW_TRK_SEED__") < text.indexOf("</head>"));
    const fresh = open(text);
    assert.deepStrictEqual(mine(fresh), mine(d));
    assert.strictEqual(fixBox(fresh, HOME, EX).checked, true);
    const busy = open(text, { store: { [PAIR(ABOUT, EY)]: "1" } });
    assert.deepStrictEqual(mine(busy), { [PAIR(ABOUT, EY)]: "1" }, "existing state is kept whole");
    assert.strictEqual(fixBox(busy, HOME, EX).checked, false);
    d.window.close(); fresh.window.close(); busy.window.close();
  },

  async "a saved copy shows its state read-only where storage is blocked, and re-saves one seed"() {
    const d = open(TRACKER);
    fixBox(d, ABOUT, OZ).click();
    $(d, "#cwCopy").click();
    const first = (await saved(d)).text;
    const ro = open(first, { noStorage: true });
    assert.strictEqual(fixBox(ro, ABOUT, OZ).checked, true);
    const copy2 = open(first);
    fixBox(copy2, HOME, BQ).click();
    $(copy2, "#cwCopy").click();
    const second = (await saved(copy2)).text;
    assert.strictEqual((second.match(SEED_RE) || []).length, 1, "the prior seed is stripped");
    const r = open(second);
    assert.deepStrictEqual([fixBox(r, ABOUT, OZ).checked, fixBox(r, HOME, BQ).checked], [true, true]);
    d.window.close(); ro.window.close(); copy2.window.close(); r.window.close();
  },

  // ---- per-page / per-subfolder mini-trackers --------------------------------------------------
  async "per-page export: one file per referrer page, scoped to its links and its state"() {
    const d = open(TRACKER);
    fixBox(d, HOME, EX).click(); fixBox(d, ABOUT, EY).click();
    const n = $(d, `.pnote[data-ref="${ABOUT}"]`); n.value = "web team"; n.dispatchEvent(new d.window.Event("input"));
    $(d, "#cwPages").click();
    await until(() => d.downloads.length === 2);
    assert.match(toast(d), /downloading 2 files individually/);
    const files = Object.fromEntries(await Promise.all(d.downloads.map(async (f) => [f.name, await f.blob.text()])));
    assert.deepStrictEqual(Object.keys(files).sort(), ["a.test.html", "a.test_about.html"], "named after the page, unsafe characters folded");
    const about = trackerData(files["a.test_about.html"]);
    assert.deepStrictEqual([...about.internal, ...about.external].map((e) => e.url).sort(), [DOCS, MEMBERS, EY, OZ].sort());
    assert.ok([...about.internal, ...about.external].every((e) => e.refs.length === 1 && e.refs[0] === ABOUT), "refs reduced to the page");
    const m = open(files["a.test_about.html"]);
    assert.deepStrictEqual(mine(m), { [PAIR(ABOUT, EY)]: "1", [`${NS}ft:${ABOUT}\n${EY}`]: mine(d)[`${NS}ft:${ABOUT}\n${EY}`], [`${NS}n:${ABOUT}`]: "web team" }, "seeded with this page's state only");
    assert.strictEqual($$(m, ".grp").length, 1);
    d.window.close(); m.window.close();
  },

  async "a mini-tracker owner's export merges straight back into the full tracker"() {
    const d = open(TRACKER);
    $(d, "#cwPages").click();
    await until(() => d.downloads.length === 2);
    const home = open(await d.downloads.find((f) => f.name === "a.test.html").blob.text());
    fixBox(home, HOME, OZ).click();
    $(home, "#cwExp").click();
    const exported = (await saved(home)).text;
    importFiles(d, [exported]);
    await until(() => /^Imported/.test(toast(d)));
    const again = open(TRACKER, { store: storeOf(d) });
    assert.deepStrictEqual([fixBox(again, HOME, OZ).checked, fixBox(again, ABOUT, OZ).checked], [true, false]);
    d.window.close(); home.window.close(); again.window.close();
  },

  async "per-subfolder export: one file per first-level folder, holding every page under it"() {
    const TEAM = P("/about/team");
    const st = fixtureState();
    st.pages.push({ url: TEAM, depth: 2, title: "Team", status: 200, internal: 0, external: 1 });
    st.refs.get(OZ).add(TEAM);
    const r = openReport(buildHtml(st));
    const { src } = await exportTracker(r);
    r.window.close();
    const d = open(src);
    $(d, "#cwFolders").click();
    await until(() => d.downloads.length === 2);
    assert.deepStrictEqual(d.downloads.map((f) => f.name).sort(), ["a.test.html", "a.test_about.html"]);
    const about = trackerData(await d.downloads.find((f) => f.name === "a.test_about.html").blob.text());
    const oz = about.external.find((e) => e.url === OZ);
    assert.deepStrictEqual(oz.refs.sort(), [ABOUT, TEAM].sort(), "both pages of the folder, not the home page");
    $(d, "#cwPages").click();
    await until(() => d.downloads.length === 5);
    assert.deepStrictEqual(d.downloads.slice(2).map((f) => f.name).sort(), ["a.test.html", "a.test_about.html", "a.test_about_team.html"], "per page, by contrast, splits them");
    d.window.close();
  },

  async "a page or folder whose links are all Working is skipped"() {
    const t = open(TRACKER);
    for (const u of [DOCS, MEMBERS, EY, OZ]) $(t, `.vo[data-broken="${u}"]`).click();   // all of /about/'s links
    $(t, "#cwPages").click();
    await until(() => t.downloads.length === 1);
    assert.strictEqual(t.downloads[0].name, "a.test.html");
    assert.match(toast(t), /\(1 page skipped — all links already Working\)/);
    for (const u of [OLD, EX, BQ]) $(t, `.vo[data-broken="${u}"]`).click();
    $(t, "#cwFolders").click();
    assert.strictEqual(toast(t), "Nothing to export — every link is already marked Working");
    assert.strictEqual(t.downloads.length, 1);
    t.window.close();
  },
};

run(tests);
