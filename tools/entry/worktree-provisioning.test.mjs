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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import {
  PREPUSH_VERIFIER,
  prePushRunsVerifier,
  provisioningRootFor,
  repairWorktreeProvisioning,
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
/**
 * A pre-push hook that is a REAL gate: it arms `set -e` and it actually runs the verifier. The
 * fixtures use this rather than a stub because #406's independent review found the repair accepting
 * any non-empty `.githooks` directory — so a fixture whose hook was `exit 0` proved nothing about
 * whether repointing at it preserves a gate. `makeHost({ hookBody })` seeds the broken shapes.
 */
export const GATE_HOOK = [
  "#!/bin/sh",
  "set -e",
  "repo=$(git rev-parse --show-toplevel)",
  'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$repo/scripts/verify-local.ps1"',
  "",
].join("\n");

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
 * A complete, valid provisioning authorization for `linked` — the exact shape a caller must supply
 * before `repairWorktreeProvisioning` writes ANYTHING. Tests narrow it field by field, because the
 * point of #406 finding 1 is that folder + branch is not write authority: the scope has to be named,
 * and it is enforced per item rather than trusted.
 */
const authFor = (linked, branch, over = {}) => ({
  issue: 405,
  folder: linked,
  branch,
  sessionId: "session-under-test",
  paths: [".gitattributes", "README.md", "doc.md", ".githooks/pre-push"],
  config: ["core.hooksPath"],
  ...over,
});

/** The non-overlap seam, proving nothing else holds this folder. Injected so the overlap refusal is
 *  a test rather than a claim; the production default reads the real lineage records. */
const noOtherSessions = () => [];

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

    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/hooks",
      liveSessions: noOtherSessions,
      authorization: authFor(linked, "lane/hooks"),
    });

    expect(r.action).toBe("repaired");
    expect(r.hooksPath.action).toBe("set");
    expect(resolve(linked, git(linked, "config", "core.hooksPath"))).toBe(join(linked, ".githooks"));
    // Per worktree, never repo-wide. The repository-level value was always correct — it is RELATIVE,
    // so it resolves inside whichever worktree reads it — and the repair leaves it exactly as it is.
    expect(git(bed.host, "config", "--local", "core.hooksPath")).toBe(".githooks");
    expect(git(linked, "config", "--worktree", "core.hooksPath")).toBe(".githooks");
    // Idempotent — the next session in the same folder finds nothing to do.
    const again = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/hooks",
      liveSessions: noOtherSessions,
      authorization: authFor(linked, "lane/hooks"),
    });
    expect(again.hooksPath.action).toBe("ok");
  }, 30_000);

  it("(B) drops CR bytes only where the result reproduces the blob git already has", () => {
    const bed = makeHost("fix-eol");
    const linked = makeBroken(bed, "linked-eol", "lane/eol");
    const file = join(linked, "doc.md");
    const sha = indexShaOf(linked, "doc.md");
    expect(crCount(readFileSync(file))).toBe(3);

    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/eol",
      liveSessions: noOtherSessions,
      authorization: authFor(linked, "lane/eol"),
    });

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

    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/untracked",
      liveSessions: noOtherSessions,
      authorization: authFor(linked, "lane/untracked"),
    });

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
      liveSessions: noOtherSessions,
      authorization: authFor(linked, "lane/liar"),
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

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// #406 — the four findings of the independent review of 6a446c9b, one describe each.
//
// The first is the structural one and it changed the default. `provisioningRootFor` gated only on
// "Work Control verified this folder", and the board row it verifies against carries nothing but
// issue / folder / branch — no write scope at all. So a valid, NARROW claim (say, two files on
// #405) was enough to license rewriting every matching tracked path in the folder, which is exactly
// what `docs/WORK_CONTROL.md:143-150` forbids and what its ":162" collision rule means by "one
// active mutation lease per overlapping scope". Scope is measured, not trusted.
//
// The repair is not a tighter gate on the same behaviour. It is a different default: SessionStart
// DIAGNOSES and writes nothing. A write needs an explicit provisioning authorization that names its
// exact scope, and that scope is then enforced per path and per config key rather than believed.
// Folder + branch remain necessary and are no longer sufficient.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

describe("#406 finding 1 — SessionStart is diagnostic-only; folder + branch is not write authority", () => {
  it("with no authorization it reports both defects and writes nothing at all", () => {
    const bed = makeHost("diag");
    const linked = makeBroken(bed, "linked-diag", "lane/diag");
    const before = readFileSync(join(linked, "doc.md"));

    const r = repairWorktreeProvisioning(linked, { expectedBranch: "lane/diag", liveSessions: noOtherSessions });

    expect(r.action).toBe("diagnosed");
    expect(r.line).toMatch(/diagnos/i);
    // It SAW both defects — this is not a silent skip that happens to write nothing.
    expect(r.hooksPath.action).toBe("withheld");
    expect(r.hooksPath.to).toBe(".githooks");
    expect(r.lineEndings.action).toBe("withheld");
    expect(r.lineEndings.withheld).toContain("doc.md");
    expect(r.lineEndings.repaired).toEqual([]);
    // ...and changed neither of them.
    expect(resolve(linked, git(linked, "config", "core.hooksPath"))).toBe(join(bed.host, ".githooks"));
    expect(readFileSync(join(linked, "doc.md")).equals(before)).toBe(true);
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(3);
  }, 30_000);

  it("a valid claim whose scope is DISJOINT from the defects performs zero config and zero file writes", () => {
    // The review's exact case: the claim on #405 covers two files under `.claude/` and `tools/`, and
    // the CRLF repair wanted to rewrite 203 paths. A narrow claim is not a wide licence.
    const bed = makeHost("disjoint");
    const linked = makeBroken(bed, "linked-disjoint", "lane/disjoint");

    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/disjoint",
      liveSessions: noOtherSessions,
      authorization: authFor(linked, "lane/disjoint", { paths: ["some/other/file.md"], config: [] }),
    });

    expect(r.action).toBe("diagnosed");
    expect(r.lineEndings.repaired).toEqual([]);
    expect(r.lineEndings.withheld).toContain("doc.md");
    expect(r.hooksPath.action).toBe("withheld");
    expect(resolve(linked, git(linked, "config", "core.hooksPath"))).toBe(join(bed.host, ".githooks"));
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(3);
    expect(crCount(readFileSync(join(linked, "README.md")))).toBe(1);
  }, 30_000);

  it("a NARROW scope repairs exactly the paths it names, and withholds every other one", () => {
    const bed = makeHost("narrow");
    const linked = makeBroken(bed, "linked-narrow", "lane/narrow");
    expect(crCount(readFileSync(join(linked, "README.md")))).toBe(1);

    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/narrow",
      liveSessions: noOtherSessions,
      authorization: authFor(linked, "lane/narrow", { paths: ["doc.md"], config: [] }),
    });

    expect(r.action).toBe("repaired");
    expect(r.lineEndings.repaired).toEqual(["doc.md"]);
    expect(r.lineEndings.withheld).toContain("README.md");
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(0);
    // Unnamed, therefore untouched — including the config key, which this authorization omits.
    expect(crCount(readFileSync(join(linked, "README.md")))).toBe(1);
    expect(resolve(linked, git(linked, "config", "core.hooksPath"))).toBe(join(bed.host, ".githooks"));
  }, 30_000);

  it("an authorization that names NO scope authorizes nothing — the identity fields are not a licence", () => {
    const bed = makeHost("noscope");
    const linked = makeBroken(bed, "linked-noscope", "lane/noscope");

    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/noscope",
      liveSessions: noOtherSessions,
      authorization: authFor(linked, "lane/noscope", { paths: [], config: [] }),
    });

    expect(r.action).toBe("diagnosed");
    expect(r.lineEndings.repaired).toEqual([]);
    expect(resolve(linked, git(linked, "config", "core.hooksPath"))).toBe(join(bed.host, ".githooks"));
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(3);
  }, 30_000);

  it("refuses outright when another live session holds this same folder", () => {
    // #405's own fail-closed list: "no other live session holds an overlapping scope". Two writers
    // in one folder is the collision `docs/WORK_CONTROL.md` calls "one folder, one writer".
    const bed = makeHost("overlap");
    const linked = makeBroken(bed, "linked-overlap", "lane/overlap");

    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/overlap",
      authorization: authFor(linked, "lane/overlap"),
      liveSessions: () => [{ folder: linked, sessionId: "some-other-session", liveness: "live" }],
    });

    expect(r.action).toBe("refused");
    expect(r.reason).toMatch(/another live session/i);
    expect(resolve(linked, git(linked, "config", "core.hooksPath"))).toBe(join(bed.host, ".githooks"));
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(3);
  }, 30_000);

  it("refuses when non-overlap cannot be measured at all — unprovable is not proven", () => {
    const bed = makeHost("unmeasurable");
    const linked = makeBroken(bed, "linked-unmeasurable", "lane/unmeasurable");

    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/unmeasurable",
      authorization: authFor(linked, "lane/unmeasurable"),
      liveSessions: () => {
        throw new Error("lineage directory unreadable");
      },
    });

    expect(r.action).toBe("refused");
    expect(r.reason).toMatch(/overlap|lineage|unreadable/i);
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(3);
  }, 30_000);

  it("refuses an authorization that names another folder, or another branch", () => {
    const bed = makeHost("mismatch");
    const linked = makeBroken(bed, "linked-mismatch", "lane/mismatch");
    const call = (over) =>
      repairWorktreeProvisioning(linked, {
        expectedBranch: "lane/mismatch",
        liveSessions: noOtherSessions,
        authorization: authFor(linked, "lane/mismatch", over),
      });

    expect(call({ folder: join(bed.bed, "somewhere-else") }).action).toBe("refused");
    expect(call({ branch: "lane/other" }).action).toBe("refused");
    expect(call({ issue: 0 }).action).toBe("refused");
    expect(call({ paths: "doc.md" }).action).toBe("refused");

    expect(resolve(linked, git(linked, "config", "core.hooksPath"))).toBe(join(bed.host, ".githooks"));
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(3);
  }, 30_000);

  it("the SessionStart call site passes no authorization, so the hook itself can never write", () => {
    // The reachability claim in one assertion, read off the file rather than asserted in prose: the
    // only in-repo caller is `main()`, and it must not hand this function a write licence.
    const src = readFileSync(HOOK_FILE, "utf8");
    const call = src.slice(src.indexOf("repairWorktreeProvisioning(provisioningRootFor("));
    expect(call.length).toBeGreaterThan(0);
    expect(call.slice(0, call.indexOf(");") + 2)).not.toMatch(/authorization/);
  });
});

describe("#406 finding 2 — repointing hooksPath must prove the folder's own hook is a real gate", () => {
  const brokenGate = (tag, hookBody) => {
    const bed = makeHost(tag, { hookBody });
    const linked = makeBroken(bed, `linked-${tag}`, `lane/${tag}`);
    return { bed, linked, branch: `lane/${tag}` };
  };

  const attempt = ({ linked, branch }) =>
    repairWorktreeProvisioning(linked, {
      expectedBranch: branch,
      liveSessions: noOtherSessions,
      authorization: authFor(linked, branch),
    });

  it("refuses when .githooks exists but holds no pre-push — a non-empty directory is not a gate", () => {
    // The defect exactly: the old check asked `readdirSync(".githooks").length`, so a directory
    // holding one unrelated file passed, and the folder was repointed away from the escaping path
    // that may have held the only working hook.
    const bed = makeHost("nopush", { withHooks: false });
    const elsewhere = join(bed.bed, "elsewhere", ".githooks");
    mkdirSync(elsewhere, { recursive: true });
    writeFileSync(join(elsewhere, "pre-push"), GATE_HOOK);
    const linked = join(bed.bed, "linked-nopush");
    git(bed.host, "worktree", "add", "-q", "-b", "lane/nopush", linked);
    git(linked, "config", "--worktree", "core.hooksPath", elsewhere);
    mkdirSync(join(linked, ".githooks"), { recursive: true });
    writeFileSync(join(linked, ".githooks", "NOTES.md"), "not a hook\n");

    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/nopush",
      liveSessions: noOtherSessions,
      authorization: authFor(linked, "lane/nopush"),
    });

    expect(r.hooksPath.action).toBe("refused");
    expect(r.hooksPath.reason).toMatch(/pre-push/i);
    expect(resolve(linked, git(linked, "config", "core.hooksPath"))).toBe(elsewhere);
  }, 30_000);

  it("refuses a pre-push that exists but gates nothing — a forgotten `exit 0` stub", () => {
    const f = brokenGate("stub", "#!/bin/sh\nexit 0\n");
    const r = attempt(f);

    expect(r.hooksPath.action).toBe("refused");
    expect(r.hooksPath.reason).toMatch(/verify-local/i);
    expect(resolve(f.linked, git(f.linked, "config", "core.hooksPath"))).toBe(join(f.bed.host, ".githooks"));
  }, 30_000);

  it("refuses a pre-push that only NAMES the verifier, in a comment or an echo", () => {
    const commented = brokenGate("commented", "#!/bin/sh\nset -e\n# powershell -File verify-local.ps1\n");
    expect(attempt(commented).hooksPath.action).toBe("refused");

    const echoed = brokenGate("echoed", '#!/bin/sh\nset -e\necho "running verify-local.ps1"\n');
    expect(attempt(echoed).hooksPath.action).toBe("refused");
  }, 60_000);

  it("refuses a pre-push that runs the verifier but swallows its answer", () => {
    const swallowed = brokenGate(
      "swallowed",
      '#!/bin/sh\nset -e\npowershell.exe -File "$repo/scripts/verify-local.ps1" || :\n',
    );
    expect(attempt(swallowed).hooksPath.action).toBe("refused");

    const unarmed = brokenGate("unarmed", '#!/bin/sh\npowershell.exe -File "$repo/scripts/verify-local.ps1"\n');
    expect(attempt(unarmed).hooksPath.action).toBe("refused");
  }, 60_000);

  it("accepts a hook that arms `set -e` and actually runs the verifier", () => {
    const good = brokenGate("realgate", GATE_HOOK);
    const r = attempt(good);

    expect(r.hooksPath.action).toBe("set");
    expect(resolve(good.linked, git(good.linked, "config", "core.hooksPath"))).toBe(join(good.linked, ".githooks"));
  }, 30_000);

  it("agrees with scripts/lib/prepush-hook-contract.mjs — the hook may not import it, so it is pinned instead", () => {
    // `tracked-hooks.test.mjs` pins the hook to `node:` imports, so the check inside it is a second
    // implementation of a question this repository already answers in one place. Two implementations
    // drift; this is the pin that says when they have. The hook's copy is deliberately the NARROWER
    // one: everything below that it rejects, the canonical contract rejects too.
    expect(PREPUSH_VERIFIER).toBe(VERIFIER);

    const real = readFileSync(REAL_PREPUSH, "utf8");
    expect(prePushContractViolations(real)).toEqual([]);
    expect(prePushRunsVerifier(real)).toBe(true);

    const seeds = [
      "",
      "# nothing but a comment\n",
      "#!/bin/sh\nexit 0\n",
      "#!/bin/sh\nset -e\n# powershell -File verify-local.ps1\n",
      '#!/bin/sh\nset -e\necho "running verify-local.ps1"\n',
      "#!/bin/sh\nset -e\n: # verify-local.ps1\n",
      '#!/bin/sh\npowershell -File "verify-local.ps1"\n',
      '#!/bin/sh\nset -e\npowershell -File "verify-local.ps1" || true\n',
      '#!/bin/sh\nset -e\nexit 0\npowershell -File "verify-local.ps1"\n',
      '#!/bin/sh\nset -e\nset +e\npowershell -File "verify-local.ps1"\n',
      GATE_HOOK,
    ];
    for (const seed of seeds) {
      const canonical = prePushContractViolations(seed).length === 0;
      const inlined = prePushRunsVerifier(seed);
      // Narrower in the SAFE direction only: the hook may refuse a hook the contract accepts, but it
      // must never accept one the contract rejects.
      expect(!inlined || canonical, `disagreement on: ${JSON.stringify(seed)}`).toBe(true);
      expect(inlined).toBe(canonical);
    }
  });
});

describe("#406 finding 3 — Git's own pathname expansion decides whether a hooksPath escapes", () => {
  it("a `~/` hooksPath escapes the folder, and Node's resolve() cannot see that", () => {
    const bed = makeHost("tilde");
    const linked = makeBroken(bed, "linked-tilde", "lane/tilde", { escape: false });
    git(linked, "config", "--worktree", "core.hooksPath", "~/outside-gate");

    // The mechanism, measured rather than asserted. Git expands `~`; `resolve()` treats it as an
    // ordinary directory name and lands INSIDE the worktree, which is why the escape read as "ok".
    const raw = git(linked, "config", "--get", "core.hooksPath");
    expect(raw).toBe("~/outside-gate");
    expect(resolve(linked, raw).startsWith(linked)).toBe(true);
    const expanded = git(linked, "config", "--path", "--get", "core.hooksPath");
    expect(expanded.startsWith(linked)).toBe(false);
    expect(expanded).toMatch(/outside-gate$/);

    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/tilde",
      liveSessions: noOtherSessions,
      authorization: authFor(linked, "lane/tilde"),
    });

    expect(r.hooksPath.action).toBe("set");
    expect(r.hooksPath.from).toBe("~/outside-gate");
    expect(resolve(linked, git(linked, "config", "core.hooksPath"))).toBe(join(linked, ".githooks"));
  }, 30_000);

  it("still leaves an in-tree relative hooksPath exactly as it is", () => {
    // The mirror of the fix: reading through `--path` must not turn a correct folder into a rewrite.
    const bed = makeHost("intree");
    const linked = makeBroken(bed, "linked-intree", "lane/intree", { escape: false });

    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/intree",
      liveSessions: noOtherSessions,
      authorization: authFor(linked, "lane/intree"),
    });

    expect(r.hooksPath.action).toBe("ok");
    expect(git(linked, "config", "--get", "core.hooksPath")).toBe(".githooks");
  }, 30_000);
});

describe("#406 finding 4 — a failed index refresh is never reported as repaired", () => {
  it("surfaces the failed paths and the git error instead of claiming success", () => {
    const bed = makeHost("refresh");
    const linked = makeBroken(bed, "linked-refresh", "lane/refresh");
    const locked = "fatal: Unable to create '.git/index.lock': File exists.";

    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/refresh",
      liveSessions: noOtherSessions,
      authorization: authFor(linked, "lane/refresh"),
      run: (cwd, args) => (args[0] === "update-index" ? { ok: false, out: locked, status: 128 } : realRun(cwd, args)),
    });

    expect(r.lineEndings.action).toBe("failed");
    expect(r.lineEndings.refreshFailed).toContain("doc.md");
    expect(r.lineEndings.reason).toContain("index.lock");
    expect(r.action).toBe("failed");
    expect(r.line).toMatch(/refresh|index/i);

    // The bytes WERE rewritten — saying otherwise would be the mirror overclaim. What is false is
    // the postcondition: without the refresh the folder now reports phantom modifications, and the
    // report has to say so rather than leave the next reader to discover it.
    expect(r.lineEndings.repaired).toContain("doc.md");
    expect(crCount(readFileSync(join(linked, "doc.md")))).toBe(0);
    expect(git(linked, "status", "--porcelain")).not.toBe("");
  }, 30_000);

  it("a refresh that succeeds reports no failures, and the folder really is clean", () => {
    const bed = makeHost("refresh-ok");
    const linked = makeBroken(bed, "linked-refresh-ok", "lane/refresh-ok");

    const r = repairWorktreeProvisioning(linked, {
      expectedBranch: "lane/refresh-ok",
      liveSessions: noOtherSessions,
      authorization: authFor(linked, "lane/refresh-ok"),
    });

    expect(r.action).toBe("repaired");
    expect(r.lineEndings.action).toBe("repaired");
    expect(r.lineEndings.refreshFailed).toEqual([]);
    expect(git(linked, "status", "--porcelain")).toBe("");
  }, 30_000);
});
