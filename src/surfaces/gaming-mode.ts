// Pure, framework-free helpers + TS mirrors of the Rust IPC payloads for
// Gaming Mode (F1). Kept separate from the React surface so the logic is
// unit-testable without a DOM. Status strings mirror the Rust serde
// (kebab-case `SessionStatus`).

import type { TFunction } from "i18next";

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
  /** CR-gm-skipped-line: backend labels of steps left alone because a Trial or the benchmark held
   *  their setting. Absent on older files and when nothing was left alone. */
  left_alone?: string[];
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
const SUSPENDABLE_SERVICE_DEFS: { name: string; key: string; fallbackLabel: string }[] = [
  { name: "SysMain", key: "sysMain", fallbackLabel: "SysMain (SuperFetch) — frees RAM during play" },
  { name: "DiagTrack", key: "diagTrack", fallbackLabel: "Diagnostics & telemetry — Windows usage reporting" },
  { name: "WSearch", key: "wSearch", fallbackLabel: "Windows Search indexing — pauses background disk churn" },
];

// i18n (2026-07-23): `t` optional/trailing, same convention as verdictChip/verdictDefinition
// (verdict-glossary.ts) — omitting it returns the English fallbackLabel below unchanged. This is
// the client-side-only picker list (pre-session); NOT to be confused with SessionChange.label,
// the backend-authored contract text that's never translated (see that type's own comment).
export function suspendableServices(t?: TFunction): { name: string; label: string }[] {
  return SUSPENDABLE_SERVICE_DEFS.map((s) => ({
    name: s.name,
    label: t
      ? t(`gaming.gamingMode.suspendableServices.${s.key}`, { defaultValue: s.fallbackLabel })
      : s.fallbackLabel,
  }));
}

export type ChangeSummary = {
  line: string;
  needsUac: boolean;
  rows: { label: string; elevated: boolean }[];
};

/**
 * Pure: turn a session's applied changes into the always-visible honesty line
 * + diff rows. An empty bundle yields an honest "nothing to change" line
 * (e.g. a PC with no high-perf plan and Game Mode already on). `t` optional/trailing
 * (i18n, 2026-07-23) — omitting it reproduces today's English exactly. `rows[].label` stays
 * untranslated regardless of `t`: it's backend-authored text (see SessionChange's own comment).
 */
export function summarizeChanges(changes: SessionChange[], t?: TFunction): ChangeSummary {
  const rows = changes.map((c) => ({ label: c.label, elevated: c.elevated_restore }));
  const needsUac = changes.some((c) => c.elevated_restore);
  const n = changes.length;
  let line: string;
  if (n === 0) {
    line = t
      ? t("gaming.gamingMode.noChangesLine", { defaultValue: "No changes needed on this PC" })
      : "No changes needed on this PC";
  } else if (t) {
    line = t("gaming.gamingMode.changesLine", {
      defaultValue: n === 1 ? "{{count}} change · restored on exit" : "{{count}} changes · restored on exit",
      count: n,
    });
  } else {
    line = `${n} change${n === 1 ? "" : "s"} · restored on exit`;
  }
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
 * Fired by the Gaming Mode pane on mount/unmount so the App-level banners know when the
 * pane's own richer card is ACTUALLY on screen. The old tab-name deferral was a blind spot:
 * the pane only mounts inside a doored segment (classic Optimize) or an opened disclosure
 * (the Lab's Optimize station → Power features), so "the Lab tab embeds the pane" was true
 * of the tab but false of the screen — a pending recovery was invisible while sitting on
 * the Lab (owner-lived gap, carried note 2026-07-10 → this train).
 */
export const GAMING_PANE_MOUNTED_EVENT = "compy:gaming-pane-mounted";
export const GAMING_PANE_UNMOUNTED_EVENT = "compy:gaming-pane-unmounted";

// The exact per-item labels the backend writes into the session contract (pinned
// byte-identical in gaming_orchestrator.rs tests) — the only bridge from an interrupted
// session's recorded changes back to the StartOptions that produced them.
const USB_LABEL = "USB selective suspend off (AC)";
const PCIE_LABEL = "PCIe ASPM off (AC)";
const SUSPEND_LABEL = /^Suspend (.+) for this session$/;

/**
 * Pure: reconstruct StartOptions from an interrupted session's OWN recorded changes, so
 * "Resume Gaming Mode" re-applies what the session actually had on — not whatever the
 * pane's checkboxes happen to say after a remount (they reset to core-only, silently
 * downgrading the resume). Honest by construction: derived only from changes the backend
 * confirmed applied; the backend re-enforces the service allowlist on start, so a
 * disk-edited label can never suspend anything off-list.
 */
export function resumeOptionsFrom(changes: SessionChange[]): StartOptions {
  return {
    advancedUsb: changes.some((c) => c.label === USB_LABEL),
    advancedPcie: changes.some((c) => c.label === PCIE_LABEL),
    suspendServices: changes
      .map((c) => SUSPEND_LABEL.exec(c.label)?.[1])
      .filter((n): n is string => Boolean(n)),
  };
}

/**
 * Pure: the visible restore-success confirmation (owner-caught UX gap, 2026-07-07:
 * a successful restore showed NOTHING — he couldn't tell it worked). Only called
 * after the backend confirmed EVERY change restored (restore() clears the contract
 * solely on full success), so "restored" here is a proven claim, not an assumption.
 * `t` optional/trailing (i18n, 2026-07-23) — omitting it reproduces today's English exactly.
 * `labels` stays untranslated regardless of `t`: it's backend-authored text (see
 * SessionChange's own comment).
 */
export function restoredSummary(changes: SessionChange[], t?: TFunction): RestoredSummary {
  const labels = changes.map((c) => c.label);
  const n = labels.length;
  if (n === 0) {
    return {
      headline: t
        ? t("gaming.gamingMode.sessionEndedHeadline", { defaultValue: "Session ended" })
        : "Session ended",
      detail: t
        ? t("gaming.gamingMode.sessionEndedDetail", {
            defaultValue: "This session hadn't changed anything, so there was nothing to restore.",
          })
        : "This session hadn't changed anything, so there was nothing to restore.",
      labels,
    };
  }
  const headline = t
    ? t("gaming.gamingMode.restoredHeadline", { defaultValue: "Your settings are back" })
    : "Your settings are back";
  const detail = t
    ? t("gaming.gamingMode.restoredDetail", {
        defaultValue:
          n === 1
            ? "Restored {{count}} change to exactly how it was before:"
            : "Restored {{count}} changes to exactly how they were before:",
        count: n,
      })
    : `Restored ${n} change${n === 1 ? "" : "s"} to exactly how ${n === 1 ? "it was" : "they were"} before:`;
  return { headline, detail, labels };
}

/**
 * Pure: should the App-level global banners render? Both DEFER to the Gaming pane's own
 * card whenever a pane is ACTUALLY MOUNTED — otherwise the same message shows twice,
 * stacked above the pane (self-review catches, 2026-07-08 rounds 1+2). Mount-aware, not
 * tab-aware: the old tab-name set ("Optimize"/"Lab") deferred on the whole tab while the
 * pane only mounts inside a doored segment / opened disclosure there, so a pending
 * recovery was INVISIBLE anywhere on those tabs outside the gaming door (owner-lived on
 * the Lab, 2026-07-10). `paneMounted` comes from GAMING_PANE_(UN)MOUNTED_EVENT tracking
 * in App — the deferral now follows the pane itself through any future re-homing.
 */
export function showGlobalRecoveryBanner(hasRecovery: boolean, paneMounted: boolean): boolean {
  return hasRecovery && !paneMounted;
}

export function showGlobalRestoredBanner(
  hasRestored: boolean,
  hasRecovery: boolean,
  paneMounted: boolean,
): boolean {
  // A pending recovery outranks the success confirmation; never show both.
  return hasRestored && !hasRecovery && !paneMounted;
}

/** Pure: human label for a session status (used in recovery / status messaging). `t`
 * optional/trailing (i18n, 2026-07-23) — omitting it reproduces today's English exactly. */
export function statusLabel(status: GamingSessionStatus, t?: TFunction): string {
  const fallbacks: Record<GamingSessionStatus, string> = {
    active: "still applied — not yet restored",
    ending: "Restoring your settings…",
    "restore-pending": "Undoing a partial change…",
    "restore-failed": "Restore failed — needs attention",
  };
  const keys: Record<GamingSessionStatus, string> = {
    active: "active",
    ending: "ending",
    "restore-pending": "restorePending",
    "restore-failed": "restoreFailed",
  };
  if (!t) return fallbacks[status];
  return t(`gaming.gamingMode.statusLabel.${keys[status]}`, { defaultValue: fallbacks[status] });
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
