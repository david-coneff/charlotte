---
docgraph-version: 1
docgraph-type: section
section-id: web-crawlerhtml-in-browser-crawler
section-order: 4
parent-index: CRAWLER_index.json
content-hash: sha256:e8396773c58bd24fa1eb6bc8d7c2c24e7af08ebef1959e473ff1dfc9edbf873a
---
## `web-crawler.html` — in-browser crawler

A single self-contained HTML page that crawls and renders its report inline. Open it in a browser, fill in the start URL, click **Start crawl**.

**The catch — CORS.** A browser page can only read pages the same-origin policy allows:

- **Hosted on the domain you're crawling** → works with no extra setup.
- **Opened from `file://` or pointed at another domain** → the browser blocks the fetches. Run the local proxy (below) and leave the proxy field set to `http://127.0.0.1:8080/?url={url}`.

External links are only *recorded*, so they never trigger CORS — only internal page fetches do.

Features: configurable max pages / depth / concurrency / delay, optional subdomain inclusion, optional external reachability check, a live log, and a **Export JSON** button. The page also carries the proxy source with **Download proxy** / **Copy source** buttons.

> For crawling domains you don't host, `crawl.js` is simpler and more capable — use the HTML version when you specifically want the interactive in-page report or are hosting it on the target site.

---
