//! Paramedic M2 - "is there a graphics mod in this game's folder, and since when?" (read-only).
//!
//! A game that suddenly runs differently may have an injected graphics layer beside its exe (an
//! OptiScaler-style upscaler / frame-generation layer, ReShade, Special K, ENB, DXVK). This module
//! finds files of those mods by NAME (and, for one mod, by a DLL's version resource); it never
//! loads, executes, hooks or modifies anything (ARCHITECTURE_LOCKS: no third-party injection; this
//! only looks for someone else's).
//!
//! WHAT THIS MODULE CAN NEVER KNOW: whether a mod is loaded, active or running. It sees files. A file
//! of a mod's own is not proof the mod is installed (a preset pack, an unpacked download, a leftover
//! after an uninstall all put the same files there). So a finding has a `strength`, and a caller may
//! build ONLY these sentences from it (`ModFinding::sentence`, `added_phrase`, `last_log_phrase`):
//! - `Strong` (the mod's own uniquely named loader DLL, or a DLL whose version resource names the
//!   mod): "contains a graphics mod ({name})".
//! - `SettingsOnly` (settings, data, log, cache files, or a runtime DLL that is not itself a loader):
//!   "contains a settings or data file from {name}; Compy can't tell whether the mod itself is installed".
//! - Dates: "added to this folder around {first_seen}" (earliest NTFS creation time of the
//!   non-volatile files), and "the mod's own log was last written on {last_log_write}" (nothing
//!   stronger: it is when something last wrote that file). Never "installed on", "active", "running",
//!   or "caused".
//! - No result is "no mods" except `ModScan::verdict()` = `NoKnownMod`, which means "none of the mods
//!   Compy knows were found in the folders it checked" (`coverage` says which).
//!
//! RULES (each pinned by a test in this file):
//! - Read-only: lists directories, reads at most the first bytes of a small (<= 256 KB) text file, and
//!   reads the PE headers + the version resource of a proxy-named DLL with plain bounds-checked file
//!   reads (<= 512 KiB total per DLL, DLL <= 256 MiB). No Win32 version API, no `LoadLibrary`, nothing
//!   is mapped, loaded or executed; nothing is written or logged. Offline / cloud-placeholder files
//!   are never opened.
//! - Bounded: the folder given plus two levels down, an entry cap and the deadline enforced INSIDE
//!   directory enumeration, a time budget (default 300 ms), at most 8 DLL probes. Reparse points are
//!   never followed.
//! - Only fixed text leaves: the mod's display name, file names from this module's own table (or a
//!   fixed pattern such as "*.dxvk-cache"), dates, and a version matching
//!   `^\d{1,4}(\.\d{1,4}){1,3}(-[A-Za-z0-9]{1,8})?$`. Never a path, a user name or other file text.
//!   `Debug` output of every type that held folder or file names omits them.
//! - A bare proxy DLL (dxgi.dll, winmm.dll, version.dll ...) is NOT evidence: many games and
//!   anti-cheats ship those. Files games ship themselves (nvngx_dlss*.dll, sl.*.dll,
//!   amd_fidelityfx_*) are never evidence.
//! - Never says "no mods" when it could not look: `Unreadable(reason)`, or `Partial` with every reason
//!   (entry cap, time, unreadable sub-folders, skipped reparse points or cloud files, an unprobed DLL,
//!   an exe folder that was not located, ...).
//! - Not referenced by support, evidence-upload, receipt or outbound code, and never reachable from
//!   the elevated helper (pinned below, as for `change_sources`).
//!
//! Parsing is pure and separate from I/O: `match_signatures_at` takes a hand-built listing and
//! `parse_version_block` takes bytes. Not folder mods, so not here: Lossless Scaling and RTSS / MSI
//! Afterburner are separate running apps (a later "running at start" slice).
#![allow(dead_code)] // wired into paramedic in the next commit

use crate::change_sources::{self, SteamLookup, UnreadableReason};
use chrono::{DateTime, TimeZone, Utc};
use serde::Serialize;
use std::collections::VecDeque;
use std::fmt;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime};

/// Hard time budget for one folder scan unless the caller passes another.
pub(crate) const DEFAULT_BUDGET: Duration = Duration::from_millis(300);
/// How many directory levels below the scanned folder are listed (the folder itself is level 0).
const MAX_DEPTH: usize = 2;
/// Most directory entries looked at in one scan. Reaching it makes the scan partial.
const MAX_ENTRIES: usize = 20_000;
/// A text file larger than this is never opened.
const MAX_TEXT_BYTES: u64 = 256 * 1024;
/// Only the first bytes of a text file are read.
const HEAD_BYTES: u64 = 512;
/// Most proxy-named DLLs probed in one scan.
const MAX_DLL_PROBES: usize = 8;
/// A DLL larger than this is never opened.
const MAX_DLL_BYTES: u64 = 256 * 1024 * 1024;
/// Most bytes read from one DLL, whatever its size.
const MAX_READ_TOTAL: usize = 512 * 1024;
/// Most evidence files listed for one mod.
const MAX_EVIDENCE: usize = 12;
/// Windows file attributes: OFFLINE, RECALL_ON_OPEN, RECALL_ON_DATA_ACCESS. Such a file is never opened.
const OFFLINE_ATTRIBUTES: u32 = 0x1000 | 0x40000 | 0x40_0000;

// ---------------------------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------------------------

/// The mods this module knows. Declaration order is the order findings are returned in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ModKind {
    OptiScaler,
    AmdnrNeuralHub,
    ReShade,
    SpecialK,
    Enb,
    Dxvk,
    DlssToFsrBridge,
}

impl ModKind {
    /// The fixed name the user is shown. Never text from a file.
    pub(crate) fn display_name(self) -> &'static str {
        match self {
            ModKind::OptiScaler => "OptiScaler",
            ModKind::AmdnrNeuralHub => "AMDNR / NeuralHub",
            ModKind::ReShade => "ReShade",
            ModKind::SpecialK => "Special K",
            ModKind::Enb => "ENB Series",
            ModKind::Dxvk => "DXVK",
            ModKind::DlssToFsrBridge => "DLSS-to-FSR3 bridge",
        }
    }
}

/// How much a finding proves. See the module docs for the only sentences a caller may build.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Strength {
    /// Files of the mod are here (settings, data, logs, caches, a runtime DLL that is not a loader);
    /// whether the mod itself is installed is unknown.
    SettingsOnly,
    /// The mod's own uniquely named loader DLL, or a DLL whose version resource names the mod.
    Strong,
}

/// What kind of file a piece of evidence is; decides which date it feeds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum EvidenceRole {
    /// An .ini / .conf the user or the mod edits.
    Settings,
    /// A DLL.
    Program,
    /// A large data file.
    Data,
    /// A log or cache the mod rewrites while it runs.
    Log,
}

/// One file that identified a mod. `file_name` is the table's own spelling, not the on-disk text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct EvidenceFile {
    pub file_name: &'static str,
    pub role: EvidenceRole,
    /// NTFS creation time (UTC); `None` when unavailable or implausible (never invented).
    pub created: Option<DateTime<Utc>>,
    /// Last-write time (UTC); `None` when unavailable or implausible.
    pub modified: Option<DateTime<Utc>>,
    pub size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum FindingNote {
    /// A file time before 1990 or more than a day in the future was dropped.
    TimestampRejected,
}

#[derive(Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ModFinding {
    pub kind: ModKind,
    /// Same as `kind.display_name()`.
    pub name: &'static str,
    pub strength: Strength,
    /// A file that COULD load the mod is beside its files: the mod's identified loader, or a bare
    /// DLL name it can load through. Never means the mod is loaded or running.
    pub loader_file_present: bool,
    pub evidence: Vec<EvidenceFile>,
    /// Only a value that matches `^\d{1,4}(\.\d{1,4}){1,3}(-[A-Za-z0-9]{1,8})?$`.
    pub version: Option<String>,
    /// Earliest creation time over the non-volatile evidence (settings, DLLs, data; not logs or caches).
    pub first_seen: Option<DateTime<Utc>>,
    /// Latest modified time over the settings files only.
    pub settings_changed: Option<DateTime<Utc>>,
    /// Latest modified time over the mod's own log / cache files: when something last wrote them.
    pub last_log_write: Option<DateTime<Utc>>,
    pub notes: Vec<FindingNote>,
    /// Folders (relative to the scan root) the evidence was in; used to find a version text beside
    /// it. Private, never serialised, never in `Debug`, and cleared before a scan returns.
    #[serde(skip)]
    dirs: Vec<String>,
}

impl fmt::Debug for ModFinding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ModFinding")
            .field("kind", &self.kind)
            .field("strength", &self.strength)
            .field("loader_file_present", &self.loader_file_present)
            .field("evidence", &self.evidence)
            .field("version", &self.version)
            .field("first_seen", &self.first_seen)
            .field("settings_changed", &self.settings_changed)
            .field("last_log_write", &self.last_log_write)
            .field("notes", &self.notes)
            .finish_non_exhaustive()
    }
}

fn date_text(t: DateTime<Utc>) -> String {
    t.format("%Y-%m-%d").to_string()
}

impl ModFinding {
    /// The only sentence a caller may build from `strength`. Pinned by a test.
    pub(crate) fn sentence(&self) -> String {
        match self.strength {
            Strength::Strong => format!("contains a graphics mod ({})", self.name),
            Strength::SettingsOnly => {
                format!("contains a settings or data file from {}; Compy can't tell whether the mod itself is installed", self.name)
            }
        }
    }

    /// "added to this folder around <date>", from the earliest creation time of the non-volatile files.
    pub(crate) fn added_phrase(&self) -> Option<String> {
        self.first_seen.map(|t| format!("added to this folder around {}", date_text(t)))
    }

    /// "the mod's own log was last written on <date>": when something last wrote its log or cache.
    pub(crate) fn last_log_phrase(&self) -> Option<String> {
        self.last_log_write.map(|t| format!("the mod's own log was last written on {}", date_text(t)))
    }
}

/// Why a scan is incomplete. A scan with reasons is never "all clear".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PartialReason {
    /// The entry cap was reached; the rest of the folder was not listed.
    EntryCap,
    /// The time budget ran out.
    TimeBudget,
    /// Sub-folders (count) that could not be listed.
    SubfoldersUnreadable(usize),
    /// Junctions / symlinks / other reparse points (count) were skipped, not followed.
    ReparsePointsSkipped(usize),
    /// Offline / cloud-placeholder files (count) were listed but never opened.
    CloudOrOfflineSkipped(usize),
    /// More proxy-named DLLs than the probe limit; the rest were not checked.
    DllProbesLimited,
    /// A proxy-named DLL could not be probed (denied, unreadable, over the size gate, malformed).
    DllUnreadable,
    /// The program's folder was asked for by name but no folder holding it was found.
    ExeFolderNotLocated,
    /// The search for the program's folder stopped at a limit.
    ExeSearchLimited(SearchLimit),
    /// More than one folder holds the program (or, with no program named, more than four hold a
    /// game-like one); only the first were scanned.
    MoreExeFoldersNotScanned,
    /// One of several folders asked about could not be read.
    FolderUnreadable,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum SearchLimit {
    Entries,
    Time,
    Depth,
    Unreadable,
}

/// Why nothing could be read. Fixed codes, never Windows' (localised) error text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ModUnreadable {
    FolderMissing,
    FolderUnreadable,
    TimedOutBeforeAnyEntry,
    /// No process name was given.
    NoProcessName,
    /// `change_sources::find_steam_game` found no single Steam install holding the program. It answers
    /// the same for "no install holds it" and "more than one does"; the two cannot be told apart here
    /// without changing that module (not done in this slice).
    NotInSteam,
    /// Steam's own lookup could not be completed (reason from `change_sources`).
    Steam(UnreadableReason),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ScanStatus {
    Complete,
    Partial { reasons: Vec<PartialReason> },
    Unreadable(ModUnreadable),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ExeSearch {
    /// Only the given folder (and two levels below it) was scanned.
    NotAsked,
    /// The folder holding the named program was looked for.
    ForProgram,
    /// No program was named: up to four folders holding a game-like program were looked for.
    AnyGameLikeProgram,
}

/// Which folders a scan actually looked at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub(crate) struct Coverage {
    /// Levels below each scanned folder that were listed (the folder itself is level 0).
    pub levels_below_folder: u8,
    /// Folders scanned besides the given root (the program's own folder, normally).
    pub exe_folders_scanned: u8,
    pub exe_search: ExeSearch,
}

impl Coverage {
    fn root_only() -> Coverage {
        Coverage { levels_below_folder: 2, exe_folders_scanned: 0, exe_search: ExeSearch::NotAsked }
    }
}

/// What a scan found. Read it through [`ModScan::verdict`]: `found` empty says nothing by itself.
#[must_use]
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ModScan {
    status: ScanStatus,
    found: Vec<ModFinding>,
    coverage: Coverage,
}

/// The only sound reading of a scan.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum Verdict<'a> {
    /// Complete, and none of the mods Compy knows were found in the folders it checked (`coverage`).
    /// Never "the game has no mods".
    NoKnownMod { coverage: &'a Coverage },
    /// Complete, and at least one known mod's files were found.
    Found { found: &'a [ModFinding], coverage: &'a Coverage },
    /// Nothing could be read.
    CouldNotScan { reason: &'a ModUnreadable },
    /// A limit stopped the scan; `found` is only what was seen. Never "no mods", even when empty.
    PartlyScanned { reasons: &'a [PartialReason], found: &'a [ModFinding], coverage: &'a Coverage },
}

impl ModScan {
    fn unreadable(why: ModUnreadable, coverage: Coverage) -> ModScan {
        ModScan { status: ScanStatus::Unreadable(why), found: Vec::new(), coverage }
    }

    pub(crate) fn verdict(&self) -> Verdict<'_> {
        match &self.status {
            ScanStatus::Unreadable(reason) => Verdict::CouldNotScan { reason },
            ScanStatus::Partial { reasons } => Verdict::PartlyScanned { reasons, found: &self.found, coverage: &self.coverage },
            ScanStatus::Complete if self.found.is_empty() => Verdict::NoKnownMod { coverage: &self.coverage },
            ScanStatus::Complete => Verdict::Found { found: &self.found, coverage: &self.coverage },
        }
    }
}

/// One file in a listing. Built by the reader, or by hand in tests. `Debug` omits every name.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Entry {
    /// Folder relative to the scanned root, '/'-joined; "" for the root itself.
    pub dir: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub created: Option<DateTime<Utc>>,
    pub modified: Option<DateTime<Utc>>,
    /// Offline / cloud-placeholder: never opened.
    pub offline: bool,
    /// Set by the reader only for a proxy-named DLL whose version resource named a known mod.
    pub product: Option<ModKind>,
}

impl fmt::Debug for Entry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Entry").field("is_dir", &self.is_dir).field("size", &self.size).finish_non_exhaustive()
    }
}

// ---------------------------------------------------------------------------------------------
// The signature table (pure data)
// ---------------------------------------------------------------------------------------------

struct Named {
    /// Lower-case on-disk name that counts as evidence.
    lower: &'static str,
    /// The spelling shown.
    shown: &'static str,
    role: EvidenceRole,
    /// The file is the mod's own uniquely named loader DLL: makes the finding `Strong`.
    own_loader: bool,
}

const fn settings(lower: &'static str, shown: &'static str) -> Named {
    Named { lower, shown, role: EvidenceRole::Settings, own_loader: false }
}

const fn data(lower: &'static str, shown: &'static str) -> Named {
    Named { lower, shown, role: EvidenceRole::Data, own_loader: false }
}

const fn log(lower: &'static str, shown: &'static str) -> Named {
    Named { lower, shown, role: EvidenceRole::Log, own_loader: false }
}

/// A runtime DLL of the mod that is not itself a loader: `SettingsOnly`.
const fn runtime_dll(lower: &'static str, shown: &'static str) -> Named {
    Named { lower, shown, role: EvidenceRole::Program, own_loader: false }
}

const fn loader_dll(lower: &'static str, shown: &'static str) -> Named {
    Named { lower, shown, role: EvidenceRole::Program, own_loader: true }
}

struct Sig {
    kind: ModKind,
    named: &'static [Named],
    /// (lower-case file-name ending, fixed pattern shown); these are logs / caches. The on-disk name
    /// is never shown.
    suffixes: &'static [(&'static str, &'static str)],
    /// Proxy DLL names (lower-case) the mod can load through. Empty: no known loader name.
    loaders: &'static [&'static str],
}

/// `neuralhub_host.dll` is NOT a loader here (so AMDNR is `SettingsOnly` unless something else
/// proves it): the name is unique to NeuralHub, but it comes from one author's two installs on one
/// PC, it is the layer's host runtime rather than a loader, and the leftover where it was seen had no
/// exe and no loader at all, so its presence shows nothing about a loader.
const SIGS: [Sig; 7] = [
    Sig {
        kind: ModKind::OptiScaler,
        named: &[settings("optiscaler.ini", "OptiScaler.ini"), log("optiscaler.log", "OptiScaler.log")],
        suffixes: &[],
        loaders: &["dxgi.dll", "winmm.dll", "version.dll", "dbghelp.dll", "d3d12.dll", "wininet.dll", "winhttp.dll", "nvngx.dll"],
    },
    Sig {
        kind: ModKind::AmdnrNeuralHub,
        named: &[
            settings("neuralhub.ini", "neuralhub.ini"),
            runtime_dll("neuralhub_host.dll", "neuralhub_host.dll"),
            settings("dlssnr_on_amd.ini", "dlssnr_on_amd.ini"),
            log("dlssnr_on_amd.log", "dlssnr_on_amd.log"),
            data("dlssnr_on_amd_weights.bin", "dlssnr_on_amd_weights.bin"),
        ],
        suffixes: &[],
        loaders: &[],
    },
    Sig {
        kind: ModKind::ReShade,
        named: &[
            settings("reshade.ini", "ReShade.ini"),
            settings("reshadepreset.ini", "ReShadePreset.ini"),
            loader_dll("reshade64.dll", "ReShade64.dll"),
            loader_dll("reshade32.dll", "ReShade32.dll"),
        ],
        suffixes: &[],
        loaders: &["dxgi.dll", "d3d9.dll", "d3d10.dll", "d3d11.dll", "d3d12.dll", "opengl32.dll", "ddraw.dll"],
    },
    Sig {
        kind: ModKind::SpecialK,
        named: &[loader_dll("specialk64.dll", "SpecialK64.dll"), loader_dll("specialk32.dll", "SpecialK32.dll")],
        suffixes: &[],
        loaders: &["dxgi.dll", "d3d9.dll", "d3d11.dll", "dinput8.dll"],
    },
    Sig {
        kind: ModKind::Enb,
        named: &[settings("enbseries.ini", "enbseries.ini"), settings("enblocal.ini", "enblocal.ini")],
        suffixes: &[],
        loaders: &["d3d9.dll", "d3d10.dll", "d3d11.dll", "dxgi.dll"],
    },
    Sig {
        kind: ModKind::Dxvk,
        named: &[settings("dxvk.conf", "dxvk.conf")],
        suffixes: &[(".dxvk-cache", "*.dxvk-cache")],
        loaders: &["d3d9.dll", "d3d10core.dll", "d3d11.dll", "dxgi.dll"],
    },
    Sig {
        kind: ModKind::DlssToFsrBridge,
        named: &[
            loader_dll("dlssg_to_fsr3_amd_is_better.dll", "dlssg_to_fsr3_amd_is_better.dll"),
            loader_dll("dlssg_to_fsr3_amd_is_better-3.1.dll", "dlssg_to_fsr3_amd_is_better-3.1.dll"),
        ],
        suffixes: &[],
        loaders: &[],
    },
];

/// The proxy-named DLLs OptiScaler can use, and the only names probed for a version resource. A bare
/// one is never a finding.
const PROXY_DLLS: &[&str] = &["dxgi.dll", "winmm.dll", "version.dll", "dbghelp.dll", "d3d12.dll", "wininet.dll", "winhttp.dll", "nvngx.dll"];

// ---------------------------------------------------------------------------------------------
// Pure matching
// ---------------------------------------------------------------------------------------------

fn proxy_shown(lower: &str) -> Option<&'static str> {
    PROXY_DLLS.iter().copied().find(|p| *p == lower)
}

fn in_list(list: &[&str], lower: &str) -> bool {
    list.contains(&lower)
}

/// Pure: a version Compy will repeat: `^\d{1,4}(\.\d{1,4}){1,3}(-[A-Za-z0-9]{1,8})?$` and nothing else.
fn clean_version(s: &str) -> Option<String> {
    let (numbers, suffix) = match s.split_once('-') {
        Some((n, suffix)) => (n, Some(suffix)),
        None => (s, None),
    };
    let parts: Vec<&str> = numbers.split('.').collect();
    let numbers_ok = (2..=4).contains(&parts.len()) && parts.iter().all(|p| (1..=4).contains(&p.len()) && p.chars().all(|c| c.is_ascii_digit()));
    let suffix_ok = suffix.is_none_or(|x| (1..=8).contains(&x.len()) && x.chars().all(|c| c.is_ascii_alphanumeric()));
    (numbers_ok && suffix_ok).then(|| s.to_string())
}

/// Pure: the version in the first line of an AMDNR attribution text ("NeuralHub 0.8.0 by <author> ...").
/// Only the token after "NeuralHub " is taken, and only if it passes `clean_version`.
fn version_from_attribution(text: &str) -> Option<String> {
    let line = text.trim_start_matches('\u{feff}').lines().next()?.trim_start();
    let head = line.get(..10)?;
    if !head.eq_ignore_ascii_case("neuralhub ") {
        return None;
    }
    clean_version(line.get(10..)?.split_whitespace().next()?)
}

/// What a DLL's version resource says, three strings, each at most 128 UTF-16 units.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct VersionStrings {
    product: String,
    original_filename: String,
    company: String,
}

/// Pure: which known mod a DLL's version-resource strings name. Only OptiScaler's strings are known
/// (measured on a real install: ProductName "OptiScaler", OriginalFilename "OptiScaler.dll"); the
/// company name alone never identifies a mod, and for any other mod nothing is guessed.
fn kind_from_version_strings(v: &VersionStrings) -> Option<ModKind> {
    if v.product.trim().eq_ignore_ascii_case("optiscaler") || v.original_filename.trim().eq_ignore_ascii_case("optiscaler.dll") {
        return Some(ModKind::OptiScaler);
    }
    None
}

fn min_opt(a: Option<DateTime<Utc>>, b: Option<DateTime<Utc>>) -> Option<DateTime<Utc>> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x.min(y)),
        (x, None) | (None, x) => x,
    }
}

fn max_opt(a: Option<DateTime<Utc>>, b: Option<DateTime<Utc>>) -> Option<DateTime<Utc>> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x.max(y)),
        (x, None) | (None, x) => x,
    }
}

/// A time before 1990 or more than a day after `now` is not believed (file times from archives can
/// be 1980-01-01; a wrong clock can put them in the future). `.1` says one was dropped.
fn sane_time(t: Option<DateTime<Utc>>, now: DateTime<Utc>) -> (Option<DateTime<Utc>>, bool) {
    let Some(x) = t else { return (None, false) };
    let floor = Utc.with_ymd_and_hms(1990, 1, 1, 0, 0, 0).single();
    if floor.is_some_and(|f| x < f) || x > now + chrono::Duration::days(1) {
        return (None, true);
    }
    (Some(x), false)
}

/// Recompute the three dates of a finding from its evidence.
fn finalize(f: &mut ModFinding) {
    let by = |role: EvidenceRole| f.evidence.iter().filter(move |e| e.role == role);
    let first_seen = f.evidence.iter().filter(|e| e.role != EvidenceRole::Log).filter_map(|e| e.created).min();
    let settings_changed = by(EvidenceRole::Settings).filter_map(|e| e.modified).max();
    let last_log_write = by(EvidenceRole::Log).filter_map(|e| e.modified).max();
    f.first_seen = first_seen;
    f.settings_changed = settings_changed;
    f.last_log_write = last_log_write;
}

/// Pure: which known mods does this listing show, and how strongly? No I/O; `now` only bounds dates.
///
/// A file counts only by an exact (case-insensitive) name from the table, a fixed name ending
/// (`.dxvk-cache`), or a reader-set `product` from a DLL's version resource. A bare proxy DLL
/// (dxgi.dll ...) and every file a game itself ships (nvngx_dlss*.dll, sl.*.dll ...) never count.
pub(crate) fn match_signatures_at(listing: &[Entry], now: DateTime<Utc>) -> Vec<ModFinding> {
    let mut out = Vec::new();
    for sig in SIGS.iter() {
        let mut evidence: Vec<EvidenceFile> = Vec::new();
        let mut dirs: Vec<String> = Vec::new();
        let mut strong = false;
        let mut notes: Vec<FindingNote> = Vec::new();
        for e in listing.iter().filter(|e| !e.is_dir) {
            let lower = e.name.to_ascii_lowercase();
            let by_product = e.product == Some(sig.kind);
            let hit: Option<(&'static str, EvidenceRole, bool)> = if let Some(n) = sig.named.iter().find(|n| n.lower == lower) {
                Some((n.shown, n.role, n.own_loader))
            } else if let Some((_, shown)) = sig.suffixes.iter().find(|(s, _)| lower.len() > s.len() && lower.ends_with(s)) {
                Some((*shown, EvidenceRole::Log, false))
            } else if by_product {
                Some((proxy_shown(&lower).unwrap_or("(dll)"), EvidenceRole::Program, true))
            } else {
                None
            };
            let Some((shown, role, own_loader)) = hit else { continue };
            strong |= own_loader || by_product;
            if !dirs.contains(&e.dir) {
                dirs.push(e.dir.clone());
            }
            let (created, rc) = sane_time(e.created, now);
            let (modified, rm) = sane_time(e.modified, now);
            if (rc || rm) && !notes.contains(&FindingNote::TimestampRejected) {
                notes.push(FindingNote::TimestampRejected);
            }
            match evidence.iter_mut().find(|x| x.file_name == shown) {
                Some(x) => {
                    if modified > x.modified {
                        x.size = e.size;
                    }
                    x.created = min_opt(x.created, created);
                    x.modified = max_opt(x.modified, modified);
                }
                None => evidence.push(EvidenceFile { file_name: shown, role, created, modified, size: e.size }),
            }
        }
        if evidence.is_empty() {
            continue;
        }
        evidence.sort_by_key(|x| x.file_name);
        evidence.truncate(MAX_EVIDENCE);
        let loader_beside = listing.iter().any(|e| !e.is_dir && dirs.contains(&e.dir) && in_list(sig.loaders, &e.name.to_ascii_lowercase()));
        let mut finding = ModFinding {
            kind: sig.kind,
            name: sig.kind.display_name(),
            strength: if strong { Strength::Strong } else { Strength::SettingsOnly },
            loader_file_present: strong || loader_beside,
            evidence,
            version: None,
            first_seen: None,
            settings_changed: None,
            last_log_write: None,
            notes,
            dirs,
        };
        finalize(&mut finding);
        out.push(finding);
    }
    out
}

/// `match_signatures_at` with the real clock.
pub(crate) fn match_signatures(listing: &[Entry]) -> Vec<ModFinding> {
    match_signatures_at(listing, Utc::now())
}

// ---------------------------------------------------------------------------------------------
// Pure, bounds-checked version-resource reader (no Win32 version API)
// ---------------------------------------------------------------------------------------------

/// Why a version resource could not be read. Typed; nothing here ever panics.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PeError {
    /// Not a PE file this reader supports (not MZ/PE, or neither 32- nor 64-bit).
    NotPe,
    /// A PE with no version resource.
    NoResource,
    /// A structure runs past the end of the file or block.
    Truncated,
    /// An offset, length or count is inconsistent or over a cap.
    Malformed,
    /// The resource data is over the size cap.
    TooLarge,
    TimedOut,
    Io,
}

const MAX_DIR_ENTRIES: usize = 64;
const MAX_SECTIONS: usize = 96;
const MAX_RES_BLOCK: u64 = 64 * 1024;
const MAX_CHILDREN: usize = 64;
const MAX_TABLES: usize = 4;
const MAX_STRING_UNITS: usize = 128;
const MAX_KEY_UNITS: usize = 64;
const RT_VERSION: u32 = 16;
const HIGH_BIT: u32 = 0x8000_0000;

fn le16(b: &[u8], o: usize) -> Result<u16, PeError> {
    let end = o.checked_add(2).ok_or(PeError::Truncated)?;
    let arr: [u8; 2] = b.get(o..end).ok_or(PeError::Truncated)?.try_into().map_err(|_| PeError::Truncated)?;
    Ok(u16::from_le_bytes(arr))
}

fn le32(b: &[u8], o: usize) -> Result<u32, PeError> {
    let end = o.checked_add(4).ok_or(PeError::Truncated)?;
    let arr: [u8; 4] = b.get(o..end).ok_or(PeError::Truncated)?.try_into().map_err(|_| PeError::Truncated)?;
    Ok(u32::from_le_bytes(arr))
}

fn align4(n: usize) -> Result<usize, PeError> {
    n.checked_add(3).map(|v| v & !3).ok_or(PeError::Malformed)
}

/// One VS_VERSIONINFO-style node, located inside the block. All offsets are absolute in the block.
struct Node {
    key: String,
    ty: u16,
    value_start: usize,
    value_len: usize,
    children_start: usize,
    end: usize,
}

/// Parse the header of the node at `start`, which must lie within `limit`.
fn parse_node(b: &[u8], start: usize, limit: usize) -> Result<Node, PeError> {
    if !start.is_multiple_of(4) {
        return Err(PeError::Malformed);
    }
    let w_len = usize::from(le16(b, start)?);
    if w_len < 6 {
        return Err(PeError::Malformed);
    }
    let end = start.checked_add(w_len).ok_or(PeError::Malformed)?;
    if end > limit || end > b.len() {
        return Err(PeError::Malformed);
    }
    let value_len = usize::from(le16(b, start + 2)?);
    let ty = le16(b, start + 4)?;
    let mut k = start + 6;
    let mut key_units: Vec<u16> = Vec::new();
    loop {
        let after = k.checked_add(2).ok_or(PeError::Malformed)?;
        if after > end {
            return Err(PeError::Malformed);
        }
        let u = le16(b, k)?;
        k = after;
        if u == 0 {
            break;
        }
        if key_units.len() >= MAX_KEY_UNITS {
            return Err(PeError::Malformed);
        }
        key_units.push(u);
    }
    let value_start = align4(k)?;
    let value_bytes = match ty {
        0 => value_len,
        1 => value_len.checked_mul(2).ok_or(PeError::Malformed)?,
        _ => return Err(PeError::Malformed),
    };
    // A node with no value may end right after its key (before the padding).
    let value_start = if value_bytes == 0 { value_start.min(end) } else { value_start };
    let value_end = value_start.checked_add(value_bytes).ok_or(PeError::Malformed)?;
    if value_end > end {
        return Err(PeError::Malformed);
    }
    let children_start = align4(value_end)?.min(end);
    Ok(Node { key: String::from_utf16_lossy(&key_units), ty, value_start, value_len, children_start, end })
}

/// The children of `node`, at most `MAX_CHILDREN`, each bounded by the node's end.
fn children(b: &[u8], node: &Node) -> Result<Vec<Node>, PeError> {
    let mut out: Vec<Node> = Vec::new();
    let mut off = node.children_start;
    while off < node.end {
        if out.len() >= MAX_CHILDREN {
            return Err(PeError::Malformed);
        }
        let c = parse_node(b, off, node.end)?;
        off = align4(c.end)?;
        out.push(c);
    }
    Ok(out)
}

/// The text value of a string node: at most `MAX_STRING_UNITS` UTF-16 units, cut at the first NUL.
fn node_text(b: &[u8], n: &Node) -> Result<String, PeError> {
    if n.ty != 1 {
        return Err(PeError::Malformed);
    }
    let units = n.value_len.min(MAX_STRING_UNITS);
    let mut v: Vec<u16> = Vec::new();
    for i in 0..units {
        let at = n.value_start.checked_add(i.checked_mul(2).ok_or(PeError::Malformed)?).ok_or(PeError::Malformed)?;
        let u = le16(b, at)?;
        if u == 0 {
            break;
        }
        v.push(u);
    }
    Ok(String::from_utf16_lossy(&v))
}

/// Pure: the ProductName / OriginalFilename / CompanyName of a VS_VERSIONINFO block. Every offset and
/// length is checked against the block and its parent; counts and string lengths are capped; any
/// inconsistency is a typed error.
fn parse_version_block(b: &[u8]) -> Result<VersionStrings, PeError> {
    let root = parse_node(b, 0, b.len())?;
    if root.key != "VS_VERSION_INFO" {
        return Err(PeError::Malformed);
    }
    let mut out = VersionStrings::default();
    let mut seen_any = false;
    for sfi in children(b, &root)?.into_iter().filter(|c| c.key == "StringFileInfo") {
        for table in children(b, &sfi)?.into_iter().take(MAX_TABLES) {
            for s in children(b, &table)? {
                let slot = match s.key.as_str() {
                    "ProductName" => &mut out.product,
                    "OriginalFilename" => &mut out.original_filename,
                    "CompanyName" => &mut out.company,
                    _ => continue,
                };
                let text = node_text(b, &s)?;
                seen_any = true;
                if slot.is_empty() {
                    *slot = text;
                }
            }
        }
    }
    if seen_any {
        Ok(out)
    } else {
        Err(PeError::NoResource)
    }
}

struct Section {
    va: u64,
    raw_ptr: u64,
    raw_size: u64,
}

/// Reads a PE file by seeking; every read is checked against the file length, the 512 KiB total cap
/// and the deadline; the reads made are recorded.
struct PeReader<'a, R: Read + Seek> {
    src: &'a mut R,
    file_len: u64,
    deadline: Instant,
    total: usize,
    reads: Vec<(u64, usize)>,
}

fn rva_to_offset(sections: &[Section], rva: u64, len: u64) -> Result<u64, PeError> {
    for s in sections {
        if rva < s.va {
            continue;
        }
        let delta = rva - s.va;
        let end = delta.checked_add(len).ok_or(PeError::Malformed)?;
        if end <= s.raw_size {
            return s.raw_ptr.checked_add(delta).ok_or(PeError::Malformed);
        }
    }
    Err(PeError::Malformed)
}

impl<R: Read + Seek> PeReader<'_, R> {
    fn read_at(&mut self, off: u64, len: usize) -> Result<Vec<u8>, PeError> {
        if Instant::now() >= self.deadline {
            return Err(PeError::TimedOut);
        }
        let len64 = u64::try_from(len).map_err(|_| PeError::TooLarge)?;
        let end = off.checked_add(len64).ok_or(PeError::Truncated)?;
        if end > self.file_len {
            return Err(PeError::Truncated);
        }
        let total = self.total.checked_add(len).ok_or(PeError::TooLarge)?;
        if total > MAX_READ_TOTAL {
            return Err(PeError::TooLarge);
        }
        self.src.seek(SeekFrom::Start(off)).map_err(|_| PeError::Io)?;
        let mut buf = vec![0u8; len];
        self.src.read_exact(&mut buf).map_err(|_| PeError::Io)?;
        self.total = total;
        self.reads.push((off, len));
        Ok(buf)
    }

    /// Entries of the resource directory at `dir_off` (relative to the resource base): at most
    /// `MAX_DIR_ENTRIES`, and whether there were more.
    fn dir_entries(&mut self, secs: &[Section], res_rva: u64, res_size: u64, dir_off: u32) -> Result<(Vec<(u32, u32)>, bool), PeError> {
        let dir_off = u64::from(dir_off);
        let hdr_end = dir_off.checked_add(16).ok_or(PeError::Malformed)?;
        if hdr_end > res_size {
            return Err(PeError::Malformed);
        }
        let rva = res_rva.checked_add(dir_off).ok_or(PeError::Malformed)?;
        let h = self.read_at(rva_to_offset(secs, rva, 16)?, 16)?;
        let n = usize::from(le16(&h, 12)?) + usize::from(le16(&h, 14)?);
        let take = n.min(MAX_DIR_ENTRIES);
        if take == 0 {
            return Err(PeError::NoResource);
        }
        let bytes = u64::try_from(take).map_err(|_| PeError::Malformed)?.checked_mul(8).ok_or(PeError::Malformed)?;
        if hdr_end.checked_add(bytes).ok_or(PeError::Malformed)? > res_size {
            return Err(PeError::Malformed);
        }
        let first = rva.checked_add(16).ok_or(PeError::Malformed)?;
        let e = self.read_at(rva_to_offset(secs, first, bytes)?, take * 8)?;
        let mut out = Vec::new();
        for i in 0..take {
            out.push((le32(&e, i * 8)?, le32(&e, i * 8 + 4)?));
        }
        Ok((out, n > MAX_DIR_ENTRIES))
    }

    fn run(&mut self) -> Result<VersionStrings, PeError> {
        let not_pe = |e: PeError| if matches!(e, PeError::Truncated | PeError::Io) { PeError::NotPe } else { e };
        let dos = self.read_at(0, 64).map_err(not_pe)?;
        if dos.get(..2) != Some(b"MZ".as_slice()) {
            return Err(PeError::NotPe);
        }
        let lfanew = u64::from(le32(&dos, 0x3c)?);
        if lfanew < 64 {
            return Err(PeError::NotPe);
        }
        let nt = self.read_at(lfanew, 24).map_err(not_pe)?;
        if nt.get(..4) != Some(b"PE\0\0".as_slice()) {
            return Err(PeError::NotPe);
        }
        let nsec = usize::from(le16(&nt, 6)?);
        let opt_size = usize::from(le16(&nt, 20)?);
        if opt_size < 96 {
            return Err(PeError::NoResource);
        }
        if opt_size > 1024 || nsec == 0 || nsec > MAX_SECTIONS {
            return Err(PeError::Malformed);
        }
        let opt_off = lfanew + 24;
        let opt = self.read_at(opt_off, opt_size)?;
        let (count_at, dirs_at) = match le16(&opt, 0)? {
            0x10b => (92usize, 96usize),
            0x20b => (108, 112),
            _ => return Err(PeError::NotPe),
        };
        if le32(&opt, count_at)? <= 2 {
            return Err(PeError::NoResource);
        }
        let res_rva = u64::from(le32(&opt, dirs_at + 16)?);
        let res_size = u64::from(le32(&opt, dirs_at + 20)?);
        if res_rva == 0 || res_size == 0 {
            return Err(PeError::NoResource);
        }
        let sec_off = opt_off.checked_add(u64::try_from(opt_size).map_err(|_| PeError::Malformed)?).ok_or(PeError::Malformed)?;
        let st = self.read_at(sec_off, nsec * 40)?;
        let mut secs = Vec::new();
        for i in 0..nsec {
            secs.push(Section {
                va: u64::from(le32(&st, i * 40 + 12)?),
                raw_size: u64::from(le32(&st, i * 40 + 16)?),
                raw_ptr: u64::from(le32(&st, i * 40 + 20)?),
            });
        }
        // Depth is exactly three: type -> name -> language -> data. No recursion.
        let (l1, over1) = self.dir_entries(&secs, res_rva, res_size, 0)?;
        let Some(&(_, to_names)) = l1.iter().find(|(name, _)| *name == RT_VERSION) else {
            return Err(if over1 { PeError::Malformed } else { PeError::NoResource });
        };
        if to_names & HIGH_BIT == 0 {
            return Err(PeError::Malformed);
        }
        let (l2, _) = self.dir_entries(&secs, res_rva, res_size, to_names & !HIGH_BIT)?;
        let &(_, to_langs) = l2.first().ok_or(PeError::NoResource)?;
        if to_langs & HIGH_BIT == 0 {
            return Err(PeError::Malformed);
        }
        let (l3, _) = self.dir_entries(&secs, res_rva, res_size, to_langs & !HIGH_BIT)?;
        let &(_, to_data) = l3.first().ok_or(PeError::NoResource)?;
        if to_data & HIGH_BIT != 0 {
            return Err(PeError::Malformed);
        }
        let de_off = u64::from(to_data);
        if de_off.checked_add(16).ok_or(PeError::Malformed)? > res_size {
            return Err(PeError::Malformed);
        }
        let de_rva = res_rva.checked_add(de_off).ok_or(PeError::Malformed)?;
        let de = self.read_at(rva_to_offset(&secs, de_rva, 16)?, 16)?;
        let data_rva = u64::from(le32(&de, 0)?);
        let data_size = u64::from(le32(&de, 4)?);
        if data_size == 0 {
            return Err(PeError::NoResource);
        }
        if data_size > MAX_RES_BLOCK {
            return Err(PeError::TooLarge);
        }
        let res_end = res_rva.checked_add(res_size).ok_or(PeError::Malformed)?;
        if data_rva < res_rva || data_rva.checked_add(data_size).ok_or(PeError::Malformed)? > res_end {
            return Err(PeError::Malformed);
        }
        let block = self.read_at(rva_to_offset(&secs, data_rva, data_size)?, usize::try_from(data_size).map_err(|_| PeError::TooLarge)?)?;
        parse_version_block(&block)
    }
}

/// Read the version strings of the PE image in `src` (`file_len` bytes long). Also returns every read
/// made (offset, length), so callers can check the bounds and the byte count.
fn read_version_resource<R: Read + Seek>(src: &mut R, file_len: u64, deadline: Instant) -> (Result<VersionStrings, PeError>, Vec<(u64, usize)>) {
    let mut p = PeReader { src, file_len, deadline, total: 0, reads: Vec::new() };
    let r = p.run();
    (r, p.reads)
}

// ---------------------------------------------------------------------------------------------
// The walk (bounded, no reparse points, cap and deadline enforced while listing)
// ---------------------------------------------------------------------------------------------

/// One directory entry as the walk sees it. No `Debug`: it holds a name.
#[derive(Clone)]
struct RawEntry {
    name: String,
    is_dir: bool,
    /// A junction, symlink or other reparse point: counted as skipped, never followed.
    is_link: bool,
    /// Offline / cloud placeholder: listed by name, never opened.
    offline: bool,
    size: u64,
    created: Option<SystemTime>,
    modified: Option<SystemTime>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stop {
    Cap,
    Time,
}

/// One directory's entries, whether some entry could not be read, and whether listing stopped early.
struct RawDir {
    entries: Vec<RawEntry>,
    had_errors: bool,
    stopped: Option<Stop>,
}

/// `Err` when the directory itself could not be listed. Given a folder relative to the root
/// ('/'-joined), the deadline and the most entries it may return.
type RawListing = Result<RawDir, std::io::ErrorKind>;
type ListFn<'a> = &'a dyn Fn(&str, Instant, usize) -> RawListing;

struct Walked {
    listing: Vec<Entry>,
    reasons: Vec<PartialReason>,
}

fn push_reason(reasons: &mut Vec<PartialReason>, r: PartialReason) {
    if !reasons.contains(&r) {
        reasons.push(r);
    }
}

fn status_of(reasons: Vec<PartialReason>) -> ScanStatus {
    if reasons.is_empty() {
        ScanStatus::Complete
    } else {
        ScanStatus::Partial { reasons }
    }
}

fn child_path(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

/// Breadth-first, `MAX_DEPTH` levels, at most `cap` entries, until `deadline` (both enforced while a
/// directory is being listed). Only the root failing is an `Err`.
fn walk(list: ListFn<'_>, deadline: Instant, cap: usize) -> Result<Walked, ModUnreadable> {
    let mut listing: Vec<Entry> = Vec::new();
    let mut reasons: Vec<PartialReason> = Vec::new();
    let mut queue: VecDeque<(String, usize)> = VecDeque::new();
    queue.push_back((String::new(), 0));
    let (mut seen, mut unreadable_dirs, mut links, mut offline) = (0usize, 0usize, 0usize, 0usize);
    'dirs: while let Some((dir, depth)) = queue.pop_front() {
        if Instant::now() >= deadline {
            push_reason(&mut reasons, PartialReason::TimeBudget);
            break;
        }
        let raw = match list(&dir, deadline, cap.saturating_sub(seen)) {
            Ok(r) => r,
            Err(kind) if depth == 0 => {
                return Err(if kind == std::io::ErrorKind::NotFound { ModUnreadable::FolderMissing } else { ModUnreadable::FolderUnreadable });
            }
            Err(_) => {
                unreadable_dirs += 1;
                continue;
            }
        };
        if raw.had_errors {
            unreadable_dirs += 1;
        }
        for r in raw.entries {
            if seen >= cap {
                push_reason(&mut reasons, PartialReason::EntryCap);
                break 'dirs;
            }
            seen += 1;
            if r.is_dir {
                if r.is_link || r.offline {
                    if r.offline {
                        offline += 1;
                    } else {
                        links += 1;
                    }
                } else if depth < MAX_DEPTH {
                    queue.push_back((child_path(&dir, &r.name), depth + 1));
                }
                continue;
            }
            if r.is_link && !r.offline {
                links += 1;
                continue;
            }
            if r.offline {
                offline += 1;
            }
            listing.push(Entry {
                dir: dir.clone(),
                name: r.name,
                is_dir: false,
                size: r.size,
                created: r.created.map(DateTime::<Utc>::from),
                modified: r.modified.map(DateTime::<Utc>::from),
                offline: r.offline,
                product: None,
            });
        }
        match raw.stopped {
            Some(Stop::Cap) => {
                push_reason(&mut reasons, PartialReason::EntryCap);
                break;
            }
            Some(Stop::Time) => {
                push_reason(&mut reasons, PartialReason::TimeBudget);
                break;
            }
            None => {}
        }
    }
    if listing.is_empty() && reasons == [PartialReason::TimeBudget] {
        return Err(ModUnreadable::TimedOutBeforeAnyEntry);
    }
    if unreadable_dirs > 0 {
        reasons.push(PartialReason::SubfoldersUnreadable(unreadable_dirs));
    }
    if links > 0 {
        reasons.push(PartialReason::ReparsePointsSkipped(links));
    }
    if offline > 0 {
        reasons.push(PartialReason::CloudOrOfflineSkipped(offline));
    }
    Ok(Walked { listing, reasons })
}

#[cfg(windows)]
fn attributes_of(md: &std::fs::Metadata) -> (bool, bool) {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    let a = md.file_attributes();
    (a & FILE_ATTRIBUTE_REPARSE_POINT != 0 || md.file_type().is_symlink(), a & OFFLINE_ATTRIBUTES != 0)
}

#[cfg(not(windows))]
fn attributes_of(md: &std::fs::Metadata) -> (bool, bool) {
    (md.file_type().is_symlink(), false)
}

/// List one real directory without following links (`DirEntry::metadata` describes the entry itself),
/// stopping at `cap` entries or the deadline, whichever comes first, while it is still enumerating.
fn list_real(dir: &Path, deadline: Instant, cap: usize) -> RawListing {
    let mut rd = std::fs::read_dir(dir).map_err(|e| e.kind())?;
    let mut out = RawDir { entries: Vec::new(), had_errors: false, stopped: None };
    let mut n = 0usize;
    loop {
        if n.is_multiple_of(256) && Instant::now() >= deadline {
            out.stopped = Some(Stop::Time);
            break;
        }
        let Some(e) = rd.next() else { break };
        if out.entries.len() >= cap {
            out.stopped = Some(Stop::Cap);
            break;
        }
        n += 1;
        let Ok(e) = e else {
            out.had_errors = true;
            continue;
        };
        let Ok(md) = e.metadata() else {
            out.had_errors = true;
            continue;
        };
        let (is_link, offline) = attributes_of(&md);
        out.entries.push(RawEntry {
            name: e.file_name().to_string_lossy().into_owned(),
            is_dir: md.is_dir(),
            is_link,
            offline,
            size: md.len(),
            created: md.created().ok(),
            modified: md.modified().ok(),
        });
    }
    Ok(out)
}

fn rel_path(root: &Path, rel: &str) -> PathBuf {
    let mut p = root.to_path_buf();
    for part in rel.split('/').filter(|s| !s.is_empty()) {
        p.push(part);
    }
    p
}

fn entry_path(root: &Path, e: &Entry) -> PathBuf {
    rel_path(root, &e.dir).join(&e.name)
}

/// The `\\?\` form of an absolute path, so a path over 260 characters can be opened. Anything not
/// absolute, or already extended, is returned unchanged.
fn extended_path(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    if s.starts_with(r"\\?\") || s.starts_with(r"\\.\") {
        return p.to_path_buf();
    }
    if let Some(unc) = s.strip_prefix(r"\\") {
        return PathBuf::from(format!(r"\\?\UNC\{unc}"));
    }
    let b = s.as_bytes();
    if b.len() > 2 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/') {
        return PathBuf::from(format!(r"\\?\{}", s.replace('/', "\\")));
    }
    p.to_path_buf()
}

// ---------------------------------------------------------------------------------------------
// DLL probe
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProbeFailure {
    TooLarge,
    AccessDenied,
    Io,
    Malformed,
    TimedOut,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Probe {
    /// A file with no version resource (or not a PE this reader supports).
    NoResource,
    Read(VersionStrings),
    Failed(ProbeFailure),
}

fn probe_from_error(e: PeError) -> Probe {
    match e {
        PeError::NotPe | PeError::NoResource => Probe::NoResource,
        PeError::Truncated | PeError::Malformed => Probe::Failed(ProbeFailure::Malformed),
        PeError::TooLarge => Probe::Failed(ProbeFailure::TooLarge),
        PeError::TimedOut => Probe::Failed(ProbeFailure::TimedOut),
        PeError::Io => Probe::Failed(ProbeFailure::Io),
    }
}

/// Probe one DLL: the size gate first, then open read-only and read the version resource with
/// bounded seeks. Also returns the bytes read.
fn probe_file(path: &Path, size: u64, deadline: Instant) -> (Probe, usize) {
    if size > MAX_DLL_BYTES {
        return (Probe::Failed(ProbeFailure::TooLarge), 0);
    }
    let mut f = match std::fs::File::open(extended_path(path)) {
        Ok(f) => f,
        Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied => return (Probe::Failed(ProbeFailure::AccessDenied), 0),
        Err(_) => return (Probe::Failed(ProbeFailure::Io), 0),
    };
    let Ok(md) = f.metadata() else { return (Probe::Failed(ProbeFailure::Io), 0) };
    if md.len() > MAX_DLL_BYTES {
        return (Probe::Failed(ProbeFailure::TooLarge), 0);
    }
    let (r, reads) = read_version_resource(&mut f, md.len(), deadline);
    let bytes = reads.iter().map(|(_, l)| *l).sum();
    (r.map_or_else(probe_from_error, Probe::Read), bytes)
}

/// Probe each proxy-named DLL, at most `MAX_DLL_PROBES`, each under the scan deadline. A DLL that
/// could not be probed makes the scan partial; an offline file is skipped (already counted).
fn probe_dlls(root: &Path, listing: &mut [Entry], deadline: Instant, reasons: &mut Vec<PartialReason>) {
    let mut probes = 0usize;
    for e in listing.iter_mut().filter(|e| !e.is_dir && !e.offline) {
        if !in_list(PROXY_DLLS, &e.name.to_ascii_lowercase()) {
            continue;
        }
        if probes >= MAX_DLL_PROBES {
            push_reason(reasons, PartialReason::DllProbesLimited);
            break;
        }
        probes += 1;
        match probe_file(&entry_path(root, e), e.size, deadline).0 {
            Probe::Read(v) => e.product = kind_from_version_strings(&v),
            Probe::NoResource => {}
            Probe::Failed(ProbeFailure::TimedOut) => {
                push_reason(reasons, PartialReason::TimeBudget);
                break;
            }
            Probe::Failed(_) => push_reason(reasons, PartialReason::DllUnreadable),
        }
    }
}

/// The first bytes of a small text file; `None` for a file over the size cap or one that cannot be read.
fn read_head(path: &Path) -> Option<String> {
    let mut f = std::fs::File::open(extended_path(path)).ok()?;
    if f.metadata().ok()?.len() > MAX_TEXT_BYTES {
        return None;
    }
    let mut buf = Vec::new();
    (&mut f).take(HEAD_BYTES).read_to_end(&mut buf).ok()?;
    Some(String::from_utf8_lossy(&buf).into_owned())
}

/// AMDNR names its version only in a small attribution text beside its files.
const ATTRIBUTION_FILES: [&str; 2] = ["attribution.txt", "danielblnc_attribution.txt"];

fn attach_versions(root: &Path, listing: &[Entry], found: &mut [ModFinding], deadline: Instant) {
    for f in found.iter_mut().filter(|f| f.kind == ModKind::AmdnrNeuralHub) {
        let candidates = listing.iter().filter(|e| {
            !e.is_dir && !e.offline && f.dirs.contains(&e.dir) && e.size <= MAX_TEXT_BYTES && in_list(&ATTRIBUTION_FILES, &e.name.to_ascii_lowercase())
        });
        for e in candidates {
            if Instant::now() >= deadline {
                return;
            }
            if let Some(v) = read_head(&entry_path(root, e)).as_deref().and_then(version_from_attribution) {
                f.version = Some(v);
                break;
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Scans
// ---------------------------------------------------------------------------------------------

fn scan_with_deadline(root: &Path, deadline: Instant) -> ModScan {
    let list = |rel: &str, dl: Instant, cap: usize| list_real(&rel_path(root, rel), dl, cap);
    let Walked { mut listing, mut reasons } = match walk(&list, deadline, MAX_ENTRIES) {
        Ok(w) => w,
        Err(why) => return ModScan::unreadable(why, Coverage::root_only()),
    };
    probe_dlls(root, &mut listing, deadline, &mut reasons);
    let mut found = match_signatures(&listing);
    attach_versions(root, &listing, &mut found, deadline);
    for f in &mut found {
        f.dirs.clear();
    }
    ModScan { status: status_of(reasons), found, coverage: Coverage::root_only() }
}

/// Scan one folder (the game exe's folder, normally) and two levels below it. Read-only, bounded by
/// `budget`. `Unreadable` when the folder cannot be read. Its `coverage` says only that folder was
/// looked at: for an install root use `scan_install_folder`.
pub(crate) fn scan_game_folder(root: &Path, budget: Duration) -> ModScan {
    scan_with_deadline(root, Instant::now() + budget)
}

/// What the search for the program's folder found, and every limit it hit.
struct ExeSearchResult {
    dirs: Vec<PathBuf>,
    root_holds: bool,
    more: bool,
    limits: Vec<PartialReason>,
}

/// Directories (other than `root`) below it, at most 5 deep, that hold a file `pred` accepts (given
/// the lower-case file name). Bounded in entries and time; never follows reparse points; reports every
/// limit it hit. With `stop_if_root_holds`, a program in `root` itself ends the search.
fn find_dirs_holding(root: &Path, deadline: Instant, pred: &dyn Fn(&str) -> bool, max_dirs: usize, stop_if_root_holds: bool) -> ExeSearchResult {
    const MAX_FIND_DEPTH: usize = 5;
    const MAX_FIND_ENTRIES: usize = 8000;
    let mut res = ExeSearchResult { dirs: Vec::new(), root_holds: false, more: false, limits: Vec::new() };
    let mut queue: VecDeque<(PathBuf, usize)> = VecDeque::new();
    queue.push_back((root.to_path_buf(), 0));
    let mut seen = 0usize;
    while let Some((dir, depth)) = queue.pop_front() {
        if Instant::now() >= deadline {
            push_reason(&mut res.limits, PartialReason::ExeSearchLimited(SearchLimit::Time));
            break;
        }
        if res.dirs.len() > max_dirs {
            break;
        }
        let raw = match list_real(&dir, deadline, MAX_FIND_ENTRIES.saturating_sub(seen)) {
            Ok(r) => r,
            Err(_) => {
                push_reason(&mut res.limits, PartialReason::ExeSearchLimited(SearchLimit::Unreadable));
                continue;
            }
        };
        if raw.had_errors {
            push_reason(&mut res.limits, PartialReason::ExeSearchLimited(SearchLimit::Unreadable));
        }
        seen += raw.entries.len();
        let mut holds = false;
        for e in raw.entries {
            if e.is_link || (e.offline && e.is_dir) {
                continue;
            }
            if e.is_dir {
                if depth < MAX_FIND_DEPTH {
                    queue.push_back((dir.join(&e.name), depth + 1));
                } else {
                    push_reason(&mut res.limits, PartialReason::ExeSearchLimited(SearchLimit::Depth));
                }
            } else if pred(&e.name.to_ascii_lowercase()) {
                holds = true;
            }
        }
        if holds {
            if depth == 0 {
                res.root_holds = true;
                if stop_if_root_holds {
                    return res;
                }
            } else {
                res.dirs.push(dir);
            }
        }
        match raw.stopped {
            Some(Stop::Cap) => {
                push_reason(&mut res.limits, PartialReason::ExeSearchLimited(SearchLimit::Entries));
                break;
            }
            Some(Stop::Time) => {
                push_reason(&mut res.limits, PartialReason::ExeSearchLimited(SearchLimit::Time));
                break;
            }
            None => {}
        }
    }
    if res.dirs.len() > max_dirs {
        res.more = true;
        res.dirs.truncate(max_dirs);
    }
    res
}

/// A program that looks like a game or its launcher, not an installer, crash reporter or anti-cheat setup.
fn is_game_like_exe(lower: &str) -> bool {
    const NOT: [&str; 10] = ["setup", "redist", "crash", "unins", "handler", "install", "eac", "anticheat", "worker", "dxsetup"];
    lower.ends_with(".exe") && !NOT.iter().any(|n| lower.contains(n))
}

fn merge_finding(found: &mut Vec<ModFinding>, f: ModFinding) {
    let Some(have) = found.iter_mut().find(|x| x.kind == f.kind) else {
        found.push(f);
        return;
    };
    for ev in f.evidence {
        match have.evidence.iter_mut().find(|x| x.file_name == ev.file_name) {
            Some(x) => {
                if ev.modified > x.modified {
                    x.size = ev.size;
                }
                x.created = min_opt(x.created, ev.created);
                x.modified = max_opt(x.modified, ev.modified);
            }
            None => have.evidence.push(ev),
        }
    }
    have.evidence.sort_by_key(|x| x.file_name);
    have.evidence.truncate(MAX_EVIDENCE);
    have.strength = have.strength.max(f.strength);
    have.loader_file_present |= f.loader_file_present;
    have.version = have.version.take().or(f.version);
    for n in f.notes {
        if !have.notes.contains(&n) {
            have.notes.push(n);
        }
    }
    have.dirs.clear();
    finalize(have);
}

/// Combine scans of several folders of one game. Unreadable only when none could be read; `extra`
/// are reasons found while choosing the folders.
fn merge(scans: Vec<ModScan>, extra: Vec<PartialReason>, coverage: Coverage) -> ModScan {
    let mut reasons: Vec<PartialReason> = Vec::new();
    let mut unreadable: Vec<ModUnreadable> = Vec::new();
    let mut readable = 0usize;
    let mut found: Vec<ModFinding> = Vec::new();
    for s in scans {
        match s.status {
            ScanStatus::Unreadable(u) => unreadable.push(u),
            ScanStatus::Partial { reasons: r } => {
                readable += 1;
                for x in r {
                    push_reason(&mut reasons, x);
                }
            }
            ScanStatus::Complete => readable += 1,
        }
        for f in s.found {
            merge_finding(&mut found, f);
        }
    }
    if readable == 0 {
        return ModScan::unreadable(unreadable.into_iter().next().unwrap_or(ModUnreadable::FolderUnreadable), coverage);
    }
    for u in unreadable {
        push_reason(&mut reasons, if u == ModUnreadable::TimedOutBeforeAnyEntry { PartialReason::TimeBudget } else { PartialReason::FolderUnreadable });
    }
    for x in extra {
        push_reason(&mut reasons, x);
    }
    found.sort_by_key(|f| f.kind);
    ModScan { status: status_of(reasons), found, coverage }
}

/// Scan a game's install folder and the folder holding its exe (`exe` when known, otherwise up to
/// four folders that hold a game-like program), one shared time budget. A program folder that was not
/// located, or a search that hit a limit, makes the result `Partial`; `coverage` says what was looked at.
pub(crate) fn scan_install_folder(root: &Path, exe: Option<&str>, budget: Duration) -> ModScan {
    let deadline = Instant::now() + budget;
    let mut scans = vec![scan_with_deadline(root, deadline)];
    let want = exe.map(|e| e.trim().to_ascii_lowercase()).filter(|e| !e.is_empty());
    let (search, kind) = match &want {
        Some(w) => (find_dirs_holding(root, deadline, &|n| n == w.as_str(), 1, true), ExeSearch::ForProgram),
        None => (find_dirs_holding(root, deadline, &is_game_like_exe, 4, false), ExeSearch::AnyGameLikeProgram),
    };
    let mut extra = search.limits;
    if want.is_some() && !search.root_holds && search.dirs.is_empty() {
        push_reason(&mut extra, PartialReason::ExeFolderNotLocated);
    }
    if search.more {
        push_reason(&mut extra, PartialReason::MoreExeFoldersNotScanned);
    }
    let scanned = u8::try_from(search.dirs.len()).unwrap_or(u8::MAX);
    for d in &search.dirs {
        scans.push(scan_with_deadline(d, deadline));
    }
    let coverage = Coverage { levels_below_folder: 2, exe_folders_scanned: scanned, exe_search: kind };
    merge(scans, extra, coverage)
}

/// Scan the Steam install of the game whose process is `process_name`. A game that cannot be matched
/// to exactly one Steam install folder is `Unreadable`, never "no mods".
pub(crate) fn scan_for_process(process_name: &str) -> ModScan {
    scan_for_process_with(process_name, DEFAULT_BUDGET)
}

pub(crate) fn scan_for_process_with(process_name: &str, budget: Duration) -> ModScan {
    let exe = process_name.trim();
    if exe.is_empty() {
        return ModScan::unreadable(ModUnreadable::NoProcessName, Coverage::root_only());
    }
    match change_sources::find_steam_game(exe, change_sources::DEFAULT_BUDGET) {
        SteamLookup::Found(g) => match g.install_dir {
            Some(dir) => scan_install_folder(Path::new(&dir), Some(exe), budget),
            None => ModScan::unreadable(ModUnreadable::NotInSteam, Coverage::root_only()),
        },
        SteamLookup::NotInSteam => ModScan::unreadable(ModUnreadable::NotInSteam, Coverage::root_only()),
        SteamLookup::Unreadable(r) => ModScan::unreadable(ModUnreadable::Steam(r), Coverage::root_only()),
    }
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::Cursor;

    fn t(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    const WHEN: &str = "2026-11-03T21:12:08Z";
    const NOW: &str = "2026-11-20T12:00:00Z";

    /// A listing entry: size, creation time, modified time.
    fn fe(dir: &str, name: &str, size: u64, created: &str, modified: &str) -> Entry {
        Entry { dir: dir.into(), name: name.into(), is_dir: false, size, created: Some(t(created)), modified: Some(t(modified)), offline: false, product: None }
    }

    fn f(dir: &str, name: &str) -> Entry {
        fe(dir, name, 1000, WHEN, WHEN)
    }

    fn product(mut e: Entry, kind: ModKind) -> Entry {
        e.product = Some(kind);
        e
    }

    fn m(l: &[Entry]) -> Vec<ModFinding> {
        match_signatures_at(l, t(NOW))
    }

    fn kinds(found: &[ModFinding]) -> Vec<ModKind> {
        found.iter().map(|x| x.kind).collect()
    }

    fn evidence_names(x: &ModFinding) -> Vec<&'static str> {
        x.evidence.iter().map(|e| e.file_name).collect()
    }

    fn far() -> Instant {
        Instant::now() + Duration::from_secs(60)
    }

    // ---- the table -----------------------------------------------------------------------------

    #[test]
    fn the_table_is_well_formed() {
        for sig in SIGS.iter() {
            for n in sig.named {
                assert_eq!(n.lower, n.lower.to_ascii_lowercase(), "match names are lower-case: {}", n.lower);
                assert!(n.shown.eq_ignore_ascii_case(n.lower), "the shown spelling is the same name: {}", n.shown);
                if n.own_loader {
                    assert_eq!(n.role, EvidenceRole::Program, "only a DLL can be a loader: {}", n.lower);
                }
            }
            for (s, shown) in sig.suffixes {
                assert_eq!(*s, s.to_ascii_lowercase());
                assert!(shown.starts_with('*'));
            }
            for l in sig.loaders {
                assert!(l.ends_with(".dll") && *l == l.to_ascii_lowercase(), "{l}");
            }
        }
        for p in PROXY_DLLS {
            assert!(p.ends_with(".dll") && *p == p.to_ascii_lowercase(), "{p}");
            assert!(SIGS[0].loaders.contains(p), "only names OptiScaler can load through are probed: {p}");
        }
        assert_eq!(PROXY_DLLS.len(), SIGS[0].loaders.len());
        let order: Vec<ModKind> = SIGS.iter().map(|s| s.kind).collect();
        let mut sorted = order.clone();
        sorted.sort();
        sorted.dedup();
        assert_eq!(order, sorted, "SIGS must list each kind once, in enum order");
        // A bare proxy DLL or a file a game ships itself is never named evidence.
        let never = [
            "dxgi.dll", "d3d11.dll", "d3d12.dll", "dinput8.dll", "winmm.dll", "version.dll", "xinput1_3.dll", "opengl32.dll", "nvngx.dll", "nvngx_dlss.dll",
            "nvngx_dlssg.dll", "sl.interposer.dll", "amd_fidelityfx_upscaler_dx12.dll", "d3d12core.dll", "dsound.dll",
        ];
        for sig in SIGS.iter() {
            for n in sig.named {
                assert!(!never.contains(&n.lower), "{} must never be evidence on its own", n.lower);
            }
        }
        // neuralhub_host.dll is a runtime, not a loader: AMDNR is never Strong from files alone.
        let host = SIGS[1].named.iter().find(|n| n.lower == "neuralhub_host.dll").unwrap();
        assert!(!host.own_loader);
    }

    #[test]
    fn every_signature_has_a_positive_case_with_its_strength_role_and_table_spelling() {
        use EvidenceRole::{Data, Log, Program, Settings};
        use Strength::{SettingsOnly, Strong};
        let cases: [(ModKind, &str, &str, Strength, EvidenceRole); 19] = [
            (ModKind::OptiScaler, "OPTISCALER.INI", "OptiScaler.ini", SettingsOnly, Settings),
            (ModKind::OptiScaler, "optiscaler.log", "OptiScaler.log", SettingsOnly, Log),
            (ModKind::AmdnrNeuralHub, "NeuralHub.ini", "neuralhub.ini", SettingsOnly, Settings),
            (ModKind::AmdnrNeuralHub, "neuralhub_host.dll", "neuralhub_host.dll", SettingsOnly, Program),
            (ModKind::AmdnrNeuralHub, "dlssnr_on_amd.ini", "dlssnr_on_amd.ini", SettingsOnly, Settings),
            (ModKind::AmdnrNeuralHub, "dlssnr_on_amd.log", "dlssnr_on_amd.log", SettingsOnly, Log),
            (ModKind::AmdnrNeuralHub, "dlssnr_on_amd_weights.bin", "dlssnr_on_amd_weights.bin", SettingsOnly, Data),
            (ModKind::ReShade, "ReShade.ini", "ReShade.ini", SettingsOnly, Settings),
            (ModKind::ReShade, "ReShadePreset.ini", "ReShadePreset.ini", SettingsOnly, Settings),
            (ModKind::ReShade, "RESHADE64.DLL", "ReShade64.dll", Strong, Program),
            (ModKind::ReShade, "reshade32.dll", "ReShade32.dll", Strong, Program),
            (ModKind::SpecialK, "SpecialK64.dll", "SpecialK64.dll", Strong, Program),
            (ModKind::SpecialK, "SPECIALK32.DLL", "SpecialK32.dll", Strong, Program),
            (ModKind::Enb, "enbseries.ini", "enbseries.ini", SettingsOnly, Settings),
            (ModKind::Enb, "ENBLOCAL.INI", "enblocal.ini", SettingsOnly, Settings),
            (ModKind::Dxvk, "dxvk.conf", "dxvk.conf", SettingsOnly, Settings),
            (ModKind::Dxvk, "My Private Game.exe.dxvk-cache", "*.dxvk-cache", SettingsOnly, Log),
            (ModKind::DlssToFsrBridge, "dlssg_to_fsr3_amd_is_better.dll", "dlssg_to_fsr3_amd_is_better.dll", Strong, Program),
            (ModKind::DlssToFsrBridge, "dlssg_to_fsr3_amd_is_better-3.1.dll", "dlssg_to_fsr3_amd_is_better-3.1.dll", Strong, Program),
        ];
        for (kind, on_disk, shown, strength, role) in cases {
            let found = m(&[f("", "Game.exe"), f("", on_disk)]);
            assert_eq!(found.len(), 1, "{on_disk}: {found:?}");
            let x = &found[0];
            assert_eq!((x.kind, x.name, x.strength), (kind, kind.display_name(), strength), "{on_disk}");
            assert_eq!(evidence_names(x), vec![shown], "{on_disk}");
            assert_eq!(x.evidence[0].role, role, "{on_disk}");
            assert_eq!(x.version, None, "matching alone never invents a version");
            assert_eq!(x.loader_file_present, strength == Strong, "{on_disk}");
        }
        for k in [
            ModKind::OptiScaler,
            ModKind::AmdnrNeuralHub,
            ModKind::ReShade,
            ModKind::SpecialK,
            ModKind::Enb,
            ModKind::Dxvk,
            ModKind::DlssToFsrBridge,
        ] {
            assert!(cases.iter().any(|c| c.0 == k), "{k:?} has no positive case");
        }
        assert!(m(&[f("", ".dxvk-cache")]).is_empty(), "a '.dxvk-cache' with no name before it is not a cache file");
    }

    #[test]
    fn a_proxy_dll_is_evidence_only_when_its_version_resource_names_the_mod() {
        assert!(m(&[f("", "Game.exe"), f("", "dxgi.dll")]).is_empty(), "a bare dxgi.dll is not a mod");
        let found = m(&[f("", "Game.exe"), product(f("", "DXGI.DLL"), ModKind::OptiScaler)]);
        assert_eq!(kinds(&found), vec![ModKind::OptiScaler]);
        assert_eq!(evidence_names(&found[0]), vec!["dxgi.dll"]);
        assert_eq!((found[0].strength, found[0].loader_file_present), (Strength::Strong, true));
    }

    #[test]
    fn only_strong_findings_may_say_a_graphics_mod_and_settings_only_must_say_what_it_saw() {
        let strong = &m(&[f("", "ReShade64.dll")])[0];
        let weak = &m(&[f("", "ReShade.ini"), f("", "d3d11.dll")])[0];
        assert_eq!(strong.sentence(), "contains a graphics mod (ReShade)");
        assert_eq!(weak.sentence(), "contains a settings or data file from ReShade; Compy can't tell whether the mod itself is installed");
        assert!(!weak.sentence().contains("graphics mod"));
        // A game that ships its own d3d11.dll beside ReShade.ini: a loader NAME is there, still SettingsOnly.
        assert_eq!((weak.strength, weak.loader_file_present), (Strength::SettingsOnly, true));
        // Settings only and no loader name anywhere: still SettingsOnly, no loader file.
        let alone = &m(&[f("", "ReShade.ini")])[0];
        assert_eq!((alone.strength, alone.loader_file_present), (Strength::SettingsOnly, false));
        // The same DLL name in another folder says nothing about these settings.
        assert!(!m(&[f("", "ReShade.ini"), f("bin", "dxgi.dll")])[0].loader_file_present);
        // Every kind's settings-only evidence stays SettingsOnly.
        for name in ["OptiScaler.ini", "neuralhub.ini", "dlssnr_on_amd_weights.bin", "enbseries.ini", "dxvk.conf", "g.exe.dxvk-cache"] {
            assert_eq!(m(&[f("", name)])[0].strength, Strength::SettingsOnly, "{name}");
        }
        // No wording promises a running mod.
        for x in [strong, weak, alone] {
            for s in [x.sentence(), x.added_phrase().unwrap_or_default(), x.last_log_phrase().unwrap_or_default()] {
                for banned in ["active", "running", "installed on", "caused", "guarantee"] {
                    assert!(!s.contains(banned) || s.contains("itself is installed"), "{s}");
                }
            }
        }
    }

    // ---- real and hand-built layouts, and the dates --------------------------------------------

    /// The leftover layout on this PC (Phantom Blade Zero, 2026-11-20): names, sizes and the real
    /// modified times; creation times are plausible fixtures (the files were copied in on 11-01/02,
    /// which is why the DLL's modified time is older than its creation time).
    fn pbz_leftover() -> Vec<Entry> {
        let a = "AMDNR-NeuralHub-080";
        vec![
            fe(a, "amdnr-neuralhub-teardown.log", 0, "2026-11-01T20:40:26Z", "2026-11-01T20:40:26Z"),
            fe(a, "ATTRIBUTION.txt", 359, "2026-11-01T20:39:40Z", "2026-11-01T20:39:40Z"),
            fe(a, "dlssnr_on_amd.log", 33_179_052, "2026-11-01T20:40:00Z", "2026-11-03T21:14:16Z"),
            fe(a, "neuralhub.ini", 348, "2026-11-01T20:39:40Z", "2026-11-03T21:12:08Z"),
            fe(a, "neuralhub_host.dll", 101_768_704, "2026-11-01T20:13:00Z", "2026-10-18T11:50:18Z"),
            fe(a, "settings.ini", 26, "2026-11-01T20:39:40Z", "2026-11-01T20:39:40Z"),
            fe("AMDNR-NeuralHub-080/data", "index.ini", 506, "2026-11-01T20:39:40Z", "2026-11-01T20:39:40Z"),
            fe("AMDNR-NeuralHub-080/data", "nvngx_dlss.dll", 58_956_912, "2026-11-01T20:13:54Z", "2026-11-01T20:13:54Z"),
            fe("AMDNR-NeuralHub-080/data", "nvngx_dlssnr.dll", 266_424_944, "2026-11-01T20:39:33Z", "2026-11-01T20:39:33Z"),
            fe("AMDNR-Runtimes/neuralhub080", "nr-profile.ini", 2654, "2026-11-02T10:41:01Z", "2026-11-02T10:41:01Z"),
            fe("AMDNR-Runtimes/runtime-060", "dlssnr_on_amd.ini", 221, "2026-11-02T10:45:00Z", "2026-11-02T10:45:32Z"),
            fe("AMDNR-Runtimes/runtime-060", "dlssnr_on_amd.log", 99_956, "2026-11-02T10:50:00Z", "2026-11-02T10:54:55Z"),
        ]
    }

    #[test]
    fn the_real_amdnr_neuralhub_leftover_is_settings_only_with_honest_dates() {
        let found = m(&pbz_leftover());
        assert_eq!(kinds(&found), vec![ModKind::AmdnrNeuralHub]);
        let x = &found[0];
        assert_eq!(x.name, "AMDNR / NeuralHub");
        assert_eq!(evidence_names(x), vec!["dlssnr_on_amd.ini", "dlssnr_on_amd.log", "neuralhub.ini", "neuralhub_host.dll"]);
        assert_eq!((x.strength, x.loader_file_present), (Strength::SettingsOnly, false));
        // The same log name in two folders is one piece of evidence: earliest creation, latest write.
        let log = x.evidence.iter().find(|e| e.file_name == "dlssnr_on_amd.log").unwrap();
        assert_eq!((log.size, log.created, log.modified), (33_179_052, Some(t("2026-11-01T20:40:00Z")), Some(t("2026-11-03T21:14:16Z"))));
        // first_seen: earliest CREATION over the non-log files (the DLL's modified time, 10-18, is older
        // than its creation, 11-01: it was copied in). Logs are out of it.
        assert_eq!(x.first_seen, Some(t("2026-11-01T20:13:00Z")));
        assert_eq!(x.settings_changed, Some(t("2026-11-03T21:12:08Z")));
        assert_eq!(x.last_log_write, Some(t("2026-11-03T21:14:16Z")), "a log newer than every setting is its own date");
        assert_eq!(x.added_phrase().as_deref(), Some("added to this folder around 2026-11-01"));
        assert_eq!(x.last_log_phrase().as_deref(), Some("the mod's own log was last written on 2026-11-03"));
        assert!(x.evidence.iter().all(|e| !e.file_name.starts_with("nvngx")), "NVIDIA's own files in the data folder are not evidence");
    }

    #[test]
    fn a_wardogs_style_optiscaler_install_beside_the_launcher_is_strong_and_its_neural_layer_is_not() {
        let l = vec![
            fe("", "danielblnc_ATTRIBUTION.txt", 1172, "2026-11-03T21:14:00Z", "2026-11-03T21:14:00Z"),
            fe("", "dlssnr_on_amd_weights.bin", 147_689_451, "2026-11-03T21:14:00Z", "2026-11-03T21:14:00Z"),
            product(fe("", "dxgi.dll", 34_060_912, "2026-11-03T21:14:00Z", "2026-11-03T21:14:00Z"), ModKind::OptiScaler),
            fe("", "OptiScaler.ini", 183_000, "2026-11-02T12:13:00Z", "2026-11-02T12:14:00Z"),
            fe("", "WardogsLauncher-Shipping.exe", 1_339_288, "2026-10-02T23:21:00Z", "2026-10-02T23:21:00Z"),
            fe("OptiScaler", "amd_fidelityfx_upscaler_dx12.dll", 57_664_272, "2026-11-03T21:14:00Z", "2026-11-03T21:14:00Z"),
        ];
        let found = m(&l);
        assert_eq!(kinds(&found), vec![ModKind::OptiScaler, ModKind::AmdnrNeuralHub], "two mods at once, in table order");
        assert_eq!(evidence_names(&found[0]), vec!["OptiScaler.ini", "dxgi.dll"]);
        assert_eq!((found[0].strength, found[0].loader_file_present), (Strength::Strong, true));
        assert_eq!(found[0].first_seen, Some(t("2026-11-02T12:13:00Z")));
        assert_eq!(found[0].settings_changed, Some(t("2026-11-02T12:14:00Z")));
        assert_eq!(found[0].last_log_write, None, "no log was found, so no date is invented");
        assert_eq!(found[1].strength, Strength::SettingsOnly);
        assert_eq!(evidence_names(&found[1]), vec!["dlssnr_on_amd_weights.bin"]);
    }

    #[test]
    fn dates_come_from_the_right_files_and_implausible_times_are_dropped() {
        // A log rewritten after the DLL arrived: first_seen ignores it, last_log_write reports it.
        let l = [
            fe("", "reshade64.dll", 1, "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z"),
            fe("", "ReShade.ini", 1, "2026-10-02T00:00:00Z", "2026-10-09T00:00:00Z"),
            fe("", "g.exe.dxvk-cache", 1, "2026-09-01T00:00:00Z", "2026-11-10T00:00:00Z"),
        ];
        let found = m(&l);
        assert_eq!(kinds(&found), vec![ModKind::ReShade, ModKind::Dxvk]);
        assert_eq!((found[0].first_seen, found[0].settings_changed, found[0].last_log_write), (Some(t("2026-10-01T00:00:00Z")), Some(t("2026-10-09T00:00:00Z")), None));
        assert_eq!((found[1].first_seen, found[1].settings_changed, found[1].last_log_write), (None, None, Some(t("2026-11-10T00:00:00Z"))));
        // An archive-extracted file keeps a 1980 modified time; a wrong clock gives a future one. Both dropped.
        let odd = [
            fe("", "ReShade.ini", 1, "2026-10-02T00:00:00Z", "1980-01-01T00:00:00Z"),
            fe("", "reshadepreset.ini", 1, "2031-01-01T00:00:00Z", "2026-11-21T13:00:00Z"),
        ];
        let x = &m(&odd)[0];
        assert_eq!(x.notes, vec![FindingNote::TimestampRejected]);
        let by_name = |n: &str| x.evidence.iter().find(|e| e.file_name == n).unwrap();
        assert_eq!(by_name("ReShade.ini").modified, None);
        assert_eq!(by_name("ReShadePreset.ini").created, None);
        assert_eq!(by_name("ReShadePreset.ini").modified, None, "more than a day in the future");
        assert_eq!(x.first_seen, Some(t("2026-10-02T00:00:00Z")));
        assert_eq!(x.settings_changed, None);
        // Within a day ahead of now is believed; the exact boundary is a day.
        let edge = fe("", "ReShade.ini", 1, "2026-11-21T11:00:00Z", "2026-11-21T12:00:00Z");
        assert_eq!(m(&[edge])[0].settings_changed, Some(t("2026-11-21T12:00:00Z")));
    }

    #[test]
    fn clean_unreal_and_unity_layouts_and_a_game_that_ships_dxgi_have_no_finding() {
        let unreal = vec![
            f("", "Game.exe"),
            f("Game/Binaries/Win64", "Game-Win64-Shipping.exe"),
            f("Game/Binaries/Win64", "D3D12Core.dll"),
            f("Game/Binaries/Win64", "nvngx_dlss.dll"),
            f("Game/Binaries/Win64", "sl.interposer.dll"),
            f("Game/Binaries/Win64", "amd_fidelityfx_upscaler_dx12.dll"),
            f("Game/Binaries/Win64", "xinput1_3.dll"),
            f("Game/Content/Paks", "pakchunk0-Windows.pak"),
            f("Engine/Binaries/ThirdParty/Ogg", "libogg_64.dll"),
        ];
        assert!(m(&unreal).is_empty());
        let unity = vec![
            f("", "Game.exe"),
            f("", "UnityPlayer.dll"),
            f("", "UnityCrashHandler64.exe"),
            f("", "GameAssembly.dll"),
            f("", "steam_api64.dll"),
            f("Game_Data", "globalgamemanagers"),
            f("Game_Data/Plugins/x86_64", "nvngx_dlss.dll"),
            f("MonoBleedingEdge/EmbedRuntime", "mono-2.0-bdwgc.dll"),
        ];
        assert!(m(&unity).is_empty());
        let legit = [f("", "Game.exe"), f("", "dxgi.dll"), f("", "d3d11.dll"), f("", "dsound.dll"), f("", "winmm.dll"), f("", "version.dll")];
        assert!(m(&legit).is_empty());
    }

    #[test]
    fn two_unrelated_mods_in_one_folder_are_both_reported_in_table_order() {
        let l = [f("", "SpecialK64.dll"), f("", "ReShade.ini"), f("", "OptiScaler.log"), f("", "enblocal.ini")];
        assert_eq!(kinds(&m(&l)), vec![ModKind::OptiScaler, ModKind::ReShade, ModKind::SpecialK, ModKind::Enb]);
    }

    #[test]
    fn directories_are_never_evidence_and_the_same_name_in_many_folders_is_one_piece() {
        let mut dir = f("", "ReShade.ini");
        dir.is_dir = true;
        assert!(m(&[dir]).is_empty());
        let many: Vec<Entry> = (0..100).map(|i| f(&format!("d{i}"), "reshade.ini")).collect();
        assert_eq!(m(&many)[0].evidence.len(), 1);
    }

    // ---- version text ---------------------------------------------------------------------------

    #[test]
    fn versions_are_only_repeated_when_they_match_the_strict_shape() {
        assert_eq!(version_from_attribution("NeuralHub 0.8.0 by someone - DLSS SR / RR / FG\nhttps://x"), Some("0.8.0".into()));
        assert_eq!(version_from_attribution("\u{feff}neuralhub 1.2.3-rc1\r\nmore"), Some("1.2.3-rc1".into()));
        assert_eq!(version_from_attribution("NeuralHub 0.8.0-beta2 by x"), Some("0.8.0-beta2".into()));
        for bad in [
            "",
            "NeuralHub",
            "NeuralHub ",
            "Other 0.8.0",
            "NeuralHub kuya1234 by someone",
            "NeuralHub ../../etc by x",
            "NeuralHub 0.8.0\u{202e} by x",
            "NeuralHub abc by x",
            "NeuralHub 0.8.0.0.0.0.0 by x",
            "NeuralHub \u{e9}\u{e9}1 by x",
            "\nNeuralHub 0.8.0",
        ] {
            assert_eq!(version_from_attribution(bad), None, "{bad:?}");
        }
        for ok in ["0.8", "10.20.30", "1.2.3.4", "1234.5678.1234", "1.2-rc1", "1.2-ABCDEFGH"] {
            assert_eq!(clean_version(ok), Some(ok.to_string()), "{ok}");
        }
        for bad in ["8", "0", "12345.1", "1.12345", "1.2.3.4.5", "1.2-", "1.2-abcdefghi", "1.2-a-b", "1..2", ".1.2", "1.2.", "v1.2", "1.2 3", "1_2", "kuya1234", "1.2-r\u{e9}"] {
            assert_eq!(clean_version(bad), None, "{bad}");
        }
    }

    #[test]
    fn only_a_version_resource_that_names_a_known_mod_identifies_a_dll() {
        let v = |product: &str, orig: &str, company: &str| VersionStrings { product: product.into(), original_filename: orig.into(), company: company.into() };
        assert_eq!(kind_from_version_strings(&v("OptiScaler", "OptiScaler.dll", "nitec")), Some(ModKind::OptiScaler));
        assert_eq!(kind_from_version_strings(&v("  optiscaler ", "", "")), Some(ModKind::OptiScaler));
        assert_eq!(kind_from_version_strings(&v("", "OPTISCALER.DLL", "")), Some(ModKind::OptiScaler));
        assert_eq!(kind_from_version_strings(&v("", "", "nitec")), None, "a company name alone identifies nothing");
        assert_eq!(kind_from_version_strings(&v("Microsoft Windows", "dxgi.dll", "Microsoft")), None);
        assert_eq!(kind_from_version_strings(&v("OptiScaler Fan Club", "x.dll", "")), None);
        assert_eq!(kind_from_version_strings(&v("", "", "")), None);
    }

    // ---- the pure version-resource reader ------------------------------------------------------

    fn utf16z(s: &str) -> Vec<u8> {
        s.encode_utf16().chain(std::iter::once(0)).flat_map(u16::to_le_bytes).collect()
    }

    fn pad4(v: &mut Vec<u8>) {
        while !v.len().is_multiple_of(4) {
            v.push(0);
        }
    }

    /// One VS_VERSIONINFO-style node: header, key, value, children (each 4-byte aligned).
    fn node(key: &str, ty: u16, value: &[u8], value_len: u16, kids: &[Vec<u8>]) -> Vec<u8> {
        let mut v = vec![0, 0];
        v.extend(value_len.to_le_bytes());
        v.extend(ty.to_le_bytes());
        v.extend(utf16z(key));
        pad4(&mut v);
        v.extend(value);
        for k in kids {
            pad4(&mut v);
            v.extend(k);
        }
        let len = u16::try_from(v.len()).unwrap();
        v[..2].copy_from_slice(&len.to_le_bytes());
        v
    }

    fn string_node(key: &str, text: &str) -> Vec<u8> {
        let value = utf16z(text);
        node(key, 1, &value, u16::try_from(value.len() / 2).unwrap(), &[])
    }

    fn version_block(strings: &[(&str, &str)]) -> Vec<u8> {
        let table = node("040904B0", 1, &[], 0, &strings.iter().map(|(k, v)| string_node(k, v)).collect::<Vec<_>>());
        let sfi = node("StringFileInfo", 1, &[], 0, &[table]);
        let translation = node("Translation", 0, &[9, 4, 0xb0, 4], 4, &[]);
        let var = node("VarFileInfo", 1, &[], 0, &[translation]);
        let mut fixed = vec![0u8; 52];
        fixed[..4].copy_from_slice(&0xFEEF_04BDu32.to_le_bytes());
        node("VS_VERSION_INFO", 0, &fixed, 52, &[sfi, var])
    }

    /// A minimal PE image holding `block` as its RT_VERSION resource; offsets of the fields tests patch.
    struct Pe {
        bytes: Vec<u8>,
        opt_size_at: usize,
        nsec_at: usize,
        res_rva_at: usize,
        res_size_at: usize,
        root_entry_at: usize,
        dir2_entry_at: usize,
        dir3_entry_at: usize,
        data_rva_at: usize,
        data_size_at: usize,
        ids_at: usize,
        type_id_at: usize,
    }

    fn put16(b: &mut [u8], at: usize, v: u16) {
        b[at..at + 2].copy_from_slice(&v.to_le_bytes());
    }

    fn put32(b: &mut [u8], at: usize, v: u32) {
        b[at..at + 4].copy_from_slice(&v.to_le_bytes());
    }

    fn build_pe(block: &[u8], pe32: bool) -> Pe {
        const RAW: usize = 0x400;
        let opt_size = if pe32 { 224 } else { 240 };
        let (count_at, dirs_at) = if pe32 { (92, 96) } else { (108, 112) };
        let res_size = 88 + block.len();
        let raw_size = res_size.div_ceil(0x200) * 0x200;
        let mut b = vec![0u8; RAW + raw_size];
        b[..2].copy_from_slice(b"MZ");
        put32(&mut b, 0x3c, 0x40);
        b[0x40..0x44].copy_from_slice(b"PE\0\0");
        put16(&mut b, 0x44, if pe32 { 0x14c } else { 0x8664 });
        put16(&mut b, 0x46, 1);
        put16(&mut b, 0x54, u16::try_from(opt_size).unwrap());
        let opt = 0x58;
        put16(&mut b, opt, if pe32 { 0x10b } else { 0x20b });
        put32(&mut b, opt + count_at, 16);
        put32(&mut b, opt + dirs_at + 16, 0x1000);
        put32(&mut b, opt + dirs_at + 20, u32::try_from(res_size).unwrap());
        let sec = opt + opt_size;
        put32(&mut b, sec + 8, u32::try_from(raw_size).unwrap());
        put32(&mut b, sec + 12, 0x1000);
        put32(&mut b, sec + 16, u32::try_from(raw_size).unwrap());
        put32(&mut b, sec + 20, u32::try_from(RAW).unwrap());
        // Resource tree: root(0) -> names(24) -> languages(48) -> data entry(72) -> block(88).
        put16(&mut b, RAW + 14, 1);
        put32(&mut b, RAW + 16, 16);
        put32(&mut b, RAW + 20, 0x8000_0000 | 24);
        put16(&mut b, RAW + 24 + 14, 1);
        put32(&mut b, RAW + 24 + 16, 1);
        put32(&mut b, RAW + 24 + 20, 0x8000_0000 | 48);
        put16(&mut b, RAW + 48 + 14, 1);
        put32(&mut b, RAW + 48 + 16, 0x409);
        put32(&mut b, RAW + 48 + 20, 72);
        put32(&mut b, RAW + 72, 0x1000 + 88);
        put32(&mut b, RAW + 76, u32::try_from(block.len()).unwrap());
        b[RAW + 88..RAW + 88 + block.len()].copy_from_slice(block);
        Pe {
            bytes: b,
            opt_size_at: 0x54,
            nsec_at: 0x46,
            res_rva_at: opt + dirs_at + 16,
            res_size_at: opt + dirs_at + 20,
            root_entry_at: RAW + 20,
            dir2_entry_at: RAW + 44,
            dir3_entry_at: RAW + 68,
            data_rva_at: RAW + 72,
            data_size_at: RAW + 76,
            ids_at: RAW + 14,
            type_id_at: RAW + 16,
        }
    }

    fn read_pe(bytes: &[u8]) -> (Result<VersionStrings, PeError>, Vec<(u64, usize)>) {
        let len = bytes.len() as u64;
        read_version_resource(&mut Cursor::new(bytes), len, far())
    }

    fn opti_block() -> Vec<u8> {
        version_block(&[("CompanyName", "nitec"), ("ProductName", "OptiScaler"), ("OriginalFilename", "OptiScaler.dll"), ("FileVersion", "0.7.9")])
    }

    #[test]
    fn a_synthetic_block_with_the_optiscaler_product_name_matches_and_a_company_alone_does_not() {
        let v = parse_version_block(&opti_block()).unwrap();
        assert_eq!((v.product.as_str(), v.original_filename.as_str(), v.company.as_str()), ("OptiScaler", "OptiScaler.dll", "nitec"));
        assert_eq!(kind_from_version_strings(&v), Some(ModKind::OptiScaler));
        let company_only = parse_version_block(&version_block(&[("CompanyName", "OptiScaler Team"), ("FileDescription", "x")])).unwrap();
        assert_eq!(company_only.product, "");
        assert_eq!(kind_from_version_strings(&company_only), None);
        // Through a whole PE image, 64-bit and 32-bit.
        for pe32 in [false, true] {
            let pe = build_pe(&opti_block(), pe32);
            let (r, reads) = read_pe(&pe.bytes);
            assert_eq!(kind_from_version_strings(&r.unwrap()), Some(ModKind::OptiScaler), "pe32={pe32}");
            assert!(reads.iter().map(|(_, l)| l).sum::<usize>() < MAX_READ_TOTAL);
        }
    }

    #[test]
    fn strings_are_capped_and_the_first_table_value_wins() {
        let long = "x".repeat(500);
        let v = parse_version_block(&version_block(&[("ProductName", &long)])).unwrap();
        assert_eq!(v.product.len(), MAX_STRING_UNITS);
        let v = parse_version_block(&version_block(&[("ProductName", "A"), ("ProductName", "B")])).unwrap();
        assert_eq!(v.product, "A");
    }

    #[test]
    fn malformed_blocks_are_typed_errors() {
        let good = opti_block();
        assert!(parse_version_block(&good).is_ok());
        // wLength larger than the buffer.
        let mut b = good.clone();
        let len = u16::try_from(good.len() + 100).unwrap();
        b[..2].copy_from_slice(&len.to_le_bytes());
        assert_eq!(parse_version_block(&b).err(), Some(PeError::Malformed));
        // Zero wLength, and one under the header size.
        for tiny in [0u16, 5] {
            let mut b = good.clone();
            b[..2].copy_from_slice(&tiny.to_le_bytes());
            assert_eq!(parse_version_block(&b).err(), Some(PeError::Malformed), "{tiny}");
        }
        // Missing key terminator: the NUL of "VS_VERSION_INFO" replaced.
        let mut b = good.clone();
        let nul_at = 6 + 2 * "VS_VERSION_INFO".len();
        b[nul_at] = b'X';
        assert!(parse_version_block(&b).is_err());
        // A key that never ends within the node.
        let mut b = good.clone();
        for i in (6..good.len().min(300)).step_by(2) {
            b[i] = b'A';
            b[i + 1] = 0;
        }
        assert!(parse_version_block(&b).is_err());
        // Wrong root key.
        assert!(parse_version_block(&node("NOT_VERSION_INFO", 0, &[0; 52], 52, &[])).is_err());
        // A huge child count: 100 tiny children under the root.
        let kids: Vec<Vec<u8>> = (0..100).map(|_| node("", 1, &[], 0, &[])).collect();
        let many = node("VS_VERSION_INFO", 0, &[0; 52], 52, &kids);
        assert_eq!(parse_version_block(&many).err(), Some(PeError::Malformed));
        // A string whose value length claims far more than the node holds.
        let mut b = parse_version_block_bytes_with_value_len(0xFFFF);
        assert_eq!(parse_version_block(&b).err(), Some(PeError::Malformed));
        b.truncate(10);
        assert!(parse_version_block(&b).is_err());
        // An unknown value type.
        let mut b = good.clone();
        b[4] = 7;
        assert_eq!(parse_version_block(&b).err(), Some(PeError::Malformed));
        // Misaligned node offsets and empty input.
        assert_eq!(parse_node(&good, 2, good.len()).err(), Some(PeError::Malformed));
        assert!(parse_version_block(&[]).is_err());
        assert!(parse_version_block(&[0u8; 3]).is_err());
        // No string table at all is "no resource", not a read.
        assert_eq!(parse_version_block(&node("VS_VERSION_INFO", 0, &[0; 52], 52, &[])).err(), Some(PeError::NoResource));
    }

    /// A block whose first string's wValueLength is patched to `n`.
    fn parse_version_block_bytes_with_value_len(n: u16) -> Vec<u8> {
        let mut b = version_block(&[("ProductName", "OptiScaler")]);
        let at = b.windows(2 * "ProductName".len()).position(|w| *w == utf16z("ProductName")[..2 * "ProductName".len()]).unwrap() - 6;
        b[at + 2..at + 4].copy_from_slice(&n.to_le_bytes());
        b
    }

    #[test]
    fn malformed_pe_images_are_typed_errors_and_never_read_outside_the_file() {
        let block = opti_block();
        let base = build_pe(&block, false);
        let check = |name: &str, pe: &Pe, want: PeError| {
            let (r, reads) = read_pe(&pe.bytes);
            assert_eq!(r.err(), Some(want), "{name}");
            for (off, len) in reads {
                assert!(off + len as u64 <= pe.bytes.len() as u64, "{name}: read outside the file");
            }
        };
        let patched = |f: &dyn Fn(&mut Pe)| {
            let mut pe = build_pe(&block, false);
            f(&mut pe);
            pe
        };
        assert!(read_pe(&base.bytes).0.is_ok());
        // A resource directory pointing outside the resource, and outside the file.
        check("root entry outside", &patched(&|p| put32(&mut p.bytes, p.root_entry_at, 0x8000_0000 | 0x7FFF_0000)), PeError::Malformed);
        check("dir2 outside", &patched(&|p| put32(&mut p.bytes, p.dir2_entry_at, 0x8000_0000 | 0x0010_0000)), PeError::Malformed);
        check("res rva outside every section", &patched(&|p| put32(&mut p.bytes, p.res_rva_at, 0x00F0_0000)), PeError::Malformed);
        check("data rva outside", &patched(&|p| put32(&mut p.bytes, p.data_rva_at, 0xFFFF_0000)), PeError::Malformed);
        check("data rva before the resource", &patched(&|p| put32(&mut p.bytes, p.data_rva_at, 0x10)), PeError::Malformed);
        // Looping / overlapping directory offsets: the language level points back at the root, or at itself.
        check("loop to root", &patched(&|p| put32(&mut p.bytes, p.dir2_entry_at, 0x8000_0000)), PeError::Malformed);
        check("self loop", &patched(&|p| put32(&mut p.bytes, p.dir3_entry_at, 0x8000_0000 | 48)), PeError::Malformed);
        check("level 1 entry not a directory", &patched(&|p| put32(&mut p.bytes, p.root_entry_at, 24)), PeError::Malformed);
        // Over the data cap, zero data, a huge entry count.
        check("data over cap", &patched(&|p| put32(&mut p.bytes, p.data_size_at, 0x2_0000)), PeError::TooLarge);
        check("data size zero", &patched(&|p| put32(&mut p.bytes, p.data_size_at, 0)), PeError::NoResource);
        check("ids count huge", &patched(&|p| put16(&mut p.bytes, p.ids_at, 60_000)), PeError::Malformed);
        // No RT_VERSION, no resource directory, odd headers.
        check("no RT_VERSION", &patched(&|p| put32(&mut p.bytes, p.type_id_at, 3)), PeError::NoResource);
        check("res size zero", &patched(&|p| put32(&mut p.bytes, p.res_size_at, 0)), PeError::NoResource);
        check("zero sections", &patched(&|p| put16(&mut p.bytes, p.nsec_at, 0)), PeError::Malformed);
        check("200 sections", &patched(&|p| put16(&mut p.bytes, p.nsec_at, 200)), PeError::Malformed);
        check("optional header too big", &patched(&|p| put16(&mut p.bytes, p.opt_size_at, 4000)), PeError::Malformed);
        check("optional header tiny", &patched(&|p| put16(&mut p.bytes, p.opt_size_at, 10)), PeError::NoResource);
        check("unknown optional magic", &patched(&|p| put16(&mut p.bytes, 0x58, 0x107)), PeError::NotPe);
        check("not MZ", &patched(&|p| p.bytes[0] = b'N'), PeError::NotPe);
        check("not PE", &patched(&|p| p.bytes[0x40] = b'X'), PeError::NotPe);
        check("e_lfanew past the file", &patched(&|p| put32(&mut p.bytes, 0x3c, 0xFFFF_FFF0)), PeError::NotPe);
        check("e_lfanew inside the DOS header", &patched(&|p| put32(&mut p.bytes, 0x3c, 8)), PeError::NotPe);
        // Files too short to hold a header at all, and an empty file.
        for n in [0usize, 1, 19, 63, 64] {
            let (r, _) = read_pe(&base.bytes[..n]);
            assert_eq!(r.err(), Some(PeError::NotPe), "{n}");
        }
        assert!(read_pe(&base.bytes[..100]).0.is_err());
        // Truncated after the headers: a typed error, never a read past the end.
        for cut in [0x170usize, 0x300, 0x400, 0x410, 0x440, 0x470] {
            let (r, reads) = read_pe(&base.bytes[..cut]);
            assert!(r.is_err(), "cut {cut}");
            assert!(reads.iter().all(|(o, l)| o + *l as u64 <= cut as u64));
        }
        // An expired deadline reads nothing.
        let (r, reads) = read_version_resource(&mut Cursor::new(&base.bytes[..]), base.bytes.len() as u64, Instant::now());
        assert_eq!((r.err(), reads.len()), (Some(PeError::TimedOut), 0));
    }

    /// Deterministic generator (no external crate).
    struct Lcg(u64);

    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
            self.0 >> 24
        }
    }

    fn mutate(b: u8, op: u64, rnd: u64) -> u8 {
        match op % 5 {
            0 => b ^ 0xFF,
            1 => 0,
            2 => 0x80,
            3 => b.wrapping_add(1),
            _ => (rnd & 0xFF) as u8,
        }
    }

    fn assert_reads_in_bounds(reads: &[(u64, usize)], len: usize, what: &str) {
        let total: usize = reads.iter().map(|(_, l)| *l).sum();
        assert!(total <= MAX_READ_TOTAL, "{what}: {total} bytes read");
        for (o, l) in reads {
            assert!(*o + *l as u64 <= len as u64, "{what}: read ({o},{l}) outside {len}");
        }
    }

    fn assert_strings_capped(r: &Result<VersionStrings, PeError>) {
        if let Ok(v) = r {
            for s in [&v.product, &v.original_filename, &v.company] {
                assert!(s.chars().count() <= MAX_STRING_UNITS, "string over the cap");
            }
        }
    }

    #[test]
    fn a_real_system_dll_is_read_and_mutating_it_never_panics_or_reads_out_of_bounds() {
        let sys = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let path = Path::new(&sys).join("System32").join("kernel32.dll");
        let Ok(mut data) = std::fs::read(&path) else {
            eprintln!("skipped: no kernel32.dll here");
            return;
        };
        let (real, reads) = read_pe(&data);
        let v = real.expect("kernel32.dll's version resource parses");
        assert!(!v.product.is_empty() && !v.original_filename.is_empty(), "{v:?}");
        assert_eq!(kind_from_version_strings(&v), None, "a Windows DLL is not a mod");
        assert_reads_in_bounds(&reads, data.len(), "real");
        eprintln!("kernel32.dll: {} bytes read in {} reads (file {} bytes)", reads.iter().map(|(_, l)| l).sum::<usize>(), reads.len(), data.len());
        // The offsets the reader really touches: headers, section table, directories, the block.
        let mut positions: Vec<usize> = Vec::new();
        for (o, l) in &reads {
            positions.extend(*o as usize..*o as usize + *l);
        }
        let block_read = reads.last().copied().unwrap();
        let block = data[block_read.0 as usize..block_read.0 as usize + block_read.1].to_vec();
        let mut rng = Lcg(0x5EED_1234_ABCD_0001);
        let mut iterations = 0usize;
        // 1. Single-byte mutations at the offsets the reader uses (the real PE headers and block).
        for _ in 0..3000 {
            let r = rng.next();
            let pos = positions[(r as usize) % positions.len()];
            let keep = data[pos];
            data[pos] = mutate(keep, r >> 8, rng.next());
            let (res, reads) = read_pe(&data);
            assert_reads_in_bounds(&reads, data.len(), "mutated");
            assert_strings_capped(&res);
            data[pos] = keep;
            iterations += 1;
        }
        // 2. Multi-byte mutations: three bytes at once.
        for _ in 0..1000 {
            let picks: Vec<usize> = (0..3).map(|_| positions[(rng.next() as usize) % positions.len()]).collect();
            let keep: Vec<u8> = picks.iter().map(|p| data[*p]).collect();
            for p in &picks {
                data[*p] = mutate(data[*p], rng.next(), rng.next());
            }
            let (res, reads) = read_pe(&data);
            assert_reads_in_bounds(&reads, data.len(), "multi");
            assert_strings_capped(&res);
            for (p, k) in picks.iter().zip(keep) {
                data[*p] = k;
            }
            iterations += 1;
        }
        // 3. Truncation at the touched offsets and at arbitrary points.
        for i in 0..1500 {
            let cut = if i % 2 == 0 { positions[(rng.next() as usize) % positions.len()] } else { (rng.next() as usize) % data.len() };
            let (res, reads) = read_pe(&data[..cut]);
            assert_reads_in_bounds(&reads, cut, "truncated");
            assert_strings_capped(&res);
            iterations += 1;
        }
        // 4. The real block alone: every prefix, and 2,000 mutations.
        for n in 0..=block.len() {
            assert_strings_capped(&parse_version_block(&block[..n]));
            iterations += 1;
        }
        let mut b = block.clone();
        for _ in 0..2000 {
            let r = rng.next();
            let pos = (r as usize) % b.len();
            let keep = b[pos];
            b[pos] = mutate(keep, r >> 8, rng.next());
            assert_strings_capped(&parse_version_block(&b));
            b[pos] = keep;
            iterations += 1;
        }
        // 5. A small synthetic image, 32- and 64-bit: every byte, several mutations each.
        for pe32 in [false, true] {
            let mut pe = build_pe(&opti_block(), pe32).bytes;
            for pos in 0..pe.len() {
                for op in 0..4u64 {
                    let keep = pe[pos];
                    pe[pos] = mutate(keep, op, 0x41);
                    let (res, reads) = read_pe(&pe);
                    assert_reads_in_bounds(&reads, pe.len(), "synthetic");
                    assert_strings_capped(&res);
                    pe[pos] = keep;
                    iterations += 1;
                }
            }
        }
        eprintln!("mutation iterations: {iterations}");
        assert!(iterations >= 8000, "{iterations}");
    }

    // ---- probing -------------------------------------------------------------------------------

    fn temp_root(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("compy_m2_{tag}_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    fn put(root: &Path, rel: &str, bytes: &[u8]) {
        let p = rel.split('/').fold(root.to_path_buf(), |a, s| a.join(s));
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, bytes).unwrap();
    }

    #[test]
    fn a_real_pe_file_with_the_optiscaler_resource_is_identified_through_a_scan() {
        let root = temp_root("opti_pe");
        put(&root, "dxgi.dll", &build_pe(&opti_block(), false).bytes);
        put(&root, "version.dll", &build_pe(&version_block(&[("ProductName", "Something Else")]), true).bytes);
        let scan = scan_game_folder(&root, Duration::from_secs(10));
        assert_eq!(scan.status, ScanStatus::Complete, "{scan:?}");
        assert_eq!(kinds(&scan.found), vec![ModKind::OptiScaler]);
        assert_eq!((scan.found[0].strength, evidence_names(&scan.found[0])), (Strength::Strong, vec!["dxgi.dll"]));
        let (p, bytes) = probe_file(&root.join("dxgi.dll"), 0, far());
        assert!(matches!(p, Probe::Read(_)));
        assert!(bytes > 0 && bytes < 4096, "{bytes}");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_dll_that_cannot_be_probed_makes_the_scan_partial_never_complete() {
        // Over the size gate: never opened.
        assert_eq!(probe_file(Path::new("Z:\\no-such-file.dll"), MAX_DLL_BYTES + 1, far()).0, Probe::Failed(ProbeFailure::TooLarge));
        // A missing file is a failure, not "no resource".
        assert_eq!(probe_file(Path::new("Z:\\no-such-file.dll"), 10, far()).0, Probe::Failed(ProbeFailure::Io));
        // An expired deadline is TimedOut, and the scan says the time budget ran out.
        let root = temp_root("probe_time");
        put(&root, "dxgi.dll", &build_pe(&opti_block(), false).bytes);
        assert_eq!(probe_file(&root.join("dxgi.dll"), 0, Instant::now()).0, Probe::Failed(ProbeFailure::TimedOut));
        let mut listing = vec![Entry { dir: String::new(), name: "dxgi.dll".into(), is_dir: false, size: 10, created: None, modified: None, offline: false, product: None }];
        let mut reasons = Vec::new();
        probe_dlls(&root, &mut listing, Instant::now(), &mut reasons);
        assert_eq!(reasons, vec![PartialReason::TimeBudget]);
        // An unopenable proxy-named DLL: the scan is Partial with DllUnreadable.
        let mut reasons = Vec::new();
        let mut gone = vec![Entry { dir: String::new(), name: "winmm.dll".into(), is_dir: false, size: 10, created: None, modified: None, offline: false, product: None }];
        probe_dlls(&root, &mut gone, far(), &mut reasons);
        assert_eq!(reasons, vec![PartialReason::DllUnreadable]);
        let _ = std::fs::remove_dir_all(root);
    }

    #[cfg(windows)]
    #[test]
    fn a_locked_dll_makes_a_real_scan_partial() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = temp_root("locked");
        put(&root, "dxgi.dll", &build_pe(&opti_block(), false).bytes);
        let _held = std::fs::OpenOptions::new().read(true).write(true).share_mode(0).open(root.join("dxgi.dll")).unwrap();
        let scan = scan_game_folder(&root, Duration::from_secs(10));
        assert_eq!(scan.status, ScanStatus::Partial { reasons: vec![PartialReason::DllUnreadable] }, "{scan:?}");
        assert!(scan.found.is_empty());
        drop(_held);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_path_over_260_characters_is_opened_through_the_extended_form() {
        let a = "a".repeat(120);
        let b = "b".repeat(120);
        let root = std::env::temp_dir().join(format!("compy_m2_long_{}", std::process::id())).join(&a).join(&b);
        let top = std::env::temp_dir().join(format!("compy_m2_long_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&top);
        std::fs::create_dir_all(&root).unwrap();
        put(&root, "dxgi.dll", &build_pe(&opti_block(), false).bytes);
        assert!(root.join("dxgi.dll").to_string_lossy().len() > 260);
        let scan = scan_game_folder(&root, Duration::from_secs(10));
        assert_eq!(kinds(&scan.found), vec![ModKind::OptiScaler], "{scan:?}");
        assert_eq!(scan.status, ScanStatus::Complete);
        let _ = std::fs::remove_dir_all(top);
        // The extended form is built, not guessed.
        assert_eq!(extended_path(Path::new(r"C:\Games\x.dll")), PathBuf::from(r"\\?\C:\Games\x.dll"));
        assert_eq!(extended_path(Path::new(r"\\srv\share\x.dll")), PathBuf::from(r"\\?\UNC\srv\share\x.dll"));
        assert_eq!(extended_path(Path::new(r"\\?\C:\x.dll")), PathBuf::from(r"\\?\C:\x.dll"));
        assert_eq!(extended_path(Path::new("relative.dll")), PathBuf::from("relative.dll"));
    }

    #[test]
    fn offline_files_are_counted_never_opened_and_never_a_probe_failure() {
        let src = mem(vec![("", vec![raw_file("dxgi.dll", true), raw_file("ReShade.ini", true)])]);
        let w = walk(&src, far(), MAX_ENTRIES).unwrap();
        assert_eq!(w.reasons, vec![PartialReason::CloudOrOfflineSkipped(2)]);
        assert!(w.listing.iter().all(|e| e.offline), "listed by name only");
        // Names still match (nothing is opened to do that); the offline DLL is not probed.
        let mut listing = w.listing;
        let mut reasons = Vec::new();
        probe_dlls(Path::new("Z:\\no-such-root"), &mut listing, far(), &mut reasons);
        assert!(reasons.is_empty(), "an offline file is skipped, not opened: {reasons:?}");
        assert_eq!(kinds(&m(&listing)), vec![ModKind::ReShade]);
        const { assert!(OFFLINE_ATTRIBUTES & 0x1000 != 0 && OFFLINE_ATTRIBUTES & 0x40000 != 0 && OFFLINE_ATTRIBUTES & 0x40_0000 != 0) };
    }

    // ---- the walk: limits, links, unreadable folders (in-memory directory source) ----------------

    fn raw(name: &str, is_dir: bool, is_link: bool, offline: bool) -> RawEntry {
        RawEntry { name: name.into(), is_dir, is_link, offline, size: 10, created: None, modified: None }
    }

    fn rf(name: &str) -> RawEntry {
        raw(name, false, false, false)
    }

    fn raw_file(name: &str, offline: bool) -> RawEntry {
        raw(name, false, false, offline)
    }

    fn rd(name: &str) -> RawEntry {
        raw(name, true, false, false)
    }

    fn rl(name: &str, is_dir: bool) -> RawEntry {
        raw(name, is_dir, true, false)
    }

    /// A directory source from a map of folder -> entries; a folder not in the map cannot be listed.
    fn mem(dirs: Vec<(&str, Vec<RawEntry>)>) -> impl Fn(&str, Instant, usize) -> RawListing {
        let map: HashMap<String, Vec<RawEntry>> = dirs.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
        move |rel, _, _| map.get(rel).cloned().map(|entries| RawDir { entries, had_errors: false, stopped: None }).ok_or(std::io::ErrorKind::NotFound)
    }

    #[test]
    fn the_walk_lists_the_folder_and_two_levels_and_no_deeper() {
        let src = mem(vec![
            ("", vec![rf("a.txt"), rd("a")]),
            ("a", vec![rf("b.txt"), rd("b")]),
            ("a/b", vec![rf("c.txt"), rd("c")]),
            // "a/b/c" is deliberately NOT in the map: listing it would show up as an unreadable sub-folder.
        ]);
        let w = walk(&src, far(), MAX_ENTRIES).unwrap();
        let seen: Vec<(String, String)> = w.listing.iter().map(|e| (e.dir.clone(), e.name.clone())).collect();
        assert_eq!(seen, vec![("".into(), "a.txt".into()), ("a".into(), "b.txt".into()), ("a/b".into(), "c.txt".into())]);
        assert!(w.reasons.is_empty(), "{:?}", w.reasons);
    }

    #[test]
    fn a_fifty_thousand_entry_folder_hits_the_cap_and_the_scan_is_partial() {
        let big: Vec<RawEntry> = (0..50_000).map(|i| rf(&format!("f{i}.bin"))).collect();
        let src = mem(vec![("", big)]);
        let w = walk(&src, far(), MAX_ENTRIES).unwrap();
        assert_eq!(w.listing.len(), MAX_ENTRIES);
        assert_eq!(w.reasons, vec![PartialReason::EntryCap]);
        assert_eq!(status_of(w.reasons), ScanStatus::Partial { reasons: vec![PartialReason::EntryCap] });
        let three = mem(vec![("", vec![rf("a"), rf("b"), rf("c")])]);
        assert!(walk(&three, far(), 3).unwrap().reasons.is_empty(), "exactly the cap is a complete read");
        assert_eq!(walk(&three, far(), 2).unwrap().reasons, vec![PartialReason::EntryCap]);
    }

    #[test]
    fn enumeration_stops_mid_directory_at_the_cap_and_at_the_deadline() {
        let root = temp_root("midstop");
        for i in 0..60 {
            put(&root, &format!("f{i}.bin"), b"x");
        }
        let d = list_real(&root, far(), 10).ok().unwrap();
        assert_eq!((d.entries.len(), d.stopped), (10, Some(Stop::Cap)), "stopped while listing, not after");
        let d = list_real(&root, far(), 60).ok().unwrap();
        assert_eq!((d.entries.len(), d.stopped), (60, None), "exactly the cap is complete");
        let d = list_real(&root, Instant::now(), 1000).ok().unwrap();
        assert_eq!((d.entries.len(), d.stopped), (0, Some(Stop::Time)));
        // Through the walk: a cap of 25 over this folder reads 25 entries and says so.
        let list = |rel: &str, dl: Instant, cap: usize| list_real(&rel_path(&root, rel), dl, cap);
        let w = walk(&list, far(), 25).unwrap();
        assert_eq!((w.listing.len(), w.reasons), (25, vec![PartialReason::EntryCap]));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn links_are_never_followed_and_make_the_scan_partial() {
        let src = mem(vec![("", vec![rf("ReShade.ini"), rl("junction", true), rl("linked.dll", false)])]);
        let w = walk(&src, far(), MAX_ENTRIES).unwrap();
        assert_eq!(w.listing.len(), 1);
        assert_eq!(w.reasons, vec![PartialReason::ReparsePointsSkipped(2)]);
    }

    #[test]
    fn an_unreadable_root_is_unreadable_and_an_unreadable_subfolder_is_partial() {
        let none = mem(vec![]);
        assert_eq!(walk(&none, far(), MAX_ENTRIES).err(), Some(ModUnreadable::FolderMissing));
        let denied = |_: &str, _: Instant, _: usize| -> RawListing { Err(std::io::ErrorKind::PermissionDenied) };
        assert_eq!(walk(&denied, far(), MAX_ENTRIES).err(), Some(ModUnreadable::FolderUnreadable));
        let src = mem(vec![("", vec![rf("a.ini"), rd("locked")])]);
        assert_eq!(walk(&src, far(), MAX_ENTRIES).unwrap().reasons, vec![PartialReason::SubfoldersUnreadable(1)]);
        let flaky = |rel: &str, _: Instant, _: usize| -> RawListing {
            if rel.is_empty() {
                Ok(RawDir { entries: vec![rf("a.ini")], had_errors: true, stopped: None })
            } else {
                Err(std::io::ErrorKind::NotFound)
            }
        };
        assert_eq!(walk(&flaky, far(), MAX_ENTRIES).unwrap().reasons, vec![PartialReason::SubfoldersUnreadable(1)]);
    }

    #[test]
    fn running_out_of_time_before_any_file_is_unreadable_not_clean() {
        let src = mem(vec![("", vec![rf("a.ini")])]);
        assert_eq!(walk(&src, Instant::now(), MAX_ENTRIES).err(), Some(ModUnreadable::TimedOutBeforeAnyEntry));
    }

    // ---- merge, the exe search, verdict and coverage -------------------------------------------

    fn one(kind: ModKind, strength: Strength, when: &str) -> ModFinding {
        let mut f = ModFinding {
            kind,
            name: kind.display_name(),
            strength,
            loader_file_present: false,
            evidence: vec![EvidenceFile { file_name: "ReShade.ini", role: EvidenceRole::Settings, created: Some(t(when)), modified: Some(t(when)), size: 1 }],
            version: None,
            first_seen: None,
            settings_changed: None,
            last_log_write: None,
            notes: vec![],
            dirs: vec![],
        };
        finalize(&mut f);
        f
    }

    fn scan_of(status: ScanStatus, found: Vec<ModFinding>) -> ModScan {
        ModScan { status, found, coverage: Coverage::root_only() }
    }

    #[test]
    fn merging_folders_keeps_every_gap_and_never_turns_unreadable_into_clean() {
        let a = scan_of(ScanStatus::Complete, vec![one(ModKind::ReShade, Strength::SettingsOnly, "2026-11-01T00:00:00Z")]);
        let b = scan_of(ScanStatus::Unreadable(ModUnreadable::FolderMissing), vec![]);
        let c = scan_of(ScanStatus::Partial { reasons: vec![PartialReason::EntryCap] }, vec![one(ModKind::ReShade, Strength::Strong, "2026-11-05T00:00:00Z")]);
        let cov = Coverage::root_only();
        let merged = merge(vec![a.clone(), b.clone(), c], vec![PartialReason::MoreExeFoldersNotScanned], cov);
        assert_eq!(
            merged.status,
            ScanStatus::Partial { reasons: vec![PartialReason::EntryCap, PartialReason::FolderUnreadable, PartialReason::MoreExeFoldersNotScanned] }
        );
        assert_eq!(merged.found.len(), 1);
        let x = &merged.found[0];
        assert_eq!(x.strength, Strength::Strong, "the stronger evidence wins");
        assert_eq!((x.first_seen, x.settings_changed), (Some(t("2026-11-01T00:00:00Z")), Some(t("2026-11-05T00:00:00Z"))));
        assert_eq!(merge(vec![b.clone(), b], vec![], cov).status, ScanStatus::Unreadable(ModUnreadable::FolderMissing));
        assert_eq!(merge(vec![a.clone(), a], vec![], cov).status, ScanStatus::Complete);
        let timed = scan_of(ScanStatus::Unreadable(ModUnreadable::TimedOutBeforeAnyEntry), vec![]);
        let ok = scan_of(ScanStatus::Complete, vec![]);
        assert_eq!(merge(vec![ok, timed], vec![], cov).status, ScanStatus::Partial { reasons: vec![PartialReason::TimeBudget] });
    }

    fn reasons_of(scan: &ModScan) -> Vec<PartialReason> {
        match &scan.status {
            ScanStatus::Partial { reasons } => reasons.clone(),
            _ => vec![],
        }
    }

    #[test]
    fn the_exe_folder_is_scanned_too_when_it_is_deeper_than_two_levels() {
        let root = temp_root("exedir");
        put(&root, "Launcher.exe", b"MZ");
        put(&root, "Game/Binaries/Win64/Game-Win64-Shipping.exe", b"MZ");
        put(&root, "Game/Binaries/Win64/ReShade.ini", b"x");
        let plain = scan_game_folder(&root, Duration::from_secs(10));
        assert!(plain.found.is_empty(), "three levels down is beyond the plain walk");
        assert_eq!(plain.coverage.exe_search, ExeSearch::NotAsked);
        let scan = scan_install_folder(&root, Some("game-win64-shipping.EXE"), Duration::from_secs(10));
        assert_eq!(scan.status, ScanStatus::Complete);
        assert_eq!(kinds(&scan.found), vec![ModKind::ReShade]);
        assert_eq!((scan.coverage.exe_search, scan.coverage.exe_folders_scanned), (ExeSearch::ForProgram, 1));
        // Without a program name, game-like programs are looked for, and the coverage says so.
        let any = scan_install_folder(&root, None, Duration::from_secs(10));
        assert_eq!(kinds(&any.found), vec![ModKind::ReShade]);
        assert_eq!(any.coverage.exe_search, ExeSearch::AnyGameLikeProgram);
        assert!(is_game_like_exe("wardogslauncher-shipping.exe") && !is_game_like_exe("vc_redist.x64.exe") && !is_game_like_exe("crashpad_handler.exe"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn an_exe_folder_that_was_not_located_or_not_fully_searched_is_never_complete() {
        let root = temp_root("exemiss");
        put(&root, "Game/Binaries/Win64/Game-Win64-Shipping.exe", b"MZ");
        // Asked for a program that is nowhere: Partial.
        let scan = scan_install_folder(&root, Some("not-here.exe"), Duration::from_secs(10));
        assert!(reasons_of(&scan).contains(&PartialReason::ExeFolderNotLocated), "{scan:?}");
        assert!(matches!(scan.verdict(), Verdict::PartlyScanned { .. }));
        // The program is in the root itself: located, complete.
        put(&root, "Here.exe", b"MZ");
        assert_eq!(scan_install_folder(&root, Some("here.exe"), Duration::from_secs(10)).status, ScanStatus::Complete);
        // The same program name in two folders: only the first is scanned, and it says so.
        put(&root, "Other/Game-Win64-Shipping.exe", b"MZ");
        let two = scan_install_folder(&root, Some("game-win64-shipping.exe"), Duration::from_secs(10));
        assert!(reasons_of(&two).contains(&PartialReason::MoreExeFoldersNotScanned), "{two:?}");
        // No program named and more than four game-like folders: only four are scanned, and it says so.
        let many = temp_root("exemany");
        for i in 0..6 {
            put(&many, &format!("d{i}/g{i}.exe"), b"MZ");
        }
        let scan = scan_install_folder(&many, None, Duration::from_secs(10));
        assert!(reasons_of(&scan).contains(&PartialReason::MoreExeFoldersNotScanned), "{scan:?}");
        assert_eq!(scan.coverage.exe_folders_scanned, 4);
        // A program deeper than the search goes: the depth limit is reported.
        let deep = temp_root("exedeep");
        put(&deep, "a/b/c/d/e/f/g/Game.exe", b"MZ");
        let scan = scan_install_folder(&deep, Some("game.exe"), Duration::from_secs(10));
        let r = reasons_of(&scan);
        assert!(r.contains(&PartialReason::ExeSearchLimited(SearchLimit::Depth)) && r.contains(&PartialReason::ExeFolderNotLocated), "{r:?}");
        // An expired deadline stops the search and says so.
        let s = find_dirs_holding(&root, Instant::now(), &|_| true, 1, true);
        assert!(s.limits.contains(&PartialReason::ExeSearchLimited(SearchLimit::Time)));
        for d in [root, many, deep] {
            let _ = std::fs::remove_dir_all(d);
        }
    }

    #[test]
    fn the_verdict_is_the_only_way_to_say_no_known_mod() {
        let cov = Coverage::root_only();
        let clean = scan_of(ScanStatus::Complete, vec![]);
        assert_eq!(clean.verdict(), Verdict::NoKnownMod { coverage: &cov });
        let hit = scan_of(ScanStatus::Complete, vec![one(ModKind::ReShade, Strength::Strong, WHEN)]);
        assert!(matches!(hit.verdict(), Verdict::Found { found, .. } if found.len() == 1));
        let partial = scan_of(ScanStatus::Partial { reasons: vec![PartialReason::EntryCap] }, vec![]);
        assert!(matches!(partial.verdict(), Verdict::PartlyScanned { reasons, found, .. } if reasons.len() == 1 && found.is_empty()), "empty + partial is never NoKnownMod");
        let un = scan_of(ScanStatus::Unreadable(ModUnreadable::NotInSteam), vec![]);
        assert_eq!(un.verdict(), Verdict::CouldNotScan { reason: &ModUnreadable::NotInSteam });
        // Plain scans state their scope.
        let root = temp_root("verdict");
        put(&root, "a.txt", b"x");
        let scan = scan_game_folder(&root, Duration::from_secs(10));
        assert!(matches!(scan.verdict(), Verdict::NoKnownMod { coverage } if coverage.levels_below_folder == 2 && coverage.exe_search == ExeSearch::NotAsked));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_missing_folder_and_a_zero_budget_are_unreadable_never_no_mods() {
        let gone = std::env::temp_dir().join(format!("compy_m2_gone_{}", std::process::id()));
        assert_eq!(scan_game_folder(&gone, Duration::from_secs(1)).status, ScanStatus::Unreadable(ModUnreadable::FolderMissing));
        let root = temp_root("zero");
        put(&root, "ReShade.ini", b"x");
        let scan = scan_game_folder(&root, Duration::ZERO);
        assert_eq!(scan.status, ScanStatus::Unreadable(ModUnreadable::TimedOutBeforeAnyEntry));
        assert!(scan.found.is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_process_that_cannot_be_matched_to_one_install_is_unreadable() {
        assert_eq!(scan_for_process("").status, ScanStatus::Unreadable(ModUnreadable::NoProcessName));
        assert_eq!(scan_for_process("   ").status, ScanStatus::Unreadable(ModUnreadable::NoProcessName));
        let scan = scan_for_process("zz-no-such-game-m2-Win64-Shipping.exe");
        assert!(matches!(scan.verdict(), Verdict::CouldNotScan { .. }), "an unmatched game must never read as clean: {scan:?}");
    }

    // ---- real files (temp folders) -------------------------------------------------------------

    #[test]
    fn a_real_folder_is_scanned_end_to_end_and_returns_no_folder_names() {
        let root = temp_root("e2e");
        put(&root, "Game.exe", b"MZ");
        put(&root, "ReShade.ini", b"[GENERAL]\n");
        put(&root, "bin/dxgi.dll", b"MZ-not-a-real-dll");
        put(&root, "SecretSub/neuralhub.ini", b"[Compute]\n");
        put(&root, "SecretSub/ATTRIBUTION.txt", "NeuralHub 0.8.0 by someone \u{2014} DLSS\n".as_bytes());
        let scan = scan_game_folder(&root, Duration::from_secs(10));
        assert_eq!(scan.status, ScanStatus::Complete, "{scan:?}");
        assert_eq!(kinds(&scan.found), vec![ModKind::AmdnrNeuralHub, ModKind::ReShade]);
        assert_eq!(scan.found[0].version.as_deref(), Some("0.8.0"));
        assert!(!scan.found[1].loader_file_present, "the only dxgi.dll is in another folder");
        assert!(scan.found.iter().all(|x| x.dirs.is_empty()), "folder names are cleared before a scan returns");
        assert!(scan.found.iter().all(|x| x.first_seen.is_some() && x.settings_changed.is_some()));
        for text in [format!("{scan:?}"), format!("{scan:#?}"), serde_json::to_string(&scan).unwrap()] {
            assert!(!text.contains("SecretSub") && !text.contains("compy_m2"), "{text}");
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_version_text_over_the_size_cap_is_never_read() {
        let root = temp_root("bigtxt");
        put(&root, "neuralhub.ini", b"x");
        let mut big = b"NeuralHub 0.8.0 by someone\n".to_vec();
        big.resize(MAX_TEXT_BYTES as usize + 1, b' ');
        put(&root, "ATTRIBUTION.txt", &big);
        let scan = scan_game_folder(&root, Duration::from_secs(10));
        assert_eq!(kinds(&scan.found), vec![ModKind::AmdnrNeuralHub]);
        assert_eq!(scan.found[0].version, None);
        put(&root, "ATTRIBUTION.txt", b"NeuralHub 0.8.0 by someone\n");
        assert_eq!(scan_game_folder(&root, Duration::from_secs(10)).found[0].version.as_deref(), Some("0.8.0"));
        put(&root, "ATTRIBUTION.txt", b"NeuralHub kuya1234 by someone\n");
        assert_eq!(scan_game_folder(&root, Duration::from_secs(10)).found[0].version, None);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_junction_is_not_followed_and_the_scan_says_so() {
        let root = temp_root("junction");
        let target = temp_root("junction_target");
        put(&target, "ReShade.ini", b"x");
        put(&root, "Game.exe", b"MZ");
        let status = std::process::Command::new("cmd.exe")
            .args(["/c", "mklink", "/J"])
            .arg(root.join("linked"))
            .arg(&target)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
        if !matches!(status, Ok(s) if s.success()) {
            eprintln!("skipped: could not create a junction here, so nothing is proven");
            let _ = std::fs::remove_dir_all(&root);
            let _ = std::fs::remove_dir_all(&target);
            return;
        }
        let scan = scan_game_folder(&root, Duration::from_secs(10));
        assert!(scan.found.is_empty(), "the junction's target must not be read: {scan:?}");
        assert_eq!(scan.status, ScanStatus::Partial { reasons: vec![PartialReason::ReparsePointsSkipped(1)] });
        let _ = std::fs::remove_dir(root.join("linked"));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&target);
    }

    // ---- privacy -------------------------------------------------------------------------------

    fn collect(v: &serde_json::Value, keys: &mut Vec<String>, strings: &mut Vec<String>) {
        match v {
            serde_json::Value::Object(o) => {
                for (k, x) in o {
                    keys.push(k.clone());
                    collect(x, keys, strings);
                }
            }
            serde_json::Value::Array(a) => a.iter().for_each(|x| collect(x, keys, strings)),
            serde_json::Value::String(s) => strings.push(s.clone()),
            _ => {}
        }
    }

    #[test]
    fn only_fixed_names_dates_and_a_strict_version_are_ever_serialised_or_debug_printed() {
        let secret_listing = vec![
            fe("Users/kuya/Secret Game", "Secret Game.exe.dxvk-cache", 5, WHEN, WHEN),
            fe("Users/kuya/Secret Game", "ReShade.ini", 5, WHEN, WHEN),
            fe("Users/kuya/Secret Game", "ATTRIBUTION.txt", 5, WHEN, WHEN),
            fe("Users/kuya/Secret Game", "neuralhub.ini", 5, "1980-01-01T00:00:00Z", WHEN),
        ];
        let mut found = m(&secret_listing);
        found[0].version = Some("0.8.0".into());
        found[1].dirs = vec!["Users/kuya/Secret Game".into()];
        let every_reason = vec![
            PartialReason::EntryCap,
            PartialReason::TimeBudget,
            PartialReason::SubfoldersUnreadable(2),
            PartialReason::ReparsePointsSkipped(1),
            PartialReason::CloudOrOfflineSkipped(3),
            PartialReason::DllProbesLimited,
            PartialReason::DllUnreadable,
            PartialReason::ExeFolderNotLocated,
            PartialReason::ExeSearchLimited(SearchLimit::Depth),
            PartialReason::MoreExeFoldersNotScanned,
            PartialReason::FolderUnreadable,
        ];
        let cov = Coverage { levels_below_folder: 2, exe_folders_scanned: 1, exe_search: ExeSearch::ForProgram };
        let mut scans = vec![
            ModScan { status: ScanStatus::Complete, found: found.clone(), coverage: cov },
            ModScan { status: ScanStatus::Partial { reasons: every_reason }, found, coverage: cov },
        ];
        for u in [
            ModUnreadable::FolderMissing,
            ModUnreadable::FolderUnreadable,
            ModUnreadable::TimedOutBeforeAnyEntry,
            ModUnreadable::NoProcessName,
            ModUnreadable::NotInSteam,
            ModUnreadable::Steam(UnreadableReason::SteamPartiallyUnreadable { libraries: 1, records: 2 }),
            ModUnreadable::Steam(UnreadableReason::SteamNotFound),
        ] {
            scans.push(ModScan { status: ScanStatus::Unreadable(u), found: vec![], coverage: cov });
        }
        let allowed_keys = [
            "status", "found", "coverage", "kind", "name", "strength", "loader_file_present", "evidence", "version", "first_seen", "settings_changed", "last_log_write",
            "notes", "file_name", "role", "created", "modified", "size", "reasons", "levels_below_folder", "exe_folders_scanned", "exe_search", "partial", "unreadable",
            "steam", "entry_cap", "time_budget", "subfolders_unreadable", "reparse_points_skipped", "cloud_or_offline_skipped", "dll_probes_limited", "dll_unreadable",
            "exe_folder_not_located", "exe_search_limited", "more_exe_folders_not_scanned", "folder_unreadable", "steam_partially_unreadable", "libraries", "records",
        ];
        let mut vocabulary: Vec<String> = Vec::new();
        for s in SIGS.iter() {
            vocabulary.push(s.kind.display_name().into());
            vocabulary.extend(s.named.iter().map(|n| n.shown.to_string()));
            vocabulary.extend(s.suffixes.iter().map(|(_, shown)| shown.to_string()));
        }
        for scan in &scans {
            let json = serde_json::to_string(scan).unwrap();
            let (mut keys, mut strings) = (Vec::new(), Vec::new());
            collect(&serde_json::from_str(&json).unwrap(), &mut keys, &mut strings);
            for k in &keys {
                assert!(allowed_keys.contains(&k.as_str()), "unexpected key {k}: {json}");
            }
            for s in &strings {
                let fixed = vocabulary.contains(s);
                let snake = !s.is_empty() && s.chars().all(|c| c.is_ascii_lowercase() || c == '_');
                let date = DateTime::parse_from_rfc3339(s).is_ok();
                let version = clean_version(s).is_some();
                assert!(fixed || snake || date || version, "unexpected value {s:?}: {json}");
            }
            for leak in ["Secret", "kuya", "Users", "ATTRIBUTION", ".exe"] {
                assert!(!json.contains(leak), "{leak} leaked: {json}");
                let debug = format!("{scan:?} {scan:#?}");
                assert!(!debug.contains(leak), "{leak} in Debug: {debug}");
            }
        }
        let e = fe("Users/kuya", "Secret.dll", 1, WHEN, WHEN);
        assert!(!format!("{e:?}").contains("Secret") && !format!("{e:?}").contains("kuya"));
        assert!(!format!("{:?}", rf("Secret.dll").name.len()).is_empty());
    }

    // ---- isolation (mirrors the change_sources guards) -----------------------------------------

    /// The text of `fn <name>` up to its closing brace at column 0.
    fn fn_body<'a>(src: &'a str, signature: &str) -> &'a str {
        let i = src.find(signature).unwrap_or_else(|| panic!("{signature} not found"));
        let rest = &src[i..];
        &rest[..rest.find("\n}\n").expect("end of fn") + 3]
    }

    #[test]
    fn this_module_is_not_part_of_any_support_or_outbound_payload_or_the_elevated_helper() {
        let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let allowed = ["lib.rs", "game_mods.rs", "paramedic.rs"];
        let mut scanned = 0;
        for entry in std::fs::read_dir(&src_dir).unwrap().flatten() {
            let path = entry.path();
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            if path.extension().and_then(|e| e.to_str()) != Some("rs") || allowed.contains(&name.as_str()) {
                continue;
            }
            let text = std::fs::read_to_string(&path).unwrap();
            scanned += 1;
            if name == "change_sources.rs" {
                // Its isolation tests list this module (in an allowlist and in the elevated-helper scan); only
                // those lines may name it.
                let ok = |l: &str| l.contains("let allowed =") || l.contains("for banned in");
                assert!(text.lines().filter(|l| l.contains("game_mods")).all(ok), "change_sources.rs reaches into game_mods");
                continue;
            }
            assert!(!text.contains("game_mods"), "{name} reaches into game_mods");
        }
        assert!(scanned > 30, "the scan must actually cover the crate's modules ({scanned})");
        let lib = include_str!("lib.rs");
        let lines: Vec<&str> = lib.lines().filter(|l| l.contains("game_mods")).collect();
        assert!(!lines.is_empty() && lines.iter().all(|l| l.trim_start().starts_with("mod game_mods;")), "{lines:?}");
        let body = fn_body(lib, "pub fn run_elevated_helper(");
        assert!(!body.contains("game_mods"));
        assert!(!include_str!("main.rs").contains("game_mods"));
        for f in ["scan_game_folder", "scan_install_folder", "scan_for_process", "match_signatures"] {
            assert!(!body.contains(f), "{f}");
        }
    }

    #[test]
    fn this_module_only_reads_and_uses_no_win32_version_api_and_no_unsafe() {
        let all = include_str!("game_mods.rs");
        let code_all = &all[..all.find("#[cfg(test)]\nmod tests").unwrap()];
        let code: String = code_all.lines().filter(|l| !l.trim_start().starts_with("//")).collect::<Vec<_>>().join("\n");
        for banned in [
            "std::fs::write", "File::create", "remove_file", "remove_dir", "OpenOptions", "std::process", "Command::new", "reqwest", "TcpStream", "LoadLibrary",
            "println!", "eprintln!", "log::", "unsafe", "GetFileVersionInfo", "VerQueryValue", "GetFileVersionInfoSize", "use windows::", "windows_sys", "winapi", "Storage::FileSystem",
        ] {
            assert!(!code.contains(banned), "game_mods.rs non-test code must not use {banned}");
        }
        // The manifest has no feature added for it, and nothing else started using one.
        let cargo = include_str!("../Cargo.toml");
        assert!(!cargo.contains("Win32_Storage_FileSystem"), "the version reader is pure Rust: no windows feature for it");
        let src_dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
        let mut stack = vec![src_dir];
        while let Some(d) = stack.pop() {
            for e in std::fs::read_dir(&d).unwrap().flatten() {
                let p = e.path();
                if p.is_dir() {
                    stack.push(p);
                } else if p.extension().and_then(|x| x.to_str()) == Some("rs") && p.file_name().and_then(|n| n.to_str()) != Some("game_mods.rs") {
                    assert!(!std::fs::read_to_string(&p).unwrap().contains("Storage::FileSystem"), "{:?} uses Storage::FileSystem", p.file_name());
                }
            }
        }
    }

    // ---- the real PC (run on demand) -----------------------------------------------------------

    fn steam_libraries() -> Vec<PathBuf> {
        let steam: String = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER)
            .open_subkey("Software\\Valve\\Steam")
            .and_then(|k| k.get_value("SteamPath"))
            .unwrap_or_default();
        let steam = steam.replace('/', "\\");
        let mut roots = vec![PathBuf::from(&steam)];
        if let Ok(vdf) = std::fs::read_to_string(Path::new(&steam).join("steamapps").join("libraryfolders.vdf")) {
            for line in vdf.lines() {
                let parts: Vec<&str> = line.split('"').collect();
                if parts.len() >= 4 && parts[1] == "path" {
                    let p = PathBuf::from(parts[3].replace("\\\\", "\\"));
                    if !roots.iter().any(|r| r.to_string_lossy().eq_ignore_ascii_case(&p.to_string_lossy())) {
                        roots.push(p);
                    }
                }
            }
        }
        roots
    }

    fn day(t: Option<DateTime<Utc>>) -> String {
        t.map_or("-".to_string(), |m| m.format("%Y-%m-%dT%H:%MZ").to_string())
    }

    fn describe(x: &ModFinding) -> String {
        format!(
            "{} | {:?} | loader_file={} | version={:?} | first_seen {} | settings_changed {} | last_log_write {} | {}",
            x.name,
            x.strength,
            x.loader_file_present,
            x.version,
            day(x.first_seen),
            day(x.settings_changed),
            day(x.last_log_write),
            x.evidence.iter().map(|e| e.file_name).collect::<Vec<_>>().join(",")
        )
    }

    /// `cargo test --lib game_mods::tests::real_pc_report -- --ignored --nocapture`
    #[test]
    #[ignore = "reads this PC's real Steam game folders; run on demand"]
    fn real_pc_report() {
        let mut times: Vec<u128> = Vec::new();
        let (mut complete, mut games) = (0usize, 0usize);
        let mut partial: Vec<String> = Vec::new();
        let mut unreadable = 0usize;
        let mut probe_lines: Vec<String> = Vec::new();
        for lib in steam_libraries() {
            let Ok(entries) = std::fs::read_dir(lib.join("steamapps").join("common")) else { continue };
            for g in entries.flatten().filter(|g| g.path().is_dir()) {
                games += 1;
                let s = Instant::now();
                let scan = scan_install_folder(&g.path(), None, DEFAULT_BUDGET);
                times.push(s.elapsed().as_millis());
                match &scan.status {
                    ScanStatus::Complete => complete += 1,
                    ScanStatus::Partial { reasons } => partial.push(format!("{}: {reasons:?}", g.file_name().to_string_lossy())),
                    ScanStatus::Unreadable(_) => unreadable += 1,
                }
                for x in &scan.found {
                    println!("HIT {} -> {}", g.file_name().to_string_lossy(), describe(x));
                }
                for p in PROXY_DLLS {
                    let path = g.path().join(p);
                    if let Ok(md) = std::fs::metadata(&path) {
                        let s = Instant::now();
                        let (r, bytes) = probe_file(&path, md.len(), Instant::now() + Duration::from_secs(5));
                        let what = match &r {
                            Probe::Read(v) => format!("{:?}", kind_from_version_strings(v)),
                            other => format!("{other:?}"),
                        };
                        probe_lines.push(format!("probe {p} ({} B file): {bytes} bytes read in {} us -> {what}", md.len(), s.elapsed().as_micros()));
                    }
                }
            }
        }
        times.sort_unstable();
        println!("games scanned: {games} | complete {complete} | partial {} | unreadable {unreadable}", partial.len());
        for p in &partial {
            println!("PARTIAL {p}");
        }
        println!("time per scan (install + exe folders): median {} ms, max {} ms (budget {} ms)", times[times.len() / 2], times[times.len() - 1], DEFAULT_BUDGET.as_millis());
        for p in &probe_lines {
            println!("{p}");
        }
        for lib in steam_libraries() {
            let pbz = lib.join("steamapps").join("common").join("PBZ").join("platform").join("steam");
            if pbz.is_dir() {
                let s = Instant::now();
                let scan = scan_game_folder(&pbz, DEFAULT_BUDGET);
                println!("PBZ leftover folder (where the exe was): {:?} in {} ms", scan.status, s.elapsed().as_millis());
                for x in &scan.found {
                    println!("HIT PBZ leftover -> {}", describe(x));
                }
                break;
            }
        }
    }
}
