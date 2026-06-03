# Sentinel Latency Module — design (the edge)

> **Status: PARKED + DARK.** Measurement/diagnostics lane (`sentinel-benchmark`), per the owner's
> "build next" call. Read-only diagnostics first; the ETW capture core is the big build. **HQ aware**
> (flagged in the realignment hand-off) — may be re-homed to its own lane; cheap to move (new dark files).

## Thesis (owner, 2026-06-03)
**A flight recorder with a forensics habit, not a dashboard gauge.** Every generic tool shows a red bar
that screams "high latency!" — the smoke alarm that won't say which room is on fire. This module walks in
afterward and says *"it was the Wi-Fi driver, here's the timestamp, here's the frame it cost you."*
**Name the culprit, measure the damage — in that order.**

## The six-stage pipeline
**Capture → Attribute → Correlate → Analyze → Verify → Guard.**

### ⚙️ Stack grounding (one correction to the owner's build-stack note)
The thesis suggests **.NET `TraceEvent`** / **krabsetw (C++)**. **We don't use those** — Sentinel is a lean
**Rust/Tauri** app and already ships **`ferrisetw`** (a Rust ETW consumer) which `fps.rs` already uses for
DXGI present-event capture. So:
- **ETW in Rust via `ferrisetw`** — no .NET runtime, no C++ side-car bolted onto a lean app.
- **Kernel DPC/ISR tracing needs admin** → it runs in the **existing elevated helper pattern** (`fps.rs
  --fps-capture` already runs elevated for ETW). Same anti-cheat-safe mechanism (ETW, no injection, no
  kernel driver of our own).
- **Stage 3 ↔ `ARCHITECTURE_LOCKS §1.7`:** correlating with the PresentMon frame stream is the **owner-
  approved §1.7 reversal HQ is actioning.** `fps.rs` already does DXGI present capture; we either extend it
  or consume Intel PresentMon's service. **This stage is gated on HQ landing §1.7.**

### Stage 1 — Capture (the engine that *is* the product)
A kernel ETW session capturing DPC, ISR, context-switch, ready-thread events. **The decisive design call:
latency offenders are intermittent** (a Wi-Fi DPC fires when the radio scans every few seconds; a 10s
snapshot lies half the time). So **two sessions**:
- **Always-on light** — counts, max durations, per-driver tallies. Tiny overhead.
- **Spike-triggered heavy** — full call stacks, only when a threshold trips (ring-buffer + trigger).
Security-camera-b-roll that flips to 4K when the motion sensor trips. **This is where engineering
credibility is won — and the subtle trap is keeping the light session's overhead from polluting the very
latency we measure.** → **Owner is providing the detailed session spec** (buffer sizing, trigger
heuristics, overhead isolation). That's the right division of labor; it's the hardest 10%.

### Stage 2 — Attribute (turn "latency" into a name)
ISR/DPC events carry the **return address** of the routine that ran. Resolve it against the **image-load
events in the same trace** → "high DPC latency" becomes *"`rtwlane.sys` held DISPATCH_LEVEL for 900µs."*
**Builder's gift (owner's insight): we only need the module NAME, not symbols** — that comes from image-load
events, so we skip the entire symbol-server rabbit hole. Rank offenders by max duration, total time at
DISPATCH_LEVEL, frequency. The usual suspects are four families — **networking (esp. Wi-Fi), storage, GPU,
audio** — plus power-state transitions; the module ships knowing them.

### Stage 3 — Correlate (the differentiator) — *gated on §1.7*
Align the DPC/ISR timeline against the PresentMon frame-time stream → the sentence that is the whole product
in miniature: *"Your 0.1% low frame at 14:32:07 lines up with an 880µs DPC in your NIC driver."* Same for
audio (tiny buffer → one long DPC starves it → crackle). **Correlation converts a scary graph into a
decision.** Reuses Stage-5 (efficacy) honesty.

### Stage 4 — Analyze (the finer instruments)
- **MSI/MSI-X checker + setter.** ✅ checker BUILT (`latency.rs`, exact path the owner cites). **GAP the
  owner caught (real, I'll fix):** I read `MSISupported` = *advertised* support, **not whether MSI is
  actually active** — a device can advertise it and still fall back to line-based. **TODO: read the
  resource descriptor afterward and confirm (active MSI shows as a *negative* IRQ value); verify, don't
  assume.** The *setter* is a Stage-6 red/amber tweak via the existing apply/rollback path.
- **Interrupt-affinity mapper.** Which logical core services which device's interrupts. **Matters on
  multi-CCD / hybrid parts, NOT single-CCD X3D** → the module detects CCD/core topology and **only surfaces
  affinity tweaks where they're meaningful. Refusing a pointless tweak is itself a credibility feature.**
- **Timer resolution — done honestly.** ✅ read BUILT (`NtQueryTimerResolution`, verified 1.0/0.5/15.625ms)
  + the per-process honesty framing. **Owner's deeper truth to bake in:**
  - Timer resolution governs **scheduler wake granularity, NOT interrupt/DPC latency** — confusing them is
    "blaming your alarm clock for traffic." What it *does* fix: scheduling granularity + artifacts (e.g. an
    unexplained 64 FPS cap).
  - **Per-process since Win10 2004**; on **Win11** a minimized/occluded window-owner *loses* the guarantee;
    global behavior can be restored on Win11/Server 2022+ via `GlobalTimerResolutionRequests = 1` under
    `HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\kernel`.
  - **TODO: don't blind-force 0.5ms — measure the optimal empirically** (MeasureSleep: sample `Sleep()`
    deltas; the hardware-rounded sweet spot is often **0.51ms, not 0.50**, and a wrong value can *degrade*).
    Find the lowest-jitter resolution, explain the per-process/global distinction in plain English.
- **USB topology mapper.** *(pending)* controller→hub→device tree; flag input devices sharing a host
  controller; **verify real HID polling rate by measuring report intervals, not trusting the advertised
  number.**

### Stage 5 — Verify ✅ (already built — `compute_efficacy`)
Before/after DPC-duration distributions + frame-time deltas with **STDEV + percentiles + an explicit noise
floor**: *"MSI mode cut max DPC 1.1ms→220µs and tightened 0.1% lows 8% — outside noise, recommend keeping."*
If a tweak does nothing measurable, **the app says so.** This is exactly the efficacy engine already shipped
(`measure_efficacy`, `DEFAULT_NOISE_FLOOR_PCT`); the latency module feeds DPC/frame metrics into it.

### Stage 6 — Guard (footguns, red-tier)
Some tweaks are loaded guns — **transactional, per-tweak revert, default OFF, measured before/after**:
- `bcdedit /set useplatformclock yes` — the marquee footgun (can peg every core, grind the machine).
- Disabling interrupt moderation (flood the CPU); aggressive affinity pinning (starve a core).
All **red-tier**, one-click undo standing by, via the locked rollback-first model — never auto-applied.

## Architecture (dark)
- `src-tauri/src/latency.rs` — pure summarizers + thin read-only platform readers (✅ MSI + timer);
  `mod latency;` only, **not registered**. ETW capture core (Stages 1–3) lands in the **elevated helper**
  (the `fps.rs` pattern) using **`ferrisetw`**.
- Reuses: `winreg`, `ferrisetw`, `wmi` (all present). **No new heavy deps; no .NET/C++.**
- Verify reuses `benchmark::compute_efficacy`. No `actions.rs`/mutation changes; setters/footguns go through
  the existing typed apply/rollback only.

## Sequencing
1. **Safe read-only diagnostics (now):** MSI checker ✅ (+ active-verify TODO), timer read ✅ (+ MeasureSleep
   TODO), USB topology, interrupt-affinity map. No elevation, no network.
2. **ETW capture core (the big build):** Stages 1–2 in the elevated helper via `ferrisetw`. **Owner provides
   the dual-session design.**
3. **Correlate (Stage 3):** gated on HQ landing the §1.7 PresentMon reversal.
4. **Network jitter/bufferbloat:** needs outbound egress → same strict opt-in as the efficacy leaderboard.
