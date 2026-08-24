# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where the train is standing

**Issue #49 — the approved four-room visual direction.**
Worktree `C:\Users\Kuya\code\sentinel-fourroom` · branch `feat/four-room-visual-direction`.
**Installed desk build `8b1599b3`** — stamp-proved live (`8b1599b3 · release · shell 0.9.26`).

**HEAD `c725c0a6` IS AHEAD OF THE DESK, and it is a UI change.** `git diff 8b1599b3 -- src` is no
longer test-only: `FpsTrace` is real screen code the owner's installed app does not have. Do not
describe the desk as current until it is rebuilt.

Slices 1–8 all ✅ (`34bd33e7` · `40aca1ca` · `acdb93c2` · `67ce2724` · `c894e81c` · `8c9fb804` ·
`0c550138` · `8b1599b3`). Then `b9bfcaf3` ship docs · `dae29252` Codex 4–8 · `7008c9b0` lane docs.

## What this session did

**`c725c0a6` — Live finally draws the session trace.** BACKLOG §A2's open row, and the last real
gap between the shipped four rooms and the brief. `fps_series` had been persisted for weeks and
`grep -r fps_series src/` returned the `types.ts:179` declaration and nothing else.

- `src/design/FpsTrace.tsx` + `.css`, geometry in `traceGeometry` (`src/design/geometry.ts`),
  mounted in `SessionDebrief` between the summary tiles and the analysis.
- **Not `<Sparkline>`, deliberately** — that takes `number[]` and steps x by index, which would
  slide every post-gap sample leftward AND draw a straight line across unmeasured minutes.
- Three honesty properties, each falsified by injecting the real defect: a missing bucket **ends
  the run** (mutant: 7 red) · a gap-isolated sample becomes a **dot**, never dropped (5 red) · the
  value axis is **anchored at 0**, not min-max normalised (1 red). Empty series says *"No trace
  kept for this session"*, never a flat line at zero (2 red).
- 22 new guards, en + zh-CN copy, a11y census (rostered, both faces) + mono census updated.

**Lane bookkeeping.** #49's claim had expired 2026-08-23, which made it unavailable in the launcher
menu (`select.mjs:121`). A **Verified takeover** note (WORK_CONTROL §Collision rule 5) is posted on
the issue with the evidence, the claim runs to **2026-08-25**, and `Next action` is updated.

## ⛔ The one thing blocking "done" — and it is not the owner's

**`c725c0a6` HAS NOT BEEN VISUALLY SELF-REVIEWED.** The standing law (2026-06-20) requires a
`self-review` round in the `self-reviewer` subagent — never inline — before a UI change may be
called done, reinstalled, or shipped. The session that built it **could not spawn subagents**, so:

- the BACKLOG §A2 box stays `[ ]`, annotated `BUILT, not yet visually self-reviewed`;
- **nothing was shipped.** No `npm run tauri build`, no `ship-reinstall.ps1`. The desk is untouched
  and still runs `8b1599b3` — correctly, because shipping unreviewed UI is what that law prevents.

**Exact next action:** run `self-review` on `FpsTrace` against a build of `c725c0a6`, then
`scripts/ship-reinstall.ps1 -VerifyRuntime`, then close the BACKLOG box. That is the whole of it.

The owner has already SEEN the change — a preview page rendered from the real component and the
real tokens (five data shapes, including both gap cases and the empty state) was handed over this
session. Seeing is not the self-review round; the rubric still has to run.

## ⛔ What is still the owner's

**Two taste calls, unchanged from last session** (`two-taste-calls.html` was handed over then):
Test's bench readings, and Health's headline naming the flagged check. Both shipped under the taste
decree — deciding was mine, seeing is his. Say the word and either goes back.

Everything else parked on him is closed.

## Traps this session actually hit

- **`cli.mjs adopt` refuses `ADOPT_FOLDER_CLAIMED`** while the previous conversation's lineage
  record is still inside its 12h TTL (`%LOCALAPPDATA%\CompyEntry\sessions\*.json`), even when that
  conversation is provably gone. The tool offers no release — only "let it lapse". The **board**
  claim is the one-writer authority; the record is a cache. Do not delete it to force an adopt.
- **A session rooted in a SIBLING worktree** (e.g. `sentinel-home-room`) loads this repo's
  CLAUDE.md, hooks and memory — but `project-write-assert` guards the **session root only**, so
  writes to `sentinel-fourroom` are outside its jurisdiction. Self-enforce; say so in the report.
- **`npx tsc --noEmit` is a false green here.** `npm run build` is the typecheck.
- Vitest renders `t()` as the raw KEY unless the test imports `../i18n`. Asserting on English is
  what proves a key exists — a typo ships as `common.fpsTrace.aria` and passes every other check.
- **A red pre-push gate you did not cause.** `branch-disposition-audit` reads this checkout's
  `refs/remotes/origin` cache, so a branch ANOTHER lane already deleted on origin still accuses you.
  `git fetch origin --prune` cleared it and 27 tests went green with no code change. Fixed at
  `cf710027` — the message now leads with the prune and stops claiming the ref "exists on origin".

## Verification at HEAD — all green

`npm run build` exit 0 · full pre-push gate **PASS, no skips** at `cf710027` (frontend 5033 passed /
5 skipped · Rust 964 passed, 0 failed · clippy clean) · `pwsh scripts/doc-budget.ps1` ALL PASS.
`npm run tauri build` was **not run** this session — nothing reached the owner's desk.

## Standing constraints for whoever picks this up

**The owner's standard, verbatim:** *"this is exactly how its supposed to look and it still isnt quite
there not sure how you werent able to match this perfectly but it needs to to suffice. what should
remain is the color coded system we have for alert levels such as green yellow red for optimal metrics
and notifications please persist with this train until youve perfected your work"*

**Comps** (the only source of truth for the look):
`C:\Users\Kuya\.codex\visualizations\2026\08\23\01a02bee-5474-7961-b05a-e674fb8bb165\compy-four-room-handoff\`
`01-health` → room id **`home`** · `02-live` → **`play`** · `03-history` → **`learn`** · `04-test` → **`lab`**.
Room ids are not tab labels: `lab` is the tab the owner sees as **Test**. The PNGs are **1550px renders
of a 1500px design — divide by 1.0333.** Brightness deltas vs a screenshot are gamma, not findings.

**Headline sizes, settled:** `Home 52 · Live 40 · History 40 · Test 52` — the guard's own comp reading
(`comp-fidelity-guard.test.ts:300`).

**Every write here needs a verified session.** After a compaction or a new window:
`node tools/entry/cli.mjs adopt --folder "C:\Users\Kuya\code\sentinel-fourroom" --issue 49 --session <id>`.
`Bash` is the named hole in the write guard — adopt before the first `sed`, not after.

## This session: leave open.

One step remains and it is ours, not his: self-review `c725c0a6`, ship it, close the §A2 box.
