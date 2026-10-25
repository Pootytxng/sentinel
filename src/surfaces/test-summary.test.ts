// P4-exit: the per-game "We tested what mattered on this PC" summary, on the owner's real WARDOGS
// records (src/test/fixtures/wardogs-p4-exit.json: read-only copies of experiments.json and the
// WARDOGS sessions, 2026-10-25).
import { describe, expect, it } from "vitest";
import fixture from "../test/fixtures/wardogs-p4-exit.json";
import type { SessionSummary } from "../types";
import { stillAppliedFrom, summarizeGame, type SummaryCandidate, type SummaryExperiment } from "./test-summary";

const GAME = "WardogsClient-Win64-Shipping.exe";
const experiments = fixture.experiments as unknown as SummaryExperiment[];
const sessions = fixture.sessions as unknown as SessionSummary[];

const cand = (id: string, passes: boolean, reason: string | null = null, position?: number): SummaryCandidate => ({
  id,
  title: id,
  passes,
  reason,
  detail: null,
  position: position ?? null,
});
// The owner's visual-effects change was restored, so the picker offers it again.
const VFX = cand("visual-effects", true, null, 1);

describe("P4-exit summary on the owner's WARDOGS records", () => {
  it("lists the one judged Trial: Slower, restored, confidence medium, not applied now", () => {
    const s = summarizeGame(GAME, experiments, [VFX], sessions)!;
    // The second record was an interrupted start with no verdict: it was never tested.
    expect(s.tested).toHaveLength(1);
    expect(s.tested[0]).toMatchObject({
      recId: "visual-effects",
      verdict: "regressed",
      kept: false,
      confidence: "medium",
      stillApplied: "off",
      trials: 1,
      sameContext: true,
    });
    expect(s.staysApplied).toEqual([]);
  });

  it("says which noise band judged it: Compy's 3% minimum, not measured for this game", () => {
    const s = summarizeGame(GAME, experiments, [VFX], sessions)!;
    expect(s.tested[0].noise).toEqual({ band_pct: 3.0, measured_noise_pct: null });
  });

  it("records the context: rig, graphics driver and Windows build of the newest WARDOGS session", () => {
    const s = summarizeGame(GAME, experiments, [VFX], sessions)!;
    expect(s.context).toEqual({
      gpu: "AMD Radeon RX 9070 XT",
      driver: "32.0.32015.7029",
      windowsBuild: "26200.8457",
      display: "1920x1080@250",
    });
  });

  it("says 'tested what mattered' only when nothing the picker offers is untested here", () => {
    const left = summarizeGame(GAME, experiments, [cand("visual-effects", true, null, 2), cand("mouse-accel-off", true, null, 1)], sessions)!;
    expect(left.headline).toBe("still-worth-testing");
    expect(left.leftToTest.map((c) => c.id)).toEqual(["mouse-accel-off"]);

    const done = summarizeGame(GAME, experiments, [VFX, cand("game-bar-disable", false, "already-set")], sessions)!;
    expect(done.headline).toBe("tested-what-mattered");
    expect(done.skipped.map((c) => [c.id, c.reason])).toEqual([["game-bar-disable", "already-set"]]);

    // The picker's list couldn't be read: never "tested what mattered", and "applied now" unknown.
    const unread = summarizeGame(GAME, experiments, null, sessions)!;
    expect(unread.headline).toBe("unknown");
    expect(unread.tested[0].stillApplied).toBe("unknown");
  });

  it("reads 'still applied' from the picker's live answer, whose 'set by Compy' is the shared ledger rule", () => {
    expect(stillAppliedFrom(cand("x", true))).toBe("off");
    expect(stillAppliedFrom(cand("x", false, "already-set-by-compy"))).toBe("on");
    expect(stillAppliedFrom(cand("x", false, "already-set-unconfirmed"))).toBe("cant-confirm");
    expect(stillAppliedFrom(cand("x", false, "already-set"))).toBe("set-not-by-compy");
    expect(stillAppliedFrom(cand("x", false, "already-set-by-gaming-mode"))).toBe("gaming-mode");
    expect(stillAppliedFrom(cand("x", false, "already-set-unchecked"))).toBe("unknown");
    expect(stillAppliedFrom(cand("x", false, "not-for-this-pc"))).toBe("unknown");
    expect(stillAppliedFrom(undefined)).toBe("unknown");

    const kept = experiments.map((x, i) => (i === 0 ? { ...x, verdict: "improved", kept: true } : x));
    const on = summarizeGame(GAME, kept, [cand("visual-effects", false, "already-set-by-compy")], sessions)!;
    expect(on.tested[0].stillApplied).toBe("on");
    expect(on.staysApplied.map((r) => r.recId)).toEqual(["visual-effects"]);
    const unsure = summarizeGame(GAME, kept, [cand("visual-effects", false, "already-set-unconfirmed")], sessions)!;
    expect(unsure.cantConfirm.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(unsure.staysApplied).toEqual([]);
  });

  it("a tested change the picker now leaves out is listed as tested, not as skipped", () => {
    const s = summarizeGame(GAME, experiments, [cand("visual-effects", false, "already-set-by-compy")], sessions)!;
    expect(s.skipped).toEqual([]);
    expect(s.headline).toBe("tested-what-mattered");
  });

  it("flags a Trial run under a different graphics driver than now", () => {
    const newer = { ...sessions[sessions.length - 1], started_at: "2026-10-26T00:00:00Z", hw_fingerprint: { ...sessions[0].hw_fingerprint!, gpu_driver: "33.0.1" } };
    const s = summarizeGame(GAME, experiments, [VFX], [...sessions, newer] as SessionSummary[])!;
    expect(s.tested[0].sameContext).toBe(false);
  });

  it("a game with no judged Trial has no summary", () => {
    expect(summarizeGame("cs2.exe", experiments, [VFX], sessions)).toBeNull();
  });
});
