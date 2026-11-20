//! Paramedic F4 - dated "what changed on this PC, and when" readers (read-only).
//!
//! Gives the diagnosis engine dated facts from Windows itself instead of only what Compy happened
//! to be capturing: GPU / other driver installs, Windows Update installs, a Steam game's last
//! update, and installed programs. Local, user-mode, no elevation, no network, no writes, no
//! driver, no injection (ARCHITECTURE_LOCKS 1.8: "ETW, vendor-supported SDKs, local files, WMI/CIM,
//! or another lower-risk user-mode route"). Nothing here is added to any support bundle or
//! outbound payload, and nothing is logged: program and game names are data about the user.
//!
//! Sources, chosen on this PC without elevation (see _train/f4-windows-facts.md):
//! - Drivers: System-class channel `Microsoft-Windows-Kernel-PnP/Configuration`, event 400 ("device
//!   was configured") with `DeviceUpdated=true`. The design's UserPnp 20001/20003 is NOT usable:
//!   20003 only reports service adds and 20001 never appears. Times are UTC and exact.
//! - Windows Update: System log `Microsoft-Windows-WindowsUpdateClient` event 19 (installation
//!   successful; `updateTitle` carries the KB). UTC and exact.
//! - Game update: Steam `steamapps\appmanifest_<id>.acf` (`buildid`, `LastUpdated` epoch seconds).
//! - Programs: registry `...\Uninstall\*` `InstallDate` (a LOCAL calendar date, day precision).
//!
//! Event-log reads go through the built-in `wevtutil.exe` (a hidden child process that can be
//! killed at the budget), the same "built-in Windows tool, no window" approach `blackbox.rs` uses
//! for `Get-WinEvent`, but ~50 ms instead of a PowerShell start-up. Parsing is pure and separate
//! from I/O so every parser is tested from fixture text.
//!
//! Honesty rule: a source that could not be read is `Unreadable(reason)`, never an empty list, so
//! the engine can say "Compy could not read this" and never "nothing changed".
#![allow(dead_code)] // wired into paramedic in the next commit

use chrono::{DateTime, Duration as ChronoDuration, NaiveDate, TimeZone, Utc};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

/// Hard time budget per reader unless the caller passes another.
pub(crate) const DEFAULT_BUDGET: Duration = Duration::from_millis(500);
/// How far back the driver reader looks so a driver event can name the version it replaced.
const DRIVER_LOOKBACK_DAYS: i64 = 120;
/// Newest-first cap on event-log rows per query.
const MAX_EVENTS: u32 = 600;
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
    GameUpdate,
    ProgramInstalled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Precision {
    /// `at` is the instant (UTC) Windows recorded.
    Exact,
    /// The source only knows a local calendar day: the change happened in `[at, until)`.
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

impl Source {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Source::DriverLog => "Windows System log: Kernel-PnP/Configuration event 400 (driver configured)",
            Source::WindowsUpdateLog => "Windows System log: WindowsUpdateClient event 19 (installation successful)",
            Source::SteamManifest => "Steam appmanifest (buildid, LastUpdated)",
            Source::UninstallKeys => "Registry Uninstall key InstallDate",
        }
    }
}

/// Plain fields; every one optional because no source has all of them.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub(crate) struct ChangeWhat {
    pub name: Option<String>,
    pub id: Option<String>,
    pub from_version: Option<String>,
    pub to_version: Option<String>,
    /// Windows Update KB id, e.g. "KB5007651".
    pub kb: Option<String>,
    /// Steam build id.
    pub build_id: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ChangeEvent {
    pub kind: ChangeKind,
    pub when: ChangeTime,
    pub what: ChangeWhat,
    pub source: Source,
}

/// One reader's outcome. `Unreadable` is NOT the same as `Read` with no events.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum SourceRead {
    /// `timed_out`: the budget ran out and `events` is only what was read so far.
    Read { events: Vec<ChangeEvent>, timed_out: bool },
    Unreadable(String),
}

impl SourceRead {
    /// A reader that ran out of budget having produced nothing has not shown "nothing changed":
    /// it is unreadable. Partial output stays partial and keeps `timed_out`.
    fn finish(events: Vec<ChangeEvent>, timed_out: bool, what: &str) -> SourceRead {
        if timed_out && events.is_empty() {
            SourceRead::Unreadable(format!("{what} did not finish within its time budget"))
        } else {
            SourceRead::Read { events, timed_out }
        }
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
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ChangeReport {
    pub window_start: DateTime<Utc>,
    pub window_end: DateTime<Utc>,
    /// Inside the window `(window_start, window_end]`, oldest first.
    pub events: Vec<ChangeEvent>,
    /// Sources Compy could not read. "Could not read" is never "nothing changed".
    pub unreadable: Vec<UnreadableSource>,
    /// Sources that hit their time budget: `events` holds only what was read before that.
    pub partial: Vec<Source>,
    /// The game's last update from Steam regardless of the window (so "not updated since X" can be
    /// said), when a game was asked about and could be read.
    pub game_last_update: Option<ChangeEvent>,
    /// Events a source returned without a usable time; excluded from `events`.
    pub undated_excluded: usize,
}

// ---------------------------------------------------------------------------------------------
// Budgeted child process + loop helpers
// ---------------------------------------------------------------------------------------------

struct RunOutput {
    stdout: Vec<u8>,
    stderr: String,
    timed_out: bool,
    success: bool,
}

/// Run a child with piped output and a hard deadline. At the deadline the child is killed and
/// whatever it had already written is returned with `timed_out: true`.
fn run_with_budget(mut cmd: std::process::Command, budget: Duration) -> Result<RunOutput, String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("the Windows reader could not be started ({:?})", e.kind()))?;
    let out_buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let err_buf = Arc::new(Mutex::new(Vec::<u8>::new()));
    let pump = |mut pipe: Box<dyn Read + Send>, buf: Arc<Mutex<Vec<u8>>>| {
        std::thread::spawn(move || {
            let mut chunk = [0u8; 16 * 1024];
            loop {
                match pipe.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if let Ok(mut b) = buf.lock() {
                            b.extend_from_slice(&chunk[..n]);
                        }
                    }
                }
            }
        })
    };
    let t_out = child.stdout.take().map(|p| pump(Box::new(p), out_buf.clone()));
    let t_err = child.stderr.take().map(|p| pump(Box::new(p), err_buf.clone()));

    let deadline = Instant::now() + budget;
    let (mut timed_out, mut success) = (false, false);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                success = status.success();
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
    let stderr_bytes = err_buf.lock().map(|b| b.clone()).unwrap_or_default();
    Ok(RunOutput {
        stdout,
        stderr: String::from_utf8_lossy(&stderr_bytes).trim().to_string(),
        timed_out,
        success,
    })
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

/// Query one event-log channel with `wevtutil qe` (no elevation for System-class channels).
/// Returns the XML text and whether the budget ran out.
fn run_wevtutil(channel: &str, xpath: &str, budget: Duration) -> Result<(String, bool), String> {
    let mut cmd = crate::actions::quiet_command("wevtutil.exe");
    cmd.args([
        "qe",
        channel,
        &format!("/q:{xpath}"),
        &format!("/c:{MAX_EVENTS}"),
        "/rd:true",
        "/f:xml",
    ]);
    let out = run_with_budget(cmd, budget)?;
    if !out.timed_out && !out.success {
        let first = out.stderr.lines().next().unwrap_or("no detail").trim();
        let first: String = first.chars().take(120).collect();
        return Err(format!("the Windows event log could not be queried ({first})"));
    }
    Ok((String::from_utf8_lossy(&out.stdout).into_owned(), out.timed_out))
}

fn xpath_time(since: DateTime<Utc>) -> String {
    since.format("%Y-%m-%dT%H:%M:%S.000Z").to_string()
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
// Drivers: Kernel-PnP/Configuration event 400
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq)]
struct PnpRecord {
    at: DateTime<Utc>,
    instance_id: String,
    driver_name: Option<String>,
    class_guid: String,
    version: Option<String>,
    driver_date: Option<NaiveDate>,
    provider: Option<String>,
    updated: bool,
    status_ok: bool,
}

/// Pure: every well-formed event 400 in `xml`. Malformed blocks are skipped.
fn parse_pnp_records(xml: &str) -> Vec<PnpRecord> {
    event_blocks(xml)
        .into_iter()
        .filter_map(|b| {
            if xml_event_id(b)? != 400 {
                return None;
            }
            let at = xml_event_time(b)?;
            let instance_id = xml_data(b, "DeviceInstanceId").filter(|s| !s.is_empty())?;
            let status = xml_data(b, "Status").unwrap_or_default();
            let status_ok = status.is_empty() || u32::from_str_radix(status.trim_start_matches("0x"), 16) == Ok(0);
            Some(PnpRecord {
                at,
                instance_id,
                driver_name: xml_data(b, "DriverName").filter(|s| !s.is_empty()),
                class_guid: xml_data(b, "ClassGuid").unwrap_or_default(),
                version: xml_data(b, "DriverVersion").filter(|s| !s.is_empty()),
                driver_date: xml_data(b, "DriverDate")
                    .and_then(|d| NaiveDate::parse_from_str(d.trim(), "%m/%d/%Y").ok()),
                provider: xml_data(b, "DriverProvider").filter(|s| !s.is_empty()),
                updated: xml_data(b, "DeviceUpdated").is_some_and(|v| v.eq_ignore_ascii_case("true")),
                status_ok,
            })
        })
        .collect()
}

/// Device-class GUID -> what the engine calls it. Software-component children (AMD's OpenCL /
/// Vulkan helper devices, ...) and every other class are not reported.
fn driver_class(guid: &str) -> Option<(ChangeKind, &'static str)> {
    let g = guid.trim().trim_matches(|c| c == '{' || c == '}').to_ascii_lowercase();
    match g.as_str() {
        "4d36e968-e325-11ce-bfc1-08002be10318" => Some((ChangeKind::GpuDriver, "display")),
        "4d36e96c-e325-11ce-bfc1-08002be10318" => Some((ChangeKind::OtherDriver, "audio")),
        "4d36e972-e325-11ce-bfc1-08002be10318" => Some((ChangeKind::OtherDriver, "network")),
        "4d36e97d-e325-11ce-bfc1-08002be10318" => Some((ChangeKind::OtherDriver, "chipset/system")),
        _ => None,
    }
}

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
    before: Option<String>,
    last_at: Option<DateTime<Utc>>,
    last_name: Option<String>,
}

/// Pure: driver installs from the raw configure records. Only `DeviceUpdated=true` rows with a
/// success status in a reported class count as installs; every row (updated or not) feeds the
/// "version before" lookup. Same device + inf + version within 10 minutes is one install.
fn driver_changes(mut recs: Vec<PnpRecord>) -> Vec<ChangeEvent> {
    recs.sort_by_key(|r| r.at);
    let mut states: HashMap<String, DeviceState> = HashMap::new();
    let mut out = Vec::new();
    for r in recs {
        let Some((kind, label)) = driver_class(&r.class_guid) else { continue };
        let st = states.entry(r.instance_id.clone()).or_default();
        let dup = st.cur == r.version
            && st.last_name == r.driver_name
            && st.last_at.is_some_and(|t| (r.at - t) <= ChronoDuration::seconds(DUP_SPAN_SECS));
        let changed = r.version.is_some() && st.cur != r.version;
        if changed {
            st.before = st.cur.take();
            st.cur = r.version.clone();
        }
        let from_version = if changed { st.before.clone() } else { r.version.clone() };
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
        if !changed {
            detail.push_str(", same version configured again");
        }
        out.push(ChangeEvent {
            kind,
            when: ChangeTime::exact(r.at),
            what: ChangeWhat {
                name: r.provider.clone(),
                id: Some(hardware_id_of(&r.instance_id)),
                from_version,
                to_version: r.version.clone(),
                detail: Some(detail),
                ..ChangeWhat::default()
            },
            source: Source::DriverLog,
        });
    }
    out
}

pub(crate) fn driver_events_from_xml(xml: &str) -> Vec<ChangeEvent> {
    driver_changes(parse_pnp_records(xml))
}

/// Driver installs since `since` (look back further than the window you care about: the extra
/// rows are what let an event say which version it replaced).
pub(crate) fn read_driver_installs(since: DateTime<Utc>, budget: Duration) -> SourceRead {
    let xpath = format!("*[System[(EventID=400)and(TimeCreated[@SystemTime>='{}'])]]", xpath_time(since));
    match run_wevtutil("Microsoft-Windows-Kernel-PnP/Configuration", &xpath, budget) {
        Ok((xml, timed_out)) => SourceRead::finish(driver_events_from_xml(&xml), timed_out, "The driver log"),
        Err(reason) => SourceRead::Unreadable(reason),
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

/// Pure: successful installs (event 19) in `xml`. Malformed blocks are skipped.
fn parse_wu_records(xml: &str) -> Vec<WuRecord> {
    event_blocks(xml)
        .into_iter()
        .filter_map(|b| {
            if xml_event_id(b)? != 19 {
                return None;
            }
            let title = xml_data(b, "updateTitle").map(|t| t.trim().to_string()).filter(|t| !t.is_empty())?;
            Some(WuRecord { at: xml_event_time(b)?, title })
        })
        .collect()
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
    } else if t.contains("driver") || (title.split(" - ").count() >= 3 && title.rsplit(" - ").next().is_some_and(|l| l.starts_with(|c: char| c.is_ascii_digit()))) {
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
                ..ChangeWhat::default()
            },
            source: Source::WindowsUpdateLog,
        });
    }
    out
}

pub(crate) fn wu_events_from_xml(xml: &str) -> Vec<ChangeEvent> {
    wu_changes(parse_wu_records(xml))
}

pub(crate) fn read_windows_updates(since: DateTime<Utc>, budget: Duration) -> SourceRead {
    let xpath = format!(
        "*[System[Provider[@Name='Microsoft-Windows-WindowsUpdateClient']and(EventID=19)and(TimeCreated[@SystemTime>='{}'])]]",
        xpath_time(since)
    );
    match run_wevtutil("System", &xpath, budget) {
        Ok((xml, timed_out)) => SourceRead::finish(wu_events_from_xml(&xml), timed_out, "The Windows Update log"),
        Err(reason) => SourceRead::Unreadable(reason),
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
    /// Epoch seconds (UTC) Steam last updated the game's files.
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
        build_id: nonempty("buildid"),
        target_build_id: nonempty("targetbuildid"),
        last_updated: nonempty("lastupdated").and_then(|v| v.parse::<i64>().ok()).filter(|s| *s > 0),
    })
}

/// Pure: the folder name under `steamapps\common\` for an install dir, if it lives in one.
fn steam_install_folder(install_dir: &str) -> Option<String> {
    let norm = install_dir.replace('/', "\\");
    let lower = norm.to_ascii_lowercase();
    let marker = "\\steamapps\\common\\";
    let i = lower.find(marker)? + marker.len();
    let rest = &norm[i..];
    let folder = rest.split('\\').next()?.trim();
    (!folder.is_empty()).then(|| folder.to_string())
}

/// Pure: is this manifest the asked-about game (app id wins; else the install folder name)?
fn manifest_matches(info: &AcfInfo, game: &GameRef) -> bool {
    if let Some(id) = game.steam_app_id {
        return info.app_id == id;
    }
    match (game.install_dir.as_deref().and_then(steam_install_folder), info.install_dir.as_deref()) {
        (Some(want), Some(have)) => want.eq_ignore_ascii_case(have),
        _ => false,
    }
}

/// Pure: the game-update event from a manifest, or why there is none.
fn game_event_from_acf(info: &AcfInfo) -> Result<ChangeEvent, String> {
    let secs = info
        .last_updated
        .ok_or_else(|| "Steam's record for this game has no update time".to_string())?;
    let at = Utc
        .timestamp_opt(secs, 0)
        .single()
        .ok_or_else(|| "Steam's record for this game has an unreadable update time".to_string())?;
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
            ..ChangeWhat::default()
        },
        source: Source::SteamManifest,
    })
}

fn steam_not_readable(why: &str) -> SourceRead {
    SourceRead::Unreadable(why.to_string())
}

/// Steam root plus every library folder it lists (registry `SteamPath`, `libraryfolders.vdf`).
fn steam_library_roots() -> Result<Vec<String>, String> {
    let steam: String = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
        .open_subkey("Software\\Valve\\Steam")
        .and_then(|k| k.get_value::<String, _>("SteamPath"))
        .map_err(|_| "Steam is not installed for this Windows user, so no Steam game record exists".to_string())?;
    let steam = steam.replace('/', "\\");
    let steam = steam.trim_end_matches('\\').to_string();
    let vdf = format!("{steam}\\steamapps\\libraryfolders.vdf");
    let mut roots = vec![steam];
    if let Ok(body) = std::fs::read_to_string(&vdf) {
        for p in crate::hardware::parse_steam_library_paths(&body) {
            if !roots.iter().any(|r| r.eq_ignore_ascii_case(&p)) {
                roots.push(p);
            }
        }
    }
    Ok(roots)
}

fn read_manifest(path: &std::path::Path) -> Option<AcfInfo> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.len() > 1_000_000 {
        return None;
    }
    parse_acf(&std::fs::read_to_string(path).ok()?)
}

/// Steam's record of when `game` was last updated. Anything that is not a readable Steam install
/// is `Unreadable` with a plain reason (other launchers are not read in this slice).
pub(crate) fn read_game_update(game: &GameRef, budget: Duration) -> SourceRead {
    if let Some(l) = game.launcher.as_deref().map(str::trim).filter(|l| !l.is_empty()) {
        if !l.eq_ignore_ascii_case("steam") {
            return SourceRead::Unreadable(format!(
                "This game is not a Steam install (launcher: {l}); Compy can only read update times from Steam"
            ));
        }
    }
    if game.steam_app_id.is_none() {
        match game.install_dir.as_deref() {
            None => return steam_not_readable("No game was identified, so there is no game update to look up"),
            Some(d) if steam_install_folder(d).is_none() => {
                return steam_not_readable(
                    "This game is not installed in a Steam library, so Compy cannot read when it was updated",
                )
            }
            Some(_) => {}
        }
    }
    let roots = match steam_library_roots() {
        Ok(r) => r,
        Err(e) => return SourceRead::Unreadable(e),
    };
    let deadline = Instant::now() + budget;
    let mut found: Option<AcfInfo> = None;
    let mut timed_out = false;
    'libs: for root in &roots {
        let dir = std::path::Path::new(root).join("steamapps");
        if let Some(id) = game.steam_app_id {
            // Fast path: the manifest name is the app id.
            if let Some(info) = read_manifest(&dir.join(format!("appmanifest_{id}.acf"))) {
                if manifest_matches(&info, game) {
                    found = Some(info);
                    break 'libs;
                }
            }
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        let manifests = entries.flatten().filter(|e| {
            let n = e.file_name().to_string_lossy().to_ascii_lowercase();
            n.starts_with("appmanifest_") && n.ends_with(".acf")
        });
        let mut hit = None;
        timed_out |= collect_until(manifests, deadline, |e| {
            if hit.is_none() {
                if let Some(info) = read_manifest(&e.path()) {
                    if manifest_matches(&info, game) {
                        hit = Some(info);
                    }
                }
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
            Ok(ev) => SourceRead::Read { events: vec![ev], timed_out: false },
            Err(e) => SourceRead::Unreadable(e),
        },
        None if timed_out => SourceRead::Unreadable("Steam's game records did not finish reading within the time budget".into()),
        None => SourceRead::Unreadable("This game was not found in any Steam library on this PC".into()),
    }
}

/// Every installed Steam game with a readable update time (app id, name, install folder, event).
/// For callers that want to enumerate, and for the real-PC check.
pub(crate) fn read_all_steam_games(budget: Duration) -> Result<Vec<ChangeEvent>, String> {
    let roots = steam_library_roots()?;
    let deadline = Instant::now() + budget;
    let mut out = Vec::new();
    for root in &roots {
        let Ok(entries) = std::fs::read_dir(std::path::Path::new(root).join("steamapps")) else { continue };
        let manifests = entries.flatten().filter(|e| {
            let n = e.file_name().to_string_lossy().to_ascii_lowercase();
            n.starts_with("appmanifest_") && n.ends_with(".acf")
        });
        let stopped = collect_until(manifests, deadline, |e| {
            if let Some(info) = read_manifest(&e.path()) {
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

/// `[start of local day, start of next local day)` in UTC for `date` in time zone `tz`.
fn day_window_in<Tz: TimeZone>(tz: &Tz, date: NaiveDate) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    let start = tz.from_local_datetime(&date.and_hms_opt(0, 0, 0)?).earliest()?;
    let end = tz.from_local_datetime(&date.succ_opt()?.and_hms_opt(0, 0, 0)?).earliest()?;
    Some((start.with_timezone(&Utc), end.with_timezone(&Utc)))
}

/// Pure (zone injected): one Uninstall entry as a program-installed event, or `None` when it is a
/// system component, a patch, nameless, or has no usable date.
fn uninstall_event(
    f: &UninstallFields,
    day_window: &dyn Fn(NaiveDate) -> Option<(DateTime<Utc>, DateTime<Utc>)>,
) -> Option<ChangeEvent> {
    if f.system_component || f.is_patch {
        return None;
    }
    let name = f.display_name.as_deref().map(str::trim).filter(|n| !n.is_empty())?;
    let date = parse_install_date(f.install_date.as_deref()?)?;
    let (start, end) = day_window(date)?;
    Some(ChangeEvent {
        kind: ChangeKind::ProgramInstalled,
        when: ChangeTime::day(start, end),
        what: ChangeWhat {
            name: Some(name.to_string()),
            to_version: f.display_version.clone().filter(|v| !v.trim().is_empty()),
            detail: Some(format!("installer-reported install date {date} (local day)")),
            ..ChangeWhat::default()
        },
        source: Source::UninstallKeys,
    })
}

/// Pure: events from a stream of entries, stopping at the deadline. Same name + version + day in
/// two registry views is one program.
fn collect_uninstall<I: Iterator<Item = UninstallFields>>(
    entries: I,
    deadline: Instant,
    day_window: &dyn Fn(NaiveDate) -> Option<(DateTime<Utc>, DateTime<Utc>)>,
) -> (Vec<ChangeEvent>, bool) {
    let mut out: Vec<ChangeEvent> = Vec::new();
    let mut seen: HashSet<(String, Option<String>, Option<DateTime<Utc>>)> = HashSet::new();
    let timed_out = collect_until(entries, deadline, |f| {
        if let Some(ev) = uninstall_event(&f, day_window) {
            let key = (ev.what.name.clone().unwrap_or_default(), ev.what.to_version.clone(), ev.when.at);
            if seen.insert(key) {
                out.push(ev);
            }
        }
    });
    (out, timed_out)
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

/// Programs the registry says were installed (any date; the combiner applies the window).
pub(crate) fn read_installed_programs(budget: Duration) -> SourceRead {
    let deadline = Instant::now() + budget;
    let mut names: Vec<(Hive, &'static str, String)> = Vec::new();
    let mut opened = 0;
    for (hive, path) in UNINSTALL_PATHS {
        if let Ok(k) = open_hive(hive).open_subkey_with_flags(path, winreg::enums::KEY_READ) {
            opened += 1;
            names.extend(k.enum_keys().flatten().map(|n| (hive, path, n)));
        }
    }
    if opened == 0 {
        return SourceRead::Unreadable("The installed-programs registry keys could not be opened".into());
    }
    let entries = names.into_iter().filter_map(|(h, p, n)| read_uninstall_fields(h, p, &n));
    let (events, timed_out) = collect_uninstall(entries, deadline, &|d| day_window_in(&chrono::Local, d));
    SourceRead::finish(events, timed_out, "The installed-programs list")
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
/// upper inclusive; see `ChangeTime::in_window`). Unreadable sources and budget-truncated sources
/// are listed, never dropped.
pub(crate) fn combine(t0: DateTime<Utc>, t1: DateTime<Utc>, reads: Vec<(Source, SourceRead)>) -> ChangeReport {
    let mut events: Vec<ChangeEvent> = Vec::new();
    let mut unreadable = Vec::new();
    let mut partial = Vec::new();
    let mut game_last_update: Option<ChangeEvent> = None;
    let mut undated_excluded = 0;
    for (source, read) in reads {
        match read {
            SourceRead::Unreadable(reason) => unreadable.push(UnreadableSource { source, reason }),
            SourceRead::Read { events: evs, timed_out } => {
                if timed_out {
                    partial.push(source);
                }
                for ev in evs {
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
        events,
        unreadable,
        partial,
        game_last_update,
        undated_excluded,
    }
}

/// What changed on this PC in `(t0, t1]`: runs every reader (in parallel, each with its own
/// budget) and combines them. `game` adds the Steam update lookup for that game. Never panics: a
/// reader that dies is reported as unreadable.
pub(crate) fn changes_between(t0: DateTime<Utc>, t1: DateTime<Utc>, game: Option<&GameRef>) -> ChangeReport {
    changes_between_with(t0, t1, game, DEFAULT_BUDGET)
}

pub(crate) fn changes_between_with(
    t0: DateTime<Utc>,
    t1: DateTime<Utc>,
    game: Option<&GameRef>,
    budget: Duration,
) -> ChangeReport {
    let lost = || SourceRead::Unreadable("The reader stopped unexpectedly".to_string());
    let reads = std::thread::scope(|s| {
        let drivers = s.spawn(move || read_driver_installs(t0 - ChronoDuration::days(DRIVER_LOOKBACK_DAYS), budget));
        let updates = s.spawn(move || read_windows_updates(t0, budget));
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
        assert!(manifest_matches(&info, &by_id));
        assert!(!manifest_matches(&info, &GameRef { steam_app_id: Some(1), ..GameRef::default() }));
        let by_dir = GameRef {
            install_dir: Some("D:/SteamLibrary/steamapps/common/example game/bin".into()),
            ..GameRef::default()
        };
        assert!(manifest_matches(&info, &by_dir));
        let elsewhere = GameRef { install_dir: Some("C:\\Games\\Example Game".into()), ..GameRef::default() };
        assert!(!manifest_matches(&info, &elsewhere));
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
            SourceRead::Unreadable(r) => assert!(r.contains("not a Steam install"), "{r}"),
            other => panic!("expected Unreadable, got {other:?}"),
        }
        match read_game_update(&GameRef::default(), DEFAULT_BUDGET) {
            SourceRead::Unreadable(r) => assert!(r.contains("No game was identified"), "{r}"),
            other => panic!("expected Unreadable, got {other:?}"),
        }
        let loose = GameRef { install_dir: Some("C:\\Games\\Whatever".into()), ..GameRef::default() };
        match read_game_update(&loose, DEFAULT_BUDGET) {
            SourceRead::Unreadable(r) => assert!(r.contains("not installed in a Steam library"), "{r}"),
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
        let (evs, timed_out) = collect_uninstall(entries.into_iter(), deadline, &w);
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
        SourceRead::Read { events, timed_out: false }
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
        let r = combine(t0, t1, vec![(Source::DriverLog, ok(evs))]);
        let names: Vec<_> = r.events.iter().map(|e| e.what.name.clone().unwrap()).collect();
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
        let r = combine(
            t0,
            t1,
            vec![
                (Source::DriverLog, ok(vec![])),
                (Source::WindowsUpdateLog, SourceRead::Unreadable("Access is denied".into())),
            ],
        );
        assert!(r.events.is_empty());
        assert_eq!(r.unreadable.len(), 1);
        assert_eq!(r.unreadable[0].source, Source::WindowsUpdateLog);
        assert_eq!(r.unreadable[0].reason, "Access is denied");
        assert!(r.partial.is_empty());
        // A clean empty read lists nothing as unreadable.
        let clean = combine(t0, t1, vec![(Source::DriverLog, ok(vec![]))]);
        assert!(clean.unreadable.is_empty());
    }

    #[test]
    fn a_timed_out_reader_is_marked_partial_and_keeps_its_events() {
        let (t0, t1) = (utc("2026-11-01T00:00:00Z"), utc("2026-11-20T00:00:00Z"));
        let partial = SourceRead::Read {
            events: vec![exact_ev(ChangeKind::WindowsUpdate, "2026-11-10T00:00:00Z", "kept")],
            timed_out: true,
        };
        let r = combine(t0, t1, vec![(Source::WindowsUpdateLog, partial)]);
        assert_eq!(r.events.len(), 1);
        assert_eq!(r.partial, vec![Source::WindowsUpdateLog]);
    }

    #[test]
    fn budget_exhausted_with_nothing_read_is_unreadable_not_empty() {
        assert!(matches!(SourceRead::finish(vec![], true, "The x"), SourceRead::Unreadable(_)));
        assert!(matches!(SourceRead::finish(vec![], false, "The x"), SourceRead::Read { timed_out: false, .. }));
        let one = vec![exact_ev(ChangeKind::GpuDriver, "2026-11-10T00:00:00Z", "a")];
        assert!(matches!(SourceRead::finish(one, true, "The x"), SourceRead::Read { timed_out: true, .. }));
    }

    #[test]
    fn events_sort_oldest_first_and_game_last_update_ignores_the_window() {
        let (t0, t1) = (utc("2026-11-10T00:00:00Z"), utc("2026-11-20T00:00:00Z"));
        let mut game = exact_ev(ChangeKind::GameUpdate, "2026-11-05T00:00:00Z", "The Game");
        game.source = Source::SteamManifest;
        let r = combine(
            t0,
            t1,
            vec![
                (Source::DriverLog, ok(vec![exact_ev(ChangeKind::GpuDriver, "2026-11-15T00:00:00Z", "late")])),
                (Source::WindowsUpdateLog, ok(vec![exact_ev(ChangeKind::WindowsUpdate, "2026-11-12T00:00:00Z", "early")])),
                (Source::SteamManifest, ok(vec![game])),
            ],
        );
        let names: Vec<_> = r.events.iter().map(|e| e.what.name.clone().unwrap()).collect();
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
        let r = combine(t0, t1, vec![(Source::UninstallKeys, ok(vec![ev]))]);
        assert!(r.events.is_empty());
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
        let mut cmd = crate::actions::quiet_command("cmd.exe");
        cmd.args(["/c", "echo first-line & ping -n 8 127.0.0.1 > nul"]);
        let started = Instant::now();
        let out = run_with_budget(cmd, Duration::from_millis(400)).unwrap();
        assert!(out.timed_out);
        assert!(started.elapsed() < Duration::from_secs(4), "returned at the budget, not at child exit");
        assert!(String::from_utf8_lossy(&out.stdout).contains("first-line"), "partial output kept");
    }

    #[test]
    fn a_failing_query_is_unreadable_with_the_windows_reason() {
        let r = run_wevtutil("No-Such-Channel/Operational", "*", Duration::from_secs(5));
        assert!(r.is_err(), "a missing channel must not look like an empty log");
    }

    #[test]
    fn a_zero_budget_real_reader_is_unreadable_not_empty() {
        match read_driver_installs(Utc::now() - ChronoDuration::days(1), Duration::from_millis(0)) {
            SourceRead::Unreadable(_) => {}
            SourceRead::Read { timed_out, events } => {
                // A child can race a zero budget and finish first; then it is a real read.
                assert!(!timed_out || !events.is_empty());
            }
        }
    }

    #[test]
    fn reports_serialize_for_the_engine() {
        let r = combine(utc("2026-11-01T00:00:00Z"), utc("2026-11-20T00:00:00Z"), vec![]);
        let j = serde_json::to_string(&r).unwrap();
        assert!(j.contains("window_start"));
    }

    // ---- the real PC (run on demand) -----------------------------------------------------------

    /// `cargo test --lib change_sources::tests::real_pc_report -- --ignored --nocapture`
    #[test]
    #[ignore = "reads this PC's real Windows records; run on demand"]
    fn real_pc_report() {
        let now = Utc::now();
        let t0 = now - ChronoDuration::days(30);
        let timed = |label: &str, f: &dyn Fn() -> SourceRead| {
            let s = Instant::now();
            let r = f();
            let n = match &r {
                SourceRead::Read { events, timed_out } => format!("read {} events, timed_out={timed_out}", events.len()),
                SourceRead::Unreadable(why) => format!("UNREADABLE: {why}"),
            };
            println!("timing {label}: {} ms ({n})", s.elapsed().as_millis());
        };
        timed("drivers (120d lookback)", &|| read_driver_installs(t0 - ChronoDuration::days(DRIVER_LOOKBACK_DAYS), DEFAULT_BUDGET));
        timed("windows update (30d)", &|| read_windows_updates(t0, DEFAULT_BUDGET));
        timed("installed programs", &|| read_installed_programs(DEFAULT_BUDGET));

        let games = read_all_steam_games(DEFAULT_BUDGET).unwrap_or_default();
        println!("steam games with a readable update time: {}", games.len());
        let game = games.first().and_then(|g| g.what.id.as_deref()).and_then(|id| id.parse::<u32>().ok());
        let gref = game.map(|id| GameRef { steam_app_id: Some(id), ..GameRef::default() });

        let s = Instant::now();
        let r = changes_between(t0, now, gref.as_ref());
        println!("changes_between(30d) total wall time: {} ms", s.elapsed().as_millis());
        println!("window: ({}, {}]", r.window_start.to_rfc3339(), r.window_end.to_rfc3339());
        println!("unreadable: {:?}", r.unreadable.iter().map(|u| (u.source, u.reason.as_str())).collect::<Vec<_>>());
        println!("partial: {:?}   undated_excluded: {}", r.partial, r.undated_excluded);
        let count = |k: ChangeKind| r.events.iter().filter(|e| e.kind == k).count();
        println!(
            "counts: gpu_driver={} other_driver={} windows_update={} game_update={} programs_installed={}",
            count(ChangeKind::GpuDriver),
            count(ChangeKind::OtherDriver),
            count(ChangeKind::WindowsUpdate),
            count(ChangeKind::GameUpdate),
            count(ChangeKind::ProgramInstalled)
        );
        let fmt = |e: &ChangeEvent| {
            let when = match e.when.precision {
                Precision::Exact => format!("{} exact", e.when.at.unwrap().format("%Y-%m-%dT%H:%MZ")),
                Precision::Day => format!("day {}..{}", e.when.at.unwrap().format("%m-%dT%H:%MZ"), e.when.until.unwrap().format("%m-%dT%H:%MZ")),
                Precision::Unknown => "unknown".into(),
            };
            format!(
                "  {:?} {} | {} -> {} | {}",
                e.kind,
                when,
                e.what.from_version.as_deref().unwrap_or("?"),
                e.what.to_version.as_deref().unwrap_or("?"),
                e.what.kb.as_deref().or(e.what.id.as_deref()).unwrap_or("-"),
            )
        };
        for e in r.events.iter().filter(|e| matches!(e.kind, ChangeKind::GpuDriver | ChangeKind::OtherDriver)) {
            println!("{}", fmt(e));
        }
        for e in r.events.iter().filter(|e| e.kind == ChangeKind::WindowsUpdate && e.what.detail.as_deref() != Some("definition") && e.what.detail.as_deref() != Some("store-app")) {
            println!("{} | {}", fmt(e), e.what.detail.as_deref().unwrap_or(""));
        }
        let defs = r.events.iter().filter(|e| e.what.detail.as_deref() == Some("definition")).count();
        let store = r.events.iter().filter(|e| e.what.detail.as_deref() == Some("store-app")).count();
        println!("  (windows update also: {defs} Defender definition installs, {store} Store-app installs)");
        if let Some(g) = &r.game_last_update {
            println!("game last update (outside window allowed): {}", fmt(g));
        }
    }
}
