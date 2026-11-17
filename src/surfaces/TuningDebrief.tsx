import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary, ArmedComparison, ComparisonResult } from "../types";
import { tuningGuideForVendorForLanguage } from "../data/tuning-guides";
import { measureTuning, type PostComparability } from "../data/tuning-measure";
import { type GpuVendor } from "./walkthroughs";
import { useConfirm } from "../design/ConfirmDialog";
import { TuningVerdictCard } from "./TuningVerdict";
import { prettyGameName } from "./game-name";
import "../i18n";
import "./TuningDebrief.css";

// Play before/after for a vendor-tool tune (spec 2026-06-08). Threads into the session debrief beside
// the FPS comparison: arm a TUNING baseline ("I undervolted in Adrenalin"), then later same-game
// sessions show temp dropped + frames held + no new stutters, judged by the shared honest-measurement
// module. NO Compy apply, NO ledger entry, NO mutation — arming only records the baseline session-side.
// bathroom law: the crash self-check is asked ONCE at the debrief, never a nag.

export function TuningDebrief({
  s,
  vendor,
  sessions,
}: {
  s: SessionSummary;
  vendor: GpuVendor;
  sessions: SessionSummary[];
}) {
  const { t, i18n } = useTranslation();
  const guide = tuningGuideForVendorForLanguage(vendor, i18n.language);
  const [armed, setArmed] = useState<ArmedComparison | null>(null);
  const [comparison, setComparison] = useState<ComparisonResult | null>(null);
  const [postComparability, setPostComparability] = useState<PostComparability[] | null>(null);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  const refresh = useCallback(() => {
    invoke<ArmedComparison | null>("get_armed_comparison").then(setArmed).catch(() => {});
    // CR-tuning-comparability: which later sessions can be judged against the tune's baseline session.
    invoke<PostComparability[]>("get_tuning_comparability").then(setPostComparability).catch(() => {});
    // Only a TUNING result for THIS game feeds the verdict's confound/expiry guard — a stale fix
    // result must never flip a tuning measurement to "confounded".
    invoke<ComparisonResult | null>("get_latest_comparison")
      .then((c) => setComparison(c && c.kind === "tuning" && c.game === s.process_name ? c : null))
      .catch(() => {});
  }, [s.process_name]);
  // CR-tuning-comparability (sonnet r1): a newly recorded session re-reads the comparability list with it.
  const sessionCount = sessions.length;
  useEffect(() => {
    if (guide) refresh();
  }, [guide, refresh, sessionCount]);

  if (!guide || !s.process_name) return null;

  const tuneLabel = guide.name.split(" — ")[0]; // "Undervolt your Radeon"
  const armedForThisGame = armed?.kind === "tuning" && armed.game === s.process_name;
  const measurement = armedForThisGame ? measureTuning(armed, sessions, comparison, postComparability) : null;

  const armTune = async () => {
    // Don't silently clobber another pending comparison (a fix arm or another game's tune).
    if (armed && !(armed.kind === "tuning" && armed.game === s.process_name)) {
      const ok = await confirm({
        title: t("blackbook.tuningDebrief.confirmReplace.title"),
        body: t("blackbook.tuningDebrief.confirmReplace.body", {
          title: armed.rec_title,
          game: prettyGameName(armed.game),
        }),
        confirmLabel: t("blackbook.tuningDebrief.confirmReplace.confirmLabel"),
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await invoke("arm_tuning", {
        guideId: guide.id,
        label: tuneLabel,
        game: s.process_name,
        baselineAvgFps: s.avg_fps,
        baselineLow1Fps: s.low1_fps_est,
        baselinePeakTempC: s.peak_gpu_temp_c,
      });
      refresh();
    } catch {
      /* surfaced on next refresh */
    } finally {
      setBusy(false);
    }
  };

  const reportCrash = async () => {
    setBusy(true);
    try {
      await invoke("report_tuning_crash");
      refresh();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  const clearTune = async () => {
    setBusy(true);
    try {
      await invoke("clear_tuning");
      refresh();
    } catch {
      /* ignore */
    } finally {
      setBusy(false);
    }
  };

  // No tuning baseline armed for this game → the advisory arm affordance (doorknob: a real action that
  // records a baseline; it changes nothing on the system).
  if (!measurement) {
    return (
      <div className="td-arm">
        <div className="td-arm-text">
          <span className="td-arm-title">{t("blackbook.tuningDebrief.arm.title")}</span>
          <span className="td-arm-sub">{t("blackbook.tuningDebrief.arm.sub")}</span>
        </div>
        <button className="td-arm-btn cmp-door" disabled={busy} onClick={armTune}>
          {busy ? "…" : t("blackbook.tuningDebrief.arm.button")}
        </button>
      </div>
    );
  }

  // A baseline IS armed for this game → the time-qualified verdict + the once-asked crash self-check.
  return (
    <div className="td-measure">
      <div className="td-measure-head">
        <span className="td-measure-title">
          {t("blackbook.tuningDebrief.measure.title", {
            label: tuneLabel,
            game: prettyGameName(s.process_name),
          })}
        </span>
        <button className="td-clear cmp-door" disabled={busy} onClick={clearTune}>
          {t("blackbook.tuningDebrief.measure.reset")}
        </button>
      </div>
      <TuningVerdictCard m={measurement} />
      {!measurement.crashReported && (
        <div className="td-crash">
          <span className="td-crash-q">{t("blackbook.tuningDebrief.crash.question")}</span>
          <button className="td-crash-btn cmp-door" disabled={busy} onClick={reportCrash}>
            {t("blackbook.tuningDebrief.crash.button")}
          </button>
        </div>
      )}
    </div>
  );
}
