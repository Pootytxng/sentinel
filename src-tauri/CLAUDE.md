# src-tauri — Rust module map (read-only / non-mutation modules)

> Auto-loads only when work touches `src-tauri/`. The **★ mutation, rollback & gate** modules —
> `actions.rs`, `history.rs`, `gaming_orchestrator.rs`, `gaming_session.rs`, `game_mode_persist.rs`,
> `services.rs`, `gpu_profile.rs`, `remote_rules.rs`, `receipts.rs`, `license.rs`, `drift.rs`, plus
> `main.rs`/`lib.rs` core wiring — stay in the root `CLAUDE.md` (always loaded) because scoping a
> mutation-gate change against them is a safety step, not a lookup. This file carries the rest.

Complete as of 2026-07-14 (35 `.rs` files total; line counts drift, treat as rough — verify against
current code before asserting).

**Hardware, sensors & detection (read-only probes)**
- `hardware.rs` (~3350) — `HardwareInfo` probe (CPU/GPU/RAM/storage/network); Rust↔TS serde contract.
- `cpu_temp.rs` (~520) — HWiNFO shared-memory CPU-temp/fan read (SEH-crash risk noted in audit). GPU temp via vendor SDK elsewhere.
- `amd_freesync.rs` (~250), `overlay_tools.rs` (~230), `hwchange.rs` (~190) — FreeSync detection, overlay-tool detection, hardware-change tracking.

**Monitoring, FPS & sessions**
- `monitoring.rs` (~1300) — monitor-tool orchestration + sensor coverage.
- `fps.rs` (~625) — FPS/frametime IPC (`fps.json`/`fps.alive`) from the ETW helper.
- `sessions.rs` (~330) — session-summary persistence (`sessions.json`).
- `stutter.rs` (~135) — stutter/1%-low derivation.

**Benchmark & Lab**
- `benchmark.rs` (~1330), `benchmark_trial.rs` (~615), `benchmark_verdict.rs` (~580), `benchmark_scoreboard.rs` (~460), `comparison.rs` (~475) — the Lab proving-ground bench: trials, verdicts, scoreboard, A/B comparison.
- `latency.rs` (~2255) — input/network latency probes.
- `blackbox.rs` (~2150) — diagnostic black-box capture.

**Advisory, ranking & export**
- `recommendations.rs` (~970), `readiness.rs` (~1615), `priorities.rs` (~707), `diagnostics.rs` (~637), `leftovers.rs` (~1200) — recs catalog, gaming-readiness, priority ranking, diagnostics, leftover-cleanup advisory.
- `export.rs` (~814) — evidence-pack / share-card export.
- `tray.rs` (~177) — system-tray integration.
