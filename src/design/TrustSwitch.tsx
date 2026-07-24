import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import "./TrustSwitch.css";

// The trust-switch — Compy's most important control: the apply AND the undo in one toggle
// (kernel §6). Shared by Command Center + Fix so there's ONE source of truth for the control and
// for the snapshot-reveal copy. Keyboard accessible (role=switch; a button is space/enter native).
// The actual apply/rollback runs through the caller's existing audited flow — this is presentation.

// The locked snapshot-reveal copy (owner-confirmed kernel §6 verbatim). `restoresLabel` is the
// backend's named prior (e.g. "Balanced", "On"); when absent, the truthful generic stands in.
// Plain exported function (not a component) — TrustSwitch.test.tsx imports and calls it directly
// with a single argument, so it reads the raw i18next instance (i18n.t) rather than the
// useTranslation() hook, which only works inside a component/hook body.
export function restoresCopy(restoresLabel?: string | null): string {
  return i18n.t("common.trustSwitch.restoresCopy", {
    label: restoresLabel ?? i18n.t("common.trustSwitch.previousSetting"),
  });
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
  const { t } = useTranslation();
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
        <span className="ts-label">{busy ? t("common.trustSwitch.working") : label}</span>
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
  // useTranslation() here (even though restoresCopy below reads the raw i18n instance) subscribes
  // this component to language changes, so a live language switch re-renders it with fresh copy.
  const { t } = useTranslation();
  const delta =
    appliedLabel && appliedLabel !== restoresLabel
      ? t("common.trustSwitch.setTo", { label: appliedLabel })
      : "";
  return (
    <p className="ts-snapshot">
      <span className="ts-snapshot-dot" aria-hidden="true" />
      {restoresCopy(restoresLabel)}
      {delta}
    </p>
  );
}
