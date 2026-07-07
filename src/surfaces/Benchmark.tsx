import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card, StatusPill, SectionHeader } from "../design";
import { Term } from "../design/Term";
import { WhatsThis } from "../design/WhatsThis";
import { useLibrary } from "./library-context";
import { useProfile } from "../hooks/use-profile";
import { PROFILE_META, USE_PROFILES } from "../data/profile-store";
import {
  componentLabel,
  verdictLabel,
  verdictTone,
  fmtDelta,
  trialVerdictLabel,
  trialVerdictTone,
  trialReasonText,
  benchRigTier,
  fmtLocalWinTopPct,
} from "./benchmark-view";
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
export function BenchmarkTab() {
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
  // the verdict is attributing the measured delta to.
  const changesSince =
    state?.baseline_at && state?.latest_at
      ? changes.filter((c) => {
          const t = Date.parse(c.applied_at);
          return (
            !Number.isNaN(t) &&
            t > Date.parse(state.baseline_at!) &&
            t <= Date.parse(state.latest_at!)
          );
        })
      : [];

  return (
    <div className="bench-wrap">
      <header className="bench-head">
        <h2>Benchmark</h2>
        <p className="bench-muted">
          Measure your PC, change something, then re-measure — Compy tells you honestly whether it
          actually helped. A change smaller than the run-to-run noise reads as “no measurable change,”
          not a win.
        </p>
      </header>

      {rigTier && (
        <div className={`bench-tier bench-tier-${rigTier.tier.toLowerCase()}`} role="note">
          <div className="bench-tier-line">
            <span className="bench-tier-label">Your rig tier</span>
            <span className="bench-tier-value">{rigTier.tier}</span>
            <span className="bench-tier-basis">{rigTier.basis}</span>
          </div>
          <p className="bench-tier-note">
            Compy measures against your own rig — scores and verdicts are relative to your saved
            baseline, not a universal grade. Your tier (rough, from the specs above) keeps any
            comparison like-to-like: same-class rigs only, never a cross-tier ranking.
          </p>
        </div>
      )}

      <Card>
        <SectionHeader title="What you mostly do" />
        <p className="bench-muted">
          Tell Compy your main use — it frames what these measurements mean for you. This is just a
          label saved on this PC: it doesn’t change a single Windows setting, apply a tweak, or touch
          any service.
        </p>
        <div className="bench-tweak-pick">
          <select
            className="bench-select"
            aria-label="Use-case profile"
            value={profile}
            onChange={(e) => setProfile(e.target.value as (typeof USE_PROFILES)[number])}
          >
            {USE_PROFILES.map((p) => (
              <option key={p} value={p}>
                {PROFILE_META[p].label}
              </option>
            ))}
          </select>
        </div>
        <p className="bench-fine">{PROFILE_META[profile].blurb}</p>
      </Card>

      <div className="bench-actions">
        <button className="bench-btn bench-btn-primary" onClick={run} disabled={running}>
          {running ? "Measuring… (~10s — leave it alone)" : hasBaseline ? "Re-measure" : "Run benchmark"}
        </button>
        {running && (
          <button className="bench-btn bench-btn-ghost" onClick={cancel}>
            Cancel
          </button>
        )}
        {err && <span className="bench-err">{err}</span>}
        {!err && state?.error && <span className="bench-err">{state.error}</span>}
      </div>

      {showEfficacy && state?.efficacy && (
        <EfficacyCard efficacy={state.efficacy} changes={changesSince} />
      )}

      {/* Two Futures measured split — adjacent to the efficacy readout (where the data lives).
          Flag DEFAULT OFF; with it on, the component itself enforces the one law (no measured
          pair → honest empty state, no 3D). */}
      {twoFutures && <TwoFutures bench={state} hw={hw} />}

      {state?.latest && (
        <RunCard
          report={state.latest}
          at={state.latest_at}
          title={hasBaseline && !showEfficacy ? "Baseline" : "Latest run"}
        />
      )}

      <Card>
        <SectionHeader title="Baseline" />
        {hasBaseline ? (
          <>
            <p className="bench-muted">
              Baseline saved{state?.baseline_at ? ` · ${fmtWhen(state.baseline_at)}` : ""}. Change a
              setting (or use <strong>Measure this tweak</strong> below), then hit{" "}
              <strong>Re-measure</strong> to see the effect.
            </p>
            <button className="bench-btn bench-btn-ghost" onClick={clearBaseline} disabled={busy || running}>
              Clear baseline
            </button>
          </>
        ) : (
          <>
            <p className="bench-muted">
              Run a benchmark, then save it as your baseline — the fixed point you compare future changes
              against.
            </p>
            <button
              className="bench-btn"
              onClick={setBaseline}
              disabled={busy || running || !state?.latest}
            >
              Set latest run as baseline
            </button>
          </>
        )}
      </Card>

      <Card>
        <SectionHeader
          title="Measure on a live game"
          right={trial?.running ? <StatusPill status="scanning" label="Measuring" /> : undefined}
        />
        <p className="bench-muted">
          With a game running and FPS monitoring on, calibrate — Compy measures your rig's{" "}
          <Term id="noise-floor">run-to-run noise</Term> from real frametimes (
          <Term id="one-percent-lows">1% lows</Term>). That's the floor: a change smaller than it
          can't be told apart from noise, so we won't claim it.
        </p>
        {/* Inline dependency (wayfinding §2) — start monitoring right here; no trip to another page. */}
        {fpsActive === false && (
          <div className="bench-dep">
            <span className="bench-dep-msg">Benchmark needs FPS monitoring — it's off.</span>
            <button className="bench-btn" onClick={startMonitoring} disabled={fpsBusy}>
              {fpsBusy ? "Starting…" : "Start monitoring"}
            </button>
          </div>
        )}
        {fpsActive === true && <p className="bench-fine">FPS monitoring is on — you're set to measure.</p>}
        {trial?.running ? (
          <>
            <p className="bench-stat">
              {trial.status}
              {trial.target ? ` · ${trial.collected}/${trial.target}` : ""}
            </p>
            <button className="bench-btn bench-btn-ghost" onClick={cancelTrial}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="bench-btn" onClick={calibrate} disabled={fpsActive === false}>
              Calibrate (measure my run-to-run noise)
            </button>
            {tweaks.length > 0 && (
              <div className="bench-tweak-pick">
                <select
                  className="bench-select"
                  value={selectedTweak}
                  onChange={(e) => setSelectedTweak(e.target.value)}
                >
                  {tweaks.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
                <button
                  className="bench-btn"
                  onClick={measureTweak}
                  disabled={!selectedTweak || fpsActive === false}
                >
                  Measure this tweak
                </button>
                {/* Quiet "What's this?" for the picked tweak — opens its Blackbook entry; self-hides
                    when the tweak has no entry (no dead links), same as Fix rows. */}
                <WhatsThis id={selectedTweak} onOpen={openLibrary} />
              </div>
            )}
            <p className="bench-fine">
              “Measure this tweak” applies the change, measures with it on, then rolls it back — your
              settings end up exactly as they started. An elevated tweak asks for UAC twice (apply +
              undo).
            </p>
          </>
        )}

        {!trial?.running && trial?.kind === "calibration" && trial?.noise_floor_pct != null && (
          <p className="bench-stat">
            Run-to-run noise: <strong>±{trial.noise_floor_pct.toFixed(1)}%</strong>
            {trial.verdict &&
            trial.verdict.verdict === "inconclusive" &&
            trial.verdict.reason === "within-noise"
              ? " · pipeline check passed (no phantom change across identical runs)"
              : ""}
          </p>
        )}

        {!trial?.running && trial?.kind === "tweak" && trial?.verdict && (
          <p className="bench-stat">
            <StatusPill
              status={trialVerdictTone(trial.verdict)}
              label={trialVerdictLabel(trial.verdict)}
            />{" "}
            {trial.verdict.verdict === "inconclusive" ? (
              <>— {trialReasonText(trial.verdict.reason)}.</>
            ) : (
              <>
                — {trial.verdict.metric} {fmtDelta(trial.verdict.effect_pct)} (95% CI{" "}
                {fmtDelta(trial.verdict.ci_lo_pct)}…{fmtDelta(trial.verdict.ci_hi_pct)}).
              </>
            )}
            {trial.rolled_back && (
              <span className="bench-fine"> Change rolled back — settings unchanged.</span>
            )}
          </p>
        )}

        {!trial?.running && trial?.error && <p className="bench-err">{trial.error}</p>}
      </Card>

      <Card>
        <SectionHeader
          title="Score"
          right={
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {score && score.total_points > 0 && (
                <span className="bench-score-total">{score.total_points} pts</span>
              )}
              <button className="bench-btn bench-btn-ghost" onClick={toggleFace}>
                {arcade ? "Lab view" : "Arcade view"}
              </button>
            </div>
          }
        />
        {!score || score.awards.length === 0 ? (
          <p className="bench-muted">
            No verified wins yet. Measure a tweak above — any change that beats your noise floor lands
            here. Points are only ever earned by a measured, certified improvement; a tweak that
            doesn't help earns nothing.
          </p>
        ) : (
          <>
            <ul className="bench-awards">
              {score.awards.map((a, i) => {
                const key = `${a.rec_id}-${a.at}-${i}`;
                const open = openAward === key;
                // A2 LOCAL percentile stub — this win's standing among the user's OWN wins (no
                // peer cohort yet). Defensive read so a missing/stale field never throws.
                const localTopPct = fmtLocalWinTopPct(score.local_percentiles?.[i]);
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
                          <strong className="bench-award-pts">+{a.points}</strong> · {a.rec_title} boosted{" "}
                          {a.metric} by {fmtDelta(a.effect_pct)}
                        </span>
                      ) : (
                        <span>
                          <strong>{a.rec_title}</strong> — {a.metric} {fmtDelta(a.effect_pct)} (95% CI{" "}
                          {fmtDelta(a.ci_lo_pct)}…{fmtDelta(a.ci_hi_pct)}) · {a.points} pts ·{" "}
                          {fmtWhen(a.at)}
                        </span>
                      )}
                      <span className="bench-award-caret" aria-hidden="true">{open ? "▾" : "▸"}</span>
                    </button>
                    {open && (
                      <div className="bench-award-detail">
                        <span className="bench-award-eyebrow">Certified receipt</span>
                        <dl className="bench-award-rows">
                          <div>
                            <dt>Tweak</dt>
                            <dd>{a.rec_title}</dd>
                          </div>
                          <div>
                            <dt>Tweak id</dt>
                            <dd className="bench-award-mono">{a.rec_id}</dd>
                          </div>
                          <div>
                            <dt>Certified metric</dt>
                            <dd>{a.metric}</dd>
                          </div>
                          <div>
                            <dt>Measured effect</dt>
                            <dd>
                              {fmtDelta(a.effect_pct)}{" "}
                              <span className="bench-award-ci">
                                95% CI {fmtDelta(a.ci_lo_pct)}…{fmtDelta(a.ci_hi_pct)}
                              </span>
                            </dd>
                          </div>
                          {localTopPct && (
                            <div>
                              <dt>Among your wins</dt>
                              <dd>
                                {localTopPct}{" "}
                                <span className="bench-award-ci">
                                  local — your own results, no peer cohort yet
                                </span>
                              </dd>
                            </div>
                          )}
                          <div>
                            <dt>Points</dt>
                            <dd>+{a.points}</dd>
                          </div>
                          <div>
                            <dt>Recorded</dt>
                            <dd>{fmtWhen(a.at)}</dd>
                          </div>
                        </dl>
                        <p className="bench-award-trace">
                          Every figure here is the raw verdict receipt — no score exists without its
                          measurement.
                        </p>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <button className="bench-btn bench-btn-ghost" onClick={clearScore}>
              Clear scoreboard
            </button>
          </>
        )}
        <p className="bench-fine">
          Every point traces to a certified result — the tweak, the metric, and its 95% confidence
          interval. Nothing is awarded for a change that didn't measurably help.
        </p>
      </Card>

      <ol className="bench-steps">
        <li>Run a benchmark and set it as your baseline.</li>
        <li>Change one thing (a Windows setting, or apply one of Compy's tweaks).</li>
        <li>Re-measure — Compy reports the honest per-part verdict vs your baseline.</li>
      </ol>
    </div>
  );
}

function RunCard({ report, at, title }: { report: RunReport; at: string | null; title: string }) {
  return (
    <Card>
      <SectionHeader
        title={title}
        right={
          <StatusPill
            status={report.confidence === "clean" ? "ready" : "info"}
            label={report.confidence === "clean" ? "Clean run" : "Noisy run"}
          />
        }
      />
      <div className="bench-bars">
        {report.components.map((c) => (
          <div className="bench-bar-row" key={c.component}>
            <span className="bench-bar-label">{componentLabel(c.component)}</span>
            {c.measured ? (
              <>
                <span className="bench-bar-track">
                  <span className="bench-bar-fill" style={{ width: `${Math.min(c.score, 100)}%` }} />
                </span>
                <span className="bench-bar-val">{c.score}</span>
              </>
            ) : (
              <span className="bench-bar-na">not measured</span>
            )}
          </div>
        ))}
      </div>
      <p className="bench-fine">
        Scores are relative (0–100, rough reference) — useful for the comparison, not as an absolute
        grade.{at ? ` · ${fmtWhen(at)}` : ""}
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
  return (
    <Card>
      <SectionHeader
        title="Since your baseline"
        right={<StatusPill status={verdictTone(efficacy.overall)} label={verdictLabel(efficacy.overall)} />}
      />
      <p className="bench-change">
        {changes.length > 0 ? (
          <>
            Measuring the effect of:{" "}
            <strong>{changes.map((c) => c.rec_title).join(", ")}</strong>.
          </>
        ) : (
          <>No Compy changes recorded since the baseline — this reflects manual or ambient changes.</>
        )}
      </p>
      <div className="bench-eff">
        {efficacy.per_component.map((c) => (
          <div className="bench-eff-row" key={c.component}>
            <span className="bench-eff-label">{componentLabel(c.component)}</span>
            <span className={`bench-eff-delta is-${verdictTone(c.verdict)}`}>{fmtDelta(c.delta_pct)}</span>
            <StatusPill status={verdictTone(c.verdict)} label={verdictLabel(c.verdict)} />
          </div>
        ))}
      </div>
      <p className="bench-fine">
        Changes within ±{efficacy.noise_floor_pct}% are reported as “no measurable change” — below the
        run-to-run noise floor, so we won’t call them a win or a loss.
      </p>
    </Card>
  );
}

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString();
}
