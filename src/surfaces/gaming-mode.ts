// Pure, framework-free helpers + TS mirrors of the Rust IPC payloads for
// Gaming Mode (F1). Kept separate from the React surface so the logic is
// unit-testable without a DOM. Status strings mirror the Rust serde
// (kebab-case `SessionStatus`).

export type GamingSessionStatus =
  | "active"
  | "ending"
  | "restore-pending"
  | "restore-failed";

export type SessionChange = {
  label: string;
  // The typed rollback contract is opaque on the TS side — it's resolved
  // entirely in Rust. The UI only needs the label + whether restore is elevated.
  rollback_action?: unknown;
  snapshot?: unknown;
  elevated_restore: boolean;
};

export type GamingSessionFile = {
  schema_version: number;
  session_id: string;
  status: GamingSessionStatus;
  started_at: string;
  app_version: string;
  changes: SessionChange[];
  started_monitoring: boolean;
};

export type StartOptions = {
  advancedUsb: boolean;
  advancedPcie: boolean;
  /** Allowlisted Windows service names to suspend for the session (restored exactly on stop).
   *  The backend re-enforces the KnownService allowlist — off-list/critical names are dropped. */
  suspendServices?: string[];
};

// Services Compy offers to suspend for a gaming session. Names MUST match the Rust KnownService
// allowlist (actions.rs); the backend re-enforces it, so nothing off-list/critical can ever suspend.
// (NvTelemetryContainer is allowlisted in Rust but not offered here — it's NVIDIA-only, and selecting a
// service that doesn't exist on the rig would fail the session start.)
export const SUSPENDABLE_SERVICES: { name: string; label: string }[] = [
  { name: "SysMain", label: "SysMain (SuperFetch) — frees RAM during play" },
  { name: "DiagTrack", label: "Diagnostics & telemetry — Windows usage reporting" },
  { name: "WSearch", label: "Windows Search indexing — pauses background disk churn" },
];

export type ChangeSummary = {
  line: string;
  needsUac: boolean;
  rows: { label: string; elevated: boolean }[];
};

/**
 * Pure: turn a session's applied changes into the always-visible honesty line
 * + diff rows. An empty bundle yields an honest "nothing to change" line
 * (e.g. a PC with no high-perf plan and Game Mode already on).
 */
export function summarizeChanges(changes: SessionChange[]): ChangeSummary {
  const rows = changes.map((c) => ({ label: c.label, elevated: c.elevated_restore }));
  const needsUac = changes.some((c) => c.elevated_restore);
  const line =
    changes.length === 0
      ? "No changes needed on this PC"
      : `${changes.length} change${changes.length === 1 ? "" : "s"} · restored on exit`;
  return { line, needsUac, rows };
}

/** Pure: human label for a session status (used in recovery / status messaging). */
export function statusLabel(status: GamingSessionStatus): string {
  switch (status) {
    case "active":
      return "still applied — not yet restored";
    case "ending":
      return "Restoring your settings…";
    case "restore-pending":
      return "Undoing a partial change…";
    case "restore-failed":
      return "Restore failed — needs attention";
  }
}

/** Pure: does a found-on-startup session represent an unclean (recoverable) end? */
export function isRecoverable(status: GamingSessionStatus): boolean {
  return (
    status === "active" ||
    status === "ending" ||
    status === "restore-pending" ||
    status === "restore-failed"
  );
}
