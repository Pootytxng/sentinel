// P5-outcomes review: the outcome switch is never offered while the guided journey is anywhere but
// idle (waiting for a session, uneven, judging, showing its result): an undo could take back the
// journey Trial's own apply, and a re-apply would confound it. The journey phase is mocked here; the
// running-Trial case is in ExperimentBench.test.tsx.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import "../i18n";

const state = vi.hoisted(() => ({ phase: { kind: "idle" } as { kind: string; [k: string]: unknown } }));

vi.mock("./GuidedJourney", async (orig) => ({
  ...(await orig<typeof import("./GuidedJourney")>()),
  useJourneyPhase: () => state.phase,
  GuidedJourney: () => null,
}));

const base = {
  rec_id: "hags",
  rec_title: "Hardware-accelerated GPU scheduling",
  game: "Valorant",
  hypothesis: "",
  baseline_avg_fps: 240,
  baseline_low1_fps: 180,
  active_changes_at_start: 0,
  attribution_warning: null,
  noise_floor_pct: 3,
  stop_reason: null,
  verdict_confidence: "medium",
  verdict_note: null,
  noise_evidence: { band_pct: 3, measured_noise_pct: null },
};
const EXPERIMENTS = [
  {
    ...base,
    id: "exp:rec",
    created_at: "2026-07-17T00:00:00Z",
    concluded_at: "2026-07-17T01:00:00Z",
    status: "restored",
    kept: false,
    verdict: "regressed",
    outcome: "recommended",
    treatment: { avg_fps: 254, low1_fps: 173, samples: 5000, crashed: false, delta_low1_pct: -4, delta_avg_pct: 6, recorded_at: "2026-07-17T01:00:00Z" },
  },
  {
    ...base,
    id: "exp:max",
    created_at: "2026-07-18T00:00:00Z",
    concluded_at: "2026-07-18T01:00:00Z",
    status: "kept",
    kept: true,
    verdict: "improved",
    outcome: "max-fps",
    treatment: { avg_fps: 254, low1_fps: 176, samples: 5000, crashed: false, delta_low1_pct: -2, delta_avg_pct: 6, recorded_at: "2026-07-18T01:00:00Z" },
  },
];
const RECS = [
  { id: "hags", title: "Hardware-accelerated GPU scheduling", passes: false, reason: "already-set-by-compy", detail: null, position: 1, evidence: "not-measured", risk: "low" },
];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    switch (cmd) {
      case "get_experiment_gate":
        return Promise.resolve(true);
      case "get_experiments":
        return Promise.resolve(EXPERIMENTS);
      case "get_trial_candidates":
        return Promise.resolve(RECS);
      case "get_session_summaries":
        return Promise.resolve([]);
      default:
        return Promise.resolve(null);
    }
  }),
}));

import ExperimentBench from "./ExperimentBench";

afterEach(() => {
  cleanup();
  state.phase = { kind: "idle" };
});

describe("P5-outcomes: no switch while the journey is under way", () => {
  it("idle: the switch is offered", async () => {
    const row = await (async () => {
      render(<ExperimentBench />);
      return screen.findByTestId("exp-outcome-choice-row");
    })();
    expect(row.querySelectorAll("button")).toHaveLength(1);
  });

  for (const phase of [
    { kind: "as-is", game: "Valorant", change: "HAGS" },
    { kind: "uneven", game: "Valorant", change: "HAGS", grade: { kind: "untraced" }, final: false },
    { kind: "with-change", game: "Valorant", change: "HAGS" },
    { kind: "judging", change: "HAGS" },
  ]) {
    it(`${phase.kind}: the trade shows, the switch does not`, async () => {
      state.phase = phase;
      render(<ExperimentBench />);
      const row = await screen.findByTestId("exp-outcome-choice-row");
      expect(screen.getByTestId("exp-outcome-choice-locked")).toBeInTheDocument();
      expect(row.querySelectorAll("button")).toHaveLength(0);
    });
  }
});
