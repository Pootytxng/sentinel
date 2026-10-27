// P7-rig-care (ROADMAP P7 bullet 4, Constitution §24, §25): on the Care station the newest assessed
// crash record (the one the Care step is drawn from, care-next-step `newestAssessedIncident`) drives
// the Lab rig, the way the #1 limiter drives Home's (limiter-part.ts).
//
// The mapping reads the assessment's RULE key (blackbox.rs `AssessmentRule`), never its prose, and
// claims a part only where the rule's own evidence is about that part:
//   - overheating     → the GPU: the rule fires on a MEASURED high GPU temperature;
//   - graphics-driver → the GPU: the same graphics-driver module timed out repeatedly — the card the
//                       driver runs (the line says "its graphics driver", never "the card failed");
//   - app-specific    → away: the record reads as a problem in the app itself, not a part;
//   - hardware-error  → nothing: Windows' WHEA fault is heat, power OR memory — no one part;
//   - power-hardlock  → nothing: power delivery, a deep hang, or a one-off — no one part;
//   - beyond-us       → nothing: a stop code Compy won't guess at.
// "Memory error → RAM" has no rule that says memory alone, so RAM is never claimed here.
// A part only when exactly ONE detected part of that kind is drawn (two GPUs: which one is not in
// the record). A record from a build before the key existed (no `rule`) → nothing.
import type { AssessmentRule, CrashIncident } from "../../types";
import type { FocusPart } from "./limiter-part";
import type { RigPartKind } from "./rig-parts";

export type IncidentFocus =
  | { kind: "part"; rule: "overheating" | "graphics-driver"; partId: string; partName: string }
  | { kind: "away" }
  | null;

export const INCIDENT_RULE_PART: Readonly<Partial<Record<AssessmentRule, RigPartKind>>> = {
  overheating: "gpu",
  "graphics-driver": "gpu",
};
export const INCIDENT_RULE_AWAY: ReadonlySet<AssessmentRule> = new Set<AssessmentRule>(["app-specific"]);
/** Rules that deliberately point at no part (several possible parts, or none Compy will name). */
export const INCIDENT_RULE_NONE: ReadonlySet<AssessmentRule> = new Set<AssessmentRule>([
  "hardware-error",
  "power-hardlock",
  "beyond-us",
]);

export function incidentFocus(incident: CrashIncident | null | undefined, parts: readonly FocusPart[]): IncidentFocus {
  const rule = incident?.assessment?.rule;
  if (!rule) return null;
  if (INCIDENT_RULE_AWAY.has(rule)) return { kind: "away" };
  const kind = INCIDENT_RULE_PART[rule];
  if (!kind) return null;
  const matches = parts.filter((p) => p.detected && p.kind === kind);
  if (matches.length !== 1) return null;
  return { kind: "part", rule: rule as "overheating" | "graphics-driver", partId: matches[0].id, partName: matches[0].name };
}
