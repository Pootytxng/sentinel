// Branch-disposition audit — every remote ref must have a proven row in docs/BRANCH_DISPOSITIONS.md.
//
// Why this exists: docs/BACKLOG.md asserted "every branch has a verified disposition" while nothing
// had ever verified one. The claim was false when written and stayed false for weeks. Prose cannot
// fail a build, so the record now has a checker: a ref with no row fails, a row naming a dead ref
// fails, and — the part that matters — a MERGED row is re-proven by merge-tree on every run.
//
// The proof is merge-tree, never ahead/behind. Lanes land through PRs, so main carries different
// hashes and `git cherry` / `A...B` both lie (a three-dot diff once reported +195 lines for a branch
// whose every symbol was already on main).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DOC = "docs/BRANCH_DISPOSITIONS.md";

/** Dispositions the record may use, and what each one promises about merge-tree. */
export const DISPOSITIONS = {
  // main already contains it — the merge is a no-op, and we re-prove that every run.
  MERGED: { noop: true },
  // its content reached main by another path, so the merge is NOT a no-op (main moved on).
  SUPERSEDED: { noop: false },
  // carries work main does not have.
  UNLANDED: { noop: false },
  // frozen or failed-candidate refs. Never a merge target, so merge-tree says nothing useful.
  PRESERVE: { noop: null },
  // another lane holds it under docs/WORK_CONTROL.md. Not ours to characterise.
  CLAIMED: { noop: null },
};

const git = (repoRoot, args) =>
  execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// The trunk is what everything is dispositioned AGAINST, so it never gets a row of its own. Bare
// `origin` is how `%(refname:short)` renders refs/remotes/origin/HEAD.
const NOT_A_BRANCH = new Set(["origin", "origin/HEAD", "origin/main"]);

/** The refs that actually exist locally. Remote-tracking only — this reflects the last fetch. */
export function listRemoteRefs(repoRoot) {
  return git(repoRoot, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"])
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !NOT_A_BRANCH.has(l));
}

/**
 * What this checkout is entitled to SAY about origin.
 *
 * `listRemoteRefs` reads a cache, not the remote, and a cache can be degraded in two independent
 * ways — each silencing a different half of this audit:
 *
 *   tracksEveryBranch  Does `refs/remotes/origin/*` describe origin at all? `actions/checkout@v4`
 *                      clones single-branch by default, so the cache holds ONE ref. It is then a
 *                      picture of one branch, not of the remote, and absence proves nothing in
 *                      either direction.
 *   shallow            Is the history present? merge-tree needs real ancestry; against a depth-1
 *                      clone it reports a conflict for branches that are genuinely merged.
 *
 * The two are independent: a full-depth single-branch clone has history and no ref set; a depth-1
 * all-branches fetch has the ref set and no history.
 *
 * This is the same defect the Trust Ledger lane just closed, one layer down. An unreadable ledger
 * used to be spoken as "your PC is untouched"; an unfetched ref was spoken as "that branch no
 * longer exists — drop the row." On CI that came out as 21 instructions to delete 21 true rows,
 * one of them the frozen beta ref. A degraded read must produce silence, never a claim.
 */
export function refSetCoverage(repoRoot) {
  let refspecs = "";
  try {
    refspecs = git(repoRoot, ["config", "--get-all", "remote.origin.fetch"]);
  } catch {
    // `git config --get-all` exits 1 when the key is unset — no origin, or a checkout that
    // configured none. Either way this clone tracks nothing, which is the answer we want.
  }
  const tracksEveryBranch = /:\s*refs\/remotes\/origin\/\*\s*$/m.test(refspecs);

  let shallow = false;
  try {
    shallow = git(repoRoot, ["rev-parse", "--is-shallow-repository"]).trim() === "true";
  } catch {
    // A git too old to know the flag: treat as full. The cost of being wrong is one merge-tree run.
  }

  const spec = refspecs.trim().replace(/\n/g, ", ") || "unset";
  return {
    tracksEveryBranch,
    shallow,
    reason: !tracksEveryBranch
      ? `this checkout does not track every origin branch (remote.origin.fetch = ${spec})`
      : shallow
        ? "this checkout is shallow, so merge-tree cannot re-prove a merge"
        : null,
  };
}

/**
 * The trunk every disposition is measured against: `origin/main` first, local `main` only as a
 * fallback.
 *
 * The order used to be the other way round, and it produced a confident false failure the first
 * time this ran in a worktree: local `main` sat at `c74d80e` while origin had moved to `6712c14`,
 * so a genuinely MERGED branch "still changes the tree" — the tree it changed was a week old. A
 * disposition is a claim about what the SHARED trunk contains, and a local branch pointer is a
 * private bookmark that no one is obliged to move. Reading it as the trunk is the same mistake as
 * reading an unfetched ref cache as the remote, which is what the rest of this file exists to stop.
 */
export function resolveBase(repoRoot) {
  for (const candidate of ["origin/main", "main"]) {
    try {
      git(repoRoot, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
      return candidate;
    } catch {
      /* try the next one */
    }
  }
  throw new Error("neither `main` nor `origin/main` resolves in this repository");
}

/**
 * True when merging `ref` into `base` would change nothing.
 * A conflicting merge-tree exits non-zero; that is simply "not a no-op", not an error.
 */
export function isNoop(repoRoot, base, ref) {
  let tree;
  try {
    tree = git(repoRoot, ["merge-tree", "--write-tree", base, ref]).split("\n")[0].trim();
  } catch {
    return false;
  }
  return tree === git(repoRoot, ["rev-parse", `${base}^{tree}`]).trim();
}

/** Rows of the `## The refs` table: the backticked ref in column 1, the disposition in column 2. */
export function parseDispositions(markdown) {
  const start = markdown.indexOf("## The refs");
  if (start === -1) return [];
  const rest = markdown.slice(start + "## The refs".length);
  const end = rest.indexOf("\n## ");
  const section = end === -1 ? rest : rest.slice(0, end);

  const rows = [];
  for (const line of section.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1);
    if (cells.length < 3) continue;
    const ref = cells[0].trim().replace(/^`|`$/g, "");
    const disposition = cells[1].trim();
    if (!ref.startsWith("origin/")) continue; // header and separator rows
    rows.push({ ref, disposition, evidence: cells.slice(2).join("|").trim() });
  }
  return rows;
}

/**
 * Returns a list of human-readable problems. Empty means: nothing this checkout could check is
 * wrong. On a degraded checkout that is a WEAKER statement than "the record is true" — ask
 * `refSetCoverage` which claims were actually available, and see `main` for how it is reported.
 */
export function audit({ repoRoot, docPath = join(repoRoot, DOC), coverage } = {}) {
  const problems = [];
  const rows = parseDispositions(readFileSync(docPath, "utf8"));
  if (rows.length === 0) {
    problems.push(`${DOC} has no disposition rows — the '## The refs' table is missing or empty.`);
    return problems;
  }

  // --- Claims about the DOCUMENT. These read no refs, so they hold on any checkout. ---
  const seen = new Set();
  for (const { ref } of rows) {
    if (seen.has(ref)) problems.push(`${ref} appears twice in ${DOC} — one row per ref.`);
    seen.add(ref);
  }
  // Vocabulary used to be checked inside the merge-tree loop, below a `live.has(ref)` guard — so a
  // nonsense disposition on a ref this clone had not fetched went unreported. It is a property of
  // the row, not of the remote; it belongs here.
  for (const { ref, disposition } of rows) {
    if (!DISPOSITIONS[disposition]) {
      problems.push(
        `${ref} has disposition "${disposition}", which is not one of ${Object.keys(DISPOSITIONS).join(", ")}.`,
      );
    }
  }

  // --- Claims about ORIGIN. Only a checkout that can see origin is allowed to make them. ---
  const cover = coverage ?? refSetCoverage(repoRoot);
  if (!cover.tracksEveryBranch) return problems;

  const live = new Set(listRemoteRefs(repoRoot));
  for (const ref of live) {
    if (!seen.has(ref)) {
      problems.push(`${ref} exists on origin but has no row in ${DOC} — disposition it, or delete it.`);
    }
  }
  for (const ref of seen) {
    if (!live.has(ref)) {
      problems.push(`${DOC} dispositions ${ref}, which no longer exists — drop the row.`);
    }
  }

  // --- Re-proof. Needs ancestry as well as the refs. ---
  if (cover.shallow) return problems;

  const base = resolveBase(repoRoot);
  for (const { ref, disposition } of rows) {
    if (!live.has(ref)) continue; // already reported; merge-tree would just throw
    const rule = DISPOSITIONS[disposition];
    if (!rule || rule.noop === null) continue; // unknown word already reported; PRESERVE/CLAIMED claim nothing
    const noop = isNoop(repoRoot, base, ref);
    if (rule.noop && !noop) {
      problems.push(`${ref} is recorded MERGED but merging it into ${base} still changes the tree.`);
    }
    if (!rule.noop && noop) {
      problems.push(`${ref} is recorded ${disposition} but merging it into ${base} is a no-op — it is MERGED.`);
    }
  }

  return problems;
}

export function main(argv) {
  const repoRoot = argv[0] || join(dirname(fileURLToPath(import.meta.url)), "..");
  const cover = refSetCoverage(repoRoot);
  const problems = audit({ repoRoot, coverage: cover });

  if (problems.length > 0) {
    console.error("branch-disposition-audit: FAIL");
    for (const p of problems) console.error(`  - ${p}`);
    return 1;
  }

  // A pass on a degraded checkout is not the same sentence as a pass on a full one, and printing
  // the full one anyway is how a checker starts lying on the checker's own behalf.
  if (!cover.tracksEveryBranch) {
    console.log(
      `branch-disposition-audit: PARTIAL — ${cover.reason}.\n` +
        `  The rows in ${DOC} are internally consistent. Whether they match origin was NOT checked.`,
    );
    return 0;
  }
  if (cover.shallow) {
    console.log(
      `branch-disposition-audit: PARTIAL — ${cover.reason}.\n` +
        `  Every origin ref has a row and no row names a dead ref. MERGED rows were NOT re-proven.`,
    );
    return 0;
  }
  console.log(`branch-disposition-audit: OK — every origin ref has a proven row in ${DOC}.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
