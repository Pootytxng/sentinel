// Guard: the gate in front of automatic hook repair must actually open.
//
// `repairHooksIfSafe` is the launcher's one self-repair. It is deliberately narrow: it runs only when
// the missing-hooks row is the SOLE failure, because a folder that is also dirty or claimed elsewhere
// has a problem repair does not address. That narrowness is correct. What was wrong is that the gate
// read a field the check objects do not have.
//
// `preflight.mjs` builds every row with `mk(name, ...) -> { name, expected, actual, ok, ... }`. There
// is no `id`. So `failed[0].id !== "hooks.present"` compared `undefined` against a string, which is
// always true, and the function returned `{attempted:false}` on its first line for every launch ever
// made. The feature existed, was documented, was reachable from the normal path since e51f54e — and
// had never once run. No test called it, so 440 green tests said nothing.
//
// The lesson this file encodes: a gate keyed on a field name is only as true as the field. These
// tests assert the gate OPENS on the real row shape that `preflight.mjs` actually emits, not on a
// shape invented by the test.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { repairHooksIfSafe } from "./launch.mjs";
import { verifyHooks } from "./hooks-verify.mjs";

// The real, tracked control payload — not a fixture. `hookRepairPlan` proves the source is tracked by
// git, so pointing at the repository's own set is what makes this a true end-to-end gate test.
const CANONICAL = join(process.cwd(), ".claude", "hooks");

const SETTINGS = {
  hooks: {
    Stop: [{ hooks: [{ type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/stop-continue.mjs"' }] }],
  },
};

let root;
let dir;
let facts;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "compy-entry-repair-gate-"));
  dir = join(root, "behind");
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify(SETTINGS, null, 2));
  // Registers the hook, does not have it: exactly the folder the repair exists for.
  facts = { hooks: verifyHooks({ dir, home: join(root, "no-home") }) };
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

// Rows exactly as `preflight.mjs` mk() emits them: `name`, no `id`.
const row = (name, ok) => ({ name, expected: "x", actual: "y", ok, remediation: null, note: null });

describe("the gate in front of automatic hook repair", () => {
  it("opens when the missing-hooks row is the only failure", () => {
    const r = repairHooksIfSafe({
      facts,
      verdict: { checks: [row("hooks.present", false), row("git.clean", true), row("task.status", true)] },
      canonicalDir: CANONICAL,
      dryRun: true,
    });
    // The whole defect in one assertion: this was `false` for every launch ever made.
    expect(r.attempted).toBe(true);
  });

  it("stays shut when a second row also failed — repair does not address a dirty folder", () => {
    const r = repairHooksIfSafe({
      facts,
      verdict: { checks: [row("hooks.present", false), row("git.clean", false)] },
      canonicalDir: CANONICAL,
      dryRun: true,
    });
    expect(r.attempted).toBe(false);
  });

  it("stays shut when the sole failure is a different row", () => {
    const r = repairHooksIfSafe({
      facts,
      verdict: { checks: [row("git.clean", false), row("hooks.present", true)] },
      canonicalDir: CANONICAL,
      dryRun: true,
    });
    expect(r.attempted).toBe(false);
  });

  // The gate must key on the field preflight really emits. If someone reintroduces `id`, or renames
  // the row, this fails rather than silently returning to never-repairing.
  it("keys on the row name preflight actually emits, so a shape change cannot silently close it", () => {
    const checks = [row("hooks.present", false)];
    expect(Object.keys(checks[0])).not.toContain("id");
    expect(repairHooksIfSafe({ facts, verdict: { checks }, canonicalDir: CANONICAL, dryRun: true }).attempted).toBe(true);
  });
});
