// Hardware-change detection + re-baseline flow (A5). Owns the small "your rig changed since last
// setup" advisory lifecycle so the Check surface doesn't hand-roll it inline: detect on mount (cached
// so re-visiting the tab paints instantly), and a re-baseline action ("this is my rig now") that
// records the current hardware as the new baseline so the flag can never nag forever.
//
// Read-only / advisory: the two commands it invokes (`get_hardware_changes`, `acknowledge_hardware_changes`)
// only read hardware + write ONE local fingerprint JSON. No Windows mutation, no elevation, nothing gated.
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cachedProbe, peekProbe } from "../data/probe-cache";

/** Mirrors the Rust `HardwareChangeReport` shape (hwchange.rs). */
export type HardwareChangeReport = {
  changed: boolean;
  changes: string[];
  baseline_recorded: boolean;
};

/** Default cap on how many individual change lines the advisory shows before collapsing to
 *  "and N more" — keeps a big multi-part swap (many disks / GPUs / everything at once) from
 *  flooding the card into an unreadable wall. */
export const HW_CHANGE_MAX_VISIBLE = 4;

const PROBE_KEY = "hardware-changes";

export type HardwareChangeSummary = {
  /** The change lines to actually render (≤ max). */
  visible: string[];
  /** How many change lines were hidden by the cap (0 = all shown). */
  overflow: number;
  /** Ready-to-render "and N more change(s)" tail, or null when nothing overflowed. */
  overflowLabel: string | null;
};

/** Pure overflow handling: cap the change lines and describe the remainder. Defensive against a
 *  non-positive cap (never slices with a negative length; still counts every line as overflow). */
export function summarizeHardwareChanges(
  changes: string[],
  max: number = HW_CHANGE_MAX_VISIBLE,
): HardwareChangeSummary {
  const cap = Math.max(0, max);
  const visible = changes.slice(0, cap);
  const overflow = changes.length - visible.length;
  return {
    visible,
    overflow,
    overflowLabel: overflow > 0 ? `and ${overflow} more change${overflow === 1 ? "" : "s"}` : null,
  };
}

export type UseHardwareChangeBinding = {
  /** Null until the first detect resolves. */
  report: HardwareChangeReport | null;
  /** True while a re-baseline write is in flight. */
  acknowledging: boolean;
  /** Re-baseline: record the current rig as the new baseline so the flag stops nagging. On write
   *  failure the flag is left up (no false "cleared") so the user can retry or just re-check. */
  acknowledge: () => Promise<void>;
};

export function useHardwareChange(): UseHardwareChangeBinding {
  const [report, setReport] = useState<HardwareChangeReport | null>(
    () => peekProbe<HardwareChangeReport>(PROBE_KEY) ?? null,
  );
  const [acknowledging, setAcknowledging] = useState(false);

  useEffect(() => {
    let live = true;
    cachedProbe<HardwareChangeReport>(
      PROBE_KEY,
      () => invoke<HardwareChangeReport>("get_hardware_changes"),
      60_000,
    )
      .then((r) => {
        if (live) setReport(r);
      })
      .catch(() => {
        /* detection is best-effort advisory; a failure just shows no card */
      });
    return () => {
      live = false;
    };
  }, []);

  const acknowledge = useCallback(async () => {
    setAcknowledging(true);
    try {
      await invoke("acknowledge_hardware_changes");
      // Optimistically clear locally — the backend re-baselined, so the next detect agrees.
      setReport((p) => (p ? { ...p, changed: false, changes: [] } : p));
    } catch {
      /* leave the card up; the user can retry or just re-check */
    } finally {
      setAcknowledging(false);
    }
  }, []);

  return { report, acknowledging, acknowledge };
}
