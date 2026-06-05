import type { AppliedChange, Priorities, PriorityItem, SessionSummary } from "../types";

/** Changes Compy applied that are still live (the honest "what's improved" count). */
export function activeChangeCount(changes: AppliedChange[]): number {
  return changes.filter((c) => c.status === "applied" && c.is_still_active).length;
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
