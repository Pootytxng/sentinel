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
