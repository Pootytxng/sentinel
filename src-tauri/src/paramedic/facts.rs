//! The first look's "What looks off on this PC" facts and Compy's own dated changes (design M5, slice S3).
//!
//! Read-only and pure on its inputs. The facts are the readiness rules' own verdicts (`evaluate_readiness`,
//! the pure path, never the command that writes drift state), kept to a short list that has
//! a number in it, and each carries only a code and its numbers: the card words the fact and one "how to
//! check" line, with no advice beyond that. A reading that could not be made is a limit line, never a
//! silent absence; hardware that has not been read yet is the limit "still reading", never an empty list.
//!
//! Compy's own changes come from the change ledger through a read that never locks, moves, restores or
//! writes (`history::read_ledger_stamps`).

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::Serialize;

use super::first_look::{limit, FirstLook, GameCtx};
use super::iso;
use crate::hardware::{HardwareInfo, PowerSource};
use crate::history::LedgerStamp;
use crate::readiness::{evaluate_readiness, ReadinessStatus};

/// One thing that looks off, as a code and its numbers (the card owns the sentence and the check line).
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct Fact {
    pub id: &'static str,
    pub args: BTreeMap<&'static str, String>,
}

/// One change Compy made inside the window. The card says "You can undo it in History"; it has no button.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct CompyChange {
    pub title: String,
    pub at: String,
    /// The user turned it back; `undone_at` is when, when the ledger recorded it.
    pub undone: bool,
    pub undone_at: Option<String>,
}

/// What the read-only hardware accessors gave. `hw: None` is "not read yet".
#[derive(Clone, Default)]
pub(crate) struct FactsInput {
    pub hw: Option<HardwareInfo>,
    pub power: PowerSource,
    /// The AMD poller's last FreeSync reading, read from its cache only: `Some(false)` is "reports it off".
    pub freesync: Option<bool>,
}

#[derive(Clone, Default)]
pub(crate) enum FactsRead {
    /// Nobody asked (the pure engine on recorded fixtures): nothing is said either way.
    #[default]
    NotRead,
    /// The reader could not be used: `took-too-long` or `reader-failed`.
    Unavailable(&'static str),
    Read(Box<FactsInput>),
}

impl std::fmt::Debug for FactsRead {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotRead => f.write_str("NotRead"),
            Self::Unavailable(w) => write!(f, "Unavailable({w})"),
            Self::Read(i) => write!(f, "Read(hw ready: {})", i.hw.is_some()),
        }
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) enum HistoryRead {
    #[default]
    NotRead,
    Unavailable(&'static str),
    /// `Err`: the ledger could not be read (damaged, or a file error): never "no changes".
    Read(Result<Vec<LedgerStamp>, String>),
}

/// Under this share of a drive free AND under this many bytes free, the game's drive is "nearly full".
const FULL_PERCENT: f64 = 10.0;
const FULL_BYTES: u64 = 20 * 1_073_741_824;
/// Drives with a health warning listed.
const DRIVES_SHOWN: usize = 3;
const GIB: f64 = 1_073_741_824.0;
/// A refresh rate this far (or more) under the monitor's maximum is a fact; 59 against 60 is a rounding of the mode.
const MONITOR_GAP_HZ: u32 = 5;

fn fact(id: &'static str, args: &[(&'static str, String)]) -> Fact {
    Fact { id, args: args.iter().cloned().collect() }
}

/// The drive letter (upper case) a Windows path starts with, `D` for `D:\SteamLibrary\...`.
pub(super) fn drive_letter(path: &str) -> Option<char> {
    let mut c = path.trim().chars();
    let (a, b) = (c.next()?, c.next()?);
    (a.is_ascii_alphabetic() && b == ':').then(|| a.to_ascii_uppercase())
}

fn gb(bytes: u64) -> String {
    format!("{:.1}", bytes as f64 / GIB)
}

/// What the facts came to: the facts in their fixed order, and the readings that could not be made.
#[derive(Debug, Default, PartialEq)]
pub(super) struct FactsOut {
    pub facts: Vec<Fact>,
    pub unread: Vec<&'static str>,
}

/// Pure: the facts for `hw`, from the readiness rules' own verdicts (`evaluate_readiness`) plus the two the
/// readiness list does not hold (on battery, the game's drive nearly full). The game's drive is only judged
/// for a picked game with a known install folder; a PC-wide fact never needs a game.
pub(super) fn evaluate(hw: &HardwareInfo, power: PowerSource, freesync: Option<bool>, game: &GameCtx) -> FactsOut {
    // The pure evaluator, with the inputs it takes from the machine left out (power plan, FPS monitor, the
    // change ledger): none of those rows is read here.
    let r = evaluate_readiness(hw, None, false, false, Err("not read by the first look"), freesync);
    let mut out = FactsOut::default();
    let unread = |id: &'static str, out: &mut FactsOut| {
        if !out.unread.contains(&id) {
            out.unread.push(id);
        }
    };

    // 1. The main monitor below its maximum refresh rate (the display mode of the primary display).
    match (r.status_of("monitor-refresh"), hw.display.as_ref()) {
        (Some(ReadinessStatus::Attention), Some(d)) if d.max_refresh_rate_hz.saturating_sub(d.current_refresh_rate_hz) >= MONITOR_GAP_HZ => out.facts.push(fact(
            "monitor-refresh",
            &[("now", d.current_refresh_rate_hz.to_string()), ("max", d.max_refresh_rate_hz.to_string())],
        )),
        (Some(ReadinessStatus::Unknown), _) => unread("monitor-refresh", &mut out),
        _ => {}
    }

    // 2. Memory below its rated speed.
    match r.status_of("memory-speed") {
        Some(ReadinessStatus::Attention) => {
            if let Some(m) = hw.memory_modules.iter().find(|m| m.xmp_expo_status == "running_below_rated" && m.rated_speed_mhz > 0) {
                out.facts.push(fact("memory-speed", &[("now", m.speed_mhz.to_string()), ("rated", m.rated_speed_mhz.to_string())]));
            }
        }
        Some(ReadinessStatus::Unknown) => unread("memory-speed", &mut out),
        _ => {}
    }

    // 3. Single-channel memory: one stick, or modules that all name the same channel.
    match r.status_of("memory-channels") {
        Some(ReadinessStatus::Attention) => {
            let n = hw.memory_modules.len();
            if n == 1 {
                out.facts.push(fact("memory-one-stick", &[]));
            } else {
                out.facts.push(fact("memory-one-channel", &[("n", n.to_string())]));
            }
        }
        Some(ReadinessStatus::Unknown) => unread("memory-channels", &mut out),
        _ => {}
    }

    // 4. A drive whose Windows health status is a warning.
    match r.status_of("drive-health") {
        Some(ReadinessStatus::Attention) => {
            for d in hw.disk_health.iter().filter(|d| d.health == "Warning" || d.health == "Unhealthy").take(DRIVES_SHOWN) {
                out.facts.push(fact("drive-health", &[("drive", d.friendly_name.trim().to_string()), ("health", d.health.clone())]));
            }
        }
        Some(ReadinessStatus::Unknown) => unread("drive-health", &mut out),
        _ => {}
    }

    // 5. The picked game's library on an HDD (that game's drive only, never "some library").
    let letter = game.picked().then(|| game.install_dir().and_then(drive_letter));
    match letter {
        Some(Some(l)) => {
            let lib = hw.game_storage.libraries.iter().find(|lib| lib.drive.trim().trim_end_matches(':').eq_ignore_ascii_case(&l.to_string()));
            match lib.map(|lib| lib.media_type.as_str()) {
                Some("HDD") => out.facts.push(fact("game-on-hdd", &[("drive", l.to_string())])),
                Some("SSD" | "SCM") => {}
                _ => unread("game-drive", &mut out),
            }
        }
        Some(None) => unread("game-drive", &mut out),
        None => {}
    }

    // 6. A graphics driver more than a year old (the readiness rule's own threshold).
    match r.status_of("gpu-driver-age") {
        Some(ReadinessStatus::Attention) => {
            if let Some(g) = hw.gpus.iter().max_by_key(|g| g.vram_bytes) {
                // Microsoft's basic display driver carries a stock date, not a maker's: never "your driver is old".
                let lower = g.name.to_ascii_lowercase();
                let basic = lower.contains("microsoft") || lower.contains("basic display");
                if let (Some(days), false, false) = (g.driver_age_days, basic, g.driver_date.trim().is_empty()) {
                    out.facts.push(fact("gpu-driver-age", &[("days", days.to_string()), ("date", g.driver_date.trim().to_string())]));
                }
            }
        }
        Some(ReadinessStatus::Unknown) => unread("gpu-driver", &mut out),
        _ => {}
    }

    // 7. FreeSync reported off by the AMD card (only when the AMD poller said so; no reading is no line).
    if freesync == Some(false) && r.status_of("vrr") == Some(ReadinessStatus::Attention) {
        out.facts.push(fact("freesync-off", &[]));
    }

    // 8. A laptop on battery.
    match power {
        PowerSource::OnBattery => out.facts.push(fact("on-battery", &[])),
        PowerSource::Unknown => unread("power-source", &mut out),
        PowerSource::AcPower | PowerSource::Desktop => {}
    }

    // 9. The picked game's drive nearly full: under a tenth free AND under 20 GB free.
    if let Some(Some(l)) = letter {
        let disk = hw.disks.iter().find(|d| drive_letter(&d.mount_point) == Some(l));
        match disk {
            Some(d) if d.total_bytes > 0 => {
                let free_pct = d.available_bytes as f64 / d.total_bytes as f64 * 100.0;
                if free_pct < FULL_PERCENT && d.available_bytes < FULL_BYTES {
                    out.facts.push(fact("game-drive-full", &[("drive", l.to_string()), ("free_gb", gb(d.available_bytes)), ("total_gb", gb(d.total_bytes))]));
                }
            }
            _ => unread("game-drive", &mut out),
        }
    }
    out
}

/// Pure: the facts and their limits into the answer.
pub(super) fn facts_part(read: &FactsRead, game: &GameCtx, out: &mut FirstLook) {
    match read {
        FactsRead::NotRead => {}
        FactsRead::Unavailable(why) => out.limits.push(limit("facts", why, &[])),
        FactsRead::Read(inp) => match inp.hw.as_ref() {
            // Never an empty list: Compy has not finished reading this PC's hardware.
            None => out.limits.push(limit("facts", "hardware-not-ready", &[])),
            Some(hw) => {
                let mut r = evaluate(hw, inp.power, inp.freesync, game);
                // The startup snapshot's driver date can be older than a driver installed since: when a graphics
                // driver change is listed in the window, the card never also says the driver is old.
                if out.touch_games.iter().any(|c| c.id.starts_with("gpu-driver")) {
                    r.facts.retain(|f| f.id != "gpu-driver-age");
                }
                out.facts = r.facts;
                if !r.unread.is_empty() {
                    out.limits.push(limit("facts", "unread", &[("list", r.unread.join(","))]));
                }
            }
        },
    }
}

fn parse(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s.trim()).ok().map(|d| d.with_timezone(&Utc))
}

/// Pure: Compy's own changes dated inside the window `(t0, now]`, newest first. No window ("always") lists
/// none. A ledger that could not be read is a limit and keeps the answer from saying "nothing".
pub(super) fn history_part(read: &HistoryRead, t0: Option<DateTime<Utc>>, now: DateTime<Utc>, out: &mut FirstLook) {
    let Some(t0) = t0 else { return };
    match read {
        HistoryRead::NotRead => {}
        HistoryRead::Unavailable(why) => {
            out.limits.push(limit("history", why, &[]));
            out.read_all = false;
        }
        HistoryRead::Read(Err(_)) => {
            out.limits.push(limit("history", "unreadable", &[]));
            out.read_all = false;
        }
        HistoryRead::Read(Ok(stamps)) => {
            let mut rows: Vec<(DateTime<Utc>, CompyChange)> = stamps
                .iter()
                .filter_map(|s| {
                    let at = parse(&s.applied_at)?;
                    (at > t0 && at <= now).then(|| {
                        let undone = s.status == "rolled_back";
                        let undone_at = s.rolled_back_at.as_deref().and_then(parse).map(iso);
                        (at, CompyChange { title: s.title.trim().to_string(), at: iso(at), undone, undone_at })
                    })
                })
                .collect();
            rows.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.title.cmp(&b.1.title)));
            out.compy_changes = rows.into_iter().map(|(_, c)| c).collect();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::first_look::{build_with, Reading, Since, Sources};
    use super::*;
    use crate::change_sources::GameRef;
    use crate::hardware::{DiskHealth, DiskInfo, DisplayInfo, GameLibrary, GpuInfo, MemoryModuleInfo};

    // Every input is hand-built: no test reads the machine, the registry, Steam or the ledger.

    const NOW: &str = "2026-11-20T12:00:00Z";
    fn utc(s: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(s).unwrap().with_timezone(&Utc)
    }

    fn display(now: u32, max: u32) -> DisplayInfo {
        DisplayInfo { width: 2560, height: 1440, current_refresh_rate_hz: now, max_refresh_rate_hz: max, hdr_capable: false }
    }
    fn module(speed: u32, rated: u32, status: &str, channel: Option<&str>) -> MemoryModuleInfo {
        MemoryModuleInfo {
            capacity_bytes: 16 << 30,
            speed_mhz: speed,
            rated_speed_mhz: rated,
            type_name: "DDR5".into(),
            xmp_expo_status: status.into(),
            bank_channel: channel.map(str::to_string),
            ..Default::default()
        }
    }
    fn gpu(days: Option<i64>) -> GpuInfo {
        GpuInfo { name: "AMD Radeon RX 9070".into(), vram_bytes: 16 << 30, driver_age_days: days, driver_date: "2025-01-10T00:00:00Z".into(), ..Default::default() }
    }
    fn lib(drive: &str, media: &str) -> GameLibrary {
        GameLibrary { launcher: "Steam".into(), drive: drive.into(), media_type: media.into(), bus_type: String::new() }
    }
    fn disk(mount: &str, total_gb: u64, free_gb: f64) -> DiskInfo {
        DiskInfo { mount_point: mount.into(), total_bytes: total_gb << 30, available_bytes: (free_gb * GIB) as u64, file_system: "NTFS".into() }
    }
    fn game_on(dir: &str) -> GameCtx {
        GameCtx {
            name: Some("ROB RUN".into()),
            exe: Some("robrun.exe".into()),
            game_ref: Some(GameRef { steam_app_id: Some(1), install_dir: Some(dir.into()), launcher: Some("Steam".into()) }),
            ..GameCtx::default()
        }
    }
    fn ids(o: &FactsOut) -> Vec<&'static str> {
        o.facts.iter().map(|f| f.id).collect()
    }
    fn eval(hw: &HardwareInfo) -> FactsOut {
        evaluate(hw, PowerSource::AcPower, None, &GameCtx::default())
    }
    /// A PC with nothing wrong and every reading made.
    fn healthy() -> HardwareInfo {
        HardwareInfo {
            display: Some(display(250, 250)),
            memory_modules: vec![module(6000, 6000, "running_at_rated", Some("CHANNEL A")), module(6000, 6000, "running_at_rated", Some("CHANNEL B"))],
            disk_health: vec![DiskHealth { friendly_name: "Samsung 990".into(), health: "Healthy".into() }],
            gpus: vec![gpu(Some(40))],
            ..Default::default()
        }
    }

    #[test]
    fn a_healthy_pc_lists_nothing_and_every_reading_was_made() {
        let o = eval(&healthy());
        assert_eq!(o, FactsOut::default(), "{o:?}");
    }

    #[test]
    fn the_main_monitor_below_its_maximum_is_a_fact_with_both_numbers_and_at_maximum_it_is_not() {
        let mut hw = healthy();
        hw.display = Some(display(60, 250));
        let o = eval(&hw);
        assert_eq!(ids(&o), vec!["monitor-refresh"]);
        assert_eq!(o.facts[0].args.get("now").map(String::as_str), Some("60"));
        assert_eq!(o.facts[0].args.get("max").map(String::as_str), Some("250"));
        hw.display = Some(display(250, 250));
        assert!(eval(&hw).facts.is_empty());
        // No display reading, or no supported rates: a limit, not a fact and not silence.
        hw.display = None;
        assert_eq!(eval(&hw).unread, vec!["monitor-refresh"]);
        hw.display = Some(display(60, 0));
        assert_eq!(eval(&hw).unread, vec!["monitor-refresh"]);
    }

    #[test]
    fn memory_below_its_rated_speed_is_a_fact_with_both_speeds() {
        let mut hw = healthy();
        hw.memory_modules = vec![module(4800, 6000, "running_below_rated", Some("CHANNEL A")), module(4800, 6000, "running_below_rated", Some("CHANNEL B"))];
        let o = eval(&hw);
        assert_eq!(ids(&o), vec!["memory-speed"]);
        assert_eq!((o.facts[0].args["now"].as_str(), o.facts[0].args["rated"].as_str()), ("4800", "6000"));
        // Speeds the firmware did not rate are unknown, which is a limit.
        hw.memory_modules = vec![module(4800, 0, "unknown", Some("CHANNEL A")), module(4800, 0, "unknown", Some("CHANNEL B"))];
        let o = eval(&hw);
        assert!(o.facts.is_empty() && o.unread == vec!["memory-speed"]);
    }

    #[test]
    fn single_channel_memory_is_a_fact_for_one_stick_or_one_named_channel_and_not_for_soldered_memory() {
        let mut hw = healthy();
        hw.memory_modules = vec![module(6000, 6000, "running_at_rated", None)];
        let o = eval(&hw);
        assert_eq!(ids(&o), vec!["memory-one-stick"]);
        hw.memory_modules = vec![module(6000, 6000, "running_at_rated", Some("CHANNEL A")), module(6000, 6000, "running_at_rated", Some("CHANNEL A"))];
        let o = eval(&hw);
        assert_eq!(ids(&o), vec!["memory-one-channel"]);
        assert_eq!(o.facts[0].args["n"], "2");
        // A single soldered LPDDR module cannot take a second stick: the readiness rule does not flag it.
        let mut soldered = module(6000, 6000, "running_at_rated", None);
        soldered.type_name = "LPDDR5".into();
        hw.memory_modules = vec![soldered];
        assert!(eval(&hw).facts.is_empty());
        // Modules whose firmware names no channel: not a claim either way.
        hw.memory_modules = vec![module(6000, 6000, "running_at_rated", None), module(6000, 6000, "running_at_rated", None)];
        let o = eval(&hw);
        assert!(o.facts.is_empty() && o.unread == vec!["memory-channels"]);
    }

    #[test]
    fn a_drive_with_a_health_warning_is_a_fact_naming_the_drive_and_healthy_drives_are_not() {
        let mut hw = healthy();
        hw.disk_health.push(DiskHealth { friendly_name: " WD Blue ".into(), health: "Warning".into() });
        let o = eval(&hw);
        assert_eq!(ids(&o), vec!["drive-health"]);
        assert_eq!((o.facts[0].args["drive"].as_str(), o.facts[0].args["health"].as_str()), ("WD Blue", "Warning"));
        hw.disk_health.clear();
        assert_eq!(eval(&hw).unread, vec!["drive-health"]);
        hw.disk_health = (0..5).map(|i| DiskHealth { friendly_name: format!("D{i}"), health: "Unhealthy".into() }).collect();
        assert_eq!(eval(&hw).facts.len(), DRIVES_SHOWN);
    }

    #[test]
    fn the_game_on_an_hdd_is_judged_for_that_games_drive_only() {
        let mut hw = healthy();
        hw.game_storage.libraries = vec![lib("C", "SSD"), lib("D", "HDD")];
        let on = |hw: &HardwareInfo, dir: &str| evaluate(hw, PowerSource::AcPower, None, &game_on(dir));
        assert_eq!(ids(&on(&hw, r"D:\SteamLibrary\steamapps\common\ROB RUN")), vec!["game-on-hdd"]);
        assert_eq!(on(&hw, r"D:\SteamLibrary\steamapps\common\ROB RUN").facts[0].args["drive"], "D");
        assert!(on(&hw, r"C:\Program Files (x86)\Steam\steamapps\common\ROB RUN").facts.is_empty());
        // The whole PC says nothing about a library it was not asked about, even with an HDD library.
        assert!(evaluate(&hw, PowerSource::AcPower, None, &GameCtx::default()).facts.is_empty());
        // A game with no known folder, or on a drive whose type is unknown, is a limit.
        let no_folder = GameCtx { name: Some("X".into()), ..GameCtx::default() };
        assert_eq!(evaluate(&hw, PowerSource::AcPower, None, &no_folder).unread, vec!["game-drive"]);
        hw.game_storage.libraries = vec![lib("D", "Unknown")];
        assert_eq!(on(&hw, r"D:\Games\ROB RUN").unread, vec!["game-drive"]);
    }

    #[test]
    fn a_graphics_driver_more_than_a_year_old_is_a_fact_with_its_age() {
        let mut hw = healthy();
        hw.gpus = vec![gpu(Some(366))];
        let o = eval(&hw);
        assert_eq!(ids(&o), vec!["gpu-driver-age"]);
        assert_eq!(o.facts[0].args["days"], "366");
        assert_eq!(o.facts[0].args["date"], "2025-01-10T00:00:00Z");
        hw.gpus = vec![gpu(Some(365))];
        assert!(eval(&hw).facts.is_empty());
        hw.gpus = vec![gpu(None)];
        assert_eq!(eval(&hw).unread, vec!["gpu-driver"]);
    }

    #[test]
    fn the_driver_fact_is_never_made_for_microsofts_basic_driver_or_a_driver_with_no_date() {
        let mut hw = healthy();
        let mut basic = gpu(Some(7000));
        basic.name = "Microsoft Basic Display Adapter".into();
        hw.gpus = vec![basic];
        assert!(eval(&hw).facts.is_empty());
        let mut undated = gpu(Some(500));
        undated.driver_date = String::new();
        hw.gpus = vec![undated];
        assert!(eval(&hw).facts.is_empty());
    }

    #[test]
    fn the_driver_fact_is_dropped_when_a_graphics_driver_change_is_listed_in_the_window() {
        use crate::paramedic::first_look::Change;
        use crate::paramedic::{Certainty, EvidenceKind};
        let mut hw = healthy();
        hw.gpus = vec![gpu(Some(400))];
        let inp = || FactsInput { hw: Some(hw.clone()), ..FactsInput::default() };
        let said = |out: &FirstLook| out.facts.iter().any(|f| f.id == "gpu-driver-age");
        // No driver change listed: the fact stands.
        let out = build_with(Since::ThisWeek, utc(NOW), &GameCtx::default(), &Sources { facts: FactsRead::Read(Box::new(inp())), ..Sources::default() });
        assert!(said(&out));
        // The same facts after a listed driver change: never both "your driver changed" and "your driver is old".
        let mut out = build_with(Since::ThisWeek, utc(NOW), &GameCtx::default(), &Sources::default());
        out.touch_games.push(Change {
            id: "gpu-driver-changed",
            at: Some("2026-11-19T13:38:22Z".into()),
            precision: "exact",
            args: BTreeMap::new(),
            confidence: Certainty::Possible,
            evidence: EvidenceKind::Known,
            how: "gpu-driver",
        });
        facts_part(&FactsRead::Read(Box::new(inp())), &GameCtx::default(), &mut out);
        assert!(!said(&out), "{:?}", out.facts);
    }

    #[test]
    fn a_refresh_gap_under_five_hz_is_not_a_fact_and_five_is() {
        let mut hw = healthy();
        hw.display = Some(display(59, 60));
        assert!(eval(&hw).facts.is_empty());
        hw.display = Some(display(143, 144));
        assert!(eval(&hw).facts.is_empty());
        hw.display = Some(display(55, 60));
        assert_eq!(ids(&eval(&hw)), vec!["monitor-refresh"]);
        // A main monitor at its maximum is no fact whatever a second monitor runs at: only the primary is read.
        hw.display = Some(display(250, 250));
        assert!(eval(&hw).facts.is_empty());
    }

    #[test]
    fn freesync_is_a_fact_only_when_the_amd_card_reports_it_off() {
        let hw = healthy();
        let f = |fs| evaluate(&hw, PowerSource::AcPower, fs, &GameCtx::default());
        assert_eq!(ids(&f(Some(false))), vec!["freesync-off"]);
        assert!(f(Some(true)).facts.is_empty());
        // No reading (not an AMD card, or the poller has not run): no line, and not a limit either.
        assert_eq!(f(None), FactsOut::default());
    }

    #[test]
    fn a_laptop_on_battery_is_a_fact_and_an_unreadable_power_source_is_a_limit() {
        let hw = healthy();
        let p = |p| evaluate(&hw, p, None, &GameCtx::default());
        assert_eq!(ids(&p(PowerSource::OnBattery)), vec!["on-battery"]);
        assert_eq!(p(PowerSource::AcPower), FactsOut::default());
        assert_eq!(p(PowerSource::Desktop), FactsOut::default());
        assert_eq!(p(PowerSource::Unknown).unread, vec!["power-source"]);
    }

    #[test]
    fn the_games_drive_nearly_full_needs_both_under_a_tenth_and_under_twenty_gb() {
        let mut hw = healthy();
        hw.game_storage.libraries = vec![lib("D", "SSD")];
        let at = |total: u64, free: f64, hw: &mut HardwareInfo| {
            hw.disks = vec![disk("D:\\", total, free)];
            evaluate(hw, PowerSource::AcPower, None, &game_on(r"D:\SteamLibrary\steamapps\common\ROB RUN"))
        };
        let o = at(500, 12.0, &mut hw);
        assert_eq!(ids(&o), vec!["game-drive-full"]);
        assert_eq!((o.facts[0].args["drive"].as_str(), o.facts[0].args["free_gb"].as_str(), o.facts[0].args["total_gb"].as_str()), ("D", "12.0", "500.0"));
        // Under a tenth but plenty of room (a 4 TB drive with 300 GB free is not nearly full).
        assert!(at(4000, 300.0, &mut hw).facts.is_empty());
        // Few GB free but not under a tenth (a 100 GB drive with 15 GB free).
        assert!(at(100, 15.0, &mut hw).facts.is_empty());
        // Exactly a tenth is not under a tenth.
        assert!(at(100, 10.0, &mut hw).facts.is_empty());
        // The drive is not among the disks Compy listed: a limit.
        hw.disks = vec![disk("C:\\", 500, 5.0)];
        let o = evaluate(&hw, PowerSource::AcPower, None, &game_on(r"D:\Games\ROB RUN"));
        assert!(o.facts.is_empty() && o.unread == vec!["game-drive"]);
    }

    #[test]
    fn the_facts_come_in_their_fixed_order() {
        let mut hw = healthy();
        hw.display = Some(display(60, 250));
        hw.memory_modules = vec![module(4800, 6000, "running_below_rated", None)];
        hw.disk_health = vec![DiskHealth { friendly_name: "WD".into(), health: "Warning".into() }];
        hw.game_storage.libraries = vec![lib("D", "HDD")];
        hw.gpus = vec![gpu(Some(500))];
        hw.disks = vec![disk("D:\\", 500, 12.0)];
        let o = evaluate(&hw, PowerSource::OnBattery, Some(false), &game_on(r"D:\Games\ROB RUN"));
        assert_eq!(
            ids(&o),
            vec!["monitor-refresh", "memory-speed", "memory-one-stick", "drive-health", "game-on-hdd", "gpu-driver-age", "freesync-off", "on-battery", "game-drive-full"]
        );
        assert!(o.unread.is_empty());
    }

    #[test]
    fn hardware_that_is_not_read_yet_is_a_limit_never_an_empty_list() {
        let mut out = build_with(Since::ThisWeek, utc(NOW), &GameCtx::default(), &Sources { facts: FactsRead::Read(Box::default()), ..Sources::default() });
        assert!(out.facts.is_empty());
        assert!(out.limits.iter().any(|l| l.kind == "facts" && l.code == "hardware-not-ready"), "{:?}", out.limits);
        // A reader that was late is said as that.
        out = build_with(Since::ThisWeek, utc(NOW), &GameCtx::default(), &Sources { facts: FactsRead::Unavailable("took-too-long"), ..Sources::default() });
        assert!(out.limits.iter().any(|l| l.kind == "facts" && l.code == "took-too-long"));
        // Nobody asked: nothing is said either way.
        out = build_with(Since::ThisWeek, utc(NOW), &GameCtx::default(), &Sources::default());
        assert!(out.facts.is_empty() && out.limits.iter().all(|l| l.kind != "facts"));
    }

    #[test]
    fn unreadable_readings_are_one_limit_line_that_lists_them() {
        let hw = HardwareInfo::default();
        let inp = FactsInput { hw: Some(hw), power: PowerSource::Unknown, freesync: None };
        let out = build_with(Since::Always, utc(NOW), &GameCtx::default(), &Sources { facts: FactsRead::Read(Box::new(inp)), ..Sources::default() });
        let l = out.limits.iter().find(|l| l.kind == "facts" && l.code == "unread").expect("an unread line");
        assert_eq!(l.args["list"], "monitor-refresh,memory-speed,memory-channels,drive-health,gpu-driver,power-source");
        assert!(out.facts.is_empty());
        // The facts are the PC's present state: "always" does not hide them.
        let inp = FactsInput { hw: Some({ let mut h = healthy(); h.display = Some(display(60, 250)); h }), ..FactsInput::default() };
        let out = build_with(Since::Always, utc(NOW), &GameCtx::default(), &Sources { facts: FactsRead::Read(Box::new(inp)), ..Sources::default() });
        assert_eq!(out.facts.len(), 1);
    }

    fn stamp(title: &str, at: &str, status: &str, undone: Option<&str>) -> LedgerStamp {
        LedgerStamp { title: title.into(), applied_at: at.into(), rolled_back_at: undone.map(str::to_string), status: status.into() }
    }

    fn with_history(h: HistoryRead, since: Since) -> FirstLook {
        build_with(since, utc(NOW), &GameCtx::default(), &Sources { history: h, ..Sources::default() })
    }

    #[test]
    fn compys_own_changes_in_the_window_are_listed_newest_first_with_their_dates() {
        let h = HistoryRead::Read(Ok(vec![
            stamp("Turn off Game DVR", "2026-11-15T10:00:00Z", "applied", None),
            stamp("Set the power plan", "2026-11-18T10:00:00Z", "applied", None),
            stamp("Old tweak", "2026-09-01T10:00:00Z", "applied", None),
            stamp("Undone tweak", "2026-11-17T10:00:00Z", "rolled_back", Some("2026-11-19T08:00:00Z")),
        ]));
        let o = with_history(h, Since::ThisWeek);
        let titles: Vec<&str> = o.compy_changes.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, vec!["Set the power plan", "Undone tweak", "Turn off Game DVR"]);
        assert!(o.compy_changes[1].undone && o.compy_changes[1].undone_at.as_deref() == Some("2026-11-19T08:00:00Z"));
        assert!(!o.compy_changes[0].undone && o.compy_changes[0].undone_at.is_none());
        assert_eq!(o.compy_changes[0].at, "2026-11-18T10:00:00Z");
    }

    #[test]
    fn a_ledger_that_could_not_be_read_is_a_limit_and_not_none_and_always_lists_none() {
        let o = with_history(HistoryRead::Read(Err("damaged".into())), Since::ThisWeek);
        assert!(o.compy_changes.is_empty());
        assert!(o.limits.iter().any(|l| l.kind == "history" && l.code == "unreadable"));
        assert!(!o.read_all, "'nothing changed' is never said while Compy's own changes could not be read");
        let o = with_history(HistoryRead::Unavailable("took-too-long"), Since::ThisWeek);
        assert!(o.limits.iter().any(|l| l.kind == "history" && l.code == "took-too-long"));
        // "Always" reads no window: none listed and nothing said about the ledger.
        let o = with_history(HistoryRead::Read(Ok(vec![stamp("T", "2026-11-18T10:00:00Z", "applied", None)])), Since::Always);
        assert!(o.compy_changes.is_empty() && o.limits.iter().all(|l| l.kind != "history"));
        // Nobody asked: nothing either way.
        let o = with_history(HistoryRead::NotRead, Since::ThisWeek);
        assert!(o.compy_changes.is_empty() && o.limits.is_empty());
    }

    #[test]
    fn the_window_edges_and_unparseable_dates_are_handled() {
        let now = utc(NOW);
        let t0 = now - chrono::Duration::hours(8 * 24);
        let h = HistoryRead::Read(Ok(vec![
            stamp("at the start", &iso(t0), "applied", None),
            stamp("at the end", &iso(now), "applied", None),
            stamp("future", "2026-11-21T10:00:00Z", "applied", None),
            stamp("garbled", "not a date", "applied", None),
        ]));
        let o = with_history(h, Since::ThisWeek);
        let titles: Vec<&str> = o.compy_changes.iter().map(|c| c.title.as_str()).collect();
        assert_eq!(titles, vec!["at the end"], "{titles:?}");
    }

    #[test]
    fn the_whole_pcs_changes_and_facts_do_not_change_the_dated_rows() {
        // The S1 answer is the same with and without these two readers.
        let r = Reading::Unavailable("took-too-long");
        let base = build_with(Since::ThisWeek, utc(NOW), &GameCtx::default(), &Sources { changes: Some(r.clone()), ..Sources::default() });
        let with = build_with(
            Since::ThisWeek,
            utc(NOW),
            &GameCtx::default(),
            &Sources { changes: Some(r), facts: FactsRead::NotRead, history: HistoryRead::Read(Ok(vec![])), ..Sources::default() },
        );
        assert_eq!(base, with);
    }

    #[test]
    fn drive_letters_are_read_from_windows_paths_only() {
        assert_eq!(drive_letter(r"D:\SteamLibrary\steamapps"), Some('D'));
        assert_eq!(drive_letter("c:/x"), Some('C'));
        assert_eq!(drive_letter("C:\\"), Some('C'));
        assert_eq!(drive_letter(r"\\server\share"), None);
        assert_eq!(drive_letter("D"), None);
        assert_eq!(drive_letter(""), None);
    }

    /// Source-text guard: this module and its readers reach nothing that writes or starts a process, and never
    /// the readiness command that writes drift state, the hardware sweep, the AMD poller or the locking ledger load.
    #[test]
    fn the_facts_code_never_writes_starts_a_process_or_calls_what_does() {
        let own = include_str!("facts.rs");
        let own = own.split("#[cfg(test)]").next().unwrap();
        let first_look = include_str!("first_look.rs");
        let real = first_look.split("fn facts_real").nth(1).unwrap().split("const REAL").next().unwrap();
        for (name, text) in [("facts.rs", own), ("facts_real/history_real", real)] {
            for banned in [
                "Command::new",
                "std::fs::write",
                "fs::write",
                "create_dir",
                "rename(",
                "remove_file",
                "get_game_readiness",
                "collect_hardware(",
                "get_hardware_info",
                "ensure_amd_poller_started",
                "load_history(",
                "load_history_for",
                "applied_changes_summary_checked",
                "compy_data_dir",
            ] {
                assert!(!text.contains(banned), "{name} mentions `{banned}`");
            }
        }
        assert!(real.contains("snapshot_if_ready") && real.contains("read_ledger_stamps"));
    }
}
