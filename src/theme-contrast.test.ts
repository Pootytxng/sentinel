import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Legibility guard — codifies the contrast floor for every Instrument theme so a live theme tune
// (e.g. Ember's candlelight) can't silently make text unreadable. Reads the real token values from
// instrument.css and computes WCAG contrast of each text token against the canvas base AND the
// composited glass-panel background. Same spirit as sweep-guard.test.ts: a design law, enforced.
//
// Floors: primary/secondary/accent text must clear WCAG AA body (4.5:1); the deliberately-muted
// tertiary token (captions/units) must clear AA-large (3:1). If you tune a theme below these, fix the
// hex — don't lower the floor.

// Strip comments first — some contain semicolons (e.g. "adopt later; NOT forced…") which would
// otherwise break the naive declaration split.
const css = readFileSync(join("src", "design", "instrument.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

function decls(selector: string): Record<string, string> {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(esc + "\\s*\\{([^}]*)\\}"));
  const out: Record<string, string> = {};
  if (m) {
    for (const decl of m[1].split(";")) {
      const i = decl.indexOf(":");
      if (i > 0) out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  }
  return out;
}

type RGB = { r: number; g: number; b: number };

function parseHex(hex: string): RGB {
  const m = hex.trim().replace("#", "");
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
}

// glass-fill is rgba(r,g,b,a) over the base — composite to an opaque colour for the contrast check.
function compositeRgba(rgba: string, base: RGB): RGB {
  const m = rgba.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`not an rgba: ${rgba}`);
  const [r, g, b, a = 1] = m[1].split(",").map((s) => parseFloat(s.trim()));
  return {
    r: Math.round(r * a + base.r * (1 - a)),
    g: Math.round(g * a + base.g * (1 - a)),
    b: Math.round(b * a + base.b * (1 - a)),
  };
}

function luminance({ r, g, b }: RGB): number {
  const lin = (c: number) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(fg: RGB, bg: RGB): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const root = decls(":root");
const THEMES = ["halfway", "midnight", "hearth"];

describe("theme contrast (legibility guard)", () => {
  it(":root defaults parsed (guards the inherited tokens)", () => {
    // velocity/nova inherit text-2/-3 + glass-fill from :root; if the :root parse breaks, those
    // would be undefined and the per-theme checks would validate nothing meaningful.
    expect(root).toHaveProperty("--ix-glass-fill");
    expect(root).toHaveProperty("--ix-text-2");
    expect(root).toHaveProperty("--ix-base");
  });

  for (const theme of THEMES) {
    it(`${theme}: text tokens clear the contrast floor on base + glass`, () => {
      const themeTokens = decls(`:root[data-itheme="${theme}"]`);
      // Guard the guard: if a selector reformat stops this matching, we'd silently fall back to the
      // :root defaults and validate the wrong theme. Every theme block defines its own accent-text.
      expect(
        themeTokens,
        `:root[data-itheme="${theme}"] did not match — selector format changed?`,
      ).toHaveProperty("--ix-accent-text");
      const t = { ...root, ...themeTokens };
      const base = parseHex(t["--ix-base"]);
      const glass = compositeRgba(t["--ix-glass-fill"], base);

      const checks: [string, RGB, number][] = [
        ["--ix-text-1", parseHex(t["--ix-text-1"]), 4.5],
        ["--ix-text-2", parseHex(t["--ix-text-2"]), 4.5],
        ["--ix-accent-text", parseHex(t["--ix-accent-text"]), 4.5],
        ["--ix-text-3", parseHex(t["--ix-text-3"]), 3.0], // muted captions → AA-large
      ];

      for (const [name, fg, floor] of checks) {
        for (const [bgName, bg] of [
          ["base", base],
          ["glass", glass],
        ] as const) {
          const ratio = contrast(fg, bg);
          expect(
            ratio,
            `${theme} ${name} on ${bgName} = ${ratio.toFixed(2)} (floor ${floor})`,
          ).toBeGreaterThanOrEqual(floor);
        }
      }

      // Label-on-accent: dark ink on the bright accent fill must be readable. This was the guard's
      // blind spot — it only checked text-on-backgrounds, which is what let white-on-mint ship.
      const inkRatio = contrast(parseHex(t["--ix-accent-ink"]), parseHex(t["--ix-accent"]));
      expect(
        inkRatio,
        `${theme} accent-ink on accent = ${inkRatio.toFixed(2)} (floor 4.5)`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});
