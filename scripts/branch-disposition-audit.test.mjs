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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  audit,
  falseMergeCitations,
  isNoop,
  listRemoteRefs,
  mergeCitations,
  parseDispositions,
  pruneCommand,
  refSplit,
  refSetCoverage,
  resolveBase,
  squashOnlyCitations,
  uncitedLandings,
  NON_CITATION_LANDINGS,
} from "./branch-disposition-audit.mjs";

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

  it("counts the split the doc used to pin by hand", () => {
    // #309/#312. docs/BRANCH_DISPOSITIONS.md carried `Twenty-five non-PRESERVE refs remain` in prose,
    // and it was wrong twice on 2026-09-01 alone -- both times written stale by the very lane that
    // added the row it failed to count. A number beside an append-only table is wrong by the next
    // commit, so the audit computes it and the doc points at the audit.
    const rows = parseDispositions(
      doc([
        ["origin/keep", "PRESERVE"],
        ["origin/also-keep", "PRESERVE"],
        ["origin/live", "CLAIMED"],
      ]),
    );
    expect(refSplit(rows)).toEqual({ total: 3, preserve: 2, other: 1 });
    // Empty is a real answer, not a crash: a fresh repo with one branch has no rows to count.
    expect(refSplit([])).toEqual({ total: 0, preserve: 0, other: 0 });
    // Only an exact PRESERVE counts. A row that merely mentions the word in its evidence does not,
    // which is the shape that would quietly inflate the protected count as the table grows.
    expect(refSplit([{ ref: "origin/x", disposition: "CLAIMED", evidence: "never PRESERVE this" }]))
      .toEqual({ total: 1, preserve: 0, other: 1 });
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

  it("falls back to local main when origin/main has not been fetched", () => {
    expect(resolveBase(fixture)).toBe("main");
  });

  // The regression. A disposition is a claim about the SHARED trunk, and a local `main` pointer is
  // a private bookmark nobody is obliged to move. When this preferred local `main`, a worktree
  // whose `main` sat a week behind origin reported a genuinely merged branch as "still changes the
  // tree" — confident, specific, and wrong, because the tree it changed was the stale one.
  it("prefers origin/main over a local main that has fallen behind", () => {
    git(fixture, ["update-ref", "refs/remotes/origin/main", git(fixture, ["rev-parse", "origin/ahead"])]);
    try {
      expect(resolveBase(fixture)).toBe("origin/main");
      // And it is a DIFFERENT answer, not the same commit wearing another name — otherwise this
      // passes whether or not the preference works.
      expect(git(fixture, ["rev-parse", "origin/main"])).not.toBe(git(fixture, ["rev-parse", "main"]));
      expect(isNoop(fixture, "origin/main", "origin/ahead")).toBe(true);
      expect(isNoop(fixture, "main", "origin/ahead")).toBe(false);
    } finally {
      git(fixture, ["update-ref", "-d", "refs/remotes/origin/main"]);
    }
  });

  it("calls an already-merged ref a no-op and a diverged one not", () => {
    expect(isNoop(fixture, "main", "origin/landed")).toBe(true);
    expect(isNoop(fixture, "main", "origin/ahead")).toBe(false);
  });
});

describe("what the audit refuses to pass", () => {
  it("passes when every ref has an accurate row", () => {
    expect(run([["origin/landed", "PRESERVE"], ["origin/ahead", "UNLANDED"]])).toEqual([]);
  });

  it("fails when a live ref has no row — the original defect", () => {
    const problems = run([["origin/landed", "PRESERVE"]]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("origin/ahead");
    expect(problems[0]).toMatch(/no row/);
  });

  // A stale ref and an undispositioned one are the same bytes in refs/remotes/origin, so this
  // message is read by lanes that did nothing wrong. It has to send them to the local, reversible
  // cure BEFORE it names a command that deletes a branch on the shared remote.
  it("sends an unrowed ref to `fetch --prune` before it names a destructive command", () => {
    const [problem] = run([["origin/landed", "PRESERVE"]]);
    expect(problem).toMatch(/git fetch origin --prune/);
    expect(problem.indexOf("git fetch origin --prune")).toBeLessThan(problem.indexOf("--delete"));
  });

  // It also may not assert that the ref is live on origin: a cache is the only thing it read.
  it("does not claim an unrowed ref exists on origin", () => {
    expect(run([["origin/landed", "PRESERVE"]])[0]).not.toMatch(/exists on origin/);
  });

  it("fails when a row names a ref that is gone", () => {
    const problems = run([
      ["origin/landed", "PRESERVE"],
      ["origin/ahead", "UNLANDED"],
      ["origin/deleted-last-week", "MERGED"],
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("origin/deleted-last-week");
  });

  // The rot case: the row was true once. The audit re-proves it instead of believing it.
  it("fails when a MERGED row is no longer a no-op", () => {
    const problems = run([["origin/landed", "PRESERVE"], ["origin/ahead", "MERGED"]]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/origin\/ahead is recorded MERGED but merging it into main still changes/);
    // ...and it must say what to DO. On 2026-08-06 this exact failure fired against a row written
    // twenty minutes earlier: the lane rebase-merged (a no-op at that instant), then the very next
    // commit edited the row from CLAIMED to MERGED — a line the branch itself had added, so the
    // three-way merge became a conflict and the proof could never be produced again. Re-proving is
    // not the fix there; pruning is. A diagnosis without a remedy sends the next reader looking for
    // a merge that cannot exist.
    expect(problems[0]).toMatch(/prune the ref and drop the row/);
  });

  it("fails when an UNLANDED row has quietly landed", () => {
    const problems = run([["origin/landed", "UNLANDED"], ["origin/ahead", "UNLANDED"]]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/origin\/landed is recorded UNLANDED but merging it into main is a no-op/);
  });

  it("fails on a disposition word that is not in the vocabulary", () => {
    const problems = run([["origin/landed", "PRESERVE"], ["origin/ahead", "PROBABLY FINE"]]);
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
  // The two-day row. `origin/perf/idle-127-ambient-raster` was recorded MERGED on 2026-08-18, its
  // ref was left standing, and this audit stayed green for two days — nothing asked whether a row
  // that means "prunable" had actually been pruned. The row explained itself in the record: the
  // prune had been attempted as `gh api -X DELETE` and refused, so it read as a task for the owner.
  // Two harms, one check: the record drifts from origin, and the MERGED proof rots the next time
  // `main` moves (see the perishability case above), after which it can never be re-produced.
  it("fails while a prunable row's ref is still on origin, and names the command that removes it", () => {
    const problems = run([["origin/landed", "MERGED"], ["origin/ahead", "UNLANDED"]]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("origin/landed is recorded MERGED, which means prunable");
    expect(problems[0]).toContain("git push origin --delete landed");
  });

  it("says the same of SUPERSEDED, the other word that means prunable", () => {
    const problems = run([["origin/landed", "PRESERVE"], ["origin/ahead", "SUPERSEDED"]]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("git push origin --delete ahead");
  });

  it("makes no merge-tree demand of PRESERVE or CLAIMED rows", () => {
    expect(run([["origin/landed", "PRESERVE"], ["origin/ahead", "CLAIMED"]])).toEqual([]);
    expect(run([["origin/landed", "CLAIMED"], ["origin/ahead", "PRESERVE"]])).toEqual([]);
  });
});

// What this block pins is not a wrong answer — it is a right answer nobody could act on. Sessions
// reached for `gh api -X DELETE .../git/refs/heads/<branch>`, this machine's permission layer denied
// it, and the denial was read as "the ref cannot be pruned": once written into the record as the
// reason a row had to stay, and once carried to the owner as if it were his to do. `git push origin
// --delete` was never blocked. Naming it in the failure itself is the fix; this keeps it there.
describe("every request for a ref to go carries the command that works", () => {
  it("builds the command from the ref, with the remote prefix stripped", () => {
    expect(pruneCommand("origin/lane/foo")).toBe("git push origin --delete lane/foo");
    // Tolerant of a bare name, so a caller that already stripped it does not produce `--delete`
    // against a branch called "origin/origin/...".
    expect(pruneCommand("lane/foo")).toBe("git push origin --delete lane/foo");
  });

  it("names it in every failure that asks for a deletion, and never names `gh api`", () => {
    const asksForDeletion = [
      run([["origin/landed", "PRESERVE"]]), // a live ref with no row at all
      run([["origin/landed", "MERGED"], ["origin/ahead", "UNLANDED"]]), // prunable, still standing
      run([["origin/landed", "PRESERVE"], ["origin/ahead", "MERGED"]]), // a MERGED proof gone stale
    ].flat();
    expect(asksForDeletion).toHaveLength(3);
    for (const problem of asksForDeletion) {
      expect(problem).toContain("git push origin --delete");
      expect(problem).not.toMatch(/gh api/);
    }
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

// Where the dead end actually came from. docs/RELEASE_AUTONOMY.md — the policy that authorises a
// lane to merge its own PR — said in the same breath "never with `--delete-branch` ... prune the ref
// with" the `gh` REST deletion, which this machine's permission layer denies. A session following
// the policy exactly hit the wall every time, and one of them wrote the wall into the record as the
// reason a merged ref had to stay standing. Fixing this audit's messages while the policy still
// prescribed the blocked command would have moved the contradiction rather than closed it.
//
// docs/archive/** is exempt: those are point-in-time records of what was true when written, and
// editing them to match today is falsifying them. A live doc with a real reason to name the call can
// carry a greppable `blocked-prune-allow` on the line — the same escape hatch the mutation-boundary
// and outbound guards use. No live doc needs one today.
describe("the live docs do not prescribe the blocked prune", () => {
  it("nowhere recommends the gh REST deletion for pruning a ref", () => {
    const tracked = git(repoRoot, ["ls-files", "*.md"])
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("docs/archive/"));
    // Self-test: a pathspec that silently matched nothing would pass this without reading anything.
    expect(tracked.length).toBeGreaterThan(20);

    // No \s or \b in the pattern: it is meant to read as the prose it bans — "gh api ... DELETE",
    // on one line, in any of the argument orders the CLI accepts.
    const prescribes = /gh[ ]+api[^`]*DELETE/;
    const offenders = [];
    for (const rel of tracked) {
      readFileSync(join(repoRoot, rel), "utf8")
        .split("\n")
        .forEach((line, i) => {
          if (!line.includes("blocked-prune-allow") && prescribes.test(line)) {
            offenders.push(`${rel}:${i + 1}`);
          }
        });
    }
    expect(offenders).toEqual([]);
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

describe("PR-to-merge-commit citations", () => {
  // Why: a row in the real document cited `20ef848d` as PR #314's merge commit. It is PR #334's --
  // and the row two below it said so correctly, so the file contradicted itself while every guard
  // stayed green. Two independent reviewers caught it by hand; nothing mechanical could have.
  const subjects = {
    "7dafc402": "Merge pull request #314 from Pootytxng/lane/rule-c-at-risk-312",
    "20ef848d": "Merge pull request #334 from Pootytxng/fix/green-main-after-314-332",
    ee5bdd8b: "Merge pull request #277 from Pootytxng/lane/fleet-guard-failclosed-276",
    e26108f7: "docs(routing): reconcile native closeout \u2014 Stage 3 is the receiver (#273)",
    "952ce309": "fix(guard): rule D accepts a landing marker, so C and D stop contradicting (#300)",
  };
  const subjectOf = (sha) => subjects[sha] ?? null;
  // 952ce309 is deliberately absent: it is a lane commit, never a landing on main.
  const onMain = new Set(["7dafc402", "20ef848d", "ee5bdd8b", "e26108f7"]);
  const landedOnMain = (sha) => onMain.has(sha);

  it("reads all three landing shapes, and pairs nothing else", () => {
    const md = [
      "| a | CLAIMED | PR [#334](https://github.com/o/r/pull/334) \u2192 `20ef848d`, landed. |",
      "| b | CLAIMED | PR [#314](https://github.com/o/r/pull/314) (`7dafc402`, upstream). |",
      "| c | MERGED | PR [#277](https://github.com/o/r/pull/277) merge-committed to `main` as `ee5bdd8b`. |",
      "| d | CLAIMED | PR [#315](https://github.com/o/r/pull/315), based on `main` -- 11 commits. |",
    ].join("\n");
    expect(mergeCitations(md)).toEqual([
      { pr: 334, sha: "20ef848d" },
      { pr: 314, sha: "7dafc402" },
      { pr: 277, sha: "ee5bdd8b" },
    ]);
  });

  it("does not pair a PR with a SHA merely because they share a row", () => {
    // The pattern binds through the join, so there is no distance at which a stray SHA gets
    // adopted -- and none at which a real one is dropped. The previous cut used a 200-character
    // window and a citation 211 wide vanished from all three of its buckets.
    const far = `PR [#900](https://github.com/o/r/pull/900) ${"filler ".repeat(40)} \`20ef848d\``;
    expect(mergeCitations(far)).toEqual([]);
    // Not silence, though: the SHA is a real landing, so the completeness half surfaces it.
    expect(uncitedLandings(far, landedOnMain)).toEqual(["20ef848d"]);
  });

  it("surfaces a landing written in a shape it cannot read, instead of skipping it", () => {
    const fourthShape = "PR [#277](https://github.com/o/r/pull/277) was eventually landed by `ee5bdd8b`.";
    expect(mergeCitations(fourthShape)).toEqual([]);
    expect(uncitedLandings(fourthShape, landedOnMain)).toEqual(["ee5bdd8b"]);
  });

  it("cannot see a second, false claim about a SHA the record already cites -- a stated limit", () => {
    // Pinned so the boundary is visible rather than rediscovered by the next reviewer. The
    // citation half never binds this shape, and the completeness half sees `20ef848d` as already
    // cited, so nothing fires. A landing-verb critic would catch it and flagged 24 honest
    // sentences of this document doing so; the cure is worse. If someone ever closes this, this
    // test reds and they update it deliberately.
    const md = [
      "PR [#334](https://github.com/o/r/pull/334) → `20ef848d`",
      "PR [#900](https://github.com/o/r/pull/900) was, much later and in prose, landed by `20ef848d`.",
    ].join("\n");
    expect(mergeCitations(md)).toEqual([{ pr: 334, sha: "20ef848d" }]);
    expect(uncitedLandings(md, landedOnMain)).toEqual([]);
  });

  it("does not flag a mention that is not a landing at all", () => {
    const prose = "The tip `952ce309` is a lane commit and `deadbeef` resolves to nothing.";
    expect(uncitedLandings(prose, landedOnMain)).toEqual([]);
  });

  it("refuses to run the completeness half without a landing reader", () => {
    expect(() => uncitedLandings("`20ef848d`")).toThrow(/landing reader/);
  });

  it("passes a true pairing and fails the swapped one", () => {
    const truthful = "PR [#314](https://github.com/o/r/pull/314) (`7dafc402`)";
    const swapped = "PR [#314](https://github.com/o/r/pull/314) (`20ef848d`)";
    expect(falseMergeCitations(mergeCitations(truthful), subjectOf, landedOnMain)).toEqual([]);
    expect(falseMergeCitations(mergeCitations(swapped), subjectOf, landedOnMain)).toEqual([
      { pr: 314, sha: "20ef848d" },
    ]);
  });

  it("refuses a subject that ends (#N) when the commit never landed on main", () => {
    // The round-2 attack, with this repository's real data. #300 is an OPEN ISSUE and `952ce309`
    // is a lane commit, but the subject ends `(#300)` -- so a subject-only check certified the
    // fabricated row "PR [#300](...) (`952ce309`)" as a true landing.
    const md = "PR [#300](https://github.com/o/r/pull/300) (`952ce309`)";
    expect(falseMergeCitations(mergeCitations(md), subjectOf, landedOnMain)).toEqual([
      { pr: 300, sha: "952ce309" },
    ]);
    // The second reviewer built the same attack independently off a different pair, which is why
    // this is a class and not an anecdote: #240 is also an issue, `d59c3d65` also a lane commit.
    const other = "PR [#240](https://github.com/o/r/pull/240) (`d59c3d65`)";
    const subject240 = () => "fix(test): guard-local comment stripping no longer fuses margin tokens (#240)";
    expect(falseMergeCitations(mergeCitations(other), subject240, landedOnMain)).toEqual([
      { pr: 240, sha: "d59c3d65" },
    ]);
  });

  it("still accepts a real squash landing, and marks it as resting on the weaker shape", () => {
    // Refusing this failed two TRUE rows on the first live run (#273, #275) -- #295 inverted.
    const md = "PR [#273](https://github.com/o/r/pull/273) \u2192 `e26108f7`";
    expect(falseMergeCitations(mergeCitations(md), subjectOf, landedOnMain)).toEqual([]);
    expect(squashOnlyCitations(mergeCitations(md), subjectOf, landedOnMain)).toEqual([
      { pr: 273, sha: "e26108f7" },
    ]);
    const wrong = "PR [#274](https://github.com/o/r/pull/274) \u2192 `e26108f7`";
    expect(falseMergeCitations(mergeCitations(wrong), subjectOf, landedOnMain)).toEqual([
      { pr: 274, sha: "e26108f7" },
    ]);
  });

  it("requires the squash number at the END, not merely somewhere", () => {
    const body = { abc1234: "fix: follow up to (#273) in the parser" };
    const md = "PR [#273](https://github.com/o/r/pull/273) (`abc1234`)";
    expect(falseMergeCitations(mergeCitations(md), (s) => body[s] ?? null, () => true)).toEqual([
      { pr: 273, sha: "abc1234" },
    ]);
  });

  it("does not let #31 match #314's subject", () => {
    // A bare `#${pr}` test would call this true, because the subject contains "#314".
    const md = "PR [#31](https://github.com/o/r/pull/31) (`7dafc402`)";
    expect(falseMergeCitations(mergeCitations(md), subjectOf, landedOnMain)).toEqual([
      { pr: 31, sha: "7dafc402" },
    ]);
  });

  it("counts an unreadable commit as false, never as fine", () => {
    const md = "PR [#999](https://github.com/o/r/pull/999) (`deadbeef`)";
    expect(falseMergeCitations(mergeCitations(md), subjectOf, landedOnMain)).toEqual([
      { pr: 999, sha: "deadbeef" },
    ]);
    const throws = () => {
      throw new Error("unreadable history");
    };
    expect(falseMergeCitations(mergeCitations(md), throws, () => true)).toEqual([
      { pr: 999, sha: "deadbeef" },
    ]);
    expect(falseMergeCitations(mergeCitations(md), subjectOf, throws)).toEqual([
      { pr: 999, sha: "deadbeef" },
    ]);
  });

  it("refuses to run without both readers", () => {
    expect(() => falseMergeCitations([{ pr: 1, sha: "abc1234" }])).toThrow(/landing reader/);
    expect(() => falseMergeCitations([{ pr: 1, sha: "abc1234" }], subjectOf)).toThrow(/landing reader/);
  });

  it("holds for THIS repository's record, and proves it read something", () => {
    const record = readFileSync(join(repoRoot, "docs/BRANCH_DISPOSITIONS.md"), "utf8");
    const cited = mergeCitations(record);
    // Without this, a reworded document would make every assertion below vacuous.
    expect(cited.length).toBeGreaterThan(0);

    const baseline = ["origin/main", "main"].find((ref) => {
      try {
        git(repoRoot, ["rev-parse", "--verify", "--quiet", ref]);
        return true;
      } catch {
        return false;
      }
    });
    // No baseline means the landing half cannot be checked at all -- fail, never skip.
    expect(baseline).toBeTruthy();
    const firstParent = git(repoRoot, ["rev-list", "--first-parent", baseline]).split("\n");
    const landedOnRecordMain = (sha) => firstParent.some((full) => full.startsWith(sha));
    const live = (sha) => {
      try {
        return git(repoRoot, ["log", "-1", "--format=%s", sha]);
      } catch {
        return null;
      }
    };

    expect(falseMergeCitations(cited, live, landedOnRecordMain)).toEqual([]);
    // Every real landing this document names is named AS a citation, bar the two it names for
    // other reasons. This is what replaced the 200-character window: no landing can go unread.
    expect(uncitedLandings(record, landedOnRecordMain)).toEqual([]);
    expect(Object.keys(NON_CITATION_LANDINGS).every((sha) => record.includes(sha))).toBe(true);
    // Pinned, because the squash shape cannot prove #N is a PR rather than an issue. A NEW
    // squash-only citation reds here until somebody confirms it by hand -- that is the design.
    expect(squashOnlyCitations(cited, live, landedOnRecordMain)).toEqual([
      { pr: 273, sha: "e26108f7" },
      { pr: 275, sha: "29fb8009" },
    ]);
  });
});
