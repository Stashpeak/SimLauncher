# -*- coding: utf-8 -*-
"""Did the code that closed this issue survive into main?

The #519 class: PR #536 added the tray "Close Apps" item, PR #557 ("chore:
prepare 1.0.0") silently deleted those 7 lines, #519 was closed as completed
citing #536, and it sat falsely done for two months until an audit caught it.

No commit-message heuristic can catch that: the deletion happened inside a
version-bump commit and the word "revert" appears nowhere. So this asks the
only question that actually settles it: are the lines the PR added still in
main today?

Usage: survived.py <ref> <pr-number> [<pr-number> ...]
"""
import re, subprocess, sys


def git(*args):
    return subprocess.run(
        ["git"] + list(args), capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    ).stdout


TRIVIAL = re.compile(r"^\s*([}{)\]]+;?|\)|\*/|/\*+|//.*|import .*|export \{.*|$)")


def added_lines(pr_merge_sha):
    """Non-trivial lines this merge introduced, grouped by file."""
    out = git("show", "-m", "--first-parent", "--format=", "--unified=0", pr_merge_sha)
    by_file, cur = {}, None
    for line in out.split("\n"):
        if line.startswith("+++ b/"):
            cur = line[6:].strip()
            by_file.setdefault(cur, [])
        elif line.startswith("+") and not line.startswith("+++") and cur:
            body = line[1:]
            if len(body.strip()) >= 25 and not TRIVIAL.match(body):
                by_file[cur].append(body.strip())
    return {f: v for f, v in by_file.items() if v}


def survives(ref, path, lines):
    blob = git("show", "%s:%s" % (ref, path))
    if not blob:
        return 0, len(lines)          # file gone entirely
    kept = sum(1 for l in lines if l in blob)
    return kept, len(lines)


ref = sys.argv[1]
for pr in sys.argv[2:]:
    sha = git("log", ref, "--format=%H", "-1", "--grep", r"(#%s)$" % pr, "-E").strip()
    if not sha:
        sha = git("log", ref, "--format=%H", "-1", "--grep", "#%s" % pr).strip()
    if not sha:
        print("PR #%-4s  NO COMMIT FOUND in %s" % (pr, ref))
        continue

    files = added_lines(sha)
    if not files:
        print("PR #%-4s  %s  no substantive added lines to check" % (pr, sha[:7]))
        continue

    tot_kept = tot = 0
    worst = []
    for path, lines in sorted(files.items()):
        k, n = survives(ref, path, lines)
        tot_kept += k
        tot += n
        if n and k / float(n) < 0.5:
            worst.append("      %s  %d/%d survive" % (path, k, n))

    pct = 100.0 * tot_kept / tot
    flag = "SURVIVED" if pct >= 50 else "!! GONE "
    print("PR #%-4s  %s  %s  %d/%d added lines still in %s (%.0f%%)"
          % (pr, sha[:7], flag, tot_kept, tot, ref, pct))
    for w in worst:
        print(w)
