# Project Resume Block — Charlotte

One-screen save-state for Charlotte's development continuity.

---

- **project_identity**: Charlotte — a standalone website/domain crawler. Maps a
  single site (every internal link + recorded first-tier external links),
  verifies links including those inside PDF/Office documents, and writes a
  self-contained HTML report. Two independent toolchains (Node CLI + Windows GUI
  + headless verifier; in-browser variant + CORS proxy). Zero-dependency core
  (Node built-ins only); Playwright is optional and used only by `crawl-render.js`.

- **active_objective**: Stand the crawler up as its own repository, migrated out
  of broodforge `tools/` and running identically at repo root. Done.

- **active_milestone**: Initial migration (2026-06-24). 6 tool files carried over
  byte-for-byte and flattened to root; `CRAWLER.md` paths updated; `.gitignore`,
  `README.md`, `package.json`, and the `rhiz-memory/` instance added; CLIs
  verified (`--help` on `crawl.js` and `crawl-render.js`, syntax check on the proxy).

- **active_risks**: None to the tool itself.

- **blockers**: None.

- **next_action**: Operator to delete the `claude/html-web-crawler-sd0i4p` branch
  in broodforge via the GitHub UI — this session is blocked from it (branch-write
  policy 403 + no delete-branch tool exposed). See SESSION_HANDOFF.md.

- **last_completed_step**: **Re-check GUI integration + report UX fixes** (2026-06-26), five ADRs.
  (0) **AD-043 — Errors·external grouped by domain:** collapsible per-domain sections, each header with a
  domain-level Broken/Working pair that bulk-applies to every link in the domain (derived from the per-link
  verdicts; survives reload) — clear a whole misread site (e.g. facebook.com) in one click; Expand/Collapse
  all. `applyVerdict()` now shared by per-link + domain handlers; 26-assert domtest.
  (1) **AD-041 — re-check in the GUI:** "Re-check broken links" now streams live progress to the run log
  the GUI tails (`# recheck-start`, per-link `RECHK ok|broken|blocked <url>`, `# recheck-done`), drives the
  stat chips (re-labeled Re-checked K/N · Now OK · Still broken · Now blocked), and honors **Pause/Stop**
  (`reprobe()` polls the control files; on Stop it restores links it never reached, so nothing is dropped).
  Per the operator's request it writes a **separate `*.recheck.json`** first and only rewrites the live
  report at completion (multi-site: re-probe all + sidecars in phase 1, rewrite reports + index in phase 2);
  `buildReportJson()` was extracted from `writeOutputs` for the sidecar. (2) **AD-040 — triage table layout:**
  `table-layout:fixed` on the Errors/Blocked tables so the "Last tested" column is tight (140px, 13px text)
  and **Reason** gets the freed width (no more one-word-per-line); `.tcol` 80px so Broken/Working headers
  don't clip. (3) **AD-039 — satellite link window** now truly **reuses one window** (held JS reference +
  `location.replace`, not name targeting, which broke once `opener` was nulled). (4) **AD-042 — live
  "Broken · internal/external" destination stats** now update on triage (were static). All suites pass
  (triage incl. new destination asserts, share, newwin incl. reuse asserts); HTA parses + ES3/ES5-clean;
  re-check verified end-to-end (single + multi-site, Stop retains links, GUI `processLine` over real logs).
  (Prior step — partitioned `decisions.md` into an index + `decisions/` bodies and extracted
  `report-templates.js` (AD-036); plus GUI resume-counter fix (AD-035).)

- **prior_step**: Added a **"Fixed on" timestamp** and **shareable state** to the fix
  tracker (2026-06-25, AD-033). The Fixed box now stamps its own date/time when ticked (clears on
  untick; key `cwfix:host:ft:`+pkey). The tracker also gained a **share toolbar** that mirrors the
  crawl report's: **⬇ Export** writes the whole tracker state (fixes + Fixed-on times, verdicts +
  last-tested times, notes) as JSON; **⬆ Import** loads such a file (merges by entry, then reloads,
  host-checked); **💾 Save copy** bakes the state into a self-contained HTML via a
  `window.__CW_TRK_SEED__` island injected before `</head>` (primed on open by `seedFromCopy()`;
  `rawGet` falls back to the seed where `file://` storage is blocked). Because the tracker template is
  embedded in the report's template literal it must stay backtick/`${}`/**backslash**-free, so the
  seed's `<`→escape uses `String.fromCharCode(92)` rather than a literal backslash. Verified with 18/18
  DOM-stub assertions (innerHTML-parsing harness) incl. a `</script>`-in-key/value round-trip; template
  stays constraint-clean; existing triage/share/tracker suites pass.
  (Prior step — AD-032 — brought the main report's Broken/Working verdict + Last-tested timestamp onto
  the tracker.)

- **prior_step**: Brought the main report's triage onto the **fix tracker** (2026-06-25,
  AD-032). Each broken-link row in the exported tracker now has a **Last tested** timestamp and a
  mutually-exclusive **Broken / Working** verdict pair (matching the main report), beside the existing
  **Fixed** box. The verdict + timestamp are **baked into the tracker's data island at export** (read
  from the report's `cwbroken:`/`cwok:`/`cwts:` localStorage) and stay editable in the standalone file
  (persisted in its own `cwfix:host:` namespace under `vd:`/`vt:`): ticking auto-stamps the time, the
  boxes are exclusive, and the verdict is **synced per URL** across every referrer row it appears in.
  The per-page note field was retitled from "who to contact…" to a generic **Notes**. The tracker
  template stays backtick/`${}`/backslash-free. Verified with 15/15 DOM-stub assertions (a minimal
  innerHTML parser lets the real tracker wiring run); existing triage/share/tracker-export suites pass.
  (Prior step — AD-031 — made the in-report allowlist export UI opt-in / off by default.)

- **prior_step**: Made the in-report **allowlist export UI opt-in / off by default**
  (2026-06-25, AD-031). The pick checkboxes + Select-all + **Export to allowlist…** / **Copy lines**
  on the two Errors tabs now appear only with the new `--allowlist-export` flag (`cfg.allowlistExport`;
  GUI Options checkbox *Allowlist export tools in report (legacy)*, unchecked by default) — the fix
  tracker and Broken/Working verdict tools have superseded it. Reading an allowlist as **input**
  (`--allowlist FILE`) and the **Suppressed** tab are unchanged; only the report's *export* affordance
  is suppressed. Column widths were made class-based (`.pickcol`/`.tscell`/`.tcol`/`.urlcol`) so the
  table holds with or without the pick column (header/row counts verified in sync both ways). Touches
  report.js + cli.js (`--allowlist-export`/`--no-…`, help) + crawl-gui.hta (checkbox wired into all
  three command builders; generic config-file support). Verified; existing triage/share/fix-tracker
  tests still pass.
  (Prior step — AD-030 — added the Share-your-testing-verdicts toolbar.)

- **prior_step**: Added a **Share your testing verdicts** toolbar (2026-06-25, AD-030)
  because triage verdicts live in localStorage and don't travel when the report `.html` is emailed.
  Above the tabs (final report, shown only when there's something to triage): **💾 Save shareable
  copy** bakes the current Broken/Working verdicts + timestamps into a new self-contained report
  (a `window.__CW_SEED__` island injected before `</head>`; on open it primes the recipient only
  if they have no verdicts yet, and `getF`/`getS` fall back to the seed where `file://` localStorage
  is blocked); **⬇ Export / ⬆ Import verdicts** move them as a small JSON (import merges by link
  then reloads; host-checked). Seed JSON is `<`-escaped so a `</script>`-bearing URL can't break out.
  Verified: 19/19 share DOM-stub assertions + the escape round-trip; triage (38) + fix-tracker (6)
  still pass; all 7 embedded scripts parse.
  (Prior steps — AD-028 unified triage into mutually-exclusive Broken/Working; AD-029 added the
  Last-tested timestamp column.)

- **resume_instructions**:
  1. Read `rhiz-memory/state/SESSION_HANDOFF.md` for full context.
  2. Read `rhiz-memory/state/decisions.md` — the ADR **index**; bodies are in `decisions/` (migration
     + engine in `AD-001-016.md`, report/triage/sharing in `AD-017-onward.md`).
  3. Pick up `next_action`.

---

## Provenance

Created 2026-06-24 during the broodforge → charlotte crawler migration.
