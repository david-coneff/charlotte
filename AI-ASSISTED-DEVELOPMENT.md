# AI-assisted development files

Charlotte was developed with AI assistance under a methodology called **rhizome**
(governance, doc-linting, and session-memory tooling shared across several of the
author's projects). The files below exist **only** to support that workflow — none
of them are needed to run, build, or understand the crawler itself.

| Path | What it is |
|---|---|
| `.rhiz-binding.json` | Pins to the shared `rhizome-protocol` tooling repo and this project's own `charlotte-memory` notes repo. |
| `.rhiz-lint.json` | Config for `rhiz-lint`, used to check the `CRAWLER/` docs for consistency. Losing this loses that specific automated check, not the docs themselves. |
| `tools/rhiz.py` | A bootstrap/dispatcher script (~700 lines) that fetches and forwards to the real tooling in `rhizome-protocol`. Also the entry point for Claude Code session hooks, if `.claude/` is present. |
| `.rhiz/` | Runtime state and logs written by the tooling — regenerable, not meaningful outside an active rhizome session. |
| `.claude/` | Claude Code configuration (hooks, custom commands), if present. |
| `.github/workflows/governance.yml` | CI that runs the rhizome tooling against this repo and its sibling notes repo. Kept deliberately separate from `.github/workflows/product-ci.yml`, which is the real build and has no rhizome dependency at all. |
| `.gitattributes` | Marks the files above `export-ignore`, so GitHub's "Download ZIP", release source tarballs, and Forgejo/Gitea archive downloads already exclude them automatically — no script needed for that path. |
| `tools/strip-ai-artifacts.py` | The script below. |
| This file | — |

## If you want them gone

**Downloading a ZIP or a release tarball** (not `git clone`): you already have none
of this — `.gitattributes`' `export-ignore` markers mean `git archive`-based
downloads (GitHub's "Download ZIP" button, auto-generated release/tag source
archives, Forgejo/Gitea archive downloads) never included them in the first place.
Nothing to run.

**`git clone`**: run the cleanup script once —

```bash
python3 tools/strip-ai-artifacts.py           # dry run — lists what would be removed
python3 tools/strip-ai-artifacts.py --yes     # actually removes them
```

It deletes exactly the paths in the table above and nothing else — it's an
allowlist of exact paths, not a pattern match, so it can't reach into `src/`,
`CRAWLER/`, or any other product file. It edits your local working copy only; the
files remain recoverable from git history (`git log --all -- .rhiz-binding.json`,
etc.) unless you separately rewrite history, which this script deliberately does
not do.

## Keeping the list current

If a future change adds a new rhizome-only file to this repo, add it to
`ARTIFACT_PATHS` in `tools/strip-ai-artifacts.py` **and** to `.gitattributes` in the
same commit — nothing today checks that these two lists agree, so an entry added to
one and not the other will silently under-cover either the script or the archive
path (see `git ls-files | grep -E '(^|/)\.(rhiz|claude)'` to check the actual
tracked set against both lists by hand).
