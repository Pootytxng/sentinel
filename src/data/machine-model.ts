// Machine Model reader (#449) — the ONLY frontend call site of `get_machine_model`.
//
// The model answers "what is this machine" and "what changed" once, in Rust, with every fact
// carrying its source, freshness and (when missing) the reason it is unknown. Screens read it here
// instead of rebuilding that truth from bare probes.
//
// Rules this module keeps:
//   - A failed read is `null`. There is no zeroed or made-up default model: a screen that gets
//     `null` must say the model is unreadable, never "0 changes" or "0 GB".
//   - No polling. The hook reads on mount, when its `refreshToken` changes (App.refresh() bumps it
//     and clears the probe cache first), and after LEDGER_CHANGED_EVENT. Nothing else.
//   - The model is cached through the probe cache, so `invalidateProbe()` (every mutation) makes the
//     next read go to the backend.

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { LEDGER_CHANGED_EVENT, type Fact, type MachineModel } from "../types";
import { cachedProbe, invalidateProbe, peekProbe } from "./probe-cache";

export const MACHINE_MODEL_PROBE_KEY = "machine-model";

// Short: a re-mount within this window paints from the last read instead of re-composing the model.
const MACHINE_MODEL_TTL_MS = 30_000;

/** One read of the model. Resolves `null` when the backend call fails — never a default model. */
export async function readMachineModel(): Promise<MachineModel | null> {
  try {
    return await cachedProbe(
      MACHINE_MODEL_PROBE_KEY,
      () => invoke<MachineModel>("get_machine_model"),
      MACHINE_MODEL_TTL_MS,
    );
  } catch {
    return null;
  }
}

/**
 * The Machine Model for a screen.
 * `undefined` = not read yet · `null` = the read failed · otherwise the model.
 * Pass App's refresh counter as `refreshToken` so an App.refresh() re-reads it.
 *
 * `enabled: false` makes the hook read NOTHING — no invoke, not even a cached one — and report
 * `undefined`. It exists because a flag-gated surface must be able to make zero IPC while the flag
 * is off (a hook cannot be called conditionally), and "the flag is off" must not be reported as
 * "the model is unreadable".
 */
export function useMachineModel(
  refreshToken?: unknown,
  options?: { enabled?: boolean },
): MachineModel | null | undefined {
  const enabled = options?.enabled ?? true;
  const [model, setModel] = useState<MachineModel | null | undefined>(() =>
    enabled ? peekProbe<MachineModel>(MACHINE_MODEL_PROBE_KEY) : undefined,
  );
  const [ledgerTick, setLedgerTick] = useState(0);

  useEffect(() => {
    const onLedgerChanged = () => {
      invalidateProbe(MACHINE_MODEL_PROBE_KEY);
      setLedgerTick((n) => n + 1);
    };
    window.addEventListener(LEDGER_CHANGED_EVENT, onLedgerChanged);
    return () => window.removeEventListener(LEDGER_CHANGED_EVENT, onLedgerChanged);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setModel(undefined);
      return;
    }
    let live = true;
    void readMachineModel().then((next) => {
      if (live) setModel(next);
    });
    return () => {
      live = false;
    };
  }, [enabled, refreshToken, ledgerTick]);

  return model;
}

/**
 * A fact as display text: its value when known, otherwise the reason it has none.
 * Never a blank, a dash or a zero standing in for a missing value.
 */
export function factText<T>(fact: Fact<T>, format: (value: T) => string = String): string {
  if (fact.value !== null && fact.value !== undefined) return format(fact.value);
  return fact.unknown_reason ?? fact.not_applicable_reason ?? "unknown";
}
