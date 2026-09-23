// #488: the gate blocks on its own folder; the fleet sweep blocks on every folder; nothing in between.
//
// Two things are pinned here. First, the rule itself (scripts/lib/fleet-scope.mjs): a peer folder's
// finding lands in the warning set and never the blocking set, whatever spelling the two paths
// arrived in, and fleet mode moves it back. Second, the wiring: each of the four checks the sweep
// names really imports that rule and really calls it from its live test, so a check cannot be
// rewritten back to "every folder blocks" -- or forward to "no folder blocks" -- without this file
// going red. The per-check guards live next to each check; this is the one that sees all four.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { FLEET_CHECKS, hygieneArgv, hygieneEnv, runHygiene } from "./fleet-hygiene.mjs";
import {
  FLEET_HYGIENE_COMMAND,
  FLEET_MODE_ON,
  FLEET_MODE_VAR,
  fleetMode,
  folderKey,
  foldersToJudge,
  peerWarning,
  splitByFolder,
} from "./lib/fleet-scope.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
/**
 * Code only: a comment that names the helper must not satisfy a check that the helper is CALLED.
 * Line comments go first, and a block comment counts only when it OPENS a line: a `/*` inside a
 * `//` line (`.claude/hooks/*` in a header) once opened a match that swallowed thirty lines of code,
 * import included, and the check reported a file that imports the rule as one that does not.
 */
const code = (src) =>
  src
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n")
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "");

describe("the rule: own folder blocks, a peer's warns, fleet mode blocks everywhere", () => {
  const own = "C:/Users/Kuya/code/sentinel/.claude/worktrees/this-lane";
  const peer = "C:/Users/Kuya/code/sentinel/.claude/worktrees/some-other-lane";
  // Paths that are not on disk: folderKey falls back to the spelling given, which is the case this
  // rule has to get right without help from the filesystem.
  const opts = { platform: "win32", realpath: () => { throw new Error("not on disk"); } };
  const findings = [
    { folder: peer, what: "stranded receipt" },
    { folder: own, what: "stranded receipt" },
  ];

  it("a peer folder's finding is a warning at the gate, and the pushing folder's own finding still blocks", () => {
    const r = splitByFolder(findings, { own, folderOf: (f) => f.folder, fleet: false, ...opts });
    expect(r.blocking.map((f) => f.folder)).toEqual([own]);
    expect(r.warnings.map((f) => f.folder)).toEqual([peer]);
    expect(r.fleet).toBe(false);
  });

  it("fleet mode blocks on every folder, the peer included", () => {
    const r = splitByFolder(findings, { own, folderOf: (f) => f.folder, fleet: true, ...opts });
    expect(r.blocking).toHaveLength(2);
    expect(r.warnings).toEqual([]);
    expect(r.fleet).toBe(true);
  });

  it("the same folder in another spelling is still the OWN folder -- casing, slashes, a trailing separator", () => {
    // process.cwd() from a harness that lowercases the drive letter, versus git's porcelain.
    const spelled = "c:\\users\\kuya\\code\\sentinel\\.claude\\worktrees\\this-lane\\";
    expect(folderKey(spelled, opts)).toBe(folderKey(own, opts));
    const r = splitByFolder([{ folder: spelled }], { own, folderOf: (f) => f.folder, fleet: false, ...opts });
    expect(r.blocking).toHaveLength(1);
    expect(r.warnings).toEqual([]);
  });

  it("a sibling whose name merely starts the same way is a PEER, not this folder", () => {
    const lookalike = `${own}-2`;
    const r = splitByFolder([{ folder: lookalike }], { own, folderOf: (f) => f.folder, fleet: false, ...opts });
    expect(r.blocking).toEqual([]);
    expect(r.warnings).toHaveLength(1);
  });

  it("a caller that forgets its own folder or the folder accessor gets a throw, never an empty blocking set", () => {
    expect(() => splitByFolder(findings, { folderOf: (f) => f.folder, fleet: false })).toThrow(/own folder/);
    expect(() => splitByFolder(findings, { own, fleet: false })).toThrow(/folderOf/);
    expect(() => splitByFolder("not a list", { own, folderOf: (f) => f.folder })).toThrow(/array/);
  });

  it("a walk-shaped check judges only its own folder at the gate and every registered one in fleet mode", () => {
    const worktrees = [own, peer];
    expect(foldersToJudge({ own, worktrees, fleet: false })).toEqual([own]);
    expect(foldersToJudge({ own, worktrees, fleet: true })).toEqual(worktrees);
    expect(() => foldersToJudge({ own, worktrees: [], fleet: true })).toThrow(/broken measurement/);
    expect(() => foldersToJudge({ worktrees, fleet: false })).toThrow(/own folder/);
  });

  it("fleet mode is one exact value of one variable", () => {
    expect(fleetMode({})).toBe(false);
    expect(fleetMode({ [FLEET_MODE_VAR]: "true" })).toBe(false);
    expect(fleetMode({ [FLEET_MODE_VAR]: "0" })).toBe(false);
    expect(fleetMode({ [FLEET_MODE_VAR]: FLEET_MODE_ON })).toBe(true);
    expect(fleetMode(hygieneEnv({}))).toBe(true);
  });

  it("the WARN names the check, the folder, the finding, the fix and where blocking still lives -- and prints nothing for nothing", () => {
    expect(peerWarning({ check: "x", warnings: [], describe: () => "" })).toBe("");
    const text = peerWarning({
      check: "hookspath-fleet-guard",
      warnings: [{ path: peer, reason: "core.hooksPath is absolute" }],
      describe: (w) => `${w.path} -- ${w.reason}`,
      fix: () => "git config --worktree core.hooksPath .githooks",
    });
    expect(text).toContain("WARN hookspath-fleet-guard");
    expect(text).toContain(peer);
    expect(text).toContain("core.hooksPath is absolute");
    expect(text).toContain("fix: git config --worktree core.hooksPath .githooks");
    expect(text).toContain(FLEET_HYGIENE_COMMAND);
    expect(text).toContain("not blocked");
  });
});

describe("the sweep runs exactly the four checks, flipped, and never reports a non-run as a pass", () => {
  it("names four checks that exist", () => {
    expect(FLEET_CHECKS).toHaveLength(4);
    for (const rel of FLEET_CHECKS) expect(existsSync(join(ROOT, rel)), rel).toBe(true);
  });

  it("every named check imports the rule and CALLS it from code, so none can fall out of the sweep quietly", () => {
    for (const rel of FLEET_CHECKS) {
      const src = code(read(rel));
      expect(src, `${rel} does not import scripts/lib/fleet-scope.mjs`).toContain('from "./lib/fleet-scope.mjs"');
      expect(
        /\b(splitByFolder|foldersToJudge)\(/.test(src),
        `${rel} imports the rule but never calls splitByFolder() or foldersToJudge() from code`,
      ).toBe(true);
    }
  });

  it("runs the repo's own vitest runner on those files with the flag set, and nothing else changed in the environment", () => {
    const { command, args } = hygieneArgv({ node: "NODE" });
    expect(command).toBe("NODE");
    expect(args).toEqual(["scripts/run-vitest.mjs", "run", ...FLEET_CHECKS]);
    const env = hygieneEnv({ PATH: "p", [FLEET_MODE_VAR]: "0" });
    expect(env).toEqual({ PATH: "p", [FLEET_MODE_VAR]: FLEET_MODE_ON });
  });

  it("returns the child's status, and 1 when there is no status to return", () => {
    const calls = [];
    const spawn = (command, args, opts) => {
      calls.push({ command, args, opts });
      return { status: 3 };
    };
    expect(runHygiene({ spawn, node: "NODE", env: { A: "1" }, cwd: "/x" })).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0].command).toBe("NODE");
    expect(calls[0].opts.env[FLEET_MODE_VAR]).toBe(FLEET_MODE_ON);
    expect(calls[0].opts.env.A).toBe("1");
    expect(calls[0].opts.cwd).toBe("/x");
    expect(calls[0].opts.stdio).toBe("inherit");
    expect(runHygiene({ spawn: () => ({ status: null, signal: "SIGKILL" }) })).toBe(1);
    expect(runHygiene({ spawn: () => ({ error: new Error("ENOENT") }) })).toBe(1);
    expect(runHygiene({ spawn: () => undefined })).toBe(1);
  });

  it("is reachable as an npm script, by the name every WARN prints", () => {
    const pkg = JSON.parse(read("package.json"));
    const name = FLEET_HYGIENE_COMMAND.replace(/^npm run /, "");
    expect(pkg.scripts?.[name]).toBe("node scripts/fleet-hygiene.mjs");
  });
});
