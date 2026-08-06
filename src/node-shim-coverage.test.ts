// @vitest-environment node
// NODE-SHIM COVERAGE GUARD (2026-08-05).
//
// WHY THIS EXISTS. `@types/node` is deliberately not a dependency, so the Node builtins the
// source-scanning guard tests import are typed by hand in src/test-node-shims.d.ts. Nothing kept
// that file honest. On 2026-08-05 commit 9aa42b5 added a guard test importing `os` and
// `child_process`, and a second added `Buffer` — none of them declared. `npm test` stayed green,
// because vitest does not typecheck. What went red was `npm run build` (`tsc && vite build`), which
// is also tauri.conf.json's beforeBuildCommand: the RELEASE BUILD was broken for a day by a test file.
//
// That is the gap this closes. tsc already catches it perfectly — in a lane the author of a guard
// test does not run. This guard fails in the lane they do run, and says exactly what to add.
//
// Scope is src/ on purpose: tsconfig.json's `include` is ["src"], so those are the files tsc reads.
// scripts/*.mjs are never typechecked and are none of this guard's business.
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const SRC = "src";
const SHIM = join(SRC, "test-node-shims.d.ts");

/** Node builtins a guard in this repo could plausibly reach for. Not the complete Node surface —
 *  an unlisted builtin simply is not checked, which is safe: tsc still fails on it downstream. */
const NODE_BUILTINS = new Set([
  "assert", "buffer", "child_process", "crypto", "events", "fs", "http", "https", "module", "net",
  "os", "path", "process", "readline", "stream", "timers", "tty", "url", "util", "worker_threads",
  "zlib",
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);

/** Every `import ... from "<spec>"` in the typechecked corpus that resolves to a Node builtin. */
const IMPORT_RE = /import\s+(?:type\s+)?([^;]*?)\s+from\s+["']([^"']+)["']/g;

type Use = { file: string; module: string; names: string[] };

const uses: Use[] = [];
for (const file of files) {
  if (file === SHIM) continue;
  for (const m of readFileSync(file, "utf8").matchAll(IMPORT_RE)) {
    const module = m[2].replace(/^node:/, "");
    if (!NODE_BUILTINS.has(module)) continue;
    const clause = m[1].trim();
    // `{ a, b as c }` -> ["a", "b"]. A namespace or default import names nothing specific, so it
    // only demands that the module itself be declared.
    const braced = clause.match(/\{([\s\S]*)\}/);
    const names = braced
      ? braced[1].split(",").map((s) => s.split(/\s+as\s+/)[0].trim()).filter(Boolean)
      : [];
    uses.push({ file, module, names });
  }
}

const shimText = readFileSync(SHIM, "utf8");
const declared = new Map<string, Set<string>>();
for (const m of shimText.matchAll(/declare module "([^"]+)"\s*\{([\s\S]*?)\n\}/g)) {
  const exported = new Set<string>();
  for (const e of m[2].matchAll(/export\s+(?:function|const|let|class|interface|type)\s+(\w+)/g)) {
    exported.add(e[1]);
  }
  declared.set(m[1].replace(/^node:/, ""), exported);
}

describe("hand-written Node shims cover everything the typechecked corpus imports", () => {
  it("the corpus is real — a scan that finds nothing passes vacuously", () => {
    // The weak part of an inverted-corpus guard is the corpus. If a refactor moves the guard tests
    // or breaks the import regex, every assertion below goes green by finding nothing at all.
    expect(files.length, "src/ scan found almost no TypeScript — the walk is broken").toBeGreaterThan(40);
    expect(new Set(uses.map((u) => u.module)).size, "no Node-builtin imports found in src/ — the import regex stopped matching")
      .toBeGreaterThanOrEqual(3);
    expect(declared.size, `${SHIM} declares no modules — it was emptied or the parser broke`).toBeGreaterThanOrEqual(3);
  });

  it("every imported builtin module is declared", () => {
    const undeclaredModules = [...new Set(uses.filter((u) => !declared.has(u.module)).map((u) => `${u.module} (${u.file})`))];
    expect(
      undeclaredModules,
      `These Node builtins are imported under src/ but have no \`declare module\` in ${SHIM}.\n` +
        `tsc fails on them, which means \`npm run build\` and \`npm run tauri build\` fail — not just your editor.\n` +
        `Add a minimal declaration for the surface actually used, nothing more.`,
    ).toEqual([]);
  });

  it("every named import from a builtin is declared on that module", () => {
    const missing: string[] = [];
    for (const u of uses) {
      const exported = declared.get(u.module);
      if (!exported) continue; // already reported by the test above
      for (const name of u.names) {
        if (!exported.has(name)) missing.push(`${u.module}.${name} — imported by ${u.file}`);
      }
    }
    expect(
      [...new Set(missing)],
      `These bindings are imported from a shimmed builtin that does not export them.\n` +
        `Add the one function you call to ${SHIM}; do not paste in the real Node signature.`,
    ).toEqual([]);
  });
});
