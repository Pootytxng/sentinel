// P9-settings-done (Phase 9, WORK_TRAIN): once the Phase 4 bench says Compy finished the supported
// tests for a game, the game summary adds ONE line: settings have reached what Compy can test here,
// then the last check's limiter, or "not measured". "No upgrade recommended" is a valid answer and the
// default whenever nothing is measured. Phase 9 law: never a product, price or shop recommendation here.
import type { Priorities } from "../types";
import type { GameTestSummary } from "./test-summary";
import { LIMITER_AWAY } from "./rig/limiter-part";

export type SettingsDoneLine =
  // No scan in hand (or the priorities read failed): the limiter is unknown, never guessed.
  | { kind: "not-measured" }
  // A scan ran and nothing in it is marked as holding the PC back (and nothing was left unknown).
  | { kind: "nothing-limiting" }
  // The top limiter is a setting or software item (monitor refresh, driver age, power plan...).
  | { kind: "setting-limiter"; title: string }
  // The top limiter is a part of the PC. Named only; Compy does not pick a part to buy.
  | { kind: "part-limiter"; title: string }
  // P9-summary-gpu-limit: this game's newest measured session was GPU-limited (the sustained rule),
  // so the GPU is the measured limiter for this game, with its share; never "nothing holding it back".
  | { kind: "gpu-limiter"; sharePct: number; thresholdPct: number };

const AGGREGATE_REC_ROWS = new Set(["pending-safe-recs", "applied-changes"]);

/** The one Phase 9 line under a finished game summary, or null when the summary is not finished.
 *  `priorities`: undefined = no scan cached, null = the priorities read failed. Both are "not measured".
 *  "finished-within-chosen-risk" is excluded: changes above the user's risk are still untested, so
 *  settings have not reached what Compy can test here. */
export function settingsDoneLine(
  headline: GameTestSummary["headline"],
  priorities: Priorities | null | undefined,
  game?: string,
): SettingsDoneLine | null {
  if (headline !== "finished-supported-tests") return null;
  if (!priorities) return { kind: "not-measured" };
  // P9-summary-gpu-limit: this game's own newest measured session, never another game's.
  // Review r1: matched on the trimmed, case-folded process name (Windows reports it in any case).
  const key = game?.trim().toLowerCase();
  const gpu = key ? (priorities.gpu_limited_games ?? []).find((g) => g.game.trim().toLowerCase() === key) : undefined;
  // The two aggregate rows that re-state recommendations (Check.tsx's one-mention law) are not
  // limiters here: on a finished summary, "safe tweaks not applied" are exactly the changes Compy
  // just tested and put back for no measured gain (desk review 2026-10-31: the line named Trim
  // Windows visual effects right under "tested twice, no measurable difference").
  const limiters = (priorities.limiters ?? []).filter((l) => !AGGREGATE_REC_ROWS.has(l.id));
  const top = limiters.find((l) => l.status === "attention");
  if (top) {
    return LIMITER_AWAY.has(top.id)
      ? { kind: "setting-limiter", title: top.title }
      : { kind: "part-limiter", title: top.title };
  }
  // A measured GPU limit for this game outranks "nothing limiting" and "not measured": it is a
  // measurement of this game, where the check's rows are PC-wide.
  if (gpu && Number.isFinite(gpu.share_pct) && Number.isFinite(gpu.threshold_pct)) {
    return { kind: "gpu-limiter", sharePct: gpu.share_pct, thresholdPct: gpu.threshold_pct };
  }
  // An unread limiter means the check could not say; "nothing is limiting" would be a claim it never made.
  if (limiters.some((l) => l.status === "unknown")) return { kind: "not-measured" };
  return { kind: "nothing-limiting" };
}

export type SoftwareFirstLine = {
  kind: "software-first";
  /** The part the last check named as the top limiter. Named only; never a shopping line. */
  part: string;
  /** The untested changes first, then those worth another run, in the picker's order. */
  candidates: string[];
};

/** P9-software-first: before any part is named as what holds a game back, the summary lists the
 *  Trial candidates still untested (or worth another run) for that game — "try these settings
 *  before any upgrade". With none left, `settingsDoneLine` carries today's line instead, so the
 *  two never render together. Absent when the last check named no part, or no scan is in hand. */
export function softwareFirstLine(
  summary: Pick<GameTestSummary, "headline" | "leftToTest" | "retest">,
  priorities: Priorities | null | undefined,
): SoftwareFirstLine | null {
  if (summary.headline === "finished-supported-tests" || summary.headline === "unknown") return null;
  if (!priorities) return null;
  const limiters = (priorities.limiters ?? []).filter((l) => !AGGREGATE_REC_ROWS.has(l.id));
  const top = limiters.find((l) => l.status === "attention");
  if (!top || LIMITER_AWAY.has(top.id)) return null;
  const seen = new Set<string>();
  const candidates = [
    ...summary.leftToTest.map((c) => ({ id: c.id, title: c.title })),
    ...summary.retest.map((r) => ({ id: r.recId, title: r.title })),
  ]
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .map((c) => c.title);
  if (candidates.length === 0) return null;
  return { kind: "software-first", part: top.title, candidates };
}
