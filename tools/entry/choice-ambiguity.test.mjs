// Guard: "either works" has to be true, or it must not be printed.
//
// `resolveChoice` checked list position before issue number. On a menu with at least thirteen rows,
// typing 13 silently selected the thirteenth row rather than issue #13 — two honest readings, one
// picked without saying so, while the menu promised "either works". This is the same class of defect
// as the "18" that would not select: the owner types the number he can see and the launcher does
// something else.
//
// A bare number that names both is now refused with the escape hatch named. `#13` is never
// reinterpreted as a list position, because the prefix is the whole way out.

import { describe, expect, it } from "vitest";
import { ambiguousNumbers, renderMenu, resolveChoice } from "./select.mjs";

const opt = (ordinal, number, label = `task ${number}`) => ({ ordinal, number, label, action: "Start" });

/** Ordinal 2 and issue #2 are different tasks: typing a bare 2 could honestly mean either. */
const COLLIDING = {
  options: [opt(1, 19), opt(2, 41), opt(3, 2)],
  unavailable: [],
};

const CLEAR = { options: [opt(1, 19), opt(2, 41)], unavailable: [] };

describe("a bare number that means two things", () => {
  it("is refused rather than resolved to one of them", () => {
    const r = resolveChoice("2", COLLIDING);
    expect(r.kind).toBe("invalid");
    expect(r.reason).toMatch(/means two things/i);
  });

  it("names both readings and the way out", () => {
    const r = resolveChoice("2", COLLIDING);
    expect(r.reason).toContain("#41"); // list position 2
    expect(r.reason).toContain("#2"); // the issue itself
  });

  it("resolves to the issue when the # says so", () => {
    expect(resolveChoice("#2", COLLIDING)).toMatchObject({ kind: "task", number: 2 });
  });

  it("still resolves the positions that are not ambiguous", () => {
    expect(resolveChoice("1", COLLIDING)).toMatchObject({ kind: "task", number: 19 });
    expect(resolveChoice("3", COLLIDING)).toMatchObject({ kind: "task", number: 2 });
  });

  it("reports exactly which numbers collide", () => {
    expect(ambiguousNumbers(COLLIDING)).toEqual([2]);
    expect(ambiguousNumbers(CLEAR)).toEqual([]);
  });
});

describe("what the menu promises", () => {
  it("says 'either works' only on a menu where it is true", () => {
    expect(renderMenu(CLEAR)).toContain("either works");
  });

  it("does not say 'either works' when a number would mean both", () => {
    const text = renderMenu(COLLIDING);
    expect(text).not.toContain("either works");
    expect(text).toMatch(/would mean/);
  });
});

describe("# always means the issue number", () => {
  // The escape hatch cannot be allowed to double back into the thing it escapes.
  it("never reinterprets #N as a list position", () => {
    // #1 is list position 1, but no option has issue number 1 — so this must NOT select ordinal 1.
    const r = resolveChoice("#1", CLEAR);
    expect(r.kind).toBe("invalid");
  });

  it("resolves a bare number to the list position when nothing collides", () => {
    expect(resolveChoice("1", CLEAR)).toMatchObject({ kind: "task", number: 19 });
  });
});
