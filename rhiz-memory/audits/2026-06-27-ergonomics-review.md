# Rhizome review — report & tracker ergonomics arc (AD-053–065)

**Date:** 2026-06-27 · **Scope:** `report.js` + `report-templates.js`, the AD-061–065 changes
(non-triage folder grouping, fix-tracker collapsible sections / All:Fixed / pager / resolved-amber /
pagination, resizable viewports + columns, no-min-width, collapsible help). **Goal:** coherence issues
and undiscovered bugs.

**Method:** self-review + memory↔code coherence grep pass + two independent adversarial reviewers (one
per file) that read the source, ran `node --check`, and exercised the rendered HTML under the DOM-stub
harness and real headless Chromium across final / partial / empty / scoped fixtures. All confirmed
behaviours below were measured, not assumed.

## Findings & disposition

| # | Sev | Area | Finding | Status |
|---|-----|------|---------|--------|
| 1 | bug | report.js resize | `resetCols` cleared the grptbl columns' INLINE default widths, so "Reset column widths" collapsed non-triage columns to content width (`64,380,320,96,64,64`→`64,72,…`) until reload. Triage was immune (its defaults are CSS classes). | **FIXED** — moved grptbl defaults inline→panel-scoped CSS (`#panel-internal/.external/.outscope .grptbl th:nth-child`); reset now reverts to them (measured `afterReset=64,380,320,96,64,64`). |
| 2 | bug (latent) | report.js class helpers | `(' '+cn+' ').split(' '+c+' ').join(' ').replace(/^\s+\|\s+$/g,'')` — the `\s` is collapsed to `s` by the OUTER template literal, so the trim matched the letter "s", not whitespace. Harmless (membership checks are space-tolerant) but classNames accrued stray edge spaces. 5 sites incl. pre-existing `setStat/setTestState/setInd/setCls`. | **FIXED** — replaced the regex trims with `.trim()` (ES5-safe, no escaping trap); emitted report has 0 broken `/^s+/`, className stays clean (measured `len==trimmedLen`). |
| 3 | coherence | report.js CSS | Dead `.pagestbl` rules + a stale comment — the internal table is `grptbl` now, `pagestbl` is applied to nothing. | **FIXED** — deleted the 6 dead rules + corrected the comment. |
| 4 | coherence | report.js CSS | Definite `height:460px` on the flat `.tablewrap` forced a tall, mostly-empty box on SHORT flat tables (Suppressed / log / read-only fallback). Intended for the big grouped viewports, wrong for these. | **FIXED** — flat `.tablewrap` back to content-sized `max-height:460px` (keeps the resize grip); the big lists keep `.groupview{height:460px}` for unbounded grow. |
| 5 | nit | report-templates.js | `rowsForUrl` orphaned (no call sites) after the verdict revert-and-readd. | **FIXED** — deleted. |

## Clean — verified, nothing wrong

- **Tracker (report-templates.js)**: constraint compliance (0 backticks/`${}`/backslashes; literal ▼/▶;
  clean JSON round-trip through the `__CW_TPL__` island), `refreshGroup`/`rowWorking` amber in BOTH views,
  `bulkFix` + All:Fixed checked/indeterminate transitions, pagination (50/page, reset on grouping switch,
  per-tab page retained on tab switch, pager outside `#view-*`, absent at exactly 50), no
  `classList`/`closest`/`dataset`, `.trkview` height/scroll. Existing `tracker3-test` (18) passes.
- **Report (report.js)**: the two resize IIFEs don't collide (disjoint selectors `haspick/blkpick` vs
  `grptbl`, separate `cwcol:host:scope` namespaces, separate IIFE scopes so the duplicate `HOST`/`L()` are
  fine); `.colreset` vs `.grpcolreset` are disjoint and not cross-wired; nested found-on / `.dombody`
  resolve to `height:auto;resize:none` (no grip, no forced height); per-tab `th`/`td` counts match;
  pagination coexists with `.grptbl`; partial/empty/scoped reports don't throw and the triage IIFE still
  bails on `tr[data-url]`.
- **Memory↔code coherence**: every claim in SYNTHESIS lessons #13–20, ADRs AD-061–065, and CRAWLER.md
  matches the shipped code (definite `height` w/ no stray `max-height`, the triage-bail + selector split,
  blanket `min-width:0` + `16px` grip floor in both IIFEs, all three reset buttons, the tracker
  pager-outside-scroll wrappers).

## Residual / notes

- Stale SCRATCHPAD probes (`trk-build.js`) still look for the removed green `alldone` class and an
  in-panel pager — they're obsolete test scaffold, NOT product regressions (the product replaced green
  with "amber disappears" and moved the pager to `.pagerbar`).
- No persistent regression test covers the non-triage column resize / helpBox; they're verified by ad-hoc
  headless probes. (Acceptable given the zero-dep, no-framework testing ethos; flagged for awareness.)

**Net:** 4 real defects (1 user-visible, 1 latent-correctness, 2 coherence) + 1 nit found and fixed; the
tracker logic and the cross-feature interactions are otherwise coherent and bug-free. Full suite 170/0
after fixes.
