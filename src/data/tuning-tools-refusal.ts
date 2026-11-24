import { invoke } from "@tauri-apps/api/core";
import type { BenchmarkState, TrialState } from "../types";
import { trialInProgress } from "../surfaces/changed-before-restore";

// D6: the Settings switch's turn-off refusal (data/tuning-tools.ts holds the preference). Kept apart so the
// preference module, which the shell and the palette import, pulls in no Trial or benchmark code.

/** Why the tools can't be turned off right now, or null when they can. Each read happens AT THE CLICK
 *  (existing commands, read-only); a read that fails refuses, never guesses "nothing running". */
export type TurnOffRefusal = "trial" | "trialUnread" | "bench" | "benchUnread" | "gaming" | "gamingUnread";

export async function tuningToolsOffRefusal(journeyIdle: boolean): Promise<TurnOffRefusal | null> {
  // A Trial (or the guided journey) holds a change until it is concluded or restored, and its Restore now
  // lives in the Trials bench.
  const xs = await invoke<{ status: string }[]>("get_experiments")
    .then((v) => (Array.isArray(v) ? v : null))
    .catch(() => null);
  const trial = trialInProgress(xs, journeyIdle);
  if (trial === "running") return "trial";
  if (trial === "unknown") return "trialUnread";
  // A benchmark run, calibration or tweak trial: a tweak trial holds a setting (its apply and undo are refused
  // while it runs) and its Cancel lives in the Benchmark station.
  const bench = await invoke<BenchmarkState>("get_benchmark_state").catch(() => null);
  const tweak = await invoke<TrialState>("get_trial_state").catch(() => null);
  if (bench?.running || tweak?.running) return "bench";
  if (bench == null || tweak == null) return "benchUnread";
  // A Gaming Mode session that is on or waiting to be finished: refused here too, though its pane stays in
  // Test with the tools off, so turning them off never stands between the user and Stop or Finish.
  const slot = await invoke<unknown>("get_gaming_session_state")
    .then((s) => (s == null ? "empty" : "present"))
    .catch(() => "unread");
  if (slot === "present") return "gaming";
  if (slot === "unread") return "gamingUnread";
  return null;
}
