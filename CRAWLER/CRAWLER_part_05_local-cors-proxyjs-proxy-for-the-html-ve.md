---
docgraph-version: 1
docgraph-type: section
section-id: local-cors-proxyjs-proxy-for-the-html-ve
section-order: 5
parent-index: CRAWLER_index.json
content-hash: sha256:77c2fea2bcabb15f4126490b0f158ce99686240a8e392a03b6c67d75bc1442dc
---
## `local-cors-proxy.js` — proxy for the HTML version

A tiny zero-dependency Node server that lets `web-crawler.html` crawl across
domains from `file://`. It fetches pages server-side and adds the CORS headers
the browser requires.

```bash
node local-cors-proxy.js          # listens on 127.0.0.1:8080
PORT=9000 node local-cors-proxy.js  # custom port
```

Then in the HTML crawler's **CORS proxy template** field:

```
http://127.0.0.1:8080/?url={url}
```

**Security notes:**

- Binds to `127.0.0.1` only — not exposed to your network.
- While running, it will proxy any http/https URL asked of it over loopback.
  Don't run it on a shared machine where others can reach your loopback, and
  stop it (Ctrl+C) when you're done.
- It's the lowest-permission way to do cross-origin crawling: unlike launching a
  browser with `--disable-web-security` or installing a CORS-unblock extension,
  it needs no special browser permission and keeps your traffic on your machine.

You don't need this at all if you run `crawl.js` instead.

---
