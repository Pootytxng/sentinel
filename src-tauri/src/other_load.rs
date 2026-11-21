//! TG-context v2: how busy was everything ELSE on the PC while the game was measured?
//!
//! RECORD ONLY. Nothing here feeds a verdict, band, comparison or wording; the numbers land on
//! `GameStateFingerprint::{other_cpu, other_gpu_3d, other_gpu_video}` for a later slice to read. Numbers only: no
//! process names, no pids and no window titles leave this module (a name is compared in memory
//! against the game's name, then dropped).
//!
//! - CPU: one `NtQuerySystemInformation(SystemProcessInformation)` snapshot per tick gives every
//!   process's kernel + user time WITHOUT opening a process handle, so an anti-cheat-protected game
//!   reads like any other process. `GetSystemTimes` is read just before it, so the game's share and the
//!   machine's total cover the same interval. Other = max(0, total busy - game), as a share of all
//!   logical cores.
//! - GPU: the Windows "GPU Engine" counters (vendor-neutral): two figures, each the sum over engine
//!   instances whose pid is not the game's, clamped to 0..=100: 3D engines, and video engines
//!   (decode/encode/codec/processing/JPEG). Copy, Compute and the rest are ignored.
//!
//! Every failure is an `unread` tick, never a zero. A snapshot or PDH collection over 100 ms is unread, and
//! three in a row switch that reader off for the session. The GPU wildcard query is re-opened every 3
//! ticks; measured on this PC an already-open query also lists a process that starts mid-session within
//! one collect, so a new encoder is missed for about one tick, not for the length of the re-open interval.

use crate::game_state::OtherLoad;
use std::time::{Duration, Instant};

/// Fewer readings than this and the session's figure is unknown.
pub(crate) const MIN_READINGS: u32 = 60;
/// The wildcard GPU counter is re-expanded this often (ticks), because engine instances come and go.
const GPU_REEXPAND_TICKS: u32 = 3;
/// A snapshot or PDH collection slower than this is an unread tick (the capture loop must not be held up).
const SLOW_CALL: Duration = Duration::from_millis(100);
/// This many slow ticks in a row switch that reader off for the rest of the session.
const SLOW_RUN_LIMIT: u32 = 3;
/// Two CPU snapshots further apart than this are not "one tick" (the loop sleeps 1 s per tick): the
/// later one only primes.
const MAX_CPU_GAP: Duration = Duration::from_millis(1500);

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

/// A process name reduced to what identifies the game: lower-case, no `.exe`.
pub(crate) fn name_key(name: &str) -> String {
    let l = name.trim().to_lowercase();
    l.strip_suffix(".exe").unwrap_or(&l).to_string()
}

/// One tick's share of TOTAL CPU capacity used by everything except the game, in percent.
/// `capacity_delta` is the machine's kernel+user time over the interval (all logical cores, idle
/// included), `idle_delta` its idle part, `game_delta` the game's kernel+user time over the same
/// interval. `None` when the capacity is zero, the idle part exceeds it (an impossible delta: a bad
/// read, never a zero) or the game's time is unread (game missing). Compy itself, its frame helper and
/// any game child process under another image name count as "other".
pub(crate) fn other_cpu_pct(
    capacity_delta: u64,
    idle_delta: u64,
    game_delta: Option<u64>,
) -> Option<f64> {
    let game = game_delta?;
    if capacity_delta == 0 || idle_delta > capacity_delta {
        return None;
    }
    let busy = capacity_delta.saturating_sub(idle_delta);
    let other = busy.saturating_sub(game);
    Some((other as f64 / capacity_delta as f64 * 100.0).clamp(0.0, 100.0))
}

/// The pid in a GPU Engine instance name (`pid_1234_luid_..._engtype_3D`).
pub(crate) fn engine_pid(instance: &str) -> Option<u32> {
    let rest = instance.strip_prefix("pid_")?;
    rest.split('_').next()?.parse().ok()
}

/// The engine type in a GPU Engine instance name: everything after `_engtype_`, which may hold spaces
/// and digits (`..._engtype_Video Codec Engine`, `..._engtype_Compute 0`).
pub(crate) fn engine_type(instance: &str) -> Option<&str> {
    instance
        .split_once("_engtype_")
        .map(|(_, ty)| ty.trim())
        .filter(|ty| !ty.is_empty())
}

/// Which of the two recorded figures an engine counts toward. Copy, Compute, Security, Timer and any
/// unknown type count toward neither.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EngineKind {
    D3,
    Video,
}

pub(crate) fn engine_kind(engine_type: &str) -> Option<EngineKind> {
    let l = engine_type.to_lowercase();
    if l == "3d" {
        Some(EngineKind::D3)
    } else if l.contains("video") {
        Some(EngineKind::Video)
    } else {
        None
    }
}

/// One tick's GPU work done by processes other than the game, in percent.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct GpuOther {
    /// Summed 3D-engine utilisation of non-game pids, clamped 0..=100.
    pub d3: f64,
    /// Summed video-engine (decode/encode/codec/processing/JPEG) utilisation of non-game pids, clamped 0..=100.
    pub video: f64,
}

/// One tick's other-than-game GPU work, split into the two figures. Each is a SUM over the engines of
/// its kind and over every adapter (an iGPU and a dGPU add up), clamped; read it as "other GPU work",
/// not a share of one GPU. `None` when the game's pids are unknown (cannot tell the game's work from the
/// rest) or no instance was attributable to a pid at all; once any was, a kind with no non-game work
/// reads a true 0.
pub(crate) fn other_gpu_pcts<'a>(
    instances: impl IntoIterator<Item = (&'a str, f64)>,
    game_pids: &[u32],
) -> Option<GpuOther> {
    if game_pids.is_empty() {
        return None;
    }
    let (mut d3, mut video, mut seen) = (0.0_f64, 0.0_f64, false);
    for (name, util) in instances {
        let Some(pid) = engine_pid(name) else {
            continue;
        };
        if !util.is_finite() {
            continue;
        }
        seen = true;
        if game_pids.contains(&pid) {
            continue;
        }
        match engine_type(name).and_then(engine_kind) {
            Some(EngineKind::D3) => d3 += util.max(0.0),
            Some(EngineKind::Video) => video += util.max(0.0),
            None => {}
        }
    }
    seen.then(|| GpuOther {
        d3: d3.clamp(0.0, 100.0),
        video: video.clamp(0.0, 100.0),
    })
}
/// A percentage as tenths of a percent, clamped 0..=1000; a non-finite value is no reading.
pub(crate) fn pct_x10(pct: f64) -> Option<u16> {
    pct.is_finite()
        .then(|| (pct * 10.0).round().clamp(0.0, 1000.0) as u16)
}

/// Folds a session's per-tick readings (measured ticks only) into an [`OtherLoad`].
#[derive(Default, Debug)]
pub(crate) struct OtherLoadAccumulator {
    vals: Vec<u16>,
    unread: u32,
}

impl OtherLoadAccumulator {
    /// One measured tick: `Some(pct)` is a reading, `None` (or a non-finite value) is unread.
    pub(crate) fn record(&mut self, pct: Option<f64>) {
        match pct.and_then(pct_x10) {
            Some(v) => self.vals.push(v),
            None => self.unread = self.unread.saturating_add(1),
        }
    }

    /// The session figure, or `None` (unknown) with under [`MIN_READINGS`] readings or more than 20%
    /// of the measured ticks unread.
    pub(crate) fn finish(&self) -> Option<OtherLoad> {
        let readings = self.vals.len() as u32;
        let measured = readings as u64 + self.unread as u64;
        if readings < MIN_READINGS || (self.unread as u64) * 5 > measured {
            return None;
        }
        let mut sorted = self.vals.clone();
        sorted.sort_unstable();
        let sum: u64 = sorted.iter().map(|v| *v as u64).sum();
        let mean = (sum + readings as u64 / 2) / readings as u64;
        let rank = (readings as usize * 9).div_ceil(10).max(1); // nearest rank, 1-based
        Some(OtherLoad {
            readings,
            unread: self.unread,
            mean_pct_x10: mean.min(1000) as u16,
            p90_pct_x10: sorted[rank - 1],
        })
    }
}

/// A game process as seen in one system snapshot (no name kept).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct GameProc {
    pub pid: u32,
    pub create_time: i64,
    /// Kernel + user time, 100 ns units.
    pub cpu_100ns: u64,
}

/// The game's CPU time spent between two snapshots, summed over its processes. A process present in
/// both (same pid and creation time) counts its growth; one new since `prev` counts all it has. `None`
/// when the game is absent from `cur` (unread).
pub(crate) fn game_cpu_delta(prev: &[GameProc], cur: &[GameProc]) -> Option<u64> {
    if cur.is_empty() {
        return None;
    }
    Some(
        cur.iter()
            .map(|c| {
                match prev
                    .iter()
                    .find(|p| p.pid == c.pid && p.create_time == c.create_time)
                {
                    Some(p) => c.cpu_100ns.saturating_sub(p.cpu_100ns),
                    None => c.cpu_100ns,
                }
            })
            .sum(),
    )
}

// SYSTEM_PROCESS_INFORMATION (x64) field offsets.
const OFF_NEXT: usize = 0;
const OFF_CREATE: usize = 32;
const OFF_USER: usize = 40;
const OFF_KERNEL: usize = 48;
const OFF_NAME_LEN: usize = 56;
const OFF_NAME_PTR: usize = 64;
const OFF_PID: usize = 80;
const ENTRY_MIN: usize = 88;

// The hand-written layout is x64-only. It cannot be cross-checked against the `windows` crate: its
// SYSTEM_PROCESS_INFORMATION (feature Win32_System_WindowsProgramming, not enabled here) is the reduced
// public struct with no CPU-time fields, so adding the feature would not verify them. Its 8 bytes of
// header + `Reserved1[48]` before `ImageName` are what puts ImageName at 56 and UniqueProcessId at 80.
const _: () = assert!(
    core::mem::size_of::<usize>() == 8,
    "other_load reads the x64 SYSTEM_PROCESS_INFORMATION layout"
);
const _: () = assert!(OFF_NAME_LEN == 8 + 48 && OFF_NAME_PTR == OFF_NAME_LEN + 8);
const _: () = assert!(OFF_PID == OFF_NAME_LEN + 16 + 8 && ENTRY_MIN == OFF_PID + 8);

fn rd<const N: usize>(buf: &[u8], at: usize) -> Option<[u8; N]> {
    buf.get(at..at.checked_add(N)?)?.try_into().ok()
}

/// The image name of the entry at `off`, or `None` when it cannot be read safely: no name, an odd byte
/// length, or a pointer that is not inside `buf` (null or foreign). Such an entry is skipped, never fatal.
fn entry_name(buf: &[u8], base: usize, off: usize) -> Option<String> {
    let len = u16::from_le_bytes(rd(buf, off + OFF_NAME_LEN)?) as usize;
    let ptr = u64::from_le_bytes(rd(buf, off + OFF_NAME_PTR)?) as usize;
    if len == 0 || !len.is_multiple_of(2) {
        return None;
    }
    let start = ptr.checked_sub(base)?;
    let bytes = buf.get(start..start.checked_add(len)?)?;
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_le_bytes(*c))
        .collect();
    Some(String::from_utf16_lossy(&units))
}

/// PURE over the snapshot bytes: every process whose image name matches `key` ([`name_key`]).
/// `None` when the entry CHAIN is malformed (an offset that leaves the buffer or does not advance past
/// one entry), which is unread; an entry with an unreadable NAME is skipped and the walk continues.
/// Name pointers are absolute addresses inside `buf`.
pub(crate) fn parse_game_processes(buf: &[u8], key: &str) -> Option<Vec<GameProc>> {
    let base = buf.as_ptr() as usize;
    let mut out = Vec::new();
    let mut off = 0usize;
    for _ in 0..100_000 {
        let next = u32::from_le_bytes(rd(buf, off + OFF_NEXT)?) as usize;
        if off + ENTRY_MIN > buf.len() {
            return None;
        }
        if entry_name(buf, base, off).is_some_and(|n| name_key(&n) == key) {
            let user = i64::from_le_bytes(rd(buf, off + OFF_USER)?).max(0) as u64;
            let kernel = i64::from_le_bytes(rd(buf, off + OFF_KERNEL)?).max(0) as u64;
            out.push(GameProc {
                pid: u64::from_le_bytes(rd(buf, off + OFF_PID)?) as u32,
                create_time: i64::from_le_bytes(rd(buf, off + OFF_CREATE)?),
                cpu_100ns: user.saturating_add(kernel),
            });
        }
        if next == 0 {
            return Some(out);
        }
        if next < ENTRY_MIN {
            return None; // overlapping or self-referencing: the walk would not advance
        }
        off = off.checked_add(next)?;
    }
    None
}

/// PURE over the snapshot bytes: the image name of every process, as the snapshot holds it (extension and
/// case kept, not truncated). An entry with an unreadable name is skipped; `None` when the entry chain is
/// malformed. Opens no process. Added for the first look's "running now" (names only).
pub(crate) fn parse_process_names(buf: &[u8]) -> Option<Vec<String>> {
    let base = buf.as_ptr() as usize;
    let mut out = Vec::new();
    let mut off = 0usize;
    for _ in 0..100_000 {
        let next = u32::from_le_bytes(rd(buf, off + OFF_NEXT)?) as usize;
        if off + ENTRY_MIN > buf.len() {
            return None;
        }
        if let Some(n) = entry_name(buf, base, off) {
            out.push(n);
        }
        if next == 0 {
            return Some(out);
        }
        if next < ENTRY_MIN {
            return None;
        }
        off = off.checked_add(next)?;
    }
    None
}

/// One handle-free snapshot, names only (no process is opened). `None` on any failure: unread, never empty.
pub(crate) fn read_process_names() -> Option<Vec<String>> {
    let mut buf = Vec::new();
    if !take_process_snapshot(&mut buf) {
        return None;
    }
    parse_process_names(&buf)
}
// ---------------------------------------------------------------------------------------------
// Windows readers
// ---------------------------------------------------------------------------------------------

#[link(name = "ntdll", kind = "raw-dylib")]
extern "system" {
    fn NtQuerySystemInformation(
        class: u32,
        info: *mut core::ffi::c_void,
        len: u32,
        ret: *mut u32,
    ) -> i32;
}
const SYSTEM_PROCESS_INFORMATION_CLASS: u32 = 5;
const STATUS_INFO_LENGTH_MISMATCH: i32 = 0xC000_0004_u32 as i32;

/// Fill `buf` with the system-wide process snapshot. False on any failure.
fn take_process_snapshot(buf: &mut Vec<u8>) -> bool {
    let mut size = buf.len().max(1 << 20);
    for _ in 0..4 {
        buf.clear();
        buf.resize(size, 0);
        let mut needed = 0u32;
        // SAFETY: `buf` is a live, writable allocation of `size` bytes.
        let status = unsafe {
            NtQuerySystemInformation(
                SYSTEM_PROCESS_INFORMATION_CLASS,
                buf.as_mut_ptr().cast(),
                size as u32,
                &mut needed,
            )
        };
        if status == 0 {
            return true;
        }
        if status != STATUS_INFO_LENGTH_MISMATCH {
            return false;
        }
        size = (needed as usize + (64 << 10)).max(size * 2);
    }
    false
}

#[derive(Clone, Copy)]
struct SysTimes {
    capacity: u64,
    idle: u64,
}

fn read_sys_times() -> Option<SysTimes> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::GetSystemTimes;
    let (mut idle, mut kernel, mut user) = (
        FILETIME::default(),
        FILETIME::default(),
        FILETIME::default(),
    );
    // SAFETY: three valid out-pointers.
    unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)).ok()? };
    let u = |f: FILETIME| ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64;
    // Kernel time includes idle time.
    Some(SysTimes {
        capacity: u(kernel).saturating_add(u(user)),
        idle: u(idle),
    })
}

/// One wildcard `\GPU Engine(*)\Utilization Percentage` query. PDH handles are not `Send`: own one on
/// the thread that reads it.
struct GpuEngineQuery {
    query: windows::Win32::System::Performance::PDH_HQUERY,
    counter: windows::Win32::System::Performance::PDH_HCOUNTER,
}

impl GpuEngineQuery {
    fn open() -> Option<Self> {
        use windows::Win32::System::Performance::{
            PdhAddEnglishCounterW, PdhCloseQuery, PdhCollectQueryData, PdhOpenQueryW, PDH_HCOUNTER,
            PDH_HQUERY,
        };
        // SAFETY: plain PDH calls with valid out-pointers; the query is closed on every failure path.
        unsafe {
            let mut query = PDH_HQUERY::default();
            if PdhOpenQueryW(None, 0, &mut query) != 0 {
                return None;
            }
            let mut counter = PDH_HCOUNTER::default();
            let path = windows::core::w!("\\GPU Engine(*)\\Utilization Percentage");
            if PdhAddEnglishCounterW(query, path, 0, &mut counter) != 0 {
                let _ = PdhCloseQuery(query);
                return None;
            }
            let _ = PdhCollectQueryData(query); // prime: a rate counter needs two samples
            Some(Self { query, counter })
        }
    }

    /// Collect and return every readable engine instance as (instance name, utilisation).
    fn collect_rows(&self, scratch: &mut Vec<u64>) -> Option<Vec<(String, f64)>> {
        use windows::Win32::System::Performance::{
            PdhCollectQueryData, PdhGetFormattedCounterArrayW, PDH_FMT_COUNTERVALUE_ITEM_W,
            PDH_FMT_DOUBLE,
        };
        const PDH_MORE_DATA: u32 = 0x800007D2;
        // SAFETY: the item buffer is a u64-aligned allocation of at least the size PDH asked for, and
        // the item pointers (names) stay valid until the next PDH call on this query.
        unsafe {
            if PdhCollectQueryData(self.query) != 0 {
                return None;
            }
            let (mut size, mut count) = (0u32, 0u32);
            if PdhGetFormattedCounterArrayW(
                self.counter,
                PDH_FMT_DOUBLE,
                &mut size,
                &mut count,
                None,
            ) != PDH_MORE_DATA
            {
                return None;
            }
            scratch.clear();
            scratch.resize(size as usize / 8 + 2, 0);
            let items = scratch.as_mut_ptr().cast::<PDH_FMT_COUNTERVALUE_ITEM_W>();
            if PdhGetFormattedCounterArrayW(
                self.counter,
                PDH_FMT_DOUBLE,
                &mut size,
                &mut count,
                Some(items),
            ) != 0
            {
                return None;
            }
            let mut rows: Vec<(String, f64)> = Vec::with_capacity(count as usize);
            for i in 0..count as usize {
                let it = &*items.add(i);
                // CStatus 0 = valid data, 1 = new data; anything else is not a reading.
                if it.FmtValue.CStatus > 1 || it.szName.is_null() {
                    continue;
                }
                if let Ok(name) = it.szName.to_string() {
                    rows.push((name, it.FmtValue.Anonymous.doubleValue));
                }
            }
            Some(rows)
        }
    }

    /// Collect and return the other-than-game GPU figures (see [`other_gpu_pcts`]).
    fn read_other(&self, scratch: &mut Vec<u64>, game_pids: &[u32]) -> Option<GpuOther> {
        let rows = self.collect_rows(scratch)?;
        other_gpu_pcts(rows.iter().map(|(n, v)| (n.as_str(), *v)), game_pids)
    }
}
impl Drop for GpuEngineQuery {
    fn drop(&mut self) {
        // SAFETY: closing the query frees its counter too.
        unsafe {
            let _ = windows::Win32::System::Performance::PdhCloseQuery(self.query);
        }
    }
}

/// The GPU reader: re-expands the wildcard every [`GPU_REEXPAND_TICKS`] by priming a fresh query a
/// tick before it replaces the old one, so a re-expansion never costs a reading.
#[derive(Default)]
struct GpuEngineReader {
    cur: Option<GpuEngineQuery>,
    pending: Option<GpuEngineQuery>,
    ticks: u32,
    scratch: Vec<u64>,
}

impl GpuEngineReader {
    fn read(&mut self, game_pids: &[u32]) -> Option<GpuOther> {
        if let Some(p) = self.pending.take() {
            self.cur = Some(p);
        }
        if self.ticks.is_multiple_of(GPU_REEXPAND_TICKS)
            || (self.cur.is_none() && self.ticks.is_multiple_of(2))
        {
            self.pending = GpuEngineQuery::open();
        }
        self.ticks = self.ticks.wrapping_add(1);
        // A failed read is unread; the query is replaced at the next re-expansion (at most one new
        // wildcard query per GPU_REEXPAND_TICKS, so a PC with no readable engines never opens one per tick).
        self.cur.as_ref()?.read_other(&mut self.scratch, game_pids)
    }
}

/// One tick's readings. `None` = unread.
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct TickReading {
    pub cpu: Option<f64>,
    pub gpu_3d: Option<f64>,
    pub gpu_video: Option<f64>,
}

/// Watches how long one reader's calls take. A call over [`SLOW_CALL`] is an unread tick; after
/// [`SLOW_RUN_LIMIT`] in a row the reader is off for the rest of the session (its figure then reads
/// unknown through the unread rule).
#[derive(Default, Debug)]
pub(crate) struct SlowGuard {
    run: u32,
    off: bool,
}

impl SlowGuard {
    pub(crate) fn is_off(&self) -> bool {
        self.off
    }

    /// Record one call's duration; `false` means this tick is unread (slow, or the reader is off).
    pub(crate) fn observe(&mut self, took: Duration) -> bool {
        if self.off {
            return false;
        }
        if took > SLOW_CALL {
            self.run += 1;
            self.off = self.run >= SLOW_RUN_LIMIT;
            false
        } else {
            self.run = 0;
            true
        }
    }
}

/// The previous CPU snapshot.
struct PrevCpu {
    at: Instant,
    sys: SysTimes,
    procs: Vec<GameProc>,
}

/// One CPU tick between `prev` and now. A gap over [`MAX_CPU_GAP`] (no game attached for a while) is
/// not one tick: the reading would be a multi-second average, so it only primes.
fn cpu_interval_pct(prev: &PrevCpu, at: Instant, sys: SysTimes, procs: &[GameProc]) -> Option<f64> {
    if at.saturating_duration_since(prev.at) > MAX_CPU_GAP {
        return None;
    }
    other_cpu_pct(
        sys.capacity.saturating_sub(prev.sys.capacity),
        sys.idle.saturating_sub(prev.sys.idle),
        game_cpu_delta(&prev.procs, procs),
    )
}

/// Samples the rest of the PC for one game (identified in memory by its process name).
pub(crate) struct OtherLoadSampler {
    key: String,
    buf: Vec<u8>,
    prev: Option<PrevCpu>,
    gpu: GpuEngineReader,
    cpu_guard: SlowGuard,
    gpu_guard: SlowGuard,
}

impl OtherLoadSampler {
    pub(crate) fn new(game_process_name: &str) -> Self {
        Self {
            key: name_key(game_process_name),
            buf: Vec::new(),
            prev: None,
            gpu: GpuEngineReader::default(),
            cpu_guard: SlowGuard::default(),
            gpu_guard: SlowGuard::default(),
        }
    }

    /// True when this sampler was built for the same game.
    pub(crate) fn is_for(&self, game_process_name: &str) -> bool {
        self.key == name_key(game_process_name)
    }

    /// A/CPU half: the other-CPU share since the previous call, plus the game's pids this tick.
    /// The first call, and the first after a gap or a failed or slow read, only primes (unread).
    pub(crate) fn cpu_tick(&mut self) -> (Option<f64>, Vec<u32>) {
        if self.cpu_guard.is_off() {
            return (None, Vec::new());
        }
        let at = Instant::now();
        let now = read_sys_times();
        let procs = if take_process_snapshot(&mut self.buf) {
            parse_game_processes(&self.buf, &self.key)
        } else {
            None
        };
        let on_time = self.cpu_guard.observe(at.elapsed());
        let pids: Vec<u32> = procs
            .as_ref()
            .map(|p| p.iter().map(|g| g.pid).collect())
            .unwrap_or_default();
        let (true, Some(sys), Some(procs)) = (on_time, now, procs) else {
            self.prev = None; // never diff across a failed or slow read
            return (None, pids);
        };
        let pct = self
            .prev
            .as_ref()
            .and_then(|p| cpu_interval_pct(p, at, sys, &procs));
        self.prev = Some(PrevCpu { at, sys, procs });
        (pct, pids)
    }

    /// B/GPU half: GPU work by everything but `game_pids`.
    pub(crate) fn gpu_tick(&mut self, game_pids: &[u32]) -> Option<GpuOther> {
        if self.gpu_guard.is_off() {
            return None;
        }
        let at = Instant::now();
        let r = self.gpu.read(game_pids);
        if !self.gpu_guard.observe(at.elapsed()) {
            return None;
        }
        r
    }

    /// Both halves; `fps_pid` is the pid the frame helper reported, added to the game's pids.
    pub(crate) fn sample(&mut self, fps_pid: u32) -> TickReading {
        let (cpu, mut pids) = self.cpu_tick();
        if fps_pid != 0 && !pids.contains(&fps_pid) {
            pids.push(fps_pid);
        }
        // `pids` is empty only when the helper gave no pid and the game's name is not in the snapshot
        // (or the snapshot failed): the GPU read could not tell the game's work from the rest.
        let gpu = if pids.is_empty() {
            None
        } else {
            self.gpu_tick(&pids)
        };
        TickReading {
            cpu,
            gpu_3d: gpu.map(|g| g.d3),
            gpu_video: gpu.map(|g| g.video),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;

    fn acc(readings: &[Option<f64>]) -> Option<OtherLoad> {
        let mut a = OtherLoadAccumulator::default();
        readings.iter().for_each(|r| a.record(*r));
        a.finish()
    }

    #[test]
    fn per_tick_cpu_share_is_busy_minus_game_clamped() {
        // 8 cores over 1 s = 8e7 capacity units here; 25% busy, game used 10% of capacity.
        let cap = 80_000_000u64;
        let pct = other_cpu_pct(cap, cap * 3 / 4, Some(cap / 10)).unwrap();
        assert!((pct - 15.0).abs() < 1e-9, "{pct}");
        // The game read higher than the machine's busy time (interval skew): floor at 0, never negative.
        assert_eq!(other_cpu_pct(cap, cap * 9 / 10, Some(cap / 2)), Some(0.0));
        // Idle larger than capacity is an impossible delta: unread, never a zero.
        assert_eq!(other_cpu_pct(cap, cap * 2, Some(0)), None);
        assert_eq!(
            other_cpu_pct(cap, cap, Some(0)),
            Some(0.0),
            "all idle is a real zero"
        );
        assert_eq!(other_cpu_pct(cap, 0, Some(0)), Some(100.0));
    }

    #[test]
    fn game_missing_or_zero_capacity_is_unread_not_zero() {
        assert_eq!(other_cpu_pct(1000, 500, None), None);
        assert_eq!(other_cpu_pct(0, 0, Some(0)), None);
        let g = |pid, cpu| GameProc {
            pid,
            create_time: 1,
            cpu_100ns: cpu,
        };
        assert_eq!(
            game_cpu_delta(&[g(1, 10)], &[]),
            None,
            "game gone from the snapshot"
        );
        assert_eq!(
            game_cpu_delta(&[g(1, 10)], &[g(1, 35), g(2, 7)]),
            Some(25 + 7)
        );
        // A reused pid (different creation time) is a new process, not a negative delta.
        let reused = [GameProc {
            pid: 1,
            create_time: 9,
            cpu_100ns: 4,
        }];
        assert_eq!(game_cpu_delta(&[g(1, 1000)], &reused), Some(4));
    }

    #[test]
    fn engine_type_keeps_spaces_and_digits_and_sorts_into_two_kinds() {
        let ty = |n: &str| engine_type(n).and_then(engine_kind);
        assert_eq!(
            engine_type("pid_1_luid_0x0_0x1_phys_0_eng_2_engtype_Video Codec Engine"),
            Some("Video Codec Engine")
        );
        assert_eq!(
            engine_type("pid_1_luid_0x0_0x1_phys_0_eng_9_engtype_Compute 0"),
            Some("Compute 0")
        );
        assert_eq!(engine_type("pid_1_luid_x_engtype_"), None);
        assert_eq!(engine_type("nothing here"), None);
        assert_eq!(
            ty("pid_1_luid_x_phys_0_eng_0_engtype_3D"),
            Some(EngineKind::D3)
        );
        assert_eq!(
            ty("pid_1_luid_x_phys_0_eng_0_engtype_3d"),
            Some(EngineKind::D3),
            "case-insensitive"
        );
        for v in [
            "Video Codec Engine",
            "VideoEncode",
            "VideoDecode",
            "VideoProcessing",
            "Video JPEG 0",
            "video codec engine",
        ] {
            assert_eq!(
                ty(&format!("pid_1_luid_x_phys_0_eng_1_engtype_{v}")),
                Some(EngineKind::Video),
                "{v}"
            );
        }
        for v in [
            "Copy",
            "Compute 0",
            "Security 1",
            "Timer 0",
            "3D Something",
            "Mystery",
        ] {
            assert_eq!(
                ty(&format!("pid_1_luid_x_phys_0_eng_1_engtype_{v}")),
                None,
                "{v} counts toward neither figure"
            );
        }
    }

    #[test]
    fn gpu_other_splits_3d_from_video_and_excludes_only_the_game() {
        let inst = [
            ("pid_100_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 40.0), // the game: in neither
            ("pid_100_luid_0x0_0x1_phys_0_eng_5_engtype_VideoDecode", 9.0), // the game: in neither
            ("pid_200_luid_0x0_0x1_phys_0_eng_0_engtype_3D", 2.5),
            ("pid_200_luid_0x0_0x1_phys_0_eng_3_engtype_Copy", 30.0), // ignored type
            ("pid_200_luid_0x0_0x1_phys_0_eng_4_engtype_Compute 0", 30.0), // ignored type
            (
                "pid_300_luid_0x0_0x1_phys_0_eng_1_engtype_Video Codec Engine",
                3.0,
            ),
            ("pid_300_luid_0x0_0x1_phys_0_eng_2_engtype_VideoEncode", 1.5),
            ("garbage", 99.0),
        ];
        let v = other_gpu_pcts(inst, &[100]).unwrap();
        assert!(
            (v.d3 - 2.5).abs() < 1e-9,
            "a 3D reading never leaks into video: {v:?}"
        );
        assert!(
            (v.video - 4.5).abs() < 1e-9,
            "a video reading never leaks into 3D: {v:?}"
        );
        // Two game processes: both excluded from both figures.
        let two = other_gpu_pcts(inst, &[100, 200]).unwrap();
        assert_eq!((two.d3, two.video), (0.0, 4.5));
        // Clamp per figure.
        let hot = other_gpu_pcts(
            [
                ("pid_5_luid_x_engtype_3D", 250.0),
                ("pid_6_luid_x_engtype_VideoEncode", 140.0),
            ],
            &[1],
        )
        .unwrap();
        assert_eq!((hot.d3, hot.video), (100.0, 100.0));
        assert_eq!(other_gpu_pcts(inst, &[]), None, "game pids unknown");
        assert_eq!(
            other_gpu_pcts([("garbage", 1.0)], &[1]),
            None,
            "nothing attributable"
        );
        let only_game = other_gpu_pcts([("pid_100_luid_x_engtype_3D", 40.0)], &[100]).unwrap();
        assert_eq!(
            (only_game.d3, only_game.video),
            (0.0, 0.0),
            "only the game: truly 0 once something was read"
        );
    }
    #[test]
    fn tenths_are_clamped_and_non_finite_is_no_reading() {
        assert_eq!(pct_x10(12.34), Some(123));
        assert_eq!(pct_x10(-3.0), Some(0));
        assert_eq!(pct_x10(250.0), Some(1000));
        assert_eq!(pct_x10(f64::NAN), None);
    }

    #[test]
    fn too_few_readings_is_unknown() {
        assert_eq!(acc(&[Some(5.0); 59]), None);
        assert!(acc(&[Some(5.0); 60]).is_some());
    }

    #[test]
    fn too_many_unread_is_unknown_and_exactly_twenty_percent_is_kept() {
        let mut v = vec![Some(5.0); 80];
        v.extend([None; 20]); // 20 of 100 = 20%: kept
        let l = acc(&v).expect("20% unread is allowed");
        assert_eq!((l.readings, l.unread), (80, 20));
        v.push(None); // 21 of 101 > 20%
        assert_eq!(acc(&v), None);
        // NaN is an unread tick, not a zero reading.
        let mut w = vec![Some(5.0); 60];
        w.push(Some(f64::NAN));
        assert_eq!(acc(&w).unwrap().unread, 1);
    }

    #[test]
    fn mean_and_p90_are_in_tenths_by_nearest_rank() {
        // 1..=100 tenths of... use percents 1.0..=100.0 -> 10..=1000 tenths.
        let v: Vec<Option<f64>> = (1..=100).map(|i| Some(i as f64)).collect();
        let l = acc(&v).unwrap();
        assert_eq!(l.mean_pct_x10, 505); // mean 50.5%
        assert_eq!(l.p90_pct_x10, 900); // 90th value of 100
                                        // A mostly-low session with a tail: p90 sees the tail, mean stays low.
        let mut t = vec![Some(1.0); 90];
        t.extend([Some(60.0); 10]);
        let l = acc(&t).unwrap();
        assert_eq!((l.mean_pct_x10, l.p90_pct_x10), (69, 10));
    }

    // Build a synthetic SYSTEM_PROCESS_INFORMATION chain; names live at the end of the same Vec.
    fn snapshot(procs: &[(u32, &str, i64, i64, i64)]) -> Vec<u8> {
        const ENTRY: usize = 256;
        let mut buf = vec![0u8; ENTRY * procs.len()];
        let mut names = Vec::new();
        for (i, (pid, name, create, user, kernel)) in procs.iter().enumerate() {
            let o = i * ENTRY;
            let next = if i + 1 == procs.len() {
                0
            } else {
                ENTRY as u32
            };
            buf[o..o + 4].copy_from_slice(&next.to_le_bytes());
            buf[o + OFF_CREATE..o + OFF_CREATE + 8].copy_from_slice(&create.to_le_bytes());
            buf[o + OFF_USER..o + OFF_USER + 8].copy_from_slice(&user.to_le_bytes());
            buf[o + OFF_KERNEL..o + OFF_KERNEL + 8].copy_from_slice(&kernel.to_le_bytes());
            buf[o + OFF_PID..o + OFF_PID + 8].copy_from_slice(&(*pid as u64).to_le_bytes());
            let u: Vec<u8> = name.encode_utf16().flat_map(|c| c.to_le_bytes()).collect();
            buf[o + OFF_NAME_LEN..o + OFF_NAME_LEN + 2]
                .copy_from_slice(&(u.len() as u16).to_le_bytes());
            names.push((o, u));
        }
        let table_len = buf.len();
        for (_, u) in &names {
            buf.extend_from_slice(u);
        }
        let base = buf.as_ptr() as usize;
        let mut at = table_len;
        for (o, u) in &names {
            let ptr = (base + at) as u64;
            buf[o + OFF_NAME_PTR..o + OFF_NAME_PTR + 8].copy_from_slice(&ptr.to_le_bytes());
            at += u.len();
        }
        buf
    }

    /// The names the first look matches against its allowlist: extension and case kept as Windows gives them,
    /// an unreadable name skipped, a corrupt chain unread (fixture data, no real enumeration).
    #[test]
    fn the_snapshot_names_keep_extension_and_case_and_match_the_allowlist_by_exact_name() {
        let buf = snapshot(&[(4, "System", 1, 0, 0), (10, "Medal.exe", 2, 0, 0), (11, "notmedal.exe", 3, 0, 0), (12, "OBS64.EXE", 4, 0, 0)]);
        let names = parse_process_names(&buf).unwrap();
        assert_eq!(names, vec!["System", "Medal.exe", "notmedal.exe", "OBS64.EXE"]);
        let hit = |n: &str| crate::running_at_start::lookup(n).map(|p| p.id);
        assert_eq!(hit(&names[1]), Some("medal"));
        assert_eq!(hit(&names[2]), None);
        assert_eq!(hit(&names[3]), Some("obs-studio"));
        assert_eq!(hit(&names[0]), None);
        assert_eq!(parse_process_names(&buf[..100]), None);
        assert_eq!(parse_process_names(&[]), None);
        // A foreign name pointer skips that entry, never fails the walk.
        let mut bad = buf.clone();
        bad[OFF_NAME_PTR..OFF_NAME_PTR + 8].copy_from_slice(&7u64.to_le_bytes());
        assert_eq!(parse_process_names(&bad), Some(vec![]));
    }

    #[test]
    fn the_snapshot_parser_finds_only_the_games_processes_without_a_handle() {
        let buf = snapshot(&[
            (4, "System", 1, 0, 50),
            (1234, "ROB RUN.exe", 77, 600, 400),
            (555, "Discord.exe", 5, 30, 20),
            (1300, "rob run.EXE", 88, 10, 5),
        ]);
        let got = parse_game_processes(&buf, &name_key("ROB RUN.exe")).unwrap();
        assert_eq!(
            got,
            vec![
                GameProc {
                    pid: 1234,
                    create_time: 77,
                    cpu_100ns: 1000
                },
                GameProc {
                    pid: 1300,
                    create_time: 88,
                    cpu_100ns: 15
                },
            ]
        );
        assert_eq!(parse_game_processes(&buf, "nothing").unwrap(), vec![]);
        // A truncated or corrupt buffer is unread, never a panic or a guess.
        assert_eq!(parse_game_processes(&buf[..100], "rob run"), None);
        let mut bad = buf.clone();
        bad[OFF_NAME_PTR..OFF_NAME_PTR + 8].copy_from_slice(&7u64.to_le_bytes());
        bad[OFF_NAME_LEN] = 8;
        // Unreadable names (here every pointer is foreign to the clone) match nothing and are skipped.
        assert_eq!(parse_game_processes(&bad, "rob run"), Some(vec![]));
    }

    #[test]
    fn engine_pid_parses_the_instance_name() {
        assert_eq!(
            engine_pid("pid_1234_luid_0x00000000_0x0000D1A5_phys_0_eng_3_engtype_3D"),
            Some(1234)
        );
        assert_eq!(engine_pid("luid_0x1"), None);
        assert_eq!(engine_pid("pid_x_luid"), None);
    }

    fn four() -> Vec<u8> {
        snapshot(&[
            (4, "System", 1, 0, 50),
            (1234, "ROB RUN.exe", 77, 600, 400),
            (555, "Discord.exe", 5, 30, 20),
            (1300, "rob run.EXE", 88, 10, 5),
        ])
    }

    const ENTRY_STRIDE: usize = 256;

    fn set_u32(buf: &mut [u8], at: usize, v: u32) {
        buf[at..at + 4].copy_from_slice(&v.to_le_bytes());
    }

    #[test]
    fn one_entry_with_a_bad_name_is_skipped_and_the_walk_continues() {
        let key = name_key("ROB RUN.exe");
        let want = vec![
            GameProc {
                pid: 1234,
                create_time: 77,
                cpu_100ns: 1000,
            },
            GameProc {
                pid: 1300,
                create_time: 88,
                cpu_100ns: 15,
            },
        ];
        // A null / foreign name pointer on a process BEFORE the game (entry 0) and one between the games.
        let mut buf = four();
        buf[OFF_NAME_PTR..OFF_NAME_PTR + 8].copy_from_slice(&0u64.to_le_bytes());
        let mid = 2 * ENTRY_STRIDE;
        buf[mid + OFF_NAME_PTR..mid + OFF_NAME_PTR + 8].copy_from_slice(&u64::MAX.to_le_bytes());
        assert_eq!(
            parse_game_processes(&buf, &key).unwrap(),
            want,
            "bad pointers lose only their own entries"
        );
        // An odd name length skips that entry only.
        let mut odd = four();
        odd[ENTRY_STRIDE + OFF_NAME_LEN] = 21;
        assert_eq!(
            parse_game_processes(&odd, &key).unwrap(),
            want[1..].to_vec()
        );
        // A name that runs past the end of the buffer skips that entry only.
        let mut long = four();
        long[ENTRY_STRIDE + OFF_NAME_LEN..ENTRY_STRIDE + OFF_NAME_LEN + 2]
            .copy_from_slice(&60_000u16.to_le_bytes());
        assert_eq!(
            parse_game_processes(&long, &key).unwrap(),
            want[1..].to_vec()
        );
    }

    #[test]
    fn a_corrupt_entry_chain_is_unread_never_a_panic_or_an_endless_walk() {
        let key = name_key("ROB RUN.exe");
        let len = four().len();
        for (label, next) in [
            ("points back into its own header (self-referencing)", 4u32),
            ("does not clear one entry", (ENTRY_MIN - 1) as u32),
            ("past the end of the buffer", (len + 10) as u32),
            ("0xFFFFFFFF", u32::MAX),
        ] {
            let mut buf = four();
            set_u32(&mut buf, ENTRY_STRIDE, next); // the second entry's NextEntryOffset
            assert_eq!(parse_game_processes(&buf, &key), None, "{label}");
        }
        assert_eq!(parse_game_processes(&[], &key), None, "empty buffer");
    }

    fn sys(capacity: u64, idle: u64) -> SysTimes {
        SysTimes { capacity, idle }
    }

    #[test]
    fn a_cpu_tick_one_second_after_the_last_is_a_reading() {
        let t0 = Instant::now();
        let game = [GameProc {
            pid: 1,
            create_time: 1,
            cpu_100ns: 100,
        }];
        let prev = PrevCpu {
            at: t0,
            sys: sys(1000, 400),
            procs: game.to_vec(),
        };
        let later = [GameProc {
            pid: 1,
            create_time: 1,
            cpu_100ns: 200,
        }];
        let one_tick = cpu_interval_pct(
            &prev,
            t0 + Duration::from_millis(1100),
            sys(2000, 1000),
            &later,
        );
        assert!((one_tick.unwrap() - 30.0).abs() < 1e-9, "{one_tick:?}"); // busy 400 - game 100 = 300 of 1000
    }

    #[test]
    fn a_gap_without_a_game_makes_the_next_cpu_tick_prime_instead_of_a_long_average() {
        let t0 = Instant::now();
        let game = [GameProc {
            pid: 1,
            create_time: 1,
            cpu_100ns: 100,
        }];
        let prev = PrevCpu {
            at: t0,
            sys: sys(1000, 400),
            procs: game.to_vec(),
        };
        let later = [GameProc {
            pid: 1,
            create_time: 1,
            cpu_100ns: 200,
        }];
        assert_eq!(
            cpu_interval_pct(
                &prev,
                t0 + Duration::from_millis(1600),
                sys(2000, 1000),
                &later
            ),
            None
        );
        assert_eq!(
            cpu_interval_pct(&prev, t0 + Duration::from_secs(30), sys(2000, 1000), &later),
            None
        );
        assert!(cpu_interval_pct(
            &prev,
            t0 + Duration::from_millis(1500),
            sys(2000, 1000),
            &later
        )
        .is_some());
    }

    #[test]
    fn three_slow_ticks_in_a_row_switch_a_reader_off_and_a_fast_one_resets_the_run() {
        let (slow, fast) = (
            SLOW_CALL + Duration::from_millis(1),
            Duration::from_millis(5),
        );
        let mut g = SlowGuard::default();
        assert!(
            !g.observe(slow) && !g.observe(slow),
            "slow ticks are unread"
        );
        assert!(!g.is_off());
        assert!(g.observe(fast), "a fast tick resets the run");
        assert!(!g.observe(slow) && !g.observe(slow) && !g.is_off());
        assert!(
            !g.observe(slow) && g.is_off(),
            "the third in a row switches it off"
        );
        assert!(
            !g.observe(fast) && g.is_off(),
            "off for the rest of the session"
        );
        assert!(
            SlowGuard::default().observe(SLOW_CALL),
            "exactly the budget is allowed"
        );
    }
    /// Measurement probe, not a gate: `cargo test --lib other_load::tests::probe -- --ignored --nocapture`.
    /// Treats THIS test process as "the game" for ~70 s, with one busy thread so the game share is non-zero.
    #[test]
    #[ignore]
    fn probe() {
        use std::sync::atomic::{AtomicBool, Ordering};
        let name = std::env::current_exe()
            .unwrap()
            .file_name()
            .unwrap()
            .to_string_lossy()
            .into_owned();
        let stop = std::sync::Arc::new(AtomicBool::new(false));
        let s2 = stop.clone();
        let burner = std::thread::spawn(move || {
            let mut x = 1u64;
            while !s2.load(Ordering::Relaxed) {
                x = x.wrapping_mul(6364136223846793005).wrapping_add(1);
                std::hint::black_box(x);
            }
        });
        let mut s = OtherLoadSampler::new(&name);
        let (mut cpu_acc, mut g3_acc, mut gv_acc) = (
            OtherLoadAccumulator::default(),
            OtherLoadAccumulator::default(),
            OtherLoadAccumulator::default(),
        );
        let (mut cpu_ms, mut gpu_ms, mut cpu_max, mut gpu_max, mut n) =
            (0.0_f64, 0.0_f64, 0.0_f64, 0.0_f64, 0u32);
        let me = std::process::id();
        for _ in 0..70 {
            std::thread::sleep(Duration::from_secs(1));
            let t0 = Instant::now();
            let (cpu, mut pids) = s.cpu_tick();
            let t1 = Instant::now();
            if !pids.contains(&me) {
                pids.push(me);
            }
            let gpu = s.gpu_tick(&pids);
            let t2 = Instant::now();
            let (a, b) = (
                (t1 - t0).as_secs_f64() * 1000.0,
                (t2 - t1).as_secs_f64() * 1000.0,
            );
            (cpu_ms, gpu_ms, cpu_max, gpu_max) =
                (cpu_ms + a, gpu_ms + b, cpu_max.max(a), gpu_max.max(b));
            n += 1;
            cpu_acc.record(cpu);
            g3_acc.record(gpu.map(|g| g.d3));
            gv_acc.record(gpu.map(|g| g.video));
            println!(
                "tick {n}: other_cpu={cpu:?} other_gpu={gpu:?} game_pids={} cost {a:.2}/{b:.2} ms",
                pids.len()
            );
        }
        stop.store(true, Ordering::Relaxed);
        burner.join().unwrap();
        println!("PROBE other_cpu       : {:?}", cpu_acc.finish());
        println!("PROBE other_gpu_3d    : {:?}", g3_acc.finish());
        println!("PROBE other_gpu_video : {:?}", gv_acc.finish());
        println!(
            "PROBE tick cost over {n} ticks: A(cpu snapshot) mean {:.2} ms max {cpu_max:.2} ms | B(gpu pdh) mean {:.2} ms max {gpu_max:.2} ms (re-expand every {GPU_REEXPAND_TICKS} ticks)",
            cpu_ms / n as f64,
            gpu_ms / n as f64
        );
    }

    /// Fact-finding for the instance-list refresh: does an ALREADY-OPEN wildcard query ever list a
    /// process that starts after it was opened, or only a freshly opened one? Starts a short-lived,
    /// tiny WPF window in a child PowerShell (it creates a GPU context) and prints, once a second, how
    /// many engine instances belong to that child as seen by (a) the query opened before it started and
    /// (b) a query opened fresh that second. Run with --ignored --nocapture.
    #[test]
    #[ignore]
    fn wildcard_refresh_probe() {
        let old = GpuEngineQuery::open().expect("open");
        let mut scratch = Vec::new();
        std::thread::sleep(Duration::from_secs(2));
        let _ = old.collect_rows(&mut scratch);
        let script = "Add-Type -AssemblyName PresentationFramework; $w=New-Object Windows.Window; \
            $w.WindowStyle='None'; $w.Width=40; $w.Height=40; $w.ShowInTaskbar=$false; $w.Left=0; $w.Top=0; \
            $w.Show(); $e=(Get-Date).AddSeconds(25); while((Get-Date) -lt $e){ Start-Sleep -Milliseconds 100 }";
        let mut child = std::process::Command::new("powershell.exe")
            .args(["-NoProfile", "-WindowStyle", "Hidden", "-Command", script])
            .spawn()
            .expect("spawn");
        let pid = child.id();
        let count_for = |q: &GpuEngineQuery, scratch: &mut Vec<u64>| -> Option<usize> {
            let rows = q.collect_rows(scratch)?;
            Some(
                rows.iter()
                    .filter(|(n, _)| engine_pid(n) == Some(pid))
                    .count(),
            )
        };
        let started = Instant::now();
        for _ in 0..20 {
            std::thread::sleep(Duration::from_secs(1));
            let old_n = count_for(&old, &mut scratch);
            let fresh = GpuEngineQuery::open();
            std::thread::sleep(Duration::from_millis(50));
            let fresh_n = fresh.and_then(|f| count_for(&f, &mut scratch));
            println!(
                "t+{:>4.1}s child instances: already-open query={old_n:?} fresh query={fresh_n:?}",
                started.elapsed().as_secs_f64()
            );
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}
