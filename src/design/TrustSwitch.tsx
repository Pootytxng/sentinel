import "./TrustSwitch.css";

// The trust-switch — Compy's most important control: the apply AND the undo in one toggle
// (kernel §6). Shared by Command Center + Fix so there's ONE source of truth for the control and
// for the snapshot-reveal copy. Keyboard accessible (role=switch; a button is space/enter native).
// The actual apply/rollback runs through the caller's existing audited flow — this is presentation.

// The locked snapshot-reveal copy (owner-confirmed kernel §6 verbatim). `restoresLabel` is the
// backend's named prior (e.g. "Balanced", "On"); when absent, the truthful generic stands in.
export function restoresCopy(restoresLabel?: string | null): string {
  return `snapshot captured — restores ${
    restoresLabel ?? "your previous setting"
  } · logged to Trust Ledger`;
}

export function TrustSwitch({
  applied,
  busy,
  onToggle,
  ariaLabel,
  label,
}: {
  applied: boolean;
  busy: boolean;
  onToggle: () => void;
  ariaLabel: string;
  label?: string; // optional inline status label; omit when the row carries its own
}) {
  return (
    <div className="ts">
      <button
        type="button"
        role="switch"
        aria-checked={applied}
        aria-label={ariaLabel}
        className={`ts-switch ${applied ? "ts-switch-on" : ""}`}
        disabled={busy}
        onClick={onToggle}
      >
        <span className="ts-thumb" />
      </button>
      {label !== undefined && (
        <span className="ts-label">{busy ? "Working…" : label}</span>
      )}
    </div>
  );
}

// The snapshot-reveal line shown once a change is applied — names the prior the switch will restore.
// A5 fuller delta: `appliedLabel` (the backend's typed "after") appends the other half of the
// before/after pair ADDITIVELY — the locked kernel-§6 sentence above stays verbatim. Absent or
// identical to the prior (a no-op apply), nothing is appended.
export function TrustSnapshotLine({
  restoresLabel,
  appliedLabel,
}: {
  restoresLabel?: string | null;
  appliedLabel?: string | null;
}) {
  const delta = appliedLabel && appliedLabel !== restoresLabel ? ` · set to ${appliedLabel}` : "";
  return (
    <p className="ts-snapshot">
      <span className="ts-snapshot-dot" aria-hidden="true" />
      {restoresCopy(restoresLabel)}
      {delta}
    </p>
  );
}
