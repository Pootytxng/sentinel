import { describe, it, expect } from "vitest";
import type { SessionSummary } from "../../types";
import {
  MAX_STACK_ROWS,
  MAX_DRAW_POINTS,
  MAX_ROW_PINS,
  MIN_ZOOM_SAMPLES,
  downsampleTimeline,
  zoomWindow,
  sessionDelta,
  fmtDelta,
  fmtDeltaGlyph,
  relativeDay,
  clockLabel,
  stackRowsFrom,
  deckDeltaFrom,
  gameFilterAvailable,
} from "./monitor-stack-profile";

// Truth-tables for the v5 Flight Deck + Session Stack pure math (plan
// 2026-07-11-monitor-v5-deck-stack, T1): honest empties (empty rows, null deltas — never
// fabricated zeros), the ONE-shared-1%-low-axis rule across every row, the ≤5 row cap,
// cross-game labeling, the 1-pin-per-row worst-dip rule with its exact clock time, the
// draw-density cap, and the deck's session-scoped delta row. The surviving v4 helpers
// (downsample, zoom, delta, relative day) keep their byte-logic — their tables move here
// with the module rename.

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

describe("stackRowsFrom — honest empties + the ≤5 cap", () => {
  it("no sessions → no rows, no axis (the component renders the existing empty state)", () => {
    const m = stackRowsFrom([]);
    expect(m.rows).toEqual([]);
    expect(m.axisMax).toBeNull();
  });

  it("1 session → one row, NO delta chip (nothing to compare against)", () => {
    const m = stackRowsFrom([sess()]);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].delta).toBeNull();
    expect(m.axisMax).toBe(200);
  });

  it("8 sessions → MAX_STACK_ROWS rows, newest-first order preserved", () => {
    const many = Array.from({ length: 8 }, (_, i) => sess({ avg_fps: 100 + i }));
    const m = stackRowsFrom(many);
    expect(m.rows).toHaveLength(MAX_STACK_ROWS);
    expect(m.rows[0].session.avg_fps).toBe(100);
    expect(m.rows[4].session.avg_fps).toBe(104);
  });

  it("a stripped/absent timeline still gets a row (meta + delta are real) with no drawable points", () => {
    const m = stackRowsFrom([sess(), sess({ stutter_timeline: [] }), sess({ stutter_timeline: undefined })]);
    expect(m.rows).toHaveLength(3);
    expect(m.rows[1].points).toEqual([]);
    expect(m.rows[1].fracs).toEqual([]);
    expect(m.rows[2].points).toEqual([]);
    // The drawable row still sets the shared axis.
    expect(m.axisMax).toBe(200);
  });

  it("no drawable timeline anywhere → rows render, axisMax null (no invented axis)", () => {
    const m = stackRowsFrom([sess({ stutter_timeline: [] }), sess({ stutter_timeline: undefined })]);
    expect(m.rows).toHaveLength(2);
    expect(m.axisMax).toBeNull();
  });
});

describe("stackRowsFrom — ONE shared 1%-low axis across every row", () => {
  it("the axis max is the global max over the set; every row's y normalizes to IT", () => {
    const a = sess({ stutter_timeline: [[0, 100], [10, 120]] });
    const b = sess({ stutter_timeline: [[0, 200], [10, 240]] });
    const m = stackRowsFrom([a, b]);
    expect(m.axisMax).toBe(240);
    // Row a's best second draws at half the height of row b's best — same scale everywhere.
    expect(m.rows[0].fracs[1].y).toBeCloseTo(120 / 240);
    expect(m.rows[1].fracs[1].y).toBeCloseTo(240 / 240);
  });

  it("x normalizes to the timeline's recorded span (== duration when fully covered)", () => {
    const a = sess({ duration_secs: 100, stutter_timeline: [[0, 100], [50, 40], [100, 90]] });
    const m = stackRowsFrom([a]);
    expect(m.rows[0].fracs[1].x).toBeCloseTo(0.5);
    expect(m.rows[0].fracs[2].x).toBe(1);
    expect(m.rows[0].partial).toBe(false);
  });

  it("duration 0 (defensive) still draws over the timeline's own span", () => {
    const a = sess({ duration_secs: 0, stutter_timeline: [[0, 100], [10, 100]] });
    const m = stackRowsFrom([a]);
    expect(m.rows[0].fracs[1].x).toBe(1);
  });
});

describe("stackRowsFrom — partial timeline coverage (self-review round-1 catch, bug→guard)", () => {
  // The real defect: a 10.5-hour session whose recorded timeline stops at ~2h (the backend's
  // point cap) drew compressed into ~19% of its row — x was normalized to duration_secs, not to
  // what was actually RECORDED. The fixture-scale tests all covered 100% of duration, so this
  // passed on fixtures and broke on the owner's real Sand session (the real-density law's trap).
  const capped = sess({
    duration_secs: 37_696,
    stutter_timeline: [
      [0, 100],
      [3600, 60],
      [7229, 80],
    ],
    stutter_events: [
      { at_secs: 3600, kind: "process-start", label: "in coverage" },
      { at_secs: 30_000, kind: "process-start", label: "beyond coverage" },
    ],
  });

  it("draws over the RECORDED span — the trace fills the row, flagged partial", () => {
    const m = stackRowsFrom([capped]);
    const row = m.rows[0];
    expect(row.fracs[row.fracs.length - 1].x).toBe(1); // fills the row, never a sliver
    expect(row.partial).toBe(true);
    expect(row.coveredSecs).toBe(7229);
  });

  it("full coverage is NOT flagged partial", () => {
    expect(stackRowsFrom([sess()]).rows[0].partial).toBe(false);
    expect(stackRowsFrom([sess()]).rows[0].coveredSecs).toBe(600);
  });

  it("the worst-dip pin only anchors to events INSIDE coverage (no invented magnitudes); the true count stays", () => {
    const m = stackRowsFrom([capped]);
    expect(m.rows[0].pin!.label).toBe("in coverage");
    expect(m.rows[0].pin!.x).toBeLessThanOrEqual(1);
    expect(m.rows[0].dipCount).toBe(2);
  });

  it("undrawable rows carry no coverage claim", () => {
    const m = stackRowsFrom([sess({ stutter_timeline: [] })]);
    expect(m.rows[0].coveredSecs).toBeNull();
    expect(m.rows[0].partial).toBe(false);
  });
});

describe("stackRowsFrom — draw-density discipline (the v4 owner catch survives the rename)", () => {
  it("a 10-hour series draws ≤ MAX_DRAW_POINTS REAL samples; the worst dip survives", () => {
    const long: [number, number][] = Array.from({ length: 37_000 }, (_, i) => [
      i,
      100 + Math.sin(i / 30) * 40,
    ]);
    long[18_500] = [18_500, 3];
    const m = stackRowsFrom([sess({ duration_secs: 37_000, stutter_timeline: long })]);
    const pts = m.rows[0].points;
    expect(pts.length).toBeLessThanOrEqual(MAX_DRAW_POINTS);
    const set = new Set(long.map((p) => p.join(",")));
    for (const p of pts) expect(set.has(p.join(","))).toBe(true);
    expect(pts.some(([at, v]) => at === 18_500 && v === 3)).toBe(true);
  });
});

describe("stackRowsFrom — ONE worst-dip pin per row, exact clock time", () => {
  it("many events → exactly MAX_ROW_PINS (1) pin, at the WORST dip's own moment", () => {
    expect(MAX_ROW_PINS).toBe(1);
    const timeline: [number, number][] = Array.from({ length: 600 }, (_, i) => [i, 100]);
    timeline[100] = [100, 10]; // the worst
    timeline[300] = [300, 30];
    const events = [
      { at_secs: 300, kind: "process-start", label: "OneDrive.exe starting" },
      { at_secs: 100, kind: "process-start", label: "Defender scan starting" },
    ];
    const m = stackRowsFrom([
      sess({ duration_secs: 600, stutter_timeline: timeline, stutter_events: events }),
    ]);
    const pin = m.rows[0].pin!;
    expect(pin.x).toBeCloseTo(100 / 600);
    expect(pin.label).toBe("Defender scan starting");
    // Pin y rides the nearest MEASURED point, never an invented magnitude.
    expect(pin.y).toBeCloseTo(10 / 100);
    // The true event count stays exposed for the detail line.
    expect(m.rows[0].dipCount).toBe(2);
  });

  it("the pin carries the dip's exact clock time from started_at + at_secs", () => {
    const start = new Date(2026, 6, 9, 21, 30, 0); // local 9:30 PM
    const m = stackRowsFrom([
      sess({
        started_at: start.toISOString(),
        duration_secs: 600,
        stutter_timeline: [[0, 100], [300, 20], [600, 90]],
        stutter_events: [{ at_secs: 300, kind: "process-start", label: "spike" }],
      }),
    ]);
    const expected = new Date(2026, 6, 9, 21, 35, 0).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(m.rows[0].pin!.clock).toBe(expected);
  });

  it("no events → no pin; events without a drawable timeline → no pin (nothing to anchor to)", () => {
    expect(stackRowsFrom([sess()]).rows[0].pin).toBeNull();
    const m = stackRowsFrom([
      sess({ stutter_timeline: [], stutter_events: [{ at_secs: 10, kind: "x", label: "y" }] }),
    ]);
    expect(m.rows[0].pin).toBeNull();
  });
});

describe("stackRowsFrom — vs-PREVIOUS delta chips, cross-game labeled", () => {
  it("each row deltas against the next-older row; the oldest has none", () => {
    const m = stackRowsFrom([
      sess({ avg_fps: 247 }),
      sess({ avg_fps: 240 }),
      sess({ avg_fps: 250 }),
    ]);
    expect(m.rows[0].delta).toEqual({ avgFps: 7, sameGame: true, prevGame: "valorant.exe" });
    expect(m.rows[1].delta).toEqual({ avgFps: -10, sameGame: true, prevGame: "valorant.exe" });
    expect(m.rows[2].delta).toBeNull();
  });

  it("a different-game neighbor is flagged, never a bare number that reads as a regression", () => {
    const m = stackRowsFrom([sess({ avg_fps: 240 }), sess({ process_name: "cyberpunk2077.exe", avg_fps: 90 })]);
    expect(m.rows[0].delta!.sameGame).toBe(false);
    expect(m.rows[0].delta!.prevGame).toBe("cyberpunk2077.exe");
    expect(m.rows[0].delta!.avgFps).toBe(150);
  });

  it("NaN aggregates (defensive) → null delta value, not NaN", () => {
    const m = stackRowsFrom([sess({ avg_fps: NaN }), sess()]);
    expect(m.rows[0].delta!.avgFps).toBeNull();
  });
});

describe("stackRowsFrom — the <current game> ONLY filter", () => {
  const val1 = sess({ avg_fps: 240 });
  const val2 = sess({ avg_fps: 230 });
  const pal = sess({ process_name: "palworld.exe", avg_fps: 90 });

  it("filtering keeps only that game's rows; deltas re-anchor within the filtered set", () => {
    const m = stackRowsFrom([val1, pal, val2], "valorant.exe");
    expect(m.rows).toHaveLength(2);
    expect(m.rows.every((r) => r.session.process_name === "valorant.exe")).toBe(true);
    // val1 now deltas against val2 directly (the palworld row is out of the stack).
    expect(m.rows[0].delta).toEqual({ avgFps: 10, sameGame: true, prevGame: "valorant.exe" });
  });

  it("the shared axis recomputes over the filtered set only", () => {
    const low = sess({ stutter_timeline: [[0, 100], [10, 120]] });
    const high = sess({ process_name: "palworld.exe", stutter_timeline: [[0, 200], [10, 240]] });
    expect(stackRowsFrom([low, high]).axisMax).toBe(240);
    expect(stackRowsFrom([low, high], "valorant.exe").axisMax).toBe(120);
  });

  it("gameFilterAvailable: needs ≥2 rows, a named newest game, and ≥2 distinct games", () => {
    expect(gameFilterAvailable([val1])).toBe(false);
    expect(gameFilterAvailable([val1, val2])).toBe(false); // all one game — filter is a no-op
    expect(gameFilterAvailable([val1, pal])).toBe(true);
    expect(gameFilterAvailable([sess({ process_name: "" }), pal])).toBe(false); // anonymous newest
  });
});

describe("deckDeltaFrom — the Flight Deck's session-scoped delta row", () => {
  const val1 = sess({ avg_fps: 247, low1_fps_est: 194 });
  const val2 = sess({ avg_fps: 240, low1_fps_est: 190 });
  const pal = sess({ process_name: "palworld.exe", avg_fps: 90, low1_fps_est: 65 });

  it("no prior session → null (the row renders nothing, honest empty)", () => {
    expect(deckDeltaFrom([])).toBeNull();
    expect(deckDeltaFrom([val1])).toBeNull();
  });

  it("prefers the last SAME-GAME prior over a nearer different-game session", () => {
    const d = deckDeltaFrom([val1, pal, val2])!;
    expect(d.sameGame).toBe(true);
    expect(d.prev.avg_fps).toBe(240);
    expect(d.avgFps).toBe(7);
    expect(d.low1).toBe(4);
  });

  it("no same-game prior → the plain previous session, flagged DIFFERENT GAME", () => {
    const d = deckDeltaFrom([val1, pal])!;
    expect(d.sameGame).toBe(false);
    expect(d.prev.process_name).toBe("palworld.exe");
  });

  it("SPIKES delta counts recorded stutter events; an unrecorded side → null, never 0", () => {
    const withEvents = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ at_secs: i, kind: "x", label: `e${i}` }));
    const d = deckDeltaFrom([
      sess({ stutter_events: withEvents(2) }),
      sess({ stutter_events: withEvents(5) }),
    ])!;
    expect(d.spikes).toBe(-3);
    const noRecord = deckDeltaFrom([sess({ stutter_events: undefined }), sess()])!;
    expect(noRecord.spikes).toBeNull();
  });

  it("carries the current session's changes-on count (a recorded fact, not a claim)", () => {
    const d = deckDeltaFrom([sess({ compy_changes_active: 3 }), val2])!;
    expect(d.changesOn).toBe(3);
  });

  it("NaN aggregates (defensive) → null, not NaN", () => {
    const d = deckDeltaFrom([sess({ avg_fps: NaN }), val2])!;
    expect(d.avgFps).toBeNull();
  });
});

describe("fmtDeltaGlyph — plain-number ▲/▼, em-dash for absent", () => {
  it("signed glyphs, rounded; zero is ±0; null is em-dash", () => {
    expect(fmtDeltaGlyph(7)).toBe("▲7");
    expect(fmtDeltaGlyph(-3.4)).toBe("▼3");
    expect(fmtDeltaGlyph(0.2)).toBe("±0");
    expect(fmtDeltaGlyph(null)).toBe("—");
  });
});

// ── Surviving v4 helpers — byte-logic unchanged, tables moved with the module ─────────────

describe("downsampleTimeline — honest min-per-bucket (real samples only)", () => {
  it("caps a 37k series to MAX_DRAW_POINTS of REAL samples; the global worst dip survives", () => {
    const long: [number, number][] = Array.from({ length: 37_000 }, (_, i) => [
      i,
      100 + Math.sin(i / 30) * 40,
    ]);
    long[18_500] = [18_500, 3];
    const ds = downsampleTimeline(long);
    expect(ds.length).toBeLessThanOrEqual(MAX_DRAW_POINTS);
    const set = new Set(long.map((p) => p.join(",")));
    for (const p of ds) expect(set.has(p.join(","))).toBe(true);
    expect(ds.some(([at, v]) => at === 18_500 && v === 3)).toBe(true);
  });

  it("short series pass through untouched (same reference)", () => {
    const short: [number, number][] = [
      [0, 100],
      [1, 90],
    ];
    expect(downsampleTimeline(short)).toBe(short);
  });
});

describe("zoomWindow — the scope's drag-to-zoom (misclick guard intact)", () => {
  const buf = Array.from({ length: 100 }, (_, i) => i);

  it("null selection or short buffer → unchanged", () => {
    expect(zoomWindow(buf, null)).toBe(buf);
    const short = [1, 2, 3];
    expect(zoomWindow(short, { start: 0, end: 1 })).toBe(short);
  });

  it("slices the fraction range inclusively; inverted selections normalize", () => {
    const z = zoomWindow(buf, { start: 0.25, end: 0.5 });
    expect(z[0]).toBe(Math.floor(0.25 * 99));
    expect(z[z.length - 1]).toBe(Math.ceil(0.5 * 99));
    expect(zoomWindow(buf, { start: 0.5, end: 0.25 })).toEqual(z);
  });

  it("a micro-drag (< MIN_ZOOM_SAMPLES) is a misclick, not a zoom; clamps out-of-range", () => {
    expect(zoomWindow(buf, { start: 0.5, end: 0.51 })).toBe(buf);
    expect(zoomWindow(buf, { start: -1, end: 2 })).toEqual(buf);
    const frac = (MIN_ZOOM_SAMPLES + 3) / 100;
    const z = zoomWindow(buf, { start: 0, end: frac });
    expect(z.length).toBeGreaterThanOrEqual(MIN_ZOOM_SAMPLES);
    expect(z.length).toBeLessThan(buf.length);
  });
});

describe("sessionDelta / fmtDelta — em-dash, never a fabricated 0", () => {
  it("both sides present → real signed deltas; absent/NaN → null → em-dash", () => {
    const d = sessionDelta(sess({ avg_fps: 247, low1_fps_est: 194 }), sess());
    expect(d.avgFps).toBe(7);
    expect(d.low1).toBe(4);
    expect(fmtDelta(d.avgFps)).toBe("+7");
    expect(sessionDelta(sess(), null)).toEqual({ avgFps: null, low1: null });
    expect(sessionDelta(sess({ avg_fps: NaN }), sess()).avgFps).toBeNull();
    expect(fmtDelta(null)).toBe("—");
    expect(fmtDelta(-3.4)).toBe("-3");
    expect(fmtDelta(0.2)).toBe("±0");
  });
});

describe("relativeDay / clockLabel — plain-English recency, exact moments", () => {
  const now = new Date(2026, 6, 10, 15, 0, 0);

  it("today · yesterday · N days ago · '' (unparseable)", () => {
    expect(relativeDay(new Date(2026, 6, 10, 1, 0, 0).toISOString(), now)).toBe("today");
    expect(relativeDay(new Date(2026, 6, 9, 23, 0, 0).toISOString(), now)).toBe("yesterday");
    expect(relativeDay(new Date(2026, 6, 3, 12, 0, 0).toISOString(), now)).toBe("7 days ago");
    expect(relativeDay("not-a-date", now)).toBe("");
  });

  it("clockLabel: start + elapsed → local clock time; unparseable → '' (never invents a time)", () => {
    const start = new Date(2026, 6, 9, 21, 30, 0);
    const expected = new Date(2026, 6, 9, 21, 42, 0).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(clockLabel(start.toISOString(), 720)).toBe(expected);
    expect(clockLabel("not-a-date", 720)).toBe("");
  });
});
