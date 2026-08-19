# Session handoff — 2026-08-19 (the last idle frame loop: issue #142 filed and fixed)

**Lane CLOSED.** Work landed on `main`, tree clean. Nothing is half-finished and nothing is waiting
on the owner.

## What happened

**One item, taken as the recommended next step: `ReticleCursor`'s idle cost — measured on the
previous train, filed here as [#142](https://github.com/Pootytxng/sentinel/issues/142), fixed, and
guarded.**

1. **The defect.** The reticle starts a rAF loop on `pointerenter` and only stops it on
   `pointerleave`. Its lerp (`rx += (tx - rx) * 0.35`) converges asymptotically and never arrives, so
   there was no self-terminating condition: a pointer merely RESTING inside the window held the loop
   open for the whole visit, writing a `transform` every frame to produce identical pixels.
2. **Measured on the shipped binary** — installed v0.9.26 (`5e64074c`), launched by
   `scripts/q7-probe.mjs` with a debug port, `requestAnimationFrame` wrapped in the live page and
   scheduling calls counted over 3s windows:
   | pointer state | rAF calls/s |
   |---|---|
   | resting outside the window | 0 |
   | resting motionless inside | **250** (750 frames / 3s) |
   The zero row is the point: after #127 Compy's idle frame cost is genuinely zero, and this was the
   only loop that turned it back on — which the pointer does most of the time the app is open.
   *Instrument note:* counting `style` attribute mutations instead reads a misleading 0 — once the
   lerp underflows, the written string is byte-identical and Blink files no mutation record while the
   loop still runs. Count rAF scheduling calls.
3. **The fix** (`src/design/console/ReticleCursor.tsx`): park at sub-pixel distance — snap exactly
   onto the target, write once, stop scheduling — and `wake()` from move/enter/over/out. A snap-scale
   change is one frame of work, not a reason to hold the loop open. Pixel output is unchanged.
4. **The guard** (bug→guard, before the fix counted):
   `src/design/console/reticle-idle-guard.test.tsx` drives the component's real effect through a fake
   frame scheduler — parks · wakes · still repaints the corner-spread · still cancels on leave.
   Falsified against the pre-fix source: the first three go red, the pointerleave test stays green.
5. **The probe launch was put back** — `node scripts/q7-probe.mjs restore`, `debugPortStillOpen:
   false`. No debugging port is left on the owner's desk build.

## State

- `docs/BACKLOG.md` cycle **2026-08-19c**; cycle 2026-08-19b moved verbatim to
  `docs/BACKLOG_ARCHIVE.md` — the ledger was 0.5KB from its byte wall. `doc-budget.ps1` ALL PASS.
- `docs/RELEASE_STATE.md` untouched: no gate moved, no artifact changed. The fix is on `main` and is
  **not in any published build** — it ships with the next release cut (current fleet: v0.9.26).
- This session started **without a launch token** (not started through `compy-entry.ps1`). Folder
  (`c:\Users\Kuya\code\sentinel`), branch (`main`) and a clean tree were verified, and no open
  `work-control` issue claimed an overlapping lane, so work proceeded; no claim was registered.

## Known, not chased here

- No visual review was run: the change removes frames that produced no pixel change, so there is
  nothing to look at (memory: dont-launch-build-without-visual-change). The fixed build's live rAF
  number will be confirmable after the next install with the same probe expression recorded in #142.
- #121 (in-process window raise under load) and #140 (CPU temp / PawnIO) are untouched and open.
- The fleet is offered v0.9.26; no tester is known to have updated past 0.9.12.

## Next session

Take the next non-gated `[ ]` in `docs/BACKLOG.md`. Nothing from this lane carries forward.
