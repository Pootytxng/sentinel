// store-lock-order-guard.test.mjs — the acyclicity claim behind #283's store locks, mechanized.
//
// #283 put a `Mutex<()>` around the read-modify-write in comparison.rs, drift.rs and readiness.rs.
// A lock is only safe if the lock GRAPH stays acyclic, and PR #395's first independent review showed
// that claim rotting in the exact way prose rots: the comment asserted the one call out of a locked
// section acquired nothing, when in fact `on_session_finalized` → `history::ledger_len_checked` →
// `load_history` reaches `support_evidence::record`, which takes that module's own store lock. No
// cycle — but a lock ORDER nobody had written down, defended by a sentence that was wrong.
//
// Prose is the weakest tier of rule. This file is the guard that replaces it, and it checks the two
// things the acyclicity argument actually rests on:
//
//   A. NO BACK EDGE, TRANSITIVELY. Nothing reachable from inside a store lock may call back into a
//      store module. The reachable set is COMPUTED from one seed — `history`, the module actually
//      called from inside a locked section — not listed by hand. That is what makes
//      COMPARISON_LOCK ⊃ SUPPORT_EVIDENCE_LOCK an order rather than a cycle.
//   B. NO NEW EDGE. The set of modules the three store modules reach at all is pinned. A new one is
//      not assumed to be a defect — it is assumed to be UNDERIVED. Adding it here is the moment
//      someone re-derives the order, which is the whole point.
//
// Deliberately syntactic, and deliberately conservative about what it can prove: this checks module
// EDGES, not whether a given call sits inside a critical section. A finer analysis would need real
// Rust parsing and would fail for the wrong reasons; a coarser one would pass vacuously. Sibling of
// scripts/data-root-guard.test.mjs (same shape: read the tree, assert a boundary, no fixtures).
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(REPO, "src-tauri", "src");

/** The modules that hold a store lock across a read-modify-write (#283). */
const STORE_MODULES = ["comparison", "drift", "readiness"];

/**
 * The module actually called from INSIDE one of those locked sections:
 * `comparison::on_session_finalized_at` → `history::ledger_len_checked`.
 *
 * This is the one hand-derived fact in the file, and it is deliberately the only one. Everything
 * else reachable from inside the lock — `support_evidence`, and whatever those two reach in turn —
 * is COMPUTED below. The earlier version pinned `["history", "support_evidence"]` by hand and
 * checked only their direct edges, which PR #395's third independent review flagged: a third hop
 * back into a store module would never have been looked at. Measured at the time of writing, the
 * closure is 9 of the crate's 52 modules and contains no store module.
 */
const LOCK_ENTRY_POINTS = ["history"];

/**
 * What each store module is allowed to reach. Pinned, not discovered: an unlisted edge means the
 * lock order has not been re-derived against it. If you are here because this test failed, work out
 * whether the new call can happen while a store lock is held, follow it to every lock it can reach,
 * and only then add the entry.
 *
 * `readiness → drift` is the one store-to-store edge, and it is safe for a reason worth stating:
 * `get_game_readiness` calls `drift::detect_and_persist` while holding NO dismissals lock, so
 * DRIFT_LOCK is never nested inside DISMISSALS_LOCK. The dismissal sequences themselves reach
 * nothing but `atomic_write`.
 */
const ALLOWED_EDGES = {
  comparison: ["atomic_write", "history", "race_seam", "sessions"],
  drift: ["atomic_write", "race_seam"],
  readiness: ["atomic_write", "drift", "hardware", "history", "monitoring", "race_seam"],
};

// Strip line comments and block comments so a module merely NAMED in prose is not read as a call.
// (Written as a line comment on purpose: a block comment here would have to contain a literal
// block-comment terminator, which closes it early and makes the whole file unparseable. That is
// exactly how this file first shipped, and vitest reported it as `no tests` — a guard nobody runs.)
function code(module) {
  return readFileSync(join(SRC, `${module}.rs`), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

/**
 * Every module in the crate, taken from the tree rather than from a list kept in this file.
 * A path segment only counts as an edge if it names a real module here, which is what stops
 * `super::arm_at(..)` — a function in the SAME file — from being read as an edge to a module.
 */
const MODULES = new Set(
  readdirSync(SRC)
    .filter((f) => f.endsWith(".rs"))
    .map((f) => f.slice(0, -3)),
);

/**
 * The inside of the `{...}` group whose opening brace is at `open`, honouring nesting. `null` if the
 * group is never closed. Written as a scanner rather than a regex because a regex cannot match
 * balanced braces, and pretending otherwise is what caused the defect this function exists to fix.
 */
function groupBody(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** Split a use-group body on its TOP-LEVEL commas — a nested group's commas are not separators. */
function topLevelParts(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === "{") depth += 1;
    else if (c === "}") depth -= 1;
    else if (c === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}

/**
 * Every module a Rust source reaches, sorted and deduped. Pure over a string, so the shapes it
 * claims to recognize can be pinned directly instead of by mutating the tree to find out.
 *
 * This function has now been broken by a reviewer TWICE, each time by ordinary Rust, and each break
 * is why it looks the way it does:
 *
 *   - Review 2: it matched `crate::<mod>::` and nothing else, so `use crate::comparison;` followed
 *     by `comparison::armed()` — a real back edge — passed every assertion green.
 *   - Review 3: the replacement read a group with `\{([^}]*)\}`, which stops at the FIRST `}`. In
 *     `use crate::{actions::{RollbackAction}, comparison};` the capture ended inside the nested
 *     group, so `comparison` was never seen by the group reader and was not adjacent to `crate::`
 *     for the plain matcher either. A real back edge again passed 12/12 green.
 *
 * Both were the same lesson: a regex cannot parse a nested use-tree. The group reader is now a
 * brace-depth scanner, which can. The shapes covered:
 *
 *   1. a qualified path — `crate::history::ledger_len_checked()`, `use crate::history::X;`,
 *      `use crate::history as h;` (the alias does not hide the segment before it)
 *   2. a BARE module import — `use crate::history;`
 *   3. a group, at any nesting depth — `use crate::{history, support_evidence::record};` and
 *      `use crate::{actions::{A, B}, history};`
 *
 * `super::` is matched for the same reason, and is why every candidate is filtered against the real
 * module list: inside a `mod tests` block `super::` means THIS file, so `super::arm_at` must not
 * read as an edge to a module named `arm_at`. The filter is deliberately conservative in the other
 * direction too — a same-file call that happens to share a name with a module file WILL be counted
 * and this test will fail asking someone to re-derive. Failing that way round is the point.
 *
 * Still syntactic, and still honest about the rest of its limits: it checks module EDGES, not
 * whether a call sits inside a critical section, and a path assembled by a macro can hide from it.
 */
export function extractEdges(src, self) {
  const found = new Set();

  // Shapes 1 and 2: any `crate::x` / `super::x`, whether or not a further `::` follows.
  for (const m of src.matchAll(/\b(?:crate|super)::([a-z][a-z0-9_]*)/g)) found.add(m[1]);

  // Shape 3: a group. Only the TOP-LEVEL entries of a group hanging directly off `crate::`/`super::`
  // are crate-level modules; anything deeper is an item inside one of them and is already counted.
  for (const m of src.matchAll(/\b(?:crate|super)::\{/g)) {
    const body = groupBody(src, m.index + m[0].length - 1);
    if (body === null) continue; // unterminated group: read nothing rather than read wrongly
    for (const part of topLevelParts(body)) {
      const name = part.trim().match(/^([a-z][a-z0-9_]*)/);
      if (name) found.add(name[1]);
    }
  }

  if (self) found.delete(self); // `super::` inside this file's own tests is not an edge out of it
  return [...found].filter((m) => MODULES.has(m)).sort();
}

/**
 * Everything reachable from `seeds`, mapped to the path that reached it. Pure over an `edgesOf`
 * lookup so the walk can be falsified on a synthetic graph rather than only against the real tree —
 * a walker that silently stopped at one hop would otherwise pass exactly as vacuously as the
 * hand-pinned list it replaced.
 */
export function closureFrom(seeds, edgesOf) {
  const via = new Map(seeds.map((s) => [s, [s]]));
  const queue = [...seeds];
  while (queue.length) {
    const module = queue.shift();
    for (const next of edgesOf(module)) {
      if (via.has(next)) continue; // also what makes a cyclic graph terminate
      via.set(next, [...via.get(module), next]);
      queue.push(next);
    }
  }
  return via;
}

/** Every module `module` reaches, comments stripped first. */
function edgesFrom(module) {
  return extractEdges(code(module), module);
}

describe("#283 store locks: the lock graph stays acyclic", () => {
  it("nothing reachable from inside a store lock reaches back into one", () => {
    const via = closureFrom(LOCK_ENTRY_POINTS, edgesFrom);
    const back = STORE_MODULES.filter((store) => via.has(store));
    expect(
      back.map((store) => via.get(store).join(" -> ")),
      `a module reachable from inside a store lock calls back into ${back.join("/")}, which closes ` +
        `the loop into a deadlock. Break an edge on the path above, or move the call that reaches ` +
        `into that chain out of the locked section.`,
    ).toEqual([]);
  });

  it("the reachable set is not vacuous — it still contains support_evidence", () => {
    // `support_evidence` is the module whose OWN store lock makes COMPARISON_LOCK ⊃
    // SUPPORT_EVIDENCE_LOCK an order rather than a triviality. If the walk stopped reaching it, the
    // assertion above would be guarding an empty set and would still be green.
    const via = closureFrom(LOCK_ENTRY_POINTS, edgesFrom);
    expect([...via.keys()]).toContain("support_evidence");
  });

  it.each(STORE_MODULES)("%s.rs reaches only modules the lock order was derived against", (store) => {
    const unexpected = edgesFrom(store).filter((m) => !ALLOWED_EDGES[store].includes(m));
    expect(
      unexpected,
      `${store}.rs gained a call into ${unexpected.join("/")}, which #283's lock order has not ` +
        `been derived against. Follow that call to every lock it can reach; if none of them can ` +
        `be held while ${store}.rs's own lock is, add it to ALLOWED_EDGES in this file.`,
    ).toEqual([]);
  });

  it("still names an edge that exists, so the allowlist cannot pass vacuously", () => {
    // If comparison.rs stopped calling history.rs entirely, the back-edge assertion above would be
    // guarding nothing and would still be green. This pins the edge the whole order is about.
    expect(edgesFrom("comparison")).toContain("history");
  });

  // The assertions above are only as good as what `extractEdges` can SEE, and two reviewers have now
  // broken it with ordinary Rust — first a bare import, then a nested use-group. Both times a real
  // back edge passed every tree assertion green. That is a defect in the guard itself, so per
  // `bug → guard` the capability is pinned here on synthetic sources: a future regression fails
  // HERE, with a name that says which shape went blind, instead of quietly narrowing coverage.
  it.each([
    ["a qualified call", "fn f() { let _ = crate::history::ledger_len_checked(); }", ["history"]],
    ["a qualified import", "use crate::history::AppliedChange;", ["history"]],
    ["a BARE module import", "use crate::history;\nfn f() { history::load_history(); }", ["history"]],
    ["an ALIASED import", "use crate::history as h;\nfn f() { h::load_history(); }", ["history"]],
    [
      "a flat group",
      "use crate::{history, support_evidence::record};",
      ["history", "support_evidence"],
    ],
    [
      // Review 3's evasion, verbatim in shape: the old `\{([^}]*)\}` capture stopped at the nested
      // group's `}`, so every sibling AFTER it was invisible to the group reader and not adjacent
      // to `crate::` for the plain matcher either.
      "a NESTED group with a sibling after it",
      "use crate::{actions::{RollbackAction}, history};\nfn f() { history::load_history(); }",
      ["actions", "history"],
    ],
    [
      "a deeply nested group with siblings at two levels",
      "use crate::{actions::{a::{b}, c}, history, support_evidence::record};",
      ["actions", "history", "support_evidence"],
    ],
    [
      "a multi-line group, which is how the real files write them",
      "use crate::{\n    actions::{RollbackAction},\n    history,\n};",
      ["actions", "history"],
    ],
  ])("sees an edge hiding in %s", (_shape, src, expected) => {
    expect(extractEdges(src, "comparison")).toEqual(expected);
  });

  it("does not read a same-file `super::` call as an edge to a module", () => {
    // `super::` inside `mod tests` is the containing file. `arm_at` is a function in comparison.rs,
    // not a module, so filtering candidates against the real module list is what keeps this quiet.
    expect(extractEdges("fn t() { super::arm_at(&p, a); }", "comparison")).toEqual([]);
    // And the module's own name reached through `super::` is not an edge OUT of it either.
    expect(extractEdges("fn t() { super::comparison::x(); }", "comparison")).toEqual([]);
  });

  it("reads nothing rather than reading wrongly from an unterminated group", () => {
    // Not a shape valid Rust produces — a defence against the scanner running off the end of a file
    // and inventing edges out of whatever followed. `crate::history` on the same line is still seen.
    expect(extractEdges("use crate::{history, drift", "comparison")).toEqual([]);
    expect(extractEdges("use crate::history;\nuse crate::{drift", "comparison")).toEqual(["history"]);
  });

  // The walk itself can be wrong in a way that is invisible against the real tree: one that stopped
  // after a single hop would give the same answer today, because today's closure happens to be
  // clean. So it is pinned on a synthetic graph, where a two-hop back edge definitely exists.
  it("follows a back edge that is more than one hop away", () => {
    const graph = { history: ["actions"], actions: ["leftovers"], leftovers: ["comparison"] };
    const via = closureFrom(["history"], (m) => graph[m] ?? []);
    expect(via.has("comparison")).toBe(true);
    expect(via.get("comparison").join(" -> ")).toBe("history -> actions -> leftovers -> comparison");
  });

  it("terminates on a cyclic graph instead of walking forever", () => {
    const graph = { a: ["b"], b: ["c"], c: ["a"] };
    expect([...closureFrom(["a"], (m) => graph[m] ?? []).keys()].sort()).toEqual(["a", "b", "c"]);
  });
});
