import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — same CSS-text-invariant grep pattern as
//  border-hygiene-guard / theme-literal-guard.)

// bug→guard (owner de-slop catch 2026-07-08): the Home priority-queue tags shipped as filled,
// uppercase, amber-warn ALERT badges ("BIGGEST LIMITER" / "MEDIUM CONFIDENCE") — the exact loud
// AI-slop pattern the de-slop directive retired everywhere else. They must stay QUIET mono
// readout tags: no uppercase, no fill, no warn/ok/info color fill. This pins the class so it
// can't creep back.
describe("HomeHud priority-queue tags stay quiet, never loud alert badges", () => {
  const css = readFileSync(join("src", "surfaces", "home-hud.css"), "utf8");

  // Isolate the .hud-pill rule blocks (base + tone variants) from the rest of the file.
  const pillBlocks = [...css.matchAll(/\.hud-pill[^{]*\{([^}]*)\}/g)].map((m) => m[0]);

  it("finds the pill rules (guard is wired to the real selectors)", () => {
    expect(pillBlocks.length).toBeGreaterThanOrEqual(2);
  });

  it("no uppercase shout on the tags", () => {
    for (const block of pillBlocks) {
      expect(block).not.toMatch(/text-transform\s*:\s*uppercase/);
    }
  });

  it("no filled badge background (transparent/none only — never a warn/ok/info fill)", () => {
    for (const block of pillBlocks) {
      // A `background` other than `none` is a filled badge. `background: none` is allowed.
      const bg = block.match(/background\s*:\s*([^;]+);/);
      if (bg) expect(bg[1].trim()).toBe("none");
      // The amber alert color must not be the tag's text or fill.
      expect(block).not.toMatch(/--v2-warn/);
    }
  });
});
