// Command Center honesty kernel (spec 2026-06-05-command-center-surface.md §0).
// Pure, unit-tested derivations so the signal ring + posture sentence can NEVER show an invented
// score. Everything here is a real count off real readiness/priorities data; the component only
// renders these. If you can't derive it honestly from the inputs, it doesn't appear.

import type { TFunction } from "i18next";
import type { GameReadiness, Priorities, SessionSummary } from "../types";
import type { InEffectCounts } from "../data/machine-model";
import { deriveSystemPosture } from "./system-posture";
import { latestSession } from "./dashboard-data";
import { prettyGameName } from "./game-name";

// (The former `signalRing`/`SignalRing` ratio widget was retired 2026-07-14 — orphaned after Home
// stopped rendering the ring. It read raw attention_count/unknown_count instead of the dismissed-aware
// deriveSystemPosture, so leaving it live risked re-introducing the dismissed-counts-as-attention
// regression the moment it was wired back in. Any future ring must route through deriveSystemPosture.)

// The posture sentence beside the ring. Headline + tone come from the shared posture derivation
// (readiness-driven); the "worth fixing" count comes from priorities (advisory limiters), per spec
// §2/§6. Both are real — no synthesized metric.
export type PostureTone = "ready" | "attention" | "scanning";
export type PostureLine = {
  headline: string;
  sentence: string;
  reassurance: string;
  tone: PostureTone;
};

// i18n note: `t` is threaded through as the LAST param (this is a plain data module, not a
// component — it can't call useTranslation() itself) — every call site passes its own `t` from
// useTranslation(). Mirrors ago()/smoothness() elsewhere in this codebase.
//
// `inEffect` is the Machine Model's own answer (#452), never a count a face works out from the bare
// ledger list: that list reads as EMPTY when the ledger can't be read, so a bare number here could
// not tell "nothing is active" from "Compy can't read its record". Only `activeNow` is in effect;
// rows whose live check failed (`unknown`) are never added to it.
export function postureLine(
  readiness: GameReadiness | null,
  priorities: Priorities | null,
  inEffect: InEffectCounts,
  t: TFunction,
): PostureLine {
  const activeChanges = inEffect.kind === "counted" ? inEffect.activeNow : 0;
  const p = deriveSystemPosture({ readiness, activeChanges, monitoringAvailable: true }, t);

  if (p.state === "attention") {
    return {
      headline: p.headline,
      sentence: p.sub,
      reassurance: t("home.posture.noChangeWithoutSayso"),
      tone: "attention",
    };
  }
  if (p.state === "scanning" || p.state === "unknown") {
    return { headline: p.headline, sentence: p.sub, reassurance: "", tone: "scanning" };
  }

  // dialed-in: all readiness checks pass. The "worth fixing" count is the advisory limiter count.
  const limiterCount = priorities?.limiters.length ?? 0;
  const sentence =
    limiterCount > 0
      ? t("home.posture.readyWorthFixing", { count: limiterCount })
      : t("home.posture.readyMeasuredClean");
  // Unreadable is a word, not a silence: the reassurance beside it would otherwise read as "Compy
  // changed nothing". Pending (the model not read yet) says nothing — a stand-in is a claim.
  const changeNote =
    inEffect.kind === "unreadable"
      ? t("home.posture.changeNoteUnknown")
      : activeChanges > 0
        ? t("home.posture.changeNoteReversible", { count: activeChanges })
        : "";
  return {
    headline: p.headline,
    sentence,
    reassurance: `${changeNote}${t("home.posture.noChangeWithoutSayso")}`,
    tone: "ready",
  };
}

// The "last session" live strip. Honest empty state when no sessions exist — never fake numbers.
export type LiveStrip =
  | { kind: "empty" }
  | {
      kind: "data";
      game: string;
      avgFps: number;
      low1Est: number;
      peakTempC: number | null;
      startedAt: string;
    };

export function liveStrip(sessions: SessionSummary[], t: TFunction): LiveStrip {
  const s = latestSession(sessions);
  if (!s) return { kind: "empty" };
  return {
    kind: "data",
    game: prettyGameName(s.process_name) || t("home.posture.lastSessionFallback"),
    avgFps: s.avg_fps,
    low1Est: s.low1_fps_est,
    peakTempC: s.peak_gpu_temp_c,
    startedAt: s.started_at,
  };
}
