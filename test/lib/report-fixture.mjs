// Shared fixture for the report's browser-side regression tests: a small crawl state, the REAL
// report built from it by src/report.js, and a jsdom loader that runs the report's inline scripts.
//
// The tests drive the generated report, never a copy of its scripts, so they cannot go stale the
// way the old scratchpad suite's extracted IIFEs could (SYNTHESIS §5 #30).
import { createRequire } from "node:module";
import { JSDOM, VirtualConsole } from "jsdom";

const require = createRequire(import.meta.url);
const { buildReport } = require("../../src/report.js");

export const HOST = "a.test";
const P = (path) => `https://${HOST}${path}`;

// Two internal pages linking out to: two broken internal pages in different folders, three broken
// external links across two domains, one reachable external, and two blocked links (one per kind).
export function fixtureState() {
  const refs = new Map([
    [P("/docs/gone"), new Set([P("/"), P("/about/")])],
    [P("/old"), new Set([P("/")])],
    ["https://ext.test/x", new Set([P("/")])],
    ["https://ext.test/y", new Set([P("/about/")])],
    ["https://other.test/z", new Set([P("/"), P("/about/")])],
    ["https://ok.test/", new Set([P("/")])],
    [P("/members"), new Set([P("/about/")])],
    ["https://blk.test/q", new Set([P("/")])],
  ]);
  return {
    startedAt: "2026-10-31T00:00:00.000Z", startUrl: P("/"), startHost: HOST, pathPrefix: "",
    pages: [
      { url: P("/"), depth: 0, title: "Home", status: 200, internal: 4, external: 5 },
      { url: P("/about/"), depth: 1, title: "About", status: 200, internal: 2, external: 3 },
    ],
    queue: [],
    external: new Map([
      ["https://ext.test/x", { url: "https://ext.test/x", host: "ext.test", status: "err" }],
      ["https://ext.test/y", { url: "https://ext.test/y", host: "ext.test", status: "err" }],
      ["https://other.test/z", { url: "https://other.test/z", host: "other.test", status: "err" }],
      ["https://ok.test/", { url: "https://ok.test/", host: "ok.test", status: "ok" }],
    ]),
    outOfScope: new Map(),
    refs,
    errors: [
      { url: P("/docs/gone"), reason: "HTTP 404", kind: "internal", source: P("/") },
      { url: P("/old"), reason: "HTTP 410", kind: "internal", source: P("/") },
      { url: "https://ext.test/x", reason: "HTTP 404", kind: "external", source: P("/") },
      { url: "https://ext.test/y", reason: "HTTP 500", kind: "external", source: P("/about/") },
      { url: "https://other.test/z", reason: "DNS failure", kind: "external", source: P("/") },
    ],
    blocked: [
      { url: P("/members"), reason: "HTTP 403", kind: "internal", source: P("/about/") },
      { url: "https://blk.test/q", reason: "HTTP 429", kind: "external", source: P("/") },
    ],
    startedMs: 0, finishedMs: 1000, logParts: [], logManifest: "", logSingleFile: true,
  };
}

export const CFG = {
  startUrl: P("/"), out: "crawl-report.html", concurrency: 3, delay: 0, rps: 0, maxPages: 100,
  maxDepth: 3, includeSubdomains: false, checkExternal: true, paginate: false,
};

export const buildHtml = (state = fixtureState(), cfg = CFG) => buildReport(state, cfg, [], false);

// Open a report in jsdom with its scripts running. `store` pre-seeds localStorage before any
// script runs; `noStorage` makes the localStorage accessor throw, as some file:// modes do.
// Downloads (URL.createObjectURL) are captured on dom.downloads as { name, blob }. Any script
// error other than jsdom's "Not implemented" (navigation, location.reload) fails the test.
export function openReport(html, { store = {}, noStorage = false } = {}) {
  const errors = [], downloads = [], blobs = new Map();
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => { if (!/Not implemented/.test(e.message)) errors.push(e); });
  const dom = new JSDOM(html, {
    runScripts: "dangerously", url: `https://${HOST}/crawl-report.html`, virtualConsole: vc,
    beforeParse(w) {
      if (noStorage) Object.defineProperty(w, "localStorage", { get() { throw new w.DOMException("denied", "SecurityError"); } });
      else for (const [k, v] of Object.entries(store)) w.localStorage.setItem(k, v);
      w.URL.createObjectURL = (blob) => { const u = `blob:${HOST}/${blobs.size}`; blobs.set(u, blob); return u; };
      w.URL.revokeObjectURL = () => {};
      // An <a download> click is how dl() saves; record the blob behind its href.
      w.HTMLAnchorElement.prototype.click = function () { if (this.download) downloads.push({ name: this.download, blob: blobs.get(this.href) }); };
    },
  });
  dom.errors = errors;
  dom.downloads = downloads;
  return dom;
}

export const $ = (dom, sel) => dom.window.document.querySelector(sel);
export const $$ = (dom, sel) => [...dom.window.document.querySelectorAll(sel)];
export const row = (dom, url) => $(dom, `tr[data-url="${url}"]`);
export const statN = (dom, id) => Number($(dom, `#${id}`).textContent.replace(/,/g, ""));
export const cls = (el) => ` ${el.className} `;
export const hasCls = (el, c) => cls(el).includes(` ${c} `);
export const storeOf = (dom) => {
  const s = dom.window.localStorage, out = {};
  for (let i = 0; i < s.length; i++) out[s.key(i)] = s.getItem(s.key(i));
  return out;
};

// Tick a row's Broken or Working box the way a user does (click fires the change handler).
export const tick = (dom, url, which) => row(dom, url).querySelector(which === "broken" ? ".brokenbox" : ".okbox").click();

// The data island a fix tracker renders itself from (between its CW_DATA_BOUNDS markers).
export const trackerData = (src) => JSON.parse(/\/\*CW_DATA_BOUNDS\*\/([\s\S]*?)\/\*CW_DATA_BOUNDS\*\//.exec(src)[1]);

// Click the report's "Export fix tracker" and return the saved tracker document.
export async function exportTracker(dom) {
  const before = dom.downloads.length;
  $(dom, ".trackbtn").click();
  if (dom.downloads.length !== before + 1) throw new Error("the tracker export saved no file");
  const { name, blob } = dom.downloads[before];
  const src = await blob.text();
  return { name, src, data: trackerData(src) };
}

// Wait until cond() holds (FileReader and toasts are async). Fails after `ms`.
export async function until(cond, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error("timed out waiting for the page");
    await new Promise((r) => setTimeout(r, 10));
  }
}

// The same minimal runner as the other test files (Node 14 floor, no node:test).
export async function run(tests) {
  let failed = 0;
  for (const [name, fn] of Object.entries(tests)) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${e.message}`);
    }
  }
  console.log(`\n${Object.keys(tests).length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
