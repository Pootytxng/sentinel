//! Paramedic M2 - "is there a graphics mod in this game's folder, and since when?" (read-only).
//!
//! A game that suddenly runs differently may have an injected graphics layer beside its exe (an
//! OptiScaler-style upscaler / frame-generation layer, ReShade, Special K, ENB, DXVK). The
//! Paramedic can then say, and never more than: "This game's folder contains a graphics mod (<name>),
//! added or changed on <date>. Mods like this change how frames are paced." This module finds those
//! files by NAME; it never loads, executes, hooks or modifies anything (ARCHITECTURE_LOCKS: no
//! third-party injection; this only looks for someone else's).
//!
//! RULES (each pinned by a test in this file):
//! - Read-only: lists directories, reads at most the first bytes of a small (<= 256 KB) text file, and
//!   asks Windows for the version-resource strings of a proxy-named DLL (the file is mapped as data,
//!   never loaded as code, never executed). Nothing is written, nothing is logged.
//! - Bounded: the folder given plus two levels down, an entry cap, a time budget (default 300 ms),
//!   at most 8 DLL version probes. Reparse points (junctions, symlinks) are never followed.
//! - Only fixed text leaves: the mod's display name, and file names from this module's own table (or
//!   a fixed pattern such as "*.dxvk-cache"). Never a path, a user name, or any string read from a
//!   file except a version that matches `^[0-9A-Za-z.\-]{1,24}$`.
//! - A bare proxy DLL (dxgi.dll, d3d11.dll, winmm.dll, version.dll ...) is NOT evidence: many games
//!   and anti-cheats ship those. Only a named file only that mod creates, or a version resource that
//!   names a known mod, is. Files games ship themselves (nvngx_dlss*.dll, sl.*.dll, amd_fidelityfx_*)
//!   are never evidence.
//! - Never says "no mods" when it could not look: `Unreadable(reason)` for a folder that could not be
//!   read or matched to a game, `Partial` (with every reason) when a limit stopped the walk. `Complete`
//!   with no findings means "none of this module's known signatures in the folders it walked", not
//!   "the game has no mods".
//! - `active`: `Some(true)` the mod's own loader is identified; `None` its settings are there and a
//!   DLL name it could load through is present but not identified (cannot tell), or the mod has no
//!   known loader name; `Some(false)` settings/logs only and no possible loader (a leftover: "the mod
//!   itself may no longer be active").
//! - Not referenced by support, evidence-upload, receipt or outbound code, and never reachable from
//!   the elevated helper (pinned below, as for `change_sources`).
//!
//! Parsing is pure and separate from I/O: `match_signatures` takes a hand-built listing.
//! Not folder mods, so not here: Lossless Scaling and RTSS / MSI Afterburner are separate running
//! apps (a later "running at start" slice).
#![allow(dead_code)] // wired into paramedic in the next commit

use crate::change_sources::{self, SteamLookup, UnreadableReason};
use chrono::{DateTime, Utc};
use serde::Serialize;
use std::collections::VecDeque;
use std::io::Read;
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
/// Most proxy-named DLLs whose version resource is read in one scan.
const MAX_DLL_PROBES: usize = 8;
/// Most evidence files listed for one mod.
const MAX_EVIDENCE: usize = 12;

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

/// One file that identified a mod. `file_name` is the table's own spelling, not the on-disk text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct EvidenceFile {
    pub file_name: &'static str,
    /// `None` when Windows would not give a modified time (never invented).
    pub modified: Option<DateTime<Utc>>,
    pub size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ModFinding {
    pub kind: ModKind,
    /// Same as `kind.display_name()`.
    pub name: &'static str,
    pub evidence: Vec<EvidenceFile>,
    /// See the module docs: `Some(true)` loader identified, `None` cannot tell, `Some(false)` leftover.
    pub active: Option<bool>,
    /// Only a value that matches `^[0-9A-Za-z.\-]{1,24}$`.
    pub version: Option<String>,
    /// The newest modified time among the evidence ("added or changed on").
    pub newest_change: Option<DateTime<Utc>>,
    /// Folders (relative to the scan root) the evidence was in; used to find a version text beside
    /// it. Private and never serialised: it holds folder names.
    #[serde(skip)]
    dirs: Vec<String>,
}

impl ModFinding {
    /// Settings or logs only, no possible loader: the mod itself may no longer be active.
    pub(crate) fn leftover_only(&self) -> bool {
        self.active == Some(false)
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
    /// More proxy-named DLLs than the probe limit; the rest were not checked.
    DllProbesLimited,
    /// One of several folders asked about could not be read.
    FolderUnreadable,
}

/// Why nothing could be read. Fixed codes, never Windows' (localised) error text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum ModUnreadable {
    FolderMissing,
    FolderUnreadable,
    TimedOutBeforeAnyEntry,
    /// The game could not be matched to exactly one install folder. Never "no mods".
    GameNotMatched,
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

/// What a scan found. `found` empty says nothing by itself: read `status` first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub(crate) struct ModScan {
    pub status: ScanStatus,
    pub found: Vec<ModFinding>,
}

impl ModScan {
    fn unreadable(why: ModUnreadable) -> ModScan {
        ModScan { status: ScanStatus::Unreadable(why), found: Vec::new() }
    }
}

/// One file in a listing. Built by the reader, or by hand in tests.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Entry {
    /// Folder relative to the scanned root, '/'-joined; "" for the root itself.
    pub dir: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<DateTime<Utc>>,
    /// Set by the reader only for a proxy-named DLL whose version resource named a known mod.
    pub product: Option<ModKind>,
}

// ---------------------------------------------------------------------------------------------
// The signature table (pure data)
// ---------------------------------------------------------------------------------------------

struct Named {
    /// Lower-case on-disk name that counts as evidence.
    lower: &'static str,
    /// The spelling shown.
    shown: &'static str,
    /// The file is the mod's own loader/runtime DLL, so the mod's loader is identified.
    own_loader: bool,
}

const fn cfg_file(lower: &'static str, shown: &'static str) -> Named {
    Named { lower, shown, own_loader: false }
}

const fn dll_file(lower: &'static str, shown: &'static str) -> Named {
    Named { lower, shown, own_loader: true }
}

struct Sig {
    kind: ModKind,
    named: &'static [Named],
    /// (lower-case file-name ending, fixed pattern shown). The on-disk name is never shown.
    suffixes: &'static [(&'static str, &'static str)],
    /// Proxy DLL names (lower-case) the mod can load through. Empty: no known loader name.
    loaders: &'static [&'static str],
}

const SIGS: [Sig; 7] = [
    Sig {
        kind: ModKind::OptiScaler,
        named: &[cfg_file("optiscaler.ini", "OptiScaler.ini"), cfg_file("optiscaler.log", "OptiScaler.log")],
        suffixes: &[],
        loaders: &["dxgi.dll", "winmm.dll", "version.dll", "dbghelp.dll", "d3d12.dll", "wininet.dll", "winhttp.dll", "nvngx.dll"],
    },
    Sig {
        kind: ModKind::AmdnrNeuralHub,
        named: &[
            cfg_file("neuralhub.ini", "neuralhub.ini"),
            cfg_file("neuralhub_host.dll", "neuralhub_host.dll"),
            cfg_file("dlssnr_on_amd.ini", "dlssnr_on_amd.ini"),
            cfg_file("dlssnr_on_amd.log", "dlssnr_on_amd.log"),
            cfg_file("dlssnr_on_amd_weights.bin", "dlssnr_on_amd_weights.bin"),
        ],
        suffixes: &[],
        loaders: &[],
    },
    Sig {
        kind: ModKind::ReShade,
        named: &[
            cfg_file("reshade.ini", "ReShade.ini"),
            cfg_file("reshadepreset.ini", "ReShadePreset.ini"),
            dll_file("reshade64.dll", "ReShade64.dll"),
            dll_file("reshade32.dll", "ReShade32.dll"),
        ],
        suffixes: &[],
        loaders: &["dxgi.dll", "d3d9.dll", "d3d10.dll", "d3d11.dll", "d3d12.dll", "opengl32.dll", "ddraw.dll"],
    },
    Sig {
        kind: ModKind::SpecialK,
        named: &[dll_file("specialk64.dll", "SpecialK64.dll"), dll_file("specialk32.dll", "SpecialK32.dll")],
        suffixes: &[],
        loaders: &["dxgi.dll", "d3d9.dll", "d3d11.dll", "dinput8.dll"],
    },
    Sig {
        kind: ModKind::Enb,
        named: &[cfg_file("enbseries.ini", "enbseries.ini"), cfg_file("enblocal.ini", "enblocal.ini")],
        suffixes: &[],
        loaders: &["d3d9.dll", "d3d10.dll", "d3d11.dll", "dxgi.dll"],
    },
    Sig {
        kind: ModKind::Dxvk,
        named: &[cfg_file("dxvk.conf", "dxvk.conf")],
        suffixes: &[(".dxvk-cache", "*.dxvk-cache")],
        loaders: &["d3d9.dll", "d3d10core.dll", "d3d11.dll", "dxgi.dll"],
    },
    Sig {
        kind: ModKind::DlssToFsrBridge,
        named: &[
            dll_file("dlssg_to_fsr3_amd_is_better.dll", "dlssg_to_fsr3_amd_is_better.dll"),
            dll_file("dlssg_to_fsr3_amd_is_better-3.1.dll", "dlssg_to_fsr3_amd_is_better-3.1.dll"),
        ],
        suffixes: &[],
        loaders: &[],
    },
];

/// Proxy-named DLLs whose version resource is read. A bare one is never a finding.
const PROXY_DLLS: &[&str] = &[
    "nvngx.dll",
    "dxgi.dll",
    "d3d8.dll",
    "d3d9.dll",
    "d3d10.dll",
    "d3d10core.dll",
    "d3d11.dll",
    "d3d12.dll",
    "ddraw.dll",
    "dinput8.dll",
    "dsound.dll",
    "winmm.dll",
    "version.dll",
    "xinput1_3.dll",
    "xinput1_4.dll",
    "xinput9_1_0.dll",
    "opengl32.dll",
    "wininet.dll",
    "winhttp.dll",
    "dbghelp.dll",
];

// ---------------------------------------------------------------------------------------------
// Pure matching
// ---------------------------------------------------------------------------------------------

/// The fixed spelling of a proxy-named DLL (the table's own, not the on-disk text).
fn proxy_shown(lower: &str) -> Option<&'static str> {
    PROXY_DLLS.iter().copied().find(|p| *p == lower)
}

/// Pure: a version string Compy will repeat. `^[0-9A-Za-z.\-]{1,24}$` with at least one digit.
fn clean_version(s: &str) -> Option<String> {
    let ok = (1..=24).contains(&s.len())
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        && s.chars().any(|c| c.is_ascii_digit());
    ok.then(|| s.to_string())
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

/// Pure: which known mod a DLL's version-resource strings name. Only OptiScaler's strings are known
/// (measured on a real install: ProductName "OptiScaler", OriginalFilename "OptiScaler.dll"); for any
/// other mod the exact strings are not known, so nothing is guessed.
fn kind_from_version_strings(v: &VersionStrings) -> Option<ModKind> {
    if v.product.trim().eq_ignore_ascii_case("optiscaler") || v.original_filename.trim().eq_ignore_ascii_case("optiscaler.dll") {
        return Some(ModKind::OptiScaler);
    }
    None
}

fn in_list(list: &[&str], lower: &str) -> bool {
    list.contains(&lower)
}

fn newer(a: Option<DateTime<Utc>>, b: Option<DateTime<Utc>>) -> bool {
    a > b
}

/// Pure: which known mods does this listing show, and in what state? No I/O.
///
/// A file counts only by an exact (case-insensitive) name from the table, a fixed name ending
/// (`.dxvk-cache`), or a reader-set `product` from a DLL's version resource. A bare proxy DLL
/// (dxgi.dll ...) and every file a game itself ships (nvngx_dlss*.dll, sl.*.dll ...) never count.
pub(crate) fn match_signatures(listing: &[Entry]) -> Vec<ModFinding> {
    let mut out = Vec::new();
    for sig in SIGS.iter() {
        let mut evidence: Vec<EvidenceFile> = Vec::new();
        let mut dirs: Vec<String> = Vec::new();
        let mut identified = false;
        for e in listing.iter().filter(|e| !e.is_dir) {
            let lower = e.name.to_ascii_lowercase();
            let by_product = e.product == Some(sig.kind);
            let hit: Option<(&'static str, bool)> = if let Some(n) = sig.named.iter().find(|n| n.lower == lower) {
                Some((n.shown, n.own_loader))
            } else if let Some((_, shown)) = sig.suffixes.iter().find(|(s, _)| lower.len() > s.len() && lower.ends_with(s)) {
                Some((*shown, false))
            } else if by_product {
                Some((proxy_shown(&lower).unwrap_or("(dll)"), true))
            } else {
                None
            };
            let Some((shown, own_loader)) = hit else { continue };
            identified |= own_loader || by_product;
            if !dirs.contains(&e.dir) {
                dirs.push(e.dir.clone());
            }
            match evidence.iter_mut().find(|x| x.file_name == shown) {
                Some(x) => {
                    if newer(e.modified, x.modified) {
                        x.modified = e.modified;
                        x.size = e.size;
                    }
                }
                None => evidence.push(EvidenceFile { file_name: shown, modified: e.modified, size: e.size }),
            }
        }
        if evidence.is_empty() {
            continue;
        }
        evidence.sort_by_key(|x| x.file_name);
        evidence.truncate(MAX_EVIDENCE);
        let loader_beside = listing
            .iter()
            .any(|e| !e.is_dir && dirs.contains(&e.dir) && in_list(sig.loaders, &e.name.to_ascii_lowercase()));
        let active = if identified {
            Some(true)
        } else if sig.loaders.is_empty() || loader_beside {
            None
        } else {
            Some(false)
        };
        let newest_change = evidence.iter().filter_map(|x| x.modified).max();
        out.push(ModFinding { kind: sig.kind, name: sig.kind.display_name(), evidence, active, version: None, newest_change, dirs });
    }
    out
}

// ---------------------------------------------------------------------------------------------
// The walk (bounded, no reparse points) - generic over the directory source so limits are testable
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct RawEntry {
    name: String,
    is_dir: bool,
    /// A junction, symlink or other reparse point: listed as skipped, never followed.
    is_link: bool,
    size: u64,
    modified: Option<SystemTime>,
}

/// One directory's entries, and whether some entry could not be read. `Err` when the directory
/// itself could not be listed.
type RawListing = Result<(Vec<RawEntry>, bool), std::io::ErrorKind>;

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

/// Breadth-first, `MAX_DEPTH` levels, at most `cap` entries, until `deadline`. `list` is given a
/// '/'-joined folder relative to the root. Only the root failing is an `Err`.
fn walk(list: &dyn Fn(&str) -> RawListing, deadline: Instant, cap: usize) -> Result<Walked, ModUnreadable> {
    let mut listing: Vec<Entry> = Vec::new();
    let mut reasons: Vec<PartialReason> = Vec::new();
    let mut queue: VecDeque<(String, usize)> = VecDeque::new();
    queue.push_back((String::new(), 0));
    let (mut seen, mut unreadable_dirs, mut links) = (0usize, 0usize, 0usize);
    'dirs: while let Some((dir, depth)) = queue.pop_front() {
        if Instant::now() >= deadline {
            push_reason(&mut reasons, PartialReason::TimeBudget);
            break;
        }
        let (raw, had_errors) = match list(&dir) {
            Ok(r) => r,
            Err(kind) if depth == 0 => {
                return Err(if kind == std::io::ErrorKind::NotFound { ModUnreadable::FolderMissing } else { ModUnreadable::FolderUnreadable });
            }
            Err(_) => {
                unreadable_dirs += 1;
                continue;
            }
        };
        if had_errors {
            unreadable_dirs += 1;
        }
        for r in raw {
            if seen >= cap {
                push_reason(&mut reasons, PartialReason::EntryCap);
                break 'dirs;
            }
            seen += 1;
            if r.is_link {
                links += 1;
                continue;
            }
            if r.is_dir {
                if depth < MAX_DEPTH {
                    queue.push_back((child_path(&dir, &r.name), depth + 1));
                }
                continue;
            }
            listing.push(Entry { dir: dir.clone(), name: r.name, is_dir: false, size: r.size, modified: r.modified.map(DateTime::<Utc>::from), product: None });
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
    Ok(Walked { listing, reasons })
}

#[cfg(windows)]
fn is_reparse(md: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    md.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 || md.file_type().is_symlink()
}

#[cfg(not(windows))]
fn is_reparse(md: &std::fs::Metadata) -> bool {
    md.file_type().is_symlink()
}

/// List one real directory without following links: `DirEntry::metadata` describes the entry itself.
fn list_real(dir: &Path) -> RawListing {
    let rd = std::fs::read_dir(dir).map_err(|e| e.kind())?;
    let mut out = Vec::new();
    let mut had_errors = false;
    for e in rd {
        let Ok(e) = e else {
            had_errors = true;
            continue;
        };
        let Ok(md) = e.metadata() else {
            had_errors = true;
            continue;
        };
        out.push(RawEntry {
            name: e.file_name().to_string_lossy().into_owned(),
            is_dir: md.is_dir(),
            is_link: is_reparse(&md),
            size: md.len(),
            modified: md.modified().ok(),
        });
    }
    Ok((out, had_errors))
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

// ---------------------------------------------------------------------------------------------
// DLL version-resource strings (read through Windows' own API; the file is mapped as data)
// ---------------------------------------------------------------------------------------------

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct VersionStrings {
    product: String,
    original_filename: String,
}

#[cfg(windows)]
mod verinfo {
    use super::VersionStrings;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};

    /// A version block larger than this is not read.
    const MAX_BLOCK: u32 = 1 << 20;
    const MAX_STRING_CHARS: usize = 256;

    /// Pointer into `block` for a sub-block, if Windows found it AND it lies inside `block`.
    /// SAFETY: `block` must be a buffer filled by `GetFileVersionInfoW`.
    unsafe fn query(block: &[u8], sub: &str) -> Option<(*const u8, usize)> {
        let wide: Vec<u16> = sub.encode_utf16().chain(std::iter::once(0)).collect();
        let mut ptr: *mut core::ffi::c_void = std::ptr::null_mut();
        let mut len = 0u32;
        if !VerQueryValueW(block.as_ptr().cast(), PCWSTR(wide.as_ptr()), &mut ptr, &mut len).as_bool() || ptr.is_null() || len == 0 {
            return None;
        }
        let start = block.as_ptr() as usize;
        let at = ptr as usize;
        (at >= start && at < start + block.len()).then_some((ptr as *const u8, len as usize))
    }

    /// SAFETY: as for `query`.
    unsafe fn string_value(block: &[u8], lang: u16, codepage: u16, key: &str) -> Option<String> {
        let (p, chars) = query(block, &format!("\\StringFileInfo\\{lang:04x}{codepage:04x}\\{key}"))?;
        let end = block.as_ptr() as usize + block.len();
        let chars = chars.min(MAX_STRING_CHARS);
        if p as usize + chars * 2 > end {
            return None;
        }
        let units: Vec<u16> = (0..chars).map(|i| p.cast::<u16>().add(i).read_unaligned()).take_while(|&u| u != 0).collect();
        Some(String::from_utf16_lossy(&units))
    }

    /// SAFETY: as for `query`.
    unsafe fn translations(block: &[u8]) -> Vec<(u16, u16)> {
        let mut out = vec![(0x0409, 0x04b0), (0x0409, 0x04e4), (0x0000, 0x04b0)];
        if let Some((p, bytes)) = query(block, "\\VarFileInfo\\Translation") {
            let end = block.as_ptr() as usize + block.len();
            let pairs = (bytes / 4).min(4);
            if p as usize + pairs * 4 <= end {
                let mut declared: Vec<(u16, u16)> =
                    (0..pairs).map(|i| (p.cast::<u16>().add(i * 2).read_unaligned(), p.cast::<u16>().add(i * 2 + 1).read_unaligned())).collect();
                declared.extend(out);
                out = declared;
            }
        }
        out
    }

    /// The product and original-file-name strings of `path`, or `None` when the file has none.
    pub(super) fn read(path: &Path) -> Option<VersionStrings> {
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
        let file = PCWSTR(wide.as_ptr());
        // SAFETY: `wide` is NUL-terminated and outlives the calls; `block` is exactly the size Windows
        // asked for, and every pointer VerQueryValueW returns is checked to lie inside it before use.
        unsafe {
            let size = GetFileVersionInfoSizeW(file, None);
            if size == 0 || size > MAX_BLOCK {
                return None;
            }
            let mut block = vec![0u8; size as usize];
            GetFileVersionInfoW(file, Some(0), size, block.as_mut_ptr().cast()).ok()?;
            for (lang, codepage) in translations(&block) {
                let product = string_value(&block, lang, codepage, "ProductName");
                let original = string_value(&block, lang, codepage, "OriginalFilename");
                if product.is_some() || original.is_some() {
                    return Some(VersionStrings { product: product.unwrap_or_default(), original_filename: original.unwrap_or_default() });
                }
            }
            None
        }
    }
}

#[cfg(windows)]
fn read_version_strings(path: &Path) -> Option<VersionStrings> {
    verinfo::read(path)
}

#[cfg(not(windows))]
fn read_version_strings(_path: &Path) -> Option<VersionStrings> {
    None
}

/// Name each proxy-named DLL that its version resource names a known mod. At most `MAX_DLL_PROBES`.
fn probe_dlls(root: &Path, listing: &mut [Entry], deadline: Instant, reasons: &mut Vec<PartialReason>) {
    let mut probes = 0usize;
    for e in listing.iter_mut().filter(|e| !e.is_dir) {
        if !in_list(PROXY_DLLS, &e.name.to_ascii_lowercase()) {
            continue;
        }
        if probes >= MAX_DLL_PROBES {
            push_reason(reasons, PartialReason::DllProbesLimited);
            break;
        }
        if Instant::now() >= deadline {
            push_reason(reasons, PartialReason::TimeBudget);
            break;
        }
        probes += 1;
        if let Some(v) = read_version_strings(&entry_path(root, e)) {
            e.product = kind_from_version_strings(&v);
        }
    }
}

/// The first bytes of a small text file; `None` for a file over the size cap or one that cannot be read.
fn read_head(path: &Path) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
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
            !e.is_dir && f.dirs.contains(&e.dir) && e.size <= MAX_TEXT_BYTES && in_list(&ATTRIBUTION_FILES, &e.name.to_ascii_lowercase())
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
    let list = |rel: &str| list_real(&rel_path(root, rel));
    let Walked { mut listing, mut reasons } = match walk(&list, deadline, MAX_ENTRIES) {
        Ok(w) => w,
        Err(why) => return ModScan::unreadable(why),
    };
    probe_dlls(root, &mut listing, deadline, &mut reasons);
    let mut found = match_signatures(&listing);
    attach_versions(root, &listing, &mut found, deadline);
    let status = status_of(reasons);
    ModScan { status, found }
}

/// Scan one folder (the game exe's folder, normally) and two levels below it. Read-only, bounded by
/// `budget`. `Unreadable` when the folder cannot be read; never "no mods" for a folder it could not look in.
pub(crate) fn scan_game_folder(root: &Path, budget: Duration) -> ModScan {
    scan_with_deadline(root, Instant::now() + budget)
}

/// Directories (other than `root`) below it, at most 5 deep, that hold a file `pred` accepts (given the
/// lower-case file name). Bounded in entries and time; never follows reparse points.
fn find_dirs_holding(root: &Path, deadline: Instant, pred: &dyn Fn(&str) -> bool, max_dirs: usize) -> Vec<PathBuf> {
    const MAX_FIND_DEPTH: usize = 5;
    const MAX_FIND_ENTRIES: usize = 8000;
    let mut hits = Vec::new();
    let mut queue: VecDeque<(PathBuf, usize)> = VecDeque::new();
    queue.push_back((root.to_path_buf(), 0));
    let mut seen = 0usize;
    while let Some((dir, depth)) = queue.pop_front() {
        if Instant::now() >= deadline || hits.len() >= max_dirs {
            break;
        }
        let Ok((entries, _)) = list_real(&dir) else { continue };
        let mut holds = false;
        for e in entries {
            seen += 1;
            if seen > MAX_FIND_ENTRIES {
                return hits;
            }
            if e.is_link {
                continue;
            }
            if e.is_dir {
                if depth < MAX_FIND_DEPTH {
                    queue.push_back((dir.join(&e.name), depth + 1));
                }
            } else if pred(&e.name.to_ascii_lowercase()) {
                holds = true;
            }
        }
        if holds && depth > 0 {
            hits.push(dir);
        }
    }
    hits
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
                if newer(ev.modified, x.modified) {
                    *x = ev;
                }
            }
            None => have.evidence.push(ev),
        }
    }
    have.evidence.sort_by_key(|x| x.file_name);
    have.evidence.truncate(MAX_EVIDENCE);
    have.active = match (have.active, f.active) {
        (Some(true), _) | (_, Some(true)) => Some(true),
        (None, _) | (_, None) => None,
        _ => Some(false),
    };
    have.version = have.version.take().or(f.version);
    have.newest_change = have.evidence.iter().filter_map(|x| x.modified).max();
    have.dirs.clear();
}

/// Combine scans of several folders of one game. Unreadable only when none could be read.
fn merge(scans: Vec<ModScan>) -> ModScan {
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
        return ModScan::unreadable(unreadable.into_iter().next().unwrap_or(ModUnreadable::GameNotMatched));
    }
    for u in unreadable {
        push_reason(&mut reasons, if u == ModUnreadable::TimedOutBeforeAnyEntry { PartialReason::TimeBudget } else { PartialReason::FolderUnreadable });
    }
    found.sort_by_key(|f| f.kind);
    let status = status_of(reasons);
    ModScan { status, found }
}

/// Scan a game's install folder and the folder holding its exe (`exe` when known, otherwise up to
/// four folders that hold a game-like program), one shared time budget.
pub(crate) fn scan_install_folder(root: &Path, exe: Option<&str>, budget: Duration) -> ModScan {
    let deadline = Instant::now() + budget;
    let mut scans = vec![scan_with_deadline(root, deadline)];
    let want = exe.map(|e| e.trim().to_ascii_lowercase()).filter(|e| !e.is_empty());
    let dirs = match &want {
        Some(w) => find_dirs_holding(root, deadline, &|n| n == w.as_str(), 1),
        None => find_dirs_holding(root, deadline, &is_game_like_exe, 4),
    };
    for d in dirs {
        scans.push(scan_with_deadline(&d, deadline));
    }
    merge(scans)
}

/// Scan the Steam install of the game whose process is `process_name`. A game that cannot be matched
/// to exactly one Steam install folder is `Unreadable`, never "no mods".
pub(crate) fn scan_for_process(process_name: &str) -> ModScan {
    scan_for_process_with(process_name, DEFAULT_BUDGET)
}

pub(crate) fn scan_for_process_with(process_name: &str, budget: Duration) -> ModScan {
    let exe = process_name.trim();
    if exe.is_empty() {
        return ModScan::unreadable(ModUnreadable::GameNotMatched);
    }
    match change_sources::find_steam_game(exe, change_sources::DEFAULT_BUDGET) {
        SteamLookup::Found(g) => match g.install_dir {
            Some(dir) => scan_install_folder(Path::new(&dir), Some(exe), budget),
            None => ModScan::unreadable(ModUnreadable::GameNotMatched),
        },
        SteamLookup::NotInSteam => ModScan::unreadable(ModUnreadable::GameNotMatched),
        SteamLookup::Unreadable(r) => ModScan::unreadable(ModUnreadable::Steam(r)),
    }
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn t(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    const WHEN: &str = "2026-11-03T21:12:08Z";

    fn fm(dir: &str, name: &str, size: u64, when: &str) -> Entry {
        Entry { dir: dir.into(), name: name.into(), is_dir: false, size, modified: Some(t(when)), product: None }
    }

    fn f(dir: &str, name: &str) -> Entry {
        fm(dir, name, 1000, WHEN)
    }

    fn product(mut e: Entry, kind: ModKind) -> Entry {
        e.product = Some(kind);
        e
    }

    fn kinds(found: &[ModFinding]) -> Vec<ModKind> {
        found.iter().map(|x| x.kind).collect()
    }

    fn evidence_names(x: &ModFinding) -> Vec<&'static str> {
        x.evidence.iter().map(|e| e.file_name).collect()
    }

    // ---- the table ------------------------------------------------------------------------------

    #[test]
    fn the_table_is_well_formed() {
        for sig in SIGS.iter() {
            for n in sig.named {
                assert_eq!(n.lower, n.lower.to_ascii_lowercase(), "match names are lower-case: {}", n.lower);
                assert!(n.shown.eq_ignore_ascii_case(n.lower), "the shown spelling is the same name: {}", n.shown);
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
        }
        // Declaration order is the output order, and every kind appears exactly once.
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
    }

    #[test]
    fn every_signature_has_a_positive_case_and_shows_the_tables_spelling() {
        let cases: [(ModKind, &str, &str); 19] = [
            (ModKind::OptiScaler, "OPTISCALER.INI", "OptiScaler.ini"),
            (ModKind::OptiScaler, "optiscaler.log", "OptiScaler.log"),
            (ModKind::AmdnrNeuralHub, "NeuralHub.ini", "neuralhub.ini"),
            (ModKind::AmdnrNeuralHub, "neuralhub_host.dll", "neuralhub_host.dll"),
            (ModKind::AmdnrNeuralHub, "dlssnr_on_amd.ini", "dlssnr_on_amd.ini"),
            (ModKind::AmdnrNeuralHub, "dlssnr_on_amd.log", "dlssnr_on_amd.log"),
            (ModKind::AmdnrNeuralHub, "dlssnr_on_amd_weights.bin", "dlssnr_on_amd_weights.bin"),
            (ModKind::ReShade, "ReShade.ini", "ReShade.ini"),
            (ModKind::ReShade, "ReShadePreset.ini", "ReShadePreset.ini"),
            (ModKind::ReShade, "RESHADE64.DLL", "ReShade64.dll"),
            (ModKind::ReShade, "reshade32.dll", "ReShade32.dll"),
            (ModKind::SpecialK, "SpecialK64.dll", "SpecialK64.dll"),
            (ModKind::SpecialK, "SPECIALK32.DLL", "SpecialK32.dll"),
            (ModKind::Enb, "enbseries.ini", "enbseries.ini"),
            (ModKind::Enb, "ENBLOCAL.INI", "enblocal.ini"),
            (ModKind::Dxvk, "dxvk.conf", "dxvk.conf"),
            (ModKind::Dxvk, "My Private Game.exe.dxvk-cache", "*.dxvk-cache"),
            (ModKind::DlssToFsrBridge, "dlssg_to_fsr3_amd_is_better.dll", "dlssg_to_fsr3_amd_is_better.dll"),
            (ModKind::DlssToFsrBridge, "dlssg_to_fsr3_amd_is_better-3.1.dll", "dlssg_to_fsr3_amd_is_better-3.1.dll"),
        ];
        for (kind, on_disk, shown) in cases {
            let found = match_signatures(&[f("", "Game.exe"), f("", on_disk)]);
            assert_eq!(found.len(), 1, "{on_disk}: {found:?}");
            assert_eq!(found[0].kind, kind, "{on_disk}");
            assert_eq!(found[0].name, kind.display_name());
            assert_eq!(evidence_names(&found[0]), vec![shown], "{on_disk}");
            assert_eq!(found[0].newest_change, Some(t(WHEN)));
            assert_eq!(found[0].version, None, "matching alone never invents a version");
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
        // A ".dxvk-cache" with no name before it is not a cache file.
        assert!(match_signatures(&[f("", ".dxvk-cache")]).is_empty());
    }

    #[test]
    fn a_proxy_dll_is_evidence_only_when_its_version_resource_names_the_mod() {
        let bare = [f("", "Game.exe"), f("", "dxgi.dll")];
        assert!(match_signatures(&bare).is_empty(), "a bare dxgi.dll is not a mod");
        let named = [f("", "Game.exe"), product(f("", "DXGI.DLL"), ModKind::OptiScaler)];
        let found = match_signatures(&named);
        assert_eq!(kinds(&found), vec![ModKind::OptiScaler]);
        assert_eq!(evidence_names(&found[0]), vec!["dxgi.dll"]);
        assert_eq!(found[0].active, Some(true), "the loader itself is identified");
    }

    // ---- real and hand-built layouts -----------------------------------------------------------

    /// The leftover layout on this PC (Phantom Blade Zero, 2026-11-20): names, sizes and times only,
    /// listed from the folder that held the exe (`platform/steam`).
    fn pbz_leftover() -> Vec<Entry> {
        let a = "AMDNR-NeuralHub-080";
        vec![
            fm(a, "amdnr-neuralhub-teardown.log", 0, "2026-11-01T20:40:26Z"),
            fm(a, "ATTRIBUTION.txt", 359, "2026-11-01T20:39:40Z"),
            fm(a, "dlssnr_on_amd.log", 33_179_052, "2026-11-03T21:14:16Z"),
            fm(a, "neuralhub.ini", 348, "2026-11-03T21:12:08Z"),
            fm(a, "neuralhub_host.dll", 101_768_704, "2026-10-18T11:50:18Z"),
            fm(a, "settings.ini", 26, "2026-11-01T20:39:40Z"),
            fm("AMDNR-NeuralHub-080/data", "index.ini", 506, "2026-11-01T20:39:40Z"),
            fm("AMDNR-NeuralHub-080/data", "nvngx_dlss.dll", 58_956_912, "2026-11-01T20:13:54Z"),
            fm("AMDNR-NeuralHub-080/data", "nvngx_dlssd.dll", 48_343_664, "2026-11-01T20:13:58Z"),
            fm("AMDNR-NeuralHub-080/data", "nvngx_dlssg.dll", 7_506_544, "2026-11-01T20:13:54Z"),
            fm("AMDNR-NeuralHub-080/data", "nvngx_dlssnr.dll", 266_424_944, "2026-11-01T20:39:33Z"),
            fm("AMDNR-Runtimes/neuralhub080", "nr-profile.ini", 2654, "2026-11-02T10:41:01Z"),
            fm("AMDNR-Runtimes/runtime-060", "dlssnr_on_amd.ini", 221, "2026-11-02T10:45:32Z"),
            fm("AMDNR-Runtimes/runtime-060", "dlssnr_on_amd.log", 99_956, "2026-11-02T10:54:55Z"),
        ]
    }

    #[test]
    fn the_real_amdnr_neuralhub_leftover_from_this_pc_is_found() {
        let found = match_signatures(&pbz_leftover());
        assert_eq!(kinds(&found), vec![ModKind::AmdnrNeuralHub]);
        let x = &found[0];
        assert_eq!(x.name, "AMDNR / NeuralHub");
        assert_eq!(evidence_names(x), vec!["dlssnr_on_amd.ini", "dlssnr_on_amd.log", "neuralhub.ini", "neuralhub_host.dll"]);
        // The same file name in two folders is one piece of evidence, with the newer file's facts.
        let log = x.evidence.iter().find(|e| e.file_name == "dlssnr_on_amd.log").unwrap();
        assert_eq!((log.size, log.modified), (33_179_052, Some(t("2026-11-03T21:14:16Z"))));
        assert_eq!(x.newest_change, Some(t("2026-11-03T21:14:16Z")));
        // The exe and any loader are gone, so it cannot be told whether the layer was loaded.
        assert_eq!(x.active, None);
        assert!(!x.leftover_only());
        // NVIDIA's own nvngx_dlss*.dll inside the layer's data folder are not evidence of anything.
        assert!(x.evidence.iter().all(|e| !e.file_name.starts_with("nvngx")));
    }

    #[test]
    fn a_wardogs_style_optiscaler_install_beside_the_launcher_is_found_with_its_neural_layer() {
        let l = vec![
            fm("", "danielblnc_ATTRIBUTION.txt", 1172, "2026-11-03T21:14:00Z"),
            fm("", "dlssnr_amd_pass1.dll", 56_677_888, "2026-11-03T21:14:00Z"),
            fm("", "dlssnr_on_amd_weights.bin", 147_689_451, "2026-11-03T21:14:00Z"),
            product(fm("", "dxgi.dll", 34_060_912, "2026-11-03T21:14:00Z"), ModKind::OptiScaler),
            fm("", "nvngx.dll_dlssnr.dll", 1_254_400, "2026-11-03T21:14:00Z"),
            fm("", "OptiScaler.ini", 183_000, "2026-11-02T12:14:00Z"),
            fm("", "WardogsLauncher-Shipping.exe", 1_339_288, "2026-10-02T23:21:00Z"),
            fm("OptiScaler", "amd_fidelityfx_upscaler_dx12.dll", 57_664_272, "2026-11-03T21:14:00Z"),
            fm("Licenses", "dlssg-to-fsr3_ATTRIBUTION.txt", 660, "2026-11-03T21:14:00Z"),
        ];
        let found = match_signatures(&l);
        assert_eq!(kinds(&found), vec![ModKind::OptiScaler, ModKind::AmdnrNeuralHub], "two mods at once, in table order");
        assert_eq!(evidence_names(&found[0]), vec!["OptiScaler.ini", "dxgi.dll"]);
        assert_eq!(found[0].active, Some(true));
        assert_eq!(found[0].newest_change, Some(t("2026-11-03T21:14:00Z")));
        assert_eq!(found[1].active, None);
        assert_eq!(evidence_names(&found[1]), vec!["dlssnr_on_amd_weights.bin"]);
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
        assert!(match_signatures(&unreal).is_empty());
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
        assert!(match_signatures(&unity).is_empty());
        // A game that legitimately ships dxgi.dll / d3d11.dll (an overlay, an anti-cheat, a launcher) with
        // no mod config beside it: nothing.
        let legit = [f("", "Game.exe"), f("", "dxgi.dll"), f("", "d3d11.dll"), f("", "dsound.dll"), f("", "winmm.dll"), f("", "version.dll")];
        assert!(match_signatures(&legit).is_empty());
    }

    #[test]
    fn settings_without_the_loader_are_a_leftover_and_the_state_follows_what_is_beside_them() {
        // ReShade.ini and nothing it could load through: leftover, the mod may no longer be active.
        let alone = match_signatures(&[f("", "Game.exe"), f("", "ReShade.ini"), f("", "ReShadePreset.ini")]);
        assert_eq!(alone[0].active, Some(false));
        assert!(alone[0].leftover_only());
        // A DLL ReShade can load through is beside the settings, but it is a bare name: cannot tell.
        let maybe = match_signatures(&[f("", "ReShade.ini"), f("", "dxgi.dll")]);
        assert_eq!(maybe[0].active, None);
        assert!(!maybe[0].leftover_only());
        // The same DLL in ANOTHER folder says nothing about these settings.
        let elsewhere = match_signatures(&[f("", "ReShade.ini"), f("bin", "dxgi.dll")]);
        assert_eq!(elsewhere[0].active, Some(false));
        // ReShade's own DLL is its loader.
        let own = match_signatures(&[f("", "ReShade.ini"), f("", "ReShade64.dll")]);
        assert_eq!(own[0].active, Some(true));
        // ENB settings with no d3d DLL: leftover; with one: cannot tell.
        assert_eq!(match_signatures(&[f("", "enbseries.ini")])[0].active, Some(false));
        assert_eq!(match_signatures(&[f("", "enbseries.ini"), f("", "d3d11.dll")])[0].active, None);
        // A DXVK cache file with no DXVK DLL is a leftover; the bridge DLL is itself the loader.
        assert_eq!(match_signatures(&[f("", "g.exe.dxvk-cache")])[0].active, Some(false));
        assert_eq!(match_signatures(&[f("", "dlssg_to_fsr3_amd_is_better.dll")])[0].active, Some(true));
        // OptiScaler.ini alone: leftover; with an unidentified proxy beside it: cannot tell.
        assert_eq!(match_signatures(&[f("", "OptiScaler.ini")])[0].active, Some(false));
        assert_eq!(match_signatures(&[f("", "OptiScaler.ini"), f("", "winmm.dll")])[0].active, None);
    }

    #[test]
    fn two_unrelated_mods_in_one_folder_are_both_reported_in_table_order() {
        let l = [f("", "SpecialK64.dll"), f("", "ReShade.ini"), f("", "OptiScaler.log"), f("", "enblocal.ini")];
        assert_eq!(kinds(&match_signatures(&l)), vec![ModKind::OptiScaler, ModKind::ReShade, ModKind::SpecialK, ModKind::Enb]);
    }

    #[test]
    fn evidence_is_capped_and_directories_are_never_evidence() {
        let mut dir = f("", "ReShade.ini");
        dir.is_dir = true;
        assert!(match_signatures(&[dir]).is_empty(), "a folder named like a config file is not a config file");
        let many: Vec<Entry> = (0..100).map(|i| f(&format!("d{i}"), "reshade.ini")).collect();
        let found = match_signatures(&many);
        assert_eq!(found[0].evidence.len(), 1, "the same name in many folders is one piece of evidence");
    }

    // ---- version strings -----------------------------------------------------------------------

    #[test]
    fn versions_are_only_repeated_when_they_match_the_allowed_shape() {
        assert_eq!(version_from_attribution("NeuralHub 0.8.0 by someone - DLSS SR / RR / FG\nhttps://x"), Some("0.8.0".into()));
        assert_eq!(version_from_attribution("\u{feff}neuralhub 1.2.3-rc1\r\nmore"), Some("1.2.3-rc1".into()));
        for bad in [
            "",
            "NeuralHub",
            "NeuralHub ",
            "Other 0.8.0",
            "NeuralHub ../../etc by x",
            "NeuralHub 0.8.0\u{202e} by x",
            "NeuralHub abc by x",
            "NeuralHub 0.8.0.0.0.0.0.0.0.0.0.0.0.0.0 by x",
            "NeuralHub \u{e9}\u{e9}1 by x",
            "\nNeuralHub 0.8.0",
        ] {
            assert_eq!(version_from_attribution(bad), None, "{bad:?}");
        }
        assert_eq!(clean_version("0.8.0"), Some("0.8.0".into()));
        assert_eq!(clean_version(&"1".repeat(24)), Some("1".repeat(24)));
        assert_eq!(clean_version(&"1".repeat(25)), None);
        assert_eq!(clean_version(""), None);
        assert_eq!(clean_version("1 2"), None);
        assert_eq!(clean_version("1_2"), None);
    }

    #[test]
    fn only_a_version_resource_that_names_a_known_mod_identifies_a_dll() {
        let v = |product: &str, orig: &str| VersionStrings { product: product.into(), original_filename: orig.into() };
        assert_eq!(kind_from_version_strings(&v("OptiScaler", "OptiScaler.dll")), Some(ModKind::OptiScaler));
        assert_eq!(kind_from_version_strings(&v("  optiscaler ", "")), Some(ModKind::OptiScaler));
        assert_eq!(kind_from_version_strings(&v("", "OPTISCALER.DLL")), Some(ModKind::OptiScaler));
        assert_eq!(kind_from_version_strings(&v("Microsoft Windows", "dxgi.dll")), None);
        assert_eq!(kind_from_version_strings(&v("OptiScaler Fan Club", "x.dll")), None);
        assert_eq!(kind_from_version_strings(&v("", "")), None);
    }

    // ---- the walk: limits, links, unreadable folders (in-memory directory source) ----------------

    fn rf(name: &str) -> RawEntry {
        RawEntry { name: name.into(), is_dir: false, is_link: false, size: 10, modified: None }
    }

    fn rd(name: &str) -> RawEntry {
        RawEntry { name: name.into(), is_dir: true, is_link: false, size: 0, modified: None }
    }

    fn rl(name: &str, is_dir: bool) -> RawEntry {
        RawEntry { name: name.into(), is_dir, is_link: true, size: 0, modified: None }
    }

    /// A directory source from a map of folder -> entries; a folder not in the map cannot be listed.
    fn mem(dirs: Vec<(&str, Vec<RawEntry>)>) -> impl Fn(&str) -> RawListing {
        let map: HashMap<String, Vec<RawEntry>> = dirs.into_iter().map(|(k, v)| (k.to_string(), v)).collect();
        move |rel| map.get(rel).cloned().map(|v| (v, false)).ok_or(std::io::ErrorKind::NotFound)
    }

    fn far() -> Instant {
        Instant::now() + Duration::from_secs(60)
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
        assert_eq!(
            seen,
            vec![("".into(), "a.txt".into()), ("a".into(), "b.txt".into()), ("a/b".into(), "c.txt".into())]
        );
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
        // Exactly the cap is a complete read; one more is not.
        let three = mem(vec![("", vec![rf("a"), rf("b"), rf("c")])]);
        assert!(walk(&three, far(), 3).unwrap().reasons.is_empty());
        assert_eq!(walk(&three, far(), 2).unwrap().reasons, vec![PartialReason::EntryCap]);
    }

    #[test]
    fn links_are_never_followed_and_make_the_scan_partial() {
        // "junction" is not in the map: following it would show up as an unreadable sub-folder.
        let src = mem(vec![("", vec![rf("ReShade.ini"), rl("junction", true), rl("linked.dll", false)])]);
        let w = walk(&src, far(), MAX_ENTRIES).unwrap();
        assert_eq!(w.listing.len(), 1);
        assert_eq!(w.reasons, vec![PartialReason::ReparsePointsSkipped(2)]);
    }

    #[test]
    fn an_unreadable_root_is_unreadable_and_an_unreadable_subfolder_is_partial() {
        let none = mem(vec![]);
        assert_eq!(walk(&none, far(), MAX_ENTRIES).err(), Some(ModUnreadable::FolderMissing));
        let denied = |_: &str| -> RawListing { Err(std::io::ErrorKind::PermissionDenied) };
        assert_eq!(walk(&denied, far(), MAX_ENTRIES).err(), Some(ModUnreadable::FolderUnreadable));
        let src = mem(vec![("", vec![rf("a.ini"), rd("locked")])]);
        let w = walk(&src, far(), MAX_ENTRIES).unwrap();
        assert_eq!(w.reasons, vec![PartialReason::SubfoldersUnreadable(1)]);
        // An entry Windows would not describe also counts.
        let flaky = |rel: &str| -> RawListing { if rel.is_empty() { Ok((vec![rf("a.ini")], true)) } else { Err(std::io::ErrorKind::NotFound) } };
        assert_eq!(walk(&flaky, far(), MAX_ENTRIES).unwrap().reasons, vec![PartialReason::SubfoldersUnreadable(1)]);
    }

    #[test]
    fn running_out_of_time_before_any_file_is_unreadable_not_clean() {
        let src = mem(vec![("", vec![rf("a.ini")])]);
        assert_eq!(walk(&src, Instant::now(), MAX_ENTRIES).err(), Some(ModUnreadable::TimedOutBeforeAnyEntry));
    }

    // ---- merge ---------------------------------------------------------------------------------

    #[test]
    fn merging_folders_keeps_every_gap_and_never_turns_unreadable_into_clean() {
        let one = |kind: ModKind, active: Option<bool>, when: &str| ModFinding {
            kind,
            name: kind.display_name(),
            evidence: vec![EvidenceFile { file_name: "ReShade.ini", modified: Some(t(when)), size: 1 }],
            active,
            version: None,
            newest_change: Some(t(when)),
            dirs: vec![],
        };
        let a = ModScan { status: ScanStatus::Complete, found: vec![one(ModKind::ReShade, Some(false), "2026-11-01T00:00:00Z")] };
        let b = ModScan { status: ScanStatus::Unreadable(ModUnreadable::FolderMissing), found: vec![] };
        let c = ModScan {
            status: ScanStatus::Partial { reasons: vec![PartialReason::EntryCap] },
            found: vec![one(ModKind::ReShade, None, "2026-11-05T00:00:00Z")],
        };
        let m = merge(vec![a.clone(), b.clone(), c]);
        assert_eq!(m.status, ScanStatus::Partial { reasons: vec![PartialReason::EntryCap, PartialReason::FolderUnreadable] });
        assert_eq!(m.found.len(), 1);
        assert_eq!(m.found[0].active, None, "leftover in one folder and unknown in another is unknown");
        assert_eq!(m.found[0].newest_change, Some(t("2026-11-05T00:00:00Z")));
        assert_eq!(merge(vec![b.clone(), b]).status, ScanStatus::Unreadable(ModUnreadable::FolderMissing));
        assert_eq!(merge(vec![a.clone(), a]).status, ScanStatus::Complete);
        let timed = ModScan { status: ScanStatus::Unreadable(ModUnreadable::TimedOutBeforeAnyEntry), found: vec![] };
        let ok = ModScan { status: ScanStatus::Complete, found: vec![] };
        assert_eq!(merge(vec![ok, timed]).status, ScanStatus::Partial { reasons: vec![PartialReason::TimeBudget] });
    }

    // ---- privacy -------------------------------------------------------------------------------

    #[test]
    fn nothing_but_table_text_and_dates_is_ever_serialised() {
        let l = vec![
            fm("Users/kuya/Secret Game", "Secret Game.exe.dxvk-cache", 5, WHEN),
            fm("Users/kuya/Secret Game", "ReShade.ini", 5, WHEN),
            fm("Users/kuya/Secret Game", "ATTRIBUTION.txt", 5, WHEN),
        ];
        let scan = ModScan { status: ScanStatus::Complete, found: match_signatures(&l) };
        let json = serde_json::to_string(&scan).unwrap();
        for leak in ["Secret", "kuya", "Users", "ATTRIBUTION", ".exe"] {
            assert!(!json.contains(leak), "{leak} leaked: {json}");
        }
        assert!(json.contains("*.dxvk-cache") && json.contains("ReShade.ini") && json.contains("\"name\":\"DXVK\""), "{json}");
    }

    // ---- real files (temp folders) -------------------------------------------------------------

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
    fn a_real_folder_is_scanned_end_to_end() {
        let root = temp_root("e2e");
        put(&root, "Game.exe", b"MZ");
        put(&root, "ReShade.ini", b"[GENERAL]\n");
        put(&root, "bin/dxgi.dll", b"MZ-not-a-real-dll");
        put(&root, "sub/neuralhub.ini", b"[Compute]\n");
        put(&root, "sub/ATTRIBUTION.txt", "NeuralHub 0.8.0 by someone \u{2014} DLSS\n".as_bytes());
        let scan = scan_game_folder(&root, Duration::from_secs(10));
        assert_eq!(scan.status, ScanStatus::Complete, "{scan:?}");
        assert_eq!(kinds(&scan.found), vec![ModKind::AmdnrNeuralHub, ModKind::ReShade]);
        assert_eq!(scan.found[0].version.as_deref(), Some("0.8.0"));
        assert_eq!(scan.found[1].active, Some(false), "the only dxgi.dll is in another folder and names no mod");
        assert!(scan.found.iter().all(|x| x.newest_change.is_some()));
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
        // The same text under the cap is read.
        put(&root, "ATTRIBUTION.txt", b"NeuralHub 0.8.0 by someone\n");
        assert_eq!(scan_game_folder(&root, Duration::from_secs(10)).found[0].version.as_deref(), Some("0.8.0"));
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
        // Remove the junction itself first so the target is never deleted through it.
        let _ = std::fs::remove_dir(root.join("linked"));
        let _ = std::fs::remove_dir_all(&root);
        let _ = std::fs::remove_dir_all(&target);
    }

    #[test]
    fn the_exe_folder_is_scanned_too_when_it_is_deeper_than_two_levels() {
        let root = temp_root("exedir");
        put(&root, "Launcher.exe", b"MZ");
        put(&root, "Game/Binaries/Win64/Game-Win64-Shipping.exe", b"MZ");
        put(&root, "Game/Binaries/Win64/ReShade.ini", b"x");
        assert!(scan_game_folder(&root, Duration::from_secs(10)).found.is_empty(), "three levels down is beyond the plain walk");
        let scan = scan_install_folder(&root, Some("game-win64-shipping.EXE"), Duration::from_secs(10));
        assert_eq!(scan.status, ScanStatus::Complete);
        assert_eq!(kinds(&scan.found), vec![ModKind::ReShade]);
        assert!(scan.found[0].leftover_only());
        // Without a program name, game-like programs are looked for; installers are not.
        assert_eq!(kinds(&scan_install_folder(&root, None, Duration::from_secs(10)).found), vec![ModKind::ReShade]);
        assert!(is_game_like_exe("wardogslauncher-shipping.exe") && !is_game_like_exe("vc_redist.x64.exe") && !is_game_like_exe("crashpad_handler.exe"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn the_version_resource_reader_reads_a_real_dll_and_ignores_a_file_without_one() {
        let sys = std::env::var("SystemRoot").unwrap_or_else(|_| "C:\\Windows".into());
        let k32 = Path::new(&sys).join("System32").join("kernel32.dll");
        if !k32.exists() {
            eprintln!("skipped: no kernel32.dll here");
            return;
        }
        let v = read_version_strings(&k32).expect("kernel32.dll carries a version resource");
        assert!(!v.product.is_empty() || !v.original_filename.is_empty(), "{v:?}");
        assert_eq!(kind_from_version_strings(&v), None, "a Windows DLL is not a mod");
        let root = temp_root("verinfo");
        put(&root, "dxgi.dll", b"MZ not a real image");
        assert_eq!(read_version_strings(&root.join("dxgi.dll")), None);
        assert_eq!(read_version_strings(&root.join("missing.dll")), None);
        // A proxy-named file with no version resource stays a non-finding end to end.
        assert!(scan_game_folder(&root, Duration::from_secs(10)).found.is_empty());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_process_that_cannot_be_matched_to_one_install_is_unreadable() {
        assert_eq!(scan_for_process("").status, ScanStatus::Unreadable(ModUnreadable::GameNotMatched));
        assert_eq!(scan_for_process("   ").status, ScanStatus::Unreadable(ModUnreadable::GameNotMatched));
        let scan = scan_for_process("zz-no-such-game-m2-Win64-Shipping.exe");
        assert!(matches!(scan.status, ScanStatus::Unreadable(_)), "an unmatched game must never read as clean: {scan:?}");
        assert!(scan.found.is_empty());
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
        // File names and dates of a game's folder are data about the user. Only lib.rs (the `mod` line),
        // this file and the diagnosis engine (paramedic.rs, the one planned consumer) may name the module;
        // scanning the whole source directory covers every payload module without naming any of them.
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
                // Its own isolation test lists this module in its allowlist (this module calls it); that line
                // is the only mention allowed.
                assert!(text.lines().filter(|l| l.contains("game_mods")).all(|l| l.contains("let allowed =")), "change_sources.rs reaches into game_mods");
                continue;
            }
            assert!(!text.contains("game_mods"), "{name} reaches into game_mods");
        }
        assert!(scanned > 30, "the scan must actually cover the crate's modules ({scanned})");
        let lib = include_str!("lib.rs");
        let lines: Vec<&str> = lib.lines().filter(|l| l.contains("game_mods")).collect();
        assert!(!lines.is_empty() && lines.iter().all(|l| l.trim_start().starts_with("mod game_mods;")), "{lines:?}");
        // The elevated helper never reaches it, by name or by its entry points.
        let body = fn_body(lib, "pub fn run_elevated_helper(");
        assert!(!body.contains("game_mods"));
        assert!(!include_str!("main.rs").contains("game_mods"));
        for f in ["scan_game_folder", "scan_install_folder", "scan_for_process", "match_signatures"] {
            assert!(!body.contains(f), "{f}");
        }
        // And this module only reads: no write, delete, spawn or network call in its non-test code.
        let all = include_str!("game_mods.rs");
        let code = &all[..all.find("#[cfg(test)]\nmod tests").unwrap()];
        for banned in ["std::fs::write", "File::create", "remove_file", "remove_dir", "OpenOptions", "std::process", "Command::new", "reqwest", "TcpStream", "LoadLibrary", "println!", "eprintln!", "log::"] {
            assert!(!code.contains(banned), "game_mods.rs non-test code must not use {banned}");
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

    fn describe(x: &ModFinding) -> String {
        let ev: Vec<String> = x.evidence.iter().map(|e| format!("{} ({} B, {})", e.file_name, e.size, e.modified.map_or("?".to_string(), |m| m.format("%Y-%m-%d").to_string()))).collect();
        format!(
            "{} | active={:?} | version={:?} | newest change {} | evidence: {}",
            x.name,
            x.active,
            x.version,
            x.newest_change.map_or("?".to_string(), |m| m.format("%Y-%m-%dT%H:%MZ").to_string()),
            ev.join(", ")
        )
    }

    /// `cargo test --lib game_mods::tests::real_pc_report -- --ignored --nocapture`
    #[test]
    #[ignore = "reads this PC's real Steam game folders; run on demand"]
    fn real_pc_report() {
        let mut times: Vec<u128> = Vec::new();
        let mut complete = 0usize;
        let mut partial: Vec<String> = Vec::new();
        let mut unreadable = 0usize;
        let mut games = 0usize;
        for lib in steam_libraries() {
            let Ok(rd) = std::fs::read_dir(lib.join("steamapps").join("common")) else { continue };
            for g in rd.flatten().filter(|g| g.path().is_dir()) {
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
            }
        }
        times.sort_unstable();
        println!(
            "games scanned: {games} | complete {complete} | partial {} | unreadable {unreadable}",
            partial.len()
        );
        for p in &partial {
            println!("PARTIAL {p}");
        }
        if !times.is_empty() {
            println!("time per scan (install folder + exe folders): median {} ms, max {} ms (budget {} ms)", times[times.len() / 2], times[times.len() - 1], DEFAULT_BUDGET.as_millis());
        }
        for lib in steam_libraries() {
            let pbz = lib.join("steamapps").join("common").join("PBZ").join("platform").join("steam");
            if pbz.is_dir() {
                let s = Instant::now();
                let scan = scan_game_folder(&pbz, DEFAULT_BUDGET);
                println!("PBZ leftover folder (where the exe was): status {:?} in {} ms", scan.status, s.elapsed().as_millis());
                for x in &scan.found {
                    println!("HIT PBZ leftover -> {}", describe(x));
                }
            }
        }
    }
}
