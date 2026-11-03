// Codebase review 2026-11-02: the debrief's fix button armed a before/after comparison whatever the
// apply did (a cancelled confirm or a failed apply still armed it, and the next session credited a
// change that was never made), and from raw readings (an unmeasured session's 0 became the baseline).
// Its "Revert it" deleted the measured result whether or not anything was undone, and undid the
// oldest live row of the change rather than the newest.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { AppliedChange, ComparisonResult, Priorities, Recommendation, SessionSummary } from "../types";
import "../i18n";

const state = vi.hoisted(() => ({ latest: null as unknown }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_latest_comparison") return Promise.resolve(state.latest);
    return Promise.resolve(null);
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { SessionDebrief } from "./SessionDebrief";
import { ConfirmProvider } from "../design/ConfirmDialog";

const session: SessionSummary = {
  started_at: "2026-10-16T20:00:00Z",
  duration_secs: 3600,
  process_name: "eldenring.exe",
  samples: 900,
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

const rec: Recommendation = {
  id: "power-plan",
  title: "Switch to the Ultimate Performance power plan",
  category: "power",
  severity: "safe",
  description: "",
  impact: "",
  downside: null,
  applies_to: "any",
  currently_applied: false,
  provenance: "verified",
};

const priorities: Priorities = {
  limiters: [
    { id: "power-plan", title: "Power plan", reason: "Windows is on Balanced.", linked: "power-plan", confidence: "medium", status: "attention" },
  ],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
};

const row = (id: string, applied_at: string): AppliedChange => ({
  id,
  rec_id: "power-plan",
  rec_title: "Power plan",
  applied_at,
  snapshot: null,
  status: "applied",
  is_still_active: true,
  active_check: "on",
});

const result: ComparisonResult = {
  rec_id: "power-plan",
  rec_title: "Power plan",
  game: "eldenring.exe",
  baseline_avg_fps: 160,
  baseline_low1_fps: 140,
  after_avg_fps: 161,
  after_low1_fps: 140,
  delta_avg_pct: 0.6,
  delta_low1_pct: 0,
  noise_floor_pct: 3,
  verdict: "no-change",
  kind: "fix",
};

const draw = (over: {
  s?: SessionSummary;
  apply?: (r: Recommendation) => Promise<boolean>;
  rollback?: (c: AppliedChange) => Promise<boolean>;
  changes?: AppliedChange[];
}) =>
  render(
    <ConfirmProvider>
      <SessionDebrief
        s={over.s ?? session}
        priorities={priorities}
        recs={[rec]}
        apply={over.apply ?? vi.fn(() => Promise.resolve(true))}
        busyId={null}
        onExport={vi.fn()}
        changes={over.changes ?? []}
        rollback={over.rollback ?? vi.fn(() => Promise.resolve(true))}
      />
    </ConfirmProvider>,
  );

const calls = (cmd: string) => vi.mocked(invoke).mock.calls.filter(([c]) => c === cmd).map(([, a]) => a);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  state.latest = null;
  vi.mocked(invoke).mockClear();
});
afterEach(cleanup);

describe("the debrief arms a before/after only for a change it applied, from real readings", () => {
  it("a cancelled or failed apply arms nothing", async () => {
    const apply = vi.fn(() => Promise.resolve(false));
    draw({ apply });
    fireEvent.click(await screen.findByRole("button", { name: /compare next session/ }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    await flush();
    expect(calls("arm_comparison")).toEqual([]);
  });

  it("an applied fix arms from this session's two readings", async () => {
    draw({});
    fireEvent.click(await screen.findByRole("button", { name: /compare next session/ }));
    await waitFor(() => expect(calls("arm_comparison")).toHaveLength(1));
    expect(calls("arm_comparison")[0]).toMatchObject({ recId: "power-plan", baselineAvgFps: 160, baselineLow1Fps: 140 });
  });

  it.each([
    ["no average", { avg_fps: 0 }],
    ["no 1% low", { low1_fps_est: Number.NaN }],
  ])("a session with %s still applies the fix but arms nothing", async (_what, over) => {
    const apply = vi.fn(() => Promise.resolve(true));
    draw({ s: { ...session, ...over }, apply });
    fireEvent.click(await screen.findByRole("button", { name: /compare next session/ }));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
    await flush();
    expect(calls("arm_comparison")).toEqual([]);
  });
});

describe("Revert it undoes the newest live apply, and keeps the result until that undo is recorded", () => {
  const OLD = row("c-old", "2026-10-10T10:00:00Z");
  const NEW = row("c-new", "2026-10-15T10:00:00Z");

  it("a cancelled or failed undo keeps the measured result", async () => {
    state.latest = result;
    const rollback = vi.fn(() => Promise.resolve(false));
    draw({ rollback, changes: [OLD, NEW] });
    fireEvent.click(await screen.findByRole("button", { name: "Revert it — no shame" }));
    await waitFor(() => expect(rollback).toHaveBeenCalledTimes(1));
    expect(rollback).toHaveBeenCalledWith(NEW);
    await flush();
    expect(calls("dismiss_comparison")).toEqual([]);
    expect(screen.getByTestId("cmp-card")).toBeInTheDocument();
  });

  it("a recorded undo clears the result", async () => {
    state.latest = result;
    const rollback = vi.fn(() => Promise.resolve(true));
    draw({ rollback, changes: [OLD, NEW] });
    fireEvent.click(await screen.findByRole("button", { name: "Revert it — no shame" }));
    await waitFor(() => expect(calls("dismiss_comparison")).toHaveLength(1));
    expect(rollback).toHaveBeenCalledWith(NEW);
    await waitFor(() => expect(screen.queryByTestId("cmp-card")).toBeNull());
  });
});
