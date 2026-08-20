# Session handoff — 2026-08-20 (the comprehensibility sweep is queued; a fresh session runs it)

**Worktree** `C:\Users\Kuya\code\sentinel-home-room`. `main` is checked out by
`C:\Users\Kuya\code\sentinel`, which is why this worktree keeps a lane branch.

## Start here

Read [`superpowers/plans/2026-08-20-comprehensibility-sweep.md`](superpowers/plans/2026-08-20-comprehensibility-sweep.md)
and execute it. Tracking issue [#180](https://github.com/Pootytxng/sentinel/issues/180).
It is item zero of `BACKLOG.md`'s NEXT UP queue and outranks every numbered row there.

## Why it jumped the queue

The owner tried the installed `1d5b3c4c` build and gave a standing directive:

> "the absolute number 1 priority ... familiarity, navigability, user intuitive and
> comprehensibility throughout any function or text or tool etc.... in the app the goal is to make
> the app universally valuable and easy to operate/interprate whilst appealing to a optimal mass
> variety of consumer types."

The queue that preceded it was almost entirely gate/governance work (#171, #121, #126, #156, #128,
#125) — none of it visible in the app. Those rows keep their order relative to each other, one rank
lower. **#171 stays flagged:** `verify-local` invents failures under concurrent lane load, so a
random red mid-sweep is that flake, never a licence to wave a real regression through.

## The four things he said, and what each turned out to be

1. **"i like it i just dont like the placement for the help me with my pc"** — the yes on
   `compy_home_interview`. The default flips ON, bound to the lane that fixes the button placement
   first, so the Home that ships on by default is the version he approved. Record:
   [`decisions/2026-08-20-home-interview-default.md`](decisions/2026-08-20-home-interview-default.md).
   `OWNER_ACTION_CHECKLIST.md` §D is closed.
2. **The applied-changes block with the fine-print paragraph under it, on Home** — he called it
   unappealing. Taste call, mine to make; it needs a before/after he can veto on sight.
3. **"the jarvis toggle is back in the settings"** — **not drift.** `git log -S` over
   `Settings.tsx` and `en/settings.json` puts `jarvisMotion`, `monitorConsole` and `expertView` in
   exactly two commits each, the one that added them and the zh-CN i18n pass. None was ever removed.
   The real finding his instinct pointed at: they are **rollout** switches that shipped DEFAULT OFF,
   graduated to default-ON, and kept their switch, so Settings mixes developer-era forks with
   genuine preferences and a normal user cannot tell which is which.
4. **Live's Basic/Advanced tabs** — correct, and the fork is unconditional in `MonitorV2.tsx` today.
   Same defect class as 3. Diff `MonitorBasic.tsx` against Advanced **before** deleting: the ask is
   to remove the fork, not to lose content.

## Landed in this lane (docs only)

`14fc9a4d` — the queue re-rank, the plan, the decision amendment, the checklist close, the
`UI_VISION_BACKLOG` FOUNDATION-1 ③ update, plus the two `.claude/work-control/` receipts from the
#178/#179 chain that by design could not ride the heads they authorize.

**Verified:** pre-push gate at `14fc9a4d` — `LOCAL CHECK RESULT: PASS`, Rust 963/0, clippy clean.
`doc-budget: ALL PASS` (`BACKLOG.md` is tight at 112.9KB/114KB — archive before adding prose there).
`branch-disposition-audit: OK`.

## State

- `origin/main` was `c13f6223` when this lane cut.
- Desk build **`1d5b3c4c`**, one installer on the Desktop, stamp-proved live == build.
- **Nothing is waiting on the owner.** §D closed; the remaining `OWNER_ACTION_CHECKLIST` items are
  the long-standing §A/§B/§C ones, none of which block this sweep.

## Paste-ready prompt for the next session

> Read `docs/superpowers/plans/2026-08-20-comprehensibility-sweep.md` and execute it end to end —
> issue #180. Build it, gate it, self-review it, ship it to the desk with `ship-reinstall.ps1`, and
> send me a before/after for the Home changes. Do not stop between sections A–D.
