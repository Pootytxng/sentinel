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
//
// THE OVERLAY SET IS DERIVED, NOT LISTED. This guard first shipped with a hand-written watch-list of
// four backdrops, which is the same failure mode one layer up: a list only holds the layers someone
// remembered to add, and the next full-screen overlay is added by someone who has never read this
// file. Deriving it from the CSS found five more on day one — `.modal-backdrop` (App, 1000),
// `.ad-backdrop` (ActionDrawer, 200), `.fix-applyall-backdrop` (120), `.theme-backdrop` (90) and
// `.lx-backdrop` (Learn, 50). None was a live defect once the confirm moved to 2000, and none would
// have been caught if it had been.
//
// The derivation earned itself again on 2026-08-13: the popout convergence DELETED `.ad-backdrop`
// and `.fix-applyall-backdrop` (both overlays became the canonical `.v2-sheet-backdrop`, z 1400),
// and this guard needed no edit to keep covering them — the layer that replaced them was already
// enrolled the day it was written. A hand-written watch-list would now be naming two rules that no
// longer exist while silently not checking the one that does.

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

/** Flat { sel, body } rules. @media wrappers leave a stray entry with an empty body — harmless,
 *  since every check below requires a `position: fixed` and a numeric `z-index` to match. */
function rules(css: string): { sel: string; body: string }[] {
  const out: { sel: string; body: string }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push({ sel: m[1].trim(), body: m[2] });
  return out;
}

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
const CHROME = "wc-bar";

/** Every full-screen fixed layer in the app that declares a stacking order — `position: fixed`
 *  covering the viewport (`inset: 0`, or `top` and `left` both pinned to 0). A confirm raised from
 *  inside any of these must paint on top of it. */
function fullScreenLayers(): { file: string; sel: string; z: number }[] {
  const found: { file: string; sel: string; z: number }[] = [];
  for (const { file, css } of sources) {
    for (const { sel, body } of rules(css)) {
      if (!/position\s*:\s*fixed/.test(body)) continue;
      const z = /z-index\s*:\s*(-?\d+)/.exec(body);
      if (!z) continue;
      const coversViewport = /inset\s*:\s*0/.test(body) || (/top\s*:\s*0/.test(body) && /left\s*:\s*0/.test(body));
      if (!coversViewport) continue;
      found.push({ file, sel, z: Number(z[1]) });
    }
  }
  return found;
}

describe("modal stacking — the confirm is never buried", () => {
  it("the confirm backdrop declares a z-index at all", () => {
    expect(zIndexOf(CONFIRM)).not.toBeNull();
  });

  it("outranks every full-screen layer that can host it", () => {
    const confirm = zIndexOf(CONFIRM)!;
    // The chrome is the one deliberate exception (next test); the confirm is not below itself.
    const others = fullScreenLayers().filter(
      (l) => !l.sel.includes(CONFIRM) && !l.sel.includes(CHROME),
    );
    // A derivation that finds nothing is a broken derivation, not a clean bill of health.
    expect(others.length).toBeGreaterThan(3);
    const buried = others.filter((l) => l.z >= confirm);
    expect(
      buried.map((l) => `${l.sel} (${l.z}) in ${l.file}`),
      `.${CONFIRM} is z-index ${confirm}; a confirm opened from inside any layer at or above that ` +
        `paints underneath it — invisible and un-clickable, while its keyboard trap still works`,
    ).toEqual([]);
  });

  it("the window chrome still outranks the confirm — it is reachable by design", () => {
    const chrome = zIndexOf(CHROME);
    expect(chrome).not.toBeNull();
    expect(chrome!).toBeGreaterThan(zIndexOf(CONFIRM)!);
  });
});
