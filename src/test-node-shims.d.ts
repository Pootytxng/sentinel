// Minimal Node-builtin type shims so tsc resolves `fs`/`path` in sweep-guard.test.ts without
// @types/node (not a project dependency). Real implementations exist at runtime under vitest's Node
// environment; only this test imports them. A .d.ts with no top-level import/export is script-context,
// so these are ambient MODULE declarations (creation), not augmentations.
declare module "fs" {
  export function readdirSync(path: string, options: { recursive: true }): string[];
  export function readdirSync(path: string): string[];
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function statSync(path: string): { isDirectory(): boolean; isFile(): boolean };
}
declare module "path" {
  export function join(...parts: string[]): string;
}
