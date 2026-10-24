//! Black Box v1 (Paramedic Mode): a READ-ONLY crash/freeze evidence reader.
//!
//! Spec: docs/superpowers/specs/2026-06-13-black-box-v1.md. Black Box reads the crash/freeze
//! evidence Windows ALREADY records and presents each incident in plain English, overlaying Compy's
//! own pre-crash "last vitals" from `sessions.rs`. Three read-only OS sources, merged + deduped so
//! one crash is never double-listed:
//!   1. **Windows Event Log** (`Get-WinEvent`, System + Application) — Kernel-Power 41, BugCheck 1001,
//!      WHEA 17/18/19, Display 4101 (TDR), App Error 1000, App Hang 1002, EventLog 6008 (dirty shutdown).
//!   2. **WER** (`%ProgramData%\Microsoft\Windows\WER\Report*\Report.wer`) — faulting-module detail for
//!      app crashes Windows kept a report for even after the Event Log rotated them out.
//!   3. **Reliability** (`Win32_ReliabilityRecords`) — the friendly critical-event timeline; catches the
//!      6008 "previous shutdown was unexpected" signal the raw Event Log query alone can miss.
//!
//! **v1 makes ZERO causal claims and prescribes ZERO fixes** — it reports recorded evidence only.
//! A TDR event *says* "the display driver stopped responding" → reporting that is translation, not
//! diagnosis. Probable-cause + fixes are v2 (evidence-gated, separate spec).
//!
//! HARD LINES held here: read-only (no mutation, `actions.rs` untouched, no rollback contract) ·
//! no kernel driver / no game injection (every source is a user-mode OS log/file read; never touches a
//! running game) · zero outbound network · no fabricated/unmeasured claims (if Windows recorded
//! nothing, say so; if Compy wasn't monitoring, say "no vitals" — never invent either) · honest
//! about elevation (a source we can't read non-elevated is reported as *skipped (needs admin)*, never
//! errored or faked) · plain language (raw IDs live behind the receipt) · on-demand only (no watcher).
//!
//! Shape: a **pure core** (`classify_*` / `parse_*` / `correlate_vitals` / merge over already-fetched
//! strings + serialized session data) with unit tests, plus **thin collectors** (the `Get-WinEvent`
//! call, the `Report.wer` file reads, the `Win32_ReliabilityRecords` query) isolated at the edge.

use chrono::{DateTime, FixedOffset, Utc};
use serde::Serialize;
use std::collections::HashMap;

use crate::sessions::SessionSummary;

/// Newest N incidents shown (spec cap).
const MAX_INCIDENTS: usize = 25;
/// A crash often lands just as the game stops presenting; allow this much slack after a session's
/// recorded end before we stop calling it "during that session". Conservative — never invents a
/// session, only widens the match window slightly.
const VITALS_GRACE_SECS: i64 = 90;
/// How close two records must be in time to be treated as the SAME crash seen by two sources. The
/// Event Log, WER, and Reliability all stamp the actual crash instant, so their copies of one crash
/// land within a few seconds; 60s absorbs clock/rounding differences without hiding distinct
/// incidents (a real crash-loop's repeats ≥60s apart stay separate). Errs toward not double-listing.
pub(crate) const CROSS_SOURCE_WINDOW_SECS: i64 = 60;

// ─── Typed incident families (the only ones v1 recognizes) ─────────────────

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum IncidentKind {
    GpuTimeout,         // Display 4101 — driver stopped responding + recovered (TDR)
    AppCrash,           // Application Error 1000 / WER APPCRASH·BEX·MoAppCrash
    AppHang,            // Application Hang 1002 / WER AppHang*
    UnexpectedShutdown, // Kernel-Power 41 / EventLog 6008 — hard lock / power loss / freeze
    BlueScreen,         // BugCheck 1001 — BSOD
    HardwareError,      // WHEA-Logger 17/18/19 — machine-check (thermal/power/RAM/PCIe)
}

impl IncidentKind {
    /// Neutral evidence tag (spec output) — describes the recorded signal, claims no cause.
    pub(crate) fn tag(self) -> &'static str {
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
/// name (e.g. "Microsoft-Windows-Kernel-Power"). Reliability records are event-log-shaped
/// (`SourceName` + `EventIdentifier`) so they flow through this same classifier.
pub(crate) fn classify_incident(provider: &str, event_id: u32) -> Option<IncidentKind> {
    let p = provider.to_ascii_lowercase();
    match event_id {
        41 if p.contains("kernel-power") => Some(IncidentKind::UnexpectedShutdown),
        6008 if p.contains("eventlog") => Some(IncidentKind::UnexpectedShutdown),
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

/// Pure classifier for a WER `Report.wer` `EventType`. Only the families that correspond to v1's
/// Event-Log families are recognized; anything else (kernel live-events, .NET runtime probes we
/// don't translate, store-update failures) returns `None` and is dropped — never guessed at.
pub(crate) fn classify_wer(event_type: &str) -> Option<IncidentKind> {
    let t = event_type.trim().to_ascii_lowercase();
    if t.starts_with("apphang") {
        return Some(IncidentKind::AppHang);
    }
    match t.as_str() {
        // APPCRASH and its buffer-overflow / modern-app / .NET variants are all "an app crashed".
        "appcrash" | "bex" | "bex64" | "mobex" | "moappcrash" | "clr20r3" => Some(IncidentKind::AppCrash),
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
    pub(crate) source: String, // e.g. "System log · Display 4101" (joined when corroborated)
    pub(crate) event_ids: Vec<u32>,
    pub(crate) faulting_app: Option<String>,
    pub(crate) faulting_module: Option<String>,
    pub(crate) code: Option<String>, // exception or bugcheck code
    pub(crate) detail: String,       // short raw message snippet
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Incident {
    /// Stable, path-free identity for this merged incident — see `incident_id_for`. Added for the
    /// Care observer (Tier 1 plan task 9), which persists it across launches so the same crash is
    /// never announced twice; the frontend also carries it as a one-shot deep-link selector.
    pub(crate) incident_id: String,
    pub(crate) headline: String,     // plain-English (Sarah & Caleb bar)
    pub(crate) tag: String,          // neutral evidence tag
    pub(crate) when: String,         // RFC3339
    pub(crate) when_display: String, // "Jun 12, 9:42 PM" (local offset preserved)
    pub(crate) vitals: Option<LastVitals>,
    pub(crate) receipt: Receipt,
    /// v2 (Black Box v2, behind `blackbox_v2_gate()`): the triage/safe-next-step layer. `None` when the
    /// gate is OFF (shipped behavior) OR when no rule cleared its evidence bar (refuse-to-guess). Omitted
    /// from the wire when absent, so a flag-OFF incident serializes byte-for-byte like v1.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) assessment: Option<Assessment>,
    /// Tier 1 (Compy Care, behind `case_intelligence::case_intelligence_gate()`): a match against the
    /// SIGNED public-advisory catalog. `None` when the gate is OFF — every shipped build today — when
    /// no verified catalog is held, or when nothing matched, so a dark build serializes byte-for-byte
    /// like the station did before Tier 1 existed. Distinct from `assessment` on purpose: that is
    /// Compy's own local reading, this is somebody else's published write-up, and merging them would
    /// make it impossible for a user to tell whose word they are taking.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) case_intelligence: Option<crate::case_intelligence::CaseIntelligenceMatch>,
    /// Internal only (never serialized — the TS-facing discriminator is `tag`): the typed kind, kept so
    /// the pure `assess` pass can reason over the incident without re-parsing the tag string.
    #[serde(skip)]
    pub(crate) kind: IncidentKind,
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

/// A normalized incident from ONE source, before cross-source merge. Every source (Event Log, WER,
/// Reliability) produces these, then `merge_protos` collapses the copies of a single crash into one.
struct ProtoIncident {
    kind: IncidentKind,
    when: DateTime<FixedOffset>, // original local offset preserved for display
    fields: IncidentFields,
    sources: Vec<String>, // receipt source labels — accumulates as sources corroborate
    detail: String,       // short raw message snippet
    event_ids: Vec<u32>,
}

/// Pure: turn the over-fetched events + WER reports + reliability records + the read-only session
/// history into the plain-English incident list. Each source → `ProtoIncident`s, then they're sorted
/// newest-first, **merged/deduped across sources** (one crash, not three rows), correlated with
/// sessions, and capped. Unknown events are dropped; an unparseable timestamp drops THAT record
/// (never a fabricated time).
fn assemble_incidents(
    events: Vec<RawEvent>,
    wer: Vec<WerReport>,
    reliability: Vec<ReliabilityRecord>,
    sessions: &[SessionSummary],
) -> Vec<Incident> {
    let mut protos: Vec<ProtoIncident> = Vec::new();
    protos.extend(events.iter().filter_map(event_to_proto));
    protos.extend(wer.iter().filter_map(wer_to_proto));
    protos.extend(reliability.iter().filter_map(reliability_to_proto));

    let merged = merge_protos(protos); // sorted newest-first + cross-source deduped

    let mut incidents: Vec<Incident> = merged
        .into_iter()
        .map(|p| {
            let when_utc = p.when.with_timezone(&Utc);
            let when_display = format_when(p.when);
            let vitals = correlate_vitals(when_utc, sessions);
            let game = vitals.as_ref().and_then(|v| v.game.clone());
            Incident {
                incident_id: incident_id_for(p.kind, when_utc, &p.fields),
                headline: build_headline(p.kind, &p.fields, &when_display, game.as_deref()),
                tag: p.kind.tag().to_string(),
                when: p.when.to_rfc3339(),
                when_display,
                vitals,
                receipt: build_receipt(&p),
                assessment: None,
                case_intelligence: None,
                kind: p.kind,
            }
        })
        .collect();
    incidents.truncate(MAX_INCIDENTS);
    // Black Box v2: triage layer. ONLY when the gate is ON (default OFF ⇒ this is skipped entirely and
    // every `assessment` stays `None` — exact v1 behavior). `assess` is pure + gate-independent.
    if blackbox_v2_gate() {
        apply_assessments(&mut incidents);
    }
    // Compy Care Tier 1: attach a signed known-issue write-up where one matches. Hard-false in every
    // shipped build, so this is skipped entirely and every `case_intelligence` stays `None`.
    if crate::case_intelligence::case_intelligence_gate() {
        apply_case_intelligence(&mut incidents);
    }
    incidents
}

/// Attach Tier 1 guidance where the verified catalog matched this machine.
///
/// Only reached with the gate ON, so a shipped build reads no hardware and touches no cache for this.
/// The snapshot is taken ONCE for the whole report — it is the same machine on every row, and a crash
/// scan must not pay for a hardware read per incident.
///
/// Nothing here can fail the scan. `advise` returns an outcome and never an error, and anything short
/// of an actual match — no catalog, an expired or unverifiable one, or simply nothing that fits —
/// leaves the field absent. A user who came here after a crash gets the local reading either way.
fn apply_case_intelligence(incidents: &mut [Incident]) {
    use crate::case_intelligence::{advise, local_facts_from, CaseMatchOutcome};
    let facts = local_facts_from(&crate::hardware::collect_hardware());
    for inc in incidents.iter_mut() {
        if let CaseMatchOutcome::Found(m) = advise(inc, &facts) {
            inc.case_intelligence = Some(*m);
        }
    }
}

/// Populate each incident's `assessment` from the pure rule engine. Two-phase (compute all, then
/// assign) so each `assess` call can read the full incident list as `recent_context` (recurrence)
/// while the assignment borrows mutably.
fn apply_assessments(incidents: &mut [Incident]) {
    let assessments: Vec<Option<Assessment>> =
        incidents.iter().map(|inc| assess(inc, incidents)).collect();
    for (inc, a) in incidents.iter_mut().zip(assessments) {
        inc.assessment = a;
    }
}

// ═══ Black Box v2 — triage + safe next step (behind blackbox_v2_gate(), DEFAULT OFF) ═══════════════
//
// LAW (spec 2026-06-13-black-box-v2 §"the law that makes v2 safe", test-enforced): v2 is a TRIAGE +
// SAFE-NEXT-STEP engine, NOT a verdict engine. It NEVER asserts a cause — it says the evidence is
// "consistent with X (here's what we saw) → the reversible step to confirm is Y." Strength is in WORDS
// (Strong/Partial/Weak), NEVER a percentage. Every next step is reversible/safe; irreversible things
// (BIOS/RMA/repaste/PSU/voltage) appear only as "what to research," never "do this" — and Compy performs
// NONE of them (advisory text only: no new mutation, no new OS call, zero outbound). When no rule clears
// its bar, `assess` returns None → evidence-only v1 + "not enough recorded" (refuse to guess). All pure.

/// GPU temperature (°C) in the pre-incident vitals at/above which we'll call a crash
/// overheating-consistent. Conservative — a measured reading, never a guess.
const OVERHEAT_C: u32 = 85;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Strength {
    Strong,
    Partial,
    Weak,
}

/// The ONE reversible/safe next step an assessment suggests. `reversible` is an INVARIANT — always true
/// (a test asserts it for every emitted step). `research_only` marks a step that is "what to look into,"
/// not "do this" — used where the real-world fix would be irreversible (PSU swap, repaste, BIOS).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct NextStep {
    pub(crate) headline: String,
    pub(crate) detail: String,
    pub(crate) reversible: bool,
    pub(crate) research_only: bool,
}

impl NextStep {
    /// A reversible do-it-safely step (the common case). `reversible` is hard-wired true.
    fn safe(headline: &str, detail: &str) -> Self {
        NextStep { headline: headline.into(), detail: detail.into(), reversible: true, research_only: false }
    }
    /// A "here's what to research" step — for situations whose real fix is irreversible/risky and must
    /// NOT be instructed. Still reversible (researching changes nothing).
    fn research(headline: &str, detail: &str) -> Self {
        NextStep { headline: headline.into(), detail: detail.into(), reversible: true, research_only: true }
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Assessment {
    /// Always "consistent with…" / "points toward…" phrasing — NEVER "the cause is…".
    pub(crate) consistent_with: String,
    pub(crate) strength: Strength,
    /// The exact evidence rows this fired on, so the reader sees WHY (no percentages, ever).
    pub(crate) evidence: Vec<String>,
    pub(crate) next_step: NextStep,
    /// True = "beyond what Compy can safely advise — here's the raw evidence to take to a human/forum."
    pub(crate) beyond_us: bool,
}

/// Gate for all of Black Box v2 (mirrors `gaming_mode_gate` / `receipts_gate`). **Owner-authorized
/// 2026-06-14: v2 (triage + v2.1 measured payoff) now SHIPS ON in release/dev builds.** It remains
/// READ-ONLY advisory text — no mutation, no outbound, no new OS call; only the gate's return value
/// changed. In TEST builds the gate stays OFF unless a test forces it on (`V2_GATE_TEST_FORCE`), so the
/// default-off and force-on tests stay deterministic regardless of the shipped default. The DEBUG
/// preview-env opt-in is kept (now redundant/harmless since the default is true).
pub(crate) fn blackbox_v2_gate() -> bool {
    #[cfg(test)]
    {
        if V2_GATE_TEST_FORCE.with(|f| *f.borrow()) {
            return true;
        }
    }
    #[cfg(all(debug_assertions, not(test)))]
    {
        if std::env::var("COMPY_BLACKBOX_V2_PREVIEW").as_deref() == Ok("1") {
            return true;
        }
    }
    // Owner-authorized flip (2026-06-14): ships ON in release/dev. Tests fall through to OFF (above) so
    // the default-off / force-on tests stay green and deterministic.
    #[cfg(test)]
    {
        false
    }
    #[cfg(not(test))]
    {
        true
    }
}

/// Pure triage. Tries each starter rule in priority order (strongest measured signal first); the first
/// that clears its evidence bar wins. No rule fires ⇒ `None` (refuse to guess → evidence-only v1).
/// `recent_context` is the full incident list (includes `incident` itself) — used for recurrence.
pub(crate) fn assess(incident: &Incident, recent_context: &[Incident]) -> Option<Assessment> {
    rule_overheating(incident, recent_context)
        .or_else(|| rule_graphics_driver(incident, recent_context))
        .or_else(|| rule_app_specific(incident, recent_context))
        .or_else(|| rule_power_hardlock(incident, recent_context))
        .or_else(|| rule_beyond_us(incident))
}

fn peak_temp(inc: &Incident) -> Option<u32> {
    inc.vitals.as_ref().and_then(|v| v.peak_gpu_temp_c)
}
fn is_high_temp(inc: &Incident) -> bool {
    peak_temp(inc).is_some_and(|t| t >= OVERHEAT_C)
}
fn count_kind(ctx: &[Incident], kind: IncidentKind) -> usize {
    ctx.iter().filter(|i| i.kind == kind).count()
}
/// Is there a BSOD/blue-screen incident within ±`mins` of this one?
fn bluescreen_near(inc: &Incident, ctx: &[Incident], mins: i64) -> bool {
    incident_within(inc, ctx, mins, |k| k == IncidentKind::BlueScreen)
}
/// Is there a SYSTEM-level incident (GPU/shutdown/BSOD/WHEA) within ±`mins` of this one?
fn system_event_near(inc: &Incident, ctx: &[Incident], mins: i64) -> bool {
    incident_within(inc, ctx, mins, |k| {
        matches!(
            k,
            IncidentKind::GpuTimeout
                | IncidentKind::UnexpectedShutdown
                | IncidentKind::BlueScreen
                | IncidentKind::HardwareError
        )
    })
}
fn incident_within(inc: &Incident, ctx: &[Incident], mins: i64, kind_pred: impl Fn(IncidentKind) -> bool) -> bool {
    let Some(t0) = parse_ts(&inc.when).map(|t| t.with_timezone(&Utc)) else {
        return false;
    };
    ctx.iter().any(|o| {
        kind_pred(o.kind)
            && parse_ts(&o.when)
                .map(|t| t.with_timezone(&Utc))
                .is_some_and(|t| (t - t0).num_minutes().abs() <= mins)
    })
}

/// Rule 1 — overheating-consistent. A MEASURED high GPU temp (≥85 °C) in the pre-crash vitals on a GPU
/// timeout or an unexpected shutdown → Strong. A WHEA hardware machine-check → Strong if repeated (or
/// corroborated by a high temp), else Partial. Honest about WHEA's breadth (heat OR power OR memory).
fn rule_overheating(inc: &Incident, ctx: &[Incident]) -> Option<Assessment> {
    let high = is_high_temp(inc);
    if high && matches!(inc.kind, IncidentKind::GpuTimeout | IncidentKind::UnexpectedShutdown) {
        let t = peak_temp(inc).unwrap_or(0);
        return Some(Assessment {
            consistent_with: "overheating around the time of the crash".into(),
            strength: Strength::Strong,
            evidence: vec![
                format!("Compy recorded the GPU at {t}°C in the session running at the time"),
                format!("what Windows logged: {}", inc.tag.to_lowercase()),
            ],
            next_step: NextStep::safe(
                "Check your temperatures under load",
                "Run the game (or a stress test) with a temperature overlay and watch the GPU. If it \
                 climbs back toward this range, improving case airflow or clearing dust is the safe place \
                 to start. Re-pasting or undervolting are bigger jobs to research first, not do blind.",
            ),
            beyond_us: false,
        });
    }
    if inc.kind == IncidentKind::HardwareError {
        let repeats = count_kind(ctx, IncidentKind::HardwareError) >= 2;
        let strength = if repeats || high { Strength::Strong } else { Strength::Partial };
        let mut evidence = vec![
            format!(
                "Windows logged a hardware-level fault {} (it calls these 'WHEA' errors)",
                if repeats { "more than once" } else { "once" }
            ),
            "these come straight from the hardware — not from a game or a driver setting".into(),
        ];
        if let Some(t) = peak_temp(inc) {
            evidence.push(format!("the GPU was at {t}°C in the session at the time"));
        }
        return Some(Assessment {
            consistent_with: "a hardware-level error Windows logged — commonly heat, but also power or memory".into(),
            strength,
            evidence,
            next_step: NextStep::safe(
                "Check temperatures under load, and that your memory is seated on its rated profile",
                "Watch GPU and CPU temps during a game; reseat the memory sticks and make sure the \
                 memory's rated speed profile (called XMP or EXPO in your BIOS) is switched on — both are \
                 reversible. If it keeps happening, a failing power supply is worth researching (don't \
                 change one blind).",
            ),
            beyond_us: false,
        });
    }
    None
}

/// Rule 2 — graphics-driver-consistent. The SAME GPU driver module timing out (TDR) across ≥2 crashes,
/// temps NOT high (rule 1 owns the hot case). → Strong it's the driver. Reversible: clean-reinstall.
fn rule_graphics_driver(inc: &Incident, ctx: &[Incident]) -> Option<Assessment> {
    if inc.kind != IncidentKind::GpuTimeout || is_high_temp(inc) {
        return None;
    }
    let module = inc.receipt.faulting_module.as_deref()?;
    let same_module = ctx
        .iter()
        .filter(|i| i.kind == IncidentKind::GpuTimeout && i.receipt.faulting_module.as_deref() == Some(module))
        .count();
    if same_module < 2 {
        return None;
    }
    Some(Assessment {
        consistent_with: format!("your graphics driver ({module}) repeatedly timing out"),
        strength: Strength::Strong,
        evidence: vec![
            format!("the same driver module ({module}) stopped responding across {same_module} separate crashes"),
            "the GPU temperature was not in the overheating range in those sessions".into(),
        ],
        next_step: NextStep::safe(
            "Do a clean reinstall of your graphics driver",
            "Download the latest driver for your card and install it with the 'clean install' / 'factory \
             reset' option (or remove the old one first with DDU — a free driver-cleanup tool — in Safe \
             Mode). Fully reversible — you can roll back to the previous driver from Device Manager if the \
             new one is worse.",
        ),
        beyond_us: false,
    })
}

/// Rule 3 — app-specific (not your PC). A lone app crash/hang with NO system-level event within ±10 min.
/// → Strong it's app-side. Reversible: verify game files / update.
fn rule_app_specific(inc: &Incident, ctx: &[Incident]) -> Option<Assessment> {
    if !matches!(inc.kind, IncidentKind::AppCrash | IncidentKind::AppHang) {
        return None;
    }
    if system_event_near(inc, ctx, 10) {
        return None; // a system event nearby → not safely "just the app"
    }
    let app = inc.receipt.faulting_app.as_deref().map(pretty_proc);
    let subject = app.clone().unwrap_or_else(|| "that app".to_string());
    let lead = match &app {
        Some(a) => format!("{a} closed on its own, with no system-level error logged around it"),
        None => "the app closed on its own, with no system-level error logged around it".to_string(),
    };
    Some(Assessment {
        consistent_with: format!("a problem inside {subject} itself, rather than your PC"),
        strength: Strength::Strong,
        evidence: vec![lead, "your graphics, power, and hardware logs were quiet at that moment".into()],
        next_step: NextStep::safe(
            "Verify the game's files, then update it",
            "In the launcher (Steam: right-click → Properties → Installed Files → Verify integrity of game \
             files), let it re-download anything broken, and make sure the game and its anti-cheat are \
             current. Nothing here touches the rest of your PC.",
        ),
        beyond_us: false,
    })
}

/// Rule 4 — power / hard-lock-consistent. An unexpected shutdown (Kernel-Power 41 / EventLog 6008) with
/// NO blue screen around it and temps NOT high. Inherently ambiguous → Partial, and honest about it.
fn rule_power_hardlock(inc: &Incident, ctx: &[Incident]) -> Option<Assessment> {
    if inc.kind != IncidentKind::UnexpectedShutdown || is_high_temp(inc) {
        return None;
    }
    // A BSOD nearby means Windows DID record a crash — a different story; this rule is the "no dump,
    // no blue screen" hard-lock only.
    if bluescreen_near(inc, ctx, 10) {
        return None;
    }
    Some(Assessment {
        consistent_with: "an abrupt power loss or hard lock — Windows didn't get to record why".into(),
        strength: Strength::Partial,
        evidence: vec![
            "the PC restarted without a clean shutdown, and left no blue-screen or crash dump".into(),
            "this pattern is genuinely ambiguous — it can be power delivery, a deep hardware hang, or a one-off".into(),
        ],
        next_step: NextStep::research(
            "Rule out the easy, reversible things first",
            "Reseat the power cables at both ends, try a different wall outlet or surge protector, and note \
             whether it only happens under heavy load. If it keeps happening under load, a weak or failing \
             power supply is worth researching — don't assume it, and don't open the power supply.",
        ),
        beyond_us: false,
    })
}

/// Escape hatch — a blue screen Compy won't guess at. A BSOD that didn't resolve to overheating is a
/// bugcheck with many possible causes; surface the code + send the reader to a human, never a forced rule.
fn rule_beyond_us(inc: &Incident) -> Option<Assessment> {
    if inc.kind != IncidentKind::BlueScreen {
        return None;
    }
    let code = inc.receipt.code.as_deref().unwrap_or("unknown");
    Some(Assessment {
        consistent_with: "a blue-screen crash whose stop code can point to several different things".into(),
        strength: Strength::Weak,
        evidence: vec![
            format!("Windows recorded a blue screen with stop code {code}"),
            "a stop code on its own doesn't point to one cause — guessing here would be dishonest".into(),
        ],
        next_step: NextStep::research(
            "Look up the stop code, and take the evidence to a human",
            &format!(
                "Search that stop code ({code}) on Microsoft's docs, and share this incident's receipt \
                 (the code, any faulting module, and the time) on a reputable hardware forum. That's the \
                 honest next move — this is beyond what Compy can safely narrow down for you."
            ),
        ),
        beyond_us: true,
    })
}

#[cfg(test)]
thread_local! {
    /// Test-only force-ON for `blackbox_v2_gate()` — mirrors `leftovers::QaRestoreGateBypass`. Lets the
    /// gated assess pass be exercised WITHOUT flipping the shipped gate (which stays hard-false and
    /// test-pinned). `#[cfg(test)]` compiles it out of every shipped binary; Drop disarms even on panic.
    static V2_GATE_TEST_FORCE: std::cell::RefCell<bool> = const { std::cell::RefCell::new(false) };
}
#[cfg(test)]
struct V2GateForceOn;
#[cfg(test)]
impl V2GateForceOn {
    fn begin() -> Self {
        V2_GATE_TEST_FORCE.with(|f| *f.borrow_mut() = true);
        V2GateForceOn
    }
}
#[cfg(test)]
impl Drop for V2GateForceOn {
    fn drop(&mut self) {
        V2_GATE_TEST_FORCE.with(|f| *f.borrow_mut() = false);
    }
}

/// Greedy newest-first cross-source merge: each proto either folds into an already-accepted incident
/// it matches (`same_incident`) or starts a new one. This is the "don't double-list one crash"
/// guarantee — the Event Log's 1000, WER's APPCRASH, and Reliability's 1000 for one crash collapse to
/// a single row carrying all three sources. It also subsumes the old exact-duplicate collapse.
fn merge_protos(mut protos: Vec<ProtoIncident>) -> Vec<ProtoIncident> {
    // Newest first by the true instant — NOT the RFC3339 string (offsets can differ across a DST
    // change, where text order would diverge from chronological order).
    protos.sort_by_key(|p| std::cmp::Reverse(p.when.with_timezone(&Utc)));
    let mut merged: Vec<ProtoIncident> = Vec::new();
    for p in protos {
        if let Some(acc) = merged.iter_mut().find(|a| same_incident(a, &p)) {
            merge_into(acc, p);
        } else {
            merged.push(p);
        }
    }
    merged
}

/// Are these two records the same crash seen by (possibly) different sources? Same family, within
/// the cross-source window, and — for app crashes/hangs — the same app when both name one. A record
/// that names no app (e.g. a reliability row we couldn't parse) acts as a wildcard within the window,
/// so it folds in rather than double-listing. System families (shutdown/BSOD/WHEA/TDR) match on
/// family + window alone (a Kernel-Power 41 and an EventLog 6008 from the same dirty shutdown collapse).
fn same_incident(a: &ProtoIncident, b: &ProtoIncident) -> bool {
    if a.kind != b.kind {
        return false;
    }
    let dt = (a.when.with_timezone(&Utc) - b.when.with_timezone(&Utc))
        .num_seconds()
        .abs();
    if dt > CROSS_SOURCE_WINDOW_SECS {
        return false;
    }
    match a.kind {
        IncidentKind::AppCrash | IncidentKind::AppHang => {
            match (norm_app(&a.fields.faulting_app), norm_app(&b.fields.faulting_app)) {
                (Some(x), Some(y)) => x == y, // both name an app → must be the same app
                _ => true,                    // one side unknown → the time window is enough
            }
        }
        _ => true, // system families: same family within the window is the same incident
    }
}

/// Normalize an app name for comparison: strip `.exe`, lowercase. So "Game.exe" == "game.exe".
/// Deliberately NOT `pretty_proc` — matching stays on the raw binary name (minus extension); a
/// launcher exe and its "-Win64-Shipping" binary are different processes and must not merge.
pub(crate) fn norm_app(a: &Option<String>) -> Option<String> {
    a.as_deref().map(|s| {
        let n = s.trim();
        n.strip_suffix(".exe")
            .or_else(|| n.strip_suffix(".EXE"))
            .unwrap_or(n)
            .to_ascii_lowercase()
    })
}

/// Fold `other` into `acc`: keep `acc`'s (newest) time, fill any field `acc` is missing from the
/// corroborating source, union the event IDs + source labels, keep the richer raw detail.
fn merge_into(acc: &mut ProtoIncident, other: ProtoIncident) {
    if acc.fields.faulting_app.is_none() {
        acc.fields.faulting_app = other.fields.faulting_app;
    }
    if acc.fields.faulting_module.is_none() {
        acc.fields.faulting_module = other.fields.faulting_module;
    }
    if acc.fields.code.is_none() {
        acc.fields.code = other.fields.code;
    }
    if acc.fields.driver.is_none() {
        acc.fields.driver = other.fields.driver;
    }
    for id in other.event_ids {
        if !acc.event_ids.contains(&id) {
            acc.event_ids.push(id);
        }
    }
    for s in other.sources {
        if !acc.sources.contains(&s) {
            acc.sources.push(s);
        }
    }
    if other.detail.chars().count() > acc.detail.chars().count() {
        acc.detail = other.detail;
    }
}

// ─── Per-source → ProtoIncident converters (pure) ──────────────────────────

/// Event Log row → proto. Reused for the over-fetched System+Application events.
fn event_to_proto(ev: &RawEvent) -> Option<ProtoIncident> {
    let kind = classify_incident(&ev.provider, ev.id)?;
    let when = parse_ts(&ev.time)?; // no fabricated timestamps
    Some(ProtoIncident {
        kind,
        when,
        fields: extract_fields(kind, ev),
        sources: vec![format!("{} · {} {}", source_channel(kind), ev.provider, ev.id)],
        detail: short_detail(&ev.message),
        event_ids: vec![ev.id],
    })
}

/// WER `Report.wer` → proto. Carries the faulting app/module/exception for crashes Windows kept a
/// report for; merges with an Event Log 1000 for the same crash (and surfaces alone when the Event
/// Log already rotated that crash out — "catches what the Event Log alone misses").
fn wer_to_proto(w: &WerReport) -> Option<ProtoIncident> {
    let kind = classify_wer(&w.event_type)?;
    let when = parse_ts(&w.when)?;
    Some(ProtoIncident {
        kind,
        when,
        fields: IncidentFields {
            faulting_app: w.app.clone(),
            faulting_module: w.module.clone(),
            code: w.code.clone(),
            driver: None,
        },
        sources: vec![format!("Windows Error Reporting · {}", w.event_type)],
        detail: w.detail.clone(),
        event_ids: Vec::new(), // WER has no event id
    })
}

/// Reliability record → proto. Event-log-shaped, so the same classifier applies; the friendly
/// message also yields the app/module/code when present (the merge fills the rest from Event Log/WER).
fn reliability_to_proto(r: &ReliabilityRecord) -> Option<ProtoIncident> {
    let kind = classify_incident(&r.source_name, r.id)?;
    let when = parse_ts(&r.time)?;
    let mut fields = IncidentFields::default();
    match kind {
        IncidentKind::AppCrash => {
            fields.faulting_app = reliability_app(r);
            fields.faulting_module =
                scan_field(&r.message, "faulting module name: ", &[',', '\r', '\n']);
            fields.code = scan_field(&r.message, "exception code: ", &[' ', ',', '\r', '\n'])
                .map(|c| fmt_hex_code(&c));
        }
        IncidentKind::AppHang => fields.faulting_app = reliability_app(r),
        IncidentKind::BlueScreen => {
            fields.code = scan_field(&r.message, "bugcheck was: ", &[' ', ',', '\r', '\n']);
        }
        _ => {}
    }
    Some(ProtoIncident {
        kind,
        when,
        fields,
        sources: vec![format!("Reliability history · {} {}", r.source_name, r.id)],
        detail: short_detail(&r.message),
        event_ids: vec![r.id],
    })
}

/// Best app name for a reliability record: `ProductName` is the bare exe ("claude.exe") for app
/// crashes/hangs and "Windows" for system events — use it for app families, else parse the message.
fn reliability_app(r: &ReliabilityRecord) -> Option<String> {
    let p = r.product.trim();
    if !p.is_empty() && !p.eq_ignore_ascii_case("Windows") {
        return Some(p.to_string());
    }
    parse_app_from_message(&r.message)
}

/// Pull an app name out of a reliability message: "Faulting application name: X," (App Error 1000)
/// or "The program X version …" (App Hang 1002). None when neither pattern matches.
fn parse_app_from_message(msg: &str) -> Option<String> {
    let lower = msg.to_ascii_lowercase();
    if let Some(i) = lower.find("application name: ") {
        let rest = &msg[i + "application name: ".len()..];
        let end = rest.find(',').unwrap_or(rest.len());
        let name = rest[..end].trim();
        if !name.is_empty() {
            return Some(name.to_string());
        }
    }
    if let Some(i) = lower.find("the program ") {
        let rest = &msg[i + "the program ".len()..];
        let end = rest
            .to_ascii_lowercase()
            .find(" version")
            .unwrap_or(rest.len());
        let name = rest[..end].trim();
        if !name.is_empty() {
            return Some(name.to_string());
        }
    }
    None
}

/// Pull `value` out of a `key: value` fragment of a message; stops at the first terminator (or end).
/// Case-insensitive key match. `None` if absent/empty. Used for reliability module/exception/bugcheck.
fn scan_field(msg: &str, key_lower: &str, terminators: &[char]) -> Option<String> {
    let lower = msg.to_ascii_lowercase();
    let i = lower.find(key_lower)?;
    let rest = &msg[i + key_lower.len()..];
    let end = rest.find(terminators).unwrap_or(rest.len());
    let v = rest[..end].trim();
    (!v.is_empty()).then(|| v.to_string())
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

/// Reduce one identity component to a bare, comparable token: the file-NAME only, trimmed and
/// lowercased. Empty and whitespace-only collapse to `None`, so an absent field and a blank one
/// hash identically rather than producing two identities for one crash.
///
/// The basename step is the load-bearing one. `faulting_app`/`faulting_module` normally arrive as
/// bare names, but WER and Reliability both *can* hand back a full path, and a path names the
/// user's profile directory or a game's install location. This identity is persisted to disk by the
/// observer and handed to the webview as a deep-link selector, so a path must never survive into it
/// — hashing does not make a path safe, it makes it unauditable.
fn identity_token(value: Option<&str>) -> Option<String> {
    let raw = value?.trim();
    let base = raw.rsplit(['\\', '/']).next().unwrap_or(raw).trim();
    if base.is_empty() {
        return None;
    }
    Some(base.to_ascii_lowercase())
}

/// Stable, path-free identity for one MERGED incident.
///
/// Derived from what makes a crash the crash it is — family, instant, and the app/module/code
/// Windows named — hashed so the result is a fixed-width opaque token rather than a smuggled
/// filename. Sixteen hex characters (64 bits); these are compared for equality inside one machine's
/// own bounded observation list, never used as a cryptographic commitment.
///
/// STABILITY, stated honestly: this is exactly as stable as `when` is. `merge_into` keeps the
/// NEWEST time when a second source corroborates a crash, so an incident whose WER report is
/// written after its Event Log entry can present a different instant — and therefore a different id
/// — on a later scan. That is why the observer does not rely on this id alone: its per-app/family
/// cooldown (`incident_observer.rs`) is what absorbs a re-identified incident, and the id's job is
/// only to make the common case exact. A coarser time bucket was rejected on purpose: crashes 60s
/// apart are already separate rows by `same_incident`, and bucketing would silently fuse a
/// crash-loop's repeats into one.
fn incident_id_for(kind: IncidentKind, when_utc: DateTime<Utc>, fields: &IncidentFields) -> String {
    use sha2::{Digest, Sha256};
    let module = fields.faulting_module.as_deref().or(fields.driver.as_deref());
    // Field-separated with a byte that cannot occur in any component, so ("ab", "c") and ("a",
    // "bc") cannot collide into the same pre-image.
    let mut h = Sha256::new();
    h.update(kind.tag().as_bytes());
    h.update([0u8]);
    h.update(when_utc.to_rfc3339().as_bytes());
    for part in [
        identity_token(fields.faulting_app.as_deref()),
        identity_token(module),
        identity_token(fields.code.as_deref()),
    ] {
        h.update([0u8]);
        h.update(part.unwrap_or_default().as_bytes());
    }
    h.finalize().iter().take(8).map(|b| format!("{b:02x}")).collect()
}

fn build_receipt(p: &ProtoIncident) -> Receipt {
    Receipt {
        source: p.sources.join(" + "),
        event_ids: p.event_ids.clone(),
        faulting_app: p.fields.faulting_app.clone(),
        // For a TDR the "module" the user cares about is the GPU driver.
        faulting_module: p.fields.faulting_module.clone().or_else(|| p.fields.driver.clone()),
        code: p.fields.code.clone(),
        detail: p.detail.clone(),
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

/// Prettify for DISPLAY; empty/blank → None (no fabricated game name).
pub(crate) fn pretty_proc_opt(name: &str) -> Option<String> {
    let n = name.trim();
    if n.is_empty() {
        return None;
    }
    Some(pretty_proc(n))
}

/// DISPLAY prettifier — the shared one, so headlines strip ".exe" AND the Unreal/GDK
/// "-Win64-Shipping" wrappers exactly like every other surface. MATCHING never uses this.
fn pretty_proc(name: &str) -> String {
    crate::intelligence::pretty_game_name(name)
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

/// FILETIME (100ns ticks since 1601-01-01 UTC, as WER's `EventTime` carries) → UTC instant.
fn filetime_to_utc(ft: u64) -> Option<DateTime<Utc>> {
    const EPOCH_DIFF_SECS: i64 = 11_644_473_600; // 1601-01-01 → 1970-01-01
    let secs = (ft / 10_000_000) as i64 - EPOCH_DIFF_SECS;
    let nanos = ((ft % 10_000_000) * 100) as u32;
    DateTime::<Utc>::from_timestamp(secs, nanos)
}

// ─── Thin collectors (the edge — dumb OS reads; logic lives in the pure core above) ──

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
            // Windows PowerShell 5.1 hands the `@(...)` calculated property to ConvertTo-Json
            // wrapped in a PSObject, so the array arrives as `{"value":[...],"Count":n}` (#540).
            serde_json::Value::Object(o) => match powershell_array_wrapper(o) {
                Some(a) => a.iter().map(value_to_string).collect(),
                // Any other object is unreadable: unknown, never its JSON text.
                None => Vec::new(),
            },
            serde_json::Value::Null => Vec::new(),
            // PowerShell's ConvertTo-Json unwraps a single-element array to a scalar.
            other => vec![value_to_string(other)],
        }
    }
}

/// The array inside Windows PowerShell 5.1's `{"value":[...],"Count":n}` wrapper (#540), matched by
/// its whole signature: exactly the keys `value` and `Count`, and `Count` equal to the array's
/// length. Key case is ignored because the observer's persisted rows went through `norm_app`. Any
/// other object is `None`, so an unrelated shape never becomes event fields.
pub(crate) fn powershell_array_wrapper(
    o: &serde_json::Map<String, serde_json::Value>,
) -> Option<&Vec<serde_json::Value>> {
    if o.len() != 2 {
        return None;
    }
    let field = |name: &str| o.iter().find(|(k, _)| k.eq_ignore_ascii_case(name)).map(|(_, v)| v);
    let values = field("value")?.as_array()?;
    let count = usize::try_from(field("count")?.as_u64()?).ok()?;
    (count == values.len()).then_some(values)
}

/// One field as text. A nested object/array is not a field value, so it reads blank (unknown)
/// rather than as JSON text a headline would print verbatim (#540).
fn value_to_string(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Null | serde_json::Value::Object(_) | serde_json::Value::Array(_) => {
            String::new()
        }
    }
}

/// A WER report, parsed from a `Report.wer` file. `when` is RFC3339 (UTC from `EventTime`; the
/// collector re-stamps it to the local offset for display).
#[derive(Default, Debug, Clone, PartialEq)]
struct WerReport {
    event_type: String,
    when: String,
    app: Option<String>,
    module: Option<String>,
    code: Option<String>,
    detail: String,
}

/// One `Win32_ReliabilityRecords` row, as projected by the read-only CIM query.
#[derive(serde::Deserialize, Default, Debug)]
struct ReliabilityRecord {
    #[serde(default, rename = "source")]
    source_name: String,
    #[serde(default)]
    id: u32,
    #[serde(default)]
    time: String,
    #[serde(default)]
    message: String,
    #[serde(default)]
    product: String,
}

/// Every (channel, provider, event ids) the Event Log reader asks Windows for. ONE table: the query is
/// built from it, and `event_log_query_is_provider_scoped` proves each pair classifies, so the reader
/// can never again fetch by id alone and let a noisy provider crowd real incidents out (#544).
/// `BugCheck` is the older name for the blue-screen source; current builds log it as
/// SystemErrorReporting. Asking for an absent provider simply matches nothing.
const EVENT_LOG_SOURCES: &[(&str, &str, &[u32])] = &[
    ("System", "Microsoft-Windows-Kernel-Power", &[41]),
    ("System", "EventLog", &[6008]),
    ("System", "Microsoft-Windows-WER-SystemErrorReporting", &[1001]),
    ("System", "BugCheck", &[1001]),
    ("System", "Microsoft-Windows-WHEA-Logger", &[17, 18, 19]),
    ("System", "Display", &[4101]),
    ("Application", "Application Error", &[1000]),
    ("Application", "Application Hang", &[1002]),
];

/// Newest matching rows read from EACH channel, so a busy Application log cannot push System's
/// shutdowns and blue screens out of the result.
const EVENTS_PER_CHANNEL: u32 = 40;

/// Pure: the provider-scoped XPath query for one channel, or `None` when the table names no source
/// there. Attribute values use single quotes; `event_log_script` escapes them for PowerShell.
fn event_log_query_xml(channel: &str) -> Option<String> {
    let selects: Vec<String> = EVENT_LOG_SOURCES
        .iter()
        .filter(|(c, _, _)| *c == channel)
        .map(|(_, provider, ids)| {
            let ids: Vec<String> = ids.iter().map(|id| format!("EventID={id}")).collect();
            format!(
                "<Select Path='{channel}'>*[System[Provider[@Name='{provider}'] and ({})]]</Select>",
                ids.join(" or ")
            )
        })
        .collect();
    if selects.is_empty() {
        return None;
    }
    Some(format!(
        "<QueryList><Query Id='0' Path='{channel}'>{}</Query></QueryList>",
        selects.concat()
    ))
}

/// Pure: the whole read-only reader script — one capped, provider-scoped read per channel, in table
/// order, then the same row projection the parser has always consumed.
fn event_log_script() -> String {
    let mut channels: Vec<&str> = Vec::new();
    for (channel, _, _) in EVENT_LOG_SOURCES {
        if !channels.contains(channel) {
            channels.push(*channel);
        }
    }
    let reads: Vec<String> = channels
        .into_iter()
        .filter_map(event_log_query_xml)
        .map(|xml| {
            format!(
                "@(Get-WinEvent -FilterXml '{}' -MaxEvents {EVENTS_PER_CHANNEL})",
                xml.replace('\'', "''")
            )
        })
        .collect();
    format!(
        "$ErrorActionPreference='SilentlyContinue';$e = {};{}",
        reads.join(" + "),
        EVENT_LOG_PROJECTION
    )
}

/// The row projection `parse_events_json` reads: time, id, provider, message, and `props` from
/// EventData.
const EVENT_LOG_PROJECTION: &str = "@($e |\
 Select-Object @{n='time';e={$_.TimeCreated.ToString('o')}}, @{n='id';e={[int]$_.Id}}, @{n='provider';e={[string]$_.ProviderName}}, @{n='message';e={[string]$_.Message}}, @{n='props';e={@($_.Properties | ForEach-Object {[string]$_.Value})}}) |\
 ConvertTo-Json -Depth 4 -Compress";

/// Read the crash/instability events Windows recorded (System + Application channels). Read-only,
/// non-elevated, no window. Returns the parsed rows and an optional "skipped" note if the reader
/// could not run at all (a clean machine returns an empty list, NOT a skip).
fn collect_event_log() -> (Vec<RawEvent>, Option<String>) {
    // Ask only for the (provider, id) pairs the classifier recognizes, capped PER CHANNEL. The old
    // id-only query let 8,500+ routine "Windows Error Reporting" 1001 notices fill its single 80-row
    // cap, so no shutdown, crash or blue screen ever reached this collector (#544). `EventData` →
    // `props` gives language-independent faulting app/module/code. Errors are swallowed
    // (SilentlyContinue) so "no events found" on a clean machine yields empty output, not a failure.
    let script = event_log_script();
    let Ok(out) = crate::actions::quiet_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script.as_str()])
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

/// #540 fixture: one Application Hang 1002 row exactly as Windows PowerShell 5.1 emits it from
/// `EVENTS_SCRIPT`, with `props` as the `{"value":[...],"Count":n}` wrapper rather than an array.
#[cfg(test)]
pub(crate) const PS51_WRAPPED_HANG_JSON: &str = r#"[{"time":"2026-09-23T10:15:00.0000000-07:00","id":1002,"provider":"Application Hang","message":"The program dllhost.exe version 10.0.26100.1 stopped interacting with Windows and was closed.","props":{"value":["dllhost.exe","10.0.26100.1","1a2c","01dc2c7f00000000","5000","C:\\Windows\\System32\\dllhost.exe","0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0","","","Unknown"],"Count":10}}]"#;

/// Test seam: raw collector JSON → the assembled incident list, through the real pipeline.
#[cfg(test)]
pub(crate) fn incidents_from_event_json(json: &str) -> Vec<Incident> {
    assemble_incidents(parse_events_json(json), Vec::new(), Vec::new(), &[])
}

/// Test helper: a user-facing string carries no JSON punctuation or PowerShell wrapper keys.
#[cfg(test)]
pub(crate) fn assert_no_raw_json(field: &str, text: &str) {
    for leak in ["{", "}", "[", "]", "\"Count\"", "\"value\""] {
        assert!(!text.contains(leak), "{field} carries raw JSON ({leak:?}): {text}");
    }
}

/// Read the WER `Report.wer` files (`ReportArchive` + `ReportQueue`). Read-only file reads, no
/// network. App-crash/hang reports are readable non-elevated; `Kernel_*` reports are admin-only, so a
/// PermissionDenied is reported as a *skipped* source (the elevation-honesty hard line), never errored.
fn collect_wer() -> (Vec<WerReport>, Option<String>) {
    let mut reports = Vec::new();
    let mut needs_admin = false;
    let pd = std::env::var("ProgramData").unwrap_or_else(|_| "C:\\ProgramData".into());
    let mut budget = 400usize; // bound the folder walk on a pathological WER dir
    for sub in ["ReportArchive", "ReportQueue"] {
        let base = std::path::Path::new(&pd)
            .join("Microsoft")
            .join("Windows")
            .join("WER")
            .join(sub);
        let Ok(entries) = std::fs::read_dir(&base) else {
            continue; // folder missing → nothing to read here (not a skip)
        };
        for entry in entries.flatten() {
            if budget == 0 {
                break;
            }
            budget -= 1;
            let report = entry.path().join("Report.wer");
            match std::fs::read(&report) {
                Ok(bytes) => {
                    if let Some(mut w) = parse_wer(&decode_wer_bytes(&bytes)) {
                        // EventTime is UTC; re-stamp to the local offset so the display reads local.
                        if let Ok(dt) = DateTime::parse_from_rfc3339(&w.when) {
                            w.when = dt.with_timezone(&chrono::Local).to_rfc3339();
                        }
                        reports.push(w);
                    }
                }
                Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => needs_admin = true,
                Err(_) => {} // missing/other → skip this one silently
            }
        }
    }
    let skip =
        needs_admin.then(|| "Windows Error Reporting (some kernel reports need administrator)".to_string());
    (reports, skip)
}

/// Decode `Report.wer` bytes: Windows writes them UTF-16 LE (BOM `FF FE`); tolerate UTF-8 (with/out
/// BOM) too. Lossy — a malformed byte becomes U+FFFD, never a panic.
fn decode_wer_bytes(bytes: &[u8]) -> String {
    if bytes.len() >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE {
        let u16s: Vec<u16> = bytes[2..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|c| u16::from_le_bytes([c[0], c[1]]))
            .collect();
        String::from_utf16_lossy(&u16s)
    } else if bytes.len() >= 3 && bytes[0] == 0xEF && bytes[1] == 0xBB && bytes[2] == 0xBF {
        String::from_utf8_lossy(&bytes[3..]).into_owned()
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    }
}

/// Pure: parse a `Report.wer` body (key=value INI, plus `Sig[i].Name`/`Sig[i].Value` pairs) into the
/// fields v1 surfaces. `None` only when there's no `EventType`. App name prefers the real exe
/// (`OriginalFilename`/`NsAppName`) over a packaged app's `praid:` alias so it dedups with Event Log.
fn parse_wer(text: &str) -> Option<WerReport> {
    let mut map: HashMap<String, String> = HashMap::new();
    let mut sig_names: HashMap<usize, String> = HashMap::new();
    let mut sig_values: HashMap<usize, String> = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let (k, v) = (k.trim(), v.trim());
        if let Some(idx) = sig_index(k, ".Name") {
            sig_names.insert(idx, v.to_string());
        } else if let Some(idx) = sig_index(k, ".Value") {
            sig_values.insert(idx, v.to_string());
        } else {
            map.insert(k.to_string(), v.to_string());
        }
    }
    let event_type = map.get("EventType").cloned()?;
    let sig = |name: &str| -> Option<String> {
        sig_names
            .iter()
            .find(|(_, n)| n.eq_ignore_ascii_case(name))
            .and_then(|(i, _)| sig_values.get(i).cloned())
            .filter(|s| !s.trim().is_empty())
    };
    let app = wer_pick(map.get("OriginalFilename"))
        .or_else(|| wer_pick(map.get("NsAppName")))
        .or_else(|| sig("Application Name").and_then(|s| wer_pick(Some(&s))));
    let module = sig("Fault Module Name");
    let code = sig("Exception Code").map(|c| fmt_hex_code(&c));
    let when = map
        .get("EventTime")
        .and_then(|s| s.trim().parse::<u64>().ok())
        .and_then(filetime_to_utc)
        .map(|dt| dt.to_rfc3339())
        .unwrap_or_default();
    let detail = wer_detail(&event_type, app.as_deref(), module.as_deref(), code.as_deref());
    Some(WerReport {
        event_type,
        when,
        app,
        module,
        code,
        detail,
    })
}

/// Parse the index out of a `Sig[<n>]<suffix>` key (e.g. `Sig[3].Name` → 3). Ignores `DynamicSig[…]`.
fn sig_index(key: &str, suffix: &str) -> Option<usize> {
    let inner = key.strip_prefix("Sig[")?;
    let close = inner.find(']')?;
    let idx: usize = inner[..close].parse().ok()?;
    if inner[close + 1..].eq_ignore_ascii_case(suffix) {
        Some(idx)
    } else {
        None
    }
}

/// Keep a WER value only if it's a real name — drop empty + packaged-app `praid:` aliases.
fn wer_pick(v: Option<&String>) -> Option<String> {
    let s = v?.trim();
    if s.is_empty() || s.to_ascii_lowercase().starts_with("praid:") {
        None
    } else {
        Some(s.to_string())
    }
}

/// Plain-English raw detail for a WER-sourced incident (shown only when WER is the sole source).
fn wer_detail(event_type: &str, app: Option<&str>, module: Option<&str>, code: Option<&str>) -> String {
    let mut s = format!("Windows Error Reporting recorded a {event_type} report");
    if let Some(a) = app {
        s.push_str(&format!(" for {a}"));
    }
    if let Some(m) = module {
        s.push_str(&format!("; fault module {m}"));
    }
    if let Some(c) = code {
        s.push_str(&format!("; exception {c}"));
    }
    s.push('.');
    s
}

/// Read the friendly Reliability timeline (`Win32_ReliabilityRecords`, read-only CIM). Filtered to
/// the crash-relevant event IDs; the rest (installs, updates) are dropped at the source. A run
/// failure → a "couldn't read" skip; an empty result on a clean machine → no skip.
fn collect_reliability() -> (Vec<ReliabilityRecord>, Option<String>) {
    let script = "$ErrorActionPreference='SilentlyContinue';\
@(Get-CimInstance -ClassName Win32_ReliabilityRecords -ErrorAction SilentlyContinue |\
 Where-Object { @(41,1001,17,18,19,4101,1000,1002,6008) -contains [int]$_.EventIdentifier } |\
 Sort-Object TimeGenerated -Descending | Select-Object -First 120 |\
 ForEach-Object { [pscustomobject]@{ source=[string]$_.SourceName; id=[int]$_.EventIdentifier; time=$_.TimeGenerated.ToString('o'); message=[string]$_.Message; product=[string]$_.ProductName } }) |\
 ConvertTo-Json -Depth 3 -Compress";
    let Ok(out) = crate::actions::quiet_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .output()
    else {
        return (Vec::new(), Some("Reliability history (couldn't run the reader)".into()));
    };
    let stdout = String::from_utf8_lossy(&out.stdout);
    let trimmed = stdout.trim();
    if trimmed.is_empty() {
        return (Vec::new(), None);
    }
    (parse_reliability_json(trimmed), None)
}

/// Tolerant parse of the reliability JSON (array / single-object / garbage → drop-or-empty, no panic).
fn parse_reliability_json(s: &str) -> Vec<ReliabilityRecord> {
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
        .filter_map(|i| serde_json::from_value::<ReliabilityRecord>(i).ok())
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
    let (wer, wer_skip) = collect_wer();
    let (reliability, rel_skip) = collect_reliability();
    let mut skipped_sources: Vec<String> =
        [ev_skip, wer_skip, rel_skip].into_iter().flatten().collect();
    if let Some(note) = minidump_skip_note() {
        skipped_sources.push(note);
    }
    let sessions = crate::sessions::get_session_summaries();
    BlackBoxReport {
        incidents: assemble_incidents(events, wer, reliability, &sessions),
        skipped_sources,
    }
}

// ─── Pure-core tests (the collectors are a thin edge; logic + invariants are pinned here) ────────
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
            compy_changes_active: Some(0),
            compy_changes_per_change: true,
            compy_changes_cant_confirm: Some(0),
            compy_changes_legacy_active: None,
            hw_fingerprint: None,
            gaming_mode_active: None,
            stutter_insight: None,
            stutter_timeline: Vec::new(),
            stutter_events: Vec::new(),
            fps_series: Vec::new(),
            capture_capabilities: None,
            game_state: None,
            peak_cpu_temp_c: None,
            peak_gpu_hotspot_temp_c: None,
        }
    }

    /// Test convenience: assemble from Event Log rows only (the most common case in the suite).
    fn from_events(events: Vec<RawEvent>, sessions: &[SessionSummary]) -> Vec<Incident> {
        assemble_incidents(events, Vec::new(), Vec::new(), sessions)
    }

    fn wer(event_type: &str, when: &str, app: Option<&str>, module: Option<&str>, code: Option<&str>) -> WerReport {
        WerReport {
            event_type: event_type.into(),
            when: when.into(),
            app: app.map(Into::into),
            module: module.map(Into::into),
            code: code.map(Into::into),
            detail: wer_detail(event_type, app, module, code),
        }
    }

    fn rel(source: &str, id: u32, time: &str, message: &str, product: &str) -> ReliabilityRecord {
        ReliabilityRecord {
            source_name: source.into(),
            id,
            time: time.into(),
            message: message.into(),
            product: product.into(),
        }
    }

    #[test]
    fn classifies_every_event_family_correctly() {
        use IncidentKind::*;
        assert_eq!(classify_incident("Microsoft-Windows-Kernel-Power", 41), Some(UnexpectedShutdown));
        assert_eq!(classify_incident("EventLog", 6008), Some(UnexpectedShutdown));
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
        assert_eq!(classify_incident("Some-Other-Source", 6008), None, "6008 only counts from EventLog");
    }

    #[test]
    fn classify_wer_maps_crash_families_and_drops_the_rest() {
        use IncidentKind::*;
        assert_eq!(classify_wer("APPCRASH"), Some(AppCrash));
        assert_eq!(classify_wer("BEX64"), Some(AppCrash));
        assert_eq!(classify_wer("MoBEX"), Some(AppCrash));
        assert_eq!(classify_wer("MoAppCrash"), Some(AppCrash));
        assert_eq!(classify_wer("CLR20r3"), Some(AppCrash));
        assert_eq!(classify_wer("AppHang"), Some(AppHang));
        assert_eq!(classify_wer("AppHangB1"), Some(AppHang));
        assert_eq!(classify_wer("AppHangXProcB1"), Some(AppHang));
        // unknown / non-crash event types are dropped, never guessed at
        assert_eq!(classify_wer("WindowsUpdateFailure3"), None);
        assert_eq!(classify_wer("PnPDeviceProblem"), None);
        assert_eq!(classify_wer(""), None);
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
        assert!(from_events(Vec::new(), &[]).is_empty());
        assert!(assemble_incidents(Vec::new(), Vec::new(), Vec::new(), &[]).is_empty());
    }

    #[test]
    fn assemble_keeps_only_known_events_and_sorts_newest_first() {
        let events = vec![
            ev("Application Error", 1000, "2026-06-12T20:00:00-07:00", "Faulting application game.exe",
               serde_json::json!(["game.exe", "1.0", "ts", "ntdll.dll", "1.0", "ts", "c0000005"])),
            ev("Totally-Unknown", 1000, "2026-06-12T23:00:00-07:00", "noise", serde_json::Value::Null),
            ev("Display", 4101, "2026-06-12T22:00:00-07:00", "Display driver amdkmdag stopped responding and has successfully recovered.", serde_json::Value::Null),
        ];
        let out = from_events(events, &[]);
        assert_eq!(out.len(), 2, "the unknown-provider event is dropped");
        assert_eq!(out[0].tag, "GPU timeout", "22:00 is newer than 20:00 → first");
        assert_eq!(out[1].tag, "App crash");
        // No session overlapped → honest absence of vitals.
        assert!(out[0].vitals.is_none() && out[1].vitals.is_none());
    }

    #[test]
    fn unparseable_timestamp_drops_the_event_without_panicking() {
        let events = vec![ev("Display", 4101, "not-a-timestamp", "Display driver x stopped", serde_json::Value::Null)];
        assert!(from_events(events, &[]).is_empty(), "bad ts → dropped, no fabricated time, no panic");
    }

    #[test]
    fn app_crash_headline_names_the_app_and_carries_the_receipt() {
        let events = vec![ev(
            "Application Error", 1000, "2026-06-12T21:42:00-07:00",
            "Faulting application name: Helldivers2.exe, faulting module ntdll.dll",
            serde_json::json!(["Helldivers2.exe", "1.0", "ts", "ntdll.dll", "1.0", "ts", "c0000005"]),
        )];
        let out = from_events(events, &[]);
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
        let out = from_events(events, &sessions);
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
        let out = from_events(events, &sessions);
        assert!(!out[0].headline.contains("while game was running"), "no redundant clause: {}", out[0].headline);
        assert!(out[0].vitals.is_some(), "vitals still attached even though the clause is suppressed");
    }

    #[test]
    fn caps_at_max_incidents() {
        let events: Vec<RawEvent> = (0..40)
            .map(|i| ev("Application Hang", 1002, &format!("2026-06-12T{:02}:00:00Z", i % 24), "hang",
                serde_json::json!([format!("app{i}.exe")])))
            .collect();
        assert!(from_events(events, &[]).len() <= MAX_INCIDENTS);
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

    /// #540: Windows PowerShell 5.1 serializes the collector's `@(...)` calculated property as the
    /// object `{"value":[...],"Count":n}`. That is the array, and it must decode as one; any OTHER
    /// object or nested value is unreadable, and unreadable stays unknown — never raw JSON text.
    #[test]
    fn props_unwraps_the_powershell_array_wrapper_and_never_stringifies_an_object() {
        let wrapped = ev("Application Hang", 1002, "t", "m",
            serde_json::json!({"value": ["dllhost.exe", "10.0"], "Count": 2}));
        assert_eq!(wrapped.props(), vec!["dllhost.exe", "10.0"]);
        let unknown = ev("Application Hang", 1002, "t", "m", serde_json::json!({"Length": 3}));
        assert!(unknown.props().is_empty(), "an object that is not the wrapper is unknown, got {:?}", unknown.props());
        let nested = ev("Application Error", 1000, "t", "m", serde_json::json!([{"a": 1}, ["b"], "c.exe"]));
        assert_eq!(nested.props(), vec!["", "", "c.exe"], "a nested value is a blank field, not JSON text");
    }

    /// #540 review: only the WHOLE 5.1 wrapper signature is the array. An object that merely carries
    /// a `value` array (no `Count`, a `Count` that is not its length, or another key) is some other
    /// shape, and an unrecognized shape stays unknown rather than becoming invented event fields.
    #[test]
    fn props_reads_only_the_exact_powershell_wrapper_signature() {
        for not_the_wrapper in [
            serde_json::json!({"value": ["a.exe", "1.0"]}),
            serde_json::json!({"value": ["a.exe", "1.0"], "Count": 3}),
            serde_json::json!({"value": ["a.exe", "1.0"], "Count": "2"}),
            serde_json::json!({"value": ["a.exe", "1.0"], "Count": 2, "Length": 2}),
        ] {
            let e = ev("Application Error", 1000, "t", "m", not_the_wrapper.clone());
            assert!(e.props().is_empty(), "{not_the_wrapper} is not the wrapper, got {:?}", e.props());
        }
    }

    /// #540 bug→guard. Health's care notice printed `{"Count":10,"value":["dllhost.exe",...]}` as
    /// the incident sentence on the owner's rig: the 5.1 wrapper above was stringified into ONE prop,
    /// that prop became the faulting app, and the headline and app label carried it verbatim. This
    /// feeds the collector's exact wire shape through the real parse → assemble pipeline.
    #[test]
    fn a_powershell_wrapped_props_row_yields_a_plain_english_headline() {
        let out = incidents_from_event_json(PS51_WRAPPED_HANG_JSON);
        assert_eq!(out.len(), 1, "the hang row must survive parsing");
        let i = &out[0];
        assert_eq!(i.receipt.faulting_app.as_deref(), Some("dllhost.exe"));
        assert!(i.headline.starts_with("dllhost stopped responding (froze)"), "headline: {}", i.headline);
        for (field, text) in [("headline", i.headline.as_str()), ("receipt.detail", i.receipt.detail.as_str())] {
            assert_no_raw_json(field, text);
        }
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

    // ── incident_id: the Care observer's identity for a merged incident (Tier 1 task 9) ──

    fn ifields(app: Option<&str>, module: Option<&str>, code: Option<&str>) -> IncidentFields {
        IncidentFields {
            faulting_app: app.map(Into::into),
            faulting_module: module.map(Into::into),
            code: code.map(Into::into),
            driver: None,
        }
    }

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[test]
    fn an_incident_id_is_sixteen_lowercase_hex_characters() {
        let id = incident_id_for(
            IncidentKind::AppCrash,
            utc("2026-08-20T21:42:00Z"),
            &ifields(Some("game.exe"), Some("d3d11.dll"), Some("c0000005")),
        );
        assert_eq!(id.len(), 16, "fixed width: {id}");
        assert!(id.chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()), "{id}");
    }

    #[test]
    fn the_same_incident_hashes_identically_every_time() {
        let a = incident_id_for(
            IncidentKind::GpuTimeout,
            utc("2026-08-20T21:42:00Z"),
            &ifields(None, Some("amdkmdag"), None),
        );
        let b = incident_id_for(
            IncidentKind::GpuTimeout,
            utc("2026-08-20T21:42:00Z"),
            &ifields(None, Some("amdkmdag"), None),
        );
        assert_eq!(a, b);
    }

    #[test]
    fn each_identity_component_changes_the_id() {
        let base = incident_id_for(
            IncidentKind::AppCrash,
            utc("2026-08-20T21:42:00Z"),
            &ifields(Some("game.exe"), Some("d3d11.dll"), Some("c0000005")),
        );
        let variants = [
            incident_id_for(
                IncidentKind::AppHang,
                utc("2026-08-20T21:42:00Z"),
                &ifields(Some("game.exe"), Some("d3d11.dll"), Some("c0000005")),
            ),
            incident_id_for(
                IncidentKind::AppCrash,
                utc("2026-08-20T21:43:00Z"),
                &ifields(Some("game.exe"), Some("d3d11.dll"), Some("c0000005")),
            ),
            incident_id_for(
                IncidentKind::AppCrash,
                utc("2026-08-20T21:42:00Z"),
                &ifields(Some("other.exe"), Some("d3d11.dll"), Some("c0000005")),
            ),
            incident_id_for(
                IncidentKind::AppCrash,
                utc("2026-08-20T21:42:00Z"),
                &ifields(Some("game.exe"), Some("nvlddmkm.sys"), Some("c0000005")),
            ),
            incident_id_for(
                IncidentKind::AppCrash,
                utc("2026-08-20T21:42:00Z"),
                &ifields(Some("game.exe"), Some("d3d11.dll"), Some("c0000374")),
            ),
        ];
        for v in variants {
            assert_ne!(base, v, "a changed identity component must change the id");
        }
    }

    #[test]
    fn a_windows_path_never_survives_into_an_incident_id() {
        // WER and Reliability can both hand back a full path. Two records for the SAME crash — one
        // naming a bare exe, one naming its full path — must be ONE identity, which is what proves
        // the path was reduced to its basename rather than hashed as-is.
        let bare = incident_id_for(
            IncidentKind::AppCrash,
            utc("2026-08-20T21:42:00Z"),
            &ifields(Some("game.exe"), None, None),
        );
        let pathy = incident_id_for(
            IncidentKind::AppCrash,
            utc("2026-08-20T21:42:00Z"),
            &ifields(Some(r"C:\Users\Kuya\Games\Game.exe"), None, None),
        );
        assert_eq!(bare, pathy);
    }

    #[test]
    fn an_absent_component_and_a_blank_one_are_the_same_identity() {
        let absent = incident_id_for(
            IncidentKind::BlueScreen,
            utc("2026-08-20T21:42:00Z"),
            &ifields(None, None, None),
        );
        let blank = incident_id_for(
            IncidentKind::BlueScreen,
            utc("2026-08-20T21:42:00Z"),
            &ifields(Some("   "), Some(""), None),
        );
        assert_eq!(absent, blank, "a blank field must not fork the identity");
    }

    #[test]
    fn a_tdr_falls_back_to_the_driver_name_for_its_module_component() {
        // build_receipt shows the GPU driver as the "module" for a TDR; the identity must agree,
        // otherwise two TDRs from different drivers would share an id.
        let amd = incident_id_for(
            IncidentKind::GpuTimeout,
            utc("2026-08-20T21:42:00Z"),
            &IncidentFields { driver: Some("amdkmdag".into()), ..Default::default() },
        );
        let nvidia = incident_id_for(
            IncidentKind::GpuTimeout,
            utc("2026-08-20T21:42:00Z"),
            &IncidentFields { driver: Some("nvlddmkm".into()), ..Default::default() },
        );
        assert_ne!(amd, nvidia);
    }

    #[test]
    fn every_assembled_incident_carries_a_non_empty_id() {
        let events = vec![RawEvent {
            provider: "Application Error".into(),
            id: 1000,
            time: "2026-08-20T21:42:00-05:00".into(),
            message: "Faulting application name: game.exe".into(),
            props: serde_json::Value::Null,
        }];
        let incidents = assemble_incidents(events, Vec::new(), Vec::new(), &[]);
        assert!(!incidents.is_empty(), "the fixture must produce an incident");
        for inc in &incidents {
            assert_eq!(inc.incident_id.len(), 16, "assembled incidents carry the real id");
        }
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
    fn headline_strips_shipping_suffix_like_every_other_surface() {
        // bug→guard 2026-07-17: self-review caught "Palworld-Win64-Shipping" in a Black Box
        // headline while every neighboring surface showed "Palworld" — the local prettifier
        // only stripped ".exe". Display delegates to the shared intelligence::pretty_game_name.
        let fields = IncidentFields {
            faulting_app: Some("Palworld-Win64-Shipping.exe".into()),
            faulting_module: None,
            code: None,
            driver: None,
        };
        let h = build_headline(IncidentKind::AppCrash, &fields, "yesterday evening", None);
        assert!(h.starts_with("Palworld stopped working and closed"), "headline: {h}");
        assert!(!h.contains("Win64"), "shipping suffix leaked into the headline: {h}");
        // The correlated game flows through pretty_proc_opt too, so the "while X" clause stays
        // suppressed when the crashing app IS the game (both sides prettified consistently).
        let h2 = build_headline(IncidentKind::AppCrash, &fields, "yesterday evening", Some("Palworld"));
        assert!(!h2.contains("while"), "already-named suppression broke: {h2}");
        assert_eq!(pretty_proc("Palworld-Win64-Shipping.exe"), "Palworld");
    }

    #[test]
    fn fmt_hex_code_normalizes_only_bare_hex() {
        assert_eq!(fmt_hex_code("c0000005"), "0xc0000005");
        assert_eq!(fmt_hex_code("0xC0000005"), "0xC0000005");
        assert_eq!(fmt_hex_code("STATUS_FOO"), "STATUS_FOO");
    }

    // ─── Tier 1 wire contract (#220, plan task 7) ──────────────────────────
    //
    // The crash station may CARRY a signed known-issue match, and today it never does. These tests
    // pin both halves: the field is absent in every shipped build, and when it is present it is the
    // catalog's own words under a stable wire name.
    #[test]
    fn an_incident_without_case_intelligence_omits_the_field_from_the_wire() {
        // Absent, not `null`. A v1 client and a Tier-1-aware one see byte-identical JSON while the
        // gate is off, which is what makes "absent field renders exactly as today" true by
        // construction rather than by the frontend being careful.
        let inc = mk(IncidentKind::GpuTimeout, "2026-06-12T21:00:00Z", Some("amdkmdag"), None, None, None);
        let json = serde_json::to_string(&inc).expect("serializes");
        assert!(!json.contains("case_intelligence"), "absent must not appear on the wire: {json}");
    }

    #[test]
    fn the_shipped_scan_attaches_no_case_intelligence_because_the_gate_is_off() {
        assert!(!crate::case_intelligence::case_intelligence_gate(), "Tier 1 must ship dark");
        let events = vec![ev(
            "Display",
            4101,
            "2026-06-12T21:00:00-07:00",
            "Display driver amdkmdag stopped responding and has recovered.",
            serde_json::Value::Null,
        )];
        let out = from_events(events, &[]);
        assert!(!out.is_empty(), "the fixture still produces an incident");
        assert!(
            out.iter().all(|i| i.case_intelligence.is_none()),
            "gate off ⇒ no catalog is read and no match is attached"
        );
    }

    #[test]
    fn a_present_match_rides_under_its_wire_name_and_carries_no_number() {
        // Constructed directly — there is no gate-on path in a test build, and this is a contract
        // test about the SHAPE the frontend must parse, not about the matcher.
        let mut inc = mk(IncidentKind::GpuTimeout, "2026-06-12T21:00:00Z", Some("amdkmdag"), None, None, None);
        inc.case_intelligence = Some(crate::case_intelligence::CaseIntelligenceMatch {
            case_id: "amd-tdr-adrenalin-2026-q1".into(),
            catalog_version: 7,
            level: crate::case_intelligence::CaseMatchLevel::MatchedKnownIssue,
            title: "Adrenalin 26.1.1 display timeouts on RDNA4".into(),
            summary: "AMD records display timeouts on this driver line.".into(),
            evidence_refs: vec!["faulting_module".into(), "gpu_vendor".into()],
            next_steps: Vec::new(),
            contraindications: Vec::new(),
            source_url: "https://www.amd.com/en/resources/support-articles/release-notes.html".into(),
            source_updated_at: "2026-02-01".into(),
        });
        let v = serde_json::to_value(&inc).expect("serializes");
        let m = v.get("case_intelligence").expect("present under its wire name");
        assert_eq!(m["level"], "matched_known_issue", "the level is a snake_case string, never a rank");
        assert_eq!(m["evidence_refs"][0], "faulting_module", "evidence refs are KEYS, never values");
        let json = serde_json::to_string(&inc).expect("serializes");
        assert!(!json.contains('%'), "no percentage anywhere on the wire");
        for word in ["confidence", "score", "probability"] {
            assert!(!json.contains(word), "the wire must not carry a {word}");
        }
    }

    #[test]
    fn serde_shape_is_stable_for_the_ts_contract() {
        let events = vec![ev("Microsoft-Windows-Kernel-Power", 41, "2026-06-12T21:42:00-07:00", "rebooted without cleanly shutting down", serde_json::Value::Null)];
        let report = BlackBoxReport { incidents: from_events(events, &[]), skipped_sources: vec!["x".into()] };
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
        let out = from_events(vec![make(), make()], &[]);
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
        assert!(from_events(events, &[]).is_empty());
    }

    // ── R7 — WER + Reliability sources, FILETIME, decode, cross-source merge/dedup ──

    #[test]
    fn filetime_to_utc_matches_a_known_instant() {
        // 134247866352920618 (Discord WER EventTime) ≈ 2026-06-01 11:23:55 UTC (4:23 local PDT).
        let dt = filetime_to_utc(134_247_866_352_920_618).expect("valid filetime");
        assert_eq!(dt.format("%Y-%m-%d %H:%M").to_string(), "2026-06-01 11:23");
        // The Unix epoch itself: 11644473600s × 10^7 ticks.
        let unix0 = filetime_to_utc(11_644_473_600 * 10_000_000).expect("epoch");
        assert_eq!(unix0.timestamp(), 0);
    }

    #[test]
    fn decode_wer_bytes_handles_utf16le_bom_and_utf8() {
        // UTF-16 LE with BOM (how Windows writes Report.wer).
        let mut u16 = vec![0xFFu8, 0xFE];
        for ch in "EventType=APPCRASH".encode_utf16() {
            u16.extend_from_slice(&ch.to_le_bytes());
        }
        assert_eq!(decode_wer_bytes(&u16), "EventType=APPCRASH");
        // Plain UTF-8 (no BOM) passes through.
        assert_eq!(decode_wer_bytes(b"EventType=AppHang"), "EventType=AppHang");
    }

    const SAMPLE_WER: &str = "Version=1\r\nEventType=APPCRASH\r\nEventTime=134251464743238408\r\nNsAppName=FallGuys_client_game.exe\r\nSig[0].Name=Application Name\r\nSig[0].Value=FallGuys_client_game.exe\r\nSig[3].Name=Fault Module Name\r\nSig[3].Value=EOSSDK-Win64-Shipping.dll\r\nSig[6].Name=Exception Code\r\nSig[6].Value=c0000005\r\nDynamicSig[1].Name=OS Version\r\n";

    #[test]
    fn parse_wer_pulls_type_app_module_code_and_filetime() {
        let w = parse_wer(SAMPLE_WER).expect("parses");
        assert_eq!(w.event_type, "APPCRASH");
        assert_eq!(w.app.as_deref(), Some("FallGuys_client_game.exe"), "NsAppName preferred");
        assert_eq!(w.module.as_deref(), Some("EOSSDK-Win64-Shipping.dll"), "Sig lookup is by name, not index");
        assert_eq!(w.code.as_deref(), Some("0xc0000005"), "bare hex normalized");
        // EventTime FILETIME → 2026-06-05 (the FallGuys sample).
        assert!(w.when.starts_with("2026-06-05"), "filetime parsed: {}", w.when);
    }

    #[test]
    fn parse_wer_skips_praid_alias_for_packaged_apps() {
        let text = "EventType=MoAppCrash\r\nNsAppName=praid:App\r\nSig[1].Name=Application Name\r\nSig[1].Value=praid:App\r\n";
        let w = parse_wer(text).expect("parses");
        assert_eq!(w.event_type, "MoAppCrash");
        assert!(w.app.is_none(), "praid: alias is not a usable app name");
    }

    #[test]
    fn parse_wer_requires_event_type() {
        assert!(parse_wer("Version=1\r\nNsAppName=foo.exe\r\n").is_none());
    }

    #[test]
    fn wer_only_app_crash_surfaces_as_an_incident() {
        // A crash the Event Log already rotated out but WER still has — "catches what Event Log misses".
        let reports = vec![wer("APPCRASH", "2026-06-05T08:21:15-07:00", Some("FallGuys_client_game.exe"), Some("EOSSDK.dll"), Some("0xc0000005"))];
        let out = assemble_incidents(Vec::new(), reports, Vec::new(), &[]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].tag, "App crash");
        assert!(out[0].headline.starts_with("FallGuys_client_game stopped working"));
        assert_eq!(out[0].receipt.faulting_module.as_deref(), Some("EOSSDK.dll"));
        assert!(out[0].receipt.source.contains("Windows Error Reporting"));
    }

    #[test]
    fn event_log_and_wer_for_the_same_crash_collapse_to_one_with_both_sources() {
        let events = vec![ev("Application Error", 1000, "2026-06-12T21:42:00-07:00", "crash",
            serde_json::json!(["game.exe", "1.0", "ts", "ntdll.dll", "1.0", "ts", "c0000005"]))];
        // WER for the same crash, 4s later (cross-source skew), same app.
        let reports = vec![wer("APPCRASH", "2026-06-12T21:42:04-07:00", Some("game.exe"), Some("ntdll.dll"), Some("0xc0000005"))];
        let out = assemble_incidents(events, reports, Vec::new(), &[]);
        assert_eq!(out.len(), 1, "one crash, not two rows");
        assert!(out[0].receipt.source.contains("Application Error 1000"), "Event Log source kept");
        assert!(out[0].receipt.source.contains("Windows Error Reporting"), "WER corroboration recorded");
    }

    #[test]
    fn different_apps_within_the_window_are_not_merged() {
        let events = vec![ev("Application Error", 1000, "2026-06-12T21:42:00-07:00", "a",
            serde_json::json!(["alpha.exe", "1.0", "ts", "x.dll", "1.0", "ts", "c0000005"]))];
        let reports = vec![wer("APPCRASH", "2026-06-12T21:42:10-07:00", Some("beta.exe"), Some("y.dll"), Some("0xc0000005"))];
        let out = assemble_incidents(events, reports, Vec::new(), &[]);
        assert_eq!(out.len(), 2, "alpha and beta are distinct crashes");
    }

    #[test]
    fn different_families_within_the_window_are_not_merged() {
        // A BSOD can log both BugCheck 1001 and Kernel-Power 41 — both are true and shown (v1 rule).
        let events = vec![
            ev("Microsoft-Windows-WER-SystemErrorReporting", 1001, "2026-06-12T21:42:00Z", "bugcheck 0x133", serde_json::json!(["0x133"])),
            ev("Microsoft-Windows-Kernel-Power", 41, "2026-06-12T21:42:05Z", "reboot", serde_json::Value::Null),
        ];
        let out = from_events(events, &[]);
        assert_eq!(out.len(), 2, "BSOD and unexpected-shutdown are different families");
    }

    #[test]
    fn reliability_app_crash_uses_product_name_and_merges_with_event_log() {
        let events = vec![ev("Application Error", 1000, "2026-06-12T21:42:00-07:00", "crash",
            serde_json::json!(["tbs_browser.exe", "1.0", "ts", "qbcore.dll", "1.0", "ts", "80000003"]))];
        let records = vec![rel("Application Error", 1000, "2026-06-12T21:42:00-07:00",
            "Faulting application name: tbs_browser.exe, version: 0.0.0.0\nFaulting module name: qbcore.dll, version: 1.0\nException code: 0x80000003", "tbs_browser.exe")];
        let out = assemble_incidents(events, Vec::new(), records, &[]);
        assert_eq!(out.len(), 1, "reliability copy of the Event Log crash dedups");
        assert!(out[0].receipt.source.contains("Reliability history"));
    }

    #[test]
    fn reliability_6008_surfaces_an_unexpected_shutdown_the_event_log_lacked() {
        // No Event Log row for this dirty shutdown; Reliability's 6008 catches it (friendly timeline).
        let records = vec![rel("EventLog", 6008, "2026-06-13T04:14:53-07:00",
            "The previous system shutdown at 4:14:53 AM on 6/13/2026 was unexpected.", "Windows")];
        let out = assemble_incidents(Vec::new(), Vec::new(), records, &[]);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].tag, "Unexpected shutdown / hard freeze");
        assert!(out[0].headline.starts_with("Your PC shut down unexpectedly"));
    }

    #[test]
    fn kernel_power_41_and_reliability_6008_from_one_shutdown_collapse() {
        // Both fire at boot for the same dirty shutdown → one incident carrying both sources.
        let events = vec![ev("Microsoft-Windows-Kernel-Power", 41, "2026-06-13T04:15:30-07:00", "reboot", serde_json::Value::Null)];
        let records = vec![rel("EventLog", 6008, "2026-06-13T04:15:32-07:00",
            "The previous system shutdown was unexpected.", "Windows")];
        let out = assemble_incidents(events, Vec::new(), records, &[]);
        assert_eq!(out.len(), 1, "41 + 6008 are the same shutdown");
        assert!(out[0].receipt.event_ids.contains(&41));
        assert!(out[0].receipt.event_ids.contains(&6008));
    }

    #[test]
    fn reliability_app_hang_parses_the_program_name_from_the_message() {
        let record = rel("Application Hang", 1002, "2026-06-12T10:00:00-07:00",
            "The program claude.exe version 1.0 stopped interacting with Windows and was closed.", "");
        let p = reliability_to_proto(&record).expect("classifies");
        assert_eq!(p.fields.faulting_app.as_deref(), Some("claude.exe"));
    }

    #[test]
    fn parse_app_from_message_handles_both_reliability_shapes() {
        assert_eq!(
            parse_app_from_message("Faulting application name: foo.exe, version: 1.0").as_deref(),
            Some("foo.exe")
        );
        assert_eq!(
            parse_app_from_message("The program bar.exe version 2.0 stopped interacting").as_deref(),
            Some("bar.exe")
        );
        assert_eq!(parse_app_from_message("unrelated message"), None);
    }

    #[test]
    fn scan_field_extracts_values_case_insensitively() {
        let msg = "Faulting module name: qbcore.dll, version: 1.0\nException code: 0x80000003\n";
        assert_eq!(scan_field(msg, "faulting module name: ", &[',', '\r', '\n']).as_deref(), Some("qbcore.dll"));
        assert_eq!(scan_field(msg, "exception code: ", &[' ', ',', '\r', '\n']).as_deref(), Some("0x80000003"));
        assert!(scan_field(msg, "not present: ", &['\n']).is_none());
    }

    #[test]
    fn parse_reliability_json_tolerates_shapes() {
        assert!(parse_reliability_json("garbage{{").is_empty());
        assert!(parse_reliability_json("null").is_empty());
        let one = parse_reliability_json(r#"{"source":"Application Error","id":1000,"time":"2026-06-12T21:42:00Z","message":"m","product":"g.exe"}"#);
        assert_eq!(one.len(), 1);
        assert_eq!(one[0].source_name, "Application Error");
        assert_eq!(one[0].id, 1000);
    }

    /// #544 bug→guard: the Event Log reader asks only for provider-scoped pairs the classifier
    /// recognizes, reaches every Event-Log incident family, and caps each channel on its own.
    #[test]
    fn event_log_query_is_provider_scoped() {
        let script = event_log_script();
        assert!(!script.contains("FilterHashtable"), "the id-only query must not return");
        assert!(
            !script.contains("'Windows Error Reporting'"),
            "the routine WER bucket provider is never requested"
        );
        let selects: Vec<&str> = script.split("<Select ").skip(1).collect();
        assert_eq!(selects.len(), EVENT_LOG_SOURCES.len(), "one Select per table row");
        for select in &selects {
            assert!(select.contains("Provider[@Name=''"), "unscoped Select: {select}");
        }
        let mut families: Vec<IncidentKind> = Vec::new();
        for (_, provider, ids) in EVENT_LOG_SOURCES {
            for id in *ids {
                let kind = classify_incident(provider, *id)
                    .unwrap_or_else(|| panic!("{provider}/{id} is fetched but never classifies"));
                if !families.contains(&kind) {
                    families.push(kind);
                }
            }
        }
        for kind in [
            IncidentKind::GpuTimeout,
            IncidentKind::AppCrash,
            IncidentKind::AppHang,
            IncidentKind::UnexpectedShutdown,
            IncidentKind::BlueScreen,
            IncidentKind::HardwareError,
        ] {
            assert!(families.contains(&kind), "{kind:?} is unreachable from the Event Log");
        }
        for channel in ["System", "Application"] {
            let xml = event_log_query_xml(channel).expect("both channels are read");
            assert_eq!(
                xml.matches("Path='").count(),
                xml.matches(&format!("Path='{channel}'")).count(),
                "{channel}'s query reads only its own channel"
            );
        }
        let cap = format!("-MaxEvents {EVENTS_PER_CHANNEL})");
        assert_eq!(script.matches(&cap).count(), 2, "each channel is capped on its own");
    }

    // Live read-only QA harness (real rig, non-elevated): runs the three collectors + the merge
    // against this machine's actual OS data. `#[ignore]` so it stays out of the normal suite (it
    // depends on the host); run with `cargo test --manifest-path src-tauri/Cargo.toml -- --ignored
    // blackbox_live_collectors_read_clean --nocapture`.
    #[test]
    #[ignore = "live OS read — run manually on a Windows rig"]
    fn blackbox_live_collectors_read_clean() {
        let (events, ev_skip) = collect_event_log();
        let (wer, wer_skip) = collect_wer();
        let (reliability, rel_skip) = collect_reliability();
        let incidents = assemble_incidents(events, wer, reliability, &[]);
        eprintln!(
            "live: {} incidents | skips: ev={:?} wer={:?} rel={:?} minidump={:?}",
            incidents.len(),
            ev_skip,
            wer_skip,
            rel_skip,
            minidump_skip_note()
        );
        for i in incidents.iter().take(12) {
            eprintln!("  [{}] {}  ::  {}", i.tag, i.headline, i.receipt.source);
        }
        // Invariants that must hold on ANY rig: never a fabricated timestamp/headline, receipt
        // always names at least one source, and the cap is respected.
        assert!(incidents.len() <= MAX_INCIDENTS);
        for i in &incidents {
            assert!(!i.headline.is_empty());
            assert!(!i.receipt.source.is_empty(), "every incident names its source");
            assert!(DateTime::parse_from_rfc3339(&i.when).is_ok(), "when is real RFC3339");
        }
    }

    #[test]
    fn sig_index_parses_only_plain_sig_keys() {
        assert_eq!(sig_index("Sig[3].Name", ".Name"), Some(3));
        assert_eq!(sig_index("Sig[0].Value", ".Value"), Some(0));
        assert_eq!(sig_index("Sig[3].Name", ".Value"), None, "suffix must match");
        assert_eq!(sig_index("DynamicSig[1].Name", ".Name"), None, "DynamicSig ignored");
        assert_eq!(sig_index("EventType", ".Name"), None);
    }

    // ── R8 — Black Box v2 triage engine (assess + rules + gate). The LAW is test-enforced here:
    //    never a percentage, every next step reversible, refuse-to-guess on thin evidence, flag-OFF
    //    emits nothing. ──

    /// Build a test incident carrying exactly the fields the rules read.
    fn mk(
        kind: IncidentKind,
        when: &str,
        module: Option<&str>,
        code: Option<&str>,
        app: Option<&str>,
        temp: Option<u32>,
    ) -> Incident {
        Incident {
            incident_id: "test-incident".into(),
            headline: "h".into(),
            tag: kind.tag().to_string(),
            when: when.into(),
            when_display: "d".into(),
            vitals: temp.map(|t| LastVitals {
                session_started_at: when.into(),
                game: app.map(pretty_proc),
                peak_gpu_temp_c: Some(t),
                peak_gpu_usage_pct: None,
                avg_frametime_ms: 0.0,
                low1_fps_est: 0.0,
                summary: "s".into(),
            }),
            receipt: Receipt {
                source: "src".into(),
                event_ids: Vec::new(),
                faulting_app: app.map(Into::into),
                faulting_module: module.map(Into::into),
                code: code.map(Into::into),
                detail: "d".into(),
            },
            assessment: None,
            case_intelligence: None,
            kind,
        }
    }

    fn has_percent(a: &Assessment) -> bool {
        serde_json::to_string(a).unwrap().contains('%')
    }

    #[test]
    fn gate_is_default_false() {
        // No force, env path compiled out under test → the shipped behavior is OFF.
        assert!(!blackbox_v2_gate(), "v2 gate must default OFF");
    }

    #[test]
    fn overheating_strong_on_measured_high_gpu_temp() {
        let inc = mk(IncidentKind::GpuTimeout, "2026-06-12T21:00:00Z", Some("amdkmdag"), None, None, Some(88));
        let a = assess(&inc, std::slice::from_ref(&inc)).expect("fires");
        assert_eq!(a.strength, Strength::Strong);
        assert!(a.consistent_with.contains("overheating"));
        assert!(a.evidence.iter().any(|e| e.contains("88°C")));
        assert!(a.next_step.reversible);
        assert!(!a.next_step.research_only, "checking temps is a do-it step, not research-only");
        assert!(!has_percent(&a), "no percentage anywhere");
    }

    #[test]
    fn whea_is_partial_once_and_strong_when_repeated() {
        let one = mk(IncidentKind::HardwareError, "2026-06-12T21:00:00Z", None, None, None, None);
        let a = assess(&one, std::slice::from_ref(&one)).expect("fires");
        assert_eq!(a.strength, Strength::Partial, "a lone WHEA is honest about ambiguity");
        assert!(a.consistent_with.contains("hardware-level"));
        // two WHEA in context → Strong
        let two = vec![
            mk(IncidentKind::HardwareError, "2026-06-12T21:00:00Z", None, None, None, None),
            mk(IncidentKind::HardwareError, "2026-06-11T10:00:00Z", None, None, None, None),
        ];
        let a2 = assess(&two[0], &two).expect("fires");
        assert_eq!(a2.strength, Strength::Strong);
        assert!(a2.next_step.reversible && !has_percent(&a2));
    }

    #[test]
    fn graphics_driver_needs_two_same_module_tdrs_and_cool_temps() {
        let cool = mk(IncidentKind::GpuTimeout, "2026-06-12T21:00:00Z", Some("nvlddmkm"), None, None, None);
        // one TDR → not enough → no driver claim (could be a one-off)
        assert!(rule_graphics_driver(&cool, std::slice::from_ref(&cool)).is_none(), "one TDR is not a pattern");
        // two same-module TDRs, cool → Strong driver
        let two = vec![
            mk(IncidentKind::GpuTimeout, "2026-06-12T21:00:00Z", Some("nvlddmkm"), None, None, None),
            mk(IncidentKind::GpuTimeout, "2026-06-11T20:00:00Z", Some("nvlddmkm"), None, None, None),
        ];
        let a = assess(&two[0], &two).expect("fires");
        assert_eq!(a.strength, Strength::Strong);
        assert!(a.consistent_with.contains("nvlddmkm"));
        assert!(a.next_step.headline.to_lowercase().contains("reinstall") && a.next_step.reversible);
        assert!(!has_percent(&a));
        // …but a HOT recurring TDR is overheating, not "driver" (rule 1 owns the hot case)
        let hot = vec![
            mk(IncidentKind::GpuTimeout, "2026-06-12T21:00:00Z", Some("nvlddmkm"), None, None, Some(90)),
            mk(IncidentKind::GpuTimeout, "2026-06-11T20:00:00Z", Some("nvlddmkm"), None, None, Some(90)),
        ];
        assert!(assess(&hot[0], &hot).unwrap().consistent_with.contains("overheating"));
    }

    #[test]
    fn app_specific_only_when_no_system_event_is_near() {
        let lone = mk(IncidentKind::AppCrash, "2026-06-12T21:00:00Z", Some("unity.dll"), Some("0xc0000005"), Some("game.exe"), None);
        let a = assess(&lone, std::slice::from_ref(&lone)).expect("fires");
        assert_eq!(a.strength, Strength::Strong);
        assert!(a.consistent_with.contains("game") && a.consistent_with.contains("rather than your PC"));
        assert!(a.next_step.reversible && !has_percent(&a));
        // a GPU timeout 3 minutes away → NOT safely app-side → no app assessment
        let near = vec![
            mk(IncidentKind::AppCrash, "2026-06-12T21:00:00Z", Some("unity.dll"), None, Some("game.exe"), None),
            mk(IncidentKind::GpuTimeout, "2026-06-12T21:03:00Z", Some("amdkmdag"), None, None, None),
        ];
        assert!(rule_app_specific(&near[0], &near).is_none(), "a nearby system event blocks the app-side call");
    }

    #[test]
    fn power_hardlock_is_partial_and_not_when_a_bsod_is_near() {
        let lock = mk(IncidentKind::UnexpectedShutdown, "2026-06-12T21:00:00Z", None, None, None, None);
        let a = assess(&lock, std::slice::from_ref(&lock)).expect("fires");
        assert_eq!(a.strength, Strength::Partial, "hard-lock is inherently ambiguous");
        assert!(a.next_step.reversible, "even the cable-reseat step is reversible");
        assert!(a.evidence.iter().any(|e| e.contains("ambiguous")));
        assert!(!has_percent(&a));
        // a BSOD nearby → Windows DID record a crash → this rule must not fire
        let with_bsod = vec![
            mk(IncidentKind::UnexpectedShutdown, "2026-06-12T21:00:00Z", None, None, None, None),
            mk(IncidentKind::BlueScreen, "2026-06-12T21:00:05Z", None, Some("0x133"), None, None),
        ];
        assert!(rule_power_hardlock(&with_bsod[0], &with_bsod).is_none());
    }

    #[test]
    fn bsod_falls_through_to_beyond_us_with_the_code() {
        let bsod = mk(IncidentKind::BlueScreen, "2026-06-12T21:00:00Z", None, Some("0x00000133"), None, None);
        let a = assess(&bsod, std::slice::from_ref(&bsod)).expect("fires");
        assert!(a.beyond_us, "ambiguous bugcheck → beyond-us, never a forced cause");
        assert_eq!(a.strength, Strength::Weak);
        assert!(a.evidence.iter().any(|e| e.contains("0x00000133")));
        assert!(a.next_step.research_only && a.next_step.reversible, "look-it-up is research-only + reversible");
        assert!(!has_percent(&a));
    }

    #[test]
    fn refuses_to_guess_on_thin_evidence() {
        // A lone GPU timeout with no temp data and no recurrence → no rule clears its bar → None.
        let thin = mk(IncidentKind::GpuTimeout, "2026-06-12T21:00:00Z", Some("amdkmdag"), None, None, None);
        assert!(assess(&thin, std::slice::from_ref(&thin)).is_none(), "thin evidence → refuse to guess, not a verdict");
    }

    /// One firing incident-context per rule (overheating · driver · app · power · beyond-us · WHEA) —
    /// the shared battery the honesty-law sweeps run over, so a new rule can't dodge the guards.
    fn firing_cases() -> Vec<Vec<Incident>> {
        vec![
            vec![mk(IncidentKind::GpuTimeout, "2026-06-12T21:00:00Z", Some("amdkmdag"), None, None, Some(90))], // overheating
            vec![
                mk(IncidentKind::GpuTimeout, "2026-06-12T21:00:00Z", Some("nvlddmkm"), None, None, None),
                mk(IncidentKind::GpuTimeout, "2026-06-11T20:00:00Z", Some("nvlddmkm"), None, None, None),
            ], // driver
            vec![mk(IncidentKind::AppHang, "2026-06-12T21:00:00Z", None, None, Some("game.exe"), None)], // app
            vec![mk(IncidentKind::UnexpectedShutdown, "2026-06-12T21:00:00Z", None, None, None, None)], // power
            vec![mk(IncidentKind::BlueScreen, "2026-06-12T21:00:00Z", None, Some("0x1e"), None, None)], // beyond-us
            vec![mk(IncidentKind::HardwareError, "2026-06-12T21:00:00Z", None, None, None, None)], // whea
        ]
    }

    #[test]
    fn no_assessment_ever_contains_a_percentage_or_an_irreversible_step() {
        // Sweep one firing incident per rule; assert the LAW invariants hold across all of them.
        for ctx in &firing_cases() {
            let a = assess(&ctx[0], ctx).expect("each case fires");
            assert!(!has_percent(&a), "no percentage: {:?}", a.consistent_with);
            assert!(a.next_step.reversible, "every next step is reversible: {:?}", a.next_step.headline);
        }
    }

    #[test]
    fn no_rule_asserts_a_cause() {
        // The never-assert-a-cause law, swept over every rule's FULL output (consistent_with + evidence
        // + next_step). "Consistent with…" is the only frame; assertive-causal vocabulary is banned.
        let banned = [
            "the cause is",
            "caused by",
            "is because",
            "definitely",
            "guaranteed",
            "for certain",
            "for sure",
            "proven",
            "100%",
            "without doubt",
            "we are sure",
            "is the reason",
        ];
        for ctx in &firing_cases() {
            let a = assess(&ctx[0], ctx).expect("fires");
            let blob = serde_json::to_string(&a).unwrap().to_lowercase();
            for b in banned {
                assert!(!blob.contains(b), "rule '{}' leaked a causal claim: '{b}'", a.consistent_with);
            }
        }
    }

    #[test]
    fn next_step_headlines_never_command_an_irreversible_action() {
        // The reversible-only law's teeth: the HEADLINE is the imperative "do this" line, so it must
        // never command an irreversible/risky action (those may appear only as "research" framing in the
        // detail). Every emitted step also stays reversible.
        let irreversible = [
            "repaste", "re-paste", "flash", "rma", "replace your power supply",
            "replace the power supply", "buy a new", "overclock", "delete", "format",
        ];
        for ctx in &firing_cases() {
            let a = assess(&ctx[0], ctx).expect("fires");
            let h = a.next_step.headline.to_lowercase();
            for w in irreversible {
                assert!(!h.contains(w), "next-step headline commands an irreversible action '{w}': {}", a.next_step.headline);
            }
            assert!(a.next_step.reversible, "every next step stays reversible");
        }
    }

    #[test]
    fn strength_always_serializes_as_one_of_the_three_words() {
        // Strength is a WORD, never a number — pin the only three legal serialized values.
        for ctx in &firing_cases() {
            let a = assess(&ctx[0], ctx).expect("fires");
            let s = serde_json::to_value(a.strength).unwrap();
            assert!(
                matches!(s.as_str(), Some("strong") | Some("partial") | Some("weak")),
                "strength must be one of the three words, got {s:?}"
            );
        }
    }

    #[test]
    fn flag_off_emits_no_assessments() {
        // Default gate (no force, env compiled out under test) ⇒ exact v1 behavior, no assessments.
        assert!(!blackbox_v2_gate());
        let events = vec![ev(
            "Application Error", 1000, "2026-06-12T21:42:00-07:00", "crash",
            serde_json::json!(["game.exe", "1.0", "ts", "unity.dll", "1.0", "ts", "c0000005"]),
        )];
        let out = from_events(events, &[]);
        assert_eq!(out.len(), 1);
        assert!(out.iter().all(|i| i.assessment.is_none()), "flag OFF → no assessment populated");
    }

    #[test]
    fn flag_on_populates_assessments_through_assembly() {
        let _g = V2GateForceOn::begin(); // test-only; the shipped gate is untouched + still false
        assert!(blackbox_v2_gate(), "force seam opens the gate for this thread");
        let events = vec![ev(
            "Application Error", 1000, "2026-06-12T21:42:00-07:00", "crash",
            serde_json::json!(["game.exe", "1.0", "ts", "unity.dll", "1.0", "ts", "c0000005"]),
        )];
        let out = from_events(events, &[]);
        assert_eq!(out.len(), 1);
        let a = out[0].assessment.as_ref().expect("a lone app crash assesses as app-specific");
        assert!(a.consistent_with.contains("rather than your PC"));
        assert!(a.next_step.reversible && !has_percent(a));
    }

    #[test]
    fn assessment_is_omitted_from_the_wire_when_absent() {
        // Flag OFF: the serialized incident must carry NO `assessment` key (byte-compatible with v1).
        let inc = mk(IncidentKind::GpuTimeout, "2026-06-12T21:00:00Z", Some("amdkmdag"), None, None, None);
        let v = serde_json::to_value(&inc).unwrap();
        assert!(v.get("assessment").is_none(), "absent assessment is omitted, not null");
        assert!(v.get("kind").is_none(), "internal kind never serializes (TS uses `tag`)");
    }
}
