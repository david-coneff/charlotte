"use strict";
const { URL } = require("url");
const { BROWSER_UA } = require("./fetch.js");

// ----------------------------- CLI parsing -----------------------------
function parseArgs(argv) {
  const cfg = {
    startUrl: null,
    startUrls: [],       // one or more sites, crawled sequentially with these settings
    maxPages: 200,
    maxDepth: 3,
    scope: "domain",     // "domain" = whole host, "path" = under start URL's path
    pathPrefix: "",      // explicit path prefix to confine the crawl to
    concurrency: 4,
    delay: 100,
    rps: 0,
    timeout: 20000,
    recheck: true,                   // after the crawl, re-test failed links once (transient timeouts)
    scanDocs: true,                  // open PDFs/Office docs and check the links inside them
    maxDocBytes: 25 * 1024 * 1024,   // don't download a document larger than this to scan
    maxRetries: 5,                   // re-tries for a rate-limited (429/503) page before giving up
    maxBackoff: 300,                 // cap (seconds) on the auto-backoff window
    crawlDelay: 0,                   // manual crawl-delay (s); 0 = use robots.txt
    ignoreRobots: false,             // skip robots.txt entirely
    maxUrls: 0,                      // hard cap on distinct internal URLs tracked (0 = derive from maxPages)
    maxReferrers: 0,                 // cap on distinct referrers kept per link (0 = unlimited)
    seen: "memory",                  // dedup backend: memory | compact | disk
    seenFile: "crawl-seen.idx",      // backing file for --seen disk
    checkpoint: 25,                  // rewrite report/JSON every N pages (0 = off)
    log: "crawl-progress.log",       // live append-only progress log ("" = off)
    logMaxBytes: 5 * 1024 * 1024,    // roll to a new log part at this size (0 = single file)
    stopFile: "",                    // if this file appears, stop gracefully (GUI Stop button)
    pauseFile: "",                   // while this file exists, pause crawling (GUI Pause button)
    tuneFile: "",                    // JSON file watched live; changes re-tune delay/rps/crawl-delay/timeout mid-crawl
    includeSubdomains: false,
    checkExternal: false,
    browser: false,                  // send a desktop-browser UA + Accept headers
    userAgent: "charlotte-crawler/1.0 (+local)",
    userAgentSet: false,             // did --user-agent override the default?
    allowlist: "crawl-allowlist.txt",
    suggest: "crawl-allowlist.suggested.txt",
    out: "crawl-report.html",
    json: "",
    paginate: false,                 // client-side paginate report tables (1000 rows/page); off = render all at once
    state: "",                       // resume journal path ("" = off); --state FILE to enable
    resume: "",                      // replay this journal, then continue ("" = fresh crawl)
    recheckFrom: "",                 // re-check the broken links in this JSON report, then rewrite --out/--json
  };
  const num = (v, name) => { const n = Number(v); if (!Number.isFinite(n)) die("Invalid number for " + name + ": " + v); return n; };
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    const arg = a[i];
    const next = () => { const v = a[++i]; if (v === undefined) die("Missing value for " + arg); return v; };
    switch (arg) {
      case "-h": case "--help": printHelp(); process.exit(0); break;
      case "--max-pages": {
        const pv = next();
        if (/^(none|unlimited|all|inf|infinity)$/i.test(pv) || Number(pv) < 0) cfg.maxPages = Infinity;
        else cfg.maxPages = Math.max(1, num(pv, arg));
        break;
      }
      case "--max-urls": cfg.maxUrls = Math.max(0, num(next(), arg)); break;
      case "--max-referrers": cfg.maxReferrers = Math.max(0, num(next(), arg)); break;
      case "--seen": {
        const sv = next().toLowerCase();
        if (sv !== "memory" && sv !== "compact" && sv !== "disk") die("--seen must be memory, compact, or disk");
        cfg.seen = sv;
        break;
      }
      case "--seen-file": cfg.seenFile = next(); break;
      case "--checkpoint": cfg.checkpoint = Math.max(0, num(next(), arg)); break;
      case "--log": cfg.log = next(); break;
      case "--no-log": cfg.log = ""; break;
      case "--log-max-bytes": cfg.logMaxBytes = Math.max(0, num(next(), arg)); break;
      case "--stop-file": cfg.stopFile = next(); break;
      case "--pause-file": cfg.pauseFile = next(); break;
      case "--tune-file": cfg.tuneFile = next(); break;
      case "--max-depth": {
        const dv = next();
        if (/^(none|unlimited|all|inf|infinity)$/i.test(dv) || Number(dv) < 0) cfg.maxDepth = Infinity;
        else cfg.maxDepth = Math.max(0, num(dv, arg));
        break;
      }
      case "--scope": {
        const sv = next().toLowerCase();
        if (sv !== "domain" && sv !== "path") die("--scope must be 'domain' or 'path'");
        cfg.scope = sv;
        break;
      }
      case "--path-prefix": cfg.pathPrefix = next(); cfg.scope = "path"; break;
      case "--concurrency": cfg.concurrency = Math.max(1, Math.min(32, num(next(), arg))); break;
      case "--delay": cfg.delay = Math.max(0, num(next(), arg)); break;
      case "--rps": cfg.rps = Math.max(0, num(next(), arg)); break;
      case "--timeout": cfg.timeout = Math.max(1000, num(next(), arg)); break;
      case "--max-retries": cfg.maxRetries = Math.max(0, num(next(), arg)); break;
      case "--max-backoff": cfg.maxBackoff = Math.max(1, num(next(), arg)); break;
      case "--crawl-delay": cfg.crawlDelay = Math.max(0, num(next(), arg)); break;
      case "--ignore-robots": cfg.ignoreRobots = true; break;
      case "--recheck": cfg.recheck = true; break;
      case "--no-recheck": cfg.recheck = false; break;
      case "--scan-docs": cfg.scanDocs = true; break;
      case "--no-scan-docs": cfg.scanDocs = false; break;
      case "--max-doc-bytes": cfg.maxDocBytes = Math.max(0, num(next(), arg)); break;
      case "--include-subdomains": cfg.includeSubdomains = true; break;
      case "--check-external": cfg.checkExternal = true; break;
      case "--browser": cfg.browser = true; break;
      case "--user-agent": cfg.userAgent = next(); cfg.userAgentSet = true; break;
      case "--allowlist": cfg.allowlist = next(); break;
      case "--suggest": cfg.suggest = next(); break;
      case "--out": cfg.out = next(); break;
      case "--json": cfg.json = next(); break;
      case "--paginate": cfg.paginate = true; break;
      case "--no-paginate": cfg.paginate = false; break;
      case "--state": cfg.state = next(); break;
      case "--resume": cfg.resume = next(); if (!cfg.state) cfg.state = cfg.resume; break;
      case "--recheck-from": cfg.recheckFrom = next(); break;
      default:
        if (arg.startsWith("-")) die("Unknown option: " + arg);
        else cfg.startUrls.push(arg);
    }
  }
  if (!cfg.startUrls.length && !cfg.recheckFrom) die("Missing start URL.\n");
  for (const u of cfg.startUrls) { try { new URL(u); } catch { die("Invalid start URL: " + u); } }
  cfg.startUrl = cfg.startUrls[0];
  // --browser implies the desktop-Chrome UA unless the user set one explicitly.
  if (cfg.browser && !cfg.userAgentSet) cfg.userAgent = BROWSER_UA;
  return cfg;
}

function die(msg) { console.error("Error: " + msg); printHelp(); process.exit(1); }
function printHelp() {
  console.log(`
crawl.js — standalone domain crawler

  node crawl.js <start-url> [more-urls...] [options]

  Multiple start URLs are crawled sequentially with the same settings; the
  report at --out becomes an index linking to a per-site report for each.

Options:
  --max-pages N           Max pages to crawl, 'none' (or -1) = unlimited
                                                        (default 200)
  --max-urls N            Hard cap on distinct internal URLs remembered, a
                          memory backstop for big crawls (default: derived
                          from --max-pages; set explicitly when unlimited)
  --max-referrers N       Cap on distinct referrers kept per link; every
                          referrer of a broken link is reported (default 0 =
                          unlimited; set a cap to bound memory on huge sites)
  --seen MODE             Dedup backend: memory (RAM, exact, fastest),
                          compact (RAM, 64-bit hashes, fixed footprint),
                          disk (hash table in a file, lowest RAM, slowest)
                                                        (default memory)
  --seen-file FILE        Backing file for --seen disk  (default crawl-seen.idx)
  --max-depth N           Max internal link depth, 0 = start only,
                          'none' (or -1) = unlimited     (default 3)
  --checkpoint N          Rewrite report/JSON every N pages, 0 = off (default 25)
  --state FILE            Write an append-only resume journal (frontier + results)
  --resume FILE           Replay a journal, then continue WITHOUT re-crawling pages
                          already done (appends to the same FILE)
  --recheck-from FILE     Re-check ONLY the broken links in a prior --json report
                          (using the current rate / timeout / --browser etc.), correct
                          the record (drop links that now resolve), and rewrite
                          --out / --json. No re-crawl.
  --log FILE              Live append-only progress log  (default crawl-progress.log)
  --log-max-bytes N       Roll to a new log part at this size, 0 = single file
                                                        (default 5242880 = 5 MB)
  --no-log                Disable the progress log
  --stop-file FILE        If this file appears mid-crawl, stop gracefully and
                          write a partial report (used by the GUI Stop button)
  --pause-file FILE       While this file exists, pause crawling; delete it to
                          resume (used by the GUI Pause button)
  --tune-file FILE        Watch this JSON file and apply changes to it live, without
                          restarting: { "delay": ms, "rps": n, "crawlDelay": s,
                          "timeout": ms }. Pause, edit the file (or change the GUI
                          fields and hit Resume), and the new pacing takes effect.

Reconstruct a partitioned log into one composite stream:
  node crawl.js --merge-logs <manifest-or-log-base> [--out FILE]
  (writes to stdout, or to FILE with --out)
  --scope domain|path     Confine crawl to whole host, or to the start
                          URL's path subsection          (default domain)
  --path-prefix STR       Confine crawl to this path prefix, e.g. /docs
                          (implies --scope path)
  --concurrency N         Requests in flight at once     (default 4)
  --delay MS              Per-worker pause between reqs   (default 100)
  --rps N                 Global requests/sec cap, 0=off (default 0)
  --timeout MS            Per-request timeout            (default 20000)
  --max-retries N         Retries for a rate-limited (429/503) page before
                          giving up                      (default 5)
  --max-backoff N         Cap (seconds) on the auto-backoff window (default 300)
  --crawl-delay N         Min seconds between requests; overrides robots.txt
                          (default 0 = use robots.txt)
  --ignore-robots         Don't fetch/honor robots.txt crawl-delay
  --recheck / --no-recheck  Re-test failed links once after the crawl, to clear
                          transient timeouts; corrects the report (default on)
  --scan-docs / --no-scan-docs  Open PDFs and Office docs (docx/xlsx/pptx, and
                          best-effort for older .doc/.xls/.ppt) and check the
                          links inside them (default on)
  --max-doc-bytes N       Skip documents larger than this (default 26214400 = 25 MB)
  --include-subdomains    Treat subdomains as internal
  --check-external        Verify external links resolve (HEAD, then GET)
  --browser               Send a desktop-browser User-Agent + Accept-Language
                          headers, so sites that 403 unknown clients still
                          verify. Honest identity — not cookie/JS spoofing.
  --user-agent STR        Custom User-Agent header (overrides --browser)
  --allowlist FILE        Suppress matching broken links (default crawl-allowlist.txt)
  --suggest FILE          Write editable broken-link list (default crawl-allowlist.suggested.txt)
  --out FILE              Output report HTML             (default crawl-report.html)
  --json FILE             Also write raw JSON results
  --paginate              In the HTML report, show large tables 1,000 rows at a
                          time with Prev/Next paging (all rows stay embedded; keeps
                          very large reports responsive). Off by default = render
                          every row at once.
  -h, --help              Show this help
`);
}

module.exports = { parseArgs, die };
