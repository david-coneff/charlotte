# Architecture Decisions — Report rendering, triage & sharing

Report render caps & pagination, the link-instance metrics & wording, the Broken/Working triage workflow, the share/import tooling, the standalone fix tracker, and the GUI resume-counter fix.

_Part of Charlotte’s decision log; see [`../decisions.md`](../decisions.md) for the full index._

---

## AD-017: Remove the report's per-table render cap
**Date:** 2026-06-25
**Decision:** Set `RENDER_CAP` (report.js) from `5000` to `Infinity` — the HTML report now
renders **every** row in each table (internal pages, external links, errors, blocked,
out-of-scope) instead of truncating at 5,000 with a "full set in the JSON" note. The
`capNote` mechanism is left intact (it simply never triggers at `Infinity`), so a finite
cap can be restored in one line if ever needed. `REF_CAP` (500 referrers per broken
link's nested "found on" table) is unchanged.
**Rationale:** an operator hit the 5,000-per-table cap and found links present only in the
JSON, not the HTML. The cap was a file-size/browser-responsiveness guardrail, not a hard
limit (the report inlines every row as markup). Asked, the operator chose to remove the
default and accept larger HTML on big crawls. Cost is linear and modest (~280 bytes/link:
~1.7 MB for 6,000 links, ~28 MB for 100,000); the JSON remains the compact source of truth
for very large crawls.
**Verification:** a fixture page with 6,000 external links now renders all 6,000 rows in
the HTML (was 5,000) with no cap note, JSON still lists 6,000; a normal small crawl is
unaffected (no cap note, correct output); `report.js` syntax-checks.

## AD-018: Opt-in client-side report pagination (`--paginate`, 1,000/page)
**Date:** 2026-06-25
**Decision:** Add an off-by-default `--paginate` flag (cfg.paginate; GUI checkbox
"Paginate report (1,000 links/page)") that makes the HTML report show each large table
**1,000 rows at a time** with Prev/Next + a "Go to page" box. Implemented in `report.js`
as a small ES5 IIFE (gated on `cfg.paginate`) that finds every main data table
(`.tablewrap > table:not(.subtable)`), and for any with >`PAGE_SIZE` (1,000) rows inserts
a `.pager` bar and toggles row `display`. The pager CSS is always present (3 inert lines);
the pager *script* is emitted only with `--paginate`.
**Rationale:** complements AD-017 (which made the HTML include *all* rows). All rows stay
embedded — pagination is **display-only**, so it pages over the real DOM rows. That's the
key design choice: selection, allowlist export, and fix-tracker export all keep working
because they read every `.pickbox`/`.fixbox` regardless of which page is shown (verified
in the report's existing export JS). A data-driven virtual table would have forced
re-implementing all row/checkbox/referrer markup in client JS and broken those exports.
Hiding rows still bounds layout/paint/scroll cost to 1,000 rows, which is what makes a
50k-row report responsive. Off by default keeps the default report a single flat table
(unchanged but for the 3 inert CSS lines). Applies per-table, so a single huge external
host-group paginates within its `<details>`; small tables (≤1,000) get no pager.
**Verification:** with `--paginate`, a 6,000-link report embeds the pager script and all
6,000 rows; without it, no pager script and (timestamps aside) byte-identical to the
committed report bar the 3 CSS lines. DOM-stub tests on the extracted pager JS: a 2,500-row
table shows exactly 1,000/page, label "Page 1 of 3 · rows 1–1,000 of 2,500", Next→rows
1,000–1,999, Next→rows 2,000–2,499 with Next disabled, Prev and the jump box both correct;
tables of 1,000 and 500 rows get no pager. `report.js`/`cli.js` syntax-check; the GUI HTA's
JScript parses and the checkbox + both command-builders (crawl + re-check) are wired.

## AD-019: Uncap the "found on" referrer list + paginate it
**Date:** 2026-06-25
**Decision:** Remove the `REF_CAP` (500) cap on the nested "found on" referrer table under
each broken link. Every page that links to a broken URL is now listed in the HTML (no more
"+N more — see JSON" row), in `refCell` (plain Errors/Blocked tables), `refCellFix` (the
checkbox Errors tabs), and the embedded fix-tracker payload (`brokenFor`/`refsAll`) so the
exported tracker matches what's shown. The `REF_CAP` constant is deleted. The AD-018 pager
now also covers these nested lists: its selector dropped `:not(.subtable)` → `.tablewrap >
table`, so with `--paginate` a referrer list over 1,000 rows pages 1,000 at a time inside
its `<details>` (small lists just scroll in the existing 220px box).
**Rationale:** an operator wanted no cap on how many referrers are reachable *in the page*
(not only the JSON). Removing the cap is unconditional (consistent with AD-017 for the main
tables); pagination of these lists rides the same `--paginate` toggle as the main tables
(AD-018), so one flag governs all pagination. Display-only again, so the existing fix
checkboxes / fix-tracker export keep working across pages. The embedded tracker payload now
carries every referrer too (a sitewide-broken link can make that large — the accepted
"completeness over size" tradeoff from AD-017; `--paginate` keeps rendering responsive).
**Verification:** a fixture where `/broken` is linked from 1,501 pages — the report embeds
all 1,501 referrer rows (counted by `data-ref=`) in both default and `--paginate` modes,
with no cap note; the fix-tracker payload carries all 1,501. DOM-stub on the extracted
pager: a 1,501-row nested `.subtable` inside a 3-row main table gets its own pager (1,000 on
page 1, Next → the remaining 501) while the 3-row main table gets none. AD-018's main-table
paging still passes; the default (no `--paginate`) report is unchanged except the one CSS
comment line. `report.js` syntax-checks (REF_CAP fully removed).

## AD-020: Live re-tuning of a running crawl (`--tune-file`)
**Date:** 2026-06-25
**Decision:** Add `--tune-file FILE` (cfg.tuneFile): the crawler watches a JSON file on the
existing control-poll (every 400ms) and, when its content changes, applies new `delay` /
`rps` / `crawlDelay` / `timeout` to the **running** crawl without restarting. Implemented by
making the rate limiter read the gap each request (`makeRateLimiter` now accepts a getter,
not just a number) and by `applyTune()` mutating `cfg`/the local `crawlDelay` (workers
already read `cfg.delay` per loop, so no worker change). The file's content at startup is
baselined (not applied), so a stale file can't override CLI flags. GUI: a `writeTune()`
writes the Delay/Max-req-sec/Timeout fields to `crawl-gui-tune.json` on **Resume**, and the
tune file is deleted at crawl start; `--tune-file` is added to the run command.
**Rationale:** the operator wanted to pause, change *how it crawls* (e.g. pace between
requests), and resume without re-crawling. Rate is the common "the setting is the problem"
lever (getting throttled), and `--rps` is a hard global cap, so live delay/rps fully control
pace. Concurrency/depth/scope aren't hot-swappable but don't need re-crawling either — the
existing Stop → **Resume crawl** journal flow (AD-012/015) already continues with new
settings without re-fetching. Keeping the worker pool untouched made this low-risk: a normal
crawl (no `--tune-file`) is byte-identical to before.
**Verification:** a normal crawl without `--tune-file` is byte-identical (HTML + JSON) to the
pre-change version. End-to-end: a 40-page chain crawl at `--rps 2`, then the exact
pause→edit→resume flow — log shows `PAUSED crawled=5` → `RETUNED rps=off` → `RESUMED`,
`Re-tuned: rps=off` printed, all 40 pages crawled, finishing in ~4s (vs ~20s if the cap had
stayed) — proving the new rate took effect mid-crawl, not just logged. `crawl.js`/`cli.js`/
`netutil.js` syntax-check; the GUI HTA's JScript parses and the tune wiring is present.

## AD-021: "Link instances" headline metric (total link occurrences, not deduped)
**Date:** 2026-06-25
**Decision:** Add a **Link instances** headline stat to the crawl report: the total number
of link *occurrences* — internal **and** external — summed across every crawled page, **not
deduplicated**. Computed as `Σ (page.internal + page.external)` over `state.pages`. `extractLinks`
doesn't dedupe, so `page.internal`/`page.external` are already raw per-page occurrence counts
(matching the per-page Int/Ext columns); the metric is just their sum. Added to the single
report's stat row (with a tooltip), the JSON (`summary.linkInstances`), and the multi-site
index (per-site count in each card + a grand total in the header, and `summary.linkInstances`
per site in the combined JSON). The `stat()` helper gained an optional 4th `title` arg.
**Rationale:** the operator wanted a single top-of-report number for the total link volume —
"a particular link may be found multiple times since it is highly referred to by other pages."
Three clarifications pinned the definition: (1) it's a headline number; (2) **not** per-page
deduped — count duplicates, "the sum of all links on the page across all pages"; (3) **both**
internal and external, not external-only. So it's distinct from the existing *unique*-target
counts ("Internal pages" / "External links"): a link in sitewide nav inflates instances but not
the unique counts. Out-of-scope (same-domain, path-excluded) links aren't in the per-page
counts, so they're excluded — consistent with the Int/Ext columns. The sum is robust on resume
(replay restores `external`/`internal` per page) and on partial/checkpoint reports.
**Verification:** a fixture with deliberate duplicate links — page `/` with two `/a` links + one
`/b` + three `ext/x`, etc. — yields per-page int/ext of 3/3, 1/2, 1/0 and `summary.linkInstances`
= **10** (not the 5 unique), the HTML headline shows "10 Link instances", unique counts stay
3 pages / 2 external. Multi-site: index header "20 total link instances", each card "10 link
instances", combined JSON `10, 10`. A normal single-site report renders the stat ("12"). `report.js` syntax-checks.

## AD-022: Fix `--recheck-from` on a multi-site index (was wiping the report)
**Date:** 2026-06-25
**Decision:** Make re-check handle a multi-site **index** JSON, not just a single-site report.
Three parts: (1) a multi-site crawl now writes a full **per-site JSON** for each site
(`siteCfg.json = sitePath(cfg.json, …)` instead of `""`); (2) `writeCombinedJson` records each
site's `jsonFile`; (3) `runRecheck` detects `j.sites` and branches to `runRecheckMulti`, which
loads each site's per-site JSON, re-probes its flagged links (shared `reprobe()` helper, also
used by the single-site path), rewrites each per-site report + JSON, and rebuilds the combined
index + JSON. If the per-site JSONs are absent (an index from before this change), it prints a
clear "re-run the crawl once" message and exits **without writing** — so it can't destroy data.
**Rationale:** the combined index JSON is `{ crawledAt, sites:[{summary, errors, blocked}] }` —
it has no top-level `errors`, so the old `loadStateFromJson` read **zero** flagged links, then
`writeOutputs` overwrote the index with an empty single-site report ("reset the counters to 0
and immediately said it was done" — the operator's report, reproduced exactly). The GUI does a
multi-site crawl whenever `crawl-gui-domains.txt` has >1 domain, so this hit real use. Per-site
JSONs (full state) are needed because the combined JSON is only a summary — you can't faithfully
rewrite a per-site HTML report from it. `reprobe()` was factored out of the old `runRecheck` so
single- and multi-site share identical probe/classify/dedup logic.
**Verification:** reproduced the wipe on a 2-site combined JSON (re-checked 0, errors reset to
0). After the fix: single-site re-check unchanged (2 flagged → 2 still broken); multi-site
re-check re-probes each site (4 still broken across 2 sites) and the per-site error counts stay
2,2 (not wiped); the multi-site crawl writes `report.1-host.json` / `report.2-host.json` and the
index JSON references them via `jsonFile`; an old index missing per-site JSONs errors with exit
1 and leaves the file unchanged (2,2). `crawl.js`/`recheck.js`/`report.js` syntax-check.

## AD-023: Broken-link triage workflow in the report (all in report.js)
**Date:** 2026-06-25
**Decision:** A batch of related report-UX features for triaging broken links, from a rapid
sequence of operator requests:
- **Fix tracker grouped by referrer page.** The standalone tracker now renders one section
  per *referrer page* (a page that links to broken URLs) with that page's broken links beneath
  and a **single contact note per page** (was one row per referrer→broken pair with a per-pair
  note) — one person usually owns a page. Fix ticks stay per (referrer,broken); notes are now
  keyed by referrer.
- **Manual-testing triage on the Errors tabs.** Each row gets a **Tested** box and a **Not
  broken** box (ticking "Not broken" implies tested; unticking "Tested" clears it). A **live
  per-tab counter** — "Manually tested X / N · confirmed broken Y · not broken Z" — shows how
  far testing has gotten. State persists in localStorage (`cwtest:`/`cwok:` keyed by host+url).
- **"Not broken" excludes from the tracker.** `exportTracker` drops okbox-checked URLs, so a
  highly-referenced false positive can't flood the tracker with thousands of referrer rows.
- **"Broken link instances" headline stat** (+ `summary.brokenLinkInstances`, + multi-site
  per-site/total): each broken link counted once per referring page (min 1) — the cleanup
  workload. It **updates live** (`recomputeBroken()` sums `data-inst` over rows whose "Not
  broken" box is unticked) as links are screened, so the header is accurate post-triage.
- **Export fix tracker always enabled.** `refresh()` now disables only `.copybtn`/`.exportbtn`
  on empty selection, not the tracker button (it exports all/none regardless of ticks).
- **Links open in a side-docked window.** A delegated `NEWWIN` handler intercepts
  `target="_blank"` clicks and `window.open()`s one reused "charlotteLink" window docked to
  whichever side of the report has more room (full height), so checking a link never covers the
  report. Embedded in the report, the index, and the tracker.
**Rationale:** the goal is screening crawler false positives *before* compiling the fix tracker
so it lists only genuinely-broken work, grouped the way a fixer acts (by page, one contact).
The broken-instances stat quantifies the workload and shrinks live as false positives are
cleared. Side-docked windows keep the report visible while spot-checking links. All persistence
is localStorage (final reports don't auto-refresh, so ticks survive).
**Verification:** DOM-stub tests — tracker groups a 2-broken-link referrer into one card with
one note (and a 1-link referrer separately); the manual-testing counter goes 0/3 → tested 1/3
confirmed-broken 1 → (Not-broken row) tested 2/3 not-broken 1, with persistence and the
tested/not-broken implication both directions; the broken-instances header drops 7→1 when a
6-referrer link is marked Not broken and restores to 7; side-window math docks right of a
left-report (left=1200,w=1360), left of a right-report (left=0), usable when maximized (w=806),
reusing "charlotteLink". A real crawl: `summary.brokenLinkInstances=7` for a 6-referrer +
1-referrer pair; multi-site index totals 14 (7+7). All five report scripts parse; `report.js`
syntax-checks.

## AD-024: Rebuild a report from saved JSON (`--rebuild-from`) + GUI button
**Date:** 2026-06-25
**Decision:** Add `--rebuild-from FILE`: regenerate the HTML report from a prior `--json`
report using the CURRENT report.js — no crawl, no network, no re-probe. It's `--recheck-from`
minus the re-probe step, reusing `loadStateFromJson` + (for multi-site) the per-site-JSON
machinery and `buildIndexReport`/`writeCombinedJson`. Single-site: load state → `writeOutputs`.
Multi-site index JSON: rebuild each per-site report from its per-site JSON + rebuild the index
(errors safely if per-site JSONs are absent). Also re-emits the JSON so new `summary` fields
appear. To preserve the crawl **runtime** across rebuilds, `summary.runtimeMs` (+ `retries`) is
now written and `loadStateFromJson` restores it (`buildReport` prefers `state.runtimeMs`); old
reports lacking it show ~0s. GUI: a **Rebuild report** button mirrors the Re-check button
(`buildRebuildCommand` + `rebuildReport()` + `runMode==='rebuild'`).
**Rationale:** the operator upgraded Charlotte and wanted new report features (broken-instances
stat, manual-testing boxes, grouped tracker, …) on a 3-hour crawl without re-crawling. The JSON
already holds all the data, so re-rendering is instant. `parseArgs` was taught that
`--rebuild-from` (like `--recheck-from`) needs no start URL.
**Verification:** stripped the new summary fields from a real report's JSON (simulating an old
version), deleted the HTML, ran `--rebuild-from` → the rebuilt HTML has the broken-instances
stat (7), Tested/Not-broken columns, the grouped tracker, and the side-window handler, with the
page/error data intact and the JSON re-emitted with the new fields. Multi-site rebuild
regenerates the index + per-site HTML. `crawl.js`/`cli.js`/`recheck.js`/`report.js`
syntax-check; the GUI HTA JScript parses and the rebuild button/command/state are wired.

## AD-025: Manual-testing triage on the Blocked tab (confirm-broken → header + tracker)
**Date:** 2026-06-25
**Decision:** Give the **Blocked · uncertain** tab the same manual-testing mechanism as the
Errors tabs, but with the **opposite default**: a **Tested** box and a **Broken** box that
*confirms* an uncertain link is actually dead (Errors default to broken with a "Not broken"
opt-out; Blocked defaults to uncertain with a "Broken" opt-in). Confirming a blocked link:
(1) **adds** its instances to the live **Broken link instances** header (`recomputeBroken`
now also sums blocked rows whose `.brokenbox` is checked), and (2) routes it into the **fix
tracker** by its existing **Kind** column — `exportTracker` appends confirmed-broken blocked
links to `data.internal`/`data.external` from embedded `blockedInt`/`blockedExt` lists. A live
per-tab counter ("Manually tested X / N · confirmed broken Y") and localStorage persistence
(`cwtest:`/`cwbroken:`), with the same Broken⇒Tested implication. A `.confirmed` row class
tints confirmed rows. New `.blkpick` table CSS (two narrow checkbox cols + wide URL).
**Rationale:** the operator wanted blocked links to feed the same broken-instances/fix-tracker
flow. The tab mixes internal+external, which they flagged as a barrier to tracker integration;
rather than split it into two tabs (their suggested option), the existing **Kind** value is
enough to route each confirmed link to the right tracker side — simpler, no extra tabs. Default
"uncertain, opt-in to broken" is correct because blocked links are *presumed maybe-fine*, the
inverse of Errors.
**Verification:** DOM-stub — confirming a blocked link (inst 3) bumps the header 1→4 and the
counter to "tested 1/2 · confirmed broken 1", auto-checks Tested, persists (`cwbroken:`+`cwtest:`);
a second (inst 2) → 6; unticking Tested clears Broken and drops the header back to 3. Export
stub: a confirmed internal blocked link lands in `tracker.internal` alongside the real errors, an
unconfirmed external one is excluded, and `blockedInt`/`blockedExt` are stripped from the output.
A real 403 fixture renders the Tested/Broken columns + `blkpick` table; all five report scripts parse.

## AD-026: GUI — pagination on by default + a config file for option defaults
**Date:** 2026-06-25
**Decision:** (a) Make the GUI's **Paginate report** checkbox **checked by default** (the CLI
default stays off; this only changes the GUI's preset). (b) Add **`crawl-gui-config.txt`**:
an optional file next to `crawl-gui.hta` with `key = value` lines that override the form's
default values on launch. `loadGuiConfig()` reads it from `scriptDir` (after `seedUrls()`,
before `toggleInputs()`/`updatePreview()`), and for each line sets the element whose id is the
key — `.checked` for checkboxes (true/1/yes/on), `.value` for text inputs and `<select>`s;
unknown ids are skipped. A documented `crawl-gui-config.txt.example` ships; the real file is
gitignored (like `crawl-gui-domains.txt`).
**Rationale:** the operator wanted paginated reports by default from the GUI and a way to
persist their preferred GUI settings without editing the HTA. Keying the config on field ids
makes it fully generic (every field is supported with no per-field code) and self-consistent
with the form. It's read after URL seeding and before the dependent-field sync so a config that
sets e.g. `noPages`/`scope` is reflected correctly. Start URLs stay in the separate
`crawl-gui-domains.txt`.
**Verification:** the HTA JScript parses; a stub run of `loadGuiConfig` against a sample config
applies 6 known keys and skips an unknown one — toggling checkboxes (paginate/noPages/browser),
text inputs (concurrency/rps, with and without spaces around `=`), and the `seen` `<select>`.
`paginate` now renders `checked`.

## AD-027: Report wording — "destinations" (unique) vs "hyperlink instances" (occurrences)
**Date:** 2026-06-25
**Decision:** Relabel the report's headline numbers and tabs so the unique-vs-occurrence
distinction is explicit (the operator's point: a *few* unique destinations but *many*
instances of them being linked across pages). Display-only — JSON field names are unchanged.
- "External links" → **External destinations** (stat + tab) — the unique off-site URLs.
- "Link instances" → **Hyperlink instances**; "Broken link instances" → **Broken hyperlink
  instances** — every `<a>` occurrence (not deduped).
- "Errors · internal/external" → **Broken · internal/external** (stat + tab) — the internal/
  external classification names the *destination*.
- New one-line **legend** under the headline numbers: "Destinations are unique URLs (few);
  instances count every hyperlink to them (many) — one destination linked from 500 pages is
  1 destination but 500 hyperlink instances." Tooltips reworded to reinforce. Multi-site index
  per-site nums + header relabeled to match; counts now `toLocaleString()`-formatted.
**Rationale:** "External **links**" (a unique count) collided with "**Link** instances" (an
occurrence count) — both said "link." Moving "link/hyperlink" onto only the occurrence metric,
and "destination" onto the unique counts, resolves it; the legend states the relationship
directly. JSON keys (`externalLinks`, `linkInstances`, `brokenLinkInstances`, `errorsInternal/
External`) are kept as-is so `--recheck-from` / `--rebuild-from` / external consumers don't break.
**Verification:** a real report shows the new labels (External destinations / Hyperlink
instances / Broken hyperlink instances / Broken · internal / Broken · external) and the legend;
the old labels are gone; the JSON `summary` keys are unchanged; multi-site index relabeled too;
all five report scripts parse.

## AD-028: Unified Broken/Working triage — explicit "Broken" confirm, mutually exclusive
**Date:** 2026-06-25
**Decision:** Replace the per-row triage controls on all three tabs (Errors · internal,
Errors · external, Blocked · uncertain) with **two mutually-exclusive checkboxes** — **Broken**
(confirms the link is dead) and **Working** (confirms it loads). The standalone **Tested** box is
removed; "tested" is now implied by either verdict being ticked. Ticking one box unticks the
other; clearing both returns the row to its default. Checkboxes (not radio buttons) so the user
can clear both.
- **Counting is unchanged in spirit:** Errors links are **assumed broken and counted by default**;
  only ticking **Working** subtracts them from `Broken hyperlink instances`. Ticking **Broken** on
  an Errors row is a no-op for the count (it was already counted) — it just records a hand-confirm.
  The Blocked tab keeps the opposite default (uncertain / not counted): ticking **Broken** adds it,
  **Working** just records it loads.
- **One wiring path:** the two former IIFE functions (`wire`/`update` for Errors + `wireBlocked`/
  `updateBlocked`) collapse into a single `wire(scope)` / `update(scope)` over
  `SCOPES=['errint','errext','blockd']`; `recomputeBroken()` keeps the Errors-vs-Blocked split via
  `ERRS=['errint','errext']` (okbox-unchecked) + `blockd` (brokenbox-checked).
- **Persistence:** `cwbroken:` / `cwok:` localStorage keys (the old `cwtest:` key is dropped). On
  load, **Broken wins** if both keys are somehow set (defensive; clears the stray `cwok:`).
- **Counter wording:** unified to *"Manually tested: T / N · confirmed broken: B · confirmed
  working: W"* on every tab (T = B + W).
- **Fix-tracker export:** the okbox exclusion is now scoped to `#panel-errint .okbox,
  #panel-errext .okbox` (Blocked "Working" ticks must not gate the tracker; blocked links enter it
  only when confirmed Broken). Blocked-Broken inclusion via `pickConf` is unchanged.
- Column headers Tested/Not-broken → **Broken/Working** on Errors; Tested/Broken → **Broken/Working**
  on Blocked. Help text + tooltips rewritten. Row classes `confirmed` (Broken) / `notbroken`
  (Working) unchanged.
**Rationale:** the operator wanted the header to start from "everything flagged is broken" and only
*subtract* on a confirmed-working manual check — which the Errors tabs already did — plus an explicit
**Broken** box to mark a hand-confirmed dead link, mutually exclusive with Working but still
clearable to "untriaged". Folding the redundant **Tested** box into the verdict pair (chosen over
keeping all three) is cleaner and makes all three tabs share one UI and one code path.
**Verification:** synthetic-state report builds; 30/30 DOM-stub assertions pass — default counts,
Working subtracts, Broken re-adds via mutual exclusivity, Blocked opt-in adds, both-clear returns to
default, `cwbroken:`/`cwok:` persistence round-trips, broken-wins tie-guard on reload; partial report
emits no triage boxes (auto-refresh safe); fix-tracker export excludes Working-marked errors, keeps
others, adds confirmed-Broken blocked links routed by kind; report.js + embedded IIFE both parse.

## AD-029: "Last tested" timestamp column on the triage tabs
**Date:** 2026-06-25
**Decision:** Add a **Last tested** column to the left of the Broken/Working boxes on all three
triage tabs (Errors · internal/external + Blocked · uncertain). It **auto-fills the local date &
time** (`YYYY-MM-DD HH:MM`) whenever the row's verdict is set — i.e. when **Broken** or **Working**
is ticked — so the latest manual result carries a timestamp in the record.
- **Re-stamps** on verdict change (ticking the other box updates it to now); **clears** when the row
  returns to no verdict (untick back to default). The timestamp is verdict-bound: present iff a
  verdict is set.
- **Persistence:** new string-valued `cwts:` localStorage key (alongside the flag-valued `cwbroken:`
  / `cwok:`). On reload the saved timestamp is shown **verbatim** (not re-stamped to "now"); a verdict
  saved before this feature simply shows an empty cell (no retroactive time).
- **Implementation:** added `getS`/`setS` (string storage) + `nowStr()`/`setTs()`/`clrTs()` to the
  triage IIFE; the change handlers call `setTs` on tick / `clrTs` on untick-to-no-verdict; `wire()`'s
  restore loop fills the cell from `cwts:`. Generated client-side with `new Date()` (local time).
- **Layout:** new `.tscell` class (122px, small/muted data cells); shifted the wide-URL `nth-child`
  rules (`.haspick` 4→5, `.blkpick` URL 3→4, Broken/Working now blkpick cols 2–3); excluded `.tscell`
  from the `.notbroken` strikethrough and `.confirmed` red so the timestamp stays readable. Column is
  gated on `showPick` (final reports only) like the boxes, so **partial/auto-refresh reports are
  unaffected**.
**Rationale:** the operator wanted an at-a-glance record of *when* each link's status was last
determined by hand — useful for re-checking stale results and for handing triage off over time.
**Verification:** 38/38 DOM-stub assertions pass (auto-fill on tick in `YYYY-MM-DD HH:MM` form,
persisted to `cwts:`, re-stamp on verdict swap, cleared on untick + removed from storage, restored
verbatim on reload, empty for a verdict with no saved stamp); fix-tracker export unaffected; report.js
+ embedded IIFE parse; partial reports render no `tscell`/`Last tested` column cells.

## AD-030: Share testing verdicts (export/import JSON + bake-into-copy)
**Date:** 2026-06-25
**Decision:** Triage verdicts (Broken/Working + Last-tested timestamps) live in localStorage, so
they don't travel when the report `.html` is emailed. Add a **Share your testing verdicts** toolbar
(above the tabs, final report only, shown only when there are links to triage) with two paths:
- **Save shareable copy** — serialize the live page (`document.documentElement.outerHTML`), strip any
  prior seed, and inject a `<script>window.__CW_SEED__={host,v}</script>` island just before
  `</head>` (so it runs before the wiring IIFE). The downloaded HTML carries the verdicts baked in;
  email the single file. On open, `seedFromCopy()` primes localStorage from the seed **only if the
  recipient has no verdicts for this host** (never clobbers their work), and `getF`/`getS` fall back
  to the seed when localStorage is unavailable (read-only display even on locked-down `file://`).
- **Export / Import verdicts (JSON)** — Export writes `{app:'charlotte-verdicts',host,v:{cw* keys}}`
  as `charlotte-verdicts-<host>.json`; Import validates app+host, **merges by link** (clears+sets the
  three keys for each url the file mentions; leaves untouched urls alone — so multiple people's
  exports combine), then `location.reload()`. A file for a different host is refused.
**Key details / gotchas:**
- The seed JSON is escaped `<` → `<` (browser-side, written as a 4-backslash literal in the
  Node template so the emitted inline script is `'\\u003c'`) — a URL containing `</script>` therefore
  can't break out of the seed `<script>` and round-trips back to `<` on the recipient. The literal
  `<script>`/`</script>` tags are built via `'<scr'+'ipt>'` concatenation to avoid a literal closing
  tag in the inline source. Re-sharing strips the old seed (indexOf loop) so seeds don't accumulate.
- New code is scoped inside the existing triage IIFE (reuses HOST/L/key/getF/getS); a local `toast`
  + `dl` mirror the export IIFE's. Buttons wired by id with `if(el)` guards. Browser APIs
  (Blob/URL/FileReader/location/setTimeout) used conventionally — same Blob-download pattern as the
  proven allowlist/fix-tracker exports.
**Rationale:** the operator asked whether emailing the file carries verdicts (it doesn't) and, when
told, wanted both a single-file handoff and a mergeable export/import.
**Verification:** 19/19 DOM-stub assertions (export JSON content + host scoping; import per-url
replace + reload + host-mismatch/garbage rejection; shareable-copy seed injected before `</head>`,
single seed, strip-on-reshare; seed primes empty / doesn't clobber existing; no-localStorage seed
fallback display) + the seed `<`-escape round-trip checked against a `</script>`-bearing URL. Existing
triage (38) + fix-tracker export (6) still pass; all 7 embedded scripts parse; report.js parses.

## AD-031: Allowlist EXPORT UI in the report is now opt-in (off by default)
**Date:** 2026-06-25
**Decision:** The in-report **allowlist export** affordance (per-link pick checkboxes + Select-all +
**Export to allowlist…** / **Copy lines** on the two Errors tabs) is now **off by default** and gated
behind a new `--allowlist-export` flag (`cfg.allowlistExport`, default false). It's superseded by the
fix tracker and the Broken/Working verdict tools. Reading an allowlist as **input** (`--allowlist
FILE`) and the **Suppressed** tab are unchanged — only the report's *export* UI is suppressed.
- **report.js:** `const showAllow = showPick && !!cfg.allowlistExport`. The pick `<td>`/`<th>` (now
  `.pickcol`), the Select-all, and the allowlist buttons in `exportBar` render only when `showAllow`;
  the **fix tracker** button stays. `pickHelp` drops its "First box selects… allowlist" sentence when
  off. The self-guarding allowlist IIFE (`if(!all.length) return`) needed no change — with no pick
  boxes it simply no-ops.
- **Column CSS made class-based** so the layout holds with or without the pick column: replaced the
  positional `.haspick`/`.blkpick` `nth-child` width rules with `.pickcol` / `.tscell` / `.tcol` /
  `.urlcol`; `.notbroken`/`.confirmed` exclusions switched `:not(:first-child)` → `:not(.pickcol)`.
  Header `<th>` and row `<td>` add/drop the pick column together (same `showAllow`), so counts stay in
  sync (verified 6/6 default, 7/7 opt-in).
- **cli.js:** `--allowlist-export` / `--no-allowlist-export`; default false; help text added.
- **crawl-gui.hta:** new Options checkbox `id="allowlistExport"` (unchecked by default), pushed as
  `--allowlist-export` in all three command builders (crawl / re-check / rebuild). `loadGuiConfig` is
  generic so `allowlistExport = true` works from `crawl-gui-config.txt`; doc comment updated.
**Rationale:** the operator: the allowlist export "seemed initially important but we've created more
robust tools" — keep the allowlist **import** wiring, suppress the report **export** UI by default.
**Verification:** default report has no pickbox/Select-all/Export-to-allowlist but keeps fix tracker +
Broken/Working + Last-tested + share toolbar; `--allowlist-export` restores them; header/row column
counts in sync both ways; CLI flag toggles correctly and `--allowlist` input still parses; HTA JScript
parses with the checkbox + 3 builder pushes; existing triage (38) / share (19) / fix-tracker (6) tests
still pass; report.js + cli.js parse.

## AD-032: Fix tracker carries last-tested timestamp + main-report-style verdict UI
**Date:** 2026-06-25
**Decision:** The exported fix tracker now mirrors the main report's triage on each broken-link row:
a **Last tested** timestamp and a mutually-exclusive **Broken / Working** verdict pair, alongside the
existing **Fixed** box. The per-page note field is retitled from "who to contact…" to a generic
**Notes**.
- **Export (exportTracker):** after the internal/external lists are finalized, `annotate()` reads each
  link's `cwbroken:`/`cwok:`/`cwts:` from the report's localStorage and bakes `v` ('broken'|'working'|
  '') + `ts` (the timestamp) onto each link object in the data island.
- **Tracker template:** `groups()` carries `v`/`ts` into each (ref→broken) row; `render()` adds the
  `Last tested` / `Broken` / `Working` columns (pre-set from `v`/`ts`); new helpers `initVerdict`/
  `initTs`/`saveV`/`saveT`/`nowStr`/`rowsForUrl`/`setVerdict` persist in the tracker's own `cwfix:host:`
  namespace (`vd:`+url, `vt:`+url). `wire()` wires the `.vb`/`.vo` boxes.
- **Behavior matches the main report:** ticking Broken or Working is mutually exclusive, **auto-stamps
  the time** (or clears it when no verdict remains), and — because a URL can be linked from several
  referrer pages (so it appears in several rows) — the verdict + timestamp are **synced per URL** across
  all its rows. On open, a localStorage override wins over the baked value (so edits persist), exactly
  like the `Fixed`/notes pattern.
- **Notes:** placeholder "who to contact to fix this page…" → "notes…", with a visible **Notes** label;
  footer text now "ticks, verdicts & notes saved in this browser".
**Constraints honored:** the tracker template stays backtick-free / `${}`-free / backslash-free (it's
embedded in the report's own template literal and script) — verified.
**Rationale:** the operator wanted the last-check timestamp to travel into the tracker and the verdict
marking to match the main report's style, with the note field simply titled "Notes".
**Verification:** 15/15 DOM-stub assertions via a minimal innerHTML-parsing harness — export bakes
v/ts onto each link; the tracker renders the baked timestamp + pre-checks Broken; toggling Working is
mutually exclusive, stamps a fresh `YYYY-MM-DD HH:MM`, persists `vd:`/`vt:`, and **syncs both referrer
rows** of the same URL; unticking clears verdict + timestamp; the Notes field is retitled. The tracker
document's 2 embedded scripts parse; report.js parses; existing triage (38) / share (19) / tracker-export
(6) suites still pass (the old `/`,`/a` tracker-render test is stale fixture data, not a regression).

## AD-033: Fix tracker — "Fixed on" timestamp + shareable state (export/import + bake-a-copy)
**Date:** 2026-06-25
**Decision:** Two additions to the standalone fix tracker, both mirroring the main report:
1. **"Fixed on" timestamp** — a new column that auto-fills the local date/time (`YYYY-MM-DD HH:MM`)
   when a row's **Fixed** box is ticked, and clears when unticked. Per (referrer→broken) pair, like the
   Fixed flag (key `cwfix:host:ft:`+pkey). Row order: Fixed · Fixed on · Last tested · Broken · Working
   · link · reason. Tracker widened 1100→1280px; the `done` strikethrough now skips the control/time
   cells (`:not(.v):not(.ft):not(.ts)`).
2. **Shareable state** — a tracker share toolbar (⬇ Export / ⬆ Import / 💾 Save copy) port of the
   report's AD-030: `collectState()` snapshots every `cwfix:host:` key (fixes + ft + verdicts + vt +
   notes); Export downloads it as JSON; Import validates app+host and merges (then `location.reload()`);
   Save copy serializes the page, strips any prior seed, and injects
   `<script>window.__CW_TRK_SEED__={…}</script>` before `</head>`. On open `seedFromCopy()` primes
   localStorage from the seed unless the browser already has state; storage reads (`rawGet`) fall back
   to the seed when localStorage is unavailable, so a baked copy still displays read-only.
**Constraint:** the tracker template is embedded in the report's own template literal + script, so it
must stay **backtick-free / `${}`-free / backslash-free**. The seed's `<`→`<` escape is therefore
done with `String.fromCharCode(92)` (no literal backslash) via `.split('<').join(BS+'u003c')`, the
`<script>`/`</script>` tags via `'<scr'+'ipt>'` concatenation, and the doctype newline via the existing
`NL=String.fromCharCode(10)`. Verified the emitted template contains no backtick/`${`/backslash.
**Storage refactor:** `stored*`/`save*` now route through `rawGet`/`rawSet` (localStorage-or-seed) and a
new `storedFt`/`saveFt`/`initFt` pair; semantics unchanged for existing keys.
**Rationale:** the operator wanted a timestamp on the Fixed checkbox and the same share mechanics the
crawl report has (JSON import/export + a self-contained HTML with state preloaded).
**Verification:** 18/18 DOM-stub assertions via the innerHTML-parsing harness — Fixed tick stamps/
persists/clears the Fixed-on cell; Export captures the cwfix: state scoped to host; Import merges +
reloads + rejects wrong-host; Save copy injects one escaped seed before `</head>`; seed primes empty /
won't clobber existing — plus an explicit `</script>`-in-key/value round-trip through the seed escape.
Template stays constraint-clean; both tracker scripts parse; report.js parses; existing triage (38) /
share (19) / tracker-export (6) / tracker-verdict (15) suites still pass.

## AD-034: Keep auto-save-to-localStorage; no File System Access "Save to file" (docs-only)
**Date:** 2026-06-25
**Decision:** The operator asked whether the report/tracker could have a plain "Save" button or
general auto-save instead of baking a state-laden HTML. Outcome: **keep the current model; add no
new save mechanism** — only clarify it in the docs.
**Why (the constraints that drove it):**
- State **already auto-saves**: every tick/verdict/timestamp/note writes to `localStorage`
  immediately, so reopening the same file in the same browser restores everything with no Save step.
- A page **cannot write back to its own `.html`** on disk (browser sandbox), so in-place "save the
  report file" is impossible. The only on-disk paths are browser storage (automatic) or a
  user-triggered download (the existing Export JSON / "Save copy").
- The one real "Save to a file + auto-save" option is the **File System Access API**
  (`showSaveFilePicker`, persisted handle in IndexedDB) — but it's **Chromium-only**, needs a
  click + permission grant, and can't auto-load on open without a user gesture. Offered it (plus an
  "overwrite the report HTML in place" variant); operator chose **neither** — keep it simple.
**Action taken:** CRAWLER.md "Sharing your verdicts" → renamed **"Saving and sharing your verdicts"**
with a lead paragraph stating triage auto-saves, that a page can't re-save its own file, and that the
Export/Import/Save-copy tools are only for *moving* state elsewhere. Mirrored a one-line auto-save note
into the fix-tracker share paragraph. No code change.
**If revisited:** implement File System Access as an additive, feature-detected enhancement (a
"Save to file…" button writing a JSON sidecar + auto-save to a remembered handle), with the current
Export/Import as the universal fallback — do not remove localStorage auto-save.

## AD-035: GUI resume — seed live counters from a "# resume-stats" marker
**Date:** 2026-06-26
**Bug:** On a GUI **Resume**, the live Crawled/Good/Broken/Blocked tallies reset to 0, while
External kept its value. Cause: the GUI deletes the live log + zeroes its counters each launch and
**increments** Crawled/Good/Broken/Blocked per OK/ERR/SKIP/BLOCKED line it sees — but on resume the
crawler replays its journal *silently* into the fresh log and only logs *new* pages, so those tallies
only counted new activity. External survived because the GUI reads it from the absolute `extTotal=`
the crawler stamps on every OK line (and `state.external` is restored on replay).
**Fix:** After the resume replay rebuilds state, crawl.js emits one marker to the progress log —
`# resume-stats crawled=N good=G broken=B blocked=K external=E` (gated on `replayed > 0`; `good` =
count of replayed HTML "p" pages). crawl-gui.hta's `processLine` parses it and **ADDS** crawled/good/
broken/blocked to its counters (so multi-site resumes accumulate across sites) and **sets** external
(absolute, like `extTotal=`). Fresh crawls emit no marker (unchanged).
**Verification:** real full-crawl→resume: marker `crawled=4 good=2 broken=2 blocked=0 external=0`
exactly matched the full crawl's `# crawl done`; GUI-tally simulation of the fresh resume log equalled
the full crawl (4/2/2, no reset); synthetic partial resume (1 baseline + 3 new) summed to 4/2/2 with
external tracking the absolute. crawl.js + HTA JScript parse.

## AD-036: Extract NEWWIN + TRACKER_TEMPLATE into report-templates.js
**Date:** 2026-06-26
**Decision:** report.js had grown to ~894 lines / 91 KB (the largest source file), mostly because it
embeds two big self-contained string constants: **NEWWIN** (the side-docked, reused link-window
script) and **TRACKER_TEMPLATE** (the entire standalone broken-link fix-tracker document — ~150 lines
of HTML + CSS + browser JS). Moved both into a new **report-templates.js**; report.js now
`require`s `{ NEWWIN, TRACKER_TEMPLATE }`. report.js drops **894 → 743** lines; report-templates.js is
164 lines.
**Why these:** plain string constants with no report.js dependencies (TRACKER_TEMPLATE only
concatenates NEWWIN, defined just above it in the module) that change far less often than the
report-assembly logic — a clean seam.
**Constraint preserved:** TRACKER_TEMPLATE stays authored with no backticks/`${}`/backslashes inside
(it embeds into the report’s own template literal); relocating it to a sibling module is byte-neutral.
**Verification:** report output is **byte-identical** before vs after the split (full synthetic-report
diff clean); report.js + report-templates.js parse; the whole report suite (triage 38 / share 19 /
fix-tracker export 6 / tracker verdict 15 / fixed-on+share 18 / newwin 7) passes; `crawl.js --help` OK.

## AD-037: Partial reports were zeroing the "Broken hyperlink instances" header
**Date:** 2026-06-26
**Bug:** A partial (auto-refreshing) report renders the header server-side (e.g. `brokenInstN`=113)
but the triage IIFE still ran `recomputeBroken()`, which sums `data-inst` over `tr[data-url]` rows.
Partial reports use read-only `errRows` (no `data-url`, no boxes), so the sum was 0 and clobbered the
header — the classic "flashes 113 then turns to 0". Surfaced on a **stopped/interrupted multi-site**
crawl: per-site reports stay partial, the index shows the right per-site numbers (113 / 96 broken
internal), but opening that site flashed to 0.
**Fix:** the triage IIFE bails immediately — `if(!document.querySelector(tr[data-url])) return;`
— when there are no triage rows (exactly the partial case), leaving the server-rendered header intact.
Final reports (`pickRows`/`blockedPickRows` carry `data-url`) are unaffected; the share toolbar only
exists when errors/blocked exist, so it always has rows and never bails wrongly.
**Verification:** partial-report header stays at the server value (not 0); final-report triage (38) /
share (19) / fix-tracker (6) / tracker (15+18) / newwin (7) suites all pass; report.js parses.

## AD-038: External tab — two Expand/Collapse buttons instead of a single state-detecting toggle
**Date:** 2026-06-26
**Problem:** the single Expand/Collapse-all toggle (AD-011) could show the **wrong label** — e.g. all
per-domain sections collapsed but the button still read "Collapse all", so there was no way to expand
them. Its label was driven by a `sync()` that recomputed "are all sections open?" from per-section
`toggle` listeners; manually expanding/collapsing individual sections (or sections not present when the
script wired) desynced it.
**Decision:** replace it with **two always-present buttons — Expand all / Collapse all** — that simply
set every `<details>` open/closed unconditionally. No state detection, no `toggle` listeners, no
`sync()`. Robust regardless of section state. Supersedes the single-toggle part of AD-011.
**Verification:** both buttons render (old `extToggle` gone); Collapse all closes every section, Expand
all opens every section, and a desync scenario (collapse one manually, then Collapse all) still closes
all — DOM-stub verified; full report suite still passes.

## AD-039: Satellite link-window reuse — hold a JS reference, don't rely on name targeting
**Date:** 2026-06-26
**Problem:** clicking broken links opened a **new window for every link** instead of reusing one
docked satellite window — leaving the user with dozens of windows to close. The `NEWWIN` script
named the window `charlotteLink` (meant to reuse it) but also did `nw.opener=null` for reverse-
tabnabbing safety; nulling the opener drops the popup into a separate browsing-context group, so the
opener can no longer find it by name, and each `window.open(href,'charlotteLink',…)` spawns a fresh one.
**Decision:** keep a module-level reference `SAT` to the opened window and **navigate that** on reuse
(`SAT.location.replace(href)` — allowed cross-origin even after the opener is nulled) instead of relying
on name-based targeting. Position the window only on first open; reuse just navigates + focuses. Still
null the popup's `opener` (safety preserved) since reuse no longer depends on it. Reopens a fresh window
if the user closed the satellite (`SAT.closed`). Lives in `report-templates.js` `NEWWIN`, shared by the
report and the fix tracker. Stays backtick/`${}`/backslash-free.
**Verification:** newwin-test gains reuse asserts — 3 clicks open exactly ONE window, navigate it to the
latest link, re-focus each click, and reopen after close — all pass; geometry asserts unchanged; report
(38) / share (19) suites pass; `NEWWIN` constraint scan clean.

## AD-040: Triage tables — fixed layout so the timestamp column stops starving Reason
**Date:** 2026-06-26
**Problem:** the new "Last tested" column (AD-029) rendered ~360px wide with tiny text while the **Reason**
column collapsed to one word per line. Root cause: the generic `th:first-child,td:first-child{min-width:360px}`
rule (written for URL-first tables) now landed on the timestamp column (the new first column of the Errors/
Blocked tables), and auto table-layout funneled slack into it, starving Reason.
**Decision:** switch the three triage tables (`table.haspick`, `table.blkpick`) to **`table-layout:fixed`**,
which ignores those cell min-widths and sizes columns from the header row's classes. Set `.tscell` to a tight
`140px` with `13px` text (was `11px`); `.tcol` to `80px` so the "Broken"/"Working" headers don't clip; add
`.reasoncol` (auto — shares the leftover with the URL column), `.foundcol` (`236px`), `.kindcol` (`92px`).
Header `<th>`s carry the new classes; body cells inherit column widths, so row generators were untouched.
Partial reports (plain tables, no triage columns) keep auto layout + the first-child rule.
**Verification:** rendered (headless Chromium) — timestamp tight, Broken/Working headers fit, a long
cert-error reason wraps comfortably across a wide column; header/body column counts match; triage/share/
newwin suites pass.

## AD-041: Re-check — GUI live integration + a separate JSON written before the report
**Date:** 2026-06-26
**Problem:** "Re-check broken links" in the GUI looked hung (no live-feed activity, counters stuck at 0)
and offered no Pause/Stop. `reprobe()` logged only via `console.log` (which the GUI bat redirects to the
err log, not the run log it tails), wasn't counted by `processLine()`, and never polled the control files;
`recheckLinks()` disabled Pause/Stop. Separately, the operator asked that a re-check not endanger the main
report if it fails midway.
**Decision (two parts):**
(1) **GUI integration.** `reprobe(cfg, allow, state, srcLabel, logger)` now emits markers to the `--log`
file the GUI tails: `# recheck-start total=N`, per-link `RECHK ok|broken|blocked <url>` (lowercase verdict
so they can't match the crawl's `URL OK/ERR/…` regex), and `# recheck-done … [stopped=1]`. It polls
`cfg.stopFile`/`cfg.pauseFile` in the worker loop (Stop drains, Pause blocks), and on Stop **restores any
links it never reached in their original state** so nothing is dropped. The GUI passes `--log` + the
control files, enables Pause/Stop for `runMode==="recheck"`, parses the markers (re-using gCrawled/gGood/
gBroken/gBlocked as re-checked / now-OK / still-broken / now-blocked + new `gReTotal`/`gReStopped`), and
re-labels the stat chips ("Re-checked K/N · Now OK · Still broken · Now blocked").
(2) **Separate JSON (operator's request).** Re-check writes its corrected state to a **`*.recheck.json`**
sidecar first (shared `buildReportJson()` extracted from `writeOutputs`), and only **then** rewrites the
live report + JSON. Multi-site re-probes every site (writing each sidecar) in phase 1 and rewrites the
per-site reports + index in phase 2 — so a crash/Stop mid-pass never leaves the report set half-rewritten.
Control files are cleaned up at the end.
**Verification:** single + multi-site re-check runs emit the markers, write the sidecars, defer the main
writes (pre-existing `OLD-*` reports only replaced at completion); a pre-set Stop flag yields
`stopped=1`, retains all flagged links unchanged, and cleans the flag; a harness runs the GUI's real
`processLine()` over the actual logs and gets the right counters; HTA parses + stays ES3/ES5.

## AD-042: Live "Broken · internal/external" destination stats during triage
**Date:** 2026-06-26
**Problem:** marking a link **Working** updated the "Broken hyperlink instances" header stat but left the
unique-destination stats ("Broken · internal", "Broken · external") frozen — they were rendered as static
numbers with no id, so the triage script couldn't touch them.
**Decision:** wrap those two numbers in `#brokenIntN` / `#brokenExtN` spans and extend `recomputeBroken()`
(which already runs on load and on every verdict change) to recompute them in the same pass: an Errors row
counts one destination unless confirmed Working; a Blocked row counts only when confirmed Broken, routed
internal/external by its `data-kind`. A `setStat()` helper also keeps each card's red `bad` highlight in
sync (added at >0, removed at 0) — now applied to the instances card too.
**Verification:** vtest gains destination-stat asserts — initial 2/1, drop on Working, re-add on Broken,
blocked-internal vs blocked-external routing, card `bad` toggling at 0, and reload restoring the post-
triage counts — all pass alongside the existing 38 triage / 19 share / newwin asserts.

## AD-043: Errors·external grouped by domain with a domain-level Broken/Working bulk verdict
**Date:** 2026-06-26
**Problem:** the Errors·external tab was a flat list. When a whole site is a systematic blind spot
for the automated check — e.g. social networks (facebook.com) that return 400/403 to the crawler but
load fine in a browser — the user had to tick "Working" on every single link, which is wasted effort
when the trend is obvious.
**Decision:** group Errors·external into **collapsible per-domain `<details>` sections** (largest first),
each summary carrying a **domain-level Broken/Working pair** (floated right, visible even when collapsed)
that **bulk-applies** the verdict to every link in that domain. The domain box is **derived** from its
children (all Working → Working, all Broken → Broken, mixed → neither), so it needs no storage of its own
and reconstructs on reload from the per-link `cwbroken:`/`cwok:` keys. Internal errors aren't grouped
(one domain). Implementation: extracted `triageCells(e)` shared by `pickRows` and a new
`errextDomainGroups(activeExt)` (host via a scheme/userinfo/port-stripping regex); rows carry
`data-domain`; the IIFE gained `applyVerdict(tr,url,want)` (now shared by the per-link handlers too),
`rowsInDomain`/`domBoxes`/`deriveDomain`/`syncDomain`/`applyDomain`/`wireDomains`; domain-box clicks
`stopPropagation` so they don't toggle the `<details>`; Expand all/Collapse all over `.domgrp` only (not
the nested "found on" details). Verdicts still flow through the existing per-URL persistence, so stats,
fix tracker, and sharing all keep working unchanged.
**Verification:** new domtest (26 asserts) — bulk Working/Broken apply + persist + stamp times, derived
mutual exclusivity, a single per-link change desyncing the box to "mixed", unchecking the active box
clearing the domain, and reload deriving the box from saved verdicts — all pass; the per-link refactor
left the existing triage (38)/share (19)/newwin suites green; rendered (headless) — collapsible sections,
domain controls in the header, wide Reason column intact.

### AD-043 follow-up (2026-06-26) — same-day fixes after browser testing
Shipping AD-043 with native `<details>/<summary>` for the domain sections turned out to break three
things in a real browser (none caught by the DOM-stub test, which fires synthetic `change` events):
the domain **Broken/Working checkboxes did nothing and weren't mutually exclusive** (a real click on a
control inside a `<summary>` is consumed by the disclosure toggle, so the checkbox never fires `change`),
and **Collapse all missed groups** (intermittent native-`details.open` behavior, notably the bottom
single-member ones). Replaced the native disclosure with a **custom collapsible**: each `.domgrp` is a
plain `<div>` with a dedicated `.domtoggle` button (caret via CSS `.collapsed`) and the verdict
checkboxes as *siblings* of the button (not nested in a summary); collapse is a `.collapsed` class the
script sets, so Expand/Collapse all set every group with certainty. Also fixed **Import verdicts not
opening a file picker**: the hidden `<input type=file>` (report + fix tracker) moved from
`display:none` to off-screen (`position:fixed;left:-9999px;opacity:0`), the reliable pattern for
programmatic `.click()`. **Verification:** real dispatched-click test in headless Chromium against the
generated report — domain Working/Broken apply to all members, stay mutually exclusive, and Collapse
all/Expand all hit 5/5 groups; domtest grew a collapse section (per-group toggle + all-groups
collapse/expand); triage/share/newwin suites stay green.

## AD-044: "Requests" stat counts internal pages + external destinations verified
**Date:** 2026-06-26
**Problem:** the report's **Requests** stat showed `state.crawled`, which only counts internal page
visits — so it always equalled the **Internal pages** stat and ignored the (often far larger) number of
external links the crawler actually probed when `--check-external` was on. A 2,410-page crawl with 6,479
external destinations still read "2,410 requests".
**Decision:** compute Requests at render time as **internal pages crawled + external destinations
verified**. External links are created with `status: null` and only get `ok`/`err`/`blocked` once probed,
so a non-null status marks a real request — `externalChecked = count(status in {ok,err,blocked})`, and
`requestCount = state.crawled + externalChecked`. This is resume- and rebuild-safe (statuses are in the
JSON) and reads 0 external when checking was off (Requests == internal, correctly). Added a tooltip
spelling out the breakdown; retries/second-pass re-requests are excluded (noted in the tooltip). No new
counter/state needed.
**Verification:** a rebuilt report with 3 internal pages + externals {2 ok, 1 err, 1 blocked, 1 unchecked}
shows **Requests = 7** with the breakdown tooltip; triage/domain suites still pass.

## AD-045: GUI sizes its window to the content on open (was a giant default width)
**Date:** 2026-06-26
**Problem:** the HTA opened at a very wide default, leaving a large empty right margin — the form's
fixed-width fields and the `width:100%` two-column rate-limit table stretched to fill whatever width
the window happened to get.
**Decision:** on boot, `fitWindowWidth()` measures the **natural** content width of BOTH tab panels
at once and `window.resizeTo`s the width to fit (height left as-is). It clones `.wrap` off-screen,
shows both `.tabpanel`s, and neutralizes the stretchy elements (`table.cols`, `<textarea>`, `<pre>`
→ width auto) so they can't inflate the measurement, then reads the clone's `offsetWidth`. Window
chrome is `outerWidth − body.clientWidth` (clamped 26–80); the result is clamped to `[760,
availWidth−40]`. Adaptive — follows whatever the UI needs, so layout changes don't need a new magic
number — and best-effort (try/catch; on any failure the window keeps its default size). Added
`id="wrap"`. (Couldn't be exercised in the Linux dev env — no Trident/mshta — so it's reasoned +
syntax/dialect-checked, with the no-op fallback as the safety net.)

## AD-046: Configurable report pagination breakpoint (--page-size + GUI dropdown)
**Date:** 2026-06-26
**Problem:** report pagination (AD-018) was hardwired to 1,000 rows/page, and the GUI exposed only an
on/off "Paginate report" checkbox. Users wanted to choose the breakpoint. (The internal-pages tab was
already covered — the pager targets `.tablewrap > table` and that table is one — but it was worth
confirming.)
**Decision:** add **`--page-size N`** (cfg.pageSize, default 1,000; implies `--paginate`); the report's
pager script now emits `var PAGE_SIZE=<cfg.pageSize>` instead of the hardcoded constant (the module
`PAGE_SIZE=1000` stays as the fallback default). The GUI's paginate **checkbox became a `<select id=
"pageSize">`** — Off / 250 / 500 / 1,000 / 2,500 / 5,000 — wired through a `pushPageArgs(a)` helper into
all three command builders (crawl / re-check / rebuild): "off" emits nothing (render all), a number emits
`--paginate --page-size N`. The generic config loader already handles `<select>`, so `pageSize` works in
`crawl-gui-config.txt` (replaces the old `paginate` key). Default behavior unchanged (1,000/page).
**Verification:** rebuilt a 25-internal-page report with `--page-size 10`; headless Chromium confirms the
**internal-pages tab paginates** — pager present, 25 rows total, 10 visible, label "Page 1 of 3 · rows
1–10 of 25". HTA parses + ES3/ES5-clean; pushPageArgs wired into all 3 builders; report/triage suites pass.

### AD-039 follow-up #2 (2026-06-26) — the satellite window STILL spawned per click
The held-reference reuse (AD-039) was still opening a fresh window on every link in a real browser.
Root cause: it kept `nw.opener=null` (reverse-tabnabbing hygiene). Nulling the opener REVOKES the
opener's permission to navigate the popup, so cross-origin `SAT.location.replace/href` throws a
SecurityError → the catch nulls SAT → window.open runs again → new window every click. (The stub test
never hit this; it doesn't simulate the cross-origin throw.) Fix: stop nulling the opener — the opener
is then allowed to navigate its own popup (cross-origin navigation is permitted), so the held reference
reuses the one window. The minor reverse-tabnabbing exposure is an accepted trade-off for a local
link-checking tool. One-line removal in NEWWIN.

## AD-047: Fix tracker — reverse mapping (By page <-> By broken link) with synced Fixed flags
**Date:** 2026-06-26
**Problem:** the fix tracker only grouped By referrer page (page -> its broken links). Closing the loop
needs the reverse too: per broken link, which pages still link to it — so a fixer can confirm a unique
broken link is resolved on EVERY page, not just confirm a page is clean.
**Decision:** add a **By page / By broken link** grouping toggle (`.gtab`) beside the Internal/External
tabs. By-page (existing) groups by referrer with the per-page note; By-broken-link groups by URL —
the group header is the link with its Broken/Working verdict + last-tested, and rows are the referrer
pages, each with a Fixed checkbox. Both render the SAME (page,link) pairs, and Fixed state is keyed by
`pkey(ref,broken)`, so a tick in either grouping is the same localStorage flag — switch views and the
equivalent box is already checked. Verdict boxes/last-tested now carry `data-broken` and sync via a
generalized `setVerdict` that scans by attribute (works whether the box sits in a row or a header).
viewMode re-renders both panels; no extra storage. Template stays backtick/${}/backslash-free.
**Verification:** a new revtest (11 asserts, real tracker wiring on an innerHTML stub with working
localStorage) — tick By-page → checked in By-link and vice-versa, untouched pairs stay clear, verdict
set in a row reflects in the other view's header; tracker3 suite still passes; rendered (headless) the
By-broken-link layout. (tracker2's 3 "bake" failures are stale test data — it wants e1/e2 links absent
from synth.html; exportTracker in report.js is unchanged.)

## AD-048: Domain grouping generalized to the Blocked tab + a richer per-domain header
**Date:** 2026-06-26
**Problem:** the by-domain collapsible grouping with a bulk Broken/Working verdict (AD-043) lived only
on Errors·external. Three gaps: (1) the **Blocked·uncertain** tab — where whole-domain false positives
are even more common (anti-bot, rate-limiting) — still showed a flat table; (2) the bare "Broken /
Working" pair read as if it might be a per-domain status, not a bulk action, and gave no signal when a
domain was a *mix*; (3) a collapsed group showed no progress, so you had to expand every domain to see
how far triage had got.
**Decision:** generalize the renderer to **`domainGroups(arr, scope, headHtml, cellsFn)`** and call it
for both tabs — `domainGroups(activeExt, "errext", errextHead, triageCells)` and
`domainGroups(blocked, "blockd", blockdHead, blockedCells)` (new `blockedCells`/`blockdHead` carry the
Kind column + neutral "uncertain" pill). `domainTools(scope)` emits the Expand/Collapse-all buttons with
`<scope>Expand`/`<scope>Collapse` ids. The header gained: an **`All:`** prefix; the bulk boxes relabelled
**"All: Broken / Working"** (label text after the input); a disabled **"Mixture of broken/working"**
indicator (both verdicts present); a disabled **"all tested"** indicator; and a live **"· tested K/N · B
broken · W working"** counter (`.domprog`) visible even when collapsed. Rows + every control carry
`data-domain` AND `data-scope`. In the IIFE the wiring is generalized: `rowsInDomain(host,scope)`,
`domCtl(host,scope,cls)`, `deriveDomain(host,scope)` (derives both bulk boxes + both indicators + the
counter), `applyDomain(host,scope,want)`, and `wireDomains()` loops `['errext','blockd']` →
`wireDomainScope(scope)`. The two indicators are disabled checkboxes whose label goes green via an `.on`
class (`setInd`), so Mixture/all-tested are read-only signals the user can't toggle.
**Verification:** structural grep of a generated report — panel-errext and panel-blockd each render
domgrp/dombroken/domworking/dommixture/domalltested/domprog with rows+controls carrying the right
data-scope. Headless real-click (dispatched MouseEvents): errext bulk-Broken → both rows broken,
all-tested on, counter "tested 2/2"; flip one to Working → Mixture on; Blocked-tab bulk-Working → both
rows working, domWorking on; Collapse-all collapses every group (2/2). domtest (now with data-scope +
indicator asserts), vtest, sharetest, revtest, newwin all PASS.

## AD-049: Persist crawl settings in the JSON so a rebuild/re-check rewrite shows the real config line
**Date:** 2026-06-26
**Problem:** the crawl report's config line (concurrency · delay · rps · max pages/depth · scope · …)
read straight off `cfg`. A fresh crawl was fine, but a **`--rebuild-from`** or **`--recheck-from`**
REWRITE runs in a SEPARATE process whose `cfg` is mostly CLI defaults — the GUI's "Rebuild report"
button (`buildRebuildCommand`) passes NO tuning flags at all, and "Re-check" passes only
concurrency/delay/rps/timeout (not the page/depth limits or scope). So a rewrite stamped the report
with bogus defaults — the user crawled at concurrency 2 / delay 3000 / rps 1 / no page+depth limit but
the rebuilt report showed `4 concurrent · 100ms · no rps cap · max 200 pages / depth 3`. The settings
were never persisted in the `--json`, so on rewrite the originals were simply gone.
**Decision:** persist the crawl's display settings in the report JSON and restore them on rewrite,
WITHOUT touching the live cfg that drives the re-probe. `report.js` gains `effSettings(state, cfg)` —
returns `state.settings` (restored from JSON) when present, else falls back to `cfg`. `buildReport`
builds the config line from it; `buildReportJson` writes a `settings` block
(`{concurrency, delay, rps, maxPages, maxDepth, includeSubdomains, checkExternal}`, with Infinity→null
since JSON has no Infinity); `recheck.loadStateFromJson` reads `j.settings` back onto `state.settings`
(null when an OLD JSON lacks it → graceful fallback to cfg). The re-probe still uses the live cfg
(a user can still re-check at a different rate); only the *displayed/persisted* settings come from the
original crawl. Index report has no config line, so it's unaffected. No GUI/HTA change needed — the fix
is in the data round-trip, so it also covers CLI users and old workflows.
**Verification:** new cfgtest (19 asserts) — fresh crawl still shows real settings (regression guard);
JSON carries the settings block (Infinity→null); load-then-rewrite with a DEFAULT cfg reproduces the
user's case and now shows `2 concurrent · 3000ms · 1 rps cap · max unlimited pages / depth unlimited ·
… · external checked` (NOT the 4/100/200/3 defaults); an old JSON with the block deleted falls back to
cfg without error. Confirmed through the REAL CLI: `node crawl.js --rebuild-from rb.json` emits that
same original-settings line. domtest/vtest/sharetest/revtest/newwin all still PASS.

## AD-050: Dashed-amber header outline on per-domain groups with untested links
**Date:** 2026-06-26
**Problem:** with the per-domain "all tested" indicator (AD-048) you could *read* whether a domain was
done, but there was no at-a-glance cue across many collapsed groups for *which* domains still need
triage — the operator wanted the unfinished ones to stand out.
**Decision:** give a `.domgrp` whose links aren't all tested a dashed-amber header. `deriveDomain`
already computes `tested` and `n`; it now also toggles an `untested` class on the group element
(`setCls(domCtl(host,scope,'.domgrp'),'untested',(n>0&&tested<n))`) — the exact inverse of the
all-tested indicator, so it clears the moment every link in the domain has a Broken/Working verdict and
re-appears if one is cleared. CSS: `.domgrp.untested .domhead{outline:2px dashed var(--warn);
outline-offset:-2px}` — an **inset** outline so the group's `overflow:hidden` can't clip it and it
adds no layout shift. Works on both grouped tabs (errext + blockd) since `deriveDomain` is scope-generic.
**Verification:** 6 new domtest asserts — highlighted on load while untested, still highlighted at 1/2,
clears at 2/2, an untested sibling keeps its highlight, and the state restores correctly from saved
verdicts on reload. Headless screenshot of the Blocked tab confirms the dashed-amber frame around an
untested domain header and none around a fully-tested one. Full suite passes.

## AD-051: Satellite popup shows a brief interstitial naming the next link before it loads
**Date:** 2026-06-26
**Problem:** with the single reused satellite window (AD-039), testing several broken links in a row
that all return the SAME 404/error page is visually indistinguishable — you can't tell the popup
actually navigated to the NEXT link vs. still showing the previous one. The operator wanted a visible
"loading <link>" cue per click.
**Decision:** route every (re)use through a tiny **blob: interstitial** that names the link being
loaded (spinner + "Loading next link…" + the URL + an "Open it directly" fallback) and then
**meta-refreshes** to the target after ~0.6s. Why blob: top-level navigation to `data:` URLs is blocked
by Chrome, so the interstitial can't be a data: URL; a blob works and—crucially—the opener CREATES the
blob, so it's same-origin with it and may navigate even a cross-origin popup to it (the popup's current
origin is irrelevant to the blob-nav security check, which is about the initiator). The redirect is a
`<meta http-equiv=refresh>` (no script in the blob → nothing to escape but HTML; the URL is HTML-escaped
via String.fromCharCode(34) for the quote, keeping NEWWIN backtick/${}/backslash-free). New helpers in
NEWWIN: `esc`, `interURL(href)` (builds the blob, returns its object URL, revoked after 6s), and
`go(win,href)` (navigate to the interstitial; on any throw fall back to a direct
`location.replace(href)` so behavior degrades to the old direct-load). First open now does
`window.open('')` then `go()`, so even the first link shows the cue. **Verification:** confirmed against
the bundled Chromium that a file:// page can top-level-navigate to a blob it created (DOM reached) and
that the interstitial's meta-refresh lands on the target; headless screenshot of the interstitial;
newwin-test extended (16 asserts incl. URL/Blob stubs) — reuse still opens exactly one window and
re-focuses each click, the interstitial names the LATEST link in both its display and meta-refresh, a
reopened-after-close window shows the new link, and ampersands are escaped (a=1&amp;b=2). NEWWIN stays
constraint-clean and parses as valid JS; all suites pass.

## AD-052: Remove the per-referrer "Fixed" checkbox from the base crawl report
**Date:** 2026-06-26
**Problem:** the "Found on" cell of each broken-link triage row carried a per-referrer **Fixed**
checkbox (`.fixbox`, AD-008-era). With the standalone **fix tracker** now owning fix-tracking end to
end (per-referrer Fixed + "Fixed on" times + the By-page/By-link reverse mapping, AD-047), the report's
boxes were redundant and, worse, ephemeral — they never persisted across reloads, unlike the tracker.
Two competing "fixed" affordances was confusing.
**Decision:** drop the report-side Fixed checkbox entirely. `refCellFix` now renders the referrer
page(s) as plain links (single → link; many → the same `<details> N pages link here` disclosure), via
a small `refLink` helper; `reffix` is deleted, as is the `.reffix` CSS and the `.fixbox` change-handler.
`exportTracker` no longer reads `.fixbox` to seed the tracker's `ticked` map — it sets `data.ticked={}`
(the tracker starts clean and manages its own Fixed state), so the now-unused `NL` constant is dropped
too. `refsAll` STAYS (it still feeds the tracker's link→referrers data via `brokenFor`). The Broken/
Working verdict boxes + Last-tested column are untouched. Help text updated: the pickHelp sentence
about "the box beside each found on page" is removed and "Ticks are saved…" → "Verdicts are saved…".
**Verification:** generated report has no `fixbox`/`reffix` and no stale help; "Found on" still renders
referrer links (single `<a>` and multi `<details>`); headless screenshot of Errors·internal confirms a
checkbox-free Found-on column with the verdict boxes intact; tracker3 export suite + domtest/vtest/
sharetest/revtest/newwin all pass.

## AD-053: Unify the fix-tracker export rule + a single always-visible export button
**Date:** 2026-06-26
**Problem:** two friction points in the fix-tracker export. (1) Inclusion was **not uniform**: Errors
(internal/external) were in by default and only dropped when marked **Working**, but Blocked·uncertain
links were the opposite — *excluded* unless you explicitly confirmed each **Broken**. So untested blocked
links silently fell out of the export, and the tracker wasn't a complete to-review list. (2) The
**🔧 Export fix tracker** button lived on each of the three triage tabs' toolbars, so you had to switch
to a tab to reach it.
**Decision:** make the rule **uniform — a link is in the tracker UNLESS it's been marked Working** —
across Errors AND Blocked. In `exportTracker`, the `excl` set now scans the Working boxes on all three
panels (`#panel-errint/.errext/.blockd .okbox`), and `keep()` is applied to `blockedInt`/`blockedExt`
too (then merged into internal/external by kind). The old "include blocked only if confirmed Broken"
(`pickConf`/`conf`/`brokenbox` scan) is deleted. So everything untested — including blocked — is in by
default; Working is the sole drop. Moved the button to **one place in the always-visible share bar**
above the tabs (accent-styled as the primary triage output, with a one-line description), and removed the
per-tab `trackbtn`s: `exportBar` is now just the opt-in allowlist toolbar (empty when that's off) and
`blockedBar` is gone. `blockedHelp` + CRAWLER.md updated to the new rule; the AD-052 leftover "each with
its own checkbox" line in CRAWLER.md was also fixed.
**Verification:** new `exporttest` (13 asserts on the real `exportTracker` via a captured Blob) — by
default untested blocked-internal AND blocked-external are included and routed to the right tab, error
links included, `blockedInt/blockedExt` merged away; marking any link Working (any panel) drops just that
link; untested blocked needs no Broken confirmation. Structural check: exactly **one** `trackbtn`, in the
share bar, none on the tabs. Headless screenshot of the share bar shows the prominent button + description.
domtest/vtest/sharetest/revtest/newwin/tracker3 all pass.

## AD-054: Stats row — test-completeness outlines, broken-first order, "Total unique destinations"
**Date:** 2026-06-26
**Problem:** three asks for the headline stats. (1) The three "broken" stats (Broken hyperlink instances,
Broken·internal, Broken·external) gave no signal of whether they were *trustworthy yet* — a count is only
final once every link in that category has been triaged. (2) They're the most important numbers but were
scattered mid-row. (3) The "Requests" stat (AD-044) was poorly named for what it represents.
**Decision:**
- **Test-completeness outline.** Each of the three broken cards gets a dashed outline: **green** when
  every triageable link in its category has a verdict (count is final), **amber** while any remain
  untested (count may still change), none when there's nothing to test. "Category" = Internal (errint
  rows + blocked-internal), External (errext rows + blocked-external), and — because **Broken hyperlink
  instances** spans both plus blocked — its outline needs *every* triage link tested. Computed inside the
  existing `recomputeBroken()` (so it updates live on load and every verdict change) via a new
  `setTestState(el,tested,total)`; the tally is folded into recomputeBroken's existing single pass. CSS:
  `.stat.tested-all{outline:2px dashed var(--good);outline-offset:-1px}` / `.tested-partial{...var(--warn)}`
  — inset outline, so no layout shift; independent of the red `bad` number class.
- **Broken-first order.** The three broken stats moved to the front (left/top) of the grid.
- **"Total unique destinations"** replaces "Requests": value = `state.pages.length + state.external.size`
  (internal + external destinations), positioned right after External destinations as their running total
  (so the trio reads Internal → External → Total). The old request-count value (`crawled + externalChecked`,
  AD-044) is dropped along with its now-dead `requestCount`/`externalChecked`; **Queued** stays on partial
  reports. **This supersedes AD-044.**
**Verification:** headless real-click probe on the rendered report — on load all three broken cards are
`tested-partial` (amber); after marking the 3 internal-category links, Broken·internal flips to
`tested-all` (green) while Broken·external and Broken hyperlink instances stay amber; after the 2
external-category links, all three are green. Structural: stat order is broken-trio first, then
Internal/External/**Total unique destinations** (= 5 = 3+2), "Requests" gone. domtest/vtest/sharetest/
revtest/exporttest/newwin/tracker3 all pass.

## AD-055: Stats as a broken-over-total matrix; Runtime/Suppressed to the header
**Date:** 2026-06-26
**Problem:** the operator wanted the headline stats laid out as a deliberate **two-row matrix** where each
*broken* count sits directly above its *total*, plus a new **Total unique destinations broken** to pair
with **Total unique destinations** — and Runtime/Suppressed moved out of the result grid (they describe
the RUN, not the results).
**Decision:** fix the grid to **5 columns** (`repeat(5,minmax(0,1fr))`, collapsing to 2 on ≤640px) and
order the cards so columns pair broken-over-total:

| Broken hyperlink instances | Broken·internal | Broken·external | **Total unique destinations broken** | Blocked·uncertain |
| Hyperlink instances | Internal destinations | External destinations | Total unique destinations | *(Out-of-scope when scoped, else empty)* |

The new **`brokenTotN`** = `uInt + uExt` (unique broken destinations, internal + external incl. confirmed
blocked), server-rendered as `activeInt+activeExt` and updated live in `recomputeBroken`; it carries the
same green/amber test-completeness outline as Broken hyperlink instances (both span every triageable link).
**Blocked·uncertain** stays in row 1 but as the col-5 outlier (it's neither a broken count nor a total),
with no outline. This reconciles the operator's two messages — Blocked in row 1 *and* Total-unique-broken
above Total-unique-destinations — at the cost of one empty cell at row-2/col-5 (filled by the Out-of-scope
card on scoped crawls; `oosStat` is the grid's last card). **Runtime** and **Suppressed** left the grid and
were appended to the header config line (`cfgLine`) as run metadata (`· ran in 1s · 0 suppressed`;
partial reports show `· <dur> so far`). Queued stays a partial-only card.
**Verification:** structural — 9 cards in the matrix order, brokenTotN present, Runtime/Suppressed cards
gone, header line carries runtime + suppressed. Headless real-click probe: on load all four broken stats
(incl. brokenTotN) are amber; marking the internal-category links greens Broken·internal only; marking the
rest greens all four; brokenTotN's value rises 3→5 as the two blocked links are confirmed broken.
domtest/vtest/sharetest/revtest/exporttest/newwin/tracker3 all pass.
