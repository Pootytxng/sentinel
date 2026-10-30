import { describe, it, expect, afterEach } from "vitest";
import i18n from "../i18n";
import { displayModeLabel, refreshRateOf, screenTarget, screenTargetLine } from "./display-mode";
import { eventText } from "../surfaces/event-text";
import type { IntelEvent } from "../types";

// P9-hz: the display mode printed raw ("1920x1080@250"), the rate a bare number with no unit.
afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("displayModeLabel", () => {
  const t = i18n.t.bind(i18n);

  it("names the refresh rate with its unit", () => {
    expect(displayModeLabel("1920x1080@250", t)).toBe("1920×1080 @ 250 Hz");
    expect(displayModeLabel(" 2560x1440@165 ", t)).toBe("2560×1440 @ 165 Hz");
  });

  it("an unreadable rate (0) stays unknown, never a number", () => {
    const label = displayModeLabel("1920x1080@0", t);
    expect(label).toBe("1920×1080, refresh rate unknown");
    expect(label).not.toMatch(/\b0 Hz/);
  });

  it("nothing recorded is nothing to show; any other spelling prints as recorded", () => {
    expect(displayModeLabel("", t)).toBeNull();
    expect(displayModeLabel("   ", t)).toBeNull();
    expect(displayModeLabel(null, t)).toBeNull();
    expect(displayModeLabel(undefined, t)).toBeNull();
    expect(displayModeLabel("1920x1080", t)).toBe("1920x1080");
  });

  it("zh-CN carries the unit and its own unknown wording", async () => {
    await i18n.changeLanguage("zh-CN");
    expect(displayModeLabel("1920x1080@250", t)).toBe("1920×1080 @ 250 Hz");
    const unknown = displayModeLabel("1920x1080@0", t);
    expect(unknown).toContain("刷新率未知");
    expect(unknown).not.toMatch(/\b0 Hz/);
  });

  it("a hardware-change timeline line words both display modes", () => {
    const e = {
      id: "x",
      timestamp: "2026-10-21T10:00:00Z",
      event_type: "hardware-changed",
      source: "machine-model",
      scope: "system",
      game: null,
      summary: "Hardware changed — Display: 2560x1440@165 → 3440x1440@144",
      detail: null,
      observed_between: null,
      parts: { kind: "hardware", changes: [{ part: "display", from: "2560x1440@165", to: "3440x1440@144" }] },
    } as unknown as IntelEvent;
    expect(eventText(e, t)).toBe("Hardware changed — Display: 2560×1440 @ 165 Hz → 3440×1440 @ 144 Hz");
  });
});

// P9-target: FPS answers compared with the screen's measured refresh rate.
describe("screenTarget / screenTargetLine", () => {
  const t = i18n.t.bind(i18n);

  it("reads the recorded rate, never a default", () => {
    expect(refreshRateOf("1920x1080@250")).toBe(250);
    expect(refreshRateOf("1920x1080@0")).toBeNull();
    expect(refreshRateOf("1920x1080")).toBeNull();
    expect(refreshRateOf(null)).toBeNull();
  });

  it("compares the average with the screen in plain words", () => {
    expect(screenTarget(150, "1920x1080@250")).toEqual({ kind: "under", pct: 60, rate: 250 });
    expect(screenTargetLine(150, "1920x1080@250", t)).toBe("Your average was about 60% of your 250 Hz screen.");
  });

  it("at or above the rate says it kept up; just under never rounds up into it", () => {
    expect(screenTargetLine(319, "2560x1440@165", t)).toBe("Your average kept up with your 165 Hz screen.");
    expect(screenTargetLine(165, "2560x1440@165", t)).toBe("Your average kept up with your 165 Hz screen.");
    expect(screenTarget(249.6, "1920x1080@250")).toEqual({ kind: "under", pct: 99, rate: 250 });
  });

  it("no line when the rate or the FPS is unmeasured", () => {
    expect(screenTargetLine(150, "1920x1080@0", t)).toBeNull();
    expect(screenTargetLine(150, null, t)).toBeNull();
    expect(screenTargetLine(150, "1920x1080", t)).toBeNull();
    expect(screenTargetLine(null, "1920x1080@250", t)).toBeNull();
    expect(screenTargetLine(0, "1920x1080@250", t)).toBeNull();
    expect(screenTargetLine(Number.NaN, "1920x1080@250", t)).toBeNull();
  });

  it("zh-CN carries the same numbers", async () => {
    await i18n.changeLanguage("zh-CN");
    const line = screenTargetLine(150, "1920x1080@250", t)!;
    expect(line).toContain("250 Hz");
    expect(line).toContain("60%");
  });
});
