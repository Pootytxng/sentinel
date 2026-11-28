// The fixed, translated sentence a Black Box record is shown with where Rust sends a `statement` key
// (blackbox.rs `AssessmentStatement`). The Rust `consistent_with` text is English only and is never
// shown for these records; this is the one place the key becomes words, so the Problems room and the
// Care receipt say the same thing in the same language.
import type { TFunction } from "i18next";
import type { AssessmentStatement, CrashAssessment, PeakVsUsual } from "../types";

const KEY: Record<AssessmentStatement, string> = {
  "app-crash": "appCrash",
  "app-hang": "appHang",
  "host-process": "hostProcess",
  "gpu-timeout-peak": "gpuTimeoutPeak",
  "shutdown-peak": "shutdownPeak",
  "hardware-error": "hardwareError",
  "hardware-error-peak": "hardwareErrorPeak",
};

// e10: the sentence a peak statement ends with ({{compare}}), by how the crash session's peak sits
// against this card's usual one. Spelled in full so every key has a literal consumer.
const PEAK_KEY: Record<PeakVsUsual["outcome"] | "not-compared", string> = {
  hotter: "gaming.blackBox.assessStatement.peakVsUsual.hotter",
  higher: "gaming.blackBox.assessStatement.peakVsUsual.higher",
  same: "gaming.blackBox.assessStatement.peakVsUsual.same",
  lower: "gaming.blackBox.assessStatement.peakVsUsual.lower",
  "too-few": "gaming.blackBox.assessStatement.peakVsUsual.tooFew",
  unreadable: "gaming.blackBox.assessStatement.peakVsUsual.unreadable",
  "not-compared": "gaming.blackBox.assessStatement.peakVsUsual.notCompared",
};

/** e10: how the peak sits against this card's usual one. Every variant ends by saying Compy can't tell
 *  whether heat played a part; a record from a build before the comparison says it wasn't compared. */
export function peakVsUsualText(t: TFunction, temp: number | undefined, cmp: PeakVsUsual | undefined): string {
  if (!cmp) return t(PEAK_KEY["not-compared"]);
  if (cmp.outcome === "unreadable") return t(PEAK_KEY.unreadable);
  if (cmp.outcome === "too-few") return t(PEAK_KEY["too-few"], { have: cmp.sessions });
  return t(PEAK_KEY[cmp.outcome], {
    usual: cmp.usual_c,
    sessions: cmp.sessions,
    over: temp != null ? temp - cmp.usual_c : "",
  });
}

/** The translated sentence for a record that carries a `statement`; null when it does not. */
export function assessStatementText(
  t: TFunction,
  a: Pick<CrashAssessment, "statement" | "subject" | "temp_c" | "temp_vs_usual">,
): string | null {
  if (!a.statement) return null;
  return t(`gaming.blackBox.assessStatement.${KEY[a.statement]}`, {
    subject: a.subject ?? t("gaming.blackBox.assessStatement.unnamedApp"),
    temp: a.temp_c ?? "",
    // Only the peak statements hold {{compare}}; the others ignore it.
    compare: peakVsUsualText(t, a.temp_c, a.temp_vs_usual),
  });
}
