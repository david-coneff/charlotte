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
