// Guard: a Windows-only suite may be skipped off-Windows, but it may never go UNPROVEN.
//
// bug->guard, 2026-08-01. When CI came back after 22 days dead, five test files failed 100% on the
// Linux runner — 86 assertions — because they drive the release tooling by spawning
// `powershell.exe`, which does not exist there. `spawnSync` returned `stdout: null` and every
// assertion died on `.trim()`.
//
// Skipping them off-Windows is the right call (scripts/lib/windows-only.mjs carries the three
// options and the arithmetic), but "it still runs somewhere" is exactly the kind of claim that
// quietly stops being true. So all three halves are enforced here:
//
//   1. every test file that SPAWNS powershell.exe is platform-gated, so a new one cannot be added
//      that simply fails forever on Linux and gets waved through as "the usual red";
//   2. there is exactly ONE definition of the platform constant in the tree — this repo already had
//      the `describe.runIf(windows)` convention in three files, and the fix for five more must not
//      invent a second dialect of the same idea;
//   3. scripts/verify-release.ps1 really does run the FULL vitest suite, which is the only reason
//      skipping is honest rather than a hole. Narrow that gate to a subset and this goes red.

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SCRIPTS = join(ROOT, "scripts");
const read = (f) => readFileSync(join(SCRIPTS, f), "utf8");

/** Files that actually START a Windows PowerShell process — not ones that merely mention it. */
const powershellSuites = readdirSync(SCRIPTS)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => {
    const t = read(f);
    return /spawnSync|execFileSync|execSync/.test(t) && /["']powershell\.exe["']/.test(t);
  });

/** Any of the accepted gate spellings — describe-level or it-level, shared constant or inline. */
const GATED = /(describe|it)\.(runIf|skipIf)\(\s*!?\s*(windows|process\.platform)/;

describe("Windows-only suites are gated, not merely broken elsewhere", () => {
  it("finds the PowerShell-driving suites at all — a zero here would mean the detector stopped looking", () => {
    // Pinned rather than implicit: if the detection ever stops matching, every assertion below
    // would pass vacuously over an empty list, which is the failure this file exists to prevent.
    expect(powershellSuites.length).toBeGreaterThanOrEqual(8);
  });

  // A plain loop, not `it.each`: the list is discovered by reading the directory, and `it.each` is
  // evaluated at collection time — an empty list there yields "no tests" and a suite that silently
  // proves nothing.
  for (const file of powershellSuites) {
    it(`${file} is gated by platform rather than left to fail off-Windows`, () => {
      expect(read(file), `${file} starts powershell.exe but has no platform gate`).toMatch(GATED);
    });
  }
});

describe("one definition of the platform constant, not a dialect per file", () => {
  it("declares `windows` in exactly one place", () => {
    const declarations = [];
    const walk = (dir) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".mjs") && /^(export )?const windows = process\.platform/m.test(readFileSync(p, "utf8"))) {
          declarations.push(p.replace(ROOT, "").replace(/\\/g, "/"));
        }
      }
    };
    walk(SCRIPTS);
    expect(declarations, `expected one shared definition, found: ${declarations.join(", ")}`).toHaveLength(1);
    expect(declarations[0]).toMatch(/lib\/windows-only\.mjs$/);
  });
});

describe("the release gate is where those proofs actually run", () => {
  const gate = read("verify-release.ps1");

  it("runs the FULL vitest suite, not a subset — that is what makes the skip honest", () => {
    // `Invoke-NpmGate ... -Arguments @("test")` is `npm test`, i.e. every suite including the gated
    // ones, on a Windows machine where powershell.exe exists.
    expect(gate).toMatch(/Invoke-NpmGate[^\n]*-Arguments\s*@\(\s*"test"\s*\)/);
  });

  it("does not stop at the first failure, so one red gate cannot hide the rest", () => {
    expect(gate).toMatch(/never stop early|Nothing stops at the first failure/i);
  });
});
