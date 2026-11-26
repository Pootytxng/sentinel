//! F7 slice 1: Windows' own hardware error records (WHEA-Logger 17, 18, 19) as a lead in the measured
//! diagnosis. READ-ONLY. It reads WHEN Windows wrote each record and nothing else: no part is named,
//! because no part is read. The engine half (`detect`) is pure; the edge (`read_real_hardware_records`)
//! goes through `change_sources`' budgeted, unelevated System-log read.
//!
//! The rule, in the order `detect` applies it:
//! - never read (`NotRead`, the recorded fixtures): nothing is said;
//! - the read failed or ran long: one "Compy couldn't see" line, never "none";
//! - no record between the last normal session and the time of the read: a "what Compy checked" line with
//!   the span, but only when the read reaches back to the start of that span; otherwise a "couldn't see" line;
//! - one or more records there: the `hardware-errors` candidate with `Fix::Hardware`.
//!
//! The lead is Possible at most (review r1, coordinator decision). Every fact here comes from ONE source, the
//! same rows: how many there are and where they sit against the sessions are that one record seen twice, so
//! neither is a support (`d` and `m` stay false) and nothing here can reach Likely. Where the records sit is
//! said as evidence lines only. A record in a normal sitting, or before the game got rough at all, is said as
//! a line that weakens the lead (`c1`).

use super::*;

/// Two records closer together than this are one event seen twice (`blackbox::CROSS_SOURCE_WINDOW_SECS`).
pub(crate) const HW_SAME_EVENT_SECS: i64 = crate::blackbox::CROSS_SOURCE_WINDOW_SECS;
/// A record this soon after a session's recorded end still belongs to it (`blackbox::VITALS_GRACE_SECS`).
pub(crate) const HW_SESSION_GRACE_SECS: i64 = crate::blackbox::VITALS_GRACE_SECS;

/// What the read of Windows' hardware error records gave the diagnosis.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) enum HwRead {
    /// Nobody asked (the pure engine on recorded fixtures): nothing is said about these records.
    #[default]
    NotRead,
    /// The read could not be used: `took-too-long`, `reader-failed` or `read-failed`.
    Unavailable(&'static str),
    Read {
        /// When Windows wrote each record, as read (not yet merged).
        records: Vec<DateTime<Utc>>,
        /// How far back this read can speak. Records older than this may exist and were not read.
        covered_from: DateTime<Utc>,
        /// The end of the span asked: the time of the read.
        until: DateTime<Utc>,
    },
}

/// The start of the span the reader is asked about: the start of the oldest normal SITTING the game's first
/// rough session was judged against. `None`: the answer has no such sessions (nothing to compare with).
pub(super) fn read_since(inp: &DiagnoseInputs, probe: &Diagnosis) -> Option<DateTime<Utc>> {
    // The same inputs `diagnose` judges on.
    let merged = with_sitting_evidence(inp);
    let inp = &merged;
    let game = probe.game.as_deref()?;
    let first_bad = probe.first_bad.as_ref()?;
    let sess = game_sessions(inp, game);
    let judged = judge_game(&sess);
    let i = sess.iter().position(|s| s.started_at == first_bad.started_at)?;
    let base = judged[i].base.as_ref()?;
    base.ids.iter().filter_map(|&k| sitting_span(inp, sess[k]).0).min()
}

/// Pure: what one read of the log means for the diagnosis. A read that ran out of time before any row is
/// "took too long"; any other failure, or a read that cannot say how far back it reached, is "couldn't read".
pub(crate) fn hw_read_from(
    read: Result<crate::change_sources::HardwareErrorLog, crate::change_sources::UnreadableReason>,
    since: DateTime<Utc>,
    until: DateTime<Utc>,
) -> HwRead {
    match read {
        // The read speaks for the span asked at most, and for what the log (or a cut-short read) reached.
        Ok(log) => match log.covered_from {
            Some(from) => HwRead::Read { records: log.records, covered_from: from.max(since), until },
            None => HwRead::Unavailable("read-failed"),
        },
        Err(crate::change_sources::UnreadableReason::TimedOutBeforeAnyRecord) => HwRead::Unavailable("took-too-long"),
        Err(_) => HwRead::Unavailable("read-failed"),
    }
}

/// The real read, for the command. `since` is `read_since`; the span ends now.
pub(crate) fn read_real_hardware_records(since: DateTime<Utc>, until: DateTime<Utc>) -> HwRead {
    hw_read_from(crate::change_sources::read_hardware_errors(since, until, crate::change_sources::DEFAULT_BUDGET), since, until)
}

/// Oldest first, with a record that follows the one kept before it by under `HW_SAME_EVENT_SECS` dropped.
fn distinct(records: &[DateTime<Utc>]) -> Vec<DateTime<Utc>> {
    let mut sorted = records.to_vec();
    sorted.sort();
    let mut out: Vec<DateTime<Utc>> = Vec::new();
    for t in sorted {
        if out.last().is_none_or(|last| (t - *last).num_seconds() >= HW_SAME_EVENT_SECS) {
            out.push(t);
        }
    }
    out
}

/// A rough session: from the launch's own start to `HW_SESSION_GRACE_SECS` after its recorded end (the cautious
/// side: a record in another launch of the same sitting is not placed in the rough session).
fn inside(s: &SessionFacts, t: DateTime<Utc>) -> bool {
    match (s.start(), s.end()) {
        (Some(a), Some(b)) => t >= a && t <= b + chrono::Duration::seconds(HW_SESSION_GRACE_SECS),
        _ => false,
    }
}

/// A normal sitting: from its first launch's start to its last launch's end, plus the grace.
fn inside_sitting(c: &Ctx, s: &SessionFacts, t: DateTime<Utc>) -> bool {
    match c.span_of(s) {
        (Some(a), Some(b)) => t >= a && t <= b + chrono::Duration::seconds(HW_SESSION_GRACE_SECS),
        _ => false,
    }
}

/// The normal sessions a record is checked against: the ones the rough session was judged against, and any
/// later session of this game judged normal.
fn normal_sessions<'a>(c: &Ctx<'a>) -> Vec<&'a SessionFacts> {
    let mut v: Vec<&'a SessionFacts> = c.base.clone();
    for (s, j) in c.sess.iter().zip(c.judged) {
        let later = s.start().is_some_and(|t| t >= c.win_start);
        if later && j.verdict == Verdict::Normal && !v.iter().any(|x| x.started_at == s.started_at) {
            v.push(*s);
        }
    }
    v
}

pub(super) fn detect(c: &Ctx, out: &mut Out) {
    let (records, covered_from, until) = match &c.inp.hardware {
        HwRead::NotRead => return,
        HwRead::Unavailable(why) => {
            out.unknown(if *why == "took-too-long" { "hardware-errors-slow" } else { "hardware-errors-unread" });
            return;
        }
        HwRead::Read { records, covered_from, until } => (records, *covered_from, *until),
    };
    let all = distinct(records);
    // Between the last normal session and the time of the read.
    let window: Vec<DateTime<Utc>> = all.iter().copied().filter(|t| *t >= c.win_start && *t <= until).collect();
    let (Some(first), Some(last)) = (window.first().copied(), window.last().copied()) else {
        // "Found none" is said only for a span the read reached the start of.
        if covered_from <= c.win_start {
            out.see("hardware-errors-none", &[("from", iso(c.win_start)), ("to", iso(until))]);
        } else {
            out.unknown("hardware-errors-before");
        }
        return;
    };
    let normal = normal_sessions(c);
    let oldest_normal = normal.iter().filter_map(|s| c.span_of(s).0).min();
    let normal_covered = oldest_normal.is_some_and(|t| covered_from <= t);
    let in_rough = window.iter().filter(|t| c.affected.iter().any(|s| inside(s, **t))).count();
    // Whole sittings: a record in any launch of a normal sitting counts.
    let in_normal = all.iter().filter(|t| normal.iter().any(|s| inside_sitting(c, s, **t))).count();
    // Before the game got rough at all, while it was not running: the condition predates the problem.
    let earlier: Vec<DateTime<Utc>> = all.iter().copied().filter(|t| *t < c.win_start && !normal.iter().any(|s| inside_sitting(c, s, *t))).collect();
    let mut evidence = vec![ev(
        EvidenceKind::Known,
        "whea-count",
        "windows-system-log",
        false,
        &[("count", window.len().to_string()), ("from", iso(first)), ("to", iso(last))],
    )];
    if in_rough > 0 {
        // `of`: the count the line above gave, so the card can say "it" for a lone record and "N of these" otherwise.
        evidence.push(ev(EvidenceKind::Measured, "whea-in-rough", "sessions", false, &[("count", in_rough.to_string()), ("of", window.len().to_string())]));
    }
    if in_normal > 0 {
        evidence.push(ev(EvidenceKind::Known, "whea-in-normal", "sessions", true, &[("count", in_normal.to_string())]));
    } else if normal_covered {
        // Said only when it is true for whole sittings AND the read reaches back past the oldest of them.
        evidence.push(ev(EvidenceKind::Known, "whea-normal-clean", "sessions", false, &[("base", normal.len().to_string())]));
    }
    if let (Some(a), Some(b)) = (earlier.first(), earlier.last()) {
        evidence.push(ev(
            EvidenceKind::Known,
            "whea-earlier",
            "windows-system-log",
            true,
            &[("count", earlier.len().to_string()), ("from", iso(*a)), ("to", iso(*b))],
        ));
    }
    if !normal_covered {
        // Not read is not clean: the line says how far back the read reached.
        evidence.push(ev(EvidenceKind::Unknown, "whea-normal-unread", "windows-system-log", false, &[("from", iso(covered_from))]));
    }
    out.cands.push(Cand {
        id: "hardware-errors",
        t: true,
        // One source, so no support beyond the timing: see the module comment.
        d: false,
        x: false,
        confounded: false,
        m: false,
        r: false,
        c1: in_normal > 0 || !earlier.is_empty(),
        // One record has its time; several are said as the span from the first to the last.
        since: if window.len() == 1 { When::Exact { at: iso(first) } } else { When::ObservedBetween { from: iso(first), to: iso(last) } },
        fix: Fix::Hardware { code: "hardware-errors" },
        evidence,
    });
}
