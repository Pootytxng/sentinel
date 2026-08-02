const entry = (priority, authority, summary, impact, recommendation, kind, label, provider) => Object.freeze({
  priority, authority, summary, impact, recommendation,
  action: Object.freeze({ kind, label, ...(provider ? { provider } : {}) }),
});

export const PLAYBOOK = Object.freeze({
  WORKTREE_MULTI_WRITER: entry("collision", "agent", "Two sessions point at the same worktree.", "They could overwrite each other's work.", "Return to the session that already owns it.", "open-claude", "Return to Claude", "claude"),
  PROCESS_COLLISION: entry("collision", "read", "A live process is using this folder.", "Starting another write could collide with work already running.", "Inspect the running owner and wait or return to it.", "inspect", "Inspect owner"),
  BOARD_FOLDER_COLLISION: entry("collision", "owner", "Two active work items name the same folder.", "The ownership ledger cannot guarantee one writer.", "Choose one owner before either item continues.", "owner-decision", "Review ownership"),
  DIRTY_WORKTREE: entry("broken", "agent", "This worktree contains unsaved work.", "Automatic cleanup could discard or hide someone else's changes.", "Preserve it and inspect the exact changes before deciding.", "open-codex", "Open in Codex", "codex"),
  DIVERGED_BRANCH: entry("broken", "agent", "This branch and its upstream have diverged.", "A blind pull, reset, or rebase could lose history.", "Review both histories and choose a recovery deliberately.", "open-codex", "Open in Codex", "codex"),
  MISSING_CANONICAL_HOOKS: entry("broken", "read", "Required workflow guards are missing.", "A session could start without the protections its settings register.", "Restore only the tracked canonical set and recheck everything.", "inspect", "Review repair"),
  FOREIGN_HOOK_OR_OVERLAY: entry("broken", "agent", "A workflow hook points outside the owned canonical location.", "Compy cannot prove that overwriting it is safe.", "Preserve it and inspect who owns the registration.", "open-claude", "Open in Claude", "claude"),
  CLAIM_EXPIRED: entry("owner", "owner", "A work claim has expired.", "Expiry is an alarm, not permission to take over.", "Inspect the real worktree and process before assigning a new owner.", "owner-decision", "Inspect claim"),
  OWNER_DECISION: entry("owner", "owner", "Work is waiting for your decision.", "No tool can honestly choose this product or approval gate for you.", "Review the recorded recommendation and accept or redirect it.", "owner-decision", "Review decision"),
  WAITING_EXTERNAL: entry("owner", "external", "Work is waiting on something outside the project.", "Repeating the same work cannot change that dependency.", "Refresh the dependency and continue only when its state changes.", "scan", "Check again"),
  CI_NO_EXECUTION: entry("owner", "external", "GitHub checks did not run.", "A red mark with zero executed jobs proves nothing about the code.", "Use the local verification gate and handle the account state separately.", "run-audit", "Run local check"),
  CI_FAILED: entry("broken", "agent", "A real CI job ran and failed.", "The branch does not have a clean hosted verification result.", "Open the exact failure and repair the cause without bypassing it.", "open-codex", "Open in Codex", "codex"),
  SOURCE_UNREACHABLE: entry("broken", "read", "A required project source is unreachable.", "Compy cannot safely infer the missing state.", "Restore the source and scan again.", "scan", "Scan again"),
  UNPUBLISHED_WORK: entry("advisory", "agent", "Work exists only on this machine or has no durable pointer.", "A disk failure or forgotten folder could lose it.", "Inspect it and decide whether to preserve or retire it.", "open-codex", "Open in Codex", "codex"),
  ORPHAN_FOLDER: entry("advisory", "read", "A folder is no longer a known checkout.", "It may be harmless debris or preserved work; the name alone cannot decide.", "Inspect its contents before any cleanup.", "inspect", "Inspect folder"),
  STALE_IDE_LOCK: entry("advisory", "read", "An editor lock appears stale.", "It can confuse handoff detection, but age alone does not prove it is dead.", "Verify its endpoint and process before cleanup.", "inspect", "Verify lock"),
  UNKNOWN_CONDITION: entry("advisory", "agent", "Compy found a condition it does not yet recognize.", "Guessing a repair would be less safe than preserving the evidence.", "Send the structured evidence to Claude for diagnosis.", "open-claude", "Open in Claude", "claude"),
});

export function resolveDoctorFinding(finding) {
  const base = PLAYBOOK[finding.code] ?? PLAYBOOK.UNKNOWN_CONDITION;
  return { ...finding, ...base, action: { ...base.action } };
}
