use std::path::PathBuf;

mod actions;
mod amd_freesync; // AMD FreeSync (VRR) on/off read via hand-written ADLX display FFI.
mod atomic_write; // Whole-file byte replacement for SECONDARY on-disk state (benchmark/comparison/readiness/drift JSON, plus the license token's exact plain-text bytes — the one caller here that is not JSON): a save interrupted part-way leaves the previous complete file rather than a truncated one. NOT power-loss durability, NOT a lock, NOT a transaction — and deliberately NOT used by the Trust Ledger or the signed remote rules, which carry their own rules.
mod blackbox; // Black Box v1 (Paramedic Mode) — READ-ONLY crash/freeze evidence reader (Event Log + last-vitals overlay). Zero causal claims, zero mutation.
mod benchmark; // Measured-efficacy engine — WIRED (Benchmark tab: run/baseline/efficacy). Absolute-score normalization still PLACEHOLDER (delta is the honest signal).
mod benchmark_verdict; // [A] verdict engine (bootstrap CI, Keep/Revert/Inconclusive) — WIRED: powers the trial verdict + scoreboard awards.
mod benchmark_scoreboard; // [B] scoreboard — WIRED (Score card + persisted ledger; Keep-only awards, firewalled). P4 cohort/network still unbuilt.
mod benchmark_trial; // live trial runner — WIRED: calibration + tweak A-B trial (Drop-guarded rollback).
mod capture; // Measurement Platform 2.0 — the capture-backend boundary + per-session CaptureCapabilities (additive, honesty-first; names/versions/bounds the existing ETW-DXGI frame capture, measures & mutates NOTHING new).
mod case_evidence_upload; // Compy Care Tier 3 (Q9b, #252) — explicit per-case evidence upload, STAGE 1 ONLY: the §2 allowlist as a struct, pure producers/redaction, one serializer, pure preview. Built DARK — no command, no HTTP, no endpoint, no consent state; its Stage 1 gate is hard-false and nothing calls through it (named by role, not by symbol: the guard named below reads comments too, #266). Never imports receipts/support_evidence/case_intelligence/remote_rules (contract §4); guarded by src/case-evidence-tier-separation-guard.test.ts.
mod case_intelligence; // Compy Care Tier 1 (Q8, #220) — the signed, pull-only PUBLIC ADVISORY catalog: strict domain types + parser behind a hard-false gate. DOWNLOAD-only, uploads no machine data ever; its own key/schema/origins/cache, separate from remote_rules (Tier 0 privileged policy) and receipts (Tier 2). No mutation, no regex, no causal claim.
mod comparability; // Measurement Platform 2.0 (Task F) — the pure session-comparability gate: composes capture_capabilities + game_state + hw_fingerprint into an honest "how far can these two sessions be compared?" verdict (bands-only ceiling, never assumes unrecorded context matched). Additive metadata; blocks nothing, exposes limits.
mod comparison; // M4 cross-session comparison engine (arm → finalize-delta → honest verdict).
mod game_state; // Measurement Platform 2.0 (Task E) — additive per-session GameStateFingerprint (the honest conditions a session ran under; collects only provable fields, infers nothing).
mod drift; // Drift Watch — notices readiness checks that were good and regressed (outside Compy).
mod stutter; // Stutter Forensics — correlates a session's worst dips with concurrent signals.
mod cpu_temp; // CPU temp via interop with a user-installed monitor (HWiNFO/LHM/OHM) — driver-free.
mod data_root; // #130 — the canonical data-root resolver: detects a container/junction-redirected persistence root instead of trusting the APPDATA *string*, halts on a split rather than guessing, and hands out `MutationRoot` (the capability type every Windows-mutation and receipt-write path now requires) only for a verified canonical root.
mod diagnostics;
mod experiment; // Intelligence Phase 3 — user-started single-variable experiment engine + optimization simulator. ARMED 2026-07-17 (experiment_gate()==true, owner sign-off; orchestrates the existing audited mutation boundary — no new apply/rollback primitive; user-started only, defense-in-depth gate checks retained).
mod export;
mod fps;
#[cfg(test)]
mod fuzz_support; // Test-only deterministic input generator for the property/fuzz suites (persistence parsing + bounded IPC inputs). Never compiled into the shipped binary.
mod game_mode_persist; // Game Mode persistence keeper — option 1(b) mechanism C, DARK behind keep_game_mode_gate().
mod gaming_orchestrator;
mod gaming_session;
mod gpu_profile; // Read-only GPU profile before/after delta core (advisory; NOT the gated apply/rollback). Wired to a command + the GpuProfile surface later.
mod hardware;
mod history;
mod hw_class; // Tier-neutral pure hardware-class helpers (basename token / RAM bucket / GPU vendor token), extracted from receipts.rs per the Q9b Tier 3 contract §4 so Tier 2 and Tier 3 share exact vocabularies WITHOUT a tier import. Imports no tier module; guarded by src/case-evidence-tier-separation-guard.test.ts.
mod incident_observer; // Compy Care Tier 1 (task 9, #222) — the PERSISTED local incident observer: remembers across launches which crashes this machine has already been told about, so one that happened while Compy was closed is surfaced once and never twice. Pure consumer of blackbox.rs; three event triggers and NO cadence, service, scheduled task or network. Writes only its own state file.
mod hwchange; // Hardware-change detection (A5 "Re-Run Setup") — read-only fingerprint diff across launches.
mod intelligence; // Intelligence Phase 1 — READ-ONLY event timeline + deterministic "What changed?" engine (bands-only confidence, zero mutation, zero network).
mod intelligence_patterns; // Intelligence Phase 2 — READ-ONLY cross-session pattern detection over recorded sessions.json (deterministic trend/thermal/memory/driver/mode/fade detectors; bands-only, passive-capped at Medium, zero mutation/network).
mod component_evidence; // Intelligence Phase 4 — READ-ONLY projection of Intelligence Phase 2 patterns onto the hardware component each names (the §4H hardware twin; invents no evidence, inherits each pattern's band, honest-neutral when absent).
mod latency; // Diagnostics WIRED (Latency tab: MSI/timer/CCD/USB/mouse). Stage 1-2 ETW capture + Correlate engine still DARK (unwired).
mod leftovers; // Leftovers v1 — READ-ONLY pre-existing optimizer-rot detection (pure evaluator + on-demand probe; no restore wired).
mod license; // Compy Pro — offline Ed25519 license VERIFY only, DARK (all-zeros placeholder pubkey → always free; private key never in repo). No outbound, no Windows mutation.
mod machine_model; // Shared Machine Model v1 (Roadmap Phase 2, #385) — READ-ONLY composition of the
                   // existing canonical producers into ONE answer to "what machine is this / what recently
                   // changed / what did Compy change / what evidence can we trust". Owns no data, probes
                   // nothing, persists nothing; `compose` is pure over borrowed inputs.
mod monitoring;
mod noise_floor; // P4-noise-store: this game's measured run-to-run noise per game + rig (noise_floors.json), written by Benchmark calibration, read when a Trial concludes. Stale after a driver/Windows/game-build change; never estimated.
mod overlay_tools; // A4 read-only: detect third-party in-game overlay/OSD tools running (advisory, mutates nothing).
mod priorities;
mod race_seam; // Test-only deterministic race seam: holds a read-then-act window open from INSIDE a critical section so #283's lock tests fail on demand instead of once in a thousand runs. Compiled to an empty inline no-op in a release build.
mod readiness;
mod realplay; // P5-realplay: real-play mode's PURE core (which sessions count on each side, the looks, the verdict). No I/O, no lock, no Windows state; experiment.rs applies and restores through the existing audited path.
mod receipts; // Receipts telemetry GROUNDWORK — DARK (gate hard-false; payload logic only, the send path does not exist).
mod recommendations;
mod remote_rules;
mod services; // A4 read-only service inventory — categorised, informational, mutates nothing.
mod sessions;
mod support_evidence; // Local support evidence — bounded, redacted, on-disk-only record of the moments support actually asks about. No outbound path; export is user-initiated and preview-gated.
mod trial_candidates; // P4-candidates: READ-ONLY "worth testing on this PC" filter for the Trial picker (OPTIMIZATION_ENGINE §3.1–3.3) — applies / already set / Compy can do it safely, with one reason per change. Mutates nothing.
mod tray; // Opt-in "minimize to tray" (default OFF — §1 clean-exit unless the user opts in).
use actions::*;
use export::*;
use hardware::*;
use history::*;
use monitoring::*;
use priorities::*;
use readiness::*;
use recommendations::*;
use sessions::*;

/// Entry point for the elevated FPS-capture helper process
/// (`compy.exe --fps-capture`). See fps.rs for the full rationale.
pub fn run_fps_capture() {
    fps::run_capture();
}

/// Entry point for the elevated command helper (`compy.exe --run-elevated <hex> <ticket>`, Wave 0).
/// Decodes the hex-encoded PowerShell command produced by `actions::run_elevated_powershell` and runs
/// it via `quiet_command` (CREATE_NO_WINDOW) — windowless in a release build, so no console flashes.
/// Returns PowerShell's exit code so the parent's `elevation_outcome` attribution is preserved; a
/// bad/missing or non-UTF-8 arg returns non-zero (fail-safe: the parent reports "approved, but the
/// operation failed" — never a false success, and never runs garbage). Does NOT depend on the live
/// catalog.
///
/// Boundary-side second lock (defense-in-depth, 2026-07-15): the hex must byte-match the one-time
/// dispatch ticket minted by `run_elevated_powershell` — the sole dispatch point, where every command
/// has already passed validation — or NOTHING runs (exit 3). A hypothetical future confused-deputy
/// bug handing this entry attacker-influenced hex has no matching ticket and executes zero
/// PowerShell. The ticket is consumed (deleted) before the command runs, so a dispatch executes at
/// most once. See `actions::mint_elevation_ticket` / `consume_elevation_ticket`.
pub fn run_elevated_helper(hex: &str, ticket_path: &str) -> i32 {
    if !actions::consume_elevation_ticket(hex, ticket_path) {
        return 3;
    }
    let Some(bytes) = actions::from_hex(hex) else {
        return 2;
    };
    let Ok(command) = String::from_utf8(bytes) else {
        return 2;
    };
    actions::quiet_command("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", &command])
        .status()
        .map(|s| s.code().unwrap_or(1))
        .unwrap_or(1)
}

use serde::Serialize;
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};
use winreg::RegKey;


/// The app handle, captured at setup — lets background threads (the session recorder) reach Tauri
/// APIs like notifications without an injected handle.
static APP_HANDLE: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();

/// Fire the session-end toast with `body` (`experiment::SessionEndNotice::body`). Only a session
/// that settles a decision or a state change gets here (P7-notify, `experiment::session_end_notice`).
/// A read-only nudge — it never opens or focuses a window; the user opens Compy themselves. No-op
/// until the app handle is set.
pub(crate) fn notify_debrief_ready(body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let Some(app) = APP_HANDLE.get() else {
        return;
    };
    let _ = app.notification().builder().title("Session ended").body(body).show();
}

/// Fire the Care "a game closed unexpectedly" toast (Tier 1 task 9).
///
/// Deliberately promises nothing about clicking it. The registered notification path exposes
/// `show()` and no supported action/click callback that could carry an incident payload, so the copy
/// tells the user to open Compy rather than implying the toast will take them somewhere specific.
/// The persisted Home card in `incident_observer.rs` is the authority; this is only a nudge toward
/// it, and a user with notifications off loses the nudge, never the card.
pub(crate) fn notify_care_incident(headline: &str) {
    use tauri_plugin_notification::NotificationExt;
    let Some(app) = APP_HANDLE.get() else {
        return;
    };
    let _ = app
        .notification()
        .builder()
        .title("Compy noticed something")
        .body(format!("{headline} Open Compy to review the evidence."))
        .show();
}

pub(crate) fn current_power_plan_name() -> Option<String> {
    let output = crate::actions::quiet_command("powercfg")
        .args(["/getactivescheme"])
        .output()
        .ok()?;
    power_plan_name_of(&String::from_utf8_lossy(&output.stdout))
}

/// The plan name inside the parentheses of `powercfg /getactivescheme` — whatever language Windows
/// prints it in. Display only: nothing decides on these words any more (see [`PowerPlanClass`]).
pub(crate) fn power_plan_name_of(stdout: &str) -> Option<String> {
    // Format: "Power Scheme GUID: <guid>  (Plan Name)". The name is the parenthesised text AFTER the
    // GUID token, so a label with its own parentheses before the GUID cannot leak into it (review
    // round 1); a ")" before "(" is no name, never a panic.
    let after = match scheme_guid_of(stdout) {
        Some(guid) => {
            let at = stdout.to_ascii_lowercase().find(&guid)?;
            &stdout[at + guid.len()..]
        }
        None => stdout,
    };
    let start = after.find('(')? + 1;
    let end = after.rfind(')')?;
    (end >= start).then(|| after[start..end].trim().to_string())
}

/// What kind of power plan is active, decided from the scheme GUID rather than the plan's name
/// (CR-localized-reads, 2026-11-04): a zh-CN Windows prints "高性能", not "High performance", and
/// every check that matched the English words read a localized PC as "not performance-oriented".
/// The three plans Windows ships have fixed GUIDs on every locale. A plan with any other GUID (a
/// vendor plan, or the copy `powercfg /duplicatescheme` makes of Ultimate, which gets a NEW GUID) is
/// `Other`, and only there do the English words still decide, as they always did — so an English PC
/// reads exactly as before and a localized one reads its stock plans right. Not fabricated: a
/// localized Ultimate copy stays `Other`, which is today's answer too.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PowerPlanClass {
    Balanced,
    HighPerformance,
    Ultimate,
    /// A GUID Windows does not ship, named by words this build cannot read as a class.
    Other,
}

const SCHEME_BALANCED: &str = "381b4222-f694-41f0-9685-ff5bb260df2e";
const SCHEME_HIGH_PERFORMANCE: &str = "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c";
const SCHEME_ULTIMATE: &str = "e9a42b02-d5df-448d-aa00-03f14749eb61";

impl PowerPlanClass {
    /// Does this plan ship with performance-oriented defaults (parking off, no idle throttling)?
    pub(crate) fn is_performance(self) -> bool {
        matches!(self, PowerPlanClass::HighPerformance | PowerPlanClass::Ultimate)
    }
}

/// The active plan's class and its printed name, from one `powercfg /getactivescheme` read.
pub(crate) fn current_power_plan() -> Option<(PowerPlanClass, String)> {
    let output = crate::actions::quiet_command("powercfg")
        .args(["/getactivescheme"])
        .output()
        .ok()?;
    power_plan_of(&String::from_utf8_lossy(&output.stdout))
}

/// The active plan's GUID (lower-case), printed name and class, from one read-only
/// `powercfg /getactivescheme`. `None` when no GUID can be read: unreadable, never guessed
/// (CR-unconfirmed-remedy records the GUID it saw, so a later Trial can check it is still the one).
pub(crate) fn current_power_scheme() -> Option<history::ObservedPlan> {
    let output = crate::actions::quiet_command("powercfg")
        .args(["/getactivescheme"])
        .output()
        .ok()?;
    power_scheme_of(&String::from_utf8_lossy(&output.stdout))
}

/// Pure: [`current_power_scheme`] from the command's output.
pub(crate) fn power_scheme_of(stdout: &str) -> Option<history::ObservedPlan> {
    let guid = scheme_guid_of(stdout)?;
    let (class, name) = power_plan_of(stdout)?;
    Some(history::ObservedPlan { guid, name, class })
}

/// Pure: the class (by GUID, then by the English words for a non-stock GUID) and the printed name.
/// `None` when the output holds no 36-character GUID — an unreadable plan, never a guessed one.
pub(crate) fn power_plan_of(stdout: &str) -> Option<(PowerPlanClass, String)> {
    let guid = scheme_guid_of(stdout)?;
    let name = power_plan_name_of(stdout).unwrap_or_default();
    let class = match guid.as_str() {
        SCHEME_BALANCED => PowerPlanClass::Balanced,
        SCHEME_HIGH_PERFORMANCE => PowerPlanClass::HighPerformance,
        SCHEME_ULTIMATE => PowerPlanClass::Ultimate,
        _ => {
            let lower = name.to_lowercase();
            if lower.contains("ultimate") {
                PowerPlanClass::Ultimate
            } else if lower.contains("high performance") {
                PowerPlanClass::HighPerformance
            } else {
                PowerPlanClass::Other
            }
        }
    };
    Some((class, name))
}

/// The first 36-character `8-4-4-4-12` hex GUID in a `powercfg` output, lower-cased. The label before
/// it ("Power Scheme GUID:", "电源方案 GUID:") is not read, so the locale cannot hide it.
pub(crate) fn scheme_guid_of(stdout: &str) -> Option<String> {
    stdout
        .split(|c: char| c.is_whitespace() || matches!(c, '(' | ')' | ':' | '：' | '{' | '}'))
        .find(|tok| {
            tok.len() == 36
                && tok.bytes().enumerate().all(|(i, b)| match i {
                    8 | 13 | 18 | 23 => b == b'-',
                    _ => b.is_ascii_hexdigit(),
                })
        })
        .map(|g| g.to_ascii_lowercase())
}

pub(crate) fn game_mode_enabled() -> bool {
    // Game Mode is "on" only when BOTH halves of the pair are 1 — the exact state the Settings
    // toggle and apply_game_mode produce. Reading only AutoGameModeEnabled (as before) reported
    // ON for a state Windows then reset on reboot, which re-offered the rec and bloated the
    // ledger. Shared constants keep this read locked to what actions::apply_game_mode writes.
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) = hkcu.open_subkey(crate::actions::GAMEBAR_KEY) else {
        return false;
    };
    let on = |name| key.get_value::<u32, _>(name).map(|v| v == 1).unwrap_or(false);
    on(crate::actions::GAME_MODE_ENABLED_VALUE) && on(crate::actions::GAME_MODE_ALLOW_VALUE)
}

/// Whether a service is running, `None` when `sc` produced nothing it can be read from — the spawn
/// failed, or the output carries neither a STATE line nor the "service does not exist" code. The
/// infallible reader that folded that into "not running" read a disable-a-service change as "still
/// in effect" when nothing was read at all (#392); its last callers (three catalog recs) moved here
/// in the 2026-11-02 codebase review, and it is gone.
pub(crate) fn service_running_checked(name: &str) -> Option<bool> {
    let output = crate::actions::quiet_command("sc")
        .args(["query", name])
        .output()
        .ok()?;
    parse_sc_query(&String::from_utf8_lossy(&output.stdout))
}

/// Pure half of `service_running_checked`. `FAILED 1060` is "the service does not exist", which is
/// a real answer (it is not running), not a failed read.
fn parse_sc_query(stdout: &str) -> Option<bool> {
    if stdout.contains("STATE") {
        Some(stdout.contains("RUNNING"))
    } else if stdout.contains("FAILED 1060") {
        Some(false)
    } else {
        None
    }
}

pub(crate) fn visual_effects_for_best_performance() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\VisualEffects")
        .and_then(|k| k.get_value::<u32, _>("VisualFXSetting"))
        .map(|v| v == 2)
        .unwrap_or(false)
}

// Memory Integrity (HVCI / hypervisor-enforced code integrity) is the
// gaming-relevant VBS scenario. Reading both the HVCI subkey and the parent
// VBS toggle covers the common configurations: some systems have VBS off but
// HVCI on, some have VBS on without HVCI explicitly toggled. We report
// "active" if either flag indicates protection is engaged, because the FPS
// cost path applies in both cases. The Diagnostics row reads `memory_integrity_or_vbs_configured`
// instead (absent ≠ off, policy keys too), so the two can differ by design.
pub(crate) fn memory_integrity_or_vbs_active() -> bool {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let hvci_on = hklm
        .open_subkey(
            "SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity",
        )
        .and_then(|k| k.get_value::<u32, _>("Enabled"))
        .map(|v| v == 1)
        .unwrap_or(false);
    let vbs_on = hklm
        .open_subkey("SYSTEM\\CurrentControlSet\\Control\\DeviceGuard")
        .and_then(|k| k.get_value::<u32, _>("EnableVirtualizationBasedSecurity"))
        .map(|v| v == 1)
        .unwrap_or(false);
    hvci_on || vbs_on
}

/// Tri-state read of the same switches for the Diagnostics row only (CR-vbs-row-truth): `None`
/// when none of them is written, which is how a default- or policy-enabled VBS often looks, so
/// absent is never shown as a definite "off". Also reads the Group Policy keys. Read-only; the
/// rec engine keeps `memory_integrity_or_vbs_active` unchanged.
pub(crate) fn memory_integrity_or_vbs_configured() -> Option<bool> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let read = |path: &str, name: &str| -> Option<u32> {
        hklm.open_subkey(path).and_then(|k| k.get_value::<u32, _>(name)).ok()
    };
    let policy = [
        read(
            "SOFTWARE\\Policies\\Microsoft\\Windows\\DeviceGuard",
            "EnableVirtualizationBasedSecurity",
        ),
        // Policy HVCI: 1 = on with UEFI lock, 2 = on without lock, 0 = off.
        read(
            "SOFTWARE\\Policies\\Microsoft\\Windows\\DeviceGuard",
            "HypervisorEnforcedCodeIntegrity",
        ),
    ];
    let local = [
        read(
            "SYSTEM\\CurrentControlSet\\Control\\DeviceGuard\\Scenarios\\HypervisorEnforcedCodeIntegrity",
            "Enabled",
        ),
        read(
            "SYSTEM\\CurrentControlSet\\Control\\DeviceGuard",
            "EnableVirtualizationBasedSecurity",
        ),
    ];
    vbs_configured_from(&policy, &local)
}

/// A written Group Policy value wins over the local keys (policy overrides them); with no policy
/// written, the local keys decide.
pub(crate) fn vbs_configured_from(policy: &[Option<u32>], local: &[Option<u32>]) -> Option<bool> {
    if policy.iter().any(Option::is_some) {
        combine_vbs_switches(policy)
    } else {
        combine_vbs_switches(local)
    }
}

/// Pure half of `memory_integrity_or_vbs_configured`: any written switch that is non-zero = on;
/// otherwise any written switch = off; nothing written = `None`.
pub(crate) fn combine_vbs_switches(values: &[Option<u32>]) -> Option<bool> {
    if values.iter().any(|v| matches!(v, Some(n) if *n != 0)) {
        Some(true)
    } else if values.iter().any(|v| v.is_some()) {
        Some(false)
    } else {
        None
    }
}

pub(crate) fn reserved_storage_enabled() -> bool {
    // Win10/11 stashes the reserved-storage configuration here. BaseHardReserveSize
    // is the byte count currently set aside; > 0 = reserved storage is active.
    // Infallible (any error => false) — for READ-ONLY/advisory callers (Check, recs,
    // diagnostics) where a guessed-off is harmless. The MUTATING apply path must use
    // `reserved_storage_enabled_checked` so a read failure can't fabricate a snapshot.
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey("Software\\Microsoft\\ReserveManager")
        .and_then(|k| k.get_value::<u32, _>("BaseHardReserveSize"))
        .map(|v| v > 0)
        .unwrap_or(false)
}

/// Like `reserved_storage_enabled` but distinguishes a genuinely-absent key/value
/// (`Ok(false)` — a faithful "off" prior) from an UNREADABLE one (`Err` — the apply
/// refuses rather than snapshotting a guess). Used only by the mutating apply path so a
/// transient/ACL read failure can't fabricate `prior_enabled=false` and have rollback
/// leave a default-ON feature disabled. Mirrors `read_priority_separation_prior`.
pub(crate) fn reserved_storage_enabled_checked() -> Result<bool, String> {
    use std::io::ErrorKind;
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    match hklm.open_subkey("Software\\Microsoft\\ReserveManager") {
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(false), // key absent = off (true prior)
        Err(e) => Err(format!("cannot snapshot reserved-storage state: {e}")),
        Ok(k) => match k.get_value::<u32, _>("BaseHardReserveSize") {
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(false), // value absent = off
            Err(e) => Err(format!("cannot read BaseHardReserveSize to snapshot: {e}")),
            Ok(v) => Ok(v > 0),
        },
    }
}

pub(crate) fn fast_startup_state() -> Option<u32> {
    // Infallible (open/read failure and genuine absence both => None) — for READ-ONLY
    // detection callers. The MUTATING apply path uses `fast_startup_state_checked`.
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power")
        .and_then(|k| k.get_value::<u32, _>("HiberbootEnabled"))
        .ok()
}

/// Like `fast_startup_state` but distinguishes a genuinely-absent value (`Ok(None)` — a
/// faithful prior; rollback deletes it, which Windows treats as the default) from an
/// UNREADABLE key (`Err` — the apply refuses rather than snapshotting a guess). Used only by
/// the mutating apply path. Mirrors `read_priority_separation_prior`.
pub(crate) fn fast_startup_state_checked() -> Result<Option<u32>, String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    match hklm.open_subkey("SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Power") {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot snapshot Fast Startup state: {e}")),
        Ok(k) => Ok(k.get_value::<u32, _>("HiberbootEnabled").ok()),
    }
}

#[cfg(test)]
mod checked_prior_reader_tests {
    use super::*;

    // The mutating apply path reads its rollback priors through these checked variants. On a healthy
    // rig they must AGREE with the infallible detection readers (regression guard against a broken
    // key path), reserving Err only for a genuine read failure — the fail-safe refuse the apply
    // relies on so a read failure can't fabricate a snapshot.
    #[test]
    fn fast_startup_checked_reads_ok_and_matches_infallible() {
        // Session Manager\Power is a standard key on every Windows install — must read Ok.
        let checked = fast_startup_state_checked().expect("standard Power key must read Ok");
        assert_eq!(checked, fast_startup_state());
    }

    #[test]
    fn reserved_storage_checked_matches_infallible_when_readable() {
        // ReserveManager may be absent (Ok(false)) or present; whenever it reads, the checked and
        // infallible variants must report the same state.
        if let Ok(v) = reserved_storage_enabled_checked() {
            assert_eq!(v, reserved_storage_enabled());
        }
    }

    #[test]
    fn sc_query_parse_separates_a_failed_read_from_a_stopped_or_missing_service() {
        assert_eq!(parse_sc_query("SERVICE_NAME: SysMain\r\n        STATE              : 4  RUNNING\r\n"), Some(true));
        assert_eq!(parse_sc_query("SERVICE_NAME: SysMain\r\n        STATE              : 1  STOPPED\r\n"), Some(false));
        assert_eq!(parse_sc_query("[SC] EnumQueryServicesStatus:OpenService FAILED 1060:\r\n"), Some(false));
        // Access denied, an empty pipe, anything unrecognised: nothing was read, so no answer.
        assert_eq!(parse_sc_query("[SC] OpenSCManager FAILED 5:\r\n\r\nAccess is denied.\r\n"), None);
        assert_eq!(parse_sc_query(""), None);
    }

    #[test]
    fn hags_checked_reads_ok_and_matches_infallible() {
        // GraphicsDrivers is a standard key on every Windows install — must read Ok.
        let checked = hags_state_checked().expect("standard GraphicsDrivers key must read Ok");
        assert_eq!(checked, hags_state());
    }
}

pub(crate) fn game_bar_disabled() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let capture: Option<u32> = hkcu
        .open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR")
        .and_then(|k| k.get_value("AppCaptureEnabled"))
        .ok();
    let dvr: Option<u32> = hkcu
        .open_subkey("System\\GameConfigStore")
        .and_then(|k| k.get_value("GameDVR_Enabled"))
        .ok();
    capture == Some(0) && dvr == Some(0)
}

pub(crate) fn hags_state() -> Option<u32> {
    // Infallible (open/read failure and genuine absence both => None) — for READ-ONLY
    // detection callers. The MUTATING apply path uses `hags_state_checked`.
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    hklm.open_subkey("SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers")
        .and_then(|k| k.get_value::<u32, _>("HwSchMode"))
        .ok()
}

/// Like `hags_state` but distinguishes a genuinely-absent value (`Ok(None)` — a faithful
/// prior; rollback deletes it) from an UNREADABLE key (`Err` — the apply refuses rather than
/// snapshotting a guess). Used only by the mutating apply path so a key-open failure can't
/// fabricate `None` and have rollback DELETE a user's explicit HwSchMode. Mirrors
/// `read_priority_separation_prior` / `fast_startup_state_checked`.
pub(crate) fn hags_state_checked() -> Result<Option<u32>, String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    match hklm.open_subkey("SYSTEM\\CurrentControlSet\\Control\\GraphicsDrivers") {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot snapshot HAGS (HwSchMode) state: {e}")),
        Ok(k) => Ok(k.get_value::<u32, _>("HwSchMode").ok()),
    }
}

// ─── Core parking POLICY (detection-layer Probe #10, partial — config not live state) ─────────
// CPMINCORES = the minimum % of cores Windows must keep UNPARKED. 100 = no parking (all cores stay
// ready, the common gaming-plan state); lower = more aggressive parking allowed. We read the POLICY
// via powercfg — the instantaneous "which cores are parked right now" is kernel-only (dropped, same
// class as CPU temp). Unreadable → None / "Unknown", never guessed.
pub(crate) fn core_parking_min_cores_ac() -> Option<u32> {
    let output = crate::actions::quiet_command("powercfg")
        .args([
            "/q",
            "SCHEME_CURRENT",
            "SUB_PROCESSOR",
            "0cc5b647-c1df-4637-891a-dec35c318583", // CPMINCORES
        ])
        .output()
        .ok()?;
    parse_powercfg_ac_index(&String::from_utf8_lossy(&output.stdout))
}

/// The AC value of a single-setting `powercfg /q <scheme> <subgroup> <setting>` read, as a number.
/// The English label ("Current AC Power Setting Index") is taken when it is there; otherwise the
/// shape of the output decides (CR-localized-reads, 2026-11-04): a single-setting query prints the
/// setting's possible values and then exactly two "current index" lines, AC first and DC second, each
/// ending in a `0x` hex number — so the second-to-last `0x` line after the setting's own GUID line is
/// the AC index whatever language the labels are in (the possible-value lines before them may carry
/// `0x` numbers too). A multi-setting dump (no single setting asked for) is not read that way. `None` when neither
/// route finds a number: unreadable, never guessed.
pub(crate) fn parse_powercfg_ac_index(output: &str) -> Option<u32> {
    // The number is the line's LAST whitespace-separated token. Not a split on the colon: powercfg
    // writes the OEM code page, this reads it as UTF-8 lossily, so a localized label and its
    // fullwidth colon can arrive as replacement characters — only the ASCII `0x…` survives for sure.
    let hex_of = |line: &str| -> Option<u32> {
        let raw = line.split_whitespace().last()?;
        // The token may carry a glued label ("索引：0x00000032"): the number starts at its last `0x`.
        let at = raw.rfind("0x").or_else(|| raw.rfind("0X"))?;
        let hex = &raw[at + 2..];
        (!hex.is_empty() && hex.bytes().all(|b| b.is_ascii_hexdigit()))
            .then(|| u32::from_str_radix(hex, 16).ok())
            .flatten()
    };
    if let Some(line) = output.lines().find(|l| l.contains("Current AC Power Setting Index")) {
        return hex_of(line);
    }
    // Locale-neutral route: after the setting's own GUID line (scheme, subgroup, setting: the third
    // GUID), the output ends with the two "current index" lines, AC then DC; the possible-value lines
    // before them (minimum, maximum, increment) may carry `0x` numbers too, so the AC index is the
    // second-to-last `0x` line, not the first.
    // Exactly three GUID lines (scheme, subgroup, ONE setting): a multi-setting dump has more and is
    // refused, since its last two `0x` lines belong to whichever setting came last. After the setting
    // line a numeric setting prints minimum, maximum and increment, then AC and DC: five `0x` lines,
    // and the AC value must sit inside [minimum, maximum] — a run that lost its DC line would
    // otherwise hand back the increment as the index (review round 1). Anything else is None.
    let lines: Vec<&str> = output.lines().collect();
    let guid_lines: Vec<usize> = lines.iter().enumerate().filter(|(_, l)| scheme_guid_of(l).is_some()).map(|(i, _)| i).collect();
    if guid_lines.len() != 3 {
        return None;
    }
    let hex_lines: Vec<u32> = lines[guid_lines[2] + 1..].iter().filter_map(|l| hex_of(l.trim())).collect();
    if hex_lines.len() < 5 {
        return None;
    }
    let (min, max, ac) = (hex_lines[0], hex_lines[1], hex_lines[hex_lines.len() - 2]);
    (min <= ac && ac <= max).then_some(ac)
}

/// Plain-English core-parking policy from CPMINCORES%. Never describes live per-core state.
pub(crate) fn core_parking_label(min_cores_pct: Option<u32>) -> String {
    match min_cores_pct {
        Some(100) => "All cores kept active (no parking)".into(),
        Some(p) => format!("Core parking allowed (min {p}% cores active)"),
        None => "Unknown".into(),
    }
}

#[cfg(test)]
mod core_parking_tests {
    use super::{core_parking_label, parse_powercfg_ac_index};

    #[test]
    fn parses_cpmincores_ac_index_hex() {
        // Real powercfg /q shape; AMD dev rig CPMINCORES AC = 0x64 = 100 (no parking).
        let out = "  GUID Alias: CPMINCORES\r\n    Current AC Power Setting Index: 0x00000064\r\n    Current DC Power Setting Index: 0x00000064\r\n";
        assert_eq!(parse_powercfg_ac_index(out), Some(100));
        assert_eq!(parse_powercfg_ac_index("Current AC Power Setting Index: 0x00000032"), Some(50));
        assert_eq!(parse_powercfg_ac_index("no index line"), None);
        assert_eq!(parse_powercfg_ac_index("Current AC Power Setting Index: nothex"), None);
    }

    // CR-localized-reads (2026-11-04): the same single-setting read with every label in another
    // language. The fixture keeps powercfg's SHAPE (three GUID lines, the possible-value lines, then
    // AC and DC) with the labels replaced by words this parser must not need; it is not captured
    // zh-CN output, which the repo does not hold, so the claim is "no English word decides", not
    // "zh-CN wording verified".
    #[test]
    fn reads_the_ac_index_without_any_english_label() {
        let lines = [
            "电源方案 GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (平衡)",
            "  子组 GUID: 54533251-82be-4824-96c1-47b60b740d00  (处理器电源管理)",
            "    电源设置 GUID: 0cc5b647-c1df-4637-891a-dec35c318583  (处理器性能内核停放最小内核数)",
            "      最小可能设置: 0x00000000",
            "      最大可能设置: 0x00000064",
            "      可能的设置增量: 0x00000001",
            "      可能的设置单位: %",
            "    当前交流电源设置索引: 0x00000032",
            "    当前直流电源设置索引: 0x00000014",
        ];
        let join = |ls: &[&str]| ls.iter().map(|l| format!("{l}\r\n")).collect::<String>();
        let out = join(&lines);
        assert_eq!(parse_powercfg_ac_index(&out), Some(50), "AC is the second-to-last 0x line, not the minimum");
        // A label glued to the number with a fullwidth colon, or decoded lossily: the last token still reads.
        assert_eq!(parse_powercfg_ac_index(&out.replace("索引: 0x00000032", "索引：0x00000032")), Some(50));
        assert_eq!(parse_powercfg_ac_index(&out.replace("当前交流电源设置索引:", "\u{FFFD}\u{FFFD}\u{FFFD}")), Some(50));
        // Review round 1: a run that lost its DC line must not hand back the increment as the index.
        assert_eq!(parse_powercfg_ac_index(&join(&lines[..8])), None, "four 0x lines: not a complete single-setting read");
        // A multi-setting dump (two settings under the subgroup) is refused, never read off the last setting.
        let second = [
            "    电源设置 GUID: 5d76a2ca-e8c0-402f-a133-2158492d58ad  (另一项)",
            "      最小可能设置: 0x00000000",
            "      最大可能设置: 0x00000001",
            "      可能的设置增量: 0x00000001",
            "    当前交流电源设置索引: 0x00000001",
            "    当前直流电源设置索引: 0x00000001",
        ];
        assert_eq!(parse_powercfg_ac_index(&format!("{out}{}", join(&second))), None);
        // An AC value outside [minimum, maximum] cannot be the index: None, never a guess.
        assert_eq!(parse_powercfg_ac_index(&out.replace("0x00000032", "0x000000c8")), None);
        // Fewer than five 0x lines after the setting: unreadable, never a possible-value line.
        assert_eq!(parse_powercfg_ac_index(&join(&lines[..4])), None);
    }

    #[test]
    fn the_plan_class_comes_from_the_scheme_guid_and_only_a_non_stock_guid_reads_the_words() {
        use super::{power_plan_name_of, power_plan_of, scheme_guid_of, PowerPlanClass};
        let en = "Power Scheme GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (High performance)\r\n";
        assert_eq!(power_plan_of(en), Some((PowerPlanClass::HighPerformance, "High performance".into())));
        // The same stock plan with its label and name in another language (labels illustrative, not
        // captured output): the GUID decides, the words do not.
        let zh = "电源方案 GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (高性能)\r\n";
        assert_eq!(power_plan_of(zh).map(|p| p.0), Some(PowerPlanClass::HighPerformance));
        assert_eq!(power_plan_of("x GUID: 381B4222-F694-41F0-9685-FF5BB260DF2E  (Balanced)").map(|p| p.0), Some(PowerPlanClass::Balanced), "case-insensitive");
        assert_eq!(power_plan_of("x GUID: e9a42b02-d5df-448d-aa00-03f14749eb61  (Ultimate Performance)").map(|p| p.0), Some(PowerPlanClass::Ultimate));
        // A duplicated Ultimate (new GUID) or a vendor plan: the words decide, as they always did.
        let copy = "Power Scheme GUID: 12345678-1234-1234-1234-123456789abc  (Ultimate Performance)";
        assert_eq!(power_plan_of(copy).map(|p| p.0), Some(PowerPlanClass::Ultimate));
        let ryzen = "Power Scheme GUID: 12345678-1234-1234-1234-123456789abc  (AMD Ryzen Balanced)";
        assert_eq!(power_plan_of(ryzen), Some((PowerPlanClass::Other, "AMD Ryzen Balanced".into())));
        let zh_copy = "电源方案 GUID: 12345678-1234-1234-1234-123456789abc  (卓越性能)";
        assert_eq!(power_plan_of(zh_copy).map(|p| p.0), Some(PowerPlanClass::Other), "a localized copy stays Other: not guessed");
        assert_eq!(power_plan_of("nothing here"), None);
        assert_eq!(scheme_guid_of("GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635cXX"), None, "a 36-char token, exactly");
        // A label glued to the GUID (no space after the colon, ASCII or fullwidth) still yields it.
        assert_eq!(scheme_guid_of("GUID:8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c (x)").as_deref(), Some("8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"));
        assert_eq!(scheme_guid_of("方案 GUID：8C5E7FDA-E8BF-4A96-9A85-A6E23A8C635C").as_deref(), Some("8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c"));
        // A name with its own parentheses, and a ")" before "(": the name is what follows the GUID; no panic.
        assert_eq!(power_plan_name_of("Power Scheme (active) GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (High performance)").as_deref(), Some("High performance"));
        assert_eq!(power_plan_name_of(") stray ("), None);
    }

    #[test]
    fn label_is_honest_about_policy() {
        assert_eq!(core_parking_label(Some(100)), "All cores kept active (no parking)");
        assert_eq!(core_parking_label(Some(50)), "Core parking allowed (min 50% cores active)");
        assert_eq!(core_parking_label(None), "Unknown");
    }
}

pub(crate) fn mouse_accel_disabled() -> bool {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(key) = hkcu.open_subkey("Control Panel\\Mouse") else {
        return false;
    };
    let speed: String = key.get_value("MouseSpeed").unwrap_or_default();
    // MouseSpeed = 0 means acceleration off; 1 or 2 means on.
    speed == "0"
}

pub(crate) fn nagle_disabled_on_any_nic() -> bool {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let Ok(interfaces) =
        hklm.open_subkey("SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces")
    else {
        return false;
    };
    for adapter_name in interfaces.enum_keys().filter_map(|r| r.ok()) {
        let Ok(adapter) = interfaces.open_subkey(&adapter_name) else {
            continue;
        };
        if adapter.get_value::<u32, _>("TcpAckFrequency").ok() == Some(1)
            && adapter.get_value::<u32, _>("TCPNoDelay").ok() == Some(1)
        {
            return true;
        }
    }
    false
}





// ── §C build provenance stamp (spec 2026-06-12, receipts-for-builds) ───────────────────────────
// Baked at COMPILE time by build.rs (env!) — the running binary never invokes git. Format:
// "ab12cd3 · dev" / "ab12cd3+dirty · release". Surfaces: Settings → About + the dev window title.

/// Pure formatter — split from the env!-reading wrapper so the format is testable.
fn format_build_stamp(hash: &str, dirty: bool, debug: bool) -> String {
    format!(
        "{hash}{} · {}",
        if dirty { "+dirty" } else { "" },
        if debug { "dev" } else { "release" },
    )
}

pub(crate) fn build_stamp() -> String {
    format_build_stamp(
        env!("COMPY_GIT_HASH"),
        env!("COMPY_GIT_DIRTY") == "1",
        cfg!(debug_assertions),
    )
}

/// Read-only state probe: which exact build is this? (Review hygiene — stamp mismatch = wrong
/// window; tester reports gain ground truth.)
#[tauri::command]
fn get_build_stamp() -> String {
    build_stamp()
}

/// The directory Compy READS from. It is **not** authorization to write a receipt or change
/// Windows — that is `data_root::mutation_root()`, and only a verified-canonical root yields one.
///
/// Was: `APPDATA` joined with `Compy`, silently falling back to `C:\Temp`. That is the #130 defect.
/// Under an MSIX-packaged host the `APPDATA` string is *correct* and the resolution is redirected,
/// so Compy changed the real machine and filed the receipt into a sandbox no normal launch can see.
/// See `data_root` for the mechanism and the guards.
pub(crate) fn compy_data_dir() -> PathBuf {
    let decision = data_root::decision();
    // GUARD 1 (design doc §Guards): the legacy Sentinel→Compy migration runs ONLY against a verified
    // canonical root. It is a recursive COPY of the whole pre-rename data dir — run against a
    // redirected root it would duplicate the entire Trust Ledger into somebody else's sandbox,
    // turning one split root into two equally plausible-looking histories.
    if let data_root::DataRootDecision::Canonical { root } = decision {
        if let Some(app_data) = root.parent() {
            migrate_legacy_data_once(app_data, root);
        }
    }
    decision.effective_root()
}

// One-time, COPY-not-move migration of the pre-rename data dir (`%APPDATA%\Sentinel`) into the new
// `%APPDATA%\Compy` on first run, so rollback history / sessions / exports / scoreboard survive the
// Sentinel→Compy rename. We COPY (never move or delete) — the original `Sentinel` dir is left intact
// as a safety net. Best-effort: any failure just means a fresh start, with the old data still
// recoverable by hand. Runs once per process via the OnceLock guard; later calls are a no-op.
//
// NOTE: the legacy literal MUST stay "Sentinel" (the old brand) — it's the source we copy FROM. Do
// not let a future brand-rename sweep touch it.
fn migrate_legacy_data_once(app_data: &std::path::Path, new_dir: &std::path::Path) {
    static DONE: std::sync::OnceLock<()> = std::sync::OnceLock::new();
    DONE.get_or_init(|| {
        let legacy = app_data.join("Sentinel");
        // Migrate only when the new dir doesn't exist yet AND the legacy one does.
        if new_dir.exists() || !legacy.exists() {
            return;
        }
        // Atomic: copy into a staging dir, then rename into place. A mid-copy failure leaves NO
        // partial `Compy` dir, so the next launch cleanly retries instead of silently keeping a
        // half-migrated (partial Trust Ledger) directory. Rename is atomic on the same volume.
        let staging = app_data.join("Compy.migrating");
        let _ = std::fs::remove_dir_all(&staging); // clear any leftover from a prior aborted run
        match copy_dir_recursive(&legacy, &staging) {
            Ok(()) => {
                let _ = std::fs::rename(&staging, new_dir);
            }
            Err(_) => {
                let _ = std::fs::remove_dir_all(&staging);
            }
        }
    });
}

fn copy_dir_recursive(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dst = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&src, &dst)?;
        } else {
            std::fs::copy(&src, &dst)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod migration_tests {
    use super::*;

    // The data-dir migration's core: copy_dir_recursive must copy a nested tree (incl. exports/)
    // AND leave the source intact (copy-not-move), so a Compy rename never orphans the rollback
    // ledger. (migrate_legacy_data_once itself is OnceLock-guarded → process-global, so we exercise
    // its copy primitive directly.)
    #[test]
    fn copy_dir_recursive_copies_nested_tree_and_preserves_source() {
        let base = std::env::temp_dir().join(format!("compy_migtest_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let src = base.join("Sentinel");
        let dst = base.join("Compy");
        std::fs::create_dir_all(src.join("exports")).unwrap();
        std::fs::write(src.join("history.json"), b"{\"ledger\":true}").unwrap();
        std::fs::write(src.join("exports").join("r.md"), b"# report").unwrap();

        copy_dir_recursive(&src, &dst).unwrap();

        // Destination has the full tree…
        assert_eq!(std::fs::read(dst.join("history.json")).unwrap(), b"{\"ledger\":true}");
        assert_eq!(std::fs::read(dst.join("exports").join("r.md")).unwrap(), b"# report");
        // …and the source is untouched (copy, never move).
        assert!(src.join("history.json").exists());
        assert!(src.join("exports").join("r.md").exists());

        let _ = std::fs::remove_dir_all(&base);
    }
}

// ─── Gaming Mode (F1) — GATED ────────────────────────────────────────────
// Mutation feature. FLIPPED ON 2026-06-18 with explicit owner sign-off, for the live reboot QA
// (the §7 restore-contract harness passed 6/6 on the dev rig first: exact-restore, crash/orphan
// recovery, no-partial-on-cancel-at-start, RestoreFailed-on-cancel-during-restore, fail-loud-missing-
// plan, restore-targets-stored-GUID-on-external-change). While true the 5 commands work and the
// frontend shows the Gaming surface. FULLY REVERSIBLE: set back to `false` to re-hide everything.
// Implemented as a fn (not a const) so the guarded orchestrator calls stay reachable / warning-free
// either way. Spec: docs/superpowers/specs/2026-06-02-gaming-mode-f1-design.md §7.
fn gaming_mode_gate() -> bool {
    true
}

#[tauri::command]
fn gaming_mode_enabled() -> bool {
    gaming_mode_gate()
}

// A package install may terminate Compy. Hold this process-local barrier from the user's Update
// click through relaunch so Gaming Mode cannot start in the download/install window after the
// contract check. Poisoning fails closed rather than weakening the rollback law.
static UPDATE_RESTART_BARRIER: std::sync::Mutex<bool> = std::sync::Mutex::new(false);

/// CR-1102-left owner call (delegated 2026-11-10): the update stays refused while any Gaming Mode
/// contract file is on disk, and the refusal names each file and its folder, so a leftover temp file
/// is something the user can see rather than an unexplained block. The opening sentence is unchanged.
fn update_refusal_words(found: &[String], dir: &std::path::Path) -> String {
    format!(
        "Finish Gaming Mode or recover its pending changes before updating Compy. Compy found {} in {}.",
        found.join(", "),
        dir.display()
    )
}

/// The update/restart contract check, in words: `Some(refusal)` while any contract file is on disk,
/// `None` when the folder holds none, `Err` when it can't be read (fail closed, as before).
fn update_refusal() -> Result<Option<String>, String> {
    let found = gaming_session::pending_contract_files()?;
    Ok((!found.is_empty()).then(|| update_refusal_words(&found, &gaming_session::session_data_dir())))
}

#[cfg(test)]
mod update_refusal_tests {
    #[test]
    fn a_leftover_temp_file_still_refuses_and_the_refusal_names_it_and_its_folder() {
        // Review SHOULD-FIX: the check's own words, wired to what it found (no support log written).
        let dir = std::env::temp_dir().join(format!("compy-update-refusal-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let _redirect = crate::gaming_session::SessionDirOverride::begin(&dir);
        assert_eq!(super::update_refusal().unwrap(), None);
        std::fs::write(dir.join("gaming-session.json.tmp"), "x").unwrap();
        let words = super::update_refusal().unwrap().expect("a leftover temp file still holds the update");
        assert!(words.contains("gaming-session.json.tmp"), "{words}");
        assert!(words.contains(&dir.display().to_string()), "{words}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_refusal_keeps_its_first_sentence_and_names_each_file_and_its_folder() {
        let dir = std::path::Path::new(r"C:\Users\x\AppData\Roaming\Compy");
        let words = super::update_refusal_words(&["gaming-session.json.tmp".into()], dir);
        assert!(words.starts_with("Finish Gaming Mode or recover its pending changes before updating Compy."), "{words}");
        assert!(words.contains("gaming-session.json.tmp"), "{words}");
        assert!(words.contains(r"C:\Users\x\AppData\Roaming\Compy"), "{words}");
    }
}

#[tauri::command]
fn begin_update_restart() -> Result<(), String> {
    // Support evidence (spec §12): "I clicked Update and it just refused" is a report support
    // cannot resolve from the UI alone, because the refusal is CORRECT — a pending Gaming Mode
    // contract means a real machine change has no completed rollback yet, and an update that
    // restarts the process would strand it. Recording it as REFUSED (not Failed) is the honest
    // reading: nothing is broken, the barrier did its job, and the fix is to finish or recover
    // the session. The poisoned-lock arm is the genuinely broken one.
    let mut barrier = match UPDATE_RESTART_BARRIER.lock() {
        Ok(b) => b,
        Err(_) => {
            support_evidence::record(
                support_evidence::EventKind::Lifecycle,
                "update_restart",
                "barrier_unavailable",
                support_evidence::Outcome::Failed,
                "the update safety barrier could not be read, so the update was refused",
            );
            return Err("Update safety barrier is unavailable; restart/update refused.".into());
        }
    };
    if let Some(words) = update_refusal()? {
        support_evidence::record(
            support_evidence::EventKind::Lifecycle,
            "update_restart",
            "pending_contract",
            support_evidence::Outcome::Refused,
            "a Gaming Mode session still has changes to restore, so the update was held back",
        );
        return Err(words);
    }
    *barrier = true;
    support_evidence::record(
        support_evidence::EventKind::Lifecycle,
        "update_restart",
        "armed",
        support_evidence::Outcome::Ok,
        "the update was allowed to proceed and the process may restart",
    );
    Ok(())
}

#[tauri::command]
fn cancel_update_restart() -> Result<(), String> {
    let mut barrier = UPDATE_RESTART_BARRIER
        .lock()
        .map_err(|_| "Update safety barrier is unavailable; Gaming Mode remains blocked.".to_string())?;
    *barrier = false;
    Ok(())
}

#[tauri::command]
fn start_gaming_session(
    opts: gaming_orchestrator::StartOptions,
) -> Result<gaming_session::SessionFile, String> {
    if !gaming_mode_gate() {
        return Err("Gaming Mode is gated".into());
    }
    let update_barrier = UPDATE_RESTART_BARRIER
        .lock()
        .map_err(|_| "Update safety barrier is unavailable; Gaming Mode start refused.".to_string())?;
    if *update_barrier {
        return Err("A signed Compy update is being installed; Gaming Mode cannot start until Compy restarts.".into());
    }
    gaming_orchestrator::start(opts)
}

#[tauri::command]
fn stop_gaming_session() -> Result<(), String> {
    if !gaming_mode_gate() {
        return Err("Gaming Mode is gated".into());
    }
    gaming_orchestrator::stop()
}

#[tauri::command]
fn get_gaming_session_state() -> Option<gaming_session::SessionFile> {
    if !gaming_mode_gate() {
        return None;
    }
    // Prefer an orphaned (uncleanly-ended) session so the UI prompts to recover.
    gaming_orchestrator::detect_orphan().or_else(gaming_session::load_session)
}

#[tauri::command]
fn recover_gaming_session(confirm: bool) -> Result<(), String> {
    if !gaming_mode_gate() {
        return Err("Gaming Mode is gated".into());
    }
    gaming_orchestrator::recover(confirm)
}

/// True only when an on-disk `active` session was started by THIS app run (an
/// in-run tab switch → resume). A session left by a prior run that died —
/// reboot/crash — returns false so the UI offers recovery instead of silently
/// resuming it as "Gaming Mode on."
#[tauri::command]
fn gaming_session_is_live() -> bool {
    if !gaming_mode_gate() {
        return false;
    }
    gaming_orchestrator::session_is_live_this_run()
}


// State-detection helpers consumed by check_state_kind / check_change_active.

pub(crate) fn usb_selective_suspend_off_on_ac() -> bool {
    usb_selective_suspend_off_on_ac_checked().unwrap_or(false)
}

/// `None` when `powercfg` returned no readable AC value (#392).
pub(crate) fn usb_selective_suspend_off_on_ac_checked() -> Option<bool> {
    query_power_setting_ac_dc(PWR_SUBGROUP_USB, PWR_SETTING_USB_SELECTIVE_SUSPEND).map(|(ac, _)| ac == 0)
}

pub(crate) fn pcie_aspm_off_on_ac() -> bool {
    pcie_aspm_off_on_ac_checked().unwrap_or(false)
}

/// `None` when `powercfg` returned no readable AC value (#392).
pub(crate) fn pcie_aspm_off_on_ac_checked() -> Option<bool> {
    query_power_setting_ac_dc(PWR_SUBGROUP_PCIE, PWR_SETTING_PCIE_ASPM).map(|(ac, _)| ac == 0)
}

pub(crate) fn eee_disabled_on_any_eligible_adapter() -> bool {
    // ON (in the recommended sense — EEE off) iff EVERY resolvable property reads disabled,
    // judged by the HONEST comparator (the driver's own disabled token / "Off" / "0" — never
    // just the English "Disabled", which misread Off-vocabulary drivers; tester-found 2026-06-10).
    // Unresolvable (no adapter / no recognizable switch) is conservatively NOT-disabled — the rec
    // is ineligible upstream in that case, so this never drives a false offer.
    match crate::actions::resolve_eee() {
        crate::actions::EeeResolution::Ready(props) => {
            props.iter().all(crate::actions::eee_value_is_disabled)
        }
        _ => false,
    }
}


// ─── Startup apps (HKCU Run) ─────────────────────────────────────────────
//
// Windows tracks auto-start entries in HKCU\...\Run and HKLM\...\Run.
// Task Manager's "Disabled" state is a separate registry blob under
// StartupApproved\Run — first byte = 0x02 (enabled) or 0x03 (disabled),
// followed by an 8-byte timestamp (which we always zero out).
//
// V1 is HKCU-only. HKLM (system-wide) entries are visible but need admin
// to toggle — we'll add that when we re-use the UAC elevation pattern.

#[derive(Serialize, Clone)]
pub(crate) struct StartupEntry {
    name: String,
    command: String,
    enabled: bool,
}

#[tauri::command]
fn get_startup_entries() -> Vec<StartupEntry> {
    startup_entries()
}

// ── Latency / Diagnostics (read-only; no elevation, network, or mutation) ──
// Surfaces latency.rs's passive diagnostics. `get_latency_diagnostics` is the
// instant snapshot (MSI/timer/CPU-topology/USB); the two `measure_*` commands run
// short on-demand timing windows (the UI shows a "measuring…" state while they run).
#[tauri::command]
fn get_latency_diagnostics() -> latency::LatencyReport {
    latency::gather_latency_report()
}

#[tauri::command]
async fn latency_measure_wake() -> Option<latency::WakeMeasurement> {
    // ~1s blocking sample — run on the blocking pool so the webview doesn't freeze while it shows
    // "Measuring…". (The measurement is self-contained and thread-agnostic.)
    tauri::async_runtime::spawn_blocking(latency::measure_wake)
        .await
        .ok()
        .flatten()
}

#[tauri::command]
async fn latency_measure_mouse(duration_ms: u32) -> Option<latency::MouseMeasurement> {
    // ~duration_ms blocking Raw Input probe — self-contained (its own hidden window + message loop,
    // unique class per call), so it's safe to run off the UI thread on the blocking pool.
    tauri::async_runtime::spawn_blocking(move || latency::measure_mouse(duration_ms))
        .await
        .ok()
        .flatten()
}

/// CR-slow-async: the slow reads, served off the main thread.
///
/// A plain `#[tauri::command] fn` runs on the main thread, so while Black Box read the event logs,
/// a report export gathered hardware and diagnostics, or a probe spawned PowerShell, the window
/// stopped painting. Each command here keeps its name, its arguments and its answer type exactly;
/// the work is the same function as before, run on the blocking pool the way `latency_measure_*`
/// and `get_realplay_progress` already are. The sync functions stay callable in-process (export,
/// priorities and the tests read them directly). Nothing here changes Windows or reaches
/// `actions.rs`; the two exports write their files exactly as before.
///
/// CR-capture-async: `start_fps_capture` (which waits up to 5 s for an old helper and launches an
/// elevated one) and `stop_fps_capture` are served here too. They take turns under one lock in
/// monitoring.rs (`capture_in_order`), so a stop pressed during a start's wait runs after that
/// start and leaves capture off; each takes a ticket at invoke time and a request older than the
/// newest one applied is skipped, so the last press wins (CR-capture-last-wins).
mod off_main {
    /// Run `work` on the blocking pool and hand back exactly what it returned. The pool only fails
    /// a task that panicked; that panic is re-raised here, so it is printed and that one invoke is
    /// left unanswered while the app keeps running. These answer types have no error to carry it;
    /// the `Result` commands use [`blocking_result`] and answer an error in words instead.
    async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
        match tauri::async_runtime::spawn_blocking(work).await {
            Ok(answer) => answer,
            Err(e) => panic!("a slow read stopped before it answered: {e}"),
        }
    }

    /// The same, for a command that already answers `Result<_, String>`: a stopped task is an
    /// `Err` in words rather than an unanswered invoke.
    async fn blocking_result<T: Send + 'static>(
        what: &'static str,
        work: impl FnOnce() -> Result<T, String> + Send + 'static,
    ) -> Result<T, String> {
        tauri::async_runtime::spawn_blocking(work)
            .await
            .map_err(|e| format!("Compy couldn't finish {what} ({e})"))?
    }

    #[tauri::command]
    pub(crate) async fn get_crash_blackbox() -> crate::blackbox::BlackBoxReport {
        blocking(crate::blackbox::get_crash_blackbox).await
    }

    #[tauri::command]
    pub(crate) async fn export_report(
        feedback: Option<String>,
        tier: Option<String>,
    ) -> Result<crate::export::ExportResult, String> {
        blocking_result("the report", move || crate::export::export_report(feedback, tier)).await
    }

    #[tauri::command]
    pub(crate) async fn preview_support_evidence(
    ) -> Result<crate::support_evidence::EvidencePreview, String> {
        blocking_result("the support preview", crate::support_evidence::preview_support_evidence)
            .await
    }

    #[tauri::command]
    pub(crate) async fn export_support_evidence(
        projection: String,
    ) -> Result<crate::support_evidence::SupportExport, String> {
        blocking_result("the support export", move || {
            crate::support_evidence::export_support_evidence(projection)
        })
        .await
    }

    #[tauri::command]
    pub(crate) async fn get_leftovers() -> crate::leftovers::LeftoversReport {
        blocking(crate::leftovers::get_leftovers).await
    }

    #[tauri::command]
    pub(crate) async fn get_game_readiness() -> crate::readiness::GameReadiness {
        blocking(crate::readiness::get_game_readiness).await
    }

    #[tauri::command]
    pub(crate) async fn get_priorities() -> crate::priorities::Priorities {
        blocking(crate::priorities::get_priorities).await
    }

    #[tauri::command]
    pub(crate) async fn get_diagnostics() -> Vec<crate::diagnostics::DiagnosticSection> {
        blocking(crate::diagnostics::get_diagnostics).await
    }

    #[tauri::command]
    pub(crate) async fn get_trial_candidates(
        risk_choice: Option<crate::trial_candidates::RiskChoice>,
    ) -> Vec<crate::trial_candidates::TrialCandidate> {
        blocking(move || crate::trial_candidates::get_trial_candidates(risk_choice)).await
    }

    #[tauri::command]
    pub(crate) async fn start_fps_capture() -> Result<(), String> {
        // The ticket is taken here, before the blocking pool (CR-capture-last-wins): when this
        // command's body first runs, which follows the window's invoke order except for two
        // invokes landing within the same instant on different runtime workers (residual).
        let ticket = crate::monitoring::capture_ticket();
        blocking_result("starting the capture", move || {
            crate::monitoring::start_fps_capture_ticketed(ticket)
        })
        .await
    }

    #[tauri::command]
    pub(crate) async fn stop_fps_capture() {
        let ticket = crate::monitoring::capture_ticket();
        blocking(move || crate::monitoring::stop_fps_capture_ticketed(ticket)).await
    }

    /// The commands served here, by the name the window invokes. The tests hold the handler list
    /// and `build.rs` to it.
    #[cfg(test)]
    pub(crate) const SERVED: &[&str] = &[
        "get_crash_blackbox",
        "export_report",
        "preview_support_evidence",
        "export_support_evidence",
        "get_leftovers",
        "get_game_readiness",
        "get_priorities",
        "get_diagnostics",
        "get_trial_candidates",
        "start_fps_capture",
        "stop_fps_capture",
    ];

    #[cfg(test)]
    mod tests {
        use super::*;
        use std::future::Future;

        // Compile-time: each async command takes the arguments the sync one took and answers the
        // very type it answered, so the invoke and the JSON the window gets are unchanged.
        fn answers<T, Fut: Future<Output = T>>(_sync: fn() -> T, _async: fn() -> Fut) {}
        fn answers1<A, T, Fut: Future<Output = T>>(_sync: fn(A) -> T, _async: fn(A) -> Fut) {}
        fn answers_by_type<T, Fut: Future<Output = T>>(_sync: impl Fn() -> T, _async: impl Fn() -> Fut) {}
        fn answers2<A, B, T, Fut: Future<Output = T>>(_sync: fn(A, B) -> T, _async: fn(A, B) -> Fut) {}

        #[test]
        fn every_command_answers_the_type_it_answered_before() {
            answers(crate::blackbox::get_crash_blackbox, get_crash_blackbox);
            answers(crate::support_evidence::preview_support_evidence, preview_support_evidence);
            answers(crate::leftovers::get_leftovers, get_leftovers);
            answers(crate::readiness::get_game_readiness, get_game_readiness);
            answers(crate::priorities::get_priorities, get_priorities);
            answers(crate::diagnostics::get_diagnostics, get_diagnostics);
            answers1(crate::support_evidence::export_support_evidence, export_support_evidence);
            answers1(crate::trial_candidates::get_trial_candidates, get_trial_candidates);
            answers2(crate::export::export_report, export_report);
            // The capture commands are checked by item type, never as fn pointers: a pointer links
            // their bodies (helper launch, tray) into this test binary, which has no Windows app
            // manifest, and it then fails to load (STATUS_ENTRYPOINT_NOT_FOUND).
            answers_by_type(crate::monitoring::start_fps_capture, start_fps_capture);
            answers_by_type(crate::monitoring::stop_fps_capture, stop_fps_capture);
        }

        #[test]
        fn the_work_runs_off_the_calling_thread_and_its_answer_comes_back_unchanged() {
            let caller = std::thread::current().id();
            let (answer, worker) = tauri::async_runtime::block_on(blocking(move || {
                (vec![1, 2, 3], std::thread::current().id())
            }));
            assert_eq!(answer, vec![1, 2, 3]);
            assert_ne!(worker, caller, "the work ran on the caller's thread");
            let err = tauri::async_runtime::block_on(blocking_result::<()>("a test", || {
                Err("refused".into())
            }));
            assert_eq!(err, Err("refused".to_string()), "an Err passes through untouched");
        }

        #[test]
        fn a_panicking_result_command_answers_an_error_in_words() {
            let out = tauri::async_runtime::block_on(blocking_result::<()>("a test", || {
                panic!("boom")
            }));
            assert!(out.unwrap_err().starts_with("Compy couldn't finish a test"));
        }

        // Every served command is registered from here (async), under its own name, and the
        // capability build still lists that name. Fails on the old code, where each was a sync
        // command registered from its own module.
        #[test]
        fn the_handler_registers_each_served_command_from_here() {
            let lib = include_str!("lib.rs");
            // Built with concat! so this test's own text can't be found first.
            let handler = &lib[lib.find(concat!("generate_handler", "![")).expect("handler")..];
            let handler = &handler[..handler.find("])").expect("handler end")];
            let build = include_str!("../build.rs");
            for name in SERVED {
                let entry = format!("off_main::{name},");
                assert_eq!(handler.matches(entry.as_str()).count(), 1, "{name} is not registered from off_main");
                let elsewhere = handler
                    .lines()
                    .map(str::trim)
                    .filter(|l| l.trim_end_matches(',').rsplit("::").next() == Some(name))
                    .count();
                assert_eq!(elsewhere, 1, "{name} is registered twice");
                assert!(lib.contains(&format!("pub(crate) async fn {name}(")), "{name} is not async");
                assert!(build.contains(&format!("\"{name}\"")), "{name} left build.rs's APP_COMMANDS");
            }
        }
    }
}

// ── Benchmark / measured-efficacy (read-only; measures, never mutates) ──
// The engine is multi-second, so `start_benchmark` runs it on a background thread and
// the UI polls `get_benchmark_state`. The baseline persists; efficacy = latest vs baseline
// (Measure → Change → Re-measure → honest verdict).
#[tauri::command]
fn start_benchmark() {
    benchmark::start_benchmark();
}

#[tauri::command]
fn cancel_benchmark() {
    benchmark::cancel_benchmark();
}

// CPU temp via interop with a user-installed monitor (HWiNFO shared memory, tried first, then
// LHM/OHM WMI). None when none is running — Compy never reads it directly (no kernel driver);
// no published value means unknown, never fabricated. See cpu_temp.rs.
#[tauri::command]
fn get_cpu_temp() -> Option<cpu_temp::CpuTemp> {
    cpu_temp::read_cpu_temp()
}

// Live fan RPMs via the SAME driver-free monitor interop (HWiNFO/LHM/OHM). [] when no monitor is
// publishing — the rig hologram then shows fans as honest "not detected" ghosts. Read-only.
#[tauri::command]
fn get_fan_sensors() -> Vec<cpu_temp::FanSensor> {
    cpu_temp::read_fans()
}

// What Compy can observe, read-only, about the sensor apps it reads temperatures FROM — so the
// CPU-temp row can make an offer (start the one you already have / turn HWiNFO's Shared Memory
// Support on / get one) instead of a dead-end sentence. Enumerates processes, checks fixed install
// paths and asks whether HWiNFO's shared-memory section is open. Changes nothing. See cpu_temp.rs.
#[tauri::command]
fn get_sensor_sources() -> cpu_temp::SensorSourceReport {
    cpu_temp::read_sensor_sources()
}

// Start a sensor app the user already has, at their click. `app` is a catalog ID ("hwinfo" | "lhm"),
// never a path — the executable is resolved and name-checked in cpu_temp.rs, and the launch is
// handed to the shell, so Compy elevates nothing: any admin prompt is that app's own manifest
// asking. Not a Windows mutation (nothing is written, nothing is configured).
#[tauri::command]
fn launch_sensor_app(app: String) -> Result<(), String> {
    cpu_temp::launch_sensor_app(&app)
}

// Live calibration trial: measure the rig's run-to-run noise on the running game (read-only;
// no tweak, no mutation). Validates the whole capture -> window -> verdict pipeline.
#[tauri::command]
fn start_calibration() {
    benchmark_trial::start_calibration();
}

#[tauri::command]
fn cancel_trial() {
    benchmark_trial::cancel_trial();
}

// Tweak A-B trial: measure the game, apply a real change, re-measure, then ALWAYS roll it back
// (Drop-guarded). Mutating — gated on explicit user choice of an appliable rec. See benchmark_trial.
#[tauri::command]
fn start_tweak_trial(rec_id: String, rec_title: String) {
    benchmark_trial::start_tweak_trial(rec_id, rec_title);
}

// §2a aggregate-stack A/B trial: measure the game, apply the WHOLE safe stack in one UAC, re-measure
// the cumulative delta, then ALWAYS roll back every change (multi-Drop-guarded). Mutating — ships
// DARK behind benchmark_trial::stack_trial_gate() (returns false), so this refuses until live QA +
// owner sign-off arms it. See benchmark_trial.
#[tauri::command]
fn start_stack_trial(items: Vec<history::BatchApplyItem>) {
    if !benchmark_trial::stack_trial_gate() {
        return; // dark: aggregate trial not armed
    }
    let pairs = items.into_iter().map(|it| (it.rec_id, it.rec_title)).collect();
    benchmark_trial::start_stack_trial(pairs);
}

// True only when the aggregate-stack trial is armed — the FE renders the stack-A/B affordance ONLY
// when this is true (dark by default, mirrors gaming_mode_enabled / preload_removal_gate).
#[tauri::command]
fn stack_trial_armed() -> bool {
    benchmark_trial::stack_trial_gate()
}

// The rec_ids the trial can apply/measure/roll-back (the verified appliable catalog) — the
// Benchmark tab's tweak picker filters its rec list to these.
#[tauri::command]
fn get_appliable_rec_ids() -> Vec<String> {
    history::APPLIABLE_REC_IDS.iter().map(|s| s.to_string()).collect()
}

// Scoreboard: the verified-result ledger (only Keep verdicts earn entries — the firewall).
#[tauri::command]
fn get_scoreboard() -> benchmark_scoreboard::ScoreboardView {
    benchmark_scoreboard::scoreboard()
}

#[tauri::command]
fn clear_scoreboard() -> Result<(), String> {
    benchmark_scoreboard::clear_scoreboard()
}

// M4 — cross-session comparison: arm a fix from a debrief, then the next same-game session's
// finalize computes the honest delta.
#[tauri::command]
fn arm_comparison(
    rec_id: String,
    rec_title: String,
    game: String,
    baseline_avg_fps: f64,
    baseline_low1_fps: f64,
) -> Result<(), String> {
    comparison::arm(rec_id, rec_title, game, baseline_avg_fps, baseline_low1_fps)
}

#[tauri::command]
fn get_latest_comparison() -> Option<comparison::ComparisonResult> {
    comparison::latest_result()
}

#[tauri::command]
fn get_armed_comparison() -> Option<comparison::ArmedComparison> {
    comparison::armed()
}

#[tauri::command]
fn dismiss_comparison() {
    comparison::clear_result();
}

// Tuning baseline (spec 2026-06-08) — a user change made in a vendor tool (e.g. an Adrenalin
// undervolt). No Compy apply, no ledger entry, no mutation: this only records the baseline so the
// next same-game sessions can MEASURE whether the tune held up, reusing the comparison engine.
#[tauri::command]
fn arm_tuning(
    guide_id: String,
    label: String,
    game: String,
    baseline_avg_fps: f64,
    baseline_low1_fps: f64,
    baseline_peak_temp_c: Option<u32>,
) -> Result<(), String> {
    comparison::arm_tuning(
        guide_id,
        label,
        game,
        baseline_avg_fps,
        baseline_low1_fps,
        baseline_peak_temp_c,
    )
}

#[tauri::command]
fn report_tuning_crash() -> Result<(), String> {
    comparison::report_tuning_crash()
}

#[tauri::command]
fn clear_tuning() {
    comparison::clear_tuning();
}

#[tauri::command]
fn get_trial_state() -> benchmark_trial::TrialState {
    benchmark_trial::trial_state()
}

#[tauri::command]
fn get_benchmark_state() -> benchmark::BenchmarkState {
    benchmark::benchmark_state()
}

#[tauri::command]
fn set_benchmark_baseline() -> Result<(), String> {
    benchmark::set_baseline()
}

#[tauri::command]
fn clear_benchmark_baseline() -> Result<(), String> {
    benchmark::clear_baseline()
}

// Plain helper (no #[tauri::command]) so other modules (priorities) can read
// startup entries without referencing the command fn.
pub(crate) fn startup_entries() -> Vec<StartupEntry> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let Ok(run_key) = hkcu.open_subkey("Software\\Microsoft\\Windows\\CurrentVersion\\Run") else {
        return Vec::new();
    };
    let approval = hkcu
        .open_subkey(
            "Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run",
        )
        .ok();

    let mut entries = Vec::new();
    for value_result in run_key.enum_values() {
        let Ok((name, _)) = value_result else { continue };
        let command: String = run_key.get_value(&name).unwrap_or_default();
        let enabled = approval
            .as_ref()
            .and_then(|k| k.get_raw_value(&name).ok())
            .map(|v| v.bytes.first().copied() != Some(0x03))
            .unwrap_or(true); // default enabled if no approval entry exists
        entries.push(StartupEntry {
            name,
            command,
            enabled,
        });
    }
    entries.sort_by_key(|a| a.name.to_lowercase());
    entries
}

/// Read-only: the StartupApproved\Run value `actions::apply_startup_entry_enabled` writes for
/// `name`, for the Trust Ledger's live re-check of a startup-app row (#620). The key is opened
/// KEY_READ, never created. `Ok(None)` when the key or the value is absent.
pub(crate) fn startup_approval_value(name: &str) -> std::io::Result<Option<winreg::RegValue>> {
    use std::io::ErrorKind::NotFound;
    let key = match RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey_with_flags(actions::STARTUP_APPROVED_RUN_KEY, winreg::enums::KEY_READ)
    {
        Ok(key) => key,
        Err(e) if e.kind() == NotFound => return Ok(None),
        Err(e) => return Err(e),
    };
    match key.get_raw_value(name) {
        Ok(value) => Ok(Some(value)),
        Err(e) if e.kind() == NotFound => Ok(None),
        Err(e) => Err(e),
    }
}

// ── Phase-B preload-app removal (BUILT DARK) — read-only listing probe ──
// Which curated preload apps are installed for this user + whether the feature is armed. The FE
// card renders NOTHING unless armed && something installed, so the UI ships dark-safe; while the
// gate is dark this doesn't even enumerate (zero PowerShell spawns in shipped builds).
#[derive(Serialize)]
struct PreloadAppsView {
    armed: bool,
    installed: Vec<String>,
}

#[tauri::command]
fn get_preload_apps() -> PreloadAppsView {
    let armed = actions::preload_removal_gate();
    let installed = if armed {
        actions::installed_preload_ids()
            .into_iter()
            .map(str::to_string)
            .collect()
    } else {
        Vec::new()
    };
    PreloadAppsView { armed, installed }
}

// set_startup_entry_enabled MOVED to history.rs (2026-08-03). It used to write
// StartupApproved\Run directly from here — outside the mutation boundary, with no snapshot, no
// receipt and no rollback, and it destroyed Windows' own timestamp bytes so the prior value could
// not be restored even in principle. The command name and its arguments are unchanged; it now
// returns an AppliedChangeView like every other mutation. See actions::apply_startup_entry_enabled.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
// ─── Frameless-window maximize fix (Windows) ─────────────────────────────────
// The main window runs decorations:false (custom titlebar). Undecorated Windows windows
// maximize over the ENTIRE monitor — covering the taskbar (measured: maximized rect = full
// monitor, not the work area). We subclass the window proc and answer WM_GETMINMAXINFO with
// the monitor WORK AREA, so native maximize stops at the taskbar. Real maximize state is
// preserved (Win+Up / snap / restore still behave). Read-only message handling on our OWN
// window — no injection into other processes, no hook, no elevation.
#[cfg(windows)]
mod win_maximize_fix {
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
    use windows::Win32::Graphics::Gdi::{
        GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    };
    use windows::Win32::UI::Shell::{DefSubclassProc, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{MINMAXINFO, WM_GETMINMAXINFO};

    unsafe extern "system" fn subclass_proc(
        hwnd: HWND,
        msg: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _uid: usize,
        _data: usize,
    ) -> LRESULT {
        if msg == WM_GETMINMAXINFO {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut mi = MONITORINFO {
                cbSize: core::mem::size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if GetMonitorInfoW(monitor, &mut mi).as_bool() {
                let work: RECT = mi.rcWork;
                let mon: RECT = mi.rcMonitor;
                let mmi = &mut *(lparam.0 as *mut MINMAXINFO);
                mmi.ptMaxPosition.x = work.left - mon.left;
                mmi.ptMaxPosition.y = work.top - mon.top;
                mmi.ptMaxSize.x = work.right - work.left;
                mmi.ptMaxSize.y = work.bottom - work.top;
                mmi.ptMaxTrackSize.x = work.right - work.left;
                mmi.ptMaxTrackSize.y = work.bottom - work.top;
            }
            return LRESULT(0);
        }
        DefSubclassProc(hwnd, msg, wparam, lparam)
    }

    /// Subclass the main window (by raw HWND address) so maximize respects the work area, and round
    /// its corners on Win11 (the frameless window otherwise reads as a hard rectangle). Installed once
    /// at startup; the HWND outlives the app, so we never remove the subclass.
    pub fn install(hwnd_addr: isize) {
        use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_WINDOW_CORNER_PREFERENCE};
        unsafe {
            let hwnd = HWND(hwnd_addr as *mut core::ffi::c_void);
            let _ = SetWindowSubclass(hwnd, Some(subclass_proc), 1, 0);
            // DWMWCP_ROUND = 2 — round corners. No-op on Win10; DWM squares maximized windows anyway.
            let pref: i32 = 2;
            let _ = DwmSetWindowAttribute(
                hwnd,
                DWMWA_WINDOW_CORNER_PREFERENCE,
                &pref as *const i32 as *const core::ffi::c_void,
                core::mem::size_of::<i32>() as u32,
            );
        }
    }
}

/// An env var counts as SET only when it carries a meaningful value. `""` and `"0"` are how a caller
/// turns a flag back OFF, and reading either as "on" would leave the escape hatch impossible to
/// release once anything upstream had exported the name.
fn is_env_flag_set(value: Option<&str>) -> bool {
    matches!(value, Some(v) if !v.trim().is_empty() && v.trim() != "0")
}

/// The one argv token that carries "do not take the foreground" ACROSS a process boundary. An
/// environment variable cannot reach a Compy that is ALREADY running: the single-instance plugin
/// hands the second launch's argv to the live instance and nothing else, so the intent has to ride
/// there or a relaunch-while-alive steals focus no matter what the new process was told.
pub(crate) const QUIET_LAUNCH_ARG: &str = "--no-activate";

/// True when this launch's command line asked to stay out of the foreground. Matches the exact
/// token only — a substring match would fire on a path that merely contains it.
pub(crate) fn argv_asks_for_quiet_launch<I: IntoIterator<Item = S>, S: AsRef<str>>(argv: I) -> bool {
    argv.into_iter().any(|a| a.as_ref() == QUIET_LAUNCH_ARG)
}

/// FOREGROUND COURTESY (owner ask, 2026-08-11). A launch that Compy's own tooling performs must not
/// take the foreground away from whatever the owner is actually doing: an exclusive-fullscreen game
/// is MINIMISED when another window activates, so a dev relaunch or a post-build reinstall costs him
/// his session. Suppressing activation does not hide the app — the window is created, visible and on
/// the taskbar. It simply does not steal focus.
///
/// Precedence, highest first:
///   `COMPY_ACTIVATE`    — explicit "yes, take the foreground": the escape hatch, so a launch that is
///                         MEANT to be seen stays one variable away.
///   `--no-activate`     — the argv form, which also reaches an already-running instance.
///   `COMPY_NO_ACTIVATE` — explicit "do not". Set by `scripts/ship-reinstall.ps1` around its relaunch.
///   debug build         — every `npm run tauri dev` launch is tooling-initiated by definition, so
///                         dev is quiet by DEFAULT rather than by a launcher remembering to opt in.
///
/// A shipped release the owner starts himself sets neither variable and activates normally.
fn should_suppress_activation(
    is_debug_build: bool,
    no_activate: Option<&str>,
    activate: Option<&str>,
    argv_quiet: bool,
) -> bool {
    if is_env_flag_set(activate) {
        return false;
    }
    if argv_quiet || is_env_flag_set(no_activate) {
        return true;
    }
    is_debug_build
}

pub fn run() {
    // FOREGROUND COURTESY, part 1 of 2 — the CREATION-TIME half. `focus` is honoured by the runtime
    // (tao raises the first ShowWindow with SW_SHOWNOACTIVATE when it is false), but it has to be
    // decided HERE: by the time `setup` runs the window already exists and has already activated, so
    // un-focusing there is a snatch-and-return that has ALREADY minimised the game it meant to
    // spare. `focusable` is deliberately untouched — a window the owner cannot click into afterwards
    // is a broken app, not a polite one.
    //
    // Part 2 is the window-state plugin below. Setting `focus = false` alone does NOT work, which is
    // what made the first attempt at this (PR #100) measure as inert three times over.
    let mut context = tauri::generate_context!();
    let no_activate = std::env::var("COMPY_NO_ACTIVATE").ok();
    let activate = std::env::var("COMPY_ACTIVATE").ok();
    let suppress_activation = should_suppress_activation(
        cfg!(debug_assertions),
        no_activate.as_deref(),
        activate.as_deref(),
        argv_asks_for_quiet_launch(std::env::args().skip(1)),
    );
    if suppress_activation {
        for window in &mut context.config_mut().app.windows {
            window.focus = false;
        }
    }
    tauri::Builder::default()
        // Single-instance MUST be the first plugin. A second launch focuses the
        // existing main window instead of opening another process — so only one
        // main process ever mutates history.json (no cross-process race). The
        // elevated --fps-capture helper returns from main.rs before this builder,
        // so it never registers here and is unaffected.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // Single-instance hardening (Train #3 §1, part 2): a second launch focuses the existing
            // window, OR recreates it when the lock holder has none — a ghost from a prior unclean
            // exit (the old silent no-op was the "Compy won't open" report) OR a window hidden to the
            // tray (relaunch-while-trayed restores it). Shared restore logic so both paths match.
            //
            // FOREGROUND COURTESY: the second process dies here, so ITS environment is worthless —
            // only its argv survives the hop. A tooling relaunch passes `--no-activate` and the live
            // window is restored WITHOUT being raised; a launch the owner performs himself carries
            // no such token and is brought to the front, which is the entire point of clicking it.
            let quiet = argv_asks_for_quiet_launch(argv.iter().skip(1).map(String::as_str));
            crate::tray::show_or_recreate_main(app, !quiet);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // In-app updater (ARMED 2026-07-22, owner decision): signed-update check against the
        // public releases repo — Compy's only outbound call (ShellV2 footer copy states it).
        // Packages are signature-verified against the tauri.conf.json pubkey before install;
        // a compromised host alone cannot push code to the fleet without the private key.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Process relaunch, used solely to restart into the new build after an update installs.
        .plugin(tauri_plugin_process::init())
        // Remember the main window's size/position across launches (first run opens at the
        // tauri.conf.json 1280x720 centered default — tester gripe 2026-07-23). The telemetry
        // overlay is DENYLISTED: it places itself programmatically (corner picker) and a restore
        // would fight that logic.
        // FOREGROUND COURTESY, part 2 of 2 — and the part that actually broke PR #100. This plugin's
        // `on_window_ready` hook runs BEFORE our `setup`, and `restore_state` ends with an
        // unconditional `show()` + `set_focus()` whenever StateFlags::VISIBLE is set (measured in
        // tauri-plugin-window-state 2.4.1, src/lib.rs:262-264). `set_focus` calls Win32
        // SetForegroundWindow, which overrides the polite SW_SHOWNOACTIVATE the config above just
        // bought — so the window came up, THEN was yanked to the front, and the owner's game
        // minimised. Dropping VISIBLE removes the plugin's show/focus entirely and changes nothing
        // else: the window is still created visible by the config, and size/position (plus
        // maximized, for owner-initiated launches — see part 3) are still restored. It also fixes a latent bug — a window closed to tray saved `visible:false`
        // and the plugin then refused to show it at all on the NEXT launch ("Compy won't open").
        // FOREGROUND COURTESY, part 3 — MAXIMIZED is dropped from the restore on QUIET launches
        // only. `restore_state` reaches a maximized window through `ShowWindow(SW_MAXIMIZE)`, which
        // is an ACTIVATING show command: on any launch where Windows permits a foreground change,
        // that restore is a working foreground steal, so a quiet launch must never issue it. There
        // is no non-activating maximize in ShowWindow's vocabulary, so the quiet path restores
        // size/position and gives up maximized; the owner's own launches keep the full restore.
        //
        // HONEST SCOPE (2026-08-13, issue #121): this closes a vector, it did NOT close the
        // measurement that found it. launch-focus-guard's first-ever STRICT runtime run (idle desk,
        // foreground rights granted) saw a quiet launch fronted from 6ms — before any window can
        // exist — and the fronting persisted after this fix. That is system-level launch activation
        // in the launcher chain, outside anything this process does; #121 owns it.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(if suppress_activation {
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE
                        - tauri_plugin_window_state::StateFlags::MAXIMIZED
                } else {
                    tauri_plugin_window_state::StateFlags::all()
                        - tauri_plugin_window_state::StateFlags::VISIBLE
                })
                .with_denylist(&["overlay"])
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            get_hardware_info,
            get_recommendations,
            off_main::get_diagnostics,
            hwchange::get_hardware_changes,
            machine_model::get_machine_model,
            hwchange::acknowledge_hardware_changes,
            off_main::get_crash_blackbox,
            incident_observer::get_pending_care_incident,
            incident_observer::mark_care_incident_opened,
            incident_observer::dismiss_care_incident,
            license::get_license_status,
            license::set_license_key,
            off_main::get_leftovers,
            get_nic_driver_info,
            get_gpu_sensors,
            get_cpu_sensors,
            monitoring::get_memory_pressure,
            off_main::start_fps_capture,
            off_main::stop_fps_capture,
            get_fps_status,
            show_overlay,
            hide_overlay,
            overlay_visible,
            set_overlay_corner,
            apply_recommendation,
            history::apply_recommendations_batch,
            history::suspend_known_service,
            history::disable_known_bloat_task,
            history::remove_known_preload_app,
            history::restore_leftover,
            get_preload_apps,
            rollback_change,
            history::changed_outside_offers,
            history::record_changed_outside,
            get_applied_changes,
            history::get_ledger_health,
            history::reveal_ledger_folder,
            get_startup_entries,
            history::set_startup_entry_enabled,
            get_rules_source,
            off_main::get_game_readiness,
            dismiss_readiness_check,
            restore_readiness_check,
            get_session_summaries,
            off_main::export_report,
            open_export_folder,
            off_main::get_priorities,
            priorities_from,
            get_build_stamp,
            // #130 — read-only: which data root is live, which predicates fired, and any foreign ledgers.
            // Surfaced in Settings and the support export so "which ledger am I looking at" is answerable.
            data_root::get_data_root_report,
            receipts::get_receipts_gate,
            receipts::preview_receipt_payload,
            receipts::get_receipts_consent,
            receipts::set_receipts_sharing_enabled,
            receipts::acknowledge_receipts_disclosure,
            receipts::get_receipts_endpoint,
            off_main::preview_support_evidence,
            off_main::export_support_evidence,
            support_evidence::clear_support_evidence,
            get_latency_diagnostics,
            latency_measure_wake,
            latency_measure_mouse,
            start_benchmark,
            cancel_benchmark,
            get_cpu_temp,
            get_fan_sensors,
            get_sensor_sources,
            launch_sensor_app,
            start_calibration,
            cancel_trial,
            start_tweak_trial,
            start_stack_trial,
            stack_trial_armed,
            get_appliable_rec_ids,
            get_scoreboard,
            clear_scoreboard,
            arm_comparison,
            get_latest_comparison,
            get_armed_comparison,
            dismiss_comparison,
            arm_tuning,
            report_tuning_crash,
            clear_tuning,
            get_trial_state,
            get_benchmark_state,
            set_benchmark_baseline,
            clear_benchmark_baseline,
            gaming_mode_enabled,
            begin_update_restart,
            cancel_update_restart,
            start_gaming_session,
            stop_gaming_session,
            get_gaming_session_state,
            recover_gaming_session,
            gaming_session_is_live,
            tray::set_close_to_tray,
            game_mode_persist::set_keep_game_mode,
            intelligence::what_changed_for_session,
            intelligence::what_changed_between,
            intelligence::get_intelligence_headline,
            intelligence_patterns::get_intelligence_patterns,
            component_evidence::get_component_evidence,
            experiment::get_experiment_gate,
            experiment::get_experiments,
            experiment::simulate_optimization,
            experiment::start_experiment,
            experiment::trial_start_precheck,
            experiment::get_smoothest_readiness,
            experiment::conclude_experiment,
            experiment::get_realplay_progress,
            experiment::conclude_realplay,
            experiment::restore_experiment,
            experiment::apply_outcome_choice,
            experiment::undo_outcome_choice,
            off_main::get_trial_candidates,
        ])
        .on_window_event(|window, event| {
            // Close behavior (Train #3 §1 — clean exit), now with the opt-in tray branch.
            // The overlay is a CONFIG-DECLARED window, so closing main would otherwise leave it
            // (hidden) keeping the process alive as a windowless GHOST — holding the single-instance
            // lock (→ "Compy won't open") AND keeping the FPS heartbeat refreshing so the elevated
            // helper never self-exits.
            //   • Default (tray OFF): tear down capture + exit the whole app — exactly §1.
            //   • Tray ON (opt-in): HIDE main to the VISIBLE tray icon (not a ghost — the icon is the
            //     honest "still running" signal). Capture lifecycle untouched; the tray's Quit does
            //     the full §1 teardown.
            use tauri::Manager;
            if window.label() == "main" {
                // Care trigger 2 of 3 (Tier 1 task 9): the user came back to Compy. Throttled by
                // `should_scan` — alt-tabbing is not evidence that a crash happened, and this event
                // fires every single time.
                if let tauri::WindowEvent::Focused(true) = event {
                    crate::incident_observer::scan_async(
                        crate::incident_observer::ScanTrigger::Foreground,
                    );
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if crate::tray::close_to_tray_enabled() {
                        api.prevent_close();
                        let _ = window.hide();
                    } else {
                        crate::monitoring::shutdown_for_exit();
                        window.app_handle().exit(0);
                    }
                }
            }
        })
        .setup(|app| {
            // Support evidence (spec §12) — the anchor record. Every event after this one in the
            // file belongs to this launch of this build, which is what makes "it broke after the
            // update" answerable: the stamp is right there above the failure. Written first, and
            // synchronously, so ordering in the file is real ordering. It can never fail loudly —
            // record() swallows its own errors by contract.
            support_evidence::record(
                support_evidence::EventKind::Lifecycle,
                "app_start",
                "launched",
                support_evidence::Outcome::Ok,
                &format!("Compy {} started ({})", env!("CARGO_PKG_VERSION"), build_stamp()),
            );
            // Trial Protocol #583: resolve any experiment start that a crash or kill interrupted, before
            // the first window can read the store. Read-only against Windows (it never restores at
            // launch). Every interrupted start is closed and saved; one closed while the change history
            // can't be read is written to support evidence so it is never only a console line. Only a
            // store that can't be read or saved leaves a start Pending, for the next start or launch.
            match crate::experiment::reconcile_interrupted_starts() {
                Ok(outcomes) => {
                    if outcomes.contains(&crate::experiment::InterruptedStart::LedgerUnreadable) {
                        support_evidence::record(
                            support_evidence::EventKind::Operation,
                            "experiment_reconcile",
                            "ledger_unreadable",
                            support_evidence::Outcome::Failed,
                            "an interrupted experiment start was closed as Aborted with nothing measured, because the change history could not be read to check on its change",
                        );
                    }
                }
                Err(e) => {
                    eprintln!("[compy] experiment reconcile skipped: {e}");
                    support_evidence::record(
                        support_evidence::EventKind::Operation,
                        "experiment_reconcile",
                        "store_unavailable",
                        support_evidence::Outcome::Failed,
                        &e,
                    );
                }
            }
            // Capture the handle so the session recorder thread can fire the debrief toast.
            let _ = APP_HANDLE.set(app.handle().clone());
            // Care trigger 1 of 3 (Tier 1 task 9): the launch scan. This is the one that catches a
            // crash that happened while Compy was CLOSED — the persisted watermark is what makes
            // that possible, and this is the only trigger that is not throttled, because it runs
            // once per process. Off-thread and best-effort: it must never delay the first window.
            crate::incident_observer::scan_async(crate::incident_observer::ScanTrigger::Launch);
            // Build the (always-present) tray icon; the close-to-tray BEHAVIOR stays gated on the
            // opt-in flag, so an unconfigured user still gets the §1 clean exit.
            if let Err(e) = crate::tray::init(app.handle()) {
                eprintln!("[compy] tray init failed (continuing without tray): {e}");
            }
            // Game Mode persistence keeper (option 1(b) mechanism C). No-op while DARK —
            // keep_game_mode_gate() ships false, so this never spawns a thread.
            crate::game_mode_persist::start_keeper();
            // Intelligence identity snapshot (read-only probe, off-thread + throttled): records
            // driver/build/power-plan identity at launch so changes become timeline events even
            // for users who never open the intelligence surfaces. Honest from-now-on — nothing
            // is backfilled.
            crate::intelligence::refresh_identity_snapshots_async();
            // §C build stamp (spec 2026-06-12): DEV windows title themselves with the exact build
            // so an owner review can never run against a stale window unnoticed. Release titles
            // stay clean (the stamp lives in Settings → About there).
            if cfg!(debug_assertions) {
                use tauri::Manager;
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_title(&format!("Compy · {}", build_stamp()));
                }
            }
            // Frameless-window maximize fix — constrain the decorations:false window's maximize to
            // the monitor work area so it never covers the taskbar (see win_maximize_fix above).
            #[cfg(windows)]
            {
                use tauri::Manager;
                if let Some(w) = app.get_webview_window("main") {
                    if let Ok(h) = w.hwnd() {
                        win_maximize_fix::install(h.0 as isize);
                    }
                }
            }
            Ok(())
        })
        .run(context)
        .expect("error while running tauri application");
}

#[cfg(test)]
mod activation_tests {
    use super::{argv_asks_for_quiet_launch, is_env_flag_set, should_suppress_activation};

    #[test]
    fn a_release_launch_the_owner_starts_himself_still_takes_the_foreground() {
        assert!(!should_suppress_activation(false, None, None, false));
    }

    #[test]
    fn a_dev_launch_is_quiet_by_default_because_tooling_started_it() {
        assert!(should_suppress_activation(true, None, None, false));
    }

    #[test]
    fn no_activate_suppresses_a_release_launch() {
        assert!(should_suppress_activation(false, Some("1"), None, false));
    }

    #[test]
    fn activate_outranks_no_activate_so_the_escape_hatch_always_wins() {
        assert!(!should_suppress_activation(true, Some("1"), Some("1"), true));
        assert!(!should_suppress_activation(
            false,
            Some("1"),
            Some("1"),
            true
        ));
    }

    #[test]
    fn an_empty_or_zero_value_turns_a_flag_off_rather_than_on() {
        // Otherwise a variable exported as "" anywhere upstream would pin the behaviour permanently
        // on, and the escape hatch could never be released once it had been set.
        assert!(!is_env_flag_set(Some("")));
        assert!(!is_env_flag_set(Some("   ")));
        assert!(!is_env_flag_set(Some("0")));
        assert!(is_env_flag_set(Some("1")));
        assert!(!is_env_flag_set(None));
        assert!(should_suppress_activation(false, Some("1"), Some("0"), false));
        assert!(!should_suppress_activation(false, Some("0"), None, false));
    }

    #[test]
    fn the_argv_token_suppresses_a_release_launch_that_sets_no_variable() {
        // The relaunch path depends on this: a second process hands the live instance its argv and
        // nothing else, so an env-only lever would be silently dropped at the process boundary.
        assert!(should_suppress_activation(false, None, None, true));
    }

    #[test]
    fn only_the_exact_argv_token_counts() {
        assert!(argv_asks_for_quiet_launch(["--no-activate"]));
        assert!(argv_asks_for_quiet_launch(["--fps-capture", "--no-activate"]));
        assert!(!argv_asks_for_quiet_launch(Vec::<&str>::new()));
        // A substring match would fire on any path that happens to contain the token, and a
        // release the owner double-clicks from such a folder would silently stop coming to front.
        assert!(!argv_asks_for_quiet_launch([
            r"C:\tools\--no-activate\compy.exe"
        ]));
        assert!(!argv_asks_for_quiet_launch(["--no-activate=0"]));
    }
}


// ─── Apply / rollback safety-contract tests ──────────────────────────────
//
// These PIN the existing safety model before any module movement (revised
// plan: tests first). They prove the contract is real — that Compy can undo
// what it did from LOCAL HISTORY ALONE — without mutating Windows. The actual
// mutation (dispatch_apply / dispatch_rollback running powercfg/registry edits)
// is covered by the manual release-gate QA checklist, not unit tests; here we
// prove the typed allowlist, snapshot fidelity, and history-only resolution.
#[cfg(test)]
mod safety_tests {
    use super::*;
    use serde_json::json;

    // ── the `--run-elevated` helper's boundary lock, end-to-end through the real entry ──────

    #[test]
    fn elevated_helper_runs_nothing_without_a_matching_ticket() {
        // Foreign hex with no ticket: exit 3 and ZERO PowerShell executed — proven by a command
        // whose side effect (a marker file) must not appear.
        let marker =
            std::env::temp_dir().join(format!("compy-boundary-{}.txt", std::process::id()));
        let _ = std::fs::remove_file(&marker);
        let cmd = format!("Set-Content -Path '{}' -Value x", marker.display());
        let hex = actions::to_hex(cmd.as_bytes());
        assert_eq!(run_elevated_helper(&hex, r"C:\__compy_qa_missing__\no.ticket"), 3);
        assert!(!marker.exists(), "rejected hex must execute ZERO PowerShell");
    }

    #[test]
    fn elevated_helper_runs_a_minted_dispatch_exactly_once() {
        // The legitimate path: the same mint run_elevated_powershell performs → the helper runs
        // the command (real, unelevated PowerShell here — a harmless no-op) and consumes the
        // ticket. A replay of the SAME argv finds no ticket and runs nothing.
        let hex = actions::to_hex(b"exit 0");
        let ticket = actions::mint_elevation_ticket(&hex).expect("mint");
        let ticket_s = ticket.to_string_lossy().to_string();
        assert_eq!(run_elevated_helper(&hex, &ticket_s), 0);
        assert!(!ticket.exists(), "the verified dispatch consumes its ticket");
        assert_eq!(run_elevated_helper(&hex, &ticket_s), 3, "replay must be refused");
    }

    // §C build stamp: the format is the contract both surfaces (About + dev title) render.
    #[test]
    fn build_stamp_format_is_pinned() {
        assert_eq!(format_build_stamp("ab12cd3", false, true), "ab12cd3 · dev");
        assert_eq!(format_build_stamp("ab12cd3", true, false), "ab12cd3+dirty · release");
        assert_eq!(format_build_stamp("nogit", false, false), "nogit · release");
        // The real stamp always carries a profile and a non-empty hash.
        let real = build_stamp();
        assert!(real.ends_with(" · dev") || real.ends_with(" · release"));
        assert!(!real.starts_with(" "));
    }

    // §C build stamp — the dirty check MUST stay root-anchored. build.rs runs with CWD = the crate
    // root (src-tauri/); a bare `:(exclude)docs` pathspec resolves relative to that CWD and silently
    // fails to exclude the repo-root docs/, leaking every untracked screenshot back in as "+dirty"
    // (the 2026-07-17 false-positive on a code-identical arming build). `top` magic anchors it to the
    // repo root. This pins the fix so a "simplification" can't quietly regress it.
    #[test]
    fn build_dirty_check_is_root_anchored() {
        let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/build.rs"))
            .expect("read build.rs");
        assert!(
            src.contains(":(exclude,top)docs"),
            "build.rs dirty check must use the root-anchored `:(exclude,top)docs` pathspec"
        );
        assert!(
            !src.contains("\":(exclude)docs\""),
            "the bare `:(exclude)docs` pathspec is CWD-relative from src-tauri/ and re-introduces \
             the 2026-07-17 false-`+dirty` bug — keep the `top` magic"
        );
    }

    // §C build stamp — the dirty predicate must actually FLIP on an unstaged working-tree edit.
    // build.rs bakes `COMPY_GIT_DIRTY` from EXACTLY `git status --porcelain -- :(exclude,top)docs`.
    // This drives that predicate end-to-end through a hermetic throwaway repo and proves the full
    // clean → unstaged-dirty → clean cycle — the exact case the OLD rerun watch (`.git/HEAD` +
    // `.git/index` only) let go stale, since an unstaged edit touches neither .git path. Runs
    // entirely under the OS temp dir — never mutates THIS repo. If git or the temp repo is
    // unavailable the guard FAILS LOUDLY (panics) rather than silently returning success: a test
    // that no-ops when its preconditions are absent is a false-green that proves nothing. NOTE the
    // scope of that requirement: git is a requirement of THIS TEST'S ENVIRONMENT, NOT a hard
    // production build dependency — build.rs spawns git but deliberately DEGRADES to a `nogit` stamp
    // when git is absent (a git-less source build still compiles). So its absence here means a broken
    // *test* environment, not that Compy can't build; the loud failure guards the test's own validity.
    #[test]
    fn build_dirty_predicate_flips_on_unstaged_change() {
        use std::process::Command;

        // Unique throwaway repo, isolated from this repo AND the global git config.
        let uniq = format!(
            "{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        );
        let repo = std::env::temp_dir().join(format!("compy-dirty-guard-{uniq}"));
        let _ = std::fs::remove_dir_all(&repo);
        std::fs::create_dir_all(&repo)
            .expect("create a throwaway temp repo dir for the build-dirty guard (temp setup must \
                     not silently pass this test)");

        // git bound to the temp repo with a hermetic identity: no signing, no CRLF munging, so the
        // predicate reads the same on any machine.
        let git = |args: &[&str]| -> Option<std::process::Output> {
            Command::new("git")
                .args([
                    "-c", "user.name=compy-test",
                    "-c", "user.email=compy-test@example.invalid",
                    "-c", "commit.gpgsign=false",
                    "-c", "core.autocrlf=false",
                    "-c", "core.safecrlf=false",
                    "-c", "init.defaultBranch=main",
                ])
                .args(args)
                .current_dir(&repo)
                .output()
                .ok()
                .filter(|o| o.status.success())
        };

        // Git absent/unusable ⇒ FAIL LOUDLY, do not silently pass. Clean up the temp dir first so
        // a panic doesn't strand it.
        if git(&["init"]).is_none() {
            let _ = std::fs::remove_dir_all(&repo);
            panic!(
                "git init failed in a throwaway temp repo — the COMPY_GIT_DIRTY predicate could not \
                 be exercised. git is required by THIS TEST'S environment (not a hard production \
                 dependency: build.rs degrades to a `nogit` stamp when git is absent); a missing git \
                 here is a broken test environment, and this guard must never silently return success."
            );
        }

        let tracked = repo.join("tracked.rs");
        std::fs::write(&tracked, "// v1\n").expect("write v1");
        assert!(git(&["add", "tracked.rs"]).is_some(), "git add");
        assert!(git(&["commit", "-m", "init"]).is_some(), "git commit");

        // The EXACT predicate build.rs bakes into COMPY_GIT_DIRTY: dirty ⇔ non-empty porcelain.
        let is_dirty = || -> bool {
            let out = git(&["status", "--porcelain", "--", ":(exclude,top)docs"])
                .expect("git status");
            !out.stdout.is_empty()
        };

        // 1. Freshly committed tree reads clean.
        assert!(!is_dirty(), "a freshly-committed tree must read clean (dirty=0)");
        // 2. UNSTAGED edit to a compiled input flips it dirty — the case that used to go stale.
        std::fs::write(&tracked, "// v2 unstaged edit\n").expect("write v2");
        assert!(is_dirty(), "an unstaged working-tree edit must read dirty (dirty=1)");
        // 3. Reverting the edit returns it to clean.
        assert!(git(&["checkout", "--", "tracked.rs"]).is_some(), "git checkout --");
        assert!(!is_dirty(), "reverting the edit must read clean again (dirty=0)");

        // Pin that the predicate exercised here is the one build.rs actually ships (shape, not
        // formatting): both defining tokens must be present in build.rs.
        let build_src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/build.rs"))
            .expect("read build.rs");
        assert!(
            build_src.contains("--porcelain") && build_src.contains(":(exclude,top)docs"),
            "the git-status command under test must match build.rs's COMPY_GIT_DIRTY predicate"
        );

        let _ = std::fs::remove_dir_all(&repo);
    }

    // §C build stamp — the rerun-if-changed watch set is load-bearing and PARTIAL by design.
    // Once build.rs emits ANY `cargo:rerun-if-changed`, cargo watches ONLY the listed paths (it
    // drops the default whole-package scan). The OLD set (`.git/HEAD` + `.git/index` alone) went
    // stale on an unstaged source edit — which touches neither .git path — so `COMPY_GIT_DIRTY`
    // kept a previous value. This pins COMPY's EXPLICIT set so removing any watched input (a
    // "simplification") fails loudly instead of silently re-opening the stale-stamp bug. Note this
    // is only the explicit set: `tauri_build::build()` emits its OWN watchers on top (notably
    // `tauri.conf.json` and `capabilities/`), so the EFFECTIVE combined set is wider than the five
    // strings pinned here — this test does not (and need not) assert those. It also does NOT assert
    // cargo actually re-runs the script (that's cargo's behavior, not ours); the explicit set is
    // deliberately partial — an unstaged change OUTSIDE src-tauri/{src,Cargo.toml,Cargo.lock} and
    // outside tauri_build's own watched inputs still won't re-trigger it until staged/committed.
    // ship-reinstall.ps1 step 0b (a fresh `git status` at ship time) is the authoritative backstop
    // for that residual, so no artifact ships with an unaccounted-for dirty tree.
    #[test]
    fn build_rs_declares_dirty_watch_set() {
        let src = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/build.rs"))
            .expect("read build.rs");
        for path in ["../.git/HEAD", "../.git/index", "src", "Cargo.toml", "Cargo.lock"] {
            let needle = format!("cargo:rerun-if-changed={path}");
            assert!(
                src.contains(&needle),
                "build.rs must emit `{needle}` — dropping any watched input silently re-opens the \
                 stale-`COMPY_GIT_DIRTY` bug (an unstaged edit to that input would stop re-stamping)"
            );
        }
    }

    fn roundtrips<T>(v: &T) -> bool
    where
        T: serde::Serialize + for<'de> serde::Deserialize<'de>,
    {
        let j = serde_json::to_value(v).unwrap();
        let back: T = serde_json::from_value(j.clone()).unwrap();
        j == serde_json::to_value(&back).unwrap()
    }

    fn change_with(
        rollback_action: Option<RollbackAction>,
        snapshot: serde_json::Value,
        rec_id: &str,
    ) -> AppliedChange {
        AppliedChange {
            id: "id-1".into(),
            rec_id: rec_id.into(),
            rec_title: "title".into(),
            applied_at: "2026-01-01T00:00:00Z".into(),
            snapshot,
            status: "applied".into(),
            applied_action: None,
            rollback_action,
            app_version_at_apply: None,
            ruleset_version_at_apply: None,
            elevation_used: None,
            provenance: None,
            hw_fingerprint: None,
            rolled_back_at: None,
            justified_by_experiment: None,
            rollback_justified_by_experiment: None,
            changed_outside: None,
        }
    }

    #[test]
    fn snapshot_variants_roundtrip() {
        assert!(roundtrips(&Snapshot::GameMode { prior_enabled: Some(1), prior_allow: Some(1) }));
        assert!(roundtrips(&Snapshot::Service {
            prior_state: "Running".into(),
            prior_start_mode: "Automatic".into()
        }));
        assert!(roundtrips(&Snapshot::PowerPlan { prior_guid: "g".into() }));
        assert!(roundtrips(&Snapshot::NagleNics {
            interfaces: vec![NagleInterfaceSnapshot {
                interface: "if".into(),
                prior_ack: None,
                prior_nodelay: Some(1)
            }]
        }));
        assert!(roundtrips(&Snapshot::EeeNicProperty {
            adapters: vec![EeeNicSnapshot {
                adapter_name: "Ethernet".into(),
                property_display_name: "Energy Efficient Ethernet".into(),
                prior_value: "Enabled".into()
            }]
        }));
    }

    #[test]
    fn applied_and_rollback_action_roundtrip() {
        assert!(roundtrips(&AppliedAction::DisableKnownService {
            service: KnownService::SysMain
        }));
        assert!(roundtrips(&AppliedAction::DisableUsbSelectiveSuspendOnAc));
        assert!(roundtrips(&RollbackAction::RestoreServiceFromSnapshot {
            service: KnownService::WSearch
        }));
        assert!(roundtrips(&RollbackAction::RestorePowerPlanSettingFromSnapshot));
    }

    #[test]
    fn typed_allowlist_rejects_unknown_actions() {
        // The typed allowlist (deny_unknown_fields + tagged enum) stops a
        // hostile/garbled history entry from selecting an arbitrary action.
        assert!(serde_json::from_value::<AppliedAction>(json!({"kind": "format-c-drive"})).is_err());
        assert!(serde_json::from_value::<RollbackAction>(json!({"kind": "rm-rf-system32"})).is_err());
    }

    #[test]
    fn known_service_roundtrip_and_rejects_unknown() {
        assert!(roundtrips(&KnownService::NvTelemetryContainer));
        assert_eq!(
            serde_json::from_value::<KnownService>(json!("SysMain")).unwrap(),
            KnownService::SysMain
        );
        assert!(serde_json::from_value::<KnownService>(json!("EvilService")).is_err());
    }

    #[test]
    fn applied_change_stores_full_contract() {
        let change = AppliedChange {
            id: "game-mode-123".into(),
            rec_id: "game-mode".into(),
            rec_title: "Enable Game Mode".into(),
            applied_at: "2026-01-01T00:00:00Z".into(),
            snapshot: serde_json::to_value(&Snapshot::GameMode { prior_enabled: Some(0), prior_allow: Some(0) }).unwrap(),
            status: "applied".into(),
            applied_action: Some(AppliedAction::EnableGameMode),
            rollback_action: Some(RollbackAction::RestoreGameModeFromSnapshot),
            app_version_at_apply: Some("0.1.0".into()),
            ruleset_version_at_apply: Some("1.0.0-baseline".into()),
            elevation_used: Some(true),
            provenance: None,
            hw_fingerprint: None,
            rolled_back_at: None,
            justified_by_experiment: None,
            rollback_justified_by_experiment: None,
            changed_outside: None,
        };
        let back: AppliedChange =
            serde_json::from_value(serde_json::to_value(&change).unwrap()).unwrap();
        assert!(back.applied_action.is_some());
        assert!(back.rollback_action.is_some());
        assert_eq!(back.app_version_at_apply.as_deref(), Some("0.1.0"));
        assert_eq!(back.ruleset_version_at_apply.as_deref(), Some("1.0.0-baseline"));
        assert_eq!(back.elevation_used, Some(true));
        assert!(!back.snapshot.is_null());
    }

    #[test]
    fn legacy_history_without_new_fields_still_deserializes() {
        // Old history.json entries lacked the typed-contract fields. They must
        // still load (serde default -> None), or upgrades would brick history.
        let legacy = json!({
            "id": "game-mode-1",
            "rec_id": "game-mode",
            "rec_title": "Enable Game Mode",
            "applied_at": "2025-01-01T00:00:00Z",
            "snapshot": {"prior": 1},
            "status": "applied"
        });
        let c: AppliedChange = serde_json::from_value(legacy).unwrap();
        assert!(c.applied_action.is_none());
        assert!(c.rollback_action.is_none());
        assert!(c.app_version_at_apply.is_none());
    }

    #[test]
    fn rollback_resolves_from_history_alone_even_for_removed_rec() {
        // Typed contract stored at apply time; rec_id is NOT in the live
        // catalog. Rollback must still resolve — proving independence from the
        // live recommendation set (ARCHITECTURE_LOCKS §1.5).
        let snap = serde_json::to_value(&Snapshot::GameMode { prior_enabled: Some(0), prior_allow: Some(0) }).unwrap();
        let change = change_with(
            Some(RollbackAction::RestoreGameModeFromSnapshot),
            snap,
            "a-rec-that-no-longer-exists",
        );
        let (action, snapshot) = resolve_rollback(&change).expect("resolve from history alone");
        assert!(matches!(action, RollbackAction::RestoreGameModeFromSnapshot));
        assert!(matches!(snapshot, Snapshot::GameMode { prior_enabled: Some(0), .. }));
    }

    #[test]
    fn rollback_synthesizes_from_legacy_snapshot() {
        // No typed contract (old entry) -> synthesize from rec_id + legacy JSON.
        let change = change_with(None, json!({"prior": 1}), "game-mode");
        let (action, snapshot) = resolve_rollback(&change).expect("legacy synthesis");
        assert!(matches!(action, RollbackAction::RestoreGameModeFromSnapshot));
        assert!(matches!(snapshot, Snapshot::GameMode { prior_enabled: Some(1), prior_allow: None }));
    }

    #[test]
    fn registry_snapshot_distinguishes_missing_from_existing() {
        // missing-vs-existing is the difference between "delete on rollback" and
        // "restore to X". It must survive serialization.
        let missing = serde_json::to_value(&Snapshot::HwSchMode { prior: None }).unwrap();
        let existing = serde_json::to_value(&Snapshot::HwSchMode { prior: Some(0) }).unwrap();
        assert_ne!(missing, existing);
        assert!(matches!(
            serde_json::from_value::<Snapshot>(missing).unwrap(),
            Snapshot::HwSchMode { prior: None }
        ));
        assert!(matches!(
            serde_json::from_value::<Snapshot>(existing).unwrap(),
            Snapshot::HwSchMode { prior: Some(0) }
        ));
    }

    #[test]
    fn power_setting_snapshot_preserves_ac_dc_and_guids() {
        let s = Snapshot::PowerPlanSetting {
            plan_guid: "PLAN".into(),
            subgroup_guid: "SUB".into(),
            setting_guid: "SET".into(),
            prior_ac_value: 1,
            prior_dc_value: 2,
        };
        let back: Snapshot = serde_json::from_value(serde_json::to_value(&s).unwrap()).unwrap();
        match back {
            Snapshot::PowerPlanSetting {
                plan_guid,
                subgroup_guid,
                setting_guid,
                prior_ac_value,
                prior_dc_value,
            } => {
                assert_eq!(plan_guid, "PLAN");
                assert_eq!(subgroup_guid, "SUB");
                assert_eq!(setting_guid, "SET");
                assert_eq!(prior_ac_value, 1);
                assert_eq!(prior_dc_value, 2);
            }
            _ => panic!("variant changed on round-trip"),
        }
    }
}
