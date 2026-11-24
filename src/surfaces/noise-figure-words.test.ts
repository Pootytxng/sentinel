// B6 r1 (review B1, B2): a game with no noise figure is missing one for one of two reasons: too few sessions with
// nothing changed, or sessions that differ too much from each other (noise_floor.rs NOISE_BAND_MAX_PCT refuses a
// band over 100%). Every line shown for "no band" must be true for BOTH: never "hasn't/isn't measured" (that asks
// for sessions that may already exist) and never a promise that more sessions will produce a verdict.
// Break check: put "Compy hasn't measured how much {{game}} moves" back in monitor.json's unmeasuredNoiseSub.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { NOISE_BAND_MAX_PCT } from "./test-summary";

const read = (...p: string[]) => readFileSync(join(...p), "utf8");
const json = (loc: string, ns: string) => JSON.parse(read("src", "i18n", "locales", loc, `${ns}.json`));

const NOT_MEASURED = /hasn't measured|isn't measured|尚未测量|仍未测量/i;
const PROMISE = /\bwill\b|let the next|下一次比较就能/i;

/** The Rust lines for a missing band, by their own opening words. */
const rustLines = (file: string, starts: string[]) => {
  const src = read("src-tauri", "src", file);
  return starts.map((s) => {
    const at = src.indexOf(s);
    expect(at, `${file}: ${s}`).toBeGreaterThan(-1);
    return src.slice(at, src.indexOf('"', at));
  });
};

describe("no noise figure: the words are true for both reasons", () => {
  const lines: [string, string][] = [
    ["en monitor unmeasuredNoiseSub", json("en", "monitor").sessionDebrief.unmeasuredNoiseSub],
    ["zh monitor unmeasuredNoiseSub", json("zh-CN", "monitor").sessionDebrief.unmeasuredNoiseSub],
    ["en optimize whatChangedPanel.noiseUnmeasured", json("en", "optimize").whatChangedPanel.noiseUnmeasured],
    ["zh optimize whatChangedPanel.noiseUnmeasured", json("zh-CN", "optimize").whatChangedPanel.noiseUnmeasured],
    ...rustLines("intelligence.rs", ["The 1% low moved {delta_low1:+.1}%, but Compy has no noise figure"]).map(
      (s): [string, string] => ["intelligence.rs what-changed", s],
    ),
    ...rustLines("intelligence_patterns.rs", ["1% low directions for {game}: not called. Compy has no noise figure"]).map(
      (s): [string, string] => ["intelligence_patterns.rs 1% low directions", s],
    ),
  ];

  it.each(lines)("%s: never 'not measured', never a promise", (_, s) => {
    expect(s).not.toMatch(NOT_MEASURED);
    expect(s).not.toMatch(PROMISE);
  });

  it("each names both reasons", () => {
    for (const [where, s] of lines) {
      if (where.startsWith("zh")) continue;
      if (where.includes("noiseUnmeasured")) continue; // a short tag beside the delta: "no noise figure for this game yet"
      expect(s, where).toMatch(/too few/);
      expect(s, where).toMatch(/differ too much/);
    }
    expect(json("zh-CN", "monitor").sessionDebrief.unmeasuredNoiseSub).toContain("要么各次之间差别太大");
  });

  it("the tuning check's no-band line says the same", () => {
    const src = read("src", "data", "tuning-measure.ts");
    expect(src).toContain("Compy has no noise figure for this game yet (too few sessions with nothing changed, or they differ too much from each other)");
    expect(src).not.toMatch(/Compy hasn't measured how much this game moves/);
  });
});

describe("NOISE_BAND_MAX_PCT: the TS mirror is the engine's value", () => {
  // Break check: change either constant; this fails.
  it("matches noise_floor.rs", () => {
    const m = read("src-tauri", "src", "noise_floor.rs").match(/pub\(crate\) const NOISE_BAND_MAX_PCT: f64 = ([\d.]+);/);
    expect(m, "NOISE_BAND_MAX_PCT in noise_floor.rs").not.toBeNull();
    expect(Number(m![1])).toBe(NOISE_BAND_MAX_PCT);
  });
});
