// Guard: the exit code the shell reads must mean what the shell thinks it means.
//
// compy-entry.ps1 is not executed by any test, so every claim about its behaviour rests on the
// contract it consumes. That contract is this CLI's exit code, and it is now load-bearing in a way
// it was not before: exit 2 means the control folder cannot vouch for itself and the launch must
// stop. The old shell printed a note on every nonzero code and launched anyway -- "refuse the
// update, run the stale launcher" defeats the whole pin (spec §8: refuse rather than guess).
//
// Real clones, not a fake git. The point of the test is that a genuinely dirty folder on the pinned
// branch produces the fatal code, and a fake that returns whatever it was told cannot prove that.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const CLI = join(process.cwd(), "tools", "entry", "control-update.mjs");
let root;
let clone;

const git = (dir, args) => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// A CLI that prints nothing must fail LOUDLY, naming what it did instead.
//
// The old helper wrapped everything in one try/catch, so a JSON.parse SyntaxError raised on the
// SUCCESS path landed in the catch -- where `e.status` and `e.stdout` are both undefined, because
// the error came from JSON.parse and not from a child that exited. It returned `{code: undefined,
// json: {}}`, and every assertion downstream read "expected undefined to be 2". That is precisely
// what a CLI printing nothing looks like, and it is what two days of red CI looked like when this
// CLI's main-module guard silently failed on Linux: an error message pointing nowhere near the
// cause. spawnSync keeps the exit code and the child's own output separate from our parsing of it.
/** @returns {{code:number, json:object}} */
function runCli(dir, extra = []) {
  const args = [CLI, "--dir", dir, "--branch", "main", "--no-fetch", ...extra];
  const r = spawnSync(process.execPath, args, { encoding: "utf8" });
  if (r.error) throw r.error;
  return { code: r.status, json: parseVerdict(r, args) };
}

/** Parse the CLI's stdout, or throw an error that says what it actually wrote. */
function parseVerdict(r, args) {
  try {
    return JSON.parse(r.stdout);
  } catch (e) {
    throw new Error(
      `${CLI} printed no JSON verdict.\n` +
        `  argv   : ${args.slice(1).join(" ")}\n` +
        `  exit   : ${r.status}${r.signal ? ` (signal ${r.signal})` : ""}\n` +
        `  stdout : ${r.stdout === "" ? "(empty)" : r.stdout}\n` +
        `  stderr : ${r.stderr === "" ? "(empty)" : r.stderr}\n` +
        `  parse  : ${e.message}`,
    );
  }
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "compy-entry-control-exit-"));
  const origin = join(root, "origin.git");
  mkdirSync(origin, { recursive: true });
  git(origin, ["init", "--bare", "-b", "main"]);

  const seed = join(root, "seed");
  mkdirSync(seed, { recursive: true });
  git(seed, ["init", "-b", "main"]);
  git(seed, ["config", "user.email", "t@t"]);
  git(seed, ["config", "user.name", "t"]);
  writeFileSync(join(seed, "compy-entry.ps1"), "# launcher\n");
  git(seed, ["add", "-A"]);
  git(seed, ["commit", "-m", "seed"]);
  git(seed, ["remote", "add", "origin", origin]);
  git(seed, ["push", "-u", "origin", "main"]);

  clone = join(root, "control");
  git(root, ["clone", origin, clone]);
  git(clone, ["config", "user.email", "t@t"]);
  git(clone, ["config", "user.name", "t"]);
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

describe("the exit code compy-entry.ps1 acts on", () => {
  it("says 0 — nothing to do — for a clean folder already at its upstream", () => {
    const r = runCli(clone);
    expect(r.code).toBe(0);
    expect(r.json.action).toBe("none");
    expect(r.json.fatal).toBeFalsy();
  });

  // The defect this whole change exists for: current, but not the code that commit describes.
  it("says 2 — fatal — for a dirty folder, even though it is already current", () => {
    writeFileSync(join(clone, "compy-entry.ps1"), "# launcher, quietly edited\n");
    const r = runCli(clone);
    expect(r.code).toBe(2);
    expect(r.json.fatal).toBe(true);
    expect(r.json.reason).toMatch(/uncommitted/i);
    git(clone, ["checkout", "--", "compy-entry.ps1"]);
  });

  it("says 2 — fatal — for a folder on a branch other than the pinned one", () => {
    git(clone, ["checkout", "-q", "-b", "somewhere-else"]);
    const r = runCli(clone);
    expect(r.code).toBe(2);
    expect(r.json.fatal).toBe(true);
    git(clone, ["checkout", "-q", "main"]);
  });

  it("says 2 — fatal — for a folder whose origin is a different repository", () => {
    const r = runCli(clone, ["--remote", "Pootytxng/sentinel"]);
    expect(r.code).toBe(2);
    expect(r.json.fatal).toBe(true);
    expect(r.json.reason).toMatch(/not Pootytxng\/sentinel/i);
  });

  it("says 2 — fatal — for a folder it cannot read at all, rather than launching on nothing", () => {
    const r = runCli(join(root, "no-such-folder"));
    expect(r.code).toBe(2);
    expect(r.json.fatal).toBe(true);
  });

  // Every fatal path prints parseable JSON. The shell reads $update.reason to tell the owner what to
  // do; a stack trace on stderr would leave it with a null object and nothing to say.
  it("always prints a JSON object the shell can read, even when refusing", () => {
    const r = runCli(join(root, "no-such-folder"));
    expect(typeof r.json).toBe("object");
    expect(typeof r.json.reason).toBe("string");
    expect(r.json.reason.length).toBeGreaterThan(0);
  });
});
