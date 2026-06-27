# Charlotte — Domain Crawler

Charlotte maps a single website: every internal link, plus a record of the
first-tier external links it points to. It verifies links (including links found
inside PDFs and Office documents) and writes a self-contained HTML report you
open in a browser.

The core crawler has **no install step to run** — the shipped `crawl.js` is a single
self-contained file that uses Node built-in modules only. (It is *built* from small
modules in [`src/`](src/) via an esbuild roll-up; the build tool is a dev-time
`devDependency`, never needed to run a shipped `crawl.js`. See "Building from source".)

## Which tool do I use?

| File | Runtime | Use it when |
|------|---------|-------------|
| [`crawl.js`](CRAWLER/CRAWLER_part_02_crawljs-node-crawler-recommended.md) | Node | Mapping any domain from your machine. No CORS limits. **Start here.** |
| [`crawl-gui.hta`](CRAWLER/CRAWLER_part_03_crawl-guihta-windows-gui.md) | Windows | You'd rather click than type — a form front-end for `crawl.js`. |
| [`crawl-render.js`](CRAWLER/CRAWLER_part_02_crawljs-node-crawler-recommended.md) | Node + Playwright | Re-check links `crawl.js` flagged as dead/blocked, by rendering them in real Chromium. |
| [`web-crawler.html`](CRAWLER/CRAWLER_part_04_web-crawlerhtml-in-browser-crawler.md) | Browser | You want a live, interactive report in the page, with no Node install. |
| [`local-cors-proxy.js`](CRAWLER/CRAWLER_part_05_local-cors-proxyjs-proxy-for-the-html-ve.md) | Node | Lets `web-crawler.html` crawl across domains from a `file://` page. |

## Quick start

```bash
node crawl.js https://example.com/
# then open crawl-report.html
```

Bigger crawl, polite rate limit, verify external links resolve:

```bash
node crawl.js https://example.com/ --max-pages 500 --rps 5 --check-external
```

See the **[CRAWLER reference index](CRAWLER/CRAWLER_index.md)** for the complete
reference: every option, common workflows, the Windows GUI, the headless-render
verifier, and the in-browser variant. (It was partitioned into a section graph
under `CRAWLER/`; [`CRAWLER.md`](CRAWLER.md) is a pointer to the index.)

## Requirements

- **`crawl.js`, `local-cors-proxy.js`** — Node ≥ 14, zero npm dependencies to **run**.
  `crawl.js` ships as a **single self-contained file** (an esbuild roll-up of the modules in
  [`src/`](src/)); just run it. `local-cors-proxy.js` is a standalone zero-dep file.

## Building from source

Edit the small modules in `src/` (the source of truth), then regenerate the shipped
single-file `crawl.js`:

```bash
npm install   # dev-only: installs esbuild (a devDependency)
npm run build # rolls src/ up into ./crawl.js
```

The built `crawl.js` runs with **zero install** (Node built-ins only) — the build tool is
never needed to *run* it, only to rebuild it after a source change. `crawl-render.js` and
`local-cors-proxy.js` are standalone single files with no build step.
- **`crawl-render.js`** — Node, plus an optional [Playwright](https://playwright.dev)
  install (`npm install`); without it, run with `--http-fallback` for plain HTTP checks.
- **`crawl-gui.hta`** — Windows (mshta.exe) with Node on `PATH`.
- **`web-crawler.html`** — any modern browser.
