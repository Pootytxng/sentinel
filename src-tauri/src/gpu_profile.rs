//! GPU profile before/after delta — READ-ONLY, advisory backend contract (GPU backlog line:
//! "before/after delta display (for profiles)"). This is the read-only half of the GPU-profile
//! feature — NOT the gated Phase-B "GPU profile apply / import / rollback" (LOCKED rule 6).
//!
//! A `GpuProfileSnapshot` is a record of the readable, advisory GPU state Compy already surfaces
//! (vendor, model, driver version, HAGS on/off, the vendor power-mode LABEL, last measured peak
//! temperature). This module does the pure diff of two such snapshots: field-by-field
//! same / changed / unknown, plus the signed peak-temp delta. It performs NO Windows mutation, no
//! elevation, no IPC of its own, no network — it only compares two records the reader already holds.
//!
//! HONESTY (Rule 5 / honest-measurement law): a field is only "changed" when BOTH sides were read
//! and differ. If either side is unread the field is "unknown" — a missing read is never inflated
//! into a change. The peak-temp delta is reported signed (down = cooler = the good direction) with
//! NO FPS or performance claim attached.

#![allow(dead_code)] // pure read-only delta core; wired to a command + the GpuProfile surface later.

use serde::{Deserialize, Serialize};

/// A captured GPU profile snapshot. Every field is optional because it mirrors reads that can be
/// unavailable (NVIDIA sensor gated per Rule 5, no session yet for peak temp, etc.). An absent read
/// stays `None` — never fabricated.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub(crate) struct GpuProfileSnapshot {
    pub captured_at: String,
    #[serde(default)]
    pub vendor: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub driver_version: Option<String>,
    #[serde(default)]
    pub hags_enabled: Option<bool>,
    #[serde(default)]
    pub power_mode_label: Option<String>,
    #[serde(default)]
    pub peak_temp_c: Option<u32>,
}

/// Per-field comparison outcome. `Unknown` = at least one side unread (never counted as a change).
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DeltaStatus {
    Same,
    Changed,
    Unknown,
}

/// Numeric direction for the one field (peak temp) that carries a good→bad meaning.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum DeltaDirection {
    Up,
    Down,
    Flat,
    None,
}

/// One field's before/after result, ready for display.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct FieldDelta {
    pub key: String,
    pub label: String,
    pub before_text: String,
    pub after_text: String,
    pub status: DeltaStatus,
    pub direction: DeltaDirection,
    /// after − before when both sides are numbers; else `None`.
    pub numeric_delta: Option<i32>,
}

fn text_status(before: &Option<String>, after: &Option<String>) -> DeltaStatus {
    match (before, after) {
        (Some(b), Some(a)) => {
            if b == a {
                DeltaStatus::Same
            } else {
                DeltaStatus::Changed
            }
        }
        _ => DeltaStatus::Unknown,
    }
}

fn text_field(key: &str, label: &str, b: &Option<String>, a: &Option<String>) -> FieldDelta {
    FieldDelta {
        key: key.into(),
        label: label.into(),
        before_text: b.clone().unwrap_or_else(|| "—".into()),
        after_text: a.clone().unwrap_or_else(|| "—".into()),
        status: text_status(b, a),
        direction: DeltaDirection::None,
        numeric_delta: None,
    }
}

fn bool_field(b: Option<bool>, a: Option<bool>) -> FieldDelta {
    let show = |v: Option<bool>| match v {
        Some(true) => "On".to_string(),
        Some(false) => "Off".to_string(),
        None => "—".to_string(),
    };
    let status = match (b, a) {
        (Some(bb), Some(aa)) => {
            if bb == aa {
                DeltaStatus::Same
            } else {
                DeltaStatus::Changed
            }
        }
        _ => DeltaStatus::Unknown,
    };
    FieldDelta {
        key: "hagsEnabled".into(),
        label: "Hardware-accelerated GPU scheduling".into(),
        before_text: show(b),
        after_text: show(a),
        status,
        direction: DeltaDirection::None,
        numeric_delta: None,
    }
}

fn temp_field(b: Option<u32>, a: Option<u32>) -> FieldDelta {
    let show = |v: Option<u32>| v.map(|t| format!("{t} °C")).unwrap_or_else(|| "—".into());
    let (status, direction, numeric_delta) = match (b, a) {
        (Some(bb), Some(aa)) => {
            let d = aa as i32 - bb as i32;
            let dir = match d.cmp(&0) {
                std::cmp::Ordering::Greater => DeltaDirection::Up,
                std::cmp::Ordering::Less => DeltaDirection::Down,
                std::cmp::Ordering::Equal => DeltaDirection::Flat,
            };
            let st = if d == 0 { DeltaStatus::Same } else { DeltaStatus::Changed };
            (st, dir, Some(d))
        }
        _ => (DeltaStatus::Unknown, DeltaDirection::None, None),
    };
    FieldDelta {
        key: "peakTempC".into(),
        label: "Peak GPU temperature".into(),
        before_text: show(b),
        after_text: show(a),
        status,
        direction,
        numeric_delta,
    }
}

/// Pure field-by-field diff of two snapshots (either may be absent). Mirrors the TS engine exactly:
/// a field is `Changed` only when both sides were read and differ; a missing read is `Unknown`, never
/// a fabricated change. The temp field carries the signed delta + direction.
pub(crate) fn compute_delta(
    before: Option<&GpuProfileSnapshot>,
    after: Option<&GpuProfileSnapshot>,
) -> Vec<FieldDelta> {
    let g = |f: fn(&GpuProfileSnapshot) -> Option<String>| {
        (before.and_then(f), after.and_then(f))
    };
    let (v_b, v_a) = g(|s| s.vendor.clone());
    let (m_b, m_a) = g(|s| s.model.clone());
    let (d_b, d_a) = g(|s| s.driver_version.clone());
    let (p_b, p_a) = g(|s| s.power_mode_label.clone());
    vec![
        text_field("vendor", "Vendor", &v_b, &v_a),
        text_field("model", "GPU model", &m_b, &m_a),
        text_field("driverVersion", "Driver version", &d_b, &d_a),
        bool_field(
            before.and_then(|s| s.hags_enabled),
            after.and_then(|s| s.hags_enabled),
        ),
        text_field("powerModeLabel", "Power mode", &p_b, &p_a),
        temp_field(
            before.and_then(|s| s.peak_temp_c),
            after.and_then(|s| s.peak_temp_c),
        ),
    ]
}

/// True when at least one field genuinely moved (both sides read + differ).
pub(crate) fn has_any_change(deltas: &[FieldDelta]) -> bool {
    deltas.iter().any(|d| d.status == DeltaStatus::Changed)
}

/// One honest summary line. Unknown fields are never called changes; a temp move is phrased as
/// cooler/warmer (down = cooler is the good direction) with no FPS/performance claim.
pub(crate) fn delta_summary(deltas: &[FieldDelta]) -> String {
    let changed = deltas.iter().filter(|d| d.status == DeltaStatus::Changed).count();
    if changed == 0 {
        return "No changes between these two snapshots.".into();
    }
    let mut parts = vec![format!(
        "{changed} setting{} changed",
        if changed == 1 { "" } else { "s" }
    )];
    if let Some(t) = deltas
        .iter()
        .find(|d| d.key == "peakTempC" && d.numeric_delta.is_some_and(|n| n != 0))
    {
        let n = t.numeric_delta.unwrap();
        let mag = n.abs();
        parts.push(if n < 0 {
            format!("peak temp {mag} °C cooler")
        } else {
            format!("peak temp {mag} °C warmer")
        });
    }
    format!("{}.", parts.join(" · "))
}

#[cfg(test)]
mod gpu_profile_tests {
    use super::*;

    fn snap() -> GpuProfileSnapshot {
        GpuProfileSnapshot {
            captured_at: "2026-07-01T00:00:00Z".into(),
            vendor: Some("AMD".into()),
            model: Some("Radeon RX 9070 XT".into()),
            driver_version: Some("24.6.1".into()),
            hags_enabled: Some(true),
            power_mode_label: Some("Balanced".into()),
            peak_temp_c: Some(72),
        }
    }

    fn find<'a>(d: &'a [FieldDelta], key: &str) -> &'a FieldDelta {
        d.iter().find(|x| x.key == key).unwrap()
    }

    #[test]
    fn unchanged_fields_are_same_changed_fields_are_changed() {
        let before = snap();
        let mut after = snap();
        after.driver_version = Some("24.7.1".into());
        after.peak_temp_c = Some(65);
        let d = compute_delta(Some(&before), Some(&after));
        assert_eq!(find(&d, "vendor").status, DeltaStatus::Same);
        assert_eq!(find(&d, "driverVersion").status, DeltaStatus::Changed);
        assert_eq!(find(&d, "peakTempC").status, DeltaStatus::Changed);
        assert!(has_any_change(&d));
    }

    #[test]
    fn a_missing_read_is_unknown_never_a_fabricated_change() {
        let before = snap();
        let mut after = snap();
        after.driver_version = None;
        let d = compute_delta(Some(&before), Some(&after));
        let drv = find(&d, "driverVersion");
        assert_eq!(drv.status, DeltaStatus::Unknown);
        assert_eq!(drv.after_text, "—");
    }

    #[test]
    fn a_missing_snapshot_yields_all_unknown_no_panic() {
        let d = compute_delta(None, Some(&snap()));
        assert!(d.iter().all(|x| x.status == DeltaStatus::Unknown));
        assert!(!has_any_change(&d));
        let empty = compute_delta(None, None);
        assert!(empty.iter().all(|x| x.status == DeltaStatus::Unknown));
    }

    #[test]
    fn temp_direction_and_signed_delta() {
        let mut b = snap();
        b.peak_temp_c = Some(80);
        let mut a = snap();
        a.peak_temp_c = Some(68);
        let cooler = find(&compute_delta(Some(&b), Some(&a)), "peakTempC").clone();
        assert_eq!(cooler.direction, DeltaDirection::Down);
        assert_eq!(cooler.numeric_delta, Some(-12));

        a.peak_temp_c = Some(90);
        let warmer = find(&compute_delta(Some(&b), Some(&a)), "peakTempC").clone();
        assert_eq!(warmer.direction, DeltaDirection::Up);
        assert_eq!(warmer.numeric_delta, Some(10));

        a.peak_temp_c = Some(80);
        let flat = find(&compute_delta(Some(&b), Some(&a)), "peakTempC").clone();
        assert_eq!(flat.direction, DeltaDirection::Flat);
        assert_eq!(flat.status, DeltaStatus::Same);
    }

    #[test]
    fn temp_with_a_missing_side_has_no_numeric_delta() {
        let mut b = snap();
        b.peak_temp_c = Some(70);
        let mut a = snap();
        a.peak_temp_c = None;
        let t = find(&compute_delta(Some(&b), Some(&a)), "peakTempC").clone();
        assert_eq!(t.numeric_delta, None);
        assert_eq!(t.direction, DeltaDirection::None);
        assert_eq!(t.status, DeltaStatus::Unknown);
    }

    #[test]
    fn bool_hags_formats_on_off() {
        let mut b = snap();
        b.hags_enabled = Some(false);
        let a = snap();
        let h = find(&compute_delta(Some(&b), Some(&a)), "hagsEnabled").clone();
        assert_eq!(h.before_text, "Off");
        assert_eq!(h.after_text, "On");
        assert_eq!(h.status, DeltaStatus::Changed);
    }

    #[test]
    fn summary_counts_and_phrases_temp_honestly() {
        let mut b = snap();
        b.peak_temp_c = Some(80);
        let mut a = snap();
        a.driver_version = Some("24.7.1".into());
        a.peak_temp_c = Some(68);
        let s = delta_summary(&compute_delta(Some(&b), Some(&a)));
        assert!(s.contains("2 settings changed"), "got: {s}");
        assert!(s.contains("peak temp 12 °C cooler"), "got: {s}");
        let low = s.to_lowercase();
        assert!(!low.contains("fps") && !low.contains("faster") && !low.contains("performance"));
    }

    #[test]
    fn summary_pluralizes_a_single_change_and_warmer_temp() {
        let mut b = snap();
        b.peak_temp_c = Some(68);
        let mut a = snap();
        a.peak_temp_c = Some(75);
        let s = delta_summary(&compute_delta(Some(&b), Some(&a)));
        assert!(s.contains("1 setting changed"), "got: {s}");
        assert!(s.contains("peak temp 7 °C warmer"), "got: {s}");
    }

    #[test]
    fn summary_no_changes_when_nothing_moved_or_all_unknown() {
        assert_eq!(
            delta_summary(&compute_delta(Some(&snap()), Some(&snap()))),
            "No changes between these two snapshots."
        );
        assert_eq!(
            delta_summary(&compute_delta(None, Some(&snap()))),
            "No changes between these two snapshots."
        );
    }

    #[test]
    fn snapshot_serde_round_trips_and_defaults_absent_fields() {
        let json = r#"{"captured_at":"t","peak_temp_c":70}"#;
        let s: GpuProfileSnapshot = serde_json::from_str(json).unwrap();
        assert_eq!(s.peak_temp_c, Some(70));
        assert_eq!(s.vendor, None);
        assert_eq!(s.hags_enabled, None);
        let back = serde_json::to_string(&s).unwrap();
        let again: GpuProfileSnapshot = serde_json::from_str(&back).unwrap();
        assert_eq!(s, again);
    }
}
