//! Paramedic F4 - dated "what changed on this PC, and when" readers (read-only).
//!
//! Gives the diagnosis engine dated facts from Windows itself instead of only what Compy happened
//! to be capturing: GPU / other driver installs, Windows Update installs, a Steam game's last
//! update, and installed programs. Local, user-mode, no elevation, no network, no writes, no
//! driver, no injection (ARCHITECTURE_LOCKS 1.8: "ETW, vendor-supported SDKs, local files, WMI/CIM,
//! or another lower-risk user-mode route"). Nothing here is added to any support bundle or
//! outbound payload, and nothing is logged: program and game names are data about the user.
//!
//! RULES (each pinned by a test in this file):
//! - Never runs in the elevated helper: `run_elevated_helper` must not reach this module.
//! - Never spawns by bare name: child tools are started by absolute path under the Windows system
//!   directory (`GetSystemDirectoryW`), so a planted `wevtutil.exe` beside compy.exe never runs.
//! - Never feeds support evidence, the evidence-upload types, receipts or any outbound payload.
//! - Never says "nothing changed" when it could not look: every outcome is `Unreadable(reason)`,
//!   or a `Read` that lists its gaps (budget, row cap, malformed records, coverage start).
//!
//! Sources, chosen on this PC without elevation (see _train/f4-windows-facts.md):
//! - Drivers: System-class channel `Microsoft-Windows-Kernel-PnP/Configuration`, event 400 ("device
//!   was configured") with `DeviceUpdated=true`. The design's UserPnp 20001/20003 is NOT usable:
//!   20003 only reports service adds and 20001 never appears. Times are UTC and exact.
//! - Windows Update: System log `Microsoft-Windows-WindowsUpdateClient` event 19 (installation
//!   successful; `updateTitle` carries the KB). UTC and exact. Store/MSIX app updates appear here.
//! - Game update: Steam `steamapps\appmanifest_<id>.acf` (`buildid`, `LastUpdated` epoch seconds).
//!   `LastUpdated` also moves on a file verify or DLC download, so it means "the game's files
//!   changed", NOT "a new version"; only `buildid` != `TargetBuildID` is a real pending-update signal.
//! - Programs: registry `...\Uninstall\*` `InstallDate`: a LOCAL calendar date, day precision. Only
//!   programs that record an install date can be listed (the count of those that do not is
//!   reported); Store/MSIX apps are not in these keys at all. The engine must never claim "no
//!   program was installed". A day-precision event happened "that day", never "after" a time.
//!
//! Event-log reads go through the built-in `wevtutil.exe` (a hidden child that can be killed at the
//! budget): ~50 ms instead of a PowerShell start-up. wevtutil writes text to a pipe in the ANSI/OEM
//! code page, replacing characters it cannot map with `?` (measured on this PC: U+200E arrives as
//! `?`), so event-log TEXT (titles, provider names) is flagged `text_uncertain` whenever it holds a
//! `?` or a non-ASCII character; KB ids, versions and times are ASCII and authoritative.
//! Parsing is pure and separate from I/O so every parser is tested from fixture text.

use chrono::{DateTime, Duration as ChronoDuration, NaiveDate, NaiveDateTime, TimeZone, Utc};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Hard time budget per reader unless the caller passes another.
pub(crate) const DEFAULT_BUDGET: Duration = Duration::from_millis(500);
/// How far back the driver reader looks so a driver event can name the version it replaced.
const DRIVER_LOOKBACK_DAYS: i64 = 120;
/// Newest-first cap on event-log rows per query. Reaching it makes the read partial.
const MAX_EVENTS: usize = 600;
/// Rows requested: one more than the cap, so exactly `MAX_EVENTS` rows is a complete read and only
/// `MAX_EVENTS + 1` proves older rows exist.
const QUERY_ROWS: usize = MAX_EVENTS + 1;
/// Most bytes read from a child's stdout; more is dropped and the read is partial.
const MAX_OUTPUT_BYTES: usize = 8 * 1024 * 1024;
/// Same device + same driver + same version reconfigured within this span is one install.
const DUP_SPAN_SECS: i64 = 600;

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ChangeKind {
    GpuDriver,
    /// Audio, network or chipset/system driver (`what.detail` names which).
    OtherDriver,
    /// Quality, feature, driver-via-Windows-Update, definition or Store-app update.
    WindowsUpdate,
    /// Steam says the game's files changed at this time (update, verify or DLC; see module docs).
    GameUpdate,
    ProgramInstalled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Precision {
    /// `at` is the instant (UTC) Windows recorded.
    Exact,
    /// The source only knows a local calendar day: the change happened in `[at, until)`. Word it
    /// "that day", never "after" some time of day.
    Day,
    Unknown,
}

/// When a change happened, in UTC, and how precisely that is known.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) struct ChangeTime {
    pub precision: Precision,
    /// Exact: the instant. Day: start of the local day. Unknown: none.
    pub at: Option<DateTime<Utc>>,
    /// Exact: same as `at`. Day: start of the next local day (exclusive). Unknown: none.
    pub until: Option<DateTime<Utc>>,
}

impl ChangeTime {
    pub(crate) fn exact(t: DateTime<Utc>) -> Self {
        ChangeTime { precision: Precision::Exact, at: Some(t), until: Some(t) }
    }
    pub(crate) fn day(start: DateTime<Utc>, end: DateTime<Utc>) -> Self {
        ChangeTime { precision: Precision::Day, at: Some(start), until: Some(end) }
    }
    #[cfg(test)]
    pub(crate) fn unknown() -> Self {
        ChangeTime { precision: Precision::Unknown, at: None, until: None }
    }
    /// Window rule, one place: the window is `(t0, t1]`, lower bound EXCLUSIVE, upper INCLUSIVE.
    /// Exact: `t0 < at <= t1`. Day: the day `[a, b)` overlaps the window (`a <= t1 && b > t0`).
    /// Unknown never matches (the combiner counts it separately).
    pub(crate) fn in_window(&self, t0: DateTime<Utc>, t1: DateTime<Utc>) -> bool {
        match (self.precision, self.at, self.until) {
            (Precision::Exact, Some(a), _) => a > t0 && a <= t1,
            (Precision::Day, Some(a), Some(b)) => a <= t1 && b > t0,
            _ => false,
        }
    }
}

/// Which Windows record a change came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Source {
    DriverLog,
    WindowsUpdateLog,
    SteamManifest,
    UninstallKeys,
}

/// Plain fields; every one optional because no source has all of them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub(crate) struct ChangeWhat {
    pub name: Option<String>,
    pub id: Option<String>,
    /// Driver: the version this install replaced. `None` when unchanged OR when the previous
    /// version is not known (see `version_changed`).
    pub from_version: Option<String>,
    pub to_version: Option<String>,
    /// Driver events only: `Some(true)` a real version change, `Some(false)` the same version was
    /// configured again, `None` the previous version is unknown (first row seen in the lookback).
    /// Callers filter real changes on this, never on `detail` text.
    pub version_changed: Option<bool>,
    /// Windows Update KB id, e.g. "KB5007651".
    pub kb: Option<String>,
    /// Steam build id.
    pub build_id: Option<String>,
    pub detail: Option<String>,
    /// True when `name`/`detail` came through wevtutil and hold a `?` or non-ASCII character: the
    /// text may have been mis-decoded (KB ids, versions and times are unaffected).
    pub text_uncertain: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ChangeEvent {
    pub kind: ChangeKind,
    pub when: ChangeTime,
    pub what: ChangeWhat,
    pub source: Source,
}

/// Why a source could not be read. Fixed codes, never Windows' (localised) error text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum UnreadableReason {
    ToolMissing,
    StartFailed,
    AccessDenied,
    ChannelNotFound,
    QueryFailed(Option<i32>),
    TimedOutBeforeAnyRecord,
    /// The log has no records at all: cleared, or switched off.
    LogEmptyOrSwitchedOff,
    /// Windows returned records Compy could not read (renamed field, undecodable text).
    RecordsUnreadable(usize),
    RegistryUnreadable,
    ReaderStopped,
    NotSteamLauncher(String),
    NoGameIdentified,
    NotInSteamLibrary,
    SteamNotFound,
    SteamUnreadable,
    SteamGameNotFound,
    SteamPartiallyUnreadable { libraries: usize, records: usize },
    SteamNoUpdateTime,
}

impl UnreadableReason {
    /// Plain English for the user-facing line. Fixed text; nothing from Windows is echoed.
    #[cfg(test)]
    pub(crate) fn plain(&self) -> String {
        match self {
            Self::ToolMissing => "Windows' event-log tool was not found in the system folder".into(),
            Self::StartFailed => "Windows' event-log tool could not be started".into(),
            Self::AccessDenied => "Windows refused access to the event log without administrator rights".into(),
            Self::ChannelNotFound => "This Windows event log does not exist on this PC".into(),
            Self::QueryFailed(Some(c)) => format!("Windows could not run the event-log query (code {c})"),
            Self::QueryFailed(None) => "Windows could not run the event-log query".into(),
            Self::TimedOutBeforeAnyRecord => "Reading did not finish within its time budget".into(),
            Self::LogEmptyOrSwitchedOff => "The Windows log is empty or switched off, so it shows nothing about the past".into(),
            Self::RecordsUnreadable(n) => format!("Windows returned records Compy could not read ({n} unreadable)"),
            Self::RegistryUnreadable => "The installed-programs registry keys could not be opened".into(),
            Self::ReaderStopped => "The reader stopped unexpectedly".into(),
            Self::NotSteamLauncher(l) => format!(
                "This game is not a Steam install (launcher: {l}); Compy can only read update times from Steam"
            ),
            Self::NoGameIdentified => "No game was identified, so there is no game update to look up".into(),
            Self::NotInSteamLibrary => {
                "This game is not installed in a Steam library, so Compy cannot read when it was updated".into()
            }
            Self::SteamNotFound => "Steam was not found for this Windows user, so Compy cannot check a Steam record".into(),
            Self::SteamUnreadable => "Steam's settings could not be read".into(),
            Self::SteamGameNotFound => "Every Steam library Compy could read has no record of this game".into(),
            Self::SteamPartiallyUnreadable { libraries, records } => format!(
                "Compy could not read part of Steam's data ({libraries} library folder(s), {records} game record(s)) and did not find this game in the rest"
            ),
            Self::SteamNoUpdateTime => "Steam's record for this game has no usable update time".into(),
        }
    }
}

/// A reason a `Read` is incomplete. A read with gaps is never "all clear".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Gap {
    /// Budget ran out; only the newest rows were read (see `covered_from`).
    TimedOut,
    /// The row cap was reached; older rows exist and were not read (see `covered_from`).
    RowCapReached,
    /// Records Windows returned that Compy could not parse (count).
    MalformedRecords(usize),
    /// The reader's output exceeded the byte cap; the rest was not read.
    OutputCapped,
    /// Registry keys that could not be opened or listed (count).
    RegistryKeysUnreadable(usize),
    SteamLibrariesUnreadable(usize),
}

/// A limit of the source that is always true, for the engine's wording.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Note {
    /// Programs the registry lists with no usable install date (cannot be placed in time).
    ProgramsWithoutDate(usize),
    /// Store/MSIX apps are not in the Uninstall keys; never claim "no program was installed".
    StoreAppsNotCovered,
    /// Steam `LastUpdated` also moves on verify/DLC: "the game's files changed", not "new version".
    SteamUpdateTimeIsFileChange,
    /// The driver classes this reader reports. Storage, USB, Bluetooth, HID and every other class are
    /// NOT checked, so the engine must never say "no driver changed", only "no driver of these classes".
    DriverClassesCovered(Vec<String>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ReadOk {
    pub events: Vec<ChangeEvent>,
    /// Records older than this may be missing: the oldest record the log still holds, or, after a
    /// timeout or row cap, how far back the read actually reached. `None` for sources with no log.
    pub covered_from: Option<DateTime<Utc>>,
    pub gaps: Vec<Gap>,
    pub notes: Vec<Note>,
}

impl ReadOk {
    #[cfg(test)]
    pub(crate) fn timed_out(&self) -> bool {
        self.gaps.contains(&Gap::TimedOut)
    }
}

/// One reader's outcome. `Unreadable` is NOT the same as `Read` with no events.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SourceRead {
    Read(ReadOk),
    Unreadable(UnreadableReason),
}

impl SourceRead {
    /// A complete read with nothing special to say.
    #[cfg(test)]
    pub(crate) fn ok(events: Vec<ChangeEvent>) -> SourceRead {
        SourceRead::Read(ReadOk { events, covered_from: None, gaps: Vec::new(), notes: Vec::new() })
    }

    /// A budget-limited read of a source with no log: nothing read by the deadline is unreadable,
    /// not "nothing changed"; partial output stays partial.
    fn finish(events: Vec<ChangeEvent>, timed_out: bool, notes: Vec<Note>) -> SourceRead {
        if timed_out && events.is_empty() {
            return SourceRead::Unreadable(UnreadableReason::TimedOutBeforeAnyRecord);
        }
        let gaps = if timed_out { vec![Gap::TimedOut] } else { Vec::new() };
        SourceRead::Read(ReadOk { events, covered_from: None, gaps, notes })
    }
}

/// The game the engine is asking about. All fields optional; a launcher other than Steam (or no
/// Steam signal at all) is answered plainly with `Unreadable`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct GameRef {
    pub steam_app_id: Option<u32>,
    pub install_dir: Option<String>,
    /// Launcher name if known ("Steam", "Epic", ...).
    pub launcher: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct UnreadableSource {
    pub source: Source,
    pub reason: UnreadableReason,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct PartialSource {
    pub source: Source,
    pub gaps: Vec<Gap>,
    pub covered_from: Option<DateTime<Utc>>,
}

/// "Compy cannot see `from..to` for this source": the window starts before the log does.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct CoverageGap {
    pub source: Source,
    pub from: DateTime<Utc>,
    pub to: DateTime<Utc>,
}

/// What changed in a window, plus everything the engine needs to avoid a false "nothing changed".
///
/// `events_found` is only what was FOUND. An empty list says nothing by itself: the source may not
/// have been asked, may be unreadable, or may be partial. Always go through [`ChangeReport::status`]
/// for the kind you want to talk about, and only a `KindStatus::Complete` with an empty
/// `events_found` for that kind means "Compy looked and found none" (still limited by the listed
/// `limits`, e.g. Store apps are not covered).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ChangeReport {
    pub window_start: DateTime<Utc>,
    pub window_end: DateTime<Utc>,
    /// The sources that were actually asked. A source not listed here says nothing about the PC.
    pub asked: Vec<Source>,
    /// Found inside the window `(window_start, window_end]`, oldest first. NOT "all that changed":
    /// see the type docs and `status`.
    pub events_found: Vec<ChangeEvent>,
    /// Sources Compy could not read. "Could not read" is never "nothing changed".
    pub unreadable: Vec<UnreadableSource>,
    /// Sources that were read incompletely (budget, row cap, malformed records).
    pub partial: Vec<PartialSource>,
    /// Parts of the window a log cannot cover because it starts later than `window_start`.
    pub coverage_gaps: Vec<CoverageGap>,
    /// Always-true limits of the sources that were read.
    pub notes: Vec<(Source, Note)>,
    /// The game's last file change from Steam regardless of the window (so "files unchanged since
    /// X" can be said), when a game was asked about and could be read.
    pub game_last_update: Option<ChangeEvent>,
    /// Events a source returned without a usable time; excluded from `events`.
    pub undated_excluded: usize,
}

/// How far the engine may trust a kind's (possibly empty) list of found events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) enum KindStatus {
    /// The source for this kind was never asked (e.g. no game was given for `GameUpdate`).
    NotAsked,
    Unreadable(UnreadableReason),
    /// Read, but incompletely or not back to the window start.
    Partial { gaps: Vec<Gap>, covered_from: Option<DateTime<Utc>>, coverage_gap: Option<CoverageGap>, limits: Vec<Note> },
    /// Read completely. `limits` are the always-true limits of that source.
    Complete { limits: Vec<Note> },
}

impl ChangeKind {
    /// The Windows source that answers this kind.
    pub(crate) fn source(self) -> Source {
        match self {
            ChangeKind::GpuDriver | ChangeKind::OtherDriver => Source::DriverLog,
            ChangeKind::WindowsUpdate => Source::WindowsUpdateLog,
            ChangeKind::GameUpdate => Source::SteamManifest,
            ChangeKind::ProgramInstalled => Source::UninstallKeys,
        }
    }
}

impl ChangeReport {
    /// The only sound way to read an empty `events_found`: what is known about this kind's source.
    pub(crate) fn status(&self, kind: ChangeKind) -> KindStatus {
        let source = kind.source();
        if !self.asked.contains(&source) {
            return KindStatus::NotAsked;
        }
        if let Some(u) = self.unreadable.iter().find(|u| u.source == source) {
            return KindStatus::Unreadable(u.reason.clone());
        }
        let limits: Vec<Note> = self.notes.iter().filter(|(s, _)| *s == source).map(|(_, n)| n.clone()).collect();
        let partial = self.partial.iter().find(|p| p.source == source);
        let coverage_gap = self.coverage_gaps.iter().find(|g| g.source == source).cloned();
        if partial.is_some() || coverage_gap.is_some() {
            return KindStatus::Partial {
                gaps: partial.map(|p| p.gaps.clone()).unwrap_or_default(),
                covered_from: partial.and_then(|p| p.covered_from).or(coverage_gap.as_ref().map(|g| g.to)),
                coverage_gap,
                limits,
            };
        }
        KindStatus::Complete { limits }
    }
}

/// Why a report could not be made at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) enum ChangeError {
    /// `t0 >= t1`: an inverted or empty window has nothing to say; it is not "no changes".
    EmptyWindow,
}

// ---------------------------------------------------------------------------------------------
// System tools: absolute path only
// ---------------------------------------------------------------------------------------------

/// The Windows system directory from `GetSystemDirectoryW` (not an environment variable).
fn system_directory() -> Option<PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    let mut buf = [0u16; 260];
    // SAFETY: the buffer outlives the call and its length is passed with it.
    let n = unsafe { windows::Win32::System::SystemInformation::GetSystemDirectoryW(Some(&mut buf)) } as usize;
    if n == 0 || n >= buf.len() {
        return None;
    }
    Some(PathBuf::from(std::ffi::OsString::from_wide(&buf[..n])))
}

/// Absolute path of a tool in the system directory, or `ToolMissing`. A bare name would be looked
/// up in compy.exe's own folder first, which a per-user install lets another program write to.
fn system_tool(name: &str) -> Result<PathBuf, UnreadableReason> {
    let p = system_directory().ok_or(UnreadableReason::ToolMissing)?.join(name);
    if p.is_absolute() && p.is_file() {
        Ok(p)
    } else {
        Err(UnreadableReason::ToolMissing)
    }
}

fn system_command(name: &str) -> Result<std::process::Command, UnreadableReason> {
    let path = system_tool(name)?;
    let s = path.to_str().ok_or(UnreadableReason::ToolMissing)?;
    Ok(crate::actions::quiet_command(s))
}

// ---------------------------------------------------------------------------------------------
// Budgeted child process + loop helpers
// ---------------------------------------------------------------------------------------------

struct RunOutput {
    stdout: Vec<u8>,
    /// More than the byte cap was written; the excess was dropped.
    overflow: bool,
    timed_out: bool,
    exit_code: Option<i32>,
    success: bool,
}

/// Run a child with piped output and a hard deadline. At the deadline the child is killed and
/// whatever it had already written is returned with `timed_out: true`. Its stderr is drained and
/// discarded: Windows' localised error text never reaches a user-visible reason.
fn run_with_budget(cmd: std::process::Command, budget: Duration) -> Result<RunOutput, UnreadableReason> {
    run_capped(cmd, budget, MAX_OUTPUT_BYTES)
}

/// Append at most `cap` bytes in total; true when something was dropped.
fn append_capped(buf: &mut Vec<u8>, chunk: &[u8], cap: usize) -> bool {
    let room = cap.saturating_sub(buf.len());
    buf.extend_from_slice(&chunk[..chunk.len().min(room)]);
    chunk.len() > room
}

fn run_capped(mut cmd: std::process::Command, budget: Duration, max_bytes: usize) -> Result<RunOutput, UnreadableReason> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|_| UnreadableReason::StartFailed)?;
    let out_buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let overflow = Arc::new(AtomicBool::new(false));
    let pump = |mut pipe: Box<dyn Read + Send>, buf: Option<Arc<Mutex<Vec<u8>>>>| {
        let overflow = overflow.clone();
        std::thread::spawn(move || {
            let mut chunk = [0u8; 16 * 1024];
            loop {
                match pipe.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if let Some(b) = &buf {
                            if let Ok(mut b) = b.lock() {
                                if append_capped(&mut b, &chunk[..n], max_bytes) {
                                    overflow.store(true, Ordering::Relaxed);
                                }
                            }
                        }
                    }
                }
            }
        })
    };
    let t_out = child.stdout.take().map(|p| pump(Box::new(p), Some(out_buf.clone())));
    let t_err = child.stderr.take().map(|p| pump(Box::new(p), None));

    let deadline = Instant::now() + budget;
    let (mut timed_out, mut success, mut exit_code) = (false, false, None);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                success = status.success();
                exit_code = status.code();
                break;
            }
            Ok(None) => {
                if Instant::now() >= deadline {
                    timed_out = true;
                    let _ = child.kill();
                    let _ = child.wait();
                    break;
                }
                std::thread::sleep(Duration::from_millis(4));
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                break;
            }
        }
    }
    if timed_out {
        // A grandchild may still hold the pipe open; do not wait for it, just take what arrived.
        std::thread::sleep(Duration::from_millis(15));
    } else {
        for t in [t_out, t_err].into_iter().flatten() {
            let _ = t.join();
        }
    }
    let stdout = out_buf.lock().map(|b| b.clone()).unwrap_or_default();
    Ok(RunOutput { stdout, overflow: overflow.load(Ordering::Relaxed), timed_out, exit_code, success })
}

/// Feed `iter` to `f` until the deadline; returns true if it stopped because time ran out.
fn collect_until<T, I: Iterator<Item = T>>(iter: I, deadline: Instant, mut f: impl FnMut(T)) -> bool {
    for item in iter {
        if Instant::now() >= deadline {
            return true;
        }
        f(item);
    }
    false
}

/// wevtutil's exit code is the Win32 error. Fixed reason codes; the text it prints is ignored.
fn reason_for_exit_code(code: Option<i32>) -> UnreadableReason {
    match code {
        Some(5) => UnreadableReason::AccessDenied,
        // ERROR_EVT_INVALID_CHANNEL_PATH / ERROR_EVT_CHANNEL_NOT_FOUND
        Some(15000) | Some(15007) => UnreadableReason::ChannelNotFound,
        other => UnreadableReason::QueryFailed(other),
    }
}

/// wevtutil writes ANSI/OEM text to a pipe, not UTF-8. Valid UTF-8 is taken as is (ASCII is both);
/// anything else is read byte-per-char. Either way non-ASCII text is flagged `text_uncertain`.
fn decode_console_text(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => bytes.iter().map(|&b| char::from(b)).collect(),
    }
}

/// A driver version: digits and dots only. Anything else (mojibake, markup) is not trusted.
fn clean_version(s: &str) -> Option<String> {
    let t = s.trim();
    (!t.is_empty() && t.chars().all(|c| c.is_ascii_digit() || c == '.')).then(|| t.to_string())
}

/// A Steam build id: digits only.
fn clean_build_id(s: &str) -> Option<String> {
    let t = s.trim();
    (!t.is_empty() && t.chars().all(|c| c.is_ascii_digit())).then(|| t.to_string())
}

fn text_is_uncertain(s: &str) -> bool {
    s.contains('?') || !s.is_ascii()
}

#[derive(Debug)]
struct LogText {
    xml: String,
    timed_out: bool,
    /// Output exceeded the byte cap.
    capped: bool,
}

/// Query one event-log channel with `wevtutil qe`, by absolute path (no elevation for
/// System-class channels). `xpath` None = no filter. Returns the decoded XML and whether the
/// budget ran out.
fn run_wevtutil(
    channel: &str,
    xpath: Option<&str>,
    count: usize,
    newest_first: bool,
    budget: Duration,
) -> Result<LogText, UnreadableReason> {
    let mut cmd = system_command("wevtutil.exe")?;
    cmd.arg("qe").arg(channel);
    if let Some(q) = xpath {
        cmd.arg(format!("/q:{q}"));
    }
    cmd.arg(format!("/c:{count}"))
        .arg(format!("/rd:{newest_first}"))
        .arg("/f:xml");
    let out = run_with_budget(cmd, budget)?;
    if !out.timed_out && !out.success {
        return Err(reason_for_exit_code(out.exit_code));
    }
    Ok(LogText { xml: decode_console_text(&out.stdout), timed_out: out.timed_out, capped: out.overflow })
}

/// `[since, until]` bounds for the event query, to the millisecond (lower floored, upper rounded
/// up a millisecond so the exact window filter applied later never loses a boundary row).
fn xpath_bounds(since: DateTime<Utc>, until: DateTime<Utc>) -> String {
    let lo = since.format("%Y-%m-%dT%H:%M:%S%.3fZ");
    let hi = (until + ChronoDuration::milliseconds(1)).format("%Y-%m-%dT%H:%M:%S%.3fZ");
    format!("(TimeCreated[@SystemTime>='{lo}'])and(TimeCreated[@SystemTime<='{hi}'])")
}

/// Pure: the event query for one provider/id over `[since, until]`.
fn event_query(provider: Option<&str>, id: u32, since: DateTime<Utc>, until: DateTime<Utc>) -> String {
    let prov = provider.map(|p| format!("Provider[@Name='{p}']and")).unwrap_or_default();
    format!("*[System[{prov}(EventID={id})and{}]]", xpath_bounds(since, until))
}

// ---------------------------------------------------------------------------------------------
// Tiny event-XML helpers (wevtutil /f:xml output; pure)
// ---------------------------------------------------------------------------------------------

/// The complete `<Event ...>...</Event>` blocks in `xml`. A truncated tail (killed reader) is
/// simply not returned.
fn event_blocks(xml: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(s) = rest.find("<Event") {
        let tail = &rest[s..];
        let next = tail.as_bytes().get(6).copied();
        if !matches!(next, Some(b' ' | b'>' | b'\n' | b'\r' | b'\t')) {
            rest = &rest[s + 6..];
            continue;
        }
        match tail.find("</Event>") {
            Some(e) => {
                out.push(&tail[..e + 8]);
                rest = &tail[e + 8..];
            }
            None => break,
        }
    }
    out
}

fn xml_unescape(s: &str) -> String {
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&")
}

/// `<tag ... attr='value' ...>` -> value.
fn xml_attr(block: &str, tag: &str, attr: &str) -> Option<String> {
    let start = block.find(&format!("<{tag} "))?;
    let end = start + block[start..].find('>')?;
    let head = &block[start..end];
    for q in ['\'', '"'] {
        let pat = format!("{attr}={q}");
        if let Some(i) = head.find(&pat) {
            let v = &head[i + pat.len()..];
            let j = v.find(q)?;
            return Some(xml_unescape(&v[..j]));
        }
    }
    None
}

/// `<Data Name='name'>value</Data>` -> value (`<Data Name='name'/>` -> empty).
fn xml_data(block: &str, name: &str) -> Option<String> {
    for q in ['\'', '"'] {
        let pat = format!("<Data Name={q}{name}{q}");
        if let Some(i) = block.find(&pat) {
            let after = &block[i + pat.len()..];
            let gt = after.find('>')?;
            if after[..gt].ends_with('/') {
                return Some(String::new());
            }
            let body = &after[gt + 1..];
            let e = body.find("</Data>")?;
            return Some(xml_unescape(&body[..e]));
        }
    }
    None
}

/// `<EventID>400</EventID>` (or with Qualifiers) -> 400.
fn xml_event_id(block: &str) -> Option<u32> {
    let i = block.find("<EventID")?;
    let after = &block[i..];
    let gt = after.find('>')?;
    let end = after[gt + 1..].find('<')?;
    after[gt + 1..gt + 1 + end].trim().parse().ok()
}

fn xml_event_time(block: &str) -> Option<DateTime<Utc>> {
    let t = xml_attr(block, "TimeCreated", "SystemTime")?;
    DateTime::parse_from_rfc3339(&t).ok().map(|d| d.with_timezone(&Utc))
}

// ---------------------------------------------------------------------------------------------
// Event-log read assessment (pure): partial / unreadable decisions in one place
// ---------------------------------------------------------------------------------------------

/// What a parser found in one query's output. `blocks` counts every `<Event>` block returned;
/// `items` the ones that carried every required field.
struct Parsed<T> {
    items: Vec<T>,
    blocks: usize,
    /// Oldest `TimeCreated` among all blocks (the query is newest-first, so this is how far back
    /// the output reached).
    oldest_row: Option<DateTime<Utc>>,
}

impl<T> Parsed<T> {
    fn malformed(&self) -> usize {
        self.blocks - self.items.len()
    }
}

fn parse_blocks<T>(xml: &str, one: impl Fn(&str) -> Option<T>) -> Parsed<T> {
    let blocks = event_blocks(xml);
    let oldest_row = blocks.iter().filter_map(|b| xml_event_time(b)).min();
    let items: Vec<T> = blocks.iter().filter_map(|b| one(b)).collect();
    Parsed { items, blocks: blocks.len(), oldest_row }
}

struct Assessed<T> {
    items: Vec<T>,
    covered_from: Option<DateTime<Utc>>,
    gaps: Vec<Gap>,
}

/// Pure: turn one query's parsed output into items + gaps, or `Unreadable`. Never `Ok` with no
/// items when the output could not be understood.
#[cfg(test)]
fn assess<T>(
    raw: &str,
    timed_out: bool,
    log_oldest: Option<DateTime<Utc>>,
    parsed: Parsed<T>,
) -> Result<Assessed<T>, UnreadableReason> {
    assess_with(raw, timed_out, false, log_oldest, parsed)
}

/// `assess` with the output-byte-cap flag.
fn assess_with<T>(
    raw: &str,
    timed_out: bool,
    capped: bool,
    log_oldest: Option<DateTime<Utc>>,
    parsed: Parsed<T>,
) -> Result<Assessed<T>, UnreadableReason> {
    let blank = raw.trim().is_empty();
    if parsed.blocks == 0 {
        if timed_out {
            return Err(UnreadableReason::TimedOutBeforeAnyRecord);
        }
        if !blank {
            return Err(UnreadableReason::RecordsUnreadable(0));
        }
    }
    let malformed = parsed.malformed();
    if parsed.blocks > 0 && malformed == parsed.blocks {
        return Err(UnreadableReason::RecordsUnreadable(malformed));
    }
    let mut gaps = Vec::new();
    let cap_hit = parsed.blocks > MAX_EVENTS;
    if timed_out {
        gaps.push(Gap::TimedOut);
    }
    if capped {
        gaps.push(Gap::OutputCapped);
    }
    if cap_hit {
        gaps.push(Gap::RowCapReached);
    }
    if malformed > 0 {
        gaps.push(Gap::MalformedRecords(malformed));
    }
    // After a timeout or the cap the read stopped at its oldest row; otherwise the log's own start.
    let covered_from = if timed_out || cap_hit || capped {
        match (log_oldest, parsed.oldest_row) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        }
    } else {
        log_oldest
    };
    Ok(Assessed { items: parsed.items, covered_from, gaps })
}

/// Pure: the oldest record of a channel from the unfiltered `/c:1 /rd:false` query.
fn parse_log_start(xml: &str) -> Result<DateTime<Utc>, UnreadableReason> {
    let blocks = event_blocks(xml);
    if blocks.is_empty() {
        return if xml.trim().is_empty() {
            Err(UnreadableReason::LogEmptyOrSwitchedOff)
        } else {
            Err(UnreadableReason::RecordsUnreadable(0))
        };
    }
    blocks
        .iter()
        .filter_map(|b| xml_event_time(b))
        .min()
        .ok_or(UnreadableReason::RecordsUnreadable(blocks.len()))
}

/// One channel: the log's own start (one unfiltered query), then the filtered rows, inside one
/// budget. A cleared or disabled log is `Unreadable`, not an empty read.
fn read_channel<T>(
    channel: &str,
    xpath: &str,
    budget: Duration,
    parse: impl Fn(&str) -> Parsed<T>,
) -> Result<Assessed<T>, UnreadableReason> {
    let deadline = Instant::now() + budget;
    let start = run_wevtutil(channel, None, 1, false, budget)?;
    if start.timed_out {
        return Err(UnreadableReason::TimedOutBeforeAnyRecord);
    }
    let log_oldest = parse_log_start(&start.xml)?;
    let remaining = deadline.saturating_duration_since(Instant::now());
    let q = run_wevtutil(channel, Some(xpath), QUERY_ROWS, true, remaining)?;
    assess_with(&q.xml, q.timed_out, q.capped, Some(log_oldest), parse(&q.xml))
}

fn read_ok_from(a: Assessed<ChangeEvent>) -> SourceRead {
    SourceRead::Read(ReadOk { events: a.items, covered_from: a.covered_from, gaps: a.gaps, notes: Vec::new() })
}

// ---------------------------------------------------------------------------------------------
// Drivers: Kernel-PnP/Configuration event 400
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
struct PnpRecord {
    at: DateTime<Utc>,
    instance_id: String,
    driver_name: Option<String>,
    class_guid: String,
    version: Option<String>,
    /// The version field held something other than digits and dots (not trusted).
    version_bad: bool,
    driver_date: Option<NaiveDate>,
    provider: Option<String>,
    updated: bool,
    status_ok: bool,
}

/// One event-400 block, or `None` when a required field is missing or renamed (counted as
/// malformed by the caller, never silently dropped).
fn parse_pnp_block(b: &str) -> Option<PnpRecord> {
    if xml_event_id(b)? != 400 {
        return None;
    }
    let at = xml_event_time(b)?;
    let instance_id = xml_data(b, "DeviceInstanceId").filter(|s| !s.is_empty())?;
    let class_guid = xml_data(b, "ClassGuid").filter(|s| !s.is_empty())?;
    let updated = xml_data(b, "DeviceUpdated")?;
    let version = xml_data(b, "DriverVersion")?;
    let status = xml_data(b, "Status").unwrap_or_default();
    let status_ok = status.is_empty() || u32::from_str_radix(status.trim_start_matches("0x"), 16) == Ok(0);
    Some(PnpRecord {
        at,
        instance_id,
        driver_name: xml_data(b, "DriverName").filter(|s| !s.is_empty()),
        class_guid,
        version: clean_version(&version),
        version_bad: !version.trim().is_empty() && clean_version(&version).is_none(),
        driver_date: xml_data(b, "DriverDate").and_then(|d| NaiveDate::parse_from_str(d.trim(), "%m/%d/%Y").ok()),
        provider: xml_data(b, "DriverProvider").filter(|s| !s.is_empty()),
        updated: updated.eq_ignore_ascii_case("true"),
        status_ok,
    })
}

fn parse_pnp(xml: &str) -> Parsed<PnpRecord> {
    parse_blocks(xml, parse_pnp_block)
}

/// Device-class GUID -> what the engine calls it. Software-component children (AMD's OpenCL /
/// Vulkan helper devices, ...) and every other class are not reported.
fn driver_class(guid: &str) -> Option<(ChangeKind, &'static str)> {
    let g = guid.trim().trim_matches(|c| c == '{' || c == '}').to_ascii_lowercase();
    DRIVER_CLASSES.iter().find(|(id, _, _)| *id == g).map(|(_, k, l)| (*k, *l))
}

/// The only driver classes reported (device-class GUID, kind, label).
const DRIVER_CLASSES: [(&str, ChangeKind, &str); 4] = [
    ("4d36e968-e325-11ce-bfc1-08002be10318", ChangeKind::GpuDriver, "display"),
    ("4d36e96c-e325-11ce-bfc1-08002be10318", ChangeKind::OtherDriver, "audio"),
    ("4d36e972-e325-11ce-bfc1-08002be10318", ChangeKind::OtherDriver, "network"),
    ("4d36e97d-e325-11ce-bfc1-08002be10318", ChangeKind::OtherDriver, "chipset/system"),
];

/// Instance id without its per-machine instance suffix: `PCI\VEN_1002&DEV_7550&...\6&2ef2...` ->
/// `PCI\VEN_1002&DEV_7550&...`.
fn hardware_id_of(instance_id: &str) -> String {
    // Bus\Device\Instance: drop Instance. Anything shorter has no instance suffix to drop.
    let parts: Vec<&str> = instance_id.split('\\').collect();
    if parts.len() >= 3 {
        parts[..parts.len() - 1].join("\\")
    } else {
        instance_id.to_string()
    }
}

#[derive(Default)]
struct DeviceState {
    cur: Option<String>,
    last_at: Option<DateTime<Utc>>,
    last_name: Option<String>,
}

/// Pure: driver installs from the raw configure records. Only `DeviceUpdated=true` rows with a
/// success status in a reported class count as installs; every row (updated or not) feeds the
/// "version before" lookup. Same device + inf + version within 10 minutes is one install.
/// `version_changed`: Some(true) real change (from_version set), Some(false) same version again,
/// None previous version unknown (first row of that device in the rows read).
fn driver_changes(mut recs: Vec<PnpRecord>) -> Vec<ChangeEvent> {
    recs.sort_by_key(|r| r.at);
    let mut states: HashMap<String, DeviceState> = HashMap::new();
    let mut out = Vec::new();
    for r in recs {
        let Some((kind, label)) = driver_class(&r.class_guid) else { continue };
        let st = states.entry(r.instance_id.clone()).or_default();
        let dup = st.cur.is_some()
            && st.cur == r.version
            && st.last_name == r.driver_name
            && st.last_at.is_some_and(|t| (r.at - t) <= ChronoDuration::seconds(DUP_SPAN_SECS));
        let (version_changed, from_version) = match (&st.cur, &r.version) {
            (Some(c), Some(v)) if c == v => (Some(false), None),
            (Some(c), Some(_)) => (Some(true), Some(c.clone())),
            _ => (None, None),
        };
        if r.version.is_some() {
            st.cur = r.version.clone();
        }
        st.last_at = Some(r.at);
        st.last_name = r.driver_name.clone();
        if !r.updated || !r.status_ok || dup {
            continue;
        }
        let mut detail = format!("{label} driver");
        if let Some(inf) = &r.driver_name {
            detail.push_str(&format!(", package {inf}"));
        }
        if let Some(d) = r.driver_date {
            detail.push_str(&format!(", driver dated {d}"));
        }
        match version_changed {
            Some(false) => detail.push_str(", same version configured again"),
            None => detail.push_str(", previous version unknown"),
            Some(true) => {}
        }
        let text_uncertain =
            text_is_uncertain(&detail) || r.provider.as_deref().is_some_and(text_is_uncertain) || r.version_bad;
        out.push(ChangeEvent {
            kind,
            when: ChangeTime::exact(r.at),
            what: ChangeWhat {
                name: r.provider.clone(),
                id: Some(hardware_id_of(&r.instance_id)),
                from_version,
                to_version: r.version.clone(),
                version_changed,
                detail: Some(detail),
                text_uncertain,
                ..ChangeWhat::default()
            },
            source: Source::DriverLog,
        });
    }
    out
}

/// Fixture seam: driver installs from raw wevtutil XML (malformed blocks are dropped here; the
/// readers count them).
#[cfg(test)]
pub(crate) fn driver_events_from_xml(xml: &str) -> Vec<ChangeEvent> {
    driver_changes(parse_pnp(xml).items)
}

/// Driver installs over `[since, until]` (look back further than the window you care about: the
/// extra rows are what let an event say which version it replaced).
pub(crate) fn read_driver_installs(since: DateTime<Utc>, until: DateTime<Utc>, budget: Duration) -> SourceRead {
    let q = event_query(None, 400, since, until);
    match read_channel("Microsoft-Windows-Kernel-PnP/Configuration", &q, budget, parse_pnp) {
        Ok(a) => {
            let mut r = read_ok_from(Assessed { items: driver_changes(a.items), covered_from: a.covered_from, gaps: a.gaps });
            if let SourceRead::Read(ok) = &mut r {
                ok.notes.push(Note::DriverClassesCovered(DRIVER_CLASSES.iter().map(|(_, _, l)| (*l).to_string()).collect()));
            }
            r
        }
        Err(r) => SourceRead::Unreadable(r),
    }
}

// ---------------------------------------------------------------------------------------------
// Windows Update: WindowsUpdateClient event 19
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
struct WuRecord {
    at: DateTime<Utc>,
    title: String,
}

fn parse_wu_block(b: &str) -> Option<WuRecord> {
    if xml_event_id(b)? != 19 {
        return None;
    }
    let title = xml_data(b, "updateTitle").map(|t| t.trim().to_string()).filter(|t| !t.is_empty())?;
    Some(WuRecord { at: xml_event_time(b)?, title })
}

fn parse_wu(xml: &str) -> Parsed<WuRecord> {
    parse_blocks(xml, parse_wu_block)
}

/// "KB5007651" from a title like "... - KB5007651 (Version ...)". Needs 6 to 8 digits.
fn kb_of(title: &str) -> Option<String> {
    let upper = title.to_ascii_uppercase();
    let mut from = 0;
    while let Some(i) = upper[from..].find("KB") {
        let start = from + i + 2;
        let digits: String = upper[start..].chars().take_while(|c| c.is_ascii_digit()).collect();
        if (6..=8).contains(&digits.len()) {
            return Some(format!("KB{digits}"));
        }
        from = start;
    }
    None
}

/// Coarse class from the (English) title; unrecognised titles are "other", never guessed further.
fn wu_class(title: &str) -> &'static str {
    let t = title.to_ascii_lowercase();
    let store_id = title.split_once('-').is_some_and(|(id, _)| {
        id.len() == 12 && id.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit())
    });
    if t.contains("security intelligence update") || t.contains("definition update") {
        "definition"
    } else if store_id {
        "store-app"
    } else if t.starts_with("feature update") {
        "feature"
    } else if t.contains("cumulative update") || t.contains("security update") || t.contains("servicing stack") {
        "quality"
    } else if t.contains("driver")
        || (title.split(" - ").count() >= 3
            && title.rsplit(" - ").next().is_some_and(|l| l.starts_with(|c: char| c.is_ascii_digit())))
    {
        "driver"
    } else {
        "other"
    }
}

/// Pure: update installs as change events, oldest first. The same title within a minute is one
/// install (Store packages log one row per architecture).
fn wu_changes(mut recs: Vec<WuRecord>) -> Vec<ChangeEvent> {
    recs.sort_by_key(|r| r.at);
    let mut last_seen: HashMap<String, DateTime<Utc>> = HashMap::new();
    let mut out = Vec::new();
    for r in recs {
        if last_seen.get(&r.title).is_some_and(|t| (r.at - *t) <= ChronoDuration::seconds(60)) {
            last_seen.insert(r.title.clone(), r.at);
            continue;
        }
        last_seen.insert(r.title.clone(), r.at);
        out.push(ChangeEvent {
            kind: ChangeKind::WindowsUpdate,
            when: ChangeTime::exact(r.at),
            what: ChangeWhat {
                kb: kb_of(&r.title),
                name: Some(r.title.clone()),
                detail: Some(wu_class(&r.title).to_string()),
                text_uncertain: text_is_uncertain(&r.title),
                ..ChangeWhat::default()
            },
            source: Source::WindowsUpdateLog,
        });
    }
    out
}

/// Fixture seam: update installs from raw wevtutil XML.
#[cfg(test)]
pub(crate) fn wu_events_from_xml(xml: &str) -> Vec<ChangeEvent> {
    wu_changes(parse_wu(xml).items)
}

pub(crate) fn read_windows_updates(since: DateTime<Utc>, until: DateTime<Utc>, budget: Duration) -> SourceRead {
    let q = event_query(Some("Microsoft-Windows-WindowsUpdateClient"), 19, since, until);
    match read_channel("System", &q, budget, parse_wu) {
        Ok(a) => read_ok_from(Assessed { items: wu_changes(a.items), covered_from: a.covered_from, gaps: a.gaps }),
        Err(r) => SourceRead::Unreadable(r),
    }
}

// ---------------------------------------------------------------------------------------------
// Game update: Steam appmanifest_<id>.acf
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
struct AcfInfo {
    app_id: u32,
    name: Option<String>,
    install_dir: Option<String>,
    build_id: Option<String>,
    target_build_id: Option<String>,
    /// A build id field held something other than digits (not trusted, dropped).
    ids_uncertain: bool,
    /// Epoch seconds (UTC) Steam last changed the game's files (update, verify or DLC).
    last_updated: Option<i64>,
}

/// `"key"<ws>"value"` -> (key, value); backslashes in values are doubled in VDF.
fn vdf_pair(line: &str) -> Option<(String, String)> {
    let rest = line.trim().strip_prefix('"')?;
    let k_end = rest.find('"')?;
    let key = &rest[..k_end];
    let after = rest[k_end + 1..].trim_start().strip_prefix('"')?;
    let v_end = after.rfind('"')?;
    Some((key.to_string(), after[..v_end].replace("\\\\", "\\")))
}

/// Pure: the top-level fields of an appmanifest. Nested blocks (UserConfig, InstalledDepots, ...)
/// are ignored. Anything without a numeric `appid` is `None`.
fn parse_acf(text: &str) -> Option<AcfInfo> {
    let mut depth = 0i32;
    let mut top: HashMap<String, String> = HashMap::new();
    for line in text.lines() {
        let t = line.trim();
        match t {
            "{" => depth += 1,
            "}" => depth -= 1,
            _ if depth == 1 => {
                if let Some((k, v)) = vdf_pair(t) {
                    top.insert(k.to_ascii_lowercase(), v);
                }
            }
            _ => {}
        }
    }
    let nonempty = |k: &str| top.get(k).map(|v| v.trim().to_string()).filter(|v| !v.is_empty());
    Some(AcfInfo {
        app_id: nonempty("appid")?.parse().ok()?,
        name: nonempty("name"),
        install_dir: nonempty("installdir"),
        build_id: nonempty("buildid").and_then(|v| clean_build_id(&v)),
        target_build_id: nonempty("targetbuildid").and_then(|v| clean_build_id(&v)),
        ids_uncertain: ["buildid", "targetbuildid"]
            .iter()
            .any(|k| nonempty(k).is_some_and(|v| clean_build_id(&v).is_none())),
        last_updated: nonempty("lastupdated").and_then(|v| v.parse::<i64>().ok()).filter(|s| *s > 0),
    })
}

const STEAM_COMMON: &str = "\\steamapps\\common\\";

/// `D:/Lib/` -> `d:\lib` (slashes, trailing separator and case folded).
fn normalize_root(s: &str) -> String {
    s.replace('/', "\\").trim_end_matches('\\').to_ascii_lowercase()
}

/// Pure: the folder name under `steamapps\common\` for an install dir, if it lives in one.
fn steam_install_folder(install_dir: &str) -> Option<String> {
    let norm = install_dir.replace('/', "\\");
    let lower = norm.to_ascii_lowercase();
    let i = lower.find(STEAM_COMMON)? + STEAM_COMMON.len();
    let folder = norm[i..].split('\\').next()?.trim();
    (!folder.is_empty()).then(|| folder.to_string())
}

/// Pure: the Steam library root an install dir sits under (`D:\Lib` for `D:\Lib\steamapps\common\X`).
fn library_root_of(install_dir: &str) -> Option<String> {
    let norm = install_dir.replace('/', "\\");
    let i = norm.to_ascii_lowercase().find(STEAM_COMMON)?;
    let root = normalize_root(&norm[..i]);
    (!root.is_empty()).then_some(root)
}

/// Pure: is this manifest (found under library `manifest_root`) the asked-about game? A game whose
/// install dir sits under another library root never matches a stale manifest in this one. Then
/// app id wins; else the install folder name.
fn manifest_matches(info: &AcfInfo, game: &GameRef, manifest_root: &str) -> bool {
    if let Some(want_root) = game.install_dir.as_deref().and_then(library_root_of) {
        if want_root != normalize_root(manifest_root) {
            return false;
        }
    }
    if let Some(id) = game.steam_app_id {
        return info.app_id == id;
    }
    match (game.install_dir.as_deref().and_then(steam_install_folder), info.install_dir.as_deref()) {
        (Some(want), Some(have)) => want.eq_ignore_ascii_case(have),
        _ => false,
    }
}

/// Pure: the game-update event from a manifest, or why there is none.
fn game_event_from_acf(info: &AcfInfo) -> Result<ChangeEvent, UnreadableReason> {
    let secs = info.last_updated.ok_or(UnreadableReason::SteamNoUpdateTime)?;
    let at = Utc.timestamp_opt(secs, 0).single().ok_or(UnreadableReason::SteamNoUpdateTime)?;
    let pending = match (&info.build_id, &info.target_build_id) {
        (Some(b), Some(t)) if b != t => Some(format!("an update to build {t} is pending")),
        _ => None,
    };
    Ok(ChangeEvent {
        kind: ChangeKind::GameUpdate,
        when: ChangeTime::exact(at),
        what: ChangeWhat {
            name: info.name.clone(),
            id: Some(info.app_id.to_string()),
            to_version: info.build_id.clone(),
            build_id: info.build_id.clone(),
            detail: pending,
            text_uncertain: info.ids_uncertain,
            ..ChangeWhat::default()
        },
        source: Source::SteamManifest,
    })
}

/// Steam root plus every library folder it lists; `vdf_unreadable` when the list could not be read
/// (then only the default root is searched).
struct SteamRoots {
    roots: Vec<String>,
    vdf_unreadable: bool,
}

fn steam_library_roots() -> Result<SteamRoots, UnreadableReason> {
    let steam: String = match winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey("Software\\Valve\\Steam")
        .and_then(|k| k.get_value::<String, _>("SteamPath"))
    {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(UnreadableReason::SteamNotFound),
        Err(_) => return Err(UnreadableReason::SteamUnreadable),
    };
    let steam = steam.replace('/', "\\");
    let steam = steam.trim_end_matches('\\').to_string();
    let vdf = format!("{steam}\\steamapps\\libraryfolders.vdf");
    let mut roots = vec![steam];
    let mut vdf_unreadable = false;
    match std::fs::read_to_string(&vdf) {
        Ok(body) => {
            for p in crate::hardware::parse_steam_library_paths(&body) {
                if !roots.iter().any(|r| r.eq_ignore_ascii_case(&p)) {
                    roots.push(p);
                }
            }
        }
        Err(_) => vdf_unreadable = true,
    }
    Ok(SteamRoots { roots, vdf_unreadable })
}

enum ManifestRead {
    /// No such file: the game is not recorded here.
    Missing,
    /// The file exists but could not be read or parsed (half-written, locked, too large).
    Unreadable,
    Parsed(AcfInfo),
}

fn read_manifest(path: &std::path::Path) -> ManifestRead {
    use std::io::ErrorKind::NotFound;
    match std::fs::metadata(path) {
        Err(e) if e.kind() == NotFound => ManifestRead::Missing,
        Err(_) => ManifestRead::Unreadable,
        Ok(m) if m.len() > 1_000_000 => ManifestRead::Unreadable,
        Ok(_) => match std::fs::read_to_string(path) {
            Err(e) if e.kind() == NotFound => ManifestRead::Missing,
            Err(_) => ManifestRead::Unreadable,
            Ok(s) => parse_acf(&s).map_or(ManifestRead::Unreadable, ManifestRead::Parsed),
        },
    }
}

fn is_manifest_name(e: &std::fs::DirEntry) -> bool {
    let n = e.file_name().to_string_lossy().to_ascii_lowercase();
    n.starts_with("appmanifest_") && n.ends_with(".acf")
}

/// Steam's record of when `game`'s files last changed. Anything that is not a readable Steam
/// install is `Unreadable` with a fixed reason (other launchers are not read in this slice).
/// "Not found" is only said when every library was readable.
pub(crate) fn read_game_update(game: &GameRef, budget: Duration) -> SourceRead {
    if let Some(l) = game.launcher.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
        if !l.eq_ignore_ascii_case("steam") {
            return SourceRead::Unreadable(UnreadableReason::NotSteamLauncher(l.to_string()));
        }
    }
    if game.steam_app_id.is_none() {
        match game.install_dir.as_deref() {
            None => return SourceRead::Unreadable(UnreadableReason::NoGameIdentified),
            Some(d) if steam_install_folder(d).is_none() => {
                return SourceRead::Unreadable(UnreadableReason::NotInSteamLibrary)
            }
            Some(_) => {}
        }
    }
    match steam_library_roots() {
        Ok(r) => find_in_libraries(&r.roots, r.vdf_unreadable, game, budget),
        Err(e) => SourceRead::Unreadable(e),
    }
}

/// Search the given Steam library roots for `game`'s manifest. "Not found" is only said when every
/// library and record could be read; otherwise the reason says what could not be read.
fn find_in_libraries(roots: &[String], vdf_unreadable: bool, game: &GameRef, budget: Duration) -> SourceRead {
    let deadline = Instant::now() + budget;
    let mut libs_unreadable = usize::from(vdf_unreadable);
    let mut records_unparsed = 0usize;
    let mut found: Option<AcfInfo> = None;
    let mut timed_out = false;
    'libs: for root in roots {
        let dir = std::path::Path::new(root).join("steamapps");
        if !dir.is_dir() {
            libs_unreadable += 1; // e.g. a library on a drive that is not connected
            continue;
        }
        if let Some(id) = game.steam_app_id {
            // Fast path: the manifest name is the app id.
            match read_manifest(&dir.join(format!("appmanifest_{id}.acf"))) {
                ManifestRead::Parsed(info) if manifest_matches(&info, game, root) => {
                    found = Some(info);
                    break 'libs;
                }
                ManifestRead::Unreadable => records_unparsed += 1,
                _ => {}
            }
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            libs_unreadable += 1;
            continue;
        };
        let mut hit = None;
        timed_out |= collect_until(entries.flatten().filter(is_manifest_name), deadline, |e| {
            if hit.is_some() {
                return;
            }
            match read_manifest(&e.path()) {
                ManifestRead::Parsed(info) if manifest_matches(&info, game, root) => hit = Some(info),
                ManifestRead::Unreadable => records_unparsed += 1,
                _ => {}
            }
        });
        if hit.is_some() {
            found = hit;
            break 'libs;
        }
        if timed_out {
            break;
        }
    }
    match found {
        Some(info) => match game_event_from_acf(&info) {
            Ok(ev) => {
                let mut ok = ReadOk {
                    events: vec![ev],
                    covered_from: None,
                    gaps: Vec::new(),
                    notes: vec![Note::SteamUpdateTimeIsFileChange],
                };
                if libs_unreadable > 0 {
                    ok.gaps.push(Gap::SteamLibrariesUnreadable(libs_unreadable));
                }
                SourceRead::Read(ok)
            }
            Err(e) => SourceRead::Unreadable(e),
        },
        None if timed_out => SourceRead::Unreadable(UnreadableReason::TimedOutBeforeAnyRecord),
        None if libs_unreadable > 0 || records_unparsed > 0 => {
            SourceRead::Unreadable(UnreadableReason::SteamPartiallyUnreadable {
                libraries: libs_unreadable,
                records: records_unparsed,
            })
        }
        None => SourceRead::Unreadable(UnreadableReason::SteamGameNotFound),
    }
}

/// Whether Compy could place a game (known only by its process name) in a Steam library.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SteamLookup {
    Found(GameRef),
    /// Every library Compy could read has no folder that holds this program, or Steam is not installed.
    /// It is not proof that the game is not Steam's: the match needs the program inside the install folder.
    NotInSteam,
    Unreadable(UnreadableReason),
}

/// Pure: a program's file name reduced to the part a game's folder is named after
/// ("LANESPLIT-Win64-Shipping.exe" -> "lanesplit", "ROB RUN.exe" -> "robrun").
fn exe_stem_key(exe: &str) -> String {
    let lower = exe.trim().to_ascii_lowercase();
    let mut s = lower.strip_suffix(".exe").unwrap_or(&lower).to_string();
    for suffix in ["-win64-shipping", "-win32-shipping", "-wingdk-shipping", "-shipping", "_win64", "-win64", "_x64", "-x64", "_64"] {
        if let Some(t) = s.strip_suffix(suffix) {
            s = t.to_string();
            break;
        }
    }
    s.chars().filter(char::is_ascii_alphanumeric).collect()
}

/// Pure: can a Steam install folder named `folder` plausibly hold the program whose key is `key`?
/// Equal, or one a prefix of the other when both are long enough to mean something. The program is
/// then looked for inside the folder; the name alone never decides.
fn folder_may_hold(key: &str, folder: &str) -> bool {
    let fk: String = folder.to_ascii_lowercase().chars().filter(char::is_ascii_alphanumeric).collect();
    if key.is_empty() || fk.is_empty() {
        return false;
    }
    fk == key || (key.len().min(fk.len()) >= 4 && (fk.starts_with(key) || key.starts_with(&fk)))
}

/// Is a file named `exe` anywhere inside `dir` (a few levels deep, bounded in entries and time)?
fn folder_holds_exe(dir: &std::path::Path, exe: &str, deadline: Instant) -> bool {
    const MAX_DEPTH: usize = 4;
    const MAX_ENTRIES: usize = 4000;
    let mut stack = vec![(dir.to_path_buf(), 0usize)];
    let mut seen = 0usize;
    while let Some((d, depth)) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            seen += 1;
            if seen > MAX_ENTRIES || Instant::now() >= deadline {
                return false;
            }
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() {
                if depth < MAX_DEPTH {
                    stack.push((e.path(), depth + 1));
                }
            } else if e.file_name().to_string_lossy().eq_ignore_ascii_case(exe.trim()) {
                return true;
            }
        }
    }
    false
}

/// Which Steam game owns this program? Read-only: the library list, the manifests and the install
/// folders. Sessions record only the process name, so this is how a game's Steam record is found.
pub(crate) fn find_steam_game(exe: &str, budget: Duration) -> SteamLookup {
    let exe = exe.to_string();
    run_bounded(budget, move || match steam_library_roots() {
        Ok(r) => find_game_in_roots(&r.roots, r.vdf_unreadable, &exe, budget),
        Err(UnreadableReason::SteamNotFound) => SteamLookup::NotInSteam,
        Err(e) => SteamLookup::Unreadable(e),
    })
}

/// Entries read from one library's `steamapps` folder at most (a real library holds a few hundred files).
pub(crate) const STEAM_DIR_ENTRY_CAP: usize = 5000;
/// Grace after the lookup's own budget before the caller gives up on the thread (a read of an unreachable
/// or sleeping drive can block inside the operating system, past any deadline the loop checks).
pub(crate) const STEAM_HARD_MARGIN: Duration = Duration::from_millis(250);

/// Runs the lookup on its own thread and waits at most `budget` plus `STEAM_HARD_MARGIN`. A drive that
/// never answers leaves the thread behind and the answer is "couldn't match", never a hang.
pub(crate) fn run_bounded<F>(budget: Duration, f: F) -> SteamLookup
where
    F: FnOnce() -> SteamLookup + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();
    let spawned = std::thread::Builder::new().name("paramedic-steam".into()).spawn(move || {
        let _ = tx.send(f());
    });
    if spawned.is_err() {
        return SteamLookup::NotInSteam;
    }
    rx.recv_timeout(budget + STEAM_HARD_MARGIN).unwrap_or(SteamLookup::NotInSteam)
}

fn find_game_in_roots(roots: &[String], vdf_unreadable: bool, exe: &str, budget: Duration) -> SteamLookup {
    let key = exe_stem_key(exe);
    if key.len() < 3 {
        return SteamLookup::NotInSteam;
    }
    let deadline = Instant::now() + budget;
    let mut libs_unreadable = usize::from(vdf_unreadable);
    let mut records_unparsed = 0usize;
    let mut timed_out = false;
    let mut hits: Vec<GameRef> = Vec::new();
    for root in roots {
        let steamapps = std::path::Path::new(root).join("steamapps");
        let Ok(entries) = std::fs::read_dir(&steamapps) else {
            libs_unreadable += 1;
            continue;
        };
        timed_out |= collect_until(entries.flatten().take(STEAM_DIR_ENTRY_CAP).filter(is_manifest_name), deadline, |e| {
            match read_manifest(&e.path()) {
                ManifestRead::Parsed(info) => {
                    if let Some(folder) = info.install_dir.as_deref().filter(|f| folder_may_hold(&key, f)) {
                        let dir = steamapps.join("common").join(folder);
                        if folder_holds_exe(&dir, exe, deadline) {
                            hits.push(GameRef {
                                steam_app_id: Some(info.app_id),
                                install_dir: Some(dir.to_string_lossy().into_owned()),
                                launcher: Some("Steam".into()),
                            });
                        }
                    }
                }
                ManifestRead::Unreadable => records_unparsed += 1,
                ManifestRead::Missing => {}
            }
        });
        if timed_out {
            break;
        }
    }
    // Two folders holding the same program name (two libraries, or "Game.exe" in two games) is never
    // guessed at: Compy says it could not match the game.
    match hits.len() {
        1 => return SteamLookup::Found(hits.remove(0)),
        n if n > 1 => return SteamLookup::NotInSteam,
        _ => {}
    }
    match () {
        () if timed_out => SteamLookup::Unreadable(UnreadableReason::TimedOutBeforeAnyRecord),
        () if libs_unreadable > 0 || records_unparsed > 0 => {
            SteamLookup::Unreadable(UnreadableReason::SteamPartiallyUnreadable { libraries: libs_unreadable, records: records_unparsed })
        }
        () => SteamLookup::NotInSteam,
    }
}

/// Every installed Steam game with a readable update time. For callers that want to enumerate, and
/// for the real-PC check.
#[cfg(test)]
pub(crate) fn read_all_steam_games(budget: Duration) -> Result<Vec<ChangeEvent>, UnreadableReason> {
    let SteamRoots { roots, .. } = steam_library_roots()?;
    let deadline = Instant::now() + budget;
    let mut out = Vec::new();
    for root in &roots {
        let Ok(entries) = std::fs::read_dir(std::path::Path::new(root).join("steamapps")) else { continue };
        let stopped = collect_until(entries.flatten().filter(is_manifest_name), deadline, |e| {
            if let ManifestRead::Parsed(info) = read_manifest(&e.path()) {
                if let Ok(ev) = game_event_from_acf(&info) {
                    out.push(ev);
                }
            }
        });
        if stopped {
            break;
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------------------------
// Installed programs: registry Uninstall keys (InstallDate = LOCAL calendar date)
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct UninstallFields {
    display_name: Option<String>,
    display_version: Option<String>,
    /// Raw value, normally "yyyymmdd".
    install_date: Option<String>,
    system_component: bool,
    /// Has a `ParentKeyName`: a patch to another product, not a program of its own.
    is_patch: bool,
}

/// "20261119" -> 2026-11-19. Rejects anything else, and years before 1990.
fn parse_install_date(raw: &str) -> Option<NaiveDate> {
    let s = raw.trim();
    if s.len() != 8 || !s.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let d = NaiveDate::parse_from_str(s, "%Y%m%d").ok()?;
    (d >= NaiveDate::from_ymd_opt(1990, 1, 1)?).then_some(d)
}

/// First instant of local `date` that exists in the zone `resolve` describes. Local midnight does
/// not exist where daylight saving starts at 00:00 (the clock jumps to 01:00): then the day starts
/// at its first valid time, and the row is never dropped.
fn first_instant_of_day(resolve: &dyn Fn(NaiveDateTime) -> Option<DateTime<Utc>>, date: NaiveDate) -> Option<DateTime<Utc>> {
    let midnight = date.and_hms_opt(0, 0, 0)?;
    (0..96).find_map(|i| {
        let t = midnight + ChronoDuration::minutes(15 * i);
        if t.date() != date {
            return None;
        }
        resolve(t)
    })
}

/// `[first instant of local day, first instant of next local day)` in UTC for `date`.
fn day_window_with(
    resolve: &dyn Fn(NaiveDateTime) -> Option<DateTime<Utc>>,
    date: NaiveDate,
) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    Some((first_instant_of_day(resolve, date)?, first_instant_of_day(resolve, date.succ_opt()?)?))
}

fn day_window_in<Tz: TimeZone>(tz: &Tz, date: NaiveDate) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    day_window_with(&|n| tz.from_local_datetime(&n).earliest().map(|d| d.with_timezone(&Utc)), date)
}

enum UninstallOutcome {
    Event(Box<ChangeEvent>),
    /// A real program the registry gives no usable install date for.
    NoDate,
    /// System component, patch or nameless: not a program of the user's.
    Skipped,
}

type DayWindowFn<'a> = &'a dyn Fn(NaiveDate) -> Option<(DateTime<Utc>, DateTime<Utc>)>;

fn uninstall_outcome(f: &UninstallFields, day_window: DayWindowFn<'_>) -> UninstallOutcome {
    if f.system_component || f.is_patch {
        return UninstallOutcome::Skipped;
    }
    let Some(name) = f.display_name.as_deref().map(str::trim).filter(|n| !n.is_empty()) else {
        return UninstallOutcome::Skipped;
    };
    let Some(date) = f.install_date.as_deref().and_then(parse_install_date) else {
        return UninstallOutcome::NoDate;
    };
    let Some((start, end)) = day_window(date) else {
        return UninstallOutcome::NoDate;
    };
    UninstallOutcome::Event(Box::new(ChangeEvent {
        kind: ChangeKind::ProgramInstalled,
        when: ChangeTime::day(start, end),
        what: ChangeWhat {
            name: Some(name.to_string()),
            to_version: f.display_version.clone().filter(|v| !v.trim().is_empty()),
            detail: Some(format!("installer-reported install date {date} (that local day)")),
            ..ChangeWhat::default()
        },
        source: Source::UninstallKeys,
    }))
}

/// Pure (zone injected): one Uninstall entry as a program-installed event, or `None`.
#[cfg(test)]
fn uninstall_event(f: &UninstallFields, day_window: DayWindowFn<'_>) -> Option<ChangeEvent> {
    match uninstall_outcome(f, day_window) {
        UninstallOutcome::Event(e) => Some(*e),
        _ => None,
    }
}

struct UninstallScan {
    events: Vec<ChangeEvent>,
    timed_out: bool,
    without_date: usize,
    /// Entries that could not be opened (`None` in the stream).
    unreadable_keys: usize,
}

/// Pure: events from a stream of entries, stopping at the deadline. Same name + version + day in
/// two registry views is one program. Programs with no usable date are counted, not dropped.
fn collect_uninstall<I: Iterator<Item = Option<UninstallFields>>>(
    entries: I,
    deadline: Instant,
    day_window: DayWindowFn<'_>,
) -> UninstallScan {
    let mut events: Vec<ChangeEvent> = Vec::new();
    let mut without_date = 0;
    let mut seen: HashSet<(String, Option<String>, Option<DateTime<Utc>>)> = HashSet::new();
    let mut unreadable_keys = 0usize;
    let timed_out = collect_until(entries, deadline, |f| match f.map(|f| uninstall_outcome(&f, day_window)) {
        None => unreadable_keys += 1,
        Some(UninstallOutcome::Event(ev)) => {
            let ev = *ev;
            let key = (ev.what.name.clone().unwrap_or_default(), ev.what.to_version.clone(), ev.when.at);
            if seen.insert(key) {
                events.push(ev);
            }
        }
        Some(UninstallOutcome::NoDate) => without_date += 1,
        Some(UninstallOutcome::Skipped) => {}
    });
    UninstallScan { events, timed_out, without_date, unreadable_keys }
}

#[derive(Clone, Copy)]
enum Hive {
    Machine,
    User,
}

const UNINSTALL_PATHS: [(Hive, &str); 3] = [
    (Hive::Machine, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
    (Hive::Machine, "SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
    (Hive::User, "SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall"),
];

fn open_hive(h: Hive) -> winreg::RegKey {
    match h {
        Hive::Machine => winreg::RegKey::predef(winreg::enums::HKEY_LOCAL_MACHINE),
        Hive::User => winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER),
    }
}

fn read_uninstall_fields(hive: Hive, path: &str, sub: &str) -> Option<UninstallFields> {
    let key = open_hive(hive)
        .open_subkey_with_flags(format!("{path}\\{sub}"), winreg::enums::KEY_READ)
        .ok()?;
    let install_date = key
        .get_value::<String, _>("InstallDate")
        .ok()
        .or_else(|| key.get_value::<u32, _>("InstallDate").ok().map(|n| n.to_string()));
    Some(UninstallFields {
        display_name: key.get_value::<String, _>("DisplayName").ok(),
        display_version: key.get_value::<String, _>("DisplayVersion").ok(),
        install_date,
        system_component: key.get_value::<u32, _>("SystemComponent").is_ok_and(|v| v == 1),
        is_patch: key.get_value::<String, _>("ParentKeyName").is_ok(),
    })
}

/// Programs the registry says were installed (any date; the combiner applies the window). Only
/// programs that record an install date are listed; the rest are counted in a note, and Store/MSIX
/// apps are not in these keys at all.
pub(crate) fn read_installed_programs(budget: Duration) -> SourceRead {
    let deadline = Instant::now() + budget;
    let mut names: Vec<(Hive, &'static str, String)> = Vec::new();
    let mut unreadable_keys = 0usize;
    for (i, (hive, path)) in UNINSTALL_PATHS.iter().enumerate() {
        match open_hive(*hive).open_subkey_with_flags(path, winreg::enums::KEY_READ) {
            Ok(k) => {
                for r in k.enum_keys() {
                    match r {
                        Ok(n) => names.push((*hive, path, n)),
                        Err(_) => unreadable_keys += 1,
                    }
                }
            }
            Err(e) => match hive_open_effect(i == 0, e.kind()) {
                Ok(n) => unreadable_keys += n,
                Err(reason) => return SourceRead::Unreadable(reason),
            },
        }
    }
    let entries = names.into_iter().map(|(h, p, n)| read_uninstall_fields(h, p, &n));
    let scan = collect_uninstall(entries, deadline, &|d| day_window_in(&chrono::Local, d));
    let failed = unreadable_keys + scan.unreadable_keys;
    let mut notes = vec![Note::StoreAppsNotCovered];
    if scan.without_date > 0 {
        notes.push(Note::ProgramsWithoutDate(scan.without_date));
    }
    let mut read = SourceRead::finish(scan.events, scan.timed_out, notes);
    if failed > 0 {
        if let SourceRead::Read(ok) = &mut read {
            ok.gaps.push(Gap::RegistryKeysUnreadable(failed));
        }
    }
    read
}

/// What a failed open of one Uninstall key set means: the main 64-bit machine key failing makes
/// the whole source unreadable (another hive working does not make up for it); a missing optional
/// key is normal; any other failure is counted as an unreadable key.
fn hive_open_effect(is_main: bool, kind: std::io::ErrorKind) -> Result<usize, UnreadableReason> {
    if is_main {
        return Err(UnreadableReason::RegistryUnreadable);
    }
    Ok(usize::from(kind != std::io::ErrorKind::NotFound))
}

// ---------------------------------------------------------------------------------------------
// Combiner
// ---------------------------------------------------------------------------------------------

fn kind_rank(k: ChangeKind) -> u8 {
    match k {
        ChangeKind::GpuDriver => 0,
        ChangeKind::OtherDriver => 1,
        ChangeKind::WindowsUpdate => 2,
        ChangeKind::GameUpdate => 3,
        ChangeKind::ProgramInstalled => 4,
    }
}

/// Pure: merge reader outcomes into one report for the window `(t0, t1]` (lower bound exclusive,
/// upper inclusive; see `ChangeTime::in_window`). Unreadable sources, incomplete reads and the part
/// of the window a log does not reach are listed, never dropped.
/// The window must be non-empty (`t0 < t1`); otherwise `EmptyWindow`.
pub(crate) fn combine(t0: DateTime<Utc>, t1: DateTime<Utc>, reads: Vec<(Source, SourceRead)>) -> Result<ChangeReport, ChangeError> {
    if t0 >= t1 {
        return Err(ChangeError::EmptyWindow);
    }
    Ok(combine_unchecked(t0, t1, reads))
}

fn combine_unchecked(t0: DateTime<Utc>, t1: DateTime<Utc>, reads: Vec<(Source, SourceRead)>) -> ChangeReport {
    let asked: Vec<Source> = reads.iter().map(|(s, _)| *s).collect();
    let mut events: Vec<ChangeEvent> = Vec::new();
    let mut unreadable = Vec::new();
    let mut partial = Vec::new();
    let mut coverage_gaps = Vec::new();
    let mut notes = Vec::new();
    let mut game_last_update: Option<ChangeEvent> = None;
    let mut undated_excluded = 0;
    for (source, read) in reads {
        match read {
            SourceRead::Unreadable(reason) => unreadable.push(UnreadableSource { source, reason }),
            SourceRead::Read(ok) => {
                // A row cap or timeout only matters when the read stopped inside the window; if it
                // reached back to t0 the window was fully covered anyway.
                let reached_window_start = ok.covered_from.is_some_and(|c| c <= t0);
                let gaps: Vec<Gap> = ok
                    .gaps
                    .iter()
                    .filter(|g| !(reached_window_start && matches!(g, Gap::RowCapReached | Gap::TimedOut | Gap::OutputCapped)))
                    .cloned()
                    .collect();
                if !gaps.is_empty() {
                    partial.push(PartialSource { source, gaps, covered_from: ok.covered_from });
                }
                if let Some(from) = ok.covered_from {
                    if from > t0 {
                        coverage_gaps.push(CoverageGap { source, from: t0, to: from });
                    }
                }
                notes.extend(ok.notes.iter().cloned().map(|n| (source, n)));
                for ev in ok.events {
                    if ev.kind == ChangeKind::GameUpdate
                        && game_last_update.as_ref().is_none_or(|g| ev.when.at > g.when.at)
                    {
                        game_last_update = Some(ev.clone());
                    }
                    if ev.when.in_window(t0, t1) {
                        events.push(ev);
                    } else if ev.when.precision == Precision::Unknown {
                        undated_excluded += 1;
                    }
                }
            }
        }
    }
    events.sort_by(|a, b| {
        (a.when.at, kind_rank(a.kind), &a.what.name).cmp(&(b.when.at, kind_rank(b.kind), &b.what.name))
    });
    ChangeReport {
        window_start: t0,
        window_end: t1,
        asked,
        events_found: events,
        unreadable,
        partial,
        coverage_gaps,
        notes,
        game_last_update,
        undated_excluded,
    }
}

/// What changed on this PC in `(t0, t1]`: runs every reader (in parallel, each with its own
/// budget) and combines them. `game` adds the Steam lookup for that game. Never panics: a reader
/// that dies is reported as unreadable.
pub(crate) fn changes_between(
    t0: DateTime<Utc>,
    t1: DateTime<Utc>,
    game: Option<&GameRef>,
) -> Result<ChangeReport, ChangeError> {
    changes_between_with(t0, t1, game, DEFAULT_BUDGET)
}

pub(crate) fn changes_between_with(
    t0: DateTime<Utc>,
    t1: DateTime<Utc>,
    game: Option<&GameRef>,
    budget: Duration,
) -> Result<ChangeReport, ChangeError> {
    if t0 >= t1 {
        return Err(ChangeError::EmptyWindow);
    }
    let lost = || SourceRead::Unreadable(UnreadableReason::ReaderStopped);
    let reads = std::thread::scope(|s| {
        let drivers =
            s.spawn(move || read_driver_installs(t0 - ChronoDuration::days(DRIVER_LOOKBACK_DAYS), t1, budget));
        let updates = s.spawn(move || read_windows_updates(t0, t1, budget));
        let programs = s.spawn(move || read_installed_programs(budget));
        let game_read = game.map(|g| s.spawn(move || read_game_update(g, budget)));
        let mut reads = vec![
            (Source::DriverLog, drivers.join().unwrap_or_else(|_| lost())),
            (Source::WindowsUpdateLog, updates.join().unwrap_or_else(|_| lost())),
            (Source::UninstallKeys, programs.join().unwrap_or_else(|_| lost())),
        ];
        if let Some(h) = game_read {
            reads.push((Source::SteamManifest, h.join().unwrap_or_else(|_| lost())));
        }
        reads
    });
    combine(t0, t1, reads)
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;

    const DISPLAY: &str = "{4d36e968-e325-11ce-bfc1-08002be10318}";
    const MEDIA: &str = "{4d36e96c-e325-11ce-bfc1-08002be10318}";
    const SWCOMP: &str = "{5c4c3332-344d-483c-8739-259e934c9cc8}";
    const GPU_INST: &str = "PCI\\VEN_1002&amp;DEV_7550&amp;SUBSYS_88111EAE&amp;REV_C0\\6&amp;2ef27d03&amp;0&amp;00000009";

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    #[allow(clippy::too_many_arguments)] // a fixture builder: one parameter per event field
    fn pnp(time: &str, inst: &str, inf: &str, class: &str, ver: &str, date: &str, updated: bool, status: &str) -> String {
        format!(
            "<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System>\
<Provider Name='Microsoft-Windows-Kernel-PnP' Guid='{{9c205a39-1250-487d-abd7-e831c6290539}}'/>\
<EventID>400</EventID><Version>1</Version><Level>4</Level>\
<TimeCreated SystemTime='{time}'/><EventRecordID>1</EventRecordID><Channel>Microsoft-Windows-Kernel-PnP/Configuration</Channel>\
</System><EventData><Data Name='DeviceInstanceId'>{inst}</Data><Data Name='DriverName'>{inf}</Data>\
<Data Name='ClassGuid'>{class}</Data><Data Name='DriverDate'>{date}</Data><Data Name='DriverVersion'>{ver}</Data>\
<Data Name='DriverProvider'>Advanced Micro Devices, Inc.</Data><Data Name='DriverInbox'>false</Data>\
<Data Name='OutrankedDrivers'>oem9.inf:PCI\\VEN_1002&amp;DEV_7550:00CF0000</Data>\
<Data Name='DeviceUpdated'>{updated}</Data><Data Name='Status'>{status}</Data>\
<Data Name='ParentDeviceInstanceId'/></EventData></Event>\n"
        )
    }

    fn wu(time: &str, title: &str) -> String {
        format!(
            "<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System>\
<Provider Name='Microsoft-Windows-WindowsUpdateClient' Guid='{{945a8954-c147-4acd-923f-40c45405a658}}'/>\
<EventID>19</EventID><TimeCreated SystemTime='{time}'/></System><EventData>\
<Data Name='updateTitle'>{title}</Data><Data Name='updateGuid'>{{c809da48-75dc-470e-b669-9ba3cc9fcb07}}</Data>\
<Data Name='updateRevisionNumber'>200</Data></EventData></Event>\n"
        )
    }

    // ---- drivers --------------------------------------------------------------------------

    #[test]
    fn gpu_driver_install_is_exact_utc_and_names_the_replaced_version() {
        let xml = [
            pnp("2026-10-22T01:11:33.1954634Z", GPU_INST, "oem46.inf", DISPLAY, "32.0.32015.7029", "10/18/2026", true, "0x0"),
            pnp("2026-11-19T13:38:22.6390698Z", GPU_INST, "oem3.inf", DISPLAY, "32.0.32029.2010", "11/18/2026", true, "0x0"),
        ]
        .concat();
        let evs = driver_events_from_xml(&xml);
        assert_eq!(evs.len(), 2);
        let last = &evs[1];
        assert_eq!(last.kind, ChangeKind::GpuDriver);
        assert_eq!(last.when.precision, Precision::Exact);
        assert_eq!(last.when.at, Some(utc("2026-11-19T13:38:22.6390698Z")));
        assert_eq!(last.what.from_version.as_deref(), Some("32.0.32015.7029"));
        assert_eq!(last.what.to_version.as_deref(), Some("32.0.32029.2010"));
        assert_eq!(last.what.id.as_deref(), Some("PCI\\VEN_1002&DEV_7550&SUBSYS_88111EAE&REV_C0"));
        assert!(last.what.detail.as_deref().unwrap().contains("driver dated 2026-11-18"));
        assert_eq!(last.source, Source::DriverLog);
        assert_eq!(evs[0].what.from_version, None, "nothing earlier was read");
    }

    #[test]
    fn real_captured_gpu_event_parses() {
        // Verbatim shape from this PC's Kernel-PnP/Configuration log (computer name removed).
        let xml = "<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Microsoft-Windows-Kernel-PnP' Guid='{9c205a39-1250-487d-abd7-e831c6290539}'/><EventID>400</EventID><Version>1</Version><Level>4</Level><Task>0</Task><Opcode>0</Opcode><Keywords>0x4000000000000000</Keywords><TimeCreated SystemTime='2026-11-19T13:38:22.6390698Z'/><EventRecordID>2078</EventRecordID><Correlation/><Execution ProcessID='4' ThreadID='32992'/><Channel>Microsoft-Windows-Kernel-PnP/Configuration</Channel><Security UserID='S-1-5-18'/></System><EventData><Data Name='DeviceInstanceId'>PCI\\VEN_1002&amp;DEV_7550&amp;SUBSYS_88111EAE&amp;REV_C0\\6&amp;2ef27d03&amp;0&amp;00000009</Data><Data Name='DriverName'>oem3.inf</Data><Data Name='ClassGuid'>{4d36e968-e325-11ce-bfc1-08002be10318}</Data><Data Name='DriverDate'>11/18/2026</Data><Data Name='DriverVersion'>32.0.32029.2010</Data><Data Name='DriverProvider'>Advanced Micro Devices, Inc.</Data><Data Name='DriverInbox'>false</Data><Data Name='DriverSection'>ati2mtag_Navi48</Data><Data Name='DriverRank'>0xcf0000</Data><Data Name='DeviceUpdated'>true</Data><Data Name='Status'>0x0</Data><Data Name='DriverPackageId'>u0206168.inf_amd64_1fdbc918cb04eef5</Data></EventData></Event>";
        let evs = driver_events_from_xml(xml);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].what.to_version.as_deref(), Some("32.0.32029.2010"));
        assert_eq!(evs[0].what.name.as_deref(), Some("Advanced Micro Devices, Inc."));
    }

    #[test]
    fn other_driver_classes_and_filters() {
        let xml = [
            pnp("2026-11-19T13:38:30.0Z", "HDAUDIO\\FUNC_01&amp;VEN_1002\\7&amp;26502276&amp;0&amp;0001", "oem19.inf", MEDIA, "10.0.1.20", "09/01/2026", true, "0x0"),
            // Boot-time reconfigure, not an update.
            pnp("2026-11-19T13:40:00.0Z", "HDAUDIO\\FUNC_01&amp;VEN_1002\\7&amp;aaaa&amp;0&amp;0001", "oem19.inf", MEDIA, "10.0.1.20", "09/01/2026", false, "0x0"),
            // Software-component child of the GPU package: not reported.
            pnp("2026-11-19T13:38:27.0Z", "SWD\\DRIVERENUM\\AMDVLK&amp;7&amp;3726f32a&amp;2", "oem68.inf", SWCOMP, "32.0.32029.2010", "11/18/2026", true, "0x0"),
            // Failed install status.
            pnp("2026-11-19T13:41:00.0Z", "PCI\\VEN_1&amp;DEV_2\\3&amp;4", "oem70.inf", MEDIA, "1.0", "01/01/2026", true, "0xc0000001"),
        ]
        .concat();
        let evs = driver_events_from_xml(&xml);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].kind, ChangeKind::OtherDriver);
        assert!(evs[0].what.detail.as_deref().unwrap().starts_with("audio driver"));
    }

    #[test]
    fn duplicate_configures_collapse_but_a_later_reinstall_does_not() {
        let a = "PCI\\VEN_1&amp;DEV_2\\3&amp;4";
        let xml = [
            pnp("2026-11-19T13:00:00.0Z", a, "oem3.inf", DISPLAY, "1.0", "01/01/2026", true, "0x0"),
            pnp("2026-11-19T13:00:05.0Z", a, "oem3.inf", DISPLAY, "1.0", "01/01/2026", true, "0x0"),
            pnp("2026-11-19T15:00:00.0Z", a, "oem3.inf", DISPLAY, "1.0", "01/01/2026", true, "0x0"),
        ]
        .concat();
        let evs = driver_events_from_xml(&xml);
        assert_eq!(evs.len(), 2);
        assert!(evs[1].what.detail.as_deref().unwrap().contains("same version configured again"));
    }

    #[test]
    fn driver_parser_survives_empty_malformed_and_truncated_input() {
        assert!(driver_events_from_xml("").is_empty());
        assert!(driver_events_from_xml("not xml at all <<<").is_empty());
        assert!(driver_events_from_xml("<Event><System></System></Event>").is_empty());
        let good = pnp("2026-11-19T13:38:22.0Z", "PCI\\VEN_1&amp;DEV_2\\3&amp;4", "oem3.inf", DISPLAY, "1.0", "01/01/2026", true, "0x0");
        // A killed reader leaves a cut-off last event: the complete one still counts.
        let cut = format!("{good}<Event xmlns='x'><System><EventID>400</EventID><TimeCreated SystemTime='2026-11-19T13:3");
        assert_eq!(driver_events_from_xml(&cut).len(), 1);
        // Bad time, bad status text, missing instance id: skipped, never a panic.
        let bad_time = good.replace("2026-11-19T13:38:22.0Z", "yesterday");
        assert!(driver_events_from_xml(&bad_time).is_empty());
        let no_inst = good.replace("DeviceInstanceId", "Other");
        assert!(driver_events_from_xml(&no_inst).is_empty());
    }

    #[test]
    fn hardware_id_drops_only_the_instance_suffix() {
        assert_eq!(hardware_id_of("PCI\\VEN_1&DEV_2\\3&4"), "PCI\\VEN_1&DEV_2");
        assert_eq!(hardware_id_of("ACPI_HAL"), "ACPI_HAL");
        assert_eq!(hardware_id_of("ROOT\\AMDSAFD"), "ROOT\\AMDSAFD");
    }

    // ---- Windows Update ---------------------------------------------------------------------

    #[test]
    fn windows_update_events_carry_kb_class_and_utc_time() {
        let xml = [
            wu("2026-11-12T08:00:00.5Z", "2026-11 Cumulative Update for Windows 11 Version 25H2 for x64-based Systems (KB5099999)"),
            wu("2026-11-03T02:14:07.1667147Z", "Update for Windows Security platform - KB5007651 (Version 10.0.29680.1000) - Current Channel (Broad)"),
            wu("2026-11-20T10:45:55.1989298Z", "Security Intelligence Update for Microsoft Defender Antivirus - KB2267602 (Version 1.463.384.0) - Current Channel (Broad)"),
            wu("2026-11-14T00:15:15.5156282Z", "9PLM9XGG6VKS-OpenAI.Codex"),
            wu("2026-11-01T00:00:00Z", "Feature update to Windows 11, version 25H2"),
            wu("2026-11-02T00:00:00Z", "AMD - Display - 32.0.32029.2010"),
            wu("2026-11-02T01:00:00Z", "Some Vendor Tool 5"),
        ]
        .concat();
        let evs = wu_events_from_xml(&xml);
        assert_eq!(evs.len(), 7);
        let by = |needle: &str| evs.iter().find(|e| e.what.name.as_deref().unwrap().contains(needle)).unwrap();
        assert_eq!(by("Cumulative").what.kb.as_deref(), Some("KB5099999"));
        assert_eq!(by("Cumulative").what.detail.as_deref(), Some("quality"));
        assert_eq!(by("Windows Security platform").what.kb.as_deref(), Some("KB5007651"));
        assert_eq!(by("Security Intelligence").what.detail.as_deref(), Some("definition"));
        assert_eq!(by("Codex").what.detail.as_deref(), Some("store-app"));
        assert_eq!(by("Codex").what.kb, None);
        assert_eq!(by("Feature update").what.detail.as_deref(), Some("feature"));
        assert_eq!(by("AMD - Display").what.detail.as_deref(), Some("driver"));
        assert_eq!(by("Vendor Tool").what.detail.as_deref(), Some("other"));
        assert!(evs.iter().all(|e| e.kind == ChangeKind::WindowsUpdate && e.source == Source::WindowsUpdateLog));
        assert_eq!(by("KB5007651").when.at, Some(utc("2026-11-03T02:14:07.1667147Z")));
        // Oldest first.
        assert!(evs.windows(2).all(|w| w[0].when.at <= w[1].when.at));
    }

    #[test]
    fn same_update_logged_repeatedly_within_a_minute_is_one_install() {
        let xml = [
            wu("2026-11-19T22:38:53.29Z", "9NRZT3Q9R3DL-Microsoft.WindowsAppRuntime.2"),
            wu("2026-11-19T22:38:53.33Z", "9NRZT3Q9R3DL-Microsoft.WindowsAppRuntime.2"),
            wu("2026-11-19T22:38:53.36Z", "9NRZT3Q9R3DL-Microsoft.WindowsAppRuntime.2"),
            wu("2026-11-20T06:00:00Z", "9NRZT3Q9R3DL-Microsoft.WindowsAppRuntime.2"),
        ]
        .concat();
        assert_eq!(wu_events_from_xml(&xml).len(), 2);
    }

    #[test]
    fn wu_parser_survives_empty_and_malformed_input() {
        assert!(wu_events_from_xml("").is_empty());
        assert!(wu_events_from_xml("garbage").is_empty());
        // Event 20 (failure) is not an install.
        assert!(wu_events_from_xml(&wu("2026-11-19T00:00:00Z", "X KB1234567").replace("<EventID>19<", "<EventID>20<")).is_empty());
        // Empty title / bad time are skipped.
        assert!(wu_events_from_xml(&wu("2026-11-19T00:00:00Z", "")).is_empty());
        assert!(wu_events_from_xml(&wu("later", "Title")).is_empty());
    }

    #[test]
    fn kb_extraction_is_strict() {
        assert_eq!(kb_of("Fix - KB5007651 (Version 1)").as_deref(), Some("KB5007651"));
        assert_eq!(kb_of("kb123456 lower").as_deref(), Some("KB123456"));
        assert_eq!(kb_of("KB12 too short"), None);
        assert_eq!(kb_of("KB123456789 too long"), None);
        assert_eq!(kb_of("no number KB"), None);
        assert_eq!(kb_of("KBx then KB2267602").as_deref(), Some("KB2267602"));
    }

    // ---- Steam ------------------------------------------------------------------------------

    const ACF: &str = "\"AppState\"\n{\n\t\"appid\"\t\t\"1217060\"\n\t\"Universe\"\t\t\"1\"\n\t\"name\"\t\t\"Example Game\"\n\t\"StateFlags\"\t\t\"4\"\n\t\"installdir\"\t\t\"Example Game\"\n\t\"LastUpdated\"\t\t\"1700000000\"\n\t\"LastPlayed\"\t\t\"1699999999\"\n\t\"SizeOnDisk\"\t\t\"6046514750\"\n\t\"buildid\"\t\t\"26448669\"\n\t\"TargetBuildID\"\t\t\"26448669\"\n\t\"UserConfig\"\n\t{\n\t\t\"language\"\t\t\"english\"\n\t\t\"buildid\"\t\t\"1\"\n\t}\n\t\"InstalledDepots\"\n\t{\n\t\t\"1217061\"\n\t\t{\n\t\t\t\"manifest\"\t\t\"123\"\n\t\t}\n\t}\n}\n";

    #[test]
    fn acf_fields_parse_and_nested_blocks_do_not_leak() {
        let i = parse_acf(ACF).unwrap();
        assert_eq!(i.app_id, 1217060);
        assert_eq!(i.name.as_deref(), Some("Example Game"));
        assert_eq!(i.install_dir.as_deref(), Some("Example Game"));
        assert_eq!(i.build_id.as_deref(), Some("26448669"), "top-level buildid, not UserConfig's");
        assert_eq!(i.last_updated, Some(1_700_000_000));
    }

    #[test]
    fn acf_last_updated_is_epoch_seconds_utc() {
        let ev = game_event_from_acf(&parse_acf(ACF).unwrap()).unwrap();
        // 1_700_000_000 is 2023-11-14 22:13:20 UTC, whatever the local zone.
        assert_eq!(ev.when.at, Some(utc("2023-11-14T22:13:20Z")));
        assert_eq!(ev.when.precision, Precision::Exact);
        assert_eq!(ev.kind, ChangeKind::GameUpdate);
        assert_eq!(ev.what.build_id.as_deref(), Some("26448669"));
        assert_eq!(ev.what.id.as_deref(), Some("1217060"));
        assert_eq!(ev.what.detail, None);
    }

    #[test]
    fn pending_update_is_flagged_and_missing_time_is_unreadable() {
        let pending = ACF.replace("\"TargetBuildID\"\t\t\"26448669\"", "\"TargetBuildID\"\t\t\"26500000\"");
        let ev = game_event_from_acf(&parse_acf(&pending).unwrap()).unwrap();
        assert!(ev.what.detail.unwrap().contains("26500000"));
        let no_time = ACF.replace("\"LastUpdated\"\t\t\"1700000000\"", "");
        assert!(game_event_from_acf(&parse_acf(&no_time).unwrap()).is_err());
        let zero = ACF.replace("1700000000", "0");
        assert!(game_event_from_acf(&parse_acf(&zero).unwrap()).is_err());
    }

    #[test]
    fn acf_parser_survives_empty_and_malformed_input() {
        assert_eq!(parse_acf(""), None);
        assert_eq!(parse_acf("garbage"), None);
        assert_eq!(parse_acf("\"AppState\"\n{\n\"appid\"\t\"abc\"\n}\n"), None);
        assert_eq!(parse_acf("\"AppState\"\n{\n\"name\"\t\"No id\"\n}\n"), None);
        assert_eq!(parse_acf("\"appid\"\t\"5\"\n"), None, "keys outside the AppState block do not count");
        assert!(parse_acf("\"AppState\"\n{\n\"appid\"\t\"5\"\n").is_some(), "unclosed block still has its id");
    }

    #[test]
    fn manifest_matching_by_app_id_or_install_folder() {
        let info = parse_acf(ACF).unwrap();
        let by_id = GameRef { steam_app_id: Some(1217060), ..GameRef::default() };
        assert!(manifest_matches(&info, &by_id, "C:\\Steam"));
        assert!(!manifest_matches(&info, &GameRef { steam_app_id: Some(1), ..GameRef::default() }, "C:\\Steam"));
        let by_dir = GameRef {
            install_dir: Some("D:/SteamLibrary/steamapps/common/example game/bin".into()),
            ..GameRef::default()
        };
        assert!(manifest_matches(&info, &by_dir, "D:\\SteamLibrary"));
        let elsewhere = GameRef { install_dir: Some("C:\\Games\\Example Game".into()), ..GameRef::default() };
        assert!(!manifest_matches(&info, &elsewhere, "C:\\Steam"));
        assert_eq!(steam_install_folder("C:\\Games\\Example Game"), None);
        assert_eq!(
            steam_install_folder("C:\\Program Files (x86)\\Steam\\steamapps\\common\\Example Game\\x.exe").as_deref(),
            Some("Example Game")
        );
    }

    #[test]
    fn non_steam_or_unidentified_games_are_unreadable_with_a_plain_reason() {
        let epic = GameRef { launcher: Some("Epic".into()), steam_app_id: Some(5), ..GameRef::default() };
        match read_game_update(&epic, DEFAULT_BUDGET) {
            SourceRead::Unreadable(r) => assert!(r.plain().contains("not a Steam install"), "{r:?}"),
            other => panic!("expected Unreadable, got {other:?}"),
        }
        match read_game_update(&GameRef::default(), DEFAULT_BUDGET) {
            SourceRead::Unreadable(r) => assert!(r.plain().contains("No game was identified"), "{r:?}"),
            other => panic!("expected Unreadable, got {other:?}"),
        }
        let loose = GameRef { install_dir: Some("C:\\Games\\Whatever".into()), ..GameRef::default() };
        match read_game_update(&loose, DEFAULT_BUDGET) {
            SourceRead::Unreadable(r) => assert!(r.plain().contains("not installed in a Steam library"), "{r:?}"),
            other => panic!("expected Unreadable, got {other:?}"),
        }
    }

    // ---- installed programs / time zones ----------------------------------------------------

    fn pst() -> FixedOffset {
        FixedOffset::west_opt(8 * 3600).unwrap()
    }

    fn fields(name: &str, date: &str) -> UninstallFields {
        UninstallFields {
            display_name: Some(name.into()),
            display_version: Some("1.2".into()),
            install_date: Some(date.into()),
            ..UninstallFields::default()
        }
    }

    #[test]
    fn install_date_is_a_local_day_not_a_utc_instant() {
        let w = |d| day_window_in(&pst(), d);
        let ev = uninstall_event(&fields("Tool", "20261119"), &w).unwrap();
        assert_eq!(ev.when.precision, Precision::Day);
        // Local Nov 19 at UTC-8 is 08:00Z Nov 19 up to (not including) 08:00Z Nov 20.
        assert_eq!(ev.when.at, Some(utc("2026-11-19T08:00:00Z")));
        assert_eq!(ev.when.until, Some(utc("2026-11-20T08:00:00Z")));
        assert_eq!(ev.kind, ChangeKind::ProgramInstalled);
        assert_eq!(ev.what.name.as_deref(), Some("Tool"));
        assert_eq!(ev.what.to_version.as_deref(), Some("1.2"));
    }

    #[test]
    fn install_date_parsing_is_strict() {
        assert!(parse_install_date("20261119").is_some());
        assert!(parse_install_date(" 20261119 ").is_some());
        for bad in ["", "2026-11-19", "2026111", "202611190", "20261340", "19700101", "abcdefgh"] {
            assert!(parse_install_date(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn uninstall_entries_that_are_not_programs_are_skipped() {
        let w = |d| day_window_in(&pst(), d);
        let mut sys = fields("Component", "20261119");
        sys.system_component = true;
        let mut patch = fields("Patch", "20261119");
        patch.is_patch = true;
        let mut nameless = fields("x", "20261119");
        nameless.display_name = None;
        let blank = fields("   ", "20261119");
        let mut dateless = fields("NoDate", "20261119");
        dateless.install_date = None;
        for f in [sys, patch, nameless, blank, dateless, fields("BadDate", "soon")] {
            assert!(uninstall_event(&f, &w).is_none());
        }
    }

    #[test]
    fn registry_views_are_deduplicated() {
        let w = |d| day_window_in(&pst(), d);
        let deadline = Instant::now() + Duration::from_secs(5);
        let entries = vec![fields("Tool", "20261119"), fields("Tool", "20261119"), fields("Other", "20261119")];
        let scan = collect_uninstall(entries.into_iter().map(Some), deadline, &w);
        let (evs, timed_out) = (scan.events, scan.timed_out);
        assert_eq!(evs.len(), 2);
        assert!(!timed_out);
    }

    // ---- combiner: window edges, unreadable vs empty, sorting -------------------------------

    fn exact_ev(kind: ChangeKind, t: &str, name: &str) -> ChangeEvent {
        ChangeEvent {
            kind,
            when: ChangeTime::exact(utc(t)),
            what: ChangeWhat { name: Some(name.into()), ..ChangeWhat::default() },
            source: Source::DriverLog,
        }
    }

    fn ok(events: Vec<ChangeEvent>) -> SourceRead {
        SourceRead::ok(events)
    }

    #[test]
    fn window_is_exclusive_at_the_start_and_inclusive_at_the_end() {
        let (t0, t1) = (utc("2026-11-11T14:14:00Z"), utc("2026-11-20T01:01:00Z"));
        let evs = vec![
            exact_ev(ChangeKind::GpuDriver, "2026-11-11T14:14:00Z", "at-t0"),
            exact_ev(ChangeKind::GpuDriver, "2026-11-11T14:14:00.001Z", "just-after-t0"),
            exact_ev(ChangeKind::GpuDriver, "2026-11-20T01:01:00Z", "at-t1"),
            exact_ev(ChangeKind::GpuDriver, "2026-11-20T01:01:00.001Z", "just-after-t1"),
            exact_ev(ChangeKind::GpuDriver, "2026-11-10T00:00:00Z", "before"),
        ];
        let r = combine_unchecked(t0, t1, vec![(Source::DriverLog, ok(evs))]);
        let names: Vec<_> = r.events_found.iter().map(|e| e.what.name.clone().unwrap()).collect();
        assert_eq!(names, vec!["just-after-t0", "at-t1"]);
    }

    #[test]
    fn a_day_event_counts_when_its_day_overlaps_the_window() {
        let (t0, t1) = (utc("2026-11-19T08:00:00Z"), utc("2026-11-20T08:00:00Z"));
        let day = |a: &str, b: &str| ChangeEvent {
            kind: ChangeKind::ProgramInstalled,
            when: ChangeTime::day(utc(a), utc(b)),
            what: ChangeWhat::default(),
            source: Source::UninstallKeys,
        };
        // Day ends exactly at t0 (its last instant is before t0): out.
        assert!(!day("2026-11-18T08:00:00Z", "2026-11-19T08:00:00Z").when.in_window(t0, t1));
        // Day that straddles t0: in.
        assert!(day("2026-11-18T20:00:00Z", "2026-11-19T20:00:00Z").when.in_window(t0, t1));
        // Day starting exactly at t1 (its first instant is in the window): in.
        assert!(day("2026-11-20T08:00:00Z", "2026-11-21T08:00:00Z").when.in_window(t0, t1));
        // Day starting after t1: out.
        assert!(!day("2026-11-20T08:00:01Z", "2026-11-21T08:00:00Z").when.in_window(t0, t1));
    }

    #[test]
    fn unreadable_is_reported_and_is_not_the_same_as_empty() {
        let (t0, t1) = (utc("2026-11-01T00:00:00Z"), utc("2026-11-20T00:00:00Z"));
        let r = combine_unchecked(
            t0,
            t1,
            vec![
                (Source::DriverLog, ok(vec![])),
                (Source::WindowsUpdateLog, SourceRead::Unreadable(UnreadableReason::AccessDenied)),
            ],
        );
        assert!(r.events_found.is_empty());
        assert_eq!(r.unreadable.len(), 1);
        assert_eq!(r.unreadable[0].source, Source::WindowsUpdateLog);
        assert_eq!(r.unreadable[0].reason, UnreadableReason::AccessDenied);
        assert!(r.partial.is_empty());
        // A clean empty read lists nothing as unreadable.
        let clean = combine_unchecked(t0, t1, vec![(Source::DriverLog, ok(vec![]))]);
        assert!(clean.unreadable.is_empty());
    }

    #[test]
    fn a_timed_out_reader_is_marked_partial_and_keeps_its_events() {
        let (t0, t1) = (utc("2026-11-01T00:00:00Z"), utc("2026-11-20T00:00:00Z"));
        let partial = SourceRead::Read(ReadOk {
            events: vec![exact_ev(ChangeKind::WindowsUpdate, "2026-11-10T00:00:00Z", "kept")],
            covered_from: Some(utc("2026-11-08T00:00:00Z")),
            gaps: vec![Gap::TimedOut],
            notes: vec![],
        });
        let r = combine_unchecked(t0, t1, vec![(Source::WindowsUpdateLog, partial)]);
        assert_eq!(r.events_found.len(), 1);
        assert_eq!(r.partial.len(), 1);
        assert_eq!(r.partial[0].source, Source::WindowsUpdateLog);
        assert_eq!(r.partial[0].gaps, vec![Gap::TimedOut]);
        assert_eq!(r.partial[0].covered_from, Some(utc("2026-11-08T00:00:00Z")), "how far back the partial read reached");
        assert_eq!(r.coverage_gaps.len(), 1, "t0..covered_from is not covered");
    }

    #[test]
    fn budget_exhausted_with_nothing_read_is_unreadable_not_empty() {
        assert!(matches!(SourceRead::finish(vec![], true, vec![]), SourceRead::Unreadable(UnreadableReason::TimedOutBeforeAnyRecord)));
        match SourceRead::finish(vec![], false, vec![]) {
            SourceRead::Read(ok) => assert!(!ok.timed_out() && ok.gaps.is_empty()),
            other => panic!("{other:?}"),
        }
        let one = vec![exact_ev(ChangeKind::GpuDriver, "2026-11-10T00:00:00Z", "a")];
        match SourceRead::finish(one, true, vec![]) {
            SourceRead::Read(ok) => assert!(ok.timed_out()),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn events_sort_oldest_first_and_game_last_update_ignores_the_window() {
        let (t0, t1) = (utc("2026-11-10T00:00:00Z"), utc("2026-11-20T00:00:00Z"));
        let mut game = exact_ev(ChangeKind::GameUpdate, "2026-11-05T00:00:00Z", "The Game");
        game.source = Source::SteamManifest;
        let r = combine_unchecked(
            t0,
            t1,
            vec![
                (Source::DriverLog, ok(vec![exact_ev(ChangeKind::GpuDriver, "2026-11-15T00:00:00Z", "late")])),
                (Source::WindowsUpdateLog, ok(vec![exact_ev(ChangeKind::WindowsUpdate, "2026-11-12T00:00:00Z", "early")])),
                (Source::SteamManifest, ok(vec![game])),
            ],
        );
        let names: Vec<_> = r.events_found.iter().map(|e| e.what.name.clone().unwrap()).collect();
        assert_eq!(names, vec!["early", "late"], "the game update is before the window");
        assert_eq!(r.game_last_update.unwrap().what.name.as_deref(), Some("The Game"));
    }

    #[test]
    fn undated_events_are_counted_not_listed() {
        let (t0, t1) = (utc("2026-11-01T00:00:00Z"), utc("2026-11-20T00:00:00Z"));
        let ev = ChangeEvent {
            kind: ChangeKind::ProgramInstalled,
            when: ChangeTime::unknown(),
            what: ChangeWhat::default(),
            source: Source::UninstallKeys,
        };
        let r = combine_unchecked(t0, t1, vec![(Source::UninstallKeys, ok(vec![ev]))]);
        assert!(r.events_found.is_empty());
        assert_eq!(r.undated_excluded, 1);
    }

    // ---- budgets ------------------------------------------------------------------------------

    #[test]
    fn collect_until_returns_partial_results_when_the_budget_runs_out() {
        let slow = (0..50).inspect(|_| std::thread::sleep(Duration::from_millis(20)));
        let mut got = Vec::new();
        let timed_out = collect_until(slow, Instant::now() + Duration::from_millis(100), |i| got.push(i));
        assert!(timed_out);
        assert!(!got.is_empty() && got.len() < 50, "partial: {}", got.len());
        // Zero budget reads nothing and says so.
        let mut none = Vec::new();
        assert!(collect_until(0..5, Instant::now(), |i| none.push(i)));
        assert!(none.is_empty());
        // Plenty of budget finishes.
        assert!(!collect_until(0..5, Instant::now() + Duration::from_secs(5), |_| {}));
    }

    #[test]
    fn a_child_that_exceeds_its_budget_is_killed_and_returns_what_it_had_written() {
        let mut cmd = system_command("cmd.exe").unwrap();
        cmd.args(["/c", "echo first-line & ping -n 8 127.0.0.1 > nul"]);
        let started = Instant::now();
        let out = run_with_budget(cmd, Duration::from_millis(400)).unwrap();
        assert!(out.timed_out);
        assert!(started.elapsed() < Duration::from_secs(4), "returned at the budget, not at child exit");
        assert!(String::from_utf8_lossy(&out.stdout).contains("first-line"), "partial output kept");
    }

    #[test]
    fn a_failing_query_is_unreadable_with_the_windows_reason() {
        let r = run_wevtutil("No-Such-Channel/Operational", None, 1, false, Duration::from_secs(5));
        assert!(
            matches!(r, Err(UnreadableReason::ChannelNotFound | UnreadableReason::QueryFailed(_))),
            "a missing channel must not look like an empty log: {r:?}"
        );
        // And through the reader: a channel that does not exist is Unreadable.
        let q = event_query(None, 1, Utc::now() - ChronoDuration::days(1), Utc::now());
        assert!(read_channel("No-Such-Channel/Operational", &q, Duration::from_secs(5), parse_pnp).is_err());
    }

    #[test]
    fn a_zero_budget_real_reader_is_unreadable_not_empty() {
        let now = Utc::now();
        match read_driver_installs(now - ChronoDuration::days(1), now, Duration::from_millis(0)) {
            SourceRead::Unreadable(_) => {}
            SourceRead::Read(ok) => {
                // A child can race a zero budget and finish first; then it is a real read.
                assert!(!ok.timed_out() || !ok.events.is_empty());
            }
        }
    }

    #[test]
    fn reports_serialize_for_the_engine() {
        let r = combine_unchecked(utc("2026-11-01T00:00:00Z"), utc("2026-11-20T00:00:00Z"), vec![]);
        let j = serde_json::to_string(&r).unwrap();
        assert!(j.contains("window_start"));
    }

    // ---- review r1: executable resolution, elevation, payload isolation ---------------------------

    #[test]
    fn wevtutil_is_resolved_to_an_absolute_path_inside_the_system_directory() {
        let sys = system_directory().expect("system directory");
        assert!(sys.is_absolute());
        let tool = system_tool("wevtutil.exe").expect("wevtutil in the system directory");
        assert!(tool.is_absolute(), "{tool:?}");
        assert_eq!(tool.parent().unwrap(), sys.as_path());
        assert!(tool.is_file());
        // A name that is not in the system directory is ToolMissing, never a PATH search.
        assert_eq!(system_tool("compy-no-such-tool.exe"), Err(UnreadableReason::ToolMissing));
    }

    /// Removes the planted file even if an assertion fails.
    struct Planted(PathBuf);
    impl Drop for Planted {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[test]
    fn a_wevtutil_planted_beside_the_executable_is_never_run() {
        let exe_dir = std::env::current_exe().unwrap().parent().unwrap().to_path_buf();
        let planted = exe_dir.join("wevtutil.exe");
        // The resolver itself never yields a relative or bare name (independent of any planting).
        let cmd = system_command("wevtutil.exe").expect("system command");
        assert!(std::path::Path::new(cmd.get_program()).is_absolute(), "{:?}", cmd.get_program());
        if let Ok(meta) = std::fs::metadata(&planted) {
            let age = meta.modified().ok().and_then(|m| m.elapsed().ok()).unwrap_or(Duration::from_secs(u64::MAX));
            if age > Duration::from_secs(600) {
                panic!(
                    "a stale wevtutil.exe was left beside the test executable ({planted:?}); delete it, then rerun. \
                     Not passing vacuously."
                );
            }
            eprintln!("skipped: a fresh wevtutil.exe beside the executable belongs to a concurrent run");
            return;
        }
        if std::fs::write(&planted, b"MZ this is not a program").is_err() {
            eprintln!("skipped: cannot write beside the test executable");
            return;
        }
        let _guard = Planted(planted.clone());
        // Control: a bare-name spawn (what quiet_command("wevtutil.exe") does) picks the planted
        // file first and fails; this is the hazard the absolute path closes. If antivirus removed
        // the file, or the control spawn works, the hazard was not reproduced here: skip, say why.
        if !planted.exists() {
            eprintln!("skipped: the planted file was removed (antivirus?) before the control");
            return;
        }
        match std::process::Command::new("wevtutil.exe").arg("/?").spawn() {
            Err(_) => {}
            Ok(mut child) => {
                let _ = child.kill();
                let _ = child.wait();
                eprintln!("skipped: a bare-name spawn did not pick the planted file, so nothing is proven here");
                return;
            }
        }
        // The reader still works: it ran the real tool from the system directory.
        let r = run_wevtutil("System", None, 1, false, Duration::from_secs(10));
        assert!(matches!(&r, Ok(t) if !t.timed_out), "{r:?}");
    }

    /// The text of `fn <name>` up to its closing brace at column 0.
    fn fn_body<'a>(src: &'a str, signature: &str) -> &'a str {
        let i = src.find(signature).unwrap_or_else(|| panic!("{signature} not found"));
        let rest = &src[i..];
        &rest[..rest.find("\n}\n").expect("end of fn") + 3]
    }

    #[test]
    fn the_elevated_helper_never_reaches_this_module() {
        let lib = include_str!("lib.rs");
        let body = fn_body(lib, "pub fn run_elevated_helper(");
        assert!(!body.contains("change_sources"), "run_elevated_helper must never call change_sources");
        assert!(!body.contains("paramedic"), "run_elevated_helper must never call the paramedic");
        assert!(!include_str!("main.rs").contains("change_sources"));
        assert!(!include_str!("main.rs").contains("paramedic"));
        // The elevated helper entry also never names this module's reader entry points.
        for f in ["changes_between", "read_driver_installs", "read_windows_updates", "read_installed_programs", "read_game_update"] {
            assert!(!body.contains(f), "{f}");
        }
        // Transitively: every module the helper's body names, and every module those name in turn,
        // never mentions the paramedic or this module (module-level reach is deliberately coarse: a false
        // alarm is a reason to look, a miss would put a reader behind the elevated entry).
        let src_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut modules: HashMap<String, String> = HashMap::new();
        for entry in std::fs::read_dir(&src_dir).unwrap().flatten() {
            let p = entry.path();
            let stem = p.file_stem().unwrap().to_string_lossy().into_owned();
            let mut text = String::new();
            if p.is_dir() {
                let mut stack = vec![p.clone()];
                while let Some(d) = stack.pop() {
                    for e in std::fs::read_dir(&d).unwrap().flatten() {
                        let q = e.path();
                        if q.is_dir() {
                            stack.push(q);
                        } else if q.extension().and_then(|x| x.to_str()) == Some("rs") {
                            text.push_str(&std::fs::read_to_string(&q).unwrap());
                        }
                    }
                }
            } else if p.extension().and_then(|x| x.to_str()) == Some("rs") {
                text = std::fs::read_to_string(&p).unwrap();
            } else {
                continue;
            }
            modules.entry(stem).or_default().push_str(&text);
        }
        let code_only = |t: &str| t.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        let names_in = |t: &str| -> Vec<String> {
            let t = code_only(t);
            modules
                .keys()
                .filter(|m| {
                    let pat = format!("{m}::");
                    t.match_indices(&pat).any(|(i, _)| {
                        !t[..i].chars().next_back().is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
                    })
                })
                .cloned()
                .collect()
        };
        let mut seen: Vec<String> = Vec::new();
        let mut queue = names_in(body);
        while let Some(m) = queue.pop() {
            if seen.contains(&m) {
                continue;
            }
            for next in names_in(&modules[&m]) {
                queue.push(next);
            }
            seen.push(m);
        }
        assert!(seen.contains(&"actions".to_string()), "the scan must reach what the helper really uses: {seen:?}");
        for banned in ["paramedic", "change_sources"] {
            assert!(!seen.iter().any(|m| m == banned), "the elevated helper reaches {banned} through {seen:?}");
        }
    }

    // ---- find_steam_game: a program name to its Steam install --------------------------------

    #[test]
    fn exe_names_reduce_to_the_folder_name_they_belong_to() {
        assert_eq!(exe_stem_key("LANESPLIT-Win64-Shipping.exe"), "lanesplit");
        assert_eq!(exe_stem_key("ROB RUN.exe"), "robrun");
        assert_eq!(exe_stem_key("  Game_x64.EXE "), "game");
        assert!(folder_may_hold("lanesplit", "LANESPLIT"));
        assert!(folder_may_hold("robrun", "ROB RUN"));
        assert!(folder_may_hold("lanesplit", "Lanesplit Demo"));
        assert!(!folder_may_hold("lanesplit", "Counter-Strike"));
        assert!(!folder_may_hold("cs", "csgo"), "two letters decide nothing");
        assert!(!folder_may_hold("", "anything"));
    }

    fn fake_library(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("compy_f4b_{tag}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("steamapps").join("common").join("Lane Split").join("Bin").join("Win64")).unwrap();
        std::fs::create_dir_all(root.join("steamapps").join("common").join("Other Game")).unwrap();
        std::fs::write(root.join("steamapps").join("common").join("Lane Split").join("Bin").join("Win64").join("LaneSplit-Win64-Shipping.exe"), b"x").unwrap();
        std::fs::write(
            root.join("steamapps").join("appmanifest_42.acf"),
            "\"AppState\"\n{\n\t\"appid\"\t\t\"42\"\n\t\"name\"\t\t\"Lane Split\"\n\t\"installdir\"\t\t\"Lane Split\"\n\t\"buildid\"\t\t\"7\"\n\t\"LastUpdated\"\t\t\"1763500000\"\n}\n",
        )
        .unwrap();
        std::fs::write(
            root.join("steamapps").join("appmanifest_43.acf"),
            "\"AppState\"\n{\n\t\"appid\"\t\t\"43\"\n\t\"name\"\t\t\"Other\"\n\t\"installdir\"\t\t\"Other Game\"\n\t\"LastUpdated\"\t\t\"1763500001\"\n}\n",
        )
        .unwrap();
        root
    }

    #[test]
    fn a_program_inside_a_steam_install_folder_finds_its_game() {
        let root = fake_library("found");
        let roots = vec![root.to_string_lossy().into_owned()];
        match find_game_in_roots(&roots, false, "LaneSplit-Win64-Shipping.exe", Duration::from_secs(5)) {
            SteamLookup::Found(g) => {
                assert_eq!(g.steam_app_id, Some(42));
                assert_eq!(g.launcher.as_deref(), Some("Steam"));
                assert!(g.install_dir.unwrap().ends_with("Lane Split"));
            }
            other => panic!("{other:?}"),
        }
        // A name that matches a folder is not enough: the program must be in it.
        assert_eq!(find_game_in_roots(&roots, false, "OtherGame.exe", Duration::from_secs(5)), SteamLookup::NotInSteam);
        assert_eq!(find_game_in_roots(&roots, false, "nothing-like-it.exe", Duration::from_secs(5)), SteamLookup::NotInSteam);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn two_folders_holding_the_same_program_name_are_never_guessed_between() {
        let root = fake_library("dup");
        // A second game folder with the same program name inside, in a second library as well.
        let common = root.join("steamapps").join("common");
        std::fs::create_dir_all(common.join("Lane Split 2")).unwrap();
        std::fs::write(common.join("Lane Split 2").join("LaneSplit-Win64-Shipping.exe"), b"x").unwrap();
        std::fs::write(
            root.join("steamapps").join("appmanifest_44.acf"),
            "\"AppState\"\n{\n\t\"appid\"\t\t\"44\"\n\t\"name\"\t\t\"Lane Split 2\"\n\t\"installdir\"\t\t\"Lane Split 2\"\n\t\"LastUpdated\"\t\t\"1763500002\"\n}\n",
        )
        .unwrap();
        let roots = vec![root.to_string_lossy().into_owned()];
        assert_eq!(find_game_in_roots(&roots, false, "LaneSplit-Win64-Shipping.exe", Duration::from_secs(5)), SteamLookup::NotInSteam);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_library_that_cannot_be_read_is_never_not_in_steam() {
        let root = fake_library("gone");
        let roots = vec![root.to_string_lossy().into_owned(), "Z:\\no-such-library-f4b".into()];
        assert_eq!(
            find_game_in_roots(&roots, false, "Nope-Win64-Shipping.exe", Duration::from_secs(5)),
            SteamLookup::Unreadable(UnreadableReason::SteamPartiallyUnreadable { libraries: 1, records: 0 })
        );
        // A library list that could not be read counts the same way.
        let roots = vec![root.to_string_lossy().into_owned()];
        assert!(matches!(find_game_in_roots(&roots, true, "Nope.exe", Duration::from_secs(5)), SteamLookup::Unreadable(_)));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn change_events_are_not_part_of_any_support_or_outbound_payload() {
        // Program names and device ids must not reach a support bundle, evidence upload, receipt,
        // signed catalog or export. Every type here is reachable only through the module path, so no
        // source file other than lib.rs (the `mod` line), this file and the diagnosis engine
        // (paramedic.rs, the one planned consumer) may name it. Scanning the whole source directory
        // covers every payload module without listing (or naming) any of them.
        let src_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let allowed = ["lib.rs", "change_sources.rs", "paramedic.rs"];
        let mut scanned = 0;
        for entry in std::fs::read_dir(&src_dir).unwrap().flatten() {
            let path = entry.path();
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") || allowed.contains(&name.as_str()) {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            scanned += 1;
            assert!(!text.contains("change_sources"), "{name} reaches into change_sources");
        }
        assert!(scanned > 30, "the scan must actually cover the crate's modules ({scanned})");
        // lib.rs may only declare the module.
        let lib = include_str!("lib.rs");
        let lines: Vec<&str> = lib.lines().filter(|l| l.contains("change_sources")).collect();
        assert!(lines.iter().all(|l| l.trim_start().starts_with("mod change_sources;")), "{lines:?}");
    }

    // ---- review r1: row cap, upper bound, coverage, no silent parse drops ---------------------

    #[test]
    fn the_query_is_bounded_above_as_well_as_below() {
        let q = event_query(Some("Microsoft-Windows-WindowsUpdateClient"), 19, utc("2026-10-01T00:00:00Z"), utc("2026-10-20T12:00:00.5Z"));
        assert!(q.contains("@SystemTime>='2026-10-01T00:00:00.000Z'"), "{q}");
        assert!(q.contains("@SystemTime<='2026-10-20T12:00:00.501Z'"), "upper bound, rounded up a millisecond: {q}");
        assert!(q.contains("EventID=19") && q.contains("Provider[@Name='Microsoft-Windows-WindowsUpdateClient']"));
        let pnp_q = event_query(None, 400, utc("2026-10-01T00:00:00Z"), utc("2026-10-02T00:00:00Z"));
        assert!(!pnp_q.contains("Provider") && pnp_q.contains("<='"));
    }

    #[test]
    fn a_log_read_that_is_cut_at_a_past_window_end_returns_only_rows_up_to_it() {
        // Real log: a window that ended 40 days ago must not be answered from the newest rows.
        let until = Utc::now() - ChronoDuration::days(40);
        match read_windows_updates(until - ChronoDuration::days(20), until, Duration::from_secs(5)) {
            SourceRead::Read(ok) => {
                assert!(ok.events.iter().all(|e| e.when.at.unwrap() <= until + ChronoDuration::milliseconds(1)));
            }
            SourceRead::Unreadable(_) => {} // a log that does not reach back that far is Unreadable-or-gap territory
        }
    }

    fn wu_rows(n: usize) -> String {
        // Newest first, one row per minute, like `/rd:true`.
        (0..n)
            .map(|i| {
                let t = utc("2026-11-19T12:00:00Z") - ChronoDuration::minutes(i as i64);
                wu(&t.format("%Y-%m-%dT%H:%M:%SZ").to_string(), &format!("Update number {i} - KB{:07}", 1_000_000 + i))
            })
            .collect()
    }

    #[test]
    fn reaching_the_row_cap_marks_the_read_partial_and_names_how_far_back_it_got() {
        let xml = wu_rows(MAX_EVENTS + 1);
        let a = assess(&xml, false, Some(utc("2026-01-01T00:00:00Z")), parse_wu(&xml)).unwrap();
        assert_eq!(a.items.len(), MAX_EVENTS + 1);
        assert!(a.gaps.contains(&Gap::RowCapReached), "{:?}", a.gaps);
        let oldest = utc("2026-11-19T12:00:00Z") - ChronoDuration::minutes(MAX_EVENTS as i64);
        assert_eq!(a.covered_from, Some(oldest), "the oldest time actually seen, not the log's start");
        // Exactly the cap is a complete read (only cap+1 rows proves older rows exist) back to the log's own start.
        let xml = wu_rows(MAX_EVENTS);
        let a = assess(&xml, false, Some(utc("2026-01-01T00:00:00Z")), parse_wu(&xml)).unwrap();
        assert!(a.gaps.is_empty());
        assert_eq!(a.covered_from, Some(utc("2026-01-01T00:00:00Z")));
    }

    #[test]
    fn a_timed_out_log_read_reports_how_far_back_it_reached() {
        let xml = wu_rows(10);
        let a = assess(&xml, true, Some(utc("2026-01-01T00:00:00Z")), parse_wu(&xml)).unwrap();
        assert_eq!(a.gaps, vec![Gap::TimedOut]);
        assert_eq!(a.covered_from, Some(utc("2026-11-19T12:00:00Z") - ChronoDuration::minutes(9)));
        // Nothing read before the deadline is unreadable, never an empty read.
        assert_eq!(
            assess("", true, Some(utc("2026-01-01T00:00:00Z")), parse_wu("")).err(),
            Some(UnreadableReason::TimedOutBeforeAnyRecord)
        );
    }

    #[test]
    fn a_log_that_starts_after_the_window_start_is_a_coverage_gap() {
        let (t0, t1) = (utc("2026-11-01T00:00:00Z"), utc("2026-11-20T00:00:00Z"));
        let read = SourceRead::Read(ReadOk {
            events: vec![],
            covered_from: Some(utc("2026-11-10T00:00:00Z")),
            gaps: vec![],
            notes: vec![],
        });
        let r = combine_unchecked(t0, t1, vec![(Source::DriverLog, read)]);
        assert!(r.events_found.is_empty());
        assert_eq!(r.coverage_gaps, vec![CoverageGap { source: Source::DriverLog, from: t0, to: utc("2026-11-10T00:00:00Z") }]);
        // A log that reaches back past the window start has no gap.
        let ok = SourceRead::Read(ReadOk { events: vec![], covered_from: Some(utc("2026-05-22T00:00:00Z")), gaps: vec![], notes: vec![] });
        assert!(combine_unchecked(t0, t1, vec![(Source::DriverLog, ok)]).coverage_gaps.is_empty());
        // Covered exactly from t0 is covered (t0 itself is outside the window anyway).
        let edge = SourceRead::Read(ReadOk { events: vec![], covered_from: Some(t0), gaps: vec![], notes: vec![] });
        assert!(combine_unchecked(t0, t1, vec![(Source::DriverLog, edge)]).coverage_gaps.is_empty());
    }

    #[test]
    fn an_empty_or_cleared_log_is_unreadable_not_an_empty_read() {
        assert_eq!(parse_log_start(""), Err(UnreadableReason::LogEmptyOrSwitchedOff));
        assert_eq!(parse_log_start("  \r\n"), Err(UnreadableReason::LogEmptyOrSwitchedOff));
        assert_eq!(parse_log_start("some text, no events"), Err(UnreadableReason::RecordsUnreadable(0)));
        assert!(parse_log_start("<Event><System><EventID>1</EventID></System></Event>").is_err(), "no time");
        let one = wu("2026-05-22T06:42:41.9574227Z", "x");
        assert_eq!(parse_log_start(&one), Ok(utc("2026-05-22T06:42:41.9574227Z")));
    }

    #[test]
    fn a_renamed_field_is_unreadable_records_not_an_empty_read() {
        // Valid-looking event 19 blocks whose title field was renamed by a Windows update.
        let xml = wu("2026-11-19T00:00:00Z", "Some Update KB1234567").replace("updateTitle", "updateName");
        let parsed = parse_wu(&xml);
        assert_eq!((parsed.blocks, parsed.items.len(), parsed.malformed()), (1, 0, 1));
        assert_eq!(assess(&xml, false, None, parsed).err(), Some(UnreadableReason::RecordsUnreadable(1)));
        // Same for the driver parser when DriverVersion disappears.
        let pnp_xml = pnp("2026-11-19T00:00:00Z", "PCI\\VEN_1&amp;DEV_2\\3&amp;4", "oem3.inf", DISPLAY, "1.0", "01/01/2026", true, "0x0")
            .replace("DriverVersion", "DriverVer");
        assert_eq!(assess(&pnp_xml, false, None, parse_pnp(&pnp_xml)).err(), Some(UnreadableReason::RecordsUnreadable(1)));
    }

    #[test]
    fn non_blank_output_with_no_event_blocks_is_unreadable() {
        for garbage in ["Access is denied.", "<?xml version='1.0'?><Events/>", "\u{FFFD}\u{FFFD}\u{FFFD}"] {
            assert_eq!(
                assess(garbage, false, None, parse_wu(garbage)).err(),
                Some(UnreadableReason::RecordsUnreadable(0)),
                "{garbage:?}"
            );
        }
        // Blank output is a legitimate "no rows" only because the log's start was read first.
        let a = assess("", false, Some(utc("2026-01-01T00:00:00Z")), parse_wu("")).unwrap();
        assert!(a.items.is_empty() && a.gaps.is_empty());
    }

    #[test]
    fn some_malformed_rows_make_the_read_partial_with_their_count() {
        let good = wu("2026-11-19T00:00:00Z", "Good Update KB1234567");
        let bad = wu("2026-11-19T00:01:00Z", "Bad").replace("updateTitle", "gone");
        let xml = format!("{good}{bad}{bad}");
        let a = assess(&xml, false, Some(utc("2026-01-01T00:00:00Z")), parse_wu(&xml)).unwrap();
        assert_eq!(a.items.len(), 1);
        assert_eq!(a.gaps, vec![Gap::MalformedRecords(2)]);
    }

    #[test]
    fn real_log_reads_report_where_their_coverage_starts() {
        let now = Utc::now();
        for (channel, read) in [
            ("System", read_windows_updates(now - ChronoDuration::days(30), now, Duration::from_secs(5))),
            ("Microsoft-Windows-Kernel-PnP/Configuration", read_driver_installs(now - ChronoDuration::days(30), now, Duration::from_secs(5))),
        ] {
            if !log_readable(channel) {
                continue;
            }
            match read {
                SourceRead::Read(ok) => {
                    let from = ok.covered_from.expect("an event-log read always says where its coverage starts");
                    assert!(from < now);
                }
                SourceRead::Unreadable(r) => panic!("{channel} is readable without elevation: {r:?}"),
            }
        }
    }

    /// True when this machine's log can be read at all (not empty, not disabled, not denied); else
    /// prints why and the caller skips, so a machine with a cleared log does not fail the suite.
    fn log_readable(channel: &str) -> bool {
        let r = run_wevtutil(channel, None, 1, false, Duration::from_secs(10))
            .and_then(|t| if t.timed_out { Err(UnreadableReason::TimedOutBeforeAnyRecord) } else { parse_log_start(&t.xml) });
        match r {
            Ok(_) => true,
            Err(reason) => {
                eprintln!("skipped {channel}: unfiltered query is unreadable here ({reason:?})");
                false
            }
        }
    }

    // ---- review r1: exit codes, encoding -------------------------------------------------------

    #[test]
    fn wevtutil_exit_codes_map_to_fixed_reasons_and_no_text() {
        assert_eq!(reason_for_exit_code(Some(5)), UnreadableReason::AccessDenied);
        assert_eq!(reason_for_exit_code(Some(15007)), UnreadableReason::ChannelNotFound);
        assert_eq!(reason_for_exit_code(Some(15000)), UnreadableReason::ChannelNotFound);
        assert_eq!(reason_for_exit_code(Some(1)), UnreadableReason::QueryFailed(Some(1)));
        assert_eq!(reason_for_exit_code(None), UnreadableReason::QueryFailed(None));
        // Every plain() line is fixed English: it holds no Windows text and no path.
        for r in [
            UnreadableReason::AccessDenied,
            UnreadableReason::ChannelNotFound,
            UnreadableReason::QueryFailed(Some(15011)),
            UnreadableReason::RecordsUnreadable(3),
            UnreadableReason::SteamPartiallyUnreadable { libraries: 1, records: 2 },
        ] {
            let s = r.plain();
            assert!(s.is_ascii() && !s.contains('\\'), "{s}");
        }
    }

    #[test]
    fn a_missing_channel_exit_code_is_a_fixed_reason() {
        match run_wevtutil("No-Such-Channel/Operational", None, 1, false, Duration::from_secs(5)) {
            Err(UnreadableReason::ChannelNotFound) | Err(UnreadableReason::QueryFailed(Some(_))) => {}
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn console_text_is_decoded_and_non_ascii_titles_are_flagged_uncertain() {
        // wevtutil writes ANSI/OEM, not UTF-8: a Latin-1 byte decodes per byte, UTF-8 as UTF-8.
        assert_eq!(decode_console_text(&[b'C', b'a', b'f', 0xE9]), "Caf\u{e9}");
        assert_eq!(decode_console_text("Caf\u{e9}".as_bytes()), "Caf\u{e9}");
        assert_eq!(decode_console_text(b"plain ascii"), "plain ascii");
        // Measured on this PC: U+200E reaches the pipe as a literal '?'.
        let xml = format!(
            "{}{}{}",
            wu("2026-11-19T00:00:00Z", "Caf\u{e9} Update - KB1234567 (Version 1.2)"),
            wu("2026-11-19T01:00:00Z", "Update ?Friday KB7654321"),
            wu("2026-11-19T02:00:00Z", "Plain Update KB1111111"),
        );
        let evs = wu_events_from_xml(&xml);
        let by = |kb: &str| evs.iter().find(|e| e.what.kb.as_deref() == Some(kb)).unwrap();
        assert!(by("KB1234567").what.text_uncertain);
        assert!(by("KB7654321").what.text_uncertain);
        assert!(!by("KB1111111").what.text_uncertain);
        // KB ids and times stay authoritative even when the text is uncertain.
        assert_eq!(by("KB1234567").when.at, Some(utc("2026-11-19T00:00:00Z")));
        // The same flag on driver rows whose provider text is non-ASCII.
        let d = pnp("2026-11-19T00:00:00Z", "PCI\\VEN_1&amp;DEV_2\\3&amp;4", "oem3.inf", DISPLAY, "1.0", "01/01/2026", true, "0x0")
            .replace("Advanced Micro Devices, Inc.", "Soci\u{e9}t\u{e9}");
        assert!(driver_events_from_xml(&d)[0].what.text_uncertain);
    }

    // ---- review r1: driver version_changed ----------------------------------------------------

    #[test]
    fn version_changed_separates_real_changes_from_same_version_and_unknown() {
        let a = "PCI\\VEN_1&amp;DEV_2\\3&amp;4";
        let b = "PCI\\VEN_9&amp;DEV_9\\3&amp;4";
        let xml = [
            pnp("2026-11-01T00:00:00Z", a, "oem1.inf", DISPLAY, "1.0", "01/01/2026", true, "0x0"),
            pnp("2026-11-10T00:00:00Z", a, "oem2.inf", DISPLAY, "2.0", "01/01/2026", true, "0x0"),
            pnp("2026-11-15T00:00:00Z", a, "oem2.inf", DISPLAY, "2.0", "01/01/2026", true, "0x0"),
            pnp("2026-11-12T00:00:00Z", b, "oem5.inf", MEDIA, "5.0", "01/01/2026", true, "0x0"),
        ]
        .concat();
        let evs = driver_events_from_xml(&xml);
        let at = |t: &str, id: &str| evs.iter().find(|e| e.when.at == Some(utc(t)) && e.what.id.as_deref().unwrap().contains(id)).unwrap();
        let first = at("2026-11-01T00:00:00Z", "VEN_1");
        assert_eq!((first.what.version_changed, first.what.from_version.as_deref()), (None, None));
        assert!(first.what.detail.as_deref().unwrap().contains("previous version unknown"));
        let changed = at("2026-11-10T00:00:00Z", "VEN_1");
        assert_eq!((changed.what.version_changed, changed.what.from_version.as_deref()), (Some(true), Some("1.0")));
        let same = at("2026-11-15T00:00:00Z", "VEN_1");
        assert_eq!((same.what.version_changed, same.what.from_version.as_deref()), (Some(false), None));
        // Another device's state is separate.
        assert_eq!(at("2026-11-12T00:00:00Z", "VEN_9").what.version_changed, None);
        // The engine's filter: real version changes only, no text parsing.
        let real: Vec<_> = evs.iter().filter(|e| e.what.version_changed == Some(true)).collect();
        assert_eq!(real.len(), 1);
    }

    // ---- review r1: DST gap, programs without a date ----------------------------------------------

    #[test]
    fn a_day_whose_local_midnight_does_not_exist_still_gets_a_window() {
        // Clocks jump 00:00 -> 01:00 on 2018-11-04 (e.g. Sao Paulo, UTC-3 -> UTC-2): 00:00-00:59
        // does not exist locally. The day must start at 01:00 local, not vanish.
        let gap_day = NaiveDate::from_ymd_opt(2018, 11, 4).unwrap();
        let resolve = move |n: NaiveDateTime| -> Option<DateTime<Utc>> {
            if n.date() == gap_day && n.time() < chrono::NaiveTime::from_hms_opt(1, 0, 0).unwrap() {
                return None;
            }
            let offset_hours = if n.date() >= gap_day { 2 } else { 3 }; // local = UTC - offset
            Some(DateTime::from_naive_utc_and_offset(n + ChronoDuration::hours(offset_hours), Utc))
        };
        let (start, end) = day_window_with(&resolve, gap_day).expect("a window, not None");
        assert_eq!(start, utc("2018-11-04T03:00:00Z"), "first valid local instant, 01:00 at UTC-2");
        assert_eq!(end, utc("2018-11-05T02:00:00Z"));
        // And the program on that day is listed, not dropped.
        let f = UninstallFields {
            display_name: Some("Tool".into()),
            install_date: Some("20181104".into()),
            ..UninstallFields::default()
        };
        let ev = uninstall_event(&f, &|d| day_window_with(&resolve, d)).expect("event on the DST-gap day");
        assert_eq!(ev.when.at, Some(start));
    }

    #[test]
    fn programs_without_a_usable_date_are_counted_not_dropped() {
        let w = |d| day_window_in(&pst(), d);
        let mut no_date = fields("NoDate", "20261119");
        no_date.install_date = None;
        let entries = vec![fields("Dated", "20261119"), no_date, fields("BadDate", "soon"), {
            let mut s = fields("Sys", "20261119");
            s.system_component = true;
            s
        }];
        let scan = collect_uninstall(entries.into_iter().map(Some), Instant::now() + Duration::from_secs(5), &w);
        assert_eq!(scan.events.len(), 1);
        assert_eq!(scan.without_date, 2, "NoDate and BadDate; the system component is not a program");
        assert!(!scan.timed_out);
    }

    #[test]
    fn the_real_program_reader_states_its_limits() {
        match read_installed_programs(Duration::from_secs(5)) {
            SourceRead::Read(ok) => {
                assert!(ok.notes.contains(&Note::StoreAppsNotCovered));
                assert_eq!(ok.covered_from, None, "the registry has no log start");
            }
            SourceRead::Unreadable(r) => panic!("{r:?}"),
        }
    }

    // ---- review r1: Steam libraries --------------------------------------------------------------

    fn temp_root(tag: &str) -> PathBuf {
        let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let p = std::env::temp_dir().join(format!("compy-f4-{tag}-{}-{n}", std::process::id()));
        std::fs::create_dir_all(p.join("steamapps")).unwrap();
        p
    }

    fn acf_for(app_id: u32, install_dir: &str, build: u32) -> String {
        ACF.replace("1217060", &app_id.to_string())
            .replace("\"installdir\"\t\t\"Example Game\"", &format!("\"installdir\"\t\t\"{install_dir}\""))
            .replace("26448669", &build.to_string())
    }

    fn steam_roots_for(paths: &[&PathBuf]) -> Vec<String> {
        paths.iter().map(|p| p.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn a_library_on_a_missing_drive_is_could_not_read_not_not_found() {
        let ok_lib = temp_root("a");
        let roots = vec![ok_lib.to_string_lossy().into_owned(), "Z:\\__compy_missing_library__".to_string()];
        let game = GameRef { steam_app_id: Some(1217060), ..GameRef::default() };
        match find_in_libraries(&roots, false, &game, Duration::from_secs(5)) {
            SourceRead::Unreadable(r @ UnreadableReason::SteamPartiallyUnreadable { libraries: 1, records: 0 }) => {
                assert!(r.plain().contains("could not read") && !r.plain().contains("no record"), "{}", r.plain());
            }
            other => panic!("{other:?}"),
        }
        // The same libraries with everything readable: now it is a plain not-found.
        let both = steam_roots_for(&[&ok_lib]);
        assert_eq!(
            find_in_libraries(&both, false, &game, Duration::from_secs(5)),
            SourceRead::Unreadable(UnreadableReason::SteamGameNotFound)
        );
        // An unreadable libraryfolders.vdf also stops "not found" from being claimed.
        assert!(matches!(
            find_in_libraries(&both, true, &game, Duration::from_secs(5)),
            SourceRead::Unreadable(UnreadableReason::SteamPartiallyUnreadable { libraries: 1, .. })
        ));
        let _ = std::fs::remove_dir_all(&ok_lib);
    }

    #[test]
    fn a_half_written_manifest_is_counted_not_hidden() {
        let lib = temp_root("b");
        std::fs::write(lib.join("steamapps").join("appmanifest_5.acf"), "\"AppState\"\n{\n\"appid\"\t\"5").unwrap();
        let game = GameRef { steam_app_id: Some(5), ..GameRef::default() };
        let roots = steam_roots_for(&[&lib]);
        assert_eq!(
            find_in_libraries(&roots, false, &game, Duration::from_secs(5)),
            SourceRead::Unreadable(UnreadableReason::SteamPartiallyUnreadable { libraries: 0, records: 1 })
        );
        let _ = std::fs::remove_dir_all(&lib);
    }

    #[test]
    fn the_install_folder_match_is_scoped_to_the_library_the_game_is_in() {
        let (c_lib, d_lib) = (temp_root("c"), temp_root("d"));
        // Stale manifest in library C (build 1); the live one in library D (build 2). Same folder name.
        std::fs::write(c_lib.join("steamapps").join("appmanifest_7.acf"), acf_for(7, "Foo", 1)).unwrap();
        std::fs::write(d_lib.join("steamapps").join("appmanifest_7.acf"), acf_for(7, "Foo", 2)).unwrap();
        let install = format!("{}\\steamapps\\common\\Foo", d_lib.to_string_lossy());
        let game = GameRef { install_dir: Some(install.clone()), ..GameRef::default() };
        let roots = steam_roots_for(&[&c_lib, &d_lib]);
        match find_in_libraries(&roots, false, &game, Duration::from_secs(5)) {
            SourceRead::Read(ok) => assert_eq!(ok.events[0].what.build_id.as_deref(), Some("2"), "the D library's manifest, not C's stale one"),
            other => panic!("{other:?}"),
        }
        // Only the stale manifest exists, in the other library: not a match, and plainly not found.
        let _ = std::fs::remove_file(d_lib.join("steamapps").join("appmanifest_7.acf"));
        assert_eq!(
            find_in_libraries(&roots, false, &game, Duration::from_secs(5)),
            SourceRead::Unreadable(UnreadableReason::SteamGameNotFound)
        );
        assert_eq!(library_root_of(&install), Some(normalize_root(&d_lib.to_string_lossy())));
        let _ = std::fs::remove_dir_all(&c_lib);
        let _ = std::fs::remove_dir_all(&d_lib);
    }

    #[test]
    fn steam_registry_states_are_distinct_reasons() {
        // Fixed codes the engine can tell apart; the actual registry lookup is covered on the real PC.
        assert_ne!(UnreadableReason::SteamNotFound, UnreadableReason::SteamUnreadable);
        assert_ne!(UnreadableReason::SteamGameNotFound, UnreadableReason::SteamNotFound);
        assert!(UnreadableReason::SteamNotFound.plain().contains("was not found"));
        assert!(UnreadableReason::SteamUnreadable.plain().contains("could not be read"));
    }

    #[test]
    fn steam_update_time_is_documented_as_a_file_change_not_a_new_version() {
        let lib = temp_root("e");
        std::fs::write(lib.join("steamapps").join("appmanifest_1217060.acf"), ACF).unwrap();
        let game = GameRef { steam_app_id: Some(1217060), ..GameRef::default() };
        match find_in_libraries(&steam_roots_for(&[&lib]), false, &game, Duration::from_secs(5)) {
            SourceRead::Read(ok) => assert!(ok.notes.contains(&Note::SteamUpdateTimeIsFileChange)),
            other => panic!("{other:?}"),
        }
        let _ = std::fs::remove_dir_all(&lib);
    }

    // ---- review r2: per-kind status, registry gaps, validated text, caps ----------------------------

    fn win() -> (DateTime<Utc>, DateTime<Utc>) {
        (utc("2026-11-01T00:00:00Z"), utc("2026-11-20T00:00:00Z"))
    }

    fn read_with(covered_from: Option<DateTime<Utc>>, gaps: Vec<Gap>, notes: Vec<Note>) -> SourceRead {
        SourceRead::Read(ReadOk { events: vec![], covered_from, gaps, notes })
    }

    #[test]
    fn a_source_that_was_not_asked_is_not_asked_and_never_clean() {
        let (t0, t1) = win();
        let r = combine(t0, t1, vec![(Source::DriverLog, ok(vec![]))]).unwrap();
        assert!(r.events_found.is_empty());
        assert_eq!(r.status(ChangeKind::GameUpdate), KindStatus::NotAsked);
        assert_eq!(r.status(ChangeKind::WindowsUpdate), KindStatus::NotAsked);
        assert!(matches!(r.status(ChangeKind::GpuDriver), KindStatus::Complete { .. }));
        assert!(matches!(r.status(ChangeKind::OtherDriver), KindStatus::Complete { .. }));
        // Real call with no game: Steam is not asked, the other three are.
        let now = Utc::now();
        let real = changes_between(now - ChronoDuration::days(2), now, None).unwrap();
        assert_eq!(real.status(ChangeKind::GameUpdate), KindStatus::NotAsked);
        for s in [Source::DriverLog, Source::WindowsUpdateLog, Source::UninstallKeys] {
            assert!(real.asked.contains(&s), "{s:?}");
        }
        assert!(!real.asked.contains(&Source::SteamManifest));
    }

    #[test]
    fn a_clean_program_read_with_no_events_is_complete_and_states_its_limits() {
        let (t0, t1) = win();
        let read = read_with(None, vec![], vec![Note::StoreAppsNotCovered, Note::ProgramsWithoutDate(3)]);
        let r = combine(t0, t1, vec![(Source::UninstallKeys, read)]).unwrap();
        assert!(r.events_found.is_empty());
        match r.status(ChangeKind::ProgramInstalled) {
            KindStatus::Complete { limits } => {
                assert!(limits.contains(&Note::StoreAppsNotCovered));
                assert!(limits.contains(&Note::ProgramsWithoutDate(3)));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn unreadable_and_partial_kinds_say_so_through_status() {
        let (t0, t1) = win();
        let r = combine(
            t0,
            t1,
            vec![
                (Source::WindowsUpdateLog, SourceRead::Unreadable(UnreadableReason::AccessDenied)),
                (Source::DriverLog, read_with(Some(utc("2026-11-10T00:00:00Z")), vec![Gap::TimedOut], vec![])),
            ],
        )
        .unwrap();
        assert_eq!(r.status(ChangeKind::WindowsUpdate), KindStatus::Unreadable(UnreadableReason::AccessDenied));
        match r.status(ChangeKind::GpuDriver) {
            KindStatus::Partial { gaps, covered_from, .. } => {
                assert_eq!(gaps, vec![Gap::TimedOut]);
                assert_eq!(covered_from, Some(utc("2026-11-10T00:00:00Z")));
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn cap_and_timeout_gaps_are_dropped_when_the_read_reached_the_window_start() {
        let (t0, t1) = win();
        let gaps = || vec![Gap::RowCapReached, Gap::TimedOut, Gap::OutputCapped, Gap::MalformedRecords(1)];
        for from in [t0 - ChronoDuration::days(1), t0] {
            let r = combine(t0, t1, vec![(Source::DriverLog, read_with(Some(from), gaps(), vec![]))]).unwrap();
            assert_eq!(r.partial.len(), 1);
            assert_eq!(r.partial[0].gaps, vec![Gap::MalformedRecords(1)], "only the real gap stays: {from}");
        }
        // Stopped inside the window: every gap stays.
        let r = combine(t0, t1, vec![(Source::DriverLog, read_with(Some(t0 + ChronoDuration::days(1)), gaps(), vec![]))]).unwrap();
        assert_eq!(r.partial[0].gaps, gaps());
        // Only a cap that reached the window start: no partial at all.
        let r = combine(t0, t1, vec![(Source::DriverLog, read_with(Some(t0), vec![Gap::RowCapReached], vec![]))]).unwrap();
        assert!(r.partial.is_empty());
        assert!(matches!(r.status(ChangeKind::GpuDriver), KindStatus::Complete { .. }));
    }

    #[test]
    fn an_inverted_or_empty_window_is_an_error_not_a_clean_report() {
        let (t0, t1) = win();
        assert_eq!(combine(t1, t0, vec![]), Err(ChangeError::EmptyWindow));
        assert_eq!(combine(t0, t0, vec![]), Err(ChangeError::EmptyWindow));
        assert_eq!(changes_between(t1, t0, None), Err(ChangeError::EmptyWindow));
        assert!(combine(t0, t1, vec![]).is_ok());
    }

    #[test]
    fn failed_registry_keys_are_counted_and_a_failed_main_hive_is_unreadable() {
        let w = |d| day_window_in(&pst(), d);
        let entries = vec![Some(fields("A", "20261119")), None, None];
        let scan = collect_uninstall(entries.into_iter(), Instant::now() + Duration::from_secs(5), &w);
        assert_eq!(scan.events.len(), 1);
        assert_eq!(scan.unreadable_keys, 2);
        use std::io::ErrorKind::{NotFound, PermissionDenied};
        assert_eq!(hive_open_effect(true, NotFound), Err(UnreadableReason::RegistryUnreadable));
        assert_eq!(hive_open_effect(true, PermissionDenied), Err(UnreadableReason::RegistryUnreadable));
        assert_eq!(hive_open_effect(false, NotFound), Ok(0), "an optional key that does not exist is normal");
        assert_eq!(hive_open_effect(false, PermissionDenied), Ok(1));
    }

    #[test]
    fn versions_and_build_ids_accept_only_digits_and_dots() {
        assert_eq!(clean_version(" 32.0.32029.2010 ").as_deref(), Some("32.0.32029.2010"));
        for bad in ["", "32.0.3?.2010", "1.2 beta", "<b>1.2</b>", "\u{fffd}1.2", "1,2"] {
            assert_eq!(clean_version(bad), None, "{bad:?}");
        }
        assert_eq!(clean_build_id("26448669").as_deref(), Some("26448669"));
        for bad in ["", "26?48669", "1.2", "-5", "12 3"] {
            assert_eq!(clean_build_id(bad), None, "{bad:?}");
        }
        for s in ["KB1234?67", "KB\u{661}\u{662}\u{663}\u{664}\u{665}\u{666}\u{667}", "KB 1234567"] {
            if let Some(k) = kb_of(s) {
                assert!(k.starts_with("KB") && k[2..].chars().all(|c| c.is_ascii_digit()) && k.len() > 2, "{s:?} -> {k}");
            }
        }
    }

    #[test]
    fn a_mojibake_driver_version_is_dropped_and_flagged() {
        let xml = pnp("2026-11-19T13:38:22Z", GPU_INST, "oem3.inf", DISPLAY, "32.0.3?.2010", "11/18/2026", true, "0x0");
        let evs = driver_events_from_xml(&xml);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].what.to_version, None);
        assert!(evs[0].what.text_uncertain);
        let good = pnp("2026-11-19T13:38:22Z", GPU_INST, "oem3.inf", DISPLAY, "32.0.32029.2010", "11/18/2026", true, "0x0");
        assert!(!driver_events_from_xml(&good)[0].what.text_uncertain);
    }

    #[test]
    fn a_mojibake_build_id_is_dropped_and_flagged() {
        let bad = ACF.replace("\"buildid\"\t\t\"26448669\"", "\"buildid\"\t\t\"2644?669\"");
        let info = parse_acf(&bad).unwrap();
        assert_eq!(info.build_id, None);
        assert!(info.ids_uncertain);
        let ev = game_event_from_acf(&info).unwrap();
        assert_eq!(ev.what.build_id, None);
        assert!(ev.what.text_uncertain);
        let good = game_event_from_acf(&parse_acf(ACF).unwrap()).unwrap();
        assert!(!good.what.text_uncertain);
    }

    #[test]
    fn the_driver_read_names_the_classes_it_covers() {
        let labels: Vec<&str> = DRIVER_CLASSES.iter().map(|(_, _, l)| *l).collect();
        assert_eq!(labels, vec!["display", "audio", "network", "chipset/system"]);
        if !log_readable("Microsoft-Windows-Kernel-PnP/Configuration") {
            return;
        }
        let now = Utc::now();
        match read_driver_installs(now - ChronoDuration::days(3), now, Duration::from_secs(10)) {
            SourceRead::Read(ok) => {
                let covered = ok.notes.iter().find_map(|n| match n {
                    Note::DriverClassesCovered(v) => Some(v.clone()),
                    _ => None,
                });
                assert_eq!(covered, Some(labels.iter().map(|s| s.to_string()).collect::<Vec<_>>()));
            }
            SourceRead::Unreadable(r) => panic!("{r:?}"),
        }
    }

    #[test]
    fn output_beyond_the_byte_cap_is_dropped_and_flagged() {
        let mut b = Vec::new();
        assert!(!append_capped(&mut b, b"abcd", 6));
        assert!(append_capped(&mut b, b"efgh", 6));
        assert_eq!(b, b"abcdef");
        assert!(append_capped(&mut b, b"x", 6));
        assert_eq!(b.len(), 6);
        // A real child that writes far more than the cap.
        let mut cmd = system_command("cmd.exe").expect("cmd.exe");
        cmd.args(["/c", "for /l %i in (1,1,20000) do @echo xxxxxxxxxxxxxxxxxxxx"]);
        let out = run_capped(cmd, Duration::from_secs(30), 1000).expect("ran");
        assert!(!out.timed_out);
        assert!(out.overflow, "20000 lines is far over a 1000 byte cap");
        assert!(out.stdout.len() <= 1000);
        // And the read that saw it is partial, never complete.
        let xml = wu_rows(10);
        let a = assess_with(&xml, false, true, Some(utc("2026-01-01T00:00:00Z")), parse_wu(&xml)).unwrap();
        assert_eq!(a.gaps, vec![Gap::OutputCapped]);
        assert_eq!(a.covered_from, Some(utc("2026-11-19T12:00:00Z") - ChronoDuration::minutes(9)));
    }

    // ---- the real PC (run on demand) -----------------------------------------------------------

    /// `cargo test --lib change_sources::tests::real_pc_report -- --ignored --nocapture`
    #[test]
    #[ignore = "reads this PC's real Windows records; run on demand"]
    fn real_pc_report() {
        let now = Utc::now();
        let t0 = now - ChronoDuration::days(30);
        let describe = |r: &SourceRead| match r {
            SourceRead::Read(ok) => format!(
                "read {} rows-as-events, covered_from={}, gaps={:?}, notes={:?}",
                ok.events.len(),
                ok.covered_from.map_or("n/a".to_string(), |t| t.format("%Y-%m-%dT%H:%MZ").to_string()),
                ok.gaps,
                ok.notes
            ),
            SourceRead::Unreadable(why) => format!("UNREADABLE {why:?}"),
        };
        let timed = |label: &str, f: &dyn Fn() -> SourceRead| {
            let s = Instant::now();
            let r = f();
            println!("timing {label}: {} ms ({})", s.elapsed().as_millis(), describe(&r));
        };
        timed("drivers (120d lookback)", &|| read_driver_installs(t0 - ChronoDuration::days(DRIVER_LOOKBACK_DAYS), now, DEFAULT_BUDGET));
        timed("windows update (30d)", &|| read_windows_updates(t0, now, DEFAULT_BUDGET));
        timed("installed programs", &|| read_installed_programs(DEFAULT_BUDGET));

        let games = read_all_steam_games(DEFAULT_BUDGET).unwrap_or_default();
        println!("steam games with a readable update time: {}", games.len());
        let game = games.first().and_then(|g| g.what.id.as_deref()).and_then(|id| id.parse::<u32>().ok());
        let gref = game.map(|id| GameRef { steam_app_id: Some(id), ..GameRef::default() });
        let steam = gref.as_ref().map(|g| read_game_update(g, DEFAULT_BUDGET));
        if let Some(s) = &steam {
            println!("steam read: {}", describe(s));
        }

        let s = Instant::now();
        let r = changes_between(t0, now, gref.as_ref()).unwrap();
        println!("changes_between(30d) total wall time: {} ms", s.elapsed().as_millis());
        println!("window: ({}, {}]", r.window_start.to_rfc3339(), r.window_end.to_rfc3339());
        println!("unreadable: {:?}", r.unreadable.iter().map(|u| (u.source, u.reason.plain())).collect::<Vec<_>>());
        println!("partial: {:?}", r.partial.iter().map(|p| (p.source, &p.gaps, p.covered_from.map(|t| t.format("%Y-%m-%dT%H:%MZ").to_string()))).collect::<Vec<_>>());
        println!("coverage_gaps: {:?}   undated_excluded: {}", r.coverage_gaps, r.undated_excluded);
        println!("notes: {:?}", r.notes);
        let count = |k: ChangeKind| r.events_found.iter().filter(|e| e.kind == k).count();
        println!(
            "counts: gpu_driver={} other_driver={} windows_update={} game_update={} programs_installed={}",
            count(ChangeKind::GpuDriver),
            count(ChangeKind::OtherDriver),
            count(ChangeKind::WindowsUpdate),
            count(ChangeKind::GameUpdate),
            count(ChangeKind::ProgramInstalled)
        );
        let uncertain = r.events_found.iter().filter(|e| e.what.text_uncertain).count();
        println!("events with text_uncertain: {uncertain}");
        let fmt = |e: &ChangeEvent| {
            let when = match e.when.precision {
                Precision::Exact => format!("{} exact", e.when.at.unwrap().format("%Y-%m-%dT%H:%MZ")),
                Precision::Day => format!("day {}..{}", e.when.at.unwrap().format("%m-%dT%H:%MZ"), e.when.until.unwrap().format("%m-%dT%H:%MZ")),
                Precision::Unknown => "unknown".into(),
            };
            format!(
                "  {:?} {} | {} -> {} | changed={:?} | {}",
                e.kind,
                when,
                e.what.from_version.as_deref().unwrap_or("?"),
                e.what.to_version.as_deref().unwrap_or("?"),
                e.what.version_changed,
                e.what.kb.as_deref().or(e.what.id.as_deref()).unwrap_or("-"),
            )
        };
        for e in r.events_found.iter().filter(|e| e.kind == ChangeKind::GpuDriver) {
            println!("{}", fmt(e));
        }
        let others = r.events_found.iter().filter(|e| e.kind == ChangeKind::OtherDriver);
        println!("  other drivers: {} ({} real version changes)", others.clone().count(), others.filter(|e| e.what.version_changed == Some(true)).count());
        for e in r.events_found.iter().filter(|e| e.kind == ChangeKind::WindowsUpdate && e.what.detail.as_deref() != Some("definition") && e.what.detail.as_deref() != Some("store-app")) {
            println!("{} | {}", fmt(e), e.what.detail.as_deref().unwrap_or(""));
        }
        let defs = r.events_found.iter().filter(|e| e.what.detail.as_deref() == Some("definition")).count();
        let store = r.events_found.iter().filter(|e| e.what.detail.as_deref() == Some("store-app")).count();
        println!("  (windows update also: {defs} Defender definition installs, {store} Store-app installs)");
        if let Some(g) = &r.game_last_update {
            println!("game last file change (outside window allowed): {}", fmt(g));
        }
    }
}
