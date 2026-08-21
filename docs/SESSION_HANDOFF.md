# Session handoff — 2026-08-20 (evening): two LOCAL branches waiting on a free desk

**Worktree** `C:\Users\Kuya\code\sentinel-home-room`. Two branches, both cut from origin/main
`616c6fe2`, **both local only** — the pre-push gate is the full suite (launches compy, opens
console hosts) and the desk had a game in front all session (`METAL GEAR RISING` foreground,
compy PID 18088 running). **No launches of any kind while a game is in front** — that includes
pushing, building, installing, and the self-reviewer.

## Branch `lane/rail-door` — the visual train (foundation ⑤, checked out now)

- **`bcb1c690`** — instruments behind a door. The rail is no longer four equal tabs: Health is the
  front door at full weight; Live · History · Test sit under a "Look deeper" sign, quieter, never
  hidden (`railGroups` in `src/design/homeRail.ts`, two tablists in `ShellV2.tsx`,
  `.v2-nav-door`/`.v2-nav-instruments` in `shell-v2.css`, i18n `common.shellV2.deeperGroup`).
  Guards in `homeRail.test.ts` + `ShellV2.test.tsx`; tsc clean; `src/design` + `src/i18n` 608/608.
  UI_VISION_BACKLOG FOUNDATION-1 ⑤ annotated.
- **Owed:** `self-review` on an installed build (law), then `ship`. A static before/after rendered
  from the real stylesheet was handed to the owner for veto on sight; it is not the self-review.

## Branch `lane/focus-121` — the test-gate lane (parked, 5 commits)

- `adaa9a86` / `95e24fbc` — the WinEvent trace instrument (see BACKLOG #121 row).
- **`a370ed42`** — #121 decision 2 taken: `runtimeVerdict` reports a trace-proven foreground
  hand-off (`inherited-after-another-window-left`) as UNMEASURABLE by name instead of failing the
  push; every other reading keeps the poll's verdict. 42/42 in the file, two mutants caught.
- **Still open on #121 (do NOT re-open as a priority — it is gate plumbing, not product):** one
  deciding measured run with `COMPY_FOREGROUND_TRACE_DIR` set, then the sibling console-launch
  fix (CreateNoWindow) + a no-console-host guard if the trace confirms the lead.

## Next action, in order, when the desk is free (no compy running, no game in front)

1. `git push -u origin lane/rail-door` → PR → run `self-review` against a built+installed
   candidate → `ship` → merge green. *(Visual train first — this is the owner's standing priority.)*
2. `git push -u origin lane/focus-121` → PR → merge green (test-only).
3. Visual train continues: the ⭐ STANDING DIRECTIVE says Home got the intimidation/layout pass
   and the other rooms have not — Live, History, Test each owe one (grouping, boxed templates,
   fewer words; never a toggle). That needs eyes on the installed build, which is why it did not
   start blind tonight.

## Queue after this

`docs/BACKLOG.md`: #126, #156, #128, #125. Nothing blocked on the owner.
