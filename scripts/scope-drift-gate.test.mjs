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
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { CORRUPT } from "../.claude/hooks/session-root-assert.mjs";
import { parseScopePatterns, parseWriteScope } from "./lib/claim-scope.mjs";
import {
  CACHE_TTL_MS,
  changedPaths,
  driftReport,
  isFresh,
  parseStatusZ,
  readClaimCache,
  renderDrift,
  samePath,
  writeClaimCache,
} from "./lib/scope-drift.mjs";
import { exitCode, gate, parseArgs, render, resolveClaim } from "./scope-drift-gate.mjs";

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

  it("…unless the claim declared `Write scope: none` (#554): that scope holds no path, so everything is outside", () => {
    expect(driftReport({ changed: ["src/x.ts"], scope: [], none: true })).toMatchObject({ measured: true, outside: ["src/x.ts"], covered: [], none: true });
    expect(driftReport({ changed: [], scope: [], none: true })).toMatchObject({ measured: true, outside: [] });
  });

  it("backslashes and ./ prefixes do not create false drift", () => {
    expect(driftReport({ changed: [".\\scripts\\a.mjs"], scope: ["scripts/"] }).outside).toEqual([]);
  });
});

// The drift reader holds scope TEXT already extracted from the claim, so it calls the pattern
// parser directly (#408). It used to reach that parser by pasting the text into a fake
// `- Write scope: ` bullet, which made a boundary rule it did not want part of its own contract.
describe("the claim's scope field, parsed as the claim template writes it", () => {
  it("reads backticked paths and drops the ones a sentence disclaims", () => {
    const text =
      "`scripts/`, `tools/entry/`, `.claude/hooks/`, and two src guards only: `src/claude-md-laws-guard.test.ts`. " +
      "No other `src/` or `src-tauri/` writes.";
    // Patterns come back normalized: no trailing slash, so `scripts/` and `scripts` are one pattern.
    const scope = parseScopePatterns(text);
    expect(scope).toContain("scripts");
    expect(scope).toContain("tools/entry");
    expect(scope).toContain("src/claude-md-laws-guard.test.ts");
    expect(scope).not.toContain("src");
    expect(scope).not.toContain("src-tauri");
  });

  it("a field that wrapped across lines in the thread is still one bullet", () => {
    expect(parseScopePatterns("`a/`,\n`b/`")).toEqual(["a", "b"]);
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

  // #459: a thread that was READ and holds no live claim is the record saying the lease is over. The
  // cache is a copy of that record, so it cannot outvote it, however fresh it is.
  it("a thread read with no live claim outvotes even a fresh cache, and the cached copy is dropped", () => {
    writeClaimCache({ issue: 15, scopeText: "`docs/`" }, { dir, now });
    const handoff = { released: true, postedAt: "2026-09-02T11:59:00Z" };
    const r = resolveClaim({ issue: 15, cacheDir: dir, now, refresh: true, thread: () => ({ claim: null, handoff }) });
    expect(r.claim).toBeNull();
    expect(r.vacant).toBe(true);
    expect(r.handoff).toEqual(handoff);
    expect(readClaimCache({ issue: 15, dir })).toBeNull();
  });

  it("a thread that could not be read is not a released one: the stale cache still stands, labelled stale", () => {
    writeClaimCache({ issue: 16, scopeText: "`docs/`" }, { dir, now: new Date(now.getTime() - CACHE_TTL_MS - 1) });
    const r = resolveClaim({ issue: 16, cacheDir: dir, now, thread: () => ({ claim: null, handoff: null, unreadable: true }) });
    expect(r.source).toBe("cache");
    expect(r.stale).toBe(true);
    expect(r.claim.scope).toEqual(["docs"]);
    expect(readClaimCache({ issue: 16, dir })).not.toBeNull();
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

  // #573. A folder with no session record (a receipts carrier started by hand: the #540 shape)
  // stopped at the case above even while its issue held a live claim naming it. The fallback asks the
  // board which issue names this folder and the thread what that issue claims, both read fresh, and
  // measures only when the folder as it stands agrees with both. Every miss is "not measured", never
  // a guess. The board, the live folder, the thread and the session record are injected: no network.
  describe("no session record: the board fallback (#573)", () => {
    const BRANCH = "claude/mystifying-feynman-75ac2b";
    const RECEIPT = ".claude/work-control/2026-09-24-close-issue-540.json";
    const dirs = [];
    let repo;
    const fgit = (args, cwd = repo) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const tempDir = (prefix) => {
      const d = mkdtempSync(join(tmpdir(), prefix));
      dirs.push(d);
      return d;
    };
    /** A seam that answers with `fn` and counts how often it was asked. */
    const counted = (fn) => {
      const seam = (...args) => {
        seam.calls += 1;
        return fn(...args);
      };
      seam.calls = 0;
      return seam;
    };
    const row = (over = {}) => ({ issue: 540, folder: repo, branch: BRANCH, status: "Done", ...over });
    const here = (over = {}) => ({ toplevel: repo.replace(/\\/g, "/"), repo: "pootytxng/sentinel", branch: BRANCH, isWorktree: true, ...over });
    // The #540 carrier's claim as it was posted: a forward-slash folder, prose after the branch name.
    const liveClaim = (over = {}) => ({
      claim: { scope: `\`${RECEIPT}\``, folder: repo.replace(/\\/g, "/"), branch: `${BRANCH} (at main \`371676368c4f\`)`, postedAt: "2026-09-24T21:21:31Z", ...over },
      handoff: null,
    });
    /** Every seam injected and counted; `over` replaces any of them. */
    const seams = (over = {}) => ({
      lineage: counted(() => null),
      board: counted(() => [row()]),
      live: counted(() => here()),
      thread: counted(() => liveClaim()),
      ...over,
    });
    const run = (s, opts = {}) => gate({ cwd: repo, cacheDir: tempDir("compy-scope-fallback-cache-"), ...s, ...opts });

    beforeAll(() => {
      repo = tempDir("compy-scope-fallback-");
      fgit(["init", "-q", "-b", BRANCH]);
      fgit(["config", "user.email", "guard@example.invalid"]);
      fgit(["config", "user.name", "guard"]);
      fgit(["config", "commit.gpgsign", "false"]);
      mkdirSync(join(repo, "docs"));
      writeFileSync(join(repo, "docs", "a.md"), "a\n");
      fgit(["add", "-A"]);
      fgit(["commit", "-q", "-m", "base"]);
      fgit(["update-ref", "refs/remotes/origin/main", "HEAD"]);
      // A URL only. Nothing here fetches; the live reader parses it.
      fgit(["remote", "add", "origin", "https://github.com/Pootytxng/sentinel.git"]);
      mkdirSync(join(repo, ".claude", "work-control"), { recursive: true });
      writeFileSync(join(repo, ...RECEIPT.split("/")), "{}\n");
    });
    afterAll(() => {
      vi.unstubAllEnvs();
      vi.resetModules();
      for (const d of dirs) rmSync(d, { recursive: true, force: true });
    });

    it("1. the #540 shape: a Done row, a live receipt-only claim naming this folder, prose on its Branch line: measured OK; one path outside it is red, exit 1", () => {
      const s = seams();
      const r = run(s);
      expect(r).toMatchObject({ ok: true, measured: true, issue: 540, issueSource: "board", claimSource: "thread", stale: false });
      expect(r.covered).toEqual([RECEIPT]);
      expect(render(r)).toMatch(/measured against the claim on #540 \(thread; issue from the board/);
      expect(exitCode(r)).toBe(0);
      expect([s.board.calls, s.live.calls, s.thread.calls]).toEqual([1, 1, 1]);

      writeFileSync(join(repo, "stray.txt"), "x\n");
      try {
        const red = run(seams());
        expect(red).toMatchObject({ ok: false, measured: true, issue: 540, issueSource: "board", outside: ["stray.txt"] });
        expect(exitCode(red)).toBe(1);
      } finally {
        rmSync(join(repo, "stray.txt"), { force: true });
      }
    });

    it("2. the #506 shape: the one row naming this folder is on another branch: not measured, the reason names that branch, the thread is never read", () => {
      const s = seams({ board: counted(() => [row({ issue: 506, branch: "claude/506-ledger-observed-assumption" })]) });
      const r = run(s);
      expect(r).toMatchObject({ ok: true, measured: false });
      expect(r.reason).toContain("#506");
      expect(r.reason).toContain("claude/506-ledger-observed-assumption");
      expect(s.board.calls).toBe(1);
      expect(s.thread.calls).toBe(0);
    });

    it("3. a failed board fetch is no answer, even while board.json holds this folder's row, fresh or stale; a fresh board.json does not skip the fetch", async () => {
      // board.json lives in the entry store, a directory fixed when the hook module loads. Reload both
      // modules against a temporary store, so the row planted below is exactly what they would read.
      const entryDir = tempDir("compy-scope-fallback-entry-");
      vi.resetModules();
      vi.stubEnv("COMPY_ENTRY_DIR", entryDir);
      try {
        const hook = await import("../.claude/hooks/session-root-assert.mjs");
        const reloaded = await import("./scope-drift-gate.mjs");
        expect(hook.TOKEN_DIR).toBe(entryDir);
        for (const ageMs of [60_000, 2 * 60 * 60_000]) {
          hook.writeBoardCache({ fetchedAt: new Date(Date.now() - ageMs).toISOString(), rows: [row()] });
          // Control: the planted row is what the cached board reader serves, fresh and stale alike.
          expect(hook.boardFacts({ fetch: () => null }).rows).toEqual([row()]);
          const s = seams({ board: counted(() => null) });
          const r = reloaded.gate({ cwd: repo, cacheDir: tempDir("compy-scope-fallback-cache-"), ...s });
          expect(r, `board.json ${ageMs} ms old`).toMatchObject({ ok: true, measured: false });
          expect(r.reason).toMatch(/board could not be read/);
          expect(s.board.calls).toBe(1);
          expect(s.thread.calls).toBe(0);
        }
        // A truncated read is a failed read: the default reader returns null for it.
        const item = { content: { number: 540 }, "worktree / branch": `${repo} @ ${BRANCH}`, status: "Done" };
        const truncated = counted(() => hook.fetchBoardRows({ run: () => JSON.stringify({ items: [item], totalCount: 1001 }) }));
        const r = reloaded.gate({ cwd: repo, cacheDir: tempDir("compy-scope-fallback-cache-"), ...seams({ board: truncated }) });
        expect(r).toMatchObject({ ok: true, measured: false });
        expect(r.reason).toMatch(/board could not be read/);
        expect(truncated.calls).toBe(1);
      } finally {
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    });

    it("4. a thread whose claim was released, or that holds none, is no answer while a fresh cached claim still covers every change", () => {
      const threads = [
        [() => ({ claim: null, handoff: { released: true, postedAt: "2026-09-24T21:40:00Z" } }), /released.*2026-09-24T21:40:00Z/],
        [() => ({ claim: null, handoff: null }), /holds no live claim/],
      ];
      for (const [answer, why] of threads) {
        const cacheDir = tempDir("compy-scope-fallback-cache-");
        writeClaimCache({ issue: 540, scopeText: `\`${RECEIPT}\``, folder: repo, branch: BRANCH }, { dir: cacheDir });
        const s = seams({ thread: counted(answer) });
        const r = gate({ cwd: repo, cacheDir, ...s });
        expect(r).toMatchObject({ ok: true, measured: false });
        expect(r.reason).toMatch(why);
        expect(s.thread.calls).toBe(1);
      }
    });

    it("5. a thread that cannot be read is no answer while a cached claim exists, fresh or stale: no cached claim counts here", () => {
      const unreadable = [
        () => ({ claim: null, handoff: null, unreadable: true }),
        () => {
          throw new Error("gh: network down");
        },
      ];
      for (const answer of unreadable) {
        for (const ageMs of [0, CACHE_TTL_MS + 60_000]) {
          const cacheDir = tempDir("compy-scope-fallback-cache-");
          writeClaimCache({ issue: 540, scopeText: `\`${RECEIPT}\``, folder: repo, branch: BRANCH }, { dir: cacheDir, now: new Date(Date.now() - ageMs) });
          const s = seams({ thread: counted(answer) });
          const r = gate({ cwd: repo, cacheDir, ...s });
          expect(r, `cache ${ageMs} ms old`).toMatchObject({ ok: true, measured: false });
          expect(r.reason).toMatch(/thread on #540 could not be read/);
          expect(s.thread.calls).toBe(1);
        }
      }
    });

    it("6. a live claim that names another folder, or no folder, is no answer", () => {
      const other = run(seams({ thread: counted(() => liveClaim({ folder: "C:/Users/Kuya/code/sentinel/.claude/worktrees/some-other-lane" })) }));
      expect(other).toMatchObject({ ok: true, measured: false });
      expect(other.reason).toMatch(/names another folder/);
      expect(other.reason).toContain("some-other-lane");
      for (const folder of [null, undefined, ""]) {
        const none = run(seams({ thread: counted(() => liveClaim({ folder })) }));
        expect(none, `folder ${JSON.stringify(folder)}`).toMatchObject({ ok: true, measured: false });
        expect(none.reason).toMatch(/names no Worktree folder/);
      }
    });

    it("7. no row naming this folder is no answer; two rows (a stale Done row and a live one) are no answer either, and both are named", () => {
      for (const rows of [[], [row({ issue: 777, folder: join(tmpdir(), "some-other-folder") })]]) {
        const s = seams({ board: counted(() => rows) });
        const r = run(s);
        expect(r).toMatchObject({ ok: true, measured: false });
        expect(r.reason).toMatch(/no board row names this folder/);
        expect(s.thread.calls).toBe(0);
      }
      const s = seams({ board: counted(() => [row({ issue: 506, branch: "claude/506-ledger-observed-assumption" }), row({ issue: 540, status: "Active" })]) });
      const r = run(s);
      expect(r).toMatchObject({ ok: true, measured: false });
      expect(r.reason).toMatch(/2 board rows name this folder/);
      expect(r.reason).toContain("#506");
      expect(r.reason).toContain("#540");
      expect(s.thread.calls).toBe(0);
    });

    it("8. a wrong origin, a detached HEAD, or a folder that is not the git top-level is no answer", () => {
      const shapes = [
        [here({ repo: "someone/sentinel-fork" }), /origin/],
        [here({ repo: null }), /origin/],
        [here({ branch: null }), /detached/],
        [here({ toplevel: resolve(repo, "..").replace(/\\/g, "/") }), /not the git top-level/],
        [here({ toplevel: null }), /not the git top-level/],
      ];
      for (const [folder, why] of shapes) {
        const s = seams({ live: counted(() => folder) });
        const r = run(s);
        expect(r, JSON.stringify(folder)).toMatchObject({ ok: true, measured: false });
        expect(r.reason).toMatch(why);
        expect(s.thread.calls).toBe(0);
      }
    });

    it("8, over real git: the default live reader passes this folder as it is, and refuses it detached, re-pointed, or entered from a subfolder", () => {
      // Control: the folder as it really is agrees, so the refusals below are the reader's, not a setup fault.
      expect(run(seams({ live: undefined }))).toMatchObject({ ok: true, measured: true, issue: 540 });

      fgit(["checkout", "-q", "--detach"]);
      try {
        const r = run(seams({ live: undefined }));
        expect(r).toMatchObject({ ok: true, measured: false });
        expect(r.reason).toMatch(/detached/);
      } finally {
        fgit(["checkout", "-q", BRANCH]);
      }

      fgit(["remote", "set-url", "origin", "https://github.com/someone/sentinel-fork.git"]);
      try {
        const r = run(seams({ live: undefined }));
        expect(r).toMatchObject({ ok: true, measured: false });
        expect(r.reason).toMatch(/origin/);
      } finally {
        fgit(["remote", "set-url", "origin", "https://github.com/Pootytxng/sentinel.git"]);
      }

      const sub = join(repo, "docs");
      const r = gate({ cwd: sub, cacheDir: tempDir("compy-scope-fallback-cache-"), ...seams({ live: undefined, board: counted(() => [row({ folder: sub })]) }) });
      expect(r).toMatchObject({ ok: true, measured: false });
      expect(r.reason).toMatch(/not the git top-level/);
    });

    it("9. --offline, --issue, a CORRUPT record, or any session record: the board is never read", () => {
      const variants = [
        ["--offline", { offline: true }, null],
        ["--issue", { issue: 540 }, null],
        ["a CORRUPT record", {}, CORRUPT],
        ["a record for another issue", {}, { issue: 506 }],
        ["a record with no usable issue", {}, { folder: repo }],
      ];
      for (const [label, opts, record] of variants) {
        const s = seams({ lineage: counted(() => record) });
        run(s, opts);
        expect(s.board.calls, label).toBe(0);
        expect(s.live.calls, label).toBe(0);
      }
      // Control: the same seams with none of those do read the board, so the zeros above can fail.
      const control = seams();
      run(control);
      expect(control.board.calls).toBe(1);
    });
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

  // #554: `Write scope: none` is a declared scope that holds no path, not a missing one. A read-only
  // lane that writes anything is drift, measured at the push like any other.
  it("a `Write scope: none` claim is measured, and every changed path is outside it", () => {
    writeClaimCache({ issue: 994, scopeText: "none yet. The measurement is read-only.", folder: repo }, { dir: cacheDir });
    const r = gate({ issue: 994, cwd: repo, cacheDir, offline: true });
    expect(r).toMatchObject({ measured: true, none: true, ok: false, scope: [] });
    expect(r.changed.length).toBeGreaterThan(0);
    expect(r.outside).toEqual(r.changed);
    expect(render(r)).toContain("claimed: none (`Write scope: none` holds no path)");
  });

  // #459, observed on #457: after a Handoff released the claim, `--refresh` still printed "measured
  // against the claim on #457 (cache)" and OK. The cached scope here covers every changed path, so a
  // gate that vouches from it prints exactly that OK.
  it("a thread with no live claim plus a fresh cache does not report OK against the cached scope", () => {
    writeClaimCache({ issue: 996, scopeText: "`docs/`, `scripts/`, `src/`", folder: repo }, { dir: cacheDir });
    const r = gate({ issue: 996, cwd: repo, cacheDir, refresh: true, thread: () => ({ claim: null }) });
    expect(r.measured).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.reason).toMatch(/^no live claim/);
    expect(render(r)).toMatch(/^scope drift \(#356\): not measured -- /);
    expect(render(r)).not.toMatch(/OK: every changed path/);
    expect(readClaimCache({ issue: 996, dir: cacheDir })).toBeNull();
  });

  it("the pre-push path (a stale cache, no --refresh) says the claim was released, and when", () => {
    const stale = new Date(Date.now() - CACHE_TTL_MS - 60_000);
    writeClaimCache({ issue: 995, scopeText: "`docs/`, `scripts/`, `src/`", folder: repo }, { dir: cacheDir, now: stale });
    const thread = () => ({ claim: null, handoff: { released: true, postedAt: "2026-09-18T03:29:00Z" } });
    const r = gate({ issue: 995, cwd: repo, cacheDir, thread });
    expect(r.measured).toBe(false);
    expect(r.reason).toMatch(/^claim released/);
    expect(r.reason).toContain("2026-09-18T03:29:00Z");
    expect(readClaimCache({ issue: 995, dir: cacheDir })).toBeNull();
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
  it("a `Write scope: none` claim with nothing changed is OK, and says why", () => {
    const r = { measured: true, ok: true, none: true, issue: 552, base: "origin/main", claimSource: "thread", stale: false, notes: [], scope: [], changed: [], covered: [], outside: [] };
    expect(render(r)).toContain("OK: the claim declares `Write scope: none`, and nothing changed");
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
