/**
 * Whether a q7-probe run must kill the app before it exits.
 *
 * THE DEFECT THIS EXISTS FOR (2026-08-22). `q7-probe coldstart` kills every compy.exe at the START
 * of each sample and never at the end, so the LAST sample's app was left running on the owner's
 * desktop — a window he did not open, from a binary in a worktree's `target/release`, sitting there
 * for twenty minutes. That is untidy on its own. What made it a real defect is what it silently
 * disabled: `launch-focus-guard`'s runtime tier refuses to measure while a compy holds the
 * single-instance lock, so twelve consecutive attempts to reproduce issue #121 measured nothing and
 * reported "47 passed" each time. One stray process turned a gate into decoration.
 *
 * The rule is deliberately narrow: kill what THIS RUN launched, never what it found. A probe that
 * attaches to an app the owner already had open (`eval`, `restore`) must leave it exactly as it was
 * — killing that would be a worse bug than the leak, and it is the reason this is a decision
 * function with a name rather than an unconditional call in a `finally`.
 *
 * `--keep-open` is the escape hatch for the one real case: measuring, then poking at the app by
 * hand afterwards. It is a flag, so it is visible in the command that used it.
 */
export function shouldCleanUp({ launchedByProbe, keepOpen } = {}) {
  if (!launchedByProbe) return false;
  return !keepOpen;
}

/** Human-readable reason, for the line the probe prints. Kept next to the rule it explains. */
export function cleanUpReason({ launchedByProbe, keepOpen } = {}) {
  if (!launchedByProbe) return "nothing to clean up: this run attached to an app it did not launch";
  if (keepOpen) return "left running by --keep-open";
  return "killing the app this run launched";
}
