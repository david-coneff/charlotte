"use strict";
// Report + output layer — FACADE. The implementation was partitioned into src/report/
// (DS-016 monolith split, AD-096): branding/theme constants, settings resolution, the
// page stylesheet, the embedded client scripts, the buildReport assembler, the JSON
// builder, and the multi-site index surfaces. This file keeps the public interface and
// the require path stable for crawl.js / recheck.js — it re-exports the same five
// functions and owns writeOutputs (report + JSON to disk). Split verified by
// byte-identical output on the golden fixtures (see AD-096).
const fs = require("fs");
const { buildReport } = require("./report/report-page.js");
const { buildReportJson } = require("./report/json-report.js");
const { buildIndexReport, writeCombinedJson } = require("./report/index-report.js");

// Write the report HTML and (optionally) JSON from current state. Used both for
// periodic checkpoints (partial=true) and the final write (partial=false).
function writeOutputs(state, cfg, allow, partial) {
  fs.writeFileSync(cfg.out, buildReport(state, cfg, allow, partial));
  if (cfg.json) fs.writeFileSync(cfg.json, buildReportJson(state, cfg, allow, partial));
}

module.exports = { buildReport, buildReportJson, writeOutputs, buildIndexReport, writeCombinedJson };
