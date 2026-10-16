import { describe, expect, it } from "vitest";
import { knownFps } from "./session-metrics";

// bug→guard for #602 / #645: a session's average and 1% low arrive as plain numbers, and the
// sampler's "unknown" is 0 (or the field is missing). The backend only treats a value > 0 as
// measured (blackbox.rs), and gradeLow1/gradeFps grade anything else "neutral". This helper is the
// one frontend predicate for both fields, so every display site can ask the same question.

describe("knownFps — only a finite number above zero is a measurement", () => {
  it.each([
    ["a typical average", 240, 240],
    ["a fractional estimate", 59.6, 59.6],
    ["a very small but measured value", 0.25, 0.25],
  ])("%s is returned unchanged", (_label, value, expected) => {
    expect(knownFps(value)).toBe(expected);
  });

  it.each<[string, unknown]>([
    ["zero (the sampler's unknown)", 0],
    ["negative zero", -0],
    ["negative", -1],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["undefined (missing field)", undefined],
    ["null", null],
    ["a numeric string", "240"],
    ["a zero string", "0"],
    ["an empty string", ""],
    ["a boolean", true],
    ["an object", { valueOf: () => 240 }],
  ])("%s is unknown (null), never a number", (_label, value) => {
    expect(knownFps(value)).toBeNull();
  });
});
