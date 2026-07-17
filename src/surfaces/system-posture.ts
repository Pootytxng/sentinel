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

  // Dismissed checks are informed user choices — they never drive the attention posture.
  const dismissed = new Set(readiness.dismissed_ids ?? []);
  const attentionChecks = readiness.checks.filter(
    (c) => c.status === "attention" && !dismissed.has(c.id),
  );
  const reasons = attentionChecks.map((c) => c.label);
  const n = reasons.length;

  if (n > 0) {
    // Name the specific thing — never a vague "N things need your attention" count. The
    // owner's name-it-and-fix-it-inline law: a flag names WHAT it found. One flagged check ⇒
    // the verdict IS that check, by name; several ⇒ lead with the first and honestly count the
    // rest, so the headline still names a real thing instead of a bare number. (Regression fix
    // 2026-07-17: the count phrasing had crept back onto Home's verdict strip — guard-pinned.)
    const top = attentionChecks[0];
    const headline = n === 1 ? top.label : `${top.label} · and ${n - 1} more`;
    return {
      state: "attention",
      headline,
      // The check's own detail carries the "why + what to do", so the fix travels WITH the
      // name rather than a generic "readiness is advisory" disclaimer.
      sub: top.detail || readiness.advisory,
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
