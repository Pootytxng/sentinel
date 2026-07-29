import type { PriorityItem, Provenance, Recommendation } from "../types";

// rec-detail — the ONE place a priority row turns back into the actual recommendation(s) it is
// about, and the ONE place we decide which action a rec honestly offers.
//
// Why this exists (recovery train items 1–5, tester feedback 2026-07-22): every surface used to
// re-derive a rec by hand with `recs.find(r => r.id === (lim.linked ?? lim.id))`. That silently
// returns nothing for an AGGREGATE row ("2 safe tweaks not applied", linked: null) — and every
// caller then fell through to a dead-end "hands-on fix" chip that promised steps it never showed.
// The identity now rides in the payload (`PriorityItem.rec_ids`, populated in priorities.rs); this
// module reads it. NEVER re-derive a rec from a row's prose.
//
// PURE + data-only on purpose: no i18n, no JSX, no IPC. It returns FACTS (which are already
// localized catalog data from the Rust side) plus a discriminant; each surface writes its own copy
// in its own voice — FirstCheck speaks the locked arc copy, Check/Fix speak through useTranslation.
// Nothing here claims an improvement: every string is the catalog's own, and `impact` always rides
// with its `provenance` so a caller can label an unmeasured expectation as exactly that.

/** What a recommendation honestly offers the user RIGHT NOW. */
export type RecAction =
  /** Compy can apply it through the audited apply/rollback path. */
  | "apply"
  /** Already in the recommended state — nothing to do. */
  | "applied"
  /** A real change, but Compy can't flip it: the user does it (walkthrough where one exists). */
  | "manual"
  /** This rig can't use it — out of the denominator, never an action. */
  | "ineligible";

export type RecDetail = {
  id: string;
  /** The recommendation's name. */
  title: string;
  /** What Compy DETECTED on this rig — the measured current state (`applies_to`, e.g. "Currently: Off"). */
  detected: string;
  /** What the setting actually does / why it matters (`description`). */
  why: string;
  /** What changes if it's applied (`impact`) — ALWAYS render alongside `provenance`. */
  impact: string;
  /** The honesty level of `impact`: verified · measured-signal · expected-impact. Never drop it. */
  provenance: Provenance;
  /** Current state: is the recommended state already reached? */
  applied: boolean;
  /** Risk tier straight from the catalog. */
  severity: Recommendation["severity"];
  /** The honest trade-off, when the catalog names one. */
  downside: string | null;
  /** Compy holds (or would capture) a typed rollback contract for this change — true only where
   *  Compy itself is the one applying it. A hands-on change has nothing for Compy to roll back. */
  reversible: boolean;
  /** Why this rig can't use it — only ever set when `action === "ineligible"`. */
  ineligibleReason: string | null;
  action: RecAction;
};

/**
 * The single decision: what can the user honestly do with this rec?
 *
 * `isAppliable` is the frontend mirror of the backend's APPLIABLE_REC_IDS (App.tsx, kept in sync by
 * appliable-parity.test.ts). Checking it is NOT optional: `apply_recommendation` only dispatches
 * those ids, so offering "Apply" on anything else hands the user a button that throws.
 */
export function describeRec(rec: Recommendation, isAppliable: (recId: string) => boolean): RecDetail {
  const eligible = rec.eligible !== false;
  const action: RecAction = !eligible
    ? "ineligible"
    : rec.currently_applied
      ? "applied"
      : isAppliable(rec.id)
        ? "apply"
        : "manual";
  return {
    id: rec.id,
    title: rec.title,
    detected: rec.applies_to,
    why: rec.description,
    impact: rec.impact,
    provenance: rec.provenance,
    applied: rec.currently_applied,
    severity: rec.severity,
    downside: rec.downside,
    reversible: action === "apply" || action === "applied",
    ineligibleReason: action === "ineligible" ? (rec.ineligible_reason ?? null) : null,
    action,
  };
}

/**
 * Every catalog rec id a priority row is about, in display order.
 *
 * `rec_ids` is the truth (priorities.rs emits it for every row). The `linked ?? id` fallback exists
 * ONLY for a probe-cache payload written by an older build — it is never the primary path, and it
 * resolves to nothing for rows that aren't about recommendations at all (which is correct).
 */
export function recIdsForPriority(lim: PriorityItem): string[] {
  if (lim.rec_ids && lim.rec_ids.length > 0) return lim.rec_ids;
  const legacy = lim.linked ?? lim.id;
  return legacy ? [legacy] : [];
}

/** The recs a priority row is about, resolved against the scan's catalog. Unknown ids drop out. */
export function recsForPriority(lim: PriorityItem, recs: Recommendation[]): Recommendation[] {
  const byId = new Map(recs.map((r) => [r.id, r]));
  return recIdsForPriority(lim)
    .map((id) => byId.get(id))
    .filter((r): r is Recommendation => !!r);
}

/** The full described set behind one priority row — what the surface renders. */
export function describePriority(
  lim: PriorityItem,
  recs: Recommendation[],
  isAppliable: (recId: string) => boolean,
): RecDetail[] {
  return recsForPriority(lim, recs).map((r) => describeRec(r, isAppliable));
}

/** The ones the user can act on right now — what a "fix it" affordance should offer. */
export function actionable(details: RecDetail[]): RecDetail[] {
  return details.filter((d) => d.action === "apply" || d.action === "manual");
}
