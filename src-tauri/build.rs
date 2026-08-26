use std::process::Command;

// Q2 COMMAND AUTHORITY (2026-08-03) — every custom command this app registers, declared so Tauri
// stops handing all of them to every window.
//
// WHY THIS LIST EXISTS: by Tauri's default, `invoke_handler(generate_handler![...])` makes every
// registered command callable from EVERY window and webview. Compy runs two: the main window and
// the always-on-top telemetry overlay. The overlay invokes exactly three read commands
// (`get_cpu_sensors`, `get_gpu_sensors`, `get_fps_status`) — and inherited authority over the other
// 88, including `apply_recommendation`, `rollback_change`, `set_license_key` and the update-restart
// barrier. Capability files were already least-privilege for PLUGIN permissions (updater and window
// controls are main-only); custom commands simply were not in that system at all.
//
// Declaring them here puts each command behind a generated `allow-<kebab-name>` permission, so the
// capability files become the authority: `capabilities/default.json` grants the main window all of
// them, `capabilities/overlay.json` grants the overlay its three.
//
// KEEP IN SYNC — `src/command-authority-guard.test.ts` fails the build when this list, the
// `generate_handler!` registration in `src/lib.rs`, and the capability grants disagree. A new
// command cannot ship without being classified.
const APP_COMMANDS: &[&str] = &[
    "acknowledge_hardware_changes",
    "acknowledge_receipts_disclosure",
    "apply_recommendation",
    "apply_recommendations_batch",
    "arm_comparison",
    "arm_tuning",
    "begin_update_restart",
    "cancel_benchmark",
    "cancel_trial",
    "cancel_update_restart",
    "clear_benchmark_baseline",
    "clear_scoreboard",
    "clear_support_evidence",
    "clear_tuning",
    "conclude_experiment",
    "disable_known_bloat_task",
    "dismiss_care_incident",
    "dismiss_comparison",
    "dismiss_readiness_check",
    "export_report",
    "export_support_evidence",
    "gaming_mode_enabled",
    "gaming_session_is_live",
    "get_appliable_rec_ids",
    "get_applied_changes",
    "get_armed_comparison",
    "get_benchmark_state",
    "get_build_stamp",
    "get_component_evidence",
    "get_cpu_sensors",
    "get_cpu_temp",
    "get_crash_blackbox",
    "get_data_root_report",
    "get_diagnostics",
    "get_experiment_gate",
    "get_experiments",
    "get_fan_sensors",
    "get_fps_status",
    "get_game_readiness",
    "get_gaming_session_state",
    "get_gpu_sensors",
    "get_hardware_changes",
    "get_hardware_info",
    "get_intelligence_headline",
    "get_intelligence_patterns",
    "get_intelligence_timeline",
    "get_latency_diagnostics",
    "get_latest_comparison",
    "get_ledger_health",
    "get_leftovers",
    "get_license_status",
    "get_memory_pressure",
    "get_nic_driver_info",
    "get_pending_care_incident",
    "get_preload_apps",
    "get_priorities",
    "get_receipts_consent",
    "get_receipts_endpoint",
    "get_receipts_gate",
    "get_recommendations",
    "get_rules_source",
    "get_scoreboard",
    "get_sensor_sources",
    "get_session_summaries",
    "get_startup_entries",
    "get_trial_state",
    "hide_overlay",
    "latency_measure_mouse",
    "latency_measure_wake",
    "launch_sensor_app",
    "mark_care_incident_opened",
    "open_export_folder",
    "overlay_visible",
    "preview_receipt_payload",
    "preview_support_evidence",
    "priorities_from",
    "recover_gaming_session",
    "remove_known_preload_app",
    "report_tuning_crash",
    "restore_experiment",
    "restore_leftover",
    "restore_readiness_check",
    "reveal_ledger_folder",
    "rollback_change",
    "set_benchmark_baseline",
    "set_close_to_tray",
    "set_keep_game_mode",
    "set_license_key",
    "set_overlay_corner",
    "set_receipts_sharing_enabled",
    "set_startup_entry_enabled",
    "show_overlay",
    "simulate_optimization",
    "stack_trial_armed",
    "start_benchmark",
    "start_calibration",
    "start_experiment",
    "start_fps_capture",
    "start_gaming_session",
    "start_stack_trial",
    "start_tweak_trial",
    "stop_fps_capture",
    "stop_gaming_session",
    "suspend_known_service",
    "what_changed_between",
    "what_changed_for_session",
];

// §C build provenance stamp (spec 2026-06-12): the git facts are read HERE, at compile time —
// the shipped binary never invokes git (zero runtime process spawn, zero network). A build
// without git (or outside a repo) degrades to "nogit" rather than failing.
fn git_stamp() -> (String, bool) {
    let hash = Command::new("git")
        .args(["rev-parse", "--short", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "nogit".into());
    // Dirty means "the shipped binary can differ from HEAD's code" — docs/ never compiles into
    // the binary, so it is excluded (tracked or untracked); an untracked file anywhere ELSE
    // (a new src module, a config) still counts. Caught 2026-07-14: 89 untracked docs/ui-sweep
    // shots stamped the PART B installer "+dirty" from a code-identical tree.
    //
    // MUST use the `top` pathspec magic: cargo runs this build script with CWD = the crate root
    // (src-tauri/), and a bare `:(exclude)docs` resolves `docs` RELATIVE to that CWD — i.e. it
    // would try to exclude the non-existent `src-tauri/docs` and let every repo-root docs/ file
    // leak back in as "dirty". `:(exclude,top)docs` anchors the path to the repo root regardless
    // of CWD, which is the whole point. (Regressing to the bare form re-introduces the exact
    // 2026-07-17 false-positive that stamped a code-identical arming build "+dirty"; the guard
    // `build_dirty_check_is_root_anchored` in lib.rs pins this.)
    let dirty = Command::new("git")
        .args(["status", "--porcelain", "--", ":(exclude,top)docs"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false);
    (hash, dirty)
}

fn main() {
    let (hash, dirty) = git_stamp();
    println!("cargo:rustc-env=COMPY_GIT_HASH={hash}");
    println!("cargo:rustc-env=COMPY_GIT_DIRTY={}", if dirty { "1" } else { "0" });
    // Re-run this stamp when an input that can make the binary differ from HEAD changes. Once a
    // build script emits ANY rerun-if-changed, cargo watches ONLY the listed paths (it drops its
    // default whole-package scan) — so the OLD watch set (`.git/HEAD` + `.git/index` alone) went
    // STALE on an unstaged working-tree edit: changing a compiled source without `git add` touches
    // NEITHER .git path, so build.rs never re-ran and `COMPY_GIT_DIRTY` kept its previous value.
    // (The old comment here claimed "a rebuild after any code change refreshes it anyway" — that is
    // FALSE: a source edit recompiles the crate but does NOT by itself re-run the build script.)
    //   ../.git/HEAD   — the checked-out commit moving (new commit ⇒ re-stamp hash + dirty)
    //   ../.git/index  — staging (`git add`) ⇒ re-stamp
    //   src / Cargo.toml / Cargo.lock — UNSTAGED edits to this crate's compiled inputs ⇒ re-stamp dirty
    // EXPLICIT vs EFFECTIVE watch set: the five rerun-if-changed lines below are COMPY's explicit set.
    // The tauri-build call at the end of main emits its OWN watchers on top — notably
    // `tauri.conf.json` AND `capabilities/` — so the EFFECTIVE combined set already covers those two;
    // they are NOT residuals (an earlier version of this comment wrongly listed capabilities/ as an
    // uncovered residual). Genuine residual (documented, not silently ignored): an unstaged change
    // OUTSIDE both sets — e.g. a repo-root config file or the frontend ../src bundle — still won't
    // re-trigger this script on its own until it is staged or committed. The backstop is
    // ship-reinstall.ps1 step 0b, which takes a FRESH `git status` at ship time, so no artifact leaves
    // with an unaccounted-for dirty tree. The predicate's behavior (clean → unstaged dirty → clean) is
    // pinned by `build_dirty_predicate_flips_on_unstaged_change` in lib.rs.
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/index");
    println!("cargo:rerun-if-changed=src");
    println!("cargo:rerun-if-changed=Cargo.toml");
    println!("cargo:rerun-if-changed=Cargo.lock");
    // Declaring APP_COMMANDS switches custom commands OUT of Tauri's all-windows default and INTO
    // the capability system, where `capabilities/*.json` decides which window may call what. Uses
    // try_build + expect rather than the infallible `build()` so a malformed manifest fails the
    // build with its own message instead of a panic from inside tauri-build.
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(APP_COMMANDS)),
    )
    .expect("tauri-build failed: check capabilities/*.json against APP_COMMANDS above");
}
