// Guard: the unloaded-project-config hook must never fabricate a claim about its own supervision.
//
// The hook warns when you edit a file belonging to a project whose config did not load. It shipped
// 2026-08-03 with no test at all — and two false-positive classes lived in that gap:
//
//   1. `~/.claude` is the USER config, not a project. Its own comment said this case was excluded;
//      it never was. The walk broke on `dir === home`, one level too LATE, so `~/.claude` was
//      reached first, and a 0-byte CLAUDE.md sitting there satisfies existsSync. Every memory write
//      — which the memory law REQUIRES to go to `~/.claude` — announced "PROJECT CONFIG NOT LOADED",
//      ordered the session to read that empty file for laws it does not contain, and told it to
//      inform the user their hooks were inert. False, and aimed at the user.
//   2. A sibling git WORKTREE of the same repository. Worktrees are how work normally happens here
//      and each carries its own tracked CLAUDE.md / .claude/settings.json / .claude/hooks — all
//      loaded. "Every project hook is INERT this session" is simply untrue there.
//
// The half that must NOT be weakened carries equal weight below: a session with no project config,
// and a session in a DIFFERENT repository, still get warned. A guard that fires nowhere is not a
// fixed guard, it is a deleted one.
//
// The hook exports nothing (it is all top-level, reading stdin), so it is exercised the way Claude
// Code runs it: spawned, JSON on stdin, verdict on stdout. `os.homedir()` reads USERPROFILE on
// Windows and HOME elsewhere, so a spawned fake home makes every case hermetic — these tests prove
// the ~/.claude fix without touching the real profile.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GIT_SPAWN_TIMEOUT_MS } from "../../src/test/tree-walk-budget.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIRROR = join(HERE, "user-hooks", "unloaded-project-config.mjs");
const INSTALLED = join(process.env.USERPROFILE || process.env.HOME || "", ".claude", "hooks", "unloaded-project-config.mjs");

const git = (dir, args) =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

let root;
let sandboxTmp;
let seq = 0;

/** Run the hook exactly as the harness does. Returns the injected context, or "" for silence. */
const run = ({ file, sessionRoot, home }) => {
  const out = execFileSync(process.execPath, [MIRROR], {
    input: JSON.stringify({
      session_id: `t${seq++}`, // distinct per call: the hook fires once per (session, project)
      cwd: sessionRoot,
      tool_input: { file_path: file },
    }),
    encoding: "utf8",
    env: {
      ...process.env,
      USERPROFILE: home,
      HOME: home,
      TEMP: sandboxTmp,
      TMP: sandboxTmp,
      TMPDIR: sandboxTmp,
      CLAUDE_PROJECT_DIR: sessionRoot,
    },
  });
  return out.trim() ? JSON.parse(out).hookSpecificOutput.additionalContext : "";
};

/** A directory that looks like a project: CLAUDE.md + .claude/settings.json + .claude/hooks/. */
const project = (dir, { claudeMd = "# laws\n" } = {}) => {
  mkdirSync(join(dir, ".claude", "hooks"), { recursive: true });
  writeFileSync(join(dir, "CLAUDE.md"), claudeMd);
  writeFileSync(join(dir, ".claude", "settings.json"), "{}\n");
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", "x.ts"), "export const x = 1;\n");
  return dir;
};

const repo = (dir) => {
  project(dir);
  git(dir, ["init", "-b", "main"]);
  git(dir, ["config", "user.email", "t@t"]);
  git(dir, ["config", "user.name", "t"]);
  git(dir, ["add", "-A", "-f"]);
  git(dir, ["commit", "-m", "seed"]);
  return dir;
};

const mk = (...parts) => {
  const d = join(root, ...parts);
  mkdirSync(d, { recursive: true });
  return d;
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "compy-unloaded-project-"));
  sandboxTmp = mk("hook-markers");
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

describe("silence where the warning would be false", () => {
  // The regression. `~/.claude/CLAUDE.md` exists on the real machine and is empty; the fixture
  // reproduces that exactly, because the emptiness is what made instruction #1 absurd.
  it("says nothing about a memory file under ~/.claude — that is user config, loaded everywhere", () => {
    const home = mk("case-a", "home");
    mkdirSync(join(home, ".claude", "projects", "some-proj", "memory"), { recursive: true });
    writeFileSync(join(home, ".claude", "CLAUDE.md"), ""); // 0 bytes, exactly as installed
    const session = repo(mk("case-a", "work"));

    const memoryFile = join(home, ".claude", "projects", "some-proj", "memory", "a-fact.md");
    writeFileSync(memoryFile, "---\nname: a-fact\n---\n");

    expect(run({ file: memoryFile, sessionRoot: session, home })).toBe("");
  });

  // Proves the fixture above is load-bearing rather than silent for some unrelated reason: the same
  // shape one directory over — a CLAUDE.md under home that is NOT ~/.claude — still warns.
  it("still warns for a CLAUDE.md elsewhere under home, so the exclusion is what silenced it", () => {
    const home = mk("case-a2", "home");
    const other = project(mk("case-a2", "home", "notclaude"));
    const session = repo(mk("case-a2", "work"));

    expect(run({ file: join(other, "src", "x.ts"), sessionRoot: session, home })).toMatch(
      /PROJECT CONFIG NOT LOADED/,
    );
  });

  it("says nothing about a sibling worktree of the same repository — its config IS loaded", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const home = mk("case-b", "home");
    const main = repo(mk("case-b", "main"));
    const wt = join(root, "case-b", "wt");
    git(main, ["worktree", "add", "-b", "side", wt]);

    expect(existsSync(join(wt, "CLAUDE.md"))).toBe(true); // the worktree really does carry the laws
    expect(run({ file: join(wt, "src", "x.ts"), sessionRoot: main, home })).toBe("");
  });

  it("stays quiet after it has spoken once for the same project in the same session", () => {
    const home = mk("case-e", "home");
    const session = mk("case-e", "rootless"); // no CLAUDE.md, no .claude
    const target = project(mk("case-e", "proj"));
    const payload = (sid) =>
      execFileSync(process.execPath, [MIRROR], {
        input: JSON.stringify({ session_id: sid, cwd: session, tool_input: { file_path: join(target, "src", "x.ts") } }),
        encoding: "utf8",
        env: { ...process.env, USERPROFILE: home, HOME: home, TEMP: sandboxTmp, TMP: sandboxTmp, TMPDIR: sandboxTmp, CLAUDE_PROJECT_DIR: session },
      });

    expect(payload("throttle-1")).toMatch(/PROJECT CONFIG NOT LOADED/);
    expect(payload("throttle-1")).toBe("");
    expect(payload("throttle-2")).toMatch(/PROJECT CONFIG NOT LOADED/); // a new session hears it again
  });
});

describe("the warning it exists for is still delivered", () => {
  // The 2026-08-03 precedent: a session rooted at the home directory, working on a project below it.
  it("warns when the session carries no project config at all", () => {
    const home = mk("case-d", "home");
    const target = project(mk("case-d", "home", "code", "sentinel"));

    const msg = run({ file: join(target, "src", "x.ts"), sessionRoot: home, home });
    expect(msg).toMatch(/PROJECT CONFIG NOT LOADED/);
    expect(msg).toContain(target);
    expect(msg).toMatch(/CLAUDE\.md \(its standing laws did NOT auto-load\)/);
    expect(msg).toMatch(/every project hook is INERT this session/);
  });

  // The same-repository early-out must not have become "any repo is fine". Sharing git is the
  // evidence; two unrelated repos share nothing.
  it("warns across two different repositories, both of which carry config", { timeout: GIT_SPAWN_TIMEOUT_MS }, () => {
    const home = mk("case-c", "home");
    const a = repo(mk("case-c", "repo-a"));
    const b = repo(mk("case-c", "repo-b"));

    const msg = run({ file: join(b, "src", "x.ts"), sessionRoot: a, home });
    expect(msg).toMatch(/PROJECT CONFIG NOT LOADED/);
    expect(msg).toContain(b);
  });

  // Not a repository at all → no evidence either way → warn. Silence is only earned by proof.
  it("warns when neither side is a git repository", () => {
    const home = mk("case-f", "home");
    const session = project(mk("case-f", "session"));
    const target = project(mk("case-f", "target"));

    expect(run({ file: join(target, "src", "x.ts"), sessionRoot: session, home })).toMatch(
      /PROJECT CONFIG NOT LOADED/,
    );
  });
});

// The mirror is only worth having if it is the code that actually runs. Line endings are normalised
// because git may rewrite them on checkout and they do not change behaviour; anything else is drift.
describe("mirror matches the installed hook", () => {
  const lf = (p) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

  it.skipIf(!existsSync(INSTALLED))("~/.claude/hooks copy is identical to the versioned mirror", () => {
    expect(lf(INSTALLED)).toBe(lf(MIRROR));
  });
});
