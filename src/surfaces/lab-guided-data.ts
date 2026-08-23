import type { TFunction } from "i18next";
import type { BenchmarkState, BlackBoxReport, LatencyReport, Verdict } from "../types";
import { changeAttribution } from "./benchmark-view";

// Guided Lab bench (spec 2026-07-05-lab-linear-guided-bench) — the pure data behind the bench:
// the station order, each station's plain-English contract lines, and the live "what the reading
// means" derivation. Same contract as lab-v2-data.ts: measured facts only, branch-proper copy,
// and the reading line pulls the SAME live value the instrument body shows (one source, so the
// station line can never disagree with the instrument under it) — or an honest "No reading yet",
// never a placeholder number.

// "optimize" (spec 2026-07-08 §8, the blended spine) is the merged-room's station 1 — the
// enable-all fast path, a native member of the spine with the same four-line contract as the
// measure stations. It is GROUND-ONLY: it never enters LAB_STATION_ORDER (so classic/guided/bento
// are byte-identical), and Lab prepends it to the spine only in `ground` mode when recs exist.
export type LabStationKey =
  | "optimize"
  | "diagnostics"
  | "benchmark"
  | "latency"
  | "tuning"
  | "blackbox";

// The bench order tells a story: know your rig → measure change → chase input lag → tame heat →
// explain a failure. Benchmark is the spine the others plug into. NOTE: "optimize" is deliberately
// absent — it's a ground-only prepend (§8.3), so this order stays the 5-station MEASURE spine and
// the non-ground faces (classic / guided / bento) never render it.
export const LAB_STATION_ORDER: LabStationKey[] = [
  "diagnostics",
  "benchmark",
  "latency",
  "tuning",
  "blackbox",
];

// The three static lines of the four-line station contract (§B). Line 3 — "what the reading
// means" — is live, derived by stationReading() below.
export type LabStationInfo = {
  name: string;
  forLine: string; // 1. What it's for — one line, real-world.
  whenLine: string; // 2. Reach for it when — the symptom that sends you here (mirrors the router).
  /** The Test room's station-row subtitle, printed under the name in 04-test-approved.png
   *  ("Measure performance with a repeatable run."). It is a SECOND line rather than a
   *  rewrite of whenLine because whenLine is what the command palette searches on — the
   *  symptom words ("crashed", "stutter", "a beat behind") are how someone in trouble finds
   *  the station, and the comp's task-framed sentence does not carry them. Two registers,
   *  two jobs, and neither is ever on screen beside the other. */
  dockLine: string;
  connectsLine: string; // 4. How it connects — the thread to a sibling station.
};

// i18n note: this is a plain data module, not a component — it can't call useTranslation()
// itself. Every export below takes `t: TFunction` as its LAST parameter (mirrors ago()/
// smoothness() elsewhere in this codebase); every call site passes its own `t` from
// useTranslation().
export function labStations(t: TFunction): Record<LabStationKey, LabStationInfo> {
  return {
    optimize: {
      name: t("lab.stations.optimize.name"),
      forLine: t("lab.stations.optimize.forLine"),
      whenLine: t("lab.stations.optimize.whenLine"),
      dockLine: t("lab.stations.optimize.dockLine"),
      // The cohesion thread: the fast path points INTO the proving loop — apply the stack here,
      // then prove it moved at the Benchmark station.
      connectsLine: t("lab.stations.optimize.connectsLine"),
    },
    diagnostics: {
      name: t("lab.stations.diagnostics.name"),
      forLine: t("lab.stations.diagnostics.forLine"),
      whenLine: t("lab.stations.diagnostics.whenLine"),
      dockLine: t("lab.stations.diagnostics.dockLine"),
      connectsLine: t("lab.stations.diagnostics.connectsLine"),
    },
    benchmark: {
      name: t("lab.stations.benchmark.name"),
      forLine: t("lab.stations.benchmark.forLine"),
      whenLine: t("lab.stations.benchmark.whenLine"),
      dockLine: t("lab.stations.benchmark.dockLine"),
      connectsLine: t("lab.stations.benchmark.connectsLine"),
    },
    latency: {
      name: t("lab.stations.latency.name"),
      forLine: t("lab.stations.latency.forLine"),
      whenLine: t("lab.stations.latency.whenLine"),
      dockLine: t("lab.stations.latency.dockLine"),
      connectsLine: t("lab.stations.latency.connectsLine"),
    },
    tuning: {
      name: t("lab.stations.tuning.name"),
      forLine: t("lab.stations.tuning.forLine"),
      whenLine: t("lab.stations.tuning.whenLine"),
      dockLine: t("lab.stations.tuning.dockLine"),
      connectsLine: t("lab.stations.tuning.connectsLine"),
    },
    blackbox: {
      name: t("lab.stations.blackbox.name"),
      forLine: t("lab.stations.blackbox.forLine"),
      whenLine: t("lab.stations.blackbox.whenLine"),
      dockLine: t("lab.stations.blackbox.dockLine"),
      connectsLine: t("lab.stations.blackbox.connectsLine"),
    },
  };
}

// "What are you here to do?" — the symptom→station router (§A). The copy is the spec's, pinned
// literally by lab-guided.test.tsx: real-world feelings, each mapped to exactly one station with
// the plain-English because. Lab filters rows to the stations this rig actually has (a row must
// never point at a station that isn't there — no dead ends).
export type LabRouterRow = { symptom: string; station: LabStationKey; because: string };

// The GROUND-ONLY lead row (§8.1). Kept OUT of labRouter() (which is pinned literally by
// lab-guided.test.tsx and shared with non-ground guided mode) — Lab prepends it to the router only
// in `ground` mode, so "just make it fast" is the first, most prominent intake choice for the
// assumed-majority path while every non-ground face stays byte-identical.
export function labRouterLeadOptimize(t: TFunction): LabRouterRow {
  return {
    symptom: t("lab.stations.routerLeadOptimize.symptom"),
    station: "optimize",
    because: t("lab.stations.routerLeadOptimize.because"),
  };
}

export function labRouter(t: TFunction): LabRouterRow[] {
  return [
    {
      symptom: t("lab.stations.router.latency.symptom"),
      station: "latency",
      because: t("lab.stations.router.latency.because"),
    },
    {
      symptom: t("lab.stations.router.benchmark.symptom"),
      station: "benchmark",
      because: t("lab.stations.router.benchmark.because"),
    },
    {
      symptom: t("lab.stations.router.tuning.symptom"),
      station: "tuning",
      because: t("lab.stations.router.tuning.because"),
    },
    {
      symptom: t("lab.stations.router.blackbox.symptom"),
      station: "blackbox",
      because: t("lab.stations.router.blackbox.because"),
    },
    {
      symptom: t("lab.stations.router.diagnostics.symptom"),
      station: "diagnostics",
      because: t("lab.stations.router.diagnostics.because"),
    },
  ];
}

// The live inputs — the SAME state the instrument bodies render from (zero new IPC; Lab already
// holds all of these).
export type LabStationFacts = {
  bench: BenchmarkState | null;
  latency: LatencyReport | null;
  // measureTuning's headline when a measurement exists (the same string the Tuning card shows).
  tuningHeadline: string | null;
  // null = not scanned this visit (Black Box is on-demand) — honestly unread.
  crash: BlackBoxReport | null;
  // Whether the system report behind the Diagnostics slot actually has sections.
  diagnosticsCaptured: boolean;
  // Station 1 "Optimize" (§8): the count of safe-tier, one-tap, not-yet-applied tweaks (the SAME
  // derivation the room verdict uses — safeFixesReady), and whether that count is zero (the safe
  // stack is set). Derived by the caller from recs; zero new IPC. Non-ground faces never render an
  // optimize station, so these stay 0/false there.
  safeReady: number;
  stackApplied: boolean;
  // Combined-effect honesty (panel-review brief 2026-07-15 §2): how many Trust Ledger changes
  // landed inside the graded window — callers derive it via changesBetweenRuns (the ONE window
  // every attributing surface filters by). >1 → the benchmark reading speaks for the stack.
  stackedCount: number;
};

function verdictReadingText(overall: Verdict, t: TFunction): string {
  switch (overall) {
    case "improved":
      return t("lab.stations.verdictReading.improved");
    case "no-measurable-change":
      return t("lab.stations.verdictReading.noMeasurableChange");
    case "regressed":
      return t("lab.stations.verdictReading.regressed");
  }
}

// With several changes inside the graded window the verdict belongs to the STACK — plural lead
// plus changeAttribution's credit-refusing caveat, mirroring labVerdict (the room header and
// this reading render the same result on one screen; they must never disagree on whose win it is).
function verdictReadingStackedText(overall: Verdict, t: TFunction): string {
  switch (overall) {
    case "improved":
      return t("lab.stations.verdictReadingStacked.improved");
    case "no-measurable-change":
      return t("lab.stations.verdictReadingStacked.noMeasurableChange");
    case "regressed":
      return t("lab.stations.verdictReadingStacked.regressed");
  }
}

// Line 3 — "what the reading means", translated to real life. Every branch is either the live
// value the instrument body already shows or an honest "No reading yet" with the way to get one.
// i18n note: `t` is threaded through as the LAST param (mirrors ago()/smoothness() elsewhere in
// this codebase) — every call site passes its own `t` from useTranslation().
export function stationReading(key: LabStationKey, f: LabStationFacts, t: TFunction): string {
  switch (key) {
    case "optimize":
      // Honest singular/plural, no "(s)". safeReady is the same measured count the verdict shows;
      // when it's zero the safe stack is set and the utility below is the next move.
      if (f.safeReady >= 1)
        return t("lab.stations.reading.optimizeReady", { count: f.safeReady });
      return t("lab.stations.reading.optimizeAllSet");
    case "diagnostics":
      return f.diagnosticsCaptured
        ? t("lab.stations.reading.diagnosticsCaptured")
        : t("lab.stations.reading.diagnosticsNotCaptured");
    case "benchmark": {
      if (f.bench?.efficacy) {
        const caveat = changeAttribution(f.stackedCount).caveat;
        if (caveat) return `${verdictReadingStackedText(f.bench.efficacy.overall, t)} ${caveat}`;
        return verdictReadingText(f.bench.efficacy.overall, t);
      }
      if (f.bench?.baseline) return t("lab.stations.reading.benchmarkBaselineSaved");
      return t("lab.stations.reading.benchmarkNoReading");
    }
    case "latency": {
      if (!f.latency) return t("lab.stations.reading.latencyNoReading");
      return f.latency.timer_current_ms != null
        ? t("lab.stations.reading.latencyWithTimer", {
            on: f.latency.msi.msi_on,
            off: f.latency.msi.msi_off,
            ms: f.latency.timer_current_ms.toFixed(2),
          })
        : t("lab.stations.reading.latencyNoTimer", {
            on: f.latency.msi.msi_on,
            off: f.latency.msi.msi_off,
          });
    }
    case "tuning":
      return f.tuningHeadline ?? t("lab.stations.reading.tuningNoReading");
    case "blackbox": {
      if (!f.crash) return t("lab.stations.reading.blackboxNoReading");
      const n = f.crash.incidents.length;
      if (n === 0) return t("lab.stations.reading.blackboxClean");
      return t("lab.stations.reading.blackboxIncidents", { count: n });
    }
  }
}
