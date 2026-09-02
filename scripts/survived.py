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


_ROOT = []


def root():
    """The repository root, so results never depend on where this was launched.

    Git commands that search the tree are scoped to the current directory even
    when handed a tree-ish, so results would otherwise depend on where the
    script was launched from. Measured: `git grep -F -e AUTO_CLOSE_GRACE_MS
    origin/main` returns nothing from `scripts/` and three hits from the root.
    Nothing here greps any more, but pinning the working directory is a
    one-line guarantee that the next command added cannot reintroduce it.
    """
    if not _ROOT:
        p = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"], capture_output=True,
            text=True, encoding="utf-8", errors="replace",
        )
        if p.returncode != 0:
            raise GitError("not inside a git repository: %s" % p.stderr.strip())
        _ROOT.append(p.stdout.strip())
    return _ROOT[0]


def git(*args, **kw):
    """Run git. Raises on failure rather than returning empty output.

    Treating a failure as empty output is how this tool would cry wolf: a
    mistyped ref makes `git show` fail, every line then reads as deleted, and
    a healthy release reports total loss. `allow_fail` is only for the one
    case where absence is a real answer (a path that does not exist at ref).
    """
    allow_fail = kw.pop("allow_fail", False)
    p = subprocess.run(
        ["git", "-C", root(), *args], capture_output=True, text=True,
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

# Generated files and prose are reported but never judged. A lockfile is
# rewritten wholesale by npm and a document is rewritten by hand, so neither
# says anything about whether the FIX survived, and both are big enough to
# decide the aggregate on their own. Measured at 3a4ada1: PR #703 read 5% live
# because package-lock.json contributed 222 of its 227 lines, and PR #728
# escalated on 11 deleted CONTRIBUTING.md lines while its real source loss was
# 5, four in config.ts and one in AppsSection.tsx. Both are routine cleanup,
# and both are exactly the false alarm this tool exists to avoid.
#
# A blocklist, deliberately. An allowlist of known code extensions would fail
# SILENT on an unlisted one, reporting "ok" for a fix that was deleted, which
# is the failure this tool was written to catch. A blocklist fails the other
# way: an unknown generated file makes noise that a human dismisses in a glance.
#
# `svg` is here for the same reason as `md`, and by extension rather than by
# directory. Measured: `docs/playbutton.svg` is 5 substantive lines, so redrawing
# the README logo would report 5 of 5 source lines lost and escalate a docs-only
# change. Excluding the `docs/` tree instead would have missed the repo's other
# SVG, `assets/SimLauncher_Playbutton_Ghost.svg`, which has the same problem in
# a directory that legitimately holds shipped files. Binary assets never reach
# here: `git show --unified=0` emits no `+` lines for them.
GENERATED = re.compile(
    r"(^|/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$|\.(md|svg|lock|snap)$"
)


def classify(path):
    """`SRC ` counts toward the verdict. `test` and `gen ` are reported only."""
    if TEST_PATH.search(path):
        return "test"
    if GENERATED.search(path):
        return "gen "
    return "SRC "


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
    """(kept, lost) for these lines at ref.

    Whole-line comparison with each target line consumed once. A substring test
    would count a short added line that happens to appear inside a longer one,
    and would count many duplicate source lines against a single target.

    There is deliberately NO tree-wide search for relocated lines. One was
    built and then measured: against every validated case it changed nothing.
    The #519 loss still fires without it, and PR #821, the real #773 helper
    extraction it was written for, still reads 99%. It produced five of this
    PR's ten review findings on its own, including an ordering bug introduced
    while fixing one of the others. A relocation is rare, and the human
    adjudication step in D3b catches it with one `git grep` in about a minute.
    """
    blob = git("show", "%s:%s" % (ref, path), allow_fail=True)
    pool = {}
    if blob:
        for i, existing in enumerate(blob.split("\n"), 1):
            s = existing.strip()
            if s:
                pool.setdefault(s, []).append(str(i))

    kept = 0
    for line in lines:
        occurrences = pool.get(line)
        if occurrences:
            occurrences.pop()
            kept += 1
    return kept, len(lines) - kept


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
    src_live = src_tot = 0
    notes = []
    examined = []
    escalate = False
    for path, lines in sorted(files.items()):
        kept, lost = survives(ref, path, lines)
        n = len(lines)
        kind = classify(path)
        row = "      [%s] %-46s %d/%d live" % (kind, path, kept, n)
        if lost:
            row += ", %d LOST" % lost
        examined.append(row)
        if kind == "SRC ":
            src_live += kept
            src_tot += n
        if lost:
            notes.append(row)
            # A STRICT majority gone, not a total wipe, and not exactly half:
            # `>=` escalated a 5-of-10 partial loss, which is not a majority.
            #
            # The earlier form of this rule demanded ZERO survivors, and a
            # single incidental match was enough to disarm it on the real #519
            # loss. The selftest caught that, which is the whole argument for
            # having one: the fix that introduced it was itself a correct fix.
            if kind == "SRC " and lost >= 5 and lost * 2 > n:
                escalate = True

    # No source lines means this tool has no opinion, and it has to SAY so.
    # Printing "ok ... 0/0 live (100%)" is the same failure as a self-test that
    # passes without running: it certifies precisely what it never looked at.
    #
    # This branch lists EVERY file it looked at, losses or not, which the normal
    # report deliberately does not. When the tool declines to judge, the reader
    # has to be able to check that it was right to decline, and "tests/generated
    # only" is a claim about files it does not otherwise name.
    if not src_tot:
        print("PR #%-4s  %s  no source lines to judge (tests/generated only)"
              % (pr, sha[:7]))
        for row in examined:
            print(row)
        return

    # The same small-sample floor the per-file rule already carries. Without it
    # a 5-line source footprint escalates on 3 lines: PR #703 is a dependency
    # bump whose only source lines are 3 in package.json, which the NEXT bump
    # rewrites by definition. A fix that small is caught by the per-file rule
    # or not at all, so the aggregate has nothing to add below this size.
    pct = 100.0 * src_live / src_tot
    if src_tot >= 10 and pct < 50:
        escalate = True
    verdict = "!! ADJUDICATE" if escalate else "ok           "
    print("PR #%-4s  %s  %s  src %d/%d live (%.0f%%)"
          % (pr, sha[:7], verdict, src_live, src_tot, pct))
    for note in notes:
        print(note)


# Every ref below is immutable. These started on `origin/main`, which drifts:
# a later legitimate refactor touching lines these PRs added would fail the
# suite with nothing wrong in this script, and the answer changed with how
# recently the clone had fetched, so two people could run it and disagree.
# A tag where one exists, a full commit id where none does: #893 landed one
# commit after v1.2.0 was cut, so it has no tag to hang on.
SELFTEST = [
    # (ref, pr, must_escalate, why)
    ("v1.1.0", "536", True,
     "the #519 loss as it stood: closeApps.ts deleted by #557, not yet re-landed"),
    ("v1.2.0", "536", False,
     "same PR after #819 re-landed it"),
    ("3a4ada1cf91c22f9f5897096299225843103ca34", "893", False,
     "healthy control, nothing removed"),
    ("v1.2.0", "819", False,
     "false-positive control: reported 0/9 on kill.ts while all nine were JSDoc"),
]


def selftest():
    """The red case is the point. A check only ever seen passing proves nothing."""
    import io
    from contextlib import redirect_stdout

    ok = True
    for ref, pr, must_escalate, why in SELFTEST:
        buf = io.StringIO()
        err = None
        try:
            with redirect_stdout(buf):
                report(ref, pr)
        except GitError as e:
            err = str(e)
        out = buf.getvalue()

        # A case that never ran is a FAILURE, not a pass. report() catches its
        # own GitError and prints "ERROR", which contains no "!! ADJUDICATE", so
        # every must_escalate=False case used to pass without touching a fixture:
        # with origin/main missing, three controls "passed" unexecuted and the
        # suite exited 0. A self-test that can succeed without running is worse
        # than none, because it certifies the thing it never checked.
        if err or "ERROR:" in out or "no squash commit" in out:
            ok = False
            print("FAIL  %s #%-4s did not run\n      %s\n      %s"
                  % (ref, pr, why, (err or out.strip())))
            continue

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
