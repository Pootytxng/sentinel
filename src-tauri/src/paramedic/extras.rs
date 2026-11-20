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
//!   timing (a peak reading says nothing about WHEN the card started running hotter), and it carries a
//!   contradiction (`c1`) when any rough session's peak was within `TEMP_SAME_C` of the median.
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
    // about the same, under "also looked at" otherwise. It is never said twice.
    if over <= TEMP_SAME_C {
        out.ruled_out("gpu-temp", &args);
    } else {
        out.see("gpu-temp", &args);
    }
    if over > TEMP_HOTTER_C {
        // One measured size with no timing: a peak reading does not say when the card began running hotter,
        // so it is Possible at most and ranks with the other sizes. A rough session whose peak stayed close to
        // the normal figure weighs against it.
        out.cands.push(Cand {
            id: "gpu-hotter",
            t: false,
            d: false,
            x: false,
            confounded: false,
            m: true,
            r: false,
            c1: rough_peaks.iter().any(|&p| p - base <= TEMP_SAME_C),
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
            // The program name must match; when the report says where the exe was and the game's install
            // folder is known, that path must lie under it.
            let mine: Vec<&CrashFact> = h.crashes.iter().filter(|k| same_game(&k.app, game) && k.path_ok != Some(false)).collect();
            let Some(since) = mine.iter().map(|k| k.when).min() else {
                // No count line to carry the limit: say what could not be seen.
                if h.partial {
                    out.unknown("crashes-partial");
                }
                return;
            };
            let mut args = vec![("n", mine.len().to_string()), ("since", iso(since))];
            if h.partial {
                // The line itself says "at least": a partial read only gives a lower bound.
                args.push(("partial", "true".to_string()));
            }
            if mine.iter().any(|k| k.path_ok != Some(true)) {
                args.push(("byName", "true".to_string()));
            }
            let versions: BTreeSet<String> = mine.iter().filter_map(|k| k.version.as_deref()).map(|v| v.trim().to_ascii_lowercase()).filter(|v| !v.is_empty()).collect();
            if versions.len() > 1 {
                args.push(("versions", versions.len().to_string()));
            }
            out.see("game-crashes", &args);
            if let Some((module, before)) = shared_signature(&mine, &out.cands) {
                out.see("game-crash-signature", &[("module", module), ("before", before)]);
            }
        }
    }
}

/// The earliest a REAL dated candidate change happened: an exact date, or the date a mod's files were
/// created in the game's folder (its own evidence line). The edge of an observed-between window is where
/// Compy happened to be looking, not a date of anything, so it never counts.
fn earliest_change(cands: &[Cand]) -> Option<DateTime<Utc>> {
    cands
        .iter()
        .filter(|k| k.t)
        .filter_map(|k| match &k.since {
            When::Exact { at } => ts(at),
            _ if k.id == "graphics-mod" => k.evidence.iter().find(|e| e.code == "mod-files-created").and_then(|e| e.args.get("date")).and_then(|d| ts(d)),
            _ => None,
        })
        .min()
}

/// `Some((module, date of the earliest dated change))` only when BOTH hold: two or more crashes, all
/// with the same faulting module and exception code; and at least one crash predates that dated change.
fn shared_signature(crashes: &[&CrashFact], cands: &[Cand]) -> Option<(String, String)> {
    let first = crashes.first()?;
    let (module, code) = (first.module.as_deref()?, first.code.as_deref()?);
    let same = crashes.len() >= 2
        && crashes.iter().all(|k| k.module.as_deref().is_some_and(|m| m.eq_ignore_ascii_case(module)) && k.code.as_deref().is_some_and(|x| x.eq_ignore_ascii_case(code)));
    let earliest = earliest_change(cands)?;
    let predates = crashes.iter().any(|k| k.when < earliest);
    (same && predates).then(|| (module.to_string(), iso(earliest)))
}
