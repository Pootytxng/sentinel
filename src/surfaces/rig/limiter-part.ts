// P7-rig-limiter (ROADMAP P7 bullet 4, Constitution §24): the Home rig picks out the part the answer
// is about. The #1 limiter (priorities.rs `build_priorities`) maps to a rig part KIND here; the
// hologram then highlights it through its existing `selectedId`. A limiter that is a setting or
// software dims the parts instead, and Home says the evidence points away from the hardware.
//
// The table is written against the limiter ids priorities.rs can emit, and nothing else:
//   - a part only when the limiter IS about a physical component in the case, and only when the
//     scene has exactly ONE part of that kind — with two drives, Compy does not know which one the
//     game is on from these readings, so it points at neither (never a guess dressed as a finding);
//   - "away" only for ids that are settings or software by construction;
//   - anything else (an id this build doesn't know, or no limiter) → null: the rig is left alone.
import type { RigPartKind } from "./rig-parts";

export type LimiterFocus =
  | { kind: "part"; partId: string; partName: string }
  | { kind: "away" }
  | null;

/** Limiters about a component inside the case, and the kind of part they are about. */
export const LIMITER_PART_KIND: Readonly<Record<string, RigPartKind>> = {
  // Readiness "Game install drive": the game sits on a slow (spinning) drive.
  "install-drive": "storage",
};

/** Limiters that are a setting or software by construction — no part in the case is the cause. */
export const LIMITER_AWAY: ReadonlySet<string> = new Set([
  "monitor-refresh", // Windows running the display below its refresh rate: a setting
  "gpu-driver-age", // the graphics DRIVER's age: software on the card, not the card
  "power-profile", // the Windows power plan: a setting
  "fps-monitoring", // whether frame-rate capture is set up: software
  "applied-changes", // Compy's own applied changes drifting: settings
  "pending-safe-recs", // safe tweaks not applied: settings
  "startup-load", // apps launching at startup: software
]);

/** Glow multiplier for a dimmed rig: low enough to read as "not this", high enough that every part
 *  stays visible and identifiable (a hidden part would be a different, false statement). */
export const DIMMED_GLOW = 0.35;

/** The glow multiplier a part gets (RigHologram `dimmed`). Dimmed → DIMMED_GLOW, except the part
 *  being pointed at (selected or hovered), which stays at full so the user's own focus is never
 *  muted. Not dimmed → 1 for every part, exactly as before. */
export function rigGlow(dimmed: boolean, id: string, selectedId: string | null, hoveredId: string | null): number {
  return dimmed && id !== selectedId && id !== hoveredId ? DIMMED_GLOW : 1;
}

export function limiterFocus(
  limiterId: string | null | undefined,
  parts: readonly { id: string; kind: RigPartKind; name: string; detected: boolean }[],
): LimiterFocus {
  if (!limiterId) return null;
  if (LIMITER_AWAY.has(limiterId)) return { kind: "away" };
  const kind = LIMITER_PART_KIND[limiterId];
  if (!kind) return null;
  const matches = parts.filter((p) => p.kind === kind && p.detected);
  if (matches.length !== 1) return null;
  return { kind: "part", partId: matches[0].id, partName: matches[0].name };
}
