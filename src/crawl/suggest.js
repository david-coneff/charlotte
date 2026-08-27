"use strict";
// Allowlist-suggestion writer + multi-site path helpers (DS-016 split from crawl.js).
// writeSuggested emits the editable "broken links not yet allowlisted" file; hostOf /
// sitePath derive per-site report/journal paths when several start URLs are crawled.
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

function writeSuggested(cfg, suppressedOut, activeErrors) {
  if (!activeErrors.length) {
    // Nothing new to suggest; leave any existing file untouched.
    return false;
  }
  const lines = [];
  lines.push("# Suggested allowlist — broken links found " + new Date().toISOString());
  lines.push("# These are NOT yet in " + cfg.allowlist + ".");
  lines.push("#");
  lines.push("# To stop a broken link from appearing in future reports, KEEP its");
  lines.push("# line here and append it to " + cfg.allowlist + " (or pass this file");
  lines.push("# via --allowlist). DELETE lines for issues you still want flagged.");
  lines.push("# '*' is a wildcard. '#' starts a comment. Blank lines are ignored.");
  lines.push("#");
  for (const e of activeErrors) {
    lines.push(`${e.url}   # ${e.reason} — found on: ${e.source || "(start)"}`);
  }
  fs.writeFileSync(cfg.suggest, lines.join("\n") + "\n");
  return true;
}

// ----------------------------- multi-site helpers -----------------------------
function hostOf(u) { try { return new URL(u).hostname; } catch { return u; } }

// Derive a per-site report path from the --out base: report.html -> report.1-host.html
function sitePath(out, i, host) {
  const ext = path.extname(out) || ".html";
  const stem = out.slice(0, out.length - ext.length);
  return `${stem}.${i + 1}-${host.replace(/[^a-z0-9.-]/gi, "_")}${ext}`;
}

module.exports = { writeSuggested, hostOf, sitePath };
