"use strict";
// Logging: partitioned progress log + resume journal + reconstruction. Extracted from crawl.js (AD-014).
const fs = require("fs");
const path = require("path");

// Writes the progress log as size-bounded parts (…​.part001.log, …​.part002.log).
// Each part starts with a "#META {json}" header so the set is self-describing,
// and a manifest (…​.manifest.json) indexes the parts in order. This keeps any
// single file small (bounded memory/disk per file) and lets --merge-logs
// reconstruct the full composite log even if a run was interrupted.
function makeLogWriter(cfg, meta) {
  if (!cfg.log) return { line() {}, finalize() {}, parts: [], manifestPath: "", singleFile: true };

  const dir = path.dirname(cfg.log);
  const ext = path.extname(cfg.log) || ".log";
  const stem = path.basename(cfg.log, ext);
  const maxBytes = cfg.logMaxBytes;
  const single = maxBytes <= 0;
  const manifestPath = single ? "" : path.join(dir, stem + ".manifest.json");
  const parts = [];
  const nowIso = () => new Date().toISOString();

  let idx = 0, curPath = null, curBytes = 0, curLines = 0;

  const partPath = (n) => single ? cfg.log : path.join(dir, stem + ".part" + String(n).padStart(3, "0") + ext);

  function writeManifest(complete) {
    if (single) return;
    if (parts.length) { parts[parts.length - 1].bytes = curBytes; parts[parts.length - 1].lines = curLines; }
    const m = { run: meta.run, startUrl: meta.startUrl, startedAt: meta.startedAt, base: stem, ext, maxBytes, parts, complete: !!complete, updatedAt: nowIso() };
    try { fs.writeFileSync(manifestPath, JSON.stringify(m, null, 2)); } catch { /* ignore */ }
  }

  function roll() {
    if (parts.length) { parts[parts.length - 1].bytes = curBytes; parts[parts.length - 1].lines = curLines; }
    idx++;
    curPath = partPath(idx);
    curBytes = 0; curLines = 0;
    if (!single) {
      const header = "#META " + JSON.stringify({ run: meta.run, part: idx, base: stem, ext, startUrl: meta.startUrl, partStarted: nowIso() }) + "\n";
      try { fs.writeFileSync(curPath, header); } catch { /* ignore */ }
      curBytes += Buffer.byteLength(header);
    } else {
      try { fs.writeFileSync(curPath, ""); } catch { /* ignore */ }
    }
    parts.push({ part: idx, file: path.basename(curPath), started: nowIso(), bytes: curBytes, lines: 0 });
    writeManifest(false);
  }

  function line(s) {
    const buf = s + "\n";
    const len = Buffer.byteLength(buf);
    if (curPath === null) roll();
    else if (!single && curBytes + len > maxBytes) roll();
    try { fs.appendFileSync(curPath, buf); } catch { /* ignore */ }
    curBytes += len; curLines++;
  }

  return { line, finalize: writeManifest, parts, manifestPath, singleFile: single };
}

// ----------------------------- resume journal -----------------------------
// Append-only JSONL trail of discoveries (the frontier) and completions (results),
// written SYNCHRONOUSLY so an abrupt stop loses nothing already on disk. `--resume`
// replays it to rebuild the queue + results + seen-set and continue WITHOUT
// re-crawling anything already done. Enabled by `--state FILE` (and implied by
// `--resume FILE`, which appends to the same file). Event shapes (one JSON/line):
//   {t:"meta",v,run,startUrl,scope,depth,subs,startedAt}  once, on a fresh journal
//   {t:"v",u}                                              about to visit u (attempt)
//   {t:"p",u,s,d,ti,in:[..],ex:[[u,host]..],oo:[..]}       u crawled OK + its links
//   {t:"k",u,s,d,ct}                                       u recorded, non-HTML (skip)
//   {t:"e",u,r,k,src} / {t:"b",u,r,k,src}                  u errored / blocked-uncertain
function makeJournal(file) {
  if (!file) return { ev() {}, on: false };
  const ev = (obj) => { try { fs.appendFileSync(file, JSON.stringify(obj) + "\n"); } catch { /* ignore */ } };
  return { ev, on: true };
}

// Reconstruct a partitioned log into a single composite stream. Accepts the
// manifest path, the log base path, or a directory; falls back to scanning for
// parts (reading each part's #META header) if no manifest is present.
function mergeLogs(target, outFile) {
  let manifest = null, dir = ".", stem = "", ext = ".log";

  if (target && fs.existsSync(target) && fs.statSync(target).isFile() && target.endsWith(".json")) {
    manifest = JSON.parse(fs.readFileSync(target, "utf8"));
    dir = path.dirname(target);
    stem = manifest.base; ext = manifest.ext || ".log";
  } else {
    // Treat target as a log base path (or directory). Look for <stem>.manifest.json.
    const isDir = fs.existsSync(target) && fs.statSync(target).isDirectory();
    dir = isDir ? target : path.dirname(target);
    const baseGuess = isDir ? "" : path.basename(target, path.extname(target) || "");
    ext = isDir ? ".log" : (path.extname(target) || ".log");
    const mp = path.join(dir, (baseGuess || "crawl-progress") + ".manifest.json");
    if (fs.existsSync(mp)) { manifest = JSON.parse(fs.readFileSync(mp, "utf8")); stem = manifest.base; ext = manifest.ext || ".log"; }
    else stem = baseGuess;
  }

  let orderedFiles;
  if (manifest && Array.isArray(manifest.parts) && manifest.parts.length) {
    orderedFiles = manifest.parts.slice().sort((a, b) => a.part - b.part).map((p) => path.join(dir, p.file));
  } else {
    // No manifest: scan the directory for <stem>.partNNN<ext>, order by #META part number.
    const re = new RegExp("^" + stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\.part(\\d+)" + ext.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
    const found = [];
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(re);
      if (m) found.push({ n: Number(m[1]), file: path.join(dir, f) });
    }
    found.sort((a, b) => a.n - b.n);
    orderedFiles = found.map((x) => x.file);
  }

  if (!orderedFiles.length) throw new Error("No log parts found for: " + target);

  const sink = outFile ? fs.createWriteStream(outFile) : process.stdout;
  const head = `# composite log reconstructed from ${orderedFiles.length} part(s)${manifest ? ` (run ${manifest.run}${manifest.complete ? "" : ", INCOMPLETE"})` : ""}\n`;
  sink.write(head);
  for (const file of orderedFiles) {
    const text = fs.readFileSync(file, "utf8");
    // Drop each part's #META header line; keep the rest verbatim, in order.
    const body = text.replace(/^#META [^\n]*\n?/, "");
    sink.write(body);
  }
  if (outFile) sink.end();
  return orderedFiles.length;
}

module.exports = { makeLogWriter, makeJournal, mergeLogs };
