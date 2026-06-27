# Candidate universal principles — for promotion into `david-coneff/rhizome` core

**What this is.** A self-contained package of development principles **extracted from the Charlotte
project** that appear *universal* (not Charlotte-specific) and may belong in the Rhizome protocol's
core guidance (`david-coneff/rhizome` — out of scope for the session that wrote this). Each principle
is **earned**: it traces to a concrete success or failure here, cited so a reviewer can verify it's
real rather than aspirational. The project-specific form of each already lives in
`state/SYNTHESIS.md` §4 (what worked) / §5 (hard-won lessons) and the cited ADRs.

**How to consume it.** In a session that has `david-coneff/rhizome` in scope: read each candidate,
decide whether it generalizes beyond Charlotte, and if so fold it into the appropriate core module
(a development-discipline / engineering-practices doc), keeping or dropping the Charlotte evidence as
the core's style dictates. Some of these likely already exist in core in some form — **merge, don't
duplicate.** Delete this file from Charlotte once promoted (or leave a one-line "promoted on <date>").

---

## The candidates

1. **Verify the emitted artifact, not the source.** When code *generates* code — templates,
   string-embedded scripts, codegen — compiling or importing the SOURCE does not validate the
   OUTPUT. Parse and/or grep the emitted artifact.
   *Evidence:* `require()` of Charlotte's module passed while the embedded template string held an
   unbalanced brace (inner-IIFE), a `\s` regex silently cooked to `s`, and a stray `${}` — each only
   surfaced when a test sliced+eval'd the emitted script. (SYNTHESIS §5 #7/#21/#23/#24.)

2. **Stubs prove unit logic; only the real environment proves integration.** Synthetic event
   dispatch and DOM/API stubs pass while the real runtime fails (native controls eating clicks,
   cross-origin throws, popup blocking, async ordering). For click-paths, cross-window, and async
   behavior, add a real-environment test.
   *Evidence:* a `<summary>` ate real checkbox clicks and a cross-origin `location` access threw —
   both invisible to stubs, both caught only by headless dispatched-`MouseEvent` + dump-DOM tests.
   (§5 #1/#3/#6; §4 "headless real-click testing".)

3. **A number shown to a user must come from the computation that drives the behavior.** Two code
   paths that "count the same thing" differently WILL diverge, and a careful user WILL notice.
   Single-source the count; surface what's excluded.
   *Evidence:* a subtitle summed two category counts (551) while an export counted the distinct union
   (512); the operator spotted the 39-gap. Fixed by deriving both from one function and reporting the
   skipped remainder. (§5 #26; AD-074.)

4. **Reproduce before fixing; then encode the property as an invariant.** A reported bug may be a
   stale artifact or environment quirk — measure first. When the code is already correct, harden the
   guard so the property can't silently regress, rather than declaring "works for me."
   *Evidence:* "the reused window isn't applied to the External tab" — an audit found 25/25 anchors
   already routed through one interceptor (a stale file); the fix was to broaden the interceptor to
   *any* link so consistency became an invariant. (§5 #27; AD-075.)

5. **Put cross-cutting behavior at the chokepoint.** Timestamps, sanitization, validation, auth —
   implement them once at the function every path funnels through, not per caller. One edit, uniform
   behavior, no drift.
   *Evidence:* stamping the export filename inside the single `saveBlob` covered the picker, the
   download fallback, and every caller at once. (AD-070.)

6. **Prefer additive over destructive; on a course-reversal, revert-and-reapply.** "Replace X with Y"
   often means "add Y." When the ask genuinely flips, `git checkout` the committed baseline and
   reapply only the wanted change — one clean diff beats hand-unwinding several edits into a
   half-reverted state. (Cheap precisely because the prior step was committed.)
   *Evidence:* an "remove the verdict boxes" → "keep them, just add the bulk box" reversal. (§5 #18.)

7. **Consistency across sibling surfaces is a feature users will demand — port proactively, diverge
   deliberately.** A capability on one surface (report) creates an expectation on its sibling
   (tracker). Port it; where a convention wouldn't fit, diverge *on purpose* and record why.
   *Evidence:* the operator repeatedly asked to bring report features to the tracker (Save-As picker,
   timestamps, "triaged" wording, resizable columns); separately, the tracker's long-URL header was
   deliberately stacked rather than copying the report's single-row header. (AD-069/077; §4 "per-context
   divergence".)

8. **A "reset to default" only works if defaults live in a different layer than overrides.** Express
   resettable defaults in the base layer (class / config / schema); reserve the override layer
   (inline style / runtime value) for live changes; reset = clear the override and fall back.
   *Evidence:* a column-width "reset" cleared inline widths that were ALSO the defaults, collapsing the
   table; fixed by moving defaults to CSS and reserving inline for the live drag. (§5 #22.)

9. **Shared code has preconditions — check gating AND scope before reusing.** "Just reuse it" silently
   no-ops if the shared routine early-returns on a condition you don't meet, or its selectors/queries
   don't see your nodes.
   *Evidence:* a drag-resize routine bailed on `if(!querySelector('tr[data-url]'))` and only selected
   two table classes, so reusing it elsewhere did nothing. (§5 #16.)

10. **The fast feedback loop IS the design tool.** Most iteration here was a cheap
    generate → inject probe → inspect (dump-DOM / screenshot) → read loop, one small change at a
    time. Invest in making the loop fast and the iteration *count* stops being a cost.
    *Evidence:* dozens of UI refinements rode a `synthstate → probe → --dump-dom/--screenshot → read`
    cycle. (§4 "iterative UI by screenshot loop".)

11. **Record the trap WITH its code, not just the conclusion.** Pair the broke-vs-worked snippet. A
    principle without the concrete failure is forgettable; the diff is what makes the next person
    avoid it.
    *Evidence:* the most-reused entries in §5 each carry a `// broke … // worked …` pair.

12. **Test infrastructure ages — confirm a "new" failure is actually new.** Before attributing a
    regression to your change, reproduce green→red across the edit (stash / regenerate / re-run);
    and remember each test may build its own fixtures/stubs, so a structural rename has to touch all
    of them.
    *Evidence:* stale `tracker2-test`/`blocked-test` crashes masqueraded as regressions; a panel-id
    rename crashed `revtest` because its DOM stub was separate. (§5 #12/#19/#24.)

---

## Provenance

Extracted 2026-06-27 from Charlotte (`david-coneff/charlotte`) after a long report/tracker workflow
arc (AD-053–077). Charlotte-specific mechanics (the no-backtick/`${}`/backslash/inner-IIFE template
constraint, the satellite `blob:` interstitial, `file://` localStorage fallbacks, HTA/JScript ES3
limits) were deliberately **left out** of this package — they're real lessons but not universal; they
stay in `state/SYNTHESIS.md`. Only the transferable shapes were promoted to candidates here.
