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
