import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// Modal-stacking guard.
//
// THE BUG (self-review round 6, 2026-07-29): the confirm dialog — the last thing between a user and
// a real change to their machine — sat at `z-index: 200`, BELOW every full-screen overlay in the
// app (FirstCheck 999, Onboarding / SetupTour / GamingMode 1000, Term / WhatsThis 1200).
// `ConfirmProvider` renders its backdrop as a DOM sibling of the whole app tree (main.tsx), so from
// inside any of those overlays the confirm was painted UNDER an opaque full-screen layer: invisible
// and un-hit-testable by mouse, while its DOM and keyboard trap kept working perfectly. A mouse user
// applying the #1 recommendation from the first-check arc saw the switch move and then nothing at
// all — the safety confirmation for a real mutation, silently swallowed by paint order.
//
// WHY A SOURCE GUARD: jsdom applies no stylesheets and computes no layout, so no rendering test can
// see this. The z-index ladder is a static, cross-file property of the CSS — exactly what a source
// guard can hold. What it locks:
//   (1) the confirm outranks every full-screen overlay backdrop in the app, and
//   (2) the window chrome stays above the confirm (it is deliberately always reachable).
// It does NOT prove hit-testing — that's the `self-review` skill's live `elementFromPoint` check.

const CSS_ROOT = join("src");

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) return cssFiles(p);
    return p.endsWith(".css") ? [p] : [];
  });
}

const sources = cssFiles(CSS_ROOT).map((f) => ({
  file: f,
  css: readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, ""),
}));

/** The z-index declared on a class's own rule, or null if it declares none. */
function zIndexOf(className: string): number | null {
  const re = new RegExp(`(^|[\\s,>+~])\\.${className}\\s*\\{([^{}]*)\\}`, "m");
  for (const { css } of sources) {
    const m = re.exec(css);
    if (!m) continue;
    const z = /z-index\s*:\s*(-?\d+)/.exec(m[2]);
    if (z) return Number(z[1]);
  }
  return null;
}

const CONFIRM = "cmp-confirm-backdrop";

// Every full-screen blocking layer that can host a confirm. Each is `position: fixed; inset: 0`
// with its own stacking order; a confirm raised from inside any of them must paint on top.
const OVERLAYS = [
  "fc-backdrop", // FirstCheck — the arc the bug was found in
  "onb-backdrop", // Onboarding
  "st-backdrop", // SetupTour
  "gaming-modal-backdrop", // Gaming Mode
];

describe("modal stacking — the confirm is never buried", () => {
  it("the confirm backdrop declares a z-index at all", () => {
    expect(zIndexOf(CONFIRM)).not.toBeNull();
  });

  it("outranks every full-screen overlay that can host it", () => {
    const confirm = zIndexOf(CONFIRM)!;
    const found = OVERLAYS.map((c) => ({ c, z: zIndexOf(c) })).filter((o) => o.z != null);
    // If the class names drift the guard must fail loudly, not silently pass on an empty list.
    expect(found.length).toBeGreaterThan(0);
    for (const { c, z } of found) {
      expect(
        confirm > z!,
        `.${CONFIRM} (${confirm}) must outrank .${c} (${z}) — a confirm opened from inside it would be invisible`,
      ).toBe(true);
    }
  });

  it("the window chrome still outranks the confirm — it is reachable by design", () => {
    const chrome = zIndexOf("wc-bar");
    expect(chrome).not.toBeNull();
    expect(chrome!).toBeGreaterThan(zIndexOf(CONFIRM)!);
  });
});
