import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * bug→guard (self-review round 2, issue #49, 2026-08-23).
 *
 * The HUD readout is fixed to the VIEWPORT and paints an OPAQUE ground (intimidation pass,
 * 2026-08-20). Its clearance was `padding-bottom` on the scroll lane — and padding only clears the
 * END of a document, never the band a viewport-fixed element occupies at an arbitrary scroll
 * offset. On Health that curtain covered real readings at rest: READINESS / AVG FPS at 1280×720,
 * the Detected record's Processor row at 1500×980 (the owner's actual viewport). A covered reading
 * reads as an absent one, so this is an honest-measurement failure, not a cosmetic one.
 *
 * The rule this pins: while the frame is mounted, the scroll lane must be SHORTENED (margin) by at
 * least the band the readout occupies — not merely padded. Layout cannot be measured in jsdom, so
 * the guard checks the geometry the stylesheet declares, which is where the defect actually lived.
 */

const CSS = readFileSync(join("src", "design", "console", "hud-frame.css"), "utf8");
const TYPE = readFileSync(join("src", "design", "type-scale.css"), "utf8");

/** Value of one declaration inside the first rule whose selector contains `selector`. */
function decl(css: string, selector: string, prop: string): string | null {
  const at = css.indexOf(selector);
  if (at < 0) return null;
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  if (open < 0 || close < 0) return null;
  const body = css.slice(open + 1, close);
  const m = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "m").exec(body);
  return m ? m[1].trim() : null;
}

const px = (v: string | null): number | null => {
  if (v == null) return null;
  const m = /(-?\d+(?:\.\d+)?)px/.exec(v);
  return m ? Number(m[1]) : null;
};

describe("HUD readout clearance reserves its band instead of painting over it", () => {
  // The band the readout occupies, measured off the stylesheet's own numbers.
  const frameBottomInset = px(decl(CSS, ".hud-frame {", "inset")?.split(/\s+/).slice(-1)[0] ?? null);
  const readoutBottom = px(decl(CSS, ".hud-frame-readout", "bottom"));
  const readoutPad = decl(CSS, ".hud-frame-readout", "padding");
  const labelPx = px(decl(TYPE, ":root", "--type-label")) ?? px(TYPE.match(/--type-label:[^;]+/)?.[0] ?? null);

  it("still declares the geometry this guard reasons about", () => {
    expect(frameBottomInset).not.toBeNull();
    expect(readoutBottom).not.toBeNull();
    expect(readoutPad).not.toBeNull();
    expect(labelPx).not.toBeNull();
    // The reasoning only holds while the readout is viewport-fixed chrome over the scroll lane.
    expect(decl(CSS, ".hud-frame {", "position")).toBe("fixed");
    expect(decl(CSS, ".hud-frame-readout", "position")).toBe("absolute");
  });

  it("shortens the scroll lane with a margin — padding cannot clear a viewport-fixed band", () => {
    const marginBottom = px(decl(CSS, ".v2-shell-hud .v2-content", "margin-bottom"));

    expect(
      marginBottom,
      "the .v2-shell-hud .v2-content clearance must be a margin-bottom: padding only clears the " +
        "END of the document, so a viewport-fixed readout still paints over whatever sits in its " +
        "band at scrollTop 0 on any page taller than the window (issue #49 round 2).",
    ).not.toBeNull();

    const padTop = px(readoutPad!.split(/\s+/)[0]);
    const padBottom = px(readoutPad!.split(/\s+/)[2] ?? readoutPad!.split(/\s+/)[0]);
    const lineBox = Math.ceil(labelPx! * 1.4); // no line-height is declared: the UA/body value rounds up
    const band = frameBottomInset! + readoutBottom! + padTop! + padBottom! + lineBox;

    expect(
      marginBottom!,
      `the reserved band (${marginBottom}px) is smaller than the one the readout occupies ` +
        `(${band}px = frame inset ${frameBottomInset} + bottom ${readoutBottom} + padding ` +
        `${padTop}/${padBottom} + line box ${lineBox}). Content would render underneath it.`,
    ).toBeGreaterThanOrEqual(band);
  });
});
