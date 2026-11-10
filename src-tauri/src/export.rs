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
    /// Compact, code-fenced text block for pasting into Discord/forums (copy, not a file).
    discord: String,
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
/// A frame-rate reading when it is one: finite and above zero. The sampler's unknown is 0.
fn measured(v: &Value, key: &str) -> Option<f64> {
    vf64(v, key).filter(|x| x.is_finite() && *x > 0.0)
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
// Each section of the report is its own source Value — the arg list grows with the report, which is
// fine for a single internal assembler.
#[allow(clippy::too_many_arguments)]
pub(crate) fn build_markdown_report(
    hardware: &Value,
    recommendations: &Value,
    trust_ledger: &Value,
    readiness: &Value,
    sessions: &Value,
    diagnostics: &Value,
    rules_source: &str,
    exported_at: &str,
    feedback: Option<&str>,
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
                .map(|d| format!("{d} days old"))
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
    let _ = writeln!(o, "- **OS:** {os}");

    // Network adapters — the detection-evidence inventory (detection-accuracy train). A tester's
    // false-positive (e.g. a VPN's TAP adapter reading as Ethernet) self-identifies right here.
    let adapters = obj_arr(hardware, "network_adapters");
    if adapters.is_empty() {
        let _ = writeln!(o, "- **Network adapters:** (details unavailable)\n");
    } else {
        let _ = writeln!(o, "- **Network adapters:**");
        for a in adapters {
            let physical = a.get("physical").and_then(|v| v.as_bool()).unwrap_or(false);
            let kind = if physical {
                match vstr(a, "medium").as_str() {
                    "wired" => "physical · wired",
                    "wifi" => "physical · Wi-Fi",
                    _ => "physical · other",
                }
            } else {
                "virtual"
            };
            let connected = a.get("connected").and_then(|v| v.as_bool()).unwrap_or(false);
            let state = if connected { "connected" } else { "not connected" };
            let _ = writeln!(o, "  - {} — {kind} · {state}", vstr(a, "name"));
        }
        let _ = writeln!(o);
    }

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
        // P4-show-f1: a session with no reading has no numbers; its 0s mean "not measured".
        if vu64(s, "samples") == Some(0) {
            let _ = writeln!(
                o,
                "- **{}** · {dur} · nothing measured: another window was in front the whole time",
                {
                    let p = vstr(s, "process_name");
                    if p == "—" { "Unknown game".to_string() } else { p }
                },
            );
            continue;
        }
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

    // ── How these measurements were made (methodology + capture capability · Measurement 2.0) ──
    o.push_str(&build_methodology_section(sessions));

    // ── Diagnostics (detection evidence — so a tester's report can self-diagnose every claim) ──
    let _ = writeln!(o, "## Diagnostics\n");
    let diag_sections = as_arr(diagnostics);
    if diag_sections.is_empty() {
        let _ = writeln!(o, "- (none)\n");
    }
    for sec in diag_sections {
        let _ = writeln!(o, "**{}**\n", vstr(sec, "name"));
        for e in obj_arr(sec, "entries") {
            let note = vstr(e, "note");
            if note == "—" {
                let _ = writeln!(o, "- {}: {}", vstr(e, "label"), vstr(e, "value"));
            } else {
                let _ = writeln!(o, "- {}: {} — _{}_", vstr(e, "label"), vstr(e, "value"), note);
            }
        }
        let _ = writeln!(o);
    }

    // ── Upgrade path (R3 Lane B — advisory; ONLY when a verdict already names hardware) ──
    // Same pure source as the in-app block (priorities::build_upgrade_path) — one qualifying
    // logic, one link table; the report renders real Markdown anchors (the user's own browser
    // opens them — no opener-allowlist involvement).
    if let Some(up) = crate::priorities::build_upgrade_path(readiness, sessions) {
        let _ = writeln!(o, "## Upgrade path (advisory)\n");
        for item in &up.items {
            let _ = writeln!(o, "- **{}** — {}", item.title, item.why);
            for l in item.links {
                let _ = writeln!(o, "  - [{} search]({})", l.retailer, l.url);
            }
        }
        let _ = writeln!(o, "\n_{}_\n", up.disclosure);
    }

    // ── Privacy & safety ──
    let _ = writeln!(o, "## Privacy & safety\n");
    let _ = writeln!(o, "- This report was generated **locally**. Compy sends nothing off your device — no telemetry, no account, no tracking.");
    let _ = writeln!(o, "- You choose where (and whether) to share this file.");
    let _ = writeln!(o, "- Recommendation rules source: **{}**.", pretty_source(rules_source));
    let _ = writeln!(o, "\n_{SITE_TAGLINE}_ · {SITE_URL}");

    // ── Tester feedback (optional, user-typed) — only ever what the user wrote; blank appends
    // NOTHING (no empty headers, no pre-fill). Local like the rest: it exists only in this file.
    if let Some(f) = feedback.map(str::trim).filter(|f| !f.is_empty()) {
        let _ = writeln!(o, "\n## Tester feedback\n");
        let _ = writeln!(o, "{f}");
    }

    o
}

/// The methodology + capture-capability section (Measurement Platform 2.0 · Task F / §4). The honest
/// answer to a skeptic's "how were these numbers measured, and what may they be compared to?" — the
/// capture backend that produced the sessions, the metric axes it *genuinely* records, its stated
/// limitations, the methodology version in force, and the comparability rule (only shared metrics,
/// only matching conditions). Pure: it reads the `capture_capabilities` already stamped on each
/// session and fabricates nothing. If no session carries a capability record (all pre-2.0 schema),
/// it says the exact metric set is unknown rather than assuming today's backend — missing stays
/// unknown. No numeric confidence anywhere; language matches `docs/METHODOLOGY.md`.
fn build_methodology_section(sessions: &Value) -> String {
    let mut o = String::new();
    let _ = writeln!(o, "## How these measurements were made\n");

    // The capability record is stamped per session; today every session shares one backend, so the
    // first present record describes the method. A future cross-backend run simply renders per-method
    // instead — but never invents a record for a session that lacks one.
    let caps = as_arr(sessions)
        .iter()
        .find(|s| s.get("capture_capabilities").is_some_and(|c| !c.is_null()))
        .and_then(|s| s.get("capture_capabilities"));

    let Some(c) = caps else {
        let _ = writeln!(
            o,
            "- Frame rate is measured by observing the frames each game submits to Windows — no game \
             code is touched and no overlay is injected (anti-cheat-safe by design)."
        );
        let _ = writeln!(
            o,
            "- These sessions predate the capture-capability record, so the exact metric set they \
             captured is not known and is treated as unknown — never assumed to match today's method."
        );
        let _ = writeln!(
            o,
            "- Sessions are live estimates, not benchmark-grade proof. Two sessions are only \
             comparable when their conditions match; where they differ, direct comparison is limited."
        );
        let _ = writeln!(o);
        return o;
    };

    // Only the metric axes the backend *genuinely* produces — the honest capability table, straight
    // from the persisted record (never hard-coded here, so a future backend's richer set renders
    // truthfully without touching this code).
    let axes: [(&str, &str); 10] = [
        ("supports_app_fps", "frames the game submits (app / submit FPS)"),
        ("supports_presented_fps", "present-completion FPS"),
        ("supports_displayed_fps", "displayed FPS"),
        ("supports_frame_type", "real-vs-generated frame type"),
        ("supports_generated_frames", "frame-generation accounting"),
        ("supports_gpu_busy", "per-frame GPU-busy time"),
        ("supports_display_latency", "display latency"),
        ("supports_input_latency", "input latency"),
        ("supports_dropped_frames", "dropped-frame accounting"),
        ("supports_gpu_telemetry", "capture-backend GPU telemetry"),
    ];
    let supported: Vec<&str> = axes
        .iter()
        .filter(|(k, _)| vbool(c, k) == Some(true))
        .map(|(_, label)| *label)
        .collect();
    let supported_line = if supported.is_empty() {
        "none recorded".to_string()
    } else {
        supported.join(", ")
    };

    let apis: Vec<&str> = c
        .get("graphics_api")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let api_line = if apis.is_empty() { "—".to_string() } else { apis.join(", ") };

    let _ = writeln!(
        o,
        "- **Capture method:** present-event counting via `{}` (capture-method v{}, methodology {}). \
         No game code is touched and no overlay is injected — anti-cheat-safe by design.",
        vstr(c, "backend_id"),
        vstr(c, "backend_version"),
        vstr(c, "methodology_version"),
    );
    let _ = writeln!(o, "- **Graphics APIs observed:** {api_line}.");
    let _ = writeln!(o, "- **Metrics actually captured:** {supported_line}.");

    let limitations: Vec<&str> = c
        .get("limitations")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if !limitations.is_empty() {
        let _ = writeln!(o, "- **Known limitations:**");
        for l in limitations {
            let _ = writeln!(o, "  - {l}");
        }
    }

    let _ = writeln!(
        o,
        "- **Comparing sessions:** only metrics both sessions actually captured are compared, and \
         only when their conditions match (same game, resolution, and capture method). When some \
         conditions changed, direct comparison is limited and Compy says so rather than guessing."
    );
    let _ = writeln!(
        o,
        "- Sessions are live estimates, not benchmark-grade proof — see the full methodology at \
         {SITE_URL}."
    );
    let _ = writeln!(o);
    o
}

/// The `.md` file is written with a leading UTF-8 BOM so Windows viewers
/// (Notepad, etc.) decode it as UTF-8 instead of mojibake. The in-app preview
/// stays BOM-free; the JSON export is left BOM-free (JSON parsers may reject a BOM).
fn markdown_with_bom(markdown: &str) -> String {
    format!("\u{FEFF}{markdown}")
}

/// Where shared artifacts point home (R3 Lane A4). PAIRED with `src/data/site.ts` — the two are
/// one logical constant split across the language boundary; swap BOTH when a real URL exists
/// (swap order per the R3 §3 hosting decision: `https://<project>.pages.dev` first, then
/// `https://compy.gg`). Plain printable text only: nothing in the app ever fetches it.
pub(crate) const SITE_URL: &str = "https://compy.gg";
pub(crate) const SITE_TAGLINE: &str = "Measured, not promised — Compy.";

/// `SITE_URL` without its scheme, for compact one-line footers ("compy.gg").
fn site_host() -> &'static str {
    SITE_URL.trim_start_matches("https://").trim_start_matches("http://")
}

/// A compact, Discord-pasteable summary — wrapped in a code fence so it renders monospace. ~8 lines:
/// rig, readiness verdict, top fix, active changes, last session. Read-only.
fn build_discord_block(
    hardware: &Value,
    readiness: &Value,
    sessions: &Value,
    trust_ledger: &Value,
    exported_at: &str,
) -> String {
    let gpu = obj_arr(hardware, "gpus").first().map(|g| vstr(g, "name")).unwrap_or_else(|| "—".into());
    let cpu = hardware
        .get("cpu_arch")
        .and_then(|a| a.get("family_label"))
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| vstr(hardware, "cpu_brand"));
    let ram_gb = vu64(hardware, "ram_total_bytes")
        .map(|b| (b as f64 / 1024f64.powi(3)).round() as u64)
        .unwrap_or(0);
    let display = hardware
        .get("display")
        .map(|d| {
            let w = vu64(d, "width").unwrap_or(0);
            let h = vu64(d, "height").unwrap_or(0);
            let hz = vu64(d, "current_refresh_rate_hz").unwrap_or(0);
            if w > 0 { format!("{w}x{h}@{hz}") } else { String::new() }
        })
        .unwrap_or_default();
    let ready = vu64(readiness, "ready_count").unwrap_or(0);
    let total = obj_arr(readiness, "checks").len();
    let attention = vu64(readiness, "attention_count").unwrap_or(0);
    let top_fix = obj_arr(readiness, "checks")
        .iter()
        .find(|c| vstr(c, "status") == "attention")
        .map(|c| vstr(c, "label"))
        .unwrap_or_else(|| "nothing — all clear".into());
    let active_changes = as_arr(trust_ledger)
        .iter()
        .filter(|c| vstr(c, "status") == "applied" && vbool(c, "is_still_active") != Some(false))
        .count();

    let mut o = String::new();
    o.push_str("```\n");
    let _ = writeln!(o, "COMPY · {exported_at}");
    let mut rig = format!("rig     · {gpu} · {cpu} · {ram_gb}GB");
    if !display.is_empty() {
        let _ = write!(rig, " · {display}");
    }
    let _ = writeln!(o, "{rig}");
    let _ = writeln!(o, "ready   · {ready}/{total} checks · {attention} need attention");
    let _ = writeln!(o, "top fix · {top_fix}");
    let _ = writeln!(o, "changes · {active_changes} active & reversible");
    // The newest session that measured play, and only readings it measured (codebase review
    // 2026-11-02): a session behind another window the whole time saves 0s that mean "not measured",
    // and printed "0 avg / 0 1% low".
    if let Some(s) = crate::sessions::newest_measured_row(sessions) {
        match (measured(s, "avg_fps"), measured(s, "low1_fps_est")) {
            (Some(avg), Some(low)) => {
                let _ = writeln!(o, "session · {} · {avg:.0} avg / {low:.0} 1% low", vstr(s, "process_name"));
            }
            (Some(avg), None) => {
                let _ = writeln!(o, "session · {} · {avg:.0} avg", vstr(s, "process_name"));
            }
            _ => {}
        }
    }
    let _ = writeln!(o, "measured, not promised · {}", site_host());
    o.push_str("```");
    o
}

/// Pure: the Consumer projection — the SAME already-gathered sources as the technical report,
/// re-rendered as plain English for someone who will never read a probe table (evidence-export
/// tiers, P2). Presentation-only by construction: it receives the same serialized Values the
/// technical render receives, invents nothing, and degrades by OMITTING a line whose source field
/// is missing — a "—" placeholder is technical furniture, and a consumer render that prints one
/// is asserting a reading it doesn't have. The "Anything to look at?" section only lists checks
/// the machine actually flagged (earned framing, DIR-1a): zero flagged says so plainly, and a
/// readiness pack with no counts is reported as not-yet-checked, never assumed clean.
pub(crate) fn build_consumer_report(
    hardware: &Value,
    trust_ledger: &Value,
    readiness: &Value,
    sessions: &Value,
    exported_at: &str,
    feedback: Option<&str>,
) -> String {
    let mut o = String::new();
    let _ = writeln!(o, "# Your Compy report\n");
    let _ = writeln!(o, "_Exported {} · Compy v{}_\n", exported_at, env!("CARGO_PKG_VERSION"));
    let _ = writeln!(
        o,
        "> Generated locally. Compy collects no telemetry, has no account, and sends nothing \
         off your device. You choose where to share this file.\n"
    );

    // ── Your PC ── (plain names only; a missing reading is omitted, never dashed)
    let _ = writeln!(o, "## Your PC\n");
    let mut wrote_hw = false;
    let cpu = vstr(hardware, "cpu_brand");
    if cpu != "—" {
        let _ = writeln!(o, "- **Processor:** {cpu}");
        wrote_hw = true;
    }
    for g in obj_arr(hardware, "gpus") {
        let name = vstr(g, "name");
        if name != "—" {
            let _ = writeln!(o, "- **Graphics card:** {name}");
            wrote_hw = true;
        }
    }
    if let Some(t) = vu64(hardware, "ram_total_bytes") {
        let _ = writeln!(o, "- **Memory:** {}", gib(t));
        wrote_hw = true;
    }
    let os = hardware
        .get("windows_version")
        .filter(|w| !w.is_null())
        .map(|w| vstr(w, "product_name"))
        .filter(|s| s != "—");
    if let Some(os) = os {
        let _ = writeln!(o, "- **Windows:** {os}");
        wrote_hw = true;
    }
    if !wrote_hw {
        let _ = writeln!(o, "Compy could not read this PC's hardware details.");
    }
    let _ = writeln!(o);

    // ── What Compy has changed ── (the ledger, in plain words; the undo door named)
    let _ = writeln!(o, "## What Compy has changed\n");
    let ledger = as_arr(trust_ledger);
    let applied: Vec<&Value> = ledger.iter().filter(|c| vstr(c, "status") == "applied").collect();
    if applied.is_empty() {
        let _ = writeln!(o, "Compy has not changed anything on this PC yet.");
    } else {
        let active = applied
            .iter()
            .filter(|c| vbool(c, "is_still_active") != Some(false))
            .count();
        let s = if active == 1 { "change" } else { "changes" };
        let _ = writeln!(
            o,
            "{active} {s} made by Compy {} active right now. Every change Compy makes can be \
             undone from the History room.\n",
            if active == 1 { "is" } else { "are" },
        );
        for c in &applied {
            let title = vstr(c, "rec_title");
            if vbool(c, "is_still_active") == Some(false) {
                let _ = writeln!(
                    o,
                    "- **{title}** — Compy applied this, but something outside Compy has since \
                     changed it."
                );
            } else {
                let when = vstr(c, "applied_at");
                if when == "—" {
                    let _ = writeln!(o, "- **{title}**");
                } else {
                    let _ = writeln!(o, "- **{title}** — applied {when}");
                }
            }
        }
    }
    let _ = writeln!(o);

    // ── What Compy measured ── (live readings, honestly labelled; no reading → no sentence)
    let _ = writeln!(o, "## What Compy measured\n");
    let sess = as_arr(sessions);
    if sess.is_empty() {
        let _ = writeln!(o, "No gaming sessions have been measured yet.");
    } else {
        let n = sess.len();
        let s = if n == 1 { "session" } else { "sessions" };
        let _ = writeln!(
            o,
            "Compy watched {n} gaming {s}. These are live readings from your own play, not lab \
             benchmarks."
        );
        // The newest session that measured play, as the Discord block reads it.
        if let Some(latest) = crate::sessions::newest_measured_row(sessions) {
            if let Some(fps) = measured(latest, "avg_fps") {
                let game = {
                    let p = vstr(latest, "process_name");
                    if p == "—" { "a game".to_string() } else { p }
                };
                let dur = vu64(latest, "duration_secs")
                    .map(|d| format!(" over {}", fmt_duration(d)))
                    .unwrap_or_default();
                let _ = writeln!(
                    o,
                    "- Most recent: **{game}** — about {fps:.0} frames per second{dur}."
                );
            }
        }
    }
    let _ = writeln!(o);

    // ── Anything to look at? ── (only what the machine flagged; unknown stays unknown)
    let _ = writeln!(o, "## Anything to look at?\n");
    match vu64(readiness, "attention_count") {
        None => {
            let _ = writeln!(o, "This PC's readiness has not been checked yet.");
        }
        Some(0) => {
            let _ = writeln!(o, "Nothing on this PC is flagged right now.");
        }
        Some(n) => {
            let s = if n == 1 { "thing" } else { "things" };
            let _ = writeln!(o, "Compy's checks flagged {n} {s}:\n");
            for c in obj_arr(readiness, "checks") {
                if vstr(c, "status") == "attention" {
                    let label = vstr(c, "label");
                    let detail = vstr(c, "detail");
                    if detail == "—" {
                        let _ = writeln!(o, "- **{label}**");
                    } else {
                        let _ = writeln!(o, "- **{label}** — {detail}");
                    }
                }
            }
        }
    }
    let _ = writeln!(o);

    // ── Privacy & safety ── (the same vetted sentences as the technical report — one claim, reused)
    let _ = writeln!(o, "## Privacy & safety\n");
    let _ = writeln!(o, "- This report was generated **locally**. Compy sends nothing off your device — no telemetry, no account, no tracking.");
    let _ = writeln!(o, "- You choose where (and whether) to share this file.");
    let _ = writeln!(o, "\n_{SITE_TAGLINE}_ · {SITE_URL}");

    if let Some(f) = feedback.map(str::trim).filter(|f| !f.is_empty()) {
        let _ = writeln!(o, "\n## Your note\n");
        let _ = writeln!(o, "{f}");
    }

    o
}

/// Webview-boundary cap for the user-typed feedback (defense-in-depth, same posture as the
/// receipt-title cap): three short answers fit comfortably; a compromised webview can't bloat
/// the report/memory with an unbounded string. Char-boundary safe.
const FEEDBACK_MAX_CHARS: usize = 4000;
fn cap_feedback(feedback: Option<String>) -> Option<String> {
    feedback.map(|f| f.chars().take(FEEDBACK_MAX_CHARS).collect())
}

// The window reaches this through `off_main::export_report` (lib.rs), off the main thread.
pub(crate) fn export_report(
    feedback: Option<String>,
    tier: Option<String>,
) -> Result<ExportResult, String> {
    // Evidence-export tiers (P2): one data source, audience-shaped renders. Absent/technical →
    // the full report (back-compat: every pre-tier caller keeps its exact behaviour); consumer →
    // the plain-English projection. Anything else is a caller bug, refused not guessed.
    let consumer = match tier.as_deref() {
        None | Some("technical") => false,
        Some("consumer") => true,
        Some(other) => {
            return Err(format!(
                "unknown report tier \"{other}\" — expected consumer or technical"
            ))
        }
    };
    let feedback = cap_feedback(feedback);
    let exported_at = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let mut hardware = serde_json::to_value(crate::hardware::get_hardware_info()).unwrap_or(Value::Null);
    let recommendations =
        serde_json::to_value(crate::recommendations::get_recommendations()).unwrap_or(Value::Null);
    let trust_ledger =
        serde_json::to_value(crate::history::get_applied_changes()).unwrap_or(Value::Null);
    let readiness =
        serde_json::to_value(crate::readiness::get_game_readiness()).unwrap_or(Value::Null);
    let sessions =
        serde_json::to_value(crate::sessions::get_session_summaries()).unwrap_or(Value::Null);
    let diagnostics =
        serde_json::to_value(crate::diagnostics::get_diagnostics()).unwrap_or(Value::Null);
    let rules_source = crate::recommendations::get_rules_source().to_string();

    let markdown = if consumer {
        build_consumer_report(
            &hardware,
            &trust_ledger,
            &readiness,
            &sessions,
            &exported_at,
            feedback.as_deref(),
        )
    } else {
        build_markdown_report(
            &hardware,
            &recommendations,
            &trust_ledger,
            &readiness,
            &sessions,
            &diagnostics,
            &rules_source,
            &exported_at,
            feedback.as_deref(),
        )
    };
    // Built before the JSON bundle below moves the source Values.
    let discord = build_discord_block(&hardware, &readiness, &sessions, &trust_ledger, &exported_at);

    let dir = compy_data_dir().join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create export folder: {e}"))?;
    // Millisecond granularity (%3f, no leading dot) so two exports within the same second don't
    // collide on the filename and silently overwrite the earlier report.
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S%3f");
    // Distinct names so a support conversation can tell at a glance which projection it was sent.
    let md_name = if consumer {
        format!("compy-report-plain-{stamp}.md")
    } else {
        format!("compy-report-{stamp}.md")
    };
    let md_path = dir.join(md_name);
    std::fs::write(&md_path, markdown_with_bom(&markdown))
        .map_err(|e| format!("could not write report: {e}"))?;

    // Redact the machine hostname from the shareable JSON. It's identity-adjacent (a hostname is
    // very often the owner's real name), the markdown/Discord reports never surfaced it, and an
    // export exists to be pasted in public ("receipts"). Everything else in `hardware` is
    // model/spec, not identity. Safe to mutate here: the markdown + discord builders above already
    // ran against the full value.
    if let Some(obj) = hardware.as_object_mut() {
        obj.remove("hostname");
    }

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
        "diagnostics": diagnostics,
        "privacy": "Local export only. Compy collects no telemetry and has no account.",
    });
    let json_body = serde_json::to_string_pretty(&bundle).map_err(|e| format!("could not build JSON report: {e}"))?;
    std::fs::write(&json_path, json_body)
        .map_err(|e| format!("could not write JSON report: {e}"))?;

    Ok(ExportResult {
        path: md_path.to_string_lossy().to_string(),
        json_path: json_path.to_string_lossy().to_string(),
        markdown,
        discord,
    })
}

#[tauri::command]
pub(crate) fn open_export_folder() -> Result<(), String> {
    let dir = compy_data_dir().join("exports");
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not open the export folder: {e}"))?;
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

    // ── Consumer projection (evidence-export tiers, P2) ─────────────────────────────────────────

    #[test]
    fn consumer_report_renders_the_same_sources_in_plain_english() {
        let hw = json!({
            "cpu_brand": "AMD Ryzen 7 7800X3D",
            "gpus": [{ "name": "Radeon RX 9070 XT" }],
            "ram_total_bytes": 32u64 * 1024 * 1024 * 1024,
            "windows_version": { "product_name": "Windows 11 Home" }
        });
        let ledger = json!([
            { "rec_id": "a", "rec_title": "Turn off Xbox Game DVR", "status": "applied",
              "applied_at": "2026-08-01", "is_still_active": true },
            { "rec_id": "b", "rec_title": "High performance power plan", "status": "applied",
              "applied_at": "2026-08-02", "is_still_active": false }
        ]);
        let readiness = json!({ "attention_count": 1, "checks": [
            { "status": "attention", "label": "Game install drive", "detail": "HDD detected" },
            { "status": "ready", "label": "GPU driver", "detail": "up to date" }
        ]});
        let sessions = json!([{ "process_name": "diablo4.exe", "avg_fps": 143.7,
                                "duration_secs": 3600u64 }]);
        let md = build_consumer_report(&hw, &ledger, &readiness, &sessions, "t", None);
        assert!(md.contains("## Your PC"));
        assert!(md.contains("Radeon RX 9070 XT"));
        assert!(md.contains("1 change made by Compy is active right now"), "{md}");
        assert!(md.contains("undone from the History room"));
        assert!(md.contains("something outside Compy has since changed it"), "inactive row stays honest");
        assert!(md.contains("about 144 frames per second over 1h 0m"), "{md}");
        assert!(md.contains("not lab benchmarks"), "measurement honesty line always rides along");
        assert!(md.contains("**Game install drive** — HDD detected"));
        assert!(!md.contains("GPU driver"), "only flagged checks render — ready ones are not 'to look at'");
        assert!(md.contains(SITE_TAGLINE) && md.contains(SITE_URL), "shared footer");
    }

    #[test]
    fn consumer_report_degrades_by_omission_never_by_dash() {
        // Empty everything: every section states its true empty case, and the technical "—"
        // placeholder never appears — a consumer render must not assert readings it doesn't have.
        let md = build_consumer_report(&Value::Null, &json!([]), &json!({}), &json!([]), "t", None);
        assert!(md.contains("could not read this PC's hardware details"));
        assert!(md.contains("Compy has not changed anything on this PC yet."));
        assert!(md.contains("No gaming sessions have been measured yet."));
        assert!(md.contains("readiness has not been checked yet"), "no counts → unknown, never assumed clean");
        // The em-dash is legal as a separator with words on both sides; a BARE "—" standing in
        // for a missing value is the technical placeholder this render bans.
        for line in md.lines() {
            let l = line.trim_end();
            assert!(!l.ends_with('—') && !l.contains(": —") && !l.contains("** — ·"),
                "dash placeholder leaked into consumer render: {line}");
        }
    }

    #[test]
    fn consumer_report_flagging_is_earned() {
        // DIR-1a for exports: zero flagged says so plainly; a flag renders only when the machine
        // actually raised one.
        let clean = json!({ "attention_count": 0, "checks": [] });
        let md = build_consumer_report(&Value::Null, &json!([]), &clean, &json!([]), "t", None);
        assert!(md.contains("Nothing on this PC is flagged right now."));
        assert!(!md.contains("flagged 0"), "never a scary zero-count sentence");
    }

    #[test]
    fn consumer_report_omits_fps_sentence_without_a_measurement() {
        // A session row with no avg_fps must not produce a frames-per-second claim.
        let sessions = json!([{ "process_name": "game.exe" }]);
        let md = build_consumer_report(&Value::Null, &json!([]), &json!({}), &sessions, "t", None);
        assert!(md.contains("Compy watched 1 gaming session"));
        assert!(!md.contains("frames per second"), "no measurement, no number");
    }

    // Codebase review 2026-11-02: a session behind another window the whole time saves 0s that mean
    // "not measured", and both blocks printed them as readings ("0 avg / 0 1% low", "about 0 frames
    // per second"). They read the newest session that measured play instead, and print nothing when
    // none did.
    #[test]
    fn an_unmeasured_session_never_prints_as_a_reading() {
        let behind = json!({ "process_name": "new.exe", "samples": 0, "avg_fps": 0.0, "low1_fps_est": 0.0 });
        let played = json!({ "process_name": "old.exe", "samples": 900, "avg_fps": 141.0, "low1_fps_est": 98.0 });
        let both = json!([behind.clone(), played]);
        let md = build_consumer_report(&Value::Null, &json!([]), &json!({}), &both, "t", None);
        assert!(md.contains("about 141 frames per second"), "{md}");
        assert!(!md.contains("about 0 frames"), "{md}");
        let card = build_discord_block(&Value::Null, &json!({}), &both, &json!([]), "t");
        assert!(card.contains("session · old.exe · 141 avg / 98 1% low"), "{card}");
        let only = json!([behind]);
        let md = build_consumer_report(&Value::Null, &json!([]), &json!({}), &only, "t", None);
        assert!(!md.contains("frames per second"), "{md}");
        let card = build_discord_block(&Value::Null, &json!({}), &only, &json!([]), "t");
        assert!(!card.contains("session ·"), "{card}");
    }

    #[test]
    fn consumer_report_carries_the_users_note_and_blank_appends_nothing() {
        let with = build_consumer_report(&Value::Null, &json!([]), &json!({}), &json!([]), "t", Some("coil whine"));
        assert!(with.contains("## Your note") && with.contains("coil whine"));
        let blank = build_consumer_report(&Value::Null, &json!([]), &json!({}), &json!([]), "t", Some("   "));
        assert!(!blank.contains("## Your note"), "blank note appends no empty header");
    }

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
        let md = build_markdown_report(&hw, &json!([]), &json!([]), &json!({}), &json!([]), &json!([]), "embedded", "t", None);
        assert!(md.contains("C:\\"), "should list the logical volume");
        assert!(md.contains("NTFS"));
        assert!(md.contains("drive type unavailable"));
        assert!(!md.contains("- **Storage:** —"), "must not show the dash when a drive exists");
    }

    #[test]
    fn upgrade_path_renders_as_anchors_only_when_hardware_is_named() {
        // R3 Lane B: a GPU-limited session puts the advisory block + disclosure + real Markdown
        // anchors in the report; without a qualifying verdict the section is entirely absent.
        let sessions = json!([{ "peak_gpu_usage_pct": 98, "gpu_load": { "readings": 900, "busy": 800 }, "avg_fps": 120.0, "low1_fps_est": 100.0 }]);
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &sessions, &json!([]), "embedded", "t", None);
        assert!(md.contains("## Upgrade path (advisory)"));
        assert!(md.contains("never affects verdicts"), "disclosure always renders with the links");
        assert!(md.contains("](https://www.amazon.com/s?k=graphics+card)"), "real anchor");
        let none = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &json!([]), &json!([]), "embedded", "t", None);
        assert!(!none.contains("Upgrade path"), "no hardware verdict → no links, no section");
    }

    #[test]
    fn upgrade_path_anchor_format_holds_for_every_link_in_the_table() {
        // A6 close-out: the anchors themselves, independently tested. With BOTH qualifying
        // verdicts present (GPU-limited session + install-drive HDD attention), every RetailLink
        // build_upgrade_path returns must render as a well-formed `- [<retailer> search](<url>)`
        // Markdown anchor — same count (none dropped or duplicated), https-only, and free of
        // affiliate/tracking markers at the EXPORT layer (mirrors the priorities-side guard so a
        // rendering regression can't reintroduce what the table-side guard already bans).
        let sessions = json!([{ "peak_gpu_usage_pct": 97, "gpu_load": { "readings": 900, "busy": 700 }, "avg_fps": 90.0, "low1_fps_est": 70.0 }]);
        let readiness = json!({ "checks": [
            { "id": "install-drive", "status": "attention", "label": "Game install drive",
              "detail": "HDD detected" }
        ]});
        let up = crate::priorities::build_upgrade_path(&readiness, &sessions)
            .expect("both qualifying verdicts must produce an upgrade path");
        let expected: Vec<(&str, &str)> = up
            .items
            .iter()
            .flat_map(|i| i.links.iter().map(|l| (l.retailer, l.url)))
            .collect();
        assert!(expected.len() >= 4, "test premise: both link tables in play");

        let md = build_markdown_report(
            &Value::Null, &json!([]), &json!([]), &readiness, &sessions, &json!([]),
            "embedded", "t", None,
        );
        let anchors: Vec<&str> = md
            .lines()
            .map(str::trim_start)
            .filter(|l| l.starts_with("- [") && l.contains(" search]("))
            .collect();
        assert_eq!(
            anchors.len(),
            expected.len(),
            "every table link renders exactly once as an anchor"
        );
        for (retailer, url) in expected {
            let anchor = format!("- [{retailer} search]({url})");
            assert!(md.contains(&anchor), "missing/malformed anchor: {anchor}");
            assert!(url.starts_with("https://"), "https-only: {url}");
            for marker in ["tag=", "ref=", "affid", "affiliate", "utm_", "clickid", "irclick"] {
                assert!(
                    !url.to_ascii_lowercase().contains(marker),
                    "tracking marker `{marker}` in exported URL: {url}"
                );
            }
        }
        // Well-formed anchors only: no stray `](` outside a closed `[...](...)` pair on the line.
        for a in anchors {
            let open = a.matches('[').count();
            let close = a.matches(']').count();
            let parens = a.matches("](").count();
            assert!(
                open == 1 && close == 1 && parens == 1 && a.ends_with(')'),
                "anchor line not well-formed Markdown: {a}"
            );
        }
    }

    #[test]
    fn shared_artifacts_carry_the_site_footer() {
        // R3 Lane A4: the full report and the summary card both point home via the paired
        // SITE_URL/SITE_TAGLINE constants (one logical constant with src/data/site.ts).
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &json!([]), &json!([]), "embedded", "t", None);
        assert!(md.contains(SITE_TAGLINE), "report footer carries the tagline");
        assert!(md.contains(SITE_URL), "report footer carries the site URL");
        let card = build_discord_block(&Value::Null, &json!({}), &json!([]), &json!([]), "t");
        assert!(card.contains("measured, not promised"), "card carries the tagline line");
        assert!(card.contains(site_host()), "card carries the bare host");
        assert!(card.trim_end().ends_with("```"), "card stays a closed code fence");
    }

    #[test]
    fn report_is_graceful_with_empty_data() {
        let md = build_markdown_report(
            &Value::Null,
            &json!([]),
            &json!([]),
            &json!({}),
            &json!([]),
            &json!([]),
            "embedded",
            "2026-05-31 12:00",
            None,
        );
        assert!(md.contains("# Compy Report"));
        assert!(md.contains("## Privacy & safety"));
        assert!(md.contains("no telemetry"));
        assert!(md.contains("—")); // missing values degrade gracefully
        assert!(md.contains("No changes applied yet."));
        assert!(md.contains("No game sessions recorded yet."));
    }

    #[test]
    fn a_session_with_no_reading_is_listed_without_numbers() {
        let sessions = json!([{ "process_name": "game.exe", "duration_secs": 900, "samples": 0,
            "avg_fps": 0.0, "avg_frametime_ms": 0.0, "low1_fps_est": 0.0, "background_secs_excluded": 880 }]);
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &sessions, &json!([]), "embedded", "2026-10-25 12:00", None);
        let line = md.lines().find(|l| l.starts_with("- **game.exe**")).expect("listed");
        assert!(line.contains("another window was in front the whole time") && !line.contains("fps"), "{line}");
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
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &sessions, &json!([]), "embedded", "t", None);
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
        let md = build_markdown_report(&Value::Null, &recs, &ledger, &json!({}), &json!([]), &json!([]), "embedded", "t", None);
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
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &readiness, &json!([]), &json!([]), "embedded", "t", None);
        assert!(md.contains("Ready 5 / Attention 2 / Unknown 1"));
        assert!(md.contains("Monitor refresh rate"));
        assert!(md.contains("[ATTENTION]"));
    }

    #[test]
    fn methodology_section_renders_the_real_capture_capabilities() {
        // Task F / §4: a session stamped with the production capability record produces an honest
        // "How these measurements were made" section — the real backend id/version/methodology, the
        // graphics APIs it can observe, ONLY the metric axes it truly captures, its stated
        // limitations, and the comparability rule. No fabricated capability, no numeric confidence.
        let caps = serde_json::to_value(crate::capture::CaptureCapabilities::etw_dxgi(Some(
            "2026-07-18T00:00:00Z".to_string(),
        )))
        .unwrap();
        let sessions = json!([{
            "process_name": "game.exe", "avg_fps": 120.0, "low1_fps_est": 90.0,
            "started_at": "2026-07-18T00:00:00Z", "capture_capabilities": caps
        }]);
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &sessions, &json!([]), "embedded", "t", None);

        assert!(md.contains("## How these measurements were made"));
        assert!(md.contains("etw-dxgi"), "the real backend id, straight from the record");
        assert!(md.contains("methodology 2026-07-16"), "the methodology version in force");
        // ONLY app/submit FPS is captured by the ETW-DXGI helper — the richer axes must NOT appear
        // as captured metrics.
        let cap_line = md
            .lines()
            .find(|l| l.contains("Metrics actually captured:"))
            .expect("captured-metrics line present");
        assert!(cap_line.contains("app / submit FPS"));
        assert!(!cap_line.contains("display latency"), "must not claim an axis it never captures");
        assert!(!cap_line.contains("GPU-busy"));
        // Honest limitations surfaced; comparability rule stated in product language.
        assert!(md.contains("Vulkan and OpenGL"), "the DXGI blind-spot caveat is carried through");
        assert!(md.contains("only when their conditions match"));
        assert!(md.to_lowercase().contains("direct comparison is limited"));
        // Anti-fabrication: no numeric confidence / score anywhere in the section.
        let section = &md[md.find("## How these measurements").unwrap()..];
        let section = &section[..section.find("## Diagnostics").unwrap_or(section.len())];
        for banned in ["% confidence", "confidence:", "score", "%bottleneck", "% bottleneck"] {
            assert!(
                !section.to_lowercase().contains(banned),
                "methodology section must carry no numeric confidence/score: found `{banned}`"
            );
        }
    }

    #[test]
    fn methodology_section_is_honest_when_sessions_predate_the_capability_record() {
        // Old-schema guard: a session with NO capture_capabilities (pre-2.0) must not be assumed to
        // match today's backend — the section says the metric set is unknown, and still states the
        // comparability limit. Missing stays unknown.
        let sessions = json!([{ "process_name": "old.exe", "avg_fps": 100.0, "started_at": "x" }]);
        let md = build_markdown_report(&Value::Null, &json!([]), &json!([]), &json!({}), &sessions, &json!([]), "embedded", "t", None);
        assert!(md.contains("## How these measurements were made"));
        assert!(
            md.contains("predate the capture-capability record"),
            "old sessions are flagged as unknown, not backfilled with today's method"
        );
        assert!(!md.contains("etw-dxgi"), "must not invent a backend id the session never had");
        assert!(md.to_lowercase().contains("direct comparison is limited"));
    }

    #[test]
    fn unicode_titles_and_feedback_round_trip_unmangled() {
        // Edge (R2-4): real tester data is multi-byte (accents, CJK, emoji) — the report and the
        // BOM-prefixed file form must carry it unmangled, alongside the feedback section.
        let recs = json!([{ "id": "x", "title": "Émoji ✨ tweak — テスト", "category": "c",
                            "severity": "safe", "currently_applied": false, "provenance": "verified" }]);
        let md = build_markdown_report(
            &Value::Null, &recs, &json!([]), &json!({}), &json!([]), &json!([]),
            "embedded", "t", Some("multi-byte answer: déjà vu ✓"),
        );
        assert!(md.contains("Émoji ✨ tweak — テスト"));
        assert!(md.contains("déjà vu ✓"));
        let bom = markdown_with_bom(&md);
        assert!(
            bom.trim_start_matches('\u{FEFF}').contains("## Tester feedback"),
            "BOM and the feedback section coexist"
        );
    }

    #[test]
    fn tester_feedback_section_appears_when_provided() {
        let md = build_markdown_report(
            &Value::Null, &json!([]), &json!([]), &json!({}), &json!([]), &json!([]),
            "embedded", "t", Some("**In one sentence:** my rig's safety net"),
        );
        assert!(md.contains("## Tester feedback"));
        assert!(md.contains("my rig's safety net"));
        // The section lands at the END — after Privacy & safety.
        let fb = md.rfind("## Tester feedback").unwrap();
        let privacy = md.rfind("## Privacy & safety").unwrap();
        assert!(fb > privacy, "feedback must follow the privacy section");
    }

    #[test]
    fn feedback_is_capped_at_the_webview_boundary() {
        let huge = "x".repeat(FEEDBACK_MAX_CHARS * 3);
        let capped = cap_feedback(Some(huge)).unwrap();
        assert_eq!(capped.chars().count(), FEEDBACK_MAX_CHARS);
        assert_eq!(cap_feedback(None), None);
        // Multi-byte input truncates on a char boundary (no panic, no broken UTF-8).
        let multi = "é".repeat(FEEDBACK_MAX_CHARS + 5);
        assert_eq!(cap_feedback(Some(multi)).unwrap().chars().count(), FEEDBACK_MAX_CHARS);
    }

    #[test]
    fn no_feedback_section_when_none_or_blank() {
        let none = build_markdown_report(
            &Value::Null, &json!([]), &json!([]), &json!({}), &json!([]), &json!([]),
            "embedded", "t", None,
        );
        assert!(!none.contains("Tester feedback"), "None must add no header");
        let blank = build_markdown_report(
            &Value::Null, &json!([]), &json!([]), &json!({}), &json!([]), &json!([]),
            "embedded", "t", Some("   \n\t  "),
        );
        assert!(!blank.contains("Tester feedback"), "whitespace-only must add no empty section");
    }

    #[test]
    fn report_handles_missing_hardware_fields_gracefully() {
        let hw = json!({ "cpu_brand": "Test CPU", "gpus": [ { "name": "Test GPU" } ] });
        let md = build_markdown_report(&hw, &json!([]), &json!([]), &json!({}), &json!([]), &json!([]), "embedded", "t", None);
        assert!(md.contains("Test CPU"));
        assert!(md.contains("Test GPU"));
        assert!(md.contains("VRAM, driver age —")); // missing vram/driver age -> dash, no panic
        assert!(md.contains("Built-in")); // rules source prettified
    }
}
