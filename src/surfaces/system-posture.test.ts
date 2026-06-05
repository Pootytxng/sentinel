import { describe, it, expect } from "vitest";
import { deriveSystemPosture } from "./system-posture";
import type { GameReadiness, ReadinessCheck } from "../types";

const check = (status: ReadinessCheck["status"], label: string): ReadinessCheck =>
  ({ id: label, label, status, detail: "", value: null });

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
  };
};

describe("deriveSystemPosture", () => {
  it("is 'scanning' before readiness loads", () => {
    expect(deriveSystemPosture({ readiness: null, activeChanges: 0, monitoringAvailable: false }).state).toBe("scanning");
  });

  it("is 'attention' with the count + reasons when checks need attention", () => {
    const r = readiness([check("ready", "SSD"), check("attention", "Monitor below max refresh")]);
    const p = deriveSystemPosture({ readiness: r, activeChanges: 2, monitoringAvailable: true });
    expect(p.state).toBe("attention");
    expect(p.attentionCount).toBe(1);
    expect(p.reasons).toEqual(["Monitor below max refresh"]);
    expect(p.headline).toMatch(/attention/i);
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
