# Consolidating fix-tracker progress with SharePoint + Power Automate

This describes how to run the Charlotte **fix tracker** as a team workflow on a **locked-down**
SharePoint tenant: hand each page-owner a per-page mini-tracker, let them drop their exported JSON
into a shared folder, and have a **Power Automate flow** merge every drop into one consolidated
state that the central tracker reads back — no email round-trips, and no custom code running on
SharePoint.

It pairs with two things already in the tool:

- **🗂 Per-page** (in the tracker toolbar) — batch-exports one scoped mini-tracker per referrer
  page, named after the page address. That is the *distribution* side.
- **`merge-fix-state.js`** (repo root) — the **reference implementation** of the merge the flow
  performs, and a zero-dependency CLI you can run unattended if you'd rather not (or can't) use a
  flow.

---

## Why a flow, not the browser calling SharePoint

On a locked-down tenant the obvious "tracker fetches the folder over REST" approach usually fails:

- **Custom script is disabled** (`DenyAddAndCustomizePages`), so an inline-`<script>` HTML page
  won't *execute* when served from a document library — the supported alternative (SPFx) needs a
  build/deploy pipeline and breaks the single-file design.
- If you host the tracker anywhere *else*, the browser's calls to SharePoint REST are **CORS-blocked**
  and would need a full Azure AD app + MSAL token flow.

A flow sidesteps both: it runs **server-side** (no browser auth, no CORS), and the
"**everyone drops their own file, one consumer merges**" model avoids the multi-writer race you'd
hit if everyone edited one shared file.

---

## The data contract

Every mini-tracker **Export** and the **consolidated** file are the same shape:

```json
{
  "app": "charlotte-fix-tracker",
  "host": "<the crawled site's host, e.g. www.example.com>",
  "v": { "<key>": "<value>", "...": "..." }
}
```

`v` is a flat map of localStorage entries, all under `cwfix:<host>:`. The key families:

| Key | Meaning |
| --- | --- |
| `cwfix:<host>:<page-url>\n<broken-url>` | the **Fixed** flag for that *(page → link)* pair (`"1"`/`""`) |
| `cwfix:<host>:ft:<page-url>\n<broken-url>` | its **Fixed-on** timestamp |
| `cwfix:<host>:vd:<broken-url>` | the link's **Broken/Working** verdict |
| `cwfix:<host>:vt:<broken-url>` | the verdict's **last-tested** timestamp |
| `cwfix:<host>:n:<page-url>` | the page's **note** |

**Merging is just a union of the `v` maps**, with later entries winning on a key collision. Because
each fix is keyed by the exact *(page → link)* pair and every file carries the same `host`, two
owners working different pages produce **disjoint** keys — they never collide. (The only key two
people can both touch is a *shared* broken link's verdict, where "last word wins" is the sensible
rule.)

---

## SharePoint setup

In one document library (say **Fix Tracker**):

- `inbox/` — the drop zone. Give contributors **Add/Contribute** here.
- `archive/` — processed drops are moved here so they aren't merged twice.
- `state.json` — the consolidated state. **Initialize it once by hand** with an empty state so the
  flow always reads an existing file (this removes the first-run special case):

  ```json
  { "app": "charlotte-fix-tracker", "host": "www.example.com", "v": {} }
  ```

---

## The flow

**Trigger — When a file is created (properties only)** in `inbox/`.
In the trigger's **Settings**, turn on **Concurrency Control** and set **Degree of Parallelism = 1**.
This serializes merges so two simultaneous drops can't both read-then-overwrite `state.json` and
lose one update.

**Actions:**

1. **Get file content** — the trigger's file → **Parse JSON** it (call it *incoming*). Use this
   schema (values are all strings):
   ```json
   { "type": "object",
     "properties": {
       "app": { "type": "string" },
       "host": { "type": "string" },
       "v": { "type": "object" } } }
   ```
2. **Condition** — `incoming.app` is equal to `charlotte-fix-tracker` **AND** `incoming.host` is
   equal to your site host. If **No** → move the file to `archive/rejected/` and **Terminate**
   (don't pollute the consolidated state with the wrong site or a non-tracker file).
3. **Get file content** of `state.json` → **Parse JSON** (call it *current*).
4. **Compose — merged `v`:**
   ```
   @union(body('Parse_current')?['v'], body('Parse_incoming')?['v'])
   ```
   `union()` merges two objects and, on a key present in **both**, takes the value from the
   **second** argument — so *incoming* (the newer work) wins. This is exactly
   `merge-fix-state.js`'s per-key "later file wins."
5. **Compose — new state:**
   ```json
   { "app": "charlotte-fix-tracker", "host": "<your host>", "v": <Compose from step 4> }
   ```
6. **Update file content** → write the step-5 object back to `state.json` (same file; with
   parallelism = 1 there's no lost-update window).
7. **Move file** — the incoming drop → `archive/`.
8. *(optional)* **Notify** — email the owner / post to Teams that the consolidated state changed.

### Optional: enforce the namespace guard in the flow too

The tracker already **ignores any key not under `cwfix:<host>:`** when it imports, so a malformed
drop can't inject stray entries. If you also want the *consolidated file itself* to stay clean,
insert a **Filter array** on `incoming.v`'s keys with
`startsWith(item()?['key'], concat('cwfix:', <host>, ':'))` before the union. Skippable — the
tracker guards on its side regardless.

### Optional: newest-by-timestamp instead of last-arrival

The default (last drop the flow processed wins) is almost always right because owners are
page-scoped. If you genuinely need *newest verdict by `vt:` timestamp* to win regardless of
processing order, the plain `union()` isn't enough — do the merge in an **Office Script** or an
**Azure Function** running `merge-fix-state.js`'s logic (extended to compare timestamps), and call
that from the flow.

---

## Getting the consolidated state back to the owner

Pick whichever fits your constraints:

1. **Manual Import (simplest).** The owner downloads `state.json` and clicks **⬆ Import** in the
   central tracker. Done.
2. **No flow at all — multi-file Import.** If Power Automate is *also* restricted, skip the merge
   entirely: the owner opens `inbox/` in Explorer/OneDrive sync, then in the tracker clicks
   **⬆ Import** and **multi-selects every drop file at once**. The tracker merges them client-side
   with the identical union + namespace guard + host check. (This is the pure-`file://` fallback and
   needs nothing but the tracker.)
3. **Baked HTML (most turnkey).** Add a stage that reads a template tracker HTML kept in the library
   and injects the consolidated state as a `<script>window.__CW_TRK_SEED__= … </script>` island
   before `</head>` (a single string `replace`), saving `fix-tracker.html`. Anyone who opens that
   file sees all progress with **no Import step** — it's exactly what the tracker's own
   **💾 Save copy** does, performed by the flow.

---

## Reference & unattended fallback: `merge-fix-state.js`

`merge-fix-state.js` is the executable spec for the union merge and a dependency-free CLI you can
run anywhere Node is available (a scheduled task, an Azure Function, or by hand):

```
node merge-fix-state.js --out state.json inbox/*.json
# or stream to stdout:
node merge-fix-state.js inbox/*.json > state.json
```

Same semantics as the flow: **one host** (first valid file sets it; different-host files skipped),
**namespace-guarded** (only `cwfix:<host>:` keys kept), **later file wins**. It prints a one-line
summary (files merged, entries, anything skipped) to stderr and the consolidated state to the file
or stdout.

---

## Security notes

- Treat drops as **untrusted** (anyone who can write to `inbox/`). The flow validates `app` + `host`;
  the tracker re-validates on Import and applies **only** `cwfix:<host>:` keys. The worst a hostile
  file can do is set fix flags / verdicts **for the same site** — no script runs, and no storage
  outside the namespace is touched.
- Keep `inbox/` contribute-only and `state.json` owned by the flow's identity, so contributors can
  add drops but not rewrite the consolidated truth directly.
