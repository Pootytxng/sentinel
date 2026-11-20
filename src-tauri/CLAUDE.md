# src-tauri — Rust module map (read-only half)

> **Auto-loads only when work touches `src-tauri/`.** The root `CLAUDE.md`, which every session
> loads, keeps the ★ index and `.rs` count, because knowing which modules are the safety boundary is a
> safety step and not a lookup. The ★ entries and `main.rs`/`lib.rs` core wiring live in
> `.claude/rules/rust-safety-boundary.md` (#479), which loads alongside this file. This file carries
> the read-only remainder.
>
> **Both halves are one map.** `node scripts/verify-module-map.mjs` reads them together and fails on
> a missing module, a ghost, a wrong file count, a module declared in both halves, or an unstarred
> module that writes Windows state. It also fails if the root delegates here and this section is
> gone — a half-map that passes vacuously is worse than no map. The `.rs` file count lives in the
> root header, deliberately in one place so it cannot drift against itself.

Line counts drift — treat as rough and verify against current code before asserting.

### Rust module map — read-only modules (continued from the root `CLAUDE.md`)

**Hardware, sensors & detection (read-only probes)**
- `hardware.rs` (~3350) — `HardwareInfo` probe (CPU/GPU/RAM/storage/network); Rust↔TS serde contract.
- `cpu_temp.rs` (~1137) — HWiNFO shared-memory CPU-temp/fan read (SEH-crash risk noted in audit). GPU temp via vendor SDK elsewhere.
- `amd_freesync.rs` (~250), `overlay_tools.rs` (~230), `hwchange.rs` (~190) — FreeSync detection, overlay-tool detection, hardware-change tracking.
- `hw_class.rs` (~190) — tier-neutral pure hardware-class helpers (basename token / RAM bucket / GPU vendor token), extracted from Tier 2's receipts module per the Q9b contract §4 so Tier 2 and Tier 3 share exact vocabularies without a tier import. Imports no tier module; guarded by `src/case-evidence-tier-separation-guard.test.ts`.

**Monitoring, FPS & sessions**
- `monitoring.rs` (~1300) — monitor-tool orchestration + sensor coverage.
- `other_load.rs` (~626) — TG-context v2, record only: how busy everything but the game was during a capture (CPU share from a handle-free process snapshot, GPU Engine counters), numbers only. Opens no process handle, writes no Windows state.
- `fps.rs` (~1092) — FPS/frametime IPC (`fps.json`/`fps.alive`) from the ETW helper.
- `sessions.rs` (~569) — session-summary persistence (`sessions.json`).
- `stutter.rs` (~135) — stutter/1%-low derivation.

**Benchmark & Lab**
- `benchmark.rs` (~1330), `benchmark_trial.rs` (~615), `benchmark_verdict.rs` (~580), `benchmark_scoreboard.rs` (~460), `comparison.rs` (~686) — the Lab proving-ground bench: trials, verdicts, scoreboard, A/B comparison.
- `noise_floor.rs` (~447) — P4-noise-store: each game's own run-to-run noise on this PC, recorded by a Lab calibration (`noise_floors.json`, written through `atomic_write`) and looked up by a Trial conclude as Measured / Stale / Unmeasured. Never guesses a level it did not measure. Writes no Windows state.
- `latency.rs` (~2255) — input/network latency probes.
- `blackbox.rs` (~2150) — diagnostic black-box capture.

**Advisory, ranking & export**
- `recommendations.rs` (~970), `readiness.rs` (~1615), `priorities.rs` (~707), `diagnostics.rs` (~637), `leftovers.rs` (~1200) — recs catalog, gaming-readiness, priority ranking, diagnostics, leftover-cleanup advisory.
- `export.rs` (~1278) — evidence-pack / share-card export.
- `support_evidence.rs` (~931) — Q5 local support evidence: bounded, redacted-at-construction, on-disk only. No outbound surface (`src/support-evidence-outbound-guard.test.ts`); `record` swallows every error so it can never block a rollback.
- `case_intelligence.rs` (~4629) — **Compy Care Tier 1, DARK** (#220): the signed, pull-only PUBLIC-ADVISORY catalog and its pure local matcher. Its OWN Ed25519 trust root, separate from remote-rules. DOWNLOAD-only — it uploads no machine data, so it is advisory, not an outbound *send* path like Tier 2 — and it cannot represent a command, registry path, action id or regex. `case_intelligence_gate()` is hard-false and `CASE_CATALOG_ENDPOINTS`/`CASE_CATALOG_ORIGINS` are EMPTY. Full contract (trust-root separation, transport shape, cache, arming move): `docs/CARE_TIER_MODULE_CONTRACTS.md` §1.
- `case_evidence_upload.rs` (~1735) — **Compy Care Tier 3, STAGE 1 ONLY, DARK** (Q9b, #252/#259): the PURE half of explicit per-case evidence upload — the §2 allowlist struct, its own six-class redactor (a deliberate §4 duplicate of `support_evidence`'s, never an import), and ONE canonical serializer the preview shares. NO command, NO HTTP, NO endpoint, NO consent state, NO queue; `case_evidence_gate()` is hard-false. Full contract (redactor residuals, §4 never-imports list, guards, arming move): `docs/CARE_TIER_MODULE_CONTRACTS.md` §2.
- `incident_observer.rs` (~1267) — **Compy Care Tier 1, plan task 9:** the persisted LOCAL incident observer — three named scan moments (launch / main-window foreground / session finalized), **no timer, service, scheduled task, watcher or poll**, one atomic JSON file, at most one WHAT-and-WHEN toast per scan. Opens no network path of its own and is NOT a mutation boundary. Full contract (throttle, identity reconciliation, DTO limits, commands, guards): `docs/CARE_TIER_MODULE_CONTRACTS.md` §3.
- `tray.rs` (~177) — system-tray integration.

**Intelligence & Measurement Platform (read-only, additive — no mutation markers, verified 2026-08-02)**
- `machine_model.rs` (~1494) — Phase 2 (#385): the shared Machine Model. Composes ONE read-only `Fact<T>` view (value + evidence class + source + honest unknown) from the producers above; owns no store and probes nothing itself. Reports identity disagreement, never resolves it.
- `intelligence.rs` (~3614) — Phase 1: canonical intelligence types, local event timeline, deterministic "What changed?" engine. READ-ONLY by doctrine; never mutates Windows, never networks.
- `intelligence_patterns.rs` (~903) — Phase 2: cross-session pattern detection over `sessions.json`.
- `experiment.rs` (~1420) — Phase 3: single-variable experiment engine + optimization simulator. **ARMED** (`experiment_gate()` returns true, owner sign-off 2026-07-17) — the bench renders live. It APPLIES via `history::apply_recommendation`, so an already-active rec simulates to `already-configured`; do not route a rollback-shaped next test here.
- `trial_candidates.rs` (~710) — P4-candidates/rank: read-only Trial picker filter + test order (ENGINE §3.1–3.7), one reason each.
- `realplay.rs` (~1400) — P5-realplay: pure judge (which sessions count, looks at 3/5/8, the Trial's own band). No I/O, lock or Windows state.
- `component_evidence.rs` (~332) — Phase 4: component-level evidence attribution. READ-ONLY.
- `comparability.rs` (~730), `game_state.rs` (~276), `capture.rs` (~279) — Measurement Platform 2.0 tasks E/F: session-comparability gate, conditions fingerprint, capture-backend/capability model.
- `fuzz_support.rs` (~184) — test-only input generator for the property/fuzz suites.

**Secondary state persistence**
- `atomic_write.rs` (~447) — whole-file byte replacement (temp in the target's own dir → rename) for the SECONDARY stores: benchmark, comparison, readiness dismissals, drift, and the license token — which is signed plain text, not JSON, so its exact bytes pass through unserialized. An interrupted save leaves the previous complete file instead of a truncated one that every loader reads as "no data". **NOT power-loss durability, NOT a lock, NOT a transaction** — the module doc says so and the tests prove only a named interruption point. Writes no Windows state, so unstarred. Deliberately NOT used by the Trust Ledger or the signed remote rules; the module doc says why (there, not here, because this map's halves must stay disjoint).
