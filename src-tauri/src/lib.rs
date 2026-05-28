use serde::{Deserialize, Serialize};
use sysinfo::{Disks, System};
use wmi::{COMLibrary, WMIConnection};

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
    video_processor: String,
}

#[derive(Deserialize)]
#[serde(rename = "Win32_VideoController")]
#[serde(rename_all = "PascalCase")]
struct Win32VideoController {
    name: Option<String>,
    #[serde(rename = "AdapterRAM")]
    adapter_ram: Option<u64>,
    driver_version: Option<String>,
    video_processor: Option<String>,
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
            Some(GpuInfo {
                name,
                vram_bytes: g.adapter_ram.unwrap_or(0),
                driver_version: g.driver_version.unwrap_or_default(),
                video_processor: g.video_processor.unwrap_or_default(),
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

fn build_recommendations(hw: &HardwareInfo) -> Vec<Recommendation> {
    let mut recs: Vec<Recommendation> = Vec::new();

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
        applies_to: "Windows desktop".into(),
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
    });

    recs.push(Recommendation {
        id: "visual-effects",
        title: "Trim Windows visual effects",
        category: "Windows",
        severity: "safe",
        description:
            "Animations, transparency, and shadow effects look nice but cost a few percent of GPU and CPU. Turning the cosmetic ones off makes the UI feel snappier and shaves background load while gaming.",
        impact: "Snappier UI · slightly higher in-game FPS",
        downside: Some("UI looks more utilitarian — no fade animations."),
        applies_to: "Any Windows version".into(),
    });

    // ─── GPU vendor-specific ─────────────────────────────────────────────
    if let Some(name) = gpu_vendor_match(hw, "NVIDIA") {
        recs.push(Recommendation {
            id: "nvidia-telemetry",
            title: "Disable NVIDIA Container telemetry services",
            category: "GPU",
            severity: "safe",
            description:
                "NVIDIA's driver bundle ships several background services that exist mainly to send usage data and check for GeForce Experience updates. They consume RAM and CPU constantly. Disabling them does not affect game performance or driver functionality.",
            impact: "Free ~150–250 MB RAM · less background CPU",
            downside: Some("GeForce Experience won't auto-update; you can still update manually."),
            applies_to: name,
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
            });
            break;
        }
    }

    // ─── RAM-conditional ─────────────────────────────────────────────────
    let ram_gb = hw.ram_total_bytes as f64 / 1024.0_f64.powi(3);
    if ram_gb >= 16.0 {
        recs.push(Recommendation {
            id: "sysmain-disable",
            title: "Disable SysMain (Superfetch)",
            category: "Windows",
            severity: "moderate",
            description:
                "SysMain preloads frequently-used apps into RAM to make them launch faster. With 16 GB+ of RAM this benefit is small, and on systems with NVMe SSDs SysMain often causes mysterious disk thrashing instead.",
            impact: "Lower idle disk activity · ~100–200 MB RAM back",
            downside: Some("App launches will be a tiny bit slower (usually unnoticeable on NVMe)."),
            applies_to: format!("{:.0} GB RAM installed", ram_gb),
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
    });

    recs
}

#[tauri::command]
fn get_recommendations() -> Vec<Recommendation> {
    let hw = collect_hardware();
    build_recommendations(&hw)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_hardware_info, get_recommendations])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
