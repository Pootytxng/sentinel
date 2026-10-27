// P7-rig-limiter (ROADMAP P7 bullet 4, Constitution §24): the Home rig picks out the part the answer
// is about. The #1 limiter (priorities.rs `build_priorities`) maps to a rig part KIND here; the
// hologram then highlights it through its existing `selectedId`. A limiter that is a setting or
// software dims the parts instead, and Home says the top item is a setting or software, not a part.
//
// The table is written against the limiter ids priorities.rs can emit, and nothing else:
//   - a part only when the limiter IS about a physical component in the case, and only when the
//     scene has exactly ONE part that fits what the limiter says. `install-drive` is an attention
//     only when the game sits on a spinning drive, so the part must be a physical drive whose own
//     media type reads HDD — never "the only drive drawn", which could be an SSD while the game sits
//     on an HDD the rig doesn't draw (review r1 MUST-FIX 2). Logical-volume fallbacks carry no media
//     type, so they never qualify. Anything else → no part (never a guess dressed as a finding);
//   - "away" only for ids that are settings or software by construction;
//   - anything else (an id this build doesn't know, or no limiter) → null: the rig is left alone.
import type { RigPartKind } from "./rig-parts";

export type LimiterFocus =
  | { kind: "part"; partId: string; partName: string }
  | { kind: "away" }
  | null;

/** A drawn part, as far as the limiter mapping needs it. `hdd` is true only for a physical drive
 *  whose own reported media type is HDD (false/absent for SSDs, unknowns and volume fallbacks). */
export type FocusPart = { id: string; kind: RigPartKind; name: string; detected: boolean; hdd?: boolean };

/** Limiters about a component inside the case: which drawn parts can be the one meant. */
export const LIMITER_PART_KIND: Readonly<Record<string, (p: FocusPart) => boolean>> = {
  // Readiness "Game install drive": attention means the game sits on a spinning drive.
  "install-drive": (p) => p.kind === "storage" && p.hdd === true,
};

/** Pure: which of hw.physical_disks report HDD, keyed the way buildRigParts ids them (`disk-<i>`). */
export function hddPartIds(physicalDisks: readonly { media_type?: string | null }[] | null | undefined): Set<string> {
  const ids = new Set<string>();
  (physicalDisks ?? []).forEach((d, i) => {
    if (/^hdd$/i.test((d.media_type ?? "").trim())) ids.add(`disk-${i}`);
  });
  return ids;
}

/** Limiters that are a setting or software by construction. The rig dims for these and the line
 *  says only what is true by construction: the top item is a setting or software, not a part. It
 *  never says the parts are fine — nothing here measured that (review r1 §5/§6). */
export const LIMITER_AWAY: ReadonlySet<string> = new Set([
  "monitor-refresh", // Windows running the display below its refresh rate: a setting
  // The graphics DRIVER's age: software that runs on the card, not the card. The GPU dims with the
  // rest because the item is about the driver; the line never claims the card itself is fine.
  "gpu-driver-age",
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

export function limiterFocus(limiterId: string | null | undefined, parts: readonly FocusPart[]): LimiterFocus {
  if (!limiterId) return null;
  if (LIMITER_AWAY.has(limiterId)) return { kind: "away" };
  const fits = LIMITER_PART_KIND[limiterId];
  if (!fits) return null;
  const matches = parts.filter((p) => p.detected && fits(p));
  if (matches.length !== 1) return null;
  return { kind: "part", partId: matches[0].id, partName: matches[0].name };
}
