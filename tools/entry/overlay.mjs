// The Class A overlay (spec §5.3): the launcher installs its own tripwire, and nothing else.
//
// The line this module enforces: the launcher may install VERIFICATION, never BEHAVIOUR. This
// overlay adds one SessionStart hook that runs `session-assert` from the control folder. It writes
// no `env` key — the context window and subagent model are Class B, which is verify-and-refuse.
//
// It lands in `.claude/settings.local.json`, which is gitignored, so it can never pollute a diff or
// travel with a branch. It is announced in the launcher's output and recorded in the claim, and
// `--no-overlay` opts out. Written only after the preflight PASSes and the claim is held.
//
// FALLBACK ONLY (owner decision 3, Issue #18, 2026-07-30). The tracked `.claude/settings.json`
// registration is primary; this overlay covers the branches that predate it. It must therefore stand
// DOWN when the target already registers the assert itself — hook groups CONCATENATE across settings
// layers, so tracked-plus-overlay runs the assert twice, the first run consumes the single-use launch
// token, and the second refuses TOKEN_CONSUMED. That is every launch into an up-to-date branch
// failing. Guarded by overlay.test.mjs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ASSERT_HOOK_MARKER = "compy-entry:session-assert";
export const OVERLAY_FILE = join(".claude", "settings.local.json");
export const TRACKED_SETTINGS_FILE = join(".claude", "settings.json");

const readJson = (file) => {
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
};

const readLocal = (dir) => readJson(join(dir, OVERLAY_FILE));

/** Does the target's own tracked settings already register the assert? Then we are not needed. */
const trackedRegistersAssert = (dir) => {
  const tracked = readJson(join(dir, TRACKED_SETTINGS_FILE));
  return (tracked.hooks?.SessionStart ?? []).some(isOurs);
};

const assertHookGroup = (controlDir) => ({
  hooks: [
    {
      type: "command",
      command: `node "${join(controlDir, ".claude", "hooks", "session-root-assert.mjs")}"`,
      timeout: 10,
      statusMessage: ASSERT_HOOK_MARKER,
    },
  ],
});

const isOurs = (group) => JSON.stringify(group ?? {}).includes(ASSERT_HOOK_MARKER);

/** What writeOverlay WOULD do. Nothing is written unannounced. */
export function planOverlay({ dir, controlDir }) {
  const current = readLocal(dir);
  const desired = assertHookGroup(controlDir);
  const next = { hooks: { SessionStart: [desired] } };
  const file = join(dir, OVERLAY_FILE);
  const ours = (current.hooks?.SessionStart ?? []).filter(isOurs);

  // Standing down is not the same as leaving the last one lying there. An overlay we no longer want
  // still RUNS — a second assert that consumes the token the first one needed — and it addresses the
  // control folder by absolute path, so it also breaks the moment that folder renames the file it
  // points at. Both were measured on 2026-07-30. What we installed, we take back.
  if (trackedRegistersAssert(dir)) {
    const stale = ours.length > 0;
    return {
      file,
      next,
      adds: [],
      removes: stale ? ["hooks.SessionStart"] : [],
      changed: stale,
      current,
      reason: stale
        ? "the branch registers the root assert itself now, so this leftover overlay is a second copy — removing it"
        : "the branch's tracked settings already register the root assert — a second copy would consume the launch token twice",
    };
  }

  // Present is not correct: an overlay pointing at a path the control folder has since moved is worse
  // than none, because it fails closed on every later launch into this folder.
  const upToDate = ours.length === 1 && JSON.stringify(ours[0]) === JSON.stringify(desired);
  return {
    file,
    next,
    adds: upToDate ? [] : ["hooks.SessionStart"],
    removes: [],
    changed: !upToDate,
    current,
    reason: upToDate
      ? "the overlay is already in place"
      : ours.length
        ? "the overlay points at a different control folder path — refreshing it"
        : null,
  };
}

/** Merge the assert hook in, preserving everything already present. Idempotent. */
export function writeOverlay({ dir, controlDir }) {
  const plan = planOverlay({ dir, controlDir });
  if (!plan.changed) return { ...plan, wrote: false, removed: false };
  if (plan.removes.length > 0) {
    removeOverlay({ dir });
    return { ...plan, wrote: false, removed: true };
  }

  const merged = { ...plan.current, hooks: { ...(plan.current.hooks ?? {}) } };
  merged.hooks.SessionStart = [
    ...(merged.hooks.SessionStart ?? []).filter((g) => !isOurs(g)),
    assertHookGroup(controlDir),
  ];

  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(plan.file, `${JSON.stringify(merged, null, 2)}\n`);
  return { ...plan, wrote: true, removed: false };
}

/** Take back exactly what was added, and nothing else. */
export function removeOverlay({ dir }) {
  const file = join(dir, OVERLAY_FILE);
  if (!existsSync(file)) return { removed: false };
  const current = readLocal(dir);
  if (!current.hooks?.SessionStart) return { removed: false };

  const kept = current.hooks.SessionStart.filter((g) => !isOurs(g));
  const merged = { ...current, hooks: { ...current.hooks, SessionStart: kept } };
  writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`);
  return { removed: true, file };
}
