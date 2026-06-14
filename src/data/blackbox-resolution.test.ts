import { describe, it, expect } from "vitest";
import { resolutionFor, RESOLUTION_MIN_DAYS, type HelpMark } from "./blackbox-resolution";
import type { CrashIncident, CrashAssessment } from "../types";

// A minimal assessment so the incident counts as "assessed" (gate ON). Content is irrelevant here.
const ASSESS: CrashAssessment = {
  consistent_with: "x",
  strength: "strong",
  evidence: [],
  next_step: { headline: "h", detail: "d", reversible: true, research_only: false },
  beyond_us: false,
};

function inc(tag: string, when: string, assessed = true): CrashIncident {
  return {
    headline: "h",
    tag,
    when,
    when_display: "d",
    vitals: null,
    receipt: { source: "s", event_ids: [], faulting_app: null, faulting_module: null, code: null, detail: "" },
    assessment: assessed ? ASSESS : null,
  };
}

const yes = (at: string): HelpMark => ({ vote: "yes", at });

// A fixed "now" for deterministic day math.
const NOW = new Date("2026-06-13T12:00:00Z");
const sixDaysBefore = "2026-06-07T12:00:00Z";

describe("Black Box v2.1 — measured-absence resolution", () => {
  it("reports a measured ABSENCE when no same-kind incident occurred since the 'yes' mark", () => {
    const target = inc("GPU timeout", "2026-06-07T11:00:00Z"); // crash, then marked helpful at 12:00
    const r = resolutionFor(target, [target], yes(sixDaysBefore), NOW);
    expect(r).not.toBeNull();
    expect(r!.status).toBe("none-since");
    expect(r!.text).toBe("No GPU timeout recorded in the 6 days since.");
  });

  it("reports a recurrence plainly (never hides it) when the same kind happened again after the mark", () => {
    const target = inc("GPU timeout", "2026-06-07T11:00:00Z");
    const again = inc("GPU timeout", "2026-06-10T09:30:00Z"); // 3 days after the mark
    const r = resolutionFor(target, [target, again], yes(sixDaysBefore), NOW);
    expect(r).not.toBeNull();
    expect(r!.status).toBe("recurred");
    expect(r!.text).toMatch(/^GPU timeout happened again on /);
  });

  it("a DIFFERENT kind after the mark is NOT a recurrence", () => {
    const target = inc("GPU timeout", "2026-06-07T11:00:00Z");
    const other = inc("App crash", "2026-06-10T09:30:00Z"); // different tag → ignored
    const r = resolutionFor(target, [target, other], yes(sixDaysBefore), NOW);
    expect(r!.status).toBe("none-since");
  });

  it("shows NOTHING without a 'yes' mark (no mark, or a 'no')", () => {
    const target = inc("GPU timeout", "2026-06-07T11:00:00Z");
    expect(resolutionFor(target, [target], null, NOW)).toBeNull();
    expect(resolutionFor(target, [target], { vote: "no", at: sixDaysBefore }, NOW)).toBeNull();
  });

  it("shows NOTHING when the incident has no assessment (flag OFF / refuse-to-guess)", () => {
    const target = inc("GPU timeout", "2026-06-07T11:00:00Z", /* assessed */ false);
    expect(resolutionFor(target, [target], yes(sixDaysBefore), NOW)).toBeNull();
  });

  it("shows NOTHING when too little time has elapsed (no fabricated reassurance)", () => {
    const target = inc("App hang", "2026-06-13T08:00:00Z");
    // marked only hours ago → 0 whole days elapsed, and no recurrence → null
    const r = resolutionFor(target, [target], yes("2026-06-13T09:00:00Z"), NOW);
    expect(RESOLUTION_MIN_DAYS).toBeGreaterThanOrEqual(1);
    expect(r).toBeNull();
  });

  it("shows NOTHING for an old mark with no timestamp (can't anchor a 'since')", () => {
    const target = inc("GPU timeout", "2026-06-07T11:00:00Z");
    expect(resolutionFor(target, [target], { vote: "yes", at: "" }, NOW)).toBeNull();
  });

  it("the surfaced copy NEVER makes a causal 'it's solved' claim", () => {
    const target = inc("GPU timeout", "2026-06-07T11:00:00Z");
    const again = inc("GPU timeout", "2026-06-10T09:30:00Z");
    const banned = /\b(fixed|solved|worked|cured|because|caused|resolved|guaranteed)\b/i;
    for (const ctx of [[target], [target, again]]) {
      const r = resolutionFor(target, ctx, yes(sixDaysBefore), NOW);
      expect(r, "a resolution should exist for this case").not.toBeNull();
      expect(r!.text, `causal claim leaked: "${r!.text}"`).not.toMatch(banned);
    }
  });

  it("makes NO causal 'solved' claim for ANY incident kind (none-since or recurred)", () => {
    // Sweep every kind through both branches — the measured-absence line must stay factual, never "fixed".
    const banned = /\b(fixed|solved|worked|cured|because|caused|resolved|guaranteed|proven|definitely)\b/i;
    const tags = ["GPU timeout", "App crash", "App hang", "Unexpected shutdown / hard freeze", "Blue screen", "Hardware-logged error"];
    for (const tag of tags) {
      const target = inc(tag, "2026-06-07T11:00:00Z");
      const again = inc(tag, "2026-06-10T09:30:00Z");
      for (const ctx of [[target], [target, again]]) {
        const r = resolutionFor(target, ctx, yes(sixDaysBefore), NOW);
        expect(r, `${tag} should resolve`).not.toBeNull();
        expect(r!.text, `causal claim for ${tag}: ${r!.text}`).not.toMatch(banned);
      }
    }
  });

  it("singular day reads 'day', plural reads 'days'", () => {
    const target = inc("Blue screen", "2026-06-11T11:00:00Z");
    // NOW = 06-13T12:00Z. Mark 16h before → floor(0.67) = 0 days → too soon → null.
    expect(resolutionFor(target, [target], yes("2026-06-12T20:00:00Z"), NOW)).toBeNull();
    // Mark 26h before → floor(1.08) = 1 day → "1 day since" (singular).
    const oneDay = resolutionFor(target, [target], yes("2026-06-12T10:00:00Z"), NOW);
    expect(oneDay!.text).toContain("1 day since");
    expect(oneDay!.text).not.toContain("1 days");
  });
});
