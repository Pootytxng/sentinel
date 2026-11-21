//! S4 of the day-one answer: which KNOWN programs are running right now. A fact about this moment, not about
//! when the game ran badly: Compy did not see that session. Read-only, one handle-free names-only snapshot
//! (`other_load::read_process_names`: no process is opened, so a running game is never touched), nothing stored, nothing sent, no process started.
//!
//! Privacy and honesty (the allowlist rule of `running_at_start`, unchanged):
//! - Only programs in the reviewed `running_at_start::PROGRAMS` table can appear, matched by exact image name.
//!   An unlisted process is counted and never named; the output holds table ids and table display names, never
//!   a raw process name. A test pins that.
//! - Presence is not a finding: the card says it is now, not then, and claims no effect on any game.
//! - A listing that came back empty, late or dead is "couldn't read", never "none".
//! - Bounded: at most one entry per table row (the table's length), and `SHOWN` of them are sent, with a count
//!   of the rest.

use serde::Serialize;

use crate::running_at_start::{lookup, PROGRAMS};

/// Entries sent to the card; the rest are only counted (`more`).
pub(crate) const SHOWN: usize = 8;

/// What the process listing gave: the table ids that matched (table order, once each) and how many processes
/// were listed at all (zero means the listing failed).
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct RunningNow {
    pub ids: Vec<&'static str>,
    pub total: u32,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) enum RunningRead {
    /// Nobody asked (recorded fixtures): nothing is said either way.
    #[default]
    NotRead,
    /// The reader was late or died: `took-too-long` or `reader-failed`.
    Unavailable(&'static str),
    Read(RunningNow),
}

/// One listed program running now. Table constants only.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct Running {
    pub id: &'static str,
    pub name: &'static str,
}

/// What the card gets. `state`: `listed`, `none` (read, none of the listed programs), `unread` (the listing was
/// empty), `took-too-long`, `reader-failed` or `not-read`. Only `none` says none.
#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct RunningNowOut {
    pub state: &'static str,
    pub programs: Vec<Running>,
    /// Listed programs beyond the `SHOWN` sent.
    pub more: u32,
}

impl RunningNowOut {
    pub(crate) fn not_read() -> Self {
        Self { state: "not-read", programs: Vec::new(), more: 0 }
    }
}

/// PURE: match the names the listing gave against the table. Exact image name, ASCII case-insensitive.
pub(crate) fn from_names<'a>(names: impl IntoIterator<Item = &'a str>) -> RunningNow {
    let mut total = 0u32;
    let mut seen = std::collections::HashSet::new();
    for n in names {
        total = total.saturating_add(1);
        if let Some(p) = lookup(n) {
            seen.insert(p.id);
        }
    }
    RunningNow { ids: PROGRAMS.iter().filter(|p| seen.contains(p.id)).map(|p| p.id).collect(), total }
}

/// PURE: the card's view of a reading.
pub(crate) fn out(read: &RunningRead) -> RunningNowOut {
    match read {
        RunningRead::NotRead => RunningNowOut::not_read(),
        RunningRead::Unavailable(why) => RunningNowOut { state: *why, programs: Vec::new(), more: 0 },
        // A Windows PC always has processes: an empty listing is a failed read, never "nothing running".
        RunningRead::Read(r) if r.total == 0 => RunningNowOut { state: "unread", programs: Vec::new(), more: 0 },
        RunningRead::Read(r) if r.ids.is_empty() => RunningNowOut { state: "none", programs: Vec::new(), more: 0 },
        RunningRead::Read(r) => {
            let all: Vec<Running> = PROGRAMS.iter().filter(|p| r.ids.contains(&p.id)).map(|p| Running { id: p.id, name: p.display_name }).collect();
            let more = all.len().saturating_sub(SHOWN) as u32;
            RunningNowOut { state: "listed", programs: all.into_iter().take(SHOWN).collect(), more }
        }
    }
}

/// The real read: one handle-free names-only snapshot (`NtQuerySystemInformation`, through `other_load`): no
/// process is opened, so a running game is never touched. A failed snapshot is an empty listing, which reads
/// `unread`, never "none".
pub(crate) fn read_real() -> RunningRead {
    match crate::other_load::read_process_names() {
        Some(names) => RunningRead::Read(from_names(names.iter().map(String::as_str))),
        None => RunningRead::Read(RunningNow::default()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_listed_programs_match_by_exact_image_name_and_unlisted_names_are_only_counted() {
        let r = from_names(["System", "explorer.exe", "MEDAL.EXE", "notmedal.exe", "Discord.exe", "my-secret-tool.exe", "obs64.exe"]);
        assert_eq!(r.total, 7);
        assert_eq!(r.ids, vec!["medal", "obs-studio", "discord"], "table order, once each");
    }

    #[test]
    fn a_program_with_several_images_is_one_entry() {
        let r = from_names(["medal.exe", "medalencoder.exe", "medal.exe"]);
        assert_eq!(r.ids, vec!["medal"]);
    }

    #[test]
    fn the_output_holds_table_ids_and_display_names_and_never_a_raw_process_name() {
        let r = from_names(["Medal.exe", "private-thing-42.exe", r"C:\Users\someone\secret.exe"]);
        let json = serde_json::to_string(&out(&RunningRead::Read(r))).unwrap();
        assert!(json.contains("\"id\":\"medal\"") && json.contains("\"name\":\"Medal\""), "{json}");
        assert!(!json.contains("private") && !json.contains("secret") && !json.contains(".exe") && !json.contains("someone"), "{json}");
    }

    #[test]
    fn an_empty_late_or_dead_listing_is_never_none() {
        assert_eq!(out(&RunningRead::Read(from_names([]))).state, "unread");
        assert_eq!(out(&RunningRead::Unavailable("took-too-long")).state, "took-too-long");
        assert_eq!(out(&RunningRead::Unavailable("reader-failed")).state, "reader-failed");
        assert_eq!(out(&RunningRead::NotRead).state, "not-read");
        // A listing that saw processes and none of the listed ones is the only "none".
        let none = out(&RunningRead::Read(from_names(["System", "explorer.exe"])));
        assert_eq!((none.state, none.programs.len()), ("none", 0));
    }

    #[test]
    fn the_list_is_capped_with_a_count_of_the_rest() {
        let every: Vec<&str> = PROGRAMS.iter().flat_map(|p| p.images.iter().copied()).collect();
        let o = out(&RunningRead::Read(from_names(every)));
        assert_eq!(o.state, "listed");
        assert_eq!(o.programs.len(), SHOWN);
        assert_eq!(o.programs.len() as u32 + o.more, PROGRAMS.len() as u32);
        // Every listed program stays listed, background or not; nothing is said about residency.
        let two = out(&RunningRead::Read(from_names(["medal.exe", "firefox.exe"])));
        assert_eq!(two.programs.iter().map(|p| p.id).collect::<Vec<_>>(), vec!["medal", "firefox"]);
        assert!(!serde_json::to_string(&two).unwrap().contains("resident"));
    }
}
