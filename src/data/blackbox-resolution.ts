// Black Box v2.1 — the "measured payoff" (spec 2026-06-13-black-box-v2 §Phasing). After a user marked a
// triage next-step "Did this help? — yes", this reports a MEASURED ABSENCE from the incident log:
// "No {kind} recorded in the {N} days since." It NEVER claims a fix worked / a problem is solved — that
// would be an unproven causal claim. A recurrence is reported just as plainly ("{kind} happened again on
// {date}") — we don't hide it. The user draws their own conclusion from the measured fact.
//
// Pure + frontend-local by construction: it reasons over the already-fetched incident timeline + the
// locally-stored "yes" mark. No OS call, no network, no telemetry. It is implicitly gated by the backend
// `blackbox_v2_gate()` because it only runs on an incident that HAS an `assessment` (assessments are only
// populated when the gate is ON), and only when a local "yes" mark exists.

import type { CrashIncident } from "../types";

/** A measured absence is only meaningful once at least this many whole days have elapsed since the mark
 *  (otherwise "No X in the 0 days since" is noise — we show nothing instead of fabricating reassurance). */
export const RESOLUTION_MIN_DAYS = 1;

/** A locally-stored "Did this help?" mark for one incident (vote + the time it was cast). */
export type HelpMark = { vote: string; at: string };

export type IncidentResolution = {
  status: "none-since" | "recurred";
  /** The factual line shown to the user. Guaranteed free of "fixed"/"solved"/"worked" causal claims. */
  text: string;
};

function fmtDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Compute the measured-absence / recurrence line for an incident the user marked helpful, or `null` when
 * there's nothing honest to say yet:
 *  - no `assessment` on the incident (gate OFF / refuse-to-guess) → null
 *  - no mark, or the mark isn't a "yes" → null
 *  - a malformed/empty mark timestamp → null (an old untimed mark can't anchor a "since")
 *  - a NEW incident of the SAME kind (matched on `tag`) recorded AFTER the mark → "happened again on …"
 *  - otherwise, once ≥ RESOLUTION_MIN_DAYS have elapsed → "No {kind} recorded in the {N} days since."
 *  - too little time elapsed and no recurrence → null (no fabricated reassurance)
 *
 * `now` is injectable for deterministic tests.
 */
export function resolutionFor(
  incident: CrashIncident,
  allIncidents: CrashIncident[],
  mark: HelpMark | null,
  now: Date = new Date(),
): IncidentResolution | null {
  if (!incident.assessment) return null; // implicitly gated: no assessment ⇒ no v2.1 output
  if (!mark || mark.vote !== "yes") return null;
  const markedAt = Date.parse(mark.at);
  if (Number.isNaN(markedAt)) return null;

  // A recurrence is any incident of the SAME kind (the serialized `tag` is the kind discriminator)
  // recorded strictly AFTER the mark. The marked incident itself is older than the mark → excluded.
  const recurrences = allIncidents
    .filter((i) => i.tag === incident.tag)
    .map((i) => Date.parse(i.when))
    .filter((t) => !Number.isNaN(t) && t > markedAt)
    .sort((a, b) => a - b);
  if (recurrences.length > 0) {
    return { status: "recurred", text: `${incident.tag} happened again on ${fmtDay(recurrences[0])}.` };
  }

  const days = Math.floor((now.getTime() - markedAt) / 86_400_000);
  if (days < RESOLUTION_MIN_DAYS) return null; // too soon to be a meaningful measured absence

  return {
    status: "none-since",
    text: `No ${incident.tag} recorded in the ${days} ${days === 1 ? "day" : "days"} since.`,
  };
}
