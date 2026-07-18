import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — same disk-read pattern as theme-literal-guard /
//  sweep-guard: these are CSS-text invariants, not runtime behavior, so we grep the source.)

const cssFiles = (): string[] =>
  (readdirSync("src", { recursive: true }) as string[]).filter((f) => f.endsWith(".css"));

// Guard 1 — every `var(--ix-foo)` used WITHOUT a fallback must resolve to a DEFINED token.
// Undefined-token references with no fallback are invalid CSS: the whole declaration is dropped
// silently. That's exactly how borders vanished on BlackBox/ProGate/Settings/Tuning/Check, and how
// BlackBox's readouts lost their monospace (--ix-mono) and the assessment card lost its bg
// (--ix-accent-wash). This makes the regression grep-provable.
describe("token hygiene: no undefined --ix-* token used without a fallback", () => {
  it("every fallback-less var(--ix-…) resolves to a defined token", () => {
    const files = cssFiles();
    // Collect every --ix-* DEFINITION across the CSS (instrument.css holds them, but scan all).
    const defined = new Set<string>();
    for (const rel of files) {
      const css = readFileSync(join("src", rel), "utf8");
      for (const m of css.matchAll(/(--ix-[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
    }
    const offenders: string[] = [];
    for (const rel of files) {
      const css = readFileSync(join("src", rel), "utf8");
      css.split("\n").forEach((line, i) => {
        // var(--ix-name) with the close paren right after the name = no fallback supplied.
        for (const m of line.matchAll(/var\(\s*(--ix-[a-z0-9-]+)\s*\)/g)) {
          if (!defined.has(m[1])) offenders.push(`${rel}:${i + 1}: ${m[1]} — ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
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
