//! FPS / frametime capture engine (ETW present-event consumer).
//!
//! This runs in a dedicated elevated helper process (`compy.exe
//! --fps-capture`). It subscribes to the Microsoft-Windows-DXGI provider's
//! present events via ETW and derives per-process frame timing from OUTSIDE
//! the game — no DLL injection, the same anti-cheat-safe mechanism Intel
//! PresentMon uses.
//!
//! Why a separate elevated process: creating a real-time ETW session requires
//! Administrator (or membership in "Performance Log Users"). Compy's main
//! window runs unelevated, so it spawns this helper elevated (one UAC prompt
//! when the user starts the FPS graph) and consumes the helper's output.
//!
//! Output: one JSON line per ~500 ms describing the dominant presenting
//! process (the game), plus a human-readable line to stderr. Started by the
//! app (`--pipe <name> --parent-pid <pid>`), the lines go to the app's named
//! pipe (fps_pipe.rs) and the helper writes no file; started by hand with no
//! arguments, they go to stdout (console testing).
//!
//! v1 scope / honest limitations:
//! - Covers DX11 / DX12 titles (anything that presents through DXGI). Vulkan
//!   and OpenGL games present through DxgKrnl, not DXGI, so they won't be
//!   counted until the DxgKrnl provider is added (a follow-up).
//! - Counts present *calls* (IDXGISwapChain::Present), which is the frame rate
//!   the game submits — very close to what overlays report, but not the full
//!   present-completion correlation PresentMon does across multiple providers.
//! - Frametimes are keyed per (process, swapchain): a process presenting two
//!   chains (game + engine UI/overlay) reads each chain's true cadence instead
//!   of a bimodal interleave that halves the average (the 323-vs-161 tester
//!   signature, 2026-06-10). If the swapchain payload can't be parsed, that
//!   pid degrades to a single shared key — fail-open on attribution.
//! - Frame timing uses the event's QPC timestamp converted with
//!   QueryPerformanceFrequency. On the common case (QPC at 10 MHz) this is
//!   exact; if a system reports a different clock the FPS will be off by a
//!   constant factor, which is obvious against any reference overlay.

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use ferrisetw::provider::Provider;
use ferrisetw::schema_locator::SchemaLocator;
use ferrisetw::trace::UserTrace;
use ferrisetw::EventRecord;
use serde::{Deserialize, Serialize};

// Microsoft-Windows-DXGI provider GUID and the PresentStart event id.
// (PresentMon's Microsoft_Windows_DXGI::Present_Start::Id == 42.)
const DXGI_PROVIDER_GUID: &str = "CA11C036-0102-4A2D-A6AD-F03CFED5D3C9";
const PRESENT_START_EVENT_ID: u16 = 42;

// Our real-time ETW session name. Must be stable so we can stop a leftover
// one on startup (see run_capture).
const SESSION_NAME: &str = "Compy-FPS";

// Processes that present frames but are NOT "the game": the desktop compositor
// (which composites borderless windows, so it presents at the game's rate),
// the shell, and Compy's own webview windows. Excluded from the
// dominant-presenter pick so we report the actual game, not the compositor.
const PRESENTER_DENYLIST: &[&str] = &[
    "dwm.exe",
    "explorer.exe",
    "compy.exe",
    // Compy's OWN UI renderer: Tauri webviews run as msedgewebview2.exe CHILD processes — the
    // "compy.exe" entry above never covered them, so the continuously-compositing webview could
    // out-present the game and win the dominant-presenter race: Compy measured ITSELF (tester
    // Export, 2026-06-10: a PoE session recorded as "msedgewebview2.exe · 329 avg"). No game runs
    // inside a WebView2 renderer, so the blanket name exclusion is honest for every app's webview.
    "msedgewebview2.exe",
    "applicationframehost.exe",
    "searchhost.exe",
    "startmenuexperiencehost.exe",
    "textinputhost.exe",
];

/// Read-only window evidence for a presenting pid, probed once per tick. The positive
/// "this is actually a game" identification (0.9.1): a denylist can only name the apps we
/// know about, and rate can't tell a game menu from Discord — so attribution requires the
/// presenter to LOOK like a game being played, not merely to out-present everything else.
#[derive(Clone, Copy, Default)]
pub(crate) struct WindowEvidence {
    /// The pid owns at least one visible, unowned, non-cloaked top-level window.
    /// Electron-style apps (Discord, VS Code, Claude, browsers) present from a GPU child
    /// process that owns NO windows — this signal excludes that whole class structurally,
    /// with no denylist entry per app.
    pub owns_visible_toplevel: bool,
    /// The foreground window belongs to this pid — the user is actually in it.
    pub foreground: bool,
    /// One of its visible top-level windows covers its monitor's full bounds (exclusive
    /// fullscreen or borderless). A maximized desktop app stops at the work area
    /// (taskbar), so it never satisfies this.
    pub covers_monitor: bool,
}

/// One (process, swapchain) presenter candidate in the current stats window.
pub(crate) struct PresenterCandidate {
    pub pid: u32,
    pub name: String,
    pub swapchain: u64,
    pub recent: Vec<f64>,
    pub evidence: WindowEvidence,
}

/// PURE: pick "the game" among per-(pid, swapchain) candidates — TWO stages:
///  1. The dominant PROCESS by total frames across its swapchains, where a denylisted name
///     (compositor / shell / Compy's own UI incl. its msedgewebview2.exe renderers) can NEVER win
///     regardless of frame counts (tester-found guard, 2026-06-10: Compy never measures itself).
///  2. WITHIN the winning process, the dominant SWAPCHAIN — its frametimes alone feed the report,
///     so a second in-process chain (engine UI / overlay) can no longer poison the average with
///     interleaved tiny deltas (the 323-vs-161 signature; see the regression test).
pub(crate) fn select_game_presenter(
    candidates: Vec<PresenterCandidate>,
) -> Option<(u32, String, Vec<f64>)> {
    // Stage 1 — dominant allowed process by TOTAL recent frames.
    let mut totals: HashMap<u32, (String, usize)> = HashMap::new();
    for c in &candidates {
        if c.recent.len() < 2 {
            continue;
        }
        // A presenter we couldn't even NAME can never be "the game": the name is "" when the
        // process snapshot has no readable image name for the pid. (Before the snapshot, the name
        // came from an OpenProcess that was refused for protected processes, so "" mostly meant
        // "protected": live catch 2026-07-22, dwm.exe's name failed to resolve on the dev box, so
        // "" slid past the name denylist below and the compositor won at a fabricated 803 fps.)
        // The snapshot names such presenters too: dwm.exe now meets the denylist, and a game whose
        // anti-cheat used to block the open (it came back "" and was never measured) is now named
        // and CAN attach, if it passes the window evidence in `qualifies_as_game`. That is a new
        // acceptance on purpose, not only new rejections.
        if c.name.is_empty() {
            continue;
        }
        if PRESENTER_DENYLIST.iter().any(|d| c.name.eq_ignore_ascii_case(d)) {
            continue;
        }
        let entry = totals.entry(c.pid).or_insert((c.name.clone(), 0));
        entry.1 += c.recent.len();
    }
    // Deterministic tie-breaks (by pid / by swapchain id): HashMap iteration order varies per
    // tick, and a flapping winner would alternate the reported stream between reports.
    let (&win_pid, (win_name, _)) = totals
        .iter()
        .max_by_key(|(pid, (_, total))| (*total, std::cmp::Reverse(**pid)))?;
    let win_name = win_name.clone();

    // Stage 2 — dominant swapchain within the winner.
    candidates
        .into_iter()
        .filter(|c| c.pid == win_pid && c.recent.len() >= 2)
        .max_by_key(|c| (c.recent.len(), std::cmp::Reverse(c.swapchain)))
        .map(|c| (win_pid, win_name, c.recent))
}

// ---------------------------------------------------------------------------
// Sticky attachment (0.9.1) — fail-closed attribution.
//
// The 0.9.0 defect: the dominant-presenter pick above ran statelessly every
// tick, and EVERYTHING presents through DXGI — so when the game went quiet
// between matches, the report wandered to Discord / Radeon Software / VS Code /
// Claude (tester Export, 2026-07-22). A denylist can't enumerate every desktop
// app and present-rate can't distinguish a game menu from an Electron app, so
// the fix is positive identification + stickiness:
//
//  ACQUIRE  a candidate only when it looks like a game being PLAYED (named,
//           not denylisted, owns a visible top-level window, is foreground,
//           and that window covers its monitor) AND it wins for
//           ATTACH_STREAK_TICKS consecutive ticks.
//  ATTACHED report ONLY that pid. Foreground is NOT re-required (alt-tab
//           safe). If it goes silent (menu / loading / minimized), emit
//           NOTHING — never re-pick. Consumers already treat a >3 s-stale
//           fps.json as no-sample, so silence degrades cleanly.
//  RELEASE  only when the process is gone (or its pid was recycled by a
//           different image), returning to fail-closed acquisition.
//
// No sample is always preferred over a wrong sample.

/// Consecutive qualified-winner ticks (~500 ms each) required to attach.
const ATTACH_STREAK_TICKS: u32 = 3;

pub(crate) enum Attachment {
    Unattached { last_pid: Option<u32>, streak: u32 },
    Attached { pid: u32, name: String },
}

impl Attachment {
    pub(crate) fn new() -> Self {
        Attachment::Unattached { last_pid: None, streak: 0 }
    }
}

/// Does this candidate positively look like a game the user is playing?
/// (Name/denylist checks are re-applied inside `select_game_presenter`; the
/// window evidence is the acquisition-only addition.)
fn qualifies_as_game(c: &PresenterCandidate) -> bool {
    c.evidence.owns_visible_toplevel && c.evidence.foreground && c.evidence.covers_monitor
}

/// PURE: advance the attachment state machine one tick. `alive` answers "is
/// pid still a live process running this image?" (injected so tests need no
/// OS). Returns the next state plus the report to emit — `None` means emit
/// nothing this tick (fail-closed).
pub(crate) fn advance_attachment(
    state: Attachment,
    candidates: Vec<PresenterCandidate>,
    alive: &dyn Fn(u32, &str) -> bool,
) -> (Attachment, Option<(u32, String, Vec<f64>)>) {
    match state {
        Attachment::Attached { pid, name } => {
            // Report the attached game's dominant swapchain — and nothing else,
            // no matter who out-presents it this tick.
            //
            // A pid is not an identity. Windows reuses pids aggressively, and matching on the
            // number alone let a recycled pid inherit the attachment: the new process's real
            // frames were published under the dead game's name, into sessions.json, comparisons,
            // the scoreboard and every export. The name is re-resolved by ETW on each tick, so a
            // recycled pid arrives here wearing what it now IS — and must not match.
            let mine: Vec<PresenterCandidate> =
                candidates.into_iter().filter(|c| c.pid == pid).collect();
            // Our pid is presenting under a name that is not ours. Whatever `alive` believes, two
            // identity signals now disagree about the same number, and a measurement taken while
            // they disagree is a guess. Fail closed rather than pick a winner.
            let impostor = mine.iter().any(|c| c.name != name);
            let frames = mine
                .into_iter()
                .filter(|c| c.name == name && c.recent.len() >= 2)
                .max_by_key(|c| (c.recent.len(), std::cmp::Reverse(c.swapchain)))
                .map(|c| c.recent);
            match frames {
                // Identity is proven on the FRAME path too, not only when the tick is silent.
                // `alive` used to sit on the silent branch alone, so the one case that produces a
                // wrong measurement — a recycled pid that is actively presenting — was the one
                // case that never reached it.
                Some(f) if alive(pid, &name) => {
                    let report = (pid, name.clone(), f);
                    (Attachment::Attached { pid, name }, Some(report))
                }
                // Presenting, but no longer ours. Drop the sample and reacquire through the
                // ordinary positive-window/streak rules — never carry the name forward.
                Some(_) => (Attachment::new(), None),
                // Nothing of ours, and the pid is wearing somebody else's name: that is a recycle,
                // not a loading screen. Release rather than sit attached to a number.
                None if impostor => (Attachment::new(), None),
                // Silent tick: between matches / loading / minimized. Emit
                // nothing; stay attached while the process lives.
                None if alive(pid, &name) => (Attachment::Attached { pid, name }, None),
                None => (Attachment::new(), None),
            }
        }
        Attachment::Unattached { last_pid, streak } => {
            let qualified: Vec<PresenterCandidate> =
                candidates.into_iter().filter(qualifies_as_game).collect();
            match select_game_presenter(qualified) {
                Some((pid, name, frames)) => {
                    let streak = if last_pid == Some(pid) { streak + 1 } else { 1 };
                    if streak >= ATTACH_STREAK_TICKS {
                        (Attachment::Attached { pid, name: name.clone() }, Some((pid, name, frames)))
                    } else {
                        (Attachment::Unattached { last_pid: Some(pid), streak }, None)
                    }
                }
                // No fully-qualified game presenter → no sample. Never guess.
                None => (Attachment::new(), None),
            }
        }
    }
}

// How far back the per-second stats window looks, and how often we report.
pub(crate) const REPORT_INTERVAL_MS: u64 = 500;
const STATS_WINDOW: Duration = Duration::from_secs(1);
// Drop a process from tracking after this long with no presents (it stopped
// rendering / closed), so the map doesn't grow without bound.
const STALE_AFTER: Duration = Duration::from_secs(3);

struct Sample {
    /// Wall-clock instant the present was observed — used only to window
    /// "the last second", never for the frametime magnitude itself.
    at: Instant,
    /// Frame interval in milliseconds, computed from the QPC delta between
    /// consecutive presents of the same (process, swapchain).
    frametime_ms: f64,
}

struct Tracker {
    last_qpc: i64,
    samples: Vec<Sample>,
    /// P4-smooth-measure: every frame this chain has presented since the tracker was created,
    /// counted once into fixed buckets (`frame_hist`). Cumulative, so a reader that misses a report
    /// loses nothing; `hist_id` tells a reader when the count restarted (a new tracker).
    hist_id: u64,
    hist: Vec<u64>,
}

impl Tracker {
    fn new() -> Self {
        Tracker {
            last_qpc: 0,
            samples: Vec::new(),
            hist_id: frame_hist::next_id(),
            hist: vec![0; frame_hist::BUCKETS],
        }
    }

    /// The cumulative histogram as the report ships it: only non-empty buckets.
    fn hist_wire(&self) -> FrameHistWire {
        FrameHistWire {
            id: self.hist_id,
            counts: self
                .hist
                .iter()
                .enumerate()
                .filter(|(_, c)| **c > 0)
                .map(|(i, c)| (i as u16, *c))
                .collect(),
        }
    }

    /// One present observed on THIS tracker's key. Computes the delta to the previous present on
    /// the SAME key — what "same key" means is the whole honesty story: keyed per (pid, swapchain),
    /// a process presenting two chains yields each chain's true cadence; keyed per pid alone, the
    /// interleaved deltas go bimodal and poison the average (the 323-vs-161 tester signature —
    /// see the regression test).
    fn record(&mut self, qpc: i64, freq: f64, at: Instant) {
        if self.last_qpc != 0 && qpc > self.last_qpc {
            let dt_ms = (qpc - self.last_qpc) as f64 * 1000.0 / freq;
            // Ignore absurd intervals: 0 (duplicate timestamp) or > 1 s (idle / alt-tabbed).
            // A freeze of a second or more still counts in the pacing histogram (its overflow
            // bucket): it is exactly what smoothness should see. The live figures keep the cap.
            if dt_ms > 0.0 {
                self.hist[frame_hist::bucket(dt_ms)] += 1;
            }
            if dt_ms > 0.0 && dt_ms < 1000.0 {
                self.samples.push(Sample {
                    at,
                    frametime_ms: dt_ms,
                });
                if self.samples.len() > 2000 {
                    let excess = self.samples.len() - 2000;
                    self.samples.drain(0..excess);
                }
            }
        }
        self.last_qpc = qpc;
    }
}

/// P4-smooth-measure: a fixed-bucket histogram of frame times, so a whole session's true per-frame
/// percentiles are kept without storing a single frame. Bucket `i` holds frame times in
/// `[LO_MS * RATIO^i, LO_MS * RATIO^(i+1))`; a percentile reads as its bucket's geometric middle, so
/// it is within half a bucket (0.5%) of the real frame time. Every frame is counted: a freeze of
/// [`OVERFLOW_MS`] or more lands in the last ([`OVERFLOW`]) bucket and reads as exactly
/// `OVERFLOW_MS`, so a percentile that falls on a freeze over 1 s is capped there (a floor, never
/// an overstatement). The helper counts, the app diffs
/// consecutive cumulative snapshots (`SessionAccumulator::record_frame_hist`), and only four numbers
/// reach sessions.json (`sessions::FramePacing`).
pub(crate) mod frame_hist {
    /// Frame times under this land in bucket 0 (4000 fps); none that short are real game frames.
    pub(crate) const LO_MS: f64 = 0.25;
    /// Each bucket is 1% wider than the one before.
    pub(crate) const RATIO: f64 = 1.01;
    /// Frame times from here up are freezes, all counted in the [`OVERFLOW`] bucket.
    pub(crate) const OVERFLOW_MS: f64 = 1000.0;
    /// The regular buckets reach just past `OVERFLOW_MS` (834 of them); the freeze bucket follows.
    pub(crate) const OVERFLOW: usize = 834;
    pub(crate) const BUCKETS: usize = OVERFLOW + 1;

    pub(crate) fn bucket(ms: f64) -> usize {
        if ms.is_nan() || ms <= LO_MS {
            return 0;
        }
        if ms >= OVERFLOW_MS {
            return OVERFLOW;
        }
        (((ms / LO_MS).ln() / RATIO.ln()).floor() as usize).min(OVERFLOW - 1)
    }

    /// The frame time a bucket stands for: its geometric middle, or `OVERFLOW_MS` for a freeze.
    pub(crate) fn bucket_ms(i: usize) -> f64 {
        if i >= OVERFLOW {
            return OVERFLOW_MS;
        }
        LO_MS * RATIO.powf(i as f64 + 0.5).min(OVERFLOW_MS / LO_MS)
    }

    /// The `q` percentile (0..1) of the frames counted in `counts` (one count per bucket), by the
    /// same rank rule as the helper's live 1% low: the frame at rank ceil(q·n). `None` when empty.
    pub(crate) fn percentile(counts: &[u64], q: f64) -> Option<f64> {
        let n: u64 = counts.iter().sum();
        if n == 0 {
            return None;
        }
        let rank = ((n as f64 * q).ceil() as u64).clamp(1, n);
        let mut seen = 0u64;
        for (i, c) in counts.iter().enumerate() {
            seen += c;
            if seen >= rank {
                return Some(bucket_ms(i));
            }
        }
        None
    }

    /// A process-unique start for tracker ids, so a restarted helper's first tracker never reuses
    /// the id the app last saw.
    pub(crate) fn next_id() -> u64 {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::sync::OnceLock;
        static BASE: OnceLock<u64> = OnceLock::new();
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let base = *BASE.get_or_init(|| {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos() as u64)
                .unwrap_or(1)
        });
        base.wrapping_add(NEXT.fetch_add(1, Ordering::Relaxed))
    }
}

/// The reported chain's cumulative frame-time histogram (P4-smooth-measure): `(bucket, count)` for
/// each non-empty bucket of [`frame_hist`], counted since `id`'s tracker was created. Additive on
/// the wire: an older app ignores it, and an older helper's line has none.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct FrameHistWire {
    pub id: u64,
    pub counts: Vec<(u16, u64)>,
}

/// PURE: which of the tick's chains the report came from. `chains` are the tick's candidates as
/// (pid, swapchain, recent frames); the report's frames are that chain's `recent` unchanged, so the
/// chain is the one of the reported pid whose frames are the reported ones.
pub(crate) fn reported_chain(chains: &[(u32, u64, Vec<f64>)], pid: u32, frames: &[f64]) -> Option<u64> {
    chains
        .iter()
        .find(|(p, _, recent)| *p == pid && recent.as_slice() == frames)
        .map(|(_, sc, _)| *sc)
}

// Cap on the number of per-frame frametimes shipped in each report. At a few
// hundred FPS this is ~1–2 s of frames — enough for a meaningful frametime
// line without bloating the IPC file.
const MAX_FRAMETIME_POINTS: usize = 240;

#[derive(Serialize)]
struct FpsReport {
    pid: u32,
    /// Resolved executable name of the presenting process (the game), e.g.
    /// "Cyberpunk2077.exe". Empty if it couldn't be resolved.
    process_name: String,
    fps: f64,
    avg_frametime_ms: f64,
    /// "1% low" framerate: 1000 / (99th-percentile frametime). The worst 1%
    /// of frame intervals expressed as an FPS — the number that captures
    /// stutter the average hides.
    low1_fps: f64,
    frames_last_sec: usize,
    /// The most recent per-frame frametimes (ms), oldest→newest, capped to
    /// MAX_FRAMETIME_POINTS. The UI draws this as the frametime line so
    /// individual spikes are visible, not just a smoothed average.
    recent_frametimes_ms: Vec<f64>,
    /// Was the game's window the one in front this tick? `None` = Compy
    /// couldn't tell (no foreground window resolvable), which readers must
    /// treat as unknown, never as "in the background".
    #[serde(skip_serializing_if = "Option::is_none")]
    foreground: Option<bool>,
    /// P4-smooth-measure: the reported chain's cumulative frame-time histogram ([`FrameHistWire`]).
    #[serde(skip_serializing_if = "Option::is_none")]
    frame_hist: Option<FrameHistWire>,
    /// How many ticks since this helper started could not read the process snapshot (and so emitted
    /// nothing). Cumulative; omitted while 0. Lets a reader tell "the helper could not look" from
    /// "no frames". The app reads it into `FpsSample::snapshot_unreadable_ticks`.
    #[serde(skip_serializing_if = "is_zero")]
    snapshot_unreadable_ticks: u64,
}

fn is_zero(n: &u64) -> bool {
    *n == 0
}

/// Appended to the report file's path for the unreadable-tick marker: a file holding the cumulative
/// count, rewritten on every unreadable tick. The app reads its AGE (monitoring.rs `unreadable_read`):
/// younger than the last report means the helper is, right now, unable to look. Since hardening slice 2
/// the APP writes both files (as the user) from the helper's pipe lines; the helper writes no file.
pub(crate) const UNREADABLE_SUFFIX: &str = ".snapshot-unreadable";

/// Counts ticks whose process snapshot could not be read, and rate-limits the message about it: the
/// first, then every `EVERY`th (a persistent failure would otherwise print twice a second).
#[derive(Default)]
struct UnreadableTicks {
    total: u64,
}

impl UnreadableTicks {
    const EVERY: u64 = 120; // ~1 minute at one tick per 500 ms

    /// Record one unreadable tick; true when it should be reported now.
    fn note(&mut self) -> bool {
        self.total += 1;
        self.total == 1 || self.total.is_multiple_of(Self::EVERY)
    }
}

/// One unreadable tick: count it and send the marker line (every tick, so the app's marker file stays
/// current while the failure lasts). True when the message should be printed now (rate-limited).
fn note_unreadable_tick(unreadable: &mut UnreadableTicks, sink: &Sink) -> bool {
    let say = unreadable.note();
    sink.marker(unreadable.total);
    say
}

/// Where the helper's lines go: the app's pipe, or (console test mode) stdout.
enum Sink {
    Console,
    Pipe(crate::fps_pipe::PipeWriter),
}

impl Sink {
    /// A report line (today's FpsReport JSON).
    fn report(&self, line: &str) {
        match self {
            Sink::Console => {
                let stdout = std::io::stdout();
                let mut handle = stdout.lock();
                let _ = writeln!(handle, "{line}");
                let _ = handle.flush();
            }
            Sink::Pipe(w) => {
                // A report that does not fit is counted as dropped (review r2 N3).
                w.send_report(line.to_string());
            }
        }
    }

    /// The unreadable-tick count (the app writes it to the marker file). A count that does not fit is
    /// kept and re-sent at the next tick (`tell_dropped`), never counted as a dropped line (review r2 N3).
    fn marker(&self, total: u64) {
        if let Sink::Pipe(w) = self {
            w.send_unreadable(total);
        }
    }

    /// Nothing to report this tick: keeps the pipe busy, so the app's stop (it closes the pipe) is seen
    /// at the next write.
    fn alive(&self) {
        if let Sink::Pipe(w) = self {
            w.send(crate::fps_pipe::ALIVE_LINE.to_string());
        }
    }

    /// The app closed the pipe (stop, exit, crash): time to exit.
    fn closed(&self) -> bool {
        matches!(self, Sink::Pipe(w) if w.broken())
    }

    /// Once per tick: re-send an unreadable count that did not fit, then tell the app the running count
    /// of reports the queue had to drop, if it grew (the app counts them as ticks it could not measure,
    /// never as frames lost silently).
    fn tell_dropped(&self) {
        if let Sink::Pipe(w) = self {
            w.retry_unreadable();
            w.tell_dropped();
        }
    }

    fn dropped(&self) -> u64 {
        match self {
            Sink::Pipe(w) => w.dropped(),
            Sink::Console => 0,
        }
    }
}

/// What one tick's identity step produced. `skipped` = the snapshot was unreadable: nothing was
/// decided and `attachment` / `created` are exactly what came in (fail closed, state unchanged).
struct IdentityStep {
    attachment: Attachment,
    created: Option<(u32, i64)>,
    best: Option<(u32, String, Vec<f64>)>,
    skipped: bool,
}

/// The closure `advance_attachment` is given: is `pid` still the process we attached to? `created` is
/// the creation time remembered at attach (only for that pid).
fn alive_for(
    rows: &[crate::other_load::ProcRow],
    created: Option<(u32, i64)>,
    pid: u32,
    name: &str,
) -> bool {
    let created = created.filter(|(p, _)| *p == pid).map(|(_, c)| c);
    crate::other_load::alive_as(rows, pid, name, created)
}

/// One tick of identity: name every candidate from the snapshot, advance the sticky attachment, and
/// remember the attached pid's creation time. `rows == None` (snapshot unreadable) changes nothing.
fn identity_step(
    attachment: Attachment,
    created: Option<(u32, i64)>,
    mut candidates: Vec<PresenterCandidate>,
    rows: Option<&[crate::other_load::ProcRow]>,
) -> IdentityStep {
    let Some(rows) = rows else {
        return IdentityStep { attachment, created, best: None, skipped: true };
    };
    for c in &mut candidates {
        c.name = crate::other_load::image_name_for(rows, c.pid);
    }
    let (next, best) = advance_attachment(attachment, candidates, &|pid, name| alive_for(rows, created, pid, name));
    let created = track_created(created, &next, rows);
    IdentityStep { attachment: next, created, best, skipped: false }
}

/// What the report says about foreground. Only a resolvable foreground
/// window lets Compy say "not in front"; otherwise it stays unknown. And only
/// a presenter that owns a visible top-level window of its own can be "behind":
/// a UWP game (window owned by ApplicationFrameHost) or one whose window a
/// launcher owns would otherwise read "not in front" every tick and lose the
/// whole session. Any window another process owns counts as "not in front",
/// including ones that take focus without the player leaving the game: the
/// GeForce overlay (Alt+Z), Xbox Game Bar, a clicked Discord window. An
/// in-process overlay (Steam's) belongs to the game and stays in front.
fn report_foreground(fg_known: bool, ev: Option<&WindowEvidence>) -> Option<bool> {
    if !fg_known {
        return None;
    }
    match ev {
        Some(e) if e.owns_visible_toplevel => Some(e.foreground),
        _ => None,
    }
}

/// How the helper was started (the args after `--fps-capture`).
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CaptureMode {
    /// No `--pipe`: print reports to stdout until killed (console test mode).
    Console,
    /// `--pipe <name> --parent-pid <pid>`: send lines to the app's pipe; exit when it closes.
    Pipe { name: String, parent_pid: u32 },
}

/// The helper's exit code for refused arguments (old file flags, a malformed pipe or pid, or console
/// mode in a release build). Nothing was started. monitoring.rs `elevated_helper_status` reads it.
pub(crate) const EXIT_REFUSED_ARGS: i32 = 2;
/// The helper's exit code when the pipe could not be opened or its server failed the consistency check.
/// Nothing was started. monitoring.rs `elevated_helper_status` reads it.
pub(crate) const EXIT_PIPE_NOT_CONFIRMED: i32 = 4;

/// PURE: console mode (no `--pipe`: an elevated capture with no way to be told to stop) is for a
/// developer at a console, so a release build refuses it (review r1, non-blocking).
pub(crate) fn mode_allowed(mode: CaptureMode, debug_build: bool) -> Result<CaptureMode, &'static str> {
    match mode {
        CaptureMode::Console if !debug_build => Err("refused: console mode is for debug builds; the app passes --pipe"),
        m => Ok(m),
    }
}

/// PURE: parse the capture args. Hardening slice 2: the helper takes no path. `--fps-out` and
/// `--fps-alive` (the old file channel) are refused outright, so no command line can make it write,
/// rename or watch a file; `--pipe` needs `--parent-pid`, and both must be well-formed.
pub(crate) fn parse_capture_args(args: &[String]) -> Result<CaptureMode, &'static str> {
    if args.iter().any(|a| a == "--fps-out" || a == "--fps-alive") {
        return Err("refused: --fps-out / --fps-alive are no longer accepted");
    }
    let find = |flag: &str| args.iter().position(|a| a == flag).map(|i| args.get(i + 1));
    match (find("--pipe"), find("--parent-pid")) {
        (None, None) => Ok(CaptureMode::Console),
        (Some(Some(name)), Some(Some(pid))) => {
            let parent_pid = pid.parse::<u32>().map_err(|_| "refused: --parent-pid is not a process id")?;
            if !crate::fps_pipe::is_valid_pipe_name(name) {
                return Err("refused: not a Compy capture pipe name");
            }
            Ok(CaptureMode::Pipe { name: name.clone(), parent_pid })
        }
        _ => Err("refused: --pipe and --parent-pid go together, each with a value"),
    }
}

// A presenter's image name and "is the attached game still the same process" both come from ONE
// handle-free system snapshot per tick (`other_load::read_process_rows`): this file opens no process,
// the game included. (It used to OpenProcess each presenting pid, twice per tick for the game.)

/// The creation time of the attached pid, remembered from the tick it attached, so a recycled pid (even
/// of the same exe) reads as a different process. PURE: `prev` is what was remembered, `rows` this tick's
/// snapshot. Cleared when unattached; kept while the same pid stays attached; (re)read from the snapshot
/// when a pid newly attaches or nothing was recorded yet.
fn track_created(
    prev: Option<(u32, i64)>,
    attachment: &Attachment,
    rows: &[crate::other_load::ProcRow],
) -> Option<(u32, i64)> {
    let Attachment::Attached { pid, .. } = attachment else {
        return None;
    };
    match prev {
        Some((p, c)) if p == *pid => Some((p, c)),
        _ => crate::other_load::find_row(rows, *pid).map(|r| (*pid, r.create_time)),
    }
}

/// One EnumWindows pass → WindowEvidence per pid of interest. Read-only: no
/// window, process, or policy state is touched.
/// The bool says whether a foreground window was resolvable at all; without
/// it, `foreground == false` on every pid would be a guess, not evidence.
fn probe_window_evidence(pids: &[u32]) -> (HashMap<u32, WindowEvidence>, bool) {
    use windows::Win32::Foundation::{HWND, LPARAM, RECT};
    use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindow, GetWindowRect, GetWindowThreadProcessId,
        IsWindowVisible, GW_OWNER,
    };

    struct Ctx {
        evidence: HashMap<u32, WindowEvidence>,
    }

    // Borderless/fullscreen windows match their monitor bounds exactly; a few px
    // of tolerance absorbs DPI-virtualization rounding, while a maximized desktop
    // window still misses by the taskbar height (~40+ px), so it never passes.
    const COVER_TOLERANCE_PX: i32 = 4;

    unsafe extern "system" fn enum_cb(hwnd: HWND, lparam: LPARAM) -> windows::Win32::Foundation::BOOL {
        let ctx = unsafe { &mut *(lparam.0 as *mut Ctx) };
        let mut pid = 0u32;
        unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
        let Some(ev) = ctx.evidence.get_mut(&pid) else {
            return true.into(); // not a presenting pid — keep enumerating
        };
        // Only visible, unowned (true top-level), non-cloaked windows count as
        // game-window evidence. Cloaked = a DWM-hidden ghost (suspended UWP,
        // virtual-desktop resident) that IsWindowVisible still reports true for.
        if !unsafe { IsWindowVisible(hwnd) }.as_bool()
            || unsafe { GetWindow(hwnd, GW_OWNER) }.is_ok_and(|o| !o.is_invalid())
        {
            return true.into();
        }
        let mut cloaked = 0u32;
        let cloak_ok = unsafe {
            DwmGetWindowAttribute(
                hwnd,
                DWMWA_CLOAKED,
                &mut cloaked as *mut u32 as *mut _,
                std::mem::size_of::<u32>() as u32,
            )
        };
        if cloak_ok.is_ok() && cloaked != 0 {
            return true.into();
        }
        ev.owns_visible_toplevel = true;

        let mut rect = RECT::default();
        if unsafe { GetWindowRect(hwnd, &mut rect) }.is_ok() {
            let monitor = unsafe { MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST) };
            let mut info = MONITORINFO {
                cbSize: std::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
                let m = info.rcMonitor;
                if rect.left <= m.left + COVER_TOLERANCE_PX
                    && rect.top <= m.top + COVER_TOLERANCE_PX
                    && rect.right >= m.right - COVER_TOLERANCE_PX
                    && rect.bottom >= m.bottom - COVER_TOLERANCE_PX
                {
                    ev.covers_monitor = true;
                }
            }
        }
        true.into()
    }

    let mut ctx = Ctx {
        evidence: pids.iter().map(|&p| (p, WindowEvidence::default())).collect(),
    };
    let mut fg_known = false;
    unsafe {
        let _ = EnumWindows(Some(enum_cb), LPARAM(&mut ctx as *mut Ctx as isize));
        let fg = GetForegroundWindow();
        if !fg.is_invalid() {
            let mut fg_pid = 0u32;
            // A foreground window whose owner can't be resolved (a zero thread id or pid) says
            // nothing: unknown, never "someone else is in front". No foreground window at all
            // (mid-switch, a UAC prompt, the lock screen) leaves `fg_known` false too.
            fg_known = GetWindowThreadProcessId(fg, Some(&mut fg_pid)) != 0 && fg_pid != 0;
            if let Some(ev) = ctx.evidence.get_mut(&fg_pid) {
                ev.foreground = true;
            }
        }
    }
    (ctx.evidence, fg_known)
}

fn perf_frequency() -> i64 {
    use windows::Win32::System::Performance::QueryPerformanceFrequency;
    let mut f = 0i64;
    // SAFETY: writing a single i64 the API fully initializes.
    unsafe {
        let _ = QueryPerformanceFrequency(&mut f);
    }
    if f == 0 {
        10_000_000
    } else {
        f
    }
}

/// Parse the swapchain address from a DXGI Present_Start payload (the field PresentMon keys on).
/// Pointer-sized per the EMITTING process, so try the pointer read first, then raw widths.
/// 0 = couldn't parse → that pid's events degrade to a single shared key (the old pid-level
/// behavior) rather than being dropped — fail-open on attribution, never on counting.
fn parse_swapchain(record: &EventRecord, schema_locator: &SchemaLocator) -> u64 {
    let Ok(schema) = schema_locator.event_schema(record) else {
        return 0;
    };
    let parser = ferrisetw::parser::Parser::create(record, &schema);
    if let Ok(p) = parser.try_parse::<ferrisetw::parser::Pointer>("pIDXGISwapChain") {
        return *p as u64;
    }
    if let Ok(v) = parser.try_parse::<u64>("pIDXGISwapChain") {
        return v;
    }
    if let Ok(v) = parser.try_parse::<u32>("pIDXGISwapChain") {
        return v as u64;
    }
    0
}

/// `logman stop Compy-FPS -ets`, run inside the capture helper, which is usually ELEVATED. Hardening
/// slice 1b: like the elevated command helper, it starts the real logman.exe from the system directory
/// with the inherited (user-shaped) environment cleared and only the short allowlist restored. Same
/// arguments as before.
fn stale_session_stop_command() -> std::process::Command {
    let mut c = crate::sys_exe::elevated_command(crate::sys_exe::SysTool::Logman);
    c.args(["stop", SESSION_NAME, "-ets"]);
    c
}

pub fn run_capture() {
    // Hardening slice 2: argv and the pipe are checked BEFORE anything runs as admin (the ETW session,
    // the logman stop). A refused argv exits 2, a pipe that is not the starting Compy's exits 4; in
    // both cases nothing was written and nothing was started.
    let args: Vec<String> = std::env::args().collect();
    let sink = match parse_capture_args(&args).and_then(|m| mode_allowed(m, cfg!(debug_assertions))) {
        Err(why) => {
            eprintln!("[compy-fps] {why}");
            std::process::exit(EXIT_REFUSED_ARGS);
        }
        Ok(CaptureMode::Console) => Sink::Console,
        Ok(CaptureMode::Pipe { name, parent_pid }) => match crate::fps_pipe::connect_to_parent(&name, parent_pid) {
            Ok(pipe) => Sink::Pipe(crate::fps_pipe::PipeWriter::start(pipe)),
            Err(why) => {
                eprintln!("[compy-fps] {why}");
                std::process::exit(EXIT_PIPE_NOT_CONFIRMED);
            }
        },
    };
    let freq = perf_frequency() as f64;
    // Keyed by (pid, swapchain) — NOT pid alone. A process presenting two chains (game + engine
    // UI / overlay) interleaves presents; pid-level deltas go bimodal and halve the average
    // (the 323-vs-161 tester signature). Per-chain keying restores each chain's true cadence.
    let state: Arc<Mutex<HashMap<(u32, u64), Tracker>>> = Arc::new(Mutex::new(HashMap::new()));
    let cb_state = state.clone();

    let provider = Provider::by_guid(DXGI_PROVIDER_GUID)
        .add_callback(move |record: &EventRecord, schema_locator: &SchemaLocator| {
            if record.event_id() != PRESENT_START_EVENT_ID {
                return;
            }
            let pid = record.process_id();
            if pid == 0 {
                return;
            }
            let swapchain = parse_swapchain(record, schema_locator);
            let qpc = record.raw_timestamp();
            let Ok(mut map) = cb_state.lock() else {
                return;
            };
            map.entry((pid, swapchain))
                .or_insert_with(Tracker::new)
                .record(qpc, freq, Instant::now());
        })
        .build();

    // Stop any leftover session of our name from a previous run that didn't
    // clean up (e.g. was hard-killed — ferrisetw only stops the session on a
    // clean Drop). Without this, StartTrace fails with AlreadyExist and FPS
    // capture can never start again until reboot. logman is built into
    // Windows; ignore its result (no session => harmless error).
    let _ = stale_session_stop_command().output();

    let trace = UserTrace::new()
        .named(SESSION_NAME.to_string())
        .enable(provider)
        .start_and_process();

    // Keep the trace guard alive for the life of the process; dropping it
    // stops the ETW session.
    let _trace = match trace {
        Ok(t) => t,
        Err(e) => {
            eprintln!("[compy-fps] failed to start ETW session: {e:?}");
            eprintln!(
                "[compy-fps] this requires Administrator — run from an elevated console."
            );
            std::process::exit(1);
        }
    };

    eprintln!(
        "[compy-fps] capturing DXGI present events. Launch a DX11/DX12 game to see frames."
    );

    // Sticky game attachment (0.9.1): acquire on positive window evidence +
    // streak, then report ONLY the attached pid; silence emits nothing.
    let mut attachment = Attachment::new();
    // (pid, creation time) of the attached game, from the snapshot of the tick it attached.
    let mut attached_created: Option<(u32, i64)> = None;
    // The snapshot buffer lives across ticks (no 1 MiB allocation per tick), and unreadable ticks are counted.
    let mut snap_buf: Vec<u8> = Vec::new();
    let mut unreadable = UnreadableTicks::default();
    // Whether the last tick sent a line; a silent tick sends a keepalive at the top of the next one.
    let mut sent = true;
    loop {
        std::thread::sleep(Duration::from_millis(REPORT_INTERVAL_MS));
        let now = Instant::now();

        // Self-exit when the app closes the pipe (monitoring turned off, or the app closed or crashed).
        // A non-elevated parent can't kill us, so this is how the elevated helper shuts down cleanly.
        // The pipe replaced the old heartbeat file: the helper watches no file.
        if sink.closed() {
            eprintln!("[compy-fps] the app closed the capture pipe - exiting ({} lines dropped).", sink.dropped());
            break;
        }
        if !std::mem::replace(&mut sent, false) {
            sink.alive();
        }
        sink.tell_dropped();

        let Ok(mut map) = state.lock() else {
            continue;
        };

        // Prune old samples and processes that stopped presenting.
        map.retain(|_, tr| {
            tr.samples
                .retain(|s| now.duration_since(s.at) <= STALE_AFTER);
            !tr.samples.is_empty()
        });

        // Build per-(pid, swapchain) candidates, then advance the sticky
        // attachment machine: acquisition runs the pure, guard-tested
        // select_game_presenter over WINDOW-QUALIFIED candidates only (Compy's
        // own UI / compositor / shell / windowless Electron GPU processes can
        // never win); once attached, only that pid is ever reported. Names
        // come from one handle-free snapshot per tick (below); window evidence probes once per tick.
        let mut candidates: Vec<PresenterCandidate> = Vec::new();
        for ((pid, swapchain), tr) in map.iter() {
            let recent: Vec<f64> = tr
                .samples
                .iter()
                .filter(|s| now.duration_since(s.at) <= STATS_WINDOW)
                .map(|s| s.frametime_ms)
                .collect();
            if recent.len() < 2 {
                continue;
            }
            candidates.push(PresenterCandidate {
                pid: *pid,
                name: String::new(), // filled from the snapshot below, once the map lock is released
                swapchain: *swapchain,
                recent,
                evidence: WindowEvidence::default(),
            });
        }
        drop(map);
        let chains: Vec<(u32, u64, Vec<f64>)> =
            candidates.iter().map(|c| (c.pid, c.swapchain, c.recent.clone())).collect();
        let pids: Vec<u32> = candidates.iter().map(|c| c.pid).collect();
        let (evidence, fg_known) = probe_window_evidence(&pids);
        for c in &mut candidates {
            c.evidence = evidence.get(&c.pid).copied().unwrap_or_default();
        }
        let was_attached = matches!(&attachment, Attachment::Attached { .. });
        // ONE handle-free snapshot names every presenter and answers "is the attached game still that
        // process". Nothing to name and nothing attached: nothing to ask, so no snapshot. Unreadable:
        // `identity_step` decides nothing and changes nothing (fail closed): it must neither name the
        // game "" nor release a live attachment.
        let rows = if candidates.is_empty() && !was_attached {
            Some(Vec::new())
        } else {
            crate::other_load::read_process_rows_into(&mut snap_buf)
        };
        let step = identity_step(
            std::mem::replace(&mut attachment, Attachment::new()),
            attached_created,
            candidates,
            rows.as_deref(),
        );
        attachment = step.attachment;
        attached_created = step.created;
        let best = step.best;
        if step.skipped {
            // The marker is written on EVERY unreadable tick (the message is rate-limited, the file is
            // not): the app reads its age to tell "Compy couldn't read this second" from "no frames".
            sent = true;
            if note_unreadable_tick(&mut unreadable, &sink) {
                eprintln!(
                    "[compy-fps] process snapshot unreadable - skipping the tick ({} so far).",
                    unreadable.total
                );
            }
            continue;
        }
        match (&attachment, was_attached) {
            (Attachment::Attached { pid, name }, false) => {
                eprintln!("[compy-fps] attached to {name} (pid {pid})");
            }
            (Attachment::Unattached { .. }, true) => {
                eprintln!("[compy-fps] game exited — detached, watching for the next one.");
            }
            _ => {}
        }

        if let Some((pid, process_name, frametimes)) = best {
            let frames = frametimes.len();
            let avg = frametimes.iter().sum::<f64>() / frames as f64;

            // Percentile on a sorted copy; keep `frametimes` in chronological
            // order for the per-frame line graph.
            let mut sorted = frametimes.clone();
            sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let p99_idx = (((frames as f64) * 0.99).ceil() as usize)
                .min(frames)
                .saturating_sub(1);
            let p99 = sorted[p99_idx];

            // Ship at most the most-recent MAX_FRAMETIME_POINTS, chronological.
            let recent_frametimes_ms: Vec<f64> = if frametimes.len() > MAX_FRAMETIME_POINTS {
                frametimes[frametimes.len() - MAX_FRAMETIME_POINTS..].to_vec()
            } else {
                frametimes.clone()
            };

            let foreground = report_foreground(fg_known, evidence.get(&pid));
            let frame_hist = reported_chain(&chains, pid, &frametimes).and_then(|sc| {
                state.lock().ok().and_then(|m| m.get(&(pid, sc)).map(Tracker::hist_wire))
            });
            let report = FpsReport {
                foreground,
                frame_hist,
                pid,
                process_name,
                fps: if avg > 0.0 { 1000.0 / avg } else { 0.0 },
                avg_frametime_ms: avg,
                low1_fps: if p99 > 0.0 { 1000.0 / p99 } else { 0.0 },
                frames_last_sec: frames,
                recent_frametimes_ms,
                snapshot_unreadable_ticks: unreadable.total,
            };

            if let Ok(line) = serde_json::to_string(&report) {
                // The pipe to the (unelevated) app, which writes fps.json itself; stdout in console mode.
                sink.report(&line);
                sent = true;
            }
            eprintln!(
                "[compy-fps] {} (pid {}) | {:.1} FPS | {:.2} ms avg | 1% low {:.1} FPS | {} frames/s",
                report.process_name, report.pid, report.fps, report.avg_frametime_ms, report.low1_fps, frames
            );
        }
    }
}

#[cfg(test)]
mod presenter_selection_tests {
    use super::{select_game_presenter, PresenterCandidate, Tracker};
    use std::time::Instant;

    fn cand(pid: u32, name: &str, swapchain: u64, frames: usize) -> PresenterCandidate {
        PresenterCandidate {
            pid,
            name: name.to_string(),
            swapchain,
            recent: vec![6.2; frames],
            evidence: super::WindowEvidence::default(),
        }
    }

    // THE GUARD (tester Export, 2026-06-10): a PoE session was recorded as
    // "msedgewebview2.exe · 329 avg" — Compy's own webview out-presented the game and won the
    // dominant-presenter race. Compy must never measure itself, no matter the frame counts.
    #[test]
    fn compys_own_webview_never_wins_even_with_the_most_frames() {
        let picked = select_game_presenter(vec![
            cand(100, "PathOfExile.exe", 0xA, 161),
            cand(200, "msedgewebview2.exe", 0xB, 329),
            cand(300, "compy.exe", 0xC, 500),
        ])
        .expect("the game is picked");
        assert_eq!(picked.1, "PathOfExile.exe");
    }

    #[test]
    fn denylist_is_case_insensitive() {
        let picked = select_game_presenter(vec![
            cand(100, "game.exe", 0xA, 10),
            cand(200, "MsEdgeWebView2.EXE", 0xB, 400),
            cand(300, "DWM.exe", 0xC, 400),
        ])
        .expect("the game is picked");
        assert_eq!(picked.1, "game.exe");
    }

    #[test]
    fn only_denied_presenters_means_no_game_not_a_false_one() {
        // Compy idling with no game running: the webview + compositor present constantly —
        // the honest answer is "nothing is presenting", never our own UI dressed up as a game.
        assert!(select_game_presenter(vec![
            cand(200, "msedgewebview2.exe", 0xA, 400),
            cand(300, "dwm.exe", 0xB, 300),
            cand(400, "compy.exe", 0xC, 100),
        ])
        .is_none());
    }

    // THE GUARD (live catch, 2026-07-22 Marvel Rivals smoke session): dwm.exe's name failed to
    // resolve (OpenProcess denied even elevated), so the empty-named compositor bypassed the
    // name denylist and was reported as the game at 803 fps. Unnameable presenters never win.
    #[test]
    fn unnameable_presenter_never_wins_even_with_the_most_frames() {
        let picked = select_game_presenter(vec![
            cand(1816, "", 0xA, 803), // dwm whose name resolution failed
            cand(12264, "Marvel-Win64-Shipping.exe", 0xB, 240),
        ])
        .expect("the game is picked");
        assert_eq!(picked.1, "Marvel-Win64-Shipping.exe");
    }

    #[test]
    fn only_unnameable_presenters_means_no_game_not_a_nameless_one() {
        assert!(select_game_presenter(vec![cand(1816, "", 0xA, 803)]).is_none());
    }

    #[test]
    fn most_frames_wins_among_legitimate_presenters() {
        let picked = select_game_presenter(vec![
            cand(100, "game.exe", 0xA, 161),
            cand(200, "other-app.exe", 0xB, 30),
            cand(300, "tiny.exe", 0xC, 1), // <2 samples → not a candidate at all
        ])
        .expect("picked");
        assert_eq!(picked.1, "game.exe");
    }

    #[test]
    fn process_dominance_counts_all_its_chains_but_reports_the_dominant_one() {
        // The game presents main (161) + a small UI chain (30): its TOTAL (191) must beat a
        // 170-frame background app, and the REPORTED frametimes must be the main chain's alone.
        let picked = select_game_presenter(vec![
            cand(100, "game.exe", 0xA1, 161),
            cand(100, "game.exe", 0xB2, 30),
            cand(200, "background.exe", 0xC3, 170),
        ])
        .expect("picked");
        assert_eq!(picked.1, "game.exe");
        assert_eq!(picked.2.len(), 161, "the dominant chain's frames, not the merged set");
    }

    /// THE 323/161 SIGNATURE REGRESSION (tester, 2026-06-10). Two swapchains in one process
    /// present as interleaved pairs: main chain every ~6.21 ms (161 fps), a second chain ~0.05 ms
    /// behind each present. Keyed by PID ALONE the deltas go bimodal (~0.05/~6.16) — the average
    /// halves and live fps reads ~322 while p99 stays ~6.2 (low1 ~161): the exact mismatch the
    /// tester saw vs Steam. Keyed per (pid, swapchain) each chain reads its true ~161 cadence.
    #[test]
    fn interleaved_chains_poison_pid_keying_but_not_swapchain_keying() {
        let freq = 10_000_000.0; // QPC at 10 MHz
        let main_period = 62_100; // 6.21 ms in QPC ticks → 161.0 fps
        let lag = 500; // the second chain presents 0.05 ms behind the main one
        let now = Instant::now();

        // ── The OLD world: one tracker keyed by pid alone sees both chains interleaved.
        let mut pid_only = Tracker::new();
        // ── The FIX: each chain has its own tracker.
        let mut chain_a = Tracker::new();
        let mut chain_b = Tracker::new();

        for n in 1..=200i64 {
            let t_main = n * main_period;
            let t_ui = t_main + lag;
            pid_only.record(t_main, freq, now);
            pid_only.record(t_ui, freq, now);
            chain_a.record(t_main, freq, now);
            chain_b.record(t_ui, freq, now);
        }

        let fps_of = |deltas: &[f64]| 1000.0 / (deltas.iter().sum::<f64>() / deltas.len() as f64);
        let p99_low1_of = |deltas: &[f64]| {
            let mut sorted: Vec<f64> = deltas.to_vec();
            sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
            let idx = (((sorted.len() as f64) * 0.99).ceil() as usize).min(sorted.len()) - 1;
            1000.0 / sorted[idx]
        };

        let old_deltas: Vec<f64> = pid_only.samples.iter().map(|s| s.frametime_ms).collect();
        let old_fps = fps_of(&old_deltas);
        let old_low1 = p99_low1_of(&old_deltas);
        // The bug signature: live fps ~2× while the 1% low stays at the true cadence.
        assert!(old_fps > 300.0 && old_fps < 345.0, "old keying over-reads: {old_fps}");
        assert!(old_low1 > 155.0 && old_low1 < 168.0, "old low1 stays true: {old_low1}");

        let new_deltas: Vec<f64> = chain_a.samples.iter().map(|s| s.frametime_ms).collect();
        let new_fps = fps_of(&new_deltas);
        let new_low1 = p99_low1_of(&new_deltas);
        // The fix: the main chain reads its true ~161 cadence — fps and low1 agree.
        assert!(new_fps > 155.0 && new_fps < 168.0, "per-chain fps is honest: {new_fps}");
        assert!((new_fps - new_low1).abs() < 5.0, "steady cadence: fps ≈ low1");
        // And the second chain tracks its own (identical) cadence rather than poisoning the main.
        assert!(chain_b.samples.len() > 100);
    }
}

#[cfg(test)]
mod stale_session_stop_tests {
    use super::{stale_session_stop_command, SESSION_NAME};
    use crate::sys_exe::{sys_tool_path, system_dir, windows_dir, SysTool, ELEVATED_ENV_ALLOWLIST};
    use std::path::Path;

    /// Hardening slice 1b: the capture helper's `logman stop` runs the real logman.exe by absolute
    /// path, from System32, with exactly the old arguments, and sets only allowlisted variables
    /// (SystemRoot from the API). Shape only: that the rest is cleared is proven by
    /// sys_exe::tests::elevated_command_really_clears_the_inherited_environment (same builder).
    #[test]
    fn the_capture_helpers_logman_stop_runs_with_the_cleared_environment() {
        let c = stale_session_stop_command();
        assert_eq!(Path::new(c.get_program()), sys_tool_path(SysTool::Logman).as_path());
        let args: Vec<_> = c.get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert_eq!(args, ["stop", SESSION_NAME, "-ets"]);
        assert_eq!(SESSION_NAME, "Compy-FPS", "the session name is part of the capture contract");
        assert_eq!(c.get_current_dir(), Some(system_dir()));
        let allowed: Vec<String> = ELEVATED_ENV_ALLOWLIST.iter().map(|s| s.to_ascii_uppercase()).collect();
        let mut system_root = None;
        for (k, v) in c.get_envs() {
            let k = k.to_string_lossy().to_ascii_uppercase();
            assert!(allowed.contains(&k), "{k} must not reach the elevated logman");
            if k == "SYSTEMROOT" {
                system_root = v.map(|v| v.to_string_lossy().to_ascii_lowercase());
            }
        }
        assert_eq!(system_root, Some(windows_dir().to_string_lossy().to_ascii_lowercase()), "SystemRoot from the API");
    }
}

// Train #3 §1 (the orphan "ghost" helper after the app closes) used to be guarded here over the fps.alive
// heartbeat file. Since hardening slice 2 the pipe is the heartbeat: the app closing its end makes the
// helper's next write fail and the loop break. That shutdown is now proven over a real pipe in
// fps_pipe.rs `a_real_pipe_relays_lines_and_a_closed_server_breaks_the_writer`.

#[cfg(test)]
mod attachment_tests {
    //! THE GUARDS (tester Export, 2026-07-22): between matches the 0.9.0 report wandered to
    //! Discord / Radeon Software / VS Code / Claude. Attribution is now positive-evidence
    //! (window ownership + foreground + monitor coverage) with sticky attachment — ambiguous
    //! ticks emit NOTHING, and an attached game is never abandoned for a chattier presenter.

    use super::{advance_attachment, Attachment, PresenterCandidate, WindowEvidence, ATTACH_STREAK_TICKS};

    const GAME: WindowEvidence = WindowEvidence {
        owns_visible_toplevel: true,
        foreground: true,
        covers_monitor: true,
    };
    /// Electron-style presenter (Discord / VS Code / Claude / browsers): the GPU child
    /// process presents but owns no windows at all.
    const WINDOWLESS: WindowEvidence = WindowEvidence {
        owns_visible_toplevel: false,
        foreground: false,
        covers_monitor: false,
    };
    /// A maximized desktop app in focus: owns its window, is foreground, but stops at the
    /// work area (taskbar) — never full monitor bounds.
    const MAXIMIZED_FG: WindowEvidence = WindowEvidence {
        owns_visible_toplevel: true,
        foreground: true,
        covers_monitor: false,
    };

    fn cand(pid: u32, name: &str, frames: usize, evidence: WindowEvidence) -> PresenterCandidate {
        PresenterCandidate {
            pid,
            name: name.to_string(),
            swapchain: 0xA,
            recent: vec![6.2; frames],
            evidence,
        }
    }

    fn always_alive(_: u32, _: &str) -> bool {
        true
    }
    fn never_alive(_: u32, _: &str) -> bool {
        false
    }

    /// Run enough ticks with the same candidates to satisfy the acquisition streak.
    fn attach(candidates: impl Fn() -> Vec<PresenterCandidate>) -> (Attachment, Option<(u32, String, Vec<f64>)>) {
        let mut state = Attachment::new();
        let mut last = None;
        for _ in 0..ATTACH_STREAK_TICKS {
            let (next, report) = advance_attachment(state, candidates(), &always_alive);
            state = next;
            last = Some(report);
        }
        (state, last.expect("ran at least one tick"))
    }

    #[test]
    fn windowless_electron_presenter_never_attaches_even_dominant() {
        // Discord's GPU process out-presents everything and nothing else runs: no sample, ever.
        let mut state = Attachment::new();
        for _ in 0..10 {
            let (next, report) =
                advance_attachment(state, vec![cand(500, "Discord.exe", 400, WINDOWLESS)], &always_alive);
            assert!(report.is_none(), "a windowless presenter must never produce a sample");
            state = next;
        }
        assert!(matches!(state, Attachment::Unattached { .. }));
    }

    #[test]
    fn foreground_maximized_desktop_app_never_attaches() {
        // Radeon Software maximized and focused: presents plenty, but doesn't cover the monitor.
        let mut state = Attachment::new();
        for _ in 0..10 {
            let (next, report) = advance_attachment(
                state,
                vec![cand(600, "RadeonSoftware.exe", 300, MAXIMIZED_FG)],
                &always_alive,
            );
            assert!(report.is_none(), "a non-covering desktop app must never produce a sample");
            state = next;
        }
    }

    #[test]
    fn qualified_game_attaches_after_streak_not_first_tick() {
        let mut state = Attachment::new();
        let mk = || vec![cand(100, "game.exe", 161, GAME)];
        for tick in 1..=ATTACH_STREAK_TICKS {
            let (next, report) = advance_attachment(state, mk(), &always_alive);
            state = next;
            if tick < ATTACH_STREAK_TICKS {
                assert!(report.is_none(), "no sample before the streak completes (tick {tick})");
            } else {
                assert_eq!(report.expect("attach tick reports").1, "game.exe");
            }
        }
        assert!(matches!(state, Attachment::Attached { .. }));
    }

    #[test]
    fn attached_game_gone_silent_yields_no_sample_and_no_wander() {
        // THE 0.9.0 defect scenario: the game sits in a between-matches screen (stops
        // presenting) while Discord dominates the present stream. 0.9.0 reported Discord;
        // now: nothing is emitted and the attachment holds.
        let (mut state, _) = attach(|| vec![cand(100, "game.exe", 161, GAME)]);
        for _ in 0..20 {
            let (next, report) = advance_attachment(
                state,
                vec![
                    cand(500, "Discord.exe", 400, WINDOWLESS),
                    // Even a FULLY qualified other candidate must not steal the attachment:
                    cand(700, "SomeOtherGame.exe", 300, GAME),
                ],
                &always_alive,
            );
            assert!(report.is_none(), "attached-but-silent must emit nothing");
            assert!(
                matches!(next, Attachment::Attached { pid: 100, .. }),
                "attachment must not wander while the game lives"
            );
            state = next;
        }
    }

    #[test]
    fn attached_game_reported_even_when_out_presented_and_backgrounded() {
        // Alt-tab safe: once attached, the game is reported without re-checking foreground,
        // and a chattier presenter can't displace it.
        let (state, _) = attach(|| vec![cand(100, "game.exe", 161, GAME)]);
        let backgrounded = WindowEvidence { foreground: false, ..GAME };
        let (next, report) = advance_attachment(
            state,
            vec![
                cand(100, "game.exe", 90, backgrounded),
                cand(500, "Discord.exe", 400, WINDOWLESS),
            ],
            &always_alive,
        );
        let (pid, name, _) = report.expect("attached game still reports");
        assert_eq!((pid, name.as_str()), (100, "game.exe"));
        assert!(matches!(next, Attachment::Attached { pid: 100, .. }));
    }

    #[test]
    fn game_death_releases_and_next_game_needs_full_requalification() {
        let (state, _) = attach(|| vec![cand(100, "game.exe", 161, GAME)]);
        // Game process dies: silent tick + alive=false → released. (Recycling is NOT covered by
        // this case — a recycled pid that PRESENTS never reaches the silent path at all; see
        // `a_recycled_pid_that_presents_never_reports_the_old_game`.)
        let (state, report) = advance_attachment(state, vec![], &never_alive);
        assert!(report.is_none());
        assert!(matches!(state, Attachment::Unattached { .. }), "death must release");
        // The next game must earn attachment through the full evidence+streak gate again.
        let (state, report) = advance_attachment(state, vec![cand(700, "NextGame.exe", 200, GAME)], &always_alive);
        assert!(report.is_none(), "one qualified tick must not re-attach instantly");
        assert!(matches!(state, Attachment::Unattached { streak: 1, .. }));
    }

    #[test]
    fn streak_resets_when_the_qualified_winner_changes() {
        let mut state = Attachment::new();
        let (next, _) = advance_attachment(state, vec![cand(100, "a.exe", 100, GAME)], &always_alive);
        state = next;
        let (next, _) = advance_attachment(state, vec![cand(200, "b.exe", 100, GAME)], &always_alive);
        state = next;
        let (state, report) = advance_attachment(state, vec![cand(100, "a.exe", 100, GAME)], &always_alive);
        assert!(report.is_none(), "a flapping winner must never reach the streak");
        assert!(matches!(state, Attachment::Unattached { streak: 1, .. }));
    }

    // ── pid recycling ────────────────────────────────────────────────────────────────────────
    //
    // Windows reuses pids aggressively. The attached branch filtered candidates by `c.pid == pid`
    // and reported the STORED name, and it consulted `alive` only when the tick was silent. So a
    // recycled pid that PRESENTS — a new process that happens to inherit the number and render —
    // never reached the identity check at all, and its real frames were published under the dead
    // game's name into sessions.json, comparisons, the scoreboard and exports.
    //
    // Both halves are guarded: the name the ETW tick resolves must still be the game's, and the
    // process must still be alive under that image.

    #[test]
    fn a_recycled_pid_that_presents_never_reports_the_old_game() {
        let (state, _) = attach(|| vec![cand(100, "game.exe", 161, GAME)]);
        // Same pid, still presenting, but the process behind it is no longer the game.
        let (state, report) =
            advance_attachment(state, vec![cand(100, "game.exe", 161, GAME)], &never_alive);
        assert!(report.is_none(), "a recycled pid must not emit a sample under the old game's name");
        assert!(matches!(state, Attachment::Unattached { .. }), "lost identity must release");
    }

    #[test]
    fn a_recycled_pid_wearing_a_new_image_name_is_not_the_game() {
        let (state, _) = attach(|| vec![cand(100, "game.exe", 161, GAME)]);
        // ETW resolves the name per tick, so the recycled pid arrives as what it now IS. Even with
        // `alive` answering true (the pid is genuinely running — just not our game), the sample
        // must not be attributed to the game we attached to.
        let (state, report) =
            advance_attachment(state, vec![cand(100, "notepad.exe", 161, GAME)], &always_alive);
        assert!(report.is_none(), "frames from another image must never wear the game's name");
        assert!(matches!(state, Attachment::Unattached { .. }));
    }

    #[test]
    fn the_replacement_process_must_earn_attachment_from_scratch() {
        let (state, _) = attach(|| vec![cand(100, "game.exe", 161, GAME)]);
        let (state, _) =
            advance_attachment(state, vec![cand(100, "notepad.exe", 161, GAME)], &always_alive);
        // One qualified tick is not attachment — the replacement goes through the full streak gate.
        let (state, report) =
            advance_attachment(state, vec![cand(100, "notepad.exe", 161, GAME)], &always_alive);
        assert!(report.is_none(), "no instant re-attach onto the recycled pid");
        assert!(matches!(state, Attachment::Unattached { streak: 1, .. }));
    }

    #[test]
    fn a_live_game_still_reports_every_frame_tick() {
        // The identity re-check must not cost the ordinary case: same pid, same name, alive.
        let (state, _) = attach(|| vec![cand(100, "game.exe", 161, GAME)]);
        let (state, report) =
            advance_attachment(state, vec![cand(100, "game.exe", 161, GAME)], &always_alive);
        let (pid, name, frames) = report.expect("a live attached game keeps reporting");
        assert_eq!((pid, name.as_str()), (100, "game.exe"));
        assert_eq!(frames.len(), 161);
        assert!(matches!(state, Attachment::Attached { pid: 100, .. }));
    }

    #[test]
    fn denylist_and_nameless_guards_still_hold_at_acquisition() {
        // Window evidence is an ADDITIONAL gate, not a replacement: a denylisted or nameless
        // presenter with perfect window evidence still never attaches (f96347d preserved).
        let mut state = Attachment::new();
        for _ in 0..10 {
            let (next, report) = advance_attachment(
                state,
                vec![cand(300, "msedgewebview2.exe", 400, GAME), cand(400, "", 500, GAME)],
                &always_alive,
            );
            assert!(report.is_none());
            state = next;
        }
        assert!(matches!(state, Attachment::Unattached { .. }));
    }
}

#[cfg(test)]
mod foreground_report_tests {
    //! P4-comparable: the report says "not in front" only on real evidence, so an
    //! alt-tabbed stretch can be left out of a measurement without guessing.
    use super::{report_foreground, WindowEvidence};

    const IN_FRONT: WindowEvidence = WindowEvidence {
        owns_visible_toplevel: true,
        foreground: true,
        covers_monitor: true,
    };
    const BEHIND: WindowEvidence = WindowEvidence { foreground: false, ..IN_FRONT };

    #[test]
    fn known_foreground_is_reported_both_ways() {
        assert_eq!(report_foreground(true, Some(&IN_FRONT)), Some(true));
        assert_eq!(report_foreground(true, Some(&BEHIND)), Some(false));
    }

    #[test]
    fn unresolvable_foreground_stays_unknown_never_false() {
        assert_eq!(report_foreground(false, Some(&BEHIND)), None);
        assert_eq!(report_foreground(false, Some(&IN_FRONT)), None);
    }

    #[test]
    fn another_process_in_front_is_behind() {
        // Alt+Z, Game Bar or a clicked Discord window own the foreground: the game reads behind.
        let ev = WindowEvidence { foreground: false, ..IN_FRONT };
        assert_eq!(report_foreground(true, Some(&ev)), Some(false));
    }

    #[test]
    fn missing_evidence_stays_unknown() {
        assert_eq!(report_foreground(true, None), None);
    }

    #[test]
    fn a_presenter_without_its_own_window_is_never_called_behind() {
        // UWP / launcher-owned window: the presenting pid owns no visible top-level,
        // so "not foreground" is not evidence of alt-tab (review MUST-FIX).
        let windowless = WindowEvidence {
            owns_visible_toplevel: false,
            foreground: false,
            covers_monitor: false,
        };
        assert_eq!(report_foreground(true, Some(&windowless)), None);
    }
}

#[cfg(test)]
mod frame_hist_tests {
    //! P4-smooth-measure: the helper counts every frame once, and a percentile read off the buckets
    //! is the real per-frame percentile to within half a bucket.
    use super::{frame_hist, reported_chain, Tracker};
    use std::time::Instant;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() / b < 0.006
    }

    #[test]
    fn every_bucket_holds_its_own_frame_times() {
        for ms in [0.3, 1.0, 4.17, 6.94, 16.67, 33.3, 250.0, 999.0] {
            assert!(close(frame_hist::bucket_ms(frame_hist::bucket(ms)), ms), "{ms} ms");
        }
        assert_eq!(frame_hist::bucket(0.0), 0);
        assert_eq!(frame_hist::bucket(f64::NAN), 0);
        assert_eq!(frame_hist::bucket(5000.0), frame_hist::OVERFLOW);
        assert_eq!(frame_hist::bucket(f64::INFINITY), frame_hist::OVERFLOW);
        assert!(frame_hist::LO_MS * frame_hist::RATIO.powi(frame_hist::OVERFLOW as i32) > 1000.0);
        assert!(frame_hist::bucket(999.9) < frame_hist::OVERFLOW);
        assert!(frame_hist::bucket_ms(frame_hist::OVERFLOW - 1) <= 1000.0);
    }

    /// Freezes count: a 3 s hang is a frame the session saw, read back capped at 1000 ms.
    #[test]
    fn a_freeze_over_a_second_is_counted_and_capped_at_one_second() {
        let freq = 10_000_000.0;
        let mut t = Tracker::new();
        let now = Instant::now();
        let mut qpc = 1i64;
        t.record(qpc, freq, now);
        for n in 0..999 {
            qpc += if n == 500 { 30_000_000 } else { 41_700 }; // one 3 s freeze
            t.record(qpc, freq, now);
        }
        assert_eq!(t.hist[frame_hist::OVERFLOW], 1, "the freeze is in the histogram");
        assert_eq!(t.samples.len(), 998, "the live figures still leave it out");
        assert_eq!(t.hist.iter().sum::<u64>(), 999);
        assert_eq!(frame_hist::percentile(&t.hist, 1.0), Some(frame_hist::OVERFLOW_MS));
        assert!(close(frame_hist::percentile(&t.hist, 0.99).unwrap(), 4.17));
        // The slowest of 999 frames is their 99.9th percentile: the freeze, read as 1000 ms.
        assert_eq!(frame_hist::percentile(&t.hist, 0.999), Some(frame_hist::OVERFLOW_MS));
    }

    #[test]
    fn percentiles_are_per_frame_not_per_second() {
        // 9850 frames at 4 ms, 130 at 10 ms, 20 hitches at 50 ms.
        let mut counts = vec![0u64; frame_hist::BUCKETS];
        counts[frame_hist::bucket(4.0)] = 9850;
        counts[frame_hist::bucket(10.0)] = 130;
        counts[frame_hist::bucket(50.0)] = 20;
        assert!(close(frame_hist::percentile(&counts, 0.50).unwrap(), 4.0));
        assert!(close(frame_hist::percentile(&counts, 0.99).unwrap(), 10.0));
        assert!(close(frame_hist::percentile(&counts, 0.999).unwrap(), 50.0));
        assert_eq!(frame_hist::percentile(&vec![0; frame_hist::BUCKETS], 0.5), None);
    }

    #[test]
    fn the_helper_counts_each_frame_once_and_ships_only_used_buckets() {
        let freq = 10_000_000.0;
        let mut t = Tracker::new();
        let now = Instant::now();
        let mut qpc = 0i64;
        for n in 0..=500i64 {
            qpc += if n % 100 == 99 { 200_000 } else { 41_700 }; // 4.17 ms, every 100th 20 ms
            t.record(qpc, freq, now);
        }
        let wire = t.hist_wire();
        assert_eq!(wire.id, t.hist_id);
        assert_eq!(wire.counts.iter().map(|(_, c)| c).sum::<u64>(), 500, "first present has no interval");
        assert_eq!(wire.counts.len(), 2);
        assert_ne!(Tracker::new().hist_id, t.hist_id, "a new tracker restarts under a new id");
    }

    #[test]
    fn the_report_reads_the_histogram_of_the_chain_it_reported() {
        let chains = vec![(7, 0xA, vec![4.0, 4.1]), (7, 0xB, vec![1.0, 1.1, 1.2]), (8, 0xA, vec![4.0, 4.1])];
        assert_eq!(reported_chain(&chains, 7, &[4.0, 4.1]), Some(0xA));
        assert_eq!(reported_chain(&chains, 7, &[1.0, 1.1, 1.2]), Some(0xB));
        assert_eq!(reported_chain(&chains, 9, &[4.0, 4.1]), None);
    }
}

#[cfg(test)]
mod handle_free_identity_tests {
    //! The attached game's identity comes from snapshot rows (pid + image name + creation time), with no
    //! process opened. These drive `identity_step` (the function the capture loop calls) over synthetic rows.
    use super::{
        identity_step, mode_allowed, note_unreadable_tick, parse_capture_args, select_game_presenter, track_created, Attachment,
        CaptureMode, FpsReport, IdentityStep, PresenterCandidate, Sink, UnreadableTicks, WindowEvidence,
        ATTACH_STREAK_TICKS,
    };
    use crate::other_load::ProcRow;

    fn proc_row(pid: u32, name: &str, create: i64, threads: u32) -> ProcRow {
        ProcRow {
            pid,
            parent: 1,
            name: Some(name.into()),
            threads,
            session_id: 1,
            working_set: 0,
            create_time: create,
            cpu_100ns: 0,
        }
    }

    fn attached() -> Attachment {
        Attachment::Attached { pid: 10, name: "Game.exe".into() }
    }

    fn cand(pid: u32, frames: usize, ev: WindowEvidence) -> PresenterCandidate {
        PresenterCandidate { pid, name: String::new(), swapchain: 1, recent: vec![6.0; frames], evidence: ev }
    }

    const GAME_WINDOW: WindowEvidence =
        WindowEvidence { owns_visible_toplevel: true, foreground: true, covers_monitor: true };
    const NO_WINDOW: WindowEvidence =
        WindowEvidence { owns_visible_toplevel: false, foreground: false, covers_monitor: false };

    /// One silent tick (no frames) of an attached game, through the real step.
    fn silent_tick(rows: &[ProcRow], created: Option<(u32, i64)>) -> IdentityStep {
        identity_step(attached(), created, vec![], Some(rows))
    }

    fn is_attached(s: &IdentityStep) -> bool {
        matches!(s.attachment, Attachment::Attached { pid: 10, .. })
    }

    #[test]
    fn the_creation_time_is_remembered_while_attached_and_cleared_when_not() {
        let rows = vec![proc_row(10, "Game.exe", 500, 9)];
        assert_eq!(track_created(None, &attached(), &rows), Some((10, 500)));
        // Kept: a later snapshot with a different time (a recycled pid) must not overwrite it.
        let later = vec![proc_row(10, "Game.exe", 777, 9)];
        assert_eq!(track_created(Some((10, 500)), &attached(), &later), Some((10, 500)));
        // A different pid attaching re-reads; unattached clears.
        let other = Attachment::Attached { pid: 11, name: "B.exe".into() };
        let two = vec![proc_row(11, "B.exe", 900, 1)];
        assert_eq!(track_created(Some((10, 500)), &other, &two), Some((11, 900)));
        assert_eq!(track_created(Some((10, 500)), &Attachment::new(), &two), None);
        // Attached but absent from the snapshot: nothing to remember yet.
        assert_eq!(track_created(None, &attached(), &[]), None);
    }

    #[test]
    fn a_silent_attached_game_stays_attached_while_the_same_process_lives() {
        let rows = vec![proc_row(10, "Game.exe", 500, 9)];
        assert!(is_attached(&silent_tick(&rows, Some((10, 500)))));
    }

    #[test]
    fn exit_recycle_and_another_image_each_release_the_attachment() {
        let created = Some((10, 500));
        assert!(!is_attached(&silent_tick(&[], created)), "gone from the snapshot");
        assert!(!is_attached(&silent_tick(&[proc_row(10, "Game.exe", 500, 0)], created)), "listed, no threads");
        assert!(!is_attached(&silent_tick(&[proc_row(10, "cmd.exe", 500, 3)], created)), "another image");
        assert!(!is_attached(&silent_tick(&[proc_row(10, "Game.exe", 777, 3)], created)), "same exe, new lifetime");
        let released = silent_tick(&[proc_row(10, "Game.exe", 777, 3)], created);
        assert_eq!(released.created, None, "the remembered start is cleared with the attachment");
    }

    #[test]
    fn a_recycled_pid_that_is_presenting_is_not_measured_under_the_old_lifetime() {
        let rows = vec![proc_row(10, "Game.exe", 777, 3)];
        let step = identity_step(attached(), Some((10, 500)), vec![cand(10, 3, GAME_WINDOW)], Some(&rows));
        assert!(step.best.is_none() && !is_attached(&step) && !step.skipped);
    }

    #[test]
    fn an_unreadable_snapshot_decides_nothing_and_changes_nothing() {
        let step = identity_step(attached(), Some((10, 500)), vec![cand(10, 3, GAME_WINDOW)], None);
        assert!(step.skipped, "the tick is marked skipped, distinct from a tick with no frames");
        assert!(is_attached(&step), "a live attachment is not released by a failed read");
        assert_eq!(step.created, Some((10, 500)), "the remembered start is kept");
        assert!(step.best.is_none(), "nothing is reported");
        // An unattached state stays unattached and keeps its streak.
        let un = Attachment::Unattached { last_pid: Some(7), streak: 2 };
        let step = identity_step(un, None, vec![cand(7, 3, GAME_WINDOW)], None);
        assert!(step.skipped && matches!(step.attachment, Attachment::Unattached { last_pid: Some(7), streak: 2 }));
        // An empty (but readable) snapshot is NOT a skip: the attached game is simply gone.
        let step = identity_step(attached(), Some((10, 500)), vec![], Some(&[]));
        assert!(!step.skipped && !is_attached(&step));
    }

    #[test]
    fn acquire_then_recycle_end_to_end_through_the_step() {
        let rows = vec![proc_row(10, "Game.exe", 500, 9), proc_row(4, "System", 1, 100)];
        let (mut att, mut created) = (Attachment::new(), None);
        let mut reported = 0;
        for _ in 0..ATTACH_STREAK_TICKS {
            let s = identity_step(att, created, vec![cand(10, 3, GAME_WINDOW)], Some(&rows));
            reported += usize::from(s.best.is_some());
            (att, created) = (s.attachment, s.created);
        }
        assert!(matches!(att, Attachment::Attached { pid: 10, .. }) && reported == 1, "attached on the streak tick");
        assert_eq!(created, Some((10, 500)), "the start is recorded on the attach tick, from the same rows");
        // Presenting under the same lifetime keeps reporting.
        let s = identity_step(att, created, vec![cand(10, 3, GAME_WINDOW)], Some(&rows));
        assert!(s.best.is_some());
        // The pid is recycled by the same exe: released, nothing reported, no start remembered.
        let recycled = vec![proc_row(10, "Game.exe", 900, 9)];
        let s = identity_step(s.attachment, s.created, vec![cand(10, 3, GAME_WINDOW)], Some(&recycled));
        assert!(s.best.is_none() && s.created.is_none() && !is_attached(&s));
    }

    #[test]
    fn an_attachment_without_a_remembered_start_falls_back_to_the_name() {
        let rows = vec![proc_row(10, "Game.exe", 777, 9)];
        assert!(is_attached(&silent_tick(&rows, None)), "name-only identity, the old behaviour");
        assert!(!is_attached(&silent_tick(&[proc_row(10, "other.exe", 777, 9)], None)));
    }

    #[test]
    fn unreadable_ticks_are_counted_and_reported_first_then_every_120th() {
        let mut u = UnreadableTicks::default();
        let mut said = Vec::new();
        for _ in 1..=361 {
            if u.note() {
                said.push(u.total);
            }
        }
        assert_eq!(said, vec![1, 120, 240, 360]);
        assert_eq!(u.total, 361);
    }

    #[test]
    fn the_report_carries_the_unreadable_count_only_when_there_is_one() {
        let rep = |n| FpsReport {
            pid: 1,
            process_name: "g.exe".into(),
            fps: 60.0,
            avg_frametime_ms: 16.6,
            low1_fps: 50.0,
            frames_last_sec: 60,
            recent_frametimes_ms: vec![16.6],
            foreground: None,
            frame_hist: None,
            snapshot_unreadable_ticks: n,
        };
        assert!(!serde_json::to_string(&rep(0)).unwrap().contains("snapshot_unreadable_ticks"));
        assert!(serde_json::to_string(&rep(3)).unwrap().contains("\"snapshot_unreadable_ticks\":3"));
    }

    /// M6-unread: the marker line is sent on EVERY unreadable tick (the app rewrites its marker file
    /// from it, and reads that file's age), while the printed message stays rate-limited to the first
    /// and every 120th. Since hardening slice 2 the helper sends a line instead of writing the file.
    #[test]
    fn every_unreadable_tick_sends_the_marker_but_the_message_is_rate_limited() {
        #[derive(Clone, Default)]
        struct Collect(std::sync::Arc<std::sync::Mutex<Vec<u8>>>);
        impl std::io::Write for Collect {
            fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(b);
                Ok(b.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let seen = Collect::default();
        let sink = Sink::Pipe(crate::fps_pipe::PipeWriter::start(seen.clone()));
        let lines = || String::from_utf8(seen.0.lock().unwrap().clone()).unwrap().lines().map(str::to_owned).collect::<Vec<_>>();
        // One tick at a time (the real cadence is 500 ms): wait for each line to be written.
        let mut ticks = UnreadableTicks::default();
        let mut said = Vec::new();
        for n in 1..=121usize {
            said.push(note_unreadable_tick(&mut ticks, &sink));
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while lines().len() < n && std::time::Instant::now() < deadline {
                std::thread::yield_now();
            }
        }
        assert_eq!(&said[..3], &[true, false, false]);
        assert!(said[119], "tick 120 is a message tick");
        assert!(!said[120], "tick 121 is not a message tick");
        let got = lines();
        assert_eq!(got.len(), 121, "one marker line per unreadable tick");
        assert_eq!(got[2], r#"{"unreadable_ticks":3}"#, "the line carries the running count");
        assert_eq!(crate::fps_pipe::classify_line(&got[120]), crate::fps_pipe::Line::Unreadable(121));
        // Console mode sends no marker (and writes no file): only the count moves.
        assert!(!note_unreadable_tick(&mut ticks, &Sink::Console));
        assert_eq!(ticks.total, 122);
    }

    /// Hardening slice 2: the helper takes no path. The old file flags are refused, `--pipe` needs a
    /// valid Compy pipe name and `--parent-pid` a process id.
    #[test]
    fn capture_args_refuse_paths_and_need_a_valid_pipe_and_parent() {
        let a = |s: &[&str]| s.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        let pipe = crate::fps_pipe::pipe_name_from([1; 16]);
        assert_eq!(parse_capture_args(&a(&["compy.exe", "--fps-capture"])), Ok(CaptureMode::Console));
        assert_eq!(
            parse_capture_args(&a(&["compy.exe", "--fps-capture", "--pipe", &pipe, "--parent-pid", "42"])),
            Ok(CaptureMode::Pipe { name: pipe.clone(), parent_pid: 42 })
        );
        for bad in [
            a(&["compy.exe", "--fps-capture", "--fps-out", r"C:\x\fps.json"]),
            a(&["compy.exe", "--fps-capture", "--fps-alive", r"C:\x\fps.alive"]),
            a(&["compy.exe", "--fps-capture", "--pipe", &pipe, "--parent-pid", "42", "--fps-out", r"C:\x"]),
            a(&["compy.exe", "--fps-capture", "--pipe", &pipe]),
            a(&["compy.exe", "--fps-capture", "--parent-pid", "42"]),
            a(&["compy.exe", "--fps-capture", "--pipe", &pipe, "--parent-pid"]),
            a(&["compy.exe", "--fps-capture", "--pipe", &pipe, "--parent-pid", "-1"]),
            a(&["compy.exe", "--fps-capture", "--pipe", r"C:\x\fps.json", "--parent-pid", "42"]),
            a(&["compy.exe", "--fps-capture", "--pipe", r"\\.\pipe\other", "--parent-pid", "42"]),
        ] {
            assert!(parse_capture_args(&bad).is_err(), "{bad:?}");
        }
    }

    /// Review r1: console mode (an elevated capture nobody can stop) only in a debug build; the pipe mode
    /// in both. The two refusal exit codes are distinct and are the ones the app reads.
    #[test]
    fn console_mode_is_refused_in_a_release_build() {
        let pipe = CaptureMode::Pipe { name: crate::fps_pipe::pipe_name_from([2; 16]), parent_pid: 9 };
        assert_eq!(mode_allowed(CaptureMode::Console, true), Ok(CaptureMode::Console));
        assert!(mode_allowed(CaptureMode::Console, false).is_err());
        assert!(mode_allowed(pipe, false).is_ok());
        assert_ne!(super::EXIT_REFUSED_ARGS, super::EXIT_PIPE_NOT_CONFIRMED);
        assert_eq!((super::EXIT_REFUSED_ARGS, super::EXIT_PIPE_NOT_CONFIRMED), (2, 4));
        let src = include_str!("fps.rs");
        let f = src.find(concat!("pub fn run_", "capture()")).unwrap();
        let head = &src[f..f + src[f..].find(concat!("let freq = ", "perf_frequency()")).unwrap()];
        assert!(head.contains(concat!("mode_allowed(m, cfg!(", "debug_assertions))")), "run_capture applies the release refusal");
    }

    /// Source guard: the helper's production code opens, writes, renames, removes and stats no file.
    /// (The report and marker files are written by the app, monitoring.rs, as the user.)
    #[test]
    fn the_capture_helper_touches_no_file() {
        let src = include_str!("fps.rs");
        let prod = &src[..src.find("#[cfg(test)]").expect("tests")];
        assert!(prod.contains("pub fn run_capture()"), "the cut keeps the helper's production code");
        for banned in ["fs::write", "fs::rename", "remove_file", "OpenOptions", "fs::metadata", "fs::File", "write_atomic", "heartbeat_stale"] {
            assert!(!prod.contains(banned), "fps.rs production code must not use {banned}");
        }
    }

    /// Names the snapshot now supplies that the old open often refused. Each well-known non-game presenter
    /// is rejected by the name denylist, or (windowless GPU children, services) by the window evidence.
    #[test]
    fn well_known_non_game_presenters_named_by_the_snapshot_never_attach() {
        // Denylisted names are rejected even if they somehow had a fullscreen foreground window.
        for name in ["dwm.exe", "explorer.exe", "msedgewebview2.exe", "compy.exe", "SearchHost.exe", "TextInputHost.exe"] {
            let named = PresenterCandidate { name: name.into(), ..cand(5, 200, GAME_WINDOW) };
            assert!(select_game_presenter(vec![named]).is_none(), "{name} is denylisted");
        }
        // Everything else below presents from a process that owns no visible top-level window (an Electron
        // or browser GPU child, a launcher service, an anti-cheat service): the window evidence rejects
        // it through the real state machine for many ticks, whatever its name.
        for name in [
            "Discord.exe", "chrome.exe", "msedge.exe", "firefox.exe", "Code.exe", "Claude.exe", "steamwebhelper.exe",
            "EasyAntiCheat.exe", "EasyAntiCheat_EOS.exe", "BEService.exe", "vgc.exe", "Battle.net.exe", "EpicGamesLauncher.exe",
        ] {
            let rows = vec![proc_row(5, name, 100, 20)];
            let (mut att, mut created) = (Attachment::new(), None);
            for _ in 0..(ATTACH_STREAK_TICKS * 3) {
                let s = identity_step(att, created, vec![cand(5, 200, NO_WINDOW)], Some(&rows));
                assert!(s.best.is_none(), "{name} must not be reported");
                (att, created) = (s.attachment, s.created);
            }
            assert!(matches!(att, Attachment::Unattached { .. }), "{name} must not attach");
        }
        // The same names DO name the game itself, as intended: an unrelated game exe attaches on the streak.
        let rows = vec![proc_row(5, "Game.exe", 100, 20)];
        let (mut att, mut created) = (Attachment::new(), None);
        for _ in 0..ATTACH_STREAK_TICKS {
            let s = identity_step(att, created, vec![cand(5, 200, GAME_WINDOW)], Some(&rows));
            (att, created) = (s.attachment, s.created);
        }
        assert!(matches!(att, Attachment::Attached { pid: 5, .. }));
    }
}
