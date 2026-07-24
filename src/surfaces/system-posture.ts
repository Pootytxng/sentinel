import type { TFunction } from "i18next";
import type { GameReadiness } from "../types";

export type PostureState = "scanning" | "dialed-in" | "attention" | "unknown";

export type SystemPosture = {
  state: PostureState;
  headline: string;
  sub: string;
  attentionCount: number;
  reasons: string[]; // the exact checks driving "attention" — click-through to readiness rows
};

// i18n note: `t` is threaded through as the LAST param (this is a plain data module, not a
// component — it can't call useTranslation() itself) — every call site passes its own `t` from
// useTranslation(). Mirrors ago()/smoothness() elsewhere in this codebase.
export function deriveSystemPosture(
  input: {
    readiness: GameReadiness | null;
    activeChanges: number;
    monitoringAvailable: boolean;
  },
  t: TFunction,
): SystemPosture {
  const { readiness, activeChanges } = input;

  if (readiness == null) {
    return {
      state: "scanning",
      headline: t("home.posture.scanning.headline"),
      sub: t("home.posture.scanning.sub"),
      attentionCount: 0,
      reasons: [],
    };
  }

  if (readiness.checks.length === 0) {
    return {
      state: "unknown",
      headline: t("home.posture.unknown.headline"),
      sub: t("home.posture.unknown.sub"),
      attentionCount: 0,
      reasons: [],
    };
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
    const headline =
      n === 1 ? top.label : t("home.posture.attentionMore", { label: top.label, count: n - 1 });
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

  const changeNote =
    activeChanges > 0
      ? t("home.posture.changeNote", { count: activeChanges })
      : t("home.posture.noChangeNote");
  return {
    state: "dialed-in",
    headline: t("home.posture.dialedInHeadline"),
    sub: t("home.posture.dialedInSub", { changeNote }),
    attentionCount: 0,
    reasons: [],
  };
}
