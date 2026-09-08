# Compy Console HUD — Phase 3 (Monitor: live-telemetry instruments) Implementation Plan

> **PRODUCT DIRECTION SUPERSEDED 2026-09-04.** This is a historical implementation record, not
> current product authority, priority, approval, or work authorization. Current product direction is
> [`docs/PRODUCT_CONSTITUTION.md`](../../PRODUCT_CONSTITUTION.md), with sequence derived in
> [`docs/product/ROADMAP.md`](../../product/ROADMAP.md). Conforming telemetry-honesty and safety
> provenance remains useful under [`docs/ARCHITECTURE_LOCKS.md`](../../ARCHITECTURE_LOCKS.md).

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> **Design source of truth:** `docs/superpowers/specs/2026-07-09-compy-console-hud-direction.md`
> (owner-approved; Monitor row: *"The language is literally native: the arc gauges + oscilloscope
> traces are real live telemetry (fps, frametime, sensors), not decoration."*) + the header-slop +
> title-header law addenda (both already enforced on MonitorV2 — do not regress them).
> **ENTRY GATE: the per-tab concept check (owner directive 2026-07-10 — the "per-tab signature
> law" addendum in the direction spec).** Phase 2 passed the eyeball and shipped default-ON
> (`bce72d6`), but the owner then decreed: no copy-pasting the 3D-hologram/parallax stage across
> tabs — each tab's console face must be a signature instrument native to its purpose, spitballed
> with him BEFORE building. Monitor's concept (this plan): the **instrument cluster** — the motion
> IS the data (live traces + gauges), deliberately NO hologram and NO parallax. **Open the session
> by confirming his go on that concept (he has the spitball sheet from the 2026-07-10 chat; a
> one-line "go" clears this gate), fold any reactions into the tasks, then build.**

**Goal:** the Monitor room's LIVE face adopts the Console language with real instruments: a NEW
`Oscilloscope` kit component drawing rolling traces from the live fps/frametime stream, and honest
arc gauges over the same sensor polls the tiles already use — behind a NEW flag
`compy_monitor_console` (**DEFAULT OFF** the whole phase). Flag off ⇒ today's MonitorV2 tree
byte-identical. The Sessions face, TuningPresets expander, Basic/Advanced semantics, and the
capture-closes-the-door rule (V2-8) are UNCHANGED — this is presentation over the same audited
read-only telemetry.

**Architecture:** `MonitorV2` (`src/surfaces/MonitorV2.tsx`) already owns the room shell (RoomShell ·
HudMasthead · Live/Sessions segments · Basic/Advanced modes · `onFpsActive` mirror). Phase 3 adds a
console branch for the **Live segment only**: `monitorConsole ? <MonitorConsole …/> : <existing
faces>`. `MonitorConsole` reuses the Phase-1/2 kit (`ArcGauge`, `Sparkline`, `ReticleCursor`) plus
the new `Oscilloscope`, and consumes the SAME polls the existing faces run — **grep MonitorBasic /
Play's live tiles for the exact commands and cadence (`get_fps_status`, `get_cpu_sensors`,
`get_gpu_sensors`, memory) and port them verbatim; do NOT invent new polls or cadences.** Zero new
IPC, zero src-tauri.

**Tech Stack:** React 19 + TS · Console kit (`src/design/console/`) · vitest + @testing-library ·
tsc. **Zero new dependencies** (the trace is hand-rolled SVG/canvas like `Sparkline` — no chart lib).

## Global Constraints

- **Flag:** `compy_monitor_console`, localStorage, **DEFAULT OFF** the whole phase (`=== "1"`
  polarity, exactly Phase 2 Task 1's pattern incl. the `compy:monitor-console-changed` event, a
  `useMonitorConsoleFlag` hook, and a Settings → Appearance row **"Monitor console (preview)"**).
  OFF ⇒ MonitorV2 renders exactly today's tree — pin byte-identity in a new
  `monitor-console-flag.test.tsx` for BOTH `compy_editorial` states (mirror
  `home-console-flag.test.tsx`'s mechanism, INCLUDING its post-flip lesson: any existing test that
  mounts MonitorV2 relying on the default must keep meaning what it pins).
- **No `src-tauri` changes.** `git diff -- src-tauri` MUST stay EMPTY all phase.
- **HONESTY RAIL (LOCKED):** every gauge/trace value traces to a real sample. Helper not running /
  no capture ⇒ the honest STOPPED/NOT-YET state (the §6-proven "sensor stopped" behavior must stay
  visible — never a frozen trace posing as live, never a fabricated 0, never synthetic/demo waves).
  The oscilloscope draws ONLY buffered real samples; an empty buffer renders the no-signal state.
  GPU temp tone via `gradeGpuTempForVendor` (NVIDIA ungraded — LOCKED rule 5; NVML sensor is still
  "implemented, not hardware-verified" — do not upgrade any copy).
- **Title-header + header-slop laws (exit check):** h1 stays "Monitor"; no ledes/explainer strips;
  instrument labels are micro-labels; the last-session answer stays in Play's hero (round-2 law
  relocation — do not move it back).
- **Never gamer-RGB; vendor purple can never paint** — mirror the pin from `lab-console.test.tsx`.
- **Reduced-motion:** `useReducedMotion()` gates everything; reduced ⇒ still page — the trace
  does NOT animate (render the latest buffer as a static polyline, updated at poll cadence without
  sweep/glow animation), no reticle/spotlight/reveal.
- **Perf:** the trace redraw must be poll-driven (state update per sample batch), NEVER a free
  rAF loop while data is unchanged — the idle-canvas law (0 GL/paint churn at rest) applies; with
  the FPS helper stopped the console must go visually still (self-review probes this).
- **All new CSS scoped `:root[data-v2="on"]`** + registered in `tokens-v2-guard.test.ts` `V2_CSS`.
- **Every UI task ends with `self-review`** (dispatch the self-reviewer; no done-claim without a
  quoted PASS).

---

### Task 1: Flag plumbing + the MonitorV2 branch (byte-identity first)

**Files:**
- Modify: `src/design/theme.ts` (`readMonitorConsole()`, `=== "1"`), `src/design/use-hud.ts`
  (sibling hook), `src/surfaces/Settings.tsx` (Appearance row "Monitor console (preview)"),
  `src/surfaces/MonitorV2.tsx` (Live-segment branch to a stub).
- Create: `src/surfaces/MonitorConsole.tsx` (stub), `src/surfaces/monitor-console-flag.test.tsx`.

**Steps:**
- [ ] Failing test first: flag absent/"0" ⇒ MonitorV2 byte-identical (both `compy_editorial`
  states); "1" ⇒ `.monitor-console` root renders in the Live segment and the classic live face
  does not; Sessions segment UNTOUCHED in both states.
- [ ] Implement; tsc 0; new test + `monitor-v2.test.tsx` green.
- [ ] Commit: `feat(monitor): compy_monitor_console preview flag + Live-segment branch (DEFAULT OFF, byte-identity pinned)`

---

### Task 2: The `Oscilloscope` kit component (real traces only)

**Files:**
- Create: `src/design/console/Oscilloscope.tsx`, `oscilloscope.css`, `oscilloscope.test.tsx`.

**Interfaces:**
- Props: `samples: number[]` (already-real values, newest last; the CALLER owns buffering) ·
  `cap?: number` (window length, default ~120) · `label: string` (micro-label) · `unit?: string` ·
  `tone?: string` (graded ink var, same contract as ArcGauge) · `reduced: boolean`.
- Contract (test-pinned): `samples.length === 0` ⇒ renders the no-signal state (an honest
  "no signal" micro-label on the empty grid — NEVER a flat synthetic line); renders an SVG
  polyline over a graph-grid (model the geometry on HomeHud's existing trace + `Sparkline`);
  no rAF/interval of its own — a pure render of props (the poll drives updates); reduced ⇒ no
  sweep/glow CSS animation. Vendor purple can never paint (token-only ink).

**Steps:**
- [ ] Failing tests → implement → tsc 0, kit tests green.
- [ ] Commit: `feat(console-kit): Oscilloscope — pure real-sample trace (no-signal honest state, reduced still)`

---

### Task 3: `MonitorConsole` — live instruments over the existing polls

**Files:**
- Modify: `src/surfaces/MonitorConsole.tsx` (real implementation), create
  `src/surfaces/monitor-console.css` (+ register in `tokens-v2-guard.test.ts`), extend
  `src/surfaces/monitor-console-flag.test.tsx` or add `monitor-console.test.tsx`.

**Steps:**
- [ ] Grep the existing live faces (MonitorBasic, Play live) for their poll commands, cadence,
  cleanup, and the capture/stopped state derivation — port VERBATIM (same commands, same
  cadence, same cancellation; the `onFpsActive` mirror keeps working so the forward door still
  closes during capture).
- [ ] Failing tests: (a) with a mocked live fps stream, the fps + frametime `Oscilloscope`s
  receive the real buffered samples and the gauges show the measured values with graded ink;
  (b) helper stopped ⇒ STOPPED/no-signal states everywhere, no frozen-as-live trace, no
  fabricated numbers; (c) capture start/stop keeps mirroring `onFpsActive`; (d) NVIDIA fixture ⇒
  GPU temp ungraded (rule 5); (e) header-slop pin — no lede/descriptive strip in the console
  subtree.
- [ ] Implement: instrument row/grid in the Live segment — fps trace + frametime trace
  (Oscilloscope) · ArcGauges for the sensor readings the tiles already surface (GPU temp/load,
  CPU, RAM — exactly what the existing faces read, no new probes) · capture control stays the
  room's real control (reuse the existing audited toggle wiring, do not fork it). Basic/Advanced
  keeps its meaning: Advanced may show more instruments, Basic the core set — mirror how the
  existing faces split, don't invent a new taxonomy.
- [ ] tsc 0 · new tests + `monitor-v2.test.tsx` + flag pins green.
- [ ] Commit: `feat(monitor): MonitorConsole — live gauges + fps/frametime oscilloscopes over the existing polls (flag OFF)`

---

### Task 4: Alive — spotlight · reveal · reticle (reduced ⇒ still; stopped ⇒ still)

**Steps:**
- [ ] Extend tests: reduced mock ⇒ `data-motion="reduced"`; vendor-purple pin.
- [ ] Port the Phase-2 motion layer (`--glow-x/--glow-y` spotlight, staggered reveal with
  `animation-fill-mode: backwards` — never `both`, `ReticleCursor` scoped to the instrument
  stage). No parallax over the traces (readability outranks depth on a data surface — the
  direction spec's "not decoration" line).
- [ ] tsc 0 · full vitest green (note the count).
- [ ] Commit: `feat(monitor): console alive — spotlight + reveal + reticle (reduced still)`

---

### Task 5: Self-review + ship behind the flag + owner eyeball

- [ ] `self-review` (native 1500×980): live capture ON with a real game or idle desktop capture —
  traces draw real samples; helper STOPPED ⇒ honest stopped state AND visual stillness (paint/GL
  probe over ~15s); flag-off Monitor byte-identical; title-header/header-slop rubric; vendor
  purple; reduced-motion still page. No done-claim without a quoted PASS.
- [ ] Full verify: tsc 0 · `npx vitest run` (count) · `git diff -- src-tauri` EMPTY (cargo
  unchanged by construction).
- [ ] `ship` skill: build → `scripts/ship-reinstall.ps1` → stamp-verify → ONE installer on the
  Desktop → RELEASE_STATE row + BACKLOG cycle entry same ship.
- [ ] Owner eyeball: Settings → Appearance → "Monitor console (preview)" ON, open Monitor's Live
  face (ideally during a capture), react. Taste gate before default-ON and Phase 4
  (History/Black Box per the direction table).

---

## Self-Review (plan vs spec) — done
- Spec's Monitor row covered: arc gauges + oscilloscope traces = REAL live telemetry (T2 pure-props
  trace + T3 verbatim-port polls), "not decoration" honored (no parallax over traces, no synthetic
  waves, stopped ⇒ still) ✓.
- Rails: flag-off byte-identity (T1, incl. the Phase-2 default-flip test lesson) · zero src-tauri ·
  honesty rail (no-signal state, STOPPED visibility, rule-5 GPU tone/copy) · title-header +
  header-slop exit checks · reduced-motion + vendor-purple pins · idle-stillness perf law ·
  self-review/ship laws ✓.
- Known-bug avoidance encoded: `backwards` fill-mode · no self-driven rAF in the trace (idle-canvas
  law) · `onFpsActive` mirror preserved (V2-8 door) · honest-lookup instructions instead of invented
  poll shapes/copy ✓.
