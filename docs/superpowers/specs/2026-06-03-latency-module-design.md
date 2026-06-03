# Sentinel Latency Module — design (the edge)

> **Status: PARKED + DARK.** Started in the measurement/diagnostics lane (worktree
> `sentinel-benchmark`) per the owner's "build next" call (2026-06-03). New `latency.rs` module,
> dark (`mod latency;`, not registered), read-only diagnostics first. **HQ aware** (flagged in the
> benchmark realignment hand-off) — may be re-homed to its own lane later; cheap to move (new dark files).

## Why — the roadmap's "actual edge"
LatencyMon-style tools show a scary graph and stop. Sentinel's edge is to **name the guilty driver and
make it actionable** — pure scientific-instrument behavior, mostly **measurement/diagnostic (safe)**, very
little mutation. Highest differentiation, lowest risk.

## Components & sequencing (safe-first)

| Diagnostic | What | Mechanism | Safety | Phase |
|---|---|---|---|---|
| **MSI-mode checker** | which GPU/NIC/PCI devices use Message-Signaled Interrupts vs legacy line IRQs | **registry read** (`HKLM\…\Enum\PCI\…\Interrupt Management\MessageSignaledInterruptProperties\MSISupported`) | read-only, no elevation | **1 (first)** |
| **USB topology map** | which ports share a controller (matters for input under load) + device list | enumeration (SetupAPI/WMI) | read-only | 1 |
| **Timer-resolution honesty** | current/requested timer resolution + the **truth** that recent Windows made it per-process (the global 0.5ms reg hack is a myth) | read-only query (ntdll `NtQueryTimerResolution`) + education | read-only | 1 |
| **DPC/ISR analyzer** | name the driver causing latency spikes ("your Killer NIC is the stutter") | **ETW** (reuse `ferrisetw`; elevated, like `fps.rs`) | read-only but **needs elevation** | 2 |
| **Network bufferbloat/jitter** | real cause of "lag" — jitter/loss under load; blunt that ping is physics-bound | active probe (ICMP/UDP) | **needs network egress** → opt-in like the leaderboard | 3 |

**Sequencing rationale:** Phase-1 diagnostics are read-only, no elevation, no network — buildable now,
fully inside the locked safety model. DPC/ISR needs the elevated ETW path (HQ-adjacent, like `fps.rs`).
Network needs outbound egress → the **same strict opt-in** treatment as the efficacy leaderboard.

## Honesty + safety stance
- **Advisory diagnostics, never auto-applied.** Any *fix* the module surfaces (e.g. flipping MSI mode,
  setting timer resolution) is **advisory** and, if applied, goes through the **existing typed apply/
  rollback path** — never a new mutation primitive. No kernel, no injection.
- **Name the cause, in plain language**, with a risk tier and a source — not a scary graph.
- **Be blunt about myths** (global timer hack, "ping-lowering" tweaks) — that out-credibles every YouTube
  tweak guide, exactly the roadmap's point.
- **Ties to the efficacy loop:** "we measured your DPC latency before & after this driver change."

## Architecture (dark)
- **New `src-tauri/src/latency.rs`** — pure summarizers + thin platform readers (mirrors `benchmark.rs`).
  `mod latency;` only, **not registered** in `invoke_handler` until un-parked.
- **Reuses** `winreg` (present), `wmi` (present), `ferrisetw` (present, Phase 2). No new heavy deps.
- **Read-only**; no changes to `actions.rs` / mutation paths.

## Phase-1 first increment (building now)
**MSI-mode checker** — enumerate PCI devices exposing `MSISupported`, report name + MSI on/off + a summary.
Pure `summarize_msi` (tested) + a thin live registry reader (verified on real hardware). Honest, actionable
("your GPU is on legacy line interrupts — MSI usually lowers latency; advisory, reversible").
