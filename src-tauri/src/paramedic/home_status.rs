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
    HomeStatus { rough: rough.into_iter().map(|(_, _, g)| g).collect(), games_judged }
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
