import type { TFunction } from "i18next";
import type { SessionSummary } from "../types";
import { prettyGameName } from "./game-name";
import { shortVerdict, fmtDur } from "./Play";
import { knownFps, mostlyUnread, sessionsReadLine, type SessionsReadState } from "../lib/session-metrics";

// Pure verdict/measured derivations for the V2 Monitor room (V2-5, spec
// 2026-07-02-v2-shell-sourcing-and-plan). Same contract as optimizeVerdict: measured facts
// only, branch-proper copy (never "(s)" — the plain-language bar).
//
// The headline grades with the SAME shortVerdict the debrief/Basic tiles use (one source), so
// the room's answer line can never disagree with the session rows below it. Sessions arrive as
// [] while loading, after a rejected read, and when none exist. This used to say "nothing
// measured yet" for all three; e3 found that untrue for the first two (sessions Compy measured
// earlier are on disk, unread, and a rejected read leaves [] until the next refresh). App now
// passes its read state, and an empty list says "not read yet" / "couldn't read" until a read
// answers; absent (read) keeps the "none measured yet" line, which is then established.

export type MonitorVerdictLine = { headline: string; sub?: string };

// i18n note: `t` is threaded through as a param, last but for e3's optional read state (this is a
// plain data module, not a component — it can't call useTranslation() itself) — every call site
// passes its own `t` from useTranslation(). Mirrors ago()/smoothness() elsewhere in this codebase. NOTE: shortVerdict()
// itself keeps returning the literal English "Smooth" / "Rough" / "Some dips" strings unchanged
// (Play.tsx pins that contract) — only the composed sentences below are translated.
export function monitorVerdict(
  sessions: SessionSummary[],
  t: TFunction,
  sessionsRead?: SessionsReadState,
): MonitorVerdictLine {
  const latest = sessions[0];
  if (!latest) {
    const unread = sessionsReadLine(sessionsRead, t);
    if (unread) return { headline: unread };
    return {
      headline: t("monitor.monitorV2.verdict.noSessionsHeadline"),
      sub: t("monitor.monitorV2.verdict.noSessionsSub"),
    };
  }
  const game =
    prettyGameName(latest.process_name) || t("monitor.monitorV2.verdict.lastGameFallback");
  // M6-unread: more than a fifth of the session went unmeasured (Compy could not read the process
  // list), so no smooth/rough sentence is said about it: it is named, ungraded, and says why.
  if (mostlyUnread(latest)) {
    return {
      headline: t("monitor.monitorV2.verdict.notGradedHeadline", { game }),
      sub: t("monitor.monitorV2.verdict.notGradedSub", { duration: fmtDur(latest.duration_secs) }),
    };
  }
  // An unmeasured average or 1% low arrives as 0 (the sampler's "unknown"), missing, or
  // non-finite (knownFps). Honest-measurement law: a headline states only what was measured and
  // says what wasn't — never "fell to 0 fps" (#602) or "averaged 0 fps" (#645). With either
  // reading unknown there is no ratio to grade, so only both-known reaches the graded wording.
  const avg = knownFps(latest.avg_fps);
  const low1 = knownFps(latest.low1_fps_est);
  let headline: string;
  if (avg === null) {
    headline =
      low1 === null
        ? t("monitor.monitorV2.verdict.unmeasuredHeadline", { game })
        : t("monitor.monitorV2.verdict.unmeasuredAverageHeadline", { game, low: Math.round(low1) });
  } else if (low1 === null) {
    headline = t("monitor.monitorV2.verdict.unmeasuredLowHeadline", { game, fps: Math.round(avg) });
  } else {
    const fps = Math.round(avg);
    const low = Math.round(low1);
    const grade = shortVerdict(latest);
    // The grade names its evidence in the same breath (V2-9 punch h): shortVerdict grades on the
    // 1%-low/average ratio, so a non-smooth verdict states the lows that earned it — otherwise
    // "ran rough — 336 fps average" argues with itself. The sub's "live estimate" framing covers
    // that the lows are estimated.
    headline =
      grade === "Smooth"
        ? t("monitor.monitorV2.verdict.smoothHeadline", { game, fps })
        : grade === "Some dips"
          ? t("monitor.monitorV2.verdict.someDipsHeadline", { game, low, fps })
          : t("monitor.monitorV2.verdict.roughHeadline", { game, low, fps });
  }
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
