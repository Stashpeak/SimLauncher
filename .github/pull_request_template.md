Closes #

## What does this PR do?

<!-- Brief description of the change. -->

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / cleanup
- [ ] Docs / config

## Smoke check

<!--
Tick exactly ONE box below and write the text after it.

You are only asked this when the PR touches something a user can reach. A PR
that changes only tests, docs, CI, Markdown, editor dotfiles or tsconfig is not
asked, and you can leave this section untouched: CI works that out from the
diff, so there is nothing to declare and nothing to skip.

This is the input to the next release's smoke run sheet. The delta section of
`internal-docs/SimLauncher/QA/<version> Smoke Test.md` is built by reading these
blocks out of every PR merged since the last tag, so an in-scope PR without one
is a coverage hole that nothing can see: the smoke document still looks complete.

That is not hypothetical. #677 and #766 both shipped in 1.2.0 with no smoke check
anywhere, because their PRs carried no note, and the gap sat in the same area
where a real defect (#878) was later found by accident rather than by a check.

"Needs no manual check" is a perfectly good answer for an internal refactor.
Saying so explicitly is the point: it is the difference between "covered" and
"nobody looked". It is also adjudicated against the diff at release time, so a
wrong "needs none" gets named in the run-sheet closeout rather than never.
-->

- [ ] **Needs no manual check.** <!-- smoke:none --> Reason:
- [ ] **Needs a manual check.** <!-- smoke:check --> What to do, and what a correct result looks like:

## Checklist

- [ ] `npm run build` passes
- [ ] `npm run typecheck` passes
- [ ] `npm run format:check` passes
- [ ] Tested manually

## Screenshots

<!-- If this changes the UI, add a before/after screenshot. -->
