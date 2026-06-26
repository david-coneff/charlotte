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

- **last_completed_step**: **Report triage UX batch — domain grouping, nomenclature, config-line fix**
  (2026-06-26). (a) **AD-048 — domain grouping generalized to the Blocked·uncertain tab** (was
  Errors·external only) via a shared `domainGroups(arr, scope, headHtml, cellsFn)`; each per-domain
  header now has an **All: Broken / Working** bulk pair, a disabled **Mixture of broken/working**
  indicator, a disabled **all tested** indicator, and a live **"tested K/N · B broken · W working"**
  counter visible while collapsed. Rows + every control carry `data-domain` AND `data-scope`; the IIFE
  wiring (`rowsInDomain`/`domCtl`/`deriveDomain`/`applyDomain`) is generalized and `wireDomains()` loops
  both tabs. (b) **"Internal pages" → "Internal destinations"** stat card + tab + multi-site row + --help,
  for nomenclature consistency (destination = unique URL; instance = one link occurrence). data-tab /
  panel ids stay `internal`. (c) **AD-049 — crawl settings persisted in the JSON** so a `--rebuild-from`
  / `--recheck-from` REWRITE shows the real config line instead of the rewrite process's CLI defaults
  (the GUI "Rebuild report" passes no tuning flags; "Re-check" only some — so a 2/3000/1/no-limit crawl
  was shown as 4/100/no-rps/200/3). `effSettings(state,cfg)` prefers `state.settings` (restored by
  `loadStateFromJson` from a new `settings` block in `buildReportJson`, Infinity↔null) over cfg; live cfg
  still drives the re-probe; old JSONs fall back gracefully. Verified: cfgtest (19 asserts) + real CLI
  `--rebuild-from` shows `2 concurrent · 3000ms · 1 rps cap · max unlimited pages / depth unlimited`;
  domtest/vtest/sharetest/revtest/newwin all pass.
  (Prior step — **AD-044** Requests stat = internal pages crawled + external destinations verified;
  **AD-045** GUI sizes its window to content on open; **AD-046** configurable pagination breakpoint
  (`--page-size` + GUI dropdown); **AD-047** fix tracker reverse mapping (By page / By broken link) with
  synced Fixed flags.)
  (Earlier — **AD-039–AD-043**: satellite link-window reuse, fixed-layout triage tables, live broken-
  destination stats, re-check GUI integration with Pause/Stop + separate `*.recheck.json`, and the
  initial Errors·external domain grouping.)

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
