import { useTranslation } from "react-i18next";
import type { TuningMeasurement } from "../data/tuning-measure";
import { Term } from "../design/Term";
import "../i18n";
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
  unmeasured: "tg-v-neutral",
};

export function TuningVerdictCard({ m }: { m: TuningMeasurement }) {
  const { t } = useTranslation();
  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
  return (
    <div className={`tg-verdict ${VERDICT_CLASS[m.verdict]}`}>
      <div className="tg-verdict-head">{m.headline}</div>
      <p className="tg-verdict-detail">{m.detail}</p>
      <div className="tg-verdict-stats">
        {m.baselinePeakTempC != null && m.afterPeakTempC != null && (
          <span className="tg-stat">
            {t("blackbook.tuningVerdict.peakTemp")}
            <b>{m.baselinePeakTempC}°C → {m.afterPeakTempC}°C</b>
            {m.tempDropC != null && m.tempDropC > 0 ? ` (−${m.tempDropC}°C)` : ""}
          </span>
        )}
        {m.low1DeltaPct != null && (
          <span className="tg-stat">
            <Term id="one-percent-lows">{t("blackbook.tuningVerdict.oneLow")}</Term>{" "}
            <b>{sign(m.low1DeltaPct)}%</b>
            {t("blackbook.tuningVerdict.vsBaseline")}
          </span>
        )}
        <span className="tg-stat tg-stat-muted">
          {t("blackbook.tuningVerdict.sessionsSinceTune", { count: m.sessionsSince })}
        </span>
      </div>
    </div>
  );
}
