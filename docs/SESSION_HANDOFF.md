# Session handoff — 2026-08-18 (conformance C-10 / C-11 / C-17)

**This lane is CLOSED.** PR [#139](https://github.com/Pootytxng/sentinel/pull/139) is merged to
`main` as `2f79febb`, the branch ref is deleted, its disposition row is dropped, and the owner's
desk build is rebuilt from `main` and runtime-proved. Nothing here is waiting on the next session.

## What shipped

- **C-10** — the last five native `<select>`s are gone. `src/design/Picker.tsx` is the app's one
  dropdown (portalled, token-drawn, ARIA APG select-only-combobox); `no-raw-select-guard.test.ts`
  bans the element under `src/`.
- **C-11** — repeated ledger applies collapse into one row. The owner's 64 applies (37 of them the
  same tweak) render as 17 rows instead of 30.
- **C-17** — the mono-is-for-machine-values law is a census with a down-only ratchet, not a comment.
- Follow-on fixes: `WhatChangedPanel` compares what the user is LOOKING at, not state one render
  behind; the Experiment Bench can clear a pick again.

## What the review round cost, and why it was worth it

Three independent review rounds: **REQUEST CHANGES** at `5d572db6` → APPROVE at `f88b25db` →
APPROVE at `640fb78e`. It found three blockers, two of them in guards I had just written:

1. `no-raw-select-guard` could not see a `<select` that ENDED a line — the scan splits on newlines
   and the lookahead had no character left. Its own mutation test passed because it fed the matcher
   a string that still carried its newline: a code path the real sweep never runs. One scanner now
   serves both, and the fix is disarm-probed.
2. `classifyForegroundReading` — mine, from earlier the same day — split a red gate green on a false
   premise. I claimed `firstForegroundMs < firstWindowMs` proved Windows fronted the launch. The
   probe polls at 100ms and, inside one iteration, reads the foreground first and the window second
   with a `Process.Refresh()` between them, so a 5ms lead is the loop's own ordering. It now needs a
   full poll of margin and reports `unattributable-at-launch` when it cannot tell.
3. `COMPY_REQUIRE_FOREGROUND_RUNTIME_PROOF` was documented as enforced by "the release gate". No
   release gate exists and nothing sets it. Said plainly now, in both places.

**Read that as a standing lesson: a guard's mutation test must run the guard's REAL code path.**
Feeding the matcher a hand-built string proves the matcher, not the guard.

## Open, and deliberately not closed here

- **#121 — Compy raises its own window ~120ms after it appears, under load.** Measured twice this
  session against the release binary (`132ms` / `128ms`, window at `13ms`). Pre-existing on `main`;
  this lane changed no `src-tauri`. The guard fails it correctly. Telling the two launch causes apart
  needs an `EVENT_SYSTEM_FOREGROUND` hook, not a finer reading of a 100ms poll. Detail in
  `docs/BACKLOG.md` under the `launch-focus-guard` row. **Do not close this with a skip.**
- **C-17b** — the 12 recorded mono-on-prose violations are still unpaid; none was reachable on a
  screen this lane could verify live.
- **C-04** — renaming Home to Health/Diagnosis is still owner territory for the WORD.
- The session's own working directory, `.claude/worktrees/data-root-integrity-432797`, **does not
  exist on disk**. Every git command silently resolved to the main checkout, which is where this work
  happened. If a future session is launched there, its project hooks and memory will not load
  (global law §5) — relaunch rooted at `c:\Users\Kuya\code\sentinel`.

## Owner's desk right now

`0.9.25`, embedded stamp `2f79febb`, installed silently, one installer on the Desktop, runtime proof
`2f79febb · release · shell 0.9.25`. Self-review verdict **PASS**. His only job is to look at it.

## Paste-ready prompt for the next session

> Read `docs/RELEASE_STATE.md` (gate matrix) then `docs/BACKLOG.md`. `main` is at `2f79febb`, clean,
> no open branch or PR; the C-10/C-11/C-17 conformance lane is merged and on the owner's desk.
> Take the next non-gated `[ ]` item. Two things to know before you touch the launch-focus guard:
> its runtime tier only measures when NO compy is running, and the ~120ms in-process window raise it
> catches under load is a real, open, pre-existing defect (#121) — not a flake, and not to be
> skipped. And when you write a guard, make its mutation test call the guard's own entry point: a
> hand-built string proved a matcher that the real scanner never reached, and it shipped green over a
> live blind spot.
