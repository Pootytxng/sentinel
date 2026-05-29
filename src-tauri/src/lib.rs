use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Mutex;

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sysinfo::{Disks, System};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, KEY_SET_VALUE};
use winreg::RegKey;
use wmi::{COMLibrary, WMIConnection};

static HISTORY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Clone)]
struct DiskInfo {
    mount_point: String,
    total_bytes: u64,
    available_bytes: u64,
    file_system: String,
}

#[derive(Serialize, Clone, Default)]
struct GpuInfo {
    name: String,
    vram_bytes: u64,
    driver_version: String,
    driver_date: String,         // ISO 8601 for the UI (or "" if unknown)
    driver_age_days: Option<i64>, // days since DriverDate, if parseable
    video_processor: String,
    current_refresh_rate_hz: u32,
}

#[derive(Deserialize)]
#[serde(rename = "Win32_VideoController")]
#[serde(rename_all = "PascalCase")]
struct Win32VideoController {
    name: Option<String>,
    #[serde(rename = "AdapterRAM")]
    adapter_ram: Option<u64>,
    driver_version: Option<String>,
    driver_date: Option<String>, // CIM_DATETIME, e.g. "20240312123045.000000-420"
    video_processor: Option<String>,
    current_refresh_rate: Option<u32>,
}

#[derive(Serialize, Clone, Default)]
struct PhysicalDiskInfo {
    friendly_name: String,
    media_type: String, // "HDD" | "SSD" | "SCM" | "Unknown"
    bus_type: String,   // "NVMe" | "SATA" | "ATA" | "USB" | "Other"
    size_bytes: u64,
}

#[derive(Serialize, Clone, Default)]
struct MemoryModuleInfo {
    capacity_bytes: u64,
    speed_mhz: u32,
    type_name: String, // "DDR3" | "DDR4" | "DDR5" | "LPDDR4" | "LPDDR5" | "Unknown"
    manufacturer: String,
}

#[derive(Serialize, Clone, Default)]
struct WindowsVersionInfo {
    edition: String,         // "Professional", "Home", "Enterprise", etc.
    display_version: String, // "23H2", "22H2", "21H2"
    build: String,           // "22631", "26100"
    ubr: u32,                // Update Build Revision, the ".X" at the end
    product_name: String,    // Composed display string, e.g. "Windows 11 Pro 23H2"
}

#[derive(Serialize, Clone, Default)]
struct CpuArchInfo {
    vendor: String,       // "AMD" | "Intel" | "ARM" | "Other"
    family_label: String, // e.g. "Ryzen 7 7800X3D" or "Core i7-13700K"
    architecture: String, // e.g. "Zen 4" | "Raptor Lake" | "Alder Lake"
    generation: String,   // e.g. "Zen 4" | "13th Gen" | "7000 series"
}

#[derive(Deserialize)]
#[serde(rename = "Win32_PhysicalMemory")]
#[serde(rename_all = "PascalCase")]
struct Win32PhysicalMemory {
    capacity: Option<u64>,
    configured_clock_speed: Option<u32>,
    speed: Option<u32>,
    #[serde(rename = "SMBIOSMemoryType")]
    smbios_memory_type: Option<u32>,
    manufacturer: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename = "Win32_DiskDrive")]
#[serde(rename_all = "PascalCase")]
struct Win32DiskDrive {
    model: Option<String>,
    interface_type: Option<String>,
    media_type: Option<String>,
    size: Option<u64>,
}

#[derive(Serialize, Clone, Default)]
struct DisplayInfo {
    width: u32,
    height: u32,
    current_refresh_rate_hz: u32,
    max_refresh_rate_hz: u32,
}

#[derive(Deserialize)]
#[serde(rename = "MSFT_PhysicalDisk")]
#[serde(rename_all = "PascalCase")]
struct MsftPhysicalDisk {
    friendly_name: Option<String>,
    media_type: Option<u16>,
    bus_type: Option<u16>,
    size: Option<u64>,
}

#[derive(Serialize, Clone)]
struct HardwareInfo {
    cpu_brand: String,
    cpu_cores_logical: usize,
    cpu_cores_physical: usize,
    cpu_frequency_mhz: u64,
    ram_total_bytes: u64,
    ram_used_bytes: u64,
    swap_total_bytes: u64,
    os_name: String,
    os_version: String,
    kernel_version: String,
    hostname: String,
    disks: Vec<DiskInfo>,
    gpus: Vec<GpuInfo>,
    physical_disks: Vec<PhysicalDiskInfo>,
    display: Option<DisplayInfo>,
    memory_modules: Vec<MemoryModuleInfo>,
    windows_version: Option<WindowsVersionInfo>,
    cpu_arch: Option<CpuArchInfo>,
}

#[derive(Serialize, Deserialize, Clone)]
struct Recommendation {
    id: String,
    title: String,
    category: String,
    severity: String,
    description: String,
    impact: String,
    downside: Option<String>,
    applies_to: String,
    currently_applied: bool,
}

// ─── Step B: Rules JSON schema + loader ──────────────────────────────────
//
// The eventual remote rules.json at the CDN follows this exact schema. The
// embedded baseline ships with the binary so Sentinel always has a known-good
// starting rule set, even with no network access. See docs/ARCHITECTURE_LOCKS
// Tier 2 for the schema-versioning contract.

const RULES_SCHEMA_VERSION: u32 = 1;
const BASELINE_RULES_JSON: &[u8] = include_bytes!("../resources/baseline-rules-v1.json");

#[derive(Deserialize)]
struct RulesFile {
    schema_version: u32,
    #[serde(default)]
    #[allow(dead_code)]
    rules_version: String,
    #[serde(default)]
    #[allow(dead_code)]
    comment: String,
    rules: Vec<RuleSpec>,
}

#[derive(Deserialize, Clone)]
struct RuleSpec {
    id: String,
    title: String,
    category: String,
    severity: String,
    description: String,
    impact: String,
    #[serde(default)]
    downside: Option<String>,
    #[serde(default)]
    applies_to_template: Option<String>,
    #[serde(default)]
    conditions: Vec<Condition>,
    #[serde(default)]
    #[allow(dead_code)]
    apply_kind: Option<String>,
    #[serde(default)]
    #[allow(dead_code)]
    apply_params: Option<serde_json::Value>,
    #[serde(default)]
    state_kind: Option<String>,
    #[serde(default)]
    state_params: Option<serde_json::Value>,
}

// Hardware predicates that gate whether a rule fires. Extensible via additive
// changes; each variant maps to a Rust evaluator in condition_matches().
#[derive(Deserialize, Clone)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum Condition {
    GpuVendor { vendor: String },
    RamGbAtLeast { min_gb: u32 },
    FastStoragePresent,
    AllHdd,
    HasModernDiscreteGpu,
    DisplayUnderdriven { min_gap_hz: u32 },
    OldGpuDriverDays { min_days: i64 },
    StorageBelowFreePercent { mount_prefix: String, percent: f64 },
}

fn load_baseline_rules() -> RulesFile {
    let file: RulesFile = serde_json::from_slice(BASELINE_RULES_JSON)
        .expect("baseline rules JSON must be valid at compile time");
    assert_eq!(
        file.schema_version, RULES_SCHEMA_VERSION,
        "baseline rules schema_version mismatch: file says {}, binary expects {}",
        file.schema_version, RULES_SCHEMA_VERSION
    );
    file
}

fn condition_matches(cond: &Condition, hw: &HardwareInfo) -> bool {
    match cond {
        Condition::GpuVendor { vendor } => gpu_vendor_match(hw, &vendor.to_uppercase()).is_some(),
        Condition::RamGbAtLeast { min_gb } => {
            let ram_gb = hw.ram_total_bytes as f64 / 1024.0_f64.powi(3);
            ram_gb >= *min_gb as f64
        }
        Condition::FastStoragePresent => hw
            .physical_disks
            .iter()
            .any(|d| d.bus_type == "NVMe" || d.media_type == "SSD"),
        Condition::AllHdd => {
            !hw.physical_disks.is_empty()
                && hw.physical_disks.iter().all(|d| d.media_type == "HDD")
        }
        Condition::HasModernDiscreteGpu => hw.gpus.iter().any(|g| {
            let u = g.name.to_uppercase();
            u.contains("RTX")
                || u.contains("GTX 16")
                || u.contains("RX 5")
                || u.contains("RX 6")
                || u.contains("RX 7")
                || u.contains("RX 9")
                || u.contains("ARC ")
                || u.contains("ARC A")
                || u.contains("ARC B")
        }),
        Condition::DisplayUnderdriven { min_gap_hz } => hw
            .display
            .as_ref()
            .map(|d| d.max_refresh_rate_hz.saturating_sub(d.current_refresh_rate_hz) >= *min_gap_hz)
            .unwrap_or(false),
        Condition::OldGpuDriverDays { min_days } => hw
            .gpus
            .iter()
            .filter_map(|g| g.driver_age_days)
            .any(|d| d >= *min_days),
        Condition::StorageBelowFreePercent { mount_prefix, percent } => {
            hw.disks.iter().any(|d| {
                if !d.mount_point.starts_with(mount_prefix) || d.total_bytes == 0 {
                    return false;
                }
                let pct = (d.available_bytes as f64 / d.total_bytes as f64) * 100.0;
                pct < *percent
            })
        }
    }
}

// String-keyed state-check dispatcher. Each kind names an existing Rust
// function; new kinds require a code release. Params allow parameterizing
// shared shapes (e.g. "service-not-running" takes a service name).
fn check_state_kind(kind: &str, params: &Option<serde_json::Value>, _hw: &HardwareInfo) -> bool {
    match kind {
        "game-mode-enabled" => game_mode_enabled(),
        "visual-effects-best-perf" => visual_effects_for_best_performance(),
        "service-not-running" => params
            .as_ref()
            .and_then(|p| p.get("service"))
            .and_then(|s| s.as_str())
            .map(|name| !service_running(name))
            .unwrap_or(false),
        "power-plan-ultimate" => current_power_plan_name()
            .map(|p| p.to_lowercase().contains("ultimate"))
            .unwrap_or(false),
        "nagle-disabled-any-nic" => nagle_disabled_on_any_nic(),
        "hags-on" => hags_state() == Some(2),
        "mouse-accel-disabled" => mouse_accel_disabled(),
        "game-bar-disabled" => game_bar_disabled(),
        "fast-startup-disabled" => fast_startup_state() == Some(0),
        "reserved-storage-disabled" => !reserved_storage_enabled(),
        _ => false,
    }
}

// Minimal {variable} substitution for the applies_to_template field. Keep the
// variable list small and well-known — this is content, not a templating DSL.
fn template_substitute(template: &str, hw: &HardwareInfo) -> String {
    let mut out = template.to_string();
    out = out.replace("{os_name}", &hw.os_name);
    out = out.replace("{os_version}", &hw.os_version);
    out = out.replace("{cpu_brand}", &hw.cpu_brand);
    let ram_gb = hw.ram_total_bytes as f64 / 1024.0_f64.powi(3);
    out = out.replace("{ram_gb_round}", &format!("{:.0}", ram_gb));
    out
}

fn evaluate_rule_spec(spec: &RuleSpec, hw: &HardwareInfo) -> Option<Recommendation> {
    for cond in &spec.conditions {
        if !condition_matches(cond, hw) {
            return None;
        }
    }

    let applies_to = spec
        .applies_to_template
        .as_ref()
        .map(|t| template_substitute(t, hw))
        .unwrap_or_default();

    let currently_applied = spec
        .state_kind
        .as_ref()
        .map(|kind| check_state_kind(kind, &spec.state_params, hw))
        .unwrap_or(false);

    Some(Recommendation {
        id: spec.id.clone(),
        title: spec.title.clone(),
        category: spec.category.clone(),
        severity: spec.severity.clone(),
        description: spec.description.clone(),
        impact: spec.impact.clone(),
        downside: spec.downside.clone(),
        applies_to,
        currently_applied,
    })
}

// Enumerates the primary display's modes via Win32 GDI to find both the
// current refresh rate and the highest supported rate AT THE CURRENT
// RESOLUTION. Comparing the two surfaces the classic "144 Hz monitor
// running at 60 Hz" misconfiguration.
fn detect_display_info() -> Option<DisplayInfo> {
    use std::mem;
    use std::ptr;
    use winapi::um::wingdi::DEVMODEW;
    use winapi::um::winuser::{EnumDisplaySettingsW, ENUM_CURRENT_SETTINGS};

    unsafe {
        let mut current: DEVMODEW = mem::zeroed();
        current.dmSize = mem::size_of::<DEVMODEW>() as u16;
        if EnumDisplaySettingsW(ptr::null(), ENUM_CURRENT_SETTINGS, &mut current) == 0 {
            return None;
        }
        let cw = current.dmPelsWidth;
        let ch = current.dmPelsHeight;
        let chz = current.dmDisplayFrequency;

        let mut max_hz = chz;
        for i in 0..2000u32 {
            let mut mode: DEVMODEW = mem::zeroed();
            mode.dmSize = mem::size_of::<DEVMODEW>() as u16;
            if EnumDisplaySettingsW(ptr::null(), i, &mut mode) == 0 {
                break;
            }
            if mode.dmPelsWidth == cw
                && mode.dmPelsHeight == ch
                && mode.dmDisplayFrequency > max_hz
            {
                max_hz = mode.dmDisplayFrequency;
            }
        }

        Some(DisplayInfo {
            width: cw,
            height: ch,
            current_refresh_rate_hz: chz,
            max_refresh_rate_hz: max_hz,
        })
    }
}

fn detect_physical_disks_msft() -> Vec<PhysicalDiskInfo> {
    // MSFT_PhysicalDisk lives in the Storage namespace; richer detail
    // (media_type as enum, bus_type for NVMe vs SATA) but the namespace
    // is more commonly blocked by AV than plain CIMV2.
    let com = match COMLibrary::new() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let conn = match WMIConnection::with_namespace_path("ROOT\\Microsoft\\Windows\\Storage", com) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let raw: Vec<MsftPhysicalDisk> = conn.query().unwrap_or_default();
    raw.into_iter()
        .map(|d| {
            let media = match d.media_type {
                Some(3) => "HDD",
                Some(4) => "SSD",
                Some(5) => "SCM",
                _ => "Unknown",
            };
            let bus = match d.bus_type {
                Some(17) => "NVMe",
                Some(11) => "SATA",
                Some(3) => "ATA",
                Some(7) => "USB",
                _ => "Other",
            };
            PhysicalDiskInfo {
                friendly_name: d.friendly_name.unwrap_or_default(),
                media_type: media.into(),
                bus_type: bus.into(),
                size_bytes: d.size.unwrap_or(0),
            }
        })
        .collect()
}

// Fallback when the Storage namespace is blocked / empty. Uses the older
// Win32_DiskDrive in the standard CIMV2 namespace, which is more universally
// accessible but loses the NVMe distinction (NVMe drives show as "SCSI"
// interface). Heuristically infer media type from the descriptive string.
fn detect_physical_disks_legacy() -> Vec<PhysicalDiskInfo> {
    let com = match COMLibrary::new() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let conn = match WMIConnection::new(com) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let raw: Vec<Win32DiskDrive> = conn.query().unwrap_or_default();
    raw.into_iter()
        .filter_map(|d| {
            let model = d.model.unwrap_or_default().trim().to_string();
            if model.is_empty() {
                return None;
            }
            // Best-effort media classification from the model/media strings
            let lowered = format!("{} {}", model, d.media_type.clone().unwrap_or_default())
                .to_lowercase();
            let media = if lowered.contains("ssd")
                || lowered.contains("nvme")
                || lowered.contains("solid state")
            {
                "SSD"
            } else if lowered.contains("usb") || lowered.contains("removable") {
                "Removable"
            } else {
                // Default to HDD for "Fixed hard disk media"; this is a
                // heuristic and may be wrong on systems where Win32_DiskDrive
                // doesn't distinguish SSDs.
                "HDD"
            };
            let bus = match d.interface_type.as_deref() {
                Some("SCSI") => "SCSI/NVMe",
                Some("IDE") => "ATA",
                Some("USB") => "USB",
                Some(_) => "Other",
                None => "Other",
            };
            Some(PhysicalDiskInfo {
                friendly_name: model,
                media_type: media.into(),
                bus_type: bus.into(),
                size_bytes: d.size.unwrap_or(0),
            })
        })
        .collect()
}

fn detect_physical_disks() -> Vec<PhysicalDiskInfo> {
    let primary = detect_physical_disks_msft();
    if !primary.is_empty() {
        return primary;
    }
    detect_physical_disks_legacy()
}

// ─── RAM detection: SMBIOS direct read (primary) + WMI fallback ──────────
//
// Win32_PhysicalMemory through WMI is often the first thing locked-down AV
// setups block. The SMBIOS firmware table is what Task Manager, CPU-Z, and
// HWiNFO all use — it goes through GetSystemFirmwareTable, which is a
// straight kernel call. Same data, more accessible.

fn detect_memory_modules_smbios() -> Vec<MemoryModuleInfo> {
    use std::ptr;

    // 'RSMB' as the Windows DWORD signature: 'R' in the high byte.
    const RSMB: u32 = u32::from_be_bytes([b'R', b'S', b'M', b'B']);

    unsafe {
        // First call with 0 buffer size returns the required size.
        let needed = winapi::um::sysinfoapi::GetSystemFirmwareTable(
            RSMB,
            0,
            ptr::null_mut(),
            0,
        );
        if needed == 0 {
            return Vec::new();
        }

        let mut buffer = vec![0u8; needed as usize];
        let written = winapi::um::sysinfoapi::GetSystemFirmwareTable(
            RSMB,
            0,
            buffer.as_mut_ptr() as *mut _,
            needed,
        );
        if written == 0 || written as usize > buffer.len() {
            return Vec::new();
        }

        // RawSMBIOSData header (8 bytes):
        //   [0] Used20CallingMethod
        //   [1] SMBIOSMajorVersion
        //   [2] SMBIOSMinorVersion
        //   [3] DmiRevision
        //   [4..8] Length (u32 little-endian) of the SMBIOS table that follows.
        if buffer.len() < 8 {
            return Vec::new();
        }
        let smbios_len =
            u32::from_le_bytes([buffer[4], buffer[5], buffer[6], buffer[7]]) as usize;
        let end = (8 + smbios_len).min(buffer.len());
        parse_smbios_memory_devices(&buffer[8..end])
    }
}

fn parse_smbios_strings(data: &[u8]) -> Vec<String> {
    let mut strings = Vec::new();
    let mut current: Vec<u8> = Vec::new();
    for &byte in data {
        if byte == 0 {
            if current.is_empty() {
                break; // double null = end of string section
            }
            strings.push(String::from_utf8_lossy(&current).into_owned());
            current.clear();
        } else {
            current.push(byte);
        }
    }
    strings
}

fn parse_smbios_memory_devices(data: &[u8]) -> Vec<MemoryModuleInfo> {
    let mut modules = Vec::new();
    let mut offset = 0usize;

    while offset + 4 <= data.len() {
        let struct_type = data[offset];
        let struct_len = data[offset + 1] as usize;
        if struct_len < 4 {
            break;
        }
        let formatted_end = offset + struct_len;
        if formatted_end > data.len() {
            break;
        }

        // Find end of string section (double null terminator).
        let mut string_end = formatted_end;
        while string_end + 1 < data.len() {
            if data[string_end] == 0 && data[string_end + 1] == 0 {
                string_end += 2;
                break;
            }
            string_end += 1;
        }
        if string_end > data.len() {
            string_end = data.len();
        }

        // End-of-table marker (type 127) — stop walking.
        if struct_type == 127 {
            break;
        }

        // Type 17 = Memory Device. Require enough bytes for the 2.1+
        // structure layout (manufacturer at 0x17 means we need len >= 0x18).
        if struct_type == 17 && struct_len >= 0x18 {
            let size_raw =
                u16::from_le_bytes([data[offset + 0x0C], data[offset + 0x0D]]);

            // 0x0000 = empty slot; skip entirely.
            // 0xFFFF = unknown size; skip.
            // 0x7FFF = use Extended Size at 0x1C-0x1F (in MB).
            // Otherwise: bit 15 set => KB, else MB (low 15 bits).
            let capacity_bytes: u64 = match size_raw {
                0x0000 | 0xFFFF => 0,
                0x7FFF if struct_len >= 0x20 => {
                    let ext = u32::from_le_bytes([
                        data[offset + 0x1C],
                        data[offset + 0x1D],
                        data[offset + 0x1E],
                        data[offset + 0x1F],
                    ]);
                    (ext as u64) * 1024 * 1024
                }
                0x7FFF => 0,
                n if n & 0x8000 != 0 => ((n & 0x7FFF) as u64) * 1024,
                n => (n as u64) * 1024 * 1024,
            };

            if capacity_bytes == 0 {
                offset = string_end;
                continue;
            }

            let mem_type = data[offset + 0x12];
            let type_name = match mem_type {
                0x12 => "DDR",
                0x13 => "DDR2",
                0x14 => "DDR2 FB-DIMM",
                0x18 => "DDR3",
                0x1A => "DDR4",
                0x1B => "LPDDR",
                0x1C => "LPDDR2",
                0x1D => "LPDDR3",
                0x1E => "LPDDR4",
                0x20 => "HBM",
                0x21 => "HBM2",
                0x22 => "DDR5",
                0x23 => "LPDDR5",
                _ => "Unknown",
            }
            .to_string();

            // Speed (peak): bytes 0x15-0x16 in MT/s.
            let peak_speed = if struct_len >= 0x17 {
                u16::from_le_bytes([data[offset + 0x15], data[offset + 0x16]])
            } else {
                0
            };
            // Configured Memory Speed (actual): bytes 0x20-0x21 (SMBIOS 2.7+).
            let configured_speed = if struct_len >= 0x22 {
                u16::from_le_bytes([data[offset + 0x20], data[offset + 0x21]])
            } else {
                0
            };
            // Prefer configured (actual XMP-applied speed), fall back to peak (rated).
            let speed_mhz: u32 = if configured_speed > 0 {
                configured_speed as u32
            } else {
                peak_speed as u32
            };

            // Parse strings section and resolve indices for manufacturer + part number.
            let strings = parse_smbios_strings(&data[formatted_end..string_end]);
            let resolve = |idx: u8| -> String {
                let i = idx as usize;
                if i > 0 && i <= strings.len() {
                    strings[i - 1].trim().to_string()
                } else {
                    String::new()
                }
            };
            let mfg = resolve(data[offset + 0x17]);
            let part = if struct_len > 0x1A {
                resolve(data[offset + 0x1A])
            } else {
                String::new()
            };
            // Filter SMBIOS placeholder strings that just mean "unset".
            let is_placeholder = |s: &str| {
                let lower = s.to_lowercase();
                s.is_empty()
                    || lower == "unknown"
                    || lower == "not specified"
                    || lower.starts_with("0x")
                    || lower.starts_with("array")
            };
            let manufacturer = match (is_placeholder(&mfg), is_placeholder(&part)) {
                (false, false) => format!("{} {}", mfg, part),
                (false, true) => mfg,
                (true, false) => part,
                (true, true) => String::new(),
            };

            modules.push(MemoryModuleInfo {
                capacity_bytes,
                speed_mhz,
                type_name,
                manufacturer,
            });
        }

        offset = string_end;
    }

    modules
}

fn detect_memory_modules_wmi() -> Vec<MemoryModuleInfo> {
    let com = match COMLibrary::new() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let conn = match WMIConnection::new(com) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let raw: Vec<Win32PhysicalMemory> = conn.query().unwrap_or_default();
    raw.into_iter()
        .map(|m| {
            let type_name = match m.smbios_memory_type {
                Some(22) => "DDR2",
                Some(24) => "DDR3",
                Some(26) => "DDR4",
                Some(30) => "LPDDR4",
                Some(34) => "DDR5",
                Some(35) => "LPDDR5",
                _ => "Unknown",
            }
            .to_string();
            MemoryModuleInfo {
                capacity_bytes: m.capacity.unwrap_or(0),
                speed_mhz: m.configured_clock_speed.or(m.speed).unwrap_or(0),
                type_name,
                manufacturer: m.manufacturer.unwrap_or_default().trim().to_string(),
            }
        })
        .collect()
}

// Parse the CPU brand string sysinfo gives us and derive vendor + arch +
// generation. Recognizes mainstream desktop SKUs from the last ~7 years —
// good enough for the "Sentinel knows my CPU" moment and to drive vendor /
// generation-specific recs (PBO on AMD, E-core handling on Intel 12+).
fn parse_cpu_arch(brand: &str) -> Option<CpuArchInfo> {
    let trimmed = brand.trim();
    let lower = trimmed.to_lowercase();

    // ── AMD Ryzen ───────────────────────────────────────────────────────
    if lower.contains("ryzen") {
        // Match "Ryzen <N> <model> ..."
        let words: Vec<&str> = trimmed.split_whitespace().collect();
        for (i, w) in words.iter().enumerate() {
            if w.eq_ignore_ascii_case("Ryzen") && i + 2 < words.len() {
                let tier = words[i + 1]; // "3" / "5" / "7" / "9" / "Threadripper"
                let model = words[i + 2]; // "7800X3D" / "5600X" / etc.
                let first = model.chars().next()?;
                let arch = match first {
                    '1' => "Zen",
                    '2' => "Zen+",
                    '3' => "Zen 2",
                    '4' => "Zen 3 (mobile)",
                    '5' => "Zen 3",
                    '6' => "Zen 3+ (mobile)",
                    '7' => "Zen 4",
                    '8' => "Zen 4 (mobile)",
                    '9' => "Zen 5",
                    _ => return None,
                };
                let family_label = format!("Ryzen {} {}", tier, model);
                let series_digit = first;
                let generation = format!("{}000 series", series_digit);
                return Some(CpuArchInfo {
                    vendor: "AMD".into(),
                    family_label,
                    architecture: arch.into(),
                    generation,
                });
            }
        }
    }

    // ── Intel — explicit "Nth Gen" prefix ───────────────────────────────
    if let Some(first_word) = trimmed.split_whitespace().next() {
        let digits: String = first_word
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect();
        if !digits.is_empty() && trimmed.contains("Gen") && lower.contains("intel") {
            if let Ok(gen) = digits.parse::<u32>() {
                let (arch, gen_label) = intel_arch_for_gen(gen);
                let family_label = intel_family_label(trimmed);
                return Some(CpuArchInfo {
                    vendor: "Intel".into(),
                    family_label,
                    architecture: arch.into(),
                    generation: gen_label,
                });
            }
        }
    }

    // ── Intel — inferred from model number "iN-NNNN[K|F|...]" ───────────
    if lower.contains("intel") && (lower.contains("core") || lower.contains("xeon")) {
        for part in trimmed.split(|c: char| c == ' ' || c == '@') {
            // Find an "iN-NNNN" pattern; could also be "i9-285K" (15th gen).
            if let Some(dash) = part.find('-') {
                let suffix = &part[dash + 1..];
                let digits: String = suffix
                    .chars()
                    .take_while(|c| c.is_ascii_digit())
                    .collect();
                if digits.is_empty() {
                    continue;
                }
                // Heuristic: leading 1-2 digits of a 4-5 digit model = generation.
                // Handle both 4-digit (1st-9th gen) and 5-digit (10th+ gen).
                let gen = if digits.len() >= 5 {
                    digits[..2].parse::<u32>().ok()
                } else if digits.len() == 4 {
                    digits[..1].parse::<u32>().ok()
                } else if digits.len() == 3 {
                    // Ultra "i9-285K" → "2" → ambiguous; fall through
                    digits[..1].parse::<u32>().ok().map(|n| {
                        // 15th gen Ultra family ships with 3-digit numbers like 285
                        if n == 2 {
                            15
                        } else {
                            n
                        }
                    })
                } else {
                    None
                };

                if let Some(gen) = gen {
                    if (6..=15).contains(&gen) {
                        let (arch, gen_label) = intel_arch_for_gen(gen);
                        let family_label = intel_family_label(trimmed);
                        return Some(CpuArchInfo {
                            vendor: "Intel".into(),
                            family_label,
                            architecture: arch.into(),
                            generation: gen_label,
                        });
                    }
                }
            }
        }
    }

    None
}

fn intel_arch_for_gen(gen: u32) -> (&'static str, String) {
    let arch = match gen {
        15 => "Arrow Lake",
        14 => "Raptor Lake Refresh",
        13 => "Raptor Lake",
        12 => "Alder Lake",
        11 => "Rocket Lake / Tiger Lake",
        10 => "Comet Lake / Ice Lake",
        9 => "Coffee Lake Refresh",
        8 => "Coffee Lake",
        7 => "Kaby Lake",
        6 => "Skylake",
        _ => "Unknown",
    };
    let label = format!("{}{} Gen", gen, match gen % 10 {
        1 if gen % 100 != 11 => "st",
        2 if gen % 100 != 12 => "nd",
        3 if gen % 100 != 13 => "rd",
        _ => "th",
    });
    (arch, label)
}

fn intel_family_label(brand: &str) -> String {
    // Strip "(R)" / "(TM)" decoration and the "@ X.YY GHz" suffix to leave
    // just the human-readable family name + model. Example:
    //   "13th Gen Intel(R) Core(TM) i7-13700K"  ->  "Core i7-13700K"
    //   "Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz" -> "Core i7-9700K"
    let cleaned = brand
        .replace("(R)", "")
        .replace("(TM)", "")
        .replace("Intel", "")
        .replace("CPU", "")
        .replace("Processor", "");
    let cleaned = cleaned
        .split('@')
        .next()
        .unwrap_or("")
        .trim();
    // Drop a leading "Nth Gen" if present
    let cleaned = if let Some(idx) = cleaned.find("Gen") {
        cleaned[idx + 3..].trim_start()
    } else {
        cleaned
    };
    let collapsed: String = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed
}

fn detect_windows_version() -> Option<WindowsVersionInfo> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let key = hklm
        .open_subkey("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion")
        .ok()?;
    let build: String = key.get_value("CurrentBuildNumber").unwrap_or_default();
    let build_num: u32 = build.parse().unwrap_or(0);
    let edition: String = key.get_value("EditionID").unwrap_or_default();
    let display_version: String = key.get_value("DisplayVersion").unwrap_or_default();
    let ubr: u32 = key.get_value("UBR").unwrap_or(0);

    // ProductName lies on Windows 11 (still says "Windows 10 Pro" on most
    // systems), so synthesize the major from the build number instead.
    let major = if build_num >= 22000 { "Windows 11" } else { "Windows 10" };
    let edition_pretty = match edition.as_str() {
        "Professional" => "Pro",
        s => s,
    };
    let mut product_name = major.to_string();
    if !edition_pretty.is_empty() {
        product_name.push(' ');
        product_name.push_str(edition_pretty);
    }
    if !display_version.is_empty() {
        product_name.push(' ');
        product_name.push_str(&display_version);
    }

    Some(WindowsVersionInfo {
        edition,
        display_version,
        build,
        ubr,
        product_name,
    })
}

fn detect_memory_modules() -> Vec<MemoryModuleInfo> {
    let primary = detect_memory_modules_smbios();
    if !primary.is_empty() {
        return primary;
    }
    detect_memory_modules_wmi()
}

// CIM_DATETIME looks like "20240312123045.000000-420". We only need the date
// portion; year/month/day are positions 0..4, 4..6, 6..8.
fn cim_date_age_days(cim: &str) -> Option<i64> {
    if cim.len() < 8 {
        return None;
    }
    let year: i32 = cim.get(0..4)?.parse().ok()?;
    let month: u32 = cim.get(4..6)?.parse().ok()?;
    let day: u32 = cim.get(6..8)?.parse().ok()?;
    let dt = chrono::NaiveDate::from_ymd_opt(year, month, day)?;
    let today = Utc::now().date_naive();
    Some((today - dt).num_days().max(0))
}

fn cim_date_iso(cim: &str) -> String {
    if cim.len() < 8 {
        return String::new();
    }
    format!("{}-{}-{}", &cim[0..4], &cim[4..6], &cim[6..8])
}

// GPU detection has two paths because some user environments (notably certain
// AV setups) silently block WMI's Win32_VideoController query. DXGI is what
// every 3D app and game uses to enumerate adapters — AV products almost never
// intercept it because doing so would break every game. So we use DXGI as the
// primary source for name + VRAM (which DXGI reports accurately, unlike WMI's
// 4 GB-capped AdapterRAM), then enrich with WMI for driver info if available.

fn detect_gpus_dxgi() -> Vec<GpuInfo> {
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE,
    };

    let mut gpus = Vec::new();
    unsafe {
        let factory: IDXGIFactory1 = match CreateDXGIFactory1() {
            Ok(f) => f,
            Err(_) => return gpus,
        };

        let mut i = 0u32;
        while let Ok(adapter) = factory.EnumAdapters1(i) {
            i += 1;
            let desc = match adapter.GetDesc1() {
                Ok(d) => d,
                Err(_) => continue,
            };
            // Skip Microsoft Basic Render (software adapter). Flags is a
            // raw u32 in this version of the windows crate; the constant is
            // a typed wrapper with .0 holding the bit value.
            if desc.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0 {
                continue;
            }
            let len = desc
                .Description
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(desc.Description.len());
            let name = String::from_utf16_lossy(&desc.Description[..len])
                .trim()
                .to_string();
            if name.is_empty() {
                continue;
            }
            gpus.push(GpuInfo {
                name,
                vram_bytes: desc.DedicatedVideoMemory as u64,
                ..Default::default()
            });
        }
    }
    gpus
}

fn detect_gpus_wmi() -> Vec<GpuInfo> {
    let com = match COMLibrary::new() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let wmi_conn = match WMIConnection::new(com) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let results: Vec<Win32VideoController> = wmi_conn.query().unwrap_or_default();
    results
        .into_iter()
        .filter_map(|g| {
            let name = g.name.unwrap_or_default();
            if name.is_empty() {
                return None;
            }
            let driver_date_raw = g.driver_date.unwrap_or_default();
            let driver_age_days = cim_date_age_days(&driver_date_raw);
            let driver_date = cim_date_iso(&driver_date_raw);
            Some(GpuInfo {
                name,
                vram_bytes: g.adapter_ram.unwrap_or(0),
                driver_version: g.driver_version.unwrap_or_default(),
                driver_date,
                driver_age_days,
                video_processor: g.video_processor.unwrap_or_default(),
                current_refresh_rate_hz: g.current_refresh_rate.unwrap_or(0),
            })
        })
        .collect()
}

fn detect_gpus() -> Vec<GpuInfo> {
    let mut gpus = detect_gpus_dxgi();
    if gpus.is_empty() {
        return detect_gpus_wmi();
    }
    // Enrich with WMI driver info if accessible; if WMI is blocked we still
    // have the DXGI-derived name + accurate VRAM, which is the most important
    // thing the user sees.
    let wmi_gpus = detect_gpus_wmi();
    for gpu in &mut gpus {
        if let Some(w) = wmi_gpus.iter().find(|w| {
            w.name.eq_ignore_ascii_case(&gpu.name)
                || w.name.contains(&gpu.name)
                || gpu.name.contains(&w.name)
        }) {
            gpu.driver_version = w.driver_version.clone();
            gpu.driver_date = w.driver_date.clone();
            gpu.driver_age_days = w.driver_age_days;
            gpu.video_processor = w.video_processor.clone();
            if gpu.current_refresh_rate_hz == 0 {
                gpu.current_refresh_rate_hz = w.current_refresh_rate_hz;
            }
        }
    }
    gpus
}

fn collect_hardware() -> HardwareInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_else(|| "Unknown CPU".into());
    let cpu_frequency_mhz = sys.cpus().first().map(|c| c.frequency()).unwrap_or(0);
    let cpu_arch = parse_cpu_arch(&cpu_brand);

    let disks = Disks::new_with_refreshed_list()
        .iter()
        .map(|d| DiskInfo {
            mount_point: d.mount_point().to_string_lossy().to_string(),
            total_bytes: d.total_space(),
            available_bytes: d.available_space(),
            file_system: d.file_system().to_string_lossy().to_string(),
        })
        .collect();

    HardwareInfo {
        cpu_brand,
        cpu_cores_logical: sys.cpus().len(),
        cpu_cores_physical: sys.physical_core_count().unwrap_or(0),
        cpu_frequency_mhz,
        ram_total_bytes: sys.total_memory(),
        ram_used_bytes: sys.used_memory(),
        swap_total_bytes: sys.total_swap(),
        os_name: System::name().unwrap_or_else(|| "unknown".into()),
        os_version: System::os_version().unwrap_or_else(|| "unknown".into()),
        kernel_version: System::kernel_version().unwrap_or_else(|| "unknown".into()),
        hostname: System::host_name().unwrap_or_else(|| "unknown".into()),
        cpu_arch,
        disks,
        gpus: detect_gpus(),
        physical_disks: detect_physical_disks(),
        display: detect_display_info(),
        memory_modules: detect_memory_modules(),
        windows_version: detect_windows_version(),
    }
}

#[tauri::command]
fn get_hardware_info() -> HardwareInfo {
    collect_hardware()
}

fn gpu_vendor_match(hw: &HardwareInfo, needle: &str) -> Option<String> {
    hw.gpus
        .iter()
        .find(|g| g.name.to_uppercase().contains(needle))
        .map(|g| g.name.clone())
}

fn current_power_plan_name() -> Option<String> {
    let output = Command::new("powercfg").args(["/getactivescheme"]).output().ok()?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    // Format: "Power Scheme GUID: <guid>  (Plan Name)"
    let start = stdout.find('(')? + 1;
    let end = stdout.rfind(')')?;
    Some(stdout[start..end].trim().to_string())
}

fn game_mode_enabled() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.open_subkey("Software\\Microsoft\\GameBar")
        .and_then(|k| k.get_value::<u32, _>("AutoGameModeEnabled"))
        .map(|v| v == 1)
        .unwrap_or(false)
}

fn service_running(name: &str) -> bool {
    Command::new("sc")
        .args(["query", name])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("RUNNING"))
        .unwrap_or(false)
}

fn visual_effects_for_best_performance() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects")
        .and_then(|k| k.get_value::<u32, _>("VisualFXSetting"))
        .map(|v| v == 2)
        .unwrap_or(false)
}

fn reserved_storage_enabled() -> bool {
    // Win10/11 stashes the reserved-storage configuration here. BaseHardReserveSize
    // is the byte count currently set aside; > 0 = reserved storage is active.
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey("Software\\Microsoft\\ReserveManager")
        .and_then(|k| k.get_value::<u32, _>("BaseHardReserveSize"))
        .map(|v| v > 0)
        .unwrap_or(false)
}

fn fast_startup_state() -> Option<u32> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power")
        .and_then(|k| k.get_value::<u32, _>("HiberbootEnabled"))
        .ok()
}

fn game_bar_disabled() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let capture: Option<u32> = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR")
        .and_then(|k| k.get_value("AppCaptureEnabled"))
        .ok();
    let dvr: Option<u32> = hkcu
        .open_subkey("System\\GameConfigStore")
        .and_then(|k| k.get_value("GameDVR_Enabled"))
        .ok();
    capture == Some(0) && dvr == Some(0)
}

fn hags_state() -> Option<u32> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey("SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers")
        .and_then(|k| k.get_value::<u32, _>("HwSchMode"))
        .ok()
}

fn mouse_accel_disabled() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) = hkcu.open_subkey("Control Panel\\Mouse") else {
        return false;
    };
    let speed: String = key.get_value("MouseSpeed").unwrap_or_default();
    // MouseSpeed = 0 means acceleration off; 1 or 2 means on.
    speed == "0"
}

fn nagle_disabled_on_any_nic() -> bool {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(interfaces) =
        hklm.open_subkey("SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces")
    else {
        return false;
    };
    for adapter_name in interfaces.enum_keys().filter_map(|r| r.ok()) {
        let Ok(adapter) = interfaces.open_subkey(&adapter_name) else {
            continue;
        };
        if adapter.get_value::<u32, _>("TcpAckFrequency").ok() == Some(1)
            && adapter.get_value::<u32, _>("TCPNoDelay").ok() == Some(1)
        {
            return true;
        }
    }
    false
}

fn build_recommendations(hw: &HardwareInfo) -> Vec<Recommendation> {
    let mut recs: Vec<Recommendation> = Vec::new();

    // ── Step B: rules loaded from the embedded baseline JSON ──────────
    // Currently empty in commit B; first rec (game-mode) migrates over in C.
    let baseline = load_baseline_rules();
    for spec in &baseline.rules {
        if let Some(rec) = evaluate_rule_spec(spec, hw) {
            recs.push(rec);
        }
    }

    let active_plan = current_power_plan_name().unwrap_or_default();
    let on_ultimate = active_plan.to_lowercase().contains("ultimate");

    // ─── Universal Windows tweaks ────────────────────────────────────────
    recs.push(Recommendation {
        id: "power-ultimate".into(),
        title: "Switch to the Ultimate Performance power plan".into(),
        category: "Power".into(),
        severity: "moderate".into(),
        description:
            "Windows ships with a hidden 'Ultimate Performance' power plan that keeps your CPU at peak responsiveness instead of letting it nap between workloads. Better for gaming. The honest tradeoff: this permanently switches your daily power profile, so the higher power draw is in effect even when you're not gaming. A future Sentinel release will offer a Gaming Mode that automatically switches to high-performance only while a game is running, so your daily profile stays alone — this rec is the manual interim option.".into(),
        impact: "Lower input latency · steadier frame times (when gaming)".into(),
        downside: Some("Permanently mutates your daily power profile until you roll back. Higher idle power draw (~5–10 W on most desktops). A smarter game-aware switch is planned.".into()),
        applies_to: if active_plan.is_empty() {
            "Windows desktop".into()
        } else {
            format!("Currently on '{}'", active_plan)
        },
        currently_applied: on_ultimate,
    });

    // game-mode is now defined in src-tauri/resources/baseline-rules-v1.json
    // and emitted by the load_baseline_rules() pass earlier in this fn.
    // This is the first rec to live as data rather than code -- proof that
    // the schema, conditions, applies_to_template, and state_kind dispatch
    // can fully reconstruct the runtime Recommendation.

    // startup-debloat rec was replaced by the dedicated "Startup apps" UI
    // section, which lets the user toggle individual entries directly.

    // visual-effects, mouse-accel-off, game-bar-disable, diagtrack-disable,
    // windows-search-disable: all migrated to baseline-rules-v1.json.

    // reserved-storage-off is a SPACE tweak, not a performance tweak. Per the
    // cross-LLM review (see commit 5221756 doc updates), this should only fire
    // when reclaiming ~7-10 GB actually matters -- i.e. when C: free space is
    // already getting tight. On systems with plenty of free space, suggesting
    // it pollutes the catalog with noise that erodes user trust.
    let c_drive_free_pct = hw.disks.iter().find_map(|d| {
        if d.mount_point.starts_with("C:") && d.total_bytes > 0 {
            Some((d.available_bytes as f64 / d.total_bytes as f64) * 100.0)
        } else {
            None
        }
    });
    if c_drive_free_pct.map(|pct| pct < 25.0).unwrap_or(false) {
        recs.push(Recommendation {
            id: "reserved-storage-off".into(),
            title: "Disable Windows Reserved Storage (reclaim ~7–10 GB on C:)".into(),
            category: "Storage".into(),
            severity: "safe".into(),
            description:
                "Windows sets aside ~7–10 GB of your C: drive as a working area for major updates. Your C: drive is getting tight on free space, so reclaiming this is an immediate, visible space win. Only shown when C: is under ~25% free.".into(),
            impact: "Reclaim ~7–10 GB on C: · no functional impact for most users".into(),
            downside: Some("If C: gets very full during a feature update, Windows may fail to install it cleanly until you free space manually.".into()),
            applies_to: format!(
                "C: at {:.0}% free — reserved storage is worth reclaiming",
                c_drive_free_pct.unwrap_or(0.0)
            ),
            currently_applied: !reserved_storage_enabled(),
        });
    }

    recs.push(Recommendation {
        id: "fast-startup-off".into(),
        title: "Disable Fast Startup".into(),
        category: "Power".into(),
        severity: "safe".into(),
        description:
            "Fast Startup makes 'Shut down' actually hibernate the Windows kernel session instead of fully shutting down. It saves a few seconds at boot but causes drivers to keep stale state between sessions, breaks dual-boot setups, and is one of the most common silent causes of post-update weirdness ('Windows Update applied but I'm still seeing the bug').".into(),
        impact: "Clean shutdowns · drivers reload fresh each boot · fixes a category of 'why is X behaving weird' issues".into(),
        downside: Some("Cold boot will take a few extra seconds (typically 3-8 s on NVMe).".into()),
        applies_to: match fast_startup_state() {
            Some(1) => "Currently enabled (default on most installs)".into(),
            Some(0) => "Currently disabled".into(),
            _ => "Not yet configured".into(),
        },
        currently_applied: fast_startup_state() == Some(0),
    });

    // ─── GPU vendor-specific ─────────────────────────────────────────────
    if let Some(name) = gpu_vendor_match(hw, "NVIDIA") {
        let telemetry_running = service_running("NvTelemetryContainer");
        recs.push(Recommendation {
            id: "nvidia-telemetry".into(),
            title: "Disable NVIDIA Container telemetry services".into(),
            category: "GPU".into(),
            severity: "safe".into(),
            description:
                "NVIDIA's driver bundle ships several background services that exist mainly to send usage data and check for GeForce Experience updates. They consume RAM and CPU constantly. Disabling them does not affect game performance or driver functionality.".into(),
            impact: "Free ~150–250 MB RAM · less background CPU".into(),
            downside: Some("GeForce Experience won't auto-update; you can still update manually.".into()),
            applies_to: name.clone(),
            currently_applied: !telemetry_running,
        });

        recs.push(Recommendation {
            id: "nvidia-low-latency".into(),
            title: "Set NVIDIA 'Low Latency Mode' to Ultra (per-game)".into(),
            category: "GPU".into(),
            severity: "safe".into(),
            description:
                "Forces the driver to pre-render fewer frames, which shaves a frame or two of input latency. Ideal for competitive shooters; less useful for slower-paced games.".into(),
            impact: "Lower input lag in fast-paced games".into(),
            downside: Some("Can slightly reduce maximum FPS in GPU-bound titles.".into()),
            applies_to: "NVIDIA GPU + latency profile".into(),
            currently_applied: false,
        });
    }

    if let Some(name) = gpu_vendor_match(hw, "AMD").or_else(|| gpu_vendor_match(hw, "RADEON")) {
        recs.push(Recommendation {
            id: "amd-uxp".into(),
            title: "Opt out of the AMD User Experience Program".into(),
            category: "GPU".into(),
            severity: "safe".into(),
            description:
                "AMD's Adrenalin software opts you in by default to a telemetry program that sends usage data. Turning it off has no performance impact.".into(),
            impact: "Less background network traffic · privacy".into(),
            downside: None,
            applies_to: name,
            currently_applied: false,
        });
    }

    if gpu_vendor_match(hw, "INTEL").is_some()
        && hw.gpus.iter().any(|g| !g.name.to_uppercase().contains("INTEL"))
    {
        // Has Intel + a discrete card → very likely a laptop or hybrid setup
        recs.push(Recommendation {
            id: "gpu-prefer-discrete".into(),
            title: "Force games to use your discrete GPU".into(),
            category: "GPU".into(),
            severity: "safe".into(),
            description:
                "Your PC has both an Intel iGPU and a discrete GPU. Windows sometimes routes games to the iGPU by mistake, tanking performance. Pin individual games to the discrete card in Settings → Display → Graphics.".into(),
            impact: "Massive FPS gain if a game is mis-routed".into(),
            downside: Some("Slightly higher battery drain on laptops.".into()),
            applies_to: "Hybrid GPU setup detected".into(),
            currently_applied: false,
        });
    }

    // ─── Storage-conditional ─────────────────────────────────────────────
    for disk in &hw.disks {
        if disk.total_bytes == 0 {
            continue;
        }
        let pct_free = (disk.available_bytes as f64 / disk.total_bytes as f64) * 100.0;
        if pct_free < 15.0 && disk.mount_point.starts_with("C:") {
            recs.push(Recommendation {
                id: "storage-c-low".into(),
                title: "Free up space on C:".into(),
                category: "Storage".into(),
                severity: "safe".into(),
                description:
                    "Your system drive is nearly full. Below ~15% free, Windows starts to thrash, paging gets sluggish, and updates can fail. Disk Cleanup + uninstalling unused games is the easiest win.".into(),
                impact: "Restores normal disk performance · prevents update failures".into(),
                downside: None,
                applies_to: format!("{} ({:.0}% free)", disk.mount_point, pct_free),
                currently_applied: false,
            });
            break;
        }
    }

    // ─── RAM + storage-conditional ───────────────────────────────────────
    let ram_gb = hw.ram_total_bytes as f64 / 1024.0_f64.powi(3);
    let has_nvme = hw.physical_disks.iter().any(|d| d.bus_type == "NVMe");
    let has_ssd = hw.physical_disks.iter().any(|d| d.media_type == "SSD");
    let only_hdd = !hw.physical_disks.is_empty()
        && hw.physical_disks.iter().all(|d| d.media_type == "HDD");

    // SysMain is GOOD on HDDs (it pre-caches apps to speed up launches). Only
    // recommend disabling when fast storage is present, where the benefit is
    // marginal and the disk thrashing complaint applies.
    if ram_gb >= 16.0 && (has_nvme || has_ssd) {
        let storage_kind = if has_nvme { "NVMe" } else { "SSD" };
        recs.push(Recommendation {
            id: "sysmain-disable".into(),
            title: "Disable SysMain (Superfetch)".into(),
            category: "Windows".into(),
            severity: "moderate".into(),
            description:
                "SysMain preloads frequently-used apps into RAM to make them launch faster. With 16 GB+ of RAM and fast storage this benefit is small, and on NVMe systems SysMain often causes mysterious disk thrashing instead.".into(),
            impact: "Lower idle disk activity · ~100–200 MB RAM back".into(),
            downside: Some("App launches will be a tiny bit slower (usually unnoticeable on fast storage).".into()),
            applies_to: format!("{:.0} GB RAM · {} storage detected", ram_gb, storage_kind),
            currently_applied: !service_running("SysMain"),
        });
    }

    // Hardware-accelerated GPU Scheduling: modern GPUs only, requires reboot.
    {
        let state = hags_state();
        let has_modern_gpu = hw.gpus.iter().any(|g| {
            let u = g.name.to_uppercase();
            u.contains("RTX")
                || u.contains("GTX 16")
                || u.contains("RX 5")
                || u.contains("RX 6")
                || u.contains("RX 7")
                || u.contains("RX 9")
                || u.contains("ARC ")
                || u.contains("ARC A")
                || u.contains("ARC B")
        });
        if has_modern_gpu {
            recs.push(Recommendation {
                id: "hags-enable".into(),
                title: "Enable Hardware-accelerated GPU Scheduling".into(),
                category: "GPU".into(),
                severity: "safe".into(),
                description:
                    "Lets the GPU manage its own memory and command queue directly instead of routing through the Windows display driver. On supported hardware this reduces input latency and frees up CPU cycles, especially in modern games. Requires a reboot to take effect.".into(),
                impact: "Lower input latency · CPU cycles freed up for game logic".into(),
                downside: Some("Reboot required. Very occasionally a specific driver/game combo regresses with HAGS on — easy to roll back if it doesn't feel right.".into()),
                applies_to: match state {
                    Some(0) => "Currently: Auto (driver chooses)".into(),
                    Some(1) => "Currently: Off".into(),
                    Some(2) => "Currently: On".into(),
                    _ => "Modern GPU detected — HAGS not yet configured".into(),
                },
                currently_applied: state == Some(2),
            });
        }
    }

    // Monitor refresh rate — the classic "your 144 Hz monitor is at 60 Hz" hidden value.
    if let Some(display) = &hw.display {
        let gap = display
            .max_refresh_rate_hz
            .saturating_sub(display.current_refresh_rate_hz);
        if gap >= 24 && display.max_refresh_rate_hz > 0 {
            recs.push(Recommendation {
                id: "monitor-max-refresh".into(),
                title: "Bump your display to its maximum refresh rate".into(),
                category: "Display".into(),
                severity: "safe".into(),
                description:
                    "Your display supports a much higher refresh rate than it's currently running at. Higher refresh = noticeably smoother motion and lower input lag, at zero hardware cost. Change in Settings → System → Display → Advanced display → Choose a refresh rate.".into(),
                impact: "Smoother motion · lower input lag · feels dramatically faster".into(),
                downside: Some("Slightly higher idle power draw.".into()),
                applies_to: format!(
                    "{}×{} at {} Hz, supports {} Hz",
                    display.width,
                    display.height,
                    display.current_refresh_rate_hz,
                    display.max_refresh_rate_hz
                ),
                currently_applied: false,
            });
        }
    }

    // GPU driver freshness — flag when ANY adapter's driver is meaningfully stale.
    let oldest_driver_days = hw
        .gpus
        .iter()
        .filter_map(|g| g.driver_age_days)
        .max();
    if let Some(days) = oldest_driver_days {
        if days >= 90 {
            let vendor = if gpu_vendor_match(hw, "NVIDIA").is_some() {
                "NVIDIA"
            } else if gpu_vendor_match(hw, "AMD").is_some() || gpu_vendor_match(hw, "RADEON").is_some() {
                "AMD"
            } else if gpu_vendor_match(hw, "INTEL").is_some() {
                "Intel"
            } else {
                "GPU"
            };
            let months = days / 30;
            recs.push(Recommendation {
                id: "gpu-driver-update".into(),
                title: "Update your graphics driver".into(),
                category: "GPU".into(),
                severity: "safe".into(),
                description:
                    "Your installed graphics driver is several months old. Driver updates routinely include game-specific performance improvements, bug fixes for newly-released titles, and security patches. Update through GeForce Experience / NVIDIA App, AMD Adrenalin, or Intel Graphics Command Center.".into(),
                impact: "Better game performance · fewer crashes · latest features (DLSS, FSR, frame-gen)".into(),
                downside: Some("New drivers occasionally introduce regressions — keep the previous installer in case you need to roll back.".into()),
                applies_to: format!("{} driver is ~{} months old", vendor, months),
                currently_applied: false,
            });
        }
    }

    // HDD-only advisory: the single biggest performance win is hardware, not a tweak.
    if only_hdd {
        recs.push(Recommendation {
            id: "ssd-upgrade-advisory".into(),
            title: "Upgrade your system drive to an SSD".into(),
            category: "Storage".into(),
            severity: "moderate".into(),
            description:
                "Every physical drive Sentinel detected is a spinning hard drive. Windows on an HDD is the single biggest performance handicap on a modern PC — game load times, app launches, and Windows itself will be dramatically faster on an SSD or NVMe drive. Typical cost: $40–100 for 500 GB.".into(),
            impact: "Multi-second → sub-second boot · 5–10× faster app launches".into(),
            downside: Some("Requires a hardware purchase and either a Windows reinstall or a drive clone.".into()),
            applies_to: "Spinning HDDs only — no SSDs detected".into(),
            currently_applied: false,
        });
    }

    // ─── Network ─────────────────────────────────────────────────────────
    // nagle-disable migrated to baseline-rules-v1.json.

    recs
}

#[tauri::command]
fn get_recommendations() -> Vec<Recommendation> {
    let hw = collect_hardware();
    build_recommendations(&hw)
}

// ─── Apply / Rollback ────────────────────────────────────────────────────
//
// See docs/ARCHITECTURE_LOCKS §2 for the typed-allowlist contract:
//   AppliedAction   = what was done at apply time (typed enum, allowlist)
//   RollbackAction  = how to undo using the stored Snapshot (separate enum
//                     so future apply-path refactors can change AppliedAction
//                     variants without breaking rollback of historical entries)
//   Snapshot        = prior machine state, also typed
//
// Remote rules can only select among these variants. Unknown variants reject
// at parse time. Privileged behavior never decodes free-form strings.

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
enum KnownService {
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
enum AppliedAction {
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
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case", deny_unknown_fields)]
enum RollbackAction {
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
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum Snapshot {
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
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct NagleInterfaceSnapshot {
    interface: String,
    prior_ack: Option<u32>,
    prior_nodelay: Option<u32>,
}

// What an apply_* function produces. Carries the full rollback contract
// independent of the live recommendation catalog.
struct ApplyResult {
    applied_action: AppliedAction,
    rollback_action: RollbackAction,
    snapshot: Snapshot,
    elevation_used: bool,
}

#[derive(Serialize, Deserialize, Clone)]
struct AppliedChange {
    id: String,
    rec_id: String,
    rec_title: String,
    applied_at: String,
    snapshot: serde_json::Value, // for legacy entries: untyped; for new entries: typed Snapshot serialized
    status: String, // "applied" | "rolled_back"

    // Additive per ARCHITECTURE_LOCKS Tier 1: rollback contract captured at
    // apply time so rollback survives rule deprecation, catalog changes, CDN
    // outages, and app version mismatches. Optional for compat with old
    // history.json entries written before these fields existed.
    #[serde(default)]
    applied_action: Option<AppliedAction>,
    #[serde(default)]
    rollback_action: Option<RollbackAction>,
    #[serde(default)]
    app_version_at_apply: Option<String>,
    #[serde(default)]
    ruleset_version_at_apply: Option<String>,
    #[serde(default)]
    elevation_used: Option<bool>,
}

// AppliedChange + a freshly-computed `is_still_active` flag. We never persist
// this flag (state changes outside Sentinel can revert what we applied), so it
// has to be recomputed every time history is read.
#[derive(Serialize)]
struct AppliedChangeView {
    id: String,
    rec_id: String,
    rec_title: String,
    applied_at: String,
    snapshot: serde_json::Value,
    status: String,
    is_still_active: bool,
    applied_action: Option<AppliedAction>,
    rollback_action: Option<RollbackAction>,
    app_version_at_apply: Option<String>,
    ruleset_version_at_apply: Option<String>,
    elevation_used: Option<bool>,
}

fn check_change_active(c: &AppliedChange) -> bool {
    match c.rec_id.as_str() {
        "game-mode" => game_mode_enabled(),
        "visual-effects" => visual_effects_for_best_performance(),
        "sysmain-disable" => !service_running("SysMain"),
        "nvidia-telemetry" => !service_running("NvTelemetryContainer"),
        "power-ultimate" => current_power_plan_name()
            .map(|p| p.to_lowercase().contains("ultimate"))
            .unwrap_or(false),
        "nagle-disable" => nagle_disabled_on_any_nic(),
        "hags-enable" => hags_state() == Some(2),
        "mouse-accel-off" => mouse_accel_disabled(),
        "game-bar-disable" => game_bar_disabled(),
        "diagtrack-disable" => !service_running("DiagTrack"),
        "windows-search-disable" => !service_running("WSearch"),
        "fast-startup-off" => fast_startup_state() == Some(0),
        "reserved-storage-off" => !reserved_storage_enabled(),
        _ => true, // unknown rec → assume still active rather than hide rollback
    }
}

fn into_view(c: AppliedChange) -> AppliedChangeView {
    let is_still_active = if c.status == "applied" {
        check_change_active(&c)
    } else {
        false
    };
    AppliedChangeView {
        id: c.id,
        rec_id: c.rec_id,
        rec_title: c.rec_title,
        applied_at: c.applied_at,
        snapshot: c.snapshot,
        status: c.status,
        is_still_active,
        applied_action: c.applied_action,
        rollback_action: c.rollback_action,
        app_version_at_apply: c.app_version_at_apply,
        ruleset_version_at_apply: c.ruleset_version_at_apply,
        elevation_used: c.elevation_used,
    }
}

fn sentinel_data_dir() -> PathBuf {
    let app_data = std::env::var("APPDATA").unwrap_or_else(|_| "C:\\Temp".into());
    PathBuf::from(app_data).join("Sentinel")
}

fn history_path() -> PathBuf {
    sentinel_data_dir().join("history.json")
}

fn load_history() -> Vec<AppliedChange> {
    let path = history_path();
    if !path.exists() {
        return Vec::new();
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_history(h: &[AppliedChange]) -> Result<(), String> {
    fs::create_dir_all(sentinel_data_dir()).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(h).map_err(|e| e.to_string())?;
    fs::write(history_path(), json).map_err(|e| e.to_string())
}

fn apply_game_mode() -> Result<ApplyResult, String> {
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

fn rollback_game_mode_typed(prior_enabled: Option<u32>) -> Result<(), String> {
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

fn apply_visual_effects() -> Result<ApplyResult, String> {
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

fn run_elevated_powershell(command: &str) -> Result<(), String> {
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
struct Win32Service {
    state: Option<String>,
    start_mode: Option<String>,
}

fn service_info(name: &str) -> Option<(String, String)> {
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

fn ps_service_startup_for_mode(mode: &str) -> &'static str {
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
fn apply_service_disable(service: KnownService) -> Result<ApplyResult, String> {
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

fn rollback_service_disable_typed(
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

fn current_power_plan_guid() -> Option<String> {
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

fn apply_power_ultimate() -> Result<ApplyResult, String> {
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

fn rollback_power_ultimate_typed(prior_guid: &str) -> Result<(), String> {
    if prior_guid.len() != 36 {
        return Err("no valid prior plan GUID in snapshot".into());
    }
    run_elevated_powershell(&format!("powercfg /setactive {}", prior_guid))?;
    Ok(())
}

// ─── Reserved Storage off (PowerShell cmdlet, admin) ─────────────────────

fn apply_reserved_storage_off() -> Result<ApplyResult, String> {
    let prior_enabled = reserved_storage_enabled();
    run_elevated_powershell("Set-WindowsReservedStorageState -State Disabled")?;
    Ok(ApplyResult {
        applied_action: AppliedAction::DisableReservedStorage,
        rollback_action: RollbackAction::RestoreReservedStorageFromSnapshot,
        snapshot: Snapshot::ReservedStorage { prior_enabled },
        elevation_used: true,
    })
}

fn rollback_reserved_storage_off_typed(prior_enabled: bool) -> Result<(), String> {
    let state = if prior_enabled { "Enabled" } else { "Disabled" };
    run_elevated_powershell(&format!("Set-WindowsReservedStorageState -State {}", state))?;
    Ok(())
}

// ─── Fast Startup off (HKLM, admin) ──────────────────────────────────────

fn apply_fast_startup_off() -> Result<ApplyResult, String> {
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

fn rollback_fast_startup_off_typed(prior_hiberboot: Option<u32>) -> Result<(), String> {
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

fn apply_game_bar_disable() -> Result<ApplyResult, String> {
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

fn rollback_game_bar_disable_typed(
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

fn apply_hags_enable() -> Result<ApplyResult, String> {
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

fn rollback_hags_enable_typed(prior: Option<u32>) -> Result<(), String> {
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

fn apply_mouse_accel_off() -> Result<ApplyResult, String> {
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

fn rollback_mouse_accel_off_typed(
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

fn apply_nagle_disable() -> Result<ApplyResult, String> {
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

fn rollback_nagle_disable_typed(
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

fn rollback_visual_effects_typed(
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
fn dispatch_rollback(action: &RollbackAction, snapshot: &Snapshot) -> Result<(), String> {
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
fn synthesize_legacy_rollback(
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

#[tauri::command]
fn apply_recommendation(rec_id: String, rec_title: String) -> Result<AppliedChangeView, String> {
    let _lock = HISTORY_LOCK
        .lock()
        .map_err(|_| "history lock poisoned".to_string())?;
    let result: ApplyResult = match rec_id.as_str() {
        "game-mode" => apply_game_mode()?,
        "visual-effects" => apply_visual_effects()?,
        "sysmain-disable" => apply_service_disable(KnownService::SysMain)?,
        "nvidia-telemetry" => apply_service_disable(KnownService::NvTelemetryContainer)?,
        "power-ultimate" => apply_power_ultimate()?,
        "nagle-disable" => apply_nagle_disable()?,
        "hags-enable" => apply_hags_enable()?,
        "mouse-accel-off" => apply_mouse_accel_off()?,
        "game-bar-disable" => apply_game_bar_disable()?,
        "diagtrack-disable" => apply_service_disable(KnownService::DiagTrack)?,
        "windows-search-disable" => apply_service_disable(KnownService::WSearch)?,
        "fast-startup-off" => apply_fast_startup_off()?,
        "reserved-storage-off" => apply_reserved_storage_off()?,
        other => return Err(format!("'{}' is not yet supported for one-click apply", other)),
    };
    let snapshot_json = serde_json::to_value(&result.snapshot)
        .map_err(|e| format!("snapshot serialize: {}", e))?;
    let change = AppliedChange {
        id: format!("{}-{}", rec_id, Utc::now().timestamp_millis()),
        rec_id,
        rec_title,
        applied_at: Utc::now().to_rfc3339(),
        snapshot: snapshot_json,
        status: "applied".into(),
        applied_action: Some(result.applied_action),
        rollback_action: Some(result.rollback_action),
        app_version_at_apply: Some(env!("CARGO_PKG_VERSION").to_string()),
        ruleset_version_at_apply: Some("1.0.0-baseline".to_string()),
        elevation_used: Some(result.elevation_used),
    };
    let mut history = load_history();
    history.push(change.clone());
    save_history(&history)?;
    Ok(into_view(change))
}

#[tauri::command]
fn rollback_change(change_id: String) -> Result<(), String> {
    let _lock = HISTORY_LOCK
        .lock()
        .map_err(|_| "history lock poisoned".to_string())?;
    let mut history = load_history();
    let idx = history
        .iter()
        .position(|c| c.id == change_id)
        .ok_or_else(|| format!("change '{}' not found in history", change_id))?;
    let change = history[idx].clone();
    if change.status == "rolled_back" {
        return Err("change has already been rolled back".into());
    }

    // Prefer the typed contract stored at apply time (new entries). Fall back
    // to synthesizing one from rec_id + legacy snapshot JSON (entries written
    // by older Sentinel versions). Rollback never depends on the live rec
    // catalog — per ARCHITECTURE_LOCKS §1.5, the history is the source of truth.
    let (action, snapshot) = if let Some(ra) = change.rollback_action.clone() {
        let snap: Snapshot = serde_json::from_value(change.snapshot.clone())
            .map_err(|e| format!("snapshot deserialize: {}", e))?;
        (ra, snap)
    } else {
        synthesize_legacy_rollback(&change.rec_id, &change.snapshot).ok_or_else(|| {
            format!(
                "legacy AppliedChange for rec_id '{}' has no typed rollback contract and no legacy synthesizer matched",
                change.rec_id
            )
        })?
    };

    dispatch_rollback(&action, &snapshot)?;

    history[idx].status = "rolled_back".into();
    save_history(&history)?;
    Ok(())
}

#[tauri::command]
fn get_applied_changes() -> Vec<AppliedChangeView> {
    load_history().into_iter().map(into_view).collect()
}

// ─── Startup apps (HKCU Run) ─────────────────────────────────────────────
//
// Windows tracks auto-start entries in HKCU\...\Run and HKLM\...\Run.
// Task Manager's "Disabled" state is a separate registry blob under
// StartupApproved\Run — first byte = 0x02 (enabled) or 0x03 (disabled),
// followed by an 8-byte timestamp (which we always zero out).
//
// V1 is HKCU-only. HKLM (system-wide) entries are visible but need admin
// to toggle — we'll add that when we re-use the UAC elevation pattern.

#[derive(Serialize, Clone)]
struct StartupEntry {
    name: String,
    command: String,
    enabled: bool,
}

#[tauri::command]
fn get_startup_entries() -> Vec<StartupEntry> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(run_key) = hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run") else {
        return Vec::new();
    };
    let approval = hkcu
        .open_subkey(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run",
        )
        .ok();

    let mut entries = Vec::new();
    for value_result in run_key.enum_values() {
        let Ok((name, _)) = value_result else { continue };
        let command: String = run_key.get_value(&name).unwrap_or_default();
        let enabled = approval
            .as_ref()
            .and_then(|k| k.get_raw_value(&name).ok())
            .map(|v| v.bytes.first().copied() != Some(0x03))
            .unwrap_or(true); // default enabled if no approval entry exists
        entries.push(StartupEntry {
            name,
            command,
            enabled,
        });
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    entries
}

#[tauri::command]
fn set_startup_entry_enabled(name: String, enabled: bool) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run")
        .map_err(|e| e.to_string())?;
    let first_byte = if enabled { 0x02u8 } else { 0x03u8 };
    let bytes = vec![first_byte, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    key.set_raw_value(
        &name,
        &winreg::RegValue {
            bytes,
            vtype: winreg::enums::RegType::REG_BINARY,
        },
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_hardware_info,
            get_recommendations,
            apply_recommendation,
            rollback_change,
            get_applied_changes,
            get_startup_entries,
            set_startup_entry_enabled,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
