// bug->guard, written 2026-08-03 for a fix that shipped WITHOUT one.
//
// J reported (2026-07-22) that the native Windows cursor appeared over the sidebar nav rail and
// Monitor's "Overlay" / "Start Capture" buttons instead of the Compy reticle — two cursors in one
// app. reticle.css fixed it, and its header explains exactly why the fix has to look the way it
// does: dozens of components declare their own explicit `cursor: pointer`, and an explicit
// same-element declaration beats an INHERITED `cursor: none` regardless of specificity. So the rule
// needs both a universal descendant selector AND !important.
//
// That reasoning lived only in a CSS comment. Nothing failed if someone "tidied" the !important or
// narrowed the selector, and the collapse is silent — no test goes red, the app just quietly grows
// a second cursor again. This file pins the contract, per the standing bug->guard law
// (CLAUDE.md -> SELF-REVIEW + BUG->GUARD: automated guard > forced rubric item > memory).
//
// It pins the CONTRACT, not the pixels. Whether the reticle is visually centred is a self-review
// job; whether the native cursor can come back is mechanizable, so it is mechanized here.
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const css = readFileSync(
  join("src", "design", "console", "reticle.css"),
  "utf8",
);

// Collapse whitespace so the assertions read against formatting-independent text.
const flat = css.replace(/\s+/g, " ");

describe("reticle cursor contract (J, 2026-07-22)", () => {
  it("hides the native cursor on EVERY descendant, not just the scope root", () => {
    // The universal descendant selector is the whole point: `.lc-has-reticle` alone would be
    // beaten by any child's own `cursor: pointer`.
    expect(
      flat,
      "the universal descendant selector is gone — any component setting its own cursor:pointer will show a second cursor again (J, 2026-07-22)",
    ).toContain(".lc-has-reticle *");
  });

  it("keeps !important on the cursor:none rule", () => {
    const rule = flat.match(/\.lc-has-reticle \* \{[^}]*\}/)?.[0] ?? "";
    expect(rule, "no rule body found for .lc-has-reticle *").not.toBe("");
    expect(
      rule.replace(/ /g, ""),
      "!important was dropped — an explicit cursor:pointer on a child beats an inherited cursor:none, which is the exact collapse J reported",
    ).toContain("cursor:none!important");
  });

  it("still lets text entry take the caret back", () => {
    // Without this escape the reticle would sit over a text field with no caret — a worse bug than
    // the one being fixed.
    expect(flat).toMatch(/input, ?textarea, ?select, ?\[contenteditable="true"\]/);
    expect(flat.replace(/ /g, "")).toContain("cursor:auto!important");
  });

  it("still shows not-allowed on disabled controls", () => {
    // cursor:none over a disabled control reads as clickable. The escape must survive.
    expect(flat).toContain(".lc-has-reticle *:disabled");
    expect(flat.replace(/ /g, "")).toContain("cursor:not-allowed!important");
  });

  it("keeps the reticle above in-shell overlays so it can never strand an invisible pointer", () => {
    // If cursor:none applies but the reticle renders BELOW a modal, the user has no cursor at all.
    const z = flat.match(/\.v2-shell > \.lc-reticle \{[^}]*\}/)?.[0] ?? "";
    expect(z, "the app-shell reticle z-index rule is gone").not.toBe("");
    const value = Number(z.match(/z-index: ?(\d+)/)?.[1] ?? 0);
    expect(value, "reticle must sit above the GamingMode modal (1000)").toBeGreaterThan(1000);
    expect(value, "reticle must stay below the wc-bar (9000)").toBeLessThan(9000);
  });
});
