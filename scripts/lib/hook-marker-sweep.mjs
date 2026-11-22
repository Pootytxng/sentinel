// Marker sweep for the repo's Claude Code hooks (D1f, 2026-11-22).
//
// Four hooks keep a small per-session marker file in the OS temp folder (throttles and series):
// context-size-advisor, self-review-reminder, ship-reminder and subagent-throttle. Nothing ever
// removed them, and on the owner's PC they had piled up into thousands (compy-ctxadvisor-* alone
// ~6,400). Each hook now calls sweepOwnMarkers(<its own name>) on every run. The sweep:
//   - looks ONLY in os.tmpdir() (the caller passes the folder; tests pass a scratch folder),
//   - removes ONLY regular files whose WHOLE name matches that hook's own marker pattern below,
//   - only when older than MAX_AGE_MS by modified time (a live session touches its marker every run),
//   - never a folder, never recursively, never a link,
//   - runs at most once per SWEEP_EVERY_MS per hook (a stamp file of the hook's own pattern), so a busy
//     temp folder is listed once a day, not on every tool call,
//   - spends at most SWEEP_BUDGET_MS per run (hooks have a 10 s timeout and the first run can face tens
//     of thousands of temp entries): on overrun it back-dates the stamp so the next run, a minute later,
//     carries on, and the backlog clears in slices,
//   - writes the stamp only as a regular file it creates itself, never through a link,
//   - swallows every error: a hook must never fail or slow a session over housekeeping.
import { closeSync, futimesSync, lstatSync, openSync, readdirSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";

export const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
export const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;
export const SWEEP_BUDGET_MS = 1500;
/** After an overrun the next sweep may start this soon. */
export const RESUME_AFTER_MS = 60 * 1000;

// Exactly the names each hook writes (session ids are reduced to [A-Za-z0-9-] by every hook), plus the
// hook's own sweep stamp. Other hooks' and other programs' files never match. The one shared name family:
// .codex/hooks/self-review-reminder.mjs:85 writes the same compy-selfreview- names, so this sweep also
// removes that hook's markers once they are two days old (same meaning, same per-session throttle).
export const MARKERS = {
  "context-size-advisor": { pattern: /^compy-ctxadvisor-(?:series-|thrash-|persist-)?[A-Za-z0-9-]*$/, stamp: "compy-ctxadvisor-sweep" },
  "self-review-reminder": { pattern: /^compy-selfreview-[A-Za-z0-9-]*$/, stamp: "compy-selfreview-sweep" },
  "ship-reminder": { pattern: /^compy-shipreminder-[A-Za-z0-9-]*$/, stamp: "compy-shipreminder-sweep" },
  "subagent-throttle": { pattern: /^compy-subagent-burst-[A-Za-z0-9-]*\.json$/, stamp: "compy-subagent-burst-sweep.json" },
};

/**
 * Remove `hook`'s own stale marker files from `dir`. Returns the names removed (for tests); never throws.
 * @param {string} hook a key of MARKERS
 * @param {string} dir the folder to sweep (os.tmpdir() in the hooks)
 * @param {number} now ms since the epoch
 * @param {number} budgetMs wall-clock time this run may spend listing and removing (tests pass 0)
 */
export function sweepOwnMarkers(hook, dir, now = Date.now(), budgetMs = SWEEP_BUDGET_MS) {
  const removed = [];
  try {
    const own = MARKERS[hook];
    if (!own) return removed;
    const start = Date.now();
    const stampPath = join(dir, own.stamp);
    let stamp = null;
    try {
      stamp = lstatSync(stampPath);
    } catch {
      /* no stamp yet: sweep */
    }
    if (stamp) {
      // Anything but a regular file there (a link, a folder) is not ours: do not sweep, do not touch it.
      if (!stamp.isFile()) return removed;
      if (now - stamp.mtimeMs < SWEEP_EVERY_MS) return removed;
    }
    if (!writeStamp(stampPath, stamp !== null, now)) return removed;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (Date.now() - start >= budgetMs) {
        // Out of time: let the next run, a minute from now, pick up where the backlog stands.
        // Re-created the same safe way (only if it is still a regular file), dated so it is due again soon.
        let st = null;
        try {
          st = lstatSync(stampPath);
        } catch {
          /* gone: the next run sweeps anyway */
        }
        if (!st || st.isFile()) writeStamp(stampPath, st !== null, now - SWEEP_EVERY_MS + RESUME_AFTER_MS);
        break;
      }
      try {
        if (!entry.isFile() || entry.name === own.stamp || !own.pattern.test(entry.name)) continue;
        const path = join(dir, entry.name);
        const st = lstatSync(path);
        if (!st.isFile() || now - st.mtimeMs < MAX_AGE_MS) continue;
        unlinkSync(path);
        removed.push(entry.name);
      } catch {
        /* one unreadable or locked entry never stops the rest */
      }
    }
  } catch {
    /* housekeeping only */
  }
  return removed;
}

/**
 * (Re)create the stamp as a new regular file: an existing stamp (already checked to be a regular file)
 * is removed first, then the file is opened with exclusive create ("wx"), which never follows a link
 * planted in between. Its mtime is set to `at`. Returns false when the stamp could not be written.
 */
function writeStamp(stampPath, exists, at) {
  try {
    if (exists) unlinkSync(stampPath);
    const fd = openSync(stampPath, "wx");
    try {
      writeSync(fd, String(at));
      futimesSync(fd, at / 1000, at / 1000); // through the handle, never by name
    } finally {
      closeSync(fd);
    }
    return true;
  } catch {
    return false;
  }
}
