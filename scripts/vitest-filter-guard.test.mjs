// @vitest-environment node
//
// #457: `vitest run` drops a file filter that matches nothing and still reports green. This pins the
// guard's rule on the incident's own paths, pins that vitest's own parser is what separates filters
// from option values, and runs an incident-shaped command for real. That command must refuse before
// any test runs, and the same command without the stale path must run and pass. The second run is
// what makes the first one evidence: it proves the refusal comes from the stale filter and not from
// a child that could not start.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import setup, { fileOf, isVitestCli, unmatchedFilters } from "./lib/vitest-filter-guard.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The 2026-09-17 #450 verification named STALE. The file lives at REAL.
const STALE = "src/surfaces/ledger-health-blackbook-guard.test.tsx";
const REAL = "src/surfaces/blackbook/ledger-health-blackbook-guard.test.tsx";
const INCIDENT_LIVE = ["src/surfaces/blackbook-v2.test.tsx", "src/surfaces/intelligence-flag.test.tsx"];
const CLI = ["C:\\node\\node.exe", "C:\\repo\\node_modules\\vitest\\vitest.mjs"];

// A stand-in for TestProject.globTestFiles that applies vitest's documented rule: a filter is a
// case-insensitive substring of a test file's path. The real matcher is exercised end to end below.
function fakeProject(files, { typecheck = [] } = {}) {
  const pick = (list, filters) => list.filter((f) => filters.some((q) => f.toLowerCase().includes(q.toLowerCase())));
  return {
    calls: 0,
    asked: [],
    async globTestFiles(filters = []) {
      this.calls += 1;
      this.asked.push(...filters);
      return { testFiles: pick(files, filters), typecheckTestFiles: pick(typecheck, filters) };
    },
  };
}

describe("vitest filter guard (#457): a file argument that matches nothing refuses the run", () => {
  it("the incident: the stale path is the one named; the corrected path and bare substrings pass", async () => {
    const project = fakeProject([REAL, ...INCIDENT_LIVE]);
    expect(await unmatchedFilters([STALE, ...INCIDENT_LIVE], [project])).toEqual([STALE]);
    expect(await unmatchedFilters([REAL, ...INCIDENT_LIVE], [project])).toEqual([]);
    expect(await unmatchedFilters(["blackbook-v2", "surfaces/"], [project])).toEqual([]);
  });

  it("every miss is reported as typed, in order, and the refusal names each one", async () => {
    const project = fakeProject([REAL]);
    expect(await unmatchedFilters(["src/nope-a.test.ts", REAL, "src/nope-b.test.ts"], [project])).toEqual([
      "src/nope-a.test.ts",
      "src/nope-b.test.ts",
    ]);
    const refused = setup(project, { argv: [...CLI, "run", "src/nope-a.test.ts", REAL, "src/nope-b.test.ts"] });
    await expect(refused).rejects.toThrow(/these 2 file filters match no test file:\n {2}src\/nope-a\.test\.ts\n {2}src\/nope-b\.test\.ts\n/);
  });

  it("`file:line` is asked about by its file part, and a Windows drive is not a line number", async () => {
    const project = fakeProject([REAL]);
    expect(await unmatchedFilters([`${REAL}:42`], [project])).toEqual([]);
    expect(project.asked).toEqual([REAL]);
    expect(await unmatchedFilters([`${STALE}:42`], [project])).toEqual([`${STALE}:42`]);
    expect(fileOf("C:\\repo\\src\\a.test.ts")).toBe("C:\\repo\\src\\a.test.ts");
    expect(fileOf("C:\\repo\\src\\a.test.ts:12")).toBe("C:\\repo\\src\\a.test.ts");
  });

  it("a filter any project matches is matched, and a typecheck-only match counts", async () => {
    const a = fakeProject(["src/a.test.ts"]);
    const b = fakeProject(["site/b.test.ts"]);
    expect(await unmatchedFilters(["site/b.test.ts", "src/a.test.ts"], [a, b])).toEqual([]);
    expect(await unmatchedFilters(["src/c.test.ts"], [a, b])).toEqual(["src/c.test.ts"]);
    const typed = fakeProject([], { typecheck: ["src/types.test-d.ts"] });
    expect(await unmatchedFilters(["src/types.test-d.ts"], [typed])).toEqual([]);
  });

  it("vitest's own parser decides what a filter is: option values and `related` files are never asked about", async () => {
    // No `parse` injected: this is the real parseCLI from vitest/node, the parser the CLI runs on.
    const project = fakeProject([REAL]);
    const argv = [...CLI, "run", "-t", "prunable", "--maxWorkers", "4", "--outputFile", "out.json", "--environment", "node", REAL];
    await expect(setup(project, { argv })).resolves.toBeUndefined();
    expect(project.asked).toEqual([REAL]);

    const related = fakeProject([REAL]);
    await expect(setup(related, { argv: [...CLI, "related", "src/data/knowledge.ts"] })).resolves.toBeUndefined();
    expect(related.calls).toBe(0);

    await expect(setup(fakeProject([REAL, ...INCIDENT_LIVE]), { argv: [...CLI, "run", STALE, ...INCIDENT_LIVE] })).rejects.toThrow(
      `this file filter matches no test file:\n  ${STALE}\n`,
    );
  });

  it("no filters costs nothing: `npm test` and the pre-push gate never glob", async () => {
    const project = fakeProject([REAL]);
    await setup(project, { argv: [...CLI, "run"] });
    await setup(project, { argv: [...CLI, "run", "--maxWorkers=4"] });
    await setup(project, { argv: [...CLI] });
    expect(project.calls).toBe(0);
  });

  it("a run not started from the vitest CLI is not read, because its argv is some other program's", async () => {
    const project = fakeProject([REAL]);
    const parse = vi.fn(() => ({ filter: [STALE] }));
    await setup(project, { argv: ["C:\\node\\node.exe", "C:\\ext\\vitest-explorer\\worker.js", "run", STALE], parse });
    expect(parse).not.toHaveBeenCalled();
    expect(project.calls).toBe(0);
    expect(isVitestCli("C:\\repo\\node_modules\\vitest\\vitest.mjs")).toBe(true);
    expect(isVitestCli("/repo/node_modules/.bin/vitest")).toBe(true);
    // The wrapper spawns vitest; inside that child argv[1] is vitest.mjs, which is what gets read.
    expect(isVitestCli("C:\\repo\\scripts\\run-vitest.mjs")).toBe(false);
    expect(isVitestCli(undefined)).toBe(false);
  });

  it("a parser that fails refuses the run instead of letting it through unchecked", async () => {
    const parse = () => {
      throw new Error("unexpected shape");
    };
    await expect(setup(fakeProject([REAL]), { argv: [...CLI, "run", REAL], parse })).rejects.toThrow(
      /parser could not read this command line, so no filter was checked: unexpected shape/,
    );
  });

  it("wiring: the config registers the guard FIRST, so a refused run never reaches the #339 origin call", () => {
    const config = readFileSync(join(ROOT, "vitest.config.ts"), "utf8");
    const list = config.match(/globalSetup: \[([^\]]*)\]/)?.[1] ?? "";
    const order = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["./scripts/lib/vitest-filter-guard.mjs", "./scripts/lib/vitest-global-setup.mjs"]);
  });

  it("end to end: the incident-shaped command refuses before any test runs; without the stale path it runs", () => {
    const LIVE = "scripts/vitest-global-setup.test.mjs";
    expect(existsSync(join(ROOT, STALE)), `${STALE} must stay stale for this proof`).toBe(false);
    expect(existsSync(join(ROOT, LIVE)), `${LIVE} is the live file both runs name`).toBe(true);

    const vitest = (...filters) => {
      // The child is its own vitest: nothing of this worker's pool identity may leak into it.
      const env = { ...process.env, NO_COLOR: "1" };
      for (const key of Object.keys(env)) if (key.startsWith("VITEST") || key === "FORCE_COLOR") delete env[key];
      const r = spawnSync(
        process.execPath,
        ["scripts/run-vitest.mjs", "run", "--maxWorkers", "1", "--environment", "node", ...filters],
        { cwd: ROOT, env, encoding: "utf8", windowsHide: true, timeout: 90_000 },
      );
      return { error: r.error, status: r.status, out: `${r.stdout}\n${r.stderr}`.replace(/\r\n/g, "\n") };
    };

    const refused = vitest(STALE, LIVE);
    expect(refused.error, "the child did not finish").toBeUndefined();
    expect(refused.status, refused.out).not.toBe(0);
    // Exactly one filter is listed, and it is the stale one: the live path was matched, not flagged.
    const listed = refused.out.match(/vitest-filter-guard \(#457\): this file filter matches no test file:\n {2}(\S+)\n/)?.[1];
    expect(listed, refused.out).toBe(STALE);
    expect(refused.out, "a test ran although the guard refused").not.toMatch(/Tests\s+\d+ passed/);

    const control = vitest(LIVE);
    expect(control.error, "the child did not finish").toBeUndefined();
    expect(control.status, control.out).toBe(0);
    expect(control.out).toMatch(/Test Files\s+1 passed \(1\)/);
  }, 200_000);
});
