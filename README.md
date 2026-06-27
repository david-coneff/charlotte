# Charlotte — Domain Crawler

Charlotte maps a single website: every internal link, plus a record of the
first-tier external links it points to. It verifies links (including links found
inside PDFs and Office documents) and writes a self-contained HTML report you
open in a browser.

The core crawler has **no install step** — it uses Node built-in modules only.

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

- **`crawl.js` (+ its sibling modules), `local-cors-proxy.js`** — Node ≥ 14, zero npm
  dependencies. `crawl.js` `require`s `cli.js`, `netutil.js`, `recheck.js`, `report.js`,
  `parse.js`, `fetch.js`, `log.js`, and `seen.js` from the same folder, so keep them together.
- **`crawl-render.js`** — Node, plus an optional [Playwright](https://playwright.dev)
  install (`npm install`); without it, run with `--http-fallback` for plain HTTP checks.
- **`crawl-gui.hta`** — Windows (mshta.exe) with Node on `PATH`.
- **`web-crawler.html`** — any modern browser.
