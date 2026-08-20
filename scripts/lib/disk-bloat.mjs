// Build-output disk bloat, as a report-only usage-audit health flag (owner-requested 2026-08-20).
//
// Why this exists: the weekly audit nags about the boot tax in KILOBYTES while the same machine's
// real disk cost is Rust build output measured in GIGABYTES, and nothing looked at it. One
// `src-tauri/target` measured 7.8 GB on 2026-08-20 and this repo runs six worktrees, each free to
// grow its own. Past ~20 GB a single tree is worth a deliberate `cargo clean`, so the report says
// so — and stops there. This module NEVER deletes, cleans, or mutates anything; the owner decides.
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

const GiB = 1024 ** 3;
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
 * been built.
 */
export function measureDir(dir, cap = WALK_ENTRY_CAP) {
  if (!existsSync(dir)) return null;
  let bytes = 0;
  let files = 0;
  let entries = 0;
  let capped = false;
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
      try { bytes += statSync(path).size; } catch { /* vanished mid-walk */ }
    }
    if (capped) break;
  }
  return { bytes, files, capped };
}

/**
 * The health-flag lines for this repository's build output. One line per worktree over the
 * threshold, biggest first; an empty array when everything is within bounds (the audit prints its
 * own "no flags" line, so silence here is correct).
 */
export function diskBloatFlags(repoRoot, { threshold = TARGET_BLOAT_BYTES, cap = WALK_ENTRY_CAP } = {}) {
  const over = [];
  for (const root of worktreeRoots(repoRoot)) {
    const target = join(root, "src-tauri", "target");
    const measured = measureDir(target, cap);
    if (!measured || measured.bytes <= threshold) continue;
    over.push({ root, ...measured });
  }
  return over
    .sort((a, b) => b.bytes - a.bytes)
    .map(
      ({ root, bytes, capped }) =>
        `🟡 ${basename(root)}/src-tauri/target holds ${capped ? "at least " : ""}${gb(bytes)} GB of Rust build ` +
        `output (> ${gb(threshold)} GB)${capped ? ", measurement capped mid-walk" : ""} — report only, nothing was ` +
        `deleted. If that worktree is idle: \`cargo clean --manifest-path "${join(root, "src-tauri", "Cargo.toml")}"\`.`,
    );
}
