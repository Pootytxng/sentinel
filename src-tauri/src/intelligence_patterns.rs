// intelligence_patterns.rs — Intelligence Phase 2 (§4E): cross-session pattern detection.
//
// Analyzes the RECORDED session history (sessions.json) for repeated, honest patterns:
// performance drift over time, thermal creep, memory-pressure growth, driver-version
// splits, Gaming Mode splits, in-session FPS fade, and cross-game synthesis.
//
// Doctrine (same laws as intelligence.rs):
//   - Deterministic and inspectable: transparent arithmetic (least-squares slopes, medians,
//     fixed thresholds) — no opaque scoring. Same inputs → same report, input-order
//     independent.
//   - Read-only and local: consumes persisted session summaries alone. No probes, no
//     network, nothing is written.
//   - Confidence is BANDED (Confidence), never numeric, and a passive pattern NEVER
//     reaches High — repeated correlation across uncontrolled sessions cannot rule out
//     confounds; only a controlled comparison can (that is the Lab's job).
//   - Correlation, never causation: copy says "moved / differed / faded", names the next
//     test, and every pattern carries what would raise (or argue against) it.
//   - Silence is flagged, not silent (§0.12): when a detector lacks data it says exactly
//     what is missing in `coverage` instead of vanishing.
//   - No fabricated events: only recorded timestamps/values are ever interpolated into
//     copy; unparseable records are counted and left out, never guessed.

use serde::Serialize;

use crate::intelligence::{parse_utc, pretty_game_name, Confidence, MIN_COMPARE_SAMPLES};
use crate::sessions::SessionSummary;

// ─── Thresholds (fixed, documented — the inspectability contract) ────────

/// A trend needs at least this many comparable sessions of one game.
const MIN_TREND_SESSIONS: usize = 5;
/// A trend over at least this many sessions may reach Medium (repeatability).
const STRONG_TREND_SESSIONS: usize = 8;
/// Group comparisons (driver split, Gaming Mode split) need this many sessions per side.
const MIN_GROUP_SESSIONS: usize = 3;
/// Group comparisons with this many sessions per side may reach Medium.
const STRONG_GROUP_SESSIONS: usize = 5;
/// In-session fade needs this many sessions that still carry an FPS series.
const MIN_FADE_SESSIONS: usize = 4;
/// …and each series must span at least this many 10 s buckets (= 5 minutes).
const MIN_FADE_BUCKETS: usize = 30;
/// Total peak-GPU-temp movement (°C) across a trend before it is worth reporting.
const THERMAL_TREND_MIN_C: f64 = 5.0;
/// Total peak-CPU-temp movement (°C) across a trend before it is worth reporting.
const CPU_THERMAL_TREND_MIN_C: f64 = 5.0;
/// Total RAM-pressure movement (percentage points) before it is worth reporting.
const MEMORY_TREND_MIN_PTS: f64 = 5.0;
// A session must have ≥ MIN_COMPARE_SAMPLES FPS samples to be comparable — imported from
// intelligence.rs (one definition, shared) rather than re-declared, so the two can't drift.
/// Per game, only the most recent N comparable sessions are analyzed (stated in coverage).
const PER_GAME_WINDOW: usize = 20;

// ─── Report types (serde → TS) ───────────────────────────────────────────

#[derive(Serialize, Clone, Debug)]
pub(crate) struct SessionPattern {
    /// Detector id, e.g. "performance-trend". Stable, kebab-case.
    pub id: String,
    /// Pretty game name, or None for a cross-game synthesis pattern.
    pub game: Option<String>,
    pub title: String,
    /// Plain-language finding with the real numbers in it.
    pub detail: String,
    pub confidence: Confidence,
    pub confidence_reason: String,
    pub supporting_evidence: Vec<String>,
    /// What would raise confidence / what argues against the pattern.
    pub raises_confidence: Vec<String>,
    pub next_test: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
pub(crate) struct PatternReport {
    pub patterns: Vec<SessionPattern>,
    /// §0.12: detectors that stayed silent say exactly why (missing data), never vanish.
    pub coverage: Vec<String>,
    pub sessions_considered: usize,
    pub games_considered: usize,
}

// ─── Arithmetic helpers (transparent on purpose) ─────────────────────────

fn round1(x: f64) -> f64 {
    (x * 10.0).round() / 10.0
}

fn median(mut xs: Vec<f64>) -> f64 {
    xs.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = xs.len();
    if n == 0 {
        return 0.0;
    }
    if n % 2 == 1 {
        xs[n / 2]
    } else {
        (xs[n / 2 - 1] + xs[n / 2]) / 2.0
    }
}

/// Ordinary least squares over (index, y): returns (intercept, slope). Index spacing is
/// deliberately uniform (session order, not wall-clock gaps) so one long absence can't
/// masquerade as a steep slope.
fn fit_line(ys: &[f64]) -> (f64, f64) {
    let n = ys.len() as f64;
    if ys.len() < 2 {
        return (ys.first().copied().unwrap_or(0.0), 0.0);
    }
    let mean_x = (n - 1.0) / 2.0;
    let mean_y = ys.iter().sum::<f64>() / n;
    let mut num = 0.0;
    let mut den = 0.0;
    for (i, y) in ys.iter().enumerate() {
        let dx = i as f64 - mean_x;
        num += dx * (y - mean_y);
        den += dx * dx;
    }
    let slope = if den > 0.0 { num / den } else { 0.0 };
    (mean_y - slope * mean_x, slope)
}

/// Fitted total movement across the series: (first fitted value, last fitted value).
fn fitted_span(ys: &[f64]) -> (f64, f64) {
    let (a, b) = fit_line(ys);
    (a, a + b * (ys.len() as f64 - 1.0))
}

fn date_of(ts: &str) -> String {
    // Display-only: the date part of a RECORDED stamp (never synthesized).
    ts.get(..10).unwrap_or(ts).to_string()
}

// ─── Engine ──────────────────────────────────────────────────────────────

/// One game's comparable sessions, oldest → newest.
struct GameLane<'a> {
    raw_name: String,
    pretty: String,
    sessions: Vec<&'a SessionSummary>,
}

/// A session with no reading (`samples == 0`: the game was behind another window the whole time,
/// P4-show-f1) is never comparable: its 0 1% low means "not measured", not a drop.
fn comparable(s: &SessionSummary) -> bool {
    s.samples >= MIN_COMPARE_SAMPLES && s.low1_fps_est > 0.0 && !s.process_name.is_empty()
}

fn lanes(sessions: &[SessionSummary]) -> (Vec<GameLane<'_>>, usize) {
    let mut unparseable = 0usize;
    let mut by_game: std::collections::BTreeMap<String, Vec<&SessionSummary>> =
        std::collections::BTreeMap::new();
    for s in sessions {
        if !comparable(s) {
            continue;
        }
        if parse_utc(&s.started_at).is_none() {
            unparseable += 1;
            continue;
        }
        by_game.entry(s.process_name.to_ascii_lowercase()).or_default().push(s);
    }
    let mut out: Vec<GameLane<'_>> = by_game
        .into_iter()
        .map(|(raw, mut v)| {
            // Oldest → newest on the parsed recorded stamp; keep the most recent window.
            v.sort_by_key(|s| parse_utc(&s.started_at));
            if v.len() > PER_GAME_WINDOW {
                v.drain(..v.len() - PER_GAME_WINDOW);
            }
            let pretty = pretty_game_name(&v[v.len() - 1].process_name);
            GameLane { raw_name: raw, pretty, sessions: v }
        })
        .collect();
    // Most-played first; ties break on name for determinism.
    out.sort_by(|a, b| b.sessions.len().cmp(&a.sessions.len()).then(a.raw_name.cmp(&b.raw_name)));
    (out, unparseable)
}

/// Measurement item 8: `band_at` is the game's measured 1% low band up to a session (`experiment::measured_noise_at`,
/// the one source Trials judge on). A game without one gets no direction on its 1% lows: no trend,
/// split or fade is called past a fixed 3%, and it is not counted as trend-free either.
pub(crate) fn detect_patterns(sessions: &[SessionSummary], band_at: &dyn Fn(&SessionSummary) -> Option<f64>) -> PatternReport {
    let (lanes, unparseable) = lanes(sessions);
    let sessions_considered: usize = lanes.iter().map(|l| l.sessions.len()).sum();
    let games_considered = lanes.len();

    let mut patterns: Vec<SessionPattern> = Vec::new();
    let mut coverage: Vec<String> = Vec::new();
    if unparseable > 0 {
        coverage.push(format!(
            "{unparseable} session(s) carried unreadable timestamps and were left out — never guessed."
        ));
    }

    // Cross-game synthesis bookkeeping for the performance trend.
    let mut degrading_games: Vec<String> = Vec::new();
    let mut trend_eligible_games: Vec<String> = Vec::new();

    for lane in &lanes {
        let n = lane.sessions.len();
        let game = &lane.pretty;
        if n < 2 {
            continue; // one session of a game is not a lane worth narrating
        }
        // Item 8: this game's measured band at its newest session; none, and no 1% low direction is
        // called for it (an infinite floor is never crossed).
        let band = band_at(&lane.sessions[n - 1]);
        if band.is_none() {
            coverage.push(format!(
                "1% low directions for {game}: not called. Compy hasn't measured how much {game} moves between your sessions with nothing changed."
            ));
        }
        let floor = band.unwrap_or(f64::INFINITY);

        // ── performance-trend: 1% lows over time ──
        if n < MIN_TREND_SESSIONS {
            coverage.push(format!(
                "Performance trend for {game}: needs {MIN_TREND_SESSIONS} comparable sessions; have {n}."
            ));
        } else if band.is_some() {
            trend_eligible_games.push(game.clone());
            let ys: Vec<f64> = lane.sessions.iter().map(|s| s.low1_fps_est).collect();
            let (first_fit, last_fit) = fitted_span(&ys);
            if first_fit > 0.0 {
                let change_pct = round1((last_fit - first_fit) / first_fit * 100.0);
                if change_pct.abs() >= floor {
                    let degrading = change_pct < 0.0;
                    if degrading {
                        degrading_games.push(game.clone());
                    }
                    let first_date = date_of(&lane.sessions[0].started_at);
                    let last_date = date_of(&lane.sessions[n - 1].started_at);
                    let strong = n >= STRONG_TREND_SESSIONS && change_pct.abs() >= 2.0 * floor;
                    patterns.push(SessionPattern {
                        id: "performance-trend".into(),
                        game: Some(game.clone()),
                        title: if degrading {
                            format!("{game} has been getting slower")
                        } else {
                            format!("{game} has been getting faster")
                        },
                        detail: format!(
                            "1% lows in {game} moved about {change_pct:+.1}% across {n} sessions between {first_date} and {last_date} — past the {floor:.1}% {game} moves between your sessions with nothing changed."
                        ),
                        confidence: if strong { Confidence::Medium } else { Confidence::Low },
                        confidence_reason: if strong {
                            format!("{n} sessions and a move at least twice the noise floor — but sessions aren't controlled runs, so this stays a correlation.")
                        } else {
                            format!("Only {n} sessions, or a move close to the noise floor — could still be run-to-run variance.")
                        },
                        supporting_evidence: vec![format!(
                            "Fitted 1% lows: ~{:.0} FPS at the start of the window vs ~{:.0} FPS now.",
                            first_fit, last_fit
                        )],
                        raises_confidence: vec![
                            "More sessions in the same direction.".into(),
                            "The same drift showing up in another game (system-wide, not game-side).".into(),
                        ],
                        next_test: degrading.then(|| format!(
                            "Open History, pick the last good {game} session and the first slow one, and run \"What changed?\" between them."
                        )),
                    });
                }
            }
        }

        // ── thermal-trend: peak GPU temperature over time ──
        let temps: Vec<f64> = lane
            .sessions
            .iter()
            .filter_map(|s| s.peak_gpu_temp_c.map(|t| t as f64))
            .collect();
        if temps.len() >= MIN_TREND_SESSIONS {
            let (first_fit, last_fit) = fitted_span(&temps);
            let change_c = round1(last_fit - first_fit);
            if change_c.abs() >= THERMAL_TREND_MIN_C {
                let strong = temps.len() >= STRONG_TREND_SESSIONS && change_c.abs() >= 8.0;
                patterns.push(SessionPattern {
                    id: "thermal-trend".into(),
                    game: Some(game.clone()),
                    title: format!("{game} sessions are running {}", if change_c > 0.0 { "hotter" } else { "cooler" }),
                    detail: format!(
                        "Peak GPU temperature in {game} moved about {change_c:+.0} °C across {} sessions (fitted ~{:.0} °C → ~{:.0} °C).",
                        temps.len(), first_fit, last_fit
                    ),
                    confidence: if strong { Confidence::Medium } else { Confidence::Low },
                    confidence_reason: if strong {
                        "A sustained multi-session move well past normal variation.".into()
                    } else {
                        "A small or short-window move — ambient temperature alone can explain a few degrees.".into()
                    },
                    supporting_evidence: vec![format!(
                        "Peak temps recorded across {} sessions of {game}.",
                        temps.len()
                    )],
                    raises_confidence: vec![
                        "More sessions continuing the climb.".into(),
                        "The same climb in other games (points at the machine, not the game).".into(),
                    ],
                    next_test: (change_c > 0.0).then(|| "Check dust filters and fan behavior, then watch the next session's peak temperature in Live.".to_string()),
                });
            }
        } else if n >= MIN_TREND_SESSIONS {
            coverage.push(format!(
                "Thermal trend for {game}: only {} of {n} sessions recorded a peak GPU temperature.",
                temps.len()
            ));
        }

        // ── cpu-thermal-trend: peak CPU temperature over time ──
        let cpu_temps: Vec<f64> = lane
            .sessions
            .iter()
            .filter_map(|s| s.peak_cpu_temp_c.map(|t| t as f64))
            .collect();
        if cpu_temps.len() >= MIN_TREND_SESSIONS {
            let (first_fit, last_fit) = fitted_span(&cpu_temps);
            let change_c = round1(last_fit - first_fit);
            if change_c.abs() >= CPU_THERMAL_TREND_MIN_C {
                let strong = cpu_temps.len() >= STRONG_TREND_SESSIONS && change_c.abs() >= 8.0;
                patterns.push(SessionPattern {
                    id: "cpu-thermal-trend".into(),
                    game: Some(game.clone()),
                    title: format!("{game} sessions are running the CPU {}", if change_c > 0.0 { "hotter" } else { "cooler" }),
                    detail: format!(
                        "Peak CPU temperature in {game} moved about {change_c:+.0} °C across {} sessions (fitted ~{:.0} °C → ~{:.0} °C).",
                        cpu_temps.len(), first_fit, last_fit
                    ),
                    confidence: if strong { Confidence::Medium } else { Confidence::Low },
                    confidence_reason: if strong {
                        "A sustained multi-session move well past normal variation.".into()
                    } else {
                        "A small or short-window move — ambient temperature alone can explain a few degrees.".into()
                    },
                    supporting_evidence: vec![format!(
                        "Peak CPU temps recorded across {} sessions of {game} (via HWiNFO/LibreHardwareMonitor interop — none fabricated).",
                        cpu_temps.len()
                    )],
                    raises_confidence: vec![
                        "More sessions continuing the climb.".into(),
                        "The same climb showing up in the GPU thermal trend too (points at the case/cooling, not one component).".into(),
                    ],
                    next_test: (change_c > 0.0).then(|| "Check CPU cooler contact/dust and case airflow, then watch the next session's peak CPU temperature in Live.".to_string()),
                });
            }
        } else if n >= MIN_TREND_SESSIONS {
            coverage.push(format!(
                "CPU thermal trend for {game}: only {} of {n} sessions recorded a peak CPU temperature (no HWiNFO/LibreHardwareMonitor running).",
                cpu_temps.len()
            ));
        }

        // ── memory-trend: peak RAM pressure over time ──
        let ram_pts: Vec<f64> = lane
            .sessions
            .iter()
            .filter_map(|s| match (s.peak_ram_used_bytes, s.ram_total_bytes) {
                (Some(u), Some(t)) if t > 0 => Some(u as f64 / t as f64 * 100.0),
                _ => None,
            })
            .collect();
        if ram_pts.len() >= MIN_TREND_SESSIONS {
            let (first_fit, last_fit) = fitted_span(&ram_pts);
            let change_pts = round1(last_fit - first_fit);
            if change_pts.abs() >= MEMORY_TREND_MIN_PTS {
                let strong = ram_pts.len() >= STRONG_TREND_SESSIONS && change_pts.abs() >= 10.0;
                patterns.push(SessionPattern {
                    id: "memory-trend".into(),
                    game: Some(game.clone()),
                    title: format!("RAM pressure during {game} is {}", if change_pts > 0.0 { "growing" } else { "easing" }),
                    detail: format!(
                        "Peak RAM use during {game} moved about {change_pts:+.0} percentage points across {} sessions (fitted ~{:.0}% → ~{:.0}% of your RAM).",
                        ram_pts.len(), first_fit, last_fit
                    ),
                    confidence: if strong { Confidence::Medium } else { Confidence::Low },
                    confidence_reason: if strong {
                        "A sustained multi-session climb of ten points or more.".into()
                    } else {
                        "A modest move — a game update or one heavy background app can explain it.".into()
                    },
                    supporting_evidence: vec![format!(
                        "Peak RAM recorded across {} sessions of {game}.",
                        ram_pts.len()
                    )],
                    raises_confidence: vec![
                        "The climb continuing across more sessions.".into(),
                        "1% lows worsening in the same sessions (pressure actually biting).".into(),
                    ],
                    next_test: (change_pts > 0.0).then(|| "Check the startup list and background apps before the next session — Compy's startup view names what loads with Windows.".to_string()),
                });
            }
        }

        // ── driver-split: last driver version vs the one before it ──
        {
            let fp_sessions: Vec<&&SessionSummary> = lane
                .sessions
                .iter()
                .filter(|s| s.hw_fingerprint.is_some())
                .collect();
            // Consecutive-in-time version runs, oldest → newest.
            let mut runs: Vec<(String, Vec<f64>)> = Vec::new();
            for s in &fp_sessions {
                let fp = s.hw_fingerprint.as_ref().expect("filtered Some");
                match runs.last_mut() {
                    Some((v, ys)) if *v == fp.gpu_driver => ys.push(s.low1_fps_est),
                    _ => runs.push((fp.gpu_driver.clone(), vec![s.low1_fps_est])),
                }
            }
            if runs.len() >= 2 {
                let (new_v, new_ys) = runs.last().expect("len>=2").clone();
                let (old_v, old_ys) = runs[runs.len() - 2].clone();
                // Same rig otherwise (gpu/ram/display) — the driver must be the only
                // identity difference, else this is a hardware comparison, not a driver one.
                let same_rig = {
                    let ids: Vec<(&str, u32, &str)> = fp_sessions
                        .iter()
                        .filter_map(|s| s.hw_fingerprint.as_ref())
                        .map(|f| (f.gpu.as_str(), f.ram_gb, f.display.as_str()))
                        .collect();
                    ids.windows(2).all(|w| w[0] == w[1])
                };
                if !same_rig {
                    coverage.push(format!(
                        "Driver comparison for {game}: skipped — the rig itself changed inside this window, so a driver split wouldn't be honest."
                    ));
                } else if new_ys.len() < MIN_GROUP_SESSIONS || old_ys.len() < MIN_GROUP_SESSIONS {
                    coverage.push(format!(
                        "Driver comparison for {game}: needs {MIN_GROUP_SESSIONS} sessions on each driver; have {} on {old_v} and {} on {new_v}.",
                        old_ys.len(), new_ys.len()
                    ));
                } else {
                    let med_old = median(old_ys.clone());
                    let med_new = median(new_ys.clone());
                    if med_old > 0.0 {
                        let delta = round1((med_new - med_old) / med_old * 100.0);
                        if delta.abs() >= floor {
                            let strong = old_ys.len().min(new_ys.len()) >= STRONG_GROUP_SESSIONS
                                || delta.abs() >= 2.0 * floor;
                            patterns.push(SessionPattern {
                                id: "driver-split".into(),
                                game: Some(game.clone()),
                                title: format!(
                                    "{game} runs {} on driver {new_v}",
                                    if delta < 0.0 { "slower" } else { "faster" }
                                ),
                                detail: format!(
                                    "Median 1% lows in {game}: {med_old:.0} FPS across {} sessions on driver {old_v} vs {med_new:.0} FPS across {} sessions on {new_v} ({delta:+.1}%).",
                                    old_ys.len(), new_ys.len()
                                ),
                                confidence: if strong { Confidence::Medium } else { Confidence::Low },
                                confidence_reason: "Sessions on each side of a driver change — a repeated split, but not a controlled test; game updates in the same window could contribute.".into(),
                                supporting_evidence: vec![
                                    "Same GPU, RAM, and display across the whole window — the driver version is the only recorded identity difference.".into(),
                                ],
                                raises_confidence: vec![
                                    "More sessions on the newer driver.".into(),
                                    "The same split in another game.".into(),
                                ],
                                next_test: Some(
                                    "Pick one session from each driver in History and run \"What changed?\" — it will lay out this window's other changes too.".into()
                                ),
                            });
                        }
                    }
                }
            }
        }

        // ── gaming-mode-split: sessions with Gaming Mode on vs off ──
        {
            let on: Vec<f64> = lane
                .sessions
                .iter()
                .filter(|s| s.gaming_mode_active == Some(true))
                .map(|s| s.low1_fps_est)
                .collect();
            let off: Vec<f64> = lane
                .sessions
                .iter()
                .filter(|s| s.gaming_mode_active == Some(false))
                .map(|s| s.low1_fps_est)
                .collect();
            if on.len() >= MIN_GROUP_SESSIONS && off.len() >= MIN_GROUP_SESSIONS {
                let med_on = median(on.clone());
                let med_off = median(off.clone());
                if med_off > 0.0 {
                    let delta = round1((med_on - med_off) / med_off * 100.0);
                    if delta.abs() >= floor {
                        let strong = on.len().min(off.len()) >= STRONG_GROUP_SESSIONS
                            || delta.abs() >= 2.0 * floor;
                        patterns.push(SessionPattern {
                            id: "gaming-mode-split".into(),
                            game: Some(game.clone()),
                            title: format!(
                                "{game} has run {} with Gaming Mode on",
                                if delta > 0.0 { "faster" } else { "slower" }
                            ),
                            detail: format!(
                                "Median 1% lows in {game}: {med_on:.0} FPS across {} sessions with Gaming Mode on vs {med_off:.0} FPS across {} with it off ({delta:+.1}%).",
                                on.len(), off.len()
                            ),
                            confidence: if strong { Confidence::Medium } else { Confidence::Low },
                            confidence_reason: "A repeated split, not a controlled A/B — what you played and what ran in the background differed between those sessions too.".into(),
                            supporting_evidence: vec![format!(
                                "Gaming Mode state was recorded on all {} of these sessions.",
                                on.len() + off.len()
                            )],
                            raises_confidence: vec![
                                "A Lab A/B comparison — that is the controlled version of this exact question.".into(),
                            ],
                            next_test: Some("Run a Lab comparison with Gaming Mode as the one variable — the bench holds everything else still.".into()),
                        });
                    }
                }
            }
        }

        // ── session-fade: FPS decaying within sessions ──
        {
            let mut usable = 0usize;
            let mut fades: Vec<f64> = Vec::new();
            for s in lane.sessions.iter().rev() {
                // fps_series is only kept for recent sessions; walk newest-first.
                if s.fps_series.len() < MIN_FADE_BUCKETS {
                    continue;
                }
                usable += 1;
                let third = s.fps_series.len() / 3;
                let first: Vec<f64> = s.fps_series[..third].iter().map(|(_, f)| *f).collect();
                let last: Vec<f64> = s.fps_series[s.fps_series.len() - third..]
                    .iter()
                    .map(|(_, f)| *f)
                    .collect();
                let mean = |v: &[f64]| v.iter().sum::<f64>() / v.len().max(1) as f64;
                let (mf, ml) = (mean(&first), mean(&last));
                if mf > 0.0 {
                    let fade_pct = round1((ml - mf) / mf * 100.0);
                    if fade_pct <= -floor {
                        fades.push(fade_pct);
                    }
                }
            }
            if usable >= MIN_FADE_SESSIONS && fades.len() * 4 >= usable * 3 {
                let med_fade = round1(median(fades.clone()));
                patterns.push(SessionPattern {
                    id: "session-fade".into(),
                    game: Some(game.clone()),
                    title: format!("{game} slows down the longer you play"),
                    detail: format!(
                        "FPS ended lower than it started in {} of the last {usable} {game} sessions with a full trace (median fade {med_fade:+.1}% from the first third to the last).",
                        fades.len()
                    ),
                    confidence: if usable >= STRONG_GROUP_SESSIONS { Confidence::Medium } else { Confidence::Low },
                    confidence_reason: format!(
                        "The same in-session shape repeated in {} of {usable} sessions — but a game's later areas can simply be heavier.",
                        fades.len()
                    ),
                    supporting_evidence: vec![
                        "Computed from each session's recorded FPS trace (10-second buckets), not projected.".into(),
                    ],
                    raises_confidence: vec![
                        "Temps or RAM climbing across the same sessions (something building up).".into(),
                        "FPS recovering right after a restart mid-play.".into(),
                    ],
                    next_test: Some("Watch one long session in Live — if temps or RAM climb as FPS fades, that is the lead to chase.".into()),
                });
            } else if usable > 0 && usable < MIN_FADE_SESSIONS && n >= MIN_TREND_SESSIONS {
                coverage.push(format!(
                    "In-session fade for {game}: needs {MIN_FADE_SESSIONS} sessions with a full FPS trace; have {usable} (traces are kept for recent sessions only)."
                ));
            }
        }
    }

    // ── Cross-game synthesis on the performance trend ──
    if degrading_games.len() >= 2 {
        let list = degrading_games.join(", ");
        patterns.push(SessionPattern {
            id: "multi-game-degradation".into(),
            game: None,
            title: "More than one game is slowing down".into(),
            detail: format!(
                "1% lows have drifted down in {} games ({list}) over their recent sessions — a shared drift points at the system, not any one game.",
                degrading_games.len()
            ),
            confidence: Confidence::Medium,
            confidence_reason: "The same direction repeated independently across games — still a correlation, but one a single game update can't explain.".into(),
            supporting_evidence: degrading_games
                .iter()
                .map(|g| format!("{g}: downward 1% low trend past the noise floor."))
                .collect(),
            raises_confidence: vec![
                "A system-level change (driver, Windows build, power plan) landing near the start of the drift.".into(),
            ],
            next_test: Some("Run \"What changed?\" on the game with the clearest before/after pair — a system-wide cause should show up in its window.".into()),
        });
    } else if degrading_games.len() == 1 && trend_eligible_games.len() >= 2 {
        let g = &degrading_games[0];
        let others: Vec<&String> =
            trend_eligible_games.iter().filter(|x| *x != g).collect();
        patterns.push(SessionPattern {
            id: "isolated-degradation".into(),
            game: Some(g.clone()),
            title: format!("The slowdown looks isolated to {g}"),
            detail: format!(
                "{g} shows a downward 1% low trend while {} other tracked game(s) stayed flat — that points at {g} itself (a game update, its settings) rather than your PC.",
                others.len()
            ),
            confidence: Confidence::Medium,
            confidence_reason: "Other games act as a natural control group — flat there, down here.".into(),
            supporting_evidence: others
                .iter()
                .map(|o| format!("{o}: no trend past the noise floor in the same period."))
                .collect(),
            raises_confidence: vec![format!(
                "A {g} update landing near the start of the drift (Compy can't see game patches — check its patch notes)."
            )],
            next_test: Some(format!(
                "Run \"What changed?\" between the last good and first slow {g} sessions — if nothing system-side changed, the game is the remaining suspect."
            )),
        });
    }

    // Deterministic presentation order: strongest first, then detector, then game.
    patterns.sort_by(|a, b| {
        b.confidence
            .cmp(&a.confidence)
            .then_with(|| a.id.cmp(&b.id))
            .then_with(|| a.game.cmp(&b.game))
    });

    // "Quiet is a real answer" is the verdict of a real look, not the absence of one:
    // it fires only when at least one game reached the trend threshold (we actually ran
    // deep analysis) and nothing crossed the noise floor. Incidental "couldn't check X"
    // coverage notes don't suppress it — below the threshold we say "needs more" instead.
    if patterns.is_empty() && !trend_eligible_games.is_empty() {
        coverage.push(format!(
            "Checked {sessions_considered} comparable session(s) across {games_considered} game(s) — no repeated pattern past the noise floor. Quiet is a real answer."
        ));
    }

    PatternReport { patterns, coverage, sessions_considered, games_considered }
}

// ─── Command ─────────────────────────────────────────────────────────────

#[tauri::command]
pub(crate) fn get_intelligence_patterns() -> PatternReport {
    let sessions = crate::sessions::get_session_summaries();
    detect_patterns(&sessions, &|s| crate::experiment::measured_noise_at(&sessions, s).map(|n| n.low1_band_pct))
}

// ─── Guard tests ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// The detectors' mechanics on a measured 3% band (item 8: the band is always measured now).
    fn detect(s: &[SessionSummary]) -> PatternReport {
        detect_patterns(s, &|_| Some(3.0))
    }

    fn mk_session(started_at: &str, game: &str, low1: f64) -> SessionSummary {
        SessionSummary {
            started_at: started_at.into(),
            duration_secs: 600,
            process_name: game.into(),
            samples: 600,
            avg_fps: low1 * 1.4,
            avg_frametime_ms: 8.0,
            low1_fps_est: low1,
            peak_gpu_temp_c: None,
            peak_gpu_usage_pct: None,
            peak_ram_used_bytes: None,
            ram_total_bytes: None,
            compy_changes_active: Some(0),
            compy_changes_per_change: true,
            compy_changes_cant_confirm: Some(0),
            compy_changes_legacy_active: None,
            compy_changes_since_set_aside: None,
            hw_fingerprint: None,
            gaming_mode_active: None,
            gaming_mode_plan: None,
            stutter_insight: None,
            stutter_timeline: vec![],
            stutter_events: vec![],
            fps_series: vec![],
            capture_capabilities: None,
            game_state: None,
            peak_cpu_temp_c: None,
            peak_gpu_hotspot_temp_c: None,
            background_secs_excluded: None,
            frame_pacing: None,
            gpu_load: None,
            frame_cap: None,
        }
    }

    fn day(i: usize) -> String {
        format!("2026-07-{:02}T10:00:00Z", i + 1)
    }

    fn fp(driver: &str) -> crate::hardware::HwFingerprint {
        crate::hardware::HwFingerprint {
            hash: format!("hash-{driver}"),
            gpu: "Radeon RX 9070 XT".into(),
            gpu_driver: driver.into(),
            ram_gb: 32,
            display: "2560x1440@165".into(),
        }
    }

    #[test]
    fn a_session_with_no_reading_is_never_a_pattern_input() {
        let mut behind = mk_session("2026-07-02T10:00:00Z", "cp2077.exe", 0.0);
        (behind.samples, behind.avg_fps, behind.background_secs_excluded) = (0, 0.0, Some(600));
        assert!(!comparable(&behind));
        assert_eq!(detect(&[behind]).sessions_considered, 0);
    }

    #[test]
    fn too_few_sessions_is_flagged_coverage_not_silence() {
        let s: Vec<SessionSummary> =
            (0..3).map(|i| mk_session(&day(i), "cp2077.exe", 100.0)).collect();
        let r = detect(&s);
        assert!(r.patterns.is_empty());
        assert!(
            r.coverage.iter().any(|c| c.contains("needs 5") && c.contains("have 3")),
            "silent detector must say exactly what is missing: {:?}",
            r.coverage
        );
    }

    #[test]
    fn without_a_measured_band_no_direction_is_called() {
        // Item 8: a 1% low falling 20% over eight sessions was "getting slower" past a fixed 3%. With
        // no measured band for the game, no direction is called, and it isn't counted as trend-free.
        let s: Vec<SessionSummary> =
            (0..8).map(|i| mk_session(&day(i), "cp2077.exe", 100.0 - 2.5 * i as f64)).collect();
        assert!(detect(&s).patterns.iter().any(|p| p.id == "performance-trend"), "on a measured 3% band");
        let r = detect_patterns(&s, &|_| None);
        assert!(r.patterns.iter().all(|p| p.id != "performance-trend"), "{:?}", r.patterns);
        assert!(r.coverage.iter().any(|c| c.contains("not called") && c.contains("nothing changed")), "{:?}", r.coverage);
        // A band wider than the move: no direction either.
        let r = detect_patterns(&s, &|_| Some(25.0));
        assert!(r.patterns.iter().all(|p| p.id != "performance-trend"), "{:?}", r.patterns);
    }

    #[test]
    fn flat_sessions_fire_nothing_and_say_quiet_is_real() {
        let s: Vec<SessionSummary> =
            (0..8).map(|i| mk_session(&day(i), "cp2077.exe", 100.0)).collect();
        let r = detect(&s);
        assert!(r.patterns.is_empty());
        assert!(r.coverage.iter().any(|c| c.contains("Quiet is a real answer")));
    }

    #[test]
    fn degrading_trend_is_detected_at_low_then_medium_never_high() {
        // 5 sessions, ~-8% total: fires at Low (short window).
        let short: Vec<SessionSummary> = (0..5)
            .map(|i| mk_session(&day(i), "cp2077.exe", 100.0 - 2.0 * i as f64))
            .collect();
        let r = detect(&short);
        let p = r
            .patterns
            .iter()
            .find(|p| p.id == "performance-trend")
            .expect("trend fires");
        assert_eq!(p.confidence, Confidence::Low);
        assert!(p.detail.contains("Cyberpunk") || p.detail.contains("cp2077") || p.detail.contains("Cp2077"));
        // 10 sessions, steep: Medium — and NEVER High for a passive pattern.
        let long: Vec<SessionSummary> = (0..10)
            .map(|i| mk_session(&day(i), "cp2077.exe", 100.0 - 2.0 * i as f64))
            .collect();
        let r2 = detect(&long);
        let p2 = r2
            .patterns
            .iter()
            .find(|p| p.id == "performance-trend")
            .expect("trend fires");
        assert_eq!(p2.confidence, Confidence::Medium);
        assert!(r2.patterns.iter().all(|p| p.confidence != Confidence::High));
        assert!(p2.next_test.as_deref().unwrap_or("").contains("What changed?"));
    }

    #[test]
    fn thermal_creep_is_detected_with_real_numbers() {
        let s: Vec<SessionSummary> = (0..6)
            .map(|i| {
                let mut s = mk_session(&day(i), "cp2077.exe", 100.0);
                s.peak_gpu_temp_c = Some(70 + (i as u32) * 3); // 70 → 85
                s
            })
            .collect();
        let r = detect(&s);
        let p = r.patterns.iter().find(|p| p.id == "thermal-trend").expect("fires");
        assert!(p.detail.contains("°C"));
        assert!(p.title.contains("hotter"));
    }

    #[test]
    fn cpu_thermal_creep_is_detected_with_real_numbers() {
        let s: Vec<SessionSummary> = (0..6)
            .map(|i| {
                let mut s = mk_session(&day(i), "cp2077.exe", 100.0);
                s.peak_cpu_temp_c = Some(60 + (i as u32) * 3); // 60 → 75
                s
            })
            .collect();
        let r = detect(&s);
        let p = r.patterns.iter().find(|p| p.id == "cpu-thermal-trend").expect("fires");
        assert!(p.detail.contains("°C"));
        assert!(p.title.contains("hotter"));
    }

    #[test]
    fn cpu_thermal_trend_stays_silent_without_readings() {
        // No monitor running (peak_cpu_temp_c always None) — never fabricate a trend.
        let s: Vec<SessionSummary> = (0..6).map(|i| mk_session(&day(i), "cp2077.exe", 100.0)).collect();
        let r = detect(&s);
        assert!(r.patterns.iter().all(|p| p.id != "cpu-thermal-trend"));
    }

    #[test]
    fn driver_split_needs_same_rig_and_enough_sessions() {
        // 4 on old driver @100, 4 on new @90 → fires with the versions named.
        let mut s: Vec<SessionSummary> = Vec::new();
        for i in 0..4 {
            let mut x = mk_session(&day(i), "cp2077.exe", 100.0);
            x.hw_fingerprint = Some(fp("25.5.1"));
            s.push(x);
        }
        for i in 4..8 {
            let mut x = mk_session(&day(i), "cp2077.exe", 90.0);
            x.hw_fingerprint = Some(fp("25.6.0"));
            s.push(x);
        }
        let r = detect(&s);
        let p = r.patterns.iter().find(|p| p.id == "driver-split").expect("fires");
        assert!(p.detail.contains("25.5.1") && p.detail.contains("25.6.0"));
        assert!(p.title.contains("slower"));
        // Same data but the display changed mid-window → honest skip, flagged.
        let mut s2 = s.clone();
        if let Some(f) = s2[6].hw_fingerprint.as_mut() {
            f.display = "3840x2160@144".into();
        }
        let r2 = detect(&s2);
        assert!(r2.patterns.iter().all(|p| p.id != "driver-split"));
        assert!(r2.coverage.iter().any(|c| c.contains("rig itself changed")));
    }

    #[test]
    fn gaming_mode_split_is_correlation_capped_at_medium() {
        let mut s: Vec<SessionSummary> = Vec::new();
        for i in 0..5 {
            let mut x = mk_session(&day(i), "cp2077.exe", 110.0);
            x.gaming_mode_active = Some(true);
            s.push(x);
        }
        for i in 5..10 {
            let mut x = mk_session(&day(i), "cp2077.exe", 100.0);
            x.gaming_mode_active = Some(false);
            s.push(x);
        }
        let r = detect(&s);
        let p = r.patterns.iter().find(|p| p.id == "gaming-mode-split").expect("fires");
        assert_eq!(p.confidence, Confidence::Medium);
        assert!(p.title.contains("faster"));
        assert!(p.next_test.as_deref().unwrap_or("").contains("Lab"));
    }

    #[test]
    fn session_fade_uses_recorded_traces_only() {
        let mk_fading = |i: usize| {
            let mut x = mk_session(&day(i), "cp2077.exe", 100.0);
            // 36 buckets fading 120 → ~96 (-20%).
            x.fps_series = (0..36).map(|b| (b as u32 * 10, 120.0 - b as f64 * 0.67)).collect();
            x
        };
        let s: Vec<SessionSummary> = (0..5).map(mk_fading).collect();
        let r = detect(&s);
        let p = r.patterns.iter().find(|p| p.id == "session-fade").expect("fires");
        assert!(p.detail.contains("5 of the last 5") || p.detail.contains("of the last 5"));
        assert_eq!(p.confidence, Confidence::Medium);
        // Without traces, silence + no invented fade.
        let bare: Vec<SessionSummary> =
            (0..5).map(|i| mk_session(&day(i), "cp2077.exe", 100.0)).collect();
        let r2 = detect(&bare);
        assert!(r2.patterns.iter().all(|p| p.id != "session-fade"));
    }

    #[test]
    fn multi_game_drift_synthesizes_a_system_pattern() {
        let mut s: Vec<SessionSummary> = Vec::new();
        for i in 0..6 {
            s.push(mk_session(&day(i), "cp2077.exe", 100.0 - 2.5 * i as f64));
            s.push(mk_session(&format!("2026-07-{:02}T20:00:00Z", i + 1), "valorant.exe", 200.0 - 5.0 * i as f64));
        }
        let r = detect(&s);
        let p = r
            .patterns
            .iter()
            .find(|p| p.id == "multi-game-degradation")
            .expect("synthesis fires");
        assert!(p.game.is_none());
        assert!(p.detail.contains("system"));
        assert_eq!(p.confidence, Confidence::Medium);
    }

    #[test]
    fn isolated_drift_names_the_game_and_the_control_group() {
        let mut s: Vec<SessionSummary> = Vec::new();
        for i in 0..6 {
            s.push(mk_session(&day(i), "cp2077.exe", 100.0 - 2.5 * i as f64)); // down
            s.push(mk_session(&format!("2026-07-{:02}T20:00:00Z", i + 1), "valorant.exe", 200.0)); // flat
        }
        let r = detect(&s);
        let p = r
            .patterns
            .iter()
            .find(|p| p.id == "isolated-degradation")
            .expect("fires");
        assert!(p.detail.contains("stayed flat"));
        assert!(r.patterns.iter().all(|x| x.id != "multi-game-degradation"));
    }

    #[test]
    fn report_is_input_order_independent_and_never_says_caused() {
        let mut s: Vec<SessionSummary> = (0..8)
            .map(|i| mk_session(&day(i), "cp2077.exe", 100.0 - 2.0 * i as f64))
            .collect();
        let a = detect(&s);
        s.reverse();
        let b = detect(&s);
        let ser = |r: &PatternReport| serde_json::to_string(r).unwrap();
        assert_eq!(ser(&a), ser(&b), "input order must not change the report");
        assert!(!ser(&a).to_lowercase().contains("caused"));
    }

    #[test]
    fn unparseable_timestamps_are_counted_out_never_guessed() {
        let mut s: Vec<SessionSummary> =
            (0..5).map(|i| mk_session(&day(i), "cp2077.exe", 100.0)).collect();
        s.push(mk_session("last tuesday", "cp2077.exe", 10.0));
        let r = detect(&s);
        // The garbage session is excluded (no fake trend from its 10 FPS)…
        assert!(r.patterns.iter().all(|p| p.id != "performance-trend"));
        // …and the exclusion is stated, not silent.
        assert!(r.coverage.iter().any(|c| c.contains("unreadable timestamps")));
    }
}
