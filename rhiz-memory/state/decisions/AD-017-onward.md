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
**Follow-up (2026-06-27) — old JSONs still showed bogus defaults.** AD-049 only helps a JSON that HAS the
settings block; rebuilding/re-checking a JSON written BEFORE the block existed (the operator's 4h-26m
crawl from 06-25) still fabricated "max 200 pages / depth 3" — clearly wrong (it crawled 3,512). Root
fix: `settingsAreKnown(state, cfg)` = `state.settings present` OR `not a --rebuild-from/--recheck-from
run`. When false (a rewrite of a settings-less JSON) the config line shows **"crawl settings not recorded
(rebuilt from an older crawl's JSON)"** plus the parts that ARE in the JSON (scope, runtime, suppressed,
retries) instead of inventing defaults; and `buildReportJson` OMITS the settings block in that case, so
the rewrite process's defaults are never laundered into a fresh block (which would make the next rebuild
trust them). New cfgtest2 (8 asserts): fresh shows real cfg; rewrite-with-settings shows them; rewrite of
a settings-less JSON says "not recorded" (no 200/3) yet keeps runtime+scope; JSON records settings for
fresh, omits for the old-JSON rewrite, re-persists when present.

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

## AD-056: Each broken stat shows count + a live "(percent)" of the total below it
**Date:** 2026-06-26
**Problem:** the operator wanted the headline broken stats to read as a combo — count *and* percent —
not just a bare count.
**Decision:** since the matrix (AD-055) already places each broken count directly above its total, the
natural denominator is that total. The four broken stats now render `N (P%)` where P% = count ÷ the row-2
total in the same column: Broken hyperlink instances ÷ Hyperlink instances, Broken·internal ÷ Internal
destinations, Broken·external ÷ External destinations, Total-unique-destinations-broken ÷ Total unique
destinations. A `brokenN(id,count,denom)` render helper emits the count span + a muted `.pct` span
(`(60%)`, ~14px); `setStat(el,v,denom)` gained a denom arg and rewrites the `.pct` sibling, so the percent
**updates live** with the count as you triage (denominators are the fixed row-2 totals, embedded as
`DENOM={inst,int,ext,tot}` in the IIFE). Omitted when the denominator is 0. The percent is deliberately the
share of the *displayed* total below it (transparent arithmetic — both numbers are visible in the column),
so for Broken·internal it's "broken vs. crawled internal pages" (Internal destinations counts crawled
pages, not broken ones); Blocked·uncertain (the col-5 outlier) and the row-2 totals stay bare counts.
**Verification:** server-side render shows 6 (60%) / 2 (67%) / 1 (50%) / 3 (60%) for the synth fixture
(= 6/10, 2/3, 1/2, 3/5). Headless real-click probe confirms live recompute: marking e1 Working →
int 1 (33%), tot 2 (40%), inst 3 (30%); then confirming blocked b1 Broken → inst 8 (80%), int 2 (67%),
tot 3 (60%). Full suite passes.
**Follow-ups:** (a) one decimal by default (60.0% / 66.7%). (b) then **adaptive precision** — an
`fmtPct(p)` helper (mirrored server-side + in the IIFE, ES5-clean) keeps one decimal for normal values
but expands precision until a small-but-nonzero share shows ≥1 significant digit, so 1 broken / 10,000
reads **0.01%** not a misleading 0.0% (0.04%→0.04, 0.034%→0.03, 0.0001%→0.0001; true 0 stays 0.0%).

## AD-057: Blocked·uncertain gets the tested-outline too + a legend card keys the colors
**Date:** 2026-06-26
**Problem:** the green/amber test-completeness outline (AD-054/055) was on the four broken stats but not
on **Blocked·uncertain**, even though its links are triaged the same way — and nothing on the report
explained what the dashed colors mean.
**Decision:** (1) give the Blocked·uncertain card the same outline — GREEN once every blocked link has a
verdict (Broken or Working), AMBER while any remain untested. `recomputeBroken` now tallies `bT/bN` over
ALL blocked rows (any kind) and calls `setTestState(blockedN, bT, bN)`; the card's count got a
`<span id="blockedN">` so it's targetable. (2) Fill the previously-empty **row-2/col-5 slot** (under
Blocked) with a **legend card**: a `.statleg` with a **grey** dashed outline (`var(--muted)`) containing
an "Outline key" — a green dashed swatch = "all tested — count is final", an amber dashed swatch = "some
untested — may change". Rendered only when `hasTriage` (no outlines → no legend); `oosStat` moves to the
overflow row when scoped. So the whole stats block now reads: row 1 = outlined tracked counts (incl.
Blocked), row 2 = plain totals + the legend that decodes the outlines, directly under the Blocked card it
mirrors.
**Verification:** structural — legend card + green/amber swatches + `blockedN` + `.statleg` CSS all
present. Headless real-click probe: Blocked outline starts `tested-partial` (amber), stays amber after one
of its two links is tested, flips to `tested-all` (green) once both are; legend present throughout.
domtest/vtest/sharetest/revtest/exporttest/newwin/tracker3 all pass.

## AD-058: Triage tables size to content + drag-resizable columns
**Date:** 2026-06-27
**Problem:** the triage tables were `width:100%` + `table-layout:fixed` with URL & Reason the only unsized
columns, so on a wide window they split all the slack — Reason ballooned to ~900px for a tiny "HTTP 404"
pill, leaving a giant mid-table gap. No fixed default suits every screen, so the operator asked for
**user-resizable columns**. (Fixed first: a related overflow — the `.domgrp .tablewrap` override leaked
`overflow:visible` onto the nested "Found on" `<details>` wrapper, so a 35-referrer list spilled over the
rows below; scoped that override to `.dombody` — committed separately.)
**Decision:** (1) **size to content** — Reason gets a fixed 180px, URL stays the lone elastic column, and
the triage tables use `width:max-content` (table = sum of column widths, left-aligned) instead of
stretching to 100%, so no mid-table gap (slack becomes a clean right margin the user can reclaim).
Restored the AD-040 `:first-child{min-width:0}` guard (a global `th:first-child{min-width:360px}` for
URL-first tables was bloating the timestamp column once max-content was on). (2) **drag-resizable
columns** — every header cell gets a `.colgrip` (absolute, right edge, `col-resize`); dragging sets that
column's px width and **broadcasts it to the same column index in every table of the tab** (Errors·external
/ Blocked render one table per domain group, so they stay aligned). Widths persist per tab in localStorage
(`cwcol:host:scope`) and restore on load; a **"↔ Reset column widths"** button (in each tab's counter bar)
clears them. ES5-clean, in the triage IIFE.
**Verification:** headless render — default Broken·internal is compact (LAST TESTED 140 / URL 380 / REASON
180 / FOUND ON 236, left-aligned, no gap) and applying a width reflows the table; DOM probe of a real drag
(Blocked tab, 2 domain groups) — 7 grips/table, the URL column resizes, the 2nd group's URL column
broadcasts to the same width, persists to `cwcol:x:blockd`, and Reset clears both inline widths + storage.
Full suite passes.

## AD-059: Broken·internal grouped by first-level path folder
**Date:** 2026-06-27
**Problem:** Errors·external and Blocked group by domain, but Errors·**internal** was a single flat table
— on a big site that's hundreds of broken pages with no structure. The operator wanted the same
collapsible grouping for internal, keyed by the **first path folder** (`site.gov/about/` vs
`site.gov/blog/`) so a whole section can be triaged together.
**Decision:** generalize `domainGroups(arr, scope, headHtml, cellsFn, keyOf)` with an optional key
function (defaults to `hostOf`), and add `folderOf(u)` = host + first non-empty path segment + "/" (root
pages → bare host; subdomains naturally split). The Errors·internal panel now renders
`domainGroups(activeInt, "errint", errintHead, triageCells, folderOf)` with `domainTools("errint")` and a
`folderHelp`, replacing the flat `pickRows` table (now removed). `wireDomains()` added `'errint'`, so the
existing per-group machinery — bulk **All: Broken/Working**, **Mixture**/**all tested** indicators, live
**tested K/N** counter, dashed-amber untested outline (AD-050), Expand/Collapse-all — works unchanged. The
group controls' tooltips were reworded "domain"→"group" (neutral for both). `recomputeBroken` + the panel
`tcount` already query `tr[data-url]`, so the header stats + counter still update across groups. Partial
(read-only) reports keep the flat table.
**Verification:** generated report — Errors·internal renders 5 folder groups (`…/about-dhw/`, `…/media/`,
`…/providers/`, `…/services-programs/`, `…/registry.prometric.com/`) from a mixed-path fixture; headless
functional probe — a group starts amber `tested 0/1`, **All: Working** flips it to `tested 1/1 · 1 working`
with the untested outline cleared + the row's okbox checked, and the panel counter moves to `1 / 5`.
domtest (domain infra) + vtest/sharetest/revtest/exporttest/newwin/tracker3 all pass.

## AD-060: Consistent fixed-height internal-scroll viewport across all tabs
**Date:** 2026-06-27
**Problem:** scroll behaviour was inconsistent — the flat tables (Internal destinations, Suppressed,
Out-of-scope) sat in a fixed-height `.tablewrap` (max-height + `overflow:auto`, internal scrollbar), but
the GROUPED tabs (External destinations, Broken·internal/external, Blocked) let their group list grow to
fit and relied on the whole-window scrollbar. The operator wants the fixed-size-viewport-with-internal-
scrollbar everywhere.
**Decision:** a `.groupview{max-height:460px;overflow:auto;border;radius;padding}` (same height as
`.tablewrap`) and a `groupView(inner)` helper now wrap the grouped output of all four grouped panels
(`extGroups`, and `domainGroups(...)` for errint/errext/blockd) — so each tab's list scrolls *in place*
rather than stretching the page. Toolbars (Expand/Collapse-all, help, counters) stay ABOVE the viewport.
The triage wiring is unaffected: `panel(scope).querySelectorAll(...)` still finds the groups/rows/tables
through the wrapper, and the resizable-column `triTables` still resolves. Nested Found-on `<details>`
keep their own 220px inner scroll.
**Verification:** headless render of a 14-folder Broken·internal fixture — the groups sit in a bordered
fixed-height viewport with a visible internal scrollbar (page no longer grows); the toolbars/counter stay
outside it. Full suite (domtest/vtest/sharetest/revtest/exporttest/newwin/tracker3) passes.

## AD-061: Non-triage tabs (Internal destinations / External / Out-of-scope) get the same folder/host-grouped collapsibles
**Date:** 2026-06-27
**Problem:** the triage tabs and Broken·internal all group into collapsible `.domgrp` sections (caret +
name + count) inside the `.groupview` viewport, but the NON-triage tabs were a mix: External used native
`<details>` while Internal destinations and Out-of-scope were one flat multi-thousand-row table. The
operator wants "simple folder-grouped collapsible sections" with "a count under each section" everywhere —
and, per the scroll-consistency ask (AD-060), the same single internal scrollbar on every tab.
**Decision:** a `simpleGroups(items, keyOf, headHtml, rowFn, tcls)` helper renders the SAME `.domgrp`
collapsible the triage tabs use (caret + `.domname` + muted `(count)`) but WITHOUT the verdict controls,
and a `groupCount(items, keyOf)` gives the header's "N folders / N domains". `keyOf` is `hostOf` for
External (group by domain) and `folderOf` for Internal destinations + Out-of-scope (group by first-level
folder). All three render `groupView(simpleGroups(...))` with Expand/Collapse-all buttons. The old inline
`extGroups`/`byHost`/`rowsInternal`/`oosRows` are gone; External migrated off `<details>` so every tab now
uses one collapsible mechanism + one scroll viewport. A SEPARATE collapse-only IIFE wires the three
non-triage panels (`['panel-external','ext'],['panel-internal','int'],['panel-outscope','oos']`): it
toggles `.collapsed` on click and Expand/Collapse-all — and deliberately never calls `deriveDomain`, so
these groups never pick up the triage tabs' amber "untested" outline (a triage-only signal). Pagination
still works: each group's body is `.tablewrap.dombody`, so the `--paginate` pager (`.tablewrap > table`)
paginates a huge folder just as it did the old single table; small folders no-op. `pagestbl` column widths
are reused for the Internal groups.
**Verification:** headless probe on the synthetic report — Internal groups by folder (`x/`, `x/a/`, `x/p/`)
with per-section counts; clicking a `.domtoggle` collapses just that group; Collapse-all/Expand-all set
every group; no group ever gets the `untested` amber class. A scoped fixture confirms Out-of-scope groups
by folder (`x/blog/ (2)`, `x/ (1)`, `x/news/ (1)`). Screenshot confirms the look matches the other tabs.
Full suite (domtest/vtest/sharetest/revtest/exporttest/cfgtest/cfgtest2/newwin/tracker3) passes.

## AD-062: Fix tracker gets the report's grouping affordances — collapsible sections, fixed-counters, completion outline, viewport + pagination
**Date:** 2026-06-27
**Problem:** the standalone fix tracker rendered every group (By page = referrer→its broken links; By
broken link = link→the pages linking it) as an always-open card in a page-height list. With thousands of
referrer pages that is unscannable and heavy, and there was no at-a-glance sense of which groups are done.
The operator wants the report's grouping vocabulary here too: collapsible sections, a per-section fixed
counter, an amber-dashed "still needs a fix" outline, Expand/Collapse-all, a fixed-height internal-scroll
viewport, and pagination so a huge set doesn't all render at once — on every tab (By page / By broken link
× Internal / External).
**Decision:** `render()`/`renderByLink()` now RETURN AN ARRAY of group-HTML strings (not one joined blob).
Each group is a collapsible `.grp` with a caret `.grptoggle` button (toggles a `.collapsed` class hiding a
new `.grpbody` wrapper that holds the reason + table), plus a `.grpfix` "K/N fixed" counter. A
`refreshGroup(g)` recomputes that counter live from the group's own Fixed boxes on every tick and sets the
completion outline: `.needfix` (amber dashed) while any link is unfixed, `.alldone` (green dashed) once all
are ticked. The two panels are wrapped in `.trkview` fixed-height viewports (max-height:72vh, internal
scroll). Group-level pagination: `PER_PAGE=50`, a per-tab `pageState`, `fillPanel()` slices the array and
renders a `.pager` (‹ Prev · Page X of Y · N groups · Next ›) above+below when a tab exceeds PER_PAGE;
Prev/Next just bump pageState and re-`fill()`. Global Expand all / Collapse all buttons set every rendered
`.grp`. All wiring uses tiny `hasCls/addCls/toggleCls/grpOf` helpers (no classList/closest) so the same code
runs under the DOM-stub tracker tests and matches the report IIFE idiom. Authored within the template's
no-backtick / no-`${}` / no-backslash constraint (caret glyphs are literal ▼/▶, not CSS escapes).
**Verification:** a real-browser probe on a 121-group synthetic tracker — 50 groups render per page
("Page 1 of 3 · 121 groups"), caret collapses a group, Collapse-all/Expand-all flip every group, ticking a
group's only Fixed box flips it `0/1 fixed` amber → `1/1 fixed` green, and Next advances to "Page 2 of 3".
Screenshot confirms amber outlines on partially/zero-fixed groups and a green outline on a fully-fixed one.
The maintained suite (domtest/vtest/sharetest/revtest/exporttest/cfgtest/cfgtest2/newwin/tracker3 = 170
assertions) stays green; the stale scratchpad tracker-test/tracker2-test failures pre-date this change
(they assert an older fixture shape and were never in the maintained set).

## AD-063: User-resizable viewport height (drag the bottom-right grip) across the report + tracker
**Date:** 2026-06-27
**Problem:** every list now lives in a fixed-height internal-scroll viewport (report `.groupview` /
`.tablewrap`, tracker `.trkview`). A single fixed height can't suit every screen or list, and the operator
wants to drag a viewport taller/shorter rather than accept one height.
**Decision:** add CSS `resize:vertical` (+ a sensible `min-height`) to the top-level viewports — the
report's `.groupview` (160px) and flat `.tablewrap` (140px), and the tracker's `.trkview` (160px) — so each
grows a bottom-right drag grip (works because they're already `overflow:auto`). Crucially this is scoped to
TOP-LEVEL viewports only: the report's triage group bodies `.domgrp .dombody` (which are `overflow:visible`,
size-to-content) get `min-height:0;resize:none`, and any NESTED `.tablewrap .tablewrap` (the "Found on"
referrer sublists, error subtables) get `min-height:0;resize:none` — so a 2-referrer Found-on list is never
forced to 140px or sprouts its own grip.
**Verification:** computed-style probe — `.groupview` resize=vertical / min-height=160px; the first
`.domgrp .dombody` resize=none / min-height=0px; a nested Found-on `.tablewrap` resize=none / min-height=0px;
the tracker `#view-int` resize=vertical. Screenshots show the diagonal resize grip at the bottom-right of
both the report's grouped viewport and the tracker viewport.

## AD-064: Fix-tracker section refinements — All:Fixed bulk box, stacked header, resolve-or-working outline, out-of-scroll pager, true drag-resize
**Date:** 2026-06-27
**Problem:** review of the AD-062 tracker surfaced five issues. (1) A section needed a one-click "mark
everything here fixed". (2) The grouped key is a long URL, so cramming the link + counters + verdict +
notes on one right-aligned row wrapped badly. (3) The green "all fixed" outline was noise; and a section
with a link marked **Working** (a false positive, no fix needed) still showed amber forever. (4) The
pager rendered inside the scroll viewport, so scrolling a page's groups hid Prev/Next. (5) The resize grip
(AD-063) could only shrink — `max-height` capped growth, so you couldn't drag a viewport taller.
**Decision:** (1) each section header gets an **All: ☐ Fixed** bulk checkbox (`.grpfixall`) — `bulkFix(g,on)`
ticks/persists/stamps every Fixed box in the group; `refreshGroup` drives the box's checked/indeterminate
state from the group's fixed count. The Broken/Working **verdict boxes stay** (the operator confirmed the
per-link bulk verdict is useful) — we ADD All:Fixed beside them, not replace. (2) the header is now a
COLUMN: `.grptop` (caret + link) / `.grpctl` (count, K/N fixed, All:Fixed, and By-broken-link's Last
tested/Broken/Working) / `.grpnote` (By-page Notes) — all left-aligned. This is tracker-only; the report's
domain headers keep their single right-aligned row. (3) the completion outline is now a **translucent
amber** (`rgba(251,191,36,.55)`) shown only while a section has a link **neither Fixed nor Working**, and
it just clears when all are resolved — the green `.alldone` is gone. `rowWorking(g,tr)` reads the group's
`.vo` boxes (row-level in By page, header-level in By broken link) so a Working tick resolves a row;
verdict-box handlers now call `refreshAllGroups()` so the outline updates live. (4) the pager moved OUT of
`#panel-*` into a sibling `.pagerbar` ABOVE the `.trkview` (new `.tabview` wrapper per tab holds bar +
viewport; tab switch toggles the wrapper) — `fillPanel` writes the pager to `#pager-<which>` and the groups
to `#panel-<which>`. (5) all top-level viewports (`.groupview`/`.tablewrap` in the report, `.trkview` in
the tracker) switched from `max-height` to a definite **`height`** (460px / 72vh) with `resize:vertical` +
`min-height` and NO max-height — so the grip drags both ways and can grow unbounded; nested `.tablewrap
.tablewrap` and `.domgrp .dombody` are pinned to `height:auto;resize:none` so found-on sublists / triage
bodies still size to content.
**Verification:** real-browser probes — All:Fixed ticks all rows (counter 2/2, amber clears, box checked);
unticking one row returns amber + sets the box indeterminate; marking a group **Working** clears amber at
0/N fixed; an untouched group stays amber; header renders `.grptop`+`.grpctl`+`.grpnote`; the pager lives
in `#pager-int` (`pagerInBar=1`, `pagerInPanel=0`); `.trkview`/`.groupview` compute `height:585px/460px`
with `max-height:none` while `.domgrp .dombody` is `72px` content height with `resize:none`. Screenshot
confirms the stacked header, the All:Fixed box, translucent amber on a Broken section, NO outline on a
Working section, and the Prev/Page/Next bar above the scroll area. Full suite 170/0 (revtest's verdict
sync still passes through the header restructure).

## AD-065: Resizable columns on the non-triage tabs, no minimum column width, and collapsible per-tab help
**Date:** 2026-06-27
**Problem:** three gaps surfaced after the AD-061 folder grouping. (1) The drag-resizable columns (AD-058)
only worked on the triage tabs — the Internal/External/Out-of-scope grouped tables were plain `<table>`,
so their columns couldn't be resized (External's long "Found on" URLs had nowhere to go). (2) Some columns
had CSS `min-width` (`.tcol` 80, `.pickcol` 34, the global first/last-child 360/300) and a 40px grip floor,
so a few columns refused to shrink while others shrank freely — inconsistent, and the operator wants to
decide widths themselves. (3) The per-tab explanatory text is lengthy and always-on, eating screen space.
**Decision:** (1) the non-triage group tables are now `table.grptbl` (table-layout:fixed; width:max-content;
default per-column widths set inline in the head), and the always-run non-triage IIFE carries its OWN copy
of the resize machinery (`colKey/loadCols/grpTables/applyCol/saveCol/gripDown/wireResize/resetCols`, keyed
`cwcol:host:<internal|external|outscope>`) — the triage resize lives in a triage-only IIFE that bails when
there are no verdict rows, so it can't be reused. A grip per header broadcasts the new width to that column
index across every group table in the tab; an "↔ Reset column widths" button sits in each tab's exptools.
(2) ALL enforced minimums are gone: the resizable tables use a blanket `th,td{min-width:0}`, `.tcol`/
`.pickcol` lost their `min-width`, and the grip floor dropped 40→16px (both triage + non-triage) — so any
column drags as narrow as you like. (3) a `helpBox(inner)` wraps each triage tab's lengthy help
(pickHelp/domainHelp/folderHelp/blockedHelp) in a `<details class="helpbox" open>` titled "How this tab
works"; the one-line tab intro stays visible, the detail folds away, and the open/closed state persists via
the existing charlotteD_ `<details>` persistence.
**Verification:** headless probes — External/Internal/Out-of-scope render `table.grptbl` with a grip per
header and an "↔ Reset column widths" button; dragging a header sets the width, BROADCASTS it across all
group tables in the tab (`urlColAcrossTables=480px,480px,480px`), persists to `cwcol:x:external`, and Reset
clears both the inline widths and the key; a column drags down to 16px (no minimum); first-column
`offsetWidth` reads correctly (64/380). The help `<details>` is present, open by default, and collapses.
Screenshot confirms the "How this tab works" disclosure on Broken·external. Full suite 170/0.

## AD-066: Light/dark theme toggle on the report + fix tracker
**Date:** 2026-06-27
**Problem:** the crawl report and the standalone fix tracker were dark-only; the operator wants a light option.
**Decision:** the palette is already CSS custom properties (`:root` = dark default), so a light theme is just
an override block on `html[data-theme="light"]`. Crucially it hangs off a data-ATTRIBUTE, NOT a class, so it
never collides with the no-flash tab restorer that owns `html.className` (`tab-<name>`). A new `--accent-fg`
variable carries the on-accent text colour (`#06121f` dark / `#ffffff` light) and replaces the 4 hard-coded
`#06121f` (active tab + accent buttons) that would otherwise be unreadable on the light accent. A fixed
top-right `.themebtn` (🌙/☀️) toggles `data-theme` + persists `charlotteTheme` in localStorage; a tiny head
script applies the saved choice before first paint (no flash). Shipped into BOTH report variants (single-site
+ multi-site index) via shared `THEME_LIGHT_CSS`/`THEME_HEAD`/`THEME_BTN`/`THEME_JS` consts, and inline into
the tracker — constraint-clean (the toggle JS is single-quote + `+`-concat, no backtick/`${}`/backslash, so it
drops straight into TRACKER_TEMPLATE). The tracker's baked "Save copy" captures the live `data-theme` in its
`outerHTML`, so a shared copy opens in the same theme.
**Verification:** headless — button present; a `dark→light→dark` click round-trip flips `data-theme`, persists
`charlotteTheme`, and swaps the 🌙/☀️ icon; light-mode screenshots of the report and tracker show readable
contrast + white-on-accent tabs/buttons. Tracker template stays 0 backtick / 0 `${}` / 0 backslash; suite 170/0.

## AD-067: Two-level nesting in the fix tracker — page/link sections roll up under a folder/domain parent
**Date:** 2026-06-27
**Problem:** the tracker grouped only at the finest level — one section per referrer page (By page) or per
broken link (By broken link) — with no coarser bucket, unlike the report (External by host;
Internal/Broken·internal by first-level folder). With thousands of sections it leaned entirely on the
50/page pager. The operator wanted the report's roll-up: nest the sections under a collapsible folder/domain.
**Decision:** wrap the sections under a collapsible `.parent` keyed like the report — the broken link's HOST
(External + By broken link) or the first-level path FOLDER (everything else, incl. the By-page referrer
pages, which are internal). `render`/`renderByLink` now emit `{p, html}` per section; `orderByParent` sorts
so same-parent sections are contiguous (bigger parents first, then alpha). `fillPanel` still paginates by
SECTION (PER_PAGE=50, so the DOM stays bounded no matter how lopsided the folders are) and wraps each page's
runs of same-parent sections in a `.parent` with a caret + "(N sections)" total — a parent straddling a page
boundary simply repeats its header on the next page. Regex-free `hostOf`/`folderOf` (string ops only — the
template forbids backslashes) compute the keys. Parent carets toggle `.collapsed`; "Collapse all" now
collapses parents (bird's-eye of folders/domains), "Expand all" opens parents + sections. The (page,link)
Fixed/verdict/notes wiring is untouched — sections are just nested deeper and every `querySelectorAll` is
descendant-based, so refreshGroup/bulkFix/setVerdict and the By-page↔By-link sync still resolve.
**Verification:** headless — Internal/By-page parents = referrer folders (`/services-programs/ (2)`,
`/blog/ (1)`); Internal/By-link parents = broken-link folders (`/a/ (2)`, `/b/ (1)`); External/By-link
parents = domains (`www.facebook.com (2)`, `twitter.com (1)`), all count-desc; a parent caret collapses with
its sections still nested. Screenshot shows a folder parent wrapping the page sections. Tracker template stays
0 backtick / 0 `${}` / 0 backslash; full suite 170/0 (revtest's By-page↔By-link sync passes through the nesting).

## AD-068: Inverted Fixed/Broken stat matrix on the fix tracker
**Date:** 2026-06-27
**Problem:** the tracker had no top-level scoreboard; the operator wanted the report's stat matrix, but keyed
to the tracker's TWO ORTHOGONAL axes — BROKEN (does the link load = the verdict) and FIXED (has the page's
reference been remediated = the Fixed checkbox). They are independent: a link can be verdict-Broken with its
reference Fixed, or verdict-Working (no fix needed) etc.
**Decision:** a 2×3 `.statcard` above the tabs. **Bottom row = BROKEN (verdict-driven):** a link counts while
its verdict ≠ Working; Broken internal/external destinations = distinct such links (per tab); Broken hyperlink
instances = the sum of their referrer pages. **Top row = FIXED (remediation-driven),** counted ONLY among
broken links so it's always a share of Broken: Fixed hyperlink instances = (page→link) pairs whose Fixed box
is ticked; Fixed internal/external destinations = broken links ALL of whose references are fixed. Each Fixed
card shows count + "(% of broken)". `recompute()` iterates `DATA.{internal,external}` reading the LIVE verdict
(`initVerdict`) + Fixed (`initChecked`), and runs from `progress()` — so it fires on every Fixed tick,
All:Fixed, Clear-ticks, AND (newly wired) Broken/Working change. Marking a link Working drops it from BOTH the
broken counts and any fixed it contributed; marking it Broken again restores both (Fixed flags persist).
Inverted vs the report (Fixed on top, Broken below) because in the tracker the fix progress is the headline.
**Verification:** headless transition probe — init `b:4/2/1 f:0/0/0`; fix A's two refs → `f:2/1/0 (50%)` (A
becomes a fixed destination at 2/2); mark A Working → `b:2/1/1 f:0/0/0` (broken + fixed both drop correctly);
un-Working → `b:4/2/1 f:2/1/0` restored. Screenshot shows the green-Fixed-over-red-Broken matrix. Tracker
template stays 0 backtick / 0 `${}` / 0 backslash; full suite 170/0.

## AD-069: Export/Save buttons use the File System Access "Save As" picker (download fallback)
**Date:** 2026-06-27
**Problem:** every Export/Save button — report: Export verdicts, Save shareable copy, Export fix tracker,
(legacy) allowlist export; tracker: Export, Save copy — used the `<a download>` trick, which drops the file
into the browser's default Downloads folder with no choice of location or name. The operator wants a folder
picker. (Import already opens a picker via `<input type=file>`, so it was already fine.)
**Decision:** a `saveBlob(blob, name, okMsg)` helper tries `window.showSaveFilePicker()` (a real "Save As"
dialog — operator picks folder + filename; the `types` accept-map is derived from the file extension), writes
the blob to the returned handle, then toasts success. Feature-detected: where the API is missing OR throws
(non-Chromium, or a restricted context), it falls back to the old `<a download>` path; cancelling the picker
(AbortError) is silent. This is exactly the additive, download-as-universal-fallback enhancement AD-034
deferred to "if revisited" — localStorage auto-save is untouched. The report has TWO export IIFEs (the
allowlist/tracker-export script and the share-toolbar script) in separate scopes, so `dl`+`saveBlob` are
duplicated into both — same pattern as the already-duplicated `toast`. The suite caught the first cut calling
`saveBlob` across the IIFE boundary (`saveBlob is not defined` — a REAL ReferenceError that would also fire in
the browser, not just a test artifact). The tracker is one IIFE; its `saveBlob` is constraint-clean
(no backtick/`${}`/backslash).
**Verification:** `showSaveFilePicker` is present on `file://` in Chromium (probed = `function`). Headless with
a stubbed picker: clicking "Export fix tracker" calls
`showSaveFilePicker({suggestedName:'charlotte-fix-tracker.html', types:[{accept:{'text/html':['.html']}}]})`
and writes the 43 KB blob to the handle. With the picker absent (the DOM-stub suites) it falls back to
download — full suite 170/0 including exporttest (13) and tracker3 (18).

## AD-070: Export filenames carry an auto-appended timestamp in the suggested name
**Date:** 2026-06-27
**Problem:** with the "Save As" picker (AD-069) the operator now names every export, but the *suggested* name
was a fixed string (`charlotte-fix-tracker.html`, `charlotte-verdicts-<host>.json`, …). Re-exporting through
a day's triage either silently overwrites the previous file or forces the operator to hand-type a version
suffix every time. They wanted the picker to pre-fill a timestamped name so each export is naturally its own
versioned file.
**Decision:** stamp the timestamp inside `saveBlob(blob, name, okMsg)` — at the very top, before either the
picker or the download branch — so it covers BOTH paths and EVERY caller (Export verdicts, Save shareable
copy, Export fix tracker, allowlist export; tracker Export + Save copy) with one edit per scope. Format is
`<name>_YYYY-MM-DD_HH-MM_SS.<ext>` (e.g. `charlotte-fix-tracker_2026-06-27_14-03_09.html`), matching the
literal shape the operator asked for (date dash-joined, an underscore to the time, hour-minute dash-joined, an
underscore to seconds). Built from `new Date()` with a 2-digit `tz()` zero-pad — no `Intl`/locale dependence,
deterministic, filesystem-safe (no colons/slashes). The insertion point is `name.lastIndexOf('.')`, NOT the
first dot, so a dotted hostname keeps its real extension (`tracker-www.example.com.html` →
`tracker-www.example.com_<ts>.html`); a name with no extension just gets `_<ts>` appended. The timestamp
itself contains no dots, so a second `lastIndexOf('.')` downstream (the picker's accept-map) still resolves
the true extension. Lives in all THREE `saveBlob` copies — report.js script A + script B (separate IIFE
scopes, byte-identical) and the tracker's single IIFE (constraint-clean: no backtick/`${}`/backslash).
**Verification:** extracted the exact stamping logic from the live template and ran it — `report.json` →
`report_2026-06-27_14-03_09.json`, `tracker-www.example.com.html` →
`tracker-www.example.com_2026-06-27_14-03_09.html`, `NOEXT` → `NOEXT_2026-06-27_14-03_09`. Format matches
`YYYY-MM-DD_HH-MM_SS` exactly. Tracker template stays 0/0/0; full suite 170/0.

## AD-071: Fix-tracker stat-card percentages adopt the report's adaptive `fmtPct` convention
**Date:** 2026-06-27
**Problem:** the tracker's Fixed stat cards showed their "% of broken" via `Math.round(num/den*100)` — a whole
percent. On a real site the fixed share early on is a tiny sliver of the broken total (e.g. 1 fixed reference
among 5,000 broken instances = 0.02%), and whole-percent rounding collapses every such value to a flat,
misleading `0%`, hiding real progress. The report's broken-stats already solved this (AD-056) with an adaptive
formatter; the tracker should match it for a single percentage convention across both surfaces.
**Decision:** drop in the report's exact `fmtPct` next to `recompute()`'s `setP` and route the percentage
through it: `function fmtPct(p){if(!(p>0))return '0.0';var d=1;while(d<10&&Number(p.toFixed(d))===0)d++;return
p.toFixed(d);}`, with `setP` now emitting `'('+fmtPct(num/den*100)+'%)'`. Behaviour: a floor of **one** decimal
always (`50.0%`, `100.0%`, and `0.0%` for a zero/empty share), expanding the precision one digit at a time
(capped at 10) only while the value would still render as `0.0` — so a non-zero-but-tiny share keeps its first
significant digit (`0.02%`, `0.0001%`) instead of vanishing. Identical wording/logic to report.js's `fmtPct`,
so the two stay in lockstep. Constraint-clean (single-quoted `'0.0'`, no backtick/`${}`/backslash).
**Verification:** extracted the template's `fmtPct` and exercised the convention — `0/4→0.0%`, `5/10→50.0%`,
`3/7→42.9%`, `1/800→0.1%`, `1/10000→0.01%`, `1/1000000→0.0001%`. End-to-end headless render with one fixed
reference seeded among 5,000 broken instances: the live `#st-fInstP` card reads `(0.02%)` where the old
`Math.round` would have shown `(0%)`, and `#st-fIntP` reads `(0.0%)` (one-decimal floor). Full suite 170/0.

## AD-072: Batch per-page mini-tracker export (scoped, sanitized filenames) for delegating fixes
**Date:** 2026-06-27
**Problem:** the fix tracker's Import already merges the FULL per-link state (fixed flags + fixed-on,
verdicts + last-tested, notes — everything under `cwfix:<host>:`), keyed per `(referrer page -> broken
link)` pair, so several people's exports accumulate cleanly. What was missing was the *fan-out* side: a way
to hand each page-owner a tracker for **just their page** instead of the whole-site file. Goal: from the
central tracker, batch-produce one self-contained mini-tracker per referrer page, named after the page so
they can be distributed, fixed, and re-imported with no manual re-ticking.
**Decision:** a **🗂 Per-page** toolbar action (`savePerPage`) that, for every referrer page with at least
one still-not-Working link, bakes a mini-tracker scoped to that page. Scoping reuses `groups()` (already
inverts entries to `ref -> [{broken,...}]`), rebuilding each entry as `{url,reason,refs:[P],v,ts}` so the
mini's DATA carries ONLY P's links. The output shell is a **clone of the live document with the rendered
group lists blanked** (`#panel-int/#panel-ext/#pager-*` emptied) so no other page's links ride along and the
files stay small — `fill()` rebuilds the scoped view on open. The scoped DATA is spliced into the shell
between two `/*CW_DATA_BOUNDS*/` comment markers added around the `var DATA = "__DATA__"` injection point (so
a running tracker can re-scope itself; markers survive `report.js`'s `tpl.replace('"__DATA__"', …)`). Each
mini also gets a `__CW_TRK_SEED__` island holding **only P's state keys** (`scopedSeed` filters
collectState by: `vd:`/`vt:` for the broken URLs P references, `ft:`+bare-pkey+`n:` for ref===P), so current
progress carries and re-fan-out is faithful. Batch delivery uses **`showDirectoryPicker()`** (operator picks
one folder, all files written via `getFileHandle(create) -> createWritable`); where the directory API is
absent it falls back to sequential `<a download>`s. Filenames come from `pageFileName(url)`: drop the scheme,
then map every char outside `[A-Za-z0-9-._]` to `_` (so slashes and `?:&=` become underscores, "looks
similar" per the request), collapse repeats, trim, cap 120, dedupe with `-2/-3`. Round-trip works because the
mini's host == central's host and its fix keys are the identical `ref+NL+broken` pairs, so Import (applyState,
a per-key merge) drops them straight in. Constraint-clean (no backtick/`${}`/backslash; backslash via `BS`,
the `<scr'+'ipt>` split, and `<`→`BS+u003c` seed-escaping all mirror `saveCopy`).
**Verification:** new `pagetest` (10) unit-checks `pageFileName` (slashes→`_`, scheme dropped, length cap,
no `/` in output) + the marker placement. New `pageE2E` (13) drives the real feature in headless Chromium via
synchronous-thenable `showDirectoryPicker`/`Blob` stubs: a 3-page fixture (A→{u1,u2}, B→{u1,e1},
C→{working-only}) yields exactly TWO files `x_pageA.html`/`x_pageB.html` (C skipped), each scoped DATA holds
only that page's links (A:int[u1,u2]/ext[]; B:int[u1]/ext[e1]), refs reduced to the single page, panels
blanked, host preserved. Opening the scoped pageA mini renders `bInst=2,bInt=2` (the count being 2 not 3 is
itself proof no other page's link leaked into DATA). Tracker template stays 0/0/0; full suite 193/0
(170 core + 10 pagetest + 13 pageE2E). Note: a first test cut whole-text-searched the minis for foreign URLs
and false-positived — `savePerPage` clones the live doc, which at click time includes the probe `<script>`
whose own source contained those URL literals; the authoritative no-leak signal is the parsed scoped DATA and
the `bInst` count, not a substring scan of the cloned document.

## AD-073: Team consolidation path — multi-file Import + namespace-guarded merge + SharePoint/Power-Automate guide
**Date:** 2026-06-27
**Problem:** with per-page minis (AD-072) fanned out, the *return* path was still "email one JSON, Import one
file." The user asked whether the tracker could instead live on internal SharePoint and consume JSON dropped
into a shared folder via REST. Reality check: on a locked-down tenant **custom script is disabled** (an
inline-`<script>` HTML can't execute from a doc library; the supported route, SPFx, needs a build pipeline and
breaks the single-file design) and **cross-origin SharePoint REST is CORS-blocked** (would need Azure AD +
MSAL). So a browser-side REST consumer isn't viable there. The robust shape is server-side: contributors drop
files, **one consumer merges**, the central tracker reads the result — which also dodges the multi-writer race
of a single shared state file.
**Decision:** chose the **Power-Automate-merge** architecture (the tracker stays a viewer) and delivered three
things. (1) **Multi-file Import** in the tracker: the `cwImpF` input gains `multiple`; a new `importStateFiles`
reads N files, applies each valid same-host one (`app` + `host` checked per file), tallies applied/skipped, and
reloads **once**. This is the pure-`file://` no-flow fallback (multi-select a whole inbox folder). (2)
**Namespace hardening** of `applyState`: it now writes only keys starting with `NS` (`cwfix:<host>:`), so an
ingested/merged file — trusted or not — can never inject stray localStorage keys. (3) `merge-fix-state.js`
(repo root, dependency-free): the **reference implementation** of the union merge AND an unattended CLI
(`node merge-fix-state.js --out state.json inbox/*.json`) for when even Power Automate is restricted — same
semantics as the flow (one host; first valid file sets it, different-host skipped; namespace-guarded; **later
file wins** on key collision, mirroring WDL `union(current.v, incoming.v)`). Plus `SHAREPOINT-MERGE.md`: the
end-to-end build guide (library layout `inbox/`/`archive/`/`state.json`; trigger with **parallelism = 1** to
serialize merges; the `@union(...)` merge step; first-run handled by pre-seeding an empty `state.json`;
optional flow-side key filter; conflict = last-arrival-wins with an Office-Script/Function escape hatch for
newest-by-timestamp; three ways to hand the consolidated state back, incl. a flow-baked `__CW_TRK_SEED__` HTML).
The whole loop needs **no new tracker code to consume the flow's output** — the mini Export and the central
Import already speak the same `{app,host,v}` contract; the merge is just a dictionary union.
**Verification:** new `merge-test` (12) covers the reference merger — union of disjoint fixes, **later-wins** on
a shared `vd:` key, host isolation (different-host keys excluded), NS guard (stray key dropped), report counts,
importState-shaped output, and the from-disk CLI path incl. an unreadable file counted as skipped. CLI smoke:
`node merge-fix-state.js --out` writes a clean consolidated file + stderr summary. `tracker3-test` gains a
**C2 multi-file** section (6): two same-host files merge together, the recipient's own mark is preserved, a
stray non-`cwfix` key is NOT written (NS guard), a wrong-host file in the same batch is skipped, and the whole
batch triggers exactly one reload. Tracker template stays 0/0/0. Full suite **211/0** (was 193 + 6 multi-import
+ 12 merge). Note: the locked-down-tenant constraints (custom script, CORS) are the real design driver here —
documented so the "why not just fetch the folder from the page" question doesn't get reopened.

## AD-074: Tracker batch-export by page OR subfolder, distinct referrer-page counting, + a Pages workload column
**Date:** 2026-06-27
**Problem:** three related fixes after the per-page export (AD-072) shipped. (1) The tracker subtitle reported
`ci.pages + ce.pages` referrer pages — the SUM of the internal-tab and external-tab page counts, which
double-counts any page that links both a broken internal AND a broken external destination; this made the
subtitle (e.g. 551) disagree with the per-page export's file count (e.g. 512, a deduped union minus
all-Working pages). (2) Operators wanted to delegate a whole site SECTION to one owner, not just a file per
page. (3) The stat matrix counted links (instances/destinations) but not *pages*, so it under-described the
real workload — "how many distinct pages (and owners) still need attention."
**Decision:** (1) subtitle now counts **distinct** referrer pages via a `distinctRefPages()` union over both
lists (named function, NOT an inner IIFE — see verification). (2) `savePerPage` generalized to
**`saveBatch(mode)`**: `mode==='page'` keeps one file per page; `mode==='folder'` groups pages by
`folderOf` (tier-1 path folder) so every page under e.g. `/blog/` lands in one file, scoped to all those
pages' broken links and named after the folder. A shared `collect(g,pageSet)` gathers the broken links any
page in the set references, reducing each entry's `refs` to that set; `scopedSeed` now takes a pageSet (not a
single page). Two descriptive buttons — **🗂 Bulk export: per page** / **🗁 Bulk export: per subfolder** —
wire to `saveBatch('page')`/`saveBatch('folder')`; toasts use a per-mode noun and report skipped (all-Working)
groups. (3) A fourth stat-matrix column **Pages with broken links** (bottom) / **Pages remediated** (top):
`recompute` now also folds a `pg[referrer]` map — a page is "broken" once it has any non-Working link and
"remediated" only when EVERY such link is Fixed (across internal + external) — emitting `st-bPg`/`st-fPg` with
the same adaptive `%`. Grid widened `repeat(3,1fr)` → `repeat(4,minmax(0,1fr))`.
**Verification:** new headless `trk-pages` probe — A links 2 broken (both fixed), B links 1 (unfixed), C links
a Working-only link → `Pages with broken links=2`, `Pages remediated=1`, `(50.0%)` (C correctly excluded).
New `folderE2E` (10) drives `saveBatch('folder')`: pages under `about/` collapse into one `x_about.html` with
both pages' links (each ref'd by its own page), `blog/`→`x_blog.html`, root→`x.html`, an all-Working `legacy/`
skipped. `pageE2E` (per-page, now `saveBatch('page')`) still green. tracker3 gains a subtitle case (a
cross-linking page counts as 1, not 2). **Gotcha:** the first cut wrote `distinctRefPages` as an inner IIFE
`(function(){…})()`; its `})();` is the first such token after the main IIFE's `(function(){`, so the tests'
slice-extraction (`indexOf("})();")`) cut the IIFE short → "Unexpected end of input" in revtest + tracker3
(module-load still passed, since the template is just a string). Fixed by using a named function. Lesson:
**no inner IIFEs in the template** — the slice-based test harness treats the first `})();` as the IIFE end.
Tracker template stays 0/0/0; full suite 222/0.
