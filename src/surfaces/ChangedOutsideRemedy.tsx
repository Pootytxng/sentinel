import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import { invoke } from "@tauri-apps/api/core";
import { writeLedger } from "../data/ledger-write";

/** history.rs `ChangedOutsideOffer`: a setting whose Compy change reads as replaced by a state Compy
 *  didn't set (today: a power plan the user chose), which the user may record as changed outside Compy. */
export type ChangedOutsideOffer = { rec_id: string; rec_title: string; observed_name: string; rows: number };

/** The words a Trial start refuses in when another Compy change can't be confirmed in place
 *  (experiment.rs `unverified_start_refusal`). */
export const UNCONFIRMED_REFUSAL = "can't be confirmed as still in place";

export function isUnconfirmedRefusal(reason: string | null | undefined): boolean {
  return reason != null && reason.includes(UNCONFIRMED_REFUSAL);
}

/** CR-unconfirmed-remedy: the second choice beside "undo it" when a Trial start is refused because a
 *  Compy change can't be confirmed in place. Shown only for that refusal and only for what the
 *  backend offers; recording is a ledger write and changes nothing on the PC. */
export function ChangedOutsideRemedy({ reason, refresh }: { reason: string; refresh: () => Promise<void> }) {
  const { t } = useTranslation();
  const relevant = isUnconfirmedRefusal(reason);
  const [offers, setOffers] = useState<ChangedOutsideOffer[]>([]);
  const [done, setDone] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!relevant) return;
    let live = true;
    invoke<ChangedOutsideOffer[]>("changed_outside_offers")
      .then((xs) => {
        if (live) setOffers(xs ?? []);
      })
      .catch(() => {
        if (live) setOffers([]);
      });
    return () => {
      live = false;
    };
  }, [relevant, reason]);

  if (!relevant || (offers.length === 0 && done.length === 0)) return null;

  const record = async (o: ChangedOutsideOffer) => {
    setBusy(true);
    setFailed(null);
    try {
      // Review r1: a refresh that fails after the record was saved is not a failed record, so it never
      // reaches the "nothing changed" line; only the command's own refusal does.
      await writeLedger("record_changed_outside", { recId: o.rec_id }, () => refresh().catch(() => {}));
      setDone((d) => [...d, o.rec_id]);
    } catch (e) {
      setFailed(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="exp-order" data-testid="changed-outside">
      {offers.map((o) =>
        done.includes(o.rec_id) ? (
          <p key={o.rec_id} className="exp-note" role="status" data-testid="changed-outside-done">
            {t("lab.changedOutside.done", { change: o.rec_title })}
          </p>
        ) : (
          <div key={o.rec_id}>
            <p className="exp-note">{t("lab.changedOutside.saw", { change: o.rec_title, plan: o.observed_name })}</p>
            <p className="exp-fineprint">{t("lab.changedOutside.keepWhat", { plan: o.observed_name })}</p>
            <div className="exp-running-actions">
              <button type="button" className="exp-cta-ghost" disabled={busy} onClick={() => void record(o)}>
                {t("lab.changedOutside.keep", { plan: o.observed_name })}
              </button>
            </div>
            <p className="exp-fineprint">{t("lab.changedOutside.orUndo")}</p>
          </div>
        ),
      )}
      {failed && (
        <p className="exp-bench-warn" role="alert">
          {t("lab.changedOutside.failed", { reason: failed })}
        </p>
      )}
    </div>
  );
}
