// Regression tests: merge-fix-state.js, the reference merge of contributors' fix-tracker
// exports (SHAREPOINT-MERGE.md; the Power Automate flow mirrors it).
//
// The merge folds files in order with union() semantics: on a key collision the LATER file
// wins. Only the first valid file's host is consolidated; other hosts are skipped. Only keys
// under cwfix:<host>: are kept, so a malformed or hostile file cannot plant stray
// localStorage keys in the tracker that imports the result.
//
// Plain node:assert + the same minimal runner as report-idempotence.mjs (Node 14 floor).
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, "..", "merge-fix-state.js");
const { mergeStates, mergeFiles } = require(CLI);

const state = (host, v) => ({ app: "charlotte-fix-tracker", host, v });
const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "charlotte-merge-"));
const write = (dir, name, obj) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, typeof obj === "string" ? obj : JSON.stringify(obj));
  return p;
};

const tests = {
  "later file wins a key collision; distinct keys union"() {
    const { state: s, report } = mergeStates([
      state("a.test", { "cwfix:a.test:p1": "fixed", "cwfix:a.test:p2": "open" }),
      state("a.test", { "cwfix:a.test:p1": "wontfix", "cwfix:a.test:p3": "open" }),
    ]);
    assert.deepStrictEqual(s, state("a.test", {
      "cwfix:a.test:p1": "wontfix", "cwfix:a.test:p2": "open", "cwfix:a.test:p3": "open" }));
    assert.strictEqual(report.merged, 2);
    assert.strictEqual(report.entries, 4, "entries counts keys taken from each file");
  },

  "namespace guard drops keys outside cwfix:<host>:"() {
    const { state: s } = mergeStates([state("a.test", {
      "cwfix:a.test:p1": "fixed",
      "cwfix:b.test:p1": "fixed",      // another host's namespace
      "cwfix:a.test": "no colon",      // the bare prefix is not inside the namespace
      "theme": "dark",                 // a stray localStorage key
      "__proto__x": "y",
    })]);
    assert.deepStrictEqual(Object.keys(s.v), ["cwfix:a.test:p1"]);
  },

  "only the first valid file's host is consolidated"() {
    const { state: s, report } = mergeStates(
      [state("a.test", { "cwfix:a.test:p1": "1" }), state("b.test", { "cwfix:b.test:p1": "2" }),
       state("a.test", { "cwfix:a.test:p2": "3" })],
      ["one.json", "two.json", "three.json"]);
    assert.strictEqual(s.host, "a.test");
    assert.deepStrictEqual(Object.keys(s.v).sort(), ["cwfix:a.test:p1", "cwfix:a.test:p2"]);
    assert.strictEqual(report.skippedHost, 1);
    assert.deepStrictEqual(report.files[1], { source: "two.json", status: "different-host:b.test" });
  },

  "non-tracker objects are skipped, and do not set the host"() {
    const { state: s, report } = mergeStates([
      null, { app: "something-else", host: "x.test", v: {} }, { app: "charlotte-fix-tracker", host: "x.test" },
      { app: "charlotte-fix-tracker", host: "x.test", v: "not an object" },
      state("a.test", { "cwfix:a.test:p": "1" }),
    ]);
    assert.strictEqual(report.skippedBad, 4);
    assert.strictEqual(s.host, "a.test", "a skipped file never claims the host");
    assert.deepStrictEqual(report.files.slice(0, 4).map((f) => f.status), Array(4).fill("not-a-tracker-state"));
  },

  "nothing valid gives an empty state for host ''"() {
    assert.deepStrictEqual(mergeStates([]).state, state("", {}));
  },

  "unreadable and non-JSON files are counted, not fatal"() {
    const d = tmpdir();
    const good = write(d, "good.json", state("a.test", { "cwfix:a.test:p": "1" }));
    const bad = write(d, "bad.json", "{not json");
    const res = mergeFiles([path.join(d, "missing.json"), bad, good]);
    assert.strictEqual(res.report.merged, 1);
    assert.strictEqual(res.report.skippedBad, 2);
    assert.deepStrictEqual(res.report.files.filter((f) => f.status === "unreadable/not-json").map((f) => path.basename(f.source)).sort(),
      ["bad.json", "missing.json"]);
  },

  "CLI writes --out, reports on stderr, and exits 2 with no inputs"() {
    const d = tmpdir();
    const a = write(d, "a.json", state("a.test", { "cwfix:a.test:p1": "fixed" }));
    const b = write(d, "b.json", state("b.test", { "cwfix:b.test:p1": "fixed" }));
    const out = path.join(d, "consolidated.json");
    const r = spawnSync(process.execPath, [CLI, "--out", out, a, b], { encoding: "utf8" });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(out, "utf8")), state("a.test", { "cwfix:a.test:p1": "fixed" }));
    assert.match(r.stderr, /Merged 1 file\(s\), 1 entry for host 'a\.test' — 1 skipped \(different host\)/);
    const s = spawnSync(process.execPath, [CLI, a], { encoding: "utf8" });
    assert.deepStrictEqual(JSON.parse(s.stdout), state("a.test", { "cwfix:a.test:p1": "fixed" }), "stdout by default");
    assert.strictEqual(spawnSync(process.execPath, [CLI], { encoding: "utf8" }).status, 2);
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
