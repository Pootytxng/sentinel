//! Read-only detection of third-party in-game OVERLAY / OSD tools that are running (A4 advisory).
//!
//! Compy draws its OWN overlay over borderless/windowed games (LOCKED rule 2). When another tool is
//! also drawing an on-screen display, the two can visually overlap. This is purely INFORMATIONAL —
//! it tells you what's running so a double-overlay isn't a mystery; it NEVER claims a tool harms FPS
//! or performance (it doesn't, and Compy won't claim what it can't measure), NEVER tells you to close
//! anything, and NEVER alarms.
//!
//! Honesty design (mirrors `services.rs`):
//!   - Closed, curated catalog matched on the exact process image name — unrecognised processes are
//!     only counted, never guessed into a tool.
//!   - We list ONLY tools where a running process reliably means an OSD is being drawn (RTSS and the
//!     tuning UIs that drive it, Fraps, Bandicam). The big always-running apps whose overlay is a
//!     toggle (Steam, Discord, the NVIDIA/AMD driver overlays) are DELIBERATELY EXCLUDED: their
//!     process being up does NOT prove the overlay is enabled, so flagging them would assert state we
//!     can't read — a fabricated claim. Honest coverage over false positives.
//!   - Receipts, not adjectives — the note states factually what the tool does.
//!   - Honest "nothing found" — only claimed when the process scan actually ran (saw >0 processes).
//!   - Mutates nothing; spawns nothing.

use sysinfo::System;

/// One curated overlay/OSD tool. `process` is the exact image name (with `.exe`), matched
/// case-insensitively.
#[derive(PartialEq, Debug)]
struct OverlayTool {
    process: &'static str,
    /// Friendly tool name for the advisory.
    label: &'static str,
    /// Faithful, factual description of what it draws — never a performance/FPS claim.
    note: &'static str,
}

/// Closed catalog. Only tools whose *running process* reliably indicates an on-screen display is
/// being drawn (so the advisory is honest, not a guess about a toggle we can't read).
const OVERLAY_TOOLS: &[OverlayTool] = &[
    OverlayTool {
        process: "RTSS.exe",
        label: "RivaTuner Statistics Server (RTSS)",
        note: "Draws the on-screen FPS/stats overlay used by MSI Afterburner and many tuning tools.",
    },
    OverlayTool {
        process: "MSIAfterburner.exe",
        label: "MSI Afterburner",
        note: "GPU tuning tool; its on-screen display is drawn through RivaTuner Statistics Server.",
    },
    OverlayTool {
        process: "fraps.exe",
        label: "Fraps",
        note: "Shows an on-screen frame-rate counter while it is running.",
    },
    OverlayTool {
        process: "bdcam.exe",
        label: "Bandicam",
        note: "Screen recorder that shows an on-screen FPS counter while running.",
    },
];

/// Look up a running process image name against the catalog (case-insensitive). Unrecognised → None
/// (never guessed). Pure.
fn match_overlay_tool(process_name: &str) -> Option<&'static OverlayTool> {
    let lname = process_name.to_ascii_lowercase();
    OVERLAY_TOOLS
        .iter()
        .find(|t| t.process.to_ascii_lowercase() == lname)
}

/// One detected overlay-tool finding — advisory only, no action wired.
#[derive(Debug, PartialEq)]
pub(crate) struct OverlayFinding {
    pub label: String,
    /// Always "running" — presence is all we honestly know.
    pub value: String,
    /// Factual note + the overlap advisory. Never a performance claim.
    pub note: String,
}

/// The result of one overlay-tool scan: the findings plus how many processes were seen, so the
/// surface can tell "none of the tools we recognise are running" (honest) apart from "the scan
/// didn't run" (say nothing). Mirrors `services::Inventory`'s coverage honesty.
pub(crate) struct OverlayScan {
    pub findings: Vec<OverlayFinding>,
    pub scanned: usize,
}

/// Build the overlay-tool findings from a list of running process image names. Pure (no enumeration),
/// so the catalog + dedup is fully unit-testable. Findings follow catalog order and are deduped per
/// tool (a tool with several processes is reported once).
pub(crate) fn build_overlay_scan(process_names: &[String]) -> OverlayScan {
    let scanned = process_names.len();
    let mut findings: Vec<OverlayFinding> = Vec::new();
    for tool in OVERLAY_TOOLS {
        // Present if any running process matches this catalog entry (case-insensitive); report once.
        // Driven through the single matching primitive so the lookup has one tested definition.
        let present = process_names.iter().any(|p| match_overlay_tool(p) == Some(tool));
        if !present {
            continue;
        }
        findings.push(OverlayFinding {
            label: tool.label.to_string(),
            value: "running".to_string(),
            note: format!(
                "{} If you see two overlays in-game, this may be why — keep whichever you prefer; \
                 running it alongside Compy's overlay is fine.",
                tool.note
            ),
        });
    }
    OverlayScan { findings, scanned }
}

/// Enumerate running process image names (read-only). Returns the names so the pure builder can do
/// the matching. A failed/empty scan yields an empty list, so the surface degrades gracefully.
fn running_process_names() -> Vec<String> {
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        sysinfo::ProcessesToUpdate::All,
        true,
        sysinfo::ProcessRefreshKind::nothing(),
    );
    sys.processes()
        .values()
        .map(|p| p.name().to_string_lossy().into_owned())
        .collect()
}

/// Collect the live, read-only overlay-tool scan (enumerate processes → match the catalog).
pub(crate) fn collect_overlay_scan() -> OverlayScan {
    build_overlay_scan(&running_process_names())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn match_is_case_insensitive_and_exact() {
        assert_eq!(match_overlay_tool("RTSS.exe").map(|t| t.label), Some("RivaTuner Statistics Server (RTSS)"));
        assert_eq!(match_overlay_tool("rtss.exe").map(|t| t.label), Some("RivaTuner Statistics Server (RTSS)"));
        assert_eq!(match_overlay_tool("MSIAfterburner.exe").map(|t| t.label), Some("MSI Afterburner"));
        // Not a prefix/substring match — only the exact image name.
        assert_eq!(match_overlay_tool("RTSSHooksLoader64.exe"), None);
        assert_eq!(match_overlay_tool("notrtss.exe"), None);
    }

    #[test]
    fn unrecognised_processes_are_never_guessed() {
        // The deliberately-excluded "overlay is a toggle" apps must NOT be flagged — their presence
        // doesn't prove the overlay is on (honesty), so they stay unrecognised here.
        for p in ["steam.exe", "Discord.exe", "nvcontainer.exe", "RadeonSoftware.exe", "obs64.exe", "chrome.exe"] {
            assert!(match_overlay_tool(p).is_none(), "{p} must not be matched as an active overlay");
        }
    }

    #[test]
    fn no_overlay_tools_running_yields_no_findings_but_records_the_scan() {
        let scan = build_overlay_scan(&names(&["explorer.exe", "chrome.exe", "steam.exe"]));
        assert!(scan.findings.is_empty());
        assert_eq!(scan.scanned, 3, "the scan count is recorded so 'none running' can be claimed honestly");
    }

    #[test]
    fn empty_scan_records_zero_so_none_is_not_falsely_claimed() {
        let scan = build_overlay_scan(&[]);
        assert!(scan.findings.is_empty());
        assert_eq!(scan.scanned, 0, "a scan that saw nothing must read as 'didn't run', not 'all clear'");
    }

    #[test]
    fn running_overlay_tool_is_flagged_with_a_factual_advisory() {
        let scan = build_overlay_scan(&names(&["RTSS.exe", "game.exe"]));
        assert_eq!(scan.findings.len(), 1);
        let f = &scan.findings[0];
        assert_eq!(f.label, "RivaTuner Statistics Server (RTSS)");
        assert_eq!(f.value, "running");
        assert!(f.note.contains("FPS/stats overlay"), "factual note: {}", f.note);
        assert!(f.note.to_lowercase().contains("two overlays"), "overlap advisory present: {}", f.note);
    }

    #[test]
    fn each_tool_is_reported_once_even_with_helper_processes() {
        // RTSS + Afterburner both up → two findings (distinct tools), in catalog order, no dupes.
        let scan = build_overlay_scan(&names(&["RTSS.exe", "MSIAfterburner.exe", "RTSS.exe"]));
        let labels: Vec<&str> = scan.findings.iter().map(|f| f.label.as_str()).collect();
        assert_eq!(labels, vec!["RivaTuner Statistics Server (RTSS)", "MSI Afterburner"]);
    }

    #[test]
    fn law_every_catalog_tool_can_fire_with_a_full_factual_finding() {
        // A silent detector is a lie: every curated tool fires on its own process fixture, and every
        // finding carries a non-empty factual note.
        let proc_names: Vec<String> = OVERLAY_TOOLS.iter().map(|t| t.process.to_string()).collect();
        let scan = build_overlay_scan(&proc_names);
        assert_eq!(scan.findings.len(), OVERLAY_TOOLS.len(), "every catalog tool must fire on its own process");
        for f in &scan.findings {
            assert!(!f.note.trim().is_empty(), "{}: empty note — a finding without its receipt", f.label);
        }
    }

    #[test]
    fn law_no_performance_claim_no_alarm_no_close_imperative() {
        // Informational only: never claim a tool hurts FPS/performance, never alarm, never order the
        // user to close anything. (Honest factual descriptions like "FPS counter" are fine.)
        let perf = ["hurts fps", "lowers fps", "slows", "performance hit", "costs you fps", "reduces performance"];
        let alarm = ["danger", "warning!", "critical!", "remove now", "issues found"];
        let imperative = ["you must close", "close it", "turn it off", "uninstall", "disable it now"];
        for t in OVERLAY_TOOLS {
            let copy = format!("{} {}", t.label, t.note).to_lowercase();
            for b in perf {
                assert!(!copy.contains(b), "{}: performance claim '{b}' in: {copy}", t.process);
            }
            for a in alarm {
                assert!(!copy.contains(a), "{}: alarm language '{a}' in: {copy}", t.process);
            }
            for i in imperative {
                assert!(!copy.contains(i), "{}: close-imperative '{i}' in: {copy}", t.process);
            }
            assert!(!t.label.contains('!'), "{}: exclamation in label", t.process);
        }
        // The assembled advisory also stays non-imperative.
        let scan = build_overlay_scan(&[OVERLAY_TOOLS[0].process.to_string()]);
        let note = scan.findings[0].note.to_lowercase();
        for i in imperative {
            assert!(!note.contains(i), "advisory carries close-imperative '{i}': {note}");
        }
    }
}
