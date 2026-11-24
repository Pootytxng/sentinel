import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import en from "../i18n/locales/en/gaming.json";
import zh from "../i18n/locales/zh-CN/gaming.json";
import { STACK_ROLLBACK_HEAD, STACK_ROLLBACK_TAIL, WINDOW_LABELS, trialStatusText } from "./bench-error";

// D7 r1 F3: the pin list lives HERE, not in bench-error.ts, so no key ever reaches t() from a table: trialStatusText is a
// switch with a literal t("…") per status, and this list is only what the test compares it with.
const TRIAL_PHASES: ReadonlyArray<{ status: string; key: string }> = [
  { status: "Starting…", key: "gaming.benchmark.trialStatus.starting" },
  { status: "Measuring baseline (change off)…", key: "gaming.benchmark.trialStatus.baselineChangeOff" },
  { status: "Measuring baseline (stack off)…", key: "gaming.benchmark.trialStatus.baselineStackOff" },
  { status: "Applying the change…", key: "gaming.benchmark.trialStatus.applyingChange" },
  { status: "Applying the starter stack…", key: "gaming.benchmark.trialStatus.applyingStack" },
  { status: "Letting it settle…", key: "gaming.benchmark.trialStatus.settling" },
  { status: "Measuring with the change…", key: "gaming.benchmark.trialStatus.measuringChangeOn" },
  { status: "Measuring with the stack on…", key: "gaming.benchmark.trialStatus.measuringStackOn" },
  { status: "Rolling the change back…", key: "gaming.benchmark.trialStatus.rollingBackChange" },
];

// D7: the Benchmark card's live trial line printed benchmark_trial.rs's `status` raw, so a zh-CN screen read
// "Measuring baseline (change off)…" / "Baseline: window 3/20" in English. trialStatusText maps each fixed phase (and
// each window label) to a key, and anything else to the fixed "Working…" line, never the English.
//
// Break check: make trialStatusText's last line `return status;` again -> "an unknown status is the fixed line" fails;
// rename a phase literal in benchmark_trial.rs (e.g. "Letting it settle…") without TRIAL_PHASES -> "every literal is
// the Rust's" fails; drop the Treatment branch -> "a window status maps to its phase" fails.

const RUST = readFileSync(join("src-tauri", "src", "benchmark_trial.rs"), "utf8");
const t = ((k: string) => `T(${k})`) as never;
const enStatus = (en.benchmark as unknown as { trialStatus: Record<string, string> }).trialStatus;
const zhStatus = (zh.benchmark as unknown as { trialStatus: Record<string, string> }).trialStatus;
const leaf = (key: string) => key.replace(/^gaming\.benchmark\.trialStatus\./, "");

describe("the Benchmark card's live trial line is said in the user's language (D7)", () => {
  it("every phase literal mapped here is one benchmark_trial.rs writes", () => {
    for (const p of TRIAL_PHASES) {
      expect(RUST.includes(`s.status = "${p.status}".into()`) || RUST.includes(`status: "${p.status}".into()`), p.status).toBe(
        true,
      );
    }
    for (const label of WINDOW_LABELS) {
      expect(RUST.includes(`collect_windows(PER_SIDE, "${label}")`) || RUST.includes(`, "${label}")`), label).toBe(true);
    }
    expect(RUST).toContain('format!("{label}: window {got}/{n}")');
    expect(RUST).toContain(`format!("${STACK_ROLLBACK_HEAD}{applied_n}${STACK_ROLLBACK_TAIL}")`);
  });

  it("each phase maps to its own key, present in en and zh-CN (zh in Chinese)", () => {
    for (const p of TRIAL_PHASES) {
      expect(trialStatusText(p.status, "tweak", t)).toBe(`T(${p.key})`);
      expect(enStatus[leaf(p.key)], p.key).toBeTruthy();
      expect(zhStatus[leaf(p.key)], p.key).toMatch(/[一-鿿]/);
    }
    expect(Object.keys(zhStatus).sort()).toEqual(Object.keys(enStatus).sort());
    for (const v of Object.values(zhStatus)) expect(v).not.toMatch(/[A-Za-z]{3,}/);
  });

  it("a window status maps to its phase, by the trial's kind, with no number taken from the English", () => {
    expect(trialStatusText("Calibrating: window 3/40", "calibration", t)).toBe("T(gaming.benchmark.trialStatus.calibrating)");
    expect(trialStatusText("Baseline: window 3/20", "tweak", t)).toBe("T(gaming.benchmark.trialStatus.baselineChangeOff)");
    expect(trialStatusText("Baseline: window 3/20", "stack", t)).toBe("T(gaming.benchmark.trialStatus.baselineStackOff)");
    expect(trialStatusText("Settling: window 1/4", "tweak", t)).toBe("T(gaming.benchmark.trialStatus.settling)");
    expect(trialStatusText("Treatment: window 9/20", "tweak", t)).toBe("T(gaming.benchmark.trialStatus.measuringChangeOn)");
    expect(trialStatusText("Treatment: window 9/20", "stack", t)).toBe("T(gaming.benchmark.trialStatus.measuringStackOn)");
    expect(trialStatusText("Rolling back the 4-tweak stack…", "stack", t)).toBe("T(gaming.benchmark.trialStatus.rollingBackStack)");
  });

  // D7 r1 F3. Break check: write `return t(phase.key)` (any t() whose first argument is not a string literal) back
  // into bench-error.ts -> fails.
  it("bench-error.ts passes only literal keys to t()", () => {
    const src = readFileSync(join("src", "surfaces", "bench-error.ts"), "utf8").replace(/\/\/.*$/gm, "");
    const calls = [...src.matchAll(/\bt\(\s*([^)]*)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(10);
    expect(calls.filter((a) => !/^"[a-zA-Z.]+"/.test(a))).toEqual([]);
  });

  it("an unknown status is the fixed line, never the English", () => {
    expect(trialStatusText("No frames.", "tweak", t)).toBe("T(gaming.benchmark.trialStatus.working)");
    expect(trialStatusText("Something a later build says", "tweak", t)).toBe("T(gaming.benchmark.trialStatus.working)");
  });

  it("Benchmark.tsx prints the mapped line, not the raw status or the raw run error", () => {
    const src = readFileSync(join("src", "surfaces", "Benchmark.tsx"), "utf8");
    expect(src).toContain("{trialStatusText(trial.status, trial.kind, t)}");
    expect(src).not.toMatch(/\{trial\.status\}/);
    expect(src).toContain('backendMessage(state.error, t) ?? t("gaming.benchmark.errors.runUnmapped")');
    expect(src).not.toMatch(/\{state\.error\}/);
  });
});
