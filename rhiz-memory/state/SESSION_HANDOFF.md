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
  - **Decisions** — `state/decisions.md` is an ADR **index**; bodies in `decisions/AD-001-016.md`
    (migration + engine) and `decisions/AD-017-onward.md` (report / triage / sharing / tracker;
    AD-017–077). Every behavior change is one AD with its verification.
  - **Retrospective** — `state/SYNTHESIS.md`: capability inventory (§2), what worked (§4), the
    **hard-won lessons** (§5, themed index up top — read before touching the relevant area),
    testing approach (§6), open threads (§7).
  - **Reference docs** — `CRAWLER.md` (full suite reference), `README.md` (quick start).

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

- **next_action**: none pending — await the next operator refinement. Candidate housekeeping when
  convenient: (a) the browser toolchain (`web-crawler.html`) still lacks the triage/tracker UX;
  (b) `decisions/AD-017-onward.md` has grown to ~60 ADRs and could be partitioned again per the
  index's own convention; (c) open threads in SYNTHESIS §7.

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
