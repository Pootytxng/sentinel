//! Live system monitoring: GPU sensors (AMD via ADLX, NVIDIA via NVML), the
//! CPU/RAM poller, FPS/frametime capture control (spawns + reads the elevated
//! ETW helper), and the overlay window commands. Anti-cheat-safe by design:
//! no game injection, no kernel driver. Boundary move only — no behavior
//! change. Confidence posture (surfaced in the UI, not here): AMD verified,
//! NVIDIA implemented-unverified, Intel future.

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};
use sysinfo::System;
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

use crate::hardware::detect_gpus_dxgi;

// ─── CPU + memory sensors (vendor-agnostic, no kernel driver) ────────────
//
// Sentinel-safe: sysinfo calls PDH (Performance Data Helper, a built-in
// Windows API) for CPU utilization. No MSR reads, no kernel driver.
//
// NO CPU TEMPERATURE. We verified empirically on AMD hardware that every
// user-mode source is unavailable: MSAcpi_ThermalZoneTemperature returns
// "operation not supported", and the ThermalZone perf counter and
// Win32_TemperatureProbe are empty. Real CPU die temp requires ring-0 MSR/SMU
// access via a kernel driver, which is explicitly off the table.
//
// A dedicated background poller owns ONE sysinfo::System and refreshes it on a
// steady 1 s cadence, writing a snapshot to a cache. Every window's
// get_cpu_sensors call reads that cache. This is important: CPU% is a delta
// between two refreshes, so if multiple windows each refreshed a shared System
// at slightly different times they'd compute deltas over tiny, inconsistent
// intervals and read erratic/near-zero usage. One poller = one stable delta.

#[derive(Serialize, Clone, Default)]
pub(crate) struct CpuSensorSnapshot {
    /// Whole-system CPU utilization, 0.0-100.0.
    usage_overall_pct: f32,
    /// Per-logical-core utilization in the same units.
    usage_per_core_pct: Vec<f32>,
    /// Current frequency as reported by sysinfo (often the base clock on
    /// Windows; boost isn't reliably exposed through PDH).
    frequency_mhz: u64,
    /// Physical memory used / total in bytes.
    ram_used_bytes: u64,
    ram_total_bytes: u64,
}

pub(crate) fn cpu_sensor_cache() -> &'static Mutex<CpuSensorSnapshot> {
    static CACHE: OnceLock<Mutex<CpuSensorSnapshot>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(CpuSensorSnapshot::default()))
}

pub(crate) fn ensure_cpu_poller_started() {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        std::thread::Builder::new()
            .name("cpu-sensor-poller".into())
            .spawn(|| {
                let mut sys = System::new_all();
                loop {
                    sys.refresh_cpu_usage();
                    sys.refresh_memory();
                    let usage_per_core_pct: Vec<f32> =
                        sys.cpus().iter().map(|c| c.cpu_usage()).collect();
                    let usage_overall_pct = if usage_per_core_pct.is_empty() {
                        0.0
                    } else {
                        usage_per_core_pct.iter().sum::<f32>() / usage_per_core_pct.len() as f32
                    };
                    let frequency_mhz = sys.cpus().first().map(|c| c.frequency()).unwrap_or(0);
                    let snap = CpuSensorSnapshot {
                        usage_overall_pct,
                        usage_per_core_pct,
                        frequency_mhz,
                        ram_used_bytes: sys.used_memory(),
                        ram_total_bytes: sys.total_memory(),
                    };
                    if let Ok(mut cache) = cpu_sensor_cache().lock() {
                        *cache = snap;
                    }
                    // 1 s cadence also satisfies sysinfo's minimum CPU refresh
                    // interval, so each reading is a clean ~1 s delta.
                    std::thread::sleep(std::time::Duration::from_secs(1));
                }
            })
            .ok();
    });
}

#[tauri::command]
pub(crate) fn get_cpu_sensors() -> CpuSensorSnapshot {
    ensure_cpu_poller_started();
    cpu_sensor_cache().lock().map(|c| c.clone()).unwrap_or_default()
}

// ─── GPU sensors: NVIDIA path (NVML) ─────────────────────────────────────
//
// Sentinel-safe monitoring: NVML is NVIDIA's vendor-blessed signed library
// for driver-side telemetry (nvml.dll ships with the driver). No injection,
// no kernel driver, anti-cheat-compatible.
//
// On non-NVIDIA systems (or when the NVIDIA driver isn't installed) Nvml::
// init() returns Err. We cache the Err once via OnceLock so we don't retry
// init on every poll — the Monitoring tab shows "GPU sensors unavailable"
// instead.
//
// AMD is handled separately via ADLX (see the AMD GPU sensors section
// below); Intel GPA is still planned. Every vendor path returns the same
// shape — one Vec<GpuSensorSnapshot> per call regardless of vendor mix.

#[derive(Serialize, Clone)]
pub(crate) struct GpuSensorSnapshot {
    /// GPU vendor that produced this snapshot: "NVIDIA" or "AMD". The UI uses
    /// this (with index) to key panels and pick the right units for fan speed.
    vendor: String,
    /// Adapter index within its vendor (0-based). Stable across calls.
    index: u32,
    /// Device name, e.g. "NVIDIA GeForce RTX 4080" or "AMD Radeon RX 9070 XT".
    name: String,
    /// GPU die / edge temperature in Celsius. None if the device doesn't report.
    temperature_c: Option<u32>,
    /// GPU hotspot (junction) temperature in Celsius. AMD-specific — the
    /// hottest on-die sensor, which RDNA cards expose and enthusiasts watch
    /// for thermal headroom. None on NVIDIA (NVML doesn't expose it).
    hotspot_temperature_c: Option<u32>,
    /// GPU core utilization, 0-100. None if unavailable.
    utilization_gpu_pct: Option<u32>,
    /// Memory controller utilization (NOT VRAM usage), 0-100. NVIDIA-only;
    /// ADLX doesn't expose a directly comparable figure.
    utilization_memory_pct: Option<u32>,
    /// VRAM used / total in bytes.
    vram_used_bytes: Option<u64>,
    vram_total_bytes: Option<u64>,
    /// Graphics clock in MHz.
    graphics_clock_mhz: Option<u32>,
    /// Memory clock in MHz.
    memory_clock_mhz: Option<u32>,
    /// Instantaneous power draw in watts. For AMD this is total board power
    /// when available (falling back to GPU-only power); for NVIDIA it's the
    /// board power NVML reports.
    power_draw_w: Option<f32>,
    /// Fan speed as a percent of max. NVIDIA reports this directly; AMD
    /// reports RPM instead (see fan_speed_rpm), so this is None on AMD.
    fan_speed_pct: Option<u32>,
    /// Fan speed in RPM. AMD/ADLX reports fan speed as RPM; None on NVIDIA.
    fan_speed_rpm: Option<u32>,
}

pub(crate) fn nvml_instance() -> &'static Option<nvml_wrapper::Nvml> {
    static NVML: OnceLock<Option<nvml_wrapper::Nvml>> = OnceLock::new();
    NVML.get_or_init(|| nvml_wrapper::Nvml::init().ok())
}

// ─── AMD GPU sensors (ADLX) ──────────────────────────────────────────────
//
// ADLX objects are COM-like and not thread-safe, and Tauri commands run on a
// thread pool, so we can't share an AdlxHelper across command invocations.
// Instead a single dedicated poller thread owns all ADLX state for the life
// of the process and writes the latest snapshot into a shared Mutex. The
// get_gpu_sensors command just reads that cache — cheap and thread-safe.
//
// The poller starts lazily on the first get_gpu_sensors call. If ADLX init
// fails (no AMD driver / non-AMD system) the thread exits immediately and the
// cache stays empty, so AMD simply contributes nothing to the merged result.

pub(crate) fn amd_sensor_cache() -> &'static Mutex<Vec<GpuSensorSnapshot>> {
    static CACHE: OnceLock<Mutex<Vec<GpuSensorSnapshot>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Vec::new()))
}

/// Latest AMD FreeSync (VRR) state, written by the AMD poller (the only thread allowed to touch
/// ADLX). `Some(true)` = enabled on a display, `Some(false)` = supported but off, `None` = couldn't
/// determine (no AMD GPU, FreeSync unsupported/unavailable, or an ADLX error). Readiness reads this.
pub(crate) fn amd_freesync_cache() -> &'static Mutex<Option<bool>> {
    static CACHE: OnceLock<Mutex<Option<bool>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

pub(crate) fn ensure_amd_poller_started() {
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        std::thread::Builder::new()
            .name("amd-gpu-poller".into())
            .spawn(amd_poller_loop)
            .ok();
    });
}

// Total VRAM isn't exposed by ADLX's current-metrics snapshot (only used VRAM
// is), so we read total dedicated VRAM once from DXGI — code we already use
// for GPU detection — and reuse it for the used/total percentage. Single GPU
// is the overwhelming common case; for multi-GPU we use the largest adapter's
// VRAM, which is the discrete card that matters here.
pub(crate) fn amd_total_vram_bytes() -> Option<u64> {
    detect_gpus_dxgi()
        .iter()
        .map(|g| g.vram_bytes)
        .filter(|&v| v > 0)
        .max()
}

pub(crate) fn amd_poller_loop() {
    use adlx::helper::AdlxHelper;

    let Ok(helper) = AdlxHelper::new() else {
        return;
    };
    let system = helper.system();
    let Ok(gpu_list) = system.gpus() else {
        return;
    };
    let Ok(perf) = system.performance_monitoring_services() else {
        return;
    };
    let total_vram = amd_total_vram_bytes();
    let count = gpu_list.size();

    loop {
        let mut out = Vec::new();
        for i in 0..count {
            let Ok(gpu) = gpu_list.at(i) else { continue };
            let Ok(metrics) = perf.current_gpu_metrics(&gpu) else {
                continue;
            };
            let name = gpu.name().unwrap_or("AMD GPU").to_string();
            let support = perf.supported_gpu_metrics(&gpu).ok();

            // Read support flags once (default to "attempt the read" when the
            // support query itself failed, so we don't silently drop data on
            // drivers that don't implement the support interface).
            let (
                sup_temp,
                sup_hot,
                sup_usage,
                sup_power,
                sup_tbp,
                sup_clk,
                sup_vclk,
                sup_fan,
                sup_vram,
            ) = match &support {
                Some(s) => (
                    s.is_supported_gpu_temperature().unwrap_or(false),
                    s.is_supported_gpu_hotspot_temperature().unwrap_or(false),
                    s.is_supported_gpu_usage().unwrap_or(false),
                    s.is_supported_gpu_power().unwrap_or(false),
                    s.is_supported_gpu_total_board_power().unwrap_or(false),
                    s.is_supported_gpu_clock_speed().unwrap_or(false),
                    s.is_supported_gpu_vram_clock_speed().unwrap_or(false),
                    s.is_supported_gpu_fan_speed().unwrap_or(false),
                    s.is_supported_gpu_vram().unwrap_or(false),
                ),
                None => (true, true, true, true, true, true, true, true, true),
            };

            let temperature_c = if sup_temp {
                metrics.temperature().ok().map(|v| v.round() as u32)
            } else {
                None
            };
            let hotspot_temperature_c = if sup_hot {
                metrics.hotspot_temperature().ok().map(|v| v.round() as u32)
            } else {
                None
            };
            let utilization_gpu_pct = if sup_usage {
                metrics.usage().ok().map(|v| v.round() as u32)
            } else {
                None
            };
            // Prefer total board power (what gamers compare); fall back to
            // GPU-only power if TBP isn't supported on this card.
            let power_draw_w = if sup_tbp {
                metrics.total_board_power().ok().map(|v| v as f32)
            } else if sup_power {
                metrics.power().ok().map(|v| v as f32)
            } else {
                None
            };
            let graphics_clock_mhz = if sup_clk {
                metrics.clock_speed().ok().filter(|&v| v >= 0).map(|v| v as u32)
            } else {
                None
            };
            let memory_clock_mhz = if sup_vclk {
                metrics
                    .vram_clock_speed()
                    .ok()
                    .filter(|&v| v >= 0)
                    .map(|v| v as u32)
            } else {
                None
            };
            let fan_speed_rpm = if sup_fan {
                metrics.fan_speed().ok().filter(|&v| v >= 0).map(|v| v as u32)
            } else {
                None
            };
            // ADLX reports VRAM usage in MB.
            let vram_used_bytes = if sup_vram {
                metrics
                    .vram()
                    .ok()
                    .filter(|&v| v >= 0)
                    .map(|mb| mb as u64 * 1024 * 1024)
            } else {
                None
            };

            // Skip phantom / non-functional adapters. On this machine ADLX
            // also enumerates a "Microsoft Basic Display Adapter" (the Windows
            // software fallback) that reports no telemetry — it shouldn't show
            // up as a GPU. Filter by the known basic/render driver names, and
            // defensively drop any adapter that reports NO usable metric at all
            // (a real GPU like the RX 9070 XT consistently reports temperature).
            let is_basic_adapter = name.contains("Basic Display")
                || name.contains("Basic Render")
                || name.contains("Microsoft Basic");
            let has_no_telemetry = temperature_c.is_none()
                && utilization_gpu_pct.is_none()
                && graphics_clock_mhz.is_none()
                && vram_used_bytes.is_none();
            if is_basic_adapter || has_no_telemetry {
                continue;
            }

            out.push(GpuSensorSnapshot {
                vendor: "AMD".into(),
                index: i,
                name,
                temperature_c,
                hotspot_temperature_c,
                utilization_gpu_pct,
                utilization_memory_pct: None,
                vram_used_bytes,
                vram_total_bytes: total_vram,
                graphics_clock_mhz,
                memory_clock_mhz,
                power_draw_w,
                fan_speed_pct: None,
                fan_speed_rpm,
            });
        }

        if let Ok(mut cache) = amd_sensor_cache().lock() {
            *cache = out;
        }

        // FreeSync (VRR) on/off — read on this same ADLX thread, reusing the poller's System
        // (ADLX is single-threaded). Fail-soft to None; the readiness VRR row falls back to its
        // honest advisory when None.
        let freesync = crate::amd_freesync::read_freesync(system);
        if let Ok(mut c) = amd_freesync_cache().lock() {
            *c = freesync;
        }

        std::thread::sleep(std::time::Duration::from_millis(1000));
    }
}

pub(crate) fn read_nvml_sensors() -> Vec<GpuSensorSnapshot> {
    use nvml_wrapper::enum_wrappers::device::{Clock, TemperatureSensor};

    let Some(nvml) = nvml_instance() else {
        return Vec::new();
    };
    let count = match nvml.device_count() {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };
    let mut out = Vec::with_capacity(count as usize);
    for i in 0..count {
        let device = match nvml.device_by_index(i) {
            Ok(d) => d,
            Err(_) => continue,
        };
        let name = device.name().unwrap_or_else(|_| "NVIDIA GPU".into());
        let temperature_c = device.temperature(TemperatureSensor::Gpu).ok();
        let util = device.utilization_rates().ok();
        let mem = device.memory_info().ok();
        let graphics_clock_mhz = device.clock_info(Clock::Graphics).ok();
        let memory_clock_mhz = device.clock_info(Clock::Memory).ok();
        let power_draw_w = device.power_usage().ok().map(|mw| mw as f32 / 1000.0);
        let fan_speed_pct = device.fan_speed(0).ok();

        out.push(GpuSensorSnapshot {
            vendor: "NVIDIA".into(),
            index: i,
            name,
            temperature_c,
            hotspot_temperature_c: None,
            utilization_gpu_pct: util.as_ref().map(|u| u.gpu),
            utilization_memory_pct: util.as_ref().map(|u| u.memory),
            vram_used_bytes: mem.as_ref().map(|m| m.used),
            vram_total_bytes: mem.as_ref().map(|m| m.total),
            graphics_clock_mhz,
            memory_clock_mhz,
            power_draw_w,
            fan_speed_pct,
            fan_speed_rpm: None,
        });
    }
    out
}

#[tauri::command]
pub(crate) fn get_gpu_sensors() -> Vec<GpuSensorSnapshot> {
    // Start the AMD poller on first call (no-op if already started or if
    // ADLX init fails). NVML reads inline — it's cheap. AMD data comes from
    // the background poller's cache, so it appears ~1s after the first call.
    ensure_amd_poller_started();
    let mut out = read_nvml_sensors();
    if let Ok(amd) = amd_sensor_cache().lock() {
        out.extend(amd.iter().cloned());
    }
    out
}

// ─── FPS / frametime control (elevated helper orchestration) ─────────────
//
// The main app runs unelevated; the ETW capture helper must be elevated.
// We can't kill an elevated process from here, so the lifecycle is managed
// by a heartbeat file: while monitoring is active a background thread
// refreshes it every second; the helper self-exits when it goes stale. The
// helper writes its latest report to a JSON file under LOCALAPPDATA\Sentinel
// which we read here (same per-user path resolves in both processes).

pub(crate) fn fps_dir() -> PathBuf {
    // Runtime IPC files (fps.json / fps.alive) live in a dedicated `runtime/`
    // subdir under the app data root — NOT %LOCALAPPDATA%\Sentinel, which is the
    // NSIS install dir, so runtime files never land beside the installed binaries.
    // The Trust Ledger stays directly in the data root (sentinel_data_dir).
    crate::sentinel_data_dir().join("runtime")
}
pub(crate) fn fps_out_path() -> PathBuf {
    fps_dir().join("fps.json")
}
pub(crate) fn fps_alive_path() -> PathBuf {
    fps_dir().join("fps.alive")
}

pub(crate) fn fps_active() -> &'static std::sync::atomic::AtomicBool {
    static A: OnceLock<std::sync::atomic::AtomicBool> = OnceLock::new();
    A.get_or_init(|| std::sync::atomic::AtomicBool::new(false))
}
pub(crate) fn fps_status_slot() -> &'static Mutex<String> {
    static S: OnceLock<Mutex<String>> = OnceLock::new();
    S.get_or_init(|| Mutex::new("idle".to_string()))
}
pub(crate) fn touch_alive() {
    // The helper checks this file's mtime; the contents don't matter.
    let _ = std::fs::write(fps_alive_path(), b"alive");
}

#[derive(Deserialize, Serialize, Clone)]
pub(crate) struct FpsSample {
    pid: u32,
    process_name: String,
    fps: f64,
    avg_frametime_ms: f64,
    low1_fps: f64,
    frames_last_sec: usize,
    recent_frametimes_ms: Vec<f64>,
}

#[derive(Serialize)]
pub(crate) struct FpsStatus {
    active: bool,
    status: String,
    sample: Option<FpsSample>,
}

#[tauri::command]
pub(crate) fn start_fps_capture() -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if fps_active().load(Ordering::Acquire) {
        return Ok(()); // already running
    }
    let dir = fps_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create data dir: {e}"))?;
    // Drop any stale sample so the UI doesn't briefly show last session's data.
    let _ = std::fs::remove_file(fps_out_path());
    touch_alive();
    fps_active().store(true, Ordering::Release);
    *fps_status_slot().lock().unwrap() = "starting".into();

    let exe = std::env::current_exe().map_err(|e| format!("cannot find own exe: {e}"))?;

    // Heartbeat: refresh the alive file every second while active; remove it
    // on stop so the helper self-exits.
    std::thread::spawn(|| {
        use std::sync::atomic::Ordering;
        while fps_active().load(Ordering::Acquire) {
            touch_alive();
            std::thread::sleep(std::time::Duration::from_secs(1));
        }
        let _ = std::fs::remove_file(fps_alive_path());
    });

    let out = fps_out_path().to_string_lossy().to_string();
    let alive = fps_alive_path().to_string_lossy().to_string();

    // Launch path depends on UAC. When UAC is fully disabled (EnableLUA=0),
    // the ShellExecute "runas" verb can't elevate — it silently fails, so the
    // helper never starts. But with UAC off + an admin account, this process
    // already carries a full admin token, so we can launch the helper DIRECTLY
    // and it inherits the rights needed to open the ETW session. With UAC on,
    // we use runas to elevate (prompt or auto-approve per policy).
    if uac_disabled() {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        match std::process::Command::new(&exe)
            .args([
                "--fps-capture",
                "--fps-out",
                out.as_str(),
                "--fps-alive",
                alive.as_str(),
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            Ok(mut child) => {
                *fps_status_slot().lock().unwrap() = "running".into();
                // Reflect helper exit (self-exit on heartbeat stale, or crash).
                std::thread::spawn(move || {
                    let _ = child.wait();
                    fps_active().store(false, Ordering::Release);
                    *fps_status_slot().lock().unwrap() = "stopped".into();
                });
            }
            Err(e) => {
                fps_active().store(false, Ordering::Release);
                *fps_status_slot().lock().unwrap() = format!("failed to launch helper: {e}");
            }
        }
    } else {
        // runas .status() blocks for the helper's lifetime, so run it on a
        // dedicated thread. A declined UAC prompt returns Err quickly.
        //
        // .show(false) => SW_HIDE: launch the elevated helper HIDDEN. The helper
        // never creates a Tauri window (main.rs returns into run_fps_capture
        // before tauri::Builder), but in a debug build sentinel.exe is a
        // console-subsystem app, so the default SW_NORMAL would pop a visible
        // console running the capture loop. The direct-spawn path above gets the
        // same effect via CREATE_NO_WINDOW; this is the runas equivalent.
        std::thread::spawn(move || {
            let res = runas::Command::new(exe)
                .args(&["--fps-capture", "--fps-out", &out, "--fps-alive", &alive])
                .show(false)
                .status();
            fps_active().store(false, Ordering::Release);
            // Distinguish a cancelled/failed elevation from a clean stop. The
            // runas crate ALWAYS returns Ok on Windows (even on UAC cancel it
            // returns Ok with a non-zero/!0 exit status), so the old `Err(_)`
            // arm was dead and a cancel was reported as a normal "stopped".
            // A successfully-run helper exits 0; a cancel yields a non-zero
            // status -> "declined", which the UI surfaces as a clear "permission
            // was declined" message.
            let msg = match res {
                Ok(s) if s.success() => "stopped",
                _ => "declined",
            };
            *fps_status_slot().lock().unwrap() = msg.into();
        });
    }

    // Session summary aggregator (F3, READ-ONLY): while monitoring is active,
    // fold the FPS helper's per-second output + existing GPU/CPU/RAM sensors
    // into a per-session record, then persist a summary on stop. Samples nothing
    // new and mutates nothing. A session is only saved if a game actually
    // presented frames (so cancelled/idle starts leave no empty record).
    {
        let started_at = chrono::Utc::now().to_rfc3339();
        let active_changes = crate::history::applied_changes_summary().active;
        std::thread::spawn(move || {
            use std::sync::atomic::Ordering;
            let mut acc = crate::sessions::SessionAccumulator::new(started_at, active_changes);
            let start = std::time::Instant::now();
            while fps_active().load(Ordering::Acquire) {
                std::thread::sleep(std::time::Duration::from_secs(1));
                if !fps_active().load(Ordering::Acquire) {
                    break;
                }
                if let Ok(txt) = std::fs::read_to_string(fps_out_path()) {
                    if let Ok(s) = serde_json::from_str::<FpsSample>(&txt) {
                        if s.fps > 0.0 {
                            acc.record_fps(&s.process_name, s.fps, s.avg_frametime_ms, s.low1_fps);
                        }
                    }
                }
                let gpus = get_gpu_sensors();
                let gpu_temp = gpus.iter().filter_map(|g| g.temperature_c).max();
                let gpu_usage = gpus.iter().filter_map(|g| g.utilization_gpu_pct).max();
                let cpu = get_cpu_sensors();
                acc.record_sensors(
                    gpu_temp,
                    gpu_usage,
                    Some(cpu.ram_used_bytes),
                    Some(cpu.ram_total_bytes),
                );
            }
            if acc.has_data() {
                let _ = crate::sessions::save_session(acc.finalize(start.elapsed().as_secs()));
            }
        });
    }

    Ok(())
}

// True when UAC is fully disabled (EnableLUA=0). In that state the "runas"
// elevation verb doesn't work, but an admin user's processes already run with
// a full admin token — so we launch the FPS helper directly instead.
pub(crate) fn uac_disabled() -> bool {
    RegKey::predef(HKEY_LOCAL_MACHINE)
        .open_subkey("SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System")
        .and_then(|k| k.get_value::<u32, _>("EnableLUA"))
        .map(|v| v == 0)
        .unwrap_or(false)
}

#[tauri::command]
pub(crate) fn stop_fps_capture() {
    use std::sync::atomic::Ordering;
    fps_active().store(false, Ordering::Release);
    *fps_status_slot().lock().unwrap() = "idle".into();
    let _ = std::fs::remove_file(fps_alive_path());
    let _ = std::fs::remove_file(fps_out_path());
}

#[tauri::command]
pub(crate) fn get_fps_status() -> FpsStatus {
    use std::sync::atomic::Ordering;
    let active = fps_active().load(Ordering::Acquire);
    let status = fps_status_slot().lock().unwrap().clone();
    // Only surface a sample if it's fresh (< 3 s old) — otherwise the helper
    // has stalled or the game stopped presenting.
    let sample = (|| {
        let path = fps_out_path();
        let meta = std::fs::metadata(&path).ok()?;
        let fresh = meta
            .modified()
            .ok()
            .and_then(|m| m.elapsed().ok())
            .map(|e| e < std::time::Duration::from_secs(3))
            .unwrap_or(false);
        if !fresh {
            return None;
        }
        let bytes = std::fs::read(&path).ok()?;
        serde_json::from_slice::<FpsSample>(&bytes).ok()
    })();
    FpsStatus {
        active,
        status,
        sample,
    }
}

// ─── Telemetry overlay window ────────────────────────────────────────────
//
// A second always-on-top, transparent, click-through window that renders the
// live telemetry (FPS, frametime, GPU temp/usage, CPU usage) compactly in a
// screen corner. It loads the same frontend bundle at the #overlay route.
//
// Sentinel-safe constraint: this is a normal top-level window, so it draws
// over BORDERLESS / WINDOWED games but NOT exclusive fullscreen (only injected
// overlays can do that, which we deliberately don't do). The UI states this.

// The overlay window is DECLARED STATICALLY in tauri.conf.json (label
// "overlay", visible:false) rather than created at runtime. Runtime-created
// secondary windows aren't routed through the Vite dev server in dev and load
// a blank white page (tauri-apps/tauri#13963, #9601); config-declared windows
// get the same routing the main window does. So we just show/hide it here.
#[tauri::command]
pub(crate) fn show_overlay(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let w = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    w.show().map_err(|e| e.to_string())?;
    // Click-through so the overlay never steals input from the game.
    let _ = w.set_ignore_cursor_events(true);
    // Force a fresh load of the bundle. The config-declared overlay window
    // loads once at startup and does NOT reliably receive frontend updates in
    // dev (HMR targets the main window), so without this it can run stale code
    // (e.g. an old GPU-selection that picked the wrong adapter). Harmless in
    // release — it just reloads the same bundled page.
    let _ = w.eval("window.location.reload()");
    Ok(())
}

#[tauri::command]
pub(crate) fn hide_overlay(app: tauri::AppHandle) {
    use tauri::Manager;
    if let Some(w) = app.get_webview_window("overlay") {
        // Hide (not close) — the window is config-owned and reused.
        let _ = w.hide();
    }
}

#[tauri::command]
pub(crate) fn overlay_visible(app: tauri::AppHandle) -> bool {
    use tauri::Manager;
    app.get_webview_window("overlay")
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false)
}

#[cfg(test)]
mod runtime_dir_tests {
    use super::*;

    #[test]
    fn fps_runtime_dir_is_separate_from_install_dir() {
        let d = fps_dir();
        // Dedicated runtime/ subdir, under the app data root (same root as the
        // Trust Ledger) but distinct from the bare data dir — so it is never the
        // install dir (%LOCALAPPDATA%\Sentinel) nor beside the installed binaries.
        assert!(d.ends_with("runtime"), "fps_dir should be a dedicated runtime dir: {d:?}");
        assert!(
            d.starts_with(crate::sentinel_data_dir()),
            "fps_dir should be under the data root"
        );
        assert_ne!(
            d,
            crate::sentinel_data_dir(),
            "runtime dir must be distinct from the ledger dir"
        );
        assert!(fps_out_path().starts_with(&d));
        assert!(fps_alive_path().starts_with(&d));
    }
}
