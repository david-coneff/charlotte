"use strict";
// Allowlist load + compile (DS-016 split from crawl.js). Reads the allowlist file
// (one pattern per line; '#' comments, '*' wildcards) and compiles each pattern to
// an anchored RegExp used to move known-broken links out of the report's Errors.
const fs = require("fs");

function loadAllowlist(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t || t.startsWith("#")) return null;
      return t.split(/\s+#/)[0].trim(); // allow inline " # comment" but keep '#' inside URLs
    })
    .filter(Boolean);
}

function compileAllow(patterns) {
  return patterns.map((p) => {
    const re = "^" + p.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$";
    return new RegExp(re);
  });
}

module.exports = { loadAllowlist, compileAllow };
