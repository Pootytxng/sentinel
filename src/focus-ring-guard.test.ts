import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// bug→guard (self-review round 10, 2026-07-29). Home's intent rows shipped with keyboard focus
// INVISIBLE: `.hc-intake-row:hover, .hc-intake-row:focus-visible { background: …; outline: none; }`
// — one rule for both states, so a tabbing user got exactly the faint wash a mouse hover gives and
// nothing else, while every other focusable control on Home/Lab drew a real ring. Green tsc/vitest
// saw none of it (jsdom applies no stylesheets), and the reviewer had to measure it live.
//
// The class, not the instance: killing the default outline is FINE when the rule replaces it with
// another mark — `border-color: var(--accent)` on a field, a `box-shadow` ring, a different
// `outline`. It is NOT fine to replace it with `background` alone, because background is what
// hover already spends; the two states become indistinguishable to anyone not holding a mouse.

const CSS_ROOT = join("src");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? cssFiles(p) : p.endsWith(".css") ? [p] : [];
  });
}

// Flat { selector, body } rules. Nested at-rules (@media) leave their wrapper as a stray "rule"
// with a body of "" — harmless here, since we only look at bodies that declare `outline: none`.
function rules(css: string): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  while ((m = re.exec(stripped))) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
}

const KILLS_OUTLINE = /outline\s*:\s*(none|0)\b/;
// An acceptable stand-in mark. `background` is deliberately absent — that's the footgun.
//
// The lookahead sits directly after the colon, NOT after `\s*`. Written the other way round
// (`outline\s*:\s*(?!none|0\b)`) the `\s*` backtracks to zero width and the lookahead then inspects
// the SPACE rather than the value — so `outline: none` read as an acceptable replacement mark and
// exempted itself. Every rule this guard exists to flag is written with that space, so the class
// sweep passed on all of them; only the `outline:none` form nobody writes was ever caught. Found by
// mutation-testing the guard rather than the code (2026-08-10).
const REPLACEMENT_MARK = /(border-color\s*:|box-shadow\s*:|outline\s*:(?!\s*(?:none|0)\b))/;

describe("focus-visible must stay visible", () => {
  const offenders: string[] = [];
  for (const file of cssFiles(CSS_ROOT)) {
    for (const r of rules(readFileSync(file, "utf8"))) {
      if (!/:focus-visible/.test(r.sel)) continue;
      if (!KILLS_OUTLINE.test(r.body)) continue;
      if (REPLACEMENT_MARK.test(r.body)) continue;
      offenders.push(`${file}: ${r.sel}`);
    }
  }

  it("no :focus-visible rule removes the outline without leaving another focus mark", () => {
    expect(
      offenders,
      "these rules kill the focus outline and put nothing visible in its place " +
        "(a background tint does not count — hover already spends it)",
    ).toEqual([]);
  });

  // The instance that produced this guard was `.hc-intake-row`, Home's intent rows. That band was
  // deleted on 2026-08-20 (issue #177) and the interview replaced it — so the case follows the
  // AFFORDANCE, not the dead class name. `.hi-answer` is the same thing wearing a new name: the
  // full-width clickable row a keyboard user tabs through, in the one place on Home where tabbing
  // is the whole interaction. Retiring the case with the class would have quietly dropped the
  // guard at the exact moment the shape came back.
  const rowLike: [string, string][] = [
    [".hi-answer", join("src", "surfaces", "home-interview.css")],
    [".hc-front-door", join("src", "surfaces", "home-console.css")],
  ];
  for (const [sel, file] of rowLike) {
    it(`${sel} draws a real ring, not just the hover tint`, () => {
      const css = readFileSync(file, "utf8");
      const esc = sel.replace(".", "\.");
      const focus = rules(css).find(
        (r) => new RegExp(`${esc}[^,{]*:focus-visible`).test(r.sel) && !/:hover/.test(r.sel),
      );
      expect(focus, `${sel} needs its OWN :focus-visible rule, separate from :hover`).toBeTruthy();
      expect(focus!.body).toMatch(/outline\s*:\s*\d/);
      expect(focus!.body).not.toMatch(KILLS_OUTLINE);
    });
  }
});
