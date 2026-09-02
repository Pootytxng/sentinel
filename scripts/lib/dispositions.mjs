// The disposition RECORD STORE — one file per branch, replacing the single shared table.
//
// Why this shape. `docs/BRANCH_DISPOSITIONS.md` held one row per origin ref in ONE file, and the
// audit refused a push whose ref had no row. So every lane had to edit that file merely to exist,
// and every lane therefore conflicted with every other lane on a document none of them was working
// on. Measured on 2026-09-02 at `origin/main = c6b240d4`: all 8 open PRs touched it, and all 8
// touched `docs/SESSION_HANDOFF.md` too — 8 lanes, 8 collisions, zero of them about the work
// (issue #291).
//
// One record per ref removes the shared write. Two lanes collide here only when they disposition
// the SAME branch, which is the case where a collision is real information rather than noise.
//
// JSON, not Markdown, on purpose: these records are read by machines and written by lanes, and the
// live-doc prose guards (doc-truth decision 7 fails any sentence pairing "merge" with "worktree")
// scan Markdown. A disposition note talks about merges and worktrees constantly. Prose rules on a
// mechanical record buy nothing and cost a red gate on a true sentence.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

// Posix-shaped on purpose: DIR is printed in gate messages and written into docs, and a Windows
// backslash there is both ugly and unquotable in the shell commands those messages hand out.
// Filesystem work below goes through `join`, which is separator-correct on every platform.
export const DIR = "docs/dispositions";

/**
 * What a disposition promises about merge-tree. `noop: null` means "claims nothing" — the audit
 * cannot re-prove it, and must not pretend to.
 *
 * LANDED is new (#291). It is the state the old vocabulary could not express: the work IS on main,
 * and the ref is deliberately kept anyway — a frozen reference point, or a lane still cited by an
 * open review. Before it, such a ref had to be filed CLAIMED to escape the prunable deadline, so
 * "CLAIMED" silently meant two different things: a live writer holds this, and nobody holds this
 * but do not delete it. A reader could not tell which, and neither could the audit.
 */
export const DISPOSITIONS = {
  MERGED: { noop: true, prunable: true },
  SUPERSEDED: { noop: false, prunable: true },
  UNLANDED: { noop: false },
  PRESERVE: { noop: null },
  CLAIMED: { noop: null },
  LANDED: { noop: true, prunable: false },
};

/** `origin/lane/foo-1` -> `lane__foo-1`. Reversible, and a valid filename on Windows. */
export function slugOf(ref) {
  const bare = ref.startsWith("origin/") ? ref.slice("origin/".length) : ref;
  return bare.replace(/\//g, "__");
}

export function refOf(slug) {
  return `origin/${slug.replace(/__/g, "/")}`;
}

export function pathOf(repoRoot, ref) {
  return join(repoRoot, DIR, `${slugOf(ref)}.json`);
}

const REQUIRED = ["ref", "disposition", "evidence"];

/**
 * Read every record. A malformed file is REPORTED, never skipped: a record the store cannot parse
 * is a ref with no usable disposition, which is exactly the condition the audit exists to fail on.
 * Silently dropping it would turn a broken record into a green gate.
 */
export function readAll(repoRoot) {
  const dir = join(repoRoot, DIR);
  if (!existsSync(dir)) return { records: [], problems: [`${DIR}/ does not exist.`] };

  const records = [];
  const problems = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const rel = `${DIR}/${name}`;
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch (err) {
      problems.push(`${rel} is not valid JSON: ${err.message}`);
      continue;
    }
    const missing = REQUIRED.filter((k) => !String(parsed?.[k] ?? "").trim());
    if (missing.length) {
      problems.push(`${rel} is missing required field(s): ${missing.join(", ")}.`);
      continue;
    }
    // The filename is derived from the ref, so a record whose ref does not match its own filename
    // is reachable under two names or under none. Both break the one-record-per-ref invariant that
    // makes this store collision-free.
    const expected = `${slugOf(parsed.ref)}.json`;
    if (expected !== name) {
      problems.push(`${rel} dispositions ${parsed.ref}, which belongs in ${DIR}/${expected}.`);
      continue;
    }
    records.push({ ...parsed, file: rel });
  }
  return { records, problems };
}

export function write(repoRoot, record) {
  mkdirSync(join(repoRoot, DIR), { recursive: true });
  writeFileSync(pathOf(repoRoot, record.ref), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export function remove(repoRoot, ref) {
  rmSync(pathOf(repoRoot, ref), { force: true });
}
