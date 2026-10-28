import { useTranslation } from "react-i18next";
import { Term } from "./Term";
import { confidenceHintKey, confidenceWordKey, wordFromBand } from "../data/confidence-word";
import type { ConfidenceBand } from "../types";

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
