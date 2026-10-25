// P5-continue: when a next journey's reused as-is session is refused by start_experiment, the journey
// asks for a new as-is session, but only when the refusal is about the baseline (`refusesBaseline`
// in GuidedJourney.tsx). The backend has no error key, so that is read from its words. This pins
// those words in experiment.rs: every refusal in resolve_baseline / baseline_is_current /
// baseline_for_start names the baseline, and none of the start's other refusals (the change, another
// Trial, the outcome) do. Changing any of them fails here, so the matcher is reviewed with it.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { refusesBaseline } from "./GuidedJourney";

const rs = readFileSync("src-tauri/src/experiment.rs", "utf8");

/** One function's text, from `fn <name>` to its closing brace at column 0. */
function body(name: string): string {
  const i = rs.indexOf(`fn ${name}`);
  expect(i, `fn ${name} in experiment.rs`).toBeGreaterThan(-1);
  return rs.slice(i, rs.indexOf("\n}\n", i));
}
const code = (b: string) =>
  b
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
// A Rust literal with its `\` line continuations joined, as the user reads it.
const join = (lit: string) => lit.replace(/\\\n\s*/g, "");
/** The first literal of each refusal: `Err("…")`, `Err(format!("…"))`, `map_err(|x| format!("…"))`. */
function refusals(name: string): string[] {
  const re = /(?:Err\(|map_err\(\|\w+\|\s*\{?\s*)(?:format!\()?\s*"((?:[^"\\]|\\.)*)"/gs;
  return [...code(body(name)).matchAll(re)].map((m) => join(m[1]));
}
function literals(name: string): string[] {
  return [...code(body(name)).matchAll(/"((?:[^"\\]|\\.)*)"/gs)].map((m) => join(m[1]));
}

describe("the journey's baseline-refusal match is pinned to experiment.rs", () => {
  it("every baseline refusal is worded as today and reads as a baseline refusal", () => {
    const pinned: Record<string, string[]> = {
      resolve_baseline: [
        "the baseline session isn't in your session history any more — play a monitored session, then try again",
        "two sessions in your history share that baseline's start time, so Compy can't tell which one to use",
        "the baseline session measured nothing: another window was in front the whole time — play a session with the game in front, then try again",
        "the baseline session has no frame-rate reading, so there's nothing to compare the change against",
        "the baseline session didn't record which game was running, so there's no game to measure the change in",
      ],
      baseline_is_current: [
        "{why}, so it can't check that nothing else changed since the baseline session",
        "a Compy change was applied or undone after the baseline session, {replay}",
        "Compy didn't record how many of its changes were active when the baseline session began ({why} at the time), {replay}",
        "the number of active Compy changes is different from the baseline session's ({then} then, {} now, counted the way the older Compy that recorded it counted), {replay}",
        "Compy can't confirm whether any of its changes are on right now, so it can't match them with the baseline session's {then}, {replay}",
        "the number of active Compy changes is different from the baseline session's ({then} then, {active_now} now), {replay}",
        "Compy didn't record how many of its changes it couldn't confirm when the baseline session began, {replay}",
        "the number of Compy changes it can't confirm is different from the baseline session's ({cant_then} then, {} now), {replay}",
      ],
      baseline_for_start: [
        "the baseline session is too short to compare against ({samples} of the {MIN_BASELINE_SAMPLES} frame-rate readings Compy needs, about 10 minutes of play{}), record a new baseline: play another session of this game, then start",
      ],
    };
    for (const [fn, words] of Object.entries(pinned)) {
      expect(refusals(fn), fn).toEqual(words);
      for (const w of words) expect(refusesBaseline(w), w).toBe(true);
    }
  });

  it("the start's other refusals never read as a baseline refusal", () => {
    const others = ["pre_apply_refusal", "unverified_start_refusal", "start_outcome", "start_experiment"].flatMap(literals);
    const smoothest = rs.slice(rs.indexOf("const SMOOTHEST_UNAVAILABLE"), rs.indexOf(";", rs.indexOf("const SMOOTHEST_UNAVAILABLE")));
    expect(others.length).toBeGreaterThan(5);
    for (const w of [...others, smoothest]) expect(refusesBaseline(w), w).toBe(false);
  });
});
