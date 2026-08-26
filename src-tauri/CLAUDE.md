# src-tauri — Rust module map (read-only half)

> **Auto-loads only when work touches `src-tauri/`.** The ★ mutation, rollback & gate modules —
> `actions.rs`, `history.rs`, `gaming_orchestrator.rs`, `gaming_session.rs`, `game_mode_persist.rs`,
> `services.rs`, `gpu_profile.rs`, `remote_rules.rs`, `receipts.rs`, `license.rs`, `drift.rs`, plus
> the `main.rs`/`lib.rs` core wiring — stay in the root `CLAUDE.md`, which every session loads,
> because scoping a change against the safety boundary is a safety step and not a lookup. This file
> carries the read-only remainder, which only Rust work needs.
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

**Monitoring, FPS & sessions**
- `monitoring.rs` (~1300) — monitor-tool orchestration + sensor coverage.
- `fps.rs` (~1092) — FPS/frametime IPC (`fps.json`/`fps.alive`) from the ETW helper.
- `sessions.rs` (~569) — session-summary persistence (`sessions.json`).
- `stutter.rs` (~135) — stutter/1%-low derivation.

**Benchmark & Lab**
- `benchmark.rs` (~1330), `benchmark_trial.rs` (~615), `benchmark_verdict.rs` (~580), `benchmark_scoreboard.rs` (~460), `comparison.rs` (~475) — the Lab proving-ground bench: trials, verdicts, scoreboard, A/B comparison.
- `latency.rs` (~2255) — input/network latency probes.
- `blackbox.rs` (~2150) — diagnostic black-box capture.

**Advisory, ranking & export**
- `recommendations.rs` (~970), `readiness.rs` (~1615), `priorities.rs` (~707), `diagnostics.rs` (~637), `leftovers.rs` (~1200) — recs catalog, gaming-readiness, priority ranking, diagnostics, leftover-cleanup advisory.
- `export.rs` (~814) — evidence-pack / share-card export.
- `support_evidence.rs` (~931) — Q5 local support evidence: bounded, redacted-at-construction, on-disk only. No outbound surface (`src/support-evidence-outbound-guard.test.ts`); `record` swallows every error so it can never block a rollback.
- `case_intelligence.rs` (~4400) — **Compy Care Tier 1, DARK** (#220): the signed, pull-only PUBLIC-ADVISORY catalog — strict domain types + parser, its OWN trust root (`verify_catalog_chain`: Ed25519 over a Tier-1-only signing context, so a remote-rules signature cannot cross over even on a shared key), and a last-known-good cache under `%APPDATA%\Compy\case-intelligence\` that re-verifies on every read, and the pure local matcher (`match_facts`/`advise`) that compares a signed write-up against this machine's own facts — an unreadable fact never satisfies a matcher, and every word shown is the catalog's, never Compy's. The whole transport is one shape — a bare GET for a compiled URL, no body, query string, cookie or custom header — so no machine fact can travel even by accident; `CASE_CATALOG_ENDPOINTS` is EMPTY and a deny-only `fetch-disabled` file refuses every fetch locally. DOWNLOAD-only; it uploads no machine data, so it is advisory, not an outbound *send* path like Tier 2. Its own key/schema/origins/cache, separate from the privileged remote-rules trust domain. Cannot represent a command, registry path, action id or regex; matchers are a closed set over a lowercase token charset. `case_intelligence_gate()` is hard-false and CASE_CATALOG_ORIGINS is EMPTY, so no manifest can validate. **When the owner arms it this line moves to the ★ half in the root `CLAUDE.md`** — a live gate belongs in the always-loaded file.
- `incident_observer.rs` (~1268) — **Compy Care Tier 1, plan task 9:** the persisted LOCAL incident observer. Reads `blackbox::get_crash_blackbox()` on three named moments only — app launch, main-window foreground, session finalized — and never in between: **no timer, service, scheduled task, watcher or poll exists**, and the two non-launch triggers are throttled by `SCAN_MIN_INTERVAL_SECS` against a persisted watermark. A crash that happened while Compy was closed is caught by the untrottled `Launch` pass. State is one small JSON file (`%APPDATA%Compycareincident-observer.json`, atomic write, corrupt/unknown-schema file quarantined and re-seeded silently); the first-ever pass SEEDS and announces nothing, so installing Compy never generates notifications about pre-Compy crashes. An incident's id is a hash over its traits and Windows keeps revising those (a WER report merges in minutes later and moves the recorded instant), so each remembered row stores the matching traits and `reconcile_identity_shifts` re-points it — without that, a dismissed card comes back under a new id. Announces at most one toast per scan under a 30-minute family cooldown, and says only WHAT happened and WHEN — the DTO carries no cause, confidence or advisory field, because a notification strips the hedge, the evidence and the limits off Tier 1's prose. Opens no network path of its own, mints no identity, and is NOT a mutation boundary: `dismiss_care_incident` clears Compy's own pointer and deletes no Windows record. Commands: `get_pending_care_incident` / `mark_care_incident_opened` / `dismiss_care_incident` (main window only, not the overlay). Guards: `src/care-incident-observer-contract.test.ts` + `src/surfaces/care-home-route-guard.test.ts`.
- `tray.rs` (~177) — system-tray integration.

**Intelligence & Measurement Platform (read-only, additive — no mutation markers, verified 2026-08-02)**
- `intelligence.rs` (~3614) — Phase 1: canonical intelligence types, local event timeline, deterministic "What changed?" engine. READ-ONLY by doctrine; never mutates Windows, never networks.
- `intelligence_patterns.rs` (~903) — Phase 2: cross-session pattern detection over `sessions.json`.
- `experiment.rs` (~1420) — Phase 3: single-variable experiment engine + optimization simulator. **ARMED** (`experiment_gate()` returns true, owner sign-off 2026-07-17) — the bench renders live. It APPLIES via `history::apply_recommendation`, so an already-active rec simulates to `already-configured`; do not route a rollback-shaped next test here.
- `component_evidence.rs` (~332) — Phase 4: component-level evidence attribution. READ-ONLY.
- `comparability.rs` (~730), `game_state.rs` (~276), `capture.rs` (~279) — Measurement Platform 2.0 tasks E/F: session-comparability gate, conditions fingerprint, capture-backend/capability model.
- `fuzz_support.rs` (~184) — test-only input generator for the property/fuzz suites.
