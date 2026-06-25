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

- **last_completed_step**: Fixed Pause being ignored during the external-check /
  second-pass loops (now honored like the main worker, verified), and added on-demand
  broken-link re-check `--recheck-from <report.json>` — re-probes just the flagged
  links with the current settings and rewrites the report with the record corrected +
  de-duplicated (links that now resolve are dropped; AD-013, verified). Added the GUI
  **Re-check broken links** button (JScript syntax-verified; the HTA is Windows-only and
  wasn't run here). **Still pending:** a GUI "Resume" button and poison-URL quarantine. Earlier: added **resumable crawls** — `--state FILE` writes an
  append-only JSONL journal (discoveries + completions, synchronous so a `kill -9` is
  safe) and `--resume FILE` replays it to rebuild the frontier + results and continue
  with **zero re-crawl** (single + multi-site; 2026-06-25, AD-012). Verified by a real
  SIGKILL mid-crawl and a truncation test (final coverage identical to uninterrupted,
  no page crawled twice). **Next on this feature:** poison-URL quarantine (the journal
  already records `v` attempt events) and a GUI "Resume" command on error. Earlier work:
  the External-links expand/collapse toggle (2026-06-25, AD-011 — scoped to
  `#panel-external`, label re-syncs to state, DOM-stub verified). Recent prior work: GUI
  multi-domain defaults via `crawl-gui-domains.txt` (AD-010); report/output layer split
  into a sibling **`report.js`** (AD-009; `crawl.js` 1,861→1,301 lines, output
  byte-for-byte identical); the fix tracker (AD-008); report features (AD-007: allowlist
  export, runtime, branding); and the migration (AD-001…AD-006). All committed and
  pushed; broodforge branch deletion remains an operator action (session is 403-blocked
  from it).

- **resume_instructions**:
  1. Read `rhiz-memory/state/SESSION_HANDOFF.md` for full context.
  2. Read `rhiz-memory/state/decisions.md` for the migration ADRs.
  3. Pick up `next_action`.

---

## Provenance

Created 2026-06-24 during the broodforge → charlotte crawler migration.
