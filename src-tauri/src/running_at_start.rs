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
//!
//! # What a reader may say (the only sentences)
//!
//! - [`already_running_sentence`]: "{name} was already running when {game} started." (`name` is a
//!   table display name; it is a `&'static str` so a machine string cannot be passed by accident).
//! - [`NOT_RECORDED_SENTENCE`]: "Compy didn't record what was running when this session started."
//!   Used for `None` (old row, never recorded) AND for `unread` (the process list could not be read).
//!
//! Never "caused". Never "nothing was running": the table is an allowlist, so an empty `known` only
//! means none of the programs Compy knows about were seen. Presence is not activity: a launcher or a
//! cloud-sync client being open does not mean it was downloading.
//!
//! # Where it is taken
//!
//! `monitoring.rs`, on the first tick a frame names the session's process (for a relaunch that is the
//! tick `session_boundary::Tracker` begins the new session; for the first session of a capture it is
//! the tick the first frame arrives, not the moment monitoring started). It reuses the 1 Hz
//! names-only `sysinfo` enumeration the process-start detector already does: no second enumeration,
//! no new process spawn. The added cost is one pass over the names (measured in the tests).
#![cfg_attr(not(test), allow(dead_code))]

use serde::{Deserialize, Serialize};
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
    /// Launchers, updaters, sync and torrent clients (open does not mean transferring).
    DownloadUpdate,
    /// Voice / video meeting clients.
    VoiceMeeting,
    /// A category written by a newer Compy that this build does not know. Never produced here.
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
            Category::DownloadUpdate => "launcher / updater / sync",
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
    /// Exact image names, lower-case. Matching ignores ASCII case, never matches substrings.
    pub images: &'static [&'static str],
    /// One line: why this is on the list.
    pub why: &'static str,
}

macro_rules! p {
    ($id:expr, $name:expr, $cat:ident, [$($img:expr),+], $why:expr) => {
        Program { id: $id, display_name: $name, category: Category::$cat, images: &[$($img),+], why: $why }
    };
}

/// The reviewed table (32 entries). Left out on purpose, with the reason:
/// - Steam overlay: part of every Steam game, presence says nothing.
/// - `nvcontainer.exe`: NVIDIA's generic service container (telemetry, display, sharing); it is always
///   running, so it cannot tell a recorder from an idle driver. Only the overlay/share processes are listed.
/// - `msmpeng.exe` (Defender): always running; a scan cannot be told from idle by presence.
/// - `java.exe` / Gradle: Gradle has no image of its own and `java.exe` is far too generic.
/// - `spotify.exe`: light; no evidence it moves a game's numbers.
/// - ReShade: a DLL inside the game, not a process. `obs32.exe`, `devenv.exe` (Visual Studio),
///   `msedgewebview2.exe` (embedded by many apps), `gamebarpresencewriter.exe` (runs on most PCs): not
///   confident enough that presence means load, so not listed.
/// - Steam downloads: not a separate process.
pub(crate) const PROGRAMS: &[Program] = &[
    // --- recorders, overlays, frame generators ---
    p!("medal", "Medal", RecorderOverlay, ["medal.exe", "medalencoder.exe"], "clip recorder; its encoder uses GPU video encode while recording"),
    p!("obs-studio", "OBS Studio", RecorderOverlay, ["obs64.exe"], "recording/streaming encode on CPU or GPU"),
    p!("nvidia-overlay", "NVIDIA overlay / ShadowPlay", RecorderOverlay, ["nvidia share.exe", "nvidia overlay.exe"], "in-game overlay and Instant Replay capture; nvcontainer.exe deliberately not listed"),
    p!("amd-software", "AMD Software overlay / ReLive", RecorderOverlay, ["radeonsoftware.exe", "amdrsserv.exe"], "Adrenalin overlay and ReLive recording service"),
    p!("xbox-game-bar", "Xbox Game Bar", RecorderOverlay, ["gamebar.exe", "gamebarftserver.exe", "broadcastdvrserver.exe"], "Windows capture/overlay; background recording uses GPU encode"),
    p!("discord", "Discord", RecorderOverlay, ["discord.exe"], "in-game overlay and screen/stream share (presence only: many processes)"),
    p!("overwolf", "Overwolf", RecorderOverlay, ["overwolf.exe"], "overlay platform that hooks games and runs in-game apps"),
    p!("lossless-scaling", "Lossless Scaling", RecorderOverlay, ["losslessscaling.exe"], "frame generation / upscaling that takes a large GPU share"),
    p!("rtss", "RivaTuner Statistics Server", RecorderOverlay, ["rtss.exe"], "overlay and frame limiter that hooks the game's present call"),
    p!("msi-afterburner", "MSI Afterburner", RecorderOverlay, ["msiafterburner.exe"], "overlay and GPU tuning; can hold clocks or fan curves"),
    // --- build / compile ---
    p!("cargo", "cargo", BuildTool, ["cargo.exe"], "Rust build driver; saturates CPU and disk while building"),
    p!("rustc", "rustc", BuildTool, ["rustc.exe"], "Rust compiler"),
    p!("clippy", "clippy", BuildTool, ["clippy-driver.exe"], "Rust lint driver (a compile)"),
    p!("msvc-linker", "the MSVC linker", BuildTool, ["link.exe"], "linker step of native builds; heavy memory and disk"),
    p!("msvc-compiler", "the MSVC compiler", BuildTool, ["cl.exe"], "C/C++ compiler"),
    p!("msbuild", "MSBuild", BuildTool, ["msbuild.exe"], "Visual Studio build driver"),
    p!("gcc", "gcc", BuildTool, ["gcc.exe"], "C/C++ compiler"),
    p!("clang", "clang", BuildTool, ["clang.exe"], "C/C++ compiler"),
    // --- developer tools that other apps also use ---
    p!("node", "Node.js", DeveloperTool, ["node.exe"], "tsc, vitest and dev servers run on it, but some apps bundle node.exe too, so it is its own category"),
    p!("rust-analyzer", "rust-analyzer", DeveloperTool, ["rust-analyzer.exe"], "editor language server; re-indexes heavily after edits"),
    // --- browsers (presence only: process counts are noisy, and Edge/Chrome can linger after close) ---
    p!("chrome", "Chrome", Browser, ["chrome.exe"], "video, tabs and background pages use CPU, GPU decode and RAM"),
    p!("edge", "Edge", Browser, ["msedge.exe"], "same; startup boost can keep it resident after it is closed"),
    p!("firefox", "Firefox", Browser, ["firefox.exe"], "same"),
    p!("brave", "Brave", Browser, ["brave.exe"], "same"),
    p!("opera", "Opera", Browser, ["opera.exe"], "same"),
    // --- launchers, updaters, sync, torrents (open does not mean transferring) ---
    p!("epic-launcher", "Epic Games Launcher", DownloadUpdate, ["epicgameslauncher.exe"], "downloads and patches games; known for disk and CPU use"),
    p!("battle-net", "Battle.net", DownloadUpdate, ["battle.net.exe"], "downloads and patches games"),
    p!("windows-update", "Windows Update servicing", DownloadUpdate, ["tiworker.exe", "trustedinstaller.exe"], "servicing runs only while updates install; heavy disk and CPU"),
    p!("onedrive", "OneDrive", DownloadUpdate, ["onedrive.exe"], "cloud sync; resident on most PCs, so presence alone is weak evidence"),
    p!("qbittorrent", "qBittorrent", DownloadUpdate, ["qbittorrent.exe"], "torrent client: disk, network and CPU"),
    // --- voice / meetings ---
    p!("zoom", "Zoom", VoiceMeeting, ["zoom.exe"], "meeting client: webcam encode and screen share"),
    p!("teams", "Microsoft Teams", VoiceMeeting, ["teams.exe", "ms-teams.exe"], "meeting client (classic and new Teams)"),
];

/// The table entry whose image names include `image` (exact, ASCII case-insensitive), if any.
pub(crate) fn lookup(image: &str) -> Option<&'static Program> {
    PROGRAMS.iter().find(|p| p.images.iter().any(|i| image.eq_ignore_ascii_case(i)))
}

/// A listed program seen running at the start. Only table constants: `id` is a [`PROGRAMS`] id.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct KnownProgram {
    pub id: String,
    pub category: Category,
}

/// The listed programs that were running when a session began. Absent on the row (`None`) = not
/// recorded: the row is older than this field, or no frame ever named the process. A reader treats
/// both `None` and `unread` as "Compy couldn't see", never as "nothing was running".
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
pub(crate) struct RunningAtStart {
    /// Seconds after the session began (the clock `stutter_events.at_secs` uses) when the snapshot
    /// was taken: the tick the first frame named the process. Large for the first session of a
    /// capture that waited for the game.
    pub taken_at_offset_s: u32,
    /// Every process in the snapshot, listed or not. Context for "we looked at N processes".
    pub total_processes: u32,
    /// Listed programs seen, in table order, one per program however many processes it runs.
    #[serde(default)]
    pub known: Vec<KnownProgram>,
    /// The process list could not be read (an empty enumeration): `known` is empty because Compy
    /// could not see, not because nothing was there.
    #[serde(default)]
    pub unread: bool,
}

/// PURE: build the snapshot from the names the recorder's enumeration already produced. `total_processes`
/// of 0 is a failed enumeration (a running Windows PC always has processes) and reads as `unread`.
pub(crate) fn snapshot<'a>(
    names: impl IntoIterator<Item = &'a str>,
    total_processes: u32,
    taken_at_offset_s: u32,
) -> RunningAtStart {
    if total_processes == 0 {
        return RunningAtStart { taken_at_offset_s, total_processes: 0, known: Vec::new(), unread: true };
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
    RunningAtStart { taken_at_offset_s, total_processes, known, unread: false }
}

/// The listed programs of one category that were present.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CategoryPresence {
    pub category: Category,
    /// Table display names, in table order.
    pub programs: Vec<&'static str>,
}

/// Per-category presence for a reader. `read == false` means "Compy couldn't see": use
/// [`NOT_RECORDED_SENTENCE`] and nothing else. An empty `by_category` with `read == true` means none
/// of the listed programs were seen, which is not "nothing was running".
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct StartSummary {
    pub read: bool,
    pub by_category: Vec<CategoryPresence>,
}

/// PURE: summarise a snapshot. Ids not in this build's table (written by a newer build, or edited by
/// hand) are skipped; display names come only from the table.
pub(crate) fn summarise(r: &RunningAtStart) -> StartSummary {
    if r.unread {
        return StartSummary { read: false, by_category: Vec::new() };
    }
    let mut by_category: Vec<CategoryPresence> = Vec::new();
    for p in PROGRAMS.iter().filter(|p| r.known.iter().any(|k| k.id == p.id)) {
        match by_category.iter_mut().find(|c| c.category == p.category) {
            Some(c) => c.programs.push(p.display_name),
            None => by_category.push(CategoryPresence { category: p.category, programs: vec![p.display_name] }),
        }
    }
    by_category.sort_by_key(|c| c.category);
    StartSummary { read: true, by_category }
}

/// "{name} was already running when {game} started." `name` is a table display name.
pub(crate) fn already_running_sentence(name: &'static str, game: &str) -> String {
    format!("{name} was already running when {game} started.")
}

/// The only sentence for a row with no usable snapshot (`None` or `unread`).
pub(crate) const NOT_RECORDED_SENTENCE: &str = "Compy didn't record what was running when this session started.";

/// The recorder's per-tick name diff goes quiet after this many events (unchanged threshold).
pub(crate) const EVENT_CAP: usize = 50;
/// A tick with more new names than this is a launch burst, not one culprit (unchanged threshold).
pub(crate) const MAX_NEW_NAMES_PER_TICK: usize = 4;

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
    ticks_skipped: u32,
    events_dropped: u32,
}

impl StartWatch {
    /// One tick's enumeration. `names` are the distinct image names and `total` the process count;
    /// `frame_this_tick` is true when a frame named the session's process this tick (the first such
    /// tick takes the snapshot, once); `at_cap` is true when the session's event log was already full at
    /// the start of the tick. Returns the process-start events to log. A tick with more than
    /// [`MAX_NEW_NAMES_PER_TICK`] new names is not listed and counted in `ticks_skipped`; names that
    /// would have been listed at the cap are counted in `events_dropped`.
    pub(crate) fn observe(
        &mut self,
        names: HashSet<String>,
        total: u32,
        at_cap: bool,
        elapsed: u32,
        frame_this_tick: bool,
    ) -> Vec<StutterEvent> {
        if frame_this_tick && self.running.is_none() {
            self.running = Some(snapshot(names.iter().map(String::as_str), total, elapsed));
        }
        let mut out = Vec::new();
        if let Some(prev) = &self.prev {
            let new: Vec<&String> = names.difference(prev).collect();
            if new.len() > MAX_NEW_NAMES_PER_TICK {
                self.ticks_skipped = self.ticks_skipped.saturating_add(1);
            } else {
                for n in new.into_iter().filter(|n| !is_chatter(n)) {
                    if at_cap {
                        self.events_dropped = self.events_dropped.saturating_add(1);
                    } else {
                        out.push(StutterEvent { at_secs: elapsed, kind: "process-start".into(), label: format!("{n} starting") });
                    }
                }
            }
        }
        self.prev = Some(names);
        out
    }

    /// At save: the start snapshot (`None` if no frame ever named the process) and the two counters.
    pub(crate) fn finish(self) -> (Option<RunningAtStart>, u32, u32) {
        (self.running, self.ticks_skipped, self.events_dropped)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::game_state::GameStateFingerprint;
    use crate::session_boundary::Tracker;

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
        let r = snapshot(names.iter().map(String::as_str), total, 7);
        assert_eq!(ids(&r), ["medal", "cargo", "node", "chrome"], "table order, one per program");
        assert_eq!(
            r.known.iter().map(|k| k.category).collect::<Vec<_>>(),
            [Category::RecorderOverlay, Category::BuildTool, Category::DeveloperTool, Category::Browser]
        );
        assert_eq!((r.taken_at_offset_s, r.total_processes, r.unread), (7, total, false));
        // Nothing else is stored: the whole row is these four fields.
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v.as_object().unwrap().len(), 4, "{v}");
    }

    #[test]
    fn a_pc_with_none_of_the_listed_programs_reads_as_read_and_empty() {
        let names = machine(&[]);
        let r = snapshot(names.iter().map(String::as_str), names.len() as u32, 0);
        assert!(r.known.is_empty() && !r.unread);
        let s = summarise(&r);
        assert!(s.read && s.by_category.is_empty(), "none of the listed programs, which is not 'nothing was running'");
    }

    #[test]
    fn the_serialised_row_holds_no_name_outside_the_table() {
        let names = machine(&[
            "Medal.exe",
            "chrome.exe",
            "kuya-secret-project.exe",
            "C:\\Users\\Kuya\\Desktop\\payroll.exe",
            "Kuya's Game Launcher.exe",
            "pootytxng-sync.exe",
        ]);
        let r = snapshot(names.iter().map(String::as_str), names.len() as u32, 4);
        let g = GameStateFingerprint::default().with_running_at_start(Some(r), 2, 3);
        let json = serde_json::to_string(&g).unwrap();
        for private in ["kuya", "Kuya", "secret", "payroll", "pootytxng", "Users", "System", "explorer", "svchost", "game.exe", "Compy"] {
            assert!(!json.contains(private), "{private} leaked into {json}");
        }
        // Every string value under running_at_start is a table id or a category constant.
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
    fn rows_written_before_this_field_still_load_and_say_not_recorded() {
        let old = r#"{"process_name":"ROB RUN.exe","context_version":2,"other_cpu":{"readings":300,"unread":2,"mean_pct_x10":110,"p90_pct_x10":160}}"#;
        let g: GameStateFingerprint = serde_json::from_str(old).unwrap();
        assert!(g.running_at_start.is_none() && g.start_ticks_skipped.is_none() && g.start_events_dropped.is_none());
        let back = serde_json::to_string(&g).unwrap();
        for key in ["running_at_start", "start_ticks_skipped", "start_events_dropped"] {
            assert!(!back.contains(key), "an unrecorded field is not written as a value: {back}");
        }
        // A newer build's category or a hand-edited id neither breaks the row nor reaches a sentence.
        let newer = r#"{"running_at_start":{"taken_at_offset_s":3,"total_processes":90,"known":[{"id":"medal","category":"recorder-overlay"},{"id":"from-the-future","category":"holo-overlay"},{"id":"C:\\secret.exe","category":"browser"}]}}"#;
        let g: GameStateFingerprint = serde_json::from_str(newer).unwrap();
        let r = g.running_at_start.unwrap();
        assert_eq!(r.known[1].category, Category::Unknown);
        let s = summarise(&r);
        assert_eq!(s.by_category, vec![CategoryPresence { category: Category::RecorderOverlay, programs: vec!["Medal"] }]);
    }

    #[test]
    fn a_failed_enumeration_is_unread_never_an_empty_list() {
        let r = snapshot(std::iter::empty(), 0, 9);
        assert!(r.unread && r.known.is_empty() && r.total_processes == 0);
        assert!(!summarise(&r).read, "unread must send a reader to the not-recorded sentence");
        // Through the watch: the first frame tick had no process list.
        let mut w = StartWatch::default();
        w.observe(HashSet::new(), 0, false, 5, true);
        let (running, _, _) = w.finish();
        assert!(running.expect("attempted, so recorded as unread").unread);
        // A watch no frame ever reached has nothing recorded at all.
        let mut w = StartWatch::default();
        w.observe(machine(&["medal.exe"]), 50, false, 1, false);
        assert_eq!(w.finish().0, None);
    }

    #[test]
    fn the_snapshot_is_taken_once_at_the_first_frame_and_not_updated_later() {
        let mut w = StartWatch::default();
        w.observe(machine(&["obs64.exe"]), 60, false, 0, false); // before any frame: no snapshot
        w.observe(machine(&["obs64.exe", "msedge.exe"]), 61, false, 2, true); // first frame
        w.observe(machine(&["obs64.exe", "msedge.exe", "cargo.exe"]), 62, false, 3, true); // later: ignored
        let (running, _, _) = w.finish();
        let r = running.unwrap();
        assert_eq!((ids(&r), r.taken_at_offset_s, r.total_processes), (vec!["obs-studio", "edge"], 2, 61));
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
        let first = rig.finished.remove(0).finish().0.expect("first session snapshot");
        assert_eq!((ids(&first), first.taken_at_offset_s), (vec!["medal"], 5), "taken at the first frame, after Medal started");
        let (began, second) = rig.tracker.current().map(|(b, w)| (*b, std::mem::take(w))).unwrap();
        assert_eq!(began, 100);
        let second = second.finish().0.expect("the relaunch has its own snapshot");
        assert_eq!((ids(&second), second.taken_at_offset_s), (vec!["cargo"], 0), "nothing of the first session is carried");
    }

    #[test]
    fn a_burst_tick_is_counted_as_skipped_and_never_listed() {
        let mut w = StartWatch::default();
        assert!(w.observe(machine(&[]), 50, false, 1, false).is_empty());
        let burst = machine(&["a1.exe", "a2.exe", "a3.exe", "a4.exe", "a5.exe"]);
        assert!(w.observe(burst, 55, false, 2, false).is_empty());
        let (_, skipped, dropped) = w.finish();
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
        w.observe(machine(&[]), 50, true, 1, false);
        let out = w.observe(machine(&["late1.exe", "late2.exe", "svchost.exe", "Conhost.exe", "compy.exe"]), 55, true, 2, false);
        // svchost/conhost/compy are in the base machine or ignored; only the two real starts count.
        assert!(out.is_empty());
        let (_, skipped, dropped) = w.finish();
        assert_eq!((skipped, dropped), (0, 2));
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
    fn summarise_groups_by_category_in_a_fixed_order_and_the_sentences_are_fixed() {
        let names = machine(&["chrome.exe", "msedge.exe", "OBS64.exe", "cargo.exe", "zoom.exe"]);
        let r = snapshot(names.iter().map(String::as_str), 99, 3);
        let s = summarise(&r);
        assert!(s.read);
        let cats: Vec<_> = s.by_category.iter().map(|c| c.category).collect();
        assert_eq!(cats, [Category::RecorderOverlay, Category::BuildTool, Category::Browser, Category::VoiceMeeting]);
        assert_eq!(s.by_category[2].programs, vec!["Chrome", "Edge"]);
        assert_eq!(already_running_sentence("OBS Studio", "ROB RUN.exe"), "OBS Studio was already running when ROB RUN.exe started.");
        assert_eq!(NOT_RECORDED_SENTENCE, "Compy didn't record what was running when this session started.");
        let zoom = already_running_sentence("Zoom", "g.exe");
        for text in [NOT_RECORDED_SENTENCE, zoom.as_str()] {
            let t = text.to_lowercase();
            assert!(!t.contains("caused") && !t.contains("nothing was running"), "{text}");
        }
        assert_eq!(Category::Browser.label(), "browser");
    }

    #[test]
    fn snapshot_cost_is_negligible() {
        // A busy PC: 600 processes, 20 of them listed. The only work this slice adds is this pass
        // (the enumeration itself is the recorder's existing 1 Hz one).
        let mut names: Vec<String> = (0..580).map(|i| format!("background-service-{i}.exe")).collect();
        names.extend(["Medal.exe", "chrome.exe", "obs64.exe", "cargo.exe", "discord.exe"].map(String::from));
        // Best of five batches of 40: a loaded CI box slows a batch, it cannot speed one up.
        let runs = 40u32;
        let per = (0..5)
            .map(|_| {
                let start = std::time::Instant::now();
                for i in 0..runs {
                    let r = snapshot(names.iter().map(String::as_str), 600, i);
                    assert_eq!(r.known.len(), 5);
                }
                start.elapsed() / runs
            })
            .min()
            .unwrap();
        assert!(per < std::time::Duration::from_millis(2), "snapshot took {per:?}, target is under 2 ms");
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
            let r = snapshot(names.iter().map(String::as_str), procs as u32, 0);
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
        for needle in ["watch.observe(", "tick_game.is_some()", "watch.finish()", ".with_running_at_start("] {
            assert!(src.contains(needle), "monitoring.rs lost `{needle}`");
        }
        assert!(!src.contains("prev_procs"), "the bare previous-names set is back");
    }
}
