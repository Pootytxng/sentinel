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
    /// Most recently played first.
    pub rough: Vec<RoughGame>,
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
    let mut rough = Vec::new();
    for (_, game) in played {
        let sess = game_sessions(inp, &game);
        let judged = judge_game(&sess);
        let Some(top) = (0..sess.len()).rev().find(|&i| judged[i].verdict != Verdict::Unjudged) else { continue };
        if judged[top].verdict != Verdict::Fired {
            continue;
        }
        let run = (0..=top)
            .rev()
            .filter(|&i| judged[i].verdict != Verdict::Unjudged)
            .take_while(|&i| judged[i].verdict == Verdict::Fired)
            .count();
        rough.push(RoughGame {
            game: game.clone(),
            game_name: intelligence::pretty_game_name(&game),
            rough_sessions: u32::try_from(run).unwrap_or(u32::MAX),
            newest_rough_at: sess[top].started_at.clone(),
        });
    }
    HomeStatus { rough }
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
