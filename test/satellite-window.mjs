// Regression tests: the satellite link window (src/report-templates/newwin.js), which the report
// and the fix tracker both append. Driven in jsdom on a report built from a fixture crawl
// (test/lib/report-fixture.mjs), with window.open replaced by a recorder. SYNTHESIS §6 area
// "satellite window and interstitial":
//
//   Every plain click on an http(s) link opens ONE named popup, docked beside the report on the
//   side with more room, and every later click reuses it. Each load first shows a blob:
//   interstitial naming the link, which meta-refreshes to it. A closed popup is replaced; one whose
//   handle was lost to a cross-origin page is reused by name. Modified clicks and non-http links are
//   left to the browser.
import assert from "node:assert";
import { HOST, buildHtml, openReport, $, exportTracker, run } from "./lib/report-fixture.mjs";

const EX = "https://ext.test/x", OZ = "https://other.test/z";

const html = buildHtml();
const report = openReport(html);
const { src: TRACKER } = await exportTracker(report);
report.window.close();

// A fake popup: records navigations; `crossOrigin` makes location.replace throw like a lost handle.
function fakePopup(opts = {}) {
  const nav = [];
  return {
    closed: false, nav, moved: null, focused: 0,
    location: { replace(u) { if (opts.crossOrigin) throw new Error("SecurityError"); nav.push(u); }, set href(u) { if (opts.crossOrigin) throw new Error("SecurityError"); nav.push(u); } },
    focus() { this.focused++; }, moveTo(x, y) { this.moved = [x, y]; }, resizeTo(w, h) { this.size = [w, h]; },
  };
}

// Open a page with window.open recorded and the screen geometry given (all in px). The page is
// opened from file://, as a saved report is: a relative or #fragment link then resolves to file:,
// which the script leaves to the browser. (Served over http, those would resolve to http: and be
// routed to the popup too.)
function openWith(src, { screen = { availWidth: 1920, availHeight: 1080, availLeft: 0, availTop: 0 }, at = { screenX: 0, outerWidth: 1000 }, noBlob = false } = {}) {
  const d = openReport(src, { url: "file:///home/user/reports/crawl-report.html" });
  assert.deepStrictEqual(d.errors.map((e) => e.message), []);
  const w = d.window;
  for (const [k, v] of Object.entries(screen)) Object.defineProperty(w.screen, k, { configurable: true, value: v });
  for (const [k, v] of Object.entries(at)) Object.defineProperty(w, k, { configurable: true, value: v });
  if (noBlob) w.URL.createObjectURL = () => { throw new Error("blob: unavailable"); };
  d.opens = [];
  d.popups = [];
  d.nextPopup = () => fakePopup();
  w.open = (url, name, features) => { const p = d.nextPopup(); d.opens.push({ url, name, features }); d.popups.push(p); return p; };
  return d;
}

const linkTo = (dom, url) => $(dom, `a[href="${url}"]`);
const click = (dom, a, mods = {}) => { const e = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, ...mods }); a.dispatchEvent(e); return e.defaultPrevented; };
const feature = (f, k) => Number(new RegExp(`${k}=(-?\\d+)`).exec(f)[1]);

const tests = {
  async "a link opens one named, docked popup that first shows an interstitial naming the link"() {
    const d = openWith(html);
    assert.strictEqual(click(d, linkTo(d, EX)), true, "the browser's own navigation is prevented");
    assert.strictEqual(d.opens.length, 1);
    const [{ url, name, features }] = d.opens;
    assert.deepStrictEqual([url, name], ["", "charlotteLink"]);
    assert.match(features, /^popup=yes,/);
    const [nav] = d.popups[0].nav;
    assert.match(nav, /^blob:/, "an interstitial, not the link itself");
    const page = await d.blobs.get(nav).text();
    assert.match(page, /<p class=u>https:\/\/ext\.test\/x<\/p>/, "it names the link being loaded");
    assert.match(page, new RegExp(`<meta http-equiv=refresh content="0\\.6;url=${EX.replace(/\./g, "\\.")}">`));
    assert.match(page, /Not loading\? <a href="https:\/\/ext\.test\/x">Open it directly<\/a>/);
    d.window.close();
  },

  async "the interstitial escapes the link it names"() {
    const d = openWith(html);
    const a = d.window.document.createElement("a");
    a.href = 'https://ext.test/q?a=1&b="2"'; a.textContent = "q"; d.window.document.body.appendChild(a);
    click(d, a);
    const page = await d.blobs.get(d.popups[0].nav[0]).text();
    assert.ok(page.includes("<p class=u>https://ext.test/q?a=1&amp;b=%222%22</p>"), "& is escaped (the quote arrives percent-encoded)");
    assert.ok(!/&b=/.test(page), "no raw ampersand anywhere");
    d.window.close();
  },

  "later links reuse the same popup instead of opening another"() {
    const d = openWith(html);
    click(d, linkTo(d, EX));
    click(d, linkTo(d, OZ));
    click(d, linkTo(d, EX));
    assert.strictEqual(d.opens.length, 1, "window.open ran once");
    assert.strictEqual(d.popups[0].nav.length, 3, "and the one popup was navigated three times");
    assert.strictEqual(d.popups[0].focused, 3);
    d.window.close();
  },

  "the popup docks on the side of the report with more room"() {
    const right = openWith(html, { at: { screenX: 100, outerWidth: 1000 } });   // 820 px free on the right
    click(right, linkTo(right, EX));
    const fr = right.opens[0].features;
    assert.deepStrictEqual([feature(fr, "left"), feature(fr, "width"), feature(fr, "top"), feature(fr, "height")], [1100, 820, 0, 1080]);
    const left = openWith(html, { at: { screenX: 900, outerWidth: 1000 } });    // 900 px free on the left
    click(left, linkTo(left, EX));
    const fl = left.opens[0].features;
    assert.deepStrictEqual([feature(fl, "left"), feature(fl, "width")], [0, 900]);
    const neither = openWith(html, { at: { screenX: 200, outerWidth: 1500 } }); // 200 / 220: too narrow
    click(neither, linkTo(neither, EX));
    const fn = neither.opens[0].features;
    assert.deepStrictEqual([feature(fn, "width"), feature(fn, "left")], [806, 1920 - 806], "42% of the screen, on the roomier side");
    right.window.close(); left.window.close(); neither.window.close();
  },

  "a popup the user closed is replaced by a fresh docked one"() {
    const d = openWith(html);
    click(d, linkTo(d, EX));
    d.popups[0].closed = true;
    click(d, linkTo(d, OZ));
    assert.strictEqual(d.opens.length, 2);
    assert.match(d.opens[1].features, /^popup=yes,/);
    assert.strictEqual(d.popups[1].nav.length, 1);
    d.window.close();
  },

  "a popup whose handle a cross-origin page took is reused by name, not duplicated"() {
    const d = openWith(html);
    d.nextPopup = () => fakePopup({ crossOrigin: true });
    click(d, linkTo(d, EX));
    click(d, linkTo(d, OZ));
    const reuse = d.opens[d.opens.length - 1];
    assert.strictEqual(reuse.name, "charlotteLink");
    assert.strictEqual(reuse.features, undefined, "no features string, which would spawn a second window");
    assert.match(reuse.url, /^blob:/, "and it still shows the interstitial");
    d.window.close();
  },

  "where blob: URLs are unavailable, the popup goes straight to the link"() {
    const d = openWith(html, { noBlob: true });
    click(d, linkTo(d, EX));
    assert.deepStrictEqual(d.popups[0].nav, [EX]);
    d.window.close();
  },

  "modified clicks and non-http links are left to the browser"() {
    const d = openWith(html);
    for (const mods of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      assert.strictEqual(click(d, linkTo(d, EX), mods), false, JSON.stringify(mods));
    }
    const doc = d.window.document;
    for (const href of ["#top", "mailto:web@a.test", "crawl-report.json"]) {
      const a = doc.createElement("a"); a.href = href; a.textContent = href; doc.body.appendChild(a);
      assert.strictEqual(click(d, a), false, href);
    }
    assert.strictEqual(d.opens.length, 0);
    d.window.close();
  },

  "a click on an element inside a link still routes to the popup"() {
    const d = openWith(html);
    const a = linkTo(d, EX), span = d.window.document.createElement("span");
    span.textContent = "inner"; a.appendChild(span);
    assert.strictEqual(click(d, span), true);
    assert.strictEqual(d.opens.length, 1);
    d.window.close();
  },

  "the fix tracker routes its links through the same popup"() {
    const d = openWith(TRACKER);
    click(d, linkTo(d, EX));
    click(d, linkTo(d, `https://${HOST}/about/`));
    assert.strictEqual(d.opens.length, 1);
    assert.strictEqual(d.popups[0].nav.length, 2);
    d.window.close();
  },
};

run(tests);
