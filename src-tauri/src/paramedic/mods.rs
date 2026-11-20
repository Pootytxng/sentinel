//! M3: graphics mods in the diagnosed game's folder, as evidence. READ-ONLY.
//!
//! `game_mods` (the file reader) sees files only. It can never know a mod is loaded or running, so this
//! half keeps to the sentences its module docs allow. The command path scans the game's folder (and, for
//! the cross-game line, another game's) inside the same reader budget as the Windows readers, and hands
//! the pure engine a small verdict DTO (`ModsRead`), never a `ModScan`. Every rule below is therefore
//! testable from hand-built DTOs.
//!
//! - `Strong` (a mod's own loader DLL): a candidate. Timing support only when a recorded file date falls
//!   between the last fully measured normal session's end and the first rough session's start AND a loader
//!   sits where the game loads from; otherwise it is listed under "Also possible" with no timing. It is a
//!   timing-only kind for ranking and can never be Likely alone.
//! - `SettingsOnly`: never a candidate; one "what Compy checked" line that says Compy can't tell whether the
//!   mod itself is installed.
//! - No known mod on a complete scan is "no known graphics mod", never "no mods". A scan that could not look,
//!   or only partly looked, is a specific "Compy couldn't see" line and never an all-clear.
//! - File dates are creation and last-write times of files. They are never "installed on" or "active".

use std::time::{Duration, Instant};

use super::*;
use crate::game_mods::{self, ModFinding, ModScan, ModUnreadable, Strength, Verdict as ScanVerdict};

/// Other games whose folders are also scanned for the cross-game line.
pub(crate) const MAX_OTHER_GAMES: usize = 2;
/// A second folder is only scanned while the first scan has used less than this much of the reader budget.
const OTHERS_START_LIMIT: Duration = Duration::from_millis(600);
/// A file date within this many seconds of another counts as the same day (settings vs. creation).
const SAME_DAY_SECS: i64 = 86_400;

/// Why a folder could not be scanned at all (never "no mods").
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub(crate) enum CouldNot {
    /// The game could not be matched to an install folder.
    NoInstallFolder,
    /// The folder was missing, unreadable, or the scan ran out of time before it listed anything.
    FolderUnreadable,
}

/// One mod's recorded facts, reduced from `ModFinding`. Names are the module's fixed display names.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct ModFound {
    pub name: &'static str,
    /// The mod's own loader DLL (or a DLL whose version resource names it). False: settings or data only.
    pub strong: bool,
    /// A file that could load the mod sits in the folder of the game's exe.
    pub loader_file_present: bool,
    pub first_seen: Option<DateTime<Utc>>,
    pub settings_changed: Option<DateTime<Utc>>,
    pub last_log_write: Option<DateTime<Utc>>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) enum ModsVerdict {
    /// Complete scan; none of the mods Compy knows were found in the folders it checked.
    NoKnownMod,
    /// Complete scan; at least one known mod's files were found.
    Found(Vec<ModFound>),
    /// A limit stopped the scan: `found` is only what was seen. Never "no known mod", even when empty.
    Partly(Vec<ModFound>),
    CouldNotScan(CouldNot),
}

/// What the command path gave the engine for one folder.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub(crate) enum ModsRead {
    /// Nobody asked (the pure engine on recorded fixtures): nothing is said about mods either way.
    #[default]
    NotRead,
    /// The scan could not be used: `took-too-long` or `reader-failed`.
    Unavailable(&'static str),
    Read(ModsVerdict),
}

/// The diagnosed game's folder and the folders of other games the cross-game line cites (by the name the
/// card shows). A game that was not scanned is simply absent: no line is said about it.
#[derive(Clone, Debug, Default)]
pub(crate) struct ModInput {
    pub game: ModsRead,
    pub others: Vec<(String, ModsRead)>,
}

fn found_of(f: &ModFinding) -> ModFound {
    ModFound {
        name: f.name,
        strong: f.strength == Strength::Strong,
        loader_file_present: f.loader_file_present,
        first_seen: f.first_seen,
        settings_changed: f.settings_changed,
        last_log_write: f.last_log_write,
    }
}

/// The only reading of a scan the engine sees (`ModScan::verdict`), as a plain DTO.
pub(crate) fn dto(scan: &ModScan) -> ModsRead {
    ModsRead::Read(match scan.verdict() {
        ScanVerdict::NoKnownMod { .. } => ModsVerdict::NoKnownMod,
        ScanVerdict::Found { found, .. } => ModsVerdict::Found(found.iter().map(found_of).collect()),
        ScanVerdict::PartlyScanned { found, .. } => ModsVerdict::Partly(found.iter().map(found_of).collect()),
        ScanVerdict::CouldNotScan { reason } => ModsVerdict::CouldNotScan(match reason {
            ModUnreadable::FolderMissing | ModUnreadable::FolderUnreadable | ModUnreadable::TimedOutBeforeAnyEntry => CouldNot::FolderUnreadable,
            ModUnreadable::NoProcessName | ModUnreadable::NotInSteam | ModUnreadable::Steam(_) => CouldNot::NoInstallFolder,
        }),
    })
}

/// The real scans, for the command: the diagnosed game, then (while the budget lasts) up to
/// `MAX_OTHER_GAMES` other games' folders. Synchronous: call it from a blocking context only. Read-only.
pub(crate) fn read_real_mods(game_exe: &str, others: &[String]) -> ModInput {
    let started = Instant::now();
    let game = dto(&game_mods::scan_for_process(game_exe));
    let mut rest = Vec::new();
    for raw in others.iter().take(MAX_OTHER_GAMES) {
        if started.elapsed() >= OTHERS_START_LIMIT {
            break;
        }
        rest.push((intelligence::pretty_game_name(raw), dto(&game_mods::scan_for_process(raw))));
    }
    ModInput { game, others: rest }
}

/// The process names of the other games the diagnosis says also got rough (the card shows their pretty
/// names; the scans need the recorded process names).
pub(crate) fn other_rough_games(inp: &DiagnoseInputs, probe: &Diagnosis) -> Vec<String> {
    let Some(p) = &probe.problem else { return Vec::new() };
    let mut raws: Vec<String> = Vec::new();
    for s in &inp.sessions {
        if !s.mixed
            && !raws.iter().any(|r| same_game(r, &s.game))
            && probe.game.as_deref().is_none_or(|g| !same_game(g, &s.game))
            && p.other_games_affected.contains(&intelligence::pretty_game_name(&s.game))
        {
            raws.push(s.game.clone());
        }
    }
    raws
}

/// What the game's own folder adds: candidates, "checked" lines and "couldn't see" lines.
pub(super) fn detect(c: &Ctx, out: &mut Out) {
    match &c.inp.mods.game {
        ModsRead::NotRead => {}
        ModsRead::Unavailable(_) => out.unknown("mods-unavailable"),
        ModsRead::Read(ModsVerdict::NoKnownMod) => out.ruled_out("graphics-mod", &[]),
        ModsRead::Read(ModsVerdict::CouldNotScan(CouldNot::NoInstallFolder)) => out.unknown("mods-no-folder"),
        ModsRead::Read(ModsVerdict::CouldNotScan(CouldNot::FolderUnreadable)) => out.unknown("mods-folder-unreadable"),
        ModsRead::Read(ModsVerdict::Found(found)) => found_mods(c, out, found),
        ModsRead::Read(ModsVerdict::Partly(found)) => {
            found_mods(c, out, found);
            out.unknown("mods-partial");
        }
    }
}

fn found_mods(c: &Ctx, out: &mut Out, found: &[ModFound]) {
    for m in found {
        if m.strong {
            out.cands.push(candidate(c, m));
        } else {
            out.see("mod-settings-only", &[("name", m.name.to_string())]);
        }
    }
}

fn candidate(c: &Ctx, m: &ModFound) -> Cand {
    let hi = c.first_bad.start();
    let lo = c.last_full_normal.and_then(SessionFacts::end);
    let in_window = |t: DateTime<Utc>| matches!((lo, hi), (Some(l), Some(h)) if t > l && t <= h);
    // A loader that is not beside the game's exe is a file the game does not load from: no timing from it.
    let timing = m.loader_file_present && (m.first_seen.is_some_and(in_window) || m.settings_changed.is_some_and(in_window));
    let mut evidence = Vec::new();
    let date = |t: DateTime<Utc>| [("date", iso(t))];
    if let Some(t) = m.first_seen {
        evidence.push(ev(EvidenceKind::Known, "mod-files-created", "game-folder", false, &date(t)));
    }
    if let Some(s) = m.settings_changed {
        if m.first_seen.is_none_or(|f| (s - f).num_seconds().abs() > SAME_DAY_SECS) {
            evidence.push(ev(EvidenceKind::Known, "mod-settings-changed", "game-folder", false, &date(s)));
        }
    }
    if let Some(l) = m.last_log_write {
        evidence.push(ev(EvidenceKind::Known, "mod-log-written", "game-folder", false, &date(l)));
        // The mod's own log was last written before the first rough session, and a normal session had already
        // started before that write: the mod may not have been running in the rough one. Said as "may".
        // (The baseline sessions are the game's normal ones too, even the first ones that had nothing to be
        // compared with yet.)
        let before_l = |s: &SessionFacts| s.start().is_some_and(|t| t < l);
        let earlier_normal =
            c.base.iter().copied().any(before_l) || c.sess.iter().zip(c.judged).any(|(s, j)| j.verdict == Verdict::Normal && before_l(s));
        if hi.is_some_and(|h| l < h) && earlier_normal {
            evidence.push(ev(EvidenceKind::Known, "mod-log-before-rough", "game-folder", true, &[]));
        }
    }
    Cand {
        id: "graphics-mod",
        t: timing,
        d: false,
        x: false,
        confounded: false,
        m: false,
        r: false,
        c1: false,
        since: match (timing, lo, hi) {
            (true, Some(l), Some(h)) => When::ObservedBetween { from: iso(l), to: iso(h) },
            _ => When::Unknown,
        },
        fix: steps("graphics-mod", &[("name", m.name.to_string())]),
        evidence,
    }
}

/// Another game's folder holds mod files (strong or settings-only): its rough sessions may have their own
/// reason, so the cross-game support is confounded. One (game, mod name) per mod; a game that was not
/// scanned, or scanned clean, adds nothing.
pub(super) fn other_game_mods(c: &Ctx, games: &[String]) -> Vec<(String, &'static str)> {
    let mut v = Vec::new();
    for g in games {
        let Some((_, ModsRead::Read(verdict))) = c.inp.mods.others.iter().find(|(n, _)| n == g) else { continue };
        let found: &[ModFound] = match verdict {
            ModsVerdict::Found(m) | ModsVerdict::Partly(m) => m,
            _ => &[],
        };
        v.extend(found.iter().map(|m| (g.clone(), m.name)));
    }
    v
}
