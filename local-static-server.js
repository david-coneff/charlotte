#!/usr/bin/env node
/*
 * local-static-server.js — zero-dependency localhost file server for a report or fix tracker
 *
 * The report and the fix tracker keep their state in the browser's localStorage. Where the
 * browser blocks cookies for a page (a "Block all cookies" setting, or an administrator's
 * DefaultCookiesSetting policy), localStorage throws and Import refuses. That block applies
 * on file:// AND on http://127.0.0.1 alike, so serving the page is not enough by itself.
 * Two routes, both checked in Chrome 148 with storage blocked:
 *   - no server: allow cookies for local files — chrome://settings/content/siteData ›
 *     "Allowed to save data on your device" › Add › file:///*
 *   - this server: serve the folder, then add the address it prints the same way
 *     (e.g. http://127.0.0.1:8081) — for when local files may not get an exception.
 * An administrator can set either through the CookiesAllowedForUrls policy.
 *
 * SECURITY: binds to 127.0.0.1 only — never exposed to your network. It serves the files in
 * ONE folder (and below it) read-only, and refuses any path that leaves that folder. Stop it
 * (Ctrl+C) when you're done.
 *
 * Usage:
 *   node local-static-server.js                    # serves the current folder on 127.0.0.1:8081
 *   node local-static-server.js <folder>           # serves <folder>
 *   node local-static-server.js <folder> 9001      # custom port
 *   PORT=9001 node local-static-server.js <folder> # custom port (env)
 *
 * Then open the URL it prints and click the tracker (or report) file in the listing.
 * Keep the same port each time: the browser's storage, and the cookie exception, belong to
 * that exact address, so a different port starts from empty state.
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");

const HOST = "127.0.0.1";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".ico": "image/x-icon",
  ".pdf": "application/pdf",
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function send(res, code, type, body, method) {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(method === "HEAD" ? undefined : body);
}

// Resolve a request path inside ROOT, or null when it would leave ROOT (../, an absolute
// path, or a symlink that points outside).
function resolveInside(root, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath.split("?")[0].split("#")[0]); } catch { return null; }
  if (rel.includes("\0")) return null;
  const full = path.resolve(root, "." + path.posix.normalize("/" + rel));
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  let real;
  try { real = fs.realpathSync(full); } catch { return full; } // missing: the caller answers 404
  return real === root || real.startsWith(root + path.sep) ? real : null;
}

function listing(res, dir, urlPath, method) {
  const base = urlPath.endsWith("/") ? urlPath : urlPath + "/";
  const rows = fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => !d.name.startsWith("."))
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))
    .map((d) => {
      const name = d.name + (d.isDirectory() ? "/" : "");
      return `<li><a href="${esc(base + encodeURIComponent(d.name) + (d.isDirectory() ? "/" : ""))}">${esc(name)}</a></li>`;
    });
  const up = base === "/" ? "" : `<li><a href="..">../</a></li>`;
  send(res, 200, "text/html; charset=utf-8",
    `<!DOCTYPE html><meta charset="utf-8"><title>${esc(base)}</title>` +
    `<h1 style="font:600 16px system-ui">${esc(base)}</h1><ul style="font:14px system-ui">${up}${rows.join("")}</ul>`, method);
}

function handler(root) {
  return (req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "text/plain", "Method not allowed\n", req.method);
    const urlPath = (req.url || "/").split("?")[0];
    const full = resolveInside(root, urlPath);
    if (!full) return send(res, 403, "text/plain", "Outside the served folder\n", req.method);
    let st;
    try { st = fs.statSync(full); } catch { return send(res, 404, "text/plain", "Not found\n", req.method); }
    if (st.isDirectory()) {
      if (!urlPath.endsWith("/")) { res.writeHead(301, { Location: urlPath + "/" }); return res.end(); }
      return listing(res, full, urlPath, req.method);
    }
    const type = TYPES[path.extname(full).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type, "Content-Length": st.size, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(full).pipe(res);
  };
}

function start({ root = process.cwd(), port = 8081 } = {}) {
  const dir = fs.realpathSync(path.resolve(root));
  if (!fs.statSync(dir).isDirectory()) throw new Error("Not a folder: " + dir);
  const server = http.createServer(handler(dir));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => resolve({ server, root: dir, url: `http://${HOST}:${server.address().port}/` }));
  });
}

module.exports = { start, resolveInside };

if (require.main === module) {
  const args = process.argv.slice(2);
  const portArg = args.find((a) => /^\d+$/.test(a));
  const root = args.find((a) => a !== portArg) || process.cwd();
  const port = Number(process.env.PORT || portArg || 8081);
  start({ root, port }).then(({ root: dir, url }) => {
    console.log(`Serving ${dir}`);
    console.log(`  at ${url}  (127.0.0.1 only; Ctrl+C to stop)`);
    console.log(`If Import still says storage is blocked, allow ${url.replace(/\/$/, "")} at chrome://settings/content/siteData`);
    console.log(`  ("Allowed to save data on your device" › Add).`);
  }, (e) => {
    console.error(e.code === "EADDRINUSE" ? `Port ${port} is in use — pass another, e.g. node local-static-server.js <folder> ${port + 1}` : String(e.message || e));
    process.exit(1);
  });
}
