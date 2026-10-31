// P8-posture-b: the user's answer to "How far may Compy go on this PC?" — serde names of Rust's
// `RiskChoice` (trial_candidates.rs). Saved per viewer (localStorage); unknown/unreadable falls back to
// the Rust default. Its own module so the bench and the guided journey share it without a cycle.
export type RiskChoice = "low-only" | "low-and-moderate";
export const RISK_CHOICE_STORAGE_KEY = "compy.trial.riskChoice";
export const DEFAULT_RISK_CHOICE: RiskChoice = "low-and-moderate";

export function loadRiskChoice(): RiskChoice {
  try {
    const v = localStorage.getItem(RISK_CHOICE_STORAGE_KEY);
    return v === "low-only" || v === "low-and-moderate" ? v : DEFAULT_RISK_CHOICE;
  } catch {
    return DEFAULT_RISK_CHOICE;
  }
}

export function saveRiskChoice(v: RiskChoice): void {
  try {
    localStorage.setItem(RISK_CHOICE_STORAGE_KEY, v);
  } catch {
    /* private window / blocked storage: the choice still applies for this session */
  }
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

// P8-posture-show: the risk choice a Trial started under, in the reader's language. A record that
// carries none (older, or a start that sent none) says "not recorded"; it is never filled in with the
// default, because the default is not what the user was shown at the time.
export function riskChoiceText(c: RiskChoice | null | undefined, t: Translate): string {
  if (c === "low-only") return t("lab.experimentBench.riskChoice.lowOnly");
  if (c === "low-and-moderate") return t("lab.experimentBench.riskChoice.lowAndModerate");
  return t("lab.experimentBench.riskChoice.notRecorded");
}
