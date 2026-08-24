import { useTranslation } from "react-i18next";

import { traceGeometry } from "./geometry";
import "./FpsTrace.css";

// THE SHAPE OF A PAST SESSION (#49 deviation 3 / BACKLOG §A2).
//
// `SessionSummary.fps_series` has been persisted since the measurement spine landed — per-10s-bucket
// MEANS of the real ~1 Hz samples, real elapsed-secs x-axis, kept for the 20 most recent sessions.
// Nothing read it: `grep -r fps_series src/` returned the `types.ts` declaration and NOTHING else,
// so a past session rendered as four summary numbers and no curve at all. The four-room brief asked
// Live to show a session's SHAPE; this is the component that finally draws it.
//
// It is deliberately NOT `<Sparkline>`. That one takes `number[]` and steps x by index, which is
// exactly wrong here: `fps_series` carries a real elapsed-seconds x-axis WITH HOLES in it, and an
// index-stepped line would slide the samples after a gap leftward and paint a straight line across
// the minutes nobody watched. Both are measurements Compy never took. The honesty properties live
// in `traceGeometry` (geometry.ts) and are pinned in geometry.test.ts + FpsTrace.test.tsx.

/** viewBox units. The svg stretches to its container; `preserveAspectRatio="none"` + a
 *  non-scaling stroke keeps line weight and dot size constant at any width. */
const W = 560;
const H = 88;

/**
 * Local on purpose: a design-layer component must not import from `src/surfaces`. Matches the
 * `fmtDurCoarse` idiom (Play.tsx) — a duration that is CONTEXT, not the measurement itself.
 */
function coarse(sec: number): string {
  const h = Math.floor(sec / 3600);
  if (h > 0) return `${h}h ${Math.floor((sec % 3600) / 60)}m`;
  const m = Math.floor(sec / 60);
  return m > 0 ? `${m}m` : `${Math.max(0, Math.round(sec))}s`;
}

export function FpsTrace({
  series,
  durationSecs = 0,
  bucketSecs = 10,
}: {
  series: readonly (readonly [number, number])[] | undefined;
  durationSecs?: number;
  bucketSecs?: number;
}) {
  const { t } = useTranslation();
  const geo = traceGeometry(series ?? [], W, H, { bucketSecs, durationSecs });

  // No samples is not a flat line. A flat line at the baseline would say "we measured zero frames",
  // which is a fabricated measurement; the honest answer is that no trace is on record. Compy
  // cannot tell a session stripped past the 20-session keep window from one recorded before the
  // field existed, so the copy says what IS known and never guesses which.
  if (!geo) {
    return (
      <div className="ds-trace ds-trace-empty">
        <span className="ds-trace-eyebrow">{t("common.fpsTrace.eyebrow")}</span>
        <p className="ds-trace-none">{t("common.fpsTrace.noneTitle")}</p>
        <p className="ds-trace-hint">{t("common.fpsTrace.noneHint")}</p>
      </div>
    );
  }

  const peak = Math.round(geo.peak);
  const label = t("common.fpsTrace.aria", { peak, duration: coarse(geo.spanSecs) });

  return (
    <figure className="ds-trace">
      <figcaption className="ds-trace-head">
        <span className="ds-trace-eyebrow">{t("common.fpsTrace.eyebrow")}</span>
        <span className="ds-trace-peak">{t("common.fpsTrace.peak", { peak })}</span>
      </figcaption>

      <svg
        className="ds-trace-svg"
        width="100%"
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        {/* Half-peak reference. The eye needs one rung to read the shape against; the axis is
            anchored at 0, so "half" is a real fraction of the real peak, not a floating gridline. */}
        <line className="ds-trace-rung" x1="0" y1={H / 2} x2={W} y2={H / 2} vectorEffect="non-scaling-stroke" />
        <line className="ds-trace-base" x1="0" y1={H} x2={W} y2={H} vectorEffect="non-scaling-stroke" />
        {geo.runs.map((run, i) =>
          run.dot ? (
            // A bucket with a hole on BOTH sides is a run of one, and a polyline of one point paints
            // nothing at all. A round-capped hairline is a dot that survives the x-stretch.
            <line
              key={i}
              className="ds-trace-dot"
              x1={run.dot.x}
              y1={run.dot.y}
              x2={run.dot.x + 0.01}
              y2={run.dot.y}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ) : (
            <polyline
              key={i}
              className="ds-trace-line"
              fill="none"
              points={run.points}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ),
        )}
      </svg>

      <div className="ds-trace-axis">
        <span className="ds-trace-start">{t("common.fpsTrace.start")}</span>
        {geo.gaps > 0 && (
          <span className="ds-trace-gaps">
            {t("common.fpsTrace.gaps", { count: geo.gaps })}
          </span>
        )}
        <span className="ds-trace-tick">{coarse(geo.spanSecs)}</span>
      </div>
    </figure>
  );
}
