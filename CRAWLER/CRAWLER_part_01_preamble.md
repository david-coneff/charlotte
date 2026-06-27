---
docgraph-version: 1
docgraph-type: section
section-id: preamble
section-order: 1
parent-index: CRAWLER_index.json
content-hash: sha256:c1fcbc2326ead69a9bf0f223eaf17200863800b3500d1ddf0317775614ea5c38
---
# 🕸️ Charlotte — Domain Crawler

Tools for mapping a single website: every internal link, plus a record of the
first-tier external links it points to. Pick the one that fits how you want to
run it.

| File | Runtime | Use it when |
|------|---------|-------------|
| [`crawl.js`](CRAWLER_part_02_crawljs-node-crawler-recommended.md) | Node | Mapping any domain from your machine. No CORS limits. **Start here.** |
| [`crawl-gui.hta`](CRAWLER_part_03_crawl-guihta-windows-gui.md) | Windows | You'd rather click than type — a form front-end for `crawl.js`. |
| [`web-crawler.html`](CRAWLER_part_04_web-crawlerhtml-in-browser-crawler.md) | Browser | You want a live, interactive report in the page, or you host the file on the domain you're mapping. |
| [`local-cors-proxy.js`](CRAWLER_part_05_local-cors-proxyjs-proxy-for-the-html-ve.md) | Node | Only needed to let `web-crawler.html` crawl across domains from `file://`. |

All three apply the same rules:

- **Internal links** (same domain, and within scope) are followed, up to your
  page/depth limits.
- **External links** (other domains) are **recorded but never followed.** The
  deepest the crawler ever looks at an external link is an optional single check
  of whether it resolves (`--check-external`). It never reads an external page
  or follows its links — so you learn *which internal pages work* and *whether
  each external link works*, and nothing beyond that.
- **Depth applies only to the internal crawl.** It counts link-hops through
  internal pages from the start URL; it has no effect on external links, which
  are always handled at the single tier where they're found.

---
