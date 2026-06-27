# Session Handoff — Charlotte

The durable, self-contained "what a cold reader needs to resume Charlotte's development" record.
This page stays **short and current**; the blow-by-blow lives in the ADR log and the retrospective,
which it points to (it is NOT a second copy of them).

---

- **status** (2026-06-27): Charlotte is **mature and actively refined**. The crawler engine, the
  self-contained HTML **crawl report**, and the standalone **fix tracker** are all in service on
  branch **`claude/festive-cerf-7loovw`** (pushed). The latest arc was a long, operator-driven
  **ergonomics + workflow pass** on the report and tracker (AD-053–077). All maintained test suites
  pass: **244/0** (DOM-stub + headless-Chromium probes — see SYNTHESIS §6).

- **what Charlotte is**: a zero-dependency (Node built-ins only; Playwright optional) single-domain
  crawler that maps a site, verifies links (incl. inside PDF/Office docs), and writes a
  self-contained HTML report you open from `file://`. Charter + design principles: `_instance.md`.

- **where the detail lives** (do not duplicate it here):
  - **Decisions** — `state/decisions.md` is an ADR **index**; bodies live in five range files under
    `decisions/`: `AD-001-016` (migration + engine), `AD-017-034` / `AD-035-052` (report rendering,
    triage, sharing, report internals), `AD-053-065` (ergonomics), `AD-066-081` (theme → batch
    delegation → consolidation/migration → partitioning/charter). Every behavior change is one AD
    with its verification. (Re-partitioned 2026-06-27, AD-080 — the old `AD-017-onward.md` was 1,576
    lines.)
  - **Retrospective** — `state/SYNTHESIS.md`: capability inventory (§2), what worked (§4), the
    **hard-won lessons** (§5, themed index up top — read before touching the relevant area),
    testing approach (§6), open threads (§7).
  - **Reference docs** — the full suite reference is partitioned under `CRAWLER/` (a rhiz-Merkle DAG;
    **start at [`CRAWLER/CRAWLER_index.md`](../../CRAWLER/CRAWLER_index.md)** — root `CRAWLER.md` is a
    pointer stub; AD-080). `README.md` (quick start). Verify the DAG with
    `doc-graph.py verify CRAWLER/CRAWLER_index.json`; reassemble with `doc-graph.py merge`.

- **the two surfaces, in one line each**:
  - **Crawl report** (`report.js` + `report-templates.js`): broken-over-total stat matrix with a
    Referrer-pages-with-broken-links card + amber→green triage outlines; three triage tabs
    (Broken·internal/external + Blocked) with per-link **Broken/Working** verdicts; non-triage tabs
    (Internal/External/Out-of-scope) folder/host-grouped; every grouped table drag-resizable; one
    reused side-docked **satellite window** for testing any link; light/dark theme.
  - **Fix tracker** (`report-templates.js` `TRACKER_TEMPLATE`): a self-contained, exported checklist.
    Internal + external worked **together** (Type column), grouped **By page** / **By broken link**
    under folder/domain parents; inverted Fixed/Broken stat matrix incl. a **Pages** column;
    resizable columns; bulk **per-page / per-subfolder** mini-tracker export for delegation; multi-file
    Import + a Power-Automate consolidation path (`merge-fix-state.js`, `SHAREPOINT-MERGE.md`).

- **the hard constraint a cold reader WILL trip on**: `TRACKER_TEMPLATE` and `NEWWIN` are strings
  later embedded as a JSON literal, so they must contain **no backtick, no `${}`, no backslash**
  (emit `"` via `String.fromCharCode(34)`, backslash via the `BS` var, glyphs literally) AND **no
  inner IIFE** (the test harness slices on the first `})();`). After any template edit: run the
  `0/0/0` substring guard + a `new Function(TPL.slice(iife))` parse-check, and **regenerate
  `synth.html`** before testing. (SYNTHESIS §5 #7/#15/#21/#23/#30.)

- **active_risks / blockers**: none to the tool.

- **charter change (2026-06-27, AD-081)**: the "no build / zero-install" directive was relaxed — a
  **build-time roll-up is now permitted** (Vite/rollup, per rhizome DS-002) so source can be small
  modules while the deliverable stays a single zero-install file. Runtime invariants are unchanged
  (the shipped file still runs on Node built-ins; build tools are `devDependencies` only). See
  `_instance.md` charter MAY clause.

- **next_action**: the **recommended next step** is to act on AD-081 — split the large single-file
  product code (`report.js` ~1,136 L, `report-templates.js` ~537 L) into small `src/` modules behind a
  **Vite single-file roll-up** (rhiz-Partition modality B / DS-002), preserving byte/behaviour
  equivalence and the 244/0 suite, and **keeping the `TRACKER_TEMPLATE`/`NEWWIN` no-backtick/`${}`/
  backslash/inner-IIFE constraints** intact through the build. Do it as its own verified pass.
  Other open housekeeping: (a) the browser toolchain (`web-crawler.html`) still lacks the
  triage/tracker UX; (c) open threads in SYNTHESIS §7. (Item (b), partitioning the ADR log, is **done**
  — AD-080.)

- **resume_instructions**:
  1. `_instance.md` (identity + charter + the template constraint).
  2. `state/RESUME_BLOCK.md` (one-screen current save-state).
  3. `state/SYNTHESIS.md` §5 lessons (themed index) before touching report/tracker code.
  4. `state/decisions.md` for the specific AD behind anything you're changing.

---

## Provenance

Created 2026-06-24 during the broodforge → charlotte migration; **rewritten 2026-06-27** to drop the
stale migration framing and the redundant milestone log (both fully captured in the ADR log) and to
reflect the matured report/tracker. The broodforge-branch cleanup that earlier sessions tracked here
is moot and was removed.
