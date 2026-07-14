//! Live system monitoring: GPU sensors (AMD via ADLX, NVIDIA via NVML), the
//! CPU/RAM poller, FPS/frametime capture control (spawns + reads the elevated
//! ETW helper), and the overlay window commands. Anti-cheat-safe by design:
//! no game injection, no kernel driver. Boundary move only — no behavior
//! change. Confidence posture (surfaced in the UI, not here): AMD verified,
//! NVIDIA implemented-unverified, Intel future.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use sysinfo::System;
use winreg::enums::HKEY_LOCAL_MACHINE;
use winreg::RegKey;

use crate::hardware::detect_gpus_dxgi;

// ─── CPU + memory sensors (vendor-agnostic, no kernel driver) ────────────
//
// Compy-safe: sysinfo calls PDH (Performance Data Helper, a built-in
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
    /// Live current clock in MHz — boost-aware (base × "% Processor Performance" via PDH). Falls
    /// back to sysinfo's base clock if the PDH counter is unavailable.
    frequency_mhz: u64,
    /// Physical memory used / total in bytes.
    ram_used_bytes: u64,
    ram_total_bytes: u64,
}

pub(crate) fn cpu_sensor_cache() -> &'static Mutex<CpuSensorSnapshot> {
    static CACHE: OnceLock<Mutex<CpuSensorSnapshot>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(CpuSensorSnapshot::default()))
}

// ── Live CPU frequency via PDH (boost-aware) ──────────────────────────────
// sysinfo's `frequency()` returns the BASE clock on Windows — it never shows boost. The real
// current clock = base × "% Processor Performance" (a PDH counter that climbs past 100% under
// boost and drops below it when the CPU parks/idles). Read-only, no driver, no elevation. The
// handles live on the poller thread (PDH handles aren't Send) and are primed once on open.
struct CpuPerfCounter {
    query: windows::Win32::System::Performance::PDH_HQUERY,
    counter: windows::Win32::System::Performance::PDH_HCOUNTER,
}

impl CpuPerfCounter {
    fn open() -> Option<Self> {
        use windows::Win32::System::Performance::{
            PdhAddEnglishCounterW, PdhCollectQueryData, PdhOpenQueryW, PDH_HCOUNTER, PDH_HQUERY,
        };
        unsafe {
            let mut query = PDH_HQUERY::default();
            if PdhOpenQueryW(None, 0, &mut query) != 0 {
                return None;
            }
            let mut counter = PDH_HCOUNTER::default();
            let path = windows::core::w!("\\Processor Information(_Total)\\% Processor Performance");
            if PdhAddEnglishCounterW(query, path, 0, &mut counter) != 0 {
                return None;
            }
            let _ = PdhCollectQueryData(query); // prime — the first sample always reads 0
            Some(Self { query, counter })
        }
    }

    /// Current "% Processor Performance" (~100 at base, >100 under boost). None if unavailable.
    fn read_pct(&self) -> Option<f64> {
        use windows::Win32::System::Performance::{
            PdhCollectQueryData, PdhGetFormattedCounterValue, PDH_FMT_COUNTERVALUE, PDH_FMT_DOUBLE,
        };
        unsafe {
            if PdhCollectQueryData(self.query) != 0 {
                return None;
            }
            let mut value = PDH_FMT_COUNTERVALUE::default();
            if PdhGetFormattedCounterValue(self.counter, PDH_FMT_DOUBLE, None, &mut value) != 0 {
                return None;
            }
            Some(value.Anonymous.doubleValue)
        }
    }
}

impl Drop for CpuPerfCounter {
    // Closing the query frees its counter too. Today the sole owner lives on a poller thread that
    // loops for the process's lifetime, so this rarely fires — but making ownership explicit means a
    // future short-lived reader (or a poller that learns to exit) can't leak the PDH handle.
    fn drop(&mut self) {
        use windows::Win32::System::Performance::PdhCloseQuery;
        unsafe {
            let _ = PdhCloseQuery(self.query);
        }
    }
}

// ─── Demand-gated pollers ────────────────────────────────────────────────
//
// The sensor pollers do their (relatively costly) refresh only while a consumer
// is actively reading them. Every get_* command marks a "demand" timestamp via
// the ensure_*_started chokepoint; if nothing has asked within
// POLLER_IDLE_AFTER_MS, the poller thread stays alive but idles — no sysinfo
// refresh, no ADLX reads — so Compy does ~nothing sitting in the tray with
// the Monitoring tab closed and the overlay hidden. A consumer resumes it just
// by calling the command again (the next loop tick, ≤1 s later, refreshes).
// Two independent signals so the CPU poller and the AMD/GPU poller idle on
// their own schedules — and so the FreeSync read (which Readiness drives via the
// GPU signal) is never starved.
const POLLER_IDLE_AFTER_MS: u64 = 3000;

fn poller_epoch() -> Instant {
    static T: OnceLock<Instant> = OnceLock::new();
    *T.get_or_init(Instant::now)
}
fn poller_now_ms() -> u64 {
    poller_epoch().elapsed().as_millis() as u64
}
fn cpu_demand() -> &'static AtomicU64 {
    static D: OnceLock<AtomicU64> = OnceLock::new();
    D.get_or_init(|| AtomicU64::new(0))
}
fn gpu_demand() -> &'static AtomicU64 {
    static D: OnceLock<AtomicU64> = OnceLock::new();
    D.get_or_init(|| AtomicU64::new(0))
}
/// A consumer is reading this sensor right now — keep its poller awake.
fn mark_demand(d: &AtomicU64) {
    d.store(poller_now_ms(), Ordering::Relaxed);
}
/// True when no consumer has asked within the idle window → the poller skips its refresh.
fn poller_idle(d: &AtomicU64) -> bool {
    poller_now_ms().saturating_sub(d.load(Ordering::Relaxed)) > POLLER_IDLE_AFTER_MS
}

pub(crate) fn ensure_cpu_poller_started() {
    mark_demand(cpu_demand());
    static STARTED: OnceLock<()> = OnceLock::new();
    STARTED.get_or_init(|| {
        std::thread::Builder::new()
            .name("cpu-sensor-poller".into())
            .spawn(|| {
                // `new()`, not `new_all()`: this poller only needs CPU + memory, so we never load
                // (or retain for the app's lifetime) the full process / disk / network / component
                // tables `new_all()` builds. Keeps Compy's own footprint minimal — a PC
                // optimizer shouldn't be a memory hog. `refresh_cpu_all` keeps the clock reading.
                let mut sys = System::new();
                // PDH live-frequency reader (boost-aware); falls back to the base clock if absent.
                let cpu_perf = CpuPerfCounter::open();
                loop {
                    // Idle when nothing's reading CPU/RAM — skip the refresh entirely.
                    if poller_idle(cpu_demand()) {
                        std::thread::sleep(std::time::Duration::from_secs(1));
                        continue;
                    }
                    sys.refresh_cpu_all();
                    sys.refresh_memory();
                    let usage_per_core_pct: Vec<f32> =
                        sys.cpus().iter().map(|c| c.cpu_usage()).collect();
                    let usage_overall_pct = if usage_per_core_pct.is_empty() {
                        0.0
                    } else {
                        usage_per_core_pct.iter().sum::<f32>() / usage_per_core_pct.len() as f32
                    };
                    let base_mhz = sys.cpus().first().map(|c| c.frequency()).unwrap_or(0);
                    // Live current clock = base × % Processor Performance (boost-aware); base fallback.
                    let frequency_mhz = cpu_perf
                        .as_ref()
                        .and_then(|p| p.read_pct())
                        .filter(|pct| *pct > 0.0)
                        .map(|pct| (base_mhz as f64 * pct / 100.0).round() as u64)
                        .unwrap_or(base_mhz);
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

// ─── Memory pressure (RAM-maxed → stutter warning) ───────────────────────
//
// Physical-RAM exhaustion is a classic, invisible cause of in-game stutter:
// once the working set exceeds physical RAM, Windows pages to disk and frames
// hitch. Compy surfaces it honestly — the level AND what's eating it, so the
// user knows what to close. Read-only (sysinfo/PDH), no mutation, no driver.

#[derive(Serialize, Clone, Debug)]
pub(crate) struct MemConsumer {
    pub name: String,
    pub bytes: u64,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct MemoryPressure {
    pub used_bytes: u64,
    pub total_bytes: u64,
    pub used_pct: u32,
    /// Pagefile currently in use (bytes) — non-zero means some spillover already.
    pub swap_used_bytes: u64,
    pub swap_total_bytes: u64,
    /// "ok" | "tight" | "critical".
    pub level: String,
    pub advisory: Option<String>,
    /// Biggest RAM users, grouped by process name, largest first.
    pub top_consumers: Vec<MemConsumer>,
}

// Reused across polls (sysinfo recommends one System); memory-only process
// refresh keeps it cheap.
fn mem_pressure_system() -> &'static Mutex<System> {
    static SYS: OnceLock<Mutex<System>> = OnceLock::new();
    SYS.get_or_init(|| Mutex::new(System::new()))
}

#[tauri::command]
pub(crate) fn get_memory_pressure() -> MemoryPressure {
    use std::collections::HashMap;
    let Ok(mut sys) = mem_pressure_system().lock() else {
        return MemoryPressure {
            used_bytes: 0,
            total_bytes: 0,
            used_pct: 0,
            swap_used_bytes: 0,
            swap_total_bytes: 0,
            level: "ok".into(),
            advisory: None,
            top_consumers: Vec::new(),
        };
    };
    sys.refresh_memory();

    let total = sys.total_memory();
    let used = sys.used_memory();
    let used_pct = if total > 0 {
        ((used as f64 / total as f64) * 100.0).round() as u32
    } else {
        0
    };

    let (level, advisory) = if used_pct >= 90 {
        (
            "critical",
            Some(
                "RAM is nearly full — a common, invisible cause of in-game stutter (once it fills, \
                 Windows pages to disk). Closing some of the apps below frees it up."
                    .to_string(),
            ),
        )
    } else if used_pct >= 80 {
        (
            "tight",
            Some(
                "RAM is getting tight. If stutter shows up, closing some of the apps below will help."
                    .to_string(),
            ),
        )
    } else {
        ("ok", None)
    };

    // Only pay for the full process scan when there's actually a warning to show. When RAM is fine
    // (the common case) this stays cheap — just the memory totals, no per-process enumeration.
    let top_consumers = if used_pct >= 80 {
        sys.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::All,
            true,
            sysinfo::ProcessRefreshKind::nothing().with_memory(),
        );
        // Group working sets by process name (e.g. all Chrome helpers into one row).
        let mut by_name: HashMap<String, u64> = HashMap::new();
        for p in sys.processes().values() {
            let name = p.name().to_string_lossy().into_owned();
            *by_name.entry(name).or_insert(0) += p.memory();
        }
        let mut v: Vec<MemConsumer> = by_name
            .into_iter()
            .map(|(name, bytes)| MemConsumer { name, bytes })
            .collect();
        v.sort_by_key(|c| std::cmp::Reverse(c.bytes));
        v.truncate(6);
        v
    } else {
        Vec::new()
    };

    MemoryPressure {
        used_bytes: used,
        total_bytes: total,
        used_pct,
        swap_used_bytes: sys.used_swap(),
        swap_total_bytes: sys.total_swap(),
        level: level.into(),
        advisory,
        top_consumers,
    }
}

// ─── GPU sensors: NVIDIA path (NVML) ─────────────────────────────────────
//
// Compy-safe monitoring: NVML is NVIDIA's vendor-blessed signed library
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
    mark_demand(gpu_demand());
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
        // Idle when neither Monitoring/overlay nor Readiness is reading the GPU — skip the ADLX
        // sensor reads and the FreeSync poll entirely (Readiness marks the GPU demand when active,
        // so its FreeSync read is never starved).
        if poller_idle(gpu_demand()) {
            std::thread::sleep(std::time::Duration::from_millis(1000));
            continue;
        }
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

/// Reduce GPU sensor snapshots to the `(max graphics clock MHz, max temperature °C)` pair the
/// benchmark trial feeds into its throttle/thermal validity gates. Hotspot (junction) temp is
/// preferred over edge temp when present (AMD exposes it; it's the throttle-relevant sensor).
/// Returns `(0.0, 0.0)` when nothing is readable — the verdict engine treats a zero as "no
/// signal" and skips that gate rather than inventing a confound (see `benchmark_verdict::Trial`).
fn reduce_gpu_validity(snaps: &[GpuSensorSnapshot]) -> (f64, f64) {
    let clock = snaps.iter().filter_map(|s| s.graphics_clock_mhz).max().unwrap_or(0) as f64;
    let temp = snaps
        .iter()
        .filter_map(|s| s.hotspot_temperature_c.or(s.temperature_c))
        .max()
        .unwrap_or(0) as f64;
    (clock, temp)
}

/// Live GPU throttle/thermal validity sample for the benchmark trial: `(graphics clock MHz,
/// temperature °C)`, `(0.0, 0.0)` when unreadable. Cheap — reads the cached sensor snapshots.
pub(crate) fn sample_gpu_validity() -> (f64, f64) {
    reduce_gpu_validity(&get_gpu_sensors())
}

#[cfg(test)]
mod gpu_validity_tests {
    use super::*;

    fn snap(clock: Option<u32>, temp: Option<u32>, hotspot: Option<u32>) -> GpuSensorSnapshot {
        GpuSensorSnapshot {
            vendor: "AMD".into(),
            index: 0,
            name: "test".into(),
            temperature_c: temp,
            hotspot_temperature_c: hotspot,
            utilization_gpu_pct: None,
            utilization_memory_pct: None,
            vram_used_bytes: None,
            vram_total_bytes: None,
            graphics_clock_mhz: clock,
            memory_clock_mhz: None,
            power_draw_w: None,
            fan_speed_pct: None,
            fan_speed_rpm: None,
        }
    }

    #[test]
    fn no_snapshots_is_no_signal() {
        // Empty / unreadable → (0,0), which the verdict engine reads as "skip the gate", never a
        // fabricated confound. This is the exact production state the finding was about.
        assert_eq!(reduce_gpu_validity(&[]), (0.0, 0.0));
    }

    #[test]
    fn takes_max_clock_and_prefers_hotspot_over_edge() {
        let snaps = vec![
            snap(Some(2400), Some(60), Some(75)), // hotspot present → 75 wins over edge 60
            snap(Some(2800), Some(58), None),     // no hotspot → falls back to edge 58
        ];
        // Max clock across adapters, max temp preferring hotspot where present.
        assert_eq!(reduce_gpu_validity(&snaps), (2800.0, 75.0));
    }

    #[test]
    fn edge_temp_used_when_no_hotspot() {
        // NVIDIA path: hotspot is always None, so edge temp is the signal.
        assert_eq!(reduce_gpu_validity(&[snap(Some(1900), Some(70), None)]), (1900.0, 70.0));
    }

    #[test]
    fn missing_clock_or_temp_stays_zero() {
        // A snapshot with neither clock nor any temp contributes no signal on that axis.
        assert_eq!(reduce_gpu_validity(&[snap(None, None, None)]), (0.0, 0.0));
    }
}

// ─── FPS / frametime control (elevated helper orchestration) ─────────────
//
// The main app runs unelevated; the ETW capture helper must be elevated.
// We can't kill an elevated process from here, so the lifecycle is managed
// by a heartbeat file: while monitoring is active a background thread
// refreshes it every second; the helper self-exits when it goes stale. The
// helper writes its latest report to a JSON file under LOCALAPPDATA\Compy
// which we read here (same per-user path resolves in both processes).

pub(crate) fn fps_dir() -> PathBuf {
    // Runtime IPC files (fps.json / fps.alive) live in a dedicated `runtime/`
    // subdir under the app data root — NOT %LOCALAPPDATA%\Compy, which is the
    // NSIS install dir, so runtime files never land beside the installed binaries.
    // The Trust Ledger stays directly in the data root (compy_data_dir).
    crate::compy_data_dir().join("runtime")
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
/// True while a spawned `--fps-capture` helper PROCESS is still alive. Distinct from `fps_active`
/// (the "we want capture" intent flag): `stop_fps_capture` clears `fps_active` immediately, but the
/// elevated helper only self-exits on its next poll once the heartbeat goes stale. Tracking real
/// process liveness lets a quick stop→start wait for the old helper to die before spawning a new one,
/// so two elevated helpers never write `fps.json` at once (a non-elevated parent can't kill either).
fn helper_running() -> &'static std::sync::atomic::AtomicBool {
    static R: OnceLock<std::sync::atomic::AtomicBool> = OnceLock::new();
    R.get_or_init(|| std::sync::atomic::AtomicBool::new(false))
}
pub(crate) fn fps_status_slot() -> &'static Mutex<String> {
    static S: OnceLock<Mutex<String>> = OnceLock::new();
    S.get_or_init(|| Mutex::new("idle".to_string()))
}
/// Lock the status slot, recovering from poisoning (audit L1): the slot holds a plain String
/// that is always valid mid-assignment-or-not, so a panicked writer must never cascade-panic
/// every later status read/write — recover the inner value and carry on.
fn lock_status() -> std::sync::MutexGuard<'static, String> {
    fps_status_slot().lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}
pub(crate) fn touch_alive() {
    // The helper checks this file's mtime; the contents don't matter.
    let _ = std::fs::write(fps_alive_path(), b"alive");
}

/// Clean teardown for app exit (Train #3 §1 — clean exit). Stops the FPS heartbeat and drops the
/// `fps.alive` file so the elevated `--fps-capture` helper self-exits on its next poll (~0.5s —
/// `heartbeat_stale` treats a missing file as stale). A non-elevated parent can't kill the elevated
/// helper, so this heartbeat-drop is the shutdown channel. Idempotent + safe when nothing is running.
pub(crate) fn shutdown_for_exit() {
    use std::sync::atomic::Ordering;
    fps_active().store(false, Ordering::Release);
    let _ = std::fs::remove_file(fps_alive_path());
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
    // A quick stop→start can outrace the previous elevated helper's self-exit: `stop_fps_capture`
    // clears the intent flag and drops the heartbeat, but the helper only notices on its next poll.
    // If we re-touched `fps.alive` now, that stale helper would see a fresh heartbeat and keep
    // running alongside the one we're about to spawn — two elevated helpers we can't kill, both
    // writing fps.json. So first give the old helper a bounded window to observe the dropped
    // heartbeat and exit. It clears `helper_running` from its wait thread; best-effort — if it's
    // wedged we proceed after the cap rather than hang the command (no worse than the old behaviour).
    if helper_running().load(Ordering::Acquire) {
        let _ = std::fs::remove_file(fps_alive_path()); // ensure the heartbeat stays dropped while we wait
        for _ in 0..50 {
            if !helper_running().load(Ordering::Acquire) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    let dir = fps_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create data dir: {e}"))?;
    // Drop any stale sample so the UI doesn't briefly show last session's data.
    let _ = std::fs::remove_file(fps_out_path());
    touch_alive();
    fps_active().store(true, Ordering::Release);
    *lock_status() = "starting".into();

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
                helper_running().store(true, Ordering::Release);
                *lock_status() = "running".into();
                // Reflect helper exit (self-exit on heartbeat stale, or crash).
                std::thread::spawn(move || {
                    let _ = child.wait();
                    helper_running().store(false, Ordering::Release);
                    fps_active().store(false, Ordering::Release);
                    *lock_status() = "stopped".into();
                });
            }
            Err(e) => {
                fps_active().store(false, Ordering::Release);
                *lock_status() = format!("failed to launch helper: {e}");
            }
        }
    } else {
        // runas .status() blocks for the helper's lifetime, so run it on a
        // dedicated thread. A declined UAC prompt returns Err quickly.
        //
        // .show(false) => SW_HIDE: launch the elevated helper HIDDEN. The helper
        // never creates a Tauri window (main.rs returns into run_fps_capture
        // before tauri::Builder), but in a debug build compy.exe is a
        // console-subsystem app, so the default SW_NORMAL would pop a visible
        // console running the capture loop. The direct-spawn path above gets the
        // same effect via CREATE_NO_WINDOW; this is the runas equivalent.
        // Optimistically mark a helper live: runas `.status()` blocks for the helper's whole
        // lifetime, so we can't wait for a separate "spawned" signal. A declined UAC returns
        // quickly and clears it again — a brief, harmless true window.
        helper_running().store(true, Ordering::Release);
        std::thread::spawn(move || {
            let res = runas::Command::new(exe)
                .args(&["--fps-capture", "--fps-out", &out, "--fps-alive", &alive])
                .show(false)
                .status();
            helper_running().store(false, Ordering::Release);
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
            *lock_status() = msg.into();
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
            // Stutter Forensics: a read-only per-second timeline (elapsed, 1% low) + a capped log of
            // signals (process starts / RAM 90% / GPU clock drop), analyzed once at finalize. Only
            // runs while monitoring (the user opted in); bounded so it never grows unbounded.
            let mut timeline: Vec<(u32, f64)> = Vec::new();
            let mut events: Vec<crate::stutter::StutterEvent> = Vec::new();
            let mut proc_sys = System::new();
            let mut prev_procs: Option<std::collections::HashSet<String>> = None;
            let mut prev_clock: Option<u32> = None;
            let mut ram_logged = false;
            // OS chatter that constantly starts/stops — never the culprit, would drown the signal.
            let proc_ignore: [&str; 8] = [
                "svchost",
                "conhost",
                "dllhost",
                "runtimebroker",
                "backgroundtaskhost",
                "wmiprvse",
                "taskhostw",
                "searchprotocolhost",
            ];
            while fps_active().load(Ordering::Acquire) {
                std::thread::sleep(std::time::Duration::from_secs(1));
                if !fps_active().load(Ordering::Acquire) {
                    break;
                }
                let elapsed = start.elapsed().as_secs() as u32;
                // Tooltip carry-over: the live tray tooltip reuses this tick's data (no new IPC).
                let mut tip: Option<(f64, f64)> = None;
                if let Ok(txt) = std::fs::read_to_string(fps_out_path()) {
                    if let Ok(s) = serde_json::from_str::<FpsSample>(&txt) {
                        if s.fps > 0.0 {
                            acc.record_fps(&s.process_name, s.fps, s.avg_frametime_ms, s.low1_fps);
                            tip = Some((s.fps, s.low1_fps));
                            if s.low1_fps > 0.0 && timeline.len() < 7200 {
                                timeline.push((elapsed, s.low1_fps));
                            }
                        }
                    }
                }
                let gpus = get_gpu_sensors();
                let gpu_temp = gpus.iter().filter_map(|g| g.temperature_c).max();
                // Update the (opt-in) tray tooltip from data we already have this tick.
                match tip {
                    Some((fps, low1)) => crate::tray::update_live(fps, low1, gpu_temp),
                    None => crate::tray::set_monitoring_on(),
                }
                let gpu_usage = gpus.iter().filter_map(|g| g.utilization_gpu_pct).max();
                let gpu_clock = gpus.iter().filter_map(|g| g.graphics_clock_mhz).max();
                let cpu = get_cpu_sensors();
                acc.record_sensors(
                    gpu_temp,
                    gpu_usage,
                    Some(cpu.ram_used_bytes),
                    Some(cpu.ram_total_bytes),
                );

                // ── Stutter signals (capped at 50, read-only) ──
                if events.len() < 50 {
                    if !ram_logged
                        && cpu.ram_total_bytes > 0
                        && cpu.ram_used_bytes as f64 / cpu.ram_total_bytes as f64 >= 0.90
                    {
                        events.push(crate::stutter::StutterEvent {
                            at_secs: elapsed,
                            kind: "ram".into(),
                            label: "RAM filling up (90%+)".into(),
                        });
                        ram_logged = true;
                    }
                    // GPU clock drop ONLY while busy — a sharp drop under load is throttling; a drop
                    // at low utilization is just normal idle downclock, not a stutter cause.
                    if let (Some(prev), Some(now)) = (prev_clock, gpu_clock) {
                        let dropped = prev > 0 && (now as f64) < (prev as f64) * 0.8;
                        let busy = gpu_usage.is_some_and(|u| u >= 80);
                        if dropped && busy {
                            events.push(crate::stutter::StutterEvent {
                                at_secs: elapsed,
                                kind: "gpu-clock".into(),
                                label: "a GPU clock drop under load".into(),
                            });
                        }
                    }
                    prev_clock = gpu_clock.or(prev_clock);
                    // Process starts: a names-only diff every tick (1 Hz, only while capturing),
                    // skipping OS chatter so the insight never degrades to "svchost did it".
                    proc_sys.refresh_processes_specifics(
                        sysinfo::ProcessesToUpdate::All,
                        true,
                        sysinfo::ProcessRefreshKind::nothing(),
                    );
                    let names: std::collections::HashSet<String> = proc_sys
                        .processes()
                        .values()
                        .map(|p| p.name().to_string_lossy().into_owned())
                        .collect();
                    if let Some(prev) = &prev_procs {
                        let new: Vec<&String> = names.difference(prev).collect();
                        // One launch is a signal; a big burst (login/boot) isn't a single culprit.
                        if new.len() <= 4 {
                            for n in new {
                                let lower = n.to_lowercase();
                                let base = lower.strip_suffix(".exe").unwrap_or(&lower);
                                if base == "compy" || proc_ignore.contains(&base) {
                                    continue;
                                }
                                events.push(crate::stutter::StutterEvent {
                                    at_secs: elapsed,
                                    kind: "process-start".into(),
                                    label: format!("{n} starting"),
                                });
                            }
                        }
                    }
                    prev_procs = Some(names);
                }
            }
            if acc.has_data() {
                let mut summary = acc.finalize(start.elapsed().as_secs());
                summary.hw_fingerprint = Some(crate::hardware::current_fingerprint());
                summary.stutter_insight = crate::stutter::analyze(&timeline, &events);
                summary.stutter_timeline = timeline;
                summary.stutter_events = events;
                let game = summary.process_name.clone();
                // Only a real (saved) session fires the "debrief ready" toast — never a short blip.
                if matches!(crate::sessions::save_session(summary), Ok(true)) {
                    crate::notify_debrief_ready(&game);
                }
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
    *lock_status() = "idle".into();
    let _ = std::fs::remove_file(fps_alive_path());
    let _ = std::fs::remove_file(fps_out_path());
    crate::tray::set_idle();
}

/// Latest captured frametimes for the active game (process name + per-frame ms), if the FPS
/// helper is running and a fresh (<3 s) sample exists. The benchmark trial runner reads this to
/// build MetricWindows. `None` when nothing is being captured (no game / capture off).
pub(crate) fn latest_frametimes() -> Option<(String, Vec<f64>)> {
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
    let s: FpsSample = serde_json::from_slice(&bytes).ok()?;
    Some((s.process_name, s.recent_frametimes_ms))
}

#[tauri::command]
pub(crate) fn get_fps_status() -> FpsStatus {
    use std::sync::atomic::Ordering;
    let active = fps_active().load(Ordering::Acquire);
    let status = lock_status().clone();
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
// Compy-safe constraint: this is a normal top-level window, so it draws
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
    // Stranded-overlay fix: after a primary-display reshuffle (e.g. a FreeSync OSD toggle swaps
    // display indices) the overlay can sit on a monitor that no longer hosts the game and never
    // come home. If it isn't on the primary, pull it there now ("top-left" = the frontend's
    // default corner; the frontend re-applies the persisted corner right after show, which now
    // also anchors to primary). Best-effort — a positioning failure must never block show.
    if let (Ok(Some(primary)), Ok(Some(current))) = (w.primary_monitor(), w.current_monitor()) {
        if primary.position() != current.position() {
            let _ = position_overlay(&w, "top-left");
        }
    }
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

/// Pure corner math (physical pixels, DPI-scaled margin): the overlay's top-left for a given
/// corner of a monitor rect. Extracted so both anchor paths (set_overlay_corner, show_overlay)
/// share ONE computation and it stays unit-testable against arbitrary monitor origins
/// (multi-monitor offsets, negative coordinates). Math byte-identical to the pre-fix inline form.
fn corner_position(
    corner: &str,
    mpos: (i32, i32),
    msize: (u32, u32),
    wsize: (u32, u32),
    scale: f64,
) -> Result<(i32, i32), String> {
    let margin = (24.0 * scale).round() as i32;
    let left = mpos.0 + margin;
    let top = mpos.1 + margin;
    let right = mpos.0 + (msize.0 as i32 - wsize.0 as i32 - margin).max(margin);
    let bottom = mpos.1 + (msize.1 as i32 - wsize.1 as i32 - margin).max(margin);
    match corner {
        "top-left" => Ok((left, top)),
        "top-right" => Ok((right, top)),
        "bottom-left" => Ok((left, bottom)),
        "bottom-right" => Ok((right, bottom)),
        other => Err(format!("unknown corner: {other}")),
    }
}

/// Anchor the overlay to `corner` of the PRIMARY monitor — where the game runs. Falls back to
/// the overlay's current monitor only when no primary is reported. Anchoring to primary (not
/// `current_monitor`) is the stranded-overlay fix: after a primary-display reshuffle "current"
/// is the stale screen, so corner math computed there could never bring the overlay home.
fn position_overlay(w: &tauri::WebviewWindow, corner: &str) -> Result<(), String> {
    let monitor = match w.primary_monitor() {
        Ok(Some(m)) => m,
        _ => w
            .current_monitor()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "no monitor for the overlay".to_string())?,
    };
    let wsize = w.outer_size().map_err(|e| e.to_string())?;
    let (x, y) = corner_position(
        corner,
        (monitor.position().x, monitor.position().y),
        (monitor.size().width, monitor.size().height),
        (wsize.width, wsize.height),
        monitor.scale_factor(),
    )?;
    w.set_position(tauri::PhysicalPosition::new(x, y)).map_err(|e| e.to_string())
}

/// Reposition the overlay to a screen corner: "top-left" | "top-right" | "bottom-left" |
/// "bottom-right". Computed in physical pixels off the PRIMARY monitor (DPI-safe), with a
/// margin. The frontend persists the choice and re-applies it on show.
#[tauri::command]
pub(crate) fn set_overlay_corner(app: tauri::AppHandle, corner: String) -> Result<(), String> {
    use tauri::Manager;
    let w = app
        .get_webview_window("overlay")
        .ok_or_else(|| "overlay window not found".to_string())?;
    position_overlay(&w, &corner)
}

#[cfg(test)]
mod overlay_corner_tests {
    use super::corner_position;

    // 2560x1440 monitor at a given origin, 300x120 overlay, scale 1.0 → margin 24.
    const MSIZE: (u32, u32) = (2560, 1440);
    const WSIZE: (u32, u32) = (300, 120);

    #[test]
    fn corners_compute_from_the_given_monitor_origin() {
        // Primary at (0,0).
        assert_eq!(corner_position("top-left", (0, 0), MSIZE, WSIZE, 1.0), Ok((24, 24)));
        assert_eq!(
            corner_position("bottom-right", (0, 0), MSIZE, WSIZE, 1.0),
            Ok((2560 - 300 - 24, 1440 - 120 - 24))
        );
        // The same corner on a monitor whose origin is offset (a second display to the right) —
        // the stranded-bug regression shape: the math must follow the GIVEN monitor's origin.
        assert_eq!(
            corner_position("top-left", (2560, 0), MSIZE, WSIZE, 1.0),
            Ok((2560 + 24, 24))
        );
        // Negative origin (a display arranged left of primary) stays correct in i32 space.
        assert_eq!(
            corner_position("top-right", (-2560, 0), MSIZE, WSIZE, 1.0),
            Ok((-2560 + 2560 - 300 - 24, 24))
        );
    }

    #[test]
    fn margin_scales_with_dpi_and_small_monitors_clamp() {
        // 150% scale → margin 36.
        assert_eq!(corner_position("top-left", (0, 0), MSIZE, WSIZE, 1.5), Ok((36, 36)));
        // Pathologically small monitor: right/bottom clamp to the margin, never negative drift.
        assert_eq!(
            corner_position("bottom-right", (0, 0), (100, 100), WSIZE, 1.0),
            Ok((24, 24))
        );
    }

    #[test]
    fn unknown_corner_is_an_error() {
        assert!(corner_position("center", (0, 0), MSIZE, WSIZE, 1.0).is_err());
    }
}

#[cfg(test)]
mod runtime_dir_tests {
    use super::*;

    #[test]
    fn fps_runtime_dir_is_separate_from_install_dir() {
        let d = fps_dir();
        // Dedicated runtime/ subdir, under the app data root (same root as the
        // Trust Ledger) but distinct from the bare data dir — so it is never the
        // install dir (%LOCALAPPDATA%\Compy) nor beside the installed binaries.
        assert!(d.ends_with("runtime"), "fps_dir should be a dedicated runtime dir: {d:?}");
        assert!(
            d.starts_with(crate::compy_data_dir()),
            "fps_dir should be under the data root"
        );
        assert_ne!(
            d,
            crate::compy_data_dir(),
            "runtime dir must be distinct from the ledger dir"
        );
        assert!(fps_out_path().starts_with(&d));
        assert!(fps_alive_path().starts_with(&d));
    }
}
