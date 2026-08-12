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

**None open.** The last lane (`claude/compy-foreground-courtesy-rebuild-60b17e`, PR #102) merged as
`3d5b8d73` on 2026-08-11: the quiet launch rebuilt where it can actually work, the four PR #90
defects re-proven and repaired, and three gates that had drifted off the real repo. The build on the
owner's desk is `3155c7a0 · release` and its self-review is a PASS.

A fresh session should NOT resume from this file. Read `CLAUDE.md`, then `docs/RELEASE_STATE.md`
(live gate state) and `docs/BACKLOG.md` (what to pick up next).

## Do NOT

- Do not append to this file — replace it. It is the *current* lane's state, never a log.
- Do not treat this "none open" note as evidence that nothing is in flight: `docs/WORK_CONTROL.md`
  and `git branch -a` are what say whether another lane holds a claim.
