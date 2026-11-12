import { describe, expect, it } from "vitest";
import { settingsDoneLine, softwareFirstLine } from "./settings-done";
import type { Priorities, PriorityItem } from "../types";

const item = (id: string, status: PriorityItem["status"], title = id): PriorityItem => ({
  id,
  title,
  reason: "",
  linked: null,
  confidence: "medium",
  status,
});
const pri = (limiters: PriorityItem[]): Priorities => ({
  limiters,
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
});

describe("settingsDoneLine (P9-settings-done)", () => {
  it("is absent unless the game summary finished the supported tests", () => {
    for (const h of [
      "finished-within-chosen-risk",
      "still-worth-testing",
      "worth-retesting",
      "results-unverified",
      "nothing-testable-now",
      "unknown",
    ] as const) {
      expect(settingsDoneLine(h, pri([item("gpu", "attention")]))).toBeNull();
    }
  });

  it("defaults to not measured (no upgrade) when no scan or a failed priorities read", () => {
    expect(settingsDoneLine("finished-supported-tests", undefined)).toEqual({ kind: "not-measured" });
    expect(settingsDoneLine("finished-supported-tests", null)).toEqual({ kind: "not-measured" });
  });

  it("names a setting/software limiter as a setting, never a part", () => {
    expect(settingsDoneLine("finished-supported-tests", pri([item("monitor-refresh", "attention", "Refresh rate")]))).toEqual({
      kind: "setting-limiter",
      title: "Refresh rate",
    });
  });

  it("never names the safe-tweak rows it just finished testing (desk review 2026-10-31)", () => {
    // On the owner's rig the finished WARDOGS summary said "tested twice, no measurable difference"
    // for Trim Windows visual effects, and this line then named "1 safe tweak not applied" (that same
    // tweak) as what holds the PC back.
    const aggregate = item("pending-safe-recs", "attention", "1 safe tweak not applied");
    const applied = item("applied-changes", "attention", "2 changes applied");
    expect(settingsDoneLine("finished-supported-tests", pri([aggregate, applied]))).toEqual({ kind: "nothing-limiting" });
    // A real limiter behind them is still named.
    expect(
      settingsDoneLine("finished-supported-tests", pri([aggregate, item("ram-capacity", "attention", "Memory")])),
    ).toEqual({ kind: "part-limiter", title: "Memory" });
  });

  it("names a hardware limiter by its title only", () => {
    expect(settingsDoneLine("finished-supported-tests", pri([item("ready-x", "ready"), item("ram-capacity", "attention", "Memory")]))).toEqual({
      kind: "part-limiter",
      title: "Memory",
    });
  });

  it("says nothing is limiting only when every limiter was read and none needs attention", () => {
    expect(settingsDoneLine("finished-supported-tests", pri([]))).toEqual({ kind: "nothing-limiting" });
    expect(settingsDoneLine("finished-supported-tests", pri([item("a", "ready")]))).toEqual({ kind: "nothing-limiting" });
    // An unread limiter is unknown, never "nothing limiting".
    expect(settingsDoneLine("finished-supported-tests", pri([item("a", "ready"), item("b", "unknown")]))).toEqual({
      kind: "not-measured",
    });
  });

  // P9-summary-gpu-limit: the game's own newest measured session was GPU-limited (sustained rule).
  it("names the GPU with its share when this game's newest session was GPU-limited, never another game's", () => {
    const withGpu = {
      ...pri([]),
      gpu_limited_games: [{ game: "ROB RUN.exe", share_pct: 72, peak_pct: 99, threshold_pct: 95 }],
    };
    const limited = { kind: "gpu-limiter", sharePct: 72, thresholdPct: 95 };
    expect(settingsDoneLine("finished-supported-tests", withGpu, "ROB RUN.exe")).toEqual(limited);
    // Review r1: Windows' case for the process name doesn't decide the match.
    expect(settingsDoneLine("finished-supported-tests", withGpu, "rob run.exe ")).toEqual(limited);
    // Another game's limit never counts for this one.
    expect(settingsDoneLine("finished-supported-tests", withGpu, "wardogs.exe")).toEqual({ kind: "nothing-limiting" });
    // It also outranks "not measured" from an unread PC-wide row: it is a measurement of this game.
    const unread = { ...pri([item("b", "unknown")]), gpu_limited_games: withGpu.gpu_limited_games };
    expect(settingsDoneLine("finished-supported-tests", unread, "ROB RUN.exe")).toEqual(limited);
    // A scan's own attention limiter is still the one named first.
    const part = { ...pri([item("ram-capacity", "attention", "Memory")]), gpu_limited_games: withGpu.gpu_limited_games };
    expect(settingsDoneLine("finished-supported-tests", part, "ROB RUN.exe")).toEqual({ kind: "part-limiter", title: "Memory" });
    // An older backend sends no list; no game given: as before.
    expect(settingsDoneLine("finished-supported-tests", pri([]), "ROB RUN.exe")).toEqual({ kind: "nothing-limiting" });
    expect(settingsDoneLine("finished-supported-tests", withGpu)).toEqual({ kind: "nothing-limiting" });
  });
});

// P9-software-first: before a part is named as what holds a game back, the summary lists the
// settings still worth trying — none left = today's settings-done line instead.
describe("softwareFirstLine (P9-software-first)", () => {
  const cand = (id: string, title: string) => ({ id, title, passes: true, reason: null, detail: null });
  const tested = (recId: string, title: string) => ({ recId, title }) as never;
  const part = pri([item("ram-capacity", "attention", "Memory")]);

  it("lists the untested changes, then those worth another run, before the part — in the picker's order", () => {
    const line = softwareFirstLine(
      { headline: "still-worth-testing", leftToTest: [cand("a", "Change A"), cand("b", "Change B")], retest: [tested("c", "Change C"), tested("a", "Change A")] },
      part,
    );
    expect(line).toEqual({ kind: "software-first", part: "Memory", candidates: ["Change A", "Change B", "Change C"] });
  });

  it("is absent on a finished summary (today's line carries it), with nothing left to try, or with no part named", () => {
    const left = [cand("a", "Change A")];
    expect(softwareFirstLine({ headline: "finished-supported-tests", leftToTest: left, retest: [] }, part)).toBeNull();
    expect(softwareFirstLine({ headline: "still-worth-testing", leftToTest: [], retest: [] }, part)).toBeNull();
    expect(softwareFirstLine({ headline: "still-worth-testing", leftToTest: left, retest: [] }, undefined)).toBeNull();
    expect(softwareFirstLine({ headline: "still-worth-testing", leftToTest: left, retest: [] }, pri([]))).toBeNull();
    // A setting or software limiter is not a part; the aggregate rec rows are not limiters here.
    expect(softwareFirstLine({ headline: "still-worth-testing", leftToTest: left, retest: [] }, pri([item("monitor-refresh", "attention")]))).toBeNull();
    expect(softwareFirstLine({ headline: "still-worth-testing", leftToTest: left, retest: [] }, pri([item("pending-safe-recs", "attention")]))).toBeNull();
  });

  it("a retest-only summary still lists what is worth another run", () => {
    expect(softwareFirstLine({ headline: "worth-retesting", leftToTest: [], retest: [tested("c", "Change C")] }, part)).toEqual({
      kind: "software-first",
      part: "Memory",
      candidates: ["Change C"],
    });
  });
});
