import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { SessionTrends } from "./SessionTrends";
import type { SessionSummary } from "../types";

// V2-9 punch (j) guard: under the v2 Monitor room the RoomShell measured line already states
// "N sessions on record", so the History & trends header must NOT restate the count — one
// screen never states the same fact twice. Absent/false (classic) keeps the count (byte-identical).

afterEach(cleanup);

const session = (over: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    process_name: "valorant.exe",
    started_at: "2026-07-01T10:00:00Z",
    ended_at: "2026-07-01T10:42:00Z",
    duration_secs: 2520,
    avg_fps: 240,
    low1_fps_est: 200,
    avg_frametime_ms: 4.2,
    peak_gpu_temp_c: 65,
    samples: 3412,
    ...over,
  }) as SessionSummary;

// Two sessions of the same game clear computeSessionTrends' ≥2 threshold so the header renders.
const sessions = [session(), session({ started_at: "2026-07-02T10:00:00Z", avg_fps: 250 })];

describe("SessionTrends — hideCount (V2-9 punch j)", () => {
  const sub = (c: HTMLElement) => c.querySelector(".strends-sub")?.textContent ?? "";

  it("classic (default) keeps the sessions-kept count in the header", () => {
    const { container } = render(<SessionTrends sessions={sessions} />);
    expect(sub(container)).toMatch(/2 sessions kept/);
  });

  it("hideCount drops the count (the room's measured line carries it) but keeps best", () => {
    const { container } = render(<SessionTrends sessions={sessions} hideCount />);
    // The header sub no longer restates the count…
    expect(sub(container)).not.toMatch(/sessions kept/);
    // …but still carries what it alone owns — the best-fps fact survives.
    expect(sub(container)).toMatch(/best 250 fps/);
  });
});
