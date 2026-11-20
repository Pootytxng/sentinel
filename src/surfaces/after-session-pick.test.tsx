// A game that crashes and is relaunched in one sitting now leaves TWO rows (a session belongs to one
// process): a full one and a short relaunch fragment, the fragment newer. A Trial concludes on the
// after-session it is handed; the fragment (under experiment.rs MIN_TREATMENT_SAMPLES) would read
// "insufficient evidence" and put the change back although a full reading is stored. Both pickers
// prefer a row with the full readings, newest first among those, and keep the plain newest otherwise.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import type { SessionSummary } from "../types";
import { fullAfterSessionsFirst, MIN_TREATMENT_SAMPLES } from "./baseline-grade";
import { treatmentFor } from "./ExperimentBench";
import { pickSavedSession } from "./GuidedJourney";

const row = (started_at: string, samples: number, game = "ROB RUN.exe") =>
  ({
    started_at,
    samples,
    process_name: game,
    avg_fps: 200,
    low1_fps_est: 120,
    duration_secs: samples,
  }) as unknown as SessionSummary;

const A1 = row("2026-11-20T10:00:00Z", 2400);
const A2 = row("2026-11-20T10:50:00Z", 120); // newer relaunch fragment
const exp = (over: Record<string, unknown> = {}) =>
  ({
    game: "ROB RUN.exe",
    applied_at: "2026-11-20T09:00:00Z",
    baseline_session_id: "2026-11-20T08:00:00Z",
    ...over,
  }) as never;

describe("the shared floor", () => {
  it("is the Rust MIN_TREATMENT_SAMPLES", () => {
    const rs = readFileSync("src-tauri/src/experiment.rs", "utf8");
    expect(rs).toContain("pub(crate) const MIN_TREATMENT_SAMPLES: u32 = 600;");
    expect(MIN_TREATMENT_SAMPLES).toBe(600);
  });
});

describe("fullAfterSessionsFirst", () => {
  it("puts a full row before a newer short one, newest first within each group", () => {
    const older = row("2026-11-20T09:30:00Z", 900);
    expect(fullAfterSessionsFirst([A2, A1, older]).map((s) => s.started_at)).toEqual([A1.started_at, older.started_at, A2.started_at]);
  });
  it("with no full row it is plain newest first", () => {
    const x = row("2026-11-20T10:00:00Z", 100);
    const y = row("2026-11-20T10:30:00Z", 300);
    expect(fullAfterSessionsFirst([x, y])[0]).toBe(y);
  });
  it("exactly 600 counts as full", () => {
    const edge = row("2026-11-20T10:00:00Z", 600);
    expect(fullAfterSessionsFirst([edge, A2])[0]).toBe(edge);
  });
});

describe("Trial bench: treatmentFor", () => {
  it("[A1 2400 readings, A2 120 readings and newer] picks A1", () => {
    expect(treatmentFor(exp(), [A2, A1])).toBe(A1);
  });
  it("[only A2] picks A2: nothing full exists, so today's choice stands", () => {
    expect(treatmentFor(exp(), [A2])).toBe(A2);
  });
  it("still ignores another game and a row from before the change", () => {
    const other = row("2026-11-20T11:00:00Z", 5000, "PBZ.exe");
    const before = row("2026-11-20T08:30:00Z", 5000);
    expect(treatmentFor(exp(), [other, before, A2])).toBe(A2);
  });
});

describe("Guided journey: pickSavedSession", () => {
  const since = Date.parse("2026-11-20T09:00:00Z");
  it("[A1 2400 readings, A2 120 readings and newer] picks A1", () => {
    expect(pickSavedSession([A2, A1], since, "ROB RUN.exe")).toBe(A1);
  });
  it("[only A2] picks A2", () => {
    expect(pickSavedSession([A2], since, "ROB RUN.exe")).toBe(A2);
  });
  it("never returns the baseline it was told to skip, and respects the game", () => {
    const other = row("2026-11-20T11:00:00Z", 5000, "PBZ.exe");
    expect(pickSavedSession([A1, A2, other], since, "ROB RUN.exe", A1.started_at)).toBe(A2);
  });
});
