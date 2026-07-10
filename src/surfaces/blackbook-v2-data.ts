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

export function blackbookVerdict(ledger: AutopsyLedgerEntry[]): BlackbookVerdictLine {
  const stats = autopsyStats(ledger);
  if (stats.count === 0) {
    return {
      headline: "Heard a tweak online? Look it up here before you try it.",
      sub: "We only answer what's been verified — search the library, or paste a whole guide and get every claim graded.",
    };
  }
  const one = stats.count === 1;
  const guides = one ? "1 guide" : `${stats.count} guides`;
  if (stats.gradedTweaks === 0) {
    // Graded guides whose claims carried no verdict-bearing tweaks (scam patterns and
    // unrecognized claims only) — percentages of zero would mislead, so none are shown.
    return {
      headline: `You've fact-checked ${guides} here.`,
      sub:
        stats.scamFlags > 0
          ? stats.scamFlags === 1
            ? "1 known scam pattern flagged so far."
            : `${stats.scamFlags} known scam patterns flagged so far.`
          : `${one ? "Its" : "Their"} claims weren't tweaks we've verified, so no grades — we never guess.`,
    };
  }
  // Headline carries the answer as a share; the sub carries the raw counts (complementary,
  // not the same number twice).
  const scamPart =
    stats.scamFlags === 0
      ? ""
      : stats.scamFlags === 1
        ? " · 1 known scam pattern flagged"
        : ` · ${stats.scamFlags} known scam patterns flagged`;
  return {
    headline: `You've fact-checked ${guides} — ${stats.realPct}% of ${one ? "its" : "their"} tweaks were real.`,
    sub: `Of the tweaks we recognized: ${stats.real} real · ${stats.placebo} placebo · ${stats.risky} risky${scamPart}.`,
  };
}

// (The former measured-line header strip was retired 2026-07-10 — owner header-slop law: header
// space carries header-format text only. Its facts already live in the body: Learn's search states
// the corpus size, and its link/refuse copy states "never fetches the internet".)
