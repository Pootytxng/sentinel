//! M3: the graphics card's temperature and the diagnosed game's crash history, as evidence. READ-ONLY.
//!
//! Neither is a verdict. Temperature is two numbers the sessions already carry (the peak in the rough
//! sessions, the typical (median) peak in the normal ones). Crashes come from Windows Error Reporting files (the
//! Black Box's own read: no process is started, nothing is written). The words "overheating" and
//! "throttling" are never used: Compy sees a peak reading, not what the card did about it.
//!
//! - The rough sessions' highest peak against the MEDIAN of the normal sessions' peaks. One sentence says both
//!   numbers whatever the outcome (Measured), in one place only.
//! - Within `TEMP_SAME_C` of that median: that one line sits under "Unchanged"; otherwise under "also looked at".
//! - More than `TEMP_HOTTER_C` above it: a candidate ("ran hotter than usual"), Possible at most. It has no
//!   timing (a peak reading says nothing about WHEN the card started running hotter) and no contradiction
//!   flag; its own evidence line is the temperature sentence, so the line is not also listed under
//!   "also looked at" (the sentence appears once).
//! - A reading missing on either side is a "Compy couldn't see" line, never an all-clear.
//! - Crashes: the count and first date for the diagnosed game, from the reports Compy could read (a partial
//!   read says "at least" and the line itself carries the limit). Only when every readable crash has the same
//!   faulting module AND exception code (two or more of them), AND at least one crash is older than the earliest
//!   REAL dated change (an exact date, or a mod's file-creation date; never the edge of a window), the line says
//!   the change can't be the whole story. It never says "probably".

use std::collections::BTreeSet;
use std::path::Path;

use super::*;
use crate::blackbox::AppCrashes;

/// A rough-session peak this many degrees above the normal ones' median peak (or less) is "about the same".
pub(crate) const TEMP_SAME_C: i64 = 5;
/// A rough-session peak MORE than this many degrees above the normal ones' median peak is a candidate.
pub(crate) const TEMP_HOTTER_C: i64 = 10;

/// One app crash, reduced from a Windows Error Reporting file (`blackbox::AppCrash`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CrashFact {
    pub app: String,
    pub when: DateTime<Utc>,
    pub module: Option<String>,
    pub code: Option<String>,
    /// The program's own version string, when the report carries one.
    pub version: Option<String>,
    /// Whether the report's exe path lies under the game's install folder: `None` when the report has no
    /// path or the install folder is unknown (then only the program name matched).
    pub path_ok: Option<bool>,
}

/// What the command could read of the crash history.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CrashHistory {
    pub crashes: Vec<CrashFact>,
    /// A Windows Error Reporting folder could be listed at all. False: nothing was read.
    pub listed: bool,
    /// Some reports were not read (a limit, or access was denied): the count may be low.
    pub partial: bool,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) enum CrashRead {
    /// Nobody asked (recorded fixtures): nothing is said about crashes either way.
    #[default]
    NotRead,
    /// The reader could not be used: `took-too-long` or `reader-failed`.
    Unavailable(&'static str),
    Read(CrashHistory),
}

/// The only reading of the crash files the engine sees, as a plain DTO.
pub(crate) fn crash_dto(a: AppCrashes, game_dir: Option<&Path>) -> CrashRead {
    CrashRead::Read(CrashHistory {
        crashes: a
            .crashes
            .into_iter()
            .map(|c| {
                let path_ok = match (&c.path, game_dir) {
                    (Some(p), Some(dir)) => Some(crate::game_mods::image_is_under(dir, Path::new(p))),
                    _ => None,
                };
                CrashFact { app: c.app, when: c.when, module: c.module, code: c.code, version: c.version, path_ok }
            })
            .collect(),
        listed: a.listed_any,
        partial: a.needs_admin || a.complete_from.is_some(),
    })
}

/// The real read, for the command. Read-only file reads; call it from a blocking context. `game_exe` is the
/// diagnosed game's program name: its Steam install folder (when exactly one is found) lets a report's exe
/// path be checked against it.
pub(crate) fn read_real_crashes(game_exe: &str) -> CrashRead {
    let dir = crate::game_mods::install_folder_of(game_exe);
    crash_dto(crate::blackbox::read_app_crashes(), dir.as_deref())
}

fn peak(s: &SessionFacts) -> Option<i64> {
    s.peak_gpu_temp_c.map(i64::from)
}

pub(super) fn detect_temperature(c: &Ctx, out: &mut Out) {
    let rough_peaks: Vec<i64> = c.affected.iter().copied().filter_map(peak).collect();
    let mut normal_peaks: Vec<f64> = c.base.iter().copied().filter_map(peak).map(|p| p as f64).collect();
    let Some(rough) = rough_peaks.iter().copied().max().filter(|_| !normal_peaks.is_empty()) else {
        out.unknown("gpu-temp");
        return;
    };
    // The normal sessions' typical peak: their median (one hot normal session does not move it far).
    let base = median(&mut normal_peaks).round() as i64;
    let args = [("rough", rough.to_string()), ("base", base.to_string()), ("count", rough_peaks.len().to_string())];
    let over = rough - base;
    // ONE line says both numbers (the same sentence wherever it sits): under "Unchanged" when the rough peak is
    // about the same, under "also looked at" when it is somewhat higher, and as the evidence of the
    // "ran hotter than usual" candidate when it is much higher. It is never said twice.
    if over <= TEMP_SAME_C {
        out.ruled_out("gpu-temp", &args);
    } else if over <= TEMP_HOTTER_C {
        out.see("gpu-temp", &args);
    } else {
        // One measured size with no timing: a peak reading does not say when the card began running hotter,
        // so it is Possible at most and ranks below every dated change.
        out.cands.push(Cand {
            id: "gpu-hotter",
            t: false,
            d: false,
            x: false,
            confounded: false,
            m: true,
            r: false,
            c1: false,
            since: When::Unknown,
            fix: steps("gpu-hotter", &[]),
            evidence: vec![ev(EvidenceKind::Measured, "gpu-temp", "sessions", false, &args)],
        });
    }
}

pub(super) fn detect_crashes(c: &Ctx, out: &mut Out) {
    match &c.inp.crashes {
        CrashRead::NotRead => {}
        CrashRead::Unavailable(_) => out.unknown("crashes-unavailable"),
        CrashRead::Read(h) if !h.listed => out.unknown("crashes-unreadable"),
        CrashRead::Read(h) => {
            let game = c.first_bad.game.as_str();
            // The card's period: after the last normal session, up to the first rough one. Windows' dated rows
            // among the candidates and Compy's own applies in that period, by the same function the first look uses.
            let windows = dated_candidates(&out.cands);
            // An unreadable ledger is not "Compy changed nothing": it stays out of the comparison and the answer
            // says so (below), and the sentence never claims the earliest change of all.
            let in_period: Vec<(DateTime<Utc>, &str)> = match &c.inp.compy_applies {
                CompyApplies::Read(v) => v.iter().filter(|(t, _)| *t > c.win_start && *t <= c.win_end).map(|(t, title)| (*t, title.as_str())).collect(),
                CompyApplies::NotRead | CompyApplies::Unreadable => Vec::new(),
            };
            let ledger_unreadable = matches!(c.inp.compy_applies, CompyApplies::Unreadable);
            let earliest = earliest_dated_change(windows, in_period.iter().map(|(t, _)| *t));
            match crash_outcome(h, CrashMatch::Program(game), earliest.map(|e| e.at)) {
                CrashOutcome::Line(l) => {
                    out.see("game-crashes", &l.args);
                    if let (Some((module, before)), Some(e)) = (l.signature, earliest) {
                        let mut args = vec![("module", module), ("before", before), ("kind", e.origin.code().to_string())];
                        if ledger_unreadable {
                            // The date is a change Windows recorded, which is true whatever the ledger holds; "earliest" is not.
                            args.push(("ledger", "unreadable".to_string()));
                            out.unknown("compy-ledger-unreadable");
                        } else if e.origin == ChangeOrigin::Compy {
                            // Which change(s) Compy applied at that moment, so "a change Compy applied" is never vague.
                            let mut near: Vec<(DateTime<Utc>, &str)> =
                                in_period.iter().copied().filter(|(t, title)| *t >= e.at && (*t - e.at).num_seconds() < 60 && !title.trim().is_empty()).collect();
                            near.sort_by_key(|(t, _)| *t);
                            if !near.is_empty() {
                                args.push(("titles", near.iter().map(|(_, title)| *title).collect::<Vec<_>>().join("\u{1f}")));
                            }
                        }
                        out.see("game-crash-signature", &args);
                    }
                }
                // No count line to carry the limit: say what could not be seen.
                CrashOutcome::NoneCounted { partial } => {
                    if partial {
                        out.unknown("crashes-partial");
                    }
                }
            }
        }
    }
}

/// How a crash report is tied to the game asked about.
#[derive(Clone, Copy, Debug)]
pub(crate) enum CrashMatch<'a> {
    /// The program name must match; when the report says where the exe was and the game's install folder is
    /// known, that path must lie under it (the measured flow, and a first look for a game Compy has recorded).
    Program(&'a str),
    /// Only the install folder is known (a game picked from Steam's list): the report's exe path must lie
    /// under it. A report with no path could belong to the game, so it makes the read partial.
    InstallFolder,
}

/// The crash line for a game: the numbers the card words, from the crash facts alone.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CrashLine {
    /// `n`, `since`, and `partial` / `byName` / `versions` when they apply (the card's own args).
    pub args: Vec<(&'static str, String)>,
    /// `(module, date of the earliest dated change)`: only under the signature conditions below.
    pub signature: Option<(String, String)>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum CrashOutcome {
    Line(CrashLine),
    /// No crash of this game was counted. `partial`: the read did not cover everything, so this is not
    /// "no crashes".
    NoneCounted { partial: bool },
}

/// THE crash rule, shared by the measured flow and the first look (one code path, one set of sentences).
/// `earliest` is the earliest REAL dated change (see `earliest_dated_change`): the signature line needs one.
pub(crate) fn crash_outcome(h: &CrashHistory, how: CrashMatch<'_>, earliest: Option<DateTime<Utc>>) -> CrashOutcome {
    let mine: Vec<&CrashFact> = match how {
        CrashMatch::Program(game) => h.crashes.iter().filter(|k| same_game(&k.app, game) && k.path_ok != Some(false)).collect(),
        CrashMatch::InstallFolder => h.crashes.iter().filter(|k| k.path_ok == Some(true)).collect(),
    };
    let unattributable = matches!(how, CrashMatch::InstallFolder) && h.crashes.iter().any(|k| k.path_ok.is_none());
    let partial = h.partial || unattributable;
    let Some(since) = mine.iter().map(|k| k.when).min() else { return CrashOutcome::NoneCounted { partial } };
    let mut args = vec![("n", mine.len().to_string()), ("since", iso(since))];
    if partial {
        // The line itself says "at least": a partial read only gives a lower bound.
        args.push(("partial", "true".to_string()));
    }
    if matches!(how, CrashMatch::Program(_)) && mine.iter().any(|k| k.path_ok != Some(true)) {
        args.push(("byName", "true".to_string()));
    }
    let versions: BTreeSet<String> = mine.iter().filter_map(|k| k.version.as_deref()).map(|v| v.trim().to_ascii_lowercase()).filter(|v| !v.is_empty()).collect();
    if versions.len() > 1 {
        args.push(("versions", versions.len().to_string()));
    }
    CrashOutcome::Line(CrashLine { args, signature: shared_signature(&mine, earliest) })
}

/// Where the earliest dated change came from: said in the sentence, so a reader knows what "change" means.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ChangeOrigin {
    /// A change Windows recorded (a driver install, an update, a game's files, a program install).
    Windows,
    /// A change Compy applied, from its own ledger.
    Compy,
}

impl ChangeOrigin {
    pub(crate) fn code(self) -> &'static str {
        match self {
            ChangeOrigin::Windows => "windows",
            ChangeOrigin::Compy => "compy",
        }
    }
}

/// Compy's own ledger of applied changes, as the card's input: when and what. A read that failed is its own
/// state, never an empty list.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) enum CompyApplies {
    /// Nobody asked (recorded fixtures): nothing is said about Compy's own changes either way.
    #[default]
    NotRead,
    /// The ledger could not be read.
    Unreadable,
    /// `(applied at, title)` for every row, whatever its status.
    Read(Vec<(DateTime<Utc>, String)>),
}

/// The ledger read (`history::read_ledger_stamps`) as the card's input. A row with an unparseable date is left
/// out of the list, the same as the first look does.
pub(crate) fn compy_applies_from(read: Result<Vec<crate::history::LedgerStamp>, String>) -> CompyApplies {
    match read {
        Ok(stamps) => CompyApplies::Read(stamps.into_iter().filter_map(|s| ts(&s.applied_at).map(|t| (t, s.title))).collect()),
        Err(_) => CompyApplies::Unreadable,
    }
}

/// B10b: one record of Compy's own ledger as the compy-change follow-through reads it: when it was applied, its title,
/// and when it was undone (`rolled_back_at`, only when the record is rolled back and the time parses). From the same
/// stamps read as [`CompyApplies`]; nothing else of the ledger is read, nothing is stored or exported.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CompyRecord {
    pub applied: DateTime<Utc>,
    pub title: String,
    pub undone: Option<DateTime<Utc>>,
}

/// The stamps as [`CompyRecord`]s (a row whose apply time does not parse is left out, as in [`compy_applies_from`]).
/// A read that failed gives none: the follow-through then says nothing (never "not undone").
pub(crate) fn compy_records_from(read: &Result<Vec<crate::history::LedgerStamp>, String>) -> Vec<CompyRecord> {
    let Ok(stamps) = read else { return Vec::new() };
    stamps
        .iter()
        .filter_map(|s| {
            let applied = ts(&s.applied_at)?;
            let undone = if s.status == "rolled_back" { s.rolled_back_at.as_deref().and_then(ts) } else { None };
            Some(CompyRecord { applied, title: s.title.clone(), undone })
        })
        .collect()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct EarliestChange {
    pub at: DateTime<Utc>,
    pub origin: ChangeOrigin,
}

/// THE definition of "the earliest dated change Compy found", shared by the card and the first look: the earliest
/// exact moment among the changes Windows recorded and the changes Compy applied, in the period the caller looked
/// at. A day-precision row, a window edge and a mod's file-creation time are not moments (Windows resets the
/// creation time when a folder is copied), so callers never pass them. On a tie the Windows record is named.
pub(crate) fn earliest_dated_change(
    windows: impl IntoIterator<Item = DateTime<Utc>>,
    compy: impl IntoIterator<Item = DateTime<Utc>>,
) -> Option<EarliestChange> {
    let w = windows.into_iter().min().map(|at| EarliestChange { at, origin: ChangeOrigin::Windows });
    let c = compy.into_iter().min().map(|at| EarliestChange { at, origin: ChangeOrigin::Compy });
    match (w, c) {
        (Some(w), Some(c)) => Some(if c.at < w.at { c } else { w }),
        (w, c) => w.or(c),
    }
}

/// The exact dates of the card's dated candidates that Windows recorded. The edge of an observed-between window
/// is where Compy happened to be looking, not a date of anything, so it never counts; a mod's file-creation time
/// does not either (see `earliest_dated_change`).
fn dated_candidates(cands: &[Cand]) -> Vec<DateTime<Utc>> {
    cands
        .iter()
        .filter(|k| k.t && k.id != "graphics-mod")
        .filter_map(|k| match &k.since {
            When::Exact { at } => ts(at),
            _ => None,
        })
        .collect()
}

/// `Some((module, date of the earliest dated change))` only when BOTH hold: two or more crashes, all
/// with the same faulting module and exception code; and at least one crash predates that dated change.
fn shared_signature(crashes: &[&CrashFact], earliest: Option<DateTime<Utc>>) -> Option<(String, String)> {
    let first = crashes.first()?;
    let (module, code) = (first.module.as_deref()?, first.code.as_deref()?);
    let same = crashes.len() >= 2
        && crashes.iter().all(|k| k.module.as_deref().is_some_and(|m| m.eq_ignore_ascii_case(module)) && k.code.as_deref().is_some_and(|x| x.eq_ignore_ascii_case(code)));
    let earliest = earliest?;
    let predates = crashes.iter().any(|k| k.when < earliest);
    (same && predates).then(|| (module.to_string(), iso(earliest)))
}
