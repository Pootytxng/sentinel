import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BenchmarkState, TrialState } from "../types";
import { trialInProgress } from "../surfaces/changed-before-restore";
import { tuningRunInProgress } from "./tuning-tools";

// D6: what a Trial, a benchmark run or a Gaming Mode session is holding right now (data/tuning-tools.ts holds
// the preference). Kept apart so the preference module, which the shell and the palette import, pulls in no
// Trial or benchmark code. Two users, one set of reads:
//   - the Settings switch's turn-off refusal (tuningToolsOffRefusal);
//   - Test, which keeps the Trials bench and the Benchmark station on screen while one of them is running
//     even with "off" stored (useTuningRun), so a running Trial's Restore now and a running benchmark's
//     Cancel are never hidden (review r1 F2).
// Every read is an existing read-only command; a read that fails counts as running, never as "nothing".

/** The raw reads, each null when it failed. */
async function readRun(journeyIdle: boolean) {
  const xs = await invoke<{ status: string }[]>("get_experiments")
    .then((v) => (Array.isArray(v) ? v : null))
    .catch(() => null);
  const trial = trialInProgress(xs, journeyIdle);
  const bench = await invoke<BenchmarkState>("get_benchmark_state").catch(() => null);
  const tweak = await invoke<TrialState>("get_trial_state").catch(() => null);
  return {
    trial,
    bench: bench == null ? null : !!bench.running,
    tweak: tweak == null ? null : !!tweak.running,
  };
}

/** Why the tools can't be turned off right now, or null when they can. Each read happens AT THE CLICK. */
export type TurnOffRefusal = "trial" | "trialUnread" | "bench" | "benchUnread" | "gaming" | "gamingUnread";

export async function tuningToolsOffRefusal(journeyIdle: boolean): Promise<TurnOffRefusal | null> {
  const run = await readRun(journeyIdle);
  // A Trial (or the guided journey) holds a change until it is concluded or restored, and its Restore now
  // lives in the Trials bench.
  if (run.trial === "running") return "trial";
  if (run.trial === "unknown") return "trialUnread";
  // A benchmark run, calibration or tweak trial: a tweak trial holds a setting (its apply and undo are refused
  // while it runs) and its Cancel lives in the Benchmark station.
  if (run.bench === true || run.tweak === true) return "bench";
  if (run.bench == null || run.tweak == null) return "benchUnread";
  // A Gaming Mode session that is on or waiting to be finished: refused here too, though its pane stays in
  // Test with the tools off, so turning them off never stands between the user and Stop or Finish.
  const slot = await invoke<unknown>("get_gaming_session_state")
    .then((s) => (s == null ? "empty" : "present"))
    .catch(() => "unread");
  if (slot === "present") return "gaming";
  if (slot === "unread") return "gamingUnread";
  return null;
}

/** How often Test re-reads while the tools are off, so a run that ends lets its tool stand down again. */
export const TUNING_RUN_POLL_MS = 4000;

const NONE = { trial: false, bench: false } as const;

/**
 * Test's runtime side of F2. `enabled` is "the tools are off" (with them on everything shows anyway and
 * nothing is read). Until the first answer nothing is forced; from then on a running Trial keeps the Trials
 * bench, and a running benchmark / tweak trial keeps the Benchmark station, and a failed read keeps both.
 */
export function useTuningRun(enabled: boolean, journeyIdle: boolean): { trial: boolean; bench: boolean } {
  const [run, setRun] = useState<{ trial: boolean; bench: boolean }>(NONE);
  useEffect(() => {
    if (!enabled) {
      setRun(NONE);
      return;
    }
    let live = true;
    const read = () => {
      void readRun(journeyIdle)
        .then((r) => tuningRunInProgress(r.trial, r.bench, r.tweak))
        .catch(() => ({ trial: true, bench: true }))
        .then((next) => {
          if (live) setRun((prev) => (prev.trial === next.trial && prev.bench === next.bench ? prev : next));
        });
    };
    read();
    const id = window.setInterval(read, TUNING_RUN_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(id);
    };
  }, [enabled, journeyIdle]);
  return enabled ? run : NONE;
}
