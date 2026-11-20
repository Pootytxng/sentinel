//! F4b: what Windows recorded between the last normal session and the rough ones, used by the diagnosis.
//!
//! The readers live in `change_sources` and are READ-ONLY (event logs, registry, Steam manifests). This
//! module has two halves. The engine half is pure: it takes a `ChangeReport` as an input and turns it
//! into evidence, candidates, "what Compy checked" lines and "what Compy couldn't see" lines, with the
//! same honesty rules as the rest of the engine (an unread source is never "nothing changed"; Windows'
//! dated driver install is the SAME fact as the sessions' driver stamps and only sharpens the timing, so
//! it is never a second independent support). The orchestration half runs the readers once, off the UI
//! thread, inside a total time budget; if they fail or run long the diagnosis proceeds with every kind
//! Unknown. Nothing here writes a file or starts a process of its own.

use std::time::Duration;

use super::*;
use crate::change_sources::{
    self, ChangeError, ChangeEvent, ChangeKind, ChangeReport, Gap, KindStatus, Note, Precision, SteamLookup, UnreadableReason,
};

/// Everything the readers (Steam lookup plus the four Windows sources) may take, in total.
pub(crate) const CHANGES_BUDGET: Duration = Duration::from_millis(1500);
/// The part of that spent finding the game in Steam before the readers start.
const STEAM_LOOKUP_BUDGET: Duration = Duration::from_millis(400);
/// Programs listed by name in the one collapsed "installed" line.
const PROGRAM_NAMES_SHOWN: usize = 3;
/// Update installs listed one by one before the rest collapse into a count.
const UPDATES_SHOWN: usize = 3;

/// Whether Compy could place the game in a Steam library (the readers only ask Steam about a game
/// they have found).
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum GameSteam {
    Found,
    NotInSteam,
    Unreadable(UnreadableReason),
}

/// What the dated readers gave the diagnosis.
#[derive(Clone, Debug, Default)]
pub(crate) enum ChangeRead {
    /// Nobody asked (the pure engine on recorded fixtures). Every kind is Unknown.
    #[default]
    NotRead,
    /// The readers could not be used: `took-too-long`, `reader-failed` or `no-window`. Every kind is Unknown.
    Unavailable(&'static str),
    Report { report: Box<ChangeReport>, steam: GameSteam },
}

/// One thing Compy could not see, per kind of change: `kind` is `driver`, `windows-update`, `game-update`
/// or `programs`; `code` says why. The UI owns the sentence.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Limit {
    pub kind: &'static str,
    pub code: &'static str,
    pub args: BTreeMap<&'static str, String>,
}

fn limit(kind: &'static str, code: &'static str, args: &[(&'static str, String)]) -> Limit {
    Limit { kind, code, args: args.iter().cloned().collect() }
}

/// Where an event sits against the period that matters: after the last normal session ended and up to
/// the first rough session's start (`Timing`), earlier, or later (the card shows later ones as evidence
/// against, never as timing).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Bucket {
    Before,
    Timing,
    After,
    Unknown,
}

struct Span {
    lo: DateTime<Utc>,
    hi: DateTime<Utc>,
}

fn span(c: &Ctx) -> Span {
    Span { lo: c.last_normal.end().unwrap_or(c.win_start), hi: c.win_end }
}

fn bucket(e: &ChangeEvent, sp: &Span) -> Bucket {
    match (e.when.precision, e.when.at, e.when.until) {
        (Precision::Exact, Some(a), _) if a <= sp.lo => Bucket::Before,
        (Precision::Exact, Some(a), _) if a <= sp.hi => Bucket::Timing,
        (Precision::Exact, Some(_), _) => Bucket::After,
        // A day is "in the period" if any part of it is: the card says the day, never a time of day.
        (Precision::Day, Some(_), Some(b)) if b <= sp.lo => Bucket::Before,
        (Precision::Day, Some(a), Some(_)) if a >= sp.hi => Bucket::After,
        (Precision::Day, Some(_), Some(_)) => Bucket::Timing,
        _ => Bucket::Unknown,
    }
}

pub(super) fn report<'a>(c: &'a Ctx) -> Option<&'a ChangeReport> {
    match &c.inp.changes {
        ChangeRead::Report { report, .. } => Some(report.as_ref()),
        _ => None,
    }
}

pub(super) fn kind_events(r: &ChangeReport, kind: ChangeKind) -> impl DoubleEndedIterator<Item = &ChangeEvent> {
    r.events_found.iter().filter(move |e| e.kind == kind)
}

pub(super) fn is_complete(r: &ChangeReport, kind: ChangeKind) -> bool {
    matches!(r.status(kind), KindStatus::Complete { .. })
}

pub(super) fn when_of(e: &ChangeEvent) -> Option<DateTime<Utc>> {
    e.when.at
}

pub(super) fn class_of(e: &ChangeEvent) -> String {
    e.what.detail.as_deref().unwrap_or("").trim().to_ascii_lowercase()
}

/// A real, dated GPU driver install: Windows said the version changed. `Some(false)` (the same version
/// configured again) and `None` (previous version unknown) are never a change.
pub(super) fn gpu_installs<'a>(c: &'a Ctx) -> Vec<(&'a ChangeEvent, DateTime<Utc>, Bucket)> {
    let (Some(r), sp) = (report(c), span(c)) else { return Vec::new() };
    let mut v: Vec<(&ChangeEvent, DateTime<Utc>, Bucket)> = kind_events(r, ChangeKind::GpuDriver)
        .filter(|e| e.what.version_changed == Some(true))
        .filter_map(|e| when_of(e).map(|at| (e, at, bucket(e, &sp))))
        .collect();
    v.sort_by_key(|(_, at, _)| *at);
    v
}

/// The newest graphics-driver row of each kind that never dates a change: the same version configured
/// again, and a row whose previous version is unknown. Rows from before the period are not shown.
fn unclear_rows(c: &Ctx) -> (Option<DateTime<Utc>>, Option<DateTime<Utc>>) {
    let (Some(r), sp) = (report(c), span(c)) else { return (None, None) };
    let newest = |want: Option<bool>| {
        kind_events(r, ChangeKind::GpuDriver)
            .filter(|e| e.what.version_changed == want && bucket(e, &sp) != Bucket::Before)
            .filter_map(when_of)
            .max()
    };
    (newest(Some(false)), newest(None))
}

/// Is this Windows Update row the same install as that driver row? The same moment (within two minutes)
/// and, when both name a version, the same version.
fn same_install(update: &ChangeEvent, driver: &ChangeEvent) -> bool {
    let (Some(a), Some(b)) = (when_of(update), when_of(driver)) else { return false };
    if (a - b).num_seconds().abs() > 120 {
        return false;
    }
    match (update.what.to_version.as_deref(), driver.what.to_version.as_deref()) {
        (Some(x), Some(y)) => crate::hardware::same_driver(x, y),
        _ => true,
    }
}

/// A driver-class Windows Update that delivered this graphics driver install.
fn delivered_by_update(r: &ChangeReport, driver: &ChangeEvent) -> bool {
    kind_events(r, ChangeKind::WindowsUpdate).any(|w| class_of(w) == "driver" && same_install(w, driver))
}

fn delivered_line(c: &Ctx, e: &ChangeEvent) -> Option<Evidence> {
    report(c).filter(|r| delivered_by_update(r, e)).map(|_| ev(EvidenceKind::Known, "delivered-by-update", "windows", false, &[]))
}

/// The install that explains `to` (the version the first rough session ran). With `to` known, only an
/// install of THAT version counts (another adapter's, or another version's, never dates this change):
/// the newest in the period, else the newest later one (shown against). With `to` unknown, the newest
/// in the period, else the newest later one.
fn pick_install<'a>(
    installs: &[(&'a ChangeEvent, DateTime<Utc>, Bucket)],
    to: Option<&str>,
) -> Option<(&'a ChangeEvent, DateTime<Utc>, Bucket)> {
    let newest = |want: Bucket| {
        installs
            .iter()
            .rev()
            .find(|(e, _, b)| {
                *b == want
                    && match to {
                        None => true,
                        Some(t) => e.what.to_version.as_deref().is_some_and(|v| crate::hardware::same_driver(v, t)),
                    }
            })
            .copied()
    };
    newest(Bucket::Timing).or_else(|| newest(Bucket::After))
}

/// What the driver detector adds from Windows' own record. Returns the evidence lines, the exact time (if
/// any) and whether the install came after the first rough session.
pub(super) struct DriverRecord {
    pub evidence: Vec<Evidence>,
    pub exact: Option<DateTime<Utc>>,
    pub after_rough: bool,
}

pub(super) fn driver_record(c: &Ctx, to: Option<&str>, first_new: DateTime<Utc>, out: &mut Out) -> DriverRecord {
    let installs = gpu_installs(c);
    match pick_install(&installs, to) {
        Some((e, at, Bucket::Timing)) => {
            let mut evidence = vec![ev(
                EvidenceKind::Known,
                "install-recorded",
                "windows",
                false,
                &[("when", iso(at)), ("version", e.what.to_version.clone().unwrap_or_default())],
            )];
            evidence.extend(delivered_line(c, e));
            DriverRecord { evidence, exact: Some(at), after_rough: false }
        }
        Some((_, at, _)) => DriverRecord {
            evidence: vec![ev(EvidenceKind::Measured, "install-after-rough", "windows", true, &[("when", iso(at))])],
            exact: None,
            after_rough: true,
        },
        None => {
            // An install of some other version (another adapter, another driver) is shown on its own and
            // never supplies this driver's time.
            if let Some((_, at, _)) = installs.iter().rev().find(|(_, _, b)| *b != Bucket::Before) {
                out.see("driver-other-install", &[("when", iso(*at))]);
            }
            // "Windows has no record" needs a complete read AND no graphics driver row of any kind: a
            // same-version row or a row with an unknown previous version is still an install record.
            let none_at_all = report(c).is_some_and(|r| is_complete(r, ChangeKind::GpuDriver) && kind_events(r, ChangeKind::GpuDriver).next().is_none());
            let mut evidence = vec![if none_at_all {
                ev(EvidenceKind::Unknown, "install-not-recorded", "windows", false, &[("seenAt", iso(first_new))])
            } else {
                ev(EvidenceKind::Unknown, "install-time-not-read", "snapshots", false, &[("seenAt", iso(first_new))])
            }];
            let (same, unknown) = unclear_rows(c);
            if let Some(at) = same {
                evidence.push(ev(EvidenceKind::Known, "reinstall-same-version", "windows", false, &[("when", iso(at))]));
            }
            if let Some(at) = unknown {
                evidence.push(ev(EvidenceKind::Known, "install-prior-unknown", "windows", false, &[("when", iso(at))]));
            }
            DriverRecord { evidence, exact: None, after_rough: false }
        }
    }
}

/// With the sessions' driver stamps unread, Windows' own dated install still places a driver change in
/// the period: timing only, so Possible at best. The fix steps name versions only when Windows gave them.
pub(super) fn windows_only_driver(c: &Ctx, out: &mut Out) {
    let installs = gpu_installs(c);
    let Some((e, at, Bucket::Timing)) = pick_install(&installs, None) else { return };
    let known = |v: &Option<String>| v.as_deref().map(str::trim).filter(|v| !v.is_empty()).map(str::to_string);
    let fix = match (known(&e.what.from_version), known(&e.what.to_version)) {
        (Some(from), Some(to)) => steps("gpu-driver-change", &[("from", from), ("to", to)]),
        _ => no_safe_change(),
    };
    let mut evidence = vec![ev(
        EvidenceKind::Known,
        "install-recorded",
        "windows",
        false,
        &[("when", iso(at)), ("version", e.what.to_version.clone().unwrap_or_default())],
    )];
    evidence.extend(delivered_line(c, e));
    out.cands.push(Cand {
        id: "gpu-driver-change",
        t: true,
        d: false,
        x: false,
        confounded: false,
        r: false,
        m: false,
        c1: false,
        since: When::Exact { at: iso(at) },
        fix,
        evidence,
    });
}

/// The driver is unchanged on the sessions' stamps. Windows' record is added only when it was read
/// completely and has NO graphics driver row in the period, of any kind.
pub(super) fn driver_unchanged_args(c: &Ctx) -> Vec<(&'static str, String)> {
    match report(c) {
        Some(r) if is_complete(r, ChangeKind::GpuDriver) && kind_events(r, ChangeKind::GpuDriver).next().is_none() => {
            vec![("windows", "none".to_string())]
        }
        _ => Vec::new(),
    }
}

/// Stamps equal, yet Windows recorded an install row in the period: said as it is, not as a change.
pub(super) fn driver_same_stamp_note(c: &Ctx, out: &mut Out) {
    if let Some((_, at, Bucket::Timing)) = pick_install(&gpu_installs(c), None) {
        out.see("driver-install-same-stamp", &[("when", iso(at))]);
    }
    let (same, unknown) = unclear_rows(c);
    if let Some(at) = same {
        out.see("driver-reinstall-same", &[("when", iso(at))]);
    }
    if let Some(at) = unknown {
        out.see("driver-install-prior-unknown", &[("when", iso(at))]);
    }
}

fn is_major(class: &str) -> bool {
    matches!(class, "quality" | "feature" | "driver")
}

fn is_minor(class: &str) -> bool {
    matches!(class, "definition" | "store-app")
}

pub(super) fn detect_windows_update(c: &Ctx, out: &mut Out) {
    let Some(r) = report(c) else { return };
    let sp = span(c);
    let all: Vec<&ChangeEvent> = kind_events(r, ChangeKind::WindowsUpdate).collect();
    // A driver-class update that IS a graphics driver install Windows also recorded is the same install:
    // the driver finding says "Windows Update delivered it", so it is not a second candidate.
    let folded = |e: &ChangeEvent| class_of(e) == "driver" && kind_events(r, ChangeKind::GpuDriver).any(|g| same_install(e, g));
    let mut hits: Vec<&ChangeEvent> = all
        .iter()
        .copied()
        .filter(|e| is_major(&class_of(e)) && bucket(e, &sp) == Bucket::Timing && when_of(e).is_some() && !folded(e))
        .collect();
    hits.sort_by_key(|e| when_of(e));
    let minor = |class: &str| all.iter().filter(|e| bucket(e, &sp) == Bucket::Timing && class_of(e) == class).count();
    let (defs, apps) = (minor("definition"), minor("store-app"));
    if defs + apps > 0 {
        out.see("updates-minor", &[("n", defs.to_string()), ("m", apps.to_string())]);
    }
    // An update whose class Compy does not recognise (a title in another language, a new kind) is never
    // dropped and never an "unchanged" fact: it is counted, with its KB id when there is one.
    let unclassified: Vec<&&ChangeEvent> = all.iter().filter(|e| !is_major(&class_of(e)) && !is_minor(&class_of(e))).collect();
    if !unclassified.is_empty() {
        let mut kbs: Vec<String> = unclassified.iter().filter_map(|e| e.what.kb.clone()).collect();
        kbs.sort();
        kbs.dedup();
        out.see("updates-unclassified", &[("n", unclassified.len().to_string()), ("kbs", kbs.join(", "))]);
    }
    if hits.is_empty() {
        // "No quality or feature update" is said only when EVERY update row in the window is a
        // recognised minor kind (definition, Store app) and the log was read completely.
        if is_complete(r, ChangeKind::WindowsUpdate) && all.iter().all(|e| is_minor(&class_of(e))) {
            out.ruled_out("windows-update", &[]);
        }
        return;
    }
    let mut evidence: Vec<Evidence> = hits
        .iter()
        .take(UPDATES_SHOWN)
        .map(|e| {
            let id = e.what.kb.clone().or_else(|| e.what.name.clone()).unwrap_or_default();
            ev(
                EvidenceKind::Known,
                "update-installed",
                "windows",
                false,
                &[("kb", id), ("when", iso(when_of(e).unwrap_or(sp.lo))), ("class", class_of(e))],
            )
        })
        .collect();
    if hits.len() > UPDATES_SHOWN {
        evidence.push(ev(EvidenceKind::Known, "update-more", "windows", false, &[("count", (hits.len() - UPDATES_SHOWN).to_string())]));
    }
    let (first, last) = (when_of(hits[0]).unwrap_or(sp.lo), when_of(hits[hits.len() - 1]).unwrap_or(sp.lo));
    let quality = hits.iter().any(|e| class_of(e) == "quality");
    // The uninstall step names the quality update's own KB, never another update's.
    let kb = hits.iter().filter(|e| class_of(e) == "quality").find_map(|e| e.what.kb.clone()).unwrap_or_default();
    out.cands.push(Cand {
        id: "windows-update",
        t: true,
        d: false,
        x: false,
        confounded: false,
        r: false,
        m: false,
        c1: false,
        since: if first == last { When::Exact { at: iso(first) } } else { When::ObservedBetween { from: iso(first), to: iso(last) } },
        fix: steps("windows-update", &[("kb", kb), ("quality", quality.to_string())]),
        evidence,
    });
}

pub(super) fn detect_game_files(c: &Ctx, out: &mut Out) {
    let Some(r) = report(c) else { return };
    let sp = span(c);
    let hit = kind_events(r, ChangeKind::GameUpdate).rfind(|e| bucket(e, &sp) == Bucket::Timing);
    if let Some(e) = hit {
        let at = when_of(e).unwrap_or(sp.lo);
        out.cands.push(Cand {
            id: "game-files-change",
            t: true,
            d: false,
            x: false,
            confounded: false,
            r: false,
            m: false,
            c1: false,
            since: When::Exact { at: iso(at) },
            fix: steps("game-files-change", &[]),
            evidence: vec![ev(EvidenceKind::Known, "files-changed", "steam", false, &[("when", iso(at))])],
        });
        return;
    }
    // Steam's last recorded update is older than the period: a later change would have hidden one inside
    // it (the manifest keeps only the newest). The card words it as Steam's record, not as the files.
    if is_complete(r, ChangeKind::GameUpdate) {
        if let Some(at) = r.game_last_update.as_ref().and_then(when_of).filter(|at| *at <= sp.lo) {
            out.ruled_out("game-files-change", &[("since", iso(at))]);
        }
    }
}

fn program_key(s: &str) -> String {
    s.to_ascii_lowercase().chars().filter(char::is_ascii_alphanumeric).collect()
}

/// An installed program's display name and a process name that started in a rough session are the same
/// program when their letters agree, or the program's name starts with the process name (five letters
/// or more, so "cmd" never matches "cmder"). A looser match would invent a cause.
fn same_program(installed: &str, process: &str) -> bool {
    let (p, e) = (program_key(installed), program_key(process));
    !p.is_empty() && !e.is_empty() && (p == e || (e.len() >= 5 && p.starts_with(&e)))
}

pub(super) fn detect_programs(c: &Ctx, out: &mut Out) {
    let Some(r) = report(c) else { return };
    let sp = span(c);
    let mut installed: Vec<&ChangeEvent> =
        kind_events(r, ChangeKind::ProgramInstalled).filter(|e| bucket(e, &sp) == Bucket::Timing && e.what.name.is_some()).collect();
    installed.sort_by_key(|e| (when_of(e), e.what.name.clone()));
    if installed.is_empty() {
        if is_complete(r, ChangeKind::ProgramInstalled) {
            out.see("programs-none", &[]);
        }
        return;
    }
    let day = |e: &ChangeEvent| when_of(e).map(iso).unwrap_or_default();
    let names: Vec<String> = installed.iter().take(PROGRAM_NAMES_SHOWN).filter_map(|e| e.what.name.clone()).collect();
    out.see(
        "programs-installed",
        &[
            ("count", installed.len().to_string()),
            ("names", names.join(", ")),
            ("more", installed.len().saturating_sub(PROGRAM_NAMES_SHOWN).to_string()),
            ("day", day(installed[0])),
            ("last", day(installed[installed.len() - 1])),
        ],
    );
    // A candidate only when the program is ALSO among those seen starting in a rough session...
    let mut rough: Vec<&str> = Vec::new();
    for s in c.affected.iter().copied().chain(c.partial.iter().copied()) {
        rough.extend(s.started_names.iter().map(String::as_str));
    }
    for o in &c.others {
        for (s, j) in o.sess.iter().copied().zip(&o.judged) {
            if j.would_fire && s.start().is_some_and(|t| t >= c.win_start) {
                rough.extend(s.started_names.iter().map(String::as_str));
            }
        }
    }
    // ...and did NOT already start in a session judged Normal before the period: a program that ran
    // before was updated or reinstalled, not newly installed. (Absence from the recorder's sample proves
    // nothing; presence does.)
    let before = c.first_bad.start();
    let mut ran_before: Vec<&str> = Vec::new();
    for s in &c.base {
        ran_before.extend(s.started_names.iter().map(String::as_str));
    }
    for (s, j) in c.sess.iter().copied().zip(c.judged) {
        if j.verdict == Verdict::Normal && s.start() < before {
            ran_before.extend(s.started_names.iter().map(String::as_str));
        }
    }
    for o in &c.others {
        for (s, j) in o.sess.iter().copied().zip(&o.judged) {
            if j.verdict == Verdict::Normal && s.start() < before {
                ran_before.extend(s.started_names.iter().map(String::as_str));
            }
        }
    }
    let matched: Vec<&&ChangeEvent> = installed
        .iter()
        .filter(|e| {
            e.what.name.as_deref().is_some_and(|n| rough.iter().any(|p| same_program(n, p)) && !ran_before.iter().any(|p| same_program(n, p)))
        })
        .collect();
    if matched.is_empty() {
        return;
    }
    out.cands.push(Cand {
        id: "program-installed",
        t: true,
        d: false,
        x: false,
        confounded: false,
        r: false,
        m: false,
        c1: false,
        // Installs carry a day, never a time: the heading names the day and no time of day is claimed.
        since: When::Unknown,
        fix: steps(
            "program-installed",
            &[("names", matched.iter().take(PROGRAM_NAMES_SHOWN).filter_map(|e| e.what.name.clone()).collect::<Vec<_>>().join(", "))],
        ),
        evidence: matched
            .iter()
            .take(PROGRAM_NAMES_SHOWN)
            .map(|e| ev(EvidenceKind::Known, "installed-and-started", "uninstall-keys", false, &[("name", e.what.name.clone().unwrap_or_default()), ("day", day(e))]))
            .collect(),
    });
}

/// Audio, network and chipset drivers with a real version change in the period: one collapsed line, and a
/// candidate only when nothing else the engine found explains the timing.
pub(super) fn detect_other_drivers(c: &Ctx, out: &mut Out) {
    let Some(r) = report(c) else { return };
    let sp = span(c);
    let mut hits: Vec<&ChangeEvent> = kind_events(r, ChangeKind::OtherDriver)
        .filter(|e| e.what.version_changed == Some(true) && bucket(e, &sp) == Bucket::Timing && when_of(e).is_some())
        .collect();
    if hits.is_empty() {
        return;
    }
    hits.sort_by_key(|e| when_of(e));
    let mut classes: Vec<String> =
        hits.iter().filter_map(|e| e.what.detail.as_deref().and_then(|d| d.split_whitespace().next()).map(str::to_ascii_lowercase)).collect();
    classes.sort();
    classes.dedup();
    let classes = classes.join(", ");
    out.see("other-drivers", &[("count", hits.len().to_string()), ("classes", classes.clone())]);
    if out.cands.iter().any(|x| x.t) {
        return;
    }
    let (first, last) = (when_of(hits[0]).unwrap_or(sp.lo), when_of(hits[hits.len() - 1]).unwrap_or(sp.lo));
    out.cands.push(Cand {
        id: "other-driver-change",
        t: true,
        d: false,
        x: false,
        confounded: false,
        r: false,
        m: false,
        c1: false,
        since: if first == last { When::Exact { at: iso(first) } } else { When::ObservedBetween { from: iso(first), to: iso(last) } },
        fix: no_safe_change(),
        evidence: vec![ev(
            EvidenceKind::Known,
            "other-driver-installed",
            "windows",
            false,
            &[("count", hits.len().to_string()), ("classes", classes), ("when", iso(first))],
        )],
    });
}

// ---- What Compy could not see, per kind --------------------------------------------------------

/// A fixed code per reason; the UI owns the sentence. `NotSteam*` collapse into one: whatever the
/// launcher, Compy cannot see Steam's record for this game.
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

pub(super) fn status_limits(kind: &'static str, status: KindStatus, out: &mut Vec<Limit>) {
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

/// Always-true limits of a source that WAS read.
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

/// One entry (or more) per kind, always: a kind with nothing to say about its source is still listed
/// when the source was never read.
pub(super) fn limits(c: &Ctx) -> Vec<Limit> {
    const KINDS: [(&str, ChangeKind); 4] = [
        ("driver", ChangeKind::GpuDriver),
        ("windows-update", ChangeKind::WindowsUpdate),
        ("game-update", ChangeKind::GameUpdate),
        ("programs", ChangeKind::ProgramInstalled),
    ];
    let mut v = Vec::new();
    match &c.inp.changes {
        ChangeRead::NotRead => {
            for (name, _) in KINDS {
                v.push(limit(name, "not-read", &[]));
            }
        }
        ChangeRead::Unavailable(why) => {
            let why = *why;
            for (name, _) in KINDS {
                v.push(limit(name, why, &[]));
            }
        }
        ChangeRead::Report { report, steam } => {
            for (name, kind) in KINDS {
                match (kind, steam) {
                    (ChangeKind::GameUpdate, GameSteam::NotInSteam) => v.push(limit(name, "not-steam", &[])),
                    (ChangeKind::GameUpdate, GameSteam::Unreadable(r)) => v.push(limit(name, reason_code(r), &reason_args(r))),
                    _ => status_limits(name, report.status(kind), &mut v),
                }
            }
        }
    }
    v
}

// ---- Orchestration: the command's half ---------------------------------------------------------

/// The window the readers are asked about for an explained diagnosis: from the last normal session's
/// start to the newest affected session's end, `(t0, t1]`.
pub(crate) fn change_window(d: &Diagnosis) -> Option<(DateTime<Utc>, DateTime<Utc>)> {
    let p = d.problem.as_ref()?;
    let t0 = ts(&p.last_normal_at)?;
    // A recovered episode also asks Windows what happened up to the end of the sessions that ran normally.
    let recovered = d.recovery.iter().flat_map(|r| r.recovered_sessions.iter());
    let t1 = p
        .sessions_affected
        .iter()
        .chain(recovered)
        .filter_map(|s| ts(&s.started_at).map(|t| t + chrono::Duration::seconds(s.duration_secs as i64)))
        .max()?;
    Some((t0, t1))
}

/// Runs `f` on its own thread and waits at most `budget`. A reader that is still running when the
/// budget ends is left to finish on its own (each reader is bounded by its own budget); the caller gets
/// `Unavailable` and goes on. It never blocks the caller longer than `budget`.
pub(crate) fn run_within<F>(budget: Duration, f: F) -> ChangeRead
where
    F: FnOnce() -> ChangeRead + Send + 'static,
{
    let (tx, rx) = std::sync::mpsc::channel();
    let spawned = std::thread::Builder::new().name("paramedic-changes".into()).spawn(move || {
        let _ = tx.send(f());
    });
    if spawned.is_err() {
        return ChangeRead::Unavailable("reader-failed");
    }
    match rx.recv_timeout(budget) {
        Ok(r) => r,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => ChangeRead::Unavailable("took-too-long"),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => ChangeRead::Unavailable("reader-failed"),
    }
}

/// The real readers for one game: finds it in Steam by its process name, then asks every reader about
/// the window. Read-only; no network, no elevation.
pub(crate) fn read_real_changes(t0: DateTime<Utc>, t1: DateTime<Utc>, game_exe: &str) -> ChangeRead {
    let (game, steam) = match change_sources::find_steam_game(game_exe, STEAM_LOOKUP_BUDGET) {
        SteamLookup::Found(g) => (Some(g), GameSteam::Found),
        SteamLookup::NotInSteam => (None, GameSteam::NotInSteam),
        SteamLookup::Unreadable(r) => (None, GameSteam::Unreadable(r)),
    };
    match change_sources::changes_between(t0, t1, game.as_ref()) {
        Ok(report) => ChangeRead::Report { report: Box::new(report), steam },
        Err(ChangeError::EmptyWindow) => ChangeRead::Unavailable("no-window"),
    }
}

/// The diagnosis with the dated readers: a first pass finds the problem and its window, `fetch` reads
/// that window within `budget`, and the second pass uses the report. If there is no problem to explain,
/// or the readers fail or run long, the answer is the same engine with every kind Unknown.
#[cfg_attr(not(test), allow(dead_code))] // the command uses `diagnose_with_readings`; the tests of the Windows readers use this
pub(crate) fn diagnose_with_changes<F>(
    inp: DiagnoseInputs,
    complaint: Complaint,
    game: Option<&str>,
    budget: Duration,
    fetch: F,
) -> Diagnosis
where
    F: FnOnce(DateTime<Utc>, DateTime<Utc>, String) -> ChangeRead + Send + 'static,
{
    diagnose_with_readings(inp, complaint, game, budget, fetch, None::<fn(String, Vec<String>, Duration) -> ModInput>)
}

/// `diagnose_with_changes` plus the scan of the game's folder: `fetch_mods` gets the game's process name,
/// the process names of other games that also got rough, and the whole reader budget (so it never holds a
/// finished verdict back past it), and runs on its own thread beside the Windows
/// readers, so both wait inside the SAME `budget`. A scan that is still running when the budget ends is left
/// to finish by itself (each scan bounds itself) and the mods read as `took-too-long`, never as clean; the
/// Windows readers are never delayed by it.
pub(crate) fn diagnose_with_readings<F, G>(
    inp: DiagnoseInputs,
    complaint: Complaint,
    game: Option<&str>,
    budget: Duration,
    fetch: F,
    fetch_mods: Option<G>,
) -> Diagnosis
where
    F: FnOnce(DateTime<Utc>, DateTime<Utc>, String) -> ChangeRead + Send + 'static,
    G: FnOnce(String, Vec<String>, Duration) -> ModInput + Send + 'static,
{
    diagnose_with_all(inp, complaint, game, budget, fetch, fetch_mods, None::<fn(String) -> CrashRead>, None)
}

/// "A reader of this kind is still running" flags. A reader that outlives the budget is left to finish by
/// itself; while it does, pressing the button again does not start a second one of the same kind: that kind
/// reads as `took-too-long` instead. The command holds one static; the engine's tests pass none or a leaked one.
pub(crate) struct Slots {
    pub mods: std::sync::atomic::AtomicBool,
    pub crashes: std::sync::atomic::AtomicBool,
}

impl Slots {
    pub(crate) const fn new() -> Self {
        Self { mods: std::sync::atomic::AtomicBool::new(false), crashes: std::sync::atomic::AtomicBool::new(false) }
    }
}

/// A reader that has been started, or the reason it was not (`took-too-long`: the previous one still runs).
type Started<T> = Result<Option<std::sync::mpsc::Receiver<T>>, &'static str>;

/// Runs `f` on its own named thread and returns the channel it answers on (`Ok(None)` when no thread could
/// start). With a `slot`, only one such thread runs at a time: the flag clears when the thread ends, even by a panic.
fn spawn_reader<T: Send + 'static>(name: &str, slot: Option<&'static std::sync::atomic::AtomicBool>, f: impl FnOnce() -> T + Send + 'static) -> Started<T> {
    use std::sync::atomic::Ordering;
    if let Some(s) = slot {
        if s.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return Err("took-too-long");
        }
    }
    let guard = slot.map(mods::FlagGuard);
    let (tx, rx) = std::sync::mpsc::channel();
    Ok(std::thread::Builder::new()
        .name(name.into())
        .spawn(move || {
            let _guard = guard;
            let _ = tx.send(f());
        })
        .ok()
        .map(|_| rx))
}

/// Waits for a reader inside what is left of the shared budget. A reader that is late or died is
/// `Err("took-too-long" / "reader-failed")`, never an empty answer.
fn collect_reader<T>(rx: Started<T>, budget: Duration, started: std::time::Instant) -> Result<T, &'static str> {
    let Some(rx) = rx? else { return Err("reader-failed") };
    rx.recv_timeout(budget.saturating_sub(started.elapsed())).map_err(|e| match e {
        std::sync::mpsc::RecvTimeoutError::Timeout => "took-too-long",
        std::sync::mpsc::RecvTimeoutError::Disconnected => "reader-failed",
    })
}

/// `diagnose_with_readings` plus the read-only crash history (`fetch_crashes`), on its own thread inside the
/// same budget. A crash read that is late or dies reads as unavailable, never as "no crashes".
#[allow(clippy::too_many_arguments)]
pub(crate) fn diagnose_with_all<F, G, H>(
    mut inp: DiagnoseInputs,
    complaint: Complaint,
    game: Option<&str>,
    budget: Duration,
    fetch: F,
    fetch_mods: Option<G>,
    fetch_crashes: Option<H>,
    slots: Option<&'static Slots>,
) -> Diagnosis
where
    F: FnOnce(DateTime<Utc>, DateTime<Utc>, String) -> ChangeRead + Send + 'static,
    G: FnOnce(String, Vec<String>, Duration) -> ModInput + Send + 'static,
    H: FnOnce(String) -> CrashRead + Send + 'static,
{
    let probe = diagnose(&inp, complaint, game);
    let (Some((t0, t1)), Some(g)) = (change_window(&probe), probe.game.clone()) else { return probe };
    let started = std::time::Instant::now();
    let mods_rx = fetch_mods.map(|f| {
        let others = mods::other_rough_games(&inp, &probe);
        let game = g.clone();
        spawn_reader("paramedic-mods", slots.map(|s| &s.mods), move || f(game, others, budget))
    });
    let crashes_rx = fetch_crashes.map(|f| {
        let game = g.clone();
        spawn_reader("paramedic-crashes", slots.map(|s| &s.crashes), move || f(game))
    });
    inp.changes = run_within(budget, move || fetch(t0, t1, g));
    if let Some(rx) = mods_rx {
        inp.mods = collect_reader(rx, budget, started)
            .unwrap_or_else(|why| ModInput { game: mods::ModsRead::Unavailable(why), others: Vec::new() });
    }
    if let Some(rx) = crashes_rx {
        inp.crashes = collect_reader(rx, budget, started).unwrap_or_else(extras::CrashRead::Unavailable);
    }
    diagnose(&inp, complaint, probe.game.as_deref())
}
