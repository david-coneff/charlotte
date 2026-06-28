#!/usr/bin/env python3
"""rhiz — run rhizome's pinned tooling against THIS repository.

The executable tooling (rhiz-lint, rhiz-search, doc-graph) lives in
`david-coneff/rhizome` and ONLY there. This thin bootstrap resolves a rhizome
checkout at the shared **`tools-stable`** channel and forwards a subcommand to
the matching tool with this repo as its target — so every repo runs the ONE
canonical version of the tools, never a copy that can drift apart. The channel
moves only when rhizome blesses a tool revision (a single fast-forward), so the
whole ecosystem advances together. See `rhiz-child-repo-convention.md`.

This file is itself a stable bootstrap (like `gradlew`/`mvnw`): copy it into a
child repo's `tools/`. It rarely changes; the tools it dispatches to are never
copied.

Resolution order for the rhizome checkout:
  1. $RHIZ_TOOLS_PATH  — an existing local rhizome checkout (dev convenience,
     e.g. a sibling clone). Handy locally; CI's source of truth is the channel.
  2. a cached clone at  <repo>/.rhiz-tools/rhizome , fetched to the channel.
     $RHIZ_TOOLS_REF overrides the channel name — an escape hatch for temporarily
     pinning a SHA during a risky tool change; normally UNSET so you track the
     channel. A committed non-default ref is what the drift-guard flags.

Subcommands (extra args are forwarded to the underlying tool):
  lint [..]        rhiz-lint.py    --root <repo> [..]
  search [..]      rhiz-search.py  --root-repo <repo> [..]   (e.g. `search query "x"`)
  docs             doc-graph.py render-all --root <repo>
  verify <index>   doc-graph.py verify <index>
  maintain         lint + search index + docs   (the mechanical loop, no LLM)
  update           refresh the cached rhizome checkout only
  channel          print the channel/ref this repo tracks (drift-guard reads this)
"""
import os
import subprocess
import sys
from pathlib import Path

CHANNEL_DEFAULT = "tools-stable"
RHIZOME_URL = "https://github.com/david-coneff/rhizome.git"


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


def resolve_rhizome(root: Path) -> Path:
    local = os.environ.get("RHIZ_TOOLS_PATH")
    if local and (Path(local) / "tools" / "rhiz-lint.py").exists():
        return Path(local).resolve()
    cache = root / ".rhiz-tools" / "rhizome"
    ref = channel()
    if not (cache / ".git").exists():
        cache.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["git", "clone", "--depth", "1", "--branch", ref, RHIZOME_URL, str(cache)],
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
    dg = str(R / "protocol" / "modules" / "rhiz-merkle" / "tools" / "doc-graph.py")

    if sub == "update":
        return 0  # resolve_rhizome already refreshed the cache
    if sub == "lint":
        return _run([py, lint, "--root", str(root), *rest])
    if sub == "search":
        return _run([py, search, "--root-repo", str(root), *rest])
    if sub == "docs":
        return _run([py, dg, "render-all", "--root", str(root), *rest])
    if sub == "verify":
        return _run([py, dg, "verify", *rest])
    if sub == "maintain":
        rc = _run([py, lint, "--root", str(root)])
        rc |= _run([py, search, "--root-repo", str(root), "index"])
        rc |= _run([py, dg, "render-all", "--root", str(root)])
        return rc

    print(f"unknown subcommand: {sub}\n{__doc__}", file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
