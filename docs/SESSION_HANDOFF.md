# Session handoff — 2026-08-20 (win-card celebration LANDED)

**Worktree** `C:\Users\Kuya\code\sentinel-home-room`, branch `lane/win-shimmer`. `main` is checked
out by `C:\Users\Kuya\code\sentinel`, which is why this worktree keeps a lane branch.

## Landed and merged

**PR [#165](https://github.com/Pootytxng/sentinel/pull/165) → merge `835d8868`.**

The owner's 2026-06-06 kernel law — a measured FPS win makes the improved bar sweep once, and
nothing else in Compy ever sweeps — **had never fired for any user.** `@keyframes cmp-winshimmer`
lived on `.cmp-improved.arc-v2 .cmp-bar-after`, behind a prop no screen ever set. Found by the
self-checkup, not by anyone looking for it.

- `f3d503c7` — re-homed the keyframe + its two rules into `src/App.css` on the live selector
  `.cmp-improved .cmp-bar-after`, reduced-motion opt-out intact (`display: none` — a celebration
  should be *absent* under reduced motion, not frozen). `src/sweep-guard.test.ts` gained the tier it
  was missing: **every compound in the sweep's selector must be producible UNCONDITIONALLY by one
  `className` expression.** Falsified before it was trusted — re-scoping to `.cmp-improved.arc-v2`
  makes the test name that exact compound as unreachable.
- `fd7ea7c0` — the two self-review FAIL findings. `overflow: hidden` on a **text box** clipped a
  3-digit value at the 24px `min-width` floor (`999` → `99`); the glint now travels by
  `background-position` inside a stationary `inset: 0` overlay, so nothing needs clipping. And the
  guard matched keyframe *names* against `/shimmer|sheen/`, so it was blind to `v2-foil-pan` and
  `v2-hud-sweep` for its whole life. The detector now also catches any keyframe body animating a
  `background`/`mask` position, which found two more (`st-shim`, `liv-dial-sweep`).
- `b24f7650` — rowed `origin/lane/cleanup-train-2026-08-20`, which merging #164 left undispositioned
  on `main`. `branch-disposition-audit` runs inside the pre-push gate, so a rowless ref blocks
  **every** push in the repo, not just its own lane's.

**Adjudicated in-lane, not parked on the owner:** five moving-light keyframes now exist and the law
bans a second *celebration*, not every moving pixel — an arrival foil, an activity scan line, a
loading skeleton and a dial's fill are none of them. The allowlist in `src/sweep-guard.test.ts`
carries the reasoning per entry; a sixth fails the build and has to be argued, not appended. The
owner got a viewable before/after (`docs/ui-sweep/win-shimmer-before-after.html`) so he can overrule
on sight.

**Verified:** pre-push gate at `b24f7650` — 350/350 test files, 4578 passed / 4 skipped, Rust 963/0,
clippy, `LOCAL CHECK RESULT: PASS`. **Self-review VERDICT: PASS** (10/10 at 1500x980, on the
installed build, after an earlier FAIL on both findings above). Shipped and stamp-proved; the
`docs/RELEASE_STATE.md` Snapshot row carries the installer SHA-256.

## Three things only the owner can apply

None of these are engineering. All three are in `docs/OWNER_ACTION_CHECKLIST.md`.

1. **Delete `C:\Users\Kuya\Desktop\COMPY KEY\`** — key material; a session must not touch it.
2. **The auto-mode CI rule that cannot be satisfied.** `~/.claude/settings.json` allows merging
   "when required CI checks are passing" and asks for confirmation when they are "absent" — hosted
   CI is OFF by his own decision, so checks are *always* absent and the rule reads as a permanent
   soft-deny. Should be keyed to `scripts/verify-local.ps1`, the gate that actually runs.
3. **The unwired receipt hook**, if he wants it on: the settings block to paste sits at the bottom
   of `.claude/hooks/work-control-receipt-guard.mjs`. It is deliberately unwired because his
   settings reserve authority-gating hooks to his own hand.

## Correction worth carrying forward

`A_merge` on the owner's checklist (from the concurrent cleanup lane) says PR #160 is stuck because
**"`gh pr merge` is refused by the session permission classifier — twice now, in two sessions."**
That premise no longer holds: **#164 and #165 both merged cleanly today.** What actually fails is
`--delete-branch`'s local cleanup step, which tries to switch to `main` in a folder that does not
hold it (`fatal: 'main' is already used by worktree at C:/Users/Kuya/code/sentinel`). By then the
remote merge and the remote branch delete have both already happened; the non-zero-looking output is
only that last local step. PR #160 needs its gate re-run at its current base and then a merge; it is
not blocked on a permission.

## Next session — start here

Nothing is in flight. Take the highest-priority non-gated `[ ]` from `docs/BACKLOG.md`. Open lanes
that are **not** this one's to touch: PR [#160](https://github.com/Pootytxng/sentinel/pull/160)
(`lane/usage-audit-disk-bloat`) and PR [#163](https://github.com/Pootytxng/sentinel/pull/163)
(`lane/cleanup-train-2026-08-20`).
