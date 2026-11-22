// "Your data" (C1): the pure half of the Settings screen that clears play history.
//
// The backend (src-tauri/src/data_clear.rs) plans and deletes; this file only turns its typed answer into
// what the screen says. Rules it keeps:
// * Every sentence comes from a CODE (refusal, kept reason, restart reason), never from the backend's
//   `detail` text, which is developer-written. An unknown code is shown as itself, never dropped.
// * "Deleted" is said only when the report says `complete`. Anything else is "not finished" with the
//   lists of what was and was not deleted.
// * The browser-storage keys cleared are exactly the `webview` targets the backend took from the
//   inventory (data_inventory.rs `webview_keys`), and only after a complete clear.
// The JSON names used here are pinned by the Rust test `w0b_the_plan_and_the_outcome_serialize_with_the_names_the_screen_reads`.

export type Refusal = { code: string; detail: string; files: string[] };
export type PlannedDelete = { rel: string; row_id: string; store: string; category: string; size: number; modified_ms: number };
export type Kept = { rel: string; code: string; detail: string };
export type WebviewTarget = { key: string; prefix: boolean; session_storage: boolean };

export type ClearPlan = {
  scope: "play_history" | "everything";
  delete: PlannedDelete[];
  kept: Kept[];
  unknown: string[];
  refusals: Refusal[];
  applied_changes: string[];
  offer_undo_all: boolean;
  legacy_folder_present: boolean;
  webview: WebviewTarget[];
  fingerprint: string;
};

export type FailedDelete = { rel: string; error: string };

export type ClearReport = {
  scope: "play_history" | "everything";
  deleted: string[];
  already_gone: string[];
  failed: FailedDelete[];
  not_attempted: string[];
  stopped: Refusal[];
  kept: Kept[];
  unknown: string[];
  complete: boolean;
  nothing_to_do: boolean;
  restart_required: boolean;
  restart_reasons: string[];
  webview: WebviewTarget[];
};

export type ClearOutcome =
  | { status: "refused"; detail: Refusal[] }
  | { status: "plan_changed" }
  | { status: "done"; detail: ClearReport };

/** Refusal codes the screen has its own sentence for. Anything else: `refusal.other` with the code. */
export const REFUSAL_CODES = [
  "capture_running",
  "recording_in_progress",
  "benchmark_trial_running",
  "trial_running",
  "trial_state_unknown",
  "gaming_mode_active",
  "gaming_working_file",
  "root_unreadable",
  "root_not_a_plain_folder",
  "data_root_unavailable",
  "store_lock_unavailable",
] as const;

/** Kept-reason codes the screen explains. Anything else: `kept.other` with the code. */
/** `change_history` is not here: the screen always names the change history as kept, in its own line. */
export const KEPT_CODES = [
  "undo_data",
  "trials_tied_to_changes",
  "trial_record_set_aside",
  "elevated_leftover",
  "working_file_in_use",
  "link_left_alone",
  "clear_in_progress",
  "not_in_this_choice",
] as const;

/** Store ids (data_inventory.rs row ids) the confirm list names in words. Anything else: `store.other`. */
export const STORE_GROUPS: Record<string, string> = {
  sessions: "sessions",
  experiments: "trials",
  benchmark: "benchmark",
  scoreboard: "scoreboard",
  "noise-floors": "noise",
  "comparison-armed": "comparison",
  "comparison-result": "comparison",
  drift: "drift",
  "incident-observer": "crashNotes",
  "hardware-fingerprint": "hardware",
  intelligence: "identity",
};

export type DeleteGroup = { group: string; files: string[]; bytes: number };

/** The planned deletes, grouped by what they are, in a stable order (the first file's order in the plan). */
export function groupDeletes(plan: ClearPlan): DeleteGroup[] {
  const out: DeleteGroup[] = [];
  for (const d of plan.delete) {
    const group = STORE_GROUPS[d.store] ?? "other";
    let g = out.find((x) => x.group === group);
    if (!g) {
      g = { group, files: [], bytes: 0 };
      out.push(g);
    }
    g.files.push(d.rel);
    g.bytes += d.size;
  }
  return out;
}

export type KeptGroup = { code: string; known: boolean; files: string[] };

export function groupKept(kept: Kept[]): KeptGroup[] {
  const out: KeptGroup[] = [];
  for (const k of kept) {
    let g = out.find((x) => x.code === k.code);
    if (!g) {
      g = { code: k.code, known: (KEPT_CODES as readonly string[]).includes(k.code), files: [] };
      out.push(g);
    }
    g.files.push(k.rel);
  }
  return out;
}

export function knownRefusal(code: string): boolean {
  return (REFUSAL_CODES as readonly string[]).includes(code);
}

/** Size in words-friendly units. Never "0 KB" for a file that has bytes. */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export type ResultKind = "nothing" | "deleted" | "stopped" | "not_finished";

/** The one headline a report may have. "deleted" only when `complete` and something was listed. */
export function resultKind(r: ClearReport): ResultKind {
  if (r.complete && r.nothing_to_do) return "nothing";
  if (r.complete) return "deleted";
  if (r.stopped.length > 0) return "stopped";
  return "not_finished";
}

/** Minimal Storage shape, so a test can pass its own. */
export type StorageLike = {
  readonly length: number;
  key(i: number): string | null;
  getItem(k: string): string | null;
  removeItem(k: string): void;
};

export type WebviewResult = { removed: string[]; stillThere: string[] };

/**
 * Removes exactly the keys `targets` name (a whole key, or every key starting with a prefix), from local
 * or session storage as each target says, then reads each back. Never calls `clear()`: the user's
 * settings and other keys stay.
 */
export function clearWebviewTargets(targets: WebviewTarget[], local: StorageLike, session: StorageLike): WebviewResult {
  const removed: string[] = [];
  const stillThere: string[] = [];
  for (const t of targets) {
    const store = t.session_storage ? session : local;
    const keys: string[] = [];
    if (t.prefix) {
      for (let i = 0; i < store.length; i++) {
        const k = store.key(i);
        if (k !== null && k.startsWith(t.key)) keys.push(k);
      }
    } else if (store.getItem(t.key) !== null) {
      keys.push(t.key);
    }
    for (const k of keys) {
      try {
        store.removeItem(k);
      } catch {
        // read back below decides
      }
      if (store.getItem(k) === null) removed.push(k);
      else stillThere.push(k);
    }
  }
  return { removed, stillThere };
}

/** Restart reasons the screen handles itself. Others are shown by code with "close and reopen Compy". */
export const SCREEN_MEMORY = "screen_memory";

export function otherRestartReasons(r: ClearReport): string[] {
  return r.restart_reasons.filter((x) => x !== SCREEN_MEMORY);
}
