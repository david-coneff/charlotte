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
  $RHIZ_ROOT       — the TARGET repo, explicitly. Default is the enclosing git
                     toplevel; outside any repo the bootstrap refuses (no cwd
                     fallback) rather than adopt a non-repo directory as a target.

Between the env vars and the defaults sits the repo's committed binding
(`.rhiz-binding.json` at the target repo's root — the durable protocol pin of
protocol-instance-split R6/principle 4): `protocol_url` / `protocol_ref` /
`protocol_path` supply what the env does not, so pointing a repo at a
`rhizome-protocol[-<id>]` fork is a committed config change, not a code change.
Env still wins (session-scoped override beats the committed pin, deliberately —
that is the draft-testing lever of the promotion lifecycle).

Resolution order for the rhizome checkout:
  1. $RHIZ_TOOLS_PATH if it points at a real checkout;
  2. the binding's `protocol_path` if it points at a real checkout;
  3. a cached clone at <repo>/.rhiz-tools/rhizome, fetched to the channel from
     $RHIZ_TOOLS_URL (else the binding's `protocol_url`) at $RHIZ_TOOLS_REF
     (else the binding's `protocol_ref`).

Subcommands (extra args are forwarded to the underlying tool):
  lint [..]        rhiz-lint.py    --root <repo> [..]
  search [..]      rhiz-search.py  --root-repo <repo> [..]   (e.g. `search query "x"`)
  docs             doc-graph.py render-all --root <repo>
  verify <index>   doc-graph.py verify <index>
  maintain         bare: lint + search index + docs + scope-audit + merkle verify
                   + rollup check + unit suite + ledger-check
                   (the mechanical loop, no LLM — the same gates CI runs, so local green means CI green)
  maintain [..]    with flags: rhiz-maintain.py --root <repo> [..]  (e.g. `maintain --fix`, `--check`)
  report           rhiz-maintain.py --report — classify findings auto vs judgment
  kb-usage [..]    rhiz_kb_usage.py — knowledge-usage ledger: `rollup [--write]` /
                   `verdict --unit U --verdict V --reason R --evidence E` / `report
                   [--misleading]`. Access is producer-logged; verdicts are authored
                   residue. Frequency NEVER feeds search ranking (observer-effect rule)
  govern [--write] audit which repo-specific tool-types apply to THIS repo (build/defer/decline)
  census [--show B] monolith-growth census — nag rhiz-partition on oversized source (DS-016)
  code-census [--check|--stale]  whole-repo CODE census → an "about this repo" artifact committed
                   to rhiz-memory/census/ (structure, module import graph, public surface, hubs,
                   coverage gaps, edge provenance). SEPARATE from drift detection and its narrow
                   curated scan; run on a deliberate beat, never on commit
  docsync [--record] bilateral code↔doc / prose↔prose drift — nag reconciliation (names which side moved)
  codesync [--record] code↔code behavioral drift — body changed, signature same; review the callers
  twin [--gate]    is the byte-identical anchor twin actually identical? (declared exceptions in .rhiz-twin.json)
  doc-coverage [--show orphan|--bootstrap] code↔prose coverage census — which modules lack prose (DS-016)
  partition-note --status|--show P|--record …|--clear S  partition transition guidepost (partition-aware doc re-sync)
  usage index|query <sym>  static usage catalog — who references a scanned module's public symbols, and how
  classify [--review-all] triage code-sync changes: additive-safe / impacting (+call shapes) / breaking
  impact [--max-distance N]  transitive review cone: who a change reaches, incl. indirect callers
  equiv            differential old-vs-new execution of drifted pure fns — flags BEHAVIOR-DIVERGES (opt-in)
  apidiff OLD NEW sym  declarative surface-delta rules (additive/impacting/breaking, named)
  emissions [--latest | --transcript P] [--markers]  audit AD-008 delta emission vs the real
                   transcript: full-once-then-pointers per window, realized/missed savings,
                   fallback-breadcrumb violations
  xref [--fix]     auto-link bare "§N" section cross-refs to their #anchor (resolves the xref-links lint)
  howto [topic]    print a fixed procedure + its version hash (records it in the ledger)
  ledger           diff the load-ledger vs current reference hashes (stale-and-loaded units)
  ledger record U  stamp a unit (howto:<topic> | section:<relpath>) as loaded at its hash
  restore          post-compaction surface: stale refs to re-read + prior un-losables note
  indexed-backfill [--write]  reverse-derive indexed_by from index/manifest membership
                              (plan by default; --write applies additively). Proposer; lint verifies.
  shareability     the blob half of the shareability boundary: a `storage: "notes"` repo
                   must carry no blobs; a `"lfs"` one is exempt. Replaces a 9x-duplicated
                   inline grep. Point it at a MEMORY repo.
  reference-inventory [--against SHA]  Phase 6's completion gate (R21): enumerate + disposition
                   every historical SHA citation and cross-repo coordinate. Exit 2 while any
                   remain un-dispositioned. Does NOT purge or rehearse.
  preflight [--check|--card]  operator-setup preflight: detect silent-unconfigured setup
                              (adapter wired, managed-web Setup script, PreToolUse guard, vendored
                              cache) + surface the fix. --check for CI; hook runs --card at start.
  expectations [--status|--compliance]  behavioral-gate verifier: open expectations this window
                   (--compliance reports the read-mandate full-read RATE from the outcome
                   ledger — overall, by origin, by size band; it is the number the
                   injection design's partial-vs-withheld trade rests on) (checkpoint→
                   bucket-refresh, STALE→re-pull) + read-mandate transcript reconciliation. The
                   adapter ticks it each Stop; `--status` inspects the live registry
  tail-recover     recover the un-bucketed conversation TAIL after a /clear or compaction —
                   what was said AFTER the last checkpoint-bucket refresh (offline, zero
                   tokens). `--status` reports without writing; writes transcripts/<sess>-tail.md
                   and registers it in the read mandate so the fresh window reads it in full
  stream           resolve this checkout's STREAM identity — the durable slug that
                   per-stream buckets, branches and runtime markers are keyed by. NOT the
                   harness session id, which `/clear` changes (EL-215). Defaults to the
                   worktree basename; `--adopt SLUG` pins one that survives a rename or a
                   fresh clone. Reports DOUBLE OCCUPANCY (two sessions in one checkout)
                   rather than blocking it — the operator owns which streams run.
                   `--list` derives the cross-stream view (who has buckets, last touched)
                   from git at READ time — there is no index file that can fall stale
  ignore-parity [--fleet] [--fix|--check]  does this repo's .gitignore cover the `.rhiz/`
                   runtime state the tools actually write? Canonical list = the anchor's own
                   .gitignore; --fix appends what is missing; also names `.rhiz/` files already
                   COMMITTED, which an ignore rule will not untrack
  ci [--record] [--advance-channel]  run the CI gate LOCALLY against a clean clone of a SHA
                   (both workflows' tool steps, siblings included, ~69s) and record the verdict
                   as a git note on that SHA. `--show` reads a recorded verdict back; on PASS,
                   `--advance-channel` fast-forwards tools-stable — the job CI's own
                   advance-channel does. Does NOT reproduce: independence, the weekly floor
  stream-migrate [--attribute]  evidence for adopting a stream in a memory repo older than
                   streams: unadopted / mixed / migrated state from git, which products each
                   past window MOVED, and the exact renames — as commands, never applied.
                   `mixed` means something is STILL writing unkeyed names; find it first
  merge-back [..]  land this stream's branch on the trunk (§5.2): REAL-overlap check vs
                   other streams' unmerged work (git merge-tree), --no-ff merge, the full
                   gates re-run ON the target AFTER the merge, and a push receipt taken
                   from the remote. `--dry-run` reports without merging. Operator-triggered:
                   it never decides to merge, and it never closes the stream
  coord-check      mechanize rehydrate step 2 — parse the anchor's session-checkpoints.md
                   END-SHA table and diff each recorded coordinate against actual local repo
                   state (offline, no network). A report, not a gate: drift is often just
                   "more work happened since," not a bug
  cite-check       the OTHER half of rehydrate step 2 — grade the free-prose SHA citations in
                   each session-cache's BRANCH map, which coord-check deliberately does not
                   parse. Catches a cache that is structurally fresh (rewritten this commit,
                   right section order, under cap) while its branch map names a superseded
                   tree. Offline. `--root-only` narrows the workspace sweep
  reference-capture [--transcript P] [--against R]  flag operator-PASTED reference images
                   not yet committed to any in-scope repo (offline, zero tokens) — persist the
                   reference before the intent is lost to a reset; pixel-parity is the oracle (EL-137)
  trace [..]       rhiz-Trace: build a ready-to-open instrumented copy of THIS
                   repo's built HTML deliverable (probe / --ast / --data). Reads
                   a `.rhiz-trace.json` adapter at the repo root. Needs node.
  setup            FIRST RUN on a machine: fetch the tools cache, arm this repo's
                   hooks (committable form), link the declared slash-commands, print
                   the preflight verdict + what is live now vs next session.
                   Idempotent. Also `/rhiz-setup`.
  link-commands    Link this repo's DECLARED slash-commands into the user-level dir,
                   so they resolve from a workspace root that is not itself a repo.
                   `--check` reports without touching. `setup` calls this; it is
                   also here for re-linking after the repo moves.
  hook <adapter>   HOOK ENTRYPOINT — what a child's committed .claude/settings.json
                   invokes instead of naming a path inside the gitignored cache.
                   This file is TRACKED, so a fresh clone can always reach it; the
                   cached adapter it forwards to is not (EL-152). Self-heals on
                   SessionStart, announces if it cannot, never fails the session.
  update           refresh the cached rhizome checkout only
  self-update      overwrite this bootstrap with the channel's canonical copy
  channel          print the channel/ref this repo tracks (drift-guard reads this)
  where            print the resolved rhizome checkout path + forge URL
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

CHANNEL_DEFAULT = "tools-stable"
# The channel MOVED to rhizome-protocol on 2026-08-13. The tools are executables
# and carry no state of their own, so they belong with the stateless protocol —
# and the rhizome monolith is being retired once the split state is confirmed.
# This is the LAST-RESORT default: it applies only to a repo with neither
# $RHIZ_TOOLS_PATH nor a binding `protocol_url`. Every governed repo now carries a
# binding, so the change is inert for all of them today — which is exactly why it
# was made now rather than later.
#
# The line that used to sit here — "the old rhizome@tools-stable stays published
# until the monolith is archived, so a stale copied shim still resolves" — stopped
# being true when that branch was retired on 2026-08-13 (preserved as the annotated
# tag `legacy-tools-stable`). It was load-bearing for EXISTING CACHES, not for fresh
# clones, and nothing re-pointed them: see `resolve_rhizome`, which now reconciles a
# cache's `origin` against the resolved URL for exactly that reason.
RHIZOME_URL_DEFAULT = "https://github.com/david-coneff/rhizome-protocol.git"
BINDING_NAME = ".rhiz-binding.json"


def read_binding(root) -> dict:
    """The repo's committed outbound pins (`.rhiz-binding.json`) — protocol_url /
    protocol_ref / protocol_path consulted between the env vars and the defaults.
    Fail-open: absent or malformed reads as {} (a warning, never a stop) — a broken
    binding must not take down the bootstrap that would be used to fix it."""
    if root is None:
        return {}
    p = Path(root) / BINDING_NAME
    if not p.is_file():
        return {}
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except Exception as e:
        print(f"rhiz: warning — unreadable {p} ({e}); ignoring the binding", file=sys.stderr)
        return {}


def repo_root() -> Path:
    """The target repo: $RHIZ_ROOT (explicit, on the record) else the enclosing git
    toplevel. NEVER a bare-cwd fallback: from a non-repo cwd (e.g. a multi-repo
    workspace PARENT) the old `Path.cwd()` fallback silently adopted the parent as
    "the repo" — it cloned a stray `.rhiz-tools/` cache there (which then fooled the
    hook adapter's repo resolver), homed access-log rows into a `.rhiz/` no ledger
    reads, and keyed their units with a spurious `<repo>/` path prefix (observed
    2026-08-03). Outside a repo there is no honest target, so say so and name the
    remedy — the failure you can see (EL-141) over the litter you can't."""
    env = os.environ.get("RHIZ_ROOT")
    if env:
        p = Path(env)
        if not p.is_dir():
            print(f"rhiz: RHIZ_ROOT={env} is not a directory", file=sys.stderr)
            sys.exit(2)
        return p.resolve()
    try:
        top = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, check=True,
        ).stdout.strip()
        return Path(top)
    except Exception:
        print(
            "rhiz: not inside a git repository (cwd: "
            f"{Path.cwd()}) — the tools need a target repo.\n"
            "  cd into the repo to operate on, or set RHIZ_ROOT=<path> explicitly.\n"
            "  (No cwd fallback: adopting a non-repo directory scatters .rhiz-tools/ "
            "caches and mis-homes per-repo ledger state.)",
            file=sys.stderr,
        )
        sys.exit(2)


def channel(root=None) -> str:
    env = os.environ.get("RHIZ_TOOLS_REF")
    if env:
        return env
    return read_binding(root).get("protocol_ref") or CHANNEL_DEFAULT


def tools_url(root=None) -> str:
    env = os.environ.get("RHIZ_TOOLS_URL")
    if env:
        return env
    return read_binding(root).get("protocol_url") or RHIZOME_URL_DEFAULT


def resolve_rhizome(root: Path) -> Path:
    local = os.environ.get("RHIZ_TOOLS_PATH")
    if local and (Path(local) / "tools" / "rhiz-lint.py").exists():
        return Path(local).resolve()
    bound = read_binding(root).get("protocol_path")
    if bound:
        # A relative protocol_path is repo-root-relative (portable across machines,
        # the sibling-checkout layout); validated like $RHIZ_TOOLS_PATH — a binding
        # that points at nothing falls through to the channel clone.
        bp = (root / bound) if not Path(bound).is_absolute() else Path(bound)
        if (bp / "tools" / "rhiz-lint.py").exists():
            return bp.resolve()
    # rhizome-protocol itself carries no binding (nothing to bind to but itself), so
    # without this check it fell all the way through to a channel-pinned clone of its
    # OWN repo — silently serving `tools-stable`'s lagged tools even when invoked from
    # inside the very tree that just edited them. Same marker check as the two cases
    # above, applied to `root` itself: a child never carries `tools/rhiz-lint.py`
    # natively ("reference, don't copy" — rhiz-child-repo-convention.md §1), so this
    # only ever fires for the source repo.
    if (root / "tools" / "rhiz-lint.py").exists():
        return root.resolve()
    cache = root / ".rhiz-tools" / "rhizome"
    ref = channel(root)
    if not (cache / ".git").exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", ref, tools_url(root), str(cache)],
            check=True,
        )
    else:
        # The cache's `origin` is DERIVED from the resolved URL, so it has to be
        # reconciled rather than trusted. A cache cloned before the channel moved
        # repos keeps fetching the repo it was cloned from forever — and once the
        # old channel is retired that fetch fails hard, so a checkout that worked
        # for months breaks on a ref it never names. Re-point on disagreement; the
        # resolved URL wins, because it is what every other path here already obeys.
        want = tools_url(root)
        have = subprocess.run(
            ["git", "-C", str(cache), "remote", "get-url", "origin"],
            capture_output=True, text=True,
        ).stdout.strip()
        if have and have != want:
            print(
                f"rhiz: cache origin moved — re-pointing {have} → {want}",
                file=sys.stderr,
            )
            subprocess.run(
                ["git", "-C", str(cache), "remote", "set-url", "origin", want], check=True
            )
        subprocess.run(["git", "-C", str(cache), "fetch", "--depth", "1", "origin", ref], check=True)
        subprocess.run(["git", "-C", str(cache), "checkout", "-q", "FETCH_HEAD"], check=True)
    return cache


def _run(args) -> int:
    print("+ " + " ".join(str(a) for a in args), file=sys.stderr)
    return subprocess.run(args).returncode


_VERIFY_SKIP = (".rhiz-tools", ".git", "node_modules", "dist", "build")


def _verify_partitions(py: str, dg: str, root: Path) -> int:
    """Merkle-verify every doc-graph partition under `root`. 0 if all pass.

    Duplicates the loop the `rhiz-maintain` workflow has run for months, so that the
    LOCAL command checks what CI checks. The workflow's filter is the meaningful part
    and is reproduced exactly: a `*_index.json` counts as a partition only if it has a
    `sections` key — other tools use the same suffix for unrelated manifests, and
    handing one to `doc-graph verify` is a crash, not a finding.

    PRODUCT-LOCAL by construction, like rhiz-lint: this walks `root` and cannot reach a
    sibling memory repo. That is a real limit, not an oversight, and it is why the
    32 stale hashes in `aether-memory` were invisible to `aether`'s own maintain — a
    memory sibling is verified by a step in the PRODUCT's pipeline that names it, the
    same way its lint and scope-audit already are.

    Reports the DENOMINATOR (EL-124/EL-164): "no partitions here" and "every partition
    verified" are different answers and must not print the same."""
    idxs = []
    for p in sorted(Path(root).rglob("*_index.json")):
        if any(part in _VERIFY_SKIP for part in p.parts):
            continue
        try:
            if "sections" in json.loads(p.read_text(encoding="utf-8")):
                idxs.append(p)
        except (OSError, json.JSONDecodeError, TypeError):
            continue        # not a partition manifest; the workflow skips these too
    if not idxs:
        print("⟐ doc-graph verify: no partitions under this root — nothing to check "
              "(not the same as a clean verify).", file=sys.stderr)
        return 0
    rc = 0
    for p in idxs:
        rc |= _run([py, dg, "verify", str(p)])
    if rc == 0:
        print(f"⟐ doc-graph verify: {len(idxs)} partition(s) verified.", file=sys.stderr)
    return rc


def _check_rollups(py: str, root: Path) -> int:
    """`build-rollup --check` — do the committed single-file tools still match the
    `src/` fragments they are built from? 0 when they do, or when this repo builds none.

    PRESENCE-GATED on the builder itself, not on a repo name. EL-106's rule (1) says to
    gate a detector on a signal every governed repo carries — that rule does not apply
    here, because the capability genuinely is not universal: only the two protocol twins
    carry `tools/build-rollup.py`, and a child running the same mechanical loop has no
    fragments to roll up. What DOES apply is EL-124: report the DENOMINATOR, because
    "this repo builds no rollups" and "every rollup matches its fragments" are different
    answers and must not print the same thing.

    The cheap half of D7, and it runs before the suite deliberately: measured 2026-08-17
    at 5.12s against 5.15s for the bare loop — inside the noise floor — so ordering the
    cheap gate first costs nothing and means a one-second failure is never masked by a
    long suite behind it."""
    br = root / "tools" / "build-rollup.py"
    if not br.is_file():
        print("⟐ build-rollup: no rollup builder in this repo — nothing to check "
              "(not the same as a clean check).", file=sys.stderr)
        return 0
    return _run([py, str(br), "--check"])


def _run_unit_suite(py: str, root: Path) -> int:
    """The repo's own unit suite via `unittest discover`. 0 when green, or when absent.

    Closes the last leg of the local/CI asymmetry the scope-audit and Merkle steps above
    were added for — and the widest one: **the anchor ran no unit suite in CI at all**,
    so the suite was neither a local gate nor a remote one. A tool change could go green
    everywhere it was checked and still be untested.

    Discovery is BY FILE (`test_*.py` under `tools/`) with an ABSOLUTE `-s`, so the loop
    behaves the same from any cwd — verified from `/tmp`, not assumed. This is also the
    reason the size census keeps those modules whole: `unittest discover` addresses a
    test module by path, so splitting one trades a readable file for two that must
    always be found together.

    Presence-gated and denominator-reporting for the same reason as the rollup check:
    every governed child carries zero `test_*.py`, and in a repo with no tests a silent
    skip is indistinguishable from a pass."""
    tools_dir = root / "tools"
    if not tools_dir.is_dir() or not any(tools_dir.glob("test_*.py")):
        print("⟐ unit suite: no `tools/test_*.py` in this repo — nothing to run "
              "(not the same as a green suite).", file=sys.stderr)
        return 0
    return _run([py, "-m", "unittest", "discover", "-s", str(tools_dir), "-q"])


# ------------------------------------------------------------------ hook entrypoint

# Every adapter `arm-hooks.HOOKS` can arm must be dispatchable here, or a governed
# CHILD arms a command this entrypoint then refuses. The two lists are hand-kept in
# two files and drifted exactly as that arrangement predicts: `generated-write-guard`
# and `subagent-durability` were armable and NOT dispatchable, so in every governed
# child the write-guard was wired to a command that answered "unknown adapter" and
# exited 0 — armed, reported armed, and a no-op. Found 2026-09-01, the same defect
# class as the audit that found it, one level up.
#
# Not derived from the registry by import ON PURPOSE: this bootstrap's job is to FIND
# a rhizome checkout, so it cannot depend on having found one. The agreement is held by
# a test instead (`test_rhiz.py::HookAdapters`), which is the honest way to keep two
# lists in step when one of them cannot import the other.
HOOK_ADAPTERS = ("distill-nudge", "census-nudge", "sync-nudge", "rollup-read-guard",
                 "generated-write-guard", "subagent-durability")
HOOK_REL = Path("protocol") / "hooks" / "claude-code"


def _bootstrap_repo() -> Path:
    """The repo this bootstrap is committed in — `<repo>/tools/rhiz.py`, so parents[1].

    Deliberately NOT `repo_root()`. A hook fires with whatever cwd the harness chose,
    and `repo_root()` answers from cwd; but the whole point of this entrypoint is that
    the file's own location IS the answer, and it is the one fact that cannot be wrong.
    """
    return Path(__file__).resolve().parents[1]


def _hook_card(text: str) -> None:
    """Emit SessionStart additionalContext. The schema is the adapter's own; kept in
    step with distill_nudge/85_event_session_start.py."""
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "SessionStart", "additionalContext": text}}))


def cmd_hook(rest: list[str]) -> int:
    """Forward a Claude Code hook firing to the cached adapter, healing the cache first
    if this is a fresh clone.

    WHY THIS EXISTS (EL-152, second half). A child's committed `.claude/settings.json`
    used to name `$CLAUDE_PROJECT_DIR/.rhiz-tools/rhizome/protocol/hooks/…` directly.
    `.rhiz-tools/` is gitignored, so on a STANDALONE fresh clone that path does not
    exist and `python3` dies with `can't open file` before one line of rhizome code
    runs — which means `announce_missing_cache`, the thing built to report exactly this
    situation, is itself inside the file that is missing and can never fire. The
    original fix was measured on a multi-repo WORKSPACE, whose root settings.json holds
    absolute paths into a real rhizome checkout; there the adapter does run and does
    announce. The standalone clone — one repo, `git clone && claude` — was the layout
    nobody had a live case of, and it was silent.

    So the hook entrypoint has to be a file the clone CARRIES. That is this bootstrap:
    tracked in every governed child, and already the discriminator the announce path
    uses to decide a repo is governed at all.

    Three paths, in cost order:
      cache present  -> exec the adapter. No network, no stdin read, one interpreter
                        start. This is every firing after the first.
      cold, SessionStart -> fetch the cache (~2s), then run the adapter with the
                        payload. The session is governed from its first message, with
                        no operator step at all — EL-152's own "self-healing is better".
      cold, anything else -> exit 0 in silence. SessionStart owns the announcement;
                        nagging on every PostToolUse would be the overloaded-signal
                        mistake in the other direction.

    It NEVER exits non-zero. A hook that fails is worse than one that no-ops: it puts
    an error in front of the operator for a condition they did not cause and cannot
    read, on every single tool call.
    """
    if not rest:
        print("rhiz hook: name an adapter — one of " + ", ".join(HOOK_ADAPTERS),
              file=sys.stderr)
        return 0
    name = rest[0]
    if name not in HOOK_ADAPTERS:
        print(f"rhiz hook: unknown adapter {name!r}", file=sys.stderr)
        return 0

    root = _bootstrap_repo()
    py = sys.executable or "python3"
    adapter = root / ".rhiz-tools" / "rhizome" / HOOK_REL / f"{name}.py"

    # FAST PATH — do not touch stdin, do not touch the network. execv replaces this
    # process, so the adapter inherits the payload on fd 0 exactly as the harness sent
    # it and there is no second copy of anything.
    if adapter.is_file():
        try:
            os.execv(py, [py, str(adapter), *rest[1:]])
        except OSError:
            return subprocess.run([py, str(adapter), *rest[1:]]).returncode

    # COLD PATH — the cache is absent. Read the payload to learn which event this is;
    # only SessionStart is worth healing or reporting on.
    raw = ""
    try:
        raw = sys.stdin.read()
    except Exception:                                       # noqa: BLE001
        pass
    event = ""
    try:
        event = (json.loads(raw) or {}).get("hook_event_name", "")
    except Exception:                                       # noqa: BLE001
        pass
    if event != "SessionStart":
        return 0

    try:
        resolve_rhizome(root)
    except Exception:                                       # noqa: BLE001 — offline is a
        pass                                                # real state, not an error
    if adapter.is_file():
        try:
            return subprocess.run([py, str(adapter), *rest[1:]],
                                  input=raw, text=True).returncode
        except Exception as e:                               # noqa: BLE001
            # FIX (fails-toward-OK sweep #21): a launch failure HERE means the adapter
            # was found (unlike the fallthrough below, which fires when it was not) but
            # could not actually run — a bad interpreter, permission denied, a crash
            # before it could produce output. Returning 0 silently is exactly the outage
            # the "ARMED BUT DORMANT" card two dozen lines down exists to announce; this
            # branch used to skip it entirely because it returns before reaching that
            # code. A distinct card, since the cause here is different (resolved but
            # unlaunchable, not unresolved).
            _hook_card(
                "⟐ rhizome governance is ARMED BUT DORMANT in this repo — the cached "
                "adapter is present but FAILED TO LAUNCH just now.\n"
                f"  {adapter} exists, but invoking it raised {e!r}.\n"
                "  Until this is fixed, NOTHING in the context lifecycle is running: no "
                "distillation checkpoint, no state-bucket rehydration, no read mandate, "
                "no drift sensors. That is a silent absence, which is why this card "
                "exists.\n"
                "  Check the interpreter and the adapter's permissions, or re-resolve "
                "with:  python3 tools/rhiz.py setup")
            return 0

    # Could not heal — self-announcing is the floor. Name the one command, and say what
    # is NOT happening, because the failure mode this replaces was indistinguishable
    # from a repo that simply has no governance.
    _hook_card(
        "⟐ rhizome governance is ARMED BUT DORMANT in this repo — and could not "
        "self-heal just now.\n"
        f"  The hooks resolve their tooling from `{root.name}/.rhiz-tools/rhizome`, which is "
        "gitignored (it is a cache, not source), so a fresh clone has none. Fetching it "
        "failed — usually no network, or the forge is unreachable.\n"
        "  Until it succeeds, NOTHING in the context lifecycle is running: no "
        "distillation checkpoint, no state-bucket rehydration, no read mandate, no "
        "drift sensors. That is a silent absence, which is why this card exists.\n"
        f"  Fix it with one command, from this repo:  python3 tools/rhiz.py setup\n"
        "  (Offline? point $RHIZ_TOOLS_PATH at any local rhizome checkout instead.)")
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    sub, rest = sys.argv[1], sys.argv[2:]

    if sub == "channel":
        # Soft root discovery: in a repo, the committed binding's protocol_ref counts
        # (the drift-guard must see a pinned ref); outside one, env→default as before —
        # this subcommand never refuses for want of a target.
        try:
            soft = Path(subprocess.run(
                ["git", "rev-parse", "--show-toplevel"],
                capture_output=True, text=True, check=True,
            ).stdout.strip())
        except Exception:
            soft = None
        print(channel(soft))
        return 0
    if sub == "hook":
        # BEFORE resolve_rhizome, deliberately. That call fetches the channel on every
        # invocation, and this entrypoint runs on PostToolUse — i.e. after every Bash
        # command. Routing hooks through the generic path would put a git fetch in the
        # inner loop of the session.
        return cmd_hook(rest)

    root = repo_root()
    R = resolve_rhizome(root)
    py = sys.executable or "python3"
    lint = str(R / "tools" / "rhiz-lint.py")
    search = str(R / "tools" / "rhiz-search.py")
    distill = str(R / "tools" / "rhiz-distill.py")
    dg = str(R / "protocol" / "modules" / "rhiz-merkle" / "tools" / "doc-graph.py")

    if sub == "where":
        print(f"rhizome: {R}\nforge:   {tools_url(root)}\nchannel: {channel(root)}")
        return 0
    if sub == "update":
        return 0  # resolve_rhizome already refreshed the cache
    if sub == "setup":
        # FIRST-RUN wiring: arm this machine's hooks and say what is live now vs next
        # session. Reaching this line has ALREADY done the half that matters most —
        # resolve_rhizome() above fetches the vendored cache, which is what a fresh
        # clone lacks and what the hooks resolve on every firing. The tool then arms a
        # committable settings.json and prints the preflight verdict.
        setup = R / "tools" / "rhiz_setup.py"
        if not setup.is_file():
            print(f"rhiz setup: not in this channel snapshot ({channel(root)} @ {R}).\n"
                  f"  The cache IS now present, so the hooks can resolve a sensor — that half "
                  f"is done. For the rest, run the armer directly:\n"
                  f"    python3 {R}/protocol/hooks/claude-code/arm-hooks.py --portable "
                  f"--target {root}/.claude/settings.json --workspace {root}", file=sys.stderr)
            return 2
        return _run([py, str(setup), "--root", str(root), "--rhizome", str(R), *rest])
    if sub == "link-commands":
        # The commands live in the RHIZOME checkout (R), not in `root`: a governed child
        # vendors the tools but does not carry the lifecycle command files, and linking
        # from the child would produce links pointing at files that were never there.
        linker = R / "tools" / "rhiz_link_commands.py"
        if not linker.is_file():
            print(f"rhiz link-commands: not in this channel snapshot ({channel(root)} @ {R}).",
                  file=sys.stderr)
            return 2
        return _run([py, str(linker), "--root", str(R), *rest])
    if sub == "self-update":
        src, dst = R / "tools" / "rhiz.py", root / "tools" / "rhiz.py"
        if src.resolve() == dst.resolve():
            print("self-update skipped: this IS the canonical bootstrap")
            return 0
        shutil.copyfile(src, dst)
        print(f"updated {dst} from {R} @ {channel(root)}")
        return 0
    if sub == "lint":
        rc = _run([py, lint, "--root", str(root), *rest])
        local = root / "tools" / "lint-local.py"
        if local.exists():
            rc |= _run([py, str(local)])   # repo-local extension (e.g. code-growth census)
        else:
            # FIX (fails-toward-OK sweep #14, found via rootstock's vendored copy of this
            # bootstrap): was a bare `if local.exists()` with no else — a child repo with
            # no lint-local.py ran rhiz-lint alone and reported the SAME "clean" as a
            # child whose extension genuinely passed. Mirrors _verify_partitions()'s
            # denominator convention: announce the skip, don't fail on it (the extension
            # is optional by design).
            print("⟐ lint-local: tools/lint-local.py not present — repo-local extension "
                  "skipped (not the same as a clean run).", file=sys.stderr)
        return rc
    if sub == "search":
        return _run([py, search, "--root-repo", str(root), *rest])
    if sub == "docs":
        return _run([py, dg, "render-all", "--root", str(root), *rest])
    if sub == "verify":
        return _run([py, dg, "verify", *rest])
    if sub == "maintain":
        # Flags belong to rhiz-maintain.py (the converge/fix tool): forward them
        # together with --root instead of silently dropping them — `rhiz maintain
        # --fix` must mean what `rhiz-maintain.py --fix --root <root>` means. The
        # BARE form keeps the mechanical loop below (lint + index + docs + ledger).
        if rest:
            return _run([py, str(R / "tools" / "rhiz-maintain.py"),
                         "--root", str(root), *rest])
        rc = _run([py, lint, "--root", str(root)])
        local = root / "tools" / "lint-local.py"
        if local.exists():
            rc |= _run([py, str(local)])   # repo-local extension (e.g. code-growth census)
        else:
            # FIX (fails-toward-OK sweep #14): same silent skip as the `lint` subcommand
            # above, in the `maintain` loop's own copy of the check.
            print("⟐ lint-local: tools/lint-local.py not present — repo-local extension "
                  "skipped (not the same as a clean run).", file=sys.stderr)
        rc |= _run([py, search, "--root-repo", str(root), "index"])
        # --check, not a bare regenerate: a doc-graph .full.md is committed now
        # (rhiz-merkle.md §9.11), so drift between it and its sections is a CI
        # failure, the same treatment `_index.md` already gets. Measured clean
        # across the whole fleet before landing (0 or all-OK everywhere a
        # product repo's own root is scanned — a memory-repo sibling is out of
        # this call's --root and unaffected either way).
        rc |= _run([py, dg, "render-all", "--root", str(root), "--check"])
        # MERKLE INTEGRITY + the coordinate gate. Both were CI-only, and that asymmetry
        # cost three failed pushes on 2026-08-15 alone: a content-hash desync in three
        # edited sections, a coordinate literal in a new config, and a link that only
        # breaks in the curated tree. `maintain` reported clean for all three, because
        # local green and CI green were different predicates and nothing said so.
        #
        # Measured before adopting, across all 20 repos: scope-audit passes everywhere,
        # and verify failed in exactly ONE repo (aether-memory, 32 entries Phase 3 left
        # behind) which was resynced first. So this adds no red anywhere on the day it
        # lands — deliberately, because a gate that arrives already failing gets
        # disabled rather than fixed.
        rc |= _run([py, str(R / "tools" / "rhiz_scope_audit.py"), "--root", str(root)])
        rc |= _verify_partitions(py, dg, root)
        # D7 (operator decision, 2026-08-17): the last two CI-only gates come local.
        # Same asymmetry as the two steps above, one layer out — `build-rollup --check`
        # guards the rolled-up tools against their own `src/` fragments, and the suite
        # was running in NEITHER place for the anchor. Cheap gate first, then the
        # expensive one, so a five-second failure is never reported behind a suite.
        rc |= _check_rollups(py, root)
        rc |= _run_unit_suite(py, root)
        # IGNORE-PARITY: does this repo ignore the `.rhiz/` runtime state the tools write?
        # INFORMATIONAL — deliberately NOT OR'd into rc, and the reason is a rule this repo
        # learned the hard way: a gate that arrives already failing gets disabled rather
        # than fixed. Two known-red cases remain and neither is the repo's fault — a
        # PROMOTED CLEAN branch carries the ignore block from its last promote (charlotte's
        # `main`), and a long-lived side branch predates entries added on the trunk. Both
        # resolve by a normal promote/merge, not by an edit. It becomes a hard gate once
        # the promoted-branch case is ruled on; until then the exit code lives in the
        # tool's own `--check`, for a CI that wants it.
        _run([py, str(R / "tools" / "rhiz_ignore_parity.py"), "--root", str(root)])
        # Load-ledger diff: surface any relied-on unit whose reference moved since
        # this repo's agent loaded it ("re-read these"). INFORMATIONAL — deliberately
        # NOT OR'd into rc, so a stale local ledger never fails the mechanical loop /
        # CI (and a fresh clone / CI has no ledger, so it prints nothing actionable).
        _run([py, distill, "--ledger-check", "--root", str(root)])
        return rc
    if sub == "report":
        return _run([py, str(R / "tools" / "rhiz-maintain.py"), "--report", "--root", str(root), *rest])
    if sub == "kb-usage":
        return _run([py, str(R / "tools" / "rhiz_kb_usage.py"), "--root", str(root), *rest])
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
    if sub == "code-census":
        # Whole-repo CODE census: what IS this repo? Fuses the existing engines (structural
        # extractor, call graph, usage catalog, size bands, doc coverage, doc DAG) into an
        # artifact committed to the MEMORY layer — an "about the repo" file, not product
        # content. Deliberately NOT a widening of `codesync`'s curated drift scan: separate
        # config (`.rhiz-code-census.json`), separate cadence, separate output. `--check`
        # asserts the committed census matches the tree it claims to describe; `--stale`
        # reports how far HEAD has moved (the advisory `rhiz maintain --report` surfaces).
        return _run([py, str(R / "tools" / "rhiz_code_census.py"), "--root", str(root), *rest])
    if sub == "docsync":
        # Bilateral code↔doc / prose↔prose drift (doc-sync). Default: report links
        # whose one side moved since last sync (direction named). `--record` re-stamps
        # the explicit `.rhiz-docsync.json` markers after reconciling; `--record-backlinks`
        # re-stamps the per-doc backlink baseline. Drift ALSO surfaces in `rhiz maintain`
        # (a shared rhiz-lint check reads the same manifest/baseline + the backlink graph).
        return _run([py, str(R / "tools" / "rhiz_docsync.py"), "--root", str(root), *rest])
    if sub == "twin":
        # Cross-repo mirror check. The ONE relationship no single-repo verify step can
        # see: `build-rollup --check` compares a rollup to its LOCAL fragments, so two
        # twins can each be internally consistent and different from each other, and
        # both report green (EL-153 — the anchor sat twelve files behind that way).
        # Opt-in per repo via `.rhiz-twin.json`, which is also where a deliberate
        # divergence is DECLARED with its reason; `--gate` makes drift exit 1. A twin
        # that is not checked out is skipped, never reported clean.
        return _run([py, str(R / "tools" / "rhiz_twin.py"), "--root", str(root), *rest])
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
    if sub == "partition-note":
        # Partition-aware doc re-sync: a partition RECORDS a durable transition note
        # (what split into what, dependency shape, verbatim-vs-refactored) so the later
        # doc update reads a before→after GUIDEPOST instead of cold-re-scanning the new
        # files, then CLEARS it. `--status` renders open guideposts; `--show <path>` the
        # one covering a file; `--record ...` writes one; `--clear <source>` drops it.
        # doc-coverage consults it so a known-from-partition orphan is advisory, not debt.
        return _run([py, str(R / "tools" / "rhiz_partition_note.py"), "--root", str(root), *rest])
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
    if sub in ("transcript", "emissions"):
        # LLM-transcript analyzer (offline, zero tokens): does the rhizome method WORK,
        # from transcript ground truth — AD-008 delta-emission accounting (full-once-
        # then-pointers, realized vs missed savings, fallback breadcrumbs) PLUS method
        # health: rhizome tool-call counts, session-start injection sizes vs the cap,
        # read-mandate compliance pairing (directive → full Read → enforcement),
        # steering pairing (checkpoint → reset → rehydrate), and harm signals (silent
        # truncation = regression; overflow withholding = visible by design). `--html`
        # compiles the self-contained offline report. `emissions` is the legacy alias.
        return _run([py, str(R / "tools" / "rhiz_llm_transcript_analyzer.py"),
                     "--root", str(root), *rest])
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
    if sub == "tail-recover":
        # Checkpoint TAIL recovery: the steered checkpoint writes the buckets at ~60%, but
        # the conversation keeps going — questions asked/answered AFTER the last bucket
        # refresh and BEFORE the /clear fall outside the committed buckets. This reads the
        # `.rhiz/checkpoint-tail-marker.json` stamped at the last bucket commit, extracts the
        # conversation past it from the preceding transcript, writes transcripts/<sess>-tail.md,
        # and registers it in the read mandate (verified full-fidelity delivery, EL-127).
        # The anchor (rhizome) holds the marker, so run against it.
        return _run([py, str(R / "tools" / "rhiz_tail_recover.py"), "--root", str(root), *rest])
    if sub == "stream":
        # STREAM identity (multi-session support, operator rulings 2026-08-30): the slug
        # is the durable line of work; the worktree is only its usual home. Everything
        # durable keys off this rather than off `session_id`, which dies at /clear.
        return _run([py, str(R / "tools" / "rhiz_stream.py"), "--root", str(root), *rest])
    if sub == "ignore-parity":
        # EL-148's missing gate: `.rhiz/` runtime state must be gitignored, the rules live in
        # each repo's OWN .gitignore, and a channel bless ships TOOLS rather than a child's
        # .gitignore — so the list drifts by construction. Measured the day it landed: the
        # anchor carried 29 entries, children 22, four repos had no block at all, and one
        # runtime file had already been committed into a child. The canonical list is the
        # anchor's own .gitignore (not a second registry to drift), and the tools cache IS
        # the anchor checkout — so the bless that delivers the tool delivers the list.
        return _run([py, str(R / "tools" / "rhiz_ignore_parity.py"), "--root", str(root), *rest])
    if sub == "ci":
        # The CI gate, run LOCALLY against a clean clone, with the verdict recorded as a git
        # note on the SHA. Built 2026-08-30 when the account's Actions minutes ran out and
        # every job was refused in 3 seconds — which also froze `tools-stable`, since the
        # channel rule is "fast-forward to any GREEN main" and greenness was CI's word.
        # It reproduces every tool-invoking step in both workflows (measured: ~69s, siblings
        # included) and is explicit about the three things it does NOT reproduce —
        # independence, the weekly schedule floor, and a different machine. The interpreter
        # is no longer one of them: the CI pin was aligned to the version this fleet is
        # developed on, so the two are one predicate.
        return _run([py, str(R / "tools" / "rhiz_ci.py"), "--root", str(root), *rest])
    if sub == "stream-migrate":
        # Evidence for adopting a stream in a memory repo whose history PREDATES streams.
        # Several lines of work ran against one instance before any of them had a name, so
        # their record is interleaved in one unkeyed file's history with no field saying who
        # wrote what — a rename does not migrate that, it ATTRIBUTES it. This reports what
        # git can actually establish (`--attribute` walks the coordinates bucket for which
        # products each past window MOVED) and proposes renames as commands for a human to
        # run. It never renames anything, and it never proposes keying `session-arc.md`,
        # which is the one cross-cutting bucket.
        return _run([py, str(R / "tools" / "rhiz_stream_migrate.py"), "--root", str(root), *rest])
    if sub == "merge-back":
        # Land a stream's branch on the trunk (multi-session-streams.md §5.2). OPERATOR-
        # TRIGGERED by ruling — this never decides whether to merge, only how. It exists
        # because the two things that make a landing safe are the two a hand-run skips:
        # the gates re-run ON the target AFTER the merge (a merge can break what neither
        # side broke), and --no-ff (a fast-forward erases the fact that this was a stream).
        # Every check is in its own exit code: nothing intercepts `git merge`/`git push`,
        # and a gate that is not an exit code is prose.
        return _run([py, str(R / "tools" / "rhiz_merge_back.py"), "--root", str(root), *rest])
    if sub == "coord-check":
        # Mechanizes `rhiz howto rehydrate` step 2 ("is HEAD still the recorded END SHA").
        # `compute_bucket_skew()` (tail-recover) catches a memory repo's bucket FILES
        # drifting out of sync with each other; this catches a DIFFERENT axis — the
        # coordinates bucket itself going stale relative to the repos it names, e.g. a
        # BRANCH-map SHA or a "not touched" claim going wrong even while the file is being
        # actively edited (2026-08-23 incident). Parses session-checkpoints.md's structured
        # END-SHA table only (never the free-prose BRANCH sections) — local repo state only,
        # no network. The coordinates live in the anchor's MEMORY repo; the tool resolves
        # --root through $RHIZ_MEMORY_PATH / the committed .rhiz-binding.json, so the
        # invoking checkout's toplevel is a correct --root from either the product or the
        # memory repo.
        return _run([py, str(R / "tools" / "rhiz_coord_check.py"), "--root", str(root), *rest])
    if sub == "cite-check":
        # coord-check's complement, and the close of a gap the corpus recorded as OPEN on
        # 2026-08-23 ("what this does NOT close: content drift inside a file that IS being
        # touched regularly"). coord-check reads the STRUCTURED END-SHA table and explicitly
        # skips session-cache.md's free-prose BRANCH map; bucket-skew reads git metadata and
        # cannot see inside a file at all. So a cache rewritten in the same commit that fixes
        # its siblings passes both while naming a tree that has moved — measured 2026-09-01 in
        # rootstock-memory and, unnoticed until this tool ran, charlotte-memory. Not a prose
        # parser: it walks BACKTICKED tokens and asks git to classify each one.
        return _run([py, str(R / "tools" / "rhiz_cite_check.py"), "--root", str(root), *rest])
    if sub == "reference-capture":
        # REFERENCE-CAPTURE sensor: a visual-imitation task's oracle is pixel-parity vs the
        # operator's reference images, not completion of the plan (EL-137) — but a pasted image
        # lives only in the transcript until deliberately committed. This scans the transcript
        # for operator-PASTED images and reconciles their bytes against every in-scope repo's
        # tracked files; the uncommitted residual is surfaced as an advisory. The distill-nudge
        # adapter drives it at SessionStart + the commit beat; this is the manual PULL surface.
        # See tools/rhiz_reference_capture.py + rhiz-memory/roadmap/reference-capture-sensor.md.
        return _run([py, str(R / "tools" / "rhiz_reference_capture.py"), "--root", str(root), *rest])
    if sub == "expectations":
        # Shared behavioral-gate verifier (rhiz-memory/behavioral-gate-inventory.md, Pieces 1+2):
        # read-mandate transcript reconciliation (hardens BG-01 against the intermittent
        # PreToolUse(Read) hook) + the window-scoped expectation registry (checkpoint→bucket
        # refresh, STALE→re-pull) that the distill-nudge Stop beat ticks. `--status` inspects
        # the live registry; the hook drives --tick/--register/--clear.
        return _run([py, str(R / "tools" / "rhiz_expectations.py"), "--root", str(root), *rest])
    if sub == "indexed-backfill":
        # Reverse-derive `indexed_by` from existing index/manifest membership — turns a big-bang
        # adoption into one reviewable diff. PLAN by default; --write applies (additive). A
        # PROPOSER: rhiz-lint stays the authoritative membership check. See
        # rhiz-memory/roadmap/frontmatter-reverse-membership.md.
        return _run([py, str(R / "tools" / "rhiz_indexed_backfill.py"), "--root", str(root), *rest])
    if sub == "reference-inventory":
        # R21: Phase 6 collapses this repo's history, so every historical citation must be
        # dispositioned FIRST — forward-resolved or registered intentionally-unattached with
        # a reviewed reason, verified on the exact SHA the purge would run against. The
        # gating class is the SHA citation: a coordinate dies visibly when a reader follows
        # it, while a cited commit id resolves today and is simply gone afterwards. This is
        # the inventory half only; the dry-run rehearsal R21 also requires is separate.
        return _run([py, str(R / "tools" / "rhiz_reference_inventory.py"),
                     "--root", str(root), *rest])
    if sub == "shareability":
        # The blob half of the shareability boundary (D4), replacing the inline
        # `find | grep -iE '\.(png|jpg|…)$'` that nine workflows each carried a copy of.
        # Classifies by `.rhiz-identity.json`'s `storage` — this is that field's first
        # consumer — and refuses to guess when it cannot classify, because BOTH defaults
        # are silently wrong: enforcing breaks the -lfs sibling, exempting stops gating a
        # shareable repo. A repo with no identity at all is outside the scheme (a product
        # repo) and is skipped, which is a different answer and prints differently.
        return _run([py, str(R / "tools" / "rhiz_shareability.py"),
                     "--root", str(root), *rest])
    if sub == "preflight":
        # Operator-setup preflight (first-time-setup.md → Detection): detect silent-unconfigured
        # setup (adapter wired, managed-web Setup script, PreToolUse guard armed + firing,
        # vendored cache) and surface the exact fix. `--check` for CI; the distill-nudge hook
        # runs `--card` at SessionStart. Sibling of the behavioral-gate register.
        return _run([py, str(R / "tools" / "rhiz_preflight.py"), "--root", str(root), *rest])
    if sub == "promote":
        # Working-branch -> clean-branch promotion (rhiz-child-repo-convention.md's
        # optional two-branch model). Strips a per-repo `.rhiz-artifacts.json` registry
        # (read from --source only, modeled on the retired `.rhiz-bless.json`'s
        # self-referential policy-read) via index surgery + `commit-tree`, never `git
        # merge` — tested traps: `merge -s ours` silently drops real product changes,
        # `merge --no-commit` + `git rm` breaks on the SECOND promotion once a stripped
        # path has changed since the last strip. `--verify-only` is the parity/drift
        # check alone (no new commit) — run it on a schedule, not just at promotion
        # time, since main only being touched by this tool is an invariant nothing else
        # enforces.
        return _run([py, str(R / "tools" / "rhiz_promote.py"), "--root", str(root), *rest])
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
