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
// The repair lives in `.claude/hooks/session-root-assert.mjs` rather than in `tools/entry/` for a
// reachability reason, not a stylistic one: the affected sessions never execute `tools/entry`, but
// they do execute the tracked SessionStart hook. It lives INSIDE that file, and not in a library
// beside it, because `tracked-hooks.test.mjs` pins the hook to `node:` imports only — it is copied
// alone into folders where `tools/entry` does not exist, which is exactly where this repair is
// needed. `ensureWorktreeIdentity` is in that file for the same reason.
//
// What this file is really pinning is the REFUSALS. A repair that runs in a folder it has not proved
// out is worse than no repair, so every precondition below has its own test, and the byte proof is
// exact-blob or nothing: content is never "fixed", only CR bytes are dropped, and only when dropping
// them reproduces the blob git already has. The fixtures are real — `git init`, a real
// `git worktree add`, a real `git config --worktree`, real CRLF bytes on disk — because the subject
// is what git actually stores and reports. A mock would only reproduce the assumption.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { provisioningRootFor, repairWorktreeProvisioning } from "../../.claude/hooks/session-root-assert.mjs";

const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=guard", "-c", "user.email=guard@test", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

/** Git's own blob id for these exact bytes. The comparison the repair is not allowed to skip. */
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
 * A host repository shaped like this one: worktree config on, `core.autocrlf=true`, a RELATIVE
 * repo-level `core.hooksPath` (the correct value — it resolves per worktree), and its own tracked
 * `.githooks/`. `withHooks: false` builds the variant where pointing a folder at its own `.githooks`
 * would LOSE the last hook it still reaches rather than restore one.
 *
 * The attributes deliberately start WITHOUT an `eol` pin, because that is the state these folders
 * were checked out under. `makeBroken` widens them afterwards, exactly as this repository did.
 */
const makeHost = (tag, { withHooks = true, worktreeConfig = true } = {}) => {
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
    writeFileSync(join(host, ".githooks", "pre-push"), "#!/bin/sh\nexit 0\n");
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
 * reproduce this: git then sees a real content difference and reports the file modified, and the
 * repair would be operating on a dirty folder, which it refuses.
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
    // adding a file to the fixture cannot silently leave a stray CRLF behind and turn "clean" into
    // "repaired" for a reason the test never mentions.
    const changed = [];
    for (const rel of git(linked, "ls-files").split("\n").filter(Boolean)) {
      const file = join(linked, rel);
      const bytes = readFileSync(file);
      const lf = stripCrlf(bytes);
      if (bytes.equals(lf)) continue;
      writeFileSync(file, lf);
      changed.push(rel);
    }
    // Same refresh the repair itself has to do, for the same reason: without it these files read as
    // modified on their stale CRLF stat entry, and the control folder would look dirty rather than
    // correctly provisioned.
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

describe("#405 the repair — positive controls", () => {
  it("(A) points an escaping core.hooksPath back at the folder's own .githooks, per worktree", () => {
    const bed = makeHost("fix-hooks");
    const linked = makeBroken(bed, "linked-hooks", "lane/hooks");

    const r = repairWorktreeProvisioning(linked, { expectedBranch: "lane/hooks" });

    expect(r.action).toBe("repaired");
    expect(r.hooksPath.action).toBe("set");
    expect(resolve(linked, git(linked, "config", "core.hooksPath"))).toBe(join(linked, ".githooks"));
    // Per worktree, never repo-wide. The repository-level value was always correct — it is RELATIVE,
    // so it resolves inside whichever worktree reads it — and the repair leaves it exactly as it is.
    expect(git(bed.host, "config", "--local", "core.hooksPath")).toBe(".githooks");
    expect(git(linked, "config", "--worktree", "core.hooksPath")).toBe(".githooks");
    // Idempotent — the next session in the same folder finds nothing to do.
    expect(repairWorktreeProvisioning(linked, { expectedBranch: "lane/hooks" }).hooksPath.action).toBe("ok");
  }, 30_000);

  it("(B) drops CR bytes only where the result reproduces the blob git already has", () => {
    const bed = makeHost("fix-eol");
    const linked = makeBroken(bed, "linked-eol", "lane/eol");
    const file = join(linked, "doc.md");
    const sha = indexShaOf(linked, "doc.md");
    expect(crCount(readFileSync(file))).toBe(3);

    const r = repairWorktreeProvisioning(linked, { expectedBranch: "lane/eol" });

    expect(r.action).toBe("repaired");
    expect(r.lineEndings.repaired).toContain("doc.md");
    expect(r.lineEndings.left).toEqual([]);

    const after = readFileSync(file);
    expect(crCount(after)).toBe(0);
    // The content was never edited. The bytes on disk ARE the blob, byte for byte.
    expect(blobSha(after)).toBe(sha);
    expect(after.toString("utf8")).toBe("one\ntwo\nthree\n");
    // ...and the stat cache was rebuilt, so the folder does not now report phantom modifications.
    expect(git(linked, "status", "--porcelain")).toBe("");
  }, 30_000);

  it("(C) a folder that was provisioned correctly is a silent no-op", () => {
    const bed = makeHost("already-ok");
    const linked = makeBroken(bed, "linked-ok", "lane/ok", { escape: false, crlf: false });

    const r = repairWorktreeProvisioning(linked, { expectedBranch: "lane/ok" });

    expect(r.action).toBe("clean");
    expect(r.line).toBeNull();
    expect(r.lineEndings.repaired).toEqual([]);
  }, 30_000);
});

describe("#405 the repair fails CLOSED — every refusal is its own test", () => {
  it("refuses a dirty folder, and writes nothing", () => {
    const bed = makeHost("dirty");
    const linked = makeBroken(bed, "linked-dirty", "lane/dirty");
    writeFileSync(join(linked, "README.md"), "edited by somebody else\n");

    const r = repairWorktreeProvisioning(linked, { expectedBranch: "lane/dirty" });

    expect(r.action).toBe("refused");
    expect(r.reason).toMatch(/dirty|clean/i);
    expect(resolve(linked, git(linked, "config", "core.hooksPath"))).toBe(join(bed.host, ".githooks"));
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(3);
  }, 30_000);

  it("does NOT refuse over an untracked file — that would make the repair inert everywhere real work happens", () => {
    // The deliberate limit of the "clean" precondition. Neither repair can touch an untracked path:
    // one writes a worktree config key, the other writes only over tracked bytes it has already
    // proved are the blob. A MODIFIED TRACKED file is the signal that somebody is mid-edit; a
    // scratch file is not, and every folder anyone actually works in has one.
    const bed = makeHost("untracked");
    const linked = makeBroken(bed, "linked-untracked", "lane/untracked");
    writeFileSync(join(linked, "scratch.tmp"), "notes to self\n");
    expect(git(linked, "status", "--porcelain")).toBe("?? scratch.tmp");

    const r = repairWorktreeProvisioning(linked, { expectedBranch: "lane/untracked" });

    expect(r.action).toBe("repaired");
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(0);
    expect(readFileSync(join(linked, "scratch.tmp")).toString("utf8")).toBe("notes to self\n");
  }, 30_000);

  it("refuses when the checked-out branch is not the branch the claim names", () => {
    const bed = makeHost("branch");
    const linked = makeBroken(bed, "linked-branch", "lane/branch");

    const r = repairWorktreeProvisioning(linked, { expectedBranch: "lane/something-else" });

    expect(r.action).toBe("refused");
    expect(r.reason).toMatch(/branch/i);
    expect(resolve(linked, git(linked, "config", "core.hooksPath"))).toBe(join(bed.host, ".githooks"));
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(3);
  }, 30_000);

  it("refuses when no branch was named at all — an unverified folder is not a repairable one", () => {
    const bed = makeHost("nobranch");
    const linked = makeBroken(bed, "linked-nobranch", "lane/nobranch");

    const r = repairWorktreeProvisioning(linked, { expectedBranch: null });

    expect(r.action).toBe("refused");
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(3);
  }, 30_000);

  it("never touches the main checkout, however broken it looks", () => {
    const bed = makeHost("main");
    git(bed.host, "config", "--worktree", "core.hooksPath", join(bed.bed, "elsewhere", ".githooks"));
    writeFileSync(join(bed.host, "doc.md"), "one\r\ntwo\r\nthree\r\n");

    const r = repairWorktreeProvisioning(bed.host, { expectedBranch: "main" });

    expect(r.action).toBe("main");
    expect(r.line).toBeNull();
    expect(crCount(readFileSync(join(bed.host, "doc.md")))).toBe(3);
  }, 30_000);

  it("leaves a file alone when dropping CR does NOT reproduce the blob", () => {
    const bed = makeHost("liar");
    const linked = makeBroken(bed, "linked-liar", "lane/liar");
    const file = join(linked, "doc.md");

    // The seam feeds bytes whose CR-stripped form is NOT the blob. That is the whole test: the
    // repair must not "fix" a file it cannot prove, and must not fall back to a textual rule.
    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/liar",
      readFile: () => Buffer.from("one\r\ntwo\r\nDIFFERENT\r\n", "utf8"),
    });

    expect(r.lineEndings.repaired).toEqual([]);
    expect(r.lineEndings.left).toContain("doc.md");
    expect(crCount(readFileSync(file))).toBe(3);
    expect(readFileSync(file).toString("utf8")).toBe("one\r\ntwo\r\nthree\r\n");
  }, 30_000);

  it("refuses to rewrite hooksPath when the folder has no .githooks of its own", () => {
    // Pointing this folder at `.githooks` would not restore a hook; it would delete the last one it
    // still reaches. Escaping-but-present beats correct-but-empty, so the refusal is the safe answer.
    const bed = makeHost("nohooks", { withHooks: false });
    const elsewhere = join(bed.bed, "elsewhere", ".githooks");
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, "pre-push"), "#!/bin/sh\nexit 0\n");
    const linked = join(bed.bed, "linked-nohooks");
    git(bed.host, "worktree", "add", "-q", "-b", "lane/nohooks", linked);
    git(linked, "config", "--worktree", "core.hooksPath", elsewhere);

    const r = repairWorktreeProvisioning(linked, { expectedBranch: "lane/nohooks" });

    expect(r.hooksPath.action).toBe("refused");
    expect(r.hooksPath.reason).toMatch(/githooks/i);
    expect(resolve(linked, git(linked, "config", "core.hooksPath"))).toBe(elsewhere);
  }, 30_000);

  it("refuses to write worktree config when extensions.worktreeConfig is off", () => {
    // Turning it on is a repository-wide config change. This repair is folder-scoped; it reports and
    // stops rather than widening itself.
    const bed = makeHost("noext", { worktreeConfig: false });
    const linked = join(bed.bed, "linked-noext");
    git(bed.host, "worktree", "add", "-q", "-b", "lane/noext", linked);
    git(bed.host, "config", "core.hooksPath", join(bed.host, ".githooks"));

    const r = repairWorktreeProvisioning(linked, { expectedBranch: "lane/noext" });

    expect(r.hooksPath.action).toBe("refused");
    expect(r.hooksPath.reason).toMatch(/worktreeConfig/i);
    // It did not quietly turn the extension on to get its way.
    expect(() => git(bed.host, "config", "--get", "extensions.worktreeConfig")).toThrow();
    expect(resolve(linked, git(linked, "config", "core.hooksPath"))).toBe(join(bed.host, ".githooks"));
  }, 30_000);

  it("refuses a repository whose objects are not sha1 — the byte proof would be unprovable", () => {
    const bed = makeHost("objfmt");
    const linked = makeBroken(bed, "linked-objfmt", "lane/objfmt");

    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/objfmt",
      run: (cwd, args) =>
        args[0] === "rev-parse" && args[1] === "--show-object-format"
          ? { ok: true, out: "sha256", status: 0 }
          : realRun(cwd, args),
    });

    expect(r.lineEndings.action).toBe("refused");
    expect(r.lineEndings.reason).toMatch(/sha1|object format/i);
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(3);
  }, 30_000);

  it("a folder that is not a checkout, or no root at all, is skipped without a line — never a throw", () => {
    const bed = newBed("notrepo");
    expect(repairWorktreeProvisioning(null).action).toBe("skipped");
    expect(repairWorktreeProvisioning("").action).toBe("skipped");
    expect(
      repairWorktreeProvisioning(bed, {
        expectedBranch: "lane/x",
        run: () => ({ ok: false, out: "fatal: not a git repository", status: 128 }),
      }).action,
    ).toBe("skipped");
  });
});

// The gate that decides whether the repair runs at all. It is a separate exported function rather
// than an inline condition in `main()` so the fail-closed rule is testable instead of asserted: an
// unclaimed folder — which is the normal state for Kuya's own windows, for Cowork and for Codex —
// must get `null`, and therefore no repair, no matter how broken it is.
describe("#405 the gate — only a folder Work Control has verified is repaired", () => {
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
