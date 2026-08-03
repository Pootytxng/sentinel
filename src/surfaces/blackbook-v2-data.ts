import type { TFunction } from "i18next";
import { autopsyStats, type AutopsyLedgerEntry } from "../data/autopsy-ledger";

// Pure verdict/measured derivations for the V2 Blackbook room (V2-6, spec
// 2026-07-02-v2-shell-sourcing-and-plan). Same contract as monitorVerdict: measured facts
// only, branch-proper copy (never "(s)" — the plain-language bar).
//
// The headline is the reader's OWN measured story when one exists — the local autopsy record
// (guides fact-checked on this PC, counts only) — because that's the one per-user fact this
// room produces. With no record yet, the honest line is the room's standing promise (the same
// claim the shipped tagline makes: we only answer what's been verified), with zero numbers
// invented. The corpus count lives in the measured line ONLY (one-mention law).

export type BlackbookVerdictLine = { headline: string; sub?: string };

// i18n note: `t` is threaded through as the LAST param (this is a plain data module, not a
// component — it can't call useTranslation() itself) — every call site passes its own `t` from
// useTranslation(). Mirrors ago()/smoothness() elsewhere in this codebase. The "its"/"their"
// pronoun split (English-only grammar, not a genuine numeric plural) is folded straight into the
// gradedHeadline_one/_other pair rather than composed from a separate count fragment.
export function blackbookVerdict(ledger: AutopsyLedgerEntry[], t: TFunction): BlackbookVerdictLine {
  const stats = autopsyStats(ledger);
  if (stats.count === 0) {
    return {
      headline: t("blackbook.blackbookV2.verdict.noRecordHeadline"),
      sub: t("blackbook.blackbookV2.verdict.noRecordSub"),
    };
  }
  const one = stats.count === 1;
  if (stats.gradedTweaks === 0) {
    // Graded guides whose claims carried no verdict-bearing tweaks (scam patterns and
    // unrecognized claims only) — percentages of zero would mislead, so none are shown.
    return {
      headline: t("blackbook.blackbookV2.verdict.gradedNoTweaksHeadline", { count: stats.count }),
      sub:
        stats.scamFlags > 0
          ? t("blackbook.blackbookV2.verdict.scamFlaggedSoFar", { count: stats.scamFlags })
          : t(
              one
                ? "blackbook.blackbookV2.verdict.unratedClaimsSingular"
                : "blackbook.blackbookV2.verdict.unratedClaimsPlural",
            ),
    };
  }
  // Headline carries the answer as a share; the sub carries the raw counts (complementary,
  // not the same number twice).
  const scamPart =
    stats.scamFlags === 0
      ? ""
      : t("blackbook.blackbookV2.verdict.scamFlaggedInline", { count: stats.scamFlags });
  return {
    headline: t("blackbook.blackbookV2.verdict.gradedHeadline", {
      count: stats.count,
      pct: stats.realPct,
    }),
    sub: t("blackbook.blackbookV2.verdict.recognizedBreakdown", {
      real: stats.real,
      placebo: stats.placebo,
      risky: stats.risky,
      scamPart,
    }),
  };
}

// (The former measured-line header strip was retired 2026-07-10 — owner header-slop law: header
// space carries header-format text only. Its facts already live in the body: Learn's search states
// the corpus size, and its link/refuse copy states that Autopsy never opens or fetches a pasted
// link. That copy said "Compy never fetches the internet" until 2026-08-03 — false since the
// updater armed; the claim is now scoped to Autopsy, which is where it is actually true.)
