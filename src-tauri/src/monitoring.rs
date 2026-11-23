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

use crate::capture::CaptureBackend; // the capture-backend boundary (Measurement Platform 2.0)
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

#[tauri::command]
pub(crate) fn get_memory_pressure() -> MemoryPressure {
    use std::collections::HashMap;
    // Memory totals only: a fresh System per call keeps no state (and no lock is held across the snapshot below);
    // it never refreshes processes.
    let mut sys = System::new();
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
        // Handle-free snapshot (no process is opened). If it cannot be read the list is empty:
        // "couldn't list" shows no rows, never invented ones.
        // Group working sets by process name (e.g. all Chrome helpers into one row).
        let mut by_name: HashMap<String, u64> = HashMap::new();
        for p in crate::other_load::read_process_rows().unwrap_or_default() {
            *by_name.entry(p.label()).or_insert(0) += p.working_set;
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
// We can't kill an elevated process from here. Hardening slice 2: the helper
// talks to the app over a named pipe the app creates for each launch
// (fps_pipe.rs); the app writes each report line to fps.json itself, as the
// user, and the readers below read that file as they always did. The pipe is
// also the lifecycle: when the app closes its end (stop, exit, crash), the
// helper's next write fails and it exits. The helper writes no file.

pub(crate) fn fps_dir() -> PathBuf {
    // Runtime IPC files (fps.json and its marker) live in a dedicated `runtime/`
    // subdir under the app data root — NOT %LOCALAPPDATA%\Compy, which is the
    // NSIS install dir, so runtime files never land beside the installed binaries.
    // The Trust Ledger stays directly in the data root (compy_data_dir).
    crate::compy_data_dir().join("runtime")
}
pub(crate) fn fps_out_path() -> PathBuf {
    fps_dir().join("fps.json")
}
/// The helper's unreadable-tick marker (`fps::UNREADABLE_SUFFIX`): written (by the app, from the helper's
/// pipe line) on every tick on which the helper could not read the process snapshot, holding the
/// cumulative count of such ticks.
pub(crate) fn fps_unreadable_path() -> PathBuf {
    PathBuf::from(format!("{}{}", fps_out_path().display(), crate::fps::UNREADABLE_SUFFIX))
}

/// How recent the helper's marker must be to say "this second". The helper ticks every 500 ms, so a
/// marker older than this was not written by the tick that just passed.
const UNREADABLE_FRESH: std::time::Duration = std::time::Duration::from_secs(2);

/// What the helper's marker says about the current moment. `now` = the helper could not read the
/// process snapshot on its latest tick, so this second is "Compy couldn't read it", never "no frames"
/// and never 0 fps. `ticks` = the helper's cumulative count (0 when it never missed).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct UnreadRead {
    pub(crate) ticks: u64,
    pub(crate) now: bool,
}

/// PURE: the marker file's text as a count. Anything but a whole number is no count.
pub(crate) fn parse_unreadable_ticks(txt: &str) -> Option<u64> {
    txt.trim().parse().ok()
}

/// PURE: read the marker. `marker_age` is how old the marker file is (`None` = no marker), `sample_age`
/// how old fps.json is (`None` = none yet). `now` holds only while the marker is fresh AND newer than
/// the last report, so a helper that has recovered (it rewrote fps.json after the marker) reads as
/// readable at once, and a marker left behind reads as stale. `ticks` is the larger of the marker's
/// count and the one the last report carried (`sample_ticks`).
pub(crate) fn unreadable_read(
    marker_ticks: Option<u64>,
    marker_age: Option<std::time::Duration>,
    sample_age: Option<std::time::Duration>,
    sample_ticks: u64,
) -> UnreadRead {
    let now = marker_age.is_some_and(|m| m < UNREADABLE_FRESH && sample_age.is_none_or(|s| s > m));
    UnreadRead { ticks: marker_ticks.unwrap_or(0).max(sample_ticks), now }
}

/// PURE: what one recorder second does with the report on disk. While the helper could not read the
/// snapshot (`unread.now`) the report is withheld (it is older than the marker, so it is not this
/// second's) and the second is flagged unreadable; otherwise the report passes through unchanged.
pub(crate) fn gate_unreadable<T>(sample: Option<T>, unread: UnreadRead) -> (Option<T>, bool) {
    if unread.now {
        (None, true)
    } else {
        (sample, false)
    }
}

/// PURE: one recorder second, reader side. What the helper left on disk (its report, the marker's count and
/// age, the report's age) becomes the report this second may record (withheld while the snapshot is
/// unreadable), whether the second is flagged unreadable, and the unreadable read itself.
pub(crate) fn unreadable_second<T>(
    parsed: Option<T>,
    report_ticks: u64,
    marker_ticks: Option<u64>,
    marker_age: Option<std::time::Duration>,
    sample_age: Option<std::time::Duration>,
) -> (Option<T>, bool, UnreadRead) {
    let unread = unreadable_read(marker_ticks, marker_age, sample_age, report_ticks);
    let (sample, flagged) = gate_unreadable(parsed, unread);
    (sample, flagged, unread)
}

/// PURE glue: hands one second's unreadable read to the open session's accumulator and says whether the
/// live progress must be refreshed. The session's count is the helper's own cumulative counter (a delta
/// since this session's last look), never the yes/no flag, which sees about half the half-second ticks.
pub(crate) fn feed_unreadable(acc: &mut crate::sessions::SessionAccumulator, unread: UnreadRead, flagged: bool) -> bool {
    let added = acc.observe_unreadable_counter(unread.ticks);
    flagged || added > 0
}

/// The marker as it is on disk: its count (if readable) and its age (if present).
fn read_marker() -> (Option<u64>, Option<std::time::Duration>) {
    let path = fps_unreadable_path();
    let age = std::fs::metadata(&path).ok().and_then(|m| m.modified().ok()).and_then(|m| m.elapsed().ok());
    let ticks = age.and_then(|_| std::fs::read_to_string(&path).ok()).and_then(|t| parse_unreadable_ticks(&t));
    (ticks, age)
}

/// How old fps.json is, if it exists.
fn sample_age() -> Option<std::time::Duration> {
    std::fs::metadata(fps_out_path()).ok().and_then(|m| m.modified().ok()).and_then(|m| m.elapsed().ok())
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
/// Which capture the running threads belong to (codebase review 2026-11-02). `stop_fps_capture`
/// only clears `fps_active`, and each thread reads it after a 1 s sleep, so a start inside that second
/// set it back and the old recorder ran on beside the new one: two recorders, the same play saved as
/// two sessions, and the old helper's wait thread could clear the new capture's flag. Every thread
/// now also checks that its capture is still the current one.
fn capture_gen() -> &'static std::sync::atomic::AtomicU64 {
    static G: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    &G
}
/// The capture `generation` was started as is still the current one.
fn capture_current(generation: u64) -> bool {
    capture_gen().load(std::sync::atomic::Ordering::Acquire) == generation
}
/// The capture `generation` was started as is still running.
fn capture_live(generation: u64) -> bool {
    fps_active().load(std::sync::atomic::Ordering::Acquire) && capture_current(generation)
}
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
/// P5-enough: what the running capture has measured so far, written by the 1 Hz session recorder
/// and read by `get_fps_status`. In memory only; a plain value, so a poisoned lock just recovers it.
fn lock_progress() -> std::sync::MutexGuard<'static, Option<crate::sessions::CaptureProgress>> {
    static P: OnceLock<Mutex<Option<crate::sessions::CaptureProgress>>> = OnceLock::new();
    P.get_or_init(|| Mutex::new(None)).lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}
/// Clean teardown for app exit (Train #3 §1 — clean exit). Clears the capture flag: the pipe's reader
/// thread sees it at the helper's next line (within ~0.5 s) and closes the pipe, and the elevated
/// `--fps-capture` helper exits at its next write. If the app exits first, Windows closes the pipe with
/// the process, which ends the helper the same way. A non-elevated parent can't kill the elevated
/// helper, so closing the pipe is the shutdown channel. Idempotent + safe when nothing is running.
pub(crate) fn shutdown_for_exit() {
    use std::sync::atomic::Ordering;
    fps_active().store(false, Ordering::Release);
}

/// One launch's pipe: its name (for the helper's argv), the pid the launch started (0 until the launch
/// reports it), and a flag the launch sets once its helper process has ended, so a reader still waiting
/// for a client stops waiting.
struct CapturePipe {
    name: String,
    launched: std::sync::Arc<std::sync::atomic::AtomicU32>,
    done: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl CapturePipe {
    fn argv(&self) -> [String; 5] {
        helper_argv(&self.name, std::process::id())
    }

    /// The launch started its helper as `pid` (the `Child`'s id, or the elevated process handle's pid).
    /// The launch holds that process until it ends, so the pid is not reused meanwhile. Review r1 B5:
    /// the reader accepts exactly this pid as its client.
    fn launched_as(&self, pid: u32) {
        self.launched.store(pid, std::sync::atomic::Ordering::Release);
    }

    /// The helper process this pipe was made for has ended: stop the reader if it is still waiting for
    /// a client (it never connected), by flagging it and connecting once to wake it.
    fn finished(&self) {
        self.done.store(true, std::sync::atomic::Ordering::Release);
        crate::fps_pipe::wake(&self.name);
    }
}

/// Create a fresh pipe for one helper launch and start its reader thread. The reader accepts only the
/// exact process this launch started, running Compy's image name (`fps_pipe::is_our_helper`), and while
/// this capture is live and the launch has not ended, writes each report line to fps.json and each
/// count to the marker, as the user (`relay_line`). It ends when the helper closes its end, at an
/// over-long line, or at the first line after the capture stops; dropping the pipe then is what ends the
/// helper.
fn start_capture_pipe(generation: u64) -> Result<CapturePipe, String> {
    let pipe = crate::fps_pipe::ServerPipe::create().map_err(|e| format!("could not create the capture pipe: {e}"))?;
    let done = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let launched = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
    let handle = CapturePipe { name: pipe.name.clone(), launched: launched.clone(), done: done.clone() };
    std::thread::spawn(move || {
        let (out, marker) = (fps_out_path(), fps_unreadable_path());
        let wanted = || reader_wants(fps_active(), capture_gen(), generation, &done);
        let client_ok = |pid: u32| {
            let ok = crate::fps_pipe::is_our_helper(pid, &launched);
            if ok {
                // Review r2 N1: the one line an owner check can look for (Settings, Support record).
                support_record(
                    SupportOutcome::Ok,
                    "pipe_client_accepted",
                    "the capture helper connected to Compy's pipe, and it is the process Compy started",
                );
            }
            ok
        };
        let mut counts = RelayCounts::default();
        let _ = pipe.serve(&wanted, &client_ok, &mut |line| {
            write_while_wanted(relay_writes(), &wanted, || relay_line(line, &mut counts, &out, &marker));
        });
    });
    Ok(handle)
}

/// Does a reader of capture `generation` still want the helper's lines? Capture on, still the current
/// capture, and its launch not ended. Over its inputs (the process-wide flag and counter in production,
/// local ones in the tests), so a stale reader can be driven end to end (review r2 N4). SeqCst loads:
/// see `write_while_wanted`.
fn reader_wants(
    active: &std::sync::atomic::AtomicBool,
    current: &std::sync::atomic::AtomicU64,
    generation: u64,
    done: &std::sync::atomic::AtomicBool,
) -> bool {
    use std::sync::atomic::Ordering::{Acquire, SeqCst};
    active.load(SeqCst) && current.load(SeqCst) == generation && !done.load(Acquire)
}

/// Relay writes in progress, across every pipe reader (review r2 N5). An atomic counter, not a lock.
fn relay_writes() -> &'static std::sync::atomic::AtomicU32 {
    static W: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
    &W
}

/// Run `write` only if `wanted()` still holds, announcing the write in `in_flight` FIRST (review r2 N5).
/// With `stop_fps_capture_locked` clearing the flag (SeqCst) and then waiting for `in_flight` to reach 0
/// (SeqCst) before it removes fps.json, the two cannot interleave: either this check sees the capture
/// stopped and writes nothing, or the stop sees this write in flight and waits for it, then removes the
/// file. So no fps.json is written after a stop has removed it. True when it wrote.
fn write_while_wanted(in_flight: &std::sync::atomic::AtomicU32, wanted: &dyn Fn() -> bool, write: impl FnOnce()) -> bool {
    use std::sync::atomic::Ordering::SeqCst;
    in_flight.fetch_add(1, SeqCst);
    let go = wanted();
    if go {
        write();
    }
    in_flight.fetch_sub(1, SeqCst);
    go
}

/// After the flag is cleared: wait (at most `max`) until no relay write is in flight. True when none is.
/// A relay write is one small file write and a rename, so the wait is normally nothing.
fn wait_for_relay_writes(in_flight: &std::sync::atomic::AtomicU32, max: std::time::Duration) -> bool {
    let until = std::time::Instant::now() + max;
    while in_flight.load(std::sync::atomic::Ordering::SeqCst) != 0 {
        if std::time::Instant::now() >= until {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(2));
    }
    true
}

/// The two running counts one helper sends: ticks whose snapshot it could not read, and lines its queue
/// had to drop.
#[derive(Default, Debug, PartialEq, Eq)]
struct RelayCounts {
    unreadable: u64,
    dropped: u64,
}

/// What the app does with one helper line. A report replaces fps.json; a count replaces the marker
/// (each written beside itself and renamed over, so a reader never sees half a file); a keepalive and
/// anything else write nothing. This is exactly what the helper used to write itself, now written by the
/// app with the user's own rights.
///
/// The marker holds the unreadable count PLUS the dropped-line count (review r1, non-blocking): a tick
/// whose line was dropped is one Compy could not deliver, so it reads like an unreadable tick ("Compy
/// couldn't read this second", counted as unmeasured), never as "no frames" and never silently lost.
/// With nothing dropped the marker is exactly the helper's old count.
fn relay_line(line: crate::fps_pipe::Line, counts: &mut RelayCounts, out: &std::path::Path, marker: &std::path::Path) {
    use crate::fps_pipe::Line;
    match line {
        Line::Report(json) => write_replacing(out, &json),
        Line::Unreadable(n) => {
            counts.unreadable = counts.unreadable.max(n);
            write_replacing(marker, &(counts.unreadable + counts.dropped).to_string());
        }
        Line::Dropped(n) if n > counts.dropped => {
            counts.dropped = n;
            write_replacing(marker, &(counts.unreadable + counts.dropped).to_string());
        }
        Line::Dropped(_) | Line::Alive | Line::Junk => {}
    }
}

/// Write `<path>.tmp`, then rename it over `path` (the same names the helper used to write).
fn write_replacing(target: &std::path::Path, contents: &str) {
    let path = target.display().to_string();
    let tmp = format!("{path}.tmp");
    if std::fs::write(&tmp, contents).is_ok() {
        let _ = std::fs::rename(&tmp, target);
    }
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
    /// Helper's read of whether the game window was in front (P4-comparable). Missing (older
    /// helper) or `None` = unknown, which is measured as before; only `Some(false)` is left out
    /// (`SessionAccumulator::record_tick`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    foreground: Option<bool>,
    /// P4-smooth-measure: the helper's cumulative frame-time histogram for the reported chain.
    /// Missing on an older helper's line (the session then records no frame pacing). Read by the
    /// session recorder only; never sent on to the UI (`skip_serializing`), which has no use for it.
    #[serde(default, skip_serializing)]
    frame_hist: Option<crate::fps::FrameHistWire>,
    /// The helper's cumulative count of ticks that could not read the process snapshot (omitted by
    /// the helper while 0, so it reads 0 here). Missing on an older helper's line = 0 = nothing said.
    /// Read through [`unreadable_read`]; never sent to the UI (the status carries the readout).
    #[serde(default, skip_serializing)]
    snapshot_unreadable_ticks: u64,
}

#[derive(Serialize)]
pub(crate) struct FpsStatus {
    active: bool,
    status: String,
    sample: Option<FpsSample>,
    /// P5-guided: is the game Compy last measured still running? `Some(true)` while its readings are
    /// fresh, or while they have stopped but its process is still there (paused, minimised, a menu
    /// that presents nothing); `Some(false)` only when that process is gone (or its id now belongs to
    /// another program). `None` = unknown: nothing measured yet this capture, or the process couldn't
    /// be checked. Additive: an older build's reader ignores it. Read-only.
    #[serde(skip_serializing_if = "Option::is_none")]
    game_running: Option<bool>,
    /// P5-enough: the readings this capture has measured so far (background ticks never count) and
    /// its 10 s fps buckets, so the guided journey can say when the session has enough. Absent while
    /// capture is off or before the recorder's first tick. Additive and read-only.
    #[serde(skip_serializing_if = "Option::is_none")]
    progress: Option<crate::sessions::CaptureProgress>,
    /// M6-unread: the helper could not read the process snapshot on its latest tick, so Compy
    /// couldn't read THIS second. `sample` is withheld then (a report up to 3 s old would read as
    /// live), and the UI says so instead of showing 0 fps or "no frames". Omitted while false.
    #[serde(skip_serializing_if = "is_false")]
    unreadable_now: bool,
    /// M6-unread: how many ticks the helper has been unable to read the snapshot since it started
    /// (cumulative, half-second ticks). Omitted while 0. Additive: an older reader ignores it.
    #[serde(skip_serializing_if = "is_zero_u64")]
    unreadable_ticks: u64,
    /// D1-S1: true when this PC's sign-in already lets Compy start the measurement without a Windows
    /// administrator prompt (the account's token carries the enabled "Performance Log Users" group)
    /// and no start without a prompt has failed since. Read-only; omitted while false (an older build
    /// never sends it; both read as "nothing to say").
    #[serde(skip_serializing_if = "is_false")]
    prompt_free: bool,
}

fn is_zero_u64(n: &u64) -> bool {
    *n == 0
}

fn is_false(b: &bool) -> bool {
    !*b
}

/// PURE (P5-guided): whether the game behind the helper's last line is still running. `last` is the
/// last line the helper wrote this capture (fresh or not), `fresh` whether it is under 3 s old, and
/// `probe` checks a pid against the process name it was measured as. A fresh line is a running game
/// without asking; a line with no pid or name says nothing.
fn game_running_from(
    last: Option<&FpsSample>,
    fresh: bool,
    probe: impl Fn(u32, &str) -> Option<bool>,
) -> Option<bool> {
    let s = last?;
    if fresh {
        return Some(true);
    }
    if s.pid == 0 || s.process_name.trim().is_empty() {
        return None;
    }
    probe(s.pid, &s.process_name)
}

/// Read-only: is `pid` still a live process whose image is `expected_name`? `Some(false)` when the
/// pid no longer exists, has exited, or now runs another image (Windows reuses pids); `None` when
/// the handle-free process snapshot could not be read, which must never read as "the game closed".
/// Opens no process: it asks the same system-wide snapshot as the rest of the capture
/// ([`crate::other_load::running_as`]).
fn pid_running_as(pid: u32, expected_name: &str) -> Option<bool> {
    crate::other_load::running_as(crate::other_load::read_process_rows().as_deref(), pid, expected_name)
}

// Support evidence for the FPS helper (spec §12). The helper is the one part of Compy that can
// fail silently from the user's side: the button does not stick, and start / clean-exit / crash /
// declined-UAC all look identical in the UI. These two shims keep the emission calls below to one
// line each; the detail strings are hand-written prose, never a command line — a raw argv could
// carry the user's paths, and the store's own redaction is the second gate, not the first.
use crate::support_evidence::Outcome as SupportOutcome;

fn support_record(outcome: SupportOutcome, code: &str, detail: &str) {
    crate::support_evidence::record(
        crate::support_evidence::EventKind::Helper,
        "fps_helper_start",
        code,
        outcome,
        detail,
    );
}

fn support_stop(outcome: SupportOutcome, code: &str, detail: &str) {
    crate::support_evidence::record(
        crate::support_evidence::EventKind::Helper,
        "fps_helper_stop",
        code,
        outcome,
        detail,
    );
}

/// CR-capture-async: start and stop take turns. Both commands now run on the blocking pool
/// (lib.rs `off_main`), so without this a stop pressed while a start waits up to 5 s for an old
/// helper could run first, and the start would then raise the flag and launch a helper after the
/// user had stopped. Under one lock a stop always sees a start that has finished (or failed) and
/// undoes it; a start never sees half a stop. A panic in either leaves the lock usable.
///
/// CR-capture-last-wins: the lock is not FIFO, so with a start holding it a later stop and a later
/// start could take it in either order, and start(pending) → stop → start could end off. The lock
/// holds the newest request ticket applied so far; each request takes its ticket when it is
/// invoked ([`capture_ticket`], before it reaches the blocking pool) and, under the lock, one
/// older than the newest applied is skipped: the user's last press wins.
fn capture_ctl() -> &'static std::sync::Mutex<u64> {
    use std::sync::{Mutex, OnceLock};
    static CTL: OnceLock<Mutex<u64>> = OnceLock::new();
    CTL.get_or_init(|| Mutex::new(0))
}

/// The next capture request ticket, in invoke order (starts at 1).
pub(crate) fn capture_ticket() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    NEXT.fetch_add(1, Ordering::SeqCst) + 1
}

/// Run `f` holding the capture start/stop lock unless a newer request (higher ticket) already
/// ran; then answer `superseded()`, read under the same lock, and change nothing. A panic in `f`
/// still counts its ticket.
fn capture_in_order<T>(ticket: u64, superseded: impl FnOnce() -> T, f: impl FnOnce() -> T) -> T {
    in_order_on(capture_ctl(), ticket, superseded, f)
}

/// [`capture_in_order`] on a given lock, so tests can use their own instead of the process one.
fn in_order_on<T>(
    lock: &std::sync::Mutex<u64>,
    ticket: u64,
    superseded: impl FnOnce() -> T,
    f: impl FnOnce() -> T,
) -> T {
    let mut newest = lock.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if ticket < *newest {
        return superseded();
    }
    *newest = ticket;
    f()
}

/// Start FPS capture with a fresh ticket. Test-only: the window's command takes its ticket at
/// invoke time and calls the ticketed form; lib.rs's answer-type test still checks this one.
#[cfg(test)]
pub(crate) fn start_fps_capture() -> Result<(), String> {
    start_fps_capture_ticketed(capture_ticket())
}

/// Start FPS capture as request `ticket`. Served to the window by lib.rs
/// `off_main::start_fps_capture`, off the main thread; same answer as before. Superseded by a
/// newer request, what the user pressed last already ran: see [`superseded_start`].
pub(crate) fn start_fps_capture_ticketed(ticket: u64) -> Result<(), String> {
    capture_in_order(ticket, superseded_start, start_fps_capture_locked)
}

/// The answer a start skipped for a newer request gives, which the window can tell apart
/// (`src/surfaces/GuidedJourney.tsx` `CAPTURE_SUPERSEDED`).
pub(crate) const CAPTURE_SUPERSEDED: &str = "capture-superseded";

/// CR-capture-superseded: read under the capture lock, after the newer request ran. A newer start
/// left capture on, so this start's wish holds: Ok. A newer stop left it off: a distinct Err, never
/// an Ok that lets the window believe capture is on when it is off. The answer is the flag at read
/// time: a helper exit clears it without the lock, and then "not running" is still the truth.
fn superseded_start() -> Result<(), String> {
    use std::sync::atomic::Ordering;
    superseded_start_answer(fps_active().load(Ordering::Acquire))
}

/// [`superseded_start`] with the capture flag handed in. Pure.
fn superseded_start_answer(capture_on: bool) -> Result<(), String> {
    if capture_on {
        Ok(())
    } else {
        Err(CAPTURE_SUPERSEDED.to_string())
    }
}

/// PURE: the capture status after the elevated helper's launch ended. A clean exit is "stopped";
/// `elevate_and_wait`'s own refusal (a target that is not Compy's exe: InvalidInput with no OS error
/// code) never showed a prompt, so it is a failed launch, never "declined" (a1b review). The helper's
/// own refusals (review r1 B1: exit 2, its arguments were refused; exit 4, it could not confirm the pipe
/// was Compy's) come AFTER the user approved the prompt, so they are failed launches too, never
/// "declined". Anything else keeps today's coarse "declined".
fn elevated_helper_status(res: &std::io::Result<std::process::ExitStatus>) -> String {
    match res {
        Ok(s) if s.success() => "stopped".to_string(),
        Err(e) if e.kind() == std::io::ErrorKind::InvalidInput && e.raw_os_error().is_none() => {
            format!("failed to launch helper: {e}")
        }
        Ok(s) => match helper_refusal(s.code()) {
            Some(why) => format!("failed to launch helper: {why}"),
            None => "declined".to_string(),
        },
        _ => "declined".to_string(),
    }
}

/// PURE: what a helper exit code means when it is one of the helper's own refusals (nothing was
/// started in either case). `None` for any other code.
fn helper_refusal(code: Option<i32>) -> Option<&'static str> {
    match code {
        Some(crate::fps::EXIT_PIPE_NOT_CONFIRMED) => Some("the capture helper could not confirm it was talking to Compy"),
        Some(crate::fps::EXIT_REFUSED_ARGS) => Some("the capture helper refused its arguments"),
        _ => None,
    }
}

/// The elevated launch of the capture helper (UAC "runas"). D1-S1 moved it into a function, unchanged,
/// so the start without a prompt can fall back to it.
fn launch_elevated_helper(exe: std::path::PathBuf, generation: u64) {
    use std::sync::atomic::Ordering;
    // Hardening slice 2: a fresh pipe for this launch; the helper gets its name and our pid, no path.
    let pipe = match start_capture_pipe(generation) {
        Ok(p) => p,
        Err(e) => {
            if capture_current(generation) {
                fps_active().store(false, Ordering::Release);
                *lock_status() = format!("failed to launch helper: {e}");
            }
            support_record(SupportOutcome::Failed, "pipe_failed", &format!("the capture pipe could not be created: {e}"));
            return;
        }
    };
    // elevate_and_wait blocks for the helper's lifetime, so run it on a
    // dedicated thread. A declined UAC prompt returns Err(os error 1223) quickly.
    //
    // The launcher runs SW_HIDE: the helper never creates a Tauri window
    // (main.rs returns into run_fps_capture before tauri::Builder), but in a
    // debug build compy.exe is a console-subsystem app, so the default
    // SW_NORMAL would pop a visible console running the capture loop. The
    // UAC-off direct spawn gets the same effect via CREATE_NO_WINDOW.
    // Optimistically mark a helper live: the wait blocks for the helper's whole
    // lifetime, so we can't wait for a separate "spawned" signal. A declined UAC returns
    // quickly and clears it again — a brief, harmless true window.
    helper_running().store(true, Ordering::Release);
    std::thread::spawn(move || {
        use std::ffi::OsStr;
        let argv = pipe.argv();
        // Review r2 N2: the reader is told the helper ended (`finished`) while the launch still holds the
        // helper's process handle, so its pid cannot belong to another process yet. The second call
        // below covers a launch that never started a process (idempotent).
        let res = crate::actions::elevate_and_wait_with(
            exe.as_os_str(),
            &argv.each_ref().map(OsStr::new),
            |pid| pipe.launched_as(pid),
            || pipe.finished(),
        );
        pipe.finished();
        helper_running().store(false, Ordering::Release);
        // Only this capture's flag and status, as the direct-spawn wait above.
        let current = capture_current(generation);
        if current {
            fps_active().store(false, Ordering::Release);
        }
        // Distinguish a cancelled/failed elevation from a clean stop. Since 2026-07-14
        // the launcher is our own elevate_and_wait (the runas crate it replaced ALWAYS
        // returned Ok on Windows, so a cancel arrived as Ok(!0) and the Err arm was dead).
        // Now a real UAC decline is Err(os error 1223); a helper that ran and died also
        // maps to "declined" — same coarse UI state as before, no false "stopped".
        let msg = elevated_helper_status(&res);
        if current {
            *lock_status() = msg;
        }
        // Support evidence (spec §12): "I pressed start and nothing happened" is the most
        // common monitoring report, and the three causes below are indistinguishable in the
        // UI. os error 1223 is specifically the user dismissing the UAC prompt — a REFUSED
        // outcome, not a failure, and not something to fix.
        match &res {
            Ok(s) if s.success() => {
                support_stop(SupportOutcome::Ok, "exit_clean", "elevated helper exited cleanly")
            }
            Ok(s) => support_stop(
                SupportOutcome::Failed,
                "exit_nonzero",
                &format!("elevated helper exited with status {s}"),
            ),
            Err(e) if e.raw_os_error() == Some(1223) => support_record(
                SupportOutcome::Refused,
                "uac_declined",
                "the UAC prompt was dismissed, so the helper never started",
            ),
            Err(e) => support_record(
                SupportOutcome::Failed,
                "elevation_failed",
                &format!("elevation did not complete: {e}"),
            ),
        }
    });
}

fn start_fps_capture_locked() -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if fps_active().load(Ordering::Acquire) {
        return Ok(()); // already running
    }
    // A quick stop→start can outrace the previous elevated helper's exit: `stop_fps_capture` clears the
    // intent flag, but the old pipe's reader only closes it at the helper's next line (~0.5 s) and the
    // helper exits at the write after that. Two elevated helpers at once would hold two ETW sessions of
    // one name. So first give the old helper a bounded window to exit. It clears `helper_running` from
    // its wait thread; best-effort — if it's wedged we proceed after the cap rather than hang the command
    // (no worse than the old behaviour; its pipe is closed, so it cannot reach the new capture).
    if helper_running().load(Ordering::Acquire) {
        for _ in 0..50 {
            if !helper_running().load(Ordering::Acquire) {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
    }
    let dir = fps_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("could not create data dir: {e}"))?;
    // Drop any stale sample so the UI doesn't briefly show last session's data (and any marker of
    // the last helper, so it never reads as this one's).
    let _ = std::fs::remove_file(fps_out_path());
    let _ = std::fs::remove_file(fps_unreadable_path());
    // The heartbeat file of Compy versions before the capture pipe: nothing reads or writes it now.
    let _ = std::fs::remove_file(dir.join("fps.alive"));
    // A new generation BEFORE the flag goes up, so a thread of the last capture (its pipe reader
    // included) that wakes now sees it was superseded and writes nothing more.
    let generation = capture_gen().fetch_add(1, Ordering::AcqRel) + 1;
    fps_active().store(true, Ordering::Release);
    *lock_status() = "starting".into();

    let exe = std::env::current_exe().map_err(|e| format!("cannot find own exe: {e}"))?;

    // Launch path depends on UAC. When UAC is fully disabled (EnableLUA=0),
    // the ShellExecute "runas" verb can't elevate — it silently fails, so the
    // helper never starts. But with UAC off + an admin account, this process
    // already carries a full admin token, so we can launch the helper DIRECTLY
    // and it inherits the rights needed to open the ETW session. With UAC on,
    // we elevate via the "runas" verb (prompt or auto-approve per policy).
    if uac_disabled_refreshed() {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        let pipe = match start_capture_pipe(generation) {
            Ok(p) => p,
            Err(e) => {
                fps_active().store(false, Ordering::Release);
                *lock_status() = format!("failed to launch helper: {e}");
                support_record(SupportOutcome::Failed, "pipe_failed", &format!("the capture pipe could not be created: {e}"));
                return Ok(());
            }
        };
        match std::process::Command::new(&exe) // spawn-allow: self-spawn of current_exe() (absolute path); install-dir risk is a later slice
            .args(pipe.argv())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
        {
            Ok(mut child) => {
                pipe.launched_as(child.id());
                helper_running().store(true, Ordering::Release);
                *lock_status() = "running".into();
                support_record(SupportOutcome::Ok, "direct_spawn", "helper started without a UAC prompt (EnableLUA=0)");
                // Reflect helper exit (it exits when the pipe closes, or crashes).
                std::thread::spawn(move || {
                    let status = child.wait();
                    pipe.finished();
                    helper_running().store(false, Ordering::Release);
                    // Only this capture's flag and status: a newer capture's are not this helper's.
                    if capture_current(generation) {
                        fps_active().store(false, Ordering::Release);
                        *lock_status() = "stopped".into();
                    }
                    match status {
                        Ok(s) if s.success() => support_stop(SupportOutcome::Ok, "exit_clean", "helper exited cleanly"),
                        Ok(s) => support_stop(SupportOutcome::Failed, "exit_nonzero", &format!("helper exited with status {s}")),
                        Err(e) => support_stop(SupportOutcome::Failed, "wait_failed", &format!("could not observe helper exit: {e}")),
                    }
                });
            }
            Err(e) => {
                pipe.finished();
                fps_active().store(false, Ordering::Release);
                *lock_status() = format!("failed to launch helper: {e}");
                support_record(SupportOutcome::Failed, "spawn_failed", &format!("helper did not launch: {e}"));
            }
        }
    } else if plain_start_applies(false, process_is_elevated(), perf_log_access()) {
        // D1-S1: this sign-in's token already carries the enabled "Performance Log Users" group, so
        // Windows lets this unelevated app start the trace: try the helper as a plain child first;
        // any failure of that start is the elevated launch below, exactly as it was.
        start_plain_or_elevated(exe, generation);
    } else {
        launch_elevated_helper(exe, generation);
    }

    // Session summary aggregator (F3, READ-ONLY): while monitoring is active,
    // fold the FPS helper's per-second output + existing GPU/CPU/RAM sensors
    // into a per-session record, then persist a summary on stop. Samples nothing
    // new and mutates nothing. A session is only saved if a game actually
    // presented frames (so cancelled/idle starts leave no empty record).
    {
        let started_at = chrono::Utc::now().to_rfc3339();
        // #669: ONE ledger read; a read that fails here records NO count — never a fabricated 0.
        // #618: the ledger is loaded before the set-aside marker is read; a session begun after a
        // set-aside records the fresh ledger's counts as counts since it, never as its total.
        let active_changes = crate::history::session_start_counts(
            crate::history::load_history,
            crate::history::ledger_set_aside_through,
            &started_at,
        );
        std::thread::spawn(move || {
            // One clock for the whole capture: every session's start and end are readings of it.
            let clock = std::time::Instant::now();
            // A session belongs to ONE process identity: the boundary decides, once a second, when
            // the open session ends (its process is gone, or another one is presenting) and when the
            // next begins. A fresh capture opens a session at once, as it always did.
            let mut first = LiveSession::begin(started_at, active_changes, 0);
            // This capture's helper counts unreadable ticks from 0 (its marker was cleared above), so
            // the first session owns every one of them; later sessions baseline at their first look.
            first.acc.unreadable_counter_baseline(0);
            let mut tracker = crate::session_boundary::Tracker::open_at(0, first);
            // P5-enough: a new capture starts from nothing, never the last capture's count.
            *lock_progress() = None;
            while capture_live(generation) {
                std::thread::sleep(std::time::Duration::from_secs(1));
                if !capture_live(generation) {
                    break;
                }
                let now = clock.elapsed().as_secs() as u32;
                // Tooltip carry-over: the live tray tooltip reuses this tick's data (no new IPC).
                let mut tip: Option<(f64, f64)> = None;
                // P9-bottleneck-sustained: whether this tick's frame reading was a MEASURED one.
                let mut tick_measured = false;
                // TG-context v2: the game this tick's frame reading belongs to (name, pid), if any.
                let mut tick_game: Option<(String, u32)> = None;
                // Freshness gate (0.9.1): the helper now emits NOTHING when no game is
                // positively attached (fail-closed attribution), so fps.json can legitimately
                // sit frozen at its last sample. Same <3 s mtime rule as get_fps_status —
                // without it, this 1 Hz recorder would re-record that frozen sample forever.
                let fps_age = sample_age();
                let fps_fresh = fps_age.map(|e| e < std::time::Duration::from_secs(3)).unwrap_or(false);
                let fps_txt = if fps_fresh {
                    std::fs::read_to_string(fps_out_path()).ok()
                } else {
                    None
                };
                // Parse the helper's per-tick line through the capture backend (its wire format is
                // the backend's concern) - byte-identical to the prior inline serde_json parse.
                let parsed = fps_txt
                    .and_then(|txt| crate::capture::EtwDxgiBackend.parse_sample(&txt))
                    .filter(|s| s.fps > 0.0);
                // M6-unread: a second the helper could not look at is neither a reading nor "no
                // frames": the report up to 3 s old that is still on disk is NOT re-recorded as this
                // second's, and the second is counted as unreadable below.
                let (marker_ticks, marker_age) = read_marker();
                let report_ticks = parsed.as_ref().map_or(0, |s| s.snapshot_unreadable_ticks);
                let (sample, second_unreadable, unread) =
                    unreadable_second(parsed, report_ticks, marker_ticks, marker_age, fps_age);
                // The boundary sees only a reading that names its process; `alive` is asked only on a
                // tick with no fresh reading, so a game that is merely silent (alt-tab, loading,
                // minimised) is never mistaken for a game that is gone.
                tracker.advance(
                    now,
                    sample.as_ref().filter(|s| !s.process_name.is_empty()).map(|s| (s.process_name.as_str(), s.pid)),
                    pid_running_as,
                    |done, ended| {
                        done.finish(ended);
                        *lock_progress() = None;
                    },
                    |now| {
                        // A new process begins its OWN session at its first frame: its start, its
                        // change counts and its clock are its own, and nothing of the last one is carried.
                        let began_at = chrono::Utc::now().to_rfc3339();
                        let counts = crate::history::session_start_counts(
                            crate::history::load_history,
                            crate::history::ledger_set_aside_through,
                            &began_at,
                        );
                        LiveSession::begin(began_at, counts, now)
                    },
                );
                // No session open (the game closed and nothing has presented since): monitoring stays
                // on and waits, recording nothing.
                let Some(live) = tracker.current() else {
                    crate::tray::set_monitoring_on();
                    continue;
                };
                let elapsed = now.saturating_sub(live.began_at);
                // The session's count comes from the helper's own cumulative counter (`unread.ticks`),
                // as a delta since this session's last look - NOT from the live flag, which samples a
                // yes/no once a second against half-second ticks and so sees about half of them. The
                // flag only drives the live readout and the withheld report. Ticks add no reading, no
                // zero and no gap-fill; the session's own length still includes them.
                if feed_unreadable(&mut live.acc, unread, second_unreadable) {
                    *lock_progress() = Some(live.acc.progress());
                }
                if let Some(s) = &sample {
                    // P4-comparable: a tick with the game behind another window is left out
                    // of the session's numbers and of the stutter timeline.
                    let measured = live.acc.record_tick(
                        &s.process_name,
                        s.fps,
                        s.avg_frametime_ms,
                        s.low1_fps,
                        elapsed,
                        s.foreground,
                    );
                    // P4-smooth-measure: every frame since the last reading, left out
                    // on the same ground as the tick (alt-tabbed).
                    if let Some(h) = &s.frame_hist {
                        live.acc.record_frame_hist(&s.process_name, h, measured, elapsed);
                    }
                    if measured {
                        *lock_progress() = Some(live.acc.progress());
                    }
                    tick_measured = measured;
                    tick_game = Some((s.process_name.clone(), s.pid));
                    tip = Some((s.fps, s.low1_fps));
                    if measured && s.low1_fps > 0.0 && live.timeline.len() < 7200 {
                        live.timeline.push((elapsed, s.low1_fps));
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
                let gpu_hotspot_temp = gpus.iter().filter_map(|g| g.hotspot_temperature_c).max();
                let cpu = get_cpu_sensors();
                // An unfilled sensor cache reads 0 of 0 (the poller starts with the capture): that is
                // no reading, never a RAM figure (codebase review 2026-11-02).
                let ram_read = cpu.ram_total_bytes > 0;
                live.acc.record_sensors(
                    gpu_temp,
                    gpu_usage,
                    ram_read.then_some(cpu.ram_used_bytes),
                    ram_read.then_some(cpu.ram_total_bytes),
                );
                // P9-bottleneck-sustained: the saturation share counts only the game's own measured
                // ticks, never a launcher, a menu before the first frame or a window in front.
                // KNOWN LIMIT (review round 2): `gpu_usage` is the BUSIEST adapter this tick, as the
                // peak has always been. On an iGPU + dGPU PC that is usually the card rendering the
                // game, but nothing here proves which adapter drew the frame (that would need game
                // introspection, which is forbidden), so the limiter claim this share feeds inherits
                // the same assumption the peak made.
                live.acc.record_gpu_load(gpu_usage, tick_measured);
                // TG-context v2 (record only, feeds no verdict): sample every tick a game is attached so
                // each reading spans one tick; only a measured tick counts, and a failed read counts as
                // unread, never as zero. Numbers only: the game's name is compared in memory, never stored.
                if let Some((name, pid)) = &tick_game {
                    if !live.other_sampler.as_ref().is_some_and(|s| s.is_for(name)) {
                        live.other_sampler = Some(crate::other_load::OtherLoadSampler::new(name));
                    }
                    if let Some(sampler) = live.other_sampler.as_mut() {
                        let r = sampler.sample(*pid);
                        if tick_measured {
                            live.other_cpu_acc.record(r.cpu);
                            live.other_gpu_3d_acc.record(r.gpu_3d);
                            live.other_gpu_video_acc.record(r.gpu_video);
                        }
                    }
                }
                // Same driver-free interop as get_cpu_temp (cpu_temp.rs) — None when no HWiNFO/LHM/OHM
                // is running; never fabricated. Session-scoped peak, same as the GPU sensors above.
                let cpu_temp = crate::cpu_temp::read_cpu_temp().map(|t| t.temp_c.round() as u32);
                live.acc.record_thermals(cpu_temp, gpu_hotspot_temp);
                if let Some(gm) = crate::gaming_session::load_session() {
                    live.gaming_mode_seen = true;
                    live.gaming_mode_plan = crate::gaming_orchestrator::observe_plan(&gm, &mut live.gaming_mode_ids, live.gaming_mode_plan);
                }

                // ── Stutter signals (capped at 50, read-only) ──
                // Read once, before this tick adds anything: a full log still lets the process diff keep
                // COUNTING what it could not list (`start_events_dropped`), it just stops listing.
                let at_cap = live.events.len() >= crate::running_at_start::EVENT_CAP;
                if !at_cap {
                    if !live.ram_logged
                        && cpu.ram_total_bytes > 0
                        && cpu.ram_used_bytes as f64 / cpu.ram_total_bytes as f64 >= 0.90
                    {
                        live.events.push(crate::stutter::StutterEvent {
                            at_secs: elapsed,
                            kind: "ram".into(),
                            label: "RAM filling up (90%+)".into(),
                        });
                        live.ram_logged = true;
                    }
                    // GPU clock drop ONLY while busy — a sharp drop under load is throttling; a drop
                    // at low utilization is just normal idle downclock, not a stutter cause.
                    if let (Some(prev), Some(now)) = (live.prev_clock, gpu_clock) {
                        let dropped = prev > 0 && (now as f64) < (prev as f64) * 0.8;
                        let busy = gpu_usage.is_some_and(|u| u >= 80);
                        if dropped && busy {
                            live.events.push(crate::stutter::StutterEvent {
                                at_secs: elapsed,
                                kind: "gpu-clock".into(),
                                label: "a GPU clock drop under load".into(),
                            });
                        }
                    }
                    live.prev_clock = gpu_clock.or(live.prev_clock);
                }
                // Process starts: a names-only diff every tick (1 Hz, only while capturing),
                // skipping OS chatter so the insight never degrades to "svchost did it". The same
                // enumeration gives the session's one start snapshot (which KNOWN programs were
                // already running; ids only, `running_at_start.rs`) on the first tick a frame
                // names the process, and counts the ticks/starts the diff could not list.
                // Handle-free snapshot: opens no process. A tick whose snapshot cannot be read still
                // reaches `observe` as the failed-read form (no names, count 0): the watch then neither
                // diffs it (no phantom burst on the next good tick) nor loses the first-frame time and
                // the retry budget behind the start snapshot's "couldn't read".
                let rows = crate::other_load::read_process_rows();
                let (names, total_procs) = crate::running_at_start::tick_listing(rows.as_deref());
                let started = live.watch.observe(names, total_procs, at_cap, elapsed, tick_game.is_some());
                live.events.extend(started);
            }
            // Monitoring stopped (or the helper went away): a session still open ends with the wall
            // time since it began, as every session always has.
            let now = clock.elapsed().as_secs() as u32;
            tracker.stop(now, |done, ended| done.finish(ended));
        });
    }

    Ok(())
}

/// Everything one session folds in while it is open, and what saving it needs. Pulled out of the
/// monitoring thread's locals so the thread can hold one of these per session (the fields and
/// their order are the locals the loop always had).
struct LiveSession {
    acc: crate::sessions::SessionAccumulator,
    /// Reading of the capture's clock at which this session began.
    began_at: u32,
    /// TG-context: the active power plan as the session begins (read-only powercfg query, once;
    /// read again at save to see whether it changed). Unread stays unknown.
    plan_at_start: Option<String>,
    /// Stutter Forensics: a read-only per-second timeline (elapsed, 1% low) + a capped log of
    /// signals (process starts / RAM 90% / GPU clock drop), analyzed once at finalize. Only
    /// runs while monitoring (the user opted in); bounded so it never grows unbounded.
    timeline: Vec<(u32, f64)>,
    events: Vec<crate::stutter::StutterEvent>,
    /// TG-context v2 (record only): the rest of the PC's CPU/GPU load over measured ticks.
    other_sampler: Option<crate::other_load::OtherLoadSampler>,
    other_cpu_acc: crate::other_load::OtherLoadAccumulator,
    other_gpu_3d_acc: crate::other_load::OtherLoadAccumulator,
    other_gpu_video_acc: crate::other_load::OtherLoadAccumulator,
    /// The process-start diff, the one start snapshot and the skipped/dropped counters
    /// (`running_at_start::StartWatch`); replaces the bare previous-names set.
    watch: crate::running_at_start::StartWatch,
    prev_clock: Option<u32>,
    ram_logged: bool,
    /// Gaming Mode presence: a valid session slot at ANY tick marks the whole session (a
    /// save-time-only probe would read false for a Gaming Mode session that ended before
    /// monitoring stopped).
    gaming_mode_seen: bool,
    /// CR-trial-plan-switch-confound: what each Gaming Mode session seen did with the power plan
    /// (read once per Gaming Mode session id), so a Trial never compares two plans unawares.
    gaming_mode_plan: Option<crate::sessions::GamingModePlan>,
    gaming_mode_ids: Vec<String>,
}

impl LiveSession {
    fn begin(started_at: String, active_changes: crate::history::SessionStartCounts, began_at: u32) -> Self {
        Self {
            acc: crate::sessions::SessionAccumulator::with_counts(started_at, active_changes),
            began_at,
            plan_at_start: crate::actions::current_power_plan_guid(),
            timeline: Vec::new(),
            events: Vec::new(),
            other_sampler: None,
            other_cpu_acc: Default::default(),
            other_gpu_3d_acc: Default::default(),
            other_gpu_video_acc: Default::default(),
            watch: Default::default(),
            prev_clock: None,
            ram_logged: false,
            gaming_mode_seen: false,
            gaming_mode_plan: None,
            gaming_mode_ids: Vec::new(),
        }
    }

    /// The session ended as `ended` says: finalize it there and save it if it measured. A session
    /// that ended at its last reading (its process exited, or another took over) keeps nothing that
    /// was seen after it: no signal logged past its end.
    fn finish(self, ended: crate::session_boundary::Ended) {
        let reason = ended.reason;
        let duration_secs = u64::from(ended.duration_secs);
        let LiveSession {
            acc,
            plan_at_start,
            timeline,
            mut events,
            other_cpu_acc,
            other_gpu_3d_acc,
            other_gpu_video_acc,
            gaming_mode_seen,
            gaming_mode_plan,
            watch,
            ..
        } = self;
        // The counters are trimmed to the session's end exactly as `events` is just below.
        let counters_end = (ended.reason != crate::session_boundary::SessionEnd::CaptureStopped)
            .then(|| u32::try_from(duration_secs).unwrap_or(u32::MAX));
        let (running_at_start, start_ticks_skipped, start_events_dropped) = watch.finish(counters_end);
        // A fragment (a launcher / splash window, a game that died within a minute of its first
        // frame) is not a session row: same silent path as any capture under the minimum length.
        if !crate::session_boundary::worth_keeping(&ended, acc.readings_seen()) {
            return;
        }
        if reason != crate::session_boundary::SessionEnd::CaptureStopped {
            events.retain(|e| u64::from(e.at_secs) <= duration_secs);
        }
        if acc.worth_saving() {
            // Unsaved work for a clear to refuse on; released right after the save returns, and on every path out of this block, a panic included.
            let pending = crate::sessions::hold_pending_save();
            let mut summary = acc.finalize_ended(&ended);
            summary.ended = Some(reason);
            summary.hw_fingerprint = Some(crate::hardware::current_fingerprint());
            summary.gaming_mode_active = Some(gaming_mode_seen);
            summary.gaming_mode_plan = gaming_mode_plan;
            summary.stutter_insight = crate::stutter::analyze(&timeline, &events);
            summary.stutter_timeline = timeline;
            summary.stutter_events = events;
            // What this session could actually measure: the honest capability descriptor of the
            // production ETW-DXGI backend, keyed to the capture start (the session start).
            summary.capture_capabilities = Some(
                crate::capture::EtwDxgiBackend.capabilities(Some(summary.started_at.clone())),
            );
            // The honest conditions this session ran under (resolution/refresh/driver/rig hash/...).
            // collect_v1 populates only provable fields; everything else stays honestly Unknown.
            summary.game_state = Some(crate::game_state::GameStateFingerprint::collect_v1(
                &summary.process_name,
                &summary.started_at,
                Some(gaming_mode_seen),
            )
            .with_power_plan(plan_at_start, crate::actions::current_power_plan_guid())
            .with_other_load(other_cpu_acc.finish(), other_gpu_3d_acc.finish(), other_gpu_video_acc.finish())
            .with_running_at_start(running_at_start, start_ticks_skipped, start_events_dropped));
            // P7-notify (Constitution section 15, 33): a saved session toasts only when it settles a
            // decision or a state change (a Trial's after-session, a before/after verdict, a
            // regression against the game's last steady session). Otherwise the debrief waits
            // in the app, silently. A short blip is never saved, so it never toasts.
            let ended = summary.clone();
            let saved = crate::sessions::save_session(summary);
            drop(pending); // settled: the toast below is not unsaved work
            if let Ok(Some(saved)) = saved {
                // M6-unread: a session whose figures are untrusted (more than a fifth of it unmeasured,
                // `mostly_unread`) settles nothing, so it never interrupts the player with a verdict
                // toast; its debrief waits in the app and says why.
                if !ended.mostly_unread() {
                    if let Some(notice) = crate::experiment::session_end_notice_now(&ended, saved.settled) {
                        crate::notify_debrief_ready(&notice.body(&ended.process_name));
                    }
                }
            }
        }
    }
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

// ─── D1-S1: start the capture helper without elevation when the account already allows it ────────
//
// Windows lets administrators, members of the built-in "Performance Log Users" group (S-1-5-32-559)
// and service accounts control event-tracing sessions, and enabling a provider into one takes the
// same rights. Sources (Microsoft Learn): StartTraceW "Return value" (ERROR_ACCESS_DENIED),
// EnableTraceEx2 "Return value" (ERROR_ACCESS_DENIED) and "Controlling Event Tracing Sessions". The
// helper enables ONE provider (Microsoft-Windows-DXGI, fps.rs) into one real-time session, and
// ferrisetw returns an error if either call fails, which makes the helper exit: so a start the group
// does not cover never captures a subset, it fails and the elevated launch takes over.
//
// The helper is the same program with the same five arguments either way, and it names and watches
// the game from the process snapshot in both cases (other_load.rs), so the measurement is the same.
// This code reads THIS process's own token only. It never adds, removes or changes a group, a policy
// or a service, and it opens no other process.

/// What this process's own token says about "Performance Log Users".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PerfLogAccess {
    /// The group is in the token and ENABLED: Windows will let this process start a trace.
    InToken,
    /// Not in the token as an enabled group. (Membership added after sign-in is not in the token until
    /// the next sign-in, and this read cannot tell that case apart from "never a member".)
    NotInToken,
    /// The token could not be read, or its group list was malformed: treated as `NotInToken`.
    Unknown,
}

/// S-1-5-32-559 as bytes: revision 1, two sub-authorities, NT authority (5), 32 (BUILTIN), 559.
const PERF_LOG_USERS_SID: [u8; 16] = [1, 2, 0, 0, 0, 0, 0, 5, 32, 0, 0, 0, 0x2F, 0x02, 0, 0];
const SE_GROUP_ENABLED: u32 = 0x4;
const SE_GROUP_USE_FOR_DENY_ONLY: u32 = 0x10;

/// PURE: read a `TOKEN_GROUPS` buffer as `GetTokenInformation(TokenGroups)` returns it on x64:
/// a u32 count, 4 bytes of padding, then `count` entries of (pointer to SID, u32 attributes, 4 bytes
/// of padding), with the SIDs stored later in the SAME buffer (the pointers are absolute addresses).
/// The group counts only when ENABLED and not "use for deny only". Anything malformed is `Unknown`;
/// every offset is checked arithmetic (review S4).
pub(crate) fn perf_log_access_from_token_groups(buf: &[u8]) -> PerfLogAccess {
    fn rd<const N: usize>(buf: &[u8], at: usize) -> Option<[u8; N]> {
        buf.get(at..at.checked_add(N)?)?.try_into().ok()
    }
    fn entry_sid_matches(buf: &[u8], base: usize, at: usize) -> Option<(bool, u32)> {
        let ptr = rd::<8>(buf, at).map(|b| u64::from_le_bytes(b) as usize)?;
        let attrs = rd::<4>(buf, at.checked_add(8)?).map(u32::from_le_bytes)?;
        let start = ptr.checked_sub(base)?;
        let sub_count = *buf.get(start.checked_add(1)?)? as usize;
        let end = start.checked_add(8)?.checked_add(sub_count.checked_mul(4)?)?;
        let sid = buf.get(start..end)?;
        Some((sid == PERF_LOG_USERS_SID, attrs))
    }
    let base = buf.as_ptr() as usize;
    let Some(count) = rd::<4>(buf, 0).map(|b| u32::from_le_bytes(b) as usize) else {
        return PerfLogAccess::Unknown;
    };
    let entries_end = count.checked_mul(16).and_then(|n| n.checked_add(8));
    if count > 1024 || !matches!(entries_end, Some(end) if end <= buf.len()) {
        return PerfLogAccess::Unknown;
    }
    let mut found = false;
    for i in 0..count {
        let Some((is_plu, attrs)) = entry_sid_matches(buf, base, 8 + i * 16) else {
            return PerfLogAccess::Unknown;
        };
        if is_plu && attrs & SE_GROUP_ENABLED != 0 && attrs & SE_GROUP_USE_FOR_DENY_ONLY == 0 {
            found = true;
        }
    }
    if found {
        PerfLogAccess::InToken
    } else {
        PerfLogAccess::NotInToken
    }
}

/// Run `f` with a read-only handle to THIS process's own token. (Our own token, never another
/// process's: nothing here touches the game.)
pub(crate) fn with_own_token<R>(f: impl FnOnce(windows::Win32::Foundation::HANDLE) -> Option<R>) -> Option<R> {
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::Security::TOKEN_QUERY;
    use windows::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};
    // SAFETY: GetCurrentProcess is a pseudo-handle; the token handle is closed before returning.
    unsafe {
        let mut token = HANDLE::default();
        OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token).ok()?;
        let out = f(token);
        let _ = CloseHandle(token);
        out
    }
}

/// Is this process's token elevated? `None` when it cannot be read.
pub(crate) fn process_is_elevated() -> Option<bool> {
    use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION};
    // SAFETY: the out-buffer is a TOKEN_ELEVATION of the size passed.
    with_own_token(|token| unsafe {
        let mut elevation = TOKEN_ELEVATION::default();
        let mut returned = 0u32;
        GetTokenInformation(
            token,
            TokenElevation,
            Some((&mut elevation as *mut TOKEN_ELEVATION).cast()),
            std::mem::size_of::<TOKEN_ELEVATION>() as u32,
            &mut returned,
        )
        .ok()?;
        Some(elevation.TokenIsElevated != 0)
    })
}

/// Read this process's token groups (`GetTokenInformation(TokenGroups)`) and parse them. The buffer is
/// a `Vec<u64>` so it is 8-byte aligned, as TOKEN_GROUPS requires (review S4); `None` = unreadable.
fn own_token_perf_log_access() -> Option<PerfLogAccess> {
    use windows::Win32::Security::{GetTokenInformation, TokenGroups};
    // SAFETY: the buffer outlives the call and its byte length is passed with it.
    with_own_token(|token| unsafe {
        let mut needed = 0u32;
        let _ = GetTokenInformation(token, TokenGroups, None, 0, &mut needed);
        if needed == 0 || needed > (1 << 16) {
            return None;
        }
        let mut words = vec![0u64; (needed as usize).div_ceil(8)];
        let bytes = words.len() * 8;
        GetTokenInformation(token, TokenGroups, Some(words.as_mut_ptr().cast()), bytes as u32, &mut needed).ok()?;
        // The SID pointers inside are absolute addresses into `words`, so parse it IN PLACE.
        let view = std::slice::from_raw_parts(words.as_ptr().cast::<u8>(), bytes);
        Some(perf_log_access_from_token_groups(view))
    })
}

/// Does this logon session's token carry the enabled "Performance Log Users" group? A token never
/// changes after sign-in, so this is read once per run.
pub(crate) fn perf_log_access() -> PerfLogAccess {
    static ACCESS: OnceLock<PerfLogAccess> = OnceLock::new();
    *ACCESS.get_or_init(|| own_token_perf_log_access().unwrap_or(PerfLogAccess::Unknown))
}

/// PURE: start the helper as a plain (unelevated) child first? Only with UAC on, this app itself NOT
/// elevated, and the group enabled in the token. Any other answer (including an unreadable token)
/// is today's launch, untouched.
pub(crate) fn plain_start_applies(uac_off: bool, elevated: Option<bool>, access: PerfLogAccess) -> bool {
    !uac_off && elevated == Some(false) && access == PerfLogAccess::InToken
}

/// The helper's command line, the same five arguments for all three launches (elevated, UAC-off direct,
/// plain): this launch's pipe and this app's pid (hardening slice 2: no path). A plain start adds no
/// argument and no environment of its own.
fn helper_argv(pipe: &str, parent_pid: u32) -> [String; 5] {
    [
        "--fps-capture".to_string(),
        "--pipe".to_string(),
        pipe.to_string(),
        "--parent-pid".to_string(),
        parent_pid.to_string(),
    ]
}

/// PURE: the helper exe for a plain start must be an absolute path with no `..` in it: our own
/// running exe. Anything else is a failed start (and so the elevated launch).
fn checked_helper_path(exe: &std::path::Path) -> Result<std::path::PathBuf, String> {
    use std::path::Component;
    if !exe.is_absolute() || exe.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("own exe path is not an absolute path".to_string());
    }
    Ok(exe.to_path_buf())
}

/// How long after a plain start an exit still counts as "the trace did not start". A trace that
/// cannot start makes the helper exit at once; the elevated launch takes over only in this window,
/// never in the middle of a session.
const PLAIN_START_WINDOW: std::time::Duration = std::time::Duration::from_secs(15);

/// True after a plain start failed and the elevated launch took over; cleared by the next plain
/// start that works. Only so the Live room stops saying "no prompt" once it was not true.
fn plain_start_failed() -> &'static std::sync::atomic::AtomicBool {
    static F: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    &F
}

/// PURE: the Live room's "measures without a prompt" line is true only while a plain start applies
/// and none has failed.
fn prompt_free_from(plain_applies: bool, start_failed: bool) -> bool {
    plain_applies && !start_failed
}

/// The last `EnableLUA` read (A2b): 0 = not read yet, 1 = UAC off, 2 = UAC on. The status poll reads
/// this cache instead of the registry every time; a capture start re-reads the registry
/// ([`uac_disabled_refreshed`]), so a change is picked up at the next start.
fn uac_cache() -> &'static std::sync::atomic::AtomicU8 {
    static C: std::sync::atomic::AtomicU8 = std::sync::atomic::AtomicU8::new(0);
    &C
}

/// PURE: the cache value for a registry answer, and the answer for a cache value (`None` = not read).
fn uac_cache_value(off: bool) -> u8 {
    if off { 1 } else { 2 }
}
fn uac_from_cache(v: u8) -> Option<bool> {
    match v {
        1 => Some(true),
        2 => Some(false),
        _ => None,
    }
}

/// Read `EnableLUA` now and remember it (a capture start).
fn uac_disabled_refreshed() -> bool {
    let off = uac_disabled();
    uac_cache().store(uac_cache_value(off), std::sync::atomic::Ordering::Release);
    off
}

/// The remembered `EnableLUA` answer, reading the registry only the first time (the status poll).
fn uac_disabled_cached() -> bool {
    match uac_from_cache(uac_cache().load(std::sync::atomic::Ordering::Acquire)) {
        Some(off) => off,
        None => uac_disabled_refreshed(),
    }
}

fn prompt_free_now() -> bool {
    static ELEVATED: OnceLock<Option<bool>> = OnceLock::new();
    let elevated = *ELEVATED.get_or_init(process_is_elevated);
    prompt_free_from(
        plain_start_applies(uac_disabled_cached(), elevated, perf_log_access()),
        plain_start_failed().load(std::sync::atomic::Ordering::Acquire),
    )
}

/// Seam: what starting the helper did.
#[derive(Debug, PartialEq, Eq)]
enum Started {
    Plain,
    Elevated,
}

/// Try the plain spawn; when it fails, take the elevated launch. `note_failure` gets the reason a
/// plain spawn failed. The three actions are handed in so tests can pin the order.
fn start_helper<C>(
    spawn_plain: impl FnOnce() -> Result<C, String>,
    elevate: impl FnOnce(),
    note_failure: impl FnOnce(&str),
) -> (Started, Option<C>) {
    match spawn_plain() {
        Ok(child) => (Started::Plain, Some(child)),
        Err(reason) => {
            note_failure(&reason);
            elevate();
            (Started::Elevated, None)
        }
    }
}

/// When a plain helper exits: the reason to fall back to the elevated launch, or `None`. It falls back
/// only if the capture is still wanted and the helper died inside [`PLAIN_START_WINDOW`].
fn plain_exit_fallback_reason(status: &str, ran_for: std::time::Duration, capture_wanted: bool) -> Option<String> {
    if !capture_wanted || ran_for > PLAIN_START_WINDOW {
        return None;
    }
    Some(format!(
        "the helper started without elevation exited ({status}) within {} s, so the trace did not start",
        PLAIN_START_WINDOW.as_secs()
    ))
}

/// The fallback, in capture order (review S1): it takes the same lock a served start or stop holds,
/// and launches only if THIS capture is still the live one there. A Stop, or a Stop+Start, that got
/// in first wins: no prompt nobody asked for, and never a second helper beside a newer capture's
/// (both would share the session name "Compy-FPS"). `capture_wanted` is read under that lock.
fn fall_back_in_order(
    lock: &Mutex<u64>,
    capture_wanted: impl FnOnce() -> bool,
    reason_for: impl FnOnce(bool) -> Option<String>,
    elevate: impl FnOnce(),
    note_failure: impl FnOnce(&str),
) -> bool {
    let _order = lock.lock().unwrap_or_else(|p| p.into_inner());
    match reason_for(capture_wanted()) {
        Some(r) => {
            note_failure(&r);
            elevate();
            true
        }
        None => false,
    }
}

/// The plain (unelevated) start of the capture helper: our own exe, the same five arguments, no
/// console window. The child INHERITS this app's (the user's) environment, unchanged, like the
/// UAC-off direct spawn: it runs with the user's own rights, so that environment gives it nothing
/// the user does not already have (the elevated launch is the one that clears it).
fn spawn_plain_helper(exe: &std::path::Path, pipe: &CapturePipe) -> Result<std::process::Child, String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let exe = checked_helper_path(exe)?;
    std::process::Command::new(exe) // spawn-allow: self-spawn of current_exe() (absolute, checked_helper_path), same as the UAC-off direct spawn
        .args(pipe.argv())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| e.to_string())
}

/// PURE: how a plain helper's exit reads in the support log and the fallback reason. One of the helper's
/// own refusals says which (review r1 B1), after the exit status.
fn plain_exit_text(status: &std::io::Result<std::process::ExitStatus>) -> String {
    match status {
        Ok(s) => match helper_refusal(s.code()) {
            Some(why) => format!("{s}: {why}"),
            None => s.to_string(),
        },
        Err(e) => format!("could not observe exit: {e}"),
    }
}

/// A pipe and the plain start over it; on a failed start the pipe's reader is stopped at once.
fn spawn_plain_with_pipe(exe: &std::path::Path, generation: u64) -> Result<(std::process::Child, CapturePipe), String> {
    let pipe = start_capture_pipe(generation)?;
    match spawn_plain_helper(exe, &pipe) {
        Ok(child) => {
            pipe.launched_as(child.id());
            Ok((child, pipe))
        }
        Err(e) => {
            pipe.finished();
            Err(e)
        }
    }
}

/// Launch the helper without elevation; the elevated launch ([`launch_elevated_helper`], unchanged)
/// if that spawn fails, or if the helper exits inside [`PLAIN_START_WINDOW`] while this capture is
/// still wanted. The reason for a fallback goes in the support log.
fn start_plain_or_elevated(exe: std::path::PathBuf, generation: u64) {
    use std::sync::atomic::Ordering;
    let note = |why: &str| {
        plain_start_failed().store(true, Ordering::Release);
        support_record(
            SupportOutcome::Failed,
            "nonelevated_start_failed",
            &format!("{why}; asking for administrator permission instead"),
        );
    };
    let e2 = exe.clone();
    let (_, child) = start_helper(
        || spawn_plain_with_pipe(&exe, generation),
        || launch_elevated_helper(e2, generation),
        |reason| note(&format!("could not start the helper without elevation ({reason})")),
    );
    let Some((mut child, pipe)) = child else {
        return;
    };
    plain_start_failed().store(false, Ordering::Release);
    helper_running().store(true, Ordering::Release);
    *lock_status() = "running".into();
    support_record(
        SupportOutcome::Ok,
        "nonelevated_start",
        "helper started without elevation (this account is in Performance Log Users)",
    );
    let started_at = std::time::Instant::now();
    std::thread::spawn(move || {
        let status = child.wait();
        pipe.finished();
        helper_running().store(false, Ordering::Release);
        let text = plain_exit_text(&status);
        let ran_for = started_at.elapsed();
        let fell_back = fall_back_in_order(
            capture_ctl(),
            || capture_live(generation),
            |wanted| plain_exit_fallback_reason(&text, ran_for, wanted),
            || {
                *lock_status() = "starting".into();
                launch_elevated_helper(exe, generation)
            },
            note,
        );
        if fell_back {
            return;
        }
        // No fallback: what the UAC-off direct-spawn wait does when its helper ends.
        if capture_current(generation) {
            fps_active().store(false, Ordering::Release);
            *lock_status() = "stopped".into();
        }
        match status {
            Ok(s) if s.success() => support_stop(SupportOutcome::Ok, "exit_clean", "helper exited cleanly"),
            Ok(s) => support_stop(SupportOutcome::Failed, "exit_nonzero", &format!("helper exited with status {s}")),
            Err(e) => support_stop(SupportOutcome::Failed, "wait_failed", &format!("could not observe helper exit: {e}")),
        }
    });
}
// ─── end D1-S1 ────────────────────────────────────────────────────────────────────────────────────

/// Stop FPS capture with a fresh ticket (test-only, as `start_fps_capture`). The served stop waits
/// its turn behind a start in progress (see [`capture_in_order`]), so it stops what that start began.
#[cfg(test)]
pub(crate) fn stop_fps_capture() {
    stop_fps_capture_ticketed(capture_ticket())
}

/// Stop FPS capture as request `ticket` (see [`capture_in_order`]); a stop older than a start
/// that already ran changes nothing.
pub(crate) fn stop_fps_capture_ticketed(ticket: u64) {
    capture_in_order(ticket, || (), stop_fps_capture_locked)
}

fn stop_fps_capture_locked() {
    use std::sync::atomic::Ordering;
    // SeqCst, then wait for any relay write already past its check (review r2 N5: `write_while_wanted`),
    // so the files removed below are not written again by this capture's reader.
    fps_active().store(false, Ordering::SeqCst);
    let _ = wait_for_relay_writes(relay_writes(), std::time::Duration::from_millis(500));
    *lock_status() = "idle".into();
    *lock_progress() = None;
    let _ = std::fs::remove_file(fps_out_path());
    let _ = std::fs::remove_file(fps_unreadable_path());
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
    // M6-unread: a report older than the helper's marker is not the present: a Trial window never
    // takes it as this moment's frames.
    let (marker_ticks, marker_age) = read_marker();
    if unreadable_read(marker_ticks, marker_age, sample_age(), 0).now {
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
    // The helper's last line this capture (start and stop both delete the file) and whether it is
    // fresh (< 3 s old). Only a fresh sample is surfaced — otherwise the helper has stalled or the
    // game stopped presenting; a stale one still names the game, so P5-guided can ask if it closed.
    let (last, fresh) = (|| {
        let path = fps_out_path();
        let meta = std::fs::metadata(&path).ok()?;
        let fresh = meta
            .modified()
            .ok()
            .and_then(|m| m.elapsed().ok())
            .map(|e| e < std::time::Duration::from_secs(3))
            .unwrap_or(false);
        let bytes = std::fs::read(&path).ok()?;
        Some((serde_json::from_slice::<FpsSample>(&bytes).ok(), fresh))
    })()
    .unwrap_or((None, false));
    let game_running = if active { game_running_from(last.as_ref(), fresh, pid_running_as) } else { None };
    // M6-unread: while the helper cannot read the process snapshot the readout says so (and shows
    // no report: the one on disk is older than the marker). Only while capture is on.
    let (marker_ticks, marker_age) = read_marker();
    let unread = if active {
        unreadable_read(marker_ticks, marker_age, sample_age(), last.as_ref().map_or(0, |s| s.snapshot_unreadable_ticks))
    } else {
        UnreadRead::default()
    };
    let (sample, _) = gate_unreadable(if fresh { last } else { None }, unread);
    FpsStatus {
        active,
        status,
        sample,
        game_running,
        progress: if active { lock_progress().clone() } else { None },
        unreadable_now: unread.now,
        unreadable_ticks: unread.ticks,
        prompt_free: prompt_free_now(),
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
        assert!(fps_unreadable_path().starts_with(&d));
    }
}

#[cfg(test)]
mod capture_pipe_tests {
    //! Hardening slice 2: the app writes the helper's lines itself, as the user; readers see the same files.
    use super::{relay_line, write_replacing, RelayCounts};
    use crate::fps_pipe::Line;

    #[test]
    fn a_report_line_becomes_fps_json_and_a_count_becomes_the_marker() {
        let s = crate::test_scratch::scratch("relay-line");
        let (out, marker) = (s.join("fps.json"), s.join("fps.json.snapshot-unreadable"));
        let mut c = RelayCounts::default();
        let report = r#"{"pid":7,"process_name":"g.exe","fps":60.0}"#;
        relay_line(Line::Report(report.into()), &mut c, &out, &marker);
        assert_eq!(std::fs::read_to_string(&out).unwrap(), report, "the exact line, as the helper used to write it");
        assert!(!marker.exists());
        relay_line(Line::Unreadable(5), &mut c, &out, &marker);
        assert_eq!(std::fs::read_to_string(&marker).unwrap(), "5", "the marker's old content: the bare count");
        assert_eq!(super::parse_unreadable_ticks(&std::fs::read_to_string(&marker).unwrap()), Some(5));
        relay_line(Line::Alive, &mut c, &out, &marker);
        relay_line(Line::Junk, &mut c, &out, &marker);
        assert_eq!(std::fs::read_to_string(&out).unwrap(), report, "a keepalive or junk writes nothing");
        assert_eq!(std::fs::read_to_string(&marker).unwrap(), "5");
        let names: Vec<_> = std::fs::read_dir(&*s).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names.len(), 2, "no .tmp left behind: {names:?}");
    }

    /// Review r1 (non-blocking): lines the helper had to drop are counted in the marker (a tick Compy
    /// could not deliver reads as unmeasured, never as "no frames"); a count that did not grow writes
    /// nothing.
    #[test]
    fn dropped_lines_raise_the_marker_count_and_are_never_lost() {
        let s = crate::test_scratch::scratch("relay-dropped");
        let (out, marker) = (s.join("fps.json"), s.join("fps.json.snapshot-unreadable"));
        let read = || std::fs::read_to_string(&marker).unwrap();
        let mut c = RelayCounts::default();
        relay_line(Line::Dropped(2), &mut c, &out, &marker);
        assert_eq!(read(), "2");
        relay_line(Line::Unreadable(3), &mut c, &out, &marker);
        assert_eq!(read(), "5", "unreadable plus dropped");
        std::fs::write(&marker, "sentinel").unwrap();
        relay_line(Line::Dropped(2), &mut c, &out, &marker);
        assert_eq!(read(), "sentinel", "a count that did not grow writes nothing");
        relay_line(Line::Dropped(4), &mut c, &out, &marker);
        assert_eq!(read(), "7");
        assert_eq!(c, RelayCounts { unreadable: 3, dropped: 4 });
        assert!(!out.exists(), "counts never touch fps.json");
    }

    #[test]
    fn a_replacing_write_replaces_the_whole_file() {
        let s = crate::test_scratch::scratch("relay-replace");
        let p = s.join("fps.json");
        write_replacing(&p, "a much longer first report");
        write_replacing(&p, "short");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "short");
    }

    /// Source pins: no heartbeat file is left in the app, every launch builds its argv from one pipe,
    /// and the reader accepts only this app's own helper.
    #[test]
    fn every_launch_passes_a_pipe_and_no_path() {
        // Every needle is split with concat! so this test's own text never matches it.
        let src = include_str!("monitoring.rs");
        for gone in [concat!("fps_alive", "_path"), concat!("touch_", "alive"), concat!("\"--fps", "-out\""), concat!("\"--fps", "-alive\"")] {
            assert!(!src.contains(gone), "{gone} must be gone from the app");
        }
        assert_eq!(src.matches(concat!(".args(pipe", ".argv())")).count(), 2, "UAC-off and plain launches use the pipe argv");
        assert_eq!(src.matches(concat!("&argv.each_ref()", ".map(OsStr::new),\n            |pid| pipe.launched_as(pid),\n            || pipe.finished(),\n")).count(), 1, "the elevated launch: pid in, finished before the handle closes (r2 N2)");
        assert_eq!(src.matches(concat!("crate::fps_pipe::", "is_our_helper(pid, &launched)")).count(), 1, "the reader checks its client");
        assert_eq!(src.matches(concat!("pipe.", "finished();")).count(), 5, "every helper end stops its reader");
        // Review r1 B5: each of the three launches hands its started pid to the pipe.
        assert_eq!(src.matches(concat!("pipe.launched_", "as(")).count(), 3, "elevated (pid), UAC-off and plain (child.id())");
        assert_eq!(src.matches(concat!("pipe.launched_", "as(child.id());")).count(), 2);
    }

    /// Review r2 N4, end to end over a real pipe in this process: a reader of generation g relays the
    /// helper's report while g is current, and once generation g+1 starts it writes nothing more and stops.
    #[test]
    fn a_reader_of_an_older_capture_relays_nothing_once_a_newer_one_starts() {
        use std::io::Write;
        use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
        use std::sync::Arc;
        let s = crate::test_scratch::scratch("relay-stale-generation");
        let (out, marker) = (s.join("fps.json"), s.join("fps.json.snapshot-unreadable"));
        let active = Arc::new(AtomicBool::new(true));
        let current = Arc::new(AtomicU64::new(7));
        let done = Arc::new(AtomicBool::new(false));
        let server = crate::fps_pipe::ServerPipe::create().expect("pipe");
        let name = server.name.clone();
        let me = std::process::id();
        let (a, c, d, o, m) = (active.clone(), current.clone(), done.clone(), out.clone(), marker.clone());
        let reader = std::thread::spawn(move || {
            let wanted = || super::reader_wants(&a, &c, 7, &d);
            let in_flight = std::sync::atomic::AtomicU32::new(0);
            let mut counts = RelayCounts::default();
            server.serve(&wanted, &|pid| pid == me, &mut |line| {
                super::write_while_wanted(&in_flight, &wanted, || relay_line(line, &mut counts, &o, &m));
            })
        });
        let mut helper = loop {
            match std::fs::OpenOptions::new().write(true).open(&name) {
                Ok(f) => break f,
                Err(_) => std::thread::sleep(std::time::Duration::from_millis(10)),
            }
        };
        let first = r#"{"pid":1,"fps":60.0}"#;
        writeln!(helper, "{first}").unwrap();
        let until = std::time::Instant::now() + std::time::Duration::from_secs(3);
        while std::fs::read_to_string(&out).ok().as_deref() != Some(first) && std::time::Instant::now() < until {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert_eq!(std::fs::read_to_string(&out).unwrap(), first, "generation 7 is current: relayed");
        current.store(8, Ordering::SeqCst); // the next start
        writeln!(helper, r#"{{"pid":1,"fps":30.0}}"#).unwrap();
        let end = reader.join().unwrap();
        assert_eq!(end, crate::fps_pipe::ServeEnd::NotWanted);
        assert_eq!(std::fs::read_to_string(&out).unwrap(), first, "nothing written for a superseded capture");
        assert!(!marker.exists());
    }

    /// Review r2 N5: a relay write runs only while wanted, announced first, and the stop waits for it.
    #[test]
    fn a_relay_write_is_announced_first_and_never_runs_once_unwanted() {
        use std::sync::atomic::{AtomicU32, Ordering};
        let in_flight = AtomicU32::new(0);
        let mut wrote = 0;
        assert!(super::write_while_wanted(&in_flight, &|| true, || wrote += 1));
        assert!(!super::write_while_wanted(&in_flight, &|| false, || wrote += 1));
        assert_eq!(wrote, 1, "no write once the capture is not wanted");
        assert_eq!(in_flight.load(Ordering::SeqCst), 0, "the announcement is always withdrawn");
        // While a write is announced, the stop's wait holds (bounded); once it is withdrawn, it returns.
        let seen_during = std::cell::Cell::new(0);
        super::write_while_wanted(&in_flight, &|| true, || seen_during.set(in_flight.load(Ordering::SeqCst)));
        assert_eq!(seen_during.get(), 1, "the write runs while announced");
        in_flight.store(1, Ordering::SeqCst);
        let t = std::time::Instant::now();
        assert!(!super::wait_for_relay_writes(&in_flight, std::time::Duration::from_millis(60)));
        assert!(t.elapsed() >= std::time::Duration::from_millis(60));
        in_flight.store(0, Ordering::SeqCst);
        assert!(super::wait_for_relay_writes(&in_flight, std::time::Duration::from_millis(60)));
        // The stop clears the flag (SeqCst) and waits BEFORE it removes fps.json.
        let src = include_str!("monitoring.rs");
        let f = src.find(concat!("fn stop_fps_", "capture_locked()")).unwrap();
        let body = &src[f..f + src[f..].find("\n}\n").unwrap()];
        let clear = body.find(concat!("fps_active().store(false, ", "Ordering::SeqCst)")).expect("SeqCst clear");
        let wait = body.find(concat!("wait_for_relay_", "writes(relay_writes()")).expect("wait");
        let remove = body.find(concat!("remove_file(fps_", "out_path())")).expect("remove");
        assert!(clear < wait && wait < remove, "clear, wait, then remove");
    }
}

#[cfg(test)]
mod game_running_tests {
    //! P5-guided: "the game closed" is said only when its process is gone, never from silence alone.
    use super::{game_running_from, pid_running_as, FpsSample};

    fn sample(pid: u32, name: &str) -> FpsSample {
        serde_json::from_str(&format!(
            r#"{{"pid":{pid},"process_name":"{name}","fps":120.0,"avg_frametime_ms":8.3,"low1_fps":90.0,"frames_last_sec":120,"recent_frametimes_ms":[8.3]}}"#
        ))
        .expect("helper line parses")
    }

    #[test]
    fn nothing_measured_yet_is_unknown() {
        assert_eq!(game_running_from(None, false, |_, _| Some(false)), None);
    }

    #[test]
    fn a_fresh_line_is_a_running_game_without_asking() {
        let s = sample(42, "game.exe");
        assert_eq!(game_running_from(Some(&s), true, |_, _| panic!("no probe for a fresh line")), Some(true));
    }

    #[test]
    fn a_stale_line_asks_the_process_and_says_what_it_answers() {
        let s = sample(42, "game.exe");
        assert_eq!(game_running_from(Some(&s), false, |p, n| { assert_eq!((p, n), (42, "game.exe")); Some(false) }), Some(false));
        assert_eq!(game_running_from(Some(&s), false, |_, _| Some(true)), Some(true), "paused or minimised");
        assert_eq!(game_running_from(Some(&s), false, |_, _| None), None, "access denied is unknown");
    }

    #[test]
    fn a_line_without_a_pid_or_name_says_nothing() {
        assert_eq!(game_running_from(Some(&sample(0, "game.exe")), false, |_, _| Some(false)), None);
        assert_eq!(game_running_from(Some(&sample(42, " ")), false, |_, _| Some(false)), None);
    }

    #[test]
    fn the_probe_reads_this_process_as_running_and_another_name_as_not() {
        let me = std::process::id();
        let exe = std::env::current_exe().expect("own exe");
        let name = exe.file_name().and_then(|n| n.to_str()).expect("exe name");
        assert_eq!(pid_running_as(me, name), Some(true));
        assert_eq!(pid_running_as(me, "surely-not-this.exe"), Some(false), "a reused pid is not the game");
    }

    #[test]
    fn the_probe_reads_an_exited_process_as_closed() {
        let mut child = crate::sys_exe::sys_command(crate::sys_exe::SysTool::Cmd).args(["/C", "exit 0"]).spawn().expect("spawn cmd");
        let pid = child.id();
        child.wait().expect("cmd exits");
        // `wait()` reaps the child but keeps its handle open (`child` is still in scope), the same
        // state as a launcher holding a handle to a game that closed. The probe must read it as closed
        // (the snapshot no longer lists it); the handle is dropped only after.
        assert_eq!(pid_running_as(pid, "cmd.exe"), Some(false));
        drop(child);
        // And still closed once the handle is released (gone, or reused by another image).
        assert_eq!(pid_running_as(pid, "cmd.exe"), Some(false));
    }
}

#[cfg(test)]
mod background_sample_tests {
    //! P4-comparable: only a helper line that positively says "not in front" is left out.
    use super::FpsSample;

    /// Whether the session would measure this helper line: the loop hands `foreground` to
    /// `SessionAccumulator::record_tick` as it is.
    fn sample_is_measured(s: &FpsSample) -> bool {
        let mut acc = crate::sessions::SessionAccumulator::new("t".into(), Some(0));
        acc.record_tick(&s.process_name, s.fps, s.avg_frametime_ms, s.low1_fps, 0, s.foreground)
    }

    const BASE: &str = r#""pid":1,"process_name":"game.exe","fps":120.0,"avg_frametime_ms":8.3,"low1_fps":90.0,"frames_last_sec":120,"recent_frametimes_ms":[8.3]"#;

    fn parse(extra: &str) -> FpsSample {
        serde_json::from_str(&format!("{{{BASE}{extra}}}")).expect("helper line parses")
    }

    #[test]
    fn an_older_helper_line_without_the_field_is_measured() {
        assert!(sample_is_measured(&parse("")));
    }

    #[test]
    fn in_front_and_unknown_are_measured_behind_is_left_out() {
        assert!(sample_is_measured(&parse(r#","foreground":true"#)));
        assert!(sample_is_measured(&parse(r#","foreground":null"#)));
        assert!(!sample_is_measured(&parse(r#","foreground":false"#)));
    }

    /// P4-smooth-measure: the histogram is read from a new helper's line, missing from an older
    /// helper's, and never forwarded to the UI.
    #[test]
    fn the_frame_histogram_is_read_but_never_sent_to_the_ui() {
        assert_eq!(parse("").frame_hist, None);
        let s = parse(r#","frame_hist":{"id":9,"counts":[[143,250],[300,2]]}"#);
        let h = s.frame_hist.clone().expect("histogram read");
        assert_eq!((h.id, h.counts), (9, vec![(143, 250), (300, 2)]));
        let ui = serde_json::to_value(&s).unwrap();
        assert!(ui.get("frame_hist").is_none(), "{ui}");
    }
}

#[cfg(test)]
mod capture_generation_tests {
    use super::*;
    use std::sync::atomic::Ordering;

    // Codebase review 2026-11-02: a stop then a start inside one recorder tick left the old recorder
    // and heartbeat running beside the new ones, because each read only `fps_active`.
    #[test]
    fn a_capture_superseded_by_a_newer_one_is_neither_current_nor_live() {
        let generation = capture_gen().fetch_add(1, Ordering::AcqRel) + 1;
        assert!(capture_current(generation));
        capture_gen().fetch_add(1, Ordering::AcqRel); // the next start
        assert!(!capture_current(generation) && !capture_live(generation));
        // Every loop the start spawns asks for its own capture, never the shared flag alone. Tokens
        // are built by concat! so this test's own lines don't match the scan.
        let src = include_str!("monitoring.rs");
        let start = src.find(concat!("pub(crate) fn ", "start_fps_capture()")).expect("start");
        let body = &src[start..src[start..].find(concat!("pub(crate) fn ", "uac_disabled()")).map(|e| start + e).expect("next fn")];
        // Hardening slice 2: the heartbeat thread is gone (the pipe is the heartbeat), so the recorder is
        // the one loop left in the start; the pipe's reader asks for its own capture in
        // start_capture_pipe (pinned below, outside this body).
        assert_eq!(body.matches(concat!("while capture_", "live(generation)")).count(), 1, "the recorder");
        assert!(!body.contains(concat!("while fps_", "active().load")), "a loop that reads only the flag outlives a stop");
        assert_eq!(src.matches(concat!("let wanted = || reader_", "wants(fps_active(), capture_gen(), generation, &done);")).count(), 1, "the pipe reader");
    }

    // CR-capture-async: start and stop now run on the blocking pool. A stop issued while a start is
    // inside its (up to 5 s) wait must run AFTER that start and leave capture off; without the lock
    // it ran first and the start then turned capture back on. Fakes stand in for the two bodies so
    // the test touches no helper, file or Windows state; the last assertion pins that the real
    // commands go through the same lock.
    #[test]
    fn a_stop_issued_during_a_start_runs_after_it_and_leaves_capture_off() {
        use std::sync::atomic::AtomicBool;
        use std::sync::{mpsc, Arc, Mutex};
        let on = Arc::new(AtomicBool::new(false));
        let log = Arc::new(Mutex::new(Vec::<&str>::new()));
        // Its own lock and tickets, so tests running alongside can't move them.
        let ctl = Arc::new(Mutex::new(0u64));
        let seq = Arc::new(std::sync::atomic::AtomicU64::new(0));
        let ticket = {
            let seq = seq.clone();
            move || seq.fetch_add(1, Ordering::SeqCst) + 1
        };

        // Start, then stop, one after the other: off at the end.
        in_order_on(&ctl, ticket(), || (), || on.store(true, Ordering::SeqCst));
        in_order_on(&ctl, ticket(), || (), || on.store(false, Ordering::SeqCst));
        assert!(!on.load(Ordering::SeqCst));

        // A stop issued while a start is still waiting.
        let (entered_tx, entered_rx) = mpsc::channel();
        let start = {
            let (on, log, ctl, t) = (on.clone(), log.clone(), ctl.clone(), ticket());
            std::thread::spawn(move || {
                in_order_on(&ctl, t, || (), || {
                    log.lock().unwrap().push("start-begin");
                    entered_tx.send(()).unwrap();
                    std::thread::sleep(std::time::Duration::from_millis(300)); // the old-helper wait
                    on.store(true, Ordering::SeqCst); // flag up, helper launched
                    log.lock().unwrap().push("start-end");
                })
            })
        };
        entered_rx.recv().unwrap();
        let stop = {
            let (on, log, ctl, t) = (on.clone(), log.clone(), ctl.clone(), ticket());
            std::thread::spawn(move || {
                in_order_on(&ctl, t, || (), || {
                    log.lock().unwrap().push("stop");
                    on.store(false, Ordering::SeqCst);
                })
            })
        };
        start.join().unwrap();
        stop.join().unwrap();
        assert_eq!(*log.lock().unwrap(), vec!["start-begin", "start-end", "stop"], "the stop overtook the start");
        assert!(!on.load(Ordering::SeqCst), "capture left on after a stop");

        // A start that panicked must not leave stop locked out.
        let t = ticket();
        let ctl2 = ctl.clone();
        let _ = std::thread::spawn(move || in_order_on(&ctl2, t, || (), || panic!("start failed"))).join();
        in_order_on(&ctl, ticket(), || (), || on.store(false, Ordering::SeqCst));

        // The served commands take the process lock in ticket order. Tokens built by concat! so
        // this test can't match itself.
        let src = include_str!("monitoring.rs");
        assert!(src.contains(concat!("capture_in_order(ticket, superseded_start, ", "start_fps_capture_locked)")));
        assert!(src.contains(concat!("capture_in_order(ticket, || (), ", "stop_fps_capture_locked)")));
        assert!(src.contains(concat!("in_order_on(capture_", "ctl(), ticket, superseded, f)")));
    }

    // CR-capture-last-wins: the lock is not FIFO. With a start holding it, a later stop and a later
    // start may take it in either order; the user's last press must win. The requests are replayed
    // in every acquisition order (the race's possible outcomes) on fake bodies.
    #[test]
    fn the_last_capture_request_wins_whatever_order_the_lock_is_taken_in() {
        use std::sync::Mutex;
        // `presses`: (ticket, wants on). `order`: the order the lock is acquired in.
        let replay = |presses: &[(u64, bool)], order: &[usize]| -> bool {
            let ctl = Mutex::new(0u64);
            let mut on = false;
            for &i in order {
                let (t, want) = presses[i];
                in_order_on(&ctl, t, || (), || on = want);
            }
            on
        };
        let start_stop_start = [(1, true), (2, false), (3, true)];
        for order in [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] {
            assert!(replay(&start_stop_start, &order), "start → stop → start ended off (lock order {order:?})");
        }
        let start_stop = [(1, true), (2, false)];
        for order in [[0, 1], [1, 0]] {
            assert!(!replay(&start_stop, &order), "start → stop ended on (lock order {order:?})");
        }
        // A superseded request answers what it was given and runs nothing.
        let ctl = Mutex::new(0u64);
        assert_eq!(in_order_on(&ctl, 5, || "superseded", || "ran"), "ran");
        assert_eq!(in_order_on(&ctl, 4, || "superseded", || "ran"), "superseded");
        // CR-capture-superseded: a start a later stop overtook says capture is not running; one a
        // later start overtook says Ok (capture is on). The old code answered Ok to both.
        assert_eq!(superseded_start_answer(false), Err(CAPTURE_SUPERSEDED.to_string()));
        assert_eq!(superseded_start_answer(true), Ok(()));
        let ctl = Mutex::new(0u64);
        let on = std::cell::Cell::new(false);
        let stop_ran = in_order_on(&ctl, 2, || "superseded", || {
            on.set(false);
            "ran"
        });
        assert_eq!(stop_ran, "ran");
        let start = in_order_on(&ctl, 1, || superseded_start_answer(on.get()), || {
            on.set(true);
            Ok(())
        });
        assert_eq!(start, Err(CAPTURE_SUPERSEDED.to_string()), "a start the stop overtook answered Ok");
        assert!(!on.get());
        // The window matches the same words (review r1 NIT).
        assert!(include_str!("../../src/surfaces/GuidedJourney.tsx")
            .contains(&format!("CAPTURE_SUPERSEDED = \"{CAPTURE_SUPERSEDED}\"")));
        // Tickets rise in the order they are taken.
        let (a, b) = (capture_ticket(), capture_ticket());
        assert!(b > a);
    }
}

/// M6-unread: "Compy couldn't read this second" is its own state: never 0 fps, never "no frames".
#[cfg(test)]
mod unreadable_tests {
    use super::{
        gate_unreadable, parse_unreadable_ticks, unreadable_read, FpsSample, FpsStatus, UnreadRead,
    };
    use std::time::Duration;

    const S: fn(f64) -> Duration = Duration::from_secs_f64;

    #[test]
    fn the_app_reads_the_file_the_helper_writes() {
        let path = super::fps_unreadable_path();
        let name = path.file_name().unwrap().to_string_lossy().into_owned();
        assert_eq!(name, format!("fps.json{}", crate::fps::UNREADABLE_SUFFIX));
        assert_eq!(path.parent(), super::fps_out_path().parent(), "beside fps.json, as the helper writes it");
    }

    #[test]
    fn the_marker_text_is_a_whole_count_or_nothing() {
        assert_eq!(parse_unreadable_ticks("12"), Some(12));
        assert_eq!(parse_unreadable_ticks(" 7\r\n"), Some(7));
        for bad in ["", "  ", "abc", "-1", "1.5", "12 ticks"] {
            assert_eq!(parse_unreadable_ticks(bad), None, "{bad:?} is no count");
        }
    }

    #[test]
    fn a_fresh_marker_newer_than_the_last_report_reads_as_this_second_unreadable() {
        // Marker written 0.2 s ago; the last report is 2.5 s old (the helper has skipped since).
        assert!(unreadable_read(Some(5), Some(S(0.2)), Some(S(2.5)), 0).now);
        // No report was ever written (the game never presented a readable tick).
        assert!(unreadable_read(Some(1), Some(S(0.1)), None, 0).now);
    }

    #[test]
    fn a_helper_that_recovered_a_stale_marker_and_no_marker_are_not_unreadable() {
        // The helper wrote a report AFTER the marker: it can look again.
        assert!(!unreadable_read(Some(5), Some(S(1.0)), Some(S(0.3)), 5).now);
        // A marker left behind (older than the freshness window) is history, not now.
        assert!(!unreadable_read(Some(5), Some(S(9.0)), Some(S(20.0)), 0).now);
        // No marker at all: the helper never missed.
        assert_eq!(unreadable_read(None, None, Some(S(0.4)), 0), UnreadRead { ticks: 0, now: false });
    }

    #[test]
    fn the_count_is_the_larger_of_the_marker_and_the_last_report() {
        assert_eq!(unreadable_read(Some(3), Some(S(30.0)), Some(S(0.2)), 8).ticks, 8);
        assert_eq!(unreadable_read(Some(9), Some(S(0.2)), Some(S(2.0)), 4).ticks, 9);
        assert_eq!(unreadable_read(None, None, None, 0).ticks, 0);
    }

    #[test]
    fn an_unreadable_second_withholds_the_report_on_disk_and_says_why() {
        let now = UnreadRead { ticks: 4, now: true };
        assert_eq!(gate_unreadable(Some("stale report"), now), (None, true), "not re-recorded as this second's");
        assert_eq!(gate_unreadable::<&str>(None, now), (None, true), "no report at all is still unreadable, not silent");
        let ok = UnreadRead { ticks: 4, now: false };
        assert_eq!(gate_unreadable(Some("live"), ok), (Some("live"), false));
        assert_eq!(gate_unreadable::<&str>(None, ok), (None, false), "no frames stays no frames");
    }

    fn line(extra: &str) -> FpsSample {
        serde_json::from_str(&format!(
            r#"{{"pid":4,"process_name":"g.exe","fps":60.0,"avg_frametime_ms":16.6,"low1_fps":50.0,"frames_last_sec":60,"recent_frametimes_ms":[16.6]{extra}}}"#
        ))
        .unwrap()
    }

    #[test]
    fn the_helpers_count_loads_and_an_older_line_without_it_reads_as_none_said() {
        assert_eq!(line("").snapshot_unreadable_ticks, 0);
        assert_eq!(line(r#","snapshot_unreadable_ticks":3"#).snapshot_unreadable_ticks, 3);
    }

    #[test]
    fn the_status_names_the_unreadable_state_only_when_there_is_one() {
        let status = |now: bool, ticks: u64| {
            serde_json::to_value(FpsStatus {
                active: true,
                status: "running".into(),
                sample: None,
                game_running: None,
                progress: None,
                unreadable_now: now,
                unreadable_ticks: ticks,
                prompt_free: false,
            })
            .unwrap()
        };
        let quiet = status(false, 0);
        assert!(quiet.get("unreadable_now").is_none() && quiet.get("unreadable_ticks").is_none(), "{quiet}");
        let loud = status(true, 9);
        assert_eq!(loud["unreadable_now"], true);
        assert_eq!(loud["unreadable_ticks"], 9);
        assert!(loud["sample"].is_null(), "an unreadable second shows no sample");
    }

    /// The recorder's per-second wiring, reader output to session record: the same two functions the
    /// recorder thread calls, driven with what the helper leaves on disk. Only the file reads and the
    /// session tracker are outside this seam.
    #[test]
    fn reader_output_reaches_the_session_as_the_helpers_counter_delta_not_the_flag() {
        use super::{feed_unreadable, unreadable_second};
        use std::time::Duration as D;
        let mut acc = crate::sessions::SessionAccumulator::new("2026-11-21T00:00:00Z".into(), Some(0));
        acc.unreadable_counter_baseline(0);
        // What the helper left on disk each second: marker count, marker age, report age, ticks the report
        // carries, and whether a report exists.
        type Disk = (Option<u64>, Option<D>, Option<D>, u64, bool);
        let seconds: [Disk; 5] = [
            (None, None, Some(D::from_millis(200)), 0, true),                         // fine
            (Some(6), Some(D::from_millis(500)), Some(D::from_secs(3)), 6, true),     // snapshot unreadable: report is older
            (Some(6), Some(D::from_millis(1500)), Some(D::from_millis(100)), 6, true), // recovered: report newer than marker
            (Some(2), Some(D::from_millis(500)), Some(D::from_secs(3)), 2, true),     // helper restarted: counter went back
            (None, None, None, 0, false),                                              // nothing on disk at all
        ];
        let mut flagged_seconds = 0;
        let mut recorded = 0;
        let mut refreshed = Vec::new();
        for (marker, m_age, s_age, ticks, has_report) in seconds {
            let (sample, flagged, unread) = unreadable_second(has_report.then_some("report"), ticks, marker, m_age, s_age);
            if sample.is_some() {
                recorded += 1;
            }
            if flagged {
                flagged_seconds += 1;
            }
            refreshed.push(feed_unreadable(&mut acc, unread, flagged));
        }
        assert_eq!(flagged_seconds, 2, "the live flag saw two seconds (about half the ticks)");
        assert_eq!(recorded, 2, "a report older than the marker is not re-recorded as that second's");
        assert_eq!(refreshed, [false, true, false, true, false], "progress is refreshed only when something changed");
        acc.record_tick("g.exe", 60.0, 16.6, 50.0, 1, Some(true));
        let summary = acc.finalize(100);
        assert_eq!(summary.unreadable_seconds, 4, "6 ticks + 2 after the restart = 8 half-second ticks = 4 s, from the counter, not the 2 flagged seconds");
    }

    /// The Rust half of the wire contract: `src/test/fixtures/unreadable.wire.json` is what serde emits
    /// today; `src/unreadable-contract.test.ts` holds the TypeScript types to the same file.
    #[test]
    fn the_wire_fixture_is_what_serde_emits() {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../../src/test/fixtures/unreadable.wire.json")).unwrap();
        let mut acc = crate::sessions::SessionAccumulator::new("2026-11-21T00:00:00Z".into(), Some(0));
        acc.record_tick("g.exe", 98.5, 10.1, 80.0, 0, Some(true));
        acc.unreadable_counter_baseline(0);
        acc.observe_unreadable_counter(8); // 8 half-second ticks = 4 s
        let progress = acc.progress();
        let status = serde_json::to_value(FpsStatus {
            active: true,
            status: "running".into(),
            sample: None,
            game_running: None,
            progress: Some(progress),
            unreadable_now: true,
            unreadable_ticks: 9,
            prompt_free: false,
        })
        .unwrap();
        assert_eq!(status["unreadable_now"], fixture["fps_status"]["unreadable_now"]);
        assert_eq!(status["unreadable_ticks"], fixture["fps_status"]["unreadable_ticks"]);
        assert_eq!(status["progress"], fixture["fps_status"]["progress"]);
        assert_eq!(status, fixture["fps_status"], "the whole status, key for key");
        let mut again = crate::sessions::SessionAccumulator::new("2026-11-21T00:00:00Z".into(), Some(0));
        again.record_tick("g.exe", 98.5, 10.1, 80.0, 0, Some(true));
        again.unreadable_counter_baseline(0);
        again.observe_unreadable_counter(24); // 24 ticks = 12 s
        let summary = serde_json::to_value(again.finalize(100)).unwrap();
        assert_eq!(summary["unreadable_seconds"], fixture["session_unreadable_seconds"]);
    }
}

#[cfg(test)]
mod elevated_helper_status_tests {
    use super::elevated_helper_status;
    use std::os::windows::process::ExitStatusExt;

    /// a1b review: elevate_and_wait's own refusal showed no prompt, so the capture status must not say
    /// the user declined one. A real decline (os error 1223) and a helper that ran and died keep
    /// today's "declined"; a clean exit is "stopped".
    #[test]
    fn a_refused_launch_target_is_a_failed_launch_not_a_decline() {
        let refused = std::io::Error::new(std::io::ErrorKind::InvalidInput, "refused: not a Compy target");
        let s = elevated_helper_status(&Err(refused));
        assert!(s.starts_with("failed to launch helper: "), "{s}");
        assert_ne!(s, "declined");
        assert_eq!(elevated_helper_status(&Err(std::io::Error::from_raw_os_error(1223))), "declined");
        assert_eq!(elevated_helper_status(&Ok(std::process::ExitStatus::from_raw(1))), "declined");
        assert_eq!(elevated_helper_status(&Ok(std::process::ExitStatus::from_raw(0))), "stopped");
    }

    /// Review r1 B1: the helper's own refusals happen after the user APPROVED the prompt, so they are
    /// failed launches that say which, never "declined". Both the elevated status and the plain path's
    /// fallback text read them.
    #[test]
    fn the_helpers_own_refusals_are_failed_launches_not_declines() {
        let pipe = elevated_helper_status(&Ok(std::process::ExitStatus::from_raw(crate::fps::EXIT_PIPE_NOT_CONFIRMED as u32)));
        assert_eq!(pipe, "failed to launch helper: the capture helper could not confirm it was talking to Compy");
        let args = elevated_helper_status(&Ok(std::process::ExitStatus::from_raw(crate::fps::EXIT_REFUSED_ARGS as u32)));
        assert_eq!(args, "failed to launch helper: the capture helper refused its arguments");
        // Neighbours keep their meaning: 1 (the ETW session failed) and 3 stay "declined" as before.
        for other in [1u32, 3, 5] {
            assert_eq!(elevated_helper_status(&Ok(std::process::ExitStatus::from_raw(other))), "declined", "{other}");
        }
        let plain = super::plain_exit_text(&Ok(std::process::ExitStatus::from_raw(4)));
        assert!(plain.ends_with(": the capture helper could not confirm it was talking to Compy"), "{plain}");
        assert!(super::plain_exit_fallback_reason(&plain, std::time::Duration::from_millis(300), true)
            .is_some_and(|r| r.contains("could not confirm it was talking to Compy")));
        assert_eq!(super::plain_exit_text(&Ok(std::process::ExitStatus::from_raw(1))), std::process::ExitStatus::from_raw(1).to_string());
    }
}

// D1-S1: starting the capture helper without elevation when the account already allows it. Nothing
// here starts a trace, a helper or a process: the token bytes are built by hand and the launchers are
// fakes, so the order of the calls is what is pinned.
#[cfg(test)]
mod plain_start_tests {
    use super::*;
    use std::cell::{Cell, RefCell};
    use std::time::Duration;

    const EVERYONE: [u8; 12] = [1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0]; // S-1-1-0
    const USERS: [u8; 16] = [1, 2, 0, 0, 0, 0, 0, 5, 32, 0, 0, 0, 0x21, 0x02, 0, 0]; // S-1-5-32-545
    const PERF_MONITOR_USERS: [u8; 16] = [1, 2, 0, 0, 0, 0, 0, 5, 32, 0, 0, 0, 0x2E, 0x02, 0, 0]; // S-1-5-32-558, the neighbour
    const ENABLED: u32 = 0x7; // mandatory | enabled by default | enabled
    const NOT_ENABLED: u32 = 0x3; // mandatory | enabled by default, switched off
    const DENY_ONLY: u32 = 0x10;

    /// A `TOKEN_GROUPS` buffer shaped like `GetTokenInformation(TokenGroups)` returns it on x64: count,
    /// padding, 16-byte (pointer, attributes) entries, then the SIDs in the same buffer.
    fn token_groups(groups: &[(&[u8], u32)]) -> Vec<u8> {
        let sid_bytes: usize = groups.iter().map(|(s, _)| s.len()).sum();
        let mut buf = vec![0u8; 8 + groups.len() * 16 + sid_bytes];
        buf[0..4].copy_from_slice(&(groups.len() as u32).to_le_bytes());
        let base = buf.as_ptr() as usize;
        let mut sid_at = 8 + groups.len() * 16;
        for (i, (sid, attrs)) in groups.iter().enumerate() {
            let at = 8 + i * 16;
            buf[at..at + 8].copy_from_slice(&((base + sid_at) as u64).to_le_bytes());
            buf[at + 8..at + 12].copy_from_slice(&attrs.to_le_bytes());
            buf[sid_at..sid_at + sid.len()].copy_from_slice(sid);
            sid_at += sid.len();
        }
        buf
    }

    fn access(groups: &[(&[u8], u32)]) -> PerfLogAccess {
        perf_log_access_from_token_groups(&token_groups(groups))
    }

    #[test]
    fn the_sid_constant_is_s_1_5_32_559() {
        let s = PERF_LOG_USERS_SID;
        let sub = |i: usize| u32::from_le_bytes(s[8 + 4 * i..12 + 4 * i].try_into().unwrap());
        assert_eq!((s[0], s[1], s[7]), (1, 2, 5), "revision 1, two sub-authorities, NT authority");
        assert_eq!(format!("S-{}-{}-{}-{}", s[0], s[7], sub(0), sub(1)), "S-1-5-32-559");
    }

    #[test]
    fn the_group_counts_only_when_it_is_enabled_in_the_token() {
        let plu = &PERF_LOG_USERS_SID[..];
        assert_eq!(access(&[(&EVERYONE, ENABLED), (&USERS, ENABLED), (plu, ENABLED)]), PerfLogAccess::InToken);
        assert_eq!(access(&[(plu, ENABLED), (&EVERYONE, ENABLED)]), PerfLogAccess::InToken, "first or last");
        assert_eq!(access(&[(plu, 0x4)]), PerfLogAccess::InToken, "the enabled bit alone");
        assert_eq!(access(&[(plu, NOT_ENABLED)]), PerfLogAccess::NotInToken, "switched off");
        assert_eq!(access(&[(plu, 0)]), PerfLogAccess::NotInToken);
        assert_eq!(access(&[(plu, DENY_ONLY)]), PerfLogAccess::NotInToken, "deny-only");
        assert_eq!(access(&[(plu, DENY_ONLY | 0x4)]), PerfLogAccess::NotInToken, "deny-only wins over enabled");
        assert_eq!(access(&[(&EVERYONE, ENABLED), (&USERS, ENABLED)]), PerfLogAccess::NotInToken);
        assert_eq!(access(&[(&PERF_MONITOR_USERS, ENABLED)]), PerfLogAccess::NotInToken, "S-1-5-32-558 is not it");
        assert_eq!(access(&[]), PerfLogAccess::NotInToken, "a token with no groups");
    }

    #[test]
    fn a_malformed_group_list_is_unknown_never_a_guess() {
        let good = token_groups(&[(&PERF_LOG_USERS_SID, ENABLED)]);
        assert_eq!(perf_log_access_from_token_groups(&[]), PerfLogAccess::Unknown, "empty");
        assert_eq!(perf_log_access_from_token_groups(&good[..6]), PerfLogAccess::Unknown, "cut inside the header");
        assert_eq!(perf_log_access_from_token_groups(&good[..20]), PerfLogAccess::Unknown, "cut inside an entry");
        let mut many = good.clone();
        many[0..4].copy_from_slice(&5000u32.to_le_bytes());
        assert_eq!(perf_log_access_from_token_groups(&many), PerfLogAccess::Unknown, "absurd count");
        let mut foreign = good.clone();
        foreign[8..16].copy_from_slice(&7u64.to_le_bytes());
        assert_eq!(perf_log_access_from_token_groups(&foreign), PerfLogAccess::Unknown, "pointer outside the buffer");
        let mut huge = good.clone();
        huge[8..16].copy_from_slice(&u64::MAX.to_le_bytes());
        assert_eq!(perf_log_access_from_token_groups(&huge), PerfLogAccess::Unknown, "a pointer that would overflow");
        // A SID that claims more sub-authorities than the buffer holds. Built fresh and changed IN
        // PLACE (a clone has a new address while its pointers still point into the original, which
        // would turn this into the "pointer outside the buffer" case). The control is unchanged.
        let mut long_sid = token_groups(&[(&PERF_LOG_USERS_SID, ENABLED)]);
        assert_eq!(perf_log_access_from_token_groups(&long_sid), PerfLogAccess::InToken, "control");
        long_sid[8 + 16 + 1] = 200; // claims 200 sub-authorities: runs past the end
        assert_eq!(perf_log_access_from_token_groups(&long_sid), PerfLogAccess::Unknown, "a SID longer than the buffer");
        // And an unknown answer never starts a plain helper.
        assert!(!plain_start_applies(false, Some(false), PerfLogAccess::Unknown));
    }

    /// The real read of this test process's own token gives an answer (whatever this PC's groups are)
    /// and opens nothing else.
    #[test]
    fn the_own_token_read_works_on_this_pc() {
        assert!(own_token_perf_log_access().is_some(), "this process's token groups could not be read");
        assert!(process_is_elevated().is_some(), "this process's elevation could not be read");
    }

    #[test]
    fn a_plain_start_needs_uac_on_an_unelevated_app_and_the_group() {
        for uac_off in [false, true] {
            for elevated in [Some(false), Some(true), None] {
                for acc in [PerfLogAccess::InToken, PerfLogAccess::NotInToken, PerfLogAccess::Unknown] {
                    let want = !uac_off && elevated == Some(false) && acc == PerfLogAccess::InToken;
                    assert_eq!(plain_start_applies(uac_off, elevated, acc), want, "{uac_off} {elevated:?} {acc:?}");
                }
            }
        }
    }

    /// Run `start_helper` over fakes; the log records which of the three actions ran, in order.
    fn run(spawn_fails: Option<&str>) -> (Started, Vec<String>) {
        let log = RefCell::new(Vec::<String>::new());
        let (started, child) = start_helper(
            || {
                log.borrow_mut().push("spawn plain".into());
                match spawn_fails {
                    Some(why) => Err(why.to_string()),
                    None => Ok(7u8),
                }
            },
            || log.borrow_mut().push("elevated launch".into()),
            |reason| log.borrow_mut().push(format!("note: {reason}")),
        );
        assert_eq!(child.is_some(), started == Started::Plain);
        (started, log.into_inner())
    }

    #[test]
    fn with_the_group_the_plain_start_is_tried_and_the_elevated_launch_is_not_requested() {
        let (started, log) = run(None);
        assert_eq!(started, Started::Plain);
        assert_eq!(log, ["spawn plain"], "no elevated launch, no UAC prompt");
    }

    #[test]
    fn when_the_plain_start_fails_the_elevated_launch_takes_over_and_the_reason_is_noted() {
        let (started, log) = run(Some("access denied"));
        assert_eq!(started, Started::Elevated);
        assert_eq!(log, ["spawn plain", "note: access denied", "elevated launch"], "the reason first, then today's launch, once");
    }

    #[test]
    fn without_the_group_the_launch_is_todays_elevated_one() {
        // The decision point in start_fps_capture_locked: only plain_start_applies picks the plain path.
        let src = include_str!("monitoring.rs").replace("\r\n", "\n");
        let at = src.find(concat!("} else if plain_start_applies(false, process_is_elevated(), ", "perf_log_access()) {")).unwrap();
        let branch = &src[at..at + src[at..].find("\n    }\n").unwrap()];
        assert!(branch.contains(concat!("start_plain_or_", "elevated(exe, generation);")));
        assert!(branch.contains(concat!("} else {\n        launch_elevated_", "helper(exe, generation);")));
    }

    #[test]
    fn a_plain_helper_that_dies_at_once_falls_back_once_and_never_mid_session() {
        let early = Duration::from_millis(300);
        let late = PLAIN_START_WINDOW + Duration::from_secs(1);
        let reason = plain_exit_fallback_reason("exit code: 1", early, true);
        assert!(reason.as_deref().is_some_and(|r| r.contains("exit code: 1") && r.contains("did not start")));
        // Died after the window (a crash mid-game): no sudden prompt over the game.
        assert_eq!(plain_exit_fallback_reason("exit code: 1", late, true), None);
        // The user stopped the capture: nothing to start again.
        assert_eq!(plain_exit_fallback_reason("exit code: 0", early, false), None);
    }

    /// Review S1: the fallback runs in capture order. Driven on a private lock with fakes.
    #[test]
    fn the_fallback_launches_only_if_this_capture_is_still_live_under_the_capture_lock() {
        let lock = Mutex::new(0u64);
        let (elevated, notes) = (Cell::new(0), RefCell::new(Vec::<String>::new()));
        let fall_back = |wanted: bool| {
            fall_back_in_order(
                &lock,
                || {
                    // The capture lock is HELD while "still wanted" is read.
                    assert!(lock.try_lock().is_err(), "the capture state must be read under the capture lock");
                    wanted
                },
                |w| plain_exit_fallback_reason("exit code: 1", Duration::from_millis(300), w),
                || elevated.set(elevated.get() + 1),
                |r| notes.borrow_mut().push(r.to_string()),
            )
        };
        assert!(fall_back(true));
        assert_eq!((elevated.get(), notes.borrow().len()), (1, 1), "one elevated launch, reason noted first");
        // A Stop (or Stop+Start) got the lock first: this capture is no longer live. No prompt.
        assert!(!fall_back(false));
        assert_eq!((elevated.get(), notes.borrow().len()), (1, 1), "nothing launched for a stopped capture");
        // The real call site passes the process capture lock and this capture's generation.
        let src = include_str!("monitoring.rs").replace("\r\n", "\n");
        let f = src.find(concat!("fn start_plain_or_", "elevated(")).unwrap();
        let body = &src[f..f + src[f..].find("\n}\n").unwrap()];
        assert!(body.contains(concat!("fall_back_in_", "order(\n            capture_ctl(),\n            || capture_live(generation),")));
    }

    #[test]
    fn the_no_prompt_line_is_true_only_while_a_plain_start_applies_and_has_not_failed() {
        assert!(prompt_free_from(true, false));
        assert!(!prompt_free_from(true, true), "after a failed plain start the room stops saying it");
        assert!(!prompt_free_from(false, false));
        assert!(!prompt_free_from(false, true));
        // On the wire it is omitted while false (an older reader sees no change).
        let status = |prompt_free: bool| {
            serde_json::to_value(FpsStatus {
                active: false,
                status: "idle".into(),
                sample: None,
                game_running: None,
                progress: None,
                unreadable_now: false,
                unreadable_ticks: 0,
                prompt_free,
            })
            .unwrap()
        };
        assert!(status(false).get("prompt_free").is_none());
        assert_eq!(status(true)["prompt_free"], true);
    }

    #[test]
    fn the_helper_path_must_be_absolute_with_no_parent_steps() {
        use std::path::Path;
        assert!(checked_helper_path(Path::new(r"C:\Program Files\Compy\compy.exe")).is_ok());
        assert!(checked_helper_path(Path::new("compy.exe")).is_err(), "relative");
        assert!(checked_helper_path(Path::new(r"..\compy.exe")).is_err(), "relative with ..");
        assert!(checked_helper_path(Path::new(r"C:\Program Files\Compy\..\Evil\compy.exe")).is_err(), "..");
    }

    // The command line of the plain start is the elevated one: five arguments, nothing added. Since
    // hardening slice 2 the five are this launch's pipe and the app's pid (no path), for all three
    // launches, built by one function.
    #[test]
    fn the_plain_helper_gets_the_same_five_arguments_and_the_elevated_call_is_untouched() {
        let pipe = crate::fps_pipe::pipe_name_from([0xcd; 16]);
        assert_eq!(helper_argv(&pipe, 4242), ["--fps-capture", "--pipe", pipe.as_str(), "--parent-pid", "4242"]);
        // The helper accepts exactly what the app passes.
        let mut argv = vec!["compy.exe".to_string()];
        argv.extend(helper_argv(&pipe, 4242));
        assert_eq!(
            crate::fps::parse_capture_args(&argv),
            Ok(crate::fps::CaptureMode::Pipe { name: pipe.clone(), parent_pid: 4242 })
        );
        let src = include_str!("monitoring.rs");
        assert_eq!(src.matches(concat!("crate::actions::", "elevate_and_wait_with(")).count(), 1);
        let call = src.find(concat!("crate::actions::", "elevate_and_wait_with(")).unwrap();
        let args = &src[call..call + src[call..].find(");").unwrap()];
        assert!(args.contains(concat!("&argv.each_ref()", ".map(OsStr::new)")), "the elevated launch passes the same argv");
        let pre = &src[..call];
        assert!(pre[pre.rfind("std::thread::spawn").unwrap()..].contains(concat!("let argv = pipe", ".argv();")));
        // The plain launch adds nothing: no extra argument, no environment, no other program.
        let start = src.find(concat!("fn spawn_plain_", "helper(")).unwrap();
        let body = &src[start..start + src[start..].find("\n}\n").unwrap()];
        assert!(body.contains(concat!(".args(pipe", ".argv())")));
        for forbidden in [".arg(", ".env(", ".envs(", "Command::new(\"", "cmd", "powershell", "runas"] {
            assert!(!body.contains(forbidden), "the plain launch must not use {forbidden}");
        }
    }

    // Anti-cheat: the D1-S1 code opens no process handle; the only handle it opens is our own token.
    #[test]
    fn the_plain_path_opens_no_process_handle_but_our_own_token() {
        let mon = include_str!("monitoring.rs");
        let from = mon.find(concat!("// ─── D1-S1: start the capture helper ", "without")).unwrap();
        let to = from + mon[from..].find(concat!("// ─── end ", "D1-S1")).unwrap();
        let region = &mon[from..to];
        assert!(!region.contains(concat!("Open", "Process(")), "the launch/token code opens a process handle");
        assert!(!region.contains(concat!("Duplicate", "Handle")));
        assert!(region.contains(concat!("Open", "ProcessToken(GetCurrentProcess()")), "it reads our OWN token");
        for other in ["sysinfo", "Toolhelp", "EnumProcesses", "refresh_processes"] {
            assert!(!region.contains(other), "the launch/token code enumerates processes: {other}");
        }
    }

    // Owner territory: Compy changes no Windows group. This walks every Rust source under src/.
    #[test]
    fn nothing_in_the_crate_changes_group_membership() {
        fn walk(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
            for e in std::fs::read_dir(dir).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    walk(&p, out);
                } else if p.extension().is_some_and(|x| x == "rs") {
                    out.push(p);
                }
            }
        }
        let mut files = Vec::new();
        walk(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src"), &mut files);
        assert!(files.len() > 40, "the walk found only {} files", files.len());
        let forbidden = [
            concat!("netlocalgroup", "addmembers"),
            concat!("netlocalgroup", "setmembers"),
            concat!("netlocalgroup", "delmembers"),
            concat!("netlocalgroup", "add("),
            concat!("netgroup", "adduser"),
            concat!("netuser", "setgroups"),
            concat!("net local", "group"),
            concat!("net.exe local", "group"),
            concat!("add-local", "groupmember"),
            concat!("remove-local", "groupmember"),
            concat!("add-adgroup", "member"),
        ];
        for f in files {
            let text = std::fs::read_to_string(&f).unwrap_or_default().to_lowercase();
            for token in forbidden {
                assert!(!text.contains(token), "{} changes group membership ({token})", f.display());
            }
        }
    }
}

#[cfg(test)]
mod uac_cache_tests {
    use super::{uac_cache_value, uac_from_cache};

    /// A2b: the status poll reads a cached EnableLUA answer; only a capture start re-reads the registry.
    #[test]
    fn the_status_poll_uses_the_cached_uac_read_and_a_capture_start_refreshes_it() {
        assert_eq!(uac_from_cache(0), None, "not read yet");
        for off in [true, false] {
            assert_eq!(uac_from_cache(uac_cache_value(off)), Some(off));
        }
        let src = include_str!("monitoring.rs").replace("\r\n", "\n");
        let body = |head: &str| {
            let f = src.find(head).unwrap_or_else(|| panic!("{head}"));
            src[f..f + src[f..].find("\n}\n").unwrap()].to_string()
        };
        let poll = body(concat!("fn prompt_free_", "now()"));
        assert!(poll.contains(concat!("uac_disabled_", "cached()")), "{poll}");
        assert!(!poll.contains(concat!("uac_disabled()", "")), "the poll must not read the registry: {poll}");
        let start = body(concat!("fn start_fps_capture_", "locked()"));
        assert!(start.contains(concat!("if uac_disabled_", "refreshed() {")), "a capture start re-reads EnableLUA");
    }
}