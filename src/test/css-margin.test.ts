import { describe, expect, it } from "vitest";
import { declarations, leftMarginIsAuto, marginShorthandLeft, marginInlineStart, valueTokens } from "./css-margin";

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

// bug→guard — #240. `declarations()` split on `;` and found the property with `indexOf(":")`
// without stripping comments first. A CSS comment fused against or straddling a declaration was
// read as part of the property name (or split the block on a `;`/`:` that was only comment text),
// so a genuine `margin-left: auto` push silently vanished. FALSE NEGATIVE — the dangerous direction
// for a guard meant to catch a real layout push. `declarations()` is comment-safe on its own now,
// independent of what a caller does first.
describe("declarations() is comment-aware — #240", () => {
  it("does not drop a push hidden behind a leading, fused block comment", () => {
    expect(leftMarginIsAuto("/* push right */margin-left: auto").auto).toBe(true);
  });

  it("does not let a comment's own `:` or `;` corrupt the declarations around it", () => {
    // the comment's internal colon must not become the property/value split
    expect(leftMarginIsAuto("/* x:y;z */ margin-left: auto").auto).toBe(true);
    // the comment's internal semicolon must not become a declaration boundary
    expect(leftMarginIsAuto("margin-right: 0; /* x:y;z */ margin-left: auto").auto).toBe(true);
  });

  it("does not misread a comment sitting between the property and its colon", () => {
    expect(leftMarginIsAuto("margin-left/* c */: auto").auto).toBe(true);
  });

  it("removes a comment inside a shorthand without shifting which token is the left component", () => {
    // positive control: once the comments are gone, `auto` really is the 4th (left) token
    expect(leftMarginIsAuto("margin: 0 /*c*/ 0 /*c*/ 0 /*c*/ auto").auto).toBe(true);
    // negative control: `auto` is the 2nd (right) token — removing the comments must not push it left
    expect(leftMarginIsAuto("margin: 0 /*c*/ auto /*c*/ 0 /*c*/ 0").auto).toBe(false);
  });

  it("treats a removed comment as token separation, not fusion, between adjacent tokens", () => {
    // zero surrounding whitespace: "0" and "auto" must not collapse into one token "0auto"
    expect(leftMarginIsAuto("margin:0/**/auto").auto).toBe(true);
  });

  it("a comment-lookalike inside a quoted string is not read as a real comment start — PR #268 review", () => {
    // an unterminated "comment" (no real */ ever appears) must not consume the real declaration
    // that follows it, nor everything up to some unrelated later */ elsewhere in the block
    expect(leftMarginIsAuto('content: "/*"; margin-left: auto').auto).toBe(true);
    // a quoted string that itself contains a literal */ must not falsely CLOSE a real comment early
    expect(leftMarginIsAuto('content: "/*"; margin-left: auto; --end: "*/"').auto).toBe(true);
    // a genuine comment alongside an unrelated quoted string is still stripped correctly
    expect(leftMarginIsAuto('content: "x"; /* real comment */ margin-left: auto').auto).toBe(true);
  });
});

// bug→guard — the THIRD defect in the same reasoning, and the one the two above walked past.
//
// `stripComments()` is quote-aware. Both guards' `rulesFromCss` walkers are quote-aware. The split
// that sat BETWEEN them was `.split(";")` and `indexOf(":")`, which are not. The mismatch survived
// three independent reviews of PR #268 because the hard part looked solved, so nobody re-read the
// easy part. These are the two shapes it got wrong, reproduced against the unchanged file before
// the repair existed — one in each direction, which is what makes it a defect rather than a
// preference: the guard both MISSED a real push and INVENTED one.
describe("declarations() splits only OUTSIDE protected syntax — #274", () => {
  it("a `;` inside a quoted value does not end the declaration and hide a real push", () => {
    // FALSE NEGATIVE: `margin-left: auto` is really declared. The quoted text used to close the
    // declaration early and hand back `margin-left: 0` as a later, winning declaration.
    expect(leftMarginIsAuto('margin-left: auto; content: "; margin-left: 0;"').auto).toBe(true);
  });

  it("a `margin-left` written inside a quoted string is not read as a declaration", () => {
    // FALSE POSITIVE: nothing here pushes anything. A guard that fails this rule fails valid CSS.
    expect(leftMarginIsAuto('content: "; margin-left: auto;"; margin-right: 0').auto).toBe(false);
  });

  it("both quote kinds protect their contents", () => {
    expect(leftMarginIsAuto("margin-left: auto; content: '; margin-left: 0;'").auto).toBe(true);
    expect(leftMarginIsAuto("content: '; margin-left: auto;'; margin-right: 0").auto).toBe(false);
    // and a quote of one kind inside the other is content, not a span boundary
    expect(leftMarginIsAuto("content: '\"; margin-left: auto;'; margin-right: 0").auto).toBe(false);
  });

  it("an escaped quote does not end the string early and expose its contents", () => {
    // the \" is a character; the string runs to the LAST quote, so the pretend declaration inside
    // it is never seen. Read as ending at the escaped quote, `margin-left: auto` becomes real.
    expect(leftMarginIsAuto('content: "a\\"; margin-left: auto;"; margin-right: 0').auto).toBe(false);
    // the same block with a real push after the string still reports it
    expect(leftMarginIsAuto('content: "a\\"b"; margin-left: auto').auto).toBe(true);
  });

  it("an escaped backslash ends its own escape, so the quote after it still closes the string", () => {
    // `"a\\"` is a COMPLETE string whose content is one backslash — the second `\` is escaped by
    // the first and does not escape the closing quote. What follows is a real declaration.
    expect(leftMarginIsAuto('content: "a\\\\"; margin-left: auto').auto).toBe(true);
  });

  it("a `;` inside a parenthesized value is not a declaration boundary", () => {
    // no quotes involved: an unquoted url() token may legally contain `;`, and data URIs that
    // shape are ordinary shipped CSS.
    const body = "background: url(data:image/png;base64,iVBORw0KGgo=); margin-left: auto";
    expect(leftMarginIsAuto(body).auto).toBe(true);
    const [first] = declarations(body);
    expect(first.prop).toBe("background");
    expect(first.value).toBe("url(data:image/png;base64,iVBORw0KGgo=)");
  });

  it("a margin-shaped fragment inside a parenthesized value cannot override a real push", () => {
    // the constructed verdict-flipping case for the paren half: split naively, `margin-left:0)`
    // becomes a later declaration and wins the cascade against the genuine auto before it.
    expect(leftMarginIsAuto("margin-left: auto; background: url(a;margin-left:0)").auto).toBe(true);
  });

  it("an escaped `;` outside quotes is a character, not a separator", () => {
    expect(leftMarginIsAuto("content: a\\;b; margin-left: auto").auto).toBe(true);
    expect(declarations("content: a\\;b; margin-left: auto")).toHaveLength(2);
  });

  it("a stray `)` does not drive the depth negative and disable every later split", () => {
    // clamping at 0 is what keeps one malformed value from silently switching the rest of the
    // block into one unparsed declaration — which would read as "no push found" everywhere after.
    expect(leftMarginIsAuto("width: calc(1px)); margin-left: auto").auto).toBe(true);
  });

  it("the property/value `:` is the first one outside protected syntax, not the first one", () => {
    // fixing the `;` delimiter does not prove the `:` delimiter. A fragment that is entirely
    // protected text is NOT a declaration; `indexOf(":")` used to manufacture property `"k` from it.
    expect(declarations('"k:v"; margin-left: auto')).toEqual([
      { prop: "margin-left", value: "auto", important: false },
    ]);
    expect(declarations("(a:b); margin-left: auto")).toEqual([
      { prop: "margin-left", value: "auto", important: false },
    ]);
  });

  it("an unterminated quote consumes the rest of the block rather than resyncing inside it", () => {
    // malformed CSS must not be resynchronized into a push the author never wrote — the
    // false-positive direction again, at the edge where the block itself is broken.
    expect(leftMarginIsAuto('margin-right: 0; content: "; margin-left: auto').auto).toBe(false);
  });

  it("everything the earlier defects proved still holds — comments, shorthands, importance, order", () => {
    expect(leftMarginIsAuto("margin:0/**/auto").auto).toBe(true);
    expect(leftMarginIsAuto("margin: auto 0").auto).toBe(false);
    expect(leftMarginIsAuto("margin: 0 auto 0 0").auto).toBe(false);
    expect(leftMarginIsAuto("margin-left: auto; margin: 0").auto).toBe(false);
    expect(leftMarginIsAuto("margin-left: auto !important; margin-left: 0").auto).toBe(true);
    expect(leftMarginIsAuto("margin-left: var(--x)").auto).toBe(false);
  });
});
