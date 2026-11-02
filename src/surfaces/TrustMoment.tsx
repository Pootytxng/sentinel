import { useMemo, useState } from "react";
import { writeLedger } from "../data/ledger-write";
import { isUnrecordedUndo } from "../data/rollback-error";
import { useTranslation } from "react-i18next";
import type { Recommendation, AppliedChange } from "../types";
import { friendlyLabel } from "../data/friendly-labels";
import { pickTrustDemoRec, shouldOfferTrustMoment } from "./trust-moment-data";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";
import "./trust-moment.css";

// TrustMoment (consumer-panel Phase 2, plan 2026-07-11) — the guided "watch it work" loop the
// Burned Skeptic asked for: before a brand-new user is asked to trust anything, let them watch
// ONE trivial, reversible setting get applied and rolled back, live, with the receipt visible.
// Runs the SAME audited IPC every real change uses (apply_recommendation → rollback_change, ledger
// receipts included) — zero new mutation paths. User-consented (a button, never automatic), once
// (persisted), only offered while the Trust Ledger is empty, and only on a whitelisted HKCU-only
// rec so no UAC prompt interrupts the demo (trust-moment-data.ts).

const DONE_KEY = "compy_trust_moment";

const readDone = (): boolean => {
  try {
    return localStorage.getItem(DONE_KEY) === "1";
  } catch {
    return true; // storage unavailable → never nag
  }
};
const persistDone = () => {
  try {
    localStorage.setItem(DONE_KEY, "1");
  } catch {
    /* session-only */
  }
};

type Phase = "offer" | "applying" | "applied" | "reverting" | "done" | "error";

// One demo at a time, across remounts. The card lives inside the Health summary, so "Open the full
// health check" (or leaving Health) remounts it while a run is mid-flight. A fresh copy must neither
// offer nor start a second run: its apply would snapshot the first run's "on" as its "before", and
// its undo would then leave the setting on while the ledger reads it undone (rollback-first,
// ARCHITECTURE_LOCKS §3). The first run carries on to its own undo after an unmount.
let demoInFlight = false;

export function TrustMoment({
  recs,
  changes,
  isAppliable,
  onChanged,
}: {
  recs: Recommendation[] | null;
  changes: AppliedChange[];
  isAppliable: (recId: string) => boolean;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [done, setDone] = useState(readDone);
  const [phase, setPhase] = useState<Phase>("offer");
  const [receipt, setReceipt] = useState<AppliedChange | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const demoRec = useMemo(() => pickTrustDemoRec(recs, isAppliable), [recs, isAppliable]);

  // Once running, the card stays through the whole loop even though the demo's own apply makes
  // the ledger non-empty mid-flight; the offer gate only decides whether to APPEAR.
  const offered = shouldOfferTrustMoment(changes, done) && demoRec != null && !demoInFlight;
  if (!offered && phase === "offer") return null;
  if (done && phase === "offer") return null;

  const name = demoRec ? (friendlyLabel(demoRec.id)?.headline ?? demoRec.title) : "";

  const dismiss = () => {
    persistDone();
    setDone(true);
  };

  const run = async () => {
    if (!demoRec || demoInFlight) return;
    demoInFlight = true;
    try {
      setPhase("applying");
      setErrorMsg(null);
      let change: AppliedChange;
      try {
        change = await writeLedger<AppliedChange>("apply_recommendation", {
          recId: demoRec.id,
          recTitle: demoRec.title,
        });
      } catch (e) {
        setErrorMsg(t("home.trustMoment.errors.applyFailed", { error: String(e) }));
        setPhase("error");
        return;
      }
      setReceipt(change);
      setPhase("applied");
      // Let the applied state + receipt actually be READ before the rollback half runs.
      await new Promise((r) => setTimeout(r, 2600));
      setPhase("reverting");
      try {
        await writeLedger("rollback_change", { changeId: change.id });
      } catch (e) {
        // Honest, unsoftened: the change is real and still active — say exactly where to undo it.
        // #631: an undo that ran but couldn't be saved is not a failed undo — never say "still active".
        setErrorMsg(
          isUnrecordedUndo(e)
            ? t("common.undoUnrecorded")
            : t("home.trustMoment.errors.rollbackFailed", { error: String(e) }),
        );
        setPhase("error");
        onChanged();
        return;
      }
      setPhase("done");
      persistDone();
      setDone(true);
      onChanged();
    } finally {
      demoInFlight = false;
    }
  };

  return (
    <section className="trust-moment" aria-label={t("home.trustMoment.sectionAria")}>
      <div className="tm-head">{t("home.trustMoment.heading")}</div>
      {phase === "offer" && (
        <>
          <p className="tm-body">
            {t("home.trustMoment.offer.bodyPre")} <b>{name}</b>{" "}
            {t("home.trustMoment.offer.bodyPost")}
          </p>
          <div className="tm-actions">
            <button type="button" className="tm-btn tm-btn-primary" onClick={run}>
              {t("home.trustMoment.actions.watch")}
            </button>
            <button type="button" className="tm-btn" onClick={dismiss}>
              {t("home.trustMoment.actions.noThanks")}
            </button>
          </div>
        </>
      )}
      {phase !== "offer" && (
        <div className="tm-live" role="status" aria-live="polite">
          <p className={`tm-step ${phase !== "applying" ? "tm-step-done" : "tm-step-now"}`}>
            {phase === "applying"
              ? t("home.trustMoment.live.applyingPrefix")
              : t("home.trustMoment.live.appliedPrefix")}
            <b>{name}</b>
            {phase === "applying" ? t("home.trustMoment.live.applyingSuffix") : ""}
          </p>
          {(phase === "applied" || phase === "reverting" || phase === "done") && receipt && (
            <p className={`tm-step ${phase === "applied" ? "tm-step-now" : "tm-step-done"}`}>
              {t("home.trustMoment.live.receiptPre")}{" "}
              <b>{receipt.restores_label || t("home.trustMoment.live.defaultRestoreValue")}</b>
            </p>
          )}
          {(phase === "reverting" || phase === "done") && (
            <p className={`tm-step ${phase === "reverting" ? "tm-step-now" : "tm-step-done"}`}>
              {phase === "reverting"
                ? t("home.trustMoment.live.rollingBack")
                : t("home.trustMoment.live.rolledBack")}
            </p>
          )}
          {phase === "done" && (
            <>
              <p className="tm-body tm-close">{t("home.trustMoment.done.body")}</p>
              <div className="tm-actions">
                <button type="button" className="tm-btn tm-btn-primary" onClick={dismiss}>
                  {t("home.trustMoment.actions.gotIt")}
                </button>
              </div>
            </>
          )}
          {phase === "error" && (
            <>
              <p className="tm-body tm-error">{errorMsg}</p>
              <div className="tm-actions">
                <button type="button" className="tm-btn" onClick={dismiss}>
                  {t("home.trustMoment.actions.close")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export default TrustMoment;
