# Project Resume Block — Charlotte

One-screen save-state for Charlotte's development continuity. (Detail lives in
`SESSION_HANDOFF.md`, the ADR log `state/decisions.md`, and the retrospective `state/SYNTHESIS.md` —
this page is the index card, not a copy.)

---

- **project_identity**: Charlotte — a standalone, zero-dependency (Node built-ins; Playwright
  optional) single-domain website crawler. Maps a site, verifies links (incl. inside PDF/Office
  docs), writes a self-contained HTML report opened from `file://`, plus a standalone fix tracker.

- **active_objective**: Mature the self-contained **crawl report + fix tracker** for real
  broken-link-cleanup workflows at scale, without breaking the zero-dependency / open-from-`file://`
  properties. Operator-driven, one refinement at a time.

- **active_milestone**: **Report & tracker workflow pass** (2026-06-27, AD-053–077) on branch
  `claude/festive-cerf-7loovw`. All maintained suites **244/0**.

- **recent arcs** (newest first — full detail = the AD numbers in `decisions.md`):
  - **Tracker columns drag-resizable** (AD-077) and **internal/external merged into one view** with a
    Type column (AD-076) — fixing is page-centric, so the int/ext tab is gone.
  - **Report**: a **Referrer-pages-with-broken-links** stat card replacing the legend (legend moved
    upper-right), satellite reuse broadened to **any link on any tab**, "tested"→**"triaged"**
    wording, "Broken internal/external destinations" labels (AD-075).
  - **Tracker workload + delegation**: distinct-referrer-page subtitle + skipped-count (AD-074), a
    **Pages** stat column, **per-page / per-subfolder** bulk mini-tracker export (AD-072/074),
    multi-file Import + the Power-Automate consolidation path (AD-073, `merge-fix-state.js`,
    `SHAREPOINT-MERGE.md`).
  - **Export ergonomics**: Save-As **picker** for all exports + auto **timestamped** filenames
    (AD-069/070); adaptive percentages (AD-071); inverted Fixed/Broken **stat matrix** (AD-068);
    two-level folder/domain **nesting** (AD-067); **light/dark theme** (AD-066).
  - Earlier this arc (AD-053–065): stats-as-matrix, folder/host grouping on every tab,
    collapsible tracker sections, drag-resizable **viewport height** + **columns**. (See SYNTHESIS §5
    for the lessons these produced — `max-height` vs `height`, the `min-width:0` resize fix, etc.)

- **active_risks / blockers**: none.

- **2026-06-27 housekeeping** (AD-078–081): memory consolidated; the 12 universal principles
  **promoted into `david-coneff/rhizome`** (AD-079); the ADR log + `CRAWLER.md` **partitioned** via
  rhiz-Partition (AD-080 — ADR ranges + a `CRAWLER/` rhiz-Merkle DAG); and the **charter relaxed to
  permit a build-time roll-up** (AD-081, DS-002).

- **next_action**: recommended next step — act on AD-081: split `report.js`/`report-templates.js` into
  small `src/` modules behind a **Vite single-file roll-up** (rhiz-Partition modality B), preserving
  byte/behaviour equivalence, the 244/0 suite, AND the template constraints. Then: browser-toolchain
  parity; SYNTHESIS §7 threads. (Partitioning the ADR body file is done.)

- **gotcha to load FIRST before editing report/tracker code**: the template strings are
  backtick/`${}`/backslash/inner-IIFE-free (embedded as JSON; the test harness slices on `})();`).
  Run the `0/0/0` guard + IIFE parse-check + regenerate `synth.html` before testing. SYNTHESIS §5.

- **resume_instructions**:
  1. `SESSION_HANDOFF.md` (full current context).
  2. `state/SYNTHESIS.md` §5 lessons (themed) before touching report/tracker code.
  3. `state/decisions.md` for the specific AD behind whatever you're changing.

---

## Provenance

Created 2026-06-24 during the broodforge → charlotte migration; **rewritten 2026-06-27** to a current
one-screen state (was an append-log of prior steps stale at AD-065/170-0; that history is the ADR log).
