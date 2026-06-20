import { describe, it, expect } from "vitest";
import {
  activeChangeCount,
  topLimiters,
  latestSession,
  leaveAloneCount,
  gameModeRevertedExternally,
} from "./dashboard-data";
import type { AppliedChange, Priorities, SessionSummary } from "../types";

const change = (over: Partial<AppliedChange>): AppliedChange => ({
  id: "c", rec_id: "r", rec_title: "t", applied_at: "2026-06-01T00:00:00Z",
  snapshot: null, status: "applied", is_still_active: true, ...over,
});

describe("activeChangeCount", () => {
  it("counts only applied + still-active changes", () => {
    const changes = [
      change({ status: "applied", is_still_active: true }),
      change({ status: "applied", is_still_active: false }),
      change({ status: "rolled_back", is_still_active: false }),
    ];
    expect(activeChangeCount(changes)).toBe(1);
  });
  it("handles empty", () => expect(activeChangeCount([])).toBe(0));
});

describe("gameModeRevertedExternally", () => {
  it("true when game-mode was applied but is no longer active (reset externally)", () => {
    expect(
      gameModeRevertedExternally([change({ rec_id: "game-mode", status: "applied", is_still_active: false })]),
    ).toBe(true);
  });
  it("false while game-mode is still active (held)", () => {
    expect(
      gameModeRevertedExternally([change({ rec_id: "game-mode", status: "applied", is_still_active: true })]),
    ).toBe(false);
  });
  it("false when the user rolled it back themselves (not an external revert)", () => {
    expect(
      gameModeRevertedExternally([change({ rec_id: "game-mode", status: "rolled_back", is_still_active: false })]),
    ).toBe(false);
  });
  it("ignores other recs that drifted", () => {
    expect(
      gameModeRevertedExternally([change({ rec_id: "hags-enable", status: "applied", is_still_active: false })]),
    ).toBe(false);
  });
  it("false with no changes", () => expect(gameModeRevertedExternally([])).toBe(false));
});

describe("topLimiters", () => {
  const p = (titles: string[]): Priorities => ({
    limiters: titles.map((t, i) => ({ id: `l${i}`, title: t, reason: "r", linked: null, confidence: "high", status: "attention" })),
    already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null,
  });
  it("returns the first n limiters", () => {
    expect(topLimiters(p(["a", "b", "c", "d"]), 3).map((x) => x.title)).toEqual(["a", "b", "c"]);
  });
  it("returns [] for null priorities", () => expect(topLimiters(null, 3)).toEqual([]));
});

describe("leaveAloneCount", () => {
  it("sums already_fine + not_worth_touching", () => {
    const p: Priorities = {
      limiters: [], session_hint: null, upgrade_path: null,
      already_fine: [{ id: "a", title: "", reason: "", linked: null, confidence: "high", status: "ready" }],
      not_worth_touching: [
        { id: "b", title: "", reason: "", linked: null, confidence: "low", status: "ready" },
        { id: "c", title: "", reason: "", linked: null, confidence: "low", status: "ready" },
      ],
    };
    expect(leaveAloneCount(p)).toBe(3);
  });
  it("0 for null", () => expect(leaveAloneCount(null)).toBe(0));
});

describe("latestSession", () => {
  const s = (started_at: string, name: string): SessionSummary => ({
    started_at, duration_secs: 1, process_name: name, samples: 1, avg_fps: 1,
    avg_frametime_ms: 1, low1_fps_est: 1, peak_gpu_temp_c: null, peak_gpu_usage_pct: null,
    peak_ram_used_bytes: null, ram_total_bytes: null, compy_changes_active: 0,
  });
  it("returns the most recent by started_at", () => {
    const out = latestSession([s("2026-05-01T10:00:00Z", "old"), s("2026-06-01T10:00:00Z", "new")]);
    expect(out?.process_name).toBe("new");
  });
  it("returns null for empty", () => expect(latestSession([])).toBeNull());
});
