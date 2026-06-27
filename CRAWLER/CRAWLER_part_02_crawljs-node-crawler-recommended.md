---
docgraph-version: 1
docgraph-type: section
section-id: crawljs-node-crawler-recommended
section-order: 2
parent-index: CRAWLER_index.json
content-hash: sha256:39302e424c65128aae96806352a900a0cc7de980cedb00119a32416d38cc2a8c
---
## `crawl.js` — Node crawler (recommended)

No browser, no CORS. Crawls any domain directly and writes a self-contained
`report.html` you open in a browser.

### Requirements

Node.js (any recent version — uses only built-in modules, no `npm install`). `crawl.js`
is split into sibling modules — **`cli.js`, `netutil.js`, `recheck.js`, `report.js`,
`parse.js`, `fetch.js`, `log.js`, `seen.js`** — so keep those in the same folder as
`crawl.js` (it `require`s them; no bundler or build step).

### Quick start

```bash
node crawl.js https://example.com/
open crawl-report.html        # macOS;  xdg-open on Linux;  start on Windows
```

### Common runs

```bash
# Bigger crawl, polite rate limit, verify external links resolve
node crawl.js https://example.com/ --max-pages 500 --rps 5 --check-external

# Treat blog.example.com etc. as part of the site
node crawl.js https://example.com/ --include-subdomains

# Also emit raw JSON for scripting
node crawl.js https://example.com/ --json results.json
```

### Options

| Flag | Default | Meaning |
|------|---------|---------|
| `<start-url>` | _(required)_ | Where to begin. Its host defines "internal". |
| `--max-pages N` | `200` | Stop after N pages; `none` (or `-1`) = unlimited. |
| `--max-urls N` | _(derived)_ | Hard cap on distinct internal URLs remembered — a memory backstop. Defaults to `max-pages × 50`; set explicitly when pages are unlimited. |
| `--max-depth N` | `3` | Internal link depth. `0` = start page only; `none` (or `-1`) = unlimited. |
| `--scope domain\|path` | `domain` | `domain` crawls the whole host; `path` confines it to the start URL's subsection. |
| `--path-prefix STR` | _(off)_ | Confine the crawl to this path prefix, e.g. `/docs` (implies `--scope path`). |
| `--checkpoint N` | `25` | Re-write the report/JSON every N pages so a killed run leaves a current snapshot. `0` = off. |
| `--log FILE` | `crawl-progress.log` | Live append-only progress log (partitioned — see below). |
| `--log-max-bytes N` | `5242880` | Roll to a new log part at this size. `0` = single file. |
| `--no-log` | | Disable the progress log. |
| `--seen memory\|compact\|disk` | `memory` | Dedup backend: RAM strings, RAM hashes, or an on-disk hash table (lowest RAM). |
| `--seen-file FILE` | `crawl-seen.idx` | Backing file for `--seen disk`. |
| `--concurrency N` | `4` | Requests in flight at once. |
| `--delay MS` | `100` | Pause each worker waits between its requests. |
| `--rps N` | `0` (off) | Global cap on requests/second across all workers. |
| `--timeout MS` | `20000` | Per-request timeout. |
| `--include-subdomains` | off | Count subdomains of the start host as internal. |
| `--check-external` | off | Verify each external link resolves: a HEAD, then a GET if HEAD is inconclusive (many servers mishandle HEAD or block bots at it). |
| `--browser` | off | Send a desktop-Chrome `User-Agent` plus the `Accept`/`Accept-Language` headers a browser sends. Sites that serve a 403/blank to unknown clients then verify correctly. Honest identity — no cookie/JS/fingerprint spoofing. |
| `--user-agent STR` | `charlotte-crawler/1.0 (+local)` | Custom `User-Agent` header. Overrides `--browser`'s UA (browser headers are still sent). |
| `--allowlist FILE` | `crawl-allowlist.txt` | Patterns whose broken links are suppressed (see below). |
| `--suggest FILE` | `crawl-allowlist.suggested.txt` | Where new broken links are written for review. |
| `--out FILE` | `crawl-report.html` | Output report. |
| `--json FILE` | _(off)_ | Also write raw results as JSON. |
| `-h`, `--help` | | Show usage. |

Run `node crawl.js --help` to see this list anytime.

### Multiple sites in one run

Pass more than one start URL to crawl several sites **sequentially** with the
same settings — handy for a specific set of subdomains:

```bash
node crawl.js https://a.example.gov https://b.example.gov https://c.example.gov --check-external
```

The `--out` file becomes an **index** listing each site with its summary and a
link to a per-site report (`crawl-report.1-a.example.gov.html`, …). The progress
log is shared (with `# === site i/N ===` markers), and `--json` produces one
combined file with a `sites` array. In the GUI, use **+ Add another site** to add
Start URL rows; the live stats aggregate across sites and the activity shows
which site (`site i/N`) is in progress.

> Note: each site is crawled under its own host. If you want each subdomain kept
> to itself, leave "Treat subdomains as internal" off; with it on, a crawl can
> follow links into other subdomains it's allowed to treat as internal.

### Scope and depth — how far the crawl reaches

Two settings control *where* the internal crawl is allowed to go. Neither
affects external links (those are always recorded at a single tier).

**Depth** (`--max-depth`) limits link-hops from the start URL:

```bash
node crawl.js https://example.com/ --max-depth 2      # start + 2 hops
node crawl.js https://example.com/ --max-depth none   # no limit (whole site)
```

With `none`, the crawl keeps going until it runs out of internal pages or hits
`--max-pages` (which is your safety stop — raise it for large sites).

**Scope** controls whether the crawl covers the whole domain or just a
subsection:

```bash
# Whole site from the root (default)
node crawl.js https://example.com/

# Only the /mysubsection part of the site
node crawl.js https://example.com/mysubsection --scope path

# Same idea, but state the prefix explicitly (start URL can be anywhere)
node crawl.js https://example.com/ --path-prefix /mysubsection
```

- `--scope path` confines the crawl to the start URL's path. Starting at
  `https://example.com/mysubsection` crawls `/mysubsection` and everything under
  it, but not the rest of the site.
- `--path-prefix /docs` does the same with an explicit prefix, regardless of
  where you start.

When a scope is set, internal links **outside** the subsection (same domain, but
not under the prefix) are treated like external ones: **recorded but never
followed**, and listed in the report's **Out of scope** tab so you can see what
you chose not to crawl.

### Rate limiting

Three independent knobs — combine as needed to be a good citizen of the site
you're crawling:

- `--concurrency` caps how many requests run **at the same time**.
- `--delay` adds a pause **between** each worker's requests.
- `--rps` caps the **overall** request rate, regardless of concurrency. It
  spaces request start times, so `--rps 5` means at most 5 requests/second
  even with high concurrency.

A gentle profile for a site you don't own:

```bash
node crawl.js https://example.com/ --concurrency 2 --rps 2 --delay 250
```

### Rate-limit handling: robots.txt, adaptive backoff, auto-resume

The crawler tries to be a good citizen automatically:

- **robots.txt `Crawl-delay`** — on start it fetches the site's `robots.txt` and,
  if a `Crawl-delay` applies to its User-Agent (or `*`), enforces at least that
  spacing between requests. Override with `--crawl-delay N` (seconds) or skip it
  with `--ignore-robots`.
- **Adaptive backoff** — when the server returns **`429` (Too Many Requests)** or
  **`503`**, the crawler does *not* treat the page as broken. It honors any
  `Retry-After` header (else an exponential 5s → 10s → 20s… window, capped by
  `--max-backoff`, default 300s), **pauses all workers**, and **re-queues the
  page**. When the window passes it **auto-resumes** and retries — up to
  `--max-retries` times (default 5) before finally recording it as an error.

So if you get rate limited, you don't have to do anything: the crawl slows down,
waits, and continues on its own. The report and progress log note how many
`rate-limit retries` happened, and the Windows GUI shows a live
*"rate limited — auto-resume in Ns"* indicator while it's backing off.

If a site is persistently throttling you, lower the rate further
(`--concurrency 1 --rps 1`) rather than trying to evade it.

### Links inside documents

When a crawled link points to a **PDF or Office document**, the crawler opens it
and checks the links *inside* it too — not just whether the document itself
loads. Supported:

- **PDF** — clickable link annotations (`/URI`).
- **Office Open XML** — `.docx`, `.xlsx`, `.pptx` (external hyperlinks from the
  files' relationship parts). Done with Node's built-in `zlib`, no dependency.
- **Older binary Office** — `.doc`, `.xls`, `.ppt` — best-effort URL scan.

Links found inside a document are treated like links found on a page: same-domain
ones are followed, external ones are recorded/verified, and the document is shown
as the "found on" referrer for anything broken. On by default; disable with
`--no-scan-docs` (or the GUI toggle). `--max-doc-bytes` (default 25 MB) skips
documents too large to download.

> Note: this reads *hyperlinks* embedded in documents. It can't see URLs that are
> only printed as plain text inside a PDF's page content (that text is compressed
> and not a real link).

### Second-pass re-check

After the crawl (and external check) finishes, the crawler re-tests every link
that failed, once. A first failure is often a transient timeout; if it works on
the second try, the error is dropped and the report self-corrects (an external
link flips back to *reachable*). Each correction is logged
(`# recheck <url> was=error now=ok`). On by default; disable with `--no-recheck`
(or the GUI's "Re-test failed links once at the end" toggle).

### Re-checking broken links later (`--recheck-from`)

The second pass above runs *once*, right after the crawl. If you suspect the broken
links were just a flaky connection, you can re-check them **on demand** — later, when
the network is stable — without re-crawling the whole site:

```bash
node crawl.js --recheck-from crawl-report.json --rps 2 --out crawl-report.html --json crawl-report.json
```

It loads the broken (and blocked) links from a prior `--json` report, re-probes **only
those** with whatever settings you pass now (rate, timeout, `--browser`, …), and
rewrites the report with the record **corrected and de-duplicated**: links that now
resolve are dropped, anything still broken stays, allowlisted entries are preserved,
and each link appears once. Point `--out` / `--json` at the original files to update
them in place. (The GUI exposes this as a **Re-check broken links** button that uses
the form's current settings.)

This works for a **multi-site** crawl too: point `--recheck-from` at the *index* JSON
and it re-checks every site (from the per-site JSON files written next to the index)
and rebuilds the index + each per-site report. A multi-site crawl writes those per-site
JSONs automatically; if you re-check an older index that predates them, it tells you to
re-run the crawl once rather than touching the report.

Re-check writes its results to a **separate `*.recheck.json`** sidecar first and only
rewrites the live report + JSON once the whole pass has finished — so an interrupted or
failed re-probe never leaves the main report half-overwritten. In the GUI it streams live
progress (re-checked / now OK / still broken / blocked) to the run log and honors the
**Pause** and **Stop** buttons just like a crawl (`--stop-file` / `--pause-file`); a Stop
keeps every link it hadn't reached yet in its existing state, so nothing is lost.

### Rebuilding a report from saved data (`--rebuild-from`)

Upgraded Charlotte and want the new report features on a crawl you already ran — without
repeating a multi-hour crawl? Rebuild the HTML straight from the JSON:

```bash
node crawl.js --rebuild-from crawl-report.json --out crawl-report.html --json crawl-report.json
```

It reconstructs the report from the saved data and re-renders it with **this version's**
report features — no crawl, no network, no re-probe. It also re-emits the JSON (adding any
new summary fields). Multi-site: point it at the *index* JSON and it rebuilds every
per-site report (from the per-site JSONs) plus the index. The GUI exposes this as a
**Rebuild report** button. (Crawl *runtime* is preserved for reports written by this
version onward; reports from older versions that didn't record it show ~0s.)

### Browser second-opinion for suspect links (`crawl-render.js`)

`crawl.js` checks links with plain HTTP (HEAD, then GET) and a real browser
`User-Agent` (with `--browser`). That clears most false positives and sorts
links it *can't* confirm into the **Blocked · uncertain** bucket — but some links
genuinely only work in a full browser (a JavaScript challenge, a client-rendered
page). `crawl-render.js` is the next escalation: it re-opens each suspect link in
**real headless Chromium** (via Playwright), which runs the page's JavaScript and
presents a genuine browser identity, and reports whether it actually resolves.

It is honest verification, not circumvention: no faked input, no fingerprint
spoofing. If a site still refuses an honestly-identified, rendered browser at a
polite rate, that's reported as **blocked** — verify by hand or ask the operator
for access (an API or an allowlist).

Playwright is an **optional** dependency, deliberately kept out of `crawl.js` so
the core tool stays zero-dependency. Install it once:

```bash
npm i playwright
npx playwright install chromium       # download Chromium, OR…
# …skip the download and use the Chrome you already have, via --channel chrome
```

Typical workflow — crawl, then re-check only the suspects against the JSON report:

```bash
node crawl.js https://example.gov/ --check-external --browser --json crawl-report.json
node crawl-render.js --from-json crawl-report.json --channel chrome \
     --html render-report.html --apply crawl-report.json
```

- `--from-json FILE` pulls the report's **errors** and **blocked** links (choose
  with `--which blocked|broken|both`, default both). Single-site and combined
  multi-site JSON are both understood. You can also pass URLs directly or a
  `--list FILE`.
- Each link is re-classified **reachable** / **dead** / **blocked** and written
  to `--out` (default `crawl-render.json`) plus an optional `--html` summary.
- `--apply FILE` reconciles the original crawl JSON in place: links now confirmed
  reachable are dropped from the error/blocked buckets, and the summary counts are
  updated (a `.bak` is kept). Links that render fine were false positives.
- Polite by default — `--concurrency 1`, `--delay 500`. Raise carefully.
- No browser installed? `--http-fallback` does a plain HTTP re-check (no
  rendering) so the tool still runs, clearly labelled as such in its output.

Run `node crawl-render.js --help` for the full option list.

### Large crawls: checkpoints, resumable view, and partitioned logs

For an unbounded crawl (`--max-pages none`), the run can take a long time, so the
tool keeps a current picture on disk the whole way through — if it's interrupted,
you can see exactly where it left off.

**Checkpoints.** Every `--checkpoint N` pages (default 25) the report and JSON are
re-written with partial data. The partial `report.html` auto-refreshes in the
browser, so you can open it mid-crawl and watch progress. Press **Ctrl+C** and the
crawler flushes a final partial report before exiting — nothing is lost.

**Partitioned progress log.** The live log is written one line per page/error as
it happens, split into size-bounded **parts** so no single file grows without
limit:

```
crawl-progress.part001.log     # each part starts with a #META header line
crawl-progress.part002.log
crawl-progress.manifest.json   # index of the parts, in order
```

Each part is self-describing (a `#META` line with the run id and part number), and
the manifest indexes them. Set the part size with `--log-max-bytes` (default 5 MB;
`0` = one unrotated file).

**Reconstruct the full log** from the parts at any time:

```bash
node crawl.js --merge-logs crawl-progress.manifest.json            # to stdout
node crawl.js --merge-logs crawl-progress.manifest.json --out full.log
```

This works even if the manifest is missing — point it at the log base path and it
rebuilds the order by reading each part's `#META` header. The report's **Progress
log** card lists the parts and shows this command.

### Resuming after a stop or crash (`--state` / `--resume`)

A long crawl that dies — a crash, a kill, a dropped connection, a closed laptop —
doesn't have to start over. Pass **`--state FILE`** and the crawler writes an
**append-only journal** of everything it discovers (the frontier) and everything it
finishes (each page, its links, errors). Every line is flushed *synchronously*, so
even a hard `kill -9` leaves a usable journal.

```bash
node crawl.js https://example.com/ --max-pages none --state crawl-state.jsonl
```

If it stops, **resume** it:

```bash
node crawl.js https://example.com/ --max-pages none --resume crawl-state.jsonl
```

`--resume` replays the journal to rebuild the queue and the results so far, **skips
every page already done**, and continues from where it stopped. It does **not**
re-crawl anything already finished, and the finished report is identical to an
uninterrupted run. You can be interrupted and resume as many times as needed
(`--resume` keeps appending to the same file). Use the **same options** (start URL,
scope, depth) when resuming so the continuation matches the original.

For a **multi-site** run, point `--state` / `--resume` at a base name; each site
gets its own journal (`crawl-state.1-host.jsonl`, …), just like the per-site
reports, so a resume skips sites already finished and continues the one that was
in progress.

If a specific page **crashes the crawler** every time, resume won't loop on it: a
URL that aborted the process across two resumes without ever completing is
**quarantined** (recorded as blocked) instead of retried yet again. And the Windows
GUI has a **Resume crawl** button — it writes the journal automatically and continues
the interrupted run for you.

The journal grows with the crawl (it records the discovered link graph), so it's
opt-in via `--state` and independent of the report/log checkpoints above.

### Re-tuning the pace mid-crawl (`--tune-file`) — no restart

If you realize partway in that the **pace is the problem** (getting rate-limited, or
just too slow), you don't have to start over. Run with `--tune-file FILE` and the
crawler watches that JSON file; when you change it, the new pacing applies to the
**running** crawl:

```json
{ "delay": 1000, "rps": 0.5, "crawlDelay": 2, "timeout": 30000 }
```

Any subset of `delay` (ms between a worker's requests), `rps` (global requests/sec
cap, `0` = uncapped), `crawlDelay` (seconds between requests), and `timeout` (ms) is
applied live — each request re-reads the rate, so a change takes effect within a
moment. The crawler logs a `RETUNED …` line and prints `Re-tuned: …`. The natural
flow is **pause → edit → resume**, and the file's contents at startup are the
baseline (so a stale file can't override your CLI flags).

In the Windows **GUI** this is automatic: **Pause**, change the **Delay**, **Max
req/sec**, or **Timeout** fields, and click **Resume** — the new values are written to
the tune file and picked up without restarting. `rps` is a hard cap on the actual
request rate, so lowering it is the most direct way to back off a site that's
throttling you.

> Structural settings (concurrency, depth, scope, …) aren't hot-swappable, but you
> don't have to re-crawl to change them either: **Stop**, change them, and **Resume
> crawl** — the journal (above) continues from where it stopped without re-fetching
> pages already done.

### Memory on big sites

A crawler must remember every URL it has seen to avoid re-crawling, so peak memory
scales with the number of **distinct internal URLs**, not the total page size. The
tool bounds the other growth vectors so RAM stays predictable:

- **Per-link sources are capped** — a link that appears on every page (a nav or
  share button) keeps at most 25 example "found on" pages plus a total count,
  instead of accumulating every referrer.
- **Page bodies are read in chunks and released** after links are extracted; a
  per-page size cap (5 MB) prevents one huge page from spiking memory.
- **The report renders every row** (no per-table cap) so nothing is dropped from
  the HTML; the full data is also always in the JSON and the log. The HTML inlines
  each row, so its size grows with the crawl (~280 bytes/link — e.g. ~1.7 MB for
  6,000 links, ~28 MB for 100,000). For very large crawls the JSON stays the compact,
  machine-readable source of truth.
- **`--paginate`** (off by default; GUI: *Paginate report* dropdown) keeps every row
  embedded but shows tables **a page at a time** with Prev/Next/Go-to paging, so a
  report with tens of thousands of links opens and scrolls smoothly. The page size is
  **1,000 rows by default** and configurable with **`--page-size N`** (GUI dropdown:
  Off / 250 / 500 / 1,000 / 2,500 / 5,000) — it applies to **every** data table
  (internal pages, the Errors/Blocked tables, …). This includes each broken link's
  nested **"found on" referrer list**, which is otherwise
  uncapped — every page that links to a broken URL is listed (a sitewide link can have
  thousands), and with `--paginate` you page through them. It is display-only —
  selection, the allowlist export, and the fix-tracker export all still act on every
  row, not just the visible page. Without it, all rows render at once (fine up to a few
  thousand; slower in the browser beyond that).
- **`--allowlist-export`** (off by default; GUI: *Allowlist export tools in report
  (legacy)*) re-enables the in-report **allowlist export** UI on the two Errors tabs —
  the per-link pick checkboxes, the **Select all**, and the **Export to allowlist…** /
  **Copy lines** buttons. It's off by default because the **fix tracker** and the
  **Broken/Working** verdict tools have superseded it for triage. This is purely about the
  report's *export* affordance; the crawler still **reads** an allowlist via `--allowlist`
  regardless (that's the input side, unchanged). The **Suppressed** tab — which shows what
  the input allowlist hid — is also always present.
- **`--max-urls N`** is a hard backstop on how many distinct URLs are remembered.
  It defaults to `max-pages × 50`; when you crawl with `--max-pages none` on a very
  large site, set `--max-urls` (e.g. `--max-urls 500000`) to cap memory explicitly.

For a huge site, a safe shape is: unlimited pages, a frontier cap, modest rate, and
checkpoints on (the defaults):

```bash
node crawl.js https://example.com/ --max-pages none --max-urls 500000 --rps 5
```

#### Dedup backend (`--seen`) — trading RAM for disk

To avoid re-crawling, the crawler must remember every URL it has queued or
visited. By default those URLs live in RAM, so peak memory grows with the site.
If you'd rather **not be limited by RAM at all**, `--seen` swaps in a backend that
stores only a 64-bit hash per URL — and `disk` keeps that table in a file instead
of memory:

| `--seen` | Where the index lives | RAM | Speed | Notes |
|---|---|---|---|---|
| `memory` _(default)_ | URL strings in a RAM set | grows with URLs | fastest | exact |
| `compact` | 64-bit hashes in a RAM array | **fixed & small** | fast | exact* |
| `disk` | same table in a file (`--seen-file`) | ~constant | slowest | exact* |

\* Two different URLs sharing a 64-bit hash is astronomically unlikely (~1-in-
millions even at 10M URLs); if it ever happened, one URL would be skipped, never
re-crawled.

`disk` does exactly what the trade-off implies: it keeps RAM nearly flat by reading
the index from disk on each check (the OS page-cache keeps the hot parts in memory,
so it's slower but not as slow as it sounds), so the crawl size is bounded by disk,
not RAM. `compact` is the middle ground — a fixed, tiny RAM footprint with no disk
penalty, which is usually what you want.

```bash
# Lowest RAM, bounded by disk — for a site too big to fit the URL set in memory
node crawl.js https://example.com/ --max-pages none --seen disk --max-urls 5000000

# Fixed small RAM, still fast — the practical choice for most large crawls
node crawl.js https://example.com/ --max-pages none --seen compact --max-urls 5000000
```

`compact`/`disk` need a bounded URL count to size their table, so set `--max-urls`
when pages are unlimited (it defaults to 1,000,000 with a notice otherwise). The
`disk` index file is created fresh per run and deleted on normal completion.

> Why not just scan the existing progress logs to check if a URL was seen? Because
> the logs only record pages already **crawled**, not the **queued** frontier, so
> they'd miss in-flight duplicates — and grepping them per URL would be O(n²),
> slower than the memory it saves. A purpose-built hash index is the right tool.

### The report

`report.html` is self-contained (inline CSS/JS — email it, archive it) with
tabbed sections:

- **Internal destinations** — every page crawled, with depth, title, status, and link counts — **grouped into collapsible sections by first-level folder** (e.g. `site.gov/about/` vs `site.gov/blog/`; root pages under the bare host), each with a count, plus an **Expand all / Collapse all** toggle.
- **External destinations** — the *unique* off-site URLs your pages link to, grouped by destination host (each a collapsible section, with a count), with the pages they were found on. An **Expand all / Collapse all** toggle at the top of the tab opens or closes every domain section at once.
- **Out of scope** — _(only when a scope/prefix is set)_ same-domain links outside the subsection: recorded, not crawled — also **grouped into collapsible folder sections** (count each, Expand/Collapse all).
- **Broken · internal** — broken internal destinations (HTTP 404/410, bad requests) — yours to fix.
- **Broken · external** — unreachable external destinations (when `--check-external` is on) — a link to fix or remove.
- **Blocked · uncertain** — links the automated check *couldn't confirm*: a 401/403/429/5xx, a timeout, or a method quirk. These very likely work in a real browser — the server just refused our automated request — so they're shown apart from confirmed-dead links to keep false positives out of **Errors**. Verify by hand, or re-run with `--browser` and a slower rate to clear many of them. Each row has the same two mutually-exclusive boxes as the **Broken** tabs — **Broken** and **Working** — but with the opposite default: blocked links start *uncertain and uncounted*, so ticking **Broken** *confirms* one really is dead and **adds** it to the **Broken hyperlink instances** count (live), routed to internal or external by its **Kind**, while **Working** records that it loads. (Leave both unticked to keep it uncertain.) Either way, an uncertain link **stays in the fix-tracker export until you mark it Working** — like everything else untested — so the tracker is a complete to-review list. That feeds the same cleanup workflow without needing to split the tab in two.
- **Suppressed** — broken links hidden via the allowlist, kept separately so you can still audit them.

Each tab's list sits in a **fixed-height viewport that scrolls internally** (so a long list never
stretches the whole page) — and you can **drag its bottom-right corner to resize** the height to taste.
A **🌙/☀️ light/dark toggle** sits in the upper-right corner (of both the report and the fix tracker);
your choice is remembered in the browser and applied before the page paints (no flash).
Every grouped tab's table columns are **drag-resizable too**: grab the grip on a column header's right
edge and drag (there's **no minimum width** — make a column as narrow as you like); the change broadcasts
to every group on the tab so they stay aligned, persists in your browser, and an **↔ Reset column widths**
button restores the defaults. On the triage tabs the lengthy per-tab explanation is tucked into a
**“How this tab works”** disclosure you can collapse to reclaim space (it stays collapsed once you fold it).

Across the top sits a row of **headline numbers**, split into two ideas a one-line legend
spells out:

- **Destinations** — *unique* URLs, "where links point": **Internal pages** (distinct
  same-domain pages crawled), **External destinations** (distinct off-site URLs), and the
  broken ones (**Broken internal destinations**, **Broken external destinations** — named in
  full so they read clearly as the broken subset of the destination totals directly below them,
  not the much larger instance count). These counts are relatively small.
- **Hyperlink instances** — *occurrences*, "how many links are on the pages": every `<a>`
  across every crawled page (internal + external), **not deduplicated**, so a destination
  linked from N pages counts N times. **Broken hyperlink instances** is the same for links
  pointing at a broken destination (the real cleanup workload / number of fix-tracker rows).
  These counts run much larger — one destination linked from 500 pages is **1 destination
  but 500 instances**.

A **Referrer pages with broken links** card counts the *distinct pages* that link at least one
still-broken destination — the spread of the cleanup across your site (how many pages, and owners,
need a fix), not just how many links — and drops as you mark links Working or clear a page's last
broken link. Each broken/blocked card carries a **dashed outline** that's **amber while some links
are still untriaged** and turns **green once every internal + external + blocked link has a verdict**
(so the count is final); a compact **Outline:** key for those colours sits in the **upper-right by the
theme toggle**.

**Broken hyperlink instances** **updates live** as you mark links *Working* (Broken tabs)
or confirm *Broken* (Blocked tab), so after manual triage the header reflects what's actually
still broken. The metrics are in the JSON as `summary.linkInstances` /
`summary.brokenLinkInstances` (field names unchanged), and the multi-site index shows per-site
counts plus grand totals. Also shown: blocked, suppressed, requests, and the crawl
**Runtime**. The report is branded **Charlotte** with a 🕸️ favicon (visible on the browser tab).

The two **Errors** tabs are built for triage. Each row has two **mutually-exclusive**
verdict boxes: **Broken** (a manual check confirms it really is dead) and **Working** (it
actually loads). *(With `--allowlist-export`, an additional **allowlist** pick box and a
**Select all** appear to the left — select links, then **Export to allowlist…** / **Copy
lines** — see
[Allowlist](#allowlist-stop-known-broken-links-from-cluttering-future-reports). That
export UI is **off by default**; the verdict and fix-tracker tools below have replaced it.)* They start with *neither* ticked — every link
the crawler flagged is **assumed broken and already counted**, so you only ever *subtract*
from the header by ticking **Working**; ticking **Broken** just records that you've
confirmed one by hand (it was counting anyway). Ticking either box marks the link triaged —
there's no separate "Triaged" box — and ticking one unticks the other; clear both to return
a row to the default. A **live counter** per tab tracks progress — *"Manually triaged X / N
· confirmed broken Y · confirmed working Z"* — and **Working** links are dropped from the
fix tracker, so one false positive (a sitewide link the crawler flagged but that works by
hand) can't flood it with thousands of rows. A **Last triaged** column to the left of the
boxes **auto-fills the local date & time** whenever you tick **Broken** or **Working**, so
each row carries a timestamp of its latest manual result (it re-stamps when you change the
verdict and clears if you untick back to no verdict). Ticks and timestamps persist in the
browser.

The **Broken · external** tab additionally groups its links into **collapsible per-domain
sections**, each with a **domain-level Broken / Working pair** in the section header that
applies to *every* link in that domain at once — so when a whole site (a social network,
say) is systematically misread by the automated check but spot-checks fine in a browser,
you can clear it in **one click** instead of testing each link. The domain box derives its
state from the links it covers (all Working → Working, all Broken → Broken, mixed → neither),
so it survives a reload from the per-link verdicts; **Expand all / Collapse all** toggle the
sections.

Clicking **any link, on any tab** (Errors, Blocked, External, Internal, Out-of-scope) opens it in a
**single reused window docked to the side** of the report (whichever side has more room) — a global
handler routes every web link through the one window, so checking links never spawns a pile of tabs,
covers your report, or needs repositioning. (Ctrl/Cmd/Shift/middle-click still opens a normal new tab
if you want one.)

Each broken link also lists the pages it was **found on**.

A single **🔧 Export fix tracker** button lives in the report's **share toolbar above the
tabs** — always visible, so you don't have to switch to a particular tab or tick anything
first. It saves **one unified, standalone HTML checklist grouped by referrer page**: one
section per page that has broken links, with a free-form **Notes** field for that page and
its broken links beneath. The export includes **every link still to fix in one place** —
**broken** *and* **blocked/uncertain**, internal *and* external — **except the ones you've
marked Working**. Untested links are in by default (so the tracker is a complete to-review
list you work down as you confirm each); marking a link **Working** in the report is what
drops it. Each link row has an editable **Fixed** box — which stamps its own **Fixed on**
date/time when you tick it — plus, mirroring the main report, a **Last triaged** timestamp and
a mutually-exclusive **Broken / Working** verdict pair. The verdict and last-tested time are
**baked in from the report** at export time and stay editable: ticking Broken or Working
auto-fills the timestamp, the boxes are exclusive, and because a link can be reached from
several pages the verdict is **synced per URL** across every row it appears in. **Internal and
external broken links are worked together in one view** — whoever owns a page fixes *all* of its
broken links at once, so a page's section lists **every broken link on it regardless of type**, with
a **Type** column flagging each as internal or external (the By-broken-link view shows the type as a
badge in the section header instead). **Fixes, verdicts, timestamps, and notes persist in the
browser** (localStorage), so it can be worked through and handed off over time.

At the top, a **stat matrix** scores the work across four columns: the **bottom row is Broken**
(verdict-driven — broken hyperlink instances, broken internal destinations, broken external destinations,
and **pages with broken links**; a link drops out the moment you mark it **Working**), and the **top row
is Fixed** (how many of those references/destinations/pages you've **remediated**, each with its **% of the
broken total** shown beneath — formatted like the report's broken-stats percentages: at least one decimal,
and *more* precision when the fixed share is a tiny sliver of the broken total, so a handful of fixes among
thousands never rounds to a misleading `0%`). The **Pages with broken links / Pages remediated** pair is the
workload-by-owner view — a *page* is counted once it has any still-broken link, and "remediated" once every
one of its broken links is Fixed — so you can see how many distinct pages (and their responsible parties)
still need attention, not just how many links. The two axes are independent: *Broken/Working* is whether the
link loads; *Fixed* is whether the page's reference to it has been removed or corrected.

The groups are **collapsible sections** — grouped **By page** (referrer page → all its broken
links, internal and external) or **By broken link** (link → every page that links to it), toggled
at the top — and those sections **roll up under a collapsible folder/domain parent** (first-level path
folder for internal, host for external), mirroring the report's tabs, so you can collapse a whole
section of the site at once. (**Collapse all** folds every parent to a folder/domain bird's-eye;
**Expand all** opens everything.) Because the grouped key is a full (often long) URL, each header **stacks**: the link on its
own top row, then a left-aligned controls row — a live **K/N fixed** counter, an **All: ☐ Fixed**
bulk box that ticks/unticks every Fixed box in the section at once, and (By broken link) the
section's **Broken/Working** verdict — then, on the By-page view, a **Notes** row. A **translucent
amber dashed outline** marks a section that still has links which are **neither Fixed nor confirmed
Working**; it simply **disappears once every link is resolved** (fixed *or* working — no separate
"done" colour). **Expand all / Collapse all** open or close every section at once. The list sits in
a **fixed-height viewport that scrolls internally** — with a sensible default height you can **drag
the bottom-right corner to make as tall as you like** — and when a tab has more than 50 groups it
**paginates**; the **‹ Prev · Page X of Y · Next ›** bar sits *above* the scroll area so it stays
in reach no matter how far down you've scrolled. Just like the report's tables, **every column is
drag-resizable** — grab a column's right edge and drag; the new width applies to that column across
every section so they stay aligned, persists per view in your browser, and **↔ Reset columns**
restores the defaults (By-page and By-broken-link keep separate widths since their columns differ).

Like the report, the tracker **auto-saves** to localStorage as you work — reopen the same
tracker file in the same browser and your progress is intact, no Save step needed. And like
the report, that state doesn't ride along if you just email the file, so the tracker has its
**own share toolbar** — the same idea as the report's (below): **⬇ Export** writes the whole
tracker state (every Fixed tick + Fixed-on time, verdict + last-tested time, and note) as a
JSON file; **⬆ Import** loads **one or more** such files at once (multi-select a whole folder of
contributors' exports — it merges them all by entry, then reloads); and **💾 Save copy**
downloads a **self-contained copy of the tracker with all of that baked in** — email that single
file and the recipient opens it with your progress already in place. Imports are checked to the
same site and only apply keys under this tracker's own `cwfix:<host>:` namespace (a dropped file
can't inject stray storage), and a saved copy still displays where `file://` storage is locked
down.

Two **bulk-export** buttons turn the tracker into a delegation hub, each batch-writing a set of
self-contained mini-trackers into a **folder you pick once** (File System Access directory picker;
where it's unavailable it falls back to downloading the files individually):

- **🗂 Bulk export: per page** — one mini-tracker **per referrer page**, scoped to just that page's
  broken links, **auto-named after the page address** (slashes and other illegal filename characters
  become underscores: `http://site/blog/post-1` → `site_blog_post-1.html`).
- **🗁 Bulk export: per subfolder** — one mini-tracker **per tier-1 site subfolder** (`folderOf`):
  every page under e.g. `/blog/` goes into a *single* file, scoped to all of those pages' broken
  links and named after the folder (`site/blog/` → `site_blog.html`). Use this to hand a whole
  section of the site to one owner instead of a file per page.

Either way each file is **seeded with this tracker's current verdicts/fixes/notes** for its pages,
and groups whose links are all already marked **Working are skipped** (the toast reports how many).
Each owner fixes their slice, hits **⬇ Export** in their mini-tracker, and you **⬆ Import** their
JSON back here — because every fix is keyed by the same *(page → link)* pair and the site matches,
Import simply merges their ticks in, with no boxes to re-find. (The minis carry only their own
pages' links — the rest of the site's rendered lists are stripped out, so each file stays small and
scoped to its owner.)

To scale that beyond email — a central tracker on **SharePoint** consuming a folder that owners
drop their JSON into, merged by a **Power Automate** flow (or the `merge-fix-state.js` CLI) — see
[`SHAREPOINT-MERGE.md`](SHAREPOINT-MERGE.md). The multi-select **⬆ Import** above is the no-flow
fallback for that same loop.

#### Saving and sharing your verdicts

**Your triage auto-saves — there's no "Save" button to forget.** Every tick, verdict,
timestamp, and note is written to your browser's **localStorage** the moment you make it, so
reopening the *same* report in the *same* browser brings it all back exactly as you left it.
You do **not** need to export or bake anything just to keep your work. (Note a hard browser
rule: a web page **cannot** write back to its own `.html` on disk — so this automatic browser
storage, or a download you trigger, are the only places that state can live. There's no way to
silently re-save the report file in place.) The tools below are needed **only to move that
state somewhere else** — another machine or browser, or a teammate.

Because that state lives in localStorage and *not* inside the report file, simply emailing the
`.html` gives the recipient a blank-triage copy (nothing travels). A **Share your testing
verdicts** toolbar (above the tabs, on the final report) carries it across:

> Every **Export / Save** action here (and in the fix tracker) opens a **"Save As" file picker** so
> you choose the folder and filename, rather than dropping the file into your Downloads folder. The
> suggested filename arrives **pre-stamped with a timestamp** (`<name>_YYYY-MM-DD_HH-MM_SS.<ext>`) so
> each export is its own versioned file — you're free to edit it before saving. (In browsers without
> the File System Access API it falls back to a normal download, with the same stamped name.)

- **💾 Save shareable copy** — downloads a *new* self-contained report HTML with your current
  verdicts and timestamps **baked in** (as a `window.__CW_SEED__` island). Email that single
  file; the recipient just opens it and sees everything. It primes their browser only if they
  have no verdicts for this site yet (so it never clobbers their own triage), and it still
  displays even where `file://` localStorage is disabled.
- **⬇ Export verdicts** / **⬆ Import verdicts** — Export writes a small JSON of every tick +
  timestamp (`charlotte-verdicts-<host>.json`) to send alongside the report; Import loads such
  a file and reloads. Import **merges by link** (each link the file mentions is replaced; links
  it doesn't mention are left alone), so several people's triage can be combined. A verdicts
  file made for a different site is rejected.

(The **fix tracker** export above is already a self-contained file, so *it* survives emailing
too — but it's the referrer-grouped “what to fix” view, not the raw Broken/Working verdicts.)

Every broken link lists **all** the pages that link to it (each a clickable
"found on" referrer); when there's more than one, they're shown in a collapsible
table inside the row, so you can fix every reference. The full referrer lists are
also in the JSON output and logged (`# brokenref …`) one line per referrer.

Below the tabs, a **Progress log** card lists the log parts and the
`--merge-logs` command to reconstruct the full log.

While a crawl is still running, the partial report updates itself in the browser
as new data is written — but **without interrupting you**: the refresh is
deferred while you're scrolling, selecting text, or moving the mouse, and only
happens after a short idle gap. It also preserves your active tab, page scroll,
every table's scroll position, and which sections are expanded across the update
(and across reopening the report). State is stored in `localStorage`, so it's
shared across reports.

### Allowlist: stop known-broken links from cluttering future reports

Some "broken" links are expected — a third-party URL that blocks HEAD requests,
a deliberately-dead anchor, a flaky external host. The allowlist moves those out
of **Errors** into **Suppressed** so each report shows only *new* problems.

The loop:

1. **Run the crawler.** Any broken link not already allowlisted is written to
   the suggested file (`crawl-allowlist.suggested.txt`), one per line, annotated
   with the reason and the page it was found on:

   ```
   # Suggested allowlist — broken links found 2026-06-23T23:09:49.031Z
   # ...instructions...
   https://twitter.com/share        # external unreachable — found on: https://example.com/blog
   https://example.com/old-promo    # HTTP 404 — found on: https://example.com/
   ```

2. **Edit it.** Delete the lines for problems you genuinely want to keep seeing.
   Keep the lines you want silenced.

3. **Promote the keepers** into your allowlist file:

   ```bash
   cat crawl-allowlist.suggested.txt >> crawl-allowlist.txt
   # then open crawl-allowlist.txt and tidy as desired
   ```

4. **Re-run.** Allowlisted links now appear under **Suppressed**, not **Errors**.

**Shortcut — straight from the report.** On the **Errors · internal** and
**Errors · external** tabs, tick the links you want silenced and click **Export to
allowlist…** (or **Copy lines**). You get the same annotated allowlist lines as the
suggested file, but only for the links you chose — append the downloaded
`crawl-allowlist.append.txt` to `crawl-allowlist.txt` and re-run. Handy when only a
handful of the flagged links should be suppressed.

**Pattern syntax** (in `crawl-allowlist.txt`):

- One pattern per line; exact URL match by default.
- `*` is a wildcard: `https://twitter.com/*` silences every twitter.com link.
- `#` starts a comment; inline comments need a space before the `#` (so URLs
  containing `#` stay intact). Blank lines are ignored.

Example allowlist:

```
# Third-party share buttons that block HEAD requests
https://twitter.com/*
https://www.facebook.com/sharer/*

# Retired campaign page, intentionally gone
https://example.com/old-promo
```

Point any run at a specific allowlist with `--allowlist path/to/file.txt`.

---
