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

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use super::*;
use crate::game_mods::{self, ModFinding, ModScan, ModUnreadable, Strength, Verdict as ScanVerdict};

/// Other games whose folders are also scanned for the cross-game line.
pub(crate) const MAX_OTHER_GAMES: usize = 2;
/// A second folder is only scanned while the first scan has used less than this much of the reader budget.
const OTHERS_START_LIMIT: Duration = Duration::from_millis(600);
/// A file date within this many seconds of another counts as the same day (settings vs. creation).
const SAME_DAY_SECS: i64 = 86_400;
/// A file written this long after a session ended still counts as written while it ran.
const SESSION_GRACE_SECS: i64 = 120;
/// How long the diagnosed game's own verdict waits for the other games' folder scans.
const OTHERS_WAIT: Duration = Duration::from_millis(500);

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
pub(crate) fn read_real_mods(game_exe: &str, others: &[String], budget: Duration) -> ModInput {
    static OTHERS_RUNNING: AtomicBool = AtomicBool::new(false);
    read_mods_with(game_exe, others, |raw| dto(&game_mods::scan_for_process(raw)), OTHERS_WAIT, budget, &OTHERS_RUNNING)
}

/// Kept back from the reader budget so a verdict sent just before the caller stops waiting still arrives.
const BUDGET_MARGIN: Duration = Duration::from_millis(60);

/// The diagnosed game's folder is scanned first, on the calling thread, and its verdict is never held back
/// by another game's folder: the others are scanned one after another on a helper thread and collected for
/// at most `wait`, and never past what is left of the caller's `budget` (less a small margin): a game scan
/// that finished is always delivered, never reported as "took too long" because other games were slow.
/// One that is late is dropped (it reads as "couldn't check" on the card, never as clean).
/// `running` keeps one helper alive at a time, so repeated presses cannot pile up scanning threads: while
/// a previous helper still runs, the other games are simply not scanned this time.
pub(super) fn read_mods_with(game_exe: &str, others: &[String], scan: fn(&str) -> ModsRead, wait: Duration, budget: Duration, running: &'static AtomicBool) -> ModInput {
    let started = Instant::now();
    let game = scan(game_exe);
    let raws: Vec<String> = others.iter().take(MAX_OTHER_GAMES).cloned().collect();
    if raws.is_empty() || running.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
        return ModInput { game, others: Vec::new() };
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let spawned = std::thread::Builder::new().name("paramedic-mods-others".into()).spawn(move || {
        let _free = FlagGuard(running);
        for raw in raws {
            if started.elapsed() >= OTHERS_START_LIMIT {
                break;
            }
            let read = scan(&raw);
            if tx.send((intelligence::pretty_game_name(&raw), read)).is_err() {
                break;
            }
        }
    });
    if spawned.is_err() {
        running.store(false, Ordering::Release);
        return ModInput { game, others: Vec::new() };
    }
    let left = budget.saturating_sub(BUDGET_MARGIN).saturating_sub(started.elapsed());
    let deadline = Instant::now() + wait.min(left);
    let mut rest = Vec::new();
    while let Ok(one) = rx.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
        rest.push(one);
    }
    ModInput { game, others: rest }
}

/// Clears a "still running" flag when the thread holding it ends, even by a panic.
pub(crate) struct FlagGuard(pub(crate) &'static AtomicBool);

impl Drop for FlagGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
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
    // A settings file the mod rewrites while the game runs (an overlay saving its own config) says when the
    // game was played, not when the mod arrived: a date inside ANY recorded session (this game's or another's,
    // mixed or partly measured ones too; their length plus a short grace) gives no timing. The creation
    // date keeps its own caveat in the line.
    let in_a_session = |t: DateTime<Utc>| {
        c.inp.sessions.iter().any(|s| matches!((s.start(), s.end()), (Some(a), Some(b)) if t >= a && t <= b + chrono::Duration::seconds(SESSION_GRACE_SECS)))
    };
    // A loader that is not beside the game's exe is a file the game does not load from: no timing from it.
    let timing = m.loader_file_present
        && (m.first_seen.is_some_and(in_window) || m.settings_changed.is_some_and(|t| in_window(t) && !in_a_session(t)));
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
        // Only the fact: the file was last written before the first rough session. Compy cannot tell from a
        // file date whether the mod was running, so nothing is concluded from it and it is not "against".
        if hi.is_some_and(|h| l < h) {
            evidence.push(ev(EvidenceKind::Known, "mod-log-before-rough", "game-folder", false, &[]));
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

/// Cited games whose folder was NOT checked for mods, while mods were asked for at all: absent from the
/// scans (skipped or late), unavailable, or unscannable. A game scanned clean or with files found is not here.
/// `others` is keyed by the card's name for the game (`pretty_game_name`), like `games` (the cross-game names).
pub(super) fn other_game_unchecked(c: &Ctx, games: &[String]) -> Vec<String> {
    if matches!(c.inp.mods.game, ModsRead::NotRead) {
        return Vec::new();
    }
    games
        .iter()
        .filter(|g| {
            let checked = match c.inp.mods.others.iter().find(|(n, _)| n == *g) {
                Some((_, ModsRead::Read(ModsVerdict::NoKnownMod | ModsVerdict::Found(_)))) => true,
                Some((_, ModsRead::Read(ModsVerdict::Partly(m)))) => !m.is_empty(),
                _ => false,
            };
            !checked
        })
        .cloned()
        .collect()
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
