# Session Handoff — Charlotte

This is Charlotte's session-handoff artifact — the durable, self-contained
"what a cold reader needs to resume Charlotte's development" record.

---

- **status**: Migration into this repository **complete**. One follow-up is
  pending an operator decision (removing the crawler from broodforge — see
  next_action). Updated 2026-06-24.

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

- **milestone_checklist**:
  - [x] Located the crawler + migration handoff on broodforge `claude/html-web-crawler-sd0i4p`
  - [x] Extracted the 6 files byte-for-byte into charlotte at repo root
  - [x] Flattened `CRAWLER.md` doc paths (`tools/crawl.js` → `crawl.js`)
  - [x] Added `.gitignore`, `README.md`, `package.json`
  - [x] Verified: `node crawl.js --help`, `node crawl-render.js --help`, `node --check local-cors-proxy.js`
  - [x] Authored `rhiz-memory/` instance (intent, objectives, decisions)
  - [ ] Remove crawler from broodforge (pending operator decision — see next_action)

- **next_action**: Decide how to remove the crawler from broodforge. It lives
  only on `claude/html-web-crawler-sd0i4p`, never on `main`/`festive-cerf`, and
  this session is scoped to push only to `claude/festive-cerf-7loovw`. Options:
  (a) push the handoff's §5 removal commit to `claude/html-web-crawler-sd0i4p`
  (needs explicit permission — different branch); (b) leave broodforge as-is
  since mainline never carried the crawler, and delete/abandon that branch.

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
