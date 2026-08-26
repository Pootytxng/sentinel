import type { AppliedChange, Recommendation } from "../types";

// FirstWin selection + verification (P2 "first-win action → rollback → proof journey", issue #49).
//
// `TrustMoment` covers the first two thirds of that journey on a DEMO setting, before the user has
// risked anything: apply, receipt, roll back, all in ten seconds while the Trust Ledger is empty.
// What has never existed is the third: after the user applies their own FIRST real change, nothing
// closes the loop. They are left holding a claim — "Compy changed it" — with no way to see that it
// is true, and no undo in front of them at the moment they most want one.
//
// WHAT COUNTS AS PROOF HERE, and what deliberately does not. The honest proof available at this
// moment is NOT "your PC got faster" — no play session has happened, so any speed claim would be
// fabricated, and the doctrine forbids it. It is the narrower, checkable one: **the ledger says the
// change is live; Compy re-reads the machine and says whether it agrees.** That is the same
// ledger-vs-machine comparison `drift.rs` runs, asked about one change at the one moment it means
// most. `is_still_active` is what Compy REMEMBERS; `currently_applied` on a freshly-fetched
// recommendation is what Compy just SAW. Agreement is a real, earned proof. Disagreement is a real
// finding, not a failure to hide.
//
// Pure and tested so the eligibility gate and the three verdicts can't drift from the component.

export const FIRST_WIN_KEY = "compy_first_win";

/** Ledger entries the machine should still be carrying: applied, never rolled back. */
export function activeChanges(changes: AppliedChange[]): AppliedChange[] {
  return changes.filter((c) => c.status === "applied" && c.is_still_active);
}

/**
 * The change this card is about: the newest one the ledger still calls live. Newest rather than
 * oldest because it is the one the user just pressed, and the one they can still picture — the
 * count in the copy is what keeps "first" from becoming a claim we cannot support on a rig that
 * applied a batch.
 */
export function pickFirstWinChange(changes: AppliedChange[]): AppliedChange | null {
  const active = activeChanges(changes);
  if (active.length === 0) return null;
  return active.reduce((newest, c) => (c.applied_at > newest.applied_at ? c : newest));
}

/**
 * Offered only to someone who has actually made a change and has not seen this once already.
 * `TrustMoment` gates on the exact complement (`changes.length === 0`), so the two can never be on
 * screen together: one is the rehearsal before the first change, this is the follow-through after
 * it. A demo run leaves rolled-back entries, which `activeChanges` drops — so watching the demo
 * does not by itself summon this card.
 */
export function shouldOfferFirstWin(changes: AppliedChange[], done: boolean): boolean {
  return !done && pickFirstWinChange(changes) !== null;
}

/** What a fresh look at the machine says about a change the ledger believes is live. */
export type Verification = "held" | "reverted" | "unreadable";

/**
 * `recs` must be a FRESHLY fetched list (the caller re-runs the scan first) — this compares what
 * Compy just read off the machine against what its ledger remembers. A rec that is no longer in the
 * list at all is `unreadable`: Compy will not claim either way about a setting it cannot see, which
 * is the same rule the sensor surfaces follow for an unavailable reading.
 */
export function verifyChangeHeld(recs: Recommendation[] | null, recId: string): Verification {
  if (!recs) return "unreadable";
  const rec = recs.find((r) => r.id === recId);
  if (!rec) return "unreadable";
  return rec.currently_applied ? "held" : "reverted";
}
