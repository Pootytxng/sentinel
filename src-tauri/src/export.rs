//! Export Snapshot (F5): READ-ONLY. Composes Compy's already-gathered data
//! (hardware, recommendations, Trust Ledger, readiness, sessions) into a local,
//! shareable Markdown (+ JSON) report. It mutates nothing, calls no apply/
//! rollback, performs no detection of its own, and sends nothing off the device
//! — the user picks where the file goes.
//!
//! The report is built from each source's serde-serialized `Value`, so this
//! module is decoupled from internal struct shapes and degrades gracefully to
//! "—" on any missing field. `build_markdown_report` is pure and unit-tested.

use std::collections::HashSet;
use std::fmt::Write as _;

use serde::Serialize;
use serde_json::{json, Value};

use crate::history::APPLIABLE_REC_IDS;
use crate::compy_data_dir;

#[derive(Serialize)]
pub(crate) struct ExportResult {
    path: String,
    json_path: String,
    markdown: String,
}

// ── Value helpers (graceful: missing/null → "—") ────────────────────────────

fn vstr(v: &Value, key: &str) -> String {
    match v.get(key) {
        Some(Value::String(s)) if !s.is_empty() => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => "—".to_string(),
    }
}
fn vbool(v: &Value, key: &str) -> Option<bool> {
    v.get(key).and_then(Value::as_bool)
}
fn vu64(v: &Value, key: &str) -> Option<u64> {
    v.get(key).and_then(Value::as_u64)
}
fn vi64(v: &Value, key: &str) -> Option<i64> {
    v.get(key).and_then(Value::as_i64)
}
fn vf64(v: &Value, key: &str) -> Option<f64> {
    v.get(key).and_then(Value::as_f64)
}
fn obj_arr<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key).and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[])
}
fn as_arr(v: &Value) -> &[Value] {
    v.as_array().map(Vec::as_slice).unwrap_or(&[])
}
fn gib(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / 1024f64.powi(3))
}
fn yn(b: Option<bool>) -> &'static str {
    match b {
        Some(true) => "yes",
        Some(false) => "no",
        None => "—",
    }
}
fn fmt_duration(secs: u64) -> String {
    let (h, m, s) = (secs / 3600, (secs % 3600) / 60, secs % 60);
    if h > 0 {
        format!("{h}h {m}m")
    } else if m > 0 {
        format!("{m}m {s}s")
    } else {
        format!("{s}s")
    }
}
fn pretty_provenance(p: &str) -> &str {
    match p {
        "verified" => "Verified",
        "measured-signal" => "Measured signal",
        "expected-impact" => "Expected impact",
        other => other,
    }
}
fn pretty_source(s: &str) -> &str {
    match s {
        "remote" => "Remote (signed)",
        "cached" => "Cached (last-known-good)",
        _ => "Built-in",
    }
}

/// Pure: assemble the Markdown report from each source's serialized JSON.
pub(crate) fn build_markdown_report(
    hardware: &Value,
    recommendations: &Value,
    trust_ledger: &Value,
    readiness: &Value,
    sessions: &Value,
    rules_source: &str,
    exported_at: &str,
) -> String {
    let mut o = String::new();
    let _ = writeln!(o, "# Compy Report\n");
    let _ = writeln!(
        o,
        "_Exported {} · Compy v{}_\n",
        exported_at,
        env!("CARGO_PKG_VERSION")
    );
    let _ = writeln!(
        o,
        "> Generated locally. Compy collects no telemetry, has no account, and sends nothing \
         off your device. You choose where to share this file.\n"
    );

    // ── Hardware ──
    let _ = writeln!(o, "## Hardware\n");
    let _ = writeln!(
        o,
        "- **CPU:** {} — {} logical / {} physical cores",
        vstr(hardware, "cpu_brand"),
        vu64(hardware, "cpu_cores_logical").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
        vu64(hardware, "cpu_cores_physical").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
    );
    let gpus = obj_arr(hardware, "gpus");
    if gpus.is_empty() {
        let _ = writeln!(o, "- **GPU:** —");
    } else {
        for g in gpus {
            let vram = vu64(g, "vram_bytes").map(gib).unwrap_or_else(|| "—".into());
            let age = vi64(g, "driver_age_days")
                .map(|d| format!("{d}d old"))
                .unwrap_or_else(|| "driver age —".into());
            let _ = writeln!(o, "- **GPU:** {} ({vram} VRAM, {age})", vstr(g, "name"));
        }
    }
    let ram = match (vu64(hardware, "ram_total_bytes"), vu64(hardware, "ram_used_bytes")) {
        (Some(t), Some(u)) => format!("{} ({} used)", gib(t), gib(u)),
        (Some(t), None) => gib(t),
        _ => "—".into(),
    };
    let _ = writeln!(o, "- **RAM:** {ram}");
    let phys = obj_arr(hardware, "physical_disks");
    if !phys.is_empty() {
        for d in phys {
            let size = vu64(d, "size_bytes").map(gib).unwrap_or_else(|| "—".into());
            let _ = writeln!(
                o,
                "- **Storage:** {} — {} / {} ({size})",
                vstr(d, "friendly_name"),
                vstr(d, "media_type"),
                vstr(d, "bus_type"),
            );
        }
    } else {
        // Fallback: MSFT_PhysicalDisk returned nothing — report logical volumes so
        // we don't show "—" when drives clearly exist (drive type unavailable here).
        let logical = obj_arr(hardware, "disks");
        if logical.is_empty() {
            let _ = writeln!(o, "- **Storage:** —");
        } else {
            for d in logical {
                let total = vu64(d, "total_bytes").map(gib).unwrap_or_else(|| "—".into());
                let _ = writeln!(
                    o,
                    "- **Storage:** {} — {} ({total} total, drive type unavailable)",
                    vstr(d, "mount_point"),
                    vstr(d, "file_system"),
                );
            }
        }
    }
    if let Some(disp) = hardware.get("display").filter(|d| !d.is_null()) {
        let hdr = match vbool(disp, "hdr_capable") {
            Some(true) => "HDR-capable",
            _ => "no HDR",
        };
        let _ = writeln!(
            o,
            "- **Display:** {}×{} @ {}/{} Hz · {hdr}",
            vu64(disp, "width").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
            vu64(disp, "height").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
            vu64(disp, "current_refresh_rate_hz").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
            vu64(disp, "max_refresh_rate_hz").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
        );
    } else {
        let _ = writeln!(o, "- **Display:** —");
    }
    let os = hardware
        .get("windows_version")
        .filter(|w| !w.is_null())
        .map(|w| vstr(w, "product_name"))
        .filter(|s| s != "—")
        .unwrap_or_else(|| {
            format!("{} {}", vstr(hardware, "os_name"), vstr(hardware, "os_version"))
        });
    let _ = writeln!(o, "- **OS:** {os}\n");

    // ── Applied-by-Compy set (from the ledger, status applied) ──
    let applied_ids: HashSet<String> = as_arr(trust_ledger)
        .iter()
        .filter(|c| vstr(c, "status") == "applied")
        .map(|c| vstr(c, "rec_id"))
        .collect();

    // ── Recommendations ──
    let recs = as_arr(recommendations);
    let _ = writeln!(o, "## Recommendations ({})\n", recs.len());
    for r in recs {
        let id = vstr(r, "id");
        let kind = if APPLIABLE_REC_IDS.contains(&id.as_str()) {
            "appliable"
        } else {
            "advisory"
        };
        let applied = if applied_ids.contains(&id) {
            " · applied by Compy"
        } else {
            ""
        };
        let _ = writeln!(
            o,
            "- **{}** — _{kind}_ · {} · {} · {} · currently applied: {}{applied}",
            vstr(r, "title"),
            vstr(r, "category"),
            vstr(r, "severity"),
            pretty_provenance(&vstr(r, "provenance")),
            yn(vbool(r, "currently_applied")),
        );
    }
    let _ = writeln!(o);

    // ── Trust Ledger ──
    let ledger = as_arr(trust_ledger);
    let _ = writeln!(o, "## Trust Ledger ({} changes)\n", ledger.len());
    if ledger.is_empty() {
        let _ = writeln!(o, "- No changes applied yet.");
    }
    for c in ledger {
        let status = vstr(c, "status");
        let reverted = status == "applied" && vbool(c, "is_still_active") == Some(false);
        let note = if reverted {
            " · ⚠ no longer active (changed outside Compy)"
        } else {
            ""
        };
        let _ = writeln!(
            o,
            "- **{}** — {status}{note} · {} · ruleset {} · elevation: {}",
            vstr(c, "rec_title"),
            vstr(c, "applied_at"),
            vstr(c, "ruleset_version_at_apply"),
            yn(vbool(c, "elevation_used")),
        );
    }
    let _ = writeln!(o);

    // ── Game Readiness ──
    let _ = writeln!(
        o,
        "## Game Readiness — Ready {} / Attention {} / Unknown {}\n",
        vu64(readiness, "ready_count").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
        vu64(readiness, "attention_count").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
        vu64(readiness, "unknown_count").map(|n| n.to_string()).unwrap_or_else(|| "—".into()),
    );
    let advisory = vstr(readiness, "advisory");
    if advisory != "—" {
        let _ = writeln!(o, "> {advisory}\n");
    }
    for c in obj_arr(readiness, "checks") {
        let val = vstr(c, "value");
        let val_str = if val == "—" { String::new() } else { format!(" — {val}") };
        let _ = writeln!(
            o,
            "- **[{}]** {}{val_str}: {}",
            vstr(c, "status").to_uppercase(),
            vstr(c, "label"),
            vstr(c, "detail"),
        );
    }
    let _ = writeln!(o);

    // ── Sessions ──
    let sess = as_arr(sessions);
    let _ = writeln!(
        o,
        "## Sessions ({}) — live estimates, not benchmark-grade proof\n",
        sess.len()
    );
    if sess.is_empty() {
        let _ = writeln!(o, "- No game sessions recorded yet.");
    }
    for s in sess {
        let dur = vu64(s, "duration_secs").map(fmt_duration).unwrap_or_else(|| "—".into());
        let fps = vf64(s, "avg_fps").map(|n| format!("{n:.1}")).unwrap_or_else(|| "—".into());
        let ft = vf64(s, "avg_frametime_ms").map(|n| format!("{n:.1} ms")).unwrap_or_else(|| "—".into());
        let low = vf64(s, "low1_fps_est").map(|n| format!("{n:.1}")).unwrap_or_else(|| "—".into());
        let gtemp = vu64(s, "peak_gpu_temp_c").map(|n| format!("{n}°C")).unwrap_or_else(|| "—".into());
        let gusage = vu64(s, "peak_gpu_usage_pct").map(|n| format!("{n}%")).unwrap_or_else(|| "—".into());
        let ram = vu64(s, "peak_ram_used_bytes").map(gib).unwrap_or_else(|| "—".into());
        let _ = writeln!(
            o,
            "- **{}** · {dur} · avg {fps} fps · {ft} · 1% low ~{low} · peak GPU {gtemp}/{gusage} · peak RAM {ram}",
            {
                let p = vstr(s, "process_name");
                if p == "—" { "Unknown game".to_string() } else { p }
            },
        );
    }
    let _ = writeln!(o);

    // ── Privacy & safety ──
    let _ = writeln!(o, "## Privacy & safety\n");
    let _ = writeln!(o, "- This report was generated **locally**. Compy sends nothing off your device — no telemetry, no account, no tracking.");
    let _ = writeln!(o, "- You choose where (and whether) to share this file.");
    let _ = writeln!(o, "- Recommendation rules source: **{}**.", pretty_source(rules_source));

    o
}

/// The `.md` file is written with a leading UTF-8 BOM so Windows viewers
/// (Notepad, etc.) decode it as UTF-8 instead of mojibake. The in-app preview
/// stays BOM-free; the JSON export is left BOM-free (JSON parsers may reject a BOM).
fn markdown_with_bom(markdown: &str) -> String {
    format!("\u{FEFF}{markdown}")
}

#[tauri::command]
pub(crate) fn export_report() -> Result<ExportResult, String> {
    let exported_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let hardware = serde_json::to_value(crate::hardware::get_hardware_info()).unwrap_or(Value::Null);
    let recommendations =
        serde_json::to_value(crate::recommendations::get_recommendations()).unwrap_or(Value::Null);
    let trust_ledger =
        serde_json::to_value(crate::history::get_applied_changes()).unwrap_or(Value::Null);
    let readiness =
        serde_json::to_value(crate::readiness::get_game_readiness()).unwrap_or(Value::Null);
    let sessions =
        serde_json::to_value(crate::sessions::get_session_summaries()).unwrap_or(Value::Null);
    let rules_source = crate::recommendations::get_rules_source().to_string();

    let markdown = build_markdown_report(
        &hardware,
        &recommendations,
        &trust_ledger,
        &readiness,
        &sessions,
        &rules_source,
        &exported_at,
    );

    let dir = compy_data_dir().join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create export folder: {e}"))?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let md_path = dir.join(format!("compy-report-{stamp}.md"));
    std::fs::write(&md_path, markdown_with_bom(&markdown))
        .map_err(|e| format!("could not write report: {e}"))?;

    // JSON export comes for free — the assembled source Values + metadata.
    let json_path = dir.join(format!("compy-report-{stamp}.json"));
    let bundle = json!({
        "exported_at": exported_at,
        "compy_version": env!("CARGO_PKG_VERSION"),
        "rules_source": rules_source,
        "hardware": hardware,
        "recommendations": recommendations,
        "trust_ledger": trust_ledger,
        "readiness": readiness,
        "sessions": sessions,
        "privacy": "Local export only. Compy collects no telemetry and has no account.",
    });
    let _ = std::fs::write(
        &json_path,
        serde_json::to_string_pretty(&bundle).unwrap_or_default(),
    );

    Ok(ExportResult {
        path: md_path.to_string_lossy().to_string(),
        json_path: json_path.to_string_lossy().to_string(),
        markdown,
    })
}

#[tauri::command]
pub(crate) fn open_export_folder() -> Result<(), String> {
    let dir = compy_data_dir().join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    // Reveal the folder in Explorer — read-only, no elevation, no UAC.
    std::process::Command::new("explorer")
        .arg(dir.as_os_str())
        .spawn()
        .map_err(|e| format!("could not open folder: {e}"))?;
    Ok(())
}

#[cfg(test)]
mod export_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn markdown_file_is_written_with_utf8_bom() {
        let s = markdown_with_bom("# Compy Report\n");
        assert!(s.starts_with('\u{FEFF}'));
        assert_eq!(&s.as_bytes()[0..3], &[0xEF, 0xBB, 0xBF]); // UTF-8 BOM bytes
        assert!(s.trim_start_matches('\u{FEFF}').starts_with("# Compy Report"));
    }

    #[test]
    fn storage_falls_back_to_logical_disks_when_physical_empty() {
        // physical_disks empty but a logical C: volume present → report it, not "—".
        let hw = json!({
            "physical_disks": [],
            "disks": [{ "mount_point": "C:\\", "total_bytes": 999000000000u64,
                        "available_bytes": 200000000000u64, "file_system": "NTFS" }]
        });
        let md = build_markdown_report(&hw, &json!([]), &json!([]), &json!({}), &json!([]), "embedded", "t");
        assert!(md.contains("C:\\"), "should list the logical volume");
        assert!(md.contains("NTFS"));
        assert!(md.contains("drive type unavailable"));
        assert!(!md.contains("- **Storage:** —"), "must not show the dash when a drive exists");
    }

    #[test]
    fn report_is_graceful_with_empty_data() {
        let md = build_markdown_report(
            &Value::Null,
            &json!([]),
            &json!([]),
            &json!({}),
            &json!([]),
            "embedded",
            "2026-05-31 12:00",
        );
        assert!(md.contains("# Compy Report"));
        assert!(md.contains("## Privacy & safety"));
        assert!(md.contains("no telemetry"));
        assert!(md.contains("—")); // missing values degrade gracefully
        assert!(md.contains("No changes applied yet."));
        assert!(md.contains("No game sessions recorded yet."));
    }

    #[test]
    fn report_includes_session_metrics_labeled_as_estimates() {
        let sessions = json!([{
            "process_name": "game.exe", "duration_secs": 3661, "avg_fps": 120.5,
            "avg_frametime_ms": 8.3, "low1_fps_est": 90.0, "peak_gpu_temp_c": 64,
            "peak_gpu_usage_pct": 99, "peak_ram_used_bytes": 9_000_000_000u64,
            "ram_total_bytes": 32_000_000_000u64, "samples": 100, "started_at": "x",
            "compy_changes_active": 2
        }]);
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &sessions, "embedded", "t");
        assert!(md.contains("game.exe"));
        assert!(md.contains("120.5 fps"));
        assert!(md.contains("64°C"));
        assert!(md.to_lowercase().contains("estimate")); // explicitly labeled
    }

    #[test]
    fn report_includes_applied_changes() {
        let ledger = json!([{
            "rec_id": "game-mode", "rec_title": "Enable Game Mode", "status": "applied",
            "is_still_active": true, "applied_at": "2026-01-01T00:00:00Z",
            "ruleset_version_at_apply": "1.0.0-baseline", "elevation_used": false
        }]);
        let recs = json!([{
            "id": "game-mode", "title": "Enable Game Mode", "category": "Windows",
            "severity": "safe", "currently_applied": true, "provenance": "verified"
        }]);
        let md = build_markdown_report(&Value::Null, &recs, &ledger, &json!({}), &json!([]), "embedded", "t");
        assert!(md.contains("Enable Game Mode"));
        assert!(md.contains("Trust Ledger (1 changes)"));
        assert!(md.contains("applied by Compy")); // cross-referenced from ledger
        assert!(md.contains("_appliable_")); // game-mode is in the appliable set
    }

    #[test]
    fn report_includes_readiness_counts_and_rows() {
        let readiness = json!({
            "ready_count": 5, "attention_count": 2, "unknown_count": 1,
            "advisory": "Readiness checks are advisory.",
            "checks": [{ "id": "monitor-refresh", "label": "Monitor refresh rate",
                         "status": "attention", "detail": "Below max.", "value": "60 / 144 Hz" }]
        });
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &readiness, &json!([]), "embedded", "t");
        assert!(md.contains("Ready 5 / Attention 2 / Unknown 1"));
        assert!(md.contains("Monitor refresh rate"));
        assert!(md.contains("[ATTENTION]"));
    }

    #[test]
    fn report_handles_missing_hardware_fields_gracefully() {
        let hw = json!({ "cpu_brand": "Test CPU", "gpus": [ { "name": "Test GPU" } ] });
        let md = build_markdown_report(&hw, &json!([]), &json!([]), &json!({}), &json!([]), "embedded", "t");
        assert!(md.contains("Test CPU"));
        assert!(md.contains("Test GPU"));
        assert!(md.contains("VRAM, driver age —")); // missing vram/driver age -> dash, no panic
        assert!(md.contains("Built-in")); // rules source prettified
    }
}
