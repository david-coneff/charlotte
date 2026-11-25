---
docgraph-version: 1
docgraph-type: section
section-id: local-cors-proxyjs-proxy-for-the-html-ve
section-order: 5
parent-index: CRAWLER_index.json
content-hash: sha256:ac55f4d4837a1d1eee9c0c10bc423ff8dfbc3bf27eedff00ee66dd62465ce35b
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

### `local-static-server.js` — serve a report or fix tracker on localhost

The report's verdicts and the fix tracker's progress live in the browser's
`localStorage`. If **⬆ Import** says storage is blocked, the cause is a **cookie
block** for that page: Chrome's *Don't allow sites to save data on your device*
setting, or an administrator's `DefaultCookiesSetting` policy. That block applies
to `file://` **and** to `http://127.0.0.1` alike, so serving the page is not
enough by itself: the page's address also has to be allowed. Two routes, both
checked in Chrome 148 with storage blocked:

1. **No server.** Open `chrome://settings/content/siteData`, and under
   **Allowed to save data on your device** click **Add** and enter `file:///*`.
   Reload the report or tracker; Import now works from the file itself.
2. **This server**, for when local files may not get an exception. It is a tiny
   zero-dependency Node server, like the proxy above:

   ```bash
   node local-static-server.js <folder>         # serves <folder> on 127.0.0.1:8081
   node local-static-server.js <folder> 9001    # custom port (or PORT=9001)
   npm run serve -- <folder>
   ```

   Then add the address it prints (for example `http://127.0.0.1:8081`) under
   **Allowed to save data on your device** the same way, open that address, and
   click the tracker or report in the folder listing.

An administrator can allow either pattern with the `CookiesAllowedForUrls` policy.
Keep the same port each time: the stored progress, and the exception, belong to
that exact address, so another port starts empty. To carry progress between the
two routes, **⬇ Export** from one and **⬆ Import** into the other.

**Security notes:** it binds to `127.0.0.1` only, serves one folder read-only
(with a listing), and refuses any path that leaves that folder (`../`, encoded or
not, and symlinks pointing out). Stop it (Ctrl+C) when you're done.

---
