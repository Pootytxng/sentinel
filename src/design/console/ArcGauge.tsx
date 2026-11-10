import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { gsap } from "gsap";
import { useReducedMotion } from "../use-motion";
import { useJarvisActive } from "../jarvis/use-jarvis";
import { useCountTo } from "../../surfaces/lab/use-count-to";
// Side-effect import: guarantees the i18next instance is initialized before this file's t() calls run.
import "../../i18n";
import "./arc-gauge.css";

export type ArcTone = "accent" | "warn" | "good" | "neutral";
const R = 20;
const CIRC = 2 * Math.PI * R;
const TICKS = Array.from({ length: 24 }, (_, i) => {
  const a = (i / 24) * 2 * Math.PI - Math.PI / 2;
  return { x1: 28 + Math.cos(a) * 25, y1: 28 + Math.sin(a) * 25, x2: 28 + Math.cos(a) * 27.5, y2: 28 + Math.sin(a) * 27.5 };
});

/** The ring holds a unit only up to this many Latin-width cells (°C, %, fps, ms). */
const RING_UNIT_MAX_WIDTH = 3;
/** CJK, kana, hangul and fullwidth forms render about twice as wide as a Latin letter. */
const WIDE_CHAR = /[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA960-\uA97F\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/u;
/** Width of a unit in Latin-letter cells: a wide (CJK) character counts as two. */
export function unitVisualWidth(unit: string): number {
  let w = 0;
  for (const ch of unit) w += WIDE_CHAR.test(ch) ? 2 : 1;
  return w;
}

export function ArcGauge({
  label, value, max, unit, tone = "neutral", measured = true, note, grade, gradeTone = "good",
  variant = "ring",
}: {
  /** ReactNode so callers can gloss jargon labels inline (e.g. a <Term> tooltip on "1% low"). */
  label: ReactNode; value: number | null; max: number; unit: string; tone?: ArcTone; measured?: boolean;
  /** One quiet "how we calculate this" line under the label — shown only with a live value. */
  note?: string;
  /**
   * ONE WORD SAYING WHETHER THE NUMBER IS ANY GOOD — 01-health-approved.png prints GOOD in
   * green where every other gauge prints MEASURED, and the owner ruled the comps exact
   * (2026-08-23). It REPLACES the MEASURED pill rather than joining it, which is the whole
   * point: a reader told the score is 94 and then told it was MEASURED has been told
   * nothing they can act on. The CALLER owns the banding and must state its thresholds
   * where it computes them — a grade is an interpretation OF a measurement, so it may only
   * ever be derived from one, and it never renders in the empty state (see `empty`).
   */
  grade?: string;
  /** Which end of the ladder the grade sits on: green good, amber wants-a-look, red bad. */
  gradeTone?: "good" | "warn" | "bad";
  /**
   * HOW THE READING IS DRAWN — and only that. `ring` (the default, so every existing caller is
   * byte-identical) draws the ticked arc with the number inside it. `numeral` drops the arc and
   * prints the number large and bare.
   *
   * It exists because a ring is a claim: it says "this reading sits somewhere on a scale you can
   * see". That is true of a readiness score or an applied-count out of a known total, and it is
   * NOT true of a raw magnitude like a frame rate or a noise floor, where any `max` the caller
   * picks is an invented ceiling. The approved Test composition (2026-08-26) makes exactly that
   * distinction — two arcs, two bare numerals — so this is the honesty of the drawing, not a
   * decoration switch. Every state below (NOT YET, NO READING, the tag, the note) is identical
   * in both variants; only the arc goes.
   */
  variant?: "ring" | "numeral";
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const shown = useCountTo(value, { reduced });     // null → null (honesty rail); reduced → snaps
  const empty = shown === null;
  const frac = empty ? 0 : Math.min(1, Math.max(0, shown / max));
  const dashoffset = CIRC * (1 - frac);
  // CR-zh-dial (desk review 2026-11-04): "已启用" is 3 characters but ~43px at the 13px floor, so a
  // character count let it into the ring and it hit the stroke. Measure in Latin-width cells.
  const unitInRing = unit.length > 0 && unitVisualWidth(unit) <= RING_UNIT_MAX_WIDTH;

  // §A.2 data-tick (JARVIS layer, flag+motion gated) — the ring flashes ONLY when a REAL reading
  // CHANGES to a different real reading. Honesty contract: arrival (null→value) is the count-up's
  // moment, loss (value→null) is NOT-YET, and no data ⇒ no tick node ever renders — motion can
  // never imply a measurement that didn't happen. Inactive, the DOM is byte-identical.
  const jarvis = useJarvisActive();
  const [tick, setTick] = useState(0);
  const tickRef = useRef<SVGCircleElement>(null);
  const prevValueRef = useRef<number | null>(value);
  useEffect(() => {
    const prev = prevValueRef.current;
    prevValueRef.current = value;
    if (!jarvis) return;
    if (prev == null || value == null || value === prev) return;
    setTick((t) => t + 1);
  }, [value, jarvis]);
  useLayoutEffect(() => {
    if (tick === 0) return;
    const el = tickRef.current;
    if (!el) return;
    const tween = gsap.fromTo(
      el,
      { attr: { r: R }, opacity: 0.9 },
      { attr: { r: R + 5 }, opacity: 0, duration: 0.55, ease: "expo.out", overwrite: "auto" },
    );
    return () => {
      tween.kill();
    };
  }, [tick]);

  return (
    <div className={`arc-gauge ag-${tone} ag-as-${variant} ${empty ? "ag-empty" : ""}`}>
      {variant === "ring" && (
      <svg viewBox="0 0 56 56" aria-hidden="true">
        {TICKS.map((t, i) => <line key={i} className="ag-tick" x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} />)}
        <circle className="ag-track" cx="28" cy="28" r={R} />
        {!empty && (
          <circle className="ag-fill" cx="28" cy="28" r={R} transform="rotate(-90 28 28)"
            strokeDasharray={CIRC} strokeDashoffset={dashoffset} />
        )}
        {jarvis && tick > 0 && !empty && (
          <circle ref={tickRef} className="jv-gauge-tick" cx="28" cy="28" r={R} opacity={0} />
        )}
      </svg>
      )}
      <div className="ag-ctr">
        <div className="ag-v">{empty ? "— —" : Math.round(shown!)}</div>
        {/* TYPE-1 look-caught defect (v0.9.19 review, 2026-08-13): at the 13px floor a long unit
            word ("score", "frames", "ready") or the empty-state sentence overflows the 56px ring —
            the old 8px fit was fine print, the exact disease TYPE-1 cures. The ring only ever
            carries a SHORT unit (°C, %, fps, ms); anything longer moves BESIDE the label, never
            below the floor. Guarded in arc-gauge.test.tsx. */}
        {!empty && unitInRing && <div className="ag-u">{unit}</div>}
      </div>
      <div className="ag-label">
        <span>{label}</span>
        {/* An EMPTY unit is a caller saying "this number needs no unit" (Test's INSTRUMENTS READ,
            whose label already ends in the word). It must render nothing at all -- not an empty
            node in the ring, and not a blank line beside the label. */}
        {(empty || (unit.length > 0 && !unitInRing)) && (
          <span className="ag-u ag-u-side">{empty ? t("common.arcGauge.noReading") : unit}</span>
        )}
        {empty ? <span className="ag-tag ag-tag-ny">{t("common.arcGauge.notYet")}</span>
               : grade ? <span className={`ag-grade ag-grade-${gradeTone}`}>{grade}</span>
               : measured ? <span className="ag-tag">{t("common.arcGauge.measured")}</span> : null}
        {note && !empty && <span className="ag-note">{note}</span>}
      </div>
    </div>
  );
}
export default ArcGauge;
