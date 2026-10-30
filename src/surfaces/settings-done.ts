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
  | { kind: "part-limiter"; title: string };

/** The one Phase 9 line under a finished game summary, or null when the summary is not finished.
 *  `priorities`: undefined = no scan cached, null = the priorities read failed. Both are "not measured".
 *  "finished-within-chosen-risk" is excluded: changes above the user's risk are still untested, so
 *  settings have not reached what Compy can test here. */
export function settingsDoneLine(
  headline: GameTestSummary["headline"],
  priorities: Priorities | null | undefined,
): SettingsDoneLine | null {
  if (headline !== "finished-supported-tests") return null;
  if (!priorities) return { kind: "not-measured" };
  const limiters = priorities.limiters ?? [];
  const top = limiters.find((l) => l.status === "attention");
  if (top) {
    return LIMITER_AWAY.has(top.id)
      ? { kind: "setting-limiter", title: top.title }
      : { kind: "part-limiter", title: top.title };
  }
  // An unread limiter means the check could not say; "nothing is limiting" would be a claim it never made.
  if (limiters.some((l) => l.status === "unknown")) return { kind: "not-measured" };
  return { kind: "nothing-limiting" };
}
