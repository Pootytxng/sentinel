#!/usr/bin/env node
// verify-module-map.mjs - mechanized drift check for CLAUDE.md's Rust module map.
//
// The map's own stated contract is "scope any mutation-gate change against these starred modules
// first", so a module missing from it is a navigation defect AT the safety boundary, not a cosmetic
// one. Audit 2026-08-02: the map claimed "Complete as of 2026-07-14 (35 `.rs` files)" while the tree
// held 44 - eight modules (7,730 lines, incl. intelligence.rs at 3,613, the second-largest module in
// the core) were invisible to every session that trusted it. This script makes that class of drift
// mechanically impossible to reintroduce, instead of relying on someone remembering to update prose.
//
// Sibling of scripts/verify-release-state.mjs (same gate-drift-audit family, same exit contract).
// Run from anywhere: node scripts/verify-module-map.mjs [--strict] [--json]
//   exit 0 = map matches the tree (line-count drift WARNs unless --strict)
//   exit 1 = MISSING / GHOST / COUNT / UNSTARRED-MUTATOR, or the map section is absent entirely.
// That last case guards the f21c170 gutted-doc class: a verifier that passes vacuously on a deleted
// contract is worse than no verifier, so an absent section is a hard failure, never a silent pass.
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAP_HEADING = "### Rust module map";

// Conservative on purpose. `Command::new` is deliberately NOT a marker: read-only probes spawn
// processes all over this codebase (hardware.rs, monitoring.rs, cpu_temp.rs), and a detector that
// cries wolf gets muted rather than fixed. These five are writes to Windows state, or the
// elevation helper itself - the actual mutation boundary described by LOCKED rule 3.
export const MUTATION_MARKERS = [
  "run_elevated_powershell",
  "set_value",
  "set_raw_value",
  "create_subkey",
  "delete_value",
  "delete_subkey",
];

// The map says its line counts are rough and "drift, treat as rough" - so only flag real divergence.
export const LOC_TOLERANCE = 0.25;

export function extractMapSection(text) {
  const start = text.indexOf(MAP_HEADING);
  if (start === -1) return null;
  const rest = text.slice(start + MAP_HEADING.length);
  const end = rest.search(/\n## /);
  return end === -1 ? rest : rest.slice(0, end);
}

export function declaredCount(section) {
  const m = section.match(/\((\d+)\s+`\.rs`\s+files/);
  return m ? Number(m[1]) : null;
}

// One bullet can name several modules (e.g. `amd_freesync.rs`, `overlay_tools.rs`, `hwchange.rs`
// share a line), so star attribution is per-line: every module named on a starred line inherits it.
export function declaredModules(section) {
  const modules = new Map();
  for (const line of section.split("\n")) {
    if (!line.trimStart().startsWith("-")) continue;
    const starred = line.includes("★");
    for (const m of line.matchAll(/`([A-Za-z0-9_]+\.rs)`(?:\s*\(~(\d+)\))?/g)) {
      const [, name, loc] = m;
      if (!modules.has(name)) modules.set(name, { starred, loc: loc ? Number(loc) : null });
    }
  }
  return modules;
}

// Markers only count where code actually runs. Comments describing the mutation boundary are
// everywhere in this repo - main.rs's only "hit" was a comment naming run_elevated_powershell, and
// three of lib.rs's four were doc-comments - and #[cfg(test)] modules are not the product. Scanning
// raw text made this fire on both. A detector that cries wolf gets muted rather than fixed.
// Brace counting here ignores braces inside string/char literals; that is tolerable because the
// worst case is stripping slightly too much test code, never leaking a test block into production.
export function stripCfgTestModules(src) {
  let out = "";
  let index = 0;
  for (;;) {
    const hit = src.indexOf("#[cfg(test)]", index);
    if (hit === -1) return out + src.slice(index);
    out += src.slice(index, hit);
    const open = src.indexOf("{", hit);
    if (open === -1) return out;
    let depth = 0;
    let cursor = open;
    for (; cursor < src.length; cursor++) {
      if (src[cursor] === "{") depth++;
      else if (src[cursor] === "}" && --depth === 0) {
        cursor++;
        break;
      }
    }
    index = cursor;
  }
}

export function productionSource(src) {
  return stripCfgTestModules(src.replace(/\/\/[^\n]*/g, ""));
}

export function actualModules(dir) {
  const out = new Map();
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      for (const [k, v] of actualModules(full)) out.set(k, v);
    } else if (entry.endsWith(".rs")) {
      const src = readFileSync(full, "utf8");
      const production = productionSource(src);
      out.set(entry, {
        lines: src.split("\n").length,
        mutates: MUTATION_MARKERS.filter((marker) => production.includes(marker)),
      });
    }
  }
  return out;
}

export function compare(declared, actual, count) {
  const failures = [];
  const warnings = [];
  for (const [name, info] of actual) {
    if (!declared.has(name)) {
      failures.push(`MISSING: ${name} (${info.lines} lines) is on disk but absent from the map`);
      continue;
    }
    const entry = declared.get(name);
    if (info.mutates.length && !entry.starred) {
      failures.push(
        `UNSTARRED-MUTATOR: ${name} touches Windows state (${info.mutates.join(", ")}) but carries no star in the map`,
      );
    }
    if (entry.loc && Math.abs(entry.loc - info.lines) / info.lines > LOC_TOLERANCE) {
      warnings.push(`STALE-LOC: ${name} map says ~${entry.loc}, tree has ${info.lines}`);
    }
  }
  for (const name of declared.keys()) {
    if (!actual.has(name)) failures.push(`GHOST: ${name} is named in the map but not on disk`);
  }
  if (count === null) failures.push("COUNT: the map declares no `.rs` file count");
  else if (count !== actual.size) {
    failures.push(`COUNT: map declares ${count} .rs files, tree has ${actual.size}`);
  }
  return { failures, warnings };
}

const IS_MAIN =
  !!process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (IS_MAIN) {
  const strict = process.argv.includes("--strict");
  const asJson = process.argv.includes("--json");
  const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const brief = join(repo, "CLAUDE.md");
  const rustSrc = join(repo, "src-tauri", "src");

  const section = existsSync(brief) ? extractMapSection(readFileSync(brief, "utf8")) : null;
  if (section === null) {
    console.error(`FAIL: "${MAP_HEADING}" section not found in CLAUDE.md - an absent contract is a failure, not a pass.`);
    process.exit(1);
  }

  const declared = declaredModules(section);
  const actual = actualModules(rustSrc);
  const { failures, warnings } = compare(declared, actual, declaredCount(section));
  const hard = strict ? [...failures, ...warnings] : failures;

  if (asJson) {
    console.log(JSON.stringify({ declared: declared.size, actual: actual.size, failures, warnings }, null, 2));
  } else {
    for (const w of warnings) console.log(`WARN  ${w}`);
    for (const f of failures) console.error(`FAIL  ${f}`);
    if (!hard.length) {
      console.log(`OK    module map matches the tree (${actual.size} .rs files, ${[...declared.values()].filter((d) => d.starred).length} starred).`);
    }
  }
  process.exit(hard.length ? 1 : 0);
}
