import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TuningInstrument } from "./TuningInstrument";
import { TUNING_GUIDE_BY_ID } from "../data/tuning-guides";
import type { TuningMeasurement } from "../data/tuning-measure";
import type { SessionSummary } from "../types";

afterEach(cleanup);

const guide = TUNING_GUIDE_BY_ID.get("amd-gpu-undervolt")!;

const holding: TuningMeasurement = {
  verdict: "holding",
  headline: "Holding up so far",
  detail: "Peak GPU temp 84°C → 71°C (−13°C) — a real drop. Only your continued play proves it.",
  sessionsSince: 3,
  secsSince: 3 * 3600,
  windowMet: true,
  baselinePeakTempC: 84,
  afterPeakTempC: 71,
  tempDropC: 13,
  tempReal: true,
  low1DeltaPct: 2,
  fpsRegressed: false,
  fpsImproved: false,
  crashReported: false,
};

const recent: SessionSummary[] = [
  {
    started_at: "2026-06-08T18:00:00Z",
    duration_secs: 3600,
    process_name: "game.exe",
    samples: 100,
    avg_fps: 140,
    avg_frametime_ms: 7.1,
    low1_fps_est: 138,
    peak_gpu_temp_c: 71,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    stutter_insight: null,
  },
];

describe("TuningInstrument (Lab gauge)", () => {
  it("renders the shared guide body + the measured before/after readout", () => {
    render(
      <TuningInstrument guide={guide} vendor="amd" measurement={holding} recentSessions={recent} />,
    );
    // The guide copy (single source).
    expect(screen.getByText(/A "normal" number\?/i)).toBeInTheDocument();
    expect(screen.getByText("Show me the way")).toBeInTheDocument();
    // The honest, time-qualified verdict (never a bare "stable").
    expect(screen.getByText("Holding up so far")).toBeInTheDocument();
    expect(screen.getByText(/84°C → 71°C/, { selector: "b" })).toBeInTheDocument();
    expect(screen.getByText(/Stability & thermal/i)).toBeInTheDocument();
    // doorknob: a gauge, not a control — there is nothing to apply or arm here.
    expect(screen.queryByRole("button", { name: /apply|arm|undervolt now/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Compy never touches your voltage/i).length).toBeGreaterThan(0);
  });

  it("with no tune armed, shows the honest empty state (not a fake verdict)", () => {
    render(
      <TuningInstrument guide={guide} vendor="amd" measurement={null} recentSessions={recent} />,
    );
    expect(screen.getByText(/No tune measured yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Holding up so far/i)).not.toBeInTheDocument();
    // The always-on recent-sessions gauge still renders.
    expect(screen.getByText(/Recent sessions/i)).toBeInTheDocument();
  });
});
