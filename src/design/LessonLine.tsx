import { useId } from "react";
import { useTranslation } from "react-i18next";
import { LESSON_LIBRARY_ID, type LessonRule } from "../surfaces/test-summary";
import { useLibrary } from "../surfaces/library-context";
import "./LessonLine.css";

// P7-teach (ROADMAP P7 bullet 5, Constitution §14): a lesson is taught only AFTER personal evidence,
// and at most one per result. The rule comes from the P5-learned table (test-summary.ts `lessonRuleFor`
// / `lessonRuleForVerdict`) over the stored verdict and deltas; the caller phrases it for its own
// context (`lab.experimentBench.summary.lesson.*` for a Trial of a change, `common.lesson.sessions.*`
// for two sessions of one game — that set carries every rule for exhaustiveness, though a surface
// that always compares the average never reaches its steadier / lessSteady / tooNoisy lines). The
// link opens the Library entry the rule reads from (`LESSON_LIBRARY_ID`), through the same
// `openLibrary` every inline glossary term uses; the lesson text describes it for assistive tech.
// No rule = the caller renders nothing; this component never invents a lesson.
export function LessonLine({ rule, sentence, testId }: { rule: LessonRule; sentence: string; testId: string }) {
  const { t } = useTranslation();
  const { openLibrary } = useLibrary();
  const textId = useId();
  return (
    <p className="lesson-line" data-testid={testId} data-rule={rule}>
      <span className="lesson-label">{t("common.lesson.label")}</span>{" "}
      <span className="lesson-text" id={textId}>
        {sentence}
      </span>{" "}
      <button
        type="button"
        className="lesson-more"
        aria-describedby={textId}
        onClick={() => openLibrary(LESSON_LIBRARY_ID[rule])}
      >
        {t("common.term.moreInBlackbook")}
      </button>
    </p>
  );
}
