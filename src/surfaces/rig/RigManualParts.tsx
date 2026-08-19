import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next singleton is initialized even when this component
// is the first (or only) thing a test/entry point loads — mirrors RigViewer's own `import "../../i18n"`.
import "../../i18n";
import { useManualParts, MANUAL_KINDS, manualKindLabel, type ManualKind } from "./manual-parts";
import { Picker } from "../../design/Picker";
import "./RigViewer.css";

// The "add a part" form + user-added list, extracted VERBATIM from RigViewer's !chromeless chrome
// (Train 1, 2026-08-12). Why: the PR #102 self-review found the manual-parts feature reachable in
// tests only — <RigViewer> renders live solely from LabConsole, always chromeless, and chromeless
// hides this form. Extraction lets the Lab mount the form in its OWN chrome (below the stage, clear
// of the corner gauges that forced chromeless in the first place) while RigViewer keeps rendering
// it unchanged in non-chromeless mode. State stays in useManualParts, whose instances sync within
// the document, so a part added here is drawn by the hologram immediately.
export function RigManualParts() {
  const { t } = useTranslation();
  const { parts: manualParts, add, remove } = useManualParts();
  const [kind, setKind] = useState<ManualKind>("psu");
  const [name, setName] = useState("");

  const onAdd = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    add({ kind, name: n });
    setName("");
  };

  return (
    <div className="rig-manual">
      <form className="rig-manual-form" onSubmit={onAdd}>
        <span className="rig-manual-label">{t("gaming.rigViewer.addPartLabel")}</span>
        {/* C-10: was a native <select> — its OS-drawn menu was the one light-grey Windows surface
            left in the Lab. Same options, same order, drawn from our own tokens. */}
        <Picker
          className="rig-manual-select"
          value={kind}
          onChange={(v) => setKind(v as ManualKind)}
          aria-label={t("gaming.rigViewer.componentTypeAriaLabel")}
          options={MANUAL_KINDS.map((k) => ({ value: k.value, label: manualKindLabel(k.value, t) }))}
        />
        <input
          className="rig-manual-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("gaming.rigViewer.addPartPlaceholder")}
          maxLength={48}
          aria-label={t("gaming.rigViewer.componentNameAriaLabel")}
        />
        <button type="submit" className="btn-small btn-small-on" disabled={!name.trim()}>
          {t("gaming.rigViewer.addButton")}
        </button>
      </form>
      {manualParts.length > 0 && (
        <ul className="rig-manual-list">
          {manualParts.map((p) => (
            <li key={p.id} className="rig-manual-item">
              <span className="rig-manual-item-name">{p.name}</span>
              <span className="rig-manual-item-tag">{t("gaming.rigViewer.userAddedTag")}</span>
              <button
                type="button"
                className="rig-manual-remove"
                onClick={() => remove(p.id)}
                aria-label={t("gaming.rigViewer.removePartAriaLabel", { name: p.name })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
