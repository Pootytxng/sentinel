// Minimal Node-builtin type shims so tsc resolves the builtins the source-scanning guard tests
// import, without @types/node (not a project dependency). Real implementations exist at runtime
// under vitest's Node environment; only those tests import them. A .d.ts with no top-level
// import/export is script-context, so these are ambient MODULE declarations (creation), not
// augmentations, and a bare `declare const` here is a real ambient global.
// Declare only what a guard actually calls — a surface added here is a surface tsc stops questioning.
//
// KEEPING THIS IN SYNC IS NOT OPTIONAL. `npm run build` is `tsc && vite build` and tauri.conf.json's
// beforeBuildCommand calls it, so a guard test that imports an undeclared builtin does not merely
// annoy an editor — it fails the RELEASE BUILD while `npm test` stays green. That is exactly how
// 9aa42b5 landed: it added os + child_process imports here-unmentioned and broke `npm run build`.
// src/node-shim-coverage.test.ts now fails in the vitest lane instead, where the author will see it.
declare module "fs" {
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string, options: { recursive: true }): string[];
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
  // affordance-census.test.ts re-records its baseline behind an env var. Typed at that one shape:
  // text out, explicit encoding, no Buffer overload — a guard should never be writing binary.
  export function writeFileSync(path: string, data: string, encoding: "utf8"): void;
}
declare module "path" {
  export function join(...parts: string[]): string;
  // reachability-guard.test.ts walks the import graph: dirname+resolve turn a relative specifier
  // into the absolute path the graph is keyed on.
  export function dirname(p: string): string;
  export function resolve(...parts: string[]): string;
}
declare module "os" {
  export function homedir(): string;
}
declare module "child_process" {
  // Typed at the one call shape a guard uses: capture stdout as text, feed stdin, tolerate a
  // nonzero exit via try/catch. Deliberately NOT the real overloaded signature — a Buffer-returning
  // variant declared here would let a guard silently start comparing Buffers to strings.
  export function execFileSync(
    file: string,
    args: string[],
    options: { input?: string; encoding: "utf8" },
  ): string;
}
// Global, not a module: guards use it only to measure a doc's real byte size, which is what a
// boot-tax budget is actually spending. `.length` would count UTF-16 code units and undercount.
declare const Buffer: {
  byteLength(input: string, encoding: "utf8"): number;
};
// Also global, not a module. Declared at `env` alone: the only thing a guard here legitimately wants
// from the process is an opt-in switch (COMPY_RECORD_AFFORDANCES). Values are `| undefined` on
// purpose so an unset variable can never silently compare equal to a string.
declare const process: {
  env: Record<string, string | undefined>;
};
