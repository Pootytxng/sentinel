import { useEffect, useState } from "react";
import type { AppliedChange } from "../types";

// D6 "Tuning tools" (Constitution §38 layer 3, owner decision 2026-11-24: Test's tools behind an opt-in;
// plan: _train/d6-test-room-opt-in-plan-v2.md). A UI preference like Expert view (use-expert-view.ts), NOT a
// data-root file and not a flag: it shows or hides Test's tuning tools (the Optimize switches, Trials,
// Benchmark, Latency, Tuning, the GPU profile captures and the bench's summary tiles). It changes nothing on
// the PC. Compy's changes and their undo ("Applied & history"), "Turned off outside Compy", Diagnostics,
// Crash & Freeze Rescue and a Gaming Mode session that is on or waiting to be finished stay in Test either way.

const KEY = "compy_tuning_tools";
const EVENT = "compy:tuning-tools";

/** The stored choice: "on" / "off", or null when none was made yet (the first-run decision below makes it). */
export function readTuningToolsChoice(): "on" | "off" | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "1" ? "on" : v === "0" ? "off" : null;
  } catch {
    return null;
  }
}

/** Whether the tools show. With no choice stored yet they SHOW: nothing is hidden on a decision not made. */
export function readTuningTools(): boolean {
  return readTuningToolsChoice() !== "off";
}

export function setTuningTools(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* storage unavailable: the choice lasts this session only */
  }
  try {
    window.dispatchEvent(new CustomEvent(EVENT));
  } catch {
    /* ignore */
  }
}

/** Reactive: every mounted surface follows the Settings switch and the first-run decision live. */
export function useTuningTools(): boolean {
  const [on, setOn] = useState<boolean>(() => readTuningTools());
  useEffect(() => {
    const update = () => setOn(readTuningTools());
    update();
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return on;
}

/** What App's existing read of the Gaming Mode session slot found: nothing, a file, or a read that failed.
 *  (readSessionSlot folds a failed read into "none"; the decision must not, so App keeps the raw result.) */
export type SlotRead = "empty" | "present" | "unread";

/**
 * PURE: the one-time first-run decision, from reads App ALREADY makes (nothing new is read).
 * - `ledger`: App's get_applied_changes result once it has ANSWERED (null = not answered yet or failed).
 *   Called before the first answer, the initial [] would persist "off" for everyone; so null is "undecided".
 * - `slot`: App's get_gaming_session_state result.
 * Any ledger row (applied or undone; every Trial start and benchmark-station apply writes one) or a Gaming
 * Mode session file → "on". An empty ledger and an empty slot → "off" (a new install). A failed read →
 * "undecided": the tools show this run and nothing is stored. A past Gaming Mode user whose last session
 * stopped cleanly and who has no ledger row, and a benchmark-only user, start "off" (owner decision 4).
 */
export function decideTuningTools(
  ledger: readonly AppliedChange[] | null,
  slot: SlotRead | null,
): "on" | "off" | "undecided" {
  if (ledger !== null && ledger.length > 0) return "on";
  if (slot === "present") return "on";
  if (ledger === null || slot === null || slot === "unread") return "undecided";
  return "off";
}

/** Test's measure stations that are tuning tools (hidden with the tools off). Diagnostics and Crash & Freeze
 *  Rescue ("blackbox") stay; station 1 ("optimize") stays as Compy's changes (lab/ChangesFace.tsx). */
export const TUNING_STATIONS: ReadonlySet<string> = new Set(["benchmark", "latency", "tuning"]);

/**
 * Recs that belong to the tuning layer only (owner decision 2026-11-24: "Nagle tuning-only"). A UI filter,
 * not a privilege rule: they are listed only in Test's Optimize switches (which show with the tools on), never
 * on Home, Live or the first-check paths. An EXISTING ledger row for one stays in "Applied & history" (its
 * undo is the row's own typed snapshot) and in "Turned off outside Compy" (turning it back on restores the
 * user's own recorded choice).
 */
export const TUNING_ONLY_REC_IDS: ReadonlySet<string> = new Set(["nagle-disable"]);

/** The catalog without the tuning-only recs: what every surface outside Test's Optimize switches lists. */
export function layerOneRecs<L extends { id: string }[] | null | undefined>(recs: L): L {
  // null (loading) and undefined (not wired) pass through unchanged: they mean different things to callers.
  return (recs == null ? recs : recs.filter((r) => !TUNING_ONLY_REC_IDS.has(r.id))) as L;
}