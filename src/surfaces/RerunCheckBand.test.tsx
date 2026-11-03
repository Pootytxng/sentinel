import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { RerunCheckBand } from "./RerunCheckBand";
import { LAST_CHECK_KEY, formatCheckAge, type LastCheck } from "./last-check";
import type { GameReadiness, ReadinessCheck, ReadinessStatus } from "../types";
import { readFileSync } from "fs";
import { join } from "path";

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
    JSON.stringify({ at: Date.now(), total: 16, green: 16, advisory: 0, unread: 0, fixCount: 0, ...v }),
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
    storeCheck({ at: Date.now() - 60_000, total: 16, green: 14, unread: 2, fixCount: 0 });
    render(<RerunCheckBand readiness={readiness({})} checking={false} onRunCheck={() => {}} />);
    expect(line()).toContain("14 of 16 looked good");
    expect(line()).toContain("couldn't be measured");
    expect(line(), "claimed all 16 clean off a 14-green snapshot").not.toContain("all 16 looked");
  });

  // Desk review 2026-11-03 (his rig: 14 ready, network QoS and VRR advisory): the band said "all 16
  // looked good" while FirstCheck said 2 were noted, not graded. An advisory never looks good.
  it("a stored snapshot with advisory checks counts only the graded ones and names the advisory", () => {
    storeCheck({ at: Date.now() - 4 * 60_000, total: 16, green: 14, advisory: 2, unread: 0, fixCount: 0 });
    render(<RerunCheckBand readiness={readiness({})} checking={false} onRunCheck={() => {}} />);
    expect(line()).toContain("Checked 4m ago · all 14 looked good · 2 advisory, not graded");
    expect(line()).not.toContain("all 16");
  });

  it("the live fallback counts only the graded checks and names the advisory", () => {
    const r = readiness({
      checks: [chk("ready"), chk("ready"), chk("ready"), chk("advisory"), chk("unknown")],
      unknown_count: 1,
      advisory_count: 1,
    });
    render(<RerunCheckBand readiness={r} checking={false} onRunCheck={() => {}} />);
    expect(line()).toContain("3 of 5 checks look good · 1 couldn't be measured · 1 advisory, not graded");
    cleanup();
    const clean = readiness({ checks: [chk("ready"), chk("ready"), chk("advisory"), chk("advisory")], advisory_count: 2 });
    render(<RerunCheckBand readiness={clean} checking={false} onRunCheck={() => {}} />);
    expect(line()).toContain("All 2 checks look good · 2 advisory, not graded");
    expect(line()).not.toContain("All 4");
  });

  it("a record from before the split is not read back: live counts, no age", () => {
    localStorage.setItem(LAST_CHECK_KEY, JSON.stringify({ at: Date.now() - 60_000, total: 16, green: 16, fixCount: 0 }));
    const r = readiness({ checks: [chk("ready"), chk("advisory")], advisory_count: 1 });
    render(<RerunCheckBand readiness={r} checking={false} onRunCheck={() => {}} />);
    expect(line()).not.toMatch(/ago|just now|yesterday|Checked/);
    expect(line()).toContain("The one check looks good · 1 advisory, not graded");
  });

  // The row is a status line, not a destination. It had grown into a bordered panel with an
  // uppercase tag stacked above its own sentence, which is what made it a third competing card
  // above Home's fold. Structure guard so it cannot grow the walls back.
  //
  // bug->guard (owner, 2026-08-18): the FIRST pass removed the panel and left the bordered "Re-run
  // check" button standing at the row's right edge — one of the three controls he had named by name
  // as clutter, still shipped, while the report said the strip was dealt with. A capture of the live
  // build is what caught it. These pins fail if either wall comes back.
  it("is ONE row of type: no tag block, no bordered button, actions are inline links", () => {
    const r = readiness({ checks: [chk("ready")] });
    const { container } = render(
      <RerunCheckBand readiness={r} checking={false} onRunCheck={() => {}} />,
    );
    expect(container.querySelectorAll(".rcb-status").length).toBe(1);
    expect(container.querySelectorAll(".rcb-run").length).toBe(1);
    expect(container.querySelector(".rcb-tag"), "the uppercase tag row is back").toBeNull();
    expect(container.querySelector(".rcb-btn"), "the bordered Re-run button is back").toBeNull();
    // The run control lives INSIDE the sentence, not as a sibling floated to the far edge.
    expect(container.querySelector(".rcb-status .rcb-run")).not.toBeNull();
  });

  // The affordance itself must survive the demotion: this control is the only entry point to
  // <FirstCheck> (App.tsx setShowFirstCheck), so losing it strands a whole flow, and dropping its
  // text label would blind src/affordance-census.test.ts to it.
  it("keeps a NAMED, reachable Re-run control after the demotion", () => {
    const onRunCheck = vi.fn();
    render(<RerunCheckBand readiness={readiness({})} checking={false} onRunCheck={onRunCheck} />);
    const run = screen.getByRole("button", { name: /Re-run check/ });
    expect(run.className).toContain("rcb-run");
    fireEvent.click(run);
    expect(onRunCheck).toHaveBeenCalledOnce();
  });

  // Static CSS pin: jsdom loads no stylesheets, so a structure test cannot see a border coming back
  // on the control it just approved. Read the file instead (the .rcb-verdict-scale precedent).
  it("CSS: no rule inside the .rcb scope paints a border or a panel fill", () => {
    const css = readFileSync(join("src", "surfaces", "RerunCheckBand.css"), "utf8");
    const offenders = css
      .split("}")
      .filter((block) => /\.rcb/.test(block))
      .flatMap((block) =>
        [...block.matchAll(/^\s*(border|background)\s*:\s*([^;]+);/gm)]
          .filter(([, , value]) => !/^(0|none|transparent)$/.test(value.trim()))
          // The state dot IS a painted disc — that is the whole control, not a wall.
          .filter(() => !/\.rcb-dot/.test(block))
          .map(([, prop, value]) => `${block.trim().split("{")[0].trim()} { ${prop}: ${value} }`),
      );
    expect(offenders, "the band grew walls back").toEqual([]);
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
