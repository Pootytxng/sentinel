// P6-unknown (ROADMAP Phase 6 bullet 8; Constitution §26): the Care view ends honestly.
//
// The "Your next step" slot (care-next-step.ts) holds ONE of:
//   * a step Compy can name from the evidence (CareNextStep);
//   * a step whose record is BEYOND Compy (`beyond_us`): still that record's own "take it to a
//     person" step, said plainly, with the local support record one tap away (CareNextStep);
//   * no step: "Not enough evidence yet", with only the things that would really add evidence
//     (CareHonestEnd). This function returns null whenever there is a step, so a step and an
//     "unknown" claim can never be on screen together.
import type { BlackBoxReport, CrashIncident } from "../types";
import type { CareStep, StutterResult } from "./care-next-step";

/** What would add evidence. Each one is only offered when it is true for this read. */
export type EvidenceGap =
  /** The scan skipped a source that needs admin: Compy started as administrator can read it. */
  | { kind: "admin" }
  /** A reader couldn't run this time (not an admin matter): a plain re-scan may read it. */
  | { kind: "rescan" }
  /** Records were found but none cleared a reading's bar: some readings need a repeat. */
  | { kind: "repeat" }
  /** The session comparison couldn't name a test: another full-length session gives it more. */
  | { kind: "session"; game: string };

export type HonestEnd = { kind: "unknown"; gaps: EvidenceGap[] };

/** The scan's skipped sources, split into those that need admin and reader failures. */
export function splitSkips(report: Pick<BlackBoxReport, "skipped_sources" | "skipped_needs_admin"> | null | undefined): {
  admin: string[];
  other: string[];
} {
  if (!report) return { admin: [], other: [] };
  const needs = new Set(report.skipped_needs_admin ?? []);
  return {
    admin: report.skipped_sources.filter((s) => needs.has(s)),
    other: report.skipped_sources.filter((s) => !needs.has(s)),
  };
}

/** Pure. `incidents` is null before a scan (nothing is claimed about records Compy hasn't read). */
export function honestEndFor(
  step: CareStep | null,
  incidents: CrashIncident[] | null | undefined,
  skips: { admin: number; other: number },
  stutter: StutterResult | null | undefined,
): HonestEnd | null {
  if (step) return null;
  const gaps: EvidenceGap[] = [];
  if (incidents) {
    if (skips.admin > 0) gaps.push({ kind: "admin" });
    if (skips.other > 0) gaps.push({ kind: "rescan" });
    if (incidents.length > 0) gaps.push({ kind: "repeat" });
  }
  const r = stutter?.report;
  if (
    r &&
    (r.verdict === "inconclusive" ||
      r.comparability?.verdict === "not-comparable" ||
      (r.verdict === "regressed" && !r.next_action))
  ) {
    gaps.push({ kind: "session", game: stutter!.game });
  }
  return gaps.length > 0 ? { kind: "unknown", gaps } : null;
}
