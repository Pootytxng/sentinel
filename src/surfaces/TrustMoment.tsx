import { useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Recommendation, AppliedChange } from "../types";
import { friendlyLabel } from "../data/friendly-labels";
import { pickTrustDemoRec, shouldOfferTrustMoment } from "./trust-moment-data";
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
  const [done, setDone] = useState(readDone);
  const [phase, setPhase] = useState<Phase>("offer");
  const [receipt, setReceipt] = useState<AppliedChange | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const demoRec = useMemo(() => pickTrustDemoRec(recs, isAppliable), [recs, isAppliable]);

  // Once running, the card stays through the whole loop even though the demo's own apply makes
  // the ledger non-empty mid-flight; the offer gate only decides whether to APPEAR.
  const offered = shouldOfferTrustMoment(changes, done) && demoRec != null;
  if (!offered && phase === "offer") return null;
  if (done && phase === "offer") return null;

  const name = demoRec ? (friendlyLabel(demoRec.id)?.headline ?? demoRec.title) : "";

  const dismiss = () => {
    persistDone();
    setDone(true);
  };

  const run = async () => {
    if (!demoRec) return;
    setPhase("applying");
    setErrorMsg(null);
    let change: AppliedChange;
    try {
      change = await invoke<AppliedChange>("apply_recommendation", {
        recId: demoRec.id,
        recTitle: demoRec.title,
      });
    } catch (e) {
      setErrorMsg(`Couldn't apply it: ${String(e)}. Nothing on your PC was changed.`);
      setPhase("error");
      return;
    }
    setReceipt(change);
    setPhase("applied");
    // Let the applied state + receipt actually be READ before the rollback half runs.
    await new Promise((r) => setTimeout(r, 2600));
    setPhase("reverting");
    try {
      await invoke("rollback_change", { changeId: change.id });
    } catch (e) {
      // Honest, unsoftened: the change is real and still active — say exactly where to undo it.
      setErrorMsg(
        `The apply worked but the rollback didn't finish: ${String(e)}. The change is still active and undoable in the Lab under "Applied & history".`,
      );
      setPhase("error");
      onChanged();
      return;
    }
    setPhase("done");
    persistDone();
    setDone(true);
    onChanged();
  };

  return (
    <section className="trust-moment" aria-label="Watch Compy work">
      <div className="tm-head">Watch it work</div>
      {phase === "offer" && (
        <>
          <p className="tm-body">
            Compy's whole promise is reversible changes with receipts. See the loop once, live, on
            a real setting — <b>{name}</b> gets applied through the same path every change uses,
            then restored to exactly how it is now. About ten seconds; nothing else is touched.
          </p>
          <div className="tm-actions">
            <button type="button" className="tm-btn tm-btn-primary" onClick={run}>
              Watch it work
            </button>
            <button type="button" className="tm-btn" onClick={dismiss}>
              No thanks
            </button>
          </div>
        </>
      )}
      {phase !== "offer" && (
        <div className="tm-live" role="status" aria-live="polite">
          <p className={`tm-step ${phase !== "applying" ? "tm-step-done" : "tm-step-now"}`}>
            {phase === "applying" ? "1/3 · Applying " : "1/3 · Applied ✓ — "}
            <b>{name}</b>
            {phase === "applying" ? "…" : ""}
          </p>
          {(phase === "applied" || phase === "reverting" || phase === "done") && receipt && (
            <p className={`tm-step ${phase === "applied" ? "tm-step-now" : "tm-step-done"}`}>
              2/3 · Receipt written to your Trust Ledger — it restores to{" "}
              <b>{receipt.restores_label || "the exact prior value"}</b>
            </p>
          )}
          {(phase === "reverting" || phase === "done") && (
            <p className={`tm-step ${phase === "reverting" ? "tm-step-now" : "tm-step-done"}`}>
              {phase === "reverting"
                ? "3/3 · Rolling it back…"
                : "3/3 · Rolled back ✓ — your setting is exactly as it was."}
            </p>
          )}
          {phase === "done" && (
            <>
              <p className="tm-body tm-close">
                That's the loop every change gets: applied, receipted, reversible. Both steps are
                in your Trust Ledger.
              </p>
              <div className="tm-actions">
                <button type="button" className="tm-btn tm-btn-primary" onClick={dismiss}>
                  Got it
                </button>
              </div>
            </>
          )}
          {phase === "error" && (
            <>
              <p className="tm-body tm-error">{errorMsg}</p>
              <div className="tm-actions">
                <button type="button" className="tm-btn" onClick={dismiss}>
                  Close
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
