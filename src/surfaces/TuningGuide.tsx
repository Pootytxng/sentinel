import { useTranslation } from "react-i18next";
import type { TuningGuide } from "../data/tuning-guides";
import "../i18n";
import "./TuningGuide.css";

// The rendered tuning-guide body — ONE shared component fed by the single source (tuning-guides.ts),
// rendered identically in the Learn entry (via EntryBody) and the Lab Tuning instrument, so the copy
// can't drift. foam-pit law: the method, the typical range, and the discretion note are ALL in the
// visible body — nothing hidden behind hover. doorknob law: this is advisory prose with NO apply
// button — Compy never touches your voltage (locked rule #6), so there's nothing here to click. The
// "Show me the way" schematic is appended by each consumer (EntryCard in Learn; the Lab section).
export function TuningGuideBody({ guide }: { guide: TuningGuide }) {
  const { t } = useTranslation();
  return (
    <div className="tg-body">
      <p className="tg-goal">{guide.goal}</p>

      <p className="tg-tool">{guide.tool}</p>
      <ol className="tg-steps">
        {guide.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>

      <p className="tg-line tg-range">
        <b>{t("blackbook.tuningGuide.normalNumber")}</b> {guide.range}
      </p>
      <p className="tg-line tg-discretion">
        <b>{t("blackbook.tuningGuide.discretion")}</b> {guide.discretion}
      </p>
      <p className="tg-line tg-undo">
        <b>{t("blackbook.tuningGuide.undo")}</b> {guide.undo}
      </p>
    </div>
  );
}
