//! "Worth testing on this PC" — the Trial picker's candidate filter (P4-candidates,
//! OPTIMIZATION_ENGINE §3.1–3.3). READ-ONLY: it reads the catalog and the Trust Ledger and decides,
//! per change, whether the Trial picker offers it. It changes nothing.
//!
//! Each catalog change passes the three filters in spec order, and the FIRST one it fails is its
//! reason, so every change has exactly one honest answer:
//!   1. applies to this PC        — the catalog's `eligible` (hardware gating);
//!   2. not already set           — the catalog's live `currently_applied` read;
//!   3. Compy can do it safely    — an audited one-click apply exists (`history::is_appliable`,
//!      the same allowlist `dispatch_apply` and the simulator use).
//!
//! A change that fails is never dropped silently: the picker lists it under "Show why others
//! aren't listed" with this reason. "Already set" also says who set it: Compy (the ledger's shared
//! active-change rule, `history::live_change_groups`, reads it On), Compy's Gaming Mode (the live
//! session contract holds it), Windows (neither), or "couldn't check" when the ledger or the session
//! contract can't be read — never a guess — on the owner rig Game Bar was already off in
//! Windows (`AppCaptureEnabled` = 0, `GameDVR_Enabled` = 0, no Compy row), which is why the picker
//! never offered `game-bar-disable` (GB-picker) — correct, but it gave no reason.
//!
//! P4-rank (§3.5, §3.7, §4) then works on the changes that passed:
//!   5. measurable here — left out as "too small to measure here" ONLY when the catalog states an
//!      expected 1% low effect (`expected_low1_pct`) AND this game's between-session band is
//!      measured (`experiment::next_trial_measured_band_pct`), and the effect is no bigger than the
//!      band. The catalog states no effect size for any change today, so every change stays listed
//!      with its effect unknown; nothing is estimated to fill the gap.
//!   7. order — [`rank`]: stronger benefit evidence first (the catalog's `provenance`, mapped as the
//!      simulator maps it: verified/measured-signal ⇒ measured, expected-impact ⇒ not measured),
//!      then lower risk (the catalog's `severity`: safe before moderate), then catalog order. Test
//!      time doesn't split ties: the catalog has no per-change test time, and every Trial is the
//!      same one baseline session plus one session with the change.
//!   6. interactions — not grouped: the catalog records no interaction or conflict between changes.
//!
//! P8-posture-a (RISK_MODEL §2): last of all, the user's [`RiskChoice`]. "Low risk only" leaves a
//! change the catalog doesn't call `safe` out as "outside the risk you chose"; "Low and moderate",
//! the default, leaves nothing out (today's behaviour). It reads only `severity`; it adds no
//! change and applies nothing.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

use crate::actions::{KnownService, RollbackAction, Snapshot, PWR_SUBGROUP_PCIE, PWR_SUBGROUP_USB};
use crate::gaming_session::{SessionChange, SessionStatus};
use crate::history::{ActiveCheck, LiveRow};

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SkipReason {
    /// §3.1: this PC's hardware can't use it.
    NotForThisPc,
    /// §3.2: Windows already has it set this way, and not through Compy.
    AlreadySet,
    /// §3.2: already set, and the Trust Ledger shows Compy set it.
    AlreadySetByCompy,
    /// §3.2: already set, and the live Gaming Mode session contract holds it (Compy set it for the
    /// session and puts it back when the session ends).
    AlreadySetByGamingMode,
    /// §3.2: already set by a Gaming Mode session whose restore is pending or failed — Compy set it
    /// and has not finished putting it back, so no "puts it back when the session ends" promise.
    AlreadySetByGamingModeRestoreUnfinished,
    /// §3.2: already set, but the ledger or the session contract couldn't be read, so Compy can't
    /// say whether it made the change.
    AlreadySetUnchecked,
    /// §3.2: already set, and the ledger has a live apply of it, but that apply's own check can't be
    /// read (the shared rule's can't-confirm group): Compy did apply it, it just can't confirm its
    /// change is the one keeping it set. Never "not by Compy".
    AlreadySetUnconfirmed,
    /// §3.3: Compy has no audited one-click change for it (advice only), so it can't be tested.
    NoSafeApply,
    /// §3.5: the catalog's stated effect is no bigger than this game's measured between-session
    /// band, so a Trial couldn't tell it from noise ("too small to measure here").
    TooSmallToMeasureHere,
    /// RISK_MODEL §2: the change's catalog risk is more than the user chose to allow on this PC.
    OutsideChosenRisk,
}

/// How far the user lets Compy go on this PC (RISK_MODEL §2 posture), applied to the catalog's
/// `severity`. Defaults to today's behaviour.
#[derive(Serialize, serde::Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum RiskChoice {
    /// Only changes the catalog calls `safe`. An unknown severity is left out: it can't be shown
    /// to be low.
    LowOnly,
    /// `safe` and `moderate` (what the picker offered before the choice existed). An unknown
    /// severity stays listed as before; the picker shows its risk as unknown.
    #[default]
    LowAndModerate,
}

impl RiskChoice {
    fn allows(self, risk: Risk) -> bool {
        match self {
            Self::LowOnly => risk == Risk::Low,
            Self::LowAndModerate => true,
        }
    }
}

/// How strong the catalog's evidence is that the change helps (`provenance`). Variant order is the
/// rank order.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Evidence {
    /// `verified` or `measured-signal`: measured evidence it moves a metric.
    Measured,
    /// `expected-impact`: follows from how Windows works, not measured.
    NotMeasured,
    /// No provenance the rank recognises.
    Unknown,
}

/// The catalog's risk for the change (`severity`). Variant order is the rank order.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Risk {
    /// `safe`.
    Low,
    /// `moderate`.
    Moderate,
    /// A severity the rank doesn't recognise.
    Unknown,
}

impl Evidence {
    fn of(provenance: Option<&str>) -> Self {
        match provenance {
            Some("verified" | "measured-signal") => Self::Measured,
            Some("expected-impact") => Self::NotMeasured,
            _ => Self::Unknown,
        }
    }
}

impl Risk {
    fn of(severity: Option<&str>) -> Self {
        match severity {
            Some("safe") => Self::Low,
            Some("moderate") => Self::Moderate,
            _ => Self::Unknown,
        }
    }
}

/// A stated effect set beside the measured band it can't beat (both percent of the 1% low).
#[derive(Serialize, Clone, Copy, Debug, PartialEq)]
pub(crate) struct EffectVsBand {
    pub effect_pct: f64,
    pub band_pct: f64,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct TrialCandidate {
    pub id: String,
    pub title: String,
    pub passes: bool,
    pub reason: Option<SkipReason>,
    /// The catalog's own words for a hardware mismatch (`ineligible_reason`), when it has them.
    pub detail: Option<String>,
    /// 1-based place in the suggested test order ([`rank`]); `None` for a change left out.
    pub position: Option<u32>,
    pub evidence: Evidence,
    pub risk: Risk,
    /// The catalog's stated 1% low effect in percent; `None` = unknown (never estimated).
    pub stated_effect_pct: Option<f64>,
    /// Set with `TooSmallToMeasureHere`: the effect and the band it can't beat.
    pub too_small: Option<EffectVsBand>,
}

/// The catalog fields the filter reads.
pub(crate) struct CatalogEntry<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub eligible: bool,
    pub ineligible_reason: Option<&'a str>,
    pub currently_applied: bool,
    /// `provenance`: benefit evidence for the rank.
    pub provenance: Option<&'a str>,
    /// `severity`: risk for the rank.
    pub severity: Option<&'a str>,
    /// `expected_low1_pct`: a stated effect size. No catalog change has one today.
    pub stated_effect_pct: Option<f64>,
}

/// Which already-set changes Compy is behind. `None` = that record couldn't be read.
pub(crate) struct WhoSetIt {
    /// Changes the ledger's shared active-change rule reads On.
    pub ledger_on: Option<HashSet<String>>,
    /// Changes the same rule puts in its can't-confirm group (a live apply whose check is
    /// Unreadable/Unrecognised). Empty when the ledger couldn't be read (`ledger_on` is `None`).
    pub ledger_cant_confirm: HashSet<String>,
    /// Changes the live Gaming Mode session contract holds (empty when no session is running).
    pub gaming_mode: Option<HashSet<String>>,
    /// That session's restore is pending or failed (`session_restore_unfinished`).
    pub gaming_mode_restore_unfinished: bool,
}

impl WhoSetIt {
    fn already_set_reason(&self, id: &str) -> SkipReason {
        let has = |s: &Option<HashSet<String>>| s.as_ref().map(|s| s.contains(id));
        match (has(&self.gaming_mode), has(&self.ledger_on)) {
            (Some(true), _) if self.gaming_mode_restore_unfinished => {
                SkipReason::AlreadySetByGamingModeRestoreUnfinished
            }
            (Some(true), _) => SkipReason::AlreadySetByGamingMode,
            (_, Some(true)) => SkipReason::AlreadySetByCompy,
            _ if self.ledger_cant_confirm.contains(id) => SkipReason::AlreadySetUnconfirmed,
            (Some(false), Some(false)) => SkipReason::AlreadySet,
            // One of the two records couldn't be read and the other doesn't name it.
            _ => SkipReason::AlreadySetUnchecked,
        }
    }
}

/// One change through §3.1–3.3, §3.5 and the user's risk choice (checked last, so a change that
/// fails an earlier filter keeps that more specific reason). `band_pct` is this game's measured
/// between-session band, `None` when it isn't measured. Pure.
pub(crate) fn screen(
    entry: &CatalogEntry,
    appliable: bool,
    who: &WhoSetIt,
    band_pct: Option<f64>,
    choice: RiskChoice,
) -> TrialCandidate {
    let risk = Risk::of(entry.severity);
    let stated = entry.stated_effect_pct.filter(|e| e.is_finite() && *e > 0.0);
    let too_small = match (stated, band_pct.filter(|b| b.is_finite() && *b > 0.0)) {
        (Some(effect_pct), Some(band_pct)) if effect_pct <= band_pct => Some(EffectVsBand { effect_pct, band_pct }),
        _ => None,
    };
    let (reason, detail) = if !entry.eligible {
        (
            Some(SkipReason::NotForThisPc),
            entry.ineligible_reason.filter(|s| !s.is_empty()).map(str::to_string),
        )
    } else if entry.currently_applied {
        (Some(who.already_set_reason(entry.id)), None)
    } else if !appliable {
        (Some(SkipReason::NoSafeApply), None)
    } else if too_small.is_some() {
        (Some(SkipReason::TooSmallToMeasureHere), None)
    } else if !choice.allows(risk) {
        (Some(SkipReason::OutsideChosenRisk), None)
    } else {
        (None, None)
    };
    TrialCandidate {
        id: entry.id.to_string(),
        title: entry.title.to_string(),
        passes: reason.is_none(),
        too_small: too_small.filter(|_| reason == Some(SkipReason::TooSmallToMeasureHere)),
        reason,
        detail,
        position: None,
        evidence: Evidence::of(entry.provenance),
        risk,
        stated_effect_pct: stated,
    }
}

/// §3.7 / §4: the changes that passed, in the suggested test order (stronger evidence, then lower
/// risk, then catalog order — see the module note), numbered from 1; then every change left out, in
/// catalog order. Stable and deterministic. Pure.
pub(crate) fn rank(mut screened: Vec<TrialCandidate>) -> Vec<TrialCandidate> {
    // `sort_by_key` is stable, so equal keys keep catalog order.
    screened.sort_by_key(|c| (!c.passes, c.passes.then_some((c.evidence, c.risk))));
    let mut next = 0u32;
    for c in screened.iter_mut().filter(|c| c.passes) {
        next += 1;
        c.position = Some(next);
    }
    screened
}

/// Whether any catalog row states an effect size (only then is the band worth reading).
pub(crate) fn any_stated_effect(catalog: &Value) -> bool {
    catalog.as_array().is_some_and(|rows| rows.iter().any(|r| stated_effect(r).is_some()))
}

fn stated_effect(r: &Value) -> Option<f64> {
    r.get("expected_low1_pct").and_then(Value::as_f64)
}

/// The whole catalog (as `get_recommendations` serializes it), ranked ([`rank`]). Pure.
pub(crate) fn screen_catalog(
    catalog: &Value,
    appliable: &dyn Fn(&str) -> bool,
    who: &WhoSetIt,
    band_pct: Option<f64>,
    choice: RiskChoice,
) -> Vec<TrialCandidate> {
    let Some(rows) = catalog.as_array() else { return Vec::new() };
    let screened = rows
        .iter()
        .filter_map(|r| {
            let id = r.get("id")?.as_str()?;
            let entry = CatalogEntry {
                id,
                title: r.get("title").and_then(Value::as_str).unwrap_or(id),
                // Missing `eligible` is the serde default (true), as the catalog itself reads it.
                eligible: r.get("eligible").and_then(Value::as_bool).unwrap_or(true),
                ineligible_reason: r.get("ineligible_reason").and_then(Value::as_str),
                currently_applied: r.get("currently_applied").and_then(Value::as_bool).unwrap_or(false),
                provenance: r.get("provenance").and_then(Value::as_str),
                severity: r.get("severity").and_then(Value::as_str),
                stated_effect_pct: stated_effect(r),
            };
            Some(screen(&entry, appliable(id), who, band_pct, choice))
        })
        .collect();
    rank(screened)
}

/// The changes the shared active-change rule (`history::live_change_groups`, 453-f1) reads On —
/// the same set Health, Optimize, History and the session count use. Pure over the rows' live checks.
pub(crate) fn ledger_on_recs(rows: &[LiveRow<'_>]) -> HashSet<String> {
    ledger_groups(rows, true)
}

/// The same rule's can't-confirm group: a live apply whose check reads Unreadable/Unrecognised.
pub(crate) fn ledger_cant_confirm_recs(rows: &[LiveRow<'_>]) -> HashSet<String> {
    ledger_groups(rows, false)
}

fn ledger_groups(rows: &[LiveRow<'_>], on: bool) -> HashSet<String> {
    crate::history::live_change_groups(rows)
        .into_iter()
        .filter(|&i| (rows[i].check == Some(ActiveCheck::On)) == on)
        .map(|i| rows[i].rec_id.to_string())
        .collect()
}

/// The catalog change a Gaming Mode session change stands for, by its typed rollback contract.
/// `None` for a session change no Trial-able catalog change matches. Pure.
pub(crate) fn session_change_rec(c: &SessionChange) -> Option<&'static str> {
    let service = |s: &KnownService| match s {
        KnownService::SysMain => "sysmain-disable",
        KnownService::DiagTrack => "diagtrack-disable",
        KnownService::WSearch => "windows-search-disable",
        KnownService::NvTelemetryContainer => "nvidia-telemetry",
    };
    Some(match &c.rollback_action {
        RollbackAction::ResumeServiceFromSnapshot { service: s }
        | RollbackAction::RestoreServiceFromSnapshot { service: s } => service(s),
        RollbackAction::RestoreGameModeFromSnapshot => "game-mode",
        RollbackAction::RestoreGameBarFromSnapshot => "game-bar-disable",
        RollbackAction::RestorePowerPlanFromSnapshot => "power-ultimate",
        RollbackAction::RestoreMouseAccelFromSnapshot => "mouse-accel-off",
        RollbackAction::RestoreVisualEffectsFromSnapshot => "visual-effects",
        RollbackAction::RestoreHwSchModeFromSnapshot => "hags-enable",
        RollbackAction::RestoreNagleNicsFromSnapshot => "nagle-disable",
        RollbackAction::RestoreFastStartupFromSnapshot => "fast-startup-off",
        RollbackAction::RestoreReservedStorageFromSnapshot => "reserved-storage-off",
        RollbackAction::RestoreEnergyEfficientEthernetFromSnapshot => "eee-disable",
        RollbackAction::RestorePowerPlanSettingFromSnapshot => match &c.snapshot {
            Snapshot::PowerPlanSetting { subgroup_guid, .. } if subgroup_guid == PWR_SUBGROUP_USB => {
                "usb-selective-suspend-off"
            }
            Snapshot::PowerPlanSetting { subgroup_guid, .. } if subgroup_guid == PWR_SUBGROUP_PCIE => {
                "pcie-aspm-off"
            }
            _ => return None,
        },
        // No Trial-able catalog change stands for these. Named one by one, no catch-all, so a
        // rollback action added later fails to compile here until someone decides where it goes.
        RollbackAction::RestoreStartupApprovalFromSnapshot
        | RollbackAction::RestoreMemoryCompressionFromSnapshot
        | RollbackAction::RestoreMmcssFromSnapshot
        | RollbackAction::RestorePrioritySeparationFromSnapshot
        | RollbackAction::RestoreMpoFromSnapshot
        | RollbackAction::RestoreCoreParkingFromSnapshot
        | RollbackAction::RestoreTcpAutotuningFromSnapshot
        | RollbackAction::RestorePagefileFromSnapshot
        | RollbackAction::EnableScheduledTask { .. }
        | RollbackAction::ReinstallPreloadApp { .. } => return None,
    })
}

/// A session whose restore is pending or failed has not put its changes back; an active or ending
/// one still will. Exhaustive, so a new status has to be decided here. Pure.
pub(crate) fn session_restore_unfinished(status: SessionStatus) -> bool {
    match status {
        SessionStatus::Active | SessionStatus::Ending => false,
        SessionStatus::RestorePending | SessionStatus::RestoreFailed => true,
    }
}

fn read_ledger() -> Option<(HashSet<String>, HashSet<String>)> {
    let history = crate::history::load_history().ok()?;
    let reads = crate::history::LiveReads::default();
    let checks: Vec<Option<ActiveCheck>> = history
        .iter()
        .map(|c| (c.status != "rolled_back").then(|| crate::history::check_row_state(c, &reads)))
        .collect();
    let rows: Vec<LiveRow<'_>> = history
        .iter()
        .zip(&checks)
        .map(|(c, check)| LiveRow { rec_id: &c.rec_id, status: &c.status, applied_at: &c.applied_at, check: *check })
        .collect();
    Some((ledger_on_recs(&rows), ledger_cant_confirm_recs(&rows)))
}

/// The live session's changes and whether its restore is unfinished. `None` = couldn't be read.
fn read_gaming_mode() -> Option<(HashSet<String>, bool)> {
    use crate::gaming_session::{load_session, read_session_slot, SessionSlot};
    match read_session_slot() {
        SessionSlot::Empty => Some((HashSet::new(), false)),
        SessionSlot::Unreadable => None,
        SessionSlot::Loaded => {
            let f = load_session()?;
            let recs = f.changes.iter().filter_map(session_change_rec).map(str::to_string).collect();
            Some((recs, session_restore_unfinished(f.status)))
        }
    }
}

/// Every catalog change with its pass/fail for the Trial picker, under the user's risk choice
/// (`riskChoice` from the UI; absent = [`RiskChoice::default`], today's behaviour). Read-only.
#[tauri::command]
pub(crate) fn get_trial_candidates(risk_choice: Option<RiskChoice>) -> Vec<TrialCandidate> {
    let catalog = serde_json::to_value(crate::recommendations::get_recommendations()).unwrap_or(Value::Null);
    let (ledger_on, ledger_cant_confirm) = match read_ledger() {
        Some((on, cant)) => (Some(on), cant),
        None => (None, HashSet::new()),
    };
    let (gaming_mode, gaming_mode_restore_unfinished) = match read_gaming_mode() {
        Some((recs, unfinished)) => (Some(recs), unfinished),
        None => (None, false),
    };
    let who = WhoSetIt { ledger_on, ledger_cant_confirm, gaming_mode, gaming_mode_restore_unfinished };
    // The band is only read when some change states an effect size to hold against it.
    let band = if any_stated_effect(&catalog) { crate::experiment::next_trial_measured_band_pct() } else { None };
    screen_catalog(&catalog, &crate::history::is_appliable, &who, band, risk_choice.unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry<'a>(id: &'a str, eligible: bool, applied: bool) -> CatalogEntry<'a> {
        CatalogEntry {
            id,
            title: id,
            eligible,
            ineligible_reason: None,
            currently_applied: applied,
            provenance: None,
            severity: None,
            stated_effect_pct: None,
        }
    }
    fn scr(e: &CatalogEntry, appliable: bool, w: &WhoSetIt) -> TrialCandidate {
        screen(e, appliable, w, None, RiskChoice::default())
    }
    fn set(ids: &[&str]) -> Option<HashSet<String>> {
        Some(ids.iter().map(|s| s.to_string()).collect())
    }
    fn who(ledger: Option<HashSet<String>>, gaming: Option<HashSet<String>>) -> WhoSetIt {
        WhoSetIt {
            ledger_on: ledger,
            ledger_cant_confirm: HashSet::new(),
            gaming_mode: gaming,
            gaming_mode_restore_unfinished: false,
        }
    }
    fn nobody() -> WhoSetIt {
        who(set(&[]), set(&[]))
    }
    fn row<'a>(rec: &'a str, status: &'a str, at: &'a str, check: Option<ActiveCheck>) -> LiveRow<'a> {
        LiveRow { rec_id: rec, status, applied_at: at, check }
    }

    #[test]
    fn a_change_that_applies_is_unset_and_appliable_passes() {
        let c = scr(&entry("game-mode", true, false), true, &nobody());
        assert!(c.passes);
        assert_eq!(c.reason, None);
    }

    #[test]
    fn hardware_mismatch_fails_first_with_the_catalog_reason() {
        let mut e = entry("eee-disable", false, true);
        e.ineligible_reason = Some("No wired Ethernet port on this PC.");
        // Fails all three; the reason is the FIRST filter (§3.1), not a later one.
        let c = scr(&e, false, &who(set(&["eee-disable"]), set(&[])));
        assert!(!c.passes);
        assert_eq!(c.reason, Some(SkipReason::NotForThisPc));
        assert_eq!(c.detail.as_deref(), Some("No wired Ethernet port on this PC."));
    }

    #[test]
    fn already_set_says_who_set_it() {
        let e = entry("sysmain-disable", true, true);
        let r = |w: &WhoSetIt| scr(&e, true, w).reason;
        assert_eq!(r(&nobody()), Some(SkipReason::AlreadySet));
        assert_eq!(r(&who(set(&["sysmain-disable"]), set(&[]))), Some(SkipReason::AlreadySetByCompy));
        // Gaming Mode suspends SysMain for a session (gaming_orchestrator): Compy, not Windows.
        assert_eq!(r(&who(set(&[]), set(&["sysmain-disable"]))), Some(SkipReason::AlreadySetByGamingMode));
        assert!(!scr(&e, true, &nobody()).passes);
    }

    #[test]
    fn an_unreadable_record_never_reads_as_not_by_compy() {
        let e = entry("game-bar-disable", true, true);
        let r = |w: &WhoSetIt| scr(&e, true, w).reason;
        assert_eq!(r(&who(None, set(&[]))), Some(SkipReason::AlreadySetUnchecked), "ledger unreadable");
        assert_eq!(r(&who(set(&[]), None)), Some(SkipReason::AlreadySetUnchecked), "session unreadable");
        assert_eq!(r(&who(None, None)), Some(SkipReason::AlreadySetUnchecked));
        // A record that CAN be read and names it still attributes it.
        assert_eq!(r(&who(None, set(&["game-bar-disable"]))), Some(SkipReason::AlreadySetByGamingMode));
        assert_eq!(r(&who(set(&["game-bar-disable"]), None)), Some(SkipReason::AlreadySetByCompy));
    }

    // A Gaming Mode session stuck in restore (pending or failed) must not promise it puts the change
    // back when the session ends; an active or ending one still does.
    #[test]
    fn a_stuck_gaming_mode_restore_makes_no_put_back_promise() {
        let e = entry("sysmain-disable", true, true);
        for (status, want) in [
            (SessionStatus::Active, SkipReason::AlreadySetByGamingMode),
            (SessionStatus::Ending, SkipReason::AlreadySetByGamingMode),
            (SessionStatus::RestorePending, SkipReason::AlreadySetByGamingModeRestoreUnfinished),
            (SessionStatus::RestoreFailed, SkipReason::AlreadySetByGamingModeRestoreUnfinished),
        ] {
            let w = WhoSetIt {
                gaming_mode_restore_unfinished: session_restore_unfinished(status),
                ..who(set(&[]), set(&["sysmain-disable"]))
            };
            assert_eq!(scr(&e, true, &w).reason, Some(want), "{status:?}");
        }
        let w = WhoSetIt { gaming_mode_restore_unfinished: true, ..who(set(&[]), set(&["sysmain-disable"])) };
        assert_eq!(
            serde_json::to_value(scr(&e, true, &w)).unwrap()["reason"],
            "already-set-by-gaming-mode-restore-unfinished"
        );
        // A change the stuck session doesn't hold is unaffected by its status.
        assert_eq!(scr(&entry("game-mode", true, true), true, &w).reason, Some(SkipReason::AlreadySet));
    }

    #[test]
    fn advice_only_change_fails_the_safety_filter() {
        let c = scr(&entry("hdr-advisory", true, false), false, &nobody());
        assert_eq!(c.reason, Some(SkipReason::NoSafeApply));
        assert!(!c.passes);
    }

    #[test]
    fn a_ledger_row_alone_does_not_hide_a_change_windows_reads_as_unset() {
        // Compy's row says applied but the live read says off (Windows set it back): still testable,
        // exactly as the picker treated it before this filter.
        let c = scr(&entry("game-mode", true, false), true, &who(set(&["game-mode"]), set(&[])));
        assert!(c.passes);
    }

    #[test]
    fn ledger_attribution_uses_the_shared_active_change_rule() {
        let on = Some(ActiveCheck::On);
        // An apply later rolled back (that row's status is rolled_back, no live read): not Compy's.
        let rows = [row("game-bar-disable", "rolled_back", "2026-10-20T10:00:00Z", None)];
        assert!(ledger_on_recs(&rows).is_empty());
        // Applied, then a NEWER apply of the same change rolled back: the older one is still on.
        let rows = [
            row("game-mode", "applied", "2026-10-20T10:00:00Z", on),
            row("game-mode", "rolled_back", "2026-10-21T10:00:00Z", None),
        ];
        assert_eq!(ledger_on_recs(&rows), set(&["game-mode"]).unwrap());
        // A row whose live check reads Off is not on; one that can't be confirmed isn't counted On.
        let rows = [
            row("visual-effects", "applied", "2026-10-20T10:00:00Z", Some(ActiveCheck::Off)),
            row("nagle-disable", "applied", "2026-10-20T10:00:00Z", Some(ActiveCheck::Unreadable)),
        ];
        assert!(ledger_on_recs(&rows).is_empty());
        assert_eq!(ledger_cant_confirm_recs(&rows), set(&["nagle-disable"]).unwrap());
    }

    // Review r1 gap: Compy applied it, its own check can't be read, and Windows reads it as set.
    // That is never "not by Compy" — whatever the session record says.
    #[test]
    fn a_cant_confirm_compy_apply_never_reads_not_by_compy() {
        let rows = [row("nagle-disable", "applied", "2026-10-20T10:00:00Z", Some(ActiveCheck::Unrecognised))];
        let w = WhoSetIt {
            ledger_on: Some(ledger_on_recs(&rows)),
            ledger_cant_confirm: ledger_cant_confirm_recs(&rows),
            gaming_mode: set(&[]),
            gaming_mode_restore_unfinished: false,
        };
        let c = scr(&entry("nagle-disable", true, true), true, &w);
        assert_eq!(c.reason, Some(SkipReason::AlreadySetUnconfirmed));
        assert_eq!(serde_json::to_value(&c).unwrap()["reason"], "already-set-unconfirmed");
        // With the session record unreadable too, it is still Compy's earlier apply, not unknown.
        let w = WhoSetIt { gaming_mode: None, ..w };
        assert_eq!(scr(&entry("nagle-disable", true, true), true, &w).reason, Some(SkipReason::AlreadySetUnconfirmed));
        // A change outside that group, with the session record unreadable, reads "couldn't check".
        assert_eq!(scr(&entry("game-mode", true, true), true, &w).reason, Some(SkipReason::AlreadySetUnchecked));
    }

    #[test]
    fn gaming_mode_session_changes_map_to_their_catalog_change() {
        let change = |rollback_action: RollbackAction, snapshot: Snapshot| SessionChange {
            label: String::new(),
            rollback_action,
            snapshot,
            elevated_restore: false,
        };
        let svc = Snapshot::Service { prior_state: "Running".into(), prior_start_mode: "Auto".into() };
        let sysmain = change(RollbackAction::ResumeServiceFromSnapshot { service: KnownService::SysMain }, svc);
        assert_eq!(session_change_rec(&sysmain), Some("sysmain-disable"));
        let pcie = change(
            RollbackAction::RestorePowerPlanSettingFromSnapshot,
            Snapshot::PowerPlanSetting {
                plan_guid: String::new(),
                subgroup_guid: PWR_SUBGROUP_PCIE.into(),
                setting_guid: String::new(),
                prior_ac_value: 1,
                prior_dc_value: 1,
            },
        );
        assert_eq!(session_change_rec(&pcie), Some("pcie-aspm-off"));
        let other = change(
            RollbackAction::RestorePowerPlanSettingFromSnapshot,
            Snapshot::PowerPlanSetting {
                plan_guid: String::new(),
                subgroup_guid: "not-a-known-subgroup".into(),
                setting_guid: String::new(),
                prior_ac_value: 1,
                prior_dc_value: 1,
            },
        );
        assert_eq!(session_change_rec(&other), None);
    }

    // GB-picker, 2026-10-23/25 owner rig: Game Bar capture and Game DVR both read 0 in Windows, so
    // the catalog's live read says applied, and the history has no game-bar row. The change is
    // correctly not offered — and now carries the reason the picker shows.
    #[test]
    fn owner_rig_game_bar_already_off_in_windows_reads_already_set() {
        let catalog = json!([
            { "id": "game-bar-disable", "title": "Disable Game Bar and Game DVR",
              "eligible": true, "currently_applied": true },
            { "id": "visual-effects", "title": "Trim Windows visual effects",
              "eligible": true, "currently_applied": false },
            { "id": "hdr-advisory", "title": "HDR", "eligible": true, "currently_applied": false },
        ]);
        let appliable = |id: &str| crate::history::is_appliable(id);
        let out = screen_catalog(&catalog, &appliable, &nobody(), None, RiskChoice::default());
        assert_eq!(out.len(), 3, "every catalog change gets an answer, none dropped");
        let by = |id: &str| out.iter().find(|c| c.id == id).unwrap();
        assert_eq!(by("game-bar-disable").reason, Some(SkipReason::AlreadySet));
        assert!(by("visual-effects").passes);
        assert_eq!(by("hdr-advisory").reason, Some(SkipReason::NoSafeApply));
    }

    #[test]
    fn serializes_kebab_case_reason_for_the_picker() {
        let c = scr(&entry("x", true, true), true, &who(set(&[]), set(&["x"])));
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["reason"], "already-set-by-gaming-mode");
        assert_eq!(v["passes"], false);
        let c = scr(&entry("x", true, true), true, &who(None, set(&[])));
        assert_eq!(serde_json::to_value(&c).unwrap()["reason"], "already-set-unchecked");
    }

    #[test]
    fn missing_eligible_defaults_to_eligible_and_bad_rows_are_skipped() {
        let catalog = json!([{ "id": "game-mode", "currently_applied": false }, { "title": "no id" }]);
        let out = screen_catalog(&catalog, &|_| true, &nobody(), None, RiskChoice::default());
        assert_eq!(out.len(), 1);
        assert!(out[0].passes);
        assert_eq!(out[0].title, "game-mode");
    }

    fn ranked_entry<'a>(id: &'a str, provenance: &'a str, severity: &'a str) -> Value {
        json!({ "id": id, "title": id, "eligible": true, "currently_applied": false,
                "provenance": provenance, "severity": severity })
    }

    // P4-rank §3.7/§4: the catalog order put an unmeasured moderate-risk change first; the suggested
    // order puts measured evidence first, then lower risk, then catalog order, and numbers it.
    #[test]
    fn passing_changes_are_ordered_by_evidence_then_risk_then_catalog_order() {
        let catalog = json!([
            ranked_entry("a-unmeasured-moderate", "expected-impact", "moderate"),
            { "id": "skipped", "title": "skipped", "eligible": false },
            ranked_entry("b-unmeasured-safe", "expected-impact", "safe"),
            ranked_entry("c-measured-moderate", "measured-signal", "moderate"),
            ranked_entry("d-verified-safe", "verified", "safe"),
            ranked_entry("e-measured-safe", "measured-signal", "safe"),
            ranked_entry("f-unknown", "something-new", "high"),
        ]);
        let out = screen_catalog(&catalog, &|_| true, &nobody(), None, RiskChoice::default());
        let order: Vec<(&str, Option<u32>)> = out.iter().map(|c| (c.id.as_str(), c.position)).collect();
        assert_eq!(
            order,
            vec![
                ("d-verified-safe", Some(1)),
                ("e-measured-safe", Some(2)),
                ("c-measured-moderate", Some(3)),
                ("b-unmeasured-safe", Some(4)),
                ("a-unmeasured-moderate", Some(5)),
                ("f-unknown", Some(6)),
                ("skipped", None),
            ]
        );
        let v = serde_json::to_value(&out[2]).unwrap();
        assert_eq!((v["evidence"].as_str(), v["risk"].as_str()), (Some("measured"), Some("moderate")));
        assert_eq!(out[5].evidence, Evidence::Unknown);
        assert_eq!(out[5].risk, Risk::Unknown);
    }

    // §3.5: "too small to measure here" needs BOTH a stated effect and a measured band; without
    // either the change stays listed with its effect unknown — never estimated.
    #[test]
    fn too_small_to_measure_needs_a_stated_effect_and_a_measured_band() {
        let mut e = entry("visual-effects", true, false);
        // No stated effect, measured band: kept, effect unknown.
        let c = screen(&e, true, &nobody(), Some(4.0), RiskChoice::default());
        assert!(c.passes);
        assert_eq!(c.stated_effect_pct, None);
        // Stated effect inside the band: left out, with both numbers.
        e.stated_effect_pct = Some(3.0);
        let c = screen(&e, true, &nobody(), Some(4.0), RiskChoice::default());
        assert_eq!(c.reason, Some(SkipReason::TooSmallToMeasureHere));
        assert_eq!(c.too_small, Some(EffectVsBand { effect_pct: 3.0, band_pct: 4.0 }));
        assert_eq!(serde_json::to_value(&c).unwrap()["reason"], "too-small-to-measure-here");
        // Equal to the band can't beat it either.
        assert_eq!(screen(&e, true, &nobody(), Some(3.0), RiskChoice::default()).reason, Some(SkipReason::TooSmallToMeasureHere));
        // Bigger than the band: kept.
        assert!(screen(&e, true, &nobody(), Some(2.0), RiskChoice::default()).passes);
        // Band not measured: kept, whatever the stated effect.
        let c = screen(&e, true, &nobody(), None, RiskChoice::default());
        assert!(c.passes);
        assert_eq!(c.too_small, None);
        // An earlier filter's reason wins and carries no effect/band pair.
        let c = screen(&e, false, &nobody(), Some(4.0), RiskChoice::default());
        assert_eq!((c.reason, c.too_small), (Some(SkipReason::NoSafeApply), None));
        // A nonsense stated effect is unknown, not a number.
        e.stated_effect_pct = Some(f64::NAN);
        assert!(screen(&e, true, &nobody(), Some(4.0), RiskChoice::default()).passes);
    }

    // The live catalog states no effect size for any change, so the band is never read and no
    // change is ever called too small to measure here.
    #[test]
    fn the_live_catalog_states_no_effect_size() {
        let catalog = serde_json::to_value(crate::recommendations::get_recommendations()).unwrap();
        assert!(!any_stated_effect(&catalog));
        assert!(any_stated_effect(&json!([{ "id": "x", "expected_low1_pct": 2.5 }])));
        let out = screen_catalog(&catalog, &|_| true, &nobody(), Some(50.0), RiskChoice::default());
        assert!(out.iter().all(|c| c.reason != Some(SkipReason::TooSmallToMeasureHere)));
    }

    // RISK_MODEL §2: "Low risk only" keeps `safe` changes and leaves moderate and unknown ones out
    // with their own reason; "Low and moderate" (the default) is today's behaviour.
    #[test]
    fn risk_choice_low_only_leaves_out_moderate_and_unknown() {
        let mut e = entry("visual-effects", true, false);
        let by = |e: &CatalogEntry, c: RiskChoice| screen(e, true, &nobody(), None, c);
        for (sev, low_only_passes) in [(Some("safe"), true), (Some("moderate"), false), (None, false), (Some("odd"), false)] {
            e.severity = sev;
            let c = by(&e, RiskChoice::LowOnly);
            assert_eq!(c.passes, low_only_passes, "{sev:?}");
            assert_eq!(c.reason, (!low_only_passes).then_some(SkipReason::OutsideChosenRisk), "{sev:?}");
            assert!(by(&e, RiskChoice::LowAndModerate).passes, "{sev:?} under the default");
        }
        assert_eq!(RiskChoice::default(), RiskChoice::LowAndModerate);
        e.severity = Some("moderate");
        let v = serde_json::to_value(by(&e, RiskChoice::LowOnly)).unwrap();
        assert_eq!(v["reason"], "outside-chosen-risk");
        assert_eq!(v["risk"], "moderate");
    }

    // The risk choice is checked last: a change that fails an earlier filter keeps that reason.
    #[test]
    fn risk_choice_never_hides_an_earlier_reason() {
        let mut e = entry("visual-effects", false, false);
        e.severity = Some("moderate");
        assert_eq!(screen(&e, true, &nobody(), None, RiskChoice::LowOnly).reason, Some(SkipReason::NotForThisPc));
        e.eligible = true;
        assert_eq!(screen(&e, false, &nobody(), None, RiskChoice::LowOnly).reason, Some(SkipReason::NoSafeApply));
        e.currently_applied = true;
        assert_eq!(screen(&e, true, &nobody(), None, RiskChoice::LowOnly).reason, Some(SkipReason::AlreadySet));
    }

    // The UI sends the choice in kebab-case; a missing choice is the default.
    #[test]
    fn risk_choice_reads_the_ui_words() {
        let c: RiskChoice = serde_json::from_value(json!("low-only")).unwrap();
        assert_eq!(c, RiskChoice::LowOnly);
        let c: RiskChoice = serde_json::from_value(json!("low-and-moderate")).unwrap();
        assert_eq!(c, RiskChoice::LowAndModerate);
        assert!(serde_json::from_value::<RiskChoice>(json!("aggressive")).is_err());
        let none: Option<RiskChoice> = serde_json::from_value(json!(null)).unwrap();
        assert_eq!(none.unwrap_or_default(), RiskChoice::LowAndModerate);
    }

    // On the live catalog, "Low risk only" lists only `safe` changes, and every change it leaves
    // out for risk is one the default lists.
    #[test]
    fn live_catalog_under_low_only() {
        let catalog = serde_json::to_value(crate::recommendations::get_recommendations()).unwrap();
        let low = screen_catalog(&catalog, &|_| true, &nobody(), None, RiskChoice::LowOnly);
        let all = screen_catalog(&catalog, &|_| true, &nobody(), None, RiskChoice::default());
        assert!(low.iter().filter(|c| c.passes).all(|c| c.risk == Risk::Low));
        for c in low.iter().filter(|c| c.reason == Some(SkipReason::OutsideChosenRisk)) {
            assert!(all.iter().any(|a| a.id == c.id && a.passes), "{}", c.id);
        }
    }
}
