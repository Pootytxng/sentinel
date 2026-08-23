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
**7 convergence `0c550138` — installed, self-review round 16 IN FLIGHT.**

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

1. **Read the round-16 self-review verdict.** Dispatched against the installed `0c550138`; it gates
   everything below. On FAIL: fix → rebuild → `scripts/ship-reinstall.ps1` → re-dispatch a FULL
   fresh review. **Never re-approve off source inspection or green tsc/vitest — both round-15
   regressions passed their guards while broken live.** The two measurements that round most needs:
   the four h1 sizes (Health/Test must compute **52px**, History/Live **40px**, all four subs
   **15px**), and whether `shell-v2.css`'s `max-width: 20ch` on the split h1 (down from hud-rooms'
   34ch) wrecks any headline.
2. **On PASS — `docs/RELEASE_STATE.md:65`.** The "Owner-installed version + embedded stamp" row is
   STALE at `67ce2724` (slice 4). Rewrite it to `0c550138`, installer SHA-256
   `8C8DC1DDC0C6F8A6F4FC35B2622DE706FAE4AEC749EFA596291FF76DB71DB0C8`, stamp
   `0c550138 · release · shell 0.9.26`, demoting `67ce2724` and `8c9fb804` into the lineage. It must
   come out **shorter** than the row it replaces (doc-budget). Then
   `node scripts/verify-release-state.mjs`.
3. **`docs/UI_VISION_BACKLOG.md:25`** — tick slices 6 and 7, and clear **substitution 1** ("Primary
   action is VIOLET, not green"): the owner overruled the violet, `--v2-cta` is a token now and
   `comp-fidelity-guard.test.ts` pins it.
4. **Then hand the head + evidence to Codex** for the independent visual and frontend-contract
   review the brief requires. "No new IPC" is already true from the branch diff; the formal audit is
   still owed.

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
