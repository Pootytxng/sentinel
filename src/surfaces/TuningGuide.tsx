import type { TuningGuide } from "../data/tuning-guides";
import "./TuningGuide.css";

// The rendered tuning-guide body — ONE shared component fed by the single source (tuning-guides.ts),
// rendered identically in the Learn entry (via EntryBody) and the Lab Tuning instrument, so the copy
// can't drift. foam-pit law: the method, the typical range, and the discretion note are ALL in the
// visible body — nothing hidden behind hover. doorknob law: this is advisory prose with NO apply
// button — Compy never touches your voltage (locked rule #6), so there's nothing here to click. The
// "Show me the way" schematic is appended by each consumer (EntryCard in Learn; the Lab section).
export function TuningGuideBody({ guide }: { guide: TuningGuide }) {
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
        <b>A "normal" number?</b> {guide.range}
      </p>
      <p className="tg-line tg-discretion">
        <b>Discretion:</b> {guide.discretion}
      </p>
      <p className="tg-line tg-undo">
        <b>Undo:</b> {guide.undo}
      </p>
    </div>
  );
}
