//! Which KNOWN programs were already running when a game session began.
//!
//! The process-start recorder only sees names that were absent the previous second, so anything
//! open BEFORE the game (a build, a clip recorder, a browser) never produced an event, and the
//! Paramedic could only say "no programs seen starting". This module remembers that blind spot's
//! contents, once per session, under a privacy rule that is part of the data shape.
//!
//! # Privacy rule (allowlist only)
//!
//! - Nothing taken from the machine is stored as text. A snapshot keeps a COUNT of all processes and
//!   the `id` + `category` of each [`PROGRAMS`] entry that matched. Ids and categories are constants
//!   of the table below; an unlisted process is counted in `total_processes` and never named.
//! - Matching is by exact image name, case-insensitive (`notmedal.exe` is not Medal).
//! - The table is reviewed in code: adding a row is a code change with a one-line `why`.
//! - A row is sanitised on LOAD: an id that is not in this build's table, a category that does not
//!   match the table's, a duplicate, or more entries than the table has are dropped, so a
//!   hand-edited or foreign row can never carry arbitrary text forward through a re-save.
//! - The fields are NOT part of the Export Snapshot a user may share (`export::redact_session_rows`):
//!   a list that can include a torrent client, meeting apps and developer tools says more about the
//!   person than that report needs. They stay in the local session row.
//!
//! # What a reader may say
//!
//! Presence is not a finding. A program being open is a fact about the PC, not an explanation of a
//! rough session, and it is never "caused". Never "nothing was running": the table is an allowlist,
//! so an empty `known` only means none of the programs Compy knows about were seen.
//!
//! - Programs with `always_resident == false` (a build, a recorder opened on purpose, a torrent
//!   client): [`already_running_sentence`] builds the one allowed line, "{name} was already running
//!   when {game} started."
//! - Programs with `always_resident == true` sit in the background on many PCs whether or not the
//!   user is doing anything with them (a driver overlay, Discord, a browser). They get NO line on
//!   their own ([`already_running_sentence`] returns `None`). The only allowed use is a comparison
//!   across sessions, via [`differs_between`]: "was running in 4 of 5 rough sessions and 1 of 6
//!   normal ones".
//! - [`NOT_RECORDED_SENTENCE`], "Compy didn't record what was running when this session started.",
//!   for `None` (old row, never recorded) AND for a snapshot that is not [`RunningAtStart::is_readable`].
//!
//! # Where it is taken
//!
//! `monitoring.rs`, on the first tick a frame names the session's process (for a relaunch that is the
//! tick `session_boundary::Tracker` begins the new session; for the first session of a capture it is
//! the tick the first frame arrives, not the moment monitoring started: `first_frame_offset_s` says
//! how long monitoring had been waiting). An enumeration that comes back empty is retried on the next
//! [`SNAPSHOT_RETRIES`] frame ticks before the snapshot is marked `unread`. It reuses the 1 Hz
//! names-only `sysinfo` enumeration the process-start detector already does: no second enumeration,
//! no new process spawn. The added cost is one pass over the names (measured in the tests).
#![cfg_attr(not(test), allow(dead_code))]

use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashSet;

use crate::stutter::StutterEvent;

/// What kind of load a listed program is known for. Stored on the row as kebab-case text.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Category {
    /// Clip recorders, capture and performance overlays, frame generators (GPU video encode, hooks).
    RecorderOverlay,
    /// Compilers, linkers and build drivers (heavy CPU/disk while they run).
    BuildTool,
    /// General developer runtimes that apps other than builds also use (see `node`).
    DeveloperTool,
    Browser,
    /// Launchers, updaters and torrent clients (open does not mean transferring).
    DownloadUpdate,
    /// Voice chat and meeting clients.
    VoiceMeeting,
    /// A category written by a newer Compy that this build does not know. Never produced here, and
    /// never kept on load (it cannot match the table's category).
    #[serde(other)]
    Unknown,
}

impl Category {
    /// Fixed display label for a category (a constant, never machine text).
    pub(crate) fn label(self) -> &'static str {
        match self {
            Category::RecorderOverlay => "recorder / overlay",
            Category::BuildTool => "build tool",
            Category::DeveloperTool => "developer tool",
            Category::Browser => "browser",
            Category::DownloadUpdate => "launcher / updater / torrent",
            Category::VoiceMeeting => "voice / meeting",
            Category::Unknown => "other",
        }
    }
}

/// One reviewed allowlist entry: a program family and the exact image names that identify it.
pub(crate) struct Program {
    /// Stable id stored on session rows. Kebab-case; never changes once shipped.
    pub id: &'static str,
    /// What a sentence may call it.
    pub display_name: &'static str,
    pub category: Category,
    /// True for programs that normally sit in the background whether or not the user is doing
    /// anything with them: their presence alone says nothing and gets no sentence of its own, only a
    /// cross-session comparison ([`differs_between`]).
    pub always_resident: bool,
    /// Exact image names, lower-case. Matching ignores ASCII case, never matches substrings.
    pub images: &'static [&'static str],
    /// One line: why this is on the list (and, if resident, why it is flagged).
    pub why: &'static str,
}

macro_rules! p {
    ($id:expr, $name:expr, $cat:ident, $resident:expr, [$($img:expr),+], $why:expr) => {
        Program { id: $id, display_name: $name, category: Category::$cat, always_resident: $resident, images: &[$($img),+], why: $why }
    };
}

/// The reviewed table (27 entries). Left out on purpose, with the reason:
/// - Steam overlay: part of every Steam game, presence says nothing.
/// - `nvcontainer.exe`: NVIDIA's generic service container (telemetry, display, sharing); it is always
///   running, so it cannot tell a recorder from an idle driver. Only the overlay/share processes are listed.
/// - `msmpeg.exe` (Defender): always running; a scan cannot be told from idle by presence.
/// - `java.exe` / Gradle: Gradle has no image of its own and `java.exe` is far too generic.
/// - `spotify.exe`: light; no evidence it moves a game's numbers.
/// - `onedrive.exe`: resident on nearly every Windows PC; presence is the weakest evidence in the list.
/// - `brave.exe`, `opera.exe`, `gcc.exe`, `clang.exe`, `cl.exe`: low value, and every name widens what a
///   row says about the person. A Rust/MSVC machine is covered by cargo, rustc and the linker/MSBuild.
/// - ReShade: a DLL inside the game, not a process. `obs32.exe`, `devenv.exe` (Visual Studio),
///   `msedgewebview2.exe` (embedded by many apps), `gamebarpresencewriter.exe` (runs on most PCs): not
///   confident enough that presence means load, so not listed.
/// - Steam downloads: not a separate process.
///
/// The NVIDIA overlay/Share, AMD Software and Game Bar names are from memory and still to be checked
/// on real installs (a wrong name only means no match).
pub(crate) const PROGRAMS: &[Program] = &[
    // --- recorders, overlays, frame generators ---
    p!("medal", "Medal", RecorderOverlay, true, ["medal.exe", "medalencoder.exe"], "clip recorder; its encoder uses GPU video encode while recording. Autostarts to the tray, so flagged resident"),
    p!("obs-studio", "OBS Studio", RecorderOverlay, false, ["obs64.exe"], "recording/streaming encode on CPU or GPU; opened on purpose, not resident"),
    p!("nvidia-overlay", "NVIDIA overlay / ShadowPlay", RecorderOverlay, true, ["nvidia share.exe", "nvidia overlay.exe"], "in-game overlay and Instant Replay capture; resident with the driver software"),
    p!("amd-software", "AMD Software overlay / ReLive", RecorderOverlay, true, ["radeonsoftware.exe", "amdrsserv.exe"], "Adrenalin overlay and ReLive service; present on every AMD PC"),
    p!("xbox-game-bar", "Xbox Game Bar", RecorderOverlay, true, ["gamebar.exe", "gamebarftserver.exe", "broadcastdvrserver.exe"], "Windows capture/overlay; its background servers run whenever Game Bar is enabled"),
    p!("overwolf", "Overwolf", RecorderOverlay, true, ["overwolf.exe"], "overlay platform that hooks games and runs in-game apps; autostarts to the tray"),
    p!("lossless-scaling", "Lossless Scaling", RecorderOverlay, false, ["losslessscaling.exe"], "frame generation / upscaling that takes a large GPU share; started on purpose"),
    p!("rtss", "RivaTuner Statistics Server", RecorderOverlay, true, ["rtss.exe"], "overlay and frame limiter that hooks the game's present call; autostarts with Afterburner"),
    p!("msi-afterburner", "MSI Afterburner", RecorderOverlay, true, ["msiafterburner.exe"], "overlay and GPU tuning; autostarts to the tray and can hold clocks or fan curves"),
    // --- build / compile ---
    p!("cargo", "cargo", BuildTool, false, ["cargo.exe"], "Rust build driver; saturates CPU and disk while building"),
    p!("rustc", "rustc", BuildTool, false, ["rustc.exe"], "Rust compiler"),
    p!("clippy", "clippy", BuildTool, false, ["clippy-driver.exe"], "Rust lint driver (a compile)"),
    p!("msvc-linker", "the MSVC linker", BuildTool, false, ["link.exe"], "linker step of native builds; heavy memory and disk"),
    p!("msbuild", "MSBuild", BuildTool, false, ["msbuild.exe"], "Visual Studio build driver"),
    // --- developer tools that other apps also use ---
    p!("node", "Node.js", DeveloperTool, false, ["node.exe"], "tsc, vitest and dev servers run on it, but some apps bundle node.exe too, so it is its own category"),
    p!("rust-analyzer", "rust-analyzer", DeveloperTool, false, ["rust-analyzer.exe"], "editor language server; re-indexes heavily after edits"),
    // --- browsers (presence only: process counts are noisy) ---
    p!("chrome", "Chrome", Browser, true, ["chrome.exe"], "video, tabs and background pages use CPU, GPU decode and RAM; background apps keep it resident"),
    p!("edge", "Edge", Browser, true, ["msedge.exe"], "same; startup boost keeps it resident after it is closed"),
    p!("firefox", "Firefox", Browser, false, ["firefox.exe"], "same load; closing it ends the process, so presence means it is open"),
    // --- launchers, updaters, torrents (open does not mean transferring) ---
    p!("epic-launcher", "Epic Games Launcher", DownloadUpdate, true, ["epicgameslauncher.exe"], "downloads and patches games; autostarts to the tray"),
    p!("battle-net", "Battle.net", DownloadUpdate, true, ["battle.net.exe"], "downloads and patches games; autostarts to the tray"),
    p!("windows-update", "Windows Update servicing", DownloadUpdate, false, ["tiworker.exe", "trustedinstaller.exe"], "servicing runs only while updates install; heavy disk and CPU"),
    p!("qbittorrent", "qBittorrent", DownloadUpdate, false, ["qbittorrent.exe"], "a torrent client transferring during play is a real, common cause of lag; presence still does not say it was transferring"),
    // --- voice chat and meetings ---
    p!("discord", "Discord", VoiceMeeting, true, ["discord.exe"], "voice chat first; in-game overlay and screen share (presence only: many processes)"),
    p!("zoom", "Zoom", VoiceMeeting, true, ["zoom.exe"], "the resident Zoom client, open on many PCs with no meeting running"),
    p!("zoom-meeting", "Zoom (in a meeting)", VoiceMeeting, false, ["cpthost.exe"], "Zoom's meeting-time process: far better evidence than zoom.exe alone"),
    p!("teams", "Microsoft Teams", VoiceMeeting, true, ["teams.exe", "ms-teams.exe"], "meeting client (classic and new Teams); resident in the tray"),
];

/// The table entry whose image names include `image` (exact, ASCII case-insensitive), if any.
pub(crate) fn lookup(image: &str) -> Option<&'static Program> {
    PROGRAMS.iter().find(|p| p.images.iter().any(|i| image.eq_ignore_ascii_case(i)))
}

fn table_entry(id: &str) -> Option<&'static Program> {
    PROGRAMS.iter().find(|p| p.id == id)
}

/// A listed program seen running at the start. Only table constants: `id` is a [`PROGRAMS`] id.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct KnownProgram {
    pub id: String,
    pub category: Category,
}

/// PURE: keep only entries that are exactly a table entry (id in the table, category equal to the
/// table's), once each, and never more than the table has. Everything else is dropped.
fn sanitise_known(raw: impl IntoIterator<Item = KnownProgram>) -> Vec<KnownProgram> {
    let mut out: Vec<KnownProgram> = Vec::new();
    for k in raw {
        if out.len() >= PROGRAMS.len() {
            break;
        }
        let Some(p) = table_entry(&k.id) else { continue };
        if p.category != k.category || out.iter().any(|o| o.id == p.id) {
            continue;
        }
        out.push(KnownProgram { id: p.id.to_string(), category: p.category });
    }
    out
}

/// Load `known` leniently and sanitised: a malformed entry is skipped, a foreign one dropped.
fn known_lenient<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<KnownProgram>, D::Error> {
    let raw = Vec::<serde_json::Value>::deserialize(d)?;
    Ok(sanitise_known(raw.into_iter().filter_map(|v| serde_json::from_value::<KnownProgram>(v).ok())))
}

/// The listed programs that were running when a session began. Absent on the row (`None`) = not
/// recorded: the row is older than this field, or no frame ever named the process. A reader treats
/// `None` and a snapshot that is not [`Self::is_readable`] as "Compy couldn't see", never as "nothing
/// was running".
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct RunningAtStart {
    /// Seconds after the session began (the clock `stutter_events.at_secs` uses) when the snapshot
    /// was taken: the first frame tick, or a later one if the enumeration had to be retried.
    #[serde(default)]
    pub taken_at_offset_s: u32,
    /// Seconds after the session began when the first frame named the process. For the first session
    /// of a capture this is how long monitoring had been waiting for the game, so a reader can tell
    /// a snapshot taken right at the game's launch from one that followed a long wait. `None` on a
    /// row that does not say.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub first_frame_offset_s: Option<u32>,
    /// Every process in the snapshot, listed or not. Context for "we looked at N processes".
    #[serde(default)]
    pub total_processes: u32,
    /// Listed programs seen, in table order, one per program however many processes it runs.
    /// Sanitised on load (see the module docs).
    #[serde(default, deserialize_with = "known_lenient")]
    pub known: Vec<KnownProgram>,
    /// The process list could not be read (an empty enumeration, even after retries): `known` is
    /// empty because Compy could not see, not because nothing was there.
    #[serde(default)]
    pub unread: bool,
}

impl RunningAtStart {
    /// A snapshot that really saw the machine: not `unread`, and it looked at least one process (a
    /// read snapshot never has zero; a row that says otherwise was hand-made or damaged).
    pub(crate) fn is_readable(&self) -> bool {
        !self.unread && self.total_processes > 0
    }

    fn has(&self, id: &str) -> bool {
        self.known.iter().any(|k| k.id == id)
    }
}

/// Load a whole `running_at_start` leniently: a value that is not a snapshot at all reads as `None`
/// (not recorded) instead of failing the session row it sits on.
pub(crate) fn lenient<'de, D: Deserializer<'de>>(d: D) -> Result<Option<RunningAtStart>, D::Error> {
    let v = Option::<serde_json::Value>::deserialize(d)?;
    Ok(v.and_then(|v| serde_json::from_value::<RunningAtStart>(v).ok()))
}

/// PURE: build the snapshot from the names the recorder's enumeration already produced. `total_processes`
/// of 0 is a failed enumeration (a running Windows PC always has processes) and reads as `unread`.
pub(crate) fn snapshot<'a>(
    names: impl IntoIterator<Item = &'a str>,
    total_processes: u32,
    taken_at_offset_s: u32,
    first_frame_offset_s: u32,
) -> RunningAtStart {
    let first_frame_offset_s = Some(first_frame_offset_s);
    if total_processes == 0 {
        return RunningAtStart { taken_at_offset_s, first_frame_offset_s, total_processes: 0, known: Vec::new(), unread: true };
    }
    let mut seen: HashSet<&'static str> = HashSet::new();
    for n in names {
        if let Some(p) = lookup(n) {
            seen.insert(p.id);
        }
    }
    let known = PROGRAMS
        .iter()
        .filter(|p| seen.contains(p.id))
        .map(|p| KnownProgram { id: p.id.to_string(), category: p.category })
        .collect();
    RunningAtStart { taken_at_offset_s, first_frame_offset_s, total_processes, known, unread: false }
}

/// One listed program that was present, as a reader may see it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ProgramPresence {
    pub id: &'static str,
    /// Table display name.
    pub name: &'static str,
    /// True: sits in the background on many PCs; NOT a finding on its own (see the module docs).
    pub always_resident: bool,
}

/// The listed programs of one category that were present, in table order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CategoryPresence {
    pub category: Category,
    pub programs: Vec<ProgramPresence>,
}

/// Per-category presence for a reader. `read == false` means "Compy couldn't see": use
/// [`NOT_RECORDED_SENTENCE`] and nothing else. An empty `by_category` with `read == true` means none
/// of the listed programs were seen, which is not "nothing was running". Presence alone is not a
/// finding; `always_resident` programs get no sentence at all (see [`already_running_sentence`]).
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct StartSummary {
    pub read: bool,
    pub by_category: Vec<CategoryPresence>,
}

/// PURE: summarise a snapshot. Ids not in this build's table are skipped; names and flags come only
/// from the table.
pub(crate) fn summarise(r: &RunningAtStart) -> StartSummary {
    if !r.is_readable() {
        return StartSummary { read: false, by_category: Vec::new() };
    }
    let mut by_category: Vec<CategoryPresence> = Vec::new();
    for p in PROGRAMS.iter().filter(|p| r.has(p.id)) {
        let presence = ProgramPresence { id: p.id, name: p.display_name, always_resident: p.always_resident };
        match by_category.iter_mut().find(|c| c.category == p.category) {
            Some(c) => c.programs.push(presence),
            None => by_category.push(CategoryPresence { category: p.category, programs: vec![presence] }),
        }
    }
    by_category.sort_by_key(|c| c.category);
    StartSummary { read: true, by_category }
}

/// The one allowed line for a program on its own: "{name} was already running when {game} started."
/// It states presence, nothing more: never "caused", never an explanation of a rough session. Returns
/// `None` for an `always_resident` program, which must not be surfaced on its own at all.
pub(crate) fn already_running_sentence(p: &ProgramPresence, game: &str) -> Option<String> {
    (!p.always_resident).then(|| format!("{} was already running when {game} started.", p.name))
}

/// The only sentence for a row with no usable snapshot (`None` or not readable).
pub(crate) const NOT_RECORDED_SENTENCE: &str = "Compy didn't record what was running when this session started.";

/// "n of m" sessions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct NofM {
    pub n: u32,
    pub of: u32,
}

/// A listed program whose presence differs between the rough and the normal sessions.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Difference {
    pub id: &'static str,
    pub in_rough: NofM,
    pub in_normal: NofM,
}

impl Difference {
    /// True when the program was present in a LARGER share of the rough sessions than of the normal
    /// ones: the only direction a reader may phrase as "was running in the rough sessions and not
    /// (as often) in the normal ones".
    pub(crate) fn more_in_rough(&self) -> bool {
        u64::from(self.in_rough.n) * u64::from(self.in_normal.of) > u64::from(self.in_normal.n) * u64::from(self.in_rough.of)
    }
}

/// PURE: the listed programs whose share of sessions differs between the rough sessions and the
/// normal ones, in table order. Only snapshots that [`RunningAtStart::is_readable`] count (a
/// session with no snapshot or an unread one is left out of both sides, and callers pass only the
/// rows that have one); with no readable snapshot on either side there is nothing to compare, so the
/// result is empty. This is the ONLY allowed use of an `always_resident` program's presence.
pub(crate) fn differs_between(rough: &[&RunningAtStart], normal: &[&RunningAtStart]) -> Vec<Difference> {
    fn readable<'a>(s: &[&'a RunningAtStart]) -> Vec<&'a RunningAtStart> {
        s.iter().copied().filter(|r| r.is_readable()).collect()
    }
    let (rough, normal) = (readable(rough), readable(normal));
    if rough.is_empty() || normal.is_empty() {
        return Vec::new();
    }
    let (of_rough, of_normal) = (rough.len() as u32, normal.len() as u32);
    PROGRAMS
        .iter()
        .filter_map(|p| {
            let n_rough = rough.iter().filter(|r| r.has(p.id)).count() as u32;
            let n_normal = normal.iter().filter(|r| r.has(p.id)).count() as u32;
            let same = u64::from(n_rough) * u64::from(of_normal) == u64::from(n_normal) * u64::from(of_rough);
            (!same).then_some(Difference {
                id: p.id,
                in_rough: NofM { n: n_rough, of: of_rough },
                in_normal: NofM { n: n_normal, of: of_normal },
            })
        })
        .collect()
}

/// The recorder's per-tick name diff goes quiet after this many events (unchanged threshold).
pub(crate) const EVENT_CAP: usize = 50;
/// A tick with more new names than this is a launch burst, not one culprit (unchanged threshold).
pub(crate) const MAX_NEW_NAMES_PER_TICK: usize = 4;
/// Frame ticks after the first on which an empty enumeration is retried before `unread` is recorded.
pub(crate) const SNAPSHOT_RETRIES: u8 = 2;

/// OS chatter that constantly starts/stops: never the culprit, would drown the signal.
const PROC_IGNORE: [&str; 8] = [
    "svchost",
    "conhost",
    "dllhost",
    "runtimebroker",
    "backgroundtaskhost",
    "wmiprvse",
    "taskhostw",
    "searchprotocolhost",
];

fn is_chatter(name: &str) -> bool {
    let lower = name.to_lowercase();
    let base = lower.strip_suffix(".exe").unwrap_or(&lower);
    base == "compy" || PROC_IGNORE.contains(&base)
}

/// One session's process-start watch: the 1 Hz name diff behind the "process-start" events, the
/// one-time start snapshot, and counters for what the diff could not list. Pure: the caller hands it
/// each tick's enumeration.
#[derive(Default)]
pub(crate) struct StartWatch {
    prev: Option<HashSet<String>>,
    running: Option<RunningAtStart>,
    /// Offset of the first tick a frame named the process; counters never look before it.
    first_frame_at: Option<u32>,
    empty_tries: u8,
    /// Offsets of ticks skipped as bursts, and `(offset, count)` of starts dropped at the cap, kept
    /// with their time so `finish` can trim them to the session's end like the event log.
    skipped_at: Vec<u32>,
    dropped_at: Vec<(u32, u32)>,
}

impl StartWatch {
    /// One tick's enumeration. `names` are the distinct image names and `total` the process count;
    /// `frame_this_tick` is true when a frame named the session's process this tick (the first such
    /// tick takes the snapshot; an empty enumeration is retried on the next [`SNAPSHOT_RETRIES`] frame
    /// ticks); `at_cap` is true when the session's event log was already full at the start of the
    /// tick. Returns the process-start events to log. A tick with more than
    /// [`MAX_NEW_NAMES_PER_TICK`] new names is not listed and counted as skipped; names that would
    /// have been listed at the cap are counted as dropped. Neither counter looks at ticks before the
    /// session's first frame (events are still listed there, as before).
    pub(crate) fn observe(
        &mut self,
        names: HashSet<String>,
        total: u32,
        at_cap: bool,
        elapsed: u32,
        frame_this_tick: bool,
    ) -> Vec<StutterEvent> {
        if frame_this_tick {
            let first = *self.first_frame_at.get_or_insert(elapsed);
            if self.running.is_none() {
                let r = snapshot(names.iter().map(String::as_str), total, elapsed, first);
                if r.unread && self.empty_tries < SNAPSHOT_RETRIES {
                    self.empty_tries += 1;
                } else {
                    self.running = Some(r);
                }
            }
        }
        // A failed enumeration (no processes at all) is no tick: diffing it would make the next good
        // tick look like a launch burst. The previous names stay for the next real comparison.
        if total == 0 {
            return Vec::new();
        }
        let counting = self.first_frame_at.is_some();
        let mut out = Vec::new();
        if let Some(prev) = &self.prev {
            let new: Vec<&String> = names.difference(prev).collect();
            if new.len() > MAX_NEW_NAMES_PER_TICK {
                if counting {
                    self.skipped_at.push(elapsed);
                }
            } else {
                let mut dropped = 0u32;
                for n in new.into_iter().filter(|n| !is_chatter(n)) {
                    if at_cap {
                        dropped += 1;
                    } else {
                        out.push(StutterEvent { at_secs: elapsed, kind: "process-start".into(), label: format!("{n} starting") });
                    }
                }
                if dropped > 0 && counting {
                    self.dropped_at.push((elapsed, dropped));
                }
            }
        }
        self.prev = Some(names);
        out
    }

    /// At save: the start snapshot (`None` if no frame ever named the process) and the two counters.
    /// `trim_to` is the session's end offset when the session ended at its last reading (the same
    /// trim the event log gets); `None` keeps everything (a capture stopped while it was open).
    pub(crate) fn finish(self, trim_to: Option<u32>) -> (Option<RunningAtStart>, u32, u32) {
        let inside = |at: u32| trim_to.is_none_or(|end| at <= end);
        let skipped = self.skipped_at.iter().filter(|&&t| inside(t)).count() as u32;
        let dropped = self.dropped_at.iter().filter(|(t, _)| inside(*t)).map(|(_, n)| *n).sum();
        (self.running, skipped, dropped)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_state::GameStateFingerprint;
    use crate::session_boundary::Tracker;
    use serde_json::json;

    fn set(names: &[&str]) -> HashSet<String> {
        names.iter().map(|s| s.to_string()).collect()
    }

    fn ids(r: &RunningAtStart) -> Vec<&str> {
        r.known.iter().map(|k| k.id.as_str()).collect()
    }

    /// A believable machine: OS chatter plus a few ordinary names, `extra` on top.
    fn machine(extra: &[&str]) -> HashSet<String> {
        let mut s = set(&["System", "explorer.exe", "svchost.exe", "csrss.exe", "Compy.exe", "game.exe"]);
        s.extend(extra.iter().map(|e| e.to_string()));
        s
    }

    fn snap(extra: &[&str]) -> RunningAtStart {
        let n = machine(extra);
        snapshot(n.iter().map(String::as_str), n.len() as u32, 0, 0)
    }

    fn event_labels(events: &[StutterEvent]) -> Vec<String> {
        let mut v: Vec<String> = events.iter().map(|e| format!("{}|{}|{}", e.at_secs, e.kind, e.label)).collect();
        v.sort();
        v
    }

    #[test]
    fn the_table_is_small_unique_lowercase_and_leaves_out_the_generic_names() {
        assert!(PROGRAMS.len() <= 45, "{} entries", PROGRAMS.len());
        let mut seen_ids = HashSet::new();
        let mut seen_images = HashSet::new();
        for p in PROGRAMS {
            assert!(seen_ids.insert(p.id), "duplicate id {}", p.id);
            assert!(p.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'), "{}", p.id);
            assert!(!p.display_name.is_empty() && !p.why.is_empty(), "{} needs a name and a why", p.id);
            assert!(!p.images.is_empty());
            for i in p.images {
                assert_eq!(*i, i.to_ascii_lowercase(), "{i} must be lower-case");
                assert!(i.ends_with(".exe"), "{i}");
                assert!(seen_images.insert(*i), "image {i} listed twice");
            }
        }
        for generic in ["svchost.exe", "java.exe", "nvcontainer.exe", "msmpeg.exe", "steam.exe", "spotify.exe", "conhost.exe"] {
            assert!(lookup(generic).is_none(), "{generic} was deliberately left out");
        }
        // Dropped in review: low value, or resident on every PC.
        for dropped in ["onedrive.exe", "brave.exe", "opera.exe", "gcc.exe", "clang.exe", "cl.exe"] {
            assert!(lookup(dropped).is_none(), "{dropped} was removed from the table");
        }
        assert!(lookup("clippy-driver.exe").is_some() && lookup("qbittorrent.exe").is_some());
    }

    #[test]
    fn the_table_flags_what_sits_in_the_background_and_files_discord_and_zoom_properly() {
        let flag = |id: &str| table_entry(id).unwrap().always_resident;
        for resident in ["amd-software", "nvidia-overlay", "xbox-game-bar", "discord", "edge", "chrome", "teams", "zoom"] {
            assert!(flag(resident), "{resident} sits in the background on many PCs");
        }
        for deliberate in ["cargo", "rustc", "msbuild", "obs-studio", "qbittorrent", "zoom-meeting", "windows-update"] {
            assert!(!flag(deliberate), "{deliberate} is started on purpose or only runs while it works");
        }
        assert_eq!(table_entry("discord").unwrap().category, Category::VoiceMeeting);
        assert_eq!(lookup("cpthost.exe").map(|p| p.id), Some("zoom-meeting"));
        assert_eq!(lookup("Zoom.exe").map(|p| p.id), Some("zoom"));
    }

    #[test]
    fn matching_is_exact_image_name_ignoring_case_and_never_a_substring() {
        for hit in ["medal.exe", "Medal.exe", "MEDAL.EXE", "MedalEncoder.exe", "NVIDIA Share.exe", "Battle.net.exe", "ms-teams.exe"] {
            assert!(lookup(hit).is_some(), "{hit} should match");
        }
        for miss in ["notmedal.exe", "medal.exe.bak", "medal", "xmedal.exe", "medal.exe ", " medal.exe", "chrome", "chromedriver.exe", "nvidia sharex.exe", "node", "nodemon.exe", ""] {
            assert!(lookup(miss).is_none(), "{miss:?} must not match");
        }
        assert_eq!(lookup("OBS64.EXE").map(|p| p.id), Some("obs-studio"));
        assert_eq!(lookup("medalencoder.exe").map(|p| p.id), Some("medal"));
    }

    #[test]
    fn a_snapshot_keeps_the_known_ids_the_total_and_nothing_else() {
        let names = machine(&["Medal.exe", "MedalEncoder.exe", "chrome.exe", "cargo.exe", "totally-private-tool.exe", "node.exe"]);
        let total = names.len() as u32 + 12; // many processes share a name (chrome)
        let r = snapshot(names.iter().map(String::as_str), total, 7, 5);
        assert_eq!(ids(&r), ["medal", "cargo", "node", "chrome"], "table order, one per program");
        assert_eq!(
            r.known.iter().map(|k| k.category).collect::<Vec<_>>(),
            [Category::RecorderOverlay, Category::BuildTool, Category::DeveloperTool, Category::Browser]
        );
        assert_eq!((r.taken_at_offset_s, r.first_frame_offset_s, r.total_processes, r.unread), (7, Some(5), total, false));
        // Nothing else is stored: the whole row is these five fields.
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v.as_object().unwrap().len(), 5, "{v}");
    }

    #[test]
    fn a_pc_with_none_of_the_listed_programs_reads_as_read_and_empty() {
        let r = snap(&[]);
        assert!(r.known.is_empty() && !r.unread && r.is_readable());
        let s = summarise(&r);
        assert!(s.read && s.by_category.is_empty(), "none of the listed programs, which is not 'nothing was running'");
    }

    #[test]
    fn the_serialised_row_holds_no_name_outside_the_table() {
        let r = snap(&["Medal.exe", "chrome.exe", "kuya-secret-project.exe", "C:\\Users\\Kuya\\Desktop\\payroll.exe", "Kuya's Game Launcher.exe", "pootytxng-sync.exe"]);
        let g = GameStateFingerprint::default().with_running_at_start(Some(r), 2, 3);
        let json = serde_json::to_string(&g).unwrap();
        for private in ["kuya", "Kuya", "secret", "payroll", "pootytxng", "Users", "System", "explorer", "svchost", "game.exe", "Compy"] {
            assert!(!json.contains(private), "{private} leaked into {json}");
        }
        let v = serde_json::to_value(&g).unwrap();
        let mut allowed: HashSet<String> = PROGRAMS.iter().map(|p| p.id.to_string()).collect();
        allowed.extend(["recorder-overlay", "build-tool", "developer-tool", "browser", "download-update", "voice-meeting"].map(String::from));
        for k in v["running_at_start"]["known"].as_array().unwrap() {
            for s in k.as_object().unwrap().values() {
                assert!(allowed.contains(s.as_str().unwrap()), "{s} is not a table constant");
            }
        }
    }

    #[test]
    fn private_names_walked_through_the_watch_the_finish_and_the_row_never_reach_the_row() {
        let private = ["kuya-secret-project.exe", "payroll-2026.exe", "Kuya's Game Launcher.exe", "pootytxng-sync.exe"];
        let mut w = StartWatch::default();
        let mut events: Vec<StutterEvent> = Vec::new();
        events.extend(w.observe(machine(&["medal.exe"]), 60, false, 0, true));
        events.extend(w.observe(machine(&["medal.exe", private[0]]), 61, false, 1, true));
        events.extend(w.observe(machine(&["medal.exe", private[0], private[1], private[2]]), 63, false, 2, true));
        let at_cap = machine(&["medal.exe", private[0], private[1], private[2], private[3]]);
        w.observe(at_cap, 64, true, 3, true);
        let (running, skipped, dropped) = w.finish(None);
        // The existing event log still carries the raw names (that is today's behaviour, queued for review)...
        assert!(events.iter().any(|e| e.label.contains("kuya-secret-project.exe")));
        // ...but the fingerprint built from the watch holds none of them.
        let g = GameStateFingerprint::default().with_running_at_start(running, skipped, dropped);
        let json = serde_json::to_string(&g).unwrap();
        for name in private {
            assert!(!json.contains(name) && !json.to_lowercase().contains(&name.to_lowercase()), "{name} leaked: {json}");
        }
        assert_eq!(ids(g.running_at_start.as_ref().unwrap()), ["medal"]);
        assert_eq!(g.start_events_dropped, Some(1));
    }

    #[test]
    fn rows_written_before_this_field_still_load_and_say_not_recorded() {
        let old = r#"{"process_name":"ROB RUN.exe","context_version":2,"other_cpu":{"readings":300,"unread":2,"mean_pct_x10":110,"p90_pct_x10":160}}"#;
        let g: GameStateFingerprint = serde_json::from_str(old).unwrap();
        assert!(g.running_at_start.is_none() && g.start_ticks_skipped.is_none() && g.start_events_dropped.is_none());
        let back = serde_json::to_string(&g).unwrap();
        for key in ["running_at_start", "start_ticks_skipped", "start_events_dropped"] {
            assert!(!back.contains(key), "an unrecorded field is not written as a value: {back}");
        }
    }

    #[test]
    fn a_hand_edited_row_is_sanitised_on_load_and_cannot_carry_text_forward() {
        let edited = json!({"running_at_start": {
            "taken_at_offset_s": 3, "total_processes": 90,
            "known": [
                {"id": "medal", "category": "recorder-overlay"},
                {"id": "medal", "category": "recorder-overlay"},
                {"id": "chrome", "category": "build-tool"},
                {"id": "C:\\Users\\Kuya\\secret.exe", "category": "browser"},
                {"id": "from-the-future", "category": "holo-overlay"},
                {"id": 42},
                "junk",
                {"id": "cargo", "category": "build-tool"}
            ]}});
        let g: GameStateFingerprint = serde_json::from_value(edited).unwrap();
        let r = g.running_at_start.clone().unwrap();
        assert_eq!(ids(&r), ["medal", "cargo"], "duplicate, mismatched category, foreign ids and junk are dropped");
        let resaved = serde_json::to_string(&g).unwrap();
        assert!(!resaved.contains("secret") && !resaved.contains("future") && !resaved.contains("junk"), "{resaved}");
        // A newer build's unknown category loads as Unknown and is then dropped (it cannot match the table).
        let newer: KnownProgram = serde_json::from_value(json!({"id": "medal", "category": "holo-overlay"})).unwrap();
        assert_eq!(newer.category, Category::Unknown);
        assert!(sanitise_known([newer]).is_empty());
        // Never more than the table has, however long the list.
        let flood: Vec<serde_json::Value> = (0..500)
            .map(|i| if i % 2 == 0 { json!({"id": format!("x{i}"), "category": "browser"}) } else { json!({"id": PROGRAMS[i % PROGRAMS.len()].id, "category": PROGRAMS[i % PROGRAMS.len()].category}) })
            .collect();
        let g: GameStateFingerprint = serde_json::from_value(json!({"running_at_start": {"total_processes": 9, "known": flood}})).unwrap();
        let kept = g.running_at_start.unwrap().known;
        assert!(kept.len() <= PROGRAMS.len() && kept.iter().all(|k| table_entry(&k.id).is_some()), "{}", kept.len());
    }

    #[test]
    fn a_row_missing_the_new_keys_or_holding_junk_there_still_loads() {
        for (row, expect_snapshot) in [
            (json!({"process_name": "g.exe", "running_at_start": {}}), true),
            (json!({"running_at_start": {"known": []}}), true),
            (json!({"running_at_start": {"taken_at_offset_s": 4, "known": [{"id": "medal", "category": "recorder-overlay"}]}}), true),
            (json!({"running_at_start": "junk"}), false),
            (json!({"running_at_start": 7}), false),
            (json!({"running_at_start": {"known": "nope"}}), false),
            (json!({"running_at_start": null}), false),
            (json!({"process_name": "g.exe"}), false),
        ] {
            let g: GameStateFingerprint = serde_json::from_value(row.clone()).unwrap_or_else(|e| panic!("{row} must load: {e}"));
            assert_eq!(g.running_at_start.is_some(), expect_snapshot, "{row}");
            if let Some(r) = &g.running_at_start {
                // A snapshot with nothing in it that says it looked at no process is not a read.
                assert_eq!(summarise(r).read, r.is_readable());
            }
        }
        let empty: GameStateFingerprint = serde_json::from_value(json!({"running_at_start": {}})).unwrap();
        assert!(!summarise(empty.running_at_start.as_ref().unwrap()).read, "an empty hand-made row is not 'none of the listed programs'");
    }

    #[test]
    fn a_failed_enumeration_is_unread_never_an_empty_list() {
        let r = snapshot(std::iter::empty(), 0, 9, 9);
        assert!(r.unread && r.known.is_empty() && r.total_processes == 0);
        assert!(!summarise(&r).read, "unread must send a reader to the not-recorded sentence");
        // Through the watch: every attempt on the first frame tick and its two retries came back empty.
        let mut w = StartWatch::default();
        for t in 5..8 {
            w.observe(HashSet::new(), 0, false, t, true);
        }
        let (running, _, _) = w.finish(None);
        let r = running.expect("attempted, so recorded as unread");
        assert!(r.unread && r.first_frame_offset_s == Some(5));
        // A watch no frame ever reached has nothing recorded at all.
        let mut w = StartWatch::default();
        w.observe(machine(&["medal.exe"]), 50, false, 1, false);
        assert_eq!(w.finish(None).0, None);
    }

    #[test]
    fn one_empty_enumeration_on_the_first_frame_is_retried_not_forfeited() {
        let mut w = StartWatch::default();
        w.observe(HashSet::new(), 0, false, 5, true); // transient failure on the first frame tick
        w.observe(machine(&["medal.exe"]), 60, false, 6, true); // retry succeeds
        w.observe(machine(&["medal.exe", "cargo.exe"]), 61, false, 7, true); // later ticks never change it
        let (running, skipped, _) = w.finish(None);
        let r = running.unwrap();
        assert!(!r.unread);
        assert_eq!((ids(&r), r.taken_at_offset_s, r.first_frame_offset_s), (vec!["medal"], 6, Some(5)));
        assert_eq!(skipped, 0, "the failed tick was not diffed, so the next good tick is not a phantom burst");
        // Two empties then success is still inside the retry budget; three empties are not.
        let mut w = StartWatch::default();
        w.observe(HashSet::new(), 0, false, 1, true);
        w.observe(HashSet::new(), 0, false, 2, true);
        w.observe(machine(&["obs64.exe"]), 60, false, 3, true);
        assert_eq!(ids(&w.finish(None).0.unwrap()), ["obs-studio"]);
    }

    #[test]
    fn the_snapshot_is_taken_once_at_the_first_frame_and_not_updated_later() {
        let mut w = StartWatch::default();
        w.observe(machine(&["obs64.exe"]), 60, false, 0, false); // before any frame: no snapshot
        w.observe(machine(&["obs64.exe", "msedge.exe"]), 61, false, 2, true); // first frame
        w.observe(machine(&["obs64.exe", "msedge.exe", "cargo.exe"]), 62, false, 3, true); // later: ignored
        let (running, _, _) = w.finish(None);
        let r = running.unwrap();
        assert_eq!((ids(&r), r.taken_at_offset_s, r.first_frame_offset_s, r.total_processes), (vec!["obs-studio", "edge"], 2, Some(2), 61));
    }

    /// The monitoring thread's per-tick glue over the REAL `Tracker`, with a session that is just a
    /// start watch: the seam the boundary tests already use.
    struct Rig {
        tracker: Tracker<(u32, StartWatch)>,
        finished: Vec<StartWatch>,
    }

    impl Rig {
        fn new() -> Self {
            Self { tracker: Tracker::open_at(0, (0, StartWatch::default())), finished: vec![] }
        }
        fn tick(&mut self, now: u32, frame: Option<(&str, u32)>, alive: Option<bool>, names: HashSet<String>) {
            let finished = &mut self.finished;
            self.tracker.advance(now, frame, |_, _| alive, |(_, w), _| finished.push(w), |n| (n, StartWatch::default()));
            if let Some((began, w)) = self.tracker.current() {
                let total = names.len() as u32;
                w.observe(names, total, false, now - *began, frame.is_some());
            }
        }
    }

    #[test]
    fn a_relaunch_gets_its_own_snapshot_and_the_first_session_snapshots_at_its_first_frame() {
        let a = Some(("game.exe", 100));
        let b = Some(("game.exe", 200)); // same image, new pid: a relaunch
        let mut rig = Rig::new();
        // Monitoring starts at t=0 and waits; Medal is started at t=3; the game's first frame is t=5.
        for t in 0..3 {
            rig.tick(t, None, None, machine(&[]));
        }
        for t in 3..5 {
            rig.tick(t, None, None, machine(&["Medal.exe"]));
        }
        for t in 5..80 {
            rig.tick(t, a, None, machine(&["Medal.exe"]));
        }
        // The game exits; Medal is closed; cargo is running when the relaunch presents at t=100.
        for t in 80..90 {
            rig.tick(t, None, Some(false), machine(&["cargo.exe"]));
        }
        for t in 100..130 {
            rig.tick(t, b, None, machine(&["cargo.exe"]));
        }
        assert_eq!(rig.finished.len(), 1, "the first session ended when the game exited");
        let first = rig.finished.remove(0).finish(None).0.expect("first session snapshot");
        assert_eq!((ids(&first), first.taken_at_offset_s, first.first_frame_offset_s), (vec!["medal"], 5, Some(5)), "taken at the first frame, after Medal started");
        let (began, second) = rig.tracker.current().map(|(b, w)| (*b, std::mem::take(w))).unwrap();
        assert_eq!(began, 100);
        let second = second.finish(None).0.expect("the relaunch has its own snapshot");
        assert_eq!((ids(&second), second.taken_at_offset_s, second.first_frame_offset_s), (vec!["cargo"], 0, Some(0)), "nothing of the first session is carried");
    }

    #[test]
    fn a_burst_tick_is_counted_as_skipped_and_never_listed() {
        let mut w = StartWatch::default();
        assert!(w.observe(machine(&[]), 50, false, 1, true).is_empty());
        let burst = machine(&["a1.exe", "a2.exe", "a3.exe", "a4.exe", "a5.exe"]);
        assert!(w.observe(burst, 55, false, 2, true).is_empty());
        let (_, skipped, dropped) = w.finish(None);
        assert_eq!((skipped, dropped), (1, 0));
    }

    #[test]
    fn the_thresholds_are_unchanged_four_new_names_are_listed_five_are_not() {
        let mut w = StartWatch::default();
        w.observe(machine(&[]), 50, false, 1, false);
        let four = w.observe(machine(&["a1.exe", "a2.exe", "a3.exe", "a4.exe"]), 54, false, 2, false);
        assert_eq!(four.len(), 4);
        assert!(four.iter().all(|e| e.kind == "process-start" && e.at_secs == 2 && e.label.ends_with(" starting")));
        let five = w.observe(machine(&["b1.exe", "b2.exe", "b3.exe", "b4.exe", "b5.exe"]), 55, false, 3, false);
        assert!(five.is_empty());
        assert_eq!(EVENT_CAP, 50);
        assert_eq!(MAX_NEW_NAMES_PER_TICK, 4);
    }

    #[test]
    fn starts_at_a_full_log_are_counted_as_dropped_and_chatter_is_not() {
        let mut w = StartWatch::default();
        w.observe(machine(&[]), 50, true, 1, true);
        let out = w.observe(machine(&["late1.exe", "late2.exe", "svchost.exe", "Conhost.exe", "compy.exe"]), 55, true, 2, true);
        // Conhost and compy are new names but chatter; only the two real starts are dropped.
        assert!(out.is_empty());
        let (_, skipped, dropped) = w.finish(None);
        assert_eq!((skipped, dropped), (0, 2));
    }

    #[test]
    fn counters_ignore_ticks_before_the_first_frame_and_are_trimmed_to_the_session_end() {
        let mut w = StartWatch::default();
        w.observe(machine(&[]), 50, false, 0, false);
        // A boot/login burst while monitoring waits for the game: not counted.
        w.observe(machine(&["a1.exe", "a2.exe", "a3.exe", "a4.exe", "a5.exe"]), 55, false, 1, false);
        w.observe(machine(&["a1.exe", "a2.exe", "a3.exe", "a4.exe", "a5.exe"]), 55, true, 2, false);
        w.observe(machine(&["a1.exe", "a2.exe", "a3.exe", "a4.exe", "a5.exe", "pre.exe"]), 56, true, 3, false);
        // The first frame: from here on every skipped tick and dropped start counts.
        w.observe(machine(&["a1.exe", "a2.exe", "a3.exe", "a4.exe", "a5.exe", "pre.exe"]), 56, false, 10, true);
        let mut names = machine(&["a1.exe", "a2.exe", "a3.exe", "a4.exe", "a5.exe", "pre.exe"]);
        for t in [20u32, 50, 100] {
            names.extend((0..5).map(|i| format!("burst-{t}-{i}.exe")));
            let total = names.len() as u32;
            w.observe(names.clone(), total, false, t, true);
        }
        for (t, extra) in [(30, "d30.exe"), (60, "d60.exe"), (110, "d110.exe")] {
            names.insert(extra.to_string());
            let total = names.len() as u32;
            w.observe(names.clone(), total, true, t, true);
        }
        let all = w.finish(None);
        assert_eq!((all.1, all.2), (3, 3), "three burst ticks and three dropped starts, none from before the first frame");
        // The same watch trimmed to a session that ended at offset 60 (events are trimmed the same way).
        let mut w2 = StartWatch::default();
        w2.observe(machine(&[]), 50, false, 10, true);
        let mut n2 = machine(&[]);
        for t in [20u32, 50, 100] {
            n2.extend((0..5).map(|i| format!("burst-{t}-{i}.exe")));
            let total = n2.len() as u32;
            w2.observe(n2.clone(), total, false, t, true);
        }
        for (t, extra) in [(30u32, "d30.exe"), (60, "d60.exe"), (110, "d110.exe")] {
            n2.insert(extra.to_string());
            let total = n2.len() as u32;
            w2.observe(n2.clone(), total, true, t, true);
        }
        let trimmed = w2.finish(Some(60));
        assert_eq!((trimmed.1, trimmed.2), (2, 2), "the burst at 100 and the drop at 110 are after the session's end");
    }

    // The detection logic of 33decacc's monitoring.rs, copied as an oracle (events only).
    const OLD_IGNORE: [&str; 8] = ["svchost", "conhost", "dllhost", "runtimebroker", "backgroundtaskhost", "wmiprvse", "taskhostw", "searchprotocolhost"];

    fn old_block(prev: &mut Option<HashSet<String>>, names: HashSet<String>, elapsed: u32, events: &mut Vec<StutterEvent>) {
        if let Some(p) = &*prev {
            let new: Vec<&String> = names.difference(p).collect();
            if new.len() <= 4 {
                for n in new {
                    let lower = n.to_lowercase();
                    let base = lower.strip_suffix(".exe").unwrap_or(&lower);
                    if base == "compy" || OLD_IGNORE.contains(&base) {
                        continue;
                    }
                    events.push(StutterEvent { at_secs: elapsed, kind: "process-start".into(), label: format!("{n} starting") });
                }
            }
        }
        *prev = Some(names);
    }

    #[test]
    fn detection_matches_the_old_block_tick_for_tick_on_a_recorded_sequence() {
        let pool: Vec<String> = ["svchost.exe", "Conhost.exe", "DLLHOST.EXE", "compy.exe", "COMPY.EXE", "RuntimeBroker.exe", "SearchProtocolHost.exe", "System", "Registry", "chrome.exe", "cargo.exe", "Medal.exe"]
            .iter()
            .map(|s| s.to_string())
            .chain((0..40).map(|i| format!("app{i}.exe")))
            .collect();
        let mut state = 0x9E37_79B9_7F4A_7C15u64;
        let mut next = move || {
            state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (state >> 33) as u32
        };
        let mut present: HashSet<String> = pool.iter().filter(|_| next() % 3 == 0).cloned().collect();
        let (mut w, mut old_prev) = (StartWatch::default(), None);
        let (mut bursts, mut listed_ticks) = (0, 0);
        for tick in 0..3000u32 {
            for name in &pool {
                if next() % 100 < 4 && !present.remove(name) {
                    present.insert(name.clone());
                }
            }
            if tick % 250 == 249 {
                present.extend((0..8).map(|i| format!("launch-{tick}-{i}.exe"))); // a login burst
            }
            let names = present.clone();
            let mut old_events = Vec::new();
            old_block(&mut old_prev, names.clone(), tick, &mut old_events);
            let total = names.len().max(1) as u32;
            let new_events = w.observe(names, total, false, tick, tick % 2 == 0);
            assert_eq!(event_labels(&new_events), event_labels(&old_events), "tick {tick}");
            listed_ticks += usize::from(!old_events.is_empty());
            bursts += usize::from(tick % 250 == 249);
        }
        assert!(listed_ticks > 100 && bursts >= 10, "the sequence must exercise listing and bursts ({listed_ticks}, {bursts})");
    }

    #[test]
    fn the_cap_is_read_once_per_tick_so_a_tick_can_cross_it_exactly_as_before() {
        // The monitoring glue: `at_cap` is read before the tick adds anything.
        let filler = |i: usize| StutterEvent { at_secs: i as u32, kind: "ram".into(), label: "x".into() };
        let mut events: Vec<StutterEvent> = (0..49).map(filler).collect();
        let mut old_events = events.clone();
        let (mut w, mut old_prev) = (StartWatch::default(), None);
        let mut tick = |t: u32, extra: &[&str], events: &mut Vec<StutterEvent>, old_events: &mut Vec<StutterEvent>, w: &mut StartWatch| {
            let names = machine(extra);
            let total = names.len() as u32;
            let at_cap = events.len() >= EVENT_CAP;
            events.extend(w.observe(names.clone(), total, at_cap, t, true));
            if old_events.len() < 50 {
                old_block(&mut old_prev, names, t, old_events);
            }
        };
        tick(0, &[], &mut events, &mut old_events, &mut w);
        tick(1, &["a1.exe", "a2.exe", "a3.exe", "a4.exe"], &mut events, &mut old_events, &mut w); // 49 -> 53, crossing mid-tick
        assert_eq!((events.len(), old_events.len()), (53, 53));
        assert_eq!(event_labels(&events), event_labels(&old_events));
        tick(2, &["a1.exe", "a2.exe", "a3.exe", "a4.exe", "late1.exe", "late2.exe"], &mut events, &mut old_events, &mut w);
        assert_eq!((events.len(), old_events.len()), (53, 53), "full: nothing more is listed, in both");
        let (_, skipped, dropped) = w.finish(None);
        assert_eq!((skipped, dropped), (0, 2), "the two late starts are counted, not lost silently");
    }

    #[test]
    fn a_session_row_carries_the_counters_and_old_rows_do_not() {
        let g = GameStateFingerprint::default().with_running_at_start(None, 0, 0);
        assert_eq!((g.start_ticks_skipped, g.start_events_dropped), (Some(0), Some(0)), "zero lost is a recorded zero");
        assert!(g.running_at_start.is_none(), "no snapshot stays None");
        let json = serde_json::to_string(&g).unwrap();
        let back: GameStateFingerprint = serde_json::from_str(&json).unwrap();
        assert_eq!(back, g);
    }

    #[test]
    fn summarise_groups_by_category_flags_resident_programs_and_the_sentences_are_fixed() {
        let names = machine(&["chrome.exe", "msedge.exe", "OBS64.exe", "cargo.exe", "zoom.exe", "discord.exe"]);
        let r = snapshot(names.iter().map(String::as_str), 99, 3, 3);
        let s = summarise(&r);
        assert!(s.read);
        let cats: Vec<_> = s.by_category.iter().map(|c| c.category).collect();
        assert_eq!(cats, [Category::RecorderOverlay, Category::BuildTool, Category::Browser, Category::VoiceMeeting]);
        let browsers: Vec<_> = s.by_category[2].programs.iter().map(|p| (p.name, p.always_resident)).collect();
        assert_eq!(browsers, vec![("Chrome", true), ("Edge", true)]);
        let obs = s.by_category[0].programs[0];
        let chrome = s.by_category[2].programs[0];
        assert_eq!(already_running_sentence(&obs, "ROB RUN.exe").as_deref(), Some("OBS Studio was already running when ROB RUN.exe started."));
        assert_eq!(already_running_sentence(&chrome, "ROB RUN.exe"), None, "a resident program gets no line of its own");
        for cat in &s.by_category {
            for p in &cat.programs {
                match already_running_sentence(p, "g.exe") {
                    Some(text) => {
                        assert!(!p.always_resident);
                        let t = text.to_lowercase();
                        assert!(!t.contains("caused") && !t.contains("nothing was running"), "{text}");
                    }
                    None => assert!(p.always_resident),
                }
            }
        }
        assert_eq!(NOT_RECORDED_SENTENCE, "Compy didn't record what was running when this session started.");
        assert_eq!(Category::Browser.label(), "browser");
    }

    #[test]
    fn differs_between_compares_readable_snapshots_across_rough_and_normal_sessions() {
        let rough: Vec<RunningAtStart> = vec![
            snap(&["discord.exe", "cargo.exe"]),
            snap(&["discord.exe", "cargo.exe"]),
            snap(&["discord.exe"]),
            snap(&["discord.exe", "chrome.exe"]),
            snapshot(std::iter::empty(), 0, 0, 0), // unread: left out of both counts
        ];
        let normal: Vec<RunningAtStart> = vec![snap(&["discord.exe", "chrome.exe"]), snap(&["cargo.exe", "chrome.exe"]), snap(&[]), snap(&["chrome.exe"]), snap(&[]), snap(&["discord.exe"])];
        let (rough_refs, normal_refs): (Vec<&RunningAtStart>, Vec<&RunningAtStart>) = (rough.iter().collect(), normal.iter().collect());
        let d = differs_between(&rough_refs, &normal_refs);
        let by_id = |id: &str| d.iter().find(|x| x.id == id).copied();
        // discord: 4 of 4 readable rough vs 2 of 6 normal.
        let discord = by_id("discord").expect("discord differs");
        assert_eq!((discord.in_rough, discord.in_normal), (NofM { n: 4, of: 4 }, NofM { n: 2, of: 6 }));
        assert!(discord.more_in_rough());
        // chrome: 1 of 4 rough, 3 of 6 normal: differs, but not heavier in the rough sessions.
        let chrome = by_id("chrome").expect("chrome differs");
        assert_eq!((chrome.in_rough, chrome.in_normal), (NofM { n: 1, of: 4 }, NofM { n: 3, of: 6 }));
        assert!(!chrome.more_in_rough());
        // cargo: 2 of 4 vs 2 of 6 differs; a program in neither side never appears.
        assert!(by_id("cargo").is_some() && by_id("obs-studio").is_none());
        // Equal shares (2 of 4 and 1 of 2) are not a difference.
        let (r2, n2) = (vec![snap(&["cargo.exe"]), snap(&["cargo.exe"]), snap(&[]), snap(&[])], vec![snap(&["cargo.exe"]), snap(&[])]);
        let d2 = differs_between(&r2.iter().collect::<Vec<_>>(), &n2.iter().collect::<Vec<_>>());
        assert!(d2.is_empty(), "{d2:?}");
        // Table order, never anything outside the table.
        let order: Vec<usize> = d.iter().map(|x| PROGRAMS.iter().position(|p| p.id == x.id).unwrap()).collect();
        assert!(order.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn differs_between_says_nothing_without_a_readable_snapshot_on_both_sides() {
        let readable = snap(&["discord.exe"]);
        let unread = snapshot(std::iter::empty(), 0, 0, 0);
        let hollow: RunningAtStart = serde_json::from_value(json!({})).unwrap(); // hand-made: looked at no process
        assert!(differs_between(&[], &[&readable]).is_empty());
        assert!(differs_between(&[&readable], &[]).is_empty());
        assert!(differs_between(&[&readable], &[&unread, &hollow]).is_empty(), "only unread on one side is nothing to compare");
        assert!(differs_between(&[&unread], &[&unread]).is_empty());
        assert!(!differs_between(&[&readable, &unread], &[&snap(&[])]).is_empty(), "an unread row beside a readable one is simply left out");
    }

    // ---- the new fields must not move any existing judgement ----

    fn played(started_at: &str, running: Option<RunningAtStart>, skipped: Option<u32>, dropped: Option<u32>) -> crate::sessions::SessionSummary {
        let mut s: crate::sessions::SessionSummary = serde_json::from_value(json!({
            "started_at": started_at, "duration_secs": 1200, "process_name": "game.exe",
            "samples": 1170, "avg_fps": 240.0, "avg_frametime_ms": 4.2, "low1_fps_est": 180.0,
            "compy_changes_active": 0, "compy_changes_per_change": true, "compy_changes_cant_confirm": 0,
            "hw_fingerprint": {"hash": "62f1370e0d48cfea", "gpu": "Radeon RX 9070 XT", "gpu_driver": "32.0.32015.7029", "ram_gb": 32, "display": "1920x1080@250"},
            "gaming_mode_active": false
        }))
        .expect("fixture row");
        s.capture_capabilities = Some(crate::capture::CaptureCapabilities::etw_dxgi(None));
        // The cap state the as-is walk needs to pair two sessions (no series, so the row's own read).
        s.frame_cap = Some(crate::noise_floor::CapRead::Uncapped);
        s.game_state = Some(
            GameStateFingerprint {
                process_name: Some("game.exe".into()),
                resolution_width: Some(1920),
                resolution_height: Some(1080),
                display_refresh_hz: Some(250),
                windows_build: Some("26200.8457".into()),
                ..Default::default()
            }
            .with_running_at_start(running, skipped.unwrap_or(0), dropped.unwrap_or(0)),
        );
        if skipped.is_none() && dropped.is_none() {
            let g = s.game_state.as_mut().unwrap();
            g.start_ticks_skipped = None;
            g.start_events_dropped = None;
        }
        s
    }

    #[test]
    fn two_sessions_that_differ_only_in_what_was_running_are_judged_exactly_as_before() {
        let days = ["2026-11-01T10:00:00Z", "2026-11-02T10:00:00Z", "2026-11-03T10:00:00Z"];
        let plain: Vec<_> = days.iter().map(|d| played(d, None, None, None)).collect();
        let marked: Vec<_> = vec![
            played(days[0], Some(snap(&["medal.exe", "cargo.exe"])), Some(3), Some(9)),
            played(days[1], Some(snap(&["discord.exe"])), Some(0), Some(0)),
            played(days[2], Some(snapshot(std::iter::empty(), 0, 0, 0)), Some(40), Some(0)),
        ];
        // comparability.rs
        for (i, j) in [(0, 1), (1, 2), (0, 2)] {
            assert_eq!(crate::comparability::derive(&plain[i], &plain[j]), crate::comparability::derive(&marked[i], &marked[j]), "pair {i},{j}");
        }
        assert_eq!(crate::comparability::derive(&plain[0], &marked[1]), crate::comparability::derive(&plain[0], &plain[1]), "one side marked, one not");
        // noise_floor.rs: the conditions a session is matched on, and the as-is run walk (which calls its
        // same-configuration check on every pair it joins).
        for (p, m) in plain.iter().zip(&marked) {
            assert!(crate::noise_floor::NoiseConditions::of_session(p).is_some());
            assert_eq!(crate::noise_floor::NoiseConditions::of_session(p), crate::noise_floor::NoiseConditions::of_session(m));
        }
        let started = |run: Vec<&crate::sessions::SessionSummary>| run.iter().map(|s| s.started_at.clone()).collect::<Vec<_>>();
        let run_plain = started(crate::noise_floor::as_is_run(&plain[..2], &plain[2], &[], 30));
        let run_marked = started(crate::noise_floor::as_is_run(&marked[..2], &marked[2], &[], 30));
        assert_eq!(run_plain, run_marked);
        // Not vacuous: the walk really joins both earlier sessions (so same_configuration, and with it
        // comparability's Comparable verdict, held for every pair it judged).
        assert_eq!(run_plain.len(), 2, "{run_plain:?}");
        // realplay.rs: which session a real-play start pins and which one a crash is pinned on.
        let pick = |all: &[crate::sessions::SessionSummary]| {
            (
                crate::realplay::newest_countable("game.exe", all).map(|s| s.started_at.clone()),
                crate::realplay::newest_after("game.exe", "2026-11-01T12:00:00Z", all).map(|s| s.started_at.clone()),
            )
        };
        assert_eq!(pick(&plain), pick(&marked));
        assert_eq!(pick(&plain).1.as_deref(), Some(days[2]));
    }

    #[test]
    fn the_shared_export_carries_none_of_it() {
        let r = snap(&["Medal.exe", "qbittorrent.exe", "teams.exe", "cargo.exe", "node.exe"]);
        let g = GameStateFingerprint { process_name: Some("game.exe".into()), ..Default::default() }.with_running_at_start(Some(r), 4, 5);
        let row = json!({"process_name": "game.exe", "avg_fps": 144.0, "game_state": g,
            "stutter_events": [{"at_secs": 3, "kind": "process-start", "label": "OneDrive.exe starting"}]});
        let out = crate::export::redact_session_rows(json!([row]));
        let text = out.to_string();
        for key in ["running_at_start", "start_ticks_skipped", "start_events_dropped", "known", "taken_at_offset_s", "total_processes"] {
            assert!(!text.contains(key), "{key} must not be exported: {text}");
        }
        for p in PROGRAMS {
            assert!(!text.contains(&format!("\"{}\"", p.id)), "table id {} reached the export", p.id);
        }
        // Nothing else moves: the rest of the game_state, and how process-start events are exported today.
        assert_eq!(out[0]["game_state"]["process_name"], "game.exe");
        assert_eq!(out[0]["stutter_events"][0]["label"], "OneDrive.exe starting");
        assert_eq!(out[0]["avg_fps"], 144.0);
        // A non-array or a row without game_state passes through untouched.
        assert_eq!(crate::export::redact_session_rows(serde_json::Value::Null), serde_json::Value::Null);
        assert_eq!(crate::export::redact_session_rows(json!([{"process_name": "g.exe"}])), json!([{"process_name": "g.exe"}]));
        assert!(include_str!("export.rs").contains("let sessions = redact_session_rows("), "the export path must redact the rows");
    }

    #[test]
    fn snapshot_cost_is_negligible() {
        // A busy PC: 600 processes, 5 of them listed. The only work this slice adds is this pass
        // (the enumeration itself is the recorder's existing 1 Hz one). The bound is generous so a
        // loaded machine cannot flake it; the measurement is printed and was ~50 us on the owner's PC.
        let mut names: Vec<String> = (0..580).map(|i| format!("background-service-{i}.exe")).collect();
        names.extend(["Medal.exe", "chrome.exe", "obs64.exe", "cargo.exe", "discord.exe"].map(String::from));
        let runs = 40u32;
        let per = (0..5)
            .map(|_| {
                let start = std::time::Instant::now();
                for i in 0..runs {
                    let r = snapshot(names.iter().map(String::as_str), 600, i, 0);
                    assert_eq!(r.known.len(), 5);
                }
                start.elapsed() / runs
            })
            .min()
            .unwrap();
        println!("snapshot over 600 names took {per:?} (best of 5 batches)");
        assert!(per < std::time::Duration::from_millis(50), "snapshot took {per:?}");
    }

    /// Run by hand on the target PC: `cargo test running_at_start -- --ignored --nocapture`. Measures
    /// the real names-only enumeration the recorder does each second plus this slice's pass.
    #[test]
    #[ignore]
    fn measured_on_this_pc_enumeration_plus_snapshot() {
        let mut sys = sysinfo::System::new();
        let mut worst = std::time::Duration::ZERO;
        let mut total_time = std::time::Duration::ZERO;
        let mut snap_total = std::time::Duration::ZERO;
        let runs = 20u32;
        let mut procs = 0;
        for _ in 0..runs {
            let t0 = std::time::Instant::now();
            sys.refresh_processes_specifics(sysinfo::ProcessesToUpdate::All, true, sysinfo::ProcessRefreshKind::nothing());
            let names: HashSet<String> = sys.processes().values().map(|p| p.name().to_string_lossy().into_owned()).collect();
            procs = sys.processes().len();
            let t1 = std::time::Instant::now();
            let r = snapshot(names.iter().map(String::as_str), procs as u32, 0, 0);
            let t2 = std::time::Instant::now();
            assert!(!r.unread);
            total_time += t2 - t0;
            snap_total += t2 - t1;
            worst = worst.max(t2 - t0);
        }
        println!("MEASURED processes={procs} enumeration+names+snapshot mean={:?} worst={worst:?} snapshot-only mean={:?}", total_time / runs, snap_total / runs);
    }

    #[test]
    fn monitoring_is_wired_to_the_watch_and_the_row() {
        let src = include_str!("monitoring.rs");
        for needle in ["watch.observe(", "tick_game.is_some()", "watch.finish(counters_end)", ".with_running_at_start("] {
            assert!(src.contains(needle), "monitoring.rs lost `{needle}`");
        }
        assert!(!src.contains("prev_procs"), "the bare previous-names set is back");
    }
}
