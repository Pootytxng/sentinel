//! Leftovers (v1): READ-ONLY detection of pre-existing "optimizer rot" — tweaks a guide talked
//! the user into before Compy was installed (spec 2026-06-11-leftovers-detector-v1-build; charter
//! 2026-06-06-leftovers-rot-detection-brief). Mirrors readiness/priorities: read probes gather raw
//! state → serialize → a PURE evaluator (`evaluate_leftovers`) judges it, so every verdict is
//! fixture-testable with zero system access. Mutates nothing; v1 wires NO restore action.
//!
//! Anti-snake-oil charter (the non-negotiables this module encodes):
//! - Closed catalog: ONLY the curated detector list below — no heuristics, no "registry junk".
//! - "Nothing found" is a first-class result; an UNREADABLE probe is reported as unchecked,
//!   never silently counted as clean.
//! - Receipts, not adjectives: exact current value · Windows stock default · matched guide-era
//!   tweak · the mechanism of what it costs · a hardware-aware verdict for THIS rig.
//! - Honest uncertainty: we can never prove who set a value — every finding says so and the
//!   user's deliberate choice stays theirs to keep.
//! - Endorsed states are NOT rot (rule #7): a deviation Compy's own rec engine would endorse on
//!   this hardware is skipped via `endorsed_by` before any flagging.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use wmi::{COMLibrary, WMIConnection};

#[derive(Serialize, Clone)]
pub(crate) struct Leftover {
    pub(crate) id: String,
    title: String,
    /// The receipt: the exact value found on this machine right now.
    current_value: String,
    /// The receipt's other half: what stock Windows does.
    stock_default: String,
    /// Which guide-era tweak this matches (the curated wanted-poster, not a guess).
    matched_tweak: String,
    /// One plain sentence: the mechanism of what it actually costs (disk/latency/stability).
    mechanism_cost: String,
    /// Hardware-aware, for THIS rig, in plain English. Never a score, never a boost.
    verdict: String,
    /// Rule #5: origin is unprovable — the UI renders "if you set this on purpose, keep it".
    uncertain_source: bool,
    /// Informational only in v1 (no restore is wired): reversibility + reboot honesty.
    restore_note: String,
}

#[derive(Serialize)]
pub(crate) struct UnavailableProbe {
    pub(crate) id: String,
    /// Display name for the unchecked detector — the UI names what it could NOT verify.
    title: String,
    /// Plain-English why: "needs admin to check" / "couldn't read this setting".
    reason: String,
}

#[derive(Serialize)]
pub(crate) struct LeftoversReport {
    findings: Vec<Leftover>,
    /// Detectors that actually ran against readable state (counting, not alarm).
    checked: usize,
    /// Detectors whose probe could not be read — surfaced so "nothing found" never overclaims.
    unavailable: Vec<UnavailableProbe>,
}

enum Outcome {
    Finding(Leftover),
    Clean,
    /// The probe couldn't be read; the reason is honest and user-facing.
    Unavailable(&'static str),
}

const REASON_UNREADABLE: &str = "couldn't read this setting";
const REASON_NEEDS_ADMIN: &str = "needs admin to check";

struct Detector {
    id: &'static str,
    /// Display name, used when the detector reports its probe unreadable.
    title: &'static str,
    /// Charter rule #7: the rec id whose ELIGIBILITY on this rig endorses the deviated state —
    /// an endorsed deviation is not rot and is never flagged. (None of the current detectors
    /// have an endorsing rec; the gate exists for any future detector that does.)
    endorsed_by: Option<&'static str>,
    run: fn(&Value) -> Outcome,
}

const DETECTORS: &[Detector] = &[
    Detector { id: "pagefile-fixed", title: "Pagefile sizing", endorsed_by: None, run: detect_pagefile },
    Detector { id: "memory-compression-off", title: "Memory compression", endorsed_by: None, run: detect_memory_compression },
    Detector { id: "bcdedit-timer-flags", title: "Boot timer flags (bcdedit)", endorsed_by: None, run: detect_bcdedit_timer_flags },
    Detector { id: "mmcss-tampering", title: "MMCSS multimedia profile", endorsed_by: None, run: detect_mmcss },
    Detector { id: "core-parking-forced", title: "Core parking override", endorsed_by: None, run: detect_core_parking },
    Detector { id: "defender-policy-off", title: "Defender real-time policy", endorsed_by: None, run: detect_defender_policy },
    Detector { id: "mpo-disabled", title: "Multiplane overlay (MPO)", endorsed_by: None, run: detect_mpo },
    Detector { id: "tcp-autotuning-off", title: "TCP receive auto-tuning", endorsed_by: None, run: detect_tcp_autotuning },
    Detector { id: "win32-priority-separation", title: "Win32PrioritySeparation", endorsed_by: None, run: detect_priority_separation },
];

/// Pure core, parameterized over the detector list so the endorsement gate itself is testable
/// with a synthetic detector (the real list's v1 entries are never endorsed).
fn evaluate_with(
    detectors: &[Detector],
    probes: &Value,
    endorsed_rec_ids: &HashSet<String>,
) -> LeftoversReport {
    let mut findings = Vec::new();
    let mut unavailable = Vec::new();
    let mut checked = 0usize;
    for d in detectors {
        if let Some(rec) = d.endorsed_by {
            if endorsed_rec_ids.contains(rec) {
                continue; // rule #7: Compy itself would set this state on this rig — not rot.
            }
        }
        match (d.run)(probes) {
            Outcome::Finding(f) => {
                checked += 1;
                findings.push(f);
            }
            Outcome::Clean => checked += 1,
            Outcome::Unavailable(reason) => unavailable.push(UnavailableProbe {
                id: d.id.to_string(),
                title: d.title.to_string(),
                reason: reason.to_string(),
            }),
        }
    }
    LeftoversReport { findings, checked, unavailable }
}

/// Pure: judge serialized probe state against the curated detector catalog.
pub(crate) fn evaluate_leftovers(probes: &Value, endorsed_rec_ids: &HashSet<String>) -> LeftoversReport {
    evaluate_with(DETECTORS, probes, endorsed_rec_ids)
}

fn ram_gb(probes: &Value) -> Option<u64> {
    probes
        .get("ram_total_bytes")
        .and_then(Value::as_u64)
        .map(|b| ((b as f64) / 1024f64.powi(3)).round() as u64)
}

// ── Detector 1: manually fixed (or disabled) pagefile — the origin-story detector ──────────────
// Stock Windows manages the pagefile automatically. Guides fix it ("1.5× your RAM!") or disable
// it outright; both are on Compy's own refuse list. Probe: Win32_ComputerSystem
// .AutomaticManagedPagefile + Win32_PageFileSetting entries.
fn detect_pagefile(probes: &Value) -> Outcome {
    match probes.get("automatic_managed_pagefile").and_then(Value::as_bool) {
        None => return Outcome::Unavailable(REASON_UNREADABLE),
        Some(true) => return Outcome::Clean,
        Some(false) => {}
    }
    // A pagefile list that couldn't be read is null, never "no pagefile" (codebase review 2026-11-02):
    // a failed query reported "Disabled entirely" with a crash-to-desktop verdict.
    let Some(files) = probes.get("pagefiles").and_then(Value::as_array).cloned() else {
        return Outcome::Unavailable(REASON_UNREADABLE);
    };
    let ram = ram_gb(probes);
    let on_your = |what: &str| match ram {
        Some(gb) => format!("On your {gb} GB-RAM machine {what}"),
        None => format!("On this machine {what}"),
    };

    if files.is_empty() {
        // AutomaticManagedPagefile=false with no configured pagefile = disabled entirely.
        return Outcome::Finding(Leftover {
            id: "pagefile-fixed".into(),
            title: "Pagefile disabled".into(),
            current_value: "Disabled entirely — no pagefile configured".into(),
            stock_default: "Automatic (system-managed size)".into(),
            matched_tweak: "\"Disable the pagefile\" — a classic optimizer-guide tweak".into(),
            mechanism_cost:
                "Games that commit more memory than your RAM hard-crash with no pagefile to absorb it."
                    .into(),
            verdict: on_your(
                "one over-committing game is an instant crash to desktop — automatic sizing costs nothing.",
            ),
            uncertain_source: true,
            restore_note: "Safe to restore to automatic; fully reversible; takes effect after a reboot."
                .into(),
        });
    }

    // A per-drive "System managed size" entry reads 0/0 (CR-pagefile-0): Windows sizes that file,
    // so it is not a fixed pagefile (the restore path refuses that form too). Only an entry with both
    // sizes read and non-zero is fixed (the restore refuses any zero, and a 0 MB cap would print a
    // false verdict); one whose sizes can't be read, or are half zero, is never called either way.
    let sizes = |f: &Value| {
        (
            f.get("initial_mb").and_then(Value::as_u64),
            f.get("maximum_mb").and_then(Value::as_u64),
        )
    };
    let fixed = files.iter().find_map(|f| match sizes(f) {
        (Some(init), Some(max)) if init > 0 && max > 0 => Some((f, init, max)),
        _ => None,
    });
    let Some((first, init, max)) = fixed else {
        return if files.iter().all(|f| sizes(f) == (Some(0), Some(0))) {
            Outcome::Clean
        } else {
            Outcome::Unavailable(REASON_UNREADABLE)
        };
    };
    let name = first.get("name").and_then(Value::as_str).unwrap_or("pagefile");
    let max_gb = ((max as f64) / 1024.0).round() as u64;
    // Hardware-aware: with plentiful RAM a big fixed file is pure disk spend; with modest RAM the
    // sharper cost is the hard cap — Windows can't grow past it when a game overcommits.
    let verdict = match ram {
        Some(gb) if gb >= 16 => on_your(&format!(
            "a fixed {max_gb} GB pagefile spends ~{max_gb} GB of disk and changes nothing about game performance."
        )),
        _ => on_your(&format!(
            "the fixed cap is the sharper risk — if a game overcommits past {max} MB, Windows can't grow the file and the game crashes; automatic sizing avoids that."
        )),
    };
    // CR-pagefile-multi: the restore takes exactly one fixed entry and refuses any other layout
    // (`actions::parse_manual_pagefile_entry`), so a finding over several rows (a managed C: beside
    // a fixed D:) must not read as restorable. Say it is not one-click and how to do it by hand.
    let restore_note = if files.len() > 1 {
        PAGEFILE_MULTI_ROW_NOTE
    } else {
        "Safe to restore to automatic; fully reversible; takes effect after a reboot."
    };
    Outcome::Finding(Leftover {
        id: "pagefile-fixed".into(),
        title: "Pagefile manually fixed".into(),
        current_value: format!("Fixed at {init}–{max} MB ({name})"),
        stock_default: "Automatic (system-managed size)".into(),
        matched_tweak: "\"Set a fixed pagefile size\" — optimization guides circa 2015–2023".into(),
        mechanism_cost: "A fixed size either wastes disk (too big) or caps Windows below what a game may commit (too small)."
            .into(),
        verdict,
        uncertain_source: true,
        restore_note: restore_note.into(),
    })
}

/// The pagefile note when settings sit on more than one drive: Compy's restore refuses that layout,
/// so the note never offers it and names the Windows screen that does it instead.
const PAGEFILE_MULTI_ROW_NOTE: &str = "Not a one-click restore here: this PC has pagefile settings on more than one drive, and Compy's restore only handles a single fixed pagefile. To go back to automatic yourself, open System Properties > Advanced > Performance Settings > Advanced > Virtual memory > Change, tick \"Automatically manage paging file size for all drives\", then reboot (it takes effect after a reboot).";

// ── Detector 2: memory compression disabled — the second origin-story detector ─────────────────
// Stock Windows compresses idle pages in RAM. Guides run `Disable-MMAgent -mc` to "cut CPU
// overhead", which makes RAM-tight machines page cold pages to DISK instead. Probe:
// `(Get-MMAgent).MemoryCompression` (read-only PowerShell).
fn detect_memory_compression(probes: &Value) -> Outcome {
    match probes.get("memory_compression").and_then(Value::as_bool) {
        None => {
            // Get-MMAgent is admin-only — say so, rather than a generic "couldn't read".
            let needs_admin = probes
                .get("memory_compression_needs_admin")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            return Outcome::Unavailable(if needs_admin { REASON_NEEDS_ADMIN } else { REASON_UNREADABLE });
        }
        Some(true) => return Outcome::Clean,
        Some(false) => {}
    }
    let ram = ram_gb(probes);
    // Hardware-aware: on a huge-RAM workstation this can be a deliberate, defensible choice — say
    // so and default to "leave it". On modest RAM it works directly against the user's worst
    // moments (game + browser + Discord all resident).
    let verdict = match ram {
        Some(gb) if gb >= 64 => format!(
            "On a {gb} GB-RAM machine you may genuinely never feel this — it could be a deliberate choice; leave it unless you remember why it's off."
        ),
        Some(gb) => format!(
            "On your {gb} GB-RAM machine, RAM-tight moments (a game plus browser plus voice chat) page to disk instead of compressing in RAM — restoring the default helps exactly those moments."
        ),
        None => "Under memory pressure this machine pages to disk where stock Windows would compress in RAM."
            .into(),
    };
    Outcome::Finding(Leftover {
        id: "memory-compression-off".into(),
        title: "Memory compression disabled".into(),
        current_value: "Disabled (Get-MMAgent → MemoryCompression: False)".into(),
        stock_default: "Enabled — Windows compresses idle memory in RAM".into(),
        matched_tweak: "\"Disable-MMAgent -mc\" — a guide-era \"cut CPU overhead\" tweak".into(), // mutation-boundary-allow: names the tweak we FOUND
        mechanism_cost:
            "Cold memory pages go to disk instead of being compressed in RAM — slower exactly when memory is tight."
                .into(),
        verdict,
        uncertain_source: true,
        restore_note:
            "Safe to restore (Enable-MMAgent); fully reversible; takes effect after a reboot.".into(), // mutation-boundary-allow: tells the user the cmdlet; the restore runs through actions.rs
    })
}

// ── Helpers for the registry-shaped probes ──────────────────────────────────────────────────────
// Each registry probe serializes as { "readable": bool, "<value>": n|null } — readable:false means
// the hive/key couldn't be opened (→ Unavailable); readable:true with null means the value is
// simply ABSENT, which is the stock state for most of these (→ Clean), never an error.

fn probe_obj<'a>(probes: &'a Value, key: &str) -> Option<&'a Value> {
    probes.get(key).filter(|v| !v.is_null())
}
fn readable(p: &Value) -> bool {
    p.get("readable").and_then(Value::as_bool).unwrap_or(false)
}
fn pu32(p: &Value, key: &str) -> Option<u64> {
    p.get(key).and_then(Value::as_u64)
}

// ── Detector 3: bcdedit timer flags (useplatformclock / disabledynamictick) ────────────────────
// THE classic latency-guide tweak pair. Stock: neither flag exists. bcdedit usually needs admin
// even to READ — that degrades to an honest "needs admin to check", never a guess.
fn detect_bcdedit_timer_flags(probes: &Value) -> Outcome {
    let p = match probe_obj(probes, "bcdedit") {
        Some(p) => p,
        None => return Outcome::Unavailable(REASON_UNREADABLE),
    };
    if p.get("needs_admin").and_then(Value::as_bool).unwrap_or(false) {
        return Outcome::Unavailable(REASON_NEEDS_ADMIN);
    }
    if !readable(p) {
        return Outcome::Unavailable(REASON_UNREADABLE);
    }
    // A flag the probe could not read (a value word this build does not know) is null: the store is
    // unreadable, never clean and never rotted (CR-localized-reads, review round 1).
    let flag = |key: &str| match p.get(key) {
        Some(Value::Bool(b)) => Some(*b),
        Some(Value::Null) => None,
        _ => Some(false),
    };
    let (Some(upc), Some(ddt)) = (flag("useplatformclock"), flag("disabledynamictick")) else {
        return Outcome::Unavailable(REASON_UNREADABLE);
    };
    if !upc && !ddt {
        return Outcome::Clean;
    }
    let mut set = Vec::new();
    if upc {
        set.push("useplatformclock = Yes");
    }
    if ddt {
        set.push("disabledynamictick = Yes");
    }
    Outcome::Finding(Leftover {
        id: "bcdedit-timer-flags".into(),
        title: "Boot timer flags set".into(),
        current_value: set.join(" · "),
        stock_default: "Neither flag set — Windows manages its own timer".into(),
        matched_tweak: "\"bcdedit timer tweaks\" (HPET / dynamic-tick guides)".into(),
        mechanism_cost:
            "Forces a legacy timer path that on modern Windows usually RAISES latency and causes stutter."
                .into(),
        verdict: "These flags fight the scheduler Windows actually ships today — the guide that recommended them predates it.".into(),
        uncertain_source: true,
        restore_note: "Removable with bcdedit /deletevalue (admin); fully reversible; takes effect after a reboot.".into(), // mutation-boundary-allow: names the command; the restore runs through actions.rs
    })
}

// ── Detector 4: MMCSS SystemResponsiveness / NetworkThrottlingIndex tampering ──────────────────
// Stock: SystemResponsiveness 20, NetworkThrottlingIndex 10 (or both absent = defaults). Guides
// set 0/1 and 0xFFFFFFFF to "prioritize games"; the reservation exists to keep audio/input smooth.
fn detect_mmcss(probes: &Value) -> Outcome {
    let p = match probe_obj(probes, "mmcss") {
        Some(p) => p,
        None => return Outcome::Unavailable(REASON_UNREADABLE),
    };
    if !readable(p) {
        return Outcome::Unavailable(REASON_UNREADABLE);
    }
    let sr = pu32(p, "system_responsiveness");
    let nti = pu32(p, "network_throttling");
    let sr_rotted = sr.is_some_and(|v| v != 20);
    let nti_rotted = nti.is_some_and(|v| v != 10);
    if !sr_rotted && !nti_rotted {
        return Outcome::Clean;
    }
    let mut found = Vec::new();
    if sr_rotted {
        found.push(format!("SystemResponsiveness = {}", sr.unwrap_or_default()));
    }
    if nti_rotted {
        let v = nti.unwrap_or_default();
        found.push(if v == 0xFFFF_FFFF {
            "NetworkThrottlingIndex = 0xFFFFFFFF (off)".to_string()
        } else {
            format!("NetworkThrottlingIndex = {v}")
        });
    }
    Outcome::Finding(Leftover {
        id: "mmcss-tampering".into(),
        title: "Multimedia scheduler values changed".into(),
        current_value: found.join(" · "),
        stock_default: "SystemResponsiveness 20 · NetworkThrottlingIndex 10".into(),
        matched_tweak: "\"MMCSS gaming tweaks\" — SystemProfile registry packs".into(),
        mechanism_cost:
            "The 20% reservation keeps audio and input smooth under load; removing it trades occasional crackle/hitching for no measured FPS win."
                .into(),
        verdict: "Windows' multimedia scheduler already prioritizes the foreground game — these values mostly remove its safety margin.".into(),
        uncertain_source: true,
        restore_note: "Safe to restore the defaults; fully reversible; takes effect after a sign-out or reboot.".into(),
    })
}

// ── Detector 5: core parking forced off via power-plan override ─────────────────────────────────
// Only the UNAMBIGUOUS guide pattern is flagged: CPMINCORES forced to 100% on a plan whose stock
// value isn't already 100 (High performance / Ultimate ship unparked — flagging there would be
// noise). Anything subtler stays unflagged (charter rule #5: honest uncertainty beats a guess).
fn detect_core_parking(probes: &Value) -> Outcome {
    let p = match probe_obj(probes, "core_parking") {
        Some(p) => p,
        None => return Outcome::Unavailable(REASON_UNREADABLE),
    };
    if !readable(p) {
        return Outcome::Unavailable(REASON_UNREADABLE);
    }
    let min_pct = match pu32(p, "min_cores_ac_pct") {
        Some(v) => v,
        None => return Outcome::Clean, // no override present = stock
    };
    let plan = p.get("plan_name").and_then(Value::as_str).unwrap_or("").to_lowercase();
    // Plans that legitimately ship with parking off — incl. vendor plans (AMD "Ryzen Balanced"
    // ships min-cores ~100 stock). Conservative direction: miss rot rather than false-flag stock.
    // The stock performance plans are known by their class (from the scheme GUID, so a localized
    // name cannot hide them, CR-localized-reads); the vendor plan and a probe from an older build
    // without `plan_class` still go by the words.
    let plan_class = p.get("plan_class").and_then(Value::as_str).unwrap_or("");
    let plan_ships_unparked = matches!(plan_class, "high-performance" | "ultimate")
        || plan.contains("high performance")
        || plan.contains("ultimate")
        || plan.contains("ryzen");
    if min_pct < 100 || plan_ships_unparked {
        return Outcome::Clean;
    }
    Outcome::Finding(Leftover {
        id: "core-parking-forced".into(),
        title: "Core parking forced off".into(),
        current_value: format!("Minimum unparked cores = 100% on the \"{}\" plan", p.get("plan_name").and_then(Value::as_str).unwrap_or("current")),
        stock_default: "Plan-managed (Balanced parks idle cores to save power and heat)".into(),
        matched_tweak: "\"Disable core parking\" — unpark-utility / registry guides".into(),
        mechanism_cost:
            "Keeps every core awake at all times: more idle heat and power for a scheduler decision Windows already makes well per-load."
                .into(),
        verdict: "Modern Windows unparks cores in microseconds when load arrives — the forced override spends watts on a solved problem.".into(),
        uncertain_source: true,
        restore_note: "Safe to remove the override (powercfg); fully reversible; takes effect immediately.".into(),
    })
}

// ── Detector 6: Defender real-time disabled via POLICY key ─────────────────────────────────────
// READ-ONLY probe of HKLM\SOFTWARE\Policies\Microsoft\Windows Defender. Stock: no policy override.
// A set policy can be guide-rot OR a managed work PC — the copy says both, calmly (no siren).
fn detect_defender_policy(probes: &Value) -> Outcome {
    let p = match probe_obj(probes, "defender_policy") {
        Some(p) => p,
        None => return Outcome::Unavailable(REASON_UNREADABLE),
    };
    if !readable(p) {
        return Outcome::Unavailable(REASON_UNREADABLE);
    }
    let rt_off = pu32(p, "disable_realtime").is_some_and(|v| v == 1);
    let av_off = pu32(p, "disable_antispyware").is_some_and(|v| v == 1);
    if !rt_off && !av_off {
        return Outcome::Clean;
    }
    let mut found = Vec::new();
    if rt_off {
        found.push("DisableRealtimeMonitoring = 1");
    }
    if av_off {
        found.push("DisableAntiSpyware = 1");
    }
    Outcome::Finding(Leftover {
        id: "defender-policy-off".into(),
        title: "Defender disabled by policy".into(),
        current_value: found.join(" · "),
        stock_default: "No policy override — real-time protection on".into(),
        matched_tweak: "\"Disable Windows Defender for FPS\" — registry/policy guides".into(),
        mechanism_cost:
            "The FPS gain is a rounding error; the cost is your only always-on protection — and some anti-cheats react badly."
                .into(),
        verdict: "Nothing here changes itself back — the policy stays until removed.".into(),
        uncertain_source: true,
        restore_note:
            "If this is a work or managed PC, your admin set it — leave it. Otherwise it's removable under HKLM\\SOFTWARE\\Policies; reversible; takes effect after a reboot."
                .into(),
    })
}

// ── Detector 7: MPO (multiplane overlay) disabled via OverlayTestMode ──────────────────────────
// Stock: the value doesn't exist. Guides set OverlayTestMode=5 to "fix flicker"; it also disables
// the composition fast path that saves latency and power on supported GPUs.
fn detect_mpo(probes: &Value) -> Outcome {
    let p = match probe_obj(probes, "mpo") {
        Some(p) => p,
        None => return Outcome::Unavailable(REASON_UNREADABLE),
    };
    if !readable(p) {
        return Outcome::Unavailable(REASON_UNREADABLE);
    }
    match pu32(p, "overlay_test_mode") {
        None => Outcome::Clean,
        Some(v) if v != 5 => Outcome::Clean, // other values aren't the guide pattern — don't guess
        Some(_) => Outcome::Finding(Leftover {
            id: "mpo-disabled".into(),
            title: "Multiplane overlay disabled".into(),
            current_value: "OverlayTestMode = 5 (MPO off)".into(),
            stock_default: "Value absent — MPO on where the GPU supports it".into(),
            matched_tweak: "\"Disable MPO\" — flicker-workaround guides (2017–2022 era)".into(),
            mechanism_cost:
                "Disables a composition fast path — slightly higher present latency and power on GPUs that support MPO."
                    .into(),
            verdict: "The flicker bugs this worked around were driver-era issues that have since been fixed for most hardware.".into(),
            uncertain_source: true,
            restore_note: "Safe to delete the value; fully reversible; takes effect after a reboot.".into(),
        }),
    }
}

// ── Detector 8: TCP receive auto-tuning disabled ────────────────────────────────────────────────
// Stock: "normal". Guides run `netsh int tcp set global autotuninglevel=disabled`, capping the
// receive window at a fixed small size — modern connections get SLOWER, not faster.
fn detect_tcp_autotuning(probes: &Value) -> Outcome {
    let p = match probe_obj(probes, "tcp") {
        Some(p) => p,
        None => return Outcome::Unavailable(REASON_UNREADABLE),
    };
    if !readable(p) {
        // Includes the non-English-Windows parse miss — honesty over a locale guess.
        return Outcome::Unavailable(REASON_UNREADABLE);
    }
    match p.get("autotuning_disabled").and_then(Value::as_bool) {
        None => Outcome::Unavailable(REASON_UNREADABLE),
        Some(false) => Outcome::Clean,
        Some(true) => Outcome::Finding(Leftover {
            id: "tcp-autotuning-off".into(),
            title: "TCP auto-tuning disabled".into(),
            current_value: "Receive Window Auto-Tuning Level = disabled".into(),
            stock_default: "normal — Windows sizes the receive window per connection".into(),
            matched_tweak: "\"netsh TCP mega-packs\" — network-tweak guides".into(),
            mechanism_cost:
                "Caps every connection's receive window at a fixed small size — long or fast links lose real throughput."
                    .into(),
            verdict: "This one usually makes downloads measurably slower today; it solved a Vista-era problem.".into(),
            uncertain_source: true,
            restore_note: "Safe to restore (netsh … autotuninglevel=normal); fully reversible; takes effect immediately.".into(),
        }),
    }
}

// ── Detector 9: Win32PrioritySeparation exotic values ──────────────────────────────────────────
// Stock on client Windows: 2 (0x2). Guides write 0x26/0x28/0x16… to "prioritize the foreground";
// exotic values mostly starve background work the game depends on (audio, streaming, voice).
fn detect_priority_separation(probes: &Value) -> Outcome {
    let p = match probe_obj(probes, "w32ps") {
        Some(p) => p,
        None => return Outcome::Unavailable(REASON_UNREADABLE),
    };
    if !readable(p) {
        return Outcome::Unavailable(REASON_UNREADABLE);
    }
    match pu32(p, "value") {
        None => Outcome::Clean,           // absent = default behavior
        Some(2) => Outcome::Clean,        // the client stock value
        Some(v) => Outcome::Finding(Leftover {
            id: "win32-priority-separation".into(),
            title: "Foreground-priority value changed".into(),
            current_value: format!("Win32PrioritySeparation = {v} (0x{v:X})"),
            stock_default: "2 (0x2) — Windows' shipped foreground preference".into(),
            matched_tweak: "\"Win32PrioritySeparation tweaks\" — foreground-boost guides".into(),
            mechanism_cost:
                "Exotic values re-slice scheduler quanta in ways that can starve the background work games rely on (audio, voice, streaming)."
                    .into(),
            verdict: "The shipped value already favors the foreground; the guide values trade stability for a placebo.".into(),
            uncertain_source: true,
            restore_note: "Safe to restore to 2; fully reversible; takes effect immediately.".into(),
        }),
    }
}

// ── Live probes (read-only) — gathered, serialized, then judged by the pure evaluator ──────────

#[derive(Deserialize)]
#[serde(rename = "Win32_ComputerSystem")]
#[serde(rename_all = "PascalCase")]
struct ComputerSystemProbe {
    automatic_managed_pagefile: Option<bool>,
    total_physical_memory: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename = "Win32_PageFileSetting")]
#[serde(rename_all = "PascalCase")]
struct PageFileSettingProbe {
    name: Option<String>,
    initial_size: Option<u32>,
    maximum_size: Option<u32>,
}

fn gather_probes() -> Value {
    // Each probe degrades to null on failure — the evaluator then reports that detector as
    // "unavailable" rather than ever assuming clean. No probe writes anything.
    //
    // The WMI reads MUST run on the dedicated MTA worker (hardware::on_wmi_thread):
    // `COMLibrary::new()` requests MTA and fails with RPC_E_CHANGED_MODE on the WebView2 STA
    // thread Tauri sync commands run on — the exact trap hardware.rs documents. Field-found
    // 2026-06-11: the owner's rig reported "pagefile sizing unreadable" because this probe ran
    // on the command thread (unit tests missed it — test threads aren't STA).
    let (auto_pf, ram_bytes, pagefiles) = crate::hardware::on_wmi_thread(|| {
        let (mut auto_pf, mut ram_bytes): (Option<bool>, Option<u64>) = (None, None);
        let mut pagefiles: Option<Vec<Value>> = None;
        if let Ok(com) = COMLibrary::new() {
            if let Ok(conn) = WMIConnection::new(com) {
                if let Ok(rows) = conn.query::<ComputerSystemProbe>() {
                    if let Some(cs) = rows.into_iter().next() {
                        auto_pf = cs.automatic_managed_pagefile;
                        ram_bytes = cs.total_physical_memory;
                    }
                }
                if let Ok(rows) = conn.query::<PageFileSettingProbe>() {
                    pagefiles = Some(rows
                        .into_iter()
                        .map(|p| {
                            json!({
                                "name": p.name,
                                "initial_mb": p.initial_size,
                                "maximum_mb": p.maximum_size,
                            })
                        })
                        .collect());
                }
            }
        }
        (auto_pf, ram_bytes, pagefiles)
    });

    let (memory_compression, mc_needs_admin) = read_memory_compression_probe();
    json!({
        "automatic_managed_pagefile": auto_pf,
        "pagefiles": pagefiles,
        "memory_compression": memory_compression,
        "memory_compression_needs_admin": mc_needs_admin,
        "ram_total_bytes": ram_bytes,
        "bcdedit": probe_bcdedit(),
        "mmcss": read_hklm_u32s(
            r"SOFTWARE\Microsoft\Windows NT\CurrentVersion\Multimedia\SystemProfile",
            &[("system_responsiveness", "SystemResponsiveness"), ("network_throttling", "NetworkThrottlingIndex")],
        ),
        "core_parking": probe_core_parking(),
        "defender_policy": probe_defender_policy(),
        "mpo": read_hklm_u32s(r"SOFTWARE\Microsoft\Windows\Dwm", &[("overlay_test_mode", "OverlayTestMode")]),
        "tcp": probe_tcp(),
        "w32ps": read_hklm_u32s(
            r"SYSTEM\CurrentControlSet\Control\PriorityControl",
            &[("value", "Win32PrioritySeparation")],
        ),
    })
}

/// Read u32 values from one HKLM key (READ-ONLY). An absent key or value is the stock state
/// (readable:true, value null) — only a real open/read error marks the probe unreadable.
fn read_hklm_u32s(path: &str, names: &[(&str, &str)]) -> Value {
    use winreg::enums::HKEY_LOCAL_MACHINE;
    use winreg::RegKey;
    let mut obj = serde_json::Map::new();
    match RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            obj.insert("readable".into(), Value::Bool(true)); // key absent = stock
            for (json_key, _) in names {
                obj.insert((*json_key).into(), Value::Null);
            }
        }
        Err(_) => {
            obj.insert("readable".into(), Value::Bool(false));
        }
        Ok(key) => {
            obj.insert("readable".into(), Value::Bool(true));
            for (json_key, reg_name) in names {
                let v: Option<u32> = key.get_value(reg_name).ok();
                obj.insert(
                    (*json_key).into(),
                    v.map(|n| Value::from(n as u64)).unwrap_or(Value::Null),
                );
            }
        }
    }
    Value::Object(obj)
}

/// One bcdedit timer flag, read from the lower-cased `bcdedit /enum {current}` text. The two keys
/// (`useplatformclock`, `disabledynamictick`) are locale-neutral identifiers that open their line and
/// are ABSENT from a stock store: no line → `Some(false)`. A line with a value this build can read
/// decides it ("yes" / "true" / "1" / "on" → set; "no" / "false" / "0" / "off" → not set). A value it
/// cannot read — a localized word, or one mangled by the OEM code page — is `None`: unknown, so the
/// detector says the store could not be read rather than calling it clean OR rotted (CR-localized-reads,
/// 2026-11-04: the English "yes"/"true" read called a rotted localized store clean; review round 1:
/// "any other word means set" would have called a clean one rotted). Pure.
pub(crate) fn bcdedit_flag(text_lower: &str, name: &str) -> Option<bool> {
    let line = text_lower.lines().map(str::trim_start).find(|l| {
        l.starts_with(name) && l[name.len()..].chars().next().is_none_or(char::is_whitespace)
    })?;
    // Reached only with a line: an absent key is the `None` of `find`, mapped below.
    Some(match line[name.len()..].trim() {
        "yes" | "true" | "1" | "on" => true,
        "no" | "false" | "0" | "off" => false,
        _ => return None,
    })
}

/// [`bcdedit_flag`] with the absent key folded in: `Some(false)` when no line opens with the key.
fn bcdedit_flag_or_absent(text_lower: &str, name: &str) -> Option<bool> {
    let present = text_lower.lines().map(str::trim_start).any(|l| {
        l.starts_with(name) && l[name.len()..].chars().next().is_none_or(char::is_whitespace)
    });
    if present { bcdedit_flag(text_lower, name) } else { Some(false) }
}

/// bcdedit /enum {current} — READ-ONLY. Non-elevated reads are usually denied; that is the
/// honest "needs admin to check" path, never a guess.
fn probe_bcdedit() -> Value {
    match crate::actions::quiet_command("bcdedit").args(["/enum", "{current}"]).output() {
        Err(_) => json!({ "readable": false, "needs_admin": false }),
        Ok(o) if !o.status.success() => json!({ "readable": false, "needs_admin": true }),
        Ok(o) => {
            let text = String::from_utf8_lossy(&o.stdout).to_lowercase();
            // A flag whose value this build cannot read is null here, and the detector says so.
            let flag = |name: &str| bcdedit_flag_or_absent(&text, name);
            json!({
                "readable": true,
                "needs_admin": false,
                "useplatformclock": flag("useplatformclock"),
                "disabledynamictick": flag("disabledynamictick"),
            })
        }
    }
}

/// powercfg /q for the core-parking min-cores override (READ-ONLY). Parses the AC index; the
/// plan name rides along so the evaluator can excuse plans that ship unparked.
fn probe_core_parking() -> Value {
    let out = crate::actions::quiet_command("powercfg")
        .args(["/q", "SCHEME_CURRENT", "SUB_PROCESSOR", "CPMINCORES"])
        .output();
    let Ok(o) = out else { return json!({ "readable": false }) };
    if !o.status.success() {
        return json!({ "readable": false });
    }
    // One parser with the readiness check (`lib.rs`): the English label when present, else the
    // output's shape, so a localized Windows reads its number too (CR-localized-reads).
    let ac = crate::parse_powercfg_ac_index(&String::from_utf8_lossy(&o.stdout));
    match ac {
        None => json!({ "readable": false }), // format miss — honest, never guessed
        Some(pct) => {
            let plan = crate::current_power_plan();
            json!({
                "readable": true,
                "min_cores_ac_pct": pct,
                "plan_name": plan.as_ref().map(|(_, name)| name.clone()),
                "plan_class": plan.map(|(class, _)| match class {
                    crate::PowerPlanClass::Balanced => "balanced",
                    crate::PowerPlanClass::HighPerformance => "high-performance",
                    crate::PowerPlanClass::Ultimate => "ultimate",
                    crate::PowerPlanClass::Other => "other",
                }),
            })
        }
    }
}

/// Defender POLICY keys (READ-ONLY — never touched, only read; absent = stock).
fn probe_defender_policy() -> Value {
    let root = read_hklm_u32s(
        r"SOFTWARE\Policies\Microsoft\Windows Defender",
        &[("disable_antispyware", "DisableAntiSpyware")],
    );
    let rt = read_hklm_u32s(
        r"SOFTWARE\Policies\Microsoft\Windows Defender\Real-Time Protection",
        &[("disable_realtime", "DisableRealtimeMonitoring")],
    );
    json!({
        "readable": readable(&root) && readable(&rt),
        "disable_antispyware": root.get("disable_antispyware").cloned().unwrap_or(Value::Null),
        "disable_realtime": rt.get("disable_realtime").cloned().unwrap_or(Value::Null),
    })
}

/// netsh TCP global (READ-ONLY). Locale-honest: only explicit known tokens are judged; anything
/// else (non-English output) reports unreadable rather than guessing either way.
fn probe_tcp() -> Value {
    let out = crate::actions::quiet_command("netsh").args(["int", "tcp", "show", "global"]).output();
    let Ok(o) = out else { return json!({ "readable": false }) };
    if !o.status.success() {
        return json!({ "readable": false });
    }
    let text = String::from_utf8_lossy(&o.stdout).to_lowercase();
    let line = text.lines().find(|l| l.contains("auto-tuning") || l.contains("autotuning"));
    match line {
        Some(l) if l.contains("disabled") => json!({ "readable": true, "autotuning_disabled": true }),
        Some(l)
            if l.contains("normal")
                || l.contains("experimental")
                || l.contains("restricted") =>
        {
            json!({ "readable": true, "autotuning_disabled": false })
        }
        _ => json!({ "readable": false }),
    }
}

/// Leftovers v2 restore gate — ARMED 2026-07-16 (Optimization Cleanup Phase 1, owner present).
/// Flipped after the owner-present live-UAC QA harness (`history::manual_restore_qa`) passed all
/// three full loops on real machine state — W32PS, MPO, memcompress: seed → detect → restore
/// (receipt + prior banked) → rollback exact → cleanup to stock, owner approving every prompt.
/// `history::restore_leftover` was registered as a Tauri command in the same commit (the second
/// dark layer); restores ledger into the Trust Ledger with provenance "leftover_adopted".
pub(crate) fn restore_gate() -> bool {
    true
}

// Test-only: the owner-present live-UAC QA harness (history::manual_restore_qa) arms this
// thread-local RAII bypass so the restore path can be exercised regardless of the production
// gate's state (it was the dark-era QA vehicle; kept post-arming so the harness never depends
// on the gate). Mirrors actions::ForceElevationError: `#[cfg(test)]` compiles all of this out
// of every shipped binary, and Drop disarms even on panic.
#[cfg(test)]
thread_local! {
    static QA_RESTORE_GATE_BYPASS: std::cell::RefCell<bool> =
        const { std::cell::RefCell::new(false) };
}

/// RAII guard that opens the restore gate on this thread for the guard's lifetime (test-only).
#[cfg(test)]
pub(crate) struct QaRestoreGateBypass;

#[cfg(test)]
impl QaRestoreGateBypass {
    pub(crate) fn begin() -> Self {
        QA_RESTORE_GATE_BYPASS.with(|f| *f.borrow_mut() = true);
        QaRestoreGateBypass
    }
}

#[cfg(test)]
impl Drop for QaRestoreGateBypass {
    fn drop(&mut self) {
        QA_RESTORE_GATE_BYPASS.with(|f| *f.borrow_mut() = false);
    }
}

#[cfg(test)]
pub(crate) fn qa_restore_gate_bypassed() -> bool {
    QA_RESTORE_GATE_BYPASS.with(|f| *f.borrow())
}

/// Read-only PowerShell probe: `(Get-MMAgent).MemoryCompression` prints True/False. Get-MMAgent
/// is an ADMIN-ONLY read (PermissionDenied, Windows error 5 — verified live on the dev rig
/// 2026-06-11), and Compy runs non-elevated — so a failed read that produced error output is
/// reported as (None, needs_admin=true) and the detector says "needs admin to check" honestly.
/// PowerShell exits 0 even on that non-terminating error, so stderr is the signal, not the code.
pub(crate) fn read_memory_compression_probe() -> (Option<bool>, bool) {
    let Ok(out) = crate::actions::quiet_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "(Get-MMAgent).MemoryCompression"])
        .output()
    else {
        return (None, false);
    };
    match String::from_utf8_lossy(&out.stdout).trim() {
        "True" => (Some(true), false),
        "False" => (Some(false), false),
        _ => (None, !out.stderr.is_empty() || !out.status.success()),
    }
}

/// The state alone — the leftovers-v2 restore reads its prior through this (an elevated future
/// context would see Some; non-elevated it stays None and the restore refuses, as designed).
pub(crate) fn read_memory_compression() -> Option<bool> {
    read_memory_compression_probe().0
}

/// Rec ids the engine would endorse on THIS rig (eligible — applied or not). Read through the
/// serialized shape like export does, so this stays decoupled from recommendations' internals.
fn endorsed_rec_ids() -> HashSet<String> {
    serde_json::to_value(crate::recommendations::get_recommendations())
        .ok()
        .and_then(|v| v.as_array().cloned())
        .map(|recs| {
            recs.iter()
                .filter(|r| r.get("eligible").and_then(Value::as_bool).unwrap_or(true))
                .filter_map(|r| r.get("id").and_then(Value::as_str).map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

/// The ONE new IPC for v1 (read-only, on-demand — no scan on launch, no background scanning).
// The window reaches this through `off_main::get_leftovers` (lib.rs), off the main thread.
pub(crate) fn get_leftovers() -> LeftoversReport {
    let probes = gather_probes();
    evaluate_leftovers(&probes, &endorsed_rec_ids())
}

#[cfg(test)]
mod leftovers_tests {
    use super::*;

    /// Fixture: clean-stock values for every probe; tests override what they exercise.
    fn probes(auto_pf: Option<bool>, pagefiles: Value, mc: Option<bool>, ram_gb: Option<u64>) -> Value {
        json!({
            "automatic_managed_pagefile": auto_pf,
            "pagefiles": pagefiles,
            "memory_compression": mc,
            "ram_total_bytes": ram_gb.map(|g| g * 1024 * 1024 * 1024),
            "bcdedit": { "readable": true, "needs_admin": false, "useplatformclock": false, "disabledynamictick": false },
            "mmcss": { "readable": true, "system_responsiveness": null, "network_throttling": null },
            "core_parking": { "readable": true, "min_cores_ac_pct": 10, "plan_name": "Balanced" },
            "defender_policy": { "readable": true, "disable_realtime": null, "disable_antispyware": null },
            "mpo": { "readable": true, "overlay_test_mode": null },
            "tcp": { "readable": true, "autotuning_disabled": false },
            "w32ps": { "readable": true, "value": 2 },
        })
    }

    fn with(mut p: Value, key: &str, v: Value) -> Value {
        p[key] = v;
        p
    }

    fn find<'a>(r: &'a LeftoversReport, id: &str) -> Option<&'a Leftover> {
        r.findings.iter().find(|f| f.id == id)
    }

    fn no_endorsements() -> HashSet<String> {
        HashSet::new()
    }

    #[test]
    fn rotted_fixture_produces_findings_with_full_receipts() {
        // The owner's real rig, 2026-06-06/08: fixed 30000 MB pagefile + memory compression off.
        let p = probes(
            Some(false),
            json!([{ "name": "C:\\pagefile.sys", "initial_mb": 30000, "maximum_mb": 30000 }]),
            Some(false),
            Some(31),
        );
        let r = evaluate_leftovers(&p, &no_endorsements());
        assert_eq!(r.findings.len(), 2);
        assert!(r.unavailable.is_empty());
        let pf = r.findings.iter().find(|f| f.id == "pagefile-fixed").expect("pagefile finding");
        // Receipts, not adjectives: exact value, stock default, matched tweak, mechanism, rig verdict.
        assert!(pf.current_value.contains("30000"));
        assert!(pf.stock_default.to_lowercase().contains("automatic"));
        assert!(!pf.matched_tweak.is_empty() && !pf.mechanism_cost.is_empty());
        assert!(pf.verdict.contains("31"), "verdict is for THIS rig: {}", pf.verdict);
        assert!(pf.uncertain_source, "origin is unprovable — rule #5");
        assert!(pf.restore_note.to_lowercase().contains("reboot"));
        let mc = r
            .findings
            .iter()
            .find(|f| f.id == "memory-compression-off")
            .expect("memory-compression finding");
        assert!(mc.current_value.contains("False"));
        assert!(mc.verdict.contains("31"));
    }

    #[test]
    fn clean_fixture_finds_nothing_and_says_so_first_class() {
        let p = probes(Some(true), json!([]), Some(true), Some(31));
        let r = evaluate_leftovers(&p, &no_endorsements());
        assert!(r.findings.is_empty(), "stock config must yield ZERO findings");
        assert_eq!(r.checked, DETECTORS.len(), "every detector ran and judged clean");
        assert!(r.unavailable.is_empty());
    }

    #[test]
    fn endorsed_state_is_never_flagged() {
        // Rule #7 gate, proven with a synthetic always-firing detector: when its endorsing rec is
        // eligible on this rig, the deviation is Compy's own recommendation — not rot.
        fn always_fires(_p: &Value) -> Outcome {
            Outcome::Finding(Leftover {
                id: "synthetic".into(),
                title: "t".into(),
                current_value: "c".into(),
                stock_default: "s".into(),
                matched_tweak: "m".into(),
                mechanism_cost: "mc".into(),
                verdict: "v".into(),
                uncertain_source: false,
                restore_note: "r".into(),
            })
        }
        let synthetic = [Detector {
            id: "synthetic",
            title: "Synthetic",
            endorsed_by: Some("game-bar-disable"),
            run: always_fires,
        }];
        let p = probes(Some(true), json!([]), Some(true), Some(31));
        let endorsed: HashSet<String> = ["game-bar-disable".to_string()].into_iter().collect();
        let suppressed = evaluate_with(&synthetic, &p, &endorsed);
        assert!(suppressed.findings.is_empty(), "an endorsed state must never be flagged");
        let unendorsed = evaluate_with(&synthetic, &p, &no_endorsements());
        assert_eq!(unendorsed.findings.len(), 1, "the same detector fires without endorsement");
    }

    // Codebase review 2026-11-02: a pagefile-settings query that failed left an empty list, read as
    // "Disabled entirely" with a crash-to-desktop verdict. Unread is unavailable; an empty list read
    // fine is still the finding.
    #[test]
    fn an_unread_pagefile_list_is_unavailable_never_disabled() {
        let unread = evaluate_leftovers(&probes(Some(false), Value::Null, Some(true), Some(16)), &no_endorsements());
        assert!(unread.findings.iter().all(|f| f.id != "pagefile-fixed"), "an unread list is no finding");
        assert!(unread.unavailable.iter().any(|u| u.id == "pagefile-fixed"), "it is named as unchecked");
        let none = evaluate_leftovers(&probes(Some(false), json!([]), Some(true), Some(16)), &no_endorsements());
        assert!(none.findings.iter().any(|f| f.id == "pagefile-fixed" && f.current_value.contains("Disabled")));
    }

    // CR-pagefile-0: a drive set to "System managed size" reads 0/0 and printed "Fixed at 0–0 MB",
    // a finding whose restore refuses that very form.
    #[test]
    fn a_system_managed_size_entry_is_windows_managed_never_fixed() {
        let managed = json!([{ "name": "C:\\pagefile.sys", "initial_mb": 0, "maximum_mb": 0 }]);
        let r = evaluate_leftovers(&probes(Some(false), managed, Some(true), Some(32)), &no_endorsements());
        assert!(r.findings.iter().all(|f| f.id != "pagefile-fixed"), "0/0 is Windows-sized");
        assert!(r.unavailable.iter().all(|u| u.id != "pagefile-fixed"), "and it was read, not unchecked");
    }

    #[test]
    fn a_fixed_entry_beside_a_system_managed_one_is_the_one_named() {
        let mixed = json!([
            { "name": "C:\\pagefile.sys", "initial_mb": 0, "maximum_mb": 0 },
            { "name": "D:\\pagefile.sys", "initial_mb": 8192, "maximum_mb": 16384 },
        ]);
        let r = evaluate_leftovers(&probes(Some(false), mixed, Some(true), Some(32)), &no_endorsements());
        let f = find(&r, "pagefile-fixed").expect("the D: file is fixed");
        assert_eq!(f.current_value, "Fixed at 8192\u{2013}16384 MB (D:\\pagefile.sys)");
    }

    // CR-pagefile-multi: that same managed-C: + fixed-D: layout read "Safe to restore to
    // automatic", but the restore refuses every layout except one fixed entry. The finding stays
    // (it is still a fixed pagefile); its note says plainly it is not one-click and how to do it.
    #[test]
    fn a_multi_row_pagefile_finding_never_offers_the_one_click_restore() {
        let layouts = [
            json!([
                { "name": "C:\\pagefile.sys", "initial_mb": 0, "maximum_mb": 0 },
                { "name": "D:\\pagefile.sys", "initial_mb": 8192, "maximum_mb": 16384 },
            ]),
            json!([
                { "name": "C:\\pagefile.sys", "initial_mb": 4096, "maximum_mb": 4096 },
                { "name": "D:\\pagefile.sys", "initial_mb": 8192, "maximum_mb": 16384 },
            ]),
        ];
        for files in layouts {
            let r = evaluate_leftovers(&probes(Some(false), files.clone(), Some(true), Some(32)), &no_endorsements());
            let f = find(&r, "pagefile-fixed").expect("still a fixed-pagefile finding");
            let note = f.restore_note.to_lowercase();
            assert!(!note.contains("safe to restore"), "offers the restore it refuses: {files} -> {}", f.restore_note);
            assert!(note.contains("not a one-click restore"), "says so plainly: {}", f.restore_note);
            assert!(note.contains("virtual memory") && note.contains("automatically manage"), "names the way: {}", f.restore_note);
            assert!(note.contains("reboot"), "reboot honesty kept: {}", f.restore_note);
        }
        // A single fixed row keeps the one-click note (the layout the restore accepts).
        let single = json!([{ "name": "C:\\pagefile.sys", "initial_mb": 8192, "maximum_mb": 8192 }]);
        let r = evaluate_leftovers(&probes(Some(false), single, Some(true), Some(32)), &no_endorsements());
        assert!(find(&r, "pagefile-fixed").expect("finding").restore_note.starts_with("Safe to restore"));
    }

    #[test]
    fn a_pagefile_entry_with_unread_sizes_is_unavailable_never_fixed_at_zero() {
        let unread = json!([{ "name": "C:\\pagefile.sys", "initial_mb": null, "maximum_mb": null }]);
        let r = evaluate_leftovers(&probes(Some(false), unread, Some(true), Some(32)), &no_endorsements());
        assert!(r.findings.iter().all(|f| f.id != "pagefile-fixed"), "no 0–0 finding");
        assert!(r.unavailable.iter().any(|u| u.id == "pagefile-fixed"), "named as unchecked");
    }

    // Review r1: a half-zero row is neither the Windows-managed 0/0 form nor a size the restore
    // accepts, and a 0 MB cap would print a false verdict.
    #[test]
    fn a_half_zero_pagefile_entry_is_unavailable_never_a_finding() {
        for (init, max) in [(0, 4096), (4096, 0)] {
            let odd = json!([{ "name": "C:\\pagefile.sys", "initial_mb": init, "maximum_mb": max }]);
            let r = evaluate_leftovers(&probes(Some(false), odd, Some(true), Some(32)), &no_endorsements());
            assert!(r.findings.iter().all(|f| f.id != "pagefile-fixed"), "{init}/{max} is no finding");
            assert!(r.unavailable.iter().any(|u| u.id == "pagefile-fixed"), "{init}/{max} is unchecked");
        }
    }

    #[test]
    fn pagefile_verdict_is_hardware_aware() {
        let fixed = json!([{ "name": "C:\\pagefile.sys", "initial_mb": 8192, "maximum_mb": 8192 }]);
        let big = evaluate_leftovers(&probes(Some(false), fixed.clone(), Some(true), Some(31)), &no_endorsements());
        let small = evaluate_leftovers(&probes(Some(false), fixed, Some(true), Some(8)), &no_endorsements());
        let bv = &big.findings[0].verdict;
        let sv = &small.findings[0].verdict;
        assert_ne!(bv, sv, "same artifact, different rig → different verdict");
        assert!(bv.contains("disk"), "plentiful RAM frames the disk spend: {bv}");
        assert!(sv.contains("crash"), "modest RAM frames the hard-cap risk: {sv}");
    }

    #[test]
    fn memory_compression_verdict_respects_big_ram_deliberate_choice() {
        let modest = evaluate_leftovers(&probes(Some(true), json!([]), Some(false), Some(16)), &no_endorsements());
        let huge = evaluate_leftovers(&probes(Some(true), json!([]), Some(false), Some(128)), &no_endorsements());
        assert!(modest.findings[0].verdict.contains("restoring the default helps"));
        assert!(
            huge.findings[0].verdict.contains("leave it"),
            "128 GB rig defaults to 'leave it' (may be deliberate): {}",
            huge.findings[0].verdict
        );
    }

    #[test]
    fn unreadable_probes_are_reported_unchecked_never_clean() {
        // The loudest honesty rule: a probe failure must NOT contribute to "nothing found".
        let p = probes(None, json!([]), None, Some(31));
        let r = evaluate_leftovers(&p, &no_endorsements());
        assert!(r.findings.is_empty());
        assert_eq!(r.checked, DETECTORS.len() - 2, "the two broken probes were not counted");
        assert_eq!(r.unavailable.len(), 2, "both broken probes report unreadable");
        for id in ["pagefile-fixed", "memory-compression-off"] {
            let u = r.unavailable.iter().find(|u| u.id == id).expect("listed");
            assert_eq!(u.reason, REASON_UNREADABLE);
            assert!(!u.title.is_empty(), "the UI names what it could not verify");
        }
    }

    // ── Detectors 3–9 (sprint item 4) — rotted / clean / honest-degrade fixtures ──────────────

    // CR-localized-reads (2026-11-04): the flag read needs no English value word. The localized lines
    // keep bcdedit's shape (key, spaces, value) with the value in another language; they are not
    // captured zh-CN output, which the repo does not hold.
    #[test]
    fn a_bcdedit_flag_is_read_by_its_key_and_an_unknown_value_word_is_unknown_not_a_verdict() {
        let en = "identifier              {current}\r\nuseplatformclock        Yes\r\ndisabledynamictick      yes\r\n".to_lowercase();
        assert_eq!(bcdedit_flag_or_absent(&en, "useplatformclock"), Some(true));
        assert_eq!(bcdedit_flag_or_absent(&en, "disabledynamictick"), Some(true));
        assert_eq!(bcdedit_flag_or_absent("useplatformclock        no\r\n", "useplatformclock"), Some(false), "an explicit No");
        assert_eq!(bcdedit_flag_or_absent("identifier              {current}\r\ndevice                  partition=c:\r\n", "useplatformclock"), Some(false), "absent is not set");
        // A value word this build does not know (a localized Yes or No, or OEM-mangled bytes) is unknown:
        // neither set nor clear, so the store reads as unreadable, never as clean or rotted.
        assert_eq!(bcdedit_flag_or_absent("useplatformclock        是\r\n", "useplatformclock"), None);
        assert_eq!(bcdedit_flag_or_absent("useplatformclock        \u{FFFD}\u{FFFD}\r\n", "useplatformclock"), None);
        // The key opens the line: a mention inside another value is not the flag.
        assert_eq!(bcdedit_flag_or_absent("description             useplatformclock test\r\n", "useplatformclock"), Some(false));
        assert_eq!(bcdedit_flag_or_absent("useplatformclockx       yes\r\n", "useplatformclock"), Some(false), "a longer key is another key");
    }

    // The detector: a null flag (unreadable value) is "couldn't read", never clean and never rotted.
    #[test]
    fn an_unreadable_bcdedit_flag_makes_the_store_unreadable_not_clean() {
        let unknown = with(
            probes(Some(true), json!([]), Some(true), Some(31)),
            "bcdedit",
            json!({ "readable": true, "needs_admin": false, "useplatformclock": null, "disabledynamictick": false }),
        );
        let r = evaluate_leftovers(&unknown, &no_endorsements());
        assert!(find(&r, "bcdedit-timer-flags").is_none(), "no finding is claimed");
        let u = r.unavailable.iter().find(|u| u.id == "bcdedit-timer-flags").expect("listed as unavailable");
        assert_eq!(u.reason, REASON_UNREADABLE);
    }

    #[test]
    fn bcdedit_flags_fire_and_degrade_to_needs_admin_honestly() {
        let rotted = with(
            probes(Some(true), json!([]), Some(true), Some(31)),
            "bcdedit",
            json!({ "readable": true, "needs_admin": false, "useplatformclock": true, "disabledynamictick": true }),
        );
        let r = evaluate_leftovers(&rotted, &no_endorsements());
        let f = find(&r, "bcdedit-timer-flags").expect("both flags set → finding");
        assert!(f.current_value.contains("useplatformclock") && f.current_value.contains("disabledynamictick"));
        assert!(f.restore_note.to_lowercase().contains("reboot"));
        // Non-elevated read denied → the honest "needs admin to check", never a guess.
        let denied = with(
            probes(Some(true), json!([]), Some(true), Some(31)),
            "bcdedit",
            json!({ "readable": false, "needs_admin": true }),
        );
        let r = evaluate_leftovers(&denied, &no_endorsements());
        let u = r.unavailable.iter().find(|u| u.id == "bcdedit-timer-flags").expect("unavailable");
        assert_eq!(u.reason, REASON_NEEDS_ADMIN);
    }

    #[test]
    fn mmcss_deviations_fire_with_exact_receipts_and_stock_values_stay_clean() {
        let rotted = with(
            probes(Some(true), json!([]), Some(true), Some(31)),
            "mmcss",
            json!({ "readable": true, "system_responsiveness": 0, "network_throttling": 4294967295u64 }),
        );
        let r = evaluate_leftovers(&rotted, &no_endorsements());
        let f = find(&r, "mmcss-tampering").expect("guide values → finding");
        assert!(f.current_value.contains("SystemResponsiveness = 0"));
        assert!(f.current_value.contains("0xFFFFFFFF"));
        // Explicit stock values present in the registry are NOT rot.
        let stock = with(
            probes(Some(true), json!([]), Some(true), Some(31)),
            "mmcss",
            json!({ "readable": true, "system_responsiveness": 20, "network_throttling": 10 }),
        );
        assert!(find(&evaluate_leftovers(&stock, &no_endorsements()), "mmcss-tampering").is_none());
    }

    #[test]
    fn core_parking_flags_balanced_at_100_but_excuses_plans_that_ship_unparked() {
        let base = || probes(Some(true), json!([]), Some(true), Some(31));
        let forced = with(base(), "core_parking",
            json!({ "readable": true, "min_cores_ac_pct": 100, "plan_name": "Balanced" }));
        assert!(find(&evaluate_leftovers(&forced, &no_endorsements()), "core-parking-forced").is_some());
        // Vendor/high-perf plans ship unparked — flagging them would be a false positive
        // (the dev rig's own AMD Ryzen plan is the precedent).
        for plan in ["High performance", "Ultimate Performance", "AMD Ryzen Balanced"] {
            let stock = with(base(), "core_parking",
                json!({ "readable": true, "min_cores_ac_pct": 100, "plan_name": plan }));
            assert!(
                find(&evaluate_leftovers(&stock, &no_endorsements()), "core-parking-forced").is_none(),
                "{plan} ships unparked — not rot"
            );
        }
        // CR-localized-reads (2026-11-04): a stock performance plan named in another language is
        // excused by its CLASS (from the scheme GUID), not its words; a Balanced plan is flagged
        // whatever it is called; a probe from an older build without `plan_class` reads as before.
        let zh_high = with(base(), "core_parking",
            json!({ "readable": true, "min_cores_ac_pct": 100, "plan_name": "高性能", "plan_class": "high-performance" }));
        assert!(find(&evaluate_leftovers(&zh_high, &no_endorsements()), "core-parking-forced").is_none(), "高性能 ships unparked");
        let zh_balanced = with(base(), "core_parking",
            json!({ "readable": true, "min_cores_ac_pct": 100, "plan_name": "平衡", "plan_class": "balanced" }));
        assert!(find(&evaluate_leftovers(&zh_balanced, &no_endorsements()), "core-parking-forced").is_some(), "平衡 at 100 is forced");
    }

    #[test]
    fn defender_policy_finding_is_calm_and_respects_managed_pcs() {
        let rotted = with(
            probes(Some(true), json!([]), Some(true), Some(31)),
            "defender_policy",
            json!({ "readable": true, "disable_realtime": 1, "disable_antispyware": null }),
        );
        let r = evaluate_leftovers(&rotted, &no_endorsements());
        let f = find(&r, "defender-policy-off").expect("policy-off → finding");
        assert!(f.current_value.contains("DisableRealtimeMonitoring = 1"));
        assert!(f.restore_note.contains("admin set it — leave it"), "managed-PC honesty");
        assert!(f.uncertain_source);
        // No scare words — counting, not alarm.
        let all = format!("{} {} {}", f.title, f.mechanism_cost, f.verdict).to_lowercase();
        assert!(!all.contains("danger") && !all.contains("warning") && !all.contains("!"));
    }

    #[test]
    fn mpo_tcp_and_priority_separation_fire_on_the_exact_guide_patterns_only() {
        let base = || probes(Some(true), json!([]), Some(true), Some(31));
        // MPO: only the documented OverlayTestMode=5 pattern is the tweak; other values aren't guessed at.
        let mpo5 = with(base(), "mpo", json!({ "readable": true, "overlay_test_mode": 5 }));
        assert!(find(&evaluate_leftovers(&mpo5, &no_endorsements()), "mpo-disabled").is_some());
        let mpo_other = with(base(), "mpo", json!({ "readable": true, "overlay_test_mode": 1 }));
        assert!(find(&evaluate_leftovers(&mpo_other, &no_endorsements()), "mpo-disabled").is_none());
        // TCP: disabled fires; a locale-unparseable read degrades honestly instead of guessing.
        let tcp_off = with(base(), "tcp", json!({ "readable": true, "autotuning_disabled": true }));
        assert!(find(&evaluate_leftovers(&tcp_off, &no_endorsements()), "tcp-autotuning-off").is_some());
        let tcp_locale = with(base(), "tcp", json!({ "readable": false }));
        let r = evaluate_leftovers(&tcp_locale, &no_endorsements());
        assert!(r.unavailable.iter().any(|u| u.id == "tcp-autotuning-off"));
        // Win32PrioritySeparation: exotic value fires with a hex receipt; stock 2 and absent stay clean.
        let exotic = with(base(), "w32ps", json!({ "readable": true, "value": 38 }));
        let r = evaluate_leftovers(&exotic, &no_endorsements());
        let f = find(&r, "win32-priority-separation").expect("0x26 → finding");
        assert!(f.current_value.contains("38") && f.current_value.contains("0x26"));
        let absent = with(base(), "w32ps", json!({ "readable": true, "value": null }));
        assert!(find(&evaluate_leftovers(&absent, &no_endorsements()), "win32-priority-separation").is_none());
    }

    #[test]
    fn live_probes_parse_real_output_without_panicking() {
        // READ-ONLY live smoke on whatever rig runs the suite: every probe parser sees real
        // bcdedit/netsh/powercfg/registry output and must come back well-formed — findings or
        // not, every unavailable reason is from the known honest set.
        let r = evaluate_leftovers(&gather_probes(), &no_endorsements());
        assert_eq!(
            r.checked + r.unavailable.len(),
            DETECTORS.len(),
            "every detector is accounted for exactly once (checked already includes findings)"
        );
        assert!(r.findings.len() <= r.checked);
        for u in &r.unavailable {
            assert!(
                u.reason == REASON_UNREADABLE || u.reason == REASON_NEEDS_ADMIN,
                "unknown reason: {}",
                u.reason
            );
        }
    }

    // ── Law guards (R2 item 2) — the anti-snake-oil charter locked in CI ───────────────────────

    /// One fixture where every probe shows its detector's rotted pattern → all 9 fire.
    fn fully_rotted() -> Value {
        let mut p = probes(
            Some(false),
            json!([{ "name": "C:\\pagefile.sys", "initial_mb": 30000, "maximum_mb": 30000 }]),
            Some(false),
            Some(31),
        );
        p["bcdedit"] = json!({ "readable": true, "needs_admin": false, "useplatformclock": true, "disabledynamictick": false });
        p["mmcss"] = json!({ "readable": true, "system_responsiveness": 0, "network_throttling": 4294967295u64 });
        p["core_parking"] = json!({ "readable": true, "min_cores_ac_pct": 100, "plan_name": "Balanced" });
        p["defender_policy"] = json!({ "readable": true, "disable_realtime": 1, "disable_antispyware": null });
        p["mpo"] = json!({ "readable": true, "overlay_test_mode": 5 });
        p["tcp"] = json!({ "readable": true, "autotuning_disabled": true });
        p["w32ps"] = json!({ "readable": true, "value": 38 });
        p
    }

    #[test]
    fn law_every_detector_can_fire_and_every_finding_carries_a_full_receipt() {
        let r = evaluate_leftovers(&fully_rotted(), &no_endorsements());
        assert_eq!(
            r.findings.len(),
            DETECTORS.len(),
            "every curated detector must fire on its own rotted fixture (a silent detector is a lie)"
        );
        for f in &r.findings {
            // Charter rule #3 — receipts, not adjectives: every field of the receipt is present.
            for (field, v) in [
                ("current_value", &f.current_value),
                ("stock_default", &f.stock_default),
                ("matched_tweak", &f.matched_tweak),
                ("mechanism_cost", &f.mechanism_cost),
                ("verdict", &f.verdict),
                ("restore_note", &f.restore_note),
            ] {
                assert!(!v.trim().is_empty(), "{}: empty {} — a finding without its receipt", f.id, field);
            }
        }
    }

    #[test]
    fn law_no_boost_promises_no_alarm_anywhere_in_finding_copy() {
        // Charter rule #4 — counting, not alarm; honest-measurement — never promise a gain.
        // (Honest NEGATIONS like "no measured FPS win" are fine; these tokens never are.)
        let banned = ["boost", "speed up", "speeds up", "guaranteed", "instantly faster", "unlock fps"];
        let alarm = ["danger", "warning!", "critical!", "fix now", "issues found"];
        let r = evaluate_leftovers(&fully_rotted(), &no_endorsements());
        for f in &r.findings {
            let copy = format!(
                "{} {} {} {} {} {}",
                f.title, f.current_value, f.stock_default, f.mechanism_cost, f.verdict, f.restore_note
            )
            .to_lowercase();
            for b in banned {
                assert!(!copy.contains(b), "{}: promise language '{b}' in: {copy}", f.id);
            }
            for a in alarm {
                assert!(!copy.contains(a), "{}: alarm language '{a}' in: {copy}", f.id);
            }
            assert!(!f.title.contains('!'), "{}: exclamation in title — sirens are not placards", f.id);
        }
    }

    #[test]
    fn law_report_shape_has_no_score_no_gauge_fields() {
        // Charter rule #4 structurally: the serialized report is findings + counting ONLY.
        let r = evaluate_leftovers(&fully_rotted(), &no_endorsements());
        let v = serde_json::to_value(&r).expect("serializes");
        let keys: Vec<&str> = v.as_object().expect("object").keys().map(|s| s.as_str()).collect();
        assert_eq!(keys.len(), 3, "exactly findings/checked/unavailable — no scores, no grades: {keys:?}");
        for k in ["findings", "checked", "unavailable"] {
            assert!(keys.contains(&k));
        }
    }

    #[test]
    fn law_every_finding_admits_origin_uncertainty() {
        // Charter rule #5: we can never prove who set a value — no finding pretends otherwise.
        let r = evaluate_leftovers(&fully_rotted(), &no_endorsements());
        for f in &r.findings {
            assert!(f.uncertain_source, "{}: must carry the origin-uncertainty flag", f.id);
        }
    }

    #[test]
    fn memory_compression_admin_only_read_reports_needs_admin_honestly() {
        // Field-found 2026-06-11: Get-MMAgent is PermissionDenied non-elevated (error 5), so a
        // failed read with the needs-admin marker must say "needs admin to check" — the same
        // honest degrade bcdedit gets — never the generic unreadable.
        let p = with(
            probes(Some(true), json!([]), None, Some(31)),
            "memory_compression_needs_admin",
            json!(true),
        );
        let r = evaluate_leftovers(&p, &no_endorsements());
        let u = r
            .unavailable
            .iter()
            .find(|u| u.id == "memory-compression-off")
            .expect("unavailable");
        assert_eq!(u.reason, REASON_NEEDS_ADMIN);
        // Without the marker (e.g. cmdlet genuinely absent), the generic reason stands.
        let p = probes(Some(true), json!([]), None, Some(31));
        let r = evaluate_leftovers(&p, &no_endorsements());
        let u = r.unavailable.iter().find(|u| u.id == "memory-compression-off").expect("listed");
        assert_eq!(u.reason, REASON_UNREADABLE);
    }

    #[test]
    fn disabled_pagefile_is_flagged_with_the_crash_mechanism() {
        let p = probes(Some(false), json!([]), Some(true), Some(31));
        let r = evaluate_leftovers(&p, &no_endorsements());
        let f = &r.findings[0];
        assert!(f.current_value.to_lowercase().contains("disabled"));
        assert!(f.mechanism_cost.to_lowercase().contains("crash"));
    }
}
