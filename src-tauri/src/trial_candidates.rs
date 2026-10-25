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

use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

use crate::actions::{KnownService, RollbackAction, Snapshot, PWR_SUBGROUP_PCIE, PWR_SUBGROUP_USB};
use crate::gaming_session::SessionChange;
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
    /// §3.2: already set, but the ledger or the session contract couldn't be read, so Compy can't
    /// say whether it made the change.
    AlreadySetUnchecked,
    /// §3.3: Compy has no audited one-click change for it (advice only), so it can't be tested.
    NoSafeApply,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct TrialCandidate {
    pub id: String,
    pub title: String,
    pub passes: bool,
    pub reason: Option<SkipReason>,
    /// The catalog's own words for a hardware mismatch (`ineligible_reason`), when it has them.
    pub detail: Option<String>,
}

/// The catalog fields the filter reads.
pub(crate) struct CatalogEntry<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub eligible: bool,
    pub ineligible_reason: Option<&'a str>,
    pub currently_applied: bool,
}

/// Which already-set changes Compy is behind. `None` = that record couldn't be read.
pub(crate) struct WhoSetIt {
    /// Changes the ledger's shared active-change rule reads On.
    pub ledger_on: Option<HashSet<String>>,
    /// Changes the live Gaming Mode session contract holds (empty when no session is running).
    pub gaming_mode: Option<HashSet<String>>,
}

impl WhoSetIt {
    fn already_set_reason(&self, id: &str) -> SkipReason {
        let has = |s: &Option<HashSet<String>>| s.as_ref().map(|s| s.contains(id));
        match (has(&self.gaming_mode), has(&self.ledger_on)) {
            (Some(true), _) => SkipReason::AlreadySetByGamingMode,
            (_, Some(true)) => SkipReason::AlreadySetByCompy,
            (Some(false), Some(false)) => SkipReason::AlreadySet,
            // One of the two records couldn't be read and the other doesn't name it.
            _ => SkipReason::AlreadySetUnchecked,
        }
    }
}

/// One change through §3.1–3.3. Pure.
pub(crate) fn screen(entry: &CatalogEntry, appliable: bool, who: &WhoSetIt) -> TrialCandidate {
    let (reason, detail) = if !entry.eligible {
        (
            Some(SkipReason::NotForThisPc),
            entry.ineligible_reason.filter(|s| !s.is_empty()).map(str::to_string),
        )
    } else if entry.currently_applied {
        (Some(who.already_set_reason(entry.id)), None)
    } else if !appliable {
        (Some(SkipReason::NoSafeApply), None)
    } else {
        (None, None)
    };
    TrialCandidate {
        id: entry.id.to_string(),
        title: entry.title.to_string(),
        passes: reason.is_none(),
        reason,
        detail,
    }
}

/// The whole catalog (as `get_recommendations` serializes it), in catalog order. Pure.
pub(crate) fn screen_catalog(
    catalog: &Value,
    appliable: &dyn Fn(&str) -> bool,
    who: &WhoSetIt,
) -> Vec<TrialCandidate> {
    let Some(rows) = catalog.as_array() else { return Vec::new() };
    rows.iter()
        .filter_map(|r| {
            let id = r.get("id")?.as_str()?;
            let entry = CatalogEntry {
                id,
                title: r.get("title").and_then(Value::as_str).unwrap_or(id),
                // Missing `eligible` is the serde default (true), as the catalog itself reads it.
                eligible: r.get("eligible").and_then(Value::as_bool).unwrap_or(true),
                ineligible_reason: r.get("ineligible_reason").and_then(Value::as_str),
                currently_applied: r.get("currently_applied").and_then(Value::as_bool).unwrap_or(false),
            };
            Some(screen(&entry, appliable(id), who))
        })
        .collect()
}

/// The changes the shared active-change rule (`history::live_change_groups`, 453-f1) reads On —
/// the same set Health, Optimize, History and the session count use. Pure over the rows' live checks.
pub(crate) fn ledger_on_recs(rows: &[LiveRow<'_>]) -> HashSet<String> {
    crate::history::live_change_groups(rows)
        .into_iter()
        .filter(|&i| rows[i].check == Some(ActiveCheck::On))
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
        _ => return None,
    })
}

fn read_ledger_on() -> Option<HashSet<String>> {
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
    Some(ledger_on_recs(&rows))
}

fn read_gaming_mode() -> Option<HashSet<String>> {
    use crate::gaming_session::{load_session, read_session_slot, SessionSlot};
    match read_session_slot() {
        SessionSlot::Empty => Some(HashSet::new()),
        SessionSlot::Unreadable => None,
        SessionSlot::Loaded => {
            let f = load_session()?;
            Some(f.changes.iter().filter_map(session_change_rec).map(str::to_string).collect())
        }
    }
}

/// Every catalog change with its pass/fail for the Trial picker. Read-only.
#[tauri::command]
pub(crate) fn get_trial_candidates() -> Vec<TrialCandidate> {
    let catalog = serde_json::to_value(crate::recommendations::get_recommendations()).unwrap_or(Value::Null);
    let who = WhoSetIt { ledger_on: read_ledger_on(), gaming_mode: read_gaming_mode() };
    screen_catalog(&catalog, &crate::history::is_appliable, &who)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry<'a>(id: &'a str, eligible: bool, applied: bool) -> CatalogEntry<'a> {
        CatalogEntry { id, title: id, eligible, ineligible_reason: None, currently_applied: applied }
    }
    fn set(ids: &[&str]) -> Option<HashSet<String>> {
        Some(ids.iter().map(|s| s.to_string()).collect())
    }
    fn who(ledger: Option<HashSet<String>>, gaming: Option<HashSet<String>>) -> WhoSetIt {
        WhoSetIt { ledger_on: ledger, gaming_mode: gaming }
    }
    fn nobody() -> WhoSetIt {
        who(set(&[]), set(&[]))
    }
    fn row<'a>(rec: &'a str, status: &'a str, at: &'a str, check: Option<ActiveCheck>) -> LiveRow<'a> {
        LiveRow { rec_id: rec, status, applied_at: at, check }
    }

    #[test]
    fn a_change_that_applies_is_unset_and_appliable_passes() {
        let c = screen(&entry("game-mode", true, false), true, &nobody());
        assert!(c.passes);
        assert_eq!(c.reason, None);
    }

    #[test]
    fn hardware_mismatch_fails_first_with_the_catalog_reason() {
        let mut e = entry("eee-disable", false, true);
        e.ineligible_reason = Some("No wired Ethernet port on this PC.");
        // Fails all three; the reason is the FIRST filter (§3.1), not a later one.
        let c = screen(&e, false, &who(set(&["eee-disable"]), set(&[])));
        assert!(!c.passes);
        assert_eq!(c.reason, Some(SkipReason::NotForThisPc));
        assert_eq!(c.detail.as_deref(), Some("No wired Ethernet port on this PC."));
    }

    #[test]
    fn already_set_says_who_set_it() {
        let e = entry("sysmain-disable", true, true);
        let r = |w: &WhoSetIt| screen(&e, true, w).reason;
        assert_eq!(r(&nobody()), Some(SkipReason::AlreadySet));
        assert_eq!(r(&who(set(&["sysmain-disable"]), set(&[]))), Some(SkipReason::AlreadySetByCompy));
        // Gaming Mode suspends SysMain for a session (gaming_orchestrator): Compy, not Windows.
        assert_eq!(r(&who(set(&[]), set(&["sysmain-disable"]))), Some(SkipReason::AlreadySetByGamingMode));
        assert!(!screen(&e, true, &nobody()).passes);
    }

    #[test]
    fn an_unreadable_record_never_reads_as_not_by_compy() {
        let e = entry("game-bar-disable", true, true);
        let r = |w: &WhoSetIt| screen(&e, true, w).reason;
        assert_eq!(r(&who(None, set(&[]))), Some(SkipReason::AlreadySetUnchecked), "ledger unreadable");
        assert_eq!(r(&who(set(&[]), None)), Some(SkipReason::AlreadySetUnchecked), "session unreadable");
        assert_eq!(r(&who(None, None)), Some(SkipReason::AlreadySetUnchecked));
        // A record that CAN be read and names it still attributes it.
        assert_eq!(r(&who(None, set(&["game-bar-disable"]))), Some(SkipReason::AlreadySetByGamingMode));
        assert_eq!(r(&who(set(&["game-bar-disable"]), None)), Some(SkipReason::AlreadySetByCompy));
    }

    #[test]
    fn advice_only_change_fails_the_safety_filter() {
        let c = screen(&entry("hdr-advisory", true, false), false, &nobody());
        assert_eq!(c.reason, Some(SkipReason::NoSafeApply));
        assert!(!c.passes);
    }

    #[test]
    fn a_ledger_row_alone_does_not_hide_a_change_windows_reads_as_unset() {
        // Compy's row says applied but the live read says off (Windows set it back): still testable,
        // exactly as the picker treated it before this filter.
        let c = screen(&entry("game-mode", true, false), true, &who(set(&["game-mode"]), set(&[])));
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
        let out = screen_catalog(&catalog, &appliable, &nobody());
        assert_eq!(out.len(), 3, "every catalog change gets an answer, none dropped");
        assert_eq!(out[0].reason, Some(SkipReason::AlreadySet));
        assert!(out[1].passes);
        assert_eq!(out[2].reason, Some(SkipReason::NoSafeApply));
    }

    #[test]
    fn serializes_kebab_case_reason_for_the_picker() {
        let c = screen(&entry("x", true, true), true, &who(set(&[]), set(&["x"])));
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["reason"], "already-set-by-gaming-mode");
        assert_eq!(v["passes"], false);
        let c = screen(&entry("x", true, true), true, &who(None, set(&[])));
        assert_eq!(serde_json::to_value(&c).unwrap()["reason"], "already-set-unchecked");
    }

    #[test]
    fn missing_eligible_defaults_to_eligible_and_bad_rows_are_skipped() {
        let catalog = json!([{ "id": "game-mode", "currently_applied": false }, { "title": "no id" }]);
        let out = screen_catalog(&catalog, &|_| true, &nobody());
        assert_eq!(out.len(), 1);
        assert!(out[0].passes);
        assert_eq!(out[0].title, "game-mode");
    }
}
