// Build-output disk bloat, as a report-only usage-audit health flag (owner-requested 2026-08-20).
//
// Why this exists: the weekly audit nags about the boot tax in KILOBYTES while the same machine's
// real disk cost is Rust build output measured in GIGABYTES, and nothing looked at it. One
// `src-tauri/target` measured 7.8 GB on 2026-08-20 and this repo runs six worktrees, each free to
// grow its own. Past ~20 GB a single tree is worth a deliberate `cargo clean`, so the report says
// so — and stops there. This module NEVER deletes, cleans, or mutates anything; the owner decides.
//
// EXTENDED 2026-08-24, because the per-tree rule alone was measurably blind. Six trees held
// 59.08 GB and not one was over 20 GB, so the flag stayed green for four days on a drive at 92%.
// Two classes were added beside the original, both still report-only: an IDLE tree (under the line
// but untouched for two weeks — build output no lane is using) and the FLEET total (what the
// machine carries across every worktree, which no per-tree rule can see). Cleaning the four idle
// trees that day returned 35.9 GB.
// `scripts/disk-bloat-guard.test.mjs` pins that report-only property on the source text, because
// "it only reports" is exactly the kind of promise a later edit breaks quietly.
//
// Every worktree is measured, not just the checkout the script runs from: the bloat is usually in a
// worktree nobody has opened for weeks. Worktree roots are parsed straight out of
// `.git/worktrees/*/gitdir` rather than shelling out to `git worktree list`, because a `git.exe`
// spawn from the weekly scheduled task would flash a console window across the owner's screen —
// the exact defect `scripts/console-window-guard.test.mjs` exists to prevent.
//
// It lives in scripts/lib/ for the same reason compaction-window.mjs does: usage-audit.mjs scans
// ~/.claude/projects at import time, so importable-and-testable means keeping the logic out of it.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * The flag threshold. 20 GiB is the owner's number ("over ~20GB"), not a derived one: it is the
 * point past which a single build tree is worth a deliberate clean rather than a shrug. It is a
 * REPORT line, never a gate — nothing fails because a target directory is large.
 */
export const TARGET_BLOAT_BYTES = 20 * 1024 ** 3;

/**
 * Safety valve on the walk. A 7.8 GB target measured in 322 ms across 8106 files (Rust output is a
 * few large files, not many small ones), so this is nowhere near reachable in normal use — it is
 * here so a pathological tree can never hang the Monday scheduled task. When it trips, the flag
 * says the number is a floor rather than pretending it is exact.
 */
export const WALK_ENTRY_CAP = 200_000;

/**
 * How long a build tree may sit untouched before its bytes are dead weight rather than a working
 * set. Two weeks is well past any lane on this repo that is still being iterated in — whatever is
 * in that target directory will be thrown away by the next `cargo build` there anyway; it is only
 * being stored until then.
 *
 * This exists because the per-tree threshold above answered the wrong question. Measured
 * 2026-08-24: SIX build trees holding 59.08 GB between them and **not one of them over 20 GB**, on
 * a drive at 92%. So the flag had been green for four days while the machine carried three times
 * the owner's own line. The cost was never one fat tree; it was spread across worktrees nobody had
 * opened in days, and size alone structurally cannot see that. Size AND idleness can.
 */
export const IDLE_BLOAT_DAYS = 14;

/**
 * Floor under the idle flag, so the report names trees worth acting on instead of every stale
 * scratch checkout. 2 GiB is well under one debug build of this crate — below it the reclaim is
 * smaller than the rebuild it costs.
 */
export const IDLE_BLOAT_BYTES = 2 * 1024 ** 3;

/**
 * The fleet line: build output totalled across every worktree. Derived from the owner's number
 * rather than invented — at twice the point where ONE tree is worth a deliberate clean, the machine
 * is paying that cost whether or not any single tree shows it, and that total is exactly the fact a
 * per-tree flag can never report.
 */
export const FLEET_BLOAT_BYTES = 2 * TARGET_BLOAT_BYTES;

const GiB = 1024 ** 3;
const DAY_MS = 24 * 60 * 60 * 1000;
const gb = (bytes) => (bytes / GiB).toFixed(1);

/**
 * The shared `.git` directory for a checkout, whether it is the main worktree (`.git` is a real
 * directory) or a linked worktree (`.git` is a file reading `gitdir: <common>/worktrees/<name>`).
 * Returns null for anything that is not a git checkout at all — a scratch copy driven through
 * USAGE_AUDIT_REPO is a legitimate caller, not an error.
 */
export function gitCommonDir(repoRoot) {
  const dotGit = join(repoRoot, ".git");
  try {
    if (statSync(dotGit).isDirectory()) return dotGit;
  } catch {
    return null;
  }
  try {
    const pointer = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, "utf8"));
    if (!pointer) return null;
    // <common>/worktrees/<name> -> <common>
    return resolve(dirname(dirname(pointer[1].trim())));
  } catch {
    return null;
  }
}

/**
 * Every checkout attached to this repository: the main worktree plus each linked worktree, plus the
 * caller's own root (which may be neither, under USAGE_AUDIT_REPO). Absent paths are dropped —
 * git keeps administrative files for a worktree whose folder has already been removed.
 */
export function worktreeRoots(repoRoot) {
  const roots = [resolve(repoRoot)];
  const common = gitCommonDir(repoRoot);
  if (common) {
    roots.push(resolve(dirname(common)));
    let names = [];
    try {
      names = readdirSync(join(common, "worktrees"));
    } catch { /* a repo with no linked worktrees has no such directory */ }
    for (const name of names) {
      try {
        const gitFile = readFileSync(join(common, "worktrees", name, "gitdir"), "utf8").trim();
        roots.push(resolve(dirname(gitFile)));
      } catch { /* a half-removed worktree record is not a failure */ }
    }
  }
  const seen = new Set();
  return roots.filter((root) => {
    const key = process.platform === "win32" ? root.toLowerCase() : root;
    if (seen.has(key) || !existsSync(root)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Recursive size of a directory in bytes. Iterative (a deep target tree must not blow the stack),
 * symlink/junction-skipping (this repo junctions node_modules between worktrees, and counting
 * through one would both double-count and escape the tree), and bounded by `cap` entries.
 *
 * Returns null when the directory does not exist — the common case for a checkout that has never
 * been built. Otherwise `{ bytes, files, capped, newestMs }`, where `newestMs` is the most recent
 * file mtime seen anywhere in the walk — 0 for a directory holding no readable file, and a floor
 * rather than the true newest when `capped` is set, for the same reason `bytes` is.
 */
export function measureDir(dir, cap = WALK_ENTRY_CAP) {
  if (!existsSync(dir)) return null;
  let bytes = 0;
  let files = 0;
  let entries = 0;
  let capped = false;
  let newestMs = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let dirents = [];
    try {
      dirents = readdirSync(current, { withFileTypes: true });
    } catch { continue; }
    for (const dirent of dirents) {
      if (++entries > cap) { capped = true; break; }
      if (dirent.isSymbolicLink()) continue;
      const path = join(current, dirent.name);
      if (dirent.isDirectory()) { stack.push(path); continue; }
      files += 1;
      try {
        const stat = statSync(path);
        bytes += stat.size;
        // Newest write anywhere in the tree, taken from the stat the size already needed. This is
        // what separates a working set from dead weight, and it costs nothing extra to collect.
        if (stat.mtimeMs > newestMs) newestMs = stat.mtimeMs;
      } catch { /* vanished mid-walk */ }
    }
    if (capped) break;
  }
  return { bytes, files, capped, newestMs };
}

/** The clean the report offers and never runs. */
const cleanHint = (root) => `\`cargo clean --manifest-path "${join(root, "src-tauri", "Cargo.toml")}"\``;

/**
 * The health-flag lines for this repository's build output, in three classes, biggest first within
 * each. An empty array when everything is within bounds (the audit prints its own "no flags" line,
 * so silence here is correct).
 *
 *   1. OVERSIZE — one worktree's target past the owner's ~20 GB line. The original flag, unchanged.
 *   2. IDLE — a target under that line but untouched for `idleDays`. This is the class the first
 *      flag could not see and the machine was actually paying for: on 2026-08-24 four such trees
 *      held 35.9 GB between them, every one of them under the oversize threshold.
 *   3. FLEET — the total across every worktree, once it passes twice the per-tree line. A single
 *      number the owner can act on when no individual tree looks wrong.
 *
 * Still report-only in every class: the lines name the clean, they never run it. That property is
 * asserted against this file's own source in `scripts/disk-bloat-guard.test.mjs`.
 */
export function diskBloatFlags(
  repoRoot,
  {
    threshold = TARGET_BLOAT_BYTES,
    cap = WALK_ENTRY_CAP,
    idleDays = IDLE_BLOAT_DAYS,
    idleThreshold = IDLE_BLOAT_BYTES,
    fleetThreshold = FLEET_BLOAT_BYTES,
    now = Date.now(),
  } = {},
) {
  const trees = [];
  for (const root of worktreeRoots(repoRoot)) {
    const measured = measureDir(join(root, "src-tauri", "target"), cap);
    if (measured) trees.push({ root, ...measured });
  }
  trees.sort((a, b) => b.bytes - a.bytes);

  const flags = trees
    .filter((tree) => tree.bytes > threshold)
    .map(
      ({ root, bytes, capped }) =>
        `🟡 ${basename(root)}/src-tauri/target holds ${capped ? "at least " : ""}${gb(bytes)} GB of Rust build ` +
        `output (> ${gb(threshold)} GB)${capped ? ", measurement capped mid-walk" : ""} — report only, nothing was ` +
        `deleted. If that worktree is idle: ${cleanHint(root)}.`,
    );

  for (const { root, bytes, newestMs } of trees) {
    if (bytes > threshold || bytes <= idleThreshold) continue;
    // newestMs of 0 means the walk read no file at all; "unknown age" is not "old".
    if (!newestMs || now - newestMs <= idleDays * DAY_MS) continue;
    const days = Math.floor((now - newestMs) / DAY_MS);
    flags.push(
      `🟡 ${basename(root)}/src-tauri/target holds ${gb(bytes)} GB and has not been written to in ` +
        `${days} days — under the ${gb(threshold)} GB line, so it is not the flag above; it is build output no ` +
        `lane is using. Report only, nothing was deleted: ${cleanHint(root)}.`,
    );
  }

  const total = trees.reduce((sum, tree) => sum + tree.bytes, 0);
  if (total > fleetThreshold) {
    flags.push(
      `🟡 ${gb(total)} GB of Rust build output across ${trees.length} worktrees (> ${gb(fleetThreshold)} GB total) ` +
        `— no single tree has to be over the ${gb(threshold)} GB line for the machine to be carrying this. ` +
        `Biggest: ${trees[0] ? `${basename(trees[0].root)} at ${gb(trees[0].bytes)} GB` : "none"}. Report only, ` +
        `nothing was deleted.`,
    );
  }

  return flags;
}
