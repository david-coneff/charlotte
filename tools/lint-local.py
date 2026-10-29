#!/usr/bin/env python3
"""charlotte's repo-local lint extension (`rhiz lint` and bare `rhiz maintain` run it).

SYNTHESIS §5 "By theme" claims that every numbered lesson appears in at least one cluster.
That index once stopped silently at #30 while #31-#39 existed, and nothing enforced the
claim (§5 #39: "an invariant nothing enforces is a wish"). This grades it: the lessons in
§5 are numbered 1..N without a gap, and the theme block names exactly those numbers, no
more and no fewer.

SYNTHESIS lives in charlotte's MEMORY repo, not here. Its location is resolved the way every
rhiz tool resolves it (`rhiz_roots.resolve`: the committed `.rhiz-binding.json`, a stream's
memory worktree, `$RHIZ_MEMORY_PATH`), never guessed. When it cannot be resolved, the check
says NOT RUN and exits 0: a missing sibling is not a pass, and it is not this repo's defect.

Exit 1 on a mismatch, 0 otherwise.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LESSON = re.compile(r"^(\d+)\. \*\*")
REF = re.compile(r"#(\d+)\b")


def memory_root() -> Path | None:
    """The memory repo as rhiz resolves it for this product, or None."""
    try:
        binding = json.loads((ROOT / ".rhiz-binding.json").read_text(encoding="utf-8"))
        tools = (ROOT / binding["protocol_path"]).resolve() / "tools"
        sys.path.insert(0, str(tools))
        import rhiz_roots  # noqa: PLC0415 - found through the binding, not installed
        mem = Path(rhiz_roots.resolve(ROOT).memory_root)
    except Exception:                       # noqa: BLE001 - reported as NOT RUN below
        return None
    return mem if mem.resolve() != ROOT and (mem / "state" / "SYNTHESIS.md").is_file() else None


def section5(text: str) -> list:
    """The lines of `## 5.` up to the next `## ` heading."""
    lines, out, inside = text.splitlines(), [], False
    for ln in lines:
        if ln.startswith("## "):
            if inside:
                break
            inside = ln.startswith("## 5.")
        elif inside:
            out.append(ln)
    return out


def check(text: str) -> list:
    """The problems with §5's theme index, [] when it holds."""
    sec = section5(text)
    if not sec:
        return ["SYNTHESIS.md has no `## 5.` section"]
    start = next((i for i, ln in enumerate(sec) if ln.startswith("**By theme**")), None)
    first = next((i for i, ln in enumerate(sec) if LESSON.match(ln)), None)
    if start is None or first is None or start > first:
        return ["§5 has no **By theme** block before its first numbered lesson"]
    lessons = [int(LESSON.match(ln).group(1)) for ln in sec[first:] if LESSON.match(ln)]
    themed = {int(n) for ln in sec[start:first] for n in REF.findall(ln)}
    problems = []
    if lessons != list(range(1, len(lessons) + 1)):
        problems.append(f"§5 lessons are not numbered 1..{len(lessons)} in order: {lessons}")
    missing = sorted(set(lessons) - themed)
    if missing:
        problems.append("§5 'By theme' omits lesson(s) " + ", ".join(f"#{n}" for n in missing))
    extra = sorted(themed - set(lessons))
    if extra:
        problems.append("§5 'By theme' names lesson(s) that do not exist: "
                        + ", ".join(f"#{n}" for n in extra))
    return problems


def main() -> int:
    mem = memory_root()
    if mem is None:
        print("lint-local: SYNTHESIS §5 theme index NOT RUN — charlotte's memory repo did not "
              "resolve (rhiz_roots via .rhiz-binding.json); not a pass.")
        return 0
    path = mem / "state" / "SYNTHESIS.md"
    problems = check(path.read_text(encoding="utf-8"))
    for p in problems:
        print(f"lint-local: {path}: {p}")
    if not problems:
        print(f"lint-local: SYNTHESIS §5 theme index covers every lesson ({path})")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
