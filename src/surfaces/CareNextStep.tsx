import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import type { CrashIncident, SessionSummary } from "../types";
import { anchorFor, payoffFor, MIN_PAYOFF_SESSIONS, type CareStep, type Payoff } from "./care-next-step";
import { fallPct } from "./test-summary";
import { CareSupportExport } from "./CareHonestEnd";
import { Depth, ReceiptRow } from "../design/Depth";
import { displayModeLabel } from "../data/display-mode";
import { prettyGameName } from "./game-name";
import "./CareNextStep.css";

// P6-next: the ONE next step at the top of the Care view, and its measured payoff. BlackBox picks the
// step (pickCareStep, priority documented in care-next-step.ts) so the record or report it came from
// can point here instead of repeating it; this only renders. Read-only: no action. Its one button
// (beyond Compy only) opens the existing local support record panel; a STORED stutter step
// (P6-next-f2) instead has one "Stop tracking this step" button, which only retires the local anchor.
// P7-depth (Constitution §13): the first adopter of the shared Depth block. ANSWER = the step, its
// own instruction (the incident detail carries the stop code the user may be told to share, so it is
// never behind a tap) and its measured payoff; EXPLANATION = why Compy named it, the record or
// comparison it came from, and a final-read notice; RECEIPT = the exact fields the step and payoff
// were computed from, verbatim. No new data: every value was already in `step`, `anchor` or `payoff`.
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
  // The anchor belongs to the step's identity: its key, and for a stutter step the baseline it was
  // judged on (follow-up review 2026-10-26 §4: the same advice judged on another rig re-anchors).
  const baselineId = step?.source === "stutter" ? `${step.baseline.startedAt}|${step.baseline.rig?.gpu ?? ""}|${step.baseline.rig?.ram_gb ?? ""}|${step.baseline.rig?.display ?? ""}` : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the anchor belongs to the step identity above
  const anchor = useMemo(() => (step ? anchorFor(step, incidents) : null), [step?.key, baselineId]);
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
  // The line `payoffFor` judges a session back at: the band's matching fall (CR-what-changed-fall).
  const pct = step.source === "stutter" ? fallPct((anchor.baseline ?? step.baseline).noiseFloorPct).toFixed(0) : "";

  // App crash / App hang name the faulting app ("No Valorant crash recorded…"); other kinds,
  // or an app Windows didn't name, keep the kind-only line. Static keys, so the guards can see them.
  // CR-noise-footnote-pair: the app as the other rooms name it ("ROB RUN", not "ROB RUN.exe"); the
  // receipt below keeps Windows' own name verbatim.
  const app = step.source === "incident" && step.appLabel ? prettyGameName(step.appLabel) || step.appLabel : null;
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
  const iso = (n: number) => new Date(n).toISOString();
  // The why never says more than the tag does: a safe step is "the safe first thing to check", a
  // research step is a lead, a beyond step is beyond Compy; a stored stutter step came from an
  // EARLIER comparison, never "the latest".
  const why =
    step.source === "incident"
      ? t(`gaming.blackBox.nextStep.${beyond ? "whyIncidentBeyond" : research ? "whyIncidentResearch" : "whyIncident"}`, { kind: step.kind })
      : t(step.stored ? "gaming.blackBox.nextStep.whyStutterStored" : "gaming.blackBox.nextStep.whyStutter", { game: step.game, pct });
  const rk = (k: string) => t(`gaming.blackBox.nextStep.receipt.${k}`);
  const counted = payoff.kind === "sessions-back" || payoff.kind === "sessions-steady" || payoff.kind === "not-enough-sessions" ? String(payoff.total) : null;
  const slow = payoff.kind === "sessions-back" ? String(payoff.bad) : null;
  const base = step.source === "stutter" ? (anchor.baseline ?? step.baseline) : null;
  const rigParts = base?.rig ? [base.rig.gpu, Number.isFinite(base.rig.ram_gb) ? `${base.rig.ram_gb} GB` : null, displayModeLabel(base.rig.display, t)].filter((p): p is string => !!p) : [];
  const rig = rigParts.length > 0 ? rigParts.join(" · ") : null;
  return (
    <section className="bb-next" aria-label={t("gaming.blackBox.nextStep.title")} data-source={step.source}>
      <Depth
        testId="bb-next-depth"
        answer={
          <>
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
            <p className={`bb-next-payoff bb-next-payoff-${payoff.kind}`}>
              <span className="bb-next-payoff-label">{t("gaming.blackBox.nextStep.payoffLabel")}</span>{" "}
              {basis} {line}
            </p>
          </>
        }
        explanation={
          <>
            <p className="bb-next-why">{why}</p>
            <p className="bb-next-from">
              {step.source === "incident"
                ? t("gaming.blackBox.nextStep.fromIncident", { kind: step.kind, date: day(Date.parse(step.incidentWhen)) })
                : step.stored
                  ? t("gaming.blackBox.nextStep.fromStutterStored", { game: step.game })
                  : t("gaming.blackBox.nextStep.fromStutter", { game: step.game })}
            </p>
            {step.source === "stutter" && step.final && (
              <p className="bb-next-detail bb-next-final">{t("gaming.blackBox.nextStep.finalRead")}</p>
            )}
          </>
        }
        receipt={
          <dl className="bb-next-receipt">
            <ReceiptRow label={rk("source")} value={step.source === "incident" ? rk("sourceIncident") : rk("sourceStutter")} />
            {step.source === "incident" ? (
              <>
                <ReceiptRow label={rk("kind")} value={step.kind} />
                <ReceiptRow label={rk("app")} value={step.appLabel} />
                <ReceiptRow label={rk("record")} value={step.incidentId} />
                <ReceiptRow label={rk("recordedAt")} value={step.incidentWhen} />
                <ReceiptRow label={rk("consistentWith")} value={step.consistentWith} />
                <ReceiptRow label={rk("research")} value={step.research ? rk("researchYes") : rk("researchNo")} />
              </>
            ) : (
              <>
                <ReceiptRow label={rk("game")} value={step.game} />
                <ReceiptRow label={rk("process")} value={step.processName} />
                <ReceiptRow label={rk("baseline")} value={base?.startedAt} />
                <ReceiptRow label={rk("baselineLow1")} value={base ? `${base.low1.toFixed(1)} fps` : null} />
                <ReceiptRow label={rk("noiseFloor")} value={base ? `${base.noiseFloorPct}%` : null} />
                <ReceiptRow label={rk("rig")} value={rig} />
              </>
            )}
            <ReceiptRow label={rk("anchor")} value={`${iso(anchor.at)} (${anchor.basis === "taken" ? rk("anchorTaken") : rk("anchorShown")})`} />
            <ReceiptRow label={rk("sessionsSlow")} value={slow} />
            <ReceiptRow label={rk("sessionsCounted")} value={counted} />
          </dl>
        }
      />
      {beyond && <CareSupportExport />}
      {step.source === "stutter" && step.stored && onDismiss && (
        <button type="button" className="set-action bb-next-dismiss" onClick={() => onDismiss(step.key)}>
          {t("gaming.blackBox.nextStep.stopTracking")}
        </button>
      )}
    </section>
  );
}
