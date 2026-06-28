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
| [`crawl-render.js`](CRAWLER/CRAWLER_part_02_crawljs-node-crawler-recommended.md) | Node + Playwright | Two jobs in real Chromium: **re-check** links `crawl.js` flagged dead/blocked, and **`--discover`** a JavaScript-built site (an SPA like Laserfiche WebLink) that `crawl.js` can't navigate, emitting the links it finds back to `crawl.js`. |
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

### Crawling a JavaScript-rendered site (SPA)

`crawl.js` reads only static HTML — it never runs JavaScript. A site that builds
its navigation client-side (Laserfiche WebLink, SharePoint, many document
portals) hands it an almost-empty shell, so it stalls after the handful of
static links and never reaches the documents. `crawl-render.js --discover` is the
fix: it renders each page in real Chromium, waits for the JS to settle, harvests
the links from the live DOM, recurses the folder tree, and writes the URLs it
finds to a seeds file — which you hand back to `crawl.js`:

```bash
# 1) render the site and harvest its real links into a seeds file
node crawl-render.js --discover https://site/folder/ --seeds seeds.txt

# 2) verify those links + scan the documents, in one report
node crawl.js --seeds seeds.txt --max-depth 0 --check-external
```

Confine it with `--scope path` / `--max-depth` / `--max-pages`; `node
crawl-render.js --help` lists every option. (Needs Playwright — see
`crawl-render.js` under Requirements.)

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
