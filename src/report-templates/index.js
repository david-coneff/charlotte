"use strict";
// report-templates: split into per-template modules (AD-082). report.js does
// `require("./report-templates")`, which resolves here unchanged. NEWWIN = the
// reused link-window script; TRACKER_TEMPLATE = the standalone fix-tracker doc
// (which concatenates NEWWIN). The strings are embedded verbatim into report.js's
// template literals, so their no-backtick/${}/backslash/inner-IIFE constraints hold.
module.exports = {
  NEWWIN: require("./newwin"),
  TRACKER_TEMPLATE: require("./tracker-template"),
};
