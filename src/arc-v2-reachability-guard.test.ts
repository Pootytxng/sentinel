import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

// ── ARC-V2 REACHABILITY GUARD (2026-08-20) ───────────────────────────────────────────────────
//
// `src/arc-instrument.css` is the first-experience arc's re-dress skin; every rule is scoped under
// `.arc-v2`, which only ever reaches the DOM through an `arcV2` prop. That made it easy to get
// wrong, and the repo got it wrong twice:
//
//   • First finding: "the entire .arc-v2 skin is DEAD CSS" — WRONG. `grep -rn "arcV2={" src`
//     cannot see JSX **shorthand**, and `src/App.tsx` passes a bare `arcV2` to <FirstCheck/>, so
//     M2 (First-check landing) is live every time the user re-runs the check.
//   • Second finding: "all of it is live" — also wrong. M1 (Onboarding) lost its subject entirely
//     when C-18b deleted the component, and M3/M4 are unreached on every mount that exists.
//
// Both mistakes were a grep standing in for a trace. These two tests mechanize the trace instead.

const SEP = String.fromCharCode(92);
const norm = (p: string) => p.split(SEP).join("/");

function tsxFiles(dir = "src"): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(norm(p));
  }
  return out;
}

/**
 * The full text of every className attribute. Brace-BALANCED on purpose: a lazy `\{…\}` regex stops
 * at the first `}`, which in `` `fc-row ${cond ? "a" : "b"} fc-row-${v}` `` is the ternary's — so
 * the interesting half of the expression is never read and its classes look dead.
 */
function classNameExpressions(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/className=(?:"([^"]*)"|\{)/g)) {
    if (m[1] !== undefined) {
      out.push(m[1]);
      continue;
    }
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    out.push(src.slice(start, i - 1));
  }
  return out;
}

/**
 * Every class any component can put in a className: literal tokens, plus the PREFIXES of
 * template-composed ones. `cmp-${r.verdict}` renders `cmp-improved` and the literal string
 * "cmp-improved" appears nowhere in the tree — reading only literals would report a live class
 * as dead, which is the same grep-for-a-trace mistake this file exists to stop.
 */
function classTokensInTree(): { literals: Set<string>; prefixes: string[] } {
  const literals = new Set<string>();
  const prefixes = new Set<string>();
  for (const f of tsxFiles()) {
    const src = readFileSync(f, "utf8");
    for (const raw of classNameExpressions(src)) {
      for (const t of raw.split(/[^A-Za-z0-9_-]+/)) if (t) literals.add(t);
      for (const p of raw.matchAll(/([A-Za-z][A-Za-z0-9_-]*-)\$\{/g)) prefixes.add(p[1]);
    }
  }
  return { literals, prefixes: [...prefixes] };
}

const ARC_CSS = norm(join("src", "arc-instrument.css"));

describe("arc-instrument.css has a subject for everything it styles", () => {
  it("styles no class that exists nowhere in the tree (M1 rotted here)", () => {
    const css = readFileSync(ARC_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const styled = new Set<string>();
    for (const m of css.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
      // Selector text only — never the body, where a decimal like rgba(0,0,0,.02) looks like a class.
      for (const c of m[1].matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) styled.add(c[1]);
    }
    const { literals, prefixes } = classTokensInTree();
    const orphans = [...styled]
      .filter((c) => !literals.has(c) && !prefixes.some((p) => c.startsWith(p)))
      .sort();
    expect(
      orphans,
      "these classes are styled by the arc skin but no component renders them — C-18b deleted the " +
        "Onboarding component and left 118 lines of its skin behind. Delete the section, or say in " +
        "docs/BACKLOG.md which component is going to render it.",
    ).toEqual([]);
  });
});

describe("who actually turns the arc skin on", () => {
  // SHORTHAND-AWARE on purpose: `arcV2` and `arcV2={true}` and `arcV2={flag}` all count. The
  // original wrong finding came from a pattern that only matched the second shape.
  function callersPassingArcV2(): string[] {
    const hits: string[] = [];
    for (const f of tsxFiles()) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/(?:^|\n)\s*arcV2(?:\s*=\s*\{([^}]*)\})?\s*(?=\n|\/>|>)/g)) {
        const value = (m[1] ?? "").trim();
        // A component DECLARING/threading the prop (`arcV2 = false`, `arcV2={arcV2}`) is not a
        // caller turning it on; only a literal-true or a locally-computed flag is.
        if (value === "arcV2" || value === "false" || /^arcV2\?:/.test(value)) continue;
        hits.push(`${f} :: arcV2${value ? `={${value}}` : ""}`);
      }
    }
    return hits.sort();
  }

  it("records the ONE live root — a new one must reclassify the dormant sections first", () => {
    expect(
      callersPassingArcV2(),
      "the arc skin's sections are classified in docs/BACKLOG.md by which mounts can reach them: " +
        "M2 (First-check) LIVE, M3 (session debrief) + M4/4b (comparison cards) DORMANT — their " +
        "prop chain is complete but no top-level caller turns it on. Wiring a new caller makes " +
        "unreviewed CSS visible: update the row and review the skin in the same train.",
    ).toEqual(["src/App.tsx :: arcV2"]);
  });

  it("keeps the dormant subtrees dormant (SessionDebrief / WhatChangedPanel default false)", () => {
    for (const [file, line] of [
      ["src/surfaces/SessionDebrief.tsx", "arcV2 = false"],
      ["src/surfaces/WhatChangedPanel.tsx", "arcV2 = false"],
    ] as const) {
      expect(
        readFileSync(file, "utf8").includes(line),
        `${file} must default arcV2 to false — the M3/M4 skin has never been visually reviewed`,
      ).toBe(true);
    }
    // `Play.tsx:488` is SessionDebrief's ONLY mount, and it passes no arcV2.
    const play = readFileSync("src/surfaces/Play.tsx", "utf8");
    const mount = /<SessionDebrief([\s\S]{0,900}?)\/>/.exec(play);
    expect(mount, "SessionDebrief's mount in Play.tsx moved — re-trace before trusting this row").toBeTruthy();
    expect(
      /\barcV2\b/.test(mount?.[1] ?? ""),
      "Play.tsx now passes arcV2 — M3/M4 just became visible; review the skin and update docs/BACKLOG.md",
    ).toBe(false);
  });
});
