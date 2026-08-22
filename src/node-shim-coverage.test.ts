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

// ── Arity ────────────────────────────────────────────────────────────────────────────────────────
//
// THE SECOND HALF OF THE SAME DEFECT (2026-08-22). The block above proves every builtin binding a
// guard imports is DECLARED. It says nothing about whether the guard CALLS it in the one shape the
// shim declares. src/ui-vision-status-guard.test.ts called `writeFileSync(path, data)`; the shim
// deliberately types it as `(path, data, encoding: "utf8")` -- three required arguments, so a guard
// can never quietly start writing binary. vitest transpiles without typechecking, so `npm test` was
// green across 363 files while `npm run build` (and therefore the RELEASE BUILD) was red. Same
// failure mode as 9aa42b5, one layer deeper.
//
// This UNDER-reports on purpose. Anything it cannot read confidently -- a call inside a template
// literal, a shadowed local name, an unbalanced scan -- is skipped rather than guessed at, because a
// guard that cries wolf gets muted. tsc is still the backstop; this exists to fail in the lane the
// author actually runs, before the build does.

/** Comments blanked and string CONTENTS replaced by `x`, positions preserved. Lets the scanners
 *  below count real commas without seeing the ones inside a string or a comment. */
function mask(src: string): string {
  const out = src.split("");
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") out[i++] = " ";
      continue;
    }
    if (c === "/" && d === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) {
        if (src[i] !== "\n") out[i] = " ";
        i++;
      }
      if (i < n) {
        out[i] = " ";
        out[i + 1] = " ";
        i += 2;
      }
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      i++;
      while (i < n) {
        if (src[i] === "\\") {
          out[i] = "x";
          if (src[i + 1] !== "\n") out[i + 1] = "x";
          i += 2;
          continue;
        }
        if (src[i] === c) break;
        if (src[i] !== "\n") out[i] = "x";
        i++;
      }
      i++;
      continue;
    }
    i++;
  }
  return out.join("");
}

/** Top-level arguments of the parenthesised group whose `(` is at `open`. null if it does not close
 *  or nests past what a scanner should trust. */
function argsAt(masked: string, open: number): string[] | null {
  let depth = 0;
  const parts: string[] = [];
  let current = "";
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === "(" || c === "[" || c === "{") {
      depth++;
      if (depth === 1) continue;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        if (current.trim()) parts.push(current.trim());
        return parts;
      }
      if (depth < 0) return null;
    } else if (c === "," && depth === 1) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    if (depth >= 1) current += c;
  }
  return null;
}

/** min/max declared arity per `module.name`, folded across overloads. */
const declaredArity = new Map<string, { min: number; max: number }>();
{
  // The module NAME is a string literal, so it must be read before masking — masking is what makes
  // the body countable, and it would turn "fs" into "xx".
  for (const m of shimText.matchAll(/declare module "([^"]+)"\s*\{([\s\S]*?)\n\}/g)) {
    const mod = m[1].replace(/^node:/, "");
    const body = mask(m[2]);
    for (const f of body.matchAll(/export\s+function\s+(\w+)\s*\(/g)) {
      const params = argsAt(body, f.index! + f[0].length - 1);
      if (!params) continue;
      const rest = params.some((prm) => prm.startsWith("..."));
      const required = params.filter((prm) => !prm.startsWith("...") && !/^\w+\?/.test(prm)).length;
      const key = `${mod}.${f[1]}`;
      const prev = declaredArity.get(key);
      const next = { min: required, max: rest ? Number.POSITIVE_INFINITY : params.length };
      declaredArity.set(
        key,
        prev ? { min: Math.min(prev.min, next.min), max: Math.max(prev.max, next.max) } : next,
      );
    }
  }
}

type CallSite = { file: string; key: string; args: number; min: number; max: number };
const callSites: CallSite[] = [];
for (const u of uses) {
  const masked = mask(readFileSync(u.file, "utf8"));
  for (const name of u.names) {
    const spec = declaredArity.get(`${u.module}.${name}`);
    if (!spec) continue; // not a function, or undeclared — the tests above own that
    for (const hit of masked.matchAll(new RegExp(`(^|[^\\w.$])${name}\\s*\\(`, "g"))) {
      const open = hit.index! + hit[0].length - 1;
      const args = argsAt(masked, open);
      if (!args) continue; // unreadable — skip rather than guess
      callSites.push({ file: u.file, key: `${u.module}.${name}`, args: args.length, min: spec.min, max: spec.max });
    }
  }
}

describe("guards call the shimmed builtins in the shape the shim declares", () => {
  it("the scan is real — it found declarations and call sites to check", () => {
    expect(declaredArity.size, "no `export function` parsed out of the shim — the parser broke").toBeGreaterThanOrEqual(5);
    expect(callSites.length, "no shimmed calls found in src/ — the call scanner stopped matching").toBeGreaterThan(20);
    // And it can still count: a two-argument readFileSync is the shape the corpus is full of.
    expect(callSites.some((c) => c.key === "fs.readFileSync" && c.args === 2)).toBe(true);
  });

  it("no guard calls a shimmed builtin with the wrong number of arguments", () => {
    const wrong = callSites
      .filter((c) => c.args < c.min || c.args > c.max)
      .map((c) => `${c.file}: ${c.key}(${c.args} args) — the shim declares ${c.min}${c.max === c.min ? "" : `..${c.max === Number.POSITIVE_INFINITY ? "n" : c.max}`}`);
    expect(
      [...new Set(wrong)],
      `These calls do not match src/test-node-shims.d.ts, so tsc fails — which means \`npm run build\`\n` +
        `and \`npm run tauri build\` fail, while \`npm test\` stays green. Fix the CALL first: the shim's\n` +
        `narrow signatures are deliberate (explicit "utf8", text not Buffer). Widen the shim only if the\n` +
        `real Node signature genuinely allows what you need, and say why in a comment there.`,
    ).toEqual([]);
  });
});
