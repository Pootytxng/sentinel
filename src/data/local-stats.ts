// Local KPI counters (R3 Lane D — doctrine "the money plan runs on receipts", pointed inward).
// Counts a few of this rig's OWN Compy moments in localStorage: honest, local-only, zero IPC,
// zero network — and the natural seed data for the future opt-in Receipts telemetry (Lane C spec).
// Nothing here is ever sent anywhere; the Export modal shows the line so the user sees what
// Compy itself is keeping count of (nothing hidden).

export type LocalStats = {
  reportsExported: number;
  shareCardsCopied: number;
  walkthroughsOpened: number;
};

const KEY = "compy_local_stats_v1";
const EMPTY: LocalStats = { reportsExported: 0, shareCardsCopied: 0, walkthroughsOpened: 0 };

const asCount = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;

/** Read the counters; corrupt/missing/foreign-shaped storage degrades to zeros, never throws. */
export function readLocalStats(): LocalStats {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      reportsExported: asCount(p.reportsExported),
      shareCardsCopied: asCount(p.shareCardsCopied),
      walkthroughsOpened: asCount(p.walkthroughsOpened),
    };
  } catch {
    return { ...EMPTY };
  }
}

/** Bump one counter. Storage failures are silently ignored — stats must never break a feature. */
export function bumpLocalStat(key: keyof LocalStats): void {
  const stats = readLocalStats();
  stats[key] += 1;
  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    /* storage unavailable/full — counting is best-effort by design */
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The quiet Export-modal line, or null when there is nothing to say (all zeros → no noise). */
export function statsLine(s: LocalStats): string | null {
  if (s.reportsExported === 0 && s.shareCardsCopied === 0 && s.walkthroughsOpened === 0) return null;
  const parts = [
    plural(s.reportsExported, "report exported", "reports exported"),
    plural(s.shareCardsCopied, "share card copied", "share cards copied"),
    plural(s.walkthroughsOpened, "walkthrough opened", "walkthroughs opened"),
  ];
  return `This rig's Compy stats — ${parts.join(" · ")} (counted locally, only on this PC).`;
}
