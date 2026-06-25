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

- **last_completed_step**: Made the in-report **allowlist export UI opt-in / off by default**
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
  2. Read `rhiz-memory/state/decisions.md` for the migration ADRs.
  3. Pick up `next_action`.

---

## Provenance

Created 2026-06-24 during the broodforge → charlotte crawler migration.
