// CR-cmp-wait: a same-game session under the 600 readings a comparison needs (or with no frame
// reading) left the armed comparison waiting, and the debrief said nothing about why.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { ArmedComparison, Priorities, SessionSummary } from "../types";
import "../i18n";

const state = vi.hoisted(() => ({ armed: null as unknown }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_armed_comparison") return Promise.resolve(state.armed);
    return Promise.resolve(null);
  }),
}));

import { SessionDebrief } from "./SessionDebrief";
import { ConfirmProvider } from "../design/ConfirmDialog";
import { comparisonWait } from "./comparison-wait";

const base: SessionSummary = {
  started_at: "2026-10-16T20:00:00Z",
  duration_secs: 400,
  process_name: "eldenring.exe",
  samples: 400,
  avg_fps: 160,
  avg_frametime_ms: 6.25,
  low1_fps_est: 140,
  peak_gpu_temp_c: 68,
  peak_gpu_usage_pct: 50,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 0,
  stutter_insight: null,
};

const armed: ArmedComparison = {
  rec_id: "power-plan",
  rec_title: "Power plan",
  game: "EldenRing.exe",
  baseline_avg_fps: 150,
  baseline_low1_fps: 120,
  armed_at: "2026-10-16T19:00:00Z",
};

const priorities: Priorities = {
  limiters: [],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
};

function show(s: SessionSummary) {
  return render(
    <ConfirmProvider>
      <SessionDebrief
        s={s}
        priorities={priorities}
        recs={[]}
        apply={async () => true}
        busyId={null}
        onExport={() => {}}
        changes={[]}
        rollback={async () => true}
      />
    </ConfirmProvider>,
  );
}

beforeEach(() => {
  state.armed = armed;
});
afterEach(cleanup);

describe("armed comparison waiting line", () => {
  it("says a short same-game session was too short to compare, with both counts", async () => {
    show(base);
    const line = await screen.findByTestId("cmp-wait");
    expect(line.textContent).toContain("400");
    expect(line.textContent).toContain("600");
    expect(line.textContent).toContain("Power plan");
  });

  it("says a session with no frame reading left it waiting", async () => {
    show({ ...base, samples: 900, avg_fps: 0, low1_fps_est: 0 });
    const line = await screen.findByTestId("cmp-wait");
    expect(line.textContent).toContain("No frame reading");
  });

  it("stays quiet for a long session, another game, or the baseline session itself", async () => {
    show({ ...base, samples: 900 });
    show({ ...base, process_name: "valorant.exe" });
    show({ ...base, started_at: "2026-10-16T18:00:00Z" });
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => expect(screen.queryAllByText(/Power plan/).length).toBe(0));
    expect(screen.queryByTestId("cmp-wait")).toBeNull();
  });

  it("stays quiet with nothing armed", async () => {
    state.armed = null;
    show(base);
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("cmp-wait")).toBeNull();
  });
});

describe("comparisonWait", () => {
  it("mirrors the Rust minimum and the case-insensitive game match", () => {
    expect(comparisonWait({ ...base, samples: 599 }, armed)).toEqual({ reason: "short", readings: 599, min: 600 });
    expect(comparisonWait({ ...base, samples: 600 }, armed)).toBeNull();
    expect(comparisonWait({ ...base, samples: 600, low1_fps_est: Number.NaN }, armed)).toEqual({ reason: "no-reading" });
  });
});
