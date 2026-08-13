# Session Handoff

> **REPLACE this file's content every time you write it — never append.** It holds only the
> *current* lane's state, not a log. One lane at a time. When the lane lands (merged + branch
> deleted), clear this file back to the template in git history.
>
> Written by `.claude/hooks/context-size-advisor.mjs` when it detects context-thrash (fast
> drop→refill cycles with no real headroom gained — see `scripts/lib/context-thrash.mjs`), and by
> any session that sees its own context filling fast. Read this FIRST on a fresh session that
> mentions "continue" or "resume" with no other lead. Budget: 120 lines
> (`scripts/doc-budget.ps1`) — if you're about to blow it, cut detail, don't skip the write.

## Lane

**None open.** The last lane (`claude/bento-conversion`, PR #120) closed the bento conversion's
follow-ups: the Lab rig picker's `data-rig-part` hooks with a behavioural guard, and the fixture
preview that finally let the two experiment-bench states nobody could reach be looked at. Both
carry a self-review PASS. It merged after taking `origin/main` (PR #119, the popout convergence) —
the only conflict was `docs/RELEASE_STATE.md`, where the lane's desk-ship row and main's v0.9.17
publish row both claimed the owner's machine; resolved by reading the stamp out of the installed
binary rather than trusting either doc.

The build on the owner's desk is `a71b377c · release · shell 0.9.15` — an **unsigned desk-only**
build cut from this lane, so the desk sits ahead of the published fleet build v0.9.17 (`a614744c`).
A publish must re-cut from `main` with the owner's signing key.

A fresh session should NOT resume from this file. Read `CLAUDE.md`, then `docs/RELEASE_STATE.md`
(live gate state) and `docs/BACKLOG.md` (what to pick up next).

## Do NOT

- Do not append to this file — replace it. It is the *current* lane's state, never a log.
- Do not treat this "none open" note as evidence that nothing is in flight: `docs/WORK_CONTROL.md`
  and `git branch -a` are what say whether another lane holds a claim.
