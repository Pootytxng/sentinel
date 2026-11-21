//! How many sessions Compy has recorded, for the first look's "what Compy can't tell yet" lines. Before this the
//! first look never read the recorded sessions, so a game with twenty of them was told "Compy hasn't seen a game
//! run yet". Read-only (the sessions file is read, never written, moved or repaired), nothing stored, nothing sent.
//!
//! Honesty:
//! - "None" is said only when the read succeeded and the picked game has no recorded session. A read that failed
//!   (`unread`) and a pick Compy cannot match to a recorded game (`unmatched`) are "can't tell", never zero.
//! - A pick with a program name (a game Compy recorded) is matched on that exact name, ignoring case and edge
//!   spaces. A pick with only a display name (a Steam pick) is matched on the same letters and digits as the
//!   recorded program's display name; when nothing matches, that is `unmatched`, not "no sessions".
//! - Counts are recorded rows, as Home counts them. This module compares nothing: it says how many exist.

use serde::Serialize;

use super::GameCtx;
use crate::paramedic::BASELINE_MIN;

/// What the sessions read gave: the program name of every recorded session (an unnamed row is an empty string).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) enum SessionsRead {
    /// Nobody asked (hand-built fixtures): nothing is said either way.
    #[default]
    NotRead,
    /// The reader was late or died (`took-too-long`, `reader-failed`) or the file could not be read (`unreadable`).
    Unavailable(&'static str),
    Read(Vec<String>),
}

/// What the card gets. `state`: `read`, `unread` (could not be read) or `not-read` (nobody asked). Counts exist
/// only when `state` is `read`.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct RecordedOut {
    pub state: &'static str,
    /// Recorded sessions in all.
    pub total: Option<u32>,
    /// The picked game's recorded sessions. None when no game is picked, the read failed, or the pick could not be
    /// matched to a recorded game (see `unmatched`).
    pub game: Option<u32>,
    /// A game was picked but Compy could not match it to a recorded game: it can't say how many sessions it has.
    pub unmatched: bool,
    /// Sessions of one game the measured answer needs before it can compare (the measured flow's own number).
    pub need: u32,
}

impl RecordedOut {
    fn bare(state: &'static str) -> Self {
        Self { state, total: None, game: None, unmatched: false, need: BASELINE_MIN as u32 }
    }
}

fn letters(s: &str) -> String {
    s.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// PURE: the card's view of a reading, about `game` (nothing picked = the whole PC).
pub(crate) fn out(read: &SessionsRead, game: &GameCtx) -> RecordedOut {
    let names = match read {
        SessionsRead::NotRead => return RecordedOut::bare("not-read"),
        SessionsRead::Unavailable(_) => return RecordedOut::bare("unread"),
        SessionsRead::Read(names) => names,
    };
    let mut o = RecordedOut::bare("read");
    o.total = Some(count(names.len()));
    if !game.picked() {
        return o;
    }
    if let Some(exe) = game.exe.as_deref().map(str::trim).filter(|e| !e.is_empty()) {
        o.game = Some(count(names.iter().filter(|n| n.trim().eq_ignore_ascii_case(exe)).count()));
        return o;
    }
    let want = game.name.as_deref().map(letters).unwrap_or_default();
    let matched = if want.is_empty() { 0 } else { names.iter().filter(|n| letters(&crate::intelligence::pretty_game_name(n)) == want).count() };
    if matched > 0 {
        o.game = Some(count(matched));
    } else {
        o.unmatched = true;
    }
    o
}

/// The real read: the sessions file of the data root, read-only and strict (`read_sessions_readonly_from`). A
/// missing file is an empty store; one that cannot be read or parsed is `unreadable`, never zero sessions.
pub(crate) fn read_real() -> SessionsRead {
    let root = crate::data_root::decision();
    if matches!(root, crate::data_root::DataRootDecision::Unavailable { .. }) {
        return SessionsRead::Unavailable("unreadable");
    }
    read_at(&root.effective_root().join("sessions.json"))
}

pub(crate) fn read_at(path: &std::path::Path) -> SessionsRead {
    match crate::sessions::read_sessions_readonly_from(path) {
        Ok(all) => SessionsRead::Read(all.into_iter().map(|s| s.process_name).collect()),
        Err(_) => SessionsRead::Unavailable("unreadable"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Shaped like the owner's recorded sessions: program names with spaces and ".exe", one game with many rows.
    fn recorded() -> SessionsRead {
        let mut v: Vec<String> = Vec::new();
        v.extend(std::iter::repeat_n("ROB RUN.exe".to_string(), 20));
        v.extend(std::iter::repeat_n("PBZ.exe".to_string(), 13));
        v.extend(std::iter::repeat_n("LANESPLIT-Win64-Shipping.exe".to_string(), 2));
        SessionsRead::Read(v)
    }
    fn seen(exe: &str) -> GameCtx {
        GameCtx { name: Some(crate::intelligence::pretty_game_name(exe)), exe: Some(exe.into()), ..GameCtx::default() }
    }
    fn steam(name: &str) -> GameCtx {
        GameCtx { name: Some(name.into()), exe: None, game_ref: None, steam: super::super::SteamState::Found }
    }

    #[test]
    fn a_game_with_twenty_recorded_sessions_is_counted_not_called_unseen() {
        let o = out(&recorded(), &seen("ROB RUN.exe"));
        assert_eq!((o.state, o.total, o.game, o.unmatched), ("read", Some(35), Some(20), false));
    }

    #[test]
    fn the_program_name_matches_ignoring_case_and_edge_spaces() {
        assert_eq!(out(&recorded(), &seen(" rob run.EXE ")).game, Some(20));
    }

    #[test]
    fn a_failed_read_is_unread_with_no_zero() {
        let o = out(&SessionsRead::Unavailable("reader-failed"), &seen("ROB RUN.exe"));
        assert_eq!((o.state, o.total, o.game), ("unread", None, None));
    }

    #[test]
    fn nobody_asked_says_nothing() {
        let o = out(&SessionsRead::NotRead, &seen("ROB RUN.exe"));
        assert_eq!((o.state, o.total, o.game), ("not-read", None, None));
    }

    #[test]
    fn none_is_said_only_after_a_successful_read_that_found_none() {
        let o = out(&recorded(), &seen("Other Game.exe"));
        assert_eq!((o.state, o.game, o.unmatched), ("read", Some(0), false));
        let empty = out(&SessionsRead::Read(Vec::new()), &seen("ROB RUN.exe"));
        assert_eq!((empty.state, empty.total, empty.game), ("read", Some(0), Some(0)));
    }

    #[test]
    fn a_steam_pick_is_matched_by_display_name_and_otherwise_unmatched_never_zero() {
        assert_eq!(out(&recorded(), &steam("Rob Run")).game, Some(20));
        let o = out(&recorded(), &steam("Some Steam Game"));
        assert_eq!((o.state, o.game, o.unmatched), ("read", None, true));
    }

    #[test]
    fn the_whole_pc_has_a_total_and_no_game_count() {
        let o = out(&recorded(), &GameCtx::default());
        assert_eq!((o.state, o.total, o.game, o.unmatched), ("read", Some(35), None, false));
    }

    #[test]
    fn the_need_is_the_measured_flows_own_number() {
        assert_eq!(out(&recorded(), &GameCtx::default()).need, BASELINE_MIN as u32);
    }

    #[test]
    fn a_missing_file_is_an_empty_store_and_a_broken_one_is_unreadable() {
        let dir = std::env::temp_dir().join(format!("compy-p3-recorded-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        assert_eq!(read_at(&dir.join("absent.json")), SessionsRead::Read(Vec::new()));
        let bad = dir.join("bad.json");
        std::fs::write(&bad, "{ not json").unwrap();
        assert_eq!(read_at(&bad), SessionsRead::Unavailable("unreadable"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
