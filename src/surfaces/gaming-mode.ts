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

export type RestoredSummary = {
  headline: string;
  detail: string;
  /** The exact restored changes, for the named list (never a bare count-only claim). */
  labels: string[];
};

/**
 * Fired on window whenever ANY surface successfully resolves the on-disk session
 * (stop, recovery restore, or resume's restore leg). The App-level banner and the
 * Gaming pane detect orphans INDEPENDENTLY (by design — recovery must greet the user
 * on any tab), so without this signal, resolving on one surface left the other's
 * prompt stale — and acting on the stale prompt fired a second recover against the
 * already-cleared contract, surfacing a FALSE "couldn't finish restoring" error
 * (self-review catch, 2026-07-08). Listeners clear their own stale prompt; the
 * surface the user acted on shows the one confirmation.
 */
export const GAMING_SESSION_RESOLVED_EVENT = "compy:gaming-session-resolved";

/**
 * Pure: the visible restore-success confirmation (owner-caught UX gap, 2026-07-07:
 * a successful restore showed NOTHING — he couldn't tell it worked). Only called
 * after the backend confirmed EVERY change restored (restore() clears the contract
 * solely on full success), so "restored" here is a proven claim, not an assumption.
 */
export function restoredSummary(changes: SessionChange[]): RestoredSummary {
  const labels = changes.map((c) => c.label);
  const n = labels.length;
  if (n === 0) {
    return {
      headline: "Session ended",
      detail: "This session hadn't changed anything, so there was nothing to restore.",
      labels,
    };
  }
  return {
    headline: "Your settings are back",
    detail: `Restored ${n} change${n === 1 ? "" : "s"} to exactly how ${
      n === 1 ? "it was" : "they were"
    } before:`,
    labels,
  };
}

/**
 * Pure: should the App-level global banners render? Both DEFER to the Gaming pane's
 * own card whenever Optimize is the active surface — otherwise the same message shows
 * twice, stacked above the pane (self-review catches, 2026-07-08: recovery banner in
 * round 1, restored banner in round 2 — the gate must live on BOTH, so it lives here).
 */
// The tabs that embed the full Gaming Mode pane (which renders its OWN recovery/restored card) — the
// global banner must defer to it there, or the SAME event shows twice (bug caught 2026-07-09 self-
// review: the Lab §5 Power-features bay embeds GamingMode too, but the old guard hardcoded only
// "Optimize", so both the global banner AND the embedded card fired on Lab). Named here so the next
// rename can't silently re-break it — add the tab, not another `!==` scattered across two guards.
const TABS_EMBEDDING_GAMING_MODE = new Set(["Optimize", "Lab"]);

export function showGlobalRecoveryBanner(hasRecovery: boolean, activeTab: string): boolean {
  return hasRecovery && !TABS_EMBEDDING_GAMING_MODE.has(activeTab);
}

export function showGlobalRestoredBanner(
  hasRestored: boolean,
  hasRecovery: boolean,
  activeTab: string,
): boolean {
  // A pending recovery outranks the success confirmation; never show both.
  return hasRestored && !hasRecovery && !TABS_EMBEDDING_GAMING_MODE.has(activeTab);
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
