import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";

// MONO LAW — mechanized (conformance C-17).
//
// The law, declared in `tokens-v2.css:8-10` since the V2 foundation shipped:
//
//     "--v2-font-mono is for MACHINE VALUES ONLY (measured numbers, hashes, timestamps, units)
//      — never labels or prose."
//
// Until now it was a COMMENT. `UI_VISION_BACKLOG.md` TYPE-1 said so ("still a comment with no
// guard") and the 2026-08-18 conformance audit carried it forward as C-17. A law nobody can break
// accidentally is worth more than a law written down twice, so this file is the mechanism.
//
// ── WHY THIS IS A CENSUS AND NOT A BAN ────────────────────────────────────────────────────────
// Measured before building: 224 rules apply a mono face, and 61 of them pair it with
// `text-transform: uppercase`. Those 61 are not 61 defects — they are the Instrument-HUD micro-label
// idiom the owner approved across two review rounds (2026-07-05 "type & copy voice", 2026-07-06
// "all looks good"): the flat mono tag, the state chip, the masthead eyebrow. Banning mono on a
// label outright would delete the app's design language in the name of enforcing a comment.
//
// So the mechanism is a CENSUS with a RATCHET, the same idiom as `affordance-census.baseline.json`:
//   • every rule that applies a mono face must be declared in `mono-census.baseline.json`;
//   • a NEW mono rule fails the build until someone classifies it — the law can no longer be
//     broken silently, which is the whole of what C-17 asked for;
//   • the `violation` bucket is DOWN-ONLY. Recorded debt may be paid off, never grown.
//
// Buckets:
//   `value`       — a measured number, hash, timestamp, unit, id, path. The law's intended use.
//   `chrome-tag`  — the accepted exception: an uppercase, letter-spaced HUD micro-label / tag /
//                   state chip. Recorded as an exception ON PURPOSE, so the contradiction between
//                   the literal law and the shipped look is written down instead of argued yearly.
//   `violation`   — mono on running prose or a sentence-case label. Real debt. Down-only.
//
// ── WHY IT RESOLVES THE ALIAS GRAPH ───────────────────────────────────────────────────────────
// `--v2-font-mono` is not the only door. `--font-mono`, `--ix-mono`, `--mc-mono` and
// `--qpw-font-mono` all reach the same face, and several surface files re-declare
// `--ix-mono: var(--v2-font-mono)` locally. A guard that grepped for two token names would be
// dodged by the third alias — by accident, not malice. So the scan computes the mono token set as a
// FIXED POINT over every custom-property declaration in `src/`: any property that resolves, through
// any chain of `var()`, to a monospace stack is a mono token, and any `font`/`font-family` that
// names one is a mono rule.
//
// ── UPDATING THE CENSUS ───────────────────────────────────────────────────────────────────────
// Renamed a selector, or added a mono rule? Re-seed with:
//
//     MONO_CENSUS_UPDATE=1 npx vitest run src/design/mono-law-guard.test.ts
//
// It preserves every existing classification and files anything new as `UNCLASSIFIED`, which still
// FAILS — so the regenerator can fix churn but can never bless a new mono rule on your behalf.

const CENSUS_PATH = join("src", "design", "mono-census.baseline.json");

type Bucket = "value" | "chrome-tag" | "violation" | "UNCLASSIFIED";
type Census = { note: string; violationCeiling: number; rules: Record<string, Bucket> };

// Stamped into the census on every re-seed, so the file states how it was classified rather than
// implying 224 selectors were each read on screen. Honest provenance beats an implied audit.
const CENSUS_NOTE =
  "Buckets seeded 2026-08-18 by a documented heuristic: a rule pairing mono with " +
  "`text-transform: uppercase` is the accepted HUD micro-label idiom (chrome-tag); a rule whose " +
  "selector names a label/head/title/sub/hint and is NOT uppercase is recorded debt (violation); " +
  "everything else is a machine value (value). Hand-reviewed where the selector's content was " +
  "checked in the live app. Re-classify any entry you verify - that is the point of the file.";

const MONO_FACE = /monospace|Geist Mono|Cascadia Mono|Consolas|ui-monospace/i;

// Walked, not `git ls-files`d: an untracked new stylesheet is exactly the one a census must not
// miss, and the walk is the idiom every other guard in this directory already uses.
function cssFiles(dir = "src"): string[] {
  return readdirSync(dir)
    .flatMap((entry) => {
      const q = join(dir, entry);
      if (statSync(q).isDirectory()) return cssFiles(q);
      return q.endsWith(".css") ? [q] : [];
    })
    .sort();
}

/** Every custom property that resolves — through any chain of var() — to a monospace stack. */
export function monoTokens(sources: [string, string][]): Set<string> {
  const decls: [string, string][] = [];
  for (const [, css] of sources) {
    for (const m of css.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;{}]+)/g)) decls.push([m[1], m[2]]);
  }
  const mono = new Set<string>();
  // Fixed point: a declaration may reference an alias declared later in a later file, so iterate
  // until nothing new is learned rather than trusting source order.
  for (let pass = 0; pass < 12; pass++) {
    const before = mono.size;
    for (const [prop, value] of decls) {
      if (MONO_FACE.test(value)) mono.add(prop);
      else {
        for (const r of value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
          if (mono.has(r[1])) mono.add(prop);
        }
      }
    }
    if (mono.size === before) break;
  }
  return mono;
}

/** Every rule that puts a mono face on something, keyed `file: selector`. */
export function monoRules(sources: [string, string][]): string[] {
  const mono = monoTokens(sources);
  const keys: string[] = [];
  for (const [file, raw] of sources) {
    const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");
    for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = rule[1].trim().replace(/\s+/g, " ");
      // `font:` shorthand counts too — it is the documented way a font sneaks past a
      // `font-family`-only matcher (the same hole `type-scale-guard` closes for sizes).
      for (const decl of rule[2].matchAll(/(?:^|[;{]|\s)font(?:-family)?\s*:\s*([^;]+)/g)) {
        const value = decl[1];
        const names = [...value.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)].map((x) => x[1]);
        if (MONO_FACE.test(value) || names.some((n) => mono.has(n))) {
          keys.push(`${file.replace(/\\/g, "/")}: ${selector}`);
          break;
        }
      }
    }
  }
  return [...new Set(keys)].sort();
}

function loadCensus(): Census {
  return JSON.parse(readFileSync(CENSUS_PATH, "utf8")) as Census;
}

const sources = (): [string, string][] => cssFiles().map((f) => [f, readFileSync(f, "utf8")]);

describe("mono law (C-17): mono is for machine values, and every use is declared", () => {
  const live = monoRules(sources());

  // Re-seed on demand. Runs FIRST so a churn fix and the assertions can happen in one command.
  it("regenerates the census when asked, preserving every existing classification", () => {
    if (!process.env.MONO_CENSUS_UPDATE) {
      expect(existsSync(CENSUS_PATH), `${CENSUS_PATH} is missing — re-seed it, see this file's header`).toBe(true);
      return;
    }
    const prev: Census = existsSync(CENSUS_PATH)
      ? loadCensus()
      : { note: CENSUS_NOTE, violationCeiling: Number.MAX_SAFE_INTEGER, rules: {} };
    const rules: Record<string, Bucket> = {};
    for (const key of live) rules[key] = prev.rules[key] ?? "UNCLASSIFIED";
    const violations = Object.values(rules).filter((b) => b === "violation").length;
    writeFileSync(
      CENSUS_PATH,
      JSON.stringify(
        { note: CENSUS_NOTE, violationCeiling: Math.min(prev.violationCeiling, violations), rules },
        null,
        2,
      ) + "\n",
      "utf8",
    );
  });

  it("declares every mono rule in the codebase — a new one must be classified, not assumed", () => {
    const census = loadCensus();
    const undeclared = live.filter((k) => !(k in census.rules));
    expect(
      undeclared,
      "New mono rule(s). Mono is for MACHINE VALUES ONLY (measured numbers, hashes, timestamps, " +
        "units) — never labels or prose. If this is a machine value, add it to " +
        `${CENSUS_PATH} as "value"; if it is the accepted uppercase HUD tag idiom, "chrome-tag"; ` +
        "otherwise do not use mono. See this file's header.",
    ).toEqual([]);
  });

  it("carries no stale entries — a census that describes deleted CSS is not evidence", () => {
    const census = loadCensus();
    const liveSet = new Set(live);
    expect(
      Object.keys(census.rules).filter((k) => !liveSet.has(k)),
      `Removed/renamed rules still listed in ${CENSUS_PATH}. Re-seed: MONO_CENSUS_UPDATE=1 npx vitest run src/design/mono-law-guard.test.ts`,
    ).toEqual([]);
  });

  it("has nothing UNCLASSIFIED — the regenerator files, a human decides", () => {
    const census = loadCensus();
    expect(
      Object.entries(census.rules)
        .filter(([, b]) => b === "UNCLASSIFIED")
        .map(([k]) => k),
    ).toEqual([]);
  });

  it("ratchets violations DOWN only", () => {
    const census = loadCensus();
    const violations = Object.entries(census.rules).filter(([, b]) => b === "violation");
    expect(
      violations.length,
      `Mono-on-prose debt may only shrink. Ceiling ${census.violationCeiling}; if you paid some off, ` +
        "lower violationCeiling to the new count in the same commit.",
    ).toBeLessThanOrEqual(census.violationCeiling);
  });

  it("uses only the three real buckets", () => {
    const census = loadCensus();
    const allowed = new Set(["value", "chrome-tag", "violation", "UNCLASSIFIED"]);
    expect(Object.entries(census.rules).filter(([, b]) => !allowed.has(b))).toEqual([]);
  });
});

// Disarm probe — the repo precedent (97e00fd: a guard shipped vacuous). A census that only ever
// reports "all declared" is indistinguishable from a scanner whose regex matches nothing, so run
// the real detector over a synthetic tree and pin exactly what it must see.
describe("mono law — the detector actually detects", () => {
  const TREE: [string, string][] = [
    ["a.css", ":root { --font-mono: 'Geist Mono', monospace; --brand: #fff; }"],
    // A three-deep alias chain declared in a LATER file than its use — the fixed point's reason.
    ["b.css", ":root { --ix-mono: var(--font-mono); } .val { font-family: var(--deep); }"],
    ["c.css", ":root { --deep: var(--ix-mono); } .tag { font-family: var(--ix-mono); }"],
    ["d.css", ".literal { font-family: ui-monospace, monospace; }"],
    // The `font:` shorthand smuggling route.
    ["e.css", ".short { font: 600 12px/1.2 var(--ix-mono); }"],
    // Must NOT match: a sans rule, and a mono token merely DECLARED without being applied.
    ["f.css", ":root { --v2-font-mono: 'Geist Mono', monospace; } .sans { font-family: var(--brand-sans); }"],
    // Must NOT match: the word mono inside a comment or an unrelated property.
    ["g.css", "/* font-family: var(--ix-mono) */ .x { color: var(--ix-mono-ink); }"],
  ];

  it("resolves the whole alias graph, including a chain declared out of order", () => {
    const tokens = monoTokens(TREE);
    expect([...tokens].sort()).toEqual(["--deep", "--font-mono", "--ix-mono", "--v2-font-mono"]);
  });

  it("finds every way a mono face gets applied, and nothing that isn't one", () => {
    expect(monoRules(TREE)).toEqual([
      "b.css: .val",
      "c.css: .tag",
      "d.css: .literal",
      "e.css: .short",
    ]);
  });
});
