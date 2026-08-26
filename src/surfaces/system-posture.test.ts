import { describe, it, expect } from "vitest";
import { deriveSystemPosture as deriveSystemPostureRaw } from "./system-posture";
import type { GameReadiness, ReadinessCheck } from "../types";
// i18n update (2026-07-23): deriveSystemPosture's headline/sub now come from t(...) (Simplified
// Chinese translation pass) instead of literal English strings, so it takes a TFunction as its
// last param. This test-local wrapper resolves it through the real i18next instance (English is
// the default language, matching what every assertion below already expects) so every call site
// stays exactly as written — same text, just sourced from locale JSON instead of a .ts literal.
import i18n from "../i18n";

const deriveSystemPosture = (input: Parameters<typeof deriveSystemPostureRaw>[0]) =>
  deriveSystemPostureRaw(input, i18n.t);

const check = (status: ReadinessCheck["status"], label: string, detail = ""): ReadinessCheck =>
  ({ id: label, label, status, detail, value: null });

const readiness = (checks: ReadinessCheck[], dismissed: string[] = []): GameReadiness => {
  const d = new Set(dismissed);
  return {
    checks,
    ready_count: checks.filter((c) => c.status === "ready").length,
    // attention_count excludes dismissed (mirrors the backend).
    attention_count: checks.filter((c) => c.status === "attention" && !d.has(c.id)).length,
    unknown_count: checks.filter((c) => c.status === "unknown").length,
    advisory_count: checks.filter((c) => c.status === "advisory").length,
    advisory: "",
    dismissed_ids: dismissed,
    drifts: [],
  };
};

describe("deriveSystemPosture", () => {
  it("is 'scanning' before readiness loads", () => {
    expect(deriveSystemPosture({ readiness: null, activeChanges: 0, monitoringAvailable: false }).state).toBe("scanning");
  });

  // bug→guard (owner regression 2026-07-17): the vague "N thing(s) need(s) your attention"
  // count had crept back onto Home's verdict strip. The verdict must NAME the flagged thing
  // (name-it-and-fix-it-inline law) and never render a bare count headline again.
  const VAGUE_COUNT = /\bthings?\b[^.]*\bneeds?\b[^.]*attention/i;

  it("attention names the specific thing — one flagged check ⇒ the verdict IS that check", () => {
    const r = readiness([check("ready", "SSD"), check("attention", "Monitor below max refresh")]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 2, monitoringAvailable: true });
    expect(p.state).toBe("attention");
    expect(p.attentionCount).toBe(1);
    expect(p.reasons).toEqual(["Monitor below max refresh"]);
    expect(p.headline).toBe("Monitor below max refresh");
    expect(p.headline).not.toMatch(VAGUE_COUNT);
  });

  // bug→guard (owner ruling 2026-08-26, issue #219): the headline used to append "· and N more".
  // That tail was measured as what pushed the 40px verdict onto a third line, and it was the only
  // part of the headline naming nothing. It is gone — the headline is the flagged check's label and
  // stops there. This pins BOTH directions: the label must survive whole, and no count may return.
  const COUNT_TAIL = /·|\band\b|\bmore\b|\b\d+\b/;

  it("attention with several flagged checks names the first and stops — no '· and N more' tail", () => {
    const r = readiness([
      check("attention", "Monitor below max refresh"),
      check("attention", "GPU driver age"),
      check("attention", "Power profile"),
    ]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 0, monitoringAvailable: true });
    // The count did not disappear from the product — it moved down a level. `attentionCount` and
    // the full `reasons` list still carry every flagged check, and HomeConsole's sub prints the
    // honest proportion beneath the verdict. Only the HEADLINE stopped counting.
    expect(p.attentionCount).toBe(3);
    expect(p.reasons).toEqual(["Monitor below max refresh", "GPU driver age", "Power profile"]);
    expect(p.headline).toBe("Monitor below max refresh");
    expect(p.headline).not.toMatch(COUNT_TAIL);
    expect(p.headline).not.toMatch(VAGUE_COUNT);
  });

  it("a label that legitimately contains a number is not mangled by the no-count rule", () => {
    // Falsification in the other direction: the rule is "append nothing", not "strip digits". A
    // real catalog label like "2 startup apps slow your boot" must still render verbatim.
    const r = readiness([
      check("attention", "2 startup apps slow your boot"),
      check("attention", "GPU driver age"),
    ]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 0, monitoringAvailable: true });
    expect(p.headline).toBe("2 startup apps slow your boot");
  });

  it("no locale still ships the retired count-tail string", () => {
    // The key is gone from en and zh-CN. If someone re-adds it, this fails before it can reach a
    // headline again — a live translation string is a standing invitation to wire it back up.
    expect(i18n.exists("home.posture.attentionMore")).toBe(false);
  });

  it("attention sub carries the flagged check's own detail — the fix travels with the name", () => {
    const r = readiness([
      check("attention", "Variable refresh rate", "It's OFF — turn it on for smoother pacing."),
    ]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 0, monitoringAvailable: true });
    expect(p.sub).toBe("It's OFF — turn it on for smoother pacing.");
  });

  it("is 'dialed-in' when all checks pass", () => {
    const r = readiness([check("ready", "SSD"), check("ready", "Refresh")]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 4, monitoringAvailable: true });
    expect(p.state).toBe("dialed-in");
    expect(p.attentionCount).toBe(0);
    expect(p.reasons).toEqual([]);
  });

  it("treats 'advisory' as not-attention, so posture stays dialed-in", () => {
    const r = readiness([check("ready", "SSD"), check("advisory", "Variable refresh rate")]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 0, monitoringAvailable: true });
    expect(p.state).toBe("dialed-in");
    expect(p.attentionCount).toBe(0);
  });

  it("a dismissed attention check no longer drives the posture (stays dialed-in)", () => {
    const r = readiness([check("ready", "SSD"), check("attention", "HDR")], ["HDR"]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 0, monitoringAvailable: true });
    expect(p.state).toBe("dialed-in");
    expect(p.attentionCount).toBe(0);
    expect(p.reasons).toEqual([]);
  });

  it("is 'unknown' when readiness has no usable checks", () => {
    expect(deriveSystemPosture({ readiness: readiness([]), activeChanges: 0, monitoringAvailable: false }).state).toBe("unknown");
  });
});
