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
//! aren't listed" with this reason. "Already set" also says whether Compy set it (the ledger has an
//! active row) or Windows already had it that way — on the owner rig Game Bar was already off in
//! Windows (`AppCaptureEnabled` = 0, `GameDVR_Enabled` = 0, no Compy row), which is why the picker
//! never offered `game-bar-disable` (GB-picker) — correct, but it gave no reason.

use serde::Serialize;
use serde_json::Value;
use std::collections::HashSet;

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SkipReason {
    /// §3.1: this PC's hardware can't use it.
    NotForThisPc,
    /// §3.2: Windows already has it set this way, and not through Compy.
    AlreadySet,
    /// §3.2: already set, and the Trust Ledger shows Compy set it.
    AlreadySetByCompy,
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

/// One change through §3.1–3.3. Pure.
pub(crate) fn screen(entry: &CatalogEntry, appliable: bool, compy_active: bool) -> TrialCandidate {
    let (reason, detail) = if !entry.eligible {
        (
            Some(SkipReason::NotForThisPc),
            entry.ineligible_reason.filter(|s| !s.is_empty()).map(str::to_string),
        )
    } else if entry.currently_applied {
        (
            Some(if compy_active { SkipReason::AlreadySetByCompy } else { SkipReason::AlreadySet }),
            None,
        )
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
    compy_active: &HashSet<String>,
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
            Some(screen(&entry, appliable(id), compy_active.contains(id)))
        })
        .collect()
}

/// Rec ids whose newest ledger row is still applied — the same rule as `history::rec_is_active`,
/// read once for the whole catalog.
fn compy_active_ids() -> HashSet<String> {
    let mut seen = HashSet::new();
    let mut active = HashSet::new();
    for c in crate::history::load_history().unwrap_or_default().iter().rev() {
        if seen.insert(c.rec_id.clone()) && c.status == "applied" {
            active.insert(c.rec_id.clone());
        }
    }
    active
}

/// Every catalog change with its pass/fail for the Trial picker. Read-only.
#[tauri::command]
pub(crate) fn get_trial_candidates() -> Vec<TrialCandidate> {
    let catalog = serde_json::to_value(crate::recommendations::get_recommendations()).unwrap_or(Value::Null);
    screen_catalog(&catalog, &crate::history::is_appliable, &compy_active_ids())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry<'a>(id: &'a str, eligible: bool, applied: bool) -> CatalogEntry<'a> {
        CatalogEntry { id, title: id, eligible, ineligible_reason: None, currently_applied: applied }
    }

    #[test]
    fn a_change_that_applies_is_unset_and_appliable_passes() {
        let c = screen(&entry("game-mode", true, false), true, false);
        assert!(c.passes);
        assert_eq!(c.reason, None);
    }

    #[test]
    fn hardware_mismatch_fails_first_with_the_catalog_reason() {
        let mut e = entry("eee-disable", false, true);
        e.ineligible_reason = Some("No wired Ethernet port on this PC.");
        // Fails all three; the reason is the FIRST filter (§3.1), not a later one.
        let c = screen(&e, false, true);
        assert!(!c.passes);
        assert_eq!(c.reason, Some(SkipReason::NotForThisPc));
        assert_eq!(c.detail.as_deref(), Some("No wired Ethernet port on this PC."));
    }

    #[test]
    fn already_set_in_windows_is_told_apart_from_set_by_compy() {
        let windows = screen(&entry("game-bar-disable", true, true), true, false);
        assert_eq!(windows.reason, Some(SkipReason::AlreadySet));
        let compy = screen(&entry("game-bar-disable", true, true), true, true);
        assert_eq!(compy.reason, Some(SkipReason::AlreadySetByCompy));
        assert!(!windows.passes && !compy.passes);
    }

    #[test]
    fn advice_only_change_fails_the_safety_filter() {
        let c = screen(&entry("hdr-advisory", true, false), false, false);
        assert_eq!(c.reason, Some(SkipReason::NoSafeApply));
        assert!(!c.passes);
    }

    #[test]
    fn a_ledger_row_alone_does_not_hide_a_change_windows_reads_as_unset() {
        // Compy's row says applied but the live read says off (Windows set it back): still testable,
        // exactly as the picker treated it before this filter.
        let c = screen(&entry("game-mode", true, false), true, true);
        assert!(c.passes);
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
        let out = screen_catalog(&catalog, &appliable, &HashSet::new());
        assert_eq!(out.len(), 3, "every catalog change gets an answer, none dropped");
        assert_eq!(out[0].reason, Some(SkipReason::AlreadySet));
        assert!(out[1].passes);
        assert_eq!(out[2].reason, Some(SkipReason::NoSafeApply));
    }

    #[test]
    fn serializes_kebab_case_reason_for_the_picker() {
        let c = screen(&entry("x", true, true), true, false);
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["reason"], "already-set");
        assert_eq!(v["passes"], false);
    }

    #[test]
    fn missing_eligible_defaults_to_eligible_and_bad_rows_are_skipped() {
        let catalog = json!([{ "id": "game-mode", "currently_applied": false }, { "title": "no id" }]);
        let out = screen_catalog(&catalog, &|_| true, &HashSet::new());
        assert_eq!(out.len(), 1);
        assert!(out[0].passes);
        assert_eq!(out[0].title, "game-mode");
    }
}
