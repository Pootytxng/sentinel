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
//! Output: one JSON line per ~500 ms to stdout describing the dominant
//! presenting process (the game), plus a human-readable line to stderr for
//! console testing. The main app will consume the JSON in a follow-up step.
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
use serde::Serialize;

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

/// One (process, swapchain) presenter candidate in the current stats window.
pub(crate) struct PresenterCandidate {
    pub pid: u32,
    pub name: String,
    pub swapchain: u64,
    pub recent: Vec<f64>,
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
        // A presenter we couldn't even NAME can never be "the game": resolve_process_name
        // returns "" when OpenProcess fails — which is exactly the protected/system-process
        // case (live catch 2026-07-22: dwm.exe's name failed to resolve on the dev box, so
        // "" slid past the name denylist below and the compositor won at a fabricated
        // 803 fps). Games are user-session processes the elevated helper can always open;
        // an unnameable presenter is a system process, and a session can't honestly
        // attribute to a nameless one anyway.
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

// How far back the per-second stats window looks, and how often we report.
const REPORT_INTERVAL_MS: u64 = 500;
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
}

impl Tracker {
    fn new() -> Self {
        Tracker {
            last_qpc: 0,
            samples: Vec::new(),
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
}

/// CLI options parsed from the args after `--fps-capture`.
struct CaptureOpts {
    /// Where to write the latest report JSON (atomic). None → stdout only.
    out_path: Option<String>,
    /// Heartbeat file the parent refreshes while monitoring is active. When
    /// it goes stale (or missing) the helper self-exits. None → run until
    /// killed (console-test mode).
    alive_path: Option<String>,
}

fn parse_opts() -> CaptureOpts {
    let args: Vec<String> = std::env::args().collect();
    let find = |flag: &str| -> Option<String> {
        args.iter()
            .position(|a| a == flag)
            .and_then(|i| args.get(i + 1))
            .cloned()
    };
    CaptureOpts {
        out_path: find("--fps-out"),
        alive_path: find("--fps-alive"),
    }
}

/// Resolve a PID to its executable file name. The helper is elevated, so
/// OpenProcess with QUERY_LIMITED_INFORMATION succeeds for game processes.
fn resolve_process_name(pid: u32) -> String {
    use windows::core::PWSTR;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
        PROCESS_QUERY_LIMITED_INFORMATION,
    };
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };
        let mut buf = [0u16; 260];
        let mut size = buf.len() as u32;
        let res = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        if res.is_err() {
            return String::new();
        }
        let full = String::from_utf16_lossy(&buf[..size as usize]);
        full.rsplit(['\\', '/']).next().unwrap_or(&full).to_string()
    }
}

fn write_atomic(path: &str, contents: &str) {
    let tmp = format!("{path}.tmp");
    if std::fs::write(&tmp, contents).is_ok() {
        let _ = std::fs::rename(&tmp, path);
    }
}

/// True if the heartbeat file is missing or older than ~4 s — the signal that
/// the parent stopped monitoring (or died), so the helper should exit.
fn heartbeat_stale(path: &str) -> bool {
    match std::fs::metadata(path).and_then(|m| m.modified()) {
        Ok(mtime) => mtime
            .elapsed()
            .map(|e| e > Duration::from_secs(4))
            .unwrap_or(true),
        Err(_) => true,
    }
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

pub fn run_capture() {
    let opts = parse_opts();
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
    let _ = crate::actions::quiet_command("logman")
        .args(["stop", SESSION_NAME, "-ets"])
        .output();

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

    let stdout = std::io::stdout();
    loop {
        std::thread::sleep(Duration::from_millis(REPORT_INTERVAL_MS));
        let now = Instant::now();

        // Self-exit when the parent stops refreshing the heartbeat (monitoring
        // turned off, or the app closed). A non-elevated parent can't kill us,
        // so this is how we shut the elevated helper down cleanly.
        if let Some(alive) = &opts.alive_path {
            if heartbeat_stale(alive) {
                eprintln!("[compy-fps] heartbeat stale — exiting.");
                break;
            }
        }

        let Ok(mut map) = state.lock() else {
            continue;
        };

        // Prune old samples and processes that stopped presenting.
        map.retain(|_, tr| {
            tr.samples
                .retain(|s| now.duration_since(s.at) <= STALE_AFTER);
            !tr.samples.is_empty()
        });

        // The "game" is the dominant allowed process, then ITS dominant swapchain — the pick is
        // the pure, guard-tested select_game_presenter (Compy's own UI / compositor / shell can
        // never win; per-chain frametimes keep a second in-process chain from poisoning the
        // average). Names resolve once per pid here.
        let mut names: HashMap<u32, String> = HashMap::new();
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
            let name = names
                .entry(*pid)
                .or_insert_with(|| resolve_process_name(*pid))
                .clone();
            candidates.push(PresenterCandidate {
                pid: *pid,
                name,
                swapchain: *swapchain,
                recent,
            });
        }
        let best = select_game_presenter(candidates);

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

            let report = FpsReport {
                pid,
                process_name,
                fps: if avg > 0.0 { 1000.0 / avg } else { 0.0 },
                avg_frametime_ms: avg,
                low1_fps: if p99 > 0.0 { 1000.0 / p99 } else { 0.0 },
                frames_last_sec: frames,
                recent_frametimes_ms,
            };

            if let Ok(line) = serde_json::to_string(&report) {
                // File channel for the (unelevated) main app to read across
                // the elevation boundary.
                if let Some(out) = &opts.out_path {
                    write_atomic(out, &line);
                }
                // stdout for console testing.
                let mut handle = stdout.lock();
                let _ = writeln!(handle, "{line}");
                let _ = handle.flush();
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
mod heartbeat_tests {
    use super::*;

    // Train #3 §1 regression — the elevated helper's shutdown channel. A clean app exit drops the
    // fps.alive heartbeat (monitoring::shutdown_for_exit); the helper must read a MISSING file as
    // stale and break its loop. That is how the orphan ("ghost") is prevented when the parent dies.
    #[test]
    fn missing_heartbeat_is_stale() {
        let p = std::env::temp_dir().join("compy-test-no-such-heartbeat.alive");
        let _ = std::fs::remove_file(&p); // ensure absent
        let path = p.to_string_lossy().to_string();
        assert!(
            heartbeat_stale(&path),
            "a missing heartbeat file must read as stale so the helper self-exits on app close"
        );
    }

    // The inverse: a just-written heartbeat is NOT stale — the helper keeps running while the parent
    // is alive and refreshing it (no premature self-exit during a real session).
    #[test]
    fn fresh_heartbeat_is_not_stale() {
        let p = std::env::temp_dir().join("compy-test-fresh-heartbeat.alive");
        std::fs::write(&p, b"alive").expect("write temp heartbeat");
        let path = p.to_string_lossy().to_string();
        assert!(!heartbeat_stale(&path), "a just-written heartbeat must not be stale");
        let _ = std::fs::remove_file(&p);
    }
}
