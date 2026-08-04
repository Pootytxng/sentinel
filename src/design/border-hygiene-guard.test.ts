import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — same disk-read pattern as theme-literal-guard /
//  sweep-guard: these are CSS-text invariants, not runtime behavior, so we grep the source.)

const cssFiles = (): string[] =>
  (readdirSync("src", { recursive: true }) as string[]).filter((f) => f.endsWith(".css"));

/** Every file the shipped UI is built from — stylesheets AND the components that write inline
 *  styles. Test files are excluded: they quote token names as fixtures (this one names `--ix-foo`
 *  in its own prose two lines down) and they ship to nobody. */
const sourceFiles = (): string[] =>
  (readdirSync("src", { recursive: true }) as string[]).filter(
    (f) => /\.(css|ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f),
  );

/** Blank out comment BODIES, newlines preserved so reported line numbers stay true. Prose that
 *  NAMES a token is not a use of it. `//` only when it opens the line, so a `https://` URL sitting
 *  mid-line can never swallow a real reference after it. */
const blankComments = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/^\s*\/\/.*$/gm, (m) => m.replace(/[^\n]/g, " "));

// Guard 1 — every `var(--ix-foo)` anywhere in src/ must name a token that EXISTS.
//
// Original form (2026-06): CSS files only, and only references with NO fallback — because a
// fallback-less reference to a phantom token is invalid CSS and the whole declaration is dropped
// silently. That is how borders vanished on BlackBox/ProGate/Settings/Tuning/Check, how BlackBox's
// readouts lost their monospace (--ix-mono) and how the assessment card lost its bg
// (--ix-accent-wash).
//
// WIDENED 2026-08-04 on both axes, after a self-reviewer pass found a phantom the guard could not
// see through either of them:
//   · FILE TYPE — GpuProfile.tsx wrote `color: "var(--ix-text)"` in six inline styles across four
//     components. --ix-text has never existed (only --ix-text-1/2/3), so every one of those colour
//     declarations was dropped and the headings and delta rows silently inherited. A .tsx file is
//     as capable of naming a token as a .css file, so it is scanned like one.
//   · MATCH SHAPE — `var(--ix-good, var(--ix-accent))` passed the old check because it carries a
//     fallback. But a fallback only stops the DECLARATION dying; the fallback then becomes the
//     permanent value, forever, invisibly. That is how the Lab reported a GOOD verdict in the same
//     violet as its call-to-action: --ix-good was never defined, so "good" silently meant "brand
//     accent". A fallback is a safety net for a token that exists, not a licence for one that
//     doesn't — so EVERY reference must resolve, fallback or no.
describe("token hygiene: every --ix-* token referenced in src/ is defined", () => {
  it("no var(--ix-…) — with or without a fallback, in CSS or in a component — names a phantom", () => {
    const files = sourceFiles();
    const defined = new Set<string>();
    for (const rel of files) {
      const text = blankComments(readFileSync(join("src", rel), "utf8"));
      for (const m of text.matchAll(/(--ix-[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
    }

    const offenders: string[] = [];
    let refs = 0;
    let componentRefs = 0;
    for (const rel of files) {
      const text = blankComments(readFileSync(join("src", rel), "utf8"));
      text.split("\n").forEach((line, i) => {
        // Deliberately NOT anchored on the close paren — that anchor is what let the fallback
        // form through for two months.
        for (const m of line.matchAll(/var\(\s*(--ix-[a-z0-9-]+)/g)) {
          refs++;
          if (/\.tsx?$/.test(rel)) componentRefs++;
          if (!defined.has(m[1])) offenders.push(`${rel}:${i + 1}: ${m[1]} — ${line.trim()}`);
        }
      });
    }

    // Positive controls — an empty offender list is only meaningful if the scan actually saw the
    // tree. Each control pins one half of the 2026-08-04 blind spot.
    expect(defined.has("--ix-accent"), "definition scan found nothing — this guard is vacuous").toBe(true);
    expect(refs, "reference scan found nothing — this guard is vacuous").toBeGreaterThan(50);
    expect(
      componentRefs,
      "no .ts/.tsx reference matched — the file-type blind spot is back and inline styles are unguarded",
    ).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  it("defines the two semantic verdict states exactly once — constant across every theme", () => {
    // --ix-good / --ix-warn are the pair that went missing. They are declared in the base :root and
    // NOT re-declared per theme, like --ix-amber/--ix-danger beside them: a verdict must not change
    // meaning when the owner changes theme. One declaration each is the mechanical form of that.
    const base = readFileSync(join("src", "design", "instrument.css"), "utf8");
    for (const token of ["--ix-good", "--ix-warn", "--ix-amber", "--ix-danger"]) {
      const decls = base.match(new RegExp(`${token}\\s*:`, "g")) ?? [];
      expect(decls.length, `${token} must be declared exactly once in instrument.css`).toBe(1);
    }
  });
});

// Guard 2 — the side-stripe anti-pattern stays retired (DESIGN.md / design-system kernel §0).
// The two idioms the sweep removed have ZERO legitimate uses in this codebase: a `border-(left|
// right)-color` modifier and a `border-(left|right)-width: ≥2px` thickener both exist only to paint
// a colored side-stripe. (Legit triangles/edges use the `border-left: Npx solid` shorthand at a
// fixed width — e.g. the Walkthrough cursor arrow — and are intentionally not matched here.)
describe("design law: no side-stripe border idioms", () => {
  it("no border-(left|right)-color or border-(left|right)-width ≥2px in src CSS", () => {
    const offenders: string[] = [];
    for (const rel of cssFiles()) {
      const css = readFileSync(join("src", rel), "utf8");
      css.split("\n").forEach((line, i) => {
        if (/border-(left|right)-color\s*:/.test(line))
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
        if (/border-(left|right)-width\s*:\s*(?:[2-9]|\d\d)/.test(line))
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

// Guard 3 — the §4H hardware-twin lit-card hover border must OUT-SPECIFY the generic .card:hover.
// Regression the self-reviewer caught (2026-07-18): a bare `.card-lit:hover` (0,0,2,0) TIES the two
// generic `.card:hover` rules (the v2 one at ~1926, and the BOLD-LAYER one at ~2123 that paints
// `border-color: var(--accent-line)`) on specificity and LOSES on source order — the lit hover rule
// silently never applies, so a lit card and a neutral card hover identically (the lit distinction is
// lost) and the rule is dead code that would regress the instant those generic rules move. The fix is
// the compound `.card.card-lit:hover` (0,0,3,0), which wins regardless of order. So: IF any
// `.card-lit:hover` rule exists, every occurrence MUST be the compound `.card.card-lit:hover` form.
// Conditional-on-presence so intentionally removing the whole highlight can't false-fail this.
describe("§4H cascade: lit-card hover must beat the generic .card:hover", () => {
  it("every .card-lit:hover selector is the compound .card.card-lit:hover form", () => {
    const offenders: string[] = [];
    for (const rel of cssFiles()) {
      // Blank out /* … */ comment BODIES (newlines preserved so line numbers stay true) so prose
      // that names `.card-lit:hover` — e.g. this rule's own explanatory comment in App.css — is
      // never mistaken for a live selector.
      const css = readFileSync(join("src", rel), "utf8").replace(
        /\/\*[\s\S]*?\*\//g,
        (m) => m.replace(/[^\n]/g, " "),
      );
      css.split("\n").forEach((line, i) => {
        // A `.card-lit:hover` NOT immediately preceded by `.card` = the bare/ties-and-loses form.
        if (/(?<!\.card)\.card-lit:hover/.test(line))
          offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
