import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RerunCheckBand } from "./RerunCheckBand";
import { LAST_CHECK_KEY, formatCheckAge, type LastCheck } from "./last-check";
import type { GameReadiness, ReadinessCheck, ReadinessStatus } from "../types";

// RerunCheckBand — Home's check line + its single Re-run affordance. These guards pin the properties
// the honesty law makes non-negotiable:
//   1. an AGE only renders when a real check record exists (localStorage snapshot); the no-snapshot
//      fallback shows LIVE counts and NO age — never a time we didn't measure. The old uppercase tag
//      row ("Last check" vs "Checks") used to carry that distinction; the sentence now carries it in
//      words, so these tests assert on the SENTENCE, which is what a user actually reads.
//   2. UNMEASURED IS NEVER COUNTED AS CLEAN (bug→guard, 2026-08-18). The old clean line printed a
//      bare `measured/total`, so "14/16" meant BOTH "two failed" and "two were unreadable". A user
//      cannot act on a number that means two opposite things.
//   3. the Re-run action is wired (onRunCheck fires) and locks out while a check is running.
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

/** What the user actually reads. The old tests asserted on tag labels and bare ratios. */
const line = () => document.querySelector(".rcb-status")?.textContent ?? "";

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
  it("with an all-clean snapshot: names when it was checked and amplifies the win", () => {
    storeCheck({ at: Date.now() - 2 * 3_600_000, total: 16, green: 16, fixCount: 0 });
    render(<RerunCheckBand readiness={readiness({})} checking={false} onRunCheck={() => {}} />);
    expect(line()).toContain("2h ago");
    expect(line()).toContain("all 16 looked good");
  });

  it("with a snapshot that has fixes: age + how many to fix, in words", () => {
    storeCheck({ at: Date.now() - 5 * 60_000, total: 16, green: 14, fixCount: 2 });
    render(<RerunCheckBand readiness={readiness({})} checking={false} onRunCheck={() => {}} />);
    expect(line()).toContain("5m ago");
    expect(line()).toContain("2 things to fix");
  });

  it("singular reads as English, not as a template", () => {
    storeCheck({ at: Date.now() - 5 * 60_000, total: 16, green: 15, fixCount: 1 });
    render(<RerunCheckBand readiness={readiness({})} checking={false} onRunCheck={() => {}} />);
    expect(line()).toContain("1 thing to fix");
  });

  it("NO snapshot: falls back to live counts with NO age", () => {
    const r = readiness({ checks: [chk("ready"), chk("ready"), chk("ready")] });
    render(<RerunCheckBand readiness={r} checking={false} onRunCheck={() => {}} />);
    // Honesty: with nothing stored the line states no time at all — never a time we didn't measure.
    expect(line()).not.toMatch(/ago|just now|yesterday|Checked/);
    expect(line()).toContain("All 3 checks look good");
  });

  it("fallback with unknowns + attention: counts the flagged ones, excludes the unreadable", () => {
    const r = readiness({
      checks: [chk("ready"), chk("ready"), chk("attention"), chk("unknown")],
      attention_count: 1,
      unknown_count: 1,
    });
    render(<RerunCheckBand readiness={r} checking={false} onRunCheck={() => {}} />);
    expect(line()).toContain("1 of 4 checks needs a look");
  });

  // bug → guard (2026-08-18): the honesty hole the old ratio hid. Two checks Compy CANNOT read must
  // never render the same way as two checks Compy read and found broken — a user acts differently on
  // each, and "unmeasured" silently folded into a dirty-looking number is exactly the claim the
  // receipts doctrine bars. No attention, two unknowns: the line must say so.
  it("unreadable checks are named as unreadable, never counted as clean OR as problems", () => {
    const r = readiness({
      checks: [chk("ready"), chk("ready"), chk("unknown"), chk("unknown")],
      attention_count: 0,
      unknown_count: 2,
    });
    render(<RerunCheckBand readiness={r} checking={false} onRunCheck={() => {}} />);
    expect(line()).toContain("2 of 4 checks look good");
    expect(line()).toContain("couldn't be measured");
    expect(line(), "claimed all clear while two checks were unreadable").not.toContain("All 4");
  });

  it("the same honesty holds for a stored snapshot with unreadable checks", () => {
    storeCheck({ at: Date.now() - 60_000, total: 16, green: 14, fixCount: 0 });
    render(<RerunCheckBand readiness={readiness({})} checking={false} onRunCheck={() => {}} />);
    expect(line()).toContain("14 of 16 looked good");
    expect(line()).toContain("couldn't be measured");
    expect(line(), "claimed all 16 clean off a 14-green snapshot").not.toContain("all 16 looked");
  });

  // The row is a status line, not a destination. It had grown into a bordered panel with an
  // uppercase tag stacked above its own sentence, which is what made it a third competing card
  // above Home's fold. Structure guard so it cannot grow the walls back.
  it("is ONE row: no uppercase tag block, one sentence, one button", () => {
    const r = readiness({ checks: [chk("ready")] });
    const { container } = render(
      <RerunCheckBand readiness={r} checking={false} onRunCheck={() => {}} />,
    );
    expect(container.querySelectorAll(".rcb-status").length).toBe(1);
    expect(container.querySelectorAll(".rcb-btn").length).toBe(1);
    expect(container.querySelector(".rcb-tag"), "the uppercase tag row is back").toBeNull();
  });
});

describe("RerunCheckBand — Re-run action wiring", () => {
  it("fires onRunCheck on click when idle", () => {
    const onRunCheck = vi.fn();
    render(<RerunCheckBand readiness={readiness({})} checking={false} onRunCheck={onRunCheck} />);
    fireEvent.click(screen.getByRole("button", { name: /Re-run check/ }));
    expect(onRunCheck).toHaveBeenCalledOnce();
  });

  it("while checking: button is disabled, label is Checking…, and the line reads running", () => {
    const onRunCheck = vi.fn();
    // Even with a stored snapshot, checking must ignore it and show the live running state.
    storeCheck({});
    render(<RerunCheckBand readiness={readiness({})} checking={true} onRunCheck={onRunCheck} />);
    const btn = screen.getByRole("button", { name: /Checking/ });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(btn);
    expect(onRunCheck).not.toHaveBeenCalled();
    // Checking IGNORES the stored snapshot: no stale age while a live check is in flight.
    expect(line()).toContain("Checking your PC now");
    expect(line()).not.toMatch(/ago|just now|yesterday|Checked /);
  });
});
