//! Where one recorded session ends and the next begins, and the read-only flag for a session that
//! already swallowed two games.
//!
//! A session belongs to ONE process identity (image name + pid). Before this module the session was
//! "everything between Start and Stop of monitoring": when the captured game died and another one
//! presented frames, the second game's frames were folded into the first game's record and the
//! record kept the first game's name (the 2026-11-20 "ROB RUN" session that held Phantom Blade Zero).
//!
//! [`Boundary`] is the pure state machine the monitoring thread drives once a second. It owns no
//! clock and no OS handle: the caller passes the second counter and, only when no fresh frame
//! arrived, a probe that answers "is this pid still this image?". Everything here is unit-tested
//! without a game.
//!
//! [`suspected_splice`] is the other half: it never edits history, it only says "this recorded
//! session looks like two workloads" so a reader (the Paramedic) can decline to judge it.

// The flag at the bottom is read-only groundwork for the Paramedic (a separate branch consumes it:
// "this session may contain two games: not judged"). Until that lands only the tests and the
// #[ignore]d real-data run call it, so a non-test build would warn on every item.
#![cfg_attr(not(test), allow(dead_code))]

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::sessions::SessionSummary;

/// Why a session stopped. Stored on the row as `ended`; rows written before this field read `None`
/// ("not recorded"), never a guessed reason.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SessionEnd {
    /// The captured process is gone (closed, crashed, killed). The session ends at its last reading.
    ProcessExited,
    /// A different process identity began presenting while this session was open. The session ends
    /// at its last reading and the new process starts its own session.
    TargetChanged,
    /// Monitoring was stopped (the user, the guided journey, the helper going away, the app closing)
    /// while the process was still there: wall time since the session began, as before.
    CaptureStopped,
}

/// The identity a session belongs to. A pid alone is not an identity (Windows recycles them) and a
/// name alone is not either (a relaunch is a different run).
#[derive(Clone, Debug, PartialEq, Eq)]
struct Target {
    name: String,
    pid: u32,
}

/// Consecutive one-second ticks with no fresh frame AND a probe that says the process is gone,
/// before the session ends. A single unlucky probe must not end a session; a live process, a probe
/// that could not say (`None`) and a silent-but-alive process (alt-tab, loading, minimised) never
/// count.
pub(crate) const EXIT_CONFIRM_TICKS: u32 = 2;

#[derive(Clone, Debug, PartialEq, Eq)]
enum State {
    /// No session is open: monitoring is on, nothing is being captured. The next frame begins one.
    Idle,
    /// A session is open. `target` is `None` until its first frame names the process (the session
    /// of a fresh capture exists from the moment monitoring starts, as it always has).
    Open { target: Option<Target>, began_at: u32, last_frame_at: Option<u32>, gone_ticks: u32 },
}

/// A session that ended, and where.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Ended {
    pub(crate) reason: SessionEnd,
    /// Whole seconds from the session's start to its end: to the LAST READING for `ProcessExited`
    /// and `TargetChanged`, to the moment of the stop for `CaptureStopped`.
    pub(crate) duration_secs: u32,
}

/// What one tick decided.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub(crate) struct Step {
    /// The open session ended on this tick (finalize and save it BEFORE starting the next).
    pub(crate) ended: Option<Ended>,
    /// A new session begins on this tick, and this tick's frame is its first.
    pub(crate) began: bool,
}

pub(crate) struct Boundary {
    state: State,
}

impl Boundary {
    /// Monitoring just started at `now` (seconds on the caller's clock): a session is open and its
    /// process is not known yet.
    pub(crate) fn open_at(now: u32) -> Self {
        Self { state: State::Open { target: None, began_at: now, last_frame_at: None, gone_ticks: 0 } }
    }

    /// Seconds-clock reading at which the open session began, or `None` when none is open.
    #[cfg(test)]
    pub(crate) fn began_at(&self) -> Option<u32> {
        match &self.state {
            State::Open { began_at, .. } => Some(*began_at),
            State::Idle => None,
        }
    }

    /// One tick at `now`. `frame` is the fresh reading's `(process name, pid)`, `None` when no fresh
    /// reading arrived. `alive` is asked only when there was no fresh reading and a session with a
    /// known process is open: "is this pid still running as this image?" (`None` = could not tell).
    pub(crate) fn tick(
        &mut self,
        now: u32,
        frame: Option<(&str, u32)>,
        alive: impl FnOnce(u32, &str) -> Option<bool>,
    ) -> Step {
        let state = std::mem::replace(&mut self.state, State::Idle);
        match (state, frame) {
            (State::Idle, Some((name, pid))) => {
                self.state = State::Open {
                    target: Some(Target { name: name.to_string(), pid }),
                    began_at: now,
                    last_frame_at: Some(now),
                    gone_ticks: 0,
                };
                Step { ended: None, began: true }
            }
            (State::Idle, None) => Step::default(),
            (State::Open { target: None, began_at, .. }, Some((name, pid))) => {
                self.state = State::Open {
                    target: Some(Target { name: name.to_string(), pid }),
                    began_at,
                    last_frame_at: Some(now),
                    gone_ticks: 0,
                };
                Step::default()
            }
            (open @ State::Open { target: None, .. }, None) => {
                self.state = open;
                Step::default()
            }
            (State::Open { target: Some(t), began_at, last_frame_at, .. }, Some((name, pid))) => {
                if t.name == name && t.pid == pid {
                    self.state = State::Open { target: Some(t), began_at, last_frame_at: Some(now), gone_ticks: 0 };
                    Step::default()
                } else {
                    // Another process identity is presenting: the open session is not about it.
                    let ended = Ended {
                        reason: SessionEnd::TargetChanged,
                        duration_secs: last_frame_at.unwrap_or(now).saturating_sub(began_at),
                    };
                    self.state = State::Open {
                        target: Some(Target { name: name.to_string(), pid }),
                        began_at: now,
                        last_frame_at: Some(now),
                        gone_ticks: 0,
                    };
                    Step { ended: Some(ended), began: true }
                }
            }
            (State::Open { target: Some(t), began_at, last_frame_at, gone_ticks }, None) => {
                let gone = alive(t.pid, &t.name) == Some(false);
                let gone_ticks = if gone { gone_ticks + 1 } else { 0 };
                if gone_ticks >= EXIT_CONFIRM_TICKS {
                    let ended = Ended {
                        reason: SessionEnd::ProcessExited,
                        duration_secs: last_frame_at.unwrap_or(now).saturating_sub(began_at),
                    };
                    // State stays Idle (set by the replace above).
                    Step { ended: Some(ended), began: false }
                } else {
                    self.state = State::Open { target: Some(t), began_at, last_frame_at, gone_ticks };
                    Step::default()
                }
            }
        }
    }

    /// Monitoring stopped at `now`. A session still open ends as `CaptureStopped` with wall time
    /// since it began (what every session has always recorded). `None` when none was open.
    pub(crate) fn stop(&mut self, now: u32) -> Option<Ended> {
        match std::mem::replace(&mut self.state, State::Idle) {
            State::Open { began_at, .. } => Some(Ended {
                reason: SessionEnd::CaptureStopped,
                duration_secs: now.saturating_sub(began_at),
            }),
            State::Idle => None,
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Flagging an already-recorded session that holds two workloads. Read-only: nothing is repaired.
// ---------------------------------------------------------------------------------------------

/// Seconds one `fps_series` point spans (`sessions::FPS_SERIES_BUCKET_SECS`).
const STEP_SECS: u32 = crate::sessions::FPS_SERIES_BUCKET_SECS;
/// A stretch with no readings at least this long is a candidate seam (a loading screen or a quick
/// alt-tab is shorter; a game closing and another opening is not).
pub(crate) const MIN_GAP_SECS: u32 = 120;
/// How many 10-second points either side of the gap are compared.
const SIDE_POINTS: usize = 30;
/// Fewest points each side needs to be called a level (5 minutes).
const MIN_SIDE_POINTS: usize = 30;
/// ... and with a crash record of this process at the seam (2 minutes).
const MIN_SIDE_POINTS_WITH_CRASH: usize = 12;
/// The two sides' median levels must differ by at least this factor (either direction).
const MIN_LEVEL_RATIO: f64 = 1.5;
/// ... or this factor when a crash record of this process sits at the seam.
const MIN_LEVEL_RATIO_WITH_CRASH: f64 = 1.25;
/// A crash counts as "at the seam" from this long before the gap begins until the gap ends.
const CRASH_LEAD_SECS: u32 = 120;

/// A Windows crash record (Event Log / Windows Error Reporting) the engine already reads, reduced
/// to what the flag needs. `app` is the faulting image name when the record carries one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CrashMark {
    pub(crate) at: DateTime<Utc>,
    pub(crate) app: Option<String>,
}

/// Why a recorded session is suspected to hold two games.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct SpliceSuspicion {
    /// Session seconds where readings stop (the suspected split).
    pub(crate) split_at_secs: u32,
    /// Session seconds where readings resume.
    pub(crate) resumes_at_secs: u32,
    pub(crate) before_level: f64,
    pub(crate) after_level: f64,
    /// A crash record of this session's process falls at the seam.
    pub(crate) crash_at_seam: bool,
}

fn median(v: &mut [f64]) -> f64 {
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

/// The session's level over time at 10-second resolution: its fps series, or (for a session whose
/// series was shed but whose per-second timeline is still kept) the mean 1% low per 10 s. Empty when
/// the row kept neither, in which case nothing can be said.
fn level_series(s: &SessionSummary) -> Vec<(u32, f64)> {
    if !s.fps_series.is_empty() {
        return s.fps_series.iter().copied().filter(|(_, v)| *v > 0.0 && v.is_finite()).collect();
    }
    let mut out: Vec<(u32, f64, u32)> = Vec::new();
    for &(at, low) in &s.stutter_timeline {
        if !(low > 0.0 && low.is_finite()) {
            continue;
        }
        let b = at / STEP_SECS * STEP_SECS;
        match out.last_mut() {
            Some(last) if last.0 == b => {
                last.1 += low;
                last.2 += 1;
            }
            _ => out.push((b, low, 1)),
        }
    }
    out.into_iter().map(|(b, sum, n)| (b, sum / f64::from(n))).collect()
}

fn same_image(a: &str, b: &str) -> bool {
    let norm = |x: &str| x.trim().to_ascii_lowercase().trim_end_matches(".exe").to_string();
    !norm(a).is_empty() && norm(a) == norm(b)
}

/// PURE, read-only: does this recorded session look like two workloads in one row? It looks for a
/// stretch of at least [`MIN_GAP_SECS`] with no readings that is followed by a sustained change of
/// level (the median of the 30 points before against the 30 after differing by 1.5x or more, either
/// way). A crash record of this session's process at the seam relaxes both conditions, since the
/// crash is independent evidence that the first workload ended there. A loading screen or alt-tab
/// dip that returns to the same level is NOT flagged. `None` means "no sign", including "the row kept
/// no series to look at". Never an edit: the caller decides what to do (the Paramedic declines to
/// judge a flagged session).
pub(crate) fn suspected_splice(s: &SessionSummary, crashes: &[CrashMark]) -> Option<SpliceSuspicion> {
    let series = level_series(s);
    let started = DateTime::parse_from_rfc3339(&s.started_at).ok().map(|t| t.with_timezone(&Utc));
    let mut best: Option<SpliceSuspicion> = None;
    for i in 0..series.len().saturating_sub(1) {
        let (prev_at, _) = series[i];
        let (next_at, _) = series[i + 1];
        let gap_start = prev_at + STEP_SECS;
        let gap = next_at.saturating_sub(gap_start);
        if gap < MIN_GAP_SECS {
            continue;
        }
        let crash_at_seam = started.is_some_and(|t0| {
            crashes.iter().any(|c| {
                let rel = (c.at - t0).num_seconds();
                let lo = i64::from(gap_start) - i64::from(CRASH_LEAD_SECS);
                let hi = i64::from(next_at);
                rel >= lo && rel <= hi && c.app.as_deref().is_none_or(|a| same_image(a, &s.process_name))
            })
        });
        let (min_side, min_ratio) = if crash_at_seam {
            (MIN_SIDE_POINTS_WITH_CRASH, MIN_LEVEL_RATIO_WITH_CRASH)
        } else {
            (MIN_SIDE_POINTS, MIN_LEVEL_RATIO)
        };
        let left: Vec<f64> = series[..=i].iter().rev().take(SIDE_POINTS).map(|p| p.1).collect();
        let right: Vec<f64> = series[i + 1..].iter().take(SIDE_POINTS).map(|p| p.1).collect();
        if left.len() < min_side || right.len() < min_side {
            continue;
        }
        let (before, after) = (median(&mut left.clone()), median(&mut right.clone()));
        if !(before > 0.0 && after > 0.0) {
            continue;
        }
        if before.max(after) / before.min(after) < min_ratio {
            continue;
        }
        let found = SpliceSuspicion {
            split_at_secs: gap_start,
            resumes_at_secs: next_at,
            before_level: before,
            after_level: after,
            crash_at_seam,
        };
        // The longest qualifying gap is the seam.
        if best.as_ref().is_none_or(|b| b.resumes_at_secs - b.split_at_secs < gap) {
            best = Some(found);
        }
    }
    best
}

/// PURE: when the suspected split happened (session start + where readings stop), for the Paramedic's
/// "this session may contain two games: not judged".
pub(crate) fn suspected_split_time(s: &SessionSummary, crashes: &[CrashMark]) -> Option<DateTime<Utc>> {
    let found = suspected_splice(s, crashes)?;
    let t0 = DateTime::parse_from_rfc3339(&s.started_at).ok()?.with_timezone(&Utc);
    Some(t0 + Duration::seconds(i64::from(found.split_at_secs)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A session row with only the seven required keys (what the oldest builds wrote), plus extras.
    fn row(started_at: &str, name: &str, extra: serde_json::Value) -> SessionSummary {
        let mut v = serde_json::json!({
            "started_at": started_at, "duration_secs": 6730, "process_name": name, "samples": 5000,
            "avg_fps": 160.0, "avg_frametime_ms": 6.0, "low1_fps_est": 60.0
        });
        if let (Some(base), Some(add)) = (v.as_object_mut(), extra.as_object()) {
            for (k, x) in add {
                base.insert(k.clone(), x.clone());
            }
        }
        serde_json::from_value(v).expect("row")
    }

    /// `(start_secs, fps)` points every 10 s from `from` up to (not including) `to`.
    fn run(from: u32, to: u32, fps: f64) -> Vec<(u32, f64)> {
        (from..to).step_by(10).map(|t| (t, fps)).collect()
    }

    fn series(parts: Vec<Vec<(u32, f64)>>) -> serde_json::Value {
        serde_json::json!({ "fps_series": parts.concat() })
    }

    // ---- the state machine ------------------------------------------------------------------

    type Frame<'a> = Option<(&'a str, u32)>;

    /// Drive the machine with `(frame, probe answer)` per second from `from`; collect what it decided.
    fn drive(b: &mut Boundary, script: &[(Frame<'_>, Option<bool>)], from: u32) -> Vec<(u32, Step)> {
        let mut out = Vec::new();
        for (i, (frame, probe)) in script.iter().enumerate() {
            let now = from + i as u32;
            let step = b.tick(now, *frame, |_, _| *probe);
            if step != Step::default() {
                out.push((now, step));
            }
        }
        out
    }

    const A: Option<(&str, u32)> = Some(("ROB RUN.exe", 100));
    const B: Option<(&str, u32)> = Some(("PBZ.exe", 200));

    #[test]
    fn a_exits_then_b_presents_is_two_sessions_and_a_ends_at_its_last_reading() {
        let mut b = Boundary::open_at(0);
        let mut script = vec![(A, None); 60]; // A presents t=0..59
        script.extend(vec![(None, Some(true)); 5]); // t=60..64: silent but alive (crash dialog)
        script.extend(vec![(None, Some(false)); 20]); // t=65..84: gone
        script.extend(vec![(B, None); 30]); // t=85..114: B presents
        let steps = drive(&mut b, &script, 0);
        assert_eq!(steps.len(), 2, "{steps:?}");
        // A ends once the exit is confirmed (2 ticks), but its duration is its LAST READING (t=59).
        assert_eq!(steps[0], (66, Step { ended: Some(Ended { reason: SessionEnd::ProcessExited, duration_secs: 59 }), began: false }));
        // B begins at its own first frame; nothing of A is carried over.
        assert_eq!(steps[1], (85, Step { ended: None, began: true }));
        assert_eq!(b.began_at(), Some(85));
        // B's session then ends at ITS last reading when it stops.
        assert_eq!(b.stop(120), Some(Ended { reason: SessionEnd::CaptureStopped, duration_secs: 35 }));
    }

    #[test]
    fn a_exits_and_nothing_follows_is_one_finished_session_and_no_phantom_next() {
        let mut b = Boundary::open_at(0);
        let mut script = vec![(A, None); 30];
        script.extend(vec![(None, Some(false)); 600]);
        let steps = drive(&mut b, &script, 0);
        assert_eq!(steps.len(), 1, "{steps:?}");
        assert_eq!(steps[0].1.ended, Some(Ended { reason: SessionEnd::ProcessExited, duration_secs: 29 }));
        assert_eq!(b.began_at(), None, "monitoring stays on but no session is open");
        assert_eq!(b.stop(700), None, "stopping an idle capture saves nothing");
    }

    #[test]
    fn a_silent_game_that_is_still_alive_never_ends_its_session() {
        // Alt-tab, a loading screen, a minimised game: no frames for a long time, process alive.
        let mut b = Boundary::open_at(0);
        let mut script = vec![(A, None); 10];
        script.extend(vec![(None, Some(true)); 3600]);
        script.extend(vec![(A, None); 10]);
        assert!(drive(&mut b, &script, 0).is_empty());
        assert_eq!(b.began_at(), Some(0));
    }

    #[test]
    fn a_probe_that_cannot_say_or_one_unlucky_probe_never_ends_a_session() {
        let mut b = Boundary::open_at(0);
        let mut script = vec![(A, None); 5];
        script.extend(vec![(None, None); 500]); // access denied: unknown is never "closed"
        script.push((None, Some(false))); // one "gone" ...
        script.push((None, Some(true))); // ... then alive again: the count restarts
        script.push((None, Some(false)));
        script.extend(vec![(A, None); 5]);
        assert!(drive(&mut b, &script, 0).is_empty());
    }

    #[test]
    fn the_same_exe_relaunched_after_its_exit_is_a_new_run_and_a_new_session() {
        // Pinned: a relaunch (crash then restart, quick restart) is a new process lifetime. Today's
        // code merged these into one row; the merge was the bug's mechanism, not a feature anyone
        // relied on (the second run's loading time and level were folded into the first's numbers).
        let a2: Option<(&str, u32)> = Some(("ROB RUN.exe", 300));
        let mut b = Boundary::open_at(0);
        let mut script = vec![(A, None); 40];
        script.extend(vec![(None, Some(false)); 10]);
        script.extend(vec![(a2, None); 40]);
        let steps = drive(&mut b, &script, 0);
        assert_eq!(steps.len(), 2, "{steps:?}");
        assert_eq!(steps[0].1.ended.map(|e| e.reason), Some(SessionEnd::ProcessExited));
        assert!(steps[1].1.began && steps[1].1.ended.is_none());
    }

    #[test]
    fn a_new_pid_with_no_observed_exit_ends_the_session_as_target_changed_at_its_last_reading() {
        let a2: Option<(&str, u32)> = Some(("ROB RUN.exe", 300));
        let mut b = Boundary::open_at(0);
        let mut script = vec![(A, None); 40];
        script.push((a2, None)); // t=40: the exit and the relaunch fell between two ticks
        let steps = drive(&mut b, &script, 0);
        assert_eq!(
            steps,
            vec![(40, Step { ended: Some(Ended { reason: SessionEnd::TargetChanged, duration_secs: 39 }), began: true })]
        );
    }

    #[test]
    fn another_exe_presenting_while_the_first_is_alive_is_target_changed() {
        // A is minimised (still alive) and B is full-screen and presenting.
        let mut b = Boundary::open_at(0);
        let mut script = vec![(A, None); 20];
        script.extend(vec![(B, None); 20]);
        let steps = drive(&mut b, &script, 0);
        assert_eq!(steps.len(), 1, "{steps:?}");
        assert_eq!(steps[0].0, 20);
        assert_eq!(steps[0].1.ended, Some(Ended { reason: SessionEnd::TargetChanged, duration_secs: 19 }));
        assert!(steps[0].1.began);
    }

    #[test]
    fn a_launcher_then_the_game_are_two_sessions_not_one_row_named_for_the_longer() {
        let launcher: Option<(&str, u32)> = Some(("start_protected_game.exe", 50));
        let mut b = Boundary::open_at(0);
        let mut script = vec![(launcher, None); 8];
        script.extend(vec![(None, Some(false)); 4]);
        script.extend(vec![(A, None); 100]);
        let steps = drive(&mut b, &script, 0);
        assert_eq!(steps.len(), 2, "{steps:?}");
        assert_eq!(steps[0].1.ended.map(|e| (e.reason, e.duration_secs)), Some((SessionEnd::ProcessExited, 7)));
    }

    #[test]
    fn stopping_with_the_game_alive_keeps_the_wall_time_duration() {
        let mut b = Boundary::open_at(10);
        drive(&mut b, &vec![(A, None); 50], 10);
        assert_eq!(b.stop(75), Some(Ended { reason: SessionEnd::CaptureStopped, duration_secs: 65 }));
    }

    #[test]
    fn the_probe_is_not_asked_while_frames_arrive() {
        let mut b = Boundary::open_at(0);
        for t in 0..10 {
            b.tick(t, A, |_, _| panic!("the probe must not run on a tick with a fresh frame"));
        }
    }

    // ---- stored data --------------------------------------------------------------------------

    #[test]
    fn an_old_row_without_the_end_field_loads_with_none_and_writes_back_without_it() {
        let s = row("2026-11-11T13:27:19Z", "ROB RUN.exe", serde_json::json!({}));
        assert_eq!(s.ended, None);
        let back = serde_json::to_value(&s).unwrap();
        assert!(back.get("ended").is_none(), "an unknown reason is not written");
    }

    #[test]
    fn the_end_reason_round_trips_and_an_unknown_value_reads_as_not_recorded() {
        let s = row("2026-11-20T01:01:24Z", "ROB RUN.exe", serde_json::json!({ "ended": "process-exited" }));
        assert_eq!(s.ended, Some(SessionEnd::ProcessExited));
        assert_eq!(serde_json::to_value(&s).unwrap()["ended"], "process-exited");
        let future = row("2026-11-20T01:01:24Z", "ROB RUN.exe", serde_json::json!({ "ended": "something-newer" }));
        assert_eq!(future.ended, None, "a reason a newer build wrote must not fail the whole load");
    }

    // ---- the mixed-session flag -----------------------------------------------------------------

    #[test]
    fn a_long_gap_then_a_sustained_level_shift_is_flagged_with_the_split_time() {
        // Shaped like the real 2026-11-20T01:01Z row: ~203 fps, 720 s of nothing, then a flat ~97.
        let s = row(
            "2026-11-20T01:01:24Z",
            "ROB RUN.exe",
            series(vec![run(0, 3520, 203.0), run(4240, 6730, 97.0)]),
        );
        let f = suspected_splice(&s, &[]).expect("flagged");
        assert_eq!((f.split_at_secs, f.resumes_at_secs), (3520, 4240));
        assert!(f.before_level > 200.0 && f.after_level < 100.0 && !f.crash_at_seam);
        let at = suspected_split_time(&s, &[]).unwrap();
        assert_eq!(at.to_rfc3339(), "2026-11-20T02:00:04+00:00");
    }

    #[test]
    fn a_crash_record_of_that_process_at_the_seam_flags_a_smaller_shift_and_shorter_sides() {
        let s = row(
            "2026-11-20T01:01:24Z",
            "ROB RUN.exe",
            series(vec![run(0, 600, 200.0), run(780, 1100, 150.0)]), // 1.33x, right side 32 points, left 60
        );
        assert!(suspected_splice(&s, &[]).is_none(), "1.33x alone is ordinary variation");
        let crash_time = DateTime::parse_from_rfc3339("2026-11-20T01:11:00Z").unwrap().with_timezone(&Utc); // t=576
        let crash = CrashMark { at: crash_time, app: Some("ROB RUN.exe".into()) };
        let f = suspected_splice(&s, std::slice::from_ref(&crash)).expect("flagged with the crash");
        assert!(f.crash_at_seam);
        // A crash of some OTHER program is not evidence about this session.
        let other = CrashMark { at: crash_time, app: Some("explorer.exe".into()) };
        assert!(suspected_splice(&s, &[other]).is_none());
    }

    #[test]
    fn a_loading_screen_dip_that_returns_to_the_same_level_is_not_flagged() {
        // 4 minutes of nothing (a level load), and the same ~200 fps either side.
        let s = row(
            "2026-11-11T13:27:19Z",
            "ROB RUN.exe",
            series(vec![run(0, 900, 200.0), run(1140, 1800, 205.0)]),
        );
        assert!(suspected_splice(&s, &[]).is_none());
    }

    #[test]
    fn a_menu_to_gameplay_change_without_a_gap_is_not_flagged() {
        let s = row("2026-11-11T13:27:19Z", "ROB RUN.exe", series(vec![run(0, 600, 600.0), run(600, 1800, 250.0)]));
        assert!(suspected_splice(&s, &[]).is_none(), "no stretch without readings, no seam");
    }

    #[test]
    fn a_short_gap_or_a_thin_side_is_not_flagged_and_a_row_without_a_series_says_nothing() {
        let short = row("2026-11-11T13:27:19Z", "G.exe", series(vec![run(0, 900, 200.0), run(960, 1800, 90.0)]));
        assert!(suspected_splice(&short, &[]).is_none(), "a 60 s gap is a loading screen");
        let thin = row("2026-11-11T13:27:19Z", "G.exe", series(vec![run(0, 100, 200.0), run(400, 1000, 90.0)]));
        assert!(suspected_splice(&thin, &[]).is_none(), "ten points before the gap is not a level");
        let none = row("2026-11-11T13:27:19Z", "G.exe", serde_json::json!({}));
        assert!(suspected_splice(&none, &[]).is_none());
    }

    #[test]
    fn a_session_whose_series_was_shed_is_read_from_its_per_second_timeline() {
        let mut tl: Vec<(u32, f64)> = (0..1800).map(|t| (t, 80.0)).collect();
        tl.extend((2400..4200).map(|t| (t, 30.0)));
        let s = row("2026-11-20T01:01:24Z", "ROB RUN.exe", serde_json::json!({ "stutter_timeline": tl }));
        let f = suspected_splice(&s, &[]).expect("flagged from the timeline");
        assert_eq!((f.split_at_secs, f.resumes_at_secs), (1800, 2400));
    }

    #[test]
    #[ignore = "reads the owner's real sessions.json (read-only); run with --ignored --nocapture"]
    fn real_sessions_flagged_read_only() {
        let dir = crate::compy_data_dir();
        let sessions = crate::sessions::read_sessions_readonly_from(&dir.join("sessions.json")).expect("sessions.json");
        // Crash records Compy's incident observer already keeps (read-only).
        let mut crashes: Vec<CrashMark> = Vec::new();
        if let Ok(text) = std::fs::read_to_string(dir.join("care").join("incident-observer.json")) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(text.trim_start_matches('\u{feff}')) {
                for o in v["seen"].as_array().into_iter().flatten() {
                    let tag = o["kind_tag"].as_str().unwrap_or("").to_ascii_lowercase();
                    if !tag.contains("crash") {
                        continue;
                    }
                    if let Some(at) = o["occurred_at"].as_str().and_then(|t| DateTime::parse_from_rfc3339(t).ok()) {
                        crashes.push(CrashMark { at: at.with_timezone(&Utc), app: o["app"].as_str().map(str::to_string) });
                    }
                }
            }
        }
        println!("sessions read: {}, crash marks read: {}", sessions.len(), crashes.len());
        let mut flagged = Vec::new();
        for s in &sessions {
            let without = suspected_splice(s, &[]);
            let with = suspected_splice(s, &crashes);
            if without.is_some() || with.is_some() {
                flagged.push(s.started_at.clone());
                println!("FLAGGED {} {} without_crash_records={:?} with_crash_records={:?}", s.started_at, s.process_name, without, with);
            }
        }
        println!("flagged: {flagged:?}");
        assert!(flagged.iter().all(|t| !t.starts_with("2026-11-11")), "an ordinary 2026-11-11 session was flagged");
    }
}

#[cfg(test)]
mod wiring {
    /// The monitoring thread must be driven by the boundary. On the code before this change the loop
    /// kept one session for the whole capture and none of these exist.
    #[test]
    fn the_monitoring_loop_is_driven_by_the_boundary() {
        let src = include_str!("monitoring.rs");
        for needle in [
            "Boundary::open_at(0)",
            "boundary.tick(",
            "boundary.stop(",
            "done.finish(ended)",
            "if step.began {",
            "summary.ended = Some(reason);",
        ] {
            assert!(src.contains(needle), "monitoring.rs lost `{needle}`");
        }
        assert!(!src.contains("finish_at_stop"), "the single-session shape is back");
    }
}
