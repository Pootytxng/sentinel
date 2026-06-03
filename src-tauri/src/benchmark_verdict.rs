//! Verdict engine — the benchmark "science" layer [A] (spec: Verdict Engine + Competitive).
//!
//! Decides whether a tweak ACTUALLY helped, from the real frametime stream. Pure +
//! unit-tested; it *consumes* telemetry (the `fps.rs` frametime stream), never captures it.
//! Wired to commands / the scoreboard in later phases (P2/P3) — dark for now.
//!
//! Method (per spec — distribution comparison, NOT means): frametime is fat-tailed and the
//! stutters live in the right tail, so the verdict keys on the **1% / 0.1% low FPS**
//! (percentiles), compared with a **bootstrap CI on the median delta** against a
//! **self-calibrated noise floor** — the rig's own baseline run-to-run spread, not a
//! hardcoded percent. `Keep` only when the CI excludes zero AND clears that floor.
#![allow(dead_code)] // engine core: wired to commands + scoreboard in P2/P3.

use crate::benchmark::DEFAULT_NOISE_FLOOR_PCT; // fallback floor when calibration is weak
use serde::Serialize;

// ── Tiny deterministic PRNG (SplitMix64) — bootstrap resampling without a `rand` dep ──
// Fixed seed → reproducible verdicts (same trial in → same verdict out), which also makes
// the statistical tests deterministic.
struct Rng(u64);
impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed)
    }
    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    /// Uniform index in `[0, n)`.
    fn below(&mut self, n: usize) -> usize {
        (self.next_u64() % n as u64) as usize
    }
}

// ── Pure stats ──────────────────────────────────────────────────────────────

/// Linear-interpolated quantile (`q` in 0..=1) of an unsorted slice. `None` if empty.
fn quantile(xs: &[f64], q: f64) -> Option<f64> {
    if xs.is_empty() {
        return None;
    }
    let mut s = xs.to_vec();
    s.sort_by(|a, b| a.total_cmp(b));
    let q = q.clamp(0.0, 1.0);
    let pos = q * (s.len() - 1) as f64;
    let lo = pos.floor() as usize;
    let hi = pos.ceil() as usize;
    if lo == hi {
        Some(s[lo])
    } else {
        let frac = pos - lo as f64;
        Some(s[lo] * (1.0 - frac) + s[hi] * frac)
    }
}

fn median(xs: &[f64]) -> Option<f64> {
    quantile(xs, 0.5)
}

fn mean(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        return 0.0;
    }
    xs.iter().sum::<f64>() / xs.len() as f64
}

/// Sample standard deviation.
fn stdev(xs: &[f64]) -> f64 {
    if xs.len() < 2 {
        return 0.0;
    }
    let m = mean(xs);
    let var = xs.iter().map(|x| (x - m).powi(2)).sum::<f64>() / (xs.len() - 1) as f64;
    var.sqrt()
}

/// Coefficient of variation (%) — run-to-run spread relative to the level. 0 if mean ≤ 0.
fn cov_pct(xs: &[f64]) -> f64 {
    let m = mean(xs);
    if m <= 0.0 {
        return 0.0;
    }
    stdev(xs) / m * 100.0
}

/// "X% low FPS" = 1000 / (the worst-X% frametime), i.e. the high-percentile frametime
/// converted to a rate. 1% low → `q=0.99`; 0.1% low → `q=0.999`. Higher = better.
fn low_fps(frametimes_ms: &[f64], q: f64) -> Option<f64> {
    let ft = quantile(frametimes_ms, q)?;
    if ft <= 0.0 {
        None
    } else {
        Some(1000.0 / ft)
    }
}

/// % of frames whose frametime exceeds 1.5× the median — a simple stutter proxy.
fn stutter_pct(frametimes_ms: &[f64]) -> f64 {
    let Some(med) = median(frametimes_ms) else {
        return 0.0;
    };
    if med <= 0.0 || frametimes_ms.is_empty() {
        return 0.0;
    }
    let thresh = med * 1.5;
    let n = frametimes_ms.iter().filter(|&&f| f > thresh).count();
    n as f64 / frametimes_ms.len() as f64 * 100.0
}

// ── MetricWindow — one measured slice of gameplay ─────────────────────────────

/// Validity context for a window (from sensors / the trial driver).
#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct WindowCtx {
    pub avg_clock_mhz: f64,
    pub max_temp_c: f64,
    pub bg_load_flag: bool,
    pub input_to_photon_ms: Option<f64>,
}

/// Frametime distribution + derived stats for one window, plus validity context. The verdict
/// keys on the percentile lows (fat-tail aware), never `avg_fps` (kept for display only).
#[derive(Serialize, Clone, Debug)]
pub(crate) struct MetricWindow {
    pub avg_fps: f64,
    pub p1_low_fps: f64,
    pub p01_low_fps: f64,
    pub frametime_stdev_ms: f64,
    pub stutter_pct: f64,
    pub frame_count: usize,
    pub input_to_photon_ms: Option<f64>,
    pub avg_clock_mhz: f64,
    pub max_temp_c: f64,
    pub bg_load_flag: bool,
}

/// Below this, the percentile lows are noise — reject the window rather than invent a number.
const MIN_FRAMES: usize = 60;

impl MetricWindow {
    /// Derive a window from raw frametimes (ms). `None` if too few valid frames.
    pub fn from_frametimes(frametimes_ms: &[f64], ctx: WindowCtx) -> Option<Self> {
        let valid: Vec<f64> =
            frametimes_ms.iter().copied().filter(|f| f.is_finite() && *f > 0.0).collect();
        if valid.len() < MIN_FRAMES {
            return None;
        }
        let avg_ft = mean(&valid);
        Some(Self {
            avg_fps: if avg_ft > 0.0 { 1000.0 / avg_ft } else { 0.0 },
            p1_low_fps: low_fps(&valid, 0.99)?,
            p01_low_fps: low_fps(&valid, 0.999)?,
            frametime_stdev_ms: stdev(&valid),
            stutter_pct: stutter_pct(&valid),
            frame_count: valid.len(),
            input_to_photon_ms: ctx.input_to_photon_ms,
            avg_clock_mhz: ctx.avg_clock_mhz,
            max_temp_c: ctx.max_temp_c,
            bg_load_flag: ctx.bg_load_flag,
        })
    }
}

// ── Verdict ───────────────────────────────────────────────────────────────────

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum InconclusiveReason {
    /// The change didn't clear the rig's own run-to-run noise floor.
    WithinNoise,
    /// The baseline itself was too noisy to measure against right now.
    ConditionsUnstable,
    /// Throttling / background interference invalidated the comparison — discarded, not reported.
    InvalidTrial,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "verdict", rename_all = "kebab-case")]
pub(crate) enum Verdict {
    /// The tweak helped: the metric improved beyond the noise floor with a CI excluding zero.
    Keep { effect_pct: f64, ci_lo_pct: f64, ci_hi_pct: f64, metric: String },
    /// The tweak hurt: a metric regressed beyond the noise floor.
    Revert { effect_pct: f64, ci_lo_pct: f64, ci_hi_pct: f64, metric: String },
    Inconclusive { reason: InconclusiveReason },
}

const BOOTSTRAP_ITERS: usize = 2000;
const SEED: u64 = 0x5E71_4E10_0BA5_E11E;
const MIN_WINDOWS: usize = 4;
/// Treatment clocks diverging this far from baseline ⇒ throttling ⇒ invalid comparison.
const CLOCK_DIVERGE_PCT: f64 = 8.0;
const TEMP_DIVERGE_C: f64 = 12.0;
/// Baseline run-to-run spread above this ⇒ too noisy to judge anything.
const UNSTABLE_BASELINE_COV_PCT: f64 = 25.0;

/// Bootstrap the % change in median from `before`→`after` (a higher-is-better metric).
/// Returns `(point_estimate_pct, ci_lo_pct, ci_hi_pct)`. `None` if a median can't be formed.
fn bootstrap_median_pct_change(before: &[f64], after: &[f64]) -> Option<(f64, f64, f64)> {
    let b0 = median(before)?;
    let a0 = median(after)?;
    if b0 <= 0.0 {
        return None;
    }
    let point = (a0 - b0) / b0 * 100.0;
    let mut rng = Rng::new(SEED);
    let mut samples = Vec::with_capacity(BOOTSTRAP_ITERS);
    for _ in 0..BOOTSTRAP_ITERS {
        let bm = resample_median(before, &mut rng);
        let am = resample_median(after, &mut rng);
        if bm > 0.0 {
            samples.push((am - bm) / bm * 100.0);
        }
    }
    let lo = quantile(&samples, 0.025)?;
    let hi = quantile(&samples, 0.975)?;
    Some((point, lo, hi))
}

fn resample_median(xs: &[f64], rng: &mut Rng) -> f64 {
    let draw: Vec<f64> = (0..xs.len()).map(|_| xs[rng.below(xs.len())]).collect();
    median(&draw).unwrap_or(0.0)
}

struct MetricEval {
    name: &'static str,
    effect_pct: f64,
    ci_lo: f64,
    ci_hi: f64,
    floor_pct: f64,
}

impl MetricEval {
    /// Significant iff the CI excludes zero AND the effect clears the self-calibrated floor.
    fn significant(&self) -> bool {
        let excludes_zero =
            (self.ci_lo > 0.0 && self.ci_hi > 0.0) || (self.ci_lo < 0.0 && self.ci_hi < 0.0);
        excludes_zero && self.effect_pct.abs() > self.floor_pct
    }
    fn improved(&self) -> bool {
        self.significant() && self.effect_pct > 0.0
    }
    fn regressed(&self) -> bool {
        self.significant() && self.effect_pct < 0.0
    }
}

/// Evaluate one higher-is-better metric. Floor self-calibrates to the baseline's own run-to-run
/// spread, never below the conservative default.
fn eval_metric(name: &'static str, baseline: &[f64], treatment: &[f64]) -> Option<MetricEval> {
    let (effect, lo, hi) = bootstrap_median_pct_change(baseline, treatment)?;
    let floor = cov_pct(baseline).max(DEFAULT_NOISE_FLOOR_PCT);
    Some(MetricEval { name, effect_pct: effect, ci_lo: lo, ci_hi: hi, floor_pct: floor })
}

/// A measured experiment: interleaved baseline vs treatment windows for one tweak.
pub(crate) struct Trial {
    pub baseline: Vec<MetricWindow>,
    pub treatment: Vec<MetricWindow>,
}

impl Trial {
    /// The honest verdict. Validity gates run first; then the percentile-low metrics are compared
    /// non-parametrically. A regression in ANY key metric → `Revert`; a clear improvement with no
    /// regression → `Keep`; otherwise `Inconclusive`.
    pub fn verdict(&self) -> Verdict {
        // ── Validity gates (run before any verdict) ──
        if self.baseline.len() < MIN_WINDOWS || self.treatment.len() < MIN_WINDOWS {
            return Verdict::Inconclusive { reason: InconclusiveReason::ConditionsUnstable };
        }
        if self.baseline.iter().chain(&self.treatment).any(|w| w.bg_load_flag) {
            return Verdict::Inconclusive { reason: InconclusiveReason::InvalidTrial };
        }
        let b_clock = mean(&col(&self.baseline, |w| w.avg_clock_mhz));
        let t_clock = mean(&col(&self.treatment, |w| w.avg_clock_mhz));
        if b_clock > 0.0 && t_clock > 0.0 && ((t_clock - b_clock).abs() / b_clock * 100.0) > CLOCK_DIVERGE_PCT
        {
            return Verdict::Inconclusive { reason: InconclusiveReason::InvalidTrial };
        }
        let b_temp = col(&self.baseline, |w| w.max_temp_c).into_iter().fold(0.0, f64::max);
        let t_temp = col(&self.treatment, |w| w.max_temp_c).into_iter().fold(0.0, f64::max);
        if b_temp > 0.0 && t_temp > 0.0 && (t_temp - b_temp).abs() > TEMP_DIVERGE_C {
            return Verdict::Inconclusive { reason: InconclusiveReason::InvalidTrial };
        }

        let b_p1 = col(&self.baseline, |w| w.p1_low_fps);
        let t_p1 = col(&self.treatment, |w| w.p1_low_fps);
        let b_p01 = col(&self.baseline, |w| w.p01_low_fps);
        let t_p01 = col(&self.treatment, |w| w.p01_low_fps);

        // Baseline too noisy to measure anything against?
        if cov_pct(&b_p1) > UNSTABLE_BASELINE_COV_PCT {
            return Verdict::Inconclusive { reason: InconclusiveReason::ConditionsUnstable };
        }

        let evals: Vec<MetricEval> = [
            eval_metric("1% low", &b_p1, &t_p1),
            eval_metric("0.1% low", &b_p01, &t_p01),
        ]
        .into_iter()
        .flatten()
        .collect();
        if evals.is_empty() {
            return Verdict::Inconclusive { reason: InconclusiveReason::ConditionsUnstable };
        }

        // Worst regression wins (a tweak that tanks 0.1% lows is a Revert even if 1% low is flat).
        if let Some(r) = evals
            .iter()
            .filter(|e| e.regressed())
            .min_by(|a, b| a.effect_pct.total_cmp(&b.effect_pct))
        {
            return Verdict::Revert {
                effect_pct: r.effect_pct,
                ci_lo_pct: r.ci_lo,
                ci_hi_pct: r.ci_hi,
                metric: r.name.into(),
            };
        }
        if let Some(i) = evals
            .iter()
            .filter(|e| e.improved())
            .max_by(|a, b| a.effect_pct.total_cmp(&b.effect_pct))
        {
            return Verdict::Keep {
                effect_pct: i.effect_pct,
                ci_lo_pct: i.ci_lo,
                ci_hi_pct: i.ci_hi,
                metric: i.name.into(),
            };
        }
        Verdict::Inconclusive { reason: InconclusiveReason::WithinNoise }
    }
}

fn col(ws: &[MetricWindow], f: impl Fn(&MetricWindow) -> f64) -> Vec<f64> {
    ws.iter().map(f).collect()
}

// ── Trial orchestration core (P2) ─────────────────────────────────────────────
// Pure bookkeeping for an INTERLEAVED A-B trial. The live driver (the integration layer that
// reads the fps.rs frametime stream and toggles the tweak through the transaction system) feeds
// windows here as they arrive, labelling the first windows after each toggle as `Warmup`
// (shader compile / thermal ramp) so they're discarded. This core decides when both sides have
// enough samples to judge and produces the verdict — it never captures or toggles anything
// itself, so it's fully unit-testable without a game.

/// Which side of the A-B comparison a captured window belongs to.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Phase {
    /// Discarded — settling after a toggle (shader compile / thermal ramp).
    Warmup,
    /// Tweak OFF.
    Baseline,
    /// Tweak ON.
    Treatment,
}

pub(crate) struct TrialBuilder {
    target_per_side: usize,
    baseline: Vec<MetricWindow>,
    treatment: Vec<MetricWindow>,
}

impl TrialBuilder {
    pub fn new(target_per_side: usize) -> Self {
        Self {
            target_per_side: target_per_side.max(MIN_WINDOWS),
            baseline: Vec::new(),
            treatment: Vec::new(),
        }
    }

    /// Add a captured window; warmup windows are dropped.
    pub fn push(&mut self, phase: Phase, window: MetricWindow) {
        match phase {
            Phase::Warmup => {}
            Phase::Baseline => self.baseline.push(window),
            Phase::Treatment => self.treatment.push(window),
        }
    }

    pub fn counts(&self) -> (usize, usize) {
        (self.baseline.len(), self.treatment.len())
    }

    /// Enough samples on both sides to attempt a verdict?
    pub fn ready(&self) -> bool {
        self.baseline.len() >= self.target_per_side && self.treatment.len() >= self.target_per_side
    }

    pub fn into_trial(self) -> Trial {
        Trial { baseline: self.baseline, treatment: self.treatment }
    }

    /// Verdict once both sides have enough samples; `None` until then (keep collecting).
    pub fn verdict_if_ready(&self) -> Option<Verdict> {
        if !self.ready() {
            return None;
        }
        Some(Trial { baseline: self.baseline.clone(), treatment: self.treatment.clone() }.verdict())
    }
}

#[cfg(test)]
mod verdict_tests {
    use super::*;

    fn win(p1: f64, p01: f64) -> MetricWindow {
        MetricWindow {
            avg_fps: p1 + 20.0,
            p1_low_fps: p1,
            p01_low_fps: p01,
            frametime_stdev_ms: 1.0,
            stutter_pct: 0.0,
            frame_count: 600,
            input_to_photon_ms: None,
            avg_clock_mhz: 5000.0,
            max_temp_c: 60.0,
            bg_load_flag: false,
        }
    }

    fn wins(p1: &[f64], p01: &[f64]) -> Vec<MetricWindow> {
        p1.iter().zip(p01).map(|(&a, &b)| win(a, b)).collect()
    }

    // ── Pure stats ──
    #[test]
    fn quantile_interpolates() {
        let xs = [10.0, 20.0, 30.0, 40.0];
        assert!((quantile(&xs, 0.5).unwrap() - 25.0).abs() < 1e-9);
        assert_eq!(quantile(&xs, 0.0).unwrap(), 10.0);
        assert_eq!(quantile(&xs, 1.0).unwrap(), 40.0);
    }

    #[test]
    fn low_fps_uses_the_bad_tail() {
        // ~2% ugly 50 ms frames in an otherwise smooth set: the worst 1% (the 1% low) sits in the
        // bad tail, so the "1% low FPS" collapses far below the ~144 fps average.
        let mut ft = vec![6.94_f64; 1000]; // ~144 fps
        for f in ft.iter_mut().take(20) {
            *f = 50.0; // stutters — 2% of frames
        }
        let p1 = low_fps(&ft, 0.99).unwrap();
        assert!(p1 < 144.0, "1% low should reflect the bad tail, got {p1}");
        // The single-stutter case (0.1% of frames) instead shows up in the 0.1% low:
        let mut ft2 = vec![6.94_f64; 1000];
        ft2[0] = 50.0;
        assert!(low_fps(&ft2, 0.999).unwrap() < low_fps(&ft2, 0.99).unwrap());
    }

    #[test]
    fn from_frametimes_rejects_too_few() {
        assert!(MetricWindow::from_frametimes(&[6.9; 10], WindowCtx::default()).is_none());
        assert!(MetricWindow::from_frametimes(&[6.9; 600], WindowCtx::default()).is_some());
    }

    // ── DoD acceptance cases ──
    #[test]
    fn fat_tailed_regression_is_reverted() {
        // 1% low unchanged, but 0.1% low clearly worse → must Revert (the mean would miss this).
        let baseline = wins(&[100.0, 101.0, 99.0, 100.0, 102.0], &[85.0, 86.0, 84.0, 85.0, 85.0]);
        let treatment = wins(&[100.0, 101.0, 99.0, 100.0, 102.0], &[60.0, 61.0, 59.0, 60.0, 60.0]);
        let v = Trial { baseline, treatment }.verdict();
        match v {
            Verdict::Revert { metric, .. } => assert_eq!(metric, "0.1% low"),
            other => panic!("expected Revert on 0.1% low, got {other:?}"),
        }
    }

    #[test]
    fn no_op_is_within_noise() {
        let baseline = wins(&[100.0, 101.0, 99.0, 100.0, 102.0], &[85.0, 86.0, 84.0, 85.0, 85.0]);
        let treatment = wins(&[100.0, 102.0, 99.0, 101.0, 100.0], &[85.0, 84.0, 86.0, 85.0, 85.0]);
        assert_eq!(
            Trial { baseline, treatment }.verdict(),
            Verdict::Inconclusive { reason: InconclusiveReason::WithinNoise }
        );
    }

    #[test]
    fn clear_improvement_is_kept() {
        let baseline = wins(&[100.0, 101.0, 99.0, 100.0, 102.0], &[85.0, 86.0, 84.0, 85.0, 85.0]);
        let treatment = wins(&[130.0, 131.0, 129.0, 130.0, 132.0], &[110.0, 111.0, 109.0, 110.0, 110.0]);
        match (Trial { baseline, treatment }).verdict() {
            Verdict::Keep { effect_pct, .. } => assert!(effect_pct > 0.0),
            other => panic!("expected Keep, got {other:?}"),
        }
    }

    #[test]
    fn throttled_trial_is_invalid() {
        let baseline = wins(&[100.0, 101.0, 99.0, 100.0, 102.0], &[85.0, 86.0, 84.0, 85.0, 85.0]);
        let mut treatment = wins(&[130.0, 131.0, 129.0, 130.0, 132.0], &[110.0, 111.0, 109.0, 110.0, 110.0]);
        for w in &mut treatment {
            w.avg_clock_mhz = 4000.0; // 20% below baseline's 5000 → throttle
        }
        assert_eq!(
            Trial { baseline, treatment }.verdict(),
            Verdict::Inconclusive { reason: InconclusiveReason::InvalidTrial }
        );
    }

    #[test]
    fn background_load_invalidates() {
        let baseline = wins(&[100.0, 101.0, 99.0, 100.0, 102.0], &[85.0, 86.0, 84.0, 85.0, 85.0]);
        let mut treatment = wins(&[130.0, 131.0, 129.0, 130.0, 132.0], &[110.0, 111.0, 109.0, 110.0, 110.0]);
        treatment[0].bg_load_flag = true;
        assert_eq!(
            Trial { baseline, treatment }.verdict(),
            Verdict::Inconclusive { reason: InconclusiveReason::InvalidTrial }
        );
    }

    #[test]
    fn unstable_baseline_is_inconclusive() {
        // Baseline 1% low swings wildly (CoV well over 25%) → can't measure against it.
        let baseline = wins(&[60.0, 140.0, 70.0, 130.0, 90.0], &[50.0, 120.0, 60.0, 110.0, 80.0]);
        let treatment = wins(&[100.0, 101.0, 99.0, 100.0, 102.0], &[85.0, 86.0, 84.0, 85.0, 85.0]);
        assert_eq!(
            Trial { baseline, treatment }.verdict(),
            Verdict::Inconclusive { reason: InconclusiveReason::ConditionsUnstable }
        );
    }

    #[test]
    fn too_few_windows_is_inconclusive() {
        let baseline = wins(&[100.0, 101.0], &[85.0, 86.0]);
        let treatment = wins(&[130.0, 131.0], &[110.0, 111.0]);
        assert_eq!(
            Trial { baseline, treatment }.verdict(),
            Verdict::Inconclusive { reason: InconclusiveReason::ConditionsUnstable }
        );
    }

    #[test]
    fn bootstrap_is_deterministic() {
        let b = [100.0, 101.0, 99.0, 100.0, 102.0];
        let t = [130.0, 131.0, 129.0, 130.0, 132.0];
        assert_eq!(bootstrap_median_pct_change(&b, &t), bootstrap_median_pct_change(&b, &t));
    }

    // ── Trial orchestration core ──
    #[test]
    fn trial_builder_discards_warmup_and_collects() {
        let mut tb = TrialBuilder::new(5);
        for _ in 0..3 {
            tb.push(Phase::Warmup, win(100.0, 85.0)); // dropped
        }
        assert_eq!(tb.counts(), (0, 0));
        assert!(!tb.ready());
        for &p1 in &[100.0, 101.0, 99.0, 100.0, 102.0] {
            tb.push(Phase::Baseline, win(p1, 85.0));
        }
        for &p1 in &[130.0, 131.0, 129.0, 130.0, 132.0] {
            tb.push(Phase::Treatment, win(p1, 110.0));
        }
        assert_eq!(tb.counts(), (5, 5));
        assert!(tb.ready());
    }

    #[test]
    fn trial_builder_verdict_only_when_ready() {
        let mut tb = TrialBuilder::new(5);
        for &p1 in &[100.0, 101.0, 99.0] {
            tb.push(Phase::Baseline, win(p1, 85.0));
        }
        assert!(tb.verdict_if_ready().is_none(), "not enough samples yet");
        for &p1 in &[100.0, 102.0] {
            tb.push(Phase::Baseline, win(p1, 85.0));
        }
        for &p1 in &[130.0, 131.0, 129.0, 130.0, 132.0] {
            tb.push(Phase::Treatment, win(p1, 110.0));
        }
        assert!(matches!(tb.verdict_if_ready(), Some(Verdict::Keep { .. })));
    }
}
