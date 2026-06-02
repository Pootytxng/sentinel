import type { GameReadiness } from "../types";

export type PostureState = "scanning" | "dialed-in" | "attention" | "unknown";

export type SystemPosture = {
  state: PostureState;
  headline: string;
  sub: string;
  attentionCount: number;
  reasons: string[]; // the exact checks driving "attention" — click-through to readiness rows
};

export function deriveSystemPosture(input: {
  readiness: GameReadiness | null;
  activeChanges: number;
  monitoringAvailable: boolean;
}): SystemPosture {
  const { readiness, activeChanges } = input;

  if (readiness == null) {
    return { state: "scanning", headline: "Scanning your system…", sub: "Reading hardware and running checks.", attentionCount: 0, reasons: [] };
  }

  if (readiness.checks.length === 0) {
    return { state: "unknown", headline: "Not enough to judge yet", sub: "Run a scan to see your readiness.", attentionCount: 0, reasons: [] };
  }

  const reasons = readiness.checks.filter((c) => c.status === "attention").map((c) => c.label);
  const n = reasons.length;

  if (n > 0) {
    return {
      state: "attention",
      headline: `${n} thing${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} your attention`,
      sub: readiness.advisory || reasons[0],
      attentionCount: n,
      reasons,
    };
  }

  const changeNote = activeChanges > 0
    ? `${activeChanges} safe change${activeChanges === 1 ? "" : "s"} active & reversible`
    : "nothing needs changing";
  return {
    state: "dialed-in",
    headline: "You're ready to play",
    sub: `All readiness checks pass · ${changeNote}.`,
    attentionCount: 0,
    reasons: [],
  };
}
