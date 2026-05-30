//! actions: the Windows-mutation boundary. Owns every change Sentinel makes to
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
use crate::{fast_startup_state, hags_state, reserved_storage_enabled};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) enum KnownService {
    SysMain,
    DiagTrack,
    WSearch,
    NvTelemetryContainer,
}

impl KnownService {
    fn name(&self) -> &'static str {
        match self {
            KnownService::SysMain => "SysMain",
            KnownService::DiagTrack => "DiagTrack",
            KnownService::WSearch => "WSearch",
            KnownService::NvTelemetryContainer => "NvTelemetryContainer",
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(crate) enum AppliedAction {
    DisableKnownService { service: KnownService },
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
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
pub(crate) enum RollbackAction {
    RestoreServiceFromSnapshot { service: KnownService },
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
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum Snapshot {
    Service {
        prior_state: String,
        prior_start_mode: String,
    },
    GameMode {
        prior_enabled: Option<u32>,
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

pub(crate) fn apply_game_mode() -> Result<ApplyResult, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey("Software\\Microsoft\\GameBar")
        .map_err(|e| e.to_string())?;
    let prior_enabled: Option<u32> = key.get_value("AutoGameModeEnabled").ok();
    key.set_value("AutoGameModeEnabled", &1u32)
        .map_err(|e| e.to_string())?;
    Ok(ApplyResult {
        applied_action: AppliedAction::EnableGameMode,
        rollback_action: RollbackAction::RestoreGameModeFromSnapshot,
        snapshot: Snapshot::GameMode { prior_enabled },
        elevation_used: false,
    })
}

pub(crate) fn rollback_game_mode_typed(prior_enabled: Option<u32>) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags("Software\\Microsoft\\GameBar", KEY_SET_VALUE | KEY_READ)
        .map_err(|e| e.to_string())?;
    match prior_enabled {
        Some(v) => key
            .set_value("AutoGameModeEnabled", &v)
            .map_err(|e| e.to_string())?,
        None => {
            let _ = key.delete_value("AutoGameModeEnabled");
        }
    }
    Ok(())
}

// Documented "Best Performance" value for HKCU\Control Panel\Desktop\UserPreferencesMask
const BEST_PERF_USER_PREFS_MASK: [u8; 8] = [0x90, 0x12, 0x03, 0x80, 0x10, 0x00, 0x00, 0x00];

pub(crate) fn apply_visual_effects() -> Result<ApplyResult, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let (vfx_key, _) = hkcu
        .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects")
        .map_err(|e| e.to_string())?;
    let vfx_setting_prior: Option<u32> = vfx_key.get_value("VisualFXSetting").ok();
    vfx_key
        .set_value("VisualFXSetting", &2u32)
        .map_err(|e| e.to_string())?;

    let (desktop_key, _) = hkcu
        .create_subkey("Control Panel\\Desktop")
        .map_err(|e| e.to_string())?;
    let user_prefs_mask_prior: Option<Vec<u8>> = desktop_key
        .get_raw_value("UserPreferencesMask")
        .ok()
        .map(|v| v.bytes);
    desktop_key
        .set_raw_value(
            "UserPreferencesMask",
            &winreg::RegValue {
                bytes: BEST_PERF_USER_PREFS_MASK.to_vec(),
                vtype: winreg::enums::RegType::REG_BINARY,
            },
        )
        .map_err(|e| e.to_string())?;

    Ok(ApplyResult {
        applied_action: AppliedAction::SetVisualEffectsBestPerformance,
        rollback_action: RollbackAction::RestoreVisualEffectsFromSnapshot,
        snapshot: Snapshot::VisualEffects {
            vfx_setting_prior,
            user_prefs_mask_prior,
        },
        elevation_used: false,
    })
}

// ─── Admin-elevation helper ──────────────────────────────────────────────
// Triggers a Windows UAC prompt; the elevated child runs `program args...`,
// the calling Sentinel process stays at standard user. We use this pattern
// rather than running Sentinel itself elevated, which would force a UAC
// prompt on every launch.

pub(crate) fn run_elevated_powershell(command: &str) -> Result<(), String> {
    let status = runas::Command::new("powershell.exe")
        .args(&[
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-Command",
            command,
        ])
        .status()
        .map_err(|e| format!("could not launch elevated process: {}", e))?;
    if !status.success() {
        return Err(format!(
            "Elevated step did not complete (exit code {}). Did you cancel the UAC prompt?",
            status.code().map(|c| c.to_string()).unwrap_or_else(|| "?".into())
        ));
    }
    Ok(())
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
    let com = COMLibrary::new().ok()?;
    let wmi_conn = WMIConnection::new(com).ok()?;
    let query = format!("SELECT * FROM Win32_Service WHERE Name='{}'", name);
    let results: Vec<Win32Service> = wmi_conn.raw_query(&query).ok()?;
    let svc = results.into_iter().next()?;
    Some((
        svc.state.unwrap_or_else(|| "Unknown".into()),
        svc.start_mode.unwrap_or_else(|| "Unknown".into()),
    ))
}

pub(crate) fn ps_service_startup_for_mode(mode: &str) -> &'static str {
    match mode {
        "Auto" | "Automatic" => "Automatic",
        "Manual" => "Manual",
        "Disabled" => "Disabled",
        _ => "Automatic",
    }
}

// Generic "disable a Windows service" — used for SysMain, NVIDIA telemetry,
// and any future service-shaped rec. Snapshots prior state + start mode so
// rollback returns the service to exactly where it was.
pub(crate) fn apply_service_disable(service: KnownService) -> Result<ApplyResult, String> {
    let (prior_state, prior_start_mode) =
        service_info(service.name()).unwrap_or_else(|| ("Running".into(), "Auto".into()));
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
    let startup = ps_service_startup_for_mode(prior_start_mode);
    let mut cmd = format!("Set-Service -Name {} -StartupType {}", service.name(), startup);
    if prior_state == "Running" {
        cmd.push_str(&format!("; Start-Service -Name {}", service.name()));
    }
    run_elevated_powershell(&cmd)?;
    Ok(())
}

// ─── Power plan: Ultimate Performance ────────────────────────────────────

pub(crate) fn current_power_plan_guid() -> Option<String> {
    let output = Command::new("powercfg").args(["/getactivescheme"]).output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    // Format: "Power Scheme GUID: <36-char-guid>  (Plan Name)"
    for line in stdout.lines() {
        if let Some(idx) = line.find("GUID:") {
            let after = line[idx + 5..].trim_start();
            let guid = after.split_whitespace().next()?.trim();
            if guid.len() == 36 {
                return Some(guid.to_string());
            }
        }
    }
    None
}

pub(crate) fn apply_power_ultimate() -> Result<ApplyResult, String> {
    let prior_guid = current_power_plan_guid().unwrap_or_default();
    let ps = "$ult = powercfg /list | Select-String 'Ultimate Performance' | Select-Object -First 1; \
              if ($ult -match 'GUID: ([0-9a-f-]{36})') { powercfg /setactive $matches[1]; exit 0 } \
              $dup = powercfg /duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 2>&1; \
              if ($dup -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') { powercfg /setactive $matches[1]; exit 0 } \
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
    run_elevated_powershell(&format!("powercfg /setactive {}", prior_guid))?;
    Ok(())
}

// ─── Reserved Storage off (PowerShell cmdlet, admin) ─────────────────────

pub(crate) fn apply_reserved_storage_off() -> Result<ApplyResult, String> {
    let prior_enabled = reserved_storage_enabled();
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

// Returns (ac_value, dc_value) by parsing `powercfg /query SCHEME_CURRENT
// <subgroup> <setting>`. Returns None if the call fails or output can't
// be parsed.
pub(crate) fn query_power_setting_ac_dc(subgroup: &str, setting: &str) -> Option<(u32, u32)> {
    let output = Command::new("powercfg")
        .args(["/query", "SCHEME_CURRENT", subgroup, setting])
        .output()
        .ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut ac_value: Option<u32> = None;
    let mut dc_value: Option<u32> = None;
    for line in stdout.lines() {
        let lower = line.to_lowercase();
        if lower.contains("current ac power setting index:") {
            if let Some(tok) = line.split_whitespace().last() {
                let stripped = tok.trim_start_matches("0x");
                ac_value = u32::from_str_radix(stripped, 16).ok();
            }
        } else if lower.contains("current dc power setting index:") {
            if let Some(tok) = line.split_whitespace().last() {
                let stripped = tok.trim_start_matches("0x");
                dc_value = u32::from_str_radix(stripped, 16).ok();
            }
        }
    }
    Some((ac_value?, dc_value.unwrap_or(0)))
}

pub(crate) fn apply_power_setting_off_on_ac(subgroup: &str, setting: &str) -> Result<ApplyResult, String> {
    // Snapshot first — both AC and DC current values.
    let (prior_ac_value, prior_dc_value) =
        query_power_setting_ac_dc(subgroup, setting).unwrap_or((1, 1));
    let plan_guid = current_power_plan_guid().unwrap_or_default();

    // Apply AC = 0 only. DC stays untouched (laptop battery behavior preserved).
    let cmd = format!(
        "powercfg /setacvalueindex SCHEME_CURRENT {} {} 0; powercfg /setactive SCHEME_CURRENT",
        subgroup, setting
    );
    run_elevated_powershell(&cmd)?;

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

pub(crate) fn apply_usb_selective_suspend_off() -> Result<ApplyResult, String> {
    apply_power_setting_off_on_ac(PWR_SUBGROUP_USB, PWR_SETTING_USB_SELECTIVE_SUSPEND)
}

pub(crate) fn apply_pcie_aspm_off() -> Result<ApplyResult, String> {
    apply_power_setting_off_on_ac(PWR_SUBGROUP_PCIE, PWR_SETTING_PCIE_ASPM)
}

pub(crate) fn rollback_power_plan_setting_typed(
    subgroup_guid: &str,
    setting_guid: &str,
    prior_ac_value: u32,
    prior_dc_value: u32,
) -> Result<(), String> {
    // Restore both AC and DC to exactly their pre-apply values.
    let cmd = format!(
        "powercfg /setacvalueindex SCHEME_CURRENT {0} {1} {2}; \
         powercfg /setdcvalueindex SCHEME_CURRENT {0} {1} {3}; \
         powercfg /setactive SCHEME_CURRENT",
        subgroup_guid, setting_guid, prior_ac_value, prior_dc_value
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

pub(crate) fn enumerate_eee_eligible_adapters() -> Vec<EeeNicSnapshot> {
    let ps = r#"
$adapters = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object {
    $_.Status -eq 'Up' -and $_.PhysicalMediaType -eq '802.3'
}
foreach ($a in $adapters) {
    $props = Get-NetAdapterAdvancedProperty -Name $a.Name -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -match 'Energy[- ]?Efficient[- ]?Ethernet|Green Ethernet|Advanced EEE|^EEE$|EEE PHY' }
    foreach ($p in $props) {
        Write-Output ($a.Name + '|' + $p.DisplayName + '|' + $p.DisplayValue)
    }
}
"#;
    let output = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", ps])
        .output();
    let stdout = match output {
        Ok(o) => String::from_utf8_lossy(&o.stdout).into_owned(),
        Err(_) => return Vec::new(),
    };
    stdout
        .lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(3, '|').collect();
            if parts.len() != 3 {
                return None;
            }
            Some(EeeNicSnapshot {
                adapter_name: parts[0].trim().to_string(),
                property_display_name: parts[1].trim().to_string(),
                prior_value: parts[2].trim().to_string(),
            })
        })
        .collect()
}

pub(crate) fn apply_eee_disable() -> Result<ApplyResult, String> {
    let adapters = enumerate_eee_eligible_adapters();
    if adapters.is_empty() {
        return Err(
            "No active wired Ethernet adapter with an Energy Efficient Ethernet property was found. Sentinel only modifies adapters where the property already exists."
                .into(),
        );
    }

    // Build the apply script — set every eligible (adapter, property) pair
    // to "Disabled". -NoRestart keeps the link up across the change so we
    // don't bounce the user's connection.
    let mut ps = String::new();
    for a in &adapters {
        ps.push_str(&format!(
            "Set-NetAdapterAdvancedProperty -Name '{}' -DisplayName '{}' -DisplayValue 'Disabled' -NoRestart -ErrorAction SilentlyContinue; ",
            a.adapter_name.replace('\'', "''"),
            a.property_display_name.replace('\'', "''"),
        ));
    }
    run_elevated_powershell(&ps)?;

    Ok(ApplyResult {
        applied_action: AppliedAction::DisableEnergyEfficientEthernet,
        rollback_action: RollbackAction::RestoreEnergyEfficientEthernetFromSnapshot,
        snapshot: Snapshot::EeeNicProperty { adapters },
        elevation_used: true,
    })
}

pub(crate) fn rollback_eee_disable_typed(adapters: &[EeeNicSnapshot]) -> Result<(), String> {
    if adapters.is_empty() {
        return Err("snapshot had no EEE adapters to roll back".into());
    }
    let mut ps = String::new();
    for a in adapters {
        ps.push_str(&format!(
            "Set-NetAdapterAdvancedProperty -Name '{}' -DisplayName '{}' -DisplayValue '{}' -NoRestart -ErrorAction SilentlyContinue; ",
            a.adapter_name.replace('\'', "''"),
            a.property_display_name.replace('\'', "''"),
            a.prior_value.replace('\'', "''"),
        ));
    }
    run_elevated_powershell(&ps)?;
    Ok(())
}


// ─── Fast Startup off (HKLM, admin) ──────────────────────────────────────

pub(crate) fn apply_fast_startup_off() -> Result<ApplyResult, String> {
    let prior_hiberboot = fast_startup_state();
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

pub(crate) fn apply_game_bar_disable() -> Result<ApplyResult, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (gd, _) = hkcu
        .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR")
        .map_err(|e| e.to_string())?;
    let prior_capture: Option<u32> = gd.get_value("AppCaptureEnabled").ok();
    gd.set_value("AppCaptureEnabled", &0u32)
        .map_err(|e| e.to_string())?;

    let (gcs, _) = hkcu
        .create_subkey("System\\GameConfigStore")
        .map_err(|e| e.to_string())?;
    let prior_enabled: Option<u32> = gcs.get_value("GameDVR_Enabled").ok();
    gcs.set_value("GameDVR_Enabled", &0u32)
        .map_err(|e| e.to_string())?;

    Ok(ApplyResult {
        applied_action: AppliedAction::DisableGameBarAndDvr,
        rollback_action: RollbackAction::RestoreGameBarFromSnapshot,
        snapshot: Snapshot::GameBar {
            prior_capture,
            prior_enabled,
        },
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
    let prior = hags_state();
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

// ─── Mouse acceleration off (HKCU, no admin) ─────────────────────────────

pub(crate) fn apply_mouse_accel_off() -> Result<ApplyResult, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey("Control Panel\\Mouse")
        .map_err(|e| e.to_string())?;

    // All three values are REG_SZ strings, not DWORDs. Windows is weird.
    let prior_speed: String = key.get_value("MouseSpeed").unwrap_or_default();
    let prior_threshold1: String = key.get_value("MouseThreshold1").unwrap_or_default();
    let prior_threshold2: String = key.get_value("MouseThreshold2").unwrap_or_default();

    let zero = "0".to_string();
    key.set_value("MouseSpeed", &zero).map_err(|e| e.to_string())?;
    key.set_value("MouseThreshold1", &zero).map_err(|e| e.to_string())?;
    key.set_value("MouseThreshold2", &zero).map_err(|e| e.to_string())?;

    Ok(ApplyResult {
        applied_action: AppliedAction::DisableMouseAcceleration,
        rollback_action: RollbackAction::RestoreMouseAccelFromSnapshot,
        snapshot: Snapshot::MouseAccel {
            prior_speed,
            prior_threshold1,
            prior_threshold2,
        },
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

pub(crate) fn apply_nagle_disable() -> Result<ApplyResult, String> {
    // Snapshot (no admin): walk every Tcpip interface, capture prior values
    // on adapters that have an actual IP. Skip loopback / virtual / inactive.
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let interfaces = hklm
        .open_subkey("SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces")
        .map_err(|e| e.to_string())?;
    let mut nic_snapshots: Vec<NagleInterfaceSnapshot> = Vec::new();
    for adapter_name in interfaces.enum_keys().filter_map(|r| r.ok()) {
        let Ok(adapter) = interfaces.open_subkey(&adapter_name) else {
            continue;
        };
        let has_ip = adapter.get_value::<String, _>("DhcpIPAddress").is_ok()
            || adapter.get_value::<String, _>("IPAddress").is_ok();
        if !has_ip {
            continue;
        }
        let prior_ack: Option<u32> = adapter.get_value("TcpAckFrequency").ok();
        let prior_nodelay: Option<u32> = adapter.get_value("TCPNoDelay").ok();
        nic_snapshots.push(NagleInterfaceSnapshot {
            interface: adapter_name,
            prior_ack,
            prior_nodelay,
        });
    }

    let ps = "$ifs = Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces'; \
              foreach ($i in $ifs) { \
                $hasIp = (Get-ItemProperty -Path $i.PSPath -Name 'DhcpIPAddress' -ErrorAction SilentlyContinue) -or (Get-ItemProperty -Path $i.PSPath -Name 'IPAddress' -ErrorAction SilentlyContinue); \
                if ($hasIp) { \
                  Set-ItemProperty -Path $i.PSPath -Name 'TcpAckFrequency' -Value 1 -Type DWord; \
                  Set-ItemProperty -Path $i.PSPath -Name 'TCPNoDelay' -Value 1 -Type DWord; \
                } \
              }";
    run_elevated_powershell(ps)?;
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
        let path = format!(
            "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{}",
            entry.interface
        );
        match entry.prior_ack {
            Some(v) => ps.push_str(&format!(
                "Set-ItemProperty -Path '{}' -Name 'TcpAckFrequency' -Value {} -Type DWord; ",
                path, v
            )),
            None => ps.push_str(&format!(
                "Remove-ItemProperty -Path '{}' -Name 'TcpAckFrequency' -ErrorAction SilentlyContinue; ",
                path
            )),
        }
        match entry.prior_nodelay {
            Some(v) => ps.push_str(&format!(
                "Set-ItemProperty -Path '{}' -Name 'TCPNoDelay' -Value {} -Type DWord; ",
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
pub(crate) fn dispatch_rollback(action: &RollbackAction, snapshot: &Snapshot) -> Result<(), String> {
    use RollbackAction as R;
    use Snapshot as S;
    match (action, snapshot) {
        (
            R::RestoreServiceFromSnapshot { service },
            S::Service { prior_state, prior_start_mode },
        ) => rollback_service_disable_typed(service, prior_state, prior_start_mode),
        (R::RestoreGameModeFromSnapshot, S::GameMode { prior_enabled }) => {
            rollback_game_mode_typed(*prior_enabled)
        }
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
                subgroup_guid,
                setting_guid,
                prior_ac_value,
                prior_dc_value,
                ..
            },
        ) => rollback_power_plan_setting_typed(
            subgroup_guid,
            setting_guid,
            *prior_ac_value,
            *prior_dc_value,
        ),
        (R::RestoreEnergyEfficientEthernetFromSnapshot, S::EeeNicProperty { adapters }) => {
            rollback_eee_disable_typed(adapters)
        }
        _ => Err(format!(
            "rollback action/snapshot mismatch: action={:?}, snapshot kind differs",
            action
        )),
    }
}

// Build a typed (RollbackAction, Snapshot) pair from a legacy AppliedChange
// (one written by a Sentinel version before the typed-action refactor). The
// legacy snapshot was a free-form serde_json::Value whose shape was determined
// by the rec_id; we reconstruct the typed form using the same per-rec_id
// knowledge.
/// Resolve the rollback contract for an AppliedChange using ONLY the stored
/// history — never the live recommendation catalog (ARCHITECTURE_LOCKS §1.5).
/// Prefers the typed contract captured at apply time; falls back to
/// synthesizing one from rec_id + legacy snapshot JSON for entries written by
/// older Sentinel versions. This is the core of "Sentinel can undo what it did
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
            Some((
                RollbackAction::RestoreGameModeFromSnapshot,
                Snapshot::GameMode { prior_enabled },
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
}
