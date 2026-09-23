import type { AppliedChange, Priorities, PriorityItem, SessionSummary } from "../types";

// (The former `activeChangeCount(changes)` was deleted by #452: it counted `is_still_active` off the
// bare ledger list, which reads "0" when the ledger can't be read and counts a row whose live check
// failed as in effect. The one in-effect count is `inEffectCounts()` in data/machine-model.ts.)

/**
 * Did Windows Game Mode revert after Compy applied it? True when a "game-mode" change was applied
 * (not rolled back) but is no longer live — i.e. something reset it externally. On most rigs that's a
 * GPU recording app (AMD Adrenalin / NVIDIA ShadowPlay) flipping Game Mode off at login. Lets the UI
 * tell the user honestly ("re-applying won't hold") instead of silently re-offering the apply.
 */
export function gameModeRevertedExternally(changes: AppliedChange[]): boolean {
  return changes.some(
    (c) => c.rec_id === "game-mode" && c.status === "applied" && !c.is_still_active,
  );
}

/** Top N biggest limiters (already rank-ordered by the backend). */
export function topLimiters(priorities: Priorities | null, n: number): PriorityItem[] {
  return priorities ? priorities.limiters.slice(0, n) : [];
}

/** "Already fine" + "not worth touching" — the honest "leave it alone" count. */
export function leaveAloneCount(priorities: Priorities | null): number {
  if (!priorities) return 0;
  return priorities.already_fine.length + priorities.not_worth_touching.length;
}

/** Most recent session by start time, or null. Does not mutate the input. */
export function latestSession(sessions: SessionSummary[]): SessionSummary | null {
  if (sessions.length === 0) return null;
  return [...sessions].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))[0];
}
