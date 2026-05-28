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

fn detect_physical_disks() -> Vec<PhysicalDiskInfo> {
    // MSFT_PhysicalDisk lives in the Storage namespace, not CIMV2.
    // media_type: 3=HDD, 4=SSD, 5=SCM (storage-class memory / 3D XPoint)
    // bus_type:   17=NVMe, 11=SATA, 3=ATA, 7=USB, 8=iSCSI
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

fn detect_gpus() -> Vec<GpuInfo> {
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

fn collect_hardware() -> HardwareInfo {
    let mut sys = System::new_all();
    sys.refresh_all();

    let cpu_brand = sys
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .unwrap_or_else(|| "Unknown CPU".into());
    let cpu_frequency_mhz = sys.cpus().first().map(|c| c.frequency()).unwrap_or(0);

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
        disks,
        gpus: detect_gpus(),
        physical_disks: detect_physical_disks(),
        display: detect_display_info(),
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

    recs.push(Recommendation {
        id: "startup-debloat",
        title: "Review and disable noisy startup apps",
        category: "Windows",
        severity: "safe",
        description:
            "Most preinstalled launchers, updaters, and 'helpers' (Teams, Spotify, Discord, OEM bloat) auto-start with Windows and sit in the background using memory. Disabling them speeds up boot and frees RAM.",
        impact: "Faster boot · lower idle RAM use",
        downside: Some("You'll launch those apps manually when you want them."),
        applies_to: "All Windows installs".into(),
        currently_applied: false,
    });

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
