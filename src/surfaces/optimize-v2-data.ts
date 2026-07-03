import type { GameReadiness, Recommendation } from "../types";

// Pure verdict/measured derivations for the V2 Optimize room (V2-4, spec
// 2026-07-02-v2-shell-sourcing-and-plan). Same contract as postureLine for Home: measured
// facts only, honestly-loading state while the catalog hasn't resolved, copy branches
// properly (never "(s)" — the plain-language bar).
//
// "Ready" here means what the room's headline promises: a SAFE-tier, one-click-appliable,
// eligible rec that isn't currently applied. Guided/judgment-call tweaks live in the body —
// the headline never counts what a click can't do.

export type OptimizeVerdictLine = {
  settled: boolean; // false while the catalog is still loading (no animation on a placeholder)
  headline: string;
  sub?: string;
};

export function safeFixesReady(
  recs: Recommendation[],
  isAppliable: (recId: string) => boolean,
): number {
  return recs.filter(
    (r) =>
      r.severity === "safe" &&
      isAppliable(r.id) &&
      !r.currently_applied &&
      r.eligible !== false,
  ).length;
}

export function optimizeVerdict(
  recs: Recommendation[] | null,
  isAppliable: (recId: string) => boolean,
  activeCount: number,
): OptimizeVerdictLine {
  if (recs == null) {
    return { settled: false, headline: "Checking what's safe to change…" };
  }
  const ready = safeFixesReady(recs, isAppliable);
  // The undo promise is the rollback-first law stated plainly — and it names where undo lives.
  const undoSub = "Every apply captures its undo first — roll anything back from Applied.";
  if (ready === 1) return { settled: true, headline: "1 safe fix is ready to apply.", sub: undoSub };
  if (ready > 1)
    return { settled: true, headline: `${ready} safe fixes are ready to apply.`, sub: undoSub };
  if (activeCount === 1)
    return {
      settled: true,
      headline: "Nothing new to apply — 1 safe change is active.",
      sub: undoSub,
    };
  if (activeCount > 1)
    return {
      settled: true,
      headline: `Nothing new to apply — ${activeCount} safe changes are active.`,
      sub: undoSub,
    };
  return {
    settled: true,
    headline: "Nothing needs applying right now.",
    sub: "Compy only recommends what it measured on this rig — nothing invented.",
  };
}

// The provenance line under the verdict: real check counts + the real evaluated-catalog size.
// Nothing measured yet → says so; never a fabricated count.
export function optimizeMeasuredLine(
  readiness: GameReadiness | null,
  recs: Recommendation[] | null,
): string {
  if (readiness == null || recs == null) return "running checks…";
  const measured = readiness.checks.length - readiness.unknown_count;
  return `${measured}/${readiness.checks.length} checks measured · ${recs.length} vetted tweaks evaluated`;
}
