import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));

import { TuningDebrief } from "./TuningDebrief";
import { ConfirmProvider } from "../design/ConfirmDialog";
import type { SessionSummary, ArmedComparison } from "../types";

afterEach(cleanup);

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    started_at: "2026-06-08T13:00:00Z",
    duration_secs: 3600,
    process_name: "game.exe",
    samples: 100,
    avg_fps: 140,
    avg_frametime_ms: 7.1,
    low1_fps_est: 138,
    peak_gpu_temp_c: 84,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    stutter_insight: null,
    ...over,
  };
}

const renderTD = (s: SessionSummary, sessions: SessionSummary[]) =>
  render(
    <ConfirmProvider>
      <TuningDebrief s={s} vendor="amd" sessions={sessions} />
    </ConfirmProvider>,
  );

let armedValue: ArmedComparison | null = null;
// CR-tuning-temp-comparability: the backend's per-session comparability list (null = not read).
let comparableValue: { started_at: string; comparable: boolean }[] | null = null;
beforeEach(() => {
  armedValue = null;
  comparableValue = null;
  invokeMock.mockReset();
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "get_armed_comparison") return Promise.resolve(armedValue);
    if (cmd === "get_tuning_comparability") return Promise.resolve(comparableValue);
    if (cmd === "get_latest_comparison") return Promise.resolve(null);
    return Promise.resolve(null);
  });
});

describe("TuningDebrief (Play before/after)", () => {
  it("renders nothing for a non-AMD rig (v1 verified-sensor scope)", () => {
    const { container } = render(
      <ConfirmProvider>
        <TuningDebrief s={session()} vendor="nvidia" sessions={[]} />
      </ConfirmProvider>,
    );
    expect(container.querySelector(".td-arm")).toBeNull();
    expect(container.querySelector(".td-measure")).toBeNull();
  });

  it("with no baseline armed, shows the arm affordance and arms a tuning baseline (no mutation)", async () => {
    renderTD(session(), []);
    const armBtn = await screen.findByRole("button", { name: /I undervolted — measure it/i });
    fireEvent.click(armBtn);
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("arm_tuning", {
        guideId: "amd-gpu-undervolt",
        label: "Undervolt your Radeon",
        game: "game.exe",
        baselineAvgFps: 140,
        baselineLow1Fps: 138,
        baselinePeakTempC: 84,
      }),
    );
  });

  it("with a tuning baseline armed for this game, shows the time-qualified verdict + crash self-check", async () => {
    armedValue = {
      rec_id: "amd-gpu-undervolt",
      rec_title: "Undervolt your Radeon",
      game: "game.exe",
      baseline_avg_fps: 138,
      baseline_low1_fps: 138,
      armed_at: "2026-06-08T12:00:00Z",
      kind: "tuning",
      baseline_peak_temp_c: 84,
      crash_reported: false,
    };
    const post = [
      session({ started_at: "2026-06-08T18:00:00Z", peak_gpu_temp_c: 71 }),
      session({ started_at: "2026-06-08T16:00:00Z", peak_gpu_temp_c: 70 }),
      session({ started_at: "2026-06-08T14:00:00Z", peak_gpu_temp_c: 71 }),
    ];
    comparableValue = post.map((p) => ({ started_at: p.started_at, comparable: true }));
    renderTD(session({ started_at: "2026-06-08T11:00:00Z" }), post);
    // Holding up so far — temps down, frames held, window met (never a bare "stable").
    expect(await screen.findByText("Holding up so far")).toBeInTheDocument();
    // The once-asked crash self-check (bathroom law).
    const crashBtn = screen.getByRole("button", { name: /Yes — too aggressive/i });
    fireEvent.click(crashBtn);
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("report_tuning_crash"));
  });

  it("hides the crash self-check once a crash is already reported", async () => {
    armedValue = {
      rec_id: "amd-gpu-undervolt",
      rec_title: "Undervolt your Radeon",
      game: "game.exe",
      baseline_avg_fps: 138,
      baseline_low1_fps: 138,
      armed_at: "2026-06-08T12:00:00Z",
      kind: "tuning",
      baseline_peak_temp_c: 84,
      crash_reported: true,
    };
    renderTD(session({ started_at: "2026-06-08T11:00:00Z" }), [
      session({ started_at: "2026-06-08T14:00:00Z", peak_gpu_temp_c: 71 }),
    ]);
    expect(await screen.findByText("Too aggressive")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Yes — too aggressive/i })).not.toBeInTheDocument();
  });
});
