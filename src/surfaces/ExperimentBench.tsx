// Intelligence Phase 3 — user-started experiment engine + optimization simulator surface. DARK.
// The gaming_mode/receipts pattern: fully built but renders NOTHING while the backend gate
// (experiment_gate) is hard-false, and every lifecycle command refuses independently (defense in
// depth). No experiment can start without an explicit user action AND an armed gate — there is no
// background/scheduled trigger anywhere. The real armed layout is designed at arming time with the
// owner's Lab UI direction (docs/UI_VISION_BACKLOG.md); this dark shell only proves the wiring and
// the honesty framing. Spec: docs/superpowers/specs/2026-07-17-intelligence-phase3-experiment-engine.md.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

type ExperimentStatus = "running" | "kept" | "restored" | "aborted";

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
};

// Plain-English label for each honest verdict string (§4F/§1 — measurement, never a promise).
const VERDICT_COPY: Record<string, string> = {
  improved: "Measurably faster — kept",
  "no-change": "No measurable change — restored",
  regressed: "Slower — restored",
  confounded: "Another change interfered — restored, can't attribute",
  expired: "Baseline too old to judge — restored",
  "insufficient-evidence": "Not enough data to judge — restored",
};

export default function ExperimentBench() {
  const [gate, setGate] = useState(false);
  const [experiments, setExperiments] = useState<Experiment[]>([]);

  useEffect(() => {
    let alive = true;
    invoke<boolean>("get_experiment_gate")
      .then((g) => {
        if (alive) setGate(g);
      })
      .catch(() => {
        /* probe failed → stay hidden (fail-dark) */
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!gate) return;
    let alive = true;
    invoke<Experiment[]>("get_experiments")
      .then((xs) => {
        if (alive) setExperiments(xs);
      })
      .catch(() => {
        /* read failed → empty list (fail-safe) */
      });
    return () => {
      alive = false;
    };
  }, [gate]);

  if (!gate) return null; // DARK: the gate is hard-false in every shipped build today.

  return (
    <section className="exp-bench" data-testid="experiment-bench">
      <h2 className="exp-bench-title">Controlled experiments</h2>
      <p className="exp-bench-hint">
        Test one change at a time on your own rig: Compy captures a baseline, applies a single
        reversible tweak, measures a real session against it, and automatically restores the change
        unless the numbers clearly beat the noise. It measures — it never promises a gain.
      </p>
      {experiments.length === 0 ? (
        <p className="exp-bench-empty">No experiments yet.</p>
      ) : (
        <ul className="exp-bench-list">
          {experiments.map((x) => (
            <li key={x.id} className="exp-bench-row" data-status={x.status}>
              <span className="exp-bench-rec">{x.rec_title}</span>
              <span className="exp-bench-verdict">
                {x.verdict ? (VERDICT_COPY[x.verdict] ?? x.verdict) : "Running…"}
              </span>
              {x.attribution_warning && (
                <span className="exp-bench-warn">{x.attribution_warning}</span>
              )}
              {x.stop_reason && x.status === "aborted" && (
                <span className="exp-bench-abort">{x.stop_reason}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
