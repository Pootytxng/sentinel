import type { TFunction } from "i18next";
import type { SessionSummary } from "../../types";
import { knownFps, allBackground } from "../../lib/session-metrics";

// Monitor v5 "Flight Deck + Session Stack" pure math (plan 2026-07-11-monitor-v5-deck-stack,
// T1). Everything here is flat 2D over REAL measured series — the v3→v4 chain law: no
// depth/perspective over data ink, ever again on this face. The stack normalizes every row to
// ONE shared 1%-low fps axis (a taller line is a better session anywhere in the stack); the
// deck's delta row is session-scoped plain numbers. Nothing fabricates a value: no sessions ⇒
// no rows, absent aggregates/unrecorded events ⇒ null (the components render em-dash/nothing,
// never 0). The surviving v4 helpers (downsample, zoom, delta, relative day) moved here with
// their byte-logic unchanged when SessionWaterfall was deleted.

/** The stack shows the backend's own retention window — timelines exist for the last 5 only. */
export const MAX_STACK_ROWS = 5;
/** Max drawn points per row — a 10-hour session's ~37k per-second samples drawn raw are a
 *  solid smear, not a line (owner catch, 2026-07-11). Downsampling keeps REAL samples. */
export const MAX_DRAW_POINTS = 160;
/** Pin cap per stack row — v5 deliberately shows ONE worst-dip pin (the detail line still reports
 *  the TRUE dip count). This is a DOCUMENTED INVARIANT, not a tunable knob: the pin-selection loop
 *  in `stackRowsFrom` keeps a single lowest-y pin by construction, so raising this number changes
 *  nothing — supporting N pins would need real top-N logic (rejected: the plan collapsed to 1). A
 *  test pins it at 1; if that ever needs to change, change the loop, not just the constant. */
export const MAX_ROW_PINS = 1;
/** Minimum samples a drag-zoom may narrow to — below this a selection is ignored. */
export const MIN_ZOOM_SAMPLES = 8;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Honest min-per-bucket downsampling: every kept point IS a real measured sample (the bucket's
 *  WORST 1%-low, at its own elapsed second) — dips survive, smears don't. ≤ maxPoints in ⇒
 *  unchanged. */
export function downsampleTimeline(
  timeline: [number, number][],
  maxPoints = MAX_DRAW_POINTS,
): [number, number][] {
  if (timeline.length <= maxPoints) return timeline;
  const first = timeline[0][0];
  const last = timeline[timeline.length - 1][0];
  const span = Math.max(1, last - first);
  const buckets: ([number, number] | null)[] = new Array(maxPoints).fill(null);
  for (const p of timeline) {
    const b = Math.min(maxPoints - 1, Math.floor(((p[0] - first) / span) * maxPoints));
    const cur = buckets[b];
    if (!cur || p[1] < cur[1]) buckets[b] = p;
  }
  return buckets.filter((p): p is [number, number] => p != null);
}

// ── The deck scope's drag-to-zoom (ported from the deleted waterfall's front trace) ────────

/** Fractions (0..1) of the CURRENT window — order-free; the caller commits on pointerup. */
export type ZoomSel = { start: number; end: number };

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

// ── Deltas (plain numbers, em-dash never 0) ────────────────────────────────────────────────

export type SessionDelta = { avgFps: number | null; low1: number | null };

// Both sides must be READINGS (knownFps: finite and above zero). The sampler's unknown is 0, so a
// finiteness check alone subtracted against it and printed "▼240" for a session nobody measured.
const num = (a: unknown, b: unknown) => {
  const x = knownFps(a);
  const y = knownFps(b);
  return x != null && y != null ? x - y : null;
};

/** front − prev on the two aggregates; either side unmeasured ⇒ null (em-dash, never 0). */
export function sessionDelta(
  front: SessionSummary | null | undefined,
  prev: SessionSummary | null | undefined,
): SessionDelta {
  return {
    avgFps: num(front?.avg_fps, prev?.avg_fps),
    low1: num(front?.low1_fps_est, prev?.low1_fps_est),
  };
}

/** Signed integer readout: +7 · -3 · ±0 · — (absent). */
export function fmtDelta(v: number | null): string {
  if (v == null) return "—";
  const r = Math.round(v);
  return r > 0 ? `+${r}` : r < 0 ? `${r}` : "±0";
}

/** The deck row's plain-number glyphs: ▲7 · ▼3 · ±0 · — (absent). Direction is factual (▲ =
 *  more of the thing), never a judgment color. */
export function fmtDeltaGlyph(v: number | null): string {
  if (v == null) return "—";
  const r = Math.round(v);
  return r > 0 ? `▲${r}` : r < 0 ? `▼${-r}` : "±0";
}

// ── Labels ─────────────────────────────────────────────────────────────────────────────────

/** Relative calendar-day label: today · yesterday · N days ago · "" (unparseable). `t`
 *  optional/trailing (i18n, 2026-07-23) — omitting it reproduces today's English exactly. */
export function relativeDay(startedAt: string, now: Date, t?: TFunction): string {
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return "";
  const day = (x: Date) =>
    Math.floor(new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() / 86_400_000);
  const diff = day(now) - day(d);
  if (diff <= 0) return t ? t("monitor.sessionStack.relativeDay.today", { defaultValue: "today" }) : "today";
  if (diff === 1)
    return t ? t("monitor.sessionStack.relativeDay.yesterday", { defaultValue: "yesterday" }) : "yesterday";
  return t
    ? t("monitor.sessionStack.relativeDay.daysAgo", { defaultValue: "{{n}} days ago", n: diff })
    : `${diff} days ago`;
}

/** The exact local clock time `elapsedSecs` into a session — the worst-dip pin's time label.
 *  Unparseable start ⇒ "" (the pin omits its time, never invents one). */
export function clockLabel(startedAt: string, elapsedSecs: number): string {
  const d = new Date(startedAt);
  if (Number.isNaN(d.getTime())) return "";
  return new Date(d.getTime() + elapsedSecs * 1000).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

// ── SESSION STACK — small multiples on one shared axis ─────────────────────────────────────

export type StackPin = {
  /** x/y fractions on the row's own plot (x = position in the session, y vs the SHARED axis). */
  x: number;
  y: number;
  /** The dip's exact local clock time ("" when the start stamp is unparseable). */
  clock: string;
  label: string;
};

export type StackRowDelta = { avgFps: number | null; sameGame: boolean; prevGame: string };

export type StackRow = {
  session: SessionSummary;
  /** Downsampled REAL (elapsed_secs, 1%-low fps) samples; [] when the timeline was stripped,
   *  never recorded, or too short to draw. */
  points: [number, number][];
  /** Drawing geometry: x normalized to the session's true duration, y to the SHARED axis max. */
  fracs: { x: number; y: number }[];
  /** The ONE worst-dip pin (MAX_ROW_PINS = 1); null without events or a drawable timeline. */
  pin: StackPin | null;
  /** TRUE recorded dip count for the detail line (the pin cap never hides the count). */
  dipCount: number;
  /** vs the next-older row IN THE STACK ("VS PREVIOUS"); null on the oldest row. */
  delta: StackRowDelta | null;
  /** The timeline's recorded span in seconds (its last elapsed second); null when undrawable. */
  coveredSecs: number | null;
  /** True when the recording covers materially less than the session (the backend caps timeline
   *  points, so a multi-hour session's timeline can stop hours early) — the row must SAY so, or
   *  a full-width trace claims the whole session (self-review round-1 catch, bug→guard). */
  partial: boolean;
};

export type StackModel = {
  rows: StackRow[];
  /** The ONE shared 1%-low fps axis max over every drawable row; null when nothing draws. */
  axisMax: number | null;
};

/** The last ≤MAX_STACK_ROWS sessions (newest-first, as the app passes them) → flat stack rows.
 *  `gameOnly` keeps only that game's rows — deltas and the shared axis re-anchor within the
 *  filtered set (what's on screen is what's compared). */
export function stackRowsFrom(sessions: SessionSummary[], gameOnly?: string | null): StackModel {
  let picked = sessions.slice(0, MAX_STACK_ROWS);
  if (gameOnly) picked = picked.filter((s) => s.process_name === gameOnly);

  const drawable = picked.map((s) => {
    const tl = (s.stutter_timeline ?? []) as [number, number][];
    return tl.length >= 2 ? tl : null;
  });
  const max = Math.max(...drawable.flatMap((tl) => (tl ? tl.map(([, v]) => v) : [])), -Infinity);
  const axisMax = max > 0 ? max : null;

  const rows = picked.map((s, i): StackRow => {
    const tl = drawable[i];
    const events = s.stutter_events ?? [];
    const prev = picked[i + 1] ?? null;
    const delta: StackRowDelta | null = prev
      ? {
          avgFps: num(s.avg_fps, prev.avg_fps),
          sameGame: !!s.process_name && s.process_name === prev.process_name,
          prevGame: prev.process_name,
        }
      : null;
    if (!tl || axisMax == null) {
      return {
        session: s,
        points: [],
        fracs: [],
        pin: null,
        dipCount: events.length,
        delta,
        coveredSecs: null,
        partial: false,
      };
    }
    const points = downsampleTimeline(tl);
    // Draw over the RECORDED span, not duration_secs: the backend caps timeline points, so a
    // multi-hour session's timeline can stop hours early — normalizing to duration compressed
    // the real trace into a sliver (self-review round-1 catch on the owner's 10.5 h session).
    // `partial` tells the row to STATE the coverage, so a full-width trace never overclaims.
    const lastAt = tl[tl.length - 1][0];
    const span = Math.max(lastAt, 1);
    const partial = s.duration_secs > 0 && lastAt < s.duration_secs * 0.95;
    const toX = (at: number) => clamp01(at / span);
    const yAt = (at: number) => {
      let best = points[0];
      for (const p of points) if (Math.abs(p[0] - at) < Math.abs(best[0] - at)) best = p;
      return clamp01(Math.max(best[1], 0) / axisMax);
    };
    // The ONE worst dip: the event whose nearest measured second is LOWEST — only events INSIDE
    // the recorded coverage qualify (beyond it there is no measured magnitude to anchor to).
    let pin: StackPin | null = null;
    for (const e of events) {
      if (e.at_secs > lastAt + 1) continue;
      const y = yAt(e.at_secs);
      if (!pin || y < pin.y) {
        pin = { x: toX(e.at_secs), y, clock: clockLabel(s.started_at, e.at_secs), label: e.label };
      }
    }
    return {
      session: s,
      points,
      fracs: points.map(([at, v]) => ({ x: toX(at), y: clamp01(Math.max(v, 0) / axisMax) })),
      pin,
      dipCount: events.length,
      delta,
      coveredSecs: lastAt,
      partial,
    };
  });

  return { rows, axisMax };
}

/** The ALL GAMES / <current game> ONLY chip earns its place only when it would DO something:
 *  ≥2 rows, a named newest game, and at least two distinct games in the window. */
export function gameFilterAvailable(sessions: SessionSummary[]): boolean {
  const picked = sessions.slice(0, MAX_STACK_ROWS);
  if (picked.length < 2 || !picked[0].process_name) return false;
  return picked.some((s) => s.process_name !== picked[0].process_name);
}

// ── FLIGHT DECK — the session-scoped delta row ─────────────────────────────────────────────

export type DeckDelta = {
  /** The last completed session (the row's subject). */
  current: SessionSummary;
  /** The comparison session — the last SAME-GAME prior when one exists, else the plain
   *  previous session flagged sameGame:false ("DIFFERENT GAME", the v4 self-review law). */
  prev: SessionSummary;
  sameGame: boolean;
  avgFps: number | null;
  low1: number | null;
  /** Recorded stutter-event count delta; null when either side never recorded events. */
  spikes: number | null;
  /** The current session's changes-on count — a recorded fact, not a claim; null = not recorded (#669). */
  changesOn: number | null;
};

/** Null without a prior session (the deck renders nothing — honest empty). */
export function deckDeltaFrom(all: SessionSummary[]): DeckDelta | null {
  // P4-show-f1: a session behind another window the whole time measured nothing (its empty stutter
  // list is not "no spikes"), so neither side of the delta is ever one.
  const sessions = all.filter((s) => !allBackground(s));
  const current = sessions[0];
  if (!current || sessions.length < 2) return null;
  let prev: SessionSummary | null = null;
  let sameGame = false;
  if (current.process_name) {
    for (let i = 1; i < sessions.length; i++) {
      if (sessions[i].process_name === current.process_name) {
        prev = sessions[i];
        sameGame = true;
        break;
      }
    }
  }
  if (!prev) prev = sessions[1];
  const d = sessionDelta(current, prev);
  return {
    current,
    prev,
    sameGame,
    avgFps: d.avgFps,
    low1: d.low1,
    spikes:
      current.stutter_events && prev.stutter_events
        ? current.stutter_events.length - prev.stutter_events.length
        : null,
    changesOn: current.compy_changes_active,
  };
}
