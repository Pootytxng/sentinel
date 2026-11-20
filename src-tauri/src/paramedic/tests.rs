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
fn ranks_driver_first_with_background_and_memory_as_also_possible() {
    let d = diagnose(&fixture(), Complaint::WasFineBefore, Some(ROUGH_GAME));
    assert_eq!(d.state, DiagnosisState::Found);
    assert_eq!(ids(&d), ["gpu-driver-change", "background-load", "memory-pressure", "setting-drift"]);
    assert_eq!(certainties(&d), [Certainty::Likely, Certainty::Possible, Certainty::Possible, Certainty::Possible]);
    assert_eq!(d.baseline.as_ref().expect("baseline").started_at, "2026-11-11T14:14:22Z");
    assert_eq!(d.first_bad.as_ref().expect("first bad").started_at, "2026-11-20T01:01:24Z");
    assert_eq!(d.why_first, Some("cross-game"));
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
    assert_eq!(codes, ["driver-changed", "sessions-split", "cross-game", "install-time-not-read"]);
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
    // Memory and background are weakened by the rough sessions that lack them.
    assert!(d.findings[1].evidence.iter().any(|e| e.against && e.code == "starts-absent"));
    assert!(d.findings[2].evidence.iter().any(|e| e.against && e.code == "ram-lower"));
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
    assert_eq!(ids(&d), ["gpu-driver-change", "background-load", "memory-pressure", "setting-drift"]);
    assert_eq!(d.findings[0].confidence, Certainty::Likely);
    assert_eq!(d.problem.as_ref().expect("problem").sessions_affected.len(), 1);
    assert_eq!(d.why_first, None, "the cross-game support only exists once the second game gets rough");
}

#[test]
fn the_second_game_gets_the_same_top_finding() {
    let d = diagnose(&fixture(), Complaint::Slow, Some(SECOND_GAME));
    assert_eq!(d.state, DiagnosisState::Found);
    assert_eq!(d.findings[0].id, "gpu-driver-change");
    assert_eq!(d.findings[0].confidence, Certainty::Likely);
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
    assert_eq!(d.state, DiagnosisState::NothingWrong { sessions_checked: 1 }, "judged on the last full session");
    // Alone, it is not judged at all.
    let only = inputs(vec![facts("2026-10-09T10:00:00Z", 467, 90, 139.7, 24.3)]);
    let d = diagnose(&only, Complaint::Slow, Some("g"));
    assert_eq!(d.state, DiagnosisState::CantTell { why: CantTellWhy::PartialMeasure { percent: 19 } });
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
fn a_changed_driver_with_no_cross_game_support_is_likely_on_its_own() {
    let mut sess = steady(4);
    for s in sess.iter_mut() {
        s.gpu_driver = Some("1.0".into());
    }
    let mut rough = facts("2026-10-09T10:00:00Z", 600, 600, 100.0, 30.0);
    rough.gpu_driver = Some("2.0".into());
    sess.push(rough);
    let d = diagnose(&inputs(sess), Complaint::Slow, Some("g"));
    assert_eq!(ids(&d), ["gpu-driver-change"]);
    assert_eq!(d.findings[0].confidence, Certainty::Likely);
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
fn two_changes_that_line_up_equally_are_a_tie() {
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
    assert_eq!(d.why_first, Some("tie"));
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
    assert_eq!(v["findings"][0]["confidence"], "likely");
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
