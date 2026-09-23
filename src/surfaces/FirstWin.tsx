import { useCallback, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import type { AppliedChange, Recommendation } from "../types";
import { friendlyLabel } from "../data/friendly-labels";
import {
  pickFirstWinChange,
  shouldOfferFirstWin,
  verifyChangeHeld,
  FIRST_WIN_KEY,
  type Verification,
} from "./first-win-data";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors main.tsx's own `import "./i18n"`.
import "../i18n";
import "./FirstWin.css";

// FirstWin — the closing third of the first-win journey (P2, issue #49). TrustMoment rehearses
// apply → receipt → rollback on a demo setting while the ledger is empty; this follows through on
// the user's OWN first live change, once, and then never again.
//
// Three presses, each doing the real thing rather than describing it:
//   1. Check it — re-runs the same read every surface uses (`get_recommendations`), then compares
//      what Compy REMEMBERS (the ledger's `is_still_active`) against what it JUST SAW
//      (`currently_applied`).
//   2. Put it back — the audited `rollback_change`, the same call the ledger room makes.
//   3. Got it — persists, dismisses, gone for good.
//
// The one thing it must never do is claim a speed result. No play session has happened, so "your
// games are faster now" would be fabricated; the honest line names what proving it actually takes
// and points at the room that does the measuring. Reading the machine back is a real proof and is
// the only one earned at this moment.

const readDone = (): boolean => {
  try {
    return localStorage.getItem(FIRST_WIN_KEY) === "1";
  } catch {
    return true; // storage unavailable → never nag
  }
};
const persistDone = () => {
  try {
    localStorage.setItem(FIRST_WIN_KEY, "1");
  } catch {
    /* session-only */
  }
};

type Phase = "intro" | "checking" | "checked" | "undoing" | "undone" | "error";

export function FirstWin({
  changes,
  onChanged,
}: {
  changes: AppliedChange[];
  /** Re-reads the ledger + recs after a rollback (App's `refresh`). */
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [done, setDone] = useState(readDone);
  const [phase, setPhase] = useState<Phase>("intro");
  const [verdict, setVerdict] = useState<Verification | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // The card names ONE change and must keep naming it, even though its own rollback empties the
  // set that chose it. Frozen at first render; `changes` keeps driving the offer gate.
  const subject = useMemo(() => pickFirstWinChange(changes), [changes]);
  const held = useRef<AppliedChange | null>(null);
  if (subject && !held.current) held.current = subject;
  const change = held.current;

  // The verifying read is made HERE and awaited, not taken from a prop the parent refreshes.
  // An earlier draft called the parent's refresh and then read `recs` back through a ref. That is a
  // race with a wrong answer on one side: the parent's refresh resolves once its invokes settle,
  // but React has only SCHEDULED the re-render at that moment, so the ref still holds the recs the
  // card was rendered with — the pre-change list that says the setting is on. A change that had
  // actually reverted would have been confirmed as held. Awaiting the read directly removes the
  // race by construction: the verdict cannot be computed from data older than the button press.
  const runCheck = useCallback(async () => {
    if (!change) return;
    setPhase("checking");
    setErrorMsg(null);
    let fresh: Recommendation[];
    try {
      fresh = await invoke<Recommendation[]>("get_recommendations");
    } catch (e) {
      // A scan that could not run is not evidence the change reverted. Say what happened.
      setErrorMsg(t("home.firstWin.errors.checkFailed", { error: String(e) }));
      setPhase("error");
      return;
    }
    setVerdict(verifyChangeHeld(fresh, change.rec_id));
    setPhase("checked");
  }, [change, t]);

  const undo = useCallback(async () => {
    if (!change) return;
    setPhase("undoing");
    setErrorMsg(null);
    try {
      await invoke("rollback_change", { changeId: change.id });
    } catch (e) {
      setErrorMsg(t("home.firstWin.errors.undoFailed", { error: String(e), historyRoom: t("common.rail.learn") }));
      setPhase("error");
      return;
    }
    setPhase("undone");
    onChanged();
  }, [change, onChanged, t]);

  const dismiss = useCallback(() => {
    persistDone();
    setDone(true);
  }, []);

  // The gate decides whether to APPEAR. Once the card is working it stays through its own rollback,
  // which is what makes the undone state readable instead of a surface that vanishes mid-sentence.
  const offered = shouldOfferFirstWin(changes, done) && change != null;
  if (!offered && phase === "intro") return null;
  if (done && phase === "intro") return null;
  if (!change) return null;

  const name = friendlyLabel(change.rec_id)?.headline ?? change.rec_title;
  // "First" vs "latest" is a fact about the ledger's HISTORY — is there another change the user
  // applied and has not undone — not a claim about what is in effect on the machine now, so it reads
  // the ledger rows, not the Machine Model's in-effect count (#452). A drifted or another-rig row was
  // still applied by the user, so it keeps "first" from being claimed; a rolled-back one (the demo)
  // does not.
  const otherApplied = changes.some((c) => c.id !== change.id && c.status === "applied");
  // Room names are interpolated from the SAME rail strings the nav renders, never typed into the
  // copy — a rename would otherwise leave this card sending people to a door that no longer exists
  // ([[room-labels-vs-nav-ids]]: the user sees labels, ids are persistence keys).
  //
  // Passed as an object LITERAL at every call site rather than one shared `rooms` bag. That is not
  // a style choice: locale-parity-guard reads the options object out of the SOURCE TEXT to prove
  // every {{var}} a translation writes is actually supplied, and a bare identifier gives it nothing
  // to read — all three of these keys were reported as unsupplied placeholders until the literals
  // went back in. The duplication is what makes the guard able to see the call site.
  const historyRoom = t("common.rail.learn");
  const testRoom = t("common.rail.lab");

  return (
    <section className="first-win" aria-label={t("home.firstWin.sectionAria")}>
      <div className="fw-head">
        {otherApplied ? t("home.firstWin.headingLatest") : t("home.firstWin.heading")}
      </div>

      {phase !== "undone" && (
        <p className="fw-body">
          {t("home.firstWin.introPre")} <b>{name}</b>
          {change.applied_label
            ? t("home.firstWin.introTailSet", { value: change.applied_label })
            : t("home.firstWin.introTail")}
        </p>
      )}

      {(phase === "intro" || phase === "checking") && (
        <div className="fw-actions">
          <button
            type="button"
            className="fw-btn fw-btn-primary"
            disabled={phase === "checking"}
            onClick={runCheck}
          >
            {phase === "checking" ? t("home.firstWin.actions.checking") : t("home.firstWin.actions.check")}
          </button>
          <button type="button" className="fw-btn" onClick={dismiss}>
            {t("home.firstWin.actions.gotIt")}
          </button>
        </div>
      )}

      {phase === "checked" && verdict && (
        <div className="fw-verdict" role="status" aria-live="polite">
          <p className={`fw-line fw-line-${verdict}`}>
            {verdict === "held" && (
              <>
                {t("home.firstWin.verdict.heldPre")} <b>{name}</b> {t("home.firstWin.verdict.heldPost")}
              </>
            )}
            {verdict === "reverted" && (
              <>
                {t("home.firstWin.verdict.revertedPre")} <b>{name}</b>{" "}
                {t("home.firstWin.verdict.revertedPost")}
              </>
            )}
            {verdict === "unreadable" && (
              <>
                {t("home.firstWin.verdict.unreadablePre")} <b>{name}</b>{" "}
                {t("home.firstWin.verdict.unreadablePost", { historyRoom })}
              </>
            )}
          </p>
          {/* The honesty line. It sits under EVERY verdict, including the good one, because the
              good one is the moment a user is most likely to hear a speed claim that was never
              made. Compy proved the setting stuck; it has not proved a single frame. */}
          <p className="fw-note">{t("home.firstWin.speedNote", { testRoom })}</p>
        </div>
      )}

      {phase === "undoing" && <p className="fw-line">{t("home.firstWin.actions.undoing")}</p>}

      {phase === "undone" && (
        <div className="fw-verdict" role="status" aria-live="polite">
          <p className="fw-line fw-line-held">
            {t("home.firstWin.undone.pre")} <b>{name}</b> {t("home.firstWin.undone.post")}
          </p>
          <p className="fw-note">{t("home.firstWin.undone.note", { historyRoom })}</p>
        </div>
      )}

      {phase === "error" && (
        <p className="fw-body fw-error" role="status" aria-live="polite">
          {errorMsg}
        </p>
      )}

      {(phase === "checked" || phase === "undone" || phase === "error") && (
        <div className="fw-actions">
          {/* No undo offered on a `reverted` verdict: the machine already says it is off, and a
              button that rolls back something that is not on would be a second claim about state
              Compy just failed to confirm. The ledger room keeps the entry either way. */}
          {phase === "checked" && verdict !== "reverted" && (
            <button type="button" className="fw-btn" onClick={undo}>
              {t("home.firstWin.actions.undo")}
            </button>
          )}
          <button type="button" className="fw-btn fw-btn-primary" onClick={dismiss}>
            {t("home.firstWin.actions.gotIt")}
          </button>
        </div>
      )}
    </section>
  );
}

export default FirstWin;
