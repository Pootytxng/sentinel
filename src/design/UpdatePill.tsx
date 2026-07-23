// Topbar update pill (live-updater train, ARMED 2026-07-22).
//
// Renders NOTHING until a signed update is actually available or being applied — an
// up-to-date build shows zero update chrome (no fake affordances, no "up to date"
// claims). Consent-first: the pill downloads nothing until "Update now" is clicked.
import { useState } from "react";
import { useUpdate } from "./use-update";

export function UpdatePill() {
  const { phase, dismissed, install, dismiss } = useUpdate();
  const [open, setOpen] = useState(false);

  if (phase.kind === "idle") return null;
  if (phase.kind === "available" && dismissed) return null;

  if (phase.kind === "downloading") {
    return (
      <span className="v2-update v2-update-busy">
        updating · {phase.pct != null ? `${phase.pct}%` : "starting"}
      </span>
    );
  }
  if (phase.kind === "installing") {
    return <span className="v2-update v2-update-busy">installing — Compy restarts itself</span>;
  }
  if (phase.kind === "error") {
    return (
      <button
        type="button"
        className="v2-update v2-update-err"
        onClick={install}
        title={phase.message}
      >
        update failed · retry
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
        update ready · v{phase.version}
      </button>
      {open && (
        <div className="v2-update-panel" role="dialog" aria-label="Update details">
          <div className="v2-update-title">Compy v{phase.version}</div>
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
              Update now
            </button>
            <button
              type="button"
              className="v2-update-later"
              onClick={() => {
                setOpen(false);
                dismiss();
              }}
            >
              Later
            </button>
          </div>
          <div className="v2-update-fine">
            Signature-verified before install · Compy restarts itself
          </div>
        </div>
      )}
    </span>
  );
}
