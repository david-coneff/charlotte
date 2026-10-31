// Regression tests: the crawl settings survive a JSON round trip into a --rebuild-from /
// --recheck-from rewrite (src/report/settings.js, json-report.js, recheck.js loadStateFromJson).
//
// A rewrite runs in a separate process whose cfg holds CLI defaults. The JSON carries the
// ORIGINAL crawl's settings (Infinity as null, since JSON has none) and loadStateFromJson puts
// them back on state.settings, where they win. A JSON written before settings were recorded
// must not have the rewrite's defaults shown, nor laundered into the JSON it writes.
//
// Plain node:assert + the same minimal runner as report-idempotence.mjs (Node 14 floor).
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { effSettings, settingsAreKnown } = require("../src/report/settings.js");
const { buildReportJson } = require("../src/report/json-report.js");
const { loadStateFromJson } = require("../src/recheck.js");

// What a fresh crawl ran with, and the CLI defaults a rewrite process starts from.
const CRAWL = { concurrency: 3, delay: 250, rps: 2, maxPages: Infinity, maxDepth: 4, includeSubdomains: true, checkExternal: false };
const DEFAULTS = { concurrency: 8, delay: 0, rps: 0, maxPages: 500, maxDepth: Infinity, includeSubdomains: false, checkExternal: true };

const freshState = () => ({
  startedAt: "2026-10-31T00:00:00.000Z", startUrl: "https://a.test/", startHost: "a.test", pathPrefix: "",
  pages: [{ url: "https://a.test/", status: 200, internal: 1, external: 0 }], queue: [],
  external: new Map(), outOfScope: new Map(), refs: new Map(), errors: [], blocked: [],
  startedMs: 0, finishedMs: 1000,
});

function roundTrip(state, cfg) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "charlotte-cfg-")), "crawl-report.json");
  fs.writeFileSync(file, buildReportJson(state, cfg, [], false));
  return { json: JSON.parse(fs.readFileSync(file, "utf8")), loaded: loadStateFromJson(file) };
}

const tests = {
  "a fresh crawl persists its settings, Infinity as null"() {
    const { json } = roundTrip(freshState(), CRAWL);
    assert.deepStrictEqual(json.settings, { ...CRAWL, maxPages: null });
  },

  "a rewrite shows the original crawl's settings, not its own defaults"() {
    const { loaded } = roundTrip(freshState(), CRAWL);
    const rewriteCfg = { ...DEFAULTS, rebuildFrom: "crawl-report.json" };
    assert.strictEqual(settingsAreKnown(loaded, rewriteCfg), true);
    assert.deepStrictEqual(effSettings(loaded, rewriteCfg), CRAWL, "null comes back as Infinity");
  },

  "a rewrite of a rewrite keeps them (they are re-persisted)"() {
    const first = roundTrip(freshState(), CRAWL).loaded;
    const second = roundTrip(first, { ...DEFAULTS, recheckFrom: "crawl-report.json" });
    assert.deepStrictEqual(second.json.settings, { ...CRAWL, maxPages: null });
    assert.deepStrictEqual(effSettings(second.loaded, { ...DEFAULTS, rebuildFrom: "x" }), CRAWL);
  },

  "an old JSON without settings: unknown, and not laundered into the new JSON"() {
    const { loaded } = roundTrip(freshState(), CRAWL);
    loaded.settings = null;   // as loadStateFromJson returns for a JSON that predates the block
    const rewriteCfg = { ...DEFAULTS, rebuildFrom: "old.json" };
    assert.strictEqual(settingsAreKnown(loaded, rewriteCfg), false);
    const { json } = roundTrip(loaded, rewriteCfg);
    assert.ok(!("settings" in json), "the rewrite's CLI defaults must not become a settings block");
  },

  "partly recorded settings fall back field by field, with type checks"() {
    const s = effSettings({ settings: { concurrency: 2, maxPages: null, includeSubdomains: "yes", delay: "100" } }, DEFAULTS);
    assert.deepStrictEqual(s, { ...DEFAULTS, concurrency: 2, maxPages: Infinity });
  },

  "a fresh crawl with no state.settings uses cfg verbatim"() {
    assert.strictEqual(settingsAreKnown({}, CRAWL), true);
    assert.deepStrictEqual(effSettings({}, CRAWL), CRAWL);
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
