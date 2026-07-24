// Topbar update pill (live-updater train, ARMED 2026-07-22).
//
// Renders NOTHING until a signed update is actually available or being applied — an
// up-to-date build shows zero update chrome (no fake affordances, no "up to date"
// claims). Consent-first: the pill downloads nothing until "Update now" is clicked.
import { useState } from "react";
import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next instance is initialized before this file's t() calls run.
import "../i18n";
import { useUpdate } from "./use-update";

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
        className="v2-update"
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
          {phase.notes ? <div className="v2-update-notes">{phase.notes}</div> : null}
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
