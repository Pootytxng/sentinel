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

#[derive(Serialize)]
struct Recommendation {
    id: &'static str,
    title: &'static str,
    category: &'static str,
    severity: &'static str,
    description: &'static str,
    impact: &'static str,
    downside: Option<&'static str>,
    applies_to: String,
    currently_applied: bool,
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

    let active_plan = current_power_plan_name().unwrap_or_default();
    let on_ultimate = active_plan.to_lowercase().contains("ultimate");

    // ─── Universal Windows tweaks ────────────────────────────────────────
    recs.push(Recommendation {
        id: "power-ultimate",
        title: "Switch to the Ultimate Performance power plan",
        category: "Power",
        severity: "safe",
        description:
            "Windows ships with a hidden 'Ultimate Performance' power plan that keeps your CPU at peak responsiveness instead of letting it nap between workloads. Better for gaming, slightly higher idle power draw.",
        impact: "Lower input latency · steadier frame times",
        downside: Some("Marginally higher idle power use (~5–10 W on most desktops)."),
        applies_to: if active_plan.is_empty() {
            "Windows desktop".into()
        } else {
            format!("Currently on '{}'", active_plan)
        },
        currently_applied: on_ultimate,
    });

    recs.push(Recommendation {
        id: "game-mode",
        title: "Enable Windows Game Mode",
        category: "Windows",
        severity: "safe",
        description:
            "Game Mode tells Windows to prioritize the foreground game, deprioritize background updates, and pause Windows Update reboots while you're playing.",
        impact: "Fewer background-process stutters",
        downside: None,
        applies_to: format!("{} {}", hw.os_name, hw.os_version),
        currently_applied: game_mode_enabled(),
    });

    // startup-debloat rec was replaced by the dedicated "Startup apps" UI
    // section, which lets the user toggle individual entries directly.

    recs.push(Recommendation {
        id: "visual-effects",
        title: "Trim Windows visual effects",
        category: "Windows",
        severity: "safe",
        description:
            "Animations, transparency, and shadow effects look nice but cost a few percent of GPU and CPU. Setting the 'best performance' preset turns most off; some apply immediately, the rest on your next sign-in.",
        impact: "Snappier UI · slightly higher in-game FPS",
        downside: Some("UI looks more utilitarian — no fade animations."),
        applies_to: "Any Windows version".into(),
        currently_applied: visual_effects_for_best_performance(),
    });

    recs.push(Recommendation {
        id: "mouse-accel-off",
        title: "Disable mouse acceleration ('Enhance pointer precision')",
        category: "Windows",
        severity: "safe",
        description:
            "Windows applies a non-linear acceleration curve to mouse movement by default — the same physical motion produces different cursor distances depending on how fast you move. Off = 1:1 movement, which is what every competitive shooter expects and what aim-training builds muscle memory around.",
        impact: "Consistent aim · predictable flicks · removes a hidden variable",
        downside: Some(
            "If you've gotten used to acceleration for desktop use, the cursor will feel slower at first — you may want to bump DPI / sensitivity to compensate.",
        ),
        applies_to: "Affects all mouse input system-wide".into(),
        currently_applied: mouse_accel_disabled(),
    });

    recs.push(Recommendation {
        id: "game-bar-disable",
        title: "Disable Game Bar and Game DVR",
        category: "Windows",
        severity: "safe",
        description:
            "Game Bar's background capture and Game DVR (Windows' built-in recording layer) add CPU and disk overhead in every running game whether you use them or not. Most users have third-party capture (OBS, ShadowPlay, AMD ReLive) and never touch Windows' version. Turning it off frees up resources.",
        impact: "Lower background overhead in every game",
        downside: Some("You'll lose the Win+G overlay and Windows' built-in clip recording."),
        applies_to: "Affects all games".into(),
        currently_applied: game_bar_disabled(),
    });

    recs.push(Recommendation {
        id: "diagtrack-disable",
        title: "Disable Windows telemetry (DiagTrack)",
        category: "Windows",
        severity: "moderate",
        description:
            "DiagTrack ('Connected User Experiences and Telemetry') runs in the background sending usage and diagnostic data to Microsoft. Disabling it has no functional impact on day-to-day use but does mean some of the data Windows uses to detect crashes and roll back broken updates won't be sent.",
        impact: "Less background network traffic · less idle CPU · privacy",
        downside: Some(
            "Windows feedback submissions and automatic update-rollback diagnostics rely on this service. Most users never notice.",
        ),
        applies_to: "All Windows installs".into(),
        currently_applied: !service_running("DiagTrack"),
    });

    // ─── GPU vendor-specific ─────────────────────────────────────────────
    if let Some(name) = gpu_vendor_match(hw, "NVIDIA") {
        let telemetry_running = service_running("NvTelemetryContainer");
        recs.push(Recommendation {
            id: "nvidia-telemetry",
            title: "Disable NVIDIA Container telemetry services",
            category: "GPU",
            severity: "safe",
            description:
                "NVIDIA's driver bundle ships several background services that exist mainly to send usage data and check for GeForce Experience updates. They consume RAM and CPU constantly. Disabling them does not affect game performance or driver functionality.",
            impact: "Free ~150–250 MB RAM · less background CPU",
            downside: Some("GeForce Experience won't auto-update; you can still update manually."),
            applies_to: name.clone(),
            currently_applied: !telemetry_running,
        });

        recs.push(Recommendation {
            id: "nvidia-low-latency",
            title: "Set NVIDIA 'Low Latency Mode' to Ultra (per-game)",
            category: "GPU",
            severity: "safe",
            description:
                "Forces the driver to pre-render fewer frames, which shaves a frame or two of input latency. Ideal for competitive shooters; less useful for slower-paced games.",
            impact: "Lower input lag in fast-paced games",
            downside: Some("Can slightly reduce maximum FPS in GPU-bound titles."),
            applies_to: "NVIDIA GPU + latency profile".into(),
            currently_applied: false,
        });
    }

    if let Some(name) = gpu_vendor_match(hw, "AMD").or_else(|| gpu_vendor_match(hw, "RADEON")) {
        recs.push(Recommendation {
            id: "amd-uxp",
            title: "Opt out of the AMD User Experience Program",
            category: "GPU",
            severity: "safe",
            description:
                "AMD's Adrenalin software opts you in by default to a telemetry program that sends usage data. Turning it off has no performance impact.",
            impact: "Less background network traffic · privacy",
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
            id: "gpu-prefer-discrete",
            title: "Force games to use your discrete GPU",
            category: "GPU",
            severity: "safe",
            description:
                "Your PC has both an Intel iGPU and a discrete GPU. Windows sometimes routes games to the iGPU by mistake, tanking performance. Pin individual games to the discrete card in Settings → Display → Graphics.",
            impact: "Massive FPS gain if a game is mis-routed",
            downside: Some("Slightly higher battery drain on laptops."),
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
                id: "storage-c-low",
                title: "Free up space on C:",
                category: "Storage",
                severity: "safe",
                description:
                    "Your system drive is nearly full. Below ~15% free, Windows starts to thrash, paging gets sluggish, and updates can fail. Disk Cleanup + uninstalling unused games is the easiest win.",
                impact: "Restores normal disk performance · prevents update failures",
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
            id: "sysmain-disable",
            title: "Disable SysMain (Superfetch)",
            category: "Windows",
            severity: "moderate",
            description:
                "SysMain preloads frequently-used apps into RAM to make them launch faster. With 16 GB+ of RAM and fast storage this benefit is small, and on NVMe systems SysMain often causes mysterious disk thrashing instead.",
            impact: "Lower idle disk activity · ~100–200 MB RAM back",
            downside: Some("App launches will be a tiny bit slower (usually unnoticeable on fast storage)."),
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
                id: "hags-enable",
                title: "Enable Hardware-accelerated GPU Scheduling",
                category: "GPU",
                severity: "safe",
                description:
                    "Lets the GPU manage its own memory and command queue directly instead of routing through the Windows display driver. On supported hardware this reduces input latency and frees up CPU cycles, especially in modern games. Requires a reboot to take effect.",
                impact: "Lower input latency · CPU cycles freed up for game logic",
                downside: Some(
                    "Reboot required. Very occasionally a specific driver/game combo regresses with HAGS on — easy to roll back if it doesn't feel right.",
                ),
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
                id: "monitor-max-refresh",
                title: "Bump your display to its maximum refresh rate",
                category: "Display",
                severity: "safe",
                description:
                    "Your display supports a much higher refresh rate than it's currently running at. Higher refresh = noticeably smoother motion and lower input lag, at zero hardware cost. Change in Settings → System → Display → Advanced display → Choose a refresh rate.",
                impact: "Smoother motion · lower input lag · feels dramatically faster",
                downside: Some("Slightly higher idle power draw."),
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
                id: "gpu-driver-update",
                title: "Update your graphics driver",
                category: "GPU",
                severity: "safe",
                description:
                    "Your installed graphics driver is several months old. Driver updates routinely include game-specific performance improvements, bug fixes for newly-released titles, and security patches. Update through GeForce Experience / NVIDIA App, AMD Adrenalin, or Intel Graphics Command Center.",
                impact: "Better game performance · fewer crashes · latest features (DLSS, FSR, frame-gen)",
                downside: Some(
                    "New drivers occasionally introduce regressions — keep the previous installer in case you need to roll back.",
                ),
                applies_to: format!("{} driver is ~{} months old", vendor, months),
                currently_applied: false,
            });
        }
    }

    // HDD-only advisory: the single biggest performance win is hardware, not a tweak.
    if only_hdd {
        recs.push(Recommendation {
            id: "ssd-upgrade-advisory",
            title: "Upgrade your system drive to an SSD",
            category: "Storage",
            severity: "moderate",
            description:
                "Every physical drive Sentinel detected is a spinning hard drive. Windows on an HDD is the single biggest performance handicap on a modern PC — game load times, app launches, and Windows itself will be dramatically faster on an SSD or NVMe drive. Typical cost: $40–100 for 500 GB.",
            impact: "Multi-second → sub-second boot · 5–10× faster app launches",
            downside: Some("Requires a hardware purchase and either a Windows reinstall or a drive clone."),
            applies_to: "Spinning HDDs only — no SSDs detected".into(),
            currently_applied: false,
        });
    }

    // ─── Network ─────────────────────────────────────────────────────────
    recs.push(Recommendation {
        id: "nagle-disable",
        title: "Disable Nagle's Algorithm on your gaming NIC",
        category: "Network",
        severity: "moderate",
        description:
            "Nagle's Algorithm batches small TCP packets together to save bandwidth — at the cost of a few extra ms of latency. For competitive online games, turning it off can drop ping by 5–15 ms.",
        impact: "Lower latency in competitive online games",
        downside: Some("Marginally more network overhead; harmless on modern connections."),
        applies_to: "Active network adapter".into(),
        currently_applied: nagle_disabled_on_any_nic(),
    });

    recs
}

#[tauri::command]
fn get_recommendations() -> Vec<Recommendation> {
    let hw = collect_hardware();
    build_recommendations(&hw)
}

// ─── Apply / Rollback ────────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
struct AppliedChange {
    id: String,
    rec_id: String,
    rec_title: String,
    applied_at: String,
    snapshot: serde_json::Value,
    status: String, // "applied" | "rolled_back"
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

fn apply_game_mode() -> Result<serde_json::Value, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey("Software\\Microsoft\\GameBar")
        .map_err(|e| e.to_string())?;
    let prior: Option<u32> = key.get_value("AutoGameModeEnabled").ok();
    key.set_value("AutoGameModeEnabled", &1u32)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "key": "AutoGameModeEnabled", "prior": prior }))
}

fn rollback_game_mode(snapshot: &serde_json::Value) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags("Software\\Microsoft\\GameBar", KEY_SET_VALUE | KEY_READ)
        .map_err(|e| e.to_string())?;
    match snapshot.get("prior").and_then(|v| v.as_u64()) {
        Some(v) => key
            .set_value("AutoGameModeEnabled", &(v as u32))
            .map_err(|e| e.to_string())?,
        None => {
            let _ = key.delete_value("AutoGameModeEnabled");
        }
    }
    Ok(())
}

// Documented "Best Performance" value for HKCU\Control Panel\Desktop\UserPreferencesMask
const BEST_PERF_USER_PREFS_MASK: [u8; 8] = [0x90, 0x12, 0x03, 0x80, 0x10, 0x00, 0x00, 0x00];

fn apply_visual_effects() -> Result<serde_json::Value, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let (vfx_key, _) = hkcu
        .create_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects")
        .map_err(|e| e.to_string())?;
    let prior_vfx: Option<u32> = vfx_key.get_value("VisualFXSetting").ok();
    vfx_key
        .set_value("VisualFXSetting", &2u32)
        .map_err(|e| e.to_string())?;

    let (desktop_key, _) = hkcu
        .create_subkey("Control Panel\\Desktop")
        .map_err(|e| e.to_string())?;
    let prior_mask: Option<Vec<u8>> = desktop_key
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

    Ok(serde_json::json!({
        "vfx_setting_prior": prior_vfx,
        "user_prefs_mask_prior": prior_mask,
    }))
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
fn apply_service_disable(service_name: &str) -> Result<serde_json::Value, String> {
    let (prior_state, prior_start_mode) = service_info(service_name)
        .unwrap_or_else(|| ("Running".into(), "Auto".into()));
    let cmd = format!(
        "Set-Service -Name {0} -StartupType Disabled; Stop-Service -Name {0} -Force -ErrorAction SilentlyContinue",
        service_name
    );
    run_elevated_powershell(&cmd)?;
    Ok(serde_json::json!({
        "service": service_name,
        "prior_state": prior_state,
        "prior_start_mode": prior_start_mode,
    }))
}

fn rollback_service_disable(
    service_name: &str,
    snapshot: &serde_json::Value,
) -> Result<(), String> {
    let prior_start_mode = snapshot
        .get("prior_start_mode")
        .and_then(|v| v.as_str())
        .unwrap_or("Automatic");
    let prior_state = snapshot
        .get("prior_state")
        .and_then(|v| v.as_str())
        .unwrap_or("Running");
    let startup = ps_service_startup_for_mode(prior_start_mode);
    let mut cmd = format!(
        "Set-Service -Name {} -StartupType {}",
        service_name, startup
    );
    if prior_state == "Running" {
        cmd.push_str(&format!("; Start-Service -Name {}", service_name));
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

fn apply_power_ultimate() -> Result<serde_json::Value, String> {
    let prior_guid = current_power_plan_guid().unwrap_or_default();
    // Idempotent: reuse existing Ultimate Performance plan if it's already
    // duplicated; otherwise duplicate from the canonical hidden GUID first.
    // Either way, /setactive on the resulting GUID.
    let ps = "$ult = powercfg /list | Select-String 'Ultimate Performance' | Select-Object -First 1; \
              if ($ult -match 'GUID: ([0-9a-f-]{36})') { powercfg /setactive $matches[1]; exit 0 } \
              $dup = powercfg /duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 2>&1; \
              if ($dup -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') { powercfg /setactive $matches[1]; exit 0 } \
              exit 1";
    run_elevated_powershell(ps)?;
    Ok(serde_json::json!({
        "prior_plan_guid": prior_guid,
    }))
}

fn rollback_power_ultimate(snapshot: &serde_json::Value) -> Result<(), String> {
    let prior = snapshot
        .get("prior_plan_guid")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if prior.len() != 36 {
        return Err("no valid prior plan GUID in snapshot".into());
    }
    run_elevated_powershell(&format!("powercfg /setactive {}", prior))?;
    Ok(())
}

// ─── Game Bar / Game DVR off (HKCU, no admin) ────────────────────────────

fn apply_game_bar_disable() -> Result<serde_json::Value, String> {
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

    Ok(serde_json::json!({
        "prior_capture": prior_capture,
        "prior_enabled": prior_enabled,
    }))
}

fn rollback_game_bar_disable(snapshot: &serde_json::Value) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let gd = hkcu
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR",
            KEY_SET_VALUE | KEY_READ,
        )
        .map_err(|e| e.to_string())?;
    match snapshot.get("prior_capture").and_then(|v| v.as_u64()) {
        Some(v) => gd
            .set_value("AppCaptureEnabled", &(v as u32))
            .map_err(|e| e.to_string())?,
        None => {
            let _ = gd.delete_value("AppCaptureEnabled");
        }
    }

    let gcs = hkcu
        .open_subkey_with_flags("System\\GameConfigStore", KEY_SET_VALUE | KEY_READ)
        .map_err(|e| e.to_string())?;
    match snapshot.get("prior_enabled").and_then(|v| v.as_u64()) {
        Some(v) => gcs
            .set_value("GameDVR_Enabled", &(v as u32))
            .map_err(|e| e.to_string())?,
        None => {
            let _ = gcs.delete_value("GameDVR_Enabled");
        }
    }
    Ok(())
}

// ─── HAGS (HKLM, admin) ──────────────────────────────────────────────────

fn apply_hags_enable() -> Result<serde_json::Value, String> {
    let prior = hags_state();
    run_elevated_powershell(
        "Set-ItemProperty -Path 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers' -Name 'HwSchMode' -Value 2 -Type DWord",
    )?;
    Ok(serde_json::json!({
        "prior_hwschmode": prior,
    }))
}

fn rollback_hags_enable(snapshot: &serde_json::Value) -> Result<(), String> {
    let prior = snapshot.get("prior_hwschmode").and_then(|v| v.as_u64());
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

fn apply_mouse_accel_off() -> Result<serde_json::Value, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (key, _) = hkcu
        .create_subkey("Control Panel\\Mouse")
        .map_err(|e| e.to_string())?;

    // All three values are REG_SZ strings, not DWORDs. Windows is weird.
    let prior_speed: String = key.get_value("MouseSpeed").unwrap_or_default();
    let prior_t1: String = key.get_value("MouseThreshold1").unwrap_or_default();
    let prior_t2: String = key.get_value("MouseThreshold2").unwrap_or_default();

    let zero = "0".to_string();
    key.set_value("MouseSpeed", &zero).map_err(|e| e.to_string())?;
    key.set_value("MouseThreshold1", &zero).map_err(|e| e.to_string())?;
    key.set_value("MouseThreshold2", &zero).map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "prior_speed": prior_speed,
        "prior_threshold1": prior_t1,
        "prior_threshold2": prior_t2,
    }))
}

fn rollback_mouse_accel_off(snapshot: &serde_json::Value) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let key = hkcu
        .open_subkey_with_flags("Control Panel\\Mouse", KEY_SET_VALUE | KEY_READ)
        .map_err(|e| e.to_string())?;

    let restore = |reg_name: &str, snapshot_key: &str| -> Result<(), String> {
        let prior = snapshot
            .get(snapshot_key)
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if prior.is_empty() {
            let _ = key.delete_value(reg_name);
            Ok(())
        } else {
            key.set_value(reg_name, &prior.to_string())
                .map_err(|e| e.to_string())
        }
    };

    restore("MouseSpeed", "prior_speed")?;
    restore("MouseThreshold1", "prior_threshold1")?;
    restore("MouseThreshold2", "prior_threshold2")?;
    Ok(())
}

// ─── Nagle disable across active NICs ────────────────────────────────────

fn apply_nagle_disable() -> Result<serde_json::Value, String> {
    // Snapshot (no admin): walk every Tcpip interface, capture prior values
    // on adapters that have an actual IP. Skip loopback / virtual / inactive.
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let interfaces = hklm
        .open_subkey("SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces")
        .map_err(|e| e.to_string())?;
    let mut snapshots: Vec<serde_json::Value> = Vec::new();
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
        snapshots.push(serde_json::json!({
            "interface": adapter_name,
            "prior_ack": prior_ack,
            "prior_nodelay": prior_nodelay,
        }));
    }

    // Apply (admin): write TcpAckFrequency=1 + TCPNoDelay=1 on every NIC
    // with an IP. PowerShell handles enumeration + the Set-ItemProperty.
    let ps = "$ifs = Get-ChildItem 'HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces'; \
              foreach ($i in $ifs) { \
                $hasIp = (Get-ItemProperty -Path $i.PSPath -Name 'DhcpIPAddress' -ErrorAction SilentlyContinue) -or (Get-ItemProperty -Path $i.PSPath -Name 'IPAddress' -ErrorAction SilentlyContinue); \
                if ($hasIp) { \
                  Set-ItemProperty -Path $i.PSPath -Name 'TcpAckFrequency' -Value 1 -Type DWord; \
                  Set-ItemProperty -Path $i.PSPath -Name 'TCPNoDelay' -Value 1 -Type DWord; \
                } \
              }";
    run_elevated_powershell(ps)?;
    Ok(serde_json::json!({ "interfaces": snapshots }))
}

fn rollback_nagle_disable(snapshot: &serde_json::Value) -> Result<(), String> {
    let interfaces = snapshot
        .get("interfaces")
        .and_then(|v| v.as_array())
        .ok_or("missing 'interfaces' in snapshot")?;
    if interfaces.is_empty() {
        return Err("no interfaces recorded in snapshot".into());
    }
    let mut ps = String::new();
    for entry in interfaces {
        let iface = entry.get("interface").and_then(|v| v.as_str()).unwrap_or("");
        if iface.is_empty() {
            continue;
        }
        let path = format!(
            "HKLM:\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{}",
            iface
        );
        match entry.get("prior_ack").and_then(|v| v.as_u64()) {
            Some(v) => ps.push_str(&format!(
                "Set-ItemProperty -Path '{}' -Name 'TcpAckFrequency' -Value {} -Type DWord; ",
                path, v
            )),
            None => ps.push_str(&format!(
                "Remove-ItemProperty -Path '{}' -Name 'TcpAckFrequency' -ErrorAction SilentlyContinue; ",
                path
            )),
        }
        match entry.get("prior_nodelay").and_then(|v| v.as_u64()) {
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

fn rollback_visual_effects(snapshot: &serde_json::Value) -> Result<(), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);

    let vfx_key = hkcu
        .open_subkey_with_flags(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects",
            KEY_SET_VALUE | KEY_READ,
        )
        .map_err(|e| e.to_string())?;
    match snapshot.get("vfx_setting_prior").and_then(|v| v.as_u64()) {
        Some(v) => vfx_key
            .set_value("VisualFXSetting", &(v as u32))
            .map_err(|e| e.to_string())?,
        None => {
            let _ = vfx_key.delete_value("VisualFXSetting");
        }
    }

    let desktop_key = hkcu
        .open_subkey_with_flags("Control Panel\\Desktop", KEY_SET_VALUE | KEY_READ)
        .map_err(|e| e.to_string())?;
    match snapshot.get("user_prefs_mask_prior").and_then(|v| v.as_array()) {
        Some(arr) => {
            let bytes: Vec<u8> = arr
                .iter()
                .filter_map(|n| n.as_u64().map(|v| v as u8))
                .collect();
            desktop_key
                .set_raw_value(
                    "UserPreferencesMask",
                    &winreg::RegValue {
                        bytes,
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

#[tauri::command]
fn apply_recommendation(rec_id: String, rec_title: String) -> Result<AppliedChangeView, String> {
    let _lock = HISTORY_LOCK
        .lock()
        .map_err(|_| "history lock poisoned".to_string())?;
    let snapshot = match rec_id.as_str() {
        "game-mode" => apply_game_mode()?,
        "visual-effects" => apply_visual_effects()?,
        "sysmain-disable" => apply_service_disable("SysMain")?,
        "nvidia-telemetry" => apply_service_disable("NvTelemetryContainer")?,
        "power-ultimate" => apply_power_ultimate()?,
        "nagle-disable" => apply_nagle_disable()?,
        "hags-enable" => apply_hags_enable()?,
        "mouse-accel-off" => apply_mouse_accel_off()?,
        "game-bar-disable" => apply_game_bar_disable()?,
        "diagtrack-disable" => apply_service_disable("DiagTrack")?,
        other => return Err(format!("'{}' is not yet supported for one-click apply", other)),
    };
    let change = AppliedChange {
        id: format!("{}-{}", rec_id, Utc::now().timestamp_millis()),
        rec_id,
        rec_title,
        applied_at: Utc::now().to_rfc3339(),
        snapshot,
        status: "applied".into(),
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
    match change.rec_id.as_str() {
        "game-mode" => rollback_game_mode(&change.snapshot)?,
        "visual-effects" => rollback_visual_effects(&change.snapshot)?,
        "sysmain-disable" => rollback_service_disable("SysMain", &change.snapshot)?,
        "nvidia-telemetry" => {
            rollback_service_disable("NvTelemetryContainer", &change.snapshot)?
        }
        "power-ultimate" => rollback_power_ultimate(&change.snapshot)?,
        "nagle-disable" => rollback_nagle_disable(&change.snapshot)?,
        "hags-enable" => rollback_hags_enable(&change.snapshot)?,
        "mouse-accel-off" => rollback_mouse_accel_off(&change.snapshot)?,
        "game-bar-disable" => rollback_game_bar_disable(&change.snapshot)?,
        "diagtrack-disable" => rollback_service_disable("DiagTrack", &change.snapshot)?,
        other => return Err(format!("'{}' rollback not yet implemented", other)),
    }
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
