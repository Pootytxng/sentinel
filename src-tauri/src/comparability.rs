//! comparability.rs — the session-comparability gate (Measurement Platform 2.0, Task F).
//!
//! A single, pure, deterministic answer to one honesty question every cross-session surface asks
//! before it shows a delta: **"can these two sessions honestly be compared, and how far?"**
//!
//! It mutates nothing, measures nothing, and reads only what the two [`SessionSummary`]s already
//! carry — the game they ran (`process_name`), the rig fingerprint (`hw_fingerprint`), the capture
//! backend's honest capabilities (`capture_capabilities`, Task C) and the conditions they ran under
//! (`game_state`, Task E). It COMPOSES those three, never re-deriving or duplicating them.
//!
//! # The one rule the whole module exists to enforce
//!
//! **Missing context never becomes "the same."** When a condition (resolution, driver, capture
//! method, …) is unknown on either side, we record it as *missing context* and refuse to treat the
//! two sessions as fully comparable — we NEVER assume the unrecorded condition matched. Absence of a
//! field is honestly Unknown, never a silent "equal."
//!
//! # What the verdict means
//!
//! * [`Comparability::Comparable`] — same game, same rig, same capture method, no changed condition
//!   detected. A measured difference can be attributed to what actually changed.
//! * [`Comparability::Partial`] — the comparison can proceed WITH STATED LIMITS: some condition
//!   changed (resolution, RAM, refresh, graphics API, game build, Windows build) or wasn't recorded,
//!   or the two sessions used different capture backends so **only shared metrics were compared**.
//!   "Direct comparison is limited."
//! * [`Comparability::NotComparable`] — a direct verdict would mislead: a different game, or a GPU
//!   swap that changes the entire measurement basis. Any difference reflects the changed thing, not a
//!   tweak the user made.
//! * [`Comparability::Unknown`] — not enough recorded context on one or both sessions to judge
//!   comparability at all (e.g. pre-2.0 sessions with no capture/condition fingerprint). Never
//!   assumed equal — "not enough comparable evidence."
//!
//! # Correlation is never causation
//!
//! A changed driver, Windows build, or RAM amount is surfaced as a **candidate explanation**
//! (`candidate_causes`), NEVER as a proven cause. A driver change specifically keeps the sessions
//! comparable *for regression detection* while flagging the driver as the first thing to check —
//! exactly what a detective wants, and exactly what an honest report must not overclaim.

use serde::{Deserialize, Serialize};

use crate::intelligence::Confidence;
use crate::sessions::SessionSummary;

/// How far two sessions may honestly be compared. Serialized `kebab-case` for the TS union.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum Comparability {
    /// Same game, same rig, same capture method, no changed condition detected.
    Comparable,
    /// Comparable with stated limits — a condition changed/was unrecorded, or only shared metrics
    /// were captured on both sides.
    Partial,
    /// A direct verdict would mislead (different game, or a GPU change that alters the whole basis).
    NotComparable,
    /// Too little recorded context to judge comparability at all. Never assumed equal.
    Unknown,
}

/// The structured comparability descriptor for a pair of sessions. Additive metadata: it never
/// blocks an existing surface, it EXPOSES the honest limits so a surface/export can state them and
/// so a downstream confidence can be capped at [`Self::confidence_limit`].
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub(crate) struct SessionComparability {
    /// The verdict — how far these two sessions may be compared.
    pub(crate) verdict: Comparability,
    /// Plain-language reasons for the verdict (consumer-facing wording, no jargon).
    pub(crate) reasons: Vec<String>,
    /// Conditions that DIFFERED between the two sessions (both sides known, values not equal).
    pub(crate) changed_context: Vec<String>,
    /// Conditions we could NOT confirm matched because they weren't recorded on one/both sessions.
    /// The heart of the honesty contract — these never silently become "equal."
    pub(crate) missing_context: Vec<String>,
    /// Candidate explanations for any measured difference — correlated, NEVER asserted as the cause.
    pub(crate) candidate_causes: Vec<String>,
    /// The metric axes BOTH capture backends actually recorded — the only metrics a comparison may
    /// honestly touch. Empty when capabilities are unknown on either side (see `missing_context`).
    pub(crate) shared_metrics: Vec<String>,
    /// The CEILING this comparability puts on any downstream conclusion's confidence band. A surface
    /// may be less confident for other reasons; it must never be MORE confident than this.
    pub(crate) confidence_limit: Confidence,
    /// What a surface may honestly conclude at this verdict — plain-language, ready to render.
    pub(crate) allowed_conclusions: Vec<String>,
    /// P4-comparable: one stable key per `changed_context` line, in the same order ("resolution",
    /// "refresh", "gpu-driver", …), so a surface can say what differed in the reader's language
    /// instead of showing the English line. Additive: older payloads load empty.
    #[serde(default)]
    pub(crate) changed_keys: Vec<String>,
    /// One stable key per `missing_context` line, in the same order ("conditions", "rig", …).
    #[serde(default)]
    pub(crate) missing_keys: Vec<String>,
}

/// A context line plus the stable key a surface translates it by (see `changed_keys`).
type Keyed = (&'static str, String);

/// Both-known-and-differ helper: `Some(true)` only when both sides carry a value and they differ.
/// `None` when either side is unknown (→ caller records missing context, never "equal").
fn differs<T: PartialEq>(a: Option<&T>, b: Option<&T>) -> Option<bool> {
    match (a, b) {
        (Some(x), Some(y)) => Some(x != y),
        _ => None,
    }
}

/// Derive the comparability of two sessions. Pure and deterministic: identical inputs → identical
/// output, no clock, no randomness, no I/O. `a` is the baseline (earlier) session, `b` the current
/// (later) one; order affects only wording, never the verdict.
pub(crate) fn derive(a: &SessionSummary, b: &SessionSummary) -> SessionComparability {
    let mut reasons: Vec<String> = Vec::new();
    let mut changed: Vec<Keyed> = Vec::new();
    let mut missing: Vec<Keyed> = Vec::new();
    let mut candidates: Vec<String> = Vec::new();

    // ── Gate 0: same game. A game's frame timing is only meaningful against itself. A different
    // game is terminal NotComparable — nothing downstream could rescue it. ────────────────────────
    let a_game = non_empty(&a.process_name);
    let b_game = non_empty(&b.process_name);
    match (a_game, b_game) {
        (Some(ga), Some(gb)) if !ga.eq_ignore_ascii_case(gb) => {
            return not_comparable(
                format!(
                    "These are different games ({} vs {}) — Compy compares a game against itself, so their \
                     frame numbers aren't comparable.",
                    crate::intelligence::pretty_game_name(ga),
                    crate::intelligence::pretty_game_name(gb),
                ),
                Vec::new(),
                shared_metrics_of(a, b),
            );
        }
        (Some(_), Some(_)) => {} // same game — proceed
        _ => missing.push((
            "game",
            "The presenting game wasn't recorded on one of these sessions — Compy can't confirm they're \
             the same game."
                .into(),
        )),
    }

    // Start optimistic; each check can only hold or lower the verdict.
    let mut verdict = Comparability::Comparable;
    let mut lower = |v: Comparability, verdict: &mut Comparability| {
        // Ordering of severity: Comparable > Partial > NotComparable/Unknown. NotComparable wins
        // over Unknown (a known-fundamental difference is more informative than "we don't know").
        let rank = |c: Comparability| match c {
            Comparability::Comparable => 3,
            Comparability::Partial => 2,
            Comparability::Unknown => 1,
            Comparability::NotComparable => 0,
        };
        if rank(v) < rank(*verdict) {
            *verdict = v;
        }
    };

    // ── Rig: GPU / RAM / display come from the fingerprint (NOT the hash — the hash folds in the
    // driver, and a driver update must not, by itself, break comparability). ──────────────────────
    let mut have_rig_context = false;
    match (a.hw_fingerprint.as_ref(), b.hw_fingerprint.as_ref()) {
        (Some(fa), Some(fb)) => {
            have_rig_context = true;
            // GPU change → the entire measurement basis differs. NotComparable + candidate cause.
            if fa.gpu != fb.gpu {
                changed.push(("gpu", format!("GPU: {} → {}", fa.gpu, fb.gpu)));
                candidates.push(format!(
                    "The GPU changed ({} → {}) — a different GPU is a different measurement basis, not a \
                     tuning result.",
                    fa.gpu, fb.gpu
                ));
                reasons.push(
                    "These sessions ran on different GPUs — that's not an apples-to-apples comparison."
                        .into(),
                );
                lower(Comparability::NotComparable, &mut verdict);
            }
            // RAM change → real but not basis-invalidating: Partial + candidate cause.
            if fa.ram_gb != fb.ram_gb {
                changed.push(("ram", format!("RAM: {} GB → {} GB", fa.ram_gb, fb.ram_gb)));
                candidates.push(format!(
                    "Installed memory changed ({} GB → {} GB) — a candidate explanation, not a proven cause.",
                    fa.ram_gb, fb.ram_gb
                ));
                reasons.push("The amount of memory changed between these sessions.".into());
                lower(Comparability::Partial, &mut verdict);
            }
            // Display string is "WxH@refresh"; a change there is a resolution/refresh change, which
            // changes the workload — a delta can't be isolated to anything else. Partial. (game_state
            // below gives the finer-grained wording when present.)
            if fa.display != fb.display {
                changed.push(("display-mode", format!("Display mode: {} → {}", fa.display, fb.display)));
                reasons.push(
                    "The display resolution or refresh changed — that changes the workload, so a \
                     difference can't be isolated to a single cause."
                        .into(),
                );
                lower(Comparability::Partial, &mut verdict);
            }
            // Driver change → KEEP comparable for regression detection, but flag as the first
            // candidate to check. Correlation, never automatic cause.
            // s37 (s35 opus NIT): the same driver written in another case is the same driver, as the
            // Trial preflight compares it (`trial_preflight`).
            if !fa.gpu_driver.trim().eq_ignore_ascii_case(fb.gpu_driver.trim()) && fa.gpu == fb.gpu {
                changed.push(("gpu-driver", format!("GPU driver: {} → {}", fa.gpu_driver, fb.gpu_driver)));
                candidates.push(format!(
                    "The GPU driver changed ({} → {}) — a candidate explanation to check first, not a \
                     proven cause.",
                    fa.gpu_driver, fb.gpu_driver
                ));
            }
        }
        _ => missing.push((
            "rig",
            "The PC's hardware wasn't recorded on one of these sessions — Compy can't confirm they ran on \
             the same rig."
                .into(),
        )),
    }

    // ── Conditions: from the game-state fingerprint (Task E). Each field is compared only when BOTH
    // sides carry it; an unknown side becomes missing context, never "equal." ─────────────────────
    let mut have_condition_context = false;
    if let (Some(ga), Some(gb)) = (a.game_state.as_ref(), b.game_state.as_ref()) {
        have_condition_context = true;

        // Resolution — the spec's headline attribution-limiter.
        let res_a = res_pair(ga);
        let res_b = res_pair(gb);
        match differs(res_a.as_ref(), res_b.as_ref()) {
            Some(true) => {
                let (wa, ha) = res_a.unwrap();
                let (wb, hb) = res_b.unwrap();
                changed.push(("resolution", format!("Resolution: {wa}×{ha} → {wb}×{hb}")));
                reasons.push(
                    "The display resolution changed — that changes how hard the PC is working, so a \
                     difference can't be attributed to anything else on its own."
                        .into(),
                );
                lower(Comparability::Partial, &mut verdict);
            }
            None if res_a.is_none() || res_b.is_none() => missing
                .push(("resolution", "The resolution wasn't recorded on one of these sessions.".into())),
            _ => {}
        }

        // Refresh — a cap on the achievable frame rate.
        condition_check(
            "refresh",
            ga.display_refresh_hz.as_ref(),
            gb.display_refresh_hz.as_ref(),
            |x, y| format!("Refresh: {x} Hz → {y} Hz"),
            "The display refresh rate changed — it caps the frame rate, so the two sessions had \
             different ceilings.",
            "The display refresh rate wasn't recorded on one of these sessions.",
            Comparability::Partial,
            &mut changed,
            &mut missing,
            &mut reasons,
            &mut verdict,
            &mut lower,
        );

        // Graphics API — a DX11↔DX12 (etc.) change is a workload change.
        condition_check(
            "graphics-api",
            ga.graphics_api.as_ref(),
            gb.graphics_api.as_ref(),
            |x, y| format!("Graphics API: {x} → {y}"),
            "The graphics API changed — that's a different rendering path, so the numbers aren't \
             directly comparable.",
            "The graphics API wasn't recorded on one of these sessions.",
            Comparability::Partial,
            &mut changed,
            &mut missing,
            &mut reasons,
            &mut verdict,
            &mut lower,
        );

        // Game build/patch — a regression may be the update, not the PC. Flag as candidate.
        match differs(ga.game_build.as_ref(), gb.game_build.as_ref()) {
            Some(true) => {
                let (x, y) = (
                    ga.game_build.clone().unwrap_or_default(),
                    gb.game_build.clone().unwrap_or_default(),
                );
                changed.push(("game-build", format!("Game build: {x} → {y}")));
                candidates.push(
                    "The game updated between these sessions — a regression could be the update itself, \
                     not a change on your PC."
                        .into(),
                );
                reasons.push(
                    "The game's build changed — a difference can't be isolated from the update."
                        .into(),
                );
                lower(Comparability::Partial, &mut verdict);
            }
            None if ga.game_build.is_some() != gb.game_build.is_some() => {
                missing.push(("game-build", "The game's build wasn't recorded on one of these sessions.".into()));
            }
            _ => {}
        }

        // Frame-generation state — a blended real+generated FPS is not the same metric as a real one.
        condition_check(
            "frame-generation",
            ga.frame_generation_state.as_ref(),
            gb.frame_generation_state.as_ref(),
            |x, y| format!("Frame generation: {x} → {y}"),
            "Frame generation was configured differently — a blended (real + generated) frame rate \
             isn't the same measurement as a real one.",
            "The frame-generation setting wasn't recorded on one of these sessions.",
            Comparability::Partial,
            &mut changed,
            &mut missing,
            &mut reasons,
            &mut verdict,
            &mut lower,
        );

        // Windows build — a candidate cause, comparable otherwise.
        if let Some(true) = differs(ga.windows_build.as_ref(), gb.windows_build.as_ref()) {
            let (x, y) = (
                ga.windows_build.clone().unwrap_or_default(),
                gb.windows_build.clone().unwrap_or_default(),
            );
            changed.push(("windows-build", format!("Windows build: {x} → {y}")));
            candidates.push(format!(
                "Windows updated ({x} → {y}) — a candidate explanation to consider, not a proven cause."
            ));
        }

        // Active display identity — you switched monitors.
        if let Some(true) =
            differs(ga.active_display_identity.as_ref(), gb.active_display_identity.as_ref())
        {
            let (x, y) = (
                ga.active_display_identity.clone().unwrap_or_default(),
                gb.active_display_identity.clone().unwrap_or_default(),
            );
            changed.push(("display", format!("Display: {x} → {y}")));
            reasons.push("A different monitor was active between these sessions.".into());
            lower(Comparability::Partial, &mut verdict);
        }
    } else {
        missing.push((
            "conditions",
            "The conditions one of these sessions ran under weren't recorded — Compy can't confirm the \
             resolution, refresh, or graphics settings matched."
                .into(),
        ));
    }

    // ── Gaming Mode (CR-trial-gm-between): a Gaming Mode session lays its own temporary changes over
    // the PC (power plan, Game Bar, USB/PCIe power, service suspends), so a session it was on for at
    // any point and one it was off for ran on different settings. Recorded per session
    // (`gaming_mode_active`, any tick); compared only when both sides recorded it. A changed value is
    // a changed condition, which a Trial already folds into `confounded` (experiment.rs
    // `with_comparability`): the result is not pinned on the Trial's setting. ─────────────────────
    let on_off = |v: bool| if v { "on" } else { "off" };
    condition_check(
        "gaming-mode",
        a.gaming_mode_active.as_ref(),
        b.gaming_mode_active.as_ref(),
        |x, y| format!("Gaming Mode: {} → {}", on_off(*x), on_off(*y)),
        "Gaming Mode was on for one of these sessions and off for the other — it changes Windows \
         settings for its session, so the two ran on different settings.",
        "Whether Gaming Mode was on wasn't recorded on one of these sessions.",
        Comparability::Partial,
        &mut changed,
        &mut missing,
        &mut reasons,
        &mut verdict,
        &mut lower,
    );
    // CR-trial-plan-switch-confound: Gaming Mode on for both, but it leaves the power plan alone while
    // a Trial or the benchmark holds a setting of it, so one session can have run on its plan and the
    // other on the user's. Compared only when Gaming Mode was on for both. A session it switched the
    // plan for only part of ("mixed") never matches another: how much of each ran on which plan is
    // not recorded.
    if a.gaming_mode_active == Some(true) && b.gaming_mode_active == Some(true) {
        use crate::sessions::GamingModePlan;
        match (a.gaming_mode_plan, b.gaming_mode_plan) {
            (Some(x), Some(y)) if x != y || x == GamingModePlan::Mixed => {
                changed.push(("gaming-mode-plan", format!("Gaming Mode: {x} → {y}")));
                reasons.push(
                    "Gaming Mode was on for both sessions, but it didn't do the same with the power plan in \
                     each, so the two ran on different power plans."
                        .into(),
                );
                lower(Comparability::Partial, &mut verdict);
            }
            // Review r1 (opus SHOULD-FIX 2): a session saved before this was recorded ran Gaming Mode as
            // every older start did, setting its plan unless a test held it. Against a session that
            // left the plan alone (or did both), that is two plans at least as likely as one: a
            // changed condition, so a Trial across the upgrade can't claim a result on two plans.
            // Against one that set its plan, only missing context.
            (Some(x), None) | (None, Some(x)) if x != GamingModePlan::Switched => {
                let (from, to) = if a.gaming_mode_plan.is_some() {
                    (x.to_string(), "not recorded".to_string())
                } else {
                    ("not recorded".to_string(), x.to_string())
                };
                changed.push(("gaming-mode-plan", format!("Gaming Mode: {from} → {to}")));
                reasons.push(
                    "Gaming Mode was on for both sessions, but what it did with the power plan wasn't recorded \
                     on one of them and the other ran without its plan for a test, so the two may have run on \
                     different power plans."
                        .into(),
                );
                lower(Comparability::Partial, &mut verdict);
            }
            (Some(_), None) | (None, Some(_)) => missing.push((
                "gaming-mode-plan",
                "Whether Gaming Mode switched the power plan wasn't recorded on one of these sessions.".into(),
            )),
            _ => {}
        }
    }

    // ── Capture method + shared metrics: only metrics BOTH backends captured may be compared. ─────
    let shared_metrics = shared_metrics_of(a, b);
    match (a.capture_capabilities.as_ref(), b.capture_capabilities.as_ref()) {
        (Some(ca), Some(cb)) => {
            if !ca.same_method_as(cb) {
                changed.push((
                    "capture-method",
                    format!(
                        "Capture method: {} v{} → {} v{}",
                        ca.backend_id, ca.backend_version, cb.backend_id, cb.backend_version
                    ),
                ));
                if shared_metrics.is_empty() {
                    reasons.push(
                        "These sessions were captured by different methods with no metric in common — \
                         there's nothing that can be compared directly."
                            .into(),
                    );
                    lower(Comparability::NotComparable, &mut verdict);
                } else {
                    reasons.push(
                        "These sessions were captured by different methods — only the metrics both \
                         recorded were compared."
                            .into(),
                    );
                    lower(Comparability::Partial, &mut verdict);
                }
            }
        }
        _ => missing.push((
            "capture",
            "What the capture could measure wasn't recorded on one of these sessions — Compy can't \
             confirm they were measured the same way."
                .into(),
        )),
    }

    // ── No recorded context on either side to judge comparability at all → Unknown (never equal). ─
    if !have_rig_context
        && !have_condition_context
        && a.capture_capabilities.is_none()
        && b.capture_capabilities.is_none()
    {
        lower(Comparability::Unknown, &mut verdict);
    }

    // Any unrecorded condition means we couldn't verify like-for-like → cap at Partial. Missing
    // context NEVER leaves a verdict at Comparable.
    if !missing.is_empty() {
        lower(Comparability::Partial, &mut verdict);
    }

    finish(verdict, reasons, changed, missing, candidates, shared_metrics)
}

/// A resolution pair, only when BOTH width and height are known.
fn res_pair(g: &crate::game_state::GameStateFingerprint) -> Option<(u32, u32)> {
    match (g.resolution_width, g.resolution_height) {
        (Some(w), Some(h)) => Some((w, h)),
        _ => None,
    }
}

/// The metric axes both sessions' capture backends actually recorded. Empty when either side has no
/// recorded capabilities (the caller surfaces that as missing context).
fn shared_metrics_of(a: &SessionSummary, b: &SessionSummary) -> Vec<String> {
    match (a.capture_capabilities.as_ref(), b.capture_capabilities.as_ref()) {
        (Some(ca), Some(cb)) => ca.shared_metrics(cb).into_iter().map(String::from).collect(),
        _ => Vec::new(),
    }
}

/// A held-flat stretch is at least this many consecutive 10 s trace buckets (one minute).
const FLAT_MIN_BUCKETS: usize = 6;
/// Buckets within this many fps of each other count as held flat. Real play wanders by more than
/// this from one 10 s bucket to the next; a frame cap, a menu or a backgrounded game does not.
const FLAT_SPREAD_FPS: f64 = 2.0;

/// P4-comparable (Trial Protocol §7 "the workload becomes incomparable"): the stretches of one
/// session that weren't play, as far as the session's own records can tell. Additive on the
/// experiment record; every field defaults so older records load.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub(crate) struct SessionStretches {
    /// Seconds left out of the session's numbers because the game wasn't the window in front
    /// (`SessionSummary::background_secs_excluded`). `None` = the session didn't record focus, so nothing
    /// was left out on that ground.
    #[serde(default)]
    pub left_out_secs: Option<u32>,
    /// Seconds the frame-rate trace held flat (within `FLAT_SPREAD_FPS` for at least a minute):
    /// maybe a menu, a frame cap or the game in the background. Compy can't tell which, so these
    /// stretches stay in the numbers and are only named. 0 when none, or when there was no trace.
    #[serde(default)]
    pub flat_secs: u32,
    /// The frame rate the longest held-flat stretch sat at. `None` when there was none.
    #[serde(default)]
    pub flat_fps: Option<f64>,
    /// Whether the session still carried its frame-rate trace, so flat stretches could be looked for.
    #[serde(default)]
    pub traced: bool,
}

/// Pure: what `session`'s own records say about stretches that weren't play. Never classifies a
/// held-flat stretch as idle: it can't tell a menu from a frame cap, so it only measures it.
pub(crate) fn stretches_of(session: &SessionSummary) -> SessionStretches {
    let series = &session.fps_series;
    let step = crate::sessions::FPS_SERIES_BUCKET_SECS;
    let (mut flat_buckets, mut longest): (usize, Option<(usize, f64)>) = (0, None);
    let mut i = 0;
    while i < series.len() {
        let (mut lo, mut hi) = (series[i].1, series[i].1);
        let mut j = i + 1;
        while j < series.len() && series[j].0 == series[j - 1].0 + step {
            let f = series[j].1;
            if f.max(hi) - f.min(lo) > FLAT_SPREAD_FPS {
                break;
            }
            (lo, hi) = (f.min(lo), f.max(hi));
            j += 1;
        }
        let len = j - i;
        if len >= FLAT_MIN_BUCKETS {
            flat_buckets += len;
            let held = series[i..j].iter().map(|&(_, f)| f).sum::<f64>() / len as f64;
            if longest.is_none_or(|(n, _)| len > n) {
                longest = Some((len, (held * 10.0).round() / 10.0));
            }
            i = j;
        } else {
            i += 1;
        }
    }
    SessionStretches {
        left_out_secs: session.background_secs_excluded,
        flat_secs: flat_buckets as u32 * step,
        flat_fps: longest.map(|(_, f)| f),
        traced: !series.is_empty(),
    }
}

fn non_empty(s: &str) -> Option<&str> {
    let t = s.trim();
    (!t.is_empty()).then_some(t)
}

/// One both-known-and-differ condition check that records changed/missing context, a reason, and
/// lowers the verdict — the repeated shape for refresh / graphics-api / frame-gen.
#[allow(clippy::too_many_arguments)]
fn condition_check<T: PartialEq + std::fmt::Display>(
    key: &'static str,
    a: Option<&T>,
    b: Option<&T>,
    changed_line: impl Fn(&T, &T) -> String,
    changed_reason: &str,
    missing_reason: &str,
    on_change: Comparability,
    changed: &mut Vec<Keyed>,
    missing: &mut Vec<Keyed>,
    reasons: &mut Vec<String>,
    verdict: &mut Comparability,
    lower: &mut impl FnMut(Comparability, &mut Comparability),
) {
    match (a, b) {
        (Some(x), Some(y)) => {
            if x != y {
                changed.push((key, changed_line(x, y)));
                reasons.push(changed_reason.into());
                lower(on_change, verdict);
            }
        }
        (Some(_), None) | (None, Some(_)) => missing.push((key, missing_reason.into())),
        (None, None) => {}
    }
}

/// Assemble the descriptor: map the verdict → confidence ceiling + allowed conclusions, and add a
/// positive reason when nothing lowered the verdict.
fn finish(
    verdict: Comparability,
    mut reasons: Vec<String>,
    changed: Vec<Keyed>,
    missing: Vec<Keyed>,
    candidates: Vec<String>,
    shared_metrics: Vec<String>,
) -> SessionComparability {
    let confidence_limit = match verdict {
        Comparability::Comparable => Confidence::High,
        Comparability::Partial => Confidence::Medium,
        Comparability::Unknown => Confidence::Low,
        Comparability::NotComparable => Confidence::Unknown,
    };
    let allowed_conclusions = match verdict {
        Comparability::Comparable => vec![
            "These sessions are directly comparable — same game, same PC, same capture method.".into(),
            "A measured difference can be attributed to what changed between them.".into(),
        ],
        Comparability::Partial => {
            let mut c = vec![
                "Direct comparison is limited — some conditions changed or weren't recorded.".into(),
            ];
            if !shared_metrics.is_empty() {
                c.push("Only shared metrics were compared.".into());
            }
            c.push("A difference can't be isolated to a single cause from this pair alone.".into());
            c
        }
        Comparability::NotComparable => vec![
            "These sessions aren't directly comparable — any difference reflects what changed, not a \
             tweak you made."
                .into(),
        ],
        Comparability::Unknown => vec![
            "Not enough comparable evidence — the conditions these sessions ran under weren't recorded."
                .into(),
        ],
    };
    if verdict == Comparability::Comparable && reasons.is_empty() {
        reasons.push(
            "Same game, same PC, same capture method, and no changed condition detected.".into(),
        );
    }
    let (changed_keys, changed_context) = changed.into_iter().map(|(k, s)| (k.to_string(), s)).unzip();
    let (missing_keys, missing_context) = missing.into_iter().map(|(k, s)| (k.to_string(), s)).unzip();
    SessionComparability {
        verdict,
        reasons,
        changed_context,
        missing_context,
        changed_keys,
        missing_keys,
        candidate_causes: candidates,
        shared_metrics,
        confidence_limit,
        allowed_conclusions,
    }
}

/// Terminal NotComparable (different game / no common metric) — skips the condition machinery.
fn not_comparable(
    reason: String,
    changed: Vec<Keyed>,
    shared_metrics: Vec<String>,
) -> SessionComparability {
    finish(
        Comparability::NotComparable,
        vec![reason],
        changed,
        Vec::new(),
        Vec::new(),
        shared_metrics,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::capture::CaptureCapabilities;
    use crate::game_state::GameStateFingerprint;
    use crate::hardware::HwFingerprint;

    fn fp(gpu: &str, driver: &str, ram: u32, display: &str) -> HwFingerprint {
        HwFingerprint {
            hash: "deadbeef".into(),
            gpu: gpu.into(),
            gpu_driver: driver.into(),
            ram_gb: ram,
            display: display.into(),
        }
    }

    fn gs() -> GameStateFingerprint {
        GameStateFingerprint {
            resolution_width: Some(2560),
            resolution_height: Some(1440),
            display_refresh_hz: Some(165),
            graphics_api: Some("DirectX 12".into()),
            windows_build: Some("26200.1".into()),
            ..Default::default()
        }
    }

    /// A fully-populated modern session; mutate the clone per test.
    fn session() -> SessionSummary {
        SessionSummary {
            started_at: "2026-07-18T00:00:00Z".into(),
            duration_secs: 600,
            process_name: "cs2.exe".into(),
            samples: 600,
            avg_fps: 200.0,
            avg_frametime_ms: 5.0,
            low1_fps_est: 150.0,
            peak_gpu_temp_c: None,
            peak_gpu_usage_pct: None,
            peak_ram_used_bytes: None,
            ram_total_bytes: None,
            compy_changes_active: Some(0),
            compy_changes_per_change: true,
            compy_changes_cant_confirm: Some(0),
            compy_changes_legacy_active: None,
            compy_changes_since_set_aside: None,
            hw_fingerprint: Some(fp("Radeon RX 9070 XT", "25.7.1", 32, "2560x1440@165")),
            gaming_mode_active: Some(false),
            gaming_mode_plan: None,
            stutter_insight: None,
            stutter_timeline: Vec::new(),
            stutter_events: Vec::new(),
            fps_series: Vec::new(),
            capture_capabilities: Some(CaptureCapabilities::etw_dxgi(None)),
            game_state: Some(gs()),
            peak_cpu_temp_c: None,
            peak_gpu_hotspot_temp_c: None,
            background_secs_excluded: None,
            frame_pacing: None,
            gpu_load: None,
            frame_cap: None,
        }
    }

    #[test]
    fn identical_modern_sessions_are_comparable() {
        let a = session();
        let b = session();
        let c = derive(&a, &b);
        assert_eq!(c.verdict, Comparability::Comparable);
        assert_eq!(c.confidence_limit, Confidence::High);
        assert!(c.changed_context.is_empty());
        assert!(c.missing_context.is_empty());
        assert_eq!(c.shared_metrics, vec!["app_fps"]);
        assert!(!c.reasons.is_empty());
    }

    // CR-trial-gm-between: a Trial never noticed Gaming Mode being on for one of its sessions and off
    // for the other. It is now a changed condition (Partial), which a Trial folds into `confounded`.
    #[test]
    fn gaming_mode_on_for_one_session_only_is_a_changed_condition() {
        let a = session();
        let mut b = session();
        b.gaming_mode_active = Some(true);
        let c = derive(&a, &b);
        assert_eq!(c.verdict, Comparability::Partial);
        assert_eq!(c.changed_keys, vec!["gaming-mode"]);
        assert_eq!(c.changed_context, vec!["Gaming Mode: off → on"]);
        // (experiment.rs pins the Trial fold: a changed condition is `confounded` and restores.)
        // On for both, off for both: the same condition.
        let mut both = session();
        both.gaming_mode_active = Some(true);
        assert_eq!(derive(&both, &b).verdict, Comparability::Comparable);
        assert_eq!(derive(&a, &session()).verdict, Comparability::Comparable);
        // Recorded on one side only: missing context, never "equal", never a changed condition.
        let mut old = session();
        old.gaming_mode_active = None;
        let m = derive(&old, &b);
        assert!(m.changed_keys.is_empty());
        assert!(m.missing_keys.contains(&"gaming-mode".to_string()), "{:?}", m.missing_keys);
    }

    // CR-trial-plan-switch-confound: Gaming Mode on for both sessions, but it switched the power plan
    // for one (the baseline) and left it alone for the other (a USB/PCIe Trial held a setting of it).
    #[test]
    fn gaming_mode_on_for_both_but_the_plan_handled_differently_is_a_changed_condition() {
        use crate::sessions::GamingModePlan as P;
        let gm = |plan: Option<P>| {
            let mut s = session();
            (s.gaming_mode_active, s.gaming_mode_plan) = (Some(true), plan);
            s
        };
        let c = derive(&gm(Some(P::Switched)), &gm(Some(P::LeftAlone)));
        assert_eq!(c.verdict, Comparability::Partial);
        assert_eq!(c.changed_keys, vec!["gaming-mode-plan"]);
        assert_eq!(c.changed_context, vec!["Gaming Mode: set its power plan → left the power plan alone for a test"]);
        let half = derive(&gm(Some(P::Mixed)), &gm(Some(P::Switched)));
        assert_eq!(half.changed_keys, vec!["gaming-mode-plan"], "part of one session on each plan");
        // The same handling both times: the same condition.
        assert_eq!(derive(&gm(Some(P::Switched)), &gm(Some(P::Switched))).verdict, Comparability::Comparable);
        assert_eq!(derive(&gm(Some(P::LeftAlone)), &gm(Some(P::LeftAlone))).verdict, Comparability::Comparable);
        // Part of each session on each plan: never the same condition, even as another such session.
        let mixed = derive(&gm(Some(P::Mixed)), &gm(Some(P::Mixed)));
        assert_eq!((mixed.verdict, mixed.changed_keys.clone()), (Comparability::Partial, vec!["gaming-mode-plan".to_string()]));
        // Recorded on one side only (a session saved before this was recorded): against one that set its
        // plan, missing context; against one that left it alone for a test (or did both), a changed
        // condition (review r1, opus SHOULD-FIX 2: a Trial across the upgrade never claims on two plans).
        let m = derive(&gm(None), &gm(Some(P::Switched)));
        assert!(m.changed_keys.is_empty());
        assert!(m.missing_keys.contains(&"gaming-mode-plan".to_string()), "{:?}", m.missing_keys);
        for later in [P::LeftAlone, P::Mixed] {
            let u = derive(&gm(None), &gm(Some(later)));
            assert_eq!((u.verdict, u.changed_keys.clone()), (Comparability::Partial, vec!["gaming-mode-plan".to_string()]), "{later:?}");
            assert_eq!(derive(&gm(Some(later)), &gm(None)).verdict, Comparability::Partial, "either order");
        }
        assert_eq!(
            derive(&gm(None), &gm(Some(P::LeftAlone))).changed_context,
            vec!["Gaming Mode: not recorded → left the power plan alone for a test"]
        );
        // Gaming Mode off for both: nothing to compare (the field is None there anyway).
        assert_eq!(derive(&session(), &session()).verdict, Comparability::Comparable);
        // On for one only: the Gaming Mode condition already names it; the plan isn't listed twice.
        let one = derive(&session(), &gm(Some(P::Switched)));
        assert_eq!(one.changed_keys, vec!["gaming-mode"]);
    }

    #[test]
    fn different_game_is_not_comparable() {
        // Task H guard: game-process mismatch blocks direct comparison.
        let a = session();
        let mut b = session();
        b.process_name = "valorant.exe".into();
        let c = derive(&a, &b);
        assert_eq!(c.verdict, Comparability::NotComparable);
        assert_eq!(c.confidence_limit, Confidence::Unknown);
    }

    #[test]
    fn resolution_change_limits_attribution() {
        // Task H guard: a resolution change limits attribution → Partial, never Comparable.
        let a = session();
        let mut b = session();
        if let Some(g) = b.game_state.as_mut() {
            g.resolution_width = Some(1920);
            g.resolution_height = Some(1080);
        }
        let c = derive(&a, &b);
        assert_eq!(c.verdict, Comparability::Partial);
        assert!(c.changed_context.iter().any(|s| s.contains("Resolution")));
        assert!(c.reasons.iter().any(|s| s.to_lowercase().contains("resolution")));
        assert!(c.confidence_limit <= Confidence::Medium);
    }

    #[test]
    fn gpu_change_is_not_comparable_and_a_candidate_not_a_proven_cause() {
        let a = session();
        let mut b = session();
        b.hw_fingerprint = Some(fp("GeForce RTX 4090", "560.0", 32, "2560x1440@165"));
        let c = derive(&a, &b);
        assert_eq!(c.verdict, Comparability::NotComparable);
        assert!(c.changed_context.iter().any(|s| s.contains("GPU")));
        assert!(c.candidate_causes.iter().any(|s| s.to_lowercase().contains("gpu")));
    }

    #[test]
    fn driver_change_stays_comparable_as_a_candidate_not_automatic_cause() {
        // Task H guard: a driver change is a CANDIDATE, not an automatic cause — the sessions stay
        // comparable for regression detection.
        let a = session();
        let mut b = session();
        if let Some(f) = b.hw_fingerprint.as_mut() {
            f.gpu_driver = "25.8.1".into();
        }
        let c = derive(&a, &b);
        assert_eq!(c.verdict, Comparability::Comparable);
        assert!(c.changed_context.iter().any(|s| s.contains("driver")));
        assert!(
            c.candidate_causes.iter().any(|s| s.to_lowercase().contains("driver")),
            "driver must be offered as a candidate cause"
        );
        // Never asserted as THE cause.
        assert!(!c.candidate_causes.iter().any(|s| s.to_lowercase().contains("caused")));
    }

    #[test]
    fn different_backends_compare_only_shared_metrics() {
        // Task H guard: different backends compare only common metrics.
        let a = session();
        let mut b = session();
        let mut richer = CaptureCapabilities::etw_dxgi(None);
        richer.backend_id = "presentmon-2x".into();
        richer.supports_presented_fps = true;
        richer.supports_gpu_busy = true;
        b.capture_capabilities = Some(richer);
        let c = derive(&a, &b);
        assert_eq!(c.verdict, Comparability::Partial);
        assert_eq!(c.shared_metrics, vec!["app_fps"], "only the common axis is offered");
        assert!(c.reasons.iter().any(|s| s.to_lowercase().contains("only the metrics both")));
        assert!(c.allowed_conclusions.iter().any(|s| s.contains("Only shared metrics were compared")));
    }

    #[test]
    fn missing_context_never_becomes_equal() {
        // Task H guard: an unrecorded condition never silently becomes "the same" — it caps at
        // Partial with recorded missing context, never Comparable.
        let a = session();
        let mut b = session();
        b.game_state = None; // conditions unrecorded on one side
        let c = derive(&a, &b);
        assert_eq!(c.verdict, Comparability::Partial);
        assert!(!c.missing_context.is_empty());
        assert_ne!(c.verdict, Comparability::Comparable);
    }

    #[test]
    fn pre_2_0_sessions_with_no_context_are_unknown_never_assumed_equal() {
        // Two legacy sessions: same game, but no rig / capabilities / conditions recorded. We must
        // NOT claim them comparable — honestly Unknown.
        let mut a = session();
        let mut b = session();
        for s in [&mut a, &mut b] {
            s.hw_fingerprint = None;
            s.capture_capabilities = None;
            s.game_state = None;
        }
        let c = derive(&a, &b);
        assert_eq!(c.verdict, Comparability::Unknown);
        assert_eq!(c.confidence_limit, Confidence::Low);
        assert!(c.allowed_conclusions.iter().any(|s| s.contains("Not enough comparable evidence")));
    }

    #[test]
    fn confidence_limit_is_a_band_never_a_number() {
        // Task H guard: no arbitrary numeric confidence — the ceiling is always one of the bands.
        let c = derive(&session(), &session());
        let json = serde_json::to_value(&c).unwrap();
        assert!(json["confidence_limit"].is_string(), "confidence must serialize as a band string");
        assert_eq!(json["confidence_limit"], "high");
    }

    #[test]
    fn ram_change_is_partial_and_a_candidate() {
        let a = session();
        let mut b = session();
        if let Some(f) = b.hw_fingerprint.as_mut() {
            f.ram_gb = 16;
        }
        let c = derive(&a, &b);
        assert_eq!(c.verdict, Comparability::Partial);
        assert!(c.changed_context.iter().any(|s| s.contains("RAM")));
        assert!(c.candidate_causes.iter().any(|s| s.to_lowercase().contains("memory")));
    }

    #[test]
    fn windows_update_is_a_candidate_but_stays_comparable() {
        let a = session();
        let mut b = session();
        if let Some(g) = b.game_state.as_mut() {
            g.windows_build = Some("26200.9".into());
        }
        let c = derive(&a, &b);
        // A Windows build change alone keeps the sessions comparable, flagged as a candidate.
        assert_eq!(c.verdict, Comparability::Comparable);
        assert!(c.changed_context.iter().any(|s| s.contains("Windows")));
        assert!(c.candidate_causes.iter().any(|s| s.to_lowercase().contains("windows")));
    }

    #[test]
    fn output_round_trips_through_serde() {
        let c = derive(&session(), &session());
        let json = serde_json::to_string(&c).unwrap();
        let back: SessionComparability = serde_json::from_str(&json).unwrap();
        assert_eq!(c, back);
    }

    #[test]
    fn every_context_line_carries_its_key_in_the_same_order() {
        // P4-comparable: a surface says what differed from the keys, so each line needs its key.
        let a = session();
        let mut b = session();
        if let Some(g) = b.game_state.as_mut() {
            g.resolution_width = Some(1920);
            g.resolution_height = Some(1080);
            g.graphics_api = None;
        }
        let c = derive(&a, &b);
        assert_eq!(c.verdict, Comparability::Partial);
        assert_eq!(c.changed_keys, vec!["resolution"]);
        assert_eq!(c.missing_keys, vec!["graphics-api"]);
        assert_eq!(c.changed_keys.len(), c.changed_context.len());
        assert_eq!(c.missing_keys.len(), c.missing_context.len());

        let mut bare = session();
        bare.hw_fingerprint = None;
        bare.game_state = None;
        let c = derive(&a, &bare);
        assert_eq!(c.missing_keys, vec!["rig", "conditions"]);
        assert_eq!(c.missing_keys.len(), c.missing_context.len());

        let mut newer = session();
        if let Some(f) = newer.hw_fingerprint.as_mut() {
            f.gpu_driver = "25.8.1".into();
            f.ram_gb = 16;
        }
        assert_eq!(derive(&a, &newer).changed_keys, vec!["ram", "gpu-driver"]);
    }

    // s37 (s35 opus NIT): the driver is compared as the Trial preflight compares it, case-insensitively.
    #[test]
    fn the_same_driver_written_in_another_case_is_not_a_change() {
        let a = session();
        let mut b = session();
        let f = b.hw_fingerprint.as_mut().expect("the fixture has a fingerprint");
        f.gpu_driver = f.gpu_driver.to_uppercase() + "-RC";
        assert_eq!(derive(&a, &b).changed_keys, vec!["gpu-driver"], "a different driver is still a change");
        let mut c = session();
        let f = c.hw_fingerprint.as_mut().unwrap();
        f.gpu_driver = format!("{}Abc", f.gpu_driver);
        let mut d = session();
        let g = d.hw_fingerprint.as_mut().unwrap();
        g.gpu_driver = format!("{}aBC ", g.gpu_driver);
        let p = derive(&c, &d);
        assert!(p.changed_keys.is_empty(), "{:?}", p.changed_context);
        assert!(p.candidate_causes.iter().all(|s| !s.contains("driver")), "{:?}", p.candidate_causes);
    }

    #[test]
    fn a_comparability_payload_without_keys_still_loads() {
        // Additive: a payload written before P4-comparable carries no keys and loads with none.
        let mut v = serde_json::to_value(derive(&session(), &session())).unwrap();
        let obj = v.as_object_mut().unwrap();
        assert!(obj.remove("changed_keys").is_some() && obj.remove("missing_keys").is_some());
        let old: SessionComparability = serde_json::from_value(v).unwrap();
        assert!(old.changed_keys.is_empty() && old.missing_keys.is_empty());
    }

    /// The owner's real WARDOGS session of 2026-10-25T09:39 UTC (1697 s, 1688 readings), its 10 s
    /// frame-rate trace exactly as sessions.json recorded it. From 700 s on it sits at 120 fps: the
    /// owner was away from the game, but nothing recorded says whether it was a menu or the game in
    /// the background.
    const WARDOGS_0939_FPS: [f64; 170] = [
        206.0, 185.4, 199.9, 185.5, 192.6, 196.0, 193.7, 208.3, 215.3, 214.8, 189.4, 185.2, 182.7, 184.8,
        197.5, 193.7, 199.6, 184.9, 189.7, 179.6, 191.1, 193.4, 201.6, 202.6, 199.5, 202.7, 217.1, 212.3,
        218.1, 208.5, 204.1, 211.9, 209.7, 225.1, 220.5, 229.4, 217.8, 212.6, 207.1, 205.4, 208.8, 215.7,
        202.0, 225.6, 239.7, 230.3, 230.7, 234.0, 233.1, 230.8, 228.3, 221.0, 217.1, 226.3, 227.9, 235.8,
        229.6, 234.3, 224.7, 219.0, 208.9, 211.1, 209.7, 209.2, 208.9, 193.3, 187.3, 196.3, 183.4, 149.3,
        120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0,
        120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0,
        120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0,
        120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0,
        120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0,
        120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0,
        120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0, 120.0,
        120.0, 116.3,    ];

    fn traced(fps: &[f64]) -> SessionSummary {
        let mut s = session();
        s.fps_series = fps.iter().enumerate().map(|(i, &f)| (i as u32 * 10, f)).collect();
        s
    }

    #[test]
    fn a_held_flat_stretch_is_named_and_kept_never_left_out() {
        let st = stretches_of(&traced(&WARDOGS_0939_FPS));
        assert_eq!(st.flat_secs, 990, "700 s to the end held at 120 fps");
        assert_eq!(st.flat_fps, Some(120.0));
        // This session didn't record focus, so nothing was left out on that ground.
        assert_eq!(st.left_out_secs, None);
        assert!(st.traced);
        // The first 700 s were real play (185-220 fps, wandering): not one held-flat minute there.
        assert_eq!(stretches_of(&traced(&WARDOGS_0939_FPS[..70])).flat_secs, 0);
    }

    #[test]
    fn held_flat_needs_a_full_minute_with_no_gap() {
        // Five flat buckets (50 s) are not a stretch; six are.
        let mut five = vec![200.0, 230.0];
        five.extend([120.0; 5]);
        five.push(250.0);
        assert_eq!(stretches_of(&traced(&five)).flat_secs, 0);
        let six: Vec<f64> = [120.0; 6].to_vec();
        assert_eq!(stretches_of(&traced(&six)).flat_secs, 60);
        // A gap in the trace (no reading) splits a run: two 30 s halves are not a minute.
        let mut s = traced(&six);
        for p in s.fps_series.iter_mut().skip(3) {
            p.0 += 100;
        }
        assert_eq!(stretches_of(&s).flat_secs, 0);
        // A session that shed its trace says it couldn't be looked at, not that it was clean.
        let st = stretches_of(&session());
        assert!(!st.traced);
        assert_eq!(st.flat_secs, 0);
    }

    #[test]
    fn background_time_rides_along_from_the_session() {
        let mut s = traced(&WARDOGS_0939_FPS[..70]);
        s.background_secs_excluded = Some(600);
        assert_eq!(stretches_of(&s).left_out_secs, Some(600));
    }
}
