# Intelligence Phase 3 — User-Started Experiment Engine + Optimization Simulator (DARK)

> Decision record for the §4F/§4G train of the owner directive
> (`docs/reviews/2026-07-16-owner-directive-intelligence-platform.md`). Phases 1 & 2 shipped
> (`8f612d2`/`d45bb1c`, `9c6af4b`/`094d834`). This is Intelligence Phase 3 (namespace rule §6 —
> never bare "Phase 3"; the Optimization Cleanup lane owns its own Phase 0–3).

## 1. What ships this train

A **user-started, single-variable controlled-experiment engine** and an **optimization simulator**,
both **DARK** behind one hard-false gate (`experiment::experiment_gate() -> bool { false }`, mirrors
`receipts_gate`/`gaming_mode_gate`). The engine ORCHESTRATES the existing audited mutation boundary —
it invents **no new** apply/rollback primitive, adds **no** `AppliedAction`/`RollbackAction`/`Snapshot`
variant, and resolves rollback from `history.json` alone (mutation-gate items 1–3 preserved by
construction).

- **Simulator (§4G):** a **pure, read-only** advisory that, before any experiment, estimates whether a
  change is worth a controlled test. Outputs the seven verbatim verdicts — `unlikely-to-matter ·
  plausible-unproven · worth-testing · already-configured · not-applicable · risk-exceeds-value ·
  insufficient-evidence` — and explains *why the setting is/isn't relevant · which detected hardware or
  state drives the call · what metric should move if the theory holds · what result would disprove it*.
  Never a promise of gain. Confidence is a **band** (`intelligence::Confidence`: unknown/low/medium/high),
  never a number.
- **Experiment lifecycle (§4F):** `start → conclude → (keep | restore)`. Baseline
  captured, current state snapshotted (via the existing apply path's snapshot), ONE reversible change
  applied via `history::apply_recommendation`, then a single atomic `conclude_experiment` **records the
  treatment AND judges it in one step** — delta judged against the **same 3% noise floor** the rest of
  the app uses (`comparison::classify_with_guards` on the 1%-low), then auto-restore on
  regression/unsupported result via `history::rollback_change`, keep only when evidence justifies it.
  (As-built: record + judge were **collapsed into one `conclude_experiment` call** rather than a
  separate `record_experiment_treatment` step — it removes a half-recorded window, so there is no state
  where a treatment is stored but unjudged.) The full experiment is persisted to its own store.

## 2. Persistence

New own-store `experiments.json` under `compy_data_dir()`, **atomic tmp+rename** write + corrupt→aside
loader, copied verbatim from `intelligence.rs` (`store_path`/`save_store_to`/`load_store_from`). No
schema change to `history.json`; the experiment record references the produced `applied_change_id` so
restore rides the existing ledger rollback.

## 3. The safety contract (§4F, mechanized in code + tests)

One attributable variable at a time · **warn** when multiple Compy changes are already active (never
imply attribution when variables are combined) · **stop** on: failed snapshot · failed apply · failed
telemetry · insufficient samples · crash · restore failure · **never** continue unattended after an
error · **never** hide partial success · **never** start without explicit user action (the gate + an
explicit `start_experiment` call — no background/scheduled trigger exists). Every stop yields an honest
`stop_reason`, never a silent skip. Unsafe/barred tweaks are **refused** by the simulator
(`risk-exceeds-value`) and never enter the lifecycle.

## 4. Honesty guards (anti-fabrication — §1 laws)

- A delta within the noise floor is **`no-change`**, never "improved" (boundary inclusive, reuses
  `comparison::classify`).
- Multiple active changes / ledger advanced ⇒ **`confounded`**, attribution refused (reuses
  `classify_with_guards`).
- Baseline older than `ARM_MAX_AGE_DAYS` ⇒ **`expired`**.
- Fewer than the minimum samples ⇒ **`insufficient-evidence`**, never a verdict.
- Confidence is a band; no numeric confidence anywhere.
- Missing evidence renders as unknown/insufficient, never zero.

## 5. Surfaces / gate

- Backend commands (all hard-check the gate; **refuse while dark**, defense-in-depth like
  `preview_receipt_payload`): `get_experiment_gate` · `simulate_optimization` · `start_experiment` ·
  `conclude_experiment` (records treatment + judges atomically — see §1's as-built note; there is no
  separate `record_experiment_treatment`) · `restore_experiment` · `get_experiments`
  (read-only, returns `[]` while dark since nothing can be created).
- FE: a Lab surface that probes `get_experiment_gate` and **returns null while dark** (fail-dark on
  probe error), mirroring `ReceiptsConsent`/`PreloadApps`. Test-pinned to render nothing while gated →
  zero pixels change this train.

## 6. Small helper additions (read-only, additive)

- `history::active_change_count() -> usize` — count of still-active Compy changes, for the
  single-variable warning. Read-only, additive (mutation-gate item 1: new fn, no enum/contract change).
- `comparison::DEFAULT_NOISE_FLOOR_PCT` bumped `const` → `pub(crate)` so the experiment engine
  references the ONE 3% floor rather than re-declaring the literal (single source of truth).

## 7. Arming — DONE 2026-07-17 (owner-signed)

`experiment_gate()` flipped `false` → `true` (`experiment.rs:49`) on its own reviewable commit after:
owner sign-off **"Ship it live now"** + a live apply→rollback round-trip on the real rig (a benign
reversible rec applied through `history::apply_recommendation` then restored via
`history::rollback_change`, clean ledger restore verified) + rust-tauri-reviewer PASS on the arming
diff + Cowork-lane adversarial audit flagged. The two dark unit tests were converted to the armed
reality (`gate_is_armed_after_qa_and_owner_signoff` + `armed_lifecycle_commands_no_longer_refuse_for_the_gate`);
every command still hard-checks the gate as defense-in-depth (now unreachable while armed). At arming,
`build_sim_context` (`experiment.rs:679`) was wired from hardcoded priors to the REAL hardware-tailored
catalog (`recommendations::get_recommendations` over the serde JSON boundary, READ-ONLY; unknown rec ⇒
honest insufficient-evidence, never a fabricated verdict). Flipping the gate BACK is likewise an
owner-signed decision, never a refactor side effect. **The owner's first real gaming-session experiment
IS the live FPS→verdict QA** — real frames from a real game are the owner's to produce (anti-fabrication
law); the engine cannot manufacture them.

## 8. Definition of done (this train)

`experiment.rs` (types + simulator + lifecycle + gate + commands + store) · `history::active_change_count`
· `comparison` const visibility · lib.rs `mod experiment;` + handler registration · FE dark surface +
render-nothing test · cargo tests UP (gate-false, each-command-refuses-while-dark, simulator verdicts,
keep/restore verdict logic, single-variable warning, insufficient-samples/crash stop, store round-trip) ·
clippy clean · tsc + vitest green · mutation-gate 10/10 + rust-tauri-reviewer PASS · RELEASE_STATE row +
BACKLOG flip, same commit. No network, no capability expansion, no mutation-boundary contract change.
