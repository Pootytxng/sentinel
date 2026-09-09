// Issue #405 — a worktree created outside `compy-entry` arrives mis-provisioned, and nothing repairs
// it. The Claude Desktop harness makes folders under `.claude/worktrees/` without going through
// `tools/entry/launch.mjs`, so `createWorktree`'s guarantees never apply to them. Two rows arrive
// broken and stay broken, both already reported by guards nothing acts on:
//
//   1. `core.hooksPath` resolving OUTSIDE the folder. The repository config holds the correct
//      RELATIVE `.githooks`, which resolves per worktree; a worktree-scoped ABSOLUTE override points
//      the lookup at another checkout. Git reports no error. The folder simply pushes with no
//      pre-push hook — a silent loss of the only proof gate that exists (hosted CI is off).
//   2. Tracked files sitting on disk as CRLF although git would write LF TODAY. Measured mechanism,
//      reproduced below: this repository still sets `core.autocrlf=true`, so a checkout writes CRLF
//      for any path whose attributes do not pin `eol`. Git records the stat of what IT wrote, which
//      is why `git status` stays CLEAN over a CRLF file whose blob is LF — the index entry's size is
//      the CRLF size, so git never re-reads the content. When the `eol=lf` rules were later widened
//      to cover those paths, nothing re-normalised the folders already checked out. Every byte-budget
//      guard in the repository is then inflated by one byte per line, silently.
//
// WHAT THIS FILE PINS, AFTER TWO ROUNDS OF INDEPENDENT REVIEW: that the hook DIAGNOSES both defects
// and REPAIRS NEITHER. Round 1 shipped a repair gated on "Work Control verified this folder".
// Round-2 review (of 881fa8eb) established that the gate could not be made sound here at all: the
// authorization object was written by its own caller, the board carries no scope field to check it
// against, and overlap was measured only among sessions in the SAME folder — so a live writer in
// another worktree holding an overlapping path scope was invisible. The response is deletion, not a
// stricter guard. There is now no argument, in any combination, that makes this module write.
//
// It lives in `.claude/hooks/session-root-assert.mjs` rather than in `tools/entry/` for a
// reachability reason: the affected sessions never execute `tools/entry`, but they do execute the
// tracked SessionStart hook. It lives INSIDE that file, and not in a library beside it, because
// `tracked-hooks.test.mjs` pins the hook to `node:` imports only — it is copied alone into folders
// where `tools/entry` does not exist, which is exactly where this diagnosis is needed.
//
// The fixtures are real — `git init`, a real `git worktree add`, a real `git config --worktree`,
// real CRLF bytes on disk — because the subject is what git actually stores and reports. A mock
// would only reproduce the assumption.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import * as hook from "../../.claude/hooks/session-root-assert.mjs";
import {
  PREPUSH_VERIFIER,
  diagnoseWorktreeProvisioning,
  prePushRunsVerifier,
  provisioningRootFor,
} from "../../.claude/hooks/session-root-assert.mjs";
import { VERIFIER, prePushContractViolations } from "../../scripts/lib/prepush-hook-contract.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const HOOK_FILE = join(ROOT, ".claude", "hooks", "session-root-assert.mjs");
const REAL_PREPUSH = join(ROOT, ".githooks", "pre-push");

const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=guard", "-c", "user.email=guard@test", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** Git's own blob id for these exact bytes. The comparison the diagnosis is not allowed to skip. */
const blobSha = (buf) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest("hex");

const crCount = (buf) => buf.reduce((n, b) => (b === 0x0d ? n + 1 : n), 0);

const stripCrlf = (buf) => {
  const out = Buffer.alloc(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0x0d && buf[i + 1] === 0x0a) continue;
    out[n] = buf[i];
    n += 1;
  }
  return out.subarray(0, n);
};

const indexShaOf = (dir, path) => git(dir, "ls-files", "-s", "--", path).split(/\s+/)[1];

/**
 * A LINKED worktree keeps its own index, at `<common-dir>/worktrees/<name>/index` — so a write into
 * it is a write into that worktree's state, invisible to anyone hashing the host's.
 */
const indexFileOf = (dir) => join(git(dir, "rev-parse", "--absolute-git-dir"), "index");

/** Dirty ONLY stat metadata: identical bytes, a future mtime. Nothing about the content changes. */
const touchOnly = (file) => {
  writeFileSync(file, readFileSync(file));
  const future = new Date(Date.now() + 60_000);
  utimesSync(file, future, future);
};

const beds = [];
const newBed = (tag) => {
  const bed = mkdtempSync(join(tmpdir(), `compy-provisioning-${tag}-`));
  beds.push(bed);
  return bed;
};
afterAll(() => {
  for (const bed of beds) {
    try {
      rmSync(bed, { recursive: true, force: true });
    } catch {
      /* a locked file on Windows must not fail the suite */
    }
  }
});

/** `gitResult`'s shape, backed by real git — for tests that override one answer and keep the rest. */
const realRun = (cwd, args) => {
  try {
    return { ok: true, out: git(cwd, ...args), status: 0 };
  } catch (err) {
    return { ok: false, out: String(err?.stderr || err?.message || err).trim().split(/\r?\n/)[0], status: err?.status ?? null };
  }
};

/**
 * Every tracked file's exact bytes, so a test can prove the diagnosis changed nothing. Content, not
 * mtime: mtime is the thing a filesystem is allowed to lie about, and bytes are the claim.
 */
const snapshotBytes = (dir) => {
  const out = new Map();
  for (const rel of git(dir, "ls-files").split("\n").filter(Boolean)) {
    const file = join(dir, rel);
    if (existsSync(file)) out.set(rel, readFileSync(file).toString("base64"));
  }
  return out;
};

/**
 * A pre-push hook that is a REAL gate: it arms `set -e` and it actually runs the verifier. The
 * fixtures use this rather than a stub because round-1 review found the code accepting any non-empty
 * `.githooks` directory — so a fixture whose hook was `exit 0` proved nothing about whether that
 * directory holds a gate. `makeHost({ hookBody })` seeds the broken shapes.
 */
export const GATE_HOOK = [
  "#!/bin/sh",
  "set -e",
  "repo=$(git rev-parse --show-toplevel)",
  'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$repo/scripts/verify-local.ps1"',
  "",
].join("\n");

/**
 * A host repository shaped like this one: worktree config on, `core.autocrlf=true`, a RELATIVE
 * repo-level `core.hooksPath` (the correct value — it resolves per worktree), and its own tracked
 * `.githooks/`. `withHooks: false` builds the variant where a folder has no local hook at all.
 *
 * The attributes deliberately start WITHOUT an `eol` pin, because that is the state these folders
 * were checked out under. `makeBroken` widens them afterwards, exactly as this repository did.
 */
const makeHost = (tag, { withHooks = true, worktreeConfig = true, hookBody = GATE_HOOK } = {}) => {
  const bed = newBed(tag);
  const host = join(bed, "host");
  execFileSync("git", ["init", "-q", "-b", "main", host], { stdio: "ignore" });
  if (worktreeConfig) git(host, "config", "extensions.worktreeConfig", "true");
  git(host, "config", "core.autocrlf", "true");
  if (withHooks) git(host, "config", "core.hooksPath", ".githooks");
  writeFileSync(join(host, ".gitattributes"), "* text=auto\n");
  writeFileSync(join(host, "README.md"), "fixture\n");
  writeFileSync(join(host, "doc.md"), "one\ntwo\nthree\n");
  if (withHooks) {
    mkdirSync(join(host, ".githooks"), { recursive: true });
    writeFileSync(join(host, ".githooks", "pre-push"), hookBody);
  }
  git(host, "add", "-A");
  git(host, "commit", "-q", "-m", "fixture");
  return { bed, host };
};

/**
 * A linked worktree carrying both defects, in the exact shape measured in
 * `.claude/worktrees/post-constitution-reconciliation-d5df83` on 2026-09-08 — including the part
 * that makes the CRLF invisible.
 *
 * The order is the whole point and is not decoration. `git worktree add` runs under `text=auto` with
 * `core.autocrlf=true`, so GIT writes doc.md as CRLF and records that size in the index. Widening
 * the attributes to `eol=lf` afterwards changes what a checkout WOULD write without touching the
 * file already on disk or its index entry — so `git ls-files --eol` now says `i/lf w/crlf attr/…
 * eol=lf` while `git status` says nothing at all. Writing the CRLF by hand instead does NOT
 * reproduce this: git then sees a real content difference and reports the file modified.
 */
const makeBroken = ({ bed, host }, name, branch, { escape = true, crlf = true } = {}) => {
  const linked = join(bed, name);
  git(host, "worktree", "add", "-q", "-b", branch, linked);
  if (escape) git(linked, "config", "--worktree", "core.hooksPath", join(host, ".githooks"));
  writeFileSync(join(linked, ".gitattributes"), "* text eol=lf\n");
  git(linked, "add", ".gitattributes");
  git(linked, "commit", "-q", "-m", "widen eol=lf, long after the checkout");
  if (!crlf) {
    // The correctly-provisioned control: every tracked file already LF, the way `compy-entry`'s own
    // sibling checkouts measure. Normalised from git's list, not from a hand-written path list, so
    // adding a file to the fixture cannot silently leave a stray CRLF behind.
    const changed = [];
    for (const rel of git(linked, "ls-files").split("\n").filter(Boolean)) {
      const file = join(linked, rel);
      const bytes = readFileSync(file);
      const lf = stripCrlf(bytes);
      if (bytes.equals(lf)) continue;
      writeFileSync(file, lf);
      changed.push(rel);
    }
    // Without this the files read as modified on their stale CRLF stat entry, and the control folder
    // would look dirty rather than correctly provisioned.
    if (changed.length) git(linked, "update-index", "-q", "--refresh", "--", ...changed);
  }
  return linked;
};

describe("#405 the two defects reproduce, exactly as the fleet guards report them", () => {
  it("a linked worktree can carry an escaping hooksPath and CRLF-over-an-LF-blob, and git still calls it clean", () => {
    const bed = makeHost("real");
    const linked = makeBroken(bed, "linked-real", "lane/real");

    // Defect 1, and the reason it is invisible: git resolves it without complaint to another folder.
    const effective = git(linked, "config", "core.hooksPath");
    expect(resolve(linked, effective)).toBe(join(bed.host, ".githooks"));
    expect(resolve(linked, effective).startsWith(linked)).toBe(false);
    // ...while this folder has a perfectly good hook of its own, sitting unused.
    expect(existsSync(join(linked, ".githooks", "pre-push"))).toBe(true);

    // Defect 2, and the reason it survives every day of ordinary work: git wrote these bytes itself
    // and cached THAT size in the index, so `git status` short-circuits on the stat and never reads
    // the content. The file is CRLF, the blob is LF, and nothing anywhere says so.
    expect(git(linked, "ls-files", "--eol", "--", "doc.md")).toMatch(/i\/lf\s+w\/crlf\s+attr\/.*eol=lf/);
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(3);
    expect(git(linked, "status", "--porcelain")).toBe("");

    const cachedSize = Number(git(linked, "ls-files", "--debug", "--", "doc.md").match(/size:\s*(\d+)/)[1]);
    const blobSize = Number(git(linked, "cat-file", "-s", indexShaOf(linked, "doc.md")));
    expect(cachedSize).toBe(readFileSync(join(linked, "doc.md")).length); // 17 — what git wrote
    expect(blobSize).toBe(14); // ...over a 14-byte blob it still considers checked out
    expect(cachedSize).not.toBe(blobSize);
  }, 30_000);
});

describe("#405 the diagnosis — positive controls", () => {
  it("(A) names an escaping core.hooksPath, says a repoint would fix it, and repoints nothing", () => {
    const bed = makeHost("diag-hooks");
    const linked = makeBroken(bed, "linked-hooks", "lane/hooks");
    const before = git(linked, "config", "core.hooksPath");

    const r = diagnoseWorktreeProvisioning(linked, { expectedBranch: "lane/hooks" });

    expect(r.action).toBe("reported");
    expect(r.hooksPath.action).toBe("repairable");
    expect(r.hooksPath.to).toBe(".githooks");
    expect(r.line).toContain("escapes this folder");
    expect(r.line).toContain("nothing written");
    // The config is exactly as it was, at every level. "repairable" is a sentence, not an action.
    expect(git(linked, "config", "core.hooksPath")).toBe(before);
    expect(resolve(linked, git(linked, "config", "core.hooksPath")).startsWith(linked)).toBe(false);
    expect(git(bed.host, "config", "--local", "core.hooksPath")).toBe(".githooks");
  }, 30_000);

  it("(B) counts the CRLF files whose blob CR alone reproduces, and rewrites none of them", () => {
    const bed = makeHost("diag-eol");
    const linked = makeBroken(bed, "linked-eol", "lane/eol");
    const file = join(linked, "doc.md");
    const sha = indexShaOf(linked, "doc.md");
    const bytesBefore = readFileSync(file);
    expect(crCount(bytesBefore)).toBe(3);

    const r = diagnoseWorktreeProvisioning(linked, { expectedBranch: "lane/eol" });

    expect(r.action).toBe("reported");
    expect(r.lineEndings.provable).toContain("doc.md");
    expect(r.lineEndings.unprovable).toEqual([]);
    // The proof was made — dropping CR really does reproduce the blob — and NOT acted on.
    expect(blobSha(stripCrlf(bytesBefore))).toBe(sha);
    expect(readFileSync(file).equals(bytesBefore)).toBe(true);
    expect(crCount(readFileSync(file))).toBe(3);
  }, 30_000);

  it("(C) a folder that was provisioned correctly is a silent no-op", () => {
    const bed = makeHost("already-ok");
    const linked = makeBroken(bed, "linked-ok", "lane/ok", { escape: false, crlf: false });

    const r = diagnoseWorktreeProvisioning(linked, { expectedBranch: "lane/ok" });

    expect(r.action).toBe("clean");
    expect(r.line).toBeNull();
    expect(r.lineEndings.provable).toEqual([]);
  }, 30_000);
});

describe("#405 the diagnosis fails CLOSED — every refusal is its own test", () => {
  it("refuses a folder that is mid-edit, because the byte comparison would be about a moving target", () => {
    const bed = makeHost("dirty");
    const linked = makeBroken(bed, "linked-dirty", "lane/dirty");
    writeFileSync(join(linked, "README.md"), "edited by somebody who is still working\n");

    const r = diagnoseWorktreeProvisioning(linked, { expectedBranch: "lane/dirty" });

    expect(r.action).toBe("refused");
    expect(r.reason).toMatch(/mid-edit/);
    expect(r.hooksPath.action).toBe("skipped");
  }, 30_000);

  it("does NOT refuse over an untracked file — that would make it inert everywhere real work happens", () => {
    const bed = makeHost("untracked");
    const linked = makeBroken(bed, "linked-untracked", "lane/untracked");
    writeFileSync(join(linked, "scratch.tmp"), "notes\n");

    const r = diagnoseWorktreeProvisioning(linked, { expectedBranch: "lane/untracked" });

    expect(r.action).toBe("reported");
    expect(existsSync(join(linked, "scratch.tmp"))).toBe(true);
  }, 30_000);

  it("refuses when the checked-out branch is not the branch the claim names", () => {
    const bed = makeHost("wrongbranch");
    const linked = makeBroken(bed, "linked-wrongbranch", "lane/real-branch");

    const r = diagnoseWorktreeProvisioning(linked, { expectedBranch: "lane/liar" });

    expect(r.action).toBe("refused");
    expect(r.reason).toMatch(/not the claimed lane\/liar/);
  }, 30_000);

  it("refuses when no branch was named at all — an unverified folder is not a diagnosable one", () => {
    const bed = makeHost("nobranch");
    const linked = makeBroken(bed, "linked-nobranch", "lane/nobranch");

    const r = diagnoseWorktreeProvisioning(linked, {});

    expect(r.action).toBe("refused");
    expect(r.reason).toMatch(/no verified branch/);
  }, 30_000);

  it("never touches the main checkout, however broken it looks", () => {
    const bed = makeHost("mainrepo");
    makeBroken(bed, "linked-main", "lane/main-sibling");

    const r = diagnoseWorktreeProvisioning(bed.host, { expectedBranch: "main" });

    expect(r.action).toBe("main");
    expect(r.line).toBeNull();
  }, 30_000);

  it("reports a file as UNPROVABLE when dropping CR does not reproduce its blob", () => {
    const bed = makeHost("notblob");
    const linked = makeBroken(bed, "linked-notblob", "lane/notblob");
    // Same CRLF shape, different content: CR-dropping this cannot land on the committed blob.
    // Deliberately left unrefreshed afterwards. Measured on this git: `update-index --refresh` over
    // a path whose content genuinely changed does not merely restat it, it REWRITES the index
    // entry's object id (4cb29ea -> 3a52a22 on the probe fixture) — which would quietly make these
    // new bytes the blob and turn this into the provable case it exists to be the opposite of.
    writeFileSync(join(linked, "doc.md"), Buffer.from("one\r\ntwo\r\nDIFFERENT\r\n", "utf8"));
    // ...and it must still reach the diagnosis as a CANDIDATE, or the test proves nothing.
    expect(git(linked, "ls-files", "--eol", "--", "doc.md")).toMatch(/i\/lf\s+w\/crlf/);
    const before = readFileSync(join(linked, "doc.md"));

    const r = diagnoseWorktreeProvisioning(linked, {
      expectedBranch: "lane/notblob",
      // The folder now genuinely IS dirty, which is a different refusal; this test is about the
      // byte proof, so only the cleanliness answer is stubbed.
      run: (cwd, args) => (args[0] === "status" ? { ok: true, out: "", status: 0 } : realRun(cwd, args)),
    });

    expect(r.lineEndings.unprovable).toContain("doc.md");
    expect(r.lineEndings.provable).not.toContain("doc.md");
    expect(readFileSync(join(linked, "doc.md")).equals(before)).toBe(true);
  }, 30_000);

  it("will not call a folder with no .githooks/pre-push repairable — there is nothing safe to name", () => {
    const bed = makeHost("nohooks", { withHooks: false });
    const linked = makeBroken(bed, "linked-nohooks", "lane/nohooks", { escape: false });
    git(linked, "config", "--worktree", "core.hooksPath", join(bed.bed, "elsewhere"));

    const r = diagnoseWorktreeProvisioning(linked, { expectedBranch: "lane/nohooks" });

    expect(r.hooksPath.action).toBe("escapes");
    expect(r.hooksPath.reason).toMatch(/no \.githooks\/pre-push of its own/);
    expect(r.line).toContain("escapes this folder");
  }, 30_000);

  it("will not call it repairable when extensions.worktreeConfig is off", () => {
    const bed = makeHost("noext", { worktreeConfig: false });
    const linked = join(bed.bed, "linked-noext");
    git(bed.host, "worktree", "add", "-q", "-b", "lane/noext", linked);

    const r = diagnoseWorktreeProvisioning(linked, {
      expectedBranch: "lane/noext",
      run: (cwd, args) =>
        args[0] === "config" && args.includes("core.hooksPath") && args.includes("--get")
          ? { ok: true, out: join(bed.bed, "elsewhere"), status: 0 }
          : realRun(cwd, args),
    });

    expect(r.hooksPath.action).toBe("escapes");
    expect(r.hooksPath.reason).toMatch(/extensions\.worktreeConfig is not true/);
  }, 30_000);

  it("cannot measure line endings in a repository whose objects are not sha1", () => {
    const bed = makeHost("sha256");
    const linked = makeBroken(bed, "linked-sha256", "lane/sha256");

    const r = diagnoseWorktreeProvisioning(linked, {
      expectedBranch: "lane/sha256",
      run: (cwd, args) =>
        args[0] === "rev-parse" && args[1] === "--show-object-format"
          ? { ok: true, out: "sha256", status: 0 }
          : realRun(cwd, args),
    });

    expect(r.lineEndings.action).toBe("unmeasurable");
    expect(r.lineEndings.reason).toMatch(/not sha1/);
    expect(r.lineEndings.provable).toEqual([]);
  }, 30_000);

  it("a folder that is not a checkout, or no root at all, is skipped without a line — never a throw", () => {
    const bed = newBed("notrepo");
    expect(diagnoseWorktreeProvisioning(null).action).toBe("skipped");
    expect(diagnoseWorktreeProvisioning("").action).toBe("skipped");
    expect(
      diagnoseWorktreeProvisioning(bed, {
        expectedBranch: "lane/x",
        run: () => ({ ok: false, out: "fatal: not a git repository", status: 128 }),
      }).action,
    ).toBe("skipped");
  });
});

// The gate that decides whether the diagnosis runs at all. It is a separate exported function rather
// than an inline condition in `main()` so the fail-closed rule is testable instead of asserted: an
// unclaimed folder — which is the normal state for Kuya's own windows, for Cowork and for Codex —
// must get `null`, and therefore not even a diagnosis, no matter how broken it is.
describe("#405 the gate — only a folder Work Control has verified is looked at", () => {
  it("hands over the root only when the session verdict is ok", () => {
    expect(provisioningRootFor({ ok: true, root: "C:\\x", branch: "lane/a" })).toBe("C:\\x");
  });

  it("hands over null for every unverified verdict, advisory ones included", () => {
    expect(provisioningRootFor({ ok: false, code: "FOLDER_UNCLAIMED", root: "C:\\x" })).toBeNull();
    expect(provisioningRootFor({ ok: false, code: "BOARD_UNREACHABLE", root: "C:\\x" })).toBeNull();
    expect(provisioningRootFor({ ok: false, code: "WRONG_FOLDER", root: "C:\\x" })).toBeNull();
    expect(provisioningRootFor({ ok: true })).toBeNull();
    expect(provisioningRootFor(null)).toBeNull();
    expect(provisioningRootFor(undefined)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ROUND-2 REVIEW OF 881fa8eb — four findings, one describe each.
//
// Finding 1 is the one that removed a feature. Round 1 answered "folder + branch is not write
// authority" by requiring an `authorization` object that named an issue, a folder, a branch and two
// scope lists. Review established that this only moved the problem: the object is written by the
// caller, `docs/WORK_CONTROL.md`'s board carries no scope field to check `paths`/`config` against,
// overlap was measured only among sessions in the SAME folder, and the caller even supplied the
// `sessionId` used to exclude records. A licence a caller writes for itself is not a licence.
//
// So the write is gone. Not gated harder — gone, together with the authorization, the overlap
// helper and the index refresh that only a write needed. `:143-150` requires the exact scope to be
// recorded before a write and `:166` says scope is measured, not trusted; until something can
// measure scope and cross-worktree overlap, the honest amount of writing this hook may do is none.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("round-2 finding 1 — the module cannot write, for any caller, under any argument", () => {
  it("runs only read-only git subcommands — no config set, no update-index, no --worktree write", () => {
    const bed = makeHost("readonly");
    const linked = makeBroken(bed, "linked-readonly", "lane/readonly");
    const seen = [];

    const r = diagnoseWorktreeProvisioning(linked, {
      expectedBranch: "lane/readonly",
      run: (cwd, args) => {
        seen.push(args);
        return realRun(cwd, args);
      },
    });

    expect(r.action).toBe("reported"); // the folder really is broken, so this ran the whole way
    expect(seen.length).toBeGreaterThan(4);
    for (const args of seen) {
      // Every `config` read carries `--get`; a config WRITE is `config <key> <value>` and has none.
      if (args[0] === "config") expect(args).toContain("--get");
      expect(args[0]).not.toBe("update-index");
      expect(args[0]).not.toBe("add");
      expect(args[0]).not.toBe("checkout");
      expect(["rev-parse", "status", "config", "ls-files"]).toContain(args[0]);
    }
  }, 30_000);

  it("leaves every tracked byte in the folder exactly as it found it", () => {
    const bed = makeHost("nobytes");
    const linked = makeBroken(bed, "linked-nobytes", "lane/nobytes");
    const before = snapshotBytes(linked);
    expect(before.size).toBeGreaterThan(2);

    const r = diagnoseWorktreeProvisioning(linked, { expectedBranch: "lane/nobytes" });

    expect(r.lineEndings.provable.length).toBeGreaterThan(0); // it saw files it COULD have rewritten
    expect(snapshotBytes(linked)).toEqual(before);
  }, 30_000);

  it("ignores every option round 1 used to write with — there is no escape hatch left to pass", () => {
    const bed = makeHost("nohatch");
    const linked = makeBroken(bed, "linked-nohatch", "lane/nohatch");
    const before = snapshotBytes(linked);
    const hooksBefore = git(linked, "config", "core.hooksPath");
    let wrote = false;

    const r = diagnoseWorktreeProvisioning(linked, {
      expectedBranch: "lane/nohatch",
      // The exact shape that licensed a write at 881fa8eb, plus the seams it used.
      authorization: {
        issue: 405,
        folder: linked,
        branch: "lane/nohatch",
        sessionId: "session-under-test",
        paths: [".gitattributes", "README.md", "doc.md", ".githooks/pre-push"],
        config: ["core.hooksPath"],
      },
      liveSessions: () => [],
      allowPath: () => true,
      allowConfig: () => true,
      writeFile: () => {
        wrote = true;
      },
    });

    expect(wrote).toBe(false);
    expect(r.action).toBe("reported");
    expect(snapshotBytes(linked)).toEqual(before);
    expect(git(linked, "config", "core.hooksPath")).toBe(hooksBefore);
  }, 30_000);

  it("exports no repair entry point and no result action that claims one", () => {
    expect(hook.repairWorktreeProvisioning).toBeUndefined();
    expect(typeof hook.diagnoseWorktreeProvisioning).toBe("function");

    const bed = makeHost("actions");
    const linked = makeBroken(bed, "linked-actions", "lane/actions");
    const r = diagnoseWorktreeProvisioning(linked, { expectedBranch: "lane/actions" });
    expect(["reported", "clean", "main", "skipped", "refused"]).toContain(r.action);
    expect(r.action).not.toBe("repaired");
    expect(r.hooksPath.action).not.toBe("set");
  }, 30_000);

  it("the SessionStart call site asks for a diagnosis and passes nothing else", () => {
    const src = readFileSync(HOOK_FILE, "utf8");
    // Read off the file rather than asserted in prose: the call site is the whole surface that runs
    // unattended, and a future edit that hands it an authorization must fail here.
    expect(src).toContain("diagnoseWorktreeProvisioning(provisioningRootFor(result), { expectedBranch: result?.branch ?? null })");
    expect(src).not.toContain("repairWorktreeProvisioning");

    // ...and nothing in the provisioning module writes a worktree config key or refreshes the index.
    // Bounded by the file's own section markers rather than asserted over the whole file, because the
    // whole file is not the claim: `ensureWorktreeIdentity` a few lines above legitimately runs
    // `git config --worktree user.email`, and that is a different lane's function. Widening this to
    // the file would have made it fail for a true reason, which is how a guard gets weakened later.
    const start = src.indexOf("// ── worktree provisioning (#405)");
    const end = src.indexOf("// ── the assertion");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const module_ = src.slice(start, end);
    expect(module_).not.toContain('"--worktree"');
    expect(module_).not.toContain('"update-index"');
    expect(module_).not.toContain("writeFileSync");
  });
});

describe("round-2 finding 2 — the unmeasurable-overlap claim is gone, not merely weakened", () => {
  it("exports no overlap helper at all", () => {
    // At 881fa8eb `otherLiveSessionsIn` documented "unmeasurable counts as present" while its own
    // JSON read did `continue` on a corrupt record — so a record it could not parse vanished and the
    // function answered "nobody is here", licensing a write. Nothing reads it now, and a helper that
    // makes an authority claim it cannot keep is worse than no helper.
    expect(hook.otherLiveSessionsIn).toBeUndefined();
  });

  it("makes no non-overlap claim in its result or its printed line", () => {
    const bed = makeHost("noclaim");
    const linked = makeBroken(bed, "linked-noclaim", "lane/noclaim");

    const r = diagnoseWorktreeProvisioning(linked, { expectedBranch: "lane/noclaim" });

    expect(r).not.toHaveProperty("overlap");
    expect(r).not.toHaveProperty("liveSessions");
    expect(r.line).not.toMatch(/other live session|no other session|non-overlap/i);
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// Finding 3. The inlined checker must be a SAFE SUBSET of `scripts/lib/prepush-hook-contract.mjs`:
// anything it accepts, the canonical checker must accept too. Review reproduced one counterexample
// (`FOO=1 echo verify-local.ps1`); building the corpus below to test the property found SEVEN, in
// two classes — environment assignments read as command words, and shell operators inside a quoted
// string read as real operators. Both are fixed by transcribing the canonical file's own primitives
// (`blankQuoted`, `commandWord`) rather than by patching seeds one at a time, and the property below
// is what keeps the two files in step, since the hook may not import the module.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** The maintained corpus. Every entry is checked in BOTH directions by the property test below. */
const PREPUSH_CORPUS = (() => {
  const H = (body) => `#!/bin/sh\nset -e\n${body}\n`;
  const V = PREPUSH_VERIFIER;
  return [
    ["the real tracked hook", readFileSync(REAL_PREPUSH, "utf8")],
    ["empty", ""],
    ["comment only", "# nothing\n"],
    ["no set -e", `#!/bin/sh\npowershell -File ${V}\n`],
    ["plain run", H(`powershell -File ${V}`)],
    ["echo only", H(`echo ${V}`)],
    ["printf only", H(`printf ${V}`)],
    ["colon only", H(`: ${V}`)],
    ["trailing comment mention", H(`: # ${V}`)],
    ["swallowed || :", H(`powershell -File ${V} || :`)],
    ["swallowed || true", H(`powershell -File ${V} || true`)],
    ["backgrounded", H(`powershell -File ${V} &`)],
    ["unconditional exit 0 above", H(`exit 0\npowershell -File ${V}`)],
    ["set +e below", `#!/bin/sh\nset -e\nset +e\npowershell -File ${V}\n`],
    ["chained after echo", H(`echo starting && sh ${V}`)],
    // The five environment-assignment seeds. `FOO=1 echo x` is an echo, not a command called FOO=1.
    ["env assignment + echo", H(`FOO=1 echo ${V}`)],
    ["two env assignments + printf", H(`A=1 B=2 printf ${V}`)],
    ["env assignment + colon", H(`X=y : ${V}`)],
    ["redirection + echo", H(`>&2 echo ${V}`)],
    ["redirection + env + echo", H(`2>/dev/null FOO=1 echo ${V}`)],
    // The three quoted-operator seeds. An operator inside a diagnostic string splits nothing.
    ["operator inside a quoted echo", H(`echo "a && sh ${V}"`)],
    ["pipe inside a quoted echo", H(`echo "a | sh ${V}"`)],
    ["semicolon inside a quoted echo", H(`echo "a ; sh ${V}"`)],
    ["quoted command word", H(`"echo" ${V}`)],
    ["multiline quoted diagnostic", `#!/bin/sh\nset -e\necho 'no verifier\n${V}\n'\n`],
    ["indented exit 0 in an if", H(`if [ -z "$x" ]; then\n  exit 0\nfi\npowershell -File ${V}`)],
  ];
})();

describe("round-2 finding 3 — the inlined pre-push check is a safe subset of the canonical contract", () => {
  it("names the same verifier as scripts/lib/prepush-hook-contract.mjs", () => {
    expect(PREPUSH_VERIFIER).toBe(VERIFIER);
  });

  it("never accepts a hook the canonical checker refuses, across the whole corpus", () => {
    const unsafe = [];
    for (const [name, text] of PREPUSH_CORPUS) {
      if (prePushRunsVerifier(text) && prePushContractViolations(text).length > 0) unsafe.push(name);
    }
    // Measured at 881fa8eb, before the fix: 7 of these 26 were unsafe.
    expect(unsafe).toEqual([]);
  });

  it("refuses the exact seed the review reproduced, and its whole class", () => {
    const V = PREPUSH_VERIFIER;
    // The review's own text, character for character.
    expect(prePushRunsVerifier(`#!/bin/sh\nset -e\nFOO=1 echo ${V}\n`)).toBe(false);
    expect(prePushRunsVerifier(`#!/bin/sh\nset -e\nA=1 B=2 printf ${V}\n`)).toBe(false);
    expect(prePushRunsVerifier(`#!/bin/sh\nset -e\nX=y : ${V}\n`)).toBe(false);
    expect(prePushRunsVerifier(`#!/bin/sh\nset -e\n2>/dev/null FOO=1 echo ${V}\n`)).toBe(false);
  });

  it("refuses an operator hiding inside a quoted diagnostic", () => {
    const V = PREPUSH_VERIFIER;
    expect(prePushRunsVerifier(`#!/bin/sh\nset -e\necho "a && sh ${V}"\n`)).toBe(false);
    expect(prePushRunsVerifier(`#!/bin/sh\nset -e\necho "a | sh ${V}"\n`)).toBe(false);
    expect(prePushRunsVerifier(`#!/bin/sh\nset -e\necho "a ; sh ${V}"\n`)).toBe(false);
    // ...while a REAL operator outside quotes still counts, or the fix would be a mute button.
    expect(prePushRunsVerifier(`#!/bin/sh\nset -e\necho starting && sh ${V}\n`)).toBe(true);
  });

  it("still accepts this repository's own tracked pre-push hook", () => {
    const real = readFileSync(REAL_PREPUSH, "utf8");
    expect(prePushRunsVerifier(real)).toBe(true);
    expect(prePushContractViolations(real)).toEqual([]);
  });

  it("still refuses the stubs and swallowed gates round 1 was written for", () => {
    const V = PREPUSH_VERIFIER;
    expect(prePushRunsVerifier("")).toBe(false);
    expect(prePushRunsVerifier(`#!/bin/sh\nexit 0\n`)).toBe(false);
    expect(prePushRunsVerifier(`#!/bin/sh\nset -e\n# runs ${V} one day\n`)).toBe(false);
    expect(prePushRunsVerifier(`#!/bin/sh\nset -e\npowershell -File ${V} || :\n`)).toBe(false);
    expect(prePushRunsVerifier(`#!/bin/sh\nset -e\npowershell -File ${V} &\n`)).toBe(false);
    expect(prePushRunsVerifier(`#!/bin/sh\npowershell -File ${V}\n`)).toBe(false); // never armed
  });
});

describe("round-2 finding 4 — the code says what it does, so the PR can be checked against it", () => {
  it("is named for diagnosis, and reports the two defects without claiming to have fixed either", () => {
    const bed = makeHost("truth");
    const linked = makeBroken(bed, "linked-truth", "lane/truth");

    const r = diagnoseWorktreeProvisioning(linked, { expectedBranch: "lane/truth" });

    expect(r.line).toContain("DIAGNOSED, nothing written");
    expect(r.line).not.toMatch(/repaired|restored to LF|-> \.githooks/);
    // #405's acceptance criterion is "repaired on the next SessionStart". This is the measurement
    // that says so plainly rather than leaving a PR body to claim it: the folder is still broken.
    expect(resolve(linked, git(linked, "config", "core.hooksPath")).startsWith(linked)).toBe(false);
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(3);
  }, 30_000);
});

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// ROUND-3 REVIEW OF 7f7744ff — one finding, and it is the difference between "runs only read-only
// subcommands" and "writes nothing".
//
// `git status` opportunistically REFRESHES the index: it re-stats the working tree and rewrites the
// stat cache so the next reader is faster. That is a write, into the index of whichever worktree it
// was pointed at, performed by a command every one of these tests called read-only. Review measured
// it: touch one tracked file's mtime, call the diagnosis, and the linked worktree's index file
// changed (sha256 2c4cb550… -> 0e8a003a… on their fixture, 36b8765f… -> c1212ece… on mine) while the
// function returned a clean-looking answer and reported nothing.
//
// The round-2 tests could not see it. They snapshot tracked file BYTES and `core.hooksPath`, and the
// index is neither. So the guard here is the index file itself, and it is written to be able to
// fail: the second half of the first test performs the same stat-only dirt with optional locks left
// ON and requires the index to change, because a byte-identity assertion over a probe that cannot
// detect a write would be green for the wrong reason forever.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("round-3 finding — the diagnosis does not write the linked worktree's index either", () => {
  it("leaves the index byte-identical when only a tracked file's mtime moved", () => {
    const bed = makeHost("index");
    const linked = makeBroken(bed, "linked-index", "lane/index");
    const indexFile = indexFileOf(linked);

    // Settle first, so whatever follows is attributable to the diagnosis and not to the fixture.
    git(linked, "status", "--porcelain");
    touchOnly(join(linked, "README.md"));

    const before = readFileSync(indexFile);
    // No injected `run`: the SHIPPED path is the claim, and an injected runner would prove nothing
    // about what a real SessionStart does.
    const r = diagnoseWorktreeProvisioning(linked, { expectedBranch: "lane/index" });
    const after = readFileSync(indexFile);

    expect(r.action).toBe("reported"); // it really did the whole diagnosis over this folder
    expect(after.equals(before)).toBe(true);

    // ...and the probe can actually detect a write. Same stat-only dirt, optional locks left on.
    touchOnly(join(linked, "doc.md"));
    const beforeLoose = readFileSync(indexFile);
    execFileSync("git", ["-C", linked, "status", "--porcelain", "--untracked-files=no"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const afterLoose = readFileSync(indexFile);
    expect(afterLoose.equals(beforeLoose)).toBe(false);
  }, 30_000);

  it("leaves it identical on the refusal paths too, which run git before deciding to stop", () => {
    const bed = makeHost("index-refuse");
    const linked = makeBroken(bed, "linked-index-refuse", "lane/index-refuse");
    const indexFile = indexFileOf(linked);

    git(linked, "status", "--porcelain");
    touchOnly(join(linked, "README.md"));
    const before = readFileSync(indexFile);

    // Wrong branch: refused — but only AFTER `rev-parse` and `status` have already run.
    const refused = diagnoseWorktreeProvisioning(linked, { expectedBranch: "lane/not-this-one" });
    expect(refused.action).toBe("refused");
    expect(readFileSync(indexFile).equals(before)).toBe(true);

    // And the clean-folder path, which runs the full measurement and simply has nothing to say.
    const okBed = makeHost("index-clean");
    const okLinked = makeBroken(okBed, "linked-index-clean", "lane/index-clean", { escape: false, crlf: false });
    const okIndex = indexFileOf(okLinked);
    git(okLinked, "status", "--porcelain");
    touchOnly(join(okLinked, "README.md"));
    const okBefore = readFileSync(okIndex);
    expect(diagnoseWorktreeProvisioning(okLinked, { expectedBranch: "lane/index-clean" }).action).toBe("clean");
    expect(readFileSync(okIndex).equals(okBefore)).toBe(true);
  }, 30_000);

  it("routes every observation through the lock-free runner, not the shared one", () => {
    const src = readFileSync(HOOK_FILE, "utf8");
    const module_ = src.slice(
      src.indexOf("// \u2500\u2500 worktree provisioning (#405)"),
      src.indexOf("// \u2500\u2500 the assertion"),
    );
    // Both mechanisms: the flag survives a stripped environment, the variable survives a call path
    // that does not carry the flag. Either alone would be a guarantee with a hole in it.
    expect(module_).toContain('gitResult(root, ["--no-optional-locks", ...args], { env: { GIT_OPTIONAL_LOCKS: "0" } })');
    expect(module_).toContain("run = provisioningGit");
    expect(module_).not.toContain("run = gitResult");
  });
});
