import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// IN-EFFECT COUNTS SOURCE GUARD (#452 — Phase 2 of #385, slice 4).
//
// WHY THIS EXISTS: every "N Compy changes are active" a screen printed was a private filter over
// the bare `get_applied_changes` list — `activeChangeCount(changes)` in dashboard-data.ts, or a
// hand-rolled `.filter(c => c.is_still_active).length`. That list collapses to `[]` when the Trust
// Ledger cannot be read (`.catch(() => [])` in App.refresh), so "0 changes active" and "Compy
// cannot read its own record" were the same number. It also counted rows applied on ANOTHER PC,
// because the list carries no rig stamp. The shared Machine Model (#385) carries both — a per-row
// `on_this_rig` fact and its own `ledger_unreadable` word — and `inEffectCounts()` /
// `benchmarkAttribution()` in `src/data/machine-model.ts` and `src/surfaces/benchmark-view.ts` are
// the only readers a surface may count through.
//
// The corpus is INVERTED on purpose (walk everything, exempt explicitly), the same lesson the
// mutation-boundary guard learned: a new surface is in scope the moment it exists. Part 2 of #452
// migrated the three Home faces, deleted `activeChangeCount`, and moved the FirstWin heading onto a
// history fact, so the exemption list is EMPTY. A new row needs a real reason, and the liveness test
// below refuses one that has rotted.

const SRC = "src";

// ── Corpus ──────────────────────────────────────────────────────────────────────────────────────

function collect(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const rel = join(dir, name);
    if (statSync(rel).isDirectory()) {
      out.push(...collect(rel));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(rel);
    }
  }
  return out.sort();
}

const files = collect(SRC);

// ── Detection ───────────────────────────────────────────────────────────────────────────────────

// Comments legitimately NAME the old helper while explaining why it is gone; only executable source
// is in scope. `(?<!:)` keeps `https://…` in a string literal from reading as a line comment.
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(?<!:)\/\/[^\n]*/g, " ");
}

// Each pattern is a way to turn the bare ledger list into an "active" count without the model.
const PATTERNS: [string, RegExp][] = [
  ["activeChangeCount(…)", /\bactiveChangeCount\s*\(/],
  ["activeChanges(…).length", /\bactiveChanges\s*\([^)]*\)\s*\.length\b/],
  // One level of nesting so the arrow's own parameter list `((c) => …)` does not end the match.
  [
    ".filter(… is_still_active …).length",
    /\.filter\s*\((?:[^()]|\([^()]*\))*\bis_still_active\b(?:[^()]|\([^()]*\))*\)\s*\.length\b/,
  ],
];

export function detect(source: string): string[] {
  const code = stripComments(source);
  return PATTERNS.filter(([, re]) => re.test(code)).map(([name]) => name);
}

// ── Exemptions ──────────────────────────────────────────────────────────────────────────────────

// file → why it may still count off the bare list. Each must stay LIVE (the file exists and still
// matches) or be deleted; a reason shorter than a sentence is a placeholder, not a reason.
const EXCEPTIONS: Record<string, string> = {};

// ── Tests ───────────────────────────────────────────────────────────────────────────────────────

describe("in-effect counts read the Machine Model, never a private filter over the ledger list", () => {
  it("walks a real corpus", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain(join("src", "App.tsx"));
  });

  it("no non-exempt source counts 'active' off the bare list", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file in EXCEPTIONS) continue;
      const hits = detect(readFileSync(file, "utf8"));
      if (hits.length > 0) offenders.push(`${file}: ${hits.join(", ")}`);
    }
    expect(
      offenders,
      "count through inEffectCounts()/benchmarkAttribution() — the bare list cannot tell " +
        "'0 active' from 'ledger unreadable', and counts rows applied on another PC",
    ).toEqual([]);
  });

  it("keeps every exception live, so the list cannot rot into a rubber stamp", () => {
    for (const [file, reason] of Object.entries(EXCEPTIONS)) {
      expect(files, `${file} is exempted but no longer exists`).toContain(file);
      expect(
        detect(readFileSync(file, "utf8")).length,
        `${file} no longer counts off the bare list — delete its exception rather than leaving a standing pass`,
      ).toBeGreaterThan(0);
      expect(reason.length, `${file} needs a real reason, not a placeholder`).toBeGreaterThan(80);
    }
  });

  it("the slice-4 surfaces and the Health faces read the model and are not exempted", () => {
    // These are the fix; an exemption row for any of them would be the defect coming back.
    const app = join("src", "App.tsx");
    const bench = join("src", "surfaces", "Benchmark.tsx");
    const twoFutures = join("src", "surfaces", "TwoFutures.tsx");
    for (const file of [app, bench, twoFutures]) expect(EXCEPTIONS).not.toHaveProperty(file);
    expect(stripComments(readFileSync(app, "utf8"))).toMatch(/\binEffectCounts\s*\(/);
    // Part 2 of #452: the three Health faces print the count, so each must read it from the model.
    for (const face of ["HomeHud.tsx", "HomeV2.tsx", "HomeConsole.tsx"]) {
      const file = join("src", "surfaces", face);
      expect(EXCEPTIONS).not.toHaveProperty(file);
      expect(stripComments(readFileSync(file, "utf8")), `${face} reads inEffectCounts()`).toMatch(
        /\binEffectCounts\s*\(/,
      );
    }
    expect(stripComments(readFileSync(bench, "utf8"))).toMatch(/\bbenchmarkAttribution\s*\(/);
    expect(stripComments(readFileSync(twoFutures, "utf8"))).not.toMatch(/get_applied_changes/);
  });

  it("the detector fires on each shape it claims to catch, and not on a comment", () => {
    expect(detect("const n = activeChangeCount(changes);")).toEqual(["activeChangeCount(…)"]);
    expect(detect("const n = activeChanges(changes).length;")).toEqual(["activeChanges(…).length"]);
    expect(detect("const n = changes.filter((c) => c.is_still_active).length;")).toEqual([
      ".filter(… is_still_active …).length",
    ]);
    expect(detect("// activeChangeCount(changes) used to live here\nconst n = 0;")).toEqual([]);
    // A filter that is not a count — the reverted-changes list, for instance — is not in scope.
    expect(detect("const reverted = changes.filter((c) => !c.is_still_active);")).toEqual([]);
  });
});
