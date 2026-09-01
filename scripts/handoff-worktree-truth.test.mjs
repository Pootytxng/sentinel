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
//   D. Local only. Every branch the bullet names must CARRY — resolved from `refs/heads/`, never
//      `origin/`. Added 2026-08-29 (#243) after the hole between A and C let the same lie land
//      twice: this repo's landing procedure prunes the remote ref in the same window it lands the
//      PR, so by the time anyone runs rule A the ref is gone and A skips the branch in silence,
//      while C only asks that carriers be named — naming a branch that carries NOTHING violates
//      neither. The local ref survives the remote prune, which is exactly the seam A loses. An
//      unresolvable name and an unmeasurable one both FAIL, for rule C's reason: `catch { 0 }` is
//      how a guard grows the blind spot it was built to close. Consequence the bullet now states:
//      a landed lane's name must leave the bullet in the same train that lands it. Residual,
//      deliberately out of scope here: a checkout named by PATH is judged by C (carriers must be
//      named) but not by D — D reads branch-shaped code spans only, same extractor as A.
//   E. Local only. Every CONTAINMENT claim the handoff makes between two named branches must hold
//      by `git merge-base --is-ancestor`. Added 2026-09-01 after this file shipped
//      "`compy-health-parity` **contains** `compy-visual-recovery-kit-6fd074`" while neither branch
//      contained the other — they share 14 commits and diverge at `c8366609`. A, C and D were all
//      green through it, and structurally had to be: every one of them compares a named branch
//      against `origin/main` and nothing compares two named branches to each other, so a sentence
//      about how two lanes relate was the one shape this guard could not see. The consequence is
//      not cosmetic — "contains" is what tells the next session it may drop one branch and keep the
//      other, and here that would have thrown away ten commits of #225's Health work. Fail-closed
//      like C and D: a name that does not resolve is a FAILURE, never a skipped claim.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const HANDOFF = join("docs", "SESSION_HANDOFF.md");
const DISPOSITIONS = join("docs", "BRANCH_DISPOSITIONS.md");

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
  // A heading ends the bullet. Without this the block ran from the bullet to the next `- **` line
  // THROUGH any section in between, and rule D's fail-closed resolver then read a `docs/…` FILE
  // path quoted in that trailing section as a branch that "does not resolve". Rules A and C only
  // ever skipped such phantoms silently, which is how the over-reach stayed invisible until #243.
  return markdown.split(/\r?\n(?=- \*\*|#{1,6} )/).find((b) => /not on main|NOT on main/.test(b)) ?? null;
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
 * Each carrier also carries its own path, so a quoted path is only allowed to credit the checkout it
 * actually points at — see the matcher below.
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
  // as naming nothing at all. The handoff writes a detached checkout as a worktree path rather than
  // a name, so a path counts — but only a path that is genuinely a tail of that checkout's own.
  const spans = [...(bullet ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  const norm = (span) => span.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const tail = (span) => norm(span).split("/").filter(Boolean).pop() ?? "";
  const named = (c) =>
    spans.some((span) => {
      if (span === c.name) return true;
      // A quoted PATH credits a checkout only when it is genuinely a tail of THAT checkout's own
      // path. Crediting any span whose last segment happens to equal the name would let an
      // unrelated quoted path — a doc, a plan, another lane's file — silently account for a
      // carrier it never identified, which under-reports in exactly the dangerous direction.
      if (!c.path) return false;
      const s = norm(span);
      // The whole path counts as well as a tail of it: that is the raw form `git worktree list`
      // prints, and the handoff bullet tells the next author to re-derive with exactly that
      // command. endsWith alone cannot match it — a string is never a PROPER suffix of itself.
      return s !== "" && (s === norm(c.path) || norm(c.path).endsWith("/" + s)) && tail(s) === c.name.toLowerCase();
    });
  return carriers.filter((c) => c.commits > 0 && !named(c)).map((c) => c.name);
}


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

/**
 * Checkouts whose distance from `origin/main` could not be measured at all. `null` is deliberately
 * not `0`: an unfetched or unresolvable `origin/main` makes every count throw at once, and a
 * `catch { return 0 }` would turn a total measurement failure into "nothing carries anything" —
 * a green rule that never read the handoff. These fail the build instead.
 */
export function unmeasuredCarriers(carriers) {
  return carriers.filter((c) => c.commits === null).map((c) => c.name);
}

/**
 * Rule D's judgment, one branch at a time: a name the bullet presents as work must resolve to a
 * LOCAL ref and carry at least one commit `origin/main` cannot reach. Everything else is a finding,
 * each carrying its reason. Both collaborators are injected so every verdict — including the two
 * fail-closed ones — is falsifiable through the same seam the live rule uses.
 */
export function staleNamedLanes(claimed, resolvesLocally, countAhead) {
  return claimed.flatMap((b) => {
    if (!resolvesLocally(b)) return [{ name: b, why: `refs/heads/${b} does not resolve — the name is not a lane on this machine` }];
    const n = countAhead(`refs/heads/${b}`);
    if (n === null) return [{ name: b, why: "its distance from origin/main could not be measured — broken measurement, not an empty result" }];
    if (n === 0) return [{ name: b, why: "it carries zero commits origin/main cannot reach — the lane has landed" }];
    return [];
  });
}

const localRefExists = (b) => {
  try {
    git("rev-parse", "--verify", "--quiet", `refs/heads/${b}^{commit}`);
    return true;
  } catch {
    return false;
  }
};

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
        path,
        name: branch ?? path.split(/[\\/]/).filter(Boolean).pop(),
        commits: committish ? countAhead(committish) : null,
      };
    })
    .filter((c) => c.name !== "main");
}

const markdown = readFileSync(join(ROOT, HANDOFF), "utf8");

/**
 * The checkout names quoted in the "Spent, at zero" run — the ones a reader is told carry nothing and
 * may therefore be reset or removed without looking again.
 *
 * The run ends at the blank line, never at a `.`: it is a comma list that wraps across lines and has
 * sentences inside its own parentheses ("(#258/#264 both landed out of it)"), so cutting at the first
 * terminator would silently shorten the very list this rule polices and turn a red into a green.
 */
export function spentAtZeroNames(markdown) {
  const m = markdown.match(/Spent, at zero\s*[:—][\s\S]*?(?:\r?\n\s*\r?\n|$)/);
  if (!m) return [];
  return [...m[0].matchAll(/`([^`]+)`/g)].map((x) => x[1]);
}

/**
 * A checkout cannot be spent and a carrier in the same document.
 *
 * bug→guard. This lane wrote `lane/rule-e-negation` into the carrier bullet and left the checkout it
 * lives in — `sentinel-recon-261` — sitting in the same bullet's "Spent, at zero" list. Both halves
 * were individually well-formed, so rules A through E all passed while the paragraph told the next
 * session two opposite things about one folder, the more dangerous of which invites a reset.
 *
 * Matched by DIRECTORY, because that is the unit the two halves disagree about: the carrier list
 * names branches, the spent list names checkouts, and only the path connects them.
 */
export function spentButCarrying(names, carriers) {
  const carryingDirs = new Set(
    carriers
      .filter((c) => (c.commits ?? 0) > 0)
      .map((c) => (c.path ?? "").split(/[\/]/).filter(Boolean).pop())
      .filter(Boolean),
  );
  return names.filter((n) => carryingDirs.has(n));
}

/**
 * Words that turn a containment sentence into its opposite. Read over the SENTENCE the match sits
 * in — never the whole document — because a denial governs its own clause. A rule that let one
 * "not" anywhere above silence every claim below it would be a mute button, not a fix.
 */
const NEGATION = /\b(?:neither|nor|not|never|no|none|cannot|isn't|doesn't|wasn't|without)\b/i;

/**
 * True when a denial governs the span from `start` to `end`.
 *
 * The window opens at the previous sentence terminator, which is the same boundary the NEAR window
 * inside `containmentClaims` already respects — so this cannot reach past a `.` that the match
 * itself could not have crossed. Backticked spans are blanked first: a negation is prose, and a
 * branch that happens to be called `lane/not-landed` must not be able to silence the sentence
 * quoting it.
 */
export function isNegated(text, start, end) {
  const from = text.slice(0, start).search(/[^.!?\n]*$/);
  const window = text.slice(from < 0 ? 0 : from, end).replace(/`[^`]*`/g, " ");
  return NEGATION.test(window);
}

/**
 * Containment claims between two named branches: "`A` contains `B`", "`A` is an ancestor of `B`".
 * Read from the WHOLE document, not the repo-state bullet — the claim that motivated this rule sat
 * in that bullet, but nothing makes that its home, and a rule scoped to one paragraph would miss the
 * next one written anywhere else. Returns {outer, inner, text} with `outer` claimed to CONTAIN
 * `inner`, so both spellings normalise to one direction before the ancestry test.
 */
export function containmentClaims(markdown) {
  // Any backticked token, NOT only prefixed ones. The claim that motivated this rule wrote its two
  // branches bare — `compy-health-parity`, not `claude/compy-health-parity` — so a pattern that
  // demanded the prefix matched nothing and the rule passed while the doc was wrong. Which of these
  // tokens is really a branch is settled later, by whether it resolves; deciding it here by shape is
  // how the first version went inert.
  const B = "`([A-Za-z0-9._/-]{3,})`";
  const NEAR = "[^.\\n]{0,40}?";
  const out = [];
  for (const m of markdown.matchAll(new RegExp(B + NEAR + "\\bcontains\\b" + NEAR + B, "g"))) {
    if (isNegated(markdown, m.index, m.index + m[0].length)) continue;
    out.push({ outer: m[1], inner: m[2], text: m[0] });
  }
  for (const m of markdown.matchAll(
    new RegExp(B + NEAR + "\\bis (?:an ancestor of|contained (?:in|by))\\b" + NEAR + B, "g"),
  )) {
    if (isNegated(markdown, m.index, m.index + m[0].length)) continue;
    out.push({ outer: m[2], inner: m[1], text: m[0] });
  }
  return out.filter((c, i, a) => a.findIndex((o) => o.outer === c.outer && o.inner === c.inner) === i);
}

/** Lane names appear bare in prose. Try the name, then the prefixes this repo actually uses. */
export function resolveLaneName(name, refExists) {
  if (refExists(name)) return name;
  for (const p of ["claude/", "lane/", "feat/", "fix/", "design/", "codex/", "docs/", "recovery/", "salvage/", "chore/"]) {
    if (refExists(p + name)) return p + name;
  }
  return null;
}

export function brokenContainmentClaims(claims, refExists, contains) {
  const broken = [];
  for (const c of claims) {
    const outer = resolveLaneName(c.outer, refExists);
    const inner = resolveLaneName(c.inner, refExists);
    // Neither side resolves to a ref: this sentence is not a branch claim at all (a file path, a
    // directory, a command). Judging it would reproduce the over-reach #243 caught in rule D.
    if (!outer && !inner) continue;
    if (!outer) broken.push({ ...c, why: `${c.outer} does not resolve to a ref in this checkout` });
    else if (!inner) broken.push({ ...c, why: `${c.inner} does not resolve to a ref in this checkout` });
    else if (!contains(outer, inner)) {
      broken.push({ ...c, why: `${outer} does NOT contain ${inner} — git merge-base --is-ancestor says no` });
    }
  }
  return broken;
}

/**
 * Backticked spans that name a Windows path whose drive letter is not followed by a separator —
 * `C:Users\Kuya\...` rather than `C:\Users\Kuya\...`.
 *
 * bug→guard, 2026-09-01. The `lane/rule-e-negation` disposition row shipped its own worktree as
 * `C:UsersKuyacodesentinel-recon-261`: every backslash had been eaten one level down by the shell
 * that wrote the row, and the row read as prose right past review. It is the [[heredocs-eat-one-
 * backslash-level]] failure landing in a doc instead of in a regex.
 *
 * The reason this needs a machine rather than a reader is that the result is *legal*: `C:Users` is a
 * drive-RELATIVE path on Windows, so nothing downstream errors — it silently means "Users under the
 * current directory of drive C:", which is almost never where the thing is. A path that resolves
 * somewhere wrong is worse in a handoff than one that fails loudly, because the next session pastes
 * it, lands somewhere unexpected, and blames the machine.
 *
 * Deliberately a SHAPE check and not an existence check: docs legitimately name checkouts that have
 * since been removed, and a rule that demanded every path still exist would fire on accurate history
 * — the muted-guard failure this file has now hit twice.
 */
export function driveRelativePaths(markdown) {
  return [...markdown.matchAll(/`([A-Za-z]:(?![\\/])[^`\n]*)`/g)].map((m) => m[1]);
}

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
    // A detached checkout is credited by a quoted path that is genuinely a tail of ITS path...
    const ghost = { name: "ghost-c5660e", commits: 4, path: "C:/Users/Kuya/code/sentinel/.claude/worktrees/ghost-c5660e" };
    expect(carriersMissingFromBullet("- **not on main** — `.claude/worktrees/ghost-c5660e`, detached.", [ghost])).toEqual([]);
    // ...and NOT by an unrelated quoted path that merely ends in the same segment.
    expect(carriersMissingFromBullet("- **not on main** — see `docs/notes/ghost-c5660e`.", [ghost])).toEqual(["ghost-c5660e"]);
    // A pasted full path counts — `git worktree list` prints exactly this, and the bullet tells the
    // next author to re-derive with it. Found by the third verification pass, which caught the
    // matcher demanding a PROPER suffix and so false-failing on the one format most likely to be
    // pasted. It failed loud rather than crediting silently, but a guard that cries wolf gets muted.
    expect(carriersMissingFromBullet("- **not on main** — `C:/Users/Kuya/code/sentinel/.claude/worktrees/ghost-c5660e`.", [ghost])).toEqual([]);
    expect(carriersMissingFromBullet("- **not on main** — `C:\\Users\\Kuya\\code\\sentinel\\.claude\\worktrees\\ghost-c5660e`.", [ghost])).toEqual([]);
    // A different checkout's full path still credits nobody.
    expect(carriersMissingFromBullet("- **not on main** — `C:/Users/Kuya/code/sentinel-care89`.", [ghost])).toEqual(["ghost-c5660e"]);
    // An uncountable checkout is a failure, never a zero — the inert path a review caught in rule C.
    expect(unmeasuredCarriers([{ name: "lane/a", commits: 3 }, { name: "ghost", commits: null }])).toEqual(["ghost"]);
    expect(unmeasuredCarriers([{ name: "lane/a", commits: 0 }])).toEqual([]);
    expect(countAheadVia(() => "3")("HEAD")).toBe(3);
    expect(countAheadVia(() => { throw new Error("unknown revision origin/main"); })("HEAD")).toBe(null);
    expect(countAheadVia(() => "")("HEAD")).toBe(null);
    // Rule D, against stubs — every verdict proven to FIRE, so a green run can never mean the
    // parser found nothing. A named local branch that carries zero is the #243 defect itself:
    const stale = staleNamedLanes(["lane/a"], () => true, () => 0);
    expect(stale.map((s) => s.name)).toEqual(["lane/a"]);
    expect(stale[0].why).toMatch(/zero commits/);
    // ...a named local branch that carries is legitimate (the in-flight writing lane's shape):
    expect(staleNamedLanes(["lane/a"], () => true, () => 3)).toEqual([]);
    // ...a name with no local ref FAILS rather than skips — rule A's silent seam, closed:
    expect(staleNamedLanes(["lane/gone"], () => false, () => 3).map((s) => s.name)).toEqual(["lane/gone"]);
    expect(staleNamedLanes(["lane/gone"], () => false, () => 3)[0].why).toMatch(/does not resolve/);
    // ...and a measurement failure FAILS rather than reading as zero, through the same
    // countAheadVia seam the live rule uses:
    const blindCount = countAheadVia(() => { throw new Error("unknown revision origin/main"); });
    expect(staleNamedLanes(["lane/a"], () => true, blindCount)[0].why).toMatch(/could not be measured/);
    // Rule D judges branch-shaped code spans ONLY — a detached checkout is written as a path, which
    // the shared extractor refuses (`.claude/...` is not a branch prefix), so a path-named carrier
    // keeps flowing through rule C untouched:
    expect(branchesClaimedUnmerged("- **not on main** — `.claude/worktrees/ghost-c5660e`, detached.")).toEqual([]);
    // ...and a branch named in a changelog row OUTSIDE the repo-state bullet is not judged at all:
    const historical = "| `a3f3a75b` | landed `lane/old-train` |\n\n- **One carries work that is not on main** — `lane/a`.";
    expect(branchesClaimedUnmerged(historical)).toEqual(["lane/a"]);
    // A heading ENDS the bullet: a `docs/…` file path quoted in the next section must not reach
    // rule D as a "branch", where the fail-closed resolver would flag it as unresolvable.
    const sectioned = "- **One carries work that is not on main** — `lane/a`.\n## Waiting on the owner\nsee `docs/OWNER_ACTION_CHECKLIST.md` §C.";
    expect(branchesClaimedUnmerged(sectioned)).toEqual(["lane/a"]);
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

  it("D: every branch the bullet names still carries — a landed lane's name must leave with it", () => {
    const live = git("worktree", "list", "--porcelain").split(/\r?\n/).filter((l) => l.startsWith("worktree ")).length;
    if (live <= 1) {
      // A one-checkout clone has no local lanes to resolve, exactly as in B and C. Say so out loud.
      expect(live).toBe(1);
      return;
    }
    const claimed = branchesClaimedUnmerged(markdown);
    // Not inert: rule A already insists the bullet names at least one branch; if that ever loosens,
    // this rule must not go quietly green on an empty list.
    expect(claimed.length, `${HANDOFF} names no branches in the repo-state bullet — rule D has nothing to judge.`).toBeGreaterThan(0);
    const countAhead = countAheadVia((committish) => git("rev-list", "--count", `origin/main..${committish}`));
    const found = staleNamedLanes(claimed, localRefExists, countAhead);
    expect(
      found,
      `${HANDOFF} presents these as lanes to preserve, but on this machine they are not:\n` +
        found.map((f) => `  - ${f.name}: ${f.why}`).join("\n") +
        `\nA landed writing lane is never work to preserve — remove its name from the bullet in the same train that lands it.`,
    ).toEqual([]);
  });
  it("E: every containment claim between two branches is true by --is-ancestor", () => {
    const live = git("worktree", "list", "--porcelain").split(/\r?\n/).filter((l) => l.startsWith("worktree ")).length;
    if (live <= 1) {
      // Same reason as B, C and D: a one-checkout clone holds no local lanes to compare.
      expect(live).toBe(1);
      return;
    }
    const claims = containmentClaims(markdown);
    if (claims.length === 0) return; // No claim is a legitimate state — unlike D, this rule has no floor.
    const contains = (outer, inner) => {
      try {
        git("merge-base", "--is-ancestor", inner, outer);
        return true;
      } catch {
        return false;
      }
    };
    const broken = brokenContainmentClaims(claims, localRefExists, contains);
    expect(
      broken,
      `${HANDOFF} claims one branch contains another, and the repository disagrees:\n` +
        broken.map((b) => `  - ${b.why}\n      in: ${b.text}`).join("\n") +
        `\n"Contains" is what tells the next session it may drop one branch and keep the other. ` +
        `Re-derive it with git merge-base --is-ancestor <inner> <outer>, or say "share N commits, ` +
        `diverging at <sha>" instead — which is what two lanes that merely overlap actually do.`,
    ).toEqual([]);
  });

  it("E: a sentence that DENIES containment is not a claim to check", () => {
    // bug→guard. Rule E read "neither `A` contains `B`" as an assertion that `A` contains `B` and
    // reported BROKEN on prose that was TRUE. A false positive is the one failure mode that gets a
    // guard muted rather than obeyed, so it is worse here than a miss: the rule survives only as
    // long as a red run means something is actually wrong.
    //
    // It slipped through because the match window is `[^.\n]{0,40}?` on either side of "contains",
    // and a negation is small enough to sit inside that window without disturbing the match. The
    // window read for negation is the SENTENCE the match sits in — from the previous terminator to
    // the end of the match — which is the same boundary the NEAR window already respects.
    const A = "compy-health-parity";
    const B = "compy-visual-recovery-kit-6fd074";

    // The three shapes the doc actually writes: negation before the first token, between the token
    // and the verb, and governing an ancestry phrasing from the front of the sentence.
    expect(containmentClaims(`Neither \`${A}\` contains \`${B}\` nor the reverse.`)).toEqual([]);
    expect(containmentClaims(`\`main\` no longer contains \`${A}\`.`)).toEqual([]);
    expect(containmentClaims(`It is not true that \`${A}\` is contained in \`main\`.`)).toEqual([]);

    // ...and the affirmative forms still fire, or the fix would have disarmed the rule rather than
    // corrected it. Both spellings, since they normalise through different branches.
    expect(containmentClaims(`\`main\` contains \`${A}\`.`).map((c) => `${c.outer}>${c.inner}`)).toEqual([`main>${A}`]);
    expect(containmentClaims(`\`${A}\` is an ancestor of \`main\`.`).map((c) => `${c.outer}>${c.inner}`)).toEqual([
      `main>${A}`,
    ]);

    // A denial in a NEIGHBOURING sentence must not silence a real claim. Without the sentence bound
    // the fix would be a mute button: one "not" anywhere above would clear every claim below it.
    expect(
      containmentClaims(`\`main\` is not an ancestor of \`${B}\`. \`main\` contains \`${A}\`.`).map((c) => c.inner),
    ).toEqual([A]);

    // A negation is prose, never part of a name. Backticked spans are blanked before the test, so a
    // branch that happens to be called `lane/not-landed` cannot silence the sentence quoting it.
    expect(containmentClaims("`main` contains `lane/not-landed`.").map((c) => c.inner)).toEqual(["lane/not-landed"]);
    expect(isNegated("plain prose", 0, 11)).toBe(false);
  });

  it("F: no checkout is called spent in the same breath as it is called a carrier", () => {
    // bug→guard, and the bug was mine: this lane named `lane/rule-e-negation` as a carrier while
    // leaving `sentinel-recon-261`, the checkout it lives in, in the same bullet's spent list. Rules
    // A–E all passed — each half is well-formed on its own — so one paragraph told the next session
    // two opposite things about one folder, and the more dangerous half invites a hard reset.
    //
    // Found by session `sentinel-21` reading the pushed branch, not by a gate. That is the whole
    // argument for the rule: a contradiction between two lists is invisible to any check that reads
    // one list at a time.
    const carriers = [
      { name: "lane/rule-e-negation", commits: 12, path: "C:/Users/Kuya/code/sentinel-recon-261" },
      { name: "lane/spent", commits: 0, path: "C:/Users/Kuya/code/sentinel-release-truth-256" },
    ];
    expect(spentAtZeroNames("Spent, at zero: `a`, `b`.\n\n`c` is elsewhere.")).toEqual(["a", "b"]);
    // The em-dash spelling is the one this document actually uses after the fix, and the run must
    // still stop at the blank line rather than at the `.` inside its own parentheses.
    expect(spentAtZeroNames("Spent, at zero — `a` (landed out of it), `b`.\n\nnext")).toEqual(["a", "b"]);
    expect(spentAtZeroNames("No such list here.")).toEqual([]);

    // The exact defect, caught.
    expect(spentButCarrying(["sentinel-recon-261"], carriers)).toEqual(["sentinel-recon-261"]);
    // A genuinely spent checkout is not flagged — a rule that fires on the whole list is a rule that
    // gets the list deleted.
    expect(spentButCarrying(["sentinel-release-truth-256"], carriers)).toEqual([]);
    // An unmeasured carrier (null commits, the unfetched-origin case rule C models) is not evidence
    // of carrying, so it must not manufacture a contradiction either.
    expect(spentButCarrying(["x"], [{ name: "l", commits: null, path: "/tmp/x" }])).toEqual([]);

    const list = git("worktree", "list", "--porcelain");
    const live = list.split(/\r?\n/).filter((l) => l.startsWith("worktree ")).length;
    if (live <= 1) {
      expect(live).toBe(1);
      return;
    }
    const countAhead = countAheadVia((committish) => git("rev-list", "--count", `origin/main..${committish}`));
    const contradictions = spentButCarrying(spentAtZeroNames(markdown), liveCarriers(list, countAhead));
    expect(
      contradictions,
      `${HANDOFF} lists these checkouts as spent while their branches carry commits origin/main cannot ` +
        `reach:\n  - ${contradictions.join("\n  - ")}\nOne of the two statements is wrong, and the spent ` +
        `one is the dangerous direction — it tells the next session the folder is safe to reset.`,
    ).toEqual([]);
  });

  it("G: a worktree path keeps its separators — `C:Users…` is a different folder from `C:\\Users\\…`", () => {
    // The exact defect, caught: the row this lane added, as it was first pushed.
    expect(driveRelativePaths("worktree `C:UsersKuyacodesentinel-recon-261`, issue #295")).toEqual([
      "C:UsersKuyacodesentinel-recon-261",
    ]);
    // Both real spellings survive, or the rule would fire on every correct path in the file.
    expect(driveRelativePaths("worktree `C:\\Users\\Kuya\\code\\sentinel-recon-261`")).toEqual([]);
    expect(driveRelativePaths("worktree `C:/Users/Kuya/code/sentinel-recon-261`")).toEqual([]);
    // Unbackticked prose is not a path claim, and a bare drive is not one either.
    expect(driveRelativePaths("C:UsersKuya without backticks is prose, not a cited path")).toEqual([]);

    for (const doc of [HANDOFF, DISPOSITIONS]) {
      const mangled = driveRelativePaths(readFileSync(join(ROOT, doc), "utf8"));
      expect(
        mangled,
        `${doc} cites a path whose drive letter has no separator after it:\n  - ${mangled.join("\n  - ")}\n` +
          "Windows reads that as drive-RELATIVE, so it resolves somewhere real and wrong rather than " +
          "failing. Almost always a shell ate the backslashes — write the row with a file tool, not a heredoc.",
      ).toEqual([]);
    }
  });
});
