#!/usr/bin/env node
/*
 * local-cors-proxy.js — zero-dependency localhost CORS proxy for web-crawler.html
 *
 * A file:// page can't open a listening socket, so the crawler can't host its
 * own proxy — but this tiny Node server fills that gap with no npm install.
 * It fetches a target URL server-side and re-emits the response with permissive
 * CORS headers, so JavaScript on a file:// page (origin "null") can read it.
 *
 * SECURITY: binds to 127.0.0.1 only — never exposed to your network. It will
 * proxy any http/https URL you ask for, so don't run it on a shared machine
 * where others can reach your loopback, and stop it when you're done.
 *
 * Usage:
 *   node local-cors-proxy.js              # listens on 127.0.0.1:8080
 *   PORT=9000 node local-cors-proxy.js    # custom port
 *   node local-cors-proxy.js 9000         # custom port (arg)
 *
 * In the crawler's "CORS proxy template" field, enter:
 *   http://127.0.0.1:8080/?url={url}
 */
"use strict";
const http = require("http");
const https = require("https");
const { URL } = require("url");

const PORT = Number(process.env.PORT || process.argv[2] || 8080);
const HOST = "127.0.0.1";
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20000;

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

function fail(res, code, msg) {
  cors(res);
  res.writeHead(code, { "Content-Type": "text/plain" });
  res.end(msg);
}

function fetchUpstream(target, method, res, redirects) {
  let u;
  try { u = new URL(target); } catch { return fail(res, 400, "Bad target URL: " + target); }
  if (u.protocol !== "http:" && u.protocol !== "https:") return fail(res, 400, "Only http/https supported");

  const lib = u.protocol === "https:" ? https : http;
  const upReq = lib.request(
    u,
    { method, headers: { "User-Agent": "local-cors-proxy", "Accept": "text/html,application/xhtml+xml,*/*" } },
    (up) => {
      const code = up.statusCode || 502;
      // Follow redirects ourselves (Node's http does not).
      if ([301, 302, 303, 307, 308].includes(code) && up.headers.location && redirects < MAX_REDIRECTS) {
        up.resume(); // drain
        const next = new URL(up.headers.location, u).href;
        return fetchUpstream(next, method, res, redirects + 1);
      }
      cors(res);
      const headers = {};
      if (up.headers["content-type"]) headers["Content-Type"] = up.headers["content-type"];
      res.writeHead(code, headers);
      up.pipe(res);
    }
  );
  upReq.setTimeout(TIMEOUT_MS, () => { upReq.destroy(); fail(res, 504, "Upstream timeout"); });
  upReq.on("error", (e) => fail(res, 502, "Upstream error: " + e.message));
  upReq.end();
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); return res.end(); }

  const reqUrl = new URL(req.url, `http://${HOST}:${PORT}`);
  // Two accepted styles: /?url=<encoded>  OR  /<full-url>
  let target = reqUrl.searchParams.get("url");
  if (!target) {
    const path = decodeURIComponent(req.url.replace(/^\//, ""));
    if (/^https?:\/\//i.test(path)) target = path;
  }
  if (!target) return fail(res, 400, "Usage: /?url=<encoded-url>  or  /<full-url>");

  fetchUpstream(target, req.method === "HEAD" ? "HEAD" : "GET", res, 0);
});

server.listen(PORT, HOST, () => {
  console.log(`local-cors-proxy listening on http://${HOST}:${PORT}`);
  console.log(`Crawler proxy template:  http://${HOST}:${PORT}/?url={url}`);
  console.log("Press Ctrl+C to stop.");
});
