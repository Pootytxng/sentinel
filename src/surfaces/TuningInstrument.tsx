import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { SessionSummary } from "../types";
import type { TuningGuide } from "../data/tuning-guides";
import type { TuningMeasurement, TuningEvidence } from "../data/tuning-measure";
import { Term } from "../design/Term";
import { WalkthroughDisclosure } from "../design/WalkthroughDisclosure";
import { walkthroughForKeyForLanguage, type GpuVendor } from "./walkthroughs";
import { prettyGameName } from "./game-name";
import { knownFps } from "../lib/session-metrics";
import { TuningGuideBody } from "./TuningGuide";
import { TuningVerdictCard } from "./TuningVerdict";
import "../i18n";
import "./TuningInstrument.css";

// The Lab "Tuning" instrument body (spec 2026-06-08) — the guide (shared single source) PLUS the
// read-only Stability & thermal readout. doorknob law: this is a GAUGE, not a control — nothing here
// changes the system (you tune in Adrenalin; the arm/self-check live in the Play debrief). All numbers
// come from data the surface already holds (get_session_summaries / get_armed_comparison / the latest
// comparison) — zero new IPC. Presentational: the measurement is computed by the shared
// honest-measurement module and passed in, so this can't drift from the Play debrief's verdict.

function smoothness(s: SessionSummary, t: TFunction): string {
  // A grade needs both readings (#671): an unmeasured average used to grade "smooth" and an
  // unmeasured 1% low "rough", each a verdict about a frame rate nobody measured.
  const avg = knownFps(s.avg_fps);
  const low = knownFps(s.low1_fps_est);
  if (avg == null || low == null) return t("blackbook.tuningInstrument.smoothness.notMeasured");
  const ratio = low / avg;
  if (ratio >= 0.75) return t("blackbook.tuningInstrument.smoothness.smooth");
  if (ratio >= 0.55) return t("blackbook.tuningInstrument.smoothness.someDips");
  return t("blackbook.tuningInstrument.smoothness.rough");
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
  const { t, i18n } = useTranslation();
  const walkthrough = walkthroughForKeyForLanguage(guide.id, i18n.language);

  return (
    <div className="tg-instrument">
      {evidence.qualifies ? (
        <>
          <p className="tg-evidence">
            <span className="tg-evidence-mark">{t("blackbook.tuningInstrument.qualifiesMark")}</span>
            {t("blackbook.tuningInstrument.qualifiesConnector")}
            {evidence.reason}.
          </p>
          {/* CR-tuning-gpu-other-card: sessions that can't be tied to the card in this PC now say so. */}
          {evidence.untied && (
            <p className="tg-evidence" data-testid="tg-evidence-untied">
              {evidence.untied.kind === "not-recorded"
                ? t("blackbook.tuningInstrument.untiedNotRecorded", { count: evidence.untied.count })
                : t("blackbook.tuningInstrument.untiedCardUnread")}
            </p>
          )}
          <TuningGuideBody guide={guide} />
          {walkthrough && (
            // Mounted only when opened (codebase review 2026-11-02): inside a closed <details> it ran its
            // carousel and counted a walkthrough "opened" for every card anyone expanded.
            <WalkthroughDisclosure className="tg-walkthrough" label={t("blackbook.tuningInstrument.showMeTheWay")} walkthrough={walkthrough} vendor={vendor} />
          )}
        </>
      ) : (
        <p className="tg-not-for-rig">
          <span className="tg-evidence-mark">{t("blackbook.tuningInstrument.notForRigMark")}</span>{" "}
          {evidence.reason}
          {t("blackbook.tuningInstrument.notForRigRest")}
        </p>
      )}

      <div className="tg-readout">
        <div className="tg-readout-head">{t("blackbook.tuningInstrument.readoutHead")}</div>

        {measurement ? (
          <TuningVerdictCard m={measurement} />
        ) : (
          <p className="tg-readout-empty">{t("blackbook.tuningInstrument.readoutEmpty")}</p>
        )}

        {recentSessions.length > 0 && (
          <div className="tg-recent">
            <div className="tg-recent-label">{t("blackbook.tuningInstrument.recentLabel")}</div>
            <ul className="tg-recent-list">
              {recentSessions.map((s, i) => (
                <li key={`${s.started_at}-${i}`} className="tg-recent-row">
                  <span className="tg-recent-game">
                    {prettyGameName(s.process_name) || t("blackbook.tuningInstrument.unknownGame")}
                  </span>
                  <span className="tg-recent-temp">
                    {s.peak_gpu_temp_c == null ? "— °C" : `${s.peak_gpu_temp_c}°C`}
                  </span>
                  <span className="tg-recent-smooth">{smoothness(s, t)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="tg-readout-foot">
          {t("blackbook.tuningInstrument.gaugeFoot")}
          <Term id="etw">ETW</Term>
          {t("blackbook.tuningInstrument.gaugeFootSuffix")}
        </p>
      </div>
    </div>
  );
}
