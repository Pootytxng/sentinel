// Guard for the write-scope backstop (#356): scripts/lib/scope-drift.mjs decides, and
// scripts/scope-drift-gate.mjs is the push-gate step verify-local.ps1 runs on that decision.
//
// Why a backstop at all — the shell-ownership hook reads a command before it runs and guesses what it
// will write. Every gap in that guess (a redirect it did not model, a script the command calls, a
// tool outside the matcher) is a write nobody judged, and closing gaps by parsing more shell is the
// treadmill #356 declined. So the authority is the filesystem: what changed, against what was
// claimed. Everything that decides is a pure function over strings and is proven here from strings;
// the git and cache readers are proven against a real temporary repository and a real temporary
// directory, because "it would work with git" is not a measurement.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseWriteScope } from "./lib/claim-scope.mjs";
import {
  CACHE_TTL_MS,
  changedPaths,
  driftReport,
  isFresh,
  parseStatusZ,
  readClaimCache,
  renderDrift,
  samePath,
  scopeFromClaimText,
  writeClaimCache,
} from "./lib/scope-drift.mjs";
import { gate, parseArgs, render, resolveClaim } from "./scope-drift-gate.mjs";

const ROOT = resolve(process.cwd());
const read = (rel) => readFileSync(join(ROOT, ...rel.split("/")), "utf8");

describe("driftReport — the decision, over strings", () => {
  it("names the changed paths the scope never covered, and the ones it did", () => {
    const r = driftReport({ changed: ["scripts/a.mjs", "src/x.ts", "docs/BACKLOG.md"], scope: ["scripts/", "docs/BACKLOG.md"] });
    expect(r.measured).toBe(true);
    expect(r.outside).toEqual(["src/x.ts"]);
    expect(r.covered).toEqual(["scripts/a.mjs", "docs/BACKLOG.md"]);
  });

  it("a directory scope covers every file under it; a glob covers exactly its shape", () => {
    expect(driftReport({ changed: ["tools/entry/deep/x.mjs"], scope: ["tools/entry/"] }).outside).toEqual([]);
    expect(driftReport({ changed: ["docs/dispositions/x.json"], scope: ["docs/dispositions/*.json"] }).outside).toEqual([]);
    // A single star does not cross a separator.
    expect(driftReport({ changed: ["docs/dispositions/sub/x.json"], scope: ["docs/dispositions/*.json"] }).outside).toEqual([
      "docs/dispositions/sub/x.json",
    ]);
  });

  it("an empty scope is NOT 'everything is outside' — it is 'cannot measure'", () => {
    const r = driftReport({ changed: ["src/x.ts"], scope: [] });
    expect(r.measured).toBe(false);
    expect(r.outside).toEqual([]);
  });

  it("backslashes and ./ prefixes do not create false drift", () => {
    expect(driftReport({ changed: [".\\scripts\\a.mjs"], scope: ["scripts/"] }).outside).toEqual([]);
  });
});

describe("the claim's scope field, parsed as the claim template writes it", () => {
  it("reads backticked paths and drops the ones a sentence disclaims", () => {
    const text =
      "`scripts/`, `tools/entry/`, `.claude/hooks/`, and two src guards only: `src/claude-md-laws-guard.test.ts`. " +
      "No other `src/` or `src-tauri/` writes.";
    // Patterns come back normalized: no trailing slash, so `scripts/` and `scripts` are one pattern.
    const scope = scopeFromClaimText(text);
    expect(scope).toContain("scripts");
    expect(scope).toContain("tools/entry");
    expect(scope).toContain("src/claude-md-laws-guard.test.ts");
    expect(scope).not.toContain("src");
    expect(scope).not.toContain("src-tauri");
  });

  it("a field that wrapped across lines in the thread is still one bullet", () => {
    expect(scopeFromClaimText("`a/`,\n`b/`")).toEqual(["a", "b"]);
  });

  // bug->guard (2026-09-02): the per-path disclaimer reset at every path, so "no other `src/` or
  // `src-tauri/` writes" disclaimed src/ and GRANTED src-tauri/ — the closeout lane's own claim.
  it("a disclaimer carries across a bare conjunction and stops at the next sentence", () => {
    expect(parseWriteScope("- Write scope: No other `src/` or `src-tauri/` writes.")).toEqual([]);
    expect(parseWriteScope("- Write scope: `a`, `b`, and `c`")).toEqual(["a", "b", "c"]);
    expect(parseWriteScope("- Write scope: `a` but not `b`, `c`")).toEqual(["a"]);
    expect(parseWriteScope("- Write scope: `a` but not `b`; also `c`")).toEqual(["a", "c"]);
    expect(parseWriteScope("- Write scope: `a`; no `b` writes")).toEqual(["a"]);
  });
});

describe("parseStatusZ", () => {
  it("reads modified, staged, untracked and both names of a rename", () => {
    const raw = " M a.txt\0A  b.txt\0?? new.txt\0R  new-name.txt\0old-name.txt\0";
    expect(parseStatusZ(raw)).toEqual(["a.txt", "b.txt", "new.txt", "new-name.txt", "old-name.txt"]);
  });
  it("is empty for an empty status", () => {
    expect(parseStatusZ("")).toEqual([]);
  });
});

describe("the claim cache", () => {
  let dir;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "compy-scope-cache-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("round-trips a claim with its parsed scope and the text it was parsed from", () => {
    const now = new Date("2026-09-02T10:00:00Z");
    const rec = writeClaimCache({ issue: 4242, scopeText: "`docs/` and `scripts/`", folder: "C:/x", branch: "b" }, { dir, now });
    expect(rec.scope).toEqual(["docs", "scripts"]);
    const back = readClaimCache({ issue: 4242, dir });
    expect(back).toEqual(rec);
    expect(back.cachedAt).toBe(now.toISOString());
  });

  it("a missing or unreadable cache is null — 'not measured', never an empty scope", () => {
    expect(readClaimCache({ issue: 1, dir })).toBeNull();
    writeFileSync(join(dir, "2.json"), "{not json");
    expect(readClaimCache({ issue: 2, dir })).toBeNull();
    writeFileSync(join(dir, "3.json"), JSON.stringify({ issue: 3 }));
    expect(readClaimCache({ issue: 3, dir })).toBeNull();
  });

  it("is fresh for the TTL and not a millisecond longer; a future stamp is not fresh either", () => {
    const at = new Date("2026-09-02T10:00:00Z");
    const rec = { cachedAt: at.toISOString() };
    expect(isFresh(rec, { now: new Date(at.getTime() + CACHE_TTL_MS) })).toBe(true);
    expect(isFresh(rec, { now: new Date(at.getTime() + CACHE_TTL_MS + 1) })).toBe(false);
    expect(isFresh(rec, { now: new Date(at.getTime() - 1) })).toBe(false);
    expect(isFresh({}, { now: at })).toBe(false);
  });
});

describe("resolveClaim — cache first, thread when stale, stale cache when the thread is down", () => {
  let dir;
  const now = new Date("2026-09-02T12:00:00Z");
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "compy-scope-resolve-"));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("a fresh cache is used without touching the thread", () => {
    writeClaimCache({ issue: 10, scopeText: "`docs/`" }, { dir, now });
    let asked = 0;
    const r = resolveClaim({ issue: 10, cacheDir: dir, now, thread: () => (asked++, { claim: null }) });
    expect(r.source).toBe("cache");
    expect(asked).toBe(0);
  });

  it("a stale cache re-reads the thread and rewrites the cache", () => {
    writeClaimCache({ issue: 11, scopeText: "`docs/`" }, { dir, now: new Date(now.getTime() - CACHE_TTL_MS - 1) });
    const r = resolveClaim({ issue: 11, cacheDir: dir, now, thread: () => ({ claim: { scope: "`scripts/`", folder: "F", branch: "B" } }) });
    expect(r.source).toBe("thread");
    expect(r.claim.scope).toEqual(["scripts"]);
    expect(readClaimCache({ issue: 11, dir }).scope).toEqual(["scripts"]);
  });

  it("a stale cache survives an unreachable thread, labelled stale", () => {
    writeClaimCache({ issue: 12, scopeText: "`docs/`" }, { dir, now: new Date(now.getTime() - CACHE_TTL_MS - 1) });
    const r = resolveClaim({
      issue: 12,
      cacheDir: dir,
      now,
      thread: () => {
        throw new Error("offline");
      },
    });
    expect(r.source).toBe("cache");
    expect(r.stale).toBe(true);
  });

  it("offline with no cache is no claim; --refresh re-reads even a fresh cache", () => {
    expect(resolveClaim({ issue: 13, cacheDir: dir, now, offline: true, thread: () => ({ claim: { scope: "`x`" } }) }).claim).toBeNull();
    writeClaimCache({ issue: 14, scopeText: "`docs/`" }, { dir, now });
    const r = resolveClaim({ issue: 14, cacheDir: dir, now, refresh: true, thread: () => ({ claim: { scope: "`tools/`" } }) });
    expect(r.source).toBe("thread");
    expect(r.claim.scope).toEqual(["tools"]);
  });
});

describe("changedPaths, against a fake git", () => {
  it("unions the working tree with the commits since the base, and says when the base is absent", () => {
    const calls = [];
    const git = (cwd, args) => {
      calls.push(args.join(" "));
      if (args[0] === "status") return " M a.txt\0?? b/c.txt\0";
      if (args[0] === "rev-parse") return "";
      if (args[0] === "diff") return "a.txt\0d.txt\0";
      throw new Error(`unexpected ${args.join(" ")}`);
    };
    const r = changedPaths({ cwd: ".", git });
    expect(r.paths).toEqual(["a.txt", "b/c.txt", "d.txt"]);
    expect(r.base).toBe("origin/main");
    expect(calls.some((c) => c.includes("origin/main...HEAD"))).toBe(true);

    const noBase = (cwd, args) => {
      if (args[0] === "status") return "?? z.txt\0";
      if (args[0] === "rev-parse") throw new Error("unknown revision");
      throw new Error("diff must not run without a base");
    };
    const r2 = changedPaths({ cwd: ".", git: noBase });
    expect(r2.paths).toEqual(["z.txt"]);
    expect(r2.base).toBeNull();
    expect(r2.notes.join(" ")).toMatch(/not a commit here/);
  });
});

describe("gate, over a real temporary repository", () => {
  let repo;
  let cacheDir;
  const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), "compy-scope-repo-"));
    cacheDir = mkdtempSync(join(tmpdir(), "compy-scope-gate-cache-"));
    git(["init", "-q"]);
    git(["config", "user.email", "guard@example.invalid"]);
    git(["config", "user.name", "guard"]);
    git(["config", "commit.gpgsign", "false"]);
    mkdirSync(join(repo, "docs"));
    mkdirSync(join(repo, "scripts"));
    writeFileSync(join(repo, "docs", "a.md"), "a\n");
    writeFileSync(join(repo, "scripts", "b.mjs"), "b\n");
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "base"]);
    // The base this gate measures against, without a network: origin/main IS this commit.
    git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    writeClaimCache({ issue: 999, scopeText: "`docs/`", folder: repo, branch: "lane/x" }, { dir: cacheDir });
  });
  afterAll(() => {
    rmSync(repo, { recursive: true, force: true });
    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("passes when every change is inside the claim", () => {
    writeFileSync(join(repo, "docs", "a.md"), "a changed\n");
    const r = gate({ issue: 999, cwd: repo, cacheDir, offline: true });
    expect(r.measured).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.covered).toEqual(["docs/a.md"]);
    expect(r.base).toBe("origin/main");
    expect(render(r)).toMatch(/^scope drift \(#356\): 1 changed path/);
    expect(render(r)).toMatch(/OK: every changed path is inside `docs`/);
  });

  it("fails on an untracked file outside the claim, and names it", () => {
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "x.ts"), "x\n");
    const r = gate({ issue: 999, cwd: repo, cacheDir, offline: true });
    expect(r.ok).toBe(false);
    expect(r.outside).toEqual(["src/x.ts"]);
    const text = render(r);
    expect(text).toContain("  - src/x.ts");
    expect(text).toContain("cure:");
  });

  it("a committed change is still drift — the diff since origin/main counts, not just the working tree", () => {
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "drift"]);
    const r = gate({ issue: 999, cwd: repo, cacheDir, offline: true });
    expect(r.ok).toBe(false);
    expect(r.outside).toEqual(["src/x.ts"]);
  });

  it("the CLI exits 1 on drift and prints the verdict as JSON on request", () => {
    const result = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "scope-drift-gate.mjs"), "--issue", "999", "--cwd", repo, "--cache-dir", cacheDir, "--offline", "--json"],
      { encoding: "utf8", cwd: ROOT, timeout: 60_000 },
    );
    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.outside).toEqual(["src/x.ts"]);
  }, 60_000);

  it("a claim that names another folder does not apply here: not measured, and passes", () => {
    writeClaimCache({ issue: 998, scopeText: "`docs/`", folder: join(repo, "elsewhere") }, { dir: cacheDir });
    const r = gate({ issue: 998, cwd: repo, cacheDir, offline: true });
    expect(r.measured).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/another folder/);
  });

  it("no session record and no --issue: not measured, passes, says so", () => {
    const r = gate({ cwd: repo, cacheDir, offline: true, lineage: () => null });
    expect(r.measured).toBe(false);
    expect(r.ok).toBe(true);
    expect(render(r)).toMatch(/not measured -- no session record/);
  });

  it("the session record supplies the issue when --issue is absent", () => {
    const r = gate({ cwd: repo, cacheDir, offline: true, lineage: () => ({ issue: 999 }) });
    expect(r.measured).toBe(true);
    expect(r.issue).toBe(999);
  });

  it("a claim with no backticked paths cannot be measured against", () => {
    writeClaimCache({ issue: 997, scopeText: "everything this lane needs", folder: repo }, { dir: cacheDir });
    const r = gate({ issue: 997, cwd: repo, cacheDir, offline: true });
    expect(r.measured).toBe(false);
    expect(r.reason).toMatch(/no backticked paths/);
  });
});

describe("small pieces", () => {
  it("parseArgs reads every flag and refuses an unknown one", () => {
    const a = parseArgs(["--issue", "7", "--cwd", "x", "--base", "main", "--refresh", "--offline", "--cache-dir", "c", "--json"]);
    expect(a).toMatchObject({ issue: 7, cwd: "x", base: "main", refresh: true, offline: true, cacheDir: "c", json: true });
    expect(() => parseArgs(["--bogus"])).toThrow(/unknown argument/);
  });
  it("samePath ignores case and separators", () => {
    expect(samePath("C:\\Users\\X\\repo\\", "c:/users/x/repo")).toBe(true);
    expect(samePath("C:/a", "C:/b")).toBe(false);
    expect(samePath(null, "C:/b")).toBe(false);
  });
  it("renderDrift carries the cure and the stale caveat", () => {
    const text = renderDrift({ issue: 5, outside: ["src/x.ts"], scope: ["docs/"], stale: true });
    expect(text).toContain("stale cache");
    expect(text).toContain("--refresh");
  });
});

describe("residency: verify-local.ps1 runs the gate before the test suite", () => {
  const gateCode = read("scripts/verify-local.ps1")
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");

  it("resolves node and invokes scripts/scope-drift-gate.mjs through Invoke-Check", () => {
    expect(gateCode).toMatch(/\$node = Resolve-RequiredCommand "node"/);
    // Not -NodeHosted: the runtime-abort re-run is deliberately narrow (local-gate-guard pins it to the
    // two npm checks), and a one-second script that reads git does not earn a second attempt.
    expect(gateCode).toMatch(/Invoke-Check -Name "write-scope drift \(#356\)" -Command \$node -Arguments @\("scripts\/scope-drift-gate\.mjs"\)\s*$/m);
  });

  it("runs it after `git diff --check` and before the frontend tests — a scope verdict before twenty minutes of tests", () => {
    const drift = gateCode.indexOf("scope-drift-gate.mjs");
    expect(drift).toBeGreaterThan(gateCode.indexOf('"git diff check"'));
    expect(drift).toBeLessThan(gateCode.indexOf('"frontend tests"'));
  });

  it("the gate script exists and is the one the hook shares its library with", () => {
    expect(existsSync(join(ROOT, "scripts", "scope-drift-gate.mjs"))).toBe(true);
    expect(read("scripts/scope-drift-gate.mjs")).toContain('from "./lib/scope-drift.mjs"');
    expect(read(".claude/hooks/scope-drift-check.mjs")).toContain('from "../../scripts/lib/scope-drift.mjs"');
  });
});
