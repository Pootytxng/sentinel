# Q2 — custom-command caller inventory

> **Read-only.** This document is steps 1 and 2 of Q2 in
> `2026-07-29-product-quality-stabilization-program.md`: inventory every production `invoke()` by
> caller window, and classify every registered command. **No capability, CSP, command registration,
> or network behaviour is changed by this file.** Implementation is gated on an explicit owner GO
> for capability/security behaviour, and that GO is what this inventory exists to inform.

## The finding, in one line

**The overlay uses 3 commands. It can call all 91.**

`tauri_build::AppManifest::commands` is not configured, so every command registered in
`generate_handler!` is reachable from every webview the app owns — including the overlay, which is a
borderless always-on-top surface whose entire job is to render four numbers.

## Measured

| | Count |
|---|---:|
| Commands registered in `generate_handler!` | **91** |
| Invoked anywhere in the production frontend | 81 |
| **Invoked by `Overlay.tsx`** | **3** |
| Reachable from the overlay today | **91** |
| Of those, state-changing or mutating | **38** |
| Registered but never invoked from any frontend file | 10 |

## 1 — Overlay read-only: everything it actually needs

| `get_cpu_sensors` | `get_fps_status` | `get_gpu_sensors` |

`Overlay.tsx` contains exactly three `invoke` sites, all in a polling effect, all reads. It imports
no shared hook that invokes anything else. This is the complete grant the overlay requires.

## 2 — Never called from the frontend at all

These are registered and therefore overlay-reachable, while no production code path invokes them.
Three of them mutate the machine:

| `dismiss_readiness_check` | `get_diagnostics` | `get_priorities` |
| `get_rules_source` | `restore_leftover` | `restore_readiness_check` |
| `set_keep_game_mode` | `stack_trial_armed` | `start_stack_trial` |
| `suspend_known_service` | | |

`suspend_known_service`, `restore_leftover` and `start_stack_trial` are the ones worth looking at
first: reachable from the overlay, callable by nothing, and each one changes system state.

## 3 — Main-window state change / mutation

Currently reachable from the overlay. Nothing about the overlay's job requires any of them.

| `acknowledge_hardware_changes` | `apply_recommendation` | `apply_recommendations_batch` |
| `arm_comparison` | `arm_tuning` | `begin_update_restart` |
| `cancel_benchmark` | `cancel_trial` | `cancel_update_restart` |
| `clear_benchmark_baseline` | `clear_scoreboard` | `clear_tuning` |
| `conclude_experiment` | `disable_known_bloat_task` | `dismiss_comparison` |
| `export_report` | `hide_overlay` | `open_export_folder` |
| `recover_gaming_session` | `remove_known_preload_app` | `report_tuning_crash` |
| `restore_experiment` | `rollback_change` | `set_benchmark_baseline` |
| `set_close_to_tray` | `set_license_key` | `set_overlay_corner` |
| `set_startup_entry_enabled` | `show_overlay` | `simulate_optimization` |
| `start_benchmark` | `start_calibration` | `start_experiment` |
| `start_fps_capture` | `start_gaming_session` | `start_tweak_trial` |
| `stop_fps_capture` | `stop_gaming_session` | |

Note `begin_update_restart` and `cancel_update_restart` in that set — the update restart barrier can
be started or cancelled from the overlay today, which is one of the acceptance criteria Q2 names
explicitly.

## 4 — Main-window read-only

Not dangerous, but not the overlay's business either; the overlay renders CPU, GPU and FPS.

| `gaming_mode_enabled` | `gaming_session_is_live` | `get_appliable_rec_ids` |
| `get_applied_changes` | `get_armed_comparison` | `get_benchmark_state` |
| `get_build_stamp` | `get_component_evidence` | `get_cpu_temp` |
| `get_crash_blackbox` | `get_experiment_gate` | `get_experiments` |
| `get_fan_sensors` | `get_game_readiness` | `get_gaming_session_state` |
| `get_hardware_changes` | `get_hardware_info` | `get_intelligence_headline` |
| `get_intelligence_patterns` | `get_intelligence_timeline` | `get_latency_diagnostics` |
| `get_latest_comparison` | `get_leftovers` | `get_license_status` |
| `get_memory_pressure` | `get_nic_driver_info` | `get_preload_apps` |
| `get_receipts_gate` | `get_recommendations` | `get_scoreboard` |
| `get_session_summaries` | `get_startup_entries` | `get_trial_state` |
| `latency_measure_mouse` | `latency_measure_wake` | `overlay_visible` |
| `preview_receipt_payload` | `priorities_from` | `what_changed_between` |
| `what_changed_for_session` | | |

## What the GO would authorise

Q2's implementation order, unchanged from the blueprint:

1. configure `AppManifest::commands` so registration stops implying every window;
2. grant the overlay exactly the three commands in section 1;
3. add a main-window caller check to mutation, license-key, Gaming Mode lifecycle, tray/startup
   preference and update-barrier commands, as defence in depth;
4. preserve the updater plugin's existing main-window-only capability;
5. add a static guard that fails when a new command is registered without a caller classification.

No remote URL access, CSP, opener scope, filesystem scope or network behaviour is touched.

## What this inventory does not claim

- It does not assert any of these commands **has** been called from the overlay — only that nothing
  prevents it. The overlay is a local webview rendering local data; this is defence in depth, not an
  incident.
- The classification is by name and call-site, not by reading each command's body. Before the grant
  is written, the mutation set should be confirmed against its implementations — a `get_` prefix is
  a convention, not a proof of read-only.
- `latency_measure_mouse` and `latency_measure_wake` are counted as read-only because they return
  measurements, but they *run* a measurement. They belong in the main-window set either way.
