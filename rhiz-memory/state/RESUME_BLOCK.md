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

- **last_completed_step**: Added + verified crawler **report features**
  (2026-06-24, AD-007): selectable broken-link → allowlist export on the Errors
  tabs, a Runtime headline stat, and Charlotte branding + 🕸️ favicon; committed
  and pushed. Earlier: migrated the crawler + `rhiz-memory/` instance to
  `claude/festive-cerf-7loovw`; broodforge branch deletion is blocked from this
  session (403) and left to the operator.

- **resume_instructions**:
  1. Read `rhiz-memory/state/SESSION_HANDOFF.md` for full context.
  2. Read `rhiz-memory/state/decisions.md` for the migration ADRs.
  3. Pick up `next_action`.

---

## Provenance

Created 2026-06-24 during the broodforge → charlotte crawler migration.
