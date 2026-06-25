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

/// Collect the live, categorised, read-only service inventory.
pub(crate) fn collect_service_inventory() -> Inventory {
    build_inventory(enumerate_services())
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
}
