import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Bug → guard (#614, found by the self-reviewer during the #599 review, 2026-09-28). Health's
// Detected tile is the bento hero, 7 of 12 columns. Its spec cards (Graphics, Processor, Memory,
// Storage) sat in `repeat(auto-fit, minmax(230px, 1fr))`. auto-fit can drop to one column, but no
// further: the last track still demands 230px. Below a ~700px window the hero's content box is
// narrower than that, so the cards spilled out of the tile and ran under Findings. The window's
// minWidth is 380, so a user can reach it.
//
// The fix is the breakpoint-free clamp `minmax(min(230px, 100%), 1fr)`. It is identical wherever
// the container is at least 230px, and caps the track at the container below that. This file bans
// `@media`, so there is no breakpoint to add instead.
//
// jsdom does no layout, so this guard resolves each track minimum for real container widths. That
// catches the defect itself, not one spelling of it.

const css = readFileSync(join("src", "surfaces", "home-console.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** Every `repeat(auto-fit|auto-fill, minmax(<min>, <max>))` in the sheet, with its selector. */
function autoTracks(): { selector: string; min: string }[] {
  const out: { selector: string; min: string }[] = [];
  const ruleRe = /([^{}]+)\{([^}]*)\}/g;
  for (const [, selector, body] of css.matchAll(ruleRe)) {
    const repeatRe = /repeat\(\s*auto-(?:fit|fill)\s*,\s*minmax\(/g;
    for (const m of body.matchAll(repeatRe)) {
      // Walk to the comma that ends minmax's FIRST argument, at paren depth 0.
      let i = m.index! + m[0].length;
      let depth = 0;
      let arg = "";
      for (; i < body.length; i++) {
        const c = body[i];
        if (c === "(") depth++;
        else if (c === ")") depth--;
        else if (c === "," && depth === 0) break;
        arg += c;
      }
      out.push({ selector: selector.trim(), min: arg.trim() });
    }
  }
  return out;
}

/** The px a track minimum resolves to inside a container `w` px wide. Unknown forms throw. */
function resolveMin(min: string, w: number): number {
  const px = min.match(/^(\d+(?:\.\d+)?)px$/);
  if (px) return Number(px[1]);
  const clamp = min.match(/^min\(\s*([^,]+?)\s*,\s*([^,]+?)\s*\)$/);
  if (clamp) return Math.min(resolveMin(clamp[1], w), resolveMin(clamp[2], w));
  const pct = min.match(/^(\d+(?:\.\d+)?)%$/);
  if (pct) return (Number(pct[1]) / 100) * w;
  throw new Error(`unrecognised track minimum "${min}" — teach resolveMin its form`);
}

// Content-box widths the hero tile really takes, from the 380px minWidth up past the point where
// the clamp stops mattering. 1280x720 and wider sit far above the top of this range.
const WIDTHS = Array.from({ length: 70 }, (_, k) => 100 + k * 10);

describe("Health's Detected tile — spec cards never overflow their tile (#614)", () => {
  it(".hc-specs-grid is an auto-fit grid (the rule this guard reads still exists)", () => {
    const grid = autoTracks().filter((t) => /\.hc-specs-grid$/.test(t.selector));
    expect(grid).toHaveLength(1);
  });

  it("no auto-fit/auto-fill track in home-console.css asks for more width than its container has", () => {
    const tracks = autoTracks();
    expect(tracks.length).toBeGreaterThan(0);
    for (const { selector, min } of tracks) {
      for (const w of WIDTHS) {
        expect(
          resolveMin(min, w),
          `${selector}: track minimum "${min}" is wider than a ${w}px container`,
        ).toBeLessThanOrEqual(w);
      }
    }
  });

  it("the clamp changes nothing where the tile is wide: spec cards still ask for 230px there", () => {
    const [grid] = autoTracks().filter((t) => /\.hc-specs-grid$/.test(t.selector));
    for (const w of [230, 400, 700]) expect(resolveMin(grid.min, w)).toBe(230);
  });

  // A card clamped to a 62px tile is only half the fix. Its title, keys and values must also yield
  // inside it, or they cross the card's frame and the defect moves one box inward. Measured on the
  // unfixed build at 504px: "PROCESSOR" alone is wider than the card's content box.
  it("a spec card's own contents yield before they cross its frame", () => {
    const rule = (sel: string) => {
      const m = css.match(new RegExp(`:root\\[data-v2="on"\\] \\${sel}\\s*\\{([^}]*)\\}`));
      if (!m) throw new Error(`no rule for ${sel}`);
      return m[1];
    };
    expect(rule(".hc-spec-title")).toMatch(/overflow-wrap:\s*anywhere/);
    expect(rule(".hc-spec-row")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".hc-spec-k")).toMatch(/max-width:\s*100%/);
    expect(rule(".hc-spec-k")).toMatch(/overflow-wrap:\s*anywhere/);
    const v = rule(".hc-spec-v");
    expect(v).toMatch(/min-width:\s*0/);
    expect(v).toMatch(/overflow-wrap:\s*anywhere/);
    // A value that could not shrink would force its row past a narrow card.
    expect(v).toMatch(/flex:\s*1\s+1\s+\S+/);
  });
});
