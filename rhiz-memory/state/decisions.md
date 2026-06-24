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
