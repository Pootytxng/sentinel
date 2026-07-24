import { describe, it, expect } from "vitest";
import { postureLine as postureLineRaw, liveStrip as liveStripRaw } from "./command-center-data";
import type { GameReadiness, Priorities, ReadinessCheck, SessionSummary } from "../types";
// i18n update (2026-07-23): postureLine/liveStrip's strings now come from t(...) (Simplified
// Chinese translation pass) instead of literal English, so both take a TFunction as their last
// param. These test-local wrappers resolve them through the real i18next instance (English is the
// default language, matching what every assertion below already expects) so every call site below
// stays exactly as written — same text, just sourced from locale JSON instead of a .ts literal.
import i18n from "../i18n";

const postureLine = (
  readiness: GameReadiness | null,
  priorities: Priorities | null,
  activeChanges: number,
) => postureLineRaw(readiness, priorities, activeChanges, i18n.t);
const liveStrip = (sessions: SessionSummary[]) => liveStripRaw(sessions, i18n.t);

const check = (status: ReadinessCheck["status"], label: string): ReadinessCheck =>
  ({ id: label, label, status, detail: "", value: null });

const readiness = (checks: ReadinessCheck[], dismissed: string[] = []): GameReadiness => {
  const d = new Set(dismissed);
  return {
    checks,
    ready_count: checks.filter((c) => c.status === "ready").length,
    attention_count: checks.filter((c) => c.status === "attention" && !d.has(c.id)).length,
    unknown_count: checks.filter((c) => c.status === "unknown").length,
    advisory_count: checks.filter((c) => c.status === "advisory").length,
    advisory: "",
    dismissed_ids: dismissed,
    drifts: [],
  };
};

const priorities = (limiters: number): Priorities => ({
  limiters: Array.from({ length: limiters }, (_, i) => ({
    id: `l${i}`,
    title: `Limiter ${i}`,
    reason: "",
    linked: null,
    confidence: "medium",
    status: "attention",
  })),
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
});

describe("postureLine (real headline + priorities-driven sentence)", () => {
  it("ready with limiters → 'N worth fixing'", () => {
    const p = postureLine(readiness([check("ready", "SSD")]), priorities(3), 1);
    expect(p.tone).toBe("ready");
    expect(p.sentence).toBe("Ready to play — 3 worth fixing.");
    expect(p.reassurance).toMatch(/1 safe change active/);
  });

  it("ready with zero limiters → the measured-clean win sentence", () => {
    const p = postureLine(readiness([check("ready", "SSD")]), priorities(0), 0);
    expect(p.sentence).toBe("Ready to play — this rig measured clean today.");
  });

  it("attention readiness drives an attention tone", () => {
    const p = postureLine(readiness([check("attention", "Refresh")]), priorities(0), 0);
    expect(p.tone).toBe("attention");
  });
});

describe("liveStrip (real last session or honest empty)", () => {
  const session = (startedAt: string, avg: number): SessionSummary => ({
    started_at: startedAt,
    duration_secs: 600,
    process_name: "game.exe",
    samples: 600,
    avg_fps: avg,
    avg_frametime_ms: 1000 / avg,
    low1_fps_est: avg * 0.7,
    peak_gpu_temp_c: 71,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
  });

  it("is empty when no sessions exist (no fake numbers)", () => {
    expect(liveStrip([]).kind).toBe("empty");
  });

  it("picks the most recent session by start time", () => {
    const s = liveStrip([
      session("2026-06-01T10:00:00Z", 120),
      session("2026-06-05T10:00:00Z", 90),
    ]);
    expect(s.kind).toBe("data");
    if (s.kind === "data") {
      expect(s.avgFps).toBe(90);
      expect(s.peakTempC).toBe(71);
    }
  });
});
