// The fixed, translated sentence a Black Box record is shown with where Rust sends a `statement` key
// (blackbox.rs `AssessmentStatement`). The Rust `consistent_with` text is English only and is never
// shown for these records; this is the one place the key becomes words, so the Problems room and the
// Care receipt say the same thing in the same language.
import type { TFunction } from "i18next";
import type { AssessmentStatement, CrashAssessment } from "../types";

const KEY: Record<AssessmentStatement, string> = {
  "app-crash": "appCrash",
  "app-hang": "appHang",
  "host-process": "hostProcess",
  "gpu-timeout-peak": "gpuTimeoutPeak",
  "shutdown-peak": "shutdownPeak",
  "hardware-error": "hardwareError",
  "hardware-error-peak": "hardwareErrorPeak",
};

/** The translated sentence for a record that carries a `statement`; null when it does not. */
export function assessStatementText(
  t: TFunction,
  a: Pick<CrashAssessment, "statement" | "subject" | "temp_c">,
): string | null {
  if (!a.statement) return null;
  return t(`gaming.blackBox.assessStatement.${KEY[a.statement]}`, {
    subject: a.subject ?? t("gaming.blackBox.assessStatement.unnamedApp"),
    temp: a.temp_c ?? "",
  });
}
