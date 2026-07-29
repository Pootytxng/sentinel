import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { Card, StatusPill, SectionHeader } from "../design";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";
import { Term } from "../design/Term";
import { WhatsThis } from "../design/WhatsThis";
import { useLibrary } from "./library-context";
import { useProfile } from "../hooks/use-profile";
import { PROFILE_META, USE_PROFILES } from "../data/profile-store";
import { recDisplayLabel } from "../data/friendly-labels";
import {
  changeAttribution,
  changesBetweenRuns,
  componentLabel,
  verdictLabel,
  verdictTone,
  fmtDelta,
  trialVerdictLabel,
  trialVerdictTone,
  trialReasonText,
  benchRigTier,
  fmtLocalWinTopPct,
  fmtLocalWinPercentile,
} from "./benchmark-view";
import { useExpertView } from "../design/use-expert-view";
import { readTwoFutures } from "../design/theme";
import { TwoFutures } from "./TwoFutures";
import type { HardwareInfo } from "../App";
import type {
  BenchmarkState,
  RunReport,
  Efficacy,
  AppliedChange,
  TrialState,
  ScoreboardView,
} from "../types";
import "./Benchmark.css";

const POLL_MS = 700;

// Measured-efficacy loop: run a benchmark → change something → re-measure → an honest
// "did it actually help?" verdict. Absolute scores are rough (placeholder references); the
// real signal is the comparison vs your saved baseline, which is reference-independent.
export function BenchmarkTab({ provingGround = false }: { provingGround?: boolean } = {}) {
  const { t } = useTranslation();
  const [state, setState] = useState<BenchmarkState | null>(null);
  const [changes, setChanges] = useState<AppliedChange[]>([]);
  const [trial, setTrial] = useState<TrialState | null>(null);
  const [tweaks, setTweaks] = useState<{ id: string; title: string }[]>([]);
  const [selectedTweak, setSelectedTweak] = useState<string>("");
  const { openLibrary } = useLibrary();
  const [score, setScore] = useState<ScoreboardView | null>(null);
  const [arcade, setArcade] = useState<boolean>(
    () => localStorage.getItem("compy_score_face") === "arcade",
  );
  // Award drill-down: which award's full certified receipt is expanded (its list key, or null).
  const [openAward, setOpenAward] = useState<string | null>(null);
  // Expert view (spec 2026-07-11-expert-layer-middle-ground §2): the receipt shows the TRUE local
  // percentile instead of the rounded "Top N%" bucket. Same already-computed value, display only.
  const expert = useExpertView();
  // A2 hardware-tier segmentation — the rough, transparent rig class (Entry/Mid/High) the
  // measurements are read against. Reuses the canonical rig-tier bands; LOCAL only, no cohort.
  const [rigTier, setRigTier] = useState<ReturnType<typeof benchRigTier>>(null);
  // Two Futures split (compy_two_futures, DEFAULT OFF) — read once per mount, the flag idiom
  // (Settings lives on another surface; navigating back remounts this one).
  const [twoFutures] = useState(readTwoFutures);
  const [hw, setHw] = useState<HardwareInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Inline dependency (wayfinding §2): the live-game measurement needs FPS monitoring, which used to
  // live only on another page. Track it here + offer [Start monitoring] right on the card.
  const [fpsActive, setFpsActive] = useState<boolean | null>(null);
  const [fpsBusy, setFpsBusy] = useState(false);
  // A4 use-case profile — a LOCAL, advisory context tag (Gaming/Streaming/Creation/General). Picking
  // one only frames what you're measuring; it changes NO Windows setting, applies no tweak, arms
  // nothing. localStorage-only, reversible, on this PC. (See src/data/profile-store.ts.)
  const { profile, setProfile } = useProfile();

  // Measurable tweaks = appliable recs not currently applied (so a trial can apply→measure→undo).
  useEffect(() => {
    (async () => {
      try {
        const [recs, appliable] = await Promise.all([
          invoke<{ id: string; title: string; currently_applied: boolean }[]>("get_recommendations"),
          invoke<string[]>("get_appliable_rec_ids"),
        ]);
        const ok = new Set(appliable);
        const measurable = recs
          .filter((r) => ok.has(r.id) && !r.currently_applied)
          .map((r) => ({ id: r.id, title: r.title }));
        setTweaks(measurable);
        setSelectedTweak((cur) => cur || measurable[0]?.id || "");
      } catch {
        /* ignore — no picker */
      }
    })();
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [s, ch, t, sb] = await Promise.all([
        invoke<BenchmarkState>("get_benchmark_state"),
        invoke<AppliedChange[]>("get_applied_changes").catch(() => [] as AppliedChange[]),
        invoke<TrialState>("get_trial_state").catch(() => null),
        invoke<ScoreboardView>("get_scoreboard").catch(() => null),
      ]);
      setState(s);
      setChanges(ch);
      if (t) setTrial(t);
      if (sb) setScore(sb);
    } catch {
      /* leave prior state */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Read the rig's measured specs once: the tier band uses three fields (max VRAM · physical
  // cores · total RAM); the full struct also feeds the Two Futures rigs when that flag is on.
  // Existing read-only command either way.
  useEffect(() => {
    invoke<HardwareInfo>("get_hardware_info")
      .then((h) => {
        setHw(h);
        setRigTier(benchRigTier(h));
      })
      .catch(() => {
        /* no tier band / no split rig if hardware is unreadable — never fabricated */
      });
  }, []);

  // Poll FPS-monitoring state so the live-game card can offer to start it inline (wayfinding §2).
  useEffect(() => {
    let cancelled = false;
    const tick = () =>
      invoke<{ active: boolean }>("get_fps_status")
        .then((f) => !cancelled && setFpsActive(f.active))
        .catch(() => {});
    tick();
    const id = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  // Same command + UAC flow as Play's capture toggle — no trip to another page. The next poll
  // reflects the result (incl. a cancelled UAC, which leaves monitoring off).
  const startMonitoring = async () => {
    setFpsBusy(true);
    try {
      await invoke("start_fps_capture");
    } catch {
      /* surfaced via the next poll */
    } finally {
      setFpsBusy(false);
    }
  };

  // Poll only while a run is in flight.
  useEffect(() => {
    if (!state?.running) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [state?.running, refresh]);

  // Poll while a live trial (calibration) is running.
  useEffect(() => {
    if (!trial?.running) return;
    const id = setInterval(refresh, POLL_MS);
    return () => clearInterval(id);
  }, [trial?.running, refresh]);

  const calibrate = async () => {
    try {
      await invoke("start_calibration");
    } catch {
      /* surfaced via trial state */
    }
    refresh();
  };

  const cancelTrial = async () => {
    try {
      await invoke("cancel_trial");
    } catch {
      /* ignore */
    }
    refresh();
  };

  const measureTweak = async () => {
    const t = tweaks.find((x) => x.id === selectedTweak);
    if (!t) return;
    try {
      await invoke("start_tweak_trial", { recId: t.id, recTitle: t.title });
    } catch {
      /* surfaced via trial state */
    }
    refresh();
  };

  const toggleFace = () => {
    setArcade((a) => {
      const next = !a;
      localStorage.setItem("compy_score_face", next ? "arcade" : "lab");
      return next;
    });
  };

  const clearScore = async () => {
    try {
      await invoke("clear_scoreboard");
      await refresh();
    } catch {
      /* ignore */
    }
  };

  const run = async () => {
    setErr(null);
    try {
      await invoke("start_benchmark");
    } catch (e) {
      setErr(String(e));
    }
    refresh();
  };

  const cancel = async () => {
    try {
      await invoke("cancel_benchmark");
    } catch {
      /* ignore */
    }
    refresh();
  };

  const setBaseline = async () => {
    setBusy(true);
    setErr(null);
    try {
      await invoke("set_benchmark_baseline");
      await refresh();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const clearBaseline = async () => {
    setBusy(true);
    try {
      await invoke("clear_benchmark_baseline");
      await refresh();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const running = state?.running ?? false;
  const hasBaseline = !!state?.baseline;
  // Efficacy is meaningful once a run happened AFTER the baseline was set.
  const showEfficacy =
    !!state?.efficacy && hasBaseline && !!state?.latest && state.latest_at !== state.baseline_at;

  // Compy changes (Trust Ledger) applied between the baseline and the latest run — the "Change"
  // the verdict is attributing the measured delta to. Shared window filter so every attributing
  // surface (this card, Two Futures, the Lab verdict) agrees on what a result covers.
  const changesSince = changesBetweenRuns(state, changes);

  return (
    <div className="bench-wrap">
      <header className="bench-head">
        <h2>{t("gaming.benchmark.heading")}</h2>
        <p className="bench-muted">{t("gaming.benchmark.heroBlurb")}</p>
      </header>

      {rigTier && (
        <div className={`bench-tier bench-tier-${rigTier.tier.toLowerCase()}`} role="note">
          <div className="bench-tier-line">
            <span className="bench-tier-label">{t("gaming.benchmark.rigTierLabel")}</span>
            <span className="bench-tier-value">{rigTier.tier}</span>
            <span className="bench-tier-basis">{rigTier.basis}</span>
          </div>
          <p className="bench-tier-note">{t("gaming.benchmark.rigTierNote")}</p>
        </div>
      )}

      <Card>
        <SectionHeader title={t("gaming.benchmark.useCaseSectionTitle")} />
        <p className="bench-muted">{t("gaming.benchmark.useCaseBlurb")}</p>
        <div className="bench-tweak-pick">
          <select
            className="bench-select"
            aria-label={t("gaming.benchmark.useCaseSelectAriaLabel")}
            value={profile}
            onChange={(e) => setProfile(e.target.value as (typeof USE_PROFILES)[number])}
          >
            {USE_PROFILES.map((p) => (
              <option key={p} value={p}>
                {t(`gaming.benchmark.useCaseProfiles.${p}.label`, PROFILE_META[p].label)}
              </option>
            ))}
          </select>
        </div>
        <p className="bench-fine">
          {t(`gaming.benchmark.useCaseProfiles.${profile}.blurb`, PROFILE_META[profile].blurb)}
        </p>
      </Card>

      <div className="bench-actions">
        <button className="bench-btn bench-btn-primary" onClick={run} disabled={running}>
          {running
            ? t("gaming.benchmark.measuringButton")
            : hasBaseline
              ? t("gaming.benchmark.remeasureButton")
              : t("gaming.benchmark.runBenchmarkButton")}
        </button>
        {running && (
          <button className="bench-btn bench-btn-ghost" onClick={cancel}>
            {t("gaming.benchmark.cancelButton")}
          </button>
        )}
        {err && <span className="bench-err">{err}</span>}
        {!err && state?.error && <span className="bench-err">{state.error}</span>}
      </div>

      {/* Two Futures SUBSUMES the efficacy card when the flag is on (self-review catch: same
          overall pill + the same 4 delta/verdict rows would render twice adjacently) — it
          carries the full readout plus before/after values, the split rigs, and the change
          attribution. Flag off renders today's card unchanged. */}
      {showEfficacy && state?.efficacy && !twoFutures && !provingGround && (
        <EfficacyCard efficacy={state.efficacy} changes={changesSince} />
      )}

      {/* Two Futures measured split — where the efficacy readout lives (spec placement).
          Flag DEFAULT OFF; with it on, the component itself enforces the one law (no measured
          pair → honest empty state, no 3D). In the merged proving ground (spec 2026-07-08 §2)
          the split IS the loop's "prove it" payoff — the changed rig part emphasized by its real
          per-component efficacy (partGlow) — so it renders regardless of the standalone flag. The
          one law still holds: no measured pair → the honest empty state, no fabricated trophy. */}
      {(twoFutures || provingGround) && <TwoFutures bench={state} hw={hw} changes={changesSince} />}

      {state?.latest && (
        <RunCard
          report={state.latest}
          at={state.latest_at}
          title={hasBaseline && !showEfficacy ? t("gaming.benchmark.baselineLabel") : t("gaming.benchmark.latestRunLabel")}
        />
      )}

      <Card>
        <SectionHeader title={t("gaming.benchmark.baselineLabel")} />
        {hasBaseline ? (
          <>
            <p className="bench-muted">
              {t("gaming.benchmark.baselineSavedPrefix")}
              {state?.baseline_at ? ` · ${fmtWhen(state.baseline_at)}` : ""}
              {". "}
              {t("gaming.benchmark.baselineSavedPre")}{" "}
              <strong>{t("gaming.benchmark.measureThisTweakButton")}</strong>{" "}
              {t("gaming.benchmark.baselineSavedMid")}{" "}
              <strong>{t("gaming.benchmark.remeasureButton")}</strong>{" "}
              {t("gaming.benchmark.baselineSavedPost")}
            </p>
            <button className="bench-btn bench-btn-ghost" onClick={clearBaseline} disabled={busy || running}>
              {t("gaming.benchmark.clearBaselineButton")}
            </button>
          </>
        ) : (
          <>
            <p className="bench-muted">{t("gaming.benchmark.noBaselineBlurb")}</p>
            <button
              className="bench-btn"
              onClick={setBaseline}
              disabled={busy || running || !state?.latest}
            >
              {t("gaming.benchmark.setBaselineButton")}
            </button>
          </>
        )}
      </Card>

      <Card>
        <SectionHeader
          title={t("gaming.benchmark.liveGameSectionTitle")}
          right={
            trial?.running ? (
              <StatusPill status="scanning" label={t("gaming.benchmark.measuringPillLabel")} />
            ) : undefined
          }
        />
        <p className="bench-muted">
          {t("gaming.benchmark.calibratePre")}{" "}
          <Term id="noise-floor">{t("gaming.benchmark.calibrateTerm1")}</Term> {t("gaming.benchmark.calibrateMid1")}{" "}
          <Term id="frametime">{t("gaming.benchmark.calibrateTerm2")}</Term> (
          <Term id="one-percent-lows">{t("gaming.benchmark.calibrateTerm3")}</Term>). {t("gaming.benchmark.calibratePost")}
        </p>
        {/* Inline dependency (wayfinding §2) — start monitoring right here; no trip to another page. */}
        {fpsActive === false && (
          <div className="bench-dep">
            <span className="bench-dep-msg">{t("gaming.benchmark.fpsMonitoringOffMsg")}</span>
            <button className="bench-btn" onClick={startMonitoring} disabled={fpsBusy}>
              {fpsBusy ? t("gaming.benchmark.startingMonitoringEllipsis") : t("gaming.benchmark.startMonitoringButton")}
            </button>
          </div>
        )}
        {fpsActive === true && <p className="bench-fine">{t("gaming.benchmark.fpsMonitoringOnMsg")}</p>}
        {trial?.running ? (
          <>
            <p className="bench-stat">
              {trial.status}
              {trial.target ? ` · ${trial.collected}/${trial.target}` : ""}
            </p>
            <button className="bench-btn bench-btn-ghost" onClick={cancelTrial}>
              {t("gaming.benchmark.cancelButton")}
            </button>
          </>
        ) : (
          <>
            <button className="bench-btn" onClick={calibrate} disabled={fpsActive === false}>
              {t("gaming.benchmark.calibrateButton")}
            </button>
            {tweaks.length > 0 && (
              <div className="bench-tweak-pick">
                <select
                  className="bench-select"
                  value={selectedTweak}
                  onChange={(e) => setSelectedTweak(e.target.value)}
                >
                  {/* An <option> can't carry the quiet tech tag, so the picker shows the headline
                      only — the same name the user read on the card they want to measure. */}
                  {tweaks.map((tw) => (
                    <option key={tw.id} value={tw.id}>
                      {recDisplayLabel(tw.id, tw.title).headline}
                    </option>
                  ))}
                </select>
                <button
                  className="bench-btn"
                  onClick={measureTweak}
                  disabled={!selectedTweak || fpsActive === false}
                >
                  {t("gaming.benchmark.measureThisTweakButton")}
                </button>
                {/* Quiet "What's this?" for the picked tweak — opens its Blackbook entry; self-hides
                    when the tweak has no entry (no dead links), same as Fix rows. */}
                <WhatsThis id={selectedTweak} onOpen={openLibrary} />
              </div>
            )}
            <p className="bench-fine">{t("gaming.benchmark.measureTweakExplainer")}</p>
          </>
        )}

        {!trial?.running && trial?.kind === "calibration" && trial?.noise_floor_pct != null && (
          <p className="bench-stat">
            {t("gaming.benchmark.runToRunNoiseLabel")} <strong>±{trial.noise_floor_pct.toFixed(1)}%</strong>
            {trial.verdict &&
            trial.verdict.verdict === "inconclusive" &&
            trial.verdict.reason === "within-noise"
              ? ` ${t("gaming.benchmark.pipelineCheckPassed")}`
              : ""}
          </p>
        )}

        {!trial?.running && trial?.kind === "tweak" && trial?.verdict && (
          <p className="bench-stat">
            <StatusPill
              status={trialVerdictTone(trial.verdict)}
              label={trialVerdictLabel(trial.verdict, t)}
            />{" "}
            {trial.verdict.verdict === "inconclusive" ? (
              <>— {trialReasonText(trial.verdict.reason, t)}.</>
            ) : (
              <>
                — {trial.verdict.metric} {fmtDelta(trial.verdict.effect_pct)} ({t("gaming.benchmark.ciLabel")}{" "}
                {fmtDelta(trial.verdict.ci_lo_pct)}…{fmtDelta(trial.verdict.ci_hi_pct)}).
              </>
            )}
            {trial.rolled_back && (
              <span className="bench-fine"> {t("gaming.benchmark.changeRolledBack")}</span>
            )}
          </p>
        )}

        {!trial?.running && trial?.error && <p className="bench-err">{trial.error}</p>}
      </Card>

      <Card>
        <SectionHeader
          title={t("gaming.benchmark.scoreSectionTitle")}
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {score && score.total_points > 0 && (
                <span className="bench-score-total">
                  {t("gaming.benchmark.pointsSuffix", { points: score.total_points })}
                </span>
              )}
              <button className="bench-btn bench-btn-ghost" onClick={toggleFace}>
                {arcade ? t("gaming.benchmark.labViewButton") : t("gaming.benchmark.arcadeViewButton")}
              </button>
            </div>
          }
        />
        {!score || score.awards.length === 0 ? (
          <p className="bench-muted">{t("gaming.benchmark.noWinsBlurb")}</p>
        ) : (
          <>
            <ul className="bench-awards">
              {score.awards.map((a, i) => {
                const key = `${a.rec_id}-${a.at}-${i}`;
                const open = openAward === key;
                // A2 LOCAL percentile stub — this win's standing among the user's OWN wins (no
                // peer cohort yet). Defensive read so a missing/stale field never throws.
                // Expert view swaps the rounded "Top N%" bucket for the true percentile (§2).
                const localTopPct = expert
                  ? fmtLocalWinPercentile(score.local_percentiles?.[i], t)
                  : fmtLocalWinTopPct(score.local_percentiles?.[i], t);
                return (
                  <li key={key} className="bench-award">
                    <button
                      type="button"
                      className="bench-award-row"
                      aria-expanded={open}
                      onClick={() => setOpenAward(open ? null : key)}
                    >
                      {arcade ? (
                        <span>
                          <strong className="bench-award-pts">+{a.points}</strong> · {a.rec_title}{" "}
                          {t("gaming.benchmark.awardArcadeBoost", {
                            metric: a.metric,
                            delta: fmtDelta(a.effect_pct),
                          })}
                        </span>
                      ) : (
                        <span>
                          <strong>{a.rec_title}</strong> — {a.metric} {fmtDelta(a.effect_pct)} (
                          {t("gaming.benchmark.ciLabel")}{" "}
                          {fmtDelta(a.ci_lo_pct)}…{fmtDelta(a.ci_hi_pct)}) ·{" "}
                          {t("gaming.benchmark.pointsSuffix", { points: a.points })} ·{" "}
                          {fmtWhen(a.at)}
                        </span>
                      )}
                      <span className="bench-award-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
                    </button>
                    {open && (
                      <div className="bench-award-detail">
                        <span className="bench-award-eyebrow">{t("gaming.benchmark.certifiedReceiptLabel")}</span>
                        <dl className="bench-award-rows">
                          <div>
                            <dt>{t("gaming.benchmark.tweakLabel")}</dt>
                            <dd>{a.rec_title}</dd>
                          </div>
                          <div>
                            <dt>{t("gaming.benchmark.tweakIdLabel")}</dt>
                            <dd className="bench-award-mono">{a.rec_id}</dd>
                          </div>
                          <div>
                            <dt>{t("gaming.benchmark.certifiedMetricLabel")}</dt>
                            <dd>{a.metric}</dd>
                          </div>
                          <div>
                            <dt>{t("gaming.benchmark.measuredEffectLabel")}</dt>
                            <dd>
                              {fmtDelta(a.effect_pct)}{" "}
                              <span className="bench-award-ci">
                                {t("gaming.benchmark.ciLabel")} {fmtDelta(a.ci_lo_pct)}…{fmtDelta(a.ci_hi_pct)}
                              </span>
                            </dd>
                          </div>
                          {localTopPct && (
                            <div>
                              <dt>{t("gaming.benchmark.amongYourWinsLabel")}</dt>
                              <dd>
                                {localTopPct}{" "}
                                <span className="bench-award-ci">
                                  {t("gaming.benchmark.localNoPeerCohort")}
                                </span>
                              </dd>
                            </div>
                          )}
                          <div>
                            <dt>{t("gaming.benchmark.pointsLabel")}</dt>
                            <dd>+{a.points}</dd>
                          </div>
                          <div>
                            <dt>{t("gaming.benchmark.recordedLabel")}</dt>
                            <dd>{fmtWhen(a.at)}</dd>
                          </div>
                        </dl>
                        <p className="bench-award-trace">{t("gaming.benchmark.awardTraceNote")}</p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <button className="bench-btn bench-btn-ghost" onClick={clearScore}>
              {t("gaming.benchmark.clearScoreboardButton")}
            </button>
          </>
        )}
        <p className="bench-fine">{t("gaming.benchmark.pointsTraceNote")}</p>
      </Card>

      <ol className="bench-steps">
        <li>{t("gaming.benchmark.step1")}</li>
        <li>{t("gaming.benchmark.step2")}</li>
        <li>{t("gaming.benchmark.step3")}</li>
      </ol>
    </div>
  );
}

function RunCard({ report, at, title }: { report: RunReport; at: string | null; title: string }) {
  const { t } = useTranslation();
  return (
    <Card>
      <SectionHeader
        title={title}
        right={
          <StatusPill
            status={report.confidence === "clean" ? "ready" : "info"}
            label={report.confidence === "clean" ? t("gaming.benchmark.cleanRun") : t("gaming.benchmark.noisyRun")}
          />
        }
      />
      <div className="bench-bars">
        {report.components.map((c) => (
          <div className="bench-bar-row" key={c.component}>
            <span className="bench-bar-label">{componentLabel(c.component, t)}</span>
            {c.measured ? (
              <>
                <span className="bench-bar-track">
                  <span className="bench-bar-fill" style={{ width: `${Math.min(c.score, 100)}%` }} />
                </span>
                <span className="bench-bar-val">{c.score}</span>
              </>
            ) : (
              <span className="bench-bar-na">{t("gaming.benchmark.notMeasured")}</span>
            )}
          </div>
        ))}
      </div>
      <p className="bench-fine">
        {t("gaming.benchmark.scoresRelativeNote")}
        {at ? ` · ${fmtWhen(at)}` : ""}
      </p>
      {report.notes.map((n) => (
        <p className="bench-note" key={n}>
          {n}
        </p>
      ))}
    </Card>
  );
}

function EfficacyCard({ efficacy, changes }: { efficacy: Efficacy; changes: AppliedChange[] }) {
  const { t } = useTranslation();
  const attr = changeAttribution(changes.length, t);
  return (
    <Card>
      <SectionHeader
        title={t("gaming.benchmark.sinceBaselineTitle")}
        right={
          <StatusPill status={verdictTone(efficacy.overall)} label={verdictLabel(efficacy.overall, t)} />
        }
      />
      <p className="bench-change">
        {changes.length > 0 ? (
          <>
            {attr.lead} <strong>{changes.map((c) => c.rec_title).join(", ")}</strong>.
            {attr.caveat ? ` ${attr.caveat}` : ""}
          </>
        ) : (
          <>{t("gaming.benchmark.noChangesRecorded")}</>
        )}
      </p>
      <div className="bench-eff">
        {efficacy.per_component.map((c) => (
          <div className="bench-eff-row" key={c.component}>
            <span className="bench-eff-label">{componentLabel(c.component, t)}</span>
            <span className={`bench-eff-delta is-${verdictTone(c.verdict)}`}>{fmtDelta(c.delta_pct)}</span>
            <StatusPill status={verdictTone(c.verdict)} label={verdictLabel(c.verdict, t)} />
          </div>
        ))}
      </div>
      <p className="bench-fine">
        {t("gaming.benchmark.noiseFloorNote", { pct: efficacy.noise_floor_pct })}
      </p>
    </Card>
  );
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
