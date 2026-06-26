# rhiz-memory — Charlotte Instance

**Protocol**: david-coneff/rhizome
**Instance type**: Child repository (standalone project)
**Project**: Charlotte — standalone website / domain crawler

---

## Session startup

When starting a session on Charlotte under the Rhizome methodology:

1. `david-coneff/rhizome` — `rhizome/core/rhiz-core.md` (always loaded)
2. `david-coneff/rhizome` — `rhizome/core/rhiz-core.manifest.yaml` (select modules for task)
3. `rhiz-memory/_instance.md` (this file — project identity + startup)
4. `rhiz-memory/state/SESSION_HANDOFF.md` (current work context and next action)

The Rhizome protocol specs live entirely in `david-coneff/rhizome`.

---

## Project identity and intent

Charlotte is a **standalone website crawler**. Given one start URL it maps a
single site: it enumerates every internal link, records (but never follows) the
first-tier external links those pages point to, verifies links — including links
embedded in PDFs and Office documents — and writes a self-contained HTML report
you open directly in a browser.

It grew up inside the `broodforge` repository under `tools/`, but it is a
**distinct tool with no code coupling** to broodforge — it imported nothing from
that tree and nothing there imported it. On 2026-06-24 it was lifted out into
this repository so it can live and evolve as its own project. See
`rhiz-memory/state/decisions.md` AD-001.

### Project Charter (sovereign — outranks Rhizome protocol on project matters)

Charlotte:

**SHALL:**
- Map a single domain: enumerate internal links, record first-tier external links.
- Verify links (HEAD then GET; scan links inside PDF/Office documents; optional
  headless-browser re-check of suspect links).
- Produce a self-contained HTML report (optionally JSON) that needs no server,
  network, or dependency to view.
- Run the core crawler with **zero install** — Node built-in modules only.

**SHALL NOT:**
- Follow or read external pages. External links are recorded and, at most,
  checked once for whether they resolve. The crawler never reads an external
  page or follows its links.
- Require npm dependencies for the core crawler. Playwright is the only external
  dependency anywhere, it is **optional**, lazy-loaded, and used solely by
  `crawl-render.js` (which degrades to plain HTTP checks with `--http-fallback`).
- Spoof identity. `--browser` sends an honest desktop-browser `User-Agent` and
  the headers a browser sends — no cookie, JS, or fingerprint spoofing.

### Design principles

1. **Zero-dependency core.** `crawl.js` and `local-cors-proxy.js` use only Node
   built-ins (`http`, `https`, `fs`, `path`, `zlib`, `url`).
2. **Single-domain scope.** Internal links are followed within limits; external
   links are recorded, never followed. Depth applies only to the internal crawl.
3. **Self-contained outputs.** The HTML report embeds everything it needs; it
   opens from `file://` with no external assets.
4. **Crash-resilient.** Checkpointing, a partitioned progress log, and a
   resumable seen-index mean a killed run still leaves a current snapshot.
5. **Honest crawling.** Real UA/headers when asked; global rate-limit (`--rps`)
   and per-worker delay so the crawler stays polite.
6. **Loose coupling.** Each file is independently runnable. The couplings
   between files are runtime / file-format only — never `require()` imports.

---

## Architecture summary (how the implementation meets the intent)

Charlotte is **two independent toolchains** that share one set of docs:

| Toolchain | Files | What it gives you |
|-----------|-------|-------------------|
| **Node** (full-featured, actively developed) | `crawl.js`, `crawl-gui.hta`, `crawl-render.js` | CLI crawl with no CORS limits, an optional Windows GUI, and a headless-browser second opinion on flagged links. |
| **Browser** (lightweight, no install) | `web-crawler.html`, `local-cors-proxy.js` | A crawl that runs entirely in a browser tab, with an optional zero-dependency CORS proxy for cross-origin `file://` use. |

### File inventory

> **Note (2026-06-26):** `crawl.js` has since been partitioned into sibling leaf
> modules — `cli.js`, `netutil.js`, `recheck.js`, `report.js`, `report-templates.js`,
> `parse.js`, `fetch.js`, `log.js`, `seen.js` (all plain `require()`, no bundler;
> AD-009/14/16/36). They ship and travel together. The current module DAG and a full
> capability/lessons retrospective live in [`state/SYNTHESIS.md`](state/SYNTHESIS.md).

| File | Role | Runtime |
|------|------|---------|
| `crawl.js` (+ sibling modules) | Core crawler: crawls a domain, verifies links, scans PDF/Office links, writes the HTML report + JSON + progress logs. The engine + glue; report/parse/fetch/log/seen/cli/netutil/recheck are split into siblings it `require`s. | Node ≥ 14, zero deps |
| `crawl-gui.hta` | Windows GUI front-end that builds the command line and launches `crawl.js` (kept beside it; auto-detected). | Windows + Node |
| `crawl-render.js` | Headless-browser verifier: re-checks links `crawl.js` flagged as dead/blocked by rendering them in real Chromium. | Node + optional Playwright |
| `web-crawler.html` | In-browser crawler variant; runs entirely in a tab. | Any modern browser |
| `local-cors-proxy.js` | CORS proxy so `web-crawler.html` can cross origins from `file://`. | Node, zero deps |
| `CRAWLER.md` | Full reference for the whole suite. | — |
| `README.md` | Landing page / quick start. | — |

### Internal dependency graph (runtime / file-format, never code imports)

```
crawl-gui.hta    ──launches──▶ crawl.js                 (same folder; auto-detected)
crawl-render.js  ──reads────▶ crawl.js's JSON output    (file format only)
web-crawler.html ──optionally calls──▶ local-cors-proxy.js  (over HTTP, configurable)
CRAWLER.md / README.md ──document──▶ all of the above
```

---

## Memory structure

| Category | Location |
|---|---|
| Governance | `rhiz-memory/_instance.md` (this file) |
| Synthesis (features / architecture / lessons) | `rhiz-memory/state/SYNTHESIS.md` |
| Decisions | `rhiz-memory/state/decisions.md` |
| Planning / State | `rhiz-memory/state/SESSION_HANDOFF.md`, `rhiz-memory/state/RESUME_BLOCK.md` |
| Risk / Oversight | `rhiz-memory/audits/` |
| Contracts | `package.json` (bin entries, optional deps); crawl.js JSON report shape |
| Documentation | `README.md`, `CRAWLER.md` |
| Dependencies | `package.json` (`playwright` — optional, lazy-loaded) |

---

## Provenance

Migrated out of `david-coneff/broodforge` (`tools/`) into this repository on
2026-06-24. The migration was directed by `CRAWLER-MIGRATION-HANDOFF.md`, which
lived on broodforge's `claude/html-web-crawler-sd0i4p` branch. Tool source was
carried over byte-for-byte; only documentation paths were flattened from
`tools/crawl.js` to `crawl.js` to match the new root layout.
