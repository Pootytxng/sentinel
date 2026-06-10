import type { TuningMeasurement } from "../data/tuning-measure";
import "./TuningVerdict.css";

// The honest-measurement verdict card — ONE shared presentational block rendered identically in the
// Lab Tuning instrument and the Play debrief (its copy comes from the shared measurement module, so it
// can't drift). Color carries the meaning; the headline is ALWAYS time-and-sample-qualified — never a
// bare green "stable" (honest-measurement law).

const VERDICT_CLASS: Record<TuningMeasurement["verdict"], string> = {
  holding: "tg-v-holding",
  "too-aggressive": "tg-v-bad",
  "too-early": "tg-v-early",
  "no-change": "tg-v-neutral",
  confounded: "tg-v-neutral",
};

export function TuningVerdictCard({ m }: { m: TuningMeasurement }) {
  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  return (
    <div className={`tg-verdict ${VERDICT_CLASS[m.verdict]}`}>
      <div className="tg-verdict-head">{m.headline}</div>
      <p className="tg-verdict-detail">{m.detail}</p>
      <div className="tg-verdict-stats">
        {m.baselinePeakTempC != null && m.afterPeakTempC != null && (
          <span className="tg-stat">
            Peak temp <b>{m.baselinePeakTempC}°C → {m.afterPeakTempC}°C</b>
            {m.tempDropC != null && m.tempDropC > 0 ? ` (−${m.tempDropC}°C)` : ""}
          </span>
        )}
        {m.low1DeltaPct != null && (
          <span className="tg-stat">
            1% low <b>{sign(m.low1DeltaPct)}%</b> vs baseline
          </span>
        )}
        <span className="tg-stat tg-stat-muted">
          {m.sessionsSince} session{m.sessionsSince === 1 ? "" : "s"} since the tune
        </span>
      </div>
    </div>
  );
}
