import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// TYPE-1 guard (design foundation step ①, docs/decisions/2026-08-11-design-foundation.md,
// 2026-08-13). The caught defect (measured 2026-08-11): TWELVE ad-hoc font sizes on one live room,
// 47 of 83 text nodes ≤11px — fine print for a user at couch distance. The fix collapsed every
// font size in src/ to the six-step token scale (type-scale.css); this guard is what makes the
// scale LAW instead of a comment — a new ad-hoc `font-size: 11px` fails CI here, by name.
//
// Allowed forms: font-size: var(--type-*) · inherit · a % / em-free relative keyword. Banned:
// any px/rem/em/number literal, and clamp() carrying px, anywhere outside type-scale.css.
// design/vendor/ (third-party) is exempt. The Arial fallthrough is also pinned dead here.

const SRC = "src";
const EXEMPT = [join("design", "vendor"), join("design", "type-scale.css")];

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...cssFiles(p));
    else if (name.endsWith(".css")) out.push(p);
  }
  return out;
}

const files = cssFiles(SRC).filter(
  (f) => !EXEMPT.some((e) => f.includes(e)),
);

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("TYPE-1: the six-step type scale is law", () => {
  it("covers a sane file set (the walk itself must not silently go blind)", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("no CSS file declares a literal font size — every font-size resolves to a --type-* token", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const css = stripComments(readFileSync(f, "utf8"));
      for (const m of css.matchAll(/font-size:\s*([^;}]+)/g)) {
        const v = m[1].trim();
        if (/^var\(--type-/.test(v)) continue;
        if (/^(inherit|unset|revert|initial|smaller|larger|100%)$/.test(v)) continue;
        offenders.push(`${f}: font-size: ${v.slice(0, 40)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("no font: shorthand smuggles a literal size past the scale", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const css = stripComments(readFileSync(f, "utf8"));
      for (const m of css.matchAll(/font:\s*([^;}]+)/g)) {
        const v = m[1].trim();
        if (v === "inherit") continue;
        if (/(^|\s|\()[\d.]+(px|rem|em)/.test(v)) offenders.push(`${f}: font: ${v.slice(0, 50)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("inline React styles carry no numeric fontSize (token strings only)", () => {
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (!p.includes(join("design", "vendor"))) walk(p);
        } else if (/\.(tsx|ts)$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) {
          const t = readFileSync(p, "utf8");
          for (const m of t.matchAll(/fontSize:\s*("?[\d.]+(?:px)?"?)/g)) {
            offenders.push(`${p}: fontSize: ${m[1]}`);
          }
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });

  it("the six tokens carry the decided values (verdict 40 · section 26 · card 17 · body 15 · label 13 · data 13)", () => {
    const scale = readFileSync(join("src", "design", "type-scale.css"), "utf8");
    // hero is the seventh step (2026-08-23, measured off the approved comps) — pinned here
    // so it cannot be quietly re-tuned away from the picture it was measured from.
    expect(scale).toMatch(/--type-hero:\s*52px/);
    expect(scale).toMatch(/--type-verdict:\s*40px/);
    expect(scale).toMatch(/--type-section:\s*26px/);
    expect(scale).toMatch(/--type-card:\s*17px/);
    expect(scale).toMatch(/--type-body:\s*15px/);
    expect(scale).toMatch(/--type-label:\s*13px/);
    expect(scale).toMatch(/--type-data:\s*13px/);
    // The floor: no token below 13px may ever be added.
    for (const m of scale.matchAll(/--type-[\w-]+:\s*([\d.]+)px/g)) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(13);
    }
  });

  // CODEX FINDING 7 (2026-08-23, MED) — the literal-size ban above accepts ANY
  // `font-size: var(--type-*)`, and the scale test only reads type-scale.css. So the ban was
  // trivially routed around in two spellings, neither of which any test could see:
  //   `--type-shout: 96px` declared in a room sheet, then `font-size: var(--type-shout)`; or
  //   `--type-hero: 96px` redeclared locally, silently re-tuning the shared step for that subtree.
  // Both are the six-step scale being left, which is the only thing this file exists to prevent.
  // Measured before writing: 0 `--type-*` are declared outside type-scale.css and 0 unknown ones
  // are used, so both close at zero debt. If a seventh step is genuinely needed, add it to
  // type-scale.css — where the floor test and the pinned values can see it.
  it("every --type-* used for a font size is a real step of the scale, not a local invention", () => {
    const scale = readFileSync(join("src", "design", "type-scale.css"), "utf8");
    const declared = new Set([...scale.matchAll(/(--type-[\w-]+)\s*:/g)].map((m) => m[1]));
    const unknown: string[] = [];
    for (const f of files) {
      const css = stripComments(readFileSync(f, "utf8"));
      for (const m of css.matchAll(/font-size:\s*var\(\s*(--type-[\w-]+)/g)) {
        if (!declared.has(m[1])) unknown.push(`${f}: font-size: var(${m[1]})`);
      }
    }
    expect(
      unknown,
      "This resolves to nothing the scale declares. A --type-* name is not a licence; the step has " +
        "to exist in type-scale.css, where the 13px floor and the pinned values apply to it.",
    ).toEqual([]);
  });

  it("only type-scale.css may declare a --type-* step — a local override re-tunes the shared scale", () => {
    const scalePath = join("src", "design", "type-scale.css");
    const offenders: string[] = [];
    for (const f of files) {
      if (f === scalePath) continue;
      const css = stripComments(readFileSync(f, "utf8"));
      for (const m of css.matchAll(/(--type-[\w-]+)\s*:\s*([^;}]+)/g)) {
        offenders.push(`${f}: ${m[1]}: ${m[2].trim().slice(0, 30)}`);
      }
    }
    expect(
      offenders,
      "A --type-* declared outside type-scale.css changes the step for everything beneath it, and " +
        "the guard above still reads var(--type-*) and passes. Put the value in the scale, or use " +
        "a name that is not a scale step.",
    ).toEqual([]);
  });

  it("the Arial fallthrough stays dead: base + --font-ui speak the one UI face", () => {
    const app = readFileSync(join("src", "App.css"), "utf8");
    expect(app).toMatch(/--font-ui:\s*"Geist Sans"/);
    expect(app).not.toMatch(/font-family:[^;]*Arial/);
    // html/body base must resolve through the token, never a raw stack that can fall to Arial.
    expect(app).toMatch(/html,\s*body,\s*#root\s*\{[^}]*font-family:\s*var\(--font-ui\)/);
  });
});
