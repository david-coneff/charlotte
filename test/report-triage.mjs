// Regression tests: the report's manual triage (src/report/triage-script.js), driven in jsdom on a
// report built from a fixture crawl (test/lib/report-fixture.mjs). Two SYNTHESIS §6 areas:
//
//   triage verdicts   — the Broken/Working boxes are mutually exclusive, persist per host in
//                       localStorage, stamp "Last triaged", and drive the live header stats
//                       (Errors rows count until marked Working; Blocked rows only once Broken).
//   domain grouping   — rows group per domain (external) or first folder (internal); each group's
//                       bulk Broken/Working applies to all its rows, and its boxes, Mixture and
//                       all-tested indicators, "tested K/N" counter and amber "untested" outline
//                       are derived from the rows, so they survive a reload with no extra storage.
import assert from "node:assert";
import { HOST, buildHtml, openReport, $, $$, row, statN, hasCls, storeOf, tick, run } from "./lib/report-fixture.mjs";

const DOCS = `https://${HOST}/docs/gone`, OLD = `https://${HOST}/old`;
const EX = "https://ext.test/x", EY = "https://ext.test/y", OZ = "https://other.test/z";
const MEMBERS = `https://${HOST}/members`, BQ = "https://blk.test/q";
const KB = (u) => `cwbroken:${HOST}:${u}`, KO = (u) => `cwok:${HOST}:${u}`, KT = (u) => `cwts:${HOST}:${u}`;

const html = buildHtml();
const open = (store) => { const d = openReport(html, { store }); assert.deepStrictEqual(d.errors.map((e) => e.message), []); return d; };
const card = (dom, id) => $(dom, `#${id}`).parentNode.parentNode;
const grp = (dom, scope, domain) => $(dom, `.domgrp[data-scope="${scope}"][data-domain="${domain}"]`);
const ctl = (dom, scope, domain, c) => $(dom, `.${c}[data-scope="${scope}"][data-domain="${domain}"]`);
const boxes = (dom, url) => { const r = row(dom, url); return [r.querySelector(".brokenbox").checked, r.querySelector(".okbox").checked]; };
const stats = (dom) => ["brokenInstN", "brokenIntN", "brokenExtN", "brokenTotN", "brokenPgN"].map((id) => statN(dom, id));

const tests = {
  // ---- triage verdicts ------------------------------------------------------------------------
  "untriaged: Errors rows count as broken, Blocked rows do not"() {
    const d = open();
    // instances: /docs/gone 2 + /old 1 + ext x 1 + ext y 1 + other z 2; destinations 2 int + 3 ext;
    // referrer pages: / and /about/.
    assert.deepStrictEqual(stats(d), [7, 2, 3, 5, 2]);
    assert.ok(hasCls(card(d, "brokenIntN"), "tested-partial"), "amber while untriaged");
    d.window.close();
  },

  "Broken and Working are mutually exclusive, and a verdict persists per host"() {
    const d = open();
    tick(d, EX, "broken");
    assert.deepStrictEqual(boxes(d, EX), [true, false]);
    assert.ok(hasCls(row(d, EX), "confirmed"));
    tick(d, EX, "working");
    assert.deepStrictEqual(boxes(d, EX), [false, true], "ticking Working unticks Broken");
    assert.ok(hasCls(row(d, EX), "notbroken") && !hasCls(row(d, EX), "confirmed"));
    const s = storeOf(d);
    assert.strictEqual(s[KO(EX)], "1");
    assert.ok(!(KB(EX) in s), "the other verdict's key is cleared");
    assert.match(s[KT(EX)], /^\d{4}-\d\d-\d\d \d\d:\d\d$/, "Last triaged is stamped");
    assert.strictEqual(row(d, EX).querySelector(".tscell").textContent, s[KT(EX)]);
    tick(d, EX, "working");
    assert.deepStrictEqual(boxes(d, EX), [false, false], "unticking returns the row to no verdict");
    assert.deepStrictEqual(Object.keys(storeOf(d)).filter((k) => k.startsWith("cw")), [], "and clears all three keys");
    d.window.close();
  },

  "marking an Errors link Working drops it from every broken stat"() {
    const d = open();
    tick(d, OZ, "working");   // 2 instances, from both referrer pages
    assert.deepStrictEqual(stats(d), [5, 2, 2, 4, 2]);
    tick(d, DOCS, "working"); tick(d, OLD, "working"); tick(d, EX, "working");
    // Only ext.test/y is left, found on /about/ alone: the referrer-pages card shrinks to 1.
    assert.deepStrictEqual(stats(d), [1, 0, 1, 1, 1]);
    assert.ok(!hasCls(card(d, "brokenIntN"), "bad"), "a zero count loses its red card");
    assert.strictEqual($(d, '#panel-errext .tcount').textContent, "Manually triaged: 2 / 3 · confirmed broken: 0 · confirmed working: 2");
    d.window.close();
  },

  "a Blocked link counts only once confirmed Broken, routed by its kind"() {
    const d = open();
    tick(d, BQ, "broken");   // external
    assert.deepStrictEqual(stats(d), [8, 2, 4, 6, 2]);
    tick(d, MEMBERS, "broken");   // internal, found on /about/
    assert.deepStrictEqual(stats(d), [9, 3, 4, 7, 2]);
    tick(d, MEMBERS, "working");
    assert.deepStrictEqual(stats(d), [8, 2, 4, 6, 2], "Working on a blocked link leaves it uncounted");
    d.window.close();
  },

  "the outline turns green only when every link in its category has a verdict"() {
    const d = open();
    tick(d, DOCS, "broken"); tick(d, OLD, "working");
    assert.ok(hasCls(card(d, "brokenIntN"), "tested-partial"), "the blocked internal link is still untriaged");
    tick(d, MEMBERS, "working");
    assert.ok(hasCls(card(d, "brokenIntN"), "tested-all"));
    assert.ok(hasCls(card(d, "brokenInstN"), "tested-partial"), "instances span external too");
    for (const u of [EX, EY, OZ, BQ]) tick(d, u, "broken");
    for (const id of ["brokenInstN", "brokenExtN", "brokenTotN", "brokenPgN", "blockedN"]) assert.ok(hasCls(card(d, id), "tested-all"), id);
    d.window.close();
  },

  "saved verdicts are restored on reload; Broken wins if both keys are set"() {
    const d = open({ [KB(EX)]: "1", [KT(EX)]: "2026-10-30 09:15", [KO(EY)]: "1", [KB(OZ)]: "1", [KO(OZ)]: "1", [KB("https://ext.test/elsewhere")]: "1" });
    assert.deepStrictEqual(boxes(d, EX), [true, false]);
    assert.strictEqual(row(d, EX).querySelector(".tscell").textContent, "2026-10-30 09:15");
    assert.deepStrictEqual(boxes(d, EY), [false, true]);
    assert.deepStrictEqual(boxes(d, OZ), [true, false], "Broken wins");
    assert.ok(!(KO(OZ) in storeOf(d)), "and the contradicting Working key is cleared");
    assert.deepStrictEqual(stats(d), [6, 2, 2, 4, 2], "restored verdicts drive the stats at load");
    d.window.close();
  },

  "verdicts are namespaced by host: another report's keys are ignored"() {
    const d = open({ [`cwok:b.test:${EX}`]: "1" });
    assert.deepStrictEqual(boxes(d, EX), [false, false]);
    assert.deepStrictEqual(stats(d), [7, 2, 3, 5, 2]);
    d.window.close();
  },

  // ---- domain grouping and indicators ---------------------------------------------------------
  "rows group by domain (external) and by first folder (internal), largest group first"() {
    const d = open();
    const groups = (scope) => $$(d, `.domgrp[data-scope="${scope}"]`).map((g) => [g.getAttribute("data-domain"), g.querySelectorAll("tr[data-url]").length]);
    assert.deepStrictEqual(groups("errext"), [["ext.test", 2], ["other.test", 1]]);
    assert.deepStrictEqual(groups("errint"), [[`${HOST}/docs/`, 1], [`${HOST}/old/`, 1]]);
    assert.deepStrictEqual(groups("blockd"), [[HOST, 1], ["blk.test", 1]], "blocked groups by host");
    d.window.close();
  },

  "a group's bulk Broken applies to every row in it, and to no other group"() {
    const d = open();
    ctl(d, "errext", "ext.test", "dombroken").click();
    assert.deepStrictEqual([boxes(d, EX), boxes(d, EY), boxes(d, OZ)], [[true, false], [true, false], [false, false]]);
    assert.ok(KB(EX) in storeOf(d) && KB(EY) in storeOf(d), "persisted per link");
    ctl(d, "errext", "ext.test", "domworking").click();
    assert.deepStrictEqual([boxes(d, EX), boxes(d, EY)], [[false, true], [false, true]], "bulk Working replaces it");
    assert.strictEqual(ctl(d, "errext", "ext.test", "dombroken").checked, false);
    ctl(d, "errext", "ext.test", "domworking").click();
    assert.deepStrictEqual([boxes(d, EX), boxes(d, EY)], [[false, false], [false, false]], "unticking clears the group");
    d.window.close();
  },

  "the group header is derived from its rows: boxes, Mixture, all-tested, counter, outline"() {
    const d = open();
    const g = grp(d, "errext", "ext.test");
    const ind = (c) => [ctl(d, "errext", "ext.test", c).checked, hasCls(ctl(d, "errext", "ext.test", c).parentNode, "on")];
    assert.ok(hasCls(g, "untested"));
    tick(d, EX, "broken");
    assert.strictEqual(ctl(d, "errext", "ext.test", "domprog").textContent, "· tested 1/2 · 1 broken · 0 working");
    assert.strictEqual(ctl(d, "errext", "ext.test", "dombroken").checked, false, "not ALL broken yet");
    assert.ok(hasCls(g, "untested"));
    tick(d, EY, "working");
    assert.deepStrictEqual(ind("dommixture"), [true, true], "both verdicts present");
    assert.deepStrictEqual(ind("domalltested"), [true, true]);
    assert.ok(!hasCls(g, "untested"), "the amber outline clears once every row is tested");
    tick(d, EY, "broken");
    assert.strictEqual(ctl(d, "errext", "ext.test", "dombroken").checked, true, "all broken -> the group box is ticked");
    assert.deepStrictEqual(ind("dommixture"), [false, false]);
    assert.ok(hasCls(grp(d, "errext", "other.test"), "untested"), "the other group is untouched");
    d.window.close();
  },

  "a group header is re-derived from saved verdicts on reload (no extra storage)"() {
    const d = open({ [KB(EX)]: "1", [KB(EY)]: "1" });
    assert.strictEqual(ctl(d, "errext", "ext.test", "dombroken").checked, true);
    assert.ok(!hasCls(grp(d, "errext", "ext.test"), "untested"));
    assert.strictEqual(ctl(d, "errext", "ext.test", "domprog").textContent, "· tested 2/2 · 2 broken · 0 working");
    assert.deepStrictEqual(Object.keys(storeOf(d)).filter((k) => k.startsWith("cw")).sort(), [KB(EX), KB(EY)].sort(), "no group-level keys");
    d.window.close();
  },

  "a group toggles collapsed, and Expand/Collapse all set every group of the tab"() {
    const d = open();
    const g = grp(d, "errext", "ext.test"), other = grp(d, "errext", "other.test");
    g.querySelector(".domtoggle").click();
    assert.ok(hasCls(g, "collapsed") && !hasCls(other, "collapsed"));
    $(d, "#errextCollapse").click();
    assert.ok(hasCls(g, "collapsed") && hasCls(other, "collapsed"));
    assert.ok(!hasCls(grp(d, "errint", `${HOST}/docs/`), "collapsed"), "another tab's groups are left alone");
    $(d, "#errextExpand").click();
    assert.ok(!hasCls(g, "collapsed") && !hasCls(other, "collapsed"));
    d.window.close();
  },
};

run(tests);
