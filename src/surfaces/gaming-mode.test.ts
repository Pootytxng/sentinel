import { describe, it, expect } from "vitest";
import {
  summarizeChanges,
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

describe("statusLabel + isRecoverable", () => {
  it("labels every status and marks them recoverable", () => {
    for (const st of ["active", "ending", "restore-pending", "restore-failed"] as const) {
      expect(statusLabel(st).length).toBeGreaterThan(0);
      expect(isRecoverable(st)).toBe(true);
    }
  });
});
