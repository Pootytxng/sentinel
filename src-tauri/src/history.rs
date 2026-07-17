//! Trust Ledger: the persisted record of every change Compy has applied,
//! and the apply / rollback / list commands that read and write it.
//!
//! Rollback is resolved from these persisted records alone — via
//! `actions::resolve_rollback` — never from the live recommendation catalog, so
//! a change stays undoable even after its rule is deprecated or removed. This
//! module owns the change records, their on-disk history, and the recomputed
//! Trust Ledger view. It delegates every Windows mutation and rollback
//! resolution to `actions`, and recomputes "still active" from the crate-root
//! state probes; it owns no mutation primitives, condition logic, or detection.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};

use crate::actions::*;
use crate::compy_data_dir;
use crate::{
    current_power_plan_name, eee_disabled_on_any_eligible_adapter, fast_startup_state,
    game_bar_disabled, game_mode_enabled, hags_state, mouse_accel_disabled,
    nagle_disabled_on_any_nic, pcie_aspm_off_on_ac, reserved_storage_enabled, service_running,
    usb_selective_suspend_off_on_ac, visual_effects_for_best_performance,
};

// Serialized so concurrent apply/rollback calls can't interleave reads and
// writes of history.json.
static HISTORY_LOCK: Mutex<()> = Mutex::new(());

/// The rec_ids `apply_recommendation` can one-click apply (anything else is
/// advisory-only). Single backend source of truth — `export` and `priorities`
/// reuse it. MUST stay in sync with the dispatch match in `apply_recommendation`
/// below (and the frontend's APPLIABLE_REC_IDS).
pub(crate) const APPLIABLE_REC_IDS: &[&str] = &[
    "game-mode",
    "visual-effects",
    "sysmain-disable",
    "nvidia-telemetry",
    "power-ultimate",
    "nagle-disable",
    "hags-enable",
    "mouse-accel-off",
    "game-bar-disable",
    "diagtrack-disable",
    "windows-search-disable",
    "fast-startup-off",
    "reserved-storage-off",
    "usb-selective-suspend-off",
    "pcie-aspm-off",
    "eee-disable",
];

#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct AppliedChange {
    pub(crate) id: String,
    pub(crate) rec_id: String,
    pub(crate) rec_title: String,
    pub(crate) applied_at: String,
    pub(crate) snapshot: serde_json::Value, // legacy entries: untyped; new entries: typed Snapshot serialized
    pub(crate) status: String, // "applied" | "rolled_back"

    // Additive per ARCHITECTURE_LOCKS Tier 1: rollback contract captured at
    // apply time so rollback survives rule deprecation, catalog changes, CDN
    // outages, and app version mismatches. Optional for compat with old
    // history.json entries written before these fields existed.
    #[serde(default)]
    pub(crate) applied_action: Option<AppliedAction>,
    #[serde(default)]
    pub(crate) rollback_action: Option<RollbackAction>,
    #[serde(default)]
    pub(crate) app_version_at_apply: Option<String>,
    #[serde(default)]
    pub(crate) ruleset_version_at_apply: Option<String>,
    #[serde(default)]
    pub(crate) elevation_used: Option<bool>,
    /// Leftovers v2 (R2-5, armed 2026-07-16): "leftover_adopted" marks a restore-to-stock receipt. Additive +
    /// optional — every pre-existing ledger entry deserializes with None.
    #[serde(default)]
    pub(crate) provenance: Option<String>,
    /// A5 rig tagging: the hardware this change was applied ON (same compact identity sessions
    /// carry — hardware::HwFingerprint). Stamped at apply time in build_applied_change, so every
    /// receipt path (single, batch, suspend, debloat, leftovers) records where it happened.
    /// Additive + optional — legacy entries deserialize with None and stay honestly "rig unknown".
    /// Local-only; never leaves the machine.
    #[serde(default)]
    pub(crate) hw_fingerprint: Option<crate::hardware::HwFingerprint>,
    /// Intelligence Phase 2: WHEN the rollback happened, stamped at rollback time (same UTC
    /// RFC3339 clock as applied_at). Additive + optional — entries rolled back before this
    /// field existed stay None forever and must NEVER be retro-dated: the intelligence
    /// timeline emits a dated rollback event only when this stamp genuinely exists.
    #[serde(default)]
    pub(crate) rolled_back_at: Option<String>,
}

// AppliedChange + a freshly-computed `is_still_active` flag. We never persist
// this flag (state changes outside Compy can revert what we applied), so it
// has to be recomputed every time history is read.
#[derive(Serialize)]
pub(crate) struct AppliedChangeView {
    id: String,
    rec_id: String,
    rec_title: String,
    applied_at: String,
    snapshot: serde_json::Value,
    status: String,
    is_still_active: bool,
    applied_action: Option<AppliedAction>,
    rollback_action: Option<RollbackAction>,
    app_version_at_apply: Option<String>,
    ruleset_version_at_apply: Option<String>,
    elevation_used: Option<bool>,
    // Read-only, computed-at-read enrichment (never persisted): a human-readable description of the
    // state a rollback restores, for the Fix surface trust-switch. Derived only from the captured
    // typed snapshot; None → the UI shows the generic "your previous setting".
    restores_label: Option<String>,
    // The "after" half of the before/after pair: the state Compy's change set things TO, derived
    // from the typed AppliedAction. Read-only, computed-at-read, never persisted. None for legacy
    // entries with no captured action → the UI shows just the prior ("before").
    applied_label: Option<String>,
    // A5 measured-payoff linkage — the honest per-tweak payoff meter. Read-only, computed-at-read,
    // never persisted. Names the KIND of gain a tweak targets (e.g. "Input latency", "Background
    // CPU & RAM"), NOT a fabricated FPS/latency number (honest-measurement law). Derived only from
    // the typed AppliedAction; None for legacy entries and for restore-to-stock leftovers (undoing
    // a bad past tweak is not a forward gain) → the UI shows no meter rather than an invented one.
    payoff_label: Option<String>,
    // A5 rig tagging: the stamped apply-time fingerprint, passed through for the UI's
    // "last seen working on <hardware>" tag. None for legacy entries.
    hw_fingerprint: Option<crate::hardware::HwFingerprint>,
    // Read-only, computed-at-read (never persisted): does the stamped rig match TODAY's rig?
    // Compared on the stable identity fields only (gpu · ram_gb · display) — deliberately
    // driver-INsensitive, unlike the session hash: a driver update must not make your own
    // ledger read "different hardware". None = legacy entry with no stamp (honest unknown).
    on_this_rig: Option<bool>,
    // Pass-through of the persisted rollback stamp. None = still applied, or rolled back
    // before the stamp existed — the UI must render that as "date unknown", never a guess.
    rolled_back_at: Option<String>,
}

impl AppliedChangeView {
    /// The change id — what `rollback_change` takes. The benchmark trial runner needs it to undo
    /// the tweak it applied for measurement.
    pub(crate) fn id(&self) -> &str {
        &self.id
    }
}

fn check_change_active(c: &AppliedChange) -> bool {
    match c.rec_id.as_str() {
        "game-mode" => game_mode_enabled(),
        "visual-effects" => visual_effects_for_best_performance(),
        "sysmain-disable" => !service_running("SysMain"),
        "nvidia-telemetry" => !service_running("NvTelemetryContainer"),
        "power-ultimate" => current_power_plan_name()
            .map(|p| p.to_lowercase().contains("ultimate"))
            .unwrap_or(false),
        "nagle-disable" => nagle_disabled_on_any_nic(),
        "hags-enable" => hags_state() == Some(2),
        "mouse-accel-off" => mouse_accel_disabled(),
        "game-bar-disable" => game_bar_disabled(),
        "diagtrack-disable" => !service_running("DiagTrack"),
        "windows-search-disable" => !service_running("WSearch"),
        "fast-startup-off" => fast_startup_state() == Some(0),
        "reserved-storage-off" => !reserved_storage_enabled(),
        "usb-selective-suspend-off" => usb_selective_suspend_off_on_ac(),
        "pcie-aspm-off" => pcie_aspm_off_on_ac(),
        "eee-disable" => eee_disabled_on_any_eligible_adapter(),
        _ => true, // unknown rec → assume still active rather than hide rollback
    }
}

/// Read-only enrichment (computed-at-read, never persisted): the "after" state Compy's change set
/// things TO — the second half of the Trust-Ledger before/after pair (`restores_label` is the
/// "before"). Derived ONLY from the typed `AppliedAction`, so it can't drift from what was actually
/// applied; `None` for a legacy entry with no captured action → the UI shows just the prior. The
/// match is exhaustive on purpose: a new catalog action won't compile until its after-label is set,
/// so the ledger can never silently mislabel a change.
fn applied_label_from_action(action: &Option<AppliedAction>) -> Option<String> {
    use AppliedAction::*;
    let label = match action.as_ref()? {
        EnableGameMode | EnableHardwareGpuScheduling => "On",
        DisableMouseAcceleration | DisableGameBarAndDvr | DisableFastStartup
        | DisableReservedStorage => "Off",
        DisableUsbSelectiveSuspendOnAc | DisablePcieAspmOnAc => "Off (on AC)",
        SetVisualEffectsBestPerformance => "Best performance",
        SetUltimatePerformancePlan => "Ultimate performance",
        SuspendKnownService { .. } => "Stopped",
        DisableKnownService { .. } | DisableNagleOnActiveNics
        | DisableEnergyEfficientEthernet | DisableScheduledTask { .. } => "Disabled",
        // Honest wording: the app is removed for THIS USER, not wiped from the machine.
        RemovePreloadApp { .. } => "Removed for this user",
        // Leftovers v2 restores all return a setting to its Windows stock default.
        RestoreMemoryCompressionDefault | RestoreMmcssDefaults | RestorePrioritySeparationDefault
        | RestoreMpoDefault | RestoreCoreParkingDefault | RestoreTcpAutotuningDefault
        | RestorePagefileAutomatic => "Windows default",
    };
    Some(label.to_string())
}

/// A5 measured-payoff linkage — read-only enrichment (computed-at-read, never persisted): the honest
/// per-tweak payoff meter. Names the KIND of measurable gain a change targets so the ledger can show
/// "what did this buy me?" WITHOUT ever fabricating an FPS or millisecond figure (honest-measurement
/// law: never claim an unmeasured number). Derived ONLY from the typed `AppliedAction` so it can't
/// drift from what was actually applied. `None` for a legacy entry with no captured action, and for
/// every restore-to-stock leftover (undoing a rotted past tweak is not a forward gain to advertise) →
/// the UI shows no meter rather than an invented one. The match is exhaustive on purpose: a new
/// catalog action won't compile until its payoff category is set, so the meter can never silently
/// mislabel or omit a change.
fn payoff_label_from_action(action: &Option<AppliedAction>) -> Option<&'static str> {
    use AppliedAction::*;
    let label = match action.as_ref()? {
        // Input path — these trim the click-to-photon chain (accel curve, GPU scheduling).
        DisableMouseAcceleration | EnableHardwareGpuScheduling => "Input latency",
        // Network path — lower per-packet delay / jitter on the wire.
        DisableNagleOnActiveNics | DisableEnergyEfficientEthernet => "Network responsiveness",
        // Reclaim background CPU/RAM from services + telemetry tasks so games keep more of the rig.
        DisableKnownService { .. } | SuspendKnownService { .. } | DisableScheduledTask { .. } => {
            "Background CPU & RAM"
        }
        // Compositor / overlay / desktop-effect load off the frame path.
        SetVisualEffectsBestPerformance => "UI smoothness",
        EnableGameMode | DisableGameBarAndDvr => "Fewer background interrupts",
        // Power / thermal delivery headroom (clocks not parked/throttled on AC).
        SetUltimatePerformancePlan | DisableUsbSelectiveSuspendOnAc | DisablePcieAspmOnAc => {
            "Power & thermal headroom"
        }
        // Disk headroom reclaimed on the boot volume. A removed preload app is the same honest
        // kind: space (and any background refresh it did) back — never a fabricated FPS figure.
        DisableReservedStorage | RemovePreloadApp { .. } => "Disk headroom",
        // Not a frame/latency gain — a reliability one: a clean cold boot each time.
        DisableFastStartup => "Clean-boot reliability",
        // Restore-to-stock leftovers carry NO forward payoff claim (undoing a bad past tweak is not
        // a measured gain) — the meter stays hidden rather than inventing one.
        RestoreMemoryCompressionDefault | RestoreMmcssDefaults | RestorePrioritySeparationDefault
        | RestoreMpoDefault | RestoreCoreParkingDefault | RestoreTcpAutotuningDefault
        | RestorePagefileAutomatic => return None,
    };
    Some(label)
}

/// A5 rig tagging: does a stamped fingerprint identify TODAY's rig? Stable identity fields only
/// (gpu · ram_gb · display) — deliberately driver-INsensitive, unlike the session hash: a driver
/// update is still your rig, and must not hide your own ledger under a "this rig only" filter.
fn same_rig(stamp: &crate::hardware::HwFingerprint, now: &crate::hardware::HwFingerprint) -> bool {
    stamp.gpu == now.gpu && stamp.ram_gb == now.ram_gb && stamp.display == now.display
}

fn into_view(c: AppliedChange) -> AppliedChangeView {
    let is_still_active = if c.status == "applied" {
        check_change_active(&c)
    } else {
        false
    };
    let restores_label = restores_label_from_snapshot(&c.snapshot);
    let applied_label = applied_label_from_action(&c.applied_action);
    let payoff_label = payoff_label_from_action(&c.applied_action).map(str::to_string);
    // None = legacy unstamped entry → the UI says "rig unknown", never guesses.
    let on_this_rig = c
        .hw_fingerprint
        .as_ref()
        .map(|f| same_rig(f, &crate::hardware::current_fingerprint()));
    AppliedChangeView {
        id: c.id,
        rec_id: c.rec_id,
        rec_title: c.rec_title,
        applied_at: c.applied_at,
        snapshot: c.snapshot,
        status: c.status,
        is_still_active,
        applied_action: c.applied_action,
        rollback_action: c.rollback_action,
        app_version_at_apply: c.app_version_at_apply,
        ruleset_version_at_apply: c.ruleset_version_at_apply,
        elevation_used: c.elevation_used,
        restores_label,
        applied_label,
        payoff_label,
        hw_fingerprint: c.hw_fingerprint,
        on_this_rig,
        rolled_back_at: c.rolled_back_at,
    }
}

fn history_path() -> PathBuf {
    compy_data_dir().join("history.json")
}

// load/save are split into path-parameterized cores so the JSON round-trip and
// the corrupt-file-fails-safe behavior are unit-testable without touching the
// real %APPDATA% history file. The no-arg wrappers preserve prior behavior.
// pub(crate): intelligence.rs reads the persisted structs (read-only) for the timeline —
// the view types drop fields (provenance) the engine needs as evidence.
pub(crate) fn load_history() -> Result<Vec<AppliedChange>, String> {
    load_history_from(&history_path())
}

fn load_history_from(path: &Path) -> Result<Vec<AppliedChange>, String> {
    if !path.exists() {
        return Ok(Vec::new()); // first run — genuinely no history
    }
    let parsed = std::fs::read_to_string(path)
        .map_err(|e| format!("read: {e}"))
        .and_then(|s| serde_json::from_str(&s).map_err(|e| format!("parse: {e}")));
    match parsed {
        Ok(h) => Ok(h),
        Err(e) => {
            // H1 fix (audit 2026-06-11): an unreadable EXISTING ledger must never be silently
            // treated as empty — under the old code the next save would overwrite the
            // recoverable file and permanently erase every rollback contract. Set the damaged
            // file aside byte-for-byte (best effort) and fail LOUD. Every save sits behind a
            // successful load, so the recoverable bytes can never be clobbered either way.
            let corrupt = path.with_extension("json.corrupt");
            let preserved = std::fs::rename(path, &corrupt).is_ok();
            Err(format!(
                "The Trust Ledger could not be read ({e}). {}",
                if preserved {
                    "The damaged file was set aside as history.json.corrupt — nothing was \
                     overwritten, and Compy will not record changes over it."
                } else {
                    "The damaged file was left in place — Compy will not record changes over it."
                }
            ))
        }
    }
}

fn save_history(h: &[AppliedChange]) -> Result<(), String> {
    std::fs::create_dir_all(compy_data_dir()).map_err(|e| e.to_string())?;
    save_history_to(&history_path(), h)
}

fn save_history_to(path: &Path, h: &[AppliedChange]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(h).map_err(|e| e.to_string())?;
    // Crash-safe (H1): write the full new ledger BESIDE the live one, then atomically swap it
    // in (same-volume rename; std maps to MoveFileEx + REPLACE_EXISTING on Windows). A crash
    // mid-write can only ever leave a stale-but-valid history.json plus an ignorable .tmp —
    // never a torn ledger.
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| format!("write: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("swap: {e}"))
}

/// Prove the ledger is WRITABLE before mutating the machine (H1, write side).
///
/// The existing H1 guard loads the ledger before dispatch, so an unreadable/corrupt ledger blocks
/// the change. But a *readable* ledger can still fail to *write* at receipt time (data dir went
/// read-only, volume full, ACL change) — and if the mutation already ran, that orphans it: a real
/// system change we could never record and therefore never roll back, exactly the "never mutate
/// what can't be recorded" invariant inverted. `save_history` is atomic (temp-write + same-volume
/// rename), so re-saving the CURRENT, unchanged ledger is a content-identical no-op that exercises
/// the very write+rename path the post-mutation receipt will use. If it fails we refuse BEFORE any
/// elevation, so nothing is changed. (Not a TOCTOU guarantee — the volume could still fill in the
/// millisecond between canary and receipt — but it converts the common, deterministic un-writable
/// cases from "silent orphaned mutation" into "clean pre-mutation refusal.")
fn ensure_ledger_writable(history: &[AppliedChange]) -> Result<(), String> {
    save_history(history).map_err(|e| {
        format!(
            "refusing to apply: the change ledger isn't writable right now, so this change \
             couldn't be recorded — and an unrecorded change can't be rolled back. Nothing on \
             your system was changed. ({e})"
        )
    })
}

/// The ONE dispatch from rec id to its audited apply_* — `apply_recommendation` and the §4 batch
/// orchestrator both go through here, so there is no second copy of the match to drift.
fn dispatch_apply(rec_id: &str) -> Result<ApplyResult, String> {
    match rec_id {
        "game-mode" => apply_game_mode(),
        "visual-effects" => apply_visual_effects(),
        "sysmain-disable" => apply_service_disable(KnownService::SysMain),
        "nvidia-telemetry" => apply_service_disable(KnownService::NvTelemetryContainer),
        "power-ultimate" => apply_power_ultimate(),
        "nagle-disable" => apply_nagle_disable(),
        "hags-enable" => apply_hags_enable(),
        "mouse-accel-off" => apply_mouse_accel_off(),
        "game-bar-disable" => apply_game_bar_disable(),
        "diagtrack-disable" => apply_service_disable(KnownService::DiagTrack),
        "windows-search-disable" => apply_service_disable(KnownService::WSearch),
        "fast-startup-off" => apply_fast_startup_off(),
        "reserved-storage-off" => apply_reserved_storage_off(),
        "usb-selective-suspend-off" => apply_usb_selective_suspend_off(),
        "pcie-aspm-off" => apply_pcie_aspm_off(),
        "eee-disable" => apply_eee_disable(),
        other => Err(format!("'{}' is not yet supported for one-click apply", other)),
    }
}

/// Display-title cap for ledger receipts. Titles come from our own catalog (all < 100 chars);
/// the cap is defense-in-depth at the webview trust boundary — a compromised UI must not be able
/// to bloat history.json with megabyte "titles" through the apply commands.
const MAX_REC_TITLE_LEN: usize = 200;

/// Build the full-contract ledger receipt for a completed apply. Shared by the single apply and
/// the batch (identical receipt either way — rollback granularity is per item, unchanged).
fn build_applied_change(
    rec_id: &str,
    rec_title: &str,
    result: ApplyResult,
) -> Result<AppliedChange, String> {
    let snapshot_json = serde_json::to_value(&result.snapshot)
        .map_err(|e| format!("snapshot serialize: {}", e))?;
    Ok(AppliedChange {
        id: format!("{}-{}", rec_id, Utc::now().timestamp_millis()),
        rec_id: rec_id.to_string(),
        rec_title: rec_title.chars().take(MAX_REC_TITLE_LEN).collect(),
        applied_at: Utc::now().to_rfc3339(),
        snapshot: snapshot_json,
        status: "applied".into(),
        applied_action: Some(result.applied_action),
        rollback_action: Some(result.rollback_action),
        app_version_at_apply: Some(env!("CARGO_PKG_VERSION").to_string()),
        ruleset_version_at_apply: Some("1.0.0-baseline".to_string()),
        elevation_used: Some(result.elevation_used),
        provenance: None,
        // A5 rig tagging — every receipt path funnels through here, so every new entry
        // records the hardware it was applied on. Local-only.
        hw_fingerprint: Some(crate::hardware::current_fingerprint()),
        rolled_back_at: None,
    })
}

/// Leftovers v2 (R2-5) — ARMED 2026-07-16: restore one leftover to its Windows default.
/// Registered Tauri command since the arming commit (previously double-dark: unregistered AND
/// gate-refused), flipped only after the owner-present live-UAC QA harness passed all three
/// loops (`manual_restore_qa` — W32PS/MPO/memcompress). Mirrors apply_recommendation exactly:
/// lock → load BEFORE mutate (H1) → one resolver → receipt with provenance "leftover_adopted" →
/// atomic save. Undo rides the standard typed rollback path like any other ledger entry.
#[tauri::command]
pub(crate) fn restore_leftover(
    detector_id: &str,
    display_title: &str,
) -> Result<AppliedChangeView, String> {
    // The production gate. Test builds also consult the owner-present QA bypass seam
    // (leftovers::QaRestoreGateBypass — thread-local RAII, mirrors actions::ForceElevationError)
    // so the live UAC QA can drive this path; `#[cfg(test)]` compiles the seam out of every
    // shipped binary, where this is exactly the bare restore_gate() refusal.
    #[cfg(not(test))]
    let gate_open = crate::leftovers::restore_gate();
    #[cfg(test)]
    let gate_open = crate::leftovers::restore_gate() || crate::leftovers::qa_restore_gate_bypassed();
    if !gate_open {
        return Err("Leftovers restore is not enabled in this build.".to_string());
    }
    let _lock = HISTORY_LOCK
        .lock()
        .map_err(|_| "history lock poisoned".to_string())?;
    let mut history = load_history()?;
    ensure_ledger_writable(&history)?;
    let result = match detector_id {
        "memory-compression-off" => crate::actions::restore_memory_compression(),
        "mmcss-tampering" => crate::actions::restore_mmcss_defaults(),
        "win32-priority-separation" => crate::actions::restore_priority_separation(),
        // Wave 2 (2026-06-11; armed 2026-07-16). bcdedit + Defender have NO resolver — permanent
        // by policy (boot-config risk class / security-settings owner territory), not "not yet";
        // tripwire-tested in permanently_excluded_detectors_have_no_resolver_even_armed.
        "pagefile-fixed" => crate::actions::restore_pagefile_automatic(),
        "mpo-disabled" => crate::actions::restore_mpo_default(),
        "core-parking-forced" => crate::actions::restore_core_parking_default(),
        "tcp-autotuning-off" => crate::actions::restore_tcp_autotuning_default(),
        other => Err(format!("no restore resolver exists for '{other}' yet")),
    }?;
    let mut change = build_applied_change(detector_id, display_title, result)?;
    change.provenance = Some("leftover_adopted".to_string());
    history.push(change.clone());
    save_history(&history)?;
    Ok(into_view(change))
}

#[tauri::command]
pub(crate) fn apply_recommendation(rec_id: String, rec_title: String) -> Result<AppliedChangeView, String> {
    let _lock = HISTORY_LOCK
        .lock()
        .map_err(|_| "history lock poisoned".to_string())?;
    // Load BEFORE dispatching (H1): if the ledger can't record a receipt, the change must not
    // happen at all — never mutate what can't be written down. Same audited dispatch + receipt
    // as before; only the refusal moved ahead of the mutation.
    let mut history = load_history()?;
    // ...and prove the ledger is WRITABLE too (H1 write side): a readable-but-unwritable ledger
    // would let the mutation succeed and then orphan its receipt. Refuse before elevation.
    ensure_ledger_writable(&history)?;
    let result = dispatch_apply(&rec_id)?;
    let change = build_applied_change(&rec_id, &rec_title, result)?;
    history.push(change.clone());
    save_history(&history)?;
    Ok(into_view(change))
}

/// Session-scoped service SUSPEND (Services module, BUILT DARK). Gated by `service_suspend_gate()` —
/// refuses until the feature's own UAC QA + owner sign-off (it's a NEW mutating capability the owner
/// greenlit on 2026-06-22, LOCKED-rule-6, but the ARMING still rides QA). Reuses the audited
/// apply/record machinery: the typed snapshot lands in the ledger, so RESUME goes through the normal
/// `rollback_change` → `dispatch_rollback` path (the new `ResumeServiceFromSnapshot` arm). The
/// `KnownService` allowlist + `from_name` mean only the four safe services are ever suspendable.
#[tauri::command]
pub(crate) fn suspend_known_service(service_name: String) -> Result<AppliedChangeView, String> {
    if !crate::actions::service_suspend_gate() {
        return Err("Session service-suspend isn't enabled in this build.".to_string());
    }
    let service = crate::actions::KnownService::from_name(&service_name)
        .ok_or_else(|| format!("'{}' isn't a Compy-suspendable service.", service_name))?;
    let _lock = HISTORY_LOCK.lock().map_err(|_| "history lock poisoned".to_string())?;
    let mut history = load_history()?;
    ensure_ledger_writable(&history)?;
    let result = crate::actions::apply_service_suspend(service)?;
    let change = build_applied_change(
        &format!("service-suspend:{}", service_name),
        &format!("Suspend {} for this session", service_name),
        result,
    )?;
    history.push(change.clone());
    save_history(&history)?;
    Ok(into_view(change))
}

/// OS-debloat: disable a curated telemetry scheduled task (BUILT DARK). Gated by `bloat_removal_gate()`
/// — refuses until the feature's own UAC QA + owner sign-off (the gated mutation the owner greenlit
/// 2026-06-22, LOCKED-rule-6). Reuses the audited apply/record path: the typed snapshot lands in the
/// ledger, so RE-ENABLE flows through the normal `rollback_change` → `dispatch_rollback` path (the new
/// `EnableScheduledTask` arm). `KnownBloatTask::from_id` enforces the allowlist (off-list → refused).
#[tauri::command]
pub(crate) fn disable_known_bloat_task(task_id: String) -> Result<AppliedChangeView, String> {
    if !crate::actions::bloat_removal_gate() {
        return Err("Bloat-task removal isn't enabled in this build.".to_string());
    }
    let task = crate::actions::KnownBloatTask::from_id(&task_id)
        .ok_or_else(|| format!("'{}' isn't a Compy-removable telemetry task.", task_id))?;
    let _lock = HISTORY_LOCK.lock().map_err(|_| "history lock poisoned".to_string())?;
    let mut history = load_history()?;
    ensure_ledger_writable(&history)?;
    let result = crate::actions::apply_disable_scheduled_task(task)?;
    let change = build_applied_change(
        &format!("bloat-task:{}", task_id),
        &format!("Disable telemetry task ({})", task_id),
        result,
    )?;
    history.push(change.clone());
    save_history(&history)?;
    Ok(into_view(change))
}

/// Phase-B preload-app removal (BUILT DARK 2026-07-06). Gated by `preload_removal_gate()` — refuses
/// until the feature's own live QA (remove→reinstall round trip, Store links verified) + the owner's
/// curated-list + arming sign-off (the owner's 2026-07-06 nod covered BUILDING it, LOCKED-rule-6).
/// Reuses the audited apply/record path: the typed snapshot lands in the ledger, so the restore flows
/// through the normal `rollback_change` → `dispatch_rollback` path (the `ReinstallPreloadApp` arm).
/// `KnownPreloadApp::from_id` enforces the allowlist (off-list → refused before anything runs).
#[tauri::command]
pub(crate) fn remove_known_preload_app(app_id: String) -> Result<AppliedChangeView, String> {
    if !crate::actions::preload_removal_gate() {
        return Err("Preinstalled-app removal isn't enabled in this build.".to_string());
    }
    let app = crate::actions::KnownPreloadApp::from_id(&app_id)
        .ok_or_else(|| format!("'{}' isn't a Compy-removable preinstalled app.", app_id))?;
    let _lock = HISTORY_LOCK.lock().map_err(|_| "history lock poisoned".to_string())?;
    let mut history = load_history()?;
    ensure_ledger_writable(&history)?;
    let result = crate::actions::apply_remove_preload_app(app)?;
    let change = build_applied_change(
        &format!("preload-app:{}", app_id),
        &format!("Remove preinstalled app ({})", app_id),
        result,
    )?;
    history.push(change.clone());
    save_history(&history)?;
    Ok(into_view(change))
}

// ─── §4 one-elevation batch apply (spec 2026-06-06-beta-feedback-3 §4) ──────────────────
// Orchestration ONLY — reuses the audited dispatch_apply / run_elevated_powershell / receipt
// primitives; it introduces no new mutation primitive. One UAC prompt for the whole batch; one
// ledger receipt PER item (rollback granularity unchanged); per-item failure isolation.

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BatchApplyItem {
    pub rec_id: String,
    pub rec_title: String,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct BatchItemOutcome {
    rec_id: String,
    rec_title: String,
    status: String, // "applied" | "skipped"
    reason: Option<String>,
}

#[derive(Serialize, Debug)]
pub(crate) struct BatchApplyReport {
    items: Vec<BatchItemOutcome>,
    applied: usize,
    skipped: usize,
    /// 0 or 1 — the whole point of the batch. Surfaced so the UI/QA can assert it honestly.
    elevation_prompts: usize,
}

fn outcome_applied(rec_id: &str, rec_title: &str) -> BatchItemOutcome {
    BatchItemOutcome {
        rec_id: rec_id.to_string(),
        rec_title: rec_title.to_string(),
        status: "applied".into(),
        reason: None,
    }
}

fn outcome_skipped(rec_id: &str, rec_title: &str, reason: String) -> BatchItemOutcome {
    BatchItemOutcome {
        rec_id: rec_id.to_string(),
        rec_title: rec_title.to_string(),
        status: "skipped".into(),
        reason: Some(reason),
    }
}

/// Pure receipt → outcome mapping (fail-safe direction: ONLY an explicit `ok` receipt earns a
/// ledger entry; `fail` and MISSING are both not-applied). Split out so the failure-isolation
/// contract is unit-testable without elevation.
fn resolve_receipt(receipts: &std::collections::HashMap<String, bool>, rec_id: &str) -> Result<(), String> {
    match receipts.get(rec_id) {
        Some(true) => Ok(()),
        Some(false) => Err(
            "The elevated step failed for this item — it was skipped and nothing was changed for it."
                .to_string(),
        ),
        None => Err(
            "No completion receipt was written for this item — treating it as not applied (nothing is recorded that didn't verifiably happen)."
                .to_string(),
        ),
    }
}

#[tauri::command]
pub(crate) fn apply_recommendations_batch(items: Vec<BatchApplyItem>) -> Result<BatchApplyReport, String> {
    // ── Validation — BEFORE the lock and before any mutation. The whole batch is refused (not
    // partially run) on a malformed request: it indicates a caller bug, not a per-item condition.
    if items.is_empty() {
        return Err("nothing to apply".to_string());
    }
    let mut seen = std::collections::HashSet::new();
    for it in &items {
        if !APPLIABLE_REC_IDS.contains(&it.rec_id.as_str()) {
            return Err(format!("'{}' is not appliable", it.rec_id));
        }
        // The one exit-using elevated command would abort sibling items mid-script — and it's
        // moderate-tier, outside the safe batch by design. Hard boundary, not a skip.
        if it.rec_id == "power-ultimate" {
            return Err("'power-ultimate' cannot ride a batch — apply it individually".to_string());
        }
        if !seen.insert(it.rec_id.clone()) {
            return Err(format!("duplicate rec '{}' in batch", it.rec_id));
        }
    }

    let _lock = HISTORY_LOCK
        .lock()
        .map_err(|_| "history lock poisoned".to_string())?;
    // H1: refuse the whole batch before phase 1 if the ledger can't record receipts — readable
    // (load) AND writable (canary), so a readable-but-unwritable ledger can't let phase-1 mutations
    // (HKCU, immediate) succeed and then orphan their receipts.
    let mut history = load_history()?;
    ensure_ledger_writable(&history)?;
    let mut outcomes: Vec<BatchItemOutcome> = Vec::new();
    let mut applied = 0usize;

    struct Deferred {
        rec_id: String,
        rec_title: String,
        result: ApplyResult,
        cmds: std::ops::Range<usize>,
    }
    let mut staged: Vec<Deferred> = Vec::new();

    // ── Phase 1 — every apply runs with the deferral sink armed. Non-elevated recs mutate
    // (HKCU) and receipt immediately, exactly like a single apply. Elevated recs perform their
    // READS and park their one PS command (no partial mutation — see the sink's safety note).
    let all_cmds: Vec<String> = {
        let guard = ElevationDeferral::begin()?;
        let mut cursor = 0usize;
        for it in &items {
            match dispatch_apply(&it.rec_id) {
                Err(e) => outcomes.push(outcome_skipped(&it.rec_id, &it.rec_title, e)),
                Ok(result) => {
                    let now = guard.deferred_count();
                    if now == cursor {
                        // No elevated step → the mutation already happened → honest receipt now.
                        let change = build_applied_change(&it.rec_id, &it.rec_title, result)?;
                        history.push(change);
                        applied += 1;
                        outcomes.push(outcome_applied(&it.rec_id, &it.rec_title));
                    } else {
                        staged.push(Deferred {
                            rec_id: it.rec_id.clone(),
                            rec_title: it.rec_title.clone(),
                            result,
                            cmds: cursor..now,
                        });
                        cursor = now;
                    }
                }
            }
        }
        guard.take_deferred()
    };
    // Persist phase-1 receipts before the elevation step — a cancelled UAC must never cost the
    // non-elevated items their ledger entries.
    if applied > 0 {
        save_history(&history)?;
    }

    // ── Phase 2 — ONE elevation for every deferred command, receipts to a result FILE (data,
    // not code: reading it never executes anything), then a ledger receipt per confirmed item.
    let mut elevation_prompts = 0usize;
    if !staged.is_empty() {
        let receipts_path = compy_data_dir().join(format!(
            "elevation-batch-{}.receipts",
            Utc::now().timestamp_millis()
        ));
        std::fs::create_dir_all(compy_data_dir()).map_err(|e| e.to_string())?;
        let _ = std::fs::remove_file(&receipts_path);
        // Checked (never indexed) command attribution: by construction every staged range lies
        // inside all_cmds, but a panic HERE would poison HISTORY_LOCK for the whole session — so
        // an impossible mismatch aborts the batch BEFORE elevation instead.
        let mut script_items: Vec<(String, Vec<String>)> = Vec::with_capacity(staged.len());
        for d in &staged {
            let cmds = all_cmds.get(d.cmds.clone()).ok_or_else(|| {
                "internal error: deferred-command attribution mismatch — the elevated batch was aborted before anything ran".to_string()
            })?;
            script_items.push((d.rec_id.clone(), cmds.to_vec()));
        }
        let script = compose_batch_script(&script_items, &receipts_path.to_string_lossy())?;
        elevation_prompts = 1;
        match run_elevated_powershell(&script) {
            Err(e) => {
                // UAC declined or the elevated process failed to run: NOTHING elevated was
                // applied. Honest per-item skip; the phase-1 items stand on their own receipts.
                for d in staged {
                    outcomes.push(outcome_skipped(
                        &d.rec_id,
                        &d.rec_title,
                        format!("Elevation did not complete — nothing was changed for this item. ({e})"),
                    ));
                }
            }
            Ok(()) => {
                let text = std::fs::read_to_string(&receipts_path).unwrap_or_default();
                let receipts = parse_batch_receipts(&text);
                for d in staged {
                    match resolve_receipt(&receipts, &d.rec_id) {
                        Ok(()) => {
                            let change = build_applied_change(&d.rec_id, &d.rec_title, d.result)?;
                            history.push(change);
                            applied += 1;
                            outcomes.push(outcome_applied(&d.rec_id, &d.rec_title));
                        }
                        Err(reason) => {
                            outcomes.push(outcome_skipped(&d.rec_id, &d.rec_title, reason))
                        }
                    }
                }
                save_history(&history)?;
            }
        }
        let _ = std::fs::remove_file(&receipts_path);
    }

    let skipped = outcomes.iter().filter(|o| o.status == "skipped").count();
    Ok(BatchApplyReport {
        items: outcomes,
        applied,
        skipped,
        elevation_prompts,
    })
}

#[tauri::command]
pub(crate) fn rollback_change(change_id: String) -> Result<(), String> {
    let _lock = HISTORY_LOCK
        .lock()
        .map_err(|_| "history lock poisoned".to_string())?;
    // H1: a corrupt ledger refuses the rollback loudly (the file is preserved for recovery)
    // rather than reporting "change not found" against a silently-empty list.
    let mut history = load_history()?;
    let idx = history
        .iter()
        .position(|c| c.id == change_id)
        .ok_or_else(|| format!("change '{}' not found in history", change_id))?;
    let change = history[idx].clone();
    if change.status == "rolled_back" {
        // NOTE: experiment::restore_already_reverted matches this exact literal to tell an
        // already-off change from a genuine restore failure — keep the two in sync (guard-tested).
        return Err("change has already been rolled back".into());
    }

    let (action, snapshot) = resolve_rollback(&change)?;

    dispatch_rollback(&action, &snapshot)?;

    history[idx].status = "rolled_back".into();
    // Honest rollback dating (Intelligence Phase 2): stamped at the moment the rollback
    // actually dispatched. Only entries rolled back from this stamp onward carry a date.
    history[idx].rolled_back_at = Some(Utc::now().to_rfc3339());
    save_history(&history)?;
    Ok(())
}

#[tauri::command]
pub(crate) fn get_applied_changes() -> Vec<AppliedChangeView> {
    // Read-only VIEW. The signature stays infallible (export + the benchmark trial runner
    // consume it), so a corrupt ledger degrades to an empty view here — but never to data
    // loss: load_history has already set the damaged file aside untouched, and every
    // MUTATING command (apply / batch / rollback) refuses loudly instead of saving over it.
    // Surfacing ledger health in the Fix surface is a recorded follow-up.
    load_history().unwrap_or_default().into_iter().map(into_view).collect()
}

/// Whether the LATEST Trust-Ledger entry for `rec_id` is an active apply (status "applied", not
/// rolled back). Keeps the Game Mode keeper rollback-bound: it only re-asserts a state the user
/// actually applied via Compy (so the snapshot/undo exists in local history), never one the
/// (untrusted) webview merely asked for. A corrupt/empty/absent ledger reads false — fail-safe:
/// no re-assert without a resolvable rollback.
pub(crate) fn rec_is_active(rec_id: &str) -> bool {
    load_history()
        .unwrap_or_default()
        .iter()
        .rev()
        .find(|c| c.rec_id == rec_id)
        .map(|c| c.status == "applied")
        .unwrap_or(false)
}

/// Total Trust-Ledger entry count (append-only, so monotonic). Used as a confound watermark by the
/// cross-session comparison engine: if the ledger advanced between arming and the next session,
/// another change landed and the delta can't be honestly attributed.
pub(crate) fn ledger_len() -> usize {
    // On an unreadable ledger this reads 0 — which DIFFERS from any non-zero armed watermark,
    // so the comparison engine refuses attribution (the fail-safe direction for honesty).
    load_history().unwrap_or_default().len()
}

/// Count of DISTINCT recs whose LATEST ledger entry is an active apply (status "applied"). Powers the
/// experiment engine's single-variable warning (Intelligence Phase 3 §4F): "N other Compy changes are
/// already active". Latest-wins per rec_id (a later rollback clears an earlier apply). Read-only,
/// additive — no enum/contract change. Corrupt/absent ledger reads 0 (fail-safe: no false warning).
pub(crate) fn active_change_count() -> usize {
    use std::collections::BTreeMap;
    let history = load_history().unwrap_or_default();
    // Walk in order so the LAST entry per rec_id wins (the ledger is append-only chronological).
    let mut latest: BTreeMap<&str, &str> = BTreeMap::new();
    for c in &history {
        latest.insert(c.rec_id.as_str(), c.status.as_str());
    }
    latest.values().filter(|status| **status == "applied").count()
}

/// Read-only roll-up of the Trust Ledger for surfaces that need counts rather
/// than the full view (e.g. Game Readiness). `active` = applied AND still active;
/// `externally_reverted` = applied but the live system no longer matches (changed
/// outside Compy). Computed from local history alone, like everything else here.
#[derive(serde::Serialize, Clone, Debug, Default)]
pub(crate) struct AppliedChangesSummary {
    pub(crate) total: usize,
    pub(crate) active: usize,
    pub(crate) rolled_back: usize,
    pub(crate) externally_reverted: usize,
    /// The drifted settings BY NAME (rec titles, sorted for stable output) so surfaces can say
    /// WHICH setting drifted instead of a vague "N setting(s)" (flags-name-it law).
    pub(crate) drifted_titles: Vec<String>,
}

pub(crate) fn applied_changes_summary() -> AppliedChangesSummary {
    // Read-only roll-up: an unreadable ledger summarizes as zeros (the preserved .corrupt
    // file is untouchable by saves; mutating commands surface the error loudly).
    summarize_history(&load_history().unwrap_or_default())
}

/// Read-only: every ledger entry's id, in on-disk (apply) order. Used by the aggregate-stack A/B
/// trial (§2a) to diff which changes a batch apply created — after − before — so its rollback guard
/// undoes EXACTLY those entries and nothing pre-existing. Introduces no mutation; the rollback
/// itself still goes through the audited `rollback_change` boundary.
///
/// Returns the load ERROR rather than swallowing it (rust-tauri-reviewer, §2a): an unreadable ledger
/// must NOT read as "empty" here — `load_history` quarantines a corrupt `history.json` (rename →
/// `.corrupt`) as a read side effect, and a caller that took `[]` and then applied would orphan the
/// user's real prior ledger and mutate against a blank one. The trial propagates this Err and refuses
/// to apply (see `start_stack_trial`), so a corrupt ledger can never chain into an un-tracked mutation.
pub(crate) fn all_change_ids() -> Result<Vec<String>, String> {
    Ok(load_history()?.into_iter().map(|c| c.id).collect())
}

// Collapse history to the LATEST entry per rec_id, then summarize current state.
// Readiness reflects each setting's CURRENT effective state — not every historical
// apply/rollback — so re-applying OR rolling back a setting actually resolves it.
//
// Previously this counted every entry: applying one setting several times, or an
// old "applied" entry later superseded by a rollback of the same setting, lingered
// forever as an unclearable "externally reverted" count. That trapped the user
// below a clean readiness state with no way out (the append-only ledger never lets
// you edit those old records). The full per-entry history still lives in the Trust
// Ledger for audit; readiness just stops being held hostage by it.
fn summarize_history(history: &[AppliedChange]) -> AppliedChangesSummary {
    let mut latest: std::collections::HashMap<&str, usize> = std::collections::HashMap::new();
    for (i, c) in history.iter().enumerate() {
        latest.insert(c.rec_id.as_str(), i); // later entries overwrite earlier → newest wins
    }
    let mut s = AppliedChangesSummary::default();
    for &i in latest.values() {
        let c = &history[i];
        s.total += 1;
        if c.status == "rolled_back" {
            s.rolled_back += 1;
        } else if check_change_active(c) {
            s.active += 1;
        } else {
            s.externally_reverted += 1;
            s.drifted_titles.push(c.rec_title.clone());
        }
    }
    s.drifted_titles.sort(); // HashMap order is random — keep the named list stable
    s
}

// ─── Trust Ledger tests ──────────────────────────────────────────────────
//
// History-owned behavior: the recomputed ledger view and the on-disk round
// trip. The typed apply/rollback contract itself is pinned by `safety_tests`
// in lib.rs; here we prove the records persist honestly and fail safe.
#[cfg(test)]
mod batch_apply_tests {
    use super::*;

    fn item(rec_id: &str) -> BatchApplyItem {
        BatchApplyItem {
            rec_id: rec_id.into(),
            rec_title: format!("title for {rec_id}"),
        }
    }

    // Validation refuses the WHOLE batch before any lock/mutation — these run the real command
    // function safely because every rejection path returns before phase 1.
    #[test]
    fn batch_refuses_empty_unknown_duplicate_and_power_ultimate() {
        assert!(apply_recommendations_batch(vec![]).is_err(), "empty");
        assert!(
            apply_recommendations_batch(vec![item("not-a-real-rec")]).is_err(),
            "unknown id must refuse the batch"
        );
        assert!(
            apply_recommendations_batch(vec![item("fast-startup-off"), item("fast-startup-off")])
                .is_err(),
            "duplicate ids must refuse the batch"
        );
        let err = apply_recommendations_batch(vec![item("hags-enable"), item("power-ultimate")])
            .expect_err("power-ultimate is the exit-using elevated command — never batchable");
        assert!(err.contains("power-ultimate"));
    }

    // Pins the webview-side arg shape: the frontend sends camelCase items; a drift here would
    // fail silently at runtime (Tauri arg deserialization), so the contract is a test.
    #[test]
    fn batch_item_deserializes_from_the_frontend_camel_case_shape() {
        let it: BatchApplyItem =
            serde_json::from_str(r#"{"recId":"fast-startup-off","recTitle":"Disable Fast Startup"}"#)
                .expect("camelCase arg shape");
        assert_eq!(it.rec_id, "fast-startup-off");
        assert_eq!(it.rec_title, "Disable Fast Startup");
    }

    // The fail-safe receipt contract: ONLY an explicit ok earns a ledger entry; an explicit fail
    // and a MISSING receipt are both not-applied. (The PS-level isolation proof lives in
    // actions::batch_elevation_tests::real_powershell_batch_isolates_a_failing_item.)
    #[test]
    fn receipt_resolution_is_fail_safe() {
        let mut receipts = std::collections::HashMap::new();
        receipts.insert("alpha".to_string(), true);
        receipts.insert("bravo".to_string(), false);
        assert!(resolve_receipt(&receipts, "alpha").is_ok());
        let failed = resolve_receipt(&receipts, "bravo").expect_err("explicit fail");
        assert!(failed.contains("skipped"));
        let missing = resolve_receipt(&receipts, "charlie").expect_err("missing receipt");
        assert!(missing.contains("not applied"));
    }

    // The UAC-cancel / elevation-failure arm, proven deterministically (no real prompt): with
    // elevation forced to fail, EVERY deferred (elevated) item is skipped with the honest "did not
    // complete" reason and NOTHING is ledgered for them. Uses two elevated recs so phase 1 mutates
    // nothing (they only read + defer), keeping this test side-effect-free on the real system.
    #[test]
    fn elevation_failure_skips_every_deferred_item_honestly() {
        let _force = ForceElevationError::begin();
        let before = load_history().expect("real ledger readable");
        let before_ids: std::collections::HashSet<String> =
            before.iter().map(|c| c.id.clone()).collect();
        let report = apply_recommendations_batch(vec![
            item("fast-startup-off"),
            item("hags-enable"),
        ])
        .expect("a failed elevation is per-item skips, never a batch-level error");
        assert_eq!(report.elevation_prompts, 1, "one elevation was attempted");
        assert_eq!(report.applied, 0, "nothing applied when elevation fails");
        assert_eq!(report.skipped, 2, "both deferred items skipped");
        for o in &report.items {
            assert_eq!(o.status, "skipped");
            assert!(
                o.reason.as_deref().unwrap_or("").contains("Elevation did not complete"),
                "honest cancel reason"
            );
        }
        // Fail-safe: no NEW ledger entry for either elevated item.
        let after = load_history().expect("real ledger readable");
        let new_count = after.iter().filter(|c| !before_ids.contains(&c.id)).count();
        assert_eq!(new_count, 0, "a cancelled elevation must ledger nothing");
    }

    // The shared receipt builder writes the FULL rollback contract — batch receipts are
    // byte-equivalent in shape to single-apply receipts (rollback granularity unchanged).
    #[test]
    fn batch_receipts_carry_the_full_rollback_contract() {
        let result = ApplyResult {
            applied_action: AppliedAction::DisableFastStartup,
            rollback_action: RollbackAction::RestoreFastStartupFromSnapshot,
            snapshot: Snapshot::FastStartup {
                prior_hiberboot: Some(1),
            },
            elevation_used: true,
        };
        let c = build_applied_change("fast-startup-off", "Disable Fast Startup", result)
            .expect("build");
        assert_eq!(c.rec_id, "fast-startup-off");
        assert_eq!(c.status, "applied");
        assert!(c.applied_action.is_some());
        assert!(c.rollback_action.is_some());
        assert_eq!(c.elevation_used, Some(true));
        assert_eq!(
            c.snapshot.get("kind").and_then(|k| k.as_str()),
            Some("fast-startup"),
            "typed snapshot serialized with its tag"
        );
    }

    // Defense-in-depth at the webview boundary: a receipt title is capped so a compromised UI
    // can't bloat history.json through the apply commands. Real catalog titles are untouched.
    #[test]
    fn receipt_titles_are_capped_but_real_titles_untouched() {
        let result = || ApplyResult {
            applied_action: AppliedAction::DisableFastStartup,
            rollback_action: RollbackAction::RestoreFastStartupFromSnapshot,
            snapshot: Snapshot::FastStartup { prior_hiberboot: Some(1) },
            elevation_used: true,
        };
        let real = "Disable Fast Startup";
        let c = build_applied_change("fast-startup-off", real, result()).expect("build");
        assert_eq!(c.rec_title, real, "a real catalog title passes through unchanged");
        let huge = "x".repeat(1_000_000);
        let c = build_applied_change("fast-startup-off", &huge, result()).expect("build");
        assert_eq!(c.rec_title.chars().count(), MAX_REC_TITLE_LEN, "a hostile title is capped");
    }
}

// §4 ELEVATION QA harness (owner-present, REAL UAC — never runs in the normal suite).
// Run explicitly, one test at a time, with a human at the Secure Desktop:
//   cargo test --manifest-path src-tauri/Cargo.toml manual_qa_batch -- --ignored --nocapture --test-threads=1
//   cargo test --manifest-path src-tauri/Cargo.toml manual_qa_uac_cancel -- --ignored --nocapture --test-threads=1
// These intentionally drive the PRODUCTION batch path end to end: real elevation, real registry
// writes (idempotent values), real %APPDATA%\Compy\history.json receipts. The dev build's Trust
// Ledger shows the entries live. Items chosen are safe-tier + guaranteed-idempotent writes.
#[cfg(test)]
mod manual_elevation_qa {
    use super::*;

    fn qa_item(rec_id: &str, rec_title: &str) -> BatchApplyItem {
        BatchApplyItem {
            rec_id: rec_id.into(),
            rec_title: rec_title.into(),
        }
    }

    /// Step 1 + 2 of the QA loop. TWO UAC prompts, click YES on both:
    /// prompt #1 = the whole batch (the one-elevation claim), prompt #2 = the single rollback.
    #[test]
    #[ignore = "manual §4 elevation QA — real UAC; click YES twice"]
    fn manual_qa_batch_one_prompt_receipts_and_per_item_rollback() {
        let before = load_history().expect("ledger readable").len();
        let report = apply_recommendations_batch(vec![
            qa_item("fast-startup-off", "QA · Disable Fast Startup"),
            qa_item("hags-enable", "QA · Enable HAGS"),
        ])
        .expect("the batch must run (did the first UAC prompt get a YES?)");
        println!("BATCH REPORT: {report:?}");
        assert_eq!(report.elevation_prompts, 1, "ONE UAC prompt for the whole batch");
        assert_eq!(report.applied, 2, "both elevated items applied");
        assert_eq!(report.skipped, 0, "nothing skipped");

        // One full-contract receipt PER item.
        let after = load_history().expect("ledger readable");
        assert_eq!(after.len(), before + 2, "exactly one ledger receipt per item");
        for rec in ["fast-startup-off", "hags-enable"] {
            let c = after
                .iter()
                .rev()
                .find(|c| c.rec_id == rec && c.rec_title.starts_with("QA · "))
                .expect("QA receipt present");
            assert_eq!(c.status, "applied");
            assert!(c.applied_action.is_some() && c.rollback_action.is_some());
            assert_eq!(c.elevation_used, Some(true));
        }

        // Per-item rollback granularity: roll back ONE (HAGS) — second UAC prompt, click YES.
        let hags_id = after
            .iter()
            .rev()
            .find(|c| c.rec_id == "hags-enable" && c.status == "applied")
            .expect("hags QA entry")
            .id
            .clone();
        rollback_change(hags_id.clone())
            .expect("rollback must run (did the second UAC prompt get a YES?)");
        let post = load_history().expect("ledger readable");
        let hags = post.iter().find(|c| c.id == hags_id).expect("hags entry");
        assert_eq!(hags.status, "rolled_back", "the rolled-back item flips");
        let fast = post
            .iter()
            .rev()
            .find(|c| c.rec_id == "fast-startup-off" && c.rec_title.starts_with("QA · "))
            .expect("fast-startup QA entry");
        assert_eq!(fast.status, "applied", "the sibling STAYS applied");
        assert_eq!(crate::hags_state(), Some(2), "exact prior state restored");
        assert_eq!(crate::fast_startup_state(), Some(0), "sibling state intact");
        println!("STEP 1+2 PASS: one prompt, per-item receipts, per-item rollback.");
    }

    /// Step 3 of the QA loop. ONE UAC prompt — click NO (cancel).
    #[test]
    #[ignore = "manual §4 elevation QA — real UAC; click NO (cancel)"]
    fn manual_qa_uac_cancel_is_honest_per_item() {
        let before = load_history().expect("ledger readable").len();
        let report = apply_recommendations_batch(vec![
            qa_item("game-bar-disable", "QA · Game Bar off"), // non-elevated (HKCU)
            qa_item("fast-startup-off", "QA · Fast Startup"), // elevated — CANCEL its prompt
        ])
        .expect("a cancelled elevation is a per-item skip, never a batch error");
        println!("CANCEL REPORT: {report:?}");
        assert_eq!(report.elevation_prompts, 1);
        assert_eq!(report.applied, 1, "the non-elevated item still applied");
        assert_eq!(report.skipped, 1, "the elevated item skipped");
        let skipped = report
            .items
            .iter()
            .find(|i| i.status == "skipped")
            .expect("one skipped item");
        assert_eq!(skipped.rec_id, "fast-startup-off");
        let reason = skipped.reason.as_deref().unwrap_or("");
        assert!(
            reason.contains("Elevation did not complete"),
            "honest reason, got: {reason}"
        );
        let after = load_history().expect("ledger readable");
        assert_eq!(after.len(), before + 1, "ONLY the non-elevated receipt landed");
        assert_eq!(
            crate::fast_startup_state(),
            Some(0),
            "cancelled item: nothing was changed (state from the earlier applies stands)"
        );
        println!("STEP 3 PASS: cancel = honest per-item skip; non-elevated item ledgered.");
    }
}

// Leftovers v2 RESTORE QA harness (owner-present, REAL UAC — never runs in the normal suite).
// Mirrors manual_elevation_qa. Run one test at a time with a human at the Secure Desktop:
//   cargo test --manifest-path src-tauri/Cargo.toml manual_restore_qa_w32ps -- --ignored --nocapture --test-threads=1
//   cargo test --manifest-path src-tauri/Cargo.toml manual_restore_qa_mpo -- --ignored --nocapture --test-threads=1
//   cargo test --manifest-path src-tauri/Cargo.toml manual_restore_qa_memcompress -- --ignored --nocapture --test-threads=1
// These drive the restore path through the #[cfg(test)] QA gate-bypass seam
// (leftovers::QaRestoreGateBypass) so the harness works regardless of production gate state;
// none of this exists in a shipped binary. ALL THREE LOOPS PASSED owner-present 2026-07-16
// (the arming precondition — restore_gate() flipped true that day). Fixture writes are the
// documented benign QA set ONLY (W32PS 0x26 ↔ stock 2; OverlayTestMode 5 ↔ delete; memcompress
// Disable↔Enable-MMAgent — owner-sanctioned + passed 2026-07-16), each loop asserts the rig
// STARTS clean before writing anything, and each loop ends back at Windows stock. Receipts are
// real %APPDATA%\Compy\history.json entries, "QA · "-tagged (cleanup offered after the QA pass).
#[cfg(test)]
mod manual_restore_qa {
    use super::*;
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;

    const W32PS_SEED: &str = "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'Win32PrioritySeparation' -Value 38 -Type DWord";
    const W32PS_CLEANUP: &str = "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl' -Name 'Win32PrioritySeparation' -Value 2 -Type DWord";
    const MPO_SEED: &str = "Set-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' -Name 'OverlayTestMode' -Value 5 -Type DWord";
    const MPO_CLEANUP: &str = "Remove-ItemProperty -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm' -Name 'OverlayTestMode' -ErrorAction SilentlyContinue";

    fn read_w32ps() -> Option<u32> {
        RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey(r"SYSTEM\CurrentControlSet\Control\PriorityControl")
            .ok()?
            .get_value("Win32PrioritySeparation")
            .ok()
    }

    fn read_overlay_test_mode() -> Option<u32> {
        RegKey::predef(HKEY_LOCAL_MACHINE)
            .open_subkey(r"SOFTWARE\Microsoft\Windows\Dwm")
            .ok()?
            .get_value("OverlayTestMode")
            .ok()
    }

    /// Live detection through the real probe + evaluator path, read via the SERIALIZED report
    /// shape (the report's fields are module-private by design).
    fn flagged_ids() -> Vec<String> {
        serde_json::to_value(crate::leftovers::get_leftovers())
            .expect("report serializes")
            .get("findings")
            .and_then(|f| f.as_array())
            .map(|fs| {
                fs.iter()
                    .filter_map(|f| f.get("id").and_then(|i| i.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Receipt assertions shared by both loops: provenance, full typed contract, exact snapshot.
    fn assert_receipt(c: &AppliedChange, kind: &str) {
        assert_eq!(c.status, "applied");
        assert_eq!(c.provenance.as_deref(), Some("leftover_adopted"), "provenance");
        assert_eq!(c.elevation_used, Some(true));
        assert!(c.applied_action.is_some() && c.rollback_action.is_some(), "full contract");
        assert_eq!(c.snapshot.get("kind").and_then(|k| k.as_str()), Some(kind), "typed snapshot");
    }

    /// W32PS QA loop — FOUR UAC prompts, click YES on all four (each announced before it fires):
    /// seed 0x26 → detector flags it → restore (receipt snapshot prior=38) → rollback puts 0x26
    /// back EXACTLY → cleanup to Windows stock 2.
    #[test]
    #[ignore = "manual leftovers-restore QA — real UAC; click YES on all 4 prompts"]
    fn manual_restore_qa_w32ps_full_loop() {
        let _qa = crate::leftovers::QaRestoreGateBypass::begin();
        // Run elevated commands under cargo test (Wave-0 seam) — without this the self-helper
        // relaunches the TEST binary elevated, which exits 101 (caught live 2026-07-16).
        let _direct = crate::actions::ForceDirectElevation::begin();
        let original = read_w32ps();
        assert!(
            original.is_none() || original == Some(2),
            "rig must START clean (read {original:?}) — aborting before any write"
        );
        let before_len = load_history().expect("ledger readable").len();

        println!("\nUAC PROMPT 1/4 — SEED the rotted fixture (Win32PrioritySeparation = 0x26). Click YES.");
        run_elevated_powershell(W32PS_SEED).expect("seed write (did the prompt get a YES?)");
        assert_eq!(read_w32ps(), Some(0x26), "fixture seeded");

        let ids = flagged_ids();
        assert!(
            ids.iter().any(|i| i == "win32-priority-separation"),
            "get_leftovers flags the seeded fixture, got: {ids:?}"
        );
        println!("DETECTED: get_leftovers flags win32-priority-separation.");

        println!("\nUAC PROMPT 2/4 — RESTORE to Windows stock (2). Click YES.");
        let view = restore_leftover("win32-priority-separation", "QA · Past tweak restore")
            .expect("restore runs (did the prompt get a YES?)");
        assert_eq!(read_w32ps(), Some(2), "restored to stock 2");

        let after = load_history().expect("ledger readable");
        assert_eq!(after.len(), before_len + 1, "exactly one receipt");
        let receipt = after.iter().find(|c| c.id == view.id).expect("receipt present");
        assert_receipt(receipt, "priority-separation");
        assert_eq!(
            receipt.snapshot.get("prior_value").and_then(|v| v.as_u64()),
            Some(38),
            "snapshot holds the EXACT rotted value (0x26 = 38)"
        );
        assert!(
            !flagged_ids().iter().any(|i| i == "win32-priority-separation"),
            "the restored state reads clean"
        );
        println!("RECEIPT OK: provenance leftover_adopted · snapshot prior_value=38 · detector quiet.");

        println!("\nUAC PROMPT 3/4 — ROLLBACK (the rotted 0x26 must come back EXACTLY). Click YES.");
        rollback_change(view.id.clone()).expect("rollback runs (did the prompt get a YES?)");
        assert_eq!(read_w32ps(), Some(0x26), "rollback restored the rotted value EXACTLY");
        let post = load_history().expect("ledger readable");
        assert_eq!(
            post.iter().find(|c| c.id == view.id).expect("entry").status,
            "rolled_back"
        );

        println!("\nUAC PROMPT 4/4 — CLEANUP to Windows stock (2). Click YES.");
        run_elevated_powershell(W32PS_CLEANUP).expect("cleanup write (did the prompt get a YES?)");
        assert_eq!(read_w32ps(), Some(2), "left at Windows stock 2");
        println!(
            "W32PS LOOP PASS: seed 0x26 → flagged → restore (receipt prior=38) → rollback 0x26 exact → stock 2. Rig started at {original:?}."
        );
    }

    /// MPO QA loop — FOUR UAC prompts, click YES on all four: seed OverlayTestMode=5 → detector
    /// flags it → restore DELETES the value (receipt snapshot prior=5) → rollback sets 5 back
    /// EXACTLY → cleanup deletes (stock = value absent).
    #[test]
    #[ignore = "manual leftovers-restore QA — real UAC; click YES on all 4 prompts"]
    fn manual_restore_qa_mpo_full_loop() {
        let _qa = crate::leftovers::QaRestoreGateBypass::begin();
        let _direct = crate::actions::ForceDirectElevation::begin(); // Wave-0 seam (see w32ps loop)
        let original = read_overlay_test_mode();
        assert!(
            original.is_none(),
            "rig must START clean / value absent (read {original:?}) — aborting before any write"
        );
        let before_len = load_history().expect("ledger readable").len();

        println!("\nUAC PROMPT 1/4 — SEED the rotted fixture (OverlayTestMode = 5). Click YES.");
        run_elevated_powershell(MPO_SEED).expect("seed write (did the prompt get a YES?)");
        assert_eq!(read_overlay_test_mode(), Some(5), "fixture seeded");

        let ids = flagged_ids();
        assert!(
            ids.iter().any(|i| i == "mpo-disabled"),
            "get_leftovers flags the seeded fixture, got: {ids:?}"
        );
        println!("DETECTED: get_leftovers flags mpo-disabled.");

        println!("\nUAC PROMPT 2/4 — RESTORE the Windows default (delete the value). Click YES.");
        let view = restore_leftover("mpo-disabled", "QA · Past tweak restore")
            .expect("restore runs (did the prompt get a YES?)");
        assert_eq!(read_overlay_test_mode(), None, "value deleted — MPO back to default");

        let after = load_history().expect("ledger readable");
        assert_eq!(after.len(), before_len + 1, "exactly one receipt");
        let receipt = after.iter().find(|c| c.id == view.id).expect("receipt present");
        assert_receipt(receipt, "mpo");
        assert_eq!(
            receipt.snapshot.get("prior_overlay_test_mode").and_then(|v| v.as_u64()),
            Some(5),
            "snapshot holds the EXACT rotted value (5)"
        );
        assert!(
            !flagged_ids().iter().any(|i| i == "mpo-disabled"),
            "the restored state reads clean"
        );
        println!("RECEIPT OK: provenance leftover_adopted · snapshot prior=5 · detector quiet.");

        println!("\nUAC PROMPT 3/4 — ROLLBACK (OverlayTestMode=5 must come back EXACTLY). Click YES.");
        rollback_change(view.id.clone()).expect("rollback runs (did the prompt get a YES?)");
        assert_eq!(read_overlay_test_mode(), Some(5), "rollback restored the rotted value EXACTLY");
        let post = load_history().expect("ledger readable");
        assert_eq!(
            post.iter().find(|c| c.id == view.id).expect("entry").status,
            "rolled_back"
        );

        println!("\nUAC PROMPT 4/4 — CLEANUP (delete the value — Windows stock). Click YES.");
        run_elevated_powershell(MPO_CLEANUP).expect("cleanup write (did the prompt get a YES?)");
        assert_eq!(read_overlay_test_mode(), None, "left at Windows stock (value absent)");
        println!(
            "MPO LOOP PASS: seed 5 → flagged → restore-delete (receipt prior=5) → rollback 5 exact → absent."
        );
    }

    /// Memcompress full loop — SIX UAC prompts (the prior is admin-only, so state verification
    /// also rides elevated read-backs). ⚠ FIXTURE NOT YET OWNER-SANCTIONED: this loop toggles
    /// real memory compression (seed = Disable-MMAgent, cleanup = Enable-MMAgent, the Windows
    /// default). Do NOT run until the owner sanctions that pair. The 2026-06-12 elevated-prior-
    /// read redesign replaced the old always-refuse arm this harness previously pinned.
    #[test]
    #[ignore = "manual leftovers-restore QA — real UAC ×6; OWNER FIXTURE SANCTION REQUIRED (toggles memory compression)"]
    fn manual_restore_qa_memcompress_full_loop() {
        let (state, needs_admin) = crate::leftovers::read_memory_compression_probe();
        assert!(
            state.is_none() && needs_admin,
            "this loop exercises the admin-only-prior arm — run it from a normal (non-elevated) shell (probe read {state:?})"
        );
        let _qa = crate::leftovers::QaRestoreGateBypass::begin();
        let _direct = crate::actions::ForceDirectElevation::begin(); // Wave-0 seam (see w32ps loop)
        let before_len = load_history().expect("ledger readable").len();

        // Elevated read-back helper: the only way to verify ground truth when the read is
        // admin-only. Result file is data out, same pattern as the resolver itself.
        let read_back = |label: &str| -> bool {
            let path = crate::compy_data_dir().join(format!("qa-memcompress-{label}.result"));
            let _ = std::fs::remove_file(&path);
            let script = format!(
                "$rf='{}'; Add-Content -LiteralPath $rf -Value \"state:$((Get-MMAgent).MemoryCompression)\"",
                path.to_string_lossy().replace('\'', "''")
            );
            run_elevated_powershell(&script).expect("read-back (did the prompt get a YES?)");
            let text = std::fs::read_to_string(&path).unwrap_or_default();
            let _ = std::fs::remove_file(&path);
            match text.trim() {
                "state:True" => true,
                "state:False" => false,
                other => panic!("unparseable read-back: {other:?}"),
            }
        };

        println!("\nUAC PROMPT 1/6 — SEED the rotted fixture (Disable-MMAgent). Click YES.");
        run_elevated_powershell("if ((Get-MMAgent).MemoryCompression) { Disable-MMAgent -MemoryCompression }")
            .expect("seed (did the prompt get a YES?)");

        // Detection stays HONEST about the admin-only read: the detector must report
        // "needs admin", never a finding it can't see.
        let report = serde_json::to_value(crate::leftovers::get_leftovers()).expect("serializes");
        let unavailable: Vec<&str> = report
            .get("unavailable")
            .and_then(|u| u.as_array())
            .map(|us| us.iter().filter_map(|u| u.get("id").and_then(|i| i.as_str())).collect())
            .unwrap_or_default();
        assert!(
            unavailable.contains(&"memory-compression-off"),
            "non-elevated detection honestly reports needs-admin, got unavailable: {unavailable:?}"
        );
        println!("DETECTION HONEST: memory-compression-off reports needs-admin (not a guessed finding).");

        println!("\nUAC PROMPT 2/6 — RESTORE (one elevation banks prior THEN enables). Click YES.");
        let view = restore_leftover("memory-compression-off", "QA · Past tweak restore")
            .expect("restore runs (did the prompt get a YES?)");
        let after = load_history().expect("ledger readable");
        assert_eq!(after.len(), before_len + 1, "exactly one receipt");
        let receipt = after.iter().find(|c| c.id == view.id).expect("receipt present");
        assert_receipt(receipt, "memory-compression");
        assert_eq!(
            receipt.snapshot.get("prior_enabled").and_then(|v| v.as_bool()),
            Some(false),
            "snapshot banked the rotted prior (compression OFF) from INSIDE the elevation"
        );

        println!("\nUAC PROMPT 3/6 — READ-BACK: compression should now be ON. Click YES.");
        assert!(read_back("post-restore"), "restore enabled memory compression");

        println!("\nUAC PROMPT 4/6 — ROLLBACK (the rotted OFF must come back). Click YES.");
        rollback_change(view.id.clone()).expect("rollback runs (did the prompt get a YES?)");
        let post = load_history().expect("ledger readable");
        assert_eq!(post.iter().find(|c| c.id == view.id).expect("entry").status, "rolled_back");

        println!("\nUAC PROMPT 5/6 — READ-BACK: compression should be OFF again. Click YES.");
        assert!(!read_back("post-rollback"), "rollback restored the rotted OFF exactly");

        println!("\nUAC PROMPT 6/6 — CLEANUP to Windows stock (Enable-MMAgent). Click YES.");
        run_elevated_powershell("if (-not (Get-MMAgent).MemoryCompression) { Enable-MMAgent -MemoryCompression }")
            .expect("cleanup (did the prompt get a YES?)");
        println!(
            "MEMCOMPRESS LOOP PASS: seed OFF → needs-admin honest → restore (receipt prior=false, banked in-elevation) → ON → rollback → OFF → stock ON."
        );
    }
}

// ─── Leftovers v2 restore — armed-path tests + the adversarial rollback audit (R2-5) ────────
#[cfg(test)]
mod leftover_restore_tests {
    use super::*;

    #[test]
    fn armed_gate_admits_and_a_declined_elevation_writes_nothing() {
        // ARMED world (2026-07-16): the gate admits the call, the resolver reads the prior
        // (W32PS — non-elevated HKLM read, succeeds on any rig) and reaches the elevation seam;
        // a forced decline there must leave ZERO receipt. No real prompt, no mutation.
        let _force = ForceElevationError::begin();
        let before = load_history().expect("real ledger readable").len();
        let err = restore_leftover("win32-priority-separation", "armed decline test")
            .err()
            .expect("forced elevation decline");
        assert_eq!(err, ELEVATION_DECLINED_MSG, "admitted by the gate, refused at elevation: {err}");
        let after = load_history().expect("readable").len();
        assert_eq!(before, after, "a declined restore must never write a receipt");
    }

    #[test]
    fn production_gate_ships_armed_and_unknown_ids_still_refuse_loud() {
        // The arming contract: restore_gate() ships true (flipped 2026-07-16 after the
        // owner-present live-UAC QA passed all three loops), and an unknown leftover id still
        // refuses loudly BEFORE any elevation — the typed-allowlist rule survives arming.
        // ForceElevationError stays armed as a belt-and-suspenders guard: if resolver dispatch
        // ever ran before the id check, this test declines instead of prompting.
        assert!(crate::leftovers::restore_gate(), "the production gate ships ARMED");
        let _force = ForceElevationError::begin();
        let before = load_history().expect("real ledger readable").len();
        let err = restore_leftover("totally-unknown-id", "unknown id test")
            .err()
            .expect("unknown ids must refuse");
        assert!(err.contains("no restore resolver exists"), "loud allowlist refusal: {err}");
        let after = load_history().expect("readable").len();
        assert_eq!(before, after, "an unknown-id refusal must never write a receipt");
    }

    // ── Memcompress elevated-prior-read (2026-06-12, dark) — the adversarial set ──────────────

    #[test]
    fn memcompress_combined_script_banks_the_prior_before_mutating() {
        let s = memcompress_combined_restore_script(r"C:\Users\o'brien\AppData\res.result");
        // Order is the contract: EAP=Stop first, prior read + bank BEFORE the mutation, the
        // confirmation marker LAST — so a failure at any step can never leave a mutation that
        // precedes its snapshot.
        let idx = |needle: &str| s.find(needle).unwrap_or_else(|| panic!("missing {needle}: {s}"));
        assert!(s.starts_with("$ErrorActionPreference='Stop';"));
        assert!(idx("Get-MMAgent") < idx("prior:$p"), "prior read precedes its banking");
        assert!(idx("prior:$p") < idx("Enable-MMAgent"), "snapshot banks BEFORE the mutation");
        assert!(idx("Enable-MMAgent") < idx("done:ok"), "confirmation is the last act");
        assert!(!s.to_lowercase().contains("exit"), "exit-free: {s}");
        assert!(s.contains("o''brien"), "result path is single-quote-escaped");
    }

    #[test]
    fn memcompress_result_parse_is_fail_safe() {
        assert_eq!(parse_memcompress_restore_result("prior:False\ndone:ok"), Ok(false));
        assert_eq!(parse_memcompress_restore_result("prior:True\r\ndone:ok"), Ok(true));
        // Prior banked but the mutation never confirmed → no snapshot is earned.
        let e = parse_memcompress_restore_result("prior:False").expect_err("unconfirmed");
        assert!(e.contains("did not confirm") && e.contains("nothing was recorded"), "{e}");
        // No prior at all (empty / tampered / done-only) → refuse, never guess a direction.
        for text in ["", "done:ok", "prior:Garbage\ndone:ok"] {
            let e = parse_memcompress_restore_result(text).expect_err("must refuse");
            assert!(e.contains("nothing was recorded"), "{text:?}: {e}");
        }
    }

    #[test]
    fn memcompress_unreadable_prior_now_rides_one_elevation_and_a_decline_writes_nothing() {
        // The redesign: an admin-only prior no longer refuses outright — it takes the prior
        // INSIDE one elevated context. Deterministically: with elevation forced to decline and
        // the QA seam open, the resolver reaches the elevation seam (decline) regardless of which
        // arm ran (readable prior → plain path; unreadable → combined path) and ledgers nothing.
        let before = load_history().expect("readable").len();
        {
            let _qa = crate::leftovers::QaRestoreGateBypass::begin();
            let _force = ForceElevationError::begin();
            let err = restore_leftover("memory-compression-off", "QA seam test")
                .err()
                .expect("forced decline");
            assert_eq!(err, ELEVATION_DECLINED_MSG, "{err}");
        }
        assert_eq!(load_history().expect("readable").len(), before, "decline ledgers nothing");
    }

    #[test]
    fn unreadable_prior_refuses_before_elevation_is_even_attempted() {
        // Adversarial: rollback-first integrity means never mutating what couldn't be
        // snapshotted. With elevation forced to error, a Some(prior) reaches the elevation
        // seam (declined), while a None prior must fail EARLIER with the snapshot refusal.
        let _force = ForceElevationError::begin();
        let declined = restore_memory_compression_with(Some(false))
            .err()
            .expect("forced elevation error");
        assert_eq!(declined, ELEVATION_DECLINED_MSG, "reached elevation: {declined}");
        let refused = restore_memory_compression_with(None).err().expect("must refuse");
        assert!(
            refused.contains("can't be snapshotted"),
            "refusal precedes elevation: {refused}"
        );
    }

    #[test]
    fn rollback_scripts_restore_exact_priors_including_absent_value_deletion() {
        // The rotted value comes back EXACTLY: present priors are Set, absent priors are
        // Remove — and no script ever contains 'exit' (the §4 batchability invariant).
        let s = mmcss_rollback_script(Some(1), None);
        assert!(s.contains("'SystemResponsiveness' -Value 1"));
        assert!(s.contains("Remove-ItemProperty") && s.contains("'NetworkThrottlingIndex'"));
        let s2 = priority_separation_rollback_script(Some(38));
        assert!(s2.contains("'Win32PrioritySeparation' -Value 38"));
        let s3 = priority_separation_rollback_script(None);
        assert!(s3.contains("Remove-ItemProperty"));
        for script in [mmcss_restore_script(), priority_separation_restore_script(), s, s2, s3] {
            assert!(!script.to_lowercase().contains("exit"), "exit-free: {script}");
        }
        // The restore scripts write the documented stock values, nothing else.
        assert!(mmcss_restore_script().contains("'SystemResponsiveness' -Value 20"));
        assert!(mmcss_restore_script().contains("'NetworkThrottlingIndex' -Value 10"));
        assert!(priority_separation_restore_script().contains("-Value 2"));
    }

    #[test]
    fn blind_rollback_fails_loud_and_mismatched_pairs_are_contract_violations() {
        // A hand-edited entry with no prior must never guess a direction.
        let err = rollback_memory_compression_typed(None).expect_err("loud");
        assert!(err.contains("cannot roll back blind"));
        // The (action, snapshot) pair contract holds for the new variants too.
        let mismatch = dispatch_rollback(
            &RollbackAction::RestoreMemoryCompressionFromSnapshot,
            &Snapshot::PrioritySeparation { prior_value: Some(2) },
        );
        assert!(mismatch.is_err(), "mismatched pair must be a contract violation");
    }

    #[test]
    fn wave2_restore_scripts_are_integer_only_and_exit_free() {
        // Wave 2 adversarial: every elevated command is fixed-literal or integer-interpolated —
        // no external string, and exit-free (§4-batchable invariant).
        let scripts = [
            mpo_rollback_script(Some(5)),
            mpo_rollback_script(None),
            core_parking_script(0, 0),
            core_parking_script(100, 100),
            tcp_autotuning_script(true).to_string(),
            tcp_autotuning_script(false).to_string(),
        ];
        for s in &scripts {
            assert!(!s.to_lowercase().contains("exit"), "exit-free: {s}");
            // The only non-literal tokens are digits, the fixed GUIDs, and SCHEME_CURRENT — assert
            // no stray quoting that would indicate an interpolated free-form string slipped in.
            assert!(!s.contains("''"), "no PS string-escaping artifacts (= no external string): {s}");
        }
        // MPO restores default by DELETING the value; rollback with a prior SETS it back exactly.
        assert!(mpo_rollback_script(Some(5)).contains("OverlayTestMode' -Value 5"));
        assert!(mpo_rollback_script(None).contains("Remove-ItemProperty"));
        // Core-parking touches AC + DC + re-activates; restore re-allows parking (0%).
        let cp = core_parking_script(0, 0);
        assert!(cp.contains("setacvalueindex") && cp.contains("setdcvalueindex") && cp.contains("setactive"));
        assert!(cp.contains(SUB_PROCESSOR_GUID) && cp.contains(CPMINCORES_GUID));
        // TCP is fixed both ways.
        assert_eq!(tcp_autotuning_script(false), "netsh int tcp set global autotuninglevel=normal");
        assert_eq!(tcp_autotuning_script(true), "netsh int tcp set global autotuninglevel=disabled");
    }

    #[test]
    fn wave2_blind_rollback_fails_loud_and_pairs_are_contract_checked() {
        // Core-parking with no recorded AC prior must fail loud, never guess.
        assert!(rollback_core_parking_typed(None, Some(50)).is_err());
        // A desktop with no DC profile mirrors AC — not an error.
        assert!(core_parking_script(75, 75).contains("75"));
        // Mismatched (action, snapshot) pairs are contract violations for every wave-2 variant.
        for (a, s) in [
            (
                RollbackAction::RestoreMpoFromSnapshot,
                Snapshot::TcpAutotuning { prior_disabled: true },
            ),
            (
                RollbackAction::RestoreCoreParkingFromSnapshot,
                Snapshot::Mpo { prior_overlay_test_mode: Some(5) },
            ),
            (
                RollbackAction::RestoreTcpAutotuningFromSnapshot,
                Snapshot::CoreParking { prior_ac_pct: Some(0), prior_dc_pct: Some(0) },
            ),
        ] {
            assert!(dispatch_rollback(&a, &s).is_err(), "mismatched pair must be rejected");
        }
    }

    #[test]
    fn wave2_armed_detectors_reach_elevation_and_a_decline_writes_nothing() {
        // ARMED world: every wave-2 resolver is admitted by the gate, reads its prior
        // (non-elevated reads that succeed on any rig — the detector layer runs the same reads
        // routinely), and reaches the elevation seam; a forced decline leaves ZERO receipt.
        let _force = ForceElevationError::begin();
        let before = load_history().expect("real ledger readable").len();
        for id in ["mpo-disabled", "core-parking-forced", "tcp-autotuning-off"] {
            let err = restore_leftover(id, "armed decline test")
                .err()
                .expect("forced elevation decline");
            assert_eq!(err, ELEVATION_DECLINED_MSG, "{id}: admitted, refused at elevation: {err}");
        }
        let after = load_history().expect("readable").len();
        assert_eq!(before, after, "declined wave-2 restores must never write receipts");
    }

    #[test]
    fn permanently_excluded_detectors_have_no_resolver_even_armed() {
        // The two by-design exclusions (bcdedit timer flags — boot-config risk class; Defender
        // policy — security-settings owner territory) must stay restore-less FOREVER: even with
        // the gate armed and elevation theoretically available, dispatch refuses loudly before
        // any elevation is reachable. If someone ever wires a resolver for these ids, this test
        // is the tripwire that forces a deliberate owner decision.
        let _force = ForceElevationError::begin();
        let before = load_history().expect("real ledger readable").len();
        for id in ["bcdedit-timer-flags", "defender-policy-off"] {
            let err = restore_leftover(id, "excluded id test")
                .err()
                .expect("excluded ids must refuse");
            assert!(
                err.contains("no restore resolver exists"),
                "{id}: must refuse at dispatch, never reach elevation: {err}"
            );
        }
        let after = load_history().expect("readable").len();
        assert_eq!(before, after, "excluded-id refusals must never write receipts");
    }

    // ── Pagefile resolver (option (a)) — the adversarial set ──────────────────────────────────

    #[test]
    fn pagefile_parser_accepts_only_the_validated_single_fixed_entry() {
        let ok = parse_manual_pagefile_entry(&["C:\\pagefile.sys 30000 30000".into()])
            .expect("the origin-story layout parses");
        assert_eq!(ok, ('C', 30000, 30000));
        // Case-insensitive path, letter normalized upper.
        assert_eq!(
            parse_manual_pagefile_entry(&["d:\\PAGEFILE.SYS 8192 16384".into()]).expect("ok"),
            ('D', 8192, 16384)
        );
        // Every exotic layout REFUSES with the honest left-as-is message — never a guess:
        let refusals: Vec<Vec<String>> = vec![
            vec![],                                                  // disabled — no entry
            vec!["C:\\pagefile.sys 1 1".into(), "D:\\pagefile.sys 1 1".into()], // multi-pagefile
            vec!["?:\\pagefile.sys 30000 30000".into()],             // ?: auto-form
            vec!["C:\\pagefile.sys 0 0".into()],                     // system-managed-size form
            vec!["C:\\pagefile.sys 30000".into()],                   // missing max
            vec!["C:\\pagefile.sys 30000 30000 extra".into()],       // trailing junk
            vec!["C:\\other.sys 30000 30000".into()],                // not pagefile.sys
            vec!["C:\\pagefile.sys 3e4 30000".into()],               // non-integer size
        ];
        for entries in refusals {
            let err = parse_manual_pagefile_entry(&entries).expect_err("must refuse");
            assert!(err.contains("unusual") && err.contains("left as-is"), "{entries:?}: {err}");
        }
    }

    #[test]
    fn pagefile_exotic_layout_refuses_before_elevation_and_takes_no_snapshot() {
        // With elevation forced to error: a VALID layout reaches the elevation seam (declined),
        // an exotic one fails EARLIER with the layout refusal — no mutation path was entered.
        let _force = ForceElevationError::begin();
        let declined = restore_pagefile_automatic_with(vec!["C:\\pagefile.sys 30000 30000".into()])
            .err()
            .expect("forced elevation error");
        assert_eq!(declined, ELEVATION_DECLINED_MSG);
        let refused = restore_pagefile_automatic_with(vec![]).err().expect("refuses");
        assert!(refused.contains("left as-is"), "refusal precedes elevation: {refused}");
    }

    #[test]
    fn pagefile_rollback_rebuilds_a_provably_clean_entry_and_fails_loud_on_garbage() {
        let s = pagefile_rollback_script('C', 30000, 30000).expect("builds");
        // The rebuilt entry is exactly letter + fixed literal + digits — nothing else.
        assert!(s.contains("@('C:\\pagefile.sys 30000 30000')"), "exact entry: {s}");
        assert!(s.contains("AutomaticManagedPagefile=$false"), "manual mode precedes the entry");
        assert!(s.contains("-Type MultiString"));
        // No silent reboot, ever — in either direction; and exit-free.
        for script in [s.as_str(), PAGEFILE_RESTORE_SCRIPT] {
            assert!(!script.to_lowercase().contains("restart-computer"), "no silent reboot: {script}");
            assert!(!script.to_lowercase().contains("exit"), "exit-free: {script}");
        }
        // A hand-edited snapshot with garbage fails LOUD at script-build time.
        assert!(pagefile_rollback_script(';', 30000, 30000).is_err(), "non-letter refused");
        assert!(pagefile_rollback_script('C', 0, 30000).is_err(), "zero size refused");
    }

    #[test]
    fn pagefile_armed_pair_contract_and_snapshot_roundtrip_hold() {
        // ARMED world, rig-state-dependent by design — three honest outcomes, all mutation-free:
        // an unreadable prior refuses with "cannot snapshot" BEFORE elevation (the fail-safe
        // idiom); a non-single-fixed-entry layout refuses with the honest left-as-is message
        // BEFORE elevation; the validated layout reaches the elevation seam and the forced
        // decline stops it. Whichever this rig hits, the pinned invariant is the same:
        // NO receipt without a mutation.
        let _force = ForceElevationError::begin();
        let before = load_history().expect("real ledger readable").len();
        let err = restore_leftover("pagefile-fixed", "armed decline test")
            .err()
            .expect("declined or honestly refused");
        assert!(
            err == ELEVATION_DECLINED_MSG
                || err.contains("left as-is")
                || err.contains("cannot snapshot"),
            "the decline or one of the two honest refusals: {err}"
        );
        let after = load_history().expect("readable").len();
        assert_eq!(before, after, "no receipt without a mutation");
        // Pair contract: the new variant rejects mismatches.
        assert!(dispatch_rollback(
            &RollbackAction::RestorePagefileFromSnapshot,
            &Snapshot::Mpo { prior_overlay_test_mode: None },
        )
        .is_err());
        // The char-carrying snapshot round-trips through serde (ledger durability).
        let snap = Snapshot::PagefileManual {
            prior_drive_letter: 'C',
            prior_initial_mb: 30000,
            prior_maximum_mb: 30000,
        };
        let back: Snapshot =
            serde_json::from_value(serde_json::to_value(&snap).expect("ser")).expect("de");
        match back {
            Snapshot::PagefileManual { prior_drive_letter, prior_initial_mb, prior_maximum_mb } => {
                assert_eq!((prior_drive_letter, prior_initial_mb, prior_maximum_mb), ('C', 30000, 30000));
            }
            _ => panic!("wrong variant after round-trip"),
        }
    }

    #[test]
    fn provenance_is_additive_and_old_ledgers_still_deserialize() {
        // New variants + provenance round-trip; entries WITHOUT provenance load as None.
        let json = serde_json::json!([{
            "id": "memory-compression-off-1",
            "rec_id": "memory-compression-off",
            "rec_title": "Restore memory compression",
            "applied_at": "2026-06-11T00:00:00Z",
            "snapshot": { "kind": "memory-compression", "prior_enabled": false },
            "status": "applied",
            "rollback_action": { "kind": "restore-memory-compression-from-snapshot" },
            "provenance": "leftover_adopted"
        }]);
        let parsed: Vec<AppliedChange> = serde_json::from_value(json).expect("parses");
        assert_eq!(parsed[0].provenance.as_deref(), Some("leftover_adopted"));
        let legacy = serde_json::json!([{
            "id": "x", "rec_id": "game-mode", "rec_title": "t",
            "applied_at": "2026-01-01T00:00:00Z", "snapshot": {"prior": 1}, "status": "applied"
        }]);
        let parsed: Vec<AppliedChange> = serde_json::from_value(legacy).expect("old shape parses");
        assert_eq!(parsed[0].provenance, None, "pre-v2 ledgers are untouched by the new field");
    }
}

#[cfg(test)]
mod history_tests {
    use super::*;
    use serde_json::json;

    fn record(rec_id: &str, status: &str) -> AppliedChange {
        AppliedChange {
            id: format!("{rec_id}-1"),
            rec_id: rec_id.into(),
            rec_title: "title".into(),
            applied_at: "2026-01-01T00:00:00Z".into(),
            snapshot: json!({ "prior": 1 }),
            status: status.into(),
            applied_action: None,
            rollback_action: None,
            app_version_at_apply: None,
            ruleset_version_at_apply: None,
            elevation_used: None,
            provenance: None,
            hw_fingerprint: None,
            rolled_back_at: None,
        }
    }

    #[test]
    fn rig_tagging_stamps_new_receipts_and_stays_backcompat() {
        // A5 rig tagging: build_applied_change (the ONE receipt funnel) stamps the apply-time
        // fingerprint; a legacy ledger JSON without the field still deserializes (None) and its
        // view reports on_this_rig = None — honest "rig unknown", never a guess.
        let result = ApplyResult {
            applied_action: AppliedAction::DisableFastStartup,
            rollback_action: RollbackAction::RestoreFastStartupFromSnapshot,
            snapshot: Snapshot::FastStartup { prior_hiberboot: Some(1) },
            elevation_used: false,
        };
        let c = build_applied_change("fast-startup-off", "t", result).expect("build");
        let f = c.hw_fingerprint.as_ref().expect("new receipts must carry the rig stamp");
        assert!(!f.hash.is_empty(), "stamp carries the digest");
        // Stamped-on-THIS-rig entries read as this rig in the view.
        let v = into_view(c);
        assert_eq!(v.on_this_rig, Some(true), "freshly stamped on this rig → true");

        // Back-compat: pre-tagging JSON (no hw_fingerprint key) deserializes to None.
        let legacy = serde_json::json!({
            "id": "x-1", "rec_id": "game-mode", "rec_title": "t",
            "applied_at": "2026-01-01T00:00:00Z", "snapshot": { "prior": 1 },
            "status": "rolled_back"
        });
        let parsed: AppliedChange = serde_json::from_value(legacy).expect("legacy parses");
        assert!(parsed.hw_fingerprint.is_none());
        assert_eq!(into_view(parsed).on_this_rig, None, "legacy → honest unknown");
    }

    #[test]
    fn same_rig_ignores_driver_but_not_hardware() {
        // The ledger comparison is driver-INsensitive (a driver update is still your rig) but
        // flips on real hardware identity (gpu / ram / display).
        let base = crate::hardware::HwFingerprint {
            hash: "aa".into(),
            gpu: "Radeon RX 9070 XT".into(),
            gpu_driver: "25.5.1".into(),
            ram_gb: 32,
            display: "2560x1440@250".into(),
        };
        let driver_bump =
            crate::hardware::HwFingerprint { gpu_driver: "25.6.0".into(), ..base.clone() };
        assert!(same_rig(&base, &driver_bump), "driver bump is still this rig");
        let new_gpu =
            crate::hardware::HwFingerprint { gpu: "GeForce RTX 5080".into(), ..base.clone() };
        assert!(!same_rig(&base, &new_gpu), "different GPU is a different rig");
        let new_ram = crate::hardware::HwFingerprint { ram_gb: 64, ..base.clone() };
        assert!(!same_rig(&base, &new_ram), "different RAM is a different rig");
    }

    #[test]
    fn into_view_copies_fields_and_keeps_unknown_rec_active() {
        // An applied change for a rec we no longer recognize must still render as
        // active — we never hide a rollback behind an unknown rec_id.
        let c = record("a-rec-we-do-not-track", "applied");
        let v = into_view(c.clone());
        assert_eq!(v.id, c.id);
        assert_eq!(v.rec_id, c.rec_id);
        assert_eq!(v.status, "applied");
        assert!(v.is_still_active, "unknown rec must default to still-active");
    }

    #[test]
    fn rolled_back_change_renders_inactive() {
        // Once rolled back, the ledger reports it inactive without consulting the
        // live system — honest history regardless of current machine state.
        let v = into_view(record("game-mode", "rolled_back"));
        assert!(!v.is_still_active);
    }

    #[test]
    fn applied_label_describes_the_after_state_per_action() {
        // The "after" half of the before/after pair, derived from the typed AppliedAction.
        assert_eq!(applied_label_from_action(&Some(AppliedAction::EnableGameMode)).as_deref(), Some("On"));
        assert_eq!(
            applied_label_from_action(&Some(AppliedAction::SetUltimatePerformancePlan)).as_deref(),
            Some("Ultimate performance")
        );
        assert_eq!(
            applied_label_from_action(&Some(AppliedAction::SetVisualEffectsBestPerformance)).as_deref(),
            Some("Best performance")
        );
        assert_eq!(
            applied_label_from_action(&Some(AppliedAction::SuspendKnownService { service: KnownService::WSearch })).as_deref(),
            Some("Stopped")
        );
        assert_eq!(
            applied_label_from_action(&Some(AppliedAction::DisableUsbSelectiveSuspendOnAc)).as_deref(),
            Some("Off (on AC)")
        );
        assert_eq!(
            applied_label_from_action(&Some(AppliedAction::RestoreMpoDefault)).as_deref(),
            Some("Windows default")
        );
    }

    #[test]
    fn applied_label_is_none_for_legacy_entries_without_a_captured_action() {
        // A pre-typed-contract ledger entry (applied_action: None) → no "after" half; the UI shows
        // just the prior. into_view must surface that None straight through.
        assert_eq!(applied_label_from_action(&None), None);
        let v = into_view(record("game-mode", "applied"));
        assert_eq!(v.applied_label, None, "legacy entry has no after-label");
    }

    // A5 measured-payoff linkage: the honest per-tweak payoff meter. It names the KIND of gain a
    // tweak targets (input latency, background CPU/RAM, load stutter, network responsiveness, power/
    // thermal headroom) — never a fabricated FPS number, per the honest-measurement law.
    #[test]
    fn payoff_label_names_the_honest_gain_category_per_action() {
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::DisableMouseAcceleration)),
            Some("Input latency")
        );
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::EnableHardwareGpuScheduling)),
            Some("Input latency")
        );
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::DisableNagleOnActiveNics)),
            Some("Network responsiveness")
        );
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::DisableKnownService {
                service: KnownService::SysMain
            })),
            Some("Background CPU & RAM")
        );
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::SuspendKnownService {
                service: KnownService::WSearch
            })),
            Some("Background CPU & RAM")
        );
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::SetVisualEffectsBestPerformance)),
            Some("UI smoothness")
        );
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::SetUltimatePerformancePlan)),
            Some("Power & thermal headroom")
        );
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::DisableFastStartup)),
            Some("Clean-boot reliability")
        );
    }

    // Honesty law: the payoff meter must NEVER surface a fabricated numeric FPS/latency figure —
    // every category is a plain word-label, no digits.
    #[test]
    fn payoff_labels_are_categories_never_fabricated_numbers() {
        use AppliedAction::*;
        for a in [
            EnableGameMode,
            DisableMouseAcceleration,
            DisableGameBarAndDvr,
            SetVisualEffectsBestPerformance,
            EnableHardwareGpuScheduling,
            SetUltimatePerformancePlan,
            DisableNagleOnActiveNics,
            DisableFastStartup,
            DisableReservedStorage,
            DisableUsbSelectiveSuspendOnAc,
            DisablePcieAspmOnAc,
            DisableEnergyEfficientEthernet,
            DisableKnownService { service: KnownService::DiagTrack },
            SuspendKnownService { service: KnownService::SysMain },
            DisableScheduledTask { task: KnownBloatTask::CompatibilityAppraiser },
        ] {
            let label = payoff_label_from_action(&Some(a)).expect("catalog action has a payoff");
            assert!(
                !label.chars().any(|c| c.is_ascii_digit()),
                "payoff label must be a category, never a fabricated number: {label:?}"
            );
        }
    }

    // Restore-to-stock leftovers (Leftovers v2) carry no forward payoff claim — undoing a bad past
    // tweak isn't a measured gain, so it stays None (the UI shows no meter rather than an invented one).
    #[test]
    fn payoff_label_is_none_for_restores_and_legacy_entries() {
        assert_eq!(payoff_label_from_action(&None), None, "legacy entry: no payoff");
        assert_eq!(
            payoff_label_from_action(&Some(AppliedAction::RestoreMpoDefault)),
            None,
            "restore-to-stock has no forward payoff claim"
        );
        let v = into_view(record("game-mode", "applied"));
        assert_eq!(v.payoff_label, None, "legacy entry surfaces None through into_view");
    }

    #[test]
    fn summary_collapses_multiple_applies_of_one_rec() {
        // The same setting applied twice is ONE setting — not two "active" counts.
        // Unknown rec_id → check_change_active defaults to active.
        let history = vec![record("unknown-x", "applied"), record("unknown-x", "applied")];
        let s = summarize_history(&history);
        assert_eq!(s.total, 1);
        assert_eq!(s.active, 1);
        assert_eq!(s.externally_reverted, 0);
    }

    #[test]
    fn summary_latest_rollback_supersedes_old_applies() {
        // THE loop fix: an old "applied" entry superseded by a later rollback of
        // the same setting must NOT count as "externally reverted" — the setting's
        // latest intent is rolled_back. So re-applying or rolling back always
        // resolves the readiness item, and a clean state is always reachable.
        let history = vec![
            record("unknown-x", "applied"),
            record("unknown-x", "applied"),
            record("unknown-x", "rolled_back"),
        ];
        let s = summarize_history(&history);
        assert_eq!(s.total, 1);
        assert_eq!(s.rolled_back, 1);
        assert_eq!(s.active, 0);
        assert_eq!(s.externally_reverted, 0);
    }

    #[test]
    fn save_then_load_roundtrips_through_disk() {
        let dir =
            std::env::temp_dir().join(format!("compy-hist-roundtrip-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        let records = vec![
            record("game-mode", "applied"),
            record("hags-enable", "rolled_back"),
        ];
        save_history_to(&path, &records).unwrap();
        let back = load_history_from(&path).expect("round-trip load");
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].rec_id, "game-mode");
        assert_eq!(back[1].status, "rolled_back");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn missing_history_file_loads_empty() {
        let path = std::env::temp_dir().join("compy-hist-definitely-absent-9z.json");
        let _ = std::fs::remove_file(&path);
        assert!(load_history_from(&path).expect("missing file is a clean first run").is_empty());
    }

    #[test]
    fn corrupt_history_is_preserved_and_fails_loud_never_silently_empty() {
        // H1 (audit 2026-06-11): garbage on disk must never panic, fabricate entries, OR load
        // as silently empty (the old behavior — a later save would then overwrite the
        // recoverable file and permanently erase every rollback contract). It errors loudly
        // and the original bytes are set aside untouched.
        let dir =
            std::env::temp_dir().join(format!("compy-hist-corrupt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        let garbage: &[u8] = b"{ this is not valid json ]]]";
        std::fs::write(&path, garbage).unwrap();
        let err = load_history_from(&path)
            .err()
            .expect("a corrupt EXISTING ledger must error");
        assert!(err.contains("could not be read"), "loud, plain-English error: {err}");
        let corrupt = path.with_extension("json.corrupt");
        assert_eq!(
            std::fs::read(&corrupt).unwrap(),
            garbage,
            "the recoverable bytes are preserved EXACTLY, where no save will touch them"
        );
        assert!(!path.exists(), "the damaged live file was set aside");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn torn_write_never_loses_the_ledger() {
        // The H1 scenario end to end: a valid ledger, then a torn/truncated overwrite (what a
        // crash mid-write left under the OLD in-place fs::write) → the load refuses and
        // preserves; it never returns empty for a later save to overwrite.
        let dir = std::env::temp_dir().join(format!("compy-hist-torn-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        save_history_to(&path, &[record("game-mode", "applied")]).unwrap();
        let full = std::fs::read_to_string(&path).unwrap();
        std::fs::write(&path, &full[..full.len() / 2]).unwrap(); // torn mid-token
        assert!(
            load_history_from(&path).is_err(),
            "a torn ledger must surface, never silently empty"
        );
        assert!(
            path.with_extension("json.corrupt").exists(),
            "the torn bytes are preserved for recovery"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_is_an_atomic_swap_leaving_no_tmp() {
        // The other half of H1: saves go to a temp file then rename over the live ledger, so
        // a crash mid-write can only leave stale-but-valid data — and a successful save
        // leaves no .tmp residue.
        let dir = std::env::temp_dir().join(format!("compy-hist-atomic-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("history.json");
        save_history_to(&path, &[record("game-mode", "applied")]).unwrap();
        save_history_to(
            &path,
            &[record("game-mode", "applied"), record("hags-enable", "applied")],
        )
        .unwrap();
        assert_eq!(
            load_history_from(&path).expect("swap result valid").len(),
            2,
            "the second save atomically replaced the first"
        );
        assert!(
            !path.with_extension("json.tmp").exists(),
            "no tmp residue after a successful swap"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn legacy_entry_without_typed_contract_loads_with_none_fields() {
        // Old history.json entries predate the typed apply/rollback contract.
        // They must still load (serde default -> None) or an upgrade would brick
        // existing users' history and strip their ability to roll back.
        let legacy = json!([{
            "id": "game-mode-1",
            "rec_id": "game-mode",
            "rec_title": "Enable Game Mode",
            "applied_at": "2025-01-01T00:00:00Z",
            "snapshot": { "prior": 1 },
            "status": "applied"
        }]);
        let path =
            std::env::temp_dir().join(format!("compy-hist-legacy-{}.json", std::process::id()));
        std::fs::write(&path, serde_json::to_string(&legacy).unwrap()).unwrap();
        let loaded = load_history_from(&path).expect("legacy ledger loads");
        assert_eq!(loaded.len(), 1);
        assert!(loaded[0].applied_action.is_none());
        assert!(loaded[0].rollback_action.is_none());
        assert!(loaded[0].app_version_at_apply.is_none());
        std::fs::remove_file(&path).ok();
    }
}
