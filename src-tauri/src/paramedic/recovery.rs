//! F3: "did it get better?" Judged from the game's NEXT recorded sessions, derived afresh on every call
//! (no stored case, no write). After an episode of rough sessions the game's later judgeable sessions say
//! whether the episode is over, and what that says about each candidate the engine listed. Wording law:
//! a recovery SUPPORTS or WEAKENS a candidate; it never proves one ("fixed", "caused" are never said).
//!
//! The recovery rule (frozen below): the game has recovered only when the TWO newest judged sessions since
//! the newest rough one both run clear: judged Normal, neither rule firing, at least `BASELINE_COVERAGE` of
//! the session measured, the same frame cap as the rough sessions, at least `RECOVERY_MIN_SECS` long, a 1%
//! low no worse than the baseline's worst, and a smoothness ratio >= `RECOVERY_R_FRACTION` x the episode's
//! baseline median. One clear session is only "can't tell yet". The pair is always the two NEWEST judged
//! sessions: a later session that ran a little lower makes it "can't tell yet" again, and only a rule firing
//! reopens the episode (as a new one).
//!
//! A recovery is one-sided evidence: it never adds a path to Likely (`Cand::independent` ignores it), and
//! any recorded change between the last rough session's end and the first recovered session's start, or a
//! Windows record for that stretch that could not be read completely, means there is no "points to" summary.

use super::changes;
use super::*;
use crate::change_sources::{ChangeEvent, ChangeKind, Precision};

/// A recovered session's smoothness ratio must reach this fraction of the baseline median.
pub(crate) const RECOVERY_R_FRACTION: f64 = 0.90;
/// A recovered session must have run at least this long (idle menus and short loads do not count).
pub(crate) const RECOVERY_MIN_SECS: u64 = 600;
/// The card still says the game recovered while at most this many judgeable sessions have come since the
/// newest rough one; after that the game is simply running normally (the ordinary answer).
pub(crate) const RECOVERY_SHOWN_FOR: usize = 5;

/// What the sessions since the episode say about one candidate.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum NowStatus {
    PointsTo,
    PointsAway,
    CantTell,
}

pub(super) struct NowLine {
    pub id: &'static str,
    pub status: NowStatus,
    pub evidence: Vec<Evidence>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum RecoverySummary {
    /// Exactly one candidate has support, every other one is pointed away from, and nothing else changed
    /// between the rough sessions and the normal ones (Windows' records for that stretch were complete).
    PointsTo { id: &'static str },
    /// More than one candidate (or recorded change) is still standing.
    Between { ids: Vec<&'static str> },
    None,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct Recovery {
    /// The game's own usual (the episode's baseline medians).
    pub before: Metric,
    /// The rough sessions (mean ratio and average, worst p99).
    pub rough: Metric,
    /// The two sessions that ran normally (mean ratio and average, worst p99).
    pub now: Metric,
    pub rough_sessions: Vec<SessionRef>,
    pub recovered_sessions: Vec<SessionRef>,
    /// Judgeable sessions since the newest rough one.
    pub sessions_since: u8,
    pub summary: RecoverySummary,
    /// Every recorded change between the last rough session's end and the first recovered session's start,
    /// each as its own line, plus a line when Windows' records for that stretch could not be read completely.
    pub also_changed: Vec<Evidence>,
}

/// An earlier episode that ended in a recovery (the card names it in one line).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct EarlierEpisode {
    pub from: String,
    pub to: String,
}

pub(super) enum Outcome {
    /// The two sessions (indexes into the game's list) that ran normally.
    Recovered { idx: Vec<usize> },
    /// Neither back to normal nor rough again. `partial`: the newest session was too thinly measured (or
    /// sessions after it were never read) to say. `one_clear`: exactly one session since ran clear.
    /// `cap_changed`: the newest session ran under another frame cap than the rough ones.
    Unclear { partial: bool, one_clear: bool, cap_changed: bool },
}

/// The first session of the episode that ends at `f` (rough sessions and unjudged ones between them).
pub(super) fn episode_first(judged: &[Judgement], f: usize) -> usize {
    let mut first = f;
    for i in (0..f).rev() {
        match judged[i].verdict {
            Verdict::Fired => first = i,
            Verdict::Unjudged => {}
            _ => break,
        }
    }
    first
}

/// A session that counts toward "back to normal": fully usable and close to the game's usual.
fn clear_session(sess: &[&SessionFacts], judged: &[Judgement], i: usize, base: &BaseStats, rough_cap: CapState) -> bool {
    let s = sess[i];
    judged[i].verdict == Verdict::Normal
        && s.cap.same_as(rough_cap)
        && s.coverage() >= BASELINE_COVERAGE
        && s.duration_secs >= RECOVERY_MIN_SECS
        && judged[i].eval.is_some_and(|e| !e.rule_r && !e.rule_p99)
        && s.ratio().is_some_and(|r| r >= RECOVERY_R_FRACTION * base.med_r)
        && match (s.p99_ms, base.max_p99) {
            (Some(p), Some(m)) => p <= m,
            _ => true,
        }
}

fn outcome_within(sess: &[&SessionFacts], judged: &[Judgement], f: usize, end: usize, shown_for: usize) -> Option<Outcome> {
    let first = episode_first(judged, f);
    let base = judged[first].base.as_ref()?;
    let post: Vec<usize> = ((f + 1)..end).filter(|&i| judged[i].verdict != Verdict::Unjudged).collect();
    let newest = *post.last()?;
    if post.len() > shown_for {
        return None;
    }
    let rough_cap = sess[f].cap;
    let clear = |i: usize| clear_session(sess, judged, i, base, rough_cap);
    // Sessions after the newest judged one went unjudged: Compy never read them, so it cannot say.
    if newest + 1 < end {
        return Some(Outcome::Unclear { partial: true, one_clear: false, cap_changed: false });
    }
    // The TWO NEWEST judged sessions both clear. The pair is never an older one: the card says "the last two
    // sessions ran the way it usually does", and that has to be true of the last two. A newer session that
    // ran a little lower is "can't tell yet" (never a new rough episode: only a rule firing opens one).
    if post.len() >= 2 && clear(post[post.len() - 2]) && clear(post[post.len() - 1]) {
        return Some(Outcome::Recovered { idx: vec![post[post.len() - 2], post[post.len() - 1]] });
    }
    let cap_changed = !sess[newest].cap.same_as(rough_cap);
    let thin = judged[newest].verdict != Verdict::Normal || sess[newest].coverage() < BASELINE_COVERAGE;
    Some(Outcome::Unclear { partial: thin && !cap_changed, one_clear: !cap_changed && clear(newest), cap_changed })
}

/// The recovery outcome of the episode ending at `f`, over the sessions before `end`.
pub(super) fn outcome(sess: &[&SessionFacts], judged: &[Judgement], f: usize, end: usize) -> Option<Outcome> {
    outcome_within(sess, judged, f, end, RECOVERY_SHOWN_FOR)
}

/// The newest earlier episode before the one starting at `first`, if it recovered.
pub(super) fn earlier_episode(sess: &[&SessionFacts], judged: &[Judgement], first: usize) -> Option<EarlierEpisode> {
    let ef = (0..first).rev().find(|&i| judged[i].verdict == Verdict::Fired)?;
    match outcome_within(sess, judged, ef, first, usize::MAX)? {
        Outcome::Recovered { .. } => Some(EarlierEpisode {
            from: sess[episode_first(judged, ef)].started_at.clone(),
            to: sess[ef].started_at.clone(),
        }),
        Outcome::Unclear { .. } => None,
    }
}

// ---- The stretch between the rough sessions and the normal ones -----------------------------------------
/// The last rough session's end and the first recovered session's start.
fn gap_bounds(c: &Ctx, rec: &[&SessionFacts]) -> (DateTime<Utc>, DateTime<Utc>) {
    let rough_last = c.affected.iter().copied().max_by_key(|s| s.start()).unwrap_or(c.first_bad);
    let lo = rough_last.end().or_else(|| rough_last.start()).unwrap_or(c.win_end);
    let hi = rec.iter().filter_map(|s| s.start()).min().unwrap_or(lo);
    (lo, hi)
}

/// When a dated record falls in `(lo, hi]` (a day-precision record: any part of its day does).
fn overlaps(e: &ChangeEvent, lo: DateTime<Utc>, hi: DateTime<Utc>) -> Option<(DateTime<Utc>, bool)> {
    match (e.when.precision, e.when.at, e.when.until) {
        (Precision::Exact, Some(a), _) => (a > lo && a <= hi).then_some((a, true)),
        // A day-precision record falls in the stretch only partly when the day began before it or ended after
        // it: the second value says the WHOLE day lies inside, i.e. the record really is "between".
        (Precision::Day, Some(a), Some(b)) => (a <= hi && b > lo).then_some((a, a > lo && b <= hi)),
        _ => None,
    }
}

pub(super) struct Gap {
    /// One line per recorded change in the stretch, oldest first.
    lines: Vec<Evidence>,
    /// The candidate id each line belongs to, aligned with `lines`.
    line_ids: Vec<&'static str>,
    /// The candidate ids (for "Still between"), each once.
    ids: Vec<&'static str>,
    /// Every Windows record that could name a change there was read completely.
    complete: bool,
}

impl Gap {
    /// Something changed in the stretch, or Windows' records for it were not read completely: Compy cannot
    /// name one change as the reason.
    fn unclean(&self) -> bool {
        !self.lines.is_empty() || !self.complete
    }

    /// The same, not counting the change that a "points to it" row already names (that change is the very
    /// thing the row is about, not an unexplained extra).
    fn unclean_except(&self, id: &str) -> bool {
        !self.complete || self.line_ids.iter().any(|i| *i != id)
    }
}

fn gap_of(c: &Ctx, rec: &[&SessionFacts]) -> Gap {
    let (lo, hi) = gap_bounds(c, rec);
    let rough_last = c.affected.iter().copied().max_by_key(|s| s.start()).unwrap_or(c.first_bad);
    let rec_first = rec.iter().copied().min_by_key(|s| s.start());
    let mut dated: Vec<(DateTime<Utc>, Evidence, &'static str)> = Vec::new();
    let mut complete = false;
    if let Some(r) = changes::report(c) {
        let kinds = [ChangeKind::GpuDriver, ChangeKind::OtherDriver, ChangeKind::WindowsUpdate, ChangeKind::GameUpdate, ChangeKind::ProgramInstalled];
        complete = kinds.iter().all(|k| changes::is_complete(r, *k));
        let gap_event = |kind: &'static str, e: &ChangeEvent, at: DateTime<Utc>, whole: bool, detail: String| {
            ev(
                EvidenceKind::Known,
                "gap-change",
                "windows",
                false,
                &[
                    ("kind", kind.to_string()),
                    ("when", iso(at)),
                    ("day", (e.when.precision == Precision::Day).to_string()),
                    // A day record that only partly lies in the stretch is not "between": its time of day is unknown.
                    ("placed", whole.to_string()),
                    ("detail", detail),
                ],
            )
        };
        let mut gpu_or_other = false;
        for e in changes::kind_events(r, ChangeKind::GpuDriver).filter(|e| e.what.version_changed == Some(true)) {
            if let Some((at, whole)) = overlaps(e, lo, hi) {
                gpu_or_other = true;
                dated.push((at, gap_event("gpu-driver", e, at, whole, e.what.to_version.clone().unwrap_or_default()), "gpu-driver-change"));
            }
        }
        for e in changes::kind_events(r, ChangeKind::OtherDriver) {
            if let Some((at, whole)) = overlaps(e, lo, hi) {
                gpu_or_other = true;
                dated.push((at, gap_event("other-driver", e, at, whole, String::new()), "other-driver-change"));
            }
        }
        for e in changes::kind_events(r, ChangeKind::WindowsUpdate) {
            let class = changes::class_of(e);
            // A driver delivered by Windows Update is already listed as the driver install.
            let counts = matches!(class.as_str(), "quality" | "feature") || (class == "driver" && !gpu_or_other);
            if let (true, Some((at, whole))) = (counts, overlaps(e, lo, hi)) {
                dated.push((at, gap_event("windows-update", e, at, whole, e.what.kb.clone().unwrap_or_default()), "windows-update"));
            }
        }
        for e in changes::kind_events(r, ChangeKind::GameUpdate) {
            if let Some((at, whole)) = overlaps(e, lo, hi) {
                dated.push((at, gap_event("game-files", e, at, whole, String::new()), "game-files-change"));
            }
        }
        for e in changes::kind_events(r, ChangeKind::ProgramInstalled).filter(|e| e.what.name.is_some()) {
            if let Some((at, whole)) = overlaps(e, lo, hi) {
                dated.push((at, gap_event("program", e, at, whole, e.what.name.clone().unwrap_or_default()), "program-installed"));
            }
        }
    }
    dated.sort_by_key(|(at, _, _)| *at);
    let mut lines: Vec<Evidence> = dated.iter().map(|(_, e, _)| e.clone()).collect();
    let mut line_ids: Vec<&'static str> = dated.iter().map(|(_, _, id)| *id).collect();
    let mut ids: Vec<&'static str> = Vec::new();
    for (_, _, id) in &dated {
        if !ids.contains(id) {
            ids.push(id);
        }
    }
    if let Some(rf) = rec_first {
        let (a, b) = (nonblank(&rough_last.windows_build), nonblank(&rf.windows_build));
        if let (Some(a), Some(b)) = (a, b) {
            if a != b {
                lines.push(ev(EvidenceKind::Measured, "gap-build", "sessions", false, &[("from", a.to_string()), ("to", b.to_string())]));
                line_ids.push("windows-build-change");
                ids.push("windows-build-change");
            }
        }
        if let (Some(a), Some(b)) = (rough_last.compy_changes, rf.compy_changes) {
            if a != b {
                lines.push(ev(EvidenceKind::Known, "compy-changes-differ", "sessions", false, &[("from", a.to_string()), ("to", b.to_string())]));
                line_ids.push("compy-change");
                ids.push("compy-change");
            }
        }
    }
    Gap { lines, line_ids, ids, complete }
}

/// A change to the game's files in the stretch is a candidate in its own right. Windows-style Steam records
/// keep only the newest change, so when it falls here an earlier one can no longer be seen (and nothing is
/// said about it).
pub(super) fn gap_candidates(c: &Ctx, rec: &[&SessionFacts], cands: &mut Vec<Cand>) {
    if cands.iter().any(|x| x.id == "game-files-change") {
        return;
    }
    let Some(r) = changes::report(c) else { return };
    let (lo, hi) = gap_bounds(c, rec);
    let Some(at) = changes::kind_events(r, ChangeKind::GameUpdate).filter_map(|e| overlaps(e, lo, hi)).map(|(at, _)| at).max() else { return };
    cands.push(Cand {
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
}

// ---- Per-candidate re-scoring ------------------------------------------------------------------------
struct Rc<'x> {
    c: &'x Ctx<'x>,
    rec: &'x [&'x SessionFacts],
    rough_last: &'x SessionFacts,
    /// The last rough session's end: a change after it is "between the rough sessions and the normal ones".
    rough_end: DateTime<Utc>,
    rec_start: DateTime<Utc>,
}

fn pct1(p: f64) -> String {
    format!("{p:.1}")
}

fn unread(code: &'static str) -> Vec<Evidence> {
    vec![ev(EvidenceKind::Unknown, code, "sessions", false, &[])]
}

/// Re-scores every candidate against the sessions that ran normally. A contradiction sets `c1`. A support
/// sets `r` (ordering only: it is never one of the two independent supports Likely needs), and only when
/// nothing else changed in the stretch and Windows' records for it were complete.
pub(super) fn apply<'x>(c: &'x Ctx<'x>, rec: &'x [&'x SessionFacts], cands: &mut [Cand]) -> Vec<NowLine> {
    let rough_last = c.affected.iter().copied().max_by_key(|s| s.start()).unwrap_or(c.first_bad);
    let (rough_end, rec_start) = gap_bounds(c, rec);
    let rc = Rc { c, rec, rough_last, rough_end, rec_start };
    let clean = !gap_of(c, rec).unclean();
    cands
        .iter_mut()
        .map(|cand| {
            let (status, evidence) = match cand.id {
                "gpu-driver-change" => driver(&rc, cand),
                "background-load" => background(&rc),
                "memory-pressure" => memory(&rc),
                "setting-drift" => drift(&rc, cand),
                "compy-change" => compy(&rc),
                "windows-build-change" => build(&rc),
                "windows-update" => dated(&rc, "windows-update", ChangeKind::WindowsUpdate),
                "game-files-change" => dated(&rc, "game-files-change", ChangeKind::GameUpdate),
                "program-installed" => dated(&rc, "program-installed", ChangeKind::ProgramInstalled),
                _ => (NowStatus::CantTell, Vec::new()),
            };
            match status {
                NowStatus::PointsTo => cand.r = clean,
                NowStatus::PointsAway => cand.c1 = true,
                NowStatus::CantTell => {}
            }
            NowLine { id: cand.id, status, evidence }
        })
        .collect()
}

fn driver(rc: &Rc, cand: &Cand) -> (NowStatus, Vec<Evidence>) {
    let rough = nonblank(&rc.rough_last.gpu_driver);
    let stamps: Vec<Option<&str>> = rc.rec.iter().map(|s| nonblank(&s.gpu_driver)).collect();
    let Some(rough) = rough else { return (NowStatus::CantTell, unread("recovery-driver-unread")) };
    if stamps.is_empty() || stamps.iter().any(Option::is_none) {
        return (NowStatus::CantTell, unread("recovery-driver-unread"));
    }
    let stamps: Vec<&str> = stamps.into_iter().flatten().collect();
    // A recovered session that was already clear on the rough sessions' driver weakens the driver, whatever
    // the other one ran on: "points to it" needs EVERY recovered session to be on a different driver.
    let same = stamps.iter().copied().find(|d| !crate::hardware::driver_changed(rough, d));
    let now = same.unwrap_or(stamps[stamps.len() - 1]);
    let installs = changes::gpu_installs(rc.c);
    let in_gap = |at: DateTime<Utc>| at > rc.rough_end && at <= rc.rec_start;
    if same.is_some() {
        // The stamps agree, but Windows dated an install of another version between the two.
        if let Some((_, at, _)) = installs.iter().rev().find(|(e, at, _)| {
            in_gap(*at) && e.what.to_version.as_deref().is_some_and(|v| crate::hardware::driver_changed(rough, v))
        }) {
            return (
                NowStatus::CantTell,
                vec![ev(EvidenceKind::Unknown, "recovered-driver-record-differs", "windows", false, &[("when", iso(*at))])],
            );
        }
        return (
            NowStatus::PointsAway,
            vec![ev(EvidenceKind::Measured, "recovered-same-driver", "sessions", true, &[("version", now.to_string())])],
        );
    }
    // It changed again after the rough sessions. Windows' own install time when it has one, else the first
    // time Compy saw the new version.
    let record = installs
        .iter()
        .rev()
        .find(|(e, at, _)| in_gap(*at) && e.what.to_version.as_deref().is_some_and(|v| !crate::hardware::driver_changed(v, now)))
        .map(|(_, at, _)| *at);
    let inp = rc.c.inp;
    let seen = inp
        .sessions
        .iter()
        .filter(|s| nonblank(&s.gpu_driver).is_some_and(|d| !crate::hardware::driver_changed(d, now)))
        .filter_map(|s| s.start())
        .chain(inp.sightings.iter().filter(|g| !crate::hardware::driver_changed(&g.gpu_driver, now)).filter_map(|g| ts(&g.observed_at)))
        .filter(|t| *t > rc.rough_end)
        .min()
        .unwrap_or(rc.rec_start);
    let (when, exact) = match record {
        Some(at) => (at, true),
        None => (seen, false),
    };
    // "Back to the one it had before": the version the candidate says it changed from.
    let back = cand
        .evidence
        .iter()
        .find(|e| e.code == "driver-changed")
        .and_then(|e| e.args.get("from"))
        .is_some_and(|from| !crate::hardware::driver_changed(from, now));
    (
        NowStatus::PointsTo,
        vec![ev(
            EvidenceKind::SupportedInference,
            "recovered-after-driver-change",
            if exact { "windows" } else { "sessions" },
            false,
            &[("version", now.to_string()), ("when", iso(when)), ("exact", exact.to_string()), ("back", back.to_string())],
        )],
    )
}

/// Background programs. "Points to it" needs recorded load numbers on BOTH sides: a rough session that was
/// busy (programs starting, or the rest of the PC loud) and recovered sessions that were quiet. Without load
/// numbers for every rough session the comparison is one-sided and Compy says it cannot tell.
fn background(rc: &Rc) -> (NowStatus, Vec<Evidence>) {
    let starts: u32 = rc.rec.iter().map(|s| s.busy_starts).sum();
    let p90s: Vec<f64> = rc.rec.iter().filter_map(|s| s.other_cpu_p90_pct).collect();
    let max_p = p90s.iter().copied().reduce(f64::max);
    let loud = max_p.is_some_and(|p| p >= OTHER_CPU_P90_PCT);
    if rc.rec.iter().any(|s| s.busy_starts >= BUSY_START_MIN) || loud {
        let pct = max_p.map(pct1).unwrap_or_default();
        return (
            NowStatus::PointsAway,
            vec![ev(EvidenceKind::Measured, "recovered-busy", "sessions", true, &[("starts", starts.to_string()), ("pct", pct)])],
        );
    }
    if starts > 0 {
        return (
            NowStatus::CantTell,
            vec![ev(EvidenceKind::Measured, "recovered-few-starts", "sessions", false, &[("starts", starts.to_string())])],
        );
    }
    match max_p {
        Some(p) if p90s.len() == rc.rec.len() => {
            // What was seen is a measurement. It is a supporting inference ("consistent with") ONLY on the path
            // that points to background programs: a rough session that was busy and recovered ones that were
            // quiet. Anywhere else it is a plain measurement in neutral words, with no "supports" chip.
            let seen = || ev(EvidenceKind::Measured, "recovered-quiet-seen", "sessions", false, &[("pct", pct1(p))]);
            let rough = &rc.c.affected;
            if rough.iter().any(|s| s.other_cpu_p90_pct.is_none()) {
                // One-sided: no load numbers for a rough session. Said in the same breath; never "points to".
                return (NowStatus::CantTell, vec![seen(), ev(EvidenceKind::Unknown, "rough-load-not-recorded", "sessions", false, &[])]);
            }
            let rough_busy = rough
                .iter()
                .any(|s| s.busy_starts >= BUSY_START_MIN || s.other_cpu_p90_pct.is_some_and(|p| p >= OTHER_CPU_P90_PCT));
            if rough_busy {
                (NowStatus::PointsTo, vec![ev(EvidenceKind::SupportedInference, "recovered-quiet", "sessions", false, &[("pct", pct1(p))])])
            } else {
                (NowStatus::CantTell, vec![seen()])
            }
        }
        _ => (NowStatus::CantTell, unread("recovery-load-not-recorded")),
    }
}

/// Memory. "Points to it" only when EVERY rough session with a reading peaked at or past the full line and
/// the recovered ones did not; a rough session that ran with memory well below full means a lower peak now
/// says little (the same contradiction `detect_memory` records as ram-lower).
fn memory(rc: &Rc) -> (NowStatus, Vec<Evidence>) {
    let peak = |s: &SessionFacts| s.peak_ram_bytes.unwrap_or(0);
    let read: Vec<&&SessionFacts> = rc.rec.iter().filter(|s| s.ram_fraction().is_some()).collect();
    let Some(worst) = read.iter().copied().max_by_key(|s| peak(s)) else { return (NowStatus::CantTell, unread("recovery-ram-not-read")) };
    let total = worst.ram_total_bytes.unwrap_or(0);
    if worst.ram_fraction().is_some_and(|f| f >= RAM_FULL_FRACTION) {
        return (
            NowStatus::PointsAway,
            vec![ev(EvidenceKind::Measured, "recovered-ram-full", "sessions", true, &[("peakGb", gb(peak(worst))), ("totalGb", gb(total))])],
        );
    }
    let rough: Vec<&&SessionFacts> = rc.c.affected.iter().filter(|s| s.ram_fraction().is_some()).collect();
    if rough.is_empty() {
        return (NowStatus::CantTell, unread("recovery-ram-rough-unread"));
    }
    if rough.iter().any(|s| s.ram_fraction().is_some_and(|f| f < RAM_FULL_FRACTION)) {
        return (
            NowStatus::CantTell,
            vec![ev(
                EvidenceKind::Measured,
                "recovered-ram-rough-lower",
                "sessions",
                false,
                &[("peakGb", gb(peak(worst))), ("totalGb", gb(total))],
            )],
        );
    }
    let least_rough = rough.iter().map(|s| peak(s)).min().unwrap_or(0);
    (
        NowStatus::PointsTo,
        vec![ev(
            EvidenceKind::SupportedInference,
            "recovered-ram-lower",
            "sessions",
            false,
            &[("peakGb", gb(peak(worst))), ("totalGb", gb(total)), ("roughGb", gb(least_rough))],
        )],
    )
}

fn drift(rc: &Rc, cand: &Cand) -> (NowStatus, Vec<Evidence>) {
    if rc.c.inp.drift_unread {
        return (NowStatus::CantTell, unread("recovery-drift-unknown"));
    }
    let checks: Vec<&str> =
        cand.evidence.iter().filter(|e| e.code == "drift-noticed").filter_map(|e| e.args.get("check").map(String::as_str)).collect();
    let notices: Vec<&DriftFact> = rc.c.inp.drift.iter().filter(|n| checks.contains(&n.id.as_str())).collect();
    // Compy keeps only the notices that still stand. One noticed before the recovered session started and still
    // standing means the setting was still off when the game ran normally. Anything else is a time Compy
    // cannot place.
    if !notices.is_empty() && notices.iter().all(|n| ts(&n.noticed_at).is_some_and(|t| t <= rc.rec_start)) {
        return (
            NowStatus::PointsAway,
            vec![ev(EvidenceKind::Measured, "recovered-drift-still", "drift", true, &[("check", notices[0].id.clone())])],
        );
    }
    (NowStatus::CantTell, unread("recovery-drift-unknown"))
}

/// Compy's own changes. The count counts as "back" only when it equals the count at the baseline's newest
/// session (a count is not the identity of a change, so the wording says only that the number went back).
fn compy(rc: &Rc) -> (NowStatus, Vec<Evidence>) {
    let counts: Vec<Option<usize>> = rc.rec.iter().map(|s| s.compy_changes).collect();
    let rough: Vec<usize> = rc.c.affected.iter().filter_map(|s| s.compy_changes).collect();
    let Some(before) = rc.c.baseline_newest.compy_changes else { return (NowStatus::CantTell, unread("recovery-compy-unread")) };
    if rough.is_empty() || counts.is_empty() || counts.iter().any(Option::is_none) {
        return (NowStatus::CantTell, unread("recovery-compy-unread"));
    }
    let counts: Vec<usize> = counts.into_iter().flatten().collect();
    let now = counts[counts.len() - 1];
    let from = rough[rough.len() - 1].to_string();
    // A recovered session that ran with the same number of changes as a rough one weakens it, whatever the
    // other one had: "back" needs EVERY recovered session to differ from the rough count and equal the baseline's.
    if let Some(same) = counts.iter().copied().find(|c| rough.contains(c)) {
        return (
            NowStatus::PointsAway,
            vec![ev(EvidenceKind::Measured, "recovered-compy-same", "sessions", true, &[("count", same.to_string())])],
        );
    }
    if counts.iter().all(|c| *c == before) {
        return (
            NowStatus::PointsTo,
            vec![ev(EvidenceKind::SupportedInference, "recovered-compy-back", "sessions", false, &[("from", from), ("to", now.to_string())])],
        );
    }
    (NowStatus::CantTell, vec![ev(EvidenceKind::Measured, "recovered-compy-other", "sessions", false, &[("from", from), ("to", now.to_string())])])
}

fn build(rc: &Rc) -> (NowStatus, Vec<Evidence>) {
    let rough = nonblank(&rc.rough_last.windows_build);
    let now = rc.rec.last().and_then(|s| nonblank(&s.windows_build));
    match (rough, now) {
        (Some(r), Some(n)) if r == n => {
            (NowStatus::PointsAway, vec![ev(EvidenceKind::Measured, "recovered-build-same", "sessions", true, &[("build", n.to_string())])])
        }
        (Some(r), Some(n)) => (
            NowStatus::CantTell,
            vec![ev(EvidenceKind::Measured, "recovered-build-changed", "sessions", false, &[("from", r.to_string()), ("to", n.to_string())])],
        ),
        _ => (NowStatus::CantTell, unread("recovery-build-unread")),
    }
}

/// Windows update, game files and installed programs: Windows' dated records between the rough sessions
/// and the one that ran normally. A record there is "changed again" (noted, never a support); a complete
/// read with none says only that Compy saw no further change, so the thing alone cannot be the whole story.
fn dated(rc: &Rc, what: &'static str, kind: ChangeKind) -> (NowStatus, Vec<Evidence>) {
    let unread_records = || vec![ev(EvidenceKind::Unknown, "recovery-records-unread", "windows", false, &[("what", what.to_string())])];
    let Some(r) = changes::report(rc.c) else { return (NowStatus::CantTell, unread_records()) };
    let all: Vec<(DateTime<Utc>, bool)> = changes::kind_events(r, kind)
        .filter(|e| kind != ChangeKind::WindowsUpdate || matches!(changes::class_of(e).as_str(), "quality" | "feature" | "driver"))
        .filter_map(|e| overlaps(e, rc.rough_end, rc.rec_start))
        .collect();
    let hits: Vec<DateTime<Utc>> = all.iter().filter(|h| h.1).map(|h| h.0).collect();
    if let Some(first) = hits.iter().copied().min() {
        return (
            NowStatus::CantTell,
            vec![ev(
                EvidenceKind::Measured,
                "recovered-changed-again",
                "windows",
                false,
                &[("what", what.to_string()), ("count", hits.len().to_string()), ("when", iso(first))],
            )],
        );
    }
    // A day-precision record that only partly lies in the stretch: Compy cannot say it came after the rough
    // sessions, so it is not "between", and it is not "no further change" either.
    if let Some(day) = all.iter().map(|h| h.0).min() {
        return (
            NowStatus::CantTell,
            vec![ev(EvidenceKind::Unknown, "recovery-day-unplaced", "windows", false, &[("what", what.to_string()), ("when", iso(day))])],
        );
    }
    // Steam keeps only the NEWEST update time of a game. A newest time after the stretch can hide an earlier
    // change inside it, so "no further change" can be said only when the newest time is not after it.
    if kind == ChangeKind::GameUpdate {
        let newest = changes::kind_events(r, kind).filter_map(|e| e.when.until.or(e.when.at)).max();
        if newest.is_some_and(|t| t > rc.rec_start) {
            return (NowStatus::CantTell, vec![ev(EvidenceKind::Unknown, "recovered-steam-latest-only", "steam", false, &[])]);
        }
    }
    if changes::is_complete(r, kind) {
        return (
            NowStatus::PointsAway,
            vec![ev(EvidenceKind::Measured, "recovered-unchanged", "windows", true, &[("what", what.to_string())])],
        );
    }
    (NowStatus::CantTell, unread_records())
}

// ---- The recovery block ------------------------------------------------------------------------------
/// "Points to" names one candidate only when exactly one stands with support, every other one is pointed
/// away from, nothing else changed in the stretch and Windows' records for it were complete. Otherwise it is
/// "Still between" the candidates and the recorded changes still standing, or nothing when there are fewer
/// than two.
fn summary(findings: &[Finding], gap: &Gap) -> RecoverySummary {
    let live: Vec<&Finding> = findings.iter().filter(|f| f.now != Some(NowStatus::PointsAway)).collect();
    let supported = live.iter().filter(|f| f.now == Some(NowStatus::PointsTo)).count();
    // The change the one standing row names is not an unexplained extra: only other changes (or unread
    // records) in the stretch stop it from being named.
    if live.len() == 1 && supported == 1 && !gap.unclean_except(live[0].id) {
        return RecoverySummary::PointsTo { id: live[0].id };
    }
    let mut ids: Vec<&'static str> = live.iter().map(|f| f.id).collect();
    for id in &gap.ids {
        if !ids.contains(id) {
            ids.push(id);
        }
    }
    if ids.len() >= 2 {
        RecoverySummary::Between { ids }
    } else {
        RecoverySummary::None
    }
}

/// A row reads "points to it" only when nothing else changed in the stretch between the rough sessions and
/// the normal ones (not counting the change the row itself names) and Windows' records for it were read
/// completely. Otherwise the row reads "still can't tell"; its evidence lines stay as they are.
pub(super) fn settle(c: &Ctx, rec: &[&SessionFacts], findings: &mut [Finding]) {
    let gap = gap_of(c, rec);
    for f in findings.iter_mut() {
        if f.now == Some(NowStatus::PointsTo) && gap.unclean_except(f.id) {
            f.now = Some(NowStatus::CantTell);
        }
    }
}

fn mean_metric(s: &[&SessionFacts]) -> Metric {
    let n = s.len().max(1) as f64;
    Metric {
        ratio: s.iter().filter_map(|x| x.ratio()).sum::<f64>() / n,
        p99_ms: s.iter().filter_map(|x| x.p99_ms).reduce(f64::max),
        avg_fps: s.iter().map(|x| x.avg_fps).sum::<f64>() / n,
    }
}

/// The numbers and the summary of a recovered episode. `d.problem` and `d.findings` are already set.
pub(super) fn build_block(c: &Ctx, rec: &[&SessionFacts], d: &Diagnosis, since: usize) -> Option<Recovery> {
    let p = d.problem.as_ref()?;
    rec.last()?;
    let gap = gap_of(c, rec);
    let mut also_changed = gap.lines.clone();
    if !gap.complete {
        also_changed.push(ev(EvidenceKind::Unknown, "gap-unread", "windows", false, &[]));
    }
    Some(Recovery {
        before: p.before.clone(),
        rough: p.now.clone(),
        now: mean_metric(rec),
        rough_sessions: p.sessions_affected.clone(),
        recovered_sessions: rec.iter().map(|s| s.session_ref()).collect(),
        sessions_since: since.min(u8::MAX as usize) as u8,
        summary: summary(&d.findings, &gap),
        also_changed,
    })
}
