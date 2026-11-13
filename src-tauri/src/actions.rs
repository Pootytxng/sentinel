//! actions: the Windows-mutation boundary. Owns every change Compy makes to
//! the system AND the rollback/restoration mechanics — the typed action
//! allowlist (KnownService, AppliedAction, RollbackAction, Snapshot), the
//! apply_* functions, the rollback_*_typed functions, the rollback dispatch,
//! legacy-synthesis + history-only rollback resolution, and the shared
//! mutation primitives (run_elevated_powershell, powercfg/service/EEE helpers).
//!
//! Boundary: actions executes mutation + restoration. lib orchestrates (the
//! apply_recommendation / rollback_change commands call into here and own
//! history). recommendations decides what to show but never mutates. The state
//! probes stay in lib for now and are consumed here by name.
//! This is a pure boundary move — no behavior change.

use std::process::Command;

use serde::{Deserialize, Serialize};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE};
use winreg::RegKey;
use wmi::{COMLibrary, WMIConnection};

use crate::history::AppliedChange;
// State probes stay in lib (least-wrong place until a cleaner seam); some
// apply_* fns read them to snapshot prior state before mutating.
use crate::{fast_startup_state_checked, hags_state_checked, reserved_storage_enabled_checked};

/// Build a `Command` that never flashes a console window. EVERY non-elevated CLI probe (powercfg,
/// sc, logman, powershell) MUST use this — without `CREATE_NO_WINDOW`, Windows briefly pops a
/// console per spawn, which on launch reads as the terminal rapidly flashing open and closed.
pub(crate) fn quiet_command(program: &str) -> Command {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut c = Command::new(program);
    c.creation_flags(CREATE_NO_WINDOW);
    c
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) enum KnownService {
    SysMain,
    DiagTrack,
    WSearch,
    NvTelemetryContainer,
}

impl KnownService {
    /// Every allowlisted service, so callers iterate the enum instead of listing it by hand.
    pub(crate) const ALL: [KnownService; 4] = [
        KnownService::SysMain,
        KnownService::DiagTrack,
        KnownService::WSearch,
        KnownService::NvTelemetryContainer,
    ];

    pub(crate) fn name(&self) -> &'static str {
        match self {
            KnownService::SysMain => "SysMain",
            KnownService::DiagTrack => "DiagTrack",
            KnownService::WSearch => "WSearch",
            KnownService::NvTelemetryContainer => "NvTelemetryContainer",
        }
    }

    /// Map a service name to the type-enforced allowlist (the ONLY services Compy may suspend).
    /// Returns None for anything off-allowlist — including every critical service (csrss / lsass /
    /// services.exe / Defender / …), which therefore can never reach the suspend primitive.
    pub(crate) fn from_name(name: &str) -> Option<KnownService> {
        match name {
            "SysMain" => Some(KnownService::SysMain),
            "DiagTrack" => Some(KnownService::DiagTrack),
            "WSearch" => Some(KnownService::WSearch),
            "NvTelemetryContainer" => Some(KnownService::NvTelemetryContainer),
            _ => None,
        }
    }
}

/// Allowlist of well-known, textbook-safe TELEMETRY scheduled tasks Compy may disable. Conservative
/// STARTER set (Microsoft-documented CEIP / Compatibility-Appraiser telemetry) — explicitly **NO
/// Defender, NO system policy, nothing that breaks functionality** (those stay on the hard blocklist).
/// The owner curates/expands this set before the feature is EVER armed (`bloat_removal_gate()`=false
/// until then), so nothing AI-guessed ships. Type-enforced: only these tasks are ever disable-able.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) enum KnownBloatTask {
    CompatibilityAppraiser,
    CeipConsolidator,
    CeipUsb,
}

impl KnownBloatTask {
    /// (TaskPath, TaskName) — fixed, Microsoft-documented telemetry-task identifiers. Both legitimately
    /// contain spaces + backslashes, so they go through `ps_safe_squoted` (single-quoted-literal guard).
    fn path_and_name(&self) -> (&'static str, &'static str) {
        match self {
            KnownBloatTask::CompatibilityAppraiser => (
                "\\Microsoft\\Windows\\Application Experience\\",
                "Microsoft Compatibility Appraiser",
            ),
            KnownBloatTask::CeipConsolidator => (
                "\\Microsoft\\Windows\\Customer Experience Improvement Program\\",
                "Consolidator",
            ),
            KnownBloatTask::CeipUsb => (
                "\\Microsoft\\Windows\\Customer Experience Improvement Program\\",
                "UsbCeip",
            ),
        }
    }

    /// Map an id to the type-enforced allowlist — rejects everything off-list (Defender/policy/etc.
    /// can never be passed).
    pub(crate) fn from_id(id: &str) -> Option<KnownBloatTask> {
        match id {
            "compatibility-appraiser" => Some(KnownBloatTask::CompatibilityAppraiser),
            "ceip-consolidator" => Some(KnownBloatTask::CeipConsolidator),
            "ceip-usb" => Some(KnownBloatTask::CeipUsb),
            _ => None,
        }
    }
}

/// Allowlist of preinstalled Store apps Compy may remove FOR THE CURRENT USER ONLY — Phase-B
/// "bloat removal", owner nod 2026-07-06 (spec `docs/superpowers/specs/2026-07-06-preload-app-removal-dark.md`).
/// Membership rules, ALL must hold: still published in the Microsoft Store (genuinely re-gettable) ·
/// no meaningful local user data (Mail/Photos/Sticky Notes/OneNote excluded forever; Clipchamp +
/// To Do deliberately left off as data-adjacent) · never a framework/dependency, never the Store
/// itself, never Xbox Game Bar / Gaming Services, never anything security-related. The owner
/// curates this set before the feature is EVER armed (`preload_removal_gate()`=false until then),
/// so nothing AI-guessed ships. Type-enforced: only these apps are ever removable.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) enum KnownPreloadApp {
    SolitaireCollection,
    FeedbackHub,
    BingNews,
    OfficeHub,
    // Spotify was in the v1 proposal and CUT by owner curation 2026-07-06: SpotifyAB.SpotifyMusic
    // is the same package id for the preload stub AND a user's daily-driver install — no honest
    // "stub" framing exists. May return behind a usage check.
}

impl KnownPreloadApp {
    pub(crate) const ALL: [KnownPreloadApp; 4] = [
        KnownPreloadApp::SolitaireCollection,
        KnownPreloadApp::FeedbackHub,
        KnownPreloadApp::BingNews,
        KnownPreloadApp::OfficeHub,
    ];

    /// The Appx package Name (`Get-AppxPackage -Name`) — fixed, well-known identifiers.
    pub(crate) fn package_name(&self) -> &'static str {
        match self {
            KnownPreloadApp::SolitaireCollection => "Microsoft.MicrosoftSolitaireCollection",
            KnownPreloadApp::FeedbackHub => "Microsoft.WindowsFeedbackHub",
            KnownPreloadApp::BingNews => "Microsoft.BingNews",
            KnownPreloadApp::OfficeHub => "Microsoft.MicrosoftOfficeHub",
        }
    }

    /// Microsoft Store ProductId for the tier-2 rollback hand-off (`ms-windows-store://pdp/`).
    /// CURATED data, not a runtime read — every id must be live-verified (link opened, right app
    /// confirmed) during the arming QA before `preload_removal_gate()` ever flips.
    pub(crate) fn store_product_id(&self) -> &'static str {
        match self {
            KnownPreloadApp::SolitaireCollection => "9WZDNCRFHWD2",
            KnownPreloadApp::FeedbackHub => "9NBLGGH4R32N",
            KnownPreloadApp::BingNews => "9WZDNCRFHVFW",
            KnownPreloadApp::OfficeHub => "9WZDNCRD29V9",
        }
    }

    /// The stable id the FE + ledger use (`preload-app:<id>` receipts).
    pub(crate) fn id(&self) -> &'static str {
        match self {
            KnownPreloadApp::SolitaireCollection => "solitaire-collection",
            KnownPreloadApp::FeedbackHub => "feedback-hub",
            KnownPreloadApp::BingNews => "bing-news",
            KnownPreloadApp::OfficeHub => "office-hub",
        }
    }

    /// Map an id to the type-enforced allowlist — rejects everything off-list (the Store, Game Bar,
    /// Defender, data-bearing apps, arbitrary package names can never be passed).
    pub(crate) fn from_id(id: &str) -> Option<KnownPreloadApp> {
        KnownPreloadApp::ALL.iter().find(|a| a.id() == id).cloned()
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(crate) enum AppliedAction {
    DisableKnownService { service: KnownService },
    // Startup-entry toggle. Not a catalogued recommendation — it is a per-machine list the user
    // acts on directly — so it gets its own mutation class, exactly like service-suspend and
    // bloat-task removal do.
    SetStartupEntryEnabled { name: String, enabled: bool },
    // Session-scoped SUSPEND (Stop only, startup-type untouched) — distinct from the permanent
    // DisableKnownService. Behind service_suspend_gate() — ARMED 2026-06-25 after its UAC QA + owner sign-off.
    SuspendKnownService { service: KnownService },
    EnableGameMode,
    DisableMouseAcceleration,
    DisableGameBarAndDvr,
    SetVisualEffectsBestPerformance,
    EnableHardwareGpuScheduling,
    SetUltimatePerformancePlan,
    DisableNagleOnActiveNics,
    DisableFastStartup,
    DisableReservedStorage,
    DisableUsbSelectiveSuspendOnAc,
    DisablePcieAspmOnAc,
    DisableEnergyEfficientEthernet,
    // ── Leftovers v2 restore (R2-5, BUILT DARK — gate off, no IPC; ships only after its own
    // live UAC QA + owner sign-off). Each restores a Windows STOCK default; the snapshot holds
    // the rotted value, so even the restore is reversible ("you can get your rot back").
    RestoreMemoryCompressionDefault,
    RestoreMmcssDefaults,
    RestorePrioritySeparationDefault,
    // Leftovers v2 wave 2 (2026-06-11; armed 2026-07-16): MPO / core-parking / TCP autotuning. All
    // integer-or-fixed-command — no external string enters an elevated command. (Pagefile +
    // bcdedit + Defender deliberately NOT here — see the spec / Review Queue.)
    RestoreMpoDefault,
    RestoreCoreParkingDefault,
    RestoreTcpAutotuningDefault,
    // The origin-story resolver (option (a), Cowork call 2026-06-11): re-enable Windows-managed
    // paging. Reboot required to take effect — stated, never silent.
    RestorePagefileAutomatic,
    // OS-debloat (BUILT DARK): disable a well-known telemetry scheduled task. Reversible via
    // EnableScheduledTask. ONLY the curated KnownBloatTask set (no Defender / policy).
    DisableScheduledTask { task: KnownBloatTask },
    // Phase-B preload-app removal (BUILT DARK 2026-07-06): per-user Remove-AppxPackage, ONLY the
    // curated KnownPreloadApp set. Undo = ReinstallPreloadApp (two honest tiers — see the spec).
    RemovePreloadApp { app: KnownPreloadApp },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
// The shared `Restore*` prefix is semantic, not redundant — these variants ARE
// the restore (rollback) action set. Renaming them would churn the serde tags +
// dispatch match + the persisted Trust Ledger contract for zero benefit.
#[allow(clippy::enum_variant_names)]
pub(crate) enum RollbackAction {
    RestoreServiceFromSnapshot { service: KnownService },
    RestoreStartupApprovalFromSnapshot,
    ResumeServiceFromSnapshot { service: KnownService },
    RestoreGameModeFromSnapshot,
    RestoreMouseAccelFromSnapshot,
    RestoreGameBarFromSnapshot,
    RestoreVisualEffectsFromSnapshot,
    RestoreHwSchModeFromSnapshot,
    RestorePowerPlanFromSnapshot,
    RestoreNagleNicsFromSnapshot,
    RestoreFastStartupFromSnapshot,
    RestoreReservedStorageFromSnapshot,
    // USB SS + PCIe ASPM share this variant. The Snapshot::PowerPlanSetting
    // carries the subgroup + setting GUIDs plus the prior AC/DC values, so
    // a single typed rollback handler covers both rec ids.
    RestorePowerPlanSettingFromSnapshot,
    RestoreEnergyEfficientEthernetFromSnapshot,
    // Leftovers v2 (dark): undo a restore — put the user's pre-restore (rotted) value back.
    RestoreMemoryCompressionFromSnapshot,
    RestoreMmcssFromSnapshot,
    RestorePrioritySeparationFromSnapshot,
    // Wave 2.
    RestoreMpoFromSnapshot,
    RestoreCoreParkingFromSnapshot,
    RestoreTcpAutotuningFromSnapshot,
    RestorePagefileFromSnapshot,
    EnableScheduledTask { task: KnownBloatTask },
    // Preload-app removal undo. NOT byte-identical like registry restores: tier 1 silently
    // re-registers the still-staged package (verified by re-read), tier 2 hands off to the app's
    // Store page and honestly returns Err so the ledger entry stays active until confirmed back.
    ReinstallPreloadApp { app: KnownPreloadApp },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Snapshot {
    Service {
        prior_state: String,
        prior_start_mode: String,
    },
    // Startup-entry approval (HKCU\...\Explorer\StartupApproved\Run). `prior_bytes`/`prior_vtype`
    // are the EXACT value that was there, so rollback restores it byte-for-byte. `None` means the
    // value was genuinely ABSENT (Windows treats absent as enabled) and rollback deletes it again.
    // An UNREADABLE prior is never represented here — the apply refuses instead, because a prior we
    // cannot prove is not a prior we can promise to restore.
    StartupApproval {
        name: String,
        prior_bytes: Option<Vec<u8>>,
        prior_vtype: Option<u32>,
    },
    GameMode {
        prior_enabled: Option<u32>,
        // AllowAutoGameMode — the master "allow" Windows reconciles AutoGameModeEnabled against on
        // login. Captured so rollback restores the exact pair. `#[serde(default)]` keeps pre-fix
        // typed ledger entries (which lacked this field) deserializable, so a change applied before
        // this fix stays undoable — rollback-first integrity (ARCHITECTURE_LOCKS §3).
        #[serde(default)]
        prior_allow: Option<u32>,
    },
    MouseAccel {
        prior_speed: String,
        prior_threshold1: String,
        prior_threshold2: String,
    },
    GameBar {
        prior_capture: Option<u32>,
        prior_enabled: Option<u32>,
    },
    VisualEffects {
        vfx_setting_prior: Option<u32>,
        user_prefs_mask_prior: Option<Vec<u8>>,
    },
    HwSchMode {
        prior: Option<u32>,
    },
    PowerPlan {
        prior_guid: String,
    },
    NagleNics {
        interfaces: Vec<NagleInterfaceSnapshot>,
    },
    FastStartup {
        prior_hiberboot: Option<u32>,
    },
    ReservedStorage {
        prior_enabled: bool,
    },
    // Generic power-plan setting snapshot — used by USB Selective Suspend
    // and PCIe ASPM (both follow the same powercfg /setacvalueindex shape).
    // Snapshots both AC and DC values plus the active plan GUID for context.
    PowerPlanSetting {
        plan_guid: String,
        subgroup_guid: String,
        setting_guid: String,
        prior_ac_value: u32,
        prior_dc_value: u32,
    },
    // Per-adapter Energy Efficient Ethernet property. Each adapter has a
    // potentially different vendor-named property (EEE / Green Ethernet /
    // Advanced EEE / etc.) — snapshot stores the resolved name per adapter.
    EeeNicProperty {
        adapters: Vec<EeeNicSnapshot>,
    },
    // ── Leftovers v2 (dark) — the pre-restore (rotted) values, so a restore is undoable. ──
    // None for a registry value means "was absent" (rollback deletes it); the memory-compression
    // apply REFUSES when its prior is unreadable, so its None never reaches a rollback blind.
    MemoryCompression {
        prior_enabled: Option<bool>,
    },
    Mmcss {
        prior_system_responsiveness: Option<u32>,
        prior_network_throttling: Option<u32>,
    },
    PrioritySeparation {
        prior_value: Option<u32>,
    },
    // Wave 2 — all integer priors (None = the value was absent → rollback removes it).
    Mpo {
        prior_overlay_test_mode: Option<u32>,
    },
    CoreParking {
        prior_ac_pct: Option<u32>,
        prior_dc_pct: Option<u32>,
    },
    TcpAutotuning {
        prior_disabled: bool,
    },
    // Pagefile, option (a): ONLY the validated single-entry layout is ever snapshotted —
    // one ASCII drive letter + two u32 sizes. Exotic/multi-pagefile layouts are REFUSED at
    // apply time, so this snapshot is always reconstructible into a provably
    // metacharacter-free PagingFiles entry (the no-string-into-elevated invariant).
    PagefileManual {
        prior_drive_letter: char,
        prior_initial_mb: u32,
        prior_maximum_mb: u32,
    },
    // Prior scheduled-task state ("Ready" | "Disabled" | "Running" | "Unknown"), so rollback re-enables
    // only a task that was actually enabled before.
    ScheduledTask {
        prior_state: String,
    },
    // Preload-app identity read from the LIVE system at apply time (ground truth, never a const):
    // rollback re-registers by the recorded family name; full name + version keep the receipt honest
    // about exactly what was removed. Apply REFUSES if this read fails (snapshot-or-refuse).
    PreloadApp {
        prior_full_name: String,
        prior_family_name: String,
        prior_version: String,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct NagleInterfaceSnapshot {
    pub(crate) interface: String,
    pub(crate) prior_ack: Option<u32>,
    pub(crate) prior_nodelay: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct EeeNicSnapshot {
    pub(crate) adapter_name: String,
    pub(crate) property_display_name: String,
    pub(crate) prior_value: String,
}

// What an apply_* function produces. Carries the full rollback contract
// independent of the live recommendation catalog.
pub(crate) struct ApplyResult {
    pub(crate) applied_action: AppliedAction,
    pub(crate) rollback_action: RollbackAction,
    pub(crate) snapshot: Snapshot,
    pub(crate) elevation_used: bool,
}

/// A short, human-readable description of the state a rollback restores — derived ONLY from the
/// typed `Snapshot` we actually captured at apply time. Never probes live state, never turns a bare
/// GUID into a name. Returns `None` when no clean label is derivable (legacy/untyped entries, a
/// power plan captured as only a GUID, or multi-target snapshots) → the UI then shows the generic
/// "your previous setting". Read-only enrichment for the Fix surface (spec 2026-06-05-fix-surface §5).
pub(crate) fn restores_label_from_snapshot(snapshot: &serde_json::Value) -> Option<String> {
    let snap: Snapshot = serde_json::from_value(snapshot.clone()).ok()?;
    label_for_snapshot(&snap)
}

fn label_for_snapshot(snap: &Snapshot) -> Option<String> {
    // Registry booleans captured as 0/1.
    let on_off = |v: Option<u32>| match v {
        Some(0) => Some("Off".to_string()),
        Some(1) => Some("On".to_string()),
        _ => None,
    };
    match snap {
        Snapshot::Service {
            prior_state,
            prior_start_mode,
        } => {
            let mode = prior_start_mode.trim();
            let state = prior_state.trim();
            if mode.eq_ignore_ascii_case("Disabled") {
                Some("Disabled".to_string())
            } else if state.eq_ignore_ascii_case("Running") {
                Some("Running".to_string())
            } else if mode.eq_ignore_ascii_case("Auto") || mode.eq_ignore_ascii_case("Automatic") {
                Some("Automatic start".to_string())
            } else if mode.eq_ignore_ascii_case("Manual") {
                Some("Manual start".to_string())
            } else {
                None
            }
        }
        // The "before" for a startup entry, read only from the bytes we actually captured. Byte 0
        // carries the state; an ABSENT prior is not unknown — Windows treats "no approval value"
        // as allowed to start, and that is exactly what rollback restores.
        Snapshot::StartupApproval { prior_bytes, .. } => {
            match prior_bytes.as_ref().and_then(|b| b.first()).copied() {
                Some(0x03) => Some("Off".to_string()),
                Some(_) => Some("On".to_string()),
                None => Some("On".to_string()),
            }
        }
        // Rollback (re-enable) restores the task to its prior state.
        Snapshot::ScheduledTask { prior_state } => match prior_state.trim() {
            "Ready" => Some("Enabled".to_string()),
            "Running" => Some("Running".to_string()),
            "Disabled" => Some("Disabled".to_string()),
            _ => None,
        },
        Snapshot::GameMode { prior_enabled, .. } => on_off(*prior_enabled),
        Snapshot::GameBar { prior_enabled, .. } => on_off(*prior_enabled),
        Snapshot::MouseAccel { prior_speed, .. } => match prior_speed.trim() {
            "1" => Some("On".to_string()),
            "0" => Some("Off".to_string()),
            _ => None,
        },
        // HAGS uses 2 = on, 1 = off (not 0/1).
        Snapshot::HwSchMode { prior } => match prior {
            Some(2) => Some("On".to_string()),
            Some(1) => Some("Off".to_string()),
            _ => None,
        },
        // VisualFXSetting registry semantics: 0 = Windows default, 1 = best appearance,
        // 2 = best performance, 3 = custom.
        Snapshot::VisualEffects {
            vfx_setting_prior, ..
        } => match vfx_setting_prior {
            Some(0) => Some("Windows default".to_string()),
            Some(1) => Some("Best appearance".to_string()),
            Some(2) => Some("Best performance".to_string()),
            Some(3) => Some("Custom".to_string()),
            _ => None,
        },
        Snapshot::FastStartup { prior_hiberboot } => on_off(*prior_hiberboot),
        Snapshot::ReservedStorage { prior_enabled } => {
            Some(if *prior_enabled { "On" } else { "Off" }.to_string())
        }
        // A bare GUID is NOT a name — never dress it up (spec §5). No name captured → generic.
        Snapshot::PowerPlan { .. } => None,
        // Power-plan setting indices and per-NIC vendor properties have no single clean label.
        Snapshot::PowerPlanSetting { .. }
        | Snapshot::NagleNics { .. }
        | Snapshot::EeeNicProperty { .. } => None,
        // Leftovers v2 (dark): the pre-restore value, plainly named for the ledger card.
        Snapshot::MemoryCompression { prior_enabled } => {
            prior_enabled.map(|on| if on { "On" } else { "Off" }.to_string())
        }
        Snapshot::Mmcss {
            prior_system_responsiveness,
            prior_network_throttling,
        } => match (prior_system_responsiveness, prior_network_throttling) {
            (None, None) => Some("Windows defaults (values absent)".to_string()),
            (sr, nti) => Some(format!(
                "SystemResponsiveness {} · NetworkThrottlingIndex {}",
                sr.map_or("absent".to_string(), |v| v.to_string()),
                nti.map_or("absent".to_string(), |v| v.to_string()),
            )),
        },
        Snapshot::PrioritySeparation { prior_value } => {
            prior_value.map(|v| format!("{v} (0x{v:X})"))
        }
        // Wave 2 — the pre-restore (rotted) value, named for the ledger card.
        Snapshot::Mpo { prior_overlay_test_mode } => {
            prior_overlay_test_mode.map(|v| format!("OverlayTestMode {v}"))
        }
        Snapshot::CoreParking { prior_ac_pct, .. } => {
            prior_ac_pct.map(|v| format!("min unparked {v}%"))
        }
        Snapshot::TcpAutotuning { prior_disabled } => {
            Some(if *prior_disabled { "disabled" } else { "normal" }.to_string())
        }
        Snapshot::PagefileManual { prior_drive_letter, prior_initial_mb, prior_maximum_mb } => {
            Some(format!(
                "Fixed {prior_initial_mb}–{prior_maximum_mb} MB on {prior_drive_letter}:"
            ))
        }
        // The prior state IS "installed at this exact version" — say that plainly for the ledger.
        Snapshot::PreloadApp { prior_version, .. } => {
            Some(format!("Installed (v{prior_version})"))
        }
    }
}

// ─── All-or-nothing multi-write applies (issue 617) ───────────────────────
//
// Mutation-gate item 6: a failure part-way through an apply leaves ZERO partial change. Every
// apply/restore here that writes more than one value goes through one of two helpers:
//   * HKCU (no admin): `hkcu_write_all_or_restore` reads each value's exact prior (raw bytes and
//     type, or "absent") before writing anything, writes in order, and on a failed write puts the
//     finished writes back newest first (an absent prior is deleted again).
//   * Elevated PowerShell: `ps_all_or_restore` builds ONE script that, on a failed step, undoes the
//     finished steps newest first inside the same elevation, then rethrows. Native exes (powercfg)
//     do not throw on a non-zero exit, so their steps check `$?` and throw themselves.
// When every undo succeeds the apply returns Err and says nothing was left changed. When an undo
// itself fails, the apply returns Ok with its full apply-time snapshot instead (owner decision F1
// on issue 617, 2026-09-29), so the change is recorded and History's typed rollback can put every
// value back: a partly-changed PC is never left without a receipt. The persisted snapshot and
// rollback contracts are unchanged.
// Residual (all of them): if Compy is killed between two writes, nothing runs the undo and the
// earlier write stays with no receipt — the same window a single-write apply has between its write
// and its receipt. A registry KEY created by the first write is left in place (empty) by an undo.

/// The HKCU value store the multi-write applies go through — the real registry in production, a
/// fake in tests (so no test ever touches the real registry).
pub(crate) trait HkcuValues {
    /// The value's exact prior: Ok(None) when the key or value is absent; Err when it exists but
    /// cannot be read (the apply then refuses before writing anything).
    fn read(&mut self, subkey: &str, name: &str) -> Result<Option<winreg::RegValue>, String>;
    fn write(&mut self, subkey: &str, name: &str, value: &winreg::RegValue) -> Result<(), String>;
    /// Delete the value; an already-absent value is Ok.
    fn delete(&mut self, subkey: &str, name: &str) -> Result<(), String>;
}

pub(crate) struct RealHkcu;

impl HkcuValues for RealHkcu {
    fn read(&mut self, subkey: &str, name: &str) -> Result<Option<winreg::RegValue>, String> {
        let key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey(subkey) {
            Ok(k) => k,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(format!("cannot read {subkey}: {e}")),
        };
        match key.get_raw_value(name) {
            Ok(v) => Ok(Some(v)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(format!("cannot read {name} to snapshot it for undo: {e}")),
        }
    }
    fn write(&mut self, subkey: &str, name: &str, value: &winreg::RegValue) -> Result<(), String> {
        let (key, _) = RegKey::predef(HKEY_CURRENT_USER)
            .create_subkey(subkey)
            .map_err(|e| format!("cannot open {subkey}: {e}"))?;
        key.set_raw_value(name, value)
            .map_err(|e| format!("cannot write {name}: {e}"))
    }
    fn delete(&mut self, subkey: &str, name: &str) -> Result<(), String> {
        let key = match RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(subkey, KEY_SET_VALUE) {
            Ok(k) => k,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()),
            Err(e) => return Err(format!("cannot open {subkey}: {e}")),
        };
        match key.delete_value(name) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(format!("cannot delete {name}: {e}")),
        }
    }
}

/// One HKCU value write for `hkcu_write_all_or_restore`.
pub(crate) struct HkcuWrite {
    pub(crate) subkey: &'static str,
    pub(crate) name: &'static str,
    pub(crate) value: winreg::RegValue,
}

fn reg_dword(v: u32) -> winreg::RegValue {
    use winreg::types::ToRegValue;
    v.to_reg_value()
}

fn reg_sz(v: &str) -> winreg::RegValue {
    use winreg::types::ToRegValue;
    v.to_reg_value()
}

/// A DWORD prior exactly as History will restore it: absent => None; a 4-byte REG_DWORD => its
/// value. Any other type or size is Err, so the apply refuses before any write (issue 617 review):
/// rollback writes a DWORD or deletes, and either would lose a value stored some other way.
fn prior_dword(name: &str, v: &Option<winreg::RegValue>) -> Result<Option<u32>, String> {
    match v {
        None => Ok(None),
        Some(v) if v.vtype == winreg::enums::RegType::REG_DWORD && v.bytes.len() == 4 => {
            Ok(Some(u32::from_le_bytes([v.bytes[0], v.bytes[1], v.bytes[2], v.bytes[3]])))
        }
        Some(v) => Err(format!(
            "{name} is stored as {:?} ({} bytes), not a DWORD, so it cannot be saved for undo",
            v.vtype,
            v.bytes.len()
        )),
    }
}

/// A REG_BINARY prior exactly as History will restore it (rollback writes REG_BINARY or deletes).
fn prior_binary(name: &str, v: &Option<winreg::RegValue>) -> Result<Option<Vec<u8>>, String> {
    match v {
        None => Ok(None),
        Some(v) if v.vtype == winreg::enums::RegType::REG_BINARY => Ok(Some(v.bytes.clone())),
        Some(v) => Err(format!("{name} is stored as {:?}, not binary, so it cannot be saved for undo", v.vtype)),
    }
}

/// A mouse REG_SZ prior as the snapshot stores it: absent => "" (rollback deletes). A present
/// value must be a non-empty REG_SZ: "" would roll back as a delete of a value that existed, and
/// rollback writes REG_SZ, so any other type would come back changed. Either is Err (refuse).
fn prior_mouse_sz(name: &str, v: &Option<winreg::RegValue>) -> Result<String, String> {
    use winreg::types::FromRegValue;
    match v {
        None => Ok(String::new()),
        Some(v) if v.vtype == winreg::enums::RegType::REG_SZ => {
            let s = String::from_reg_value(v)
                .map_err(|e| format!("cannot save {name} for undo: {e}"))?;
            if s.is_empty() {
                Err(format!("{name} is present but empty, so it cannot be saved for undo"))
            } else {
                Ok(s)
            }
        }
        Some(v) => Err(format!("{name} is stored as {:?}, not text, so it cannot be saved for undo", v.vtype)),
    }
}

/// Write every value or none (see the section comment above). The priors are read ONCE, here, and
/// handed to `snapshot`, which builds the undo snapshot from them; if `snapshot` refuses (a prior
/// History could not restore exactly), nothing is written. Err: nothing was left changed and the
/// message says so. Ok: every write landed — or a write failed AND putting an earlier one back also
/// failed, in which case the full snapshot is still returned so History can undo it all (F1).
pub(crate) fn hkcu_write_all_or_restore<T>(
    reg: &mut dyn HkcuValues,
    writes: &[HkcuWrite],
    snapshot: impl FnOnce(&[Option<winreg::RegValue>]) -> Result<T, String>,
) -> Result<T, String> {
    let mut priors = Vec::with_capacity(writes.len());
    for w in writes {
        priors.push(
            reg.read(w.subkey, w.name)
                .map_err(|e| format!("{e}; nothing was changed"))?,
        );
    }
    let snap = snapshot(&priors).map_err(|e| format!("{e}; nothing was changed"))?;
    for (i, w) in writes.iter().enumerate() {
        let Err(e) = reg.write(w.subkey, w.name, &w.value) else {
            continue;
        };
        let mut undo_failed = false;
        for (done, prior) in writes[..i].iter().zip(&priors).rev() {
            let undo = match prior {
                Some(v) => reg.write(done.subkey, done.name, v),
                None => reg.delete(done.subkey, done.name),
            };
            undo_failed |= undo.is_err();
        }
        if undo_failed {
            // F1: keep the receipt so History's rollback can restore every value.
            return Ok(snap);
        }
        return Err(if i == 0 {
            format!("{e}; nothing was changed")
        } else {
            format!("{e}; the {i} setting(s) already changed in this step were put back, so nothing was left changed")
        });
    }
    Ok(snap)
}

/// One step of an elevated multi-step script for `ps_all_or_restore`. `undo` puts this step's
/// write back to the apply-time prior (unused for the last step: nothing runs after it). `native`
/// marks an exe (powercfg) whose non-zero exit must be turned into a throw via `$?`.
pub(crate) struct PsStep {
    pub(crate) write: String,
    pub(crate) undo: String,
    pub(crate) native: bool,
}

/// Build ONE exit-free PowerShell script that runs the steps in order and, if one fails, undoes
/// the finished steps newest first, then rethrows (so a single run exits non-zero and a batch item
/// receipts `fail`). If an undo itself fails it does NOT rethrow: the apply is recorded with its
/// full snapshot (F1, see the section comment). Every flag is reset at the start of the script, so
/// batch items never leak state into each other.
pub(crate) fn ps_all_or_restore(steps: &[PsStep]) -> String {
    let check = |native: bool, what: &str| {
        if native {
            format!("; if (-not $?) {{ throw 'compy: {what} failed' }}")
        } else {
            String::new()
        }
    };
    let mut s = String::from("$compyDone=0; $compyUndoFailed=$false; try { ");
    for (i, st) in steps.iter().enumerate() {
        let n = i + 1;
        s.push_str(&format!(
            "{}{}; $compyDone={n}; ",
            st.write,
            check(st.native, &format!("step {n}"))
        ));
    }
    s.push_str("} catch { $compyErr=$_; ");
    let finished = steps.len().saturating_sub(1);
    for (i, st) in steps[..finished].iter().enumerate().rev() {
        let n = i + 1;
        s.push_str(&format!(
            "if ($compyDone -ge {n}) {{ try {{ {}{} }} catch {{ $compyUndoFailed=$true }} }}; ",
            st.undo,
            check(st.native, &format!("undo {n}"))
        ));
    }
    s.push_str("if (-not $compyUndoFailed) { throw $compyErr } }");
    s
}

// Windows Game Mode lives in a PAIR of HKCU DWORDs under this key. The Settings toggle writes
// BOTH; AllowAutoGameMode is the master the Game Bar service reconciles AutoGameModeEnabled
// against on login, so writing only AutoGameModeEnabled gets reverted to 0 on the next reboot
// (root cause of the "never stays on / re-apply loop" bug — owner export showed 5× applies).
// Detect (lib::game_mode_enabled), apply, and rollback all reference these constants so the read
// and write paths can never silently drift apart.
pub(crate) const GAMEBAR_KEY: &str = "Software\\Microsoft\\GameBar";
pub(crate) const GAME_MODE_ENABLED_VALUE: &str = "AutoGameModeEnabled";
pub(crate) const GAME_MODE_ALLOW_VALUE: &str = "AllowAutoGameMode";

/// Two HKCU writes, all-or-nothing via `hkcu_write_all_or_restore` (issue 617). Kill-mid-apply
/// residual: AllowAutoGameMode may stay 1 with no receipt.
pub(crate) fn apply_game_mode() -> Result<ApplyResult, String> {
    apply_game_mode_with(&mut RealHkcu)
}

fn apply_game_mode_with(reg: &mut dyn HkcuValues) -> Result<ApplyResult, String> {
    // Mirror the Settings UI: set the whole pair so Windows has nothing to reconcile away.
    let snapshot = hkcu_write_all_or_restore(
        reg,
        &[
            HkcuWrite { subkey: GAMEBAR_KEY, name: GAME_MODE_ALLOW_VALUE, value: reg_dword(1) },
            HkcuWrite { subkey: GAMEBAR_KEY, name: GAME_MODE_ENABLED_VALUE, value: reg_dword(1) },
        ],
        |p| {
            Ok(Snapshot::GameMode {
                prior_allow: prior_dword(GAME_MODE_ALLOW_VALUE, &p[0])?,
                prior_enabled: prior_dword(GAME_MODE_ENABLED_VALUE, &p[1])?,
            })
        },
    )?;
    Ok(ApplyResult {
        applied_action: AppliedAction::EnableGameMode,
        rollback_action: RollbackAction::RestoreGameModeFromSnapshot,
        snapshot,
        elevation_used: false,
    })
}

pub(crate) fn rollback_game_mode_typed(
    prior_enabled: Option<u32>,
    prior_allow: Option<u32>,
) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags(GAMEBAR_KEY, KEY_SET_VALUE | KEY_READ)
        .map_err(|e| e.to_string())?;
    // Some(v) => restore the exact prior value; None => the value didn't exist at apply time
    // (or is a pre-fix legacy entry that never captured it) => delete to restore the default.
    let restore = |name: &str, prior: Option<u32>| -> Result<(), String> {
        match prior {
            Some(v) => key.set_value(name, &v).map_err(|e| e.to_string()),
            None => {
                let _ = key.delete_value(name);
                Ok(())
            }
        }
    };
    restore(GAME_MODE_ENABLED_VALUE, prior_enabled)?;
    restore(GAME_MODE_ALLOW_VALUE, prior_allow)?;
    Ok(())
}

// Documented "Best Performance" value for HKCU\Control Panel\Desktop\UserPreferencesMask
const BEST_PERF_USER_PREFS_MASK: [u8; 8] = [0x90, 0x12, 0x03, 0x80, 0x10, 0x00, 0x00, 0x00];

const VFX_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects";
const DESKTOP_KEY: &str = "Control Panel\\Desktop";

/// Two HKCU writes (DWORD + REG_BINARY), all-or-nothing via `hkcu_write_all_or_restore`
/// (issue 617). Kill-mid-apply residual: VisualFXSetting may stay 2 with no receipt.
pub(crate) fn apply_visual_effects() -> Result<ApplyResult, String> {
    apply_visual_effects_with(&mut RealHkcu)
}

fn apply_visual_effects_with(reg: &mut dyn HkcuValues) -> Result<ApplyResult, String> {
    let snapshot = hkcu_write_all_or_restore(
        reg,
        &[
            HkcuWrite { subkey: VFX_KEY, name: "VisualFXSetting", value: reg_dword(2) },
            HkcuWrite {
                subkey: DESKTOP_KEY,
                name: "UserPreferencesMask",
                value: winreg::RegValue {
                    bytes: BEST_PERF_USER_PREFS_MASK.to_vec(),
                    vtype: winreg::enums::RegType::REG_BINARY,
                },
            },
        ],
        |p| {
            Ok(Snapshot::VisualEffects {
                vfx_setting_prior: prior_dword("VisualFXSetting", &p[0])?,
                user_prefs_mask_prior: prior_binary("UserPreferencesMask", &p[1])?,
            })
        },
    )?;

    Ok(ApplyResult {
        applied_action: AppliedAction::SetVisualEffectsBestPerformance,
        rollback_action: RollbackAction::RestoreVisualEffectsFromSnapshot,
        snapshot,
        elevation_used: false,
    })
}

// ─── Admin-elevation helper ──────────────────────────────────────────────
// Triggers a Windows UAC prompt; the elevated child runs `program args...`,
// the calling Compy process stays at standard user. We use this pattern
// rather than running Compy itself elevated, which would force a UAC
// prompt on every launch.

// ─── §4 one-elevation batching: the deferral sink (spec 2026-06-06-beta-feedback-3 §4) ───
// Thread-local on purpose: arming it can only affect the ONE thread that armed it (the batch
// orchestrator's command thread). While armed, `run_elevated_powershell` CAPTURES the command
// instead of elevating. This is safe ONLY because every batchable apply_* performs reads before
// its single elevated call and no mutation after it — deferring therefore causes no partial
// mutation. The rollback path never runs under an armed sink (the orchestrator is the only
// arm-er and it never rolls back).
thread_local! {
    static ELEVATION_SINK: std::cell::RefCell<Option<Vec<String>>> =
        const { std::cell::RefCell::new(None) };
}

// Test-only: forces `run_elevated_powershell` to return the UAC-decline error WITHOUT spawning a
// real elevation prompt, so the orchestrator's elevation-failure (UAC cancel) arm is deterministically
// testable. Never compiled into the shipped binary.
#[cfg(test)]
thread_local! {
    static FORCE_ELEVATION_ERROR: std::cell::RefCell<bool> = const { std::cell::RefCell::new(false) };
}

// Test-only: counts `run_elevated_powershell` invocations that get past the deferral sink on this
// thread — the dispatch-layer stand-in for "how many UAC prompts would the user have seen". The
// T6 gaming-session guard asserts this stays ≤1 across a whole session start. Never shipped.
#[cfg(test)]
thread_local! {
    static ELEVATION_DISPATCH_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

/// Read this thread's would-be-prompt count (test-only; see `ELEVATION_DISPATCH_COUNT`).
#[cfg(test)]
pub(crate) fn elevation_dispatch_count() -> usize {
    ELEVATION_DISPATCH_COUNT.with(|c| c.get())
}

/// Zero this thread's would-be-prompt count at the start of a guard test (test-only).
#[cfg(test)]
pub(crate) fn reset_elevation_dispatch_count() {
    ELEVATION_DISPATCH_COUNT.with(|c| c.set(0));
}

/// RAII guard that makes elevation fail on this thread for the guard's lifetime (test-only).
#[cfg(test)]
pub(crate) struct ForceElevationError;

#[cfg(test)]
impl ForceElevationError {
    pub(crate) fn begin() -> Self {
        FORCE_ELEVATION_ERROR.with(|f| *f.borrow_mut() = true);
        ForceElevationError
    }
}

#[cfg(test)]
impl Drop for ForceElevationError {
    fn drop(&mut self) {
        FORCE_ELEVATION_ERROR.with(|f| *f.borrow_mut() = false);
    }
}

// Test-only: makes `run_elevated_powershell` elevate powershell DIRECTLY (pre-Wave-0 path) instead of
// re-launching `current_exe() --run-elevated`. Under `cargo test`, current_exe() is the TEST binary,
// which has no main.rs `--run-elevated` routing → it exits 101 before the command runs, breaking every
// elevated live-QA harness. This seam lets the live mutation-QA actually run the elevated command on a
// dev rig. `#[cfg(test)]` → never compiled into shipped binaries; the production self-helper is UNCHANGED.
#[cfg(test)]
thread_local! {
    static FORCE_DIRECT_ELEVATION: std::cell::RefCell<bool> = const { std::cell::RefCell::new(false) };
}

/// RAII guard enabling the direct-elevation test seam on this thread for its lifetime (test-only).
#[cfg(test)]
pub(crate) struct ForceDirectElevation;

#[cfg(test)]
impl ForceDirectElevation {
    pub(crate) fn begin() -> Self {
        FORCE_DIRECT_ELEVATION.with(|f| *f.borrow_mut() = true);
        ForceDirectElevation
    }
}

#[cfg(test)]
impl Drop for ForceDirectElevation {
    fn drop(&mut self) {
        FORCE_DIRECT_ELEVATION.with(|f| *f.borrow_mut() = false);
    }
}

/// RAII guard for the deferral sink — the sink is disarmed when this drops (including on panic,
/// so a poisoned command thread can never leak an armed sink into later invocations).
pub(crate) struct ElevationDeferral {
    _private: (),
}

impl ElevationDeferral {
    /// Arm the sink on this thread. Refuses to nest — a batch inside a batch is a logic error.
    pub(crate) fn begin() -> Result<Self, String> {
        ELEVATION_SINK.with(|s| {
            let mut slot = s.borrow_mut();
            if slot.is_some() {
                return Err("an elevation batch is already active on this thread".to_string());
            }
            *slot = Some(Vec::new());
            Ok(ElevationDeferral { _private: () })
        })
    }

    /// How many elevated commands have been captured so far (the orchestrator reads this after
    /// each apply to attribute captured commands to the rec that produced them).
    pub(crate) fn deferred_count(&self) -> usize {
        ELEVATION_SINK.with(|s| s.borrow().as_ref().map(|v| v.len()).unwrap_or(0))
    }

    /// Take every captured command and disarm the sink (consumes the guard).
    pub(crate) fn take_deferred(self) -> Vec<String> {
        ELEVATION_SINK.with(|s| s.borrow_mut().take().unwrap_or_default())
    }
}

impl Drop for ElevationDeferral {
    fn drop(&mut self) {
        ELEVATION_SINK.with(|s| *s.borrow_mut() = None);
    }
}

/// Compose the ONE inline elevated `-Command` for a batch: per rec, `try { <its cmds> ;
/// receipt 'id:ok' } catch { receipt 'id:fail' }` appended to a result FILE — per-item failure
/// isolation inside a single elevation. `$ErrorActionPreference='Stop'` promotes errors to
/// terminating so a failed step lands in `catch` (a per-cmd `-ErrorAction SilentlyContinue`,
/// where an apply deliberately tolerates a step, still overrides — same semantics as today's
/// per-item elevation). Rec ids pass `ps_safe` (allowlist shape) and the result path is
/// single-quote-escaped; the captured commands themselves come from the audited apply_* builders
/// unchanged. No `exit` may appear at this layer — enforced structurally below (an exit-bearing
/// command is refused at compose time; the one exit-using elevated command, power-ultimate, is
/// ALSO rejected by the Fix orchestrator before composition ever sees it).
pub(crate) fn compose_batch_script(
    items: &[(String, Vec<String>)],
    result_path: &str,
) -> Result<String, String> {
    if items.is_empty() {
        return Err("nothing to compose".to_string());
    }
    let mut script = String::from("$ErrorActionPreference='Stop'; ");
    script.push_str(&format!("$rf='{}'; ", result_path.replace('\'', "''")));
    for (rec_id, cmds) in items {
        ps_safe(rec_id)?; // alphanumeric/._- only — safe inside the receipt literals below
        if cmds.is_empty() {
            return Err(format!("rec '{}' deferred no commands", rec_id));
        }
        // Defense-in-depth at the COMPOSE layer (both callers): a PowerShell `exit` would kill
        // the whole elevated process mid-script, silencing every sibling's receipt. Callers
        // already keep exit-using commands out (history.rs hard-rejects power-ultimate; the
        // gaming tier's three applies never exit) — this makes the property structural.
        if cmds.iter().any(|c| contains_exit_token(c)) {
            return Err(format!(
                "rec '{}' uses an exit-style command that cannot ride a batch — apply it individually",
                rec_id
            ));
        }
        let joined = cmds
            .iter()
            .map(|c| c.trim().trim_end_matches(';').trim_end())
            .collect::<Vec<_>>()
            .join("; ");
        script.push_str(&format!(
            "try {{ {joined}; Add-Content -LiteralPath $rf -Value '{rec_id}:ok' }} catch {{ Add-Content -LiteralPath $rf -Value '{rec_id}:fail' }}; "
        ));
    }
    Ok(script)
}

/// PURE: whether a command contains a standalone `exit` token (case-insensitive). Tokenizes on
/// non-identifier characters so `-ExitCode` / `$exitStatus` never false-positive, while `exit`,
/// `exit 1` and `; exit;` all match.
fn contains_exit_token(cmd: &str) -> bool {
    cmd.to_ascii_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '_' && c != '-')
        .any(|tok| tok == "exit")
}

/// Parse the batch result file: one `<rec_id>:ok` / `<rec_id>:fail` line per rec. Unknown or
/// malformed lines are ignored (the orchestrator treats a MISSING receipt as not-applied — the
/// fail-safe direction: we only ever ledger a receipt that explicitly says ok).
pub(crate) fn parse_batch_receipts(text: &str) -> std::collections::HashMap<String, bool> {
    let mut receipts = std::collections::HashMap::new();
    for line in text.lines() {
        if let Some((id, status)) = line.trim().rsplit_once(':') {
            match status {
                "ok" => {
                    receipts.insert(id.to_string(), true);
                }
                "fail" => {
                    receipts.insert(id.to_string(), false);
                }
                _ => {}
            }
        }
    }
    receipts
}

/// The one message allowed to say the user declined. Reused by the test seam so the simulated
/// decline and the real one can never drift apart.
pub(crate) const ELEVATION_DECLINED_MSG: &str =
    "You didn't approve the elevation prompt — nothing was changed.";

/// Quote one argument per the MSVC CommandLineToArgvW rules: bare if it has no space/tab/quote,
/// else wrapped in quotes with `"` escaped as `\"` and backslashes doubled ONLY where they precede
/// a quote (mid-path backslashes stay literal). Pure; unit-tested.
fn quote_arg(arg: &str) -> String {
    if !arg.is_empty() && !arg.contains([' ', '\t', '"']) {
        return arg.to_string();
    }
    let mut out = String::from("\"");
    let mut backslashes = 0usize;
    for c in arg.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                // n backslashes before a quote must become 2n+1 (they all escape, plus one for `"`)
                out.push_str(&"\\".repeat(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            c => {
                out.push_str(&"\\".repeat(backslashes));
                backslashes = 0;
                out.push(c);
            }
        }
    }
    // Trailing backslashes precede the CLOSING quote, so they double too.
    out.push_str(&"\\".repeat(backslashes * 2));
    out.push('"');
    out
}

/// Convert a failed ShellExecuteExW result into an `io::Error` that PRESERVES the win32 error
/// code (the low word of a `HRESULT_FROM_WIN32` HRESULT) — so os error 1223 (ERROR_CANCELLED,
/// the user declining the UAC prompt) survives to `elevation_outcome`'s decline arm. Pure;
/// unit-tested with synthetic HRESULTs. This mapping is the exact thing the `runas` crate
/// dropped (it discarded GetLastError and fabricated an Ok(!0) exit status).
fn shell_launch_error_to_io(e: windows::core::Error) -> std::io::Error {
    let win32 = (e.code().0 as u32 & 0xFFFF) as i32;
    if win32 != 0 {
        std::io::Error::from_raw_os_error(win32)
    } else {
        std::io::Error::other(e.message())
    }
}

/// Launch `file` elevated (ShellExecuteExW, verb "runas", hidden) with `args`, wait for it to
/// exit, and return its REAL exit status — with launch-layer failures surfaced as `io::Error`s
/// that preserve `GetLastError`. A UAC decline is os error 1223 (ERROR_CANCELLED), which is the
/// exact signal `elevation_outcome`'s decline arm keys on.
///
/// This replaces the `runas` crate (1.2.0), whose Windows impl NEVER returns `Err`: its
/// `win_runas` collapses a ShellExecuteExW failure (GetLastError discarded — including 1223), a
/// missing process handle, and a GetExitCodeProcess failure all into an `Ok(!0)` exit status. On
/// the real path that made `elevation_outcome`'s decline arm dead code, so a declined gaming-mode
/// start read as "You approved the elevation, but the operation itself failed (exit code -1)" —
/// a trust-rule violation — and, because a non-launch error may not drop staged contract entries,
/// the conservative KeepStagedAbort branch then dispatched a spurious SECOND (restore) UAC prompt.
/// Found live 2026-07-14 during Gaming Mode QA cases #6/#7 on this rig.
pub(crate) fn elevate_and_wait(
    file: &std::ffi::OsStr,
    args: &[&std::ffi::OsStr],
) -> std::io::Result<std::process::ExitStatus> {
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::process::ExitStatusExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Com::{
        CoInitializeEx, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
    };
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject, INFINITE};
    use windows::Win32::UI::Shell::{
        ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS,
        SHELLEXECUTEINFOW,
    };
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    let mut params = String::new();
    for arg in args {
        if !params.is_empty() {
            params.push(' ');
        }
        params.push_str(&quote_arg(&arg.to_string_lossy()));
    }

    // Wide, NUL-terminated buffers must outlive the ShellExecuteExW call.
    let file_w: Vec<u16> = file.encode_wide().chain(Some(0)).collect();
    let verb_w: Vec<u16> = "runas".encode_utf16().chain(Some(0)).collect();
    let params_w: Vec<u16> = std::ffi::OsStr::new(&params)
        .encode_wide()
        .chain(Some(0))
        .collect();

    unsafe {
        // ShellExecuteExW's documented COM setup. An already-initialized thread returns S_FALSE /
        // RPC_E_CHANGED_MODE and the shell copes either way, so the result is deliberately ignored.
        let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        let mut sei = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            // NOASYNC: resolve synchronously (we're often on a short-lived thread). NOCLOSEPROCESS:
            // hand back hProcess so we can wait for the real exit code. FLAG_NO_UI: never let the
            // shell pop its own error dialog — launch failures come back as GetLastError and are
            // presented through OUR error surfaces (the UAC consent itself is unaffected).
            fMask: SEE_MASK_NOASYNC | SEE_MASK_NOCLOSEPROCESS | SEE_MASK_FLAG_NO_UI,
            lpVerb: PCWSTR(verb_w.as_ptr()),
            lpFile: PCWSTR(file_w.as_ptr()),
            lpParameters: PCWSTR(params_w.as_ptr()),
            // Hidden, like the CREATE_NO_WINDOW direct-spawn path: the elevated launch is recreated
            // by the UAC broker (AppInfo), and a debug-build console app would otherwise flash.
            nShow: SW_HIDE.0,
            ..Default::default()
        };
        if let Err(e) = ShellExecuteExW(&mut sei) {
            // Launch never happened. Preserve the win32 error as a real os error — 1223 here IS
            // the user declining the UAC prompt.
            return Err(shell_launch_error_to_io(e));
        }
        if sei.hProcess.is_invalid() {
            // Launch reported success but no handle came back: the elevated process MAY be
            // running, so this must NOT read as a launch error (launch errors license dropping
            // staged contract entries). Unknown-exit keeps the conservative approved-but-failed
            // attribution and the KeepStagedAbort polarity.
            return Ok(std::process::ExitStatus::from_raw(u32::MAX));
        }
        let _ = WaitForSingleObject(sei.hProcess, INFINITE);
        let mut code: u32 = 0;
        let status = match GetExitCodeProcess(sei.hProcess, &mut code) {
            Ok(()) => std::process::ExitStatus::from_raw(code),
            // Process ran; exit unknowable → same conservative polarity as above.
            Err(_) => std::process::ExitStatus::from_raw(u32::MAX),
        };
        let _ = CloseHandle(sei.hProcess);
        Ok(status)
    }
}

/// Honest attribution for an `elevate_and_wait` outcome (pure — unit-tested with synthetic
/// results). THE TRUST RULE (tester-found, 2026-06-10): the app must NEVER tell a user they
/// cancelled when they didn't. A real UAC decline surfaces from ShellExecuteEx as os error 1223
/// (ERROR_CANCELLED) — a LAUNCH error, not an exit code — and that is the ONLY outcome allowed to
/// mention declining. A non-zero EXIT CODE means the user APPROVED elevation and the elevated
/// command itself failed (the previous code mapped exactly that case to "Did you cancel the UAC
/// prompt?" — backwards, and the decline path never said "cancelled" at all). NOTE 2026-07-14:
/// while the launcher was the `runas` crate, the decline arm here was DEAD on the real path —
/// runas never returns Err on Windows, so every decline arrived as Ok(exit -1) and hit the
/// approved-but-failed arm. `elevate_and_wait` restores the contract this function was built for.
pub(crate) fn elevation_outcome(
    result: std::io::Result<std::process::ExitStatus>,
) -> Result<(), String> {
    const ERROR_CANCELLED: i32 = 1223; // ShellExecuteEx: the user dismissed the UAC prompt
    match result {
        Err(e) if e.raw_os_error() == Some(ERROR_CANCELLED) => Err(ELEVATION_DECLINED_MSG.into()),
        Err(e) => Err(format!("could not launch elevated process: {}", e)),
        Ok(s) if !s.success() => Err(format!(
            "You approved the elevation, but the operation itself failed (exit code {}) — the prompt was fine; the command hit an error.",
            s.code().map(|c| c.to_string()).unwrap_or_else(|| "?".into())
        )),
        Ok(_) => Ok(()),
    }
}

/// Whether a `run_elevated_powershell` error PROVES the elevated process never executed — a
/// launch-level failure (UAC decline, spawn error, or one of the three pre-launch refusals), as
/// opposed to "the process ran and failed". Callers that recorded pending changes BEFORE the
/// elevation (the gaming-session batch) may drop them only when this is true; the polarity is
/// deliberately conservative — an UNRECOGNIZED error returns false, so anything ambiguous keeps
/// its contract entries and gets restored (rollback to a captured prior is a no-op for anything
/// that never actually changed). The recognized strings all originate in THIS file
/// (`elevation_outcome` + the two pre-launch checks) and are pinned by tests that construct them
/// through `elevation_outcome` itself, so they cannot silently drift apart.
pub(crate) fn elevation_error_nothing_ran(err: &str) -> bool {
    err == ELEVATION_DECLINED_MSG
        || err.starts_with("could not launch elevated process")
        || err.starts_with("cannot find own exe")
        || err.starts_with("elevated command is too long to dispatch")
        || err.starts_with("elevated dispatch ticket could not be minted")
}

/// Promote non-terminating cmdlet errors to terminating ones for a SINGLE elevated command, so a
/// cmdlet that "fails" without throwing (e.g. `Set-WindowsReservedStorageState` mid state-transition,
/// or a policy/pending-reboot block) cannot exit 0 and record a mutation that never happened as a
/// successful, rollback-eligible apply — a false ledger entry. Idempotent: a command that already
/// sets `$ErrorActionPreference` (some apply builders embed it in a multi-statement script) is
/// returned unchanged, so we never prepend a second, conflicting directive. Mirrors the §4 batch
/// path's guard in `compose_batch_script`.
fn with_error_action_stop(command: &str) -> std::borrow::Cow<'_, str> {
    if command.trim_start().starts_with("$ErrorActionPreference") {
        std::borrow::Cow::Borrowed(command)
    } else {
        std::borrow::Cow::Owned(format!("$ErrorActionPreference='Stop'; {command}"))
    }
}

pub(crate) fn run_elevated_powershell(command: &str) -> Result<(), String> {
    // §4 batching: an armed sink on THIS thread captures instead of elevating (see above).
    let deferred = ELEVATION_SINK.with(|s| {
        if let Some(sink) = s.borrow_mut().as_mut() {
            sink.push(command.to_string());
            true
        } else {
            false
        }
    });
    if deferred {
        return Ok(());
    }
    // A single (non-batched) elevated command must promote non-terminating cmdlet errors to
    // terminating ones. Otherwise a cmdlet that "fails" without throwing (e.g.
    // Set-WindowsReservedStorageState mid state-transition, or a policy/pending-reboot block) still
    // exits 0, run_elevated_powershell returns Ok, and we'd record a mutation that never happened as
    // a successful, rollback-eligible apply — a false ledger entry. The §4 batch path already does
    // this in compose_batch_script; this is the same guard for the single-command path. Skip if the
    // caller already set it (some apply builders embed it in a multi-statement script).
    let owned = with_error_action_stop(command);
    let command: &str = &owned;
    // Test-only: count every invocation that gets PAST the sink — i.e. every call that would show
    // a UAC prompt in production (the decline/direct seams below still count: they stand in for a
    // real dispatch; the two pre-launch refusals further down count too — over-counting only makes
    // the ≤1 guard stricter). This is the dispatch-layer evidence for the "≤1 elevation per
    // gaming-session start" guard; a sink-captured call above is deliberately NOT counted.
    #[cfg(test)]
    ELEVATION_DISPATCH_COUNT.with(|c| c.set(c.get() + 1));
    // Test-only seam: deterministically simulate a UAC DECLINE without a real elevation (which would
    // pop a real Secure-Desktop prompt). Returns the same constant as a real decline so the
    // simulated and real paths can't drift. `#[cfg(test)]` removes it from the shipped binary.
    #[cfg(test)]
    if FORCE_ELEVATION_ERROR.with(|f| *f.borrow()) {
        return Err(ELEVATION_DECLINED_MSG.to_string());
    }
    // Test-only: elevate powershell DIRECTLY so live-QA elevated commands actually run under `cargo test`
    // (the Wave-0 self-helper below re-launches the test binary → exit 101). #[cfg(test)] → never shipped.
    #[cfg(test)]
    if FORCE_DIRECT_ELEVATION.with(|f| *f.borrow()) {
        // Write the command to a temp .ps1 and run it elevated via -File — sidesteps Windows
        // command-line quoting for commands with spaces / quotes / backslashes (e.g. scheduled-task
        // paths) that -Command mangles. Test-only; cleaned up after. (Production hex-encodes instead.)
        let tmp = std::env::temp_dir().join(format!("compy-qa-{}.ps1", std::process::id()));
        std::fs::write(&tmp, command).map_err(|e| format!("qa seam: temp write failed: {e}"))?;
        let out = elevation_outcome(elevate_and_wait(
            std::ffi::OsStr::new("powershell"),
            &[
                std::ffi::OsStr::new("-NoProfile"),
                std::ffi::OsStr::new("-ExecutionPolicy"),
                std::ffi::OsStr::new("Bypass"),
                std::ffi::OsStr::new("-File"),
                tmp.as_os_str(),
            ],
        ));
        let _ = std::fs::remove_file(&tmp);
        return out;
    }
    // Wave 0 — silence the elevated console: route the command through a WINDOWLESS compy.exe
    // self-helper instead of elevating powershell.exe directly. An elevated launch is recreated by
    // the UAC broker (AppInfo) with its OWN window settings, so SW_HIDE can't stop a console-subsystem
    // app (powershell.exe) from briefly flashing a console. compy.exe is windows-subsystem in release
    // (no console EVER) and runs powershell via quiet_command (CREATE_NO_WINDOW) — so no console
    // exists to flash. The helper exits with powershell's exit code, so elevation_outcome's attribution
    // is preserved EXACTLY: a real UAC decline is still a LAUNCH error 1223 (the user dismissing the
    // compy.exe prompt), a non-zero exit is still "approved but the operation failed", 0 is success.
    // The command is hex-encoded into ONE argv (no temp file → no TOCTOU / cleanup); it was already
    // validated by validate_command before reaching here. UAC consent stays OS-controlled + visible
    // (the prompt now names compy.exe — consistent with how the FPS helper already elevates).
    let exe = std::env::current_exe().map_err(|e| format!("cannot find own exe: {e}"))?;
    let encoded = to_hex(command.as_bytes());
    // The frozen catalog never approaches this, but never silently truncate a command line (Windows
    // caps it ~32k chars) — fail loud instead.
    if encoded.len() > 30_000 {
        return Err("elevated command is too long to dispatch".to_string());
    }
    // Boundary-side second lock: mint the one-time dispatch ticket the helper will demand (see
    // mint_elevation_ticket). Mint failure is a third pre-launch refusal — nothing ran.
    let ticket = mint_elevation_ticket(&encoded)?;
    let outcome = elevation_outcome(elevate_and_wait(
        exe.as_os_str(),
        &[
            std::ffi::OsStr::new("--run-elevated"),
            std::ffi::OsStr::new(&encoded),
            ticket.as_os_str(),
        ],
    ));
    // The helper consumes the ticket on the success path; a UAC decline / launch failure leaves
    // it behind — clean up either way (best-effort, idempotent).
    let _ = std::fs::remove_file(&ticket);
    outcome
}

/// Hex-encode bytes so an elevated command can ride as a single, quoting-safe argv to the
/// `--run-elevated` helper (Wave 0). Pure; round-trips with `from_hex`. Lowercase, fixed 2 chars/byte.
pub(crate) fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(char::from_digit((b >> 4) as u32, 16).unwrap_or('0'));
        s.push(char::from_digit((b & 0x0f) as u32, 16).unwrap_or('0'));
    }
    s
}

/// Decode `to_hex`. Returns None on odd length or any non-hex digit — the helper then fails safe
/// (exits non-zero → "approved, but the operation failed"), never running garbage.
pub(crate) fn from_hex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) {
        return None;
    }
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(s.len() / 2);
    let mut i = 0;
    while i < b.len() {
        let hi = (b[i] as char).to_digit(16)?;
        let lo = (b[i + 1] as char).to_digit(16)?;
        out.push(((hi << 4) | lo) as u8);
        i += 2;
    }
    Some(out)
}

// ─── Elevated-dispatch ticket — the boundary-side second lock (2026-07-15) ──────────────────────
//
// The `--run-elevated` helper entry used to run whatever hex it was handed; ALL validation lived
// caller-side (typed dispatch + ps_safe in this file). Not a live hole — the entry grants no
// privilege by itself (an external caller runs at its own IL behind its own UAC prompt) — but a
// future confused-deputy bug could hand it attacker-influenced hex. The ticket is the second lock
// AT the boundary: `run_elevated_powershell` (the ONLY dispatch point, where every command has
// already passed validation) mints a one-time file whose content is the EXACT hex it is about to
// dispatch; the helper refuses any hex that doesn't byte-match its ticket and consumes the ticket
// before running, so a given dispatch executes at most once. Because the check is content-agnostic
// exact-equality with what the parent just minted, it can never false-reject a legitimate apply —
// every apply builder's output passes by construction, present and future.

/// Mint the one-time dispatch ticket for one `--run-elevated` launch. Returns the ticket path to
/// pass as the helper's second argument. A mint failure is a PRE-LAUNCH refusal (nothing ran) —
/// the error string is classified by `elevation_error_nothing_ran`.
pub(crate) fn mint_elevation_ticket(encoded: &str) -> Result<std::path::PathBuf, String> {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let dir = crate::compy_data_dir().join("runtime");
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("elevated dispatch ticket could not be minted: {e}"))?;
    // pid + per-process sequence keeps concurrent dispatches (and processes) from colliding.
    let path = dir.join(format!(
        "elev-{}-{}.ticket",
        std::process::id(),
        SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::write(&path, encoded)
        .map_err(|e| format!("elevated dispatch ticket could not be minted: {e}"))?;
    Ok(path)
}

/// Helper-side verify-and-consume. True ⇒ the ticket file byte-equals the received hex; it is
/// deleted (consume-once) before the command runs. A deletion failure does not reject — the match
/// already proved the mint; exact-match is the lock, one-time-ness is best-effort on top. Any read
/// failure or mismatch ⇒ false, and the helper runs NOTHING. The ticket path arrives via argv
/// (rather than being re-derived helper-side) so a machine where UAC elevates as a different
/// account — where %APPDATA% resolves differently in the child — can never false-reject.
pub(crate) fn consume_elevation_ticket(encoded: &str, ticket_path: &str) -> bool {
    match std::fs::read(ticket_path) {
        Ok(content) if content == encoded.as_bytes() => {
            let _ = std::fs::remove_file(ticket_path);
            true
        }
        _ => false,
    }
}

/// Defense-in-depth against elevated-command injection. Any value interpolated into a
/// `run_elevated_powershell` command string must pass this first. Today every such token comes from
/// the curated catalog (Windows service names, power-plan/subgroup/setting GUIDs, fixed state words)
/// and is inherently safe; this guarantees it stays safe even if a future caller routes external or
/// dynamic input (e.g. signed remote rules) through the same path. The whitelist
/// (`[A-Za-z0-9_.-]`) admits every legitimate token and rejects every shell metacharacter
/// (`; | & $ \` ( ) { } < > " '` space, newline, …) that could break out of the intended command.
pub(crate) fn ps_safe(token: &str) -> Result<(), String> {
    if !token.is_empty()
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
    {
        Ok(())
    } else {
        Err(format!(
            "refusing to build an elevated command with an unsafe token: {token:?}"
        ))
    }
}

/// Like `ps_safe`, but for tokens placed INSIDE a SINGLE-QUOTED PowerShell literal (`'...'`) —
/// scheduled-task names/paths legitimately contain spaces and backslashes. Admits `[A-Za-z0-9_.-]`
/// PLUS space and backslash, and FORBIDS the single quote itself (so the token can't terminate its
/// own quoting → no breakout) and every expansion/metacharacter (`"` `$` `` ` `` `;` `|` `&` `<` `>`
/// `(` `)` `{` `}` `*` `?` `/` newline …). MUST only ever be interpolated inside `'...'`. Today's
/// only callers pass FIXED, compile-time `KnownBloatTask` constants — never user/remote input.
pub(crate) fn ps_safe_squoted(token: &str) -> Result<(), String> {
    if !token.is_empty()
        && token
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-' | ' ' | '\\'))
    {
        Ok(())
    } else {
        Err(format!(
            "refusing to build an elevated command with an unsafe single-quoted token: {token:?}"
        ))
    }
}

/// Validates a network-interface registry subkey name — the GUID-shaped adapter key under
/// `...\Tcpip\Parameters\Interfaces\` — BEFORE it is interpolated into a single-quoted PowerShell
/// `-Path '...'` literal. Real interface keys are braced GUIDs (e.g. `{2a737441-1930-...}`), so the
/// admitted set is `[A-Za-z0-9-{}]`: it accepts every legitimate key and rejects the single quote
/// (no literal breakout) plus every other metacharacter. The Nagle snapshot's `interface` is read
/// back from the persisted, user-writable history.json, so this is the guard that stops a tampered
/// ledger entry from injecting elevated PowerShell at rollback time. (`ps_safe_squoted` can't be
/// reused here — it forbids the braces a GUID key legitimately contains.)
pub(crate) fn nic_interface_safe(name: &str) -> Result<(), String> {
    if !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '{' | '}'))
    {
        Ok(())
    } else {
        Err(format!(
            "refusing to build an elevated command with an unsafe interface key: {name:?}"
        ))
    }
}

#[cfg(test)]
mod ps_injection_tests {
    use super::{
        nic_interface_safe, ps_safe, rollback_nagle_disable_typed, rollback_power_plan_setting_typed,
        NagleInterfaceSnapshot,
    };

    #[test]
    fn accepts_every_real_catalog_token() {
        // Service names, the fixed state/startup words, and power-plan GUIDs — every token we
        // actually interpolate into an elevated command.
        for t in [
            "SysMain",
            "DiagTrack",
            "Automatic",
            "Manual",
            "Disabled",
            "Enabled",
            "2a737441-1930-4402-8d77-b2bebba308a3",
            "48e6b7a6-50f5-4782-a5d4-53bb8f07e226",
        ] {
            assert!(ps_safe(t).is_ok(), "should accept legitimate token {t:?}");
        }
    }

    #[test]
    fn rejects_injection_attempts() {
        for t in [
            "",
            "Svc; Stop-Computer",
            "a && shutdown /s /t 0",
            "$(Remove-Item C:\\)",
            "a`whoami`",
            "a | Out-File x",
            "a\nStart-Process calc",
            "Name -Force; calc",
            "\"quoted\"",
            "has space",
        ] {
            assert!(ps_safe(t).is_err(), "should reject unsafe token {t:?}");
        }
    }

    #[test]
    fn nic_interface_safe_accepts_braced_guid() {
        // Real Tcpip\Parameters\Interfaces subkeys are braced GUIDs — the exact shape we must admit
        // (ps_safe_squoted can't be reused for these because it forbids the braces).
        for t in [
            "{2a737441-1930-4402-8d77-b2bebba308a3}",
            "{48E6B7A6-50F5-4782-A5D4-53BB8F07E226}",
            "2a737441-1930-4402-8d77-b2bebba308a3", // also accept the unbraced form
        ] {
            assert!(nic_interface_safe(t).is_ok(), "should accept NIC key {t:?}");
        }
    }

    #[test]
    fn nic_interface_safe_rejects_injection() {
        for t in [
            "",
            "'; Stop-Computer; '",
            "{guid}' -Force; calc; '",
            "a`whoami`",
            "$(Remove-Item C:\\)",
            "has space",
            "a\nStart-Process calc",
        ] {
            assert!(nic_interface_safe(t).is_err(), "should reject NIC key {t:?}");
        }
    }

    #[test]
    fn rollback_power_plan_setting_rejects_injected_guid() {
        // A tampered ledger snapshot must fail loud BEFORE the GUID reaches the elevated powercfg
        // command line — the guard runs ahead of any system probe or elevation.
        let injected = "12345678-90ab-cdef-1234-567890abcdef; Stop-Computer";
        let good = "12345678-90ab-cdef-1234-567890abcdef";
        assert!(rollback_power_plan_setting_typed(injected, good, good, 0, 0).is_err());
        assert!(rollback_power_plan_setting_typed(good, injected, good, 0, 0).is_err());
        assert!(rollback_power_plan_setting_typed(good, good, injected, 0, 0).is_err());
    }

    #[test]
    fn rollback_nagle_disable_rejects_injected_interface() {
        // interface is read back from the user-writable history.json; an injected value must fail
        // before it can be interpolated into an elevated -Path literal.
        let snap = [NagleInterfaceSnapshot {
            interface: "{guid}' -Name X -Value 1; Stop-Computer; '".to_string(),
            prior_ack: Some(0),
            prior_nodelay: None,
        }];
        assert!(rollback_nagle_disable_typed(&snap).is_err());
    }
}

#[cfg(test)]
mod batch_elevation_tests {
    use super::{
        compose_batch_script, from_hex, parse_batch_receipts, run_elevated_powershell, to_hex,
        ElevationDeferral,
    };

    #[test]
    fn hex_round_trips_and_rejects_malformed() {
        // Round-trips arbitrary command bytes (spaces, quotes, $, newlines, unicode) so the
        // --run-elevated argv survives intact regardless of the command's contents.
        for s in [
            "",
            "powercfg /setactive 12345678-90ab-cdef-1234-567890abcdef",
            "try { Set-ItemProperty 'X' -Value 0 } catch { 'fail' }; $x = \"q\"\n\t end",
            "üñîçødé ⚡",
        ] {
            let enc = to_hex(s.as_bytes());
            assert!(enc.len().is_multiple_of(2) && enc.chars().all(|c| c.is_ascii_hexdigit()));
            assert_eq!(from_hex(&enc).as_deref(), Some(s.as_bytes()));
        }
        // Malformed encodings fail safe (None) — never panic, never half-decode.
        assert_eq!(from_hex("abc"), None); // odd length
        assert_eq!(from_hex("zz"), None); // non-hex digit
        assert_eq!(from_hex("6x"), None); // one bad nibble
    }

    // ── the `--run-elevated` boundary-side second lock (dispatch ticket) ────────────────

    #[test]
    fn boundary_rejects_foreign_hex_both_ways() {
        use super::{consume_elevation_ticket, mint_elevation_ticket};
        let foreign = to_hex(b"Stop-Computer");
        // No ticket at all — an external / confused-deputy caller handing the helper its own hex.
        assert!(!consume_elevation_ticket(&foreign, r"C:\__compy_qa_missing__\no.ticket"));
        // A REAL ticket exists, but for a DIFFERENT command — swapped hex is rejected too, and
        // the failed probe must NOT burn the ticket (the legitimate dispatch still verifies).
        let legit = to_hex(b"exit 0");
        let ticket = mint_elevation_ticket(&legit).expect("mint");
        let ticket_s = ticket.to_string_lossy().to_string();
        assert!(!consume_elevation_ticket(&foreign, &ticket_s));
        assert!(ticket.exists(), "a rejected probe must not consume the legit ticket");
        assert!(consume_elevation_ticket(&legit, &ticket_s));
        assert!(!ticket.exists(), "a verified dispatch consumes its ticket");
    }

    #[test]
    fn boundary_accepts_every_dispatch_shape_and_consumes_once() {
        use super::{consume_elevation_ticket, mint_elevation_ticket};
        // The lock is exact-equality with what run_elevated_powershell just minted, so every
        // apply builder's output passes BY CONSTRUCTION — no shape grammar to false-reject.
        // Pinned with the gnarliest real payload (a composed §4 batch script: quote-escaped
        // paths, receipts, multi-command items) plus the hex round-trip torture set.
        let items = vec![
            ("fast-startup-off".to_string(), vec!["cmdA1; ".to_string()]),
            ("hags-enable".to_string(), vec!["cmdB1".to_string(), "cmdB2;".to_string()]),
        ];
        let batch =
            compose_batch_script(&items, r"C:\Users\o'brien\receipts.txt").expect("compose");
        for cmd in [
            batch.as_str(),
            "powercfg /setactive 12345678-90ab-cdef-1234-567890abcdef",
            "try { Set-ItemProperty 'X' -Value 0 } catch { 'fail' }; $x = \"q\"\n\t end",
            "üñîçødé ⚡",
        ] {
            let encoded = to_hex(cmd.as_bytes());
            let ticket = mint_elevation_ticket(&encoded).expect("mint");
            let ticket_s = ticket.to_string_lossy().to_string();
            assert!(consume_elevation_ticket(&encoded, &ticket_s), "must pass: {cmd:.60}");
            // Consume-once: the same hex cannot ride the same ticket twice.
            assert!(!consume_elevation_ticket(&encoded, &ticket_s));
            assert!(!ticket.exists());
        }
    }

    #[test]
    fn sink_captures_instead_of_elevating_and_disarms_on_take() {
        let guard = ElevationDeferral::begin().expect("arm");
        // With the sink armed this CAPTURES — it must not launch anything (no UAC in tests).
        run_elevated_powershell("Get-Date | Out-Null").expect("captured, not run");
        run_elevated_powershell("Get-Item X").expect("captured, not run");
        assert_eq!(guard.deferred_count(), 2);
        let cmds = guard.take_deferred();
        assert_eq!(cmds, vec!["Get-Date | Out-Null".to_string(), "Get-Item X".to_string()]);
        // Disarmed after take: a fresh guard arms cleanly (would Err if a sink leaked).
        let fresh = ElevationDeferral::begin().expect("sink must be disarmed after take");
        assert_eq!(fresh.deferred_count(), 0);
    }

    #[test]
    fn sink_disarms_on_drop_and_refuses_to_nest() {
        {
            let _guard = ElevationDeferral::begin().expect("arm");
            assert!(ElevationDeferral::begin().is_err(), "nesting must be refused");
        }
        // Dropped (not taken) → still disarmed.
        let fresh = ElevationDeferral::begin().expect("sink must be disarmed after drop");
        drop(fresh);
    }

    #[test]
    fn compose_builds_per_rec_try_catch_with_receipts() {
        let items = vec![
            ("fast-startup-off".to_string(), vec!["cmdA1; ".to_string()]),
            ("hags-enable".to_string(), vec!["cmdB1".to_string(), "cmdB2;".to_string()]),
        ];
        let s = compose_batch_script(&items, r"C:\Users\o'brien\receipts.txt").expect("compose");
        assert!(s.starts_with("$ErrorActionPreference='Stop'; "), "errors must terminate into catch");
        assert!(s.contains(r"$rf='C:\Users\o''brien\receipts.txt'"), "path single-quote-escaped");
        assert!(s.contains("try { cmdA1; Add-Content -LiteralPath $rf -Value 'fast-startup-off:ok' }"));
        assert!(s.contains("catch { Add-Content -LiteralPath $rf -Value 'fast-startup-off:fail' }"));
        assert!(s.contains("try { cmdB1; cmdB2; Add-Content -LiteralPath $rf -Value 'hags-enable:ok' }"));
        assert!(!s.contains("exit"), "no exit may ever appear in a composed batch");
    }

    #[test]
    fn compose_rejects_unsafe_ids_and_empty_input() {
        // A rec id is embedded in receipt literals — anything outside the ps_safe allowlist is refused.
        let bad = vec![("a'; calc; '".to_string(), vec!["x".to_string()])];
        assert!(compose_batch_script(&bad, "rf").is_err());
        assert!(compose_batch_script(&[], "rf").is_err());
        let empty_cmds = vec![("fast-startup-off".to_string(), Vec::new())];
        assert!(compose_batch_script(&empty_cmds, "rf").is_err());
    }

    #[test]
    fn compose_structurally_refuses_exit_bearing_commands() {
        // A PowerShell `exit` would kill the elevated process mid-script and silence every
        // sibling's receipt — refused at COMPOSE time (defense-in-depth for both batch callers).
        for cmd in ["exit", "exit 1", "powercfg /x; exit", "cmdA; Exit; cmdB"] {
            let items = vec![("power-x".to_string(), vec![cmd.to_string()])];
            let err = compose_batch_script(&items, "rf").expect_err("exit must be refused");
            assert!(err.contains("cannot ride a batch"), "got: {err}");
        }
        // Identifier lookalikes are NOT exits — never false-positive on legitimate tokens.
        for cmd in ["cmd -ExitCode 0", "$exitStatus = 1", "Write-Output exit-lane"] {
            let items = vec![("power-x".to_string(), vec![cmd.to_string()])];
            assert!(compose_batch_script(&items, "rf").is_ok(), "false positive on: {cmd}");
        }
    }

    #[test]
    fn parse_receipts_maps_ok_fail_and_ignores_garbage() {
        let r = parse_batch_receipts("fast-startup-off:ok\nhags-enable:fail\n\nnot a receipt\nx:maybe\n");
        assert_eq!(r.get("fast-startup-off"), Some(&true));
        assert_eq!(r.get("hags-enable"), Some(&false));
        assert_eq!(r.len(), 2);
    }

    /// THE failure-isolation regression at the PowerShell level, proven against a REAL
    /// (non-elevated) powershell.exe: one rec's command fails → its receipt says fail, every
    /// other rec still runs and receipts ok. This is exactly the script the elevated batch runs —
    /// elevation changes the token, not the semantics.
    #[test]
    fn real_powershell_batch_isolates_a_failing_item() {
        let dir = std::env::temp_dir().join(format!("compy-batch-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let rf = dir.join("receipts.txt");
        let _ = std::fs::remove_file(&rf);
        let items = vec![
            ("alpha-ok".to_string(), vec!["Get-Date | Out-Null".to_string()]),
            (
                "bravo-fail".to_string(),
                vec![r"Get-Item -LiteralPath 'C:\__compy_no_such_path__\x' | Out-Null".to_string()],
            ),
            ("charlie-ok".to_string(), vec!["$null = 1".to_string()]),
        ];
        let script = compose_batch_script(&items, rf.to_string_lossy().as_ref()).expect("compose");
        let status = super::quiet_command("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .status()
            .expect("powershell runs");
        assert!(status.success(), "the batch script itself must exit 0 (failures are caught per item)");
        let text = std::fs::read_to_string(&rf).expect("receipt file written");
        let receipts = parse_batch_receipts(&text);
        assert_eq!(receipts.get("alpha-ok"), Some(&true));
        assert_eq!(receipts.get("bravo-fail"), Some(&false), "the failing item must receipt fail");
        assert_eq!(receipts.get("charlie-ok"), Some(&true), "items after a failure still run");
        let _ = std::fs::remove_file(&rf);
        let _ = std::fs::remove_dir(&dir);
    }
}

#[cfg(test)]
mod elevation_attribution_tests {
    use super::{elevation_outcome, ELEVATION_DECLINED_MSG};
    use std::os::windows::process::ExitStatusExt;
    use std::process::ExitStatus;

    // THE TRUST RULE (tester-found): never tell a user they cancelled when they didn't.

    #[test]
    fn a_real_uac_decline_is_the_only_outcome_that_says_declined() {
        // ShellExecuteEx decline = launch error ERROR_CANCELLED (1223).
        let err = elevation_outcome(Err(std::io::Error::from_raw_os_error(1223)))
            .expect_err("decline is an error");
        assert_eq!(err, ELEVATION_DECLINED_MSG);
        assert!(err.contains("didn't approve"));
    }

    #[test]
    fn an_approved_elevation_whose_command_fails_never_mentions_cancelling() {
        // Non-zero EXIT CODE = the user approved, the elevated command itself failed — the exact
        // case the old message blamed on the user ("Did you cancel the UAC prompt?").
        let err = elevation_outcome(Ok(ExitStatus::from_raw(1))).expect_err("failure is an error");
        assert!(err.contains("You approved the elevation"), "got: {err}");
        assert!(err.contains("exit code 1"), "got: {err}");
        let lower = err.to_lowercase();
        assert!(!lower.contains("cancel"), "must never blame the user: {err}");
        assert!(!lower.contains("didn't approve"), "must never blame the user: {err}");
    }

    #[test]
    fn success_and_other_launch_failures_map_honestly() {
        assert!(elevation_outcome(Ok(ExitStatus::from_raw(0))).is_ok());
        let err = elevation_outcome(Err(std::io::Error::from_raw_os_error(2)))
            .expect_err("launch failure is an error");
        assert!(err.contains("could not launch elevated process"), "got: {err}");
        assert!(!err.to_lowercase().contains("cancel"), "got: {err}");
    }

    // ── `elevation_error_nothing_ran` — the T6 batch's drop-staged license ──────────────
    // Every "true" case is constructed THROUGH `elevation_outcome` (or is the literal pre-launch
    // refusal string from `run_elevated_powershell`), so classifier and producer cannot drift.

    #[test]
    fn launch_level_failures_classify_as_nothing_ran() {
        use super::elevation_error_nothing_ran;
        // A UAC decline is a LAUNCH error — the elevated process never existed.
        let decline = elevation_outcome(Err(std::io::Error::from_raw_os_error(1223))).unwrap_err();
        assert!(elevation_error_nothing_ran(&decline));
        // Any other spawn failure: also never executed.
        let spawn = elevation_outcome(Err(std::io::Error::from_raw_os_error(2))).unwrap_err();
        assert!(elevation_error_nothing_ran(&spawn));
        // The three pre-launch refusals in run_elevated_powershell (checked before any spawn).
        assert!(elevation_error_nothing_ran("cannot find own exe: os error 2"));
        assert!(elevation_error_nothing_ran("elevated command is too long to dispatch"));
        assert!(elevation_error_nothing_ran(
            "elevated dispatch ticket could not be minted: os error 5"
        ));
    }

    #[test]
    fn ran_and_failed_or_unknown_errors_conservatively_classify_as_may_have_run() {
        use super::elevation_error_nothing_ran;
        // Non-zero exit = the process RAN — staged contract entries must be kept + restored.
        let ran = elevation_outcome(Ok(ExitStatus::from_raw(1))).unwrap_err();
        assert!(!elevation_error_nothing_ran(&ran));
        // Unrecognized error text: fail-safe direction is "assume it may have run".
        assert!(!elevation_error_nothing_ran("some future error nobody classified"));
        assert!(!elevation_error_nothing_ran(""));
    }

    // ── `elevate_and_wait` — the launcher must PROPAGATE launch-layer os errors ─────────
    // bug→guard (2026-07-14, live QA #6/#7): the `runas` crate it replaced never returned Err on
    // Windows — a UAC decline (GetLastError 1223) collapsed to Ok(exit -1), which read as "You
    // approved the elevation, but the operation itself failed" (backwards blame, trust-rule
    // violation) and, via the conservative KeepStagedAbort branch, fired a spurious second
    // (restore) UAC prompt after every declined gaming-mode start.

    #[test]
    fn shell_launch_error_mapping_preserves_the_win32_code() {
        use super::shell_launch_error_to_io;
        use windows::core::HRESULT;
        // THE decline: HRESULT_FROM_WIN32(ERROR_CANCELLED=1223) = 0x800704C7. The exact code
        // runas discarded — it must arrive as a raw os error so the decline arm fires.
        let decline = shell_launch_error_to_io(HRESULT(0x800704C7u32 as i32).into());
        assert_eq!(decline.raw_os_error(), Some(1223), "got: {decline}");
        let msg = elevation_outcome(Err(decline)).unwrap_err();
        assert_eq!(msg, ELEVATION_DECLINED_MSG);
        // Any other launch failure (e.g. ERROR_FILE_NOT_FOUND=2): a real os error too, classified
        // as could-not-launch → nothing-ran (staged entries may drop), never approved-but-failed.
        let notfound = shell_launch_error_to_io(HRESULT(0x80070002u32 as i32).into());
        assert_eq!(notfound.raw_os_error(), Some(2), "got: {notfound}");
        let msg = elevation_outcome(Err(notfound)).unwrap_err();
        assert!(msg.starts_with("could not launch elevated process"), "got: {msg}");
        assert!(super::elevation_error_nothing_ran(&msg));
    }

    #[test]
    fn elevate_and_wait_surfaces_a_failed_launch_as_err_never_a_fabricated_exit() {
        // End-to-end FFI check, CI-safe: a nonexistent target fails at/below ShellExecuteExW with
        // NO consent UI (and SEE_MASK_FLAG_NO_UI forbids shell error dialogs). The SPECIFIC code
        // varies by environment (2 file-not-found; 1223 when a sandbox forbids the elevation
        // broker) — the pinned property is the one runas broke: a launch failure is a REAL
        // io::Error that downstream classifies as launch-level, never Ok(-1)/approved-but-failed.
        let err = super::elevate_and_wait(
            std::ffi::OsStr::new(r"C:\__compy_qa_missing__\definitely-not-here.exe"),
            &[],
        )
        .expect_err("a nonexistent exe must surface as a LAUNCH error, not Ok(-1)");
        assert!(err.raw_os_error().is_some(), "got: {err}");
        let msg = elevation_outcome(Err(err)).unwrap_err();
        assert!(
            !msg.contains("You approved the elevation"),
            "launch failure must never read as approved-but-failed: {msg}"
        );
        assert!(super::elevation_error_nothing_ran(&msg), "got: {msg}");
    }

    #[test]
    fn quote_arg_follows_windows_argv_rules() {
        use super::quote_arg;
        assert_eq!(quote_arg("plain"), "plain");
        assert_eq!(quote_arg(""), "\"\"");
        assert_eq!(quote_arg("has space"), "\"has space\"");
        // Mid-path backslashes stay literal inside quotes (the crate we replaced doubled them,
        // which would have broken any path containing a space).
        assert_eq!(
            quote_arg(r"C:\Users\John Smith\fps.json"),
            r#""C:\Users\John Smith\fps.json""#
        );
        // Embedded quotes escape; backslashes immediately before them double.
        assert_eq!(quote_arg(r#"say "hi""#), r#""say \"hi\"""#);
        assert_eq!(quote_arg(r#"a\"b c"#), r#""a\\\"b c""#);
        // Trailing backslashes double before the closing quote.
        assert_eq!(quote_arg(r"has space\"), r#""has space\\""#);
    }
}

// ── `with_error_action_stop` — single-command path can't record a mutation that never ran ──
#[cfg(test)]
mod error_action_stop_tests {
    use super::with_error_action_stop;

    #[test]
    fn a_bare_command_is_prefixed_so_failures_terminate() {
        // A cmdlet that "fails" without throwing must not exit 0 → false ledger entry.
        let out = with_error_action_stop("Enable-MMAgent -MemoryCompression");
        assert!(
            out.starts_with("$ErrorActionPreference='Stop'; "),
            "must promote non-terminating errors, got: {out}"
        );
        assert!(out.contains("Enable-MMAgent -MemoryCompression"), "must keep the command, got: {out}");
    }

    #[test]
    fn a_command_already_setting_erroraction_is_not_double_prefixed() {
        // Idempotent: some apply builders embed the directive in a multi-statement script.
        let already = "$ErrorActionPreference='Stop'; Do-Thing";
        let out = with_error_action_stop(already);
        assert_eq!(out, already, "must pass through unchanged");
        assert_eq!(out.matches("$ErrorActionPreference").count(), 1, "no second directive");
    }

    #[test]
    fn leading_whitespace_before_the_directive_is_still_recognized() {
        // trim_start guard: a leading-space script that sets its own preference isn't re-prefixed.
        let out = with_error_action_stop("  $ErrorActionPreference='SilentlyContinue'; X");
        assert_eq!(out.matches("$ErrorActionPreference").count(), 1, "must not prepend a conflicting Stop");
    }

    // bug→guard (rust-tauri-reviewer 2026-07-14): run_elevated_powershell now unconditionally prefixes
    // `$ErrorActionPreference='Stop'`. In a MULTI-interface Nagle script, a registry write that fails on
    // interface N would then abort the ENTIRE script — leaving interfaces 0..N already mutated on the
    // machine with NO ledger entry (apply returns Err → nothing persisted → un-rollback-able live
    // mutation = rollback-first violation). Each Set-ItemProperty MUST isolate its own error. This scans
    // the source so a future edit can't silently drop the flag and reopen the regression.
    #[test]
    fn every_nagle_set_itemproperty_write_isolates_its_own_error() {
        // Tokens built by concat! so this test's own source lines don't self-match the scan.
        let set = concat!("Set-", "ItemProperty");
        let ack = concat!("TcpAck", "Frequency");
        let nodelay = concat!("TCP", "NoDelay");
        let flag = concat!("-ErrorAction ", "SilentlyContinue");
        let mut checked = 0;
        for line in include_str!("actions.rs").lines() {
            // A real write is the PowerShell string literal: `Set-ItemProperty ... -Name '<col>' ...`.
            // `-Name '` excludes prose comments that merely mention the cmdlet. (Apply builds it on one
            // push_str line; rollback's Some(v) arms put the literal on its own continuation line.)
            let is_nagle_write = line.contains(set)
                && line.contains("-Name '")
                && (line.contains(ack) || line.contains(nodelay));
            if is_nagle_write {
                assert!(
                    line.contains(flag),
                    "a Nagle Set-ItemProperty write lost its per-call error isolation (reopens the \
                     mid-loop-abort orphan bug): {}",
                    line.trim()
                );
                checked += 1;
            }
        }
        assert!(
            checked >= 4,
            "expected >=4 guarded Nagle writes (2 apply + 2 rollback restore), scanned {checked}"
        );
    }
}

#[cfg(test)]
mod eee_resolution_tests {
    use super::*;

    fn prop(name: &str, current: &str, valid: &[&str]) -> EeeProperty {
        EeeProperty {
            adapter_name: "Ethernet".into(),
            display_name: name.into(),
            current_value: current.into(),
            valid_values: valid.iter().map(|v| v.to_string()).collect(),
        }
    }

    #[test]
    fn parses_four_field_lines_and_skips_malformed() {
        let out = "Ethernet|Energy Efficient Ethernet|Enabled|Enabled~Disabled\n\
                   Ethernet 2|EEE|On|On~Off\n\
                   garbage line\n\
                   old|three|fields\n";
        let props = parse_eee_property_lines(out);
        assert_eq!(props.len(), 2);
        assert_eq!(props[0].valid_values, vec!["Enabled".to_string(), "Disabled".to_string()]);
        assert_eq!(props[1].current_value, "On");
    }

    #[test]
    fn picks_the_drivers_own_disabled_token_never_assumes_english_disabled() {
        // The tester-found failure: drivers whose vocabulary is Off/0 rejected the literal
        // 'Disabled' write, which then read as a false UAC cancel.
        assert_eq!(pick_disabled_value(&["Enabled".into(), "Disabled".into()]), Some("Disabled".into()));
        assert_eq!(pick_disabled_value(&["On".into(), "Off".into()]), Some("Off".into()));
        assert_eq!(pick_disabled_value(&["1".into(), "0".into()]), Some("0".into()));
        // A vocabulary we don't recognize (e.g. localized) → None: gate, don't guess.
        assert_eq!(pick_disabled_value(&["Aktiviert".into(), "Deaktiviert".into()]), None);
        // Driver reported nothing → legacy fallback to the literal attempt.
        assert_eq!(eee_disable_value_for(&prop("EEE", "Enabled", &[])), Some("Disabled".into()));
    }

    #[test]
    fn resolution_classifies_honestly() {
        assert_eq!(resolve_eee_from(vec![]), EeeResolution::NoEligibleAdapter);
        // Properties exist but none has a recognized off-token → gate as no-switch.
        assert_eq!(
            resolve_eee_from(vec![prop("EEE", "Ein", &["Ein", "Aus"])]),
            EeeResolution::NoDisableSwitch
        );
        // Mixed: keep only the safely-flippable ones.
        let r = resolve_eee_from(vec![
            prop("EEE", "Ein", &["Ein", "Aus"]),
            prop("Green Ethernet", "On", &["On", "Off"]),
        ]);
        match r {
            EeeResolution::Ready(props) => {
                assert_eq!(props.len(), 1);
                assert_eq!(props[0].display_name, "Green Ethernet");
            }
            other => panic!("expected Ready, got {other:?}"),
        }
    }

    #[test]
    fn detection_reads_the_drivers_vocabulary_not_just_english() {
        // The "EEE state reads wrong" half of the tester report.
        assert!(eee_value_is_disabled(&prop("EEE", "Off", &["On", "Off"])));
        assert!(eee_value_is_disabled(&prop("EEE", "Disabled", &["Enabled", "Disabled"])));
        assert!(eee_value_is_disabled(&prop("EEE", "0", &["1", "0"])));
        assert!(!eee_value_is_disabled(&prop("EEE", "On", &["On", "Off"])));
        assert!(!eee_value_is_disabled(&prop("EEE", "Enabled", &["Enabled", "Disabled"])));
    }

    // PIN — Intel I226-V (tester's NIC, Export 2026-06-10). Intel's igc driver exposes the switch
    // as DisplayName "Energy-Efficient Ethernet" / keyword *EEE with an On/OFF vocabulary. The old
    // pipeline wrote the literal 'Disabled' (rejected) and detection did contains("disab") — which
    // can NEVER read "Off" as disabled, producing the tester's "applied · no longer active (changed
    // outside Compy)" false drift. The new pipeline must apply with the driver's own token AND keep
    // reading it as active.
    #[test]
    fn i226v_on_off_vocabulary_applies_and_stays_active() {
        let i226v_before = prop("Energy-Efficient Ethernet", "On", &["On", "Off"]);
        // Resolves as flippable, with the driver's own token — never the literal 'Disabled'.
        match resolve_eee_from(vec![i226v_before.clone()]) {
            EeeResolution::Ready(props) => assert_eq!(props.len(), 1),
            other => panic!("I226-V must resolve Ready, got {other:?}"),
        }
        assert_eq!(eee_disable_value_for(&i226v_before), Some("Off".into()));
        // After the write, the read-back is "Off" — the comparator reads it as DISABLED (active
        // rec), where the old contains("disab") read it as drifted.
        let i226v_after = prop("Energy-Efficient Ethernet", "Off", &["On", "Off"]);
        assert!(eee_value_is_disabled(&i226v_after));
        assert!(!"Off".to_lowercase().contains("disab"), "the old detection could never pass this");
    }

    // PIN — the AMD dev rig's real Realtek inventory (live probe 2026-06-10): three flippable
    // switches (Disabled/Enabled vocab) resolve; the "EEE Max Support Speed" enum — a speed list,
    // not a switch — has no disable token and is excluded rather than guessed at.
    #[test]
    fn realtek_inventory_resolves_switches_and_excludes_the_speed_enum() {
        let r = resolve_eee_from(vec![
            prop("Energy-Efficient Ethernet", "Enabled", &["Disabled", "Enabled"]),
            prop("Advanced EEE", "Enabled", &["Disabled", "Enabled"]),
            prop("Green Ethernet", "Enabled", &["Disabled", "Enabled"]),
            prop(
                "EEE Max Support Speed",
                "1.0 Gbps Full Duplex",
                &["10 Mbps Full Duplex", "1.0 Gbps Full Duplex"],
            ),
        ]);
        match r {
            EeeResolution::Ready(props) => {
                assert_eq!(props.len(), 3, "the speed enum must be excluded");
                assert!(props.iter().all(|p| eee_disable_value_for(p) == Some("Disabled".into())));
            }
            other => panic!("expected Ready, got {other:?}"),
        }
    }

    #[test]
    fn apply_script_writes_picked_values_and_exits_deterministically() {
        let targets = vec![
            (prop("EEE", "On", &["On", "Off"]), "Off".to_string()),
            (prop("Energy Efficient Ethernet", "Enabled", &["Enabled", "Disabled"]), "Disabled".to_string()),
        ];
        let ps = build_eee_apply_script(&targets);
        assert!(ps.contains("-DisplayValue 'Off'"), "uses the driver's own token");
        assert!(ps.contains("-DisplayValue 'Disabled'"));
        assert!(ps.ends_with("$null = 0"), "deterministic exit 0 — a skipped pair must never masquerade as an elevation failure");
        assert!(!ps.contains("exit"), "never exit — eee-disable is §4-batchable");
        // Quote-escaping for adapter names with apostrophes.
        let quoted = build_eee_apply_script(&[(
            EeeProperty {
                adapter_name: "Bob's NIC".into(),
                display_name: "EEE".into(),
                current_value: "On".into(),
                valid_values: vec!["On".into(), "Off".into()],
            },
            "Off".into(),
        )]);
        assert!(quoted.contains("'Bob''s NIC'"));
    }
}

#[cfg(test)]
mod nagle_target_tests {
    use super::{
        require_nagle_interfaces, rollback_nagle_disable_typed, select_nagle_targets, NagleInterfaceSnapshot,
    };

    #[test]
    fn targets_physical_excludes_virtual() {
        // Tester case: a Wi-Fi rig with a VPN TAP adapter. Both have IPs; only the physical Wi-Fi
        // NIC should get the Nagle write — never the VPN's virtual interface.
        let with_ip = vec!["{WIFI-GUID}".to_string(), "{TAP-VPN-GUID}".to_string()];
        let physical = vec!["{WIFI-GUID}".to_string()];
        assert_eq!(select_nagle_targets(&with_ip, &physical), vec!["{WIFI-GUID}".to_string()]);
    }

    #[test]
    fn falls_back_to_all_when_physical_unknown_never_inert() {
        // If we can't identify the physical set (WMI down / GUID mismatch), apply to all with-IP so
        // the rec is never silently a no-op.
        let with_ip = vec!["{A}".to_string(), "{B}".to_string()];
        assert_eq!(select_nagle_targets(&with_ip, &[]), with_ip);
        // Registry key casing vs WMI casing: the with-IP side is upper-cased before compare, and the
        // original registry key name is preserved in the result (we write to that exact key).
        let with_ip_lower = vec!["{a}".to_string(), "{b}".to_string()];
        let physical_upper = vec!["{A}".to_string()];
        assert_eq!(select_nagle_targets(&with_ip_lower, &physical_upper), vec!["{a}".to_string()]);
    }

    // Codebase review 2026-11-02: with no adapter to change, apply returned Ok with an empty snapshot,
    // the ledger said "applied" for a change that wrote nothing, and rollback refuses an empty snapshot,
    // so the row could never be closed.
    #[test]
    fn an_apply_with_no_interface_to_change_is_refused_before_anything_runs() {
        let err = require_nagle_interfaces(Vec::new()).expect_err("nothing to change must refuse");
        assert!(err.contains("nothing was changed"), "{err}");
        // The row it would have written is one rollback can never close.
        assert!(rollback_nagle_disable_typed(&[]).is_err());
        let one = vec![NagleInterfaceSnapshot {
            interface: "{A}".into(),
            prior_ack: None,
            prior_nodelay: Some(0),
        }];
        assert_eq!(require_nagle_interfaces(one).map(|v| v.len()), Ok(1));
        // Wiring: apply passes its targets through the refusal before the elevated write. Tokens are
        // built by concat! so this test's own lines don't match the scan.
        let src = include_str!("actions.rs");
        let start = src.find(concat!("pub(crate) fn apply_", "nagle_disable()")).expect("apply fn");
        let body = &src[start..];
        let end = body.find(concat!("pub(crate) fn rollback_", "nagle_disable_typed")).expect("rollback fn");
        let body = &body[..end];
        let refuse = body.find(concat!("require_nagle_", "interfaces(")).expect("apply must route through the refusal");
        let write = body.find(concat!("run_elevated_", "powershell(&ps)")).expect("apply writes through the runner");
        assert!(refuse < write, "the refusal must come before the elevated write");
    }
}

// ─── Service state snapshot via WMI ──────────────────────────────────────

#[derive(Deserialize)]
#[serde(rename = "Win32_Service")]
#[serde(rename_all = "PascalCase")]
pub(crate) struct Win32Service {
    state: Option<String>,
    start_mode: Option<String>,
}

pub(crate) fn service_info(name: &str) -> Option<(String, String)> {
    // WMI must run on a clean MTA thread; the Tauri command/UI thread is STA
    // (see hardware::on_wmi_thread). Own the name so the closure is 'static.
    let name = name.to_string();
    crate::hardware::on_wmi_thread(move || {
        let com = COMLibrary::new().ok()?;
        let wmi_conn = WMIConnection::new(com).ok()?;
        let query = format!("SELECT * FROM Win32_Service WHERE Name='{}'", name);
        let results: Vec<Win32Service> = wmi_conn.raw_query(&query).ok()?;
        let svc = results.into_iter().next()?;
        Some((
            svc.state.unwrap_or_else(|| "Unknown".into()),
            svc.start_mode.unwrap_or_else(|| "Unknown".into()),
        ))
    })
}

pub(crate) fn ps_service_startup_for_mode(mode: &str) -> &'static str {
    match mode {
        "Auto" | "Automatic" => "Automatic",
        "Manual" => "Manual",
        "Disabled" => "Disabled",
        _ => "Automatic",
    }
}

/// Refuse-contract seam (pure, unit-tested): the prior service state MUST be readable to snapshot
/// it for rollback. Returns the prior verbatim or a typed refusal naming the action — never a
/// guess. Factored out of the service applies so the fail-safe contract is testable without WMI
/// or elevation. Mirrors `restore_memory_compression_with`'s explicit-prior refusal pattern.
fn require_service_prior(
    name: &str,
    prior: Option<(String, String)>,
    verb: &str,
) -> Result<(String, String), String> {
    prior.ok_or_else(|| {
        format!(
            "could not read the current state of {name} to snapshot it for rollback; \
             refusing to {verb} a service we can't roll back"
        )
    })
}

#[cfg(test)]
mod service_prior_refusal_tests {
    use super::require_service_prior;

    #[test]
    fn refuses_when_prior_unreadable() {
        // The serious fix: an unreadable (None) prior must REFUSE, never fabricate Running/Auto.
        let err = require_service_prior("WSearch", None, "disable").unwrap_err();
        assert!(err.contains("refusing to disable"), "must refuse, got: {err}");
        assert!(err.contains("WSearch"), "must name the service, got: {err}");
    }

    #[test]
    fn passes_a_readable_prior_through_verbatim() {
        // A genuinely-read Stopped/Manual prior must survive unchanged (no coercion to Running/Auto).
        let ok = require_service_prior("SysMain", Some(("Stopped".into(), "Manual".into())), "suspend");
        assert_eq!(ok.unwrap(), ("Stopped".to_string(), "Manual".to_string()));
    }

    #[test]
    fn refusal_names_the_action_verb() {
        let err = require_service_prior("X", None, "suspend").unwrap_err();
        assert!(err.contains("refusing to suspend"), "got: {err}");
    }
}

// Generic "disable a Windows service" — used for SysMain, NVIDIA telemetry,
// and any future service-shaped rec. Snapshots prior state + start mode so
// rollback returns the service to exactly where it was.
/// Issue 617 assessment: two steps, but only `Set-Service` can fail the apply — `Stop-Service` is
/// `-ErrorAction SilentlyContinue`, so once the startup type changed the apply always returns Ok
/// with the full snapshot (never a partial change without a receipt).
pub(crate) fn apply_service_disable(service: KnownService) -> Result<ApplyResult, String> {
    ps_safe(service.name())?;
    // Snapshot the prior state FIRST. If WMI can't read it (COM/MTA glitch, ACL, query error),
    // REFUSE rather than fabricate a Running/Auto prior: a guessed prior would later restore a
    // genuinely Stopped/Manual service to Automatic + Start-Service, corrupting the user's config.
    // Rollback-first (1206-1208) wants the EXACT prior; matches apply_power_setting_off_on_ac and
    // restore_memory_compression_with. (Rollback-TIME conservatism stays — see
    // rollback_enable_scheduled_task_typed — because there the change is already made and must act.)
    let (prior_state, prior_start_mode) =
        require_service_prior(service.name(), service_info(service.name()), "disable")?;
    let cmd = format!(
        "Set-Service -Name {0} -StartupType Disabled; Stop-Service -Name {0} -Force -ErrorAction SilentlyContinue",
        service.name()
    );
    run_elevated_powershell(&cmd)?;
    Ok(ApplyResult {
        applied_action: AppliedAction::DisableKnownService {
            service: service.clone(),
        },
        rollback_action: RollbackAction::RestoreServiceFromSnapshot { service },
        snapshot: Snapshot::Service {
            prior_state,
            prior_start_mode,
        },
        elevation_used: true,
    })
}

pub(crate) fn rollback_service_disable_typed(
    service: &KnownService,
    prior_state: &str,
    prior_start_mode: &str,
) -> Result<(), String> {
    ps_safe(service.name())?;
    let startup = ps_service_startup_for_mode(prior_start_mode);
    ps_safe(startup)?;
    let mut cmd = format!("Set-Service -Name {} -StartupType {}", service.name(), startup);
    if prior_state == "Running" {
        cmd.push_str(&format!("; Start-Service -Name {}", service.name()));
    }
    run_elevated_powershell(&cmd)?;
    Ok(())
}

// ─── Session-scoped service SUSPEND (Services module, ARMED) ─────────
//
// GATE for session service suspension. ARMED (true) 2026-06-25 after the feature's own apply/rollback +
// crash-restore QA on a UAC-on rig + explicit owner sign-off — mirrors gaming_mode_gate. Expanding the
// mutating catalog to add this was the owner's explicit decision (2026-06-22, LOCKED-rule-6); the
// ARMING (gate flipped true + session picker wired in GamingMode.tsx) is DONE (QA passed + sign-off).
pub(crate) fn service_suspend_gate() -> bool {
    #[cfg(test)]
    if FORCE_SERVICE_SUSPEND_GATE.with(|f| *f.borrow()) {
        return true;
    }
    // ARMED 2026-06-25: its own apply/rollback + crash-restore QA passed (running-service exact-restore,
    // UAC-cancel = no-partial, critical-services hard-blocked) + explicit owner sign-off ("flip service-
    // suspend"). Was `false` while BUILT-DARK; the #[cfg(test)] seam above is now vestigial.
    true
}

// Test-only seam — historically opened the gate while it was BUILT-DARK. The production gate is now
// ARMED (returns true), so this is vestigial, but kept because gaming_orchestrator's integration QA
// still constructs the guard. Never compiled into the shipped binary.
#[cfg(test)]
thread_local! {
    static FORCE_SERVICE_SUSPEND_GATE: std::cell::RefCell<bool> = const { std::cell::RefCell::new(false) };
}

/// RAII guard that opens the service-suspend gate on this thread for the guard's lifetime (test-only).
#[cfg(test)]
pub(crate) struct ForceServiceSuspendGate;

#[cfg(test)]
impl ForceServiceSuspendGate {
    pub(crate) fn begin() -> Self {
        FORCE_SERVICE_SUSPEND_GATE.with(|f| *f.borrow_mut() = true);
        ForceServiceSuspendGate
    }
}

#[cfg(test)]
impl Drop for ForceServiceSuspendGate {
    fn drop(&mut self) {
        FORCE_SERVICE_SUSPEND_GATE.with(|f| *f.borrow_mut() = false);
    }
}

// SUSPEND ≠ DISABLE: Stop-Service ONLY, the StartupType is left untouched, so the service fully
// resumes on Start-Service or the next reboot — the session-scoped "pause while gaming" the roadmap
// asks for, not the permanent disable apply_service_disable does. The snapshot captures the prior
// running state so rollback restores exactly. `KnownService` is the type-enforced allowlist, so no
// critical service can ever be passed. Reuses the audited run_elevated_powershell + service_info.
pub(crate) fn apply_service_suspend(service: KnownService) -> Result<ApplyResult, String> {
    ps_safe(service.name())?;
    // Same fail-safe as apply_service_disable: refuse if the prior state can't be snapshotted
    // rather than guessing Running/Auto (hardened before the gate was armed; the snapshot must be true).
    let (prior_state, prior_start_mode) =
        require_service_prior(service.name(), service_info(service.name()), "suspend")?;
    run_elevated_powershell(&format!(
        "Stop-Service -Name {} -Force -ErrorAction SilentlyContinue",
        service.name()
    ))?;
    Ok(ApplyResult {
        applied_action: AppliedAction::SuspendKnownService {
            service: service.clone(),
        },
        rollback_action: RollbackAction::ResumeServiceFromSnapshot { service },
        snapshot: Snapshot::Service {
            prior_state,
            prior_start_mode,
        },
        elevation_used: true,
    })
}

// ─── OS-debloat: telemetry scheduled-task disable (ARMED 2026-06-26) ──────
//
// Built dark, then ARMED 2026-06-26 after this feature's own UAC QA + explicit owner sign-off (the
// owner greenlit adding the gated mutation 2026-06-22, LOCKED-rule-6; the ARMING + the curated
// KnownBloatTask list both rode that sign-off). Mirrors gaming_mode_gate / service_suspend.
// (Header comment corrected 2026-07-11 audit — it still read "DARK (false)" a full 15 days after the
// function itself was armed to `true`; see the inline comment on the return below for the real history.)
pub(crate) fn bloat_removal_gate() -> bool {
    // ARMED 2026-06-26: own apply/rollback QA passed (exact disable→enable restore + UAC-cancel=no-partial
    // + off-list/Defender rejected) + owner curated the task-list (all 3) + sign-off ("run all 3"). Was `false`.
    true
}

/// Resolve the concrete TaskName at `path` whose name starts with `base`. Windows renames these tasks
/// across builds (live-QA found "Microsoft Compatibility Appraiser" → "Microsoft Compatibility Appraiser
/// Exp" on Win11 26200), so an exact hardcoded name can SILENTLY miss the real task. Prefers an exact
/// match, else the first prefix match. Non-elevated; `path`/`base` are FIXED enum constants (guarded),
/// and the returned name is re-guarded by the caller before any elevated use. None → nothing matches.
fn resolve_task_name(path: &str, base: &str) -> Option<String> {
    if ps_safe_squoted(path).is_err() || ps_safe_squoted(base).is_err() {
        return None;
    }
    let out = quiet_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("Get-ScheduledTask -TaskPath '{}' | ForEach-Object {{ $_.TaskName }}", path),
        ])
        .output()
        .ok()?;
    let names: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    pick_task_name(&names, base)
}

/// Pure name picker (build-drift policy): an EXACT match wins (older Windows); otherwise the first
/// prefix match (a renamed task carrying a suffix like " Exp"). None if nothing at the path matches.
fn pick_task_name(names: &[String], base: &str) -> Option<String> {
    if names.iter().any(|n| n == base) {
        return Some(base.to_string());
    }
    names.iter().find(|n| n.starts_with(base)).cloned()
}

/// `(path, concrete_name)` for a task, resolving build-drift in the name and RE-GUARDING the resolved
/// name with `ps_safe_squoted` so it stays safe to interpolate into an elevated command. None → the
/// task is absent on this system (caller fails loud / reports Unknown rather than acting on a guess).
fn resolved_task_target(task: &KnownBloatTask) -> Option<(&'static str, String)> {
    let (path, base) = task.path_and_name();
    let name = resolve_task_name(path, base)?;
    if ps_safe_squoted(path).is_err() || ps_safe_squoted(&name).is_err() {
        return None;
    }
    Some((path, name))
}

/// Read a scheduled task's current state (non-elevated): "Ready" | "Disabled" | "Running" | "Unknown".
/// Resolves the real task name first (build-drift safe); identifiers are FIXED enum constants, guarded
/// by ps_safe_squoted and interpolated only inside '...'.
pub(crate) fn scheduled_task_state(task: &KnownBloatTask) -> String {
    let Some((path, name)) = resolved_task_target(task) else {
        return "Unknown".into();
    };
    match quiet_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("(Get-ScheduledTask -TaskPath '{}' -TaskName '{}').State", path, name),
        ])
        .output()
    {
        Ok(o) => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() { "Unknown".into() } else { s }
        }
        Err(_) => "Unknown".into(),
    }
}

/// Read-only, non-elevated, ONE PowerShell spawn: `path<TAB>name<TAB>state` for every task at every
/// allowlisted task path. The ledger's live re-check (#620) reads it once per History / Health pass and
/// shares it across rows, so those UI-thread reads cost one spawn however many task rows there are.
/// Paths are FIXED enum constants, guarded by ps_safe_squoted, inside '...'; each row echoes the loop's
/// own path, so it compares exactly. None only when PowerShell can't be started.
pub(crate) fn known_task_listing() -> Option<String> {
    let mut paths: Vec<&str> =
        [KnownBloatTask::CompatibilityAppraiser, KnownBloatTask::CeipConsolidator, KnownBloatTask::CeipUsb]
            .iter()
            .map(|t| t.path_and_name().0)
            .collect();
    paths.sort_unstable();
    paths.dedup();
    if paths.iter().any(|p| ps_safe_squoted(p).is_err()) {
        return None;
    }
    let quoted: Vec<String> = paths.iter().map(|p| format!("'{p}'")).collect();
    let out = quiet_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "foreach ($p in {}) {{ Get-ScheduledTask -TaskPath $p -ErrorAction SilentlyContinue | \
                 ForEach-Object {{ $p + [char]9 + $_.TaskName + [char]9 + $_.State }} }}",
                quoted.join(",")
            ),
        ])
        .output()
        .ok()?;
    // Like `resolve_task_name`, the exit code is not the read: a path that fails prints no row, and
    // its tasks then answer None.
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Pure: from a [`known_task_listing`], is `task` disabled? Only rows at the task's own path count;
/// the name resolves by the same [`pick_task_name`] build-drift policy as every other task read.
pub(crate) fn task_disabled_in_known_listing(listing: &str, task: &KnownBloatTask) -> Option<bool> {
    let (path, base) = task.path_and_name();
    let at_path: Vec<&str> = listing
        .lines()
        .filter_map(|l| l.split_once('\t'))
        .filter(|(p, _)| *p == path)
        .map(|(_, rest)| rest)
        .collect();
    task_disabled_in_listing(&at_path.join("\n"), base)
}

/// Pure: from `name<TAB>state` lines, is the task `base` resolves to disabled? Disabled → true;
/// Ready / Running / Queued → false; an unknown state, or no task by that name, → None.
fn task_disabled_in_listing(listing: &str, base: &str) -> Option<bool> {
    let rows: Vec<(String, String)> = listing
        .lines()
        .filter_map(|l| l.split_once('\t'))
        .map(|(n, s)| (n.trim().to_string(), s.trim().to_string()))
        .collect();
    let names: Vec<String> = rows.iter().map(|(n, _)| n.clone()).collect();
    let name = pick_task_name(&names, base)?;
    match rows.iter().find(|(n, _)| *n == name)?.1.as_str() {
        "Disabled" => Some(true),
        "Ready" | "Running" | "Queued" => Some(false),
        _ => None,
    }
}

/// Disable a curated telemetry scheduled task (elevated). Snapshots prior state first so rollback
/// re-enables only what was enabled. Reads → ONE elevated command → return (batchable / exit-free).
pub(crate) fn apply_disable_scheduled_task(task: KnownBloatTask) -> Result<ApplyResult, String> {
    // Resolve the concrete task name FIRST so a build-drift rename (e.g. "... Exp") fails loud here —
    // BEFORE any elevation — instead of popping a UAC prompt only to silently no-op on a missing task.
    let (path, name) = resolved_task_target(&task)
        .ok_or_else(|| "that telemetry task was not found on this system.".to_string())?;
    // Rollback-first: refuse if the prior state can't be confirmed rather than recording an "Unknown"
    // prior and mutating anyway. If the task was ALREADY Disabled and the read transiently failed,
    // rollback (which treats Unknown as "was enabled") would later re-enable a task the user or an
    // environment policy intentionally left disabled. Mirrors require_service_prior for service applies.
    let prior_state = scheduled_task_state(&task);
    if prior_state == "Unknown" {
        return Err("couldn't read that telemetry task's current state, so this change wasn't applied — \
                    an unconfirmed prior state can't be reliably rolled back. Nothing was changed; try again."
            .to_string());
    }
    run_elevated_powershell(&format!(
        "Disable-ScheduledTask -TaskPath '{}' -TaskName '{}' | Out-Null",
        path, name
    ))?;
    Ok(ApplyResult {
        applied_action: AppliedAction::DisableScheduledTask { task: task.clone() },
        rollback_action: RollbackAction::EnableScheduledTask { task },
        snapshot: Snapshot::ScheduledTask { prior_state },
        elevation_used: true,
    })
}

/// Resume a session-suspended service: Start-Service only if it WAS running at suspend time (suspend
/// never touched the startup type, so there's nothing to restore there). Fail-safe: a service that
/// wasn't running stays stopped — and that path issues no elevated command at all.
pub(crate) fn rollback_service_suspend_typed(
    service: &KnownService,
    prior_state: &str,
) -> Result<(), String> {
    ps_safe(service.name())?;
    if prior_state == "Running" {
        run_elevated_powershell(&format!("Start-Service -Name {}", service.name()))?;
    }
    Ok(())
}

/// Re-enable a disabled telemetry task — only if it was enabled (Ready/Running) at snapshot time.
/// Fail-safe: a task that was already disabled stays disabled and issues NO elevated command.
pub(crate) fn rollback_enable_scheduled_task_typed(
    task: &KnownBloatTask,
    prior_state: &str,
) -> Result<(), String> {
    // Rollback-first fidelity: re-enable UNLESS we KNOW it was Disabled. An "Unknown" prior is
    // treated as "was enabled" → restored to the stock/enabled state, the conservative direction.
    // This is rollback-TIME (the task is already disabled and we must act, and Enable-ScheduledTask
    // on an already-enabled task is harmless) — distinct from apply-time, which now REFUSES on an
    // unreadable prior rather than guessing. Only a confirmed-Disabled prior stays disabled — and
    // that path issues no elevated command.
    if prior_state == "Disabled" {
        return Ok(());
    }
    // Resolve the real task name (build-drift safe) before the elevated re-enable.
    let (path, name) = resolved_task_target(task)
        .ok_or_else(|| "that telemetry task was not found to re-enable.".to_string())?;
    run_elevated_powershell(&format!(
        "Enable-ScheduledTask -TaskPath '{}' -TaskName '{}' | Out-Null",
        path, name
    ))?;
    Ok(())
}

// ─── Phase-B preload-app removal (BUILT DARK, owner nod 2026-07-06) ────────
//
// GATE — DARK (false) until this feature's own live QA (remove→reinstall round-trip on this rig,
// off-list rejected, not-installed refused, every Store ProductId link-verified) + the owner curates
// the final KnownPreloadApp list + explicit arming sign-off. Mirrors bloat_removal_gate's dark phase
// (LOCKED-rule-6; the owner's 2026-07-06 nod greenlit BUILDING it — arming rides its own sign-off).
pub(crate) fn preload_removal_gate() -> bool {
    false
}

/// A curated app's live per-user install identity, read from the system (never a const).
pub(crate) struct InstalledPreloadApp {
    pub(crate) full_name: String,
    pub(crate) family_name: String,
    pub(crate) version: String,
}

/// Read a curated app's install state for the CURRENT USER (non-elevated, read-only).
/// Three-way honest contract (adversarial-review fix, 2026-07-06): `Ok(Some)` = installed
/// (identity read) · `Ok(None)` = CONFIRMED not installed (the probe ran and said so) ·
/// `Err` = the probe itself failed (spawn / non-zero exit / unparseable output). Callers must
/// treat `Err` as "unknown state", never as "absent" — collapsing the two is exactly the
/// snapshot-prior failure class [[mutation-snapshot-failsafe-idiom]] forbids.
pub(crate) fn installed_preload_app(
    app: &KnownPreloadApp,
) -> Result<Option<InstalledPreloadApp>, String> {
    // package_name is a FIXED enum constant; guard anyway before interpolation (defense in depth).
    let name = app.package_name();
    ps_safe(name)?;
    let out = quiet_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            // Always emits exactly ONE JSON object ('{}' when absent), so stray host output or a
            // short read is DETECTED as a parse failure (Err) instead of silently shifting a
            // positional parse or reading as "not installed".
            &format!(
                "$p = Get-AppxPackage -Name '{}' | Select-Object -First 1; \
                 if ($p) {{ @{{ full = \"$($p.PackageFullName)\"; family = \"$($p.PackageFamilyName)\"; version = \"$($p.Version)\" }} | ConvertTo-Json -Compress }} else {{ '{{}}' }}",
                name
            ),
        ])
        .output()
        .map_err(|e| format!("couldn't read the app's install state: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "couldn't read the app's install state: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let json: serde_json::Value = serde_json::from_str(text.trim())
        .map_err(|_| "couldn't read the app's install state: unexpected probe output".to_string())?;
    let obj = json
        .as_object()
        .ok_or_else(|| "couldn't read the app's install state: unexpected probe output".to_string())?;
    if obj.is_empty() {
        return Ok(None); // the probe RAN and answered — a confirmed absence, not a guess
    }
    let field = |k: &str| {
        obj.get(k)
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    match (field("full"), field("family"), field("version")) {
        (Some(full_name), Some(family_name), Some(version)) => Ok(Some(InstalledPreloadApp {
            full_name,
            family_name,
            version,
        })),
        _ => Err("couldn't read the app's install state: unexpected probe output".to_string()),
    }
}

/// Which curated apps are installed for this user — ONE PowerShell spawn for the whole set
/// (the FE listing probe; per-app identity for the apply snapshot uses `installed_preload_app`).
/// Unlike that strict three-way probe, this one MAY collapse failure→empty: it only decides what
/// the Fix card DISPLAYS (worst case: an installed app isn't offered) — no mutation or rollback
/// decision ever reads it, so the fail-safe direction is simply "show nothing".
pub(crate) fn installed_preload_ids() -> Vec<&'static str> {
    let mut safe_names = Vec::new();
    for app in &KnownPreloadApp::ALL {
        if ps_safe(app.package_name()).is_ok() {
            safe_names.push(format!("'{}'", app.package_name()));
        }
    }
    if safe_names.is_empty() {
        return Vec::new();
    }
    let Ok(out) = quiet_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!(
                "foreach ($n in @({})) {{ if (Get-AppxPackage -Name $n) {{ $n }} }}",
                safe_names.join(",")
            ),
        ])
        .output()
    else {
        return Vec::new();
    };
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    let found: Vec<String> = text
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    KnownPreloadApp::ALL
        .iter()
        .filter(|a| found.iter().any(|f| f == a.package_name()))
        .map(|a| a.id())
        .collect()
}

/// Remove a curated preload app FOR THE CURRENT USER (non-elevated — per-user Appx removal needs
/// no admin). Snapshot-or-refuse: the package identity is read from the live system FIRST; an
/// absent/unreadable package REFUSES before any mutation rather than acting on a guess
/// ([[mutation-snapshot-failsafe-idiom]]). Success is verified by a re-read, never assumed.
pub(crate) fn apply_remove_preload_app(app: KnownPreloadApp) -> Result<ApplyResult, String> {
    // Snapshot-or-refuse: a failed probe (Err) and a confirmed absence (Ok(None)) BOTH refuse
    // here, BEFORE any mutation — never act on a guess.
    let installed = installed_preload_app(&app)?.ok_or_else(|| {
        "that app isn't installed for this user — nothing to remove.".to_string()
    })?;
    // The full name came from a system read — re-guard before interpolating. Appx full names are
    // [A-Za-z0-9._-] by construction, so ps_safe (no spaces) is the right guard.
    ps_safe(&installed.full_name)?;
    let out = quiet_command("powershell")
        .args([
            "-NoProfile",
            "-Command",
            &format!("Remove-AppxPackage -Package '{}'", installed.full_name),
        ])
        .output()
        .map_err(|e| format!("couldn't run the removal: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "Windows refused the removal — nothing changed. ({})",
            err.trim()
        ));
    }
    // Honest receipt: re-read after the removal. CONFIRMED-still-installed → report failure (the
    // user's state is intact, nothing to record). A FAILED re-read (Err) does NOT discard the
    // receipt: the removal command already reported success, and a real mutation with no ledger
    // receipt is the worse failure (rollback-first) — recording keeps the undo available, and the
    // undo is idempotent/harmless if the app never actually left.
    if let Ok(Some(_)) = installed_preload_app(&app) {
        return Err("the removal ran but the app is still installed — nothing recorded.".into());
    }
    Ok(ApplyResult {
        applied_action: AppliedAction::RemovePreloadApp { app: app.clone() },
        rollback_action: RollbackAction::ReinstallPreloadApp { app },
        snapshot: Snapshot::PreloadApp {
            prior_full_name: installed.full_name,
            prior_family_name: installed.family_name,
            prior_version: installed.version,
        },
        elevation_used: false,
    })
}

/// Roll back a preload-app removal — two honest tiers (spec 2026-07-06). Tier 1: silently
/// re-register the still-staged package by the SNAPSHOT family name; success is verified by a
/// re-read, never assumed from exit status. Tier 2 (staging gone): open the app's Store page
/// (curated ProductId) and return Err with plain instructions — the ledger entry honestly stays
/// ACTIVE; a later Roll back re-verifies and closes it. Already installed → Ok (idempotent).
pub(crate) fn rollback_reinstall_preload_app_typed(
    app: &KnownPreloadApp,
    prior_family_name: &str,
) -> Result<(), String> {
    // Only a CONFIRMED-installed read (Ok(Some)) may close the ledger entry; an unreadable probe
    // (Err) is "unknown" and falls through to the restore attempt, which is idempotent/harmless
    // when the app is actually present.
    if matches!(installed_preload_app(app), Ok(Some(_))) {
        return Ok(());
    }
    // Family name comes from the apply-time snapshot (a system read) — guard before interpolating.
    if ps_safe(prior_family_name).is_ok() {
        let _ = quiet_command("powershell")
            .args([
                "-NoProfile",
                "-Command",
                &format!(
                    "Add-AppxPackage -RegisterByFamilyName -MainPackage '{}' -ErrorAction Stop",
                    prior_family_name
                ),
            ])
            .output();
        if matches!(installed_preload_app(app), Ok(Some(_))) {
            return Ok(());
        }
    }
    // Tier 2: hand off to the Store page (fixed curated ProductId — no dynamic data enters the
    // command). Same open-via-explorer idiom as open_export_folder: no shell, no elevation.
    let _ = std::process::Command::new("explorer")
        .arg(format!("ms-windows-store://pdp/?ProductId={}", app.store_product_id()))
        .spawn();
    Err("Couldn't restore it silently — Compy opened its Microsoft Store page instead. \
         Press Install there, then Roll back again to confirm it's back."
        .to_string())
}

#[cfg(test)]
mod preload_removal_tests {
    use super::*;

    #[test]
    fn gate_is_dark_until_qa_and_owner_signoff() {
        // The owner's 2026-07-06 nod greenlit BUILDING this; ARMING rides its own live QA
        // (remove→reinstall round-trip, Store links verified) + curated-list sign-off.
        assert!(!preload_removal_gate(), "preload removal must stay DARK until QA + sign-off");
    }

    #[test]
    fn from_id_enforces_the_allowlist_and_rejects_everything_else() {
        assert!(KnownPreloadApp::from_id("solitaire-collection").is_some());
        assert!(KnownPreloadApp::from_id("office-hub").is_some());
        // Data-bearing, security, gaming-critical, and arbitrary ids can NEVER reach the primitive.
        // spotify-preload pins the owner's 2026-07-06 curation cut (same package id as a real
        // daily-driver install — no honest "stub" framing exists).
        for bad in [
            "microsoft-photos",
            "sticky-notes",
            "windows-defender",
            "xbox-game-bar",
            "gaming-services",
            "Microsoft.WindowsStore",
            "spotify-preload",
            "",
        ] {
            assert!(KnownPreloadApp::from_id(bad).is_none(), "must reject {bad:?}");
        }
    }

    #[test]
    fn ids_round_trip_and_identifiers_pass_the_interpolation_guard() {
        // Literal pin (mirrors the FE contract test in preload-apps.test.tsx) — an id rename on
        // either side fails one of the two suites instead of silently 404ing at the IPC boundary.
        let ids: Vec<&str> = KnownPreloadApp::ALL.iter().map(|a| a.id()).collect();
        assert_eq!(ids, ["solitaire-collection", "feedback-hub", "bing-news", "office-hub"]);
        for app in &KnownPreloadApp::ALL {
            assert_eq!(KnownPreloadApp::from_id(app.id()), Some(app.clone()));
            // Every fixed identifier that is ever interpolated into a command must pass its guard.
            assert!(ps_safe(app.package_name()).is_ok(), "package name {:?}", app.package_name());
            assert!(ps_safe(app.store_product_id()).is_ok(), "product id {:?}", app.store_product_id());
        }
    }

    #[test]
    fn typed_contract_round_trips() {
        let a = AppliedAction::RemovePreloadApp { app: KnownPreloadApp::FeedbackHub };
        let back: AppliedAction = serde_json::from_str(&serde_json::to_string(&a).unwrap()).unwrap();
        assert!(matches!(back, AppliedAction::RemovePreloadApp { .. }));
        let r = RollbackAction::ReinstallPreloadApp { app: KnownPreloadApp::BingNews };
        let back2: RollbackAction =
            serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
        assert!(matches!(back2, RollbackAction::ReinstallPreloadApp { .. }));
        let s = Snapshot::PreloadApp {
            prior_full_name: "A_1.0_x64__pub".into(),
            prior_family_name: "A_pub".into(),
            prior_version: "1.0".into(),
        };
        let back3: Snapshot = serde_json::from_str(&serde_json::to_string(&s).unwrap()).unwrap();
        assert!(matches!(back3, Snapshot::PreloadApp { .. }));
    }

    #[test]
    fn dispatch_rejects_a_mismatched_snapshot() {
        // A garbled ledger pair (reinstall action + task snapshot) must fail safe, never guess.
        let r = RollbackAction::ReinstallPreloadApp { app: KnownPreloadApp::OfficeHub };
        let s = Snapshot::ScheduledTask { prior_state: "Ready".into() };
        assert!(dispatch_rollback(&crate::data_root::test_mutation_root(), &r, &s).is_err());
    }

    // ── Live QA harness (manual; #[ignore], run at arming time) — proves the remove→reinstall
    // round trip against a REAL installed curated app on this rig. Does NOT flip the gate.
    #[test]
    #[ignore = "manual: real per-user Appx mutation; run during arming QA"]
    fn qa_remove_then_reinstall_round_trip() {
        let Some(app) = KnownPreloadApp::ALL
            .iter()
            .find(|a| matches!(installed_preload_app(a), Ok(Some(_))))
            .cloned()
        else {
            panic!("no curated preload app installed on this rig — install one to run the QA");
        };
        let result = apply_remove_preload_app(app.clone()).expect("removal applies");
        assert!(
            matches!(installed_preload_app(&app), Ok(None)),
            "app should be CONFIRMED gone after removal"
        );
        if let Snapshot::PreloadApp { prior_family_name, .. } = &result.snapshot {
            rollback_reinstall_preload_app_typed(&app, prior_family_name)
                .expect("tier-1 re-register restores the app");
        } else {
            panic!("snapshot kind mismatch");
        }
        assert!(
            matches!(installed_preload_app(&app), Ok(Some(_))),
            "app must be CONFIRMED back after rollback"
        );
    }
}

#[cfg(test)]
mod service_suspend_tests {
    use super::*;

    #[test]
    fn gate_is_armed_after_qa_and_owner_signoff() {
        // ARMED 2026-06-25: QA passed (running-service exact-restore + UAC-cancel=no-partial +
        // critical-blocked) + explicit owner sign-off ("flip service-suspend"). Was DARK until then.
        assert!(service_suspend_gate(), "service-suspend is armed after QA + owner sign-off");
    }

    #[test]
    fn seam_is_vestigial_now_that_the_gate_is_armed() {
        // Post-arming the gate is on regardless; the #[cfg(test)] seam (still used by gaming_orchestrator
        // QA) is a no-op here — the gate reads armed both with and without the guard.
        assert!(service_suspend_gate(), "armed by default");
        let _g = ForceServiceSuspendGate::begin();
        assert!(service_suspend_gate(), "still armed with the seam (no-op)");
    }

    #[test]
    fn from_name_enforces_the_allowlist_and_rejects_critical_services() {
        assert!(KnownService::from_name("WSearch").is_some());
        assert!(KnownService::from_name("SysMain").is_some());
        // Critical / off-allowlist services can NEVER reach the suspend primitive.
        assert!(KnownService::from_name("csrss").is_none());
        assert!(KnownService::from_name("lsass").is_none());
        assert!(KnownService::from_name("services").is_none());
        assert!(KnownService::from_name("").is_none());
    }

    #[test]
    fn suspend_typed_contract_round_trips() {
        let a = AppliedAction::SuspendKnownService { service: KnownService::WSearch };
        let back: AppliedAction = serde_json::from_str(&serde_json::to_string(&a).unwrap()).unwrap();
        assert!(matches!(back, AppliedAction::SuspendKnownService { .. }));
        let r = RollbackAction::ResumeServiceFromSnapshot { service: KnownService::WSearch };
        let back2: RollbackAction =
            serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
        assert!(matches!(back2, RollbackAction::ResumeServiceFromSnapshot { .. }));
    }

    #[test]
    fn resume_is_a_noop_with_no_elevation_when_prior_was_not_running() {
        // prior != "Running" → no Start-Service, no elevated command → Ok. (The Running path reaches
        // run_elevated_powershell, exercised live by the #[ignore]'d QA harness, not here.)
        assert!(rollback_service_suspend_typed(&KnownService::WSearch, "Stopped").is_ok());
    }

    // ── Live QA harness (manual; #[ignore], UAC-on rig) — proves EXACT apply→rollback restore. ──
    // Mirrors manual_elevation_qa / gaming_mode_qa: drives the suspend primitive against a real safe
    // service (WSearch), reads WMI ground truth, asserts resume restores the prior running state.
    // Does NOT flip service_suspend_gate (it's #[cfg(test)] — compiled out of shipped binaries).
    #[test]
    #[ignore = "manual: real service mutation on a UAC-on rig"]
    fn qa_suspend_then_resume_restores_exact_state() {
        let svc = KnownService::WSearch;
        let (prior_state, _) = service_info(svc.name()).expect("read prior state");
        let result = apply_service_suspend(svc.clone()).expect("suspend applies");
        let (after, _) = service_info(svc.name()).expect("read post-suspend");
        assert_ne!(after, "Running", "suspend should stop the service");
        if let Snapshot::Service { prior_state: snap, .. } = &result.snapshot {
            rollback_service_suspend_typed(&svc, snap).expect("resume rolls back");
        }
        let (restored, _) = service_info(svc.name()).expect("read post-resume");
        assert_eq!(restored, prior_state, "resume must restore the EXACT prior running state");
    }

    // §7 UAC-cancel = NO PARTIAL MUTATION. With elevation forced to fail (a cancelled UAC prompt), the
    // suspend must return Err and leave the service EXACTLY as it was — the elevated Stop-Service never
    // runs (it's after the harmless non-elevated prior-read). SAFE to run: the forced failure means no
    // real mutation, so this proves the cancel arm without ever stopping the service.
    #[test]
    #[ignore = "manual: reads live WMI; proves a cancelled suspend leaves the service untouched"]
    fn qa_uac_cancel_leaves_service_untouched() {
        let svc = KnownService::WSearch;
        let (before, _) = service_info(svc.name()).expect("read prior state");
        let err = {
            let _cancel = ForceElevationError::begin();
            match apply_service_suspend(svc.clone()) {
                Ok(_) => panic!("a cancelled elevation must fail the suspend, not succeed"),
                Err(e) => e,
            }
        };
        let (after, _) = service_info(svc.name()).expect("read post-attempt state");
        assert_eq!(
            after, before,
            "a cancelled suspend must leave the service EXACTLY unchanged (no partial mutation)"
        );
        eprintln!("[QA-SVC-CANCEL] before={before} after={after} err={err}");
    }

    // §7 LIVE exact-restore of a RUNNING service (manual, UAC-on rig — APPROVE EACH PROMPT, ~4 total).
    // All allowlisted services are stopped on this rig, so we START SysMain, prove suspend→resume returns
    // it to RUNNING (the real exact-restore path), then RE-STOP it to its original state. Cleanup runs
    // BEFORE the asserts so a failed assert never strands SysMain running. Uses the #[cfg(test)] direct-
    // elevation seam so the elevated commands actually run under `cargo test` (gate stays dark).
    #[test]
    #[ignore = "manual: real elevated service mutation on a UAC-on rig; approve each prompt (~4)"]
    fn qa_running_service_suspend_then_resume_restores_to_running() {
        let _direct = ForceDirectElevation::begin();
        let svc = KnownService::SysMain;
        let name = svc.name();
        let read = |label: &str| {
            let s = service_info(name).map(|(s, _)| s).unwrap_or_else(|| "<unreadable>".into());
            eprintln!("[QA-RUN] {label}: {name}={s}");
            s
        };

        // Unconditional cleanup (runs even on panic via Drop): restore the service to its tuned ORIGINAL
        // (Disabled + Stopped on this rig). We flip ONE service Disabled→Manual only to make it startable
        // for the proof, then put the tuning back EXACTLY — the rig's deliberate config is never left changed.
        struct Restore<'a>(&'a str);
        impl Drop for Restore<'_> {
            fn drop(&mut self) {
                let _ = run_elevated_powershell(&format!("Stop-Service -Name {} -Force", self.0));
                let _ = run_elevated_powershell(&format!("Set-Service -Name {} -StartupType Disabled", self.0));
            }
        }
        let _restore = Restore(name);

        let _original = read("original");
        // Setup: enable + start so we exercise the running→suspend→restore path.
        run_elevated_powershell(&format!("Set-Service -Name {name} -StartupType Manual")).expect("setup: enable");
        run_elevated_powershell(&format!("Start-Service -Name {name}")).expect("setup: start");
        let running_before = read("after-start");

        // Suspend (captures the live prior), then resume from that snapshot.
        let applied = apply_service_suspend(svc.clone()).expect("suspend applies");
        let suspended = read("after-suspend");
        let prior_snap = match &applied.snapshot {
            Snapshot::Service { prior_state, .. } => prior_state.clone(),
            other => panic!("expected Snapshot::Service, got {other:?}"),
        };
        rollback_service_suspend_typed(&svc, &prior_snap).expect("resume rolls back");
        let restored = read("after-resume");

        // _restore drops at end of scope (or on panic) → SysMain back to Disabled + Stopped.
        assert_eq!(running_before, "Running", "setup must leave SysMain RUNNING");
        assert_ne!(suspended, "Running", "suspend must stop the running service");
        assert_eq!(
            restored, "Running",
            "resume must restore the service to its EXACT prior RUNNING state"
        );
    }
}

#[cfg(test)]
mod bloat_task_tests {
    use super::*;

    #[test]
    fn gate_is_armed() {
        // ARMED 2026-06-26: QA passed (exact-restore + cancel=no-partial + off-list rejected) + owner
        // curated the list (all 3) + sign-off ("run all 3"). Was DARK until then.
        assert!(bloat_removal_gate(), "bloat-task removal is armed after QA + owner sign-off");
    }

    #[test]
    fn from_id_enforces_allowlist_and_rejects_offlist() {
        assert!(KnownBloatTask::from_id("compatibility-appraiser").is_some());
        assert!(KnownBloatTask::from_id("ceip-usb").is_some());
        assert!(KnownBloatTask::from_id("defender-scan").is_none());
        assert!(KnownBloatTask::from_id("").is_none());
    }

    #[test]
    fn every_task_identifier_is_squote_safe() {
        for t in [
            KnownBloatTask::CompatibilityAppraiser,
            KnownBloatTask::CeipConsolidator,
            KnownBloatTask::CeipUsb,
        ] {
            let (p, n) = t.path_and_name();
            assert!(ps_safe_squoted(p).is_ok(), "path must be squote-safe: {p:?}");
            assert!(ps_safe_squoted(n).is_ok(), "name must be squote-safe: {n:?}");
        }
    }

    #[test]
    fn ps_safe_squoted_allows_task_chars_rejects_breakout() {
        assert!(ps_safe_squoted("Microsoft Compatibility Appraiser").is_ok());
        assert!(ps_safe_squoted("\\Microsoft\\Windows\\Application Experience\\").is_ok());
        for bad in [
            "a'b", "a$b", "a`b", "a;b", "a|b", "a&b", "a<b", "a>b", "a(b", "a)b", "a\"b", "a\nb", "a/b", "",
        ] {
            assert!(ps_safe_squoted(bad).is_err(), "must reject breakout token {bad:?}");
        }
    }

    #[test]
    fn contract_round_trips() {
        let a = AppliedAction::DisableScheduledTask { task: KnownBloatTask::CompatibilityAppraiser };
        let back: AppliedAction = serde_json::from_str(&serde_json::to_string(&a).unwrap()).unwrap();
        assert!(matches!(back, AppliedAction::DisableScheduledTask { .. }));
        let r = RollbackAction::EnableScheduledTask { task: KnownBloatTask::CeipUsb };
        let back2: RollbackAction = serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
        assert!(matches!(back2, RollbackAction::EnableScheduledTask { .. }));
    }

    #[test]
    fn rollback_is_noop_when_prior_disabled() {
        assert!(rollback_enable_scheduled_task_typed(&KnownBloatTask::CeipUsb, "Disabled").is_ok());
    }

    // #620: the ledger's one-spawn live read of a bloat task. Same build-drift policy as the apply
    // path's reader; only the four states Windows reports have an answer.
    #[test]
    fn a_task_listing_reads_disabled_only_for_a_known_state_of_the_resolved_task() {
        let base = "Microsoft Compatibility Appraiser";
        let listing = "MareBackup\tReady\r\nMicrosoft Compatibility Appraiser Exp\tDisabled\r\nStartupAppTask\tReady\r\n";
        assert_eq!(task_disabled_in_listing(listing, base), Some(true), "build-drift name resolves");
        let exact = "Microsoft Compatibility Appraiser\tReady\nMicrosoft Compatibility Appraiser Exp\tDisabled\n";
        assert_eq!(task_disabled_in_listing(exact, base), Some(false), "an exact name wins over a prefix");
        for state in ["Running", "Queued"] {
            assert_eq!(task_disabled_in_listing(&format!("{base}\t{state}"), base), Some(false), "{state}");
        }
        assert_eq!(task_disabled_in_listing(&format!("{base}\tUnknown"), base), None, "unknown state");
        assert_eq!(task_disabled_in_listing(&format!("{base}\t"), base), None, "no state");
        assert_eq!(task_disabled_in_listing("Consolidator\tDisabled", base), None, "task absent");
        assert_eq!(task_disabled_in_listing("", base), None, "nothing listed");
        assert_eq!(task_disabled_in_listing(base, base), None, "a line with no state column");
    }

    #[test]
    fn the_shared_listing_reads_each_task_only_at_its_own_path() {
        let ae = "\\Microsoft\\Windows\\Application Experience\\";
        let ceip = "\\Microsoft\\Windows\\Customer Experience Improvement Program\\";
        let listing = format!(
            "{ae}\tMicrosoft Compatibility Appraiser Exp\tDisabled\r\n{ceip}\tConsolidator\tReady\r\n{ceip}\tUsbCeip\tDisabled\r\n"
        );
        assert_eq!(task_disabled_in_known_listing(&listing, &KnownBloatTask::CompatibilityAppraiser), Some(true));
        assert_eq!(task_disabled_in_known_listing(&listing, &KnownBloatTask::CeipConsolidator), Some(false));
        assert_eq!(task_disabled_in_known_listing(&listing, &KnownBloatTask::CeipUsb), Some(true));
        let elsewhere = format!("\\Somewhere\\Else\\\tUsbCeip\tDisabled\n{ae}\tUsbCeip\tDisabled\n");
        assert_eq!(task_disabled_in_known_listing(&elsewhere, &KnownBloatTask::CeipUsb), None, "a same-named task at another path");
        assert_eq!(task_disabled_in_known_listing("", &KnownBloatTask::CeipUsb), None, "nothing listed");
    }

    /// The one-spawn listing (#620) against a REAL, non-elevated powershell.exe: the script parses and
    /// runs, and every row it prints is `path<TAB>name<TAB>state` at an allowlisted path. A broken
    /// script prints nothing, which would read every task row as unreadable, so an empty listing fails
    /// here. Both allowlisted folders ship with Windows, and each holds more than the curated tasks.
    #[test]
    fn real_powershell_lists_the_known_task_paths() {
        let listing = known_task_listing().expect("powershell starts");
        let known: Vec<&str> =
            [KnownBloatTask::CompatibilityAppraiser, KnownBloatTask::CeipConsolidator, KnownBloatTask::CeipUsb]
                .iter()
                .map(|t| t.path_and_name().0)
                .collect();
        let rows: Vec<&str> = listing.lines().filter(|l| !l.trim().is_empty()).collect();
        assert!(!rows.is_empty(), "the listing printed no task at any allowlisted path: {listing:?}");
        for row in rows {
            let cols: Vec<&str> = row.trim_end().split('\t').collect();
            assert_eq!(cols.len(), 3, "a row is path, name and state: {row:?}");
            assert!(known.contains(&cols[0]), "a row names an allowlisted path: {row:?}");
            assert!(!cols[1].is_empty(), "a row names its task: {row:?}");
            assert!(
                ["Ready", "Disabled", "Running", "Queued", "Unknown"].contains(&cols[2]),
                "a row's state is a ScheduledTask state name: {row:?}"
            );
        }
    }

    #[test]
    fn pick_task_name_prefers_exact_then_prefix_then_none() {
        let names = vec![
            "MareBackup".to_string(),
            "Microsoft Compatibility Appraiser Exp".to_string(),
            "StartupAppTask".to_string(),
        ];
        // Build-drift: the hardcoded base has no exact match, so the " Exp"-suffixed task is found.
        // This is the exact Win11 26200 case the live QA caught.
        assert_eq!(
            pick_task_name(&names, "Microsoft Compatibility Appraiser"),
            Some("Microsoft Compatibility Appraiser Exp".to_string())
        );
        // Exact match wins over any prefix sibling (older Windows still has the un-suffixed name).
        let exact = vec![
            "Microsoft Compatibility Appraiser".to_string(),
            "Microsoft Compatibility Appraiser Exp".to_string(),
        ];
        assert_eq!(
            pick_task_name(&exact, "Microsoft Compatibility Appraiser"),
            Some("Microsoft Compatibility Appraiser".to_string())
        );
        // Nothing matches → None (caller fails loud / reports Unknown, never guesses).
        assert_eq!(pick_task_name(&["Consolidator".to_string()], "UsbCeip"), None);
        assert_eq!(pick_task_name(&[], "Consolidator"), None);
    }

    // Live QA (manual; #[ignore], UAC-on rig) — proves exact disable→enable restore.
    #[test]
    #[ignore = "manual: real scheduled-task mutation on a UAC-on rig"]
    fn qa_disable_then_enable_restores_exact_state() {
        let _direct = ForceDirectElevation::begin(); // run elevated commands under cargo test (Wave-0 seam)
        // CompatibilityAppraiser is absent on Win11 25H2; CeipConsolidator is present + Ready on the dev rig.
        let t = KnownBloatTask::CeipConsolidator;
        let prior = scheduled_task_state(&t);
        let result = apply_disable_scheduled_task(t.clone()).expect("disable applies");
        assert_eq!(scheduled_task_state(&t), "Disabled", "disable should stop the task");
        if let Snapshot::ScheduledTask { prior_state } = &result.snapshot {
            rollback_enable_scheduled_task_typed(&t, prior_state).expect("enable rolls back");
        }
        assert_eq!(scheduled_task_state(&t), prior, "rollback must restore the EXACT prior state");
    }

    // §7 UAC-cancel = NO PARTIAL: with elevation forced to fail, the disable errors and the task is left
    // EXACTLY unchanged (the elevated Disable-ScheduledTask never runs). SAFE to run — no real mutation.
    #[test]
    #[ignore = "manual: reads task state; proves a cancelled disable leaves the task untouched"]
    fn qa_uac_cancel_leaves_task_untouched() {
        let t = KnownBloatTask::CeipConsolidator;
        let before = scheduled_task_state(&t);
        let err = {
            let _cancel = ForceElevationError::begin();
            match apply_disable_scheduled_task(t.clone()) {
                Ok(_) => panic!("a cancelled elevation must fail the disable, not succeed"),
                Err(e) => e,
            }
        };
        let after = scheduled_task_state(&t);
        assert_eq!(
            after, before,
            "a cancelled disable must leave the task EXACTLY unchanged (no partial mutation)"
        );
        eprintln!("[QA-BLOAT-CANCEL] before={before} after={after} err={err}");
    }
}

// ─── Power plan: Ultimate Performance ────────────────────────────────────

pub(crate) fn current_power_plan_guid() -> Option<String> {
    let output = quiet_command("powercfg").args(["/getactivescheme"]).output().ok()?;
    active_plan_guid_of(&String::from_utf8_lossy(&output.stdout))
}

/// PURE (P4-noise-sf): the active scheme's GUID from `powercfg /getactivescheme` output, read by the
/// GUID's own `8-4-4-4-12` shape ([`crate::scheme_guid_of`]), never by the label before it: Windows
/// prints that label in the user's language ("Power Scheme GUID:", "GUID des Energieschemas:"), so
/// keying on the English "GUID:" read nothing on a Windows whose label lacks it. Lower-cased, as
/// powercfg prints it.
pub(crate) fn active_plan_guid_of(stdout: &str) -> Option<String> {
    crate::scheme_guid_of(stdout)
}

/// Issue 617 assessment: the only setting change is the one `setactive`, now exit-checked so a
/// failed switch returns Err instead of a false receipt. `duplicatescheme` only ADDS an unused copy
/// of the Ultimate plan; if `setactive` then fails, that copy stays in the plan list (no active
/// setting changed). Kill-mid-apply residual: the plan may be switched with no receipt.
pub(crate) fn apply_power_ultimate() -> Result<ApplyResult, String> {
    // Capture the EXACT plan we're switching away from. Refuse if we can't read it —
    // applying a plan switch whose prior we don't know is a switch we can't honestly roll
    // back (the rollback would error on the empty GUID, leaving the user stuck on Ultimate).
    // Mirrors apply_power_setting_off_on_ac and the clean-skip in apply_power_plan_switch_core.
    let prior_guid = current_power_plan_guid().ok_or_else(|| {
        "could not determine the active power plan to snapshot; refusing to switch to \
         Ultimate Performance rather than apply a change that could not be rolled back"
            .to_string()
    })?;
    let ps = "$ult = powercfg /list | Select-String 'Ultimate Performance' | Select-Object -First 1; \
              if ($ult -match 'GUID: ([0-9a-f-]{36})') { powercfg /setactive $matches[1]; if ($?) { exit 0 }; exit 1 } \
              $dup = powercfg /duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 2>&1; \
              if ($dup -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') { powercfg /setactive $matches[1]; if ($?) { exit 0 }; exit 1 } \
              exit 1";
    run_elevated_powershell(ps)?;
    Ok(ApplyResult {
        applied_action: AppliedAction::SetUltimatePerformancePlan,
        rollback_action: RollbackAction::RestorePowerPlanFromSnapshot,
        snapshot: Snapshot::PowerPlan { prior_guid },
        elevation_used: true,
    })
}

pub(crate) fn rollback_power_ultimate_typed(prior_guid: &str) -> Result<(), String> {
    if prior_guid.len() != 36 {
        return Err("no valid prior plan GUID in snapshot".into());
    }
    ps_safe(prior_guid)?; // GUID is hex+hyphens — reject anything that isn't
    run_elevated_powershell(&format!("powercfg /setactive {}", prior_guid))?;
    Ok(())
}

// ─── Reserved Storage off (PowerShell cmdlet, admin) ─────────────────────

pub(crate) fn apply_reserved_storage_off() -> Result<ApplyResult, String> {
    // Refuse on an unreadable prior rather than letting reserved_storage_enabled()'s infallible
    // false fabricate the snapshot: a guessed prior_enabled=false would make rollback leave this
    // default-ON feature disabled instead of restoring the user's true Enabled state.
    let prior_enabled = reserved_storage_enabled_checked()
        .map_err(|e| format!("{e}; refusing to apply rather than record a guessed prior value"))?;
    run_elevated_powershell("Set-WindowsReservedStorageState -State Disabled")?;
    Ok(ApplyResult {
        applied_action: AppliedAction::DisableReservedStorage,
        rollback_action: RollbackAction::RestoreReservedStorageFromSnapshot,
        snapshot: Snapshot::ReservedStorage { prior_enabled },
        elevation_used: true,
    })
}

pub(crate) fn rollback_reserved_storage_off_typed(prior_enabled: bool) -> Result<(), String> {
    let state = if prior_enabled { "Enabled" } else { "Disabled" };
    ps_safe(state)?;
    run_elevated_powershell(&format!("Set-WindowsReservedStorageState -State {}", state))?;
    Ok(())
}

// ─── Power-plan setting subgroups (USB Selective Suspend, PCIe ASPM) ─────
//
// Both follow the same powercfg /setacvalueindex shape: a subgroup GUID,
// a setting GUID, and a new value (0 = the "off" position for both
// USB Selective Suspend and PCIe Link State Power Management).
//
// Snapshot captures the prior AC AND DC values plus the active plan GUID
// so rollback is bit-exact and stays consistent even if the user later
// switches power plans. Per the cross-LLM review, we never mutate the
// DC (battery) value on apply — laptop battery behavior stays alone.

pub(crate) const PWR_SUBGROUP_USB: &str = "2a737441-1930-4402-8d77-b2bebba308a3";
pub(crate) const PWR_SETTING_USB_SELECTIVE_SUSPEND: &str = "48e6b7a6-50f5-4782-a5d4-53bb8f07e226";
pub(crate) const PWR_SUBGROUP_PCIE: &str = "501a4d13-42af-4429-9fd1-a8218c268e20";
pub(crate) const PWR_SETTING_PCIE_ASPM: &str = "ee12f906-d277-404b-b6da-e5fa1a576df5";

/// Parse `powercfg /query` output for the "Current AC/DC Power Setting Index" hex values.
/// Finds the AC/DC index line, then extracts the trailing `0x..` hex token — tolerant of
/// trailing whitespace and the "Possible Setting Index: 000/001" decoy lines. Returns
/// (ac, dc); either is `None` when its line is absent or the hex won't parse.
///
/// This is the SINGLE powercfg-index parser shared by the USB/PCIe snapshot read below and
/// `read_core_parking_priors` — so the two can't drift (the PR-#4 "one parser silently
/// stops matching" class). Pure + unit-tested (see `powercfg_parse_tests`).
pub(crate) fn parse_powercfg_ac_dc_index(text: &str) -> (Option<u32>, Option<u32>) {
    let hex_after = |marker: &str| -> Option<u32> {
        text.lines()
            .find(|l| l.contains(marker))
            .and_then(|l| l.rsplit("0x").next())
            .and_then(|h| u32::from_str_radix(h.trim(), 16).ok())
    };
    (
        hex_after("AC Power Setting Index"),
        hex_after("DC Power Setting Index"),
    )
}

// Returns (ac_value, dc_value) by parsing `powercfg /query SCHEME_CURRENT
// <subgroup> <setting>`. Returns None if the call fails or the AC index can't
// be parsed (DC is best-effort, defaulting to 0).
pub(crate) fn query_power_setting_ac_dc(subgroup: &str, setting: &str) -> Option<(u32, u32)> {
    let output = quiet_command("powercfg")
        .args(["/query", "SCHEME_CURRENT", subgroup, setting])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let (ac_value, dc_value) = parse_powercfg_ac_dc_index(&stdout);
    Some((ac_value?, dc_value.unwrap_or(0)))
}

#[cfg(test)]
mod powercfg_parse_tests {
    use super::parse_powercfg_ac_dc_index;

    // Real `powercfg /query SCHEME_CURRENT <USB subgroup> <selective-suspend>` shape on
    // en-US Win11 26200 — note the "Possible Setting Index" decoy lines that must be ignored.
    const USB_SAMPLE: &str = "\
\r\n  Subgroup GUID: 2a737441-1930-4402-8d77-b2bebba308a3  (USB settings)\r\n\
    Power Setting GUID: 48e6b7a6-50f5-4782-a5d4-53bb8f07e226  (USB selective suspend setting)\r\n\
      Possible Setting Index: 000\r\n\
      Possible Setting Friendly Name: Disabled\r\n\
      Possible Setting Index: 001\r\n\
      Possible Setting Friendly Name: Enabled\r\n\
    Current AC Power Setting Index: 0x00000000\r\n\
    Current DC Power Setting Index: 0x00000001\r\n";

    // Real core-parking (CPMINCORES) shape — AC = 0x64 (100), DC = 0x0a (10).
    const CORE_PARK_SAMPLE: &str = "\
    Power Setting GUID: 0cc5b647-c1df-4637-891a-dec35c318583  (Processor performance core parking min cores)\r\n\
    Current AC Power Setting Index: 0x00000064\r\n\
    Current DC Power Setting Index: 0x0000000a\r\n";

    #[test]
    fn parses_ac_and_dc_ignoring_possible_decoys() {
        assert_eq!(parse_powercfg_ac_dc_index(USB_SAMPLE), (Some(0), Some(1)));
        assert_eq!(
            parse_powercfg_ac_dc_index(CORE_PARK_SAMPLE),
            (Some(0x64), Some(0x0a))
        );
    }

    #[test]
    fn missing_ac_line_yields_none_ac() {
        let only_dc = "    Current DC Power Setting Index: 0x00000001\r\n";
        assert_eq!(parse_powercfg_ac_dc_index(only_dc), (None, Some(1)));
    }

    #[test]
    fn line_without_hex_token_does_not_parse() {
        // A localized/format-drifted line that lost its 0x token must NOT be guessed at.
        let no_hex = "    Current AC Power Setting Index: (unreadable)\r\n";
        assert_eq!(parse_powercfg_ac_dc_index(no_hex), (None, None));
    }

    #[test]
    fn empty_or_unrelated_output_yields_none() {
        assert_eq!(parse_powercfg_ac_dc_index(""), (None, None));
        assert_eq!(
            parse_powercfg_ac_dc_index("Querying active state...\r\nsome other text\r\n"),
            (None, None)
        );
    }
}

pub(crate) fn apply_power_setting_off_on_ac(subgroup: &str, setting: &str) -> Result<ApplyResult, String> {
    // Snapshot first — both AC and DC current values. If we can't read the prior
    // (a future powercfg output change, or a locale whose index lines we can't parse),
    // REFUSE rather than record a guessed (1,1): a fabricated snapshot would roll the
    // setting back to the wrong value, breaking rollback-first integrity. Fail-safe,
    // matching the plan-GUID guard just below and the core-parking / TCP readers.
    let (prior_ac_value, prior_dc_value) = query_power_setting_ac_dc(subgroup, setting)
        .ok_or_else(|| {
            "could not read the current power setting to snapshot it for rollback; \
             refusing to apply rather than record a guessed prior value"
                .to_string()
        })?;
    // Capture the EXACT plan this is applied to. Refuse to apply if we can't —
    // a change whose target plan we don't know is a change we can't honestly
    // roll back, and rollback-first beats applying-anyway.
    let plan_guid = current_power_plan_guid().ok_or_else(|| {
        "could not determine the active power plan; refusing to apply a change that could not be rolled back".to_string()
    })?;

    // Apply AC = 0 only. DC stays untouched (laptop battery behavior preserved).
    ps_safe(subgroup)?;
    ps_safe(setting)?;
    run_elevated_powershell(&power_setting_apply_script(subgroup, setting, prior_ac_value))?;

    let applied_action = if setting == PWR_SETTING_USB_SELECTIVE_SUSPEND {
        AppliedAction::DisableUsbSelectiveSuspendOnAc
    } else {
        AppliedAction::DisablePcieAspmOnAc
    };

    Ok(ApplyResult {
        applied_action,
        rollback_action: RollbackAction::RestorePowerPlanSettingFromSnapshot,
        snapshot: Snapshot::PowerPlanSetting {
            plan_guid,
            subgroup_guid: subgroup.to_string(),
            setting_guid: setting.to_string(),
            prior_ac_value,
            prior_dc_value,
        },
        elevation_used: true,
    })
}

/// The AC-off apply script (setacvalueindex 0, then setactive), all-or-nothing (issue 617): both
/// powercfg steps check their exit status (a non-zero exit does not throw on its own), and a failed
/// setactive puts the AC index back to `prior_ac` inside the same elevation. Callers pass GUIDs that
/// already passed `ps_safe`. Kill-mid-apply residual: the AC index may stay 0 with no receipt.
pub(crate) fn power_setting_apply_script(subgroup: &str, setting: &str, prior_ac: u32) -> String {
    ps_all_or_restore(&[
        PsStep {
            write: format!("powercfg /setacvalueindex SCHEME_CURRENT {subgroup} {setting} 0"),
            undo: format!("powercfg /setacvalueindex SCHEME_CURRENT {subgroup} {setting} {prior_ac}"),
            native: true,
        },
        PsStep {
            write: "powercfg /setactive SCHEME_CURRENT".to_string(),
            undo: String::new(),
            native: true,
        },
    ])
}

pub(crate) fn apply_usb_selective_suspend_off() -> Result<ApplyResult, String> {
    apply_power_setting_off_on_ac(PWR_SUBGROUP_USB, PWR_SETTING_USB_SELECTIVE_SUSPEND)
}

pub(crate) fn apply_pcie_aspm_off() -> Result<ApplyResult, String> {
    apply_power_setting_off_on_ac(PWR_SUBGROUP_PCIE, PWR_SETTING_PCIE_ASPM)
}

// ─── Non-elevated power-plan switch/restore for Gaming Mode (session core) ─
//
// `powercfg /setactive <existing-guid>` does NOT require admin for an already-
// installed scheme — so the Gaming Mode CORE tier stays UAC-free. We NEVER
// create/duplicate a plan here (that needs elevation): if no high-perf plan
// exists, we skip with no error. Rollback-first: if we can't capture a valid
// prior plan GUID, we don't switch at all (a change we can't restore is a
// change we don't make).

/// PURE. Pick the best existing high-perf plan GUID from `powercfg /list`
/// stdout: Ultimate Performance > High performance > None.
pub(crate) fn select_best_existing_high_perf_plan(list_stdout: &str) -> Option<String> {
    let mut high: Option<String> = None;
    for line in list_stdout.lines() {
        let lower = line.to_lowercase();
        let guid = line.find("GUID:").and_then(|i| {
            line[i + 5..]
                .split_whitespace()
                .next()
                .map(|g| g.trim().to_string())
        });
        let Some(g) = guid.filter(|g| g.len() == 36) else {
            continue;
        };
        if lower.contains("ultimate performance") {
            return Some(g); // best — return immediately
        }
        if lower.contains("high performance") && high.is_none() {
            high = Some(g);
        }
    }
    high
}

fn list_power_plans_stdout() -> Option<String> {
    let out = quiet_command("powercfg").args(["/list"]).output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// NON-ELEVATED `powercfg /setactive`. A non-zero exit (which is what happens
/// if the OS unexpectedly requires elevation) surfaces as Err — we never
/// silently elevate.
fn powercfg_setactive_unelevated(guid: &str) -> Result<(), String> {
    let out = quiet_command("powercfg")
        .args(["/setactive", guid])
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(format!(
            "powercfg /setactive failed: {}",
            String::from_utf8_lossy(&out.stderr).trim()
        ))
    }
}

/// CORE (UAC-free) power-plan switch. Switches to the best existing high-perf
/// plan, capturing the prior GUID for an exact restore. Returns Ok(None) — a
/// clean skip, no error — when there's no valid prior plan to restore to, no
/// existing high-perf plan to switch to, or we're already on it.
pub(crate) fn apply_power_plan_switch_core() -> Result<Option<ApplyResult>, String> {
    let prior_guid = current_power_plan_guid().unwrap_or_default();
    if prior_guid.trim().len() != 36 {
        return Ok(None); // can't capture a restorable prior plan -> don't switch
    }
    let list = list_power_plans_stdout().ok_or("powercfg /list failed")?;
    let Some(target) = select_best_existing_high_perf_plan(&list) else {
        return Ok(None); // no existing high-perf plan -> skip, stay UAC-free
    };
    if target.eq_ignore_ascii_case(prior_guid.trim()) {
        return Ok(None); // already active -> nothing to change or restore
    }
    powercfg_setactive_unelevated(&target)?;
    Ok(Some(ApplyResult {
        applied_action: AppliedAction::SetUltimatePerformancePlan,
        rollback_action: RollbackAction::RestorePowerPlanFromSnapshot,
        snapshot: Snapshot::PowerPlan { prior_guid },
        elevation_used: false,
    }))
}

/// NON-ELEVATED restore of the prior plan. Fails loudly if the plan vanished;
/// never silently elevates, never falls back to SCHEME_CURRENT.
pub(crate) fn restore_power_plan_unelevated(prior_guid: &str) -> Result<(), String> {
    let g = prior_guid.trim();
    if g.len() != 36 {
        return Err("no valid prior plan GUID in snapshot".into());
    }
    if !power_plan_exists(g) {
        return Err(format!("prior power plan {} no longer exists", g));
    }
    powercfg_setactive_unelevated(g)
}

#[cfg(test)]
mod gaming_power_tests {
    use super::select_best_existing_high_perf_plan;

    #[test]
    fn selects_ultimate_over_high_performance() {
        let list = "Existing Power Schemes (* Active)\n\
Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced) *\n\
Power Scheme GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (High performance)\n\
Power Scheme GUID: e9a42b02-d5df-448d-aa00-03f14749eb61  (Ultimate Performance)\n";
        assert_eq!(
            select_best_existing_high_perf_plan(list).as_deref(),
            Some("e9a42b02-d5df-448d-aa00-03f14749eb61")
        );
    }

    #[test]
    fn falls_back_to_high_performance() {
        let list = "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced) *\n\
Power Scheme GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (High performance)\n";
        assert_eq!(
            select_best_existing_high_perf_plan(list).as_deref(),
            Some("8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c")
        );
    }

    #[test]
    fn none_when_only_balanced() {
        let list = "Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced) *\n";
        assert_eq!(select_best_existing_high_perf_plan(list), None);
    }

    #[test]
    fn the_active_plan_is_read_by_the_guid_shape_whatever_language_labels_it() {
        // P4-noise-sf: `/getactivescheme` labels the GUID in the user's language; the read keys on the
        // GUID's own shape, never on the English "GUID:".
        use super::active_plan_guid_of;
        const BAL: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";
        for out in [
            format!("Power Scheme GUID: {BAL}  (Balanced)\r\n"),
            format!("GUID des Energieschemas: {BAL}  (Ausbalanciert)\r\n"),
            format!("电源方案 GUID：{BAL}  (平衡)\r\n"),
            format!("Schéma de gestion de l'alimentation GUID : {}  (Utilisation normale)\r\n", BAL.to_uppercase()),
        ] {
            assert_eq!(active_plan_guid_of(&out).as_deref(), Some(BAL), "{out}");
        }
        assert_eq!(active_plan_guid_of("Power Scheme GUID: not-a-guid  (Balanced)\r\n"), None);
        assert_eq!(active_plan_guid_of(""), None);
    }
}

/// True if `guid` is a currently-installed power scheme. Read-only `powercfg
/// /list`, no elevation — so we can fail safe before ever prompting for UAC.
fn power_plan_exists(guid: &str) -> bool {
    let g = guid.trim();
    if g.is_empty() {
        return false;
    }
    quiet_command("powercfg")
        .args(["/list"])
        .output()
        .ok()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .to_lowercase()
                .contains(&g.to_lowercase())
        })
        .unwrap_or(false)
}

/// Pure: build the powercfg restore command for one power-plan setting,
/// targeting the EXACT stored plan GUID (never SCHEME_CURRENT, which may be a
/// different plan at rollback time). `reactivate` re-commits the change live
/// only when that plan is the active one — restoring a non-active plan writes
/// its saved value without yanking the user onto it.
fn build_power_setting_restore_cmd(
    plan_guid: &str,
    subgroup_guid: &str,
    setting_guid: &str,
    prior_ac_value: u32,
    prior_dc_value: u32,
    reactivate: bool,
) -> String {
    let mut cmd = format!(
        "powercfg /setacvalueindex {0} {1} {2} {3}; \
         powercfg /setdcvalueindex {0} {1} {2} {4}",
        plan_guid, subgroup_guid, setting_guid, prior_ac_value, prior_dc_value
    );
    if reactivate {
        cmd.push_str(&format!("; powercfg /setactive {}", plan_guid));
    }
    cmd
}

pub(crate) fn rollback_power_plan_setting_typed(
    plan_guid: &str,
    subgroup_guid: &str,
    setting_guid: &str,
    prior_ac_value: u32,
    prior_dc_value: u32,
) -> Result<(), String> {
    // These three GUIDs are read straight back out of the persisted (user-writable) history.json
    // snapshot at rollback time and then interpolated UNQUOTED into an elevated powercfg command
    // (build_power_setting_restore_cmd). Validate them the same way the apply path validates its
    // subgroup/setting (apply_power_setting_off_on_ac) and rollback_power_ultimate_typed validates
    // its prior GUID — a tampered/garbled ledger entry must fail loud BEFORE it can reach the
    // elevated command line, never inject shell metacharacters. Every legitimate value is a bare
    // `[0-9a-f-]` GUID, which ps_safe admits.
    ps_safe(plan_guid)?;
    ps_safe(subgroup_guid)?;
    ps_safe(setting_guid)?;
    // Restore AC/DC to the EXACT plan this was applied to. If that plan no
    // longer exists (deleted, or never captured), fail safe with a clear
    // message — we will NOT silently restore the value onto whatever plan
    // happens to be active now (e.g. after the user switched plans, or rolled
    // back Ultimate Performance first). Restoring to the wrong plan would make
    // the snapshot a quiet lie.
    if !power_plan_exists(plan_guid) {
        return Err(format!(
            "cannot roll this back: the power plan it was applied to ({}) no longer exists. \
             Compy will not restore the value to a different plan — reselect or recreate that \
             plan and try again.",
            if plan_guid.trim().is_empty() {
                "unknown".to_string()
            } else {
                plan_guid.to_string()
            }
        ));
    }
    // Only re-activate (commit live) if the restored plan is the active one.
    let reactivate = current_power_plan_guid()
        .map(|g| g.eq_ignore_ascii_case(plan_guid.trim()))
        .unwrap_or(false);
    let cmd = build_power_setting_restore_cmd(
        plan_guid,
        subgroup_guid,
        setting_guid,
        prior_ac_value,
        prior_dc_value,
        reactivate,
    );
    run_elevated_powershell(&cmd)?;
    Ok(())
}

// ─── Energy Efficient Ethernet off (active wired NIC, vendor naming) ─────
//
// EEE shows up under many vendor-driver display names: "Energy Efficient
// Ethernet" (standard), "Energy-Efficient Ethernet", "Green Ethernet"
// (Realtek), "Advanced EEE" (some Realtek), "EEE" (Intel/Killer), etc.
// We use a regex match on the property display name to handle this without
// hardcoding the per-vendor list.
//
// Eligibility filter (per cross-LLM review):
//   - Status -eq 'Up'                      (link is actually up)
//   - PhysicalMediaType -eq '802.3'        (wired Ethernet, not Wi-Fi)
//   - Property must actually exist          (Get-NetAdapterAdvancedProperty)
// Wi-Fi, Bluetooth, virtual adapters, and adapters where no EEE-shaped
// property exists are all excluded automatically.

/// One EEE-shaped advanced property on an Up wired adapter, with the driver's accepted values so
/// the apply can pick the REAL "disabled" token instead of assuming the literal "Disabled" (drivers
/// vary: "Off", "Disable", localized strings — the tester-found apply failure, 2026-06-10).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct EeeProperty {
    pub adapter_name: String,
    pub display_name: String,
    pub current_value: String,
    /// `ValidDisplayValues` from the driver; empty when the driver doesn't report them.
    pub valid_values: Vec<String>,
}

// Vendor-name coverage: display names AND registry keywords (the INF-standardized `*EEE` plus the
// common vendor keywords) — either match qualifies. Extend from real tester adapter inventories
// (Export → network adapter section), never by guessing.
const EEE_DISPLAY_NAME_PATTERN: &str =
    "Energy[- ]?Efficient[- ]?Ethernet|Green Ethernet|Advanced EEE|^EEE$|EEE PHY|802\\.3az";
const EEE_REGISTRY_KEYWORD_PATTERN: &str =
    "^\\*?EEE$|EEELink|GigaEEE|EnergyEfficientEthernet|AdvancedEEE";

/// How EEE resolves on this rig — drives honest gating (never offer an apply that can only fail).
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum EeeResolution {
    /// No Up, wired adapter exposes an EEE-shaped property at all.
    NoEligibleAdapter,
    /// EEE-shaped properties exist, but none offers a value Compy recognizes as "disabled" —
    /// we will not guess at a driver's vocabulary.
    NoDisableSwitch,
    /// Properties Compy can safely flip (every entry has a pickable disabled value).
    Ready(Vec<EeeProperty>),
}

/// PURE: parse enumeration output lines `adapter|displayName|currentValue|valid~values~list`.
/// Malformed lines are skipped (defensive — PS output is process output, not a trusted file).
pub(crate) fn parse_eee_property_lines(stdout: &str) -> Vec<EeeProperty> {
    stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(4, '|').collect();
            if parts.len() != 4 {
                return None;
            }
            Some(EeeProperty {
                adapter_name: parts[0].trim().to_string(),
                display_name: parts[1].trim().to_string(),
                current_value: parts[2].trim().to_string(),
                valid_values: parts[3]
                    .split('~')
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty())
                    .collect(),
            })
        })
        .collect()
}

/// PURE: the driver's "disabled" token, by preference order, case-insensitive. None = the driver's
/// vocabulary has nothing Compy recognizes as off — honesty says gate, not guess.
pub(crate) fn pick_disabled_value(valid_values: &[String]) -> Option<String> {
    for pref in ["disabled", "disable", "off", "0"] {
        if let Some(v) = valid_values.iter().find(|v| v.trim().eq_ignore_ascii_case(pref)) {
            return Some(v.trim().to_string());
        }
    }
    None
}

/// PURE: the value the apply would write for this property. Empty valid-values (driver didn't
/// report them) falls back to the literal "Disabled" — the long-standing behavior for drivers
/// that don't enumerate; a NON-empty list without a recognized token returns None (we KNOW
/// "Disabled" isn't accepted — that write is the tester-found false-cancel failure).
pub(crate) fn eee_disable_value_for(p: &EeeProperty) -> Option<String> {
    if p.valid_values.is_empty() {
        return Some("Disabled".to_string());
    }
    pick_disabled_value(&p.valid_values)
}

/// PURE: is this property currently in its disabled state? Honest comparator — matches the
/// driver's own disabled token when known, plus the universal disabled-ish spellings; never
/// assumes the English "Disabled" is the only truth (the tester-found misread).
pub(crate) fn eee_value_is_disabled(p: &EeeProperty) -> bool {
    let cur = p.current_value.trim();
    if cur.to_lowercase().contains("disab") || cur.eq_ignore_ascii_case("off") || cur == "0" {
        return true;
    }
    eee_disable_value_for(p)
        .map(|v| cur.eq_ignore_ascii_case(&v))
        .unwrap_or(false)
}

/// PURE: classify a set of enumerated properties (split from the live probe for tests).
pub(crate) fn resolve_eee_from(props: Vec<EeeProperty>) -> EeeResolution {
    if props.is_empty() {
        return EeeResolution::NoEligibleAdapter;
    }
    let ready: Vec<EeeProperty> = props
        .into_iter()
        .filter(|p| eee_disable_value_for(p).is_some())
        .collect();
    if ready.is_empty() {
        EeeResolution::NoDisableSwitch
    } else {
        EeeResolution::Ready(ready)
    }
}

/// Live enumeration + classification. Eligibility filter unchanged from the cross-LLM review
/// (Status Up · PhysicalMediaType 802.3 · property exists); matching is broadened to display-name
/// OR registry-keyword, and the driver's ValidDisplayValues ride along for honest value picking.
pub(crate) fn resolve_eee() -> EeeResolution {
    let ps = format!(
        r#"
$adapters = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {{
    $_.Status -eq 'Up' -and $_.PhysicalMediaType -eq '802.3'
}}
foreach ($a in $adapters) {{
    $props = Get-NetAdapterAdvancedProperty -Name $a.Name -ErrorAction SilentlyContinue |
        Where-Object {{ $_.DisplayName -match '{names}' -or ($_.RegistryKeyword -and $_.RegistryKeyword -match '{keywords}') }}
    foreach ($p in $props) {{
        $valid = @($p.ValidDisplayValues) -join '~'
        Write-Output ($a.Name + '|' + $p.DisplayName + '|' + $p.DisplayValue + '|' + $valid)
    }}
}}
"#,
        names = EEE_DISPLAY_NAME_PATTERN,
        keywords = EEE_REGISTRY_KEYWORD_PATTERN,
    );
    let output = quiet_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &ps])
        .output();
    let stdout = match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).into_owned(),
        Err(_) => return EeeResolution::NoEligibleAdapter,
    };
    resolve_eee_from(parse_eee_property_lines(&stdout))
}

/// PURE: build the apply script from (property, picked-disabled-value) pairs. The trailing
/// `$null = 0` makes the script's exit code deterministic-success: a per-pair SilentlyContinue
/// failure must never bleed into the host exit code and masquerade as an elevation problem (the
/// false-cancel chain) — detection recomputes the real state afterwards and stays honest. NEVER
/// `exit` here: eee-disable is safe-tier batchable and the §4 composition rule bans it.
pub(crate) fn build_eee_apply_script(targets: &[(EeeProperty, String)]) -> String {
    let mut ps = String::new();
    for (p, value) in targets {
        ps.push_str(&format!(
            "Set-NetAdapterAdvancedProperty -Name '{}' -DisplayName '{}' -DisplayValue '{}' -NoRestart -ErrorAction SilentlyContinue; ",
            p.adapter_name.replace('\'', "''"),
            p.display_name.replace('\'', "''"),
            value.replace('\'', "''"),
        ));
    }
    ps.push_str("$null = 0");
    ps
}

/// Issue 617 assessment: every per-NIC write is SilentlyContinue and the apply always returns Ok
/// with the full snapshot, so any partial state is always receipted and rollback-able.
pub(crate) fn apply_eee_disable() -> Result<ApplyResult, String> {
    let props = match resolve_eee() {
        EeeResolution::NoEligibleAdapter => {
            return Err(
                "No active wired Ethernet adapter exposes an Energy-Efficient-Ethernet property — nothing to change on this rig."
                    .into(),
            )
        }
        EeeResolution::NoDisableSwitch => {
            return Err(
                "This adapter's driver exposes EEE, but not a 'Disabled'-style value Compy recognizes — left untouched rather than guessing at the driver's vocabulary."
                    .into(),
            )
        }
        EeeResolution::Ready(props) => props,
    };

    // Pair each property with ITS driver's disabled token (Ready guarantees one exists), and
    // snapshot prior state BEFORE the mutation — same 3-field snapshot shape as ever.
    let targets: Vec<(EeeProperty, String)> = props
        .into_iter()
        .filter_map(|p| eee_disable_value_for(&p).map(|v| (p, v)))
        .collect();
    let adapters: Vec<EeeNicSnapshot> = targets
        .iter()
        .map(|(p, _)| EeeNicSnapshot {
            adapter_name: p.adapter_name.clone(),
            property_display_name: p.display_name.clone(),
            prior_value: p.current_value.clone(),
        })
        .collect();

    let ps = build_eee_apply_script(&targets);
    run_elevated_powershell(&ps)
        .map_err(|e| format!("Couldn't change Energy Efficient Ethernet — {}", e))?;

    Ok(ApplyResult {
        applied_action: AppliedAction::DisableEnergyEfficientEthernet,
        rollback_action: RollbackAction::RestoreEnergyEfficientEthernetFromSnapshot,
        snapshot: Snapshot::EeeNicProperty { adapters },
        elevation_used: true,
    })
}

/// PURE: build the ROLLBACK script from the snapshot. Extracted (2026-08-18) so the restore path
/// is testable the way the apply path already was — under rollback-first integrity the undo deserves
/// at least the coverage of the do, and this half was only ever asserted through the elevated call.
///
/// WHY THIS ESCAPES RATHER THAN REFUSES. Everywhere else in this file a token bound for an elevated
/// command is REFUSED by `ps_safe` / `ps_safe_squoted` if it carries anything outside a documented
/// alphabet. Here the tokens are adapter names, driver property names and the driver's own prior
/// value strings — vendor text Compy did not choose and cannot constrain, read back out of a
/// snapshot. Refusing an apostrophe would make a legitimately-named NIC UNROLLBACKABLE, a worse
/// failure than the one it prevents. Inside a PowerShell single-quoted literal the ONLY
/// metacharacter is `'`, and doubling it is the complete, documented escape — so the safety here
/// rests on a proof rather than an alphabet: `eee_scripts_never_break_out_of_their_quotes` fuzzes
/// both builders and re-parses the emitted script back to the exact input tokens.
pub(crate) fn build_eee_rollback_script(adapters: &[EeeNicSnapshot]) -> String {
    let mut ps = String::new();
    for a in adapters {
        ps.push_str(&format!(
            "Set-NetAdapterAdvancedProperty -Name '{}' -DisplayName '{}' -DisplayValue '{}' -NoRestart -ErrorAction SilentlyContinue; ",
            a.adapter_name.replace('\'', "''"),
            a.property_display_name.replace('\'', "''"),
            a.prior_value.replace('\'', "''"),
        ));
    }
    // Same deterministic-exit-0 tail as the apply: a silently-skipped pair must never read as an
    // elevation failure (restored values come from the snapshot = the driver's own prior strings).
    ps.push_str("$null = 0");
    ps
}

pub(crate) fn rollback_eee_disable_typed(adapters: &[EeeNicSnapshot]) -> Result<(), String> {
    if adapters.is_empty() {
        return Err("snapshot had no EEE adapters to roll back".into());
    }
    let ps = build_eee_rollback_script(adapters);
    run_elevated_powershell(&ps)
        .map_err(|e| format!("Couldn't restore Energy Efficient Ethernet — {}", e))?;
    Ok(())
}


// ─── Fast Startup off (HKLM, admin) ──────────────────────────────────────

pub(crate) fn apply_fast_startup_off() -> Result<ApplyResult, String> {
    // Refuse if the Power key is unreadable rather than snapshotting a guessed None: a None prior
    // makes rollback DELETE HiberbootEnabled (Windows default = ON), which would silently re-enable
    // Fast Startup on a rig that had it explicitly off. A genuinely-absent value stays Ok(None) and
    // rollback-delete remains the faithful inverse. Mirrors the power-setting refuse discipline.
    let prior_hiberboot = fast_startup_state_checked()?;
    run_elevated_powershell(
        "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power' -Name 'HiberbootEnabled' -Value 0 -Type DWord",
    )?;
    Ok(ApplyResult {
        applied_action: AppliedAction::DisableFastStartup,
        rollback_action: RollbackAction::RestoreFastStartupFromSnapshot,
        snapshot: Snapshot::FastStartup { prior_hiberboot },
        elevation_used: true,
    })
}

pub(crate) fn rollback_fast_startup_off_typed(prior_hiberboot: Option<u32>) -> Result<(), String> {
    let cmd = match prior_hiberboot {
        Some(v) => format!(
            "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power' -Name 'HiberbootEnabled' -Value {} -Type DWord",
            v
        ),
        None => "Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power' -Name 'HiberbootEnabled' -ErrorAction SilentlyContinue".to_string(),
    };
    run_elevated_powershell(&cmd)?;
    Ok(())
}

// ─── Game Bar / Game DVR off (HKCU, no admin) ────────────────────────────

const GAMEDVR_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR";
const GAME_CONFIG_STORE_KEY: &str = "System\\GameConfigStore";

/// Two HKCU writes, all-or-nothing via `hkcu_write_all_or_restore` (issue 617). Kill-mid-apply
/// residual: AppCaptureEnabled may stay 0 with no receipt.
pub(crate) fn apply_game_bar_disable() -> Result<ApplyResult, String> {
    apply_game_bar_disable_with(&mut RealHkcu)
}

fn apply_game_bar_disable_with(reg: &mut dyn HkcuValues) -> Result<ApplyResult, String> {
    let snapshot = hkcu_write_all_or_restore(
        reg,
        &[
            HkcuWrite { subkey: GAMEDVR_KEY, name: "AppCaptureEnabled", value: reg_dword(0) },
            HkcuWrite { subkey: GAME_CONFIG_STORE_KEY, name: "GameDVR_Enabled", value: reg_dword(0) },
        ],
        |p| {
            Ok(Snapshot::GameBar {
                prior_capture: prior_dword("AppCaptureEnabled", &p[0])?,
                prior_enabled: prior_dword("GameDVR_Enabled", &p[1])?,
            })
        },
    )?;

    Ok(ApplyResult {
        applied_action: AppliedAction::DisableGameBarAndDvr,
        rollback_action: RollbackAction::RestoreGameBarFromSnapshot,
        snapshot,
        elevation_used: false,
    })
}

pub(crate) fn rollback_game_bar_disable_typed(
    prior_capture: Option<u32>,
    prior_enabled: Option<u32>,
) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let gd = hkcu
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR",
            KEY_SET_VALUE | KEY_READ,
        )
        .map_err(|e| e.to_string())?;
    match prior_capture {
        Some(v) => gd
            .set_value("AppCaptureEnabled", &v)
            .map_err(|e| e.to_string())?,
        None => {
            let _ = gd.delete_value("AppCaptureEnabled");
        }
    }

    let gcs = hkcu
        .open_subkey_with_flags("System\\GameConfigStore", KEY_SET_VALUE | KEY_READ)
        .map_err(|e| e.to_string())?;
    match prior_enabled {
        Some(v) => gcs
            .set_value("GameDVR_Enabled", &v)
            .map_err(|e| e.to_string())?,
        None => {
            let _ = gcs.delete_value("GameDVR_Enabled");
        }
    }
    Ok(())
}

// ─── HAGS (HKLM, admin) ──────────────────────────────────────────────────

pub(crate) fn apply_hags_enable() -> Result<ApplyResult, String> {
    // Refuse if the GraphicsDrivers key is unreadable rather than snapshotting a guessed None:
    // a None prior makes rollback DELETE HwSchMode, which would discard a rig's explicit setting
    // (e.g. HAGS deliberately off) and let the driver default take over. A genuinely-absent value
    // stays Ok(None) and rollback-delete remains faithful. Mirrors apply_fast_startup_off.
    let prior = hags_state_checked()?;
    run_elevated_powershell(
        "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'HwSchMode' -Value 2 -Type DWord",
    )?;
    Ok(ApplyResult {
        applied_action: AppliedAction::EnableHardwareGpuScheduling,
        rollback_action: RollbackAction::RestoreHwSchModeFromSnapshot,
        snapshot: Snapshot::HwSchMode { prior },
        elevation_used: true,
    })
}

pub(crate) fn rollback_hags_enable_typed(prior: Option<u32>) -> Result<(), String> {
    let cmd = match prior {
        Some(v) => format!(
            "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'HwSchMode' -Value {} -Type DWord",
            v
        ),
        None => "Remove-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'HwSchMode' -ErrorAction SilentlyContinue".to_string(),
    };
    run_elevated_powershell(&cmd)?;
    Ok(())
}

// ─── Leftovers v2 restore resolvers (R2-5 — ARMED 2026-07-16) ──────────────────
//
// Built dark on two independent layers (gate false + no Tauri command); ARMED 2026-07-16 after
// the owner-present live-UAC QA (history::manual_restore_qa — W32PS/MPO/memcompress full loops
// PASS). They ride the same audited contract as every apply:
// snapshot BEFORE mutation, ONE elevated PS per restore (no partial mutation), fail-loud rollback,
// and the snapshot holds the user's rotted value so the restore itself is reversible.
// Script builders are PURE so their content is unit-testable without elevation. All interpolated
// values are u32 integers, plus ONE sanctioned non-integer: the app-derived, single-quote-escaped
// result-file path in the memcompress combined script (the §4 batch-receipts precedent — data out,
// never input in).
//
// Deliberately ABSENT: a Defender-policy resolver. Writing HKLM\...\Policies is the absolute
// security-settings rail — even a restore-to-stock goes through the owner, never autonomous code.

// ── Startup-entry approval (HKCU) ────────────────────────────────────────────────────────────────
// Windows records "may this Run entry start?" as a raw value under StartupApproved\Run. Byte 0 is
// the state (0x02 enabled / 0x03 disabled); the bytes AFTER it are a disable timestamp Windows
// itself wrote.
//
// Until 2026-08-03 this lived in lib.rs, outside the mutation boundary: no snapshot, no receipt, no
// rollback — and it wrote a SYNTHESISED 12-byte value with a zeroed tail. That did not merely skip
// the ledger, it destroyed the bytes Windows had put there, so the prior value could not be restored
// even in principle. Both halves are fixed here: the tail is preserved, and the exact prior value is
// captured into a typed Snapshot so rollback is byte-for-byte.
pub(crate) const STARTUP_APPROVED_RUN_KEY: &str =
    "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";

const STARTUP_APPROVAL_LEN: usize = 12;
const STARTUP_APPROVAL_ENABLED: u8 = 0x02;
const STARTUP_APPROVAL_DISABLED: u8 = 0x03;

/// Pure: the bytes to write, given the EXACT prior value (if any) and the desired state. Preserves
/// every byte after byte 0 when a prior exists — that tail is Windows' own timestamp, and the
/// pre-fix code discarded it. A short/empty prior is padded rather than trusted blindly.
pub(crate) fn compose_startup_approval_bytes(prior: Option<&[u8]>, enabled: bool) -> Vec<u8> {
    let flag = if enabled {
        STARTUP_APPROVAL_ENABLED
    } else {
        STARTUP_APPROVAL_DISABLED
    };
    let mut bytes = match prior {
        Some(p) if !p.is_empty() => p.to_vec(),
        _ => vec![0u8; STARTUP_APPROVAL_LEN],
    };
    if bytes.len() < STARTUP_APPROVAL_LEN {
        bytes.resize(STARTUP_APPROVAL_LEN, 0);
    }
    bytes[0] = flag;
    bytes
}

/// Pure, the reader's half of the byte meaning [`compose_startup_approval_bytes`] writes: does this
/// StartupApproved\Run value say the entry may start? Only a REG_BINARY value whose byte 0 is one of
/// the two flags Compy writes has an answer; any other type or byte is None, never a guess. An
/// ABSENT value is the caller's case (Windows' default, enabled), not this one's.
pub(crate) fn startup_approval_enabled(value: &winreg::RegValue) -> Option<bool> {
    if value.vtype != winreg::enums::RegType::REG_BINARY {
        return None;
    }
    match value.bytes.first() {
        Some(&STARTUP_APPROVAL_ENABLED) => Some(true),
        Some(&STARTUP_APPROVAL_DISABLED) => Some(false),
        _ => None,
    }
}

/// Explicit, dependency-free reverse map for the registry value type we captured. Anything we did
/// not enumerate restores as REG_BINARY, which is what this key actually holds.
fn startup_reg_type_from_u32(value: u32) -> winreg::enums::RegType {
    use winreg::enums::RegType;
    match value {
        0 => RegType::REG_NONE,
        1 => RegType::REG_SZ,
        2 => RegType::REG_EXPAND_SZ,
        4 => RegType::REG_DWORD,
        5 => RegType::REG_DWORD_BIG_ENDIAN,
        6 => RegType::REG_LINK,
        7 => RegType::REG_MULTI_SZ,
        11 => RegType::REG_QWORD,
        _ => RegType::REG_BINARY,
    }
}

/// Toggle one startup entry, capturing a restorable prior. Refuses when the prior cannot be READ:
/// a prior we cannot prove is not a prior we can promise to restore, and a silent overwrite here is
/// exactly the defect this replaced.
pub(crate) fn apply_startup_entry_enabled(name: &str, enabled: bool) -> Result<ApplyResult, String> {
    if name.trim().is_empty() {
        return Err("A startup entry name is required.".to_string());
    }
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(STARTUP_APPROVED_RUN_KEY)
        .map_err(|e| e.to_string())?;
    let (prior_bytes, prior_vtype) = match key.get_raw_value(name) {
        Ok(v) => (Some(v.bytes), Some(v.vtype as u32)),
        // Genuinely absent is a real, restorable prior: Windows treats "no approval value" as
        // enabled, and rollback deletes the value again.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => (None, None),
        Err(e) => {
            return Err(format!(
                "Could not read the current startup approval for '{}': {}. Nothing was changed.",
                name, e
            ))
        }
    };
    let bytes = compose_startup_approval_bytes(prior_bytes.as_deref(), enabled);
    key.set_raw_value(
        name,
        &winreg::RegValue {
            bytes,
            vtype: winreg::enums::RegType::REG_BINARY,
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(ApplyResult {
        applied_action: AppliedAction::SetStartupEntryEnabled {
            name: name.to_string(),
            enabled,
        },
        rollback_action: RollbackAction::RestoreStartupApprovalFromSnapshot,
        snapshot: Snapshot::StartupApproval {
            name: name.to_string(),
            prior_bytes,
            prior_vtype,
        },
        elevation_used: false,
    })
}

/// Byte-for-byte restore. `None` prior means the value did not exist → delete it, returning the
/// entry to "no approval recorded" rather than inventing an enabled marker.
fn rollback_startup_approval_typed(
    name: &str,
    prior_bytes: Option<&Vec<u8>>,
    prior_vtype: Option<u32>,
) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey(STARTUP_APPROVED_RUN_KEY)
        .map_err(|e| e.to_string())?;
    match prior_bytes {
        Some(bytes) => key
            .set_raw_value(
                name,
                &winreg::RegValue {
                    bytes: bytes.clone(),
                    vtype: startup_reg_type_from_u32(prior_vtype.unwrap_or(3)),
                },
            )
            .map_err(|e| e.to_string()),
        None => match key.delete_value(name) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.to_string()),
        },
    }
}

fn mmcss_path() -> &'static str {
    "HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Multimedia\\SystemProfile"
}
fn priority_control_path() -> &'static str {
    "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\PriorityControl"
}

fn set_or_remove_dword(path: &str, name: &str, value: Option<u32>) -> String {
    match value {
        Some(v) => format!("Set-ItemProperty -Path '{path}' -Name '{name}' -Value {v} -Type DWord"),
        None => format!(
            "Remove-ItemProperty -Path '{path}' -Name '{name}' -ErrorAction SilentlyContinue"
        ),
    }
}

// The stock-value pair the apply writes; the apply itself goes through `mmcss_apply_script`.
#[cfg(test)]
pub(crate) fn mmcss_restore_script() -> String {
    // Windows stock: SystemResponsiveness 20 · NetworkThrottlingIndex 10.
    format!(
        "{}; {}",
        set_or_remove_dword(mmcss_path(), "SystemResponsiveness", Some(20)),
        set_or_remove_dword(mmcss_path(), "NetworkThrottlingIndex", Some(10)),
    )
}
/// The restore-to-stock apply script: SystemResponsiveness 20 then NetworkThrottlingIndex 10, and
/// if the second write fails the first is put back to `prior_sr` inside the same elevation (issue
/// 617). An absent prior is undone with a STRICT Remove-ItemProperty (no SilentlyContinue), so a
/// failed undo is seen. Kill-mid-apply residual: SystemResponsiveness may stay 20 with no receipt.
pub(crate) fn mmcss_apply_script(prior_sr: Option<u32>) -> String {
    let undo_sr = match prior_sr {
        Some(v) => set_or_remove_dword(mmcss_path(), "SystemResponsiveness", Some(v)),
        None => format!(
            "Remove-ItemProperty -Path '{}' -Name 'SystemResponsiveness'",
            mmcss_path()
        ),
    };
    ps_all_or_restore(&[
        PsStep {
            write: set_or_remove_dword(mmcss_path(), "SystemResponsiveness", Some(20)),
            undo: undo_sr,
            native: false,
        },
        PsStep {
            write: set_or_remove_dword(mmcss_path(), "NetworkThrottlingIndex", Some(10)),
            undo: String::new(),
            native: false,
        },
    ])
}
pub(crate) fn mmcss_rollback_script(sr: Option<u32>, nti: Option<u32>) -> String {
    format!(
        "{}; {}",
        set_or_remove_dword(mmcss_path(), "SystemResponsiveness", sr),
        set_or_remove_dword(mmcss_path(), "NetworkThrottlingIndex", nti),
    )
}
pub(crate) fn priority_separation_restore_script() -> String {
    set_or_remove_dword(priority_control_path(), "Win32PrioritySeparation", Some(2))
}
pub(crate) fn priority_separation_rollback_script(prior: Option<u32>) -> String {
    set_or_remove_dword(priority_control_path(), "Win32PrioritySeparation", prior)
}

/// Read both MMCSS priors directly (HKLM reads need no elevation). Err = the KEY itself was
/// unreadable — the apply refuses rather than mutating what it couldn't snapshot. An absent
/// value is a legitimate prior (rollback deletes it).
fn read_mmcss_priors() -> Result<(Option<u32>, Option<u32>), String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    let path = r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile";
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok((None, None)),
        Err(e) => Err(format!("cannot snapshot MMCSS values: {e}")),
        Ok(k) => Ok((
            k.get_value::<u32, _>("SystemResponsiveness").ok(),
            k.get_value::<u32, _>("NetworkThrottlingIndex").ok(),
        )),
    }
}

fn read_priority_separation_prior() -> Result<Option<u32>, String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SYSTEM\CurrentControlSet\Control\PriorityControl") {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot snapshot Win32PrioritySeparation: {e}")),
        Ok(k) => Ok(k.get_value::<u32, _>("Win32PrioritySeparation").ok()),
    }
}

/// Restore memory compression to the Windows default (ON). Takes the prior explicitly so the
/// refusal contract is unit-testable: an UNREADABLE prior refuses BEFORE any elevation — never
/// mutate what couldn't be snapshotted (rollback-first integrity).
pub(crate) fn restore_memory_compression_with(prior: Option<bool>) -> Result<ApplyResult, String> {
    let Some(prior_enabled) = prior else {
        return Err(
            "Memory compression state could not be read — refusing to restore what can't be snapshotted."
                .to_string(),
        );
    };
    // State-aware: MMAgent cmdlets are non-idempotent (live QA 2026-07-16 — Disable throws
    // ERROR_SERVICE_DISABLED when compression is already off; guard both directions uniformly).
    run_elevated_powershell(
        "if (-not (Get-MMAgent).MemoryCompression) { Enable-MMAgent -MemoryCompression }",
    )?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestoreMemoryCompressionDefault,
        rollback_action: RollbackAction::RestoreMemoryCompressionFromSnapshot,
        snapshot: Snapshot::MemoryCompression { prior_enabled: Some(prior_enabled) },
        elevation_used: true,
    })
}

/// Combined elevated script for the admin-only-prior case (Get-MMAgent needs admin, ca01347):
/// capture the prior INSIDE the one elevated context — `$ErrorActionPreference='Stop'` makes the
/// order binding (prior is written to the result file BEFORE Enable-MMAgent can run; any earlier
/// failure aborts before the mutation). The result path is app-derived + single-quote-escaped
/// (the §4 compose_batch_script precedent); the file is DATA out, never input in. Exit-free.
pub(crate) fn memcompress_combined_restore_script(result_path: &str) -> String {
    format!(
        "$ErrorActionPreference='Stop'; $rf='{}'; $p=(Get-MMAgent).MemoryCompression; Add-Content -LiteralPath $rf -Value \"prior:$p\"; if (-not $p) {{ Enable-MMAgent -MemoryCompression }}; Add-Content -LiteralPath $rf -Value 'done:ok'",
        result_path.replace('\'', "''")
    )
}

/// Fail-safe parse of the combined script's result file: a snapshot is accepted ONLY when the
/// prior parsed AND the mutation confirmed (`done:ok`) — the §4 "only an explicit ok earns a
/// ledger entry" direction. Anything else refuses with an honest, state-naming message.
pub(crate) fn parse_memcompress_restore_result(text: &str) -> Result<bool, String> {
    let mut prior: Option<bool> = None;
    let mut done = false;
    for line in text.lines() {
        match line.trim() {
            "prior:True" => prior = Some(true),
            "prior:False" => prior = Some(false),
            "done:ok" => done = true,
            _ => {}
        }
    }
    match (prior, done) {
        (Some(p), true) => Ok(p),
        (Some(_), false) => Err(
            "The elevated step captured the prior state but did not confirm the change — nothing was recorded. Re-run the check to see the current state."
                .to_string(),
        ),
        (None, _) => Err(
            "The elevated step did not report the prior state — nothing was recorded (a change is never recorded without its undo). Re-run the check to see the current state."
                .to_string(),
        ),
    }
}

/// The admin-only-prior arm: ONE elevated invocation that snapshots then mutates (see the script
/// builder above). Receipt-worthy only on a confirmed prior + confirmed mutation.
fn restore_memory_compression_elevated_read() -> Result<ApplyResult, String> {
    let dir = crate::compy_data_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("memcompress-restore-{millis}.result"));
    let _ = std::fs::remove_file(&path);
    let run = run_elevated_powershell(&memcompress_combined_restore_script(&path.to_string_lossy()));
    let text = std::fs::read_to_string(&path).unwrap_or_default();
    let _ = std::fs::remove_file(&path);
    // A decline or elevated failure propagates first (EAP=Stop means nothing mutated without the
    // prior already banked); then the fail-safe parse decides whether a snapshot was earned.
    run?;
    let prior = parse_memcompress_restore_result(&text)?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestoreMemoryCompressionDefault,
        rollback_action: RollbackAction::RestoreMemoryCompressionFromSnapshot,
        snapshot: Snapshot::MemoryCompression { prior_enabled: Some(prior) },
        elevation_used: true,
    })
}

pub(crate) fn restore_memory_compression() -> Result<ApplyResult, String> {
    // Readable prior (elevated context / future probe): the plain snapshot-then-mutate path.
    // Unreadable (Get-MMAgent is admin-only for a normal user — the field case, ca01347): the
    // prior is taken INSIDE the one elevated context instead of refusing outright.
    match crate::leftovers::read_memory_compression() {
        Some(prior) => restore_memory_compression_with(Some(prior)),
        None => restore_memory_compression_elevated_read(),
    }
}

pub(crate) fn rollback_memory_compression_typed(prior_enabled: Option<bool>) -> Result<(), String> {
    match prior_enabled {
        // Idempotent-by-check: Disable-MMAgent throws ERROR_SERVICE_DISABLED when compression is
        // already off (live QA 2026-07-16), so a drifted rig must not fail its own rollback —
        // "already at prior" is success, verified in-elevation.
        Some(true) => run_elevated_powershell(
            "if (-not (Get-MMAgent).MemoryCompression) { Enable-MMAgent -MemoryCompression }",
        ),
        Some(false) => run_elevated_powershell(
            "if ((Get-MMAgent).MemoryCompression) { Disable-MMAgent -MemoryCompression }",
        ),
        // Unreachable for entries this code writes (the apply refuses a None prior) — but a
        // hand-edited/corrupt entry must fail LOUD, never guess a security-of-state direction.
        None => Err("This entry has no recorded prior state — cannot roll back blind.".to_string()),
    }
}

pub(crate) fn restore_mmcss_defaults() -> Result<ApplyResult, String> {
    let (sr, nti) = read_mmcss_priors()?; // refuses on an unreadable key
    run_elevated_powershell(&mmcss_apply_script(sr))?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestoreMmcssDefaults,
        rollback_action: RollbackAction::RestoreMmcssFromSnapshot,
        snapshot: Snapshot::Mmcss {
            prior_system_responsiveness: sr,
            prior_network_throttling: nti,
        },
        elevation_used: true,
    })
}

pub(crate) fn rollback_mmcss_typed(sr: Option<u32>, nti: Option<u32>) -> Result<(), String> {
    run_elevated_powershell(&mmcss_rollback_script(sr, nti))
}

pub(crate) fn restore_priority_separation() -> Result<ApplyResult, String> {
    let prior = read_priority_separation_prior()?; // refuses on an unreadable key
    run_elevated_powershell(&priority_separation_restore_script())?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestorePrioritySeparationDefault,
        rollback_action: RollbackAction::RestorePrioritySeparationFromSnapshot,
        snapshot: Snapshot::PrioritySeparation { prior_value: prior },
        elevation_used: true,
    })
}

pub(crate) fn rollback_priority_separation_typed(prior: Option<u32>) -> Result<(), String> {
    run_elevated_powershell(&priority_separation_rollback_script(prior))
}

// ─── Leftovers v2 wave 2 (2026-06-11; armed with R2-5 2026-07-16) — MPO / core-parking / TCP autotuning ─────────
// Same contract as R2-5: snapshot-before-mutate, ONE elevated PS per
// restore, fail-loud rollback, pure script builders. Every interpolated value is a u32 (or a
// fixed literal command); no external string ever enters an elevated command (the integer-only
// hard line — which is why pagefile, whose rollback needs the user's REG_MULTI_SZ path string,
// is NOT here; see the Review Queue).

const DWM_PATH: &str = "HKLM:\\SOFTWARE\\Microsoft\\Windows\\Dwm";
// Power-plan SUBGROUP + SETTING GUIDs for processor core-parking minimum. FIXED CONSTANTS (mine,
// like every registry-path literal here) — never external data.
pub(crate) const SUB_PROCESSOR_GUID: &str = "54533251-82be-4824-96c1-47b60b740d00";
pub(crate) const CPMINCORES_GUID: &str = "0cc5b647-c1df-4637-891a-dec35c318583";

// Read priors directly (registry/powercfg/netsh reads need no elevation). Err = the SOURCE was
// unreadable → the restore refuses BEFORE elevation (never mutate what couldn't be snapshotted).

fn read_mpo_prior() -> Result<Option<u32>, String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\Microsoft\Windows\Dwm") {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot snapshot OverlayTestMode: {e}")),
        Ok(k) => Ok(k.get_value::<u32, _>("OverlayTestMode").ok()),
    }
}

/// Parse `powercfg /q SCHEME_CURRENT SUB_PROCESSOR CPMINCORES` for the AC + DC index values.
/// Reuses the shared `parse_powercfg_ac_dc_index` so this and the USB/PCIe reader can't drift.
fn read_core_parking_priors() -> Result<(Option<u32>, Option<u32>), String> {
    let out = quiet_command("powercfg")
        .args(["/q", "SCHEME_CURRENT", "SUB_PROCESSOR", "CPMINCORES"])
        .output()
        .map_err(|e| format!("cannot read core parking: {e}"))?;
    if !out.status.success() {
        return Err("powercfg core-parking query failed".to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let (ac, dc) = parse_powercfg_ac_dc_index(&text);
    // At least the AC index must parse, or we don't have a snapshot to reverse against.
    if ac.is_none() {
        return Err("could not parse the core-parking AC index — refusing to restore blind".to_string());
    }
    Ok((ac, dc))
}

fn read_tcp_autotuning_disabled() -> Result<bool, String> {
    let out = quiet_command("netsh")
        .args(["int", "tcp", "show", "global"])
        .output()
        .map_err(|e| format!("cannot read TCP global: {e}"))?;
    if !out.status.success() {
        return Err("netsh TCP query failed".to_string());
    }
    let text = String::from_utf8_lossy(&out.stdout).to_lowercase();
    match text.lines().find(|l| l.contains("auto-tuning") || l.contains("autotuning")) {
        Some(l) if l.contains("disabled") => Ok(true),
        Some(l) if l.contains("normal") || l.contains("experimental") || l.contains("restricted") => {
            Ok(false)
        }
        // Non-English output or unexpected shape: refuse rather than guess a state to reverse to.
        _ => Err("could not read the TCP auto-tuning level — refusing to restore blind".to_string()),
    }
}

// Pure script builders (unit-tested without elevation; integers only).
pub(crate) fn mpo_rollback_script(prior: Option<u32>) -> String {
    set_or_remove_dword(DWM_PATH, "OverlayTestMode", prior)
}
pub(crate) fn core_parking_script(ac_pct: u32, dc_pct: u32) -> String {
    // ONE elevated PS invocation runs all three statements. SCHEME_CURRENT (not an explicit GUID)
    // is the standard powercfg idiom for a SETTING-index write — the 070c3c9 stored-GUID contract
    // concerns whole-plan SWITCHING (force-activating a plan), not a per-setting index on the
    // already-active plan, so there's no plan-switch to drift here.
    format!(
        "powercfg -setacvalueindex SCHEME_CURRENT {SUB_PROCESSOR_GUID} {CPMINCORES_GUID} {ac_pct}; \
         powercfg -setdcvalueindex SCHEME_CURRENT {SUB_PROCESSOR_GUID} {CPMINCORES_GUID} {dc_pct}; \
         powercfg -setactive SCHEME_CURRENT"
    )
}
pub(crate) fn tcp_autotuning_script(disabled: bool) -> &'static str {
    if disabled {
        "netsh int tcp set global autotuninglevel=disabled"
    } else {
        "netsh int tcp set global autotuninglevel=normal"
    }
}

// ── MPO: restore default-on by removing OverlayTestMode ──
pub(crate) fn restore_mpo_default() -> Result<ApplyResult, String> {
    let prior = read_mpo_prior()?;
    run_elevated_powershell(&set_or_remove_dword(DWM_PATH, "OverlayTestMode", None))?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestoreMpoDefault,
        rollback_action: RollbackAction::RestoreMpoFromSnapshot,
        snapshot: Snapshot::Mpo { prior_overlay_test_mode: prior },
        elevation_used: true,
    })
}
pub(crate) fn rollback_mpo_typed(prior: Option<u32>) -> Result<(), String> {
    run_elevated_powershell(&mpo_rollback_script(prior))
}

/// The restore apply script (AC 0, DC 0, setactive), all-or-nothing (issue 617): each powercfg
/// step checks its exit status, and a failure puts the finished index writes back (DC, then AC) to
/// the apply-time snapshot inside the same elevation. A missing DC prior is undone to the AC prior,
/// mirroring `rollback_core_parking_typed`. The rollback script (`core_parking_script`) is unchanged.
/// Kill-mid-apply residual: the AC (and DC) index may stay 0 with no receipt.
pub(crate) fn core_parking_apply_script(prior_ac: u32, prior_dc: Option<u32>) -> String {
    let idx = |side: &str, v: u32| {
        format!("powercfg -set{side}valueindex SCHEME_CURRENT {SUB_PROCESSOR_GUID} {CPMINCORES_GUID} {v}")
    };
    ps_all_or_restore(&[
        PsStep { write: idx("ac", 0), undo: idx("ac", prior_ac), native: true },
        // No DC prior (never read back): the DC undo writes the AC prior, as the rollback does.
        PsStep { write: idx("dc", 0), undo: idx("dc", prior_dc.unwrap_or(prior_ac)), native: true },
        PsStep {
            write: "powercfg -setactive SCHEME_CURRENT".to_string(),
            undo: String::new(),
            native: true,
        },
    ])
}

// ── Core parking: re-allow parking (min unparked → 0% AC+DC) so the override is lifted ──
pub(crate) fn restore_core_parking_default() -> Result<ApplyResult, String> {
    let (ac, dc) = read_core_parking_priors()?;
    let prior_ac = ac.ok_or("could not parse the core-parking AC index — refusing to restore blind")?;
    run_elevated_powershell(&core_parking_apply_script(prior_ac, dc))?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestoreCoreParkingDefault,
        rollback_action: RollbackAction::RestoreCoreParkingFromSnapshot,
        snapshot: Snapshot::CoreParking { prior_ac_pct: ac, prior_dc_pct: dc },
        elevation_used: true,
    })
}
pub(crate) fn rollback_core_parking_typed(ac: Option<u32>, dc: Option<u32>) -> Result<(), String> {
    match (ac, dc) {
        // DC may legitimately be absent on a desktop with no battery profile — restore AC, mirror to DC.
        (Some(a), dc) => run_elevated_powershell(&core_parking_script(a, dc.unwrap_or(a))),
        (None, _) => {
            Err("This entry has no recorded prior core-parking value — cannot roll back blind.".to_string())
        }
    }
}

// ── Pagefile (the origin-story resolver — option (a), Cowork call 2026-06-11) ──
// Restore-forward = ONE fixed command re-enabling Windows-managed paging. Rollback must put the
// user's exact rotted PagingFiles entry back, and that value is a PATH STRING — so option (a)
// restricts the resolver to the validated common case: exactly one entry shaped
// `<Letter>:\pagefile.sys <init> <max>`. Anything else (multi-pagefile, ?:-form, disabled, odd
// paths) is REFUSED honestly at apply time — "unusual layout — left as-is" — and no snapshot is
// taken, so rollback can ALWAYS rebuild the entry from one validated ASCII letter + two u32s:
// provably metacharacter-free. REBOOT REQUIRED to take effect (both directions) — the detector's
// restore_note says so up front; no script here ever touches Restart-Computer (test-pinned).

pub(crate) const PAGEFILE_RESTORE_SCRIPT: &str = "$cs = Get-CimInstance Win32_ComputerSystem; $cs | Set-CimInstance -Property @{AutomaticManagedPagefile=$true}";
const MEMORY_MGMT_PATH: &str =
    "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Memory Management";

/// Pure, validation-gated parse of the PagingFiles REG_MULTI_SZ. Ok ONLY for the single
/// fixed-size entry option (a) covers; every other layout refuses with the honest message.
pub(crate) fn parse_manual_pagefile_entry(entries: &[String]) -> Result<(char, u32, u32), String> {
    const REFUSE: &str =
        "This PC's pagefile layout is unusual — left as-is (no automatic restore is offered for it).";
    if entries.len() != 1 {
        return Err(REFUSE.to_string()); // zero (disabled) or multi-pagefile setups
    }
    let mut parts = entries[0].split_whitespace();
    let (Some(path), Some(init), Some(max), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(REFUSE.to_string());
    };
    let mut chars = path.chars();
    let letter = match chars.next() {
        Some(c) if c.is_ascii_alphabetic() => c.to_ascii_uppercase(),
        _ => return Err(REFUSE.to_string()),
    };
    if !chars.as_str().eq_ignore_ascii_case(":\\pagefile.sys") {
        return Err(REFUSE.to_string());
    }
    let (Ok(init_mb), Ok(max_mb)) = (init.parse::<u32>(), max.parse::<u32>()) else {
        return Err(REFUSE.to_string());
    };
    if init_mb == 0 || max_mb == 0 {
        return Err(REFUSE.to_string()); // "0 0" = system-managed-size form, not the fixed rot
    }
    Ok((letter, init_mb, max_mb))
}

/// Pure rollback-script builder. Inputs were validated at apply time; re-validated here anyway so
/// a hand-edited ledger entry fails LOUD instead of building a command from garbage.
pub(crate) fn pagefile_rollback_script(letter: char, init_mb: u32, max_mb: u32) -> Result<String, String> {
    if !letter.is_ascii_alphabetic() || init_mb == 0 || max_mb == 0 {
        return Err(
            "This entry's recorded pagefile layout is invalid — cannot roll back blind.".to_string(),
        );
    }
    let letter = letter.to_ascii_uppercase();
    // Every character is from the validated set: one ASCII letter, the fixed literal path, digits.
    let entry = format!("{letter}:\\pagefile.sys {init_mb} {max_mb}");
    Ok(format!(
        "$cs = Get-CimInstance Win32_ComputerSystem; $cs | Set-CimInstance -Property @{{AutomaticManagedPagefile=$false}}; \
         Set-ItemProperty -Path '{MEMORY_MGMT_PATH}' -Name 'PagingFiles' -Value @('{entry}') -Type MultiString"
    ))
}

fn read_pagingfiles() -> Result<Vec<String>, String> {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    match RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey(r"SYSTEM\CurrentControlSet\Control\Session Manager\Memory Management")
    {
        Err(e) => Err(format!("cannot snapshot the pagefile configuration: {e}")),
        Ok(k) => match k.get_value::<Vec<String>, _>("PagingFiles") {
            Ok(v) => Ok(v),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()), // → parse refuses
            Err(e) => Err(format!("cannot snapshot the pagefile configuration: {e}")),
        },
    }
}

/// Takes the entries explicitly so the refusal contract is unit-testable: exotic layouts and
/// unreadable state refuse BEFORE any elevation (never mutate what can't be exactly reversed).
pub(crate) fn restore_pagefile_automatic_with(entries: Vec<String>) -> Result<ApplyResult, String> {
    let (letter, init_mb, max_mb) = parse_manual_pagefile_entry(&entries)?;
    run_elevated_powershell(PAGEFILE_RESTORE_SCRIPT)?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestorePagefileAutomatic,
        rollback_action: RollbackAction::RestorePagefileFromSnapshot,
        snapshot: Snapshot::PagefileManual {
            prior_drive_letter: letter,
            prior_initial_mb: init_mb,
            prior_maximum_mb: max_mb,
        },
        elevation_used: true,
    })
}

pub(crate) fn restore_pagefile_automatic() -> Result<ApplyResult, String> {
    restore_pagefile_automatic_with(read_pagingfiles()?)
}

pub(crate) fn rollback_pagefile_typed(letter: char, init_mb: u32, max_mb: u32) -> Result<(), String> {
    run_elevated_powershell(&pagefile_rollback_script(letter, init_mb, max_mb)?)
}

// ── TCP receive-window auto-tuning: restore "normal" ──
pub(crate) fn restore_tcp_autotuning_default() -> Result<ApplyResult, String> {
    let prior_disabled = read_tcp_autotuning_disabled()?;
    run_elevated_powershell(tcp_autotuning_script(false))?;
    Ok(ApplyResult {
        applied_action: AppliedAction::RestoreTcpAutotuningDefault,
        rollback_action: RollbackAction::RestoreTcpAutotuningFromSnapshot,
        snapshot: Snapshot::TcpAutotuning { prior_disabled },
        elevation_used: true,
    })
}
pub(crate) fn rollback_tcp_autotuning_typed(prior_disabled: bool) -> Result<(), String> {
    run_elevated_powershell(tcp_autotuning_script(prior_disabled))
}

// ─── Mouse acceleration off (HKCU, no admin) ─────────────────────────────

const MOUSE_KEY: &str = "Control Panel\\Mouse";

/// Three HKCU writes, all-or-nothing via `hkcu_write_all_or_restore` (issue 617). Kill-mid-apply
/// residual: MouseSpeed (and MouseThreshold1) may stay "0" with no receipt.
pub(crate) fn apply_mouse_accel_off() -> Result<ApplyResult, String> {
    apply_mouse_accel_off_with(&mut RealHkcu)
}

fn apply_mouse_accel_off_with(reg: &mut dyn HkcuValues) -> Result<ApplyResult, String> {
    // All three values are REG_SZ strings, not DWORDs. Windows is weird.
    // The snapshot stores "" for an absent value (rollback deletes, the faithful inverse), so a
    // present value that is empty or not REG_SZ refuses before any write (see `prior_mouse_sz`).
    let snapshot = hkcu_write_all_or_restore(
        reg,
        &[
            HkcuWrite { subkey: MOUSE_KEY, name: "MouseSpeed", value: reg_sz("0") },
            HkcuWrite { subkey: MOUSE_KEY, name: "MouseThreshold1", value: reg_sz("0") },
            HkcuWrite { subkey: MOUSE_KEY, name: "MouseThreshold2", value: reg_sz("0") },
        ],
        |p| {
            Ok(Snapshot::MouseAccel {
                prior_speed: prior_mouse_sz("MouseSpeed", &p[0])?,
                prior_threshold1: prior_mouse_sz("MouseThreshold1", &p[1])?,
                prior_threshold2: prior_mouse_sz("MouseThreshold2", &p[2])?,
            })
        },
    )?;

    Ok(ApplyResult {
        applied_action: AppliedAction::DisableMouseAcceleration,
        rollback_action: RollbackAction::RestoreMouseAccelFromSnapshot,
        snapshot,
        elevation_used: false,
    })
}

pub(crate) fn rollback_mouse_accel_off_typed(
    prior_speed: &str,
    prior_threshold1: &str,
    prior_threshold2: &str,
) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags("Control Panel\\Mouse", KEY_SET_VALUE | KEY_READ)
        .map_err(|e| e.to_string())?;

    let restore = |reg_name: &str, prior: &str| -> Result<(), String> {
        if prior.is_empty() {
            let _ = key.delete_value(reg_name);
            Ok(())
        } else {
            key.set_value(reg_name, &prior.to_string())
                .map_err(|e| e.to_string())
        }
    };

    restore("MouseSpeed", prior_speed)?;
    restore("MouseThreshold1", prior_threshold1)?;
    restore("MouseThreshold2", prior_threshold2)?;
    Ok(())
}

// ─── Nagle disable across active NICs ────────────────────────────────────

// Pure target selector (testable): of the with-IP Tcpip interfaces, target the PHYSICAL ones only —
// but if we can't identify any physical among them (WMI unavailable / GUID mismatch), fall back to ALL
// with-IP so the rec is never silently inert. Detection/eligibility train (addendum): per-interface
// network tweaks target the active physical interface, never VPN/Hyper-V/virtual adapters.
pub(crate) fn select_nagle_targets(with_ip_guids: &[String], physical_guids_upper: &[String]) -> Vec<String> {
    let phys: Vec<String> = with_ip_guids
        .iter()
        .filter(|g| physical_guids_upper.contains(&g.to_uppercase()))
        .cloned()
        .collect();
    if phys.is_empty() {
        with_ip_guids.to_vec()
    } else {
        phys
    }
}

/// An apply with no interface to change (offline, or no adapter has an address) is refused before
/// anything runs (codebase review 2026-11-02). An Ok there recorded "applied" for a change that wrote
/// nothing, and `rollback_nagle_disable_typed` refuses an empty snapshot, so that Trust Ledger row
/// could never be closed.
fn require_nagle_interfaces(
    snapshots: Vec<NagleInterfaceSnapshot>,
) -> Result<Vec<NagleInterfaceSnapshot>, String> {
    if snapshots.is_empty() {
        return Err("No active network adapter was found to change, so nothing was changed. Connect to a network and try again.".into());
    }
    Ok(snapshots)
}

/// Issue 617 assessment: every per-interface write is SilentlyContinue and, once there is an
/// interface to change, the apply returns Ok with the full snapshot, so any partial state is always
/// receipted and rollback-able.
pub(crate) fn apply_nagle_disable() -> Result<ApplyResult, String> {
    // Snapshot (no admin): capture prior values on every Tcpip interface that has an IP...
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let interfaces = hklm
        .open_subkey("SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces")
        .map_err(|e| e.to_string())?;
    let mut with_ip: Vec<NagleInterfaceSnapshot> = Vec::new();
    for adapter_name in interfaces.enum_keys().filter_map(|r| r.ok()) {
        let Ok(adapter) = interfaces.open_subkey(&adapter_name) else {
            continue;
        };
        let has_ip = adapter.get_value::<String, _>("DhcpIPAddress").is_ok()
            || adapter.get_value::<String, _>("IPAddress").is_ok();
        if !has_ip {
            continue;
        }
        with_ip.push(NagleInterfaceSnapshot {
            interface: adapter_name,
            prior_ack: adapter.get_value("TcpAckFrequency").ok(),
            prior_nodelay: adapter.get_value("TCPNoDelay").ok(),
        });
    }

    // ...then narrow to the PHYSICAL interfaces (Wi-Fi or wired), excluding VPN/virtual adapters.
    let with_ip_guids: Vec<String> = with_ip.iter().map(|s| s.interface.clone()).collect();
    let physical = crate::hardware::physical_nic_guids(); // UPPER, braced; empty → fall back to all
    let targets: std::collections::HashSet<String> = select_nagle_targets(&with_ip_guids, &physical)
        .into_iter()
        .map(|g| g.to_uppercase())
        .collect();
    // The snapshot now covers EXACTLY what we write, so rollback is exact. Nothing to change is
    // refused here, before anything runs.
    let nic_snapshots: Vec<NagleInterfaceSnapshot> = require_nagle_interfaces(
        with_ip
            .into_iter()
            .filter(|s| targets.contains(&s.interface.to_uppercase()))
            .collect(),
    )?;

    // Write to exactly those interfaces, by explicit path (mirrors the rollback script).
    // Per-call `-ErrorAction SilentlyContinue` is DELIBERATE and MUST stay: run_elevated_powershell
    // now prefixes `$ErrorActionPreference='Stop'` (single-command false-ledger guard), which would
    // otherwise make a mid-loop Set-ItemProperty failure on interface N abort the whole script,
    // leaving interfaces 0..N already mutated on the machine with NO ledger entry (apply returns Err
    // → nothing persisted → un-rollback-able live mutation, a rollback-first violation). Isolating
    // each write keeps apply all-recorded: we snapshot EXACTLY what we target and rollback is an
    // idempotent restore, so over-recording an interface that failed to write is a harmless no-op —
    // strictly safer than orphaning. Mirrors the EEE script's per-item isolation.
    let mut ps = String::new();
    for s in &nic_snapshots {
        // The name came from enum_keys() here, but validate anyway so the invariant is enforced at
        // the interpolation site (the snapshot we persist must never contain an unsafe key).
        nic_interface_safe(&s.interface)?;
        let path = format!(
            "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{}",
            s.interface
        );
        ps.push_str(&format!("Set-ItemProperty -Path '{path}' -Name 'TcpAckFrequency' -Value 1 -Type DWord -ErrorAction SilentlyContinue; "));
        ps.push_str(&format!("Set-ItemProperty -Path '{path}' -Name 'TCPNoDelay' -Value 1 -Type DWord -ErrorAction SilentlyContinue; "));
    }
    if !ps.is_empty() {
        run_elevated_powershell(&ps)?;
    }
    Ok(ApplyResult {
        applied_action: AppliedAction::DisableNagleOnActiveNics,
        rollback_action: RollbackAction::RestoreNagleNicsFromSnapshot,
        snapshot: Snapshot::NagleNics {
            interfaces: nic_snapshots,
        },
        elevation_used: true,
    })
}

pub(crate) fn rollback_nagle_disable_typed(
    interfaces: &[NagleInterfaceSnapshot],
) -> Result<(), String> {
    if interfaces.is_empty() {
        return Err("no interfaces recorded in snapshot".into());
    }
    let mut ps = String::new();
    for entry in interfaces {
        if entry.interface.is_empty() {
            continue;
        }
        // entry.interface is read back from the user-writable history.json — validate it before it
        // is interpolated into an elevated PowerShell -Path literal, or a tampered ledger entry
        // could inject arbitrary admin commands at rollback time.
        nic_interface_safe(&entry.interface)?;
        let path = format!(
            "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{}",
            entry.interface
        );
        // Per-call `-ErrorAction SilentlyContinue` on every branch (mirrors apply): under the blanket
        // `$ErrorActionPreference='Stop'`, one interface's Set/Remove failure would otherwise abort
        // the whole rollback pass, leaving later interfaces un-restored. Isolated + idempotent, so a
        // single bad interface can't block restoring the rest; history.rs only marks the entry
        // rolled_back after dispatch_rollback returns Ok, so a partial pass stays retryable.
        match entry.prior_ack {
            Some(v) => ps.push_str(&format!(
                "Set-ItemProperty -Path '{}' -Name 'TcpAckFrequency' -Value {} -Type DWord -ErrorAction SilentlyContinue; ",
                path, v
            )),
            None => ps.push_str(&format!(
                "Remove-ItemProperty -Path '{}' -Name 'TcpAckFrequency' -ErrorAction SilentlyContinue; ",
                path
            )),
        }
        match entry.prior_nodelay {
            Some(v) => ps.push_str(&format!(
                "Set-ItemProperty -Path '{}' -Name 'TCPNoDelay' -Value {} -Type DWord -ErrorAction SilentlyContinue; ",
                path, v
            )),
            None => ps.push_str(&format!(
                "Remove-ItemProperty -Path '{}' -Name 'TCPNoDelay' -ErrorAction SilentlyContinue; ",
                path
            )),
        }
    }
    if ps.is_empty() {
        return Err("snapshot had interfaces but none usable for rollback".into());
    }
    run_elevated_powershell(&ps)?;
    Ok(())
}

pub(crate) fn rollback_visual_effects_typed(
    vfx_setting_prior: Option<u32>,
    user_prefs_mask_prior: Option<&[u8]>,
) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let vfx_key = hkcu
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects",
            KEY_SET_VALUE | KEY_READ,
        )
        .map_err(|e| e.to_string())?;
    match vfx_setting_prior {
        Some(v) => vfx_key
            .set_value("VisualFXSetting", &v)
            .map_err(|e| e.to_string())?,
        None => {
            let _ = vfx_key.delete_value("VisualFXSetting");
        }
    }

    let desktop_key = hkcu
        .open_subkey_with_flags("Control Panel\\Desktop", KEY_SET_VALUE | KEY_READ)
        .map_err(|e| e.to_string())?;
    match user_prefs_mask_prior {
        Some(bytes) => {
            desktop_key
                .set_raw_value(
                    "UserPreferencesMask",
                    &winreg::RegValue {
                        bytes: bytes.to_vec(),
                        vtype: winreg::enums::RegType::REG_BINARY,
                    },
                )
                .map_err(|e| e.to_string())?;
        }
        None => {
            let _ = desktop_key.delete_value("UserPreferencesMask");
        }
    }
    Ok(())
}

// Dispatches a RollbackAction against its corresponding Snapshot. The match
// is exhaustive on the (action, snapshot) pair — a mismatch is a contract
// violation and returns Err rather than performing the wrong rollback.
//
// Takes the `MutationRoot` capability (#130). The path is not consulted — POSSESSION is the proof:
// this token exists only when Compy has verified the data root is the machine's own, so a
// container-redirected launch cannot reach a rollback at all. Undoing a real Windows change on the
// strength of a receipt read out of someone else's sandbox is the failure this prevents.
pub(crate) fn dispatch_rollback(
    _root: &crate::data_root::MutationRoot,
    action: &RollbackAction,
    snapshot: &Snapshot,
) -> Result<(), String> {
    use RollbackAction as R;
    use Snapshot as S;
    match (action, snapshot) {
        (
            R::RestoreServiceFromSnapshot { service },
            S::Service { prior_state, prior_start_mode },
        ) => rollback_service_disable_typed(service, prior_state, prior_start_mode),
        (
            R::ResumeServiceFromSnapshot { service },
            S::Service { prior_state, .. },
        ) => rollback_service_suspend_typed(service, prior_state),
        (
            R::RestoreStartupApprovalFromSnapshot,
            S::StartupApproval {
                name,
                prior_bytes,
                prior_vtype,
            },
        ) => rollback_startup_approval_typed(name, prior_bytes.as_ref(), *prior_vtype),
        (
            R::RestoreGameModeFromSnapshot,
            S::GameMode {
                prior_enabled,
                prior_allow,
            },
        ) => rollback_game_mode_typed(*prior_enabled, *prior_allow),
        (
            R::RestoreVisualEffectsFromSnapshot,
            S::VisualEffects {
                vfx_setting_prior,
                user_prefs_mask_prior,
            },
        ) => rollback_visual_effects_typed(
            *vfx_setting_prior,
            user_prefs_mask_prior.as_deref(),
        ),
        (
            R::RestoreMouseAccelFromSnapshot,
            S::MouseAccel {
                prior_speed,
                prior_threshold1,
                prior_threshold2,
            },
        ) => rollback_mouse_accel_off_typed(prior_speed, prior_threshold1, prior_threshold2),
        (
            R::RestoreGameBarFromSnapshot,
            S::GameBar {
                prior_capture,
                prior_enabled,
            },
        ) => rollback_game_bar_disable_typed(*prior_capture, *prior_enabled),
        (R::RestoreHwSchModeFromSnapshot, S::HwSchMode { prior }) => {
            rollback_hags_enable_typed(*prior)
        }
        (R::RestorePowerPlanFromSnapshot, S::PowerPlan { prior_guid }) => {
            rollback_power_ultimate_typed(prior_guid)
        }
        (R::RestoreNagleNicsFromSnapshot, S::NagleNics { interfaces }) => {
            rollback_nagle_disable_typed(interfaces)
        }
        (R::RestoreFastStartupFromSnapshot, S::FastStartup { prior_hiberboot }) => {
            rollback_fast_startup_off_typed(*prior_hiberboot)
        }
        (R::RestoreReservedStorageFromSnapshot, S::ReservedStorage { prior_enabled }) => {
            rollback_reserved_storage_off_typed(*prior_enabled)
        }
        (
            R::RestorePowerPlanSettingFromSnapshot,
            S::PowerPlanSetting {
                plan_guid,
                subgroup_guid,
                setting_guid,
                prior_ac_value,
                prior_dc_value,
            },
        ) => rollback_power_plan_setting_typed(
            plan_guid,
            subgroup_guid,
            setting_guid,
            *prior_ac_value,
            *prior_dc_value,
        ),
        (R::RestoreEnergyEfficientEthernetFromSnapshot, S::EeeNicProperty { adapters }) => {
            rollback_eee_disable_typed(adapters)
        }
        // Leftovers v2 (dark) — undoing a restore puts the recorded rotted value back exactly.
        (R::RestoreMemoryCompressionFromSnapshot, S::MemoryCompression { prior_enabled }) => {
            rollback_memory_compression_typed(*prior_enabled)
        }
        (
            R::RestoreMmcssFromSnapshot,
            S::Mmcss { prior_system_responsiveness, prior_network_throttling },
        ) => rollback_mmcss_typed(*prior_system_responsiveness, *prior_network_throttling),
        (R::RestorePrioritySeparationFromSnapshot, S::PrioritySeparation { prior_value }) => {
            rollback_priority_separation_typed(*prior_value)
        }
        (R::RestoreMpoFromSnapshot, S::Mpo { prior_overlay_test_mode }) => {
            rollback_mpo_typed(*prior_overlay_test_mode)
        }
        (R::RestoreCoreParkingFromSnapshot, S::CoreParking { prior_ac_pct, prior_dc_pct }) => {
            rollback_core_parking_typed(*prior_ac_pct, *prior_dc_pct)
        }
        (R::RestoreTcpAutotuningFromSnapshot, S::TcpAutotuning { prior_disabled }) => {
            rollback_tcp_autotuning_typed(*prior_disabled)
        }
        (
            R::RestorePagefileFromSnapshot,
            S::PagefileManual { prior_drive_letter, prior_initial_mb, prior_maximum_mb },
        ) => rollback_pagefile_typed(*prior_drive_letter, *prior_initial_mb, *prior_maximum_mb),
        (R::EnableScheduledTask { task }, S::ScheduledTask { prior_state }) => {
            rollback_enable_scheduled_task_typed(task, prior_state)
        }
        (R::ReinstallPreloadApp { app }, S::PreloadApp { prior_family_name, .. }) => {
            rollback_reinstall_preload_app_typed(app, prior_family_name)
        }
        _ => Err(format!(
            "rollback action/snapshot mismatch: action={:?}, snapshot kind differs",
            action
        )),
    }
}

// Build a typed (RollbackAction, Snapshot) pair from a legacy AppliedChange
// (one written by a Compy version before the typed-action refactor). The
// legacy snapshot was a free-form serde_json::Value whose shape was determined
// by the rec_id; we reconstruct the typed form using the same per-rec_id
// knowledge.
/// Resolve the rollback contract for an AppliedChange using ONLY the stored
/// history — never the live recommendation catalog (ARCHITECTURE_LOCKS §1.5).
/// Prefers the typed contract captured at apply time; falls back to
/// synthesizing one from rec_id + legacy snapshot JSON for entries written by
/// older Compy versions. This is the core of "Compy can undo what it did
/// from local history alone" — extracted so it's unit-testable without
/// mutating Windows.
pub(crate) fn resolve_rollback(change: &AppliedChange) -> Result<(RollbackAction, Snapshot), String> {
    if let Some(ra) = change.rollback_action.clone() {
        let snap: Snapshot = serde_json::from_value(change.snapshot.clone())
            .map_err(|e| format!("snapshot deserialize: {}", e))?;
        Ok((ra, snap))
    } else {
        synthesize_legacy_rollback(&change.rec_id, &change.snapshot).ok_or_else(|| {
            format!(
                "legacy AppliedChange for rec_id '{}' has no typed rollback contract and no legacy synthesizer matched",
                change.rec_id
            )
        })
    }
}

pub(crate) fn synthesize_legacy_rollback(
    rec_id: &str,
    snapshot: &serde_json::Value,
) -> Option<(RollbackAction, Snapshot)> {
    match rec_id {
        "game-mode" => {
            let prior_enabled = snapshot
                .get("prior")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            // Legacy entries predate the pair fix and never captured AllowAutoGameMode.
            Some((
                RollbackAction::RestoreGameModeFromSnapshot,
                Snapshot::GameMode {
                    prior_enabled,
                    prior_allow: None,
                },
            ))
        }
        "visual-effects" => {
            let vfx_setting_prior = snapshot
                .get("vfx_setting_prior")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            let user_prefs_mask_prior = snapshot
                .get("user_prefs_mask_prior")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|n| n.as_u64().map(|v| v as u8))
                        .collect::<Vec<u8>>()
                });
            Some((
                RollbackAction::RestoreVisualEffectsFromSnapshot,
                Snapshot::VisualEffects {
                    vfx_setting_prior,
                    user_prefs_mask_prior,
                },
            ))
        }
        "sysmain-disable" | "diagtrack-disable" | "windows-search-disable"
        | "nvidia-telemetry" => {
            let service = match rec_id {
                "sysmain-disable" => KnownService::SysMain,
                "diagtrack-disable" => KnownService::DiagTrack,
                "windows-search-disable" => KnownService::WSearch,
                "nvidia-telemetry" => KnownService::NvTelemetryContainer,
                _ => return None,
            };
            let prior_state = snapshot
                .get("prior_state")
                .and_then(|v| v.as_str())
                .unwrap_or("Running")
                .to_string();
            let prior_start_mode = snapshot
                .get("prior_start_mode")
                .and_then(|v| v.as_str())
                .unwrap_or("Automatic")
                .to_string();
            Some((
                RollbackAction::RestoreServiceFromSnapshot {
                    service: service.clone(),
                },
                Snapshot::Service {
                    prior_state,
                    prior_start_mode,
                },
            ))
        }
        "power-ultimate" => {
            let prior_guid = snapshot
                .get("prior_plan_guid")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some((
                RollbackAction::RestorePowerPlanFromSnapshot,
                Snapshot::PowerPlan { prior_guid },
            ))
        }
        "nagle-disable" => {
            let interfaces = snapshot
                .get("interfaces")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|entry| {
                            let iface = entry.get("interface").and_then(|v| v.as_str())?;
                            Some(NagleInterfaceSnapshot {
                                interface: iface.to_string(),
                                prior_ack: entry
                                    .get("prior_ack")
                                    .and_then(|v| v.as_u64())
                                    .map(|v| v as u32),
                                prior_nodelay: entry
                                    .get("prior_nodelay")
                                    .and_then(|v| v.as_u64())
                                    .map(|v| v as u32),
                            })
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            Some((
                RollbackAction::RestoreNagleNicsFromSnapshot,
                Snapshot::NagleNics { interfaces },
            ))
        }
        "hags-enable" => {
            let prior = snapshot
                .get("prior_hwschmode")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            Some((
                RollbackAction::RestoreHwSchModeFromSnapshot,
                Snapshot::HwSchMode { prior },
            ))
        }
        "mouse-accel-off" => {
            let prior_speed = snapshot
                .get("prior_speed")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let prior_threshold1 = snapshot
                .get("prior_threshold1")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let prior_threshold2 = snapshot
                .get("prior_threshold2")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            Some((
                RollbackAction::RestoreMouseAccelFromSnapshot,
                Snapshot::MouseAccel {
                    prior_speed,
                    prior_threshold1,
                    prior_threshold2,
                },
            ))
        }
        "game-bar-disable" => {
            let prior_capture = snapshot
                .get("prior_capture")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            let prior_enabled = snapshot
                .get("prior_enabled")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            Some((
                RollbackAction::RestoreGameBarFromSnapshot,
                Snapshot::GameBar {
                    prior_capture,
                    prior_enabled,
                },
            ))
        }
        "fast-startup-off" => {
            let prior_hiberboot = snapshot
                .get("prior_hiberboot")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            Some((
                RollbackAction::RestoreFastStartupFromSnapshot,
                Snapshot::FastStartup { prior_hiberboot },
            ))
        }
        "reserved-storage-off" => {
            let prior_enabled = snapshot
                .get("prior_enabled")
                .and_then(|v| v.as_bool())
                .unwrap_or(true);
            Some((
                RollbackAction::RestoreReservedStorageFromSnapshot,
                Snapshot::ReservedStorage { prior_enabled },
            ))
        }
        _ => None,
    }
}


// ─── Rollback resolution / legacy synthesis tests ────────────────────────
//
// Release-gate QA: lock the PURE half of the rollback contract that the module
// extraction touched — the rec_id -> (RollbackAction, Snapshot) mapping used to
// undo changes from local history alone. These never mutate Windows; the actual
// powercfg/registry restore is covered by the manual smoke pass.
#[cfg(test)]
mod rollback_tests {
    use super::*;
    use serde_json::json;

    // Every rec_id that existed before the typed-action refactor must still
    // synthesize a rollback from a legacy (untyped) snapshot, mapped to the
    // correct action+snapshot variant pair — otherwise an upgrade would silently
    // strip rollback from changes already sitting in users' history.json. Each
    // pair asserted here is one dispatch_rollback handles (1:1 with its arms).
    #[test]
    fn synthesize_legacy_maps_each_rec_to_correct_rollback() {
        use RollbackAction as R;
        use Snapshot as S;

        let (a, s) = synthesize_legacy_rollback("game-mode", &json!({"prior": 1})).unwrap();
        assert!(matches!(a, R::RestoreGameModeFromSnapshot) && matches!(s, S::GameMode { .. }));

        let (a, s) =
            synthesize_legacy_rollback("visual-effects", &json!({"vfx_setting_prior": 1})).unwrap();
        assert!(
            matches!(a, R::RestoreVisualEffectsFromSnapshot) && matches!(s, S::VisualEffects { .. })
        );

        for svc in [
            "sysmain-disable",
            "diagtrack-disable",
            "windows-search-disable",
            "nvidia-telemetry",
        ] {
            let (a, s) = synthesize_legacy_rollback(
                svc,
                &json!({"prior_state": "Running", "prior_start_mode": "Automatic"}),
            )
            .unwrap();
            assert!(
                matches!(a, R::RestoreServiceFromSnapshot { .. }) && matches!(s, S::Service { .. }),
                "service rec {svc}"
            );
        }

        let (a, s) =
            synthesize_legacy_rollback("power-ultimate", &json!({"prior_plan_guid": "G"})).unwrap();
        assert!(matches!(a, R::RestorePowerPlanFromSnapshot) && matches!(s, S::PowerPlan { .. }));

        let (a, s) =
            synthesize_legacy_rollback("nagle-disable", &json!({"interfaces": []})).unwrap();
        assert!(matches!(a, R::RestoreNagleNicsFromSnapshot) && matches!(s, S::NagleNics { .. }));

        let (a, s) =
            synthesize_legacy_rollback("hags-enable", &json!({"prior_hwschmode": 0})).unwrap();
        assert!(matches!(a, R::RestoreHwSchModeFromSnapshot) && matches!(s, S::HwSchMode { .. }));

        let (a, s) =
            synthesize_legacy_rollback("mouse-accel-off", &json!({"prior_speed": "10"})).unwrap();
        assert!(matches!(a, R::RestoreMouseAccelFromSnapshot) && matches!(s, S::MouseAccel { .. }));

        let (a, s) = synthesize_legacy_rollback(
            "game-bar-disable",
            &json!({"prior_capture": 1, "prior_enabled": 1}),
        )
        .unwrap();
        assert!(matches!(a, R::RestoreGameBarFromSnapshot) && matches!(s, S::GameBar { .. }));

        let (a, s) =
            synthesize_legacy_rollback("fast-startup-off", &json!({"prior_hiberboot": 1})).unwrap();
        assert!(
            matches!(a, R::RestoreFastStartupFromSnapshot) && matches!(s, S::FastStartup { .. })
        );

        let (a, s) =
            synthesize_legacy_rollback("reserved-storage-off", &json!({"prior_enabled": true}))
                .unwrap();
        assert!(
            matches!(a, R::RestoreReservedStorageFromSnapshot)
                && matches!(s, S::ReservedStorage { .. })
        );
    }

    // The three power/NIC recs added WITH the typed contract have no legacy
    // synthesizer (no pre-typed history entry can exist for them); an unknown
    // rec_id likewise yields None. resolve_rollback then returns a clean error
    // instead of guessing and restoring the wrong thing.
    #[test]
    fn synthesize_legacy_returns_none_for_post_typed_and_unknown_recs() {
        for rec in [
            "usb-selective-suspend-off",
            "pcie-aspm-off",
            "eee-disable",
            "totally-unknown-rec",
        ] {
            assert!(
                synthesize_legacy_rollback(rec, &json!({})).is_none(),
                "expected None for {rec}"
            );
        }
    }

    fn typed_change(action: RollbackAction, snapshot: serde_json::Value) -> AppliedChange {
        AppliedChange {
            id: "id".into(),
            rec_id: "any".into(),
            rec_title: "t".into(),
            applied_at: "2026-01-01T00:00:00Z".into(),
            snapshot,
            status: "applied".into(),
            applied_action: None,
            rollback_action: Some(action),
            app_version_at_apply: None,
            ruleset_version_at_apply: None,
            elevation_used: None,
            provenance: None,
            hw_fingerprint: None,
            rolled_back_at: None,
            justified_by_experiment: None,
            rollback_justified_by_experiment: None,
            changed_outside: None,
            applied_plan: None,
        }
    }

    // A typed entry whose stored snapshot JSON doesn't match its action (corrupt
    // or tampered history) must fail safe: resolve_rollback returns Err, never
    // panics and never silently falls through to a different action/snapshot.
    #[test]
    fn resolve_rollback_rejects_garbled_typed_snapshot() {
        let change = typed_change(
            RollbackAction::RestoreGameModeFromSnapshot,
            json!({"not": "a snapshot"}),
        );
        assert!(
            resolve_rollback(&change).is_err(),
            "garbled typed snapshot must not resolve"
        );
    }

    // ── Power-plan rollback fidelity (restore the EXACT plan, never SCHEME_CURRENT) ──

    #[test]
    fn power_setting_snapshot_carries_plan_guid() {
        // The plan GUID the setting was applied to must survive in the snapshot —
        // it is what rollback targets.
        let s = Snapshot::PowerPlanSetting {
            plan_guid: "PLAN-GUID-123".into(),
            subgroup_guid: "SUB".into(),
            setting_guid: "SET".into(),
            prior_ac_value: 1,
            prior_dc_value: 1,
        };
        let back: Snapshot = serde_json::from_value(serde_json::to_value(&s).unwrap()).unwrap();
        match back {
            Snapshot::PowerPlanSetting { plan_guid, .. } => assert_eq!(plan_guid, "PLAN-GUID-123"),
            _ => panic!("variant changed on round-trip"),
        }
    }

    #[test]
    fn power_setting_restore_targets_stored_plan_never_scheme_current() {
        let cmd = build_power_setting_restore_cmd("PLAN-GUID-123", "SUB", "SET", 5, 7, true);
        assert!(cmd.contains("PLAN-GUID-123"), "must target the stored plan GUID");
        assert!(
            !cmd.contains("SCHEME_CURRENT"),
            "must never fall back to SCHEME_CURRENT"
        );
        assert!(cmd.contains("setacvalueindex") && cmd.contains(" 5"));
        assert!(cmd.contains("setdcvalueindex") && cmd.contains(" 7"));
        assert!(
            cmd.contains("setactive PLAN-GUID-123"),
            "the active plan should be re-committed"
        );

        // Restoring a NON-active plan must not switch the user onto it.
        let cmd2 = build_power_setting_restore_cmd("PLAN-GUID-123", "SUB", "SET", 5, 7, false);
        assert!(
            !cmd2.contains("setactive"),
            "must not switch active plan when restoring a non-active plan"
        );
        assert!(!cmd2.contains("SCHEME_CURRENT"));
    }

    #[test]
    fn rollback_power_setting_fails_safe_when_plan_missing() {
        // A bogus/deleted plan GUID must produce a clean error, NOT a silent
        // restore onto whatever plan is current. The all-zeros GUID is never a
        // real scheme, so this resolves to Err before any elevation is attempted.
        let bogus = "00000000-0000-0000-0000-000000000000";
        let result = rollback_power_plan_setting_typed(bogus, "SUB", "SET", 1, 1);
        assert!(result.is_err(), "missing plan GUID must fail safe");
        let msg = result.unwrap_err().to_lowercase();
        assert!(
            msg.contains("no longer exists") || msg.contains("plan"),
            "error should explain the missing plan: {msg}"
        );
    }

    #[test]
    fn power_plan_exists_rejects_empty_and_bogus() {
        assert!(!power_plan_exists(""), "empty GUID is not a plan");
        assert!(!power_plan_exists("   "), "whitespace GUID is not a plan");
        assert!(
            !power_plan_exists("00000000-0000-0000-0000-000000000000"),
            "all-zeros GUID is not a real plan"
        );
    }
}

#[cfg(test)]
mod restores_label_tests {
    use super::*;
    use serde_json::json;

    // Round-trip through serde_json::Value so the test exercises the real read-time path
    // (deserialize the persisted snapshot → label), exactly as `into_view` does.
    fn label(snap: &Snapshot) -> Option<String> {
        let v = serde_json::to_value(snap).expect("snapshot serializes");
        restores_label_from_snapshot(&v)
    }

    #[test]
    fn service_running_disabled_manual_and_unknown() {
        assert_eq!(
            label(&Snapshot::Service {
                prior_state: "Running".into(),
                prior_start_mode: "Auto".into()
            }),
            Some("Running".to_string())
        );
        assert_eq!(
            label(&Snapshot::Service {
                prior_state: "Stopped".into(),
                prior_start_mode: "Disabled".into()
            }),
            Some("Disabled".to_string())
        );
        assert_eq!(
            label(&Snapshot::Service {
                prior_state: "Stopped".into(),
                prior_start_mode: "Manual".into()
            }),
            Some("Manual start".to_string())
        );
        // Default/unknown capture → no clean label → generic fallback.
        assert_eq!(
            label(&Snapshot::Service {
                prior_state: "Unknown".into(),
                prior_start_mode: "Unknown".into()
            }),
            None
        );
    }

    #[test]
    fn boolean_registry_values_on_off() {
        assert_eq!(label(&Snapshot::GameMode { prior_enabled: Some(1), prior_allow: Some(1) }), Some("On".into()));
        assert_eq!(label(&Snapshot::GameMode { prior_enabled: Some(0), prior_allow: Some(0) }), Some("Off".into()));
        assert_eq!(label(&Snapshot::GameMode { prior_enabled: None, prior_allow: None }), None);
        assert_eq!(
            label(&Snapshot::FastStartup { prior_hiberboot: Some(1) }),
            Some("On".into())
        );
        assert_eq!(label(&Snapshot::ReservedStorage { prior_enabled: true }), Some("On".into()));
        assert_eq!(
            label(&Snapshot::ReservedStorage { prior_enabled: false }),
            Some("Off".into())
        );
        assert_eq!(
            label(&Snapshot::GameBar { prior_capture: Some(0), prior_enabled: Some(1) }),
            Some("On".into())
        );
        assert_eq!(
            label(&Snapshot::MouseAccel {
                prior_speed: "1".into(),
                prior_threshold1: "6".into(),
                prior_threshold2: "10".into()
            }),
            Some("On".into())
        );
    }

    #[test]
    fn hags_uses_two_for_on() {
        assert_eq!(label(&Snapshot::HwSchMode { prior: Some(2) }), Some("On".into()));
        assert_eq!(label(&Snapshot::HwSchMode { prior: Some(1) }), Some("Off".into()));
        assert_eq!(label(&Snapshot::HwSchMode { prior: None }), None);
    }

    #[test]
    fn visual_effects_named_modes() {
        assert_eq!(
            label(&Snapshot::VisualEffects {
                vfx_setting_prior: Some(1),
                user_prefs_mask_prior: None
            }),
            Some("Best appearance".into())
        );
        assert_eq!(
            label(&Snapshot::VisualEffects {
                vfx_setting_prior: Some(2),
                user_prefs_mask_prior: None
            }),
            Some("Best performance".into())
        );
        assert_eq!(
            label(&Snapshot::VisualEffects {
                vfx_setting_prior: None,
                user_prefs_mask_prior: None
            }),
            None
        );
    }

    #[test]
    fn power_plan_bare_guid_is_never_named() {
        // The snapshot holds only a GUID — must NOT be dressed up as a plan name (spec §5).
        assert_eq!(
            label(&Snapshot::PowerPlan {
                prior_guid: "381b4222-f694-41f0-9685-ff5bb260df2e".into()
            }),
            None
        );
    }

    #[test]
    fn multi_target_and_setting_snapshots_are_generic() {
        assert_eq!(
            label(&Snapshot::PowerPlanSetting {
                plan_guid: "g".into(),
                subgroup_guid: "s".into(),
                setting_guid: "x".into(),
                prior_ac_value: 1,
                prior_dc_value: 1,
            }),
            None
        );
        assert_eq!(label(&Snapshot::NagleNics { interfaces: vec![] }), None);
        assert_eq!(label(&Snapshot::EeeNicProperty { adapters: vec![] }), None);
    }

    #[test]
    fn legacy_or_untyped_snapshot_falls_back_to_none() {
        // Old entries / unexpected shapes can't deserialize into Snapshot → None (generic UI).
        assert_eq!(restores_label_from_snapshot(&json!({"foo": "bar"})), None);
        assert_eq!(restores_label_from_snapshot(&json!("legacy string")), None);
        assert_eq!(restores_label_from_snapshot(&json!(null)), None);
    }

    // ── Game Mode persistence fix (2026-06-08): apply + detect must agree on the value PAIR ──

    // A typed GameMode snapshot written BEFORE this fix carried only `prior_enabled`. It must still
    // deserialize (prior_allow -> None via #[serde(default)]) so a pre-fix apply stays undoable —
    // rollback-first integrity (ARCHITECTURE_LOCKS §3).
    #[test]
    fn pre_fix_typed_game_mode_snapshot_still_deserializes() {
        let pre_fix = json!({"kind": "game-mode", "prior_enabled": 0});
        let snap: Snapshot =
            serde_json::from_value(pre_fix).expect("pre-fix snapshot must deserialize");
        assert!(matches!(
            snap,
            Snapshot::GameMode { prior_enabled: Some(0), prior_allow: None }
        ));
    }

    // Read-after-write regression for the "never stays on" bug: a freshly applied Game Mode MUST be
    // reported as enabled by the detection probe. The old apply wrote only AutoGameModeEnabled,
    // which Windows reset on reboot and which a pair-aware detector reads as not-fully-on — that
    // mismatch re-offered the rec and bloated the ledger (owner export: 5× applies). This locks
    // apply and detect to the same pair. Touches real HKCU; captures + restores the exact prior
    // state so it leaves the machine as it found it (restore runs BEFORE any assertion).
    #[test]
    fn game_mode_apply_reads_back_as_enabled() {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let read = |name: &str| -> Option<u32> {
            hkcu.open_subkey(GAMEBAR_KEY).and_then(|k| k.get_value(name)).ok()
        };
        let prior_enabled = read(GAME_MODE_ENABLED_VALUE);
        let prior_allow = read(GAME_MODE_ALLOW_VALUE);

        let result = apply_game_mode().expect("apply_game_mode");
        let reads_enabled = crate::game_mode_enabled();
        let snapshot_ok = matches!(
            result.snapshot,
            Snapshot::GameMode { prior_enabled: pe, prior_allow: pa }
                if pe == prior_enabled && pa == prior_allow
        );
        rollback_game_mode_typed(prior_enabled, prior_allow).expect("restore prior state");

        assert!(reads_enabled, "detection must read ON immediately after apply (both values set)");
        assert!(snapshot_ok, "apply must snapshot the exact prior pair for rollback");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Property/fuzz coverage for bounded IPC inputs (blueprint §11, Q4).
//
// Everything below takes a value the webview (or a tampered history.json) supplies and decides
// whether it may reach a Windows mutation or an elevated command line. Those domains are BOUNDED —
// four service names, three task ids, four app ids, one character alphabet per interpolation site —
// so the property that matters is about the COMPLEMENT of the allowlist: everything outside is
// refused. That is a claim no finite list of hand-written examples can make, which is exactly why
// these are generated. The near-miss generator matters most here: "SysMain ", "sysmain", "SysMai"
// and a Cyrillic-с "сysMain" all have to be refused, and none of them look wrong.
// ─────────────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod ipc_input_fuzz_tests {
    use super::*;
    use crate::fuzz_support::{hostile_string, mutate_text, Rng, SEEDS};

    // ── EEE: the one interpolation site that ESCAPES instead of REFUSING ──────────────────────
    //
    // Independent Rust/Tauri security review (issue #133 Task 7) flagged the EEE builders for not
    // going through `ps_safe_squoted` like every other elevated interpolation in this file. They
    // cannot: the tokens are adapter names, driver property names and the driver's own prior value
    // strings — vendor text read back out of a snapshot, not something Compy chose. Refusing an
    // apostrophe there would make a legitimately-named NIC UNROLLBACKABLE, which is a worse failure
    // than the one it prevents (rollback-first integrity, LOCKED rule 3).
    //
    // So this site keeps the escape and pays for it with a PROOF instead of an alphabet: for any
    // input whatsoever, re-parsing the emitted script's single-quoted literals must return the
    // EXACT input tokens. If a token could terminate its literal early — the definition of a
    // breakout — the parse would return something else, or fail. Both builders are covered, because
    // the rollback half is the half a tampered history.json feeds.
    /// Read the PowerShell single-quoted literals out of a script, in order, unescaping `''`.
    /// Returns None if the script is not well-formed (an unterminated literal = a breakout).
    fn parse_squoted_literals(script: &str) -> Option<Vec<String>> {
        let cs: Vec<char> = script.chars().collect();
        let mut out = Vec::new();
        let mut i = 0;
        while i < cs.len() {
            if cs[i] != '\'' {
                i += 1;
                continue;
            }
            i += 1; // opening quote
            let mut lit = String::new();
            loop {
                match cs.get(i) {
                    None => return None, // unterminated literal
                    Some('\'') => {
                        if cs.get(i + 1) == Some(&'\'') {
                            lit.push('\'');
                            i += 2;
                        } else {
                            i += 1; // closing quote
                            break;
                        }
                    }
                    Some(c) => {
                        lit.push(*c);
                        i += 1;
                    }
                }
            }
            out.push(lit);
        }
        Some(out)
    }

    #[test]
    fn eee_scripts_never_break_out_of_their_quotes() {
        for seed in SEEDS {
            let mut rng = Rng::seeded(seed);
            for case in 0..300 {
                let tok = |rng: &mut Rng| -> String {
                    if rng.flag() {
                        hostile_string(rng, 4)
                    } else {
                        mutate_text(rng, "Realtek PCIe GbE Family Controller")
                    }
                };
                // 1..=3 adapters, because a rig with two eligible NICs is the shape the mutation
                // path actually emits — several `Set-NetAdapterAdvancedProperty ...; ` statements
                // concatenated into ONE elevated script. Reviewer catch (#133 Task 7): proving the
                // escape at N=1 does not prove it for the script the apply path really builds.
                let n = 1 + rng.below(3);
                let triples: Vec<(String, String, String)> =
                    (0..n).map(|_| (tok(&mut rng), tok(&mut rng), tok(&mut rng))).collect();

                let apply = build_eee_apply_script(
                    &triples
                        .iter()
                        .map(|(name, display, value)| {
                            (
                                EeeProperty {
                                    adapter_name: name.clone(),
                                    display_name: display.clone(),
                                    current_value: "On".into(),
                                    valid_values: vec!["On".into(), "Off".into()],
                                },
                                value.clone(),
                            )
                        })
                        .collect::<Vec<_>>(),
                );
                let rollback = build_eee_rollback_script(
                    &triples
                        .iter()
                        .map(|(name, display, value)| EeeNicSnapshot {
                            adapter_name: name.clone(),
                            property_display_name: display.clone(),
                            prior_value: value.clone(),
                        })
                        .collect::<Vec<_>>(),
                );

                let expected: Vec<String> = triples
                    .iter()
                    .flat_map(|(a, b, c)| [a.clone(), b.clone(), c.clone()])
                    .collect();
                for (which, script) in [("apply", &apply), ("rollback", &rollback)] {
                    let lits = parse_squoted_literals(script).unwrap_or_else(|| {
                        panic!("seed {seed} case {case} n={n}: {which} script has an unterminated literal — a token escaped its quotes: {script:?}")
                    });
                    assert_eq!(
                        lits, expected,
                        "seed {seed} case {case} n={n}: {which} script did not re-parse to its input tokens — the escape leaked"
                    );
                }
            }
        }
    }

    // The reviewer's second question, answered by proof rather than by recollection: the fuzz above
    // can emit a NUL inside an adapter name, and that string ends up as ONE argument to
    // powershell.exe. Win32 command lines are NUL-terminated, so a silent truncation there would
    // turn a rejected token into a SHORTER command that still runs. Rust's std refuses the arg
    // instead — the whole elevated call fails loudly, which is the correct outcome for a mutation.
    #[test]
    fn an_embedded_nul_fails_the_command_instead_of_truncating_it() {
        let err = std::process::Command::new("cmd.exe")
            .args(["/c", "echo hi\0 && whoami"])
            .output()
            .expect_err("an embedded NUL must be refused, not silently truncated into a shorter command");
        assert_eq!(err.kind(), std::io::ErrorKind::InvalidInput);
    }

    // The documented alphabets, restated so an edit to a guard has to be a deliberate decision that
    // updates this contract too, not a quiet widening.
    fn ps_alphabet(c: char) -> bool {
        c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-')
    }
    fn squoted_alphabet(c: char) -> bool {
        ps_alphabet(c) || matches!(c, ' ' | '\\')
    }
    fn nic_alphabet(c: char) -> bool {
        c.is_ascii_alphanumeric() || matches!(c, '-' | '{' | '}')
    }

    /// Characters that must never appear in ANY accepted token, whichever guard accepted it. This is
    /// the security property itself rather than a restatement of the implementation: a quote or a
    /// `$` reaching an elevated command line is the breakout.
    const SHELL_BREAKOUT: &[char] =
        &['\'', '"', '`', '$', ';', '|', '&', '(', ')', '<', '>', '\n', '\r', '\0'];

    /// Real tokens from the curated catalog — service names, a task path, a NIC GUID key, a power
    /// GUID. Mutating these produces the near-misses that matter.
    const SAFE_SAMPLES: &[&str] = &[
        "SysMain",
        "DiagTrack",
        "NvTelemetryContainer",
        "Microsoft Compatibility Appraiser",
        "\\Microsoft\\Windows\\Application Experience\\",
        "{2a737441-1930-4402-8d77-b2bebba308a3}",
        "381b4222-f694-41f0-9685-ff5bb260df2e",
        "TcpAckFrequency",
    ];

    const SERVICES: &[&str] = &["SysMain", "DiagTrack", "WSearch", "NvTelemetryContainer"];
    const TASKS: &[&str] = &["compatibility-appraiser", "ceip-consolidator", "ceip-usb"];

    #[test]
    fn elevated_command_guards_admit_exactly_their_alphabets_and_never_a_breakout_character() {
        for seed in SEEDS {
            let mut rng = Rng::seeded(seed);
            for case in 0..300 {
                let s = if rng.flag() {
                    hostile_string(&mut rng, 4)
                } else {
                    let base = *rng.pick(SAFE_SAMPLES);
                    mutate_text(&mut rng, base)
                };
                let nonempty = !s.is_empty();

                assert_eq!(
                    ps_safe(&s).is_ok(),
                    nonempty && s.chars().all(ps_alphabet),
                    "seed {seed} case {case}: ps_safe disagreed with its documented alphabet on {s:?}"
                );
                assert_eq!(
                    ps_safe_squoted(&s).is_ok(),
                    nonempty && s.chars().all(squoted_alphabet),
                    "seed {seed} case {case}: ps_safe_squoted disagreed with its documented alphabet on {s:?}"
                );
                assert_eq!(
                    nic_interface_safe(&s).is_ok(),
                    nonempty && s.chars().all(nic_alphabet),
                    "seed {seed} case {case}: nic_interface_safe disagreed with its documented alphabet on {s:?}"
                );

                for (guard, accepted) in [
                    ("ps_safe", ps_safe(&s).is_ok()),
                    ("ps_safe_squoted", ps_safe_squoted(&s).is_ok()),
                    ("nic_interface_safe", nic_interface_safe(&s).is_ok()),
                ] {
                    if accepted {
                        assert!(
                            !s.chars().any(|c| SHELL_BREAKOUT.contains(&c)),
                            "seed {seed} case {case}: {guard} accepted a token carrying a breakout character: {s:?}"
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn mutation_allowlists_resolve_their_catalog_and_refuse_everything_else() {
        // Named explicitly, not merely "absent from the list": if a future edit ever made one of
        // these reachable, this is the test that says so by name.
        const CRITICAL: &[&str] = &[
            "csrss",
            "lsass",
            "smss",
            "wininit",
            "services",
            "WinDefend",
            "SecurityHealthService",
            "Winmgmt",
            "RpcSs",
            "wuauserv",
            "EventLog",
            "BFE",
            "mpssvc",
        ];
        for name in CRITICAL {
            assert!(
                KnownService::from_name(name).is_none(),
                "a critical service must never resolve to the suspend primitive: {name}"
            );
        }

        let apps: Vec<&'static str> = KnownPreloadApp::ALL.iter().map(|a| a.id()).collect();

        // The catalog itself resolves and round-trips — so the refusals below are a real boundary
        // rather than a guard that refuses everything.
        for name in SERVICES {
            assert_eq!(
                KnownService::from_name(name).expect("catalog service resolves").name(),
                *name
            );
        }
        for id in TASKS {
            assert!(KnownBloatTask::from_id(id).is_some(), "catalog task resolves: {id}");
        }
        for id in &apps {
            assert_eq!(
                KnownPreloadApp::from_id(id).expect("catalog app resolves").id(),
                *id
            );
        }

        for seed in SEEDS {
            let mut rng = Rng::seeded(seed);
            for case in 0..400 {
                let s = match rng.below(4) {
                    0 => hostile_string(&mut rng, 3),
                    1 => {
                        let b = *rng.pick(SERVICES);
                        mutate_text(&mut rng, b)
                    }
                    2 => {
                        let b = *rng.pick(TASKS);
                        mutate_text(&mut rng, b)
                    }
                    _ => {
                        let b = *rng.pick(&apps);
                        mutate_text(&mut rng, b)
                    }
                };
                // A mutation can land back on a legal id, so the property is an EQUIVALENCE with
                // exact catalog membership — never a blanket "always None", which a mutation that
                // round-tripped would falsify for the wrong reason.
                assert_eq!(
                    KnownService::from_name(&s).is_some(),
                    SERVICES.contains(&s.as_str()),
                    "seed {seed} case {case}: KnownService::from_name is not exactly its catalog on {s:?}"
                );
                assert_eq!(
                    KnownBloatTask::from_id(&s).is_some(),
                    TASKS.contains(&s.as_str()),
                    "seed {seed} case {case}: KnownBloatTask::from_id is not exactly its catalog on {s:?}"
                );
                assert_eq!(
                    KnownPreloadApp::from_id(&s).is_some(),
                    apps.contains(&s.as_str()),
                    "seed {seed} case {case}: KnownPreloadApp::from_id is not exactly its catalog on {s:?}"
                );
            }
        }
    }

    /// The batch receipt file is written by an elevated child and read back to decide what gets
    /// ledgered. The fail-safe direction is that a MISSING receipt means not-applied, so the
    /// property is that every receipt the parser reports is justified by a line that explicitly said
    /// `ok` or `fail` — a fabricated or inferred receipt would ledger a change that never happened.
    #[test]
    fn batch_receipts_only_report_lines_that_explicitly_said_ok_or_fail() {
        for seed in SEEDS {
            let mut rng = Rng::seeded(seed);
            for case in 0..60 {
                let lines = 1 + rng.below(12);
                let mut text = String::new();
                for _ in 0..lines {
                    match rng.below(5) {
                        0 => {
                            let id = *rng.pick(crate::history::APPLIABLE_REC_IDS);
                            text.push_str(id);
                            text.push_str(":ok");
                        }
                        1 => {
                            let id = *rng.pick(crate::history::APPLIABLE_REC_IDS);
                            text.push_str(id);
                            text.push_str(":fail");
                        }
                        2 => {
                            let junk = hostile_string(&mut rng, 3);
                            text.push_str(&junk);
                        }
                        3 => {
                            let id = *rng.pick(crate::history::APPLIABLE_REC_IDS);
                            let base = format!("{id}:ok");
                            let m = mutate_text(&mut rng, &base);
                            text.push_str(&m);
                        }
                        _ => {
                            let junk = hostile_string(&mut rng, 2);
                            text.push_str(&junk);
                            text.push_str(":ok");
                        }
                    }
                    text.push('\n');
                }

                for (id, ok) in parse_batch_receipts(&text) {
                    let want = format!("{id}:{}", if ok { "ok" } else { "fail" });
                    assert!(
                        text.lines().any(|l| l.trim() == want),
                        "seed {seed} case {case}: receipt {id:?}={ok} is justified by no input line"
                    );
                }
            }
        }
    }

    fn tampered(rec_id: &str, snapshot: serde_json::Value, typed: Option<RollbackAction>) -> AppliedChange {
        AppliedChange {
            id: "fuzz-1".into(),
            rec_id: rec_id.into(),
            rec_title: "fuzz".into(),
            applied_at: "2026-01-01T00:00:00Z".into(),
            snapshot,
            status: "applied".into(),
            applied_action: None,
            rollback_action: typed,
            app_version_at_apply: None,
            ruleset_version_at_apply: None,
            elevation_used: None,
            provenance: None,
            hw_fingerprint: None,
            rolled_back_at: None,
            justified_by_experiment: None,
            rollback_justified_by_experiment: None,
            changed_outside: None,
            applied_plan: None,
        }
    }

    /// history.json is user-writable, so `resolve_rollback` reads attacker-controllable rec_ids and
    /// snapshots. Two properties: the legacy synthesizer never invents a contract for a rec_id
    /// outside the appliable catalog, and the typed path returns the STORED contract verbatim rather
    /// than substituting one it liked better.
    #[test]
    fn a_tampered_ledger_entry_never_yields_a_rollback_contract_it_did_not_earn() {
        for seed in SEEDS {
            let mut rng = Rng::seeded(seed);
            for case in 0..200 {
                let rec_id = match rng.below(3) {
                    0 => hostile_string(&mut rng, 3),
                    1 => {
                        let b = *rng.pick(crate::history::APPLIABLE_REC_IDS);
                        mutate_text(&mut rng, b)
                    }
                    _ => (*rng.pick(crate::history::APPLIABLE_REC_IDS)).to_string(),
                };
                let prior = rng.next_u64();
                let junk = hostile_string(&mut rng, 2);
                let snapshot = match rng.below(3) {
                    0 => serde_json::json!({ "prior": prior }),
                    1 => serde_json::json!({ "prior": junk.clone() }),
                    _ => serde_json::Value::String(junk.clone()),
                };

                // Legacy path (no typed contract stored).
                if resolve_rollback(&tampered(&rec_id, snapshot.clone(), None)).is_ok() {
                    assert!(
                        crate::history::APPLIABLE_REC_IDS.contains(&rec_id.as_str()),
                        "seed {seed} case {case}: synthesized a rollback contract for off-catalog rec_id {rec_id:?}"
                    );
                }

                // Typed path: whatever it returns must be the contract that was stored.
                let stored = RollbackAction::RestoreGameModeFromSnapshot;
                if let Ok((got, _)) =
                    resolve_rollback(&tampered(&rec_id, snapshot, Some(stored.clone())))
                {
                    assert_eq!(
                        serde_json::to_string(&got).expect("serialize"),
                        serde_json::to_string(&stored).expect("serialize"),
                        "seed {seed} case {case}: the stored typed contract was substituted"
                    );
                }
            }
        }

        // Control: a well-formed typed entry DOES resolve, so the Ok branches above are reachable
        // and the properties are not vacuous.
        let good = tampered(
            "game-mode",
            serde_json::to_value(Snapshot::GameMode {
                prior_enabled: Some(1),
                prior_allow: None,
            })
            .expect("serialize snapshot"),
            Some(RollbackAction::RestoreGameModeFromSnapshot),
        );
        let (got, _) = resolve_rollback(&good).expect("a well-formed typed entry resolves");
        assert_eq!(
            serde_json::to_string(&got).expect("serialize"),
            serde_json::to_string(&RollbackAction::RestoreGameModeFromSnapshot).expect("serialize")
        );
    }
}


// bug->guard (council review 2026-08-02, P0 "mutation authority not centralized"):
// set_startup_entry_enabled wrote StartupApproved\\Run straight from lib.rs with no snapshot, no
// receipt and no rollback -- AND it synthesised a 12-byte value with a zeroed tail, discarding the
// timestamp bytes Windows itself had written. That is worse than a missing receipt: it made the
// prior value unrestorable in principle. These pin the composition contract, which is the half that
// can be proven without touching the real registry.
#[cfg(test)]
mod startup_approval_tests {
    use super::*;

    // A real StartupApproved value: state byte + Windows' own disable timestamp.
    const PRIOR_WITH_TIMESTAMP: [u8; 12] =
        [0x03, 0, 0, 0, 0xAB, 0xCD, 0xEF, 0x12, 0x34, 0x56, 0x78, 0x9A];

    #[test]
    fn enabling_preserves_every_byte_windows_wrote_after_the_state_flag() {
        let got = compose_startup_approval_bytes(Some(&PRIOR_WITH_TIMESTAMP), true);
        assert_eq!(got[0], 0x02, "state flag must say enabled");
        assert_eq!(
            &got[1..],
            &PRIOR_WITH_TIMESTAMP[1..],
            "the timestamp tail is Windows' data - the pre-fix code zeroed it"
        );
    }

    #[test]
    fn disabling_preserves_every_byte_windows_wrote_after_the_state_flag() {
        let mut prior = PRIOR_WITH_TIMESTAMP;
        prior[0] = 0x02;
        let got = compose_startup_approval_bytes(Some(&prior), false);
        assert_eq!(got[0], 0x03);
        assert_eq!(&got[1..], &prior[1..]);
    }

    #[test]
    fn a_toggle_round_trip_returns_the_exact_original_bytes() {
        let off = compose_startup_approval_bytes(Some(&PRIOR_WITH_TIMESTAMP), false);
        let back = compose_startup_approval_bytes(Some(&off), true);
        let mut expected = PRIOR_WITH_TIMESTAMP;
        expected[0] = 0x02;
        assert_eq!(back, expected.to_vec(), "round trip must be byte-identical");
    }

    #[test]
    fn an_absent_prior_synthesises_a_well_formed_value() {
        let got = compose_startup_approval_bytes(None, false);
        assert_eq!(got.len(), STARTUP_APPROVAL_LEN);
        assert_eq!(got[0], 0x03);
        assert!(got[1..].iter().all(|b| *b == 0), "nothing to preserve");
    }

    #[test]
    fn a_short_or_empty_prior_is_padded_never_indexed_out_of_bounds() {
        assert_eq!(compose_startup_approval_bytes(Some(&[]), true).len(), STARTUP_APPROVAL_LEN);
        let short = compose_startup_approval_bytes(Some(&[0x03, 0x77]), true);
        assert_eq!(short.len(), STARTUP_APPROVAL_LEN);
        assert_eq!(short[0], 0x02);
        assert_eq!(short[1], 0x77, "the one real byte we had is still kept");
    }

    // The rollback contract must survive a ledger round trip: an entry written today has to
    // deserialize and dispatch tomorrow.
    #[test]
    fn the_snapshot_round_trips_through_the_ledger_representation() {
        let snap = Snapshot::StartupApproval {
            name: "OneDrive".to_string(),
            prior_bytes: Some(PRIOR_WITH_TIMESTAMP.to_vec()),
            prior_vtype: Some(3),
        };
        let json = serde_json::to_value(&snap).expect("serialize");
        let back: Snapshot = serde_json::from_value(json).expect("deserialize");
        match back {
            Snapshot::StartupApproval { name, prior_bytes, prior_vtype } => {
                assert_eq!(name, "OneDrive");
                assert_eq!(prior_bytes, Some(PRIOR_WITH_TIMESTAMP.to_vec()));
                assert_eq!(prior_vtype, Some(3));
            }
            other => panic!("wrong variant back from the ledger: {:?}", other),
        }
    }

    #[test]
    fn an_absent_prior_survives_the_ledger_as_absent_not_as_empty() {
        let snap = Snapshot::StartupApproval {
            name: "Thing".to_string(),
            prior_bytes: None,
            prior_vtype: None,
        };
        let back: Snapshot =
            serde_json::from_value(serde_json::to_value(&snap).expect("serialize")).expect("de");
        match back {
            // None must NOT collapse into Some(vec![]) - the two mean different rollbacks
            // (delete the value vs write an empty one).
            Snapshot::StartupApproval { prior_bytes, .. } => assert!(prior_bytes.is_none()),
            other => panic!("wrong variant: {:?}", other),
        }
    }

    #[test]
    fn a_mismatched_action_snapshot_pair_refuses_rather_than_guessing() {
        let err = dispatch_rollback(
            &crate::data_root::test_mutation_root(),
            &RollbackAction::RestoreStartupApprovalFromSnapshot,
            &Snapshot::HwSchMode { prior: Some(1) },
        );
        assert!(err.is_err(), "a contract mismatch must never perform a rollback");
    }

    fn binary(bytes: Vec<u8>) -> winreg::RegValue {
        winreg::RegValue { bytes, vtype: winreg::enums::RegType::REG_BINARY }
    }

    // #620: the ledger's live re-check reads a startup toggle back with the same byte meaning the
    // writer used. Whatever the writer composes, from any prior, reads back as the direction written.
    #[test]
    fn whatever_the_writer_composes_the_reader_reads_back_as_the_direction_written() {
        let mut enabled_prior = PRIOR_WITH_TIMESTAMP;
        enabled_prior[0] = 0x02;
        let priors: [Option<&[u8]>; 5] =
            [None, Some(&[]), Some(&[0x03, 0x77]), Some(&PRIOR_WITH_TIMESTAMP), Some(&enabled_prior)];
        for prior in priors {
            for enabled in [true, false] {
                let written = compose_startup_approval_bytes(prior, enabled);
                assert_eq!(
                    startup_approval_enabled(&binary(written)),
                    Some(enabled),
                    "prior {prior:?}, written enabled={enabled}"
                );
            }
        }
    }

    #[test]
    fn an_unknown_byte_or_type_reads_as_unknown_never_as_a_guess() {
        // Windows' own bytes, as literals: the round trip above shares the writer's constants, so a
        // swapped 0x02/0x03 would pass it.
        assert_eq!(startup_approval_enabled(&binary(vec![0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0])), Some(true));
        assert_eq!(startup_approval_enabled(&binary(vec![0x03, 0, 0, 0, 0xAB, 0xCD, 0, 0, 0, 0, 0, 0])), Some(false));
        assert_eq!(startup_approval_enabled(&binary(vec![0x06, 0, 0, 0])), None, "unknown flag byte");
        assert_eq!(startup_approval_enabled(&binary(vec![0x00; 12])), None, "zero flag byte");
        assert_eq!(startup_approval_enabled(&binary(Vec::new())), None, "empty value");
        let dword = winreg::RegValue { bytes: vec![0x02, 0, 0, 0], vtype: winreg::enums::RegType::REG_DWORD };
        assert_eq!(startup_approval_enabled(&dword), None, "right byte, wrong type");
    }
}

// Issue 617 guards: a failure after the first write of a multi-write apply leaves nothing changed
// (or, when an undo also fails, records the change with its full snapshot). The HKCU cases run on
// an in-memory fake — no test here touches the real registry. The elevated cases check the script
// text and run the SAME generated wrapper in a real, unelevated PowerShell with stand-in steps.
#[cfg(test)]
mod all_or_nothing_tests {
    use super::*;
    use std::collections::HashMap;
    use winreg::enums::RegType;
    use winreg::types::FromRegValue;

    fn must_err(r: Result<ApplyResult, String>, why: &str) -> String {
        match r {
            Ok(_) => panic!("expected Err: {why}"),
            Err(e) => e,
        }
    }

    #[derive(Default)]
    struct FakeHkcu {
        vals: HashMap<(String, String), (Vec<u8>, RegType)>,
        /// The write of this value name fails.
        fail_write: Option<&'static str>,
        /// After the injected failure, every later write/delete (the undos) fails too.
        fail_undo: bool,
        /// A read of this value name fails (present but unreadable).
        fail_read: Option<&'static str>,
        failed: bool,
        writes: usize,
    }

    impl FakeHkcu {
        fn with(mut self, subkey: &str, name: &str, v: winreg::RegValue) -> Self {
            self.vals.insert((subkey.into(), name.into()), (v.bytes, v.vtype));
            self
        }
        fn get(&self, subkey: &str, name: &str) -> Option<winreg::RegValue> {
            self.vals
                .get(&(subkey.to_string(), name.to_string()))
                .map(|(b, t)| winreg::RegValue { bytes: b.clone(), vtype: t.clone() })
        }
        fn dword(&self, subkey: &str, name: &str) -> Option<u32> {
            self.get(subkey, name).map(|v| u32::from_reg_value(&v).expect("dword"))
        }
    }

    impl HkcuValues for FakeHkcu {
        fn read(&mut self, subkey: &str, name: &str) -> Result<Option<winreg::RegValue>, String> {
            if self.fail_read == Some(name) {
                return Err(format!("cannot read {name}"));
            }
            Ok(self.get(subkey, name))
        }
        fn write(&mut self, subkey: &str, name: &str, v: &winreg::RegValue) -> Result<(), String> {
            if self.fail_write == Some(name) && !self.failed {
                self.failed = true;
                return Err(format!("injected: cannot write {name}"));
            }
            if self.failed && self.fail_undo {
                return Err(format!("injected: undo of {name} failed"));
            }
            self.writes += 1;
            self.vals
                .insert((subkey.into(), name.into()), (v.bytes.clone(), v.vtype.clone()));
            Ok(())
        }
        fn delete(&mut self, subkey: &str, name: &str) -> Result<(), String> {
            if self.failed && self.fail_undo {
                return Err(format!("injected: undo-delete of {name} failed"));
            }
            self.vals.remove(&(subkey.to_string(), name.to_string()));
            Ok(())
        }
    }

    #[test]
    fn game_bar_second_write_fails_first_is_restored() {
        let mut reg = FakeHkcu { fail_write: Some("GameDVR_Enabled"), ..Default::default() }
            .with(GAMEDVR_KEY, "AppCaptureEnabled", reg_dword(1));
        let err = must_err(apply_game_bar_disable_with(&mut reg), "must fail");
        assert_eq!(reg.dword(GAMEDVR_KEY, "AppCaptureEnabled"), Some(1), "first write put back");
        assert_eq!(reg.get(GAME_CONFIG_STORE_KEY, "GameDVR_Enabled").map(|_| ()), None);
        assert!(err.contains("put back") && err.contains("nothing was left changed"), "{err}");
    }

    #[test]
    fn an_absent_prior_is_deleted_again_on_undo() {
        let mut reg = FakeHkcu { fail_write: Some("GameDVR_Enabled"), ..Default::default() };
        must_err(apply_game_bar_disable_with(&mut reg), "must fail");
        assert!(reg.vals.is_empty(), "the value that did not exist before must not exist after");
    }

    #[test]
    fn game_mode_second_write_fails_first_is_restored() {
        let mut reg = FakeHkcu { fail_write: Some(GAME_MODE_ENABLED_VALUE), ..Default::default() }
            .with(GAMEBAR_KEY, GAME_MODE_ALLOW_VALUE, reg_dword(0))
            .with(GAMEBAR_KEY, GAME_MODE_ENABLED_VALUE, reg_dword(0));
        must_err(apply_game_mode_with(&mut reg), "must fail");
        assert_eq!(reg.dword(GAMEBAR_KEY, GAME_MODE_ALLOW_VALUE), Some(0));
        assert_eq!(reg.dword(GAMEBAR_KEY, GAME_MODE_ENABLED_VALUE), Some(0));
    }

    #[test]
    fn visual_effects_second_write_fails_first_is_restored() {
        let mut reg = FakeHkcu { fail_write: Some("UserPreferencesMask"), ..Default::default() }
            .with(VFX_KEY, "VisualFXSetting", reg_dword(0));
        must_err(apply_visual_effects_with(&mut reg), "must fail");
        assert_eq!(reg.dword(VFX_KEY, "VisualFXSetting"), Some(0));
        assert!(reg.get(DESKTOP_KEY, "UserPreferencesMask").is_none());
    }

    #[test]
    fn mouse_third_write_fails_first_two_are_restored() {
        let mut reg = FakeHkcu { fail_write: Some("MouseThreshold2"), ..Default::default() }
            .with(MOUSE_KEY, "MouseSpeed", reg_sz("1"))
            .with(MOUSE_KEY, "MouseThreshold2", reg_sz("10"));
        must_err(apply_mouse_accel_off_with(&mut reg), "must fail");
        let sz = |r: &FakeHkcu, n: &str| r.get(MOUSE_KEY, n).map(|v| String::from_reg_value(&v).unwrap());
        assert_eq!(sz(&reg, "MouseSpeed").as_deref(), Some("1"));
        assert_eq!(sz(&reg, "MouseThreshold1"), None, "absent before, absent after");
        assert_eq!(sz(&reg, "MouseThreshold2").as_deref(), Some("10"));
    }

    #[test]
    fn a_failed_undo_records_the_change_with_its_full_snapshot() {
        // Owner decision F1 (issue 617): never leave a partly-changed PC without a receipt.
        let mut reg = FakeHkcu { fail_write: Some("GameDVR_Enabled"), fail_undo: true, ..Default::default() }
            .with(GAMEDVR_KEY, "AppCaptureEnabled", reg_dword(1))
            .with(GAME_CONFIG_STORE_KEY, "GameDVR_Enabled", reg_dword(2));
        let r = apply_game_bar_disable_with(&mut reg).expect("recorded, not Err");
        assert!(matches!(
            r.snapshot,
            Snapshot::GameBar { prior_capture: Some(1), prior_enabled: Some(2) }
        ));
    }

    #[test]
    fn an_unreadable_prior_refuses_before_any_write() {
        let mut reg = FakeHkcu { fail_read: Some("MouseThreshold2"), ..Default::default() };
        let err = must_err(apply_mouse_accel_off_with(&mut reg), "refuse");
        assert_eq!(reg.writes, 0, "nothing may be written: {err}");
    }

    #[test]
    fn a_clean_apply_writes_everything_and_snapshots_the_priors() {
        let mut reg = FakeHkcu::default().with(VFX_KEY, "VisualFXSetting", reg_dword(3));
        let r = apply_visual_effects_with(&mut reg).expect("ok");
        assert_eq!(reg.dword(VFX_KEY, "VisualFXSetting"), Some(2));
        assert_eq!(
            reg.get(DESKTOP_KEY, "UserPreferencesMask").map(|v| v.bytes),
            Some(BEST_PERF_USER_PREFS_MASK.to_vec())
        );
        assert!(matches!(
            r.snapshot,
            Snapshot::VisualEffects { vfx_setting_prior: Some(3), user_prefs_mask_prior: None }
        ));
    }

    // ── elevated scripts: text ──

    #[test]
    fn elevated_apply_scripts_undo_from_the_snapshot_and_stay_batchable() {
        let mm = mmcss_apply_script(Some(14));
        assert!(mm.contains("'SystemResponsiveness' -Value 20") && mm.contains("'NetworkThrottlingIndex' -Value 10"));
        assert!(mm.contains("if ($compyDone -ge 1) { try { Set-ItemProperty") && mm.contains("'SystemResponsiveness' -Value 14"));
        let mm_absent = mmcss_apply_script(None);
        assert!(mm_absent.contains("Remove-ItemProperty -Path") && !mm_absent.contains("SilentlyContinue"));

        let ps = power_setting_apply_script(PWR_SUBGROUP_USB, PWR_SETTING_USB_SELECTIVE_SUSPEND, 1);
        assert!(ps.contains(&format!("{PWR_SETTING_USB_SELECTIVE_SUSPEND} 1; if (-not $?)")), "{ps}");
        assert_eq!(ps.matches("if (-not $?)").count(), 3, "both steps and the undo are exit-checked: {ps}");

        let cp = core_parking_apply_script(40, None);
        assert!(cp.contains(&format!("setacvalueindex SCHEME_CURRENT {SUB_PROCESSOR_GUID} {CPMINCORES_GUID} 40")));
        assert!(cp.contains(&format!("setdcvalueindex SCHEME_CURRENT {SUB_PROCESSOR_GUID} {CPMINCORES_GUID} 40")), "DC mirrors AC");
        assert!(cp.find("if ($compyDone -ge 2)").unwrap() < cp.find("if ($compyDone -ge 1)").unwrap(), "newest first");

        for s in [mm, mm_absent, ps, cp] {
            assert!(!contains_exit_token(&s), "exit-free: {s}");
            compose_batch_script(&[("r".to_string(), vec![s])], "x").expect("batchable");
        }
    }

    // ── elevated scripts: the same wrapper, run for real (unelevated, temp files only) ──

    fn run_ps(script: &str) -> bool {
        super::quiet_command("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &format!("$ErrorActionPreference='Stop'; {script}")])
            .status()
            .expect("powershell runs")
            .success()
    }

    fn temp_file(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("compy-617-{}-{tag}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("temp dir");
        let f = dir.join("v.txt");
        std::fs::write(&f, "old").expect("seed");
        f
    }

    fn file_steps(f: &std::path::Path, second: &str, second_native: bool, undo: &str) -> Vec<PsStep> {
        let p = f.to_string_lossy().replace('\'', "''");
        vec![
            PsStep {
                write: format!("Set-Content -LiteralPath '{p}' -Value 'new' -NoNewline"),
                undo: if undo.is_empty() {
                    format!("Set-Content -LiteralPath '{p}' -Value 'old' -NoNewline")
                } else {
                    undo.to_string()
                },
                native: false,
            },
            PsStep { write: second.to_string(), undo: String::new(), native: second_native },
        ]
    }

    #[test]
    fn real_powershell_undoes_the_first_step_when_the_second_throws_or_exits_non_zero() {
        for (tag, second, native) in [
            ("throw", "throw 'boom'", false),
            ("native", "findstr.exe compy617 NUL", true),
        ] {
            let f = temp_file(tag);
            let ok = run_ps(&ps_all_or_restore(&file_steps(&f, second, native, "")));
            assert!(!ok, "{tag}: the apply must fail");
            assert_eq!(std::fs::read_to_string(&f).unwrap(), "old", "{tag}: first step put back");
        }
    }

    #[test]
    fn real_powershell_a_failed_undo_exits_zero_so_the_change_is_recorded() {
        for (tag, undo) in [("undo-throw", "throw 'undo boom'"), ("undo-native", "findstr.exe compy617 NUL")] {
            let f = temp_file(tag);
            let mut steps = file_steps(&f, "throw 'boom'", false, undo);
            steps[0].native = tag == "undo-native";
            // The first WRITE is a cmdlet; mark native only to exercise the $? check on the undo.
            let ok = run_ps(&ps_all_or_restore(&steps));
            assert!(ok, "{tag}: a failed undo must not rethrow (F1: record with full snapshot)");
        }
    }

    #[test]
    fn real_powershell_batch_items_do_not_leak_the_undo_flag() {
        let fa = temp_file("batch-a");
        let fb = temp_file("batch-b");
        let rf = fa.with_file_name("receipts.txt");
        let _ = std::fs::remove_file(&rf);
        let a = ps_all_or_restore(&file_steps(&fa, "throw 'boom'", false, "throw 'undo boom'"));
        let b = ps_all_or_restore(&file_steps(&fb, "throw 'boom'", false, ""));
        let script = compose_batch_script(
            &[("item-a".to_string(), vec![a]), ("item-b".to_string(), vec![b])],
            rf.to_string_lossy().as_ref(),
        )
        .expect("compose");
        assert!(run_ps(&script));
        let receipts = parse_batch_receipts(&std::fs::read_to_string(&rf).unwrap());
        assert_eq!(receipts.get("item-a"), Some(&true), "failed undo -> recorded");
        assert_eq!(receipts.get("item-b"), Some(&false), "clean undo -> fail receipt");
        assert_eq!(std::fs::read_to_string(&fb).unwrap(), "old");
    }

    // ── review round 2 on issue 617: the snapshot must be exact, or the apply refuses ──

    type ApplyWith = fn(&mut dyn HkcuValues) -> Result<ApplyResult, String>;
    type HkcuApplyCase = (&'static str, ApplyWith, Vec<(&'static str, &'static str)>);

    /// Every HKCU multi-write apply with the (subkey, value) pairs it snapshots.
    fn hkcu_applies() -> Vec<HkcuApplyCase> {
        vec![
            (
                "game-bar",
                apply_game_bar_disable_with as ApplyWith,
                vec![(GAMEDVR_KEY, "AppCaptureEnabled"), (GAME_CONFIG_STORE_KEY, "GameDVR_Enabled")],
            ),
            (
                "game-mode",
                apply_game_mode_with as ApplyWith,
                vec![(GAMEBAR_KEY, GAME_MODE_ENABLED_VALUE), (GAMEBAR_KEY, GAME_MODE_ALLOW_VALUE)],
            ),
            (
                "visual-effects",
                apply_visual_effects_with as ApplyWith,
                vec![(VFX_KEY, "VisualFXSetting"), (DESKTOP_KEY, "UserPreferencesMask")],
            ),
            (
                "mouse",
                apply_mouse_accel_off_with as ApplyWith,
                vec![(MOUSE_KEY, "MouseSpeed"), (MOUSE_KEY, "MouseThreshold1"), (MOUSE_KEY, "MouseThreshold2")],
            ),
        ]
    }

    fn assert_refused_untouched(mut reg: FakeHkcu, apply: ApplyWith, what: &str) {
        let before = reg.vals.clone();
        let err = must_err(apply(&mut reg), what);
        assert_eq!(reg.writes, 0, "{what}: nothing may be written: {err}");
        assert!(reg.vals == before, "{what}: registry must be unchanged");
        assert!(err.contains("nothing was changed"), "{what}: {err}");
    }

    #[test]
    fn every_hkcu_apply_refuses_an_unreadable_prior_before_any_write() {
        for (tag, apply, slots) in hkcu_applies() {
            for (_, name) in &slots {
                let reg = FakeHkcu { fail_read: Some(name), ..Default::default() };
                assert_refused_untouched(reg, apply, &format!("{tag}/{name} unreadable"));
            }
        }
    }

    #[test]
    fn a_dword_prior_of_the_wrong_type_refuses_before_any_write() {
        let wrong = [
            ("REG_SZ", winreg::RegValue { bytes: vec![b'1', 0, 0, 0], vtype: RegType::REG_SZ }),
            ("QWORD", winreg::RegValue { bytes: vec![1, 0, 0, 0, 0, 0, 0, 0], vtype: RegType::REG_QWORD }),
            ("short DWORD", winreg::RegValue { bytes: vec![1, 0], vtype: RegType::REG_DWORD }),
        ];
        for (tag, apply, slots) in hkcu_applies() {
            for (subkey, name) in &slots {
                if *name == "UserPreferencesMask" || *subkey == MOUSE_KEY {
                    continue; // not DWORDs
                }
                for (kind, v) in &wrong {
                    let v = winreg::RegValue { bytes: v.bytes.clone(), vtype: v.vtype.clone() };
                    let reg = FakeHkcu::default().with(subkey, name, v);
                    assert_refused_untouched(reg, apply, &format!("{tag}/{name} as {kind}"));
                }
            }
        }
    }

    #[test]
    fn a_user_prefs_mask_that_is_not_binary_refuses_before_any_write() {
        let reg = FakeHkcu::default().with(DESKTOP_KEY, "UserPreferencesMask", reg_dword(7));
        assert_refused_untouched(reg, apply_visual_effects_with, "UserPreferencesMask as DWORD");
    }

    #[test]
    fn a_mouse_prior_that_is_empty_or_not_a_string_refuses_before_any_write() {
        for name in ["MouseSpeed", "MouseThreshold1", "MouseThreshold2"] {
            for (kind, v) in [
                ("present empty", reg_sz("")),
                ("DWORD", reg_dword(1)),
                ("EXPAND_SZ", winreg::RegValue { bytes: reg_sz("1").bytes, vtype: RegType::REG_EXPAND_SZ }),
            ] {
                let reg = FakeHkcu::default().with(MOUSE_KEY, name, v);
                assert_refused_untouched(reg, apply_mouse_accel_off_with, &format!("{name} {kind}"));
            }
        }
    }

    #[test]
    fn a_failed_mouse_undo_records_the_change_with_its_full_snapshot() {
        let mut reg = FakeHkcu { fail_write: Some("MouseThreshold2"), fail_undo: true, ..Default::default() }
            .with(MOUSE_KEY, "MouseSpeed", reg_sz("1"))
            .with(MOUSE_KEY, "MouseThreshold1", reg_sz("6"))
            .with(MOUSE_KEY, "MouseThreshold2", reg_sz("10"));
        let r = apply_mouse_accel_off_with(&mut reg).expect("recorded, not Err");
        match r.snapshot {
            Snapshot::MouseAccel { prior_speed, prior_threshold1, prior_threshold2 } => {
                assert_eq!((prior_speed.as_str(), prior_threshold1.as_str(), prior_threshold2.as_str()), ("1", "6", "10"));
            }
            _ => panic!("wrong snapshot"),
        }
    }

    // ── issue 617 review N2: a present REG_BINARY prior, and F1 for game mode and visual effects ──

    /// A Windows-default-looking mask that differs from BEST_PERF_USER_PREFS_MASK in several bytes.
    const PRIOR_MASK: [u8; 8] = [0x9e, 0x3e, 0x07, 0x80, 0x12, 0x00, 0x00, 0x00];

    fn binary(bytes: &[u8]) -> winreg::RegValue {
        winreg::RegValue { bytes: bytes.to_vec(), vtype: RegType::REG_BINARY }
    }

    #[test]
    fn a_present_binary_user_prefs_mask_is_snapshotted_byte_for_byte() {
        let mut reg = FakeHkcu::default()
            .with(VFX_KEY, "VisualFXSetting", reg_dword(0))
            .with(DESKTOP_KEY, "UserPreferencesMask", binary(&PRIOR_MASK));
        let r = apply_visual_effects_with(&mut reg).expect("ok");
        assert_eq!(
            reg.get(DESKTOP_KEY, "UserPreferencesMask").map(|v| (v.bytes, v.vtype)),
            Some((BEST_PERF_USER_PREFS_MASK.to_vec(), RegType::REG_BINARY))
        );
        match r.snapshot {
            Snapshot::VisualEffects { vfx_setting_prior, user_prefs_mask_prior } => {
                assert_eq!(vfx_setting_prior, Some(0));
                assert_eq!(user_prefs_mask_prior.as_deref(), Some(&PRIOR_MASK[..]), "exactly the prior bytes");
            }
            _ => panic!("wrong snapshot"),
        }
    }

    #[test]
    fn a_failed_game_mode_undo_records_the_change_with_its_full_snapshot() {
        let mut reg = FakeHkcu { fail_write: Some(GAME_MODE_ENABLED_VALUE), fail_undo: true, ..Default::default() }
            .with(GAMEBAR_KEY, GAME_MODE_ALLOW_VALUE, reg_dword(0))
            .with(GAMEBAR_KEY, GAME_MODE_ENABLED_VALUE, reg_dword(7));
        let r = apply_game_mode_with(&mut reg).expect("recorded, not Err");
        assert_eq!(reg.dword(GAMEBAR_KEY, GAME_MODE_ALLOW_VALUE), Some(1), "the first write stands");
        assert!(matches!(r.applied_action, AppliedAction::EnableGameMode));
        assert!(matches!(
            r.snapshot,
            Snapshot::GameMode { prior_enabled: Some(7), prior_allow: Some(0) }
        ));
    }

    #[test]
    fn a_failed_visual_effects_undo_records_the_change_with_its_full_snapshot() {
        let mut reg = FakeHkcu { fail_write: Some("UserPreferencesMask"), fail_undo: true, ..Default::default() }
            .with(VFX_KEY, "VisualFXSetting", reg_dword(3))
            .with(DESKTOP_KEY, "UserPreferencesMask", binary(&PRIOR_MASK));
        let r = apply_visual_effects_with(&mut reg).expect("recorded, not Err");
        assert_eq!(reg.dword(VFX_KEY, "VisualFXSetting"), Some(2), "the first write stands");
        assert!(matches!(r.applied_action, AppliedAction::SetVisualEffectsBestPerformance));
        match r.snapshot {
            Snapshot::VisualEffects { vfx_setting_prior, user_prefs_mask_prior } => {
                assert_eq!(vfx_setting_prior, Some(3));
                assert_eq!(user_prefs_mask_prior.as_deref(), Some(&PRIOR_MASK[..]), "exactly the prior bytes");
            }
            _ => panic!("wrong snapshot"),
        }
    }
}
