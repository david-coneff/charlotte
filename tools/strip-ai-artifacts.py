#!/usr/bin/env python3
"""strip-ai-artifacts — delete every AI-assisted-development / rhizome file from
this checkout in one pass, for anyone reusing charlotte who wants none of it.

WHAT THIS DOES AND DOES NOT DO. It edits your LOCAL WORKING COPY only: it does not
touch git history (the files remain in past commits — see AI-ASSISTED-DEVELOPMENT.md
if you want them gone from history too, which is a separate, more disruptive
operation), and it does not change what a `git clone` of this repo hands the next
person (see .gitattributes for what `git archive` / a GitHub "Download ZIP" /
release tarball already excludes on its own, with no script to run).

WHY A SCRIPT AND NOT JUST A DOCS LIST. The list below is the authoritative manifest
of "files whose only job is serving rhizome/AI-assisted development, never the
product" — see AI-ASSISTED-DEVELOPMENT.md's table for what each one is and why it
exists at all. Keeping the manifest here, in one place, next to the code that acts
on it, is what keeps "the docs" and "the delete list" from drifting apart the way
this repo's own .gitignore already once did (it under-covered `.rhiz/`'s runtime
files for months before anyone noticed one had gotten committed by accident).

Run it, review the dry-run list, then re-run with --yes:

    python3 tools/strip-ai-artifacts.py           # dry run — lists what would go
    python3 tools/strip-ai-artifacts.py --yes      # actually deletes

After running, the crawler itself (crawl.js, crawl-render.js, web-crawler.html,
local-cors-proxy.js, src/, CRAWLER/, build.mjs, package.json) is untouched — nothing
here can delete product code, because the manifest below is an explicit allowlist of
exact paths, not a pattern match.
"""

import shutil
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# The manifest. Every path here exists ONLY to serve rhizome / AI-assisted
# development (see AI-ASSISTED-DEVELOPMENT.md for what each one is). If you add a
# new rhizome-only file to this repo, add it here AND to .gitattributes in the same
# change, or it will silently survive both this script and a "clean" archive
# download — there is no automated check that catches a manifest gap today.
ARTIFACT_PATHS = [
    ".rhiz-binding.json",
    ".rhiz-lint.json",
    ".rhiz-orphans.json",
    ".rhiz",                              # runtime state + subagent findings
    ".claude",                            # Claude Code hooks/commands, if adopted
    "tools/rhiz.py",
    ".github/workflows/governance.yml",
    ".gitattributes",                     # only exists to hide the paths above
    "AI-ASSISTED-DEVELOPMENT.md",
    # This script deletes itself last, once everything else is gone — see main().
    "tools/strip-ai-artifacts.py",
]


def main() -> int:
    dry_run = "--yes" not in sys.argv

    present = [p for p in ARTIFACT_PATHS if (REPO_ROOT / p).exists()]
    if not present:
        print("Nothing to remove — no rhizome/AI-assisted-development files found.")
        return 0

    print("The following AI-assisted-development / rhizome files will be removed:")
    for p in present:
        print(f"  {p}")

    if dry_run:
        print("\nDry run only — nothing deleted. Re-run with --yes to actually remove them.")
        return 0

    # Delete everything except this script first, so a crash partway through never
    # leaves the repo in a state where the manifest itself is already gone.
    self_path = "tools/strip-ai-artifacts.py"
    for p in present:
        if p == self_path:
            continue
        target = REPO_ROOT / p
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
        print(f"removed {p}")

    if self_path in present:
        (REPO_ROOT / self_path).unlink()
        print(f"removed {self_path}")

    print("\nDone. Product code and docs are untouched. `git status` will show these")
    print("as deletions — commit them if you want a clean tree going forward, or")
    print("leave them uncommitted/discard if you were only checking what this does.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
