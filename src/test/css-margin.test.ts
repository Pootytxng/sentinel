import { describe, expect, it } from "vitest";
import { leftMarginIsAuto, marginShorthandLeft, marginInlineStart, valueTokens } from "./css-margin";

// bug→guard — the SECOND defect in issue #236's guards, caught in independent review.
//
// THE DEFECT. Both layout guards asked "does this rule push its subject right?" with, in effect,
// `/margin\s*:\s*[^;]*\bauto\b/` — the word `auto` anywhere in a `margin` shorthand. The CSS box
// model does not work that way. `margin: auto 0` sets the VERTICAL margins to auto and the
// horizontal ones to 0; `margin: 0 auto 0 0` sets the RIGHT margin to auto and the left to 0.
// Neither moves an element away from the left edge, and both were being reported as if they did.
//
// A guard that fails valid CSS is worse than no guard: the next author deletes a correct
// declaration to get a green run, or deletes the guard. So the shorthand semantics get their own
// focused examples here, one per expansion arity, both directions — a case that MUST fail and a
// case that MUST pass at every arity. `leftMarginIsAuto` is the only margin reasoning either guard
// is allowed to do; if this file is green, the guards are asking the right question.

describe("value tokenizing", () => {
  it("splits on top-level whitespace", () => {
    expect(valueTokens("0 auto 0 0")).toEqual(["0", "auto", "0", "0"]);
  });
  it("keeps a function call as ONE token — `calc(1px + 2px)` is not three values", () => {
    expect(valueTokens("0 calc(1px + 2px)")).toEqual(["0", "calc(1px + 2px)"]);
    expect(valueTokens("var(--a, 1px) auto")).toEqual(["var(--a, 1px)", "auto"]);
  });
});

describe("`margin` shorthand — which token is the LEFT margin", () => {
  it.each([
    ["auto", "auto", "1 value: all four sides"],
    ["0", "0", "1 value: all four sides"],
    ["0 auto", "auto", "2 values: vertical | horizontal"],
    ["auto 0", "0", "2 values: vertical | horizontal — the auto here is VERTICAL"],
    ["0 auto 0", "auto", "3 values: top | horizontal | bottom"],
    ["auto 0 auto", "0", "3 values: the autos here are top and bottom"],
    ["0 0 0 auto", "auto", "4 values: top | right | bottom | LEFT"],
    ["0 auto 0 0", "0", "4 values: that auto is the RIGHT margin"],
  ])("margin: %s -> left is %s (%s)", (value, left) => {
    expect(marginShorthandLeft(value)).toBe(left);
  });
});

describe("`margin-inline` shorthand — start is left in LTR", () => {
  it.each([
    ["auto", "auto"],
    ["auto 0", "auto"],
    ["0 auto", "0"],
  ])("margin-inline: %s -> start is %s", (value, start) => {
    expect(marginInlineStart(value)).toBe(start);
  });
});

describe("leftMarginIsAuto — what the guards actually ask", () => {
  // The cases that MUST be reported. A regression here makes the guards blind to the real defect.
  it.each([
    "margin-left: auto",
    "margin-inline-start: auto",
    "margin: auto",
    "margin: 0 auto",
    "margin: 0 auto 0",
    "margin: 0 0 0 auto",
    "margin-inline: auto",
    "margin-inline: auto 0",
    "display: flex; margin-left: auto; gap: 6px",
    "MARGIN-LEFT: AUTO",
    "margin-left:auto!important",
  ])("pushes: %s", (body) => {
    expect(leftMarginIsAuto(body).auto).toBe(true);
  });

  // The cases that MUST NOT be reported. Every one of these is valid CSS that leaves the element
  // exactly where it was on the left edge, and every one of them failed the shipped guards.
  it.each([
    ["margin: auto 0", "vertical auto, horizontal 0"],
    ["margin: auto 0 auto", "top and bottom auto"],
    ["margin: 0 auto 0 0", "RIGHT auto"],
    ["margin-right: auto", "the opposite side"],
    ["margin-inline-end: auto", "the opposite side, logical"],
    ["margin-top: auto", "a vertical side"],
    ["margin-inline: 0 auto", "inline END auto"],
    ["margin: 0", "no auto at all"],
    ["margin: 0 calc(1px + 2px)", "a function value, not a fourth token"],
    ["margin-left: 0", "explicitly not auto"],
    ["margin-left: var(--x)", "unresolvable is not a proven push"],
    ["margin-left: inherit", "unresolvable is not a proven push"],
    ["width: auto; padding: 0 auto", "`auto` in a property that is not a margin"],
  ])("does not push: %s (%s)", (body) => {
    expect(leftMarginIsAuto(body).auto).toBe(false);
  });

  // Within one block the cascade still applies, and a shorthand RESETS the side it covers.
  it.each([
    ["margin-left: auto; margin: 0", false, "the shorthand clears the earlier push"],
    ["margin: 0; margin-left: auto", true, "the longhand re-adds it"],
    ["margin-left: auto; margin-left: 0", false, "later wins"],
    ["margin-left: auto !important; margin-left: 0", true, "important is not overridden by a normal"],
    ["margin: 0 auto; margin-left: 0", false, "a longhand overrides the shorthand's left"],
  ])("cascade within the block: %s -> %s (%s)", (body, expected) => {
    expect(leftMarginIsAuto(body).auto).toBe(expected);
  });

  it("names the declaration it blames, so a failure is actionable", () => {
    expect(leftMarginIsAuto("display: flex; margin-left: auto").source).toBe("margin-left: auto");
    expect(leftMarginIsAuto("margin: 0 auto").source).toBe("margin: 0 auto");
    expect(leftMarginIsAuto("margin: auto 0").source).toBeNull();
  });
});
