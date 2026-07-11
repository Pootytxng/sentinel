# Monitor v3 — "Telemetry Ribbon" (owner-chosen concept, 2026-07-10) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or
> superpowers:executing-plans, task-by-task. **Design source of truth:**
> `docs/UI_VISION_BACKLOG.md` §A0 (the owner's FULL 2026-07-10 response, retained verbatim — every
> decomposed item below is binding; none may be silently dropped or substituted) + his concept pick
> from the spitball: **"3D ribbon graph"** — the frametime history as a true 3D ribbon (three.js,
> like the rig hologram) you can orbit; spikes rise as peaks with markers.
> **ENTRY GATE: ALREADY CLEARED** — the owner chose the ribbon concept explicitly on 2026-07-10
> (AskUserQuestion, option "3D ribbon graph"), after the Phase-3 instrument cluster shipped
> (`3fbd371`) and he rated it "satisfactory" but wanted a third option to surpass it. No further
> concept check needed; fold his reactions during eyeball into a fix train.

**Goal:** the Monitor console face (same flag `compy_monitor_console`, still **DEFAULT OFF**)
evolves from the v2 flat cluster into v3: a **3D frametime ribbon hero** + a precision 2D spike
strip + consumer-term readouts + the overlay control. Flag off ⇒ classic Monitor byte-identical
(the existing `monitor-console-flag.test.tsx` contract carries over unchanged).

## The owner's binding requirements (UI_VISION_BACKLOG §A0)

1. **Graphs are a MUST + exact spike-moment indicators** — every frametime latency spike gets a
   marker at its precise sample; the worst spike gets a labeled ms callout. Non-negotiable.
2. **Frametime trace must span the FULL grid** (v2 bug: it scaled x to the fixed cap of 240, so a
   sub-240-sample window stopped ~halfway; the fps trace filled because its buffer differs).
3. **3D/parallax is welcomed** (his direction amendment: don't rule depth out "unless reasonably
   so"). The ONE retained rail, stated to him and accepted: **depth may move the panel/chrome,
   never warp the data ink** — a spike's plotted position must stay truthful. Hence the ribbon is
   itself the data (real geometry from real samples — that's honest 3D), and the flat spike strip
   stays alongside as the precision read.
4. **Consumer-market terms** (app-wide copy direction): "MAX FPS", "LOWEST LATENCY",
   "HIGH RESOLUTION" style wording over "visual fidelity / smooth / clarity". Terms label MEASURED
   values only — honesty rails unchanged.
5. **Overlay controls on the console face** — with the preview ON, the in-game overlay's toggle
   currently vanishes (it lives on the classic Advanced→Live face). Port the SAME audited wiring
   (`overlay_visible` / `show_overlay` / `hide_overlay` / `set_overlay_corner`), do not fork it.

## Global constraints (all carried from Phase 3 — unchanged)

- Same flag `compy_monitor_console` DEFAULT OFF; flag-off byte-identity pins stay green untouched.
- **Zero src-tauri / zero new IPC** — the same three 1 Hz polls + `recent_frametimes_ms`.
- **HONESTY RAIL:** ribbon/strip/readouts render ONLY real samples; helper stopped ⇒ buffers clear
  (never frozen-as-live), no-signal states everywhere; empty ⇒ no synthetic ribbon/waves. NVIDIA
  GPU temp stays ungraded (LOCKED rule 5).
- **Perf / idle-canvas law:** the ribbon canvas runs r3f `frameloop="demand"` — invalidate on new
  sample batches and during orbit ONLY; with capture stopped and pointer away the face is
  visually still and draws ~0 GL frames (self-review probes this, same as the rig hologram pins).
  Lazy-load the 3D module exactly like `RigHologram` (`lazy()` + Suspense fallback).
- Title-header + header-slop laws · vendor purple can never paint · reduced-motion ⇒ still page
  (ribbon renders as a static latest-buffer view, no reveal/spotlight/reticle) · all new CSS
  scoped `:root[data-v2="on"]` + registered in `tokens-v2-guard.test.ts`.
- Every UI task ends with the `self-review` dispatch; ship via the `ship` skill + RELEASE_STATE/
  BACKLOG same-commit rows; owner eyeball is the exit gate.

## Tasks

### Task 1 — Oscilloscope: full-stretch + spike markers (fixes his bug + the must-have, 2D layer)
- Scale x to the DRAWN window (`win.length - 1`), not `cap` ⇒ the trace always spans the grid
  (test-pinned with a 100-sample window at cap 240).
- New optional props: `budget?: number` (draws the frame-budget line, e.g. 1000/refreshHz) and
  `spikes?: boolean` — samples above the spike threshold (>= 2× the window median AND above
  budget; pure helper, unit-tested) get per-sample markers; the worst spike gets a ms label.
  Pure render, no timers (contract unchanged).
- Commit: `feat(console-kit): Oscilloscope v2 — full-width window, budget line, exact-moment spike markers`

### Task 2 — Consumer-term readout row (pure derivations)
- `MAX FPS` (window max) · `AVG FPS` · `LOWEST LATENCY` (window min frametime, ms) · `SPIKES`
  (count in window) — derived from the SAME buffers, `null ⇒` honest em-dash, never 0. Graded ink
  via the existing metric-grade helpers where a grade exists; ungraded stays neutral.
- Commit: `feat(monitor): v3 readout row — MAX FPS / AVG FPS / LOWEST LATENCY / SPIKES (measured only)`

### Task 3 — `FrametimeRibbon` (r3f, lazy) — the hero
- New `src/surfaces/monitor/FrametimeRibbon.tsx` (+ lazy wrapper): ribbon mesh extruded from the
  real `recent_frametimes_ms` window (x = time, y = frametime, small z depth), spike peaks carry
  3D markers; a translucent frame-budget plane at 1000/refreshHz; drag-to-orbit with drei
  `OrbitControls` damping (the rig hologram's exact interaction — no auto-rotation ever);
  `frameloop="demand"`. Empty/stopped ⇒ unmount to the strip's no-signal state (no ghost ribbon).
- Default camera: near-front elevation so the exact-moment x-axis stays readable at rest; orbit is
  the user's choice.
- Commit: `feat(monitor): FrametimeRibbon — real per-frame 3D ribbon, spike peaks, budget plane (demand frameloop)`

### Task 4 — v3 face assembly + overlay control + depth chrome
- MonitorConsole becomes: readout row (T2) → ribbon hero (T3) → full-width 2D spike strip + fps
  trace (T1) → gauges (kept from v2) → capture control (kept) → overlay control (ported verbatim
  from Play live: on/off + corner; density/backdrop may stay classic-face-only if space demands —
  if so, LOG IT in UI_VISION_BACKLOG as an explicit residual, never silently) → honesty line +
  Basic's last-session door (kept).
- Panel depth: pointer-tilt on the stage CHROME (perspective transform, data ink crisp — rail #3),
  composes with the Phase-2 spotlight/reveal/reticle already on the face.
- Commit: `feat(monitor): v3 Telemetry Ribbon face — hero ribbon + spike strip + readouts + overlay control`

### Task 5 — verify + ship + eyeball
- tsc 0 · full vitest (note count) · `git diff -- src-tauri` EMPTY · self-review dispatch (native
  1500×980: spike markers on real data, ribbon orbit, idle-stillness GL probe with capture
  stopped, flag-off round-trip, reduced-motion still, consumer terms present, overlay toggle
  works) · `ship` skill (build → ship-reinstall → stamp-verify → RELEASE_STATE + BACKLOG same
  ship) · owner eyeball = the taste gate before default-ON.
- Also this train: fold the 3D/parallax amendment into
  `docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md` (the "not decoration" Monitor
  row gains the owner's 2026-07-10 amendment: depth welcomed, data ink never warped) — doc-sync,
  same commit as the face lands.

## Self-review (plan vs the owner's verbatim asks) — done
- Every §A0 item mapped: overlay (T4) · surpass-satisfactory rework (T2–T4, his chosen concept) ·
  graphs + exact spike moment (T1/T3, hard requirement) · full-grid stretch bug (T1) ·
  3D/parallax un-banned with the stated rail (T3/T4 + spec amendment in T5) · consumer terms
  (T2, app-wide direction noted) · verbatim retention (UI_VISION_BACKLOG §A0, already committed
  `e1abce9`) ✓.
