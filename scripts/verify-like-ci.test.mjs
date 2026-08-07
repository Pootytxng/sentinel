import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CI_STEPS, SETUP_ONLY, repoRoot } from "./lib/ci-steps.mjs";

// `npm run verify` only earns trust if it is CI, not a hand-copied impression of CI. GitHub Actions
// on this repo is a metered private-repo budget that has already gone dark once, and the local
// runner is what stands in for it — a runner that has quietly drifted from the workflow is worse
// than no runner, because it reports PASS for checks it no longer performs.
//
// So: every command the workflow actually runs must be one the local runner runs, and vice versa.

/** A command plus the directory it runs in — `npm ci` in the root and `npm ci` in site-app are
    two different checks, and the workflow tells them apart only by `working-directory:`. */
const key = (cmd, dir) => (dir ? `${cmd} @${dir}` : cmd);

/** The workflow's steps, each as its own block of lines — a step begins at a `- ` bullet and ends
    where the next one does. `working-directory:` only ever describes the step it sits in, so the
    boundary is what stops one step's directory from being read onto its neighbour. */
function workflowSteps() {
  const yml = readFileSync(join(repoRoot, ".github", "workflows", "ci.yml"), "utf8").split(/\r?\n/);
  const steps = [];
  for (const line of yml) {
    if (/^\s*- \S/.test(line)) steps.push([]);
    if (steps.length > 0) steps[steps.length - 1].push(line);
  }
  return steps;
}

/** Every `run:` command in ci.yml, block scalars flattened to one line each. */
function workflowCommands() {
  const out = [];
  for (const step of workflowSteps()) {
    const dir = step.map((l) => /^\s*working-directory:\s*(\S+)\s*$/.exec(l)?.[1]).find(Boolean) ?? "";
    for (let i = 0; i < step.length; i++) {
      const head = /^(\s*)-?\s*run:\s*(.*)$/.exec(step[i]);
      if (!head) continue;
      if (head[2] === "|" || head[2] === ">") {
        // Block scalar: the indented lines beneath it, one command per line.
        for (let j = i + 1; j < step.length; j++) {
          if (step[j].trim() === "") continue;
          if (step[j].search(/\S/) <= head[1].length) break;
          out.push(key(step[j].trim(), dir));
        }
      } else if (head[2].trim() !== "") {
        out.push(key(head[2].trim(), dir));
      }
    }
  }
  return out.filter((c) => !SETUP_ONLY.some((re) => re.test(c)));
}

const localCommands = CI_STEPS.map((s) =>
  key([s.cmd, ...s.args].join(" "), s.cwd ? relative(repoRoot, s.cwd).replace(/\\/g, "/") : ""),
);

describe("npm run verify is the workflow, not an impression of it", () => {
  const workflow = workflowCommands();

  it("finds the workflow's real check commands (the parser still works)", () => {
    // A parser that silently matches nothing would make every assertion below vacuous.
    expect(workflow.length).toBeGreaterThanOrEqual(4);
    expect(workflow).toContain("npm test");
  });

  it("runs every check ci.yml runs", () => {
    const missing = workflow.filter((c) => !localCommands.includes(c));
    expect(missing, `in ci.yml but not in scripts/lib/ci-steps.mjs: ${missing.join(" | ")}`).toEqual([]);
  });

  it("runs nothing ci.yml does not — a local-only 'check' proves nothing about the build", () => {
    const extra = localCommands.filter((c) => !workflow.includes(c));
    expect(extra, `in scripts/lib/ci-steps.mjs but not in ci.yml: ${extra.join(" | ")}`).toEqual([]);
  });

  it("keeps the Rust checks last, so the slow half never hides a fast failure", () => {
    const firstCargo = CI_STEPS.findIndex((s) => s.cmd === "cargo");
    expect(firstCargo).toBeGreaterThan(-1);
    expect(CI_STEPS.slice(firstCargo).every((s) => s.cmd === "cargo")).toBe(true);
  });
});
