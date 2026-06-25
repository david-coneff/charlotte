# Session Handoff — Charlotte

This is Charlotte's session-handoff artifact — the durable, self-contained
"what a cold reader needs to resume Charlotte's development" record.

---

- **status**: Charlotte migration **complete and pushed**
  (`claude/festive-cerf-7loovw`). Broodforge removal **decided** (delete the
  `claude/html-web-crawler-sd0i4p` branch) but **blocked from this session** —
  the git relay denies writes/deletes to any branch other than the designated
  `festive-cerf` (HTTP 403, a policy denial), and the GitHub MCP server exposes
  no delete-branch tool. The branch must be deleted by the operator.
  **Update 2026-06-24:** crawler **report features** added — selectable
  broken-link export to the allowlist (checkbox column + Export/Copy on the
  Errors tabs), a **Runtime** headline stat, and **Charlotte** branding with a
  🕸️ favicon — committed and pushed. (AD-007)

- **objective**: Lift the web-crawler tool out of `broodforge` (where it lived
  under `tools/` with no code coupling to the rest of the tree) and stand it up
  as its own repository, `david-coneff/charlotte`, running identically.

- **key_decisions_and_insights** (conclusions already reached — do not re-derive):
  - The crawler had **zero functional dependence** on broodforge and nothing in
    broodforge imported or executed it (verified in the migration handoff). Its
    removal there cannot break a build, test, or import. (AD-001)
  - In broodforge the crawler existed **only on the branch
    `claude/html-web-crawler-sd0i4p`** — it was never merged to `main` or to
    `claude/festive-cerf-7loovw`. So broodforge's mainline never carried it.
  - **Flattened to repo root** (`crawl.js`, not `tools/crawl.js`): it is the
    whole project now, and the code already names itself `crawl.js` in its own
    `--help`. The 22 `tools/`-prefixed paths in `CRAWLER.md` were updated to
    match; tool source was otherwise carried **byte-for-byte**. (AD-002, AD-006)
  - **Both toolchains kept** (Node: crawl.js/crawl-gui.hta/crawl-render.js;
    Browser: web-crawler.html/local-cors-proxy.js) — migrate the tool whole. (AD-003)
  - Added `package.json` (name `charlotte`, `playwright` as an
    optionalDependency, `bin` entries `crawl`/`crawl-render`), `README.md`, and
    the crawler's `.gitignore` output-pattern block. (AD-004)
  - Adopted the Rhizome memory convention in this repo (`rhiz-memory/`). (AD-005)
  - Report enhancements (AD-007): checkbox-select broken links on the two Errors
    tabs → **Export to allowlist…** / **Copy** (emits the same `url # reason —
    found on: src` lines; round-trip verified to move links to Suppressed); a
    **Runtime** headline stat; Charlotte branding (title/header + 🕸️ favicon);
    `broodforge*` localStorage keys and default UA renamed to `charlotte*`.
  - Fix-tracker (AD-008): per-referrer checkboxes on the Errors tabs + **Export
    fix tracker** → a standalone, tabbed (internal/external) HTML checklist of
    referrer→broken-link pairs with editable **Fixed** boxes and a **Notes · who
    to contact** field; self-renders from an embedded JSON island, state persisted
    in localStorage. Verified report→export→render.
  - Refactor (AD-009): extracted the report/output layer (~570 lines) from
    `crawl.js` into a sibling **`report.js`** (`buildReport`, `writeOutputs`,
    `buildIndexReport`, `writeCombinedJson` + render caps / branding / `esc`);
    `crawl.js` dropped 1,861→1,301 lines and `require`s the three writers back.
    Report output verified **byte-for-byte identical** to pre-split.

- **milestone_checklist**:
  - [x] Located the crawler + migration handoff on broodforge `claude/html-web-crawler-sd0i4p`
  - [x] Extracted the 6 files byte-for-byte into charlotte at repo root
  - [x] Flattened `CRAWLER.md` doc paths (`tools/crawl.js` → `crawl.js`)
  - [x] Added `.gitignore`, `README.md`, `package.json`
  - [x] Verified: `node crawl.js --help`, `node crawl-render.js --help`, `node --check local-cors-proxy.js`
  - [x] Authored `rhiz-memory/` instance (intent, objectives, decisions)
  - [x] Report: selectable broken-link → allowlist export on the Errors tabs (checkbox + Export/Copy)
  - [x] Report: Runtime headline stat; Charlotte branding + 🕸️ favicon; `broodforge*`→`charlotte*` keys/UA
  - [x] Verified features against a local fixture (export round-trips to Suppressed)
  - [x] Per-referrer fix checkboxes + standalone editable fix-tracker export (notes per row); verified report→export→render
  - [x] Extracted the report/output layer into `report.js` (AD-009); `crawl.js` 1,861→1,301 lines, report output byte-identical, multi-site + `--help` verified
  - [x] GUI loads multiple default Start URLs from `crawl-gui-domains.txt` (AD-010); parsing verified
  - [x] External-links tab: Expand/Collapse-all toggle for the per-domain sections (AD-011); verified
  - [x] Resumable crawls: `--state` journal + `--resume` (single + multi-site), SIGKILL-resume verified with zero re-crawl (AD-012). Poison-URL quarantine + GUI Resume button still pending.
  - [x] Bugfix: Pause now honored during external-check + second-pass loops (verified). `--recheck-from` re-checks broken links on demand with current settings, correcting + deduping the record (AD-013). GUI **Re-check broken links** button added
    (JScript syntax-verified; HTA not runtime-testable here). Still pending: GUI Resume
    button + poison-URL quarantine.
  - [x] Partitioned `crawl.js` (1,480→998 lines) into leaf modules `parse.js` / `fetch.js` / `log.js` / `seen.js` (AD-014); byte-identical report + JSON vs pre-split, resume/multi-site/recheck verified.
  - [x] Completed the resume feature (AD-015): poison-URL quarantine (session-based) + truncate-on-fresh + GUI **Resume crawl** button. Verified.
  - [x] Partitioned `crawl.js` further (1,013→625 lines) into `cli.js` (arg parsing/help) / `netutil.js` (rate-limit, backoff, robots-delay, url helpers) / `recheck.js` (`--recheck-from` mode) (AD-016); byte-identical report + JSON vs pre-split, help/die/recheck/multi-site/resume verified. The ~450-line crawl engine stays in `crawl.js` as the irreducible core.
  - [x] Removed the report's per-table render cap (AD-017): `RENDER_CAP` 5,000→`Infinity`, so the HTML renders every row instead of truncating at 5,000 (full data was/is also in JSON). Verified a 6,000-link fixture renders all 6,000 rows; small reports unaffected.
  - [x] Opt-in client-side report pagination (AD-018): off-by-default `--paginate` (+ GUI checkbox) shows large tables 1,000 rows/page with Prev/Next/jump; display-only (export/selection still act on every row). DOM-stub verified across pages; default report unchanged but for 3 inert CSS lines.
  - [x] Uncapped + paginated the "found on" referrer list (AD-019): removed `REF_CAP` (500) so every referrer of a broken link is listed in the HTML (no "+N more"); the `--paginate` pager now also pages these nested lists (1,000/page). Verified with a 1,501-referrer fixture (all listed; nested pager DOM-stub passes; tracker payload carries all 1,501).
  - [x] Live re-tuning (AD-020): `--tune-file FILE` lets you change delay/rps/crawl-delay/timeout on a *running* crawl (pause → edit → resume), no restart; GUI Resume writes the tune file from its rate fields. Rate limiter reads the gap per request; normal crawl byte-identical. Verified end-to-end (PAUSED→RETUNED→RESUMED, rate change took effect).
  - [x] "Link instances" headline metric (AD-021): total link *occurrences* (internal + external, **not** deduped) summed across all crawled pages — `Σ(page.internal+page.external)`. Headline stat + `summary.linkInstances` JSON + multi-site per-site & grand total. Verified with a duplicate-link fixture (10 instances vs 5 unique).
  - [x] Fixed `--recheck-from` on a multi-site **index** JSON (AD-022): was reading 0 flagged links and **wiping** the report to zero errors. Now multi-site crawls write per-site JSONs, and re-check re-probes each site + rebuilds the index (or errors safely if per-site JSONs are absent). Single-site path unchanged. Reproduced + fixed + verified (no data loss).
  - [~] Remove crawler from broodforge — operator chose *delete the branch*;
    blocked from this session (branch-write policy 403 + no delete-branch tool).
    Operator to delete `claude/html-web-crawler-sd0i4p` via the GitHub UI.

- **next_action**: Operator to delete the `claude/html-web-crawler-sd0i4p`
  branch in broodforge (GitHub → Branches → delete). This session cannot: the
  git relay returns 403 on writes/deletes to any branch other than the
  designated `claude/festive-cerf-7loovw`, and no delete-branch API tool is
  exposed. No PR depends on the branch and the crawler is safely in charlotte,
  so the deletion is safe.

- **active_risks**: None to the tool. The only open item is the broodforge-side
  cleanup decision above.

- **blockers**: None.

- **resume_instructions**:
  1. Read `rhiz-memory/state/RESUME_BLOCK.md` for the one-screen save-state.
  2. Read `rhiz-memory/state/decisions.md` for the migration ADRs.
  3. Read `CRAWLER.md` for the full tool reference.
  4. Resolve next_action (broodforge removal) with the operator.

- **resume_block_ref**: `rhiz-memory/state/RESUME_BLOCK.md`

---

## Provenance

Created 2026-06-24 as part of migrating the crawler out of broodforge. The
migration was directed by `CRAWLER-MIGRATION-HANDOFF.md` on broodforge's
`claude/html-web-crawler-sd0i4p` branch.
