// TG-drift-words: a Trial judged too noisy names what Compy recorded differently between its two
// sessions (one fixture per difference), or that nothing did, and gives exactly one next step; en +
// zh-CN. Only recorded fields are compared: a field either session didn't record never differs.
import { describe, expect, it } from "vitest";
import en from "../i18n/locales/en/lab.json";
import zh from "../i18n/locales/zh-CN/lab.json";
import type { SessionSummary } from "../types";
import { driftWords, sessionDrift } from "./drift-words";
import { trialDriftWords } from "./ExperimentBench";

// A translator over the real locale files ("lab.<path>"), with {{x}} interpolation.
const tFor = (root: unknown) => (key: string, opts: Record<string, unknown> = {}) => {
  const v = key
    .replace(/^lab\./, "")
    .split(".")
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], root);
  if (typeof v !== "string") throw new Error(`missing copy: ${key}`);
  return v.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(opts[k]));
};
const tEn = tFor(en);
const tZh = tFor(zh);

const base = (over: Partial<SessionSummary> = {}, gs: Record<string, unknown> = {}): SessionSummary =>
  ({
    started_at: "2026-11-16T10:00:00Z",
    process_name: "ROB RUN.exe",
    duration_secs: 1800,
    samples: 1800,
    avg_fps: 140,
    avg_frametime_ms: 7.1,
    low1_fps_est: 90,
    peak_gpu_temp_c: null,
    peak_gpu_usage_pct: null,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    frame_cap: { state: "uncapped" },
    gaming_mode_active: false,
    background_secs_excluded: 0,
    hw_fingerprint: { hash: "h", gpu: "RX 7800 XT", gpu_driver: "32.0.1", ram_gb: 32, display: "d" },
    game_state: {
      gpu_driver: "32.0.1",
      windows_build: "26200.7000",
      resolution_width: 2560,
      resolution_height: 1440,
      power_plan_guid: "381b4222-f694-41f0-9685-ff5bb260df2e",
      power_plan_changed: false,
      context_version: 1,
      ...gs,
    },
    ...over,
  }) as SessionSummary;
const after = (over: Partial<SessionSummary> = {}, gs: Record<string, unknown> = {}) =>
  base({ started_at: "2026-11-16T11:00:00Z", ...over }, gs);

describe("sessionDrift: one fixture per recorded difference", () => {
  const cases: [string, SessionSummary, string, RegExp][] = [
    ["cap", after({ frame_cap: { state: "capped", at_fps: 144 } }), "the frame cap was off for the baseline and on at 144 fps after", /set the frame cap the way it was/],
    ["power-plan", after({}, { power_plan_guid: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c" }), "a different Windows power plan was active", /keep one Windows power plan/],
    ["power-plan-changed", after({}, { power_plan_changed: true }), "the Windows power plan changed during the after-session", /keep one Windows power plan/],
    ["driver", after({ hw_fingerprint: { hash: "h", gpu: "RX 7800 XT", gpu_driver: "32.0.2", ram_gb: 32, display: "d" } }, { gpu_driver: "32.0.2" }), "the graphics driver changed (32.0.1 to 32.0.2)", /fresh baseline/],
    ["windows-build", after({}, { windows_build: "26200.7100" }), "Windows updated (26200.7000 to 26200.7100)", /fresh baseline/],
    ["gaming-mode", after({ gaming_mode_active: true }), "Gaming Mode was off for the baseline and on after", /Gaming Mode set the same way/],
    ["resolution", after({}, { resolution_width: 1920, resolution_height: 1080 }), "the display resolution was 2560×1440 for the baseline and 1920×1080 after", /same display resolution/],
    ["background", after({ background_secs_excluded: 18 * 60 }), "the game was behind another window for about 18 min more during the after-session", /keep the game in front/],
    ["length", after({ duration_secs: 4200 }), "the baseline ran 30 min and the after-session 70 min", /about the same length/],
  ];
  for (const [key, a, words, step] of cases)
    it(`${key}: named in plain words, with its one next step (en + zh-CN)`, () => {
      expect(sessionDrift(base(), a).map((d) => d.key)).toEqual([key]);
      const line = driftWords(base(), a, "ROB RUN", tEn)!;
      expect(line).toContain(`What Compy recorded differently between the two sessions: ${words}.`);
      expect(line).toMatch(step);
      expect(line.match(/Next:/g)).toHaveLength(1);
      const zhLine = driftWords(base(), a, "ROB RUN", tZh)!;
      expect(zhLine).toContain("Compy 记录到两次对局之间的不同之处");
      expect(zhLine.match(/下一步：/g)).toHaveLength(1);
    });

  it("several differences: all named, one step (the first, most actionable)", () => {
    const a = after({ frame_cap: { state: "capped", at_fps: 240 }, gaming_mode_active: true }, { windows_build: "26200.7100" });
    expect(sessionDrift(base(), a).map((d) => d.key)).toEqual(["cap", "windows-build", "gaming-mode"]);
    const line = driftWords(base(), a, "ROB RUN", tEn)!;
    expect(line).toContain("the frame cap was off for the baseline and on at 240 fps after; Windows updated");
    expect(line.match(/Next:/g)).toHaveLength(1);
    expect(line).toMatch(/Next: set the frame cap/);
  });

  it("never invents: a field either session didn't record is not a difference", () => {
    const unread = after(
      { frame_cap: { state: "unknown" }, gaming_mode_active: null, background_secs_excluded: null, hw_fingerprint: null },
      { power_plan_guid: null, windows_build: null, gpu_driver: null, resolution_width: null },
    );
    expect(sessionDrift(base(), unread)).toEqual([]);
    expect(sessionDrift(base({ game_state: null }), after({}, { windows_build: "1" }))).toEqual([]);
    // A short alt-tab and a modestly longer session are not named.
    expect(sessionDrift(base(), after({ background_secs_excluded: 30, duration_secs: 3000 }))).toEqual([]);
  });

  it("nothing recorded differs: names exactly what was compared, claims no cause, one as-is step (en + zh-CN)", () => {
    const line = driftWords(base(), after(), "ROB RUN", tEn)!;
    expect(line).toBe(
      "Compy compared what it recorded for both sessions (frame cap, power plan, graphics driver, Windows build, Gaming Mode, display resolution, time behind other windows, session length) and found no difference worth naming, so it can't point to any of them. " +
        "Next: play a few more sessions of ROB RUN with nothing changed, so Compy can measure how much it moves, then run the Trial again.",
    );
    // Only fields both sessions recorded are named.
    expect(driftWords(base({}, { windows_build: null }), after(), "ROB RUN", tEn)).not.toMatch(/Windows build/);
    expect(driftWords(base(), after(), "ROB RUN", tZh)).toContain("没有发现值得指出的不同");
  });

  // Opus r1 MUST-FIX: the backend's cap rule: caps within 3% are the same cap.
  it("frame caps within 3% of each other are the same cap; a cap whose rate wasn't read is no difference", () => {
    // An older record may carry a capped state without its rate; the type says at_fps is always set.
    const capped = (fps?: number) =>
      ({ frame_cap: { state: "capped" as const, ...(fps != null ? { at_fps: fps } : {}) } }) as Partial<SessionSummary>;
    expect(sessionDrift(base(capped(144)), after(capped(146)))).toEqual([]);
    expect(sessionDrift(base(capped(144)), after(capped(145)))).toEqual([]);
    expect(sessionDrift(base(capped(144)), after(capped(240))).map((d) => d.key)).toEqual(["cap"]);
    expect(sessionDrift(base(capped(144)), after(capped()))).toEqual([]);
    expect(sessionDrift(base(capped()), after()).map((d) => d.key)).toEqual(["cap"]); // on vs off
  });

  // Sonnet r1 SHOULD-FIX: no context recorded on both sides is never "nothing differs".
  it("no context recorded on both sessions: says it can't tell what differed, never 'nothing differs'", () => {
    const bare = (over: Partial<SessionSummary>) =>
      base({ game_state: null, hw_fingerprint: null, frame_cap: null, gaming_mode_active: null, background_secs_excluded: null, ...over });
    const b = bare({});
    const a = bare({ started_at: "2026-11-16T11:00:00Z" });
    const line = driftWords(b, a, "ROB RUN", tEn)!;
    expect(line).toMatch(/^Compy recorded no conditions it can compare for these two sessions, so it can't say what changed\. Next:/);
    expect(line).not.toMatch(/None of the conditions/);
    expect(line.match(/Next:/g)).toHaveLength(1);
    expect(driftWords(b, a, "ROB RUN", tZh)).toContain("无法说明哪里不同");
  });

  // CR-drift-words-own-plan: "compared" means both plans were read, never the changed-during flags alone.
  it("the power plan is listed as compared only when both sessions' plans were read", () => {
    const noPlans = driftWords(base({}, { power_plan_guid: null }), after({}, { power_plan_guid: null }), "ROB RUN", tEn)!;
    expect(noPlans).toMatch(/^Compy compared what it recorded/);
    expect(noPlans).not.toMatch(/power plan/);
    expect(driftWords(base(), after(), "ROB RUN", tEn)).toMatch(/frame cap, power plan, graphics driver/);
  });

  // s35 sonnet SHOULD-FIX: with Gaming Mode on in either session the plan isn't compared (it lays
  // its own plan), as at the conclude and the preflight; the Gaming Mode difference is the one named.
  it("with Gaming Mode on in a session, the power plan is neither named nor listed as compared", () => {
    const gm = after({ gaming_mode_active: true }, { power_plan_guid: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", power_plan_changed: true });
    expect(sessionDrift(base(), gm).map((d) => d.key)).toEqual(["gaming-mode"]);
    expect(driftWords(base(), gm, "ROB RUN", tEn)).toMatch(/Next: .*Gaming Mode set the same way/);
    const both = driftWords(base({ gaming_mode_active: true }), after({ gaming_mode_active: true }, { power_plan_guid: "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c" }), "ROB RUN", tEn)!;
    expect(both).toMatch(/^Compy compared what it recorded/);
    expect(both).not.toMatch(/power plan/);
  });

  // CR-drift-words-own-plan: the backend preflight compares driver strings case-insensitively.
  it("a driver string that differs only in letter case is the same driver", () => {
    const upper = after({}, { gpu_driver: "Adrenalin 25.10.1" });
    expect(sessionDrift(base({}, { gpu_driver: "adrenalin 25.10.1" }), upper)).toEqual([]);
    expect(sessionDrift(base({}, { gpu_driver: "adrenalin 25.9.1" }), upper).map((d) => d.key)).toEqual(["driver"]);
  });

  it("a session Compy no longer holds: no words at all", () => {
    expect(driftWords(base(), undefined, "ROB RUN", tEn)).toBeNull();
    expect(driftWords(null, after(), "ROB RUN", tEn)).toBeNull();
  });
});

describe("trialDriftWords: only a two-session Trial judged too noisy", () => {
  const sessions = [base(), after({ frame_cap: { state: "capped", at_fps: 144 } })];
  const rec = {
    verdict: "too-noisy",
    game: "ROB RUN.exe",
    rec_id: "hags-on",
    baseline_session_id: sessions[0].started_at,
    treatment: { session_id: sessions[1].started_at },
  };
  it("names the difference from the Trial's own two sessions", () => {
    expect(trialDriftWords(rec, sessions, tEn)).toMatch(/the frame cap was off for the baseline and on at 144 fps after/);
  });
  // CR-drift-words-own-plan: a Trial of the power plan moves the plan between its sessions by design.
  it("a Trial of the power plan itself never names its own plan move as a difference", () => {
    const planned = [base(), after({}, { power_plan_guid: "e9a42b02-d5df-448d-aa00-03f14749eb61" })];
    const ids = { baseline_session_id: planned[0].started_at, treatment: { session_id: planned[1].started_at } };
    const own = trialDriftWords({ ...rec, ...ids, rec_id: "power-ultimate" }, planned, tEn)!;
    expect(own).not.toMatch(/power plan/);
    expect(own).not.toMatch(/keep one Windows power plan/);
    // Nothing else differed: and the plan, never compared, isn't listed as compared either.
    expect(own).toMatch(/^Compy compared what it recorded for both sessions \(frame cap, graphics driver,/);
    // Any other setting's Trial still names it.
    expect(trialDriftWords({ ...rec, ...ids }, planned, tEn)).toMatch(/a different Windows power plan was active/);
  });
  it("a plan switched during a session is still named for a Trial of the power plan", () => {
    const planned = [base(), after({}, { power_plan_changed: true })];
    const ids = { baseline_session_id: planned[0].started_at, treatment: { session_id: planned[1].started_at } };
    expect(trialDriftWords({ ...rec, ...ids, rec_id: "power-ultimate" }, planned, tEn)).toMatch(
      /the Windows power plan changed during the after-session/,
    );
  });
  it("changes nothing for any other verdict, a real-play Trial, or a missing session", () => {
    for (const verdict of ["improved", "no-change", "regressed", "not-comparable", null])
      expect(trialDriftWords({ ...rec, verdict }, sessions, tEn)).toBeNull();
    expect(trialDriftWords({ ...rec, mode: "real-play" }, sessions, tEn)).toBeNull();
    expect(trialDriftWords({ ...rec, treatment: { session_id: "gone" } }, sessions, tEn)).toBeNull();
    expect(trialDriftWords({ ...rec, treatment: null }, sessions, tEn)).toBeNull();
  });
});
