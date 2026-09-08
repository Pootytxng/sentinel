import { readdirSync, readFileSync } from "fs";
import { describe, expect, it } from "vitest";

// Repository-relative paths, read from the root vitest runs in - the same shape as the sibling
// guards in src/, and the shape the app tsconfig (no Node types) can type-check.
const read = (path: string) => readFileSync(path, "utf8");

const BOOTSTRAPS = [
  "CLAUDE.md",
  "AGENTS.md",
  "docs/WORK_CONTROL.md",
  "docs/product/CONSTITUTIONAL_MIGRATION.md",
] as const;
const ROUTERS = ["tools/entry/select.mjs", "tools/entry/preflight.mjs"] as const;
// Codex-side surfaces. They describe the per-run sandbox DEFAULT (.codex/config.toml's read-only +
// never floor), not the lease law itself, so the positive lease markers are not required of them -
// but the retired fixed-role sentences are forbidden here exactly as in the bootstraps.
const CODEX_SURFACES = [
  ".codex/README.md",
  ...readdirSync(".codex/agents")
    .filter((name) => name.endsWith(".toml"))
    .sort()
    .map((name) => `.codex/agents/${name}`),
];

const PERMANENT_ROLE_PATTERNS = [
  /Claude Code is the default implementation owner/i,
  /Codex is the default independent reviewer/i,
  /Claude Code:\s*sole implementation writer/i,
  /Codex:\s*optional additional read-only/i,
  /Either model may become the sole implementation writer only/i,
];

describe("dynamic mutation lease control law", () => {
  it("routes all model bootstraps through overlapping-scope mutation leases", () => {
    for (const path of BOOTSTRAPS) {
      const text = read(path);
      expect(text, path).toMatch(/mutation lease/i);
      expect(text, path).toMatch(/overlapping scope/i);
      for (const stale of PERMANENT_ROLE_PATTERNS) {
        expect(text, `${path} still encodes permanent model jurisdiction`).not.toMatch(stale);
      }
    }
  });

  it("keeps the Codex README and agent profiles free of the retired fixed-role sentences", () => {
    expect(CODEX_SURFACES.length, "expected .codex/README.md plus at least one agent profile").toBeGreaterThan(1);
    for (const path of CODEX_SURFACES) {
      const text = read(path);
      for (const stale of PERMANENT_ROLE_PATTERNS) {
        expect(text, `${path} still encodes permanent model jurisdiction`).not.toMatch(stale);
      }
    }
  });

  it("keeps generic selector and preflight free of a hardcoded Claude identity", () => {
    for (const path of ROUTERS) {
      const text = read(path);
      expect(text, path).not.toMatch(/self\s*=\s*\{\s*lane:\s*["']Claude Code["']/);
      expect(text, path).not.toMatch(/lane:\s*["']Claude Code["']\s*\}\s*,\s*now/);
      expect(text, `${path} must not consult the deprecated role-default helper`).not.toMatch(/defaultOwnerFor/);
    }
  });

  it("allows every declared executor instead of mechanically assigning implementation jurisdiction", () => {
    const gate = read("scripts/work-control-gate.mjs");
    for (const actor of ["claude-code", "codex", "chatgpt-hq", "cowork"]) {
      expect(gate, actor).toContain(`"${actor}"`);
    }
    expect(gate).toMatch(/@deprecated Compatibility only for historical receipts\/tests/i);
    expect(gate).toMatch(/Production dispatch MUST NOT use/i);
  });

  it("binds proof review against every mutation author, not only the final lease holder", () => {
    const gate = read("scripts/work-control-gate.mjs");
    expect(gate).toMatch(/mutationAuthorsFor/);
    expect(gate).toMatch(/authors\.includes\(reviewer\)/);
    expect(gate).toMatch(/one of the mutation authors/i);
  });

  it("keeps owner gates and collision guards separate from executor routing", () => {
    const workControl = read("docs/WORK_CONTROL.md");
    expect(workControl).toMatch(/One folder, one writer/i);
    expect(workControl).toMatch(/Disjoint scopes may proceed in parallel/i);
    expect(workControl).toMatch(/security\/system settings/i);
    expect(workControl).toMatch(/secrets\/signing/i);
    expect(workControl).toMatch(/publication\/distribution/i);
    expect(workControl).toMatch(/destructive\/irreversible/i);
  });
});
