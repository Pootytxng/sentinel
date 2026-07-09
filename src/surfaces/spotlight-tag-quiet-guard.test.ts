import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — same CSS/TSX-text-invariant grep pattern as
//  home-hud-pill-quiet-guard / border-hygiene-guard.)

// bug→guard (owner de-slop catch 2026-07-08, sibling sweep of the Home .hud-pill fix): the
// "#1 BIGGEST LIMITER" spotlight tags on the first-run FirstCheck verdict card and the Setup &
// Tour first-check step shipped as the same loud AI-slop pattern the de-slop directive retired
// on Home — uppercase shout, and on SetupTour an amber-warn color. They must stay QUIET: lowercase
// "biggest limiter", no uppercase text-transform, and no warn-color on the tag. This pins the class.
describe("spotlight #1-limiter tags stay quiet, never loud alert badges", () => {
  const firstCheckTsx = readFileSync(join("src", "surfaces", "FirstCheck.tsx"), "utf8");
  const setupTsx = readFileSync(join("src", "surfaces", "setup", "SetupTour.tsx"), "utf8");
  const firstCheckCss = readFileSync(join("src", "surfaces", "FirstCheck.css"), "utf8");
  const setupCss = readFileSync(join("src", "surfaces", "setup", "SetupTour.css"), "utf8");

  it("no uppercase 'BIGGEST LIMITER' shout in either surface", () => {
    expect(firstCheckTsx).not.toContain("BIGGEST LIMITER");
    expect(setupTsx).not.toContain("BIGGEST LIMITER");
  });

  it("the quiet lowercase tag is actually present (guard wired to the real strings)", () => {
    expect(firstCheckTsx).toContain("biggest limiter");
    expect(setupTsx).toContain("biggest limiter");
  });

  const tagBlock = (css: string, selector: string) => {
    const m = css.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
    if (!m) throw new Error(`selector ${selector} not found`);
    return m[1];
  };

  it("no uppercase text-transform on the tag CSS", () => {
    expect(tagBlock(firstCheckCss, ".fc-spotlight-tag")).not.toMatch(/text-transform\s*:\s*uppercase/);
    expect(tagBlock(setupCss, ".st-spotlight-tag")).not.toMatch(/text-transform\s*:\s*uppercase/);
  });

  it("no amber warn-color on the SetupTour spotlight tag", () => {
    expect(tagBlock(setupCss, ".st-spotlight-tag")).not.toMatch(/--ix-amber/);
  });
});
