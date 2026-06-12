//! Priority Ranking (F4): READ-ONLY / advisory. Composes existing signals
//! (readiness, recommendations, startup, last session) into a transparent,
//! rule-ordered "what matters most for this rig" view — three buckets, no
//! magic score. It mutates nothing, adds no detection, and recommends nothing
//! of its own. `build_priorities` is pure (over serialized JSON) and tested.

use serde::Serialize;
use serde_json::Value;

use crate::history::APPLIABLE_REC_IDS;

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Confidence {
    High,
    Medium,
    Low,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum PriorityStatus {
    Ready,
    Attention,
    Unknown,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct PriorityItem {
    id: &'static str,
    title: String,
    reason: String,
    /// rec_id or readiness-check id this row links to, if any.
    linked: Option<String>,
    confidence: Confidence,
    status: PriorityStatus,
}

#[derive(Serialize, Debug)]
pub(crate) struct Priorities {
    limiters: Vec<PriorityItem>,
    already_fine: Vec<PriorityItem>,
    not_worth_touching: Vec<PriorityItem>,
    /// Conservative per-session hint, only when a real F3 session exists.
    session_hint: Option<String>,
    /// R3 Lane B: advisory upgrade-path block — present ONLY when a verdict
    /// already names hardware as the limiter. Never invents a detection.
    upgrade_path: Option<UpgradePath>,
}

// ── Upgrade path (R3 Lane B — advisory-only, doctrine money stack #1 groundwork) ──────────────
//
// THE single retailer-link table. Plain SEARCH links — no affiliate tags, no tracking params.
// A later affiliate-tag swap happens HERE and nowhere else (the frontend + the export both render
// from this module via the Priorities payload / build_upgrade_path — one source, no drift).
// Rust-side on purpose: exported reports must never render link URLs that came from the webview.

#[derive(Serialize, Clone, Copy, Debug)]
pub(crate) struct RetailLink {
    pub(crate) retailer: &'static str,
    pub(crate) url: &'static str,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct UpgradeSuggestion {
    /// "gpu" | "ssd" — stable key for the UI.
    pub(crate) kind: &'static str,
    pub(crate) title: &'static str,
    /// Time-and-sample-qualified reason derived from the measured signal (receipts law).
    pub(crate) why: String,
    pub(crate) links: &'static [RetailLink],
}

#[derive(Serialize, Debug)]
pub(crate) struct UpgradePath {
    pub(crate) items: Vec<UpgradeSuggestion>,
    /// Mandatory — renders wherever the links render, no exceptions.
    pub(crate) disclosure: &'static str,
}

pub(crate) const AFFILIATE_DISCLOSURE: &str =
    "If you buy through Compy links we may earn a commission — it never affects verdicts.";

const GPU_LINKS: &[RetailLink] = &[
    RetailLink { retailer: "Amazon", url: "https://www.amazon.com/s?k=graphics+card" },
    RetailLink { retailer: "Newegg", url: "https://www.newegg.com/p/pl?d=graphics+card" },
];
const SSD_LINKS: &[RetailLink] = &[
    RetailLink { retailer: "Amazon", url: "https://www.amazon.com/s?k=nvme+ssd" },
    RetailLink { retailer: "Newegg", url: "https://www.newegg.com/p/pl?d=nvme+ssd" },
];

/// One threshold for "this session looked GPU-limited", shared by the session hint and the
/// upgrade path so the two can never disagree.
const GPU_LIMITED_PCT: u64 = 95;

/// Peak GPU usage of the most recent session, only when it crosses the GPU-limited threshold.
fn gpu_limited_pct(sessions: &Value) -> Option<u64> {
    let s = sessions.as_array().and_then(|a| a.first())?;
    let gpu = s.get("peak_gpu_usage_pct").and_then(Value::as_u64)?;
    (gpu >= GPU_LIMITED_PCT).then_some(gpu)
}

/// Qualifying rows ONLY (right-room law): (1) the conservative GPU-limited session verdict,
/// (2) the install-drive HDD readiness attention. Anything else → None (no block at all).
pub(crate) fn build_upgrade_path(readiness: &Value, sessions: &Value) -> Option<UpgradePath> {
    let mut items = Vec::new();
    if let Some(gpu) = gpu_limited_pct(sessions) {
        items.push(UpgradeSuggestion {
            kind: "gpu",
            title: "GPU was the measured limiter",
            why: format!(
                "In your most recent monitored session, GPU usage peaked very high (~{gpu}%) — \
                 the GPU was the bottleneck in that session. If you want more headroom, a GPU \
                 upgrade is the hardware lever; no Windows tweak changes this."
            ),
            links: GPU_LINKS,
        });
    }
    if let Some((st, _, _)) = check(readiness, "install-drive") {
        if status_from(&st) == PriorityStatus::Attention {
            items.push(UpgradeSuggestion {
                kind: "ssd",
                title: "Games are on an HDD",
                why: "Your game install drive check found HDD storage — load times and texture \
                      streaming are hardware-limited there. An SSD/NVMe drive is the fix Compy \
                      can't apply for you."
                    .into(),
                links: SSD_LINKS,
            });
        }
    }
    (!items.is_empty()).then_some(UpgradePath { items, disclosure: AFFILIATE_DISCLOSURE })
}

#[derive(Clone, Copy)]
enum Bucket {
    Limiter(u8),
    Fine,
    NotWorth,
}

fn status_from(s: &str) -> PriorityStatus {
    match s {
        "ready" => PriorityStatus::Ready,
        "attention" => PriorityStatus::Attention,
        _ => PriorityStatus::Unknown,
    }
}

fn actionable_bucket(status: PriorityStatus, rank: u8) -> Bucket {
    match status {
        PriorityStatus::Attention => Bucket::Limiter(rank),
        PriorityStatus::Ready => Bucket::Fine,
        PriorityStatus::Unknown => Bucket::NotWorth,
    }
}

/// Locate a readiness check by id → (status, label, detail).
fn check(readiness: &Value, id: &str) -> Option<(String, String, String)> {
    readiness
        .get("checks")
        .and_then(Value::as_array)
        .and_then(|arr| {
            arr.iter()
                .find(|c| c.get("id").and_then(Value::as_str) == Some(id))
                .map(|c| {
                    (
                        c.get("status").and_then(Value::as_str).unwrap_or("unknown").to_string(),
                        c.get("label").and_then(Value::as_str).unwrap_or("").to_string(),
                        c.get("detail").and_then(Value::as_str).unwrap_or("").to_string(),
                    )
                })
        })
}

/// Pure: assemble the ranked priorities from already-gathered signals.
pub(crate) fn build_priorities(
    readiness: &Value,
    recommendations: &Value,
    startup: &Value,
    sessions: &Value,
) -> Priorities {
    let mut tagged: Vec<(Bucket, PriorityItem)> = Vec::new();

    // Readiness-derived rules: (check id, rank, confidence, advisory?).
    // Advisory rows always land in "not worth touching" regardless of status.
    let readiness_rules: &[(&'static str, u8, Confidence, bool)] = &[
        ("monitor-refresh", 1, Confidence::High, false),
        ("gpu-driver-age", 3, Confidence::High, false),
        ("install-drive", 4, Confidence::Medium, false),
        ("power-profile", 5, Confidence::Medium, false),
        ("fps-monitoring", 6, Confidence::Low, false),
        ("applied-changes", 7, Confidence::High, false),
        ("hdr", 10, Confidence::Low, true),
        ("vrr", 11, Confidence::Low, true),
    ];
    for &(id, rank, conf, advisory) in readiness_rules {
        if let Some((st, label, detail)) = check(readiness, id) {
            let status = status_from(&st);
            let item = PriorityItem {
                id,
                title: if label.is_empty() { id.to_string() } else { label },
                reason: detail,
                linked: Some(id.to_string()),
                confidence: conf,
                status,
            };
            let bucket = if advisory {
                Bucket::NotWorth
            } else {
                actionable_bucket(status, rank)
            };
            tagged.push((bucket, item));
        }
    }

    // Rule 8: safe, appliable recommendations visible but not yet applied.
    {
        let recs = recommendations.as_array().map(Vec::as_slice).unwrap_or(&[]);
        let pending: Vec<&Value> = recs
            .iter()
            .filter(|r| {
                let id = r.get("id").and_then(Value::as_str).unwrap_or("");
                let applied = r.get("currently_applied").and_then(Value::as_bool).unwrap_or(false);
                let severity = r.get("severity").and_then(Value::as_str).unwrap_or("");
                APPLIABLE_REC_IDS.contains(&id) && !applied && severity == "safe"
            })
            .collect();
        if pending.is_empty() {
            tagged.push((
                Bucket::Fine,
                PriorityItem {
                    id: "pending-safe-recs",
                    title: "Safe one-click tweaks".into(),
                    reason: "No pending safe tweaks — the safe recommendations that apply to your PC are already applied, or none apply.".into(),
                    linked: None,
                    confidence: Confidence::Low,
                    status: PriorityStatus::Ready,
                },
            ));
        } else {
            let titles: Vec<&str> = pending
                .iter()
                .filter_map(|r| r.get("title").and_then(Value::as_str))
                .take(4)
                .collect();
            tagged.push((
                Bucket::Limiter(8),
                PriorityItem {
                    id: "pending-safe-recs",
                    title: format!("{} safe one-click tweak(s) not applied", pending.len()),
                    reason: format!(
                        "Compy has safe, reversible tweaks you haven't applied: {}{}.",
                        titles.join(", "),
                        if pending.len() > titles.len() { ", …" } else { "" }
                    ),
                    linked: None,
                    confidence: Confidence::Medium,
                    status: PriorityStatus::Attention,
                },
            ));
        }
    }

    // Rule 9: heavy startup load.
    {
        let entries = startup.as_array().map(Vec::as_slice).unwrap_or(&[]);
        let enabled = entries
            .iter()
            .filter(|e| e.get("enabled").and_then(Value::as_bool).unwrap_or(false))
            .count();
        if enabled >= 8 {
            tagged.push((
                Bucket::Limiter(9),
                PriorityItem {
                    id: "startup-load",
                    title: format!("{enabled} apps launch at startup"),
                    reason: "A heavy startup load uses RAM and CPU before you even open a game. Review the Startup tab and disable ones you don't need.".into(),
                    linked: None,
                    confidence: Confidence::Low,
                    status: PriorityStatus::Attention,
                },
            ));
        } else if !entries.is_empty() {
            tagged.push((
                Bucket::Fine,
                PriorityItem {
                    id: "startup-load",
                    title: "Startup load looks reasonable".into(),
                    reason: format!("{enabled} app(s) launch at startup."),
                    linked: None,
                    confidence: Confidence::Low,
                    status: PriorityStatus::Ready,
                },
            ));
        }
    }

    // Rule 12: Memory Integrity / VBS advisory (security tradeoff, never a limiter).
    {
        let recs = recommendations.as_array().map(Vec::as_slice).unwrap_or(&[]);
        if let Some(r) = recs.iter().find(|r| {
            let id = r.get("id").and_then(Value::as_str).unwrap_or("").to_lowercase();
            let title = r.get("title").and_then(Value::as_str).unwrap_or("").to_lowercase();
            id.contains("memory-integrity")
                || id.contains("vbs")
                || title.contains("memory integrity")
                || title.contains("core isolation")
                || title.contains("vbs")
        }) {
            let applied = r.get("currently_applied").and_then(Value::as_bool).unwrap_or(false);
            // Use a neutral, state-agnostic title — the recommendation's own title
            // reads "…is active", which contradicts the row when VBS is actually
            // off. Compy DOES know the state (read from the registry), so this
            // is a real, decided advisory — never "Unknown".
            tagged.push((
                Bucket::NotWorth,
                PriorityItem {
                    id: "memory-integrity",
                    title: "Memory Integrity / VBS".to_string(),
                    reason: if applied {
                        "Memory Integrity / VBS is ON. It can cost a few % in some games, but it's a security feature — advisory only, your call.".into()
                    } else {
                        "Memory Integrity / VBS is off — nothing to do. (Leaving it off can help a few games; turning it on is a security/FPS tradeoff Compy never changes for you.)".into()
                    },
                    linked: r.get("id").and_then(Value::as_str).map(str::to_string),
                    confidence: Confidence::Low,
                    status: PriorityStatus::Ready,
                },
            ));
        }
    }

    // Partition; limiters sorted by rank ascending (biggest first).
    let mut limiters_ranked: Vec<(u8, PriorityItem)> = tagged
        .iter()
        .filter_map(|(b, i)| match b {
            Bucket::Limiter(r) => Some((*r, i.clone())),
            _ => None,
        })
        .collect();
    limiters_ranked.sort_by_key(|(r, _)| *r);
    let limiters = limiters_ranked.into_iter().map(|(_, i)| i).collect();
    let already_fine = tagged
        .iter()
        .filter(|(b, _)| matches!(b, Bucket::Fine))
        .map(|(_, i)| i.clone())
        .collect();
    let not_worth_touching = tagged
        .iter()
        .filter(|(b, _)| matches!(b, Bucket::NotWorth))
        .map(|(_, i)| i.clone())
        .collect();

    Priorities {
        limiters,
        already_fine,
        not_worth_touching,
        session_hint: build_session_hint(sessions),
        upgrade_path: build_upgrade_path(readiness, sessions),
    }
}

/// Conservative GPU-vs-system hint from the most recent session, or None when
/// the signal is inconclusive. Never claims a hard CPU/GPU-bound classification.
fn build_session_hint(sessions: &Value) -> Option<String> {
    let s = sessions.as_array().and_then(|a| a.first())?;
    let gpu = s.get("peak_gpu_usage_pct").and_then(Value::as_u64)?;
    let avg = s.get("avg_fps").and_then(Value::as_f64).unwrap_or(0.0);
    let low1 = s.get("low1_fps_est").and_then(Value::as_f64).unwrap_or(0.0);
    let varied = avg > 0.0 && low1 > 0.0 && low1 < avg * 0.7;
    if gpu >= GPU_LIMITED_PCT {
        Some(format!(
            "Recent session hint: GPU usage peaked very high (~{gpu}%), so this session looked mostly GPU-limited."
        ))
    } else if gpu <= 85 {
        let ft = if varied { " and frametimes varied" } else { "" };
        Some(format!(
            "Recent session hint: GPU usage didn't saturate (~{gpu}%){ft}, so this session may be CPU/background/system-limited."
        ))
    } else {
        None // 86–94%: inconclusive — don't guess.
    }
}

#[tauri::command]
pub(crate) fn get_priorities() -> Priorities {
    let readiness =
        serde_json::to_value(crate::readiness::get_game_readiness()).unwrap_or(Value::Null);
    let recommendations =
        serde_json::to_value(crate::recommendations::get_recommendations()).unwrap_or(Value::Null);
    let startup = serde_json::to_value(crate::startup_entries()).unwrap_or(Value::Null);
    let sessions =
        serde_json::to_value(crate::sessions::get_session_summaries()).unwrap_or(Value::Null);
    build_priorities(&readiness, &recommendations, &startup, &sessions)
}

#[cfg(test)]
mod priority_tests {
    use super::*;
    use serde_json::json;

    fn chk(id: &str, status: &str) -> Value {
        json!({ "id": id, "status": status, "label": id, "detail": "reason text", "value": null })
    }
    fn readiness(checks: Vec<Value>) -> Value {
        json!({ "ready_count": 0, "attention_count": 0, "unknown_count": 0, "advisory": "adv", "checks": checks })
    }
    fn rec(id: &str, applied: bool, severity: &str) -> Value {
        json!({ "id": id, "title": id, "currently_applied": applied, "severity": severity })
    }
    fn limiter_ids(p: &Priorities) -> Vec<&str> {
        p.limiters.iter().map(|i| i.id).collect()
    }

    #[test]
    fn null_and_garbage_signals_yield_empty_buckets_never_a_panic() {
        // Edge (R2-4): the pure builder over completely absent inputs must not panic and must
        // not FABRICATE a limiter — empty signals are an empty (honest) ranking.
        let p = build_priorities(&Value::Null, &Value::Null, &Value::Null, &Value::Null);
        assert!(p.limiters.is_empty(), "no signals → no invented limiters");
        assert!(p.session_hint.is_none());
        // Wrong-shaped inputs (arrays/strings/numbers where objects belong) degrade identically.
        let p = build_priorities(&json!([1, 2, 3]), &json!("nope"), &json!(42), &json!({}));
        assert!(p.limiters.is_empty());
    }

    #[test]
    fn ranking_with_no_sessions_has_no_hint() {
        let p = build_priorities(&readiness(vec![chk("monitor-refresh", "attention")]), &json!([]), &json!([]), &json!([]));
        assert!(p.session_hint.is_none());
        assert_eq!(limiter_ids(&p), vec!["monitor-refresh"]);
    }

    #[test]
    fn ranking_with_a_session_emits_conservative_hint() {
        let sessions = json!([{ "peak_gpu_usage_pct": 98, "avg_fps": 120.0, "low1_fps_est": 100.0 }]);
        let p = build_priorities(&readiness(vec![]), &json!([]), &json!([]), &sessions);
        let hint = p.session_hint.expect("hint present");
        assert!(hint.contains("GPU-limited"));
    }

    // ── Upgrade path (R3 Lane B) — qualifying logic pinned ──

    #[test]
    fn upgrade_path_absent_without_a_hardware_verdict() {
        // No signals, software-only attention rows, inconclusive GPU — all → NO block at all.
        let p = build_priorities(&Value::Null, &Value::Null, &Value::Null, &Value::Null);
        assert!(p.upgrade_path.is_none(), "no signals → no upgrade path");
        let software = readiness(vec![chk("power-profile", "attention"), chk("gpu-driver-age", "attention")]);
        let p = build_priorities(&software, &json!([]), &json!([]), &json!([]));
        assert!(p.upgrade_path.is_none(), "software limiters must never grow retail links");
        let inconclusive = json!([{ "peak_gpu_usage_pct": 90, "avg_fps": 100.0, "low1_fps_est": 90.0 }]);
        assert!(build_upgrade_path(&readiness(vec![]), &inconclusive).is_none(), "86–94% stays inconclusive");
    }

    #[test]
    fn gpu_limited_session_qualifies_for_the_gpu_upgrade_row() {
        let sessions = json!([{ "peak_gpu_usage_pct": 98, "avg_fps": 120.0, "low1_fps_est": 100.0 }]);
        let up = build_upgrade_path(&readiness(vec![]), &sessions).expect("qualifies");
        assert_eq!(up.items.len(), 1);
        assert_eq!(up.items[0].kind, "gpu");
        assert!(up.items[0].why.contains("~98%"), "why is sample-qualified with the measured peak");
        assert!(up.items[0].why.contains("most recent monitored session"), "why is time-qualified");
        assert!(!up.items[0].links.is_empty());
        assert!(up.items[0].links.iter().all(|l| !l.url.contains("tag=") && !l.url.contains("affiliate")),
            "plain search links only — no affiliate tags until the owner has accounts");
    }

    #[test]
    fn hdd_install_drive_qualifies_for_the_ssd_upgrade_row() {
        let r = readiness(vec![chk("install-drive", "attention")]);
        let up = build_upgrade_path(&r, &json!([])).expect("qualifies");
        assert_eq!(up.items.len(), 1);
        assert_eq!(up.items[0].kind, "ssd");
        // Ready install-drive must NOT qualify.
        let fine = readiness(vec![chk("install-drive", "ready")]);
        assert!(build_upgrade_path(&fine, &json!([])).is_none());
    }

    #[test]
    fn upgrade_path_always_carries_the_disclosure() {
        let sessions = json!([{ "peak_gpu_usage_pct": 99 }]);
        let r = readiness(vec![chk("install-drive", "attention")]);
        let up = build_upgrade_path(&r, &sessions).expect("both qualify");
        assert_eq!(up.items.len(), 2);
        assert_eq!(up.disclosure, AFFILIATE_DISCLOSURE);
        assert!(up.disclosure.contains("never affects verdicts"));
    }

    #[test]
    fn monitor_refresh_issue_ranks_highest() {
        let r = readiness(vec![chk("monitor-refresh", "attention"), chk("gpu-driver-age", "attention")]);
        let p = build_priorities(&r, &json!([]), &json!([]), &json!([]));
        assert_eq!(p.limiters.first().unwrap().id, "monitor-refresh");
    }

    #[test]
    fn stale_driver_ranks_above_pending_recs() {
        // monitor ok (Ready), driver stale (rank 3), pending safe rec (rank 8).
        let r = readiness(vec![chk("monitor-refresh", "ready"), chk("gpu-driver-age", "attention")]);
        let recs = json!([rec("game-mode", false, "safe")]);
        let p = build_priorities(&r, &recs, &json!([]), &json!([]));
        let ids = limiter_ids(&p);
        let driver = ids.iter().position(|x| *x == "gpu-driver-age");
        let pending = ids.iter().position(|x| *x == "pending-safe-recs");
        assert!(driver.is_some() && pending.is_some() && driver < pending);
    }

    #[test]
    fn externally_reverted_change_ranks_above_pending_recs() {
        let r = readiness(vec![chk("applied-changes", "attention")]);
        let recs = json!([rec("game-mode", false, "safe")]);
        let p = build_priorities(&r, &recs, &json!([]), &json!([]));
        let ids = limiter_ids(&p);
        assert_eq!(ids.first().copied(), Some("applied-changes"));
        assert!(ids.contains(&"pending-safe-recs"));
        assert!(ids.iter().position(|x| *x == "applied-changes") < ids.iter().position(|x| *x == "pending-safe-recs"));
    }

    #[test]
    fn already_fine_bucket_fills_from_ready_checks() {
        let r = readiness(vec![chk("monitor-refresh", "ready"), chk("power-profile", "ready")]);
        let p = build_priorities(&r, &json!([]), &json!([]), &json!([]));
        let fine: Vec<&str> = p.already_fine.iter().map(|i| i.id).collect();
        assert!(fine.contains(&"monitor-refresh"));
        assert!(fine.contains(&"power-profile"));
    }

    #[test]
    fn advisories_go_to_not_worth_touching() {
        let r = readiness(vec![chk("vrr", "unknown"), chk("hdr", "attention")]);
        let p = build_priorities(&r, &json!([]), &json!([]), &json!([]));
        let nw: Vec<&str> = p.not_worth_touching.iter().map(|i| i.id).collect();
        assert!(nw.contains(&"vrr"));
        assert!(nw.contains(&"hdr")); // advisory even though "attention"
        assert!(!limiter_ids(&p).contains(&"hdr"));
    }

    #[test]
    fn unknown_values_degrade_gracefully() {
        let p = build_priorities(&Value::Null, &Value::Null, &Value::Null, &Value::Null);
        // No panic; with no signals there are no limiters and no hint.
        assert!(p.limiters.is_empty());
        assert!(p.session_hint.is_none());
    }
}
