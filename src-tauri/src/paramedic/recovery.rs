//! F3: "did it get better?" Judged from the game's NEXT recorded sessions, derived afresh on every call
//! (no stored case, no write). After an episode of rough sessions the game's later judgeable sessions say
//! whether the episode is over, and what that says about each candidate the engine listed. Wording law:
//! a recovery SUPPORTS or WEAKENS a candidate; it never proves one ("fixed", "caused" are never said).
//!
//! The recovery rule (design E, frozen below): the newest judgeable session after the newest rough one has
//! neither rule firing, measured at least `BASELINE_COVERAGE` of itself, ran under the same frame cap as the
//! rough sessions and has a smoothness ratio >= `RECOVERY_R_FRACTION` x the episode's baseline median; and it
//! is either >= that median (one session is enough) or the judgeable session before it also qualifies.

use super::changes;
use super::*;
use crate::change_sources::ChangeKind;

/// A recovered session's smoothness ratio must reach this fraction of the baseline median.
pub(crate) const RECOVERY_R_FRACTION: f64 = 0.90;
/// The card still says "recovered" while at most this many judgeable sessions have come since the newest
/// rough one; after that the game is simply running normally (the ordinary answer).
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
    /// Exactly one candidate has support and every other one is pointed away from.
    PointsTo { id: &'static str },
    /// More than one candidate is still standing.
    Between { ids: Vec<&'static str> },
    None,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct Recovery {
    /// The game's own usual (the episode's baseline medians).
    pub before: Metric,
    /// The rough sessions (mean ratio and average, worst p99).
    pub rough: Metric,
    /// The sessions that ran normally (mean ratio and average, worst p99).
    pub now: Metric,
    pub rough_sessions: Vec<SessionRef>,
    pub recovered_sessions: Vec<SessionRef>,
    /// The newest recovered session reached the baseline median (one session was enough).
    pub at_or_above_median: bool,
    /// Judgeable sessions since the newest rough one.
    pub sessions_since: u8,
    pub summary: RecoverySummary,
    /// Other recorded changes between the rough sessions and the recovered ones (Compy's change count).
    pub also_changed: Vec<Evidence>,
}

/// An earlier episode that ended in a recovery (the card names it in one line).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct EarlierEpisode {
    pub from: String,
    pub to: String,
}

pub(super) enum Outcome {
    /// The sessions (indexes into the game's list) that count as having run normally: one or two.
    Recovered { idx: Vec<usize> },
    /// Neither back to normal nor rough again. `partial`: the newest session was too thinly measured (or
    /// under another frame cap) to say.
    Unclear { partial: bool },
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

fn outcome_within(sess: &[&SessionFacts], judged: &[Judgement], f: usize, end: usize, shown_for: usize) -> Option<Outcome> {
    let first = episode_first(judged, f);
    let base = judged[first].base.as_ref()?;
    let post: Vec<usize> = ((f + 1)..end).filter(|&i| judged[i].verdict != Verdict::Unjudged).collect();
    let newest = *post.last()?;
    if post.len() > shown_for {
        return None;
    }
    let rough_cap = sess[f].cap;
    // A session counts toward "back to normal" only when it is fully usable: judged Normal, neither rule
    // firing, at least BASELINE_COVERAGE of it measured, the same frame cap as the rough sessions, and a
    // smoothness ratio within RECOVERY_R_FRACTION of the baseline median.
    let clear = |i: usize| -> bool {
        judged[i].verdict == Verdict::Normal
            && sess[i].cap.same_as(rough_cap)
            && sess[i].coverage() >= BASELINE_COVERAGE
            && judged[i].eval.is_some_and(|e| !e.rule_r && !e.rule_p99)
            && sess[i].ratio().is_some_and(|r| r >= RECOVERY_R_FRACTION * base.med_r)
    };
    // Sessions after the newest judged one went unjudged: Compy never read them, so it cannot say.
    if newest + 1 < end {
        return Some(Outcome::Unclear { partial: true });
    }
    if !clear(newest) {
        let thin = judged[newest].verdict != Verdict::Normal
            || sess[newest].coverage() < BASELINE_COVERAGE
            || !sess[newest].cap.same_as(rough_cap);
        return Some(Outcome::Unclear { partial: thin });
    }
    if sess[newest].ratio().is_some_and(|r| r >= base.med_r) {
        return Some(Outcome::Recovered { idx: vec![newest] });
    }
    match post.len().checked_sub(2).map(|k| post[k]) {
        Some(prev) if clear(prev) => Some(Outcome::Recovered { idx: vec![prev, newest] }),
        _ => Some(Outcome::Unclear { partial: false }),
    }
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

// ---- Per-candidate re-scoring ------------------------------------------------------------------------
struct Rc<'x> {
    c: &'x Ctx<'x>,
    rec: &'x [&'x SessionFacts],
    rough_last: &'x SessionFacts,
    rough_start: DateTime<Utc>,
    rec_start: DateTime<Utc>,
}

fn pct1(p: f64) -> String {
    format!("{p:.1}")
}

fn unread(code: &'static str) -> Vec<Evidence> {
    vec![ev(EvidenceKind::Unknown, code, "sessions", false, &[])]
}

/// Re-scores every candidate against the sessions that ran normally. A support sets the candidate's `r`
/// (independent of its timing); a contradiction sets `c1`. Neither ever makes a candidate certain.
pub(super) fn apply<'x>(c: &'x Ctx<'x>, rec: &'x [&'x SessionFacts], cands: &mut [Cand]) -> Vec<NowLine> {
    let rough_last = c.affected.iter().copied().max_by_key(|s| s.start()).unwrap_or(c.first_bad);
    let rough_start = rough_last.start().unwrap_or(c.win_end);
    let rec_start = rec.iter().filter_map(|s| s.start()).min().unwrap_or(rough_start);
    let rc = Rc { c, rec, rough_last, rough_start, rec_start };
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
                NowStatus::PointsTo => cand.r = true,
                NowStatus::PointsAway => cand.c1 = true,
                NowStatus::CantTell => {}
            }
            NowLine { id: cand.id, status, evidence }
        })
        .collect()
}

fn driver(rc: &Rc, cand: &Cand) -> (NowStatus, Vec<Evidence>) {
    let rough = nonblank(&rc.rough_last.gpu_driver);
    let now = rc.rec.last().and_then(|s| nonblank(&s.gpu_driver));
    let (Some(rough), Some(now)) = (rough, now) else { return (NowStatus::CantTell, unread("recovery-driver-unread")) };
    let installs = changes::gpu_installs(rc.c);
    let in_gap = |at: DateTime<Utc>| at > rc.rough_start && at <= rc.rec_start;
    if !crate::hardware::driver_changed(rough, now) {
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
        .filter(|t| *t > rc.rough_start)
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
            let mut e = vec![ev(EvidenceKind::SupportedInference, "recovered-quiet", "sessions", false, &[("pct", pct1(p))])];
            // The comparison is one-sided when the rough sessions have no load numbers.
            if rc.c.affected.iter().any(|s| s.other_cpu_p90_pct.is_none()) {
                e.push(ev(EvidenceKind::Unknown, "rough-load-not-recorded", "sessions", false, &[]));
            }
            (NowStatus::PointsTo, e)
        }
        _ => (NowStatus::CantTell, unread("recovery-load-not-recorded")),
    }
}

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
    let rough_peak = rc.c.affected.iter().filter(|s| s.ram_fraction().is_some()).map(|s| peak(s)).max().unwrap_or(0);
    (
        NowStatus::PointsTo,
        vec![ev(
            EvidenceKind::SupportedInference,
            "recovered-ram-lower",
            "sessions",
            false,
            &[("peakGb", gb(peak(worst))), ("totalGb", gb(total)), ("roughGb", gb(rough_peak))],
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

fn compy(rc: &Rc) -> (NowStatus, Vec<Evidence>) {
    let now = rc.rec.iter().filter_map(|s| s.compy_changes).next_back();
    let rough: Vec<usize> = rc.c.affected.iter().filter_map(|s| s.compy_changes).collect();
    let before: Vec<usize> = rc.c.base.iter().filter_map(|s| s.compy_changes).collect();
    let (Some(now), Some(lo), Some(hi)) = (now, before.iter().copied().min(), before.iter().copied().max()) else {
        return (NowStatus::CantTell, unread("recovery-compy-unread"));
    };
    if rough.is_empty() {
        return (NowStatus::CantTell, unread("recovery-compy-unread"));
    }
    let from = rough[rough.len() - 1].to_string();
    if rough.contains(&now) {
        return (
            NowStatus::PointsAway,
            vec![ev(EvidenceKind::Measured, "recovered-compy-same", "sessions", true, &[("count", now.to_string())])],
        );
    }
    if now >= lo && now <= hi {
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
    let hits: Vec<DateTime<Utc>> = changes::kind_events(r, kind)
        .filter(|e| kind != ChangeKind::WindowsUpdate || matches!(changes::class_of(e).as_str(), "quality" | "feature" | "driver"))
        .filter_map(changes::when_of)
        .filter(|at| *at > rc.rough_start && *at <= rc.rec_start)
        .collect();
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
    if changes::is_complete(r, kind) {
        return (
            NowStatus::PointsAway,
            vec![ev(EvidenceKind::Measured, "recovered-unchanged", "windows", true, &[("what", what.to_string())])],
        );
    }
    (NowStatus::CantTell, unread_records())
}

// ---- The recovery block ------------------------------------------------------------------------------
fn summary(findings: &[Finding]) -> RecoverySummary {
    let live: Vec<&Finding> = findings.iter().filter(|f| f.now != Some(NowStatus::PointsAway)).collect();
    let supported = live.iter().filter(|f| f.now == Some(NowStatus::PointsTo)).count();
    if live.len() == 1 && supported == 1 {
        RecoverySummary::PointsTo { id: live[0].id }
    } else if live.len() >= 2 {
        RecoverySummary::Between { ids: live.iter().map(|f| f.id).collect() }
    } else {
        RecoverySummary::None
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
    let newest = rec.last()?;
    let rough_count = c.affected.iter().filter_map(|s| s.compy_changes).next_back();
    let mut also_changed = Vec::new();
    if let (Some(a), Some(b)) = (rough_count, newest.compy_changes) {
        if a != b {
            also_changed.push(ev(EvidenceKind::Known, "compy-changes-differ", "sessions", false, &[("from", a.to_string()), ("to", b.to_string())]));
        }
    }
    Some(Recovery {
        before: p.before.clone(),
        rough: p.now.clone(),
        now: mean_metric(rec),
        rough_sessions: p.sessions_affected.clone(),
        recovered_sessions: rec.iter().map(|s| s.session_ref()).collect(),
        at_or_above_median: newest.ratio().is_some_and(|r| r >= p.before.ratio),
        sessions_since: since.min(u8::MAX as usize) as u8,
        summary: summary(&d.findings),
        also_changed,
    })
}
