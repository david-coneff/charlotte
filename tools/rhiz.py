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
  maintain         bare: lint + search index + docs + scope-audit + merkle verify + ledger-check
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
  reference-capture [--transcript P] [--against R]  flag operator-PASTED reference images
                   not yet committed to any in-scope repo (offline, zero tokens) — persist the
                   reference before the intent is lost to a reset; pixel-parity is the oracle (EL-137)
  trace [..]       rhiz-Trace: build a ready-to-open instrumented copy of THIS
                   repo's built HTML deliverable (probe / --ast / --data). Reads
                   a `.rhiz-trace.json` adapter at the repo root. Needs node.
  setup            FIRST RUN on a machine: fetch the tools cache, arm this repo's
                   hooks (committable form), print the preflight verdict + what is
                   live now vs next session. Idempotent. Also `/rhiz-setup`.
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


# ------------------------------------------------------------------ hook entrypoint

HOOK_ADAPTERS = ("distill-nudge", "census-nudge", "sync-nudge", "rollup-read-guard")
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
        except Exception:                                   # noqa: BLE001
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
        rc |= _run([py, search, "--root-repo", str(root), "index"])
        rc |= _run([py, dg, "render-all", "--root", str(root)])
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
    if sub == "preflight":
        # Operator-setup preflight (first-time-setup.md → Detection): detect silent-unconfigured
        # setup (adapter wired, managed-web Setup script, PreToolUse guard armed + firing,
        # vendored cache) and surface the exact fix. `--check` for CI; the distill-nudge hook
        # runs `--card` at SessionStart. Sibling of the behavioral-gate register.
        return _run([py, str(R / "tools" / "rhiz_preflight.py"), "--root", str(root), *rest])
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
