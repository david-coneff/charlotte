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

- **last_completed_step**: GUI now loads **multiple default Start URLs** from an
  optional `crawl-gui-domains.txt` beside `crawl-gui.hta` (2026-06-24, AD-010 — one URL
  per line; each becomes a row; parsing verified; `.example` template ships). Before
  that: extracted the report/output layer out of `crawl.js` into a sibling
  **`report.js`** (AD-009) — `buildReport`/`writeOutputs`/`buildIndexReport`/
  `writeCombinedJson` + caps/branding/`esc`; `crawl.js` 1,861→1,301 lines, report output
  **byte-for-byte identical** to pre-split. Earlier: fix tracker (AD-008), report
  features (AD-007), migration (AD-001…AD-006). All committed and pushed; broodforge
  branch deletion remains an operator action (session is 403-blocked from it).

- **resume_instructions**:
  1. Read `rhiz-memory/state/SESSION_HANDOFF.md` for full context.
  2. Read `rhiz-memory/state/decisions.md` for the migration ADRs.
  3. Pick up `next_action`.

---

## Provenance

Created 2026-06-24 during the broodforge → charlotte crawler migration.
