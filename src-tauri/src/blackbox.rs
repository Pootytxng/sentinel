//! Black Box v1 (Paramedic Mode): a READ-ONLY crash/freeze evidence reader.
//!
//! Spec: docs/superpowers/specs/2026-06-13-black-box-v1.md. Black Box reads the crash/freeze
//! evidence Windows ALREADY records (Event Log), overlays Compy's own pre-crash "last vitals"
//! from `sessions.rs`, and presents each incident in plain English.
//!
//! **v1 makes ZERO causal claims and prescribes ZERO fixes** — it reports recorded evidence only.
//! A TDR event *says* "the display driver stopped responding" → reporting that is translation, not
//! diagnosis. Probable-cause + fixes are v2 (evidence-gated, separate spec).
//!
//! HARD LINES held here: read-only (no mutation, `actions.rs` untouched, no rollback contract) ·
//! no kernel driver / no game injection (every source is a user-mode OS log read; never touches a
//! running game) · zero outbound network · no fabricated/unmeasured claims (if Windows recorded
//! nothing, say so; if Compy wasn't monitoring, say "no vitals" — never invent either) · honest
//! about elevation (a source we can't read non-elevated is reported as *skipped*, never errored or
//! faked) · plain language (raw IDs live behind the receipt) · on-demand only (no background watcher).
//!
//! Shape: a **pure core** (`classify_incident` / `correlate_vitals` / phrasing) with unit tests,
//! plus a **thin Windows collector** (one read-only `Get-WinEvent` call + a `\Minidump`
//! access probe) isolated at the edge — mirrors `sessions.rs`/`diagnostics.rs`.

use chrono::{DateTime, FixedOffset, Utc};
use serde::Serialize;

use crate::sessions::SessionSummary;

/// Newest N incidents shown (spec cap).
const MAX_INCIDENTS: usize = 25;
/// A crash often lands just as the game stops presenting; allow this much slack after a session's
/// recorded end before we stop calling it "during that session". Conservative — never invents a
/// session, only widens the match window slightly.
const VITALS_GRACE_SECS: i64 = 90;

// ─── Typed incident families (the only ones v1 recognizes) ─────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum IncidentKind {
    GpuTimeout,         // Display 4101 — driver stopped responding + recovered (TDR)
    AppCrash,           // Application Error 1000
    AppHang,            // Application Hang 1002
    UnexpectedShutdown, // Kernel-Power 41 — hard lock / power loss / freeze (no crash report)
    BlueScreen,         // BugCheck 1001 — BSOD
    HardwareError,      // WHEA-Logger 17/18/19 — machine-check (thermal/power/RAM/PCIe)
}

impl IncidentKind {
    /// Neutral evidence tag (spec output) — describes the recorded signal, claims no cause.
    fn tag(self) -> &'static str {
        match self {
            IncidentKind::GpuTimeout => "GPU timeout",
            IncidentKind::AppCrash => "App crash",
            IncidentKind::AppHang => "App hang",
            IncidentKind::UnexpectedShutdown => "Unexpected shutdown / hard freeze",
            IncidentKind::BlueScreen => "Blue screen",
            IncidentKind::HardwareError => "Hardware-logged error",
        }
    }
}

/// Pure classifier: map an over-fetched event's (provider, id) to a known incident family, or
/// `None` for an event we pulled by ID but don't recognize (e.g. an id 1000 from a non-crash
/// provider). Provider matching is substring-tolerant — `Get-WinEvent` reports the full provider
/// name (e.g. "Microsoft-Windows-Kernel-Power").
pub(crate) fn classify_incident(provider: &str, event_id: u32) -> Option<IncidentKind> {
    let p = provider.to_ascii_lowercase();
    match event_id {
        41 if p.contains("kernel-power") => Some(IncidentKind::UnexpectedShutdown),
        1001 if p.contains("bugcheck") || p.contains("systemerrorreporting") => {
            Some(IncidentKind::BlueScreen)
        }
        17..=19 if p.contains("whea") => Some(IncidentKind::HardwareError),
        4101 if p.contains("display") => Some(IncidentKind::GpuTimeout),
        1000 if p.contains("application error") => Some(IncidentKind::AppCrash),
        1002 if p.contains("application hang") => Some(IncidentKind::AppHang),
        _ => None,
    }
}

// ─── Serialized output (typed, serde → TS) ─────────────────────────────────

/// Compy's own pre-crash telemetry for the session that overlapped a crash. Absent (`None` at the
/// incident level) when no session window contained the crash — never fabricated.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct LastVitals {
    pub(crate) session_started_at: String,
    pub(crate) game: Option<String>,
    pub(crate) peak_gpu_temp_c: Option<u32>,
    pub(crate) peak_gpu_usage_pct: Option<u32>,
    pub(crate) avg_frametime_ms: f64,
    pub(crate) low1_fps_est: f64,
    /// Plain-English strip built only from fields that were actually recorded.
    pub(crate) summary: String,
}

/// Raw evidence — lives behind the "show the receipt" expander only.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Receipt {
    pub(crate) source: String, // e.g. "System log · Display 4101"
    pub(crate) event_ids: Vec<u32>,
    pub(crate) faulting_app: Option<String>,
    pub(crate) faulting_module: Option<String>,
    pub(crate) code: Option<String>, // exception or bugcheck code
    pub(crate) detail: String,       // short raw message snippet
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Incident {
    pub(crate) headline: String,     // plain-English (Sarah & Caleb bar)
    pub(crate) tag: String,          // neutral evidence tag
    pub(crate) when: String,         // RFC3339
    pub(crate) when_display: String, // "Jun 12, 9:42 PM" (local offset preserved)
    pub(crate) vitals: Option<LastVitals>,
    pub(crate) receipt: Receipt,
}

/// What the scan returns. A thin wrapper over `Vec<Incident>` so we can honestly surface
/// **skipped sources** (the elevation-honesty hard line: a `\Minidump`/channel we can't read
/// non-elevated must be *said*, not silently dropped — a bare `Vec<Incident>` can't carry that).
#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub(crate) struct BlackBoxReport {
    pub(crate) incidents: Vec<Incident>,
    pub(crate) skipped_sources: Vec<String>,
}

// ─── Pure assembly pipeline ────────────────────────────────────────────────

#[derive(Default)]
struct IncidentFields {
    faulting_app: Option<String>,
    faulting_module: Option<String>,
    code: Option<String>,
    driver: Option<String>, // GPU driver name for a TDR (4101)
}

/// Pure: turn the over-fetched raw events + the read-only session history into the plain-English
/// incident list. Unknown events are dropped; an unparseable timestamp drops THAT event (never a
/// fabricated time); newest-first; near-duplicates collapsed; capped at `MAX_INCIDENTS`.
fn assemble_incidents(events: Vec<RawEvent>, sessions: &[SessionSummary]) -> Vec<Incident> {
    let mut dated: Vec<(DateTime<Utc>, Incident)> = Vec::new();
    for ev in events {
        let Some(kind) = classify_incident(&ev.provider, ev.id) else {
            continue;
        };
        let Some(when) = parse_ts(&ev.time) else {
            continue; // no fabricated timestamps
        };
        let when_utc = when.with_timezone(&Utc);
        let fields = extract_fields(kind, &ev);
        let vitals = correlate_vitals(when_utc, sessions);
        let game = vitals.as_ref().and_then(|v| v.game.clone());
        let when_display = format_when(when);
        dated.push((
            when_utc,
            Incident {
                headline: build_headline(kind, &fields, &when_display, game.as_deref()),
                tag: kind.tag().to_string(),
                when: when.to_rfc3339(),
                when_display,
                vitals,
                receipt: build_receipt(kind, &ev, &fields),
            },
        ));
    }
    // Newest first by the true instant — NOT the RFC3339 string (offsets can differ across a DST
    // change, where text order would diverge from chronological order).
    dated.sort_by_key(|(t, _)| std::cmp::Reverse(*t));
    let mut incidents: Vec<Incident> = dated.into_iter().map(|(_, i)| i).collect();
    dedup_incidents(&mut incidents);
    incidents.truncate(MAX_INCIDENTS);
    incidents
}

/// Collapse exact repeats (same tag + same second + same headline). v1 does NOT merge across
/// families (a BSOD can log both BugCheck 1001 and Kernel-Power 41 — both are true and shown;
/// smart cross-event correlation is v2).
fn dedup_incidents(incidents: &mut Vec<Incident>) {
    let mut seen: std::collections::HashSet<(String, String)> = std::collections::HashSet::new();
    incidents.retain(|i| seen.insert((i.tag.clone(), format!("{}|{}", i.when, i.headline))));
}

/// Pure: does any recorded session window contain this crash moment? Returns that session's
/// vitals, or `None` when none overlaps — the honest "Compy wasn't monitoring" path.
pub(crate) fn correlate_vitals(
    crash_utc: DateTime<Utc>,
    sessions: &[SessionSummary],
) -> Option<LastVitals> {
    for s in sessions {
        let Some(start) = DateTime::parse_from_rfc3339(&s.started_at)
            .ok()
            .map(|t| t.with_timezone(&Utc))
        else {
            continue;
        };
        let end = start + chrono::Duration::seconds(s.duration_secs as i64);
        let grace = chrono::Duration::seconds(VITALS_GRACE_SECS);
        if crash_utc >= start && crash_utc <= end + grace {
            return Some(to_last_vitals(s));
        }
    }
    None
}

fn to_last_vitals(s: &SessionSummary) -> LastVitals {
    LastVitals {
        session_started_at: s.started_at.clone(),
        game: pretty_proc_opt(&s.process_name),
        peak_gpu_temp_c: s.peak_gpu_temp_c,
        peak_gpu_usage_pct: s.peak_gpu_usage_pct,
        avg_frametime_ms: s.avg_frametime_ms,
        low1_fps_est: s.low1_fps_est,
        summary: vitals_summary(s),
    }
}

/// Plain-English vitals strip, built only from fields actually recorded (never invents a number).
fn vitals_summary(s: &SessionSummary) -> String {
    let mut parts: Vec<String> = Vec::new();
    match (s.peak_gpu_temp_c, s.peak_gpu_usage_pct) {
        (Some(t), Some(u)) => parts.push(format!("GPU peaked {t}°C at up to {u}% load")),
        (Some(t), None) => parts.push(format!("GPU peaked {t}°C")),
        (None, Some(u)) => parts.push(format!("GPU peaked {u}% load")),
        (None, None) => {}
    }
    if s.avg_frametime_ms > 0.0 {
        let low = if s.low1_fps_est > 0.0 {
            format!(", 1% low ~{:.0} fps", s.low1_fps_est)
        } else {
            String::new()
        };
        parts.push(format!("frametime averaged ~{:.1} ms{}", s.avg_frametime_ms, low));
    }
    if parts.is_empty() {
        "Compy was monitoring, but recorded no notable vitals for that session.".to_string()
    } else {
        format!("In that session: {}.", parts.join("; "))
    }
}

/// Plain-English headline. The neutral tag carries the category; this translates the event for a
/// non-technical reader and — when a session correlated — names what was running.
fn build_headline(
    kind: IncidentKind,
    fields: &IncidentFields,
    when_display: &str,
    game: Option<&str>,
) -> String {
    let base = match kind {
        IncidentKind::GpuTimeout => "Your graphics driver stopped responding and recovered".to_string(),
        IncidentKind::AppCrash => match &fields.faulting_app {
            Some(app) => format!("{} stopped working and closed", pretty_proc(app)),
            None => "An application crashed".to_string(),
        },
        IncidentKind::AppHang => match &fields.faulting_app {
            Some(app) => format!("{} stopped responding (froze)", pretty_proc(app)),
            None => "An application stopped responding".to_string(),
        },
        IncidentKind::UnexpectedShutdown => "Your PC shut down unexpectedly or hard-froze".to_string(),
        IncidentKind::BlueScreen => "Your PC blue-screened and restarted".to_string(),
        IncidentKind::HardwareError => "Windows logged a hardware-level error".to_string(),
    };
    let mut h = format!("{base} — {when_display}");
    if let Some(g) = game {
        // For an app crash/hang the app is already the subject; only add the "while X" clause when
        // the correlated game is something different (avoids "game.exe crashed, while game running").
        let app = fields.faulting_app.as_deref().map(pretty_proc);
        let already_named = matches!(kind, IncidentKind::AppCrash | IncidentKind::AppHang)
            && app.as_deref() == Some(g);
        if !already_named {
            h = format!("{h}, while {g} was running");
        }
    }
    h
}

fn extract_fields(kind: IncidentKind, ev: &RawEvent) -> IncidentFields {
    let p = ev.props();
    let get = |i: usize| {
        p.get(i)
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    };
    match kind {
        // Application Error 1000 EventData: [0]app [1]ver [2]ts [3]module [4]modver [5]modts [6]exc
        IncidentKind::AppCrash => IncidentFields {
            faulting_app: get(0),
            faulting_module: get(3),
            code: get(6).map(|c| fmt_hex_code(&c)),
            driver: None,
        },
        // Application Hang 1002: [0]app name
        IncidentKind::AppHang => IncidentFields {
            faulting_app: get(0),
            ..Default::default()
        },
        // Display 4101 (TDR): the driver name is in the message ("Display driver X stopped…").
        IncidentKind::GpuTimeout => IncidentFields {
            driver: parse_driver(&ev.message).or_else(|| get(0)),
            ..Default::default()
        },
        // WER-SystemErrorReporting 1001: [0] is the bugcheck parameter string ("0x… (0x…, …)").
        IncidentKind::BlueScreen => IncidentFields {
            code: get(0),
            ..Default::default()
        },
        IncidentKind::UnexpectedShutdown | IncidentKind::HardwareError => IncidentFields::default(),
    }
}

fn build_receipt(kind: IncidentKind, ev: &RawEvent, fields: &IncidentFields) -> Receipt {
    Receipt {
        source: format!("{} · {} {}", source_channel(kind), ev.provider, ev.id),
        event_ids: vec![ev.id],
        faulting_app: fields.faulting_app.clone(),
        // For a TDR the "module" the user cares about is the GPU driver.
        faulting_module: fields.faulting_module.clone().or_else(|| fields.driver.clone()),
        code: fields.code.clone(),
        detail: short_detail(&ev.message),
    }
}

fn source_channel(kind: IncidentKind) -> &'static str {
    match kind {
        IncidentKind::AppCrash | IncidentKind::AppHang => "Application log",
        _ => "System log",
    }
}

// ─── small pure helpers ────────────────────────────────────────────────────

fn parse_ts(s: &str) -> Option<DateTime<FixedOffset>> {
    DateTime::parse_from_rfc3339(s.trim()).ok()
}

/// Local-time display preserving the original offset (the crash happened in the user's local time).
fn format_when(dt: DateTime<FixedOffset>) -> String {
    dt.format("%b %-d, %-I:%M %p").to_string()
}

/// Strip a trailing `.exe` (case-insensitive); empty/blank → None (no fabricated game name).
fn pretty_proc_opt(name: &str) -> Option<String> {
    let n = name.trim();
    if n.is_empty() {
        return None;
    }
    Some(pretty_proc(n))
}

fn pretty_proc(name: &str) -> String {
    let n = name.trim();
    n.strip_suffix(".exe")
        .or_else(|| n.strip_suffix(".EXE"))
        .unwrap_or(n)
        .to_string()
}

/// Render an exception code consistently (`c0000005` → `0xc0000005`); pass through anything that
/// already looks formatted.
fn fmt_hex_code(c: &str) -> String {
    let t = c.trim();
    if t.starts_with("0x") || t.starts_with("0X") {
        t.to_string()
    } else if !t.is_empty() && t.chars().all(|ch| ch.is_ascii_hexdigit()) {
        format!("0x{t}")
    } else {
        t.to_string()
    }
}

/// Pull the driver name out of a TDR message ("Display driver nvlddmkm stopped responding…").
fn parse_driver(message: &str) -> Option<String> {
    let lower = message.to_ascii_lowercase();
    let start = lower.find("display driver ")? + "display driver ".len();
    let rest = &message[start..];
    let end = rest.to_ascii_lowercase().find(" stopped").unwrap_or(rest.len());
    let name = rest[..end].trim();
    if name.is_empty() {
        None
    } else {
        Some(name.to_string())
    }
}

/// Collapse whitespace + cap length for the receipt detail line.
fn short_detail(message: &str) -> String {
    let collapsed = message.split_whitespace().collect::<Vec<_>>().join(" ");
    if collapsed.chars().count() > 240 {
        let truncated: String = collapsed.chars().take(237).collect();
        format!("{truncated}…")
    } else {
        collapsed
    }
}

// ─── Thin Windows collector (the edge — dumb OS reads; logic lives in the pure core above) ──

/// One raw Event-Log row as fetched by the read-only `Get-WinEvent`. `props` is the event's
/// language-independent `EventData` (preferred over the localized `Message` for field extraction).
#[derive(serde::Deserialize, Default, Debug)]
struct RawEvent {
    #[serde(default)]
    time: String,
    #[serde(default)]
    id: u32,
    #[serde(default)]
    provider: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    props: serde_json::Value,
}

impl RawEvent {
    fn props(&self) -> Vec<String> {
        match &self.props {
            serde_json::Value::Array(a) => a.iter().map(value_to_string).collect(),
            serde_json::Value::Null => Vec::new(),
            // PowerShell's ConvertTo-Json unwraps a single-element array to a scalar.
            other => vec![value_to_string(other)],
        }
    }
}

fn value_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Read the crash/instability events Windows recorded (System + Application channels). Read-only,
/// non-elevated, no window. Returns the parsed rows and an optional "skipped" note if the reader
/// could not run at all (a clean machine returns an empty list, NOT a skip).
fn collect_event_log() -> (Vec<RawEvent>, Option<String>) {
    // Over-fetch by ID across both logs (FilterHashtable ANDs keys, ORs within a key); the pure
    // classifier then keeps only the (provider,id) pairs it recognizes. `EventData` → `props` gives
    // language-independent faulting app/module/code. Errors are swallowed (SilentlyContinue) so a
    // "no events found" on a clean machine yields empty output, not a failure.
    let script = "$ErrorActionPreference='SilentlyContinue';\
@(Get-WinEvent -FilterHashtable @{LogName='System','Application'; Id=41,1001,17,18,19,4101,1000,1002} -MaxEvents 80 |\
 Select-Object @{n='time';e={$_.TimeCreated.ToString('o')}}, @{n='id';e={[int]$_.Id}}, @{n='provider';e={[string]$_.ProviderName}}, @{n='message';e={[string]$_.Message}}, @{n='props';e={@($_.Properties | ForEach-Object {[string]$_.Value})}}) |\
 ConvertTo-Json -Depth 4 -Compress";
    let Ok(out) = crate::actions::quiet_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
    else {
        return (Vec::new(), Some("Windows Event Log (couldn't run the reader)".into()));
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        // Get-WinEvent emits nothing when no matching events exist → scanned cleanly, none found.
        return (Vec::new(), None);
    }
    (parse_events_json(trimmed), None)
}

/// Tolerant of ConvertTo-Json's array/object/null shapes; a malformed individual row is skipped,
/// never a panic, never poisons the whole batch.
fn parse_events_json(s: &str) -> Vec<RawEvent> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(s) else {
        return Vec::new();
    };
    let items = match value {
        serde_json::Value::Array(a) => a,
        serde_json::Value::Object(_) => vec![value],
        _ => return Vec::new(),
    };
    items
        .into_iter()
        .filter_map(|i| serde_json::from_value::<RawEvent>(i).ok())
        .collect()
}

/// Crash dump files in `%SystemRoot%\Minidump` are admin-only. v1 reads the BSOD bugcheck code
/// from the (non-elevated) BugCheck 1001 event instead; here we only report the dump folder as a
/// *skipped* source when it exists but we can't read it — honest about the gap, never faked.
fn minidump_skip_note() -> Option<String> {
    let root = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
    let dir = std::path::Path::new(&root).join("Minidump");
    if !dir.exists() {
        return None; // no dump folder → nothing recorded to skip
    }
    match std::fs::read_dir(&dir) {
        Ok(_) => None, // readable — the 1001 event already carries the bugcheck code
        Err(_) => Some("Crash dump files in \\Minidump (need administrator to read)".into()),
    }
}

/// The IPC entry point (edge): fetch the read-only sources, correlate against the session history,
/// return the plain-English report. Mirrors `get_diagnostics` / `get_session_summaries`.
#[tauri::command]
pub(crate) fn get_crash_blackbox() -> BlackBoxReport {
    let (events, ev_skip) = collect_event_log();
    let mut skipped_sources = Vec::new();
    if let Some(note) = ev_skip {
        skipped_sources.push(note);
    }
    if let Some(note) = minidump_skip_note() {
        skipped_sources.push(note);
    }
    let sessions = crate::sessions::get_session_summaries();
    BlackBoxReport {
        incidents: assemble_incidents(events, &sessions),
        skipped_sources,
    }
}

// ─── Pure-core tests (the collector is a thin edge; logic + invariants are pinned here) ─────────
#[cfg(test)]
mod blackbox_tests {
    use super::*;

    fn ev(provider: &str, id: u32, time: &str, message: &str, props: serde_json::Value) -> RawEvent {
        RawEvent {
            time: time.into(),
            id,
            provider: provider.into(),
            message: message.into(),
            props,
        }
    }

    fn session(started_at: &str, dur: u64, proc_name: &str) -> SessionSummary {
        SessionSummary {
            started_at: started_at.into(),
            duration_secs: dur,
            process_name: proc_name.into(),
            samples: 10,
            avg_fps: 110.0,
            avg_frametime_ms: 9.2,
            low1_fps_est: 88.0,
            peak_gpu_temp_c: Some(84),
            peak_gpu_usage_pct: Some(97),
            peak_ram_used_bytes: Some(8_000_000_000),
            ram_total_bytes: Some(32_000_000_000),
            compy_changes_active: 0,
            hw_fingerprint: None,
            stutter_insight: None,
            stutter_timeline: Vec::new(),
            stutter_events: Vec::new(),
        }
    }

    #[test]
    fn classifies_every_event_family_correctly() {
        use IncidentKind::*;
        assert_eq!(classify_incident("Microsoft-Windows-Kernel-Power", 41), Some(UnexpectedShutdown));
        assert_eq!(classify_incident("Microsoft-Windows-WER-SystemErrorReporting", 1001), Some(BlueScreen));
        assert_eq!(classify_incident("BugCheck", 1001), Some(BlueScreen));
        assert_eq!(classify_incident("Microsoft-Windows-WHEA-Logger", 17), Some(HardwareError));
        assert_eq!(classify_incident("Microsoft-Windows-WHEA-Logger", 18), Some(HardwareError));
        assert_eq!(classify_incident("Microsoft-Windows-WHEA-Logger", 19), Some(HardwareError));
        assert_eq!(classify_incident("Display", 4101), Some(GpuTimeout));
        assert_eq!(classify_incident("Application Error", 1000), Some(AppCrash));
        assert_eq!(classify_incident("Application Hang", 1002), Some(AppHang));
    }

    #[test]
    fn rejects_known_ids_from_the_wrong_provider_and_unknown_ids() {
        // An id we over-fetched but from a non-crash provider must NOT be classified.
        assert_eq!(classify_incident("Some-Unrelated-Provider", 1000), None);
        assert_eq!(classify_incident("Microsoft-Windows-Kernel-General", 41), None);
        assert_eq!(classify_incident("Application Error", 9999), None);
        assert_eq!(classify_incident("Display", 1000), None);
    }

    #[test]
    fn correlate_matches_a_crash_inside_a_session_window() {
        let sessions = vec![session("2026-06-12T21:00:00-07:00", 3600, "Helldivers2.exe")];
        // 21:42 local is inside [21:00, 22:00).
        let crash = DateTime::parse_from_rfc3339("2026-06-12T21:42:00-07:00")
            .unwrap()
            .with_timezone(&Utc);
        let v = correlate_vitals(crash, &sessions).expect("should correlate");
        assert_eq!(v.game.as_deref(), Some("Helldivers2"));
        assert_eq!(v.peak_gpu_temp_c, Some(84));
        assert!(v.summary.contains("84°C"));
    }

    #[test]
    fn correlate_returns_nothing_when_no_session_overlaps_never_fabricates() {
        let sessions = vec![session("2026-06-12T10:00:00-07:00", 600, "game.exe")];
        let crash = DateTime::parse_from_rfc3339("2026-06-12T21:42:00-07:00")
            .unwrap()
            .with_timezone(&Utc);
        assert!(correlate_vitals(crash, &sessions).is_none(), "no overlap → no vitals, not a fake");
    }

    #[test]
    fn correlate_on_empty_history_is_none() {
        let crash = DateTime::parse_from_rfc3339("2026-06-12T21:42:00Z")
            .unwrap()
            .with_timezone(&Utc);
        assert!(correlate_vitals(crash, &[]).is_none());
    }

    #[test]
    fn correlate_allows_a_crash_in_the_grace_window_just_after_a_session() {
        let sessions = vec![session("2026-06-12T21:00:00Z", 60, "game.exe")];
        // Session ends 21:01:00; a crash 30s later (within the 90s grace) still correlates.
        let in_grace = DateTime::parse_from_rfc3339("2026-06-12T21:01:30Z").unwrap().with_timezone(&Utc);
        assert!(correlate_vitals(in_grace, &sessions).is_some());
        // …but well past the grace does not.
        let past = DateTime::parse_from_rfc3339("2026-06-12T21:10:00Z").unwrap().with_timezone(&Utc);
        assert!(correlate_vitals(past, &sessions).is_none());
    }

    #[test]
    fn empty_event_input_yields_empty_list_no_fabrication() {
        assert!(assemble_incidents(Vec::new(), &[]).is_empty());
    }

    #[test]
    fn assemble_keeps_only_known_events_and_sorts_newest_first() {
        let events = vec![
            ev("Application Error", 1000, "2026-06-12T20:00:00-07:00", "Faulting application game.exe",
               serde_json::json!(["game.exe", "1.0", "ts", "ntdll.dll", "1.0", "ts", "c0000005"])),
            ev("Totally-Unknown", 1000, "2026-06-12T23:00:00-07:00", "noise", serde_json::Value::Null),
            ev("Display", 4101, "2026-06-12T22:00:00-07:00", "Display driver amdkmdag stopped responding and has successfully recovered.", serde_json::Value::Null),
        ];
        let out = assemble_incidents(events, &[]);
        assert_eq!(out.len(), 2, "the unknown-provider event is dropped");
        assert_eq!(out[0].tag, "GPU timeout", "22:00 is newer than 20:00 → first");
        assert_eq!(out[1].tag, "App crash");
        // No session overlapped → honest absence of vitals.
        assert!(out[0].vitals.is_none() && out[1].vitals.is_none());
    }

    #[test]
    fn unparseable_timestamp_drops_the_event_without_panicking() {
        let events = vec![ev("Display", 4101, "not-a-timestamp", "Display driver x stopped", serde_json::Value::Null)];
        assert!(assemble_incidents(events, &[]).is_empty(), "bad ts → dropped, no fabricated time, no panic");
    }

    #[test]
    fn app_crash_headline_names_the_app_and_carries_the_receipt() {
        let events = vec![ev(
            "Application Error", 1000, "2026-06-12T21:42:00-07:00",
            "Faulting application name: Helldivers2.exe, faulting module ntdll.dll",
            serde_json::json!(["Helldivers2.exe", "1.0", "ts", "ntdll.dll", "1.0", "ts", "c0000005"]),
        )];
        let out = assemble_incidents(events, &[]);
        assert_eq!(out.len(), 1);
        assert!(out[0].headline.starts_with("Helldivers2 stopped working"));
        assert!(out[0].headline.contains("Jun 12"));
        assert_eq!(out[0].receipt.faulting_module.as_deref(), Some("ntdll.dll"));
        assert_eq!(out[0].receipt.code.as_deref(), Some("0xc0000005"));
        assert_eq!(out[0].receipt.event_ids, vec![1000]);
    }

    #[test]
    fn system_incident_names_the_correlated_game_in_the_headline() {
        let sessions = vec![session("2026-06-12T21:00:00-07:00", 3600, "Helldivers2.exe")];
        let events = vec![ev("Display", 4101, "2026-06-12T21:42:00-07:00",
            "Display driver amdkmdag stopped responding and has successfully recovered.", serde_json::Value::Null)];
        let out = assemble_incidents(events, &sessions);
        assert_eq!(out.len(), 1);
        assert!(out[0].headline.contains("while Helldivers2 was running"), "got: {}", out[0].headline);
        assert!(out[0].vitals.is_some());
        assert_eq!(out[0].receipt.faulting_module.as_deref(), Some("amdkmdag"), "driver shows in the receipt");
    }

    #[test]
    fn app_crash_does_not_repeat_the_game_when_it_is_the_faulting_app() {
        let sessions = vec![session("2026-06-12T21:00:00-07:00", 3600, "game.exe")];
        let events = vec![ev("Application Error", 1000, "2026-06-12T21:42:00-07:00", "crash",
            serde_json::json!(["game.exe", "1.0", "ts", "unity.dll", "1.0", "ts", "c0000005"]))];
        let out = assemble_incidents(events, &sessions);
        assert!(!out[0].headline.contains("while game was running"), "no redundant clause: {}", out[0].headline);
        assert!(out[0].vitals.is_some(), "vitals still attached even though the clause is suppressed");
    }

    #[test]
    fn caps_at_max_incidents() {
        let events: Vec<RawEvent> = (0..40)
            .map(|i| ev("Application Hang", 1002, &format!("2026-06-12T{:02}:00:00Z", i % 24), "hang",
                serde_json::json!([format!("app{i}.exe")])))
            .collect();
        assert!(assemble_incidents(events, &[]).len() <= MAX_INCIDENTS);
    }

    #[test]
    fn parse_events_json_tolerates_garbage_array_and_object_shapes() {
        assert!(parse_events_json("}}not json[[").is_empty(), "garbage → empty, no panic");
        assert!(parse_events_json("null").is_empty());
        // Single object (ConvertTo-Json's single-element unwrap).
        let one = parse_events_json(r#"{"time":"2026-06-12T21:42:00Z","id":41,"provider":"Microsoft-Windows-Kernel-Power","message":"m","props":[]}"#);
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].id, 41);
        // Array with a malformed middle row → the good rows survive.
        let arr = parse_events_json(r#"[{"id":1000,"provider":"Application Error","time":"2026-06-12T21:42:00Z","props":["a"]},{"id":"oops"}]"#);
        assert_eq!(arr.len(), 1, "the row with a string id is skipped, the good one kept");
    }

    #[test]
    fn props_handles_scalar_array_and_null() {
        let scalar = ev("Application Hang", 1002, "t", "m", serde_json::json!("solo.exe"));
        assert_eq!(scalar.props(), vec!["solo.exe"]);
        let arr = ev("Application Error", 1000, "t", "m", serde_json::json!(["a", "b"]));
        assert_eq!(arr.props(), vec!["a", "b"]);
        let none = ev("Display", 4101, "t", "m", serde_json::Value::Null);
        assert!(none.props().is_empty());
    }

    #[test]
    fn vitals_summary_only_reports_recorded_fields() {
        let mut s = session("2026-06-12T21:00:00Z", 600, "g.exe");
        s.peak_gpu_temp_c = None;
        s.peak_gpu_usage_pct = None;
        s.avg_frametime_ms = 0.0;
        s.low1_fps_est = 0.0;
        let v = to_last_vitals(&s);
        assert!(v.summary.contains("no notable vitals"), "no invented numbers: {}", v.summary);
    }

    #[test]
    fn pretty_proc_strips_exe_and_handles_empty() {
        assert_eq!(pretty_proc("Helldivers2.exe"), "Helldivers2");
        assert_eq!(pretty_proc("game.EXE"), "game");
        assert_eq!(pretty_proc("noext"), "noext");
        assert_eq!(pretty_proc_opt("   "), None);
        assert_eq!(pretty_proc_opt(""), None);
    }

    #[test]
    fn fmt_hex_code_normalizes_only_bare_hex() {
        assert_eq!(fmt_hex_code("c0000005"), "0xc0000005");
        assert_eq!(fmt_hex_code("0xC0000005"), "0xC0000005");
        assert_eq!(fmt_hex_code("STATUS_FOO"), "STATUS_FOO");
    }

    #[test]
    fn serde_shape_is_stable_for_the_ts_contract() {
        let events = vec![ev("Microsoft-Windows-Kernel-Power", 41, "2026-06-12T21:42:00-07:00", "rebooted without cleanly shutting down", serde_json::Value::Null)];
        let report = BlackBoxReport { incidents: assemble_incidents(events, &[]), skipped_sources: vec!["x".into()] };
        let v = serde_json::to_value(&report).expect("serializes");
        assert!(v.get("incidents").and_then(|i| i.as_array()).is_some());
        assert!(v.get("skipped_sources").and_then(|s| s.as_array()).is_some());
        let inc = &v["incidents"][0];
        for key in ["headline", "tag", "when", "when_display", "vitals", "receipt"] {
            assert!(inc.get(key).is_some(), "missing key {key}");
        }
        assert!(inc["vitals"].is_null(), "no session → vitals serializes as null (honest absence)");
    }

    // ── R6 Lane D — edge guards beyond the spec minimum ──

    #[test]
    fn whea_ids_just_outside_17_19_are_rejected() {
        // The over-fetch never pulls 16/20, but the classifier must still bound the WHEA range.
        assert_eq!(classify_incident("Microsoft-Windows-WHEA-Logger", 16), None);
        assert_eq!(classify_incident("Microsoft-Windows-WHEA-Logger", 20), None);
    }

    #[test]
    fn provider_matching_is_case_insensitive() {
        // Get-WinEvent casing shouldn't matter — the classifier lowercases before comparing.
        assert_eq!(
            classify_incident("MICROSOFT-WINDOWS-KERNEL-POWER", 41),
            Some(IncidentKind::UnexpectedShutdown)
        );
        assert_eq!(classify_incident("application error", 1000), Some(IncidentKind::AppCrash));
    }

    #[test]
    fn dedup_collapses_identical_incidents_to_one() {
        // A source that logged the same event twice (same family, second, headline) shows once.
        let make = || ev("Display", 4101, "2026-06-12T21:42:00-07:00",
            "Display driver amdkmdag stopped responding and has successfully recovered.", serde_json::Value::Null);
        let out = assemble_incidents(vec![make(), make()], &[]);
        assert_eq!(out.len(), 1, "identical events collapse to a single incident");
    }

    #[test]
    fn correlate_window_boundaries_are_inclusive_and_bounded() {
        let sessions = vec![session("2026-06-12T21:00:00Z", 600, "g.exe")]; // [21:00:00, 21:10:00]
        let at = |s: &str| DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc);
        // exactly at start → matches; exactly at end+grace (21:10:00 + 90s = 21:11:30) → matches.
        assert!(correlate_vitals(at("2026-06-12T21:00:00Z"), &sessions).is_some(), "start is inclusive");
        assert!(correlate_vitals(at("2026-06-12T21:11:30Z"), &sessions).is_some(), "end+grace inclusive");
        // one second before the start → no fabricated correlation.
        assert!(correlate_vitals(at("2026-06-12T20:59:59Z"), &sessions).is_none(), "before start → none");
        // one second past end+grace → none.
        assert!(correlate_vitals(at("2026-06-12T21:11:31Z"), &sessions).is_none(), "past grace → none");
    }

    #[test]
    fn format_when_is_human_readable() {
        let dt = DateTime::parse_from_rfc3339("2026-06-12T21:42:00-07:00").unwrap();
        let s = format_when(dt);
        assert!(s.contains("Jun"), "names the month: {s}");
        assert!(s.contains("PM"), "12-hour clock with meridiem: {s}");
        assert!(s.contains("9:42"), "local time preserved (offset not converted to UTC): {s}");
    }

    #[test]
    fn short_detail_collapses_whitespace_and_truncates() {
        let long = "word ".repeat(120); // 600 chars, whitespace-heavy
        let out = short_detail(&long);
        assert!(out.chars().count() <= 240, "capped at 240 chars: {}", out.chars().count());
        assert!(out.ends_with('…'), "truncation marked with an ellipsis");
        assert_eq!(short_detail("a\n\n  b\t c"), "a b c", "collapses runs of whitespace");
    }

    #[test]
    fn fmt_hex_code_passes_through_existing_0x_either_case() {
        assert_eq!(fmt_hex_code("0XDEADBEEF"), "0XDEADBEEF");
        assert_eq!(fmt_hex_code(" 80000003 "), "0x80000003", "trims then prefixes bare hex");
    }

    #[test]
    fn app_error_1000_from_a_non_appcrash_provider_is_rejected() {
        // Provider guard: id 1000 is reused widely; only "Application Error" is an app crash.
        let events = vec![ev("Microsoft-Windows-Some-Service", 1000, "2026-06-12T21:42:00Z", "noise",
            serde_json::json!(["x"]))];
        assert!(assemble_incidents(events, &[]).is_empty());
    }
}
