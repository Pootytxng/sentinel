import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import "../../i18n";
import Fix from "../Fix";
import { GamingMode } from "../GamingMode";
import { deriveReverted } from "../use-scan";
import { takeCheckFocus } from "../check-focus";
import { turnBackOn } from "../../data/turn-back-on";
import { useConfirm } from "../../design/ConfirmDialog";
import { knownIncomplete, useLedgerHealth } from "../../design/LedgerHealthNotice";
import { GAMING_PANE_UNMOUNTED_EVENT, GAMING_SESSION_RESOLVED_EVENT } from "../gaming-mode";
import type { SlotRead } from "../../data/tuning-tools";
import type { LabFastPathProps } from "./OptimizeStation";

// D6 (owner decision 2026-11-24, §38 layer 3 opt-in): station 1's body when the Tuning tools are OFF. The
// Optimize switches, the cleanup scan and Power features are tuning tools and stand down; what stays is
// layer-1 safety, all on paths that already exist:
//   - "Applied & history": the SAME <Fix view="ledger"> OptimizeStation renders (App's rollback, the C6 walk,
//     per-record elevation), open, so "Test → Applied & history" in every landed string stays true;
//   - "Turned off outside Compy": each change Compy applied that reads off now, with the SAME turnBackOn the
//     health check and the Something's-wrong card call (one confirm, one audited apply, no new path);
//   - Gaming Mode: STARTING it is a tuning tool, but Stop and "Finish the last Gaming Mode session" are
//     layer 1, so the pane shows whenever the session slot is not empty (on, waiting to be finished, or a
//     slot Compy couldn't read). With the slot empty no Gaming Mode start is shown.
// Nothing here reads anything new: the ledger is App's list, the slot is the read the pane itself makes.

async function readSlot(): Promise<SlotRead> {
  return invoke<unknown>("get_gaming_session_state")
    .then((s): SlotRead => (s == null ? "empty" : "present"))
    .catch((): SlotRead => "unread");
}

export function ChangesFace(props: LabFastPathProps) {
  const { t } = useTranslation();
  const confirm = useConfirm();
  const reverted = useMemo(() => deriveReverted(props.changes), [props.changes]);
  const ledgerIncomplete = knownIncomplete(useLedgerHealth(props.changes)) != null;
  const [busyId, setBusyId] = useState<string | null>(null);

  // The Gaming Mode slot, re-read whenever a session resolves or a pane closes (App does the same).
  const [slot, setSlot] = useState<SlotRead | null>(null);
  const reread = useCallback(() => {
    void readSlot().then(setSlot);
  }, []);
  useEffect(() => {
    if (!props.gamingEnabled) return;
    reread();
    window.addEventListener(GAMING_SESSION_RESOLVED_EVENT, reread);
    window.addEventListener(GAMING_PANE_UNMOUNTED_EVENT, reread);
    return () => {
      window.removeEventListener(GAMING_SESSION_RESOLVED_EVENT, reread);
      window.removeEventListener(GAMING_PANE_UNMOUNTED_EVENT, reread);
    };
  }, [props.gamingEnabled, reread]);
  const showGaming = !!props.gamingEnabled && slot !== null && slot !== "empty";

  // The Something's-wrong card can arrive asking for the "turn it back on" control: focus the first one.
  useEffect(() => {
    const first = document.querySelector<HTMLElement>('[data-focus-target="applied-changes"] button:not(:disabled)');
    if (first && takeCheckFocus("applied-changes")) first.focus();
  }, [reverted.length]);

  const turnOn = async (rev: { rec_id: string; title: string }) => {
    try {
      await turnBackOn(rev, {
        confirm: async (o) => {
          const ok = await confirm(o);
          if (ok && !o.acknowledge) setBusyId(rev.rec_id);
          if (o.acknowledge) setBusyId(null);
          return ok;
        },
        t,
        after: () => props.onChanged(),
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="lab-optimize lab-changes" data-testid="lab-changes-face">
      <p className="lab-changes-note">{t("lab.tuningOff.note")}</p>
      <button
        type="button"
        className="btn btn-small lab-changes-settings"
        onClick={() => window.dispatchEvent(new Event("compy:open-settings"))}
      >
        {t("lab.tuningOff.openSettings")}
      </button>

      {reverted.length > 0 && (
        <section className="lab-changes-off" data-focus-target="applied-changes" data-testid="lab-changes-off">
          <h3 className="lab-changes-head">{t("lab.tuningOff.offOutsideTitle")}</h3>
          <p className="lab-changes-reason">
            {reverted.length === 1
              ? t("optimize.check.revertedReasonSingle")
              : t("optimize.check.revertedReasonMulti", { titles: reverted.map((r) => r.title).join(", ") })}
          </p>
          <div className="check-drift-actions">
            {reverted.map((rev) => (
              <button
                key={rev.rec_id}
                type="button"
                className="btn btn-small"
                disabled={busyId !== null || props.busyId !== null}
                onClick={() => void turnOn(rev)}
              >
                {busyId === rev.rec_id ? t("optimize.check.turningOnEllipsis") : t("optimize.check.turnTitleOn", { title: rev.title })}
              </button>
            ))}
          </div>
        </section>
      )}

      {showGaming && (
        <section className="lab-changes-gaming" data-testid="lab-changes-gaming">
          <GamingMode />
        </section>
      )}

      <section className="lab-changes-ledger" data-testid="lab-changes-ledger">
        <h3 className="lab-changes-head">
          {ledgerIncomplete
            ? t("lab.optimizeStation.appliedHistorySummaryUnvouched")
            : t("lab.optimizeStation.appliedHistorySummary")}
        </h3>
        <Fix
          recs={props.recs ?? []}
          startup={props.startup}
          changes={props.changes}
          busyId={props.busyId}
          isAppliable={props.isAppliable}
          activeChangeFor={props.activeChangeFor}
          onToggleRec={props.onToggleRec}
          onToggleStartup={props.onToggleStartup}
          onRollback={props.onRollback}
          onApplyBatch={props.onApplyBatch}
          onOpenLibrary={props.onOpenLibrary}
          vendor={props.vendor}
          onChanged={props.onChanged}
          view="ledger"
          ledgerRead={props.ledgerRead}
        />
      </section>
    </div>
  );
}

export default ChangesFace;