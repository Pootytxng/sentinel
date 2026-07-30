// The Class A overlay (spec §5.3): the launcher installs its own tripwire, and nothing else.
//
// The line this module enforces: the launcher may install VERIFICATION, never BEHAVIOUR. This
// overlay adds one SessionStart hook that runs `session-assert` from the control folder. It writes
// no `env` key — the context window and subagent model are Class B, which is verify-and-refuse.
//
// It lands in `.claude/settings.local.json`, which is gitignored, so it can never pollute a diff or
// travel with a branch. It is announced in the launcher's output and recorded in the claim, and
// `--no-overlay` opts out. Written only after the preflight PASSes and the claim is held.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const ASSERT_HOOK_MARKER = "compy-entry:session-assert";
export const OVERLAY_FILE = join(".claude", "settings.local.json");

const readLocal = (dir) => {
  const file = join(dir, OVERLAY_FILE);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return {};
  }
};

const assertHookGroup = (controlDir) => ({
  hooks: [
    {
      type: "command",
      command: `node "${join(controlDir, "tools", "entry", "session-assert-hook.mjs")}"`,
      timeout: 10,
      statusMessage: ASSERT_HOOK_MARKER,
    },
  ],
});

const isOurs = (group) => JSON.stringify(group ?? {}).includes(ASSERT_HOOK_MARKER);

/** What writeOverlay WOULD do. Nothing is written unannounced. */
export function planOverlay({ dir, controlDir }) {
  const current = readLocal(dir);
  const next = { hooks: { SessionStart: [assertHookGroup(controlDir)] } };
  const already = (current.hooks?.SessionStart ?? []).some(isOurs);
  return {
    file: join(dir, OVERLAY_FILE),
    next,
    adds: already ? [] : ["hooks.SessionStart"],
    changed: !already,
    current,
  };
}

/** Merge the assert hook in, preserving everything already present. Idempotent. */
export function writeOverlay({ dir, controlDir }) {
  const plan = planOverlay({ dir, controlDir });
  if (!plan.changed) return { ...plan, wrote: false };

  const merged = { ...plan.current, hooks: { ...(plan.current.hooks ?? {}) } };
  merged.hooks.SessionStart = [
    ...(merged.hooks.SessionStart ?? []).filter((g) => !isOurs(g)),
    assertHookGroup(controlDir),
  ];

  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(plan.file, `${JSON.stringify(merged, null, 2)}\n`);
  return { ...plan, wrote: true };
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
