import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — no @types/node. CSS is read from disk because vitest
// stubs CSS module imports, so import.meta.glob('?raw') comes back empty.)

// Kernel law (owner, 2026-06-06): the win card's earned shimmer is the ONLY celebratory sweep in the
// app. This guard makes it grep-provable. (Loading skeletons are opacity-pulses; the radar was a
// rotation and is gone; the legacy hero-sheen was removed.)
//
// 2026-08-20 — THE LAW HAD ONE IMPLEMENTATION AND IT WAS NEVER REACHABLE, AND NOW IT IS.
// `cmp-winshimmer` lived in `src/arc-instrument.css` on `.cmp-improved.arc-v2 .cmp-bar-after`, i.e.
// behind the `arcV2` prop — and no screen ever set that prop, so the celebration could not fire for
// any user, ever. The arc-v2 cleanup deleted the unreachable skin and the shimmer went with it;
// this guard briefly pinned the count at ZERO to record that the law was UNBUILT rather than merely
// unseen. It was then re-homed to `src/App.css` on the LIVE selector `.cmp-improved .cmp-bar-after`
// and reviewed on an installed build — its own train, because a deletion must not be the commit
// that introduces a new moving thing on screen. Reachability, not just the keyframe, is now part of
// what this file checks: the keyframe must exist AND be bound to a selector with no dead ancestor.
function cssFiles(): string[] {
  return (readdirSync("src", { recursive: true }) as string[])
    .filter((f) => f.endsWith(".css"))
    .map((f) => join("src", f));
}

function shimmerKeyframes(): string[] {
  const names = new Set<string>();
  for (const f of cssFiles()) {
    for (const m of readFileSync(f, "utf8").matchAll(
      /@keyframes\s+([A-Za-z0-9_-]*(?:shimmer|sheen)[A-Za-z0-9_-]*)/gi,
    )) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

/** Every selector that actually runs `cmp-winshimmer`, across every stylesheet in src/. */
function shimmerSelectors(): string[] {
  const out: string[] = [];
  for (const f of cssFiles()) {
    const css = readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/animation[^:;]*:[^;]*cmp-winshimmer/.test(m[2])) out.push(m[1].trim());
    }
  }
  return out;
}

/**
 * Per-className-expression token sets, split by whether the token is UNCONDITIONAL.
 *
 * The distinction is the whole point. `` `cmp cmp-${r.verdict}${arcV2 ? " arc-v2" : ""}` `` can put
 * `arc-v2` on the card, so a tree-wide "does this class exist" check calls it live — and that check
 * was green for the entire life of the unreachable shimmer. What matters is that `arc-v2` only ever
 * arrives through a ternary, i.e. behind a SECOND gate that has nothing to do with winning.
 */
function classNameSets(): { literals: Set<string>; prefixes: string[] }[] {
  const tsx = (dir: string): string[] => {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) out.push(...tsx(p));
      else if (p.endsWith(".tsx") && !p.endsWith(".test.tsx")) out.push(p);
    }
    return out;
  };
  const sets: { literals: Set<string>; prefixes: string[] }[] = [];
  for (const f of tsx("src")) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{)/g)) {
      let raw = m[1];
      if (raw === undefined) {
        let depth = 1;
        let i = (m.index ?? 0) + m[0].length;
        const start = i;
        while (i < src.length && depth > 0) {
          if (src[i] === "{") depth++;
          else if (src[i] === "}") depth--;
          i++;
        }
        raw = src.slice(start, i - 1);
      }
      // Walk the expression, dropping every CONDITIONAL `${...}` substitution and keeping the
      // prefix of every plain one (`cmp-${r.verdict}` really does render `cmp-improved`).
      const literals = new Set<string>();
      const prefixes: string[] = [];
      let plain = "";
      let i = 0;
      while (i < raw.length) {
        if (raw[i] === "$" && raw[i + 1] === "{") {
          let depth = 1;
          let j = i + 2;
          const start = j;
          while (j < raw.length && depth > 0) {
            if (raw[j] === "{") depth++;
            else if (raw[j] === "}") depth--;
            j++;
          }
          const inner = raw.slice(start, j - 1);
          const conditional = inner.includes("?") || inner.includes("&&");
          const pre = plain.match(/([A-Za-z][A-Za-z0-9_-]*-)$/);
          if (!conditional && pre) prefixes.push(pre[1]);
          if (conditional) {
            // The branch text is unreachable-by-default for this purpose; do not harvest it.
          }
          plain += " ";
          i = j;
          continue;
        }
        plain += raw[i];
        i++;
      }
      for (const t of plain.split(/[^A-Za-z0-9_-]+/)) if (t) literals.add(t);
      sets.push({ literals, prefixes });
    }
  }
  return sets;
}

/** The classes required together on ONE element, for each compound in a selector. */
function compounds(selector: string): string[][] {
  return selector
    .split(",")
    .flatMap((branch) => branch.trim().split(/\s*[>+~]\s*|\s+/))
    .map((part) => [...part.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)].map((m) => m[1]))
    .filter((classes) => classes.length > 0);
}

describe("kernel law: one celebratory sweep", () => {
  it("admits no sweep but the win card's — a second one is a new sweep, not a variant", () => {
    // The teeth of the law, unchanged and still absolute: whatever exists must be `cmp-winshimmer`.
    // A new shimmer/sheen anywhere in src/ fails here — convert it to a pulse.
    expect(shimmerKeyframes().filter((n) => n !== "cmp-winshimmer")).toEqual([]);
  });

  it("the celebration is BUILT — the law's one sweep exists and some rule actually runs it", () => {
    expect(
      shimmerKeyframes(),
      "the win-card shimmer is gone. The kernel law says a measured win sweeps once; deleting it " +
        "retires the law, which is an owner decision, not a cleanup.",
    ).toEqual(["cmp-winshimmer"]);
    expect(
      shimmerSelectors().length,
      "no rule runs cmp-winshimmer — the keyframe is orphaned",
    ).toBeGreaterThan(0);
  });

  it("REACHABILITY — the win itself is the ONLY gate on the sweep (this is what was broken)", () => {
    // From the day it was written until 2026-08-20 the shimmer sat on
    // `.cmp-improved.arc-v2 .cmp-bar-after`, and `arc-v2` reached that element only through
    // `${arcV2 ? " arc-v2" : ""}` — a prop no screen ever set. The old guard stayed green the whole
    // time because it only asked whether the keyframe existed.
    //
    // The rule now: every compound in the sweep's selector must be produced UNCONDITIONALLY by one
    // className expression. A class that arrives through a ternary is a second gate, and the only
    // thing allowed to gate an earned celebration is the earning.
    const sets = classNameSets();
    const unreachable: string[] = [];
    for (const selector of shimmerSelectors()) {
      for (const classes of compounds(selector)) {
        const ok = sets.some((set) =>
          classes.every(
            (c) => set.literals.has(c) || set.prefixes.some((p) => c.startsWith(p)),
          ),
        );
        if (!ok) unreachable.push(`${classes.map((c) => "." + c).join("")} (in "${selector}")`);
      }
    }
    expect(
      unreachable,
      "no single component can put these classes on one element without a second condition, so " +
        "the earned shimmer cannot fire — exactly the state it shipped in for its whole life.",
    ).toEqual([]);
  });
});
