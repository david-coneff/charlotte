# Architecture Decisions — Charlotte

Architecture Decision Records for Charlotte. Each entry records a decision and
the rationale behind it, so conclusions are not re-litigated.

## AD-001: Migrate the crawler into its own repository
**Date:** 2026-06-24
**Decision:** Lift the web-crawler tool out of `david-coneff/broodforge` and into
`david-coneff/charlotte` as a standalone project.
**Rationale:** The crawler is a distinct, general-purpose link-checking /
site-mapping tool. It lived under broodforge's `tools/` but had **no code
coupling** to it — it imported nothing from the tree and nothing in the tree
imported or executed it (verified: no references outside `tools/` except the
`.gitignore` output block). Keeping a self-contained, unrelated tool inside an
infrastructure platform's repo obscures both. Its own repo lets it version,
document, and release independently.

## AD-002: Flatten to repository root
**Date:** 2026-06-24
**Decision:** Place the files at the repo root (`crawl.js`) rather than keeping a
`tools/` subfolder (`tools/crawl.js`).
**Rationale:** The crawler is now the whole project, so a `tools/` subfolder —
which implies "auxiliary tooling for a larger thing" — no longer fits. The
migration handoff's suggested layout is root-level, and `crawl.js` already refers
to itself as `crawl.js` in its own `--help` output, so the flat layout matches
the tool's self-description. The only adjustment required was updating the 22
`tools/`-prefixed paths in `CRAWLER.md`.

## AD-003: Keep both toolchains
**Date:** 2026-06-24
**Decision:** Migrate all six files — the Node toolchain (`crawl.js`,
`crawl-gui.hta`, `crawl-render.js`) **and** the browser toolchain
(`web-crawler.html`, `local-cors-proxy.js`), plus `CRAWLER.md`.
**Rationale:** The request was to migrate the tool, not a subset. The two
toolchains serve different runtimes (a no-CORS CLI path and a no-install
in-browser path) and share one set of docs. Dropping the browser toolchain would
silently narrow the tool's capability; completeness is the safer default and
nothing is left behind by accident.

## AD-004: Add standalone-repo scaffolding (`package.json`, `README.md`, `.gitignore`)
**Date:** 2026-06-24
**Decision:** Add a `package.json` (name `charlotte`, `playwright` under
`optionalDependencies`, `bin` entries `crawl` and `crawl-render`, `private: true`),
a concise `README.md` landing page, and the crawler's runtime-output `.gitignore`
block (carried from broodforge) plus `node_modules/`.
**Rationale:** A standalone repo should be runnable and legible on its own. The
`bin` entries let the CLIs run as commands; `playwright` is declared *optional*
because `crawl-render.js` lazy-loads it and degrades to `--http-fallback`,
preserving the zero-dependency-core principle. `private: true` avoids accidental
publish without asserting a license the operator did not choose. The `.gitignore`
block keeps per-run generated reports/logs out of version control.

## AD-005: Adopt the Rhizome memory convention
**Date:** 2026-06-24
**Decision:** Document the project under `rhiz-memory/` (`_instance.md`,
`state/SESSION_HANDOFF.md`, `state/RESUME_BLOCK.md`, `state/decisions.md`,
`audits/`), mirroring the conformant instance in broodforge.
**Rationale:** Per operator direction, capture qualitative intent, objectives,
and how the implementation achieves its goals in the Rhizome format, so the
project's purpose and design rationale travel with the code rather than living
only in commit messages.

## AD-006: Preserve tool source byte-for-byte
**Date:** 2026-06-24
**Decision:** Carry the five code files (`crawl.js`, `crawl-gui.hta`,
`crawl-render.js`, `web-crawler.html`, `local-cors-proxy.js`) over unchanged;
confine edits to documentation (`CRAWLER.md` path flattening) and new files.
**Rationale:** A migration should change *location*, not *behavior*. Extracting
the exact blobs (verified by SHA-256 against the source branch) guarantees the
tool "runs identically in the new repo," which is the migration's stated bottom
line. Executable bits were preserved/added for the three files that carry a
shebang (`crawl.js`, `crawl-render.js`, `local-cors-proxy.js`).

## AD-007: Report enhancements — branding, runtime, and selectable allowlist export
**Date:** 2026-06-24
**Decision:** Enhance the generated `crawl-report.html`: (a) brand it **Charlotte**
(title + header + a 🕸️ SVG favicon); (b) show the crawl **Runtime** among the
headline stats; (c) give the two **Errors** tabs (internal + external) a per-row
checkbox plus an **Export to allowlist…** / **Copy lines** toolbar.
**Rationale / how it meets the goal:**
- *Branding* — a standalone tool should identify itself. The report now carries
  the repo's name and a spiderweb favicon (the "Charlotte's web" motif), and the
  leftover `broodforge*` localStorage keys and `broodforge-crawler/1.0` default
  User-Agent were renamed to `charlotte*` / `charlotte-crawler/1.0`.
- *Runtime* — added `state.startedMs` (at init) and `state.finishedMs` (frozen at
  crawl completion). The stat shows the frozen duration on the final report and
  counts up from the start on partial (live) reports.
- *Selectable allowlist export* — the checkbox column emits the **same** annotated
  line as the suggested-file path (`url   # reason — found on: src`), so a ticked
  selection downloads as `crawl-allowlist.append.txt` (or copies to the clipboard)
  ready to append to the allowlist. Gated to the final report (partial reports
  auto-refresh, which would clear ticks) and confined to the Errors tabs.
**Implementation note:** all report JS stays dependency-free and self-contained
(Blob download + `execCommand` clipboard fallback). Verified end-to-end against a
local fixture: the embedded scripts syntax-check, the favicon decodes to valid
SVG, and an exported selection fed back via `--allowlist` moves those links from
Errors to **Suppressed** on the next scan.

## AD-008: Per-referrer fix checkboxes + standalone "fix tracker" export (with notes)
**Date:** 2026-06-24
**Decision:** On the report's two Errors tabs, give every "found on" referrer its
own checkbox, and add **Export fix tracker** — a single standalone HTML, tabbed
internal/external (styled like the crawl report), listing each referrer → broken-link
pair with an editable **Fixed** checkbox and a **Notes · who to contact** field.
**Rationale / how it meets the goal:**
- The unit of *fixing* is "(a referrer page) links to (a broken URL)", so the
  fixer's checklist is keyed on that pair and grouped by referrer. The report's
  per-referrer checkboxes let you tick progress in place; the export turns that
  into a portable, durable work artifact.
- The tracker is **self-rendering from an embedded JSON island** (`__DATA__`): the
  report fills it with the broken-link data plus whichever pairs are already
  ticked, and the tracker builds its own tabs/rows. Checkbox **and note** state
  **persist in localStorage** (namespaced by host) so work survives reopening and
  can be handed off.
- The notes field captures *who needs contacting* to fix each section — the
  operator's stated purpose.
**Implementation notes:** the tracker template is embedded in the report as a JS
string with every `<` hex-escaped (so its own `</script>` cannot close the
report's script) and filled via a placeholder replace at export time. All browser
JS is dependency-free and **backslash-free** (newline/backslash produced via
`String.fromCharCode`) to keep the nested template/script escaping safe. Verified
end-to-end: report → export → render yields the two tabs, the per-pair checkboxes,
the notes inputs, correct pre-ticked state, and live progress counts.

## AD-009: Extract the report/output layer into report.js
**Date:** 2026-06-24
**Decision:** Split the HTML/JSON report generation out of `crawl.js` into a sibling
module **`report.js`** (~570 lines): `TRACKER_TEMPLATE`, `buildReport`,
`writeOutputs`, `buildIndexReport`, `writeCombinedJson`, plus the render caps
(`REF_PREVIEW`/`REF_CAP`/`RENDER_CAP`), the branding constants (`BRAND`/`BRAND_ICON`),
and the `esc` helper they use. `crawl.js` `require`s `{ writeOutputs,
buildIndexReport, writeCombinedJson }` back. Orchestration helpers (`hostOf`,
`sitePath`) and `TITLE_CAP` (used by `extractLinks`) stayed in `crawl.js`.
**Rationale:** `crawl.js` had grown to 1,861 lines and the report layer (~29%) was
the fastest-growing concern — three feature rounds (runtime, allowlist export, fix
tracker) all landed there. It is also the cleanest seam: the report functions are
pure-ish (state/cfg → HTML strings; only `writeOutputs`/`writeCombinedJson` touch
`fs`) with **no crawl-engine dependencies**, so `report.js` is a leaf module — no
circular imports. `crawl.js` dropped to 1,301 lines.
**Distribution preserved:** `report.js` lives beside `crawl.js` and is published with
it (no `files` whitelist in `package.json`), so `node crawl.js`, `npx`, and the `bin`
entry keep working. The one new constraint — the two files must travel together — is
noted in `CRAWLER.md` (crawl.js + GUI requirements) and the README.
**Verification:** the move is byte-preserving — a regenerated report is **byte-for-byte
identical** to the pre-split output (modulo timestamps/runtime/runId); the
embed → export → render checks still pass; and `--help` plus a multi-site run (index +
per-site reports + combined JSON) work.

## AD-010: GUI default Start URLs via crawl-gui-domains.txt
**Date:** 2026-06-24
**Decision:** On open, `crawl-gui.hta` pre-fills its Start-URL rows from an optional
**`crawl-gui-domains.txt`** beside it — one URL per line (`#` comments and blank lines
ignored; an inline ` # comment` trimmed; a `#fragment` in the URL kept). **Each line
becomes its own row, so multiple defaults load**; an absent/empty file falls back to
the original single blank row. A `crawl-gui-domains.txt.example` template ships.
**Rationale:** lets a recurring multi-site scan open ready-to-run without retyping the
URLs each time. Reuses the GUI's existing `readFile()` + `addUrlRow()` (no new
dependency), and the line parser mirrors the crawler's allowlist comment convention
for consistency.
**Verification:** the GUI's JScript block parses, and a multi-line sample yields N
rows with inline comments trimmed and URL fragments preserved; empty/comment-only
files yield 0 rows (→ the blank-row fallback).

## AD-011: Expand/collapse-all toggle for the External-links domain sections
**Date:** 2026-06-25
**Decision:** The External-links tab renders one collapsible `<details>` per
destination host; added a single **Expand all / Collapse all** toggle (with a domain
count) at the top of that tab that opens or closes every section at once.
**Rationale:** sites with many external domains made the tab long, and clicking each
section is tedious. Scoped to `#panel-external` so it never touches the referrer
`<details>` on the Errors tabs; the button label re-syncs to the real state (via
`toggle` listeners, so manual section toggles keep it accurate), and programmatic
open/close still flows through the report's existing localStorage open-state
persistence.
**Verification:** DOM-stub test — initial "Collapse all", click collapses all →
"Expand all", click expands all → "Collapse all", and it still bulk-collapses after a
manual section change; a 6-domain fixture renders 6 sections plus the toggle.

## AD-012: Resumable crawls via an append-only journal (`--state` / `--resume`)
**Date:** 2026-06-25
**Decision:** Add `--state FILE` (write an append-only JSONL journal of discoveries +
completions, flushed synchronously) and `--resume FILE` (replay it to rebuild the
frontier + results + seen-set, skip everything already done, and continue). Each
crawled page's event carries its discovered link targets (internal / external / oos)
so a resume reconstructs the frontier and the full report **without re-crawling**.
Multi-site runs get a per-site journal derived from `--state`, like the per-site
reports from `--out`.
**Rationale / how it meets the goal:** the crawler never persisted the frontier, so a
stop meant starting over. The operator asked for resume that "appends from the
stopping point and doesn't duplicate effort." An append-only journal (vs periodic
full-state snapshots) matches that exactly: synchronous appends survive a hard
`kill -9` with at most a torn last line (skipped on replay); replay marks every
completed URL done and re-queues only the unfinished frontier — zero re-crawl, and
append-once I/O scales better than repeatedly rewriting a snapshot on a huge crawl.
**Implementation:** events `meta` / `v` (visiting) / `p` (page + its links) / `k`
(non-HTML) / `e` (error) / `b` (blocked), one JSON per line; replay reuses the live
`addRef` + `seen.tryAdd` so the rebuilt frontier/referrers match the original.
`--resume` keeps appending (with `r` resume markers), so a run can be interrupted and
resumed repeatedly.
**Verification:** (1) truncation — resume from a 1-page stub reproduced the full crawl
exactly, zero re-visits; (2) real `SIGKILL` mid 122-page crawl — resume continued from
~46 done to coverage identical to an uninterrupted run, 0 pages crawled twice, torn
tail tolerated; (3) multi-site — per-site journals, resume skips finished sites.
**Still to come (tracked):** poison-URL quarantine (the `v` events are recorded for
it) and a GUI "Resume" command on error.

## AD-013: Re-check broken links on demand (`--recheck-from`)
**Date:** 2026-06-25
**Decision:** Add `--recheck-from <report.json>`: load a prior crawl's state from its
JSON, re-probe only the flagged links (active broken + blocked) with the *current*
settings (rate / timeout / `--browser` / concurrency), and rewrite `--out` / `--json`
with the broken-link record **corrected and de-duplicated** — links that now resolve
are dropped, still-broken stay, allowlisted (suppressed) errors are preserved, and
each URL appears once. No re-crawl. (Also fixed: Pause was ignored during the
external-check and second-pass loops — they now honor the pause file like the main
worker.)
**Rationale:** the built-in second pass runs once, immediately. The operator wanted to
re-verify suspected-transient failures *later*, when the connection is stable, against
only those links — and to have the report's broken-link record corrected (not
duplicated) when they do. Reusing the existing probe / disposition logic keeps the
classification identical to a live crawl.
**Implementation:** `loadStateFromJson` rebuilds pages / external / oos / refs / errors
/ blocked (refs from each entry's `foundOn`); `runRecheck` de-dupes the flagged set by
URL, probes each once (internal via GET, external via HEAD→GET), reclassifies, and
writes via the shared `writeOutputs`.
**Verification:** stateful fixture (links 404 on the first crawl, 200 on re-check) —
re-check dropped the two recovered links, kept the always-404 one, collapsed an
injected duplicate error to a single entry, and preserved the crawled pages.
**GUI:** added a **Re-check broken links** button — every crawl now writes a JSON
(managed default `crawl-gui-report.json`) so the button has a source; it reuses the
same launcher (bat + `DONE_` marker + poll), runs to completion with the form's
current network settings, and shows "Re-check complete". JScript syntax + wiring
verified; the `.hta` itself is Windows-only and wasn't run here.

## AD-014: Partition crawl.js into leaf modules (parse / fetch / log / seen)
**Date:** 2026-06-25
**Decision:** Split four cohesive layers out of `crawl.js` into sibling modules:
**`parse.js`** (HTML + document link extraction), **`fetch.js`** (HTTP request / probe
/ disposition), **`log.js`** (progress log + resume journal + reconstruction), and
**`seen.js`** (dedup backends). `crawl.js` `require`s them back; `fetch.js` `require`s
`parse.js` (for `docTypeOf` / `sniffMagic`). Shared constants moved to their owning
module (`MAX_REDIRECTS` / `MAX_BYTES` / `BROWSER_UA` → fetch; `TITLE_CAP` → parse).
**Rationale:** `crawl.js` had grown back to ~1,480 lines after the resume / re-check
work. These four are the cleanest seams — pure-ish, low-coupling leaves with no
crawl-engine dependencies (a clean DAG: parse ← fetch ← crawl; log, seen ← crawl).
`crawl.js` dropped to **998 lines**; the new modules are 82–151 lines each. As in
AD-009, plain CommonJS `require()` (no bundler) keeps the tool zero-dependency and
install-free — a bundler would buy nothing for a Node CLI and would cost the no-install
property.
**Verification:** byte-preserving extraction (code moved verbatim by script). Proven
behavior-preserving: a deterministic crawl produces a **byte-identical** HTML report
*and* JSON vs. the committed pre-split `crawl.js`; the resume round-trip still matches;
`--help`, multi-site, and `--recheck-from` all work; all six files syntax-check.

## AD-015: Complete the resume feature — poison-URL quarantine + GUI Resume button
**Date:** 2026-06-25
**Decision:** Finish AD-012's resume feature. (a) **Poison-URL quarantine:** on resume,
a URL visited (`v`) in ≥2 separate sessions (delimited by the journal's `r` markers)
without ever completing is recorded as **blocked** ("quarantined — crashes the
crawler") instead of re-queued — so a page that deterministically kills the process
can't loop crash → resume → crash. (b) A fresh `--state` run now **truncates** the
journal first, so it never appends across separate crawls. (c) GUI **Resume crawl**
button: every GUI crawl writes `crawl-gui-state.jsonl`, and Resume re-runs the same
command with `--resume`; the button is enabled whenever a journal is present.
**Rationale:** quarantine is *session*-based, not raw `v`-count, so legitimate
rate-limit retries within one session don't trigger it — only genuine cross-resume
crashes do (a URL is re-attempted once, then quarantined). Truncate-on-fresh makes the
GUI's always-on journal safe.
**Verification:** a hand-crafted poison journal (a URL with `v` in two sessions, no
completion) resumes with that URL quarantined to blocked and not re-crawled; a normal
single-session in-flight URL is still re-attempted (no false quarantine); two fresh
`--state` runs leave a single `meta` line (truncated). GUI JScript syntax + Resume
wiring verified (the `.hta` is Windows-only, not run here).

## AD-016: Partition crawl.js further — cli / netutil / recheck modules
**Date:** 2026-06-25
**Decision:** Split three more cohesive seams out of `crawl.js` into sibling modules:
**`cli.js`** (`parseArgs` + `printHelp` + `die` — argument parsing and `--help`),
**`netutil.js`** (`sleep`, `normalize`, `sameDomain`, the rate limiter, Retry-After
parsing, the adaptive-backoff throttle, and robots.txt crawl-delay), and **`recheck.js`**
(`loadStateFromJson` + `runRecheck` — the `--recheck-from` mode). `crawl.js` `require`s
them back. The dependency DAG stays clean and acyclic: `netutil ← fetch ← parse`;
`recheck ← netutil, fetch, report`; `cli ← fetch` (for `BROWSER_UA`).
**Rationale:** after AD-014 + the resume/quarantine work `crawl.js` was back to ~1,013
lines. CLI parsing (~200 lines) was the single biggest non-engine block and is fully
self-contained; the net/throttle helpers form a natural utility layer reused by both the
engine and re-check; and `--recheck-from` is a distinct *mode*, not part of the live
crawl. Extracting all three leaves `crawl.js` as the **crawl engine + its orchestration
glue** (`main`, allowlist load/suggest, multi-site helpers) at **625 lines** — the
remaining bulk is the ~450-line stateful engine, which is the irreducible core and was
deliberately *not* split (its workers/throttle/journal close over shared state; splitting
it would hurt readability, not help). As in AD-009/AD-014, plain `require()`, no bundler.
A stale orphan comment (left over from AD-009's `buildIndexReport` move) was dropped.
**Verification:** byte-preserving extraction (code sliced verbatim by script, with
boundary asserts). A deterministic crawl produces a **byte-identical** HTML report *and*
JSON vs. the committed pre-split `crawl.js` (only the run timestamps differ); `--help`,
`die()` on a bad arg, `--recheck-from`, multi-site (per-site reports + index + combined
JSON), and a resume round-trip all work; all four files (`crawl.js` + the 3 new) plus the
existing modules syntax-check.

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
