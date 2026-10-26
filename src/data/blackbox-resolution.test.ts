import { describe, it, expect } from "vitest";
import { resolutionFor, RESOLUTION_MIN_DAYS, type HelpMark } from "./blackbox-resolution";
import type { CrashIncident, CrashAssessment } from "../types";
import enGaming from "../i18n/locales/en/gaming.json";

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
    incident_id: `${tag}-${when}`,
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
    expect(r).toEqual({ status: "none-since", kind: "GPU timeout", app: null, days: 6 });
  });

  it("reports a recurrence plainly (never hides it) when the same kind happened again after the mark", () => {
    const target = inc("GPU timeout", "2026-06-07T11:00:00Z");
    const again = inc("GPU timeout", "2026-06-10T09:30:00Z"); // 3 days after the mark
    const r = resolutionFor(target, [target, again], yes(sixDaysBefore), NOW);
    expect(r).not.toBeNull();
    expect(r).toEqual({ status: "recurred", kind: "GPU timeout", app: null, date: Date.parse("2026-06-10T09:30:00Z") });
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

  it("the resolution copy NEVER makes a causal 'it's solved' claim (every en locale line)", () => {
    // P6-next-f3: the words live in the locale files now; resolutionFor returns only facts.
    const banned = /\b(fixed|solved|worked|cured|because|caused|resolved|guaranteed|proven|definitely)\b/i;
    const lines = Object.values(enGaming.blackBox.resolution);
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line, `causal claim: ${line}`).not.toMatch(banned);
  });

  it("every kind resolves through both branches (none-since and recurred)", () => {
    const tags = ["GPU timeout", "App crash", "App hang", "Unexpected shutdown / hard freeze", "Blue screen", "Hardware-logged error"];
    for (const tag of tags) {
      const target = inc(tag, "2026-06-07T11:00:00Z");
      const again = inc(tag, "2026-06-10T09:30:00Z");
      expect(resolutionFor(target, [target], yes(sixDaysBefore), NOW)?.status, tag).toBe("none-since");
      expect(resolutionFor(target, [target, again], yes(sixDaysBefore), NOW)?.status, tag).toBe("recurred");
    }
  });

  it("counts whole days: under a day is nothing, 26 hours is 1 day", () => {
    const target = inc("Blue screen", "2026-06-11T11:00:00Z");
    // NOW = 06-13T12:00Z. Mark 16h before → floor(0.67) = 0 days → too soon → null.
    expect(resolutionFor(target, [target], yes("2026-06-12T20:00:00Z"), NOW)).toBeNull();
    // Mark 26h before → floor(1.08) = 1 day.
    const oneDay = resolutionFor(target, [target], yes("2026-06-12T10:00:00Z"), NOW);
    expect(oneDay).toEqual({ status: "none-since", kind: "Blue screen", app: null, days: 1 });
  });
});

// P6-next-f1: "App crash" / "App hang" cover every app, so a recurrence must also be the same faulting
// app (case-insensitive), as care-next-step.ts `sameKind` does.
describe("Black Box v2.1 — app kinds match the faulting app", () => {
  const withApp = (tag: string, when: string, app: string | null): CrashIncident => {
    const i = inc(tag, when);
    return { ...i, incident_id: `${tag}-${when}-${app}`, receipt: { ...i.receipt!, faulting_app: app } };
  };

  for (const tag of ["App crash", "App hang"]) {
    it(`${tag}: another app after the mark is NOT a recurrence, and the line names the app`, () => {
      const target = withApp(tag, "2026-06-07T11:00:00Z", "Wardogs.exe");
      const browser = withApp(tag, "2026-06-10T09:30:00Z", "msedge.exe");
      const r = resolutionFor(target, [target, browser], yes(sixDaysBefore), NOW);
      expect(r).toEqual({ status: "none-since", kind: tag, app: "Wardogs.exe", days: 6 });
    });

    it(`${tag}: the same app (any case) after the mark IS a recurrence`, () => {
      const target = withApp(tag, "2026-06-07T11:00:00Z", "Wardogs.exe");
      const again = withApp(tag, "2026-06-10T09:30:00Z", "WARDOGS.EXE");
      const r = resolutionFor(target, [target, again], yes(sixDaysBefore), NOW);
      expect(r).toEqual({ status: "recurred", kind: tag, app: "Wardogs.exe", date: Date.parse("2026-06-10T09:30:00Z") });
    });

    it(`${tag}: no faulting app on the marked incident falls back to the tag alone`, () => {
      const target = withApp(tag, "2026-06-07T11:00:00Z", null);
      const other = withApp(tag, "2026-06-10T09:30:00Z", "msedge.exe");
      const r = resolutionFor(target, [target, other], yes(sixDaysBefore), NOW);
      expect(r).toEqual({ status: "recurred", kind: tag, app: null, date: Date.parse("2026-06-10T09:30:00Z") });
    });
  }
});
