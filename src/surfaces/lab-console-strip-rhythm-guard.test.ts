// bug→guard for the Codex REJECT of candidate 9bef1cc2 (2026-08-27), finding "the evidence strip
// uses four visually heavy rings instead of the approved two-ring / two-large-numeral rhythm …
// extra status and explanatory lines make the strip denser and taller".
//
// Which cell is a ring and which is a numeral is pinned in lab-console.test.tsx (DOM). What THIS
// file pins is the thing that made the rejected build look wrong even though the DOM was already
// right: the strip's SIZES. Every one of these numbers was measured off assets/approved/test.png
// on 2026-08-27 by scanning that image for its own ink runs, then divided by the comp→app scale
// of 1.0333 (the 1550x1015 comp was rendered from a 1500x980 window).
//
//   42 air · 32 label · 64 ring · 9 gap · 26 stamp · 42 air  =  216 app px of strip.
//
// The reason a source-text guard is worth writing here rather than a rendered assertion: the
// rejected build's rings were 76px because the `grid-template-rows` declaration NEVER APPLIED AT
// ALL. The comment above it contained a stray comment terminator mid-paragraph, CSS closed the
// comment early, and error recovery swallowed the declaration that followed it up to the next
// semicolon. Nothing rendered a warning; every row fell back to `auto` and the ring grew to fill.
// jsdom does not lay out and would not have caught it either. So this reads the file, and it fails
// if the declaration is missing, commented out, or drifted off the comp's numbers — including the
// specific way it disappeared last time, which no assertion about a rendered ring would notice.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

const CSS = readFileSync(resolve("src/surfaces/lab-console.css"), "utf8");

/** The stylesheet with every comment stripped — i.e. what the browser is actually left holding. */
const LIVE = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** The live declaration block for a selector, or "" if the browser never sees one. */
function live(selector: string): string {
  const at = LIVE.indexOf(selector + " {");
  return at < 0 ? "" : LIVE.slice(at, LIVE.indexOf("}", at));
}

describe("the evidence strip keeps the approved rhythm", () => {
  it("never lets a comment swallow a declaration — the 76px-ring regression, mechanized", () => {
    // Every `*/` in the file must be the END of a comment that began with a `/*`. If prose ever
    // contains one again, the count of openers and closers still balances but the pairing shifts,
    // and some later declaration silently dies. Counting them is the cheap, total check.
    const openers = (CSS.match(/\/\*/g) ?? []).length;
    const closers = (CSS.match(/\*\//g) ?? []).length;
    expect(
      closers,
      "a stray comment terminator inside CSS prose closes the comment early and error recovery " +
        "eats the next declaration — this is exactly how the strip's grid-template-rows died",
    ).toBe(openers);
  });

  it("gives the readings row the comp's four bands, not four autos", () => {
    const rule = live(':root[data-v2="on"] .lc-readings .arc-gauge');
    expect(rule, ".lc-readings .arc-gauge has no rule the browser can see").not.toBe("");
    const rows = /grid-template-rows:\s*([^;]+);/.exec(rule);
    expect(
      rows,
      "no grid-template-rows reaches the browser: every band falls back to auto and the ring " +
        "grows to fill the cell — that is the rejected 76px ring",
    ).not.toBeNull();
    // label band, ring band, gap band, stamp band — the ring band is the one the comp fixes.
    expect(rows![1]).toMatch(/minmax\(\s*32px\s*,\s*auto\s*\)\s+64px\s+minmax\(\s*9px\s*,\s*auto\s*\)\s+auto/);
  });

  it("draws the ring at the comp's 64px, in both the svg and the value it centres", () => {
    for (const sel of [
      ':root[data-v2="on"] .lc-readings .arc-gauge > svg',
      ':root[data-v2="on"] .lc-readings .ag-ctr',
    ]) {
      const rule = live(sel);
      expect(rule, `${sel} is not in the served stylesheet`).not.toBe("");
      expect(rule, `${sel} must be the comp's 64px ring, not the 56px base or a grown auto`).toMatch(
        /width:\s*64px/,
      );
    }
  });

  it("keeps two voices — a big bare numeral and a smaller one inside a ring", () => {
    // The approved strip reads as two large numbers flanked by two rings. One shared font-size for
    // all four is what flattened it: a 40px numeral inside a 64px ring does not fit, so making them
    // equal forces the ring to grow, which is the finding again from the other direction.
    const numeral = live(':root[data-v2="on"] .lc-readings .ag-as-numeral .ag-v');
    const ring = live(':root[data-v2="on"] .lc-readings .ag-as-ring .ag-v');
    expect(numeral).toMatch(/font-size:\s*var\(--type-verdict\)/);
    expect(ring).toMatch(/font-size:\s*var\(--type-section\)/);
    // Tokens, not literals: "shrinking text below the established type tokens" was named in the
    // rejection as a thing the fix may not do, and a px literal here is how that starts.
    for (const rule of [numeral, ring]) expect(rule).not.toMatch(/font-size:\s*\d+px/);
  });

  it("collapses the aria-live line when it has nothing to say", () => {
    // The strip's own height was part of the finding. The hologram's answer region is a live region
    // that must stay mounted, but an empty one that still pays 16px of padding is 16px the approved
    // composition does not spend.
    expect(live(':root[data-v2="on"] .lc-bench .lc-evidence:empty')).toMatch(/padding:\s*0/);
  });
});
