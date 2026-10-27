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

type Vendor = "amd" | "nvidia" | "intel";

/** The vendor a Windows graphics-driver module belongs to; null when this build doesn't know it. */
export function moduleVendor(module: string | null | undefined): Vendor | null {
  const m = (module ?? "").toLowerCase();
  if (/^(amdkmdag|atikmdag|atikmpag|amdkmpfd)/.test(m)) return "amd";
  if (/^nvlddmkm/.test(m)) return "nvidia";
  if (/^igdkmd/.test(m)) return "intel";
  return null;
}

/** The vendor a drawn GPU's own name says; null when the name doesn't say. */
export function gpuNameVendor(name: string | null | undefined): Vendor | null {
  const n = (name ?? "").toLowerCase();
  if (/\b(amd|radeon)\b/.test(n)) return "amd";
  if (/\b(nvidia|geforce)\b/.test(n)) return "nvidia";
  if (/\bintel\b/.test(n)) return "intel";
  return null;
}

export function incidentFocus(incident: CrashIncident | null | undefined, parts: readonly FocusPart[]): IncidentFocus {
  const rule = incident?.assessment?.rule;
  if (!rule) return null;
  if (INCIDENT_RULE_AWAY.has(rule)) return { kind: "away" };
  const kind = INCIDENT_RULE_PART[rule];
  if (!kind) return null;
  const matches = parts.filter((p) => p.detected && p.kind === kind);
  if (matches.length !== 1) return null;
  // Review r1 SHOULD-FIX 2: a driver record from before a card swap (an AMD module with an NVIDIA
  // card drawn now) is not about the card on the bench. When both vendors are known and differ, no
  // part is claimed; when either is unknown, the one-GPU rule stands.
  if (rule === "graphics-driver") {
    const recorded = moduleVendor(incident?.receipt?.faulting_module);
    const drawn = gpuNameVendor(matches[0].name);
    if (recorded && drawn && recorded !== drawn) return null;
  }
  return { kind: "part", rule: rule as "overheating" | "graphics-driver", partId: matches[0].id, partName: matches[0].name };
}
