//! M3: the graphics card's temperature and the diagnosed game's crash history, as evidence. READ-ONLY.
//!
//! Neither is a verdict. Temperature is two numbers the sessions already carry (the peak in the rough
//! sessions, the highest peak in the normal ones). Crashes come from Windows Error Reporting files (the
//! Black Box's own read: no process is started, nothing is written). The words "overheating" and
//! "throttling" are never used: Compy sees a peak reading, not what the card did about it.
//!
//! - Within `TEMP_SAME_C` of the normal sessions' highest peak: one "Unchanged" line.
//! - More than `TEMP_HOTTER_C` above it: a candidate ("ran hotter than usual"), Possible at most (one
//!   measured size, nothing dates it before the others).
//! - In between: said under "What Compy checked", neither cleared nor blamed.
//! - A reading missing on either side is a "Compy couldn't see" line, never an all-clear.
//! - Crashes: the count and first date for the diagnosed game. The one place "probably" is used: every crash
//!   has the same faulting module AND exception code (two or more of them), AND at least one crash is older
//!   than the earliest dated candidate change. Both are required.

use super::*;
use crate::blackbox::AppCrashes;

/// A rough-session peak this many degrees above the normal ones' highest (or less) is "about the same".
pub(crate) const TEMP_SAME_C: i64 = 5;
/// A rough-session peak MORE than this many degrees above the normal ones' highest is a candidate.
pub(crate) const TEMP_HOTTER_C: i64 = 10;

/// One app crash, reduced from a Windows Error Reporting file (`blackbox::AppCrash`).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct CrashFact {
    pub app: String,
    pub when: DateTime<Utc>,
    pub module: Option<String>,
    pub code: Option<String>,
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
pub(crate) fn crash_dto(a: AppCrashes) -> CrashRead {
    CrashRead::Read(CrashHistory {
        crashes: a.crashes.into_iter().map(|c| CrashFact { app: c.app, when: c.when, module: c.module, code: c.code }).collect(),
        listed: a.listed_any,
        partial: a.needs_admin || a.complete_from.is_some(),
    })
}

/// The real read, for the command. Read-only file reads; call it from a blocking context.
pub(crate) fn read_real_crashes() -> CrashRead {
    crash_dto(crate::blackbox::read_app_crashes())
}

fn peak(s: &SessionFacts) -> Option<i64> {
    s.peak_gpu_temp_c.map(i64::from)
}

pub(super) fn detect_temperature(c: &Ctx, out: &mut Out) {
    let rough = c.affected.iter().copied().filter_map(peak).max();
    let normal = c.base.iter().copied().filter_map(peak).max();
    let (Some(rough), Some(normal)) = (rough, normal) else {
        out.unknown("gpu-temp");
        return;
    };
    let args = [("rough", rough.to_string()), ("base", normal.to_string())];
    out.see("gpu-temp", &args);
    let over = rough - normal;
    if over <= TEMP_SAME_C {
        out.ruled_out("gpu-temp", &[args[0].clone(), args[1].clone(), ("within", TEMP_SAME_C.to_string())]);
    } else if over > TEMP_HOTTER_C {
        // The rough sessions themselves carry it (timing), and it is one measured size: Possible at most.
        out.cands.push(Cand {
            id: "gpu-hotter",
            t: true,
            d: false,
            x: false,
            confounded: false,
            m: true,
            r: false,
            c1: false,
            since: When::Unknown,
            fix: steps("gpu-hotter", &[]),
            evidence: vec![ev(EvidenceKind::Known, "gpu-temp", "sessions", false, &args)],
        });
    }
}

pub(super) fn detect_crashes(c: &Ctx, out: &mut Out) {
    match &c.inp.crashes {
        CrashRead::NotRead => {}
        CrashRead::Unavailable(_) => out.unknown("crashes-unavailable"),
        CrashRead::Read(h) if !h.listed => out.unknown("crashes-unreadable"),
        CrashRead::Read(h) => {
            if h.partial {
                out.unknown("crashes-partial");
            }
            let game = c.first_bad.game.as_str();
            let mine: Vec<&CrashFact> = h.crashes.iter().filter(|k| same_game(&k.app, game)).collect();
            let Some(since) = mine.iter().map(|k| k.when).min() else { return };
            out.see("game-crashes", &[("n", mine.len().to_string()), ("since", iso(since))]);
            if let Some((module, before)) = shared_signature(&mine, &out.cands) {
                out.see("game-crash-signature", &[("module", module), ("before", before)]);
            }
        }
    }
}

/// The earliest a dated candidate change could have happened (its lower bound), when any is dated.
fn earliest_change(cands: &[Cand]) -> Option<DateTime<Utc>> {
    cands
        .iter()
        .filter(|k| k.t)
        .filter_map(|k| match &k.since {
            When::Exact { at } => ts(at),
            When::ObservedBetween { from, .. } => ts(from),
            When::Seen { .. } | When::Unknown => None,
        })
        .min()
}

/// `Some((module, date of the earliest candidate change))` only when BOTH hold: two or more crashes, all
/// with the same faulting module and exception code; and at least one crash predates every dated candidate.
fn shared_signature(crashes: &[&CrashFact], cands: &[Cand]) -> Option<(String, String)> {
    let first = crashes.first()?;
    let (module, code) = (first.module.as_deref()?, first.code.as_deref()?);
    let same = crashes.len() >= 2
        && crashes.iter().all(|k| k.module.as_deref().is_some_and(|m| m.eq_ignore_ascii_case(module)) && k.code.as_deref().is_some_and(|x| x.eq_ignore_ascii_case(code)));
    let earliest = earliest_change(cands)?;
    let predates = crashes.iter().any(|k| k.when < earliest);
    (same && predates).then(|| (module.to_string(), iso(earliest)))
}
