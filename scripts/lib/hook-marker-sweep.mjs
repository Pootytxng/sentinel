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
//   - swallows every error: a hook must never fail or slow a session over housekeeping.
import { lstatSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;
export const SWEEP_EVERY_MS = 24 * 60 * 60 * 1000;

// Exactly the names each hook writes (session ids are reduced to [A-Za-z0-9-] by every hook), plus the
// hook's own sweep stamp. Nothing else in the temp folder can match.
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
 */
export function sweepOwnMarkers(hook, dir, now = Date.now()) {
  const removed = [];
  try {
    const own = MARKERS[hook];
    if (!own) return removed;
    const stampPath = join(dir, own.stamp);
    try {
      if (now - lstatSync(stampPath).mtimeMs < SWEEP_EVERY_MS) return removed;
    } catch {
      /* no stamp yet: sweep */
    }
    try {
      writeFileSync(stampPath, String(now));
    } catch {
      /* ignore */
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
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
