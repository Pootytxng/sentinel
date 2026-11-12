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
    /// P9-summary-gpu-limit: per game, its newest measured session, only when that session was
    /// GPU-limited by the same sustained rule as the upgrade path. A game whose newest measured
    /// session wasn't, or recorded no share, is absent (never guessed).
    gpu_limited_games: Vec<GameGpuLimit>,
}

/// One game whose newest measured session was GPU-limited (the sustained rule).
#[derive(Serialize, Debug, PartialEq)]
pub(crate) struct GameGpuLimit {
    /// The session's `process_name`, as the Trial summary keys games.
    game: String,
    /// Whole-percent share of that session's GPU readings at or above the saturation threshold.
    share_pct: u64,
    /// That session's peak GPU usage.
    peak_pct: u64,
    /// The per-reading load at or above which a reading counts toward `share_pct` (sessions.rs
    /// `GPU_LIMITED_PCT`), so the line can say what the share is a share of.
    threshold_pct: u64,
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

/// One threshold for "this tick the GPU was saturated" (`sessions.rs` records the count against
/// it), shared by the session hint and the upgrade path so the two can never disagree.
const GPU_LIMITED_PCT: u64 = crate::sessions::GPU_LIMITED_PCT as u64;

/// The share of a session's GPU readings that must sit at or above [`GPU_LIMITED_PCT`] before the
/// GPU is called the session's limiter (P9-bottleneck-sustained). One peak sample is a loading
/// screen or a menu; half the session is the card working as hard as it can while the game was
/// played. A session that never recorded the share (an older Compy) has a peak and no claim.
const GPU_SUSTAINED_SHARE_PCT: u64 = 50;

/// How many measured GPU readings (~1 Hz ticks, `sessions.rs`) a session needs before its share can
/// be called sustained at all (review round 2): a session measured for a handful of seconds with every
/// tick saturated is 100% busy on paper and still one moment, which is the exact claim this guards
/// against. Under the floor the hint says how little was measured and makes no verdict.
const GPU_SUSTAINED_MIN_READINGS: u32 = 30;

/// What the newest measured session says about its GPU: the peak, and the share of readings that
/// were saturated when the session recorded one. A session behind another window the whole time is
/// skipped (P4-show-f1): its GPU load was the game running behind, not play.
struct GpuLoadRead {
    peak_pct: u64,
    /// The recorded tick counts; `None` = the session didn't record them (an older Compy).
    load: Option<crate::sessions::GpuLoad>,
}

impl GpuLoadRead {
    /// Whole-percent share of the measured readings at or above the threshold (floored), for the
    /// words; `None` when not recorded or the counts can't be.
    fn busy_share_pct(&self) -> Option<u64> {
        self.load.and_then(|l| l.busy_share_pct()).map(u64::from)
    }

    /// The share, only when the GPU was saturated for at least half the measured readings. Decided
    /// on the exact counts, never on the rounded share (99 of 200 is not half), and only on a row
    /// whose counts can be (busy within readings, and a peak that reached the threshold at all).
    fn sustained_share(&self) -> Option<u64> {
        let l = self.load?;
        let sane = l.readings >= GPU_SUSTAINED_MIN_READINGS && l.busy <= l.readings && self.peak_pct >= GPU_LIMITED_PCT;
        let sustained = u64::from(l.busy) * 100 >= u64::from(l.readings) * GPU_SUSTAINED_SHARE_PCT;
        (sane && sustained).then(|| self.busy_share_pct()).flatten()
    }

    /// A session that recorded its share but measured too few readings to decide anything from it
    /// (under [`GPU_SUSTAINED_MIN_READINGS`]); the count, for the words.
    fn too_few_readings(&self) -> Option<u32> {
        self.load.and_then(|l| (l.readings < GPU_SUSTAINED_MIN_READINGS).then_some(l.readings))
    }

    /// The share as words for a session that was NOT sustained: a floored 0 with any saturated tick
    /// is "under 1%", never "0%".
    fn brief_share_words(&self) -> Option<String> {
        let share = self.busy_share_pct()?;
        let any = self.load.is_some_and(|l| l.busy > 0);
        Some(if share == 0 && any { "under 1%".into() } else { format!("{share}%") })
    }
}

fn gpu_load_read(sessions: &Value) -> Option<GpuLoadRead> {
    gpu_load_read_row(crate::sessions::newest_measured_row(sessions)?)
}

/// P9-summary-gpu-limit: for each game, its newest measured session (sessions arrive newest
/// first; a `samples: 0` row is skipped, as in `newest_measured_row`), kept only when sustained.
/// Another game's session never counts for a game. A row with no game name is skipped.
fn build_gpu_limited_games(sessions: &Value) -> Vec<GameGpuLimit> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for row in sessions.as_array().map(Vec::as_slice).unwrap_or_default() {
        if row.get("samples").and_then(Value::as_u64) == Some(0) {
            continue;
        }
        let Some(game) = row.get("process_name").and_then(Value::as_str).map(str::trim).filter(|g| !g.is_empty()) else {
            continue;
        };
        // Review r1: one game whatever the case Windows reported its process name in.
        if !seen.insert(game.to_lowercase()) {
            continue; // an older session of a game already decided by its newest
        }
        if let Some(read) = gpu_load_read_row(row) {
            if let Some(share_pct) = read.sustained_share() {
                out.push(GameGpuLimit {
                    game: game.to_string(),
                    share_pct,
                    peak_pct: read.peak_pct,
                    threshold_pct: GPU_LIMITED_PCT,
                });
            }
        }
    }
    out
}

fn gpu_load_read_row(s: &Value) -> Option<GpuLoadRead> {
    let peak_pct = s.get("peak_gpu_usage_pct").and_then(Value::as_u64)?;
    let load = s
        .get("gpu_load")
        .and_then(|l| serde_json::from_value::<crate::sessions::GpuLoad>(l.clone()).ok());
    Some(GpuLoadRead { peak_pct, load })
}

/// The newest session's GPU load and saturated share, only when sustained.
fn gpu_limited(sessions: &Value) -> Option<(GpuLoadRead, u64)> {
    let read = gpu_load_read(sessions)?;
    let share = read.sustained_share()?;
    Some((read, share))
}

/// Qualifying rows ONLY (right-room law): (1) the conservative GPU-limited session verdict,
/// (2) the install-drive HDD readiness attention. Anything else → None (no block at all).
pub(crate) fn build_upgrade_path(readiness: &Value, sessions: &Value) -> Option<UpgradePath> {
    let mut items = Vec::new();
    if let Some((gpu, share)) = gpu_limited(sessions) {
        let peak = gpu.peak_pct;
        items.push(UpgradeSuggestion {
            kind: "gpu",
            title: "GPU was the measured limiter",
            why: format!(
                "In your most recent monitored session the GPU sat at or above {GPU_LIMITED_PCT}% \
                 for {share}% of the time Compy measured the game (peak ~{peak}%) — the GPU was the \
                 limiter for at least half of that session. If you want more headroom, a GPU \
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
        let drifted = drifted_rec_titles(readiness);
        let pending: Vec<&Value> = recs
            .iter()
            .filter(|r| {
                let id = r.get("id").and_then(Value::as_str).unwrap_or("");
                let applied = r.get("currently_applied").and_then(Value::as_bool).unwrap_or(false);
                let severity = r.get("severity").and_then(Value::as_str).unwrap_or("");
                let title = r.get("title").and_then(Value::as_str).unwrap_or("");
                // A drifted rec is applied-then-reverted — the "Applied Compy changes" row owns it
                // with the right framing; never also list it here as "not applied".
                // A change the catalog marks "not for this PC" is never pending here (codebase review
                // 2026-11-02): an Ethernet-only tweak read as a limiter on a Wi-Fi-only rig.
                let eligible = r.get("eligible").and_then(Value::as_bool).unwrap_or(true);
                APPLIABLE_REC_IDS.contains(&id)
                    && !applied
                    && eligible
                    && severity == "safe"
                    && !drifted.contains(title)
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
                    title: format!(
                        "{} safe {} not applied",
                        pending.len(),
                        if pending.len() == 1 { "tweak" } else { "tweaks" }
                    ),
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
                    reason: "A heavy startup load uses RAM and CPU before you even open a game. Compy can turn off the ones you don't need — it stops them auto-starting, never uninstalls.".into(),
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
    const VBS_ADVISORY_ID: &str = "memory-integrity-vbs-advisory";
    {
        let recs = recommendations.as_array().map(Vec::as_slice).unwrap_or(&[]);
        // The exact advisory id, not a word match: the row now SAYS "turned on", which only this rule's
        // condition guarantees — a future "turn on core isolation" rule must not read as already on.
        if let Some(r) = recs
            .iter()
            .find(|r| r.get("id").and_then(Value::as_str) == Some(VBS_ADVISORY_ID))
        {
            // The advisory exists only while Memory Integrity / VBS is turned on (its catalog rule's
            // condition, read from the registry), so the row says on (codebase review 2026-11-02).
            // It read `currently_applied`, which a rule with no state check never sets, and said
            // "off — nothing to do" on exactly the machines where it is on.
            tagged.push((
                Bucket::NotWorth,
                PriorityItem {
                    id: "memory-integrity",
                    title: "Memory Integrity / VBS".to_string(),
                    reason: "Memory Integrity / VBS is turned on. It can cost a few % in some games, but it's a security feature — advisory only, your call.".into(),
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
        gpu_limited_games: build_gpu_limited_games(sessions),
    }
}

/// Conservative GPU-vs-system hint from the most recent session, or None when
/// the signal is inconclusive. Never claims a hard CPU/GPU-bound classification.
fn build_session_hint(sessions: &Value) -> Option<String> {
    let s = crate::sessions::newest_measured_row(sessions)?; // skips one with no reading (P4-show-f1)
    let load = gpu_load_read(sessions)?;
    let gpu = load.peak_pct;
    let avg = s.get("avg_fps").and_then(Value::as_f64).unwrap_or(0.0);
    let low1 = s.get("low1_fps_est").and_then(Value::as_f64).unwrap_or(0.0);
    let varied = avg > 0.0 && low1 > 0.0 && low1 < avg * 0.7;
    if let Some(share) = load.sustained_share() {
        Some(format!(
            "Recent session hint: the GPU sat at or above {GPU_LIMITED_PCT}% for {share}% of the time Compy measured the game (peak ~{gpu}%), so this session looked GPU-limited for at least half of it."
        ))
    } else if gpu >= GPU_LIMITED_PCT {
        // A peak alone is a moment, not the session (P9-bottleneck-sustained): say the GPU was busy
        // at times, and why that is not a verdict.
        Some(match (load.too_few_readings(), load.brief_share_words()) {
            (Some(n), _) => format!(
                "Recent session hint: the GPU was busy at times (peak ~{gpu}%), but Compy measured the game for only about {n} s, too little to say whether this session was GPU-limited."
            ),
            (None, Some(share)) => format!(
                "Recent session hint: the GPU was busy at times (peak ~{gpu}%) but sat at or above {GPU_LIMITED_PCT}% for only {share} of the time Compy measured the game, so this session doesn't look GPU-limited overall."
            ),
            (None, None) => format!(
                "Recent session hint: the GPU was busy at times (peak ~{gpu}%); this session didn't record how much of the measured time the GPU spent saturated, so that is a moment, not a verdict."
            ),
        })
    } else if gpu <= 85 {
        let ft = if varied { " and frametimes varied" } else { "" };
        Some(format!(
            "Recent session hint: GPU usage didn't saturate (~{gpu}%){ft}, so this session may be CPU/background/system-limited."
        ))
    } else {
        None // 86–94%: inconclusive — don't guess.
    }
}

// The window reaches this through `off_main::get_priorities` (lib.rs), off the main thread.
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
#[tauri::command]
pub(crate) fn priorities_from(
    readiness: Value,
    recommendations: Value,
    startup: Value,
    sessions: Value,
) -> Priorities {
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
    fn a_session_with_no_reading_never_sets_the_hint_or_the_upgrade_path() {
        // The newest session was behind another window the whole time (P4-show-f1): its GPU peak
        // is the game idling behind, so the hint reads the newest session that measured play.
        let sessions = json!([
            { "samples": 0, "peak_gpu_usage_pct": 40, "avg_fps": 0.0, "low1_fps_est": 0.0 },
            { "samples": 900, "peak_gpu_usage_pct": 98, "gpu_load": { "readings": 900, "busy": 800 }, "avg_fps": 120.0, "low1_fps_est": 100.0 }
        ]);
        let p = build_priorities(&readiness(vec![]), &json!([]), &json!([]), &sessions);
        assert!(p.session_hint.as_deref().is_some_and(|h| h.contains("looked GPU-limited for at least half")), "{:?}", p.session_hint);
        assert!(build_upgrade_path(&readiness(vec![]), &sessions).is_some());
        let only = json!([{ "samples": 0, "peak_gpu_usage_pct": 99 }]);
        assert!(build_priorities(&readiness(vec![]), &json!([]), &json!([]), &only).session_hint.is_none());
        assert!(build_upgrade_path(&readiness(vec![]), &only).is_none());
    }

    #[test]
    fn ranking_with_no_sessions_has_no_hint() {
        let p = build_priorities(&readiness(vec![chk("monitor-refresh", "attention")]), &json!([]), &json!([]), &json!([]));
        assert!(p.session_hint.is_none());
        assert_eq!(limiter_ids(&p), vec!["monitor-refresh"]);
    }

    #[test]
    fn ranking_with_a_session_emits_conservative_hint() {
        let sessions = json!([{ "peak_gpu_usage_pct": 98, "gpu_load": { "readings": 600, "busy": 540 }, "avg_fps": 120.0, "low1_fps_est": 100.0 }]);
        let p = build_priorities(&readiness(vec![]), &json!([]), &json!([]), &sessions);
        let hint = p.session_hint.expect("hint present");
        assert!(hint.contains("looked GPU-limited for at least half of it"), "{hint}");
        assert!(hint.contains("for 90% of the time Compy measured the game"), "{hint}");
    }

    // P9-bottleneck-sustained: one peak sample over the threshold is a loading screen or a menu, not
    // the session. "The GPU was the limiter" and the purchase links under it need the GPU saturated
    // for a sustained share of the session's readings; a peak alone says the GPU was busy at times.
    #[test]
    fn a_peak_alone_is_busy_at_times_never_the_limiter() {
        // No share recorded (an older Compy's row): a peak and no claim, no upgrade row.
        let old_row = json!([{ "peak_gpu_usage_pct": 98, "avg_fps": 120.0, "low1_fps_est": 100.0 }]);
        let hint = build_priorities(&readiness(vec![]), &json!([]), &json!([]), &old_row).session_hint.expect("hint");
        assert!(hint.contains("busy at times") && hint.contains("~98%"), "{hint}");
        assert!(hint.contains("didn't record"), "{hint}");
        assert!(!hint.contains("GPU-limited"), "{hint}");
        assert!(build_upgrade_path(&readiness(vec![]), &old_row).is_none(), "a peak alone grows no retail links");
        // A share recorded, but under half the session: busy at times, said with the share.
        let brief = json!([{ "peak_gpu_usage_pct": 100, "gpu_load": { "readings": 900, "busy": 45 }, "avg_fps": 120.0, "low1_fps_est": 100.0 }]);
        let hint = build_priorities(&readiness(vec![]), &json!([]), &json!([]), &brief).session_hint.expect("hint");
        assert!(hint.contains("busy at times") && hint.contains("only 5% of the time"), "{hint}");
        assert!(hint.contains("doesn't look GPU-limited"), "{hint}");
        assert!(build_upgrade_path(&readiness(vec![]), &brief).is_none());
        // A floored 0 with a saturated tick is "under 1%", never "0%".
        let one_tick = json!([{ "peak_gpu_usage_pct": 100, "gpu_load": { "readings": 900, "busy": 1 } }]);
        let hint = build_priorities(&readiness(vec![]), &json!([]), &json!([]), &one_tick).session_hint.expect("hint");
        assert!(hint.contains("only under 1% of the time"), "{hint}");
        // Exactly the threshold share qualifies; one reading under it does not (49% floored, said so).
        let edge = |busy: u64| json!([{ "peak_gpu_usage_pct": 97, "gpu_load": { "readings": 200, "busy": busy } }]);
        assert!(build_upgrade_path(&readiness(vec![]), &edge(100)).is_some(), "half the readings is sustained");
        assert!(build_upgrade_path(&readiness(vec![]), &edge(99)).is_none(), "99 of 200 is not half: decided on the counts, never a rounded share");
        let hint = build_priorities(&readiness(vec![]), &json!([]), &json!([]), &edge(99)).session_hint.expect("hint");
        assert!(hint.contains("only 49% of the time"), "{hint}");
        // Too few measured readings never claim the limiter, even every one of them saturated (review
        // round 2: 1 of 1 is "100%" on paper and one moment in fact); the hint says how little was
        // measured and grows no retail links. The floor itself qualifies.
        let brief_all_busy = json!([{ "peak_gpu_usage_pct": 100, "gpu_load": { "readings": 1, "busy": 1 } }]);
        assert!(build_upgrade_path(&readiness(vec![]), &brief_all_busy).is_none(), "one saturated tick is not a sustained share");
        let hint = build_priorities(&readiness(vec![]), &json!([]), &json!([]), &brief_all_busy).session_hint.expect("hint");
        assert!(hint.contains("busy at times") && hint.contains("only about 1 s") && hint.contains("too little"), "{hint}");
        assert!(!hint.contains("GPU-limited for"), "{hint}");
        let under_floor = json!([{ "peak_gpu_usage_pct": 100, "gpu_load": { "readings": GPU_SUSTAINED_MIN_READINGS - 1, "busy": GPU_SUSTAINED_MIN_READINGS - 1 } }]);
        assert!(build_upgrade_path(&readiness(vec![]), &under_floor).is_none(), "one reading under the floor is still too brief");
        let at_floor = json!([{ "peak_gpu_usage_pct": 100, "gpu_load": { "readings": GPU_SUSTAINED_MIN_READINGS, "busy": GPU_SUSTAINED_MIN_READINGS } }]);
        assert!(build_upgrade_path(&readiness(vec![]), &at_floor).is_some(), "the floor itself, all saturated, is sustained");
        // Counts that can't be, or a peak that never reached the threshold, never claim the limiter.
        let impossible = json!([{ "peak_gpu_usage_pct": 97, "gpu_load": { "readings": 10, "busy": 11 } }]);
        assert!(build_upgrade_path(&readiness(vec![]), &impossible).is_none());
        let no_peak = json!([{ "peak_gpu_usage_pct": 60, "gpu_load": { "readings": 100, "busy": 100 } }]);
        assert!(build_upgrade_path(&readiness(vec![]), &no_peak).is_none());
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
        let sessions = json!([{ "peak_gpu_usage_pct": 98, "gpu_load": { "readings": 900, "busy": 720 }, "avg_fps": 120.0, "low1_fps_est": 100.0 }]);
        let up = build_upgrade_path(&readiness(vec![]), &sessions).expect("qualifies");
        assert_eq!(up.items.len(), 1);
        assert_eq!(up.items[0].kind, "gpu");
        assert!(up.items[0].why.contains("~98%"), "why is sample-qualified with the measured peak");
        assert!(up.items[0].why.contains("for 80% of the time Compy measured the game"), "why names the sustained share: {}", up.items[0].why);
        assert!(up.items[0].why.contains("limiter for at least half of that session"), "{}", up.items[0].why);
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
        let sessions = json!([{ "peak_gpu_usage_pct": 99, "gpu_load": { "readings": 100, "busy": 90 } }]);
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
        let gpu_only = build_upgrade_path(&readiness(vec![]), &json!([{ "peak_gpu_usage_pct": 99, "gpu_load": { "readings": 100, "busy": 90 } }]))
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
        // …and the count reflects ONE rec, grammar-correct (no "(s)").
        assert_eq!(limiter_title(&p, "pending-safe-recs").as_deref(), Some("1 safe tweak not applied"));
    }

    // flags-name-it law: no "N setting(s)" pluralization artifact. Singular vs plural is real grammar.
    #[test]
    fn pending_safe_title_uses_real_grammar_never_paren_s() {
        let one = build_priorities(
            &readiness(vec![]),
            &json!([rec_titled("game-mode", "Enable Windows Game Mode", false, "safe")]),
            &json!([]),
            &json!([]),
        );
        assert_eq!(limiter_title(&one, "pending-safe-recs").as_deref(), Some("1 safe tweak not applied"));
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

    // Codebase review 2026-11-02: the VBS advisory exists only while VBS is on, and the row read a
    // state check the rule doesn't have, so it said "off — nothing to do" on exactly those machines.
    #[test]
    fn the_vbs_row_says_on_whenever_the_advisory_exists() {
        let recs = json!([{ "id": "memory-integrity-vbs-advisory", "title": "Memory Integrity / VBS is active", "currently_applied": false, "severity": "moderate" }]);
        let p = build_priorities(&readiness(vec![]), &recs, &json!([]), &json!([]));
        let row = p.not_worth_touching.iter().find(|i| i.id == "memory-integrity").expect("the row");
        assert!(row.reason.contains("is turned on") && !row.reason.contains("off"), "{}", row.reason);
        let none = build_priorities(&readiness(vec![]), &json!([]), &json!([]), &json!([]));
        assert!(none.not_worth_touching.iter().all(|i| i.id != "memory-integrity"), "no advisory, no row");
        // A rule that merely MENTIONS core isolation is not the advisory: it must not read as "on".
        let other = json!([{ "id": "core-isolation-enable", "title": "Turn on Core isolation", "currently_applied": false, "severity": "moderate" }]);
        let o = build_priorities(&readiness(vec![]), &other, &json!([]), &json!([]));
        assert!(o.not_worth_touching.iter().all(|i| i.id != "memory-integrity"), "a word match is not the advisory");
    }

    // Same review: a safe change the catalog marks "not for this PC" read as a pending limiter.
    #[test]
    fn a_change_not_for_this_pc_is_never_pending() {
        let mut eee = rec_titled("eee-disable", "Disable Energy-Efficient Ethernet", false, "safe");
        eee["eligible"] = json!(false);
        let p = build_priorities(&readiness(vec![]), &json!([eee]), &json!([]), &json!([]));
        assert!(!limiter_ids(&p).contains(&"pending-safe-recs"), "{:?}", limiter_ids(&p));
    }

    #[test]
    fn unknown_values_degrade_gracefully() {
        let p = build_priorities(&Value::Null, &Value::Null, &Value::Null, &Value::Null);
        // No panic; with no signals there are no limiters and no hint.
        assert!(p.limiters.is_empty());
        assert!(p.session_hint.is_none());
        assert!(p.gpu_limited_games.is_empty());
    }

    // P9-summary-gpu-limit: per game, only its own newest measured session decides, by the same
    // sustained rule as the upgrade path; another game's session never counts.
    #[test]
    fn each_game_is_gpu_limited_only_by_its_own_newest_measured_session() {
        let row = |game: &str, samples: u64, busy: u64| {
            json!({ "process_name": game, "samples": samples, "peak_gpu_usage_pct": 99, "gpu_load": { "readings": 100, "busy": busy } })
        };
        // Newest first: A's newest is limited (an older unlimited A row doesn't matter); B's newest is
        // not limited (its older limited row doesn't count); C's newest measured nothing (samples 0,
        // skipped), so its older limited row is its newest measured; a row with no game is skipped.
        let sessions = json!([
            row("a.exe", 500, 80),
            row("b.exe", 500, 10),
            row("c.exe", 0, 100),
            { "samples": 500, "peak_gpu_usage_pct": 99, "gpu_load": { "readings": 100, "busy": 100 } },
            row("a.exe", 500, 0),
            row("b.exe", 500, 90),
            row("c.exe", 500, 70),
        ]);
        let got = build_gpu_limited_games(&sessions);
        assert_eq!(
            got,
            vec![
                GameGpuLimit { game: "a.exe".into(), share_pct: 80, peak_pct: 99, threshold_pct: 95 },
                GameGpuLimit { game: "c.exe".into(), share_pct: 70, peak_pct: 99, threshold_pct: 95 },
            ]
        );
        // Review r1: the case Windows reported the name in doesn't make a second game; and a game
        // whose newest measured session recorded no share is absent though an older one was limited.
        let cased = json!([row("Game.exe", 500, 10), row("game.exe", 500, 90)]);
        assert!(build_gpu_limited_games(&cased).is_empty(), "the newest of one game decides");
        let no_share = json!([
            { "process_name": "e.exe", "samples": 500, "peak_gpu_usage_pct": 99 },
            row("e.exe", 500, 90),
        ]);
        assert!(build_gpu_limited_games(&no_share).is_empty(), "the newest measured session decides");
        // The same sustained rule: 99 of 200 is not half; under the reading floor is no claim.
        let edge = json!([{ "process_name": "d.exe", "peak_gpu_usage_pct": 99, "gpu_load": { "readings": 200, "busy": 99 } }]);
        assert!(build_gpu_limited_games(&edge).is_empty());
        let brief = json!([{ "process_name": "d.exe", "peak_gpu_usage_pct": 99, "gpu_load": { "readings": 10, "busy": 10 } }]);
        assert!(build_gpu_limited_games(&brief).is_empty());
        // A row that recorded no share (an older Compy) makes no claim.
        assert!(build_gpu_limited_games(&json!([{ "process_name": "d.exe", "peak_gpu_usage_pct": 99 }])).is_empty());
        let p = build_priorities(&readiness(vec![]), &json!([]), &json!([]), &sessions);
        assert_eq!(p.gpu_limited_games.len(), 2, "carried on the priorities payload");
    }
}
