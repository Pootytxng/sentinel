// P4-exit: the per-game "What Compy tested on this PC" summary, on the owner's real WARDOGS
// records (src/test/fixtures/wardogs-p4-exit.json: read-only copies of experiments.json and the
// WARDOGS sessions, 2026-10-25).
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import fixture from "../test/fixtures/wardogs-p4-exit.json";
import today from "../test/fixtures/p5-learned-today.json";
import type { SessionSummary } from "../types";
import { knowledgeByIdForLanguage } from "../data/knowledge";
import {
  LESSON_KEY,
  LESSON_LIBRARY_ID,
  LESSON_RULES,
  avgBandOf,
  fallsOf,
  fellOn,
  worseOn,
  lessonDirs,
  lowBandOf,
  lessonFor,
  lessonRuleFor,
  lessonRuleForVerdict,
  outcomeChoices,
  stillAppliedFrom,
  summarizeGame,
  type SummaryCandidate,
  type SummaryExperiment,
  type TestedChange,
} from "./test-summary";
import { stillOnFor, type ResumeExperiment } from "./journey-resume";

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

  // P8-posture-show (RISK_MODEL §2): each row carries the risk the user allowed when its newest judged
  // Trial started, from that Trial's record; the owner's records predate it, so it is not recorded
  // (null), never the default. Fails on the code before this slice (no such field).
  it("each row names the risk allowed when its newest Trial started; an older record has none", () => {
    expect(summarizeGame(GAME, experiments, [VFX], sessions)!.tested[0].riskChoice).toBeNull();
    for (const [stored, want] of [["low-only", "low-only"], ["low-and-moderate", "low-and-moderate"], ["anything-goes", null], [null, null]] as const) {
      const xs = experiments.map((x) => ({ ...x, risk_choice: stored }));
      expect(summarizeGame(GAME, xs, [VFX], sessions)!.tested[0].riskChoice, String(stored)).toBe(want);
    }
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

  it("says it finished the supported tests only when nothing the picker offers is untested here", () => {
    const left = summarizeGame(GAME, experiments, [cand("visual-effects", true, null, 2), cand("mouse-accel-off", true, null, 1)], sessions)!;
    expect(left.headline).toBe("still-worth-testing");
    expect(left.leftToTest.map((c) => c.id)).toEqual(["mouse-accel-off"]);

    const done = summarizeGame(GAME, experiments, [VFX, cand("game-bar-disable", false, "already-set")], sessions)!;
    expect(done.headline).toBe("finished-supported-tests");
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

  // CR-summary-running-trial (evidence _train\view-1111a\o-08-resume-midtrial.json): a retest Trial on
  // a restored change is running, so the picker reads it "set by Compy". That is the running Trial's own
  // apply: on for that test, never "Applied now" or "Stays applied". Fails on the old summary.
  it("a change a running Trial has on reads as on for that test, never as staying applied", () => {
    const retest = { ...experiments[0], id: "exp:retest", verdict: null, kept: false, concluded_at: null, status: "running", created_at: "2026-11-11T05:00:00Z" };
    const xs = [...experiments, retest];
    const s = summarizeGame(GAME, xs, [cand("visual-effects", false, "already-set-by-compy")], sessions)!;
    expect(s.tested).toHaveLength(1);
    expect(s.tested[0].stillApplied).toBe("trial");
    expect(s.staysApplied).toEqual([]);
    // The same answer with no Trial running is still "applied now" and stays.
    const kept = experiments.map((x, i) => (i === 0 ? { ...x, verdict: "improved", kept: true } : x));
    expect(summarizeGame(GAME, kept, [cand("visual-effects", false, "already-set-by-compy")], sessions)!.staysApplied.map((r) => r.recId)).toEqual(["visual-effects"]);
    // A record no longer running does not count.
    const done = [...experiments, { ...retest, status: "restored" }];
    expect(summarizeGame(GAME, done, [cand("visual-effects", false, "already-set-by-compy")], sessions)!.tested[0].stillApplied).toBe("on");
    // The journey's "still on" list does not claim a kept change a running retest has on again.
    const keptThenRetest = [...kept, retest] as unknown as ResumeExperiment[];
    expect(stillOnFor(GAME, keptThenRetest, [cand("visual-effects", false, "already-set-by-compy")])).toEqual([]);
    expect(stillOnFor(GAME, kept as unknown as ResumeExperiment[], [cand("visual-effects", false, "already-set-by-compy")])).toEqual([
      experiments[0].rec_title,
    ]);
  });

  it("a tested change the picker now leaves out is listed as tested, not as skipped", () => {
    const s = summarizeGame(GAME, experiments, [cand("visual-effects", false, "already-set-by-compy")], sessions)!;
    expect(s.skipped).toEqual([]);
    expect(s.headline).toBe("finished-supported-tests");
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

// P8-posture-b (RISK_MODEL §2): a change above the risk the user chose is held back, not set. The
// summary must never read it as "Compy applied it", and never claim the game is fully tested.
describe("P8-posture-b: a change outside the chosen risk", () => {
  const held = (id: string) => cand(id, false, "outside-chosen-risk");
  const newer: SessionSummary = {
    ...sessions[sessions.length - 1],
    started_at: "2026-10-26T00:00:00Z",
    hw_fingerprint: { ...sessions[0].hw_fingerprint!, gpu_driver: "33.0.1" },
  } as SessionSummary;

  it("is not applied now", () => {
    expect(stillAppliedFrom(held("x"))).toBe("off");
  });

  it("turns 'finished' into 'finished within the risk you chose' and lists what is above it", () => {
    const s = summarizeGame(GAME, experiments, [VFX, held("mouse-accel-off")], sessions)!;
    expect(s.headline).toBe("finished-within-chosen-risk");
    expect(s.outsideRisk.map((c) => c.id)).toEqual(["mouse-accel-off"]);
    expect(s.skipped.map((c) => c.id)).toContain("mouse-accel-off");
    const all = summarizeGame(GAME, experiments, [VFX], sessions)!;
    expect(all.headline).toBe("finished-supported-tests");
    expect(all.outsideRisk).toEqual([]);
  });

  it("a stale result for a held change is not 'kept and set', and does not by itself ask for a retest", () => {
    const s = summarizeGame(GAME, experiments, [held("visual-effects")], [...sessions, newer])!;
    expect(s.stale.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(s.staleKept).toEqual([]);
    expect(s.tested[0].stillApplied).toBe("off");
    expect(s.headline).not.toBe("worth-retesting");
    expect(s.headline).not.toBe("finished-supported-tests");
  });

  // P8-posture-count (review r1 NITs): each case fails on the code before this fix.
  it("a held change already tested here is listed as tested, not counted as 'above it'", () => {
    const s = summarizeGame(GAME, experiments, [held("visual-effects"), held("mouse-accel-off")], sessions)!;
    expect(s.tested.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(s.outsideRisk.map((c) => c.id)).toEqual(["mouse-accel-off"]);
    expect(s.headline).toBe("finished-within-chosen-risk");
    // Only the tested held change: nothing untested is above the chosen risk.
    const onlyTested = summarizeGame(GAME, experiments, [held("visual-effects")], sessions)!;
    expect(onlyTested.outsideRisk).toEqual([]);
    expect(onlyTested.headline).toBe("finished-supported-tests");
  });

  it("a held stale result is not counted as needing another run in the stop counts", () => {
    const s = summarizeGame(GAME, experiments, [held("visual-effects")], [...sessions, newer])!;
    expect(s.stale.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(s.staleAsked).toEqual([]);
    expect(s.stop.stale).toBe(0);
    // The same stale result on a change the picker still offers IS asked for, and counted.
    const offered = summarizeGame(GAME, experiments, [VFX], [...sessions, newer])!;
    expect(offered.staleAsked.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(offered.stop.stale).toBe(1);
  });

  // P8-posture-stale-copy: the stopping point holds a (stale) measured result, so it is carried apart
  // and the copy never says "nothing was measured".
  it("a held change whose only result is stale is listed in staleHeld", () => {
    const s = summarizeGame(GAME, experiments, [held("visual-effects")], [...sessions, newer])!;
    expect(s.headline).toBe("nothing-testable-now");
    expect(s.stop.measured).toBe(0);
    expect(s.staleHeld.map((r) => r.recId)).toEqual(["visual-effects"]);
    const offered = summarizeGame(GAME, experiments, [VFX], [...sessions, newer])!;
    expect(offered.staleHeld).toEqual([]);
  });
});

// P5-learned (ROADMAP Phase 5 step 8): kept / put back and why, and at most one lesson from the
// documented rule table, on the owner's records as of 2026-10-25 15:28 (src/test/fixtures/
// p5-learned-today.json: today's Aniimo too-noisy Trial and the WARDOGS visual-effects Trial).

describe("P5-learned on the owner's records today", () => {
  const ex = today.experiments as unknown as SummaryExperiment[];
  const ss = today.sessions as unknown as SessionSummary[];

  it("WARDOGS: visual effects put back as Slower; lesson: less steady, average not compared", () => {
    const s = summarizeGame(GAME, ex, [VFX], ss)!;
    expect(s.kept).toEqual([]);
    expect(s.putBack.map((r) => [r.recId, r.verdict])).toEqual([["visual-effects", "regressed"]]);
    expect(s.lesson).toEqual({
      rule: "less-steady",
      recId: "visual-effects",
      title: "Trim Windows visual effects",
      confidence: "medium",
      low1Pct: -18.5,
      avgPct: null,
      bandPct: 3.0,
      avgBandPct: null,
    });
  });

  it("Aniimo: put back as too noisy; lesson: the game swings between sessions, confidence unknown", () => {
    const s = summarizeGame("Aniimo.exe", ex, [VFX], ss)!;
    expect(s.putBack.map((r) => [r.recId, r.verdict])).toEqual([["visual-effects", "too-noisy"]]);
    // Its stored deltas (-15.5% / -16%) are never read: a too-noisy Trial judged nothing.
    expect(s.lesson).toEqual({
      rule: "too-noisy",
      recId: "visual-effects",
      title: "Trim Windows visual effects",
      confidence: "unknown",
      low1Pct: null,
      avgPct: null,
      bandPct: null,
      avgBandPct: null,
    });
  });
});

describe("P5-learned lesson rules", () => {
  const row = (over: Partial<TestedChange>): TestedChange => ({
    recId: "x",
    title: "X",
    verdict: "improved",
    measured: true,
    unusableRuns: 0,
    kept: true,
    confidence: "medium",
    stillApplied: "on",
    noise: { band_pct: 3, measured_noise_pct: null },
    trials: 1,
    sameContext: null,
    context: "unverified",
    deltaLow1Pct: 0,
    deltaAvgPct: 0,
    avgBandPct: 3,
    at: "2026-10-25T10:00:00Z",
    riskChoice: null,
    ...over,
  });
  const v = (d: string): number | null => (d === "up" ? 5 : d === "down" ? -5 : d === "flat" ? 1 : null);

  it("each documented rule fires on exactly its condition", () => {
    for (const [key, rule] of Object.entries(LESSON_RULES)) {
      const [l, a] = key.split("/");
      expect(lessonFor([row({ deltaLow1Pct: v(l), deltaAvgPct: v(a) })])?.rule).toBe(rule);
    }
    expect(Object.keys(LESSON_RULES)).toHaveLength(10);
  });

  it("'steadier, not faster': 1% low up beyond the band, average within it", () => {
    expect(lessonFor([row({ deltaLow1Pct: 4.2, deltaAvgPct: 0.8 })])?.rule).toBe("steadier-not-faster");
    // Exactly at the band is within it, not beyond.
    expect(lessonFor([row({ deltaLow1Pct: 3, deltaAvgPct: 0.8 })])).toBeNull();
  });

  it("no rule, no lesson: nothing moved, or the verdict judged nothing, or no band was recorded", () => {
    expect(lessonFor([row({ deltaLow1Pct: 1, deltaAvgPct: -1 })])).toBeNull();
    expect(lessonFor([row({ deltaLow1Pct: 2, deltaAvgPct: null })])).toBeNull();
    for (const verdict of ["confounded", "expired", "insufficient-evidence", "not-comparable"])
      expect(lessonFor([row({ verdict, deltaLow1Pct: 20, deltaAvgPct: 0 })])).toBeNull();
    expect(lessonFor([row({ noise: null, deltaLow1Pct: 20, deltaAvgPct: 0 })])).toBeNull();
    expect(lessonFor([row({ deltaLow1Pct: null, deltaAvgPct: 20 })])).toBeNull();
    expect(lessonFor([])).toBeNull();
  });

  it("one lesson: measured rules newest first, then too noisy", () => {
    const older = row({ recId: "a", deltaLow1Pct: 6, deltaAvgPct: 6, at: "2026-10-20T00:00:00Z" });
    const newer = row({ recId: "b", deltaLow1Pct: -6, deltaAvgPct: 0, at: "2026-10-24T00:00:00Z" });
    const noisy = row({ recId: "c", verdict: "too-noisy", noise: null, at: "2026-10-25T00:00:00Z" });
    expect(lessonFor([older, newer, noisy])).toMatchObject({ recId: "b", rule: "less-steady-not-slower" });
    expect(lessonFor([noisy, row({ recId: "d", deltaLow1Pct: 0, deltaAvgPct: 0 })])).toMatchObject({ recId: "c", rule: "too-noisy" });
  });

  // P7-teach: one rule function behind every surface that teaches from personal evidence (the Trial
  // summary, the Debrief comparison card, the Care stutter comparison), plus the Library entry each
  // rule links. Fails on the code before the slice (no shared `lessonRuleFor`).
  describe("lessonRuleFor is the shared rule for one measured result", () => {
    it("reads the same table as lessonFor, with the band as the line", () => {
      expect(lessonRuleFor("improved", 4.2, 0.8, 3, 3)).toBe("steadier-not-faster");
      expect(lessonRuleFor("regressed", -12.5, -0.8, 3, 3)).toBe("less-steady-not-slower");
      expect(lessonRuleFor("no-change", 5, 5, 3, 3)).toBe("faster-and-steadier");
      expect(lessonRuleFor("improved", 4, null, 3, 3)).toBe("steadier");
      expect(lessonRuleFor("improved", 3, 3, 3, 3)).toBeNull(); // exactly the band = flat/flat
      expect(lessonRuleFor("regressed", -2, 1, 3, 3)).toBeNull();
    });
    it("no rule without a measured verdict, a band and a 1% low delta, or with a non-finite number", () => {
      for (const v of ["too-noisy", "confounded", "expired", "inconclusive", "insufficient-evidence", null, undefined])
        expect(lessonRuleFor(v, 20, 0, 3, 3)).toBeNull();
      expect(lessonRuleFor("improved", null, 20, 3, 3)).toBeNull();
      expect(lessonRuleFor("improved", 20, 0, null, null)).toBeNull();
      expect(lessonRuleFor("improved", Number.NaN, 0, 3, 3)).toBeNull();
      expect(lessonRuleFor("improved", 20, Number.POSITIVE_INFINITY, 3, 3)).toBeNull();
    });
    it("lessonRuleForVerdict drops a rule whose 1% low direction disagrees with the stored verdict", () => {
      expect(lessonRuleForVerdict("improved", 7.9, 0.9, 3, 3)).toBe("steadier-not-faster");
      expect(lessonRuleForVerdict("regressed", -12.5, -0.8, 3, 3)).toBe("less-steady-not-slower");
      // The verdict is judged on the 1% low; the average may still move beyond the floor.
      expect(lessonRuleForVerdict("no-change", 0.7, 8, 3, 3)).toBe("faster-not-steadier");
      // Contradictions: the stored verdict wins, so nothing is taught.
      expect(lessonRuleForVerdict("no-change", 5, 5, 3, 3)).toBeNull();
      expect(lessonRuleForVerdict("improved", -12.5, 0, 3, 3)).toBeNull();
      expect(lessonRuleForVerdict("regressed", 0, 8, 3, 3)).toBeNull();
      expect(lessonRuleForVerdict("confounded", 20, 0, 3, 3)).toBeNull();
    });
    it("every rule's copy exists where the Debrief and the stutter comparison read it (en + zh-CN)", () => {
      const load = (lang: string, area: string) =>
        JSON.parse(readFileSync(join("src", "i18n", "locales", lang, `${area}.json`), "utf8"));
      for (const lang of ["en", "zh-CN"]) {
        const lab = load(lang, "lab") as { experimentBench: { summary: { lesson: Record<string, string> } } };
        const common = load(lang, "common") as { lesson: { label: string; sessions: Record<string, string> } };
        expect(common.lesson.label, lang).toBeTruthy();
        for (const key of Object.values(LESSON_KEY)) {
          expect(lab.experimentBench.summary.lesson[key], `${lang} lab ${key}`).toBeTruthy();
          expect(common.lesson.sessions[key], `${lang} common ${key}`).toBeTruthy();
        }
      }
    });
    it("lessonDirs recovers each measured rule's directions; too-noisy has none", () => {
      for (const [key, rule] of Object.entries(LESSON_RULES)) {
        const [low1, avg] = key.split("/");
        expect(lessonDirs(rule)).toEqual({ low1, avg });
      }
      expect(lessonDirs("too-noisy")).toBeNull();
    });
    it("every rule has a copy key and links a Library entry that exists in both languages", () => {
      const rules = [...new Set(Object.values(LESSON_RULES)), "too-noisy"] as const;
      expect(Object.keys(LESSON_KEY).sort()).toEqual([...rules].sort());
      expect(Object.keys(LESSON_LIBRARY_ID).sort()).toEqual([...rules].sort());
      for (const lang of ["en", "zh-CN"]) {
        const byId = knowledgeByIdForLanguage(lang);
        for (const rule of rules) expect(byId.has(LESSON_LIBRARY_ID[rule]), `${lang} ${rule}`).toBe(true);
      }
      expect(LESSON_LIBRARY_ID["too-noisy"]).toBe("noise-floor");
      expect(LESSON_LIBRARY_ID.steadier).toBe("one-percent-lows");
    });
  });
});

// TRUTHFUL COMPLETION (critical review 2026-10-26 §4, reproduced on the owner's WARDOGS records):
// a journey counted "too noisy to judge" as a finished test, and a result judged under an older
// driver and Windows build still read "We tested what mattered". An attempt is not a result; a stale
// result is not a result that still holds. Each case below fails on the code before this fix.
describe("truthful completion: attempts and stale results are not finished tests", () => {
  const judged = experiments.find((x) => x.verdict != null)!;
  const noisy = (over: Partial<SummaryExperiment> = {}): SummaryExperiment => ({
    ...judged,
    status: "restored",
    kept: false,
    verdict: "too-noisy",
    verdict_confidence: "low",
    ...over,
  } as SummaryExperiment);
  // The reviewer's second input: a newer WARDOGS session under a different driver and Windows build.
  const newerContext: SessionSummary = {
    ...sessions[sessions.length - 1],
    started_at: "2026-10-26T00:00:00Z",
    hw_fingerprint: { ...sessions[0].hw_fingerprint!, gpu_driver: "33.0.1" },
    game_state: { ...(sessions[0].game_state ?? {}), windows_build: "26200.9000" },
  } as SessionSummary;

  it("one inconclusive attempt the picker still offers is 'worth another run', never finished", () => {
    const s = summarizeGame(GAME, [noisy()], [VFX], sessions)!;
    expect(s.tested).toHaveLength(1);
    expect(s.tested[0]).toMatchObject({ recId: "visual-effects", measured: false, unusableRuns: 1 });
    expect(s.headline).toBe("worth-retesting");
    expect(s.inconclusive.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(s.retest.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(s.unjudged).toEqual([]);
    expect(s.leftToTest).toEqual([]);
  });

  it("a measured result judged under an older driver and Windows build is stale, never finished", () => {
    const s = summarizeGame(GAME, experiments, [VFX], [...sessions, newerContext])!;
    expect(s.tested[0]).toMatchObject({ measured: true, sameContext: false });
    expect(s.headline).toBe("worth-retesting");
    expect(s.stale.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(s.retest.map((r) => r.recId)).toEqual(["visual-effects"]);
  });

  it("the reviewer's exact pair: inconclusive AND the context changed is still not finished", () => {
    const s = summarizeGame(GAME, [noisy()], [VFX], [...sessions, newerContext])!;
    expect(s.headline).toBe("worth-retesting");
    // An inconclusive attempt is never a stale result: it was never a result.
    expect(s.stale).toEqual([]);
    expect(s.retest.map((r) => r.recId)).toEqual(["visual-effects"]);
  });

  it("untested changes come before retests, and a stale result the picker no longer offers blocks 'finished'", () => {
    const left = summarizeGame(GAME, [noisy()], [VFX, cand("mouse-accel-off", true, null, 2)], sessions)!;
    expect(left.headline).toBe("still-worth-testing");
    expect(left.leftToTest.map((c) => c.id)).toEqual(["mouse-accel-off"]);
    expect(left.retest.map((r) => r.recId)).toEqual(["visual-effects"]);
    const keptStale = experiments.map((x) => (x.id === judged.id ? { ...x, verdict: "improved", kept: true } : x));
    const s = summarizeGame(GAME, keptStale, [cand("visual-effects", false, "already-set-by-compy")], [...sessions, newerContext])!;
    expect(s.headline).toBe("worth-retesting");
    expect(s.stale.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(s.retest).toEqual([]); // the picker can't offer it while it is set
  });

  it("two inconclusive runs in a row: this PC gives up on that change, honestly, and may then finish", () => {
    const twice = [noisy({ id: "exp:1-a", created_at: "2026-10-24T10:00:00Z", concluded_at: "2026-10-24T11:00:00Z" }), noisy({ id: "exp:1-b", created_at: "2026-10-25T10:00:00Z", concluded_at: "2026-10-25T11:00:00Z" })];
    const s = summarizeGame(GAME, twice, [VFX], sessions)!;
    expect(s.tested[0]).toMatchObject({ measured: false, unusableRuns: 2, trials: 2 });
    expect(s.unjudged.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(s.retest).toEqual([]);
    // Follow-up §3: giving up is not finishing. Nothing was measured, so Compy says that instead.
    expect(s.headline).toBe("nothing-testable-now");
    // A measured result after an inconclusive one resets the count: that change has a result.
    const thenMeasured = [...twice, { ...judged, id: "exp:1-c", created_at: "2026-10-26T10:00:00Z", concluded_at: "2026-10-26T11:00:00Z" }];
    const m = summarizeGame(GAME, thenMeasured, [VFX], sessions)!;
    expect(m.tested[0]).toMatchObject({ measured: true, unusableRuns: 0, trials: 3 });
    expect(m.headline).toBe("finished-supported-tests");
    // Round 3 §2: a measured result on ONE change beside two capped attempts on ANOTHER is not "finished".
    const other = [...twice, { ...judged, id: "exp:o", rec_id: "mouse-accel-off", rec_title: "mouse" }];
    expect(summarizeGame(GAME, other, [VFX], sessions)!.headline).toBe("nothing-testable-now");
  });

  it("unknown context stays unknown: a Trial that recorded no driver or build is never stale, and never finished either", () => {
    const bare = sessions.map((s) => ({ ...s, hw_fingerprint: null, game_state: null })) as SessionSummary[];
    const s = summarizeGame(GAME, experiments, [VFX], bare)!;
    expect(s.tested[0].sameContext).toBeNull();
    expect(s.stale).toEqual([]);
    // Follow-up §2: unverified is not proof the result applies now, so the claim is not "finished";
    // round 3: offered again, it is worth another run under a recorded context.
    expect(s.headline).toBe("worth-retesting");
  });
});

// FOLLOW-UP REVIEW 2026-10-26 (§1 evidence validity, §2 context classes, §3 false completion).
// Each case below fails on the code before this fix.
describe("follow-up: one validity rule for summary, journey and outcome switch", () => {
  const judged = experiments.find((x) => x.verdict != null)!;
  const latest = sessions[sessions.length - 1];
  const withHw = (over: Partial<NonNullable<SessionSummary["hw_fingerprint"]>>, gs: Record<string, unknown> = {}): SessionSummary =>
    ({ ...latest, started_at: "2026-10-26T00:00:00Z", hw_fingerprint: { ...latest.hw_fingerprint!, ...over }, game_state: { ...(latest.game_state ?? {}), ...gs } }) as SessionSummary;
  const noisy = (id: string, at: string, base = judged.baseline_session_id): SummaryExperiment =>
    ({ ...judged, id, status: "restored", kept: false, verdict: "too-noisy", created_at: at, concluded_at: at, baseline_session_id: base }) as SummaryExperiment;

  it("§2: a different GPU with the same driver and Windows build is a changed context, not matching", () => {
    const newerGpu = withHw({ gpu: "AMD Radeon RX 9999" });
    const s = summarizeGame(GAME, experiments, [VFX], [...sessions, newerGpu])!;
    expect(s.tested[0]).toMatchObject({ context: "changed", sameContext: false });
    expect(s.headline).toBe("worth-retesting");
    expect(s.stale.map((r) => r.recId)).toEqual(["visual-effects"]);
  });

  it("§2: an unverified context is neither matching nor changed, and is never 'finished'", () => {
    const bare = sessions.map((x) => ({ ...x, hw_fingerprint: null, game_state: null })) as SessionSummary[];
    const s = summarizeGame(GAME, experiments, [VFX], bare)!;
    expect(s.tested[0]).toMatchObject({ context: "unverified", sameContext: null });
    expect(s.stale).toEqual([]);
    // Round 2: a measured result that can't be tied to this PC is said as that, not as "nothing measured".
    // Round 3: and while the picker still offers the change, that is the route to fresh evidence.
    expect(s.unverified.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(s.retest.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(s.headline).toBe("worth-retesting");
  });

  it("§2: two inconclusive runs, then a driver change: the cap counts only attempts under comparable conditions", () => {
    const twice = [noisy("exp:a", "2026-10-24T10:00:00Z"), noisy("exp:b", "2026-10-25T10:00:00Z")];
    expect(summarizeGame(GAME, twice, [VFX], sessions)!.tested[0].unusableRuns).toBe(2);
    const newerDriver = withHw({ gpu_driver: "33.0.1" }, { windows_build: "26200.9000" });
    const s = summarizeGame(GAME, twice, [VFX], [...sessions, newerDriver])!;
    expect(s.tested[0].unusableRuns).toBe(0);
    expect(s.unjudged).toEqual([]);
    expect(s.retest.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(s.headline).toBe("worth-retesting");
  });

  it("§3: an inconclusive attempt whose change is no longer offered is 'nothing testable now', never 'finished'", () => {
    const s = summarizeGame(GAME, [noisy("exp:a", "2026-10-24T10:00:00Z")], [cand("visual-effects", false, "already-set")], sessions)!;
    expect(s.tested[0].measured).toBe(false);
    expect(s.leftToTest).toEqual([]);
    expect(s.retest).toEqual([]);
    expect(s.headline).toBe("nothing-testable-now");
    // Two capped attempts, nothing else listed: also not "finished" — nothing was measured.
    const twice = [noisy("exp:a", "2026-10-24T10:00:00Z"), noisy("exp:b", "2026-10-25T10:00:00Z")];
    expect(summarizeGame(GAME, twice, [VFX], sessions)!.headline).toBe("nothing-testable-now");
    // A measured, matching result beside two capped attempts: round 3 §2 says that is a stop, not "finished"
    // (one measured, one this PC couldn't judge).
    const beside = summarizeGame(GAME, [...twice, { ...judged, rec_id: "mouse-accel-off", rec_title: "mouse", id: "exp:m" }], [VFX], sessions)!;
    expect(beside.headline).toBe("nothing-testable-now");
    expect(beside.stop).toEqual({ measured: 1, noResult: 1, unverified: 0, stale: 0 });
  });

  it("P4-smooth-offer-b: a Smoothest Trial is never one side of the Recommended / Maximum FPS trade", () => {
    const base = sessions[0].started_at;
    const max = { ...judged, id: "exp:x", rec_id: "hags", rec_title: "HAGS", outcome: "max-fps" as const, verdict: "no-change", kept: false, baseline_session_id: base, treatment: { delta_low1_pct: 0.5, delta_avg_pct: 0.2 }, noise_evidence: { band_pct: 3, measured_noise_pct: null } } as SummaryExperiment;
    // Judged Better for Smoothest, newer: read as Recommended it would fake a disagreement to switch on.
    const smooth = { ...max, id: "exp:s", outcome: "smoothest" as const, verdict: "improved", kept: true, created_at: "2099-01-01T00:00:00Z", treatment: { delta_low1_pct: 0.5, delta_avg_pct: 0 } } as SummaryExperiment;
    expect(outcomeChoices(GAME, [max, smooth], [cand("hags", false, "already-set-by-compy")], sessions)).toEqual([]);
  });

  it("§1: the outcome switch never offers a keep whose Trial ran under a changed context", () => {
    const base = sessions[0].started_at;
    const rec = { ...judged, id: "exp:r", rec_id: "hags", rec_title: "HAGS", outcome: "recommended" as const, verdict: "no-change", kept: false, baseline_session_id: base, treatment: { delta_low1_pct: 0.5, delta_avg_pct: 0.2 }, noise_evidence: { band_pct: 3, measured_noise_pct: null } } as SummaryExperiment;
    const max = { ...rec, id: "exp:x", outcome: "max-fps" as const, verdict: "improved", kept: true, treatment: { delta_low1_pct: 0.5, delta_avg_pct: 6 } } as SummaryExperiment;
    const on = [cand("hags", false, "already-set-by-compy")];
    const same = outcomeChoices(GAME, [rec, max], on, sessions);
    expect(same).toHaveLength(1);
    expect(same[0]).toMatchObject({ keepOutcome: "max-fps", keepTrialId: "exp:x", keepContext: "matching", keepStale: false, inEffect: "max-fps" });
    const changed = outcomeChoices(GAME, [rec, max], on, [...sessions, withHw({ gpu_driver: "33.0.1" }, { windows_build: "26200.9000" })]);
    expect(changed[0]).toMatchObject({ keepContext: "changed", keepStale: true });
    // Round 2: without sessions nothing ties the result to this PC, and that is not proof either:
    // the keep side is withheld the same way (one validity rule: matching only).
    expect(outcomeChoices(GAME, [rec, max], on)[0]).toMatchObject({ keepContext: "unverified", keepStale: true });
  });

  it("round 2 §3: 'finished' needs every measured result to match, not just one", () => {
    const matching = experiments.find((x) => x.verdict != null)!;
    const unverifiedOther = { ...matching, id: "exp:u", rec_id: "mouse-accel-off", rec_title: "mouse", baseline_session_id: "no-such-session" } as SummaryExperiment;
    const s = summarizeGame(GAME, [matching, unverifiedOther], [VFX, cand("mouse-accel-off", true, null, 2)], sessions)!;
    expect(s.tested.map((r) => [r.recId, r.context])).toEqual([["visual-effects", "matching"], ["mouse-accel-off", "unverified"]]);
    expect(s.unverified.map((r) => r.recId)).toEqual(["mouse-accel-off"]);
    // Offered again: worth another run. Not offered (set): results-unverified. Never "finished".
    expect(s.headline).toBe("worth-retesting");
    const set = summarizeGame(GAME, [matching, unverifiedOther], [VFX, cand("mouse-accel-off", false, "already-set-by-compy")], sessions)!;
    expect(set.headline).toBe("results-unverified");
  });
});

// FOLLOW-UP REVIEW 2026-10-26, ROUND 3: the fixes held for the reported examples and failed on
// nearby combinations. These combine context (matching / changed / unverified), results (measured /
// inconclusive) and availability (offered / not), and check what is said AND what is offered.
describe("round 3: combinations of context, result and availability", () => {
  const judged = experiments.find((x) => x.verdict != null)!;
  const latest = sessions[sessions.length - 1];
  const bareNewest = { ...latest, started_at: "2026-10-27T00:00:00Z", hw_fingerprint: null, game_state: null } as SessionSummary;
  const noisy = (id: string, rec = "visual-effects", at = "2026-10-24T10:00:00Z"): SummaryExperiment =>
    ({ ...judged, id, rec_id: rec, rec_title: rec, status: "restored", kept: false, verdict: "too-noisy", created_at: at, concluded_at: at }) as SummaryExperiment;
  const measuredOther = { ...judged, id: "exp:m", rec_id: "mouse-accel-off", rec_title: "mouse", created_at: "2026-10-25T10:00:00Z", concluded_at: "2026-10-25T10:00:00Z" } as SummaryExperiment;

  it("§1: the NEWEST session is the reference; a newer session with no context leaves results unverified even when an older one was complete", () => {
    // Older sessions record GPU/driver/build and match the Trial; the newest records nothing.
    const s = summarizeGame(GAME, experiments, [cand("visual-effects", false, "already-set-by-compy")], [...sessions, bareNewest])!;
    expect(s.tested[0].context).toBe("unverified");
    expect(s.headline).toBe("results-unverified");
    // The last-known context is still shown; it just doesn't establish "now".
    expect(s.context?.driver).toBe("32.0.32015.7029");
    // A newest session with a DIFFERENT gpu but no driver/build is still "changed", not unverified.
    const otherGpuNewest = { ...bareNewest, hw_fingerprint: { ...latest.hw_fingerprint!, gpu: "AMD Radeon RX 9999", gpu_driver: "" } } as SessionSummary;
    expect(summarizeGame(GAME, experiments, [VFX], [...sessions, otherGpuNewest])!.tested[0].context).toBe("changed");
  });

  it("§1: an unverified keep is never offered by the outcome switch even if an older session matched", () => {
    const base = sessions[0].started_at;
    const rec = { ...judged, id: "exp:r", rec_id: "hags", rec_title: "HAGS", outcome: "recommended" as const, verdict: "no-change", kept: false, baseline_session_id: base, treatment: { delta_low1_pct: 0.5, delta_avg_pct: 0.2 }, noise_evidence: { band_pct: 3, measured_noise_pct: null } } as SummaryExperiment;
    const max = { ...rec, id: "exp:x", outcome: "max-fps" as const, verdict: "improved", kept: true, treatment: { delta_low1_pct: 0.5, delta_avg_pct: 6 } } as SummaryExperiment;
    const c = outcomeChoices(GAME, [rec, max], [cand("hags", false, "already-set-by-compy")], [...sessions, bareNewest]);
    expect(c[0]).toMatchObject({ keepContext: "unverified", keepStale: true });
  });

  it("§2: one measured change does not speak for another change's unjudged attempt", () => {
    // A measured and matching, B inconclusive once and no longer offered: not finished, and the stop says both.
    const s = summarizeGame(GAME, [measuredOther, noisy("exp:a")], [cand("visual-effects", false, "already-set")], sessions)!;
    expect(s.leftToTest).toEqual([]);
    expect(s.retest).toEqual([]);
    expect(s.unjudged).toEqual([]); // under the cap, merely unavailable
    expect(s.headline).toBe("nothing-testable-now");
    expect(s.stop).toEqual({ measured: 1, noResult: 1, unverified: 0, stale: 0 });
    // The same two with B still offered: worth another run, B first in the retest list.
    const offered = summarizeGame(GAME, [measuredOther, noisy("exp:a")], [VFX], sessions)!;
    expect(offered.headline).toBe("worth-retesting");
    expect(offered.retest.map((r) => r.recId)).toEqual(["visual-effects"]);
    // Only A, measured and matching: finished, and the stop says so.
    const only = summarizeGame(GAME, [measuredOther], [], sessions)!;
    expect(only.headline).toBe("finished-supported-tests");
    expect(only.stop).toEqual({ measured: 1, noResult: 0, unverified: 0, stale: 0 });
  });

  it("§3: an unverified measured result the picker still offers is worth another run (the route to fresh evidence)", () => {
    const s = summarizeGame(GAME, experiments, [VFX], [...sessions, bareNewest])!;
    expect(s.unverified.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(s.retest.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(s.headline).toBe("worth-retesting");
  });

  it("matrix: every (context × result × offered) cell is said and offered consistently", () => {
    const changedNewest = { ...latest, started_at: "2026-10-27T00:00:00Z", hw_fingerprint: { ...latest.hw_fingerprint!, gpu_driver: "33.0.1" }, game_state: { ...(latest.game_state ?? {}), windows_build: "26200.9000" } } as SessionSummary;
    const ctx: Record<string, SessionSummary[]> = { matching: sessions, changed: [...sessions, changedNewest], unverified: [...sessions, bareNewest] };
    const res: Record<string, SummaryExperiment[]> = { measured: [judged], inconclusive: [noisy("exp:a")] };
    const offer: Record<string, SummaryCandidate[]> = { offered: [VFX], unavailable: [cand("visual-effects", false, "already-set")] };
    const table: Record<string, { headline: string; retest: boolean }> = {};
    for (const [cn, ss] of Object.entries(ctx)) for (const [rn, xs] of Object.entries(res)) for (const [on, cs] of Object.entries(offer)) {
      const s = summarizeGame(GAME, xs, cs, ss)!;
      table[`${cn}/${rn}/${on}`] = { headline: s.headline, retest: s.retest.length > 0 };
    }
    expect(table).toEqual({
      "matching/measured/offered": { headline: "finished-supported-tests", retest: false },
      "matching/measured/unavailable": { headline: "finished-supported-tests", retest: false },
      "matching/inconclusive/offered": { headline: "worth-retesting", retest: true },
      "matching/inconclusive/unavailable": { headline: "nothing-testable-now", retest: false },
      "changed/measured/offered": { headline: "worth-retesting", retest: true },
      "changed/measured/unavailable": { headline: "worth-retesting", retest: false }, // stale, kept: listed as staleKept
      "changed/inconclusive/offered": { headline: "worth-retesting", retest: true },
      "changed/inconclusive/unavailable": { headline: "nothing-testable-now", retest: false },
      "unverified/measured/offered": { headline: "worth-retesting", retest: true },
      "unverified/measured/unavailable": { headline: "results-unverified", retest: false },
      "unverified/inconclusive/offered": { headline: "worth-retesting", retest: true },
      "unverified/inconclusive/unavailable": { headline: "nothing-testable-now", retest: false },
    });
    // "finished" is claimed in exactly the two cells where a measured result matches now and nothing is unjudged.
  });

  it("round 3 review MUST-FIX 1: an unverified result is offered again at most twice in a row, then said as unverified", () => {
    const u = (id: string, at: string) => ({ ...judged, id, created_at: at, concluded_at: at }) as SummaryExperiment;
    const ctx = [...sessions, bareNewest];
    const once = summarizeGame(GAME, [u("exp:1", "2026-10-24T10:00:00Z")], [VFX], ctx)!;
    expect(once.tested[0].unusableRuns).toBe(1);
    expect(once.retest.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(once.headline).toBe("worth-retesting");
    const twice = summarizeGame(GAME, [u("exp:1", "2026-10-24T10:00:00Z"), u("exp:2", "2026-10-25T10:00:00Z")], [VFX], ctx)!;
    expect(twice.tested[0].unusableRuns).toBe(2);
    expect(twice.retest).toEqual([]);
    expect(twice.headline).toBe("results-unverified");
    // A matching run in between resets the count: the newest decides.
    const reset = summarizeGame(GAME, [u("exp:1", "2026-10-24T10:00:00Z"), u("exp:2", "2026-10-25T10:00:00Z")], [VFX], sessions)!;
    expect(reset.tested[0].unusableRuns).toBe(0);
    expect(reset.headline).toBe("finished-supported-tests");
  });
  // REVIEW ROUND 4 (2026-10-27): "changing failure reasons defeats the retry limit". Fails on the
  // code before this fix (two counters, each reset by the other: six alternating attempts, six offers).
  it("round 4: alternating unverified and inconclusive attempts draw on ONE budget and reach the cap", () => {
    const ctx = [...sessions, bareNewest]; // the newest session recorded no context: measured = unverified
    const u = (id: string, at: string) => ({ ...judged, id, created_at: at, concluded_at: at }) as SummaryExperiment;
    const alternating = [
      u("exp:1", "2026-10-20T10:00:00Z"),
      noisy("exp:2", "visual-effects", "2026-10-21T10:00:00Z"),
      u("exp:3", "2026-10-22T10:00:00Z"),
      noisy("exp:4", "visual-effects", "2026-10-23T10:00:00Z"),
    ];
    // After the first unusable attempt one more run is offered, whichever reason it was.
    const one = summarizeGame(GAME, alternating.slice(0, 1), [VFX], ctx)!;
    expect(one.tested[0].unusableRuns).toBe(1);
    expect(one.retest.map((r) => r.recId)).toEqual(["visual-effects"]);
    // The second attempt judged nothing: the budget is spent, not reset by the change of reason.
    const two = summarizeGame(GAME, alternating.slice(0, 2), [VFX], ctx)!;
    expect(two.tested[0].unusableRuns).toBe(2);
    expect(two.retest).toEqual([]);
    expect(two.unjudged.map((r) => r.recId)).toEqual(["visual-effects"]);
    expect(two.headline).toBe("nothing-testable-now");
    // Nor by a third of the first kind: the count keeps growing and nothing is offered.
    const four = summarizeGame(GAME, alternating, [VFX], ctx)!;
    expect(four.tested[0].unusableRuns).toBe(4);
    expect(four.retest).toEqual([]);
    // A measured result under a MATCHING context is what resets the budget.
    const reset = summarizeGame(GAME, alternating, [VFX], sessions)!;
    expect(reset.tested[0]).toMatchObject({ unusableRuns: 1, measured: false }); // only the newest noisy run counts
    expect(reset.retest.map((r) => r.recId)).toEqual(["visual-effects"]);
  });

  it("round 4: the summary carries WHEN the last recorded context was recorded, and null when none was", () => {
    const s = summarizeGame(GAME, experiments, [VFX], sessions)!;
    expect(s.context).not.toBeNull();
    expect(s.contextAt).toBe(latest.started_at);
    const bare = sessions.map((x) => ({ ...x, hw_fingerprint: null, game_state: null })) as SessionSummary[];
    const none = summarizeGame(GAME, experiments, [VFX], bare)!;
    expect(none.context).toBeNull();
    expect(none.contextAt).toBeNull();
  });
});

// CR-lesson-avg-band: the average's direction is read against the band the AVERAGE was judged on,
// never the 1% low's. ROB RUN's measured bands (1% low ±23%, average ±18%) make the two differ.
describe("CR-lesson-avg-band: the average reads against its own band", () => {
  const judged = experiments.find((x) => x.verdict != null)!;
  const base = sessions[0].started_at;
  const trial = (over: Partial<SummaryExperiment>): SummaryExperiment =>
    ({
      ...judged,
      id: "exp:avg",
      rec_id: "hags",
      rec_title: "HAGS",
      outcome: "recommended",
      verdict: "improved",
      kept: true,
      created_at: "2099-01-01T00:00:00Z",
      concluded_at: "2099-01-01T01:00:00Z",
      baseline_session_id: base,
      noise_evidence: { band_pct: 23, measured_noise_pct: null },
      game_noise: { low1_band_pct: 23, avg_band_pct: 18 },
      treatment: { delta_low1_pct: 30, delta_avg_pct: 20 },
      ...over,
    }) as SummaryExperiment;

  it("an average past its own band reads as moved even inside the 1% low's band, and the reverse", () => {
    // +20% average: inside the 1% low's ±23%, past its own ±18%.
    expect(lessonRuleFor("improved", 30, 20, 23, 18)).toBe("faster-and-steadier");
    // +5% average: past a ±3% 1% low band, inside its own ±10%.
    expect(lessonRuleFor("improved", 8, 5, 3, 10)).toBe("steadier-not-faster");
    expect(lessonRuleFor("regressed", -30, -20, 23, 18)).toBe("slower-and-less-steady");
    expect(lessonRuleForVerdict("no-change", 1, 20, 23, 18)).toBe("faster-not-steadier");
  });

  it("an unknown average band reads the average as not compared, never against the 1% low's band", () => {
    expect(lessonRuleFor("improved", 30, 20, 23, null)).toBe("steadier");
    expect(lessonRuleFor("regressed", -30, 0, 23, undefined)).toBe("less-steady");
    expect(lessonRuleFor("improved", 30, 20, 23, Number.NaN)).toBe("steadier");
    // 1% low flat with the average not compared: no rule.
    expect(lessonRuleFor("no-change", 1, 40, 23, null)).toBeNull();
  });

  it("avgBandOf: the band the average was judged on, per outcome", () => {
    expect(avgBandOf(trial({}))).toBe(18);
    expect(avgBandOf(trial({ outcome: null }))).toBe(18); // older records were judged as Recommended
    expect(avgBandOf(trial({ outcome: "max-fps" }))).toBe(23); // the wider band, both numbers
    // Opus r1: on a measured record noise_evidence holds the 1% low's band; Maximum FPS takes the wider.
    const narrowLow = { noise_evidence: { band_pct: 3, measured_noise_pct: null }, game_noise: { low1_band_pct: 3, avg_band_pct: 10 } };
    expect(avgBandOf(trial({ outcome: "max-fps", ...narrowLow }))).toBe(10);
    expect(avgBandOf(trial({ outcome: "max-fps", game_noise: { avg_band_pct: 10 } }))).toBeNull();
    expect(avgBandOf(trial({ outcome: "smoothest", game_noise: null }))).toBeNull();
    expect(avgBandOf(trial({ outcome: "smoothest" }))).toBeNull(); // the average is never judged
    expect(avgBandOf(trial({ game_noise: { low1_band_pct: 23 } }))).toBeNull(); // measured, no avg band
    // An older record without measured bands was judged on one band both ways.
    expect(avgBandOf(trial({ game_noise: null, noise_evidence: { band_pct: 3, measured_noise_pct: null } }))).toBe(3);
    expect(avgBandOf(trial({ game_noise: undefined, noise_evidence: null }))).toBeNull();
  });

  it("the Trial summary's lesson reads the stored average against the game's average band", () => {
    const s = summarizeGame(GAME, [...experiments, trial({})], [VFX], sessions)!;
    expect(s.lesson).toMatchObject({ recId: "hags", rule: "faster-and-steadier", bandPct: 23, avgBandPct: 18 });
    const inside = summarizeGame(GAME, [...experiments, trial({ treatment: { delta_low1_pct: 30, delta_avg_pct: 15 } })], [VFX], sessions)!;
    expect(inside.lesson).toMatchObject({ recId: "hags", rule: "steadier-not-faster" });
    const noAvgBand = summarizeGame(GAME, [...experiments, trial({ game_noise: { low1_band_pct: 23 } })], [VFX], sessions)!;
    expect(noAvgBand.lesson).toMatchObject({ recId: "hags", rule: "steadier" });
  });

  // Opus r2 MUST-FIX: a real-play Trial judges both numbers on its look's one band, never on the
  // start-time game_noise it also stores.
  it("a real-play Trial reads the average on the band it was judged on", () => {
    const rp = trial({ mode: "real-play", noise_evidence: { band_pct: 5, measured_noise_pct: null }, treatment: { delta_low1_pct: 8, delta_avg_pct: 10 } });
    expect(avgBandOf(rp)).toBe(5);
    const s = summarizeGame(GAME, [...experiments, rp], [VFX], sessions)!;
    expect(s.lesson).toMatchObject({ recId: "hags", rule: "faster-and-steadier", bandPct: 5, avgBandPct: 5 });
    const max = { ...rp, id: "exp:x", outcome: "max-fps" as const, verdict: "improved", kept: true, treatment: { delta_low1_pct: 8, delta_avg_pct: 30 } } as SummaryExperiment;
    const fell = { ...rp, verdict: "no-change", kept: false, treatment: { delta_low1_pct: 8, delta_avg_pct: -10 } } as SummaryExperiment;
    const on = [cand("hags", false, "already-set-by-compy")];
    expect(outcomeChoices(GAME, [fell, max], on, sessions)[0].recommended).toMatchObject({ reason: "avg-fell", pct: -10 });
  });

  // Opus r2 SHOULD-FIX: Maximum FPS judges the 1% low on the wider band too.
  it("a Maximum FPS Trial reads both numbers on the wider measured band", () => {
    const wide = { noise_evidence: { band_pct: 3, measured_noise_pct: null }, game_noise: { low1_band_pct: 3, avg_band_pct: 10 } };
    // 1% low +6: past its own 3%, inside the wider 10% the verdict used: no 1% low lesson.
    const max = trial({ outcome: "max-fps", verdict: "improved", kept: true, ...wide, treatment: { delta_low1_pct: 6, delta_avg_pct: 12 } });
    expect(lowBandOf(max)).toBe(10);
    const s = summarizeGame(GAME, [...experiments, max], [VFX], sessions)!;
    expect(s.lesson).toMatchObject({ recId: "hags", rule: "faster-not-steadier", bandPct: 10, avgBandPct: 10 });
    // Regressed on Maximum FPS with the average -8%: inside the wider band, so the reason is the 1% low.
    const rec = trial({ outcome: "recommended", verdict: "improved", kept: true, ...wide, treatment: { delta_low1_pct: 6, delta_avg_pct: 1 } });
    const worse = { ...max, id: "exp:w", verdict: "regressed", treatment: { delta_low1_pct: -12, delta_avg_pct: -8 } } as SummaryExperiment;
    const on = [cand("hags", false, "already-set-by-compy")];
    expect(outcomeChoices(GAME, [rec, worse], on, sessions)[0].maxFps).toMatchObject({ reason: "low-fell" });
  });

  it("the outcome switch names 'the average fell' only past the average's own band", () => {
    const rec = trial({ verdict: "no-change", kept: false, treatment: { delta_low1_pct: 30, delta_avg_pct: -12 }, game_noise: { low1_band_pct: 23, avg_band_pct: 10 } });
    const max = { ...rec, id: "exp:x", outcome: "max-fps" as const, verdict: "improved", kept: true, treatment: { delta_low1_pct: 30, delta_avg_pct: 30 } } as SummaryExperiment;
    const on = [cand("hags", false, "already-set-by-compy")];
    expect(outcomeChoices(GAME, [rec, max], on, sessions)[0].recommended).toMatchObject({ reason: "avg-fell", pct: -12 });
    const noBand = { ...rec, game_noise: { low1_band_pct: 23 } } as SummaryExperiment;
    expect(outcomeChoices(GAME, [noBand, max], on, sessions)[0].recommended).toMatchObject({ reason: "avg-unknown", pct: null });
  });
});

// CR-lesson-fall-band (s33 review): a fall is read at the fall the result was judged at. From noise
// model 3 the engine judges a fall at the matching fall (noise_floor.rs `fall_pct`: +20.6% <-> -17.0%,
// 10% <-> -9.0%); before it, the band both ways; a record that doesn't say which can't call a fall in
// between.
describe("CR-lesson-fall-band: a fall is read at the fall it was judged at", () => {
  const judged = experiments.find((x) => x.verdict != null)!;
  const base = sessions[0].started_at;
  const LOG = { low1_band_pct: 20.6, avg_band_pct: 10, model: 3 };
  const trial = (over: Partial<SummaryExperiment>): SummaryExperiment =>
    ({
      ...judged,
      id: "exp:fall",
      rec_id: "hags",
      rec_title: "HAGS",
      outcome: "recommended",
      mode: null,
      verdict: "regressed",
      kept: false,
      created_at: "2099-01-01T00:00:00Z",
      concluded_at: "2099-01-01T01:00:00Z",
      baseline_session_id: base,
      noise_evidence: { band_pct: 20.6, measured_noise_pct: null },
      game_noise: LOG,
      treatment: { delta_low1_pct: -18, delta_avg_pct: 0 },
      ...over,
    }) as SummaryExperiment;
  const m = { low: "matching", avg: "matching" } as const;
  const u = { low: "unknown", avg: "unknown" } as const;

  it("fallsOf: the rule each kind of record was judged on", () => {
    expect(fallsOf(trial({}))).toEqual(m);
    expect(fallsOf(trial({ outcome: "max-fps" }))).toEqual(m);
    expect(fallsOf(trial({ game_noise: { ...LOG, model: 2 } }))).toEqual({ low: "same", avg: "same" });
    expect(fallsOf(trial({ game_noise: null }))).toEqual({ low: "same", avg: "same" });
    // Real play: the 1% low is classified on the look's band both ways, except under Maximum FPS.
    expect(fallsOf(trial({ mode: "real-play" }))).toEqual({ low: "same", avg: "matching" });
    expect(fallsOf(trial({ mode: "real-play", outcome: "max-fps" }))).toEqual(m);
    // Its stored noise doesn't prove the build that judged it: can't call a fall in between.
    expect(fallsOf(trial({ mode: "real-play", game_noise: null }))).toEqual({ low: "same", avg: "unknown" });
    expect(fallsOf(trial({ mode: "real-play", outcome: "max-fps", game_noise: null }))).toEqual(u);
  });

  it("lessonRuleFor reads a fall at the matching fall, the same band, or not at all", () => {
    // -18% 1% low: past the matching -17.0%, inside the band read both ways.
    expect(lessonRuleFor("regressed", -18, 0, 20.6, 10, m)).toBe("less-steady-not-slower");
    expect(lessonRuleFor("regressed", -18, 0, 20.6, 10)).toBeNull();
    // -9.5% average: past the matching -9.0% of its 10% band, inside it read both ways.
    expect(lessonRuleFor("improved", 25, -9.5, 20.6, 10, m)).toBe("steadier-but-slower");
    expect(lessonRuleFor("improved", 25, -9.5, 20.6, 10)).toBe("steadier-not-faster");
    // Unknown rule: a 1% low fall in between is no lesson; an average fall in between is not compared.
    expect(lessonRuleFor("regressed", -18, 0, 20.6, 10, u)).toBeNull();
    expect(lessonRuleFor("regressed", -21, 0, 20.6, 10, u)).toBe("less-steady-not-slower");
    expect(lessonRuleFor("regressed", -16, 0, 20.6, 10, u)).toBeNull();
    expect(lessonRuleFor("improved", 25, -9.5, 20.6, 10, u)).toBe("steadier");
    expect(lessonRuleFor("improved", 25, -11, 20.6, 10, u)).toBe("steadier-but-slower");
    expect(lessonRuleFor("improved", 25, -8, 20.6, 10, u)).toBe("steadier-not-faster");
    // At the smallest claim the fall is the band (fall_pct(3) = 3).
    expect(lessonRuleFor("regressed", -3, 0, 3, 3, m)).toBeNull();
    expect(lessonRuleFor("regressed", -3.1, 0, 3, 3, m)).toBe("less-steady-not-slower");
    // The stored verdict still wins.
    expect(lessonRuleForVerdict("no-change", -18, 0, 20.6, 10, m)).toBeNull();
    // Unknown, at exactly the band: a fall at the matching fall, none at the band (the engine's fall is
    // strict), so it can't be called; just past the band it is a fall either way.
    expect(lessonRuleFor("improved", 25, -10, 20.6, 10, u)).toBe("steadier");
    expect(lessonRuleFor("improved", 25, -10.01, 20.6, 10, u)).toBe("steadier-but-slower");
  });

  it("fellOn / worseOn: which number a Worse fell on, by the record's rule", () => {
    expect([fellOn(-9.5, 10, "matching"), fellOn(-9.5, 10, "same"), fellOn(-9.5, 10, "unknown")]).toEqual([true, false, null]);
    expect([fellOn(-10.1, 10, "unknown"), fellOn(-8, 10, "unknown"), fellOn(12, 10, "matching")]).toEqual([true, false, false]);
    expect(worseOn(true, true)).toBe("avg");
    expect(worseOn(null, false)).toBe("avg"); // the verdict says one fell; the 1% low didn't
    expect(worseOn(null, null)).toBe("avg"); // only the matching fall could call it Worse: the average fell
    expect(worseOn(false, null)).toBe("low");
    expect(worseOn(null, true)).toBe("low");
    expect(worseOn(false, false)).toBe("low"); // as before
  });

  it("the Trial summary teaches the fall the engine judged", () => {
    const s = summarizeGame(GAME, [...experiments, trial({})], [VFX], sessions)!;
    expect(s.lesson).toMatchObject({ recId: "hags", rule: "less-steady-not-slower", bandPct: 20.6 });
    // The same numbers on a record judged before noise model 3: inside the band both ways, no lesson.
    const old = summarizeGame(GAME, [...experiments, trial({ game_noise: { ...LOG, model: 2 } })], [VFX], sessions)!;
    expect(old.lesson?.recId === "hags" ? old.lesson.rule : null).toBeNull();
    const avg = summarizeGame(GAME, [...experiments, trial({ verdict: "improved", kept: true, treatment: { delta_low1_pct: 25, delta_avg_pct: -9.5 } })], [VFX], sessions)!;
    expect(avg.lesson).toMatchObject({ recId: "hags", rule: "steadier-but-slower", avgBandPct: 10 });
  });

  it("the outcome switch names 'the average fell' at the fall the record was judged at", () => {
    const on = [cand("hags", false, "already-set-by-compy")];
    const rec = trial({ verdict: "no-change", treatment: { delta_low1_pct: 30, delta_avg_pct: -9.5 } });
    const max = { ...rec, id: "exp:x", outcome: "max-fps" as const, verdict: "improved", kept: true, treatment: { delta_low1_pct: 30, delta_avg_pct: 30 } } as SummaryExperiment;
    expect(outcomeChoices(GAME, [rec, max], on, sessions)[0].recommended).toMatchObject({ reason: "avg-fell", pct: -9.5 });
    const old = { ...rec, game_noise: { ...LOG, model: 2 } } as SummaryExperiment;
    expect(outcomeChoices(GAME, [old, max], on, sessions)[0].recommended).toMatchObject({ reason: "low-flat" });
    // A real-play record whose build isn't known: a fall between -9.0% and -10% can't be called from
    // the numbers, but a No change with the 1% low past the band was the average's veto (s37 opus r2).
    const rp = { ...rec, mode: "real-play", game_noise: null, noise_evidence: { band_pct: 10, measured_noise_pct: null } } as SummaryExperiment;
    expect(outcomeChoices(GAME, [rp, max], on, sessions)[0].recommended).toMatchObject({ reason: "avg-fell", pct: -9.5 });
    // The same real-play record from a build that proves it (model-3 noise): the average fell.
    const rp3 = { ...rp, game_noise: { model: 3 } } as SummaryExperiment;
    expect(outcomeChoices(GAME, [rp3, max], on, sessions)[0].recommended).toMatchObject({ reason: "avg-fell", pct: -9.5 });
    // A real-play Maximum FPS Worse whose two falls the record can't call: read the band both ways
    // neither fell, so the matching fall judged it, where the average fell (the engine checks it first).
    const rpWorse = { ...rp, id: "exp:rw", outcome: "max-fps" as const, verdict: "regressed", treatment: { delta_low1_pct: -9.4, delta_avg_pct: -9.6 } } as SummaryExperiment;
    const rpKeep = { ...rp, id: "exp:rk", verdict: "improved", kept: true, treatment: { delta_low1_pct: 30, delta_avg_pct: 0 } } as SummaryExperiment;
    expect(outcomeChoices(GAME, [rpKeep, rpWorse], on, sessions)[0].maxFps).toMatchObject({ reason: "avg-fell", pct: -9.6 });
    // The same with the 1% low past the band: it fell either way, so it is the one named.
    const rpLow = { ...rpWorse, treatment: { delta_low1_pct: -12, delta_avg_pct: -9.6 } } as SummaryExperiment;
    expect(outcomeChoices(GAME, [rpKeep, rpLow], on, sessions)[0].maxFps).toMatchObject({ reason: "low-fell", pct: -12 });
    // Maximum FPS judges both on the wider band (20.6%): an average -18% fell past its matching -17.0%.
    const keep = trial({ verdict: "improved", kept: true, treatment: { delta_low1_pct: 30, delta_avg_pct: 0 } });
    const worse = { ...rec, id: "exp:w", outcome: "max-fps" as const, verdict: "regressed", treatment: { delta_low1_pct: 1, delta_avg_pct: -18 } } as SummaryExperiment;
    expect(outcomeChoices(GAME, [keep, worse], on, sessions)[0].maxFps).toMatchObject({ reason: "avg-fell", pct: -18 });
    const worseOld = { ...worse, game_noise: { ...LOG, model: 2 } } as SummaryExperiment;
    expect(outcomeChoices(GAME, [keep, worseOld], on, sessions)[0].maxFps).toMatchObject({ reason: "low-fell" });
  });
});
