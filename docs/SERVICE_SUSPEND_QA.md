# Service-Suspend (Phase-B, BUILT-DARK) — Mutation-QA Sign-off Report

> **UPDATE (2026-06-25): gate now ARMED.** After this owner-present live QA passed, `service_suspend_gate()`
> (`actions.rs:1350`) was flipped to `true` with owner sign-off — service-suspend is ARMED on `main` (see
> `docs/RELEASE_STATE.md`). The "STAYS DARK" status below is the point-in-time framing as of the QA run.
>
> **Status (at QA time): gate STAYS DARK.** `actions::service_suspend_gate()` returned `false` throughout. Nothing in
> this QA flipped it, shipped it, or modified the mutation boundary. Arming (flipping the gate + wiring a
> picker/UI) remains the owner's explicit decision (LOCKED-rule-6, owner greenlit *adding* the gated
> mutation 2026-06-22; the *arming* still rides this QA + sign-off).
>
> **Date:** 2026-06-24 · **Rig:** AMD dev rig, **UAC ON** (`EnableLUA=1`, verified). **Driven via the
> `#[cfg(test)]` `ForceServiceSuspendGate` / `ForceElevationError` seams** (compiled OUT of shipped
> binaries) — exactly the `gaming_mode_qa` precedent. The harness drives the orchestrator/primitive
> **directly**; the command-layer gate is never flipped.

## What "service suspend" is (the contract)

Session-scoped `Stop-Service` of a **type-enforced allowlisted** service (`KnownService` = `SysMain`,
`DiagTrack`, `WSearch`, `NvTelemetryContainer` — **only** these 4). SUSPEND ≠ DISABLE: the StartupType
is left untouched, so the service resumes on `Start-Service` / next reboot. Apply **snapshots the true
prior state first** (`Snapshot::Service`); a suspended service rides the **same** crash-safe session
contract as the core gaming bundle (`ResumeServiceFromSnapshot` → resolved by `dispatch_rollback`), so
resume happens automatically on stop / restore / crash-recovery — no new restore path.

Code: `actions.rs` (`apply_service_suspend` 1342, `rollback_service_suspend_typed` 1466,
`service_suspend_gate` 1302, `KnownService` 38, `require_service_prior` 1210) ·
`gaming_orchestrator.rs` (`services_to_suspend` 79, session start/restore/recover/detect_orphan) ·
`history.rs` 332. No dedicated spec doc — the contract lives inline + in the Gaming-Mode F1 design +
BACKLOG Phase-B.

## Result matrix (each scenario PASS, with ground-truth evidence)

| # | Scenario | Verdict | Proof |
|---|----------|---------|-------|
| 1 | Clean suspend → restore EXACT prior | ✅ PASS (deterministic) + ⏳ **owner-present live arm ready** | constituents proven now; real Stop/Start-Service arm needs your UAC clicks |
| 2 | Crash / orphan recovery | ✅ PASS (deterministic + mechanism) + ⏳ **owner-present live arm ready** | orphan→recover→clear proven now; real end-to-end arm needs UAC |
| 3 | UAC-cancel leaves NO partial state | ✅ **PASS (live, seam)** | before == after, error surfaced |
| 4 | Fail-loud on unreadable prior (the "missing plan" analog) | ✅ **PASS (live)** | refuses before mutating; restore is a no-op fail-safe |
| 5 | Hard-blocked / critical services never touched | ✅ **PASS (live)** | type-enforced allowlist drops csrss/lsass/services/unknown |

### Scenario 3 — UAC-cancel during the service step leaves no partial state ✅ PASS
`gaming_mode_qa::qa9_in_session_service_suspend_failure_undoes_partial` (gate opened via seam,
elevation forced to fail via `ForceElevationError` — **no real UAC prompt**). Ground truth:
```
[QA9] before: plan=Some("db9dd473-74ff-4582-ba26-39eaf4cdac4a") game_mode_on=false game_bar_off=true
[QA9] after : plan=Some("db9dd473-74ff-4582-ba26-39eaf4cdac4a") game_mode_on=false game_bar_off=true err=true
```
The UAC-free core applied, the elevated service step was refused → `start()` undid the partial core and
returned an error; **before == after** (exact prior), no contract left on disk. At the primitive level
`apply_service_suspend` reads the prior (non-elevated) then elevates `Stop-Service` — a cancel returns
`Err` via `?` **before** any mutation and writes **no** ledger entry (fail-safe).

### Scenario 4 — fail-loud on an unreadable prior ✅ PASS
The service analog of gaming-mode's "missing power plan." `service_prior_refusal_tests` (3/3 PASS):
`refuses_when_prior_unreadable`, `refusal_names_the_action_verb` ("refusing to **suspend** a service we
can't roll back"), `passes_a_readable_prior_through_verbatim` (no fabrication of `Running`/`Auto`). Apply
**REFUSES before elevating** when WMI can't snapshot the prior. Restore-time fail-safe:
`resume_is_a_noop_with_no_elevation_when_prior_was_not_running` (PASS) — a non-`Running` prior issues
**zero** elevated commands.

### Scenario 5 — critical / off-allowlist services can never be touched ✅ PASS
`from_name_enforces_the_allowlist_and_rejects_critical_services` (PASS): `csrss`, `lsass`, `services`,
`""` → `None`. `gate_open_maps_allowlisted_and_drops_offlist` (PASS): `lsass` + unknown dropped, only
allowlisted survive. `giant_or_duplicate_list_is_bounded_to_the_allowlist_size` (PASS): a 10k flood
collapses to the ≤4 allowlist (a compromised webview can't drive a flood of elevations). **Type-enforced:**
`KnownService` is a 4-member enum; nothing off-list can be constructed to reach the primitive.

### Scenario 2 — crash / orphan recovery ✅ PASS (deterministic) + ⏳ live arm ready
`qa_svc_orphan_recovery_resolves_service_change_and_clears` (**new**, deterministic — fixture with a
Service change, prior `"Stopped"` → resume is a no-op → no elevation/no real mutation):
```
[QA-SVC-ORPHAN] orphan=Some(Active) recover=Ok(())
```
An `Active` service-suspend session left on disk was detected as a recoverable orphan, `recover(true)`
resolved the `Service` change and **cleared** the contract. Mechanism corroborated by
`gaming_mode_qa::qa2_crash_then_orphan_recovery_restores` (the live core-bundle recover path) and
`service_change_round_trips_through_session_file_no_schema_bump` (a `Service` change serializes and
restores in correct reverse order, no schema bump).

### Scenario 1 — clean suspend → restore exact ✅ constituents PASS + ⏳ live arm ready
`suspend_typed_contract_round_trips` (PASS — `SuspendKnownService` / `ResumeServiceFromSnapshot`
serde round-trip) and the resume no-op fail-safe (PASS) prove the contract shape. The single real
suspend→resume proof (`actions::service_suspend_tests::qa_suspend_then_resume_restores_exact_state`)
performs a **real elevated** `Stop-Service`/`Start-Service` on `WSearch` and asserts exact-prior restore
from WMI ground truth — it needs your UAC clicks (below).

### Gate discipline ✅ PASS
`gate_is_dark_until_qa_and_owner_signoff` (PASS — `service_suspend_gate()==false`) and
`gate_bypass_seam_opens_only_while_armed_then_closes_on_drop` (PASS — the `#[cfg(test)]` seam is the
**only** opener and re-closes on drop; never compiled into shipped binaries).

## What was run NOW (autonomous, no UAC) — all green
```
cargo test --manifest-path src-tauri/Cargo.toml service_suspend service_prior -- --test-threads=1
cargo test --manifest-path src-tauri/Cargo.toml \
  qa9_in_session_service_suspend_failure_undoes_partial \
  qa_svc_orphan_recovery_resolves_service_change_and_clears \
  -- --ignored --test-threads=1 --nocapture
```
Deterministic service-suspend tests: 13 PASS (10 + 3 refusal). Seam/fixture `#[ignore]` arms: 2 PASS
(QA9, QA-SVC-ORPHAN). Full backend suite: **566 passed, 0 failed, 19 ignored, zero warnings**.
Independent `rust-tauri-reviewer` pass: test-only, gate stays dark, mutation boundary untouched,
restore-before-assert — A–E all PASS.

## Remaining before the owner flips the gate — 2 owner-present arms + the decision

These two arms perform **real elevated mutation** (Stop/Start-Service on `WSearch`) → a **real UAC prompt
appears that a human must approve**. They are `#[ignore]`d (never auto-run / never in CI) and are
**restore-before-assert** (the rig is returned to its prior state before any assertion). Run them with
**you at the keyboard to click the UAC prompts**:
```
cargo test --manifest-path src-tauri/Cargo.toml \
  qa_suspend_then_resume_restores_exact_state \
  qa_svc_session_crash_recovery_resumes_exact_state \
  -- --ignored --test-threads=1 --nocapture
```
Expect: scenario 1 — WSearch stops, then resumes to its EXACT prior state; scenario 2 —
suspend-in-session → "crash" → orphan detected → recover resumes WSearch to its prior state + clears the
contract.

**After both pass with you present**, the gate flip (`service_suspend_gate()` → `true`) + the picker/UI
wiring is your explicit arming decision — out of scope for this QA. The verified zero-mutation property
holds until then.
