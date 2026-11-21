import { useTranslation } from "react-i18next";
import { Term } from "./Term";
import { confidenceHintKey, confidenceWordKey, isMeasuredRow, wordFromBand, wordFromRow } from "../data/confidence-word";
import type { ConfidenceBand, PriorityBasis } from "../types";

/** P7-confidence, review 2026-10-28: a band's word ("Likely", "Unknown") with its one-line hint in the
 *  in-app tooltip (`Term tip`), never a native `title` on text that already shows its label (#677,
 *  self-review rubric 12). The raw band stays on `data-confidence` for the technical layer. */
export function ConfidenceWord({ band }: { band: ConfidenceBand | "high" | "medium" | "low" | null | undefined }) {
  const { t } = useTranslation();
  const word = wordFromBand(band);
  return (
    <span data-confidence={band ?? undefined}>
      <Term tip={t(confidenceHintKey(word))}>{t(confidenceWordKey(word))}</Term>
    </span>
  );
}

/** A priority row's word. A fact Compy read from Windows or the hardware (a plan, a setting, a driver
 *  age) is "Known" with the note "Effect on FPS not measured", never "Likely": nothing measured what
 *  it does to this PC's frame rate. Only a row whose basis is "measured" takes the band's word. */
export function RowConfidence({ basis, band }: { basis: PriorityBasis | undefined; band: ConfidenceBand | "high" | "medium" | "low" | null | undefined }) {
  const { t } = useTranslation();
  const word = wordFromRow(basis, band);
  const measured = isMeasuredRow(basis);
  return (
    <span data-confidence={band ?? undefined} data-basis={measured ? "measured" : "fact"}>
      <Term tip={t(confidenceHintKey(word))}>{t(confidenceWordKey(word))}</Term>
      {measured ? null : (
        <>
          {" "}
          <span className="confidence-note">{t("common.confidenceNote.effectNotMeasured")}</span>
        </>
      )}
    </span>
  );
}
