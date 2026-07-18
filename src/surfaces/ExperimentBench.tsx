// Intelligence Phase 3 — user-started experiment engine + optimization simulator surface.
// ARMED (experiment_gate() true, owner-signed 2026-07-17). The engine ORCHESTRATES the existing
// audited apply/rollback boundary — it invents no new mutation primitive. Nothing runs without an
// explicit user action: you PICK a change, the simulator gives an honest read (never a promise),
// you START (which applies ONE reversible change against a real captured baseline), you play, and
// you CONCLUDE — Compy judges the real session against the 3% noise floor and auto-restores unless
// the numbers clearly beat it. It measures; it never fabricates a gain.
// Spec: docs/superpowers/specs/2026-07-17-intelligence-phase3-experiment-engine.md.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary } from "../types";
import { LEDGER_CHANGED_EVENT } from "../types";
import { prettyGameName } from "./game-name";
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

// Plain-English label for each honest conclude verdict (§4F/§1 — measurement, never a promise).
const VERDICT_COPY: Record<string, string> = {
  improved: "Measurably faster — kept",
  "no-change": "No measurable change — restored",
  regressed: "Slower — restored",
  confounded: "Another change interfered — restored, can't attribute",
  expired: "Baseline too old to judge — restored",
  "insufficient-evidence": "Not enough data to judge — restored",
  "not-comparable": "Different game — not comparable, restored",
};

// Honest label per simulator verdict + whether a controlled test is a meaningful next step.
// `blocked` verdicts have nothing to learn from an experiment (already on / wrong rig / barred).
const SIM_VERDICT: Record<string, { label: string; blocked: boolean }> = {
  "worth-testing": { label: "Worth testing", blocked: false },
  "plausible-unproven": { label: "Plausible — unproven", blocked: false },
  "insufficient-evidence": { label: "Unknown — measure it to find out", blocked: false },
  "unlikely-to-matter": { label: "Unlikely to matter", blocked: false },
  "already-configured": { label: "Already configured", blocked: true },
  // Covers both a hardware mismatch AND an advisory Compy can't one-click apply — either way there's
  // no controlled before/after to run here, so Start stays disabled (blocked). The `why` disambiguates.
  "not-applicable": { label: "Not testable here", blocked: true },
  "risk-exceeds-value": { label: "Risk exceeds value — barred", blocked: true },
};

const CONFIDENCE_COPY: Record<Confidence, string> = {
  unknown: "confidence: unknown",
  low: "confidence: low",
  medium: "confidence: medium",
  high: "confidence: high",
};

function whenLabel(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hr ago`;
  return `${Math.round(hrs / 24)} d ago`;
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
          setHypothesis(
            `${report.metric_to_watch ?? "1% low FPS"} should beat the ${
              hasBaseline ? "3% noise floor" : "noise floor"
            }`,
          );
        }
      } catch (e) {
        if (simReq.current !== reqId) return; // stale error from a superseded pick — ignore
        if (!quiet) setError(String(e));
      } finally {
        if (simReq.current === reqId && !quiet) setSimBusy(false);
      }
    },
    [hasBaseline],
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

  const simMeta = sim ? SIM_VERDICT[sim.verdict] ?? { label: sim.verdict, blocked: false } : null;
  const canStart = !!sim && !!simMeta && !simMeta.blocked && !!baseline && !busy;

  return (
    <section className="exp-bench" data-testid="experiment-bench">
      <h2 className="exp-bench-title">Controlled experiments</h2>
      <p className="exp-bench-hint">
        Test one change at a time on your own rig: Compy captures a baseline, applies a single
        reversible tweak, measures a real session against it, and automatically restores the change
        unless the numbers clearly beat the noise. It measures — it never promises a gain.
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
          <label className="exp-field">
            <span className="exp-field-label">Pick a change to test</span>
            <select
              className="exp-select"
              value={pickId}
              disabled={busy || simBusy}
              onChange={(e) => runSim(e.target.value)}
            >
              <option value="">Choose a change…</option>
              {options.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </label>
          {options.length === 0 && (
            <p className="exp-note">
              No changes to test right now — every applicable change is already applied, or nothing in
              the catalog fits this rig.
            </p>
          )}

          {simBusy && <p className="exp-note">Reading your rig…</p>}

          {sim && simMeta && (
            <div className="exp-sim" data-verdict={sim.verdict}>
              <p className="exp-sim-rec">{sim.rec_title}</p>
              <div className="exp-sim-head">
                <span className="exp-sim-verdict">{simMeta.label}</span>
                <span className="exp-sim-conf">{CONFIDENCE_COPY[sim.confidence]}</span>
              </div>
              <p className="exp-sim-why">{sim.why}</p>
              <p className="exp-sim-line">
                <span className="exp-sim-mark">For your rig:</span> {sim.hardware_factor}
              </p>
              {sim.metric_to_watch && (
                <p className="exp-sim-line">
                  <span className="exp-sim-mark">Watch:</span> {sim.metric_to_watch}
                </p>
              )}
              <p className="exp-sim-line">
                <span className="exp-sim-mark">Disproved if:</span> {sim.disproof}
              </p>
            </div>
          )}

          {sim && simMeta && !simMeta.blocked && (
            <div className="exp-start">
              {baseline ? (
                <>
                  <p className="exp-baseline">
                    <span className="exp-sim-mark">Baseline:</span>{" "}
                    {prettyGameName(baseline.process_name) || "your last session"} — avg{" "}
                    <b>{Math.round(baseline.avg_fps)}</b> fps · 1% low{" "}
                    <b>{Math.round(baseline.low1_fps_est)}</b> fps ({whenLabel(baseline.started_at)})
                  </p>
                  <label className="exp-field">
                    <span className="exp-field-label">Hypothesis</span>
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
                    {busy ? "Applying…" : "Start experiment — apply & measure next session"}
                  </button>
                  <p className="exp-fineprint">
                    Applies one reversible change now, then compares your next{" "}
                    {prettyGameName(baseline.process_name) || "game"} session. Auto-restores unless it
                    clearly beats the noise floor.
                  </p>
                </>
              ) : (
                <p className="exp-note">
                  No baseline yet — play one monitored gaming session first. Compy needs a real
                  before-reading; it won't invent one.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {history.length > 0 && (
        <div className="exp-history">
          <div className="exp-history-label">Past experiments</div>
          <ul className="exp-bench-list">
            {history.map((x) => (
              <li key={x.id} className="exp-bench-row" data-status={x.status}>
                <span className="exp-bench-rec">{x.rec_title}</span>
                <span className="exp-bench-verdict">
                  {x.verdict ? VERDICT_COPY[x.verdict] ?? x.verdict : "—"}
                </span>
                {x.treatment && (
                  <span className="exp-bench-delta">
                    {x.treatment.delta_low1_pct >= 0 ? "+" : ""}
                    {x.treatment.delta_low1_pct}% 1% low
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
    </section>
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
  const game = prettyGameName(exp.game) || "your game";
  return (
    <div className="exp-running" data-testid="experiment-running">
      <div className="exp-running-head">
        <span className="exp-running-dot" aria-hidden />
        <span className="exp-running-title">Experiment in progress — {exp.rec_title}</span>
      </div>
      <p className="exp-running-baseline">
        Baseline · {game} — avg <b>{Math.round(exp.baseline_avg_fps)}</b> fps · 1% low{" "}
        <b>{Math.round(exp.baseline_low1_fps)}</b> fps
      </p>
      {exp.attribution_warning && <p className="exp-bench-warn">{exp.attribution_warning}</p>}
      <p className="exp-running-step">
        The change is applied. Play a {game} session, then conclude — Compy compares it to the
        baseline and restores the change unless it clearly wins.
      </p>

      <div className="exp-running-actions">
        <button
          className="exp-cta"
          disabled={!treatment || busy}
          onClick={() => treatment && onConclude(exp, treatment)}
        >
          {busy
            ? "Working…"
            : treatment
              ? `Conclude with my latest ${game} session`
              : `No new ${game} session yet`}
        </button>
        <button
          className="exp-cta-ghost"
          disabled={busy}
          onClick={() => onRestore(exp)}
        >
          Restore now
        </button>
      </div>
      {treatment ? (
        <p className="exp-fineprint">
          Latest {game} session: avg <b>{Math.round(treatment.avg_fps)}</b> fps · 1% low{" "}
          <b>{Math.round(treatment.low1_fps_est)}</b> fps · {treatment.samples.toLocaleString()}{" "}
          frames.
        </p>
      ) : (
        <p className="exp-fineprint">
          Play a monitored {game} session to give the experiment a real after-reading.
        </p>
      )}
    </div>
  );
}
