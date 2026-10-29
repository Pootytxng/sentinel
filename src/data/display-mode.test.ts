import { describe, it, expect, afterEach } from "vitest";
import i18n from "../i18n";
import { displayModeLabel } from "./display-mode";
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
