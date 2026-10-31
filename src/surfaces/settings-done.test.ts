import { describe, expect, it } from "vitest";
import { settingsDoneLine } from "./settings-done";
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
});
