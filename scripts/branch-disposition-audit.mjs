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
 * `origin/main` if it exists, else the local `main` — not the other way round.
 *
 * The local `main` is a *checkout*, and in a multi-worktree repo it belongs to whichever worktree
 * holds it; nothing obliges that worktree to be current. Preferring it made every MERGED row's
 * re-proof depend on when an unrelated lane last ran `git pull`. That is not a theoretical risk: on
 * 2026-08-05 this audit called `origin/claude/harness-context-cleanup-700535` unmerged — it had
 * landed as PR #66 and is a merge-tree no-op against the real trunk — purely because the primary
 * worktree's `main` sat 4 commits behind. It fails the other way too: a stale base can re-prove a
 * MERGED row that the true trunk no longer contains, which is the silent direction.
 *
 * `origin/main` is a remote-tracking ref, so it is only as fresh as the last `git fetch` — the same
 * caveat the whole audit already carries and documents. But it tracks the server by construction
 * rather than by an unrelated lane's habits, and that is the difference that matters. The local
 * fallback stays for repos and CI checkouts that have no `origin/main` at all.
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

/** Returns a list of human-readable problems. Empty means the record is true right now. */
export function audit({ repoRoot, docPath = join(repoRoot, DOC) } = {}) {
  const problems = [];
  const rows = parseDispositions(readFileSync(docPath, "utf8"));
  if (rows.length === 0) {
    problems.push(`${DOC} has no disposition rows — the '## The refs' table is missing or empty.`);
    return problems;
  }

  const seen = new Set();
  for (const { ref } of rows) {
    if (seen.has(ref)) problems.push(`${ref} appears twice in ${DOC} — one row per ref.`);
    seen.add(ref);
  }

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

  const base = resolveBase(repoRoot);
  for (const { ref, disposition } of rows) {
    if (!live.has(ref)) continue; // already reported; merge-tree would just throw
    const rule = DISPOSITIONS[disposition];
    if (!rule) {
      problems.push(
        `${ref} has disposition "${disposition}", which is not one of ${Object.keys(DISPOSITIONS).join(", ")}.`,
      );
      continue;
    }
    if (rule.noop === null) continue;
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
  const problems = audit({ repoRoot });
  if (problems.length === 0) {
    console.log(`branch-disposition-audit: OK — every origin ref has a proven row in ${DOC}.`);
    return 0;
  }
  console.error("branch-disposition-audit: FAIL");
  for (const p of problems) console.error(`  - ${p}`);
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
