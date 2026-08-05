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

import { audit, isNoop, listRemoteRefs, parseDispositions, refSetCoverage, resolveBase } from "./branch-disposition-audit.mjs";

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
/** A clone configured the way `actions/checkout@v4` leaves one: origin, but only one branch of it. */
let narrow;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "compy-branch-disposition-"));
  fixture = join(root, "repo");
  mkdirSync(fixture, { recursive: true });

  git(fixture, ["init", "-b", "main"]);
  git(fixture, ["config", "user.email", "t@t"]);
  git(fixture, ["config", "user.name", "t"]);
  // An origin that tracks every branch — the wildcard refspec is what `refSetCoverage` reads, and
  // without it this fixture would look like CI's single-branch clone and every assertion below
  // about ref existence would pass VACUOUSLY. Nothing ever fetches from this path; only the
  // refspec `git remote add` writes matters.
  git(fixture, ["remote", "add", "origin", join(root, "origin.git")]);
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

  // The CI shape, built exactly as `actions/checkout@v4` builds it: an origin whose refspec names
  // ONE branch. Its remote-tracking cache can never be a picture of the remote.
  narrow = join(root, "narrow");
  mkdirSync(narrow, { recursive: true });
  git(narrow, ["init", "-b", "main"]);
  git(narrow, ["remote", "add", "origin", join(root, "origin.git")]);
  git(narrow, ["config", "--replace-all", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/main"]);
});

afterAll(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    /* a locked file on Windows must not fail the suite */
  }
});

const run = (rows, extra = {}) => {
  const docPath = join(root, `record-${Math.abs(rows.length * 7 + rows.join("").length)}.md`);
  writeFileSync(docPath, doc(rows));
  return audit({ repoRoot: fixture, docPath, ...extra });
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

// The CI failure this block exists for: `actions/checkout@v4` clones single-branch, so
// refs/remotes/origin/* held one ref, and the audit read that near-empty cache as a fact about the
// remote. It printed 21 instructions to delete 21 true rows — one of them beta/private-beta-001,
// the frozen ref that is LOCKED against movement. The audit was wrong in the direction of
// destroying the record it exists to protect, which is the worst direction available to it.
//
// The rule it now follows: a degraded read produces SILENCE, never a claim. Same shape as the
// Trust Ledger fix one layer up, where an unreadable ledger used to say "your PC is untouched."
describe("what a checkout is entitled to say about origin", () => {
  const blind = { tracksEveryBranch: false, shallow: false, reason: "test" };
  const noHistory = { tracksEveryBranch: true, shallow: true, reason: "test" };

  it("knows a clone that tracks every branch from one that tracks a single branch", () => {
    expect(refSetCoverage(fixture)).toMatchObject({ tracksEveryBranch: true, shallow: false });
    expect(refSetCoverage(fixture).reason).toBe(null);

    const narrowCover = refSetCoverage(narrow);
    expect(narrowCover.tracksEveryBranch).toBe(false);
    expect(narrowCover.reason).toMatch(/does not track every origin branch/);
    // The reason quotes the actual refspec, so a red CI log says WHICH clone shape silenced it.
    expect(narrowCover.reason).toContain("refs/heads/main:refs/remotes/origin/main");
  });

  it("makes no absence claim in EITHER direction when the ref set is not authoritative", () => {
    // Rows naming refs this clone never fetched, and live refs with no row: on a full checkout
    // this is four failures. On a blind one it must be none — the 21-delete-instruction regression.
    const problems = run(
      [
        ["origin/beta/private-beta-001", "PRESERVE"],
        ["origin/some-lane-from-last-month", "MERGED"],
      ],
      { coverage: blind },
    );
    expect(problems).toEqual([]);
  });

  it("still reports what it can see without origin — the silence is scoped to origin claims", () => {
    const problems = run(
      [
        ["origin/landed", "MERGED"],
        ["origin/landed", "UNLANDED"],
        ["origin/ahead", "PROBABLY FINE"],
      ],
      { coverage: blind },
    );
    expect(problems.some((p) => /appears twice/.test(p))).toBe(true);
    expect(problems.some((p) => /PROBABLY FINE/.test(p))).toBe(true);
  });

  it("still fails an empty table without origin — a record with no rows is broken on any clone", () => {
    expect(run([], { coverage: blind })[0]).toMatch(/no disposition rows/);
  });

  // The two axes are independent, so they silence different halves.
  it("checks existence but not merge-tree when the refs are there and the history is not", () => {
    const problems = run([["origin/ahead", "MERGED"]], { coverage: noHistory });
    // origin/landed has no row: that is a ref-set fact, and the ref set is good here.
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("origin/landed");
    // origin/ahead is NOT merged, but re-proving that needs ancestry a depth-1 clone lacks.
    expect(problems.some((p) => /still changes the tree/.test(p))).toBe(false);
  });
});

describe("this repository", () => {
  it("has a true branch-disposition record right now", () => {
    expect(audit({ repoRoot })).toEqual([]);
  });

  // The live shape of the CI failure. Whatever the record says today, a checkout that cannot see
  // origin must not tell anyone to delete a row of it.
  it("is never told to delete a row by a checkout that cannot see origin", () => {
    const problems = audit({ repoRoot, coverage: { tracksEveryBranch: false, shallow: false, reason: "test" } });
    expect(problems.filter((p) => /no longer exists/.test(p))).toEqual([]);
    expect(problems).toEqual([]);
  });
});
