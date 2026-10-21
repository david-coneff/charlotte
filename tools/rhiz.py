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

Subcommands — the BOOTSTRAP ones live here, because they must work before (or
without) a channel snapshot. Every other subcommand (lint, search, maintain, work, judge,
bucket-check, …) is forwarded to `tools/rhiz_dispatch.py` IN THE RESOLVED CHECKOUT, so a
copied bootstrap always runs the channel's current table. `rhiz help` prints all of it.
  help             the full subcommand table (this list + the forwarding half's)
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
  update           refresh the cached rhizome checkout — a NO-OP (warns rather than
                   silently doing nothing) when this root resolves via $RHIZ_TOOLS_PATH,
                   a committed binding, or being the source repo itself; `where` shows
                   which tier is live
  self-update      overwrite this bootstrap with the channel's canonical copy
  channel          print the channel/ref this repo tracks (drift-guard reads this)
  where            print the resolved rhizome checkout path + forge URL + WHICH of the
                   four resolution tiers (env / binding / native / cache) answered
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


def _main_worktree(c: Path) -> Path:
    """The MAIN worktree of `c`, or `c` unchanged when it is not a linked worktree.

    ANOTHER HAND-KEPT TWIN (retro-4 cycle 2) of `62_anchor_scope.py`'s `main_worktree` /
    `tools/rhiz_stream.py`'s own copy of the identical function — same name, same
    body, on purpose; see either of those docstrings for why this is copied rather
    than imported (`rhiz.py` is a standalone, copyable bootstrap — see the module
    docstring — so it cannot import a sibling `tools/*.py` module that a bare
    bootstrap copy in a child repo would not carry). If either of those versions ever
    changes, mirror the change here too.

    A linked worktree's `.git` is a FILE reading `gitdir: <main>/.git/worktrees/<name>`.
    Read it rather than shelling out — this sits on `resolve_rhizome_tier`'s hot path."""
    dotgit = c / ".git"
    try:
        if not dotgit.is_file():
            return c
        txt = dotgit.read_text(encoding="utf-8", errors="replace").strip()
        if not txt.startswith("gitdir:"):
            return c
        gd = Path(txt.split(":", 1)[1].strip())
        if not gd.is_absolute():
            gd = (c / gd).resolve()
        for a in gd.parents:                    # .../<main>/.git/worktrees/<n> -> <main>
            if a.name == ".git":
                return a.parent.resolve()
    except OSError:
        pass
    return c


def resolve_rhizome_tier(root: Path) -> tuple[Path | None, str, str]:
    """(path, tier, detail) for the FIRST of the four resolution tiers that answers for
    `root`, without performing the cache tier's fetch — `path` is None only for tier
    "cache" (`resolve_rhizome` still has to fetch/clone to answer that one); `tier` is
    "env" / "binding" / "native" / "cache"; `detail` is a human-readable note (the env
    var's value, the binding's own `protocol_path`, etc.) for a caller to report.

    THE GAP THIS CLOSES (WH-12 datum, 2026-09-08): `resolve_rhizome`'s own resolution
    ORDER was documented, but nothing said which tier answers for a GIVEN root, and in
    a workspace where every child's `.rhiz-binding.json` carries a `protocol_path`
    pointing at a present local sibling — this fleet's own normal dev layout — every
    `rhiz` invocation resolves via "binding", never "cache", no matter which
    subcommand runs. `rhiz update`/`self-update`/`where` all exited 0 with a
    plausible-looking resolved path on all 12 fleet repos while leaving their vendored
    `.rhiz-tools/rhizome` caches completely untouched; only a direct before/after diff
    of the cache's own git HEAD caught it. `where`/`update` report this tier now so the
    same silent no-op is visible from the command's own output, not just a diff.

    A RELATIVE override/binding path is resolved against `root`'s MAIN WORKTREE
    (retro-4 cycle 2), not `root` verbatim — the same canonicalization
    `tools/rhiz_stream.py`'s `resolve_slug`/`adopt` apply for the identical reason.
    Worktrees are typically created at an arbitrary location relative to the main
    checkout, so a sibling-relative path (`../rhizome-protocol`, the documented form)
    is only meaningful relative to the ONE place the repo's siblings actually live —
    the main checkout — not wherever a linked worktree happens to sit on disk. Without
    this, the identical committed `.rhiz-binding.json`, checked out unchanged into
    every linked worktree, silently resolved to a DIFFERENT tier depending on which
    worktree invoked the tool. `read_binding` itself still reads from `root` verbatim
    (a worktree legitimately checking out a different branch/commit gets ITS OWN
    binding content, unaffected) — only the RELATIVE-PATH JOIN is re-based."""
    canon = _main_worktree(root)
    local = os.environ.get("RHIZ_TOOLS_PATH")
    if local:
        # RETRO-4 (idx-9): a relative $RHIZ_TOOLS_PATH (the documented form, e.g.
        # `RHIZ_TOOLS_PATH=../rhizome-protocol` per rhiz-quickstart.md/
        # rhiz-child-repo-convention.md) used to resolve against the PROCESS CWD here
        # — two lines down, the binding branch already treats an equivalent relative
        # `protocol_path` as root-relative, and `rhiz_roots.py`'s own `_resolve_path`
        # resolves this SAME env var against the product root for every other tool
        # built on it. `repo_root()` deliberately supports invocation from any
        # subdirectory via `git rev-parse --show-toplevel`, so the two modules silently
        # disagreed the moment cwd nested inside the repo: this one fell through to the
        # cache tier, dropping the operator's override with no warning, while
        # `rhiz_roots.resolve(root).protocol_root` kept correctly returning it.
        lp = Path(local)
        lp = lp if lp.is_absolute() else (canon / lp)
        if (lp / "tools" / "rhiz-lint.py").exists():
            return lp.resolve(), "env", f"$RHIZ_TOOLS_PATH={local}"
    bound = read_binding(root).get("protocol_path")
    if bound:
        # A relative protocol_path is repo-root-relative (portable across machines,
        # the sibling-checkout layout); validated like $RHIZ_TOOLS_PATH — a binding
        # that points at nothing falls through to the channel clone.
        bp = (canon / bound) if not Path(bound).is_absolute() else Path(bound)
        if (bp / "tools" / "rhiz-lint.py").exists():
            return bp.resolve(), "binding", f"protocol_path={bound}"
    # rhizome-protocol itself carries no binding (nothing to bind to but itself), so
    # without this check it fell all the way through to a channel-pinned clone of its
    # OWN repo — silently serving `tools-stable`'s lagged tools even when invoked from
    # inside the very tree that just edited them. Same marker check as the two cases
    # above, applied to `root` itself: a child never carries `tools/rhiz-lint.py`
    # natively ("reference, don't copy" — rhiz-child-repo-convention.md §1), so this
    # only ever fires for the source repo.
    if (root / "tools" / "rhiz-lint.py").exists():
        return root.resolve(), "native", "this repo IS the source (native tools/)"
    return None, "cache", str(root / ".rhiz-tools" / "rhizome")


def resolve_rhizome(root: Path) -> Path:
    path, tier, _ = resolve_rhizome_tier(root)
    if tier != "cache":
        return path
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
    """Echo and run one command. The bootstrap's own two forwards (setup, link-commands)
    use this; the full `_run` — with the maintain loop's observer-effect suppression —
    lives in `rhiz_dispatch.py` beside the loop that needs it."""
    print("+ " + " ".join(str(a) for a in args), file=sys.stderr)
    return subprocess.run(args).returncode


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
# a test instead (`test_generated_write_guard_denies.py::ArmableImpliesDispatchable::
# test_every_armable_hook_is_dispatchable`), which is the honest way to keep two
# lists in step when one of them cannot import the other.
HOOK_ADAPTERS = ("distill-nudge", "census-nudge", "sync-nudge", "rollup-read-guard",
                 "generated-write-guard", "subagent-durability", "change-guard",
                 "lesson-recall", "tier-nudge")
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
    _, _tier, _tier_detail = resolve_rhizome_tier(root)
    py = sys.executable or "python3"

    if sub == "where":
        note = {
            "env": f"$RHIZ_TOOLS_PATH override ({_tier_detail})",
            "binding": f"committed binding ({_tier_detail}) — the vendored "
                       f".rhiz-tools/rhizome cache here, if one exists, answers no "
                       f"`rhiz` command; `rhiz update` is a no-op",
            "native": _tier_detail,
            "cache": "the vendored .rhiz-tools/rhizome cache (just fetched/verified)",
        }[_tier]
        print(f"rhizome: {R}\nforge:   {tools_url(root)}\nchannel: {channel(root)}\n"
              f"resolved via: {note}")
        return 0
    if sub == "update":
        if _tier != "cache":
            print(f"rhiz update: nothing to refresh here — this root resolves via "
                  f"{_tier} ({_tier_detail}), not the vendored cache. A "
                  f".rhiz-tools/rhizome cache in this repo, if any, is not what any "
                  f"`rhiz` command actually runs; `rhiz where` shows which tier is live.",
                  file=sys.stderr)
        return 0  # resolve_rhizome already refreshed the cache, when tier == "cache"
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
        # IT TAKES NO ARGUMENTS, AND A HELP REQUEST MUST NOT PERFORM IT (`pando-0151`). This
        # branch never read `rest`, so `rhiz self-update --help` overwrote tools/rhiz.py.
        if rest:
            asked = set(rest) <= {"-h", "--help"}
            print("usage: rhiz self-update   (no arguments) — overwrite this repo's "
                  "tools/rhiz.py with the channel's canonical bootstrap"
                  + ("" if asked else f". Unexpected: {' '.join(rest)}; nothing was written."),
                  file=sys.stdout if asked else sys.stderr)
            return 0 if asked else 2
        src, dst = R / "tools" / "rhiz.py", root / "tools" / "rhiz.py"
        if src.resolve() == dst.resolve():
            print("self-update skipped: this IS the canonical bootstrap")
            return 0
        shutil.copyfile(src, dst)
        print(f"updated {dst} from {R} @ {channel(root)}")
        return 0
    if sub in ("help", "-h", "--help"):
        print(__doc__)
        disp = _load_dispatch(R)
        print(disp.__doc__ if disp else f"(no tools/rhiz_dispatch.py in {R} — this channel "
              "snapshot predates the split; only the subcommands above are available)")
        return 0

    disp = _load_dispatch(R)
    if disp is None:
        print(f"rhiz {sub}: not in this channel snapshot ({channel(root)} @ {R}) — it has no "
              f"tools/rhiz_dispatch.py, so only the bootstrap subcommands are available. "
              f"`rhiz where` shows which checkout answered.", file=sys.stderr)
        return 2
    rc = disp.dispatch(sub, rest, root, R)
    if rc is not None:
        return rc
    print(f"unknown subcommand: {sub}\n{__doc__}\n{disp.__doc__}", file=sys.stderr)
    return 2


def _load_dispatch(R: Path):
    """The forwarding half, loaded from the RESOLVED checkout `R` — never from beside this
    file, which in a child repo is a copy that may be months old.

    FALLBACK, when `R` predates the split: the copy BESIDE this bootstrap, if there is one.
    That is exactly the pre-split behaviour — the table travelled with the bootstrap — and
    it is the case a stream's bootstrap meets when it is pointed at a trunk that has not
    taken the split yet (measured: merge-back's delegated memory gates did, the first suite
    run after the split). A copied child bootstrap has no sibling, so None: the caller
    refuses and names the snapshot."""
    src = R / "tools" / "rhiz_dispatch.py"
    if not src.is_file():
        beside = Path(__file__).resolve().parent / "rhiz_dispatch.py"
        if not beside.is_file():
            return None
        print(f"⟐ rhiz: {R} predates tools/rhiz_dispatch.py — dispatching with the copy "
              f"beside this bootstrap ({beside})", file=sys.stderr)
        src = beside
    import importlib.util
    spec = importlib.util.spec_from_file_location("rhiz_dispatch", src)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod




if __name__ == "__main__":
    sys.exit(main())
