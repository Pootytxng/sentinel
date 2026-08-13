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

export function ArcGauge({
  label, value, max, unit, tone = "neutral", measured = true, note,
}: {
  /** ReactNode so callers can gloss jargon labels inline (e.g. a <Term> tooltip on "1% low"). */
  label: ReactNode; value: number | null; max: number; unit: string; tone?: ArcTone; measured?: boolean;
  /** One quiet "how we calculate this" line under the label — shown only with a live value. */
  note?: string;
}) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const shown = useCountTo(value, { reduced });     // null → null (honesty rail); reduced → snaps
  const empty = shown === null;
  const frac = empty ? 0 : Math.min(1, Math.max(0, shown / max));
  const dashoffset = CIRC * (1 - frac);

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
    <div className={`arc-gauge ag-${tone} ${empty ? "ag-empty" : ""}`}>
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
      <div className="ag-ctr">
        <div className="ag-v">{empty ? "— —" : Math.round(shown!)}</div>
        {/* TYPE-1 look-caught defect (v0.9.19 review, 2026-08-13): at the 13px floor a long unit
            word ("score", "frames", "ready") or the empty-state sentence overflows the 56px ring —
            the old 8px fit was fine print, the exact disease TYPE-1 cures. The ring only ever
            carries a SHORT unit (°C, %, fps, ms); anything longer moves BESIDE the label, never
            below the floor. Guarded in arc-gauge.test.tsx. */}
        {!empty && unit.length <= 3 && <div className="ag-u">{unit}</div>}
      </div>
      <div className="ag-label">
        <span>{label}</span>
        {(empty || unit.length > 3) && (
          <span className="ag-u ag-u-side">{empty ? t("common.arcGauge.noReading") : unit}</span>
        )}
        {empty ? <span className="ag-tag ag-tag-ny">{t("common.arcGauge.notYet")}</span>
               : measured ? <span className="ag-tag">{t("common.arcGauge.measured")}</span> : null}
        {note && !empty && <span className="ag-note">{note}</span>}
      </div>
    </div>
  );
}
export default ArcGauge;
