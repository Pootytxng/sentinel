//! The day-one answer (design M5, slice S1): what changed on this PC around when it started, for a user
//! with no usable history. Read-only: it reads Windows' own dated records through
//! `change_sources::changes_between` (whole PC, no game) and writes nothing, stores nothing about the
//! user's answer, and starts no process of its own.
//!
//! What it says and refuses to say:
//! - Every row is a dated fact with `Certainty::Possible` at most and `EvidenceKind::Known`; nothing is
//!   called a problem or a cause, and nothing is ordered by likelihood (newest first inside a group).
//! - A kind whose source was unread, partly read, not asked or not covered back to the window start is a
//!   limit line, never "nothing changed". "None" is said per kind, only for a complete read.
//! - "It's always been like this" reads nothing and lists no change.
//!
//! The engine returns codes, ids and numbers; the card owns every sentence (locales `paramedic.firstLook`).

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};

use super::changes::{Limit, CHANGES_BUDGET};
use super::{iso, Certainty, EvidenceKind};
use crate::change_sources::{self, ChangeEvent, ChangeKind, ChangeReport, Gap, KindStatus, Note, Precision, UnreadableReason};

/// Names a day's installs show before "and N more".
const PROGRAM_NAMES_SHOWN: usize = 3;

pub(crate) const METHOD: &str = "paramedic-first-look-v1";

/// What the user said about when it started. The card sends one of five taps; nothing is stored.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Since {
    Today,
    ThisWeek,
    ThisMonth,
    Always,
    DontKnow,
}

/// Which game to look at. S1 only has the whole PC; the game picker (S2) adds variants here.
#[derive(Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum FirstLookGame {
    WholePc,
}

/// The window read for a choice, as a number of days back from now. A lead is included on purpose: a
/// change made just before the user noticed belongs in the window. `Always` has no window.
pub(crate) fn window_hours(since: Since) -> Option<i64> {
    match since {
        Since::Today => Some(48),
        Since::ThisWeek => Some(8 * 24),
        Since::ThisMonth => Some(35 * 24),
        Since::DontKnow => Some(30 * 24),
        Since::Always => None,
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Told {
    pub since: Since,
    /// Start of the window actually read (UTC); none for "always".
    pub from: Option<String>,
    pub to: String,
    pub hours: Option<i64>,
}

/// One dated observation and the code of the by-hand check that goes with it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Change {
    pub id: &'static str,
    /// When it happened (UTC). Day precision: the start of the local day.
    pub at: Option<String>,
    /// `exact` or `day`: a day is worded "on {{day}}", never with a time of day.
    pub precision: &'static str,
    pub args: BTreeMap<&'static str, String>,
    /// Always `Possible` here: a first look has no measurement (pinned by a test).
    pub confidence: Certainty,
    pub evidence: EvidenceKind,
    /// The by-hand step for the card to word; empty for a counted line.
    pub how: &'static str,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct FirstLook {
    pub told: Told,
    /// False for "always": no change list was made, by choice.
    pub changes_listed: bool,
    /// Graphics driver, Windows updates: the things that sit in a game's path. Newest first.
    pub touch_games: Vec<Change>,
    /// Other drivers, programs, minor updates. Newest first.
    pub other_changes: Vec<Change>,
    /// Kinds read COMPLETELY with nothing in the window: `gpu-driver`, `windows-update`, `programs`.
    pub none: Vec<&'static str>,
    /// What Compy could not see, per kind; the card words each.
    pub limits: Vec<Limit>,
    /// Every asked kind was read completely (so "no dated change" may be said when the lists are empty).
    pub read_all: bool,
    pub method: &'static str,
}

/// What the dated readers gave.
#[derive(Clone, Debug)]
pub(crate) enum Reading {
    Report(Box<ChangeReport>),
    /// `took-too-long` or `reader-failed`: every kind is unread.
    Unavailable(&'static str),
}

fn limit(kind: &'static str, code: &'static str, args: &[(&'static str, String)]) -> Limit {
    Limit { kind, code, args: args.iter().cloned().collect() }
}

fn change(id: &'static str, at: Option<DateTime<Utc>>, precision: Precision, args: &[(&'static str, String)], how: &'static str) -> Change {
    Change {
        id,
        at: at.map(iso),
        precision: if precision == Precision::Day { "day" } else { "exact" },
        args: args.iter().cloned().collect(),
        confidence: Certainty::Possible,
        evidence: EvidenceKind::Known,
        how,
    }
}

fn class_of(e: &ChangeEvent) -> String {
    e.what.detail.as_deref().unwrap_or("").trim().to_ascii_lowercase()
}

fn is_major(class: &str) -> bool {
    matches!(class, "quality" | "feature" | "driver")
}

fn is_minor(class: &str) -> bool {
    matches!(class, "definition" | "store-app")
}

/// A driver-class Windows Update row that is the same install as a graphics driver row: the same moment
/// (within two minutes) and, when both name a version, the same version.
fn same_install(update: &ChangeEvent, driver: &ChangeEvent) -> bool {
    let (Some(a), Some(b)) = (update.when.at, driver.when.at) else { return false };
    if (a - b).num_seconds().abs() > 120 {
        return false;
    }
    match (update.what.to_version.as_deref(), driver.what.to_version.as_deref()) {
        (Some(x), Some(y)) => crate::hardware::same_driver(x, y),
        _ => true,
    }
}

fn known(v: &Option<String>) -> String {
    v.as_deref().map(str::trim).unwrap_or("").to_string()
}

/// Fixed codes per reason; the card owns the sentence.
fn reason_code(r: &UnreadableReason) -> &'static str {
    use UnreadableReason as U;
    match r {
        U::AccessDenied => "access-denied",
        U::LogEmptyOrSwitchedOff => "log-empty",
        U::ChannelNotFound | U::ToolMissing => "log-missing",
        U::StartFailed | U::QueryFailed(_) | U::ReaderStopped => "read-failed",
        U::TimedOutBeforeAnyRecord => "timed-out",
        U::RecordsUnreadable(_) => "records-unreadable",
        U::RegistryUnreadable => "registry",
        // Game readers are not asked in S1; these codes only keep the match closed.
        U::NotSteamLauncher(_) | U::NoGameIdentified | U::NotInSteamLibrary | U::SteamNotFound => "not-steam",
        U::SteamUnreadable | U::SteamPartiallyUnreadable { .. } => "steam-unreadable",
        U::SteamGameNotFound => "steam-no-record",
        U::SteamNoUpdateTime => "steam-no-time",
    }
}

fn reason_args(r: &UnreadableReason) -> Vec<(&'static str, String)> {
    match r {
        UnreadableReason::RecordsUnreadable(n) => vec![("n", n.to_string())],
        _ => Vec::new(),
    }
}

fn gap_limits(kind: &'static str, gaps: &[Gap], covered_from: Option<DateTime<Utc>>, coverage_from: Option<DateTime<Utc>>, out: &mut Vec<Limit>) {
    for g in gaps {
        out.push(match g {
            Gap::TimedOut => limit(kind, "partial-timed-out", &[]),
            Gap::RowCapReached => limit(kind, "partial-row-cap", &covered_from.map(|t| vec![("from", iso(t))]).unwrap_or_default()),
            Gap::MalformedRecords(n) => limit(kind, "partial-unparsed", &[("n", n.to_string())]),
            Gap::OutputCapped => limit(kind, "partial-output-capped", &[]),
            Gap::RegistryKeysUnreadable(n) => limit(kind, "partial-registry", &[("n", n.to_string())]),
            Gap::SteamLibrariesUnreadable(n) => limit(kind, "partial-steam-libraries", &[("n", n.to_string())]),
        });
    }
    if let Some(t) = coverage_from {
        out.push(limit(kind, "partial-coverage", &[("from", iso(t))]));
    }
}

/// Always-true limits of a source that WAS read (completely or in part).
fn kind_limits(kind: &'static str, notes: &[Note], out: &mut Vec<Limit>) {
    match kind {
        "driver" => out.push(limit(kind, "classes", &[])),
        "programs" => {
            let n = notes.iter().find_map(|n| if let Note::ProgramsWithoutDate(n) = n { Some(*n) } else { None }).unwrap_or(0);
            out.push(limit(kind, "no-install-date", &[("n", n.to_string())]));
        }
        _ => {}
    }
}

fn status_limits(kind: &'static str, status: KindStatus, out: &mut Vec<Limit>) {
    match status {
        KindStatus::NotAsked => out.push(limit(kind, "not-read", &[])),
        KindStatus::Unreadable(r) => out.push(limit(kind, reason_code(&r), &reason_args(&r))),
        KindStatus::Partial { gaps, covered_from, coverage_gap, limits } => {
            gap_limits(kind, &gaps, covered_from, coverage_gap.as_ref().map(|g| g.to), out);
            kind_limits(kind, &limits, out);
        }
        KindStatus::Complete { limits } => kind_limits(kind, &limits, out),
    }
}

/// The three kinds read for the whole PC, with their limit names.
const KINDS: [(&str, ChangeKind); 3] = [
    ("driver", ChangeKind::GpuDriver),
    ("windows-update", ChangeKind::WindowsUpdate),
    ("programs", ChangeKind::ProgramInstalled),
];

fn events_of(r: &ChangeReport, kind: ChangeKind) -> Vec<&ChangeEvent> {
    r.events_found.iter().filter(|e| e.kind == kind).collect()
}

fn newest_first(v: &mut [Change]) {
    v.sort_by(|a, b| b.at.cmp(&a.at).then(a.id.cmp(b.id)).then(a.args.cmp(&b.args)));
}

/// Pure: the answer for `since` from what the readers gave (`None` for "always": nothing was read).
pub(crate) fn build(since: Since, now: DateTime<Utc>, reading: Option<&Reading>) -> FirstLook {
    let hours = window_hours(since);
    let from = hours.map(|h| iso(now - ChronoDuration::hours(h)));
    let told = Told { since, from, to: iso(now), hours };
    let mut out = FirstLook {
        told,
        changes_listed: since != Since::Always,
        touch_games: Vec::new(),
        other_changes: Vec::new(),
        none: Vec::new(),
        limits: Vec::new(),
        read_all: false,
        method: METHOD,
    };
    let Some(reading) = reading.filter(|_| since != Since::Always) else { return out };
    match reading {
        Reading::Unavailable(why) => {
            for (name, _) in KINDS {
                out.limits.push(limit(name, why, &[]));
            }
        }
        Reading::Report(r) => {
            let r = r.as_ref();
            let mut all_complete = true;
            for (name, kind) in KINDS {
                let status = r.status(kind);
                all_complete &= matches!(status, KindStatus::Complete { .. });
                status_limits(name, status, &mut out.limits);
            }
            out.read_all = all_complete;
            let complete = |kind: ChangeKind| matches!(r.status(kind), KindStatus::Complete { .. });
            gpu_rows(r, &mut out);
            update_rows(r, &mut out);
            program_rows(r, &mut out);
            other_driver_row(r, &mut out);
            if complete(ChangeKind::GpuDriver) && !out.touch_games.iter().any(|c| c.id.starts_with("gpu-driver")) {
                out.none.push("gpu-driver");
            }
            if complete(ChangeKind::WindowsUpdate) && !out.touch_games.iter().any(|c| c.id.starts_with("windows-update")) && !out.other_changes.iter().any(|c| c.id == "updates-unclassified") {
                out.none.push("windows-update");
            }
            if complete(ChangeKind::ProgramInstalled) && !out.other_changes.iter().any(|c| c.id == "programs-installed") {
                out.none.push("programs");
            }
        }
    }
    // Game files are not read in S1: no game is picked, so Compy says so rather than staying silent.
    out.limits.push(limit("game-update", "not-picked", &[]));
    newest_first(&mut out.touch_games);
    newest_first(&mut out.other_changes);
    out
}

/// Real graphics-driver version changes. The same version configured again is not a change and is not listed.
fn gpu_rows(r: &ChangeReport, out: &mut FirstLook) {
    let updates = events_of(r, ChangeKind::WindowsUpdate);
    for e in events_of(r, ChangeKind::GpuDriver) {
        let Some(at) = e.when.at else { continue };
        let (from, to) = (known(&e.what.from_version), known(&e.what.to_version));
        let mut args: Vec<(&'static str, String)> = Vec::new();
        let id = match e.what.version_changed {
            Some(true) if !from.is_empty() && !to.is_empty() => {
                args.push(("from", from));
                args.push(("to", to));
                "gpu-driver-changed"
            }
            // Windows said the version changed but did not name both versions, or it does not know the
            // earlier one: said as an install, never as "changed from X".
            Some(true) | None if !to.is_empty() => {
                args.push(("to", to));
                "gpu-driver-installed"
            }
            Some(true) | None => "gpu-driver-installed-bare",
            Some(false) => continue,
        };
        if updates.iter().any(|w| class_of(w) == "driver" && same_install(w, e)) {
            args.push(("via_update", "true".to_string()));
        }
        out.touch_games.push(change(id, Some(at), e.when.precision, &args, "gpu-driver"));
    }
}

/// Quality, feature and driver-class updates one by one (a driver-class row that is a graphics driver
/// install already listed is folded into it); definition and Store-app updates counted on one line.
fn update_rows(r: &ChangeReport, out: &mut FirstLook) {
    let gpu = events_of(r, ChangeKind::GpuDriver);
    let all = events_of(r, ChangeKind::WindowsUpdate);
    for e in &all {
        let class = class_of(e);
        let Some(at) = e.when.at else { continue };
        if !is_major(&class) || (class == "driver" && gpu.iter().any(|g| same_install(e, g))) {
            continue;
        }
        let (id, args) = match e.what.kb.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
            Some(kb) => ("windows-update", vec![("kb", kb.to_string())]),
            None => ("windows-update-nokb", Vec::new()),
        };
        out.touch_games.push(change(id, Some(at), e.when.precision, &args, "windows-update"));
    }
    let count = |class: &str| all.iter().filter(|e| class_of(e) == class).count();
    let (defs, apps) = (count("definition"), count("store-app"));
    if defs + apps > 0 {
        let newest = all.iter().filter(|e| is_minor(&class_of(e))).filter_map(|e| e.when.at).max();
        out.other_changes.push(change("updates-minor", newest, Precision::Exact, &[("n", defs.to_string()), ("m", apps.to_string())], ""));
    }
    // A class Compy does not recognise (a title in another language, a new kind) is counted, never dropped.
    let unclassified: Vec<&&ChangeEvent> = all.iter().filter(|e| !is_major(&class_of(e)) && !is_minor(&class_of(e))).collect();
    if !unclassified.is_empty() {
        let mut kbs: Vec<String> = unclassified.iter().filter_map(|e| e.what.kb.clone()).collect();
        kbs.sort();
        kbs.dedup();
        let newest = unclassified.iter().filter_map(|e| e.when.at).max();
        out.other_changes.push(change(
            "updates-unclassified",
            newest,
            Precision::Exact,
            &[("n", unclassified.len().to_string()), ("kbs", kbs.join(", "))],
            "",
        ));
    }
}

/// Programs, one row per calendar day (installs carry a day, never a time of day).
fn program_rows(r: &ChangeReport, out: &mut FirstLook) {
    let mut days: BTreeMap<DateTime<Utc>, Vec<String>> = BTreeMap::new();
    for e in events_of(r, ChangeKind::ProgramInstalled) {
        if let (Some(at), Some(name)) = (e.when.at, e.what.name.as_deref().map(str::trim).filter(|n| !n.is_empty())) {
            days.entry(at).or_default().push(name.to_string());
        }
    }
    for (day, mut names) in days {
        names.sort();
        names.dedup();
        out.other_changes.push(change(
            "programs-installed",
            Some(day),
            Precision::Day,
            &[
                ("count", names.len().to_string()),
                ("names", names.iter().take(PROGRAM_NAMES_SHOWN).cloned().collect::<Vec<_>>().join(", ")),
                ("more", names.len().saturating_sub(PROGRAM_NAMES_SHOWN).to_string()),
            ],
            "programs",
        ));
    }
}

/// Audio, network and chipset drivers with a real version change: one collapsed line.
fn other_driver_row(r: &ChangeReport, out: &mut FirstLook) {
    let hits: Vec<&ChangeEvent> =
        events_of(r, ChangeKind::OtherDriver).into_iter().filter(|e| e.what.version_changed == Some(true) && e.when.at.is_some()).collect();
    if hits.is_empty() {
        return;
    }
    let mut classes: Vec<String> =
        hits.iter().filter_map(|e| e.what.detail.as_deref().and_then(|d| d.split_whitespace().next()).map(str::to_ascii_lowercase)).collect();
    classes.sort();
    classes.dedup();
    let newest = hits.iter().filter_map(|e| e.when.at).max();
    out.other_changes.push(change("other-drivers", newest, Precision::Exact, &[("count", hits.len().to_string()), ("classes", classes.join(", "))], "other-drivers"));
}

// ---- Orchestration: the command's half ---------------------------------------------------------

/// A reader from an earlier press that is still running: a new one is not started (that press reads
/// `took-too-long`), so repeated taps cannot pile threads up.
static READING: AtomicBool = AtomicBool::new(false);

struct SlotGuard;
impl Drop for SlotGuard {
    fn drop(&mut self) {
        READING.store(false, Ordering::Release);
    }
}

/// Runs `fetch` on its own thread and waits at most `budget`. Late or dead is `Unavailable`, never empty.
pub(crate) fn read_within<F>(budget: Duration, fetch: F) -> Reading
where
    F: FnOnce() -> Reading + Send + 'static,
{
    if READING.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return Reading::Unavailable("took-too-long");
    }
    let guard = SlotGuard;
    let (tx, rx) = std::sync::mpsc::channel();
    let spawned = std::thread::Builder::new().name("paramedic-first-look".into()).spawn(move || {
        let _guard = guard;
        let _ = tx.send(fetch());
    });
    if spawned.is_err() {
        READING.store(false, Ordering::Release);
        return Reading::Unavailable("reader-failed");
    }
    match rx.recv_timeout(budget) {
        Ok(r) => r,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Reading::Unavailable("took-too-long"),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Reading::Unavailable("reader-failed"),
    }
}

/// The answer for `since` at `now`. `fetch` gets the window `(t0, now]` and runs only when there is one.
pub(crate) fn first_look_with<F>(since: Since, now: DateTime<Utc>, budget: Duration, fetch: F) -> FirstLook
where
    F: FnOnce(DateTime<Utc>, DateTime<Utc>) -> Reading + Send + 'static,
{
    let Some(hours) = window_hours(since) else { return build(since, now, None) };
    let t0 = now - ChronoDuration::hours(hours);
    let reading = read_within(budget, move || fetch(t0, now));
    build(since, now, Some(&reading))
}

/// The real readers for the whole PC (no game). Read-only; no network, no elevation.
pub(crate) fn read_real(t0: DateTime<Utc>, t1: DateTime<Utc>) -> Reading {
    match change_sources::changes_between(t0, t1, None) {
        Ok(report) => Reading::Report(Box::new(report)),
        Err(_) => Reading::Unavailable("reader-failed"),
    }
}

/// The Tauri edge, beside `paramedic_diagnose` and under the same single-flight guard: while either is
/// running the other answers BUSY (the card keeps saying "still checking"). Writes nothing.
#[tauri::command]
pub(crate) async fn paramedic_first_look(game: FirstLookGame, since: Since) -> Result<FirstLook, String> {
    let Some(flight) = super::FlightGuard::begin() else { return Err(super::BUSY.to_string()) };
    let FirstLookGame::WholePc = game;
    tauri::async_runtime::spawn_blocking(move || {
        let _flight = flight;
        first_look_with(since, Utc::now(), CHANGES_BUDGET, read_real)
    })
    .await
    .map_err(|_| "the first look stopped unexpectedly".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::change_sources::{ChangeTime, ChangeWhat, ReadOk, Source, SourceRead};

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    const NOW: &str = "2026-11-20T12:00:00Z";

    /// `read_within` has one static slot; tests that go through it take turns.
    static SLOT_TESTS: std::sync::Mutex<()> = std::sync::Mutex::new(());
    fn one_at_a_time() -> std::sync::MutexGuard<'static, ()> {
        SLOT_TESTS.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn ev(kind: ChangeKind, when: ChangeTime, what: ChangeWhat) -> ChangeEvent {
        let source = kind.source();
        ChangeEvent { kind, when, what, source }
    }

    fn gpu(at: &str, from: Option<&str>, to: &str, changed: Option<bool>) -> ChangeEvent {
        ev(
            ChangeKind::GpuDriver,
            ChangeTime::exact(utc(at)),
            ChangeWhat {
                name: Some("Display adapter".into()),
                from_version: from.map(str::to_string),
                to_version: Some(to.into()),
                version_changed: changed,
                ..Default::default()
            },
        )
    }

    fn update(at: &str, kb: Option<&str>, class: &str) -> ChangeEvent {
        ev(
            ChangeKind::WindowsUpdate,
            ChangeTime::exact(utc(at)),
            ChangeWhat { kb: kb.map(str::to_string), detail: Some(class.into()), ..Default::default() },
        )
    }

    fn program(day_start: &str, day_end: &str, name: &str) -> ChangeEvent {
        ev(
            ChangeKind::ProgramInstalled,
            ChangeTime::day(utc(day_start), utc(day_end)),
            ChangeWhat { name: Some(name.into()), ..Default::default() },
        )
    }

    fn other_driver(at: &str, class: &str) -> ChangeEvent {
        ev(
            ChangeKind::OtherDriver,
            ChangeTime::exact(utc(at)),
            ChangeWhat { detail: Some(class.into()), version_changed: Some(true), to_version: Some("1.2".into()), ..Default::default() },
        )
    }

    fn read(events: Vec<ChangeEvent>) -> SourceRead {
        SourceRead::ok(events)
    }

    /// A report as `combine` makes it, so windowing and statuses are the real ones.
    fn report(window_h: i64, drivers: SourceRead, updates: SourceRead, programs: SourceRead) -> ChangeReport {
        let t1 = utc(NOW);
        change_sources::combine(
            t1 - ChronoDuration::hours(window_h),
            t1,
            vec![(Source::DriverLog, drivers), (Source::WindowsUpdateLog, updates), (Source::UninstallKeys, programs)],
        )
        .unwrap()
    }

    fn look(since: Since, r: ChangeReport) -> FirstLook {
        build(since, utc(NOW), Some(&Reading::Report(Box::new(r))))
    }

    fn live_like() -> ChangeReport {
        let mut drivers = vec![
            gpu("2026-11-19T05:12:26Z", Some("32.0.32015.7029"), "32.0.32029.2010", Some(true)),
            other_driver("2026-11-18T09:00:00Z", "audio driver"),
        ];
        drivers.push(gpu("2026-11-19T05:20:00Z", Some("32.0.32029.2010"), "32.0.32029.2010", Some(false)));
        let updates = vec![
            update("2026-11-14T03:00:00Z", Some("KB5007651"), "definition"),
            update("2026-11-17T03:00:00Z", Some("KB5050000"), "quality"),
            update("2026-11-15T03:00:00Z", None, "store-app"),
        ];
        let programs = vec![
            program("2026-11-19T00:00:00Z", "2026-11-20T00:00:00Z", "Alpha"),
            program("2026-11-19T00:00:00Z", "2026-11-20T00:00:00Z", "Beta"),
            program("2026-11-16T00:00:00Z", "2026-11-17T00:00:00Z", "Gamma"),
        ];
        report(8 * 24, read(drivers), read(updates), read(programs))
    }

    #[test]
    fn each_since_choice_maps_to_the_documented_window() {
        assert_eq!(window_hours(Since::Today), Some(48));
        assert_eq!(window_hours(Since::ThisWeek), Some(8 * 24));
        assert_eq!(window_hours(Since::ThisMonth), Some(35 * 24));
        assert_eq!(window_hours(Since::DontKnow), Some(30 * 24));
        assert_eq!(window_hours(Since::Always), None);
        let _turn = one_at_a_time();
        let now = utc(NOW);
        for (since, days) in [(Since::Today, 2), (Since::ThisWeek, 8), (Since::ThisMonth, 35), (Since::DontKnow, 30)] {
            let seen = std::sync::Arc::new(std::sync::Mutex::new(None));
            let s2 = seen.clone();
            let a = first_look_with(since, now, Duration::from_secs(5), move |t0, t1| {
                *s2.lock().unwrap() = Some((t0, t1));
                Reading::Report(Box::new(report(1, read(vec![]), read(vec![]), read(vec![]))))
            });
            let (t0, t1) = seen.lock().unwrap().unwrap();
            assert_eq!(t1, now);
            assert_eq!(t0, now - ChronoDuration::days(days), "{since:?}");
            assert_eq!(a.told.from, Some(iso(t0)));
        }
    }

    #[test]
    fn groups_and_order_are_newest_first_inside_each_group() {
        let a = look(Since::ThisWeek, live_like());
        let ids: Vec<(&str, Option<&str>)> = a.touch_games.iter().map(|c| (c.id, c.at.as_deref())).collect();
        assert_eq!(
            ids,
            vec![("gpu-driver-changed", Some("2026-11-19T05:12:26Z")), ("windows-update", Some("2026-11-17T03:00:00Z"))],
            "graphics driver and Windows update touch games; same-version row is absent"
        );
        let other: Vec<&str> = other_ids(&a);
        // programs on the 19th, audio driver on the 18th, programs on the 16th, minor updates on the 15th
        assert_eq!(other, vec!["programs-installed", "other-drivers", "programs-installed", "updates-minor"]);
        let ats: Vec<&String> = a.other_changes.iter().filter_map(|c| c.at.as_ref()).collect();
        assert!(ats.windows(2).all(|w| w[0] >= w[1]), "{ats:?}");
        let gpu_row = &a.touch_games[0];
        assert_eq!(gpu_row.args.get("from").map(String::as_str), Some("32.0.32015.7029"));
        assert_eq!(gpu_row.args.get("to").map(String::as_str), Some("32.0.32029.2010"));
        assert_eq!(gpu_row.how, "gpu-driver");
    }

    fn other_ids(a: &FirstLook) -> Vec<&'static str> {
        a.other_changes.iter().map(|c| c.id).collect()
    }

    #[test]
    fn a_row_before_the_window_is_not_listed() {
        let drivers = vec![gpu("2026-10-01T05:00:00Z", Some("1.0"), "2.0", Some(true))];
        let a = look(Since::Today, report(48, read(drivers), read(vec![]), read(vec![])));
        assert!(a.touch_games.is_empty());
        assert!(a.none.contains(&"gpu-driver"));
    }

    #[test]
    fn same_version_reconfigure_rows_are_not_changes() {
        let drivers = vec![gpu("2026-11-19T05:00:00Z", Some("2.0"), "2.0", Some(false))];
        let a = look(Since::ThisWeek, report(8 * 24, read(drivers), read(vec![]), read(vec![])));
        assert!(a.touch_games.is_empty(), "{:?}", a.touch_games);
        // The statement is about version changes only, so it stays true with a same-version row present.
        assert!(a.none.contains(&"gpu-driver"));
    }

    #[test]
    fn an_unknown_earlier_version_is_said_as_an_install_not_a_change() {
        let drivers = vec![gpu("2026-11-19T05:00:00Z", None, "2.0", None)];
        let a = look(Since::ThisWeek, report(8 * 24, read(drivers), read(vec![]), read(vec![])));
        assert_eq!(a.touch_games.len(), 1);
        assert_eq!(a.touch_games[0].id, "gpu-driver-installed");
        assert!(!a.touch_games[0].args.contains_key("from"));
        assert!(!a.none.contains(&"gpu-driver"));
    }

    #[test]
    fn a_complete_read_with_no_events_says_none_for_that_kind_only() {
        let updates = vec![update("2026-11-17T03:00:00Z", Some("KB5050000"), "quality")];
        let a = look(Since::ThisWeek, report(8 * 24, read(vec![]), read(updates), read(vec![])));
        assert_eq!(a.none, vec!["gpu-driver", "programs"], "windows-update has a row, so it is not in none");
        assert!(a.read_all);
        assert!(a.limits.iter().any(|l| l.kind == "driver" && l.code == "classes"));
        assert!(a.limits.iter().any(|l| l.kind == "programs" && l.code == "no-install-date"));
    }

    #[test]
    fn an_unreadable_source_is_a_limit_never_nothing_changed() {
        let r = report(
            8 * 24,
            SourceRead::Unreadable(UnreadableReason::AccessDenied),
            read(vec![]),
            SourceRead::Unreadable(UnreadableReason::RegistryUnreadable),
        );
        let a = look(Since::ThisWeek, r);
        assert!(!a.none.contains(&"gpu-driver") && !a.none.contains(&"programs"), "{:?}", a.none);
        assert_eq!(a.none, vec!["windows-update"]);
        assert!(a.limits.iter().any(|l| l.kind == "driver" && l.code == "access-denied"));
        assert!(a.limits.iter().any(|l| l.kind == "programs" && l.code == "registry"));
        assert!(!a.read_all);
    }

    #[test]
    fn a_partial_read_is_a_limit_never_nothing_changed() {
        let partial = SourceRead::Read(ReadOk {
            events: vec![],
            covered_from: Some(utc("2026-11-18T00:00:00Z")),
            gaps: vec![Gap::RowCapReached],
            notes: vec![],
        });
        let a = look(Since::ThisWeek, report(8 * 24, partial, read(vec![]), read(vec![])));
        assert!(!a.none.contains(&"gpu-driver"));
        let codes: Vec<&str> = a.limits.iter().filter(|l| l.kind == "driver").map(|l| l.code).collect();
        assert!(codes.contains(&"partial-row-cap") && codes.contains(&"partial-coverage"), "{codes:?}");
        assert!(!a.read_all);
    }

    #[test]
    fn a_log_that_starts_inside_the_window_is_a_coverage_limit() {
        let young = SourceRead::Read(ReadOk { events: vec![], covered_from: Some(utc("2026-11-19T00:00:00Z")), gaps: vec![], notes: vec![] });
        let a = look(Since::ThisWeek, report(8 * 24, read(vec![]), young, read(vec![])));
        assert!(!a.none.contains(&"windows-update"));
        let l = a.limits.iter().find(|l| l.kind == "windows-update").unwrap();
        assert_eq!(l.code, "partial-coverage");
        assert_eq!(l.args.get("from").map(String::as_str), Some("2026-11-19T00:00:00Z"));
    }

    #[test]
    fn a_source_that_was_not_asked_is_not_read_and_not_none() {
        let t1 = utc(NOW);
        let r = change_sources::combine(t1 - ChronoDuration::hours(48), t1, vec![(Source::DriverLog, read(vec![]))]).unwrap();
        let a = look(Since::Today, r);
        assert_eq!(a.none, vec!["gpu-driver"]);
        for kind in ["windows-update", "programs"] {
            assert!(a.limits.iter().any(|l| l.kind == kind && l.code == "not-read"), "{kind}");
        }
    }

    #[test]
    fn a_late_or_dead_reader_is_unread_never_empty() {
        let _turn = one_at_a_time();
        let late = first_look_with(Since::ThisWeek, utc(NOW), Duration::from_millis(30), |_, _| {
            std::thread::sleep(Duration::from_millis(400));
            Reading::Unavailable("reader-failed")
        });
        assert!(late.none.is_empty() && !late.read_all);
        for kind in ["driver", "windows-update", "programs"] {
            assert!(late.limits.iter().any(|l| l.kind == kind && l.code == "took-too-long"), "{kind}: {:?}", late.limits);
        }
        // Wait out the slot of the thread that is still sleeping, then a panicking reader is "reader-failed".
        std::thread::sleep(Duration::from_millis(600));
        let dead = first_look_with(Since::ThisWeek, utc(NOW), Duration::from_secs(2), |_, _| panic!("reader died"));
        assert!(dead.limits.iter().any(|l| l.kind == "driver" && l.code == "reader-failed"), "{:?}", dead.limits);
        assert!(dead.none.is_empty());
    }

    #[test]
    fn always_like_this_reads_nothing_and_lists_no_change() {
        let _turn = one_at_a_time();
        let a = first_look_with(Since::Always, utc(NOW), Duration::from_secs(1), |_, _| panic!("no reader may run for 'always'"));
        assert!(!a.changes_listed);
        assert!(a.touch_games.is_empty() && a.other_changes.is_empty() && a.none.is_empty() && a.limits.is_empty());
        assert_eq!(a.told.since, Since::Always);
        assert_eq!(a.told.from, None);
        // Even handed a report, "always" lists nothing.
        let b = look(Since::Always, live_like());
        assert!(b.touch_games.is_empty() && b.other_changes.is_empty());
    }

    #[test]
    fn dont_know_reads_thirty_days() {
        let a = look(Since::DontKnow, report(30 * 24, read(vec![]), read(vec![]), read(vec![])));
        assert_eq!(a.told.hours, Some(720));
        assert_eq!(a.told.from, Some(iso(utc(NOW) - ChronoDuration::days(30))));
    }

    #[test]
    fn nothing_carries_more_than_possible() {
        for since in [Since::Today, Since::ThisWeek, Since::ThisMonth, Since::DontKnow, Since::Always] {
            let a = look(since, live_like());
            for c in a.touch_games.iter().chain(&a.other_changes) {
                assert_eq!(c.confidence, Certainty::Possible, "{c:?}");
                assert_eq!(c.evidence, EvidenceKind::Known);
            }
            let json = serde_json::to_string(&a).unwrap().to_lowercase();
            for banned in ["\"likely\"", "\"measured\"", "\"known\"", "\"mechanism\"", "caus", "issue", "problem"] {
                // `evidence` serialises as "known" by design; every other word must be absent.
                if banned == "\"known\"" {
                    continue;
                }
                assert!(!json.contains(banned), "{banned} in {json}");
            }
        }
    }

    #[test]
    fn programs_carry_day_precision_and_group_by_day() {
        let a = look(Since::ThisWeek, live_like());
        let days: Vec<&Change> = a.other_changes.iter().filter(|c| c.id == "programs-installed").collect();
        assert_eq!(days.len(), 2);
        assert!(days.iter().all(|c| c.precision == "day"));
        assert_eq!(days[0].args.get("count").map(String::as_str), Some("2"));
        assert_eq!(days[0].args.get("names").map(String::as_str), Some("Alpha, Beta"));
        assert_eq!(days[0].args.get("more").map(String::as_str), Some("0"));
        assert_eq!(days[0].at.as_deref(), Some("2026-11-19T00:00:00Z"));
    }

    #[test]
    fn many_programs_in_a_day_show_three_names_and_a_count() {
        let programs: Vec<ChangeEvent> =
            ["A", "B", "C", "D", "E"].iter().map(|n| program("2026-11-19T00:00:00Z", "2026-11-20T00:00:00Z", n)).collect();
        let a = look(Since::ThisWeek, report(8 * 24, read(vec![]), read(vec![]), read(programs)));
        let c = &a.other_changes[0];
        assert_eq!(c.args.get("names").map(String::as_str), Some("A, B, C"));
        assert_eq!(c.args.get("more").map(String::as_str), Some("2"));
    }

    #[test]
    fn minor_windows_updates_are_counted_on_one_line_not_listed() {
        let updates = vec![
            update("2026-11-14T03:00:00Z", Some("KB1"), "definition"),
            update("2026-11-15T03:00:00Z", Some("KB2"), "definition"),
            update("2026-11-16T03:00:00Z", None, "store-app"),
        ];
        let a = look(Since::ThisWeek, report(8 * 24, read(vec![]), read(updates), read(vec![])));
        assert!(a.touch_games.is_empty());
        let minor: Vec<&Change> = a.other_changes.iter().filter(|c| c.id == "updates-minor").collect();
        assert_eq!(minor.len(), 1);
        assert_eq!(minor[0].args.get("n").map(String::as_str), Some("2"));
        assert_eq!(minor[0].args.get("m").map(String::as_str), Some("1"));
        assert_eq!(minor[0].how, "");
        // Only minor updates were seen: "no quality, feature or driver update" is still true and said.
        assert!(a.none.contains(&"windows-update"));
    }

    #[test]
    fn an_unclassified_update_is_counted_and_blocks_the_none_line() {
        let updates = vec![update("2026-11-16T03:00:00Z", Some("KB9"), "")];
        let a = look(Since::ThisWeek, report(8 * 24, read(vec![]), read(updates), read(vec![])));
        let row = a.other_changes.iter().find(|c| c.id == "updates-unclassified").unwrap();
        assert_eq!(row.args.get("kbs").map(String::as_str), Some("KB9"));
        assert!(!a.none.contains(&"windows-update"));
    }

    #[test]
    fn a_driver_class_update_that_is_the_graphics_install_is_folded_into_it() {
        let drivers = vec![gpu("2026-11-19T05:12:26Z", Some("1.0"), "2.0", Some(true))];
        let mut wu = update("2026-11-19T05:12:30Z", Some("KB777"), "driver");
        wu.what.to_version = Some("2.0".into());
        let a = look(Since::ThisWeek, report(8 * 24, read(drivers), read(vec![wu]), read(vec![])));
        assert_eq!(a.touch_games.len(), 1, "{:?}", a.touch_games);
        assert_eq!(a.touch_games[0].args.get("via_update").map(String::as_str), Some("true"));
    }

    #[test]
    fn an_update_row_without_a_kb_has_its_own_id() {
        let updates = vec![update("2026-11-17T03:00:00Z", None, "quality")];
        let a = look(Since::ThisWeek, report(8 * 24, read(vec![]), read(updates), read(vec![])));
        assert_eq!(a.touch_games[0].id, "windows-update-nokb");
    }

    #[test]
    fn game_files_are_said_to_be_unread_not_silent() {
        let a = look(Since::ThisWeek, live_like());
        let l = a.limits.iter().find(|l| l.kind == "game-update").unwrap();
        assert_eq!(l.code, "not-picked");
    }

    /// Read-only, on THIS PC: the real readers for the whole PC with "this week" and "this month", five
    /// timed runs of the first. Run by hand: `cargo test --lib live_first_look -- --ignored --nocapture`.
    #[test]
    #[ignore = "reads this PC's event logs and registry; run by hand"]
    fn live_first_look_prints_the_answer() {
        for since in [Since::ThisWeek, Since::ThisMonth] {
            let a = first_look_with(since, Utc::now(), CHANGES_BUDGET, read_real);
            println!("LIVE_FIRST_LOOK_JSON {}", serde_json::to_string(&a).unwrap());
        }
        let mut ms = Vec::new();
        for _ in 0..5 {
            let t = std::time::Instant::now();
            let a = first_look_with(Since::ThisWeek, Utc::now(), CHANGES_BUDGET, read_real);
            ms.push(t.elapsed().as_millis());
            assert!(a.limits.iter().all(|l| l.code != "took-too-long"), "a reader ran past the budget: {:?}", a.limits);
        }
        println!("LIVE_FIRST_LOOK_WALL_MS_THIS_WEEK {ms:?}");
    }

    #[test]
    fn the_first_look_writes_nothing_and_starts_nothing() {
        // Source-text guard (the pattern of the elevated-helper guard): this file reads Windows' records
        // through change_sources only. Words are assembled so this test does not match itself.
        let src = include_str!("first_look.rs");
        let code = src.split("#[cfg(test)]").next().unwrap();
        for banned in [
            ["Command", "::new"].concat(),
            ["fs::", "write"].concat(),
            ["File::", "create"].concat(),
            ["OpenOptions", "::new"].concat(),
            ["detect_and_", "persist"].concat(),
            ["get_game_", "readiness"].concat(),
            ["compy_data_", "dir"].concat(),
        ] {
            assert!(!code.contains(&banned), "first_look.rs must not contain {banned}");
        }
    }
}
