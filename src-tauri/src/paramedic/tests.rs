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
        started_names: Vec::new(),
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
            ..DiagnoseInputs::default()
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
    assert!(!partial.against && partial.args["date"] == "2026-11-19T03:43:25Z", "shown as a neutral line: it sets no contradiction");
    // The card says "last ran normally on X" in the problem block and "last normal session (X)" here: one date.
    let split = f.evidence.iter().find(|e| e.code == "sessions-split").expect("the last normal session ran on the old driver");
    let last_normal = d.problem.as_ref().expect("problem").last_normal_at.clone();
    assert_eq!(split.args["baselineAt"], last_normal);
    assert_ne!(last_normal, d.baseline.as_ref().expect("baseline").started_at, "the thin 04:43 session is newer than the baseline");
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
    // F16: neither ROB RUN rough session recorded a start; the names belong to a partly measured session of
    // this game and to the other game's rough sessions, and each line says which.
    assert_eq!(bg, ["starts-seen-partial", "starts-seen-other", "load-not-recorded"]);
    assert!(d.findings[1].evidence.iter().all(|e| !e.against), "nothing recorded argues against background load");
    assert_eq!(d.findings[1].evidence[2].kind, EvidenceKind::Unknown);
    assert!(d.findings[3].evidence.iter().any(|e| e.against && e.code == "ram-lower"));
}

#[test]
fn the_unchanged_conditions_are_listed_as_ruled_out() {
    let d = diagnose(&fixture(), Complaint::Slow, Some(ROUGH_GAME));
    let mut got: Vec<&str> = d.not_it.iter().map(|n| n.id).collect();
    got.sort_unstable();
    assert_eq!(got, ["compy-change", "display-refresh-lower", "hardware-change", "power-plan-change", "windows-build-change"]);
    for code in ["startup-programs", "overlays", "other-load"] {
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
        ..DiagnoseInputs::default()
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
        "game-files-change",
        "windows-update",
        "program-installed",
        "other-driver-change",
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
    assert!(d.limits.iter().any(|l| l.kind == "game-update" && l.code == "not-read"), "and the honest gaps are listed");
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
        ..DiagnoseInputs::default()
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
    // An unknown cap against a known one is not comparable either, and is no established change: only the
    // "can't tell" answer, never a finding that says the cap "went from not read".
    sess[4].cap = CapState::Unknown;
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::FrameCapChanged });
    assert!(d.findings.is_empty(), "an unread cap is not a finding");
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
    // The tolerance is noise_floor::cap_pair's (3% of the smaller cap): 141 and 145.2 are one cap, 141 and
    // 145.3 are two; two unread states are the same state, an unread one and a read one are not.
    let cap = |f: f64| CapState::Capped { at_fps: f };
    assert!(cap(141.0).same_as(cap(145.2)) && cap(145.2).same_as(cap(141.0)));
    assert!(!cap(141.0).same_as(cap(145.3)) && !cap(145.3).same_as(cap(141.0)));
    assert!(CapState::Unknown.same_as(CapState::Unknown) && CapState::Uncapped.same_as(CapState::Uncapped));
    assert!(!CapState::Unknown.same_as(CapState::Uncapped) && !CapState::Uncapped.same_as(cap(144.0)));
    // A change is established only when both sides were read.
    assert!(cap(141.0).known_change(CapState::Uncapped) && cap(141.0).known_change(cap(145.3)));
    assert!(!cap(141.0).known_change(cap(145.2)));
    assert!(!CapState::Unknown.known_change(CapState::Uncapped) && !cap(141.0).known_change(CapState::Unknown));
    assert!(!CapState::Unknown.known_change(CapState::Unknown));
}

#[test]
fn absent_process_starts_are_unknown_not_against_when_load_was_not_recorded() {
    let mut sess = steady(4);
    // Another game got rough after the last normal session and logged 21 build-tool starts; this game's
    // rough session logged none.
    sess.extend((1..=4).map(|d| named(facts(&at_day(d, 12), 600, 600, 100.0, 50.0), "h")));
    let mut other = named(facts(&at_day(9, 12), 600, 600, 100.0, 30.0), "h");
    other.busy_starts = 21;
    sess.push(other);
    sess.push(facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 30.0));
    let d = diagnose(&inputs(sess.clone()), Complaint::Slow, Some("g"));
    let bg = d.findings.iter().find(|f| f.id == "background-load").expect("starts seen in the episode are timing");
    assert!(bg.evidence.iter().all(|e| !e.against), "an absence of starts is not evidence the PC was quiet");
    assert!(bg.evidence.iter().any(|e| e.code == "load-not-recorded" && e.kind == EvidenceKind::Unknown));
    assert_eq!(bg.confidence, Certainty::Possible);
    assert!(bg.in_play);
    // F16: the count names what it counts. This game's own rough session had no starts, so there is no
    // "starts-seen" line; the other game's rough session has its own line.
    assert!(bg.evidence.iter().all(|e| e.code != "starts-seen"), "no start was recorded in this game's rough sessions");
    let seen = bg.evidence.iter().find(|e| e.code == "starts-seen-other").expect("timing");
    assert_eq!(seen.args["count"], "1", "only the rough sessions that had starts are counted");
    assert_eq!(seen.args["otherGame"], "h");
    // A recorded low load number is the only thing that weakens it.
    sess[9].other_cpu_p90_pct = Some(3.0);
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
    let line = d.not_it.iter().find(|n| n.id == "memory-pressure").expect("said");
    assert_eq!(line.args["percent"], "90", "the line names the threshold the code applies");
    assert_eq!((RAM_FULL_FRACTION * 100.0).round() as u32, 90);
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
    assert!(f.evidence.iter().all(|e| e.code != "sessions-split"), "the last normal session ran on the NEW driver: no 'old driver' claim");
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
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn a_damaged_corroborating_store_is_an_unknown_not_a_failed_card() {
    let dir = scratch_dir("degrade");
    std::fs::write(dir.join("sessions.json"), "[]").expect("write");
    // A valid, empty drift store is "nothing noticed": not flagged as unread.
    std::fs::write(dir.join("drift.json"), r#"{"last_good":{},"noticed_at":{}}"#).expect("write");
    let inp = read_inputs_from(&dir).expect("reads");
    assert!(!inp.drift_unread && !inp.sightings_unread, "valid and absent stores are not unread");
    // Garbage drift: flagged, and the identity store (absent) is not.
    std::fs::write(dir.join("drift.json"), "garbage").expect("write");
    let before = listing(&dir);
    let inp = read_inputs_from(&dir).expect("a damaged drift store does not fail the card");
    assert!(inp.drift_unread && !inp.sightings_unread);
    assert_eq!(listing(&dir), before, "nothing renamed or written");
    // Garbage identity store with a valid drift store: the other way round.
    std::fs::write(dir.join("drift.json"), r#"{"last_good":{},"noticed_at":{}}"#).expect("write");
    std::fs::write(dir.join("intelligence.json"), "garbage").expect("write");
    let before = listing(&dir);
    let inp = read_inputs_from(&dir).expect("a damaged identity store does not fail the card");
    assert!(!inp.drift_unread && inp.sightings_unread);
    assert_eq!(listing(&dir), before);
    let _ = std::fs::remove_dir_all(&dir);
    // The answer says what it could not read, and never claims "no setting changes" for an unread store.
    let mut sess = steady(4);
    sess.push(facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 30.0));
    let mut inp = inputs(sess);
    let d = diagnose(&inp, Complaint::Slow, Some("g"));
    assert!(d.not_it.iter().any(|n| n.id == "setting-drift") && !d.unknowns.contains(&"drift-unreadable"));
    inp.drift_unread = true;
    inp.sightings_unread = true;
    let d = diagnose(&inp, Complaint::Slow, Some("g"));
    assert!(d.unknowns.contains(&"drift-unreadable") && d.unknowns.contains(&"identity-unreadable"));
    assert!(d.not_it.iter().all(|n| n.id != "setting-drift"), "an unread store is not 'no changes noticed'");
}

#[test]
#[ignore = "reads the real data root read-only and prints the diagnosis: set COMPY_PARAMEDIC_LIVE_DIR or run on the owner's PC"]
fn print_live_diagnosis() {
    let dir = std::env::var("COMPY_PARAMEDIC_LIVE_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| crate::compy_data_dir());
    let inp = read_inputs_from(&dir).expect("the live stores read");
    // The command's two halves, timed apart: the same read-only diagnosis without Windows' records, and with
    // the real readers (Steam lookup, driver log, update log, installed programs) inside the 1.5 s budget.
    let mut plain_ms = Vec::new();
    let mut with_ms = Vec::new();
    let mut d = diagnose(&inp, Complaint::Unknown, None);
    for _ in 0..5 {
        let t = std::time::Instant::now();
        let _ = diagnose(&inp, Complaint::Unknown, None);
        plain_ms.push(t.elapsed().as_millis());
        let t = std::time::Instant::now();
        d = changes::diagnose_with_changes(inp.clone(), Complaint::Unknown, None, changes::CHANGES_BUDGET, |a, b, g| {
            changes::read_real_changes(a, b, &g)
        });
        with_ms.push(t.elapsed().as_millis());
    }
    eprintln!("TIMING plain_ms={plain_ms:?} with_readers_ms={with_ms:?}");
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
    assert_eq!(RECENT_GAME_DAYS, 14);
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
    assert!(lower(RULE_AVG_FRACTION * 100.0), "exactly 0.70 of the usual says so");
    assert!(!lower(RULE_AVG_FRACTION * 100.0 + 0.01), "a hair above does not");
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
        ended: None,
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
    for (name, src) in [("paramedic.rs", include_str!("../paramedic.rs")), ("paramedic/changes.rs", include_str!("changes.rs"))] {
        let production = src.split("#[cfg(test)]").next().unwrap_or(src);
        for banned in ["std::fs", "File::create", "write(", "atomic_write", "Command::new", "apply_recommendation", "rollback_change", "set_startup_entry_enabled"] {
            assert!(!production.contains(banned), "{name} must stay read-only, found {banned}");
        }
    }
}

// ==== review round 2: no claim beyond the evidence ===============================================
#[test]
fn starts_in_a_session_that_ran_normally_are_not_timing() {
    let mut sess = steady(4);
    // Thinly measured (coverage 0.67): judged Normal, in the window, with a heavy build running.
    let mut thin = facts(&at_day(8, 10), 600, 400, 100.0, 50.0);
    thin.busy_starts = 21;
    sess.push(thin);
    sess.push(facts(&at_day(9, 10), 600, 600, 100.0, 30.0));
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert!(d.findings.iter().all(|f| f.id != "background-load"), "a build during a session that ran fine is not timing");
}

#[test]
fn a_session_with_no_memory_reading_is_never_a_lower_one() {
    let mut sess = steady(4);
    for s in sess.iter_mut() {
        s.peak_ram_bytes = Some(50);
        s.ram_total_bytes = Some(100);
    }
    let mut a = facts(&at_day(9, 10), 600, 600, 100.0, 30.0);
    a.peak_ram_bytes = Some(95);
    a.ram_total_bytes = Some(100);
    sess.push(a);
    sess.push(facts(&at_day(10, 10), 600, 600, 100.0, 30.0)); // rough, no memory reading
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert_eq!(d.problem.as_ref().expect("problem").sessions_affected.len(), 2);
    let m = d.findings.iter().find(|f| f.id == "memory-pressure").expect("one rough session was nearly full");
    assert!(m.evidence.iter().all(|e| !e.against && e.code != "ram-lower"), "a missing reading is neither high nor low");
    assert!(d.unknowns.contains(&"memory") || m.evidence.iter().any(|e| e.code == "ram-peak"));
}

#[test]
fn a_thin_session_with_an_unread_cap_still_corroborates_against_baselines_it_cannot_flatter() {
    let make = |cap: CapState| {
        let mut sess = steady(4);
        for s in sess.iter_mut() {
            s.cap = cap;
        }
        // 90 readings, so never judged alone, and a short trace, so its cap is unread.
        sess.push(facts(&at_day(7, 10), 467, 90, 100.0, 10.0));
        let mut rough = facts(&at_day(9, 10), 600, 600, 100.0, 30.0);
        rough.cap = cap;
        sess.push(rough);
        diagnose(&inputs(sess), Complaint::Slow, Some("g"))
    };
    let d = make(CapState::Uncapped);
    assert_eq!(d.problem.as_ref().expect("rough").partial_sessions.len(), 1, "compared with the uncapped baseline");
    // Against a capped baseline an unread session could look rough only because of the cap: not compared.
    let d = make(CapState::Capped { at_fps: 144.0 });
    assert!(d.problem.as_ref().expect("rough").partial_sessions.is_empty());
}

#[test]
fn a_game_played_exactly_the_window_before_the_newest_session_is_still_judged() {
    let build = |old_rough_at: &str| {
        let mut sess: Vec<SessionFacts> = (1..=4).map(|d| named(facts(&at_day(d, 10), 600, 600, 100.0, 50.0), "old")).collect();
        sess.push(named(facts(old_rough_at, 600, 600, 100.0, 30.0), "old"));
        sess.push(named(facts("2026-10-30T10:00:00Z", 600, 600, 100.0, 50.0), "j"));
        diagnose(&inputs(sess), Complaint::Unknown, None)
    };
    // Fourteen days before 30 Oct 10:00 is 16 Oct 10:00: on the line is in, one second before is out.
    assert_eq!(build("2026-10-16T10:00:00Z").game.as_deref(), Some("old"));
    assert_eq!(build("2026-10-16T09:59:59Z").game.as_deref(), Some("j"));
}

#[test]
fn when_two_games_are_rough_the_one_that_got_rough_last_is_shown() {
    let build = |g_day: u32, h_day: u32| {
        let mut sess = steady(4);
        sess.extend((1..=4).map(|d| named(facts(&at_day(d, 12), 600, 600, 100.0, 50.0), "h")));
        sess.push(facts(&at_day(g_day, 10), 600, 600, 100.0, 30.0));
        sess.push(named(facts(&at_day(h_day, 12), 600, 600, 100.0, 30.0), "h"));
        diagnose(&inputs(sess), Complaint::Unknown, None)
    };
    assert_eq!(build(9, 10).game.as_deref(), Some("h"));
    assert_eq!(build(10, 9).game.as_deref(), Some("g"));
}

#[test]
fn a_newest_game_that_is_only_partly_rough_does_not_hide_the_game_with_a_fired_session() {
    let mut sess = steady(4);
    sess.push(facts(&at_day(9, 10), 600, 600, 100.0, 30.0)); // g: rough, judged
    sess.extend((1..=4).map(|d| named(facts(&at_day(d, 12), 600, 600, 100.0, 50.0), "h")));
    sess.push(named(facts(&at_day(12, 12), 100, 80, 100.0, 10.0), "h")); // newest session: h, 80 readings, looks rough
    let inp = inputs(sess);
    let d = diagnose(&inp, Complaint::Unknown, None);
    assert_eq!(d.game.as_deref(), Some("g"), "only a fired session counts as rough for the pick");
    assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::NothingChanged });
    // Asked about h directly, the partial measure is said, never "nothing wrong".
    let h = diagnose(&inp, Complaint::Unknown, Some("h"));
    assert!(matches!(h.state, DiagnosisState::CantTell { why: CantTellWhy::PartialMeasure { looked_rough: true, .. } }), "{:?}", h.state);
}

// ==== F4b: what Windows recorded, from hand-built reports (no wevtutil, no registry, no Steam) ====
mod windows_records {
    use super::super::changes::{change_window, diagnose_with_changes, run_within, ChangeRead, GameSteam};
    use super::*;
    use crate::change_sources::{
        ChangeEvent, ChangeKind, ChangeReport, ChangeTime, ChangeWhat, Gap, Note, PartialSource, Source, UnreadableReason,
        UnreadableSource,
    };
    use std::time::Duration;

    fn utc(s: &str) -> DateTime<Utc> {
        ts(s).expect("a time")
    }

    fn event(kind: ChangeKind, at: &str, what: ChangeWhat, source: Source) -> ChangeEvent {
        ChangeEvent { kind, when: ChangeTime::exact(utc(at)), what, source }
    }

    fn gpu(at: &str, from: &str, to: &str, changed: Option<bool>) -> ChangeEvent {
        let what = ChangeWhat {
            name: Some("Display".into()),
            from_version: Some(from.into()),
            to_version: Some(to.into()),
            version_changed: changed,
            detail: Some("display driver, package oem1.inf".into()),
            ..ChangeWhat::default()
        };
        event(ChangeKind::GpuDriver, at, what, Source::DriverLog)
    }

    fn other_driver(at: &str, class: &str) -> ChangeEvent {
        let what = ChangeWhat {
            version_changed: Some(true),
            to_version: Some("9.9".into()),
            detail: Some(format!("{class} driver, package oem7.inf")),
            ..ChangeWhat::default()
        };
        event(ChangeKind::OtherDriver, at, what, Source::DriverLog)
    }

    fn update(at: &str, kb: &str, class: &str) -> ChangeEvent {
        let what = ChangeWhat { kb: Some(kb.into()), name: Some(format!("{kb} update")), detail: Some(class.into()), ..ChangeWhat::default() };
        event(ChangeKind::WindowsUpdate, at, what, Source::WindowsUpdateLog)
    }

    fn game_files(at: &str) -> ChangeEvent {
        let what = ChangeWhat { name: Some("G".into()), id: Some("42".into()), ..ChangeWhat::default() };
        event(ChangeKind::GameUpdate, at, what, Source::SteamManifest)
    }

    fn program(day: &str, next: &str, name: &str) -> ChangeEvent {
        ChangeEvent {
            kind: ChangeKind::ProgramInstalled,
            when: ChangeTime::day(utc(day), utc(next)),
            what: ChangeWhat { name: Some(name.into()), ..ChangeWhat::default() },
            source: Source::UninstallKeys,
        }
    }

    /// Every source asked and read completely.
    fn report(events: Vec<ChangeEvent>) -> ChangeReport {
        ChangeReport {
            window_start: utc("2026-10-04T10:00:00Z"),
            window_end: utc("2026-10-09T10:10:00Z"),
            asked: vec![Source::DriverLog, Source::WindowsUpdateLog, Source::UninstallKeys, Source::SteamManifest],
            events_found: events,
            unreadable: Vec::new(),
            partial: Vec::new(),
            coverage_gaps: Vec::new(),
            notes: vec![(Source::UninstallKeys, Note::ProgramsWithoutDate(2)), (Source::SteamManifest, Note::SteamUpdateTimeIsFileChange)],
            game_last_update: None,
            undated_excluded: 0,
        }
    }

    /// Four normal sessions on driver 1.0 (days 1 to 4), then a rough one on driver 2.0 on the ninth.
    fn scenario() -> Vec<SessionFacts> {
        let mut sess = steady_on_old("g", 10);
        sess.push(rough_on_new("g", 10));
        sess
    }

    fn with(sess: Vec<SessionFacts>, r: ChangeReport, steam: GameSteam) -> DiagnoseInputs {
        let mut inp = inputs(sess);
        inp.changes = ChangeRead::Report { report: Box::new(r), steam };
        inp
    }

    fn found(sess: Vec<SessionFacts>, r: ChangeReport) -> Diagnosis {
        diagnose(&with(sess, r, GameSteam::Found), Complaint::Slow, Some("g"))
    }

    fn finding<'a>(d: &'a Diagnosis, id: &str) -> &'a Finding {
        d.findings.iter().find(|f| f.id == id).unwrap_or_else(|| panic!("{id} not listed: {:?}", ids(d)))
    }

    fn codes(f: &Finding) -> Vec<&'static str> {
        f.evidence.iter().map(|e| e.code).collect()
    }

    fn limit_of<'a>(d: &'a Diagnosis, kind: &str) -> Vec<&'a str> {
        d.limits.iter().filter(|l| l.kind == kind).map(|l| l.code).collect()
    }

    #[test]
    fn the_exact_install_time_replaces_the_unread_line_and_is_not_a_second_support() {
        let d = found(scenario(), report(vec![gpu("2026-10-06T12:00:00Z", "1.0", "2.0", Some(true))]));
        let f = finding(&d, "gpu-driver-change");
        assert_eq!(f.since_when, When::Exact { at: "2026-10-06T12:00:00Z".into() });
        let c = codes(f);
        assert!(c.contains(&"driver-changed"), "the session stamps stay: {c:?}");
        assert!(c.contains(&"install-recorded") && !c.contains(&"install-time-not-read") && !c.contains(&"install-not-recorded"), "{c:?}");
        let line = f.evidence.iter().find(|e| e.code == "install-recorded").expect("shown");
        assert_eq!(line.kind, EvidenceKind::Known);
        assert!(!line.against);
        assert_eq!(line.args["when"], "2026-10-06T12:00:00Z");
        assert_eq!(f.confidence, Certainty::Possible, "Windows dating the install is the same fact as the stamps");
    }

    #[test]
    fn windows_dated_install_with_a_busy_other_game_stays_not_separable_on_the_owners_data() {
        // The owner's real incident: the driver was bracketed between 05:12 and 16:54 on 2026-11-19. Give it
        // an exact time in that bracket.
        let mut inp = fixture();
        let mut r = report(vec![gpu("2026-11-19T12:00:00Z", "32.0.32015.7029", "32.0.32029.2010", Some(true))]);
        r.window_start = utc("2026-11-11T14:14:22Z");
        r.window_end = utc("2026-11-20T04:00:00Z");
        inp.changes = ChangeRead::Report { report: Box::new(r), steam: GameSteam::Found };
        let d = diagnose(&inp, Complaint::Slow, Some(ROUGH_GAME));
        let f = finding(&d, "gpu-driver-change");
        assert_eq!(f.since_when, When::Exact { at: "2026-11-19T12:00:00Z".into() });
        assert_eq!(f.confidence, Certainty::Possible, "driver and background load are not separable on this data");
        assert!(f.in_play);
        assert_eq!(d.why_first, Some("not-separable"));
        assert!(codes(f).contains(&"cross-game-confounded"));
    }

    #[test]
    fn a_complete_read_with_no_install_beside_differing_stamps_shows_both_and_raises_nothing() {
        let d = found(scenario(), report(Vec::new()));
        let f = finding(&d, "gpu-driver-change");
        let c = codes(f);
        assert!(c.contains(&"driver-changed") && c.contains(&"install-not-recorded"), "{c:?}");
        assert!(!c.contains(&"install-recorded"));
        assert_eq!(f.confidence, Certainty::Possible);
        assert!(matches!(f.since_when, When::ObservedBetween { .. }), "no exact time was invented");
        // The same facts from a read that was only partly done say nothing about Windows' record.
        let mut r = report(Vec::new());
        r.partial.push(PartialSource { source: Source::DriverLog, gaps: vec![Gap::TimedOut], covered_from: None });
        let d = found(scenario(), r);
        let c = codes(finding(&d, "gpu-driver-change"));
        assert!(c.contains(&"install-time-not-read") && !c.contains(&"install-not-recorded"), "{c:?}");
        assert!(limit_of(&d, "driver").contains(&"partial-timed-out"));
    }

    #[test]
    fn equal_stamps_and_a_complete_read_with_no_install_are_unchanged() {
        let mut sess = steady_on_old("g", 10);
        let mut rough = rough_on_new("g", 10);
        rough.gpu_driver = Some("1.0".into());
        sess.push(rough);
        let d = found(sess.clone(), report(Vec::new()));
        let n = d.not_it.iter().find(|n| n.id == "gpu-driver-change").expect("ruled out");
        assert_eq!(n.args["windows"], "none");
        // Same-version rows and rows with an unknown previous version are never a change.
        let rows = vec![gpu("2026-10-06T12:00:00Z", "1.0", "1.0", Some(false)), gpu("2026-10-06T13:00:00Z", "", "1.0", None)];
        let d = found(sess.clone(), report(rows));
        // ...but they ARE install rows: "Windows recorded no install" is never said beside them.
        assert!(d.not_it.iter().any(|n| n.id == "gpu-driver-change" && !n.args.contains_key("windows")));
        assert!(d.findings.iter().all(|f| f.id != "gpu-driver-change"));
        // An unread log says nothing about Windows.
        let mut r = report(Vec::new());
        r.unreadable.push(UnreadableSource { source: Source::DriverLog, reason: UnreadableReason::AccessDenied });
        let d = found(sess, r);
        let n = d.not_it.iter().find(|n| n.id == "gpu-driver-change").expect("the stamps are equal");
        assert!(!n.args.contains_key("windows"));
        assert!(limit_of(&d, "driver").contains(&"access-denied"));
    }

    #[test]
    fn a_same_version_row_never_dates_a_change() {
        let d = found(scenario(), report(vec![gpu("2026-10-06T12:00:00Z", "2.0", "2.0", Some(false))]));
        let f = finding(&d, "gpu-driver-change");
        assert!(!codes(f).contains(&"install-recorded"));
        assert!(matches!(f.since_when, When::ObservedBetween { .. }));
    }

    #[test]
    fn an_install_after_the_first_rough_session_is_evidence_against() {
        // Windows says the version changed at 10:05 on the ninth, after the rough session began at 10:00.
        let d = found(scenario(), report(vec![gpu("2026-10-09T10:05:00Z", "1.0", "2.0", Some(true))]));
        let f = finding(&d, "gpu-driver-change");
        let line = f.evidence.iter().find(|e| e.code == "install-after-rough").expect("shown");
        assert!(line.against);
        assert!(!f.in_play, "something is against it");
        assert!(matches!(f.since_when, When::ObservedBetween { .. }), "a later install is not its time");
    }

    #[test]
    fn with_no_driver_stamps_a_dated_install_is_a_possible_on_its_own() {
        let sess: Vec<SessionFacts> = scenario()
            .into_iter()
            .map(|mut s| {
                s.gpu_driver = None;
                s
            })
            .collect();
        let d = found(sess, report(vec![gpu("2026-10-06T12:00:00Z", "1.0", "2.0", Some(true))]));
        let f = finding(&d, "gpu-driver-change");
        assert_eq!(f.confidence, Certainty::Possible);
        assert_eq!(f.since_when, When::Exact { at: "2026-10-06T12:00:00Z".into() });
        assert!(d.unknowns.contains(&"gpu-driver"), "the stamps are still unknown");
    }

    #[test]
    fn a_quality_update_is_a_candidate_and_definitions_and_store_apps_are_only_counted() {
        let ev = vec![
            update("2026-10-07T03:00:00Z", "KB5001234", "quality"),
            update("2026-10-08T01:00:00Z", "KB2267602", "definition"),
            update("2026-10-08T02:00:00Z", "KB0000001", "definition"),
            update("2026-10-08T03:00:00Z", "KB0000002", "store-app"),
            update("2026-10-02T03:00:00Z", "KB0000003", "quality"), // before the last normal session ended
        ];
        let d = found(scenario(), report(ev));
        let f = finding(&d, "windows-update");
        assert_eq!(f.confidence, Certainty::Possible);
        assert_eq!(f.evidence.len(), 1, "only the one quality update in the period");
        assert_eq!(f.evidence[0].kind, EvidenceKind::Known);
        assert_eq!(f.evidence[0].args["kb"], "KB5001234");
        assert_eq!(f.evidence[0].args["when"], "2026-10-07T03:00:00Z");
        assert_eq!(f.since_when, When::Exact { at: "2026-10-07T03:00:00Z".into() });
        match &f.fix {
            Fix::Steps { code, args } => assert!(*code == "windows-update" && args["quality"] == "true" && args["kb"] == "KB5001234"),
            other => panic!("steps only, never a one-click: {other:?}"),
        }
        let minor = d.seen.iter().find(|s| s.id == "updates-minor").expect("counted");
        assert_eq!((minor.args["n"].as_str(), minor.args["m"].as_str()), ("2", "1"));
        assert_eq!(d.findings.iter().filter(|f| f.id == "windows-update").count(), 1, "never one finding per definition update");
        assert!(d.not_it.iter().all(|n| n.id != "windows-update"));
    }

    #[test]
    fn only_definition_and_store_updates_are_never_a_finding_and_a_complete_none_is_unchanged() {
        let d = found(scenario(), report(vec![update("2026-10-08T01:00:00Z", "KB2267602", "definition")]));
        assert!(d.findings.iter().all(|f| f.id != "windows-update"));
        assert!(d.not_it.iter().any(|n| n.id == "windows-update"), "no quality or feature update in the period");
        let d = found(scenario(), report(Vec::new()));
        assert!(d.not_it.iter().any(|n| n.id == "windows-update"));
        // A quality update just OUTSIDE the period is not "none in the period".
        let d = found(scenario(), report(vec![update("2026-10-09T10:05:00Z", "KB5009999", "quality")]));
        assert!(d.not_it.iter().all(|n| n.id != "windows-update"));
        assert!(d.findings.iter().all(|f| f.id != "windows-update"), "it came after the first rough session started");
    }

    #[test]
    fn an_unreadable_windows_update_log_is_never_unchanged() {
        let mut r = report(Vec::new());
        r.unreadable.push(UnreadableSource { source: Source::WindowsUpdateLog, reason: UnreadableReason::ChannelNotFound });
        let d = found(scenario(), r);
        assert!(d.not_it.iter().all(|n| n.id != "windows-update"));
        assert_eq!(limit_of(&d, "windows-update"), ["log-missing"]);
    }

    #[test]
    fn game_files_changing_in_the_period_is_a_candidate_worded_as_files_not_a_patch() {
        let d = diagnose(&with(scenario(), report(vec![game_files("2026-10-05T18:00:00Z")]), GameSteam::Found), Complaint::Slow, Some("g"));
        let f = finding(&d, "game-files-change");
        assert_eq!(f.confidence, Certainty::Possible);
        assert_eq!(f.since_when, When::Exact { at: "2026-10-05T18:00:00Z".into() });
        assert_eq!(codes(f), ["files-changed"]);
        assert_eq!(f.evidence[0].kind, EvidenceKind::Known);
        assert!(matches!(&f.fix, Fix::Steps { code: "game-files-change", .. }));
        // Steam's last change older than the period: unchanged. Newer than the period: nothing is claimed.
        let mut r = report(Vec::new());
        r.game_last_update = Some(game_files("2026-09-01T00:00:00Z"));
        let d = found(scenario(), r);
        let n = d.not_it.iter().find(|n| n.id == "game-files-change").expect("unchanged");
        assert_eq!(n.args["since"], "2026-09-01T00:00:00Z");
        let mut r = report(Vec::new());
        r.game_last_update = Some(game_files("2026-10-09T12:00:00Z"));
        let d = found(scenario(), r);
        assert!(d.not_it.iter().all(|n| n.id != "game-files-change"), "a later change would hide one inside the period");
    }

    #[test]
    fn a_game_that_is_not_in_steam_stays_in_what_compy_couldnt_see() {
        let mut r = report(Vec::new());
        r.asked.retain(|s| *s != Source::SteamManifest);
        let d = diagnose(&with(scenario(), r, GameSteam::NotInSteam), Complaint::Slow, Some("g"));
        assert_eq!(limit_of(&d, "game-update"), ["not-steam"]);
        assert!(d.findings.iter().all(|f| f.id != "game-files-change") && d.not_it.iter().all(|n| n.id != "game-files-change"));
        assert!(!d.unknowns.contains(&"game-patch"), "the per-kind status carries it now");
        // A Steam that could not be read says that instead.
        let mut r = report(Vec::new());
        r.asked.retain(|s| *s != Source::SteamManifest);
        let d = diagnose(&with(scenario(), r, GameSteam::Unreadable(UnreadableReason::SteamUnreadable)), Complaint::Slow, Some("g"));
        assert_eq!(limit_of(&d, "game-update"), ["steam-unreadable"]);
    }

    #[test]
    fn installed_programs_are_one_collapsed_line_and_a_candidate_only_if_they_also_ran_in_a_rough_session() {
        let progs = vec![
            program("2026-10-07T00:00:00Z", "2026-10-08T00:00:00Z", "Discord"),
            program("2026-10-07T00:00:00Z", "2026-10-08T00:00:00Z", "Paint Tool"),
            program("2026-10-08T00:00:00Z", "2026-10-09T00:00:00Z", "Zip Thing"),
            program("2026-10-08T00:00:00Z", "2026-10-09T00:00:00Z", "Another One"),
        ];
        let d = found(scenario(), report(progs.clone()));
        let s = d.seen.iter().find(|s| s.id == "programs-installed").expect("one line");
        assert_eq!(s.args["count"], "4");
        assert_eq!(s.args["names"], "Discord, Paint Tool, Another One", "up to three names");
        assert_eq!(s.args["more"], "1");
        assert_eq!(s.args["day"], "2026-10-07T00:00:00Z");
        assert_eq!(d.seen.iter().filter(|s| s.id == "programs-installed").count(), 1);
        assert!(d.findings.iter().all(|f| f.id != "program-installed"), "installed alone is not a cause");
        assert!(d.limits.iter().any(|l| l.kind == "programs" && l.code == "no-install-date" && l.args["n"] == "2"), "the limit is always carried");
        // The same program also started during the rough session.
        let mut sess = scenario();
        sess.last_mut().expect("rough").started_names = vec!["discord".into(), "steam".into()];
        let d = found(sess, report(progs));
        let f = finding(&d, "program-installed");
        assert_eq!(f.confidence, Certainty::Possible);
        assert_eq!(f.evidence.len(), 1);
        assert_eq!(f.evidence[0].args["name"], "Discord");
        // "steam" must not match a program that merely contains it, and short names never match.
        let mut sess = scenario();
        sess.last_mut().expect("rough").started_names = vec!["tool".into(), "zip".into()];
        let d = found(sess, report(vec![program("2026-10-07T00:00:00Z", "2026-10-08T00:00:00Z", "Paint Tool")]));
        assert!(d.findings.iter().all(|f| f.id != "program-installed"));
    }

    #[test]
    fn other_drivers_are_a_line_and_a_candidate_only_if_nothing_else_explains_the_timing() {
        let ev = vec![other_driver("2026-10-06T12:00:00Z", "audio")];
        let d = found(scenario_without_driver_change(), report(ev.clone()));
        let f = finding(&d, "other-driver-change");
        assert_eq!(f.confidence, Certainty::Possible);
        assert!(d.seen.iter().any(|s| s.id == "other-drivers" && s.args["classes"] == "audio"));
        // With another change that lines up, the audio driver is only the collapsed line.
        let d = found(scenario(), report(ev));
        assert!(d.findings.iter().all(|f| f.id != "other-driver-change"));
        assert!(d.seen.iter().any(|s| s.id == "other-drivers"));
    }

    /// The driver stamp does not change: nothing else lines up with the timing.
    fn scenario_without_driver_change() -> Vec<SessionFacts> {
        scenario()
            .into_iter()
            .map(|mut s| {
                s.gpu_driver = Some("1.0".into());
                s
            })
            .collect()
    }

    #[test]
    fn readers_that_could_not_read_leave_specific_lines_and_no_claim() {
        let mut r = report(vec![update("2026-10-07T03:00:00Z", "KB5001234", "quality")]);
        r.events_found.clear();
        r.unreadable.push(UnreadableSource { source: Source::DriverLog, reason: UnreadableReason::AccessDenied });
        r.unreadable.push(UnreadableSource { source: Source::WindowsUpdateLog, reason: UnreadableReason::TimedOutBeforeAnyRecord });
        r.partial.push(PartialSource { source: Source::UninstallKeys, gaps: vec![Gap::RegistryKeysUnreadable(2)], covered_from: None });
        r.asked.retain(|s| *s != Source::SteamManifest);
        let d = diagnose(&with(scenario(), r, GameSteam::NotInSteam), Complaint::Slow, Some("g"));
        assert_eq!(limit_of(&d, "driver"), ["access-denied"]);
        assert_eq!(limit_of(&d, "windows-update"), ["timed-out"]);
        assert_eq!(limit_of(&d, "game-update"), ["not-steam"]);
        assert!(limit_of(&d, "programs").contains(&"partial-registry") && limit_of(&d, "programs").contains(&"no-install-date"));
        assert!(d.not_it.iter().all(|n| n.id != "windows-update"));
        assert!(d.seen.iter().all(|s| s.id != "programs-none"), "a partial read never says none");
        assert!(codes(finding(&d, "gpu-driver-change")).contains(&"install-time-not-read"));
        assert_eq!(d.state, DiagnosisState::Found, "the card still renders");
    }

    #[test]
    fn the_diagnosis_without_a_report_lists_every_kind_as_not_read_and_nothing_else_changes() {
        let plain = diagnose(&inputs(scenario()), Complaint::Slow, Some("g"));
        let kinds: Vec<&str> = plain.limits.iter().map(|l| l.kind).collect();
        assert_eq!(kinds, ["driver", "windows-update", "game-update", "programs"]);
        assert!(plain.limits.iter().all(|l| l.code == "not-read"));
        assert!(plain.seen.is_empty());
        assert_eq!(ids(&plain), ["gpu-driver-change"]);
    }

    #[test]
    fn the_never_before_sentence_needs_every_earlier_session_judged_normal() {
        let build = |thin_earlier: bool| {
            let mut sess = steady_on_old("g", 10);
            sess.extend(steady_on_old("h", 12));
            if thin_earlier {
                let mut thin = named(facts("2026-10-02T15:00:00Z", 100, 80, 100.0, 50.0), "h");
                thin.gpu_driver = Some("1.0".into());
                sess.push(thin);
            }
            sess.push(rough_on_new("g", 10));
            sess.push(rough_on_new("h", 12));
            diagnose(&inputs(sess), Complaint::Slow, Some("g"))
        };
        let cross = |d: &Diagnosis| {
            finding(d, "gpu-driver-change").evidence.iter().find(|e| e.code == "cross-game").expect("listed").args["neverBefore"].clone()
        };
        assert_eq!(cross(&build(false)), "true", "every earlier session of the other game was normal");
        assert_eq!(cross(&build(true)), "false", "one earlier session was only thinly measured");
    }

    #[test]
    fn the_readers_window_is_the_last_normal_start_to_the_newest_affected_end() {
        let d = diagnose(&inputs(scenario()), Complaint::Slow, Some("g"));
        let (t0, t1) = change_window(&d).expect("a window");
        assert_eq!(t0, utc("2026-10-04T10:00:00Z"));
        assert_eq!(t1, utc("2026-10-09T10:10:00Z"));
        assert!(change_window(&diagnose(&inputs(steady(5)), Complaint::Slow, Some("g"))).is_none(), "nothing to explain, nothing to read");
    }

    #[test]
    fn the_command_path_hands_the_readers_the_window_and_the_game_and_uses_what_they_return() {
        let (tx, rx) = std::sync::mpsc::channel();
        let d = diagnose_with_changes(inputs(scenario()), Complaint::Slow, Some("g"), Duration::from_secs(2), move |a, b, g| {
            tx.send((a, b, g)).expect("sent");
            ChangeRead::Report {
                report: Box::new(report(vec![gpu("2026-10-06T12:00:00Z", "1.0", "2.0", Some(true))])),
                steam: GameSteam::Found,
            }
        });
        let (a, b, g) = rx.recv().expect("the readers were asked");
        assert_eq!((a, b, g.as_str()), (utc("2026-10-04T10:00:00Z"), utc("2026-10-09T10:10:00Z"), "g"));
        assert_eq!(finding(&d, "gpu-driver-change").since_when, When::Exact { at: "2026-10-06T12:00:00Z".into() });
        // With no game named the first pass picks it and the readers are asked about that one.
        let (tx, rx) = std::sync::mpsc::channel();
        let _ = diagnose_with_changes(fixture(), Complaint::Unknown, None, Duration::from_secs(2), move |_, _, g| {
            tx.send(g).expect("sent");
            ChangeRead::NotRead
        });
        assert_eq!(rx.recv().expect("asked"), ROUGH_GAME);
        // Nothing to explain: the readers are never started.
        let (tx, rx) = std::sync::mpsc::channel::<String>();
        let d = diagnose_with_changes(inputs(steady(5)), Complaint::Slow, Some("g"), Duration::from_secs(2), move |_, _, g| {
            let _ = tx.send(g);
            ChangeRead::NotRead
        });
        assert!(rx.try_recv().is_err() && d.limits.is_empty());
    }

    #[test]
    fn readers_that_run_long_or_die_leave_every_kind_unknown_never_an_error_or_nothing_changed() {
        let plain = diagnose(&fixture(), Complaint::Slow, Some(ROUGH_GAME));
        let slow = diagnose_with_changes(fixture(), Complaint::Slow, Some(ROUGH_GAME), Duration::from_millis(60), |_, _, _| {
            std::thread::sleep(Duration::from_millis(600));
            ChangeRead::NotRead
        });
        assert!(slow.limits.iter().all(|l| l.code == "took-too-long") && slow.limits.len() == 4, "{:?}", slow.limits);
        assert_eq!(ids(&slow), ids(&plain), "the diagnosis stands without them");
        assert!(slow.not_it.iter().all(|n| n.id != "windows-update"));
        let dead = diagnose_with_changes(fixture(), Complaint::Slow, Some(ROUGH_GAME), Duration::from_secs(2), |_, _, _| panic!("the reader died"));
        assert!(dead.limits.iter().all(|l| l.code == "reader-failed") && dead.limits.len() == 4);
        assert_eq!(dead.state, DiagnosisState::Found);
        // The wait itself is bounded by the budget.
        let started = std::time::Instant::now();
        let r = run_within(Duration::from_millis(50), || {
            std::thread::sleep(Duration::from_millis(500));
            ChangeRead::NotRead
        });
        assert!(matches!(r, ChangeRead::Unavailable("took-too-long")) && started.elapsed() < Duration::from_millis(400));
    }

    // ---- F4b review r1 ----

    #[test]
    fn an_update_compy_cannot_classify_is_counted_never_dropped_and_never_unchanged() {
        let d = found(scenario(), report(vec![update("2026-10-07T03:00:00Z", "KB5009999", "other")]));
        assert!(d.not_it.iter().all(|n| n.id != "windows-update"), "an unrecognised update is not 'none'");
        assert!(d.findings.iter().all(|f| f.id != "windows-update"));
        let s = d.seen.iter().find(|s| s.id == "updates-unclassified").expect("counted");
        assert_eq!((s.args["n"].as_str(), s.args["kbs"].as_str()), ("1", "KB5009999"));
        // Beside a definition update it still suppresses the line; with no KB id the id list is empty.
        let mut other = update("2026-10-07T03:00:00Z", "x", "other");
        other.what.kb = None;
        let d = found(scenario(), report(vec![update("2026-10-08T01:00:00Z", "KB2267602", "definition"), other]));
        assert!(d.not_it.iter().all(|n| n.id != "windows-update"));
        assert_eq!(d.seen.iter().find(|s| s.id == "updates-unclassified").expect("counted").args["kbs"], "");
    }

    #[test]
    fn same_version_and_unknown_version_rows_are_install_records_so_never_none() {
        let equal = scenario_without_driver_change();
        let d = found(equal.clone(), report(vec![gpu("2026-10-06T12:00:00Z", "1.0", "1.0", Some(false))]));
        let n = d.not_it.iter().find(|n| n.id == "gpu-driver-change").expect("stamps equal");
        assert!(!n.args.contains_key("windows"));
        assert!(d.seen.iter().any(|s| s.id == "driver-reinstall-same" && s.args["when"] == "2026-10-06T12:00:00Z"));
        let d = found(equal, report(vec![gpu("2026-10-06T12:00:00Z", "", "1.0", None)]));
        assert!(!d.not_it.iter().find(|n| n.id == "gpu-driver-change").expect("stamps equal").args.contains_key("windows"));
        assert!(d.seen.iter().any(|s| s.id == "driver-install-prior-unknown"));
        // Differing stamps: the "no record" evidence is withheld and the row is said as it is.
        let d = found(scenario(), report(vec![gpu("2026-10-06T12:00:00Z", "", "2.0", None)]));
        let c = codes(finding(&d, "gpu-driver-change"));
        assert!(!c.contains(&"install-not-recorded") && c.contains(&"install-prior-unknown") && c.contains(&"install-time-not-read"), "{c:?}");
        let d = found(scenario(), report(vec![gpu("2026-10-06T12:00:00Z", "2.0", "2.0", Some(false))]));
        let c = codes(finding(&d, "gpu-driver-change"));
        assert!(!c.contains(&"install-not-recorded") && c.contains(&"reinstall-same-version"), "{c:?}");
    }

    #[test]
    fn a_windows_only_driver_candidate_never_has_empty_version_text() {
        let nostamps = || -> Vec<SessionFacts> {
            scenario()
                .into_iter()
                .map(|mut s| {
                    s.gpu_driver = None;
                    s
                })
                .collect()
        };
        let mut no_from = gpu("2026-10-06T12:00:00Z", "1.0", "2.0", Some(true));
        no_from.what.from_version = None;
        let d = found(nostamps(), report(vec![no_from]));
        assert!(matches!(finding(&d, "gpu-driver-change").fix, Fix::None { .. }), "no version steps without a version");
        let d = found(nostamps(), report(vec![gpu("2026-10-06T12:00:00Z", "1.0", "2.0", Some(true))]));
        match &finding(&d, "gpu-driver-change").fix {
            Fix::Steps { args, .. } => assert!(!args["from"].is_empty() && !args["to"].is_empty(), "{args:?}"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_program_candidate_names_the_day_only_and_never_one_that_ran_before_the_period() {
        let progs = vec![program("2026-10-07T00:00:00Z", "2026-10-08T00:00:00Z", "Discord")];
        let mut sess = scenario();
        sess.last_mut().expect("rough").started_names = vec!["discord".into()];
        let d = found(sess.clone(), report(progs.clone()));
        let f = finding(&d, "program-installed");
        assert_eq!(f.since_when, When::Unknown, "a day is not a time of day");
        assert_eq!(f.evidence[0].args["day"], "2026-10-07T00:00:00Z");
        // It also started in a normal session before the period: updated, not newly installed.
        sess[1].started_names = vec!["discord".into()];
        let d = found(sess, report(progs));
        assert!(d.findings.iter().all(|f| f.id != "program-installed"));
        assert!(d.seen.iter().any(|s| s.id == "programs-installed"), "the collapsed line stays");
    }

    #[test]
    fn an_install_of_another_version_never_dates_or_weakens_this_driver_change() {
        // The stamps say 1.0 -> 2.0. A 3.0 install in the period is some other driver.
        let d = found(scenario(), report(vec![gpu("2026-10-06T12:00:00Z", "1.0", "3.0", Some(true))]));
        let f = finding(&d, "gpu-driver-change");
        let c = codes(f);
        assert!(!c.contains(&"install-recorded") && c.contains(&"install-time-not-read"), "{c:?}");
        assert!(matches!(f.since_when, When::ObservedBetween { .. }));
        assert!(d.seen.iter().any(|s| s.id == "driver-other-install"));
        // Later, a different version is installed: that is not evidence against the 2.0 change.
        let d = found(scenario(), report(vec![gpu("2026-10-09T10:05:00Z", "2.0", "3.0", Some(true))]));
        let f = finding(&d, "gpu-driver-change");
        assert!(f.in_play && !codes(f).contains(&"install-after-rough"));
    }

    #[test]
    fn the_uninstall_step_names_the_quality_updates_own_kb() {
        let evs = vec![update("2026-10-06T03:00:00Z", "KB900", "driver"), update("2026-10-07T03:00:00Z", "KB5001", "quality")];
        let d = found(scenario(), report(evs));
        match &finding(&d, "windows-update").fix {
            Fix::Steps { args, .. } => assert_eq!(args["kb"], "KB5001"),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_driver_class_update_that_is_the_same_install_is_one_candidate_not_two() {
        let mut wu = update("2026-10-06T12:01:00Z", "KB900", "driver");
        wu.what.to_version = Some("2.0".into());
        let drv = gpu("2026-10-06T12:00:00Z", "1.0", "2.0", Some(true));
        let d = found(scenario(), report(vec![drv.clone(), wu.clone()]));
        assert!(d.findings.iter().all(|f| f.id != "windows-update"), "{:?}", ids(&d));
        assert!(codes(finding(&d, "gpu-driver-change")).contains(&"delivered-by-update"));
        // Half an hour apart they are two facts.
        wu.when = ChangeTime::exact(utc("2026-10-06T12:30:00Z"));
        let d = found(scenario(), report(vec![drv, wu]));
        finding(&d, "windows-update");
        assert!(!codes(finding(&d, "gpu-driver-change")).contains(&"delivered-by-update"));
    }

    #[test]
    fn a_patch_tuesday_update_never_ranks_above_a_finding_with_other_support() {
        let mut inp = fixture();
        let mut r = report(vec![update("2026-11-19T12:00:00Z", "KB5050", "quality")]);
        r.window_start = utc("2026-11-11T14:14:22Z");
        r.window_end = utc("2026-11-20T04:00:00Z");
        inp.changes = ChangeRead::Report { report: Box::new(r), steam: GameSteam::Found };
        let d = diagnose(&inp, Complaint::Slow, Some(ROUGH_GAME));
        let at = |id: &str| ids(&d).iter().position(|x| *x == id).unwrap_or_else(|| panic!("{id} missing: {:?}", ids(&d)));
        assert!(at("windows-update") > at("gpu-driver-change") && at("windows-update") > at("background-load"), "{:?}", ids(&d));
        // Alone, it leads: nothing better-evidenced is in play.
        let d = found(scenario_without_driver_change(), report(vec![update("2026-10-07T03:00:00Z", "KB5001", "quality")]));
        assert_eq!(ids(&d)[0], "windows-update");
    }

    #[test]
    fn a_partly_read_log_or_steam_never_gives_an_unchanged_line() {
        let mut r = report(Vec::new());
        r.partial.push(PartialSource {
            source: Source::WindowsUpdateLog,
            gaps: vec![Gap::RowCapReached],
            covered_from: Some(utc("2026-10-08T00:00:00Z")),
        });
        r.partial.push(PartialSource { source: Source::SteamManifest, gaps: vec![Gap::TimedOut], covered_from: None });
        r.game_last_update = Some(game_files("2026-09-01T00:00:00Z"));
        let d = found(scenario(), r);
        assert!(d.not_it.iter().all(|n| n.id != "windows-update" && n.id != "game-files-change"), "{:?}", d.not_it);
        assert!(limit_of(&d, "windows-update").contains(&"partial-row-cap"));
        assert!(limit_of(&d, "game-update").contains(&"partial-timed-out"));
    }

    #[test]
    fn the_wire_shape_carries_limits_and_seen_lines() {
        let d = found(scenario(), report(vec![update("2026-10-08T01:00:00Z", "KB2267602", "definition")]));
        let v = serde_json::to_value(&d).expect("serialises");
        assert_eq!(v["limits"][0]["kind"], "driver");
        assert!(v["limits"][0]["code"].is_string() && v["limits"][0]["args"].is_object());
        assert_eq!(v["seen"][0]["id"], "updates-minor");
        assert_eq!(v["seen"][0]["args"]["n"], "1");
    }
}


// ==== F3: did it get better? Recovery judged from the next sessions, each candidate re-scored ===========
mod recovery_f3 {
    use super::super::changes::{ChangeRead, GameSteam};
    use super::super::recovery::{RecoverySummary, RECOVERY_MIN_SECS, RECOVERY_R_FRACTION, RECOVERY_SHOWN_FOR};
    use super::*;
    use crate::change_sources::{ChangeEvent, ChangeKind, ChangeReport, ChangeTime, ChangeWhat, Note, Source};

    fn utc(s: &str) -> DateTime<Utc> {
        ts(s).expect("a time")
    }

    /// A session of "g" on `day` of October at 10:00, 600 s fully measured, average 100 and 1% low `low1`.
    fn on(day: u32, low1: f64, driver: Option<&str>) -> SessionFacts {
        let mut s = facts(&at_day(day, 10), 600, 600, 100.0, low1);
        s.gpu_driver = driver.map(str::to_string);
        s
    }

    /// Four normal sessions (days 1 to 4, ratio 0.5) on driver 1.0, then one rough one (ratio 0.3) on 2.0 on day 9.
    fn episode() -> Vec<SessionFacts> {
        let mut v: Vec<SessionFacts> = (1..=4).map(|d| on(d, 50.0, Some("1.0"))).collect();
        v.push(on(9, 30.0, Some("2.0")));
        v
    }

    /// Two sessions after the episode (days 10 and 11), each built by `make(day)`: the least that is a recovery.
    fn two(make: impl Fn(u32) -> SessionFacts) -> Vec<SessionFacts> {
        vec![make(10), make(11)]
    }

    fn calm(day: u32) -> SessionFacts {
        on(day, 50.0, Some("2.0"))
    }

    fn run(sess: Vec<SessionFacts>) -> Diagnosis {
        diagnose(&inputs(sess), Complaint::Slow, Some("g"))
    }

    fn with_extra(mut sess: Vec<SessionFacts>, extra: Vec<SessionFacts>) -> Vec<SessionFacts> {
        sess.extend(extra);
        sess
    }

    fn now_of(d: &Diagnosis, id: &str) -> (Option<NowStatus>, Vec<&'static str>) {
        let f = d.findings.iter().find(|f| f.id == id).unwrap_or_else(|| panic!("{id} not listed: {:?}", ids(d)));
        (f.now, f.now_evidence.iter().map(|e| e.code).collect())
    }

    fn finding_of<'a>(d: &'a Diagnosis, id: &str) -> &'a Finding {
        d.findings.iter().find(|f| f.id == id).unwrap_or_else(|| panic!("{id} not listed: {:?}", ids(d)))
    }

    fn unclear(partial: bool, one_clear: bool, cap_changed: bool) -> DiagnosisState {
        DiagnosisState::CantTell { why: CantTellWhy::RecoveryUnclear { partial, one_clear, cap_changed } }
    }

    // ---- the recovery rule -------------------------------------------------------------------------
    #[test]
    fn one_clear_session_is_only_cant_tell_yet_even_at_the_median() {
        let d = run(with_extra(episode(), vec![on(10, 50.0, Some("2.0"))]));
        assert_eq!(d.state, unclear(false, true, false), "{:?}", d.state);
        assert!(d.recovery.is_none() && d.findings.iter().all(|f| f.now.is_none()), "no per-candidate verdict before a recovery");
        // The rough episode is still described under it.
        assert!(d.problem.is_some() && !d.findings.is_empty());
    }

    #[test]
    fn two_clear_sessions_in_a_row_are_a_recovery() {
        for low in [46.0, 50.0] {
            let d = run(with_extra(episode(), two(|day| on(day, low, Some("2.0")))));
            assert_eq!(d.state, DiagnosisState::Recovered, "{low}: {:?}", d.state);
            let r = d.recovery.as_ref().expect("recovery block");
            assert_eq!(r.recovered_sessions.len(), 2);
            assert_eq!(r.sessions_since, 2);
            assert!((r.before.ratio - 0.5).abs() < 1e-9 && (r.rough.ratio - 0.3).abs() < 1e-9 && (r.now.ratio - low / 100.0).abs() < 1e-9);
            assert_eq!(r.rough_sessions.len(), 1);
        }
        // The newest of two not clear (0.42 is under 0.9 x 0.5): in between, not one clear session either.
        let gap = run(with_extra(episode(), vec![on(10, 46.0, Some("2.0")), on(11, 42.0, Some("2.0"))]));
        assert_eq!(gap.state, unclear(false, false, false), "{:?}", gap.state);
    }

    #[test]
    fn every_line_of_the_rule_holds_on_both_sides() {
        assert_eq!(RECOVERY_R_FRACTION, 0.90);
        assert_eq!(RECOVERY_SHOWN_FOR, 5);
        assert_eq!(RECOVERY_MIN_SECS, 600);
        let pair = |a: f64, b: f64| run(with_extra(episode(), vec![on(10, a, Some("2.0")), on(11, b, Some("2.0"))])).state;
        // 0.90 x 0.5 = 0.45: exactly on the line counts, just under does not, for either of the two.
        assert_eq!(pair(45.0, 45.0), DiagnosisState::Recovered);
        assert!(matches!(pair(44.9, 44.9), DiagnosisState::CantTell { .. }));
        assert!(matches!(pair(45.0, 44.9), DiagnosisState::CantTell { .. }));
        assert!(matches!(pair(44.9, 45.0), DiagnosisState::CantTell { .. }));
        // Duration: 600 s counts, 599 s does not.
        let long = |day| on(day, 50.0, Some("2.0"));
        let short = |day| {
            let mut s = on(day, 50.0, Some("2.0"));
            s.duration_secs = 599;
            s.samples = 599;
            s
        };
        assert_eq!(run(with_extra(episode(), vec![long(10), long(11)])).state, DiagnosisState::Recovered);
        assert!(matches!(run(with_extra(episode(), vec![long(10), short(11)])).state, DiagnosisState::CantTell { .. }));
        // Coverage: 80% of the session measured counts, 79% does not.
        let covered = |day, samples: u32| {
            let mut s = on(day, 50.0, Some("2.0"));
            s.samples = samples;
            s
        };
        assert_eq!(run(with_extra(episode(), vec![covered(10, 480), covered(11, 480)])).state, DiagnosisState::Recovered);
        assert!(matches!(run(with_extra(episode(), vec![covered(10, 480), covered(11, 474)])).state, DiagnosisState::CantTell { .. }));
        // The 1% low (p99 frame time) may not be worse than the baseline's worst.
        let p99 = |p: f64| {
            let mut v: Vec<SessionFacts> = (1..=4)
                .map(|d| {
                    let mut s = on(d, 50.0, Some("1.0"));
                    s.p99_ms = Some(10.0);
                    s
                })
                .collect();
            v.push(on(9, 30.0, Some("2.0")));
            for d in [10, 11] {
                let mut s = on(d, 50.0, Some("2.0"));
                s.p99_ms = Some(p);
                v.push(s);
            }
            run(v).state
        };
        assert_eq!(p99(10.0), DiagnosisState::Recovered);
        assert!(matches!(p99(10.5), DiagnosisState::CantTell { .. }), "{:?}", p99(10.5));
    }

    #[test]
    fn once_recovered_a_slightly_lower_session_does_not_flip_it_back() {
        // clear, clear, then 0.44 (above the rough line, under 0.45): still recovered, on the two that cleared.
        let d = run(with_extra(episode(), vec![calm(10), calm(11), on(12, 44.0, Some("2.0"))]));
        assert_eq!(d.state, DiagnosisState::Recovered, "{:?}", d.state);
        let r = d.recovery.as_ref().expect("recovery");
        assert_eq!(r.recovered_sessions.iter().map(|s| s.started_at.as_str()).collect::<Vec<_>>(), [at_day(10, 10).as_str(), at_day(11, 10).as_str()]);
        assert_eq!(r.sessions_since, 3);
        // Only a rule firing reopens it, and that is a new episode.
        let d = run(with_extra(episode(), vec![calm(10), calm(11), on(12, 30.0, Some("2.0"))]));
        assert!(!matches!(d.state, DiagnosisState::Recovered), "{:?}", d.state);
        assert!(d.earlier_episode.is_some());
    }

    #[test]
    fn no_ordinary_session_from_the_owners_fixture_is_a_recovery_on_its_own() {
        // A low-median game (0.4) so that most of the owner's ordinary sessions would clear it alone.
        let low_episode = || -> Vec<SessionFacts> {
            let mut v: Vec<SessionFacts> = (1..=4).map(|d| on(d, 40.0, None)).collect();
            v.push(on(9, 20.0, None));
            v
        };
        let (mut checked, mut would_have_cleared) = (0, 0);
        for s in &fixture().sessions {
            let mut one = s.clone();
            one.game = "g".into();
            one.started_at = at_day(10, 10);
            if one.coverage() >= BASELINE_COVERAGE && one.ratio().is_some_and(|r| r >= 0.4) {
                would_have_cleared += 1;
            }
            let d = run(with_extra(low_episode(), vec![one]));
            assert!(!matches!(d.state, DiagnosisState::Recovered), "a lone session recovered it: {:?}", d.state);
            checked += 1;
        }
        assert!(checked >= 50, "{checked}");
        assert!(would_have_cleared >= 20, "the fixture must contain sessions a one-session rule would have accepted: {would_have_cleared}");
    }

    #[test]
    fn a_partly_measured_session_is_never_a_recovery() {
        // Too short to judge: the episode stands and says how many later sessions were not read.
        let mut short = on(10, 50.0, Some("2.0"));
        short.duration_secs = 100;
        short.samples = 80;
        let d = run(with_extra(episode(), vec![short]));
        assert_eq!(d.state, DiagnosisState::Found, "{:?}", d.state);
        assert_eq!(d.problem.as_ref().map(|p| p.later_unjudged), Some(1));
        // Judged, but only 70% measured (under the baseline's 80%): in between, never recovered.
        let mut thin = on(11, 50.0, Some("2.0"));
        thin.samples = 420;
        let d = run(with_extra(episode(), vec![on(10, 50.0, Some("2.0")), thin]));
        assert_eq!(d.state, unclear(true, false, false), "{:?}", d.state);
        // Two good sessions followed by one nobody could read: Compy cannot say.
        let mut later = on(12, 50.0, Some("2.0"));
        later.duration_secs = 100;
        later.samples = 80;
        let d = run(with_extra(episode(), vec![calm(10), calm(11), later]));
        assert_eq!(d.state, unclear(true, false, false), "{:?}", d.state);
    }

    #[test]
    fn a_frame_cap_change_is_never_a_recovery() {
        // Uncapped baseline and rough session, then a capped session (a cap lifts the ratio): never "recovered".
        let mut sess: Vec<SessionFacts> = episode();
        for s in sess.iter_mut() {
            s.cap = CapState::Uncapped;
        }
        let mut capped = on(10, 50.0, Some("2.0"));
        capped.cap = CapState::Capped { at_fps: 60.0 };
        sess.push(capped);
        let d = run(sess);
        assert!(!matches!(d.state, DiagnosisState::Recovered), "{:?}", d.state);
        assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::FrameCapChanged });
        // Even with three capped sessions on file (so the capped one IS judged against them), the rough
        // episode was uncapped, so it does not count, and playing again under the new cap cannot settle it.
        let mut sess: Vec<SessionFacts> = Vec::new();
        for d in 1..=3 {
            let mut s = facts(&at_day(d, 9), 600, 600, 60.0, 30.0);
            s.cap = CapState::Capped { at_fps: 60.0 };
            sess.push(s);
        }
        for d in 4..=7 {
            let mut s = on(d, 50.0, None);
            s.cap = CapState::Uncapped;
            sess.push(s);
        }
        let mut rough = on(9, 30.0, None);
        rough.cap = CapState::Uncapped;
        sess.push(rough);
        for d in [10, 11] {
            let mut capped = facts(&at_day(d, 10), 600, 600, 60.0, 30.0);
            capped.cap = CapState::Capped { at_fps: 60.0 };
            sess.push(capped);
        }
        let d = run(sess);
        assert_eq!(d.state, unclear(false, false, true), "{:?}", d.state);
    }

    #[test]
    fn rough_again_is_the_same_episode_continuing_and_the_card_can_count_it() {
        let d = run(with_extra(episode(), vec![on(10, 30.0, Some("2.0"))]));
        assert_eq!(d.state, DiagnosisState::Found);
        assert_eq!(d.problem.as_ref().map(|p| p.sessions_affected.len()), Some(2));
        assert!(d.recovery.is_none() && d.earlier_episode.is_none());
    }

    #[test]
    fn a_rough_episode_after_a_recovery_is_a_new_episode() {
        let sess = with_extra(episode(), vec![calm(10), calm(11), on(12, 30.0, Some("2.0"))]);
        let d = run(sess);
        // Nothing recorded changed before the second episode (the driver stayed on 2.0): it is measured, not explained.
        assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::NothingChanged }, "{:?}", d.state);
        assert_eq!(d.problem.as_ref().map(|p| p.sessions_affected.len()), Some(1), "the two episodes are not merged");
        assert_eq!(d.earlier_episode, Some(EarlierEpisode { from: at_day(9, 10), to: at_day(9, 10) }));
        // An earlier episode that never recovered (rough, then one in-between session) is not announced.
        let d = run(with_extra(episode(), vec![on(10, 44.0, Some("2.0")), on(11, 30.0, Some("2.0"))]));
        assert_eq!(d.earlier_episode, None);
    }

    #[test]
    fn the_recovered_answer_lasts_five_sessions_then_it_is_just_normal() {
        let run_n = |n: u32| run(with_extra(episode(), (10..10 + n).map(calm).collect()));
        assert_eq!(run_n(5).state, DiagnosisState::Recovered);
        assert!(matches!(run_n(6).state, DiagnosisState::NothingWrong { .. }), "{:?}", run_n(6).state);
    }

    #[test]
    fn the_last_normal_date_names_a_fully_measured_session_or_says_it_was_not_one() {
        // The newest session before the episode was an idle, thinly measured one that merely did not cross the line.
        let mut v: Vec<SessionFacts> = (1..=4).map(|d| on(d, 50.0, Some("1.0"))).collect();
        let mut idle = on(5, 45.0, Some("1.0"));
        idle.samples = 360;
        v.push(idle);
        v.push(on(9, 30.0, Some("2.0")));
        let d = run(v);
        let p = d.problem.as_ref().expect("problem");
        assert_eq!(p.last_normal_at, at_day(5, 10));
        assert_eq!(p.last_full_normal_at.as_deref(), Some(at_day(4, 10).as_str()));
        // With a fully measured last session the two are the same date.
        let d = run(episode());
        let p = d.problem.as_ref().expect("problem");
        assert_eq!(p.last_full_normal_at.as_deref(), Some(p.last_normal_at.as_str()));
    }

    // ---- no path to Likely that did not exist before the recovery slice ----------------------------
    #[test]
    fn a_recovery_adds_no_path_to_likely() {
        // Every combination of the supports: Likely exactly when it has timing, two independent supports
        // (a changed stamp, another game's roughness that is not confounded, a measured size) and nothing
        // against it. The recovery observation `r` never changes the answer.
        let mut likely_paths = 0;
        for bits in 0u32..64 {
            let b = |i: u32| bits & (1 << i) != 0;
            let (t, d, x, confounded, m, c1) = (b(0), b(1), b(2), b(3), b(4), b(5));
            for r in [false, true] {
                let cand = Cand {
                    id: "x",
                    t,
                    d,
                    x,
                    confounded,
                    m,
                    r,
                    c1,
                    since: When::Unknown,
                    fix: no_safe_change(),
                    evidence: Vec::new(),
                };
                let independent = usize::from(d) + usize::from(x && !confounded) + usize::from(m);
                let expected = if !t {
                    m.then_some(Certainty::Possible)
                } else if independent >= 2 && !c1 {
                    Some(Certainty::Likely)
                } else {
                    Some(Certainty::Possible)
                };
                assert_eq!(cand.certainty(), expected, "t={t} d={d} x={x} conf={confounded} m={m} r={r} c1={c1}");
                if expected == Some(Certainty::Likely) {
                    likely_paths += 1;
                }
            }
        }
        // t + c1 off + at least two of {d, x unconfounded, m}: the same count with r off and on.
        assert!(likely_paths > 0 && likely_paths % 2 == 0);
        // And on real diagnoses: whatever is Likely after a recovery was Likely from the rough sessions alone.
        let scenarios = vec![
            with_extra(episode(), two(|day| on(day, 50.0, Some("3.0")))),
            with_extra(busy_episode(Some(30.0)), two(|day| recovered_with(day, 50.0, 0, Some(3.0)))),
            with_extra(busy_episode(None), two(|day| recovered_with(day, 50.0, 0, Some(3.0)))),
        ];
        for sess in scenarios {
            let after = run(sess.clone());
            let before = run(sess[..5].to_vec());
            for f in after.findings.iter().filter(|f| f.confidence == Certainty::Likely) {
                assert!(
                    before.findings.iter().any(|b| b.id == f.id && b.confidence == Certainty::Likely),
                    "{} became Likely only because of the recovery",
                    f.id
                );
            }
        }
    }

    // ---- what the recovery says about each candidate ------------------------------------------------
    #[test]
    fn recovered_on_the_same_driver_points_away_from_the_driver() {
        let d = run(with_extra(episode(), two(calm)));
        let (now, codes) = now_of(&d, "gpu-driver-change");
        assert_eq!(now, Some(NowStatus::PointsAway));
        assert_eq!(codes, ["recovered-same-driver"]);
        let f = finding_of(&d, "gpu-driver-change");
        assert!(f.now_evidence[0].against && f.now_evidence[0].args["version"] == "2.0");
        assert_eq!(f.confidence, Certainty::Possible);
        assert!(!f.in_play, "contradicted, so no longer one of the changes in play");
    }

    #[test]
    fn recovered_after_the_driver_changed_again_points_to_it_but_never_makes_it_likely() {
        let d = run(with_extra(episode(), two(|day| on(day, 50.0, Some("3.0")))));
        let (now, codes) = now_of(&d, "gpu-driver-change");
        assert_eq!(now, Some(NowStatus::PointsTo));
        assert_eq!(codes, ["recovered-after-driver-change"]);
        let f = finding_of(&d, "gpu-driver-change");
        assert_eq!(f.now_evidence[0].kind, EvidenceKind::SupportedInference);
        assert_eq!(f.now_evidence[0].args["exact"], "false");
        assert_eq!(f.now_evidence[0].args["back"], "false");
        // The changed stamp and its timing are one support; a recovery is not a second one.
        assert_eq!(f.confidence, Certainty::Possible);
        // Changed BACK to the version it had before: the same support, said as "back".
        let back = run(with_extra(episode(), two(|day| on(day, 50.0, Some("1.0")))));
        assert_eq!(finding_of(&back, "gpu-driver-change").now_evidence[0].args["back"], "true");
        assert!(!matches!(f.confidence, Certainty::Known | Certainty::Measured));
    }

    #[test]
    fn a_recovery_with_no_driver_stamp_cannot_promote_the_driver() {
        let d = run(with_extra(episode(), two(|day| on(day, 50.0, None))));
        let (now, codes) = now_of(&d, "gpu-driver-change");
        assert_eq!(now, Some(NowStatus::CantTell));
        assert_eq!(codes, ["recovery-driver-unread"]);
        assert_eq!(finding_of(&d, "gpu-driver-change").confidence, Certainty::Possible);
    }

    fn event(kind: ChangeKind, at: &str, what: ChangeWhat, source: Source) -> ChangeEvent {
        ChangeEvent { kind, when: ChangeTime::exact(utc(at)), what, source }
    }

    fn gpu(at: &str, from: &str, to: &str) -> ChangeEvent {
        let what = ChangeWhat {
            name: Some("Display".into()),
            from_version: Some(from.into()),
            to_version: Some(to.into()),
            version_changed: Some(true),
            detail: Some("display driver, package oem1.inf".into()),
            ..ChangeWhat::default()
        };
        event(ChangeKind::GpuDriver, at, what, Source::DriverLog)
    }

    fn update(at: &str, kb: &str) -> ChangeEvent {
        let what = ChangeWhat { kb: Some(kb.into()), name: Some(format!("{kb} update")), detail: Some("quality".into()), ..ChangeWhat::default() };
        event(ChangeKind::WindowsUpdate, at, what, Source::WindowsUpdateLog)
    }

    fn game_update(at: &str) -> ChangeEvent {
        let what = ChangeWhat { build_id: Some("26807668".into()), ..ChangeWhat::default() };
        event(ChangeKind::GameUpdate, at, what, Source::SteamManifest)
    }

    fn report(events: Vec<ChangeEvent>) -> ChangeReport {
        ChangeReport {
            window_start: utc("2026-10-04T10:00:00Z"),
            window_end: utc("2026-10-12T10:10:00Z"),
            asked: vec![Source::DriverLog, Source::WindowsUpdateLog, Source::UninstallKeys, Source::SteamManifest],
            events_found: events,
            unreadable: Vec::new(),
            partial: Vec::new(),
            coverage_gaps: Vec::new(),
            notes: vec![(Source::UninstallKeys, Note::ProgramsWithoutDate(0)), (Source::SteamManifest, Note::SteamUpdateTimeIsFileChange)],
            game_last_update: None,
            undated_excluded: 0,
        }
    }

    fn with_report(sess: Vec<SessionFacts>, events: Vec<ChangeEvent>) -> Diagnosis {
        let mut inp = inputs(sess);
        inp.changes = ChangeRead::Report { report: Box::new(report(events)), steam: GameSteam::Found };
        diagnose(&inp, Complaint::Slow, Some("g"))
    }

    #[test]
    fn windows_install_record_dates_the_second_driver_change() {
        let d = with_report(with_extra(episode(), two(|day| on(day, 50.0, Some("3.0")))), vec![gpu("2026-10-09T20:00:00Z", "2.0", "3.0")]);
        let f = finding_of(&d, "gpu-driver-change");
        assert_eq!(f.now, Some(NowStatus::PointsTo));
        let e = &f.now_evidence[0];
        assert_eq!((e.args["exact"].as_str(), e.args["when"].as_str()), ("true", "2026-10-09T20:00:00Z"));
        // The same stamps with a Windows record of ANOTHER version in between is not "same driver": it can't say.
        let d = with_report(with_extra(episode(), two(calm)), vec![gpu("2026-10-09T20:00:00Z", "2.0", "3.0")]);
        assert_eq!(finding_of(&d, "gpu-driver-change").now, Some(NowStatus::CantTell));
    }

    /// Rough sessions where every one saw nine build-tool starts; `rough_p90` is their recorded load, if any.
    fn busy_episode(rough_p90: Option<f64>) -> Vec<SessionFacts> {
        let mut v: Vec<SessionFacts> = (1..=4).map(|d| on(d, 50.0, None)).collect();
        let mut rough = on(9, 30.0, None);
        rough.busy_starts = 9;
        rough.busy_names = vec!["rustc".into()];
        rough.other_cpu_p90_pct = rough_p90;
        v.push(rough);
        v
    }

    fn recovered_with(day: u32, low1: f64, starts: u32, p90: Option<f64>) -> SessionFacts {
        let mut s = on(day, low1, None);
        s.busy_starts = starts;
        s.other_cpu_p90_pct = p90;
        s
    }

    #[test]
    fn a_quiet_recovery_with_no_load_numbers_for_the_rough_sessions_cannot_tell_and_is_never_likely() {
        // The inverse of what the first F3 commit asserted (Likely from starts plus ONE quiet session).
        let d = run(with_extra(busy_episode(None), two(|day| recovered_with(day, 50.0, 0, Some(3.0)))));
        assert_eq!(d.state, DiagnosisState::Recovered);
        let f = finding_of(&d, "background-load");
        assert_eq!(f.now, Some(NowStatus::CantTell));
        let codes: Vec<&str> = f.now_evidence.iter().map(|e| e.code).collect();
        // The rough sessions have no load numbers (true of the owner's 2026-11-19/20 sessions): said in the same breath.
        assert_eq!(codes, ["recovered-quiet", "rough-load-not-recorded"]);
        assert_eq!(f.now_evidence[0].args["pct"], "3.0");
        assert_eq!(f.confidence, Certainty::Possible);
        assert_ne!(d.recovery.as_ref().map(|r| r.summary.clone()), Some(RecoverySummary::PointsTo { id: "background-load" }));
    }

    #[test]
    fn a_quiet_recovery_with_recorded_load_on_both_sides_points_to_background_programs_and_stays_possible() {
        let d = with_report(
            with_extra(busy_episode(Some(30.0)), two(|day| recovered_with(day, 50.0, 0, Some(3.0)))),
            Vec::new(),
        );
        let f = finding_of(&d, "background-load");
        assert_eq!(f.now, Some(NowStatus::PointsTo));
        assert_eq!(f.now_evidence.iter().map(|e| e.code).collect::<Vec<_>>(), ["recovered-quiet"]);
        assert_eq!(f.now_evidence[0].kind, EvidenceKind::SupportedInference);
        assert_eq!(f.confidence, Certainty::Possible, "a recovery never makes a finding Likely");
        assert_eq!(d.recovery.as_ref().map(|r| r.summary.clone()), Some(RecoverySummary::PointsTo { id: "background-load" }));
    }

    #[test]
    fn background_programs_are_not_promoted_without_a_recorded_quiet_session() {
        // No load number on the recovered sessions: Compy can't tell.
        let d = run(with_extra(busy_episode(Some(30.0)), two(|day| recovered_with(day, 50.0, 0, None))));
        let f = finding_of(&d, "background-load");
        assert_eq!((f.now, f.confidence), (Some(NowStatus::CantTell), Certainty::Possible));
        // A few starts (under the five that count as busy): not "nothing else was starting".
        let d = run(with_extra(busy_episode(Some(30.0)), two(|day| recovered_with(day, 50.0, 2, Some(3.0)))));
        assert_eq!(finding_of(&d, "background-load").now, Some(NowStatus::CantTell));
        // One rough session has a load number and another has none: the comparison is one-sided.
        let mut v = busy_episode(Some(30.0));
        v.push(on(10, 30.0, None));
        v.push(recovered_with(11, 50.0, 0, Some(3.0)));
        v.push(recovered_with(12, 50.0, 0, Some(3.0)));
        let d = run(v);
        assert_eq!(finding_of(&d, "background-load").now, Some(NowStatus::CantTell));
    }

    #[test]
    fn recovered_with_programs_still_starting_or_a_busy_pc_points_away_from_background_programs() {
        let d = run(with_extra(busy_episode(Some(30.0)), two(|day| recovered_with(day, 50.0, 9, Some(3.0)))));
        let f = finding_of(&d, "background-load");
        assert_eq!(f.now, Some(NowStatus::PointsAway));
        assert!(f.now_evidence[0].against);
        assert!(!f.in_play && f.confidence == Certainty::Possible);
        // High recorded load, no starts: also against. 14.9 is quiet, 15.0 is not (the engine's own line).
        let d = run(with_extra(busy_episode(Some(30.0)), two(|day| recovered_with(day, 50.0, 0, Some(15.0)))));
        assert_eq!(finding_of(&d, "background-load").now, Some(NowStatus::PointsAway));
        let d = run(with_extra(busy_episode(Some(30.0)), two(|day| recovered_with(day, 50.0, 0, Some(14.9)))));
        assert_eq!(finding_of(&d, "background-load").now, Some(NowStatus::PointsTo));
    }

    #[test]
    fn the_summary_names_one_supported_candidate_only_when_every_other_is_pointed_away_and_nothing_else_changed() {
        // Driver stays (points away), background quiet against a busy rough session (points to).
        let mut v: Vec<SessionFacts> = (1..=4).map(|d| on(d, 50.0, Some("1.0"))).collect();
        let mut rough = on(9, 30.0, Some("2.0"));
        rough.busy_starts = 9;
        rough.other_cpu_p90_pct = Some(30.0);
        v.push(rough);
        let quiet = |day: u32, drv: &str| {
            let mut s = on(day, 50.0, Some(drv));
            s.other_cpu_p90_pct = Some(3.0);
            s
        };
        let mut same = v.clone();
        same.extend([quiet(10, "2.0"), quiet(11, "2.0")]);
        let d = with_report(same.clone(), Vec::new());
        assert_eq!(now_of(&d, "gpu-driver-change").0, Some(NowStatus::PointsAway));
        assert_eq!(d.recovery.as_ref().map(|r| r.summary.clone()), Some(RecoverySummary::PointsTo { id: "background-load" }));
        // The same recovery with Windows' records NOT read: Compy cannot say nothing else changed.
        let d = run(same);
        assert_ne!(d.recovery.as_ref().map(|r| r.summary.clone()), Some(RecoverySummary::PointsTo { id: "background-load" }));
        assert!(d.recovery.as_ref().is_some_and(|r| r.also_changed.iter().any(|e| e.code == "gap-unread")));
        // Driver changed AND quiet: two candidates stand, "still between".
        v.extend([quiet(10, "3.0"), quiet(11, "3.0")]);
        let d = with_report(v, Vec::new());
        match d.recovery.as_ref().map(|r| r.summary.clone()) {
            Some(RecoverySummary::Between { ids }) => {
                assert!(ids.contains(&"gpu-driver-change") && ids.contains(&"background-load"), "{ids:?}")
            }
            other => panic!("{other:?}"),
        }
    }

    fn gb_of(g: f64) -> Option<u64> {
        Some((g * 1e9) as u64)
    }

    fn ram_episode(rough: &[(u32, f64)], recovered_peak: Option<f64>) -> Diagnosis {
        let mut v: Vec<SessionFacts> = (1..=4)
            .map(|d| {
                let mut s = on(d, 50.0, None);
                s.peak_ram_bytes = gb_of(20.0);
                s.ram_total_bytes = gb_of(33.7);
                s
            })
            .collect();
        for &(day, peak) in rough {
            let mut s = on(day, 30.0, None);
            s.peak_ram_bytes = gb_of(peak);
            s.ram_total_bytes = gb_of(33.7);
            v.push(s);
        }
        let first_rec = rough.last().map_or(10, |r| r.0) + 1;
        for day in [first_rec, first_rec + 1] {
            let mut s = on(day, 50.0, None);
            s.peak_ram_bytes = recovered_peak.and_then(gb_of);
            s.ram_total_bytes = recovered_peak.and_then(|_| gb_of(33.7));
            v.push(s);
        }
        run(v)
    }

    #[test]
    fn memory_in_the_recovered_sessions_is_compared_with_every_rough_one() {
        let lower = ram_episode(&[(9, 31.0)], Some(20.0));
        assert_eq!(now_of(&lower, "memory-pressure"), (Some(NowStatus::PointsTo), vec!["recovered-ram-lower"]));
        assert_eq!(finding_of(&lower, "memory-pressure").now_evidence[0].args["roughGb"], "31.0");
        // Memory is a size, not a timing: a support never lifts it above Possible.
        assert_eq!(finding_of(&lower, "memory-pressure").confidence, Certainty::Possible);
        let full = ram_episode(&[(9, 31.0)], Some(31.0));
        assert_eq!(now_of(&full, "memory-pressure"), (Some(NowStatus::PointsAway), vec!["recovered-ram-full"]));
        let unread = ram_episode(&[(9, 31.0)], None);
        assert_eq!(now_of(&unread, "memory-pressure"), (Some(NowStatus::CantTell), vec!["recovery-ram-not-read"]));
    }

    #[test]
    fn a_rough_session_that_ran_with_memory_well_below_full_means_a_lower_peak_now_says_little() {
        // The owner's own peaks: 30.6 GB (full) and 21.5 GB (not), then a recovery at 20 GB.
        let d = ram_episode(&[(9, 30.6), (10, 21.5)], Some(20.0));
        assert_eq!(d.state, DiagnosisState::Recovered, "{:?}", d.state);
        assert_eq!(now_of(&d, "memory-pressure"), (Some(NowStatus::CantTell), vec!["recovered-ram-rough-lower"]));
        assert_ne!(d.recovery.as_ref().map(|r| r.summary.clone()), Some(RecoverySummary::PointsTo { id: "memory-pressure" }));
    }

    #[test]
    fn a_setting_notice_that_still_stands_points_away_and_an_unplaceable_one_cannot_tell() {
        let drift = |at: &str| DriftFact { id: "applied-changes".into(), last_ready_at: None, noticed_at: at.into() };
        let mk = |fact: DriftFact, unread: bool| {
            let mut inp = inputs(with_extra(episode(), two(calm)));
            inp.drift = vec![fact];
            inp.drift_unread = unread;
            diagnose(&inp, Complaint::Slow, Some("g"))
        };
        let d = mk(drift("2026-10-08T10:00:00Z"), false);
        assert_eq!(now_of(&d, "setting-drift"), (Some(NowStatus::PointsAway), vec!["recovered-drift-still"]));
        // A store that cannot be read: Compy says it cannot tell (the candidate is not even listed from an unread store).
        let d = mk(drift("2026-10-08T10:00:00Z"), true);
        assert!(d.findings.iter().all(|f| f.id != "setting-drift" || f.now == Some(NowStatus::CantTell)));
    }

    fn compy_episode(baseline: &[usize], rough: usize, recovered: usize) -> Vec<SessionFacts> {
        let mut v: Vec<SessionFacts> = (1..=4).map(|d| on(d, 50.0, None)).collect();
        for (s, n) in v.iter_mut().zip(baseline.iter().copied().cycle()) {
            s.compy_changes = Some(n);
        }
        let mut r = on(9, 30.0, None);
        r.compy_changes = Some(rough);
        v.push(r);
        for day in [10, 11] {
            let mut s = on(day, 50.0, None);
            s.compy_changes = Some(recovered);
            v.push(s);
        }
        v
    }

    #[test]
    fn a_compy_change_count_back_to_the_baselines_newest_supports_and_the_change_is_listed() {
        let d = with_report(compy_episode(&[3], 5, 3), Vec::new());
        assert_eq!(now_of(&d, "compy-change"), (Some(NowStatus::PointsTo), vec!["recovered-compy-back"]));
        // The user undid a Compy change between the two: named as one more thing that changed.
        let r = d.recovery.as_ref().expect("recovery");
        assert_eq!(r.also_changed.iter().map(|e| e.code).collect::<Vec<_>>(), ["compy-changes-differ"]);
        assert_eq!(r.also_changed[0].args["from"], "5");
        assert_eq!(r.also_changed[0].args["to"], "3");
        assert_ne!(r.summary, RecoverySummary::PointsTo { id: "compy-change" }, "a change in the stretch means no 'points to' summary");
        // Still 5 changes on: points away.
        let d = with_report(compy_episode(&[3], 5, 5), Vec::new());
        assert_eq!(now_of(&d, "compy-change"), (Some(NowStatus::PointsAway), vec!["recovered-compy-same"]));
        assert!(d.recovery.as_ref().is_some_and(|r| r.also_changed.is_empty()));
    }

    #[test]
    fn a_compy_count_inside_the_baseline_range_but_not_the_baselines_newest_is_not_back() {
        // Baseline counts 0, 1, 2, 3 (newest 3); rough 14; recovered at 1: inside the range, but not what it was.
        let d = with_report(compy_episode(&[0, 1, 2, 3], 14, 1), Vec::new());
        assert_eq!(now_of(&d, "compy-change"), (Some(NowStatus::CantTell), vec!["recovered-compy-other"]));
    }

    #[test]
    fn windows_update_unchanged_cannot_be_the_whole_story_and_changed_again_is_only_noted() {
        let base = || with_extra(episode(), two(calm));
        let before = update("2026-10-08T12:00:00Z", "KB5001234");
        let d = with_report(base(), vec![before.clone()]);
        let f = finding_of(&d, "windows-update");
        assert_eq!(f.now, Some(NowStatus::PointsAway));
        assert_eq!(f.now_evidence[0].code, "recovered-unchanged");
        assert_eq!(f.now_evidence[0].args["what"], "windows-update");
        // Another update between the rough sessions and the recovered ones: noted, never a support.
        let d = with_report(base(), vec![before, update("2026-10-09T20:00:00Z", "KB5009999")]);
        let f = finding_of(&d, "windows-update");
        assert_eq!(f.now, Some(NowStatus::CantTell));
        assert_eq!(f.now_evidence[0].code, "recovered-changed-again");
        assert_eq!(f.now_evidence[0].args["count"], "1");
        // No Windows records at all: it says so.
        let d = run(base());
        assert!(d.findings.iter().all(|f| f.id != "windows-update"));
    }

    #[test]
    fn a_windows_build_that_stays_points_away_and_one_that_changed_again_is_noted() {
        let mk = |rec_build: &str| {
            let mut v: Vec<SessionFacts> = (1..=4).map(|d| on(d, 50.0, None)).collect();
            for s in v.iter_mut() {
                s.windows_build = Some("100".into());
            }
            let mut rough = on(9, 30.0, None);
            rough.windows_build = Some("101".into());
            v.push(rough);
            for day in [10, 11] {
                let mut rec = on(day, 50.0, None);
                rec.windows_build = Some(rec_build.into());
                v.push(rec);
            }
            with_report(v, Vec::new())
        };
        assert_eq!(now_of(&mk("101"), "windows-build-change"), (Some(NowStatus::PointsAway), vec!["recovered-build-same"]));
        let changed = mk("102");
        assert_eq!(now_of(&changed, "windows-build-change"), (Some(NowStatus::CantTell), vec!["recovered-build-changed"]));
        // A build change between the sessions is one of the recorded changes in the stretch.
        assert!(changed.recovery.as_ref().is_some_and(|r| r.also_changed.iter().any(|e| e.code == "gap-build")));
    }

    // ---- changes in the stretch between the rough sessions and the normal ones ----------------------
    #[test]
    fn a_game_update_in_the_stretch_is_a_candidate_in_its_own_right_and_stops_any_points_to_summary() {
        let d = with_report(with_extra(episode(), two(calm)), vec![game_update("2026-10-09T20:00:00Z")]);
        assert_eq!(d.state, DiagnosisState::Recovered, "{:?}", d.state);
        let f = finding_of(&d, "game-files-change");
        assert_eq!(f.now, Some(NowStatus::CantTell));
        assert_eq!(f.now_evidence[0].code, "recovered-changed-again");
        assert_eq!(f.now_evidence[0].args["what"], "game-files-change");
        assert_eq!(f.since_when, When::Exact { at: "2026-10-09T20:00:00Z".into() });
        let r = d.recovery.as_ref().expect("recovery");
        let line = r.also_changed.iter().find(|e| e.code == "gap-change").expect("a gap line");
        assert_eq!((line.args["kind"].as_str(), line.args["when"].as_str()), ("game-files", "2026-10-09T20:00:00Z"));
        assert!(!matches!(r.summary, RecoverySummary::PointsTo { .. }), "{:?}", r.summary);
        // Steam keeps only the newest change: nothing is said about an earlier one.
        assert!(d.not_it.iter().all(|n| n.id != "game-files-change"));
    }

    #[test]
    fn every_dated_change_in_the_stretch_is_its_own_line_and_the_summary_is_still_between() {
        let d = with_report(
            with_extra(episode(), two(|day| on(day, 50.0, Some("3.0")))),
            vec![gpu("2026-10-09T20:00:00Z", "2.0", "3.0"), update("2026-10-09T21:00:00Z", "KB5009999"), game_update("2026-10-10T08:00:00Z")],
        );
        let r = d.recovery.as_ref().expect("recovery");
        let kinds: Vec<&str> = r.also_changed.iter().filter(|e| e.code == "gap-change").map(|e| e.args["kind"].as_str()).collect();
        assert_eq!(kinds, ["gpu-driver", "windows-update", "game-files"]);
        match &r.summary {
            RecoverySummary::Between { ids } => {
                assert!(ids.contains(&"gpu-driver-change") && ids.contains(&"windows-update") && ids.contains(&"game-files-change"), "{ids:?}")
            }
            other => panic!("{other:?}"),
        }
        // A change before the last rough session ended is not in the stretch.
        let d = with_report(with_extra(episode(), two(calm)), vec![update("2026-10-09T10:05:00Z", "KB5001111")]);
        assert!(d.recovery.as_ref().is_some_and(|r| r.also_changed.iter().all(|e| e.code != "gap-change")));
    }

    #[test]
    fn records_that_were_not_read_completely_mean_no_points_to_summary() {
        let sess = || with_extra(episode(), two(|day| on(day, 50.0, Some("3.0"))));
        // Not read at all.
        let d = run(sess());
        let r = d.recovery.as_ref().expect("recovery");
        assert!(!matches!(r.summary, RecoverySummary::PointsTo { .. }), "{:?}", r.summary);
        assert!(r.also_changed.iter().any(|e| e.code == "gap-unread"));
        // Read completely, nothing else changed: the driver is the one that points to it.
        let d = with_report(sess(), Vec::new());
        assert_eq!(d.recovery.as_ref().map(|r| r.summary.clone()), Some(RecoverySummary::PointsTo { id: "gpu-driver-change" }));
        // One kind unreadable: not complete.
        let mut inp = inputs(sess());
        let mut rep = report(Vec::new());
        rep.unreadable.push(crate::change_sources::UnreadableSource {
            source: Source::WindowsUpdateLog,
            reason: crate::change_sources::UnreadableReason::AccessDenied,
        });
        inp.changes = ChangeRead::Report { report: Box::new(rep), steam: GameSteam::Found };
        let d = diagnose(&inp, Complaint::Slow, Some("g"));
        assert!(!matches!(d.recovery.as_ref().map(|r| r.summary.clone()), Some(RecoverySummary::PointsTo { .. })));
    }

    // ---- which game the card answers for ------------------------------------------------------------
    #[test]
    fn a_game_that_recovered_never_hides_a_game_that_is_still_rough() {
        // Game "g" recovered (its newest rough session is day 9). Game "h" is still rough, its newest rough
        // session older (day 8): the card answers for "h".
        let mut v = with_extra(episode(), two(calm));
        for d in 1..=4 {
            let mut s = facts(&at_day(d, 12), 600, 600, 100.0, 50.0);
            s.game = "h".into();
            s.gpu_driver = Some("1.0".into());
            v.push(s);
        }
        let mut rough = facts(&at_day(8, 12), 600, 600, 100.0, 30.0);
        rough.game = "h".into();
        rough.gpu_driver = Some("2.0".into());
        v.push(rough);
        let d = diagnose(&inputs(v.clone()), Complaint::Slow, None);
        assert_eq!(d.game.as_deref(), Some("h"), "{:?}", d.state);
        assert_eq!(d.state, DiagnosisState::Found);
        // Recovered still beats a game with nothing wrong.
        let mut ok = with_extra(episode(), two(calm));
        for d in 1..=5 {
            let mut s = facts(&at_day(d + 11, 12), 600, 600, 100.0, 50.0);
            s.game = "h".into();
            ok.push(s);
        }
        let d = diagnose(&inputs(ok), Complaint::Slow, None);
        assert_eq!(d.game.as_deref(), Some("g"));
        assert_eq!(d.state, DiagnosisState::Recovered);
    }

    // ---- every count says what it counts -------------------------------------------------------------
    #[test]
    fn programs_seen_starting_are_named_where_they_were_seen() {
        // This game's only rough session recorded NO starts; a partly measured one earlier did; another game's did.
        let mut v: Vec<SessionFacts> = (1..=4).map(|d| on(d, 50.0, Some("1.0"))).collect();
        let mut partial = on(8, 30.0, Some("2.0"));
        partial.duration_secs = 100;
        partial.samples = 80;
        partial.busy_starts = 9;
        partial.busy_names = vec!["rustc".into(), "cargo".into()];
        v.push(partial);
        v.push(on(9, 30.0, Some("2.0")));
        for d in 1..=4 {
            let mut s = facts(&at_day(d, 12), 600, 600, 100.0, 50.0);
            s.game = "h".into();
            v.push(s);
        }
        let mut other = facts(&at_day(9, 12), 600, 600, 100.0, 30.0);
        other.game = "h".into();
        other.busy_starts = 9;
        other.busy_names = vec!["link".into()];
        v.push(other);
        let d = run(v);
        assert_eq!(d.state, DiagnosisState::Found, "{:?}", d.state);
        let f = finding_of(&d, "background-load");
        let codes: Vec<&str> = f.evidence.iter().map(|e| e.code).collect();
        assert!(!codes.contains(&"starts-seen"), "no start was recorded in this game's fully measured rough sessions: {codes:?}");
        let partial_line = f.evidence.iter().find(|e| e.code == "starts-seen-partial").expect("the partly measured session");
        assert_eq!(partial_line.args["names"], "cargo, rustc");
        assert_eq!(partial_line.args["date"], at_day(8, 10));
        let other_line = f.evidence.iter().find(|e| e.code == "starts-seen-other").expect("the other game's rough session");
        assert_eq!((other_line.args["count"].as_str(), other_line.args["names"].as_str()), ("1", "link"));
        assert!(!other_line.args["otherGame"].is_empty());
        // Weaker support: it ranks below the driver, and its chip is Possible.
        assert_eq!(f.confidence, Certainty::Possible);
        let pos = |id: &str| d.findings.iter().position(|x| x.id == id).expect(id);
        assert!(pos("gpu-driver-change") < pos("background-load"), "{:?}", ids(&d));
    }

    #[test]
    fn programs_seen_in_this_games_rough_sessions_are_counted_with_their_names() {
        let d = run(busy_episode(None));
        let f = finding_of(&d, "background-load");
        let line = f.evidence.iter().find(|e| e.code == "starts-seen").expect("this game's rough session");
        assert_eq!((line.args["count"].as_str(), line.args["names"].as_str()), ("1", "rustc"));
        assert!(f.evidence.iter().all(|e| e.code != "starts-seen-partial" && e.code != "starts-seen-other"));
    }

    // ---- the owner's real sessions, with synthetic future sessions built here -----------------------
    #[test]
    fn the_owners_incident_then_two_quiet_normal_sessions_reads_as_a_one_sided_recovery() {
        let full = fixture();
        let d0 = diagnose(&full, Complaint::Unknown, Some(ROUGH_GAME));
        assert_eq!(d0.state, DiagnosisState::Found, "{:?}", d0.state);
        let med = d0.problem.as_ref().expect("problem").before.ratio;
        let newest_rough = full
            .sessions
            .iter()
            .filter(|s| same_game(&s.game, ROUGH_GAME))
            .max_by_key(|s| s.start())
            .expect("a session")
            .clone();
        let mut inp = full.clone();
        for (i, at) in ["2026-11-21T10:00:00Z", "2026-11-22T10:00:00Z"].iter().enumerate() {
            let mut rec = newest_rough.clone();
            rec.started_at = (*at).into();
            rec.duration_secs = 3600;
            rec.samples = 3600;
            rec.background_secs = 0;
            rec.avg_fps = 200.0;
            rec.low1_fps = 200.0 * (med + 0.01);
            rec.p99_ms = None;
            rec.busy_starts = 0;
            rec.busy_names = Vec::new();
            rec.started_names = Vec::new();
            rec.other_cpu_p90_pct = Some(3.0 + i as f64);
            rec.peak_ram_bytes = Some(21_500_000_000);
            rec.ram_events = 0;
            inp.sessions.push(rec);
        }
        let d = diagnose(&inp, Complaint::Unknown, Some(ROUGH_GAME));
        assert_eq!(d.state, DiagnosisState::Recovered, "{:?}", d.state);
        // The recovered sessions ran on the same driver stamp as the rough ones: that weakens the driver.
        assert_eq!(finding_of(&d, "gpu-driver-change").now, Some(NowStatus::PointsAway));
        // The rough sessions have no load numbers: the quiet recovery cannot point to background programs.
        let bg = finding_of(&d, "background-load");
        assert_eq!(bg.now, Some(NowStatus::CantTell));
        assert!(bg.now_evidence.iter().any(|e| e.code == "rough-load-not-recorded"));
        assert!(!matches!(d.recovery.as_ref().map(|r| r.summary.clone()), Some(RecoverySummary::PointsTo { .. })));
        // Never "known" or "measured", and never more certain than before the recovery.
        assert!(d.findings.iter().all(|f| !matches!(f.confidence, Certainty::Known | Certainty::Measured | Certainty::Likely)));
    }

    // ---- the wire shape, the single flight, the Steam bound ----------------------------------------
    #[test]
    fn the_recovered_wire_shape_is_what_the_card_reads() {
        let d = with_report(with_extra(episode(), two(|day| on(day, 50.0, Some("3.0")))), Vec::new());
        let v = serde_json::to_value(&d).expect("serialises");
        assert_eq!(v["state"]["kind"], "recovered");
        assert_eq!(v["recovery"]["summary"]["kind"], "points-to");
        assert_eq!(v["recovery"]["recovered_sessions"].as_array().map(Vec::len), Some(2));
        assert!(v["recovery"].get("at_or_above_median").is_none());
        let f = v["findings"].as_array().and_then(|a| a.iter().find(|f| f["id"] == "gpu-driver-change")).expect("driver");
        assert_eq!(f["now"], "points-to");
        assert_eq!(f["now_evidence"][0]["kind"], "supported-inference");
        assert!(v["problem"]["last_full_normal_at"].is_string());
        let unclear = serde_json::to_value(run(with_extra(episode(), vec![on(10, 46.0, Some("2.0"))]))).expect("serialises");
        assert_eq!(unclear["state"]["why"]["kind"], "recovery-unclear");
        assert_eq!(unclear["state"]["why"]["partial"], false);
        assert_eq!(unclear["state"]["why"]["one_clear"], true);
        assert_eq!(unclear["state"]["why"]["cap_changed"], false);
    }

    #[test]
    fn a_second_diagnosis_while_one_is_running_gets_busy_not_a_second_set_of_readers() {
        let first = FlightGuard::begin().expect("the first call starts");
        assert!(FlightGuard::begin().is_none(), "a second call while one is in flight is refused");
        assert_eq!(BUSY, "paramedic-busy");
        drop(first);
        let again = FlightGuard::begin();
        assert!(again.is_some(), "the slot is free once the first call is done");
    }

    #[test]
    fn a_steam_lookup_on_a_drive_that_never_answers_gives_up_instead_of_hanging() {
        use crate::change_sources::{run_bounded, SteamLookup, STEAM_DIR_ENTRY_CAP, STEAM_HARD_MARGIN};
        assert_eq!(STEAM_DIR_ENTRY_CAP, 5000);
        assert_eq!(STEAM_HARD_MARGIN, std::time::Duration::from_millis(250));
        let t = std::time::Instant::now();
        let got = run_bounded(std::time::Duration::from_millis(100), || {
            std::thread::sleep(std::time::Duration::from_secs(5));
            SteamLookup::NotInSteam
        });
        assert_eq!(got, SteamLookup::NotInSteam);
        assert!(t.elapsed() < std::time::Duration::from_secs(2), "took {:?}", t.elapsed());
        // A lookup that answers in time is returned as it is.
        let quick = run_bounded(std::time::Duration::from_millis(500), || SteamLookup::Unreadable(crate::change_sources::UnreadableReason::SteamUnreadable));
        assert!(matches!(quick, SteamLookup::Unreadable(_)));
    }
}
