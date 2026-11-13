// Measurement item 7: the ONE label for a Trial verdict judged on the assumed ±3% band before Compy
// measured each game's noise (experiment.rs `AssumedBandLabel`, attached on read by `get_experiments`,
// never stored). Every surface that shows an old verdict reads it from here: the Trial bench, the
// Guided Journey result and its receipt, and the Home interview's tested count.
import { useTranslation } from "react-i18next";
import { prettyGameName } from "./game-name";

/** P4-judge-noisy (experiment.rs `AssumedBandLabel`, read-only): a verdict judged on the assumed ±3%
 *  band before Compy measured each game's noise, and that game's noise as measured now (null = not yet). */
export type AssumedBand = {
  assumed_pct: number;
  measured_low1_pct: number | null;
  measured_sessions: number | null;
  /** The old verdict claimed better or worse: only then did a wider noise mean it over-claimed. */
  claimed_change?: boolean;
  /** The old verdict judged anything at all (an old too-noisy result did not). */
  judged?: boolean;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

// P4-judge-noisy (immutability): a verdict judged on the assumed band is labelled, never rewritten,
// with this game's noise as measured now; still unmeasured is said so.
export function assumedBandLine(a: AssumedBand, game: string, t: Translate): string {
  const pct = (v: number) => String(Math.round(v * 10) / 10);
  const name = prettyGameName(game) || game;
  if (a.measured_low1_pct == null) return t("lab.experimentBench.assumedBandUnmeasured", { assumed: pct(a.assumed_pct), game: name });
  const [assumed, measured, sessions] = [pct(a.assumed_pct), pct(a.measured_low1_pct), a.measured_sessions ?? 0];
  if (a.measured_low1_pct <= a.assumed_pct)
    return t("lab.experimentBench.assumedBandNarrower", { assumed, measured, sessions, game: name });
  // Only a claimed better/worse was judged against too little noise; a "no change" still stands; an old
  // too-noisy result judged nothing.
  if (a.judged === false) return t("lab.experimentBench.assumedBandWiderUnjudged", { assumed, measured, sessions, game: name });
  return a.claimed_change
    ? t("lab.experimentBench.assumedBandWider", { assumed, measured, sessions, game: name })
    : t("lab.experimentBench.assumedBandWiderNoClaim", { assumed, measured, sessions, game: name });
}

/** The label beside an old verdict; nothing for a verdict judged on a measured band. */
export function AssumedBandNote({ band, game, testId = "assumed-band-note" }: { band?: AssumedBand | null; game: string; testId?: string }) {
  const { t } = useTranslation();
  if (!band) return null;
  return (
    <p className="exp-fineprint assumed-band-note" data-testid={testId}>
      {assumedBandLine(band, game, t)}
    </p>
  );
}

/** How many changes counted as measured (`isMeasured` on their verdict) have a measured verdict that
 *  was judged on the assumed band, counted per change the way the tested count is. */
export function assumedBandCount(
  exps: { rec_id: string; verdict: string | null; assumed_band?: AssumedBand | null }[],
  isMeasured: (v: string | null) => boolean,
): number {
  return new Set(exps.filter((e) => isMeasured(e.verdict) && e.assumed_band != null).map((e) => e.rec_id)).size;
}
