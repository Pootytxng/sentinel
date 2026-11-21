//! S5 of the day-one answer: how many of the picked game's crash records Compy could read fall before and
//! after the earliest dated change. Counts and dates only. Pure, read-only, stores nothing.
//!
//! What it says and refuses to say:
//! - It counts the records the crash line already counts (same match rule as `extras::crash_outcome`; a test
//!   pins that the two always agree on the total) and splits them at the earliest dated change.
//! - Every count is "at least": Windows keeps a limited number of crash records and a report can be deleted,
//!   so even a complete read is a lower bound.
//! - "None before" is said only when the readable records reach back past the change (the oldest record of ANY
//!   program is older than it) and nothing was left unread; "none after" only when nothing was left unread.
//!   Otherwise the line says it can't tell how many came before (or whether any came after), and why. A split
//!   with no record on one side never turns into "it stopped" or "it started".
//! - No rate, no "more/fewer since", no cause: the card words the counts and nothing else.

use chrono::{DateTime, Utc};
use serde::Serialize;

use crate::paramedic::extras::{CrashFact, CrashHistory, CrashMatch};
use crate::paramedic::{iso, same_game};

/// Why Compy can't say how many records came before the change.
pub(crate) const GAP_STARTS_LATER: &str = "starts-later";
pub(crate) const GAP_UNREAD: &str = "unread";
/// Some records could not be read, and none of the readable ones is after the change: a newer one may be among them.
pub(crate) const GAP_AFTER_UNREAD: &str = "unread-after";

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct CrashSplit {
    /// Readable records of the game strictly before the change.
    pub before: u32,
    /// Readable records of the game at or after the change.
    pub after: u32,
    /// The earliest dated change the split is taken at (UTC, exact).
    pub change: String,
    /// The oldest crash record of ANY program that Compy could read: where its view of Windows' records starts.
    pub oldest_read: Option<String>,
    /// Set when Compy cannot back a "none" on one side: `starts-later` (no record before the change, and its
    /// oldest readable record is not older than the change) or `unread` (no record before it, and some records
    /// could not be read); `unread-after` (no record after it, and some records could not be read).
    pub gap: Option<&'static str>,
    /// The records were matched by program name only (some report has no path under the game's folder), so
    /// the count may include another program of the same name: the card carries the measured flow's by-name hedge.
    pub by_name: bool,
}

/// The records of the game, by the same rule as `extras::crash_outcome`.
fn mine<'a>(h: &'a CrashHistory, how: CrashMatch<'_>) -> Vec<&'a CrashFact> {
    match how {
        CrashMatch::Program(game) => h.crashes.iter().filter(|k| same_game(&k.app, game) && k.path_ok != Some(false)).collect(),
        CrashMatch::InstallFolder => h.crashes.iter().filter(|k| k.path_ok == Some(true)).collect(),
    }
}

/// The split at `change`, or none when there is no dated change or no readable record of the game.
pub(crate) fn split(h: &CrashHistory, how: CrashMatch<'_>, change: Option<DateTime<Utc>>) -> Option<CrashSplit> {
    let change = change?;
    let mine = mine(h, how);
    if mine.is_empty() {
        return None;
    }
    let unattributable = matches!(how, CrashMatch::InstallFolder) && h.crashes.iter().any(|k| k.path_ok.is_none());
    let partial = h.partial || unattributable;
    let before = mine.iter().filter(|k| k.when < change).count() as u32;
    let after = mine.len() as u32 - before;
    let oldest = h.crashes.iter().map(|k| k.when).min();
    let gap = if before == 0 && oldest.is_none_or(|o| o >= change) {
        Some(GAP_STARTS_LATER)
    } else if before == 0 && partial {
        Some(GAP_UNREAD)
    } else if after == 0 && partial {
        Some(GAP_AFTER_UNREAD)
    } else {
        None
    };
    let by_name = matches!(how, CrashMatch::Program(_)) && mine.iter().any(|k| k.path_ok != Some(true));
    Some(CrashSplit { before, after, change: iso(change), oldest_read: oldest.map(iso), gap, by_name })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paramedic::extras::{crash_outcome, CrashOutcome};

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn crash(app: &str, at: &str, path_ok: Option<bool>) -> CrashFact {
        CrashFact { app: app.into(), when: utc(at), module: None, code: None, version: None, path_ok }
    }

    fn hist(crashes: Vec<CrashFact>, partial: bool) -> CrashHistory {
        CrashHistory { crashes, listed: true, partial }
    }

    const C: &str = "2026-11-19T09:00:00Z";
    const GAME: CrashMatch<'static> = CrashMatch::Program("robrun.exe");

    fn split_of(h: &CrashHistory) -> CrashSplit {
        split(h, GAME, Some(utc(C))).expect("a split")
    }

    #[test]
    fn records_are_counted_before_and_after_and_the_change_instant_counts_as_after() {
        let h = hist(
            vec![
                crash("robrun.exe", "2026-11-01T10:00:00Z", None),
                crash("robrun.exe", "2026-11-18T10:00:00Z", None),
                crash("robrun.exe", C, None),
                crash("robrun.exe", "2026-11-20T01:00:00Z", None),
                crash("other.exe", "2026-11-02T10:00:00Z", None),
            ],
            false,
        );
        let s = split_of(&h);
        assert_eq!((s.before, s.after, s.gap), (2, 2, None));
        assert_eq!(s.change, "2026-11-19T09:00:00Z");
        assert_eq!(s.oldest_read.as_deref(), Some("2026-11-01T10:00:00Z"));
    }

    #[test]
    fn no_dated_change_or_no_record_of_the_game_gives_no_split() {
        let h = hist(vec![crash("robrun.exe", "2026-11-01T10:00:00Z", None)], false);
        assert!(split(&h, GAME, None).is_none());
        let other = hist(vec![crash("other.exe", "2026-11-01T10:00:00Z", None)], false);
        assert!(split(&other, GAME, Some(utc(C))).is_none());
        assert!(split(&hist(vec![], false), GAME, Some(utc(C))).is_none());
    }

    #[test]
    fn none_before_is_a_gap_when_the_readable_records_start_after_the_change() {
        let h = hist(vec![crash("robrun.exe", "2026-11-20T01:00:00Z", None), crash("other.exe", "2026-11-19T20:00:00Z", None)], false);
        let s = split_of(&h);
        assert_eq!((s.before, s.after, s.gap), (0, 1, Some(GAP_STARTS_LATER)));
        assert_eq!(s.oldest_read.as_deref(), Some("2026-11-19T20:00:00Z"));
    }

    #[test]
    fn none_before_is_a_real_zero_only_when_the_records_reach_back_and_nothing_was_left_unread() {
        // Another program's older record shows Compy can see back past the change.
        let records = vec![crash("robrun.exe", "2026-11-20T01:00:00Z", None), crash("other.exe", "2026-11-01T10:00:00Z", None)];
        let s = split_of(&hist(records.clone(), false));
        assert_eq!((s.before, s.after, s.gap), (0, 1, None));
        // The same records with some left unread: no "none before".
        let s = split_of(&hist(records, true));
        assert_eq!((s.before, s.gap), (0, Some(GAP_UNREAD)));
    }

    #[test]
    fn a_record_before_the_change_is_never_a_gap_even_when_the_read_was_partial() {
        let s = split_of(&hist(vec![crash("robrun.exe", "2026-11-01T10:00:00Z", None), crash("robrun.exe", "2026-11-20T01:00:00Z", None)], true));
        assert_eq!((s.before, s.after, s.gap), (1, 1, None));
    }

    #[test]
    fn all_records_before_the_change_is_a_split_with_none_after() {
        let s = split_of(&hist(vec![crash("robrun.exe", "2026-11-01T10:00:00Z", None), crash("robrun.exe", "2026-11-02T10:00:00Z", None)], false));
        assert_eq!((s.before, s.after, s.gap), (2, 0, None));
    }

    /// The split counts the same records as the crash line, for every matching rule, so the two sentences can
    /// never disagree about how many records there are.
    #[test]
    fn the_split_total_is_the_crash_lines_count_for_the_same_inputs() {
        let h = hist(
            vec![
                crash("robrun.exe", "2026-11-01T10:00:00Z", Some(true)),
                crash("ROBRUN.EXE", "2026-11-20T01:00:00Z", None),
                crash("robrun.exe", "2026-11-02T10:00:00Z", Some(false)),
                crash("other.exe", "2026-11-03T10:00:00Z", Some(true)),
                crash("robrun.exe", "2026-11-21T10:00:00Z", None),
            ],
            false,
        );
        for how in [GAME, CrashMatch::InstallFolder] {
            let s = split(&h, how, Some(utc(C)));
            let line = crash_outcome(&h, how, None);
            match (s, line) {
                (Some(s), CrashOutcome::Line(l)) => {
                    let n = l.args.iter().find(|(k, _)| *k == "n").map(|(_, v)| v.parse::<u32>().unwrap()).unwrap();
                    assert_eq!(s.before + s.after, n, "{how:?}");
                }
                (None, CrashOutcome::NoneCounted { .. }) => {}
                (s, l) => panic!("the split and the line disagree about whether any record counts: {s:?} / {l:?}"),
            }
        }
    }

    /// A pick with only an install folder counts a report with no path as unattributable: the read is partial,
    /// so a zero before is a gap, not a fact.
    #[test]
    fn an_unattributable_report_makes_a_zero_before_a_gap() {
        let h = hist(vec![crash("robrun.exe", "2026-11-20T01:00:00Z", Some(true)), crash("x.exe", "2026-11-01T10:00:00Z", None)], false);
        let s = split(&h, CrashMatch::InstallFolder, Some(utc(C))).unwrap();
        assert_eq!((s.before, s.after, s.gap), (0, 1, Some(GAP_UNREAD)));
    }

    /// "None after" needs a complete read: a record that could not be read may be a newer crash.
    #[test]
    fn none_after_is_a_gap_when_some_records_were_not_read_and_a_fact_when_none_were_missed() {
        let records = vec![crash("robrun.exe", "2026-11-01T10:00:00Z", None), crash("robrun.exe", "2026-11-02T10:00:00Z", None)];
        let s = split_of(&hist(records.clone(), true));
        assert_eq!((s.before, s.after, s.gap), (2, 0, Some(GAP_AFTER_UNREAD)));
        let s = split_of(&hist(records, false));
        assert_eq!((s.before, s.after, s.gap), (2, 0, None));
        // An install-folder pick with a path-less report is partial too.
        let h = hist(vec![crash("robrun.exe", "2026-11-01T10:00:00Z", Some(true)), crash("x.exe", "2026-11-01T11:00:00Z", None)], false);
        let s = split(&h, CrashMatch::InstallFolder, Some(utc(C))).unwrap();
        assert_eq!((s.before, s.after, s.gap), (1, 0, Some(GAP_AFTER_UNREAD)));
    }

    /// A match by program name alone can count another program of the same name: the split says so.
    #[test]
    fn a_match_by_program_name_only_is_flagged_and_a_folder_match_is_not() {
        let named = hist(vec![crash("robrun.exe", "2026-11-01T10:00:00Z", None), crash("robrun.exe", "2026-11-20T10:00:00Z", Some(true))], false);
        assert!(split_of(&named).by_name);
        let by_path = hist(vec![crash("robrun.exe", "2026-11-01T10:00:00Z", Some(true)), crash("robrun.exe", "2026-11-20T10:00:00Z", Some(true))], false);
        assert!(!split_of(&by_path).by_name);
        let folder = hist(vec![crash("robrun.exe", "2026-11-01T10:00:00Z", Some(true))], false);
        assert!(!split(&folder, CrashMatch::InstallFolder, Some(utc(C))).unwrap().by_name);
    }
}
