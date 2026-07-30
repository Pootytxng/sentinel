// HOW MUCH THE STICKY NAV COVERS — measured, never guessed.
//
// The Lab deck's five-step nav is `position: sticky; top: 0`, so it parks over the top of the
// room's scroll container. Anything that scrolls a section to the top of that container — the nav
// pills themselves, a focus reveal, an anchor — has to leave the covered strip free, or the user
// jumps to "Optimize" and lands on a heading that is half hidden behind the pill they just clicked.
//
// A hard-coded scroll-margin cannot be right, which is exactly how the first attempt failed
// (self-review round 2, 2026-07-28: `scroll-margin-top: 56px` clipped the destination heading of
// four of the five sections by ~15px at 1280×720). The covered strip is NOT the nav's height:
//
//   covered = the room scroller's own top padding  +  the nav's height
//
// — 26px of `.v2-content` padding plus a ~45px nav on this rig, and the nav grows to two rows when
// the five names wrap at a narrow width. Only a measurement of where the nav's bottom edge really
// sits, relative to the scrollport it sticks to, is right at every width and in every room skin.
//
// So LabDeck measures it and publishes it as `--ld-jump-inset`; LabDeck.css consumes it as the
// sections' scroll-margin-top. This module owns the arithmetic so it can be pinned by a test —
// jsdom has no layout engine, so the geometry itself is unprovable there, but the rule that turns
// two measured edges into an inset is not.

/** Breathing room below the nav's bottom edge — the heading lands clear of it, not flush against it. */
export const JUMP_GAP = 12;

/**
 * The static fallback, used when nothing can be measured (no layout, no scrollport). MIRRORED by
 * `.ld-section { scroll-margin-top: var(--ld-jump-inset, 82px) }` in LabDeck.css, and the mirror is
 * asserted by lab-jump-clearance.test.ts — change one and the test tells you about the other.
 */
export const FALLBACK_JUMP_INSET = 82;

/**
 * The scroll container the deck actually lives in — the element the sticky nav sticks to. Walks up
 * from the deck rather than assuming a shell class, so the deck stays correct if it is ever mounted
 * in a different room frame. Null means "nothing scrolls above us" (the document does).
 */
export function scrollportOf(start: HTMLElement | null): HTMLElement | null {
  if (typeof window === "undefined" || typeof window.getComputedStyle !== "function") return null;
  let n: HTMLElement | null = start?.parentElement ?? null;
  while (n && n !== document.documentElement) {
    const oy = window.getComputedStyle(n).overflowY;
    if (oy === "auto" || oy === "scroll" || oy === "overlay") return n;
    n = n.parentElement;
  }
  return null;
}

/** Where the scrollport's own top edge is, in viewport coordinates. The document's is always 0. */
export function scrollportTop(port: HTMLElement | null): number {
  if (!port) return 0;
  const r = port.getBoundingClientRect?.();
  return r ? r.top : 0;
}

/**
 * The inset a jump must leave: everything between the scrollport's top edge and the nav's bottom
 * edge, plus a gap. Returns null when the numbers are not real (jsdom's all-zero rects, a nav that
 * hasn't laid out yet) so the caller can leave the CSS fallback in place instead of publishing 0 —
 * publishing 0 would silently reintroduce the clipped-heading bug.
 */
export function computeJumpInset(
  navBottom: number,
  portTop: number,
  gap: number = JUMP_GAP,
): number | null {
  const covered = navBottom - portTop;
  if (!Number.isFinite(covered) || covered <= 0) return null;
  return Math.round(covered) + gap;
}

// ─────────────────────── WHERE AM I, once the page stops scrolling ───────────────────────
//
// The nav lights the pill for whichever section owns the viewport, chosen by intersection ratio.
// That rule cannot answer for the LAST step, and the reason is the same geometry as above: the
// browser clamps the scroll at the end of the page, so "Advanced instruments" never gets to own the
// viewport. At maximum scroll a tall earlier section and the short last one are BOTH fully in frame
// — ratio 1.0 each — and the earlier one wins the comparison. Self-review round 5 measured exactly
// that at 1484×971: click step 5, the page jumps, and the nav still says step 4.
//
// Ratio is not the thing to fix; no ratio rule can be right when the page runs out of room. The
// path ends where the page ends: AT the end of the scroller, the last step is where you are,
// whatever the ratios say. Everywhere else this changes nothing — ties included, so arriving at the
// top still lights step 1 when two short sections are both fully visible.

/** Slack for fractional scroll positions — a clamped scroller can land a hair under its own max. */
export const AT_END_SLACK = 2;

/** True when the scroller can no longer move down. A page that doesn't scroll has no end. */
export function atScrollEnd(
  port: { scrollTop: number; scrollHeight: number; clientHeight: number } | null,
): boolean {
  if (!port) return false;
  const max = port.scrollHeight - port.clientHeight;
  if (!Number.isFinite(max) || max <= 0) return false;
  return port.scrollTop >= max - AT_END_SLACK;
}

/**
 * Which step to light. `order` is the journey, `ratio` reports how much of each section is in frame,
 * `atEnd` is `atScrollEnd` for the deck's scrollport. Returns null only for an empty journey.
 */
export function pickHere<T extends string>(
  order: readonly T[],
  ratio: (key: T) => number,
  atEnd: boolean,
): T | null {
  if (order.length === 0) return null;
  if (atEnd) return order[order.length - 1];
  let best: T | null = null;
  let bestRatio = 0;
  for (const k of order) {
    const r = ratio(k);
    if (Number.isFinite(r) && r > bestRatio) {
      bestRatio = r;
      best = k;
    }
  }
  return best;
}
