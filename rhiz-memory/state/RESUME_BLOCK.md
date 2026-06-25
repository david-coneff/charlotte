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

- **last_completed_step**: Added opt-in client-side report pagination (2026-06-25,
  AD-018) — an off-by-default `--paginate` flag (+ GUI checkbox "Paginate report
  (1,000 links/page)") shows each large report table **1,000 rows at a time** with
  Prev/Next + a Go-to-page box, so a report with tens of thousands of links stays
  responsive. All rows stay embedded; pagination is **display-only**, so selection, the
  allowlist export, and the fix-tracker export still act on every row. Verified by
  DOM-stub (2,500-row table pages 1,000 at a time, Next/Prev/jump correct; ≤1,000-row
  tables get no pager); default report is unchanged but for 3 inert CSS lines. Before
  that: Removed the report's per-table render cap (2026-06-25,
  AD-017) — `RENDER_CAP` 5,000→`Infinity` in `report.js`, so the HTML report renders
  **every** row in each table instead of truncating at 5,000 (the overflow used to be
  JSON-only). An operator hit this; they chose to remove the cap and accept larger HTML
  on big crawls (~280 bytes/link). Verified a 6,000-link fixture renders all 6,000 rows
  with no cap note; small reports unaffected. Before that: Partitioned `crawl.js` further (2026-06-25, AD-016) —
  1,013→**625 lines** by extracting `cli.js` (arg parsing + `--help` + `die`),
  `netutil.js` (rate limiter, adaptive backoff, Retry-After + robots crawl-delay, url
  helpers), and `recheck.js` (the `--recheck-from` mode). Byte-preserving; a deterministic
  crawl is byte-identical (HTML + JSON) vs the pre-split version; help/die/recheck/
  multi-site/resume all verified. The ~450-line stateful crawl engine stays in `crawl.js`
  as the irreducible core (deliberately not split). Before that: Completed the resume
  feature (AD-015) — poison-URL
  quarantine (a page that crashes the crawler across ≥2 resume sessions is blocked, not
  retried), truncate-on-fresh journals, and a GUI **Resume crawl** button (verified).
  Before that: Partitioned `crawl.js` (1,480→998 lines) into leaf modules
  **`parse.js`** (link extraction) / **`fetch.js`** (HTTP) / **`log.js`** (log+journal) /
  **`seen.js`** (dedup) — byte-preserving; a deterministic crawl is byte-identical (HTML
  + JSON) vs the pre-split version, resume/multi-site/recheck verified (2026-06-25,
  AD-014). The tool stays zero-dependency `require()` modules (no bundler). Before that:
  Fixed Pause being ignored during the external-check /
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
