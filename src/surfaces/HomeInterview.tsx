import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Sheet } from "../design/bento";
import type { LabStationKey } from "./lab-guided-data";
import { fastPathAppliedNote, type HomeIntakeRoom } from "./home-intake-data";
import {
  INTERVIEW_ROOT,
  groupChoices,
  interviewFinding,
  interviewQuestions,
  type InterviewFacts,
  type InterviewStep,
} from "./home-interview-data";
import { markStutterArrival } from "./care-arrival";
import { markBenchArrival, markSinceArrival } from "./lab-arrival";
import "./home-interview.css";

// THE INTERVIEW, rendered (design foundation step ③, decision 2; issue #177). The taxonomy, the
// evidence rules and the honesty laws all live in home-interview-data.ts — this file is the shape
// they wear on screen and nothing else. It computes no verdict and quotes no reading of its own.
//
// WHY A SHEET AND NOT A ROOM. The bento Sheet grows out of the control that opened it and dims the
// room behind it, which is the one popout contract in the app (popout-convergence, 2026-08-13).
// That matters more here than anywhere: the standing complaint is that Compy is a place people get
// lost in, so the answer to "help me" must visibly stay ON Home rather than teleport somewhere new.
// The user can see the room they came from the whole time, and closing puts them back on it.
//
// ONE QUESTION PER SCREEN, and the screen is genuinely one question — no accordion, no second
// column, no "advanced" strip. The whole point of the shape is that there is nothing to scan.
//
// BACK IS ALWAYS THERE (except on the first screen, where there is nowhere to go back to). A wizard
// without a back button punishes the exact user this is built for: the one who is not sure, guesses,
// and needs to be able to guess again without starting over.

type Props = {
  /** Live readings, gathered by the room. This component never measures anything itself. */
  facts: InterviewFacts;
  /** The rect of the door that opened us, so the panel grows out of it. */
  /** Which step to OPEN on (issue #49) — a full path, so the breadcrumb and Back read as usual.
      Defaults to the root question, which is what every caller before this one wanted. The sheet is
      conditionally mounted, so a new value applies on the next open, exactly like `origin`. */
  initialPath?: InterviewStep[];
  origin: DOMRect | null;
  onClose: () => void;
  /** Re-run the readiness check — the one action that needs no room and no wiring. */
  onRunCheck: () => void;
  /** Land ON an instrument (App's single station-intent writer). */
  onOpenStation: (station: LabStationKey, room: HomeIntakeRoom) => void;
  /** Plain room navigation, for the findings whose answer IS the room. */
  onOpenRoom: (room: HomeIntakeRoom) => void;
  /** The audited one-UAC batch apply. Resolves when the apply has finished, either way. */
  onFastPath: () => Promise<void>;
  /** True while that apply is in flight — the sheet must not be dismissible mid-mutation. */
  fastPathBusy: boolean;
  /**
   * The real result of an apply in this session, or null if none has landed. J (2026-07-22): a
   * count alone is a dead end — "1 safe tweak not applied" cannot be acted on — so the batch's
   * per-skip title + reason travel with it and are rendered, never summarised away.
   */
  fastPathReceipt: {
    applied: number;
    skipped: number;
    skippedItems: { title: string; reason: string }[];
  } | null;
};

export function HomeInterview({
  facts,
  initialPath,
  origin,
  onClose,
  onRunCheck,
  onOpenStation,
  onOpenRoom,
  onFastPath,
  fastPathBusy,
  fastPathReceipt,
}: Props) {
  const { t } = useTranslation();
  const questions = useMemo(() => interviewQuestions(t), [t]);

  // The stack, not a cursor: back pops, and the trail is what draws the progress dots. Starting
  // value is the root question, so `path` is never empty and `current` is never undefined.
  const [path, setPath] = useState<InterviewStep[]>(
    initialPath && initialPath.length > 0 ? initialPath : [{ kind: "question", id: INTERVIEW_ROOT }],
  );
  const current = path[path.length - 1];

  const answer = useCallback((next: InterviewStep) => setPath((p) => [...p, next]), []);
  const back = useCallback(() => setPath((p) => (p.length > 1 ? p.slice(0, -1) : p)), []);
  const restart = useCallback(
    () => setPath([{ kind: "question", id: INTERVIEW_ROOT }]),
    [],
  );

  const finding =
    current.kind === "finding" ? interviewFinding(current.id, facts, t) : null;

  // The one action on the finding card. Every branch here is a call the ROOM already owns — this
  // component opens no mutation path of its own, so the mutation boundary is untouched by ③.
  const runAction = useCallback(() => {
    if (!finding) return;
    const a = finding.action;
    if (a.kind === "fastpath") {
      void onFastPath();
      return;
    }
    if (a.kind === "check") {
      onRunCheck();
      onClose();
      return;
    }
    if (a.kind === "station") {
      // Written before the station opens, and read once by the view it names (P6-stutter).
      if (a.arrival === "stutter") markStutterArrival();
      if (a.arrival === "since") markSinceArrival();
      onOpenStation(a.station, a.room);
      onClose();
      return;
    }
    // P7-route: the Test room reads this once and lands on the journey or the tested list.
    if (a.arrival) markBenchArrival(a.arrival);
    onOpenRoom(a.room);
    onClose();
  }, [finding, onFastPath, onRunCheck, onOpenStation, onOpenRoom, onClose]);

  const mutating = finding?.action.kind === "fastpath";
  const actionDone = mutating && !!fastPathReceipt;

  const footer =
    finding && !actionDone ? (
      <button
        type="button"
        className="hi-action"
        onClick={runAction}
        disabled={fastPathBusy}
        data-mutating={mutating ? "yes" : undefined}
      >
        {fastPathBusy ? t("home.interview.ui.applying") : finding.action.label}
      </button>
    ) : undefined;

  return (
    <Sheet
      title={t("home.interview.ui.title")}
      sub={t("home.interview.ui.sub")}
      origin={origin}
      onClose={onClose}
      dismissible={!fastPathBusy}
      footer={footer}
    >
      <div className="hi">
        {/* Progress. Deliberately dots and not "step 3 of 7": the branch length is not known at the
            first screen, so a denominator would either be a lie or a number that changes under the
            user. Dots say "you are moving" without claiming how far there is to go. */}
        <ol className="hi-dots" aria-label={t("home.interview.ui.stepAria")}>
          {path.map((step, i) => (
            <li
              key={`${step.kind}:${step.id}:${i}`}
              className="hi-dot"
              data-state={i === path.length - 1 ? "current" : "done"}
              data-kind={step.kind}
            />
          ))}
        </ol>

        {current.kind === "question" ? (
          <div className="hi-screen">
            <h3 className="hi-question">{questions[current.id].question}</h3>
            {/* GROUPED, not flat (owner direction 2026-08-26). The start screen now carries both
                halves of why someone opens Compy — something is wrong, and nothing is wrong — and
                nine answers in one column is the wall the interview exists to avoid. The grouping
                is read from the taxonomy (`groupChoices`), never hand-listed here, so an answer
                that changes halves moves on screen without this file being touched. Screens whose
                answers carry no group render exactly as before: one unheaded list. */}
            {groupChoices(questions[current.id].choices, t).map((g) => (
              <div className="hi-answer-group" key={g.id}>
                {g.heading && <h4 className="hi-answer-group-head">{g.heading}</h4>}
                <ul className="hi-answers">
                  {g.choices.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        className="hi-answer"
                        data-unsure={c.unsure ? "yes" : undefined}
                        onClick={() => answer(c.next)}
                      >
                        {c.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          finding && (
            <div className="hi-screen hi-finding">
              {/* LEVEL + WORD, never level alone. COLOR-1's rule is that a status carries shape,
                  word and hue together — the chip prints its word, so a reader who cannot separate
                  the hues still gets the whole message. */}
              <span className="hi-level" data-level={finding.level}>
                {finding.levelLabel}
              </span>
              <p className="hi-sentence">{finding.sentence}</p>

              {finding.evidence.length > 0 ? (
                <section className="hi-evidence" aria-label={t("home.interview.ui.evidenceTitle")}>
                  <h4 className="hi-evidence-title">{t("home.interview.ui.evidenceTitle")}</h4>
                  <ul className="hi-evidence-list">
                    {finding.evidence.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </section>
              ) : (
                // The honest empty state. It is not an apology and it is not a dead end: the action
                // in the footer is the way to go and get the reading this card could not quote.
                <p className="hi-noevidence">{t("home.interview.ui.noEvidence")}</p>
              )}

              {/* THE RECEIPT (J, 2026-07-22). It names how many landed, how many did not, and — in
                  the disclosure — exactly which ones and why. Every word of the reason comes from
                  the batch primitive; this component invents none of it, so a skip can only say
                  what actually happened on the machine. */}
              {actionDone && fastPathReceipt && (
                <div className="hi-receipt">
                  <p className="hi-applied">
                    {fastPathAppliedNote(fastPathReceipt.applied, fastPathReceipt.skipped, t)}
                  </p>
                  {fastPathReceipt.skippedItems.length > 0 && (
                    <details className="hi-skipped">
                      <summary className="hi-skipped-summary">
                        {t("home.homeConsole.intake.fastpath.skippedDisclosure", {
                          count: fastPathReceipt.skippedItems.length,
                        })}
                      </summary>
                      <ul className="hi-skipped-list">
                        {fastPathReceipt.skippedItems.map((item) => (
                          <li key={item.title}>
                            {t("home.homeConsole.intake.fastpath.skippedItemReason", {
                              title: item.title,
                              reason: item.reason,
                            })}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}

              {/* LAW 4 — the undo promise stands under the button that would change Windows, in
                  front of the user, not inside the confirm dialog they have not opened yet. */}
              {finding.undo && !actionDone && <p className="hi-undo">{finding.undo}</p>}
            </div>
          )
        )}

        <div className="hi-nav">
          {path.length > 1 && (
            <button type="button" className="hi-back" onClick={back} disabled={fastPathBusy}>
              {t("home.interview.ui.back")}
            </button>
          )}
          {current.kind === "finding" && (
            <button
              type="button"
              className="hi-restart"
              onClick={restart}
              disabled={fastPathBusy}
            >
              {t("home.interview.ui.startOver")}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
