import type { SessionSummary } from "../types";
import type { TuningGuide } from "../data/tuning-guides";
import type { TuningMeasurement, TuningEvidence } from "../data/tuning-measure";
import { Walkthrough } from "../design/Walkthrough";
import { walkthroughForKey, type GpuVendor } from "./walkthroughs";
import { prettyGameName } from "./game-name";
import { TuningGuideBody } from "./TuningGuide";
import { TuningVerdictCard } from "./TuningVerdict";
import "./TuningInstrument.css";

// The Lab "Tuning" instrument body (spec 2026-06-08) — the guide (shared single source) PLUS the
// read-only Stability & thermal readout. doorknob law: this is a GAUGE, not a control — nothing here
// changes the system (you tune in Adrenalin; the arm/self-check live in the Play debrief). All numbers
// come from data the surface already holds (get_session_summaries / get_armed_comparison / the latest
// comparison) — zero new IPC. Presentational: the measurement is computed by the shared
// honest-measurement module and passed in, so this can't drift from the Play debrief's verdict.

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
  evidence,
}: {
  guide: TuningGuide;
  vendor: GpuVendor;
  measurement: TuningMeasurement | null;
  recentSessions: SessionSummary[];
  /** §A tailoring law (spec 2026-06-12): the guide is OFFERED only with measured headroom
   *  evidence from THIS rig; the why-line quotes the real signal. No evidence → the honest
   *  not-for-this-rig state below — the guide itself stays free in Learn. */
  evidence: TuningEvidence;
}) {
  const walkthrough = walkthroughForKey(guide.id);

  return (
    <div className="tg-instrument">
      {evidence.qualifies ? (
        <>
          <p className="tg-evidence">
            <span className="tg-evidence-mark">Why this rig qualifies:</span> measured here —{" "}
            {evidence.reason}.
          </p>
          <TuningGuideBody guide={guide} />
          {walkthrough && (
            <details className="tg-walkthrough">
              <summary>Show me the way</summary>
              <Walkthrough walkthrough={walkthrough} vendor={vendor} />
            </details>
          )}
        </>
      ) : (
        <p className="tg-not-for-rig">
          <span className="tg-evidence-mark">Not for this rig right now:</span> {evidence.reason}.
          Compy only suggests tuning when your own sessions show it would help — the full guide
          stays in Learn (search “undervolt”) if you're curious.
        </p>
      )}

      <div className="tg-readout">
        <div className="tg-readout-head">Stability &amp; thermal</div>

        {measurement ? (
          <TuningVerdictCard m={measurement} />
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
