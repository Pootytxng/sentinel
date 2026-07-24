import type { TFunction } from "i18next";
import type {
  AppliedChange,
  BenchComponent,
  BenchmarkState,
  BlackBoxReport,
  ComponentEfficacy,
  LatencyReport,
} from "../types";
import { changeAttribution, changesBetweenRuns } from "./benchmark-view";

// Pure verdict/measured derivations for the V2 Lab room (V2-7, spec
// 2026-07-02-v2-shell-sourcing-and-plan). Same contract as monitorVerdict/blackbookVerdict:
// measured facts only, branch-proper copy (never "(s)" — the plain-language bar).
//
// The headline is the Lab's one per-user answer: the last graded benchmark (the SAME efficacy
// verdict the Benchmark card shows — one source, so the room's answer line can never disagree
// with the instrument below it). The grade names its evidence in the same breath (the V2-9
// punch (h) law): which components moved and by how much, against the run's own noise floor.
// bench arrives null both while loading and when nothing was ever benchmarked — "nothing
// graded yet" is the honest line for both (Compy has graded nothing either way).

export type LabVerdictLine = { headline: string; sub?: string };

const componentLabel = (t: TFunction): Record<BenchComponent, string> => ({
  cpu: t("lab.labV2.componentLabels.cpu"),
  ram: t("lab.labV2.componentLabels.ram"),
  gpu: t("lab.labV2.componentLabels.gpu"),
  disk: t("lab.labV2.componentLabels.disk"),
});

// "+4.2%" / "-6.3%" — the sign IS the evidence, never dropped on positives.
const fmtDelta = (pct: number): string => `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;

// Noise floor prints as tersely as the number allows (2% not 2.0%).
const fmtFloor = (pct: number): string =>
  Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;

// The components that earned the overall grade, with their measured deltas.
const evidence = (per: ComponentEfficacy[], verdict: string, t: TFunction): string => {
  const label = componentLabel(t);
  return per
    .filter((c) => c.verdict === verdict)
    .map((c) => `${label[c.component]} ${fmtDelta(c.delta_pct)}`)
    .join(" · ");
};

// i18n note: `t` is threaded through as the LAST param (this is a plain data module, not a
// component — it can't call useTranslation() itself) — every call site passes its own `t` from
// useTranslation(). Mirrors ago()/smoothness() elsewhere in this codebase.
export function labVerdict(
  bench: BenchmarkState | null,
  changes: AppliedChange[] = [],
  t: TFunction,
): LabVerdictLine {
  const efficacy = bench?.efficacy ?? null;
  if (efficacy) {
    const floor = fmtFloor(efficacy.noise_floor_pct);
    // Combined-effect honesty (panel-review brief 2026-07-15 §2): with several Compy changes
    // applied between the two runs, the grade belongs to the STACK — same caveat text as the
    // efficacy card / Two Futures (one source, changeAttribution), never one change's win.
    const stacked = changesBetweenRuns(bench, changes);
    const combined = changeAttribution(stacked.length).caveat;
    if (efficacy.overall === "improved") {
      const ev = evidence(efficacy.per_component, "improved", t);
      const graded = ev
        ? t("lab.labV2.verdict.gradedWithEvidence", { evidence: ev, floor })
        : t("lab.labV2.verdict.gradedNoEvidence", { floor });
      if (combined) {
        return {
          headline: t("lab.labV2.verdict.headline.improvedStacked"),
          sub: `${graded} ${combined}`,
        };
      }
      return { headline: t("lab.labV2.verdict.headline.improvedSingle"), sub: graded };
    }
    if (efficacy.overall === "regressed") {
      const ev = evidence(efficacy.per_component, "regressed", t);
      const graded = ev
        ? t("lab.labV2.verdict.gradedWithEvidence", { evidence: ev, floor })
        : t("lab.labV2.verdict.gradedNoEvidence", { floor });
      if (combined) {
        return {
          headline: t("lab.labV2.verdict.headline.regressedStacked"),
          sub: `${graded} ${combined} ${t("lab.labV2.verdict.undoStacked")}`,
        };
      }
      return {
        headline: t("lab.labV2.verdict.headline.regressedSingle"),
        sub: `${graded} ${t("lab.labV2.verdict.undoSingle")}`,
      };
    }
    const noise = t("lab.labV2.verdict.noise", { floor });
    if (combined) {
      return {
        headline: t("lab.labV2.verdict.headline.noChangeStacked"),
        sub: `${noise} ${combined}`,
      };
    }
    return {
      headline: t("lab.labV2.verdict.headline.noChangeSingle"),
      sub: noise,
    };
  }
  if (bench?.baseline) {
    // The Benchmark card right below coaches "change one thing, re-run" AND names when the
    // baseline was saved — so the sub repeats neither (V2-9 punch j: the same fact never
    // renders twice on one screen).
    return {
      headline: t("lab.labV2.verdict.baselineRecorded.headline"),
      sub: t("lab.labV2.verdict.baselineRecorded.sub"),
    };
  }
  return {
    headline: t("lab.labV2.verdict.nothingGraded.headline"),
    sub: t("lab.labV2.verdict.nothingGraded.sub"),
  };
}

// (The former measured-line header strip was retired 2026-07-10 — owner header-slop law: header
// space carries header-format text only. The read-only guarantee already lives in the Lab body's
// own copy; the instrument count is the visible instrument list itself.)

// ── Latest readings (fill pass, spec 2026-07-05-v2-nits-fill-pass) ──
// The newest value each instrument produced, consolidated for the foot-of-room glance strip.
// Pure derivation over the SAME reads the instrument cards above already made (zero new IPC);
// an instrument with no reading yet is an honest "—" — no placeholder number, ever.
export type LabReading = { label: string; value: string };

export function labLatestReadings(
  f: {
    bench: BenchmarkState | null;
    latency: LatencyReport | null;
    // present = the Tuning instrument renders on this rig (vendor gate); headline = measureTuning's
    // verdict when a measurement exists.
    tuning: { present: boolean; headline: string | null };
    // null = the user hasn't scanned yet this visit (Black Box is on-demand) — honestly unread.
    crash: BlackBoxReport | null;
    // present = the Diagnostics instrument renders; captured = the system report actually has sections.
    diagnostics: { present: boolean; captured: boolean };
  },
  t: TFunction,
): LabReading[] {
  const baselineDate = f.bench?.baseline_at ? new Date(f.bench.baseline_at) : null;
  const readings: LabReading[] = [
    {
      label: t("lab.lab.readings.baselineLabel"),
      value:
        baselineDate && !isNaN(baselineDate.getTime())
          ? baselineDate.toLocaleDateString()
          : f.bench?.baseline
            ? t("lab.lab.readings.baselineSet")
            : "—",
    },
    {
      label: t("lab.lab.readings.latencyLabel"),
      value:
        f.latency == null
          ? "—"
          : f.latency.timer_current_ms != null
            ? t("lab.lab.readings.latencyTimer", { ms: f.latency.timer_current_ms.toFixed(2) })
            : t("lab.lab.readings.latencyMsiOn", { on: f.latency.msi.msi_on }),
    },
  ];
  if (f.tuning.present) {
    readings.push({ label: t("lab.lab.readings.tuningLabel"), value: f.tuning.headline ?? "—" });
  }
  readings.push({
    label: t("lab.lab.readings.blackBoxLabel"),
    value:
      f.crash == null
        ? "—"
        : f.crash.incidents.length === 0
          ? t("lab.lab.readings.blackBoxNoneFound")
          : t("lab.lab.readings.blackBoxRecorded", { n: f.crash.incidents.length }),
  });
  if (f.diagnostics.present) {
    readings.push({
      label: t("lab.lab.readings.systemReportLabel"),
      value: f.diagnostics.captured ? t("lab.lab.readings.systemReportCaptured") : "—",
    });
  }
  return readings;
}
