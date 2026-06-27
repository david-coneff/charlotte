"use strict";
// HTTP fetching layer: request / probe / link disposition. Extracted from crawl.js (AD-014).
const http = require("http");
const https = require("https");
const zlib = require("zlib");
const { URL } = require("url");
const { docTypeOf, sniffMagic } = require("./parse.js");

const MAX_REDIRECTS = 5;
const MAX_BYTES = 5 * 1024 * 1024; // cap page size we read into memory
// A current desktop-Chrome User-Agent. Some sites serve a 403/blank to unknown
// clients but a normal page to a real browser; --browser sends this honest
// browser identity (no spoofed cookies/JS) so legitimate link verification
// isn't tripped by naive UA filtering. Not an evasion of deliberate blocking.
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

// Request headers. With --browser we add the Accept/Accept-Language a desktop
// browser sends, alongside the browser UA — some servers gate on these too.
function requestHeaders(cfg) {
  if (cfg.browser) {
    return {
      "User-Agent": cfg.userAgent,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    };
  }
  return { "User-Agent": cfg.userAgent, "Accept": "text/html,application/xhtml+xml,*/*" };
}

// Lightweight reachability check used for external/error links: just the status
// code, following redirects, without downloading a body. Resolves (never
// rejects) to {status, err}; status 0 means the request never got a response.
function rawStatus(target, method, cfg, redirects = 0) {
  return new Promise((resolve) => {
    let u;
    try { u = new URL(target); } catch { return resolve({ status: 0, err: "bad URL" }); }
    if (u.protocol !== "http:" && u.protocol !== "https:") return resolve({ status: 0, err: "unsupported protocol" });
    const lib = u.protocol === "https:" ? https : http;
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    const req = lib.request(u, { method, headers: requestHeaders(cfg) }, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && redirects < MAX_REDIRECTS) {
        res.resume();
        let nextUrl;
        try { nextUrl = new URL(res.headers.location, u).href; } catch { return finish({ status: 0, err: "bad redirect" }); }
        return finish(rawStatus(nextUrl, method, cfg, redirects + 1));
      }
      res.resume();              // drain so the socket can be reused/closed
      finish({ status: code, err: null });
    });
    req.setTimeout(cfg.timeout, () => req.destroy(new Error("timeout")));
    req.on("error", (e) => finish({ status: 0, err: String(e && e.message || e) }));
    req.end();
  });
}

// Probe a link the way a careful human would: try a cheap HEAD first, but many
// servers mishandle HEAD (405/501) or block bots at it while serving a real GET.
// So when HEAD looks bad, fall back to a GET before deciding. Body is discarded.
async function probe(target, cfg) {
  let { status, err } = await rawStatus(target, "HEAD", cfg);
  const headInconclusive = !!err || status === 0 || status === 400 || status === 403 ||
    status === 405 || status === 406 || status === 429 || status === 501 || status >= 500;
  if (headInconclusive) {
    const g = await rawStatus(target, "GET", cfg);
    if (g.status > 0) { status = g.status; err = g.err; }
    else if (status === 0) { err = g.err || err; }
  }
  return { status, err };
}

// Classify a probe result into ok / broken / blocked. "blocked" = the link very
// likely works in a browser but the server refused our automated check (auth,
// anti-bot, rate-limit, method/range quirks, timeouts) — reported separately so
// it isn't presented as a confirmed dead link.
function linkDisposition(status, err) {
  if (status >= 200 && status < 400) return "ok";
  if (status === 404 || status === 410) return "broken";
  if (status === 401 || status === 403 || status === 405 || status === 406 ||
      status === 408 || status === 409 || status === 429 || status === 451 ||
      status === 999 || (status >= 500 && status <= 599)) return "blocked";
  if (status === 0) return /timeout/i.test(err || "") ? "blocked" : "broken";
  if (status === 400) return "broken";
  return "broken";
}

function request(target, method, cfg, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(target); } catch { return reject(new Error("bad URL")); }
    if (u.protocol !== "http:" && u.protocol !== "https:") return reject(new Error("unsupported protocol"));
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(u, { method, headers: requestHeaders(cfg) }, (res) => {
      const code = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location && redirects < MAX_REDIRECTS) {
        res.resume();
        let nextUrl;
        try { nextUrl = new URL(res.headers.location, u).href; } catch { return reject(new Error("bad redirect")); }
        return resolve(request(nextUrl, method, cfg, redirects + 1));
      }
      const ct = res.headers["content-type"] || "";
      const retryAfter = res.headers["retry-after"] || null;
      if (method === "HEAD") { res.resume(); return resolve({ status: code, contentType: ct, html: null, retryAfter }); }

      // Detect document type FIRST — note Office content-types contain "xml"
      // ("openxmlformats"), so the html/xml check must not claim them.
      const docType = docTypeOf(ct, u.pathname);
      const isHtml = !docType && ct && /html|xml|text\//i.test(ct);
      const knownDoc = (cfg.scanDocs && docType) ? docType : null;
      // Scan documents (known type, or a generic/octet-stream we'll sniff). Skip
      // obvious binaries (images/audio/video) without downloading them.
      const maybeDoc = cfg.scanDocs && !isHtml && !/^image\/|^video\/|^audio\//i.test(ct) &&
        (knownDoc || /octet-stream/i.test(ct) || ct === "");
      if (!isHtml && !maybeDoc) { res.resume(); return resolve({ status: code, contentType: ct, html: null, retryAfter }); }

      if (isHtml) {
        // Text: collect chunks and join once (avoids O(n^2) string growth).
        const chunks = [];
        let total = 0;
        res.setEncoding("utf8");
        res.on("data", (d) => { total += d.length; if (total > MAX_BYTES) { res.destroy(); return; } chunks.push(d); });
        res.on("end", () => resolve({ status: code, contentType: ct, html: chunks.join(""), retryAfter }));
        return;
      }

      // Document: download as binary (capped). If the type wasn't clear from the
      // headers, sniff the first chunk and bail on non-document binaries.
      const bufs = [];
      let total = 0, aborted = false;
      res.on("data", (d) => {
        if (aborted) return;
        if (!knownDoc && bufs.length === 0) {
          if (!sniffMagic(d)) { aborted = true; res.destroy(); resolve({ status: code, contentType: ct, html: null, retryAfter }); return; }
        }
        total += d.length;
        if (total > cfg.maxDocBytes) { aborted = true; res.destroy(); resolve({ status: code, contentType: ct, html: null, doc: Buffer.concat(bufs), docType: knownDoc, retryAfter }); return; }
        bufs.push(d);
      });
      res.on("end", () => { if (!aborted) resolve({ status: code, contentType: ct, html: null, doc: Buffer.concat(bufs), docType: knownDoc, retryAfter }); });
    });
    req.setTimeout(cfg.timeout, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end();
  });
}

module.exports = { request, probe, linkDisposition, BROWSER_UA };
