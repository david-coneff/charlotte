#!/usr/bin/env node
"use strict";
// Merge several Charlotte fix-tracker state files into one consolidated state.
//
// This is the REFERENCE implementation of the merge a Power Automate flow performs when it
// consumes a SharePoint "inbox" folder of contributors' exports (see SHAREPOINT-MERGE.md), and a
// zero-dependency CLI fallback you can run anywhere Node is available — e.g. if the tenant also
// locks down Power Automate, drop everyone's JSON in a folder and run:
//
//   node merge-fix-state.js --out consolidated.json drop1.json drop2.json ...
//   node merge-fix-state.js inbox/*.json > consolidated.json        (default output is stdout)
//
// Then open the central tracker and Import consolidated.json (the tracker also accepts the whole
// folder at once via multi-select Import — this CLI just lets a machine do it unattended).
//
// Semantics mirror the flow's union(): files are folded in order and on a key collision the LATER
// file wins (a later export reflects later work). Only ONE site (host) is consolidated — the first
// valid file sets it, and files for a different host are skipped with a warning. Only keys under
// cwfix:<host>: are kept, so a malformed or hostile file can never inject stray localStorage keys.
const fs = require("fs");

// Fold an ordered list of state objects ({app, host, v}) into one. Returns {state, report}.
function mergeStates(states, sources) {
  let host = null;
  const v = {};
  const report = { merged: 0, skippedHost: 0, skippedBad: 0, entries: 0, files: [] };
  for (let i = 0; i < states.length; i++) {
    const obj = states[i];
    const src = (sources && sources[i]) || ("#" + i);
    if (!obj || obj.app !== "charlotte-fix-tracker" || !obj.v || typeof obj.v !== "object") {
      report.skippedBad++; report.files.push({ source: src, status: "not-a-tracker-state" }); continue;
    }
    if (host === null) host = obj.host || "";
    if ((obj.host || "") !== host) {
      report.skippedHost++; report.files.push({ source: src, status: "different-host:" + (obj.host || "") }); continue;
    }
    const ns = "cwfix:" + host + ":";
    let n = 0;
    const keys = Object.keys(obj.v);
    for (let k = 0; k < keys.length; k++) {
      const key = keys[k];
      if (key.indexOf(ns) !== 0) continue;   // namespace guard — same rule the tracker applies on import
      v[key] = obj.v[key];                    // later file wins on collision (union semantics)
      n++;
    }
    report.merged++; report.entries += n;
    report.files.push({ source: src, status: "merged", keys: n });
  }
  return { state: { app: "charlotte-fix-tracker", host: host || "", v: v }, report: report };
}

// Read + parse the given paths, then mergeStates(). Unreadable/non-JSON files are skipped (counted).
function mergeFiles(paths) {
  const states = [], sources = [];
  const preBad = [];
  for (let i = 0; i < paths.length; i++) {
    try { states.push(JSON.parse(fs.readFileSync(paths[i], "utf8"))); sources.push(paths[i]); }
    catch (e) { preBad.push(paths[i]); }
  }
  const out = mergeFiles_pushBad(mergeStates(states, sources), preBad);
  return out;
}
function mergeFiles_pushBad(res, preBad) {
  for (let i = 0; i < preBad.length; i++) {
    res.report.skippedBad++; res.report.files.push({ source: preBad[i], status: "unreadable/not-json" });
  }
  return res;
}

function main(argv) {
  const args = argv.slice(2);
  let out = null; const inputs = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out") out = args[++i];
    else if (a === "--stdout") { /* default; accepted for clarity */ }
    else if (a === "-h" || a === "--help") {
      process.stdout.write("Usage: node merge-fix-state.js [--out FILE | --stdout] file1.json file2.json ...\n");
      return 0;
    } else inputs.push(a);
  }
  if (!inputs.length) {
    process.stderr.write("No input files.\nUsage: node merge-fix-state.js [--out FILE | --stdout] file1.json ...\n");
    return 2;
  }
  const res = mergeFiles(inputs);
  const json = JSON.stringify(res.state, null, 2);
  if (out) fs.writeFileSync(out, json); else process.stdout.write(json + "\n");
  const r = res.report;
  process.stderr.write(
    "Merged " + r.merged + " file(s), " + r.entries + " entr" + (r.entries === 1 ? "y" : "ies") +
    " for host '" + res.state.host + "'" +
    (r.skippedHost ? (" — " + r.skippedHost + " skipped (different host)") : "") +
    (r.skippedBad ? (" — " + r.skippedBad + " skipped (not a tracker file)") : "") + "\n");
  return 0;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { mergeStates: mergeStates, mergeFiles: mergeFiles };
