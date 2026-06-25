//! Read-only service inventory (A4 advisory). Enumerates Windows services via
//! WMI and groups the ones Compy recognizes into plain-English, gaming-relevant
//! categories — purely informational.
//!
//! This is an INVENTORY, not advice. It states what each recognized service IS
//! (faithful paraphrases of Windows' own DisplayName plus well-established
//! facts) and its live state — it NEVER says a service is "safe to suspend" or
//! recommends turning anything off. The curated "safe-to-suspend" advisory
//! layer is a separate, owner-curated, gated feature (LOCKED rule 6); this
//! module deliberately carries no such judgement. Mutates nothing.
//!
//! Design: the curated map keys on the exact WMI service Name (case-insensitive,
//! with a per-user-LUID-suffix and a versioned-prefix fallback). Services we do
//! not recognise are NEVER guessed a category — they are only counted, so the
//! surface can be honest about its coverage without fabricating a taxonomy.

use serde::Deserialize;
use wmi::{COMLibrary, WMIConnection};

/// Plain-English, gaming-relevant categories. The discriminant order is the
/// display order (gamer-facing first), used by `order()` for a stable sort.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Category {
    Vendor,
    GamePlatform,
    AntiCheat,
    Xbox,
    Performance,
    Telemetry,
    Updates,
    ThirdPartyUpdater,
    Search,
}

impl Category {
    fn title(self) -> &'static str {
        match self {
            Category::Vendor => "Graphics / hardware vendor",
            Category::GamePlatform => "Game platforms & launchers",
            Category::AntiCheat => "Anti-cheat",
            Category::Xbox => "Xbox & Game Bar",
            Category::Performance => "Performance & memory",
            Category::Telemetry => "Telemetry & diagnostics",
            Category::Updates => "Windows Update & delivery",
            Category::ThirdPartyUpdater => "App updaters",
            Category::Search => "Search & indexing",
        }
    }

    /// Stable display order. Lower sorts first.
    fn order(self) -> u8 {
        match self {
            Category::Vendor => 0,
            Category::GamePlatform => 1,
            Category::AntiCheat => 2,
            Category::Xbox => 3,
            Category::Performance => 4,
            Category::Telemetry => 5,
            Category::Updates => 6,
            Category::ThirdPartyUpdater => 7,
            Category::Search => 8,
        }
    }
}

struct Known {
    name: &'static str,
    category: Category,
    desc: &'static str,
}

/// Curated map of recognised, gaming-relevant services. Keyed on the exact WMI
/// `Name` (matched case-insensitively, also against the per-user base name).
/// Descriptions are faithful expansions of Windows' DisplayName plus
/// well-established facts — never advice.
const KNOWN: &[Known] = &[
    // ── Graphics / hardware vendor ──────────────────────────────────────
    Known { name: "AMD External Events Utility", category: Category::Vendor, desc: "AMD driver event handler — FreeSync, hotkeys, and overlay events." },
    Known { name: "AMD Crash Defender Service", category: Category::Vendor, desc: "AMD driver crash detection and recovery." },
    Known { name: "AmdAppCompatSvc", category: Category::Vendor, desc: "AMD per-application compatibility profiles." },
    Known { name: "AmdPpkgSvc", category: Category::Vendor, desc: "AMD driver provisioning packages." },
    Known { name: "amd3dvcacheSvc", category: Category::Vendor, desc: "Steers game threads onto the 3D V-Cache cores on Ryzen X3D CPUs." },
    Known { name: "NvTelemetryContainer", category: Category::Vendor, desc: "NVIDIA driver telemetry — collects GPU driver usage data." },
    Known { name: "NVDisplay.ContainerLocalSystem", category: Category::Vendor, desc: "Hosts the NVIDIA Control Panel and display driver services." },
    // ── Game platforms & launchers ──────────────────────────────────────
    Known { name: "Steam Client Service", category: Category::GamePlatform, desc: "Steam platform background service." },
    Known { name: "EpicGamesUpdater", category: Category::GamePlatform, desc: "Epic Games Launcher updater." },
    Known { name: "EpicOnlineServices", category: Category::GamePlatform, desc: "Epic Online Services — cross-platform multiplayer and sign-in." },
    // ── Anti-cheat ──────────────────────────────────────────────────────
    Known { name: "AntiCheatExpert Protection", category: Category::AntiCheat, desc: "Tencent Anti-Cheat Expert (ACE) — kernel-level protection." },
    Known { name: "AntiCheatExpert Service", category: Category::AntiCheat, desc: "Tencent Anti-Cheat Expert (ACE) service." },
    Known { name: "BEService", category: Category::AntiCheat, desc: "BattlEye anti-cheat." },
    Known { name: "EAAntiCheatService", category: Category::AntiCheat, desc: "EA anti-cheat." },
    Known { name: "EasyAntiCheat", category: Category::AntiCheat, desc: "Easy Anti-Cheat." },
    Known { name: "EasyAntiCheat_EOS", category: Category::AntiCheat, desc: "Epic's Easy Anti-Cheat — the EOS (Epic Online Services) variant." },
    // ── Xbox & Game Bar ─────────────────────────────────────────────────
    Known { name: "XblAuthManager", category: Category::Xbox, desc: "Xbox Live sign-in." },
    Known { name: "XblGameSave", category: Category::Xbox, desc: "Xbox Live cloud game saves." },
    Known { name: "XboxGipSvc", category: Category::Xbox, desc: "Xbox accessory (controller) management." },
    Known { name: "XboxNetApiSvc", category: Category::Xbox, desc: "Xbox Live networking." },
    Known { name: "GameInputSvc", category: Category::Xbox, desc: "Windows GameInput — the modern controller and input API." },
    Known { name: "BcastDVRUserService", category: Category::Xbox, desc: "Game Bar broadcasting and DVR capture." },
    // ── Performance & memory ────────────────────────────────────────────
    Known { name: "SysMain", category: Category::Performance, desc: "Formerly Superfetch — preloads frequently used apps into RAM." },
    // ── Telemetry & diagnostics ─────────────────────────────────────────
    Known { name: "DiagTrack", category: Category::Telemetry, desc: "Connected User Experiences and Telemetry — sends diagnostic and usage data to Microsoft." },
    Known { name: "WerSvc", category: Category::Telemetry, desc: "Windows Error Reporting — sends crash reports to Microsoft." },
    Known { name: "wercplsupport", category: Category::Telemetry, desc: "Backs the Problem Reports control-panel page." },
    Known { name: "DPS", category: Category::Telemetry, desc: "Diagnostic Policy Service — detects and troubleshoots Windows problems (local)." },
    Known { name: "WdiServiceHost", category: Category::Telemetry, desc: "Hosts Windows diagnostic modules, per session (local)." },
    Known { name: "WdiSystemHost", category: Category::Telemetry, desc: "Hosts system-level Windows diagnostic modules (local)." },
    Known { name: "diagsvc", category: Category::Telemetry, desc: "Runs diagnostic actions for Windows troubleshooters (local)." },
    Known { name: "PcaSvc", category: Category::Telemetry, desc: "Program Compatibility Assistant — watches for app compatibility issues." },
    Known { name: "InventorySvc", category: Category::Telemetry, desc: "Inventories installed software for Windows compatibility appraisal." },
    Known { name: "wuqisvc", category: Category::Telemetry, desc: "Microsoft Usage and Quality Insights — collects usage and quality data." },
    Known { name: "pla", category: Category::Telemetry, desc: "Performance Logs & Alerts — collects performance and trace data (local)." },
    Known { name: "RetailDemo", category: Category::Telemetry, desc: "Retail Demo mode, for store display PCs." },
    // ── Windows Update & delivery ───────────────────────────────────────
    Known { name: "wuauserv", category: Category::Updates, desc: "Windows Update — downloads and installs updates." },
    Known { name: "UsoSvc", category: Category::Updates, desc: "Update Orchestrator — schedules Windows Update." },
    Known { name: "WaaSMedicSvc", category: Category::Updates, desc: "Repairs Windows Update components when they break." },
    Known { name: "DoSvc", category: Category::Updates, desc: "Delivery Optimization — peer-to-peer download of Windows updates." },
    // ── App updaters ────────────────────────────────────────────────────
    Known { name: "edgeupdate", category: Category::ThirdPartyUpdater, desc: "Microsoft Edge updater." },
    Known { name: "edgeupdatem", category: Category::ThirdPartyUpdater, desc: "Microsoft Edge updater (per-machine)." },
    Known { name: "MozillaMaintenance", category: Category::ThirdPartyUpdater, desc: "Firefox maintenance and updater." },
    Known { name: "GoogleChromeElevationService", category: Category::ThirdPartyUpdater, desc: "Google Chrome elevation helper." },
    // ── Search & indexing ───────────────────────────────────────────────
    Known { name: "WSearch", category: Category::Search, desc: "Windows Search — indexes files and content for fast search." },
];

/// Prefix matches for services whose Name carries a varying version/instance
/// suffix (so an exact match can't catch them). Checked only after KNOWN.
const KNOWN_PREFIX: &[Known] = &[
    // e.g. "GoogleUpdaterService150.0.7863.0", "GoogleUpdaterInternalService150.0.7863.0"
    Known { name: "GoogleUpdater", category: Category::ThirdPartyUpdater, desc: "Google software updater." },
];

/// Strip a trailing per-user LUID suffix (e.g. `BcastDVRUserService_5ca62` →
/// `BcastDVRUserService`) so per-user service instances match their base name.
/// Only strips a `_<hex>` tail of 4+ hex digits, so legitimate suffixes like
/// `EasyAntiCheat_EOS` are preserved. Pure.
fn base_name(name: &str) -> &str {
    if let Some(idx) = name.rfind('_') {
        let suffix = &name[idx + 1..];
        if suffix.len() >= 4 && suffix.chars().all(|c| c.is_ascii_hexdigit()) {
            return &name[..idx];
        }
    }
    name
}

/// Look up a service's category + description. Exact (raw or base name,
/// case-insensitive), then versioned-prefix. Unrecognised → None (never
/// guessed). Pure.
fn categorize(name: &str) -> Option<(Category, &'static str)> {
    let lname = name.to_ascii_lowercase();
    let lbase = base_name(name).to_ascii_lowercase();
    for k in KNOWN {
        let kn = k.name.to_ascii_lowercase();
        if lname == kn || lbase == kn {
            return Some((k.category, k.desc));
        }
    }
    for p in KNOWN_PREFIX {
        if lname.starts_with(&p.name.to_ascii_lowercase()) {
            return Some((p.category, p.desc));
        }
    }
    None
}

/// Human-readable "Running · Automatic start" / "Stopped · Disabled" string from
/// the WMI State + StartMode. Pure.
fn format_state(state: &str, start_mode: &str) -> String {
    let start = match start_mode {
        "Auto" | "Automatic" => "Automatic start",
        "Manual" => "Manual start",
        "Disabled" => "Disabled",
        "Boot" => "Boot start",
        "System" => "System start",
        "" | "Unknown" => "",
        other => other,
    };
    if start.is_empty() {
        state.to_string()
    } else {
        format!("{state} · {start}")
    }
}

/// A raw, WMI-free service row — the input to the pure inventory builder.
pub(crate) struct SvcRow {
    pub name: String,
    pub display_name: String,
    pub state: String,
    pub start_mode: String,
}

/// One inventory row, ready for the Diagnostics surface.
#[derive(Debug, PartialEq)]
pub(crate) struct InvRow {
    pub label: String,
    pub value: String,
    pub note: Option<String>,
}

/// A category's recognised services.
#[derive(Debug, PartialEq)]
pub(crate) struct InvGroup {
    pub category: String,
    pub rows: Vec<InvRow>,
}

/// The full inventory: recognised services grouped by category, plus honest
/// coverage counts (we never imply we categorised everything).
pub(crate) struct Inventory {
    pub groups: Vec<InvGroup>,
    pub total: usize,
    pub recognized: usize,
}

/// Build the categorised inventory from raw service rows. Pure (no WMI), so the
/// grouping/sorting/coverage logic is fully unit-testable. Unrecognised
/// services are counted in `total` but never placed in a group.
pub(crate) fn build_inventory(rows: Vec<SvcRow>) -> Inventory {
    let total = rows.len();
    let mut recognized = 0usize;
    let mut buckets: Vec<(Category, Vec<InvRow>)> = Vec::new();
    for r in rows {
        let Some((cat, desc)) = categorize(&r.name) else {
            continue;
        };
        recognized += 1;
        // Prefer Windows' friendly DisplayName; when it's missing or just echoes
        // the raw service Name (common for per-user services), fall back to the
        // base name so a session LUID suffix (e.g. `_5ca62`) never leaks to the UI.
        let label = if r.display_name.trim().is_empty() || r.display_name == r.name {
            base_name(&r.name).to_string()
        } else {
            r.display_name.clone()
        };
        let row = InvRow {
            label,
            value: format_state(&r.state, &r.start_mode),
            note: Some(desc.to_string()),
        };
        match buckets.iter_mut().find(|(c, _)| *c == cat) {
            Some((_, v)) => v.push(row),
            None => buckets.push((cat, vec![row])),
        }
    }
    for (_, v) in buckets.iter_mut() {
        v.sort_by_key(|r| r.label.to_ascii_lowercase());
    }
    buckets.sort_by_key(|(c, _)| c.order());
    let groups = buckets
        .into_iter()
        .map(|(c, rows)| InvGroup { category: c.title().to_string(), rows })
        .collect();
    Inventory { groups, total, recognized }
}

#[derive(Deserialize)]
#[serde(rename = "Win32_Service")]
#[serde(rename_all = "PascalCase")]
struct RawService {
    name: Option<String>,
    display_name: Option<String>,
    state: Option<String>,
    start_mode: Option<String>,
}

/// Enumerate all Windows services (read-only). Runs on the dedicated WMI thread
/// (the UI/command thread is STA; WMI needs a clean MTA — see
/// `hardware::on_wmi_thread`). Any failure yields an empty list, so the surface
/// degrades gracefully rather than panicking.
fn enumerate_services() -> Vec<SvcRow> {
    crate::hardware::on_wmi_thread(|| {
        let Ok(com) = COMLibrary::new() else {
            return Vec::new();
        };
        let Ok(conn) = WMIConnection::new(com) else {
            return Vec::new();
        };
        let raw: Vec<RawService> =
            match conn.raw_query("SELECT Name, DisplayName, State, StartMode FROM Win32_Service") {
                Ok(r) => r,
                Err(_) => return Vec::new(),
            };
        raw.into_iter()
            .filter_map(|s| {
                let name = s.name?;
                if name.trim().is_empty() {
                    return None;
                }
                Some(SvcRow {
                    display_name: s.display_name.unwrap_or_else(|| name.clone()),
                    state: s.state.unwrap_or_else(|| "Unknown".into()),
                    start_mode: s.start_mode.unwrap_or_else(|| "Unknown".into()),
                    name,
                })
            })
            .collect()
    })
}

// ─── Service startup drift (A4 — read-only advisory: the "Leftovers" of services) ─────────────
//
// The service analog of optimizer-rot (see `leftovers.rs`). A CLOSED, curated catalog of Windows
// services whose Windows stock startup type is **Automatic on every supported Windows** — stable,
// unambiguous, not version-fragile — that "disable these services for FPS" debloat scripts commonly
// turn OFF, AND that **Compy itself never recommends disabling** (so a drift finding can never
// contradict the rec engine — SysMain / DiagTrack / Xbox / Search and friends are deliberately
// absent; turning those off is a Compy-endorsed choice, not rot). The charter mirrors Leftovers:
//   - Closed catalog — only the curated list; no heuristics, no "guess the stock state".
//   - Receipts, not adjectives — current vs stock, the matched guide tweak, the concrete cost.
//   - Honest uncertainty — origin is unprovable; every finding says "if you did this on purpose, keep it".
//   - Conservative — only the two unambiguous changed values (Manual / Disabled) are flagged;
//     Boot/System/Unknown are never guessed at, and a service that simply isn't present is never
//     flagged (we can't tell "removed" from "never installed").
//   - No alarm, no promise, no action — advisory only; Compy wires NO enable/suspend here.

/// One curated drift detector. Every entry's stock startup is Automatic (asserted by
/// `drift_catalog_is_all_automatic_stock` + documented above), which is what makes a non-Automatic
/// value an unambiguous change rather than a Windows-version quirk.
struct DriftSpec {
    /// Exact WMI service Name, matched case-insensitively (and against the per-user base name).
    name: &'static str,
    /// Friendly service name for the receipt.
    label: &'static str,
    /// The guide-era tweak that turns it off — the curated "wanted poster", never a guess.
    matched_tweak: &'static str,
    /// The concrete, named functional cost while it is off.
    cost: &'static str,
    /// Honest, plain verdict for the user — never a boost promise, never an alarm.
    verdict: &'static str,
    /// The friendly `label` of another curated service that MUST be started before this one, or
    /// `None`. A closed, well-established fact (e.g. Windows Audio's required services include the
    /// Audio Endpoint Builder on every supported Windows) — NOT a live WMI dependency read. Used by
    /// the recovery guide to restore a prerequisite first when both are drifted.
    requires: Option<&'static str>,
}

const DRIFT: &[DriftSpec] = &[
    DriftSpec {
        name: "Audiosrv",
        label: "Windows Audio",
        matched_tweak: "\"disable services for FPS\" debloat scripts",
        cost: "With Windows Audio turned off the PC has no sound at all until it is switched back on.",
        verdict: "Turning off core Windows services is a debloat-script habit — it trades real functionality for no measured FPS.",
        // Windows Audio will not start unless the Audio Endpoint Builder is started first.
        requires: Some("Windows Audio Endpoint Builder"),
    },
    DriftSpec {
        name: "AudioEndpointBuilder",
        label: "Windows Audio Endpoint Builder",
        matched_tweak: "\"disable services for FPS\" debloat scripts",
        cost: "Windows cannot see your speakers, headset, or microphone while this is off — audio devices simply disappear.",
        verdict: "This service is why your audio devices show up at all; disabling it breaks sound for no measured FPS.",
        requires: None,
    },
    DriftSpec {
        name: "Themes",
        label: "Themes",
        matched_tweak: "\"disable the Themes service to save RAM\" guides",
        cost: "Windows drops to the basic classic look and some apps render oddly; it frees only a trivial amount of RAM.",
        verdict: "The RAM this frees is negligible on a gaming rig — the visual breakage is the only thing you will actually notice.",
        requires: None,
    },
];

/// One service-startup-drift finding — receipts, not adjectives. Advisory only (no action wired).
#[derive(Debug, PartialEq)]
pub(crate) struct DriftFinding {
    /// The clean, friendly service name (e.g. "Windows Audio") — used by the recovery guide.
    pub service: String,
    pub label: String,
    /// The exact current startup type + live state, e.g. "Stopped · Disabled".
    pub current: String,
    /// The Windows stock startup type for this service.
    pub stock: String,
    /// Which guide-era tweak this matches (the curated wanted-poster, not a guess).
    pub matched_tweak: String,
    /// One plain sentence: the concrete cost of it being off.
    pub cost: String,
    /// Honest, plain verdict for this finding.
    pub verdict: String,
    /// Origin-uncertainty + reversibility, in one honest sentence. Compy wires no enable action.
    pub restore_note: String,
    /// The friendly name of a curated service that must be started BEFORE this one (or `None`) — a
    /// closed, well-established Windows fact. The recovery guide uses it to restore a prerequisite
    /// first when both are drifted, so the user doesn't hit a dependency-start failure.
    pub requires: Option<String>,
}

/// Case-insensitive match of a live service Name against a curated catalog Name (raw or the
/// per-user base name, so a `_<luid>` suffix never blocks a match). Pure.
fn service_name_matches(row_name: &str, catalog_name: &str) -> bool {
    let cn = catalog_name.to_ascii_lowercase();
    row_name.to_ascii_lowercase() == cn || base_name(row_name).to_ascii_lowercase() == cn
}

/// Build the read-only service-startup-drift findings from raw service rows. Pure (no WMI), so the
/// catalog + judgement is fully fixture-testable. Findings follow catalog order.
pub(crate) fn build_service_drift(rows: &[SvcRow]) -> Vec<DriftFinding> {
    let mut findings = Vec::new();
    for spec in DRIFT {
        // The first matching live row for this curated service (there is normally exactly one).
        let Some(row) = rows.iter().find(|r| service_name_matches(&r.name, spec.name)) else {
            continue; // not present → never flagged (can't tell "removed" from "never installed").
        };
        // Stock is Automatic for every catalog entry; only the two unambiguous "someone changed it"
        // values are flagged. Boot/System/Unknown are never guessed at.
        if !matches!(row.start_mode.as_str(), "Manual" | "Disabled") {
            continue;
        }
        findings.push(DriftFinding {
            service: spec.label.into(),
            label: format!("{} — startup changed", spec.label),
            current: format_state(&row.state, &row.start_mode),
            stock: "Automatic start".into(),
            matched_tweak: spec.matched_tweak.into(),
            cost: spec.cost.into(),
            verdict: spec.verdict.into(),
            restore_note:
                "Compy can't prove who changed this — if you did it on purpose, keep it. Otherwise it is \
                 reversible: set the startup back to Automatic in Services (services.msc). Compy makes no \
                 change here."
                    .into(),
            requires: spec.requires.map(str::to_string),
        });
    }
    findings
}

// ─── Service recovery guide (A4 — read-only advisory: HOW to undo the drift, by hand) ─────────────
//
// Drift detection says WHAT a debloat script switched off; this is the plain-English procedure to
// switch it back on yourself, in the Windows Services console. It is REFERENCE DATA, never an action:
// Compy performs none of these steps (no `sc`, no PowerShell, no registry write) — consistent with
// the no-mutation charter and the rollback-first / "recover from a bad guide" positioning. The same
// services.msc procedure restores any service, so the guide is built ONCE and simply names the
// services this rig actually drifted, so it reads "for YOUR PC" rather than generic.
//   - Only appears when there is real drift to recover (no findings → None; nothing to fix).
//   - Names the exact affected services (receipts, not generic boilerplate).
//   - Honest framing: origin is unprovable ("if you turned these off on purpose, leave them") and
//     Compy makes no change — the steps are yours to follow.
//   - Steps are the real, correct Windows 10/11 procedure (Automatic startup + Start), no jargon.

/// A read-only recovery guide: the exact, plain-English steps to restore the drifted services to
/// their stock startup by hand in the Services console. Compy wires NO mutation.
#[derive(Debug, PartialEq)]
pub(crate) struct RecoveryGuide {
    /// The friendly names of the services this guide restores (the drifted ones).
    pub services: Vec<String>,
    /// One honest intro line: what this restores + origin-uncertainty + Compy-makes-no-change.
    pub intro: String,
    /// Ordered, plain-English steps — the real `services.msc` procedure.
    pub steps: Vec<String>,
}

/// Join names into a plain-English list: "A", "A and B", "A, B and C". Pure.
fn join_names(names: &[String]) -> String {
    match names {
        [] => String::new(),
        [a] => a.clone(),
        [a, b] => format!("{a} and {b}"),
        [head @ .., last] => format!("{} and {}", head.join(", "), last),
    }
}

/// Build the recovery guide from drift findings. Returns `None` when there is no drift (nothing to
/// recover). Pure — fully unit-testable. The steps are the real Services-console procedure; Compy
/// performs none of them.
pub(crate) fn build_recovery_guide(findings: &[DriftFinding]) -> Option<RecoveryGuide> {
    if findings.is_empty() {
        return None;
    }
    // Restore ORDER: a drifted service that another drifted service depends on must be restored
    // FIRST — otherwise the dependent's Start fails with "a dependency service or group failed to
    // start". Within the curated catalog the only such pair is Windows Audio → Windows Audio
    // Endpoint Builder. Rank a finding by how many OTHER drifted findings require it (a prerequisite
    // has ≥1, a leaf has 0) and sort that rank first, falling back to the original (catalog) order —
    // a stable sort that only moves a drifted prerequisite ahead of its drifted dependent.
    let is_drifted = |label: &str| findings.iter().any(|f| f.service == label);
    let dependents: Vec<usize> = findings
        .iter()
        .map(|f| findings.iter().filter(|o| o.requires.as_deref() == Some(f.service.as_str())).count())
        .collect();
    let mut order: Vec<usize> = (0..findings.len()).collect();
    order.sort_by(|&a, &b| dependents[b].cmp(&dependents[a]).then(a.cmp(&b)));
    let ordered: Vec<&DriftFinding> = order.iter().map(|&i| &findings[i]).collect();

    let services: Vec<String> = ordered.iter().map(|f| f.service.clone()).collect();
    let list = join_names(&services);
    let one = services.len() == 1;
    // Grammatical pronouns: singular "it / this / leave it as it is"; plural "them / these /
    // leave them as they are" (the trailing clause changes BOTH pronoun and verb).
    let (object, this_these, leave_clause) = if one {
        ("it", "this", "leave it as it is")
    } else {
        ("them", "these", "leave them as they are")
    };
    let intro = format!(
        "These steps put {list} back the way Windows ships {object} (Automatic startup). Compy makes \
         no change here — you do it yourself. If you switched {this_these} off on purpose, you can \
         {leave_clause}."
    );
    // Dependency-ordering caution — present ONLY when a drifted service AND its prerequisite are both
    // off (never lecture about a dependency that is already fine). Names both services and explains
    // the failure a wrong order would cause, so the user restores them in the right sequence.
    let dep_step: Option<String> = ordered.iter().find_map(|f| {
        let req = f.requires.as_deref()?;
        is_drifted(req).then(|| {
            let dependent = &f.service;
            format!(
                "Order matters here: {dependent} depends on {req}, so start {req} first. If you turn \
                 {dependent} on before it, Windows reports that a dependency service failed to start. \
                 Set {req} to Automatic and Start it, then do {dependent}."
            )
        })
    });
    let mut steps = vec![
        "Press the Windows key + R together, type  services.msc  and press Enter to open the Services window."
            .to_string(),
    ];
    if let Some(dep) = dep_step {
        steps.push(dep);
    }
    steps.push(format!(
        "In the list (it is sorted A–Z), find {}. Double-click the row to open its settings.",
        if one { list.clone() } else { format!("the first of: {list}") }
    ));
    steps.push(
        "On the General tab, click the \"Startup type\" dropdown and choose \"Automatic\", then click Apply."
            .to_string(),
    );
    steps.push(
        "If the \"Service status\" says Stopped, click the Start button to turn it on now, then click OK."
            .to_string(),
    );
    steps.push(if one {
        "That's it — the service is back to how Windows sets it by default.".to_string()
    } else {
        "Repeat for each of the services listed above, then close the Services window.".to_string()
    });
    Some(RecoveryGuide { services, intro, steps })
}

/// The full read-only services report: the categorised inventory, any startup-drift findings, and a
/// by-hand recovery guide when there is drift — built from ONE service enumeration (the WMI read is
/// the expensive part — do it once).
pub(crate) struct ServiceReport {
    pub inventory: Inventory,
    pub drift: Vec<DriftFinding>,
    pub recovery: Option<RecoveryGuide>,
}

/// Collect the live, read-only services report (categorised inventory + startup drift + recovery guide).
pub(crate) fn collect_service_report() -> ServiceReport {
    let rows = enumerate_services();
    let drift = build_service_drift(&rows);
    let recovery = build_recovery_guide(&drift);
    let inventory = build_inventory(rows);
    ServiceReport { inventory, drift, recovery }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(name: &str, display: &str, state: &str, start: &str) -> SvcRow {
        SvcRow {
            name: name.into(),
            display_name: display.into(),
            state: state.into(),
            start_mode: start.into(),
        }
    }

    #[test]
    fn base_name_strips_per_user_luid_only() {
        assert_eq!(base_name("BcastDVRUserService_5ca62"), "BcastDVRUserService");
        assert_eq!(base_name("CDPUserSvc_5ca62"), "CDPUserSvc");
        // Not a hex LUID — preserved verbatim.
        assert_eq!(base_name("EasyAntiCheat_EOS"), "EasyAntiCheat_EOS");
        // No underscore — unchanged.
        assert_eq!(base_name("DiagTrack"), "DiagTrack");
        // Too-short tail is not treated as a LUID (avoids over-stripping).
        assert_eq!(base_name("foo_ab"), "foo_ab");
    }

    #[test]
    fn categorize_recognizes_known_case_insensitively() {
        assert_eq!(categorize("DiagTrack").map(|c| c.0), Some(Category::Telemetry));
        assert_eq!(categorize("diagtrack").map(|c| c.0), Some(Category::Telemetry));
        assert_eq!(categorize("SysMain").map(|c| c.0), Some(Category::Performance));
        assert_eq!(categorize("WSearch").map(|c| c.0), Some(Category::Search));
        assert_eq!(categorize("AMD External Events Utility").map(|c| c.0), Some(Category::Vendor));
        assert_eq!(categorize("BEService").map(|c| c.0), Some(Category::AntiCheat));
        assert_eq!(categorize("XblGameSave").map(|c| c.0), Some(Category::Xbox));
        assert_eq!(categorize("wuauserv").map(|c| c.0), Some(Category::Updates));
    }

    #[test]
    fn categorize_matches_per_user_base_name() {
        // The live name carries a LUID suffix; the curated entry is the base name.
        assert_eq!(
            categorize("BcastDVRUserService_5ca62").map(|c| c.0),
            Some(Category::Xbox)
        );
    }

    #[test]
    fn categorize_matches_versioned_prefix() {
        assert_eq!(
            categorize("GoogleUpdaterService150.0.7863.0").map(|c| c.0),
            Some(Category::ThirdPartyUpdater)
        );
        assert_eq!(
            categorize("GoogleUpdaterInternalService150.0.7863.0").map(|c| c.0),
            Some(Category::ThirdPartyUpdater)
        );
    }

    #[test]
    fn nvagent_is_not_misread_as_nvidia() {
        // Real-data gotcha: `nvagent` is Windows' "Network Virtualization
        // Service", NOT an NVIDIA service. Must stay unrecognised, never Vendor.
        assert_eq!(categorize("nvagent"), None);
    }

    #[test]
    fn unknown_services_are_never_guessed() {
        assert_eq!(categorize("RpcSs"), None);
        assert_eq!(categorize("DcomLaunch"), None);
        assert_eq!(categorize("some-random-third-party-svc"), None);
    }

    #[test]
    fn format_state_combines_state_and_start_mode() {
        assert_eq!(format_state("Running", "Auto"), "Running · Automatic start");
        assert_eq!(format_state("Stopped", "Manual"), "Stopped · Manual start");
        assert_eq!(format_state("Stopped", "Disabled"), "Stopped · Disabled");
        // Unknown/empty start mode → just the state, never a stray separator.
        assert_eq!(format_state("Running", "Unknown"), "Running");
        assert_eq!(format_state("Running", ""), "Running");
    }

    #[test]
    fn build_inventory_groups_sorts_and_counts() {
        let rows = vec![
            row("WSearch", "Windows Search", "Stopped", "Disabled"),
            row("DiagTrack", "Connected User Experiences and Telemetry", "Stopped", "Disabled"),
            row("SysMain", "SysMain", "Running", "Auto"),
            row("RpcSs", "Remote Procedure Call (RPC)", "Running", "Auto"), // unknown
            row("WSAIFabricSvc", "WSAIFabricSvc", "Running", "Auto"),       // unknown
        ];
        let inv = build_inventory(rows);
        assert_eq!(inv.total, 5);
        assert_eq!(inv.recognized, 3);
        // Categories sorted by display order: Performance(4) < Telemetry(5) < Search(8).
        let titles: Vec<&str> = inv.groups.iter().map(|g| g.category.as_str()).collect();
        assert_eq!(
            titles,
            vec!["Performance & memory", "Telemetry & diagnostics", "Search & indexing"]
        );
        // Recognised rows carry a description note; values combine state+mode.
        let sysmain = &inv.groups[0].rows[0];
        assert_eq!(sysmain.value, "Running · Automatic start");
        assert!(sysmain.note.as_deref().unwrap().contains("Superfetch"));
    }

    #[test]
    fn build_inventory_sorts_rows_within_a_group_by_label() {
        let rows = vec![
            row("XboxNetApiSvc", "Xbox Live Networking Service", "Stopped", "Manual"),
            row("XblAuthManager", "Xbox Live Auth Manager", "Stopped", "Manual"),
        ];
        let inv = build_inventory(rows);
        assert_eq!(inv.groups.len(), 1);
        let labels: Vec<&str> = inv.groups[0].rows.iter().map(|r| r.label.as_str()).collect();
        // "Xbox Live Auth Manager" < "Xbox Live Networking Service"
        assert_eq!(labels, vec!["Xbox Live Auth Manager", "Xbox Live Networking Service"]);
    }

    #[test]
    fn empty_input_yields_empty_inventory_no_panic() {
        let inv = build_inventory(vec![]);
        assert_eq!(inv.total, 0);
        assert_eq!(inv.recognized, 0);
        assert!(inv.groups.is_empty());
    }

    #[test]
    fn label_falls_back_to_name_when_display_blank_or_equal() {
        let rows = vec![
            row("SysMain", "SysMain", "Running", "Auto"),
            row("WSearch", "", "Stopped", "Disabled"),
        ];
        let inv = build_inventory(rows);
        assert_eq!(inv.groups[0].rows[0].label, "SysMain"); // display == name → name
        assert_eq!(inv.groups[1].rows[0].label, "WSearch"); // blank display → name
    }

    #[test]
    fn label_strips_per_user_luid_suffix_when_no_friendly_name() {
        // Per-user services often have DisplayName == raw Name carrying a session
        // LUID; the UI should show the clean base name, never "…_5ca62".
        let rows = vec![row("BcastDVRUserService_5ca62", "BcastDVRUserService_5ca62", "Stopped", "Manual")];
        let inv = build_inventory(rows);
        assert_eq!(inv.groups[0].rows[0].label, "BcastDVRUserService");
    }

    #[test]
    fn no_empty_groups_are_emitted() {
        let inv = build_inventory(vec![row("DiagTrack", "x", "Stopped", "Disabled")]);
        assert!(inv.groups.iter().all(|g| !g.rows.is_empty()));
    }

    // ── Service startup drift (A4) ─────────────────────────────────────────────────────────────

    fn drift_find<'a>(d: &'a [DriftFinding], label_prefix: &str) -> Option<&'a DriftFinding> {
        d.iter().find(|f| f.label.starts_with(label_prefix))
    }

    #[test]
    fn stock_services_yield_no_drift_first_class() {
        // Every catalog service present at its stock Automatic startup → ZERO findings.
        let rows = vec![
            row("Audiosrv", "Windows Audio", "Running", "Auto"),
            row("AudioEndpointBuilder", "Windows Audio Endpoint Builder", "Running", "Auto"),
            row("Themes", "Themes", "Running", "Auto"),
            row("RpcSs", "Remote Procedure Call (RPC)", "Running", "Auto"), // non-catalog
        ];
        assert!(build_service_drift(&rows).is_empty(), "stock startup must yield no drift");
    }

    #[test]
    fn disabled_catalog_service_is_flagged_with_full_receipt() {
        let rows = vec![row("Audiosrv", "Windows Audio", "Stopped", "Disabled")];
        let d = build_service_drift(&rows);
        let f = drift_find(&d, "Windows Audio").expect("disabled audio → finding");
        // Receipt: exact current value, stock default, matched tweak, cost, verdict, restore note.
        assert!(f.current.contains("Disabled"), "current names the real value: {}", f.current);
        assert!(f.stock.to_lowercase().contains("automatic"));
        assert!(!f.matched_tweak.is_empty() && !f.cost.is_empty() && !f.verdict.is_empty());
        assert!(f.restore_note.to_lowercase().contains("reversible"));
        // Honest origin-uncertainty is carried, not assumed.
        assert!(f.restore_note.to_lowercase().contains("on purpose"));
    }

    #[test]
    fn manual_startup_is_also_drift_for_an_automatic_stock_service() {
        // Stock is Automatic; Manual is non-stock and audio won't auto-start — still drift.
        let rows = vec![row("Audiosrv", "Windows Audio", "Stopped", "Manual")];
        let f = &build_service_drift(&rows)[0];
        assert!(f.current.contains("Manual start"), "current: {}", f.current);
    }

    #[test]
    fn absent_catalog_service_is_never_flagged() {
        // Not present at all → we can't tell "removed" from "never installed" → no finding.
        let rows = vec![row("RpcSs", "Remote Procedure Call (RPC)", "Running", "Auto")];
        assert!(build_service_drift(&rows).is_empty());
    }

    #[test]
    fn non_catalog_service_changes_are_ignored() {
        // Closed catalog: a disabled service we don't curate is NEVER drift (no heuristics).
        let rows = vec![row("SomeRandomVendorSvc", "Random", "Stopped", "Disabled")];
        assert!(build_service_drift(&rows).is_empty());
    }

    #[test]
    fn boot_system_and_unknown_start_modes_are_not_guessed() {
        // Only Manual/Disabled are the guide pattern; anything else is left unjudged (honesty).
        for sm in ["Boot", "System", "Unknown", ""] {
            let rows = vec![row("Audiosrv", "Windows Audio", "Running", sm)];
            assert!(
                build_service_drift(&rows).is_empty(),
                "start mode {sm:?} must not be guessed as drift"
            );
        }
    }

    #[test]
    fn matching_is_case_insensitive_and_handles_base_name() {
        // Live names vary in case; per-user LUID suffixes must still match the base catalog name.
        assert!(service_name_matches("audiosrv", "Audiosrv"));
        assert!(service_name_matches("AUDIOSRV", "Audiosrv"));
        assert!(service_name_matches("Themes_5ca62", "Themes"));
        assert!(!service_name_matches("AudioEndpointBuilder", "Audiosrv"));
    }

    #[test]
    fn law_every_drift_spec_can_fire_with_a_full_receipt() {
        // A silent detector is a lie: every curated entry must fire on its own disabled fixture,
        // and every receipt field must be present.
        let rows: Vec<SvcRow> =
            DRIFT.iter().map(|s| row(s.name, s.label, "Stopped", "Disabled")).collect();
        let d = build_service_drift(&rows);
        assert_eq!(d.len(), DRIFT.len(), "every curated drift detector must fire on its rotted fixture");
        for f in &d {
            for (field, v) in [
                ("current", &f.current),
                ("stock", &f.stock),
                ("matched_tweak", &f.matched_tweak),
                ("cost", &f.cost),
                ("verdict", &f.verdict),
                ("restore_note", &f.restore_note),
            ] {
                assert!(!v.trim().is_empty(), "{}: empty {} — a finding without its receipt", f.label, field);
            }
        }
    }

    #[test]
    fn law_no_boost_promises_no_alarm_in_drift_copy() {
        // Counting, not alarm; honest-measurement — never promise a gain. (Honest negations like
        // "no measured FPS" are fine; these tokens never are.)
        let banned = ["boost", "speed up", "speeds up", "guaranteed", "instantly faster", "unlock fps"];
        let alarm = ["danger", "warning!", "critical!", "fix now", "issues found"];
        for s in DRIFT {
            let copy = format!("{} {} {} {}", s.label, s.matched_tweak, s.cost, s.verdict).to_lowercase();
            for b in banned {
                assert!(!copy.contains(b), "{}: promise language '{b}' in: {copy}", s.name);
            }
            for a in alarm {
                assert!(!copy.contains(a), "{}: alarm language '{a}' in: {copy}", s.name);
            }
            assert!(!s.label.contains('!'), "{}: exclamation in label — sirens are not placards", s.name);
        }
    }

    // ── Service recovery guide (A4) ────────────────────────────────────────────────────────────

    #[test]
    fn no_drift_yields_no_recovery_guide() {
        // Nothing switched off → nothing to recover → None (never an empty guide, never noise).
        assert!(build_recovery_guide(&[]).is_none());
        let stock = vec![row("Audiosrv", "Windows Audio", "Running", "Auto")];
        assert!(build_recovery_guide(&build_service_drift(&stock)).is_none());
    }

    #[test]
    fn one_drift_yields_a_named_singular_guide() {
        let drift = build_service_drift(&[row("Audiosrv", "Windows Audio", "Stopped", "Disabled")]);
        let g = build_recovery_guide(&drift).expect("one drift → a guide");
        // Names the exact affected service (receipts, not generic boilerplate).
        assert_eq!(g.services, vec!["Windows Audio".to_string()]);
        assert!(g.intro.contains("Windows Audio"), "intro names the service: {}", g.intro);
        // Honest framing: origin-uncertainty + Compy-makes-no-change.
        assert!(g.intro.to_lowercase().contains("on purpose"));
        assert!(g.intro.to_lowercase().contains("compy makes no change"));
        // Grammar guard (bug→guard): singular reads "ships it" / "leave it as it is".
        assert!(g.intro.contains("ships it"), "singular pronoun: {}", g.intro);
        assert!(g.intro.contains("leave it as it is"), "singular clause: {}", g.intro);
        // The real procedure is present and self-contained.
        assert!(!g.steps.is_empty());
        let all = g.steps.join(" ").to_lowercase();
        assert!(all.contains("services.msc"), "steps open the Services console");
        assert!(all.contains("automatic"), "steps set Automatic startup");
        // Singular phrasing — no "repeat for each" when there is only one.
        assert!(!all.contains("repeat for each"));
    }

    #[test]
    fn multiple_drift_lists_all_services_and_says_repeat() {
        let rows = vec![
            row("Audiosrv", "Windows Audio", "Stopped", "Disabled"),
            row("Themes", "Themes", "Stopped", "Manual"),
        ];
        let g = build_recovery_guide(&build_service_drift(&rows)).expect("two drifts → a guide");
        assert_eq!(g.services, vec!["Windows Audio".to_string(), "Themes".to_string()]);
        // Plain-English join names BOTH services.
        assert!(g.intro.contains("Windows Audio and Themes"), "intro: {}", g.intro);
        // Grammar guard (bug→guard): plural reads "ships them" / "leave them as they are" — never
        // the "leave them as them is" break the singular/plural collapse once produced.
        assert!(g.intro.contains("ships them"), "plural pronoun: {}", g.intro);
        assert!(g.intro.contains("leave them as they are"), "plural clause: {}", g.intro);
        assert!(!g.intro.contains("them is"), "plural grammar break: {}", g.intro);
        // Plural guidance to handle every service.
        assert!(g.steps.join(" ").to_lowercase().contains("repeat for each"));
    }

    #[test]
    fn requires_field_names_the_curated_prerequisite() {
        // Windows Audio's start dependency is a curated, well-established fact (Audio Endpoint Builder
        // must be running first). The prerequisite itself, and unrelated services, require nothing.
        let audio = build_service_drift(&[row("Audiosrv", "Windows Audio", "Stopped", "Disabled")]);
        assert_eq!(audio[0].requires.as_deref(), Some("Windows Audio Endpoint Builder"));
        let aeb = build_service_drift(&[row(
            "AudioEndpointBuilder",
            "Windows Audio Endpoint Builder",
            "Stopped",
            "Disabled",
        )]);
        assert_eq!(aeb[0].requires, None);
        let themes = build_service_drift(&[row("Themes", "Themes", "Stopped", "Disabled")]);
        assert_eq!(themes[0].requires, None);
    }

    #[test]
    fn recovery_guide_restores_a_drifted_prerequisite_first_with_an_ordering_note() {
        // Both audio services off: the Endpoint Builder must be restored BEFORE Windows Audio, or
        // starting Windows Audio fails with "a dependency service failed to start". The guide must
        // order the prerequisite first (despite catalog order) and explain why.
        let rows = vec![
            row("Audiosrv", "Windows Audio", "Stopped", "Disabled"),
            row("AudioEndpointBuilder", "Windows Audio Endpoint Builder", "Stopped", "Disabled"),
        ];
        let g = build_recovery_guide(&build_service_drift(&rows)).expect("two drifts → a guide");
        assert_eq!(
            g.services,
            vec!["Windows Audio Endpoint Builder".to_string(), "Windows Audio".to_string()],
            "the prerequisite must be listed first: {:?}",
            g.services
        );
        let all = g.steps.join(" ");
        assert!(
            all.contains("Windows Audio Endpoint Builder") && all.contains("Windows Audio"),
            "an ordering step names both services: {all}"
        );
        assert!(all.to_lowercase().contains("depend"), "the ordering step explains the dependency: {all}");
    }

    #[test]
    fn no_ordering_note_when_only_the_dependent_drifted() {
        // Windows Audio off but the Endpoint Builder at stock → starting Windows Audio just works →
        // never lecture about a dependency that is already fine.
        let g = build_recovery_guide(&build_service_drift(&[row(
            "Audiosrv",
            "Windows Audio",
            "Stopped",
            "Disabled",
        )]))
        .expect("one drift → a guide");
        assert!(
            !g.steps.join(" ").to_lowercase().contains("depend"),
            "no dependency lecture when the prerequisite is at stock: {:?}",
            g.steps
        );
    }

    #[test]
    fn law_requires_references_a_real_catalog_label() {
        // A prerequisite must name an actual curated service (and never itself), so the recovery
        // ordering can't drift into a dangling/self reference.
        let labels: Vec<&str> = DRIFT.iter().map(|s| s.label).collect();
        for s in DRIFT {
            if let Some(req) = s.requires {
                assert!(labels.contains(&req), "{}: requires '{req}' is not a curated catalog label", s.name);
                assert_ne!(req, s.label, "{}: a service cannot require itself", s.name);
            }
        }
    }

    #[test]
    fn join_names_reads_as_plain_english() {
        let mk = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert_eq!(join_names(&mk(&[])), "");
        assert_eq!(join_names(&mk(&["A"])), "A");
        assert_eq!(join_names(&mk(&["A", "B"])), "A and B");
        assert_eq!(join_names(&mk(&["A", "B", "C"])), "A, B and C");
    }

    #[test]
    fn law_recovery_guide_is_advisory_no_promise_no_alarm_no_mutation_verb() {
        // The guide is reference data the USER follows — it must never promise a gain, never alarm,
        // and never imply Compy itself flips anything (no auto/one-click/apply language).
        let banned = ["boost", "speed up", "speeds up", "guaranteed", "instantly faster", "unlock fps"];
        let alarm = ["danger", "warning!", "critical!", "fix now", "issues found"];
        let auto = ["compy will", "click apply in compy", "one-click", "apply all", "let compy"];
        // Cover the maximal case: every catalog entry drifted at once.
        let rows: Vec<SvcRow> =
            DRIFT.iter().map(|s| row(s.name, s.label, "Stopped", "Disabled")).collect();
        let g = build_recovery_guide(&build_service_drift(&rows)).expect("guide");
        let copy = format!("{} {}", g.intro, g.steps.join(" ")).to_lowercase();
        for b in banned {
            assert!(!copy.contains(b), "recovery guide carries promise language '{b}': {copy}");
        }
        for a in alarm {
            assert!(!copy.contains(a), "recovery guide carries alarm language '{a}': {copy}");
        }
        for a in auto {
            assert!(!copy.contains(a), "recovery guide implies Compy mutates '{a}': {copy}");
        }
        // Every step is a real instruction, never an empty placeholder.
        for (i, s) in g.steps.iter().enumerate() {
            assert!(!s.trim().is_empty(), "recovery step {i} is empty");
        }
    }

    #[test]
    fn law_drift_catalog_never_targets_a_compy_endorsed_disable() {
        // The non-contradiction invariant: the drift catalog must never flag a service Compy's own
        // engine recommends turning OFF (else "you disabled this" would contradict "we told you to").
        // These are the canonical Compy-endorsed-disable / commonly-deliberate targets.
        let endorsed_or_deliberate = [
            "SysMain", "DiagTrack", "WSearch", "XblAuthManager", "XblGameSave", "XboxGipSvc",
            "XboxNetApiSvc", "BcastDVRUserService", "Spooler",
        ];
        for s in DRIFT {
            assert!(
                !endorsed_or_deliberate.iter().any(|e| service_name_matches(s.name, e)),
                "{} must not be a drift target — it's a Compy-endorsed or commonly-deliberate disable",
                s.name
            );
        }
    }
}
