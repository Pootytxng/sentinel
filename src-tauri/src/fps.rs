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
    "applicationframehost.exe",
    "searchhost.exe",
    "startmenuexperiencehost.exe",
    "textinputhost.exe",
];

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
    /// consecutive presents of the same process.
    frametime_ms: f64,
}

struct Tracker {
    last_qpc: i64,
    samples: Vec<Sample>,
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

pub fn run_capture() {
    let opts = parse_opts();
    let freq = perf_frequency() as f64;
    let state: Arc<Mutex<HashMap<u32, Tracker>>> = Arc::new(Mutex::new(HashMap::new()));
    let cb_state = state.clone();

    let provider = Provider::by_guid(DXGI_PROVIDER_GUID)
        .add_callback(move |record: &EventRecord, _schema: &SchemaLocator| {
            if record.event_id() != PRESENT_START_EVENT_ID {
                return;
            }
            let pid = record.process_id();
            if pid == 0 {
                return;
            }
            let qpc = record.raw_timestamp();
            let Ok(mut map) = cb_state.lock() else {
                return;
            };
            let tr = map.entry(pid).or_insert(Tracker {
                last_qpc: 0,
                samples: Vec::new(),
            });
            if tr.last_qpc != 0 && qpc > tr.last_qpc {
                let dt_ms = (qpc - tr.last_qpc) as f64 * 1000.0 / freq;
                // Ignore absurd intervals: 0 (duplicate timestamp) or > 1 s
                // (the process was idle / alt-tabbed). Those aren't real frames.
                if dt_ms > 0.0 && dt_ms < 1000.0 {
                    tr.samples.push(Sample {
                        at: Instant::now(),
                        frametime_ms: dt_ms,
                    });
                    // Cap the ring so a long session doesn't grow unbounded.
                    if tr.samples.len() > 2000 {
                        let excess = tr.samples.len() - 2000;
                        tr.samples.drain(0..excess);
                    }
                }
            }
            tr.last_qpc = qpc;
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

        // The "game" is the process presenting the most frames in the last
        // second, EXCLUDING the compositor/shell (dwm.exe et al.). In borderless
        // mode DWM composites at the game's rate and would otherwise win the
        // "most frames" race and get mislabelled as the game. We resolve each
        // candidate's name here and skip the denylist.
        let mut best: Option<(u32, String, Vec<f64>)> = None;
        for (pid, tr) in map.iter() {
            let recent: Vec<f64> = tr
                .samples
                .iter()
                .filter(|s| now.duration_since(s.at) <= STATS_WINDOW)
                .map(|s| s.frametime_ms)
                .collect();
            if recent.len() < 2 {
                continue;
            }
            let name = resolve_process_name(*pid);
            if PRESENTER_DENYLIST
                .iter()
                .any(|d| name.eq_ignore_ascii_case(d))
            {
                continue;
            }
            let take = match &best {
                Some((_, _, b)) => recent.len() > b.len(),
                None => true,
            };
            if take {
                best = Some((*pid, name, recent));
            }
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
