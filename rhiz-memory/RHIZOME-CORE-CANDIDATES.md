# Candidate universal principles — PROMOTED 2026-06-27

**Status: promoted into `david-coneff/rhizome` on 2026-06-27 and retired.** This file
staged 12 transferable principles extracted from Charlotte (AD-078) for promotion into the
Rhizome protocol repo. A session with both repos in scope reviewed them, generalized each,
and folded them into rhizome's **existing** memory structures (merge, don't duplicate) — see
AD-079. This page is kept as the one-line-per-candidate promotion record so the provenance is
traceable from Charlotte; the full, living text now lives in rhizome.

The split principle: a **review lens** (a flaw an auditor looks *for* in a finished artifact)
became a rhiz-Audit pattern; a **working-method discipline** (how to debug / change / iterate /
record while building) became a cross-project design standard.

## Destination map

| # | Principle (short) | Landed in `david-coneff/rhizome` |
|---|---|---|
| 1 | Verify the emitted artifact, not the source | `modules/rhiz-audit/audit-reasoning-patterns.md` — **#41 Source-Not-Artifact Validation** |
| 2 | Stubs prove unit logic; only the real env proves integration | merged into existing **#13 Test/Production Divergence** (added facet + Charlotte example) |
| 3 | A displayed number must come from the computation that drives behavior | **#42 Divergent Parallel Computation** (xref #22 Dual Authority) |
| 4 | Reproduce before fixing; then encode the invariant | `docs/cross-project-design-standards.md` — **DS-003** |
| 5 | Put cross-cutting behavior at the chokepoint | **#43 Scattered Cross-Cutting Concern** (xref #17 Credential Sprawl) |
| 6 | Additive over destructive; revert-and-reapply on a reversal | **DS-004** |
| 7 | Sibling-surface consistency — port proactively, diverge deliberately | **#46 Sibling Surface Drift** |
| 8 | A "reset to default" needs defaults in a different layer than overrides | **#45 Override/Default Layer Collision** |
| 9 | Shared code has preconditions — check gating AND scope before reuse | **#44 Silent Reuse No-Op** |
| 10 | The fast feedback loop IS the design tool | **DS-005** |
| 11 | Record the trap with its code, not just the conclusion | **DS-006** |
| 12 | Test infra ages — confirm a "new" failure is actually new | folded into **DS-003** (a corollary of reproduce-before-fixing) |

The rhiz-Audit catalog count was synced 40→46 (`rhiz-audit.md` §7) in the same revision;
`cross-project-design-standards.md` now lists charlotte alongside broodforge and tessel.

## What was deliberately NOT promoted

Charlotte-specific mechanics — the no-backtick / `${}` / backslash / inner-IIFE template
constraint, the satellite `blob:` interstitial, `file://` localStorage fallbacks, HTA/JScript
ES3 limits — are real lessons but not universal. They stay in
[`state/SYNTHESIS.md`](state/SYNTHESIS.md) §5 and the cited ADRs.

## Provenance

Extracted 2026-06-27 from Charlotte after the report/tracker workflow arc (AD-053–077; staged
in AD-078). Promoted into `david-coneff/rhizome` and retired the same day (AD-079). This record
is retained — rather than deleting the file — so a future Charlotte reader can trace where each
earned principle went without opening the rhizome repo.
