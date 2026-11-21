//! The day-one answer (design M5, slices S1-S3): what changed on this PC around when it started, for a user
//! with no usable history, for the whole PC or for one picked game. Read-only: it reads Windows' own dated
//! records through `change_sources::changes_between`, the crash and mod readers the measured flow uses, and
//! writes nothing, stores nothing about the user's answers, and starts no process of its own.
//!
//! What it says and refuses to say:
//! - Every row is a dated fact with `Certainty::Possible` at most and `EvidenceKind::Known`; nothing is
//!   called a problem or a cause, and nothing is ordered by likelihood (newest first inside a group).
//! - A kind whose source was unread, partly read, not asked or not covered back to the window start is a
//!   limit line, never "nothing changed". "None" is said per kind, only for a complete read.
//! - "It's always been like this" lists no change; the game's crash records and folder are still read.
//! - A picked game's crash history and graphics-mod verdict come from the SAME rules and readers as the
//!   measured flow (`extras::crash_outcome`, `mods::dto`), so the same inputs give the same sentences.
//!
//! The engine returns codes, ids and numbers; the card owns every sentence (locales `paramedic.firstLook`).

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use serde::{Deserialize, Serialize};

mod crash_split;
mod running_now;

use self::crash_split::CrashSplit;
use self::running_now::{RunningNowOut, RunningRead};
use super::changes::{collect_reader, spawn_reader, status_limits, Limit, Slots, CHANGES_BUDGET};
use super::extras::{crash_dto, crash_outcome, CrashMatch, CrashOutcome, CrashRead};
use super::facts::{self, CompyChange, Fact, FactsInput, FactsRead, HistoryRead};
use super::mods::{CouldNot, ModFound, ModsRead, ModsVerdict};
use super::{iso, Certainty, EvidenceKind};
use crate::change_sources::{self, ChangeEvent, ChangeKind, ChangeReport, GameRef, KindStatus, Precision, SteamLookup, UnreadableReason};

// The outer wait must outlast each reader's own budget, or a slow source would read "took too long" for all
// three kinds instead of giving its own partial line (pinned here, at compile time).
const _: () = assert!(CHANGES_BUDGET.as_millis() >= change_sources::DEFAULT_BUDGET.as_millis() * 2);

/// Names a day's installs show before "and N more".
const PROGRAM_NAMES_SHOWN: usize = 3;

pub(crate) const METHOD: &str = "paramedic-first-look-v1";

/// What the user said about when it started. The card sends one of five taps; nothing is stored.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Since {
    Today,
    ThisWeek,
    ThisMonth,
    Always,
    DontKnow,
}

/// Which game to look at: nothing picked (the whole PC), a game Compy has recorded (its program name), or a
/// game from Steam's list (its app id; `name` is only the name the card showed, used if Steam's record of it
/// cannot be read again).
#[derive(Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub(crate) enum FirstLookGame {
    WholePc,
    Seen { process: String },
    Steam { app_id: u32, #[serde(default)] name: Option<String> },
}

/// The window read for a choice, as a number of days back from now. A lead is included on purpose: a
/// change made just before the user noticed belongs in the window. `Always` has no window.
pub(crate) fn window_hours(since: Since) -> Option<i64> {
    match since {
        Since::Today => Some(48),
        Since::ThisWeek => Some(8 * 24),
        Since::ThisMonth => Some(35 * 24),
        Since::DontKnow => Some(30 * 24),
        Since::Always => None,
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Told {
    pub since: Since,
    /// Start of the window actually read (UTC); none for "always".
    pub from: Option<String>,
    pub to: String,
    pub hours: Option<i64>,
}

/// One dated observation and the code of the by-hand check that goes with it.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Change {
    pub id: &'static str,
    /// When it happened (UTC). Day precision: the start of the local day.
    pub at: Option<String>,
    /// `exact` or `day`: a day is worded "on {{day}}", never with a time of day.
    pub precision: &'static str,
    pub args: BTreeMap<&'static str, String>,
    /// Always `Possible` here: a first look has no measurement (pinned by a test).
    pub confidence: Certainty,
    pub evidence: EvidenceKind,
    /// The by-hand step for the card to word; empty for a counted line.
    pub how: &'static str,
}

/// The game's crash records Compy could read, as numbers (`n`, `since`, and `partial` / `byName` /
/// `versions` when they apply: the measured flow's own args) and the same-signature facts under its own
/// conditions.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Crashes {
    pub args: BTreeMap<&'static str, String>,
    pub signature_module: Option<String>,
    pub signature_before: Option<String>,
    /// How many of those records fall before and after the earliest dated change (counts and dates only);
    /// none when there is no dated change to split at.
    pub split: Option<CrashSplit>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct FirstLook {
    pub told: Told,
    /// The display name of the picked game; none for the whole PC.
    pub game: Option<String>,
    /// False for "always": no change list was made, by choice.
    pub changes_listed: bool,
    /// Graphics driver, Windows updates, the game's files, a graphics mod dated in the window: the things
    /// that sit in a game's path. Newest first.
    pub touch_games: Vec<Change>,
    /// Other drivers, programs, minor updates. Newest first.
    pub other_changes: Vec<Change>,
    /// Kinds read COMPLETELY with nothing in the window: `gpu-driver`, `windows-update`, `programs`.
    pub none: Vec<&'static str>,
    /// Steam's last recorded update of the picked game when it is OLDER than the window (read completely).
    pub game_files_since: Option<String>,
    /// The picked game's crash records, when any were counted.
    pub crashes: Option<Crashes>,
    /// Windows' crash records were read completely and none is the picked game's.
    pub crashes_none: bool,
    /// Facts about the PC or the game's folder with their dates or numbers (not a change in the window).
    pub looks_off: Vec<Change>,
    /// The picked game's folder was scanned completely and holds no mod Compy knows.
    pub mods_none: bool,
    /// Mods whose settings or data files (not a loader) sit in the picked game's folder.
    pub mods_settings_only: Vec<&'static str>,
    /// What looks off on this PC, as codes and numbers: a short fixed list (see `facts`), in its fixed order.
    pub facts: Vec<Fact>,
    /// Changes Compy itself made inside the window, newest first (read from the ledger without writing).
    pub compy_changes: Vec<CompyChange>,
    /// Known programs (the reviewed allowlist) running at this moment: a fact about now, not about when the
    /// game ran badly. Read for the whole PC and for a picked game, with or without a window.
    pub running_now: RunningNowOut,
    /// What Compy could not see, per kind; the card words each.
    pub limits: Vec<Limit>,
    /// Every asked kind was read completely (so "no dated change" may be said when the lists are empty).
    pub read_all: bool,
    pub method: &'static str,
}

/// What the dated readers gave.
#[derive(Clone, Debug)]
pub(crate) enum Reading {
    Report(Box<ChangeReport>),
    /// `took-too-long` or `reader-failed`: every kind is unread.
    Unavailable(&'static str),
}

/// What Steam said about the picked game, for the limit lines.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) enum SteamState {
    /// No game picked.
    #[default]
    NotAsked,
    Found,
    NotInSteam,
    Unreadable(UnreadableReason),
}

/// The game asked about, as the command resolved it.
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct GameCtx {
    pub name: Option<String>,
    /// The program name, when the game is one Compy has recorded.
    pub exe: Option<String>,
    pub game_ref: Option<GameRef>,
    pub steam: SteamState,
}

impl GameCtx {
    pub(super) fn picked(&self) -> bool {
        self.name.is_some() || self.exe.is_some() || self.game_ref.is_some() || self.steam != SteamState::NotAsked
    }
    pub(super) fn install_dir(&self) -> Option<&str> {
        self.game_ref.as_ref().and_then(|g| g.install_dir.as_deref())
    }
}

/// Everything the readers gave, as plain DTOs. A reader nobody asked is `NotRead` / `None`: it says nothing.
#[derive(Clone, Debug, Default)]
pub(crate) struct Sources {
    pub changes: Option<Reading>,
    pub crashes: CrashRead,
    pub mods: ModsRead,
    pub facts: FactsRead,
    pub history: HistoryRead,
    pub running: RunningRead,
}

pub(super) fn limit(kind: &'static str, code: &'static str, args: &[(&'static str, String)]) -> Limit {
    Limit { kind, code, args: args.iter().cloned().collect() }
}

fn change(id: &'static str, at: Option<DateTime<Utc>>, precision: Precision, args: &[(&'static str, String)], how: &'static str) -> Change {
    Change {
        id,
        at: at.map(iso),
        precision: if precision == Precision::Day { "day" } else { "exact" },
        args: args.iter().cloned().collect(),
        confidence: Certainty::Possible,
        evidence: EvidenceKind::Known,
        how,
    }
}

fn class_of(e: &ChangeEvent) -> String {
    e.what.detail.as_deref().unwrap_or("").trim().to_ascii_lowercase()
}

fn is_major(class: &str) -> bool {
    matches!(class, "quality" | "feature" | "driver")
}

fn is_minor(class: &str) -> bool {
    matches!(class, "definition" | "store-app")
}

/// A driver-class Windows Update row that is the same install as a graphics driver row: the same moment
/// (within two minutes) and, when both name a version, the same version.
fn same_install(update: &ChangeEvent, driver: &ChangeEvent) -> bool {
    let (Some(a), Some(b)) = (update.when.at, driver.when.at) else { return false };
    if (a - b).num_seconds().abs() > 120 {
        return false;
    }
    match (update.what.to_version.as_deref(), driver.what.to_version.as_deref()) {
        (Some(x), Some(y)) => crate::hardware::same_driver(x, y),
        _ => true,
    }
}

fn known(v: &Option<String>) -> String {
    v.as_deref().map(str::trim).unwrap_or("").to_string()
}

/// The three kinds read for the whole PC, with their limit names.
const KINDS: [(&str, ChangeKind); 3] = [
    ("driver", ChangeKind::GpuDriver),
    ("windows-update", ChangeKind::WindowsUpdate),
    ("programs", ChangeKind::ProgramInstalled),
];

fn events_of(r: &ChangeReport, kind: ChangeKind) -> Vec<&ChangeEvent> {
    r.events_found.iter().filter(|e| e.kind == kind).collect()
}

fn newest_first(v: &mut [Change]) {
    v.sort_by(|a, b| b.at.cmp(&a.at).then(a.id.cmp(b.id)).then(a.args.cmp(&b.args)));
}

/// Pure: the whole-PC answer for `since` from what the dated readers gave (`None` for "always": nothing was
/// read). The tests' entry; the command goes through `run_with`.
#[allow(dead_code)]
pub(crate) fn build(since: Since, now: DateTime<Utc>, reading: Option<&Reading>) -> FirstLook {
    build_with(since, now, &GameCtx::default(), &Sources { changes: reading.cloned(), ..Sources::default() })
}

/// Pure: the answer for `since` about `game` (no game picked = the whole PC) from what the readers gave.
pub(crate) fn build_with(since: Since, now: DateTime<Utc>, game: &GameCtx, src: &Sources) -> FirstLook {
    let hours = window_hours(since);
    let t0 = hours.map(|h| now - ChronoDuration::hours(h));
    let told = Told { since, from: t0.map(iso), to: iso(now), hours };
    let mut out = FirstLook {
        told,
        game: game.name.clone(),
        changes_listed: since != Since::Always,
        touch_games: Vec::new(),
        other_changes: Vec::new(),
        none: Vec::new(),
        game_files_since: None,
        crashes: None,
        crashes_none: false,
        looks_off: Vec::new(),
        mods_none: false,
        mods_settings_only: Vec::new(),
        facts: Vec::new(),
        compy_changes: Vec::new(),
        running_now: running_now::out(&src.running),
        limits: Vec::new(),
        read_all: false,
        method: METHOD,
    };
    if let Some(reading) = src.changes.as_ref().filter(|_| since != Since::Always) {
        changes_part(reading, game, &mut out);
    }
    mods_part(game, &src.mods, t0, now, &mut out);
    // Compy's own changes come BEFORE the crash line: they are dated changes too, and the line's "before the
    // earliest dated change" must name the true earliest one.
    facts::history_part(&src.history, t0, now, &mut out);
    crashes_part(game, &src.crashes, &mut out);
    facts::facts_part(&src.facts, game, &mut out);
    newest_first(&mut out.touch_games);
    newest_first(&mut out.other_changes);
    newest_first(&mut out.looks_off);
    out
}

/// The dated Windows readers' half: the three whole-PC kinds, and the picked game's Steam record.
fn changes_part(reading: &Reading, game: &GameCtx, out: &mut FirstLook) {
    let picked = game.picked();
    match reading {
        Reading::Unavailable(why) => {
            for (name, _) in KINDS {
                out.limits.push(limit(name, why, &[]));
            }
            if picked {
                out.limits.push(limit("game-update", why, &[]));
            }
        }
        Reading::Report(r) => {
            let r = r.as_ref();
            let mut all_complete = true;
            for (name, kind) in KINDS {
                let status = r.status(kind);
                all_complete &= matches!(status, KindStatus::Complete { .. });
                status_limits(name, status, &mut out.limits);
            }
            let steam_read = picked && game.steam == SteamState::Found;
            if steam_read {
                let status = r.status(ChangeKind::GameUpdate);
                all_complete &= matches!(status, KindStatus::Complete { .. });
                let was_read = matches!(status, KindStatus::Complete { .. } | KindStatus::Partial { .. });
                status_limits("game-update", status, &mut out.limits);
                // Steam keeps only the newest update time: an earlier update in the window would not show.
                if was_read {
                    out.limits.push(limit("game-update", "steam-newest-only", &[]));
                }
            } else if picked {
                all_complete = false;
                match &game.steam {
                    SteamState::Unreadable(why) => status_limits("game-update", KindStatus::Unreadable(why.clone()), &mut out.limits),
                    _ => out.limits.push(limit("game-update", "not-steam", &[])),
                }
            }
            out.read_all = all_complete;
            let complete = |kind: ChangeKind| matches!(r.status(kind), KindStatus::Complete { .. });
            gpu_rows(r, out);
            let folded = update_rows(r, out);
            program_rows(r, out);
            other_driver_row(r, out);
            if steam_read {
                game_rows(r, game, out);
            }
            if complete(ChangeKind::GpuDriver) && !out.touch_games.iter().any(|c| c.id.starts_with("gpu-driver")) {
                out.none.push("gpu-driver");
            }
            // "No update" is never said beside a driver row that Windows Update delivered: that update IS recorded.
            if complete(ChangeKind::WindowsUpdate)
                && !folded
                && !out.touch_games.iter().any(|c| c.id.starts_with("windows-update"))
                && !out.other_changes.iter().any(|c| c.id == "updates-unclassified")
            {
                out.none.push("windows-update");
            }
            if complete(ChangeKind::ProgramInstalled) && !out.other_changes.iter().any(|c| c.id == "programs-installed") {
                out.none.push("programs");
            }
        }
    }
    // No game is picked: Compy says it did not look at any game's files, rather than staying silent.
    if !picked {
        out.limits.push(limit("game-update", "not-picked", &[]));
    }
}

/// Steam's record of the picked game's files. In the window: one dated row (never "the game updated":
/// Steam's time also moves on a verify or a DLC download). Older than the window: said as Steam's record.
fn game_rows(r: &ChangeReport, game: &GameCtx, out: &mut FirstLook) {
    let name = game.name.clone().unwrap_or_default();
    let newest = events_of(r, ChangeKind::GameUpdate).into_iter().filter(|e| e.when.at.is_some()).max_by_key(|e| e.when.at);
    if let Some(e) = newest {
        let mut args = vec![("game", name)];
        if e.what.detail.is_some() {
            args.push(("pending", "true".to_string()));
        }
        out.touch_games.push(change("game-files", e.when.at, e.when.precision, &args, "game-files"));
        return;
    }
    if matches!(r.status(ChangeKind::GameUpdate), KindStatus::Complete { .. }) {
        if let Some(at) = r.game_last_update.as_ref().and_then(|e| e.when.at).filter(|at| *at <= r.window_start) {
            out.game_files_since = Some(iso(at));
        }
    }
}

/// The picked game's folder, through the measured flow's verdict DTO. A mod's loader file with a file date
/// inside the window is listed among the changes that touch games; any other mod fact is a fact about the
/// folder with its dates. A settings or data file alone is one line saying so. Never "active" or "installed on".
fn mods_part(game: &GameCtx, mods: &ModsRead, t0: Option<DateTime<Utc>>, now: DateTime<Utc>, out: &mut FirstLook) {
    if !game.picked() {
        return;
    }
    match mods {
        ModsRead::NotRead => {}
        ModsRead::Unavailable(why) => out.limits.push(limit("mods", why, &[])),
        ModsRead::Read(ModsVerdict::NoKnownMod) => out.mods_none = true,
        ModsRead::Read(ModsVerdict::CouldNotScan(CouldNot::NoInstallFolder)) => out.limits.push(limit("mods", "no-folder", &[])),
        ModsRead::Read(ModsVerdict::CouldNotScan(CouldNot::FolderUnreadable)) => out.limits.push(limit("mods", "folder-unreadable", &[])),
        ModsRead::Read(ModsVerdict::Found(found)) => mod_rows(found, t0, now, out),
        ModsRead::Read(ModsVerdict::Partly(found)) => {
            mod_rows(found, t0, now, out);
            // A mod already found: what is unknown is whether there are OTHER mods.
            let args = if found.is_empty() { Vec::new() } else { vec![("other", "true".to_string())] };
            out.limits.push(limit("mods", "partial", &args));
        }
    }
}

/// A settings file this much later than the folder's first file is worth its own date.
const SETTINGS_DAY_SECS: i64 = 86_400;

fn mod_rows(found: &[ModFound], t0: Option<DateTime<Utc>>, now: DateTime<Utc>, out: &mut FirstLook) {
    for m in found {
        if !m.strong {
            out.mods_settings_only.push(m.name);
            continue;
        }
        let mut args = vec![("name", m.name.to_string())];
        if let Some(t) = m.first_seen {
            args.push(("date", iso(t)));
        }
        // A settings file the mod rewrites itself says when it ran, not when it arrived: its date is shown
        // beside the creation date, and never decides whether the mod is "in the window".
        if let Some(s) = m.settings_changed.filter(|s| m.first_seen.is_none_or(|f| (*s - f).num_seconds().abs() > SETTINGS_DAY_SECS)) {
            args.push(("settings", iso(s)));
        }
        // The same rule as the measured flow: a loader that is not beside the game's exe is a file the game
        // does not load from, so it gives no timing.
        let in_window = m.loader_file_present && matches!((t0, m.first_seen), (Some(a), Some(f)) if f > a && f <= now);
        let row = change("graphics-mod", m.first_seen, Precision::Exact, &args, "graphics-mod");
        if in_window {
            out.touch_games.push(row);
        } else {
            out.looks_off.push(row);
        }
    }
}

/// The earliest REAL dated change among the rows (an exact date; a day-precision row is not a moment), the
/// reference the same-signature line needs.
/// Compy's own changes count (they are dated moments). A mod's file-creation time does not: Windows resets
/// it when a folder is copied or moved, so it is not a change time.
fn earliest_exact(out: &FirstLook) -> Option<DateTime<Utc>> {
    let rows = out.touch_games.iter().filter(|c| c.precision == "exact" && c.id != "graphics-mod").filter_map(|c| c.at.as_deref()).filter_map(super::ts);
    let compy = out.compy_changes.iter().filter_map(|c| super::ts(&c.at));
    rows.chain(compy).min()
}

/// The picked game's Windows crash records, through the measured flow's rule (`extras::crash_outcome`).
fn crashes_part(game: &GameCtx, crashes: &CrashRead, out: &mut FirstLook) {
    if !game.picked() {
        return;
    }
    match crashes {
        CrashRead::NotRead => {}
        CrashRead::Unavailable(why) => out.limits.push(limit("crashes", why, &[])),
        CrashRead::Read(h) if !h.listed => out.limits.push(limit("crashes", "unreadable", &[])),
        CrashRead::Read(h) => {
            let how = match game.exe.as_deref() {
                Some(exe) => CrashMatch::Program(exe),
                None => CrashMatch::InstallFolder,
            };
            let earliest = earliest_exact(out);
            match crash_outcome(h, how, earliest) {
                CrashOutcome::Line(l) => {
                    let (module, before) = l.signature.unzip();
                    let split = crash_split::split(h, how, earliest);
                    out.crashes = Some(Crashes { args: l.args.into_iter().collect(), signature_module: module, signature_before: before, split });
                }
                // Not "no crashes": some reports were not read.
                CrashOutcome::NoneCounted { partial: true } => out.limits.push(limit("crashes", "partial", &[])),
                CrashOutcome::NoneCounted { partial: false } => out.crashes_none = true,
            }
        }
    }
}

/// The PCI vendor id (four hex digits, lower case) inside a hardware id such as `PCI\VEN_1002&DEV_7550&...`.
/// A virtual or remote display driver has none.
fn pci_vendor(hardware_id: &str) -> Option<String> {
    let up = hardware_id.to_ascii_uppercase();
    let i = up.find("VEN_")? + 4;
    let v = up.get(i..i + 4)?;
    v.chars().all(|c| c.is_ascii_hexdigit()).then(|| v.to_ascii_lowercase())
}

/// The maker for a vendor id from a tiny fixed table; any other PCI vendor is `other`.
fn maker_of(vendor: &str) -> &'static str {
    match vendor {
        "1002" => "amd",
        "10de" => "nvidia",
        "8086" => "intel",
        _ => "other",
    }
}

/// Real graphics-driver version changes. The same version configured again is not a change and is not listed.
/// With more than one graphics adapter (PCI display hardware ids) in the window, each row names its maker.
/// A display driver with no PCI vendor (a virtual or remote display) is never "your graphics driver": it is
/// counted on one line under the other changes.
fn gpu_rows(r: &ChangeReport, out: &mut FirstLook) {
    let updates = events_of(r, ChangeKind::WindowsUpdate);
    let gpu = events_of(r, ChangeKind::GpuDriver);
    let mut adapters: Vec<&str> = gpu.iter().filter(|e| e.what.id.as_deref().and_then(pci_vendor).is_some()).filter_map(|e| e.what.id.as_deref()).collect();
    adapters.sort_unstable();
    adapters.dedup();
    let several = adapters.len() > 1;
    let mut virtual_rows: Vec<DateTime<Utc>> = Vec::new();
    for e in gpu {
        let Some(at) = e.when.at else { continue };
        if e.what.version_changed == Some(false) {
            continue;
        }
        let Some(vendor) = e.what.id.as_deref().and_then(pci_vendor) else {
            virtual_rows.push(at);
            continue;
        };
        let (from, to) = (known(&e.what.from_version), known(&e.what.to_version));
        let mut args: Vec<(&'static str, String)> = Vec::new();
        let id = match e.what.version_changed {
            Some(true) if !from.is_empty() && !to.is_empty() => {
                args.push(("from", from));
                args.push(("to", to));
                "gpu-driver-changed"
            }
            // Windows said the version changed but did not name both versions, or it does not know the
            // earlier one: said as an install, never as "changed from X".
            _ if !to.is_empty() => {
                args.push(("to", to));
                "gpu-driver-installed"
            }
            _ => "gpu-driver-installed-bare",
        };
        if several {
            args.push(("maker", maker_of(&vendor).to_string()));
        }
        if updates.iter().any(|w| class_of(w) == "driver" && same_install(w, e)) {
            args.push(("via_update", "true".to_string()));
        }
        out.touch_games.push(change(id, Some(at), e.when.precision, &args, "gpu-driver"));
    }
    if let Some(newest) = virtual_rows.iter().max() {
        out.other_changes.push(change("display-driver-other", Some(*newest), Precision::Exact, &[("count", virtual_rows.len().to_string())], "other-drivers"));
    }
}
/// Monthly, version and driver-class updates one by one (a driver-class row that is a graphics driver
/// install is folded into that row); definition and Store-app updates counted on one line. Returns
/// whether any update was folded that way.
fn update_rows(r: &ChangeReport, out: &mut FirstLook) -> bool {
    let gpu = events_of(r, ChangeKind::GpuDriver);
    let all = events_of(r, ChangeKind::WindowsUpdate);
    let mut folded = false;
    for e in &all {
        let class = class_of(e);
        let Some(at) = e.when.at else { continue };
        if class == "driver" && gpu.iter().any(|g| same_install(e, g)) {
            folded = true;
            continue;
        }
        if !is_major(&class) {
            continue;
        }
        let (id, args) = match e.what.kb.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
            Some(kb) => ("windows-update", vec![("kb", kb.to_string())]),
            None => ("windows-update-nokb", Vec::new()),
        };
        out.touch_games.push(change(id, Some(at), e.when.precision, &args, "windows-update"));
    }
    let count = |class: &str| all.iter().filter(|e| class_of(e) == class).count();
    let (defs, apps) = (count("definition"), count("store-app"));
    if defs + apps > 0 {
        let newest = all.iter().filter(|e| is_minor(&class_of(e))).filter_map(|e| e.when.at).max();
        out.other_changes.push(change("updates-minor", newest, Precision::Exact, &[("n", defs.to_string()), ("m", apps.to_string())], ""));
    }
    // A class Compy does not recognise (a title in another language, a new kind) is counted, never dropped.
    let unclassified: Vec<&&ChangeEvent> = all.iter().filter(|e| !is_major(&class_of(e)) && !is_minor(&class_of(e))).collect();
    if !unclassified.is_empty() {
        let mut kbs: Vec<String> = unclassified.iter().filter_map(|e| e.what.kb.clone()).collect();
        kbs.sort();
        kbs.dedup();
        let newest = unclassified.iter().filter_map(|e| e.when.at).max();
        out.other_changes.push(change(
            "updates-unclassified",
            newest,
            Precision::Exact,
            &[("n", unclassified.len().to_string()), ("kbs", kbs.join(", "))],
            "",
        ));
    }
    folded
}

/// Programs, one row per calendar day (installs carry a day, never a time of day).
fn program_rows(r: &ChangeReport, out: &mut FirstLook) {
    let mut days: BTreeMap<DateTime<Utc>, Vec<String>> = BTreeMap::new();
    for e in events_of(r, ChangeKind::ProgramInstalled) {
        if let (Some(at), Some(name)) = (e.when.at, e.what.name.as_deref().map(str::trim).filter(|n| !n.is_empty())) {
            days.entry(at).or_default().push(name.to_string());
        }
    }
    for (day, mut names) in days {
        names.sort();
        names.dedup();
        out.other_changes.push(change(
            "programs-installed",
            Some(day),
            Precision::Day,
            &[
                ("count", names.len().to_string()),
                ("names", names.iter().take(PROGRAM_NAMES_SHOWN).cloned().collect::<Vec<_>>().join(", ")),
                ("more", names.len().saturating_sub(PROGRAM_NAMES_SHOWN).to_string()),
            ],
            "programs",
        ));
    }
}

/// Audio, network and chipset drivers with a real version change: one collapsed line.
fn other_driver_row(r: &ChangeReport, out: &mut FirstLook) {
    let hits: Vec<&ChangeEvent> =
        events_of(r, ChangeKind::OtherDriver).into_iter().filter(|e| e.what.version_changed == Some(true) && e.when.at.is_some()).collect();
    if hits.is_empty() {
        return;
    }
    let mut classes: Vec<String> =
        hits.iter().filter_map(|e| e.what.detail.as_deref().and_then(|d| d.split_whitespace().next()).map(str::to_ascii_lowercase)).collect();
    classes.sort();
    classes.dedup();
    let newest = hits.iter().filter_map(|e| e.when.at).max();
    out.other_changes.push(change("other-drivers", newest, Precision::Exact, &[("count", hits.len().to_string()), ("classes", classes.join(", "))], "other-drivers"));
}

// ---- Orchestration: the command's half ---------------------------------------------------------

/// When the reader from an earlier press started (ms since the epoch), or 0 when none runs: a new one is not
/// started while it runs (that press reads `took-too-long`), so repeated taps cannot pile threads up. A slot
/// held longer than `STALE_SLOT_MS` is taken over, so one hung reader cannot make every later press fail.
static READING: AtomicU64 = AtomicU64::new(0);
const STALE_SLOT_MS: u64 = 30_000;

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(1).max(1)
}

/// Takes the slot at `now` (free, or held past the stale limit); returns the stamp that releases it.
fn take_slot(slot: &AtomicU64, now: u64) -> Option<u64> {
    let held = slot.load(Ordering::Acquire);
    if held != 0 && now.saturating_sub(held) < STALE_SLOT_MS {
        return None;
    }
    slot.compare_exchange(held, now, Ordering::AcqRel, Ordering::Acquire).ok().map(|_| now)
}

/// Frees the slot it took, unless a later holder has taken it over since.
struct SlotGuard(&'static AtomicU64, u64);
impl Drop for SlotGuard {
    fn drop(&mut self) {
        let _ = self.0.compare_exchange(self.1, 0, Ordering::AcqRel, Ordering::Acquire);
    }
}

/// Runs `fetch` on its own thread and waits at most `budget`. Late or dead is `Unavailable`, never empty.
pub(crate) fn read_within<F>(budget: Duration, fetch: F) -> Reading
where
    F: FnOnce() -> Reading + Send + 'static,
{
    let Some(stamp) = take_slot(&READING, now_ms()) else { return Reading::Unavailable("took-too-long") };
    let guard = SlotGuard(&READING, stamp);
    let (tx, rx) = std::sync::mpsc::channel();
    let spawned = std::thread::Builder::new().name("paramedic-first-look".into()).spawn(move || {
        let guard = guard;
        let reading = fetch();
        // Free the slot before handing the answer over: whoever asks again the moment it arrives must find the
        // slot free, not be told "took too long" by a reader that has already finished. (A reader that dies frees
        // it as it unwinds, before the waiting side sees the hang-up.)
        drop(guard);
        let _ = tx.send(reading);
    });
    if spawned.is_err() {
        let _ = READING.compare_exchange(stamp, 0, Ordering::AcqRel, Ordering::Acquire);
        return Reading::Unavailable("reader-failed");
    }
    match rx.recv_timeout(budget) {
        Ok(r) => r,
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => Reading::Unavailable("took-too-long"),
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => Reading::Unavailable("reader-failed"),
    }
}

/// What the readers call: the real ones in the command, hand-built ones in the tests.
#[derive(Clone, Copy)]
pub(crate) struct Io {
    /// Which game, and what Steam says about it (bounded, read-only).
    pub resolve: fn(&FirstLookGame) -> GameCtx,
    /// The dated Windows readers for the window.
    pub changes: fn(DateTime<Utc>, DateTime<Utc>, &GameCtx) -> Reading,
    /// Windows' crash records, for a picked game.
    pub crashes: fn(&GameCtx) -> CrashRead,
    /// The picked game's folder, for graphics mods.
    pub mods: fn(&GameCtx) -> ModsRead,
    /// The hardware facts, from the read-only accessors (never starts the hardware sweep).
    pub facts: fn(&GameCtx) -> FactsRead,
    /// Compy's own changes from the change ledger (a read that writes nothing).
    pub history: fn() -> HistoryRead,
    /// Which known programs are running right now: one names-only process listing, read-only.
    pub running: fn() -> RunningRead,
}

/// One running-now listing at a time (the command's slot; tests that go through it take `one_at_a_time`).
static RUNNING_SLOT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// The answer for `sel` and `since` at `now`: the game is resolved first (it names the folder the other readers
/// need), then the dated readers, the crash read and the folder scan run side by side inside one shared
/// `budget`. A reader that is late or dies is its own limit line, never an empty answer. "Always" runs no
/// dated reader, but a picked game's crash records and folder are still read.
pub(crate) fn run_with(sel: &FirstLookGame, since: Since, now: DateTime<Utc>, budget: Duration, io: Io, slots: Option<&'static Slots>) -> FirstLook {
    let started = Instant::now();
    let game = (io.resolve)(sel);
    let picked = game.picked();
    let crashes_rx = picked.then(|| {
        let g = game.clone();
        spawn_reader("paramedic-first-look-crashes", slots.map(|s| &s.crashes), move || (io.crashes)(&g))
    });
    let mods_rx = picked.then(|| {
        let g = game.clone();
        spawn_reader("paramedic-first-look-mods", slots.map(|s| &s.mods), move || (io.mods)(&g))
    });
    let facts_rx = {
        let g = game.clone();
        spawn_reader("paramedic-first-look-facts", slots.map(|s| &s.facts), move || (io.facts)(&g))
    };
    let history_rx = window_hours(since).map(|_| spawn_reader("paramedic-first-look-history", slots.map(|s| &s.history), move || (io.history)()));
    // Running now is a fact about this moment: asked for every choice, the whole PC and a picked game alike.
    let running_rx = spawn_reader("paramedic-first-look-running", slots.map(|_| &RUNNING_SLOT), move || (io.running)());
    let changes = window_hours(since).map(|hours| {
        let t0 = now - ChronoDuration::hours(hours);
        let g = game.clone();
        read_within(budget.saturating_sub(started.elapsed()), move || (io.changes)(t0, now, &g))
    });
    let crashes = crashes_rx.map_or(CrashRead::NotRead, |rx| collect_reader(rx, budget, started).unwrap_or_else(CrashRead::Unavailable));
    let mods = mods_rx.map_or(ModsRead::NotRead, |rx| collect_reader(rx, budget, started).unwrap_or_else(ModsRead::Unavailable));
    let facts = collect_reader(facts_rx, budget, started).unwrap_or_else(FactsRead::Unavailable);
    let history = history_rx.map_or(HistoryRead::NotRead, |rx| collect_reader(rx, budget, started).unwrap_or_else(HistoryRead::Unavailable));
    let running = collect_reader(running_rx, budget, started).unwrap_or_else(RunningRead::Unavailable);
    build_with(since, now, &game, &Sources { changes, crashes, mods, facts, history, running })
}

/// Pure: a Steam pick against Steam's listing. A game the complete listing does not hold is "not in Steam"; a
/// listing that was cut short or could not be read never says that.
fn resolve_steam(app_id: u32, shown: Option<String>, listing: Result<change_sources::SteamListing, UnreadableReason>) -> GameCtx {
    let fallback = || shown.clone().or_else(|| Some(format!("Steam game {app_id}")));
    match listing {
        Ok(l) => match l.games.into_iter().find(|g| g.app_id == app_id) {
            Some(g) => GameCtx {
                name: Some(g.name),
                exe: None,
                game_ref: Some(GameRef { steam_app_id: Some(app_id), install_dir: g.install_dir, launcher: Some("Steam".into()) }),
                steam: SteamState::Found,
            },
            None if l.complete => GameCtx { name: fallback(), exe: None, game_ref: None, steam: SteamState::NotInSteam },
            None => GameCtx {
                name: fallback(),
                exe: None,
                game_ref: None,
                steam: SteamState::Unreadable(UnreadableReason::SteamPartiallyUnreadable { libraries: 0, records: 0 }),
            },
        },
        Err(why) => GameCtx { name: fallback(), exe: None, game_ref: None, steam: SteamState::Unreadable(why) },
    }
}

fn resolve_real(sel: &FirstLookGame) -> GameCtx {
    match sel {
        FirstLookGame::WholePc => GameCtx::default(),
        FirstLookGame::Seen { process } => {
            let process = process.trim().to_string();
            if process.is_empty() {
                return GameCtx::default();
            }
            let name = Some(crate::intelligence::pretty_game_name(&process)).filter(|n| !n.is_empty()).or_else(|| Some(process.clone()));
            let (game_ref, steam) = match change_sources::find_steam_game(&process, change_sources::DEFAULT_BUDGET) {
                SteamLookup::Found(g) => (Some(g), SteamState::Found),
                SteamLookup::NotInSteam => (None, SteamState::NotInSteam),
                SteamLookup::Unreadable(why) => (None, SteamState::Unreadable(why)),
            };
            GameCtx { name, exe: Some(process), game_ref, steam }
        }
        FirstLookGame::Steam { app_id, name } => resolve_steam(*app_id, name.clone(), change_sources::list_steam_games(change_sources::STEAM_LIST_BUDGET)),
    }
}

fn changes_real(t0: DateTime<Utc>, t1: DateTime<Utc>, game: &GameCtx) -> Reading {
    match change_sources::changes_between(t0, t1, game.game_ref.as_ref()) {
        Ok(report) => Reading::Report(Box::new(report)),
        Err(_) => Reading::Unavailable("reader-failed"),
    }
}

/// Windows Error Reporting files, read-only (the Black Box's own read). With a program name the measured
/// flow's matching applies; with only an install folder, a report's exe path must lie under it.
fn crashes_real(game: &GameCtx) -> CrashRead {
    if game.exe.is_none() && game.install_dir().is_none() {
        return CrashRead::Unavailable("no-folder");
    }
    crash_dto(crate::blackbox::read_app_crashes(), game.install_dir().map(std::path::Path::new))
}

/// The same scan and the same verdict DTO as the measured flow (`scan_install_folder` for the folder the game
/// was found in; with no folder the verdict is the measured flow's "couldn't match the game to a folder").
fn mods_real(game: &GameCtx) -> ModsRead {
    let Some(dir) = game.install_dir() else { return ModsRead::Read(ModsVerdict::CouldNotScan(CouldNot::NoInstallFolder)) };
    super::mods::dto(&crate::game_mods::scan_install_folder(std::path::Path::new(dir), game.exe.as_deref(), crate::game_mods::DEFAULT_BUDGET))
}

/// The hardware facts from what is already read: the startup snapshot (never started or waited for here),
/// the power source (one WMI read on its own thread), and the AMD poller's cached FreeSync reading (the
/// poller is never started from here).
fn facts_real(_game: &GameCtx) -> FactsRead {
    let Some(hw) = crate::hardware::snapshot_if_ready() else {
        return FactsRead::Read(Box::new(FactsInput { hw: None, ..FactsInput::default() }));
    };
    let power = crate::hardware::detect_power_source();
    let freesync = crate::monitoring::amd_freesync_cache().lock().ok().and_then(|g| *g);
    FactsRead::Read(Box::new(FactsInput { hw: Some(hw), power, freesync }))
}

fn history_real() -> HistoryRead {
    HistoryRead::Read(crate::history::read_ledger_stamps())
}

const REAL: Io = Io { resolve: resolve_real, changes: changes_real, crashes: crashes_real, mods: mods_real, facts: facts_real, history: history_real, running: running_now::read_real };

/// One reader of each kind at a time: a press while an earlier reader still runs reads `took-too-long`.
static SLOTS: Slots = Slots::new();

/// The Tauri edge, beside `paramedic_diagnose` and under the same single-flight guard: while either is
/// running the other answers BUSY (the card keeps saying "still checking"). Writes nothing.
#[tauri::command]
pub(crate) async fn paramedic_first_look(game: FirstLookGame, since: Since) -> Result<FirstLook, String> {
    let Some(flight) = super::FlightGuard::begin() else { return Err(super::BUSY.to_string()) };
    tauri::async_runtime::spawn_blocking(move || {
        let _flight = flight;
        run_with(&game, since, Utc::now(), CHANGES_BUDGET, REAL, Some(&SLOTS))
    })
    .await
    .map_err(|_| "the first look stopped unexpectedly".to_string())
}

/// One game of Steam's list as the picker needs it: no path. Only the drive letter that tells two games of one
/// name apart, and which recorded game (if any) is this very folder.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct ListedGame {
    pub app_id: u32,
    pub name: String,
    /// When Steam last changed the game's files (UTC); none when its record has no time.
    pub last_updated: Option<String>,
    /// The drive letter of the game's library (`D`), when its folder is known.
    pub drive: Option<String>,
    /// The recorded game (its program name) whose install folder IS this game's folder; none when no recorded
    /// game was found in it. A name match alone never sets it.
    pub recorded: Option<String>,
}

/// Steam's list for the picker. `read: false` is "Compy couldn't read Steam's libraries", never "no games";
/// `complete: false` is "this is only part of the list". No Steam on the PC is a list that was read and is empty.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct SteamGames {
    pub read: bool,
    pub complete: bool,
    pub games: Vec<ListedGame>,
}

/// Two folder paths are one folder (case, slash direction, doubled separators and a trailing separator aside).
fn same_folder(a: &str, b: &str) -> bool {
    let norm = |s: &str| {
        let mut out = String::new();
        for c in s.trim().replace('/', "\\").to_ascii_lowercase().chars() {
            if !(c == '\\' && out.ends_with('\\')) {
                out.push(c);
            }
        }
        out.trim_end_matches('\\').to_string()
    };
    !norm(a).is_empty() && norm(a) == norm(b)
}

/// Pure: the picker's list. `recorded` holds each recorded game's program name with the Steam folder it was found in.
fn games_dto(listing: Result<change_sources::SteamListing, UnreadableReason>, recorded: &[(String, String)]) -> SteamGames {
    match listing {
        Ok(l) => SteamGames {
            read: true,
            complete: l.complete,
            games: l
                .games
                .into_iter()
                .map(|g| {
                    let drive = g.install_dir.as_deref().and_then(facts::drive_letter).map(|c| c.to_string());
                    let rec = g.install_dir.as_deref().and_then(|d| recorded.iter().find(|(_, f)| same_folder(f, d)).map(|(p, _)| p.clone()));
                    ListedGame { app_id: g.app_id, name: g.name, last_updated: g.last_updated.map(iso), drive, recorded: rec }
                })
                .collect(),
        },
        // No Steam on this PC: there is no library to read, so nothing failed and nothing is said.
        Err(UnreadableReason::SteamNotFound) => SteamGames { read: true, complete: true, games: Vec::new() },
        Err(_) => SteamGames { read: false, complete: false, games: Vec::new() },
    }
}

/// Recorded games matched to a Steam folder, and how long all of the matching may take together.
const RECORDED_MATCHED: usize = 12;
const RECORDED_MATCH_BUDGET: Duration = Duration::from_millis(1200);

/// A program name longer than this is not a program name.
const RECORDED_NAME_MAX: usize = 260;

/// The command boundary's cap, before anything is spawned: names that are empty or longer than
/// `RECORDED_NAME_MAX` are dropped, repeats (any case) are dropped, and at most `RECORDED_MATCHED` are kept.
fn cap_recorded(names: Vec<String>) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for n in names {
        // A length test first: an absurdly long string is never walked character by character.
        if n.len() > RECORDED_NAME_MAX * 4 {
            continue;
        }
        let n = n.trim();
        if n.is_empty() || n.chars().count() > RECORDED_NAME_MAX || !seen.insert(n.to_lowercase()) {
            continue;
        }
        out.push(n.to_string());
        if out.len() == RECORDED_MATCHED {
            break;
        }
    }
    out
}

/// Each recorded game's program name with the Steam folder it was found in (the measured flow's own lookup).
/// A game not found, or reached after the budget, is simply not matched: both entries then show.
fn recorded_folders(processes: Vec<String>) -> Vec<(String, String)> {
    let started = Instant::now();
    let mut out = Vec::new();
    for p in processes.into_iter().take(RECORDED_MATCHED) {
        let left = RECORDED_MATCH_BUDGET.saturating_sub(started.elapsed());
        if left.is_zero() {
            break;
        }
        if let SteamLookup::Found(g) = change_sources::find_steam_game(&p, left.min(change_sources::DEFAULT_BUDGET)) {
            if let Some(dir) = g.install_dir {
                out.push((p, dir));
            }
        }
    }
    out
}

/// Set while a picker lookup runs.
static LISTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Frees the picker's lookup when it ends, however it ends.
struct ListingGuard;
impl Drop for ListingGuard {
    fn drop(&mut self) {
        LISTING.store(false, Ordering::Release);
    }
}

/// The games installed with Steam, most recently updated first, for the "Which game?" step. `recorded` are the
/// program names of the games Compy has recorded, so the picker can tell which Steam entry is one of them.
/// Read-only and bounded (`change_sources::list_steam_games`); it starts no process and writes nothing.
#[tauri::command]
pub(crate) async fn paramedic_list_games(recorded: Option<Vec<String>>) -> Result<SteamGames, String> {
    // One lookup at a time: reopening the picker while one still runs answers BUSY (the card asks again), so
    // lookups cannot stack up behind a drive that is slow to answer.
    if LISTING.swap(true, Ordering::AcqRel) {
        return Err(super::BUSY.to_string());
    }
    let names = cap_recorded(recorded.unwrap_or_default());
    tauri::async_runtime::spawn_blocking(move || {
        let _free = ListingGuard;
        let listing = change_sources::list_steam_games(change_sources::STEAM_LIST_BUDGET);
        let folders = if listing.is_ok() { recorded_folders(names) } else { Vec::new() };
        games_dto(listing, &folders)
    })
    .await
    .map_err(|_| "the game list stopped unexpectedly".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::change_sources::{ChangeTime, ChangeWhat, Gap, ReadOk, Source, SourceRead};
    use crate::paramedic::extras::CrashHistory;

    /// The whole-PC answer for `since` at `now`. `fetch` gets the window `(t0, now]` and runs only when there is one.
    pub(super) fn first_look_with<F>(since: Since, now: DateTime<Utc>, budget: Duration, fetch: F) -> FirstLook
    where
        F: FnOnce(DateTime<Utc>, DateTime<Utc>) -> Reading + Send + 'static,
    {
        let Some(hours) = window_hours(since) else { return build(since, now, None) };
        let t0 = now - ChronoDuration::hours(hours);
        let reading = read_within(budget, move || fetch(t0, now));
        build(since, now, Some(&reading))
    }

    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    const NOW: &str = "2026-11-20T12:00:00Z";

    /// `read_within` has one static slot; tests that go through it take turns.
    static SLOT_TESTS: std::sync::Mutex<()> = std::sync::Mutex::new(());
    fn one_at_a_time() -> std::sync::MutexGuard<'static, ()> {
        SLOT_TESTS.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn ev(kind: ChangeKind, when: ChangeTime, what: ChangeWhat) -> ChangeEvent {
        let source = kind.source();
        ChangeEvent { kind, when, what, source }
    }

    const AMD: &str = "PCI\\VEN_1002&DEV_7550&SUBSYS_88111EAE&REV_C0";
    const INTEL: &str = "PCI\\VEN_8086&DEV_A780&SUBSYS_1&REV_04";

    fn gpu(at: &str, from: Option<&str>, to: &str, changed: Option<bool>) -> ChangeEvent {
        gpu_on(AMD, at, from, to, changed)
    }

    fn gpu_on(id: &str, at: &str, from: Option<&str>, to: &str, changed: Option<bool>) -> ChangeEvent {
        ev(
            ChangeKind::GpuDriver,
            ChangeTime::exact(utc(at)),
            ChangeWhat {
                id: Some(id.into()),
                name: Some("Display adapter".into()),
                from_version: from.map(str::to_string),
                to_version: Some(to.into()),
                version_changed: changed,
                ..Default::default()
            },
        )
    }

    fn update(at: &str, kb: Option<&str>, class: &str) -> ChangeEvent {
        ev(
            ChangeKind::WindowsUpdate,
            ChangeTime::exact(utc(at)),
            ChangeWhat { kb: kb.map(str::to_string), detail: Some(class.into()), ..Default::default() },
        )
    }

    fn program(day_start: &str, day_end: &str, name: &str) -> ChangeEvent {
        ev(
            ChangeKind::ProgramInstalled,
            ChangeTime::day(utc(day_start), utc(day_end)),
            ChangeWhat { name: Some(name.into()), ..Default::default() },
        )
    }

    fn other_driver(at: &str, class: &str) -> ChangeEvent {
        ev(
            ChangeKind::OtherDriver,
            ChangeTime::exact(utc(at)),
            ChangeWhat { detail: Some(class.into()), version_changed: Some(true), to_version: Some("1.2".into()), ..Default::default() },
        )
    }

    fn read(events: Vec<ChangeEvent>) -> SourceRead {
        SourceRead::ok(events)
    }

    /// A report as `combine` makes it, so windowing and statuses are the real ones.
    fn report(window_h: i64, drivers: SourceRead, updates: SourceRead, programs: SourceRead) -> ChangeReport {
        let t1 = utc(NOW);
        change_sources::combine(
            t1 - ChronoDuration::hours(window_h),
            t1,
            vec![(Source::DriverLog, drivers), (Source::WindowsUpdateLog, updates), (Source::UninstallKeys, programs)],
        )
        .unwrap()
    }

    fn look(since: Since, r: ChangeReport) -> FirstLook {
        build(since, utc(NOW), Some(&Reading::Report(Box::new(r))))
    }

    fn live_like() -> ChangeReport {
        let mut drivers = vec![
            gpu("2026-11-19T05:12:26Z", Some("32.0.32015.7029"), "32.0.32029.2010", Some(true)),
            other_driver("2026-11-18T09:00:00Z", "audio driver"),
        ];
        drivers.push(gpu("2026-11-19T05:20:00Z", Some("32.0.32029.2010"), "32.0.32029.2010", Some(false)));
        let updates = vec![
            update("2026-11-14T03:00:00Z", Some("KB5007651"), "definition"),
            update("2026-11-17T03:00:00Z", Some("KB5050000"), "quality"),
            update("2026-11-15T03:00:00Z", None, "store-app"),
        ];
        let programs = vec![
            program("2026-11-19T00:00:00Z", "2026-11-20T00:00:00Z", "Alpha"),
            program("2026-11-19T00:00:00Z", "2026-11-20T00:00:00Z", "Beta"),
            program("2026-11-16T00:00:00Z", "2026-11-17T00:00:00Z", "Gamma"),
        ];
        report(8 * 24, read(drivers), read(updates), read(programs))
    }

    #[test]
    fn each_since_choice_maps_to_the_documented_window() {
        assert_eq!(window_hours(Since::Today), Some(48));
        assert_eq!(window_hours(Since::ThisWeek), Some(8 * 24));
        assert_eq!(window_hours(Since::ThisMonth), Some(35 * 24));
        assert_eq!(window_hours(Since::DontKnow), Some(30 * 24));
        assert_eq!(window_hours(Since::Always), None);
        let _turn = one_at_a_time();
        let now = utc(NOW);
        for (since, days) in [(Since::Today, 2), (Since::ThisWeek, 8), (Since::ThisMonth, 35), (Since::DontKnow, 30)] {
            let seen = std::sync::Arc::new(std::sync::Mutex::new(None));
            let s2 = seen.clone();
            let a = first_look_with(since, now, Duration::from_secs(5), move |t0, t1| {
                *s2.lock().unwrap() = Some((t0, t1));
                Reading::Report(Box::new(report(1, read(vec![]), read(vec![]), read(vec![]))))
            });
            let (t0, t1) = seen.lock().unwrap().unwrap();
            assert_eq!(t1, now);
            assert_eq!(t0, now - ChronoDuration::days(days), "{since:?}");
            assert_eq!(a.told.from, Some(iso(t0)));
        }
    }

    #[test]
    fn groups_and_order_are_newest_first_inside_each_group() {
        let a = look(Since::ThisWeek, live_like());
        let ids: Vec<(&str, Option<&str>)> = a.touch_games.iter().map(|c| (c.id, c.at.as_deref())).collect();
        assert_eq!(
            ids,
            vec![("gpu-driver-changed", Some("2026-11-19T05:12:26Z")), ("windows-update", Some("2026-11-17T03:00:00Z"))],
            "graphics driver and Windows update touch games; same-version row is absent"
        );
        let other: Vec<&str> = other_ids(&a);
        // programs on the 19th, audio driver on the 18th, programs on the 16th, minor updates on the 15th
        assert_eq!(other, vec!["programs-installed", "other-drivers", "programs-installed", "updates-minor"]);
        let ats: Vec<&String> = a.other_changes.iter().filter_map(|c| c.at.as_ref()).collect();
        assert!(ats.windows(2).all(|w| w[0] >= w[1]), "{ats:?}");
        let gpu_row = &a.touch_games[0];
        assert_eq!(gpu_row.args.get("from").map(String::as_str), Some("32.0.32015.7029"));
        assert_eq!(gpu_row.args.get("to").map(String::as_str), Some("32.0.32029.2010"));
        assert_eq!(gpu_row.how, "gpu-driver");
    }

    fn other_ids(a: &FirstLook) -> Vec<&'static str> {
        a.other_changes.iter().map(|c| c.id).collect()
    }

    #[test]
    fn a_row_before_the_window_is_not_listed() {
        let drivers = vec![gpu("2026-10-01T05:00:00Z", Some("1.0"), "2.0", Some(true))];
        let a = look(Since::Today, report(48, read(drivers), read(vec![]), read(vec![])));
        assert!(a.touch_games.is_empty());
        assert!(a.none.contains(&"gpu-driver"));
    }

    #[test]
    fn same_version_reconfigure_rows_are_not_changes() {
        let drivers = vec![gpu("2026-11-19T05:00:00Z", Some("2.0"), "2.0", Some(false))];
        let a = look(Since::ThisWeek, report(8 * 24, read(drivers), read(vec![]), read(vec![])));
        assert!(a.touch_games.is_empty(), "{:?}", a.touch_games);
        // The statement is about version changes only, so it stays true with a same-version row present.
        assert!(a.none.contains(&"gpu-driver"));
    }

    #[test]
    fn an_unknown_earlier_version_is_said_as_an_install_not_a_change() {
        let drivers = vec![gpu("2026-11-19T05:00:00Z", None, "2.0", None)];
        let a = look(Since::ThisWeek, report(8 * 24, read(drivers), read(vec![]), read(vec![])));
        assert_eq!(a.touch_games.len(), 1);
        assert_eq!(a.touch_games[0].id, "gpu-driver-installed");
        assert!(!a.touch_games[0].args.contains_key("from"));
        assert!(!a.none.contains(&"gpu-driver"));
    }

    #[test]
    fn a_complete_read_with_no_events_says_none_for_that_kind_only() {
        let updates = vec![update("2026-11-17T03:00:00Z", Some("KB5050000"), "quality")];
        let a = look(Since::ThisWeek, report(8 * 24, read(vec![]), read(updates), read(vec![])));
        assert_eq!(a.none, vec!["gpu-driver", "programs"], "windows-update has a row, so it is not in none");
        assert!(a.read_all);
        assert!(a.limits.iter().any(|l| l.kind == "driver" && l.code == "classes"));
        assert!(a.limits.iter().any(|l| l.kind == "programs" && l.code == "no-install-date"));
    }

    #[test]
    fn an_unreadable_source_is_a_limit_never_nothing_changed() {
        let r = report(
            8 * 24,
            SourceRead::Unreadable(UnreadableReason::AccessDenied),
            read(vec![]),
            SourceRead::Unreadable(UnreadableReason::RegistryUnreadable),
        );
        let a = look(Since::ThisWeek, r);
        assert!(!a.none.contains(&"gpu-driver") && !a.none.contains(&"programs"), "{:?}", a.none);
        assert_eq!(a.none, vec!["windows-update"]);
        assert!(a.limits.iter().any(|l| l.kind == "driver" && l.code == "access-denied"));
        assert!(a.limits.iter().any(|l| l.kind == "programs" && l.code == "registry"));
        assert!(!a.read_all);
    }

    #[test]
    fn a_partial_read_is_a_limit_never_nothing_changed() {
        let partial = SourceRead::Read(ReadOk {
            events: vec![],
            covered_from: Some(utc("2026-11-18T00:00:00Z")),
            gaps: vec![Gap::RowCapReached],
            notes: vec![],
        });
        let a = look(Since::ThisWeek, report(8 * 24, partial, read(vec![]), read(vec![])));
        assert!(!a.none.contains(&"gpu-driver"));
        let codes: Vec<&str> = a.limits.iter().filter(|l| l.kind == "driver").map(|l| l.code).collect();
        assert!(codes.contains(&"partial-row-cap") && codes.contains(&"partial-coverage"), "{codes:?}");
        assert!(!a.read_all);
    }

    #[test]
    fn a_log_that_starts_inside_the_window_is_a_coverage_limit() {
        let young = SourceRead::Read(ReadOk { events: vec![], covered_from: Some(utc("2026-11-19T00:00:00Z")), gaps: vec![], notes: vec![] });
        let a = look(Since::ThisWeek, report(8 * 24, read(vec![]), young, read(vec![])));
        assert!(!a.none.contains(&"windows-update"));
        let l = a.limits.iter().find(|l| l.kind == "windows-update").unwrap();
        assert_eq!(l.code, "partial-coverage");
        assert_eq!(l.args.get("from").map(String::as_str), Some("2026-11-19T00:00:00Z"));
    }

    #[test]
    fn a_source_that_was_not_asked_is_not_read_and_not_none() {
        let t1 = utc(NOW);
        let r = change_sources::combine(t1 - ChronoDuration::hours(48), t1, vec![(Source::DriverLog, read(vec![]))]).unwrap();
        let a = look(Since::Today, r);
        assert_eq!(a.none, vec!["gpu-driver"]);
        for kind in ["windows-update", "programs"] {
            assert!(a.limits.iter().any(|l| l.kind == kind && l.code == "not-read"), "{kind}");
        }
    }

    #[test]
    fn a_late_or_dead_reader_is_unread_never_empty() {
        let _turn = one_at_a_time();
        let late = first_look_with(Since::ThisWeek, utc(NOW), Duration::from_millis(30), |_, _| {
            std::thread::sleep(Duration::from_millis(400));
            Reading::Unavailable("reader-failed")
        });
        assert!(late.none.is_empty() && !late.read_all);
        for kind in ["driver", "windows-update", "programs"] {
            assert!(late.limits.iter().any(|l| l.kind == kind && l.code == "took-too-long"), "{kind}: {:?}", late.limits);
        }
        // Wait out the slot of the thread that is still sleeping, then a panicking reader is "reader-failed".
        std::thread::sleep(Duration::from_millis(600));
        let dead = first_look_with(Since::ThisWeek, utc(NOW), Duration::from_secs(2), |_, _| panic!("reader died"));
        assert!(dead.limits.iter().any(|l| l.kind == "driver" && l.code == "reader-failed"), "{:?}", dead.limits);
        assert!(dead.none.is_empty());
    }

    /// The reader frees the slot before it hands its answer over, so asking again the moment an answer arrives
    /// is never refused as "took too long" (it was, now and then: the slot was freed after the hand-over).
    /// With the old order this fails within a few reads on a busy PC (which the push check is) and almost never
    /// on an idle one, so a pass on an idle PC alone proves little.
    #[test]
    fn a_read_straight_after_an_answer_finds_the_slot_free() {
        let _turn = one_at_a_time();
        for i in 0..500 {
            // "ran" is an answer only this reader gives: a refused read, a dead reader or a failed start say otherwise.
            let r = read_within(Duration::from_secs(30), || Reading::Unavailable("ran"));
            assert!(matches!(r, Reading::Unavailable("ran")), "read {i} did not run: the slot was still held after the previous answer");
        }
    }

    /// A reader that dies frees the slot as it unwinds, before the waiting side learns it died.
    #[test]
    fn a_read_straight_after_a_dead_reader_finds_the_slot_free() {
        let _turn = one_at_a_time();
        for i in 0..50 {
            let dead = read_within(Duration::from_secs(30), || panic!("reader died"));
            assert!(matches!(dead, Reading::Unavailable("reader-failed")), "read {i}: a dead reader is reader-failed");
            let r = read_within(Duration::from_secs(30), || Reading::Unavailable("ran"));
            assert!(matches!(r, Reading::Unavailable("ran")), "read {i} did not run after a dead reader: its slot was still held");
        }
    }

    /// The same for the crash, mod, fact and history readers, which share `spawn_reader`.
    #[test]
    fn a_slotted_reader_straight_after_an_answer_finds_the_slot_free() {
        static SLOT: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        for i in 0..500 {
            let rx = spawn_reader("paramedic-test-reader", Some(&SLOT), || 1u8)
                .unwrap_or_else(|e| panic!("read {i} was refused ({e}): the slot was still held after the previous answer"))
                .expect("the reader thread starts");
            assert_eq!(rx.recv().expect("the reader answers"), 1);
        }
    }

    #[test]
    fn always_like_this_reads_nothing_and_lists_no_change() {
        let _turn = one_at_a_time();
        let a = first_look_with(Since::Always, utc(NOW), Duration::from_secs(1), |_, _| panic!("no reader may run for 'always'"));
        assert!(!a.changes_listed);
        assert!(a.touch_games.is_empty() && a.other_changes.is_empty() && a.none.is_empty() && a.limits.is_empty());
        assert_eq!(a.told.since, Since::Always);
        assert_eq!(a.told.from, None);
        // Even handed a report, "always" lists nothing.
        let b = look(Since::Always, live_like());
        assert!(b.touch_games.is_empty() && b.other_changes.is_empty());
    }

    #[test]
    fn dont_know_reads_thirty_days() {
        let a = look(Since::DontKnow, report(30 * 24, read(vec![]), read(vec![]), read(vec![])));
        assert_eq!(a.told.hours, Some(720));
        assert_eq!(a.told.from, Some(iso(utc(NOW) - ChronoDuration::days(30))));
    }

    #[test]
    fn nothing_carries_more_than_possible() {
        for since in [Since::Today, Since::ThisWeek, Since::ThisMonth, Since::DontKnow, Since::Always] {
            let a = look(since, live_like());
            for c in a.touch_games.iter().chain(&a.other_changes) {
                assert_eq!(c.confidence, Certainty::Possible, "{c:?}");
                assert_eq!(c.evidence, EvidenceKind::Known);
            }
            let json = serde_json::to_string(&a).unwrap().to_lowercase();
            for banned in ["\"likely\"", "\"measured\"", "\"known\"", "\"mechanism\"", "caus", "issue", "problem"] {
                // `evidence` serialises as "known" by design; every other word must be absent.
                if banned == "\"known\"" {
                    continue;
                }
                assert!(!json.contains(banned), "{banned} in {json}");
            }
        }
    }

    #[test]
    fn programs_carry_day_precision_and_group_by_day() {
        let a = look(Since::ThisWeek, live_like());
        let days: Vec<&Change> = a.other_changes.iter().filter(|c| c.id == "programs-installed").collect();
        assert_eq!(days.len(), 2);
        assert!(days.iter().all(|c| c.precision == "day"));
        assert_eq!(days[0].args.get("count").map(String::as_str), Some("2"));
        assert_eq!(days[0].args.get("names").map(String::as_str), Some("Alpha, Beta"));
        assert_eq!(days[0].args.get("more").map(String::as_str), Some("0"));
        assert_eq!(days[0].at.as_deref(), Some("2026-11-19T00:00:00Z"));
    }

    #[test]
    fn many_programs_in_a_day_show_three_names_and_a_count() {
        let programs: Vec<ChangeEvent> =
            ["A", "B", "C", "D", "E"].iter().map(|n| program("2026-11-19T00:00:00Z", "2026-11-20T00:00:00Z", n)).collect();
        let a = look(Since::ThisWeek, report(8 * 24, read(vec![]), read(vec![]), read(programs)));
        let c = &a.other_changes[0];
        assert_eq!(c.args.get("names").map(String::as_str), Some("A, B, C"));
        assert_eq!(c.args.get("more").map(String::as_str), Some("2"));
    }

    #[test]
    fn minor_windows_updates_are_counted_on_one_line_not_listed() {
        let updates = vec![
            update("2026-11-14T03:00:00Z", Some("KB1"), "definition"),
            update("2026-11-15T03:00:00Z", Some("KB2"), "definition"),
            update("2026-11-16T03:00:00Z", None, "store-app"),
        ];
        let a = look(Since::ThisWeek, report(8 * 24, read(vec![]), read(updates), read(vec![])));
        assert!(a.touch_games.is_empty());
        let minor: Vec<&Change> = a.other_changes.iter().filter(|c| c.id == "updates-minor").collect();
        assert_eq!(minor.len(), 1);
        assert_eq!(minor[0].args.get("n").map(String::as_str), Some("2"));
        assert_eq!(minor[0].args.get("m").map(String::as_str), Some("1"));
        assert_eq!(minor[0].how, "");
        // Only minor updates were seen: "no quality, feature or driver update" is still true and said.
        assert!(a.none.contains(&"windows-update"));
    }

    #[test]
    fn an_unclassified_update_is_counted_and_blocks_the_none_line() {
        let updates = vec![update("2026-11-16T03:00:00Z", Some("KB9"), "")];
        let a = look(Since::ThisWeek, report(8 * 24, read(vec![]), read(updates), read(vec![])));
        let row = a.other_changes.iter().find(|c| c.id == "updates-unclassified").unwrap();
        assert_eq!(row.args.get("kbs").map(String::as_str), Some("KB9"));
        assert!(!a.none.contains(&"windows-update"));
    }

    #[test]
    fn a_driver_class_update_that_is_the_graphics_install_is_folded_into_it() {
        let drivers = vec![gpu("2026-11-19T05:12:26Z", Some("1.0"), "2.0", Some(true))];
        let mut wu = update("2026-11-19T05:12:30Z", Some("KB777"), "driver");
        wu.what.to_version = Some("2.0".into());
        let a = look(Since::ThisWeek, report(8 * 24, read(drivers), read(vec![wu]), read(vec![])));
        assert_eq!(a.touch_games.len(), 1, "{:?}", a.touch_games);
        assert_eq!(a.touch_games[0].args.get("via_update").map(String::as_str), Some("true"));
    }

    #[test]
    fn an_update_row_without_a_kb_has_its_own_id() {
        let updates = vec![update("2026-11-17T03:00:00Z", None, "quality")];
        let a = look(Since::ThisWeek, report(8 * 24, read(vec![]), read(updates), read(vec![])));
        assert_eq!(a.touch_games[0].id, "windows-update-nokb");
    }

    #[test]
    fn game_files_are_said_to_be_unread_not_silent() {
        let a = look(Since::ThisWeek, live_like());
        let l = a.limits.iter().find(|l| l.kind == "game-update").unwrap();
        assert_eq!(l.code, "not-picked");
    }

    // ---- review r1 fixes ------------------------------------------------------------------------

    #[test]
    fn no_update_line_is_never_said_beside_a_driver_row_windows_update_delivered() {
        let drivers = vec![gpu("2026-11-19T05:12:26Z", Some("1.0"), "2.0", Some(true))];
        let mut wu = update("2026-11-19T05:12:30Z", Some("KB777"), "driver");
        wu.what.to_version = Some("2.0".into());
        let a = look(Since::ThisWeek, report(8 * 24, read(drivers), read(vec![wu]), read(vec![])));
        assert_eq!(a.touch_games[0].args.get("via_update").map(String::as_str), Some("true"));
        assert!(!a.none.contains(&"windows-update"), "{:?}", a.none);
        // The same update folded into a graphics row that is not listed (same version) is still a recorded update.
        let drivers = vec![gpu("2026-11-19T05:12:26Z", Some("2.0"), "2.0", Some(false))];
        let mut wu = update("2026-11-19T05:12:30Z", Some("KB777"), "driver");
        wu.what.to_version = Some("2.0".into());
        let b = look(Since::ThisWeek, report(8 * 24, read(drivers), read(vec![wu]), read(vec![])));
        assert!(!b.none.contains(&"windows-update"), "{:?}", b.none);
    }

    #[test]
    fn two_graphics_adapters_are_told_apart_by_maker() {
        let drivers = vec![
            gpu_on(AMD, "2026-11-19T05:12:26Z", Some("1.0"), "2.0", Some(true)),
            gpu_on(INTEL, "2026-11-18T05:00:00Z", Some("30.1"), "31.2", Some(true)),
        ];
        let a = look(Since::ThisWeek, report(8 * 24, read(drivers), read(vec![]), read(vec![])));
        let makers: Vec<Option<&str>> = a.touch_games.iter().map(|c| c.args.get("maker").map(String::as_str)).collect();
        assert_eq!(makers, vec![Some("amd"), Some("intel")]);
    }

    #[test]
    fn one_adapter_has_no_maker_and_an_unlisted_pci_vendor_is_other() {
        let a = look(Since::ThisWeek, report(8 * 24, read(vec![gpu("2026-11-19T05:12:26Z", Some("1.0"), "2.0", Some(true))]), read(vec![]), read(vec![])));
        assert!(!a.touch_games[0].args.contains_key("maker"));
        let odd = "PCI\\VEN_1234&DEV_0001&SUBSYS_1&REV_01";
        let drivers = vec![
            gpu_on(AMD, "2026-11-19T05:12:26Z", Some("1.0"), "2.0", Some(true)),
            gpu_on(odd, "2026-11-18T05:00:00Z", Some("5"), "6", Some(true)),
        ];
        let b = look(Since::ThisWeek, report(8 * 24, read(drivers), read(vec![]), read(vec![])));
        assert_eq!(b.touch_games[1].args.get("maker").map(String::as_str), Some("other"));
        assert_eq!(maker_of("10de"), "nvidia");
    }

    #[test]
    fn a_virtual_display_driver_is_not_your_graphics_driver() {
        let drivers = vec![
            gpu("2026-11-19T05:12:26Z", Some("1.0"), "2.0", Some(true)),
            gpu_on("ROOT\\DISPLAY", "2026-11-19T06:00:00Z", Some("1"), "2", Some(true)),
            gpu_on("ROOT\\DISPLAY", "2026-11-18T06:00:00Z", Some("0"), "1", Some(true)),
        ];
        let a = look(Since::ThisWeek, report(8 * 24, read(drivers), read(vec![]), read(vec![])));
        assert_eq!(a.touch_games.len(), 1, "{:?}", a.touch_games);
        assert!(!a.touch_games[0].args.contains_key("maker"), "a virtual display is not a second graphics adapter");
        let v = a.other_changes.iter().find(|c| c.id == "display-driver-other").unwrap();
        assert_eq!(v.args.get("count").map(String::as_str), Some("2"));
        assert_eq!(v.at.as_deref(), Some("2026-11-19T06:00:00Z"));
    }

    #[test]
    fn only_a_virtual_display_leaves_the_graphics_none_line_true() {
        let drivers = vec![gpu_on("SWD\\REMOTE", "2026-11-19T06:00:00Z", Some("1"), "2", Some(true))];
        let a = look(Since::ThisWeek, report(8 * 24, read(drivers), read(vec![]), read(vec![])));
        assert!(a.touch_games.is_empty());
        assert!(a.none.contains(&"gpu-driver"));
    }

    #[test]
    fn pci_vendor_is_read_from_the_hardware_id() {
        assert_eq!(pci_vendor(AMD).as_deref(), Some("1002"));
        assert_eq!(pci_vendor("pci\\ven_10de&dev_1").as_deref(), Some("10de"));
        assert_eq!(pci_vendor("ROOT\\DISPLAY"), None);
        assert_eq!(pci_vendor("PCI\\VEN_ZZZZ"), None);
    }

    #[test]
    fn a_slot_held_past_the_stale_limit_is_taken_over_and_a_fresh_one_is_not() {
        let slot = AtomicU64::new(0);
        let a = take_slot(&slot, 1_000).expect("free");
        assert!(take_slot(&slot, 1_000 + STALE_SLOT_MS - 1).is_none(), "fresh");
        let b = take_slot(&slot, 1_000 + STALE_SLOT_MS).expect("stale");
        // The old holder finishing late must not free the newer holder's slot.
        let _ = slot.compare_exchange(a, 0, Ordering::AcqRel, Ordering::Acquire);
        assert_eq!(slot.load(Ordering::Acquire), b);
        let _ = slot.compare_exchange(b, 0, Ordering::AcqRel, Ordering::Acquire);
        assert_eq!(slot.load(Ordering::Acquire), 0);
    }

    #[test]
    fn the_outer_wait_outlasts_each_readers_own_budget() {
        assert!(CHANGES_BUDGET >= change_sources::DEFAULT_BUDGET * 2);
    }

    /// Read-only, on THIS PC: the real readers for the whole PC with "this week" and "this month", five
    /// timed runs of the first. Run by hand: `cargo test --lib live_first_look -- --ignored --nocapture`.
    #[test]
    #[ignore = "reads this PC's event logs and registry; run by hand"]
    fn live_first_look_prints_the_answer() {
        // The app's own startup sweep fills the hardware snapshot the facts read; it is run once by hand
        // here, OUTSIDE the engine, so the facts have what they have in the running app.
        let _hw = crate::hardware::collect_hardware();
        println!("LIVE_DISPLAY {:?}", crate::hardware::detect_display_info().map(|d| (d.width, d.height, d.current_refresh_rate_hz, d.max_refresh_rate_hz)));
        println!("LIVE_HW_READY {}", crate::hardware::snapshot_if_ready().is_some());
        let whole = FirstLookGame::WholePc;
        for since in [Since::ThisWeek, Since::ThisMonth] {
            let a = run_with(&whole, since, Utc::now(), CHANGES_BUDGET, REAL, None);
            println!("LIVE_FIRST_LOOK_JSON {}", serde_json::to_string(&a).unwrap());
        }
        // The picked games: a Steam pick when the library lists the name, else the process name as Compy saw it.
        let listing = change_sources::list_steam_games(change_sources::STEAM_LIST_BUDGET);
        let pick = |needle: &str, process: &str| match &listing {
            Ok(l) => match l.games.iter().find(|g| g.name.to_lowercase().contains(needle)) {
                Some(g) => FirstLookGame::Steam { app_id: g.app_id, name: Some(g.name.clone()) },
                None => FirstLookGame::Seen { process: process.into() },
            },
            Err(_) => FirstLookGame::Seen { process: process.into() },
        };
        for (label, sel, since) in [("ROB RUN", pick("rob run", "ROB RUN"), Since::ThisWeek), ("ROB-RUN-always", pick("rob run", "ROB RUN"), Since::Always), ("Wardogs", pick("wardogs", "WardogsClient"), Since::ThisMonth)] {
            println!("LIVE_PICK {label} {sel:?}");
            let a = run_with(&sel, since, Utc::now(), CHANGES_BUDGET, REAL, None);
            println!("LIVE_FIRST_LOOK_GAME_JSON {label} {}", serde_json::to_string(&a).unwrap());
            let mut ms = Vec::new();
            for _ in 0..5 {
                let t = std::time::Instant::now();
                let b = run_with(&sel, since, Utc::now(), CHANGES_BUDGET, REAL, None);
                ms.push(t.elapsed().as_millis());
                assert!(b.limits.iter().all(|l| l.code != "took-too-long"), "a reader ran past the budget: {:?}", b.limits);
            }
            println!("LIVE_FIRST_LOOK_GAME_WALL_MS {label} {ms:?}");
        }
        let mut ms = Vec::new();
        for _ in 0..5 {
            let t = std::time::Instant::now();
            let a = run_with(&whole, Since::ThisWeek, Utc::now(), CHANGES_BUDGET, REAL, None);
            ms.push(t.elapsed().as_millis());
            assert!(a.limits.iter().all(|l| l.code != "took-too-long"), "a reader ran past the budget: {:?}", a.limits);
        }
        println!("LIVE_FIRST_LOOK_WALL_MS_THIS_WEEK {ms:?}");
    }

    #[test]
    fn the_first_look_writes_nothing_and_starts_nothing() {
        // Source-text guard (the pattern of the elevated-helper guard): this file reads Windows' records
        // through change_sources only. Words are assembled so this test does not match itself.
        for src in [include_str!("first_look.rs"), include_str!("first_look/crash_split.rs"), include_str!("first_look/running_now.rs")] {
        let code = src.split("#[cfg(test)]").next().unwrap();
        for banned in [
            ["Command", "::new"].concat(),
            ["fs::", "write"].concat(),
            ["File::", "create"].concat(),
            ["OpenOptions", "::new"].concat(),
            ["detect_and_", "persist"].concat(),
            ["get_game_", "readiness"].concat(),
            ["compy_data_", "dir"].concat(),
        ] {
            assert!(!code.contains(&banned), "the first look's sources must not contain {banned}");
        }
        }
    }

    // ---- S2: the first look for one picked game --------------------------------------------------
    // Every input below is hand-built: no test reads Steam, the registry, a log or a folder.

    fn steam_ev(at: &str, pending: bool) -> ChangeEvent {
        let mut e = ev(
            ChangeKind::GameUpdate,
            ChangeTime::exact(utc(at)),
            ChangeWhat {
                name: Some("ROB RUN".into()),
                id: Some("2000".into()),
                detail: pending.then(|| "an update to build 9 is pending".to_string()),
                ..Default::default()
            },
        );
        e.source = Source::SteamManifest;
        e
    }

    /// A report with the three whole-PC sources empty and Steam's record as given.
    fn game_report(steam: SourceRead) -> ChangeReport {
        let t1 = utc(NOW);
        change_sources::combine(
            t1 - ChronoDuration::hours(8 * 24),
            t1,
            vec![(Source::DriverLog, read(vec![])), (Source::WindowsUpdateLog, read(vec![])), (Source::UninstallKeys, read(vec![])), (Source::SteamManifest, steam)],
        )
        .unwrap()
    }

    fn steam_ctx() -> GameCtx {
        GameCtx {
            name: Some("ROB RUN".into()),
            exe: Some("robrun.exe".into()),
            game_ref: Some(GameRef { steam_app_id: Some(2000), install_dir: Some(r"D:\SteamLibrary\steamapps\common\ROB RUN".into()), launcher: Some("Steam".into()) }),
            steam: SteamState::Found,
        }
    }

    fn steam_only(r: ChangeReport) -> Sources {
        Sources { changes: Some(Reading::Report(Box::new(r))), ..Default::default() }
    }

    fn has_limit(a: &FirstLook, kind: &str, code: &str) -> bool {
        a.limits.iter().any(|l| l.kind == kind && l.code == code)
    }

    #[test]
    fn steams_last_update_inside_the_window_is_one_dated_row_that_touches_games() {
        let a = build_with(Since::ThisWeek, utc(NOW), &steam_ctx(), &steam_only(game_report(read(vec![steam_ev("2026-11-18T09:00:00Z", false)]))));
        assert_eq!(a.game.as_deref(), Some("ROB RUN"));
        let rows: Vec<&Change> = a.touch_games.iter().filter(|c| c.id == "game-files").collect();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].at.as_deref(), Some("2026-11-18T09:00:00Z"));
        assert_eq!(rows[0].args.get("game").map(String::as_str), Some("ROB RUN"));
        assert!(!rows[0].args.contains_key("pending"));
        assert!(a.game_files_since.is_none());
        // Steam keeps only the newest time: an earlier update in the window would not show, and that is said.
        assert!(has_limit(&a, "game-update", "steam-newest-only"));
        assert!(!has_limit(&a, "game-update", "not-picked"));
    }

    #[test]
    fn an_update_steam_has_not_installed_yet_is_flagged_on_the_row() {
        let a = build_with(Since::ThisWeek, utc(NOW), &steam_ctx(), &steam_only(game_report(read(vec![steam_ev("2026-11-18T09:00:00Z", true)]))));
        let row = a.touch_games.iter().find(|c| c.id == "game-files").unwrap();
        assert_eq!(row.args.get("pending").map(String::as_str), Some("true"));
    }

    #[test]
    fn an_update_older_than_the_window_is_steams_record_not_a_row() {
        let a = build_with(Since::ThisWeek, utc(NOW), &steam_ctx(), &steam_only(game_report(read(vec![steam_ev("2026-09-02T09:00:00Z", false)]))));
        assert!(a.touch_games.iter().all(|c| c.id != "game-files"));
        assert_eq!(a.game_files_since.as_deref(), Some("2026-09-02T09:00:00Z"));
    }

    #[test]
    fn a_steam_record_that_could_not_be_read_is_a_limit_never_no_update() {
        let unread = |why| GameCtx { steam: SteamState::Unreadable(why), game_ref: None, ..steam_ctx() };
        let a = build_with(Since::ThisWeek, utc(NOW), &unread(UnreadableReason::SteamUnreadable), &steam_only(game_report(read(vec![]))));
        assert!(has_limit(&a, "game-update", "steam-unreadable"));
        assert!(a.game_files_since.is_none() && a.touch_games.iter().all(|c| c.id != "game-files"));
        assert!(!a.read_all);
        let not_steam = GameCtx { steam: SteamState::NotInSteam, game_ref: None, ..steam_ctx() };
        let a = build_with(Since::ThisWeek, utc(NOW), &not_steam, &steam_only(game_report(read(vec![]))));
        assert!(has_limit(&a, "game-update", "not-steam"));
        assert!(a.game_files_since.is_none());
    }

    fn crash(app: &str, at: &str, path_ok: Option<bool>) -> crate::paramedic::extras::CrashFact {
        crate::paramedic::extras::CrashFact {
            app: app.into(),
            when: utc(at),
            module: Some("UnityPlayer.dll".into()),
            code: Some("0xc0000005".into()),
            version: Some("1.0".into()),
            path_ok,
        }
    }

    fn history(crashes: Vec<crate::paramedic::extras::CrashFact>, partial: bool) -> CrashHistory {
        CrashHistory { crashes, listed: true, partial }
    }

    fn with_crashes(h: CrashHistory, steam: SourceRead) -> FirstLook {
        let mut src = steam_only(game_report(steam));
        src.crashes = CrashRead::Read(h);
        build_with(Since::ThisWeek, utc(NOW), &steam_ctx(), &src)
    }

    /// The crash line and the same-signature sentence's inputs are the measured flow's own (`crash_outcome`).
    #[test]
    fn the_crash_line_is_the_measured_flows_for_the_same_inputs() {
        let h = history(
            vec![crash("robrun.exe", "2026-11-02T10:00:00Z", Some(true)), crash("robrun.exe", "2026-11-05T10:00:00Z", Some(true)), crash("other.exe", "2026-11-06T10:00:00Z", Some(true))],
            false,
        );
        // A dated change after the crashes (Steam's own update on the 18th): the signature line applies.
        let a = with_crashes(h.clone(), read(vec![steam_ev("2026-11-18T09:00:00Z", false)]));
        let CrashOutcome::Line(want) = crash_outcome(&h, CrashMatch::Program("robrun.exe"), Some(utc("2026-11-18T09:00:00Z"))) else { panic!("no line") };
        let got = a.crashes.as_ref().expect("a crash line");
        assert_eq!(got.args, want.args.iter().cloned().collect::<std::collections::BTreeMap<_, _>>());
        assert_eq!(got.args.get("n").map(String::as_str), Some("2"));
        assert!(!got.args.contains_key("partial"));
        let sig = want.signature.clone().expect("the measured flow says same signature here");
        assert_eq!(got.signature_module.as_deref(), Some(sig.0.as_str()));
        assert_eq!(got.signature_before.as_deref(), Some(sig.1.as_str()));
        // No dated change to compare with: the measured flow says no signature line, and so does the first look.
        let a = with_crashes(h, read(vec![]));
        assert!(a.crashes.as_ref().unwrap().signature_module.is_none());
    }

    #[test]
    fn a_partial_crash_read_says_at_least_and_never_none() {
        let a = with_crashes(history(vec![crash("robrun.exe", "2026-11-02T10:00:00Z", Some(true))], true), read(vec![]));
        assert_eq!(a.crashes.as_ref().unwrap().args.get("partial").map(String::as_str), Some("true"));
        let a = with_crashes(history(vec![], true), read(vec![]));
        assert!(a.crashes.is_none() && !a.crashes_none);
        assert!(has_limit(&a, "crashes", "partial"));
        let a = with_crashes(history(vec![], false), read(vec![]));
        assert!(a.crashes_none && a.crashes.is_none());
        assert!(a.limits.iter().all(|l| l.kind != "crashes"));
    }

    #[test]
    fn crash_records_that_could_not_be_listed_or_came_late_are_limits() {
        let mut src = steam_only(game_report(read(vec![])));
        src.crashes = CrashRead::Read(CrashHistory { crashes: vec![], listed: false, partial: false });
        let a = build_with(Since::ThisWeek, utc(NOW), &steam_ctx(), &src);
        assert!(has_limit(&a, "crashes", "unreadable") && !a.crashes_none);
        src.crashes = CrashRead::Unavailable("took-too-long");
        let a = build_with(Since::ThisWeek, utc(NOW), &steam_ctx(), &src);
        assert!(has_limit(&a, "crashes", "took-too-long") && !a.crashes_none);
    }

    /// A pick from Steam has no program name: only reports whose path lies under its folder count, and a report
    /// with no path makes the read partial instead of being counted or ignored.
    #[test]
    fn a_steam_pick_matches_crashes_by_install_folder_only() {
        let by_folder = GameCtx { exe: None, ..steam_ctx() };
        let h = history(vec![crash("robrun.exe", "2026-11-02T10:00:00Z", Some(true)), crash("robrun.exe", "2026-11-03T10:00:00Z", Some(false))], false);
        let mut src = steam_only(game_report(read(vec![])));
        src.crashes = CrashRead::Read(h);
        let a = build_with(Since::ThisWeek, utc(NOW), &by_folder, &src);
        assert_eq!(a.crashes.as_ref().unwrap().args.get("n").map(String::as_str), Some("1"));
        assert!(!a.crashes.as_ref().unwrap().args.contains_key("byName"));
        src.crashes = CrashRead::Read(history(vec![crash("robrun.exe", "2026-11-02T10:00:00Z", None)], false));
        let a = build_with(Since::ThisWeek, utc(NOW), &by_folder, &src);
        assert!(a.crashes.is_none() && !a.crashes_none && has_limit(&a, "crashes", "partial"));
    }

    fn found_mod(name: &'static str, strong: bool, loader: bool, first: Option<&str>, settings: Option<&str>) -> crate::paramedic::mods::ModFound {
        crate::paramedic::mods::ModFound {
            name,
            strong,
            loader_file_present: loader,
            first_seen: first.map(utc),
            settings_changed: settings.map(utc),
            last_log_write: None,
        }
    }

    fn with_mods(m: ModsRead) -> FirstLook {
        let mut src = steam_only(game_report(read(vec![])));
        src.mods = m;
        build_with(Since::ThisWeek, utc(NOW), &steam_ctx(), &src)
    }

    #[test]
    fn a_loader_file_dated_in_the_window_is_a_change_that_touches_games_with_its_dates() {
        let a = with_mods(ModsRead::Read(ModsVerdict::Found(vec![found_mod("OptiScaler", true, true, Some("2026-11-18T10:00:00Z"), Some("2026-11-19T11:00:00Z"))])));
        let row = a.touch_games.iter().find(|c| c.id == "graphics-mod").expect("a row among the changes that touch games");
        assert_eq!(row.at.as_deref(), Some("2026-11-18T10:00:00Z"));
        assert_eq!(row.args.get("name").map(String::as_str), Some("OptiScaler"));
        assert_eq!(row.args.get("date").map(String::as_str), Some("2026-11-18T10:00:00Z"));
        assert_eq!(row.args.get("settings").map(String::as_str), Some("2026-11-19T11:00:00Z"));
        assert!(a.looks_off.is_empty() && !a.mods_none);
        // Possible at most: the file's date is a clue, never a verdict.
        assert_eq!(row.confidence, Certainty::Possible);
    }

    #[test]
    fn a_mod_outside_the_window_or_off_the_exes_folder_is_a_fact_about_the_folder_and_a_settings_date_never_decides() {
        // Created long before the window; its settings file was rewritten inside it (the mod does that itself).
        let a = with_mods(ModsRead::Read(ModsVerdict::Found(vec![found_mod("OptiScaler", true, true, Some("2026-09-01T10:00:00Z"), Some("2026-11-19T10:00:00Z"))])));
        assert!(a.touch_games.iter().all(|c| c.id != "graphics-mod"));
        assert_eq!(a.looks_off.len(), 1);
        assert_eq!(a.looks_off[0].args.get("settings").map(String::as_str), Some("2026-11-19T10:00:00Z"));
        // A loader that is not beside the game's exe gives no timing, even with a date in the window.
        let a = with_mods(ModsRead::Read(ModsVerdict::Found(vec![found_mod("ReShade", true, false, Some("2026-11-18T10:00:00Z"), None)])));
        assert!(a.touch_games.iter().all(|c| c.id != "graphics-mod"));
        assert_eq!(a.looks_off.len(), 1);
    }

    #[test]
    fn a_settings_file_alone_is_one_line_and_no_known_mod_needs_a_complete_scan() {
        let a = with_mods(ModsRead::Read(ModsVerdict::Found(vec![found_mod("ReShade", false, false, Some("2026-10-01T10:00:00Z"), None)])));
        assert_eq!(a.mods_settings_only, vec!["ReShade"]);
        assert!(a.looks_off.is_empty() && a.touch_games.iter().all(|c| c.id != "graphics-mod"));
        let a = with_mods(ModsRead::Read(ModsVerdict::NoKnownMod));
        assert!(a.mods_none);
        // A scan that stopped early is a limit, even when it found nothing.
        let a = with_mods(ModsRead::Read(ModsVerdict::Partly(vec![])));
        assert!(!a.mods_none && has_limit(&a, "mods", "partial"));
        let a = with_mods(ModsRead::Read(ModsVerdict::CouldNotScan(CouldNot::NoInstallFolder)));
        assert!(!a.mods_none && has_limit(&a, "mods", "no-folder"));
        let a = with_mods(ModsRead::Read(ModsVerdict::CouldNotScan(CouldNot::FolderUnreadable)));
        assert!(!a.mods_none && has_limit(&a, "mods", "folder-unreadable"));
        let a = with_mods(ModsRead::Unavailable("took-too-long"));
        assert!(!a.mods_none && has_limit(&a, "mods", "took-too-long"));
    }

    #[test]
    fn the_whole_pc_says_nothing_about_a_game_it_was_not_asked_about() {
        let mut src = steam_only(game_report(read(vec![])));
        src.crashes = CrashRead::Read(history(vec![crash("robrun.exe", "2026-11-02T10:00:00Z", None)], false));
        src.mods = ModsRead::Read(ModsVerdict::NoKnownMod);
        let a = build_with(Since::ThisWeek, utc(NOW), &GameCtx::default(), &src);
        assert!(a.game.is_none() && a.crashes.is_none() && !a.crashes_none && !a.mods_none && a.looks_off.is_empty());
        assert!(has_limit(&a, "game-update", "not-picked"));
    }

    #[test]
    fn a_steam_pick_resolves_against_a_complete_listing_only() {
        let g = |id: u32, name: &str| change_sources::SteamGame { app_id: id, name: name.into(), install_dir: Some(format!(r"D:\Lib\steamapps\common\{name}")), last_updated: None };
        let listing = |games: Vec<change_sources::SteamGame>, complete| change_sources::SteamListing { games, complete };
        let c = resolve_steam(2000, Some("shown".into()), Ok(listing(vec![g(2000, "ROB RUN")], true)));
        assert_eq!((c.name.as_deref(), c.steam.clone()), (Some("ROB RUN"), SteamState::Found));
        assert_eq!(c.game_ref.as_ref().and_then(|r| r.steam_app_id), Some(2000));
        assert!(c.exe.is_none());
        // Not in a COMPLETE listing: not a Steam game. In a cut-short listing or an unreadable one: not known.
        let c = resolve_steam(7, Some("Gone".into()), Ok(listing(vec![g(2000, "ROB RUN")], true)));
        assert_eq!((c.name.as_deref(), c.steam), (Some("Gone"), SteamState::NotInSteam));
        let c = resolve_steam(7, None, Ok(listing(vec![], false)));
        assert_eq!(c.name.as_deref(), Some("Steam game 7"));
        assert!(matches!(c.steam, SteamState::Unreadable(_)));
        let c = resolve_steam(7, Some("Gone".into()), Err(UnreadableReason::SteamNotFound));
        assert!(matches!(c.steam, SteamState::Unreadable(UnreadableReason::SteamNotFound)));
    }

    #[test]
    fn the_games_list_keeps_could_not_read_apart_from_no_games() {
        let g = |id: u32, at: Option<&str>| change_sources::SteamGame { app_id: id, name: format!("G{id}"), install_dir: Some("x".into()), last_updated: at.map(utc) };
        let none = games_dto(Ok(change_sources::SteamListing { games: vec![], complete: true }), &[]);
        assert_eq!((none.read, none.complete, none.games.len()), (true, true, 0));
        let unread = games_dto(Err(UnreadableReason::SteamUnreadable), &[]);
        assert_eq!((unread.read, unread.complete, unread.games.len()), (false, false, 0));
        let part = games_dto(Ok(change_sources::SteamListing { games: vec![g(1, Some("2026-11-18T09:00:00Z")), g(2, None)], complete: false }), &[]);
        assert_eq!((part.read, part.complete), (true, false));
        assert_eq!(part.games[0].last_updated.as_deref(), Some("2026-11-18T09:00:00Z"));
        assert_eq!(part.games[1].last_updated, None);
        // The picker is told no folder: only an id, a name and a time.
        let json = serde_json::to_string(&part).unwrap();
        assert!(!json.contains("install") && !json.contains("\"x\""), "{json}");
    }

    // ---- run_with: the readers side by side, with hand-built readers -------------------------------

    static CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    static CRASH_CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    static MOD_CALLS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

    fn fake_resolve(sel: &FirstLookGame) -> GameCtx {
        match sel {
            FirstLookGame::WholePc => GameCtx::default(),
            _ => steam_ctx(),
        }
    }
    fn fake_changes(t0: DateTime<Utc>, t1: DateTime<Utc>, _g: &GameCtx) -> Reading {
        CALLS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let reads = vec![
            (Source::DriverLog, read(vec![])),
            (Source::WindowsUpdateLog, read(vec![])),
            (Source::UninstallKeys, read(vec![])),
            (Source::SteamManifest, read(vec![steam_ev("2026-11-18T09:00:00Z", false)])),
        ];
        Reading::Report(Box::new(change_sources::combine(t0, t1, reads).unwrap()))
    }
    fn fake_crashes(_g: &GameCtx) -> CrashRead {
        CRASH_CALLS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        CrashRead::Read(history(vec![crash("robrun.exe", "2026-11-02T10:00:00Z", Some(true))], false))
    }
    fn fake_mods(_g: &GameCtx) -> ModsRead {
        MOD_CALLS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        ModsRead::Read(ModsVerdict::NoKnownMod)
    }
    fn slow_crashes(_g: &GameCtx) -> CrashRead {
        std::thread::sleep(Duration::from_millis(900));
        CrashRead::Read(history(vec![], false))
    }
    fn dead_mods(_g: &GameCtx) -> ModsRead {
        panic!("the folder scan stopped");
    }
    fn fake_facts(_g: &GameCtx) -> FactsRead {
        FactsRead::NotRead
    }
    fn fake_history() -> HistoryRead {
        HistoryRead::NotRead
    }
    fn fake_running() -> RunningRead {
        RunningRead::NotRead
    }
    const FAKE: Io = Io { resolve: fake_resolve, changes: fake_changes, crashes: fake_crashes, mods: fake_mods, facts: fake_facts, history: fake_history, running: fake_running };

    fn reset_counts() {
        for c in [&CALLS, &CRASH_CALLS, &MOD_CALLS] {
            c.store(0, std::sync::atomic::Ordering::SeqCst);
        }
    }
    fn count(c: &std::sync::atomic::AtomicUsize) -> usize {
        c.load(std::sync::atomic::Ordering::SeqCst)
    }

    #[test]
    fn a_picked_game_reads_its_steam_record_crashes_and_folder_and_the_whole_pc_reads_neither() {
        let _t = one_at_a_time();
        reset_counts();
        let a = run_with(&FirstLookGame::Seen { process: "robrun.exe".into() }, Since::ThisWeek, utc(NOW), Duration::from_secs(2), FAKE, None);
        assert_eq!((count(&CALLS), count(&CRASH_CALLS), count(&MOD_CALLS)), (1, 1, 1));
        assert!(a.touch_games.iter().any(|c| c.id == "game-files"));
        assert!(a.crashes.is_some() && a.mods_none);
        reset_counts();
        let a = run_with(&FirstLookGame::WholePc, Since::ThisWeek, utc(NOW), Duration::from_secs(2), FAKE, None);
        assert_eq!((count(&CALLS), count(&CRASH_CALLS), count(&MOD_CALLS)), (1, 0, 0));
        assert!(a.game.is_none() && a.crashes.is_none() && !a.mods_none);
    }

    #[test]
    fn always_reads_no_dated_source_but_still_reads_the_picked_games_crashes_and_folder() {
        let _t = one_at_a_time();
        reset_counts();
        let a = run_with(&FirstLookGame::Steam { app_id: 2000, name: Some("ROB RUN".into()) }, Since::Always, utc(NOW), Duration::from_secs(2), FAKE, None);
        assert_eq!((count(&CALLS), count(&CRASH_CALLS), count(&MOD_CALLS)), (0, 1, 1));
        assert!(!a.changes_listed && a.touch_games.is_empty());
        assert!(a.crashes.is_some() && a.mods_none);
    }

    #[test]
    fn a_late_or_dead_reader_is_its_own_limit_and_the_others_still_answer() {
        let _t = one_at_a_time();
        reset_counts();
        let io = Io { crashes: slow_crashes, mods: dead_mods, ..FAKE };
        let started = Instant::now();
        let a = run_with(&FirstLookGame::Seen { process: "robrun.exe".into() }, Since::ThisWeek, utc(NOW), Duration::from_millis(300), io, None);
        assert!(started.elapsed() < Duration::from_millis(850), "the answer waited for a late reader: {:?}", started.elapsed());
        assert!(has_limit(&a, "crashes", "took-too-long") && !a.crashes_none, "{:?}", a.limits);
        assert!(has_limit(&a, "mods", "reader-failed") && !a.mods_none, "{:?}", a.limits);
        // The dated readers still gave their row.
        assert!(a.touch_games.iter().any(|c| c.id == "game-files"));
    }

    // ---- review r1 -------------------------------------------------------------------------------

    fn compy_stamp(title: &str, at: &str) -> crate::history::LedgerStamp {
        crate::history::LedgerStamp { title: title.into(), applied_at: at.into(), rolled_back_at: None, status: "applied".into() }
    }

    /// The crash line's "before the earliest dated change" names the earliest REAL dated change, Compy's own included.
    #[test]
    fn the_crash_reference_date_is_the_earliest_dated_change_including_compys_own() {
        let h = history(vec![crash("robrun.exe", "2026-11-10T10:00:00Z", Some(true)), crash("robrun.exe", "2026-11-12T10:00:00Z", Some(true))], false);
        let mut src = steam_only(game_report(read(vec![steam_ev("2026-11-19T09:00:00Z", false)])));
        src.crashes = CrashRead::Read(h);
        src.history = HistoryRead::Read(Ok(vec![compy_stamp("Enable Windows Game Mode", "2026-11-15T13:44:49Z")]));
        let a = build_with(Since::ThisWeek, utc(NOW), &steam_ctx(), &src);
        assert_eq!(a.crashes.as_ref().unwrap().signature_before.as_deref(), Some("2026-11-15T13:44:49Z"));
        // Without Compy's own change the reference is the Steam row, as before.
        src.history = HistoryRead::Read(Ok(vec![]));
        let a = build_with(Since::ThisWeek, utc(NOW), &steam_ctx(), &src);
        assert_eq!(a.crashes.as_ref().unwrap().signature_before.as_deref(), Some("2026-11-19T09:00:00Z"));
    }

    #[test]
    fn a_mods_file_creation_time_is_not_a_dated_change_for_the_crash_reference() {
        let h = history(vec![crash("robrun.exe", "2026-11-10T10:00:00Z", Some(true)), crash("robrun.exe", "2026-11-12T10:00:00Z", Some(true))], false);
        let mut src = steam_only(game_report(read(vec![steam_ev("2026-11-19T09:00:00Z", false)])));
        src.crashes = CrashRead::Read(h);
        src.mods = ModsRead::Read(ModsVerdict::Found(vec![found_mod("OptiScaler", true, true, Some("2026-11-14T10:00:00Z"), None)]));
        let a = build_with(Since::ThisWeek, utc(NOW), &steam_ctx(), &src);
        assert!(a.touch_games.iter().any(|c| c.id == "graphics-mod"), "the mod row is still listed");
        assert_eq!(a.crashes.as_ref().unwrap().signature_before.as_deref(), Some("2026-11-19T09:00:00Z"));
    }

    #[test]
    fn a_partial_scan_that_found_a_mod_says_it_is_other_mods_that_are_unknown() {
        let mut src = steam_only(game_report(read(vec![])));
        src.mods = ModsRead::Read(ModsVerdict::Partly(vec![found_mod("OptiScaler", true, false, None, None)]));
        let a = build_with(Since::ThisWeek, utc(NOW), &steam_ctx(), &src);
        let l = a.limits.iter().find(|l| l.kind == "mods" && l.code == "partial").expect("a partial line");
        assert_eq!(l.args.get("other").map(String::as_str), Some("true"));
        src.mods = ModsRead::Read(ModsVerdict::Partly(vec![]));
        let a = build_with(Since::ThisWeek, utc(NOW), &steam_ctx(), &src);
        let l = a.limits.iter().find(|l| l.kind == "mods" && l.code == "partial").expect("a partial line");
        assert!(l.args.is_empty());
    }

    #[test]
    fn the_command_boundary_caps_the_recorded_names_before_anything_is_spawned() {
        let mut names: Vec<String> = (0..500).map(|i| format!("Game{i}.exe")).collect();
        names.insert(0, "x".repeat(1_000_000));
        names.insert(1, "y".repeat(261));
        names.insert(2, "  ".into());
        names.insert(3, "GAME0.EXE".into());
        names.insert(4, "game0.exe".into());
        let got = cap_recorded(names);
        assert_eq!(got.len(), RECORDED_MATCHED);
        assert_eq!(got[0], "GAME0.EXE", "the first spelling wins, repeats in any case are dropped");
        assert!(got.iter().all(|n| n.chars().count() <= RECORDED_NAME_MAX && !n.trim().is_empty()));
        assert_eq!(got.iter().filter(|n| n.eq_ignore_ascii_case("game0.exe")).count(), 1);
        // A name of exactly the limit is kept.
        assert_eq!(cap_recorded(vec!["z".repeat(RECORDED_NAME_MAX)]).len(), 1);
    }

    #[test]
    fn folders_compare_equal_through_case_slashes_doubled_and_trailing_separators() {
        assert!(same_folder(r"D:\Lib\\steamapps\common\X", "d:/lib/steamapps/common/x/"));
        assert!(same_folder(r"D:\Lib\", r"d:\lib"));
        assert!(!same_folder(r"D:\Lib\A", r"D:\Lib\B"));
        assert!(!same_folder("", ""));
    }

    #[test]
    fn no_steam_on_this_pc_is_an_empty_list_that_was_read_and_a_real_failure_is_not() {
        let none = games_dto(Err(UnreadableReason::SteamNotFound), &[]);
        assert_eq!((none.read, none.complete, none.games.len()), (true, true, 0));
        for why in [UnreadableReason::SteamUnreadable, UnreadableReason::TimedOutBeforeAnyRecord] {
            assert!(!games_dto(Err(why), &[]).read);
        }
    }

    /// A recorded game and a Steam game of the same name are one only when the recorded game was found in that
    /// very folder; two Steam games of one name stay two and carry their drive letters.
    #[test]
    fn a_steam_entry_is_marked_recorded_only_by_folder_and_carries_its_drive() {
        let g = |id: u32, dir: &str| change_sources::SteamGame { app_id: id, name: "DOOM".into(), install_dir: Some(dir.into()), last_updated: None };
        let l = change_sources::SteamListing { games: vec![g(1, r"D:\Lib\steamapps\common\DOOM"), g(2, r"E:\Lib\steamapps\common\DOOM")], complete: true };
        let dto = games_dto(Ok(l), &[("DOOMx64.exe".to_string(), r"d:\lib\steamapps\common\doom\".to_string())]);
        assert_eq!(dto.games[0].recorded.as_deref(), Some("DOOMx64.exe"));
        assert_eq!(dto.games[1].recorded, None);
        assert_eq!((dto.games[0].drive.as_deref(), dto.games[1].drive.as_deref()), (Some("D"), Some("E")));
        // No recorded game found anywhere: nothing is merged on the name alone.
        let l = change_sources::SteamListing { games: vec![g(1, r"D:\Lib\steamapps\common\DOOM")], complete: true };
        assert_eq!(games_dto(Ok(l), &[]).games[0].recorded, None);
    }

    // ---- S5: the crash records before and after the earliest dated change -------------------------

    #[test]
    fn a_picked_game_with_a_dated_change_gets_the_split_of_its_crash_records_at_that_change() {
        let h = history(
            vec![
                crash("robrun.exe", "2026-11-02T10:00:00Z", Some(true)),
                crash("robrun.exe", "2026-11-05T10:00:00Z", Some(true)),
                crash("robrun.exe", "2026-11-19T10:00:00Z", Some(true)),
                crash("other.exe", "2026-11-01T10:00:00Z", Some(true)),
            ],
            false,
        );
        let a = with_crashes(h, read(vec![steam_ev("2026-11-18T09:00:00Z", false)]));
        let s = a.crashes.as_ref().unwrap().split.as_ref().expect("a split");
        assert_eq!((s.before, s.after, s.gap), (2, 1, None));
        assert_eq!(s.change, "2026-11-18T09:00:00Z");
    }

    #[test]
    fn the_split_sits_beside_the_same_signature_sentence_and_does_not_replace_it() {
        let h = history(vec![crash("robrun.exe", "2026-11-02T10:00:00Z", Some(true)), crash("robrun.exe", "2026-11-19T10:00:00Z", Some(true))], false);
        let a = with_crashes(h, read(vec![steam_ev("2026-11-18T09:00:00Z", false)]));
        let c = a.crashes.as_ref().unwrap();
        assert!(c.signature_module.is_some() && c.signature_before.is_some(), "the existing sentence's inputs are still there");
        assert_eq!(c.split.as_ref().map(|s| (s.before, s.after)), Some((1, 1)));
        // Nothing before the change: the "not the whole story" sentence is not said, and the split says so honestly.
        let h = history(vec![crash("robrun.exe", "2026-11-19T10:00:00Z", Some(true)), crash("robrun.exe", "2026-11-20T10:00:00Z", Some(true))], false);
        let a = with_crashes(h, read(vec![steam_ev("2026-11-18T09:00:00Z", false)]));
        let c = a.crashes.as_ref().unwrap();
        assert!(c.signature_module.is_none());
        assert_eq!(c.split.as_ref().map(|s| (s.before, s.after, s.gap)), Some((0, 2, Some("starts-later"))));
    }

    #[test]
    fn no_dated_change_means_no_split() {
        let h = history(vec![crash("robrun.exe", "2026-11-02T10:00:00Z", Some(true))], false);
        let a = with_crashes(h, read(vec![]));
        assert!(a.crashes.as_ref().unwrap().split.is_none());
    }

    // ---- S4: known programs running now -----------------------------------------------------------

    fn running_of(names: &[&str]) -> RunningRead {
        RunningRead::Read(running_now::from_names(names.iter().copied()))
    }

    #[test]
    fn running_now_is_given_for_the_whole_pc_and_a_picked_game_and_the_same_way_for_always() {
        for (game, since) in [(GameCtx::default(), Since::ThisWeek), (steam_ctx(), Since::ThisWeek), (GameCtx::default(), Since::Always), (steam_ctx(), Since::Always)] {
            let a = build_with(since, utc(NOW), &game, &Sources { running: running_of(&["Medal.exe", "System"]), ..Sources::default() });
            assert_eq!(a.running_now.state, "listed");
            assert_eq!(a.running_now.programs.iter().map(|p| p.name).collect::<Vec<_>>(), vec!["Medal"]);
        }
    }

    #[test]
    fn running_now_asks_nobody_means_not_read_and_an_unread_listing_is_never_none() {
        let a = build_with(Since::ThisWeek, utc(NOW), &GameCtx::default(), &Sources::default());
        assert_eq!(a.running_now.state, "not-read");
        let a = build_with(Since::ThisWeek, utc(NOW), &GameCtx::default(), &Sources { running: running_of(&[]), ..Sources::default() });
        assert_eq!(a.running_now.state, "unread");
        let a = build_with(Since::ThisWeek, utc(NOW), &GameCtx::default(), &Sources { running: running_of(&["System"]), ..Sources::default() });
        assert_eq!(a.running_now.state, "none");
    }

    fn running_listed() -> RunningRead {
        running_of(&["medal.exe", "discord.exe", "obs64.exe"])
    }
    fn running_dead() -> RunningRead {
        panic!("the process listing stopped");
    }

    #[test]
    fn the_command_path_reads_running_now_for_every_choice_and_a_dead_reader_is_its_own_state() {
        let _t = one_at_a_time();
        for sel in [FirstLookGame::WholePc, FirstLookGame::Steam { app_id: 2000, name: Some("ROB RUN".into()) }] {
            for since in [Since::ThisWeek, Since::Always] {
                let io = Io { running: running_listed, ..FAKE };
                let a = run_with(&sel, since, utc(NOW), Duration::from_secs(2), io, None);
                assert_eq!(a.running_now.programs.len(), 3, "{sel:?} {since:?}");
            }
        }
        let io = Io { running: running_dead, ..FAKE };
        let a = run_with(&FirstLookGame::WholePc, Since::ThisWeek, utc(NOW), Duration::from_secs(2), io, None);
        assert_eq!((a.running_now.state, a.running_now.programs.len()), ("reader-failed", 0));
    }

    #[test]
    fn running_now_serialises_no_raw_process_name_through_the_whole_answer() {
        let a = build_with(Since::ThisWeek, utc(NOW), &GameCtx::default(), &Sources { running: running_of(&["Medal.exe", "my-private-tool.exe", "System"]), ..Sources::default() });
        let json = serde_json::to_string(&a).unwrap();
        assert!(json.contains("\"name\":\"Medal\"") && !json.contains("my-private-tool") && !json.contains("Medal.exe"), "{json}");
    }
}
