// Guard: a transition receipt is added once and never edited or deleted (#307).
//
// 2026-09-26. `docs/WORK_CONTROL.md` says receipts "are only ever added under per-transition names",
// and #538's lease carve-out rests on that. Nothing enforced it. The first cut of the #307 fix
// (PR #580 at 829a9f2a) rewrote `independentReview.reviewer` inside the #290 receipt that `main`
// already held. Every existing gate let it through:
// - `work-control-receipt-preservation.test.mjs` accepts a blob committed on any ref;
// - the work-control gate validates only the receipt a transition submits;
// - the release-receipt guard reads `docs/release-receipts`, not this directory.
// Codex's review of that head found it. A proof record that can be rewritten after the fact proves
// only what its last editor wanted it to say.
//
// THE RULE. Every `.claude/work-control/*.json` held by the merge-base of HEAD and `origin/main`
// must still be in HEAD, the index and the working tree, byte for byte. A wrong receipt is corrected
// by ADDING a dated `<date>-correct-<receipt>.json`; `work-control-receipt-reviewer-claims.test.mjs`
// defines its shape.
//
// WHY THE MERGE-BASE AND NOT `origin/main`. A receipt that `main` added after this lane branched is
// not this lane's to hold yet. Comparing against `origin/main` itself would redden every lane that
// is behind, which is most of them, most of the time. Edits that `main`'s history already holds are
// part of the base and are not re-litigated: #178's receipt was deleted on 2026-08-20, and the #220
// and #277 receipts were edited in place between 2026-08-25 and 2026-09-01.
//
// THREE LAYERS, EACH ON ITS OWN. The first cut compared the base with the working tree in one
// `git diff <base>`. That is only the net result: a rewrite committed or staged, with the
// working-tree copy put back to the base bytes, reads as no change there, and the push then carries
// the rewrite in HEAD. Codex's review of 198cc2b6 found it. So base to HEAD, base to the index and
// the index to the working tree are three separate diffs; any one of them names the receipt. The
// last one only counts receipts the base holds, since a receipt this lane adds is its own to edit
// until it lands. Git applies its own line-ending rules to each diff. `--no-renames` makes a rename
// read as a deletion plus an addition. An unresolvable `origin/main`, or one with no common ancestor
// in shallow history, throws, which fails the test rather than counting as zero findings.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// A hook runs with the repository's own git locations set; a fixture must never inherit them.
const { GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE, ...gitEnv } = process.env;
const gitIn = (cwd) => (args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, env: { ...gitEnv, GIT_OPTIONAL_LOCKS: "0" } });

const DIR = ".claude/work-control/";
const RECEIPT = /^\.claude\/work-control\/[^/]+\.json$/i;

// Each receipt that a `git diff --name-status` listing shows as anything but added.
export function rewrittenReceipts(listing) {
  return String(listing)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(([status, path]) => status !== "A" && RECEIPT.test(path ?? ""))
    .map(([status, path]) => `${status} ${path}`);
}

// Each receipt `base` holds that HEAD, the index or the working tree no longer carries byte for
// byte, prefixed with the layer it diverges in. `git` runs one git command in the repository.
export function receiptRewrites(git, base) {
  const held = new Set(git(["ls-tree", "-r", "--name-only", base, "--", DIR]).split(/\r?\n/).filter((path) => RECEIPT.test(path)));
  const layer = (name, range) =>
    rewrittenReceipts(git(["diff", "--no-renames", "--name-status", ...range, "--", DIR]))
      .filter((entry) => held.has(entry.slice(entry.indexOf(" ") + 1)))
      .map((entry) => `${name}: ${entry}`);
  return [...layer("HEAD", [base, "HEAD"]), ...layer("index", ["--cached", base]), ...layer("working tree", [])];
}

describe("a transition receipt is added once and never edited or deleted (#307)", () => {
  it("reads a listing: an added receipt passes; an edit, a deletion or a type change fails", () => {
    const listing = [
      "A\t.claude/work-control/2026-09-26-correct-merge-pr-290.json",
      "M\t.claude/work-control/2026-09-01-merge-pr-290.json",
      "D\t.claude/work-control/2026-08-20-merge-pr-159.json",
      "T\t.claude/work-control/2026-08-21-close-issue-160.json",
      "M\t.claude/work-control/README.md",
      "M\t.claude/work-control/nested/x.json",
      "M\tscripts/fixture.json",
      "",
    ].join("\n");
    expect(rewrittenReceipts(listing)).toEqual([
      "M .claude/work-control/2026-09-01-merge-pr-290.json",
      "D .claude/work-control/2026-08-20-merge-pr-159.json",
      "T .claude/work-control/2026-08-21-close-issue-160.json",
    ]);
  });

  it("every receipt the merge-base with origin/main holds is still in HEAD, the index and the working tree", () => {
    const git = gitIn(process.cwd());
    const base = git(["merge-base", "HEAD", "origin/main"]).trim();
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    expect(
      receiptRewrites(git, base),
      "a receipt is never edited or deleted; correct it by adding a dated <date>-correct-<receipt>.json",
    ).toEqual([]);
  });
});

// A throwaway repository whose first commit is the base. Every case starts back at that commit.
describe("each layer is checked on its own, so restoring the working tree hides nothing (#307)", () => {
  const HELD = ".claude/work-control/2026-01-01-merge-pr-1.json";
  const BASE_BYTES = '{ "transition": "merge-pr", "pr": 1 }\n';
  const EDITED_BYTES = '{ "transition": "merge-pr", "pr": 1, "note": "rewritten" }\n';
  let root;
  let git;
  let base;
  const write = (path, bytes) => {
    mkdirSync(join(root, DIR), { recursive: true });
    writeFileSync(join(root, path), bytes);
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "compy-receipt-append-only-"));
    git = gitIn(root);
    git(["init", "-q", "-b", "main"]);
    git(["config", "user.email", "t@t"]);
    git(["config", "user.name", "t"]);
    git(["config", "core.autocrlf", "false"]);
    write(HELD, BASE_BYTES);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "base"]);
    base = git(["rev-parse", "HEAD"]).trim();
  });

  beforeEach(() => {
    git(["reset", "-q", "--hard", base]);
    git(["clean", "-q", "-fd"]);
  });

  afterAll(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      /* a locked file on Windows must not fail the suite */
    }
  });

  it("passes an untouched base receipt beside a new receipt this lane adds, commits and then edits", () => {
    const added = ".claude/work-control/2026-01-02-merge-pr-2.json";
    write(added, BASE_BYTES);
    git(["add", "-A"]);
    git(["commit", "-q", "-m", "add a receipt"]);
    write(added, EDITED_BYTES);
    expect(receiptRewrites(git, base)).toEqual([]);
  });

  it("fails a committed rewrite whose index and working tree were put back to the base bytes", () => {
    write(HELD, EDITED_BYTES);
    git(["commit", "-q", "-am", "rewrite"]);
    git(["checkout", "-q", base, "--", HELD]);
    expect(receiptRewrites(git, base)).toEqual([`HEAD: M ${HELD}`]);
  });

  it("fails a staged rewrite whose working tree was put back to the base bytes", () => {
    write(HELD, EDITED_BYTES);
    git(["add", HELD]);
    write(HELD, BASE_BYTES);
    expect(receiptRewrites(git, base)).toEqual([`index: M ${HELD}`, `working tree: M ${HELD}`]);
  });

  it("fails an unstaged edit", () => {
    write(HELD, EDITED_BYTES);
    expect(receiptRewrites(git, base)).toEqual([`working tree: M ${HELD}`]);
  });

  it("fails a committed deletion even with the base bytes left behind as an untracked file", () => {
    git(["rm", "-q", HELD]);
    git(["commit", "-q", "-m", "delete"]);
    write(HELD, BASE_BYTES);
    expect(receiptRewrites(git, base)).toEqual([`HEAD: D ${HELD}`, `index: D ${HELD}`]);
  });

  it("fails a committed rename as a deletion", () => {
    git(["mv", HELD, ".claude/work-control/2026-01-01-merge-pr-1-renamed.json"]);
    git(["commit", "-q", "-m", "rename"]);
    expect(receiptRewrites(git, base)).toEqual([`HEAD: D ${HELD}`, `index: D ${HELD}`]);
  });
});
