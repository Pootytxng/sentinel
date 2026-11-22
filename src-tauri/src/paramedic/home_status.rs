//! B1 Home truth: which games are running rougher than usual right now, by the Paramedic's own judgement,
//! read from the session store alone. Owner decision 2026-11-21: Home may read the session store when it
//! opens (sessions only). READ-ONLY: no Windows reads, no other store, no write, no apply path, no lock.
//!
//! A game is "rough" here exactly when the card, asked about that game, would answer from a rough session:
//! its newest JUDGED session fired the frozen rule (`judge_game`, `Verdict::Fired`). A newer session Compy
//! could not judge never clears it and never adds to it. A game whose newest judged session ran normally is
//! not listed (a recovery, or an unclear one, is the card's to tell, never Home's headline).

use super::*;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct RoughGame {
    /// The process name the sessions carry (the key the card's "Which game?" uses).
    pub game: String,
    pub game_name: String,
    /// How many of the game's newest judged sessions in a row fired the rule. Unjudged sessions between them
    /// are skipped, never counted.
    pub rough_sessions: u32,
    /// `started_at` of the newest rough session.
    pub newest_rough_at: String,
}

#[derive(Serialize, Clone, Debug, PartialEq, Default)]
pub(crate) struct HomeStatus {
    /// Newest rough session first (the order the card picks in when no game is named), ties by last played.
    pub rough: Vec<RoughGame>,
    /// Recent games whose newest judged session was compared with a usual range (it ran normally or rough).
    /// Zero means nothing was measured against a usual range: "no rough game" then says nothing about how the
    /// games ran, and Home never calls the rig measured clean on it.
    pub games_judged: u32,
    /// B2 (owner decision 2026-11-21, the quiet line): games whose rough episode is followed by sessions in their
    /// usual range, exactly as the card judges it (`recovery::outcome`): two clear sessions (Recovered) or one
    /// (the card's "Measured once"). Newest clear session first. Nothing for a game that never had an episode,
    /// or once more than `RECOVERY_SHOWN_FOR` judged sessions have come since it.
    pub back_in_range: Vec<BackInRange>,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub(crate) struct BackInRange {
    pub game: String,
    pub game_name: String,
    /// 1 (one clear session, "Measured once") or 2 (the two newest judged sessions both clear).
    pub sessions: u8,
    /// The clear session(s)' smoothness (1% low as a share of the average), in whole percent.
    pub now_pct: u32,
    /// The episode's usual (the baseline median), in whole percent.
    pub usual_pct: u32,
    /// `started_at` of the newest clear session.
    pub newest_at: String,
}

/// A smoothness ratio as whole percent (the card's `pct`).
fn pct(r: f64) -> u32 {
    if r.is_finite() && r > 0.0 { (r * 100.0).round() as u32 } else { 0 }
}

/// The quiet line's fact for one game: back in its usual range after a rough episode, as the card judges it.
fn back_in_range(game: &str, sess: &[&SessionFacts], judged: &[Judgement], top: usize) -> Option<BackInRange> {
    // A newer session left unjudged makes `recovery::outcome` "partly measured" (Unclear { partial }), so it is
    // never a line here: the card can't tell then either.
    if judged[top].verdict != Verdict::Normal {
        return None;
    }
    let f = (0..top).rev().find(|&i| judged[i].verdict == Verdict::Fired)?;
    let base = judged[recovery::episode_first(judged, f)].base.as_ref()?;
    let (sessions, idx): (u8, Vec<usize>) = match recovery::outcome(sess, judged, f, sess.len())? {
        recovery::Outcome::Recovered { idx } => (2, idx),
        recovery::Outcome::Unclear { one_clear: true, partial: false, cap_changed: false } => (1, vec![top]),
        recovery::Outcome::Unclear { .. } => return None,
    };
    let ratios: Vec<f64> = idx.iter().filter_map(|&i| sess[i].ratio()).collect();
    if ratios.len() != idx.len() {
        return None;
    }
    let newest = *idx.iter().max()?;
    Some(BackInRange {
        game: game.to_string(),
        game_name: intelligence::pretty_game_name(game),
        sessions,
        now_pct: pct(ratios.iter().sum::<f64>() / ratios.len() as f64),
        usual_pct: pct(base.med_r),
        newest_at: sess[newest].started_at.clone(),
    })
}

/// The pure core: the same recent games `diagnose` considers, each judged walk-forward.
pub(crate) fn home_status(inp: &DiagnoseInputs) -> HomeStatus {
    let merged = with_sitting_evidence(inp);
    let inp = &merged;
    let Some(newest) = inp.sessions.iter().filter(|s| !s.mixed).filter_map(SessionFacts::start).max() else {
        return HomeStatus::default();
    };
    let cutoff = newest - chrono::Duration::days(RECENT_GAME_DAYS);
    let mut recent: BTreeMap<String, (DateTime<Utc>, String)> = BTreeMap::new();
    for s in inp.sessions.iter().filter(|s| !s.mixed) {
        let Some(t) = s.start().filter(|t| *t >= cutoff) else { continue };
        let e = recent.entry(s.game.trim().to_ascii_lowercase()).or_insert((t, s.game.clone()));
        if t > e.0 {
            *e = (t, s.game.clone());
        }
    }
    let mut played: Vec<(DateTime<Utc>, String)> = recent.into_values().collect();
    played.sort_by_key(|p| std::cmp::Reverse(p.0));
    let mut rough: Vec<(DateTime<Utc>, DateTime<Utc>, RoughGame)> = Vec::new();
    let mut games_judged = 0u32;
    let mut back: Vec<BackInRange> = Vec::new();
    for (last_played, game) in played {
        let sess = game_sessions(inp, &game);
        let judged = judge_game(&sess);
        let Some(top) = (0..sess.len()).rev().find(|&i| judged[i].verdict != Verdict::Unjudged) else { continue };
        // Counted only where the card's own answer is a measurement: a rough session (Found), or "nothing wrong"
        // (the newest session judged normal, nothing newer left unjudged, and no rough episode whose recovery
        // the card is still telling). A partly measured newest session or an unclear recovery is "can't tell"
        // on the card, so it never lets Home call the rig measured clean.
        let nothing_wrong = judged[top].verdict == Verdict::Normal
            && top + 1 == sess.len()
            && (0..top)
                .rev()
                .find(|&i| judged[i].verdict == Verdict::Fired)
                .and_then(|f| recovery::outcome(&sess, &judged, f, sess.len()))
                .is_none();
        if nothing_wrong || judged[top].verdict == Verdict::Fired {
            games_judged = games_judged.saturating_add(1);
        }
        if let Some(b) = back_in_range(&game, &sess, &judged, top) {
            back.push(b);
        }
        if judged[top].verdict != Verdict::Fired {
            continue;
        }
        let run = (0..=top)
            .rev()
            .filter(|&i| judged[i].verdict != Verdict::Unjudged)
            .take_while(|&i| judged[i].verdict == Verdict::Fired)
            .count();
        let Some(rough_at) = sess[top].start() else { continue };
        rough.push((
            rough_at,
            last_played,
            RoughGame {
                game: game.clone(),
                game_name: intelligence::pretty_game_name(&game),
                rough_sessions: u32::try_from(run).unwrap_or(u32::MAX),
                newest_rough_at: sess[top].started_at.clone(),
            },
        ));
    }
    // The card, asked with no game named, answers for the game whose newest rough session is the most recent:
    // Home names that game first, so the line and the answer behind the button agree.
    rough.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    back.sort_by(|a, b| b.newest_at.cmp(&a.newest_at));
    HomeStatus { rough: rough.into_iter().map(|(_, _, g)| g).collect(), games_judged, back_in_range: back }
}

/// The Tauri edge: reads `sessions.json` read-only and nothing else. A store that is there and cannot be
/// read is an error (Home then says it couldn't read how the games ran), never "no rough game".
#[tauri::command]
pub(crate) async fn paramedic_home_status() -> Result<HomeStatus, String> {
    tauri::async_runtime::spawn_blocking(|| -> Result<HomeStatus, String> {
        let sessions = crate::sessions::read_sessions_readonly_from(&crate::compy_data_dir().join("sessions.json"))?;
        Ok(home_status(&inputs_from_parts(&sessions, &[], &[])))
    })
    .await
    .map_err(|_| "the session read stopped unexpectedly".to_string())?
}
