import type { SessionSummary } from "../types";
import type { TuningGuide } from "../data/tuning-guides";
import type { TuningMeasurement } from "../data/tuning-measure";
import { Walkthrough } from "../design/Walkthrough";
import { walkthroughForKey, type GpuVendor } from "./walkthroughs";
import { prettyGameName } from "./game-name";
import { TuningGuideBody } from "./TuningGuide";
import "./TuningInstrument.css";

// The Lab "Tuning" instrument body (spec 2026-06-08) — the guide (shared single source) PLUS the
// read-only Stability & thermal readout. doorknob law: this is a GAUGE, not a control — nothing here
// changes the system (you tune in Adrenalin; the arm/self-check live in the Play debrief). All numbers
// come from data the surface already holds (get_session_summaries / get_armed_comparison / the latest
// comparison) — zero new IPC. Presentational: the measurement is computed by the shared
// honest-measurement module and passed in, so this can't drift from the Play debrief's verdict.

const VERDICT_CLASS: Record<TuningMeasurement["verdict"], string> = {
  holding: "tg-v-holding",
  "too-aggressive": "tg-v-bad",
  "too-early": "tg-v-early",
  "no-change": "tg-v-neutral",
  confounded: "tg-v-neutral",
};

function smoothness(s: SessionSummary): string {
  const ratio = s.avg_fps > 0 ? s.low1_fps_est / s.avg_fps : 1;
  if (ratio >= 0.75) return "smooth";
  if (ratio >= 0.55) return "some dips";
  return "rough";
}

export function TuningInstrument({
  guide,
  vendor,
  measurement,
  recentSessions,
}: {
  guide: TuningGuide;
  vendor: GpuVendor;
  measurement: TuningMeasurement | null;
  recentSessions: SessionSummary[];
}) {
  const walkthrough = walkthroughForKey(guide.id);
  const sign = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

  return (
    <div className="tg-instrument">
      <TuningGuideBody guide={guide} />
      {walkthrough && (
        <details className="tg-walkthrough">
          <summary>Show me the way</summary>
          <Walkthrough walkthrough={walkthrough} vendor={vendor} />
        </details>
      )}

      <div className="tg-readout">
        <div className="tg-readout-head">Stability &amp; thermal</div>

        {measurement ? (
          <div className={`tg-verdict ${VERDICT_CLASS[measurement.verdict]}`}>
            <div className="tg-verdict-head">{measurement.headline}</div>
            <p className="tg-verdict-detail">{measurement.detail}</p>
            <div className="tg-verdict-stats">
              {measurement.baselinePeakTempC != null && measurement.afterPeakTempC != null && (
                <span className="tg-stat">
                  Peak temp <b>{measurement.baselinePeakTempC}°C → {measurement.afterPeakTempC}°C</b>
                  {measurement.tempDropC != null && measurement.tempDropC > 0
                    ? ` (−${measurement.tempDropC}°C)`
                    : ""}
                </span>
              )}
              {measurement.low1DeltaPct != null && (
                <span className="tg-stat">
                  1% low <b>{sign(measurement.low1DeltaPct)}%</b> vs baseline
                </span>
              )}
              <span className="tg-stat tg-stat-muted">
                {measurement.sessionsSince} session{measurement.sessionsSince === 1 ? "" : "s"} since the
                tune
              </span>
            </div>
          </div>
        ) : (
          <p className="tg-readout-empty">
            No tune measured yet. Undervolt in Adrenalin, then arm a baseline from a Play debrief —
            Compy measures whether temps dropped and frames held, judged over time.
          </p>
        )}

        {recentSessions.length > 0 && (
          <div className="tg-recent">
            <div className="tg-recent-label">Recent sessions — peak temp &amp; consistency</div>
            <ul className="tg-recent-list">
              {recentSessions.map((s, i) => (
                <li key={`${s.started_at}-${i}`} className="tg-recent-row">
                  <span className="tg-recent-game">{prettyGameName(s.process_name) || "Unknown"}</span>
                  <span className="tg-recent-temp">
                    {s.peak_gpu_temp_c == null ? "— °C" : `${s.peak_gpu_temp_c}°C`}
                  </span>
                  <span className="tg-recent-smooth">{smoothness(s)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="tg-readout-foot">
          A gauge, not a control — Compy never touches your voltage. ETW + GPU sensors, external · no
          injection.
        </p>
      </div>
    </div>
  );
}
