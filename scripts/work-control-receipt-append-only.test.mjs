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
// keeps its bytes in every commit after that base, and is still in HEAD, the index and the working
// tree, byte for byte. A wrong receipt is corrected
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
//
// EVERY COMMIT, NOT ONLY THE ENDPOINTS. Codex's review of 9ec38223 found that a rewrite committed and
// then put back by a later commit leaves all three endpoints clean, while the history a merge carries
// still holds the rewrite. So every commit between the base and HEAD is read too, including both
// sides of every merge. A commit is named when it leaves a base receipt with other bytes, another
// mode, or none; the commit that puts the bytes back is not.
// At 4ad7f244 each merge was read against its first parent only. Codex's review of that head found
// the gap. A lane that forked before `main` changed a receipt can merge the base as its second
// parent and keep its own older bytes. That merge matches its first parent, so it showed no change.
// Each merge is now read against every parent (`--diff-merges=separate`), and one finding is kept
// per commit and path. So any commit after the base that departs from the base bytes is named: on
// any path of parents back to the base, the first commit that departs differs from the parent
// before it. That flag also stops git pruning a side branch, and `--full-history` makes that
// explicit rather than leaning on the flag.
// This lane's own first cut is that shape: 829a9f2a rewrote the #290 receipt and 28deb2fe put it back.
// Rewriting the pushed PR branch to drop it is a force-push, which is the owner's call, and the dated
// correction receipt already records it, so the live check excuses that one commit and path, exactly.
// Once it lands, 829a9f2a sits under every lane's base and the excuse matches nothing.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// A hook runs with the repository's own git locations set, and a fixture must never inherit them.
// Codex's review of 9ec38223 found that clearing only GIT_DIR, GIT_INDEX_FILE and GIT_WORK_TREE left
// GIT_COMMON_DIR, GIT_OBJECT_DIRECTORY and the rest, so every variable git itself lists as local to
// a repository is cleared.
const LOCAL_ENV_VARS = execFileSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8", windowsHide: true })
  .split(/\r?\n/)
  .filter(Boolean);

export function withoutRepositoryEnv(env) {
  const local = new Set(LOCAL_ENV_VARS);
  return Object.fromEntries(Object.entries(env).filter(([key]) => !local.has(key.toUpperCase())));
}

const gitIn = (cwd) => (args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true, env: { ...withoutRepositoryEnv(process.env), GIT_OPTIONAL_LOCKS: "0" } });

const DIR = ".claude/work-control/";
const RECEIPT = /^\.claude\/work-control\/[^/]+\.json$/i;
const EXCUSED = new Set(["commit 829a9f2aeb04d38fa60edeb62dfa289afc741b63: M .claude/work-control/2026-09-01-merge-pr-290.json"]);

// Each receipt that a `git diff --name-status` listing shows as anything but added.
export function rewrittenReceipts(listing) {
  return String(listing)
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split("\t"))
    .filter(([status, path]) => status !== "A" && RECEIPT.test(path ?? ""))
    .map(([status, path]) => `${status} ${path}`);
}

// Each receipt `base` holds that a commit after it, HEAD, the index or the working tree no longer
// carries byte for byte, prefixed with where it diverges. `git` runs one git command in the repository.
export function receiptRewrites(git, base) {
  const held = new Map();
  for (const line of git(["ls-tree", "-r", base, "--", DIR]).split(/\r?\n/)) {
    const entry = /^(\d{6}) blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (entry && RECEIPT.test(entry[3])) held.set(entry[3], `${entry[1]} ${entry[2]}`);
  }
  const commits = new Set();
  let commit = "";
  const history = ["log", "--full-history", "--diff-merges=separate", "--no-renames", "--raw", "--no-abbrev", "--reverse", "--format=commit %H"];
  for (const line of git([...history, `${base}..HEAD`, "--", DIR]).split(/\r?\n/)) {
    if (line.startsWith("commit ")) commit = line.slice("commit ".length);
    const change = /^:\d{6} (\d{6}) [0-9a-f]+ ([0-9a-f]+) ([A-Z])\d*\t(.+)$/.exec(line);
    if (change && held.has(change[4]) && held.get(change[4]) !== `${change[1]} ${change[2]}`) {
      commits.add(`commit ${commit}: ${change[3]} ${change[4]}`);
    }
  }
  const layer = (name, range) =>
    rewrittenReceipts(git(["diff", "--no-renames", "--name-status", ...range, "--", DIR]))
      .filter((entry) => held.has(entry.slice(entry.indexOf(" ") + 1)))
      .map((entry) => `${name}: ${entry}`);
  return [...commits, ...layer("HEAD", [base, "HEAD"]), ...layer("index", ["--cached", base]), ...layer("working tree", [])];
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

  it("every receipt the merge-base with origin/main holds keeps its bytes in every commit since, HEAD, the index and the working tree", () => {
    const git = gitIn(process.cwd());
    const base = git(["merge-base", "HEAD", "origin/main"]).trim();
    expect(base).toMatch(/^[0-9a-f]{40}$/);
    expect(
      receiptRewrites(git, base).filter((finding) => !EXCUSED.has(finding)),
      "a receipt is never edited or deleted; correct it by adding a dated <date>-correct-<receipt>.json",
    ).toEqual([]);
  });

  it("gives git none of the repository-local variables a hook may export", () => {
    expect(LOCAL_ENV_VARS).toEqual(
      expect.arrayContaining(["GIT_DIR", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_INDEX_FILE", "GIT_WORK_TREE"]),
    );
    const env = Object.fromEntries([...LOCAL_ENV_VARS.map((key) => [key, "x"]), ["Git_Common_Dir", "x"], ["PATH", "p"]]);
    expect(withoutRepositoryEnv(env)).toEqual({ PATH: "p" });
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
    git(["checkout", "-q", "-f", "main"]);
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

  const commit = (message) => {
    git(["commit", "-q", "-am", message]);
    return git(["rev-parse", "HEAD"]).trim();
  };

  it("fails a committed rewrite whose index and working tree were put back to the base bytes", () => {
    write(HELD, EDITED_BYTES);
    const rewrite = commit("rewrite");
    git(["checkout", "-q", base, "--", HELD]);
    expect(receiptRewrites(git, base)).toEqual([`commit ${rewrite}: M ${HELD}`, `HEAD: M ${HELD}`]);
  });

  it("fails a rewrite that a later commit put back", () => {
    write(HELD, EDITED_BYTES);
    const rewrite = commit("rewrite");
    write(HELD, BASE_BYTES);
    commit("put it back");
    expect(receiptRewrites(git, base)).toEqual([`commit ${rewrite}: M ${HELD}`]);
  });

  it("fails a rewrite made and put back on a side branch that a merge brings in", () => {
    git(["checkout", "-q", "-B", "side", base]);
    write(HELD, EDITED_BYTES);
    const rewrite = commit("rewrite on a side branch");
    write(HELD, BASE_BYTES);
    commit("put it back");
    git(["checkout", "-q", "main"]);
    // Work outside the receipts on this side too: a merge that matches such a parent there is what
    // git's default history simplification follows alone, dropping the side branch unread.
    writeFileSync(join(root, "notes.txt"), "work\n");
    git(["add", "notes.txt"]);
    commit("other work");
    git(["merge", "-q", "--no-ff", "-m", "merge the side branch", "side"]);
    expect(receiptRewrites(git, base)).toEqual([`commit ${rewrite}: M ${HELD}`]);
  });

  it("fails a rewrite slipped into a merge commit and put back after it", () => {
    git(["checkout", "-q", "-B", "side", base]);
    writeFileSync(join(root, "notes.txt"), "side\n");
    git(["add", "notes.txt"]);
    commit("side work");
    git(["checkout", "-q", "main"]);
    git(["merge", "-q", "--no-ff", "--no-commit", "side"]);
    write(HELD, EDITED_BYTES);
    git(["add", HELD]);
    const merge = commit("merge the side branch, with a rewrite");
    write(HELD, BASE_BYTES);
    commit("put it back");
    expect(receiptRewrites(git, base)).toEqual([`commit ${merge}: M ${HELD}`]);
  });

  it("fails a merge that brings in the base as its second parent but keeps older bytes from before it", () => {
    // main changes the receipt before the base, as main's own pre-guard history did; the lane forked
    // before that change.
    write(HELD, EDITED_BYTES);
    const before = commit("older bytes, before the base");
    write(HELD, BASE_BYTES);
    const newer = commit("the base bytes");
    git(["checkout", "-q", "-B", "lane", before]);
    git(["merge", "-q", "--no-ff", "--no-commit", "main"]);
    git(["checkout", "-q", "HEAD", "--", HELD]);
    const merge = commit("merge the base, keeping the older bytes");
    write(HELD, BASE_BYTES);
    commit("put it back");
    expect(git(["merge-base", "HEAD", "main"]).trim()).toBe(newer);
    expect(receiptRewrites(git, newer)).toEqual([`commit ${merge}: M ${HELD}`]);
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
    const deletion = commit("delete");
    write(HELD, BASE_BYTES);
    expect(receiptRewrites(git, base)).toEqual([`commit ${deletion}: D ${HELD}`, `HEAD: D ${HELD}`, `index: D ${HELD}`]);
  });

  it("fails a committed rename as a deletion", () => {
    git(["mv", HELD, ".claude/work-control/2026-01-01-merge-pr-1-renamed.json"]);
    const rename = commit("rename");
    expect(receiptRewrites(git, base)).toEqual([`commit ${rename}: D ${HELD}`, `HEAD: D ${HELD}`, `index: D ${HELD}`]);
  });
});
