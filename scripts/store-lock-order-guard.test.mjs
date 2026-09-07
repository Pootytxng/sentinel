// store-lock-order-guard.test.mjs — the acyclicity claim behind #283's store locks, mechanized.
//
// #283 put a `Mutex<()>` around the read-modify-write in comparison.rs, drift.rs and readiness.rs.
// A lock is only safe if the lock GRAPH stays acyclic, and PR #395's independent review showed that
// claim rotting in the exact way prose rots: the comment asserted the one call out of a locked
// section acquired nothing, when in fact `on_session_finalized` → `history::ledger_len_checked` →
// `load_history` reaches `support_evidence::record`, which takes that module's own store lock. No
// cycle — but a lock ORDER nobody had written down, defended by a sentence that was wrong.
//
// Prose is the weakest tier of rule. This file is the guard that replaces it, and it checks the two
// things the acyclicity argument actually rests on:
//
//   A. NO BACK EDGE. Nothing reachable from inside a store lock (`history.rs`, and
//      `support_evidence.rs` behind it) may call back into a store module. That is what makes
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
 * Modules reachable from INSIDE one of those locked sections, and therefore forbidden from calling
 * back. `history` is called directly (`comparison::on_session_finalized_at`); `support_evidence` is
 * one hop behind it, on `load_history`'s corrupt-ledger branch, and is the module whose own lock
 * makes the order real.
 */
const REACHABLE_FROM_INSIDE_A_LOCK = ["history", "support_evidence"];

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
 * Every module a Rust source reaches, sorted and deduped. Pure over a string, so the shapes it
 * claims to recognize can be pinned directly instead of by mutating the tree to find out.
 *
 * The first version matched `crate::<mod>::` and nothing else, and PR #395's SECOND independent
 * review broke it in one line: `use crate::comparison; comparison::armed()` is completely ordinary
 * Rust, contains no `crate::comparison::` substring, and sailed past the back-edge assertion 6/6
 * green. A guard an idiomatic import can walk around is worse than no guard, because it reads as
 * proof. So the match now covers the three shapes that can actually introduce an edge:
 *
 *   1. a qualified path — `crate::history::ledger_len_checked()`, and `use crate::history::X;`
 *   2. a BARE module import — `use crate::history;` — the shape that defeated the first version
 *   3. a grouped import — `use crate::{history, support_evidence::record};`
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

  // Shape 3: the braces defeat the pattern above, so read the group's own first segments.
  for (const m of src.matchAll(/\buse\s+(?:crate|super)::\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().match(/^([a-z][a-z0-9_]*)/);
      if (name) found.add(name[1]);
    }
  }

  if (self) found.delete(self); // `super::` inside this file's own tests is not an edge out of it
  return [...found].filter((m) => MODULES.has(m)).sort();
}

/** Every module `module` reaches, comments stripped first. */
function edgesFrom(module) {
  return extractEdges(code(module), module);
}

describe("#283 store locks: the lock graph stays acyclic", () => {
  it.each(REACHABLE_FROM_INSIDE_A_LOCK)(
    "%s.rs has no call back into a store module",
    (module) => {
      const reached = edgesFrom(module);
      const back = STORE_MODULES.filter((store) => reached.includes(store));
      expect(
        back,
        `${module}.rs is reachable from inside a store lock, so a call from it into ` +
          `${back.join("/")} closes the loop into a deadlock. Break the edge, or move the call ` +
          `that reaches ${module}.rs out of the locked section.`,
      ).toEqual([]);
    },
  );

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

  // The three assertions above are only as good as what `extractEdges` can SEE, and its first
  // version could not see a bare import — a reviewer demonstrated a real back edge passing 6/6
  // green. That was a defect in the guard itself, so per `bug → guard` the capability is pinned
  // here on synthetic sources: a future regression fails HERE, with a name that says which shape
  // went blind, instead of quietly narrowing what the assertions above are able to notice.
  it.each([
    ["a qualified call", "fn f() { let _ = crate::history::ledger_len_checked(); }", ["history"]],
    ["a qualified import", "use crate::history::AppliedChange;", ["history"]],
    ["a BARE module import", "use crate::history;\nfn f() { history::load_history(); }", ["history"]],
    [
      "a grouped import",
      "use crate::{history, support_evidence::record};",
      ["history", "support_evidence"],
    ],
    ["a `super::` module path", "fn f() { super::history::load_history(); }", ["history"]],
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
});
