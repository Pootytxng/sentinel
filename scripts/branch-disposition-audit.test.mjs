// Guard: docs/BRANCH_DISPOSITIONS.md must describe the refs that actually exist, and its MERGED
// rows must still be true.
//
// Why this exists — docs/BACKLOG.md asserted "every branch has a verified disposition" when no
// branch had ever been verified. It was false the day it was written, survived weeks of reading,
// and was only caught by hand. The lesson was not "check branches more carefully"; it was that a
// state claim with no checker rots silently. So the record gets a checker, and the checker re-runs
// the merge-tree proof rather than trusting the sentence next to it.
//
// The final block runs the audit against THIS repository. That is the live guard — the fixture
// cases below only prove the audit can fail, which is the part a green suite would otherwise hide.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { audit, isNoop, listRemoteRefs, parseDispositions, resolveBase } from "./branch-disposition-audit.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const git = (dir, args) =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** A record with the given rows, in the real document's shape. */
const doc = (rows) =>
  [
    "# fixture",
    "",
    "## How a disposition is proven",
    "",
    "| disposition | meaning | action |",
    "| --- | --- | --- |",
    "| `MERGED` | prose about the vocabulary, not a ref row | prunable |",
    "",
    "## The refs",
    "",
    "| ref | disposition | evidence |",
    "| --- | --- | --- |",
    ...rows.map(([ref, disposition, evidence = "because"]) => `| \`${ref}\` | ${disposition} | ${evidence} |`),
    "",
    "## Standing rule",
    "",
    "unrelated tail",
    "",
  ].join("\n");

let root;
let fixture;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "compy-branch-disposition-"));
  fixture = join(root, "repo");
  mkdirSync(fixture, { recursive: true });

  git(fixture, ["init", "-b", "main"]);
  git(fixture, ["config", "user.email", "t@t"]);
  git(fixture, ["config", "user.name", "t"]);
  writeFileSync(join(fixture, "a.txt"), "a\n");
  git(fixture, ["add", "-A"]);
  git(fixture, ["commit", "-m", "seed"]);
  const head = git(fixture, ["rev-parse", "HEAD"]);

  // A ref that is already in main: merging it changes nothing.
  git(fixture, ["update-ref", "refs/remotes/origin/landed", head]);

  // A ref carrying a commit main does not have.
  git(fixture, ["checkout", "-q", "-b", "side"]);
  writeFileSync(join(fixture, "b.txt"), "b\n");
  git(fixture, ["add", "-A"]);
  git(fixture, ["commit", "-m", "side work"]);
  git(fixture, ["update-ref", "refs/remotes/origin/ahead", git(fixture, ["rev-parse", "HEAD"])]);
  git(fixture, ["checkout", "-q", "main"]);
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

const run = (rows) => {
  const docPath = join(root, `record-${Math.abs(rows.length * 7 + rows.join("").length)}.md`);
  writeFileSync(docPath, doc(rows));
  return audit({ repoRoot: fixture, docPath });
};

describe("parsing", () => {
  it("reads only the ref table, not the vocabulary table above it", () => {
    const rows = parseDispositions(doc([["origin/landed", "MERGED"]]));
    expect(rows).toEqual([{ ref: "origin/landed", disposition: "MERGED", evidence: "because" }]);
  });

  it("keeps evidence text that itself contains a pipe", () => {
    const rows = parseDispositions(doc([["origin/landed", "MERGED", "`a | b` held"]]));
    expect(rows[0].evidence).toBe("`a | b` held");
  });

  it("returns nothing when the section is absent, rather than guessing", () => {
    expect(parseDispositions("# doc\n\nno table here\n")).toEqual([]);
  });
});

describe("git facts the audit rests on", () => {
  // origin/HEAD and the trunk itself are not dispositionable branches; demanding rows for them
  // would make the record permanently red for no reason.
  it("lists origin refs and excludes origin/HEAD and the trunk", () => {
    git(fixture, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/landed"]);
    git(fixture, ["update-ref", "refs/remotes/origin/main", git(fixture, ["rev-parse", "main"])]);

    expect(listRemoteRefs(fixture).sort()).toEqual(["origin/ahead", "origin/landed"]);

    git(fixture, ["symbolic-ref", "-d", "refs/remotes/origin/HEAD"]);
    git(fixture, ["update-ref", "-d", "refs/remotes/origin/main"]);
  });

  it("resolves main as the base", () => {
    expect(resolveBase(fixture)).toBe("main");
  });

  it("calls an already-merged ref a no-op and a diverged one not", () => {
    expect(isNoop(fixture, "main", "origin/landed")).toBe(true);
    expect(isNoop(fixture, "main", "origin/ahead")).toBe(false);
  });
});

describe("what the audit refuses to pass", () => {
  it("passes when every ref has an accurate row", () => {
    expect(run([["origin/landed", "MERGED"], ["origin/ahead", "UNLANDED"]])).toEqual([]);
  });

  it("fails when a live ref has no row — the original defect", () => {
    const problems = run([["origin/landed", "MERGED"]]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("origin/ahead");
    expect(problems[0]).toMatch(/no row/);
  });

  it("fails when a row names a ref that is gone", () => {
    const problems = run([
      ["origin/landed", "MERGED"],
      ["origin/ahead", "UNLANDED"],
      ["origin/deleted-last-week", "MERGED"],
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("origin/deleted-last-week");
  });

  // The rot case: the row was true once. The audit re-proves it instead of believing it.
  it("fails when a MERGED row is no longer a no-op", () => {
    const problems = run([["origin/landed", "MERGED"], ["origin/ahead", "MERGED"]]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/origin\/ahead is recorded MERGED but merging it into main still changes/);
  });

  it("fails when an UNLANDED row has quietly landed", () => {
    const problems = run([["origin/landed", "UNLANDED"], ["origin/ahead", "UNLANDED"]]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/origin\/landed is recorded UNLANDED but merging it into main is a no-op/);
  });

  it("fails on a disposition word that is not in the vocabulary", () => {
    const problems = run([["origin/landed", "MERGED"], ["origin/ahead", "PROBABLY FINE"]]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("PROBABLY FINE");
  });

  it("fails on a duplicated ref, so two rows cannot disagree", () => {
    const problems = run([
      ["origin/landed", "MERGED"],
      ["origin/ahead", "UNLANDED"],
      ["origin/ahead", "MERGED"],
    ]);
    expect(problems.some((p) => /appears twice/.test(p))).toBe(true);
  });

  // PRESERVE and CLAIMED make no merge-tree claim, so neither shape may be flagged. beta/private-beta-001
  // is genuinely an ancestor of main and must not be nagged into MERGED — that row is what stops it
  // being pruned.
  it("makes no merge-tree demand of PRESERVE or CLAIMED rows", () => {
    expect(run([["origin/landed", "PRESERVE"], ["origin/ahead", "CLAIMED"]])).toEqual([]);
    expect(run([["origin/landed", "CLAIMED"], ["origin/ahead", "PRESERVE"]])).toEqual([]);
  });
});

describe("this repository", () => {
  it("has a true branch-disposition record right now", () => {
    expect(audit({ repoRoot })).toEqual([]);
  });
});
