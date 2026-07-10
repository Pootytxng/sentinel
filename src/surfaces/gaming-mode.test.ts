import { describe, it, expect } from "vitest";
import {
  summarizeChanges,
  restoredSummary,
  resumeOptionsFrom,
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

// bug→guard lineage: self-review 2026-07-08 (duplicate banner over the pane's card, rounds
// 1+2) then the T6c carried note 2026-07-10 — the tab-name deferral was a BLIND SPOT: the
// pane only mounts inside a doored segment / opened disclosure, so a pending recovery was
// invisible anywhere on the Lab/Optimize tabs outside the gaming door. The contract is now
// mount-aware: defer exactly while a pane is on screen, greet everywhere else.
describe("global banners defer to the Gaming pane only while one is MOUNTED", () => {
  it("recovery banner greets while no pane is mounted, defers while one is", () => {
    expect(showGlobalRecoveryBanner(true, false)).toBe(true);
    expect(showGlobalRecoveryBanner(true, true)).toBe(false);
    expect(showGlobalRecoveryBanner(false, false)).toBe(false);
  });

  it("restored banner greets while no pane is mounted, defers while one is", () => {
    expect(showGlobalRestoredBanner(true, false, false)).toBe(true);
    expect(showGlobalRestoredBanner(true, false, true)).toBe(false);
    expect(showGlobalRestoredBanner(false, false, false)).toBe(false);
  });

  it("a pending recovery outranks the success confirmation — never both", () => {
    expect(showGlobalRestoredBanner(true, true, false)).toBe(false);
  });
});

// bug→guard (T6c, 2026-07-10): "Resume Gaming Mode" must re-apply the interrupted session's
// OWN tiers, derived from its recorded changes — the pane's checkboxes reset to core-only on
// remount, which silently downgraded a resumed advanced-tier session. Labels here are pinned
// byte-identical to the backend's (gaming_orchestrator.rs) — if a label drifts, this breaks
// loudly instead of the resume silently dropping a tier.
describe("resumeOptionsFrom", () => {
  it("a core-only session resumes core-only", () => {
    expect(
      resumeOptionsFrom([ch("Power plan → max performance"), ch("Windows Game Mode on")]),
    ).toEqual({ advancedUsb: false, advancedPcie: false, suspendServices: [] });
  });

  it("derives every advanced tier from the session's recorded changes", () => {
    const opts = resumeOptionsFrom([
      ch("Power plan → max performance"),
      ch("USB selective suspend off (AC)", true),
      ch("PCIe ASPM off (AC)", true),
      ch("Suspend WSearch for this session", true),
      ch("Suspend SysMain for this session", true),
    ]);
    expect(opts.advancedUsb).toBe(true);
    expect(opts.advancedPcie).toBe(true);
    expect(opts.suspendServices).toEqual(["WSearch", "SysMain"]);
  });

  it("never invents a tier from an empty or unrelated contract", () => {
    expect(resumeOptionsFrom([])).toEqual({
      advancedUsb: false,
      advancedPcie: false,
      suspendServices: [],
    });
    // A label that merely CONTAINS the words must not match (anchored, exact).
    expect(
      resumeOptionsFrom([ch("Suspend nothing"), ch("USB selective suspend off (AC) legacy")]),
    ).toEqual({ advancedUsb: false, advancedPcie: false, suspendServices: [] });
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
