# FPS live-read ~2× over-read — DIAGNOSIS (read-only; fix gated on tester data)

> **STATUS: DIAGNOSED, NOT FIXED.** Owner-ordered read-only investigation (2026-06-10). No counting
> changed. The fix below is GATED on the tester's Export + the locked-2× question. Tester symptom:
> Steam live = 161 ≈ Compy 1% low = 161, Compy LIVE fps ≈ 323 (≈2×). Frame-gen ruled out (FSR
> upscaling only, no AFMF).

## Finding 1 — there is no separate live counter to over-read

`fps.rs` consumes ONLY `Present_Start` (event 42; no start/stop double-count) and derives BOTH
numbers from the same consecutive-present deltas: `fps = 1000/avg(deltas)`,
`low1 = 1000/p99(deltas)` (fps.rs ~L351-353). A "counter over-reads while frametimes stay right"
bug is structurally impossible — the symptom must come from the DELTA DISTRIBUTION.

## Finding 2 — PID-only keying conflates in-process present streams

The tracker is keyed by PID alone (`map.entry(pid)`, fps.rs ~L215); the ETW payload's swapchain
address is ignored (`_schema` unused). Two present streams in one process interleave into one
delta sequence. If presents arrive in PAIRS (main swapchain ~161/s + a second in-process present
right behind each), deltas go bimodal (ε, ~6.2 ms, ε, ~6.2 ms …):

- `avg ≈ (ε+6.2)/2 ≈ 3.1 ms` → **fps ≈ 322** (average poisoned by the tiny deltas)
- `p99` lands in the slow cluster → **low1 ≈ 161** (percentile immune)

Reproduces the tester's numbers exactly, including the ~2.006× ratio.

## Finding 3 — Steam's 161 leans BUG-CLASS, not render-vs-display

Steam hooks the game's main-swapchain `Present` — an uncapped 323-present/s main chain would make
Steam read ~323. Steam reading 161 (≈165 Hz panel minus the classic cap margin) says the main
swapchain itself runs at 161, and our extra ~162 events/s come from a SECOND in-process stream
(second swapchain: engine UI chain / overlay / launcher component; frame-gen ruled out). The file
header's documented trade-off ("counts present calls, not display rate") does NOT cover this mode —
the poisoned average corrupts the headline fps AND everything downstream (session `avg_fps`,
comparison baselines, tuning measurements). `low1` survives by construction.

## Disambiguators (waiting on owner/tester)

1. **Locked 2×?** Does Compy's live read track EXACTLY double Steam's at all times (menus, heavy
   scenes, dips)? Locked 2:1 = paired second stream (bug). Wandering ratio = render-vs-display
   (labeling, not fixing).
2. **Cap/vsync state + panel refresh** (161 on 165 Hz = capped main chain → supports bug-class).
3. **Export `avg_fps`** will read ~2× either way (sessions aggregate the same `report.fps`) —
   corroborates downstream corruption; doesn't separate the cases alone.

## Fix shape (NOT built — own gate)

Parse the swapchain address from the `Present_Start` payload (schema machinery already plumbed,
unused) → key trackers by **(pid, swapchain)** → pick the dominant swapchain within the chosen
process by the same most-frames rule that picks the process. Both fps and low1 then derive from one
swapchain's honest cadence (PresentMon's approach). Verification when built: pure-function test on
synthetic interleaved streams reproducing the 323/161 signature + a live game session on the AMD
rig. Touches the measurement engine → its own train, /check + /security, Cowork-auditable.
