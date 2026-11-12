import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// bug→guard (self-reviewer catches, 2026-07-11, consumer-panel train): <Term> inside an uppercase
// micro-label context (ArcGauge) rendered mixed-case (button UA stylesheet forces
// text-transform:none) while its TOOLTIP inherited the ancestor's uppercase and shouted its
// sentence in all-caps; and a right-edge Term's left-anchored popover rendered past the window.
// jsdom can't compute UA-stylesheet cascade, so pin the declarations themselves (the same
// declaration-pin pattern as the oscilloscope line-discipline guard).

const css = readFileSync(join("src", "design", "Term.css"), "utf8");

const block = (selector: string): string => {
  const m = css.match(new RegExp(`${selector.replace(/[.\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? "";
};

describe("Term.css style guards", () => {
  it("the trigger inherits the ancestor's text-transform (uppercase contexts stay uppercase)", () => {
    expect(block(".kl-term")).toMatch(/text-transform:\s*inherit/);
  });

  it("the tooltip never inherits uppercase — it's a sentence, not a label", () => {
    expect(block(".kl-tip")).toMatch(/text-transform:\s*none/);
    expect(block(".kl-tip")).toMatch(/letter-spacing:\s*normal/);
  });

  it("right-edge anchoring exists for Terms near the window's right side", () => {
    expect(block(".kl-tip-end")).toMatch(/right:\s*0/);
    expect(block(".kl-tip-end")).toMatch(/left:\s*auto/);
  });
});

// bug→guard (desk review 2026-11-10, CR-tip-see-through): the tip's ground was --panel-2, which the
// glass rooms re-point to rgba(glass, 0.74) on Glass and 0.9 on Frosted, so the Live readings under
// the "combined effect" tip showed through its text. Resolve the tip's ground token through every
// sheet that defines it (each theme, surface and room re-point) and require every definition to be
// at least 0.96 opaque.
describe("Term tip ground hides what is under it", () => {
  const sheets = [
    ["src", "App.css"],
    ["src", "design", "tokens-v2.css"],
    ["src", "surfaces", "monitor-v2.css"],
    ["src", "surfaces", "lab-v2.css"],
    ["src", "surfaces", "blackbook-v2.css"],
  ].map((p) => readFileSync(join(...p), "utf8"));

  const definitions = (name: string): string[] => {
    const out: string[] = [];
    const re = new RegExp(`(?<![\\w-])${name.replace(/-/g, "\\-")}\\s*:\\s*([^;]+);`, "g");
    for (const sheet of sheets) for (const m of sheet.matchAll(re)) out.push(m[1].trim());
    return out;
  };

  // Every alpha a token can take, following var() re-points. A hex or rgb() ground is opaque.
  const alphas = (value: string, depth = 0): number[] => {
    expect(depth, `token chain too deep at ${value}`).toBeLessThan(6);
    const v = value.trim();
    const ref = v.match(/^var\(\s*(--[\w-]+)/);
    if (ref) {
      const defs = definitions(ref[1]);
      expect(defs.length, `${ref[1]} must be defined in a token sheet`).toBeGreaterThan(0);
      return defs.flatMap((d) => alphas(d, depth + 1));
    }
    if (/^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(v)) return [1];
    const rgba = v.match(/^rgba\((.*),\s*([\d.]+)\s*\)$/);
    if (rgba) return [Number(rgba[2])];
    if (/^rgb\(/.test(v)) return [1];
    throw new Error(`tip ground value not understood: ${v}`);
  };

  it("every definition of the tip's ground token is at least 0.96 opaque", () => {
    // The first var() is the ground V2 paints (main.tsx sets data-v2="on" unconditionally).
    const bg = block(".kl-tip").match(/^\s*background:\s*([^;]+);/m)?.[1] ?? "";
    expect(bg, ".kl-tip must paint a background").not.toBe("");
    const found = alphas(bg);
    expect(found.length).toBeGreaterThan(0);
    expect(Math.min(...found)).toBeGreaterThanOrEqual(0.96);
  });

  // bug→guard (self-review FAIL of installed a15986b8, 2026-11-11, CR-tip-see-through-2): the ground
  // computed 0.96, yet the Live readings still showed through the tip's text, because the Term sat
  // inside `.mc-delta-tag { opacity: .85 }`. An ancestor's opacity fades the whole subtree, the open
  // tip included, and makes a stacking context later siblings paint over. No rule for the Live
  // room's Term wrapper may set opacity.
  it("the Live room's combined-effect Term sits in no faded ancestor", () => {
    const tsx = readFileSync(join("src", "surfaces", "MonitorConsole.tsx"), "utf8");
    const at = tsx.indexOf('t("monitor.monitorConsole.combinedEffectTooltip")');
    expect(at, "the combined-effect Term is still in MonitorConsole.tsx").toBeGreaterThan(0);
    const wrappers = [...tsx.slice(0, at).matchAll(/className="([\w-]+)"/g)].map((m) => m[1]).slice(-3);
    expect(wrappers).toContain("mc-delta-tag");
    const sheet = readFileSync(join("src", "surfaces", "monitor-console.css"), "utf8");
    for (const cls of wrappers) {
      for (const m of sheet.matchAll(new RegExp(`\\.${cls}(?![\\w-])[^{,]*\\{([^}]*)\\}`, "g"))) {
        expect(m[1], `.${cls} must not set opacity (it fades the open tip)`).not.toMatch(/(^|[;\s])opacity\s*:/);
      }
    }
  });
});
