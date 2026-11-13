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

/// Where a credited win came from — the "you + Compy, together" split (spec §4).
#[derive(Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum CreditSource {
    /// Applied a Compy recommendation that's still active.
    Guided,
    /// A good state the user achieved themselves (detected, not Compy-applied).
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
    /// Best-of-N: how many times each component runs (best sample kept, variance flagged).
    pub repeats: usize,
}
impl Default for RunConfig {
    fn default() -> Self {
        Self { cpu_ms: 600, ram_mb: 64, ram_passes: 4, disk_mb: 256, repeats: 3 }
    }
}
impl RunConfig {
    /// Tiny params for tests — fast, won't hammer the machine.
    fn tiny() -> Self {
        Self { cpu_ms: 15, ram_mb: 2, ram_passes: 1, disk_mb: 4, repeats: 1 }
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
    // Do-while: always run at least one chunk unless pre-cancelled. A starved thread that
    // is scheduled only after a short deadline already elapsed must still measure real work
    // (else throughput reads 0 and false-fails the shape invariant). Cancel is still checked
    // before every chunk; the deadline is checked after, so a long run stops on time.
    loop {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        for _ in 0..4096 {
            x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            acc = acc.wrapping_add(x ^ (x >> 33));
        }
        iters += 4096;
        if Instant::now() >= deadline {
            break;
        }
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
    let path = dir.join(format!("compy_bench_{}_{}.tmp", std::process::id(), uniq));
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
    // Fail SAFE on the honesty boundary: a non-finite measurement (Inf/NaN) or an invalid
    // reference must never fabricate a score. An `Inf` raw would otherwise `.round().clamp()`
    // straight to a maxed-out 100 — an unmeasured "perfect" result, the worst honesty failure.
    // The raw producers already guard their divisors (`.max(1e-6)` / `is_finite`), so this is
    // defense-in-depth that keeps a future producer-guard regression honest (0 = no credit)
    // instead of inventing a win. A legitimately-zero raw still scores an honest 0.
    if !raw.is_finite() || !ref_100.is_finite() || ref_100 <= 0.0 {
        return 0;
    }
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
/// Honest run-confidence: a `Clean` run is presentable; `Low` means components varied
/// enough between repeats that the number shouldn't be trusted as-is.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RunConfidence {
    Clean,
    Low,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub(crate) struct RunReport {
    pub components: Vec<ComponentScore>,
    pub confidence: RunConfidence,
    pub notes: Vec<String>,
}

/// Best-of-N with a variance flag: runs `once` up to `repeats` times, returns the BEST
/// (cleanest) normalized score plus whether the samples spread enough to call the run
/// low-confidence. `None` if every attempt failed (component unavailable) or it was
/// cancelled before any sample landed.
fn measure(repeats: usize, cancel: &AtomicBool, mut once: impl FnMut() -> Option<u32>) -> Option<(u32, bool)> {
    let mut samples: Vec<u32> = Vec::new();
    for _ in 0..repeats.max(1) {
        if cancel.load(Ordering::Relaxed) {
            break;
        }
        if let Some(s) = once() {
            samples.push(s);
        }
    }
    let best = *samples.iter().max()?;
    Some((best, high_variance(&samples)))
}

/// True when ≥2 samples spread more than ~20% (coefficient of variation) — a sign of a
/// noisy / throttled / contended run that shouldn't be presented as a clean number.
fn high_variance(samples: &[u32]) -> bool {
    if samples.len() < 2 {
        return false;
    }
    let mean = samples.iter().map(|&s| s as f64).sum::<f64>() / samples.len() as f64;
    if mean <= 0.0 {
        return false;
    }
    let var = samples.iter().map(|&s| (s as f64 - mean).powi(2)).sum::<f64>() / samples.len() as f64;
    (var.sqrt() / mean) > 0.20
}

fn to_comp(component: Component, m: Option<(u32, bool)>) -> (ComponentScore, bool) {
    match m {
        Some((score, low)) => (ComponentScore { component, score, measured: true }, low),
        None => (ComponentScore { component, score: 0, measured: false }, false),
    }
}

/// Run the full local benchmark — best-of-N per component (CPU/RAM/GPU/disk) — and report
/// the scores plus an honest run-confidence signal. Dark/parked, not registered.
pub(crate) fn run_benchmark(cfg: &RunConfig, cancel: &AtomicBool) -> RunReport {
    let (cpu, c1) = to_comp(
        Component::Cpu,
        measure(cfg.repeats, cancel, || {
            let c = bench_cpu(cfg, cancel);
            Some(
                (normalize(c.single_kops, refs::CPU_SINGLE_KOPS_100)
                    + normalize(c.multi_kops, refs::CPU_MULTI_KOPS_100))
                    / 2,
            )
        }),
    );
    let (ram, c2) = to_comp(
        Component::Ram,
        measure(cfg.repeats, cancel, || {
            Some(normalize(bench_ram(cfg, cancel).bandwidth_mb_s, refs::RAM_MB_S_100))
        }),
    );
    let (gpu, c3) = to_comp(
        Component::Gpu,
        measure(cfg.repeats, cancel, || {
            gpu::bench_gpu(cfg, cancel).map(|g| normalize(g.gflops, refs::GPU_GFLOPS_100))
        }),
    );
    let (disk, c4) = to_comp(
        Component::Disk,
        measure(cfg.repeats, cancel, || {
            bench_disk(cfg, cancel, &std::env::temp_dir()).map(|d| {
                (normalize(d.seq_write_mb_s, refs::DISK_MB_S_100)
                    + normalize(d.seq_read_mb_s, refs::DISK_MB_S_100))
                    / 2
            })
        }),
    );

    let low_conf = c1 || c2 || c3 || c4;
    let notes = if low_conf {
        vec!["Some components varied between runs — close background apps for a cleaner score.".to_string()]
    } else {
        Vec::new()
    };
    RunReport {
        components: vec![cpu, ram, gpu, disk],
        confidence: if low_conf { RunConfidence::Low } else { RunConfidence::Clean },
        notes,
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Efficacy — the soul: Measure → Change → Re-measure → honest verdict.
// Compares two `RunReport`s (before/after a tweak) and reports the measured delta
// per component + overall. A delta that doesn't clear the run-to-run noise floor is
// reported as `NoMeasurableChange` — never spun as a win. This is what makes Compy
// an honest instrument instead of a faith healer with a registry editor.
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Verdict {
    Improved,
    NoMeasurableChange,
    Regressed,
    /// Measurement item 8: no measured run-to-run band exists for this comparison, so Compy shows the
    /// numbers and calls nothing better or worse.
    Unmeasured,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct ComponentEfficacy {
    pub component: Component,
    pub before: u32,
    pub after: u32,
    pub delta_pct: f64,
    pub verdict: Verdict,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct Efficacy {
    pub per_component: Vec<ComponentEfficacy>,
    pub overall: Verdict,
    /// The significance threshold actually used (%), after any low-confidence widening. None: no
    /// measured band for this comparison (item 8), and every verdict is Unmeasured.
    pub noise_floor_pct: Option<f64>,
}

/// Significance threshold: a base %, **widened** if either run was low-confidence — a noisy
/// run can't support a tight claim, so marginal deltas correctly read as "no change."
fn noise_floor(before: RunConfidence, after: RunConfidence, base_pct: f64) -> f64 {
    if before == RunConfidence::Low || after == RunConfidence::Low {
        base_pct.max(8.0)
    } else {
        base_pct
    }
}

fn verdict_for(delta_pct: f64, floor: f64) -> Verdict {
    if delta_pct.abs() <= floor {
        Verdict::NoMeasurableChange
    } else if delta_pct > 0.0 {
        Verdict::Improved
    } else {
        Verdict::Regressed
    }
}

/// Measurement item 8: the synthetic benchmark has no measured run-to-run band (no as-is pool of
/// repeated runs on this PC), so the efficacy of a change is shown, never called: no fixed 3%.
/// Formerly a conservative default threshold: a delta had to clear 3% (plus the
/// low-confidence widening) to count as real — we'd rather report "no measurable change"
/// than overclaim a win. Tunable later; conservative on purpose (owner-approved default).
///
/// The efficacy the app shows: no measured band exists for the synthetic benchmark (item 8).
pub(crate) fn measure_efficacy(before: &RunReport, after: &RunReport) -> Efficacy {
    compute_efficacy(before, after, None)
}

/// Compare two benchmark runs and emit an honest per-component + overall efficacy verdict.
/// Only components measured in **both** runs are compared. The delta is reference-independent
/// (normalization cancels), so it's meaningful even while absolute baselines are placeholders.
/// `band_pct`: a MEASURED run-to-run band for this comparison, or `None` (item 8): then every
/// verdict is `Unmeasured` and only the numbers show.
pub(crate) fn compute_efficacy(before: &RunReport, after: &RunReport, band_pct: Option<f64>) -> Efficacy {
    let floor = band_pct.map(|b| noise_floor(before.confidence, after.confidence, b));
    let judge = |delta: f64| floor.map_or(Verdict::Unmeasured, |f| verdict_for(delta, f));
    let mut per_component = Vec::new();
    for b in &before.components {
        if !b.measured {
            continue;
        }
        let Some(a) = after.components.iter().find(|x| x.component == b.component) else {
            continue;
        };
        if !a.measured {
            continue;
        }
        let delta_pct = if b.score == 0 {
            // Percent change from a measured-zero baseline is mathematically undefined. Report it
            // honestly by sign rather than flattening every 0→X to a false "no measurable change":
            // 0 → positive is a real (unquantifiable-as-%) gain, surfaced as +100% ("all of the new
            // score is new"); 0 → 0 is genuine no-change. The raw before/after points travel
            // alongside delta_pct (ComponentEfficacy.before/after), so the true magnitude is visible.
            if a.score > 0 { 100.0 } else { 0.0 }
        } else {
            (a.score as f64 - b.score as f64) / b.score as f64 * 100.0
        };
        per_component.push(ComponentEfficacy {
            component: b.component,
            before: b.score,
            after: a.score,
            delta_pct,
            verdict: judge(delta_pct),
        });
    }
    // Overall: average the measured component deltas, then the same significance test.
    let overall = if per_component.is_empty() {
        floor.map_or(Verdict::Unmeasured, |_| Verdict::NoMeasurableChange)
    } else {
        let avg = per_component.iter().map(|c| c.delta_pct).sum::<f64>() / per_component.len() as f64;
        judge(avg)
    };
    Efficacy { per_component, overall, noise_floor_pct: floor }
}

// ─────────────────────────────────────────────────────────────────────────────
// Live runner — orchestration around the pure engine above.
//
// `run_benchmark` is multi-second and CPU/GPU/disk-heavy, so a command can't run it
// inline without freezing the UI. `start_benchmark` kicks off a dedicated thread (the
// FPS-monitoring pattern) that writes into a cached `BenchmarkState`; the UI polls
// `benchmark_state`. Only the **baseline** persists (`benchmark.json`) so a
// Measure → Change → Re-measure comparison survives across runs and restarts. The runner
// changes NO system state — it only measures and stores its own results.
// ─────────────────────────────────────────────────────────────────────────────

use std::sync::{Mutex, OnceLock};

/// What the UI sees (serialized to the frontend; never deserialized as a whole).
#[derive(Serialize, Clone, Debug, Default)]
pub(crate) struct BenchmarkState {
    pub running: bool,
    pub latest: Option<RunReport>,
    pub latest_at: Option<String>,
    pub baseline: Option<RunReport>,
    pub baseline_at: Option<String>,
    /// Efficacy of latest vs baseline (Measure → Change → Re-measure), when both exist.
    pub efficacy: Option<Efficacy>,
    pub error: Option<String>,
}

/// Only the baseline persists; the latest run + efficacy are transient (in-memory).
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
struct BenchmarkStore {
    baseline: Option<RunReport>,
    baseline_at: Option<String>,
}

fn store_path() -> std::path::PathBuf {
    crate::compy_data_dir().join("benchmark.json")
}

fn load_store() -> BenchmarkStore {
    load_store_from(&store_path())
}

/// Unchanged policy, lifted to a path so it can be proven without the real data root: unreadable or
/// unparseable BOTH mean "no baseline yet", never an error. That is exactly why a half-written file
/// used to be destructive — it reads back as an empty store.
fn load_store_from(path: &std::path::Path) -> BenchmarkStore {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_store(store: &BenchmarkStore) -> Result<(), String> {
    std::fs::create_dir_all(crate::compy_data_dir()).map_err(|e| e.to_string())?;
    save_store_to(&store_path(), store)
}

fn save_store_to(path: &std::path::Path, store: &BenchmarkStore) -> Result<(), String> {
    // Serialize BEFORE any file is opened: a store that cannot be serialized must not have cost the
    // user the baseline that is already on disk. Same error mapping as before.
    let json = crate::atomic_write::serialize_pretty(store).map_err(|e| e.to_string())?;
    crate::atomic_write::write_atomic(path, json.as_bytes()).map_err(|e| e.to_string())
}

fn state_cache() -> &'static Mutex<BenchmarkState> {
    static CACHE: OnceLock<Mutex<BenchmarkState>> = OnceLock::new();
    CACHE.get_or_init(|| {
        // Hydrate the persisted baseline on first access.
        let store = load_store();
        Mutex::new(BenchmarkState {
            baseline: store.baseline,
            baseline_at: store.baseline_at,
            ..Default::default()
        })
    })
}

/// The only way this crate takes the benchmark state cache. Records the acquisition, then blocks.
///
/// #398 classifies this lock as IN class, not out. It guards `BenchmarkState` in memory, which
/// reads like a cache — but `set_baseline` and `clear_baseline` hold it **across `save_store`**, so
/// two concurrent baseline writes tear `benchmark.json`, not just a struct. That is the same defect
/// #283 names for the other secondary stores.
///
/// All FIVE sites go through here, including the three that only touch memory. A lock with four
/// recorded acquisitions and one bare `.lock()` cannot detect its own re-entrancy: the unrecorded
/// site is invisible to the thread-local stack, so the second acquisition looks like the first and
/// the release build deadlocks with no output. Partial instrumentation of one mutex is worse than
/// none, because it reads as covered.
///
/// Returns `Err(())` on a poisoned lock, which each caller maps to its own existing policy —
/// unchanged from the five sites this replaces.
fn lock_state() -> Result<crate::race_seam::StoreGuard<BenchmarkState>, ()> {
    crate::race_seam::try_hold_lock(crate::race_seam::StoreLock::Benchmark, || {
        state_cache().lock().map_err(|_| ())
    })
}

/// Recompute `efficacy` from the current baseline + latest (both must exist).
fn recompute_efficacy(state: &mut BenchmarkState) {
    state.efficacy = match (&state.baseline, &state.latest) {
        (Some(b), Some(a)) => Some(measure_efficacy(b, a)),
        _ => None,
    };
}

/// Current benchmark state for the UI.
pub(crate) fn benchmark_state() -> BenchmarkState {
    lock_state().map(|s| (*s).clone()).unwrap_or_default()
}

/// Shared cancel flag for the in-flight run — `cancel_benchmark` sets it, the runner checks it.
fn cancel_flag() -> &'static AtomicBool {
    static C: OnceLock<AtomicBool> = OnceLock::new();
    C.get_or_init(|| AtomicBool::new(false))
}

/// Kick off a benchmark run on a background thread (no-op if one is already running).
/// The lock is NOT held during the multi-second run, so `benchmark_state` stays responsive.
pub(crate) fn start_benchmark() {
    {
        let Ok(mut s) = lock_state() else { return };
        if s.running {
            return;
        }
        s.running = true;
        s.error = None;
    }
    cancel_flag().store(false, Ordering::Relaxed);
    let _ = std::thread::Builder::new()
        .name("benchmark-run".into())
        .spawn(|| {
            let report = run_benchmark(&RunConfig::default(), cancel_flag());
            let cancelled = cancel_flag().load(Ordering::Relaxed);
            if let Ok(mut s) = lock_state() {
                s.running = false;
                if cancelled {
                    // Don't store a partial/aborted run as a real result.
                    s.error = Some("Run cancelled.".into());
                } else {
                    s.latest = Some(report);
                    s.latest_at = Some(chrono::Utc::now().to_rfc3339());
                    recompute_efficacy(&mut s);
                }
            }
        });
}

/// Request cancellation of the in-flight run (the runner bails between samples/components).
pub(crate) fn cancel_benchmark() {
    cancel_flag().store(true, Ordering::Relaxed);
}

/// Save the latest run as the baseline (persisted). Errors if there's no run yet.
pub(crate) fn set_baseline() -> Result<(), String> {
    let mut s = lock_state().map_err(|_| "benchmark state lock poisoned".to_string())?;
    let Some(latest) = s.latest.clone() else {
        return Err("Run a benchmark first, then set it as the baseline.".into());
    };
    let at = s.latest_at.clone().unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    s.baseline = Some(latest.clone());
    s.baseline_at = Some(at.clone());
    recompute_efficacy(&mut s); // latest == baseline → all NoMeasurableChange (honest)
    save_store(&BenchmarkStore { baseline: Some(latest), baseline_at: Some(at) })
}

/// Clear the saved baseline (memory + disk).
pub(crate) fn clear_baseline() -> Result<(), String> {
    let mut s = lock_state().map_err(|_| "benchmark state lock poisoned".to_string())?;
    s.baseline = None;
    s.baseline_at = None;
    s.efficacy = None;
    save_store(&BenchmarkStore::default())
}

/// #281 — the store's missing/corrupt policy is UNCHANGED by the atomic-write lane. These run
/// against explicit temp paths; none of them reads the real `%APPDATA%\Compy` data root.
#[cfg(test)]
mod benchmark_store_persistence_tests {
    use super::*;

    fn scratch(tag: &str) -> std::path::PathBuf {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static N: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "compy-bench-{tag}-{}-{}",
            std::process::id(),
            N.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_missing_store_is_the_default_not_an_error() {
        let got = load_store_from(&scratch("missing").join("benchmark.json"));
        assert!(got.baseline.is_none(), "invented a baseline out of nothing");
        assert!(got.baseline_at.is_none());
    }

    #[test]
    fn a_truncated_store_is_the_default_not_an_error() {
        // Exactly the shape an interrupted `fs::write` used to leave behind, and the reason that
        // was destructive: the loader cannot tell "half a file" from "no file".
        let p = scratch("truncated").join("benchmark.json");
        std::fs::write(&p, "{\n  \"baseline\": {\n    \"runs\"").unwrap();
        assert!(load_store_from(&p).baseline.is_none());
    }

    #[test]
    fn a_saved_store_round_trips_and_replaces_the_previous_one_whole() {
        let p = scratch("round").join("benchmark.json");
        std::fs::write(&p, "{\"baseline\":null,\"baseline_at\":\"OLD-AND-LONGER\"}").unwrap();
        let store = BenchmarkStore {
            baseline: None,
            baseline_at: Some("new".into()),
        };
        save_store_to(&p, &store).expect("save");
        assert_eq!(load_store_from(&p).baseline_at.as_deref(), Some("new"));
        // No tail of the longer previous file survived, and no temp was left next to it.
        let leftovers: Vec<_> = std::fs::read_dir(p.parent().unwrap())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temp left behind: {leftovers:?}");
    }

    #[test]
    fn a_failed_save_leaves_the_previous_baseline_readable() {
        let p = scratch("failed").join("benchmark.json");
        let good = BenchmarkStore {
            baseline: None,
            baseline_at: Some("keep-me".into()),
        };
        save_store_to(&p, &good).expect("first save");

        // Interrupt the replacement at the boundary the helper names, driving the REAL save so the
        // test fails if this caller ever stops going through the atomic path.
        crate::atomic_write::force_next_failure(crate::atomic_write::FailPoint::BeforeRename);
        assert!(
            save_store_to(&p, &BenchmarkStore::default()).is_err(),
            "the save did not go through the atomic write path"
        );
        assert_eq!(load_store_from(&p).baseline_at.as_deref(), Some("keep-me"));
    }

    #[test]
    fn a_serialization_failure_touches_neither_target_nor_temp() {
        let dir = scratch("serialize-failed");
        let p = dir.join("benchmark.json");
        let good = BenchmarkStore {
            baseline: None,
            baseline_at: Some("keep-me".into()),
        };
        save_store_to(&p, &good).expect("first save");

        crate::atomic_write::force_next_serialization_failure();
        let err = save_store_to(&p, &BenchmarkStore::default())
            .expect_err("injected serialization failure must surface");
        assert!(err.contains("injected serialization failure"), "got: {err}");
        assert_eq!(load_store_from(&p).baseline_at.as_deref(), Some("keep-me"));
        assert!(
            std::fs::read_dir(&dir)
                .unwrap()
                .filter_map(|e| e.ok())
                .all(|e| !e.file_name().to_string_lossy().ends_with(".tmp")),
            "serialization reached the atomic writer"
        );
    }

    #[cfg(windows)]
    #[test]
    fn a_windows_share_lock_surfaces_the_benchmark_error_and_preserves_the_old_store() {
        let p = scratch("locked").join("benchmark.json");
        let good = BenchmarkStore {
            baseline: None,
            baseline_at: Some("keep-me".into()),
        };
        save_store_to(&p, &good).expect("first save");
        let held = crate::atomic_write::hold_without_share(&p);
        let err = save_store_to(&p, &BenchmarkStore::default())
            .expect_err("locked target must fail through the caller");
        assert!(!err.is_empty(), "caller swallowed the lock error");
        drop(held);
        assert_eq!(load_store_from(&p).baseline_at.as_deref(), Some("keep-me"));
    }
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

    // Regression guard (backend lane flagged the flake, 2026-06-25): under heavy parallel
    // test load a tiny CPU run could be scheduled only AFTER its short deadline already
    // elapsed, so the old `while now < deadline` kernel did zero chunks → `multi_kops == 0.0`
    // → false-failed the shared green baseline. The kernel now guarantees ≥1 chunk
    // (do-while), so a not-cancelled run always measures real work. This pins that contract:
    // an already-past deadline must still return a positive iteration count.
    #[test]
    fn cpu_kernel_runs_at_least_one_chunk_past_deadline() {
        let cancel = AtomicBool::new(false);
        // `checked_sub` so the guard itself can never panic on a cold monotonic clock.
        let already_past =
            Instant::now().checked_sub(Duration::from_secs(1)).unwrap_or_else(Instant::now);
        let iters = cpu_kernel(already_past, &cancel);
        assert!(iters > 0, "kernel must do at least one chunk even past the deadline");
    }

    #[test]
    fn ram_runner_produces_positive_bandwidth() {
        let cancel = AtomicBool::new(false);
        let raw = bench_ram(&RunConfig::tiny(), &cancel);
        assert!(raw.bandwidth_mb_s > 0.0);
    }

    // Regression guard (baseline flake at the local pre-push gate, 2026-09-22, #505): the old
    // form, `precancelled_cpu_returns_fast_and_does_not_hang`, proved "a pre-cancelled run bails"
    // with a wall-clock bound (`elapsed < 400ms`) around a call that spawns one thread per core.
    // Inside the ~1,350-test parallel cargo run on the dev rig, thread start-up plus scheduling
    // alone can exceed that, so the bound fired on a scripts-only diff and cost a full gate
    // re-run. A wall-clock upper bound under load is a flake by construction. What the test
    // MEANS is that a pre-cancelled run does NO work, and that is observable without a clock:
    // both kernels return zero iterations, so both throughputs are exactly 0.0 (0 / secs). The
    // only timing left is a generous hang guard on a helper thread, so a runner that ignores
    // `cancel` and wedges fails with a message instead of hanging the whole suite.
    #[test]
    fn precancelled_cpu_does_no_work_and_does_not_hang() {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let cancel = AtomicBool::new(true); // pre-cancelled
            let _ = tx.send(bench_cpu(&RunConfig::default(), &cancel)); // 600ms budget x2, cancelled
        });
        // Hang guard only: the full un-cancelled budget is 1.2s, so 10s cannot fire under load,
        // yet it still turns a wedged runner into a failure instead of a hung cargo test.
        let raw = rx
            .recv_timeout(Duration::from_secs(10))
            .expect("pre-cancelled bench_cpu must return, not hang");
        assert_eq!(raw.single_kops, 0.0, "pre-cancelled single-thread kernel must run zero iterations");
        assert_eq!(raw.multi_kops, 0.0, "pre-cancelled multi-thread kernel must run zero iterations");
        assert!(raw.threads >= 1);
    }

    #[test]
    fn run_benchmark_covers_native_set_and_feeds_scorer() {
        let cancel = AtomicBool::new(false);
        let report = run_benchmark(&RunConfig::tiny(), &cancel);
        let comps = report.components;
        assert_eq!(comps.len(), 4); // cpu, ram, gpu, disk
        // cpu + ram always measured; gpu/disk measured when available
        assert!(comps.iter().filter(|c| c.measured).count() >= 2);
        assert!(comps.iter().all(|c| c.score <= 100));
        // tiny config runs each component once → no variance to flag
        assert_eq!(report.confidence, RunConfidence::Clean);
        let measured = comps.iter().filter(|c| c.measured).count();
        // end-to-end: measured components feed the pure scorer with honest coverage
        let s = compute_standing(&StandingInputs { components: comps, ..Default::default() });
        assert_eq!(s.measured_components, measured);
        assert_eq!(s.total_components, 4);
        assert!(s.tier >= 1);
    }

    #[test]
    fn variance_flag_distinguishes_clean_from_noisy() {
        assert!(!high_variance(&[100])); // single sample → clean
        assert!(!high_variance(&[100, 102, 99])); // tight spread → clean
        assert!(high_variance(&[100, 50, 150])); // wide spread → low confidence
    }

    #[test]
    fn measure_keeps_best_and_handles_all_failures() {
        let cancel = AtomicBool::new(false);
        let mut seq = [40u32, 70, 55].into_iter();
        let got = measure(3, &cancel, || seq.next());
        assert_eq!(got.map(|(best, _)| best), Some(70)); // best of the three
        let none = measure(3, &cancel, || None);
        assert!(none.is_none()); // every attempt failed → not measured
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
        let dir = std::env::temp_dir().join(format!("compy_disktest_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        if let Some(d) = bench_disk(&RunConfig::tiny(), &cancel, &dir) {
            assert!(d.seq_write_mb_s > 0.0 && d.seq_read_mb_s > 0.0);
        }
        let leftover = std::fs::read_dir(&dir).map(|it| it.count()).unwrap_or(0);
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(leftover, 0, "disk runner left a temp file behind");
    }

    // ── efficacy (the soul) ──
    fn report(confidence: RunConfidence, comps: &[(Component, u32, bool)]) -> RunReport {
        RunReport {
            components: comps
                .iter()
                .map(|&(component, score, measured)| ComponentScore { component, score, measured })
                .collect(),
            confidence,
            notes: vec![],
        }
    }

    #[test]
    fn efficacy_flags_real_improvement() {
        let before = report(RunConfidence::Clean, &[(Component::Cpu, 50, true)]);
        let after = report(RunConfidence::Clean, &[(Component::Cpu, 60, true)]);
        let e = compute_efficacy(&before, &after, Some(3.0));
        assert_eq!(e.per_component[0].verdict, Verdict::Improved);
        assert_eq!(e.overall, Verdict::Improved);
    }

    #[test]
    fn efficacy_calls_a_tiny_delta_no_measurable_change() {
        let before = report(RunConfidence::Clean, &[(Component::Cpu, 100, true)]);
        let after = report(RunConfidence::Clean, &[(Component::Cpu, 102, true)]); // +2% < 3% floor
        let e = compute_efficacy(&before, &after, Some(3.0));
        assert_eq!(e.per_component[0].verdict, Verdict::NoMeasurableChange);
        assert_eq!(e.overall, Verdict::NoMeasurableChange);
    }

    #[test]
    fn efficacy_flags_regression() {
        let before = report(RunConfidence::Clean, &[(Component::Gpu, 80, true)]);
        let after = report(RunConfidence::Clean, &[(Component::Gpu, 60, true)]);
        let e = compute_efficacy(&before, &after, Some(3.0));
        assert_eq!(e.per_component[0].verdict, Verdict::Regressed);
        assert_eq!(e.overall, Verdict::Regressed);
    }

    #[test]
    fn low_confidence_widens_the_noise_floor() {
        // +6% would be "Improved" at a 3% floor, but a noisy run widens it to 8% → no claim.
        let before = report(RunConfidence::Low, &[(Component::Cpu, 100, true)]);
        let after = report(RunConfidence::Clean, &[(Component::Cpu, 106, true)]);
        let e = compute_efficacy(&before, &after, Some(3.0));
        assert!(e.noise_floor_pct.is_some_and(|f| f >= 8.0));
        assert_eq!(e.per_component[0].verdict, Verdict::NoMeasurableChange);
    }

    #[test]
    fn efficacy_skips_components_not_measured_in_both_runs() {
        let before = report(RunConfidence::Clean, &[(Component::Cpu, 50, true), (Component::Gpu, 0, false)]);
        let after = report(RunConfidence::Clean, &[(Component::Cpu, 60, true), (Component::Gpu, 70, true)]);
        let e = compute_efficacy(&before, &after, Some(3.0));
        assert_eq!(e.per_component.len(), 1); // GPU unmeasured in `before` → skipped
        assert_eq!(e.per_component[0].component, Component::Cpu);
    }

    #[test]
    fn the_shipped_efficacy_calls_nothing_without_a_measured_band() {
        // Item 8 (changed deliberately): the old test pinned +5% as Improved on a fixed 3% floor. No
        // run-to-run band is measured for the synthetic benchmark, so nothing is called either way.
        let b = report(RunConfidence::Clean, &[(Component::Cpu, 100, true)]);
        for after in [102, 105, 160, 40] {
            let e = measure_efficacy(&b, &report(RunConfidence::Clean, &[(Component::Cpu, after, true)]));
            assert_eq!(e.overall, Verdict::Unmeasured, "{after}");
            assert_eq!(e.per_component[0].verdict, Verdict::Unmeasured);
            assert_eq!(e.per_component[0].after, after, "the numbers still show");
            assert_eq!(e.noise_floor_pct, None);
        }
        assert_eq!(measure_efficacy(&b, &report(RunConfidence::Clean, &[])).overall, Verdict::Unmeasured);
    }

    #[test]
    fn normalize_clamps_to_0_100() {
        assert_eq!(normalize(0.0, 100.0), 0);
        assert_eq!(normalize(50.0, 100.0), 50);
        assert_eq!(normalize(1000.0, 100.0), 100); // clamped
    }

    #[test]
    fn normalize_non_finite_fails_safe_to_zero() {
        // Honesty boundary: a non-finite raw must NEVER fabricate a score — least of all a
        // maxed-out 100. An `Inf` (what a divide-by-~0 in a future producer regression yields)
        // would otherwise `.round().clamp(0,100)` straight to 100 — an unmeasured "perfect"
        // result, the single worst honesty failure. It must fail SAFE to 0 (no credit).
        assert_eq!(normalize(f64::INFINITY, 100.0), 0); // was 100 (fabricated perfect score)
        assert_eq!(normalize(f64::NEG_INFINITY, 100.0), 0);
        assert_eq!(normalize(f64::NAN, 100.0), 0);
        // An invalid reference (a future `refs::` mistake — zero/negative/non-finite) likewise
        // can't be allowed to fabricate or divide-by-zero into a bogus score.
        assert_eq!(normalize(50.0, 0.0), 0);
        assert_eq!(normalize(50.0, -100.0), 0);
        assert_eq!(normalize(50.0, f64::INFINITY), 0);
        assert_eq!(normalize(50.0, f64::NAN), 0);
        // A legitimately-zero raw (e.g. a cancelled run that did no work) stays an honest 0.
        assert_eq!(normalize(0.0, 100.0), 0);
    }
}
