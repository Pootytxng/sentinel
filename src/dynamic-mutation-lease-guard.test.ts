import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const BOOTSTRAPS = ["CLAUDE.md", "AGENTS.md", "docs/WORK_CONTROL.md"] as const;

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

  it("keeps generic selector and preflight free of a hardcoded Claude identity", () => {
    for (const path of ["tools/entry/select.mjs", "tools/entry/preflight.mjs"]) {
      const text = read(path);
      expect(text, path).not.toMatch(/self\s*=\s*\{\s*lane:\s*["']Claude Code["']/);
      expect(text, path).not.toMatch(/lane:\s*["']Claude Code["']\s*\}\s*,\s*now/);
    }
  });

  it("does not mechanically assign implementation or review to a specific model", () => {
    const gate = read("scripts/work-control-gate.mjs");
    expect(gate).toContain('return "best-fit-available"');
    expect(gate).toContain('return "non-authoring-reviewer"');
    expect(gate).not.toMatch(/kind === ["']implementation["']\) return ["']claude-code["']/);
    expect(gate).not.toMatch(/kind === ["']independent-review["']\) return ["']codex["']/);
  });

  it("binds proof review against every mutation author, not only the last lease holder", () => {
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
