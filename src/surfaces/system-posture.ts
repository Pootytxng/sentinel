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
    // owner's name-it-and-fix-it-inline law: a flag names WHAT it found, so the verdict IS the
    // flagged check, by name. (Regression fix 2026-07-17: the count phrasing had crept back onto
    // Home's verdict strip — guard-pinned.)
    //
    // The headline carries NO "· and N more" tail (owner ruling 2026-08-26, issue #219). That
    // tail was measured as the thing pushing the 40px verdict past two lines, and it was the only
    // part of the headline that named nothing — a bare number appended to a real finding. Nothing
    // is hidden by dropping it: the line directly beneath prints the honest proportion ("15 of 16
    // checks look good", HomeConsole's attentionSub), and the remaining flagged checks are ONE PRESS
    // away — Check and Fix render `readiness.checks` in full, and Home carries the route in the
    // verdict dek and the Dock. The count moved DOWN a level; it did not disappear.
    //
    // CORRECTED 2026-08-26 by independent review, and the correction is the point: this comment
    // first claimed the rest were all printed further down this same screen. They are not: Home
    // shows this headline, the proportion, and the #1 limiter tile — one flagged thing, plus a door. `reasons`
    // below carries every flagged label but NOTHING renders it; it is derivation-only, and
    // system-posture.test.ts fails if that stops being true without this line being rewritten.
    // A sentence about what a screen shows is a claim, and an unverified claim is the same defect
    // whether it lands in a doc or in a comment.
    const top = attentionChecks[0];
    const headline = top.label;
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
