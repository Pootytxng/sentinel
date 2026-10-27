import { useTranslation } from "react-i18next";
import { LESSON_LIBRARY_ID, type LessonRule } from "../surfaces/test-summary";
import { useLibrary } from "../surfaces/library-context";
import "./LessonLine.css";

// P7-teach (ROADMAP P7 bullet 5, Constitution §14): a lesson is taught only AFTER personal evidence,
// and at most one per result. The rule comes from the P5-learned table (test-summary.ts `lessonRuleFor`)
// over the stored verdict and deltas; the caller phrases it for its own context (a Trial of a change,
// or two sessions of one game). The link opens the Library entry the rule reads from
// (`LESSON_LIBRARY_ID`), through the same `openLibrary` every inline glossary term uses. No rule = the
// caller renders nothing; this component never invents a lesson.
export function LessonLine({ rule, sentence, testId }: { rule: LessonRule; sentence: string; testId: string }) {
  const { t } = useTranslation();
  const { openLibrary } = useLibrary();
  return (
    <p className="lesson-line" data-testid={testId} data-rule={rule}>
      <span className="lesson-label">{t("common.lesson.label")}</span> <span className="lesson-text">{sentence}</span>{" "}
      <button type="button" className="lesson-more" onClick={() => openLibrary(LESSON_LIBRARY_ID[rule])}>
        {t("common.term.moreInBlackbook")}
      </button>
    </p>
  );
}
