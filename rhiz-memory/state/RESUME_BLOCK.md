# Project Resume Block — Charlotte

One-screen save-state for Charlotte's development continuity.

---

- **project_identity**: Charlotte — a standalone website/domain crawler. Maps a
  single site (every internal link + recorded first-tier external links),
  verifies links including those inside PDF/Office documents, and writes a
  self-contained HTML report. Two independent toolchains (Node CLI + Windows GUI
  + headless verifier; in-browser variant + CORS proxy). Zero-dependency core
  (Node built-ins only); Playwright is optional and used only by `crawl-render.js`.

- **active_objective**: The crawler is stood up as its own repo (migration done). Work is now an
  operator-driven **ergonomics pass** on the self-contained report + fix tracker — make a
  multi-thousand-destination crawl scannable and tunable without breaking the zero-dependency /
  open-from-`file://` properties. Landed through AD-065.

- **active_milestone**: **Report & tracker ergonomics at scale** (2026-06-27, AD-053–065) on branch
  `claude/festive-cerf-7loovw`. All maintained DOM-stub + headless suites 170/0.

- **active_risks**: None to the tool itself.

- **blockers**: None.

- **next_action**: None pending. Branch `claude/festive-cerf-7loovw` is pushed through AD-065;
  await the next operator refinement. (The migration-era broodforge branch cleanup is moot.)

- **last_completed_step**: **Report & tracker ergonomics at scale** (2026-06-27, AD-053–065). The
  headline stats became a broken-over-total matrix with adaptive percents + a legend card (AD-053–057).
  **AD-061** folder/host-grouped the NON-triage tabs (Internal/External/Out-of-scope) via
  `simpleGroups(items,keyOf,head,rowFn,tcls)` — same `.domgrp` collapsible + `.groupview` viewport as the
  triage tabs, `keyOf`=`folderOf`/`hostOf`. **AD-062** gave the fix tracker collapsible sections, a K/N
  fixed counter, a completion outline, Expand/Collapse-all, a fixed-height viewport, and group-level
  pagination (50/page). **AD-063→064** made viewports drag-resizable in HEIGHT and fixed the grip that
  could only shrink by switching `max-height`→ definite `height` (SYNTHESIS lesson #13). **AD-064** added
  the **All: Fixed** bulk box (KEEPING the Broken/Working verdicts — the operator reversed an initial
  "remove them" ask; reverted via `git checkout` and re-applied additively, lesson #18), stacked the
  tracker header for long URLs, cleared the amber when all links are fixed *or* working (no green outline),
  and moved the pager ABOVE the scroll viewport. **AD-065** extended drag-resizable COLUMNS to the
  non-triage tabs (`table.grptbl` + a self-contained resize IIFE — the triage resize bails when there are
  no `data-url` rows, lesson #16), removed ALL minimum column widths (blanket `min-width:0`, grip floor
  40→16), and folded the lengthy per-tab help into a "How this tab works" `<details>`. Verified headlessly
  (resize broadcast/persist/reset, resolve-by-working, pager-outside, definite-height); SYNTHESIS §4/§5
  updated with code examples (lessons #13–20). Suites 170/0.

- **prior_step**: **Triage polish — untested-domain highlight, popup interstitial, drop report-side
  Fixed box** (2026-06-26, AD-048–052). Domain grouping generalized to the Blocked tab with richer
  headers (All: Broken/Working bulk pair, Mixture + all-tested indicators, tested K/N counter); "Internal
  pages"→"Internal destinations"; **AD-049** persisted crawl settings in the JSON so a rebuild/re-check
  rewrite shows the real config line (not the rewrite process's CLI defaults); **AD-050** dashed-amber
  header on any group with untested links; **AD-051** blob: popup interstitial naming the next link;
  **AD-052** removed the per-referrer Fixed box from the base report (fix-tracking lives in the tracker).
  All suites green.

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
