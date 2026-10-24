// store-lock-order-guard.test.mjs — the acyclicity claim behind #283's store locks, mechanized.
//
// #283 put a `Mutex<()>` around the read-modify-write in comparison.rs, drift.rs and readiness.rs.
// A lock is only safe if the lock GRAPH stays acyclic, and PR #395's first independent review showed
// that claim rotting in the exact way prose rots: the comment asserted the one call out of a locked
// section acquired nothing, when in fact `on_session_finalized` → `history::ledger_len_checked` →
// `load_history` reaches `support_evidence::record`, which takes that module's own store lock. No
// cycle — but a lock ORDER nobody had written down, defended by a sentence that was wrong.
//
// WHAT THIS FILE IS, AFTER #398 — read this before trusting a green run.
//
// This is a CHANGE DETECTOR over statically-resolvable source text. It is NOT a proof that the lock
// graph is acyclic, and it never was; #398 measured that directly. A real self-deadlocking back edge
// was planted as a crate-root re-export —
//
//     lib.rs:      pub(crate) use comparison::report_tuning_crash as _r5_reexport;
//     history.rs:  fn ledger_len_checked() { let _ = crate::_r5_reexport(); ... }
//
// — and every assertion in this file stayed GREEN (31/31 at the time; 41/41 now) while `cargo test` deadlocked into
// `race_seam`'s runtime recorder with `RE-ENTRANT acquisition of COMPARISON_LOCK`. That is not a bug
// to fix here. Resolving `crate::_r5_reexport` to `comparison::report_tuning_crash` is NAME
// RESOLUTION, not parsing, so swapping this scanner for `syn` or tree-sitter would not close it
// either — only rustc's own resolver knows what that alias points at.
//
// The authority on lock ORDER is now `src-tauri/src/race_seam.rs`: a `#[cfg(test)]` thread-local
// stack of held store locks that panics on a re-entrant or undeclared nesting AS IT HAPPENS, so
// re-exports, macro-generated paths, trait-object dispatch and function pointers in structs are all
// caught by construction — it sees acquisitions, not text.
//
// This file is kept because the recorder does NOT subsume it. The recorder only sees nestings the
// suite actually EXECUTES, and rule B below fires on a new module edge whether or not any test
// drives it. The two are complementary; neither alone is sufficient. What this file may claim is
// bounded to that, and the assertion names below say so.
//
// It checks three things, all syntactic:
//
//   A. NO BACK EDGE, TRANSITIVELY. Nothing reachable from inside a store lock may call back into a
//      store module. The reachable set is COMPUTED from one seed — `history`, the module actually
//      called from inside a locked section — not listed by hand. That is what makes
//      COMPARISON_LOCK ⊃ SUPPORT_EVIDENCE_LOCK an order rather than a cycle.
//   B. NO NEW EDGE. The set of modules the three store modules reach at all is pinned. A new one is
//      not assumed to be a defect — it is assumed to be UNDERIVED. Adding it here is the moment
//      someone re-derives the order, which is the whole point.
//   C. NO UNCLASSIFIED LOCK (added in #398's second round). Rules A and B are about lock ORDER and
//      both presuppose that the set of locks is known. It was not: `race_seam::StoreLock` claimed
//      to enumerate every process-wide store lock while three were missing, including the
//      experiment gate that is the OUTER half of a live nesting into the Trust Ledger. `LOCK_CENSUS`
//      at the foot of this file now names every `static` mutex in `src-tauri/src` with a verdict,
//      and fails on a lock with no verdict, a verdict with no lock, or any drift between the
//      persistence-class rows and the release variants of `StoreLock`.
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

// The end of a string, byte string, raw string or char literal starting at `i`, or null if nothing
// starts there. Exported only so `stripNonCode` can be read as one thing; the interesting cases are
// pinned through `stripNonCode` itself.
//
// The `'` case is the one worth reading twice. Rust spells a char literal and a LIFETIME with the
// same character, and mistaking `&'static str` for an opening quote would swallow the rest of the
// file — turning a guard into a rubber stamp far more thoroughly than the defect this fixes.
function literalAt(src, i) {
  const prev = src[i - 1];
  const identBefore = prev !== undefined && /[A-Za-z0-9_]/.test(prev);

  // Raw / byte-raw string: r"..", r#".."#, br##".."##. The HASH COUNT decides the terminator, which
  // is the whole point of the form: a raw string may contain `"` and `//` and means neither.
  let j = i;
  if (src[j] === "b") j += 1;
  if (src[j] === "r" && !identBefore) {
    let k = j + 1;
    let hashes = 0;
    while (src[k] === "#") {
      hashes += 1;
      k += 1;
    }
    if (src[k] === '"') {
      const close = `"${"#".repeat(hashes)}`;
      const end = src.indexOf(close, k + 1);
      return end === -1 ? src.length : end + close.length;
    }
  }

  // Ordinary / byte string.
  j = i;
  if (src[j] === "b" && !identBefore) j += 1;
  if (src[j] === '"') {
    let k = j + 1;
    while (k < src.length) {
      if (src[k] === "\\") {
        k += 2; // an escaped character, `\"` included, cannot end the string
        continue;
      }
      if (src[k] === '"') return k + 1;
      k += 1;
    }
    return src.length; // unterminated: consume the rest rather than fall back into code mid-string
  }

  if (src[i] === "'") {
    if (src[i + 1] === "\\") {
      // '\n', '\'', '\u{1F600}' — start past the backslash AND the character it escapes.
      let k = i + 3;
      while (k < src.length && src[k] !== "'" && src[k] !== "\n") k += 1;
      return src[k] === "'" ? k + 1 : null;
    }
    if (src[i + 2] === "'") return i + 3; // 'a'
    // '😀' is two UTF-16 units in a JS string, so the closing quote sits one further out. Requiring
    // a high surrogate is what keeps `Foo<'a,'b>` from being read as the char literal `'a,'`.
    if (src[i + 3] === "'" && /[\uD800-\uDBFF]/.test(src[i + 1] ?? "")) return i + 4;
    return null; // a lifetime or a loop label: 'static, 'a, 'outer
  }

  return null;
}

/**
 * Rust source with COMMENTS removed and every literal left verbatim, so a module named in prose is
 * not read as a call and a call is not deleted by punctuation inside a string.
 *
 * Written as a scanner, not as the two regexes it replaces, because PR #395's FOURTH independent
 * review broke those with ordinary Rust — twice, each verified by mutating the real tree and
 * watching the guard stay 18/18 GREEN with a genuine `history -> comparison` back edge present:
 *
 *   1. `let _tip = "see https://example.com/ledger"; let _ = crate::comparison::armed();`
 *      Line comments were stripped with `/\/\/.*$/` per line. The `//` inside the URL matched
 *      first, so the rest of the line — the real call included — was deleted before anything read
 *      it. Any string holding a URL does this, which is not an exotic construct.
 *   2. `let _weird = "/* not a real comment"; let _ = crate::comparison::armed();` plus any
 *      ordinary block comment later in the file. Block comments were stripped with
 *      `/\/\*[\s\S]*?\*\//g`, which opened at the fake `/*` inside the string and closed at the
 *      first REAL terminator later in the file — swallowing everything in between. Same green,
 *      wider blast radius.
 *
 * That is the same lesson as `groupBody`, for the third time in this file: a regex cannot parse a
 * quoted or nested construct, and widening it again would be the same weak fix again. This tracks
 * the states Rust actually has — code, line comment, NESTING block comment, and the four literal
 * forms — which is what the regexes were pretending they did not need to.
 *
 * Literals are kept VERBATIM rather than blanked, deliberately. This file's stated bias is to fail
 * loudly rather than quietly: a module name written inside a string still counts as an edge and
 * still asks someone to re-derive. Blanking them would be the direction that fails silent.
 *
 * Block comments nest in Rust, so this counts depth. A terminator inside a string that is itself
 * inside a block comment still closes that comment — which is what rustc does too, because a
 * comment is lexed before anything knows what a string is.
 */
export function stripNonCode(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const literal = literalAt(src, i);
    if (literal !== null) {
      out += src.slice(i, literal); // verbatim, including its quotes — see the note above
      i = literal;
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (src[i] === "/" && src[i + 1] === "*") {
      let depth = 0;
      while (i < src.length) {
        if (src[i] === "/" && src[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (src[i] === "*" && src[i + 1] === "/") {
          depth -= 1;
          i += 2;
          if (depth === 0) break;
        } else {
          if (src[i] === "\n") out += "\n"; // keep the line structure a reader would expect
          i += 1;
        }
      }
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
}

function code(module) {
  return stripTestModules(stripNonCode(readFileSync(join(SRC, `${module}.rs`), "utf8")));
}

/**
 * Blank out every `#[cfg(test)] mod name { ... }`, keeping length so nothing else shifts.
 *
 * A call that exists only in a test module is not a production edge and must not be read as one.
 * This is not a convenience: without it, #398's own `race_seam::production_nesting_tests` — whose
 * entire job is to take `experiment`'s lock and then `history`'s — made `race_seam` look like it
 * calls into `experiment`, and the back-edge rule reported `history -> race_seam -> experiment ->
 * comparison` as a deadlock. That path cannot exist in a release build, where the whole module is
 * `#[inline(always)]` no-ops.
 *
 * It is also not a loophole. A back edge hidden inside a test module cannot deadlock a shipped
 * Compy, because the code is not in the binary; and if it deadlocks the SUITE, `race_seam`'s
 * recorder panics by name on the nesting, which is the check this file defers to anyway. What is
 * removed here is strictly `#[cfg(test)]`-gated, and `a_cfg_test_module_hides_no_production_code`
 * pins that the surrounding production text survives intact.
 */
function stripTestModules(src) {
  let out = src;
  for (;;) {
    const m = out.match(/#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]\s*mod\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/);
    if (!m) return out;
    const open = m.index + m[0].length - 1;
    const body = groupBody(out, open);
    // An unterminated group means the file is not what this scanner thinks it is. Stop rather than
    // guess — reading nothing beats reading wrongly, the same rule the rest of this file follows.
    if (body === null) return out.slice(0, m.index);
    const end = open + 1 + body.length + 1;
    out = out.slice(0, m.index) + " ".repeat(end - m.index) + out.slice(end);
  }
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

describe("#283 store locks: no back edge is VISIBLE IN THE SOURCE TEXT (a change detector, not a proof)", () => {
  // NOT "nothing reaches back into a store lock" — #398 planted a real one and this stayed green.
  // The claim is bounded to what `extractEdges` can resolve without a name resolver.
  it("no back edge into a store module is visible in statically-resolvable call and import text", () => {
    const via = closureFrom(LOCK_ENTRY_POINTS, edgesFrom);
    const back = STORE_MODULES.filter((store) => via.has(store));
    expect(
      back.map((store) => via.get(store).join(" -> ")),
      `a module reachable from inside a store lock calls back into ${back.join("/")}, which closes ` +
        `the loop into a deadlock. Break an edge on the path above, or move the call that reaches ` +
        `into that chain out of the locked section. (This firing is conclusive; this assertion ` +
        `passing is not — see the header, and race_seam.rs for the check that is.)`,
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

  // Review 4 broke the COMMENT STRIPPER rather than the edge extractor: both regexes it used were
  // blind to string literals, so ordinary Rust deleted a real call before `extractEdges` ever saw
  // it. Same `bug → guard` treatment — the stripper is a pure function now, and what it must and
  // must not remove is pinned here rather than discovered by the next reviewer.
  it.each([
    [
      // Review 4's finding 1, verbatim in shape.
      "a URL in a string, whose `//` used to delete the rest of the line",
      'fn f() {\n    let _tip = "see https://example.com/ledger"; let _ = crate::comparison::armed();\n}',
      ["comparison"],
    ],
    [
      // Review 4's finding 2: the fake opener pairs with a REAL terminator later in the file.
      "a `/*` inside a string, which used to swallow everything up to the next real `*/`",
      'fn f() {\n    let _w = "/* not a comment"; let _ = crate::comparison::armed();\n}\n/* an ordinary comment */',
      ["comparison"],
    ],
    [
      "a raw string, where `//` and `\"` are content and the hash count is the terminator",
      'fn f() {\n    let _s = r#"a // b " c"#; let _ = crate::comparison::armed();\n}',
      ["comparison"],
    ],
    [
      "a byte-raw string",
      'fn f() {\n    let _s = br#"// not a comment"#; let _ = crate::comparison::armed();\n}',
      ["comparison"],
    ],
    [
      "an escaped quote, which does not end the string it is inside",
      'fn f() {\n    let _s = "he said \\" // still a string"; let _ = crate::comparison::armed();\n}',
      ["comparison"],
    ],
    [
      // The one that would have been catastrophic rather than merely blind: `'` opening a literal
      // that never closes would blank every remaining edge in the file.
      "a LIFETIME, which is not a char literal however much it looks like one",
      'fn f() -> &\'static str { "x" }\nfn g() { let _ = crate::comparison::armed(); }',
      ["comparison"],
    ],
    [
      "a char literal that contains a quote",
      "fn f() { let _q = '\"'; let _ = crate::comparison::armed(); }",
      ["comparison"],
    ],
    [
      "a char literal that contains an escaped quote",
      "fn f() { let _q = '\\''; let _ = crate::comparison::armed(); }",
      ["comparison"],
    ],
    [
      "a generic with two lifetimes, which is not the char literal `'a,'`",
      "fn f<'a,'b>(x: &'a str, y: &'b str) { let _ = crate::comparison::armed(); }",
      ["comparison"],
    ],
  ])("still sees an edge past %s", (_shape, src, expected) => {
    expect(extractEdges(stripNonCode(src), "history")).toEqual(expected);
  });

  it.each([
    ["a line comment", "// use crate::comparison;\nfn f() {}"],
    ["a block comment", "/* let _ = crate::comparison::armed(); */"],
    ["a doc comment", "/// See crate::comparison::armed for the shape.\nfn f() {}"],
    [
      // Rust nests block comments; a first-`*/` match would end the outer one early and expose the
      // text after it as code.
      "a NESTED block comment",
      "/* outer /* inner */ let _ = crate::comparison::armed(); */",
    ],
  ])("still removes an edge written in %s", (_shape, src) => {
    expect(extractEdges(stripNonCode(src), "history")).toEqual([]);
  });

  it("does not read a same-file `super::` call as an edge to a module", () => {
    // `super::` inside `mod tests` is the containing file. `arm_at` is a function in comparison.rs,
    // not a module, so filtering candidates against the real module list is what keeps this quiet.
    expect(extractEdges("fn t() { super::arm_at(&p, a); }", "comparison")).toEqual([]);
    // And the module's own name reached through `super::` is not an edge OUT of it either.
    expect(extractEdges("fn t() { super::comparison::x(); }", "comparison")).toEqual([]);
  });

  // `bug → guard` for the narrowing `stripTestModules` performs. It removes text, so if it removed
  // the wrong text this file would go blind exactly where it looks safest. Both directions pinned.
  it("a cfg(test) module hides no production code", () => {
    const src = [
      "fn prod() { let _ = crate::history::load_history(); }",
      "#[cfg(test)]",
      "mod tests {",
      "    fn t() { let _ = crate::comparison::armed(); }",
      "    fn nested() { if true { let _ = crate::drift::x(); } }",
      "}",
      "fn after() { let _ = crate::support_evidence::record(); }",
    ].join("\n");
    // The test module's calls are gone; the production calls on BOTH sides of it survive.
    expect(extractEdges(stripTestModules(src), "readiness")).toEqual(["history", "support_evidence"]);
    // Unstripped, the same source reads as four edges — so the assertion above is measuring the
    // strip, not a source that never had them.
    expect(extractEdges(src, "readiness")).toEqual([
      "comparison",
      "drift",
      "history",
      "support_evidence",
    ]);
  });

  it("strips only cfg(test) modules, never an ordinary one", () => {
    const src = "mod helpers { fn t() { let _ = crate::comparison::armed(); } }";
    expect(extractEdges(stripTestModules(src), "history")).toEqual(["comparison"]);
    // A different cfg is not a test cfg.
    const dbg = '#[cfg(debug_assertions)]\nmod d { fn t() { crate::drift::x(); } }';
    expect(extractEdges(stripTestModules(dbg), "history")).toEqual(["drift"]);
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

// ─────────────────────────────────────────────────────────────────────────────────────────────
// #398 round 2 — THE COMPLETENESS TRIPWIRE
//
// Everything above is about lock ORDER. This block is about lock EXISTENCE, and it exists because
// the ordering work was built on a census that was silently wrong. `race_seam::StoreLock` claimed
// to enumerate every process-wide store lock and omitted three: `experiment::store_write_gate`,
// `intelligence::store_write_gate` and `benchmark::state_cache`. The Experiment gate is the outer
// half of a live nesting into the Trust Ledger, so the recorder was blessing a two-deep chain while
// seeing only its inner half. Nothing failed. Nothing could fail — no check compared the enum
// against the tree.
//
// So this is not another ordering rule. It is the check that the ordering rules are being applied
// to all the locks there are. It is deliberately a source scan, and deliberately dumb: it finds
// `static NAME: ...Mutex<..>/RwLock<..>...` and demands a written verdict for each one. A lock with
// no verdict fails. A verdict with no lock fails. A verdict of "persistence" that names no
// `StoreLock` variant fails, and a `StoreLock` variant no verdict claims fails.
//
// Same limits as the rest of this file: it reads text, not semantics. It cannot see a lock behind a
// macro or a type alias, and it is not a proof that the classifications below are CORRECT — those
// are arguments, written out so a reviewer can attack them. What it does is make silence
// impossible, which is the specific failure that happened.
// ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every `static` mutex/rwlock in `src-tauri/src`, keyed `module::NAME: TYPE`.
 *
 * The type is part of the key because names repeat — `intelligence` has two `GATE`s and
 * `monitoring` has three `CACHE`s — and their types are what tell them apart. Line numbers are
 * deliberately NOT part of the key: a census that fails when a lock moves down a file trains people
 * to update it without reading it.
 *
 * `class: "persistence"` means the lock serializes a read-modify-write of state that reaches disk.
 * Those, and only those, must appear in `race_seam::StoreLock`; the bijection is asserted below.
 * `class: "out"` means it does not, and `why` has to say what it guards instead.
 */
const LOCK_CENSUS = {
  // ── persistence: instrumented, one `StoreLock` variant each ────────────────────────────────
  "comparison::COMPARISON_LOCK: Mutex<()>": {
    class: "persistence",
    variant: "Comparison",
    why: "the armed baseline and the surfaced result — #283's original lost update",
  },
  "drift::DRIFT_LOCK: Mutex<()>": {
    class: "persistence",
    variant: "Drift",
    why: "load_state_from -> detect -> save_state_to of the drift store",
  },
  "readiness::DISMISSALS_LOCK: Mutex<()>": {
    class: "persistence",
    variant: "Readiness",
    why: "dismiss/restore read-modify-write of the readiness dismissals store",
  },
  "history::HISTORY_LOCK: Mutex<()>": {
    class: "persistence",
    variant: "History",
    why: "the Trust Ledger; every apply and every rollback runs under it",
  },
  "support_evidence::LOCK: OnceLock<Mutex<()>>": {
    class: "persistence",
    variant: "SupportEvidence",
    why: "append/clear of the support record — the leaf of every declared nesting",
  },
  "incident_observer::STATE_LOCK: Mutex<()>": {
    class: "persistence",
    variant: "IncidentObserver",
    why: "the persisted observer watermark and remembered incident rows",
  },
  "benchmark_scoreboard::SCOREBOARD_LOCK: Mutex<()>": {
    class: "persistence",
    variant: "BenchmarkScoreboard",
    why: "read-modify-write of the awards scoreboard",
  },
  "experiment::GATE: OnceLock<Mutex<()>>": {
    class: "persistence",
    variant: "Experiment",
    why:
      "the store gate the three lifecycle commands hold across their whole read-modify-write of " +
      "the experiment store — and, being held across history::apply_recommendation and " +
      "history::rollback_change, the outermost lock the crate takes. Missing from the first " +
      "version of StoreLock; this census exists because of it.",
  },
  "intelligence::GATE: OnceLock<Mutex<()>>": {
    class: "persistence",
    variant: "Intelligence",
    why: "load_store -> append_if_changed -> save_store on the identity log",
  },
  "benchmark::CACHE: OnceLock<Mutex<BenchmarkState>>": {
    class: "persistence",
    variant: "Benchmark",
    why:
      "reads as an in-memory cache and is not one: set_baseline and clear_baseline hold it ACROSS " +
      "save_store, so a torn window here is a torn benchmark store",
  },
  "noise_floor::GATE: OnceLock<Mutex<()>>": {
    class: "persistence",
    variant: "NoiseFloor",
    why:
      "noise_floor::write_gate, held across load_from -> upsert -> save_to of noise_floors.json " +
      "(P4-noise-store), so two calibrations finishing together cannot drop one. Taken only " +
      "through noise_floor::lock_gate; a leaf that reaches no other store.",
  },

  // ── out of class ───────────────────────────────────────────────────────────────────────────
  "gaming_orchestrator::SESSION_OP: Mutex<()>": {
    class: "out",
    why:
      "guards persisted session operations, but is taken ONLY through try_lock: contention returns " +
      "a user-facing 'try again' and a poisoned lock is taken over. It never waits, and a lock " +
      "that never waits can neither deadlock nor be an edge of a cycle — which is the only hazard " +
      "race_seam measures. It also reaches no other store: gaming_orchestrator.rs contains no call " +
      "into history, comparison or support_evidence at all. The try_lock property is what this " +
      "verdict rests on, so it is asserted below rather than left as prose.",
  },
  "gaming_orchestrator::LIVE_SESSION: Mutex<Option<String>>": {
    class: "out",
    why: "an in-memory session-id marker; nothing is persisted under it",
  },
  "benchmark_trial::S: OnceLock<Mutex<TrialState>>": {
    class: "out",
    why:
      "in-memory trial state. Measured, not assumed: benchmark_trial.rs contains no save_*, no " +
      "write_atomic, no store_path and no compy_data_dir — it persists nothing at all.",
  },
  "intelligence::GATE: OnceLock<Mutex<Option<Instant>>>": {
    class: "out",
    why: "refresh_gate — a throttle timestamp whose scope closes before the work is spawned",
  },
  "cpu_temp::TEMP_CACHE: Mutex<Option<(std::time::Instant, Option<CpuTemp>)>>": {
    class: "out",
    why: "a sensor read cache; sensors are read-only and nothing is written back to disk",
  },
  "monitoring::CACHE: OnceLock<Mutex<CpuSensorSnapshot>>": {
    class: "out",
    why: "CPU sensor snapshot cache; a probe result, not a store",
  },
  "monitoring::CACHE: OnceLock<Mutex<Vec<GpuSensorSnapshot>>>": {
    class: "out",
    why: "AMD GPU sensor snapshot cache; a probe result, not a store",
  },
  "monitoring::CACHE: OnceLock<Mutex<Option<bool>>>": {
    class: "out",
    why: "FreeSync detection cache; a probe result, not a store",
  },
  "monitoring::S: OnceLock<Mutex<String>>": {
    class: "out",
    why: "the FPS status string the UI renders; in-memory only",
  },
  "monitoring::SYS: OnceLock<Mutex<System>>": {
    class: "out",
    why: "the sysinfo handle used for memory-pressure reads; a probe handle, not a store",
  },
  "lib::UPDATE_RESTART_BARRIER: Mutex<bool>": {
    class: "out",
    why: "a one-shot restart barrier flag guarding no persisted state",
  },
  "race_seam::GATE: Mutex<()>": {
    class: "out",
    why:
      "the seam's OWN arming gate, cfg(test) only and absent from a release build. It serializes " +
      "armed tests against each other; instrumenting the recorder with itself would be circular.",
  },
};

/** `static NAME: <type containing Mutex< or RwLock<> =` — comments and string literals stripped. */
function scanLocks() {
  const out = new Map();
  for (const file of readdirSync(SRC).filter((f) => f.endsWith(".rs"))) {
    const module = file.slice(0, -3);
    const src = stripNonCode(readFileSync(join(SRC, file), "utf8"));
    for (const m of src.matchAll(/\bstatic\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=;]*?)\s*=/g)) {
      const type = m[2].replace(/\s+/g, " ").replace(/\bstd::sync::/g, "").trim();
      if (!/\b(Mutex|RwLock)\s*</.test(type)) continue;
      out.set(`${module}::${m[1]}: ${type}`, { module, name: m[1], type });
    }
  }
  return out;
}

/** The `StoreLock` variants that exist in a RELEASE build (the cfg(test) ones are synthetic). */
function productionStoreLockVariants() {
  const src = stripNonCode(readFileSync(join(SRC, "race_seam.rs"), "utf8"));
  const open = src.indexOf("{", src.indexOf("enum StoreLock"));
  const body = groupBody(src, open);
  if (body === null) return [];
  const variants = [];
  for (const part of body.split(",")) {
    if (/#\s*\[\s*cfg\s*\(\s*test\s*\)\s*\]/.test(part)) continue;
    const m = part.match(/(?:^|\])\s*([A-Z][A-Za-z0-9_]*)\s*$/);
    if (m) variants.push(m[1]);
  }
  return variants;
}

describe("#398 completeness: no process-wide lock can be left out of the lock model silently", () => {
  it("finds locks at all, so the set comparisons below cannot pass vacuously", () => {
    const found = scanLocks();
    // A scanner that found nothing would make every assertion below trivially true, which is how
    // the omission this block exists to catch survived in the first place: no check, no failure.
    expect(found.size).toBeGreaterThanOrEqual(20);
    expect([...found.keys()]).toContain("history::HISTORY_LOCK: Mutex<()>");
    expect([...found.keys()]).toContain("experiment::GATE: OnceLock<Mutex<()>>");
  });

  it("every static mutex in the tree carries a written verdict", () => {
    const missing = [...scanLocks().keys()].filter((k) => !(k in LOCK_CENSUS)).sort();
    expect(
      missing,
      `a process-wide lock exists that LOCK_CENSUS does not classify: ${missing.join(", ")}. ` +
        `Decide whether it serializes a read-modify-write that reaches disk. If it does, it is ` +
        `"persistence": add a StoreLock variant, route EVERY acquisition site through one ` +
        `recorded helper, and derive its nestings. If it does not, add it as "out" with the ` +
        `reason. Do not add it as "out" to make this green — that is the exact move that made ` +
        `this block necessary.`,
    ).toEqual([]);
  });

  it("every verdict still names a lock that exists", () => {
    const found = scanLocks();
    const ghosts = Object.keys(LOCK_CENSUS)
      .filter((k) => !found.has(k))
      .sort();
    expect(
      ghosts,
      `LOCK_CENSUS classifies locks that are no longer in the tree: ${ghosts.join(", ")}. A stale ` +
        `census reads as coverage it does not have — delete the rows, and the StoreLock variants ` +
        `they claim if nothing else uses them.`,
    ).toEqual([]);
  });

  it("persistence locks and production StoreLock variants are a bijection", () => {
    const claimed = Object.values(LOCK_CENSUS)
      .filter((v) => v.class === "persistence")
      .map((v) => v.variant);
    const declared = productionStoreLockVariants();

    // Not vacuous, and not silently truncated by a parse failure.
    expect(declared.length).toBeGreaterThanOrEqual(10);
    expect(declared).toContain("Experiment");

    expect(new Set(claimed).size, "two census rows claim the same StoreLock variant").toBe(
      claimed.length,
    );
    expect(
      [...claimed].sort(),
      `the persistence locks in LOCK_CENSUS and the release variants of race_seam::StoreLock have ` +
        `drifted apart. A variant with no lock is dead; a lock with no variant is exactly the ` +
        `omission #398's second review found.`,
    ).toEqual([...declared].sort());
  });

  it("every census verdict actually says something", () => {
    for (const [key, v] of Object.entries(LOCK_CENSUS)) {
      expect(["persistence", "out"], `${key} has no class`).toContain(v.class);
      expect(v.why.length, `${key}'s verdict carries no reasoning`).toBeGreaterThan(30);
      if (v.class === "persistence") {
        expect(typeof v.variant, `${key} names no StoreLock variant`).toBe("string");
      }
    }
  });

  it("SESSION_OP is still try_lock-only, which is the whole basis of its out-of-class verdict", () => {
    const src = code("gaming_orchestrator");
    expect(src).toContain("SESSION_OP.try_lock()");
    // A blocking acquisition would make it a waiting lock, and a waiting lock CAN deadlock — at
    // which point the verdict above is wrong and it needs instrumenting like the rest.
    const calls = [...src.matchAll(/SESSION_OP\s*\.\s*([a-z_]+)\s*\(/g)]
      .map((m) => m[1])
      .filter((f) => f !== "try_lock");
    expect(
      calls,
      "SESSION_OP gained a blocking acquisition; re-derive its classification in LOCK_CENSUS",
    ).toEqual([]);
  });
});

describe("#398: the source half of the Experiment -> History claim", () => {
  // race_seam.rs's production_nesting_tests prove the recorder BLESSES Experiment -> History and
  // panics on the inverse. They cannot prove production actually nests them that way, because
  // walking start_experiment in a test build reaches the owner's real %APPDATA%\Compy. That half is
  // a source fact, so it is checked as a source fact — here, where a moved or deleted call site
  // fails by name instead of quietly turning the runtime tests into a claim about nothing.
  const experimentGateSections = () => {
    const src = code("experiment");
    const sections = [];
    for (const m of src.matchAll(/let\s+_g\s*=\s*lock_store\(\)\?;/g)) {
      const rest = src.slice(m.index);
      const end = rest.slice(1).search(/\n(?:pub\(crate\) |pub )?fn\s/);
      sections.push(end === -1 ? rest : rest.slice(0, end + 1));
    }
    return sections;
  };

  // The three lifecycle sections (start, conclude, restore) enter HISTORY_LOCK; the fourth is the
  // launch reconcile (#583), which only READS the ledger through load_history under the gate (via
  // reconcile_pending_locked, which start_experiment also calls) — an Experiment -> SupportEvidence
  // path on a corrupt ledger, never Experiment -> History.
  const fnBody = (src, sig) => {
    const at = src.indexOf(sig);
    expect(at, `${sig} is missing`).toBeGreaterThanOrEqual(0);
    const rest = src.slice(at + sig.length);
    const end = rest.search(/\n(?:pub\(crate\) |pub )?fn\s/);
    return end === -1 ? rest : rest.slice(0, end);
  };

  it("all four experiment gate sections take the gate through the recorded helper", () => {
    expect(experimentGateSections()).toHaveLength(4);
    expect(fnBody(code("experiment"), "fn reconcile_interrupted_starts()")).toMatch(
      /let\s+_g\s*=\s*lock_store\(\)\?;/,
    );
    const src = code("experiment");
    expect(
      [...src.matchAll(/store_write_gate\s*\(\s*\)\s*\.\s*lock\s*\(/g)].length,
      "an experiment acquisition bypasses lock_store(), so it is unrecorded",
    ).toBe(1); // exactly one: the acquisition inside lock_store() itself
  });

  it("each of those sections still enters the Trust Ledger under the gate", () => {
    const entering = experimentGateSections().filter((s) =>
      /crate::history::(apply_recommendation|rollback_change)\s*\(/.test(s),
    );
    for (const sig of ["fn reconcile_interrupted_starts()", "fn reconcile_pending_locked("]) {
      expect(
        fnBody(code("experiment"), sig),
        `${sig} must stay read-only against the ledger`,
      ).not.toMatch(/crate::history::(apply_recommendation|rollback_change)\s*\(/);
    }
    expect(
      entering,
      "Experiment -> History is declared in race_seam::ALLOWED_NESTING and exercised by " +
        "race_seam::production_nesting_tests, but no experiment section reaches history any more. " +
        "Either the call moved (re-derive it), or the nesting is gone (delete the pair and the " +
        "tests that assert it).",
    ).toHaveLength(3);
  });
});
