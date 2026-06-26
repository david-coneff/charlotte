# Charlotte — Synthesis: features, implementation, and lessons

A durable, high-altitude companion to the decision log. The ADRs
([`decisions.md`](decisions.md) → `decisions/`) record *each* decision in order;
this document synthesizes the **whole**: what the program is for, what has
actually landed, how it's built, and — most valuably — what worked and what
didn't, so the hard-won knowledge survives even when the per-decision detail is
too much to re-read. `RESUME_BLOCK.md` is the "where am I right now" pointer;
`_instance.md` is the governance charter; this is the retrospective map.

_Last synthesized: 2026-06-26, through AD-052._

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

The throughline of the last ~35 decisions (AD-017–052): turn the report from a
*read-only artifact* into a **triage workstation** — mark links Broken/Working,
track fixes, and hand the verdicts off — without ever breaking the zero-dependency,
self-contained, open-from-`file://` properties.

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

### Triage workstation (AD-028–052)
- Per-link **Broken / Working** verdicts — mutually exclusive, auto-stamped
  **Last-tested** time. Errors default to "assumed broken"; Blocked default to
  "uncertain" (so ticking Broken *confirms* dead). State keyed
  `cwbroken:/cwok:/cwts: host:url` in localStorage.
- Live header stats — Broken·internal/external destination counts + broken hyperlink
  instances update *as you triage*.
- **By-domain grouping** on Errors·external AND Blocked·uncertain: collapsible sections,
  a header **All: Broken / Working** bulk verdict (derived from the children, survives
  reload), a **Mixture** indicator, an **all tested** indicator, a live
  **tested K/N · B broken · W working** counter, and a **dashed-amber outline** on any
  domain still carrying untested links (clears when all are tested).
- Satellite **link window**: clicking a broken link opens/ reuses ONE popup docked to
  the side of the report with more room; each (re)use first flashes a **blob:
  interstitial** naming the link being loaded (so identical 404s are distinguishable).

### Fix tracker (standalone, AD-008, AD-030–033, AD-047)
- **Export fix tracker** bakes the still-broken links into a separate self-contained
  HTML, grouped **By page** (referrer → its broken links, one Notes field per page) or
  **By broken link** (link → every page that links to it). A **Fixed** checkbox per
  (page,link) pair stamps its own **Fixed-on** time; the same pair's flag is shared
  across both views. Verdicts + Last-tested carried in from the report.
- State persists in the tracker's own `cwfix:host:` namespace (`ft:`/`vd:`/`vt:`/`n:`),
  pkey = `ref + NL + broken`.

### Sharing (AD-030, AD-033)
- Report and tracker both: **Export / Import** verdicts (JSON, merge-by-link, host-checked)
  and **Save shareable copy** — bake current state into a `window.__CW_SEED__` /
  `__CW_TRK_SEED__` island injected before `</head>` so a recipient just opens the file.

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

**Module DAG** (plain CommonJS `require()`, no bundler — a bundler would buy nothing
for a Node CLI and would cost the no-install property). Acyclic:

```
parse ← fetch ← netutil
              ← cli            (BROWSER_UA)
report ← report-templates      (NEWWIN, TRACKER_TEMPLATE)
recheck ← netutil, fetch, report
crawl ← cli, netutil, recheck, report, parse, fetch, log, seen
```

`crawl.js` was deliberately partitioned down from ~1,860 lines to ~625 (AD-009/14/16; now
~665 after later features): report layer → `report.js`; parse/fetch/log/seen leaves;
cli/netutil/recheck modes & utilities. What *stayed* in `crawl.js` is the ~450-line
stateful engine (workers,
throttle, journal close over shared state) — splitting it would hurt readability, not
help. Every split was verified **byte-identical** (a deterministic crawl produces the
same HTML + JSON before/after, modulo timestamps).

**The report is a self-contained app, not a document.** Its CSS/JS are inline; its
state lives in `localStorage`; sharing works by baking a JSON seed island into a copy.
Triage verdicts, fix-tracker flags, and `<details>` open-state all persist client-side.

**Derived-not-stored state.** Domain-header verdicts (Broken/Working/Mixture/all-tested/
counter) are *derived from the per-link boxes* on load and after every change — no extra
storage, so they survive reload for free.

**Template-embedding constraint.** `NEWWIN` and `TRACKER_TEMPLATE` (in
`report-templates.js`) are concatenated into the report's template literals, so they must
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

---

## 5. What did NOT work — hard-won lessons

These are the traps. Re-reading this section before touching the relevant area saves a cycle.

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

---

## 6. Testing approach

No test framework (zero-dep ethos). Tests are standalone Node scripts in the scratchpad
that either (a) drive the *real* browser IIFE extracted from a generated report under a
DOM/`localStorage` stub, or (b) drive real Chromium headless. Key suites:
`domtest` (domain grouping + indicators + untested highlight), `vtest` (triage verdicts),
`sharetest` (verdict export/import/seed), `revtest` (tracker By-page/By-link sync),
`tracker3-test` (tracker export/save-copy/seed), `newwin-test` (satellite window +
interstitial), `cfgtest` (settings round-trip). Refactors are checked **byte-identical**.
Visual claims are confirmed with a headless screenshot. **Always run the suites against a
freshly regenerated report** (`synthstate.js synth.html`), since they extract the live IIFE.

---

## 7. Open threads / not yet done

- The browser toolchain (`web-crawler.html`) has not received the triage/fix-tracker UX the
  Node report has; it remains the lightweight in-tab variant.
- `_instance.md`'s file-inventory table predates the module split (it lists only `crawl.js`);
  the DAG in §3 here is the current shape.
- Interstitial delay (~0.6s) and the satellite's reverse-tabnabbing exposure are accepted
  trade-offs for a local tool; revisit if Charlotte is ever served to untrusted users.
- The fix tracker's import/persistence needs a served page on `file://` Chrome (lesson #4);
  a documented "serve it" path exists but there's no bundled server for the tracker.
