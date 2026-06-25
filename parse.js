"use strict";
// Link extraction from HTML and from documents (PDF / Office). Extracted from crawl.js (AD-014). Pure: content -> URL objects.
const zlib = require("zlib");
const { URL } = require("url");

const TITLE_CAP = 300;             // max title chars retained per page

// Decode the HTML entities that commonly appear in href attributes so URLs
// aren't kept malformed (e.g. ...?id=1&amp;y=2 -> ...?id=1&y=2).
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, ent) => {
    if (ent[0] === "#") {
      const code = (ent[1] === "x" || ent[1] === "X") ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : whole;
    }
    const map = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
    return map[ent.toLowerCase()] || whole;
  });
}

function extractLinks(html, pageUrl) {
  const src = html.replace(/<!--[\s\S]*?-->/g, "");
  let base = pageUrl;
  const bm = src.match(/<base\b[^>]*\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/i);
  if (bm) {
    const href = decodeEntities((bm[2] ?? bm[3] ?? bm[4] ?? "").trim());
    if (href) { try { base = new URL(href, pageUrl).href; } catch { /* ignore */ } }
  }
  const links = [];
  const re = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/gi;
  let m;
  while ((m = re.exec(src))) {
    // Decode HTML entities in the href (e.g. &amp; -> &) so URLs aren't malformed.
    const raw = decodeEntities((m[2] ?? m[3] ?? m[4] ?? "").trim());
    if (!raw || raw.startsWith("#") || /^(javascript:|mailto:|tel:|data:)/i.test(raw)) continue;
    try { links.push(new URL(raw, base)); } catch { /* malformed href */ }
  }
  const tm = src.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = tm ? tm[1].replace(/\s+/g, " ").trim().slice(0, TITLE_CAP) : "";
  return { links, title };
}

// ----------------------------- document link extraction -----------------------------
// Classify a response as a document we can read links out of, by content-type or
// URL extension. Returns "pdf" | "ooxml" | "ole" | null.
function docTypeOf(ct, pathname) {
  const c = (ct || "").toLowerCase();
  const p = (pathname || "").toLowerCase();
  if (c.indexOf("pdf") >= 0 || /\.pdf(\?|$)/.test(p)) return "pdf";
  if (c.indexOf("openxmlformats") >= 0 || /\.(docx|xlsx|pptx)(\?|$)/.test(p)) return "ooxml";
  if (c.indexOf("msword") >= 0 || c.indexOf("ms-excel") >= 0 || c.indexOf("ms-powerpoint") >= 0 || c.indexOf("vnd.ms-") >= 0 || /\.(doc|xls|ppt)(\?|$)/.test(p)) return "ole";
  return null;
}

// Magic-byte sniff for when the server sends a generic content-type.
function sniffMagic(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "pdf";   // %PDF
  if (buf[0] === 0x50 && buf[1] === 0x4b) return "ooxml";                                       // PK (zip)
  if (buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0) return "ole";   // old Office
  return null;
}

// Minimal ZIP reader (central directory + stored/deflate), built on zlib — no
// dependency. Returns [{name, data}] for entries whose name passes `filter`.
function unzipEntries(buf, filter) {
  const out = [];
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 22 - 65536; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lhOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (filter && !filter(name)) continue;
    if (lhOff + 30 > buf.length || buf.readUInt32LE(lhOff) !== 0x04034b50) continue;
    const lhNameLen = buf.readUInt16LE(lhOff + 26);
    const lhExtraLen = buf.readUInt16LE(lhOff + 28);
    const dataStart = lhOff + 30 + lhNameLen + lhExtraLen;
    const comp = buf.slice(dataStart, dataStart + compSize);
    try {
      out.push({ name, data: method === 0 ? comp : zlib.inflateRawSync(comp) });
    } catch { /* skip unreadable entry */ }
  }
  return out;
}

// Office (OOXML): external hyperlinks live in the *.rels parts as
// Target="http..." TargetMode="External".
function ooxmlLinks(buf) {
  const urls = [];
  for (const e of unzipEntries(buf, (n) => /\.rels$/i.test(n))) {
    const xml = e.data.toString("utf8");
    const re = /Target="([^"]+)"/g; let m;
    while ((m = re.exec(xml))) { if (/^https?:\/\//i.test(m[1])) urls.push(m[1].replace(/&amp;/g, "&")); }
  }
  return urls;
}

// PDF: clickable links are URI actions, stored as /URI(...) (often uncompressed).
function pdfLinks(buf) {
  const s = buf.toString("latin1");
  const urls = [];
  const re = /\/URI\s*\(((?:\\.|[^\\)])*)\)/g; let m;
  while ((m = re.exec(s))) urls.push(m[1].replace(/\\([()\\])/g, "$1"));
  return urls;
}

// Fallback for older binary Office (.doc/.xls/.ppt) and anything unknown: scan
// raw bytes for URLs, in both latin1 and UTF-16LE (old Office stores text as UTF-16).
function rawUrls(buf) {
  const urls = [];
  const re = /https?:\/\/[^\s"'<>)\]}\x00]{3,}/gi; let m;
  let s = buf.toString("latin1"); while ((m = re.exec(s))) urls.push(m[0]);
  re.lastIndex = 0;
  let s2 = buf.toString("utf16le"); while ((m = re.exec(s2))) urls.push(m[0]);
  return urls;
}

// Extract http(s) links found inside a document buffer, as URL objects.
function extractDocLinks(buf, docType, baseUrl) {
  let type = docType;
  if (!type || type === "sniff") type = sniffMagic(buf) || type;
  let raws;
  if (type === "ooxml") raws = ooxmlLinks(buf);
  else if (type === "pdf") raws = pdfLinks(buf);
  else raws = rawUrls(buf);
  const out = [], seen = new Set();
  for (const r of raws) {
    let s = String(r).trim().replace(/[).,;'">]+$/, "");   // trim trailing punctuation
    if (!s || /^(mailto:|tel:|javascript:)/i.test(s)) continue;
    try {
      const u = new URL(s, baseUrl);
      if ((u.protocol === "http:" || u.protocol === "https:") && !seen.has(u.href)) { seen.add(u.href); out.push(u); }
    } catch { /* malformed */ }
  }
  return out;
}

module.exports = { extractLinks, extractDocLinks, docTypeOf, sniffMagic };
