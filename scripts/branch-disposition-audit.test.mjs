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
  pruneCommand,
  refSplit,
  refSetCoverage,
  resolveBase,
  squashOnlyCitations,
  uncitedLandings,
  NON_CITATION_LANDINGS,
} from "./branch-disposition-audit.mjs";
import { DIR, readAll, slugOf, write } from "./lib/dispositions.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const git = (dir, args) =>
  execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Lay the given rows down as records, replacing whatever the previous run left behind. */
const layRecords = (repo, rows) => {
  rmSync(join(repo, DIR), { recursive: true, force: true });
  mkdirSync(join(repo, DIR), { recursive: true });
  for (const [ref, disposition, evidence = "because"] of rows) {
    write(repo, { ref, disposition, issue: null, evidence });
  }
};

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
  layRecords(fixture, rows);
  return audit({ repoRoot: fixture, ...extra });
};

describe("the record store", () => {
  // The store replaced a Markdown table (#291). These rules are the table's parsing rules restated
  // against files: what used to be "is this line a row" is now "is this file a record", and the
  // failure modes that used to be malformed rows are malformed files.
  const store = () => {
    const repo = mkdtempSync(join(root, "store-"));
    mkdirSync(join(repo, DIR), { recursive: true });
    return repo;
  };

  it("round-trips a ref through its filename, so one ref can have only one record", () => {
    expect(slugOf("origin/lane/foo-1")).toBe("lane__foo-1");
    expect(slugOf("lane/foo-1")).toBe("lane__foo-1");
  });

  it("keeps evidence text that itself contains a pipe — JSON has no cell to break out of", () => {
    const repo = store();
    write(repo, { ref: "origin/landed", disposition: "MERGED", issue: null, evidence: "`a | b` held" });
    expect(readAll(repo).records[0].evidence).toBe("`a | b` held");
  });

  it("REPORTS a malformed record instead of skipping it — a broken file is not a green gate", () => {
    const repo = store();
    writeFileSync(join(repo, DIR, "lane__x.json"), "{ not json");
    const { records, problems } = readAll(repo);
    expect(records).toEqual([]);
    expect(problems[0]).toMatch(/not valid JSON/);
  });

  it("reports a record missing a required field rather than treating it as dispositioned", () => {
    const repo = store();
    writeFileSync(join(repo, DIR, "lane__x.json"), JSON.stringify({ ref: "origin/lane/x" }));
    expect(readAll(repo).problems[0]).toMatch(/missing required field\(s\): disposition, evidence/);
  });

  // This is what makes duplicates structurally impossible, and it replaces the old "appears twice"
  // scan: two records for one ref cannot both exist, because the filename IS the ref.
  it("refuses a record filed under a name that is not its own ref", () => {
    const repo = store();
    writeFileSync(join(repo, DIR, "lane__wrong.json"), JSON.stringify({ ref: "origin/lane/right", disposition: "CLAIMED", evidence: "e" }));
    const { records, problems } = readAll(repo);
    expect(records).toEqual([]);
    expect(problems[0]).toMatch(/belongs in docs\/dispositions\/lane__right\.json/);
  });

  it("counts the split the doc used to pin by hand", () => {
    // #309/#312. docs/BRANCH_DISPOSITIONS.md carried `Twenty-five non-PRESERVE refs remain` in prose,
    // and it was wrong twice on 2026-09-01 alone -- both times written stale by the very lane that
    // added the row it failed to count. A number beside an append-only record is wrong by the next
    // commit, so the audit computes it and the doc points at the audit.
    const repo = store();
    for (const [ref, disposition] of [["origin/keep", "PRESERVE"], ["origin/also-keep", "PRESERVE"], ["origin/live", "CLAIMED"]]) {
      write(repo, { ref, disposition, issue: null, evidence: "because" });
    }
    expect(refSplit(readAll(repo).records)).toEqual({ total: 3, preserve: 2, other: 1 });
    // Empty is a real answer, not a crash: a fresh repo with one branch has no records to count.
    expect(refSplit([])).toEqual({ total: 0, preserve: 0, other: 0 });
    // Only an exact PRESERVE counts. A record that merely mentions the word in its evidence does
    // not, which is the shape that would quietly inflate the protected count as the store grows.
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
    expect(problems[0]).toMatch(/no record/);
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
    expect(problems[0]).toMatch(/prune the ref and delete the record/);
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

  // Two records for one ref used to be possible and had to be scanned for. It is now structurally
  // impossible -- the filename is the slug of the ref, so the second write lands on the first --
  // and what remains checkable is the way a record could still be reachable under the wrong name.
  it("fails on a record filed under a name that is not its ref, so two records cannot disagree", () => {
    layRecords(fixture, [["origin/landed", "MERGED"]]);
    writeFileSync(
      join(fixture, DIR, "landed.json"),
      JSON.stringify({ ref: "origin/ahead", disposition: "MERGED", evidence: "e" }),
    );
    const problems = audit({ repoRoot: fixture });
    expect(problems.some((p) => /belongs in docs\/dispositions\/ahead\.json/.test(p))).toBe(true);
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

  it("makes no merge-tree demand of PRESERVE rows, in either slot", () => {
    expect(run([["origin/landed", "PRESERVE"], ["origin/ahead", "PRESERVE"]])).toEqual([]);
  });

  // #350: CLAIMED used to share PRESERVE's skip -- "claims nothing" -- so a CLAIMED row could assert
  // its own ref had merged and the audit would never contradict it. The live instance the issue was
  // filed over: `lane/docs-path-not-branch-310`, disposition CLAIMED, whose own prose says "Merged as
  // PR #316" with nothing ever re-checking it. CLAIMED now gets re-proven in the one direction that
  // matters -- has the ref, in fact, already landed -- while still making no demand in the other:
  // a genuinely still-diverged CLAIMED ref is exactly what "a lane is actively working this" looks
  // like, and must not be flagged.
  it("tolerates a CLAIMED row whose ref genuinely has not landed yet", () => {
    expect(run([["origin/landed", "PRESERVE"], ["origin/ahead", "CLAIMED"]])).toEqual([]);
  });

  it("fails a CLAIMED row whose ref has already landed -- the claim is dead", () => {
    const problems = run([["origin/landed", "CLAIMED"], ["origin/ahead", "UNLANDED"]]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(
      /origin\/landed is recorded CLAIMED, but merging it into main is already a no-op — the work has landed/,
    );
    // The remedy names BOTH legitimate outcomes -- unlike a stale MERGED row, landing does not by
    // itself mean prunable, because the ref may be deliberately kept (LANDED).
    expect(problems[0]).toMatch(/LANDED if this ref is deliberately kept/);
    expect(problems[0]).toContain("git push origin --delete landed");
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
      run([["origin/landed", "CLAIMED"], ["origin/ahead", "UNLANDED"]]), // a CLAIMED ref that landed
    ].flat();
    expect(asksForDeletion).toHaveLength(4);
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
        ["origin/ahead", "PROBABLY FINE"],
      ],
      { coverage: blind },
    );
    expect(problems.some((p) => /PROBABLY FINE/.test(p))).toBe(true);
  });

  it("still fails an empty table without origin — a record with no rows is broken on any clone", () => {
    expect(run([], { coverage: blind })[0]).toMatch(/holds no disposition records/);
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
// and outbound guards use. No live line carries it today: the one that did was a table row, and
// #291 moved the rows out of Markdown into docs/dispositions/*.json, which this rule does not scan
// because a mechanical record is not prose that can prescribe anything. Count the live hits with
// `git grep -c blocked-prune-allow -- '*.md' ':!docs/archive'`. The exclusion is not cosmetic: this
// rule exempts the archive, so a
// count that includes it answers a different question than the one the rule asks -- zero hits
// there today, which is the right number reached over the wrong corpus.
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

// #350 shipped the CLAIMED re-proof above, and the moment it runs against this real repository it
// finds 13 CLAIMED rows that are already no-ops against `origin/main` -- `lane/docs-path-not-branch-310`
// (the row the issue was filed over) among them, plus twelve more nobody had looked at. That is not
// a bug in the check; it is the check working, against records this lane's write scope does not
// reach: fixing a `docs/dispositions/*.json` file is the "sweep of existing CLAIMED rows" cost #350
// named on the record, and it is out of scope here on purpose (this lane's own worktree rules bar
// it) -- filed as follow-up work, never quietly done as a side effect of landing the mechanism.
//
// So this pins today's known offenders BY REF, the same shape `NON_CITATION_LANDINGS` and
// `squashOnlyCitations` already use below: a short, reviewed list, not an open-ended "ignore any
// CLAIMED-landed problem" filter. A ref leaving this list because its record got swept is harmless --
// the filter just stops matching it, and shrinking the array is the sweep's own follow-up diff. A
// NEW ref joining the CLAIMED-landed set, or any OTHER kind of problem, is not on this list and still
// reds the test below.
const KNOWN_STALE_CLAIMED_ROWS_PENDING_350_SWEEP = [
  "origin/claude/exciting-robinson-0ce4d5",
  "origin/fix/green-main-after-314-332",
  "origin/fix/handoff-grace-cycle-333",
  "origin/lane/agent-skills-config",
  "origin/lane/atomic-json-281",
  "origin/lane/docs-path-not-branch-310",
  "origin/lane/fleet-guard-failclosed-276",
  "origin/lane/license-atomic-284",
  "origin/lane/prune-list-truth-305",
  "origin/lane/receipt-preservation-298",
  "origin/lane/remote-cache-design-286",
  "origin/lane/rule-c-at-risk-312",
  "origin/lane/segmented-a11y-237",
];

describe("this repository", () => {
  it("has a true branch-disposition record right now, aside from pre-#350 CLAIMED debt", () => {
    const problems = audit({ repoRoot });
    const isKnownStaleClaim = (p) =>
      KNOWN_STALE_CLAIMED_ROWS_PENDING_350_SWEEP.some((ref) => p.startsWith(`${ref} is recorded CLAIMED,`));
    expect(problems.filter((p) => !isKnownStaleClaim(p))).toEqual([]);
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

  it("cannot see a landing claim, in a shape it cannot read, about a SHA that never landed", () => {
    // The SECOND stated limit, and the one that needs no prior citation to hide behind: an invented
    // PR and an invented SHA in free prose are equally invisible, so the gap is wider than "a SHA
    // the record already cites". The citation half never binds this shape; the completeness half
    // only judges SHAs that really landed, and this one did not, so there is nothing for it to be
    // uncited ABOUT. Pinned because `uncitedLandings`'s docstring says both limits are pinned, and
    // a guard whose own comments overstate their coverage is this file's defect one level down.
    const md =
      "PR [#9001](https://github.com/o/r/pull/9001) was, in an after-the-fact writeup, " +
      "actually landed by `deadfeed1234567890abcdef1234567890abcdef`.";
    expect(mergeCitations(md)).toEqual([]);
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
    // The record is the store now, not one table (#291). Citations live in the evidence text of the
    // per-ref files, so the corpus is every record's own prose joined -- the same bytes the table
    // used to hold, minus the shared file that made every lane collide on it.
    const record = readAll(repoRoot)
      .records.map((r) => `${r.ref} ${r.issue ?? ""} ${r.evidence}`)
      .join("\n");
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
    // Sorted, because the corpus is now a directory listing rather than one hand-ordered table:
    // which record is read first is the filesystem's business, and a pin on that order would fail
    // on a rename that changed nothing about the citations.
    expect(squashOnlyCitations(cited, live, landedOnRecordMain).sort((a, b) => a.pr - b.pr)).toEqual([
      { pr: 273, sha: "e26108f7" },
      { pr: 275, sha: "29fb8009" },
    ]);
  });
});

// Both rules below came out of the independent review of PR #338, which found a row still calling
// PR #316 "stacked on `lane/receipt-modified-309` -- 14 commits past `origin/main`" in the very
// commit that deleted that ref, with the true count by then 3. The audit was green throughout:
// `branch-disposition-audit.mjs` validates row KEYS against origin's refs and never reads row
// PROSE, so a row can name a branch this table itself pruned and nothing notices. That is the
// standing "green that is not evidence" class (#322), one level down.
//
// Deliberately offline. Both read the document and each other, never the network -- #339 is a red
// this same lane caught, where one `ls-remote` inside the 407-file parallel storm lost its slice
// and reddened the whole gate. A rule that can only fail for a real reason is worth more than a
// rule that is one round-trip more thorough.
describe("the record's prose does not outlive the refs it describes", () => {
  // The corpus is the records themselves. What used to be "every line the audit calls a row" is
  // now "every record the audit reads", which is the same agreement one layer stronger: there is no
  // parsing left to drift between guard and audit, because `readAll` IS the definition of a record.
  const records = () => readAll(repoRoot).records;

  // The predicate used to be the audit's own row parser, imported rather than copied, because two
  // rounds of review showed a copied one drifts. That whole hazard is gone with the table: there is
  // no line-shape to agree on any more. What remains is the ref set, taken straight from the store.
  const bareRef = (ref) => ref.replace(/^origin\//, "");
  const recordKeys = (rs) => new Set(rs.map((r) => bareRef(r.ref)));

  // A count is measured against a branch tip, and a branch tip moves on every merge -- so the
  // number is stale the moment any other lane lands, without a word of this file changing. The
  // table already learned this for tip SHAs ("a row naming its own branch's head is stale on
  // arrival"); a count is the same mistake with more arithmetic. Measured before banning: of the
  // five rows that pinned one against `origin/main`, two were already wrong (14 -> 3, 20 -> 9) and
  // three were still right, which is exactly the mix that makes the wrong ones believable.
  //
  // Widened three times, each after an independent review found a phrasing the version before it let
  // through -- and twice the COMMENT was the defect as much as the pattern was:
  //   round 1 banned `origin/main` only, and gave as its reason for not reaching `main` that the
  //     prose sections would be caught too. False: this rule only ever reads table rows.
  //   round 2 added `main`, "ahead of", and a bolded number -- "now carries **zero** commits past
  //     `main`" had sat in this table THROUGH the commit that added the rule -- and then named
  //     exactly two remaining misses as though that were the whole remainder. It was not:
  //     "N commits behind `main`" was a third, in a file whose own row 74 discusses behind-counts,
  //     and half a dozen more followed from bolding a different word.
  //   round 3 stopped enumerating misses, because enumerating them is what failed twice. Emphasis
  //     and code markers are stripped BEFORE matching, which retires the formatting-bypass family
  //     in one move rather than one alternative per review, and the coverage is stated as a closed
  //     set below instead of the remainder being stated as a closed set.
  //   round 4 found that closed set was not closed. The spelled numbers stopped at fifty, so
  //     "eighty commits behind main" walked past a rule whose comment said nothing else was caught
  //     -- a paraphrase of a list is a third thing to keep in sync, and it fell out of sync in the
  //     same commit that wrote it. The alternation now runs through the magnitudes, and the
  //     sentence below points AT it rather than restating it.
  //
  // WHAT IS CAUGHT. After `*`, backtick and `_` are stripped from the row, an offender is: a count,
  // then "commit"/"commits", then "past", "behind" or "ahead of", then optionally "the", then
  // `main` or `origin/main` on a word boundary. A count is any run of digits, or one of the words
  // spelled out in the alternation below -- which, matching on a word boundary, also catches the
  // compounds ending in one of them ("a hundred and twelve commits past main"). A quantity worded
  // outside that list -- "a dozen commits past `main`" -- is NOT caught, and that case is pinned in
  // the self-test, so where the edge sits is a measured fact rather than a sentence about one.
  //
  // Two kinds of outsider, given as EXAMPLES and explicitly not as a complete list:
  //   * a count against a NAMED landed commit ("3 commits past `16069fa`") -- anchored to something
  //     that does not move, and fine;
  //   * a count with no baseline in the sentence at all ("#286/#287 fell to 3 and 5") -- which stood
  //     in this table while wrong, measured 0 and 7, and was caught by a human reviewer rather than
  //     here. No pattern separates that from honest prose without redding the rest of the file, so
  //     it is a review duty and always will be.
  const PINNED_COUNT =
    /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|\d+)\s+commits?\s+(?:past|behind|ahead\s+of)\s+(?:the\s+)?(?:origin\/)?main\b/i;
  // Stripped, not alternated: bolding the number, the noun, the verb or the ref, and dropping
  // the backticks entirely, are all the same bypass wearing different clothes. Round 2 answered
  // one of them with `(?:\*\*)?` and left five.
  const stripMarkup = (line) => line.replace(/[*`_]/g, "");
  const pinsACount = (line) => PINNED_COUNT.test(stripMarkup(line));

  it("pins no commit count against a baseline that moves", () => {
    const rows = records();
    // Without this the ban passes on a document the rule never found: rename a column, reformat the
    // table, and "no offenders" means "no rows read". The commit that shipped this rule claimed
    // every rule here carried a self-test that stopped it passing vacuously; for THIS one that was
    // false, and the review said so. The floor sits far below the row count so that retiring a row
    // cannot red it.
    expect(rows.length).toBeGreaterThan(20);
    const offenders = rows.filter((r) => pinsACount(r.evidence)).map((r) => r.file);
    expect(offenders).toEqual([]);
  });

  // Without this the rule above passes on a document it never understood -- a reworded table, or a
  // regex that quietly stopped matching, and the ban reads as satisfied because nothing matched.
  it("would catch a pinned count however it is spelled or formatted", () => {
    const row = (evidence) => evidence;

    // Round 1's own cases.
    expect(pinsACount(row("— 14 commits past `origin/main`."))).toBe(true);
    expect(pinsACount(row("two of its seven commits past `origin/main`"))).toBe(true);
    expect(pinsACount(row("one commit past `origin/main`"))).toBe(true);

    // Round 2: the two rows that escaped round 1, each in the words it actually used, plus the
    // LITERAL sentence that sat in this table through the commit adding the rule. Verbatim from
    // `git show 0b0a870b:docs/BRANCH_DISPOSITIONS.md` -- that string carries TWO bypasses at once,
    // the bolded number and the bare `main`, and the commit that fixed it misquoted the second half
    // as `origin/main`. A regression test that reproduces the defect approximately is how a
    // misquote survives, so this one is the real bytes.
    expect(pinsACount(row("Three commits past `main`, checked out at"))).toBe(true);
    expect(pinsACount(row("a sibling branch, 7 commits ahead of `main`."))).toBe(true);
    expect(pinsACount(row("`origin/lane/license-atomic-284` now carries **zero** commits past `main`,"))).toBe(true);

    // Round 3: the blocking miss, and the formatting family that came with it.
    expect(pinsACount(row("27 commits behind `main`"))).toBe(true);
    expect(pinsACount(row("27 commits behind `origin/main`"))).toBe(true);
    expect(pinsACount(row("7 **commits** past `origin/main`"))).toBe(true);
    expect(pinsACount(row("7 commits **past** `origin/main`"))).toBe(true);
    expect(pinsACount(row("7 commits past **`origin/main`**"))).toBe(true);
    expect(pinsACount(row("7 commits past origin/main"))).toBe(true);
    expect(pinsACount(row("7 commits ahead of the `main` branch"))).toBe(true);

    // Round 4: the magnitudes the alternation used to stop short of, and a row the copied `isRow`
    // predicate did not see at all -- `parseRow` strips backticks around a ref, it never requires
    // them, so a row written without them is a row to the audit and must be one here.
    expect(pinsACount(row("eighty commits behind `main`"))).toBe(true);
    expect(pinsACount(row("a hundred commits past `main`"))).toBe(true);
    expect(pinsACount("5 commits past origin/main")).toBe(true);

    // The two example outsiders, pinned so that nobody reads this rule as covering them, and the
    // wording the alternation does not reach, pinned so that the sentence above is measured.
    expect(pinsACount(row("a dozen commits past `main`"))).toBe(false);
    expect(pinsACount(row("3 commits past `16069fa`"))).toBe(false);
    expect(pinsACount(row("#286/#287 fell to 3 and 5"))).toBe(false);

    // And the sentences this file uses to say a count is deliberately absent, which must stay legal
    // or the ban would forbid explaining itself. Both are live in row 74 today.
    expect(pinsACount(row("Neither an ahead- nor a behind-count is pinned here"))).toBe(false);
    expect(pinsACount(row("the behind-count this row used to carry — 27 — was off by 820"))).toBe(false);
  });

  // "stacked on X" is a claim about the shape of the world RIGHT NOW, unlike "landed as #315",
  // which is history and stays true forever. Only the present-tense form is checked, because a
  // blanket ban on naming a dead ref would red the honest half of this table: row after row names
  // a branch that has since been pruned, correctly, in the past tense -- and one row names
  // `claude/compy-visual-recovery-kit-6fd074`, which has never been on any remote and is named
  // here precisely so it does not get deleted. Failing those would be #295 again, a guard reading
  // true prose as a lie.
  const STACK_CLAIM = /stacked\s+(?:\w+\s+deep\s+)?on\s+`((?:origin\/)?[A-Za-z0-9._/-]+)`/gi;
  const stackClaims = (rs) =>
    rs.flatMap((r) =>
      [...String(r.evidence).matchAll(STACK_CLAIM)].map((m) => ({ file: r.file, base: bareRef(m[1]) })),
    );

  it("claims no live stack on a ref the store no longer records", () => {
    const rs = records();
    const claims = stackClaims(rs);
    // Vacuous otherwise: a table that stopped using the word would pass this without being read.
    expect(claims.length).toBeGreaterThan(0);
    const keys = recordKeys(rs);
    // The direction this needs is the CONVERSE of the cover check, and the first version of this
    // comment cited the wrong one. Not "every live ref has a row" -- that would leave a row for a
    // pruned ref perfectly legal -- but "every ROW has a live ref", which the audit also enforces:
    // `if (!live.has(ref)) problems.push(... no longer exists -- drop the row)`. Given that, "has a
    // row here" is the offline way to ask "still exists", with no round-trip.
    //
    // STATED LIMIT: both directions sit behind `if (!cover.tracksEveryBranch) return problems;` in
    // that file, so in a checkout that cannot see every branch the audit enforces neither and this
    // rule degrades to checking the table against itself. It is never LOUDER than the audit, only
    // quieter -- the safe direction, but not the one the bare sentence above implied.
    const dangling = claims
      .filter(({ base }) => !keys.has(base))
      .map(({ file, base }) => `${file} claims a live stack on \`${base}\`, which has no record`);
    expect(dangling).toEqual([]);
  });

  it("would catch the row that prompted it, and spares the past tense", () => {
    const rec = (evidence) => [{ file: "docs/dispositions/lane__a.json", ref: "origin/lane/a", evidence }];
    const dead = rec("PR #316, stacked on `lane/receipt-modified-309` — 14 commits.");
    const alive = rec("stacked two deep on `lane/b`");
    const history = rec("its base `lane/receipt-modified-309` landed as PR #315.");
    const keys = recordKeys([{ ref: "origin/lane/a" }, { ref: "origin/lane/b" }]);
    expect(stackClaims(dead).map((c) => keys.has(c.base))).toEqual([false]);
    expect(stackClaims(alive).map((c) => keys.has(c.base))).toEqual([true]);
    expect(stackClaims(history)).toEqual([]);
  });
});
