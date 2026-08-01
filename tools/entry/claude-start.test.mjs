// Guards for the fallback that finishes the journey when the panel does not answer.
//
// The thing being protected is narrow and easy to lose: this path exists so a launch that the
// un-aimable open-URI missed still ENDS with a running session in the right folder — without Kuya
// pressing anything. So the guards are about exactness (the right executable, the right cwd), about
// the two deliberate omissions (no prompt on the command line, no `--ide` without a bridge), and
// about failing with a sentence rather than a spawn when any of it is unknown.

import { describe, expect, it } from "vitest";
// win32, matching the module under test. These assertions are about WINDOWS paths; building the
// expectations with the host's separator made the suite prove something different depending on
// where it ran.
import { win32 as winpath } from "node:path";
const { join } = winpath;
import { CLI_NAMES, planClaudeStart, planFromMachine, resolveClaudeCli } from "./claude-start.mjs";

const HOME = "C:\\Users\\Kuya";
const INSTALLED = join(HOME, ".local", "bin", CLI_NAMES[0]);
const FOLDER = "C:\\Users\\Kuya\\code\\sentinel-marathon";

const ok = { folder: FOLDER, exe: INSTALLED, folderExists: true, bridge: true, terminal: true };

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

  // Observed on this machine during the acceptance run: the launcher reached this fallback from a
  // shell with no console of its own, spawned the CLI, and then waited 90s for a session that could
  // never arrive — the TUI had been handed a window with no screen buffer to draw on. It ended with
  // advice Kuya could not act on ("press Ctrl+Esc in that window"), a terminal held open, and an
  // orphaned claude.exe. A spawn that cannot be seen is not a handoff; it is a leak.
  it("refuses to spawn a terminal UI into a console that cannot show it", () => {
    const p = planClaudeStart({ ...ok, terminal: false });
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/window|terminal|console/i);
    // Plain-language, per the owner-facing output rule: no isTTY, no stream names, no jargon.
    expect(p.reason).not.toMatch(/isTTY|stderr|stdout|file descriptor/i);
  });

  it("checks the folder and the CLI first — the console is the last thing that can be wrong", () => {
    // Ordering matters for the message Kuya reads: a missing worktree is a different problem from a
    // console problem, and reporting the console first would send him looking in the wrong place.
    expect(planClaudeStart({ ...ok, terminal: false, folder: "" }).reason).toMatch(/wrong root/i);
    expect(planClaudeStart({ ...ok, terminal: false, exe: null }).reason).toMatch(/not installed/i);
    expect(planClaudeStart({ ...ok, terminal: false, folderExists: false }).reason).toContain(FOLDER);
  });

  it("carries a reason on every path, because the launcher prints one either way", () => {
    const states = [ok, { ...ok, bridge: false }, { ...ok, exe: null }, { ...ok, folderExists: false }, { ...ok, terminal: false }];
    for (const state of states) {
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
    const p = planFromMachine({ folder: FOLDER, exists: () => true, env: {}, home: HOME, bridge: false, terminal: true });
    expect(p.ok).toBe(true);
    expect(p.args).toEqual([]);
  });

  it("refuses when the folder does not exist, before any bridge is read", () => {
    const p = planFromMachine({ folder: "C:\\nope", exists: (x) => x === INSTALLED, env: {}, home: HOME, bridge: false, terminal: true });
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/not there/i);
  });

  it("reads the console from the running process when nobody says otherwise", () => {
    // Under vitest stderr is a pipe, so the default IS the refusing one here — which is exactly the
    // shape of the failure this guards: a launcher running without a console of its own.
    const p = planFromMachine({ folder: FOLDER, exists: () => true, env: {}, home: HOME, bridge: false });
    expect(p.ok).toBe(false);
    expect(p.reason).toMatch(/window|terminal|console/i);
  });

  // This one asserts a fact about THE MACHINE IT RUNS ON, not about the code: that a Claude Code CLI
  // is really installed where the launcher looks. That is worth knowing — if it stops being true the
  // fallback is dead, and the launcher should be what says so rather than the owner discovering it
  // at a shortcut. But it can only hold on a machine that HAS one, and running it unconditionally
  // asserted that GitHub's runners carry the owner's tools: it failed there every single time and
  // passed here forever, which is a guard aimed at the wrong thing.
  //
  // Scoped to the platform that can satisfy it, and the skip is legible in the output rather than
  // silent.
  const OWNER_PLATFORM = process.platform === "win32";
  it.skipIf(!OWNER_PLATFORM)("finds the CLI actually installed on this machine (Windows only)", () => {
    expect(resolveClaudeCli()).toBeTruthy();
  });
});
