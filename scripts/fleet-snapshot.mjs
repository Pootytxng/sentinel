// The fleet, measured. Nothing here is written down anywhere -- that is the point.
//
// docs/SESSION_HANDOFF.md used to carry the fleet as prose: how many worktrees existed, which ones
// carried commits, how far each sat past main, every live lane by name. Issue #291 measured what
// that cost: on 2026-09-02 all eight open PRs edited that one file, and the reason was almost never
// the subject of the work. A lane creating a worktree invalidated the stated total for every OTHER
// lane's pre-push gate, so whoever pushed next had to edit global prose about a fleet they had not
// changed -- and then rebase, because someone else had just done the same.
//
// A number beside a fleet that moves every few minutes is not a record, it is a race. So the
// numbers are computed here, on demand, from git, and the handoff says how to get them instead of
// what they were. scripts/handoff-worktree-truth.test.mjs imports these same functions: the guard
// and the report cannot disagree, because they are one implementation.
//
// Read-only. Every git call below reads; none writes, and none touches origin except one
// `ls-remote`, which is how the difference between "pushed" and "exists only on this disk" is
// told. Run it: `node scripts/fleet-snapshot.mjs`.

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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

// #512. The one batch read behind branchAheadCountsVia, shared with the test that checks it live.
export const BRANCH_AHEAD_FORMAT = "--format=%(refname) %(ahead-behind:origin/main)";

/**
 * #512. Every local branch's distance past `origin/main`, from ONE `git for-each-ref` line per
 * branch (`refs/heads/<name> <ahead> <behind>`), as a Map keyed by the short name liveCarriers
 * uses. `null` when the batch could not be taken at all, so the caller falls back to counting one
 * checkout at a time rather than reading a failed batch as "no branch is ahead". A line this cannot
 * parse is left out of the map for the same reason: an absent key is re-counted, never zeroed.
 */
export function branchAheadCountsVia(runner) {
  let out;
  try {
    out = String(runner());
  } catch {
    return null;
  }
  const counts = new Map();
  for (const line of out.split(/\r?\n/)) {
    // Ref names cannot contain spaces, so the first space ends the name.
    const m = /^refs\/heads\/(\S+) (\d+) (\d+)$/.exec(line.trim());
    if (m) counts.set(m[1], Number(m[2]));
  }
  return counts;
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
        // The commit this checkout is sitting on, whether or not a branch line names it. Rule C's
        // containment question is asked about THIS, not about the branch: a detached checkout has
        // no branch to ask about, and that was the whole of the #439 misreading.
        head: headLine ? headLine.slice("HEAD ".length) : null,
        // The branch this checkout has checked out, or null when it is detached. It is a SUFFICIENT
        // refuge (a local branch lives in the common .git and survives `git worktree remove`) but
        // never a necessary one: `strandedCarriers` asks which branches contain the head, because
        // reading the absence of this line as "on no branch" is exactly the #439 misreading.
        branch,
        commits: committish ? countAhead(committish) : null,
        unpushed: committish ? countUnpushed(committish) : null,
      };
    })
    .filter((c) => c.name !== "main");
}

/**
 * The carriers holding commits that exist nowhere but this disk. Rule C fails on the subset of
 * these that no local branch can reach either -- see `strandedCarriers` below.
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
 * The local branches that can still reach a commit -- `git for-each-ref --contains <c> refs/heads/`
 * -- built from an injected runner, like `countAheadVia`, so both failure shapes stay falsifiable.
 *
 * WHY A LOCAL BRANCH IS THE ANSWER. Rule C asks one question: if this checkout is removed, does
 * anything still know these commits exist? A local branch does. It lives in the COMMON .git and
 * survives `git worktree remove`, so the work stays reachable and stays pushable. A detached HEAD
 * lives only in the worktree's own directory, and that is the shape the rule was written for.
 *
 * `null` is "could not ask", `[]` is "nothing contains it" -- and unlike `originHeads` one function
 * down, an EMPTY read here is a real measurement, not a broken one. git exits non-zero for a commit
 * it cannot resolve (`error: no such commit`, status 129), so the throw carries the failure and a
 * clean empty answer means exactly what it says: no local branch reaches this commit. That is the
 * stranded case itself, and laundering it into "unmeasured" would mute the rule.
 *
 * A carrier with no head sha at all (porcelain that printed no HEAD line) is `null` for the same
 * reason absent and unmeasurable are one fact everywhere else in this file: nobody asked.
 */
export function containingBranchesVia(runner) {
  return (committish) => {
    if (!committish) return null;
    try {
      return String(runner(committish))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    } catch {
      return null;
    }
  };
}

/**
 * The carriers rule C actually FAILS on: at-risk commits that no surviving ref can find.
 *
 * #439 (2026-09-16). This used to be `atRisk.filter((c) => !c.branch)`, and `branch` is only the
 * checkout's OWN porcelain branch line -- so every detached checkout was stranded by definition,
 * however many local branches pointed at its head. `.claude/worktrees/wonderful-khorana-e350f7` sat
 * detached at `8d1baf0d` with `claude/doc-archive` and `claude/doc-budget-archive-move-dcbec2` both
 * on that commit; removing the worktree could not have lost anything, and the rule redded every
 * lane's pre-push gate claiming the commits were "on no branch". Nothing had asked.
 *
 * So "on a branch" means ANY local branch contains the head, measured by `containingBranchesVia`
 * and carried on the carrier as `refuge`. The checkout's own branch is still honoured first and
 * without a probe -- it is its own refuge, and that answer cannot fail to be taken.
 *
 * Fail-closed on everything else: a `refuge` that is `null` (probe failed) or missing (nobody
 * probed) keeps the checkout named. The asymmetry is deliberate -- over-reporting costs one `git
 * branch` command, under-reporting costs the commits.
 */
export function strandedCarriers(carriers) {
  return carriers.filter((c) => !c.branch && !(Array.isArray(c.refuge) && c.refuge.length > 0));
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
 * exclusion set", and the caller REFUSES (fails the assertion rather than falling back to the
 * pre-#312 measurement or silently excluding nothing and calling every checkout at risk).
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

const RUN = { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
// Bounded on purpose: an origin that hangs rather than refusing would otherwise eat the caller's
// whole budget and time out, which reads as a broken guard instead of an unreachable remote.
const TALK_TO_ORIGIN = { ...RUN, timeout: 20_000 };

const g = (...args) => execFileSync("git", args, RUN).trim();

/**
 * The whole fleet in one object, measured live. `trusted` is null when origin could not be reached
 * -- which is a refusal to answer, never an empty answer: without it there is no way to tell a
 * commit that exists only on this disk from one origin already has, and that is the only question
 * `atRisk` asks.
 *
 * `git` is injected so a caller can measure a fixture, and so the failure paths stay falsifiable
 * through the same seam the real thing uses.
 */
export function snapshot({ git = g, lsRemote } = {}) {
  const list = git("worktree", "list", "--porcelain");
  const total = list.split(/\r?\n/).filter((l) => l.startsWith("worktree ")).length;

  const aheadCache = new Map();
  const countAheadOnce = countAheadVia((c) => git("rev-list", "--count", `origin/main..${c}`));
  // #512. One subprocess for every branch checkout's count, where there used to be one EACH: on the
  // 41-worktree fleet of 2026-09-23 that was 41 of live rule C's 60 git spawns, and the walk's cost
  // grew with every lane opened. `%(ahead-behind:origin/main)` is the count `rev-list --count
  // origin/main..<branch>` takes, asked of the branch ref itself (git >= 2.41; an older git fails
  // the batch and lands in the fallback). A detached head, a branch the batch does not list, or a
  // batch that failed outright is still counted one at a time, so null-not-zero holds as before.
  const branchAhead = branchAheadCountsVia(() =>
    git("for-each-ref", BRANCH_AHEAD_FORMAT, "refs/heads/"),
  );
  const countAhead = (c) => {
    if (!aheadCache.has(c)) aheadCache.set(c, branchAhead?.has(c) ? branchAhead.get(c) : countAheadOnce(c));
    return aheadCache.get(c);
  };

  const cached = git("for-each-ref", "--format=%(refname:short)", "refs/remotes/origin")
    .split(/\r?\n/)
    .filter(Boolean);
  const heads = originHeads(
    lsRemote ?? (() => execFileSync("git", ["ls-remote", "--heads", "origin"], TALK_TO_ORIGIN).trim()),
  );
  const trusted = trustedExclusions(cached, heads);

  // Skip the second subprocess wherever the first count already settled the question: a checkout
  // holding nothing past origin/main holds nothing past the trusted superset either, origin/main
  // being one of its members. On a 32-checkout fleet that is the difference between 96 git spawns
  // and 46 -- measured, and the reason rule C once timed out at the pre-push gate.
  const countUnpushed = trusted
    ? (c) => (countAhead(c) === 0 ? 0 : countAheadVia((x) => git("rev-list", "--count", x, "--not", ...trusted))(c))
    : () => null;

  // Asked only where the porcelain cannot already answer it: a checkout ON a branch carries its own
  // surviving ref, so probing it would buy nothing and cost a subprocess per checkout (#291's
  // measured concern -- this fleet runs to 30-odd worktrees and rule C once timed out at the gate).
  // Detached checkouts are the few, and they are the only ones the question is about.
  const containingBranches = containingBranchesVia((c) =>
    git("for-each-ref", "--format=%(refname:short)", `--contains=${c}`, "refs/heads/"),
  );
  const checkouts = liveCarriers(list, countAhead, countUnpushed).map((c) =>
    c.branch ? c : { ...c, refuge: containingBranches(c.head) },
  );
  const atRisk = trusted ? atRiskCarriers(checkouts, trusted) : [];
  return {
    // The raw porcelain, handed back so a caller can re-measure the SAME fleet through a broken
    // counter and prove the failure path is live. Without it a guard could only describe that path.
    list,
    total,
    besidesCanonical: Math.max(total - 1, 0),
    trusted,
    checkouts,
    unmeasured: unmeasuredCarriers(checkouts),
    ahead: checkouts.filter((c) => c.commits > 0),
    atRisk,
    // The failing set, not merely the at-risk set: commits on no remote AND reachable from no local
    // branch, so the worktree directory is the last thing that knows them. Computed here so the
    // report a human reads and the rule that reds the gate cannot disagree -- this file's whole
    // reason for existing.
    stranded: strandedCarriers(atRisk),
  };
}

function main() {
  const s = snapshot();
  const lines = [
    `fleet-snapshot: ${s.total} checkout(s), ${s.besidesCanonical} besides the canonical one.`,
  ];
  if (s.trusted === null) {
    lines.push("  origin unreachable — 'exists only on this disk' cannot be told from 'already pushed'.");
  }
  if (s.unmeasured.length) {
    lines.push(`  UNMEASURED against origin/main (fetch origin): ${s.unmeasured.join(", ")}`);
  }
  for (const c of s.checkouts) {
    // A detached checkout is named with what can still find it, because that -- not the missing
    // branch line -- is what decides whether removing it loses anything (#439).
    const refuge = Array.isArray(c.refuge) && c.refuge.length ? `, on ${c.refuge.join(", ")}` : "";
    const where = c.branch ? c.name : `${c.name} (detached${refuge})`;
    const ahead = typeof c.commits === "number" ? `+${c.commits}` : "?";
    const only = typeof c.unpushed === "number" ? c.unpushed : "?";
    lines.push(`  ${where} — ${ahead} past origin/main, ${only} on no remote — ${c.path ?? ""}`);
  }
  if (s.atRisk.length) {
    lines.push(
      `  ON NO REMOTE — push these or they exist on this disk alone:`,
      `  ${s.atRisk.map((c) => `${c.name} (+${c.unpushed})`).join(", ")}`,
    );
  }
  if (s.stranded.length) {
    lines.push(
      `  STRANDED — on no remote AND reachable from no local branch, so they go with the worktree`,
      `  if it is deleted. Give the work a ref (\`git branch <name> <sha>\`) or push it:`,
      `  ${s.stranded.map((c) => `${c.name} (+${c.unpushed}) at ${c.path}`).join(", ")}`,
    );
  }
  console.log(lines.join("\n"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
