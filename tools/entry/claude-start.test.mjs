// Guards for the fallback that finishes the journey when the panel does not answer.
//
// The thing being protected is narrow and easy to lose: this path exists so a launch that the
// un-aimable open-URI missed still ENDS with a running session in the right folder — without Kuya
// pressing anything. So the guards are about exactness (the right executable, the right cwd), about
// the two deliberate omissions (no prompt on the command line, no `--ide` without a bridge), and
// about failing with a sentence rather than a spawn when any of it is unknown.

import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { CLI_NAMES, planClaudeStart, planFromMachine, resolveClaudeCli } from "./claude-start.mjs";

const HOME = "C:\\Users\\Kuya";
const INSTALLED = join(HOME, ".local", "bin", CLI_NAMES[0]);
const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-marathon";

const ok = { folder: FOLDER, exe: INSTALLED, folderExists: true, bridge: true };

describe("planClaudeStart", () => {
  it("starts in the folder itself — the cwd IS the project root, never a guessed window", () => {
    const p = planClaudeStart(ok);
    expect(p.ok).toBe(true);
    expect(p.exe).toBe(INSTALLED);
    expect(p.cwd.toLowerCase()).toBe(FOLDER.toLowerCase());
  });

  it("never puts the brief on the command line — the hook is the only carrier", () => {
    // Two carriers can disagree, and the command-line copy is the one that dies at compaction.
    const p = planClaudeStart(ok);
    expect(p.args).toEqual(["--ide"]);
    expect(p.args.join(" ")).not.toMatch(/#\d|brief|issue/i);
  });

  it("adds --ide only when a live bridge names this folder", () => {
    expect(planClaudeStart({ ...ok, bridge: true }).args).toContain("--ide");
    expect(planClaudeStart({ ...ok, bridge: false }).args).toEqual([]);
    expect(planClaudeStart({ ...ok, bridge: false }).ide).toBe(false);
  });

  it("spawns nothing it cannot aim: no folder", () => {
    const p = planClaudeStart({ ...ok, folder: "" });
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/wrong root/i);
  });

  it("spawns nothing it cannot aim: the folder is gone", () => {
    const p = planClaudeStart({ ...ok, folderExists: false });
    expect(p.ok).toBe(false);
    expect(p.reason).toContain(FOLDER);
  });

  it("says so plainly when no CLI is installed, rather than inventing a command name", () => {
    const p = planClaudeStart({ ...ok, exe: null });
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/not installed/i);
    expect(p.exe).toBeUndefined();
  });

  it("carries a reason on every path, because the launcher prints one either way", () => {
    for (const state of [ok, { ...ok, bridge: false }, { ...ok, exe: null }, { ...ok, folderExists: false }]) {
      expect(planClaudeStart(state).reason.length).toBeGreaterThan(10);
    }
  });
});

describe("resolveClaudeCli", () => {
  const env = { PATH: ["C:\\bin", "C:\\Program Files\\nodejs"].join(";") };

  it("prefers the per-user install over whatever PATH happens to say", () => {
    // PATH is inherited from whichever shell the shortcut spawned. Resolving the launcher's most
    // important dependency out of a mutable variable is how a working machine stops being one.
    const exists = (p) => p === INSTALLED || p === join("C:\\bin", CLI_NAMES[0]);
    expect(resolveClaudeCli({ exists, env, home: HOME })).toBe(INSTALLED);
  });

  it("falls back to PATH, in order", () => {
    const onPath = join("C:\\Program Files\\nodejs", CLI_NAMES[0]);
    expect(resolveClaudeCli({ exists: (p) => p === onPath, env, home: HOME })).toBe(onPath);
  });

  it("returns null rather than a hopeful bare name when nothing is installed", () => {
    expect(resolveClaudeCli({ exists: () => false, env, home: HOME })).toBeNull();
  });

  it("survives an empty or absent PATH", () => {
    expect(resolveClaudeCli({ exists: () => false, env: {}, home: HOME })).toBeNull();
    expect(resolveClaudeCli({ exists: () => false, env: { PATH: ";;  ;" }, home: HOME })).toBeNull();
  });
});

describe("planFromMachine", () => {
  it("--no-ide is honoured without consulting any lock file", () => {
    const p = planFromMachine({ folder: FOLDER, exists: () => true, env: {}, home: HOME, bridge: false });
    expect(p.ok).toBe(true);
    expect(p.args).toEqual([]);
  });

  it("refuses when the folder does not exist, before any bridge is read", () => {
    const p = planFromMachine({ folder: "C:\\nope", exists: (x) => x === INSTALLED, env: {}, home: HOME, bridge: false });
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/not there/i);
  });

  it("finds the CLI actually installed on this machine", () => {
    // Not a fixture: if this ever stops being true the fallback is dead, and the launcher should be
    // the thing that says so rather than the owner discovering it at a shortcut.
    expect(resolveClaudeCli()).toBeTruthy();
  });
});
