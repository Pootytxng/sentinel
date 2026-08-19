// Intelligence Phase 3 — user-started experiment engine + optimization simulator surface.
// ARMED (experiment_gate() true, owner-signed 2026-07-17). The engine ORCHESTRATES the existing
// audited apply/rollback boundary — it invents no new mutation primitive. Nothing runs without an
// explicit user action: you PICK a change, the simulator gives an honest read (never a promise),
// you START (which applies ONE reversible change against a real captured baseline), you play, and
// you CONCLUDE — Compy judges the real session against the 3% noise floor and auto-restores unless
// the numbers clearly beat it. It measures; it never fabricates a gain.
// Spec: docs/superpowers/specs/2026-07-17-intelligence-phase3-experiment-engine.md.

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary } from "../types";
import { LEDGER_CHANGED_EVENT } from "../types";
import { prettyGameName } from "./game-name";
import { SectionLabel, VerdictBand, simulationTone } from "./measurement-chrome";
import { BentoTile } from "../design/bento/BentoGrid";
import { Picker } from "../design/Picker";
import "./ExperimentBench.css";

type ExperimentStatus = "running" | "kept" | "restored" | "aborted";
type Confidence = "unknown" | "low" | "medium" | "high";

type Treatment = {
  avg_fps: number;
  low1_fps: number;
  samples: number;
  crashed: boolean;
  delta_low1_pct: number;
  recorded_at: string;
};

type Experiment = {
  id: string;
  rec_id: string;
  rec_title: string;
  game: string;
  hypothesis: string;
  created_at: string;
  status: ExperimentStatus;
  baseline_avg_fps: number;
  baseline_low1_fps: number;
  active_changes_at_start: number;
  attribution_warning: string | null;
  noise_floor_pct: number;
  treatment: Treatment | null;
  verdict: string | null;
  kept: boolean;
  stop_reason: string | null;
  concluded_at: string | null;
  /** Task F — how much the EVIDENCE QUALITY justifies trusting this verdict (a band, never a
   *  number). null while Running or on records written before this field existed (honestly unknown). */
  verdict_confidence: Confidence | null;
  /** Plain-language "what supports / limits this verdict" line — the experiment's methodology. */
  verdict_note: string | null;
};

type SimulatorReport = {
  rec_id: string;
  rec_title: string;
  verdict: string;
  confidence: Confidence;
  why: string;
  hardware_factor: string;
  metric_to_watch: string | null;
  disproof: string;
  is_promise: boolean;
};

// Only the fields the picker needs — get_recommendations returns the full Recommendation.
type RecLite = {
  id: string;
  title: string;
  eligible: boolean;
  currently_applied: boolean;
};

// A plain (key, options?) => string signature — avoids importing react-i18next's generic TFunction
// type just to thread the translator into a couple of module-level helper functions.
type Translate = (key: string, options?: Record<string, unknown>) => string;

// Plain-English label for each honest conclude verdict (§4F/§1 — measurement, never a promise).
// Built from `t` (not a module-level constant) so it's translated; called from inside the component.
function verdictCopy(t: Translate): Record<string, string> {
  return {
    improved: t("lab.experimentBench.verdict.improved"),
    "no-change": t("lab.experimentBench.verdict.noChange"),
    regressed: t("lab.experimentBench.verdict.regressed"),
    confounded: t("lab.experimentBench.verdict.confounded"),
    expired: t("lab.experimentBench.verdict.expired"),
    "insufficient-evidence": t("lab.experimentBench.verdict.insufficientEvidence"),
    "not-comparable": t("lab.experimentBench.verdict.notComparable"),
  };
}

// Honest label per simulator verdict + whether a controlled test is a meaningful next step.
// `blocked` verdicts have nothing to learn from an experiment (already on / wrong rig / barred).
function simVerdictCopy(t: Translate): Record<string, { label: string; blocked: boolean }> {
  return {
    "worth-testing": { label: t("lab.experimentBench.simVerdict.worthTesting"), blocked: false },
    "plausible-unproven": { label: t("lab.experimentBench.simVerdict.plausibleUnproven"), blocked: false },
    "insufficient-evidence": {
      label: t("lab.experimentBench.simVerdict.insufficientEvidence"),
      blocked: false,
    },
    "unlikely-to-matter": { label: t("lab.experimentBench.simVerdict.unlikelyToMatter"), blocked: false },
    "already-configured": { label: t("lab.experimentBench.simVerdict.alreadyConfigured"), blocked: true },
    // Covers both a hardware mismatch AND an advisory Compy can't one-click apply — either way there's
    // no controlled before/after to run here, so Start stays disabled (blocked). The `why` disambiguates.
    "not-applicable": { label: t("lab.experimentBench.simVerdict.notApplicable"), blocked: true },
    "risk-exceeds-value": { label: t("lab.experimentBench.simVerdict.riskExceedsValue"), blocked: true },
  };
}

function confidenceCopy(t: Translate): Record<Confidence, string> {
  return {
    unknown: t("lab.experimentBench.confidence.unknown"),
    low: t("lab.experimentBench.confidence.low"),
    medium: t("lab.experimentBench.confidence.medium"),
    high: t("lab.experimentBench.confidence.high"),
  };
}

function whenLabel(iso: string, t: Translate): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return t("lab.experimentBench.when.justNow");
  if (mins < 60) return t("lab.experimentBench.when.minAgo", { count: mins });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return t("lab.experimentBench.when.hrAgo", { count: hrs });
  return t("lab.experimentBench.when.dAgo", { count: Math.round(hrs / 24) });
}

// The treatment session for a running experiment: the most recent monitored session of the SAME game
// that started AFTER the experiment began and carries real frames. Never fabricated — if none exists
// the owner simply hasn't played a qualifying session yet.
function treatmentFor(exp: Experiment, sessions: SessionSummary[]): SessionSummary | null {
  const started = new Date(exp.created_at).getTime();
  const candidates = sessions
    .filter(
      (s) =>
        s.process_name === exp.game &&
        s.avg_fps > 0 &&
        new Date(s.started_at).getTime() > started,
    )
    .sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime());
  return candidates[0] ?? null;
}

export default function ExperimentBench() {
  const { t } = useTranslation();
  const [gate, setGate] = useState(false);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [recs, setRecs] = useState<RecLite[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);

  const [pickId, setPickId] = useState<string>("");
  const [sim, setSim] = useState<SimulatorReport | null>(null);
  const [simBusy, setSimBusy] = useState(false);
  const [hypothesis, setHypothesis] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sequences simulate_optimization responses: a fast reselect must never leave `sim` pointing at a
  // rec the dropdown no longer shows — startExperiment applies the REAL change from sim.rec_id, so a
  // stale read here is a mutation-boundary hazard. Each call claims the next id; only the latest commits.
  const simReq = useRef(0);

  useEffect(() => {
    let alive = true;
    invoke<boolean>("get_experiment_gate")
      .then((g) => alive && setGate(g))
      .catch(() => {
        /* probe failed → stay hidden (fail-dark) */
      });
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const [xs, rs, ss] = await Promise.all([
      invoke<Experiment[]>("get_experiments").catch(() => []),
      invoke<RecLite[]>("get_recommendations").catch(() => []),
      invoke<SessionSummary[]>("get_session_summaries").catch(() => []),
    ]);
    setExperiments(xs ?? []);
    setRecs(rs ?? []);
    setSessions(ss ?? []);
  }, []);

  useEffect(() => {
    if (!gate) return;
    reload();
  }, [gate, reload]);

  // Whether a real before-reading exists — governs the simulator's hypothesis wording. A primitive so
  // runSim's useCallback stays stable across renders (the focus-refresh effect below depends on it).
  const hasBaseline = sessions.some((s) => s.avg_fps > 0);

  // Runs the optimization simulator for a pick. `quiet` (the refresh path) re-derives the verdict from
  // the live ledger WITHOUT the pick/spinner/hypothesis reset — a background refresh never flickers the
  // card or clobbers the owner's typed hypothesis; a user pick (non-quiet) keeps the full behavior.
  const runSim = useCallback(
    async (recId: string, opts?: { quiet?: boolean }) => {
      const quiet = opts?.quiet ?? false;
      const reqId = ++simReq.current;
      if (!quiet) {
        setPickId(recId);
        setSim(null);
        setError(null);
      }
      if (!recId) return;
      if (!quiet) setSimBusy(true);
      try {
        const report = await invoke<SimulatorReport>("simulate_optimization", { recId });
        if (simReq.current !== reqId) return; // a newer read superseded this one — drop the stale sim
        setSim(report);
        if (!quiet) {
          const metric = report.metric_to_watch ?? t("lab.experimentBench.hypothesisMetricFallback");
          setHypothesis(
            hasBaseline
              ? t("lab.experimentBench.hypothesisWithBaseline", { metric })
              : t("lab.experimentBench.hypothesisWithoutBaseline", { metric }),
          );
        }
      } catch (e) {
        if (simReq.current !== reqId) return; // stale error from a superseded pick — ignore
        if (!quiet) setError(String(e));
      } finally {
        if (simReq.current === reqId && !quiet) setSimBusy(false);
      }
    },
    [hasBaseline, t],
  );

  // Intelligence Phase 3 fast-follow (W2 + Measurement-2.0 Task A): the bench loads once when the gate
  // arms, so a change applied over in Optimize during the same Lab visit would leave the picker + an
  // active simulator read stale. Two wake signals reload the ledger and re-derive the active pick's
  // verdict: (1) OS refocus (window focus / tab re-shown) covers an apply made while the window was
  // backgrounded; (2) the in-app `compy:ledger-changed` event covers a *same-window* sibling apply (the
  // Optimize station in the same Lab visit fires no focus/visibilitychange, so refocus alone misses it).
  // Either way an externally-applied pick honestly resolves to "already configured" and Start stops being
  // offered. No new mutation path — this is a read-only refresh listening on an additive frontend event.
  useEffect(() => {
    if (!gate) return;
    const onWake = () => {
      if (document.visibilityState === "hidden") return;
      reload();
      if (pickId) runSim(pickId, { quiet: true });
    };
    window.addEventListener("focus", onWake);
    document.addEventListener("visibilitychange", onWake);
    window.addEventListener(LEDGER_CHANGED_EVENT, onWake);
    return () => {
      window.removeEventListener("focus", onWake);
      document.removeEventListener("visibilitychange", onWake);
      window.removeEventListener(LEDGER_CHANGED_EVENT, onWake);
    };
  }, [gate, pickId, reload, runSim]);

  if (!gate) return null;

  const running = experiments.find((x) => x.status === "running") ?? null;
  const history = experiments.filter((x) => x.status !== "running");

  // The honest baseline: the most recent monitored session with real frames. The experiment locks to
  // that game. No sessions → we cannot invent a baseline; the owner plays one monitored session first.
  const baseline =
    [...sessions].filter((s) => s.avg_fps > 0).sort(
      (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
    )[0] ?? null;

  // The testable universe: catalog changes this rig can use and hasn't already applied.
  const pickable = recs.filter((r) => r.eligible && !r.currently_applied);

  // If a refocus-refresh just re-derived the active pick as already-applied (it drops out of `pickable`),
  // keep it in the dropdown so its honest "already configured" verdict stays on screen — the selection
  // must not silently vanish while its simulator card is still showing.
  const options =
    pickId && !pickable.some((r) => r.id === pickId)
      ? [...pickable, ...recs.filter((r) => r.id === pickId)]
      : pickable;

  async function startExperiment() {
    if (!sim || !baseline) return;
    setBusy(true);
    setError(null);
    try {
      await invoke<Experiment>("start_experiment", {
        recId: sim.rec_id,
        recTitle: sim.rec_title,
        game: baseline.process_name,
        baselineAvgFps: baseline.avg_fps,
        baselineLow1Fps: baseline.low1_fps_est,
        hypothesis,
      });
      setSim(null);
      setPickId("");
      await reload();
      // Starting an experiment applied its change through the audited path — the ledger changed, so
      // sibling surfaces (Optimize's applicable list, the Trust Ledger) re-derive. See types.ts note.
      window.dispatchEvent(new Event(LEDGER_CHANGED_EVENT));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function concludeExperiment(exp: Experiment, treatment: SessionSummary) {
    setBusy(true);
    setError(null);
    try {
      await invoke<Experiment>("conclude_experiment", {
        experimentId: exp.id,
        treatmentAvgFps: treatment.avg_fps,
        treatmentLow1Fps: treatment.low1_fps_est,
        treatmentSamples: treatment.samples,
        crashed: false,
        // The game this treatment session actually measured — the backend re-verifies it matches the
        // baseline (defense-in-depth) rather than trusting our same-game filter above.
        treatmentGame: treatment.process_name,
      });
      await reload();
    } catch (e) {
      // A loud restore-failed error is surfaced verbatim — never hidden (honesty rail).
      setError(String(e));
      await reload();
    } finally {
      setBusy(false);
    }
  }

  async function restoreExperiment(exp: Experiment) {
    setBusy(true);
    setError(null);
    try {
      await invoke<Experiment>("restore_experiment", { experimentId: exp.id });
      await reload();
      // Restoring rolled the change back through the audited path — ledger changed, siblings re-derive.
      window.dispatchEvent(new Event(LEDGER_CHANGED_EVENT));
    } catch (e) {
      setError(String(e));
      await reload();
    } finally {
      setBusy(false);
    }
  }

  const SIM_VERDICT = simVerdictCopy(t);
  const simMeta = sim ? SIM_VERDICT[sim.verdict] ?? { label: sim.verdict, blocked: false } : null;
  const canStart = !!sim && !!simMeta && !simMeta.blocked && !!baseline && !busy;

  // Bento conversion (2026-08-12). span="full" is FORCED, not a taste call: this component can
  // return null (the dark experiment gate above) and this file declares no grid of its own, so
  // rule 3 of one-hero-guard.test.ts ("a tile component that can render null is span=\"full\"")
  // applies. That guard reads raw source TEXT, so prose here must never spell the grid element's
  // opening tag out — a mention in a comment reads as a real grid block and fails rule 1.
  // LabGround mounts this as a SIBLING of <LabConsole> under RoomShell — not inside a grid — which
  // is the same out-of-grid tile idiom LabConsole already uses for its open station panel. The
  // tile draws the room's heading, so the old <h2 className="exp-bench-title"> is gone (one title,
  // not two). The testid rides an inner <div>: BentoTile takes a fixed prop set and does not
  // spread, so a testid on the tile itself would be silently dropped.
  return (
    <BentoTile title={t("lab.experimentBench.title")} span="full">
      <div className="exp-bench" data-testid="experiment-bench">
      <p className="exp-bench-hint">
        {t("lab.experimentBench.hint")}
      </p>

      {error && (
        <p className="exp-bench-error" role="alert">
          {error}
        </p>
      )}

      {running ? (
        // ── One experiment in flight: single-variable honesty is enforced by hiding the launcher ──
        <RunningPanel
          exp={running}
          treatment={treatmentFor(running, sessions)}
          busy={busy}
          onConclude={concludeExperiment}
          onRestore={restoreExperiment}
        />
      ) : (
        // ── Launcher: pick a change → honest simulator read → start against the real baseline ──
        <div className="exp-launch">
          {/* C-10: was a native <select>, whose OS-drawn menu ignored every token in the room.
              `<label>` became a plain wrapper + an explicit `labelledBy` because the Picker's
              trigger is a button, and implicit label association only works for form controls. */}
          <div className="exp-field">
            <span className="exp-field-label" id="exp-pick-label">
              {t("lab.experimentBench.pickLabel")}
            </span>
            <Picker
              className="exp-select"
              labelledBy="exp-pick-label"
              value={pickId}
              disabled={busy || simBusy}
              placeholder={t("lab.experimentBench.chooseChange")}
              onChange={(v) => runSim(v)}
              options={options.map((r) => ({ value: r.id, label: r.title }))}
            />
          </div>
          {options.length === 0 && (
            <p className="exp-note">
              {t("lab.experimentBench.noChangesToTest")}
            </p>
          )}

          {simBusy && <p className="exp-note">{t("lab.experimentBench.readingRig")}</p>}

          {sim && simMeta && (
            <div className="exp-sim" data-verdict={sim.verdict}>
              <p className="exp-sim-rec">{sim.rec_title}</p>
              <div className="exp-sim-head">
                <VerdictBand tone={simulationTone(sim.verdict)}>{simMeta.label}</VerdictBand>
                <span className="exp-sim-conf">{confidenceCopy(t)[sim.confidence]}</span>
              </div>
              <p className="exp-sim-why">{sim.why}</p>
              <p className="exp-sim-line">
                <span className="exp-sim-mark">{t("lab.experimentBench.forYourRig")}</span> {sim.hardware_factor}
              </p>
              {sim.metric_to_watch && (
                <p className="exp-sim-line">
                  <span className="exp-sim-mark">{t("lab.experimentBench.watch")}</span> {sim.metric_to_watch}
                </p>
              )}
              <p className="exp-sim-line">
                <span className="exp-sim-mark">{t("lab.experimentBench.disprovedIf")}</span> {sim.disproof}
              </p>
            </div>
          )}

          {sim && simMeta && !simMeta.blocked && (
            <div className="exp-start">
              {baseline ? (
                <>
                  <p className="exp-baseline">
                    <span className="exp-sim-mark">{t("lab.experimentBench.baselineLabel")}</span>{" "}
                    {t("lab.experimentBench.baselinePre", {
                      game: prettyGameName(baseline.process_name) || t("lab.experimentBench.yourLastSession"),
                    })}{" "}
                    <b>{Math.round(baseline.avg_fps)}</b> {t("lab.experimentBench.baselineMid")}{" "}
                    <b>{Math.round(baseline.low1_fps_est)}</b>{" "}
                    {t("lab.experimentBench.baselinePost", { when: whenLabel(baseline.started_at, t) })}
                  </p>
                  <label className="exp-field">
                    <span className="exp-field-label">{t("lab.experimentBench.hypothesisLabel")}</span>
                    <input
                      className="exp-input"
                      value={hypothesis}
                      maxLength={200}
                      disabled={busy}
                      onChange={(e) => setHypothesis(e.target.value)}
                    />
                  </label>
                  <button
                    className="exp-cta"
                    disabled={!canStart}
                    onClick={startExperiment}
                  >
                    {busy ? t("lab.experimentBench.applying") : t("lab.experimentBench.startExperiment")}
                  </button>
                  <p className="exp-fineprint">
                    {t("lab.experimentBench.fineprint", {
                      game: prettyGameName(baseline.process_name) || t("lab.experimentBench.fineprintGameFallback"),
                    })}
                  </p>
                </>
              ) : (
                <p className="exp-note">
                  {t("lab.experimentBench.noBaselineYet")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="exp-history">
          <SectionLabel>{t("lab.experimentBench.pastExperiments")}</SectionLabel>
          <ul className="exp-bench-list">
            {history.map((x) => (
              <li key={x.id} className="exp-bench-row" data-status={x.status}>
                <span className="exp-bench-rec">{x.rec_title}</span>
                <span className="exp-bench-verdict">
                  {x.verdict ? verdictCopy(t)[x.verdict] ?? x.verdict : "—"}
                </span>
                {x.treatment && (
                  <span className="exp-bench-delta">
                    {x.treatment.delta_low1_pct >= 0 ? "+" : ""}
                    {x.treatment.delta_low1_pct}
                    {t("lab.experimentBench.deltaSuffix")}
                  </span>
                )}
                {x.stop_reason && x.status === "aborted" && (
                  <span className="exp-bench-abort">{x.stop_reason}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </BentoTile>
  );
}

function RunningPanel({
  exp,
  treatment,
  busy,
  onConclude,
  onRestore,
}: {
  exp: Experiment;
  treatment: SessionSummary | null;
  busy: boolean;
  onConclude: (exp: Experiment, treatment: SessionSummary) => void;
  onRestore: (exp: Experiment) => void;
}) {
  const { t } = useTranslation();
  const game = prettyGameName(exp.game) || t("lab.experimentBench.yourGame");
  return (
    <div className="exp-running" data-testid="experiment-running">
      <div className="exp-running-head">
        <span className="exp-running-dot" aria-hidden />
        <span className="exp-running-title">{t("lab.experimentBench.runningTitlePrefix")} {exp.rec_title}</span>
      </div>
      <p className="exp-running-baseline">
        {t("lab.experimentBench.runningBaselinePre", { game })} <b>{Math.round(exp.baseline_avg_fps)}</b> {t("lab.experimentBench.baselineMid")}{" "}
        <b>{Math.round(exp.baseline_low1_fps)}</b> {t("lab.experimentBench.fpsUnit")}
      </p>
      {exp.attribution_warning && <p className="exp-bench-warn">{exp.attribution_warning}</p>}
      <p className="exp-running-step">
        {t("lab.experimentBench.runningStep", { game })}
      </p>

      <div className="exp-running-actions">
        <button
          className="exp-cta"
          disabled={!treatment || busy}
          onClick={() => treatment && onConclude(exp, treatment)}
        >
          {busy
            ? t("lab.experimentBench.working")
            : treatment
              ? t("lab.experimentBench.concludeWithLatest", { game })
              : t("lab.experimentBench.noNewSession", { game })}
        </button>
        <button
          className="exp-cta-ghost"
          disabled={busy}
          onClick={() => onRestore(exp)}
        >
          {t("lab.experimentBench.restoreNow")}
        </button>
      </div>
      {treatment ? (
        <p className="exp-fineprint">
          {t("lab.experimentBench.runningLatestPre", { game })} <b>{Math.round(treatment.avg_fps)}</b> {t("lab.experimentBench.baselineMid")}{" "}
          <b>{Math.round(treatment.low1_fps_est)}</b>{" "}
          {t("lab.experimentBench.runningLatestPost", { samples: treatment.samples.toLocaleString() })}
        </p>
      ) : (
        <p className="exp-fineprint">
          {t("lab.experimentBench.runningNoTreatment", { game })}
        </p>
      )}
    </div>
  );
}
