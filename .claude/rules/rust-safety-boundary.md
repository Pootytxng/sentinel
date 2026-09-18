---
paths:
  - "src-tauri/**"
---
# Rust safety boundary — the ★ half of the module map

> **Path-scoped rule: loads only when work touches `src-tauri/`.** The root `CLAUDE.md` keeps the
> ★ index, the `.rs` file count and the pointer here, so every session still knows which modules are
> the safety boundary; this file carries their entries. The read-only half lives in
> `src-tauri/CLAUDE.md`. `node scripts/verify-module-map.mjs` reads all three as one map and fails
> on a missing module, a ghost, a wrong count, a duplicate, an unstarred mutator, or a root ★ index
> that disagrees with the stars below.

### Rust module map — ★ mutation, rollback & gate modules (continued from the root `CLAUDE.md`)

Line counts are rough. **Mutation/rollback + gate-relevant modules are starred ★ — scope any
mutation-gate change against these first.**

**Core wiring & entry**
- `main.rs` — argv router: `--fps-capture` → headless ETW helper (`run_fps_capture`); `--run-elevated <hex>` → elevated-PowerShell child (elevation boundary, owner territory); else `run()`. Runs BEFORE any window.
- ★ `lib.rs` (~1870) — `run()` wiring + command registration, state probes, `compy_data_dir`, startup-apps, `gaming_mode_gate` (`lib.rs:558`), `safety_tests`. ★ for the command surface only — the `set_startup_entry_enabled` exception closed 2026-08-03; it lives in `history.rs` and mutates through `actions::apply_startup_entry_enabled` like every other apply.

**★ Mutation, rollback & gates (the safety boundary)**
- ★ `actions.rs` (~5404) — THE Windows-mutation + rollback boundary, no exceptions: typed `AppliedAction`/`RollbackAction`/`Snapshot`, all `apply_*`/`rollback_*_typed`, `dispatch_rollback`, `resolve_rollback`, `synthesize_legacy_rollback`, `run_elevated_powershell`.
- ★ `history.rs` (~2416) — Trust Ledger: `AppliedChange`, persistence (`load/save_history`), `apply_recommendation`/`rollback_change`/`get_applied_changes`. Rollback resolves from local history ALONE.
- ★ `gaming_orchestrator.rs` (~1660) — Gaming Mode session lifecycle: start/stop/keeper, orphan detection + recovery, staged-change commit. Mutation-boundary.
- ★ `gaming_session.rs` (~513) — Gaming Mode session model + atomic persistence (`gaming-session.json`, `SESSION_SCHEMA_VERSION`).
- ★ `game_mode_persist.rs` (~190) — Game Mode registry snapshot/persist helpers.
- ★ `services.rs` (~1040) — service-suspend/debloat mutation surface (ARMED).
- ★ `gpu_profile.rs` (~590) — GPU profile handling (apply structurally impossible → advisory; AMD state not user-mode readable).
- ★ `remote_rules.rs` (~590) — signed remote-rules (Ed25519 verify wired, fetch triple-gated OFF).
- ★ `receipts.rs` (~633) — Receipts gate + Tier 2 send path (Q9a): `send_decision` refuses gate → disclosure → opt-in. Built dark, hard-false, **default-OFF even armed** (#207).
- ★ `license.rs` (~519) — Compy Pro license gate (built dark).
- ★ `drift.rs` (~477) — applied-change drift detection vs live machine state.
- ★ `data_root.rs` (~1050) — canonical data-root resolver (#130): measures where the root LANDS, not the `APPDATA` string; halts on a split; issues `MutationRoot`, the capability `history.rs`/`actions.rs` now require. Guard: `scripts/data-root-guard.test.mjs`.
- ★ `race_seam.rs` (~856) — test-only store-lock instrumentation, an empty `#[inline(always)]` no-op in release: `hold()`/`panic_at()` hold a read-then-act window open from inside a critical section so #283's lock tests fail on demand, and `acquiring()`/`hold_lock`/`try_hold_lock`/`ALLOWED_NESTING` record every acquisition of the ten process-wide PERSISTENCE locks so a re-entrant or undeclared nesting panics by name instead of hanging (#398). Boundary is persistence, not "all locks" — in-memory caches, throttles and the `try_lock`-only session gate are out, and `LOCK_CENSUS` in `scripts/store-lock-order-guard.test.mjs` fails if any `static` mutex in the tree lacks a written verdict. It observes only the nestings a test actually runs; the scanner is a source-text change detector; neither is a proof that the lock graph is acyclic.
