import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import type { CrashIncident, SessionSummary } from "../types";
import { anchorFor, payoffFor, MIN_PAYOFF_SESSIONS, type CareStep, type Payoff } from "./care-next-step";
import { CareSupportExport } from "./CareHonestEnd";
import "./CareNextStep.css";

// P6-next: the ONE next step at the top of the Care view, and its measured payoff. BlackBox picks the
// step (pickCareStep, priority documented in care-next-step.ts) so the record or report it came from
// can point here instead of repeating it; this only renders. Read-only: no action. Its one button
// (beyond Compy only) opens the existing local support record panel; a STORED stutter step
// (P6-next-f2) instead has one "Stop tracking this step" button, which only retires the local anchor.
export function CareNextStep({
  step,
  incidents,
  sessions,
  skipped,
  skippedNeedsAdmin = true,
  onDismiss,
}: {
  step: CareStep | null;
  incidents: CrashIncident[];
  sessions: SessionSummary[];
  /** The scan skipped a source: an absence is never claimed in full. */
  skipped: boolean;
  /** P6-unknown: at least one skip needs admin. False → the skips were reader failures, and the
   *  partial line says some sources couldn't be read this time, not "need administrator". */
  skippedNeedsAdmin?: boolean;
  /** P6-next-f2: the user stopped tracking a stored stutter step (BlackBox retires it). */
  onDismiss?: (key: string) => void;
}) {
  const { t, i18n } = useTranslation();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the anchor belongs to the step's identity
  const anchor = useMemo(() => (step ? anchorFor(step, incidents) : null), [step?.key]);
  if (!step || !anchor) return null;

  const day = (n: number) =>
    new Date(n).toLocaleDateString(i18n.language, { month: "short", day: "numeric" });
  const basis =
    anchor.basis === "taken"
      ? t("gaming.blackBox.nextStep.basisTaken", { date: day(anchor.at) })
      : t("gaming.blackBox.nextStep.basisShown", { date: day(anchor.at) });
  const payoff: Payoff = payoffFor(step, anchor, incidents, sessions, new Date(), skipped);
  const kind = step.source === "incident" ? step.kind : "";
  const game = step.source === "stutter" ? step.game : "";
  const pct = step.source === "stutter" ? (anchor.baseline ?? step.baseline).noiseFloorPct.toFixed(0) : "";

  // App crash / App hang name the faulting app ("No Valorant.exe crash recorded…"); other kinds,
  // or an app Windows didn't name, keep the kind-only line. Static keys, so the guards can see them.
  const app = step.source === "incident" ? step.appLabel : null;
  const crash = !!app && kind === "App crash";
  const hang = !!app && kind === "App hang";
  let line: string;
  switch (payoff.kind) {
    case "came-back": {
      line = crash
        ? t("gaming.blackBox.nextStep.payoff.crashCameBack", { count: payoff.count, kind, app, first: day(payoff.firstAt) })
        : hang
          ? t("gaming.blackBox.nextStep.payoff.hangCameBack", { count: payoff.count, kind, app, first: day(payoff.firstAt) })
          : t("gaming.blackBox.nextStep.payoff.cameBack", { count: payoff.count, kind, app, first: day(payoff.firstAt) });
      break;
    }
    case "none-since": {
      line = crash
        ? t("gaming.blackBox.nextStep.payoff.crashNoneSince", { count: payoff.days, days: payoff.days, kind, app })
        : hang
          ? t("gaming.blackBox.nextStep.payoff.hangNoneSince", { count: payoff.days, days: payoff.days, kind, app })
          : t("gaming.blackBox.nextStep.payoff.noneSince", { count: payoff.days, days: payoff.days, kind, app });
      break;
    }
    case "none-since-partial": {
      line = skippedNeedsAdmin
        ? crash
          ? t("gaming.blackBox.nextStep.payoff.crashNoneSincePartial", { count: payoff.days, days: payoff.days, kind, app })
          : hang
            ? t("gaming.blackBox.nextStep.payoff.hangNoneSincePartial", { count: payoff.days, days: payoff.days, kind, app })
            : t("gaming.blackBox.nextStep.payoff.noneSincePartial", { count: payoff.days, days: payoff.days, kind, app })
        : crash
          ? t("gaming.blackBox.nextStep.payoff.crashNoneSincePartialRetry", { count: payoff.days, days: payoff.days, kind, app })
          : hang
            ? t("gaming.blackBox.nextStep.payoff.hangNoneSincePartialRetry", { count: payoff.days, days: payoff.days, kind, app })
            : t("gaming.blackBox.nextStep.payoff.noneSincePartialRetry", { count: payoff.days, days: payoff.days, kind, app });
      break;
    }
    case "too-soon": {
      line = crash
        ? t("gaming.blackBox.nextStep.payoff.crashTooSoon", { kind, app })
        : hang
          ? t("gaming.blackBox.nextStep.payoff.hangTooSoon", { kind, app })
          : t("gaming.blackBox.nextStep.payoff.tooSoon", { kind, app });
      break;
    }
    case "sessions-back":
      line = t("gaming.blackBox.nextStep.payoff.sessionsBack", { bad: payoff.bad, total: payoff.total, game, pct });
      break;
    case "sessions-steady":
      line = t("gaming.blackBox.nextStep.payoff.sessionsSteady", { total: payoff.total, game, pct });
      break;
    case "not-enough-sessions":
      line = t("gaming.blackBox.nextStep.payoff.notEnoughSessions", {
        total: payoff.total, game, min: MIN_PAYOFF_SESSIONS,
      });
      break;
  }

  const research = step.source === "incident" && step.research;
  // P6-unknown: a record beyond Compy says so plainly, and puts the local support record one tap away.
  const beyond = step.source === "incident" && step.beyond;
  return (
    <section className="bb-next" aria-label={t("gaming.blackBox.nextStep.title")} data-source={step.source}>
      <div className="bb-next-head">
        <span className="bb-next-title">{t("gaming.blackBox.nextStep.title")}</span>
        <span className="bb-next-tag">
          {beyond
            ? t("gaming.blackBox.honestEnd.beyondTag")
            : research
              ? t("gaming.blackBox.worthResearching")
              : t("gaming.blackBox.safeNextStep")}
        </span>
      </div>
      {beyond && <p className="bb-next-detail bb-next-beyond">{t("gaming.blackBox.honestEnd.beyondLine")}</p>}
      <p className="bb-next-headline">{step.headline}</p>
      {step.source === "incident" && <p className="bb-next-detail">{step.detail}</p>}
      <p className="bb-next-from">
        {step.source === "incident"
          ? t("gaming.blackBox.nextStep.fromIncident", { kind: step.kind, date: day(Date.parse(step.incidentWhen)) })
          : step.stored
            ? t("gaming.blackBox.nextStep.fromStutterStored", { game: step.game })
            : t("gaming.blackBox.nextStep.fromStutter", { game: step.game })}
      </p>
      <p className={`bb-next-payoff bb-next-payoff-${payoff.kind}`}>
        <span className="bb-next-payoff-label">{t("gaming.blackBox.nextStep.payoffLabel")}</span>{" "}
        {basis} {line}
      </p>
      {beyond && <CareSupportExport />}
      {step.source === "stutter" && step.stored && onDismiss && (
        <button type="button" className="set-action bb-next-dismiss" onClick={() => onDismiss(step.key)}>
          {t("gaming.blackBox.nextStep.stopTracking")}
        </button>
      )}
    </section>
  );
}
