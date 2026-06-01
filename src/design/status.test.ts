import { describe, it, expect } from "vitest";
import { statusMeta, type Status } from "./status";

describe("statusMeta", () => {
  it("maps ready to its label and CSS vars", () => {
    expect(statusMeta("ready")).toEqual({
      label: "Ready",
      colorVar: "var(--status-ready)",
      softVar: "var(--status-ready-soft)",
      lineVar: "var(--status-ready-line)",
    });
  });

  it("maps attention", () => {
    expect(statusMeta("attention").label).toBe("Attention");
  });

  it("maps protected, scanning, unknown to honest labels", () => {
    expect(statusMeta("protected").label).toBe("Protected");
    expect(statusMeta("scanning").label).toBe("Scanning");
    expect(statusMeta("unknown").label).toBe("Unavailable");
  });

  it("falls back to unknown for an unexpected value", () => {
    expect(statusMeta("bogus" as Status).label).toBe("Unavailable");
  });
});
