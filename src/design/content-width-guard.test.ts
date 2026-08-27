// bug→guard for the Codex REJECT of candidate 9bef1cc2 (2026-08-27), finding "1920x1080 — major
// geometry failure".
//
// `.v2-content-wrap` capped every room at a FIXED 1160px. That number was measured off comps drawn
// at 1500 and it is right there — but a fixed cap does not scale, so on the 1920x1080 display the
// owner actually works at, the room became a centred island with ~267px of dead margin on each
// side. He rejected it on sight, and the review's instruction was explicit: do not leave the 1920
// mismatch unresolved merely because the cap lives in shared shell CSS.
//
// What the comps hold constant is the GUTTER as a share of the space the rail leaves — 1160 of 1224
// at 1500 — so the cap is now a percentage with a ceiling. This guard pins the three things that
// can silently regress it:
//
//   1. the cap is proportional, not a bare pixel value (the regression is a one-token edit);
//   2. it still resolves to the comps' box at 1500 and grows at 1920 (arithmetic on the same rule
//      the browser applies, so the test fails if the percentage drifts away from the comps);
//   3. a ceiling still exists, because the reason the old cap was introduced — a 46ch sentence must
//      not run the width of a wall — is still true on a display large enough to threaten it.
//
// Read from the stylesheet rather than from a rendered page: jsdom does not lay out, so the source
// is the only honest place to check a layout rule in a unit test. The live check is the four-room
// visual smoke that ships with the change.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const CSS = readFileSync(resolve("src/design/shell-v2.css"), "utf8");

/** The declaration block for a selector, as written. */
function ruleFor(selector: string): string {
  const at = CSS.indexOf(selector + " {");
  expect(at, `${selector} has no rule in shell-v2.css`).toBeGreaterThan(-1);
  return CSS.slice(at, CSS.indexOf("}", at));
}

const WRAP = ruleFor(':root[data-v2="on"] .v2-content-wrap');
const CONTENT = ruleFor(':root[data-v2="on"] .v2-content');

/** What `max-width: min(P%, Cpx)` resolves to inside the content lane at a given window width. */
function capAt(windowPx: number, pct: number, ceilPx: number): number {
  const RAIL = 216; // the shell's fixed navigation rail, measured on the live build
  const SCROLLBAR = 10; // `scrollbar-width: thin` on .v2-content, also measured live
  const padding = 2 * Number(/padding:\s*\d+px\s+(\d+)px/.exec(CONTENT)![1]);
  return Math.min(((windowPx - RAIL - SCROLLBAR - padding) * pct) / 100, ceilPx);
}

describe("the room content box scales with the window instead of stranding it", () => {
  const m = /max-width:\s*min\(\s*([\d.]+)%\s*,\s*(\d+)px\s*\)/.exec(WRAP);

  it("caps by proportion with a ceiling, never by a bare pixel width", () => {
    expect(
      m,
      "a fixed `max-width: <n>px` here is the 1920 dead-margin defect — the cap must be a " +
        "percentage of the space the rail leaves, with a px ceiling behind it",
    ).not.toBeNull();
  });

  it("still lands the comps' box at 1500 and keeps the proportion at 1920", () => {
    const [pct, ceil] = [Number(m![1]), Number(m![2])];
    // 1500 is the owner's window and the width every approved comp was drawn at. Re-measured off
    // assets/approved/test.png 2026-08-27 by scanning for the bench panel's own right border: the
    // content box runs x288..1488 comp px, i.e. 279..1440 app px = 1161. A few px either way is the
    // rounding; a 40px drift is a redesign.
    expect(Math.abs(capAt(1500, pct, ceil) - 1161)).toBeLessThan(8);
    // 1920 is his display. The old cap left it at 1160 with ~267px dead each side; the box must now
    // take most of what the rail leaves, while still keeping a gutter rather than running edge to
    // edge.
    const at1920 = capAt(1920, pct, ceil);
    expect(at1920, "1920 must not still be stranded at the 1500 box").toBeGreaterThan(1450);
    expect(at1920, "…but it must not consume the gutter either").toBeLessThan(1644);
  });

  it("keeps a ceiling for displays wide enough to stretch a sentence past reading", () => {
    const ceil = Number(m![2]);
    expect(ceil).toBeGreaterThan(1560); // never binds at 1920
    expect(ceil).toBeLessThanOrEqual(1900); // but does bind on a very wide monitor
  });
});
