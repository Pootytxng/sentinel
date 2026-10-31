// Problems (glass redesign, owner decision 2026-10-30) — the FIGURE OUT WHAT WENT WRONG door.
// Crash & Freeze Rescue used to live one level down, as a station in the Test room's dock; the two
// flagship journeys are equal (Constitution), so it now has its own door. The station itself is
// unchanged: same scan, same evidence, same "Put back" through App's ledger handlers. It scans on
// arrival because coming here IS the question; the front door (Health) still never assumes anything
// is wrong.
import { useTranslation } from "react-i18next";
import type { AppliedChange } from "../../types";
import { BlackBox } from "../BlackBox";
import "../glass-rooms.css";

export function ProblemsRoom({
  changes,
  onChanged,
  ledgerBusy,
  onLedgerBusy,
  focusIncidentId,
}: {
  changes: AppliedChange[];
  onChanged: () => Promise<unknown> | void;
  ledgerBusy: boolean;
  onLedgerBusy: (busy: boolean) => void;
  /** A one-time deep link to one incident (the Health card's "Find out why"). */
  focusIncidentId: string | null;
}) {
  const { t } = useTranslation();
  return (
    <section className="gl-room" data-room="problems" aria-labelledby="gl-problems-h1">
      <header className="gl-head">
        <div className="gl-head-text">
          <h1 className="gl-h1" id="gl-problems-h1">
            {t("common.problems.title")}
          </h1>
        </div>
      </header>
      <div className="gl-card gl-station">
        <BlackBox
          selectedIncidentId={focusIncidentId}
          scanOnOpen
          changes={changes}
          onChanged={onChanged}
          ledgerBusy={ledgerBusy}
          onLedgerBusy={onLedgerBusy}
        />
      </div>
    </section>
  );
}
