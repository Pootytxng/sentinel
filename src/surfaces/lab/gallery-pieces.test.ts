import { describe, it, expect } from "vitest";
import { buildGalleryPieces, classifyPart, galleryHasHistory } from "./gallery-pieces";
import type {
  ScoreboardView,
  SessionSummary,
  AppliedChange,
  BlackBoxReport,
} from "../../types";

// Guard for the telemetry gallery's pure data layer (spec 2026-07-08 §3). THE LAW under test: every
// piece traces to a real measured struct; nothing is fabricated; empty in → empty out (the honest
// empty gallery). Sort is newest-first. Anchoring + glow are honest presentational derivations.

const award = (over: Partial<ScoreboardView["awards"][number]> = {}): ScoreboardView["awards"][number] => ({
  points: 10,
  rec_id: "hags-enable",
  rec_title: "Hardware-accelerated GPU scheduling",
  metric: "1% low fps",
  effect_pct: 6.2,
  ci_lo_pct: 2.1,
  ci_hi_pct: 10.3,
  at: "2026-07-05T10:00:00Z",
  ...over,
});

const session = (over: Partial<SessionSummary> = {}): SessionSummary => ({
  started_at: "2026-07-06T20:00:00Z",
  duration_secs: 1800,
  process_name: "cs2.exe",
  samples: 5000,
  avg_fps: 240.4,
  avg_frametime_ms: 4.16,
  low1_fps_est: 180,
  peak_gpu_temp_c: 68,
  peak_gpu_usage_pct: 99,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 3,
  ...over,
});

const change = (over: Partial<AppliedChange> = {}): AppliedChange => ({
  id: "c1",
  rec_id: "power-ultimate",
  rec_title: "Ultimate Performance power plan",
  applied_at: "2026-07-04T09:00:00Z",
  snapshot: null,
  status: "applied",
  is_still_active: true,
  applied_label: "Ultimate Performance",
  restores_label: "Balanced",
  payoff_label: "CPU responsiveness",
  ...over,
});

const crash: BlackBoxReport = {
  incidents: [
    {
      headline: "Display driver stopped responding",
      tag: "GPU",
      when: "2026-07-07T12:00:00Z",
      when_display: "Jul 7, 12:00",
      vitals: null,
      receipt: {
        source: "System",
        event_ids: [4101],
        faulting_app: "cs2.exe",
        faulting_module: "nvlddmkm.sys",
        code: "0x116",
        detail: "TDR",
      },
    },
  ],
  skipped_sources: [],
};

describe("buildGalleryPieces — anti-fabrication + honesty", () => {
  it("empty in → empty out (the honest empty gallery)", () => {
    expect(buildGalleryPieces({ scoreboard: null, sessions: null, changes: null, crash: null })).toEqual([]);
    expect(
      buildGalleryPieces({
        scoreboard: { total_points: 0, awards: [], local_percentiles: [] },
        sessions: [],
        changes: [],
        crash: { incidents: [], skipped_sources: [] },
      }),
    ).toEqual([]);
  });

  it("builds one piece per real measured struct, verbatim numbers", () => {
    const pieces = buildGalleryPieces({
      scoreboard: { total_points: 10, awards: [award()], local_percentiles: [null] },
      sessions: [session()],
      changes: [change()],
      crash,
    });
    expect(pieces).toHaveLength(4);
    const byKind = Object.fromEntries(pieces.map((p) => [p.kind, p]));
    expect(byKind.award.metric).toBe("+6.2% 1% low fps");
    expect(byKind.session.metric).toBe("240 fps avg · 4.2ms");
    expect(byKind.receipt.metric).toBe("Applied → Ultimate Performance");
    expect(byKind.incident.metric).toBe("GPU · cs2.exe");
  });

  it("drops zero-sample sessions and rolled-back receipts (no ghost proofs)", () => {
    const pieces = buildGalleryPieces({
      scoreboard: null,
      sessions: [session({ samples: 0, avg_fps: 0 })],
      changes: [change({ status: "rolled_back", is_still_active: false })],
      crash: null,
    });
    expect(pieces).toEqual([]);
  });

  it("anchors pieces to the right rig part + never glows an incident", () => {
    const pieces = buildGalleryPieces({
      scoreboard: { total_points: 10, awards: [award({ rec_id: "sysmain-disable", rec_title: "SysMain" })], local_percentiles: [null] },
      sessions: null,
      changes: null,
      crash,
    });
    expect(pieces.find((p) => p.kind === "award")!.part).toBe("ram");
    const inc = pieces.find((p) => p.kind === "incident")!;
    expect(inc.part).toBe("gpu"); // nvlddmkm → gpu
    expect(inc.glow).toBe(1); // records never glow
  });

  it("award glow scales with the measured effect, clamped", () => {
    const big = buildGalleryPieces({
      scoreboard: { total_points: 1, awards: [award({ effect_pct: 100 })], local_percentiles: [null] },
      sessions: null,
      changes: null,
      crash: null,
    })[0];
    expect(big.glow).toBeLessThanOrEqual(2.2);
    expect(big.glow).toBeGreaterThan(1);
  });

  it("sorts newest first; timestamp-less pieces sink", () => {
    const pieces = buildGalleryPieces({
      scoreboard: { total_points: 10, awards: [award({ at: "2026-01-01T00:00:00Z" })], local_percentiles: [null] },
      sessions: [session({ started_at: "2026-07-06T20:00:00Z" })],
      changes: null,
      crash,
    });
    // incident (Jul 7) → session (Jul 6) → award (Jan) in descending time.
    expect(pieces.map((p) => p.kind)).toEqual(["incident", "session", "award"]);
  });
});

describe("classifyPart — the 16 appliable recs land honestly", () => {
  it("maps by keyword, defaults to board", () => {
    expect(classifyPart("hags-enable")).toBe("gpu");
    expect(classifyPart("power-ultimate")).toBe("cpu");
    expect(classifyPart("sysmain-disable")).toBe("ram");
    expect(classifyPart("windows-search-disable")).toBe("storage");
    expect(classifyPart("game-mode")).toBe("board");
    expect(classifyPart("nagle-disable")).toBe("board");
  });
});

describe("galleryHasHistory — the cheap reading signal", () => {
  it("true when an active receipt or a measured session exists; false otherwise", () => {
    expect(galleryHasHistory([change()], null)).toBe(true);
    expect(galleryHasHistory(null, [session()])).toBe(true);
    expect(galleryHasHistory([change({ status: "rolled_back", is_still_active: false })], [])).toBe(false);
    expect(galleryHasHistory([], [session({ samples: 0, avg_fps: 0 })])).toBe(false);
    expect(galleryHasHistory(null, null)).toBe(false);
  });
});
