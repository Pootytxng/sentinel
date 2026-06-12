import { describe, it, expect } from "vitest";
import { signalRing, postureLine, liveStrip } from "./command-center-data";
import type { GameReadiness, Priorities, ReadinessCheck, SessionSummary } from "../types";

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

describe("signalRing (honest readiness ratio — never a score)", () => {
  it("shimmers (unknown) before readiness loads — no faked value", () => {
    const r = signalRing(null);
    expect(r.known).toBe(false);
    expect(r.ratio).toBe(0);
  });

  it("is 'Dialed' at full ratio when every check is ideal", () => {
    const r = signalRing(readiness([check("ready", "SSD"), check("ready", "Refresh")]));
    expect(r.dialed).toBe(true);
    expect(r.ratio).toBe(1);
    expect(r.label).toBe("Dialed");
    expect(r.toFix).toBe(0);
  });

  it("reports the real ideal/total and 'N to fix' when some need attention", () => {
    const r = signalRing(
      readiness([check("ready", "SSD"), check("attention", "Refresh"), check("unknown", "VRR")]),
    );
    expect(r.total).toBe(3);
    expect(r.ideal).toBe(1); // 3 - 1 attention - 1 unknown
    expect(r.toFix).toBe(2);
    expect(r.ratio).toBeCloseTo(1 / 3);
    expect(r.label).toBe("Ready");
    expect(r.sub).toBe("2 to fix");
  });

  it("counts advisory + dismissed as resolved (mirrors the backend / CommandHero)", () => {
    const r = signalRing(
      readiness([check("ready", "SSD"), check("advisory", "VRR"), check("attention", "HDR")], ["HDR"]),
    );
    expect(r.dialed).toBe(true); // advisory not counted, HDR dismissed
    expect(r.toFix).toBe(0);
  });
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
