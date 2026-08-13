// Topbar update pill (live-updater train, ARMED 2026-07-22).
//
// Renders NOTHING until a signed update is actually available or being applied — an
// up-to-date build shows zero update chrome (no fake affordances, no "up to date"
// claims). Consent-first: the pill downloads nothing until "Update now" is clicked.
import { useState } from "react";
import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next instance is initialized before this file's t() calls run.
import "../i18n";
import "./update-pill.css";
import { useUpdate } from "./use-update";

/**
 * Release notes arrive as one prose blob (the GitHub release body via the updater manifest).
 * Testers asked "what changed?" — so the blob becomes a plain what's-new list: split on newlines
 * and semicolons, strip list markers and a leading "vX.Y.Z:" version prefix, drop empties. A blob
 * that yields nothing readable falls back to a single item so real notes are never hidden.
 */
export function changelogItems(notes: string): string[] {
  const items = notes
    .split(/\r?\n|;/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .map((line) => line.replace(/^v?\d+\.\d+\.\d+\s*[:—-]\s*/, "").trim())
    .filter(Boolean);
  return items.length > 0 ? items : [notes.trim()];
}

export function UpdatePill() {
  const { t } = useTranslation();
  const { phase, dismissed, install, dismiss } = useUpdate();
  const [open, setOpen] = useState(false);

  if (phase.kind === "idle") return null;
  if (phase.kind === "available" && dismissed) return null;

  if (phase.kind === "downloading") {
    return (
      <span className="v2-update v2-update-busy">
        {phase.pct != null
          ? t("common.updatePill.updatingPct", { pct: phase.pct })
          : t("common.updatePill.updatingStarting")}
      </span>
    );
  }
  if (phase.kind === "installing") {
    return <span className="v2-update v2-update-busy">{t("common.updatePill.installing")}</span>;
  }
  if (phase.kind === "error") {
    return (
      <button
        type="button"
        className="v2-update v2-update-err"
        onClick={install}
        title={phase.message}
      >
        {t("common.updatePill.updateFailedRetry")}
      </button>
    );
  }
  if (phase.kind === "blocked") {
    return (
      <button
        type="button"
        className="v2-update v2-update-err"
        onClick={install}
        title={phase.message}
      >
        finish Gaming Mode before updating
      </button>
    );
  }
  if (phase.kind === "restart-required") {
    return (
      <button
        type="button"
        className="v2-update v2-update-err"
        onClick={install}
        title={phase.message}
      >
        update installed · restart Compy
      </button>
    );
  }

  return (
    <span className="v2-update-wrap">
      <button
        type="button"
        // v2-update-avail is the ATTENTION state (owner ask, 2026-08-13): a tester watched an
        // update sit unnoticed because the offer read as topbar chrome. Available gets a filled,
        // full-contrast pill with a pulsing LED; every other phase keeps the quiet outline.
        className="v2-update v2-update-avail"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="v2-update-led" aria-hidden="true" />
        {t("common.updatePill.updateReady", { version: phase.version })}
      </button>
      {open && (
        <div
          className="v2-update-panel"
          role="dialog"
          aria-label={t("common.updatePill.detailsAriaLabel")}
        >
          <div className="v2-update-title">
            {t("common.updatePill.versionTitle", { version: phase.version })}
          </div>
          {phase.notes ? (
            <>
              <div className="v2-update-whatsnew">{t("common.updatePill.whatsNew")}</div>
              <ul className="v2-update-notes">
                {changelogItems(phase.notes).map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}
          <div className="v2-update-row">
            <button
              type="button"
              className="v2-update-go"
              onClick={() => {
                setOpen(false);
                install();
              }}
            >
              {t("common.updatePill.updateNow")}
            </button>
            <button
              type="button"
              className="v2-update-later"
              onClick={() => {
                setOpen(false);
                dismiss();
              }}
            >
              {t("common.updatePill.later")}
            </button>
          </div>
          <div className="v2-update-fine">{t("common.updatePill.fineprint")}</div>
        </div>
      )}
    </span>
  );
}
