// P5-outcomes (ROADMAP Phase 5 step 6, ENGINE §5–6): a choice exists only when one change on one game
// has a Recommended and a Maximum FPS result and exactly one of them judged it Better.
import { describe, expect, it } from "vitest";
import { outcomeChoices, type SummaryCandidate, type SummaryExperiment } from "./test-summary";

const GAME = "Valorant";
const trial = (over: Partial<SummaryExperiment>): SummaryExperiment => ({
  id: "exp:1",
  rec_id: "hags",
  rec_title: "Hardware-accelerated GPU scheduling",
  game: GAME,
  created_at: "2026-10-20T00:00:00Z",
  verdict: "regressed",
  kept: false,
  concluded_at: "2026-10-20T01:00:00Z",
  verdict_confidence: "medium",
  noise_evidence: { band_pct: 3, measured_noise_pct: null },
  treatment: { delta_low1_pct: -4, delta_avg_pct: 6 },
  outcome: "recommended",
  ...over,
});
// Recommended put it back (1% lows fell 4%); a later Maximum FPS Trial kept it (average up 6%).
const REC_OFF = trial({ id: "exp:rec" });
const MAX_KEEP = trial({
  id: "exp:max",
  created_at: "2026-10-22T00:00:00Z",
  verdict: "improved",
  kept: true,
  treatment: { delta_low1_pct: -2, delta_avg_pct: 6 },
  outcome: "max-fps",
});
const cand = (passes: boolean, reason: string | null = null): SummaryCandidate => ({ id: "hags", title: "HAGS", passes, reason, detail: null });

describe("CR-lesson-crash-not-result: a crashed treatment is no result", () => {
  it("a Recommended Trial put back for a crash gives no 'fell' reason, so no choice is offered from it", () => {
    expect(outcomeChoices(GAME, [REC_OFF, MAX_KEEP], null)).toHaveLength(1);
    const crashed = trial({ id: "exp:rec", treatment: { delta_low1_pct: -4, delta_avg_pct: 6, crashed: true }, stop_reason: "crash-during-treatment" });
    expect(outcomeChoices(GAME, [crashed, MAX_KEEP], null)).toEqual([]);
    // The stop reason alone (stacked with another tag) says the same.
    const stacked = trial({ id: "exp:rec", stop_reason: "crash-during-treatment; target-unreadable-at-conclude" });
    expect(outcomeChoices(GAME, [stacked, MAX_KEEP], null)).toEqual([]);
  });
});

describe("P5-outcomes: when Recommended and Maximum FPS disagree", () => {
  it("two differing results give one choice, naming the trade and the Better Trial", () => {
    const [c, ...rest] = outcomeChoices(GAME, [REC_OFF, MAX_KEEP], [cand(false, "already-set-by-compy")]);
    expect(rest).toEqual([]);
    expect(c).toMatchObject({
      recId: "hags",
      keepOutcome: "max-fps",
      keepTrialId: "exp:max",
      inEffect: "max-fps",
      recommended: { outcome: "recommended", trialId: "exp:rec", keeps: false, reason: "low-fell", pct: -4 },
      maxFps: { outcome: "max-fps", trialId: "exp:max", keeps: true, reason: "avg-up", pct: 6 },
    });
    // Put back now: the other side is in effect. Can't tell: nothing is in effect.
    expect(outcomeChoices(GAME, [REC_OFF, MAX_KEEP], [cand(true)])[0].inEffect).toBe("recommended");
    expect(outcomeChoices(GAME, [REC_OFF, MAX_KEEP], null)[0].inEffect).toBeNull();
    expect(outcomeChoices(GAME, [REC_OFF, MAX_KEEP], [cand(false, "already-set-unconfirmed")])[0].inEffect).toBeNull();
  });

  it("two agreeing results give no choice (the default already won)", () => {
    const bothKeep = [trial({ id: "a", verdict: "improved", treatment: { delta_low1_pct: 5, delta_avg_pct: 5 } }), { ...MAX_KEEP }];
    expect(outcomeChoices(GAME, bothKeep, null)).toEqual([]);
    const bothOff = [REC_OFF, trial({ id: "b", verdict: "no-change", outcome: "max-fps", treatment: { delta_low1_pct: 0, delta_avg_pct: 1 } })];
    expect(outcomeChoices(GAME, bothOff, null)).toEqual([]);
  });

  it("a single result gives no choice", () => {
    expect(outcomeChoices(GAME, [REC_OFF], null)).toEqual([]);
    expect(outcomeChoices(GAME, [MAX_KEEP], null)).toEqual([]);
    // Two Trials of the same outcome are still one result.
    expect(outcomeChoices(GAME, [REC_OFF, trial({ id: "c", verdict: "improved", created_at: "2026-10-23T00:00:00Z" })], null)).toEqual([]);
    // Another game's result is not this game's.
    expect(outcomeChoices(GAME, [REC_OFF, { ...MAX_KEEP, game: "cs2.exe" }], null)).toEqual([]);
  });

  it("a Trial that judged nothing is not a result, so it never makes a keep side", () => {
    for (const verdict of ["too-noisy", "confounded", "insufficient-evidence", "not-comparable", "expired"])
      expect(outcomeChoices(GAME, [REC_OFF, { ...MAX_KEEP, verdict }], null)).toEqual([]);
    expect(outcomeChoices(GAME, [REC_OFF, { ...MAX_KEEP, noise_evidence: null }], null)).toEqual([]);
    // Older records carry no outcome and were judged as Recommended.
    expect(outcomeChoices(GAME, [{ ...REC_OFF, outcome: undefined }, MAX_KEEP], null)).toHaveLength(1);
  });

  it("the newest result of each outcome is the one that stands", () => {
    const laterRecKeeps = trial({ id: "exp:rec2", created_at: "2026-10-24T00:00:00Z", verdict: "improved", kept: true, treatment: { delta_low1_pct: 5, delta_avg_pct: 1 } });
    expect(outcomeChoices(GAME, [REC_OFF, MAX_KEEP, laterRecKeeps], null)).toEqual([]);
  });

  it("each outcome's own reason, by its rule", () => {
    const why = (rec: Partial<SummaryExperiment>, max: Partial<SummaryExperiment>) => {
      const [c] = outcomeChoices(GAME, [trial({ id: "r", ...rec }), trial({ id: "m", outcome: "max-fps", ...max })], null);
      return [c.recommended.reason, c.maxFps.reason];
    };
    // Recommended kept on the 1% low; Maximum FPS put it back because the average fell or didn't rise.
    expect(why({ verdict: "improved", treatment: { delta_low1_pct: 5, delta_avg_pct: -2 } }, { verdict: "regressed", treatment: { delta_low1_pct: 5, delta_avg_pct: -5 } })).toEqual(["low-up", "avg-fell"]);
    expect(why({ verdict: "improved", treatment: { delta_low1_pct: 5, delta_avg_pct: 1 } }, { verdict: "no-change", treatment: { delta_low1_pct: 5, delta_avg_pct: 1 } })).toEqual(["low-up", "avg-flat"]);
    // Recommended put it back because the average fell, or wasn't compared; or the 1% low didn't rise.
    expect(why({ verdict: "no-change", treatment: { delta_low1_pct: 5, delta_avg_pct: -5 } }, { verdict: "improved" })).toEqual(["avg-fell", "avg-up"]);
    expect(why({ verdict: "no-change", treatment: { delta_low1_pct: 5, delta_avg_pct: null } }, { verdict: "improved" })).toEqual(["avg-unknown", "avg-up"]);
    expect(why({ verdict: "no-change", treatment: { delta_low1_pct: -1, delta_avg_pct: 6 } }, { verdict: "improved" })).toEqual(["low-flat", "avg-up"]);
  });
});
