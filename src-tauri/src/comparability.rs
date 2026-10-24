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
}

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
    let mut changed: Vec<String> = Vec::new();
    let mut missing: Vec<String> = Vec::new();
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
        _ => missing.push(
            "The presenting game wasn't recorded on one of these sessions — Compy can't confirm they're \
             the same game."
                .into(),
        ),
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
                changed.push(format!("GPU: {} → {}", fa.gpu, fb.gpu));
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
                changed.push(format!("RAM: {} GB → {} GB", fa.ram_gb, fb.ram_gb));
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
                changed.push(format!("Display mode: {} → {}", fa.display, fb.display));
                reasons.push(
                    "The display resolution or refresh changed — that changes the workload, so a \
                     difference can't be isolated to a single cause."
                        .into(),
                );
                lower(Comparability::Partial, &mut verdict);
            }
            // Driver change → KEEP comparable for regression detection, but flag as the first
            // candidate to check. Correlation, never automatic cause.
            if fa.gpu_driver != fb.gpu_driver && fa.gpu == fb.gpu {
                changed.push(format!("GPU driver: {} → {}", fa.gpu_driver, fb.gpu_driver));
                candidates.push(format!(
                    "The GPU driver changed ({} → {}) — a candidate explanation to check first, not a \
                     proven cause.",
                    fa.gpu_driver, fb.gpu_driver
                ));
            }
        }
        _ => missing.push(
            "The PC's hardware wasn't recorded on one of these sessions — Compy can't confirm they ran on \
             the same rig."
                .into(),
        ),
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
                changed.push(format!("Resolution: {wa}×{ha} → {wb}×{hb}"));
                reasons.push(
                    "The display resolution changed — that changes how hard the PC is working, so a \
                     difference can't be attributed to anything else on its own."
                        .into(),
                );
                lower(Comparability::Partial, &mut verdict);
            }
            None if res_a.is_none() || res_b.is_none() => missing
                .push("The resolution wasn't recorded on one of these sessions.".into()),
            _ => {}
        }

        // Refresh — a cap on the achievable frame rate.
        condition_check(
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
                changed.push(format!("Game build: {x} → {y}"));
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
                missing.push("The game's build wasn't recorded on one of these sessions.".into());
            }
            _ => {}
        }

        // Frame-generation state — a blended real+generated FPS is not the same metric as a real one.
        condition_check(
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
            changed.push(format!("Windows build: {x} → {y}"));
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
            changed.push(format!("Display: {x} → {y}"));
            reasons.push("A different monitor was active between these sessions.".into());
            lower(Comparability::Partial, &mut verdict);
        }
    } else {
        missing.push(
            "The conditions one of these sessions ran under weren't recorded — Compy can't confirm the \
             resolution, refresh, or graphics settings matched."
                .into(),
        );
    }

    // ── Capture method + shared metrics: only metrics BOTH backends captured may be compared. ─────
    let shared_metrics = shared_metrics_of(a, b);
    match (a.capture_capabilities.as_ref(), b.capture_capabilities.as_ref()) {
        (Some(ca), Some(cb)) => {
            if !ca.same_method_as(cb) {
                changed.push(format!(
                    "Capture method: {} v{} → {} v{}",
                    ca.backend_id, ca.backend_version, cb.backend_id, cb.backend_version
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
        _ => missing.push(
            "What the capture could measure wasn't recorded on one of these sessions — Compy can't \
             confirm they were measured the same way."
                .into(),
        ),
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

fn non_empty(s: &str) -> Option<&str> {
    let t = s.trim();
    (!t.is_empty()).then_some(t)
}

/// One both-known-and-differ condition check that records changed/missing context, a reason, and
/// lowers the verdict — the repeated shape for refresh / graphics-api / frame-gen.
#[allow(clippy::too_many_arguments)]
fn condition_check<T: PartialEq + std::fmt::Display>(
    a: Option<&T>,
    b: Option<&T>,
    changed_line: impl Fn(&T, &T) -> String,
    changed_reason: &str,
    missing_reason: &str,
    on_change: Comparability,
    changed: &mut Vec<String>,
    missing: &mut Vec<String>,
    reasons: &mut Vec<String>,
    verdict: &mut Comparability,
    lower: &mut impl FnMut(Comparability, &mut Comparability),
) {
    match (a, b) {
        (Some(x), Some(y)) => {
            if x != y {
                changed.push(changed_line(x, y));
                reasons.push(changed_reason.into());
                lower(on_change, verdict);
            }
        }
        (Some(_), None) | (None, Some(_)) => missing.push(missing_reason.into()),
        (None, None) => {}
    }
}

/// Assemble the descriptor: map the verdict → confidence ceiling + allowed conclusions, and add a
/// positive reason when nothing lowered the verdict.
fn finish(
    verdict: Comparability,
    mut reasons: Vec<String>,
    changed: Vec<String>,
    missing: Vec<String>,
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
    SessionComparability {
        verdict,
        reasons,
        changed_context: changed,
        missing_context: missing,
        candidate_causes: candidates,
        shared_metrics,
        confidence_limit,
        allowed_conclusions,
    }
}

/// Terminal NotComparable (different game / no common metric) — skips the condition machinery.
fn not_comparable(
    reason: String,
    changed: Vec<String>,
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
            hw_fingerprint: Some(fp("Radeon RX 9070 XT", "25.7.1", 32, "2560x1440@165")),
            gaming_mode_active: Some(false),
            stutter_insight: None,
            stutter_timeline: Vec::new(),
            stutter_events: Vec::new(),
            fps_series: Vec::new(),
            capture_capabilities: Some(CaptureCapabilities::etw_dxgi(None)),
            game_state: Some(gs()),
            peak_cpu_temp_c: None,
            peak_gpu_hotspot_temp_c: None,
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
}
