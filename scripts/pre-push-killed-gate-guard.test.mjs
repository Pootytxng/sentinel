// @vitest-environment node
//
// #559 bug->guard: when the gate process is KILLED or CRASHES, the pre-push hook must say so instead of
// refusing in silence. Git Bash turns a Windows exit code of 0xFFFFFFFF -- what Process.Kill() and
// Stop-Process -Force leave -- into 127; before #559 that death printed nothing and the gate log just
// stopped mid-check, which reads as a hang or a flake.
//
// Driven end to end through a REAL `git push`: a throwaway repo uses a copy of the tracked hook, its
// scripts/verify-local.ps1 is a stub that ends powershell with a chosen exit code, and the push goes
// to a local bare remote. Git runs the hook through its own sh, exactly as a lane's push does.
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { windows } from "./lib/windows-only.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A clean environment for the fixture's git: under the real hook this suite inherits nothing from the
// outer push (the hook scrubs GIT_*), and a stray GIT_DIR here would retarget the developer's repo.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/.test(k)));
const git = (cwd, ...args) => spawnSync("git", args, { cwd, env, encoding: "utf8", windowsHide: true });

// The same environment with Windows PowerShell's folder taken off PATH, the only place powershell.exe
// lives; git and its sh stay reachable.
const pathKey = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
const noPowerShell = {
  ...env,
  [pathKey]: env[pathKey].split(";").filter((p) => !/WindowsPowerShell/i.test(p)).join(";"),
};

let dir;
let work;
let n = 0;

beforeAll(() => {
  if (!windows) return;
  dir = mkdtempSync(join(tmpdir(), "compy-prepush-kill-"));
  work = join(dir, "work");
  expect(git(dir, "init", "-q", "--bare", "remote.git").status).toBe(0);
  expect(git(dir, "init", "-q", "work").status).toBe(0);
  mkdirSync(join(work, "hooks"));
  mkdirSync(join(work, "scripts"));
  copyFileSync(join(ROOT, ".githooks", "pre-push"), join(work, "hooks", "pre-push"));
  for (const [k, v] of [["user.email", "claude-code@desk.local"], ["user.name", "fixture"], ["core.hooksPath", "hooks"]]) {
    expect(git(work, "config", k, v).status).toBe(0);
  }
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

// One push whose gate ends with `code`. Each push carries a new commit, so none is a no-op.
const pushWithGateExit = (code, pushEnv = env) => {
  writeFileSync(join(work, "scripts", "verify-local.ps1"), `[Environment]::Exit(${code})\n`, "utf8");
  n += 1;
  writeFileSync(join(work, "f.txt"), `${n}\n`, "utf8");
  expect(git(work, "add", "-A").status).toBe(0);
  expect(git(work, "commit", "-qm", `c${n}`).status).toBe(0);
  const r = spawnSync("git", ["push", "-q", "../remote.git", "HEAD:refs/heads/x"], { cwd: work, env: pushEnv, encoding: "utf8", windowsHide: true });
  return { status: r.status, err: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};

describe.runIf(windows)("pre-push names a killed gate (#559)", () => {
  it("says the gate was TERMINATED when powershell ends with 0xFFFFFFFF, and still refuses", () => {
    const { status, err } = pushWithGateExit(-1);
    expect(status, err).not.toBe(0);
    expect(err, err).toContain("the gate process was TERMINATED, not failed (exit 127)");
    expect(err, err).toContain("0xFFFFFFFF");
  }, 60000);

  it("says the same for a CRASH status (0xC0000409, node's fail-fast), which Git Bash also prints as 127", () => {
    const { status, err } = pushWithGateExit(-1073740791);
    expect(status, err).not.toBe(0);
    expect(err, err).toContain("the gate process was TERMINATED, not failed (exit 127)");
  }, 60000);

  it("says the same for 0xC000013A (Ctrl+C or its console closed), which Git Bash prints as 130", () => {
    const { status, err } = pushWithGateExit(-1073741510);
    expect(status, err).not.toBe(0);
    expect(err, err).toContain("the gate process was TERMINATED, not failed (exit 130)");
  }, 60000);

  it("refuses when powershell.exe is not on PATH, and does not call that a kill", () => {
    // The shell's own "command not found" is also 127, so without the hook's own check this case
    // would read as a killed gate. The stub gate exits 0: only the missing check can refuse here.
    const { status, err } = pushWithGateExit(0, noPowerShell);
    expect(status, err).not.toBe(0);
    expect(err, err).toContain("powershell.exe is not on PATH, so the gate cannot run");
    expect(err, err).not.toContain("TERMINATED");
  }, 60000);

  it("refuses an ordinary red gate WITHOUT calling it a kill", () => {
    const { status, err } = pushWithGateExit(1);
    expect(status, err).not.toBe(0);
    expect(err, err).not.toContain("TERMINATED");
  }, 60000);

  it("lets a green gate push", () => {
    const { status, err } = pushWithGateExit(0);
    expect(status, err).toBe(0);
    expect(err, err).not.toContain("TERMINATED");
  }, 60000);
});
