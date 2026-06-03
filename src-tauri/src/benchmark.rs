//! Benchmark + Score engine (F6) — **PARKED + DARK**.
//!
//! Design: `docs/superpowers/specs/2026-06-02-benchmark-score-engine-design.md`.
//! Merge contract: `docs/BENCHMARK_INTEGRATION_PLAN.md` (HQ).
//!
//! This increment is the **pure score/standing core** only — types + a transparent,
//! data-driven scoring function + tests. It mutates nothing, runs nothing, and is
//! **not registered** in `lib.rs`'s `invoke_handler` (truly dark). The actual benchmark
//! workloads (CPU/RAM/disk runners) and the gated `benchmark_enabled()` command land in
//! later increments / at HQ integration. Honesty: every point traces to a real measured
//! component score or a real credited change — no fabricated number (spec §1, §2).
#![allow(dead_code)] // parked/dark: items are wired by HQ when the Benchmark tab lands.

use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// What the user cares about — weights the standing toward their goals (spec §4).
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug, Hash)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Intent {
    Fps,
    Latency,
    Smoothness,
    Thermals,
    Quality,
    PeaceOfMind,
}

impl Intent {
    const ALL: [Intent; 6] = [
        Intent::Fps,
        Intent::Latency,
        Intent::Smoothness,
        Intent::Thermals,
        Intent::Quality,
        Intent::PeaceOfMind,
    ];
}

/// A benchmarkable component.
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Component {
    Cpu,
    Ram,
    Disk,
    Gpu,
}

/// Where a credited win came from — the "you + Sentinel, together" split (spec §4).
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum CreditSource {
    /// Applied a Sentinel recommendation that's still active.
    Guided,
    /// A good state the user achieved themselves (detected, not Sentinel-applied).
    SelfDirected,
}

/// A normalized per-component score from a benchmark run. `measured = false` means the
/// component couldn't be benchmarked this run — honest partial coverage, never a guess.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct ComponentScore {
    pub component: Component,
    /// 0..=100 normalized; only meaningful when `measured`.
    pub score: u32,
    pub measured: bool,
}

/// One credited win, traceable to a real applied change or a detected good state.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct Credit {
    pub id: String,
    pub label: String,
    pub points: i32,
    pub source: CreditSource,
    pub intents: Vec<Intent>,
}

/// Decoupled inputs to the pure scorer (assembled by the command wrapper at wire time).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub(crate) struct StandingInputs {
    pub components: Vec<ComponentScore>,
    pub credits: Vec<Credit>,
    pub selected_intents: Vec<Intent>,
    /// Last tier shown to the user, to detect crossings. `None` on first run.
    pub previous_tier: Option<u8>,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct IntentScore {
    pub intent: Intent,
    pub points: i32,
}

#[derive(Serialize, Clone, Debug, Default)]
pub(crate) struct Breakdown {
    pub guided: i32,
    pub self_directed: i32,
    pub by_intent: Vec<IntentScore>,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Direction {
    Up,
    Down,
}

/// Emitted **only on a tier crossing**, once per crossing — the seam the design lane
/// subscribes to for its single tasteful cosmetic shift (spec §5). The engine never
/// touches UI.
#[derive(Serialize, Clone, Debug)]
pub(crate) struct SyncLevelEvent {
    pub from_level: u8,
    pub to_level: u8,
    pub direction: Direction,
    pub reason: String,
    pub intents_satisfied: Vec<Intent>,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct Standing {
    pub score: u32,
    pub tier: u8,
    pub tier_name: &'static str,
    /// Points to the next tier, or `None` at the top tier.
    pub next_tier_delta: Option<u32>,
    pub breakdown: Breakdown,
    pub events: Vec<SyncLevelEvent>,
    /// Honest coverage: how many components were actually benchmarked.
    pub measured_components: usize,
    pub total_components: usize,
}

/// Tier thresholds as **data**, not magic numbers scattered in code (spec §5).
/// `(min_score_inclusive, placeholder_name)`. Names are placeholders — final naming is
/// the design lane's. (Continuity with the concept mockup: Dialed → Locked-In.)
const TIERS: &[(u32, &str)] = &[
    (0, "Booting"),
    (250, "Warming Up"),
    (500, "Dialed"),
    (750, "Locked-In"),
];

/// Map a score to `(1-based tier, name, points-to-next-tier)`.
fn tier_for(score: u32) -> (u8, &'static str, Option<u32>) {
    let mut idx = 0usize;
    for (i, (min, _)) in TIERS.iter().enumerate() {
        if score >= *min {
            idx = i;
        }
    }
    let name = TIERS[idx].1;
    let next_delta = TIERS.get(idx + 1).map(|(min, _)| min - score);
    ((idx as u8) + 1, name, next_delta)
}

/// Intent weight: a credit whose intents intersect the user's selected intents counts at
/// full weight; others at 0.75 — still real, just less emphasized. With no intents
/// selected, everything is full weight (universal / zero-setup, spec §4).
fn weight_for(credit_intents: &[Intent], selected: &[Intent]) -> f64 {
    if selected.is_empty() {
        return 1.0;
    }
    if credit_intents.iter().any(|i| selected.contains(i)) {
        1.0
    } else {
        0.75
    }
}

/// Pure, transparent scorer. Base comes from measured component scores; credits add real,
/// traceable points; intents weight them; tiers come from the data table; a crossing
/// vs `previous_tier` emits exactly one event. No hidden formula (spec §1, §4).
pub(crate) fn compute_standing(inputs: &StandingInputs) -> Standing {
    let total_components = inputs.components.len();
    let measured: Vec<u32> = inputs
        .components
        .iter()
        .filter(|c| c.measured)
        .map(|c| c.score)
        .collect();
    let measured_components = measured.len();

    // Base: average measured component score (0..=100) scaled into a 0..=600 band.
    let base: i32 = if measured.is_empty() {
        0
    } else {
        let avg = measured.iter().sum::<u32>() as f64 / measured.len() as f64;
        (avg * 6.0).round() as i32
    };

    let selected = &inputs.selected_intents;
    let mut guided = 0i32;
    let mut self_directed = 0i32;
    let mut credit_total = 0i32;
    for c in &inputs.credits {
        let pts = (c.points as f64 * weight_for(&c.intents, selected)).round() as i32;
        credit_total += pts;
        match c.source {
            CreditSource::Guided => guided += pts,
            CreditSource::SelfDirected => self_directed += pts,
        }
    }

    let by_intent: Vec<IntentScore> = Intent::ALL
        .iter()
        .filter_map(|intent| {
            let sum: i32 = inputs
                .credits
                .iter()
                .filter(|c| c.intents.contains(intent))
                .map(|c| (c.points as f64 * weight_for(&c.intents, selected)).round() as i32)
                .sum();
            (sum != 0).then_some(IntentScore { intent: *intent, points: sum })
        })
        .collect();

    let score = (base + credit_total).max(0) as u32;
    let (tier, tier_name, next_tier_delta) = tier_for(score);

    let mut events = Vec::new();
    if let Some(prev) = inputs.previous_tier {
        if tier != prev {
            let direction = if tier > prev { Direction::Up } else { Direction::Down };
            let reason = match direction {
                Direction::Up => format!("Crossed into tier {tier} — {tier_name}."),
                Direction::Down => {
                    format!("Dropped to tier {tier} — {tier_name} (a change was reverted).")
                }
            };
            events.push(SyncLevelEvent {
                from_level: prev,
                to_level: tier,
                direction,
                reason,
                intents_satisfied: by_intent.iter().map(|i| i.intent).collect(),
            });
        }
    }

    Standing {
        score,
        tier,
        tier_name,
        next_tier_delta,
        breakdown: Breakdown { guided, self_directed, by_intent },
        events,
        measured_components,
        total_components,
    }
}

// ── Benchmark runners (increment 2a): native CPU + RAM raw measurement ──────────────
//
// Honest RAW throughput only. Normalization to 0..=100 uses PLACEHOLDER reference
// constants (see `refs`) that are NOT tuned baselines — rough seeds to be replaced per
// spec §6 (the owner's weighting/baseline open call). Disk runner + GPU are later
// increments. All workloads are parameterized (tests use tiny params), cancellable, and
// have **no side effects** (no files, no system changes).

pub(crate) struct RunConfig {
    pub cpu_ms: u64,
    pub ram_mb: usize,
    pub ram_passes: usize,
    pub disk_mb: usize,
}
impl Default for RunConfig {
    fn default() -> Self {
        Self { cpu_ms: 600, ram_mb: 64, ram_passes: 4, disk_mb: 256 }
    }
}
impl RunConfig {
    /// Tiny params for tests — fast, won't hammer the machine.
    fn tiny() -> Self {
        Self { cpu_ms: 15, ram_mb: 2, ram_passes: 1, disk_mb: 4 }
    }
}

/// Raw CPU throughput in thousands-of-iterations/sec. No normalization here.
pub(crate) struct CpuRaw {
    pub single_kops: f64,
    pub multi_kops: f64,
    pub threads: usize,
}

/// A mixed integer kernel; counts iterations completed before `deadline`. Checks `cancel`
/// between chunks (time/flag checks amortized over a chunk of work).
fn cpu_kernel(deadline: Instant, cancel: &AtomicBool) -> u64 {
    let mut acc: u64 = 0;
    let mut x: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut iters: u64 = 0;
    while Instant::now() < deadline {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        for _ in 0..4096 {
            x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            acc = acc.wrapping_add(x ^ (x >> 33));
        }
        iters += 4096;
    }
    std::hint::black_box(acc);
    iters
}

pub(crate) fn bench_cpu(cfg: &RunConfig, cancel: &AtomicBool) -> CpuRaw {
    let budget = Duration::from_millis(cfg.cpu_ms);

    let start = Instant::now();
    let single_iters = cpu_kernel(start + budget, cancel);
    let single_secs = start.elapsed().as_secs_f64().max(1e-6);
    let single_kops = single_iters as f64 / 1000.0 / single_secs;

    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    let start = Instant::now();
    let deadline = start + budget;
    let total: u64 = std::thread::scope(|s| {
        let handles: Vec<_> =
            (0..threads).map(|_| s.spawn(|| cpu_kernel(deadline, cancel))).collect();
        handles.into_iter().map(|h| h.join().unwrap_or(0)).sum()
    });
    let multi_secs = start.elapsed().as_secs_f64().max(1e-6);
    let multi_kops = total as f64 / 1000.0 / multi_secs;

    CpuRaw { single_kops, multi_kops, threads }
}

/// Raw memory bandwidth in MB/s (write + read sweeps over a working set).
pub(crate) struct RamRaw {
    pub bandwidth_mb_s: f64,
}

/// Raw GPU compute throughput in GFLOP/s (D3D11 compute, FMA-heavy kernel).
pub(crate) struct GpuRaw {
    pub gflops: f64,
}

pub(crate) fn bench_ram(cfg: &RunConfig, cancel: &AtomicBool) -> RamRaw {
    let elems = (cfg.ram_mb * 1024 * 1024 / std::mem::size_of::<u64>()).max(1);
    let mut buf = vec![0u64; elems];
    let bytes_per_pass = (buf.len() * std::mem::size_of::<u64>()) as f64 * 2.0; // write + read
    let start = Instant::now();
    let mut total_bytes = 0.0;
    for p in 0..cfg.ram_passes.max(1) {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        for (i, slot) in buf.iter_mut().enumerate() {
            *slot = (i as u64) ^ (p as u64);
        }
        let mut acc = 0u64;
        for &v in &buf {
            acc = acc.wrapping_add(v);
        }
        std::hint::black_box(acc);
        total_bytes += bytes_per_pass;
    }
    let secs = start.elapsed().as_secs_f64().max(1e-6);
    RamRaw { bandwidth_mb_s: total_bytes / (1024.0 * 1024.0) / secs }
}

/// Raw sequential disk throughput in MB/s. (Read can be cache-influenced right after a
/// write without admin-only unbuffered I/O — an approximate signal, like other consumer
/// benchmarks; documented as such.)
pub(crate) struct DiskRaw {
    pub seq_write_mb_s: f64,
    pub seq_read_mb_s: f64,
}

/// Deletes the temp file on drop — covers early return, cancellation, and panic.
struct TempFileGuard(std::path::PathBuf);
impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

static DISK_SEQ: AtomicU64 = AtomicU64::new(0);

/// Sequential write+read benchmark over a temp file in `dir`. Modest size, fsync'd for an
/// honest write number, file **always** cleaned up (guard). Cancellable; any I/O error or
/// cancellation → None (honest "not measured"), never a panic. No user files touched.
pub(crate) fn bench_disk(cfg: &RunConfig, cancel: &AtomicBool, dir: &Path) -> Option<DiskRaw> {
    let uniq = DISK_SEQ.fetch_add(1, Ordering::Relaxed);
    let path = dir.join(format!("sentinel_bench_{}_{}.tmp", std::process::id(), uniq));
    let _guard = TempFileGuard(path.clone());

    let size = cfg.disk_mb.max(1) * 1024 * 1024;
    let chunk = vec![0xA5u8; 1024 * 1024];

    // sequential write (fsync'd so the number reflects the device, not just the cache)
    let write_secs = {
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(&path)
            .ok()?;
        let start = Instant::now();
        let mut written = 0usize;
        while written < size {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            f.write_all(&chunk).ok()?;
            written += chunk.len();
        }
        f.flush().ok()?;
        f.sync_all().ok()?;
        start.elapsed().as_secs_f64().max(1e-6)
    };

    // sequential read
    let read_secs = {
        let mut f = std::fs::File::open(&path).ok()?;
        let mut buf = vec![0u8; 1024 * 1024];
        let start = Instant::now();
        loop {
            if cancel.load(Ordering::Relaxed) {
                return None;
            }
            let n = f.read(&mut buf).ok()?;
            if n == 0 {
                break;
            }
            std::hint::black_box(buf[0]);
        }
        start.elapsed().as_secs_f64().max(1e-6)
    };

    let mb = size as f64 / (1024.0 * 1024.0);
    Some(DiskRaw { seq_write_mb_s: mb / write_secs, seq_read_mb_s: mb / read_secs })
    // _guard drops here → temp file removed
}

/// PLACEHOLDER reference constants — the raw value that maps to score 100. **Not** tuned
/// baselines; rough seeds to be replaced per spec §6 (owner weighting/baseline call). The
/// RAW metrics above are the honest signal; these only shape the cosmetic 0..=100.
mod refs {
    pub const CPU_SINGLE_KOPS_100: f64 = 200_000.0;
    pub const CPU_MULTI_KOPS_100: f64 = 2_000_000.0;
    pub const RAM_MB_S_100: f64 = 30_000.0;
    pub const GPU_GFLOPS_100: f64 = 12_000.0;
    pub const DISK_MB_S_100: f64 = 5_000.0;
}

fn normalize(raw: f64, ref_100: f64) -> u32 {
    ((raw / ref_100) * 100.0).round().clamp(0.0, 100.0) as u32
}

/// GPU compute benchmark via D3D11 (reuses the `windows` crate — no new heavy dependency,
/// consistent with the codebase's dep-minimalism). Vendor graphics API, anti-cheat-safe
/// (no injection, no kernel driver) — same class as the existing DXGI/ADLX usage. The
/// unsafe is fully self-contained and `Result`-based: any failure (no GPU, headless/RDP
/// session, driver issue) returns `None` → honest "not measured", never a panic.
/// Cancellable between dispatch repeats.
mod gpu {
    use super::{GpuRaw, RunConfig};
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Instant;
    use windows::core::{s, Result};
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::Fxc::D3DCompile;
    use windows::Win32::Graphics::Direct3D::{D3D_DRIVER_TYPE_HARDWARE, ID3DBlob};
    use windows::Win32::Graphics::Direct3D11::*;
    use windows::Win32::Graphics::Dxgi::Common::DXGI_FORMAT_UNKNOWN;

    // FMA-heavy kernel: each thread runs 2048 iterations of two fused multiply-adds.
    const SHADER: &str = "RWStructuredBuffer<float> Out : register(u0);\n\
        [numthreads(64,1,1)]\n\
        void main(uint3 tid : SV_DispatchThreadID){\n\
        float a = float(tid.x)*0.0001 + 1.0; float b = 1.0;\n\
        [loop] for(int i=0;i<2048;i++){ b = mad(b,1.0000001,a); a = mad(a,0.9999999,b); }\n\
        Out[tid.x] = a + b; }";

    const ITERS_PER_THREAD: u64 = 2048;
    const FLOPS_PER_ITER: u64 = 4; // two mad = 4 flops
    const GROUPS: u32 = 256; // × 64 threads/group
    const REPEATS: u32 = 64;

    pub(super) fn bench_gpu(_cfg: &RunConfig, cancel: &AtomicBool) -> Option<GpuRaw> {
        match unsafe { run(cancel) } {
            Ok(gflops) if gflops.is_finite() && gflops > 0.0 => Some(GpuRaw { gflops }),
            _ => None,
        }
    }

    unsafe fn run(cancel: &AtomicBool) -> Result<f64> {
        let mut device: Option<ID3D11Device> = None;
        let mut context: Option<ID3D11DeviceContext> = None;
        D3D11CreateDevice(
            None,
            D3D_DRIVER_TYPE_HARDWARE,
            HMODULE::default(),
            D3D11_CREATE_DEVICE_FLAG(0),
            None,
            D3D11_SDK_VERSION,
            Some(&mut device),
            None,
            Some(&mut context),
        )?;
        let device = device.ok_or_else(windows::core::Error::from_win32)?;
        let context = context.ok_or_else(windows::core::Error::from_win32)?;

        // compile the compute shader at runtime (d3dcompiler ships with Windows)
        let src = SHADER.as_bytes();
        let mut code: Option<ID3DBlob> = None;
        let mut errors: Option<ID3DBlob> = None;
        D3DCompile(
            src.as_ptr() as *const _,
            src.len(),
            s!("bench.hlsl"),
            None,
            None,
            s!("main"),
            s!("cs_5_0"),
            0,
            0,
            &mut code,
            Some(&mut errors),
        )?;
        let code = code.ok_or_else(windows::core::Error::from_win32)?;
        let bytecode =
            std::slice::from_raw_parts(code.GetBufferPointer() as *const u8, code.GetBufferSize());

        let mut shader: Option<ID3D11ComputeShader> = None;
        device.CreateComputeShader(bytecode, None, Some(&mut shader))?;
        let shader = shader.ok_or_else(windows::core::Error::from_win32)?;

        let elem_count = (GROUPS * 64) as usize;
        let byte_width = (elem_count * 4) as u32;

        let buf_desc = D3D11_BUFFER_DESC {
            ByteWidth: byte_width,
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_UNORDERED_ACCESS.0 as u32,
            CPUAccessFlags: 0,
            MiscFlags: D3D11_RESOURCE_MISC_BUFFER_STRUCTURED.0 as u32,
            StructureByteStride: 4,
        };
        let mut buffer: Option<ID3D11Buffer> = None;
        device.CreateBuffer(&buf_desc, None, Some(&mut buffer))?;
        let buffer = buffer.ok_or_else(windows::core::Error::from_win32)?;

        let uav_desc = D3D11_UNORDERED_ACCESS_VIEW_DESC {
            Format: DXGI_FORMAT_UNKNOWN,
            ViewDimension: D3D11_UAV_DIMENSION_BUFFER,
            Anonymous: D3D11_UNORDERED_ACCESS_VIEW_DESC_0 {
                Buffer: D3D11_BUFFER_UAV {
                    FirstElement: 0,
                    NumElements: elem_count as u32,
                    Flags: 0,
                },
            },
        };
        let mut uav: Option<ID3D11UnorderedAccessView> = None;
        device.CreateUnorderedAccessView(&buffer, Some(&uav_desc), Some(&mut uav))?;
        let uav = uav.ok_or_else(windows::core::Error::from_win32)?;

        let staging_desc = D3D11_BUFFER_DESC {
            ByteWidth: byte_width,
            Usage: D3D11_USAGE_STAGING,
            BindFlags: 0,
            CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
            MiscFlags: 0,
            StructureByteStride: 4,
        };
        let mut staging: Option<ID3D11Buffer> = None;
        device.CreateBuffer(&staging_desc, None, Some(&mut staging))?;
        let staging = staging.ok_or_else(windows::core::Error::from_win32)?;

        context.CSSetShader(&shader, None);
        context.CSSetUnorderedAccessViews(0, 1, Some(&Some(uav)), None);

        // warm-up dispatch (first-use allocation / shader residency), not timed
        context.Dispatch(GROUPS, 1, 1);
        context.Flush();

        let start = Instant::now();
        let mut done: u32 = 0;
        for _ in 0..REPEATS {
            if cancel.load(Ordering::Relaxed) {
                break;
            }
            context.Dispatch(GROUPS, 1, 1);
            done += 1;
        }
        // force GPU completion: copy to a staging buffer and map it (Map blocks until done)
        context.CopyResource(&staging, &buffer);
        let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
        context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped))?;
        let first = *(mapped.pData as *const f32);
        context.Unmap(&staging, 0);
        let secs = start.elapsed().as_secs_f64().max(1e-6);
        std::hint::black_box(first);

        if done == 0 {
            return Ok(0.0); // cancelled before any timed work
        }
        let total_flops = done as u64 * elem_count as u64 * ITERS_PER_THREAD * FLOPS_PER_ITER;
        Ok(total_flops as f64 / secs / 1e9)
    }
}

/// Run the available native components (CPU, RAM) → normalized `ComponentScore`s. Disk +
/// GPU are later increments, so coverage is honestly partial. Cancellable; no side effects.
pub(crate) fn run_components(cfg: &RunConfig, cancel: &AtomicBool) -> Vec<ComponentScore> {
    let cpu = bench_cpu(cfg, cancel);
    let cpu_score = (normalize(cpu.single_kops, refs::CPU_SINGLE_KOPS_100)
        + normalize(cpu.multi_kops, refs::CPU_MULTI_KOPS_100))
        / 2;
    let ram = bench_ram(cfg, cancel);
    let gpu = match gpu::bench_gpu(cfg, cancel) {
        Some(g) => ComponentScore {
            component: Component::Gpu,
            score: normalize(g.gflops, refs::GPU_GFLOPS_100),
            measured: true,
        },
        None => ComponentScore { component: Component::Gpu, score: 0, measured: false },
    };
    let disk = match bench_disk(cfg, cancel, &std::env::temp_dir()) {
        Some(d) => ComponentScore {
            component: Component::Disk,
            score: (normalize(d.seq_write_mb_s, refs::DISK_MB_S_100)
                + normalize(d.seq_read_mb_s, refs::DISK_MB_S_100))
                / 2,
            measured: true,
        },
        None => ComponentScore { component: Component::Disk, score: 0, measured: false },
    };
    vec![
        ComponentScore { component: Component::Cpu, score: cpu_score, measured: true },
        ComponentScore {
            component: Component::Ram,
            score: normalize(ram.bandwidth_mb_s, refs::RAM_MB_S_100),
            measured: true,
        },
        gpu,
        disk,
    ]
}

#[cfg(test)]
mod benchmark_tests {
    use super::*;

    fn comp(component: Component, score: u32, measured: bool) -> ComponentScore {
        ComponentScore { component, score, measured }
    }
    fn credit(points: i32, source: CreditSource, intents: &[Intent]) -> Credit {
        Credit {
            id: "x".into(),
            label: "x".into(),
            points,
            source,
            intents: intents.to_vec(),
        }
    }
    fn intent_pts(s: &Standing, want: Intent) -> i32 {
        s.breakdown.by_intent.iter().find(|i| i.intent == want).map(|i| i.points).unwrap_or(0)
    }

    #[test]
    fn empty_inputs_degrade_gracefully() {
        let s = compute_standing(&StandingInputs::default());
        assert_eq!(s.score, 0);
        assert_eq!(s.tier, 1);
        assert_eq!(s.tier_name, "Booting");
        assert!(s.events.is_empty());
        assert_eq!(s.measured_components, 0);
    }

    #[test]
    fn base_comes_from_measured_components_only() {
        // One measured at 100, one unmeasured → avg of measured = 100 → base 600.
        let inputs = StandingInputs {
            components: vec![comp(Component::Cpu, 100, true), comp(Component::Gpu, 0, false)],
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        assert_eq!(s.score, 600);
        assert_eq!(s.tier, 3); // >=500 "Dialed"
        assert_eq!(s.tier_name, "Dialed");
        assert_eq!(s.measured_components, 1);
        assert_eq!(s.total_components, 2);
    }

    #[test]
    fn credits_split_guided_vs_self_directed() {
        let inputs = StandingInputs {
            credits: vec![
                credit(40, CreditSource::Guided, &[Intent::Latency]),
                credit(20, CreditSource::SelfDirected, &[Intent::Latency]),
            ],
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        assert_eq!(s.breakdown.guided, 40);
        assert_eq!(s.breakdown.self_directed, 20);
        assert_eq!(s.score, 60);
        assert_eq!(intent_pts(&s, Intent::Latency), 60);
    }

    #[test]
    fn selected_intents_weight_matching_credits_higher() {
        // Selected = Latency. Latency credit full; FPS credit at 0.75.
        let inputs = StandingInputs {
            credits: vec![
                credit(40, CreditSource::Guided, &[Intent::Latency]),
                credit(20, CreditSource::SelfDirected, &[Intent::Fps]),
            ],
            selected_intents: vec![Intent::Latency],
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        assert_eq!(s.breakdown.guided, 40);
        assert_eq!(s.breakdown.self_directed, 15); // round(20 * 0.75)
        assert_eq!(s.score, 55);
        assert_eq!(intent_pts(&s, Intent::Fps), 15);
    }

    #[test]
    fn tier_crossing_up_emits_one_up_event() {
        let inputs = StandingInputs {
            components: vec![comp(Component::Cpu, 100, true)], // base 600 → tier 3
            previous_tier: Some(2),
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        assert_eq!(s.tier, 3);
        assert_eq!(s.events.len(), 1);
        assert_eq!(s.events[0].direction, Direction::Up);
        assert_eq!(s.events[0].from_level, 2);
        assert_eq!(s.events[0].to_level, 3);
    }

    #[test]
    fn tier_regression_emits_down_event() {
        // avg 50 → base 300 → tier 2; previously at tier 3.
        let inputs = StandingInputs {
            components: vec![comp(Component::Cpu, 50, true)],
            previous_tier: Some(3),
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        assert_eq!(s.tier, 2);
        assert_eq!(s.events.len(), 1);
        assert_eq!(s.events[0].direction, Direction::Down);
        assert_eq!(s.events[0].from_level, 3);
        assert_eq!(s.events[0].to_level, 2);
    }

    #[test]
    fn no_event_when_tier_unchanged() {
        let inputs = StandingInputs {
            components: vec![comp(Component::Cpu, 100, true)], // tier 3
            previous_tier: Some(3),
            ..Default::default()
        };
        assert!(compute_standing(&inputs).events.is_empty());
    }

    #[test]
    fn peace_of_mind_path_scores_without_any_tweaks() {
        // No measured components, no applied tweaks — pure "we checked, you're good" credit.
        let inputs = StandingInputs {
            credits: vec![credit(80, CreditSource::SelfDirected, &[Intent::PeaceOfMind])],
            selected_intents: vec![Intent::PeaceOfMind],
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        assert_eq!(s.score, 80);
        assert_eq!(intent_pts(&s, Intent::PeaceOfMind), 80);
        assert_eq!(s.measured_components, 0); // climbed with zero benchmarked components
    }

    #[test]
    fn by_intent_omits_zero_intents() {
        let inputs = StandingInputs {
            credits: vec![credit(10, CreditSource::Guided, &[Intent::Thermals])],
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        // Only Thermals should appear.
        assert_eq!(s.breakdown.by_intent.len(), 1);
        assert_eq!(s.breakdown.by_intent[0].intent, Intent::Thermals);
    }

    #[test]
    fn top_tier_has_no_next_delta() {
        let inputs = StandingInputs {
            credits: vec![credit(800, CreditSource::Guided, &[])],
            ..Default::default()
        };
        let s = compute_standing(&inputs);
        assert_eq!(s.tier, 4);
        assert_eq!(s.tier_name, "Locked-In");
        assert!(s.next_tier_delta.is_none());
    }

    // ── runner tests (assert shape/invariants, never exact timing) ──

    #[test]
    fn cpu_runner_produces_positive_throughput() {
        let cancel = AtomicBool::new(false);
        let raw = bench_cpu(&RunConfig::tiny(), &cancel);
        assert!(raw.single_kops > 0.0);
        assert!(raw.multi_kops > 0.0);
        assert!(raw.threads >= 1);
    }

    #[test]
    fn ram_runner_produces_positive_bandwidth() {
        let cancel = AtomicBool::new(false);
        let raw = bench_ram(&RunConfig::tiny(), &cancel);
        assert!(raw.bandwidth_mb_s > 0.0);
    }

    #[test]
    fn precancelled_cpu_returns_fast_and_does_not_hang() {
        let cancel = AtomicBool::new(true); // pre-cancelled
        let t = Instant::now();
        let _ = bench_cpu(&RunConfig::default(), &cancel); // 600ms budget, but cancelled
        assert!(t.elapsed() < Duration::from_millis(400)); // bails well under budget
    }

    #[test]
    fn run_components_covers_native_set_and_feeds_scorer() {
        let cancel = AtomicBool::new(false);
        let comps = run_components(&RunConfig::tiny(), &cancel);
        assert_eq!(comps.len(), 4); // cpu, ram, gpu, disk
        // cpu + ram always measured; gpu/disk measured when available
        assert!(comps.iter().filter(|c| c.measured).count() >= 2);
        assert!(comps.iter().all(|c| c.score <= 100));
        let measured = comps.iter().filter(|c| c.measured).count();
        // end-to-end: measured components feed the pure scorer with honest coverage
        let s = compute_standing(&StandingInputs { components: comps, ..Default::default() });
        assert_eq!(s.measured_components, measured);
        assert_eq!(s.total_components, 4);
        assert!(s.tier >= 1);
    }

    #[test]
    fn gpu_runner_is_graceful_never_panics() {
        let cancel = AtomicBool::new(false);
        // Either a real GPU result (positive GFLOP/s) or None — must never panic.
        if let Some(raw) = gpu::bench_gpu(&RunConfig::tiny(), &cancel) {
            assert!(raw.gflops > 0.0);
        }
    }

    #[test]
    fn disk_runner_measures_and_cleans_up() {
        let cancel = AtomicBool::new(false);
        // isolated dir so the cleanup assertion is immune to parallel tests
        let dir = std::env::temp_dir().join(format!("sentinel_disktest_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        if let Some(d) = bench_disk(&RunConfig::tiny(), &cancel, &dir) {
            assert!(d.seq_write_mb_s > 0.0 && d.seq_read_mb_s > 0.0);
        }
        let leftover = std::fs::read_dir(&dir).map(|it| it.count()).unwrap_or(0);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(leftover, 0, "disk runner left a temp file behind");
    }

    #[test]
    fn normalize_clamps_to_0_100() {
        assert_eq!(normalize(0.0, 100.0), 0);
        assert_eq!(normalize(50.0, 100.0), 50);
        assert_eq!(normalize(1000.0, 100.0), 100); // clamped
    }
}
