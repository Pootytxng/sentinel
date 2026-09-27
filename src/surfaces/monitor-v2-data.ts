import type { TFunction } from "i18next";
import type { SessionSummary } from "../types";
import { prettyGameName } from "./game-name";
import { shortVerdict, fmtDur } from "./Play";

// Pure verdict/measured derivations for the V2 Monitor room (V2-5, spec
// 2026-07-02-v2-shell-sourcing-and-plan). Same contract as optimizeVerdict: measured facts
// only, branch-proper copy (never "(s)" — the plain-language bar).
//
// The headline grades with the SAME shortVerdict the debrief/Basic tiles use (one source), so
// the room's answer line can never disagree with the session rows below it. Sessions arrive as
// [] both while loading and when none exist — "nothing measured yet" is the honest line for
// both (Compy has measured nothing either way; there is no fabricated "loading" claim).

export type MonitorVerdictLine = { headline: string; sub?: string };

// i18n note: `t` is threaded through as the LAST param (this is a plain data module, not a
// component — it can't call useTranslation() itself) — every call site passes its own `t` from
// useTranslation(). Mirrors ago()/smoothness() elsewhere in this codebase. NOTE: shortVerdict()
// itself keeps returning the literal English "Smooth" / "Rough" / "Some dips" strings unchanged
// (Play.tsx pins that contract) — only the composed sentences below are translated.
export function monitorVerdict(sessions: SessionSummary[], t: TFunction): MonitorVerdictLine {
  const latest = sessions[0];
  if (!latest) {
    return {
      headline: t("monitor.monitorV2.verdict.noSessionsHeadline"),
      sub: t("monitor.monitorV2.verdict.noSessionsSub"),
    };
  }
  const game =
    prettyGameName(latest.process_name) || t("monitor.monitorV2.verdict.lastGameFallback");
  const fps = Math.round(latest.avg_fps);
  // An unmeasured 1% low arrives as 0 (the sampler's "unknown"), missing, or non-finite — the
  // backend only treats > 0 as known (blackbox.rs). Honest-measurement law: state only the
  // measured average and say the lows weren't measured, never "fell to 0 fps" (#602).
  const lowKnown = Number.isFinite(latest.low1_fps_est) && latest.low1_fps_est > 0;
  const low = Math.round(latest.low1_fps_est);
  const grade = shortVerdict(latest);
  // The grade names its evidence in the same breath (V2-9 punch h): shortVerdict grades on the
  // 1%-low/average ratio, so a non-smooth verdict states the lows that earned it — otherwise
  // "ran rough — 336 fps average" argues with itself. The sub's "live estimate" framing covers
  // that the lows are estimated.
  const headline = !lowKnown
    ? t("monitor.monitorV2.verdict.unmeasuredLowHeadline", { game, fps })
    : grade === "Smooth"
      ? t("monitor.monitorV2.verdict.smoothHeadline", { game, fps })
      : grade === "Some dips"
        ? t("monitor.monitorV2.verdict.someDipsHeadline", { game, low, fps })
        : t("monitor.monitorV2.verdict.roughHeadline", { game, low, fps });
  return {
    // "live estimate, not benchmark-grade" is the F3 honesty framing, kept on the room's
    // answer line so the verdict never overclaims what a 1 Hz sampler can prove.
    sub: t("monitor.monitorV2.verdict.sub", {
      duration: fmtDur(latest.duration_secs),
      samples: latest.samples.toLocaleString(),
    }),
    headline,
  };
}

// (The former measured-line header strip was retired 2026-07-10 — owner header-slop law: header
// space carries header-format text only. The session count is the visible Sessions list itself;
// the meter-cadence explainer was standing slop.)
