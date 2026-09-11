//! Hardware-change detection (A5 "Re-Run Setup"): persists a lightweight hardware fingerprint and
//! flags when the rig's core components change between launches — the honest "your hardware changed,
//! worth re-checking your setup" signal. Read-only detection + one small local JSON file; mutates no
//! Windows state. The diff is pure (unit-tested); the command does the load/compare/first-baseline.

use serde::{Deserialize, Serialize};

use crate::hardware::HardwareInfo;

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug, Default)]
pub(crate) struct HardwareFingerprint {
    cpu: String,
    /// Read by `machine_model.rs` to report where this baseline and the live hardware read
    /// disagree. Visibility only; this stays the canonical producer of the baseline.
    pub(crate) gpus: Vec<String>,
    /// Truncated GiB, deliberately — `diff_fingerprint` applies its own +/-1 tolerance. The
    /// Machine Model reuses that tolerance rather than inventing a second rounding rule.
    pub(crate) ram_gb: u64,
    disks: Vec<String>,
}

/// Reduce a full HardwareInfo to its stable identity fields. Sorted so adapter/disk enumeration
/// ORDER never reads as a "change" (only membership matters).
pub(crate) fn fingerprint(hw: &HardwareInfo) -> HardwareFingerprint {
    let mut gpus: Vec<String> =
        hw.gpus.iter().map(|g| g.name.clone()).filter(|n| !n.is_empty()).collect();
    gpus.sort();
    let mut disks: Vec<String> = hw
        .physical_disks
        .iter()
        .map(|d| d.friendly_name.clone())
        .filter(|n| !n.is_empty())
        .collect();
    disks.sort();
    HardwareFingerprint {
        cpu: hw.cpu_brand.clone(),
        gpus,
        ram_gb: hw.ram_total_bytes / 1_073_741_824,
        disks,
    }
}

/// Pure diff → human-readable change lines (empty = unchanged). Names WHAT changed; never guesses why.
pub(crate) fn diff_fingerprint(
    prior: &HardwareFingerprint,
    current: &HardwareFingerprint,
) -> Vec<String> {
    let mut changes = Vec::new();
    if prior.cpu != current.cpu {
        changes.push(format!("CPU changed: {} → {}", prior.cpu, current.cpu));
    }
    if prior.gpus != current.gpus {
        let show = |v: &[String]| if v.is_empty() { "none".to_string() } else { v.join(", ") };
        changes.push(format!("GPU changed: {} → {}", show(&prior.gpus), show(&current.gpus)));
    }
    // ±1 GB tolerance so rounding never reads as a RAM change.
    if prior.ram_gb.abs_diff(current.ram_gb) > 1 {
        changes.push(format!("RAM changed: {} GB → {} GB", prior.ram_gb, current.ram_gb));
    }
    if prior.disks != current.disks {
        changes.push("Storage drives changed since your last setup.".to_string());
    }
    changes
}

fn fingerprint_path() -> std::path::PathBuf {
    crate::compy_data_dir().join("hardware-fingerprint.json")
}

/// Load a persisted fingerprint (None when absent or unreadable — both mean "no baseline yet").
fn load_fingerprint(path: &std::path::Path) -> Option<HardwareFingerprint> {
    std::fs::read_to_string(path).ok().and_then(|s| serde_json::from_str(&s).ok())
}

/// Persist a fingerprint as the new baseline (creates the data dir if needed).
fn write_fingerprint(path: &std::path::Path, fp: &HardwareFingerprint) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let j = serde_json::to_string_pretty(fp).map_err(|e| e.to_string())?;
    std::fs::write(path, j).map_err(|e| e.to_string())
}

/// The persisted baseline, read without writing one. `get_hardware_changes` records a first-run
/// baseline as a side effect; a read-only consumer must never trigger that, so it comes here.
/// None means no baseline has been recorded yet, which is honestly different from "no change".
pub(crate) fn persisted_baseline() -> Option<HardwareFingerprint> {
    load_fingerprint(&fingerprint_path())
}

/// Test-only baseline constructor for consumers that compare against one. Never shipped.
#[cfg(test)]
pub(crate) fn test_fingerprint(cpu: &str, gpus: &[&str], ram_gb: u64) -> HardwareFingerprint {
    HardwareFingerprint {
        cpu: cpu.into(),
        gpus: gpus.iter().map(|s| s.to_string()).collect(),
        ram_gb,
        disks: Vec::new(),
    }
}

#[derive(Serialize)]
pub(crate) struct HardwareChangeReport {
    /// True when core hardware differs from the recorded baseline.
    changed: bool,
    /// Human-readable change lines (empty when unchanged or first-run).
    changes: Vec<String>,
    /// True when this call just recorded the FIRST baseline (nothing to compare against yet).
    baseline_recorded: bool,
}

/// Read-only: compare current hardware against the persisted fingerprint. First run records the
/// baseline (and reports no change). Never auto-updates on a detected change — the change persists
/// until the user re-baselines (`acknowledge_hardware_changes`), so it can't silently vanish.
#[tauri::command]
pub(crate) fn get_hardware_changes() -> HardwareChangeReport {
    let hw = crate::hardware::collect_hardware();
    let current = fingerprint(&hw);
    match load_fingerprint(&fingerprint_path()) {
        None => {
            let _ = write_fingerprint(&fingerprint_path(), &current);
            HardwareChangeReport { changed: false, changes: Vec::new(), baseline_recorded: true }
        }
        Some(p) => {
            let changes = diff_fingerprint(&p, &current);
            HardwareChangeReport { changed: !changes.is_empty(), changes, baseline_recorded: false }
        }
    }
}

/// Re-baseline: record the CURRENT hardware as the new baseline so a previously-flagged change stops
/// being reported (the user acknowledged "this is my rig now"). Writes ONLY the local fingerprint
/// file — mutates no Windows state. Without it, a detected change would re-appear every launch.
#[tauri::command]
pub(crate) fn acknowledge_hardware_changes() -> Result<(), String> {
    let hw = crate::hardware::collect_hardware();
    write_fingerprint(&fingerprint_path(), &fingerprint(&hw))
}

#[cfg(test)]
mod hwchange_tests {
    use super::*;

    fn fp(cpu: &str, gpus: &[&str], ram_gb: u64, disks: &[&str]) -> HardwareFingerprint {
        HardwareFingerprint {
            cpu: cpu.into(),
            gpus: gpus.iter().map(|s| s.to_string()).collect(),
            ram_gb,
            disks: disks.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn identical_fingerprints_report_no_change() {
        let a = fp("Ryzen 7 7800X3D", &["RX 9070 XT"], 32, &["CT1000"]);
        assert!(diff_fingerprint(&a, &a).is_empty());
    }

    #[test]
    fn gpu_swap_is_named() {
        let a = fp("Ryzen 7 7800X3D", &["RX 9070 XT"], 32, &["CT1000"]);
        let b = fp("Ryzen 7 7800X3D", &["RTX 5080"], 32, &["CT1000"]);
        let c = diff_fingerprint(&a, &b);
        assert_eq!(c.len(), 1);
        assert!(c[0].contains("GPU changed") && c[0].contains("RTX 5080"));
    }

    #[test]
    fn ram_change_honors_1gb_tolerance() {
        let a = fp("cpu", &[], 32, &[]);
        // 31 vs 32 (rounding) → no change; 16 vs 32 → change.
        assert!(diff_fingerprint(&a, &fp("cpu", &[], 31, &[])).is_empty());
        assert_eq!(diff_fingerprint(&a, &fp("cpu", &[], 16, &[])).len(), 1);
    }

    #[test]
    fn cpu_and_disk_changes_are_each_flagged() {
        let a = fp("old cpu", &[], 32, &["disk1"]);
        let b = fp("new cpu", &[], 32, &["disk2"]);
        assert_eq!(diff_fingerprint(&a, &b).len(), 2); // cpu + disks, independently
    }

    #[test]
    fn enumeration_order_is_not_a_change() {
        // fingerprint() sorts; two rigs with the same parts in different order match.
        let a = fp("cpu", &["B", "A"], 32, &["y", "x"]);
        let sorted = fp("cpu", &["A", "B"], 32, &["x", "y"]);
        // diff on already-sorted equal sets is empty (fingerprint() guarantees the sort upstream).
        assert!(diff_fingerprint(&sorted, &sorted).is_empty());
        // and the unsorted literal differs from sorted — proving the sort in fingerprint() matters.
        assert!(!diff_fingerprint(&a, &sorted).is_empty());
    }

    #[test]
    fn write_then_load_round_trips_and_rebaseline_clears_the_change() {
        let dir = std::env::temp_dir().join("compy_hwchange_test_rebaseline");
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join("hardware-fingerprint.json");

        let old = fp("old cpu", &["RX 9070 XT"], 32, &["CT1000"]);
        write_fingerprint(&path, &old).unwrap();
        assert_eq!(load_fingerprint(&path), Some(old)); // persists + round-trips field-for-field

        // a swapped rig differs from the stored baseline...
        let new = fp("new cpu", &["RTX 5080"], 64, &["SN850"]);
        assert!(!diff_fingerprint(&load_fingerprint(&path).unwrap(), &new).is_empty());
        // ...and acknowledging (re-baselining to the new rig) clears the change so it can't re-nag.
        write_fingerprint(&path, &new).unwrap();
        assert!(diff_fingerprint(&load_fingerprint(&path).unwrap(), &new).is_empty());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
