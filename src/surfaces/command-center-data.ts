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
import { knownFps, allBackground } from "../lib/session-metrics";

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

  // dialed-in = no non-dismissed attention check. That is NOT "everything passed": checks Compy
  // couldn't read (`unknown`) and attention checks the owner dismissed also land here, so the
  // dek says only what is true: the checks Compy COULD read came back right, and it names how many
  // couldn't be read / were set aside. The "worth a look" count is the priorities limiter count.
  const limiterCount = priorities?.limiters.length ?? 0;
  const unread = Math.max(0, readiness?.unknown_count ?? 0);
  const dismissedIds = new Set(readiness?.dismissed_ids ?? []);
  const dismissedAttention = (readiness?.checks ?? []).filter(
    (c) => c.status === "attention" && dismissedIds.has(c.id),
  ).length;
  const parts: string[] = [];
  if (dismissedAttention > 0) {
    // One of the read checks came back wrong and was set aside: never "came back right".
    if (limiterCount > 0) parts.push(t("home.posture.listedWorthLook", { count: limiterCount }));
  } else if (limiterCount > 0) {
    parts.push(t("home.posture.readyWorthFixing", { count: limiterCount }));
  } else {
    parts.push(
      unread > 0 ? t("home.posture.readyAllRead") : t("home.posture.readyMeasuredClean"),
    );
  }
  if (unread > 0) parts.push(t("home.posture.unreadCount", { count: unread }));
  if (dismissedAttention > 0) {
    parts.push(t("home.posture.dismissedCount", { count: dismissedAttention }));
  }
  const sentence = parts.join(" ");
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
// A session whose FPS was not measured (the sampler's 0, a negative, a non-finite value or nothing)
// hands its reading on as null, so the face shows "no reading" rather than the raw value (#671).
export type LiveStrip =
  | { kind: "empty" }
  | {
      kind: "data";
      game: string;
      avgFps: number | null;
      low1Est: number | null;
      peakTempC: number | null;
      startedAt: string;
    };

export function liveStrip(sessions: SessionSummary[], t: TFunction): LiveStrip {
  const s = latestSession(sessions);
  if (!s) return { kind: "empty" };
  return {
    kind: "data",
    game: prettyGameName(s.process_name) || t("home.posture.lastSessionFallback"),
    avgFps: knownFps(s.avg_fps),
    low1Est: knownFps(s.low1_fps_est),
    // P4-show-f1: behind another window the whole time, the GPU peak is the game idling, not play.
    peakTempC: allBackground(s) ? null : s.peak_gpu_temp_c,
    startedAt: s.started_at,
  };
}
