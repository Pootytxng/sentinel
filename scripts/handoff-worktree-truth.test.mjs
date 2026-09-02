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
//      lie that reads exactly like the truth. GRACED FOR ONE CYCLE since #333, same mechanism as
//      rule D below (`landedNameIsGraced`) and for the identical reason: this repo does not always
//      prune a merged branch's `origin` ref, so A can fire on the very name rule C just forced a
//      landing lane to write, the instant that lane's own merge lands. See rule D's paragraph for
//      the full account — the trap and the fix are one mechanism serving both rules.
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
//
//      GRACED FOR ONE CYCLE, added after #333 (the third reproduction of the trap this created).
//      C's `unpushed > 0` makes the branch making THIS PUSH itself an at-risk carrier — the commit
//      is on no remote until the push completes — so C refuses the push unless the lane names
//      itself. D then judges that exact name a lie the instant it lands, and nothing inside the
//      SAME lane can remove it: a commit that un-names the branch is still unpushed when C runs
//      against it, so C immediately demands the name back. No ordering of commits in one lane
//      satisfies both rules at once — proven empirically at `5b1e3f9c`, which tried bare deletion
//      and was refused by C naming the in-flight commit itself as at risk.
//
//      The fix is not to stop checking; it is to stop demanding an impossible ordering. D now
//      asks one more question before failing a landed name: is this branch's own history still
//      the FRESHEST thing to have touched the handoff doc, reachable from `origin/main`? Computed
//      the way C already derives its trust — live, from git, never from what the bullet claims —
//      via `git log -1 --format=%H origin/main -- docs/SESSION_HANDOFF.md` and an ancestor check
//      of that commit against the branch's local tip. If nothing has edited the doc since this
//      branch landed, nothing has HAD THE CHANCE to remove its name yet, so this run grants one
//      cycle of grace: reported, not failed. The grace is spent the moment ANY later commit edits
//      the doc again and still leaves the name in place — that later commit's own tip becomes the
//      new freshest editor, the older name's ancestor check now reads false, and D fails it as
//      genuinely stale. This is exactly the #243 shape (a name surviving an editing opportunity)
//      and is why the fix is a narrowing of when D fires, never a loosening of what it accepts:
//      `scripts/handoff-worktree-truth.test.mjs`'s own tests below prove both directions fire —
//      a graced landing is silent, an older stale name (one that has already survived a doc edit)
//      still fails. Self-naming for C is UNCHANGED by this: a lane still must name itself to push;
//      it no longer has to also solve un-naming itself inside the same, impossible, single lane.
//
//      ROUND 2 (PR #335 review, 2026-09-02): round 1 compared the freshest doc editor against the
//      branch's raw TIP, which is only right when the landing merge is clean. A clean merge's
//      result for the doc path is TREESAME to the branch's own edit, so git's history
//      simplification makes `freshestDocEditOnMain` report that edit commit directly — an
//      ancestor of the tip, grace granted. `docs/SESSION_HANDOFF.md` is this repo's documented
//      merge hotspot (13 of 14 concurrent lanes conflict on it), and when the landing merge has to
//      CONFLICT-RESOLVE it, the merge commit's tree for that path matches NEITHER parent, so the
//      merge commit itself is what `git log -1 -- <path>` reports as freshest — and a merge
//      commit is an ancestor of neither of its own parents. Checking ancestry against the raw tip
//      then reads that merge as a stranger and denies grace to a branch that just landed by the
//      only mechanism available to it, reproducing #333 unchanged. Two reviewers converged on
//      this independently; one reproduced it in a scratch repo rather than arguing it.
//
//      The fix compares against the LANDING, not the tip. `landingCommitOf` resolves the earliest
//      commit reachable from `origin/main` that is a descendant of the branch's tip — via
//      `git rev-list --ancestry-path <tip>..origin/main`, oldest entry first-after-tip — which is
//      the merge commit itself for an ordinary merge, or the tip itself when nothing has landed on
//      top of it yet. `landedNameIsGraced` is then asked about THAT commit instead of the raw tip.
//      A clean merge is unaffected: the landing commit's ancestry still contains the branch's own
//      doc edit, so grace is granted the same way as before. A conflict-resolving merge now reads
//      correctly, because the freshest editor (the merge commit) IS the landing commit — equality,
//      no ancestor question needed. The #243 shape this exists to still catch is unchanged: a
//      commit that touches the doc AFTER the landing and leaves the name in place is a strict
//      descendant of the landing commit, never an ancestor of it, so grace is still denied.
//
//      This round also corrects a false claim in commit `0b555277`'s message — "freshest editor
//      is a descendant of the tip -> graced". That is backwards and always was: that shape DENIES
//      grace, per the #243 paragraph two above. The test meant to prove it (this file, ~line 717)
//      shipped with an inverted stub that asserted the wrong answer; it is fixed in the same train
//      as this paragraph, alongside the conflict-merge case above.
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

// The fleet measurement moved to scripts/fleet-snapshot.mjs (#291) so the report a session reads and
// the rule that judges it are one implementation. It used to live here, which meant the only way to
// see the fleet was to run the guard.
import {
  atRiskCarriers,
  countAheadVia,
  liveCarriers,
  originHeads,
  snapshot,
  trustedExclusions,
  unmeasuredCarriers,
} from "./fleet-snapshot.mjs";

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

/**
 * Branch names in backticks inside the bullet that claims work is NOT on main.
 *
 * #310. \`docs\` is both a real branch prefix here and the directory every status doc lives in, so
 * \`docs/BRANCH_DISPOSITIONS.md\` — a path this bullet has every reason to cite, since it is where
 * the refs the bullet stopped enumerating are tracked — parsed as a branch, and rule D reported it
 * as a lane that no longer resolves. The standing workaround was to leave that one path
 * UNBACKTICKED, which is a formatting rule imposed on a doc by a parser bug: the next writer to
 * backtick it correctly reds a gate they did not break. The neighbouring case was already known —
 * see the \`sectioned\` fixture below, where a heading ENDS the bullet — but a heading cannot help
 * when the citation belongs inside the bullet itself.
 *
 * Shape cannot separate the two. Both read \`prefix/name\`, and \`.md\` is a legal ref component, so
 * any extension list is a guess that the first counter-example breaks. What separates them is the
 * repository, which is why the measurement is INJECTED rather than assumed: a token git knows as a
 * path is a path.
 *
 * The default is \`() => false\` so unit callers keep the pure behaviour and no test silently
 * acquires a dependency on a live repo. A branch genuinely sharing its name with a tracked path
 * would be dropped; that costs rule D one name and is the safe direction — the alternative is the
 * gate this defect already produced, red against a doc that is correct.
 */
/**
 * Every branch-shaped code span in a piece of text, minus the ones that are really tracked paths.
 *
 * Split out of `branchesClaimedUnmerged` for #291, because the two callers now want different
 * corpora: rule A still judges only what the repo-state bullet CLAIMS, while rule D bans a lane name
 * anywhere in the handoff at all. Scoping D to the bullet would have left the ban trivially evadable
 * — the bullet is found by the phrase "not on main", so a fleet database written without that
 * sentence would be invisible to the rule that exists to stop fleet databases.
 */
export function laneNamesIn(text, isTrackedPath = () => false) {
  return [...text.matchAll(/`((?:lane|feat|fix|agent|docs|claude|codex|design|tooling|recovery)\/[A-Za-z0-9._/-]+)`/g)]
    .map((m) => m[1])
    .filter((v, i, a) => a.indexOf(v) === i)
    .filter((name) => !isTrackedPath(name));
}

export function branchesClaimedUnmerged(markdown, isTrackedPath = () => false) {
  const bullet = repoStateBullet(markdown);
  if (!bullet) return [];
  return laneNamesIn(bullet, isTrackedPath);
}

/**
 * Which claimed branches have since landed. The ancestry test is injected so the rule can be
 * falsified against a branch that IS merged: every branch on `origin` today carries work, so a live
 * negative control does not exist to write. `resolves` is separate from `isAncestor` on purpose — a
 * ref this checkout has never fetched must not be reported as "not merged", which is how a guard
 * goes quietly inert.
 *
 * #333: `isGraced` grants a landed branch one cycle before A reports it — the same grace as rule D
 * (`landedNameIsGraced`, `staleNamedLanes`), for a reason found live rather than assumed: this
 * repo's merge procedure does NOT always prune a merged branch's `origin` ref (verified against
 * `git ls-remote`: neither `origin/fix/green-main-after-314-332` nor
 * `origin/lane/rule-c-at-risk-312` was pruned after landing), so whenever that ref survives, A
 * resolves it and fires on the SAME name rule D would — issue #333 names both explicitly: "Rule A
 * and D go red on main at exactly that moment." A lane forced by rule C to name itself before
 * pushing cannot also un-name itself before merging; the grace is what makes that not a dead end.
 * Mandatory, not optional-with-a-default, for the reason `atRiskCarriers` already settled: an
 * omitted collaborator must not silently read as "always fresh".
 */
export function landedBranches(claimed, resolves, isAncestor, isGraced) {
  if (typeof isGraced !== "function") {
    throw new Error("landedBranches needs a grace predicate (#333) — omitting it must not read as \"always fresh\"");
  }
  return claimed.filter((b) => resolves(b) && isAncestor(b) && !isGraced(b));
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
 * #333. Whether a landed branch's own local tip is still the FRESHEST thing to have touched the
 * handoff doc, reachable from `origin/main` — i.e. whether anything has had the CHANCE to remove
 * its name since it landed. `freshestDocEdit` is the commit `git log -1 -- <handoff>` returns from
 * `origin/main`; `isAncestorOrEqual` is injected so this is falsifiable without a real repo.
 *
 * Equality is checked before asking the ancestor question so a branch that IS the freshest editor
 * reads true even when the injected ancestor check is a stub that always says no — the two
 * questions are independent and a caller must not have to answer the second to get the first right.
 */
export function landedNameIsGraced(branchTip, freshestDocEdit, isAncestorOrEqual) {
  return branchTip === freshestDocEdit || isAncestorOrEqual(freshestDocEdit, branchTip);
}

/**
 * #333 round 2 (the conflict-merge shape). What `landedNameIsGraced` should be asked about is not
 * the branch's raw tip but its LANDING — the earliest commit reachable from `origin/main` that is
 * a descendant of `tip`. For an ordinary clean merge this makes no difference (see the round-2
 * paragraph on rule D above), but when the landing merge has to conflict-resolve the guarded doc,
 * the merge commit itself becomes the freshest editor, and a merge commit is an ancestor of
 * NEITHER of its parents — so asking about the raw tip reads that merge as a stranger and denies
 * grace to a branch that just landed by the only mechanism available to it.
 *
 * `ancestryPath` is `git rev-list --ancestry-path <tip>..origin/main`'s own output shape: every
 * commit that is both a descendant of `tip` and an ancestor-or-equal of `origin/main`, NEWEST
 * FIRST (git's default order), excluding `tip` itself. The oldest entry — last in that order — is
 * the earliest point after `tip` where `tip`'s work became reachable from `origin/main`: the
 * landing, merge commit or otherwise. An EMPTY path means nothing has landed on top of `tip` yet
 * by this definition, so `tip` is trivially its own landing.
 *
 * Pure and injected-input, like `landedNameIsGraced` itself, so this is falsifiable without a real
 * repo: pass the exact array shape `landingCommitOnMain` builds from `git rev-list`, in the order
 * git prints it.
 */
export function landingCommitOf(tip, ancestryPath) {
  return ancestryPath.length > 0 ? ancestryPath[ancestryPath.length - 1] : tip;
}

/**
 * Rule D's judgment, one branch at a time: a name the bullet presents as work must resolve to a
 * LOCAL ref and carry at least one commit `origin/main` cannot reach. Everything else is a finding,
 * each carrying its reason. All three collaborators are injected so every verdict — including the
 * three fail-closed ones — is falsifiable through the same seam the live rule uses.
 *
 * `isGraced` is mandatory, not optional-with-a-default, for the reason `atRiskCarriers` already
 * settled two rules up: a caller that forgets it must not have the omission silently read as
 * "always fresh", which would turn this rule's landed-name check into decoration. A `landed` name
 * still fails whenever `isGraced` says no — freshly, or because #333's one cycle is already spent.
 */
export function staleNamedLanes(claimed, resolvesLocally, countAhead, isGraced) {
  if (typeof isGraced !== "function") {
    throw new Error("staleNamedLanes needs a grace predicate (#333) — omitting it must not read as \"always fresh\"");
  }
  return claimed.flatMap((b) => {
    if (!resolvesLocally(b)) {
      return [
        {
          name: b,
          why:
            `refs/heads/${b} does not resolve, and it is not a tracked path either — the token is ` +
            "neither a lane on this machine nor a file this bullet can be citing (a renamed or " +
            "archived doc reaches here too, and that is a stale citation, not a missing branch)",
        },
      ];
    }
    const n = countAhead(`refs/heads/${b}`);
    if (n === null) return [{ name: b, why: "its distance from origin/main could not be measured — broken measurement, not an empty result" }];
    if (n === 0) {
      if (isGraced(b)) return [];
      return [{
        name: b,
        why: "it carries zero commits origin/main cannot reach — the lane has landed, and the doc " +
          "has been edited again since without removing it (#333's one cycle of grace is spent)",
      }];
    }
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
 * #310. Does git know this token as a PATH rather than a ref? Two probes, because one is not
 * enough: \`ls-files\` answers for THIS CHECKOUT, and rule D runs in every worktree on the fleet. A
 * doc tracked on \`main\` but absent from whichever lane the guard happens to run in would fail the
 * first probe, fall through to the branch arm, and be reported as a lane that does not resolve —
 * the very false positive #310 exists to remove, one checkout over. That is the \`--remotes\`
 * mistake in a different costume: asking "this checkout" a question about "the repo". Caught by
 * peer review before it shipped; both checkouts agree today, so no run would have exposed it until
 * the first lane that predates or postdates a doc rename.
 *
 * A wholly untracked new doc still parses as a branch. That is narrow, self-correcting the moment
 * it is committed, and the failure text above now names the possibility instead of asserting past
 * it. \`execFileSync\` takes argv directly with no shell, so the \`<ref>:<path>\` form is safe here
 * in a way it is not from a shell.
 */
const isTrackedPath = (token) => {
  const quietly = (args) => {
    try {
      execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      return true;
    } catch {
      return false;
    }
  };
  // A miss is the COMMON case, so stderr is ignored: the shared \`git\` helper would print git's
  // "did not match any file(s)" on every green run, which reads exactly like a failure.
  if (quietly(["ls-files", "--error-unmatch", "--", token])) return true;
  return quietly(["cat-file", "-e", `origin/main:${token.replace(/\/+$/, "")}`]);
};

/**
 * #333, shared by the live A and D tests below: the newest commit reachable from `origin/main`
 * that touched the handoff doc at all, and an ancestor-or-equal test to compare a branch tip
 * against it. `null` means that history could not be read, and must fail closed — no grace handed
 * out — rather than read as "everything is fresh". One function, not duplicated per rule, because
 * the two rules disagree only about WHICH tip to compare (`origin/<b>` for A, `refs/heads/<b>` for
 * D), never about what "fresh" means.
 */
const freshestDocEditOnMain = () => {
  try {
    return git("log", "-1", "--format=%H", "origin/main", "--", "docs/SESSION_HANDOFF.md") || null;
  } catch {
    return null;
  }
};

const isAncestorOrEqual = (a, b) => {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    git("merge-base", "--is-ancestor", a, b);
    return true;
  } catch {
    return false;
  }
};

/**
 * #333 round 2, live wiring for `landingCommitOf`: resolves `tip`'s landing on `origin/main` via
 * `git rev-list --ancestry-path`, which prints newest-first — exactly the shape `landingCommitOf`
 * expects. On a resolution failure (an unreadable `tip`, an origin that cannot be reached) this
 * falls back to `tip` itself rather than inventing a landing point git could not compute — the
 * same fail-toward-the-narrower-behavior choice `freshestDocEditOnMain` makes with `null`, except
 * here there is a safe narrower behavior (round 1's own tip-based check) to fall back to instead
 * of failing closed outright.
 */
const landingCommitOnMain = (tip) => {
  try {
    const raw = git("rev-list", "--ancestry-path", `${tip}..origin/main`);
    const path = raw ? raw.split(/\r?\n/).filter(Boolean) : [];
    return landingCommitOf(tip, path);
  } catch {
    return tip;
  }
};





/**
 * Test-only. Builds a real (if tiny) ancestor-or-equal check from an explicit descendant map, so a
 * stub's ancestry direction is derived from ONE set of "this commit's real descendants" facts
 * instead of separate hand-tuned booleans that can silently disagree with each other — which is
 * exactly how PR #335's round 1 shipped an inverted stub: `landedNameIsGraced("staleTip",
 * "newerLaneTip", stub)` asserted `true` for a shape its own adjacent comment called "the grace is
 * spent". `descendantsOf[c]` must list every commit reachable by walking forward from `c` (real
 * git parent/child direction — a descendant is never its own ancestor's ancestor); asking "is `a`
 * an ancestor of `b`" then reduces to "does `descendantsOf[a]` contain `b`", the same direction
 * `git merge-base --is-ancestor a b` answers, never the reverse.
 */
function fakeIsAncestorOrEqual(descendantsOf) {
  return (a, b) => a === b || (descendantsOf[a] ?? []).includes(b);
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
    const neverGraced = () => false;
    expect(landedBranches(["lane/a", "feat/b"], all, (b) => b === "feat/b", neverGraced)).toEqual(["feat/b"]);
    expect(landedBranches(["lane/a"], all, () => false, neverGraced)).toEqual([]);
    // An unfetched ref is unknown, not clean.
    expect(landedBranches(["lane/a"], () => false, all, neverGraced)).toEqual([]);
    // #333: a landed branch graced this cycle is not reported, same mechanism as rule D below —
    // proven here too so a rule A that always grants grace cannot hide behind rule D's own tests.
    expect(landedBranches(["lane/a"], all, all, () => true)).toEqual([]);
    expect(landedBranches(["lane/a"], all, all, neverGraced)).toEqual(["lane/a"]);
    // isGraced is mandatory (#333), the same shape as staleNamedLanes' own requirement.
    expect(() => landedBranches(["lane/a"], all, all)).toThrow(/needs a grace predicate/);
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
    // parser found nothing. A named local branch that carries zero, with no grace on offer, is the
    // #243 defect itself:
    const alwaysStale = () => false;
    const stale = staleNamedLanes(["lane/a"], () => true, () => 0, alwaysStale);
    expect(stale.map((s) => s.name)).toEqual(["lane/a"]);
    expect(stale[0].why).toMatch(/zero commits/);
    // ...a named local branch that carries is legitimate (the in-flight writing lane's shape) —
    // isGraced is not even consulted, since countAhead never reaches zero:
    expect(staleNamedLanes(["lane/a"], () => true, () => 3, alwaysStale)).toEqual([]);
    // ...a name with no local ref FAILS rather than skips — rule A's silent seam, closed:
    expect(staleNamedLanes(["lane/gone"], () => false, () => 3, alwaysStale).map((s) => s.name)).toEqual(["lane/gone"]);
    expect(staleNamedLanes(["lane/gone"], () => false, () => 3, alwaysStale)[0].why).toMatch(/does not resolve/);
    // ...and a measurement failure FAILS rather than reading as zero, through the same
    // countAheadVia seam the live rule uses:
    const blindCount = countAheadVia(() => { throw new Error("unknown revision origin/main"); });
    expect(staleNamedLanes(["lane/a"], () => true, blindCount, alwaysStale)[0].why).toMatch(/could not be measured/);
    // isGraced is mandatory (#333) — an omitted collaborator must not silently read as "always
    // fresh", the same shape atRiskCarriers already refuses two rules up.
    expect(() => staleNamedLanes(["lane/a"], () => true, () => 0)).toThrow(/needs a grace predicate/);

    // #333: the grace mechanism itself, proven BOTH directions so a rule D that always grants
    // grace (a deletion wearing this fix's disguise) fails here, not on the owner's machine in
    // three weeks. `landedNameIsGraced` first, against stubs:
    const noBranchIsAncestor = () => false;
    // A branch's own tip IS the freshest doc editor: graced without even asking the ancestor
    // question — equality alone must be enough.
    expect(landedNameIsGraced("sameTip", "sameTip", noBranchIsAncestor)).toBe(true);
    // The freshest editor is a DESCENDANT of this branch's tip (something newer touched the doc):
    // the grace is spent, this is the #243 shape. PR #335 round 1 shipped this exact assertion
    // inverted (`.toBe(true)`, against a stub hand-tuned to agree with the wrong answer) — the
    // ancestor check is modeled here from an explicit descendant fact (staleTip is an ancestor of
    // newerLaneTip, never the reverse) via `fakeIsAncestorOrEqual` instead, so the direction cannot
    // be fudged per-assertion the way a one-off boolean was.
    const staleLineage = fakeIsAncestorOrEqual({ staleTip: ["newerLaneTip"] });
    expect(landedNameIsGraced("staleTip", "newerLaneTip", staleLineage)).toBe(false);
    expect(landedNameIsGraced("staleTip", "unrelatedTip", noBranchIsAncestor)).toBe(false);
    // Threaded end to end through staleNamedLanes: a just-landed lane reads as no finding at all —
    // this is the "just landed" case the fix exists to stop failing...
    const justLanded = (b) => landedNameIsGraced(`refs/heads/${b}`, `refs/heads/${b}`, noBranchIsAncestor);
    expect(staleNamedLanes(["fix/repair-lane"], () => true, () => 0, justLanded)).toEqual([]);
    // ...while a name that survived an editing opportunity — the freshest doc edit is reachable
    // FROM this branch's tip but is not itself this branch's tip, i.e. someone else touched the
    // doc since and still left the name in place — still fails, with a why that says so.
    const goneStale = () => false;
    const stillStale = staleNamedLanes(["lane/old-and-forgotten"], () => true, () => 0, goneStale);
    expect(stillStale.map((s) => s.name)).toEqual(["lane/old-and-forgotten"]);
    expect(stillStale[0].why).toMatch(/gone stale|grace is spent/);
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
    // #310. The case a heading cannot fix: the citation belongs INSIDE the bullet, because the
    // bullet stopped enumerating pushed lanes and now points at the table that tracks them. Shape
    // alone cannot judge it — both arms below are the same string — so the predicate decides.
    const cites =
      "- **One carries work that is not on main** — \`lane/a\`; the rest have rows in \`docs/BRANCH_DISPOSITIONS.md\`.";
    expect(branchesClaimedUnmerged(cites, (t) => t === "docs/BRANCH_DISPOSITIONS.md")).toEqual(["lane/a"]);
    // And with no measurement available, the old behaviour is preserved rather than guessed at:
    // the caller that cannot ask git gets the token back and decides for itself.
    expect(branchesClaimedUnmerged(cites)).toEqual(["lane/a", "docs/BRANCH_DISPOSITIONS.md"]);
    // A doc that is a path but NOT a branch-prefixed token was never at risk; pinned so a future
    // widening of the alternation cannot quietly start eating it.
    expect(branchesClaimedUnmerged("- **not on main** — \`lane/a\`, see \`README.md\`.")).toEqual(["lane/a"]);
  });

  it("#333 round 2: grace survives a conflict-resolving landing merge, and still expires on a real stale name", () => {
    // `landingCommitOf` alone first: an empty ancestry path means nothing has landed on top of the
    // tip yet, so the tip is trivially its own landing; a non-empty path resolves to its OLDEST
    // entry (last, since git prints newest-first) regardless of how many commits sit between the
    // tip and origin/main today.
    expect(landingCommitOf("tip", [])).toBe("tip");
    expect(landingCommitOf("tip", ["mergeCommit"])).toBe("mergeCommit");
    expect(landingCommitOf("tip", ["laterEdit", "mergeCommit"])).toBe("mergeCommit");

    // The DAG the reviewers reproduced in a scratch repo: `branchTip` and `mainBeforeMerge` are the
    // two parents of `mergeCommit` (an ordinary merge with two parents), and `laterEdit` is an
    // ordinary later commit built on top of it. One descendant map, so every ancestor question
    // below is answered from the SAME facts rather than a per-assertion boolean.
    const conflictMergeLineage = fakeIsAncestorOrEqual({
      branchTip: ["mergeCommit", "laterEdit"],
      mainBeforeMerge: ["mergeCommit", "laterEdit"],
      mergeCommit: ["laterEdit"],
    });

    // The bug itself, reproduced structurally: when the landing merge has to conflict-resolve the
    // doc, `mergeCommit` — not any commit inside the branch — is what `git log -1` reports as
    // freshest. Asking `landedNameIsGraced` about the raw TIP (round 1's mechanism) denies grace,
    // because a merge commit is an ancestor of NEITHER of its parents — this is #333 reproducing
    // unchanged, exactly as the round-1 review found:
    expect(landedNameIsGraced("branchTip", "mergeCommit", conflictMergeLineage)).toBe(false);

    // The fix: ask about the LANDING instead. With origin/main sitting exactly at the merge (the
    // ancestry path from branchTip to origin/main is just [mergeCommit]), the landing commit IS
    // mergeCommit, which IS the freshest editor — equality, grace granted:
    const landingAtMerge = landingCommitOf("branchTip", ["mergeCommit"]);
    expect(landingAtMerge).toBe("mergeCommit");
    expect(landedNameIsGraced(landingAtMerge, "mergeCommit", conflictMergeLineage)).toBe(true);

    // And the #243 shape survives being reached through a conflict-resolving landing: `laterEdit`
    // touches the doc again afterward and leaves the name in place. origin/main has moved to
    // laterEdit, so the ancestry path from branchTip is now [laterEdit, mergeCommit] (newest
    // first) — the landing commit is still mergeCommit (unaffected by what lands after it), but
    // the freshest editor is now laterEdit, a strict DESCENDANT of the landing, never an ancestor
    // of it. Grace is correctly spent — a genuinely stale name is not laundered by having once
    // landed through a conflict:
    const landingAfterLaterEdit = landingCommitOf("branchTip", ["laterEdit", "mergeCommit"]);
    expect(landingAfterLaterEdit).toBe("mergeCommit");
    expect(landedNameIsGraced(landingAfterLaterEdit, "laterEdit", conflictMergeLineage)).toBe(false);
  });

  it("A: every branch it calls unmerged is genuinely not on origin/main", () => {
    const claimed = branchesClaimedUnmerged(markdown, isTrackedPath);
    // #291 removed the two floors that used to stand here ("names at least one branch", "resolves at
    // least one of them"). They were insurance against the doc going quiet, and rule D is now that
    // insurance pointing the other way: the handoff must name NO lane, so a floor demanding one
    // could only be satisfied by reintroducing the fleet database this train deleted. A rule cannot
    // require the thing its neighbour forbids. What A still does is unchanged and unweakened — any
    // branch that does appear is judged — and its own judgment stays falsified below against stubs,
    // which is where a green run's evidence actually comes from.
    if (claimed.length === 0) {
      console.log("rule A: the handoff names no branches (rule D's ban), so there is nothing to judge this run");
      return;
    }
    // #333: same one-cycle grace as rule D, derived the same way, off `origin/<b>` because that is
    // what THIS rule resolves landedness from — see `freshestDocEditOnMain` above for why a single
    // freshest-edit commit serves both rules.
    const freshest = freshestDocEditOnMain();
    const gracedByA = [];
    const isGraced = (b) => {
      if (freshest === null) return false;
      let tip = null;
      try {
        tip = git("rev-parse", `origin/${b}`);
      } catch { /* stays null: refExists already gates this branch out before isGraced runs */ }
      // Round 2: graced against the LANDING (`landingCommitOnMain`), not the raw tip — see that
      // function's doc comment for why a conflict-resolving merge needs this.
      const result = tip !== null && landedNameIsGraced(landingCommitOnMain(tip), freshest, isAncestorOrEqual);
      if (result) gracedByA.push(b);
      return result;
    };
    const merged = landedBranches(claimed, refExists, landedOnMain, isGraced);
    if (gracedByA.length) {
      console.log(`rule A: ${gracedByA.length} landed name(s) graced this cycle (#333), remove on the next doc edit: ${gracedByA.join(", ")}`);
    }
    expect(
      merged,
      `${HANDOFF} warns these branches carry work that is not on main, but they have since landed:\n  - ${merged.join("\n  - ")}\nStop telling the next session to preserve them.`,
    ).toEqual([]);
  });

    // INVERTED by #291. It used to read "a stated worktree count matches this machine", and that was
  // the single most expensive sentence in the repo. The fleet moves every few minutes: one lane
  // adding a worktree turned the number red in every OTHER lane's pre-push gate, so the next lane to
  // push had to edit global prose about a fleet it had not touched -- and then rebase, because
  // someone else had just done the same. Eight of eight open PRs on 2026-09-02 carried an edit to
  // this file, almost none of them about their own subject.
  //
  // The count was never wrong to WANT; it was wrong to STORE. `node scripts/fleet-snapshot.mjs`
  // prints it on demand, from git, and cannot be stale. So the rule now bans the stored number
  // rather than checking it, and what it protects is the same thing it always protected: nobody
  // reading a total that was true for somebody else, some time ago.
  it("B: the handoff stores no worktree count — it says how to take one", () => {
    const stated = statedWorktreeCount(repoStateBullet(markdown) ?? markdown);
    expect(
      stated,
      `${HANDOFF} states a worktree count (${stated}). A number beside a fleet this volatile is a ` +
        `race, not a record: every lane that adds or removes a checkout makes it false for every ` +
        `other lane's gate, and the lane that pays is whichever one pushes next. Delete it and ` +
        `point at \`node scripts/fleet-snapshot.mjs\`, which measures the fleet at the moment it is asked.`,
    ).toBe(null);
    // Not inert: the parser must still be able to FIND a count, or this rule would pass on a doc
    // full of them simply because it had stopped reading. Proven against a string, not the doc.
    expect(statedWorktreeCount("**11 worktrees** besides the canonical checkout")).toBe(11);
  });

    // NARROWED by #291, and the narrowing is what closed the first-push trap. The rule used to demand
  // that every checkout holding commits on no remote be NAMED in the handoff bullet. A lane about to
  // make its very first push is exactly that checkout -- its branch is not on origin yet -- so the
  // gate red-flagged the push that would have answered its own complaint, and the only way through
  // was to write the lane's own name into global prose that every other lane also had to edit.
  //
  // What actually decides whether the work can be LOST is not prose, it is whether a shared ref can
  // find it. A local branch lives in the common .git: `git worktree remove` deletes the checkout and
  // the branch survives, so the commits are still reachable and still pushable. A DETACHED head
  // lives only in that worktree's own directory -- remove the checkout and the last thing that knew
  // those commits existed is gone. That second shape is the one this rule was written for, and it is
  // still invisible to every other audit in this repo, because it has no ref for one to read.
  //
  // So the failure narrows to the branchless carrier, and the remedy narrows with it: give the work
  // a ref (`git branch <name> <sha>`) or push it. Neither is a shared write. Everything else the old
  // rule reported is still measured and still printed every run -- by scripts/fleet-snapshot.mjs,
  // which is the same code -- it just no longer bills an unrelated lane for saying so.
  it("C: work only a removable checkout can find must be given a ref", () => {
    const s = snapshot({ git });
    if (s.total <= 1) {
      // A one-checkout clone has nothing to compare, exactly as in rule B. Say so; do not pass quietly.
      expect(s.total).toBe(1);
      return;
    }
    // Offline, or no cached ref origin still has. Fail-closed, and deliberately NOT by falling back
    // to naming every checkout ahead of origin/main (#312 F5): that is strictly more naming, but it
    // reds while blaming the handoff for checkouts that are every one of them fully pushed.
    expect(
      s.trusted,
      `rule C cannot reach origin, so it cannot tell a commit that exists only on this disk from one ` +
        `origin already has -- which is the only question this rule asks. Fetch origin and re-run.`,
    ).not.toBeNull();
    // The shortcut inside the snapshot is a theorem, not a guess, and this is its premise: origin/main
    // is one of the trusted refs, so a checkout holding nothing beyond origin/main holds nothing
    // beyond the superset either. Asserted rather than assumed -- if it ever stops holding, the
    // shortcut would silently start reporting unmeasured carriers as safe.
    expect(
      s.trusted,
      "rule C's ahead-of-main shortcut is only sound while origin/main is trusted; it is not.",
    ).toContain("origin/main");
    // The inert path, falsified LIVE against the same porcelain rather than merely described: counted
    // by a runner that fails the way an unfetched ref fails, every carrier must come back unmeasured.
    // BOTH counters are blinded in turn, because a working ahead-count with a broken unpushed-count
    // produces the same green silence through the newer of the two seams (#312).
    const throws = countAheadVia(() => { throw new Error("unknown revision"); });
    const blind = liveCarriers(s.list, throws, throws);
    expect(blind.length).toBeGreaterThan(0);
    expect(unmeasuredCarriers(blind).length).toBe(blind.length);
    expect(atRiskCarriers(blind, s.trusted)).toEqual([]);
    const halfBlind = liveCarriers(s.list, () => 1, throws);
    expect(unmeasuredCarriers(halfBlind).length).toBe(halfBlind.length);
    expect(atRiskCarriers(halfBlind, s.trusted)).toEqual([]);
    // The inert path FIRST. If origin/main cannot be resolved, every count fails at once and a rule
    // that read that as zero would go green without ever looking at a checkout.
    expect(
      s.unmeasured,
      `rule C could not measure ${s.unmeasured.length} checkout(s) against origin/main: ` +
        `${s.unmeasured.join(", ")}. That is a broken measurement, not an empty result -- fetch ` +
        `origin. Counting it as zero is how this rule would grow the very blind spot it closes.`,
    ).toEqual([]);

    // The exclusion set, falsified LIVE. Every exempt carrier is exempt BECAUSE some trusted ref
    // covers it, and this proves that ref is doing the work rather than the count being zero for some
    // unrelated reason: drop one carrier's own origin ref -- exactly what pruning it at origin does --
    // and its count must rise off zero. Without this the #312 F1 fix could rot into decoration.
    {
      const exempt = s.checkouts.find(
        (c) => c.commits > 0 && c.unpushed === 0 && s.trusted.includes(`origin/${c.name}`),
      );
      if (exempt) {
        const without = s.trusted.filter((ref) => ref !== `origin/${exempt.name}`);
        const raw = Number(String(git("rev-list", "--count", exempt.name, "--not", ...without)).trim());
        expect(
          raw,
          `dropping origin/${exempt.name} from the trusted set left its unpushed count at ${raw}. ` +
            `The exclusion set is not driving the verdict, so a ref pruned at origin would be ` +
            `silently trusted anyway -- the exact fail-open #312 F1 exists to prevent.`,
        ).toBeGreaterThan(0);
      } else {
        console.log("rule C: no exempt carrier on a named origin ref, so the exclusion set is unfalsified this run");
      }
    }

    // Say what the rule DID, every run. After #291 the common case is an empty failing set, and an
    // empty set reported as silence is indistinguishable from a rule that had stopped looking.
    const stranded = s.atRisk.filter((c) => !c.branch);
    console.log(
      `rule C: ${s.checkouts.length} checkout(s), ${s.ahead.length} ahead of origin/main, ` +
        `${s.atRisk.length} holding commits on no remote ` +
        `(${s.atRisk.length - stranded.length} of those on a branch, which survives worktree removal), ` +
        `${stranded.length} stranded on a detached head`,
    );
    // Non-vacuity: an EMPTY carrier list would mean the porcelain parser broke, which is a different
    // fact entirely and must never read as safety.
    expect(s.checkouts.length).toBeGreaterThan(0);
    expect(
      stranded.map((c) => `${c.name} (+${c.unpushed}) at ${c.path}`),
      `these checkouts hold commits that exist on NO remote AND on no branch, so the only thing that ` +
        `knows they exist is the worktree directory itself. Deleting it loses them, and no ` +
        `origin-facing audit can see them first. Give the work a ref -- \`git branch <name> <sha>\` ` +
        `-- or push it. Recording it in prose is not a fix: prose does not make a commit reachable.`,
    ).toEqual([]);
    // Declared, not discovered. This rule walks every checkout on the machine and asks origin one
    // question; under the full suite that is comfortably past vitest's 15s default, and finding that
    // out from a timeout at the pre-push gate is how the fix nearly failed to ship.
  }, 60_000);

    // INVERTED by #291, same reason as B and with a sharper edge. The old rule read "every branch the
  // bullet names still carries", which is a maintenance contract: name your lane when it starts,
  // remove it when it lands, and repair it when somebody ELSE lands. Every one of those writes hit
  // one shared paragraph, so lanes with nothing in common serialized behind it.
  //
  // What the rule was protecting -- a next session told to preserve work that has already landed --
  // is not protected by policing the names. It is protected by not carrying them: a name that is
  // never written cannot go stale. Rule A stays as written and judges any name that does appear, so
  // this ban and that rule fail in opposite directions and neither can be satisfied by silence.
  it("D: the handoff names no lanes — a name here is a claim that rots", () => {
    const claimed = laneNamesIn(markdown, isTrackedPath);
    expect(
      claimed,
      `${HANDOFF} names ${claimed.length} branch(es): ${claimed.join(", ")}. ` +
        `A lane name in global prose is a fact about somebody else's work that somebody else has to ` +
        `come back and repair -- when it lands, when it is renamed, when it is abandoned. The live ` +
        `set is a git question: \`node scripts/fleet-snapshot.mjs\`, or \`git worktree list\`. If a ` +
        `specific branch genuinely needs owner attention, that belongs on its issue or in ` +
        `docs/dispositions/, one file per ref, where only its own lane writes.`,
    ).toEqual([]);
    // Not inert: the extractor must still be able to SEE a branch name, or the ban would read as
    // satisfied by a parser that had stopped matching. Proven against a string, not the doc — and
    // against a string with no bullet in it, which is the corpus this rule actually reads now.
    expect(laneNamesIn("a paragraph mentioning `lane/example-1` in passing")).toEqual(["lane/example-1"]);
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
