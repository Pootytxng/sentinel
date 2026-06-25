// Content guard for the timer-resolution re-grade (honesty corpus-audit handoff, 2026-06-25; bug->guard).
// The entry was graded `placebo` (per the glossary: "changes nothing you can measure") while its OWN
// prose described a measurable, double-edged effect — some rigs steadier lows, some worse, all at higher
// idle power. That's an internal inconsistency honesty's 8-agent web-verified audit flagged (Windows timer
// behaviour, Bruce Dawson). By the verdict glossary that's `risky` ("it might do something, but it brings
// real tradeoffs"), not placebo. This pins the verdict + the honest double-edged framing so the corpus
// can't silently regress to claiming a measurable-effect tweak does nothing.
import { describe, it, expect } from "vitest";
import { KNOWLEDGE_BY_ID } from "./knowledge";

const ID = "timer-resolution";

describe("timer-resolution verdict (corpus-audit re-grade)", () => {
  const e = KNOWLEDGE_BY_ID.get(ID);

  it("is graded risky, not placebo (it has a measurable, double-edged effect)", () => {
    expect(e, `entry "${ID}" must exist`).toBeTruthy();
    if (e!.type !== "tweak") throw new Error("expected a tweak");
    expect(e!.verdict).toBe("risky");
  });

  it("stays honest — names a real cost AND that it isn't a reliable win, no FPS promise", () => {
    if (e!.type !== "tweak") throw new Error("expected a tweak");
    const body = `${e!.what} ${e!.why}`.toLowerCase();
    expect(body).toMatch(/idle power|power/); // the tradeoff/cost that makes it risky, not free
    expect(body).toMatch(/inconsistent|worse|not.{0,8}reliabl|not a clean win/); // double-edged, not a sure win
    expect(body, "no fabricated FPS promise").not.toMatch(/more fps|higher fps|guaranteed/);
  });
});
