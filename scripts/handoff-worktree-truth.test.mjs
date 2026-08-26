// Guard: the handoff may describe the worktrees, but only truthfully.
//
// 2026-08-25. `docs/SESSION_HANDOFF.md` said "Seven worktrees, all spent. None is mid-flight",
// carried forward from the previous handoff instead of re-derived. `git worktree list` said eleven
// besides main, and four of them held commits that are not ancestors of `origin/main`. The same
// paragraph instructed the next session to "delete or hard-reset before reusing one" — so a reader
// following the doc exactly would have destroyed four lanes' unmerged work.
//
// The number was never the defect. Carrying a claim about THIS MACHINE forward without re-deriving
// it is, and prose cannot notice itself going stale.
//
// Three rules, and they fail in different environments on purpose:
//
//   A. Portable. Every branch the handoff names as carrying work not on main must actually not be
//      an ancestor of `origin/main`. This runs anywhere the remote ref is fetched, CI included, and
//      it is the rule that decays on its own — a branch merges and the warning silently becomes a
//      lie that reads exactly like the truth.
//   B. Local only. A stated worktree count must match `git worktree list`. A CI checkout has one
//      worktree and nothing to compare against, so this SKIPS there rather than passing vacuously —
//      and says so. That is not a hole worth closing: handoffs are written on the owner's desk,
//      where the pre-push gate runs `npm test` against a repo that has eleven.
//   C. Local only. Every checkout that CARRIES commits must be named, whether or not it has a
//      branch. Added 2026-08-26 after a detached checkout holding four commits sat unnamed for
//      fifteen days with A and B both green — A only judges branches the doc already names, and B
//      only counts. Its own inert path is the one a review caught next: if `origin/main` cannot be
//      resolved, every count throws at once, and reading that as "no carriers" would reproduce this
//      exact defect one level down. An uncountable checkout is therefore a FAILURE, never a zero.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const HANDOFF = join("docs", "SESSION_HANDOFF.md");

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

/**
 * The one bullet that describes THIS machine's checkouts. Both rules read from it rather than from
 * the whole document: on 2026-08-25 the fix for this very defect added a changelog row quoting the
 * old wrong number ("seven worktrees, all spent"), which sits ABOVE the corrected bullet — a
 * whole-document match would have read the quote and failed the doc for saying what it fixed.
 * Rule A shouts if this bullet is ever reworded away, so scoping cannot make either rule inert.
 */
export function repoStateBullet(markdown) {
  return markdown.split(/\r?\n(?=- \*\*)/).find((b) => /not on main|NOT on main/.test(b)) ?? null;
}

/** "Eleven worktrees besides `main`" / "7 worktrees" — the count, however it is spelled. */
export function statedWorktreeCount(markdown) {
  const m = markdown.match(/\b(\d{1,2}|[A-Za-z]+)\s+worktrees\b/i);
  if (!m) return null;
  const raw = m[1].toLowerCase();
  return /^\d+$/.test(raw) ? Number(raw) : (WORDS[raw] ?? null);
}

/** Branch names in backticks inside the bullet that claims work is NOT on main. */
export function branchesClaimedUnmerged(markdown) {
  const bullet = repoStateBullet(markdown);
  if (!bullet) return [];
  return [...bullet.matchAll(/`((?:lane|feat|fix|agent|docs|claude|codex|design|tooling|recovery)\/[A-Za-z0-9._/-]+)`/g)]
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i);
}

/**
 * Which claimed branches have since landed. The ancestry test is injected so the rule can be
 * falsified against a branch that IS merged: every branch on `origin` today carries work, so a live
 * negative control does not exist to write. `resolves` is separate from `isAncestor` on purpose — a
 * ref this checkout has never fetched must not be reported as "not merged", which is how a guard
 * goes quietly inert.
 */
export function landedBranches(claimed, resolves, isAncestor) {
  return claimed.filter((b) => resolves(b) && isAncestor(b));
}

const refExists = (b) => {
  try {
    git("rev-parse", "--verify", "--quiet", `origin/${b}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

const landedOnMain = (b) => {
  try {
    git("merge-base", "--is-ancestor", `origin/${b}`, "origin/main");
    return true;
  } catch {
    return false;
  }
};

/**
 * Every checkout that carries commits `origin/main` cannot reach, reduced to the one token the
 * handoff has to name. A checkout on a branch is named by its branch; a DETACHED one has no branch
 * at all, so it is named by the last segment of its path.
 *
 * Rule C exists because that second shape is invisible to every other audit in this repo: they all
 * enumerate `origin` refs, and a detached checkout has none. One sat unnamed in the handoff for
 * fifteen days while `docs/BRANCH_DISPOSITIONS.md` said in as many words that "no worktree held it",
 * and both rule A and rule B passed the whole time — A only judges the branches the doc DOES name,
 * and B only counts checkouts, which was right.
 */
export function carriersMissingFromBullet(bullet, carriers) {
  // Code spans only. A bare substring test would let a checkout whose name is also an ordinary word
  // be "named" by prose that never identifies it, which under-reports in the same silent direction
  // as naming nothing at all. A path is credited by its last segment: the handoff writes the
  // detached one as a full worktree path, and its identity is the segment, not the prefix.
  const spans = [...(bullet ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const tail = (span) => span.split(/[\\/]/).filter(Boolean).pop();
  const named = (name) => spans.some((span) => span === name || tail(span) === name);
  return carriers.filter((c) => c.commits > 0 && !named(c.name)).map((c) => c.name);
}

/**
 * Checkouts whose distance from `origin/main` could not be measured at all. `null` is deliberately
 * not `0`: an unfetched or unresolvable `origin/main` makes every count throw at once, and a
 * `catch { return 0 }` would turn a total measurement failure into "nothing carries anything" —
 * a green rule that never read the handoff. These fail the build instead.
 */
/**
 * `countAhead` carrying the one semantic that matters: a count that could not be TAKEN is `null`,
 * not `0`. Built from an injected runner so the total-failure path is falsifiable through the same
 * seam the rule itself uses — a try/catch written inline in the test body could only ever be read,
 * never exercised.
 */
export function countAheadVia(runner) {
  return (committish) => {
    try {
      const raw = String(runner(committish)).trim();
      const n = Number(raw);
      return raw !== "" && Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  };
}

export function unmeasuredCarriers(carriers) {
  return carriers.filter((c) => c.commits === null).map((c) => c.name);
}

/**
 * `git worktree list --porcelain` -> [{ name, commits }], counted against origin/main. Exported so
 * the TOTAL-measurement-failure path can be falsified against the real porcelain of this machine
 * rather than only against a stub: pass a countAhead that throws and every carrier must come back
 * unmeasured, never zero.
 */
export function liveCarriers(list, countAhead) {
  return list
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.split(/\r?\n/).filter(Boolean))
    .filter((lines) => lines.some((l) => l.startsWith("worktree ")))
    .map((lines) => {
      const path = lines.find((l) => l.startsWith("worktree ")).slice("worktree ".length);
      const branchLine = lines.find((l) => l.startsWith("branch "));
      const headLine = lines.find((l) => l.startsWith("HEAD "));
      const branch = branchLine ? branchLine.slice("branch ".length).replace(/^refs\/heads\//, "") : null;
      const committish = branch ?? (headLine ? headLine.slice("HEAD ".length) : null);
      return {
        name: branch ?? path.split(/[\\/]/).filter(Boolean).pop(),
        commits: committish ? countAhead(committish) : null,
      };
    })
    .filter((c) => c.name !== "main");
}

const markdown = readFileSync(join(ROOT, HANDOFF), "utf8");

describe("the handoff tells the truth about the worktrees", () => {
  it("still catches the claim it was written for", () => {
    // Pinned separately from the live doc so a green run can never mean "the parser found nothing".
    expect(statedWorktreeCount("- **Seven worktrees, all spent.** None is mid-flight;")).toBe(7);
    expect(statedWorktreeCount("- **Eleven worktrees besides `main`; six are spent**")).toBe(11);
    expect(statedWorktreeCount("- **11 worktrees** besides main")).toBe(11);
    expect(statedWorktreeCount("No claim about checkouts here.")).toBe(null);
    expect(
      branchesClaimedUnmerged("- **A; six are spent but FOUR still carry work that is not on main** —\n  `lane/a` and `feat/b`."),
    ).toEqual(["lane/a", "feat/b"]);
    expect(branchesClaimedUnmerged("- **Nothing to see.** `feat/b` is fine.")).toEqual([]);
    // Scoping: a changelog row quoting the OLD number must not outrank the corrected bullet below it.
    const quoted = "| `a3f3a75b` | said \"seven worktrees, all spent\" |\n\n- **Two worktrees besides `main`; one carries work that is not on main** — `lane/a`.";
    expect(statedWorktreeCount(quoted)).toBe(7);
    expect(statedWorktreeCount(repoStateBullet(quoted))).toBe(2);
    expect(repoStateBullet("- **Nothing here.** All clean.")).toBe(null);
    // The ancestry half, against a stub — no branch on origin is merged today, so this is the only
    // way to prove the rule fires rather than merely never having anything to say.
    const all = () => true;
    expect(landedBranches(["lane/a", "feat/b"], all, (b) => b === "feat/b")).toEqual(["feat/b"]);
    expect(landedBranches(["lane/a"], all, () => false)).toEqual([]);
    // An unfetched ref is unknown, not clean.
    expect(landedBranches(["lane/a"], () => false, all)).toEqual([]);
    // Rule C, against stubs — the live tree is expected to be clean, so this is the only place the
    // rule can be proven to FIRE rather than merely having nothing to say.
    const bullet = "- **Two carry commits that are not on main** — `lane/a`.";
    expect(carriersMissingFromBullet(bullet, [{ name: "lane/a", commits: 3 }])).toEqual([]);
    expect(carriersMissingFromBullet(bullet, [{ name: "ghost-c5660e", commits: 4 }])).toEqual(["ghost-c5660e"]);
    // A spent checkout is not owed a mention.
    expect(carriersMissingFromBullet(bullet, [{ name: "ghost-c5660e", commits: 0 }])).toEqual([]);
    // A checkout named only in prose is NOT named: the matcher reads code spans, so a carrier whose
    // name is also an ordinary word cannot be credited by a sentence that never identifies it.
    expect(carriersMissingFromBullet("- **not on main** — the recovery checkout.", [{ name: "recovery", commits: 2 }])).toEqual(["recovery"]);
    // A detached checkout is credited by the last segment of its quoted path.
    expect(
      carriersMissingFromBullet("- **not on main** — `.claude/worktrees/ghost-c5660e`, detached.", [{ name: "ghost-c5660e", commits: 4 }]),
    ).toEqual([]);
    // An uncountable checkout is a failure, never a zero — the inert path a review caught in rule C.
    expect(unmeasuredCarriers([{ name: "lane/a", commits: 3 }, { name: "ghost", commits: null }])).toEqual(["ghost"]);
    expect(unmeasuredCarriers([{ name: "lane/a", commits: 0 }])).toEqual([]);
    expect(countAheadVia(() => "3")("HEAD")).toBe(3);
    expect(countAheadVia(() => { throw new Error("unknown revision origin/main"); })("HEAD")).toBe(null);
    expect(countAheadVia(() => "")("HEAD")).toBe(null);
  });

  it("A: every branch it calls unmerged is genuinely not on origin/main", () => {
    const claimed = branchesClaimedUnmerged(markdown);
    expect(claimed.length, `${HANDOFF} names no unmerged branches — did the bullet get reworded?`).toBeGreaterThan(0);
    // Not inert: at least one named branch must be a ref this checkout can actually judge.
    expect(
      claimed.filter(refExists).length,
      `${HANDOFF} names ${claimed.length} unmerged branch(es) and this checkout resolves none of them on origin — the rule would pass without judging anything.`,
    ).toBeGreaterThan(0);
    const merged = landedBranches(claimed, refExists, landedOnMain);
    expect(
      merged,
      `${HANDOFF} warns these branches carry work that is not on main, but they have since landed:\n  - ${merged.join("\n  - ")}\nStop telling the next session to preserve them.`,
    ).toEqual([]);
  });

  it("B: a stated worktree count matches this machine", () => {
    const live = git("worktree", "list", "--porcelain").split(/\r?\n/).filter((l) => l.startsWith("worktree ")).length;
    if (live <= 1) {
      // Vacuous here by construction. Say it out loud rather than reporting a pass.
      expect(live).toBe(1);
      return;
    }
    const stated = statedWorktreeCount(repoStateBullet(markdown) ?? markdown);
    expect(stated, `${HANDOFF} states no worktree count; nothing to check.`).not.toBe(null);
    expect(
      stated,
      `${HANDOFF} says ${stated} worktrees; this machine has ${live - 1} besides main. Re-derive it — ` +
        `the previous handoff's number is not evidence, and the same paragraph tells the reader to reset them.`,
    ).toBe(live - 1);
  });

  it("C: every checkout carrying commits is named — including one with no branch at all", () => {
    const list = git("worktree", "list", "--porcelain");
    const live = list.split(/\r?\n/).filter((l) => l.startsWith("worktree ")).length;
    if (live <= 1) {
      // A one-checkout clone has nothing to compare, exactly as in rule B. Say so; do not pass quietly.
      expect(live).toBe(1);
      return;
    }
    const countAhead = countAheadVia((committish) => git("rev-list", "--count", `origin/main..${committish}`));
    const carriers = liveCarriers(list, countAhead);
    // The inert path, falsified LIVE rather than merely described: the same porcelain, counted by a
    // runner that fails the way an unfetched origin/main fails, must come back unmeasured. The
    // second line is the shape this rule shipped with and a review caught — every carrier reading
    // as spent, so the rule names nothing and goes green without ever opening the handoff.
    const blind = liveCarriers(list, countAheadVia(() => { throw new Error("unknown revision origin/main"); }));
    expect(blind.length).toBeGreaterThan(0);
    expect(unmeasuredCarriers(blind).length).toBe(blind.length);
    expect(carriersMissingFromBullet("", blind)).toEqual([]);
    // The inert path FIRST. If origin/main cannot be resolved, every count fails at once and a rule
    // that read that as zero would go green without ever opening the handoff.
    const unmeasured = unmeasuredCarriers(carriers);
    expect(
      unmeasured,
      `rule C could not measure ${unmeasured.length} checkout(s) against origin/main: ${unmeasured.join(", ")}. ` +
        `That is a broken measurement, not an empty result — fetch origin. Counting it as zero is how ` +
        `this rule would grow the very blind spot it was added to close.`,
    ).toEqual([]);
    if (!carriers.some((c) => c.commits > 0)) {
      // Genuinely nothing to name: every count succeeded and every one came back zero.
      expect(carriers.length).toBeGreaterThan(0);
      return;
    }
    const missing = carriersMissingFromBullet(repoStateBullet(markdown), carriers);
    expect(
      missing,
      `${HANDOFF} does not name ${missing.length} checkout(s) that carry commits origin/main cannot reach: ${missing.join(", ")}. \nA detached checkout has no ref, so no origin-facing audit can see it — this bullet is the only place it can be recorded.`,
    ).toEqual([]);
  });
});
