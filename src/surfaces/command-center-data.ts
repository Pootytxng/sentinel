// Command Center honesty kernel (spec 2026-06-05-command-center-surface.md §0).
// Pure, unit-tested derivations so the signal ring + posture sentence can NEVER show an invented
// score. Everything here is a real count off real readiness/priorities data; the component only
// renders these. If you can't derive it honestly from the inputs, it doesn't appear.

import type { GameReadiness, Priorities, SessionSummary } from "../types";
import { deriveSystemPosture } from "./system-posture";
import { latestSession } from "./dashboard-data";

// The signal ring encodes a REAL readiness ratio: of the checks evaluated, how many are already
// ideal. Never a 0–100 "score". `ideal` mirrors the CommandHero accounting exactly — advisory and
// user-dismissed checks count as resolved (the backend already excludes dismissals from
// attention_count), so only live attention + unknown hold the ring down.
export type SignalRing = {
  ideal: number;
  total: number;
  ratio: number; // 0..1 — the fraction of the ring to fill
  dialed: boolean; // all checks ideal
  toFix: number; // total - ideal (the honest "N to fix")
  label: string; // big center text — an honest state word, never a number
  sub: string; // small real detail under it
  known: boolean; // false while scanning / nothing to judge yet → shimmer, don't fake a value
};

export function signalRing(readiness: GameReadiness | null): SignalRing {
  if (!readiness || readiness.checks.length === 0) {
    return {
      ideal: 0,
      total: 0,
      ratio: 0,
      dialed: false,
      toFix: 0,
      label: "Scanning",
      sub: "running checks…",
      known: false,
    };
  }
  const total = readiness.checks.length;
  const ideal = Math.max(0, total - readiness.attention_count - readiness.unknown_count);
  const dialed = ideal >= total;
  const toFix = total - ideal;
  return {
    ideal,
    total,
    ratio: total > 0 ? ideal / total : 0,
    dialed,
    toFix,
    label: dialed ? "Dialed" : "Ready",
    sub: dialed ? `all ${total} checks ideal` : `${toFix} to fix`,
    known: true,
  };
}

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

export function postureLine(
  readiness: GameReadiness | null,
  priorities: Priorities | null,
  activeChanges: number,
): PostureLine {
  const p = deriveSystemPosture({ readiness, activeChanges, monitoringAvailable: true });

  if (p.state === "attention") {
    return {
      headline: p.headline,
      sentence: p.sub,
      reassurance: "Nothing changes without your say-so.",
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
      ? `Ready to play — ${limiterCount} worth fixing.`
      : "Ready to play — nothing worth fixing today.";
  const changeNote =
    activeChanges > 0
      ? `${activeChanges} safe change${activeChanges === 1 ? "" : "s"} active & reversible. `
      : "";
  return {
    headline: p.headline,
    sentence,
    reassurance: `${changeNote}Nothing changes without your say-so.`,
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

export function liveStrip(sessions: SessionSummary[]): LiveStrip {
  const s = latestSession(sessions);
  if (!s) return { kind: "empty" };
  return {
    kind: "data",
    game: s.process_name || "Last session",
    avgFps: s.avg_fps,
    low1Est: s.low1_fps_est,
    peakTempC: s.peak_gpu_temp_c,
    startedAt: s.started_at,
  };
}
