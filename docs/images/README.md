# Documentation screenshots

Every image here is a real render of the shipped tools — the report and fix-tracker shots are
`crawl.js`'s own HTML output, captured in a browser after clicking through the triage the
caption describes.

**The site in the pictures is not real, and neither are its domains.** They were made against
a throwaway demo site — "Example Public Library", ~28 pages with deliberately broken and
blocked links — served on loopback addresses; the hostnames in the captured data were then
rewritten to `www.example.org` (the crawled site) and `catalog.example.net`, `city.example.com`
and `files.example.net` (its off-site links), and the report was regenerated from that JSON
with `crawl.js --rebuild-from`. Those are the documentation domains reserved by
[RFC 2606](https://www.rfc-editor.org/rfc/rfc2606) — IANA holds them permanently and nobody can
register them, so no screenshot here can ever come to depict a real organisation's website as
broken. Use the same reserved names if you add screenshots.

| Image | Shows |
|---|---|
| `gui-settings.png` | `crawl-gui.hta` — the Settings form |
| `gui-running.png` | `crawl-gui.hta` — Run & monitor, mid-crawl (live stats, last-5 URLs, streaming log) |
| `gui-done.png` | `crawl-gui.hta` — the finished state, with Open crawl report enabled |
| `report-overview.png` | The report: headline dashboard, share toolbar, tabs, Internal destinations |
| `report-external.png` | The report: External destinations, grouped by host |
| `report-triage.png` | The report: Broken · internal, mid-triage |
| `report-blocked.png` | The report: Blocked · uncertain |
| `report-dashboard-before.png` / `report-dashboard-after.png` | The headline counts before and after triage |
| `tracker-overview.png` | The exported fix tracker, freshly opened |
| `tracker-progress.png` | The fix tracker part-way through the work |
| `tracker-by-link.png` | The fix tracker's By-broken-link view |
| `tracker-collapsed.png` | The fix tracker collapsed to its folder/domain parents |
| `tracker-bulk.png` | Bulk export: one mini-tracker per referrer page |
| `tracker-mini.png` | A sub-tracker — one page's slice, as its owner receives it |

The two GUI shots are the real `crawl-gui.hta` markup, CSS and JavaScript, but rendered in
Chromium rather than `mshta.exe` (an HTA only runs on Windows), driven by an actual
`crawl-progress.log` from the demo crawl — so the layout, labels and live readouts are the
tool's own, while the window frame and system font are not Windows'.
