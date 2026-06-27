# CRAWLER — Document Index

The full Charlotte suite reference, partitioned under the Rhizome **rhiz-Merkle**
protocol (it exceeded the 500-line / 50 KB threshold at 971 lines / 56 KB). Each
section is a leaf file carrying frontmatter that links back to this index
(`parent-index: CRAWLER_index.json`); the machine-readable manifest and integrity
hashes live in [`CRAWLER_index.json`](CRAWLER_index.json) (the authority for
ordering and verification — run `doc-graph.py verify CRAWLER_index.json`).

Reassemble the original single document at any time with
`doc-graph.py merge CRAWLER_index.json --out CRAWLER.md`.

| # | Section | Lines | What it covers |
|---|---------|------:|----------------|
| 1 | [`preamble`](CRAWLER_part_01_preamble.md) | 27 | Suite orientation + the pick-your-tool table. |
| 2 | [`crawl.js` — Node crawler](CRAWLER_part_02_crawljs-node-crawler-recommended.md) | 770 | The flagship Node crawler — the primary, recommended tool. Quick start, the full option reference, scope/depth, rate limiting + robots/backoff/auto-resume, document-link scanning, `--recheck-from`/`--rebuild-from`, the headless Playwright second opinion, large-crawl checkpoints + resume, mid-crawl re-tuning, memory tuning, the HTML report, and the allowlist. |
| 3 | [`crawl-gui.hta` — Windows GUI](CRAWLER_part_03_crawl-guihta-windows-gui.md) | 108 | The Windows GUI front-end that builds and launches the `crawl.js` command line; its optional config files. |
| 4 | [`web-crawler.html` — in-browser](CRAWLER_part_04_web-crawlerhtml-in-browser-crawler.md) | 26 | The in-tab crawler variant, no Node install. |
| 5 | [`local-cors-proxy.js`](CRAWLER_part_05_local-cors-proxyjs-proxy-for-the-html-ve.md) | 30 | The zero-dependency CORS proxy for the HTML version. |
| 6 | [Be a responsible crawler](CRAWLER_part_06_be-a-responsible-crawler.md) | 5 | Politeness: honest UA/headers, rate limits, robots. |

**Note on section 2 (`crawl.js`):** at 770 lines it remains above the soft
threshold, kept whole **by deliberate judgment** (rhiz-Merkle §2 — a coherent
how-to reference read largely in sequence gains little from being shredded into
~20 micro-files; it carries its own internal `###` table of contents). This
mirrors Charlotte's own architecture ethos of keeping coherent units whole
(AD-009/14/16 kept the crawl engine intact). Re-split it at `###` level if an
agent finds it unwieldy: `doc-graph.py split CRAWLER_part_02_*.md --split-on 3`.

_Integrity is managed by `doc-graph.py`; never hand-edit the hash fields in the
JSON. After editing any section file, run `doc-graph.py update <section-file>`._
