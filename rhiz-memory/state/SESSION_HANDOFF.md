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
