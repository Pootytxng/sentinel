// bug→guard for the Codex REJECT of candidate 9bef1cc2 (2026-08-27), finding "1280x720 — major
// acceptance failure": only about two of the six station rows were exposed and the bench readings
// were clipped.
//
// The fix is a height-aware compaction block in lab-console.css. The rejection was explicit about
// the three ways a fit like that can be cheated, and each one is a test below:
//
//   "Do not solve this by hiding controls"                     → no display:none / visibility:hidden
//   "…shrinking text below the established type tokens"        → font-size must be a --type-* token
//   "…or replacing real content with fake fixture values"      → CSS cannot, but `content:` can
//
// And the fourth failure mode, which the rejection named separately: "Avoid an unrestricted
// four-room redesign." Health, Live and History share .v2-verdict, .dock-node, .lc-route and
// .v2-content with Test. A rule in here that forgets its [data-room="lab"] scope silently reshapes
// three rooms nobody reviewed, on every laptop screen, and nothing else would catch it — the other
// rooms' own guards assert what they contain, not how tall they are.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// The compaction is deliberately split across two sheets, and BOTH halves are read here — a check
// that only looked at the room's own sheet would go quietly vacuous the moment a declaration moved.
//   lab-console.css   the air: the aside's share, the lane cushion, the station and strip padding.
//   shell-v2.css      the single headline step. It cannot live with the room, because
//                     comp-fidelity-guard.test.ts refuses to let any room sheet size the four
//                     approved rooms' verdict type — that is measured off the comps in the shell.
const SHEETS = ["src/surfaces/lab-console.css", "src/design/shell-v2.css"] as const;

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const LAB_CSS = strip(readFileSync(resolve(SHEETS[0]), "utf8"));

/** The body of a sheet's short-viewport media query, brace-matched so nested rules survive. */
function compactionBlock(file: string): string {
  const css = strip(readFileSync(resolve(file), "utf8"));
  const at = css.indexOf("@media (max-height: 880px)");
  expect(
    at,
    `${file} has no short-viewport compaction — Test no longer fits a 1280x720 window, which is ` +
      "the viewport the review failed it at",
  ).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", at) + 1, i);
  }
  throw new Error(`unbalanced braces in ${file}`);
}

const BLOCK = SHEETS.map(compactionBlock).join("\n");

/** Every selector the block declares against. */
const SELECTORS = [...BLOCK.matchAll(/([^{}]+)\{/g)].map((m) => m[1].trim()).filter(Boolean);

describe("the short-viewport compaction fits Test without cheating, and touches only Test", () => {
  it("declares against something", () => {
    expect(SELECTORS.length).toBeGreaterThan(4);
  });

  it("scopes every rule to the Test room", () => {
    for (const sel of SELECTORS) {
      expect(
        sel,
        `"${sel}" compacts a shared class with no [data-room="lab"] scope — that reshapes Health, ` +
          `Live and History on every short screen, which is the four-room redesign the review ruled out`,
      ).toMatch(/\[data-room="lab"\]/);
    }
  });

  it("hides no control", () => {
    expect(BLOCK).not.toMatch(/display:\s*none/);
    expect(BLOCK).not.toMatch(/visibility:\s*hidden/);
    // A capped height with the overflow clipped is hiding by another name: the row is still in the
    // tree and still fails the "Add a part visible and reachable" requirement.
    expect(BLOCK).not.toMatch(/overflow[^:]*:\s*hidden/);
    expect(BLOCK).not.toMatch(/max-height:\s*\d/);
  });

  it("steps type only onto an established token, never to a smaller literal", () => {
    for (const decl of BLOCK.match(/font-size:[^;]+;/g) ?? []) {
      expect(
        decl,
        "a px font-size here is 'shrinking text below the established type tokens' — the only " +
          "sanctioned step is the one headline-fit.ts already takes, to --type-verdict",
      ).toMatch(/var\(--type-[a-z]+\)/);
    }
  });

  it("substitutes no content", () => {
    // `content:` in a compaction block would mean a label got swapped for a shorter stand-in. That
    // is the "fake fixture values" clause, and it is the one cheat that would still look correct.
    expect(BLOCK).not.toMatch(/[^-]content:/);
  });

  it("widens the narrative column by giving back aside share, not by clipping it", () => {
    expect(BLOCK).toMatch(/--v2-aside:\s*min\(\s*680px\s*,\s*47%\s*\)/);
  });

  it("leaves 1500x980 and 1920x1080 outside the query", () => {
    const bp = Number(
      /max-height:\s*(\d+)px/.exec(LAB_CSS.slice(LAB_CSS.indexOf("@media (max-height")))![1],
    );
    expect(bp, "980 is the height every approved comp was drawn at — it must not compact").toBeLessThan(980);
    expect(bp, "…but 720 must").toBeGreaterThanOrEqual(720);
  });
});
