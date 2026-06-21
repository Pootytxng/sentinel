//! Receipts telemetry — DARK groundwork (R3 Lane C2; Receipts Doctrine Phase 3).
//!
//! Spec: `docs/superpowers/specs/2026-06-12-receipts-telemetry-spec.md` (owner review pending).
//! This module is the gaming_mode/Ed25519 pattern applied to telemetry: the PAYLOAD logic is
//! wired and tested, the gate is HARD-FALSE (test-pinned), and **the send path does not exist** —
//! no network primitive, no endpoint URL, no queue, anywhere in the app. Flipping the gate is its
//! own owner-signed commit per the spec's §5 ladder; until then `preview_receipt_payload` refuses.
//!
//! Anonymity is enforced by SCHEMA, not promise: the builder consumes an allowlist of fields and
//! sanitizes every string it touches — no hostname, username, path, serial, or exact byte count
//! can survive into a serialized payload (pinned by adversarial tests).

use serde::Serialize;
use serde_json::Value;

/// HARD-FALSE gate. Flips only per the spec §5 ladder: owner sign-off → endpoint security
/// review → consent-UI audit → its own commit with QA evidence. Mirrors `gaming_mode_gate`.
pub(crate) fn receipts_gate() -> bool {
    false
}

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct HwClass {
    gpu_vendor: String,
    /// Retail model name — a class shared by thousands of rigs, never a serial.
    gpu_model: String,
    cpu_family: String,
    ram_gb_bucket: String,
}

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct Outcome {
    kind: &'static str,
    game: String,
    avg_fps: f64,
    low1_fps_est: f64,
    duration_bucket: String,
    /// Catalog rec ids only — never values, paths, or registry data.
    active_change_ids: Vec<String>,
}

#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct ReceiptPayload {
    schema_version: u32,
    hw_class: HwClass,
    outcome: Outcome,
}

/// Path-impossible by construction: keep only the final path component, strip a trailing
/// `.exe`, lowercase. A username embedded in `C:\Users\<name>\game.exe` cannot survive.
fn sanitize_token(s: &str) -> String {
    let base = s.rsplit(['\\', '/']).next().unwrap_or(s);
    let base = base.strip_suffix(".exe").or_else(|| base.strip_suffix(".EXE")).unwrap_or(base);
    base.trim().to_lowercase()
}

/// Bucketed, never exact — exact byte counts could fingerprint unusual rigs.
fn ram_gb_bucket(bytes: Option<u64>) -> String {
    let Some(b) = bytes else { return "unknown".into() };
    let gb = (b as f64 / 1024f64.powi(3)).round() as u64;
    match gb {
        0..=8 => "0-8",
        9..=16 => "9-16",
        17..=24 => "17-24",
        25..=32 => "25-32",
        33..=64 => "33-64",
        _ => "64+",
    }
    .into()
}

fn duration_bucket(secs: Option<u64>) -> String {
    let Some(s) = secs else { return "unknown".into() };
    match s {
        0..=899 => "<15min",
        900..=1799 => "15-30min",
        1800..=3599 => "30-60min",
        3600..=10799 => "1-3h",
        _ => "3h+",
    }
    .into()
}

/// Vendor token from the GPU retail name — same heuristic family the UI uses.
fn gpu_vendor_token(name: &str) -> &'static str {
    let n = name.to_lowercase();
    if n.contains("radeon") || n.contains("amd") {
        "amd"
    } else if n.contains("nvidia") || n.contains("geforce") || n.contains("rtx") || n.contains("gtx") {
        "nvidia"
    } else if n.contains("intel") || n.contains("arc") {
        "intel"
    } else {
        "other"
    }
}

/// Pure: assemble a schema-v1 receipt from already-serialized signals. `None` when no monitored
/// session exists — a receipt without a measurement is not a receipt (receipts law).
pub(crate) fn build_receipt_payload(
    hardware: &Value,
    sessions: &Value,
    trust_ledger: &Value,
) -> Option<ReceiptPayload> {
    let session = sessions.as_array().and_then(|a| a.first())?;
    let game_raw = session.get("process_name").and_then(Value::as_str)?;

    let gpu_model_raw = hardware
        .get("gpus")
        .and_then(Value::as_array)
        .and_then(|g| g.first())
        .and_then(|g| g.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");
    let cpu_family = hardware
        .get("cpu_arch")
        .and_then(|a| a.get("family_label"))
        .and_then(Value::as_str)
        .unwrap_or("unknown");

    let active_change_ids = trust_ledger
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter(|c| {
                    c.get("status").and_then(Value::as_str) == Some("applied")
                        && c.get("is_still_active").and_then(Value::as_bool) != Some(false)
                })
                .filter_map(|c| c.get("rec_id").and_then(Value::as_str))
                .map(sanitize_token)
                .collect()
        })
        .unwrap_or_default();

    Some(ReceiptPayload {
        schema_version: 1,
        hw_class: HwClass {
            gpu_vendor: gpu_vendor_token(gpu_model_raw).into(),
            gpu_model: sanitize_token(gpu_model_raw),
            cpu_family: sanitize_token(cpu_family),
            ram_gb_bucket: ram_gb_bucket(hardware.get("ram_total_bytes").and_then(Value::as_u64)),
        },
        outcome: Outcome {
            kind: "session",
            game: sanitize_token(game_raw),
            avg_fps: session.get("avg_fps").and_then(Value::as_f64).unwrap_or(0.0),
            low1_fps_est: session.get("low1_fps_est").and_then(Value::as_f64).unwrap_or(0.0),
            duration_bucket: duration_bucket(session.get("duration_secs").and_then(Value::as_u64)),
            active_change_ids,
        },
    })
}

/// State probe: is the receipts surface available in this build? (It is not.)
#[tauri::command]
pub(crate) fn get_receipts_gate() -> bool {
    receipts_gate()
}

/// "Inspect your receipt" — returns the EXACT payload that would be shared. Refuses while the
/// gate is down (defense in depth: the surface is also hidden, gaming_mode pattern).
#[tauri::command]
pub(crate) fn preview_receipt_payload() -> Result<ReceiptPayload, String> {
    if !receipts_gate() {
        return Err("Receipts sharing isn't part of this build yet.".into());
    }
    let hardware = serde_json::to_value(crate::hardware::get_hardware_info()).unwrap_or(Value::Null);
    let sessions =
        serde_json::to_value(crate::sessions::get_session_summaries()).unwrap_or(Value::Null);
    let ledger =
        serde_json::to_value(crate::history::get_applied_changes()).unwrap_or(Value::Null);
    build_receipt_payload(&hardware, &sessions, &ledger)
        .ok_or_else(|| "No monitored session yet — a receipt needs a measurement first.".into())
}

#[cfg(test)]
mod receipts_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn gate_is_pinned_false_until_the_spec_ladder_completes() {
        // Flipping this is an owner-signed decision (spec §5), never a side effect of a refactor.
        assert!(!receipts_gate(), "receipts_gate must stay hard-false");
    }

    #[test]
    fn preview_command_refuses_while_dark() {
        let err = preview_receipt_payload().unwrap_err();
        assert!(err.contains("isn't part of this build"), "honest refusal, not a fake payload");
    }

    #[test]
    fn no_session_means_no_receipt() {
        assert_eq!(build_receipt_payload(&json!({}), &json!([]), &json!([])), None);
        assert_eq!(build_receipt_payload(&Value::Null, &Value::Null, &Value::Null), None);
    }

    #[test]
    fn adversarial_strings_cannot_leak_paths_or_usernames() {
        // Every consumed string field carries a path + username; the serialized payload must
        // contain none of it (anonymous by schema, not promise).
        let hardware = json!({
            "gpus": [{ "name": "C:\\Users\\kuya\\Radeon RX 9070 XT" }],
            "cpu_arch": { "family_label": "C:/Users/kuya/Ryzen X3D" },
            "ram_total_bytes": 31550000000u64
        });
        let sessions = json!([{
            "process_name": "C:\\Users\\kuya\\AppData\\game.exe",
            "avg_fps": 141.2, "low1_fps_est": 118.0, "duration_secs": 2400
        }]);
        let ledger = json!([{ "rec_id": "C:\\Users\\kuya\\game-dvr-off", "status": "applied", "is_still_active": true }]);
        let p = build_receipt_payload(&hardware, &sessions, &ledger).expect("session present");
        let serialized = serde_json::to_string(&p).expect("serializes");
        assert!(!serialized.contains("kuya"), "username leaked: {serialized}");
        assert!(!serialized.to_lowercase().contains("users"), "path leaked: {serialized}");
        assert!(!serialized.contains('\\') && !serialized.contains('/'), "separator leaked: {serialized}");
        assert!(serialized.contains("\"game\":\"game\""), "basename survives sanitization");
        assert!(serialized.contains("radeon rx 9070 xt"), "model class survives");
    }

    #[test]
    fn payload_buckets_never_carry_exact_values() {
        let hardware = json!({ "gpus": [{ "name": "GeForce RTX 3060 Ti" }], "cpu_arch": { "family_label": "Core i7" }, "ram_total_bytes": 17110000000u64 });
        let sessions = json!([{ "process_name": "game.exe", "avg_fps": 100.0, "low1_fps_est": 80.0, "duration_secs": 2400 }]);
        let p = build_receipt_payload(&hardware, &sessions, &json!([])).expect("present");
        let s = serde_json::to_string(&p).expect("serializes");
        assert!(s.contains("\"ram_gb_bucket\":\"9-16\""));
        assert!(s.contains("\"duration_bucket\":\"30-60min\""));
        assert!(!s.contains("17110000000"), "exact bytes must never serialize");
        assert!(!s.contains("2400"), "exact seconds must never serialize");
        assert!(s.contains("\"gpu_vendor\":\"nvidia\""));
    }

    #[test]
    fn only_active_applied_changes_contribute_ids() {
        let sessions = json!([{ "process_name": "g.exe", "avg_fps": 1.0, "low1_fps_est": 1.0, "duration_secs": 60 }]);
        let ledger = json!([
            { "rec_id": "hags", "status": "applied", "is_still_active": true },
            { "rec_id": "game-dvr-off", "status": "rolled_back", "is_still_active": false },
            { "rec_id": "power-plan", "status": "applied", "is_still_active": false }
        ]);
        let p = build_receipt_payload(&json!({}), &sessions, &ledger).expect("present");
        assert_eq!(p.outcome.active_change_ids, vec!["hags"]);
    }

    // ---- Appended boundary coverage (TEST-ONLY) ----

    // Helper: exact whole-GiB byte count so the internal `.round()` is unambiguous.
    fn gib(n: u64) -> Option<u64> {
        Some(n * 1024 * 1024 * 1024)
    }

    #[test]
    fn ram_gb_bucket_none_is_unknown() {
        assert_eq!(ram_gb_bucket(None), "unknown");
    }

    #[test]
    fn ram_gb_bucket_boundaries_round_to_labels_never_exact_gb() {
        // Cutoffs (rounded GB): 0..=8 | 9..=16 | 17..=24 | 25..=32 | 33..=64 | 64+.
        // Probe just-below / just-above each whole-GiB cutoff.
        assert_eq!(ram_gb_bucket(gib(0)), "0-8");
        assert_eq!(ram_gb_bucket(gib(8)), "0-8"); // top of first band
        assert_eq!(ram_gb_bucket(gib(9)), "9-16"); // just above
        assert_eq!(ram_gb_bucket(gib(16)), "9-16");
        assert_eq!(ram_gb_bucket(gib(17)), "17-24");
        assert_eq!(ram_gb_bucket(gib(24)), "17-24");
        assert_eq!(ram_gb_bucket(gib(25)), "25-32");
        assert_eq!(ram_gb_bucket(gib(32)), "25-32");
        assert_eq!(ram_gb_bucket(gib(33)), "33-64");
        assert_eq!(ram_gb_bucket(gib(64)), "33-64");
        assert_eq!(ram_gb_bucket(gib(65)), "64+");
        assert_eq!(ram_gb_bucket(gib(128)), "64+");
    }

    #[test]
    fn ram_gb_bucket_returns_a_label_never_a_raw_byte_or_gb_number() {
        // Privacy contract: the bucket string must be one of the fixed labels, never
        // an exact GB count (e.g. "31") or the raw byte count.
        const LABELS: &[&str] = &["unknown", "0-8", "9-16", "17-24", "25-32", "33-64", "64+"];
        for bytes in [None, gib(4), gib(15), gib(31), Some(31_550_000_000u64), gib(200)] {
            let label = ram_gb_bucket(bytes);
            assert!(LABELS.contains(&label.as_str()), "unexpected ram label: {label}");
            if let Some(b) = bytes {
                assert!(!label.contains(&b.to_string()), "exact byte count leaked: {label}");
            }
        }
    }

    #[test]
    fn ram_gb_bucket_rounds_half_gib_at_band_edge() {
        // FINDING: the band match is on `.round()`ed GiB, so a ~8.5 GiB rig rounds UP into
        // the "9-16" band rather than staying in "0-8". Assert the rounding reality.
        let eight_point_six = Some((8.6f64 * 1024f64 * 1024f64 * 1024f64) as u64);
        assert_eq!(ram_gb_bucket(eight_point_six), "9-16");
        let eight_point_four = Some((8.4f64 * 1024f64 * 1024f64 * 1024f64) as u64);
        assert_eq!(ram_gb_bucket(eight_point_four), "0-8");
    }

    #[test]
    fn duration_bucket_none_is_unknown() {
        assert_eq!(duration_bucket(None), "unknown");
    }

    #[test]
    fn duration_bucket_boundaries_are_labels_never_exact_seconds() {
        // Cutoffs (secs): 0..=899 | 900..=1799 | 1800..=3599 | 3600..=10799 | 10800+.
        assert_eq!(duration_bucket(Some(0)), "<15min");
        assert_eq!(duration_bucket(Some(899)), "<15min"); // just below 15min
        assert_eq!(duration_bucket(Some(900)), "15-30min"); // exactly 15min
        assert_eq!(duration_bucket(Some(1799)), "15-30min");
        assert_eq!(duration_bucket(Some(1800)), "30-60min"); // exactly 30min
        assert_eq!(duration_bucket(Some(3599)), "30-60min");
        assert_eq!(duration_bucket(Some(3600)), "1-3h"); // exactly 60min
        assert_eq!(duration_bucket(Some(10799)), "1-3h");
        assert_eq!(duration_bucket(Some(10800)), "3h+"); // exactly 3h
        assert_eq!(duration_bucket(Some(36000)), "3h+");
    }

    #[test]
    fn duration_bucket_returns_a_label_never_raw_seconds() {
        const LABELS: &[&str] = &["unknown", "<15min", "15-30min", "30-60min", "1-3h", "3h+"];
        for secs in [None, Some(120u64), Some(2400), Some(7200), Some(99999)] {
            let label = duration_bucket(secs);
            assert!(LABELS.contains(&label.as_str()), "unexpected duration label: {label}");
            if let Some(s) = secs {
                assert!(!label.contains(&s.to_string()), "exact seconds leaked: {label}");
            }
        }
    }

    #[test]
    fn gpu_vendor_token_recognizes_each_vendor_and_unknowns() {
        assert_eq!(gpu_vendor_token("NVIDIA GeForce RTX 4090"), "nvidia");
        assert_eq!(gpu_vendor_token("GeForce GTX 1660"), "nvidia");
        assert_eq!(gpu_vendor_token("AMD Radeon RX 9070 XT"), "amd");
        assert_eq!(gpu_vendor_token("Radeon Pro W6800"), "amd");
        assert_eq!(gpu_vendor_token("Intel Arc A770"), "intel");
        assert_eq!(gpu_vendor_token("Intel UHD Graphics 770"), "intel");
        assert_eq!(gpu_vendor_token("Matrox Millennium G550"), "other");
        assert_eq!(gpu_vendor_token(""), "other");
    }

    #[test]
    fn gpu_vendor_token_is_case_insensitive() {
        assert_eq!(gpu_vendor_token("radeon rx 9070 xt"), "amd");
        assert_eq!(gpu_vendor_token("nvidia geforce"), "nvidia");
        assert_eq!(gpu_vendor_token("INTEL ARC"), "intel");
    }

    #[test]
    fn gpu_vendor_token_amd_wins_when_multiple_vendors_appear() {
        // FINDING: the amd/radeon arm is checked FIRST, so a name carrying both vendor
        // words resolves to "amd" by precedence (not a tie / not "other").
        assert_eq!(gpu_vendor_token("Radeon paired with NVIDIA bridge"), "amd");
        assert_eq!(gpu_vendor_token("AMD + Intel hybrid"), "amd");
    }

    #[test]
    fn gpu_vendor_token_arc_substring_is_a_broad_match() {
        // FINDING: "arc" is a substring test, so unrelated names containing the letters
        // "arc" classify as Intel. Asserting reality, not endorsing it.
        assert_eq!(gpu_vendor_token("Sun Sparc Framebuffer"), "intel");
    }

    #[test]
    fn sanitize_token_strips_windows_path_keeping_basename() {
        assert_eq!(sanitize_token("C:\\Users\\kuya\\AppData\\game.exe"), "game");
        assert_eq!(sanitize_token("C:/Users/kuya/game.exe"), "game");
    }

    #[test]
    fn sanitize_token_strips_exe_suffix_either_case() {
        assert_eq!(sanitize_token("Game.EXE"), "game");
        assert_eq!(sanitize_token("GAME.exe"), "game");
        // Only a single trailing .exe/.EXE is stripped; an interior extension is kept.
        assert_eq!(sanitize_token("foo.exe.exe"), "foo.exe");
    }

    #[test]
    fn sanitize_token_trims_and_lowercases() {
        assert_eq!(sanitize_token("  Counter-Strike  "), "counter-strike");
        // Leading/trailing whitespace (incl. tab/newline) is trimmed by trim().
        assert_eq!(sanitize_token("\tDoom\n"), "doom");
    }

    #[test]
    fn sanitize_token_neutralizes_username_segment() {
        // The username only ever appears as an interior path segment; keeping the basename
        // drops it entirely.
        assert_eq!(sanitize_token("C:\\Users\\SomeRealName\\valorant.exe"), "valorant");
        let out = sanitize_token("/home/realuser/.local/share/Steam/game.exe");
        assert!(!out.contains("realuser"), "username leaked: {out}");
        assert_eq!(out, "game");
    }

    #[test]
    fn sanitize_token_empty_and_separator_only_inputs() {
        assert_eq!(sanitize_token(""), "");
        // Trailing-separator input: rsplit yields an empty final component.
        assert_eq!(sanitize_token("C:\\Users\\kuya\\"), "");
    }

    #[test]
    fn sanitize_token_does_not_strip_interior_control_chars() {
        // FINDING: sanitize_token keeps the basename, strips a trailing .exe, trims edges,
        // and lowercases — but it does NOT remove INTERIOR control characters. A NUL or
        // other control byte embedded mid-token survives. This is not a path/username leak
        // (those are handled), but the token is not guaranteed control-char-clean. Reported,
        // not fixed (TEST-ONLY).
        assert_eq!(sanitize_token("ga\u{0}me"), "ga\u{0}me");
        assert_eq!(sanitize_token("a\u{7}b"), "a\u{7}b");
    }
}
