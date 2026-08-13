import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// bug→guard. UX-1 shipped the front-door verdict as the h1 at --type-verdict (40px) and the
// v0.9.23 DESK LOOK found it rendering at --type-section instead. Nothing failed: the full suite
// was green, because the defect lived entirely in the CSS cascade, which jsdom does not resolve —
// vitest never loads these stylesheets, so no rendering test could have seen it.
//
// The cause: home-hud.css styles `.v2-room[data-room="home"] .v2-verdict h1` scoped only by
// [data-hud="on"], and `compy_editorial` DEFAULTS ON — so that selector is live even when the
// console branch (compy_home_console, also default ON) is the face actually rendering. At
// (0,6,1) it outranked home-console.css's `h1:has(.hc-headline)` at (0,3,1) and quietly held the
// verdict down a step. The fix is scope, not weight: `.hc-headline` exists only in HomeConsole,
// so home-hud.css excludes it and gets its own face back.
//
// This guard is therefore a TEXT guard on both sheets, deliberately. It cannot check the rendered
// pixel; what it CAN do is fail the moment either half of the fix is undone.

const read = (p: string[]) => readFileSync(join(...p), "utf8");
const consoleCss = read(["src", "surfaces", "home-console.css"]);
const hudCss = read(["src", "surfaces", "home-hud.css"]);

describe("home verdict scale — UX-1's 40px h1 survives the cascade", () => {
  it("home-console.css sets the verdict h1 to --type-verdict, not another step", () => {
    const rule = consoleCss.match(
      /\.v2-verdict h1:has\(\.hc-headline\)\s*\{([^}]*)\}/,
    );
    expect(rule, "home-console.css must still own a `.v2-verdict h1:has(.hc-headline)` rule").toBeTruthy();
    expect(
      /var\(--type-verdict\)/.test(rule![1]),
      "the front-door h1 must render at --type-verdict — that IS UX-1 decision 1",
    ).toBe(true);
    expect(
      /var\(--type-section\)|var\(--type-card\)/.test(rule![1]),
      "a smaller step in this rule is the regression the v0.9.23 look caught",
    ).toBe(false);
  });

  it("home-hud.css's home h1 rule excludes the console face (.hc-headline)", () => {
    // Every selector in home-hud.css that reaches a home-room verdict h1 must opt out of the
    // console's h1. Written as a scan rather than an exact-string match so a later reformat or an
    // added sibling selector cannot slip past it.
    const offenders = hudCss
      .split("}")
      .map((block) => block.split("{")[0])
      .filter(
        (sel) =>
          /\[data-room="home"\]/.test(sel) &&
          /\.v2-verdict\s+h1/.test(sel) &&
          !/:not\(:has\(\.hc-headline\)\)/.test(sel),
      )
      .map((s) => s.trim());
    expect(
      offenders,
      "a home-hud.css rule is styling the HOME CONSOLE's h1 — it outranks home-console.css and " +
        "will hold the UX-1 verdict below --type-verdict. Add :not(:has(.hc-headline)).",
    ).toEqual([]);
  });

  it("the type scale still defines --type-verdict as the top step", () => {
    const tokens = read(["src", "design", "type-scale.css"]);
    expect(/--type-verdict:\s*40px/.test(tokens)).toBe(true);
  });
});
