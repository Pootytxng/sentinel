//! Hardware-change detection (A5 "Re-Run Setup"): persists a lightweight hardware fingerprint and
//! flags when the rig's core components change between launches — the honest "your hardware changed,
//! worth re-checking your setup" signal. Read-only detection + one small local JSON file; mutates no
//! Windows state. The diff is pure (unit-tested); the command does the load/compare/first-baseline.

use serde::{Deserialize, Serialize};

use crate::hardware::HardwareInfo;

#[derive(Serialize, Deserialize, Clone, PartialEq, Debug, Default)]
pub(crate) struct HardwareFingerprint {
    cpu: String,
    gpus: Vec<String>,
    ram_gb: u64,
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
/// until the user re-baselines (a future Re-Run Setup acknowledgement), so it can't silently vanish.
#[tauri::command]
pub(crate) fn get_hardware_changes() -> HardwareChangeReport {
    let hw = crate::hardware::collect_hardware();
    let current = fingerprint(&hw);
    let prior: Option<HardwareFingerprint> = std::fs::read_to_string(fingerprint_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());
    match prior {
        None => {
            let _ = std::fs::create_dir_all(crate::compy_data_dir());
            if let Ok(j) = serde_json::to_string_pretty(&current) {
                let _ = std::fs::write(fingerprint_path(), j);
            }
            HardwareChangeReport { changed: false, changes: Vec::new(), baseline_recorded: true }
        }
        Some(p) => {
            let changes = diff_fingerprint(&p, &current);
            HardwareChangeReport { changed: !changes.is_empty(), changes, baseline_recorded: false }
        }
    }
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
}
