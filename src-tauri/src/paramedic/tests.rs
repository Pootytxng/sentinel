use super::*;

/// The owner's 50 recorded sessions, NUMBERS ONLY: games are game-a.., no process names, no paths,
/// no machine identifiers. game-i is the game that got rough on 2026-11-19/20; game-h is the second one.
const FIXTURE: &str = include_str!("owner_sessions_2026_11.json");
const ROUGH_GAME: &str = "game-i";
const SECOND_GAME: &str = "game-h";
/// Sessions the smoothness rule fires on. The first one only measured 90 readings, so it corroborates
/// and is never judged alone.
const INCIDENT_WOULD_FIRE: [&str; 5] = [
    "2026-11-19T03:43:25Z",
    "2026-11-20T01:01:24Z",
    "2026-11-20T02:53:38Z",
    "2026-11-20T03:30:00Z",
    "2026-11-20T03:51:22Z",
];

fn fixture() -> DiagnoseInputs {
    serde_json::from_str(FIXTURE).expect("the fixture parses")
}

fn games(inp: &DiagnoseInputs) -> Vec<String> {
    let mut g: Vec<String> = inp.sessions.iter().map(|s| s.game.clone()).collect();
    g.sort();
    g.dedup();
    g
}

fn facts(at: &str, dur: u64, samples: u32, avg: f64, low1: f64) -> SessionFacts {
    SessionFacts {
        started_at: at.into(),
        game: "g".into(),
        duration_secs: dur,
        samples,
        background_secs: 0,
        avg_fps: avg,
        low1_fps: low1,
        p99_ms: None,
        peak_ram_bytes: None,
        ram_total_bytes: None,
        gpu_driver: None,
        windows_build: None,
        refresh_hz: None,
        power_plan: None,
        rig: None,
        compy_changes: None,
        busy_starts: 0,
        busy_names: Vec::new(),
        ram_events: 0,
        other_cpu_p90_pct: None,
        cap: CapState::Unknown,
    }
}

/// `n` normal sessions: 600 s, fully measured, smoothness ratio 0.5, one a day.
fn steady(n: usize) -> Vec<SessionFacts> {
    (0..n).map(|i| facts(&format!("2026-10-{:02}T10:00:00Z", i + 1), 600, 600, 100.0, 50.0)).collect()
}

fn inputs(sessions: Vec<SessionFacts>) -> DiagnoseInputs {
    DiagnoseInputs { sessions, ..DiagnoseInputs::default() }
}

fn ids(d: &Diagnosis) -> Vec<&'static str> {
    d.findings.iter().map(|f| f.id).collect()
}

fn certainties(d: &Diagnosis) -> Vec<Certainty> {
    d.findings.iter().map(|f| f.confidence).collect()
}

// ---- (a) the owner's real sessions -----------------------------------------------------------
#[test]
fn fires_on_the_owners_incident_and_nothing_else() {
    let inp = fixture();
    assert_eq!(inp.sessions.len(), 50);
    let (mut would, mut fired) = (Vec::new(), Vec::new());
    for g in games(&inp) {
        let sess = game_sessions(&inp, &g);
        let judged = judge_game(&sess);
        for (i, s) in sess.iter().enumerate() {
            if judged[i].would_fire {
                would.push(s.started_at.clone());
            }
            if judged[i].verdict == Verdict::Fired {
                fired.push(s.started_at.clone());
            }
        }
    }
    would.sort();
    fired.sort();
    assert_eq!(would, INCIDENT_WOULD_FIRE, "the rule must fire on the five incident sessions and on none of the other 45");
    let judged_alone: Vec<&str> = INCIDENT_WOULD_FIRE.iter().copied().filter(|a| *a != "2026-11-19T03:43:25Z").collect();
    assert_eq!(fired, judged_alone, "the 90-reading session is never judged alone");
}

#[test]
fn walking_forward_only_the_incident_sessions_are_found() {
    let full = fixture();
    let mut order: Vec<&SessionFacts> = full.sessions.iter().collect();
    order.sort_by_key(|s| s.start());
    let mut found = Vec::new();
    for s in &order {
        let at = s.start().expect("start");
        // "As of" this session: nothing later is visible to the judge.
        let inp = DiagnoseInputs {
            sessions: order.iter().filter(|x| x.start() <= Some(at)).map(|x| (*x).clone()).collect(),
            sightings: full.sightings.iter().filter(|x| ts(&x.observed_at) <= Some(at)).cloned().collect(),
            drift: full.drift.iter().filter(|x| ts(&x.noticed_at) <= Some(at)).cloned().collect(),
        };
        let d = diagnose(&inp, Complaint::Unknown, Some(&s.game));
        if matches!(d.state, DiagnosisState::Found | DiagnosisState::CantTell { why: CantTellWhy::NothingChanged }) {
            found.push(s.started_at.clone());
        }
    }
    let expected: Vec<&str> = INCIDENT_WOULD_FIRE.iter().copied().filter(|a| *a != "2026-11-19T03:43:25Z").collect();
    assert_eq!(found, expected);
}

#[test]
fn the_owners_incident_lists_what_changed_and_does_not_pretend_to_separate_it() {
    let d = diagnose(&fixture(), Complaint::WasFineBefore, Some(ROUGH_GAME));
    assert_eq!(d.state, DiagnosisState::Found);
    assert_eq!(ids(&d), ["gpu-driver-change", "background-load", "setting-drift", "memory-pressure"]);
    // A changed driver stamp and its timing are one support; the other game's roughness overlaps a busy
    // PC and has no load numbers, so it is confounded. Nothing reaches two independent supports.
    assert_eq!(certainties(&d), [Certainty::Possible; 4]);
    assert_eq!(d.findings.iter().map(|f| f.in_play).collect::<Vec<_>>(), [true, true, true, false]);
    assert_eq!(d.baseline.as_ref().expect("baseline").started_at, "2026-11-11T14:14:22Z");
    assert_eq!(d.first_bad.as_ref().expect("first bad").started_at, "2026-11-20T01:01:24Z");
    assert_eq!(d.why_first, Some("not-separable"));
    let p = d.problem.as_ref().expect("problem");
    assert_eq!(p.rule, AnomalyRule::StutterCollapse);
    assert!(p.spikes, "01:01 also had spikes: 14.7 ms against a 6.7 ms usual");
    assert_eq!(p.sessions_affected.len(), 2);
    assert_eq!(p.partial_sessions.len(), 1, "the 90-reading session corroborates");
    assert_eq!(p.other_games_affected, [SECOND_GAME]);
    assert!((p.before.ratio - 0.6365).abs() < 1e-3, "usual smoothness {}", p.before.ratio);
    assert!((p.now.ratio - 0.4165).abs() < 1e-3, "now {}", p.now.ratio);
    assert!(!p.avg_lower, "the average alone does not speak: 0.78 of usual");
}

#[test]
fn the_driver_finding_carries_the_design_evidence() {
    let d = diagnose(&fixture(), Complaint::Slow, Some(ROUGH_GAME));
    let f = &d.findings[0];
    let codes: Vec<&str> = f.evidence.iter().map(|e| e.code).collect();
    assert_eq!(
        codes,
        ["driver-changed", "sessions-split", "cross-game", "cross-game-confounded", "partial-rough-on-old-driver", "install-time-not-read"]
    );
    let partial = f.evidence.iter().find(|e| e.code == "partial-rough-on-old-driver").expect("shown");
    assert!(partial.against && partial.args["date"] == "2026-11-19T03:43:25Z", "the partly measured old-driver session is shown against it");
    assert_eq!(f.confidence, Certainty::Possible);
    assert_eq!(f.evidence[0].kind, EvidenceKind::Known);
    assert_eq!(f.evidence[0].args["from"], "32.0.32015.7029");
    assert_eq!(f.evidence[0].args["to"], "32.0.32029.2010");
    assert_eq!(f.evidence[2].args["games"], SECOND_GAME);
    assert_eq!(f.evidence[3].kind, EvidenceKind::Unknown);
    // Bracketed between the end of the last old-driver session and the first look at the new one.
    assert_eq!(
        f.since_when,
        When::ObservedBetween { from: "2026-11-19T05:12:26Z".into(), to: "2026-11-19T16:54:51Z".into() }
    );
    assert!(matches!(&f.fix, Fix::Steps { code: "gpu-driver-change", .. }));
    // Background: starts seen in the episode (the other game's session logged 21), and the load was never
    // recorded. An absence of starts is NOT evidence against it.
    let bg: Vec<&str> = d.findings[1].evidence.iter().map(|e| e.code).collect();
    assert_eq!(bg, ["starts-seen", "load-not-recorded"]);
    assert!(d.findings[1].evidence.iter().all(|e| !e.against), "nothing recorded argues against background load");
    assert_eq!(d.findings[1].evidence[1].kind, EvidenceKind::Unknown);
    assert!(d.findings[3].evidence.iter().any(|e| e.against && e.code == "ram-lower"));
}

#[test]
fn the_unchanged_conditions_are_listed_as_ruled_out() {
    let d = diagnose(&fixture(), Complaint::Slow, Some(ROUGH_GAME));
    let mut got: Vec<&str> = d.not_it.iter().map(|n| n.id).collect();
    got.sort_unstable();
    assert_eq!(got, ["compy-change", "display-refresh-lower", "hardware-change", "power-plan-change", "windows-build-change"]);
    for code in ["game-patch", "startup-programs", "overlays", "other-load"] {
        assert!(d.unknowns.contains(&code), "{code} is something Compy could not see");
    }
}

#[test]
fn as_of_the_first_rough_session_the_driver_still_leads() {
    let full = fixture();
    let at = ts("2026-11-20T01:01:24Z");
    let inp = DiagnoseInputs {
        sessions: full.sessions.iter().filter(|s| s.start() <= at).cloned().collect(),
        sightings: full.sightings.clone(),
        drift: full.drift.clone(),
    };
    let d = diagnose(&inp, Complaint::Unknown, Some(ROUGH_GAME));
    assert_eq!(ids(&d), ["gpu-driver-change", "background-load", "setting-drift", "memory-pressure"]);
    assert_eq!(d.findings[0].confidence, Certainty::Possible);
    assert_eq!(d.problem.as_ref().expect("problem").sessions_affected.len(), 1);
    assert_eq!(d.why_first, Some("not-separable"));
    assert!(d.findings[0].evidence.iter().all(|e| e.code != "cross-game"), "the cross-game support only exists once the second game gets rough");
}

#[test]
fn the_second_game_gets_the_same_top_finding() {
    let d = diagnose(&fixture(), Complaint::Slow, Some(SECOND_GAME));
    assert_eq!(d.state, DiagnosisState::Found);
    assert_eq!(d.findings[0].id, "gpu-driver-change");
    assert_eq!(d.findings[0].confidence, Certainty::Possible);
    assert_eq!(d.problem.as_ref().expect("problem").other_games_affected, [ROUGH_GAME]);
}

#[test]
fn the_card_leads_with_the_newest_game_when_none_is_named() {
    let d = diagnose(&fixture(), Complaint::Unknown, None);
    assert_eq!(d.game.as_deref(), Some(ROUGH_GAME));
}

#[test]
fn finding_order_is_pinned() {
    let order = [
        "hardware-change",
        "background-load",
        "gpu-driver-change",
        "memory-pressure",
        "display-refresh-lower",
        "power-plan-change",
        "compy-change",
        "setting-drift",
        "windows-build-change",
    ];
    for w in order.windows(2) {
        assert!(category(w[0]) < category(w[1]), "{} must rank before {}", w[0], w[1]);
    }
    assert_eq!(category("unlisted"), order.len());
}

#[test]
#[ignore = "prints the diagnosis JSON for the report: cargo test --lib paramedic -- --ignored --nocapture"]
fn print_fixture_diagnosis() {
    let d = diagnose(&fixture(), Complaint::Unknown, None);
    println!("{}", serde_json::to_string_pretty(&d).expect("serialises"));
}

// ---- (b) threshold edges -------------------------------------------------------------------
#[test]
fn judgeable_edges_are_exact() {
    // (duration, samples, seconds spent alt-tabbed, judgeable)
    let cases: [(u64, u32, u32, bool); 8] = [
        (299, 299, 0, false),  // one second short of five minutes
        (300, 300, 0, true),   // exactly five minutes
        (300, 249, 0, false),  // one reading short of 250
        (300, 250, 0, true),   // exactly 250 readings
        (1000, 499, 0, false), // coverage 0.499
        (1000, 500, 0, true),  // coverage exactly 0.50
        (1000, 300, 400, true), // alt-tabbed seconds are not the game's: 300 / 600 = 0.50
        (1000, 299, 400, false),
    ];
    for (dur, samples, bg, want) in cases {
        let mut s = facts("2026-10-01T10:00:00Z", dur, samples, 100.0, 50.0);
        s.background_secs = bg;
        assert_eq!(s.judgeable(), want, "duration {dur}, samples {samples}, alt-tabbed {bg}");
    }
    let mut unread = facts("2026-10-01T10:00:00Z", 600, 600, 100.0, 0.0);
    assert!(!unread.judgeable(), "an unread 1% low is never judged as a zero");
    unread.low1_fps = 50.0;
    assert!(unread.judgeable());
}

fn base(med_r: f64, min_r: f64) -> BaseStats {
    BaseStats { med_r, min_r, med_p99: Some(10.0), max_p99: Some(16.0), med_avg: 100.0, ids: vec![0, 1, 2] }
}

#[test]
fn rule_r_needs_both_conditions() {
    let at = |low1: f64| facts("2026-10-09T10:00:00Z", 600, 600, 100.0, low1);
    // usual 0.5, worst 0.5: the 0.80 line (0.40) is the binding one.
    let b = base(0.5, 0.5);
    assert!(evaluate(&at(40.0), &b).expect("read").rule_r);
    assert!(!evaluate(&at(41.0), &b).expect("read").rule_r);
    // usual 0.9 but one earlier dip to 0.45: the 0.03-under-the-worst line (0.42) is the binding one.
    let b = base(0.9, 0.45);
    assert!(evaluate(&at(41.0), &b).expect("read").rule_r);
    assert!(!evaluate(&at(43.0), &b).expect("read").rule_r, "below 0.80 of usual, but not below the game's own worst");
}

#[test]
fn spikes_corroborate_only_with_a_smoothness_drop() {
    let b = base(0.5, 0.5);
    let mut s = facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 44.0);
    s.p99_ms = Some(24.0);
    let e = evaluate(&s, &b).expect("read");
    assert!(!e.rule_r && e.rule_p99 && e.fired, "R 0.44 is within 0.90 of usual and the spikes are 2.4x");
    s.low1_fps = 46.0;
    assert!(!evaluate(&s, &b).expect("read").fired, "R 0.46 is above 0.90 of usual: spikes alone do not fire");
    s.low1_fps = 44.0;
    s.p99_ms = Some(19.9);
    assert!(!evaluate(&s, &b).expect("read").rule_p99, "just under twice the usual");
    s.p99_ms = Some(20.0);
    assert!(!evaluate(&s, &b).expect("read").rule_p99, "twice the usual but not 1.3x the worst earlier one (20.8)");
    s.p99_ms = Some(20.8);
    assert!(evaluate(&s, &b).expect("read").rule_p99);
}

#[test]
fn a_lower_average_alone_never_fires() {
    let mut sess = steady(4);
    sess.push(facts("2026-10-09T10:00:00Z", 600, 600, 40.0, 20.0)); // 0.4 of the usual speed, same smoothness
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert_eq!(d.state, DiagnosisState::NothingWrong { sessions_checked: 2 });
    assert!(d.problem.is_none());
}

#[test]
fn fewer_than_three_baseline_sessions_needs_more_play() {
    let d = diagnose(&inputs(steady(3)), Complaint::Slow, Some("g"));
    assert_eq!(d.state, DiagnosisState::NeedsMorePlay { sessions_needed: 1, have: 2 });
    let d = diagnose(&inputs(steady(1)), Complaint::Slow, Some("g"));
    assert_eq!(d.state, DiagnosisState::NeedsMorePlay { sessions_needed: 3, have: 0 });
    // Four sessions: the fourth has exactly three before it and is judged.
    let d = diagnose(&inputs(steady(4)), Complaint::Slow, Some("g"));
    assert_eq!(d.state, DiagnosisState::NothingWrong { sessions_checked: 1 });
}

#[test]
fn a_thinly_measured_session_is_not_a_normal_one() {
    // Judgeable (coverage 0.70) but under 0.80: it cannot stand in for "how it normally runs".
    let thin: Vec<SessionFacts> = (0..5)
        .map(|i| facts(&format!("2026-10-{:02}T10:00:00Z", i + 1), 600, 420, 100.0, 50.0))
        .collect();
    let d = diagnose(&inputs(thin), Complaint::Slow, Some("g"));
    assert!(matches!(d.state, DiagnosisState::NeedsMorePlay { have: 0, .. }), "{:?}", d.state);
}

#[test]
fn healthy_is_nothing_wrong() {
    let d = diagnose(&inputs(steady(5)), Complaint::Slow, Some("g"));
    assert_eq!(d.state, DiagnosisState::NothingWrong { sessions_checked: 2 });
    assert!(d.problem.is_none() && d.findings.is_empty());
}

#[test]
fn nothing_changed_is_cant_tell_with_the_anomaly_still_reported() {
    let mut sess = steady(4);
    sess.push(facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 30.0)); // ratio 0.3: far outside 0.5
    let d = diagnose(&inputs(sess), Complaint::WasFineBefore, Some("g"));
    assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::NothingChanged });
    assert!(d.findings.is_empty(), "no recorded change to list");
    let p = d.problem.as_ref().expect("the measured problem is still shown");
    assert!((p.before.ratio - 0.5).abs() < 1e-9 && (p.now.ratio - 0.3).abs() < 1e-9);
    assert!(d.unknowns.contains(&"game-patch"), "and the honest gaps are listed");
}

#[test]
fn a_ninety_reading_session_is_never_judged_alone() {
    let mut sess = steady(4);
    let mut partial = facts("2026-10-09T10:00:00Z", 467, 90, 139.7, 24.3);
    partial.background_secs = 6;
    sess.push(partial);
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    // The newest session was never read, so the older ones must not be reported as "nothing wrong" in its
    // place; and on the numbers it has it would have fired, which the answer says.
    assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::PartialMeasure { percent: 20, looked_rough: true } });
    // Alone, it is not judged at all, and with nothing to compare it against it cannot look rough.
    let only = inputs(vec![facts("2026-10-09T10:00:00Z", 467, 90, 139.7, 24.3)]);
    let d = diagnose(&only, Complaint::Slow, Some("g"));
    assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::PartialMeasure { percent: 19, looked_rough: false } });
}

#[test]
fn a_partial_session_corroborates_a_judged_one() {
    let mut sess = steady(4);
    sess.push(facts("2026-10-09T10:00:00Z", 467, 90, 139.7, 24.3));
    sess.push(facts("2026-10-10T10:00:00Z", 600, 600, 100.0, 30.0));
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    let p = d.problem.expect("found");
    assert_eq!(p.sessions_affected.len(), 1);
    assert_eq!(p.partial_sessions.len(), 1);
}

#[test]
fn no_sessions_and_crash_are_honest_answers() {
    let d = diagnose(&DiagnoseInputs::default(), Complaint::Slow, None);
    assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::NoSessions });
    let d = diagnose(&inputs(steady(5)), Complaint::Slow, Some("never-played"));
    assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::NoSessions });
    let d = diagnose(&inputs(steady(5)), Complaint::Crash, Some("g"));
    assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::CrashNotCovered });
}

#[test]
fn a_changed_driver_stamp_alone_is_one_support_so_only_possible() {
    let mut sess = steady(4);
    for s in sess.iter_mut() {
        s.gpu_driver = Some("1.0".into());
    }
    let mut rough = facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 30.0);
    rough.gpu_driver = Some("2.0".into());
    sess.push(rough);
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert_eq!(ids(&d), ["gpu-driver-change"]);
    assert_eq!(d.findings[0].confidence, Certainty::Possible, "a different stamp and the timing that follows from it are ONE support");
    assert_eq!(d.why_first, None);
}

#[test]
fn a_rough_session_on_the_old_driver_weakens_the_driver() {
    let mut sess = steady(4);
    for s in sess.iter_mut() {
        s.gpu_driver = Some("1.0".into());
    }
    let mut first = facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 30.0);
    first.gpu_driver = Some("2.0".into());
    let mut second = facts("2026-10-10T10:00:00Z", 600, 600, 100.0, 30.0);
    second.gpu_driver = Some("1.0".into());
    sess.push(first);
    sess.push(second);
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert_eq!(d.findings[0].confidence, Certainty::Possible, "one rough session never saw the new driver");
    assert!(d.findings[0].evidence.iter().any(|e| e.against && e.code == "rough-on-old-driver"));
}

#[test]
fn two_changes_that_line_up_equally_are_not_separable() {
    let mut sess = steady(4);
    for s in sess.iter_mut() {
        s.gpu_driver = Some("1.0".into());
        s.windows_build = Some("100.1".into());
    }
    let mut rough = facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 30.0);
    rough.gpu_driver = Some("2.0".into());
    rough.windows_build = Some("100.2".into());
    sess.push(rough);
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert_eq!(ids(&d), ["gpu-driver-change", "windows-build-change"]);
    assert_eq!(d.why_first, Some("not-separable"));
    assert!(d.findings.iter().all(|f| f.in_play && f.confidence == Certainty::Possible));
}

#[test]
fn a_new_compy_change_count_is_listed_and_an_unchanged_one_is_ruled_out() {
    let mut sess = steady(4);
    for s in sess.iter_mut() {
        s.compy_changes = Some(2);
    }
    let mut rough = facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 30.0);
    rough.compy_changes = Some(5);
    sess.push(rough);
    let d = diagnose(&inputs(sess.clone()), Complaint::Slow, Some("g"));
    assert_eq!(ids(&d), ["compy-change"]);
    sess[4].compy_changes = Some(2);
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert!(d.not_it.iter().any(|n| n.id == "compy-change"));
}

#[test]
fn busy_programs_measured_on_every_rough_session_are_likely() {
    let mut sess = steady(4);
    for s in sess.iter_mut() {
        s.other_cpu_p90_pct = Some(2.0);
    }
    let mut rough = facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 30.0);
    rough.other_cpu_p90_pct = Some(22.0);
    rough.busy_starts = 9;
    rough.busy_names = vec!["rustc".into()];
    sess.push(rough);
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert_eq!(ids(&d), ["background-load"]);
    assert_eq!(d.findings[0].confidence, Certainty::Likely);
    assert!(matches!(&d.findings[0].fix, Fix::Steps { code: "background-load", args } if args["names"] == "rustc"));
}

// ==== review round 1: the card must never say something false ===================================
fn as_of(at: &str) -> DiagnoseInputs {
    let full = fixture();
    let at = ts(at);
    DiagnoseInputs {
        sessions: full.sessions.iter().filter(|s| s.start() <= at).cloned().collect(),
        sightings: full.sightings.iter().filter(|x| ts(&x.observed_at) <= at).cloned().collect(),
        drift: full.drift.iter().filter(|x| ts(&x.noticed_at) <= at).cloned().collect(),
    }
}

fn named(mut s: SessionFacts, game: &str) -> SessionFacts {
    s.game = game.into();
    s
}

fn at_day(day: u32, hour: u32) -> String {
    format!("2026-10-{day:02}T{hour:02}:00:00Z")
}

/// Four normal sessions of `game` on driver 1.0 (ratio 0.5), one a day at `hour`.
fn steady_on_old(game: &str, hour: u32) -> Vec<SessionFacts> {
    (1..=4)
        .map(|d| {
            let mut s = named(facts(&at_day(d, hour), 600, 600, 100.0, 50.0), game);
            s.gpu_driver = Some("1.0".into());
            s
        })
        .collect()
}

/// A rough session (ratio 0.3) of `game` on driver 2.0 on the ninth, load measured quiet.
fn rough_on_new(game: &str, hour: u32) -> SessionFacts {
    let mut s = named(facts(&at_day(9, hour), 600, 600, 100.0, 30.0), game);
    s.gpu_driver = Some("2.0".into());
    s.other_cpu_p90_pct = Some(1.0);
    s
}

#[test]
fn a_newest_session_that_was_only_partly_measured_is_never_nothing_wrong() {
    // The real fixture as of the 90-reading session (ratio 0.17, 27 build-tool starts): the newest JUDGED
    // session is a normal one from weeks before, and "nothing looks wrong" would speak for the rough one
    // Compy never read.
    let d = diagnose(&as_of("2026-11-19T03:43:25Z"), Complaint::Unknown, Some(ROUGH_GAME));
    assert!(
        matches!(d.state, DiagnosisState::CantTell { why: CantTellWhy::PartialMeasure { looked_rough: true, .. } }),
        "{:?}",
        d.state
    );
    // And a thin session that does NOT look rough is still "partly measured", never "nothing wrong".
    let mut sess = steady(5);
    sess.push(facts("2026-10-09T10:00:00Z", 100, 80, 100.0, 50.0));
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert!(matches!(d.state, DiagnosisState::CantTell { why: CantTellWhy::PartialMeasure { looked_rough: false, .. } }), "{:?}", d.state);
}

#[test]
fn a_frame_cap_change_alone_never_fires() {
    let capped = |n: u32, at: f64| -> Vec<SessionFacts> {
        (1..=n)
            .map(|d| {
                let mut s = facts(&at_day(d, 10), 600, 600, 100.0, 90.0);
                s.cap = CapState::Capped { at_fps: at };
                s
            })
            .collect()
    };
    let mut sess = capped(4, 141.0);
    let mut uncapped = facts(&at_day(9, 10), 600, 600, 100.0, 66.0);
    uncapped.cap = CapState::Uncapped;
    sess.push(uncapped.clone());
    // 0.66 is under 0.80 x 0.90 and under the worst earlier ratio less 0.03, so without the cap rule it would fire.
    let d = diagnose(&inputs(sess.clone()), Complaint::Slow, Some("g"));
    assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::FrameCapChanged });
    assert!(d.problem.is_none(), "no stutter alarm");
    assert_eq!(d.findings[0].id, "frame-cap-change", "the change itself is the measured finding");
    assert_eq!(d.findings[0].evidence[0].args["from"], "141");
    assert_eq!(d.findings[0].evidence[0].args["to"], "uncapped");
    // An unknown cap against a known one is not comparable either.
    sess[4].cap = CapState::Unknown;
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::FrameCapChanged });
    // Once three sessions exist in the new state, sessions are compared like with like, and a rough one fires.
    let mut sess = capped(4, 141.0);
    for d in 5..=7 {
        let mut s = facts(&at_day(d, 10), 600, 600, 100.0, 66.0);
        s.cap = CapState::Uncapped;
        sess.push(s);
    }
    let mut rough = facts(&at_day(9, 10), 600, 600, 100.0, 30.0);
    rough.cap = CapState::Uncapped;
    sess.push(rough);
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::NothingChanged }, "{:?}", d.state);
    assert!((d.problem.expect("rough").before.ratio - 0.66).abs() < 1e-9, "judged against the uncapped sessions only");
    // Caps within five percent are the same cap; further apart they are not.
    assert!(CapState::Capped { at_fps: 141.0 }.same_as(CapState::Capped { at_fps: 144.0 }));
    assert!(!CapState::Capped { at_fps: 141.0 }.same_as(CapState::Capped { at_fps: 160.0 }));
}

#[test]
fn absent_process_starts_are_unknown_not_against_when_load_was_not_recorded() {
    let mut sess = steady(4);
    // Another game's session in the window logged 21 build-tool starts; the rough session logged none.
    let mut other = named(facts("2026-10-05T10:00:00Z", 600, 600, 100.0, 50.0), "h");
    other.busy_starts = 21;
    sess.push(other);
    sess.push(facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 30.0));
    let d = diagnose(&inputs(sess.clone()), Complaint::Slow, Some("g"));
    let bg = d.findings.iter().find(|f| f.id == "background-load").expect("starts seen in the episode are timing");
    assert!(bg.evidence.iter().all(|e| !e.against), "an absence of starts is not evidence the PC was quiet");
    assert!(bg.evidence.iter().any(|e| e.code == "load-not-recorded" && e.kind == EvidenceKind::Unknown));
    assert_eq!(bg.confidence, Certainty::Possible);
    assert!(bg.in_play);
    // A recorded low load number is the only thing that weakens it.
    sess[5].other_cpu_p90_pct = Some(3.0);
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    let bg = d.findings.iter().find(|f| f.id == "background-load").expect("still listed");
    assert!(bg.evidence.iter().any(|e| e.against && e.code == "load-quiet"));
    assert!(!bg.in_play);
}

#[test]
fn memory_already_that_full_in_normal_sessions_is_not_never_nearly_full() {
    let d = diagnose(&fixture(), Complaint::Slow, Some(SECOND_GAME));
    let ids: Vec<&str> = d.not_it.iter().map(|n| n.id).collect();
    assert!(!ids.contains(&"memory-pressure"), "the rough sessions peaked at 92-97%, so it is never 'never nearly full'");
    let m = d.not_it.iter().find(|n| n.id == "memory-as-full").expect("said as what it is");
    assert!(m.args.contains_key("peakGb") && m.args.contains_key("totalGb") && m.args.contains_key("basePeakGb"));
    assert!(d.findings.iter().all(|f| f.id != "memory-pressure"), "no change, so no finding");
    // And when every rough session really stayed below 90%, the plain line is still right.
    let mut sess = steady(4);
    for s in sess.iter_mut() {
        s.peak_ram_bytes = Some(50);
        s.ram_total_bytes = Some(100);
    }
    let mut rough = facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 30.0);
    rough.peak_ram_bytes = Some(60);
    rough.ram_total_bytes = Some(100);
    sess.push(rough);
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert!(d.not_it.iter().any(|n| n.id == "memory-pressure"));
}

#[test]
fn a_thinly_measured_session_that_ran_normally_on_the_new_driver_weighs_against_it() {
    let mut sess = steady_on_old("g", 10);
    // Coverage 0.67: judged Normal, never a baseline session, on the NEW driver, before the rough one.
    let mut thin = facts(&at_day(8, 10), 600, 400, 100.0, 50.0);
    thin.gpu_driver = Some("2.0".into());
    sess.push(thin);
    sess.push(rough_on_new("g", 10));
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    let f = d.findings.iter().find(|f| f.id == "gpu-driver-change").expect("listed");
    assert!(f.evidence.iter().any(|e| e.against && e.code == "normal-on-new-driver"));
    assert_eq!(f.confidence, Certainty::Possible);
    assert!(!f.in_play, "something is against it");
    assert_eq!(d.problem.expect("problem").last_normal_at, at_day(8, 10), "it last ran normally on the thin session");
}

#[test]
fn a_cross_game_support_that_overlaps_a_busy_pc_is_not_independent() {
    let mut sess = steady_on_old("g", 10);
    sess.extend(steady_on_old("h", 12));
    sess.push(rough_on_new("g", 10));
    let mut h = rough_on_new("h", 12);
    h.busy_starts = 9;
    sess.push(h);
    let d = diagnose(&inputs(sess.clone()), Complaint::Slow, Some("g"));
    let f = d.findings.iter().find(|f| f.id == "gpu-driver-change").expect("listed");
    assert_eq!(f.confidence, Certainty::Possible, "the other game's rough session overlaps recorded build tools");
    assert!(f.evidence.iter().any(|e| e.code == "cross-game-confounded"));
    // With the other game's load measured quiet, the second support stands.
    sess.pop();
    sess.push(rough_on_new("h", 12));
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert_eq!(d.findings[0].confidence, Certainty::Likely);
}

#[test]
fn the_other_changes_dont_line_up_is_said_only_when_every_runner_up_is_contradicted() {
    let mut sess = steady_on_old("g", 10);
    sess.extend(steady_on_old("h", 12));
    sess.push(rough_on_new("g", 10));
    sess.push(rough_on_new("h", 12));
    let mut inp = inputs(sess);
    let d = diagnose(&inp, Complaint::Slow, Some("g"));
    assert_eq!(ids(&d), ["gpu-driver-change"]);
    assert_eq!(d.why_first, Some("cross-game"), "nothing else changed, so nothing else lines up");
    // A setting noticed changed inside the window still lines up with every rough session.
    inp.drift.push(DriftFact { id: "applied-changes".into(), last_ready_at: None, noticed_at: "2026-10-07T12:00:00Z".into() });
    let d = diagnose(&inp, Complaint::Slow, Some("g"));
    assert_eq!(ids(&d), ["gpu-driver-change", "setting-drift"]);
    assert_eq!(d.why_first, Some("cross-game-lead"), "the second sentence would be false here");
}

#[test]
fn two_likely_findings_are_a_tie() {
    let mut sess = steady_on_old("g", 10);
    for s in sess.iter_mut() {
        s.other_cpu_p90_pct = Some(2.0);
    }
    sess.extend(steady_on_old("h", 12));
    let mut g_rough = rough_on_new("g", 10);
    g_rough.other_cpu_p90_pct = Some(22.0);
    g_rough.busy_starts = 9;
    sess.push(g_rough);
    sess.push(rough_on_new("h", 12));
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert_eq!(ids(&d), ["background-load", "gpu-driver-change"]);
    assert_eq!(certainties(&d), [Certainty::Likely, Certainty::Likely]);
    assert_eq!(d.why_first, Some("tie"));
}

#[test]
fn with_no_game_named_a_game_with_too_few_sessions_never_hides_another_games_problem() {
    let mut sess = steady(4);
    sess.push(facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 30.0)); // g is rough
    sess.push(named(facts("2026-10-10T10:00:00Z", 600, 600, 100.0, 50.0), "j"));
    sess.push(named(facts("2026-10-11T10:00:00Z", 600, 600, 100.0, 50.0), "j")); // newest session: j, 2 of 3
    let d = diagnose(&inputs(sess.clone()), Complaint::Unknown, None);
    assert_eq!(d.game.as_deref(), Some("g"), "the measured problem is not hidden by the newest game");
    assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::NothingChanged });
    // Nobody rough: the game played last answers.
    sess[4] = facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 50.0);
    let d = diagnose(&inputs(sess.clone()), Complaint::Unknown, None);
    assert_eq!(d.game.as_deref(), Some("j"));
    assert!(matches!(d.state, DiagnosisState::NeedsMorePlay { .. }));
    // A game last played more than fourteen days before the newest session is not looked at, rough or not.
    for day in 1..=4 {
        sess.push(named(facts(&format!("2026-09-0{day}T10:00:00Z"), 600, 600, 100.0, 50.0), "old"));
    }
    sess.push(named(facts("2026-09-05T10:00:00Z", 600, 600, 100.0, 30.0), "old"));
    let d = diagnose(&inputs(sess), Complaint::Unknown, None);
    assert_eq!(d.game.as_deref(), Some("j"));
}

fn scratch_dir(tag: &str) -> std::path::PathBuf {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static N: AtomicUsize = AtomicUsize::new(0);
    let dir = std::env::temp_dir().join(format!("compy-paramedic-{tag}-{}-{}", std::process::id(), N.fetch_add(1, Ordering::Relaxed)));
    std::fs::create_dir_all(&dir).expect("scratch dir");
    dir
}

fn listing(dir: &std::path::Path) -> Vec<(String, u64)> {
    let mut v: Vec<(String, u64)> = std::fs::read_dir(dir)
        .expect("readable")
        .map(|e| e.expect("entry"))
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.metadata().expect("meta").len()))
        .collect();
    v.sort();
    v
}

#[test]
fn a_damaged_or_unreadable_store_is_an_error_and_the_read_changes_nothing() {
    let dir = scratch_dir("damaged");
    // Nothing recorded yet is an honest empty answer.
    assert!(read_inputs_from(&dir).expect("absent files are empty stores").sessions.is_empty());
    std::fs::write(dir.join("sessions.json"), "[]").expect("write");
    assert!(read_inputs_from(&dir).expect("an empty history").sessions.is_empty());
    // A sessions file that is there but damaged is an error, not "no games yet", and stays where it is.
    std::fs::write(dir.join("sessions.json"), "{ not json").expect("write");
    let before = listing(&dir);
    assert!(read_inputs_from(&dir).is_err());
    assert_eq!(listing(&dir), before, "no rename, no set-aside, no new file");
    assert_eq!(std::fs::read_to_string(dir.join("sessions.json")).expect("still there"), "{ not json");
    // The same for the two other stores.
    std::fs::write(dir.join("sessions.json"), "[]").expect("write");
    std::fs::write(dir.join("drift.json"), "garbage").expect("write");
    assert!(read_inputs_from(&dir).is_err());
    std::fs::write(dir.join("drift.json"), "{}").expect("write");
    std::fs::write(dir.join("intelligence.json"), "garbage").expect("write");
    let before = listing(&dir);
    assert!(read_inputs_from(&dir).is_err());
    assert_eq!(listing(&dir), before);
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
#[ignore = "reads the real data root read-only and prints the diagnosis: set COMPY_PARAMEDIC_LIVE_DIR or run on the owner's PC"]
fn print_live_diagnosis() {
    let dir = std::env::var("COMPY_PARAMEDIC_LIVE_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| crate::compy_data_dir());
    let inp = read_inputs_from(&dir).expect("the live stores read");
    let d = diagnose(&inp, Complaint::Unknown, None);
    println!("{}", serde_json::to_string_pretty(&d).expect("serialises"));
}

// ---- every frozen constant pinned from both sides ---------------------------------------------
#[test]
fn the_frozen_constants_are_what_the_design_froze() {
    assert_eq!((MIN_JUDGE_SECS, MIN_JUDGE_SAMPLES, BASELINE_MAX, BASELINE_MIN), (300, 250, 10, 3));
    assert_eq!((MIN_JUDGE_COVERAGE, BASELINE_COVERAGE), (0.50, 0.80));
    assert_eq!((RULE_R_FRACTION, RULE_R_BELOW_MIN), (0.80, 0.03));
    assert_eq!((RULE_P99_MEDIAN_X, RULE_P99_MAX_X, RULE_P99_R_FRACTION, RULE_AVG_FRACTION), (2.0, 1.3, 0.90, 0.70));
    assert_eq!((RAM_FULL_FRACTION, RAM_BASELINE_MAX_FRACTION), (0.90, 0.80));
    assert_eq!((OTHER_CPU_P90_PCT, OTHER_CPU_BASELINE_MEDIAN_PCT, BUSY_START_MIN), (15.0, 5.0, 5));
    assert_eq!((CAP_SAME_FRACTION, RECENT_GAME_DAYS), (0.05, 14));
}

#[test]
fn rule_r_lines_hold_on_both_sides() {
    let at = |low1: f64| facts("2026-10-09T10:00:00Z", 600, 600, 100.0, low1);
    // Fraction binding (usual 0.50, worst 0.50): 0.40 fires, 0.41 does not; 0.80 is neither 0.75 nor 0.85.
    let b = base(0.5, 0.5);
    assert!(evaluate(&at(40.0), &b).expect("read").rule_r);
    assert!(!evaluate(&at(40.5), &b).expect("read").rule_r);
    // A looser fraction would fire at 0.42: it must not.
    assert!(!evaluate(&at(42.0), &b).expect("read").rule_r);
    // Margin binding (usual 0.90, worst 0.45): 0.42 fires, 0.43 does not; 0.03 is neither 0.02 nor 0.04.
    let b = base(0.9, 0.45);
    assert!(evaluate(&at(41.9), &b).expect("read").rule_r);
    assert!(!evaluate(&at(42.5), &b).expect("read").rule_r);
}

#[test]
fn spike_factors_hold_on_both_sides() {
    // 2.0 x the usual binds (worst earlier p99 equals the usual, so 1.3 x it is lower).
    let tight = BaseStats { med_r: 0.5, min_r: 0.5, med_p99: Some(10.0), max_p99: Some(10.0), med_avg: 100.0, ids: vec![0, 1, 2] };
    let mut s = facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 44.0);
    s.p99_ms = Some(19.9);
    assert!(!evaluate(&s, &tight).expect("read").rule_p99);
    s.p99_ms = Some(20.0);
    assert!(evaluate(&s, &tight).expect("read").rule_p99);
    // 1.3 x the worst earlier p99 binds (worst 16 ms: 20.8 ms).
    let loose = base(0.5, 0.5);
    s.p99_ms = Some(20.7);
    assert!(!evaluate(&s, &loose).expect("read").rule_p99);
    s.p99_ms = Some(20.8);
    assert!(evaluate(&s, &loose).expect("read").rule_p99);
    // The smoothness companion (0.90 x the usual 0.50 = 0.45): 0.45 fires with spikes, 0.46 does not.
    s.low1_fps = 45.0;
    assert!(evaluate(&s, &loose).expect("read").fired);
    s.low1_fps = 46.0;
    assert!(!evaluate(&s, &loose).expect("read").fired);
}

#[test]
fn the_baseline_coverage_count_and_window_edges_are_exact() {
    // A session measured 79.9% of the way is judged but does not become "normal"; 80.0% does.
    let with = |samples: u32| -> Vec<SessionFacts> {
        let mut v: Vec<SessionFacts> =
            (1..=3).map(|d| facts(&at_day(d, 10), 1000, samples, 100.0, 50.0)).collect();
        v.push(facts(&at_day(4, 10), 1000, 1000, 100.0, 50.0));
        v
    };
    let sess = with(799);
    let refs: Vec<&SessionFacts> = sess.iter().collect();
    assert_eq!(judge_game(&refs)[3].verdict, Verdict::NeedsMore(0));
    let sess = with(800);
    let refs: Vec<&SessionFacts> = sess.iter().collect();
    assert_eq!(judge_game(&refs)[3].verdict, Verdict::Normal);
    // The baseline is the last ten normal sessions, and three are enough.
    let sess = steady(12);
    let refs: Vec<&SessionFacts> = sess.iter().collect();
    assert_eq!(judge_game(&refs)[11].base.as_ref().expect("base").ids, (1..=10).collect::<Vec<usize>>());
    let refs3: Vec<&SessionFacts> = sess[..4].iter().collect();
    assert_eq!(judge_game(&refs3)[3].base.as_ref().expect("three are enough").ids.len(), 3);
    let refs2: Vec<&SessionFacts> = sess[..3].iter().collect();
    assert!(judge_game(&refs2)[2].base.is_none(), "two are not");
}

#[test]
fn the_cause_lines_hold_on_both_sides() {
    let run = |tune: &dyn Fn(&mut Vec<SessionFacts>)| -> Vec<&'static str> {
        let mut sess = steady(4);
        sess.push(facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 30.0));
        tune(&mut sess);
        ids(&diagnose(&inputs(sess), Complaint::Slow, Some("g")))
    };
    let ram = |base: u64, rough: u64| {
        move |s: &mut Vec<SessionFacts>| {
            for (i, x) in s.iter_mut().enumerate() {
                x.ram_total_bytes = Some(1000);
                x.peak_ram_bytes = Some(if i < 4 { base } else { rough });
            }
        }
    };
    assert_eq!(run(&ram(790, 900)), ["memory-pressure"], "usual peak 79%, rough 90%: counted");
    assert!(run(&ram(790, 899)).is_empty(), "89.9% is not nearly full");
    assert!(run(&ram(800, 990)).is_empty(), "a usual peak of 80% means it was already that full");
    let cpu = |base: f64, rough: f64| {
        move |s: &mut Vec<SessionFacts>| {
            for (i, x) in s.iter_mut().enumerate() {
                x.other_cpu_p90_pct = Some(if i < 4 { base } else { rough });
            }
        }
    };
    assert_eq!(run(&cpu(4.9, 15.0)), ["background-load"], "usual under 5%, rough at 15%: counted");
    assert!(run(&cpu(4.9, 14.9)).is_empty());
    assert!(run(&cpu(5.0, 40.0)).is_empty(), "a usual median of 5% is already busy: no line to measure from");
    let starts = |n: u32| {
        move |s: &mut Vec<SessionFacts>| {
            s[4].busy_starts = n;
        }
    };
    assert_eq!(run(&starts(5)), ["background-load"]);
    assert!(run(&starts(4)).is_empty());
    // The average alone: 0.70 of the usual says so, 0.71 does not (it never decides anything by itself).
    let lower = |avg: f64| {
        let mut sess = steady(4);
        sess.push(facts("2026-10-09T10:00:00Z", 600, 600, avg, avg * 0.3));
        diagnose(&inputs(sess), Complaint::Slow, Some("g")).problem.expect("rough").avg_lower
    };
    assert!(lower(69.0));
    assert!(!lower(71.0));
}

// ---- adapter and wire shape ------------------------------------------------------------------
fn summary() -> crate::sessions::SessionSummary {
    crate::sessions::SessionSummary {
        started_at: "2026-11-20T01:01:24+00:00".into(),
        duration_secs: 600,
        process_name: "Game-Win64-Shipping.exe".into(),
        samples: 600,
        avg_fps: 100.0,
        avg_frametime_ms: 10.0,
        low1_fps_est: 50.0,
        peak_gpu_temp_c: None,
        peak_gpu_usage_pct: None,
        peak_ram_used_bytes: Some(30_000_000_000),
        ram_total_bytes: Some(33_000_000_000),
        compy_changes_active: Some(13),
        compy_changes_per_change: true,
        compy_changes_cant_confirm: Some(0),
        compy_changes_legacy_active: None,
        compy_changes_since_set_aside: None,
        hw_fingerprint: Some(crate::hardware::HwFingerprint {
            hash: "h".into(),
            gpu: "Some GPU".into(),
            gpu_driver: "1.2.3".into(),
            ram_gb: 32,
            display: "1920x1080@250".into(),
        }),
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
        background_secs_excluded: Some(12),
        frame_pacing: None,
        gpu_load: None,
        frame_cap: None,
    }
}

fn event(kind: &str, label: &str) -> crate::stutter::StutterEvent {
    crate::stutter::StutterEvent { at_secs: 1, kind: kind.into(), label: label.into() }
}

#[test]
fn facts_count_busy_programs_by_name_and_read_the_session_stamps() {
    let mut s = summary();
    s.stutter_events = vec![
        event("process-start", "cargo.exe starting"),
        event("process-start", "Rustc.EXE starting"),
        event("process-start", "git.exe starting"),
        event("process-start", "cargo.exe starting"),
        event("ram", "RAM filling up (90%+)"),
        event("gpu-clock", "a GPU clock drop under load"),
    ];
    s.game_state = Some(crate::game_state::GameStateFingerprint {
        gpu_driver: Some("9.9.9".into()),
        windows_build: Some("26200.1".into()),
        display_refresh_hz: Some(144),
        power_plan_guid: Some("abc".into()),
        other_cpu: Some(crate::game_state::OtherLoad { readings: 100, unread: 0, mean_pct_x10: 40, p90_pct_x10: 223 }),
        ..Default::default()
    });
    let f = facts_from(&s);
    assert_eq!(f.busy_starts, 3, "git is not a busy program");
    assert_eq!(f.busy_names, ["cargo", "rustc"]);
    assert_eq!(f.ram_events, 1);
    assert_eq!(f.gpu_driver.as_deref(), Some("9.9.9"), "the session's own stamp wins over the rig fingerprint");
    assert_eq!(f.windows_build.as_deref(), Some("26200.1"));
    assert_eq!(f.refresh_hz, Some(144));
    assert_eq!(f.other_cpu_p90_pct, Some(22.3));
    assert_eq!(f.background_secs, 12);
    assert_eq!(f.compy_changes, Some(13));
    assert!(f.rig.is_some());
    // Without a game_state the rig fingerprint still names the driver; a blank one is no driver at all.
    s.game_state = None;
    assert_eq!(facts_from(&s).gpu_driver.as_deref(), Some("1.2.3"));
    if let Some(fp) = s.hw_fingerprint.as_mut() {
        fp.gpu_driver = "  ".into();
    }
    assert_eq!(facts_from(&s).gpu_driver, None);
}

#[test]
fn the_wire_shape_is_what_the_card_reads() {
    let d = diagnose(&fixture(), Complaint::Slow, Some(ROUGH_GAME));
    let v = serde_json::to_value(&d).expect("serialises");
    assert_eq!(v["complaint"], "slow");
    assert_eq!(v["state"]["kind"], "found");
    assert_eq!(v["findings"][0]["id"], "gpu-driver-change");
    assert_eq!(v["findings"][0]["confidence"], "possible");
    assert_eq!(v["findings"][0]["in_play"], true);
    assert_eq!(v["why_first"], "not-separable");
    assert_eq!(v["findings"][0]["evidence"][0]["kind"], "known");
    assert_eq!(v["findings"][0]["evidence"][0]["args"]["from"], "32.0.32015.7029");
    assert_eq!(v["findings"][0]["since_when"]["kind"], "observed-between");
    assert_eq!(v["findings"][0]["fix"]["kind"], "steps");
    assert_eq!(v["findings"][0]["fix"]["code"], "gpu-driver-change");
    assert_eq!(v["problem"]["rule"], "stutter-collapse");
    assert_eq!(v["method"], "paramedic-rules-v1");
    let nothing = serde_json::to_value(diagnose(&inputs(steady(5)), Complaint::Unknown, Some("g"))).expect("serialises");
    assert_eq!(nothing["state"]["kind"], "nothing-wrong");
    assert_eq!(nothing["state"]["sessions_checked"], 2);
    let tell = serde_json::to_value(diagnose(&inputs(steady(1)), Complaint::Unknown, Some("g"))).expect("serialises");
    assert_eq!(tell["state"]["kind"], "needs-more-play");
    let c: Complaint = serde_json::from_str("\"was-fine-before\"").expect("the card sends kebab-case");
    assert_eq!(c, Complaint::WasFineBefore);
}

#[test]
fn the_engine_writes_nothing() {
    // F1 is read-only: no file writes, no apply path, no process spawn in this module's production code.
    let src = include_str!("../paramedic.rs");
    let production = src.split("#[cfg(test)]").next().unwrap_or(src);
    for banned in ["std::fs", "File::create", "write(", "atomic_write", "Command::new", "apply_recommendation", "rollback_change", "set_startup_entry_enabled"] {
        assert!(!production.contains(banned), "paramedic.rs must stay read-only, found {banned}");
    }
}
