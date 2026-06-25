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

- **last_completed_step**: GUI defaults (2026-06-25, AD-026) — report **pagination is
  now on by default** in the GUI (CLI default unchanged), and a new **`crawl-gui-config.txt`**
  (next to the HTA) overrides any form field's default on launch via `key = value` lines keyed
  by field id (`loadGuiConfig()` sets `.checked` for checkboxes, `.value` for text/select;
  unknown keys skipped). Documented `.example` ships; the real file is gitignored like
  `crawl-gui-domains.txt`. JScript parses; a stub run applied 6 keys correctly. Before that:
  Manual-testing triage on the **Blocked** tab (2026-06-25, AD-025) — Tested + **Broken** (confirm) boxes (opposite default from Errors' "Not broken":
  blocked links are presumed uncertain, you opt IN to broken). Confirming one **adds** its
  instances to the live **Broken link instances** header and routes it into the fix tracker
  by its existing **Kind** (internal/external) — so no need to split the tab. Live counter +
  localStorage persistence; DOM-stub + 403-fixture verified. Also fixed the Internal-pages
  column widths (narrow Depth, wide URL/Title via `.pagestbl`; report widened to 1500px).
  Before that: Added **`--rebuild-from`** + a GUI **Rebuild report** button
  (2026-06-25, AD-024): regenerate the HTML report from a prior `--json` (single-site or a
  multi-site index, via its per-site JSONs) using the current report.js — **no crawl, no
  network** — so an old crawl gets new report features without re-crawling (the operator's
  3-hour-crawl case). It's `--recheck-from` minus the re-probe; reuses `loadStateFromJson` +
  `buildIndexReport`/`writeCombinedJson`. `summary.runtimeMs` is now stored and restored so
  rebuilds preserve the crawl runtime. Verified: an old-style JSON (new fields stripped)
  rebuilds into a full new-feature HTML; multi-site rebuilds index + per-site reports; GUI
  JScript parses. Before that: Added a broken-link **triage workflow** to the report
  (2026-06-25, AD-023, all in report.js): the fix tracker now **groups by referrer page**
  (one who-to-contact note per page); the Errors tabs get **Tested** + **Not broken**
  boxes with a **live counter** ("Manually tested X / N · confirmed broken Y · not broken
  Z"); **Not broken** links are excluded from the tracker (so a highly-referenced false
  positive can't flood it); a new **Broken link instances** headline stat (each broken
  link × its referring pages) **updates live** as links are screened; **Export fix
  tracker** is always clickable; and report links open in a **window docked to the side**
  of the report (reused, whichever side has more room) so checking a link never covers the
  view. All localStorage-persisted; DOM-stub + real-crawl verified. Before that: Fixed `--recheck-from` on a multi-site **index** JSON
  (2026-06-25, AD-022) — it was finding 0 flagged links and **wiping** the report to
  zero errors ("reset the counters to 0"). The combined index JSON has no top-level
  `errors` (they're under `sites[]`). Fix: multi-site crawls now write a full per-site
  JSON per site; `runRecheck` detects `j.sites` and re-checks each site from its per-site
  JSON, rewrites each per-site report, and rebuilds the index + combined JSON; a shared
  `reprobe()` backs both paths; an index missing per-site JSONs errors safely (exit 1, no
  write). Verified: reproduced the wipe, then confirmed single-site unchanged, multi-site
  re-probes all sites without wiping, and the missing-JSON case errors cleanly. Before
  that: Added a **Link instances** headline metric (2026-06-25,
  AD-021) — the total number of link *occurrences* (internal **and** external) summed
  across every crawled page, **not** deduplicated (a sitewide-nav link counts once per
  page it's on). Computed `Σ(page.internal+page.external)`; shown as a headline stat,
  in the JSON (`summary.linkInstances`), and on the multi-site index (per-site + a grand
  total). Distinct from the unique-target counts ("Internal pages"/"External links").
  Verified with a duplicate-link fixture (per-page 3/3, 1/2, 1/0 → 10 instances, not the
  5 unique). Before that: Added live re-tuning of a running crawl (2026-06-25,
  AD-020) — `--tune-file FILE` is watched on the control-poll; changing its JSON
  (`delay`/`rps`/`crawlDelay`/`timeout`) re-paces the **running** crawl with no restart.
  The rate limiter now reads the gap per request; `applyTune()` mutates cfg live (workers
  already read `cfg.delay`). GUI: **Resume** writes the Delay/Max-req-sec/Timeout fields to
  `crawl-gui-tune.json`. The natural flow is pause → edit → resume. A normal crawl (no
  `--tune-file`) is byte-identical to before. Verified end-to-end (PAUSED crawled=5 →
  RETUNED rps=off → RESUMED; 40 pages done in ~4s vs ~20s, so the new rate really applied).
  Concurrency/structural changes still go via Stop → Resume crawl (journal, no re-crawl).
  Before that: Uncapped + paginated the "found on" referrer list
  (2026-06-25, AD-019) — removed the `REF_CAP` (500) cap so every page that links to a
  broken URL is listed in the HTML report (no more "+N more — see JSON"); the AD-018
  `--paginate` pager now also pages each broken link's nested referrer list (1,000/page
  inside its `<details>`). Embedded fix-tracker payload carries every referrer too.
  Verified with a fixture where `/broken` has 1,501 referrers (all listed in default and
  paginated modes; nested-subtable pager DOM-stub passes; main-table paging not
  regressed; default report unchanged but for one CSS comment line). Before that: Added opt-in client-side report pagination (2026-06-25,
  AD-018) — an off-by-default `--paginate` flag (+ GUI checkbox "Paginate report
  (1,000 links/page)") shows each large report table **1,000 rows at a time** with
  Prev/Next + a Go-to-page box, so a report with tens of thousands of links stays
  responsive. All rows stay embedded; pagination is **display-only**, so selection, the
  allowlist export, and the fix-tracker export still act on every row. Verified by
  DOM-stub (2,500-row table pages 1,000 at a time, Next/Prev/jump correct; ≤1,000-row
  tables get no pager); default report is unchanged but for 3 inert CSS lines. Before
  that: Removed the report's per-table render cap (2026-06-25,
  AD-017) — `RENDER_CAP` 5,000→`Infinity` in `report.js`, so the HTML report renders
  **every** row in each table instead of truncating at 5,000 (the overflow used to be
  JSON-only). An operator hit this; they chose to remove the cap and accept larger HTML
  on big crawls (~280 bytes/link). Verified a 6,000-link fixture renders all 6,000 rows
  with no cap note; small reports unaffected. Before that: Partitioned `crawl.js` further (2026-06-25, AD-016) —
  1,013→**625 lines** by extracting `cli.js` (arg parsing + `--help` + `die`),
  `netutil.js` (rate limiter, adaptive backoff, Retry-After + robots crawl-delay, url
  helpers), and `recheck.js` (the `--recheck-from` mode). Byte-preserving; a deterministic
  crawl is byte-identical (HTML + JSON) vs the pre-split version; help/die/recheck/
  multi-site/resume all verified. The ~450-line stateful crawl engine stays in `crawl.js`
  as the irreducible core (deliberately not split). Before that: Completed the resume
  feature (AD-015) — poison-URL
  quarantine (a page that crashes the crawler across ≥2 resume sessions is blocked, not
  retried), truncate-on-fresh journals, and a GUI **Resume crawl** button (verified).
  Before that: Partitioned `crawl.js` (1,480→998 lines) into leaf modules
  **`parse.js`** (link extraction) / **`fetch.js`** (HTTP) / **`log.js`** (log+journal) /
  **`seen.js`** (dedup) — byte-preserving; a deterministic crawl is byte-identical (HTML
  + JSON) vs the pre-split version, resume/multi-site/recheck verified (2026-06-25,
  AD-014). The tool stays zero-dependency `require()` modules (no bundler). Before that:
  Fixed Pause being ignored during the external-check /
  second-pass loops (now honored like the main worker, verified), and added on-demand
  broken-link re-check `--recheck-from <report.json>` — re-probes just the flagged
  links with the current settings and rewrites the report with the record corrected +
  de-duplicated (links that now resolve are dropped; AD-013, verified). Added the GUI
  **Re-check broken links** button (JScript syntax-verified; the HTA is Windows-only and
  wasn't run here). **Still pending:** a GUI "Resume" button and poison-URL quarantine. Earlier: added **resumable crawls** — `--state FILE` writes an
  append-only JSONL journal (discoveries + completions, synchronous so a `kill -9` is
  safe) and `--resume FILE` replays it to rebuild the frontier + results and continue
  with **zero re-crawl** (single + multi-site; 2026-06-25, AD-012). Verified by a real
  SIGKILL mid-crawl and a truncation test (final coverage identical to uninterrupted,
  no page crawled twice). **Next on this feature:** poison-URL quarantine (the journal
  already records `v` attempt events) and a GUI "Resume" command on error. Earlier work:
  the External-links expand/collapse toggle (2026-06-25, AD-011 — scoped to
  `#panel-external`, label re-syncs to state, DOM-stub verified). Recent prior work: GUI
  multi-domain defaults via `crawl-gui-domains.txt` (AD-010); report/output layer split
  into a sibling **`report.js`** (AD-009; `crawl.js` 1,861→1,301 lines, output
  byte-for-byte identical); the fix tracker (AD-008); report features (AD-007: allowlist
  export, runtime, branding); and the migration (AD-001…AD-006). All committed and
  pushed; broodforge branch deletion remains an operator action (session is 403-blocked
  from it).

- **resume_instructions**:
  1. Read `rhiz-memory/state/SESSION_HANDOFF.md` for full context.
  2. Read `rhiz-memory/state/decisions.md` for the migration ADRs.
  3. Pick up `next_action`.

---

## Provenance

Created 2026-06-24 during the broodforge → charlotte crawler migration.
