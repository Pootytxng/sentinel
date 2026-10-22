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
    for (const actor of ["claude-code", "codex", "chatgpt-hq", "cowork", "grok"]) {
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

  // Owner ruling 2026-10-22 (#682): a stale lease out of the executor's reach is taken over remotely
  // instead of halting. Every condition that keeps that safe is pinned, so none can be dropped quietly.
  it("keeps every condition on the remote takeover of a stale lease", () => {
    const workControl = read("docs/WORK_CONTROL.md");
    const section = workControl.split("### Remote takeover")[1]?.split("\n## ")[0] ?? "";
    expect(section, "the Remote takeover section is missing").not.toBe("");
    expect(section).toMatch(/expired at least 12 hours ago, and nothing has been posted on its thread since/);
    expect(section).toMatch(/never touches the holder's folder, branch or processes/);
    expect(section).toMatch(/reset, stashed,\s+deleted, force-pushed or killed/);
    expect(section).toMatch(/says `not inspected` and why/);
    expect(section).toMatch(/every unlanded ref and patch the thread names/);
    expect(section).toMatch(/`### Handoff` whose `- Claim:` line releases it/);
    expect(section).toMatch(/A lease that has not expired still serializes/);
    expect(section).toMatch(/owner-bound gates in\s+`CLAUDE.md` stay owner-bound/);
  });

  // Codex review 5612865429 (P1): the remote takeover proceeds while the holder's folder is unknown, so
  // every statement that unknown ownership stays locked has to name it as the exception. Otherwise the
  // two rules contradict each other and an executor can cite either one.
  it("names the remote takeover wherever unknown ownership is declared locked", () => {
    let statements = 0;
    for (const path of BOOTSTRAPS) {
      // The section itself is the exception, and quotes the lock it lifts; it is pinned below.
      const text = read(path).replace(/### Remote takeover[\s\S]*?(?=\n## |$)/, "");
      const blocks = text.split(/\n\s*\n|\n(?=\d+\. )/);
      for (const block of blocks.filter((b) => /locked until measured|Unknown means locked/i.test(b))) {
        statements += 1;
        const flat = block.replace(/\s+/g, " ");
        expect(flat, `${path}: ${flat.slice(0, 80)}`).toMatch(/remote takeover/i);
        expect(flat, path).toMatch(/#682/);
        expect(flat, path).toMatch(/12 hours past expiry with nothing posted since/);
        expect(flat, path).toMatch(/untouched/);
      }
    }
    expect(statements, "AGENTS.md and WORK_CONTROL.md rule 5 each state the lock").toBeGreaterThanOrEqual(2);
    const section = read("docs/WORK_CONTROL.md").split("### Remote takeover")[1]?.split("\n## ")[0] ?? "";
    expect(section.replace(/\s+/g, " ")).toMatch(/named exception to rule 5 and to `AGENTS.md`'s "locked until measured"/);
  });
});
