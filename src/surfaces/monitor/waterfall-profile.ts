import type { SessionSummary } from "../../types";
import { spikeIndices } from "../../design/console/Oscilloscope";

// SessionWaterfall's pure profile math (plan 2026-07-10-monitor-v4-session-waterfall, T1).
// The waterfall is DATA, not decoration: every layer is a REAL measured series — the live
// per-frame window and its earlier snapshots (mode LIVE, axis ms), or the last sessions' real
// per-second stutter timelines (mode SESSIONS, axis 1%-low fps). Units NEVER mix in one scene:
// each mode's scene normalizes to ONE shared axis max so layers compare honestly. Nothing here
// fabricates a value — empty/short input ⇒ null scene, absent aggregates ⇒ null deltas (the
// component renders em-dash/NOT-YET, never 0). The v3 root lesson is structural: depth is
// presentational offset applied by the renderer BEHIND a flat front trace; this module's y
// values are plain normalized magnitudes, never warped.

export const MAX_LIVE_LAYERS = 6; // front + up to 5 receding snapshots
export const MAX_SESSION_LAYERS = 5; // the backend keeps timelines for the last 5 sessions
/** Minimum samples a drag-zoom may narrow to — below this a selection is ignored. */
export const MIN_ZOOM_SAMPLES = 8;

export const AXIS_UNIT = { live: "ms", sessions: "fps" } as const;
export type WaterfallMode = keyof typeof AXIS_UNIT;

// ── A's drag-to-segment: zoom a region of the front trace ─────────────────────────────────

/** Fractions (0..1) of the CURRENT window — order-free; the renderer commits on pointerup. */
export type ZoomSel = { start: number; end: number };

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Slice `buf` to the selected fraction range. Inverted selections normalize; selections
 *  narrower than MIN_ZOOM_SAMPLES (or on a too-short buffer) return `buf` unchanged — a
 *  micro-drag is a misclick, not a zoom. */
export function zoomWindow<T>(buf: T[], sel: ZoomSel | null): T[] {
  if (!sel || buf.length <= MIN_ZOOM_SAMPLES) return buf;
  const a = clamp01(Math.min(sel.start, sel.end));
  const b = clamp01(Math.max(sel.start, sel.end));
  const i0 = Math.floor(a * (buf.length - 1));
  const i1 = Math.ceil(b * (buf.length - 1));
  if (i1 - i0 + 1 < MIN_ZOOM_SAMPLES) return buf;
  return buf.slice(i0, i1 + 1);
}

// ── Mode LIVE: the same capture stream, receding ───────────────────────────────────────────

/** Push the current front window back as a depth snapshot (newest snapshot nearest the front).
 *  Windows too short to draw are never buffered. Returns a NEW array (state-safe). */
export function pushSnapshot(layers: number[][], win: number[], max = MAX_LIVE_LAYERS - 1): number[][] {
  if (win.length < 2) return layers;
  return [win, ...layers].slice(0, max);
}

/** How long a front window represents, ms — the honest push-back cadence (N ≈ window span),
 *  clamped to a sane 2–10 s so a near-empty or gigantic window can't stall or spam the stack. */
export function snapshotIntervalMs(win: number[]): number {
  const span = win.reduce((a, b) => a + b, 0);
  return Math.min(10_000, Math.max(2_000, span));
}

export type LayerGeom = {
  /** Normalized points, x·y ∈ [0,1]: x = position in the series, y = magnitude / scene max. */
  fracs: { x: number; y: number }[];
  /** Exact-moment pin x-fractions + their real values (spikes in LIVE, dips in SESSIONS). */
  pins: { x: number; y: number; value: number; label?: string }[];
};

export type LiveScene = {
  unit: "ms";
  /** The ONE shared axis max (ms) across front, snapshots, and the budget line. */
  scaleMax: number;
  /** Budget as a y-fraction of the shared axis, null when no refresh rate is known. */
  budgetFrac: number | null;
  front: LayerGeom;
  /** Receding snapshots, nearest first. Spike pins persist on receding layers. */
  layers: LayerGeom[];
};

function seriesGeom(win: number[], scaleMax: number, budget?: number): LayerGeom {
  const denom = Math.max(1, win.length - 1);
  const toX = (i: number) => i / denom;
  const idx = spikeIndices(win, budget);
  return {
    fracs: win.map((v, i) => ({ x: toX(i), y: clamp01(Math.max(v, 0) / scaleMax) })),
    pins: idx.map((i) => ({ x: toX(i), y: clamp01(win[i] / scaleMax), value: win[i] })),
  };
}

/** Front = the (possibly zoomed) live window; snapshots keep their own spike pins. Null when
 *  the front window can't draw (< 2 samples) — the caller renders the honest empty state. */
export function liveScene(front: number[], snapshots: number[][], budget?: number): LiveScene | null {
  if (front.length < 2) return null;
  const all = [front, ...snapshots];
  const max = Math.max(...all.flat(), budget ?? -Infinity);
  if (!(max > 0)) return null;
  return {
    unit: "ms",
    scaleMax: max,
    budgetFrac: budget != null ? clamp01(budget / max) : null,
    front: seriesGeom(front, max, budget),
    layers: snapshots.filter((s) => s.length >= 2).map((s) => seriesGeom(s, max, budget)),
  };
}

// ── Mode SESSIONS: compare your last games ─────────────────────────────────────────────────

export type SessionLayer = {
  session: SessionSummary;
  timeline: [number, number][];
  events: { at_secs: number; kind: string; label: string }[];
};

/** Sessions (newest-first, as the app passes them) → drawable layers, most recent in front.
 *  Sessions whose timeline was stripped (>5 back) or never recorded simply don't appear —
 *  the Sessions face still lists them; this scene only draws measured series. */
export function sessionLayers(sessions: SessionSummary[], max = MAX_SESSION_LAYERS): SessionLayer[] {
  return sessions
    .filter((s) => (s.stutter_timeline?.length ?? 0) >= 2)
    .slice(0, max)
    .map((s) => ({
      session: s,
      timeline: s.stutter_timeline as [number, number][],
      events: s.stutter_events ?? [],
    }));
}

export type SessionsScene = {
  unit: "fps";
  /** The ONE shared axis max (1%-low fps) across every layer. */
  scaleMax: number;
  /** Most recent in front; each x-normalized to its own elapsed time (label carries true duration). */
  layers: (LayerGeom & { layer: SessionLayer })[];
};

/** Null when nothing is drawable (0 usable layers). Dip pins ride their own layer at their
 *  exact at_secs, y at the nearest measured timeline point (never an invented magnitude). */
export function sessionsScene(layers: SessionLayer[]): SessionsScene | null {
  const usable = layers.filter((l) => l.timeline.length >= 2);
  if (usable.length === 0) return null;
  const max = Math.max(...usable.flatMap((l) => l.timeline.map(([, v]) => v)));
  if (!(max > 0)) return null;
  return {
    unit: "fps",
    scaleMax: max,
    layers: usable.map((l) => {
      const lastAt = l.timeline[l.timeline.length - 1][0];
      const span = l.session.duration_secs > 0 ? l.session.duration_secs : Math.max(lastAt, 1);
      const toX = (at: number) => clamp01(at / span);
      const yAt = (at: number) => {
        let best = l.timeline[0];
        for (const p of l.timeline) if (Math.abs(p[0] - at) < Math.abs(best[0] - at)) best = p;
        return clamp01(Math.max(best[1], 0) / max);
      };
      return {
        layer: l,
        fracs: l.timeline.map(([at, v]) => ({ x: toX(at), y: clamp01(Math.max(v, 0) / max) })),
        pins: l.events.map((e) => ({
          x: toX(e.at_secs),
          y: yAt(e.at_secs),
          value: e.at_secs,
          label: e.label,
        })),
      };
    }),
  };
}

// ── Delta strip + same-game grouping (the lean-in) ─────────────────────────────────────────

export type SessionDelta = { avgFps: number | null; low1: number | null };

/** front − prev on the two aggregates; either side absent ⇒ null (em-dash, never 0). */
export function sessionDelta(
  front: SessionSummary | null | undefined,
  prev: SessionSummary | null | undefined,
): SessionDelta {
  const d = (a: number | null | undefined, b: number | null | undefined) =>
    typeof a === "number" && Number.isFinite(a) && typeof b === "number" && Number.isFinite(b)
      ? a - b
      : null;
  return {
    avgFps: d(front?.avg_fps, prev?.avg_fps),
    low1: d(front?.low1_fps_est, prev?.low1_fps_est),
  };
}

/** Signed integer readout: +7 · -3 · ±0 · — (absent). */
export function fmtDelta(v: number | null): string {
  if (v == null) return "—";
  const r = Math.round(v);
  return r > 0 ? `+${r}` : r < 0 ? `${r}` : "±0";
}

export type ComparablePrev = { prev: SessionLayer | null; sameGame: boolean };

/** The delta strip's other side: the most recent OLDER layer of the front's OWN game when one
 *  exists (THE comparison a user wants); otherwise the plain previous layer, flagged so the
 *  strip can say "different game" instead of letting a genre gap read as a regression
 *  (self-review round-1 catch). */
export function comparablePrev(layers: SessionLayer[]): ComparablePrev {
  const front = layers[0];
  if (!front || layers.length < 2) return { prev: null, sameGame: false };
  const name = front.session.process_name;
  if (name) {
    for (let i = 1; i < layers.length; i++) {
      if (layers[i].session.process_name === name) return { prev: layers[i], sameGame: true };
    }
  }
  return { prev: layers[1], sameGame: false };
}

/** True when a same-game comparison exists: ≥2 layers share a process_name. */
export function sameGameAvailable(layers: SessionLayer[]): boolean {
  const seen = new Set<string>();
  for (const l of layers) {
    const name = l.session.process_name;
    if (!name) continue;
    if (seen.has(name)) return true;
    seen.add(name);
  }
  return false;
}

/** The "same game only" filter: keep the most recent game that actually has ≥2 layers
 *  (front's game when it qualifies). No qualifying pair ⇒ layers unchanged. */
export function filterSameGame(layers: SessionLayer[]): SessionLayer[] {
  const counts = new Map<string, number>();
  for (const l of layers) {
    const name = l.session.process_name;
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  for (const l of layers) {
    const name = l.session.process_name;
    if (name && (counts.get(name) ?? 0) >= 2) {
      return layers.filter((x) => x.session.process_name === name);
    }
  }
  return layers;
}

// ── Labels ─────────────────────────────────────────────────────────────────────────────────

/** Relative calendar-day label for a layer: today · yesterday · N days ago · "" (unparseable). */
export function relativeDay(startedAt: string, now: Date): string {
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return "";
  const day = (x: Date) => Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86_400_000);
  const diff = day(now) - day(d);
  if (diff <= 0) return "today";
  if (diff === 1) return "yesterday";
  return `${diff} days ago`;
}
