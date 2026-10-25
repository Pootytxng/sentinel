// P5-rebaseline: the frontend's baseline grade (shared by the bench and the guided journey) must be
// the backend's (experiment.rs `grade_baseline`), or the journey would retake a session the start
// calls steady, or test on one the start records as uneven. Pinned by reading the Rust source.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { gradeBaseline, MIN_BASELINE_SAMPLES, BASELINE_HALVES_FLOOR_PCT } from "./baseline-grade";
import type { SessionSummary } from "../types";

const withSeries = (first: number[], second: number[], samples = 5400) =>
  ({
    samples,
    fps_series: [...first, ...second].map((f, i) => [i * 10, f] as [number, number]),
  }) as unknown as SessionSummary;
const rep = (n: number, f: number) => Array.from({ length: n }, () => f);

describe("baseline grade", () => {
  it("grades the owner's Aniimo baseline (293 then 241 fps) uneven, with 1-decimal halves", () => {
    expect(gradeBaseline(withSeries(rep(30, 293), rep(30, 241)))).toEqual({ kind: "uneven", first: 293, second: 241 });
  });
  it("Under 3% apart is steady; over 3% is uneven (strictly greater, relative to the first half)", () => {
    expect(gradeBaseline(withSeries(rep(10, 100), rep(10, 97.1))).kind).toBe("steady");
    expect(gradeBaseline(withSeries(rep(10, 100), rep(10, 96.9))).kind).toBe("uneven");
  });
  it("fewer than 2 buckets per half, or non-finite/zero readings only, is untraced", () => {
    expect(gradeBaseline(withSeries([244], [244, 244])).kind).toBe("untraced");
    expect(gradeBaseline(withSeries(rep(4, 0), rep(4, Number.NaN))).kind).toBe("untraced");
  });
  it("a short session is too short before anything else", () => {
    expect(gradeBaseline(withSeries(rep(30, 293), rep(30, 241), 599))).toEqual({ kind: "too-short", samples: 599 });
  });

  it("is pinned to experiment.rs grade_baseline and its constants", () => {
    const rs = readFileSync("src-tauri/src/experiment.rs", "utf8");
    const cmp = readFileSync("src-tauri/src/comparison.rs", "utf8");
    expect(MIN_BASELINE_SAMPLES).toBe(600);
    expect(rs).toContain("pub(crate) const MIN_TREATMENT_SAMPLES: u32 = 600;");
    expect(rs).toContain("pub(crate) const MIN_BASELINE_SAMPLES: u32 = MIN_TREATMENT_SAMPLES;");
    expect(BASELINE_HALVES_FLOOR_PCT).toBe(3);
    expect(cmp).toContain("pub(crate) const DEFAULT_NOISE_FLOOR_PCT: f64 = 3.0;");
    // The start grades on that fixed default, not the per-game verdict band.
    expect(rs).toContain("let halves_floor = DEFAULT_NOISE_FLOOR_PCT;");
    expect(rs).toContain("baseline_for_start(baseline, halves_floor)");
    const start = rs.indexOf("pub(crate) fn grade_baseline(");
    const body = rs.slice(start, rs.indexOf("\n}\n", start));
    const lines = [
      "if session.samples < MIN_BASELINE_SAMPLES {",
      "let fps: Vec<f64> = session.fps_series.iter().map(|&(_, f)| f).filter(|f| f.is_finite() && *f > 0.0).collect();",
      "let half = fps.len() / 2;",
      "if half < 2 {",
      "return BaselineGrade::Untraced;",
      "let (first, second) = (mean(&fps[..half]), mean(&fps[half..]));",
      "BaselineHalves { first_half_fps: round1(first), second_half_fps: round1(second) }",
      "if (second - first).abs() / first * 100.0 > halves_floor_pct {",
    ];
    for (const l of lines) expect(body, l).toContain(l);
    expect(rs).toContain("(x * 10.0).round() / 10.0");
  });

  it("the bench and the journey both use this one grade, not a copy", () => {
    for (const f of ["src/surfaces/ExperimentBench.tsx", "src/surfaces/GuidedJourney.tsx"]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/import \{[^}]*gradeBaseline[^}]*\} from "\.\/baseline-grade";/);
      expect(src, f).not.toMatch(/function gradeBaseline|const MIN_BASELINE_SAMPLES/);
    }
  });
});
