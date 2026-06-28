# Charlotte — Synthesis: features, implementation, and lessons

A durable, high-altitude companion to the decision log. The ADRs
([`decisions.md`](decisions.md) → `decisions/`) record *each* decision in order;
this document synthesizes the **whole**: what the program is for, what has
actually landed, how it's built, and — most valuably — what worked and what
didn't, so the hard-won knowledge survives even when the per-decision detail is
too much to re-read. `RESUME_BLOCK.md` is the "where am I right now" pointer;
`_instance.md` is the governance charter; this is the retrospective map.

_Last synthesized: 2026-06-27, through AD-078 (capability inventory and §5 lessons cover
the full report/tracker arc AD-053–077; AD-078 consolidated the memory). §5 #31 added 2026-06-28 from the AD-089 delivery trap)._

---

## 1. Intent & objectives

Charlotte maps **one website**. Given a start URL it enumerates every internal
link, records (never follows) the first-tier external links those pages point
to, verifies links — including links embedded in PDF/Office documents — and
writes a **self-contained HTML report** you open from `file://` with no server,
network, or dependency.

The non-negotiables (full charter in `_instance.md`):

- **Zero-dependency core.** `crawl.js` + its sibling modules and
  `local-cors-proxy.js` use only Node built-ins (`http`, `https`, `fs`, `path`,
  `zlib`, `url`). Playwright is the *only* external dependency anywhere — optional,
  lazy-loaded, used solely by `crawl-render.js`, which degrades to `--http-fallback`.
- **Single-domain scope.** Internal links are followed within limits; external
  links are recorded and at most resolve-checked once. The crawler never *reads*
  an external page.
- **Self-contained outputs.** The report embeds all its CSS/JS/state; no external
  assets, no build step.
- **Crash-resilient & polite.** Checkpointing, an append-only journal, a resumable
  seen-index; honest UA/headers when asked; a global `--rps` cap and per-worker delay.
- **Loose coupling.** Every file is independently runnable; couplings are runtime /
  file-format, never `require()` across toolchains.

The throughline of the last ~48 decisions (AD-017–065): turn the report from a
*read-only artifact* into a **triage workstation** — mark links Broken/Working,
track fixes, and hand the verdicts off — without ever breaking the zero-dependency,
self-contained, open-from-`file://` properties. The most recent arc (AD-053–065)
is **ergonomics at scale**: every tab folder/domain-grouped into collapsible
sections, group-level pagination, fixed-height viewports the operator can drag
taller, drag-resizable columns with no enforced minimum, an `All: Fixed` bulk box,
and collapsible help — so a 6,000-destination crawl stays scannable and tunable.

---

## 2. What has landed (capability inventory)

### Crawl engine (`crawl.js`, ~665 lines of engine + glue)
- Single-domain BFS with `--max-pages` / `--max-depth` (or unlimited), scope
  control (`domain` / `path` / custom prefix), subdomain inclusion.
- Politeness: per-worker `--delay`, global `--rps` token-bucket limiter, adaptive
  backoff on 429/503 (Retry-After honored), robots.txt crawl-delay.
- Concurrency pool of workers over a shared frontier; checkpoint rewrite every N pages.

### Link verification
- HEAD→GET probing with disposition classification (ok / broken / blocked-uncertain).
- External **resolve-check** (`--check-external`) — recorded, never crawled.
- **Document link scanning** — opens PDF/Office files and checks the links inside.
- **Browser-mode** (`--browser`) — honest desktop-Chrome UA + headers (no spoofing),
  fewer false dead-links.
- **Headless second opinion** (`crawl-render.js`) — re-renders flagged links in real
  Chromium (Playwright, optional).

### Resilience & resume (AD-012, AD-015)
- Append-only JSONL **journal** (`--state`) — synchronous appends survive `kill -9`
  with at most a torn last line (skipped on replay).
- `--resume` replays the journal to rebuild frontier + results + seen-set and
  continue with **zero re-crawl**.
- **Poison-URL quarantine** — a URL `v`-visited in ≥2 sessions without completing is
  recorded blocked, so a page that deterministically crashes the process can't loop.
- Pluggable seen-index backends (`memory` / `compact` / `disk`).

### Re-check & rebuild (AD-013, AD-041, AD-049)
- `--recheck-from <report.json>` — re-probe only the flagged links with *current*
  settings, drop now-resolving links, keep still-broken, preserve suppressed; no
  re-crawl. Writes a **separate `*.recheck.json` first**, rewrites the live report
  only at completion (so a failure/Stop never half-rewrites). Streams live progress
  markers the GUI tails; honors Pause/Stop.
- `--rebuild-from <report.json>` — regenerate the HTML from a prior JSON using the
  current build's report features; no crawl, no network.
- **Crawl settings are persisted in the JSON** and restored on rebuild/re-check, so
  the config line shows the *original* run, not the rewrite process's CLI defaults.

### The HTML report (`report.js` ~900 lines + `report-templates.js`)
- Self-contained: inline CSS/JS, a 🕸️ SVG favicon, all state in `localStorage`.
- Headline stats (destinations vs. hyperlink **instances** — unique vs. occurrences),
  Requests = internal pages crawled + external destinations verified.
- Tabs: Internal destinations, External destinations, Broken·internal, Broken·external,
  Blocked·uncertain, Suppressed, (Out-of-scope when scoped).
- Client-side **pagination** with a configurable breakpoint (`--page-size`, GUI dropdown).
- Multi-site **index report** + per-site reports + combined JSON.

### Triage workstation (AD-028–065, AD-075)
- Per-link **Broken / Working** verdicts — mutually exclusive, auto-stamped
  **Last-tested** time. Errors default to "assumed broken"; Blocked default to
  "uncertain" (so ticking Broken *confirms* dead). State keyed
  `cwbroken:/cwok:/cwts: host:url` in localStorage.
- Live header stats — **Broken internal/external destinations** + broken hyperlink
  instances + **Referrer pages with broken links** (AD-075, distinct pages still carrying a
  broken link — the workload-by-owner number) all update *as you triage*; each broken card
  carries an amber→green **triage-completeness outline** keyed by a compact upper-right legend.
  (Project-wide the verdict action is called **triaged**, not "tested" — AD-075.)
- **By-domain grouping** on Errors·external AND Blocked·uncertain: collapsible sections,
  a header **All: Broken / Working** bulk verdict (derived from the children, survives
  reload), a **Mixture** indicator, an **all triaged** indicator, a live
  **triaged K/N · B broken · W working** counter, and a **dashed-amber outline** on any
  domain still carrying untriaged links (clears when all are triaged).
- Satellite **link window**: clicking **any http(s) link on any tab** opens/reuses ONE popup
  docked to the side with more room (a single global interceptor, broadened AD-075 from
  `target=_blank`-only so it's an invariant; modified clicks still open a real new tab); each
  (re)use first flashes a **blob: interstitial** naming the link being loaded (identical 404s
  stay distinguishable).
- **Every tab grouped + tunable (AD-061/063/065).** Non-triage tabs (Internal/External/
  Out-of-scope) fold into the same collapsible sections (by first-level folder, or by host
  for External) with a count each and Expand/Collapse-all. Every tab's list lives in a
  fixed-height scroll viewport the operator can **drag taller** (definite `height`, no cap),
  and every grouped table's **columns are drag-resizable with no minimum** (broadcast across
  the tab's groups, persisted `cwcol:host:scope`, with a Reset button). The lengthy per-tab
  help collapses into a **"How this tab works"** disclosure.

### Fix tracker (standalone, AD-008, AD-030–033, AD-047, AD-062/064, AD-066–077)
- **Export fix tracker** bakes the still-broken links into a separate self-contained
  HTML, grouped **By page** (referrer → its broken links, one Notes field per page) or
  **By broken link** (link → every page that links to it). A **Fixed** checkbox per
  (page,link) pair stamps its own **Fixed-on** time; the same pair's flag is shared
  across both views. Verdicts + Last-tested carried in from the report.
- **Internal + external are ONE combined view** (AD-076): fixing is page-centric, so the old
  Internal/External tab is gone — a page's section lists *every* broken link on it with a **Type**
  column (By page) / badge (By broken link); `allList()` tags each entry, the stat matrix keeps its
  int/ext breakdown. **Every grouped table's columns are drag-resizable** (AD-077, the report's
  `.grptbl` grip/broadcast/persist mechanism, keyed per view, with **↔ Reset columns**).
- Each section is **collapsible** with a stacked header (long link on its own row), a live
  **K/N fixed** counter, an **All: Fixed** bulk box (ticks every Fixed box in the group), the
  By-broken-link **Broken/Working** bulk verdict, and a **translucent-amber outline** that
  clears once every link is fixed *or* working. The list scrolls in a resizable fixed-height
  viewport with the **pager kept ABOVE it** (visible while scrolling), and **group-level
  pagination** (50/page) keeps thousands of groups light.
- Sections **roll up under a collapsible folder/domain parent** (first-level path folder for
  internal, host for external — two-level nesting, AD-067). A **light/dark theme toggle** sits
  upper-right (AD-066). An **inverted Fixed/Broken stat matrix** scores the work above the tabs
  (top row Fixed = remediation-driven, bottom row Broken = verdict-driven; AD-068) — each Fixed
  card's "% of broken" uses the report's **adaptive `fmtPct`** (one-decimal floor, precision
  expands so a tiny fixed share never rounds to a misleading `0%`; AD-071, mirrors AD-056).
- State persists in the tracker's own `cwfix:host:` namespace (`ft:`/`vd:`/`vt:`/`n:`),
  pkey = `ref + NL + broken`.
- **Bulk export** (`saveBatch(mode)`, AD-072/074): batch-bake mini-trackers **per referrer page**
  (🗂) OR **per tier-1 subfolder** (🗁, `folderOf` — every page under `/about/` in one file), each
  scoped to its links (DATA spliced between `/*CW_DATA_BOUNDS*/` markers in a cloned doc with the
  rendered panels blanked; per-group `__CW_TRK_SEED__`). Written to a folder via `showDirectoryPicker`
  (download fallback), each **named after the sanitized address** (`pageFileName`: scheme dropped,
  non-`[A-Za-z0-9-._]`→`_`); all-Working groups skipped (toast reports how many). Delegate, get the
  owner's JSON back, Import merges it by the same per-pair keys (same host).
- Stat matrix has a 4th column **Pages with broken links / Pages remediated** (AD-074) — page-granular
  workload (a page is "broken" once it has any non-Working link, "remediated" once every one is Fixed);
  the subtitle counts **distinct** referrer pages (union, not the int+ext sum — §5 #26).

### Sharing (AD-030, AD-033, AD-069/070, AD-073)
- Report and tracker both: **Export / Import** verdicts (JSON, merge-by-link, host-checked)
  and **Save shareable copy** — bake current state into a `window.__CW_SEED__` /
  `__CW_TRK_SEED__` island injected before `</head>` so a recipient just opens the file.
- Every Export/Save routes through `saveBlob`, which opens a File System Access **"Save As"
  picker** (folder + name chosen by the operator; `<a download>` fallback where the API is
  absent; AD-069) and pre-stamps the suggested name with a **`_YYYY-MM-DD_HH-MM_SS` timestamp**
  so each export is its own versioned file (AD-070).
- **Team consolidation** (AD-073): **⬆ Import** is multi-file (`importStateFiles` merges a whole
  folder of contributors' drops in one action, one reload); `applyState` is namespace-guarded
  (only `cwfix:<host>:` keys land). `merge-fix-state.js` (repo root) is the dependency-free
  reference/CLI merger (union, later-wins, host-isolated); `SHAREPOINT-MERGE.md` is the
  Power-Automate-merge guide for a locked-down tenant (browser-side SP REST ruled out by
  custom-script policy + CORS — so a flow merges the drop folder into one `state.json`).

### Windows GUI (`crawl-gui.hta`, ~1017 lines, JScript)
- Form front-end that builds the `crawl.js` command line and launches it; live progress
  feed + counters by tailing the log; Pause/Stop/Resume; Re-check and Rebuild buttons.
- Optional config files beside it: `crawl-gui-domains.txt` (default Start URLs),
  `crawl-gui-config.txt` (default field values). Sizes its window to the content on open.

### Browser toolchain
- `web-crawler.html` — a crawl that runs entirely in a tab. `local-cors-proxy.js` — a
  zero-dependency CORS proxy so the HTML version can cross origins from `file://`.

---

## 3. Architecture & implementation model

**Module DAG** (plain CommonJS `require()` modules under [`src/`](../../src/), rolled up
by an **esbuild build** into the single shipped `crawl.js` — AD-081/082). The source lives
in `src/`; the root `crawl.js` is a **generated artifact** (`npm run build`). The roll-up
keeps the **no-install-at-runtime** property (the built file uses Node built-ins only; the
build tool is a `devDependency`) while letting the source be small modules. Acyclic:

```
src/parse ← fetch ← netutil
                  ← cli            (BROWSER_UA)
src/report ← report-templates/     (index → newwin, tracker-template)
src/recheck ← netutil, fetch, report
src/crawl ← cli, netutil, recheck, report, parse, fetch, log, seen   ──build──▶ ./crawl.js
```

> **Note (AD-081/082):** the earlier "no bundler — a bundler would buy nothing and would
> cost the no-install property" rationale was superseded once the charter was revised to
> permit a build-time roll-up (modality B / rhizome DS-002). The bundler does *not* cost the
> no-install property — it preserves it at runtime while shrinking the source. The migration
> was verified **byte-identical** (built rebuild exact; built crawl equal modulo `runtimeMs`).

`crawl.js` was deliberately partitioned down from ~1,860 lines to ~625 (AD-009/14/16; now
~665 after later features): report layer → `report.js`; parse/fetch/log/seen leaves;
cli/netutil/recheck modes & utilities. What *stayed* in `crawl.js` is the ~450-line
stateful engine (workers, throttle, journal close over shared state) — splitting it would
hurt readability, not help. `report.js` (~1,136 lines) is one coherent builder kept whole
for the same reason and pending restored test coverage; `report-templates.js` was split
into `src/report-templates/` (newwin + tracker-template + index). Every split was verified
**byte-identical** (a deterministic crawl produces the same HTML + JSON before/after, modulo
timestamps).

**The report is a self-contained app, not a document.** Its CSS/JS are inline; its
state lives in `localStorage`; sharing works by baking a JSON seed island into a copy.
Triage verdicts, fix-tracker flags, and `<details>` open-state all persist client-side.

**Derived-not-stored state.** Domain-header verdicts (Broken/Working/Mixture/all-tested/
counter) are *derived from the per-link boxes* on load and after every change — no extra
storage, so they survive reload for free.

**Template-embedding constraint.** `NEWWIN` and `TRACKER_TEMPLATE` (now in
`src/report-templates/`) are concatenated into the report's template literals, so they must
contain **no backtick, no `${}`, no backslash**. Double-quotes in emitted markup come from
`String.fromCharCode(34)`; newlines/backslashes from `String.fromCharCode`. A guard
(`node -e` checking those three substrings) is the standing test.

---

## 4. What worked

- **Append-only journal** for resume — survives hard kills, append-once I/O scales to
  huge crawls, replay reuses the live `addRef`/`seen.tryAdd` so the rebuilt state matches.
- **Module DAG with byte-identical verification** — refactor freely while *proving* zero
  behavior change. This discipline (AD-009/14/16) is the reason aggressive splits were safe.
- **Report-as-app with localStorage + seed-island sharing** — full triage UX with zero
  server and zero dependencies; emailing a single `.html` carries the state.
- **Custom collapsible** (div + toggle button + `.collapsed` class) instead of native
  `<details>/<summary>` — see lesson below; deterministic, and Collapse-all is reliable.
- **DOM-stub test harnesses in Node** — an `El()` stub (some with a small `innerHTML`
  parser) + a working `localStorage` stub let the *real* report/tracker IIFEs run under
  `new Function(...)`, so browser logic is unit-tested with no browser.
- **Headless real-click testing** for the things stubs can't model (below).
- **Persist-and-restore via the data round-trip** (settings in JSON, AD-049) — fixes
  rebuild/re-check *and* the CLI *and* old workflows at once, no GUI change needed.
- **blob: interstitial** for the popup — verified that a `file://` page can top-level-
  navigate to a blob it created, which is what makes the "loading next link" cue work locally.
- **One grouping primitive, two flavors.** `domainGroups(arr, scope, head, cells, keyOf)` (triage,
  with verdict controls) and `simpleGroups(items, keyOf, head, rowFn, tcls)` (non-triage, no controls)
  render the SAME `.domgrp` collapsible; `keyOf` is `hostOf` for domains and `folderOf` for first-level
  folders. Every tab ends up visually and behaviorally identical for free (AD-061).
- **Iterative UI by screenshot loop.** Almost all of AD-061–065 was the operator reacting to a headless
  screenshot, one small change at a time. The tight `synthstate → inject probe/force-tab → --screenshot
  → Read` cycle made dozens of refinements cheap and low-risk — the feedback loop *was* the design tool.
- **"Resolved = fixed OR working."** Completion isn't just "fixed": a link confirmed **Working** needs no
  fix, so a tracker section's amber clears when every link is fixed *or* working — a one-line semantic that
  matches how people actually triage, computed from the group's own `.vo` boxes (AD-064).
- **Per-context divergence when the convention stops fitting.** The report's group headers are one
  right-aligned row; the tracker's grouped key is a long URL, so its header deliberately STACKS (title row
  / left-aligned controls row / notes row). Copying the convention would have wrapped badly — diverging on
  purpose read far better (AD-064).

---

## 5. What did NOT work — hard-won lessons

These are the traps. Re-reading this section before touching the relevant area saves a cycle.

**By theme** (jump to the cluster that matches what you're about to touch):
- *The embedded template is a string later wrapped as JSON — it evades normal validation:* #7, #15, #21, #23.
- *Test-harness traps (stubs, slicing, stale fixtures, shared infra):* #6, #12, #14, #16, #19, #23, #24, #28, #30.
- *Cross-`<script>`/cross-window scope & helpers:* #2, #3, #25.
- *CSS layout, resize grips & column widths:* #13, #17, #22, #29.
- *Process & correctness (reproduce-first, single-source numbers, reset layers, reversals):* #4, #5, #8, #10, #18, #26, #27, #31.
- *Environment quirks (`file://`, `pkill`, HTA/JScript, screenshot timing):* #1, #4, #8, #9, #10, #11, #20, #31, #32.

1. **Native `<summary>` eats clicks on interactive children.** Real clicks on a checkbox
   inside a `<summary>` are consumed by the disclosure toggle, so the box never fires
   `change`. Stub tests (which dispatch `change` directly) passed while the real browser
   failed. **Fix:** custom collapsible — a `<button class="domtoggle">` + the controls as
   siblings + a `.collapsed` class driven by JS. (AD-043; reported twice before the real-
   click test caught it.)

2. **You cannot write into a cross-origin popup; `data:` top-level nav is blocked.** Once
   the satellite window is on an external 404, the report can only *navigate* it, not
   `document.write` into it. `data:` URLs are blocked for top-level navigation. **Fix:** a
   **blob:** interstitial the opener creates (same-origin with the blob → may navigate even
   a cross-origin popup) that meta-refreshes to the target. (AD-051.)

3. **Nulling `opener` revokes navigation permission.** The satellite-reuse bug: keeping
   `nw.opener=null` (reverse-tabnabbing hygiene) revokes the opener's permission to
   navigate the popup, so cross-origin `SAT.location` throws → every click spawned a new
   window. **Fix:** stop nulling the opener; accept the minor exposure for a local tool.
   (AD-039 follow-up — took two reports + a real-click test to nail.)

4. **`file://` blocks `localStorage` in Chrome.** Saved/shared copies can't rely on storage
   when opened locally. **Fix:** the tracker falls back to a read-only **seed island**
   (`__CW_TRK_SEED__`) for display; true import/persistence needs the page served over a
   local web server. (AD-030/033.)

5. **A rebuild/re-check rewrite runs in a *separate process* with default cfg.** The GUI's
   "Rebuild report" passes no tuning flags, so the config line showed `4/100/no-rps/200/3`
   for a `2/3000/1/no-limit` crawl. **Fix:** persist crawl settings in the JSON, restore on
   rewrite; don't touch the live cfg that drives the re-probe. (AD-049.)

6. **Stub tests can pass while the real browser fails.** Synthetic event dispatch misses
   summary-eats-clicks (#1) and the cross-origin throw (#3). **Lesson:** for click-path and
   cross-window behavior, add a **headless dispatched-`MouseEvent`** test that writes
   results to a `<div>` and `--dump-dom | grep`s them; don't trust stubs alone.

7. **Template-literal poison.** A stray backtick / `${}` / backslash inside `NEWWIN` or
   `TRACKER_TEMPLATE` silently breaks the *outer* report template. Emit double-quotes via
   `String.fromCharCode(34)`, use `.split().join()` instead of regex literals containing a
   quote, and run the three-substring guard after every edit. (AD-036, AD-051.)

8. **The HTA is ES3/ES5 JScript** — no arrow functions, `let`/`const`, or template
   literals. Verify changes with `new Function(code)` before assuming they parse; the
   `.hta` itself is Windows-only and can't be run in this environment.

9. **Partial (live) reports auto-refresh and clear ticks** — so triage/export UI is gated
   to the *final* report only. (AD-007.)

10. **`pkill` kills the shell** running it (its own command line matches the pattern), exit
    144. Don't `pkill` in this environment; track and kill by PID, or use the harness's
    background-process handling.

11. **Headless screenshot timing races the report's own load scripts.** An injected
    `DOMContentLoaded` handler that re-sorts tabs/cards often loses to the report's IIFEs.
    **Fix:** isolate panels for a screenshot with **static CSS injection** (`<style>` before
    `</head>`) instead of JS — no timing dependency.

12. **Host/key mismatches in tests.** The DOM-stub suites hardcode `cwok:x:`-style keys, so
    synthetic fixtures must use host `x` (`http://x/...`), not `x.test`. A few "bake"
    failures in `tracker2-test` are **stale test data**, not regressions — `exportTracker`
    is unchanged.

13. **`max-height` + `resize` = a grip that only shrinks.** CSS `resize:vertical` writes the
    element's `height`, but a `max-height` *caps* it — so once content is taller than the cap
    (scrollbar already showing) the box is AT max-height and dragging the corner DOWN does
    nothing; only dragging up (shrink) works. The operator reported exactly that: "the corner
    works upward, there's a limiter downward." **Fix:** a definite default `height` and NO
    `max-height` (keep `min-height` as a floor); pin nested viewports back to `height:auto` so
    they don't inherit it. (AD-063 → AD-064.)
    ```css
    /* broke: grip shows, can't grow past 460 */     .groupview{max-height:460px;overflow:auto;resize:vertical}
    /* worked: default height, drags both ways */     .groupview{height:460px;min-height:160px;overflow:auto;resize:vertical}
    .domgrp .dombody{height:auto;resize:none}    /* nested table body: don't inherit the 460 / no grip */
    .tablewrap .tablewrap{height:auto;resize:none}  /* nested found-on list: same */
    ```

14. **`classList` / `closest` break the DOM-stub tests.** The first `All: Fixed` pass used
    `el.classList.toggle()` and `this.closest('.grp')`; the `El()` stub implements neither, so
    `revtest`/`tracker3` throw. **Fix:** reuse the report IIFE's idiom — token-matching
    `hasCls`/`addCls`/`toggleCls`/`grpOf` (the stub only needs `.className` + `.parentNode`).
    `grpOf` must match the EXACT `grp` token, or `.grpbody`/`.grphead` false-match.
    ```js
    // broke under the stub:  var g=this.closest('.grp'); g.classList.toggle('collapsed');
    function hasCls(el,c){return (' '+(el.className||'')+' ').indexOf(' '+c+' ')>=0;}
    function grpOf(el){var n=el;while(n){if(hasCls(n,'grp'))return n;n=n.parentNode;}return null;}
    var g=grpOf(this); toggleCls(g,'collapsed');   // worked
    ```

15. **CSS escapes are template-literal poison too (extends #7).** `content:"\25BC"` inside
    `TRACKER_TEMPLATE` (a backtick literal later embedded as a JSON string) trips the
    no-backslash rule and corrupts the outer template. **Fix:** the literal glyph, like
    `report.js` already uses.
    ```css
    /* broke */   .caret::before{content:"\25BC"}
    /* worked */  .caret::before{content:"▼"}      .grp.collapsed .caret::before{content:"▶"}
    ```

16. **Shared infra is unreachable if its IIFE bails or its selector is scoped.** The
    drag-resize machinery lives in the triage IIFE, which opens with
    `if(!document.querySelector('tr[data-url]')) return;` and only selects
    `table.haspick,table.blkpick`. "Just reuse it" for the non-triage tabs silently did nothing
    (no `data-url` rows; wrong selector). **Fix:** the always-run non-triage IIFE carries its
    OWN copy, keyed `cwcol:host:<internal|external|outscope>`, selecting `table.grptbl`.
    **Lesson:** before reusing across IIFEs, check BOTH the early-return gating and the selector.

17. **`table-layout:fixed` columns won't shrink past the global min-widths.** A resizable column
    stalls at `th:first-child{min-width:360px}` / `td:last-child{min-width:300px}`, plus
    `.tcol`/`.pickcol` had their own `min-width` — so "some columns have a minimum, others
    don't." **Fix:** blanket `min-width:0` on the resizable tables' `th,td`, drop the per-class
    minimums, and lower the JS grip floor so every column resizes uniformly with no minimum.
    ```css
    table.haspick,table.blkpick,table.grptbl{table-layout:fixed;width:max-content}
    table.haspick th,table.haspick td,table.grptbl th,table.grptbl td{min-width:0}  /* defeat globals */
    ```
    ```js
    // broke: 40px floor + per-column min-width      cur=Math.max(40, startW+dx);
    // worked: a token floor only (keeps the grip grabbable, ~no minimum)  cur=Math.max(16, startW+dx);
    ```

18. **Revert-and-reapply beats piecemeal un-editing on a course reversal.** When the ask flipped
    ("remove the Broken/Working boxes" → "keep them, just ADD `All: Fixed`"), un-doing four
    removal edits by hand is error-prone. **Fix:** `git checkout report-templates.js` to restore
    the committed baseline, then apply only the additive change — one clean diff, no
    half-reverted state. (Cheap because the prior step was already committed.)

19. **Verify a "new" test failure is actually new (extends #12).** `tracker-test`/`tracker2-test`
    failed after a tracker edit; `git stash` + regenerate + re-run showed the SAME failure on the
    committed baseline — they assert an older fixture shape and were never in the maintained set
    (`tracker3` is). Only attribute a regression once you've reproduced green→red across the edit.

20. **Forcing a screenshot tab: static `<html class>` is unreliable; force it last.** Injecting
    `class="tab-errext"` on `<html>` did NOT stick (the report's no-flash restore script left the
    default), so the shot showed the wrong tab. **Fix:** force it from an END-of-body
    `<script>document.documentElement.className='tab-errext'</script>` that runs after the head
    script; for the tracker, dispatch a real click on the target `gtab`. (Refines #11: static for
    panel ISOLATION, end-of-body JS for ACTIVE-TAB selection.)

21. **`\s`/`\d`/`\w` SILENTLY die in `report.js`'s outer template literal (the quiet cousin of #7/#15).**
    A stray backtick breaks parsing loudly; a regex backslash-escape does NOT — `/^\s+/` written inside
    the returned HTML template literal is cooked to `/^s+/` (the `\s` collapses to `s`), an emitted regex
    that's wrong but throws nothing. It bit the class-trim helpers — `(' '+cn+' ').split(' '+c+' ').join(' ')
    .replace(/^\s+|\s+$/g,'')` actually matched the letter "s", so classNames accreted stray edge spaces
    (harmless only because every membership test is space-padded `(' '+cn+' ').indexOf(' c ')`). Found in
    review across 5 sites, incl. pre-existing ones. **Fix:** inside the HTML template literal prefer
    `.trim()` / literal char classes / doubled `\\s`; and grep the EMITTED report (not the source) for
    `/^s` to catch it — the source looks correct.

22. **A "reset to defaults" that clears inline styles needs the defaults in CSS, not inline.** The
    non-triage resizable columns baked their defaults as `<th style="width:…">`; the drag writes
    `th.style.width`, and `resetCols` cleared it with `style.width=''` — which also wiped the inline
    DEFAULT, so reset collapsed the columns to content width (until reload re-parsed the inline). The
    triage tables were immune because their defaults are CSS classes, so clearing the inline override
    falls back to CSS. **Fix:** express resettable defaults in CSS (a class, or `#panel .grptbl
    th:nth-child(n)`); reserve inline for the live override; reset = clear the override = revert to CSS.

23. **Inner IIFEs in `TRACKER_TEMPLATE` break the slice-based test harness (the structural cousin of #7).**
    The suites extract the client script with `TPL.indexOf('(function(){')` … `TPL.indexOf('})();')`. An
    inner IIFE `(function(){…})()` plants a `})();` that the naive slice mistakes for the script's END, so
    the eval'd slice is brace-unbalanced → "Unexpected end of input" in `revtest`/`tracker3`. `require()`
    still passes — the template is just a string to Node, so **module-load is NOT a validation of the
    template's contents.** **Fix:** never use an inner IIFE inside the template (use a named function), and
    add an explicit `new Function(TPL.slice(iife))` parse-check after template edits. (AD-074.)
    ```js
    // broke: the test's slice stops at THIS })();
    var refPages=(function(){ var s={}; …; return n; })();
    // worked:
    function distinctRefPages(){ var s={}; …; return n; }  var refPages=distinctRefPages();
    ```

24. **A structural DOM-id rename must touch every test's OWN stub — the suites don't share one.** `tracker3`,
    `revtest`, etc. each build their own `mkEls`/`mkDoc`. Renaming `panel-int`/`panel-ext` → `panel-all`
    crashed `revtest` on a null `getElementById('panel-all')` until its stub was updated too. **Fix:** when
    renaming a structural id/selector, grep ALL test files for the old name; a green core suite can still
    hide a stub that builds the old DOM. (AD-076.)

25. **Helpers don't cross `<script>` IIFE boundaries — and that's a real browser ReferenceError, not a test
    artifact.** `report.js` ships two separate `<script>` IIFEs; `saveBlob`/`dl`/`toast` defined in one are
    `undefined` in the other. The suite caught it (`saveBlob is not defined`, exporttest 13→3) — the browser
    throws identically. **Fix:** duplicate shared helpers into each IIFE scope, as the pre-existing duplicated
    `toast` already did. (AD-069.)

26. **Two code paths that count "the same thing" differently WILL diverge — and a careful operator notices.**
    The tracker subtitle summed internal-tab + external-tab page counts (double-counting a page that links
    both → **551**) while the per-page export counted the distinct union (**512**). The operator spotted the
    39-gap. **Fix:** derive the displayed number from the SAME function that drives the behavior (`count()`
    over the combined list), and surface the reconciliation (the export toast now reports how many all-Working
    pages it skipped). (AD-074.)

27. **Audit a reported bug before fixing; if the code is already right, encode the invariant.** "The reused
    link-window isn't applied to the External tab" — but an anchor audit showed **25/25** anchors already
    routed through one global interceptor (the operator's report was a stale file). Rather than "works for
    me," verify empirically, then HARDEN: broaden the interceptor to catch any `http(s)` link regardless of
    `target`, so the consistency is an invariant, not a per-anchor accident. (AD-075.)

28. **Headless probe-source pollution: a whole-document substring search false-matches the probe's own
    injected `<script>`.** A test injected URL literals (`'ext/e1'`) then searched the cloned document for
    them and false-positived — because `savePerPage` clones the LIVE document (probe included) into each
    output. **Fix:** assert on the PARSED data (the scoped `DATA`, computed counts like `bInst`), never a
    substring scan of a document that contains your probe. (AD-072.)

29. **`width:max-content` gets clipped by an ancestor's `overflow:hidden`; mix the overflow axes.** Porting
    resizable columns to the tracker, the group wrapper had `overflow:hidden` (border-radius) and the table
    wrap was `overflow:visible`, so a dragged-wide table was CLIPPED, not scrollable. **Fix:**
    `overflow-x:auto;overflow-y:hidden` on the wrap (a valid auto/hidden mix — `visible`+`auto` is not). (AD-077.)

30. **Regenerate the generated artifact after EVERY template edit, before testing (sharpens #6's note).** The
    suites extract the live IIFE from `synth.html`; a probe read a STALE `synth.html` (pre-edit) and reported
    the new stat cards "missing." **Fix:** `node synthstate.js synth.html` is the first step of every test run
    after touching `report*.js` — baked-in fixtures lie. (Bit repeatedly; AD-074/075.)

31. **A smart-quote-substituting editor silently turns ASCII `"` (0x22) into a curly `“`/`”` (U+201C/U+201D), and JScript's "Invalid character" names the corruption site, not the edit that caused it.** Editing a JScript line, its straight string-delimiter quotes came back as curly quotes. JScript cannot use curly quotes as string delimiters, so the *entire* `<script>` block fails to compile — `Invalid character` at the first curly byte, which sits several lines below the real edit and disables everything downstream (tab navigation, and `fitWindowWidth()` so the HTA window stops clamping its own width). **The misdirection bit twice:** the reported line also carried an em-dash comment and a `writeFile(x, "")`, so two successive "fixes" each removed *one* visible non-ASCII char and the error persisted — because the same edit had curlied EVERY delimiter across three `setStatus(...)` catch blocks, not just that line. **Comment non-ASCII is a red herring:** em dash / `…` / `·` inside `//` comments parse fine (the 32 such chars were byte-identical to the last known-good revision that ran at runtime); only non-ASCII in CODE position is fatal. **Technique:** don't trust the reported char — tokenize the whole script (track `"`/`'`/`//`/`/* */`/code state) and assert ZERO bytes >= 0x80 in code position; repair with a binary `replace` (re-editing re-introduces the curlies), and KEEP curly quotes that legitimately live inside string *content* (`“Copy command”` reads better than escaping). Cross-ref #8 (it's JScript) and #7/#21 (silent corruption that a module-load / `require()` never catches). **Caveat:** this only un-blocked the parse error introduced by the fix's *delivery* — it did NOT resolve the Laserfiche zero-crawl symptom, which is still open (§7). (AD-089 delivery; commits f0db8d0, 868ac64.)
    ```js
    // broke: the editor replaced every straight delimiter " with a curly “ (U+201C)
    setStatus(“Couldn't write helper files to “ + workDir + “ — “ + e.message + “.…”, “bad”);
    // worked: ASCII " DELIMITERS; the curly quotes around "Copy command" are real string CONTENT — keep them
    setStatus("Couldn't write helper files to " + workDir + " — " + e.message +
              ". …click “Copy command” and run it in a terminal.", "bad");
    ```
    ```
    # the check that would have caught it on pass 1 (walk the <script>; in CODE state any ord>=0x80 is fatal):
    #   string-aware (" '), comment-aware (// and /* */); a curly quote / em dash INSIDE a string or comment is fine,
    #   only one in code position is the bug. result must be the empty set.
    ```

32. **Playwright `page.$$eval` / `page.evaluate` see ONLY the top document — a portal that renders its listing
    in an `<iframe>` harvests as ZERO links.** Laserfiche WebLink (and many doc portals) embed the
    folder/document listing in a frame; discover's harvest queried just the main frame, so it rendered the page
    fine yet found no `<a href>`, wrote empty seeds, and crawl.js then "crawled nothing." Reproduced with the
    bundled Chromium against an iframe fixture: 0 docs before, 5 after. **Fix:** iterate `page.frames()` (it
    includes the main frame, so it is a strict superset) and collect `a[href]` + onclick/data-* from each,
    skipping a detached/cross-document frame. **Corollary:** when a render yields nothing beyond the seeds, SAY
    SO loudly with likely causes (settle/timeout · login/disclaimer/repo-picker · pagination/virtual-scroll)
    instead of failing silently — the GUI surfaces discover's stdout in its live-monitor fallback. (AD-090.)
    ```js
    // broke: top frame only -> 0 links when the listing is inside an <iframe>
    domLinks = await page.$$eval("a[href]", as => as.map(a => a.href));
    // worked: every frame (page.frames() already includes the main frame)
    for (const fr of page.frames()) {
      try { for (const h of await fr.$$eval("a[href]", as => as.map(a => a.href))) domLinks.push(h); }
      catch { /* detached/navigating frame */ }
    }
    ```

---

## 6. Testing approach

No test framework (zero-dep ethos). Tests are standalone Node scripts in the scratchpad
that either (a) drive the *real* browser IIFE extracted from a generated report under a
DOM/`localStorage` stub, or (b) drive real Chromium headless (`--dump-dom`). As of 2026-06-27
the maintained set is **244/0**:

- **DOM-stub suites** (extract + eval the live IIFE): `domtest` (domain grouping + indicators +
  untested highlight), `vtest` (triage verdicts), `sharetest` (verdict export/import/seed),
  `revtest` (tracker By-page/By-link sync), `tracker3-test` (tracker export/save-copy/seed +
  multi-file import + subtitle), `newwin-test` (satellite window + interstitial), `exporttest`
  (fix-tracker export inclusion rules), `cfgtest`/`cfgtest2` (settings round-trip).
- **Headless-Chromium probes** (real DOM/CSS/events): `pageE2E`/`folderE2E` (per-page/per-subfolder
  scoped exports), `trk-pages` (Pages-remediated stat), `pgcard-probe`/`pgcard-dyn` (the report's
  Referrer-pages card, live recompute + outline), `trk-merge` (merged int/ext view + Type column +
  grips), `trk-resize` (a dispatched mousedown→move→up that actually widens + persists a column),
  `pagetest`/`merge-fix-state` (filename sanitize + the reference merger).

Technique notes that recur: drive async promise chains to completion before `--dump-dom` with
**synchronous thenables** (`{then:f=>…}`) since `setTimeout`/microtasks don't flush before the dump;
assert on **parsed data**, never substring-scans of a doc that contains your probe (§5 #28); and
**always regenerate `synth.html` first** (`node synthstate.js synth.html`) — the suites extract the
live IIFE, so a stale fixture lies (§5 #30). Refactors are checked **byte-identical**; visual claims
with a headless screenshot. (`blocked-test`/`manual-test`/`tracker2-test` are superseded, pre-existing
crashes — NOT in the maintained set; §5 #12/#19.)

---

## 7. Open threads / not yet done

- **Laserfiche WebLink zero-crawl — RESOLVED 2026-06-28 (AD-090).** The browser harvest read only the
  top frame, so a folder listing embedded in an `<iframe>` (a common WebLink layout) yielded 0 links —> empty
  seeds —> nothing crawled. Fixed by harvesting all `page.frames()` (§5 #32) plus a `--settle 2500` render
  cushion; the operator re-ran against the live DHW site and it crawls the repository again. (AD-089's instant
  "Done — 0 crawled" was a separate, earlier bug — a stale-`DONE_` poll artifact whose fix delivery hit the
  smart-quote trap §5 #31.)

- The browser toolchain (`web-crawler.html`) has not received the triage/fix-tracker UX the
  Node report has; it remains the lightweight in-tab variant.
- `_instance.md`'s file-inventory table carries a 2026-06-26 note enumerating the sibling
  modules and redirects here for the module DAG (the canonical current shape is §3 above);
  the table itself still has one row per *toolchain entry point* rather than per leaf module,
  which is the intended altitude for a governance/identity file.
- Interstitial delay (~0.6s) and the satellite's reverse-tabnabbing exposure are accepted
  trade-offs for a local tool; revisit if Charlotte is ever served to untrusted users.
- The fix tracker's import/persistence needs a served page on `file://` Chrome (lesson #4);
  a documented "serve it" path exists but there's no bundled server for the tracker.
