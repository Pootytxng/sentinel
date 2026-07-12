import type { Recommendation, AppliedChange } from "../types";

// Trust-moment demo pick (consumer-panel Phase 2, plan 2026-07-11): the one-time "watch it work"
// loop needs a setting that is trivially safe to apply AND roll back in front of a brand-new user.
// Whitelist = HKCU-only applies (verified in actions.rs — no elevation, so no UAC prompt mid-demo,
// which would read as the opposite of trust). Order is preference order.
export const TRUST_DEMO_IDS = [
  "game-mode",
  "game-bar-disable",
  "visual-effects",
  "mouse-accel-off",
] as const;

/**
 * The rec the demo may honestly run on: whitelisted, safe-tier, eligible for this rig, appliable,
 * and genuinely OFF right now (the demo never fakes a before-state). Null when none qualifies —
 * the card simply doesn't render (no fabricated demo, honesty rail).
 */
export function pickTrustDemoRec(
  recs: Recommendation[] | null,
  isAppliable: (recId: string) => boolean,
): Recommendation | null {
  if (!recs) return null;
  for (const id of TRUST_DEMO_IDS) {
    const r = recs.find((x) => x.id === id);
    if (
      r &&
      r.severity === "safe" &&
      r.eligible !== false &&
      !r.currently_applied &&
      isAppliable(r.id)
    ) {
      return r;
    }
  }
  return null;
}

/**
 * Show the card only to a genuinely brand-new user: nothing in the Trust Ledger yet (a rig with
 * history has already lived the loop) and not previously completed/dismissed.
 */
export function shouldOfferTrustMoment(changes: AppliedChange[], done: boolean): boolean {
  return !done && changes.length === 0;
}
