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
    /// Every stable RECOMMENDATION id this row is about, in display order.
    ///
    /// `linked` names at most one target and may be a readiness-check id; this is
    /// strictly catalog rec ids, and it is the identity the Check → Optimize handoff
    /// carries (user-feedback recovery train, item 2/4: a row must NAME what it found,
    /// and downstream surfaces must never re-derive identity from display prose).
    /// Empty when the row is not about catalog recommendations.
    rec_ids: Vec<String>,
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

/// Titles the "applied-changes" drift row already names (applied-via-Compy, now drifted off).
/// The pending-safe-recs rule excludes these so one setting is never listed as both
/// "you applied it and it drifted" AND "you haven't applied it" (owner-caught 2026-07-08).
fn drifted_rec_titles(readiness: &Value) -> std::collections::HashSet<String> {
    readiness
        .get("checks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|c| c.get("id").and_then(Value::as_str) == Some("applied-changes"))
        .and_then(|c| c.get("drifted_titles"))
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

/// Pure: assemble the ranked priorities from already-gathered signals, with nothing set aside.
pub(crate) fn build_priorities(
    readiness: &Value,
    recommendations: &Value,
    startup: &Value,
    sessions: &Value,
) -> Priorities {
    build_priorities_filtered(readiness, recommendations, startup, sessions, &[])
}

/// Pure: assemble the ranked priorities, honouring the recs the user has SET ASIDE.
///
/// `dismissed` is the frontend's per-user "Not for me" set (`compy_dismissed_recs`). It filters
/// exactly ONE rule — rule 8's pending-safe-tweaks limiter, the row that tells the user there is
/// something waiting for them. That row is a call to action, and a call to action for a tweak the
/// user already declined is a dead end: it sent them to the Lab to find nothing there
/// (self-review round 9, 2026-07-29). Filtering here — rather than at the caller — keeps the row's
/// count, title, reason, `linked` and `rec_ids` derived from ONE list, so they can't contradict
/// each other.
///
/// It deliberately filters NOTHING else. The memory-integrity row below also reads the rec array,
/// but it is a MEASUREMENT of the rig (Bucket::NotWorth / Ready), not a call to action — hiding a
/// real measurement because the user declined a related tweak would be fabricating a cleaner rig
/// than they have.
pub(crate) fn build_priorities_filtered(
    readiness: &Value,
    recommendations: &Value,
    startup: &Value,
    sessions: &Value,
    dismissed: &[String],
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
                // A readiness check id is NOT a rec id — leave the rec identity empty
                // rather than hand the handoff something the catalog can't resolve.
                rec_ids: Vec::new(),
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
        let drifted = drifted_rec_titles(readiness);
        let unapplied: Vec<&Value> = recs
            .iter()
            .filter(|r| {
                let id = r.get("id").and_then(Value::as_str).unwrap_or("");
                let applied = r.get("currently_applied").and_then(Value::as_bool).unwrap_or(false);
                let severity = r.get("severity").and_then(Value::as_str).unwrap_or("");
                let title = r.get("title").and_then(Value::as_str).unwrap_or("");
                // A drifted rec is applied-then-reverted — the "Applied Compy changes" row owns it
                // with the right framing; never also list it here as "not applied".
                APPLIABLE_REC_IDS.contains(&id)
                    && !applied
                    && severity == "safe"
                    && !drifted.contains(title)
            })
            .collect();
        // A SET-ASIDE rec is one the user already said "not for me" to — pointing them at it again
        // is a call to action with nothing behind it (see the doc comment above).
        let pending: Vec<&Value> = unapplied
            .iter()
            .copied()
            .filter(|r| {
                let id = r.get("id").and_then(Value::as_str).unwrap_or("");
                !dismissed.iter().any(|d| d == id)
            })
            .collect();
        let set_aside = unapplied.len() - pending.len();
        if pending.is_empty() {
            tagged.push((
                Bucket::Fine,
                PriorityItem {
                    id: "pending-safe-recs",
                    title: "Safe one-click tweaks".into(),
                    // Never claim the rig is clean when it's only the user's own set-asides making
                    // it look that way — say which it is, and leave the way back visible.
                    reason: if set_aside > 0 {
                        format!(
                            "Nothing waiting — you set {set_aside} safe {} aside. You can bring {} back from the Lab any time.",
                            if set_aside == 1 { "tweak" } else { "tweaks" },
                            if set_aside == 1 { "it" } else { "them" }
                        )
                    } else {
                        "No pending safe tweaks — the safe recommendations that apply to your PC are already applied, or none apply.".into()
                    },
                    linked: None,
                    rec_ids: Vec::new(),
                    confidence: Confidence::Low,
                    status: PriorityStatus::Ready,
                },
            ));
        } else {
            // NAME the tweaks, don't just count them (user-feedback recovery train, items 2/4/5:
            // "1 safe tweak not applied" told a tester a number and nothing else, and the row
            // carried no identity, so every downstream surface had to guess). `ids` carries EVERY
            // pending rec — never truncated; the 4-title cap below is display prose only.
            let ids: Vec<String> = pending
                .iter()
                .filter_map(|r| r.get("id").and_then(Value::as_str).map(str::to_string))
                .collect();
            let titles: Vec<&str> = pending
                .iter()
                .filter_map(|r| r.get("title").and_then(Value::as_str))
                .take(4)
                .collect();
            // Exactly one pending tweak ⇒ the row IS that tweak: its real title, and `linked`
            // resolves it, so the surfaces that already render a linked rec's real action
            // (FirstCheck/Check/SetupTour/SessionDebrief) stop falling through to a dead end.
            let single = if pending.len() == 1 { ids.first().cloned() } else { None };
            tagged.push((
                Bucket::Limiter(8),
                PriorityItem {
                    id: "pending-safe-recs",
                    title: match (&single, titles.first()) {
                        (Some(_), Some(t)) => (*t).to_string(),
                        // Grammar stays real either way — never an "N tweak(s)" artifact.
                        _ => format!(
                            "{} safe {} not applied",
                            pending.len(),
                            if pending.len() == 1 { "tweak" } else { "tweaks" }
                        ),
                    },
                    reason: if single.is_some() {
                        "A safe, reversible tweak Compy can apply for you — you haven't applied it yet.".into()
                    } else {
                        format!(
                            "Compy has safe, reversible tweaks you haven't applied: {}{}.",
                            titles.join(", "),
                            if pending.len() > titles.len() { ", …" } else { "" }
                        )
                    },
                    linked: single,
                    rec_ids: ids,
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
                    reason: "A heavy startup load uses RAM and CPU before you even open a game. Compy can turn off the ones you don't need — it stops them auto-starting, never uninstalls.".into(),
                    linked: None,
                    // Startup entries are not catalog recs — Check names them inline from
                    // get_startup_entries and turns them off there.
                    rec_ids: Vec::new(),
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
                    rec_ids: Vec::new(),
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
                    rec_ids: r
                        .get("id")
                        .and_then(Value::as_str)
                        .map(|id| vec![id.to_string()])
                        .unwrap_or_default(),
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

/// Same ranking as `get_priorities`, but computed from signals the CALLER already fetched — so the
/// scan (and the dashboard refresh) don't re-run readiness + recommendations a second time just to
/// rank them. Pure pass-through to `build_priorities`; reads NO live Windows state, mutates nothing.
/// The frontend passes back the exact JSON it got from get_game_readiness / get_recommendations /
/// get_startup_entries / get_session_summaries, so the shapes are identical to get_priorities'.
///
/// `dismissed_ids` is the caller's set-aside rec list (`compy_dismissed_recs`). It is optional so
/// the shape stays backward-compatible; omitting it means "nothing set aside".
#[tauri::command]
pub(crate) fn priorities_from(
    readiness: Value,
    recommendations: Value,
    startup: Value,
    sessions: Value,
    dismissed_ids: Option<Vec<String>>,
) -> Priorities {
    build_priorities_filtered(
        &readiness,
        &recommendations,
        &startup,
        &sessions,
        &dismissed_ids.unwrap_or_default(),
    )
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
    /// An "applied-changes" attention row that names the drifted rec titles (mirrors the
    /// structured field readiness.rs now emits) — so the dedup path is exercised.
    fn chk_drift(titles: &[&str]) -> Value {
        json!({
            "id": "applied-changes", "status": "attention", "label": "Applied Compy changes",
            "detail": "drifted", "value": null,
            "drifted_titles": titles.iter().map(|t| json!(t)).collect::<Vec<_>>()
        })
    }
    fn rec_titled(id: &str, title: &str, applied: bool, severity: &str) -> Value {
        json!({ "id": id, "title": title, "currently_applied": applied, "severity": severity })
    }
    fn limiter_title(p: &Priorities, id: &str) -> Option<String> {
        p.limiters.iter().find(|i| i.id == id).map(|i| i.title.clone())
    }
    fn rec(id: &str, applied: bool, severity: &str) -> Value {
        json!({ "id": id, "title": id, "currently_applied": applied, "severity": severity })
    }
    fn limiter_ids(p: &Priorities) -> Vec<&str> {
        p.limiters.iter().map(|i| i.id).collect()
    }
    fn limiter_rec_ids(p: &Priorities, id: &str) -> Vec<String> {
        p.limiters.iter().find(|i| i.id == id).map(|i| i.rec_ids.clone()).unwrap_or_default()
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
    fn every_retail_link_is_a_plain_search_never_affiliate_or_tracking() {
        // Affiliate-safety guard (Receipts Doctrine, money stack #1): the Phase-D tag swap must happen
        // ONLY by editing this module's link table — never slip in silently. Until then EVERY shipped
        // retail URL is a plain https search, free of any affiliate/tracking marker. Scans the const
        // tables directly so a link is caught even before it has a render path.
        const FORBIDDEN: &[&str] = &[
            "tag=", "affiliate", "aff_", "utm_", "ref=", "/ref/", "ascsubtag", "linkcode", "linkid",
            "campaign", "partner", "subid",
        ];
        let all: Vec<&RetailLink> = GPU_LINKS.iter().chain(SSD_LINKS.iter()).collect();
        assert!(!all.is_empty(), "there are retail links to guard");
        for l in all {
            let url = l.url.to_lowercase();
            assert!(url.starts_with("https://"), "{} link must be https: {}", l.retailer, l.url);
            for marker in FORBIDDEN {
                assert!(
                    !url.contains(marker),
                    "{} link carries a tracking/affiliate marker '{}': {} — Phase-D tag swap must be \
                     a deliberate, reviewed edit, never silent",
                    l.retailer,
                    marker,
                    l.url
                );
            }
        }
    }

    #[test]
    fn disclosure_is_paired_with_every_single_item_path() {
        // Each qualifying path ON ITS OWN must render the disclosure — links must never appear
        // disclosure-less (the combined 2-item case is covered above; this pins the single-item shapes,
        // the BACKLOG-noted gap). Links + disclosure are inseparable by construction.
        let gpu_only = build_upgrade_path(&readiness(vec![]), &json!([{ "peak_gpu_usage_pct": 99 }]))
            .expect("gpu-only qualifies");
        let ssd_only =
            build_upgrade_path(&readiness(vec![chk("install-drive", "attention")]), &json!([]))
                .expect("ssd-only qualifies");
        for up in [gpu_only, ssd_only] {
            assert_eq!(up.items.len(), 1, "single-item path");
            assert!(!up.items[0].links.is_empty(), "the path renders links...");
            assert_eq!(up.disclosure, AFFILIATE_DISCLOSURE, "...so the disclosure MUST be present");
        }
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

    // owner-caught 2026-07-08: the Home priority queue listed Game Mode as BOTH "you applied it
    // and it drifted off" AND "you haven't applied it" — contradictory. A rec the drift row already
    // names must NOT also appear in "safe tweaks not applied".
    #[test]
    fn a_drifted_rec_is_not_also_listed_as_not_applied() {
        let r = readiness(vec![chk_drift(&["Enable Windows Game Mode"])]);
        let recs = json!([rec_titled("game-mode", "Enable Windows Game Mode", false, "safe")]);
        let p = build_priorities(&r, &recs, &json!([]), &json!([]));
        let ids = limiter_ids(&p);
        // The drift row owns it; the pending-safe aggregate must be absent (nothing left to list).
        assert!(ids.contains(&"applied-changes"), "drift row still shown");
        assert!(!ids.contains(&"pending-safe-recs"), "drifted rec must not double-list as not-applied");
    }

    // A genuinely-never-applied safe rec alongside a DIFFERENT drifted rec still shows both — the
    // dedup keys on the specific setting, it doesn't suppress the whole aggregate.
    #[test]
    fn a_never_applied_rec_survives_when_a_different_rec_drifted() {
        let r = readiness(vec![chk_drift(&["Enable Windows Game Mode"])]);
        let recs = json!([
            rec_titled("game-mode", "Enable Windows Game Mode", false, "safe"),
            rec_titled("hags-enable", "Hardware-accelerated GPU scheduling", false, "safe"),
        ]);
        let p = build_priorities(&r, &recs, &json!([]), &json!([]));
        assert!(limiter_ids(&p).contains(&"pending-safe-recs"), "the non-drifted rec still lists");
        // …and exactly ONE rec survived, so the row IS that rec — named, not counted.
        assert_eq!(
            limiter_title(&p, "pending-safe-recs").as_deref(),
            Some("Hardware-accelerated GPU scheduling")
        );
        assert_eq!(limiter_rec_ids(&p, "pending-safe-recs"), vec!["hags-enable"]);
    }

    // flags-name-it law: no "N setting(s)" pluralization artifact. Singular vs plural is real grammar.
    // (The one-rec case no longer counts at all — it names the tweak; guarded just below.)
    #[test]
    fn pending_safe_title_uses_real_grammar_never_paren_s() {
        let one = build_priorities(
            &readiness(vec![]),
            &json!([rec_titled("game-mode", "Enable Windows Game Mode", false, "safe")]),
            &json!([]),
            &json!([]),
        );
        assert_eq!(
            limiter_title(&one, "pending-safe-recs").as_deref(),
            Some("Enable Windows Game Mode")
        );
        let two = build_priorities(
            &readiness(vec![]),
            &json!([
                rec_titled("game-mode", "Enable Windows Game Mode", false, "safe"),
                rec_titled("hags-enable", "Hardware-accelerated GPU scheduling", false, "safe"),
            ]),
            &json!([]),
            &json!([]),
        );
        assert_eq!(limiter_title(&two, "pending-safe-recs").as_deref(), Some("2 safe tweaks not applied"));
        for t in [limiter_title(&one, "pending-safe-recs"), limiter_title(&two, "pending-safe-recs")]
            .into_iter()
            .flatten()
        {
            assert!(!t.contains("(s)"), "no pluralization artifact: {t}");
        }
    }

    // ── bug → guard: "1 safe tweak not applied" (tester feedback, recovery train items 2/4/5) ──
    // The row named a COUNT and carried no identity, so every downstream surface (FirstCheck's
    // spotlight, Check's ranked list, SetupTour, SessionDebrief) had to guess which rec it meant —
    // and, failing, dropped the user on a dead end. These pin the identity contract at the source.

    #[test]
    fn pending_safe_row_carries_every_pending_rec_id_never_truncated() {
        // Six pending appliable recs — the display prose caps at 4 titles, the IDENTITY must not.
        let ids = ["game-mode", "visual-effects", "sysmain-disable", "nagle-disable", "hags-enable", "mouse-accel-off"];
        for id in ids {
            assert!(APPLIABLE_REC_IDS.contains(&id), "fixture drifted from the appliable set: {id}");
        }
        let recs = Value::Array(
            ids.iter().map(|id| rec_titled(id, &format!("Tweak {id}"), false, "safe")).collect(),
        );
        let p = build_priorities(&readiness(vec![]), &recs, &json!([]), &json!([]));
        assert_eq!(
            limiter_rec_ids(&p, "pending-safe-recs"),
            ids,
            "every pending rec id survives; the .take(4) is prose-only"
        );
        // …and the prose is still the capped, honest summary (not a wall of six titles).
        let reason = p
            .limiters
            .iter()
            .find(|i| i.id == "pending-safe-recs")
            .map(|i| i.reason.clone())
            .unwrap_or_default();
        assert!(reason.ends_with("\u{2026}."), "over-cap prose keeps its ellipsis: {reason}");
    }

    #[test]
    fn a_single_pending_rec_becomes_the_row_identity_not_a_count() {
        let p = build_priorities(
            &readiness(vec![]),
            &json!([rec_titled("game-mode", "Enable Windows Game Mode", false, "safe")]),
            &json!([]),
            &json!([]),
        );
        let row = p.limiters.iter().find(|i| i.id == "pending-safe-recs").expect("row present");
        // The title names the tweak…
        assert_eq!(row.title, "Enable Windows Game Mode");
        assert!(!row.title.contains("not applied"), "no count-only language: {}", row.title);
        // …and `linked` resolves it, which is what makes the surfaces render its REAL action.
        assert_eq!(row.linked.as_deref(), Some("game-mode"));
        assert_eq!(row.rec_ids, vec!["game-mode"]);
    }

    #[test]
    fn several_pending_recs_keep_the_honest_count_but_still_carry_identity() {
        let p = build_priorities(
            &readiness(vec![]),
            &json!([
                rec_titled("game-mode", "Enable Windows Game Mode", false, "safe"),
                rec_titled("hags-enable", "Hardware-accelerated GPU scheduling", false, "safe"),
            ]),
            &json!([]),
            &json!([]),
        );
        let row = p.limiters.iter().find(|i| i.id == "pending-safe-recs").expect("row present");
        assert_eq!(row.title, "2 safe tweaks not applied");
        // No single target to link — but the ids are all there for the UI to expand.
        assert_eq!(row.linked, None, "an aggregate must not pretend to be one rec");
        assert_eq!(row.rec_ids, vec!["game-mode", "hags-enable"]);
    }

    #[test]
    fn rows_that_are_not_about_recommendations_carry_no_rec_ids() {
        // A readiness check id is not a catalog rec id — handing it to the handoff would produce
        // a highlight target the Optimize catalog can never resolve.
        let p = build_priorities(
            &readiness(vec![chk("monitor-refresh", "attention")]),
            &json!([]),
            &json!([{ "name": "a", "enabled": true }]),
            &json!([]),
        );
        for row in p.limiters.iter().chain(p.already_fine.iter()) {
            if row.id == "monitor-refresh" || row.id == "startup-load" {
                assert!(row.rec_ids.is_empty(), "{} must not claim rec identity", row.id);
            }
        }
    }

    #[test]
    fn no_pending_recs_means_no_rec_identity_to_carry() {
        let p = build_priorities(
            &readiness(vec![]),
            &json!([rec_titled("game-mode", "Enable Windows Game Mode", true, "safe")]),
            &json!([]),
            &json!([]),
        );
        let row = p.already_fine.iter().find(|i| i.id == "pending-safe-recs").expect("fine row");
        assert!(row.rec_ids.is_empty(), "nothing pending → nothing to hand off");
        assert_eq!(row.linked, None);
    }

    // ── bug → guard: the Home → Lab dead end (self-review round 9, 2026-07-29) ──
    // A user set "Enable Windows Game Mode" aside in the Lab. Home kept saying "1 worth fixing /
    // TOP LIMITER: Enable Windows Game Mode — See in Lab", because the limiter came from HERE and
    // the ranker had never heard of the set-aside set. They tapped through and found nothing.
    // These pin the contract at the source: the call-to-action row obeys set-asides, the
    // MEASUREMENT rows never do.

    #[test]
    fn a_set_aside_rec_stops_being_a_limiter() {
        let recs = json!([rec_titled("game-mode", "Enable Windows Game Mode", false, "safe")]);
        let live = build_priorities_filtered(&readiness(vec![]), &recs, &json!([]), &json!([]), &[]);
        assert!(limiter_ids(&live).contains(&"pending-safe-recs"), "baseline: it IS a limiter");

        let aside = build_priorities_filtered(
            &readiness(vec![]),
            &recs,
            &json!([]),
            &json!([]),
            &["game-mode".to_string()],
        );
        assert!(
            !limiter_ids(&aside).contains(&"pending-safe-recs"),
            "a declined tweak must not send the user to the Lab to find nothing"
        );
        // …and the row that replaces it says WHY it's quiet — never "already applied, or none apply"
        // (which would claim the rig is clean when it's only the user's own set-aside).
        let row = aside.already_fine.iter().find(|i| i.id == "pending-safe-recs").expect("fine row");
        assert!(row.reason.contains("you set 1 safe tweak aside"), "names the set-aside: {}", row.reason);
        assert!(row.reason.contains("bring it back"), "offers the way back: {}", row.reason);
        assert!(!row.reason.contains("already applied"), "never claims it's applied: {}", row.reason);
    }

    #[test]
    fn a_partial_set_aside_leaves_an_honest_count_and_identity() {
        let recs = json!([
            rec_titled("game-mode", "Enable Windows Game Mode", false, "safe"),
            rec_titled("hags-enable", "Hardware-accelerated GPU scheduling", false, "safe"),
        ]);
        let p = build_priorities_filtered(
            &readiness(vec![]),
            &recs,
            &json!([]),
            &json!([]),
            &["game-mode".to_string()],
        );
        let row = p.limiters.iter().find(|i| i.id == "pending-safe-recs").expect("row present");
        // Count, title, `linked` and rec_ids all derive from the SAME filtered list — so "2 safe
        // tweaks not applied" can never survive next to a one-row Lab.
        assert_eq!(row.title, "Hardware-accelerated GPU scheduling");
        assert_eq!(row.linked.as_deref(), Some("hags-enable"));
        assert_eq!(row.rec_ids, vec!["hags-enable"]);
        assert!(!row.title.contains('2'), "the set-aside one is not counted: {}", row.title);
    }

    #[test]
    fn set_asides_never_hide_a_real_measurement() {
        // The memory-integrity row is rec-derived too, but it MEASURES the rig rather than asking
        // for a tap. Filtering it would report a cleaner machine than the user has.
        let recs = json!([rec_titled("memory-integrity", "Memory integrity is active", true, "safe")]);
        let p = build_priorities_filtered(
            &readiness(vec![]),
            &recs,
            &json!([]),
            &json!([]),
            &["memory-integrity".to_string()],
        );
        let row = p
            .not_worth_touching
            .iter()
            .find(|i| i.id == "memory-integrity")
            .expect("the measurement survives a set-aside");
        assert!(row.reason.contains("is ON"), "still reports the true state: {}", row.reason);
    }

    #[test]
    fn an_unknown_set_aside_id_changes_nothing() {
        let recs = json!([rec_titled("game-mode", "Enable Windows Game Mode", false, "safe")]);
        let p = build_priorities_filtered(
            &readiness(vec![]),
            &recs,
            &json!([]),
            &json!([]),
            &["not-a-real-rec".to_string(), String::new()],
        );
        assert_eq!(
            limiter_title(&p, "pending-safe-recs").as_deref(),
            Some("Enable Windows Game Mode"),
            "a stale/unknown id must never silence a real limiter"
        );
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
