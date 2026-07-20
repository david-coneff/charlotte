#!/usr/bin/env python3
"""rhiz — run rhizome's pinned tooling against THIS repository.

The executable tooling (rhiz-lint, rhiz-search, doc-graph) lives in the rhizome
repository and ONLY there. This thin bootstrap resolves a rhizome checkout at the
shared **`tools-stable`** channel and forwards a subcommand to the matching tool
with this repo as its target — so every repo runs the ONE canonical version of
the tools, never a copy that can drift apart. The channel moves only when rhizome
blesses a tool revision (a single fast-forward), so the whole ecosystem advances
together. See `rhiz-child-repo-convention.md` §1.1.

This file is itself a stable bootstrap (like `gradlew`/`mvnw`): copy it into a
child repo's `tools/`. It rarely changes; the tools it dispatches to are never
copied. Keep it current with `rhiz self-update` (pulls the canonical bootstrap
from the channel).

Forge-agnostic. Nothing here hardcodes a host beyond a *default* URL:
  $RHIZ_TOOLS_URL  — where rhizome lives (default: the GitHub origin). Point it at
                     a Forgejo/Gitea/self-hosted instance to switch forges; git,
                     the channel branch, and the tools are otherwise identical.
  $RHIZ_TOOLS_REF  — channel/ref to track (default: tools-stable). A SHA here is
                     the escape-hatch for temporarily pinning during a risky bump.
  $RHIZ_TOOLS_PATH — an existing local rhizome checkout (e.g. a sibling clone);
                     used as-is for dev speed. CI's source of truth is the channel.

Resolution order for the rhizome checkout:
  1. $RHIZ_TOOLS_PATH if it points at a real checkout;
  2. a cached clone at <repo>/.rhiz-tools/rhizome, fetched to the channel from
     $RHIZ_TOOLS_URL.

Subcommands (extra args are forwarded to the underlying tool):
  lint [..]        rhiz-lint.py    --root <repo> [..]
  search [..]      rhiz-search.py  --root-repo <repo> [..]   (e.g. `search query "x"`)
  docs             doc-graph.py render-all --root <repo>
  verify <index>   doc-graph.py verify <index>
  maintain         lint + search index + docs + ledger-check  (the mechanical loop, no LLM)
  report           rhiz-maintain.py --report — classify findings auto vs judgment
  govern [--write] audit which repo-specific tool-types apply to THIS repo (build/defer/decline)
  census [--show B] monolith-growth census — nag rhiz-partition on oversized source (DS-016)
  docsync [--record] bilateral code↔doc / prose↔prose drift — nag reconciliation (names which side moved)
  codesync [--record] code↔code behavioral drift — body changed, signature same; review the callers
  doc-coverage [--show orphan|--bootstrap] code↔prose coverage census — which modules lack prose (DS-016)
  usage index|query <sym>  static usage catalog — who references a scanned module's public symbols, and how
  classify [--review-all] triage code-sync changes: additive-safe / impacting (+call shapes) / breaking
  impact [--max-distance N]  transitive review cone: who a change reaches, incl. indirect callers
  equiv            differential old-vs-new execution of drifted pure fns — flags BEHAVIOR-DIVERGES (opt-in)
  apidiff OLD NEW sym  declarative surface-delta rules (additive/impacting/breaking, named)
  xref [--fix]     auto-link bare "§N" section cross-refs to their #anchor (resolves the xref-links lint)
  howto [topic]    print a fixed procedure + its version hash (records it in the ledger)
  ledger           diff the load-ledger vs current reference hashes (stale-and-loaded units)
  ledger record U  stamp a unit (howto:<topic> | section:<relpath>) as loaded at its hash
  restore          post-compaction surface: stale refs to re-read + prior un-losables note
  trace [..]       rhiz-Trace: build a ready-to-open instrumented copy of THIS
                   repo's built HTML deliverable (probe / --ast / --data). Reads
                   a `.rhiz-trace.json` adapter at the repo root. Needs node.
  update           refresh the cached rhizome checkout only
  self-update      overwrite this bootstrap with the channel's canonical copy
  channel          print the channel/ref this repo tracks (drift-guard reads this)
  where            print the resolved rhizome checkout path + forge URL
"""
import os
import shutil
import subprocess
import sys
from pathlib import Path

CHANNEL_DEFAULT = "tools-stable"
RHIZOME_URL_DEFAULT = "https://github.com/david-coneff/rhizome.git"


def repo_root() -> Path:
    try:
        top = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return Path(top)
    except Exception:
        return Path.cwd()


def channel() -> str:
    return os.environ.get("RHIZ_TOOLS_REF", CHANNEL_DEFAULT)


def tools_url() -> str:
    return os.environ.get("RHIZ_TOOLS_URL", RHIZOME_URL_DEFAULT)


def resolve_rhizome(root: Path) -> Path:
    local = os.environ.get("RHIZ_TOOLS_PATH")
    if local and (Path(local) / "tools" / "rhiz-lint.py").exists():
        return Path(local).resolve()
    cache = root / ".rhiz-tools" / "rhizome"
    ref = channel()
    if not (cache / ".git").exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", ref, tools_url(), str(cache)],
            check=True,
        )
    else:
        subprocess.run(["git", "-C", str(cache), "fetch", "--depth", "1", "origin", ref], check=True)
        subprocess.run(["git", "-C", str(cache), "checkout", "-q", "FETCH_HEAD"], check=True)
    return cache


def _run(args) -> int:
    print("+ " + " ".join(str(a) for a in args), file=sys.stderr)
    return subprocess.run(args).returncode


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    sub, rest = sys.argv[1], sys.argv[2:]
    root = repo_root()

    if sub == "channel":
        print(channel())
        return 0

    R = resolve_rhizome(root)
    py = sys.executable or "python3"
    lint = str(R / "tools" / "rhiz-lint.py")
    search = str(R / "tools" / "rhiz-search.py")
    distill = str(R / "tools" / "rhiz-distill.py")
    dg = str(R / "protocol" / "modules" / "rhiz-merkle" / "tools" / "doc-graph.py")

    if sub == "where":
        print(f"rhizome: {R}\nforge:   {tools_url()}\nchannel: {channel()}")
        return 0
    if sub == "update":
        return 0  # resolve_rhizome already refreshed the cache
    if sub == "self-update":
        src, dst = R / "tools" / "rhiz.py", root / "tools" / "rhiz.py"
        if src.resolve() == dst.resolve():
            print("self-update skipped: this IS the canonical bootstrap")
            return 0
        shutil.copyfile(src, dst)
        print(f"updated {dst} from {R} @ {channel()}")
        return 0
    if sub == "lint":
        rc = _run([py, lint, "--root", str(root), *rest])
        local = root / "tools" / "lint-local.py"
        if local.exists():
            rc |= _run([py, str(local)])   # repo-local extension (e.g. code-growth census)
        return rc
    if sub == "search":
        return _run([py, search, "--root-repo", str(root), *rest])
    if sub == "docs":
        return _run([py, dg, "render-all", "--root", str(root), *rest])
    if sub == "verify":
        return _run([py, dg, "verify", *rest])
    if sub == "maintain":
        rc = _run([py, lint, "--root", str(root)])
        local = root / "tools" / "lint-local.py"
        if local.exists():
            rc |= _run([py, str(local)])   # repo-local extension (e.g. code-growth census)
        rc |= _run([py, search, "--root-repo", str(root), "index"])
        rc |= _run([py, dg, "render-all", "--root", str(root)])
        # Load-ledger diff: surface any relied-on unit whose reference moved since
        # this repo's agent loaded it ("re-read these"). INFORMATIONAL — deliberately
        # NOT OR'd into rc, so a stale local ledger never fails the mechanical loop /
        # CI (and a fresh clone / CI has no ledger, so it prints nothing actionable).
        _run([py, distill, "--ledger-check", "--root", str(root)])
        return rc
    if sub == "report":
        return _run([py, str(R / "tools" / "rhiz-maintain.py"), "--report", "--root", str(root), *rest])
    if sub == "govern":
        # Governance-adoption audit: which repo-specific tool-types (parallel-parity,
        # monolith-growth, platform-adapter, port-coverage, …) apply to THIS repo,
        # and are they built / deferred / declined? Re-runnable ANY time (a repo that
        # GAINED a structure shows a new candidate). First run seeds the ledger;
        # `--write` scaffolds/updates `.rhiz-governance.json`. Also prompts an LLM
        # hand-read for structures the heuristic detectors don't cover.
        return _run([py, str(R / "tools" / "rhiz_govern.py"), "--root", str(root), *rest])
    if sub == "census":
        # Monolith-growth census (DS-016): band tracked source by size vs
        # .monolith-baseline.json and nag a rhiz-partition run on over/stale files.
        # The over/stale findings ALSO surface in `rhiz maintain`/`--report` (a
        # shared rhiz-lint check reads the same baseline); this is the staged drill
        # (`census --show over`, `--gate` for CI).
        return _run([py, str(R / "tools" / "rhiz_growth.py"), "--root", str(root), *rest])
    if sub == "docsync":
        # Bilateral code↔doc / prose↔prose drift (doc-sync). Default: report links
        # whose one side moved since last sync (direction named). `--record` re-stamps
        # the explicit `.rhiz-docsync.json` markers after reconciling; `--record-backlinks`
        # re-stamps the per-doc backlink baseline. Drift ALSO surfaces in `rhiz maintain`
        # (a shared rhiz-lint check reads the same manifest/baseline + the backlink graph).
        return _run([py, str(R / "tools" / "rhiz_docsync.py"), "--root", str(root), *rest])
    if sub == "codesync":
        # Code↔code behavioral drift (code-sync). Default: report functions whose
        # body changed since the recorded baseline while the signature stayed the
        # same (the drift the type checker can't see), naming the callers to review.
        # `--record` re-stamps the function baseline after reconciling. Drift ALSO
        # surfaces in `rhiz maintain` (a shared rhiz-lint check reads the same config).
        return _run([py, str(R / "tools" / "rhiz_codesync.py"), "--root", str(root), *rest])
    if sub == "doc-coverage":
        # Code↔prose documentation coverage (doc-coverage, DS-016): band every
        # documentation-worthy source MODULE by whether prose DECLARES coverage (a
        # `documents:` marker). Default prints the census; `--show orphan` drills the
        # undocumented; `--bootstrap` writes the to-write stub queue for inherited code;
        # `--gate` for CI. Orphans ALSO surface in `rhiz maintain` (the 061 lint check).
        return _run([py, str(R / "tools" / "rhiz_doccoverage.py"), "--root", str(root), *rest])
    if sub == "usage":
        # Static usage catalog (stage 1 of the code-usage classifier): `rhiz usage index`
        # (re)builds the gitignored `.rhiz-usage-catalog.json` — for each scanned module's
        # public symbols, who references them and HOW (call shape). `rhiz usage query <sym>`
        # shows a symbol's catalogued call sites. Also refreshed by `rhiz maintain --fix`.
        return _run([py, str(R / "tools" / "rhiz_usage.py"), "--root", str(root), *rest])
    if sub == "classify":
        # Stage-2 code-usage classifier: read the code-sync scan + the usage catalog and
        # triage each change into ADDITIVE (new zero-reference symbol / signature-changed-but-
        # body-identical → affirmatively safe, no review), IMPACTING (body drift with callers,
        # each annotated with its catalogued call shape), or BREAKING (removed-with-callers).
        # A precision layer over CODE-POISON that only ever REMOVES review items under a
        # provable condition. `--review-all` / `--audit` (or RHIZ_CODESYNC_REVIEW_ALL=1)
        # suppress the additive prune; `--json` for machine consumption; `--gate` for CI.
        return _run([py, str(R / "tools" / "rhiz_classify.py"), "--root", str(root), *rest])
    if sub == "impact":
        # Transitive impact closure (RTS-style): reverse-reachability BFS over the code-sync
        # call graph from the changed symbols, using the classifier's proof to PRUNE and STOP
        # propagation on provably-unaffected edges. Closes code-sync's one-hop soundness gap
        # (indirect callers a body change reaches through an unchanged intermediary).
        # `--max-distance N` caps the cone (drops logged); `--json` for machine use.
        return _run([py, str(R / "tools" / "rhiz_impact.py"), "--root", str(root), *rest])
    if sub == "equiv":
        # Bounded differential-execution regression verification (attention-adder, opt-in,
        # NOT in the vendored gate): run each drifted PURE function's old vs new version on
        # generated old-shape inputs in a sandboxed subprocess and flag BEHAVIOR-DIVERGES with
        # a witness. Only ever raises review; never prunes (bounded inputs don't prove equivalence).
        return _run([py, str(R / "tools" / "rhiz_equiv.py"), "--root", str(root), *rest])
    if sub == "apidiff":
        # Declarative surface-diff rule catalog (cargo-semver-checks style): classify a
        # function's OLD→NEW signature delta into named additive/impacting/breaking findings
        # over a language-neutral Signature IR. Catches breaking deltas the body hash misses
        # (reordered positional param, removed/made-required param). Usage: apidiff OLD NEW sym.
        return _run([py, str(R / "tools" / "rhiz_apidiff.py"), *rest])
    if sub == "xref":
        # Section cross-reference auto-linker: mechanically resolve bare "§N" refs
        # (the ones the 049 xref-links lint flags) to their target #anchor — a
        # GitHub slug of the heading, intra-doc or a doc named on the same line.
        # `--fix` writes; default prints the plan. Links only an UNAMBIGUOUS single
        # match; ranges / unresolved aliases are reported for a human, never guessed.
        return _run([py, str(R / "tools" / "rhiz_xref.py"), "--root", str(root), *rest])
    if sub == "howto":
        # Print a fixed maintenance procedure + its version hash on demand. The
        # distillation nudge injects only `rhiz howto <topic>` + the hash, so this
        # is how an agent pulls the full steps into context when its own copy is
        # missing or the hash says it's stale. Lives in the distill sensor so the
        # nudge and this command hash the SAME body and always agree.
        return _run([py, str(R / "tools" / "rhiz-distill.py"), "--howto", *(rest or [""]), "--root", str(root)])
    if sub == "ledger":
        # `rhiz ledger`            → diff the load-ledger vs current reference hashes
        # `rhiz ledger record UNIT`→ stamp a unit (howto:<topic> | section:<relpath>)
        if rest and rest[0] == "record":
            return _run([py, distill, "--ledger-record", *rest[1:], "--root", str(root)])
        return _run([py, distill, "--ledger-check", "--root", str(root), *rest])
    if sub == "restore":
        # Post-compaction / resume: re-inject the targeted residue — stale loaded
        # refs to re-read + the prior session-cache un-losables note.
        return _run([py, distill, "--restore", "--root", str(root), *rest])
    if sub == "trace":
        node = shutil.which("node")
        if not node:
            print("rhiz trace needs node on PATH (the tracer tools are Node .mjs).", file=sys.stderr)
            return 2
        tb = R / "protocol" / "modules" / "rhiz-trace" / "tools" / "trace-build.mjs"
        return _run([node, str(tb), "--repo", str(root), *rest])

    print(f"unknown subcommand: {sub}\n{__doc__}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
