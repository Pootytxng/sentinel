import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import en from "../i18n/locales/en/gaming.json";
import zh from "../i18n/locales/zh-CN/gaming.json";
import { verdictMetricText } from "./bench-error";

// D8: the Benchmark card printed a Trial verdict's `metric` raw ("1% low" / "0.1% low", the names
// benchmark_verdict.rs passes to eval_metric), so a zh-CN screen read English, on the live verdict line and on every
// stored scoreboard award. verdictMetricText says each name through its own literal t(), and anything else through a
// fixed line, never the raw value. The pin list lives HERE (not in bench-error.ts), so no key reaches t() from a table.
const VERDICT_METRICS: ReadonlyArray<{ name: string; key: string }> = [
  { name: "1% low", key: "gaming.benchmark.verdictMetric.onePercentLow" },
  { name: "0.1% low", key: "gaming.benchmark.verdictMetric.pointOnePercentLow" },
];

// Break checks: add `eval_metric("avg", &b_avg, &t_avg),` to Trial::verdict in benchmark_verdict.rs -> "the Rust's
// metric names are exactly this list" fails; make verdictMetricText's last line `return metric;` -> "an unknown name is
// the fixed line" fails; put `{a.metric}` back in Benchmark.tsx -> "Benchmark.tsx prints every metric mapped" fails.

const RUST = readFileSync(join("src-tauri", "src", "benchmark_verdict.rs"), "utf8");
const t = ((k: string) => `T(${k})`) as never;
const enM = (en.benchmark as unknown as { verdictMetric: Record<string, string> }).verdictMetric;
const zhM = (zh.benchmark as unknown as { verdictMetric: Record<string, string> }).verdictMetric;
const leaf = (key: string) => key.replace(/^gaming\.benchmark\.verdictMetric\./, "");

describe("a Trial verdict's metric is said in the user's language (D8)", () => {
  it("the Rust's metric names are exactly this list", () => {
    const names = [...RUST.matchAll(/eval_metric\("([^"]+)"/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(VERDICT_METRICS.map((m) => m.name).sort());
    // Verdict::Keep / Revert take their metric only from that name (no other string reaches it).
    expect(RUST).toContain("metric: r.name.into(),");
    expect(RUST).toContain("metric: i.name.into(),");
    expect([...RUST.matchAll(/metric: [a-z]\.name\.into\(\)/g)].length).toBe(2);
  });

  it("each name maps to its own key; en says the Rust's own words, zh says it in Chinese", () => {
    for (const m of VERDICT_METRICS) {
      expect(verdictMetricText(m.name, t)).toBe(`T(${m.key})`);
      expect(enM[leaf(m.key)]).toBe(m.name);
      expect(zhM[leaf(m.key)], m.key).toMatch(/低帧$/);
    }
    expect(Object.keys(zhM).sort()).toEqual(Object.keys(enM).sort());
    for (const v of Object.values(zhM)) expect(v).not.toMatch(/[A-Za-z]/);
  });

  it("an unknown name is the fixed line, never the raw value", () => {
    expect(verdictMetricText("average FPS", t)).toBe("T(gaming.benchmark.verdictMetric.unknown)");
    expect(verdictMetricText("", t)).toBe("T(gaming.benchmark.verdictMetric.unknown)");
    expect(enM.unknown).toBe("measured value");
    expect(zhM.unknown).toBe("测量值");
  });

  it("Benchmark.tsx prints every metric mapped, never raw", () => {
    const src = readFileSync(join("src", "surfaces", "Benchmark.tsx"), "utf8");
    expect(src).toContain("{verdictMetricText(trial.verdict.metric, t)}");
    expect(src).toContain("metric: verdictMetricText(a.metric, t),");
    expect(src.split("{verdictMetricText(a.metric, t)}").length - 1).toBe(2);
    expect(src).not.toMatch(/\{(trial\.verdict|a)\.metric\}/);
    expect(src).not.toMatch(/metric: a\.metric\b/);
  });
});
