import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// ONE HERO PER GRID — the bento's single load-bearing rule, mechanized instead of written down
// (toolchain-over-prose law).
//
// WHY THIS GUARD EXISTS. A bento grid is a set of DELIBERATELY unequal tiles, so the eye is told
// where to start. It fails in exactly one way: every tile the same size, which is the standing
// tester complaint ("Compy is overwhelming to navigate") wearing a nicer outfit. That failure never
// arrives as a decision — it arrives one honest edit at a time, each promoting one more tile
// because that section also matters. So the rule is pinned here: every <BentoGrid> block in the app
// carries EXACTLY ONE tile with span="hero", and every span is a literal a reader can see.
//
// WHY SPANS MUST BE LITERAL. `span={someExpr}` would make the hero count unknowable without running
// the app, which is the same as having no rule at all. A conditional hero is also a real design
// bug, not just a testing inconvenience: whether the room has a focal point would depend on runtime
// state, so on some machines Home would open with no answer in the biggest box.

const SRC = "src";

/** Every .tsx under src/, so a new room can never quietly opt out of the rule. */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith(".tsx") && !entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

/**
 * The source slices between each `<BentoGrid` and its matching `</BentoGrid>`. Text-level on
 * purpose: this guard has to hold for a file that does not compile or render yet, which is exactly
 * when a hero gets duplicated.
 */
function bentoBlocks(src: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const open = src.indexOf("<BentoGrid", from);
    if (open === -1) break;
    const close = src.indexOf("</BentoGrid>", open);
    // An unclosed <BentoGrid> is its own failure — take the rest of the file so the tiles inside
    // it are still counted rather than silently skipped.
    const end = close === -1 ? src.length : close;
    blocks.push(src.slice(open, end));
    from = end + 1;
  }
  return blocks;
}

const files = tsxFiles(SRC).map((path) => ({ path, src: readFileSync(path, "utf8") }));
const withBento = files.filter((f) => f.src.includes("<BentoGrid"));

describe("bento: one hero per grid", () => {
  it("at least one room actually uses the grid (the guard is not vacuously green)", () => {
    expect(withBento.length).toBeGreaterThan(0);
  });

  it.each(withBento.map((f) => f.path))("%s — every <BentoGrid> has exactly one hero", (path) => {
    const src = files.find((f) => f.path === path)!.src;
    for (const [i, block] of bentoBlocks(src).entries()) {
      const heroes = block.match(/span=["']hero["']/g) ?? [];
      expect(
        heroes.length,
        `${path}: <BentoGrid> #${i + 1} has ${heroes.length} hero tiles, expected exactly 1`,
      ).toBe(1);
    }
  });

  // NO CONDITIONAL PARTIAL TILE — the hole defect, mechanized (self-review 2026-08-12, Home).
  //
  // The grid is strict row-major with NO `grid-auto-flow: dense`, deliberately: a mis-sized tile
  // must show as a visible hole rather than be silently shuffled somewhere it doesn't belong. The
  // cost of that choice is that a tile which sometimes doesn't render leaves its slot EMPTY. Home
  // shipped exactly that — a conditional half-width "Findings" tile under a two-row hero — and on
  // a clean PC the room opened with a ~180px dark rectangle at every width.
  //
  // A FULL-width tile is exempt because it cannot leave a partial row behind: it always starts a
  // row, so when it doesn't render, the tiles after it simply move up a row intact.
  //
  // The fix a failure here is asking for is a tile that ALWAYS renders and carries an honest empty
  // state — not a tile that vanishes, and not `dense`.
  it.each(withBento.map((f) => f.path))("%s — no conditional partial tile", (path) => {
    const src = files.find((f) => f.path === path)!.src;
    for (const block of bentoBlocks(src)) {
      // The JSX conditional forms that render a tile: `cond && (<BentoTile`, `cond && <BentoTile`,
      // and `cond ? (<BentoTile`. A JSX comment may sit between the guard and the tag.
      const guarded = /(?:&&|\?)\s*\(?\s*(?:\{\/\*[\s\S]*?\*\/\}\s*)?<BentoTile[^>]*>/g;
      for (const [tag] of block.matchAll(guarded)) {
        expect(
          tag,
          `${path}: a conditionally-rendered <BentoTile> must be span="full" — a partial-width ` +
            `tile that sometimes doesn't render leaves a hole in its row. Give it an always-` +
            `rendering empty state instead.`,
        ).toMatch(/span=["']full["']/);
      }
    }
  });

  it.each(withBento.map((f) => f.path))("%s — no computed span", (path) => {
    const src = files.find((f) => f.path === path)!.src;
    for (const block of bentoBlocks(src)) {
      // `span={"hero"}` is computed as far as a reader scanning the file is concerned, and it is
      // one keystroke from `span={cond ? "hero" : "half"}`. Literals only.
      expect(block, `${path}: BentoTile span must be a literal string, not an expression`).not.toMatch(
        /\bspan=\{/,
      );
    }
  });
});
