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
//   C. Local only. Every checkout holding commits NO REMOTE CARRIES must be named, whether or not
//      it has a branch. Added 2026-08-26 after a detached checkout holding four commits sat unnamed
//      for fifteen days with A and B both green — A only judges branches the doc already names, and
//      B only counts. Its own inert path is the one a review caught next: if a ref cannot be
//      resolved, every count throws at once, and reading that as "no carriers" would reproduce this
//      exact defect one level down. An uncountable checkout is therefore a FAILURE, never a zero.
//
//      NARROWED 2026-09-01 (#312) from "ahead of `origin/main`" to "on no remote", which is a
//      different question and the one this rule was always asking. Measured on this machine the day
//      it changed: THIRTEEN checkouts were ahead of `origin/main` and the bullet had to list all
//      thirteen, but exactly ONE held anything that could actually be lost —
//      `compy-visual-recovery-kit-6fd074`, carrying `cdd976f3` on no remote. Twelve were fully
//      pushed: delete those worktrees and nothing goes with them.
//
//      Two defects came out of that, and the second is the serious one. First, the rule could not be
//      jointly satisfied: every lane carries its own copy of the handoff, so each had to name every
//      OTHER lane, and creating one lane reddened all the rest — with more than one lane open it was
//      impossible for all of them to be green at once, which is serialization rather than truth.
//      Second, and worse: the one checkout that COULD lose work sat inside a list of thirteen
//      reading exactly like the twelve that could not. The rule was green on it. A guard that
//      enforces the listing of things that cannot be lost, while giving no signal about the one that
//      can, is louder than silence and no more informative.
//
//      The narrowing is not a mute, and the test it was held to is the one that matters: does it
//      still catch the defect that MOTIVATED rule C? It does — a detached checkout's commits are on
//      no remote either, so the fifteen-day case still fires. It still fires on an unpushed branch,
//      and on a pushed lane whose worktree has drifted ahead of what it pushed. It stops firing only
//      on a lane that is fully pushed, which is not a loss risk and is already enumerated by
//      `scripts/branch-disposition-audit.test.mjs`, which requires a disposition row per `origin`
//      ref. That duplication was the whole cost. The ahead-of-`origin/main` count is still taken and
//      still reported — the bullet MAY list everything, it is merely no longer failed for not doing
//      so.
//
//      HOW "on no remote" IS MEASURED, and it is not the obvious way. The first cut of this used
//      `rev-list --not --remotes` and would have shipped a fail-OPEN rule. `--remotes` is the last
//      FETCH, not origin: a ref origin has since pruned but the local cache still holds excludes
//      commits that exist nowhere else, so the count returns 0 for the one checkout holding the only
//      copy. The peer review on #312 reproduced it in a scratch repo and pointed out it is this
//      repo's ROUTINE post-merge sequence — land the PR, prune the ref on origin — not a narrow
//      path, which is what the first draft of this paragraph wrongly called it. It is also the exact
//      confusion `scripts/branch-disposition-audit.mjs` names at its line 122.
//
//      So the exclusion set is built from `ls-remote --heads origin` — what origin HAS right now —
//      intersected with the cache. Cached refs origin no longer has are simply not trusted. A cache
//      that is merely BEHIND stays safe in the other direction: an older sha excludes less, so the
//      at-risk set over-reports, and over-reporting only ever asks for one more name in the bullet.
//
//      When origin cannot be reached at all, this rule FAILS AS UNMEASURED. It does not fall back
//      to naming every checkout ahead of `origin/main`, which is what the first cut of #312 did.
//      That fallback really was fail-closed — the peer review drove both paths over this machine's
//      porcelain and confirmed the offline set is a strict superset, 14 names covering the 2 real
//      ones, with no counterexample and no deadlock against rules A and D. It is still the wrong
//      failure: it reds while blaming the handoff for eleven names that are every one of them fully
//      pushed, and the next session spends its budget chasing refs that cannot be lost. A rule that
//      cannot make its measurement says exactly that instead. So rule C REQUIRES a reachable origin
//      on a multi-checkout fleet; a single-checkout clone (CI) returns at the `live <= 1` branch
//      long before this, and the pre-push gate that actually matters always has a network.
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

const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
// Reaching origin is the one thing in this file that leaves the machine, so it is the one call that
// gets a deadline: a remote that hangs must read as unreachable, never as a slow guard.
const TALK_TO_ORIGIN = { cwd: ROOT, encoding: "utf8", timeout: 10_000 };

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
 * Checkouts EITHER of whose distances could not be measured. `null` is deliberately not `0`: an
 * unfetched or unresolvable ref makes every count throw at once, and a `catch { return 0 }` would
 * turn a total measurement failure into "nothing carries anything" — a green rule that never read
 * the handoff. These fail the build instead.
 *
 * The test is `typeof !== "number"`, not `=== null`, and that is not pedantry. Rule C now fails on
 * the `unpushed` count, so a carrier object built without one carries `undefined` there; against
 * `=== null` that reads as measured, and `undefined > 0` then quietly excuses it from being named.
 * Absent and unmeasurable are the same fact — nobody counted — and both have to fail here.
 */
export function unmeasuredCarriers(carriers) {
  return carriers
    .filter((c) => typeof c.commits !== "number" || typeof c.unpushed !== "number")
    .map((c) => c.name);
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
 * `git worktree list --porcelain` -> [{ name, commits, unpushed }]. TWO counts, because they answer
 * two different questions and rule C needs them apart: `commits` is distance from `origin/main`
 * (does this checkout still have a purpose), `unpushed` is distance from every remote (can this
 * work be LOST). Exported so the TOTAL-measurement-failure path can be falsified against the real
 * porcelain of this machine rather than only against a stub: pass a counter that throws and every
 * carrier must come back unmeasured, never zero.
 */
export function liveCarriers(list, countAhead, countUnpushed) {
  // Both runners are required, and the throw is the point. An optional second counter would arrive
  // as `undefined` wherever a caller forgot it, `undefined > 0` is false, and rule C would then have
  // nothing to name and go green — the exact inert shape a review already caught in this rule once.
  if (typeof countAhead !== "function" || typeof countUnpushed !== "function") {
    throw new Error("liveCarriers needs both an ahead-of-main and an unpushed counter");
  }
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
        unpushed: committish ? countUnpushed(committish) : null,
      };
    })
    .filter((c) => c.name !== "main");
}

/**
 * The carriers rule C FAILS on: the ones holding commits that exist nowhere but this disk.
 *
 * `unpushed > 0` implies `commits > 0` — a commit no remote carries is not on `origin/main` either,
 * `origin/main` being a remote ref — so this is a strict subset of the reported carriers, and the
 * naming matcher's own `commits > 0` filter stays a harmless no-op over it rather than a second
 * opinion that could disagree with this one.
 */
export function atRiskCarriers(carriers, trusted) {
  // #312 F5. `null` means origin could not be asked, and the first cut of #312 answered that by
  // falling back to "name every checkout ahead of origin/main". That is fail-closed in the strict
  // sense — the peer review measured it as a superset, 14 names covering the 2 real ones — but it
  // fails by blaming the handoff for names that are every one of them fully pushed. The refusal is
  // the point: an unmeasured origin must not be convertible into a list of names, in this rule or
  // in any later caller that no longer remembers why.
  if (trusted !== null && !Array.isArray(trusted)) {
    throw new Error("atRiskCarriers needs the trusted exclusion set, or an explicit null (#312 F5)");
  }
  if (trusted === null) {
    throw new Error(
      "atRiskCarriers refuses to name carriers without a trusted exclusion set (#312 F5): origin " +
        "could not be asked, so nothing here distinguishes a commit that exists only on this disk " +
        "from one origin already has. Report the unmeasured origin; do not name branches.",
    );
  }
  return carriers.filter((c) => c.unpushed > 0);
}

/**
 * origin's branch names as origin currently reports them. `null` means origin could not be asked.
 *
 * WHY THIS EXISTS, and it is the correction that kept #312 from shipping a fail-OPEN rule. The
 * obvious way to ask "is this commit on a remote" is `rev-list --not --remotes`, but `--remotes`
 * reads `refs/remotes/*`, which is the last FETCH, not origin. A ref origin no longer has but the
 * local cache still holds excludes commits that exist nowhere else — the count comes back 0 and the
 * checkout holding the only copy reports clean.
 *
 * That is not a hypothetical: it is this repo's routine post-merge sequence. Land the PR, prune the
 * ref on origin, and any checkout still sitting on that lane is now laundered to zero until someone
 * fetches with `--prune`. Caught by the peer review on #312, which reproduced it in a scratch repo,
 * and it is the same confusion `scripts/branch-disposition-audit.mjs` names at its own line 122 —
 * reading an unfetched ref cache as the remote is what that whole file exists to stop.
 *
 * An empty answer is `null`, not "origin has no branches": origin always has at least `main`, so an
 * empty read is a broken measurement, and this file's standing rule is that those never read as
 * clean.
 */
export function originHeads(runner) {
  try {
    const names = String(runner())
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split(/\s+/)[1])
      .filter(Boolean)
      .map((ref) => ref.replace(/^refs\/heads\//, ""));
    return names.length ? names : null;
  } catch {
    return null;
  }
}

/**
 * The remote-tracking refs it is SOUND to exclude: the cached ones origin still has. `null` when
 * origin could not be asked, or when the intersection is empty — both mean "no trustworthy
 * exclusion set", and the caller falls back to the stricter pre-#312 measurement rather than
 * excluding nothing and calling every checkout at risk.
 *
 * Only the cache having a ref origin LACKS is dangerous. The cache being BEHIND origin is safe in
 * the other direction: an older cached sha excludes less, so the at-risk count over-reports, and
 * over-reporting only ever asks for another name in the bullet.
 *
 * Out of scope and stated rather than silently assumed: a cached ref whose sha origin has FORCE-
 * REPLACED shares a name with a live ref and passes this check while pointing at commits origin may
 * no longer reach. Nothing local can distinguish that from a stale-but-ancestral cache, and
 * force-pushing is owner-gated in this repo, so it is supervised rather than routine.
 */
export function trustedExclusions(cachedTrackingRefs, liveOriginHeads) {
  if (liveOriginHeads === null) return null;
  const live = new Set(liveOriginHeads);
  const trusted = cachedTrackingRefs
    .filter((ref) => ref !== "origin" && ref !== "origin/HEAD")
    .filter((ref) => live.has(ref.replace(/^origin\//, "")));
  return trusted.length ? trusted : null;
}

const markdown = readFileSync(join(ROOT, HANDOFF), "utf8");

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
    out.push({ outer: m[1], inner: m[2], text: m[0] });
  }
  for (const m of markdown.matchAll(
    new RegExp(B + NEAR + "\\bis (?:an ancestor of|contained (?:in|by))\\b" + NEAR + B, "g"),
  )) {
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
    expect(unmeasuredCarriers([{ name: "lane/a", commits: 3, unpushed: 0 }, { name: "ghost", commits: null, unpushed: null }])).toEqual(["ghost"]);
    expect(unmeasuredCarriers([{ name: "lane/a", commits: 0, unpushed: 0 }])).toEqual([]);
    // EITHER count missing is unmeasured. The second line is the #312 seam specifically: a carrier
    // built with no unpushed count at all must fail here, because `undefined > 0` is false and would
    // otherwise excuse it from being named — absent and unmeasurable are the same fact.
    expect(unmeasuredCarriers([{ name: "half", commits: 3, unpushed: null }])).toEqual(["half"]);
    expect(unmeasuredCarriers([{ name: "half", commits: 3 }])).toEqual(["half"]);

    // #312, the three cases the narrowing owes. Rule C now fails on what no remote carries, so each
    // verdict is proven to fire rather than described.
    // 1. A DETACHED checkout holding commits on no remote — the 2026-08-26 defect that motivated
    //    rule C in the first place. If this stopped firing, the narrowing would be a mute.
    // The exclusion set each case below was measured against. Mandatory after #312 F5, so every
    // case has to say which measurement produced it rather than leaving that implied.
    const ORIGIN_REFS = ["origin/main"];
    expect(
      atRiskCarriers([{ name: "ghost-c5660e", commits: 4, unpushed: 4 }], ORIGIN_REFS).map((c) => c.name),
    ).toEqual(["ghost-c5660e"]);
    // 2. A fully-pushed lane. Ahead of main, but every commit is on a remote, so deleting the
    //    worktree loses nothing and the bullet is not owed its name. This is the twelve-of-thirteen
    //    case that generated the treadmill.
    expect(atRiskCarriers([{ name: "lane/pushed", commits: 12, unpushed: 0 }], ORIGIN_REFS)).toEqual([]);
    // 3. A pushed lane whose worktree has DRIFTED ahead of what it pushed. The commits on top are on
    //    no remote, so it fires — this is the case a naive "does the branch exist on origin" test
    //    would have missed, and it is why the measurement is per-commit and not per-ref.
    expect(
      atRiskCarriers([{ name: "lane/drifted", commits: 14, unpushed: 2 }], ORIGIN_REFS).map((c) => c.name),
    ).toEqual(["lane/drifted"]);
    // #312 F5, the reason that second argument exists. An unmeasured origin is not a quiet zero,
    // and it is not "name everything ahead of main" either — both hand the next session a wrong
    // cause. This carrier WOULD have been named under the removed fallback; it must throw instead.
    expect(() => atRiskCarriers([{ name: "lane/pushed", commits: 12, unpushed: 12 }], null)).toThrow(
      /without a trusted exclusion set/,
    );
    // And a caller that simply forgets the argument must not read as "measured, nothing at risk" —
    // the optional-argument hole this file already closed once, one level up in `liveCarriers`.
    expect(() => atRiskCarriers([{ name: "lane/pushed", commits: 12, unpushed: 12 }])).toThrow(
      /needs the trusted exclusion set/,
    );
    // An at-risk carrier the bullet does not name is still a finding; a named one still is not.
    expect(
      carriersMissingFromBullet(bullet, atRiskCarriers([{ name: "lane/a", commits: 3, unpushed: 3 }], ORIGIN_REFS)),
    ).toEqual([]);
    expect(
      carriersMissingFromBullet(
        bullet,
        atRiskCarriers([{ name: "ghost-c5660e", commits: 4, unpushed: 1 }], ORIGIN_REFS),
      ),
    ).toEqual(["ghost-c5660e"]);
    // Both counters are mandatory. An optional second one would arrive as `undefined` from any
    // caller that forgot it and silently empty the failing set — the inert shape, one level down.
    expect(() => liveCarriers("worktree /w/a\nbranch refs/heads/lane/a\n", () => 3)).toThrow(/both an ahead-of-main and an unpushed counter/);
    expect(() => liveCarriers("worktree /w/a\nbranch refs/heads/lane/a\n", () => 3, () => 0)).not.toThrow();

    // #312 F1 — the fail-OPEN this rule would have shipped, caught by the peer review and pinned
    // here so it cannot come back. The exclusion set must come from what origin HAS, never from the
    // local ref cache, because our own post-merge sequence prunes refs on origin and leaves the
    // cache holding them.
    const lsRemote = "abc123\trefs/heads/main\ndef456\trefs/heads/lane/live\n";
    expect(originHeads(() => lsRemote)).toEqual(["main", "lane/live"]);
    // Origin unreachable, and an EMPTY answer, are both "nobody measured" — never "origin has none".
    expect(originHeads(() => { throw new Error("Could not read from remote repository"); })).toBe(null);
    expect(originHeads(() => "")).toBe(null);
    // The lingering ref: cached because it was fetched once, pruned at origin since. It is the one
    // shape that must NOT be excluded, or a checkout sitting on it reports zero while holding the
    // only copy of that work.
    const cached = ["origin", "origin/HEAD", "origin/main", "origin/lane/live", "origin/lane/pruned"];
    expect(trustedExclusions(cached, ["main", "lane/live"])).toEqual(["origin/main", "origin/lane/live"]);
    // Offline is not an exclusion set of zero — that would make `rev-list --not` exclude nothing and
    // call every checkout at risk. `null` sends the caller to the strict fallback instead.
    expect(trustedExclusions(cached, null)).toBe(null);
    // Nothing in common is the same answer, for the same reason.
    expect(trustedExclusions(["origin/lane/pruned"], ["main"])).toBe(null);
    // `origin` and `origin/HEAD` are renderings of the symbolic default ref, not branches to trust.
    expect(trustedExclusions(["origin", "origin/HEAD"], ["main"])).toBe(null);
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
    // Memoised because this rule counts the same committish up to three times — once for the live
    // carriers, once for the unpushed shortcut, once for the half-blind falsification — and each
    // repeat is a real subprocess on a 32-checkout fleet. Pure within a run: nothing here writes.
    const aheadCache = new Map();
    const countAheadOnce = countAheadVia((committish) => git("rev-list", "--count", `origin/main..${committish}`));
    const countAhead = (committish) => {
      if (!aheadCache.has(committish)) aheadCache.set(committish, countAheadOnce(committish));
      return aheadCache.get(committish);
    };

    // The loss question, and the only one this rule fails on. The exclusion set is NOT `--remotes`:
    // that is the last fetch, and a pruned-at-origin ref lingering in it laundries genuinely
    // unpushed commits to zero — see `originHeads` above for the measured reproduction.
    const cached = git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin")
      .split(/\r?\n/)
      .filter(Boolean);
    // Bounded: an origin that hangs rather than refusing would otherwise eat this test's whole
    // budget and time out, which reads as a broken guard instead of an unreachable remote.
    const trusted = trustedExclusions(
      cached,
      originHeads(() => execFileSync("git", ["ls-remote", "--heads", "origin"], TALK_TO_ORIGIN).trim()),
    );
    // Offline, or no cached ref origin still has. The pre-#312 fallback named every checkout ahead
    // of origin/main here; #312 F5 removed it. See the rule header — it is fail-closed but it fails
    // by blaming the doc for names that cannot be lost, and a wrong cause costs more than a red.
    expect(
      trusted,
      `rule C cannot reach origin, so it cannot tell a commit that exists only on this disk from one ` +
        `origin already has — which is the only question this rule asks. It deliberately does NOT ` +
        `fall back to naming every checkout ahead of origin/main (#312 F5): that is strictly more ` +
        `naming and so fail-closed, but it reds while blaming ${HANDOFF} for names that are every ` +
        `one of them fully pushed. Fetch origin and re-run.`,
    ).not.toBeNull();
    // The shortcut below is a theorem, not a guess, and this is its premise: origin/main is one of
    // the trusted refs, so a checkout holding nothing beyond origin/main holds nothing beyond the
    // superset either. Asserted rather than assumed — if it ever stops holding, the shortcut would
    // silently start reporting unmeasured carriers as safe.
    expect(
      trusted,
      "rule C's ahead-of-main shortcut is only sound while origin/main is trusted; it is not.",
    ).toContain("origin/main");
    const countUnpushedVia = countAheadVia((committish) =>
      git("rev-list", "--count", committish, "--not", ...trusted),
    );
    // Skip the second subprocess for the checkouts the first count already settled. On this fleet
    // that is 18 of 32, and with the memoised ahead-count above it takes rule C from 96 git spawns
    // to 46 — the cost that timed this test out at 18.2s against vitest's 15s default when the
    // second counter was added, blocking the very push that carries the fix.
    const countUnpushed = (committish) => (countAhead(committish) === 0 ? 0 : countUnpushedVia(committish));
    const carriers = liveCarriers(list, countAhead, countUnpushed);
    // The inert path, falsified LIVE rather than merely described: the same porcelain, counted by a
    // runner that fails the way an unfetched ref fails, must come back unmeasured. The second line
    // is the shape this rule shipped with and a review caught — every carrier reading as spent, so
    // the rule names nothing and goes green without ever opening the handoff. BOTH counters are
    // blinded in turn, because after #312 a working ahead-count with a broken unpushed-count would
    // produce exactly that same green silence through the newer of the two seams.
    const throws = countAheadVia(() => { throw new Error("unknown revision"); });
    const blind = liveCarriers(list, throws, throws);
    expect(blind.length).toBeGreaterThan(0);
    expect(unmeasuredCarriers(blind).length).toBe(blind.length);
    expect(carriersMissingFromBullet("", blind)).toEqual([]);
    expect(atRiskCarriers(blind, trusted)).toEqual([]);
    const halfBlind = liveCarriers(list, countAhead, throws);
    expect(unmeasuredCarriers(halfBlind).length).toBe(halfBlind.length);
    expect(atRiskCarriers(halfBlind, trusted)).toEqual([]);
    // The inert path FIRST. If origin/main cannot be resolved, every count fails at once and a rule
    // that read that as zero would go green without ever opening the handoff.
    const unmeasured = unmeasuredCarriers(carriers);
    expect(
      unmeasured,
      `rule C could not measure ${unmeasured.length} checkout(s) against origin/main: ${unmeasured.join(", ")}. ` +
        `That is a broken measurement, not an empty result — fetch origin. Counting it as zero is how ` +
        `this rule would grow the very blind spot it was added to close.`,
    ).toEqual([]);
    const atRisk = atRiskCarriers(carriers, trusted);

    // The exclusion set, falsified LIVE. Every exempt carrier is exempt BECAUSE some trusted ref
    // covers it, and this proves that ref is doing the work rather than the count being zero for
    // some unrelated reason: drop one carrier's own origin ref — exactly what pruning it at origin
    // does — and its count must rise off zero. Measured 0 -> 5 on `lane/vacuous-guards-304` when
    // this was written. Without this the F1 fix could rot into decoration and the fail-open would
    // come back silently, which is how the first draft of this rule went wrong in the first place.
    {
      const exempt = carriers.find((c) => c.commits > 0 && c.unpushed === 0 && trusted.includes(`origin/${c.name}`));
      if (exempt) {
        const without = trusted.filter((ref) => ref !== `origin/${exempt.name}`);
        const raw = Number(String(git("rev-list", "--count", exempt.name, "--not", ...without)).trim());
        expect(
          raw,
          `dropping origin/${exempt.name} from the trusted set left its unpushed count at ${raw}. ` +
            `The exclusion set is not driving the verdict, so a ref pruned at origin would be ` +
            `silently trusted anyway — the exact fail-open #312 F1 exists to prevent.`,
        ).toBeGreaterThan(0);
      } else {
        console.log("rule C: no exempt carrier on a named origin ref, so the exclusion set is unfalsified this run");
      }
    }
    // Say what the rule DID, every run. A fully-pushed fleet makes the failing set empty, and after
    // #312 that is the common case rather than the exception — an empty set reported as silence
    // would be indistinguishable from a rule that had stopped looking.
    const ahead = carriers.filter((c) => c.commits > 0);
    console.log(
      `rule C: ${carriers.length} checkout(s), ${ahead.length} ahead of origin/main, ` +
        `${ahead.length - atRisk.length} of those fully pushed and exempt, ${atRisk.length} at risk` +
        (atRisk.length ? `: ${atRisk.map((c) => `${c.name} (+${c.unpushed})`).join(", ")}` : ""),
    );
    if (!atRisk.length) {
      // Genuinely nothing to name: every count succeeded, and everything any checkout holds is on a
      // remote. Non-vacuity is still asserted — a carrier list that came back EMPTY would mean the
      // porcelain parser broke, which is a different fact entirely and must not read as safety.
      expect(carriers.length).toBeGreaterThan(0);
      return;
    }
    const missing = carriersMissingFromBullet(repoStateBullet(markdown), atRisk);
    expect(
      missing,
      `${HANDOFF} does not name ${missing.length} checkout(s) holding commits that exist on NO remote: ${missing.join(", ")}. \nThese are the ones that go with the worktree if it is deleted. A detached checkout has no ref, so no origin-facing audit can see it — this bullet is the only place it can be recorded.`,
    ).toEqual([]);
    // Declared, not discovered. This rule walks every checkout on the machine and asks origin one
    // question; under the full 407-file suite that is comfortably past vitest's 15s default, and
    // finding that out from a timeout at the pre-push gate is how the fix nearly failed to ship.
  }, 60_000);

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
});
