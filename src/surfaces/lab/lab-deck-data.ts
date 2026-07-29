import type { TFunction } from "i18next";
import type { Confidence, Priorities, Recommendation } from "../../types";
import { safeFixesReadyList } from "../optimize-v2-data";
import type { LabStationKey } from "../lab-guided-data";

// THE LAB DECK — pure data for the decision-journey Lab (product-recovery train, 2026-07-28).
//
// Recovery items 13/15 say the six-peer-station mega-room is not the product direction, and that
// the room must follow the USER'S decision journey rather than our module structure:
//
//   What did Compy find? → What should I do first? → Why is it relevant to MY PC?
//   → Can Compy do it safely? → How do I prove whether it helped?
//
// Everything here is a derivation over state the Lab ALREADY holds — zero new IPC, zero new
// mutation path. `nextBestMove` reuses safeFixesReadyList (the ONE "ready to apply" predicate), so
// Section 1's headline can never disagree with the fix rows underneath it.
//
// Anti-fabrication: nothing below invents a number, a rank, or an expected gain. A move's "why" is
// either a MEASURED limiter reason carried from priorities (with its confidence band) or the
// catalog's own impact line — never a synthesized claim, never a parse of display prose.

// ───────────────────────────── goal taxonomy (Section 2) ─────────────────────────────

// The owner's five user-goal groups. The catalog's own `category` is technical ("GPU", "Power",
// "Storage") — module-shaped, exactly what item 15 says not to organize the room by. This is the
// translation layer, and it is a STRUCTURED map over real ids, not prose matching.
export type LabGoal = "fps" | "latency" | "stability" | "image" | "cleanup";

export const LAB_GOAL_ORDER: LabGoal[] = ["fps", "latency", "stability", "image", "cleanup"];

// Per-id assignment, justified by each rec's own catalog impact line (src-tauri/src/
// recommendations.rs). Pinned by lab-deck-data.test.ts, which walks the Rust catalog and fails if
// a NEW id lands here unassigned — a new tweak must be placed deliberately, never by accident.
//
//   power-ultimate        "Lower input latency · steadier frame times"            → latency
//   hags-enable           "Lower input latency · CPU cycles freed up"             → latency
//   nvidia-low-latency    "Lower input lag in fast-paced games"                   → latency
//   gpu-prefer-discrete   "Massive FPS gain if a game is mis-routed"              → fps
//   gpu-driver-update     "Better game performance · fewer crashes"               → fps
//   monitor-max-refresh   "Smoother motion · lower input lag"                     → image
//   fast-startup-off      "Clean shutdowns · fixes 'why is X behaving weird'"     → stability
//   storage-c-low         "Restores normal disk performance · prevents failures"  → stability
//   ssd-upgrade-advisory  "Multi-second → sub-second boot"                        → stability
//   reserved-storage-off  "Reclaim ~7–10 GB on C:"                                → cleanup
//   sysmain-disable       "Lower idle disk activity · RAM back"                   → cleanup
//   nvidia-telemetry      "Free ~150–250 MB RAM · less background CPU"            → cleanup
//   amd-uxp               "Less background network traffic · privacy"             → cleanup
const GOAL_BY_REC_ID: Record<string, LabGoal> = {
  "power-ultimate": "latency",
  "hags-enable": "latency",
  "nvidia-low-latency": "latency",
  "gpu-prefer-discrete": "fps",
  "gpu-driver-update": "fps",
  "monitor-max-refresh": "image",
  "fast-startup-off": "stability",
  "storage-c-low": "stability",
  "ssd-upgrade-advisory": "stability",
  "reserved-storage-off": "cleanup",
  "sysmain-disable": "cleanup",
  "nvidia-telemetry": "cleanup",
  "amd-uxp": "cleanup",
};

// Fallback for anything the map doesn't name (a signed remote rule, a future tweak). Category is
// the only structured field left; an unrecognised category lands in "stability" ON PURPOSE — it is
// the group that promises the least, so an unplaced rec can never claim FPS or latency it hasn't
// earned.
const GOAL_BY_CATEGORY: Record<string, LabGoal> = {
  GPU: "fps",
  Display: "image",
  Power: "latency",
  Storage: "cleanup",
  Windows: "stability",
};

export function goalOf(rec: Pick<Recommendation, "id" | "category">): LabGoal {
  return GOAL_BY_REC_ID[rec.id] ?? GOAL_BY_CATEGORY[rec.category] ?? "stability";
}

/** The DELIBERATE placement for an id, or null if it only lands via the category fallback. The
 *  catalog-coverage guard reads this — `goalOf` can't answer it, because it always returns a goal. */
export function explicitGoal(id: string): LabGoal | null {
  return GOAL_BY_REC_ID[id] ?? null;
}

/** The goal a catalog category falls back to, or null if the category is unknown to this map. */
export function categoryGoal(category: string): LabGoal | null {
  return GOAL_BY_CATEGORY[category] ?? null;
}

export type LabGoalInfo = {
  name: string; // the group header — a goal in the user's words, never a module name
  line: string; // what belongs in it, one line
};

export function labGoals(t: TFunction): Record<LabGoal, LabGoalInfo> {
  return {
    fps: { name: t("lab.labDeck.goals.fps.name"), line: t("lab.labDeck.goals.fps.line") },
    latency: {
      name: t("lab.labDeck.goals.latency.name"),
      line: t("lab.labDeck.goals.latency.line"),
    },
    stability: {
      name: t("lab.labDeck.goals.stability.name"),
      line: t("lab.labDeck.goals.stability.line"),
    },
    image: { name: t("lab.labDeck.goals.image.name"), line: t("lab.labDeck.goals.image.line") },
    cleanup: {
      name: t("lab.labDeck.goals.cleanup.name"),
      line: t("lab.labDeck.goals.cleanup.line"),
    },
  };
}

export type LabGoalGroup = { goal: LabGoal; recs: Recommendation[] };

// Section 2's grouping rule, literally: "only show a group when real supported recommendations
// exist." An empty group is never rendered as an empty shelf — it does not exist.
export function groupByGoal(recs: Recommendation[]): LabGoalGroup[] {
  const buckets = new Map<LabGoal, Recommendation[]>();
  for (const rec of recs) {
    const goal = goalOf(rec);
    const bucket = buckets.get(goal);
    if (bucket) bucket.push(rec);
    else buckets.set(goal, [rec]);
  }
  return LAB_GOAL_ORDER.filter((g) => (buckets.get(g)?.length ?? 0) > 0).map((goal) => ({
    goal,
    recs: buckets.get(goal)!,
  }));
}

// ─────────────────────── your next best move (Section 1) ───────────────────────

// WHY this rec surfaced — the honest provenance of the recommendation, not a score.
export type LabMoveEvidence =
  // The user's own check named it moments ago (the Check→Optimize handoff carried the id).
  | { from: "check" }
  // A MEASURED limiter named it. `reason` is priorities' own text and `confidence` its own band —
  // both copied through untouched, never re-worded into a stronger claim.
  | { from: "limiter"; reason: string; confidence: Confidence }
  // Nothing measured points here; the catalog ranked it. The card's "why" is the rec's own impact
  // line, which is a description of what the setting does — not a prediction about this rig.
  | { from: "catalog" };

export type LabNextMove = {
  rec: Recommendation;
  goal: LabGoal;
  // Can Compy perform it? true → the audited one-tap apply; false → the real guided steps.
  // (Rollback-first is not a property of the move: every appliable rec captures its typed rollback
  // contract at apply time, which is the LOCKED rule the card states rather than computes.)
  canApply: boolean;
  evidence: LabMoveEvidence;
};

// The four honest answers to "is anything worth changing?". `unknown` is the pre-catalog state —
// Compy has not looked yet, and says so instead of showing a confident empty room.
export type LabNextMoveState =
  | { state: "unknown" }
  | { state: "move"; move: LabNextMove; remaining: number }
  | { state: "all-clear"; applied: number }
  | { state: "none" };

export type NextBestMoveInput = {
  recs: Recommendation[] | null;
  isAppliable: (recId: string) => boolean;
  // Applied with Compy, since turned off outside it. Never re-offered as "ready" (the one-mention
  // law) — the drifted row in Section 2 owns that state.
  revertedIds?: ReadonlySet<string>;
  // "Not for me". A deliberate decline is respected here too: Section 1 must never push back a rec
  // the user just dismissed.
  dismissedIds?: ReadonlySet<string>;
  // Ids the Check handoff carried, in the order the check named them.
  carriedRecIds?: readonly string[];
  priorities?: Priorities | null;
  // Trust Ledger changes still active — the denominator behind the all-clear state.
  activeCount?: number;
};

// Rank tiers, safest-and-most-justified first. Within a tier the catalog's own order wins, so the
// ranking is stable and explainable: no invented score, no shuffling between renders.
//
//   1. the check just named it        — the user is standing here because of it
//   2. a measured limiter named it    — real evidence about THIS rig
//   3. safe + one-tap                 — reversible, and Compy can do it
//   4. appliable but a judgment call  — moderate/advanced tier
//   5. guided only                    — Compy won't touch it; the card opens the real steps
export function nextBestMove(input: NextBestMoveInput): LabNextMoveState {
  const { recs, isAppliable, revertedIds, dismissedIds, activeCount = 0 } = input;
  if (recs == null) return { state: "unknown" };

  const live = recs.filter(
    (r) => r.eligible !== false && !(dismissedIds?.has(r.id) && !r.currently_applied),
  );
  // The SAME predicate the room verdict and the fix rows use — one source, so these cannot drift.
  const ready = safeFixesReadyList(live, isAppliable, revertedIds);
  const openOther = live.filter(
    (r) =>
      !r.currently_applied &&
      !revertedIds?.has(r.id) &&
      !(r.severity === "safe" && isAppliable(r.id)),
  );
  const candidates = [...ready, ...openOther];
  if (candidates.length === 0) {
    // Nothing open. Either the safe stack is genuinely set (there are active changes or applied
    // recs to point at), or this rig simply had nothing to change — two different sentences.
    const applied = activeCount || live.filter((r) => r.currently_applied).length;
    return applied > 0 ? { state: "all-clear", applied } : { state: "none" };
  }

  const byId = new Map(candidates.map((r) => [r.id, r]));
  const remaining = candidates.length - 1;
  const pick = (rec: Recommendation, evidence: LabMoveEvidence): LabNextMoveState => ({
    state: "move",
    move: { rec, goal: goalOf(rec), canApply: isAppliable(rec.id), evidence },
    remaining,
  });

  // 1. carried from the check, in the order the check named them
  for (const id of input.carriedRecIds ?? []) {
    const rec = byId.get(id);
    if (rec) return pick(rec, { from: "check" });
  }

  // 2. named by a measured limiter (limiters are already ranked by priorities.rs)
  for (const limiter of input.priorities?.limiters ?? []) {
    for (const id of limiter.rec_ids ?? []) {
      const rec = byId.get(id);
      if (rec)
        return pick(rec, {
          from: "limiter",
          reason: limiter.reason,
          confidence: limiter.confidence,
        });
    }
  }

  // 3–5. catalog order within the tiers built above
  return pick(candidates[0], { from: "catalog" });
}

// ─────────────────────── diagnose a problem (Section 4) ───────────────────────

// The six problems the owner named, in the user's words. Each routes to ONE real instrument that
// already exists — this section is a door, never a new tool. A row whose station isn't present on
// this rig is dropped (labProblems below), so the list can never contain a dead end.
export type LabProblemKey =
  | "stutter"
  | "crashes"
  | "unstableFps"
  | "inputDelay"
  | "heat"
  | "changed";

export type LabProblemRoute = {
  key: LabProblemKey;
  symptom: string; // what it feels like, in the user's words
  station: LabStationKey; // the instrument that answers it
  because: string; // why that instrument is the answer — plain English, no promise
};

const PROBLEM_STATION: Record<LabProblemKey, LabStationKey> = {
  stutter: "benchmark",
  crashes: "blackbox",
  unstableFps: "benchmark",
  inputDelay: "latency",
  heat: "tuning",
  changed: "diagnostics",
};

const PROBLEM_ORDER: LabProblemKey[] = [
  "stutter",
  "unstableFps",
  "inputDelay",
  "crashes",
  "heat",
  "changed",
];

// `available` is the set of stations this rig actually has (Tuning is AMD-only; Diagnostics needs a
// captured report) — the SAME filter LabConsole applies to its dock, so a problem row and the dock
// can never disagree about what exists.
export function labProblems(
  available: ReadonlySet<LabStationKey>,
  t: TFunction,
): LabProblemRoute[] {
  return PROBLEM_ORDER.filter((key) => available.has(PROBLEM_STATION[key])).map((key) => ({
    key,
    symptom: t(`lab.labDeck.problems.${key}.symptom`),
    station: PROBLEM_STATION[key],
    because: t(`lab.labDeck.problems.${key}.because`),
  }));
}
