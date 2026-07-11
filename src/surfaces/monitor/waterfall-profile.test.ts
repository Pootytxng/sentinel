import { describe, it, expect } from "vitest";
import type { SessionSummary } from "../../types";
import {
  AXIS_UNIT,
  MAX_LIVE_LAYERS,
  MAX_SESSION_LAYERS,
  MIN_ZOOM_SAMPLES,
  zoomWindow,
  pushSnapshot,
  snapshotIntervalMs,
  liveScene,
  sessionLayers,
  sessionsScene,
  sessionDelta,
  fmtDelta,
  sameGameAvailable,
  filterSameGame,
  relativeDay,
} from "./waterfall-profile";

// Truth-tables for the v4 waterfall's pure math (plan T1): honest empties (null scenes, null
// deltas — never fabricated zeros), the ONE-shared-axis rule per mode, stripped-timeline
// exclusion, mixed-game grouping, and the zoom's misclick guard.

function sess(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    started_at: "2026-07-09T20:00:00Z",
    duration_secs: 600,
    process_name: "valorant.exe",
    samples: 600,
    avg_fps: 240,
    avg_frametime_ms: 4.2,
    low1_fps_est: 190,
    peak_gpu_temp_c: 72,
    peak_gpu_usage_pct: 98,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    stutter_timeline: [
      [0, 180],
      [300, 200],
      [600, 190],
    ],
    stutter_events: [],
    ...over,
  } as SessionSummary;
}

describe("units never mix", () => {
  it("each mode declares exactly one axis unit", () => {
    expect(AXIS_UNIT.live).toBe("ms");
    expect(AXIS_UNIT.sessions).toBe("fps");
  });

  it("the scenes carry their mode's unit", () => {
    expect(liveScene([7, 8, 7], [])!.unit).toBe("ms");
    expect(sessionsScene(sessionLayers([sess()]))!.unit).toBe("fps");
  });
});

describe("zoomWindow — A's drag-to-segment", () => {
  const buf = Array.from({ length: 100 }, (_, i) => i);

  it("null selection or short buffer → unchanged", () => {
    expect(zoomWindow(buf, null)).toBe(buf);
    const short = [1, 2, 3];
    expect(zoomWindow(short, { start: 0, end: 1 })).toBe(short);
  });

  it("slices the fraction range inclusively", () => {
    const z = zoomWindow(buf, { start: 0.25, end: 0.5 });
    expect(z[0]).toBe(Math.floor(0.25 * 99));
    expect(z[z.length - 1]).toBe(Math.ceil(0.5 * 99));
  });

  it("inverted selection normalizes", () => {
    expect(zoomWindow(buf, { start: 0.5, end: 0.25 })).toEqual(
      zoomWindow(buf, { start: 0.25, end: 0.5 }),
    );
  });

  it("a micro-drag (< MIN_ZOOM_SAMPLES) is a misclick, not a zoom", () => {
    const z = zoomWindow(buf, { start: 0.5, end: 0.51 });
    expect(z).toBe(buf);
  });

  it("out-of-range fractions clamp", () => {
    const z = zoomWindow(buf, { start: -1, end: 2 });
    expect(z).toEqual(buf);
  });

  it("min-zoom span is still allowed", () => {
    const frac = (MIN_ZOOM_SAMPLES + 3) / 100;
    const z = zoomWindow(buf, { start: 0, end: frac });
    expect(z.length).toBeGreaterThanOrEqual(MIN_ZOOM_SAMPLES);
    expect(z.length).toBeLessThan(buf.length);
  });
});

describe("liveScene — one shared ms axis, honest null", () => {
  it("< 2 front samples → null (never a ghost trace)", () => {
    expect(liveScene([], [])).toBeNull();
    expect(liveScene([7], [[7, 8]])).toBeNull();
  });

  it("all-zero data → null (no axis can be made of nothing)", () => {
    expect(liveScene([0, 0], [])).toBeNull();
  });

  it("the axis max is shared across front, snapshots, and budget", () => {
    const s = liveScene([7, 8], [[7, 30]], 16.7)!;
    expect(s.scaleMax).toBe(30); // the snapshot's spike owns the scale
    expect(s.front.fracs[1].y).toBeCloseTo(8 / 30);
    expect(s.budgetFrac).toBeCloseTo(16.7 / 30);
  });

  it("budget above every sample still fits the axis", () => {
    const s = liveScene([4, 5], [], 16.7)!;
    expect(s.scaleMax).toBeCloseTo(16.7);
    expect(s.budgetFrac).toBeCloseTo(1);
  });

  it("no budget → budgetFrac null, spikes fall back to the median rule", () => {
    const s = liveScene([7, 7, 7, 7, 41], [])!;
    expect(s.budgetFrac).toBeNull();
    expect(s.front.pins).toHaveLength(1);
    expect(s.front.pins[0].value).toBe(41);
    expect(s.front.pins[0].x).toBe(1); // exact-moment: the last sample's own x
  });

  it("spike pins persist on receding layers", () => {
    const spiky = [7, 7, 7, 7, 41];
    const s = liveScene([7, 8, 7], [spiky], 16.7)!;
    expect(s.layers[0].pins).toHaveLength(1);
    expect(s.layers[0].pins[0].value).toBe(41);
  });

  it("a too-short snapshot is skipped, never drawn", () => {
    const s = liveScene([7, 8], [[9], [7, 9]])!;
    expect(s.layers).toHaveLength(1);
  });
});

describe("pushSnapshot / snapshotIntervalMs — the receding buffer", () => {
  it("keeps at most MAX_LIVE_LAYERS-1 snapshots, newest first", () => {
    let layers: number[][] = [];
    for (let i = 0; i < 10; i++) layers = pushSnapshot(layers, [i, i + 1]);
    expect(layers).toHaveLength(MAX_LIVE_LAYERS - 1);
    expect(layers[0][0]).toBe(9);
  });

  it("never buffers an undrawable window", () => {
    expect(pushSnapshot([], [7])).toEqual([]);
    expect(pushSnapshot([], [])).toEqual([]);
  });

  it("interval ≈ the window's real span, clamped 2–10 s", () => {
    expect(snapshotIntervalMs([1000, 1000, 1000])).toBe(3000);
    expect(snapshotIntervalMs([1, 1])).toBe(2000); // tiny span clamps up
    expect(snapshotIntervalMs(Array(100).fill(1000))).toBe(10_000); // huge span clamps down
  });
});

describe("sessionLayers — stripped exclusion + the 5 cap", () => {
  it("empty history → no layers", () => {
    expect(sessionLayers([])).toEqual([]);
  });

  it("stripped (empty) and absent timelines don't appear", () => {
    const layers = sessionLayers([
      sess(),
      sess({ stutter_timeline: [] }), // stripped >5-back
      sess({ stutter_timeline: undefined }), // pre-field payload
      sess({ stutter_timeline: [[0, 100]] }), // single point can't draw
    ]);
    expect(layers).toHaveLength(1);
  });

  it("caps at the backend's own 5-session retention, most recent in front", () => {
    const many = Array.from({ length: 8 }, (_, i) => sess({ avg_fps: 100 + i }));
    const layers = sessionLayers(many);
    expect(layers).toHaveLength(MAX_SESSION_LAYERS);
    expect(layers[0].session.avg_fps).toBe(100); // input is newest-first; order preserved
  });
});

describe("sessionsScene — one shared fps axis, dips on their own layer", () => {
  it("0 usable layers → null", () => {
    expect(sessionsScene([])).toBeNull();
    expect(sessionsScene(sessionLayers([sess({ stutter_timeline: [] })]))).toBeNull();
  });

  it("the axis max is shared across every layer (honest comparison)", () => {
    const a = sess({ stutter_timeline: [[0, 100], [10, 120]] });
    const b = sess({ stutter_timeline: [[0, 200], [10, 240]] });
    const s = sessionsScene(sessionLayers([a, b]))!;
    expect(s.scaleMax).toBe(240);
    expect(s.layers[0].fracs[1].y).toBeCloseTo(120 / 240);
  });

  it("x normalizes to the session's true duration; dip pins sit at their exact at_secs", () => {
    const a = sess({
      duration_secs: 100,
      stutter_timeline: [[0, 100], [50, 40], [100, 90]],
      stutter_events: [{ at_secs: 50, kind: "process-start", label: "OneDrive.exe starting" }],
    });
    const s = sessionsScene(sessionLayers([a]))!;
    expect(s.layers[0].pins[0].x).toBeCloseTo(0.5);
    expect(s.layers[0].pins[0].label).toBe("OneDrive.exe starting");
    // Pin y rides the nearest MEASURED point, never an invented magnitude.
    expect(s.layers[0].pins[0].y).toBeCloseTo(40 / 100);
  });

  it("duration 0 (defensive) falls back to the timeline's own span", () => {
    const a = sess({ duration_secs: 0, stutter_timeline: [[0, 100], [10, 100]] });
    const s = sessionsScene(sessionLayers([a]))!;
    expect(s.layers[0].fracs[1].x).toBe(1);
  });
});

describe("sessionDelta / fmtDelta — em-dash, never a fabricated 0", () => {
  it("both sides present → real signed deltas", () => {
    const d = sessionDelta(sess({ avg_fps: 247, low1_fps_est: 194 }), sess());
    expect(d.avgFps).toBe(7);
    expect(d.low1).toBe(4);
    expect(fmtDelta(d.avgFps)).toBe("+7");
  });

  it("either side absent → null → em-dash", () => {
    expect(sessionDelta(sess(), null)).toEqual({ avgFps: null, low1: null });
    expect(sessionDelta(null, sess())).toEqual({ avgFps: null, low1: null });
    expect(fmtDelta(null)).toBe("—");
  });

  it("NaN aggregates (defensive) → null, not NaN", () => {
    const broken = sess({ avg_fps: NaN });
    expect(sessionDelta(broken, sess()).avgFps).toBeNull();
  });

  it("negative and zero deltas format honestly", () => {
    expect(fmtDelta(-3.4)).toBe("-3");
    expect(fmtDelta(0.2)).toBe("±0");
  });
});

describe("same-game grouping — THE comparison a user wants", () => {
  const val1 = sess({ process_name: "valorant.exe", avg_fps: 240 });
  const val2 = sess({ process_name: "valorant.exe", avg_fps: 230 });
  const pal = sess({ process_name: "palworld.exe" });

  it("available only when ≥2 layers share a process_name", () => {
    expect(sameGameAvailable(sessionLayers([val1, pal]))).toBe(false);
    expect(sameGameAvailable(sessionLayers([val1, pal, val2]))).toBe(true);
  });

  it("filter keeps the most recent qualifying game only", () => {
    const layers = sessionLayers([pal, val1, val2]);
    // front (pal) has no pair → the qualifying valorant pair wins
    const filtered = filterSameGame(layers);
    expect(filtered).toHaveLength(2);
    expect(filtered.every((l) => l.session.process_name === "valorant.exe")).toBe(true);
  });

  it("no qualifying pair → unchanged; empty process names never group", () => {
    const anon1 = sess({ process_name: "" });
    const anon2 = sess({ process_name: "" });
    const layers = sessionLayers([anon1, anon2, pal]);
    expect(sameGameAvailable(layers)).toBe(false);
    expect(filterSameGame(layers)).toEqual(layers);
  });
});

describe("relativeDay — plain-English recency", () => {
  const now = new Date(2026, 6, 10, 15, 0, 0); // local 2026-07-10

  it("same local day → today; previous → yesterday; older → N days ago", () => {
    expect(relativeDay(new Date(2026, 6, 10, 1, 0, 0).toISOString(), now)).toBe("today");
    expect(relativeDay(new Date(2026, 6, 9, 23, 0, 0).toISOString(), now)).toBe("yesterday");
    expect(relativeDay(new Date(2026, 6, 3, 12, 0, 0).toISOString(), now)).toBe("7 days ago");
  });

  it("unparseable → empty string (label omits it, never invents a date)", () => {
    expect(relativeDay("not-a-date", now)).toBe("");
  });
});
