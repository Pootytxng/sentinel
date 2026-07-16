# How Compy measures — the methodology page

*Published so a skeptical reader can check our math instead of taking our word for it. Every claim
below is grounded in the current codebase — cited by file so it can be re-verified against `main`.
If this page and the code ever disagree, the code wins; open an issue or ping the team.*

## Provenance

Drafted 2026-07-16 executing recommendation #5 (`docs/reviews/2026-07-15-consumer-panel-review.md`,
persona 4 — "Competitive performance enthusiast") + brief item 4.5
(`docs/reviews/2026-07-15-cc-brief-panel-review-execution.md`). Facts verified against
`src-tauri/src/fps.rs`, `sessions.rs`, `benchmark.rs`, `benchmark_verdict.rs`, `comparison.rs`,
`recommendations.rs`, and `src/surfaces/benchmark-view.ts` on 2026-07-16.

---

## 1. How frame timing is captured

Compy reads frame presents via **ETW (Event Tracing for Windows)**, subscribing to the
Microsoft-Windows-DXGI provider's present events (event ID 42, `PresentStart`) — the same
mechanism Intel PresentMon uses. This runs from *outside* the game process: **no DLL injection**,
which is why it's anti-cheat safe by design (`fps.rs`). Because starting a real-time ETW session
needs Administrator, capture runs in a separate elevated helper process (`compy.exe --fps-capture`).

**Honest limitation:** this covers DX11/DX12 only. Vulkan and OpenGL present through a different
kernel path (DxgKrnl, not DXGI) and are **not currently counted** — if you're playing a Vulkan/GL
title, Compy will not see its frames.

## 2. Sample cadence

Frame timestamps come from raw hardware timer (QPC) deltas on every present event — they are not
polled. Compy reports a fresh summary every **~500ms**, computed over the trailing **1 second** of
presents. The 500ms figure is the *reporting* cadence; the underlying frame data is as fine-grained
as the present events themselves.

## 3. Which process gets measured

A two-stage rule (`select_game_presenter()`):

1. Pick the process presenting the most frames recently, **excluding a fixed denylist**
   (`dwm.exe`, `explorer.exe`, `compy.exe` itself, `msedgewebview2.exe`, and a handful of other
   Windows shell/webview hosts that can never win regardless of frame count).
2. Within that process, pick its most active swapchain.

Ties are broken deterministically so the reported game doesn't flap between ticks.

**A bug this rule exists to prevent, and once didn't:** on 2026-06-10 a real tester session
recorded **"msedgewebview2.exe · 329 avg"** — Compy's own UI out-presented the actual game and won
the race. A related bug the same day, the **"323-vs-161 signature,"** came from a single game
process presenting two swapchains (the game plus an overlay/engine UI): keying by process ID alone
mixed their frametimes into one bimodal series and read out at roughly double the true framerate.
Both are fixed — tracking is now keyed by `(process, swapchain)`, not process alone — and both are
pinned as regression tests. We're naming them here because "we had a bug, found it, and it can't
silently come back" is more credible than pretending it never happened.

## 4. Minimum sample size before a result counts

- A full play **session** under 60 seconds isn't saved as measurable data.
- A benchmark **trial window** needs at least 60 valid frames.
- A benchmark **verdict** needs at least 4 such windows per side (before/after) — below that, the
  result is reported as `Inconclusive`, not guessed at.

## 5. The noise floor — what counts as a real change

Compy uses three related noise-floor checks, all conservative, so a change has to clear a real bar
before it's called "Improved" or "Regressed":

- **Component/hardware comparisons:** a flat 3% minimum delta (widened to 8% if either reading is
  flagged low-confidence).
- **Live in-game trials:** the floor self-calibrates to *your own baseline's* run-to-run variance
  (never below 3%) — a noisy rig gets a wider bar than a stable one, which is the honest way to do
  it. On top of that, a bootstrap statistical test (2,000 resamples) must show the 95% confidence
  interval on the measured change excluding zero.
- **Cross-session comparisons:** flat 3%, judged on the 1%-low delta specifically.

Below the floor, the result is **"No measurable change"** — a first-class, deliberately unstyled-as-
failure verdict, not a hidden null.

## 6. How 1% lows are calculated

Frametimes for the sampled window are sorted, and the 99th-percentile frametime is converted to FPS
(`1000 / p99_frametime`). The Lab's benchmark engine also reports a 0.1% low the same way, at the
99.9th percentile. We key verdicts on 1%/0.1% lows rather than average FPS on purpose: frametime
distributions are fat-tailed, and the stutters that actually feel bad live in that tail — a healthy
average can hide a rig that stutters constantly. Average FPS is shown for reference; it is never
what decides a verdict.

## 7. What happens to bad or missing data

Nothing is silently interpolated or invented. The consistent pattern across the codebase:

- Impossible frame intervals (a duplicate timestamp, or a gap over 1000ms from alt-tabbing) are
  dropped before they can distort an average.
- A window with too few valid frames returns no result, not a shaky one — the code comment for this
  is blunt: *"the percentile lows are noise — reject the window rather than invent a number."*
- If the GPU clock or temperature diverges too far between the two sides of a trial (throttling,
  background load), the trial is discarded as invalid, and the UI says so in plain language.
- A comparison baseline older than 14 days is reported as expired rather than silently compared. If
  another change landed on the Trust Ledger after a baseline was armed, the comparison is reported
  as confounded — the delta can't be honestly credited to the original change.

## 8. What "Verified," "Measured," and "Expected" mean

Every recommendation's claimed impact carries one of three tiers, and the app never silently
upgrades one to another:

- **Verified** — Compy directly observed the fact itself (e.g., your actual refresh rate vs. your
  display's max, free disk space, driver age). The claim *is* the measurement.
- **Measured signal** — third-party benchmarks or wide community consensus have measured this kind
  of change's impact; Compy is citing established results, not its own trial.
- **Expected impact** — logically sound given how Windows works, but Compy has not benchmarked it
  itself. This is the tier's honest admission: "we believe this, we haven't proven it on your rig."

## 9. Combined-effect honesty

If more than one change landed on the Trust Ledger inside a measured window, Compy will not credit
the result to any single one of them. The copy explicitly shifts to plural ("measuring the combined
effect of...") with a caveat that the result can't be attributed to one change alone. The window
itself is computed once, from real timestamps, and reused by every surface that shows a result — the
benchmark efficacy card, the Two Futures comparison, and the Lab's verdict all agree on the same
window, so they can't quietly disagree about what a number means.

---

*Have a methodology question this page doesn't answer? Tell us — a real question is a bug report
against this document.*
