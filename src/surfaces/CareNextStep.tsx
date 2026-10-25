import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import type { CrashIncident, SessionSummary } from "../types";
import { anchorFor, payoffFor, MIN_PAYOFF_SESSIONS, type CareStep, type Payoff } from "./care-next-step";
import "./CareNextStep.css";

// P6-next: the ONE next step at the top of the Care view, and its measured payoff. BlackBox picks the
// step (pickCareStep, priority documented in care-next-step.ts) so the record or report it came from
// can point here instead of repeating it; this only renders. Read-only: no button, no action.
export function CareNextStep({
  step,
  incidents,
  sessions,
  skipped,
}: {
  step: CareStep | null;
  incidents: CrashIncident[];
  sessions: SessionSummary[];
  /** The scan skipped a source (needs admin): an absence is never claimed in full. */
  skipped: boolean;
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

  let line: string;
  switch (payoff.kind) {
    case "came-back":
      line = t("gaming.blackBox.nextStep.payoff.cameBack", { count: payoff.count, kind, first: day(payoff.firstAt) });
      break;
    case "none-since":
      line = t("gaming.blackBox.nextStep.payoff.noneSince", { count: payoff.days, days: payoff.days, kind });
      break;
    case "none-since-partial":
      line = t("gaming.blackBox.nextStep.payoff.noneSincePartial", { count: payoff.days, days: payoff.days, kind });
      break;
    case "too-soon":
      line = t("gaming.blackBox.nextStep.payoff.tooSoon", { kind });
      break;
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
  return (
    <section className="bb-next" aria-label={t("gaming.blackBox.nextStep.title")} data-source={step.source}>
      <div className="bb-next-head">
        <span className="bb-next-title">{t("gaming.blackBox.nextStep.title")}</span>
        <span className="bb-next-tag">
          {research ? t("gaming.blackBox.worthResearching") : t("gaming.blackBox.safeNextStep")}
        </span>
      </div>
      <p className="bb-next-headline">{step.headline}</p>
      {step.source === "incident" && <p className="bb-next-detail">{step.detail}</p>}
      <p className="bb-next-from">
        {step.source === "incident"
          ? t("gaming.blackBox.nextStep.fromIncident", { kind: step.kind, date: day(Date.parse(step.incidentWhen)) })
          : t("gaming.blackBox.nextStep.fromStutter", { game: step.game })}
      </p>
      <p className={`bb-next-payoff bb-next-payoff-${payoff.kind}`}>
        <span className="bb-next-payoff-label">{t("gaming.blackBox.nextStep.payoffLabel")}</span>{" "}
        {basis} {line}
      </p>
    </section>
  );
}
