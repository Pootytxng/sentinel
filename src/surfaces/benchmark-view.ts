// Pure presentation helpers for the Benchmark tab — labels, verdict tone, delta
// formatting. Kept separate from the component so they're unit-tested without a DOM.
import type { Status } from "../design";
import type { BenchComponent, MachineModel, Verdict, TrialVerdict } from "../types";
import { rigTierLine, type RigTier } from "../data/rig-tier";
import type { TFunction } from "i18next";

const COMPONENT_LABELS: Record<BenchComponent, string> = {
  cpu: "CPU",
  ram: "Memory",
  gpu: "GPU",
  disk: "Disk",
};

export function componentLabel(c: BenchComponent, t?: TFunction): string {
  if (!t) return COMPONENT_LABELS[c];
  return t(`gaming.benchmark.componentLabels.${c}`, { defaultValue: COMPONENT_LABELS[c] });
}

const VERDICT_LABELS: Record<Verdict, string> = {
  improved: "Improved",
  "no-measurable-change": "No measurable change",
  regressed: "Regressed",
};

export function verdictLabel(v: Verdict, t?: TFunction): string {
  if (!t) return VERDICT_LABELS[v];
  const key = v === "improved" ? "improved" : v === "regressed" ? "regressed" : "noChange";
  return t(`gaming.benchmark.verdictLabels.${key}`, { defaultValue: VERDICT_LABELS[v] });
}

/** Map an efficacy verdict to a status-pill tone. "No measurable change" is neutral
 * INFO on purpose — it's the honest non-result (a determined finding), never dressed up
 * as a win and never an alarm. "Regressed" is ATTENTION, not danger (P7-severity,
 * Constitution §34): a benchmark that measured worse is worth a look and an undo, not a red
 * "Critical" alarm. The label still says "Regressed". */
export function verdictTone(v: Verdict): Status {
  if (v === "improved") return "ready";
  if (v === "regressed") return "attention";
  return "info";
}

/** Signed percent to one decimal (e.g. "+4.2%", "-1.1%", "0%"). */
export function fmtDelta(pct: number): string {
  const r = Math.round(pct * 10) / 10;
  if (r === 0) return "0%";
  return r > 0 ? `+${r}%` : `${r}%`;
}

// ── Live trial (game-frametime) verdict — Keep / Revert / Inconclusive ──
/** `rolledBack` is the trial's `rolled_back` flag. A "revert" verdict whose rollback failed must
 * not claim "reverted": the change that hurt is still on the machine. */
export function trialVerdictLabel(v: TrialVerdict, t?: TFunction, rolledBack = true): string {
  const stillApplied = v.verdict === "revert" && !rolledBack;
  const fallback =
    v.verdict === "keep"
      ? "Helped"
      : v.verdict === "revert"
        ? stillApplied
          ? "Hurt — still applied"
          : "Hurt — reverted"
        : "No measurable change";
  if (!t) return fallback;
  const key =
    v.verdict === "keep"
      ? "helped"
      : v.verdict === "revert"
        ? stillApplied
          ? "hurtStillApplied"
          : "hurtReverted"
        : "noChange";
  return t(`gaming.benchmark.trialVerdict.${key}`, { defaultValue: fallback });
}

/** P7-severity (Constitution §34): danger is only for a harmful state still on the machine. A
 * Trial that hurt and was put back is a calm, determined result (INFO; the label still says
 * "Hurt"). Only a hurt change whose rollback failed stays danger. */
export function trialVerdictTone(v: TrialVerdict, rolledBack = true): Status {
  if (v.verdict === "keep") return "ready";
  if (v.verdict === "revert") return rolledBack ? "info" : "danger";
  return "info"; // "no measurable change" — a determined null, neutral not amber
}

export function trialReasonText(reason: string, t?: TFunction): string {
  const fallbacks: Record<string, string> = {
    "within-noise": "the change stayed within your rig's run-to-run noise",
    "conditions-unstable": "conditions were too noisy to measure reliably — try again",
    "invalid-trial":
      "the run was invalid — the GPU throttled or its clock/temperature drifted mid-run — and was discarded",
  };
  const fallback = fallbacks[reason] ?? reason;
  if (!t || !(reason in fallbacks)) return fallback;
  const keyMap: Record<string, string> = {
    "within-noise": "withinNoise",
    "conditions-unstable": "conditionsUnstable",
    "invalid-trial": "invalidTrial",
  };
  return t(`gaming.benchmark.trialReason.${keyMap[reason]}`, { defaultValue: fallback });
}

// ── Combined-effect attribution (panel-review brief 2026-07-15 §2) ──
/**
 * Lead-in + caveat for the "Measuring the effect of: …" attribution line (efficacy card and
 * Two Futures split). With several changes applied between the two runs the measurement can
 * only speak for the stack: the lead says "combined" and the caveat refuses to split the
 * credit. A multi-change delta must never read as any single change's win.
 */
export function changeAttribution(count: number, t?: TFunction): { lead: string; caveat: string | null } {
  if (count > 1) {
    return {
      lead: t
        ? t("gaming.benchmark.attributionLeadMulti", { defaultValue: "Measuring the combined effect of:" })
        : "Measuring the combined effect of:",
      caveat: t
        ? t("gaming.benchmark.attributionCaveatMulti", {
            defaultValue:
              "These {{count}} changes were measured together, so the result is their combined effect — it can't be credited to any one of them.",
            count,
          })
        : `These ${count} changes were measured together, so the result is their combined effect — it can't be credited to any one of them.`,
    };
  }
  return {
    lead: t
      ? t("gaming.benchmark.attributionLeadSingle", { defaultValue: "Measuring the effect of:" })
      : "Measuring the effect of:",
    caveat: null,
  };
}

/**
 * The Trust Ledger changes a benchmark result actually measured: applied strictly AFTER the
 * baseline run and no later than the latest run. This is the ONE window every attributing
 * surface (efficacy card, Two Futures, the Lab verdict) filters by, so they can never disagree
 * about which changes a delta covers. Structural input (like RigSpecs above) keeps it pure and
 * DOM-free; no window recorded → no attribution ([]), never a guess.
 */
export function changesBetweenRuns<T extends { applied_at: string }>(
  bench: { baseline_at?: string | null; latest_at?: string | null } | null,
  changes: T[],
): T[] {
  if (!bench?.baseline_at || !bench?.latest_at) return [];
  const start = Date.parse(bench.baseline_at);
  const end = Date.parse(bench.latest_at);
  if (Number.isNaN(start) || Number.isNaN(end)) return [];
  return changes.filter((c) => {
    const t = Date.parse(c.applied_at);
    return !Number.isNaN(t) && t > start && t <= end;
  });
}

/** How many changes sit inside that window: one per change (`rec_id`), never one per ledger row, so
 *  a change applied twice in the window is still one change (codebase review 2026-11-02). A row the
 *  ledger says was applied on ANOTHER PC is not one of them — the same rule `benchmarkAttribution`
 *  credits by (`on_this_rig !== false`; a legacy row with no rig stays counted), so the Lab's
 *  "measured together" count can never speak for a change that ran elsewhere (CR-1102-left). */
export function changesInWindowCount(
  bench: { baseline_at?: string | null; latest_at?: string | null } | null,
  changes: { applied_at: string; rec_id: string; on_this_rig?: boolean | null }[],
): number {
  return new Set(
    changesBetweenRuns(bench, changes)
      .filter((c) => c.on_this_rig !== false)
      .map((c) => c.rec_id),
  ).size;
}

// ── Attribution off the Machine Model (#452) ──
/**
 * What the Test verdict may say about which Compy changes it measured. Read from the Machine
 * Model's `compy_changes`, never from the bare applied-changes IPC list: the model is the one reader
 * that knows whether the ledger was readable and which PC each row was applied on.
 *
 *   - `pending` — the model has not been read yet. Print nothing.
 *   - `unknown` — the model or the ledger could not be read, or the ledger is known incomplete and
 *                 names nothing in the window. "No Compy changes recorded" would credit the delta to
 *                 the user off a record Compy cannot read, so the line withdraws instead. A known
 *                 row on an incomplete ledger is still named: the health notice above qualifies it.
 *   - `counted` — `credited` are the rows applied inside the baseline→latest window on this PC, or
 *                 on a PC the ledger could not name (those are also counted in `rigUnknown` so the
 *                 line can say so). Rows the ledger says were applied on ANOTHER PC are never
 *                 credited; they are counted in `otherRig`. `truncated` is true when the model's
 *                 display-capped list may have cut rows out of the window, so the named list is a
 *                 floor, and `listed`/`totalRecorded` let the line say by how much.
 */
export type BenchmarkAttribution =
  | { kind: "pending" }
  | { kind: "unknown" }
  | {
      kind: "counted";
      /** `rolledBack`: the ledger says this change was undone after it was applied. It stays
       *  credited — the runs measured it while it was on — but the line must say so (#599). */
      credited: { id: string; title: string; rolledBack: boolean }[];
      otherRig: number;
      rigUnknown: number;
      truncated: boolean;
      listed: number;
      totalRecorded: number;
    };

export function benchmarkAttribution(
  bench: { baseline_at?: string | null; latest_at?: string | null } | null,
  model: MachineModel | null | undefined,
  ledgerIncomplete: boolean,
): BenchmarkAttribution {
  if (model === undefined) return { kind: "pending" };
  if (model === null) return { kind: "unknown" };
  const compy = model.compy_changes;
  if (compy.ledger_unreadable) return { kind: "unknown" };
  const rows = compy.changes;
  // The same window every attributing surface filters by (changesBetweenRuns). A row without a
  // recorded apply time cannot be placed in it, so it is not credited.
  const placed = rows
    .filter((c) => typeof c.applied_at.value === "string")
    .map((c) => ({ ...c, applied_at: c.applied_at.value as string }));
  const inWindow = changesBetweenRuns(bench, placed);
  const credited = inWindow
    .filter((c) => c.on_this_rig.value !== false)
    .map((c) => ({ id: c.id, title: c.title, rolledBack: c.status.value === "rolled_back" }));
  if (ledgerIncomplete && credited.length === 0) return { kind: "unknown" };
  const otherRig = inWindow.length - credited.length;
  const rigUnknown = inWindow.filter((c) => c.on_this_rig.value === null).length;
  // The model caps its list for display: if rows were cut AND every row still shown was applied
  // after the baseline, the cut rows could also sit inside the window — the named list is a floor.
  const start = bench?.baseline_at ? Date.parse(bench.baseline_at) : NaN;
  const end = bench?.latest_at ? Date.parse(bench.latest_at) : NaN;
  const shownTimes = placed.map((c) => Date.parse(c.applied_at)).filter((n) => !Number.isNaN(n));
  const truncated =
    !Number.isNaN(start) &&
    !Number.isNaN(end) &&
    compy.total_recorded > rows.length &&
    (shownTimes.length === 0 || Math.min(...shownTimes) > start);
  return {
    kind: "counted",
    credited,
    otherRig,
    rigUnknown,
    truncated,
    listed: rows.length,
    totalRecorded: compy.total_recorded,
  };
}

// ── A2 hardware-tier segmentation (LOCAL, no cohort/network) ──
// The measured inputs the rough rig tier reads — a structural subset of HardwareInfo, so this stays
// a pure, DOM-free, easily-tested helper (no coupling to the full App.tsx type).
export type RigSpecs = {
  gpus?: { vram_bytes: number }[];
  cpu_cores_physical: number;
  ram_total_bytes: number;
};

/**
 * Rig-tier segmentation for the Benchmark surface. Reuses the SAME transparent, owner-greenlit
 * bands the hardware grid shows (`src/data/rig-tier.ts`) so the two surfaces can never disagree, and
 * extracts the inputs the one canonical way (max VRAM across adapters · physical cores · total RAM).
 * Returns `null` when nothing is readable — never a fabricated tier from nothing. Purely LOCAL: it
 * classes YOUR rig from YOUR specs; no peer cohort, no network (that's Phase C, gated).
 */
export function benchRigTier(hw: RigSpecs): { tier: RigTier; basis: string } | null {
  return rigTierLine(
    Math.max(0, ...(hw.gpus ?? []).map((g) => g.vram_bytes)),
    hw.cpu_cores_physical,
    hw.ram_total_bytes,
  );
}

// ── A2 LOCAL percentile stub (display-only; no peer cohort) ──
/**
 * Format a verified win's standing among the user's OWN wins as a "top X%" line. The input is
 * `percentile_rank` (0–100) of the win's effect within the cohort of all the user's wins; the
 * "top %" shown is its complement (a higher percentile → a smaller, better top %), matching the
 * backend `percentile_rank` doc framing. Returns `null` when there's no rankable percentile yet
 * (too few wins → backend sends null; or a non-finite value), so the UI shows nothing rather than
 * a meaningless number. Strictly LOCAL — there is no peer/network cohort (that's Phase C, gated).
 */
export function fmtLocalWinTopPct(percentile: number | null | undefined, t?: TFunction): string | null {
  if (percentile == null || !Number.isFinite(percentile)) return null;
  const top = Math.min(100, Math.max(1, Math.round(100 - percentile)));
  if (!t) return `Top ${top}% of your verified wins`;
  return t("gaming.benchmark.localWinTopPct", { defaultValue: "Top {{top}}% of your verified wins", top });
}

/**
 * Expert-view variant (spec 2026-07-11-expert-layer-middle-ground §2): the TRUE percentile, not
 * the rounded "top N%" bucket. Same input contract and null-guards as fmtLocalWinTopPct; no
 * clamping — the raw number IS the point. Display-only over the already-computed value.
 */
export function fmtLocalWinPercentile(percentile: number | null | undefined, t?: TFunction): string | null {
  if (percentile == null || !Number.isFinite(percentile)) return null;
  const percentileStr = percentile.toFixed(1);
  const topPct = (100 - percentile).toFixed(1);
  if (!t) return `Percentile ${percentileStr} of your verified wins (top ${topPct}%)`;
  return t("gaming.benchmark.localWinPercentile", {
    defaultValue: "Percentile {{percentile}} of your verified wins (top {{topPct}}%)",
    percentile: percentileStr,
    topPct,
  });
}
