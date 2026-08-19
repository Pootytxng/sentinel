# Session handoff — 2026-08-19 (#127 idle CPU: the scale was the trigger, not the rig)

**Lane OPEN.** Branch `perf/idle-127-ambient-raster`, one commit `75880de1` on top of `4d1b3d8e`.
Not pushed, no PR yet. A `npm run tauri build` was running when this was written
(log: scratchpad `build.log`); nothing after the build has been done.

## What was settled, with evidence

Re-measured the owner's CURRENT desk build (`2f79febb`), not the 6-day-old `efde8310` reading #127
was written from. Three runs, all committed:
`docs/perf/raw/idle-attribution-2026-08-19-{A-rig-on,B-h1-no-scale,C-no-scale-anywhere}.json`.

| | A (as shipped) | B (aurora no-scale) | C (no scale anywhere) |
|---|---|---|---|
| total idle, % of one core | 19.632 | 9.448 | 9.421 |
| `aurora` | 13.257 | -0.105 | 2.76 |
| `stl-pulse` | 4.156 | 4.001 | 4.721 |
| rAF band | 0.201 | 1.807 | 0.778 |

1. **#127's headline does not reproduce.** rAF band is 0.201 points and fired ZERO frames in the
   running phase; `concurrentLoopsAtRest: 0`. Demand mode is holding and the 3D rig is not the cost.
2. **The growth hypothesis is dead.** `@react-three/fiber` 9.6.1, `@react-three/drei` 10.7.7,
   `three` 0.184.0 — identical in `package-lock.json` at the 2026-08-06 baseline commit (`58a80975`),
   at `efde8310`, at HEAD, and on disk. No bump to explain the 11x.
3. **Nobody had read the rAF registration stacks already in the committed evidence.** They name
   GSAP's ticker and `ReticleCursor` (`src/design/console/ReticleCursor.tsx:45-47`), both in
   `index-*.js`. The `RigHologram-*.js` chunk appears only in the INTERVAL list. The OrbitControls
   latch was a plausible story the evidence never supported.
4. **Two real defects, both measured:** `aurora` (`body::before`, every room) 13.257 points, and
   `stl-pulse` (two rings, all three Home surfaces, unconditional) 4.156.
5. **The old guard's model is falsified.** Both animate transform only, which
   `ambient-animation-cost-guard` treats as free. Scale is NOT free on a full-window layer (it
   re-rasters), and on a small always-on surface running forever IS the cost — `stl-pulse` measured
   4.156 shipped, 4.001 promoted with `will-change`, 4.721 as opacity-only. Three mechanisms, one
   number.

## What `75880de1` changes

- `src/App.css` — `@keyframes aurora` drops `scale(1.09)`; the drift stays as pure `translate3d`.
- `src/surfaces/setup/SetupLauncherCard.css` — `.stl-ring` becomes `stl-pulse 2.4s ease-out 6
  forwards` (bounded ping, parks invisible).
- `src/design/update-pill.css` — `.v2-update-led::after` becomes 10 iterations + base `opacity: 0`.
  **Same class, NOT separately measured** (no update was available during the runs).
- `src/ambient-animation-cost-guard.test.ts` — guards 4 and 5, `.stl-ring` added to
  `ALWAYS_ON_AMBIENT` (inventory gap), and a falsification suite that drives the guards' OWN
  functions through the same `parseRules` the disk tests use.
- `scripts/q7-probe.mjs` — new `--inject-css FILE`: A/B a CSS hypothesis against the SHIPPED binary
  in ~6 minutes instead of a rebuild. Records the override text in the run, and throws if it did not
  land.

Verified: `tsc --noEmit` clean; `vitest run --maxWorkers=4` 342 files / 5062 passed, 1 skipped.
Disarm-probed: re-introduced both defects on disk, both guards failed with the right `file:line`,
restored, green.

## Lane state — CLOSED, awaiting review/merge

Everything in the previous "next steps" list is done. Nothing is half-finished; the tree is clean.

- Shipped and installed: **`75880de1`** (installer SHA-256 `E4A1301F…FFBFFC2A`), live == build proven
  via the embedded stamp with `-VerifyRuntime -ExpectedCommit <full sha>`, never an exe hash.
  Both preflights were re-read first as the driver required — `ship-reinstall.ps1:118` and
  `release.ps1:100` now resolve the data root through `Get-CanonicalCompyDataRoot`, which halts on a
  redirected/split root before reading it, so the old fail-open path is closed.
- Post-fix measurement against the INSTALLED binary: **19.632 → 10.483 percent of one core**
  (`docs/perf/raw/idle-attribution-2026-08-19-D-installed-fix.json`, `stl-pulse` observed
  `playState: "finished", iterations: 6`). Three post-fix runs agree: 9.448 / 9.421 / 10.483.
  The preserved 2026-08-06 baseline `idle-attribution.json` was never overwritten.
- self-reviewer **VERDICT: PASS** on the installed build — all four aurora corners captured natively
  at 3× with no seam or band, rings measured `opacity 0.19/0.75` at t=1.47s and `opacity 0` at
  t=27.3s, rail circuit 16.6–20.5ms. The update-pill LED is confirmed absent from the DOM (no update
  available), so it is recorded as unreachable, not verified.
- Owner has the before/after motion demo (`SendUserFile`, real CSS verbatim, replay + ×20 speed).
- Commits `75880de1` (fix + guards + probe) and `aa6fe2f2` (RELEASE_STATE stamp, BACKLOG cycle
  2026-08-19a, run D). Branch `perf/idle-127-ambient-raster` pushed → **PR #141**, and #127 carries
  a comment with the real attribution.

**What the next session picks up:** review/merge #141, then the owner's fleet decision. Nothing in
this lane needs re-measuring.

## Known, not chased here

- The machine baseline is noisy: the stabilizer's 8s windows swing ~6-14 points on every run
  (run B never settled). The ~10-point delta is far above that, but do not quote 3-decimal precision
  from a single run.
- `ReticleCursor` writes a transform every frame while the pointer is inside the scope, even
  motionless, and only stops on `pointerleave`. It did not register in these runs (the pointer was
  outside), but it is a live idle cost whenever the mouse rests over the window. Not filed yet.
- `wt-click` (Walkthrough) and `st-pulse` (SetupTour) are the same infinite-animation class but are
  bounded to a surface the user is actively looking at. Left alone deliberately.
- #121 is still real and open — not closed, not skipped. #140 (CPU temp / PawnIO) was not touched.
- The fleet is still three lanes behind the desk; moving it is the owner's GO and he has not given it.
