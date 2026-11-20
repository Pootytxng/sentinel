//! Hardware inventory: WMI / DXGI / SMBIOS / GDI / registry detection of the
//! machine, the `HardwareInfo` data model the rest of the app reads, and the
//! parsing helpers. Pure detection — no recommendation policy, no apply/
//! rollback. This is the foundation layer recommendations, monitoring, and
//! diagnostics consume. Boundary move only; no behavior change. (GPU detection
//! is AMD-verified / NVIDIA-implemented-unverified; that confidence wording
//! lives in the monitoring UI, not here.)

use chrono::Utc;
use serde::{Deserialize, Serialize};
use sysinfo::{Disks, System};
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;
use wmi::{COMLibrary, WMIConnection};

#[derive(Serialize, Clone, Default)]
pub(crate) struct DiskInfo {
    pub(crate) mount_point: String,
    pub(crate) total_bytes: u64,
    pub(crate) available_bytes: u64,
    pub(crate) file_system: String,
}

#[derive(Serialize, Clone, Default)]
pub(crate) struct GpuInfo {
    pub(crate) name: String,
    pub(crate) vram_bytes: u64,
    pub(crate) driver_version: String,
    pub(crate) driver_date: String,         // ISO 8601 for the UI (or "" if unknown)
    pub(crate) driver_age_days: Option<i64>, // days since DriverDate, if parseable
    pub(crate) video_processor: String,
    pub(crate) current_refresh_rate_hz: u32,
}

#[derive(Deserialize)]
#[serde(rename = "Win32_VideoController")]
#[serde(rename_all = "PascalCase")]
pub(crate) struct Win32VideoController {
    pub(crate) name: Option<String>,
    #[serde(rename = "AdapterRAM")]
    pub(crate) adapter_ram: Option<u64>,
    pub(crate) driver_version: Option<String>,
    pub(crate) driver_date: Option<String>, // CIM_DATETIME, e.g. "20240312123045.000000-420"
    pub(crate) video_processor: Option<String>,
    pub(crate) current_refresh_rate: Option<u32>,
}

#[derive(Serialize, Clone, Default)]
pub(crate) struct PhysicalDiskInfo {
    pub(crate) friendly_name: String,
    pub(crate) media_type: String, // "HDD" | "SSD" | "SCM" | "Unknown"
    pub(crate) bus_type: String,   // "NVMe" | "SATA" | "ATA" | "USB" | "Other"
    pub(crate) size_bytes: u64,
}

#[derive(Serialize, Clone, Default)]
pub(crate) struct MemoryModuleInfo {
    pub(crate) capacity_bytes: u64,
    pub(crate) speed_mhz: u32, // configured / running speed (MT/s)
    /// Max-capable speed (SMBIOS 0x15 / WMI Speed), MT/s; 0 if unknown. Compared against
    /// `speed_mhz` to honestly flag RAM running below what it's rated for.
    pub(crate) rated_speed_mhz: u32,
    pub(crate) type_name: String, // "DDR3" | "DDR4" | "DDR5" | "LPDDR4" | "LPDDR5" | "Unknown"
    pub(crate) manufacturer: String,
    /// "running_below_rated" (actionable — XMP/EXPO likely off) | "running_at_rated" (no profile
    /// claim — a JEDEC kit also runs at rated) | "unknown". Never claims a profile is "active".
    pub(crate) xmp_expo_status: String,
    /// The memory channel the firmware's BANK label names for this module ("P0 CHANNEL A"), via
    /// `memory_channel_from_label`; `None` when the bank label names no channel ("BANK 0").
    pub(crate) bank_channel: Option<String>,
    /// The memory channel the firmware's SLOT label names ("Controller0-ChannelB-DIMM0" ->
    /// "CONTROLLER0 CHANNEL B"); `None` when it names none ("DIMM A1"). Kept apart from
    /// `bank_channel` so a count never mixes the two label kinds. Compy never guesses a channel
    /// from slot order or module count.
    pub(crate) slot_channel: Option<String>,
}

/// The channel one firmware memory label names, if any. The result keeps whatever scopes the
/// channel inside that label (processor, controller) and is uppercased with separators collapsed,
/// so "Controller0-ChannelA" and "CONTROLLER0 CHANNEL A" compare equal and two controllers'
/// "Channel A" stay distinct. The id after "channel" must be one letter or a run of digits that
/// ends the token ("ChannelA-DIMM0", "CHANNEL 1"); anything glued on ("ChannelADIMM0") is
/// ambiguous and gives `None`, as does a label without "channel" ("BANK 0", "DIMM A1").
pub(crate) fn memory_channel_from_label(label: &str) -> Option<String> {
    let upper = label.to_uppercase();
    let at = upper.find("CHANNEL")?;
    let rest = upper[at + "CHANNEL".len()..].trim_start_matches([' ', '_', '-']);
    let token: String = rest.chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
    // `token` is ASCII alphanumeric only: one character of either kind, or digits only.
    let id_ok = token.len() == 1 || (!token.is_empty() && token.bytes().all(|b| b.is_ascii_digit()));
    if !id_ok {
        return None;
    }
    let scope: Vec<&str> = upper[..at]
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|s| !s.is_empty())
        .collect();
    let mut key = scope.join(" ");
    if !key.is_empty() {
        key.push(' ');
    }
    key.push_str("CHANNEL ");
    key.push_str(&token);
    Some(key)
}

/// How many distinct memory channels the modules' labels name, or `None` when that can't be
/// read. One label kind must name a channel for EVERY module: bank labels first (AMD boards),
/// then slot labels (Intel). A set that names channels only partly, or only by mixing the two
/// kinds, is unknown rather than guessed.
pub(crate) fn named_memory_channel_count(modules: &[MemoryModuleInfo]) -> Option<usize> {
    fn count<'a>(it: impl Iterator<Item = Option<&'a str>>) -> Option<usize> {
        it.collect::<Option<std::collections::BTreeSet<&str>>>().map(|s| s.len())
    }
    if modules.is_empty() {
        return None;
    }
    count(modules.iter().map(|m| m.bank_channel.as_deref()))
        .or_else(|| count(modules.iter().map(|m| m.slot_channel.as_deref())))
}

#[derive(Serialize, Clone, Default)]
pub(crate) struct BiosInfo {
    pub(crate) manufacturer: String,   // "American Megatrends International, LLC.", "Phoenix", etc.
    pub(crate) version: String,        // SMBIOSBIOSVersion, e.g. "1.A95"
    pub(crate) release_date: String,   // ISO "2026-03-15", or "" if unparseable
    pub(crate) release_date_age_days: Option<i64>, // days since publication, if parseable
}

#[derive(Serialize, Clone, Default)]
pub(crate) struct WindowsVersionInfo {
    pub(crate) edition: String,         // "Professional", "Home", "Enterprise", etc.
    pub(crate) display_version: String, // "23H2", "22H2", "21H2"
    pub(crate) build: String,           // "22631", "26100"
    pub(crate) ubr: u32,                // Update Build Revision, the ".X" at the end
    pub(crate) product_name: String,    // Composed display string, e.g. "Windows 11 Pro 23H2"
}

#[derive(Serialize, Clone, Default)]
pub(crate) struct CpuArchInfo {
    pub(crate) vendor: String,       // "AMD" | "Intel" | "ARM" | "Other"
    pub(crate) family_label: String, // e.g. "Ryzen 7 7800X3D" or "Core i7-13700K"
    pub(crate) architecture: String, // e.g. "Zen 4" | "Raptor Lake" | "Alder Lake"
    pub(crate) generation: String,   // e.g. "Zen 4" | "13th Gen" | "7000 series"
}

#[derive(Deserialize)]
#[serde(rename = "Win32_PhysicalMemory")]
#[serde(rename_all = "PascalCase")]
pub(crate) struct Win32PhysicalMemory {
    pub(crate) capacity: Option<u64>,
    pub(crate) configured_clock_speed: Option<u32>,
    pub(crate) speed: Option<u32>,
    #[serde(rename = "SMBIOSMemoryType")]
    pub(crate) smbios_memory_type: Option<u32>,
    pub(crate) manufacturer: Option<String>,
    pub(crate) bank_label: Option<String>,
    pub(crate) device_locator: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename = "Win32_DiskDrive")]
#[serde(rename_all = "PascalCase")]
pub(crate) struct Win32DiskDrive {
    pub(crate) model: Option<String>,
    pub(crate) interface_type: Option<String>,
    pub(crate) media_type: Option<String>,
    pub(crate) size: Option<u64>,
}

#[derive(Serialize, Clone, Default)]
pub(crate) struct DisplayInfo {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) current_refresh_rate_hz: u32,
    pub(crate) max_refresh_rate_hz: u32,
    /// True if ANY attached display reports HDR-capable characteristics via
    /// DXGI (BitsPerColor >= 10 AND MaxLuminance >= 400 nits — HDR400 floor).
    /// This is strictly capability; does NOT require Windows HDR mode be on.
    #[serde(default)]
    pub(crate) hdr_capable: bool,
}

#[derive(Deserialize)]
#[serde(rename = "MSFT_PhysicalDisk")]
#[serde(rename_all = "PascalCase")]
pub(crate) struct MsftPhysicalDisk {
    pub(crate) friendly_name: Option<String>,
    // DeviceId is a string ("0", "1", …) that matches MSFT_Partition.DiskNumber.
    pub(crate) device_id: Option<String>,
    pub(crate) media_type: Option<u16>,
    pub(crate) bus_type: Option<u16>,
    pub(crate) size: Option<u64>,
    pub(crate) health_status: Option<u16>, // 0 Healthy | 1 Warning | 2 Unhealthy | 5 Unknown
}

#[derive(Serialize, Clone, Default)]
pub(crate) struct HardwareInfo {
    pub(crate) cpu_brand: String,
    pub(crate) cpu_cores_logical: usize,
    pub(crate) cpu_cores_physical: usize,
    pub(crate) cpu_frequency_mhz: u64,
    pub(crate) ram_total_bytes: u64,
    pub(crate) ram_used_bytes: u64,
    pub(crate) swap_total_bytes: u64,
    pub(crate) os_name: String,
    pub(crate) os_version: String,
    pub(crate) kernel_version: String,
    pub(crate) hostname: String,
    pub(crate) disks: Vec<DiskInfo>,
    pub(crate) gpus: Vec<GpuInfo>,
    pub(crate) physical_disks: Vec<PhysicalDiskInfo>,
    /// OS SMART-summary health per physical disk (separate from physical_disks to avoid touching
    /// its many test construction sites). Empty when the Storage namespace is blocked.
    pub(crate) disk_health: Vec<DiskHealth>,
    pub(crate) display: Option<DisplayInfo>,
    pub(crate) memory_modules: Vec<MemoryModuleInfo>,
    pub(crate) windows_version: Option<WindowsVersionInfo>,
    /// Motherboard firmware: version + publication date + age. None when Win32_BIOS is unreadable.
    pub(crate) bios_info: Option<BiosInfo>,
    /// Hypervisor present (VBS/Hyper-V/WSL2/VM) + CPU SVM/VT-x firmware state. None when WMI fails.
    pub(crate) virtualization: Option<VirtualizationInfo>,
    /// USB platform capability tier (from host-controller names). None when WMI fails.
    pub(crate) usb: Option<UsbSummary>,
    pub(crate) cpu_arch: Option<CpuArchInfo>,
    pub(crate) has_active_wired_ethernet: bool,
    /// A physical wired-Ethernet PORT exists (regardless of whether a cable is plugged in) —
    /// the eligibility signal for wired-only recs. Distinct from `has_active_wired_ethernet`
    /// (currently connected).
    pub(crate) has_wired_ethernet_port: bool,
    /// An Up wired adapter exposes an EEE switch Compy can safely flip (matched property AND a
    /// recognized disabled value). Gates the eee-disable rec so a failing apply is never offered
    /// on rigs whose driver hides or renames the switch (tester-found, 2026-06-10).
    pub(crate) eee_switch_exposed: bool,
    /// Full classified adapter inventory — drives evidence-naming UI + the Export hardware section.
    pub(crate) network_adapters: Vec<NetAdapterInfo>,
    /// Active Wi-Fi link quality (band/signal/rate) — Some ONLY when the active connection is Wi-Fi
    /// (probed read-only via `netsh wlan show interfaces`; None on wired rigs / when unparseable).
    pub(crate) wifi_link: Option<WifiLink>,
    /// Policy-based QoS policy names (machine + user). Empty on the common case (no policies); when
    /// present they shape network traffic priority — surfaced as an advisory. Read-only registry read.
    pub(crate) qos_policies: Vec<String>,
    /// Compact at-a-glance network-readiness pills (connection · Wi-Fi quality · QoS), DERIVED from
    /// the fields above — no probe of its own. The backend half of the network-readiness pills; the
    /// UI half (content/peripheral) renders them. Read-only, zero-outbound.
    pub(crate) network_pills: Vec<NetworkPill>,
    pub(crate) game_storage: GameStorage,
    /// Connected display models from EDID (WmiMonitorID). Empty when root\wmi is blocked.
    pub(crate) monitors: Vec<MonitorInfo>,
}

// Enumerates the primary display's modes via Win32 GDI to find both the
// current refresh rate and the highest supported rate AT THE CURRENT
// RESOLUTION. Comparing the two surfaces the classic "144 Hz monitor
// running at 60 Hz" misconfiguration.
pub(crate) fn detect_display_info() -> Option<DisplayInfo> {
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
            hdr_capable: detect_any_hdr_capable_output(),
        })
    }
}

// Capability probe via DXGI: enumerate all adapter outputs, query IDXGIOutput6
// for DXGI_OUTPUT_DESC1, and return true if any reports BitsPerColor >= 10
// AND MaxLuminance >= 400 nits. Using the stricter pair-check avoids false
// positives on 10-bit-color SDR panels that don't have the brightness range
// to make HDR content look right. We deliberately do NOT require Windows
// HDR mode to be active right now — the advisory is about CAPABILITY, so
// the user can decide whether to enable HDR per-game.
pub(crate) fn detect_any_hdr_capable_output() -> bool {
    use windows::core::Interface;
    use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, IDXGIOutput6};

    unsafe {
        let factory: IDXGIFactory1 = match CreateDXGIFactory1() {
            Ok(f) => f,
            Err(_) => return false,
        };
        let mut adapter_idx = 0u32;
        while let Ok(adapter) = factory.EnumAdapters1(adapter_idx) {
            adapter_idx += 1;
            let mut output_idx = 0u32;
            while let Ok(output) = adapter.EnumOutputs(output_idx) {
                output_idx += 1;
                let Ok(output6) = output.cast::<IDXGIOutput6>() else {
                    continue;
                };
                let Ok(desc) = output6.GetDesc1() else {
                    continue;
                };
                if desc.BitsPerColor >= 10 && desc.MaxLuminance >= 400.0 {
                    return true;
                }
            }
        }
    }
    false
}

pub(crate) fn detect_physical_disks_msft() -> Vec<PhysicalDiskInfo> {
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

// ─── Disk health / S.M.A.R.T. summary (detection-layer Probe #6, partial) ─────
// MSFT_PhysicalDisk.HealthStatus is the OS's rolled-up SMART verdict (Healthy/Warning/Unhealthy).
// We surface the SUMMARY only — per-attribute SMART (wear %, reallocated sectors) is vendor-
// proprietary and needs a vendor SDK (honestly dropped). Storage namespace blocked → empty list,
// never a guessed verdict.
#[derive(Serialize, Clone, Default)]
pub(crate) struct DiskHealth {
    pub(crate) friendly_name: String,
    pub(crate) health: String, // "Healthy" | "Warning" | "Unhealthy" | "Unknown"
}

/// MSFT_PhysicalDisk HealthStatus enum → plain English. Unknown for anything unexpected.
pub(crate) fn disk_health_label(health: Option<u16>) -> &'static str {
    match health {
        Some(0) => "Healthy",
        Some(1) => "Warning",
        Some(2) => "Unhealthy",
        _ => "Unknown",
    }
}

pub(crate) fn detect_disk_health() -> Vec<DiskHealth> {
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
        .filter_map(|d| {
            let name = d.friendly_name.unwrap_or_default().trim().to_string();
            if name.is_empty() {
                return None;
            }
            Some(DiskHealth {
                friendly_name: name,
                health: disk_health_label(d.health_status).into(),
            })
        })
        .collect()
}

#[cfg(test)]
mod disk_health_tests {
    use super::disk_health_label;

    #[test]
    fn health_status_enum_maps_to_plain_english() {
        assert_eq!(disk_health_label(Some(0)), "Healthy");
        assert_eq!(disk_health_label(Some(1)), "Warning");
        assert_eq!(disk_health_label(Some(2)), "Unhealthy");
        assert_eq!(disk_health_label(Some(5)), "Unknown");
        assert_eq!(disk_health_label(None), "Unknown");
    }
}

// Fallback when the Storage namespace is blocked / empty. Uses the older
// Win32_DiskDrive in the standard CIMV2 namespace, which is more universally
// accessible but loses the NVMe distinction (NVMe drives show as "SCSI"
// interface). Heuristically infer media type from the descriptive string.
pub(crate) fn detect_physical_disks_legacy() -> Vec<PhysicalDiskInfo> {
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

pub(crate) fn detect_physical_disks() -> Vec<PhysicalDiskInfo> {
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

pub(crate) fn detect_memory_modules_smbios() -> Vec<MemoryModuleInfo> {
    use std::ptr;

    // 'RSMB' as the Windows DWORD signature: 'R' in the high byte.
    const RSMB: u32 = u32::from_be_bytes(*b"RSMB");

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

pub(crate) fn parse_smbios_strings(data: &[u8]) -> Vec<String> {
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

/// Honest memory-speed status from (max-capable, configured) MT/s. We can PROVE "running below
/// rated" (actionable: XMP/EXPO likely off, or a stability fallback), but NOT "XMP active" — a plain
/// JEDEC kit also runs at its rated speed and SMBIOS can't tell the two apart. 0 in either field
/// (pre-2.7 SMBIOS / WMI gap) → "unknown"; we never guess a profile.
pub(crate) fn mem_speed_status(rated_mhz: u32, configured_mhz: u32) -> &'static str {
    match (rated_mhz, configured_mhz) {
        (0, _) | (_, 0) => "unknown",
        (r, c) if c < r => "running_below_rated",
        _ => "running_at_rated",
    }
}

pub(crate) fn parse_smbios_memory_devices(data: &[u8]) -> Vec<MemoryModuleInfo> {
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
            // Device Locator (0x10, the slot) and Bank Locator (0x11) are SMBIOS 2.1+ strings.
            // struct_len >= 0x18 (checked above) covers both bytes.
            let slot_channel = memory_channel_from_label(&resolve(data[offset + 0x10]));
            let bank_channel = memory_channel_from_label(&resolve(data[offset + 0x11]));
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
                rated_speed_mhz: peak_speed as u32,
                type_name,
                manufacturer,
                xmp_expo_status: mem_speed_status(peak_speed as u32, configured_speed as u32)
                    .to_string(),
                bank_channel,
                slot_channel,
            });
        }

        offset = string_end;
    }

    modules
}

pub(crate) fn detect_memory_modules_wmi() -> Vec<MemoryModuleInfo> {
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
            let rated = m.speed.unwrap_or(0);
            let configured = m.configured_clock_speed.unwrap_or(0);
            MemoryModuleInfo {
                bank_channel: memory_channel_from_label(m.bank_label.as_deref().unwrap_or("")),
                slot_channel: memory_channel_from_label(m.device_locator.as_deref().unwrap_or("")),
                capacity_bytes: m.capacity.unwrap_or(0),
                speed_mhz: m.configured_clock_speed.or(m.speed).unwrap_or(0),
                rated_speed_mhz: rated,
                type_name,
                manufacturer: m.manufacturer.unwrap_or_default().trim().to_string(),
                xmp_expo_status: mem_speed_status(rated, configured).to_string(),
            }
        })
        .collect()
}

// Parse the CPU brand string sysinfo gives us and derive vendor + arch +
// generation. Recognizes mainstream desktop SKUs from the last ~7 years —
// good enough for the "Compy knows my CPU" moment and to drive vendor /
// generation-specific recs (PBO on AMD, E-core handling on Intel 12+).
pub(crate) fn parse_cpu_arch(brand: &str) -> Option<CpuArchInfo> {
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
                    '4' => "Zen 2 (mobile)", // 4000-series mobile (Renoir) is Zen 2, not Zen 3
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
        for part in trimmed.split([' ', '@']) {
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

pub(crate) fn intel_arch_for_gen(gen: u32) -> (&'static str, String) {
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

pub(crate) fn intel_family_label(brand: &str) -> String {
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

pub(crate) fn detect_windows_version() -> Option<WindowsVersionInfo> {
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

pub(crate) fn detect_memory_modules() -> Vec<MemoryModuleInfo> {
    let primary = detect_memory_modules_smbios();
    if !primary.is_empty() {
        return primary;
    }
    detect_memory_modules_wmi()
}

// CIM_DATETIME looks like "20240312123045.000000-420". We only need the date
// portion; year/month/day are positions 0..4, 4..6, 6..8.
// ── NIC driver freshness (R2 driver win-source v1) — LAZY, off the hot path ────────────────────
// Win32_PnPSignedDriver is slow to enumerate, so this NEVER rides get_hardware_info /
// collect_hardware; it has its own read-only command the Check surface calls lazily behind the
// driver-freshness card (the R1 item-6 fork, resolved this way on purpose).

#[derive(Serialize, Clone)]
pub(crate) struct NicDriverInfo {
    pub(crate) name: String,
    pub(crate) driver_date: String, // ISO, "" if unknown
    pub(crate) driver_age_days: Option<i64>,
    /// Lowercase vendor key for the UI's copyable support-link map ("unknown" → no link shown).
    pub(crate) vendor: String,
}

#[derive(Deserialize)]
#[serde(rename = "Win32_PnPSignedDriver")]
#[serde(rename_all = "PascalCase")]
struct PnpSignedDriver {
    device_name: Option<String>,
    driver_date: Option<String>, // CIM_DATETIME
    manufacturer: Option<String>,
}

pub(crate) fn nic_vendor(manufacturer: &str, name: &str) -> &'static str {
    let s = format!("{manufacturer} {name}").to_lowercase();
    if s.contains("intel") || s.contains("killer") {
        "intel" // Killer NICs are Intel-supported today
    } else if s.contains("realtek") {
        "realtek"
    } else if s.contains("qualcomm") || s.contains("atheros") {
        "qualcomm"
    } else if s.contains("broadcom") {
        "broadcom"
    } else if s.contains("mediatek") {
        "mediatek"
    } else {
        "unknown"
    }
}

/// Pure row mapper: Microsoft-manufactured NET entries are virtual plumbing (WAN Miniport,
/// Hyper-V, loopback) — not a user-updatable NIC driver, so they're dropped. Every kept row
/// carries its device name, so any heuristic miss self-identifies in the UI/export.
fn nic_driver_from(
    device_name: Option<String>,
    manufacturer: Option<String>,
    driver_date: Option<String>,
) -> Option<NicDriverInfo> {
    let name = device_name?;
    let manufacturer = manufacturer.unwrap_or_default();
    if manufacturer.eq_ignore_ascii_case("microsoft") {
        return None;
    }
    let raw = driver_date.unwrap_or_default();
    Some(NicDriverInfo {
        vendor: nic_vendor(&manufacturer, &name).to_string(),
        driver_age_days: cim_date_age_days(&raw),
        driver_date: cim_date_iso(&raw),
        name,
    })
}

fn collect_nic_drivers() -> Vec<NicDriverInfo> {
    let Ok(com) = COMLibrary::new() else { return Vec::new() };
    let Ok(conn) = WMIConnection::new(com) else { return Vec::new() };
    let rows: Vec<PnpSignedDriver> = conn
        .raw_query("SELECT DeviceName, DriverDate, Manufacturer FROM Win32_PnPSignedDriver WHERE DeviceClass = 'NET'")
        .unwrap_or_default();
    let mut seen = std::collections::HashSet::new();
    rows.into_iter()
        .filter_map(|d| nic_driver_from(d.device_name, d.manufacturer, d.driver_date))
        .filter(|n| seen.insert(n.name.clone())) // multi-port adapters: one row per name
        .collect()
}

/// LAZY read-only IPC — deliberately its own command so the slow PnPSignedDriver enumeration
/// never lags the hot hardware path.
#[tauri::command]
pub(crate) fn get_nic_driver_info() -> Vec<NicDriverInfo> {
    on_wmi_thread(collect_nic_drivers)
}

/// Parse the date prefix of a CIM_DATETIME (`yyyymmdd…`) into a real calendar date, or `None`.
/// The SINGLE source of truth for both the ISO string and the age, so the two can never disagree.
/// Boundary-safe via `.get()` (a multi-byte UTF-8 char straddling an index would panic on raw
/// byte-slicing) AND value-safe: `Win32_BIOS.ReleaseDate` is firmware-controlled, so non-digit or
/// impossible-calendar bytes (e.g. "Not Available", month 13) must yield `None` — never a fabricated
/// date — which is exactly what `parse` + `from_ymd_opt` guarantee.
fn parse_cim_date(cim: &str) -> Option<chrono::NaiveDate> {
    let year: i32 = cim.get(0..4)?.parse().ok()?;
    let month: u32 = cim.get(4..6)?.parse().ok()?;
    let day: u32 = cim.get(6..8)?.parse().ok()?;
    chrono::NaiveDate::from_ymd_opt(year, month, day)
}

pub(crate) fn cim_date_age_days(cim: &str) -> Option<i64> {
    let dt = parse_cim_date(cim)?;
    let today = Utc::now().date_naive();
    Some((today - dt).num_days().max(0))
}

pub(crate) fn cim_date_iso(cim: &str) -> String {
    // A date string is emitted IFF `parse_cim_date` accepts it (the same validation the age uses),
    // so `release_date`/`driver_date` and their `*_age_days` siblings are always consistent — garbage
    // firmware bytes yield "" here exactly as they yield None for the age, never a fabricated
    // real-looking date on the Diagnostics tab or in the exported report.
    parse_cim_date(cim).map(|dt| dt.format("%Y-%m-%d").to_string()).unwrap_or_default()
}

// ─── BIOS / firmware (detection-layer Probe #1, feasible-usermode) ────────────
// Win32_BIOS is a plain user-mode WMI read (no kernel driver). We surface version +
// publication date + a DESCRIPTIVE age band. Honesty rule: the age is when the
// firmware was PUBLISHED — never a claim that it's out of date, and never a prompt to
// flash (BIOS updates carry real risk). Anything unreadable degrades to None /
// "Unknown", never a fabricated value.
#[derive(Deserialize)]
#[serde(rename = "Win32_BIOS")]
#[serde(rename_all = "PascalCase")]
pub(crate) struct Win32Bios {
    pub(crate) manufacturer: Option<String>,
    // PascalCase would map this to "SmbiosBiosVersion"; the real WMI property is all-caps.
    #[serde(rename = "SMBIOSBIOSVersion")]
    pub(crate) smbios_bios_version: Option<String>,
    pub(crate) release_date: Option<String>, // CIM_DATETIME, e.g. "20260315000000.000000-000"
}

pub(crate) fn detect_bios() -> Option<BiosInfo> {
    let com = COMLibrary::new().ok()?;
    let wmi_conn = WMIConnection::new(com).ok()?;
    let rows: Vec<Win32Bios> = wmi_conn.query().ok()?;
    let b = rows.into_iter().next()?;
    let release_raw = b.release_date.unwrap_or_default();
    Some(BiosInfo {
        manufacturer: b.manufacturer.unwrap_or_default(),
        version: b.smbios_bios_version.unwrap_or_default(),
        release_date: cim_date_iso(&release_raw),
        release_date_age_days: cim_date_age_days(&release_raw),
    })
}

/// Descriptive (never prescriptive) firmware-age band. No "update now" — BIOS flashing
/// carries real risk; we report time since publication and let the user judge.
pub(crate) fn bios_age_label(age_days: Option<i64>) -> &'static str {
    match age_days {
        Some(d) if d < 30 => "Very fresh",
        Some(d) if d < 180 => "Recent",
        Some(d) if d < 730 => "Mature",
        Some(_) => "Aging (2+ years)",
        None => "Unknown",
    }
}

// ─── Virtualization / hypervisor (detection-layer Probe #5, feasible-usermode) ─
// HypervisorPresent (Win32_ComputerSystem) = a hypervisor IS running — VBS/Memory Integrity,
// Hyper-V, WSL2, Sandbox, or a VM — which carries a small FPS cost in some games. SVM/VT-x
// (Win32_Processor.VirtualizationFirmwareEnabled) is the firmware CAPABILITY toggle, neutral on
// its own. Both are plain user-mode WMI bools; unreadable → None / "Unknown", never guessed.
#[derive(Serialize, Clone, Default)]
pub(crate) struct VirtualizationInfo {
    pub(crate) hypervisor_present: bool,
    pub(crate) cpu_virtualization_enabled: Option<bool>, // SVM/VT-x enabled in firmware
    /// Whether virtualization-based security is actually RUNNING, from
    /// `Win32_DeviceGuard.VirtualizationBasedSecurityStatus` (see `vbs_state`). The registry
    /// switches only say it is configured; this is the live state. Read-only: Compy never changes
    /// VBS (security settings are the owner's).
    pub(crate) vbs_state: VbsState,
}

/// Live VBS state. `Unknown` when the Device Guard class can't be read or reports a value
/// outside the documented 0/1/2, never guessed from the registry or the hypervisor flag.
#[derive(Serialize, Clone, Copy, Default, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(crate) enum VbsState {
    Running,
    EnabledNotRunning,
    Off,
    #[default]
    Unknown,
}

/// Win32_DeviceGuard.VirtualizationBasedSecurityStatus: 0 = not enabled, 1 = enabled but not
/// running, 2 = enabled and running.
pub(crate) fn vbs_state(status: Option<u32>) -> VbsState {
    match status {
        Some(2) => VbsState::Running,
        Some(1) => VbsState::EnabledNotRunning,
        Some(0) => VbsState::Off,
        _ => VbsState::Unknown,
    }
}

/// The words the support view shows for a `VbsState`.
pub(crate) fn vbs_state_label(state: VbsState) -> &'static str {
    match state {
        VbsState::Running => "Running",
        VbsState::EnabledNotRunning => "Turned on, not running",
        VbsState::Off => "Off",
        VbsState::Unknown => "Unknown",
    }
}

#[derive(Deserialize)]
#[serde(rename = "Win32_DeviceGuard")]
#[serde(rename_all = "PascalCase")]
pub(crate) struct Win32DeviceGuard {
    pub(crate) virtualization_based_security_status: Option<u32>,
}

/// Reads the live VBS status from the Device Guard WMI namespace. Any failure (namespace
/// missing on older builds, access denied, empty result) is `None`, which reads as unknown.
fn read_vbs_status() -> Option<u32> {
    let com = COMLibrary::new().ok()?;
    let conn =
        WMIConnection::with_namespace_path("ROOT\\Microsoft\\Windows\\DeviceGuard", com).ok()?;
    let rows: Vec<Win32DeviceGuard> = conn.query().ok()?;
    rows.into_iter().next()?.virtualization_based_security_status
}

#[derive(Deserialize)]
#[serde(rename = "Win32_ComputerSystem")]
#[serde(rename_all = "PascalCase")]
pub(crate) struct Win32ComputerSystem {
    pub(crate) hypervisor_present: Option<bool>,
}

#[derive(Deserialize)]
#[serde(rename = "Win32_Processor")]
#[serde(rename_all = "PascalCase")]
pub(crate) struct Win32ProcessorVirt {
    pub(crate) virtualization_firmware_enabled: Option<bool>,
}

pub(crate) fn detect_virtualization() -> Option<VirtualizationInfo> {
    let com = COMLibrary::new().ok()?;
    let wmi_conn = WMIConnection::new(com).ok()?;
    let cs: Vec<Win32ComputerSystem> = wmi_conn.query().ok()?;
    let hypervisor_present = cs
        .into_iter()
        .next()
        .and_then(|c| c.hypervisor_present)
        .unwrap_or(false);
    // Best-effort: the CPU virtualization flag is a nice-to-have, not worth failing the probe over.
    let cpu: Vec<Win32ProcessorVirt> = wmi_conn.query().unwrap_or_default();
    let cpu_virtualization_enabled =
        cpu.into_iter().next().and_then(|p| p.virtualization_firmware_enabled);
    Some(VirtualizationInfo {
        hypervisor_present,
        cpu_virtualization_enabled,
        // Its own namespace and connection: a Device Guard failure leaves the rest of the probe.
        vbs_state: vbs_state(read_vbs_status()),
    })
}

#[cfg(test)]
mod virtualization_detection_tests {
    use super::*;

    #[test]
    fn wmi_virtualization_shapes_deserialize() {
        // Pins the PascalCase mapping (the easy-to-get-wrong part).
        let cs: Win32ComputerSystem =
            serde_json::from_str(r#"{"HypervisorPresent":true}"#).expect("parses");
        assert_eq!(cs.hypervisor_present, Some(true));
        let cpu: Win32ProcessorVirt =
            serde_json::from_str(r#"{"VirtualizationFirmwareEnabled":true}"#).expect("parses");
        assert_eq!(cpu.virtualization_firmware_enabled, Some(true));
        let dg: Win32DeviceGuard =
            serde_json::from_str(r#"{"VirtualizationBasedSecurityStatus":2}"#).expect("parses");
        assert_eq!(dg.virtualization_based_security_status, Some(2));
    }

    // CR-vbs-running: the documented 0/1/2 map to off / turned-on-not-running / running; a missing
    // or undocumented value is unknown, never a guess.
    #[test]
    fn vbs_status_maps_only_the_documented_values() {
        assert_eq!(vbs_state(Some(2)), VbsState::Running);
        assert_eq!(vbs_state(Some(1)), VbsState::EnabledNotRunning);
        assert_eq!(vbs_state(Some(0)), VbsState::Off);
        assert_eq!(vbs_state(Some(3)), VbsState::Unknown);
        assert_eq!(vbs_state(None), VbsState::Unknown);
        assert_eq!(VirtualizationInfo::default().vbs_state, VbsState::Unknown);
        assert_eq!(vbs_state_label(VbsState::EnabledNotRunning), "Turned on, not running");
        assert_eq!(
            serde_json::to_value(VbsState::EnabledNotRunning).expect("serializes"),
            serde_json::json!("enabled_not_running")
        );
    }
}

// ─── USB capability (detection-layer Probe #12, partial) ──────────────────────
// Host-controller names expose the spec TIER the platform supports (USB4 / 3.2 / …). Honest limit:
// this is the platform CAPABILITY, NOT per-device negotiated speed or which port a device sits on
// (neither reliably readable in user-mode). Unreadable → None / "Unknown".
#[derive(Serialize, Clone, Default)]
pub(crate) struct UsbSummary {
    pub(crate) top_spec: String, // "USB4" | "USB 3.2" | "USB 3.1" | "USB 3.0" | "USB 2.0" | "Unknown"
    pub(crate) controller_count: u32,
}

#[derive(Deserialize)]
#[serde(rename = "Win32_USBController")]
#[serde(rename_all = "PascalCase")]
pub(crate) struct Win32UsbController {
    pub(crate) name: Option<String>,
}

/// Highest USB spec tier inferred from host-controller names. Capability only — never per-device speed.
pub(crate) fn usb_top_spec(controller_names: &[String]) -> &'static str {
    let j = controller_names.join(" ").to_lowercase();
    if j.contains("usb4") || j.contains("usb 4") {
        "USB4"
    } else if j.contains("3.20") || j.contains("3.2") {
        "USB 3.2"
    } else if j.contains("3.10") || j.contains("3.1") {
        "USB 3.1"
    } else if j.contains("3.0") || j.contains("superspeed") {
        "USB 3.0"
    } else if j.contains("2.0") {
        "USB 2.0"
    } else {
        "Unknown"
    }
}

pub(crate) fn detect_usb_summary() -> Option<UsbSummary> {
    let com = COMLibrary::new().ok()?;
    let conn = WMIConnection::new(com).ok()?;
    let rows: Vec<Win32UsbController> = conn.query().ok()?;
    let names: Vec<String> = rows.into_iter().filter_map(|c| c.name).collect();
    if names.is_empty() {
        return None;
    }
    Some(UsbSummary {
        top_spec: usb_top_spec(&names).to_string(),
        controller_count: names.len() as u32,
    })
}

/// Pure: reduce a (possibly absent) USB summary to the shared top-spec signal.
/// `"Unknown"` collapses to `None` so a consumer never has to special-case the
/// sentinel string — `Some(tier)` always means a real, named capability tier.
/// Reached in production via `detect_usb_top_spec` (the cross-lane signal below).
fn usb_top_spec_signal(summary: Option<UsbSummary>) -> Option<String> {
    summary
        .map(|u| u.top_spec)
        .filter(|s| !s.is_empty() && s != "Unknown")
}

/// Read-only shared signal for other lanes: the per-rig top USB spec tier, or
/// `None` when the platform capability can't be read or is `"Unknown"`.
/// Capability tier only — never per-device negotiated speed or which port a
/// device sits on (neither is reliably readable in user-mode). Does a fresh,
/// read-only WMI query; mutates nothing. Consumed in production by the
/// peripheral lane's USB-tier port advisory (`latency.rs` → `usb_tier_advisory`).
pub(crate) fn detect_usb_top_spec() -> Option<String> {
    usb_top_spec_signal(detect_usb_summary())
}

#[cfg(test)]
mod usb_detection_tests {
    use super::{usb_top_spec, usb_top_spec_signal, UsbSummary};

    fn summary(top: &str) -> UsbSummary {
        UsbSummary { top_spec: top.to_string(), controller_count: 1 }
    }

    #[test]
    fn top_spec_signal_collapses_unknown_and_absent_to_none() {
        // A real, named tier passes through verbatim — the shared signal peripheral consumes.
        assert_eq!(usb_top_spec_signal(Some(summary("USB4"))), Some("USB4".to_string()));
        assert_eq!(usb_top_spec_signal(Some(summary("USB 2.0"))), Some("USB 2.0".to_string()));
        // The "Unknown" sentinel and an empty/absent summary all collapse to None so the
        // consumer never has to special-case a not-really-a-tier string.
        assert_eq!(usb_top_spec_signal(Some(summary("Unknown"))), None);
        assert_eq!(usb_top_spec_signal(Some(summary(""))), None);
        assert_eq!(usb_top_spec_signal(None), None);
    }

    #[test]
    fn top_spec_picks_the_highest_tier() {
        // Real controller-name shapes captured from the AMD dev rig.
        let amd = vec![
            "AMD USB 2.0 eXtensible Host Controller".to_string(),
            "AMD USB 3.10 eXtensible Host Controller".to_string(),
            "AMD USB 3.20 eXtensible Host Controller".to_string(),
            "USB4(TM) Host Router".to_string(),
        ];
        assert_eq!(usb_top_spec(&amd), "USB4");
        assert_eq!(
            usb_top_spec(&["AMD USB 3.20 eXtensible Host Controller".to_string()]),
            "USB 3.2"
        );
        assert_eq!(
            usb_top_spec(&["AMD USB 3.10 eXtensible Host Controller".to_string()]),
            "USB 3.1"
        );
        assert_eq!(
            usb_top_spec(&["Intel USB 2.0 Enhanced Host Controller".to_string()]),
            "USB 2.0"
        );
        assert_eq!(usb_top_spec(&[]), "Unknown");
    }
}

// ─── Power source / AC state (detection-layer Probe #11) ──────────────────────
// Win32_Battery is empty on desktops (→ AC) and populated on laptops. No FFI, no kernel — a plain
// WMI read. Honest: live power source + charge; "Unknown" if WMI fails. More useful on laptops
// (gaming on battery throttles) than on a desktop, where it's just "AC".
#[derive(Deserialize)]
#[serde(rename = "Win32_Battery")]
#[serde(rename_all = "PascalCase")]
pub(crate) struct Win32Battery {
    pub(crate) battery_status: Option<u16>, // 1 = discharging, 2 = on AC
    pub(crate) estimated_charge_remaining: Option<u16>, // percent, 0-100
}

/// Plain-English power source from (has_battery, BatteryStatus, charge%). Pure + testable.
pub(crate) fn power_status_label(
    has_battery: bool,
    battery_status: Option<u16>,
    pct: Option<u16>,
) -> String {
    if !has_battery {
        return "AC power (no battery — desktop)".into();
    }
    match (battery_status, pct) {
        (Some(2), Some(p)) => format!("AC power (battery {p}%)"),
        (Some(1), Some(p)) => format!("On battery ({p}%)"),
        (_, Some(p)) => format!("Battery {p}%"),
        _ => "Battery present".into(),
    }
}

pub(crate) fn detect_power_status() -> String {
    // WMI needs COM on a thread with a clean apartment. get_diagnostics calls this on the Tauri
    // command thread, whose COM is already initialized in a conflicting mode → COMLibrary::new()
    // fails THERE and the probe silently returned "Unknown" on real desktops (caught in a live
    // self-review, NOT by the pure unit test, which runs on a clean test thread). Every other WMI
    // probe avoids this by running on a fresh thread; route this one the same way. Map a panicked
    // thread (on_wmi_thread → "") to "Unknown" so the Diagnostics non-empty-value contract holds.
    let s = on_wmi_thread(detect_power_status_inner);
    if s.is_empty() { "Unknown".into() } else { s }
}

/// Where this PC is drawing power from, as a type (the first look says "on battery" only for the one
/// state Windows calls discharging).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub(crate) enum PowerSource {
    OnBattery,
    AcPower,
    /// No battery: a desktop.
    Desktop,
    /// WMI failed, or the battery state is one this does not read as either (low, critical, undefined).
    #[default]
    Unknown,
}

/// Pure: the power source from (has_battery, BatteryStatus). 1 is discharging; 2, 3 (fully charged),
/// 6-9 (charging) and 11 (partially charged) are on AC. Anything else is `Unknown`, never a guess.
pub(crate) fn power_source_from(has_battery: bool, battery_status: Option<u16>) -> PowerSource {
    if !has_battery {
        return PowerSource::Desktop;
    }
    match battery_status {
        Some(1) => PowerSource::OnBattery,
        Some(2 | 3 | 6..=9 | 11) => PowerSource::AcPower,
        _ => PowerSource::Unknown,
    }
}

/// The typed power source: one WMI read on its own thread (a thread, not a process), the same read as
/// `detect_power_status`. Read-only.
pub(crate) fn detect_power_source() -> PowerSource {
    on_wmi_thread(|| {
        let Some(com) = COMLibrary::new().ok() else { return PowerSource::Unknown };
        let Some(conn) = WMIConnection::new(com).ok() else { return PowerSource::Unknown };
        let rows: Result<Vec<Win32Battery>, _> = conn.query();
        match rows {
            Err(_) => PowerSource::Unknown,
            Ok(rows) => match rows.into_iter().next() {
                None => PowerSource::Desktop,
                Some(b) => power_source_from(true, b.battery_status),
            },
        }
    })
}

fn detect_power_status_inner() -> String {
    let Some(com) = COMLibrary::new().ok() else {
        return "Unknown".into();
    };
    let Some(conn) = WMIConnection::new(com).ok() else {
        return "Unknown".into();
    };
    let rows: Vec<Win32Battery> = conn.query().unwrap_or_default();
    match rows.into_iter().next() {
        None => power_status_label(false, None, None),
        Some(b) => power_status_label(true, b.battery_status, b.estimated_charge_remaining),
    }
}

#[cfg(test)]
mod power_status_tests {
    use super::power_status_label;

    #[test]
    fn power_label_is_honest_across_states() {
        assert_eq!(power_status_label(false, None, None), "AC power (no battery — desktop)");
        assert_eq!(power_status_label(true, Some(2), Some(95)), "AC power (battery 95%)");
        assert_eq!(power_status_label(true, Some(1), Some(60)), "On battery (60%)");
        assert_eq!(power_status_label(true, None, Some(80)), "Battery 80%");
        assert_eq!(power_status_label(true, None, None), "Battery present");
    }

    #[test]
    fn the_power_source_is_on_battery_only_for_discharging() {
        use super::{power_source_from as p, PowerSource as S};
        assert_eq!(p(false, None), S::Desktop);
        assert_eq!(p(false, Some(1)), S::Desktop);
        assert_eq!(p(true, Some(1)), S::OnBattery);
        for ac in [2, 3, 6, 7, 8, 9, 11] {
            assert_eq!(p(true, Some(ac)), S::AcPower, "{ac}");
        }
        // Low, critical, undefined and unread are not read as on battery or on AC.
        for other in [4, 5, 10, 12] {
            assert_eq!(p(true, Some(other)), S::Unknown, "{other}");
        }
        assert_eq!(p(true, None), S::Unknown);
    }

    #[test]
    fn detect_power_status_is_never_empty() {
        // The Diagnostics surface requires a non-empty value (no blank rows). Even if the WMI
        // thread fails or panics, detect_power_status degrades to "Unknown", never "". Guards the
        // on_wmi_thread wrapping that fixed the command-thread COM-init failure ("Power source:
        // Unknown" on real desktops).
        assert!(!super::detect_power_status().is_empty());
    }
}

#[cfg(test)]
mod bios_detection_tests {
    use super::*;

    #[test]
    fn release_date_reuses_cim_helpers() {
        // Fixture captured live from the AMD dev rig (AMI BIOS 1.A95, released 2026-03-15).
        let cim = "20260315000000.000000-000";
        assert_eq!(cim_date_iso(cim), "2026-03-15");
        assert!(cim_date_age_days(cim).is_some());

        // Firmware-controlled garbage with a multi-byte UTF-8 char straddling a byte index must NOT
        // panic (raw byte-slicing &cim[0..4] would). 'é' is 2 bytes spanning indices 3..5, so index 4
        // is not a char boundary; boundary-safe parsing yields honest silence, not a crash.
        assert_eq!(cim_date_iso("202\u{e9}0115000000"), "");
        assert_eq!(cim_date_age_days("202\u{e9}0115000000"), None);
    }

    #[test]
    fn cim_date_iso_never_fabricates_a_date_from_garbage_firmware() {
        // bug→guard: `cim_date_iso` once sliced bytes WITHOUT validating they were digits / a real
        // calendar date (only the age helper validated), so firmware-authored Win32_BIOS.ReleaseDate
        // garbage produced a fabricated, real-looking date on the Diagnostics tab + in the exported
        // report while the age honestly read "unknown". Both helpers now share `parse_cim_date`, so
        // the ISO string is present IFF the age is computable — they can never disagree.
        for bad in [
            "Not Available",                // non-digit text (pre-fix → "Not -Av-ai")
            "20261345000000.000000+000",    // impossible calendar: month 13, day 45 (pre-fix → "2026-13-45")
            "00000000000000.000000+000",    // month 0 / day 0 (pre-fix → "0000-00-00")
            "2026021",                      // too short (no day field)
            "",                             // empty
        ] {
            assert_eq!(cim_date_iso(bad), "", "garbage firmware date must yield \"\": {bad:?}");
            assert_eq!(cim_date_age_days(bad), None, "and the age must agree (None): {bad:?}");
        }
        // A real, in-calendar date still passes (the fix only rejects fabrications).
        assert_eq!(cim_date_iso("20240229000000.000000+000"), "2024-02-29"); // leap day — valid
        assert!(cim_date_age_days("20240229000000.000000+000").is_some());
    }

    #[test]
    fn age_label_bands() {
        assert_eq!(bios_age_label(Some(10)), "Very fresh");
        assert_eq!(bios_age_label(Some(100)), "Recent");
        assert_eq!(bios_age_label(Some(400)), "Mature");
        assert_eq!(bios_age_label(Some(900)), "Aging (2+ years)");
        assert_eq!(bios_age_label(None), "Unknown");
    }

    #[test]
    fn age_label_boundaries_fall_to_the_older_band() {
        // No off-by-one optimism: exactly-on-threshold reads as the older band.
        assert_eq!(bios_age_label(Some(30)), "Recent");
        assert_eq!(bios_age_label(Some(180)), "Mature");
        assert_eq!(bios_age_label(Some(730)), "Aging (2+ years)");
    }

    #[test]
    fn win32_bios_deserializes_wmi_pascalcase_shape() {
        let json = r#"{"Manufacturer":"American Megatrends International, LLC.","SMBIOSBIOSVersion":"1.A95","ReleaseDate":"20260315000000.000000-000"}"#;
        let b: Win32Bios = serde_json::from_str(json).expect("parses the WMI row shape");
        assert_eq!(b.manufacturer.as_deref(), Some("American Megatrends International, LLC."));
        assert_eq!(b.smbios_bios_version.as_deref(), Some("1.A95"));
        assert_eq!(b.release_date.as_deref(), Some("20260315000000.000000-000"));
    }
}

// GPU detection has two paths because some user environments (notably certain
// AV setups) silently block WMI's Win32_VideoController query. DXGI is what
// every 3D app and game uses to enumerate adapters — AV products almost never
// intercept it because doing so would break every game. So we use DXGI as the
// primary source for name + VRAM (which DXGI reports accurately, unlike WMI's
// 4 GB-capped AdapterRAM), then enrich with WMI for driver info if available.

pub(crate) fn detect_gpus_dxgi() -> Vec<GpuInfo> {
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

pub(crate) fn detect_gpus_wmi() -> Vec<GpuInfo> {
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

pub(crate) fn detect_gpus() -> Vec<GpuInfo> {
    let mut gpus = detect_gpus_dxgi();
    if gpus.is_empty() {
        return detect_gpus_wmi();
    }
    // Enrich with WMI driver info if accessible; if WMI is blocked we still
    // have the DXGI-derived name + accurate VRAM, which is the most important
    // thing the user sees.
    let wmi_gpus = detect_gpus_wmi();
    for gpu in &mut gpus {
        if let Some(w) = wmi_record_for(&gpu.name, &wmi_gpus) {
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

// ─── Game install storage (F2 readiness) ────────────────────────────────────
// Detects where the user's game libraries live (Steam + Epic) and whether those
// drives are fast (NVMe/SSD) or slow (HDD), so Readiness can answer "are my
// games on fast storage?" instead of only knowing that a fast drive exists
// somewhere. All reads are local — registry + launcher config files + the
// Storage WMI namespace. Runs inside collect_hardware (already on the WMI thread).

#[derive(Serialize, Clone, Default)]
pub(crate) struct GameLibrary {
    pub(crate) launcher: String,   // "Steam" | "Epic"
    pub(crate) drive: String,      // "C", "D", …
    pub(crate) media_type: String, // "SSD" | "HDD" | "SCM" | "Unknown"
    pub(crate) bus_type: String,   // "NVMe" | "SATA" | "Other" | ""
}

#[derive(Serialize, Clone, Default)]
pub(crate) struct GameStorage {
    pub(crate) libraries: Vec<GameLibrary>,
    pub(crate) any_fast: bool, // a library on SSD/NVMe/SCM
    pub(crate) any_slow: bool, // a library on a spinning HDD
}

#[derive(Deserialize)]
#[serde(rename = "MSFT_Partition")]
#[serde(rename_all = "PascalCase")]
struct MsftPartition {
    drive_letter: Option<String>,
    disk_number: Option<u32>,
}

// Pure: the drive letter at the start of a Windows path ("D:\\Games" -> 'D').
fn drive_letter_of(path: &str) -> Option<char> {
    let mut it = path.chars();
    let c = it.next()?;
    if c.is_ascii_alphabetic() && it.next() == Some(':') {
        Some(c.to_ascii_uppercase())
    } else {
        None
    }
}

// Pure: library paths from a Steam libraryfolders.vdf body. Each library block
// has a line like:  "path"   "D:\\SteamLibrary"  (backslashes doubled in the VDF).
pub(crate) fn parse_steam_library_paths(vdf: &str) -> Vec<String> {
    vdf.lines()
        .filter_map(|line| {
            let rest = line.trim().strip_prefix("\"path\"")?;
            let q1 = rest.find('"')?;
            let after = &rest[q1 + 1..];
            let q2 = after.find('"')?;
            Some(after[..q2].replace("\\\\", "\\"))
        })
        .collect()
}

// drive letter -> (media_type, bus_type) via the Storage namespace. Empty if the
// namespace is blocked or the shape is unexpected — callers degrade gracefully.
fn drive_media_map() -> std::collections::HashMap<char, (String, String)> {
    let mut map = std::collections::HashMap::new();
    let com = match COMLibrary::new() {
        Ok(c) => c,
        Err(_) => return map,
    };
    let conn = match WMIConnection::with_namespace_path("ROOT\\Microsoft\\Windows\\Storage", com) {
        Ok(c) => c,
        Err(_) => return map,
    };
    let disks: Vec<MsftPhysicalDisk> = conn.query().unwrap_or_default();
    let disk_media: std::collections::HashMap<u32, (String, String)> = disks
        .iter()
        .filter_map(|d| {
            let id = d.device_id.as_deref()?.parse::<u32>().ok()?;
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
            Some((id, (media.to_string(), bus.to_string())))
        })
        .collect();
    let parts: Vec<MsftPartition> = conn.query().unwrap_or_default();
    for p in parts {
        let Some(dn) = p.disk_number else { continue };
        let Some(letter) = p
            .drive_letter
            .as_deref()
            .and_then(|s| s.chars().next())
            .filter(|c| c.is_ascii_alphabetic())
        else {
            continue;
        };
        if let Some(mb) = disk_media.get(&dn) {
            map.insert(letter.to_ascii_uppercase(), mb.clone());
        }
    }
    map
}

fn steam_library_letters() -> Vec<char> {
    let steam: Option<String> = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey("Software\\Valve\\Steam")
        .and_then(|k| k.get_value::<String, _>("SteamPath"))
        .ok();
    let Some(steam) = steam else {
        return Vec::new();
    };
    let steam = steam.replace('/', "\\");
    let mut letters = Vec::new();
    if let Some(l) = drive_letter_of(&steam) {
        letters.push(l);
    }
    let vdf = format!("{}\\steamapps\\libraryfolders.vdf", steam.trim_end_matches('\\'));
    let body = std::fs::read_to_string(&vdf).unwrap_or_default();
    for p in parse_steam_library_paths(&body) {
        if let Some(l) = drive_letter_of(&p) {
            letters.push(l);
        }
    }
    letters
}

fn epic_library_letters() -> Vec<char> {
    let Ok(pd) = std::env::var("ProgramData") else {
        return Vec::new();
    };
    let dir = format!("{}\\Epic\\EpicGamesLauncher\\Data\\Manifests", pd);
    let mut letters = Vec::new();
    let Ok(entries) = std::fs::read_dir(&dir) else {
        return letters;
    };
    for e in entries.flatten() {
        if e.path().extension().and_then(|s| s.to_str()) != Some("item") {
            continue;
        }
        let body = std::fs::read_to_string(e.path()).unwrap_or_default();
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&body) {
            if let Some(loc) = v.get("InstallLocation").and_then(|x| x.as_str()) {
                if let Some(l) = drive_letter_of(loc) {
                    letters.push(l);
                }
            }
        }
    }
    letters
}

pub(crate) fn detect_game_storage() -> GameStorage {
    let media_map = drive_media_map();
    let mut libraries: Vec<GameLibrary> = Vec::new();
    let mut seen: std::collections::HashSet<(&'static str, char)> = std::collections::HashSet::new();

    for (launcher, letters) in [
        ("Steam", steam_library_letters()),
        ("Epic", epic_library_letters()),
    ] {
        for l in letters {
            if !seen.insert((launcher, l)) {
                continue;
            }
            let (media, bus) = media_map
                .get(&l)
                .cloned()
                .unwrap_or_else(|| ("Unknown".to_string(), String::new()));
            libraries.push(GameLibrary {
                launcher: launcher.to_string(),
                drive: l.to_string(),
                media_type: media,
                bus_type: bus,
            });
        }
    }

    let any_fast = libraries
        .iter()
        .any(|g| matches!(g.media_type.as_str(), "SSD" | "SCM") || g.bus_type == "NVMe");
    let any_slow = libraries.iter().any(|g| g.media_type == "HDD");
    GameStorage { libraries, any_fast, any_slow }
}

/// Run WMI-touching work on a dedicated, freshly-spawned thread.
///
/// `wmi::COMLibrary::new()` requests an MTA apartment (`CoInitializeEx` with
/// `COINIT_MULTITHREADED`). Tauri's synchronous command handlers run on the
/// app's main UI thread, which WebView2 has already initialized as a
/// single-threaded apartment (STA); requesting MTA there fails with
/// `RPC_E_CHANGED_MODE`, so `COMLibrary::new()` returns `Err` and every WMI
/// query silently yields nothing in the running app — even though it works in
/// unit tests, which run on a clean thread. A fresh thread always gets a clean
/// MTA apartment, so WMI succeeds regardless of the caller's COM state. The
/// closure returns owned, `Send` data back to the calling thread.
pub(crate) fn on_wmi_thread<T, F>(f: F) -> T
where
    T: Default + Send + 'static,
    F: FnOnce() -> T + Send + 'static,
{
    std::thread::spawn(f).join().unwrap_or_default()
}

/// One Windows service's `(State, StartMode)` from WMI `Win32_Service`, read-only, or `None` when the
/// service has no row or WMI could not be read. `StartMode` is an enumerated string Windows does not
/// localize ("Boot" / "System" / "Auto" / "Manual" / "Disabled"). The four catalog service-disable
/// changes read from `history::LiveReads`' one batched listing (CR-service-batch); any other name (a
/// remote rule's `service-not-running` param) reads here, in the read-only probe module, so the ledger's
/// probe never reaches into `actions` (`src/experiment-record-first-guard.test.ts` pins that).
/// `actions::service_info` is the same read on the mutation side, kept there because the apply's
/// snapshot takes it. Cost: one thread, one COM init, one WMI connection, roughly 100-500 ms.
pub(crate) fn service_state_and_start_mode(name: &str) -> Option<(String, String)> {
    #[derive(Deserialize)]
    #[serde(rename = "Win32_Service")]
    #[serde(rename_all = "PascalCase")]
    struct Win32ServiceRow {
        state: Option<String>,
        start_mode: Option<String>,
    }
    let name = name.to_string();
    on_wmi_thread(move || {
        let com = COMLibrary::new().ok()?;
        let wmi_conn = WMIConnection::new(com).ok()?;
        let query = format!("SELECT State,StartMode FROM Win32_Service WHERE Name='{}'", name.replace('\'', "''"));
        let results: Vec<Win32ServiceRow> = wmi_conn.raw_query(&query).ok()?;
        let svc = results.into_iter().next()?;
        Some((
            svc.state.unwrap_or_else(|| "Unknown".into()),
            svc.start_mode.unwrap_or_else(|| "Unknown".into()),
        ))
    })
}

pub(crate) fn collect_hardware() -> HardwareInfo {
    // Hardware is static for a session, but several commands need it — on startup
    // get_recommendations / get_diagnostics / get_game_readiness / get_priorities fire in
    // parallel, and each used to trigger its own full System::new_all() + WMI sweep on a fresh
    // thread (4–5 simultaneous scans contending for CPU + WMI). Cache the snapshot so they
    // collapse to ONE scan: get_or_init is synchronized, so concurrent first-calls block on the
    // single scan and then all clone the result. (A hot-plugged drive/monitor won't appear until
    // the app restarts — an acceptable trade for the startup-time win; live RAM/temps come from
    // the monitoring poller, not this snapshot.)
    //
    // BUT a few fields legitimately change within a session AND are shown on the hardware panel
    // as if current — RAM-in-use and free disk space (HardwareGrid.tsx). Serving those frozen at
    // startup misreports them all session (e.g. the user frees 50 GB and the panel still shows the
    // old figure). So overwrite ONLY those cheap, purely-local reads on each call; everything else
    // (the WMI identity sweep, network state) stays the startup snapshot.
    let mut hw = HW_SNAPSHOT
        .get_or_init(|| on_wmi_thread(collect_hardware_inner))
        .clone();
    refresh_live_fields(&mut hw);
    refresh_gpu_drivers(&mut hw.gpus);
    hw
}

/// The startup hardware snapshot `collect_hardware` fills once (WMI sweep, off the main thread).
static HW_SNAPSHOT: std::sync::OnceLock<HardwareInfo> = std::sync::OnceLock::new();

/// The graphics card a session fingerprint names: the GPU with the most VRAM, the same pick
/// `current_fingerprint` stamps on every session.
pub(crate) fn primary_gpu(hw: &HardwareInfo) -> Option<&GpuInfo> {
    hw.gpus.iter().max_by_key(|g| g.vram_bytes)
}

/// P9-session-on-this-hardware: the name of this PC's graphics card from the startup snapshot,
/// picked as session fingerprints pick it. Reads only what is already cached: it never starts the
/// WMI sweep, so a sync command on the main thread can call it. `None` = not read yet, or no GPU
/// name was read: unknown, never a guess.
pub(crate) fn cached_primary_gpu_name() -> Option<String> {
    let hw = HW_SNAPSHOT.get()?;
    primary_gpu(hw).map(|g| g.name.trim().to_string()).filter(|n| !n.is_empty())
}

/// The hardware snapshot ONLY if it has already been read: it never starts the WMI sweep and never waits
/// for one, and it starts no background read (`collect_hardware` does both). The live fields (RAM in use,
/// free disk space, the main display's mode) are re-read with local calls only. `None` = not ready yet.
pub(crate) fn snapshot_if_ready() -> Option<HardwareInfo> {
    let mut hw = HW_SNAPSHOT.get()?.clone();
    refresh_live_fields(&mut hw);
    Some(hw)
}

/// How long a GPU driver read stands before the next call re-reads it.
const GPU_DRIVER_REFRESH: std::time::Duration = std::time::Duration::from_secs(60);

/// The GPU driver fields re-read past the startup snapshot.
#[derive(Default)]
struct DriverCache {
    /// When the last read started (or the startup snapshot was seeded); None before the first call.
    at: Option<std::time::Instant>,
    /// The last good read, merged field by field over the one before it.
    list: Vec<GpuInfo>,
    /// A background read is running: no second one starts.
    reading: bool,
}

static GPU_DRIVER_CACHE: std::sync::Mutex<DriverCache> =
    std::sync::Mutex::new(DriverCache { at: None, list: Vec::new(), reading: false });

/// What a call does with the driver fields.
#[derive(Debug, PartialEq, Eq)]
enum DriverRefresh {
    /// First call: the startup snapshot read them a moment ago. Start the clock, read nothing.
    Seed,
    /// Within the window, or a read already running: use the last good read.
    Hold,
    /// The window has passed: start a background read and use the last good read meanwhile.
    Read,
}

fn driver_refresh_due(c: &DriverCache, now: std::time::Instant) -> DriverRefresh {
    match c.at {
        None => DriverRefresh::Seed,
        Some(_) if c.reading => DriverRefresh::Hold,
        Some(at) if now.saturating_duration_since(at) < GPU_DRIVER_REFRESH => DriverRefresh::Hold,
        Some(_) => DriverRefresh::Read,
    }
}

/// A finished read into the cache. An empty read (WMI blocked, a COM failure) keeps the last good
/// list; a record that left a field blank keeps that field's last value, so a null DriverDate is no
/// news rather than a flip to unknown.
fn store_driver_read(c: &mut DriverCache, read: Vec<GpuInfo>) {
    c.reading = false;
    if read.is_empty() {
        return;
    }
    let prev = std::mem::take(&mut c.list);
    c.list = read
        .into_iter()
        .map(|mut r| {
            if let Some(p) = prev.iter().find(|p| p.name == r.name) {
                if r.driver_version.is_empty() {
                    r.driver_version = p.driver_version.clone();
                }
                if r.driver_date.is_empty() {
                    r.driver_date = p.driver_date.clone();
                }
                if r.driver_age_days.is_none() {
                    r.driver_age_days = p.driver_age_days;
                }
            }
            r
        })
        .collect();
}

/// Re-read the GPU driver fields at most once a minute (codebase review 2026-11-03). Readiness's
/// driver-age row and the driver rec tell the user to update the driver, and the startup snapshot
/// kept both on until Compy restarted; the GPU before/after compared a driver it never re-read.
/// The read is WMI, which can stall, so no caller ever waits on it: a due call starts it on its own
/// thread and answers with the last good read; the next call after it lands sees the new one. The
/// lock is held only to decide and to store, never across the read (round 2 review).
fn refresh_gpu_drivers(gpus: &mut [GpuInfo]) {
    let now = std::time::Instant::now();
    let (list, start) = {
        let mut c = GPU_DRIVER_CACHE.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
        match driver_refresh_due(&c, now) {
            DriverRefresh::Seed => {
                c.at = Some(now);
                return;
            }
            DriverRefresh::Hold => (c.list.clone(), false),
            DriverRefresh::Read => {
                c.at = Some(now);
                c.reading = true;
                (c.list.clone(), true)
            }
        }
    };
    if start {
        let spawned = std::thread::Builder::new().name("gpu-driver-read".into()).spawn(|| {
            let read = detect_gpus_wmi();
            store_driver_read(&mut GPU_DRIVER_CACHE.lock().unwrap_or_else(std::sync::PoisonError::into_inner), read);
        });
        if spawned.is_err() {
            GPU_DRIVER_CACHE.lock().unwrap_or_else(std::sync::PoisonError::into_inner).reading = false;
        }
    }
    apply_wmi_driver_fields(gpus, &list);
}

/// The WMI record for a DXGI adapter: the same name match `detect_gpus` enriches with.
fn wmi_record_for<'a>(name: &str, wmi: &'a [GpuInfo]) -> Option<&'a GpuInfo> {
    wmi.iter()
        .find(|w| w.name.eq_ignore_ascii_case(name) || w.name.contains(name) || name.contains(&w.name))
}

/// Copy the driver fields of each adapter's WMI record onto it, field by field: a field the record
/// doesn't carry, and an adapter with no record, keep their own.
fn apply_wmi_driver_fields(gpus: &mut [GpuInfo], wmi: &[GpuInfo]) {
    for gpu in gpus.iter_mut() {
        if let Some(w) = wmi_record_for(&gpu.name, wmi) {
            if !w.driver_version.is_empty() {
                gpu.driver_version = w.driver_version.clone();
            }
            if !w.driver_date.is_empty() {
                gpu.driver_date = w.driver_date.clone();
            }
            if w.driver_age_days.is_some() {
                gpu.driver_age_days = w.driver_age_days;
            }
        }
    }
}

/// Re-read the handful of HardwareInfo fields that change during a session and are presented as
/// current on the hardware panel: RAM-in-use and per-disk free space. Both come from LOCAL syscalls
/// (`System::refresh_memory` / `Disks` — no WMI, no PowerShell, no thread spawn), so refreshing per
/// call costs microseconds and never re-triggers the startup WMI contention `collect_hardware`'s
/// cache exists to eliminate. Network connection state deliberately stays cached — refreshing it
/// means re-running the WMI+netsh adapter sweep (the exact cost the cache avoids); a mid-session
/// cable pull is a restart-to-refresh edge, consistent with the static-inventory contract. Only
/// known (already-enumerated) mount points are refreshed — a newly-mounted disk still awaits restart.
fn refresh_live_fields(hw: &mut HardwareInfo) {
    let mut sys = System::new();
    sys.refresh_memory();
    hw.ram_used_bytes = sys.used_memory();
    // The display mode too (codebase review 2026-11-02): Readiness and the refresh-rate rec tell the
    // user to raise it, and a startup snapshot kept both on until Compy restarted. A local
    // EnumDisplaySettings read, no WMI. (The GPU driver fields are WMI: `refresh_gpu_drivers`.)
    hw.display = detect_display_info();

    let fresh = Disks::new_with_refreshed_list();
    for disk in hw.disks.iter_mut() {
        if let Some(d) = fresh
            .iter()
            .find(|d| d.mount_point().to_string_lossy() == disk.mount_point)
        {
            disk.available_bytes = d.available_space();
        }
    }
}

fn collect_hardware_inner() -> HardwareInfo {
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

    // Enumerate + classify network adapters once (eligibility/dismiss/detection train). Both the
    // "currently connected wired" flag (diagnostics) and the "has a physical Ethernet port"
    // flag (eligibility) are DERIVED from the same honest inventory — never adapter-class alone.
    let network_adapters = detect_network_adapters();
    let has_active_wired_ethernet = network_adapters
        .iter()
        .any(|a| a.physical && a.medium == "wired" && a.connected);
    let has_wired_ethernet_port = network_adapters.iter().any(|a| a.physical && a.medium == "wired");
    // Only worth probing when a connected wired adapter exists (the EEE enumeration filters on
    // Status -eq 'Up' anyway — this just skips a PowerShell spawn on Wi-Fi-only rigs).
    let eee_switch_exposed = has_active_wired_ethernet
        && matches!(
            crate::actions::resolve_eee(),
            crate::actions::EeeResolution::Ready(_)
        );

    // Wi-Fi link quality — only when the ACTIVE connection is Wi-Fi (skips a netsh spawn on wired
    // rigs). Read-only; fails soft to None (localized Windows / older netsh → the generic advisory).
    let wifi_link = if network_connection_kind(&network_adapters) == "wifi" {
        detect_wifi_link()
    } else {
        None
    };

    // Derived network-readiness pills (backend signal) — built from the read-only inventory above,
    // no extra probe. Bind qos_policies first so both the pills and the struct field share one read.
    let qos_policies = detect_qos_policies();
    let network_pills =
        network_readiness_pills(&network_adapters, wifi_link.as_ref(), has_wired_ethernet_port, &qos_policies);

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
        disk_health: detect_disk_health(),
        display: detect_display_info(),
        memory_modules: detect_memory_modules(),
        windows_version: detect_windows_version(),
        bios_info: detect_bios(),
        virtualization: detect_virtualization(),
        usb: detect_usb_summary(),
        has_active_wired_ethernet,
        has_wired_ethernet_port,
        eee_switch_exposed,
        network_adapters,
        wifi_link,
        qos_policies,
        network_pills,
        game_storage: detect_game_storage(),
        monitors: detect_monitors(),
    }
}

#[cfg(test)]
mod live_refresh_tests {
    use super::{
        apply_wmi_driver_fields, driver_refresh_due, refresh_live_fields, store_driver_read, DiskInfo, Disks,
        DriverCache, DriverRefresh, GpuInfo, HardwareInfo, GPU_DRIVER_REFRESH,
    };

    // Codebase review 2026-11-03: the driver fields stayed the startup read, so the driver-age row and
    // the driver rec outlived a driver update, and the GPU before/after compared a driver it never
    // re-read. The first call starts the clock, a read stands for a minute, then it is read again.
    #[test]
    fn the_driver_fields_are_re_read_once_a_minute_never_on_the_first_call() {
        let t0 = std::time::Instant::now();
        let at = |at: Option<std::time::Instant>, reading: bool| DriverCache { at, list: Vec::new(), reading };
        assert_eq!(driver_refresh_due(&at(None, false), t0), DriverRefresh::Seed);
        assert_eq!(driver_refresh_due(&at(Some(t0), false), t0 + GPU_DRIVER_REFRESH / 2), DriverRefresh::Hold);
        assert_eq!(driver_refresh_due(&at(Some(t0), false), t0 + GPU_DRIVER_REFRESH), DriverRefresh::Read);
        // A read still running is never doubled, however long it takes (round 2 review).
        assert_eq!(driver_refresh_due(&at(Some(t0), true), t0 + GPU_DRIVER_REFRESH * 5), DriverRefresh::Hold);
    }

    // Round 2 review: a failed read and a record with a blank field must keep what was known.
    #[test]
    fn a_failed_read_or_a_blank_field_keeps_the_last_good_value() {
        let gpu = |version: &str, date: &str, days: Option<i64>| GpuInfo {
            name: "AMD Radeon RX 9070 XT".into(),
            driver_version: version.into(),
            driver_date: date.into(),
            driver_age_days: days,
            ..Default::default()
        };
        let mut c = DriverCache { at: None, list: vec![gpu("32.0.31", "2026-01-01", Some(300))], reading: true };
        store_driver_read(&mut c, Vec::new());
        assert!(!c.reading, "a finished read frees the next one");
        assert_eq!(c.list[0].driver_version, "32.0.31", "an empty read keeps the last good list");
        store_driver_read(&mut c, vec![gpu("32.0.32015.7029", "", None)]);
        assert_eq!(c.list[0].driver_version, "32.0.32015.7029", "the update is taken");
        assert_eq!(c.list[0].driver_date, "2026-01-01", "a blank date is no news");
        assert_eq!(c.list[0].driver_age_days, Some(300));
        let mut shown = vec![gpu("32.0.31", "2026-01-01", Some(300))];
        apply_wmi_driver_fields(&mut shown, &[gpu("", "", None)]);
        assert_eq!(shown[0].driver_version, "32.0.31", "a blank record blanks nothing it shows");
        assert_eq!(shown[0].driver_age_days, Some(300));
    }

    #[test]
    fn a_driver_read_updates_its_own_adapter_and_leaves_the_rest() {
        let gpu = |name: &str, version: &str, days: Option<i64>| GpuInfo {
            name: name.into(),
            driver_version: version.into(),
            driver_age_days: days,
            ..Default::default()
        };
        let mut gpus = vec![gpu("AMD Radeon RX 9070 XT", "32.0.31", Some(400)), gpu("Some Other GPU", "1.0", Some(30))];
        let wmi = vec![gpu("AMD Radeon RX 9070 XT", "32.0.32015.7029", Some(3))];
        apply_wmi_driver_fields(&mut gpus, &wmi);
        assert_eq!(gpus[0].driver_version, "32.0.32015.7029");
        assert_eq!(gpus[0].driver_age_days, Some(3), "the update is seen");
        assert_eq!(gpus[1].driver_version, "1.0", "no record, no change");
        apply_wmi_driver_fields(&mut gpus, &[]);
        assert_eq!(gpus[0].driver_version, "32.0.32015.7029", "an empty read blanks nothing");
    }

    // bug→guard (hardware.rs:1715): the process-lifetime cache froze RAM-in-use / free-disk at
    // startup, yet HardwareGrid.tsx renders them as current. refresh_live_fields must re-read them
    // on every collect_hardware() call — proven here by seeding an impossible sentinel and asserting
    // it is overwritten by a fresh local read.
    #[test]
    fn refresh_live_fields_re_reads_ram_not_a_frozen_snapshot() {
        let mut hw = HardwareInfo {
            ram_used_bytes: 999, // impossible: a live system never uses under 1 KB
            ..HardwareInfo::default()
        };
        refresh_live_fields(&mut hw);
        assert_ne!(
            hw.ram_used_bytes, 999,
            "RAM-in-use must be re-read on each collect_hardware, not served frozen"
        );
        assert!(hw.ram_used_bytes > 0, "live memory read should be non-zero");
    }

    #[test]
    fn refresh_live_fields_re_reads_free_disk_space() {
        // Seed a KNOWN mount point (a real one, so refresh actually touches it) with a sentinel.
        let fresh = Disks::new_with_refreshed_list();
        let Some(real) = fresh.iter().next() else {
            return; // no disks visible in this env — nothing to prove
        };
        let mut hw = HardwareInfo {
            disks: vec![DiskInfo {
                mount_point: real.mount_point().to_string_lossy().to_string(),
                total_bytes: 0,
                available_bytes: 999, // impossible free space for a mounted volume
                file_system: String::new(),
            }],
            ..HardwareInfo::default()
        };
        refresh_live_fields(&mut hw);
        assert_ne!(
            hw.disks[0].available_bytes, 999,
            "free disk space must be re-read live, not served frozen"
        );
    }
}

/// One enumerated network adapter, classified for honest evidence (eligibility/dismiss/detection).
/// `physical` = a real NIC with a connector — NOT a VPN TAP / Hyper-V vSwitch / Bluetooth-PAN /
/// USB-tether, which Windows also enumerates as "Ethernet"-class. `medium`: "wired" (802.3) /
/// "wifi" (Native802_11) / "other". `name` is the InterfaceDescription — the evidence shown to users.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct NetAdapterInfo {
    pub name: String,
    pub physical: bool,
    pub medium: String,
    pub connected: bool,
    /// Negotiated link speed in bits/sec (MSFT_NetAdapter.Speed), when readable. The *current*
    /// negotiated rate, not the NIC's max — `None` when unreadable. Drives the wired link-rate pill.
    #[serde(default)]
    pub link_speed_bps: Option<u64>,
}

// MSFT_NetAdapter (root\StandardCimv2) — unlike Win32_NetworkAdapter it exposes ConnectorPresent
// (the real physical-NIC signal) + NdisPhysicalMedium (802.3 vs Native802_11), which is what makes
// the virtual-vs-physical call honest.
#[derive(Deserialize)]
#[serde(rename = "MSFT_NetAdapter")]
#[serde(rename_all = "PascalCase")]
struct MsftNetAdapter {
    name: Option<String>,
    interface_description: Option<String>,
    connector_present: Option<bool>,
    ndis_physical_medium: Option<i64>,
    media_connect_state: Option<i64>,
    #[serde(rename = "PnPDeviceID")]
    pnp_device_id: Option<String>,
    interface_guid: Option<String>,
    /// Current negotiated link speed in bits/sec (uint64). `None`/0 when not reporting.
    speed: Option<u64>,
}

// Belt-and-suspenders virtual exclusion (a SECOND signal — never the only one): name patterns of the
// usual suspects that masquerade as Ethernet.
const VIRTUAL_NAME_PATTERNS: &[&str] = &[
    "tap-", "tap windows", "tap-windows", "tun", "hyper-v", "virtual", "vmware", "virtualbox",
    "vbox", "loopback", "npcap", "bluetooth", "wan miniport", "wi-fi direct", "wifi direct",
    "teredo", "isatap", "pseudo", "kernel debug", "packet scheduler", "qos packet",
];

pub(crate) fn name_is_virtual(name: &str) -> bool {
    let n = name.to_lowercase();
    VIRTUAL_NAME_PATTERNS.iter().any(|p| n.contains(p))
}

fn pnp_is_root_enumerated(pnp: Option<&str>) -> bool {
    pnp.map(|p| p.to_uppercase().starts_with("ROOT\\")).unwrap_or(false)
}

// NDIS_PHYSICAL_MEDIUM: 14 = 802.3 (wired Ethernet), 9 = Native802_11 (Wi-Fi). Anything else stays
// "other" — we classify strictly rather than guess "wired" from an unspecified medium.
pub(crate) fn classify_medium(ndis_physical_medium: Option<i64>) -> &'static str {
    match ndis_physical_medium {
        Some(14) => "wired",
        Some(9) => "wifi",
        _ => "other",
    }
}

/// Pure classifier (testable, no system access): decide if an adapter is a real physical NIC.
/// Primary signal = ConnectorPresent; the root-enumerated + name-pattern checks are the second signal.
pub(crate) fn is_physical_adapter(
    connector_present: Option<bool>,
    pnp_device_id: Option<&str>,
    name: &str,
) -> bool {
    connector_present == Some(true) && !pnp_is_root_enumerated(pnp_device_id) && !name_is_virtual(name)
}

/// Pure: classify the rig's ACTIVE physical network connection from the adapter inventory.
/// "wired" if a physical wired NIC is connected (it wins — what gaming should use even when Wi-Fi is
/// also up), else "wifi", else "other" (connected physical but an unclassified medium), else "none"
/// (offline / no physical link). Virtual/VPN adapters are excluded (only `physical` counts). Read-only.
pub(crate) fn network_connection_kind(adapters: &[NetAdapterInfo]) -> &'static str {
    let active = |medium: &str| {
        adapters
            .iter()
            .any(|a| a.physical && a.connected && a.medium == medium)
    };
    if active("wired") {
        "wired"
    } else if active("wifi") {
        "wifi"
    } else if adapters.iter().any(|a| a.physical && a.connected) {
        "other"
    } else {
        "none"
    }
}

/// A compact, at-a-glance network-readiness "pill" — a tiny labeled status chip the UI renders
/// (content/peripheral own the visual half). Backend signal only: derived ENTIRELY from the
/// already-collected read-only network inventory (adapters · Wi-Fi link · wired-port · QoS) — NO
/// probe of its own, NO outbound query, never a fabricated number.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct NetworkPill {
    /// Short chip text, e.g. "Wired Ethernet", "Wi-Fi · 5 GHz", "82% signal", "650 Mbps".
    pub label: String,
    /// Honest tone for the UI to color the chip — never a score:
    /// `"good"` = the steady/ideal state · `"neutral"` = a fine, plain fact · `"advisory"` = worth a
    /// glance, never a problem · `"unknown"` = couldn't read it.
    pub tone: String,
}

impl NetworkPill {
    fn new(label: impl Into<String>, tone: &str) -> Self {
        NetworkPill { label: label.into(), tone: tone.to_string() }
    }
}

/// Pure: the negotiated link speed (bits/sec) of the active physical WIRED adapter, when known.
/// Picks the first connected physical wired NIC that reports a speed — the link gaming should use.
pub(crate) fn active_wired_link_speed(adapters: &[NetAdapterInfo]) -> Option<u64> {
    adapters
        .iter()
        .find(|a| a.physical && a.connected && a.medium == "wired" && a.link_speed_bps.is_some())
        .and_then(|a| a.link_speed_bps)
}

/// Pure: format a bits/sec link rate as plain English ("1 Gbps", "2.5 Gbps", "100 Mbps"). Whole
/// gigabit values drop the decimal; sub-gigabit shows Mbps. 0 should never reach here (callers gate
/// on `> 0`), but degrades to "unknown" rather than printing "0 bps".
pub(crate) fn format_link_rate(bps: u64) -> String {
    if bps >= 1_000_000_000 {
        let gbps = bps as f64 / 1_000_000_000.0;
        if (gbps.fract()).abs() < 1e-9 {
            format!("{} Gbps", gbps as u64)
        } else {
            format!("{gbps:.1} Gbps")
        }
    } else if bps >= 1_000_000 {
        format!("{} Mbps", bps / 1_000_000)
    } else if bps > 0 {
        format!("{bps} bps")
    } else {
        "unknown".to_string()
    }
}

/// Pure: fold the already-collected network signals into the compact readiness pills. Mirrors the
/// `network-connection` readiness check's honesty — wired is the steady ideal (`good`), Wi-Fi is
/// `advisory` (fine for plenty of games, never a problem), offline is `unknown` (never a scare).
/// Only surfaces what was actually read; absent Wi-Fi fields add no pill. No WMI/netsh here — every
/// input is passed in, so the whole pill set is fixture-testable with zero system access.
pub(crate) fn network_readiness_pills(
    adapters: &[NetAdapterInfo],
    wifi: Option<&WifiLink>,
    has_wired_port: bool,
    qos_policies: &[String],
) -> Vec<NetworkPill> {
    let mut pills = Vec::new();
    match network_connection_kind(adapters) {
        "wired" => {
            pills.push(NetworkPill::new("Wired Ethernet", "good"));
            // Negotiated link rate — a plain fact, like the Wi-Fi rate pill. A ≤100 Mbps wired link
            // is worth a glance (modern Ethernet is gigabit; a low link usually means an old cable or
            // switch port) — never a problem (games need very little bandwidth), so `advisory`, not a scare.
            if let Some(bps) = active_wired_link_speed(adapters) {
                let tone = if bps <= 100_000_000 { "advisory" } else { "neutral" };
                pills.push(NetworkPill::new(format_link_rate(bps), tone));
            }
        }
        "wifi" => {
            let band = wifi.and_then(|w| w.band.clone());
            pills.push(NetworkPill::new(
                match &band {
                    Some(b) => format!("Wi-Fi · {b}"),
                    None => "Wi-Fi".to_string(),
                },
                "advisory",
            ));
            // Signal — a plain fact, but a weak signal is worth a glance.
            if let Some(s) = wifi.and_then(|w| w.signal_pct) {
                pills.push(NetworkPill::new(format!("{s}% signal"), if s < 50 { "advisory" } else { "neutral" }));
            }
            // Negotiated link rate — a plain fact.
            if let Some(r) = wifi.and_then(|w| w.rx_mbps) {
                pills.push(NetworkPill::new(format!("{r} Mbps"), "neutral"));
            }
            // 2.4 GHz overlap: only channels 1/6/11 don't overlap (matches the readiness advisory).
            if let Some(w) = wifi {
                if let (Some(b), Some(ch)) = (w.band.as_deref(), w.channel) {
                    if b.contains("2.4") && !matches!(ch, 1 | 6 | 11) {
                        pills.push(NetworkPill::new(format!("ch {ch} overlaps"), "advisory"));
                    }
                }
            }
            // The concrete win when a cable is actually an option on this rig.
            if has_wired_port {
                pills.push(NetworkPill::new("Wired port available", "advisory"));
            }
        }
        "other" => pills.push(NetworkPill::new("Connected", "neutral")),
        _ => pills.push(NetworkPill::new("Offline", "unknown")),
    }
    // A QoS policy shapes which apps get network priority — surfaced as-found (advisory), never a problem.
    if !qos_policies.is_empty() {
        let label = if qos_policies.len() == 1 { "QoS policy".to_string() } else { format!("{} QoS policies", qos_policies.len()) };
        pills.push(NetworkPill::new(label, "advisory"));
    }
    pills
}

/// Active Wi-Fi link quality, read once when the rig is on Wi-Fi. Every field is optional — netsh
/// reports vary by Windows version and locale, so we surface only what we can parse, never a guess.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub(crate) struct WifiLink {
    /// "2.4 GHz" / "5 GHz" / "6 GHz" — from the Band line (Win11), else inferred 2.4-vs-5 from Channel.
    pub band: Option<String>,
    /// Signal strength percentage (0–100) as Windows reports it.
    pub signal_pct: Option<u8>,
    /// Negotiated receive (link) rate in Mbps — the headline "how fast is this link" number.
    pub rx_mbps: Option<u32>,
    /// Radio type, e.g. "802.11ax" (Wi-Fi 6) / "802.11ac" (Wi-Fi 5).
    pub radio_type: Option<String>,
    /// Wi-Fi channel number (drives the 2.4 GHz overlap advisory: only 1/6/11 are non-overlapping).
    pub channel: Option<u32>,
}

/// Pure: parse `netsh wlan show interfaces` output into the active link's quality fields. Matches the
/// English labels best-effort and fails soft — a localized Windows (translated labels) or a "not
/// connected" interface yields None, so the readiness row falls back to the generic Wi-Fi advisory
/// rather than fabricating numbers. First interface wins (the primary connection).
pub(crate) fn parse_netsh_wlan_interfaces(out: &str) -> Option<WifiLink> {
    let mut map: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for line in out.lines() {
        if let Some((k, v)) = line.split_once(':') {
            let key = k.trim().to_lowercase();
            let val = v.trim().to_string();
            if !key.is_empty() && !val.is_empty() {
                map.entry(key).or_insert(val); // first occurrence (primary interface) wins
            }
        }
    }
    // Only report a link when an interface is actually connected.
    if map.get("state").map(|s| s.eq_ignore_ascii_case("connected")) != Some(true) {
        return None;
    }
    let signal_pct = map
        .get("signal")
        .and_then(|s| s.trim_end_matches('%').trim().parse::<u8>().ok());
    let rx_mbps = map
        .get("receive rate (mbps)")
        .and_then(|s| s.split_whitespace().next())
        .and_then(|s| s.parse::<f64>().ok())
        .map(|f| f.round() as u32);
    let radio_type = map.get("radio type").cloned();
    let channel = map.get("channel").and_then(|c| c.parse::<u32>().ok());
    let band = map.get("band").cloned().or_else(|| {
        // Win10 omits Band — infer 2.4-vs-5 from Channel (1–14 = 2.4 GHz). 6 GHz channel numbering
        // overlaps, so we never GUESS 6 GHz from a channel; only an explicit Band line reports it.
        channel.map(|ch| if ch <= 14 { "2.4 GHz" } else { "5 GHz" }.to_string())
    });
    Some(WifiLink { band, signal_pct, rx_mbps, radio_type, channel })
}

/// Read-only Wi-Fi link probe via `netsh wlan show interfaces` (no admin, no mutation, no network).
/// Called only when the active connection is Wi-Fi, so wired rigs never pay for the spawn.
fn detect_wifi_link() -> Option<WifiLink> {
    let out = crate::actions::quiet_command("netsh")
        .args(["wlan", "show", "interfaces"])
        .output()
        .ok()?;
    parse_netsh_wlan_interfaces(&String::from_utf8_lossy(&out.stdout))
}

/// Read-only: Policy-based QoS policy NAMES from the standard policy keys (machine HKLM + user HKCU).
/// These shape network traffic priority/throttling. Returns empty on the common case (key absent =
/// no policies, NOT an error) — so the readiness advisory only appears on rigs that actually have one.
/// No elevation, no mutation, no network.
fn detect_qos_policies() -> Vec<String> {
    const QOS_PATH: &str = "SOFTWARE\\Policies\\Microsoft\\Windows\\QoS";
    let mut names: Vec<String> = Vec::new();
    for hive in [HKEY_LOCAL_MACHINE, winreg::enums::HKEY_CURRENT_USER] {
        if let Ok(key) = RegKey::predef(hive).open_subkey(QOS_PATH) {
            names.extend(key.enum_keys().flatten());
        }
    }
    names.sort();
    names.dedup();
    names
}

/// Enumerate + classify network adapters. Fail-soft to an empty inventory (claim NO wired rather than
/// risk the false-positive we're fixing). Callers derive has_active_wired / has_port from this.
pub(crate) fn detect_network_adapters() -> Vec<NetAdapterInfo> {
    on_wmi_thread(|| {
        let com = match COMLibrary::new() {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        let conn = match WMIConnection::with_namespace_path("ROOT\\StandardCimv2", com) {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        let rows: Vec<MsftNetAdapter> = conn.query().unwrap_or_default();
        rows.into_iter()
            .filter_map(|a| {
                let name = a
                    .interface_description
                    .or(a.name)
                    .unwrap_or_default();
                if name.trim().is_empty() {
                    return None;
                }
                Some(NetAdapterInfo {
                    physical: is_physical_adapter(
                        a.connector_present,
                        a.pnp_device_id.as_deref(),
                        &name,
                    ),
                    medium: classify_medium(a.ndis_physical_medium).to_string(),
                    connected: a.media_connect_state == Some(1),
                    // 0 (the "not reporting" sentinel) collapses to None so we never show "0 bps".
                    link_speed_bps: a.speed.filter(|&s| s > 0),
                    name,
                })
            })
            .collect()
    })
}

/// Interface GUIDs (UPPER-cased, braced — matching the `Tcpip\Parameters\Interfaces` key names) of
/// PHYSICAL NICs only. Used to target per-interface network tweaks (Nagle) at real adapters, never at
/// VPN/virtual ones. Empty when undeterminable — callers MUST fall back (never silently no-op).
pub(crate) fn physical_nic_guids() -> Vec<String> {
    on_wmi_thread(|| {
        let com = match COMLibrary::new() {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        let conn = match WMIConnection::with_namespace_path("ROOT\\StandardCimv2", com) {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        let rows: Vec<MsftNetAdapter> = conn.query().unwrap_or_default();
        rows.into_iter()
            .filter_map(|a| {
                let name = a
                    .interface_description
                    .clone()
                    .or_else(|| a.name.clone())
                    .unwrap_or_default();
                if is_physical_adapter(a.connector_present, a.pnp_device_id.as_deref(), &name) {
                    a.interface_guid.map(|g| g.to_uppercase())
                } else {
                    None
                }
            })
            .collect()
    })
}

// ── Connected display models (EDID via WmiMonitorID, root\wmi) ────────────────────────────────────
// Win32_DesktopMonitor only ever reports "Generic PnP Monitor"; WmiMonitorID carries the real EDID
// strings — the manufacturer PNP code + the user-friendly model — so "for YOUR monitor" can name the
// actual panel (and later drive model-specific hints). Read-only, on the WMI thread (the safe pattern,
// per the power-source thread-safety precedent); fail-soft to empty (a blocked root\wmi just hides it).
#[derive(Serialize, Clone, Default)]
pub(crate) struct MonitorInfo {
    pub(crate) model: String,        // EDID UserFriendlyName, e.g. "XFA253Q Z"
    pub(crate) manufacturer: String, // resolved vendor, e.g. "Acer" (falls back to the raw PNP code)
}

// EDID strings arrive as uint16 char-code arrays, 0x00-padded (sometimes 0x0A-terminated). Decode to
// printable ASCII, drop terminator/padding/control bytes, trim. Pure + testable.
pub(crate) fn decode_edid_string(codes: &[u16]) -> String {
    codes
        .iter()
        // ASCII only. A code unit >0x7F is NOT printable ASCII — `as u8` would truncate it to
        // its low byte and fabricate a wrong char (e.g. 0x0141 -> 'A'), violating the file's
        // "never a fabricated name" rule. Drop it instead so a non-conforming panel reads short,
        // never wrong. (Within 0x00-0x7F the cast is lossless.)
        .filter(|&&c| c < 0x80)
        .map(|&c| c as u8 as char)
        .filter(|&c| c != '\0' && !c.is_control())
        .collect::<String>()
        .trim()
        .to_string()
}

// Common monitor-vendor PNP codes → display name (COSMETIC only; an unknown code is shown as-is, never
// a fabricated name). Not a safety-critical list — a missing entry only changes how the label reads.
pub(crate) fn monitor_vendor_name(code: &str) -> String {
    match code {
        "ACR" | "ACI" => "Acer",
        "AUS" | "ASU" => "ASUS",
        "SAM" | "SEC" => "Samsung",
        "DEL" => "Dell",
        "LGD" | "GSM" | "LGE" => "LG",
        "BNQ" => "BenQ",
        "MSI" => "MSI",
        "GBT" | "GIG" => "Gigabyte",
        "HPN" | "HWP" => "HP",
        "AOC" => "AOC",
        "VSC" => "ViewSonic",
        "NEC" => "NEC",
        "PHL" => "Philips",
        other => other,
    }
    .to_string()
}

#[derive(Deserialize)]
#[serde(rename = "WmiMonitorID")]
#[serde(rename_all = "PascalCase")]
struct WmiMonitorIdRow {
    user_friendly_name: Option<Vec<u16>>,
    manufacturer_name: Option<Vec<u16>>,
}

pub(crate) fn detect_monitors() -> Vec<MonitorInfo> {
    on_wmi_thread(|| {
        let com = match COMLibrary::new() {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        let conn = match WMIConnection::with_namespace_path("ROOT\\WMI", com) {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };
        let rows: Vec<WmiMonitorIdRow> = conn.query().unwrap_or_default();
        rows.into_iter()
            .filter_map(|r| {
                let model = decode_edid_string(&r.user_friendly_name.unwrap_or_default());
                if model.is_empty() {
                    return None; // no readable model → don't surface a blank monitor
                }
                let code = decode_edid_string(&r.manufacturer_name.unwrap_or_default());
                Some(MonitorInfo {
                    manufacturer: if code.is_empty() { String::new() } else { monitor_vendor_name(&code) },
                    model,
                })
            })
            .collect()
    })
}

#[tauri::command]
pub(crate) fn get_hardware_info() -> HardwareInfo {
    collect_hardware()
}

pub(crate) fn gpu_vendor_match(hw: &HardwareInfo, needle: &str) -> Option<String> {
    hw.gpus
        .iter()
        .find(|g| g.name.to_uppercase().contains(needle))
        .map(|g| g.name.clone())
}

/// A compact rig identity stamped on each session — groundwork for later same-rig analysis
/// (per-rig empirical noise floor, upgrade validation). The readable fields ride alongside the hash
/// so the data is self-describing. Local-only; never leaves the machine.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub(crate) struct HwFingerprint {
    /// Short stable digest of the canonical rig string — the grouping key.
    pub hash: String,
    pub gpu: String,
    pub gpu_driver: String,
    pub ram_gb: u32,
    /// "<w>x<h>@<refresh>" or "" if no display was read.
    pub display: String,
}

/// CR-driver-compare-everywhere: whether two recorded GPU driver versions are the same driver. The
/// same version written with other spacing or case is the same driver (as the Trial preflight
/// compares it). Used where a driver comparison decides comparability, a measured band or a What
/// changed cause (comparability.rs, noise_floor.rs, intelligence.rs's gpu-driver-change hypothesis);
/// the timeline's driver-change event, the hardware snapshot save and the driver-split pattern still
/// compare exactly (queued: CR-driver-compare-rest).
pub(crate) fn same_driver(a: &str, b: &str) -> bool {
    a.trim().eq_ignore_ascii_case(b.trim())
}

/// Whether two recorded GPU driver versions show a driver change: both read (a blank or
/// whitespace-only read is a failed probe, never a version) and not [`same_driver`]. An unread side
/// is unknown, never a change.
pub(crate) fn driver_changed(a: &str, b: &str) -> bool {
    !a.trim().is_empty() && !b.trim().is_empty() && !same_driver(a, b)
}

/// Pure: build a fingerprint from rig fields (testable — no system access).
fn fingerprint_of(gpu: &str, gpu_driver: &str, ram_gb: u32, display: &str) -> HwFingerprint {
    use sha2::{Digest, Sha256};
    let canonical = format!("{gpu}|{gpu_driver}|{ram_gb}GB|{display}");
    let digest = Sha256::digest(canonical.as_bytes());
    let hash: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    HwFingerprint {
        hash,
        gpu: gpu.into(),
        gpu_driver: gpu_driver.into(),
        ram_gb,
        display: display.into(),
    }
}

/// Fingerprint the current rig from the cached hardware snapshot. Local-only; no egress.
pub(crate) fn current_fingerprint() -> HwFingerprint {
    fingerprint_from_info(&get_hardware_info())
}

/// PURE: the rig fingerprint of one hardware read (TG-preflight NIT: a caller that already holds
/// the read fingerprints that same read instead of taking a second one).
pub(crate) fn fingerprint_from_info(hw: &HardwareInfo) -> HwFingerprint {
    let primary = primary_gpu(hw);
    let ram_gb = (hw.ram_total_bytes as f64 / 1024f64.powi(3)).round() as u32;
    let display = hw
        .display
        .as_ref()
        .map(|d| format!("{}x{}@{}", d.width, d.height, d.max_refresh_rate_hz))
        .unwrap_or_default();
    fingerprint_of(
        primary.map(|g| g.name.as_str()).unwrap_or(""),
        primary.map(|g| g.driver_version.as_str()).unwrap_or(""),
        ram_gb,
        &display,
    )
}

#[cfg(test)]
mod fingerprint_tests {
    use super::fingerprint_of;

    #[test]
    fn fingerprint_is_stable_and_distinguishes_rigs() {
        let a = fingerprint_of("Radeon RX 9070 XT", "25.5.1", 32, "2560x1440@250");
        let a2 = fingerprint_of("Radeon RX 9070 XT", "25.5.1", 32, "2560x1440@250");
        let b = fingerprint_of("Radeon RX 9070 XT", "25.6.0", 32, "2560x1440@250"); // driver bump
        assert_eq!(a.hash, a2.hash, "same rig → same hash");
        assert_ne!(a.hash, b.hash, "a driver change is a different fingerprint");
        assert_eq!(a.hash.len(), 16); // 8 bytes hex
        assert_eq!(a.ram_gb, 32);
        assert_eq!(a.display, "2560x1440@250");
    }
}

#[cfg(test)]
mod game_storage_tests {
    use super::{drive_letter_of, parse_steam_library_paths};

    #[test]
    fn drive_letter_basic() {
        assert_eq!(drive_letter_of("C:\\Program Files"), Some('C'));
        assert_eq!(drive_letter_of("d:\\games"), Some('D'));
        assert_eq!(drive_letter_of("\\\\server\\share"), None);
        assert_eq!(drive_letter_of(""), None);
        assert_eq!(drive_letter_of("relative\\path"), None);
    }

    #[test]
    fn steam_vdf_paths_parsed() {
        let vdf = r#"
        "path"     "C:\\Program Files (x86)\\Steam"
        "path"     "D:\\SteamLibrary"
"#;
        let paths = parse_steam_library_paths(vdf);
        assert_eq!(
            paths,
            vec!["C:\\Program Files (x86)\\Steam", "D:\\SteamLibrary"]
        );
    }
}

#[cfg(test)]
mod nic_driver_tests {
    use super::{nic_driver_from, nic_vendor};

    #[test]
    fn microsoft_virtual_net_entries_are_dropped() {
        // WAN Miniport / Hyper-V plumbing is not a user-updatable NIC driver.
        assert!(nic_driver_from(
            Some("WAN Miniport (IP)".into()),
            Some("Microsoft".into()),
            Some("20200101000000.000000-000".into()),
        )
        .is_none());
        // A nameless row can't be a receipt — dropped rather than guessed.
        assert!(nic_driver_from(None, Some("Intel".into()), None).is_none());
    }

    #[test]
    fn real_nics_keep_name_vendor_and_honest_age() {
        let n = nic_driver_from(
            Some("Realtek PCIe GbE Family Controller".into()),
            Some("Realtek".into()),
            Some("20220301000000.000000-000".into()),
        )
        .expect("real NIC kept");
        assert_eq!(n.vendor, "realtek");
        assert_eq!(n.driver_date, "2022-03-01");
        assert!(n.driver_age_days.unwrap_or(0) > 1000, "a 2022 driver is years old");
        // Unparseable date stays honestly unknown — never a fabricated age.
        let u = nic_driver_from(Some("Intel I226-V".into()), Some("Intel".into()), None).expect("kept");
        assert_eq!(u.driver_age_days, None);
        assert_eq!(u.driver_date, "");
    }

    #[test]
    fn vendor_classification_covers_the_common_nics() {
        assert_eq!(nic_vendor("Intel", "Intel(R) Ethernet I226-V"), "intel");
        assert_eq!(nic_vendor("Rivet Networks", "Killer E3100G"), "intel");
        assert_eq!(nic_vendor("Realtek", "Realtek PCIe GbE"), "realtek");
        assert_eq!(nic_vendor("Qualcomm Atheros", "QCA61x4A"), "qualcomm");
        assert_eq!(nic_vendor("Somebody", "Mystery NIC 9000"), "unknown");
    }
}

#[cfg(test)]
mod net_adapter_tests {
    use super::{classify_medium, is_physical_adapter, name_is_virtual};

    #[test]
    fn medium_classified_strictly_from_ndis() {
        assert_eq!(classify_medium(Some(14)), "wired"); // 802.3
        assert_eq!(classify_medium(Some(9)), "wifi"); // Native802_11
        assert_eq!(classify_medium(Some(0)), "other"); // unspecified — never guessed "wired"
        assert_eq!(classify_medium(Some(10)), "other"); // bluetooth
        assert_eq!(classify_medium(None), "other");
    }

    #[test]
    fn real_nic_is_physical() {
        // ConnectorPresent + PCI-enumerated + a real name → physical.
        assert!(is_physical_adapter(
            Some(true),
            Some("PCI\\VEN_10EC&DEV_8168"),
            "Realtek PCIe GbE Family Controller"
        ));
        assert!(is_physical_adapter(
            Some(true),
            Some("PCI\\VEN_8086"),
            "Intel(R) Wi-Fi 6E AX211 160MHz"
        ));
    }

    #[test]
    fn virtual_adapters_are_not_physical_even_if_connectorpresent_lies() {
        // The false-Ethernet bug: virtual adapters that claim ConnectorPresent/are "connected".
        assert!(!is_physical_adapter(Some(true), Some("ROOT\\VMS_MP\\0000"), "Hyper-V Virtual Ethernet Adapter"));
        assert!(!is_physical_adapter(Some(true), Some("ROOT\\NET\\0000"), "TAP-Windows Adapter V9"));
        assert!(!is_physical_adapter(Some(true), Some("SW\\{...}"), "VMware Virtual Ethernet Adapter"));
        // ConnectorPresent false → not physical regardless of name.
        assert!(!is_physical_adapter(Some(false), Some("PCI\\..."), "Some NIC"));
        assert!(!is_physical_adapter(None, None, "Unknown"));
    }

    #[test]
    fn virtual_name_patterns_match_the_usual_suspects() {
        assert!(name_is_virtual("TAP-Windows Adapter V9"));
        assert!(name_is_virtual("Hyper-V Virtual Ethernet Adapter"));
        assert!(name_is_virtual("Bluetooth Device (Personal Area Network)"));
        assert!(name_is_virtual("VirtualBox Host-Only Ethernet Adapter"));
        assert!(!name_is_virtual("Realtek PCIe GbE Family Controller"));
        assert!(!name_is_virtual("Intel Ethernet Connection I219-V"));
    }

    use super::{network_connection_kind, NetAdapterInfo};
    fn adapter(physical: bool, medium: &str, connected: bool) -> NetAdapterInfo {
        NetAdapterInfo { name: "NIC".into(), physical, medium: medium.into(), connected, link_speed_bps: None }
    }

    #[test]
    fn connection_kind_prefers_active_wired_then_wifi() {
        // A connected physical wired NIC is the active connection (even if Wi-Fi is also up).
        assert_eq!(network_connection_kind(&[adapter(true, "wired", true)]), "wired");
        assert_eq!(
            network_connection_kind(&[adapter(true, "wired", true), adapter(true, "wifi", true)]),
            "wired",
        );
        // Wired present but DOWN, Wi-Fi up → wifi is the active connection.
        assert_eq!(
            network_connection_kind(&[adapter(true, "wired", false), adapter(true, "wifi", true)]),
            "wifi",
        );
    }

    #[test]
    fn connection_kind_ignores_virtual_and_handles_offline() {
        // A virtual adapter (physical=false) never counts, even if it claims connected+wired.
        assert_eq!(network_connection_kind(&[adapter(false, "wired", true)]), "none");
        // No physical link up at all → none (offline; honest, not a scare).
        assert_eq!(network_connection_kind(&[adapter(true, "wired", false)]), "none");
        assert_eq!(network_connection_kind(&[]), "none");
        // Connected physical of an unclassified medium → "other" (never guessed wired/wifi).
        assert_eq!(network_connection_kind(&[adapter(true, "other", true)]), "other");
    }

    // ── network-readiness pills (A4, backend signal) ───────────────────────────────────────────

    use super::{network_readiness_pills, WifiLink};

    fn pill_labels(pills: &[super::NetworkPill]) -> Vec<String> {
        pills.iter().map(|p| p.label.clone()).collect()
    }
    fn tone_of<'a>(pills: &'a [super::NetworkPill], label: &str) -> Option<&'a str> {
        pills.iter().find(|p| p.label == label).map(|p| p.tone.as_str())
    }

    #[test]
    fn pills_wired_is_a_single_good_chip() {
        let pills = network_readiness_pills(&[adapter(true, "wired", true)], None, true, &[]);
        assert_eq!(pill_labels(&pills), vec!["Wired Ethernet"]);
        assert_eq!(pills[0].tone, "good");
    }

    #[test]
    fn pills_offline_is_unknown_never_a_scare() {
        let pills = network_readiness_pills(&[], None, false, &[]);
        assert_eq!(pill_labels(&pills), vec!["Offline"]);
        assert_eq!(pills[0].tone, "unknown");
        // "other" (connected, unclassified medium) is a plain neutral fact.
        let other = network_readiness_pills(&[adapter(true, "other", true)], None, false, &[]);
        assert_eq!(pill_labels(&other), vec!["Connected"]);
        assert_eq!(other[0].tone, "neutral");
    }

    // ── wired link-rate detection (A4, zero-outbound) ──────────────────────────────────────────

    fn wired_at(bps: u64) -> NetAdapterInfo {
        NetAdapterInfo {
            name: "NIC".into(),
            physical: true,
            medium: "wired".into(),
            connected: true,
            link_speed_bps: Some(bps),
        }
    }

    #[test]
    fn format_link_rate_reads_plain_english() {
        use super::format_link_rate;
        assert_eq!(format_link_rate(1_000_000_000), "1 Gbps");
        assert_eq!(format_link_rate(2_500_000_000), "2.5 Gbps");
        assert_eq!(format_link_rate(10_000_000_000), "10 Gbps");
        assert_eq!(format_link_rate(100_000_000), "100 Mbps");
        assert_eq!(format_link_rate(10_000_000), "10 Mbps");
        assert_eq!(format_link_rate(0), "unknown");
    }

    #[test]
    fn active_wired_link_speed_picks_the_connected_physical_wired_nic() {
        use super::active_wired_link_speed;
        // Wins over a Wi-Fi adapter and a disconnected/virtual one; ignores adapters with no speed.
        let adapters = vec![
            adapter(true, "wifi", true),                  // wrong medium
            adapter(true, "wired", false),                // down
            wired_at(1_000_000_000),                      // the one
        ];
        assert_eq!(active_wired_link_speed(&adapters), Some(1_000_000_000));
        // No wired link at all → None (never fabricated).
        assert_eq!(active_wired_link_speed(&[adapter(true, "wifi", true)]), None);
        // Wired up but speed unreadable → None (the adapter() helper has link_speed_bps: None).
        assert_eq!(active_wired_link_speed(&[adapter(true, "wired", true)]), None);
    }

    #[test]
    fn pills_wired_shows_gigabit_as_a_neutral_fact() {
        let pills = network_readiness_pills(&[wired_at(1_000_000_000)], None, false, &[]);
        assert_eq!(pill_labels(&pills), vec!["Wired Ethernet", "1 Gbps"]);
        assert_eq!(tone_of(&pills, "Wired Ethernet"), Some("good"));
        assert_eq!(tone_of(&pills, "1 Gbps"), Some("neutral"));
    }

    #[test]
    fn pills_wired_flags_a_100mbps_link_as_advisory_not_a_scare() {
        // A gigabit-era port linked at 100 Mbps is worth a glance (cable/port), never a problem.
        let pills = network_readiness_pills(&[wired_at(100_000_000)], None, false, &[]);
        assert_eq!(tone_of(&pills, "100 Mbps"), Some("advisory"));
        // Still "good" for the connection itself — the advisory is only on the rate chip.
        assert_eq!(tone_of(&pills, "Wired Ethernet"), Some("good"));
    }

    #[test]
    fn pills_wired_without_a_readable_rate_stays_a_single_chip() {
        // Unreadable speed must not add a chip or fabricate a rate.
        let pills = network_readiness_pills(&[adapter(true, "wired", true)], None, false, &[]);
        assert_eq!(pill_labels(&pills), vec!["Wired Ethernet"]);
    }

    #[test]
    fn pills_wifi_surfaces_only_readable_quality_and_stays_advisory() {
        let adapters = [adapter(true, "wifi", true)];
        // Full link: band + strong signal + rate. Wi-Fi chip is advisory; signal/rate are neutral facts.
        let link = WifiLink {
            band: Some("5 GHz".into()),
            signal_pct: Some(82),
            rx_mbps: Some(866),
            radio_type: Some("802.11ax".into()),
            channel: Some(36),
        };
        let pills = network_readiness_pills(&adapters, Some(&link), false, &[]);
        assert_eq!(pill_labels(&pills), vec!["Wi-Fi · 5 GHz", "82% signal", "866 Mbps"]);
        assert_eq!(tone_of(&pills, "Wi-Fi · 5 GHz"), Some("advisory"));
        assert_eq!(tone_of(&pills, "82% signal"), Some("neutral"));
        assert_eq!(tone_of(&pills, "866 Mbps"), Some("neutral"));
        // No readable link fields → just the bare Wi-Fi chip, nothing fabricated.
        let bare = network_readiness_pills(&adapters, None, false, &[]);
        assert_eq!(pill_labels(&bare), vec!["Wi-Fi"]);
    }

    #[test]
    fn pills_weak_signal_is_advisory_and_24ghz_overlap_flagged() {
        let adapters = [adapter(true, "wifi", true)];
        let weak = WifiLink {
            band: Some("2.4 GHz".into()),
            signal_pct: Some(35),
            rx_mbps: None,
            radio_type: None,
            channel: Some(3), // not 1/6/11 → overlaps
        };
        let pills = network_readiness_pills(&adapters, Some(&weak), false, &[]);
        assert_eq!(tone_of(&pills, "35% signal"), Some("advisory"), "a weak signal is worth a glance");
        assert!(pill_labels(&pills).iter().any(|l| l == "ch 3 overlaps"));
        assert_eq!(tone_of(&pills, "ch 3 overlaps"), Some("advisory"));
        // A non-overlapping 2.4 GHz channel adds no overlap pill.
        let clean = WifiLink { channel: Some(6), ..weak.clone() };
        let clean_pills = network_readiness_pills(&adapters, Some(&clean), false, &[]);
        assert!(!pill_labels(&clean_pills).iter().any(|l| l.contains("overlaps")));
    }

    #[test]
    fn pills_wifi_with_wired_port_nudges_to_plug_in() {
        let adapters = [adapter(true, "wifi", true)];
        let link = WifiLink { band: Some("5 GHz".into()), signal_pct: None, rx_mbps: None, radio_type: None, channel: None };
        let pills = network_readiness_pills(&adapters, Some(&link), true, &[]);
        assert!(pill_labels(&pills).iter().any(|l| l == "Wired port available"));
        assert_eq!(tone_of(&pills, "Wired port available"), Some("advisory"));
        // Wired connection never nudges (it's already the ideal).
        let wired = network_readiness_pills(&[adapter(true, "wired", true)], None, true, &[]);
        assert!(!pill_labels(&wired).iter().any(|l| l.contains("Wired port")));
    }

    #[test]
    fn pills_qos_policy_is_advisory_and_counts_plurally() {
        let one = network_readiness_pills(&[adapter(true, "wired", true)], None, true, &["GameQoS".into()]);
        assert_eq!(tone_of(&one, "QoS policy"), Some("advisory"));
        let many = network_readiness_pills(
            &[adapter(true, "wired", true)],
            None,
            true,
            &["A".into(), "B".into()],
        );
        assert!(pill_labels(&many).iter().any(|l| l == "2 QoS policies"));
        // No policy → no QoS pill (no clutter when clean).
        let none = network_readiness_pills(&[adapter(true, "wired", true)], None, true, &[]);
        assert!(!none.iter().any(|p| p.label.contains("QoS")));
    }

    use super::parse_netsh_wlan_interfaces;

    #[test]
    fn wlan_parse_reads_band_signal_rate_radio_from_win11_output() {
        let out = "\
There is 1 interface on the system:

    Name                   : Wi-Fi
    Description            : Intel(R) Wi-Fi 6E AX211 160MHz
    State                  : connected
    SSID                   : MyNet
    Radio type             : 802.11ax
    Band                   : 5 GHz
    Channel                : 36
    Receive rate (Mbps)    : 866.7
    Transmit rate (Mbps)   : 866.7
    Signal                 : 86%
";
        let w = parse_netsh_wlan_interfaces(out).expect("connected → Some");
        assert_eq!(w.band.as_deref(), Some("5 GHz"));
        assert_eq!(w.signal_pct, Some(86));
        assert_eq!(w.rx_mbps, Some(867)); // 866.7 rounds to 867
        assert_eq!(w.radio_type.as_deref(), Some("802.11ax"));
        assert_eq!(w.channel, Some(36));
    }

    #[test]
    fn wlan_parse_infers_band_from_channel_when_band_line_absent() {
        // Win10 omits the Band line — infer 2.4 GHz from a low channel, never a guess for 6 GHz.
        let out = "    State : connected\n    Channel : 11\n    Signal : 50%\n";
        let w = parse_netsh_wlan_interfaces(out).unwrap();
        assert_eq!(w.band.as_deref(), Some("2.4 GHz"));
        assert_eq!(w.signal_pct, Some(50));
        assert_eq!(w.rx_mbps, None); // no receive-rate line → honestly None, not 0
        assert_eq!(w.channel, Some(11)); // surfaced for the 2.4 GHz overlap advisory
    }

    #[test]
    fn wlan_parse_returns_none_when_not_connected_or_unparseable() {
        // Disconnected interface → None (no link to report).
        assert!(parse_netsh_wlan_interfaces("    State : disconnected\n").is_none());
        // No State line at all (e.g. localized labels we can't match) → None, falls back to generic.
        assert!(parse_netsh_wlan_interfaces("    Nombre : Wi-Fi\n    Señal : 70%\n").is_none());
        assert!(parse_netsh_wlan_interfaces("").is_none());
    }

    use super::{decode_edid_string, monitor_vendor_name};

    #[test]
    fn edid_decode_strips_padding_terminators_and_control_bytes() {
        // "XFA253QZ" clean; "VG245" 0-padded; "ACR" + 0x0A terminator + space pad → trimmed.
        assert_eq!(decode_edid_string(&[88, 70, 65, 50, 53, 51, 81, 90]), "XFA253QZ");
        assert_eq!(decode_edid_string(&[86, 71, 50, 52, 53, 0, 0, 0]), "VG245");
        assert_eq!(decode_edid_string(&[65, 67, 82, 10, 32, 32]), "ACR");
        assert_eq!(decode_edid_string(&[]), "");
        assert_eq!(decode_edid_string(&[0, 0, 0]), "");
        // A >0x7F code unit (non-conforming firmware) is DROPPED, never truncated into a
        // fabricated ASCII char: 0x0141 must not become 'A' (would yield "XAF").
        assert_eq!(decode_edid_string(&[88, 0x0141, 70]), "XF");
    }

    #[test]
    fn monitor_vendor_maps_common_codes_and_never_fabricates_unknowns() {
        assert_eq!(monitor_vendor_name("ACR"), "Acer");
        assert_eq!(monitor_vendor_name("AUS"), "ASUS");
        assert_eq!(monitor_vendor_name("SAM"), "Samsung");
        // An unknown PNP code is shown as-is — never a guessed/fabricated vendor name.
        assert_eq!(monitor_vendor_name("ZZZ"), "ZZZ");
    }
}

// ── Coverage sweep: pure parsers (CPU arch / Intel labels / SMBIOS) ─────────
// These functions are platform-agnostic pure parsers (no winapi / WMI / registry),
// so this module needs NO #[cfg(windows)] gate. Synthetic inputs only — the live
// probe/firmware-table paths are never exercised here.
#[cfg(test)]
mod parser_tests {
    use super::*;

    // ───────────────────────── parse_cpu_arch (AMD) ─────────────────────────

    #[test]
    fn amd_ryzen_x3d_zen4() {
        // "7800X3D" -> first model char '7' -> "Zen 4", series "7000 series".
        let info = parse_cpu_arch("AMD Ryzen 7 7800X3D 8-Core Processor").expect("parsed");
        assert_eq!(info.vendor, "AMD");
        assert_eq!(info.family_label, "Ryzen 7 7800X3D");
        assert_eq!(info.architecture, "Zen 4");
        assert_eq!(info.generation, "7000 series");
    }

    #[test]
    fn amd_ryzen_zen2_zen3_zen5_arch_table() {
        // Maps the leading model digit straight to the arch label per the match arm.
        let z2 = parse_cpu_arch("AMD Ryzen 5 3600X 6-Core Processor").unwrap();
        assert_eq!(z2.architecture, "Zen 2"); // '3' => "Zen 2"
        assert_eq!(z2.generation, "3000 series");

        let z3 = parse_cpu_arch("AMD Ryzen 9 5950X 16-Core Processor").unwrap();
        assert_eq!(z3.architecture, "Zen 3"); // '5' => "Zen 3"
        assert_eq!(z3.family_label, "Ryzen 9 5950X");

        let z5 = parse_cpu_arch("AMD Ryzen 9 9950X 16-Core Processor").unwrap();
        assert_eq!(z5.architecture, "Zen 5"); // '9' => "Zen 5"
        assert_eq!(z5.generation, "9000 series");
    }

    #[test]
    fn amd_ryzen_zen1_zenplus() {
        let z1 = parse_cpu_arch("AMD Ryzen 7 1700 8-Core Processor").unwrap();
        assert_eq!(z1.architecture, "Zen"); // '1' => "Zen"
        let zp = parse_cpu_arch("AMD Ryzen 5 2600 6-Core Processor").unwrap();
        assert_eq!(zp.architecture, "Zen+"); // '2' => "Zen+"
    }

    #[test]
    fn amd_ryzen_mobile_arch_labels() {
        // The parser keys arch off the FIRST model digit alone (it does NOT inspect a U/H
        // suffix), so mobile labels come from a leading '4' / '6' / '8'. 4000-series mobile
        // (Renoir, e.g. 4800H) is Zen 2 — NOT Zen 3; keying '4' to Zen 3 was a bug.
        let m = parse_cpu_arch("AMD Ryzen 7 4800H with Radeon Graphics").unwrap();
        assert_eq!(m.architecture, "Zen 2 (mobile)"); // '4'
        let m8 = parse_cpu_arch("AMD Ryzen 7 8840U with Radeon Graphics").unwrap();
        assert_eq!(m8.architecture, "Zen 4 (mobile)"); // '8'
    }

    #[test]
    fn amd_ryzen_model_starting_zero_returns_none() {
        // first model digit '0' isn't in the match arm -> inner `return None`.
        assert!(parse_cpu_arch("AMD Ryzen 5 0600 6-Core").is_none());
    }

    #[test]
    fn amd_ryzen_threadripper_tier_word() {
        // tier is words[i+1] verbatim; for Threadripper the "model" is the next word.
        // "AMD Ryzen Threadripper 3990X" -> i+1="Threadripper", i+2="3990X" -> '3' => "Zen 2".
        let info = parse_cpu_arch("AMD Ryzen Threadripper 3990X 64-Core Processor").unwrap();
        assert_eq!(info.family_label, "Ryzen Threadripper 3990X");
        assert_eq!(info.architecture, "Zen 2");
    }

    #[test]
    fn amd_ryzen_without_two_following_words_is_none() {
        // "Ryzen" needs i+2 < len (two words after it). Just "AMD Ryzen 7" has none.
        assert!(parse_cpu_arch("AMD Ryzen 7").is_none());
    }

    // ───────────────────── parse_cpu_arch (Intel "Nth Gen") ─────────────────

    #[test]
    fn intel_nth_gen_prefix() {
        let info = parse_cpu_arch("13th Gen Intel(R) Core(TM) i7-13700K").expect("parsed");
        assert_eq!(info.vendor, "Intel");
        assert_eq!(info.architecture, "Raptor Lake");
        assert_eq!(info.generation, "13th Gen");
        assert_eq!(info.family_label, "Core i7-13700K");
    }

    #[test]
    fn intel_nth_gen_12th_alder_lake() {
        let info = parse_cpu_arch("12th Gen Intel(R) Core(TM) i9-12900K").unwrap();
        assert_eq!(info.architecture, "Alder Lake");
        assert_eq!(info.generation, "12th Gen");
        assert_eq!(info.family_label, "Core i9-12900K");
    }

    // ──────────────── parse_cpu_arch (Intel inferred from model) ────────────

    #[test]
    fn intel_inferred_9th_gen_from_model() {
        // "i7-9700K" -> 4-digit model "9700" -> leading '9' => 9th gen Coffee Lake Refresh.
        let info =
            parse_cpu_arch("Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz").expect("parsed");
        assert_eq!(info.vendor, "Intel");
        assert_eq!(info.architecture, "Coffee Lake Refresh");
        assert_eq!(info.generation, "9th Gen");
        assert_eq!(info.family_label, "Core i7-9700K");
    }

    #[test]
    fn intel_inferred_10th_gen_five_digit_model() {
        // 5-digit "10900" -> first two digits "10" => 10th gen.
        let info = parse_cpu_arch("Intel(R) Core(TM) i9-10900K CPU @ 3.70GHz").unwrap();
        assert_eq!(info.generation, "10th Gen");
        assert_eq!(info.architecture, "Comet Lake / Ice Lake");
    }

    #[test]
    fn intel_inferred_ultra_3digit_maps_to_15th() {
        // FINDING: the 3-digit Ultra heuristic maps leading '2' (e.g. "285K") to 15th gen.
        let info = parse_cpu_arch("Intel(R) Core(TM) i9-285K").unwrap();
        assert_eq!(info.generation, "15th Gen");
        assert_eq!(info.architecture, "Arrow Lake");
    }

    #[test]
    fn intel_inferred_6th_gen_lower_bound() {
        let info = parse_cpu_arch("Intel(R) Core(TM) i5-6600K CPU @ 3.50GHz").unwrap();
        assert_eq!(info.generation, "6th Gen");
        assert_eq!(info.architecture, "Skylake");
    }

    #[test]
    fn intel_inferred_out_of_range_gen_returns_none() {
        // "i3-5005U" -> leading '5' => gen 5, not in (6..=15) -> None.
        assert!(parse_cpu_arch("Intel(R) Core(TM) i3-5005U CPU @ 2.00GHz").is_none());
    }

    #[test]
    fn intel_xeon_inferred_path() {
        // Xeon also goes down the inferred branch (lower.contains("xeon")).
        // "E5-2680" -> 4-digit "2680" -> leading '2' => gen 2, out of (6..=15) -> None.
        // FINDING: classic Xeon SKUs whose leading model digit is <6 yield None.
        assert!(parse_cpu_arch("Intel(R) Xeon(R) CPU E5-2680 v4 @ 2.40GHz").is_none());
    }

    #[test]
    fn unrecognized_brand_returns_none() {
        assert!(parse_cpu_arch("Some Generic CPU 9000").is_none());
        assert!(parse_cpu_arch("").is_none());
        assert!(parse_cpu_arch("Apple M2").is_none());
    }

    // ───────────────────────── intel_arch_for_gen ──────────────────────────

    #[test]
    fn intel_arch_for_gen_known_table() {
        assert_eq!(intel_arch_for_gen(15), ("Arrow Lake", "15th Gen".to_string()));
        assert_eq!(
            intel_arch_for_gen(14),
            ("Raptor Lake Refresh", "14th Gen".to_string())
        );
        assert_eq!(intel_arch_for_gen(13), ("Raptor Lake", "13th Gen".to_string()));
        assert_eq!(intel_arch_for_gen(12), ("Alder Lake", "12th Gen".to_string()));
        assert_eq!(
            intel_arch_for_gen(11),
            ("Rocket Lake / Tiger Lake", "11th Gen".to_string())
        );
        assert_eq!(
            intel_arch_for_gen(10),
            ("Comet Lake / Ice Lake", "10th Gen".to_string())
        );
        assert_eq!(
            intel_arch_for_gen(9),
            ("Coffee Lake Refresh", "9th Gen".to_string())
        );
        assert_eq!(intel_arch_for_gen(8), ("Coffee Lake", "8th Gen".to_string()));
        assert_eq!(intel_arch_for_gen(7), ("Kaby Lake", "7th Gen".to_string()));
        assert_eq!(intel_arch_for_gen(6), ("Skylake", "6th Gen".to_string()));
    }

    #[test]
    fn intel_arch_for_gen_ordinal_suffixes() {
        // The ordinal-suffix arithmetic: 1/2/3 are st/nd/rd, 11/12/13 are th.
        assert_eq!(intel_arch_for_gen(1).1, "1st Gen");
        assert_eq!(intel_arch_for_gen(2).1, "2nd Gen");
        assert_eq!(intel_arch_for_gen(3).1, "3rd Gen");
        assert_eq!(intel_arch_for_gen(4).1, "4th Gen");
        assert_eq!(intel_arch_for_gen(11).1, "11th Gen");
        assert_eq!(intel_arch_for_gen(12).1, "12th Gen");
        assert_eq!(intel_arch_for_gen(13).1, "13th Gen");
        assert_eq!(intel_arch_for_gen(21).1, "21st Gen");
        assert_eq!(intel_arch_for_gen(22).1, "22nd Gen");
        assert_eq!(intel_arch_for_gen(23).1, "23rd Gen");
    }

    #[test]
    fn intel_arch_for_gen_unknown_gen() {
        assert_eq!(intel_arch_for_gen(99).0, "Unknown");
        assert_eq!(intel_arch_for_gen(0).0, "Unknown");
        assert_eq!(intel_arch_for_gen(0).1, "0th Gen");
    }

    // ───────────────────────── intel_family_label ──────────────────────────

    #[test]
    fn intel_family_label_strips_decoration_and_clock() {
        assert_eq!(
            intel_family_label("13th Gen Intel(R) Core(TM) i7-13700K"),
            "Core i7-13700K"
        );
        assert_eq!(
            intel_family_label("Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz"),
            "Core i7-9700K"
        );
    }

    #[test]
    fn intel_family_label_collapses_whitespace_and_drops_processor() {
        // "Processor" is stripped; runs of whitespace collapse to single spaces.
        assert_eq!(
            intel_family_label("Intel(R) Core(TM) i5-12400  Processor"),
            "Core i5-12400"
        );
    }

    #[test]
    fn intel_family_label_handles_plain_and_empty() {
        // No decoration to strip — just trims/collapses.
        assert_eq!(intel_family_label("Core i9-14900KS"), "Core i9-14900KS");
        assert_eq!(intel_family_label(""), "");
        assert_eq!(intel_family_label("Intel CPU @ 3.0GHz"), "");
    }

    // ───────────────────────── parse_smbios_strings ─────────────────────────

    #[test]
    fn smbios_strings_basic_two_strings() {
        // "Corsair\0Vengeance\0\0" -> two strings, stops at the double-null.
        let data = b"Corsair\0Vengeance\0\0trailing";
        let strings = parse_smbios_strings(data);
        assert_eq!(strings, vec!["Corsair".to_string(), "Vengeance".to_string()]);
    }

    #[test]
    fn smbios_strings_empty_and_immediate_null() {
        assert!(parse_smbios_strings(&[]).is_empty());
        // First byte is null (empty current) -> immediate break, no strings.
        assert!(parse_smbios_strings(&[0u8]).is_empty());
        assert!(parse_smbios_strings(&[0u8, 0u8]).is_empty());
    }

    #[test]
    fn smbios_strings_unterminated_tail_dropped() {
        // FINDING: a trailing string with NO null terminator is NOT emitted —
        // only null-terminated runs are pushed.
        let strings = parse_smbios_strings(b"G.Skill\0NoTerminator");
        assert_eq!(strings, vec!["G.Skill".to_string()]);
    }

    #[test]
    fn smbios_strings_lossy_utf8_does_not_panic() {
        // Invalid UTF-8 bytes are handled via from_utf8_lossy (replacement char).
        let data = [0xFF, 0xFE, 0x00, 0x00];
        let strings = parse_smbios_strings(&data);
        assert_eq!(strings.len(), 1);
        assert!(strings[0].contains('\u{FFFD}'));
    }

    // ─────────────────── parse_smbios_memory_devices ───────────────────────
    //
    // SMBIOS type-17 (Memory Device) formatted-area offsets the parser reads:
    //   0x00 type (=17)      0x01 length (formatted-area len)
    //   0x0C-0x0D size (u16) 0x12 memory type   0x15-0x16 peak speed (u16)
    //   0x17 manufacturer string-index  0x1A part-number string-index
    //   0x1C-0x1F extended size (u32, used when size==0x7FFF)
    //   0x20-0x21 configured speed (u16)
    // After the formatted area comes the strings section, double-null terminated.

    /// Build a type-17 formatted area of `len` bytes (len drives which fields the
    /// parser will read), then append a strings section + double-null.
    #[allow(clippy::too_many_arguments)]
    fn type17(
        len: u8,
        size_raw: u16,
        mem_type: u8,
        peak_speed: u16,
        configured_speed: u16,
        ext_size: u32,
        mfg_idx: u8,
        part_idx: u8,
        strings: &[&str],
    ) -> Vec<u8> {
        let mut f = vec![0u8; len as usize];
        f[0] = 17;
        f[1] = len;
        // handle (0x02-0x03) and phys-array handle left zero — parser ignores them.
        let set16 = |f: &mut Vec<u8>, at: usize, v: u16| {
            if at + 1 < f.len() {
                let b = v.to_le_bytes();
                f[at] = b[0];
                f[at + 1] = b[1];
            }
        };
        let set32 = |f: &mut Vec<u8>, at: usize, v: u32| {
            if at + 3 < f.len() {
                let b = v.to_le_bytes();
                f[at..at + 4].copy_from_slice(&b);
            }
        };
        set16(&mut f, 0x0C, size_raw);
        if 0x12 < f.len() {
            f[0x12] = mem_type;
        }
        set16(&mut f, 0x15, peak_speed);
        if 0x17 < f.len() {
            f[0x17] = mfg_idx;
        }
        if 0x1A < f.len() {
            f[0x1A] = part_idx;
        }
        set32(&mut f, 0x1C, ext_size);
        set16(&mut f, 0x20, configured_speed);

        // Strings section: each string null-terminated; double-null at the end.
        let mut s: Vec<u8> = Vec::new();
        for st in strings {
            s.extend_from_slice(st.as_bytes());
            s.push(0);
        }
        if strings.is_empty() {
            // A device with no strings still ends with the double-null.
            s.push(0);
        }
        s.push(0); // terminating null for the section

        f.extend_from_slice(&s);
        f
    }

    /// End-of-table marker (type 127), 4-byte formatted area + double-null.
    fn type127() -> Vec<u8> {
        vec![127, 4, 0, 0, 0, 0]
    }

    #[test]
    fn smbios_mem_single_ddr5_module_full_fields() {
        // 4 GB-ish: size_raw 0x4000 (16384) MB? No — keep it small: 0x0008 = 8 MB
        // to exercise the plain-MB path without huge numbers. Use 8192 MB = 0x2000.
        let dev = type17(
            0x22,   // length big enough for configured speed (0x20-0x21)
            0x2000, // 8192 -> MB path -> 8192 MB
            0x22,   // DDR5
            5600,   // peak speed
            6000,   // configured speed (preferred)
            0,
            1, // manufacturer = string #1
            2, // part = string #2
            &["Corsair", "CMK32"],
        );
        let mods = parse_smbios_memory_devices(&dev);
        assert_eq!(mods.len(), 1);
        let m = &mods[0];
        assert_eq!(m.capacity_bytes, 8192u64 * 1024 * 1024);
        assert_eq!(m.type_name, "DDR5");
        assert_eq!(m.speed_mhz, 6000); // configured preferred over peak
        assert_eq!(m.manufacturer, "Corsair CMK32");
        assert_eq!((&m.bank_channel, &m.slot_channel), (&None, &None), "no locators -> no claim");
    }

    #[test]
    fn smbios_mem_channel_read_from_bank_or_device_locator() {
        // Bank locator (0x11) names the channel (AMD boards).
        let mut amd = type17(0x22, 0x2000, 0x22, 5600, 6000, 0, 0, 0, &["DIMMA2", "P0 CHANNEL A"]);
        amd[0x10] = 1;
        amd[0x11] = 2;
        // Only the device locator (0x10) names it (Intel: bank reads "BANK 0").
        let mut intel =
            type17(0x22, 0x2000, 0x22, 5600, 6000, 0, 0, 0, &["Controller0-ChannelB-DIMM0", "BANK 0"]);
        intel[0x10] = 1;
        intel[0x11] = 2;
        // Neither label names a channel.
        let mut plain = type17(0x22, 0x2000, 0x22, 5600, 6000, 0, 0, 0, &["DIMM 1", "BANK 1"]);
        plain[0x10] = 1;
        plain[0x11] = 2;
        let data = [amd, intel, plain, type127()].concat();
        let mods = parse_smbios_memory_devices(&data);
        assert_eq!(mods.len(), 3);
        assert_eq!(mods[0].bank_channel.as_deref(), Some("P0 CHANNEL A"));
        assert_eq!(mods[0].slot_channel, None);
        assert_eq!(mods[1].bank_channel, None);
        assert_eq!(mods[1].slot_channel.as_deref(), Some("CONTROLLER0 CHANNEL B"));
        assert_eq!((&mods[2].bank_channel, &mods[2].slot_channel), (&None, &None));
    }

    #[test]
    fn memory_channel_label_only_claims_a_named_channel() {
        let ch = memory_channel_from_label;
        assert_eq!(ch("P0 CHANNEL A").as_deref(), Some("P0 CHANNEL A"));
        assert_eq!(ch("ChannelA-DIMM0").as_deref(), Some("CHANNEL A"));
        assert_eq!(ch("CHANNEL 1").as_deref(), Some("CHANNEL 1"));
        // Two controllers' "Channel A" are different channels; two slots on one channel are one.
        assert_ne!(ch("Controller0-ChannelA-DIMM0"), ch("Controller1-ChannelA-DIMM0"));
        assert_eq!(ch("Controller0-ChannelA-DIMM0"), ch("Controller0-ChannelA-DIMM1"));
        // Review r1: an id glued to the slot name is ambiguous, never two channels.
        assert_eq!(ch("ChannelADIMM0"), None);
        assert_eq!(ch("Channel0DIMM1"), None);
        // Slot letters, bank numbers and empty labels never become a channel.
        assert_eq!(ch("BANK 0"), None);
        assert_eq!(ch("DIMM A1"), None);
        assert_eq!(ch(""), None);
        assert_eq!(ch("Channel-"), None);
    }

    #[test]
    fn named_channel_count_needs_one_label_kind_for_every_module() {
        let m = |bank: Option<&str>, slot: Option<&str>| MemoryModuleInfo {
            bank_channel: bank.map(String::from),
            slot_channel: slot.map(String::from),
            ..Default::default()
        };
        let a_bank = Some("P0 CHANNEL A");
        let b_bank = Some("P0 CHANNEL B");
        assert_eq!(named_memory_channel_count(&[m(a_bank, None), m(b_bank, None)]), Some(2));
        assert_eq!(named_memory_channel_count(&[m(a_bank, None), m(a_bank, None)]), Some(1));
        assert_eq!(
            named_memory_channel_count(&[m(None, Some("CHANNEL A")), m(None, Some("CHANNEL B"))]),
            Some(2)
        );
        // Review r1: one module named by its bank, the other by its slot -> unknown, not 2.
        assert_eq!(named_memory_channel_count(&[m(a_bank, None), m(None, Some("CHANNEL A"))]), None);
        assert_eq!(named_memory_channel_count(&[m(a_bank, None), m(None, None)]), None);
        assert_eq!(named_memory_channel_count(&[]), None);
    }

    #[test]
    fn smbios_mem_peak_speed_used_when_no_configured() {
        // configured_speed = 0 -> falls back to peak.
        let dev = type17(0x22, 0x2000, 0x1A, 3200, 0, 0, 1, 0, &["Kingston"]);
        let mods = parse_smbios_memory_devices(&dev);
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].type_name, "DDR4");
        assert_eq!(mods[0].speed_mhz, 3200);
        // part index 0 -> empty; only manufacturer present.
        assert_eq!(mods[0].manufacturer, "Kingston");
    }

    #[test]
    fn smbios_mem_kb_granularity_bit15() {
        // bit 15 set => low 15 bits are KB. 0x8400 -> 0x400 = 1024 KB.
        let dev = type17(0x22, 0x8400, 0x1A, 3200, 0, 0, 1, 0, &["X"]);
        let mods = parse_smbios_memory_devices(&dev);
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].capacity_bytes, 1024u64 * 1024);
    }

    #[test]
    fn mem_speed_status_is_honest() {
        assert_eq!(mem_speed_status(6000, 4800), "running_below_rated");
        assert_eq!(mem_speed_status(6000, 6000), "running_at_rated");
        assert_eq!(mem_speed_status(6000, 0), "unknown");
        assert_eq!(mem_speed_status(0, 6000), "unknown");
        // configured can't honestly exceed max-capable; a quirk that reports it still isn't "below".
        assert_eq!(mem_speed_status(5600, 6000), "running_at_rated");
    }

    #[test]
    fn smbios_mem_below_rated_flags_xmp_off() {
        // EXPO/XMP off: configured (4800 JEDEC) below max-capable (6000) → actionable signal.
        let dev = type17(0x22, 0x2000, 0x22, 6000, 4800, 0, 1, 0, &["G.Skill"]);
        let m = &parse_smbios_memory_devices(&dev)[0];
        assert_eq!(m.speed_mhz, 4800);
        assert_eq!(m.rated_speed_mhz, 6000);
        assert_eq!(m.xmp_expo_status, "running_below_rated");
    }

    #[test]
    fn smbios_mem_at_rated_makes_no_profile_claim() {
        // EXPO on OR a JEDEC kit at native speed — indistinguishable, so we never claim "active".
        let dev = type17(0x22, 0x2000, 0x22, 6000, 6000, 0, 1, 0, &["G.Skill"]);
        let m = &parse_smbios_memory_devices(&dev)[0];
        assert_eq!(m.rated_speed_mhz, 6000);
        assert_eq!(m.xmp_expo_status, "running_at_rated");
    }

    #[test]
    fn smbios_mem_status_unknown_without_configured() {
        // Configured-speed field zero (pre-2.7 SMBIOS or unset) → we don't guess.
        let dev = type17(0x22, 0x2000, 0x22, 3200, 0, 0, 1, 0, &["Kingston"]);
        assert_eq!(parse_smbios_memory_devices(&dev)[0].xmp_expo_status, "unknown");
    }

    #[test]
    fn smbios_mem_extended_size_path() {
        // size_raw == 0x7FFF and len >= 0x20 -> read extended size (in MB) at 0x1C.
        let dev = type17(0x22, 0x7FFF, 0x22, 6000, 6000, 32768, 1, 0, &["Mfg"]);
        let mods = parse_smbios_memory_devices(&dev);
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].capacity_bytes, 32768u64 * 1024 * 1024);
    }

    #[test]
    fn smbios_mem_empty_and_unknown_slots_skipped() {
        // size_raw 0x0000 (empty) and 0xFFFF (unknown) -> capacity 0 -> skipped.
        let empty = type17(0x22, 0x0000, 0x22, 6000, 6000, 0, 1, 0, &["Mfg"]);
        let unknown = type17(0x22, 0xFFFF, 0x22, 6000, 6000, 0, 1, 0, &["Mfg"]);
        assert!(parse_smbios_memory_devices(&empty).is_empty());
        assert!(parse_smbios_memory_devices(&unknown).is_empty());
    }

    #[test]
    fn smbios_mem_placeholder_strings_filtered() {
        // "Unknown" / "Not Specified" / "0x..." / "Array..." are treated as unset.
        let dev = type17(
            0x22,
            0x2000,
            0x22,
            6000,
            6000,
            0,
            1, // mfg = "Unknown"
            2, // part = "Not Specified"
            &["Unknown", "Not Specified"],
        );
        let mods = parse_smbios_memory_devices(&dev);
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].manufacturer, ""); // both placeholders -> empty
    }

    #[test]
    fn smbios_mem_part_only_when_mfg_placeholder() {
        let dev = type17(
            0x22, 0x2000, 0x22, 6000, 6000, 0, 1, // mfg index -> "Unknown" (placeholder)
            2, // part index -> "CMK32GX" (real)
            &["Unknown", "CMK32GX"],
        );
        let mods = parse_smbios_memory_devices(&dev);
        assert_eq!(mods[0].manufacturer, "CMK32GX");
    }

    #[test]
    fn smbios_mem_unknown_type_label() {
        // mem_type byte not in the table -> "Unknown".
        let dev = type17(0x22, 0x2000, 0x99, 3200, 0, 0, 1, 0, &["Mfg"]);
        let mods = parse_smbios_memory_devices(&dev);
        assert_eq!(mods[0].type_name, "Unknown");
    }

    #[test]
    fn smbios_mem_two_modules_in_sequence() {
        let mut data = type17(0x22, 0x2000, 0x22, 6000, 6000, 0, 1, 0, &["A"]);
        data.extend(type17(0x22, 0x2000, 0x1A, 3200, 0, 0, 1, 0, &["B"]));
        let mods = parse_smbios_memory_devices(&data);
        assert_eq!(mods.len(), 2);
        assert_eq!(mods[0].type_name, "DDR5");
        assert_eq!(mods[0].manufacturer, "A");
        assert_eq!(mods[1].type_name, "DDR4");
        assert_eq!(mods[1].manufacturer, "B");
    }

    #[test]
    fn smbios_mem_stops_at_end_of_table_marker() {
        // A type-127 marker before a real device stops the walk -> no modules.
        let mut data = type127();
        data.extend(type17(0x22, 0x2000, 0x22, 6000, 6000, 0, 1, 0, &["A"]));
        assert!(parse_smbios_memory_devices(&data).is_empty());
    }

    #[test]
    fn smbios_mem_non17_struct_skipped_then_17_parsed() {
        // A non-memory struct (type 4 = processor) is walked past, then a type-17 read.
        let mut other = vec![4u8, 6, 0, 0, 0, 0]; // type 4, len 6, formatted
        other.push(0); // strings section: double null
        other.push(0);
        let mut data = other;
        data.extend(type17(0x22, 0x2000, 0x22, 6000, 6000, 0, 1, 0, &["A"]));
        let mods = parse_smbios_memory_devices(&data);
        assert_eq!(mods.len(), 1);
        assert_eq!(mods[0].manufacturer, "A");
    }

    // ── Graceful-degradation / malformed-buffer cases (no panic) ────────────

    #[test]
    fn smbios_mem_empty_buffer() {
        assert!(parse_smbios_memory_devices(&[]).is_empty());
    }

    #[test]
    fn smbios_mem_short_buffer_no_panic() {
        // Fewer than 4 bytes -> loop condition false immediately.
        assert!(parse_smbios_memory_devices(&[17]).is_empty());
        assert!(parse_smbios_memory_devices(&[17, 0x22, 0]).is_empty());
    }

    #[test]
    fn smbios_mem_struct_len_below_4_breaks() {
        // struct_len < 4 -> break (no panic, empty result).
        let data = [17u8, 2, 0, 0];
        assert!(parse_smbios_memory_devices(&data).is_empty());
    }

    #[test]
    fn smbios_mem_formatted_end_past_buffer_breaks() {
        // struct_len claims 0x22 bytes but buffer is short -> formatted_end > len -> break.
        let data = [17u8, 0x22, 0, 0, 0, 0];
        assert!(parse_smbios_memory_devices(&data).is_empty());
    }

    #[test]
    fn smbios_mem_type17_too_short_for_layout_skipped() {
        // type 17 but struct_len < 0x18 -> not parsed as a memory device (no panic).
        // len = 8, enough bytes present, but below the 0x18 minimum.
        let mut data = vec![17u8, 8, 0, 0, 0, 0, 0, 0];
        data.push(0); // strings double-null
        data.push(0);
        assert!(parse_smbios_memory_devices(&data).is_empty());
    }

    #[test]
    fn smbios_mem_garbage_does_not_panic() {
        // Random-ish bytes: must terminate without panicking. Result may be empty.
        let garbage: Vec<u8> = (0u8..=255).cycle().take(300).collect();
        let _ = parse_smbios_memory_devices(&garbage);
        // Truncated mid-struct.
        let _ = parse_smbios_memory_devices(&[17, 0x40, 1, 2, 3]);
        // All zeros.
        let _ = parse_smbios_memory_devices(&[0u8; 64]);
    }
}
