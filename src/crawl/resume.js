"use strict";
// Resume replay (DS-016 split from the crawl engine). Replays an append-only
// journal to rebuild the frontier + results so a crawl continues where it stopped
// instead of restarting. Mutates the passed-in state and reuses the live addRef /
// seen.tryAdd / logLine / journal (J) so the reconstruction matches a fresh crawl.
const { normalize } = require("../netutil.js");

// ---- resume: replay the journal to rebuild the frontier + results, so we
//      continue from where we stopped instead of starting over. Reuses the live
//      addRef / seen.tryAdd so the reconstructed frontier + referrers match. ----
function replayResume(state, cfg, seen, addRef, logLine, J) {
    const doneSet = new Set();            // URLs already terminally processed (skip these)
    const enq = new Map();                // url -> {depth, parent}: everything that entered the frontier
    const vSessions = new Map();          // url -> Set of resume-session indices it was attempted (visited) in
    let session = 0, quarantined = 0;     // poison-URL detection: attempted across >=2 sessions, never completed
    const consider = (target, parentUrl, parentDepth) => {
      addRef(target, parentUrl);
      if (parentDepth < cfg.maxDepth && seen.tryAdd(target) && !enq.has(target)) enq.set(target, { depth: parentDepth + 1, parent: parentUrl });
    };
    let lines = [];
    try { lines = fs.readFileSync(cfg.resume, "utf8").split(/\r?\n/); } catch { /* no journal yet — resume behaves like a fresh crawl */ }
    let meta = null, replayed = 0, rGood = 0;   // rGood = HTML pages replayed (GUI "Good" = OK lines)
    for (const ln of lines) {
      if (!ln) continue;
      let e; try { e = JSON.parse(ln); } catch { continue; }
      if (e.t === "meta") { if (!meta) meta = e; continue; }
      if (e.t === "r") { session++; continue; }                                // resume boundary marker
      if (e.t === "v") { let s = vSessions.get(e.u); if (!s) { s = new Set(); vSessions.set(e.u, s); } s.add(session); continue; }
      if (e.t !== "p" && e.t !== "k" && e.t !== "e" && e.t !== "b") continue;  // unknown: ignored here
      if (doneSet.has(e.u)) continue;     // idempotent: a URL completes at most once
      doneSet.add(e.u);
      replayed++;
      if (e.t === "p") {
        rGood++;
        state.pages.push({ url: e.u, title: e.ti, status: e.s, depth: e.d, internal: (e.in || []).length, external: (e.ex || []).length });
        for (const t of (e.in || [])) consider(t, e.u, e.d);
        for (const pr of (e.ex || [])) { const u = pr[0]; if (!state.external.has(u)) state.external.set(u, { url: u, host: pr[1], status: null }); addRef(u, e.u); }
        for (const u of (e.oo || [])) { if (!state.outOfScope.has(u)) state.outOfScope.set(u, { url: u }); addRef(u, e.u); }
      } else if (e.t === "k") {
        state.pages.push({ url: e.u, title: "(non-HTML: " + (e.ct || "?") + ")", status: e.s, depth: e.d, internal: 0, external: 0 });
      } else if (e.t === "e") {
        state.errors.push({ url: e.u, reason: e.r, source: e.src, kind: e.k || "internal" });
      } else {
        state.blocked.push({ url: e.u, reason: e.r, source: e.src, kind: e.k || "internal" });
      }
    }
    if (meta && meta.startUrl && meta.startUrl !== cfg.startUrl) console.log(`Note: resume journal was for ${meta.startUrl}; now crawling ${cfg.startUrl}.`);
    // Frontier = everything that entered the queue but never completed.
    state.queue = [];
    for (const [u, info] of enq) {
      if (doneSet.has(u)) continue;
      const sess = vSessions.get(u);
      if (sess && sess.size >= 2) {   // attempted in >=2 separate sessions, never completed: a page that crashes the crawler
        state.blocked.push({ url: u, reason: `quarantined — aborted the crawler ${sess.size}× without completing (likely a page that crashes it)`, source: info.parent, kind: "internal" });
        quarantined++;
        continue;
      }
      state.queue.push({ url: u, depth: info.depth, parent: info.parent });
    }
    // If the start URL was never reached (empty/partial journal), make sure it runs.
    const su = normalize(cfg.startUrl);
    if (!doneSet.has(su) && !enq.has(su)) state.queue.unshift({ url: su, depth: 0, parent: "(start)" });
    state.crawled = doneSet.size;
    // Tell the GUI's live counters what was already done — it tails a FRESH progress log on
    // resume (the replayed pages aren't re-logged), so without this its Crawled/Good/Broken/
    // Blocked tallies would restart at 0 (External already survives via the absolute extTotal=).
    // The GUI ADDS these to its counters, so multi-site resumes accumulate correctly.
    if (replayed > 0) logLine(`# resume-stats crawled=${state.crawled} good=${rGood} broken=${state.errors.length} blocked=${state.blocked.length} external=${state.external.size}`);
    J({ t: "r", at: new Date().toISOString() });   // mark this resume in the journal
    console.log(`Resumed from ${cfg.resume}: ${replayed} already done, ${state.queue.length} queued${quarantined ? `, ${quarantined} quarantined (crashing page${quarantined === 1 ? "" : "s"})` : ""}.`);
}

module.exports = { replayResume };
