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
// C2b adds "clear everything": its status, the start-up finish of a pending window clear, and "Undo all first".

import { invoke } from "@tauri-apps/api/core";

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
  // A stop reason only (in the Trial store's gate, C1 review B4): a change was applied after the list was made.
  "trials_tied_to_changes",
  // "Clear everything" only (C2b).
  "changes_applied",
  "ledger_unreadable",
  "ledger_set_aside",
  "ledger_busy",
  "gaming_orphan",
  "trial_record_set_aside",
  "clear_intent_unreadable",
  "clear_intent_unwritable",
  "store_lock_unavailable",
  "no_clear_in_progress",
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
  // "Clear everything" only (C2b).
  "licence_kept",
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

/** The other stores "Clear everything" deletes (C2b), by inventory row id. Every `ledger-*` row is the change
 *  history and every `export-*` row a saved report (`storeGroup`). */
export const EVERYTHING_GROUPS: Record<string, string> = {
  "support-evidence": "support",
  "readiness-dismissals": "dismissed",
  "receipts-consent": "sharing",
  license: "licence",
  "rules-manifest": "caches",
  "rules-body": "caches",
  "rules-version": "caches",
  "case-catalog": "caches",
  "case-fetch-disabled": "caches",
};

/** Which words a planned delete's store gets. Anything unnamed is "other working files and damaged copies". */
export function storeGroup(store: string): string {
  if (store.startsWith("ledger-")) return "changeHistory";
  if (store.startsWith("export-")) return "reports";
  return STORE_GROUPS[store] ?? EVERYTHING_GROUPS[store] ?? "other";
}

export type DeleteGroup = { group: string; files: string[]; bytes: number };

/** The planned deletes, grouped by what they are, in a stable order (the first file's order in the plan). */
export function groupDeletes(plan: ClearPlan): DeleteGroup[] {
  const out: DeleteGroup[] = [];
  for (const d of plan.delete) {
    const group = storeGroup(d.store);
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

export type ResultKind = "nothing" | "all_gone" | "deleted" | "stopped" | "not_finished";

/** The one headline a report may have. "deleted" only when `complete` and this run deleted at least one file;
 *  a complete run whose listed files were all already gone says so instead. */
export function resultKind(r: ClearReport): ResultKind {
  if (r.complete && r.nothing_to_do) return "nothing";
  if (r.complete && r.deleted.length === 0) return "all_gone";
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

/**
 * Which sentence a failed delete gets. The backend's `error` is developer English (data_clear.rs `delete_one`,
 * `remove_by_handle`, or a Windows message ending in "(os error N)"); the screen never shows it, only its own
 * words and, for an unnamed Windows error, the number.
 */
export type FailureKind =
  | { kind: "in_use" }
  | { kind: "denied" }
  | { kind: "still_there" }
  | { kind: "moved" }
  | { kind: "folder_moved" }
  | { kind: "os"; code: number }
  | { kind: "other" };

export function failureKind(error: string): FailureKind {
  if (error.includes("is still there after the delete")) return { kind: "still_there" };
  // A folder on the way (the data folder or a sub-folder) changed: a link or something else took its place.
  if (/not where it was planned|leads outside|is a link or not a folder/.test(error)) return { kind: "folder_moved" };
  if (error.includes("is not a plain file")) return { kind: "moved" };
  const os = /\(os error (\d+)\)/.exec(error);
  if (os) {
    const code = Number(os[1]);
    if (code === 32 || code === 33) return { kind: "in_use" };
    if (code === 5) return { kind: "denied" };
    return { kind: "os", code };
  }
  return { kind: "other" };
}

/** The locale key (under `settings.yourData.`) and values for one failed delete. */
export function failureLine(f: FailedDelete): { key: string; opts: Record<string, string | number> } {
  const why = failureKind(f.error);
  const key = {
    in_use: "fileFailedInUse",
    denied: "fileFailedDenied",
    still_there: "fileFailedStillThere",
    moved: "fileFailedMoved",
    folder_moved: "fileFailedFolderMoved",
    os: "fileFailedCode",
    other: "fileFailedOther",
  }[why.kind];
  return { key, opts: why.kind === "os" ? { file: f.rel, code: why.code } : { file: f.rel } };
}

// ---- C2b: "Clear everything" ----------------------------------------------------------------------------

export type Scope = "play_history" | "everything";

/** The licence file is part of this plan's choice: listed to delete, or kept because the box is not ticked. */
export function planHasLicence(plan: ClearPlan): boolean {
  return plan.delete.some((d) => d.store === "license") || plan.kept.some((k) => k.code === "licence_kept");
}

/** What `get_clear_status` answers (data_clear.rs `ClearStatus`). */
export type ClearStatus = {
  roll_forward: { status: string; detail?: unknown } | null;
  record: "none" | "files_pending" | "webview_pending" | "abandoned" | "unreadable" | "no_root";
  abandoned_code: string | null;
  webview: WebviewTarget[];
};

/** Start-up result codes and abandon codes the screen has its own sentence for. */
export const ROLL_FORWARD_STATUSES = ["completed", "incomplete", "webview_pending", "abandoned", "kept", "deferred"] as const;
export const ABANDON_CODES = ["needs_reconfirm", "changes_applied", "ledger_unreadable", "ledger_set_aside"] as const;

/** The status line (locale key under `settings.yourData.status.`) and whether to offer "Dismiss". `null`: nothing
 *  to say. A start-up result is said first; otherwise an abandoned record still on disk. */
export function statusLine(s: ClearStatus): { key: string; code?: string; dismiss: boolean } | null {
  const rf = s.roll_forward?.status;
  if (rf === "abandoned" || (!rf && s.record === "abandoned")) {
    const fromRf = (s.roll_forward?.detail as { code?: string } | undefined)?.code;
    const code = fromRf ?? s.abandoned_code ?? "needs_reconfirm";
    const known = (ABANDON_CODES as readonly string[]).includes(code);
    return { key: known ? `abandoned_${code}` : "abandoned_other", code, dismiss: s.record === "abandoned" };
  }
  if (rf && (ROLL_FORWARD_STATUSES as readonly string[]).includes(rf)) {
    return { key: rf, dismiss: s.record === "abandoned" };
  }
  if (s.record === "unreadable") return { key: "kept", dismiss: false };
  return null;
}

/** Rows "Undo all first" undoes: every row that is not rolled back, newest first (the ledger's order of
 *  undoing). Each goes through the existing rollback path, one at a time. */
export function undoOrder<T extends { status: string; applied_at: string }>(rows: T[]): T[] {
  return rows.filter((r) => r.status !== "rolled_back").sort((a, b) => b.applied_at.localeCompare(a.applied_at));
}

/**
 * At start (main window only): a "clear everything" whose files are all gone leaves the window's own notes for the
 * window to remove (record `webview_pending`, e.g. Compy was closed right after the clear). Removes exactly the
 * inventory's keys, removes the record, and reloads so nothing already read from the old notes stays on screen.
 * Anything that fails leaves things as they are: the next start tries again. Returns what it did.
 */
export async function finishPendingClearAtBoot(
  local: StorageLike,
  session: StorageLike,
  reload: () => void,
): Promise<"nothing" | "finished" | "failed"> {
  let status: ClearStatus;
  try {
    status = await invoke<ClearStatus>("get_clear_status");
  } catch {
    return "failed";
  }
  if (status.record !== "webview_pending") return "nothing";
  const out = clearWebviewTargets(status.webview, local, session);
  if (out.stillThere.length > 0) return "failed";
  try {
    await invoke("acknowledge_clear");
  } catch {
    return "failed";
  }
  reload();
  return "finished";
}

/** Restart reasons the screen handles itself. Others are shown by code with "close and reopen Compy". */
export const SCREEN_MEMORY = "screen_memory";

export function otherRestartReasons(r: ClearReport): string[] {
  return r.restart_reasons.filter((x) => x !== SCREEN_MEMORY);
}
