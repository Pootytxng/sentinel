# SESSION HANDOFF — paste-ready prompt for the next session

> Live pointer only. Gate truth: [`RELEASE_STATE.md`](RELEASE_STATE.md). Queue:
> [`BACKLOG.md`](BACKLOG.md) ▶ NEXT UP. Owner asks: [`OWNER_ACTION_CHECKLIST.md`](OWNER_ACTION_CHECKLIST.md).
> Budget 120 lines — trim from the bottom, never grow past it. Replace this file, never append.

## Where the train is standing

**Issue #49 — the approved four-room visual direction.**
Worktree `C:\Users\Kuya\code\sentinel-fourroom` · branch `feat/four-room-visual-direction`.
**HEAD `0c550138`** — built, silently installed, stamp-proved live (`0c550138 · release · shell 0.9.26`).
**UNPUSHED and UNDISTRIBUTED.** #49 authorized local implementation and its verification only.

Slices: 1 shell `34bd33e7` ✅ · 2 Health `40aca1ca` ✅ (round 11) · 3 instrument kit `acdb93c2` ✅
(round 12) · 4 Live `67ce2724` ✅ (round 13) · 5 History `c894e81c` ✅ · 6 Test `8c9fb804` ✅ ·
**7 convergence `0c550138` — installed, self-review round 16 PASS.** All seven slices built.

## The standard this train is held to

The owner put all four approved comps beside the installed build and said, verbatim:

> "this is exactly how its supposed to look and it still isnt quite there not sure how you werent
> able to match this perfectly but it needs to to suffice. what should remain is the color coded
> system we have for alert levels such as green yellow red for optimal metrics and notifications
> please persist with this train until youve perfected your work"

Comps + `HANDOFF.md` live in
`C:\Users\Kuya\.codex\visualizations\2026\08\23\01a02bee-5474-7961-b05a-e674fb8bb165\compy-four-room-handoff\`
(`01-health` → room `home`, `02-live` → `play`, `03-history` → `learn`, `04-test` → `lab`).
**Comp scale: the PNGs are 1550px renders of a 1500px design — divide every measurement by 1.0333.**
Do NOT report "the comp is brighter" as a finding; the PNGs are uniformly contrast-lifted.

## What `0c550138` changed (round 15's FAIL, all four findings)

Both severe findings were **cascade ties**, not missing declarations — the correct rule existed in
`shell-v2.css` and a later same-specificity rule beat it. A single-file source-text guard cannot see
that, which is why round 14 passed green while the app was broken on screen.

- `src/surfaces/home-console.css` — the `[data-room="home"] .v2-verdict` row rule (plus
  `h1:has(.hc-headline)` and the `-sub` rule) scoped `:not([data-layout="split"])`.
- `src/surfaces/home-hud.css` — its two Health verdict rules scoped the same way; that tie had not
  bitten yet, it was simply waiting.
- `src/surfaces/hud-rooms.css` — the three generic
  `:not([data-room="home"]):not([data-room="check"])` verdict rules now positively name
  `[data-room="fix"]`, the one room still wearing the HUD masthead register.
- **NEW** `src/surfaces/station-icons.tsx` — six SVG line marks measured out of
  `04-test-approved.png` (target · clipboard · framed trace · bolt · sliders · life ring), replacing
  the platform emoji. **Only the primary row is violet** — that is what the comp draws. The header
  comment carries the per-row pixel measurements. `Dock.tsx`'s `icon` is now a `ReactNode`.
- `lab.stations.*.dockLine` (en + zh-CN) — the comp's task-framed row subtitle. `whenLine` is
  **deliberately untouched**: it is what the command palette searches on, and the symptom words are
  how someone in trouble finds a station.
- **NEW** `src/design/room-eyebrow.tsx` + one rule in `shell-v2.css` — four private eyebrow copies
  (`.hc-masthead-eyebrow`, `.mc-masthead-eyebrow`, `.bbv2-eyebrow`, `.lc-eyebrow`) deleted; three of
  them had measurably drifted off their own comp. The header comment carries the measurement.

**Three new cascade guards** in `src/design/comp-fidelity-guard.test.ts` walk EVERY `.css` under
`src/` and ask what no single-file read can: whether anything outside the shell may re-wrap a split
verdict, size the four rooms' verdict type, or grow a room-private eyebrow again. **All three were
proved to FAIL by re-introducing each defect** — a guard that cannot fail is not a guard.

Verified on `0c550138`: `npm run build` clean · `npx vitest run` 369 files / 4948 passed, 6 skipped.
No Rust diff since `8c9fb804`, so `cargo test` was not re-run.

## NEXT ACTION (in order)

**Round 16 returned PASS** on the installed `0c550138`, measured at the owner's 1500×980 with
1280×720 and 1920×1080 spot-checked: Health's verdict computes `column`/`nowrap` with every child
inside the parent's 721.6px right edge (round 15: 749.6, clipped), h1s **52 · 52 · 40 · 40**, all
four subs **15px**, 6/6 station subtitles verbatim, eyebrow→headline gap 16px in all four rooms,
zero `HudMasthead` left in `src/`, `no-debug-port` CLEAN on teardown. `RELEASE_STATE.md:65` and
`UI_VISION_BACKLOG.md:25` are reconciled to it. So what is left is:

1. **Hand the head + evidence to Codex** for the independent visual and frontend-contract review the
   brief requires. "No new IPC" is already true from the branch diff — no `invoke` was added or
   changed on this branch — but the formal audit is still owed and is Codex's, not mine.
2. **Then the owner's call on pushing `feat/four-room-visual-direction`.** Do not push it without
   him: #49 authorized local implementation and its verification, explicitly not release.
3. If anything comes back from Codex: fix → rebuild → `scripts/ship-reinstall.ps1` → **re-dispatch a
   FULL fresh self-review**. Never re-approve off source inspection or green tsc/vitest — both
   round-15 regressions passed their existing guards while broken live.

## Deviations awaiting the owner's sign-off (do not silently resolve)

- Test's bench reads *Proven · Noise floor · Safe stack · Instruments read*, not the comp's
  *READINESS · AVG FPS · 1% LOW · SAFE STACK* — the handoff calls the first three an early draft's
  duplicated Health metrics.
- Health's h1 names the flagged check rather than printing the comp's "One thing needs your attention".
- Live's trace cannot show a past session's per-sample series — nothing persists one, and adding it
  would be a new backend data source the brief forbids. **Unfixable within this brief.**

## Blocked / waiting on him

Nothing blocks continuing. He owes the three sign-offs above and, eventually, the call on pushing
this branch — **shipping to other people's machines is his gate, not ours.**
