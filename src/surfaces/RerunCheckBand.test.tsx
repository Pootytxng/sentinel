import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RerunCheckBand } from "./RerunCheckBand";
import { LAST_CHECK_KEY, formatCheckAge, type LastCheck } from "./last-check";
import type { GameReadiness, ReadinessCheck, ReadinessStatus } from "../types";

// RerunCheckBand — Home's single Re-run affordance (owner-approved "A · Status band"). These guards
// pin the two properties the honesty law makes non-negotiable:
//   1. an AGE only renders when a real check record exists (localStorage snapshot); the no-snapshot
//      fallback shows LIVE counts and NO age — never a time we didn't measure.
//   2. the Re-run action is wired (onRunCheck fires) and locks out while a check is running.
// Plus formatCheckAge's pure boundaries (bug→guard: coarse ages must not over-state precision).

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const chk = (status: ReadinessStatus): ReadinessCheck => ({
  id: Math.random().toString(36).slice(2),
  label: "check",
  status,
  detail: "",
  value: null,
});

const readiness = (over: Partial<GameReadiness>): GameReadiness => ({
  checks: [],
  ready_count: 0,
  attention_count: 0,
  unknown_count: 0,
  advisory_count: 0,
  advisory: "",
  dismissed_ids: [],
  drifts: [],
  ...over,
});

const storeCheck = (v: Partial<LastCheck>) =>
  localStorage.setItem(
    LAST_CHECK_KEY,
    JSON.stringify({ at: Date.now(), total: 16, green: 16, fixCount: 0, ...v }),
  );

describe("formatCheckAge — coarse honest ages", () => {
  const base = 1_000_000_000_000;
  it("under a minute → just now", () => expect(formatCheckAge(base, base + 30_000)).toBe("just now"));
  it("minutes", () => expect(formatCheckAge(base, base + 5 * 60_000)).toBe("5m ago"));
  it("hours", () => expect(formatCheckAge(base, base + 2 * 3_600_000)).toBe("2h ago"));
  it("one day → yesterday", () => expect(formatCheckAge(base, base + 26 * 3_600_000)).toBe("yesterday"));
  it("days", () => expect(formatCheckAge(base, base + 3 * 86_400_000)).toBe("3d ago"));
  it("weeks", () => expect(formatCheckAge(base, base + 15 * 86_400_000)).toBe("2w ago"));
});

describe("RerunCheckBand honesty — age only with a real record", () => {
  it("with a stored snapshot: shows the age + clean ratio", () => {
    storeCheck({ at: Date.now() - 2 * 3_600_000, total: 16, green: 16, fixCount: 0 });
    render(<RerunCheckBand readiness={readiness({})} checking={false} onRunCheck={() => {}} />);
    expect(screen.getByText("Last check")).toBeTruthy();
    expect(screen.getByText(/2h ago/)).toBeTruthy();
    expect(screen.getByText("16/16")).toBeTruthy();
  });

  it("with a snapshot that has fixes: shows age + fix count, no clean ratio", () => {
    storeCheck({ at: Date.now() - 5 * 60_000, total: 16, green: 14, fixCount: 2 });
    render(<RerunCheckBand readiness={readiness({})} checking={false} onRunCheck={() => {}} />);
    expect(screen.getByText(/5m ago/)).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText(/to fix/)).toBeTruthy();
  });

  it("NO snapshot: falls back to live counts with NO age", () => {
    const r = readiness({ checks: [chk("ready"), chk("ready"), chk("ready")] });
    render(<RerunCheckBand readiness={r} checking={false} onRunCheck={() => {}} />);
    // Honesty: the fallback tag is "Checks", never "Last check", and no age string appears.
    expect(screen.getByText("Checks")).toBeTruthy();
    expect(screen.queryByText("Last check")).toBeNull();
    expect(screen.queryByText(/ago|just now|yesterday/)).toBeNull();
    // Live measured/total ratio still renders (the "3/3"-style honest count).
    expect(screen.getByText("3/3")).toBeTruthy();
  });

  it("fallback with unknowns + attention: measured/total excludes unknowns, flags attention", () => {
    const r = readiness({
      checks: [chk("ready"), chk("ready"), chk("attention"), chk("unknown")],
      attention_count: 1,
      unknown_count: 1,
    });
    render(<RerunCheckBand readiness={r} checking={false} onRunCheck={() => {}} />);
    expect(screen.getByText("3/4")).toBeTruthy(); // 4 total − 1 unknown measured
    expect(screen.getByText(/1 flagged/)).toBeTruthy();
  });
});

describe("RerunCheckBand — Re-run action wiring", () => {
  it("fires onRunCheck on click when idle", () => {
    const onRunCheck = vi.fn();
    render(<RerunCheckBand readiness={readiness({})} checking={false} onRunCheck={onRunCheck} />);
    fireEvent.click(screen.getByRole("button", { name: /Re-run check/ }));
    expect(onRunCheck).toHaveBeenCalledOnce();
  });

  it("while checking: button is disabled, label is Checking…, and status reads running", () => {
    const onRunCheck = vi.fn();
    // Even with a stored snapshot, checking must ignore it and show the live running state.
    storeCheck({});
    render(<RerunCheckBand readiness={readiness({})} checking={true} onRunCheck={onRunCheck} />);
    const btn = screen.getByRole("button", { name: /Checking/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(onRunCheck).not.toHaveBeenCalled();
    expect(screen.getByText("running checks…")).toBeTruthy();
    expect(screen.queryByText("Last check")).toBeNull();
  });
});
