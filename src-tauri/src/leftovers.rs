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
pub(crate) struct LeftoversReport {
    findings: Vec<Leftover>,
    /// Detectors that actually ran against readable state (counting, not alarm).
    checked: usize,
    /// Detectors whose probe could not be read — surfaced so "nothing found" never overclaims.
    unavailable: Vec<String>,
}

enum Outcome {
    Finding(Leftover),
    Clean,
    Unavailable,
}

struct Detector {
    id: &'static str,
    /// Charter rule #7: the rec id whose ELIGIBILITY on this rig endorses the deviated state —
    /// an endorsed deviation is not rot and is never flagged. (v1's two detectors have no
    /// endorsing rec; the gate exists for the fast-follow detectors, e.g. Game-DVR-off.)
    endorsed_by: Option<&'static str>,
    run: fn(&Value) -> Outcome,
}

const DETECTORS: &[Detector] = &[
    Detector { id: "pagefile-fixed", endorsed_by: None, run: detect_pagefile },
    Detector { id: "memory-compression-off", endorsed_by: None, run: detect_memory_compression },
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
            Outcome::Unavailable => unavailable.push(d.id.to_string()),
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
        None => return Outcome::Unavailable,
        Some(true) => return Outcome::Clean,
        Some(false) => {}
    }
    let files = probes
        .get("pagefiles")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
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

    let first = &files[0];
    let name = first.get("name").and_then(Value::as_str).unwrap_or("pagefile");
    let init = first.get("initial_mb").and_then(Value::as_u64).unwrap_or(0);
    let max = first.get("maximum_mb").and_then(Value::as_u64).unwrap_or(init);
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
        restore_note: "Safe to restore to automatic; fully reversible; takes effect after a reboot."
            .into(),
    })
}

// ── Detector 2: memory compression disabled — the second origin-story detector ─────────────────
// Stock Windows compresses idle pages in RAM. Guides run `Disable-MMAgent -mc` to "cut CPU
// overhead", which makes RAM-tight machines page cold pages to DISK instead. Probe:
// `(Get-MMAgent).MemoryCompression` (read-only PowerShell).
fn detect_memory_compression(probes: &Value) -> Outcome {
    match probes.get("memory_compression").and_then(Value::as_bool) {
        None => return Outcome::Unavailable,
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
        matched_tweak: "\"Disable-MMAgent -mc\" — a guide-era \"cut CPU overhead\" tweak".into(),
        mechanism_cost:
            "Cold memory pages go to disk instead of being compressed in RAM — slower exactly when memory is tight."
                .into(),
        verdict,
        uncertain_source: true,
        restore_note:
            "Safe to restore (Enable-MMAgent); fully reversible; takes effect after a reboot.".into(),
    })
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
    let (mut auto_pf, mut ram_bytes): (Option<bool>, Option<u64>) = (None, None);
    let mut pagefiles: Vec<Value> = Vec::new();
    if let Ok(com) = COMLibrary::new() {
        if let Ok(conn) = WMIConnection::new(com) {
            if let Ok(rows) = conn.query::<ComputerSystemProbe>() {
                if let Some(cs) = rows.into_iter().next() {
                    auto_pf = cs.automatic_managed_pagefile;
                    ram_bytes = cs.total_physical_memory;
                }
            }
            if let Ok(rows) = conn.query::<PageFileSettingProbe>() {
                pagefiles = rows
                    .into_iter()
                    .map(|p| {
                        json!({
                            "name": p.name,
                            "initial_mb": p.initial_size,
                            "maximum_mb": p.maximum_size,
                        })
                    })
                    .collect();
            }
        }
    }

    json!({
        "automatic_managed_pagefile": auto_pf,
        "pagefiles": pagefiles,
        "memory_compression": read_memory_compression(),
        "ram_total_bytes": ram_bytes,
    })
}

/// Read-only PowerShell probe: `(Get-MMAgent).MemoryCompression` prints True/False. Anything
/// else (missing cmdlet, error, garbled output) is honestly None — never guessed.
fn read_memory_compression() -> Option<bool> {
    let out = crate::actions::quiet_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", "(Get-MMAgent).MemoryCompression"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    match String::from_utf8_lossy(&out.stdout).trim() {
        "True" => Some(true),
        "False" => Some(false),
        _ => None,
    }
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
#[tauri::command]
pub(crate) fn get_leftovers() -> LeftoversReport {
    let probes = gather_probes();
    evaluate_leftovers(&probes, &endorsed_rec_ids())
}

#[cfg(test)]
mod leftovers_tests {
    use super::*;

    fn probes(auto_pf: Option<bool>, pagefiles: Value, mc: Option<bool>, ram_gb: Option<u64>) -> Value {
        json!({
            "automatic_managed_pagefile": auto_pf,
            "pagefiles": pagefiles,
            "memory_compression": mc,
            "ram_total_bytes": ram_gb.map(|g| g * 1024 * 1024 * 1024),
        })
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
        assert_eq!(r.checked, 2, "both detectors ran and judged clean");
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
        assert_eq!(r.checked, 0, "nothing was actually checked");
        assert_eq!(r.unavailable.len(), 2, "both detectors report unreadable probes");
        assert!(r.unavailable.contains(&"pagefile-fixed".to_string()));
        assert!(r.unavailable.contains(&"memory-compression-off".to_string()));
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
