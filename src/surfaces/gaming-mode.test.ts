import { describe, it, expect } from "vitest";
import {
  summarizeChanges,
  restoredSummary,
  showGlobalRecoveryBanner,
  showGlobalRestoredBanner,
  statusLabel,
  isRecoverable,
  type SessionChange,
} from "./gaming-mode";

const ch = (label: string, elevated = false): SessionChange => ({
  label,
  elevated_restore: elevated,
});

describe("summarizeChanges", () => {
  it("summarizes multiple changes and notes auto-restore", () => {
    const s = summarizeChanges([
      ch("Power plan → max performance"),
      ch("Windows Game Mode on"),
    ]);
    expect(s.line).toContain("2 changes");
    expect(s.line.toLowerCase()).toContain("restored on exit");
    expect(s.rows.map((r) => r.label)).toEqual([
      "Power plan → max performance",
      "Windows Game Mode on",
    ]);
    expect(s.needsUac).toBe(false);
  });

  it("uses singular for one change", () => {
    expect(summarizeChanges([ch("Windows Game Mode on")]).line).toContain("1 change ·");
  });

  it("flags UAC when any change restores elevated", () => {
    expect(summarizeChanges([ch("USB selective suspend off (AC)", true)]).needsUac).toBe(true);
  });

  it("handles an empty bundle honestly", () => {
    const s = summarizeChanges([]);
    expect(s.line.toLowerCase()).toContain("no changes");
    expect(s.rows).toHaveLength(0);
    expect(s.needsUac).toBe(false);
  });
});

describe("restoredSummary", () => {
  it("names every restored change (never a bare count-only claim)", () => {
    const s = restoredSummary([ch("Power plan → max performance"), ch("Windows Game Mode on")]);
    expect(s.headline).toBe("Your settings are back");
    expect(s.detail).toContain("Restored 2 changes");
    expect(s.detail).toContain("they were");
    expect(s.labels).toEqual(["Power plan → max performance", "Windows Game Mode on"]);
  });

  it("uses singular grammar for one change", () => {
    const s = restoredSummary([ch("Windows Game Mode on")]);
    expect(s.detail).toContain("Restored 1 change");
    expect(s.detail).toContain("it was");
  });

  it("is honest about a session that changed nothing", () => {
    const s = restoredSummary([]);
    expect(s.headline).toBe("Session ended");
    expect(s.detail).toContain("nothing to restore");
    expect(s.labels).toHaveLength(0);
  });
});

// bug→guard (self-review catches 2026-07-08: recovery banner round 1, restored banner
// round 2): BOTH global banners must defer to the Gaming pane's own card on Optimize —
// otherwise the same message renders twice, stacked. The gate lives in one pure helper
// per banner so it can't silently be dropped from either render condition again.
describe("global banner defers to the Gaming pane on Optimize", () => {
  it("recovery banner shows on other tabs, never on Optimize, never without a recovery", () => {
    expect(showGlobalRecoveryBanner(true, "Overview")).toBe(true);
    expect(showGlobalRecoveryBanner(true, "Optimize")).toBe(false);
    expect(showGlobalRecoveryBanner(false, "Overview")).toBe(false);
  });

  it("restored banner shows on other tabs, never on Optimize", () => {
    expect(showGlobalRestoredBanner(true, false, "Overview")).toBe(true);
    expect(showGlobalRestoredBanner(true, false, "Optimize")).toBe(false);
    expect(showGlobalRestoredBanner(false, false, "Overview")).toBe(false);
  });

  it("a pending recovery outranks the success confirmation — never both", () => {
    expect(showGlobalRestoredBanner(true, true, "Overview")).toBe(false);
  });

  // bug→guard (2026-07-09 self-review): the Lab §5 Power-features bay ALSO embeds the Gaming Mode
  // pane, so BOTH global banners must defer on "Lab" exactly as on "Optimize" — else the same
  // recovery/restored event renders twice on the Lab tab (screenshot-confirmed duplicate).
  it("both banners defer on the Lab tab too (it embeds the Gaming Mode pane)", () => {
    expect(showGlobalRecoveryBanner(true, "Lab")).toBe(false);
    expect(showGlobalRestoredBanner(true, false, "Lab")).toBe(false);
    // …still shown on a tab that does NOT embed the pane.
    expect(showGlobalRecoveryBanner(true, "Play")).toBe(true);
    expect(showGlobalRestoredBanner(true, false, "Play")).toBe(true);
  });
});

describe("statusLabel + isRecoverable", () => {
  it("labels every status and marks them recoverable", () => {
    for (const st of ["active", "ending", "restore-pending", "restore-failed"] as const) {
      expect(statusLabel(st).length).toBeGreaterThan(0);
      expect(isRecoverable(st)).toBe(true);
    }
  });
});
