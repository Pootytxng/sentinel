import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/* #213 B5, THE REST OF IT — every seam in the comps is a bevel, not a line.
 *
 * B5 was filed as "the rail seam looks like a stripe". Fixing it (`4d65902e`) found the real shape:
 * the approved comps draw EVERY plane boundary as two rows — a 1px highlight on the panel's own
 * edge and a 1px shadow on the ground just outside it — and the app was shipping only the light
 * half. That fix covered the one seam the issue happened to name. This file covers the other two,
 * which are the same defect at a different angle and were never separately reported.
 *
 * WHAT THE PICTURES SAY. Row-averaged samples (PIL) across the four approved PNGs at
 * C:/Users/Kuya/.codex/visualizations/2026/08/23/01a02bee-.../compy-four-room-handoff:
 *
 *   titlebar → app boundary, averaged full width (x=30..1500), so this seam spans the rail too:
 *     01-health   y38 #0c0d11 · y39 #07090d · y40 #121317 · y41 #1c1e23 · y42 #0f1218
 *     04-test     y38 #0b0c10 · y39 #090a0e · y40 #0d0e12 · y41 #1e1e23 · y42 #101319
 *     02-live     y40 #101318 · y41 #0a0c11 · y42 #21262b
 *     03-history  y40 #0b0d12 · y41 #21242b · y42 #13171e
 *   All four: a DARK row immediately above a BRIGHT row. The comps are 1550px wide against the
 *   owner's 1484px window, so the in-between rows (#121317, #0d0e12) are the downscale blending
 *   two app pixels — the feature is two rows, not three.
 *
 *   top bar → content boundary, averaged over the content column only (x=900..1500):
 *     01-health   y93 #1a1d23 · y95 #07090d · y96 #0e1014
 *     04-test     y93 #1e2128 · y95 #070a10 · y96 #0f1117
 *     02-live     y94 #1d2229 · y95 #1c2027 · y96 #0c0f16
 *   Bright INSIDE the bar, dark OUTSIDE it in the ground below. Sampled over the RAIL column
 *   (x=30..200) the same rows are a flat #0f1217 — the rail has no seam there, which is why this
 *   half belongs on `.v2-top` and not on the window chrome.
 *
 * So the rule the comps follow is uniform: highlight on the panel, shadow on the ground. That is
 * exactly what `--v2-line` + `--v2-line-shadow` already express; nothing new is being designed
 * here, the tokens are just reaching the two edges they had not reached yet.
 *
 * STATIC SHEET READS, on purpose. jsdom never loads these stylesheets, so no rendering test can
 * see a seam regression — only the picture can, and the picture costs a build, an install and a
 * review round. This is the cheap half of that loop.
 */

const read = (...p: string[]) => readFileSync(join(...p), "utf8");

/** Strip comments, then return the body of the first rule whose selector matches. */
function body(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of clean.split("}")) {
    const [sel, decls] = block.split("{");
    if (sel == null || decls == null) continue;
    if (sel.trim().replace(/\s+/g, " ") === selector) return decls;
  }
  return "";
}

/** The alpha a black overlay must have had to turn `ground` into `dark`, averaged per channel. */
export function impliedAlpha(ground: string, dark: string): number {
  const parse = (hex: string) =>
    [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
  const [gr, gg, gb] = parse(ground);
  const [dr, dg, db] = parse(dark);
  const ratios = [dr / gr, dg / gg, db / gb];
  return 1 - ratios.reduce((a, b) => a + b, 0) / ratios.length;
}

describe("impliedAlpha — the arithmetic this file leans on", () => {
  it("recovers an alpha it was given", () => {
    // 0.35 black over #14181e is #0d0f14 (20·0.65=13, 24·0.65=15.6→16 … sampled back, so tolerate
    // the rounding the compositor already did).
    expect(impliedAlpha("#141820", "#0d0f15")).toBeCloseTo(0.35, 1);
  });

  it("reads a ground unchanged as no overlay at all", () => {
    expect(impliedAlpha("#0a0c10", "#0a0c10")).toBe(0);
  });
});

describe("#213 B5b — the titlebar's bottom edge is a bevel, not a line", () => {
  const chrome = read("src", "design", "WindowChrome.css");

  it("keeps the LIGHT half exactly where the previous fix put it", () => {
    // The premise. If someone re-themes this border, the dark row below is decoration on nothing
    // and this file should say so rather than keep asserting a half-seam is a whole one.
    const bar = body(chrome, ':root[data-v2="on"] .wc-bar');
    expect(bar, "the V2 titlebar rule is gone — #213 B1 has been reverted").toBeTruthy();
    expect(bar).toMatch(/border-bottom:\s*1px solid var\(--v2-line\)/);
    expect(bar).toMatch(/background:\s*var\(--v2-bg\)/);
  });

  it("draws the dark row directly above that border, in the shadow token", () => {
    const seam = body(chrome, ':root[data-v2="on"] .wc-bar::after');
    expect(seam, "no .wc-bar::after — the titlebar seam lost its dark half").toBeTruthy();
    expect(seam).toMatch(/position:\s*absolute/);
    expect(seam).toMatch(/height:\s*1px/);
    // bottom:0 is the row immediately INSIDE the border-bottom: absolute offsets resolve against
    // the padding box, so 0 lands the strip on the last content row, with the bright border under
    // it. Any other value paints the shadow somewhere the comps do not draw one.
    expect(seam).toMatch(/bottom:\s*0/);
    expect(seam).toMatch(/background:\s*var\(--v2-line-shadow\)/);
    expect(seam, "a seam that eats clicks would break the drag region").toMatch(/pointer-events:\s*none/);
  });

  it("spans the full width, because the comps' dark row crosses the rail too", () => {
    // Sampled over x=30..200 (rail) AND x=900..1500 (content) in 01-health: #07090d at both.
    // A seam inset to the content column would be a different design from the approved one.
    const seam = body(chrome, ':root[data-v2="on"] .wc-bar::after');
    expect(seam).toMatch(/left:\s*0/);
    expect(seam).toMatch(/right:\s*0/);
  });
});

describe("#213 B5b — the top bar's bottom edge carries its shadow into the content ground", () => {
  const shell = read("src", "design", "shell-v2.css");

  it("keeps the LIGHT half — it already matched the comps", () => {
    const top = body(shell, ':root[data-v2="on"] .v2-top');
    expect(top).toMatch(/border-bottom:\s*1px solid var\(--v2-line\)/);
  });

  it("adds the dark row one pixel below the bar, outside its border box", () => {
    const top = body(shell, ':root[data-v2="on"] .v2-top');
    // An outset shadow rather than a pseudo-element: `.v2-content` paints no background of its own,
    // so nothing covers the strip, and a box-shadow cannot be knocked out of position by the flex
    // layout the way an absolutely positioned child can.
    expect(top, "no shadow under .v2-top — the seam is half-drawn again").toMatch(
      /box-shadow:\s*0 1px 0 var\(--v2-line-shadow\)/,
    );
  });

  it("does not put one above the bar as well — the comps draw the rail flat there", () => {
    // x=30..200 at the same rows is a uniform #0f1217 in 01-health. Ringing the bar would invent a
    // line the pictures do not have, which is the failure mode this whole file exists to prevent.
    const top = body(shell, ':root[data-v2="on"] .v2-top');
    expect(top).not.toMatch(/box-shadow:[^;]*0 -1px/);
  });
});

describe("#213 B5b — one shadow token, and the comps agree with its alpha", () => {
  const tokens = read("src", "design", "tokens-v2.css");

  it("still resolves to a black alpha rather than a hex someone typed", () => {
    expect(tokens).toMatch(/--v2-line-shadow:\s*rgba\(0,\s*0,\s*0,\s*[\d.]+\)/);
  });

  // Ground → dark, read off ADJACENT rows of the same render, so each render's own noise floor
  // cancels instead of being compared against a token value it never quite equals.
  const SEAMS: Array<[string, string, string]> = [
    ["01-health titlebar y38→y39", "#0c0d11", "#07090d"],
    ["04-test titlebar y38→y39", "#0b0c10", "#090a0e"],
    ["01-health top bar y96→y95", "#0e1014", "#07090d"],
    ["04-test top bar y96→y95", "#0f1117", "#070a10"],
  ];

  it("sits at the deepest alpha the approved pictures imply", () => {
    // The four samples spread from 0.16 to 0.43, and the spread is an artefact, not a disagreement:
    // the comps are 1550px wide against a 1484px window, so a 1px row is resampled with its
    // neighbours. That can only ever LIGHTEN a dark row toward the ground beside it — never deepen
    // it past its true value. So the deepest sample is the closest to the truth and the shallow
    // ones are blends, which is why this compares against the max rather than the mean.
    const alpha = Number(/--v2-line-shadow:\s*rgba\(0,\s*0,\s*0,\s*([\d.]+)\)/.exec(tokens)?.[1]);
    const deepest = Math.max(...SEAMS.map(([, g, d]) => impliedAlpha(g, d)));
    expect(
      Math.abs(alpha - deepest),
      `the deepest sampled seam implies ${deepest.toFixed(2)}, the token is ${alpha}`,
    ).toBeLessThanOrEqual(0.12);
  });

  it("is honest about what these samples can and cannot pin down", () => {
    // They bound the alpha to roughly 0.3–0.45. They do NOT pin it to 0.35, and a test claiming
    // they did would be overclaiming — the tight check lives in comp-fidelity-guard, which reads a
    // single un-blended sample per channel and rejects 0.5 on the arithmetic.
    const implied = SEAMS.map(([, g, d]) => impliedAlpha(g, d));
    expect(Math.max(...implied) - Math.min(...implied)).toBeGreaterThan(0.15);
  });

  it("FALSIFICATION: an alpha the pictures clearly exclude fails the band", () => {
    const deepest = Math.max(...SEAMS.map(([, g, d]) => impliedAlpha(g, d)));
    // A seam so faint it is not there, and one so heavy it reads as a black rule. Both are changes
    // someone could make in one keystroke while "simplifying the tokens".
    expect(Math.abs(0.05 - deepest)).toBeGreaterThan(0.12);
    expect(Math.abs(0.9 - deepest)).toBeGreaterThan(0.12);
  });
});
