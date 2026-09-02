# -*- coding: utf-8 -*-
"""Did the code that closed an issue survive into the tag?

The #519 class: PR #536 added the tray "Close Apps" item, PR #557 ("chore:
prepare 1.0.0 (version bump + changelog, not yet tagged)") silently deleted
those 7 lines, #519 was closed as completed citing #536, and it sat falsely
done for two months until an audit caught it.

No commit-message heuristic can catch that: the deletion happened inside a
version-bump commit and the word "revert" appears nowhere. So this asks the
only question that settles it: are the lines the PR added still in the ref?

A triage aid a human adjudicates, never a gate. See D3b in the
`simlauncher-smoke` skill for how to read the output.

    python scripts/survived.py <ref> <pr> [<pr> ...]
    python scripts/survived.py --selftest
"""
import re
import subprocess
import sys


class GitError(RuntimeError):
    pass


def git(*args, **kw):
    """Run git. Raises on failure rather than returning empty output.

    Treating a failure as empty output is how this tool would cry wolf: a
    mistyped ref makes `git show` fail, every line then reads as deleted, and
    a healthy release reports total loss. `allow_fail` is only for the one
    case where absence is a real answer (a path that does not exist at ref).
    """
    allow_fail = kw.pop("allow_fail", False)
    p = subprocess.run(
        ["git", *args], capture_output=True, text=True,
        encoding="utf-8", errors="replace",
    )
    if p.returncode != 0:
        if allow_fail:
            return None
        raise GitError("git %s failed (%d): %s" % (" ".join(args), p.returncode, p.stderr.strip()))
    return p.stdout


# A line is filler only if the WHOLE line is filler. Anchored with fullmatch:
# `.match()` would accept any line merely STARTING with a closing bracket, so
# `}, [gameId, isRunning, onLaunch]);` counted as trivial and was dropped from
# tracking, which is exactly the kind of substantive line this exists to catch.
#
# Comment prose is excluded too, and that is a judgement, not an oversight.
# The question this tool asks is whether the FIX survived. Explanatory comments
# get rewritten constantly, and counting them drowns the signal: #819 reported
# `kill.ts` 0/9 LOST, and all nine were JSDoc lines describing why a helper is
# not called. Genuinely deleted, and completely uninteresting.
TRIVIAL = re.compile(
    r"\s*(?:[}{)\]]+;?|\*/|/\*+|\*.*|//.*|import .+|export \{.*\}.*|)"
)

TEST_PATH = re.compile(r"(^|/)(tests?|__tests__|__mocks__)/|\.(test|spec)\.[jt]sx?$")


def is_substantive(body):
    stripped = body.strip()
    return len(stripped) >= 25 and not TRIVIAL.fullmatch(stripped)


def resolve_pr(ref, pr):
    """The squash commit for this PR, or None.

    Matched on the SUBJECT only, anchored to the trailing `(#N)` the squash
    merge appends. `git log --grep` otherwise scans full commit bodies, so a
    later commit merely mentioning #N would win, and `-1` would silently pick
    it. Ambiguity is reported, never resolved by taking the newest.
    """
    if not re.fullmatch(r"\d{1,7}", pr):
        raise GitError("not a PR number: %r" % pr)
    out = git("log", ref, "--format=%H\x1f%s")
    hits = [
        line.split("\x1f", 1)[0]
        for line in out.split("\n")
        if line and line.split("\x1f", 1)[-1].rstrip().endswith("(#%s)" % pr)
    ]
    if len(hits) > 1:
        raise GitError("#%s matches %d commits on %s: %s"
                       % (pr, len(hits), ref, ", ".join(h[:7] for h in hits)))
    return hits[0] if hits else None


def added_lines(sha):
    """Substantive lines this commit introduced, grouped by file."""
    out = git("show", "--first-parent", "--format=", "--unified=0", sha)
    by_file, cur = {}, None
    for line in out.split("\n"):
        if line.startswith("+++ b/"):
            cur = line[6:].strip()
            by_file.setdefault(cur, [])
        elif line.startswith("+") and not line.startswith("+++") and cur:
            body = line[1:]
            if is_substantive(body):
                by_file[cur].append(body.strip())
    return {f: v for f, v in by_file.items() if v}


def survives(ref, path, lines):
    """(kept, moved, lost) for these lines at ref.

    Whole-line comparison with each target line consumed once. A substring
    test would count a short added line that happens to appear inside a longer
    one, and would count many duplicate source lines against a single target.

    A line absent from its own file is looked for anywhere in the tree before
    being called lost: #819 reads 0/9 on `kill.ts` only because those lines
    MOVED in the #773 helper extraction.
    """
    blob = git("show", "%s:%s" % (ref, path), allow_fail=True)
    pool = {}
    if blob:
        for l in blob.split("\n"):
            s = l.strip()
            if s:
                pool[s] = pool.get(s, 0) + 1

    kept, absent = 0, []
    for l in lines:
        if pool.get(l, 0) > 0:
            pool[l] -= 1
            kept += 1
        else:
            absent.append(l)

    moved = 0
    for l in absent:
        found = git("grep", "-F", "--quiet", l, ref, allow_fail=True)
        if found is not None:
            moved += 1
    return kept, moved, len(lines) - kept - moved


def report(ref, pr):
    try:
        sha = resolve_pr(ref, pr)
    except GitError as e:
        print("PR #%-4s  ERROR: %s" % (pr, e))
        return
    if not sha:
        print("PR #%-4s  no squash commit ending in (#%s) on %s" % (pr, pr, ref))
        return

    files = added_lines(sha)
    if not files:
        print("PR #%-4s  %s  no substantive added lines to check" % (pr, sha[:7]))
        return

    # Test-only losses never escalate on their own: tests get rewritten and
    # moved routinely, and in the real #519 case the src/ evidence was already
    # conclusive. They stay in the report, out of the verdict.
    src_kept = src_tot = 0
    notes = []
    escalate = False
    for path, lines in sorted(files.items()):
        kept, moved, lost = survives(ref, path, lines)
        n = len(lines)
        test = bool(TEST_PATH.search(path))
        if not test:
            src_kept += kept
            src_tot += n
        if lost:
            tag = "test" if test else "SRC "
            notes.append("      [%s] %-46s %d/%d live, %d moved, %d LOST"
                         % (tag, path, kept, n, moved, lost))
            if not test and lost >= 5 and kept == 0:
                escalate = True

    pct = 100.0 * src_kept / src_tot if src_tot else 100.0
    if src_tot and pct < 50:
        escalate = True
    verdict = "!! ADJUDICATE" if escalate else "ok           "
    print("PR #%-4s  %s  %s  src %d/%d live (%.0f%%)"
          % (pr, sha[:7], verdict, src_kept, src_tot, pct))
    for n in notes:
        print(n)


SELFTEST = [
    # (ref, pr, must_escalate, why)
    ("v1.1.0", "536", True,
     "the #519 loss as it stood: closeApps.ts deleted by #557, not yet re-landed"),
    ("origin/main", "536", False,
     "same PR after #819 re-landed it"),
    ("origin/main", "893", False,
     "healthy control, nothing removed"),
    ("origin/main", "819", False,
     "false-positive control: reported 0/9 on kill.ts while all nine were JSDoc"),
]


def selftest():
    """The red case is the point. A check only ever seen passing proves nothing."""
    import io
    from contextlib import redirect_stdout

    ok = True
    for ref, pr, must_escalate, why in SELFTEST:
        buf = io.StringIO()
        try:
            with redirect_stdout(buf):
                report(ref, pr)
        except GitError as e:
            print("SKIP  %s #%s: %s" % (ref, pr, e))
            continue
        out = buf.getvalue()
        got = "!! ADJUDICATE" in out
        good = got == must_escalate
        ok = ok and good
        print("%s  %s #%-4s expected %s\n      %s\n%s"
              % ("PASS" if good else "FAIL", ref, pr,
                 "ADJUDICATE" if must_escalate else "ok", why, out.rstrip()))
    return 0 if ok else 1


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)
    if args[0] == "--selftest":
        sys.exit(selftest())
    if len(args) < 2:
        print("usage: survived.py <ref> <pr> [<pr> ...]   |   survived.py --selftest")
        sys.exit(2)
    for pr in args[1:]:
        report(args[0], pr)
