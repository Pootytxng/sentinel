import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { headlineFit, headlineWeight, HERO_MAX_WEIGHT } from "./headline-fit";

/* #213 B3 — the hero headline outgrows its own column, and this pins the measurement.
 *
 * THE TABLE BELOW IS NOT A GUESS. Every line count was read off the owner's installed build over
 * CDP, counting real line boxes with `Range.getClientRects()` in the live 452px narrative column
 * at `--type-hero` 52px/650 (line-height 57.2px) and at `--type-verdict` 40px. It is the whole
 * evidence base for the step-down rule, so it lives in the test rather than in a commit message
 * nobody re-reads.
 *
 * WHY A STATIC TEST AND NOT A RENDER. jsdom does no layout — `getClientRects()` returns nothing
 * and every element is 0×0 — so no test in this suite can count a line. What a test CAN do is pin
 * the threshold that was derived from the real measurement, pin that the CSS rule which consumes
 * it still exists, and fail loudly if either drifts from the other. The line counts themselves are
 * re-provable only by repeating the CDP measurement on a build.
 */

const read = (...p: string[]) => readFileSync(join(...p), "utf8");

/** len · lines at 52px · lines at 40px · the string. Measured 2026-08-25, build `0fbabb93`. */
const MEASURED: Array<[string, number, number]> = [
  ["You're ready to play", 2, 1],
  ["Scanning your system…", 2, 1],
  ["Games on slow storage", 2, 1],
  ["Not enough to judge yet", 2, 2],
  ["A game library on an HDD", 2, 2],
  ["Monitor below max refresh", 2, 2],
  ["GPU driver over a year old", 2, 2],
  ["Memory below its rated speed", 2, 2],
  ["Memory running single-channel", 2, 2],
  ["Drive reporting a SMART warning", 2, 2],
  ["Compy changes were turned back off", 3, 2],
  ["Games on slow storage · and 3 more", 3, 2],
  ["Power plan isn't performance-oriented", 3, 2],
  ["A game library on an HDD · and 3 more", 3, 2],
  ["Monitor below max refresh · and 3 more", 3, 2],
  ["GPU driver over a year old · and 3 more", 3, 2],
  ["Memory below its rated speed · and 3 more", 3, 2],
  ["Memory running single-channel · and 3 more", 3, 2],
  ["Drive reporting a SMART warning · and 3 more", 3, 3],
  ["Compy changes were turned back off · and 3 more", 3, 3],
  ["Power plan isn't performance-oriented · and 3 more", 4, 3],
];

describe("#213 B3 — the threshold matches what was actually measured", () => {
  it("keeps hero exactly for the headlines that drew two lines at 52px", () => {
    for (const [text, at52] of MEASURED) {
      expect(headlineFit(text), `${text} (${at52} lines at 52px)`).toBe(at52 <= 2 ? "hero" : "tight");
    }
  });

  it("only ever steps a headline DOWN when that buys it a line back or holds level", () => {
    // The rule must never make a case worse. Every headline it demotes drew 3–4 lines at hero and
    // draws 2–3 at verdict; nothing it leaves at hero would have been improved by demotion.
    for (const [text, at52, at40] of MEASURED) {
      if (headlineFit(text) === "tight") expect(at40, text).toBeLessThanOrEqual(at52);
      else expect(at52, text).toBeLessThanOrEqual(at40 + 1);
    }
  });

  it("puts the break where the measurement puts it, not one character off", () => {
    // 31 was the longest two-line headline at 52px; 34 was the first three-line one. A threshold
    // outside that window would either demote a headline the comp draws at hero, or leave the
    // owner's own live screen at three lines — which is the entire defect.
    expect(HERO_MAX_WEIGHT).toBeGreaterThanOrEqual(31);
    expect(HERO_MAX_WEIGHT).toBeLessThan(34);
    expect(headlineFit("Drive reporting a SMART warning")).toBe("hero"); // 31, two lines
    expect(headlineFit("Compy changes were turned back off")).toBe("tight"); // 34, three lines
  });

  it("FALSIFICATION: a threshold loose enough to be a no-op fails this file", () => {
    // The failure mode worth guarding is someone 'simplifying' the constant until nothing demotes.
    const noop = (t: string) => (headlineWeight(t) > 60 ? "tight" : "hero");
    const worst = "Power plan isn't performance-oriented · and 3 more";
    expect(noop(worst)).toBe("hero"); // …which is the 4-line case, so:
    expect(headlineFit(worst)).toBe("tight");
  });
});

describe("#213 B3 — the weighting is honest about Simplified Chinese", () => {
  it("counts a full-width glyph as more than one latin character", () => {
    // ESTIMATED, not measured — no CJK string was rendered and counted the way the latin table
    // above was. What the test can hold is the direction: a raw `.length` under-reads a CJK
    // headline's width, and the weighting corrects for that.
    const cjk = "你应用过的设置已被关闭";
    expect(headlineWeight(cjk)).toBeGreaterThan(cjk.length * 2);
  });

  it("leaves today's real zh-CN headlines at hero, which is why this is defensive not load-bearing", () => {
    // If one of these ever grows past ~14 glyphs it will start demoting on an ESTIMATE. Measure it
    // then rather than trusting the constant.
    for (const h of ["你可以开玩了", "数据还不足以判断", "正在扫描你的系统…"]) {
      expect(headlineFit(h), h).toBe("hero");
      expect(headlineWeight(h)).toBeLessThan(HERO_MAX_WEIGHT);
    }
  });

  it("leaves plain latin weight equal to its character count", () => {
    expect(headlineWeight("You're ready to play")).toBe("You're ready to play".length);
  });

  it("treats an empty or missing headline as the comp's state", () => {
    expect(headlineFit("")).toBe("hero");
    expect(headlineFit(null)).toBe("hero");
    expect(headlineFit(undefined)).toBe("hero");
  });
});

describe("#213 B3 — the rule that consumes the attribute is still wired", () => {
  const shell = read("src", "design", "shell-v2.css");
  const console_ = read("src", "surfaces", "HomeConsole.tsx");

  it("still declares the hero step it is stepping down FROM", () => {
    // The premise. If the hero rule is ever removed, a step-down to --type-verdict is a step
    // sideways and this file should say so rather than keep guarding a no-op.
    expect(shell).toMatch(/font-size:\s*var\(--type-hero\)/);
  });

  it("steps a tight headline down to --type-verdict, in both hero rooms", () => {
    const rules = shell
      .split("}")
      .filter((b) => b.includes('data-fit="tight"') && b.includes("font-size"));
    expect(rules.length, "no CSS consumes data-fit — the attribute is inert").toBeGreaterThan(0);
    const body = rules.join(" ");
    expect(body).toMatch(/font-size:\s*var\(--type-verdict\)/);
    expect(body).toMatch(/font-weight:\s*var\(--type-verdict-weight\)/);
    // A px literal here would also break type-scale-guard, but say it in the place that explains why.
    expect(body, "the step must resolve to a TYPE-1 token, never a px literal").not.toMatch(
      /font-size:\s*\d/,
    );
  });

  it("stays scoped under [data-v2=\"on\"], like every other V2 rule", () => {
    for (const block of shell.split("}")) {
      if (!block.includes('data-fit="tight"')) continue;
      expect(block, "an unscoped V2 rule breaks flag-off byte-identity").toContain('[data-v2="on"]');
    }
  });

  it("has the surface actually emitting the attribute", () => {
    expect(console_).toMatch(/data-fit=\{headlineFit\(posture\.headline\)\}/);
    expect(console_).toMatch(/from "\.\.\/design\/headline-fit"/);
  });
});
