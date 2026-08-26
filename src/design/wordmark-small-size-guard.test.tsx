import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { Wordmark } from "./Wordmark";

/**
 * bug→guard (owner report + ruling 2026-08-26, issue #213 A1).
 *
 * The wordmark is "Compy" as ONE word: a pulse-C glyph followed by "ompy". At the rail's 16px the
 * C's 104-unit stroke and the pulse's 58-unit stroke both render under ~2px, and an enclosed mark
 * inside a ring resolves as a single glyph — the product's own name read **"©ompy"**, a copyright
 * symbol standing in front of it. The reported defect was the logo, which the taste decree reserves
 * to the owner; he ruled: drop the interior pulse at the sizes where it stops being legible, and
 * leave the approved mark untouched everywhere it is drawn large enough to read.
 *
 * This pins the rule in both directions. A guard that only proves the pulse is gone would pass just
 * as happily if the pulse were deleted outright — which would silently retire the mark he approved.
 */

const SRC = join("src", "design", "Wordmark.tsx");

// Every in-app call site, read from source rather than restated, so a new one cannot appear at a
// size nobody checked. The threshold is a product decision; the sizes are facts about the app.
function callSiteSizes(): { file: string; size: number }[] {
  const files = [
    join("src", "App.tsx"),
    join("src", "design", "ShellV2.tsx"),
    join("src", "surfaces", "FirstCheck.tsx"),
    join("src", "surfaces", "Settings.tsx"),
    join("src", "surfaces", "setup", "SetupTour.tsx"),
  ];
  const found: { file: string; size: number }[] = [];
  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const re = /<Wordmark\s+size=\{(\d+)\}/g;
    for (let m = re.exec(src); m != null; m = re.exec(src)) {
      found.push({ file: f, size: Number(m[1]) });
    }
  }
  return found;
}

const pulseOf = (size: number) =>
  render(<Wordmark size={size} />).container.querySelector("polyline");

describe("the wordmark drops its interior pulse at sizes where it reads as ©", () => {
  const threshold = Number(
    /const PULSE_MIN_SIZE = (\d+);/.exec(readFileSync(SRC, "utf8"))?.[1] ?? NaN,
  );

  it("declares a threshold at all (the source pin has not rotted)", () => {
    expect(Number.isFinite(threshold)).toBe(true);
    expect(threshold).toBeGreaterThan(16); // must at least cover the rail, the reported defect
    expect(threshold).toBeLessThanOrEqual(30); // must not cover every size — that deletes the mark
  });

  it("the rail's 16px draws NO pulse — this is the reported defect", () => {
    expect(pulseOf(16)).toBeNull();
  });

  it("one pixel under the threshold draws no pulse; at the threshold it does", () => {
    // The boundary itself, both sides. An off-by-one here is the difference between honouring the
    // ruling and quietly applying it one size too far.
    expect(pulseOf(threshold - 1)).toBeNull();
    expect(pulseOf(threshold)).not.toBeNull();
  });

  it("a large mark still draws the FULL approved glyph, pulse included", () => {
    const big = render(<Wordmark size={48} />).container;
    const pulse = big.querySelector("polyline");
    expect(pulse).not.toBeNull();
    // Geometry unchanged — the ruling was "don't draw it when tiny", never "redraw it".
    expect(pulse!.getAttribute("points")).toBe(
      "360,512 424,512 460,434 514,594 556,470 602,512 648,512",
    );
    expect(pulse!.getAttribute("stroke-width")).toBe("58");
  });

  it("the C is drawn at EVERY size — dropping the pulse must never drop the letter", () => {
    for (const size of [12, 16, 19, 24, 30, 48]) {
      const c = render(<Wordmark size={size} />).container.querySelector("path");
      expect(c, `no C at ${size}px`).not.toBeNull();
      expect(c!.getAttribute("stroke-width")).toBe("104");
    }
  });

  it("reads as one word at every size — the C is followed by 'ompy', never a second name", () => {
    for (const size of [16, 24, 48]) {
      const el = render(<Wordmark size={size} />).container.querySelector(".cmp-wordmark");
      expect(el?.textContent).toBe("ompy");
      expect(el?.getAttribute("aria-label")).toBe("Compy");
    }
  });

  it("names every in-app call site's size, so a new one cannot land unchecked", () => {
    const sizes = callSiteSizes();
    // Non-vacuity: if the regex stops matching, the assertions below prove nothing.
    expect(sizes.length).toBeGreaterThanOrEqual(5);
    // Each call site is either above the threshold (full mark) or below it (C only). There is no
    // third outcome — this exists to make a future size a deliberate choice, not an accident.
    for (const { file, size } of sizes) {
      const drawn = pulseOf(size) != null;
      expect(drawn, `${file} @ ${size}px`).toBe(size >= threshold);
    }
  });
});
