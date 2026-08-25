import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/* THE TITLEBAR IS THE DEEPEST PLANE, AND IT IS NOT TINTED. (#213 B1)
 *
 * `.wc-bar` shipped with `background: var(--ix-base, #0b0c10)` — theme-driven, which was correct
 * when the titlebar was the only chrome in the app. It stopped being correct when V2 took over
 * everything beneath it. `:root[data-itheme="violet"]` sets --ix-base to #0c0a14, described in
 * instrument.css as "a violet-tinted charcoal", and violet is the DEFAULT instrument theme
 * (theme.ts:36 returns it when localStorage has nothing). So the shipped titlebar rendered a
 * violet-tinted near-black directly above --v2-bg #0a0c10, which is tinted the opposite way.
 *
 * #213 B1 reported it as "a faint purple/magenta wash bleeding across the top edge of the window"
 * and filed it under DIRECTION — a matter of taste for a later design lane. It was neither faint
 * nor a direction: it was two colour systems meeting at y=34 on every screen, by default.
 *
 * The comp is the spec (owner ruling 2026-08-23, `a83d4809`). Sampling the approved
 * `01-health-approved.png` along y=20 returns #0a0c10 at every x past the app name — the titlebar
 * he approved is --v2-bg exactly — and along y=50 returns #0f1217 for the rail. Deepest at the top,
 * raised beneath. That ordering IS the "elevation logic" B1 said was missing, so one token answers
 * both halves of the report.
 *
 * Static sheet reads on purpose, the same reasoning as comp-fidelity-guard: jsdom never loads these
 * stylesheets, so no rendering test can see this regression. Only the picture can, and the picture
 * costs a build, an install and a review round.
 */

const read = (...p: string[]) => readFileSync(join(...p), "utf8");

/** Body of the first rule whose selector matches exactly, comments stripped. */
function body(css: string, selector: string): string {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const block of clean.split("}")) {
    const [sel, decls] = block.split("{");
    if (sel == null || decls == null) continue;
    if (sel.trim().replace(/\s+/g, " ") === selector) return decls;
  }
  return "";
}

/**
 * Is this near-black tinted toward violet/magenta — red AND blue above green?
 *
 * This is the whole defect expressed as arithmetic. #0c0a14 is (12,10,20): both ends lifted over
 * the middle, which the eye reads as purple. #0a0c10 is (10,12,16): green above red, which reads
 * cool. The channel ORDER is what matters, not the magnitude — at these luminances a two-point
 * spread is plainly visible as a wash across a 34px band a thousand pixels wide.
 */
export function isVioletTinted(hex: string): boolean {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return false;
  const [r, g, b] = m.slice(1).map((c) => parseInt(c, 16));
  return r > g && b > g;
}

const chrome = read("src", "design", "WindowChrome.css");
const tokens = read("src", "design", "tokens-v2.css");
const instrument = read("src", "design", "instrument.css");

describe("#213 B1 — the V2 titlebar grounds on the V2 canvas", () => {
  it("still catches the tint it was written for", () => {
    // The two values, measured rather than described. If this pair ever stops disagreeing the rule
    // below has nothing left to protect and should be deleted, not quietly kept green.
    expect(isVioletTinted("#0c0a14")).toBe(true); // --ix-base under [data-itheme="violet"]
    expect(isVioletTinted("#0a0c10")).toBe(false); // --v2-bg, and the comp's titlebar
    expect(isVioletTinted("#0b0c10")).toBe(false); // the old literal fallback — never the problem
    expect(isVioletTinted("not-a-hex")).toBe(false);
    expect(body("a { color: red; }", "a").trim()).toBe("color: red;");
  });

  it("the violet theme really does tint the legacy base — the premise, not an assumption", () => {
    const violet = body(instrument, ':root[data-itheme="violet"]');
    const base = /--ix-base:\s*(#[0-9a-f]{6})/i.exec(violet)?.[1];
    expect(base, "instrument.css no longer sets --ix-base under the violet theme").toBeTruthy();
    expect(
      isVioletTinted(base!),
      `the violet theme's --ix-base is ${base}, which is no longer violet-tinted — if that was ` +
        `deliberate, this guard's reason for existing changed and the comment above is now wrong.`,
    ).toBe(true);
  });

  it("--v2-bg, the comp's sampled titlebar value, is not tinted", () => {
    const v2 = body(tokens, ':root[data-v2="on"]');
    const bg = /--v2-bg:\s*(#[0-9a-f]{6})/i.exec(v2)?.[1];
    expect(bg?.toLowerCase(), "the comp was sampled at #0a0c10 along y=20").toBe("#0a0c10");
    expect(isVioletTinted(bg!)).toBe(false);
  });

  it("the V2 titlebar takes --v2-bg and a --v2 hairline", () => {
    const bar = body(chrome, ':root[data-v2="on"] .wc-bar');
    expect(bar, "no [data-v2=on] .wc-bar rule — the titlebar is back on the theme base").toBeTruthy();
    expect(bar).toMatch(/background:\s*var\(--v2-bg\)/);
    expect(bar).toMatch(/border-bottom:[^;]*var\(--v2-line\)/);
  });

  it("no --ix-* colour reaches the V2 titlebar — that is how the two systems met", () => {
    const bar = body(chrome, ':root[data-v2="on"] .wc-bar');
    const leaked = [...bar.matchAll(/var\((--ix-[\w-]+)/g)].map((m) => m[1]);
    expect(
      leaked,
      `the V2 titlebar consumes ${leaked.join(", ")}. The legacy instrument tokens follow ` +
        `[data-itheme] and V2 surfaces do not, so any one of them reopens the seam at y=34.`,
    ).toEqual([]);
  });

  it("the flag-off rule is untouched, so V2-off stays byte-identical", () => {
    // tokens-v2's contract: every V2 selector is scoped, and the unscoped rule keeps its old value.
    const legacy = body(chrome, ".wc-bar");
    expect(legacy, ".wc-bar's base rule vanished — flag-off byte identity is the point of scoping").toBeTruthy();
    expect(legacy).toMatch(/background:\s*var\(--ix-base,\s*#0b0c10\)/);
  });
});
