# Architecture Decisions — Charlotte (index)

Architecture Decision Records for Charlotte. The full text is partitioned into the files under
[`decisions/`](decisions/) to keep this log scannable; this page is the index. **Add a new decision**
by appending its body to the latest range file in `decisions/` and adding a one-line row here.

### [AD-001 – AD-016 · Migration, engine partitioning & resume](decisions/AD-001-016.md)

- **AD-001** (2026-06-24) — Migrate the crawler into its own repository
- **AD-002** (2026-06-24) — Flatten to repository root
- **AD-003** (2026-06-24) — Keep both toolchains
- **AD-004** (2026-06-24) — Add standalone-repo scaffolding (`package.json`, `README.md`, `.gitignore`)
- **AD-005** (2026-06-24) — Adopt the Rhizome memory convention
- **AD-006** (2026-06-24) — Preserve tool source byte-for-byte
- **AD-007** (2026-06-24) — Report enhancements — branding, runtime, and selectable allowlist export
- **AD-008** (2026-06-24) — Per-referrer fix checkboxes + standalone "fix tracker" export (with notes)
- **AD-009** (2026-06-24) — Extract the report/output layer into report.js
- **AD-010** (2026-06-24) — GUI default Start URLs via crawl-gui-domains.txt
- **AD-011** (2026-06-25) — Expand/collapse-all toggle for the External-links domain sections
- **AD-012** (2026-06-25) — Resumable crawls via an append-only journal (`--state` / `--resume`)
- **AD-013** (2026-06-25) — Re-check broken links on demand (`--recheck-from`)
- **AD-014** (2026-06-25) — Partition crawl.js into leaf modules (parse / fetch / log / seen)
- **AD-015** (2026-06-25) — Complete the resume feature — poison-URL quarantine + GUI Resume button
- **AD-016** (2026-06-25) — Partition crawl.js further — cli / netutil / recheck modules

### [AD-017 – onward · Report rendering, triage & sharing](decisions/AD-017-onward.md)

- **AD-017** (2026-06-25) — Remove the report's per-table render cap
- **AD-018** (2026-06-25) — Opt-in client-side report pagination (`--paginate`, 1,000/page)
- **AD-019** (2026-06-25) — Uncap the "found on" referrer list + paginate it
- **AD-020** (2026-06-25) — Live re-tuning of a running crawl (`--tune-file`)
- **AD-021** (2026-06-25) — "Link instances" headline metric (total link occurrences, not deduped)
- **AD-022** (2026-06-25) — Fix `--recheck-from` on a multi-site index (was wiping the report)
- **AD-023** (2026-06-25) — Broken-link triage workflow in the report (all in report.js)
- **AD-024** (2026-06-25) — Rebuild a report from saved JSON (`--rebuild-from`) + GUI button
- **AD-025** (2026-06-25) — Manual-testing triage on the Blocked tab (confirm-broken → header + tracker)
- **AD-026** (2026-06-25) — GUI — pagination on by default + a config file for option defaults
- **AD-027** (2026-06-25) — Report wording — "destinations" (unique) vs "hyperlink instances" (occurrences)
- **AD-028** (2026-06-25) — Unified Broken/Working triage — explicit "Broken" confirm, mutually exclusive
- **AD-029** (2026-06-25) — "Last tested" timestamp column on the triage tabs
- **AD-030** (2026-06-25) — Share testing verdicts (export/import JSON + bake-into-copy)
- **AD-031** (2026-06-25) — Allowlist EXPORT UI in the report is now opt-in (off by default)
- **AD-032** (2026-06-25) — Fix tracker carries last-tested timestamp + main-report-style verdict UI
- **AD-033** (2026-06-25) — Fix tracker — "Fixed on" timestamp + shareable state (export/import + bake-a-copy)
- **AD-034** (2026-06-25) — Keep auto-save-to-localStorage; no File System Access "Save to file" (docs-only)
- **AD-035** (2026-06-26) — GUI resume — seed live counters from a "# resume-stats" marker
- **AD-036** (2026-06-26) — Extract NEWWIN + TRACKER_TEMPLATE into report-templates.js
- **AD-037** (2026-06-26) — Partial reports were zeroing the “Broken hyperlink instances” header
- **AD-038** (2026-06-26) — External tab: two Expand/Collapse buttons instead of a single toggle
- **AD-039** (2026-06-26) — Satellite link-window reuse via a held JS reference (not name targeting)
- **AD-040** (2026-06-26) — Triage tables: `table-layout:fixed` so the timestamp column stops starving Reason
- **AD-041** (2026-06-26) — Re-check: GUI live progress + Pause/Stop + a separate `*.recheck.json` written first
- **AD-042** (2026-06-26) — Live “Broken · internal/external” destination stats update during triage
- **AD-043** (2026-06-26) — Errors·external grouped by domain + a domain-level Broken/Working bulk verdict
- **AD-044** (2026-06-26) — “Requests” stat = internal pages crawled + external destinations verified
- **AD-045** (2026-06-26) — GUI sizes its window to the content on open (adaptive, both tabs)
- **AD-046** (2026-06-26) — Configurable report pagination breakpoint (--page-size + GUI dropdown)
- **AD-047** (2026-06-26) — Fix tracker: reverse mapping (By page / By broken link) with synced Fixed flags
- **AD-048** (2026-06-26) — Domain grouping generalized to Blocked tab + richer header (All:/Mixture/all-tested/counter)
- **AD-049** (2026-06-26) — Persist crawl settings in the JSON so a rebuild/re-check rewrite shows the real config line
- **AD-050** (2026-06-26) — Dashed-amber header outline on per-domain groups with untested links (clears when all tested)
- **AD-051** (2026-06-26) — Satellite popup shows a blob: interstitial naming the next link before it loads
- **AD-052** (2026-06-26) — Remove the per-referrer "Fixed" checkbox from the base report (fix-tracking lives in the tracker)
- **AD-053** (2026-06-26) — Unify fix-tracker export (include all untested incl. blocked, drop only Working) + one always-visible button
- **AD-054** (2026-06-26) — Stats row: green/amber test-completeness outline on the broken stats, broken-first order, "Total unique destinations" (supersedes the Requests stat, AD-044)
- **AD-055** (2026-06-26) — Stats as a broken-over-total matrix (2 rows × 5 cols), + "Total unique destinations broken"; Runtime/Suppressed to the header line
- **AD-056** (2026-06-26) — Each broken stat shows count + live "(percent)" of the total directly below it (one-decimal, then adaptive precision)
- **AD-057** (2026-06-26) — Blocked·uncertain gets the green/amber tested-outline; a grey legend card keys the colors
- **AD-058** (2026-06-27) — Triage tables size to content (no mid-table gap) + drag-resizable columns (persisted, broadcast across domain groups); + Found-on overflow fix
- **AD-059** (2026-06-27) — Broken·internal grouped by first-level path folder (reuses the domain-grouping infra via a keyOf)
- **AD-060** (2026-06-27) — Consistent fixed-height internal-scroll viewport across all tabs (.groupview wraps grouped lists)
- **AD-061** (2026-06-27) — Non-triage tabs (Internal destinations / External / Out-of-scope) use the same folder/host-grouped `.domgrp` collapsibles (count per section, Expand/Collapse-all), via a `simpleGroups` helper
- **AD-062** (2026-06-27) — Fix tracker gets the report's grouping affordances: collapsible sections, per-group "K/N fixed" counter, amber/green completion outline, Expand/Collapse-all, fixed-height viewport + group-level pagination
- **AD-063** (2026-06-27) — User-resizable viewport height (drag the bottom-right grip; `resize:vertical`) across the report's viewports and the tracker — scoped to top-level viewports (nested Found-on lists / triage bodies stay size-to-content)
- **AD-064** (2026-06-27) — Fix-tracker section refinements: **All: Fixed** bulk box (kept verdicts), stacked header (long link on its own row), translucent-amber outline that clears when all fixed *or* working (no green), pager moved above the scroll viewport, and definite-`height` viewports so the resize grip grows unbounded (supersedes the AD-063 `max-height`)
- **AD-065** (2026-06-27) — Drag-resizable columns extended to the non-triage tabs (`.grptbl` + own IIFE, per-tab Reset); removed all enforced minimum column widths (blanket `min-width:0`, grip floor 40→16); collapsible per-tab help (`helpBox` `<details>`, open by default)
- **AD-066** (2026-06-27) — Light/dark theme toggle (🌙/☀️, upper-right) on the report + tracker via `html[data-theme="light"]` overrides + an `--accent-fg` var; persisted in localStorage, no-flash
- **AD-067** (2026-06-27) — Two-level nesting in the fix tracker: By-page / By-broken-link sections roll up under a collapsible folder (internal) / domain (external) parent (regex-free `hostOf`/`folderOf`; section-level pagination with repeated parent headers)
- **AD-068** (2026-06-27) — Inverted Fixed/Broken stat matrix on the fix tracker (top row = Fixed instances/internal/external + % of broken; bottom row = Broken, verdict-driven); recomputes live on Fixed + Working/Broken changes
- **AD-069** (2026-06-27) — Export/Save buttons (report + tracker) use the File System Access "Save As" picker so the operator chooses folder + name, with the `<a download>` as a feature-detected fallback (AD-034 "if revisited")
- **AD-070** (2026-06-27) — Export suggested filenames carry an auto-appended `_YYYY-MM-DD_HH-MM_SS` timestamp (stamped inside `saveBlob`, so picker + download fallback + every caller; `lastIndexOf('.')` keeps dotted-hostname extensions)
- **AD-071** (2026-06-27) — Fix-tracker stat-card percentages adopt the report's adaptive `fmtPct` (AD-056): one-decimal floor, precision expands so a tiny non-zero fixed share never rounds to a misleading `0%`
- **AD-072** (2026-06-27) — Batch **🗂 Per-page** export: one self-contained mini-tracker per referrer page (DATA scoped via `/*CW_DATA_BOUNDS*/` markers + blanked panels, state-seeded), written to a picked folder (`showDirectoryPicker`, download fallback), filename = sanitized page address (slashes/illegal → `_`); for delegating fixes and re-importing each owner's JSON by the same per-pair keys
- **AD-073** (2026-06-27) — Team consolidation: multi-file **⬆ Import** (`importStateFiles`, merge N drops + one reload), namespace-guarded `applyState` (only `cwfix:<host>:` keys land), a dependency-free `merge-fix-state.js` reference/CLI merger (union, later-wins, host-isolated), and `SHAREPOINT-MERGE.md` — the Power-Automate-merge guide for a locked-down tenant (browser-side REST ruled out by custom-script + CORS)
- **AD-074** (2026-06-27) — Tracker: subtitle counts **distinct** referrer pages (union, not internal+external summed); `savePerPage`→**`saveBatch(mode)`** adds **per-subfolder** export (folderOf, one file per tier-1 folder) beside per-page, with descriptive buttons + skipped-count toast; stat matrix gains a 4th column **Pages with broken links / Pages remediated** (page-granular workload). Lesson: no inner IIFEs in the template (the slice-based test harness treats the first `})();` as the IIFE end)
- **AD-075** (2026-06-27) — Report: new **Referrer pages with broken links** stat card (`brokenPgN`, live via a memoized `refMap()` over `__CW_BROKEN__`, same green/amber triage-completeness outline) replacing the legend slot; **outline legend relocated** to a compact upper-right `.leghint` by the theme toggle; NEWWIN intercepts **any http(s) link** (every tab → one reused satellite window; modified clicks fall through); broken cards relabelled **Broken internal/external destinations**; project-wide **tested→triaged** wording sweep (CSS class names kept)
- **AD-076** (2026-06-27) — Fix tracker: **dropped the Internal/External tab** — both lists work together in one view (`allList()` tags each entry `type`), **By page** showing every broken link on a page with a **Type** column and **By broken link** a type badge; collapsed to one `panel-all`; stat matrix keeps its int/ext breakdown
- **AD-077** (2026-06-27) — Drag-resizable **table columns** in the fix tracker (ports the report's `.grptbl` grip/broadcast/persist), tagging the two shapes `gp`/`gl` for per-shape default widths, storage keyed per view (`cwfixcol:host:page`/`:link`), re-wired in `fill()`, with **↔ Reset columns** — UI/UX now consistent with the crawl report
- **AD-078** (2026-06-27) — Memory consolidation: SYNTHESIS §5 lessons **#23–#30** + a themed index, capability inventory/§6 refreshed to AD-077 (244/0), `SESSION_HANDOFF`/`RESUME_BLOCK` rewritten current (stale migration append-logs dropped), and a `RHIZOME-CORE-CANDIDATES.md` package of 12 transferable principles staged for promotion into `david-coneff/rhizome`

---

## Provenance

Partitioned 2026-06-26 (AD log had grown to 35 entries / 809 lines). Earlier this was a single `decisions.md`; the ADR bodies now live in `decisions/` by range, with this index on top.
