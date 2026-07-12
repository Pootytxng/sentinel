import type { BenchmarkState, BlackBoxReport, LatencyReport, Verdict } from "../types";

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
  connectsLine: string; // 4. How it connects — the thread to a sibling station.
};

export const LAB_STATIONS: Record<LabStationKey, LabStationInfo> = {
  optimize: {
    name: "Optimize",
    forLine: "Enable the safe, vetted tweaks for your rig — in one tap.",
    whenLine: "You just want it faster and safe, without fiddling.",
    // The cohesion thread: the fast path points INTO the proving loop — apply the stack here,
    // then prove it moved at the Benchmark station.
    connectsLine: "Prove the stack you just applied — run Benchmark and watch the before/after.",
  },
  diagnostics: {
    name: "Diagnostics",
    forLine: "Know exactly what's in your rig before you change anything.",
    whenLine: "You just want to know what's in this PC.",
    connectsLine: "Feeds every other station — you read their numbers against what's really in here.",
  },
  benchmark: {
    name: "Benchmark",
    forLine: "Prove a change actually helped — not a placebo.",
    whenLine: "You're asking \"did that tweak actually do anything, or did I imagine it?\"",
    connectsLine: "The bench's spine — run it before and after any Optimize or Tuning change.",
  },
  latency: {
    name: "Latency",
    forLine: "Cut the delay between your hand and the screen.",
    whenLine: "Your aim or clicks feel a beat behind.",
    connectsLine: "Pair it with Benchmark to prove a latency change held.",
  },
  tuning: {
    name: "Tuning",
    forLine: "Run cooler and quieter without losing frames (AMD).",
    whenLine: "It runs hot or loud and you want it calmer without giving up frames.",
    connectsLine: "Benchmark grades whether your frames held after the undervolt.",
  },
  blackbox: {
    name: "Black Box",
    forLine: "Understand a crash or freeze after it happens.",
    whenLine: "It crashed or froze and you don't know why.",
    connectsLine: "Check Diagnostics for the rig state behind what it finds.",
  },
};

// "What are you here to do?" — the symptom→station router (§A). The copy is the spec's, pinned
// literally by lab-guided.test.tsx: real-world feelings, each mapped to exactly one station with
// the plain-English because. Lab filters rows to the stations this rig actually has (a row must
// never point at a station that isn't there — no dead ends).
export type LabRouterRow = { symptom: string; station: LabStationKey; because: string };

// The GROUND-ONLY lead row (§8.1). Kept OUT of LAB_ROUTER (which is pinned literally by
// lab-guided.test.tsx and shared with non-ground guided mode) — Lab prepends it to the router only
// in `ground` mode, so "just make it fast" is the first, most prominent intake choice for the
// assumed-majority path while every non-ground face stays byte-identical.
export const LAB_ROUTER_LEAD_OPTIMIZE: LabRouterRow = {
  symptom: "I just want my PC faster — safely, no fiddling",
  station: "optimize",
  because: "it enables the safe, vetted tweaks for your rig in one tap — undo any time",
};

export const LAB_ROUTER: LabRouterRow[] = [
  {
    symptom: "My aim/clicks feel a beat behind",
    station: "latency",
    because: "it traces mouse→screen and names what's adding delay",
  },
  {
    symptom: "Did that tweak actually help — or did I imagine it?",
    station: "benchmark",
    because: "it grades a real before/after against a noise floor",
  },
  {
    symptom: "It runs hot / loud, I want it cooler without losing frames",
    station: "tuning",
    because: "it measures whether an undervolt dropped temps AND held frames",
  },
  {
    symptom: "It crashed or froze and I don't know why",
    station: "blackbox",
    because: "it reads Windows' own crash & freeze record in plain English",
  },
  {
    symptom: "I just want to know what's in this rig",
    station: "diagnostics",
    because: "read-only forensics — everything Compy detected, raw",
  },
];

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
};

const VERDICT_READING: Record<Verdict, string> = {
  improved: "Last verdict: Improved — the change moved more than the run's own noise.",
  "no-measurable-change":
    "Last verdict: No measurable change — it stayed inside the noise floor. That's noise, not a win.",
  regressed: "Last verdict: Regressed — things measured worse. Worth undoing.",
};

// Line 3 — "what the reading means", translated to real life. Every branch is either the live
// value the instrument body already shows or an honest "No reading yet" with the way to get one.
export function stationReading(key: LabStationKey, f: LabStationFacts): string {
  switch (key) {
    case "optimize":
      // Honest singular/plural, no "(s)". safeReady is the same measured count the verdict shows;
      // when it's zero the safe stack is set and the utility below is the next move.
      if (f.safeReady === 1) return "1 safe tweak ready to enable — one tap, reversible.";
      if (f.safeReady > 1)
        return `${f.safeReady} safe tweaks ready to enable — one tap, all reversible.`;
      return "Every safe tweak is already on — your rig is set. Prove it below, or you're done.";
    case "diagnostics":
      return f.diagnosticsCaptured
        ? "Report captured — the raw facts about this rig, ready to read."
        : "No reading yet — the system report hasn't been captured.";
    case "benchmark":
      if (f.bench?.efficacy) return VERDICT_READING[f.bench.efficacy.overall];
      if (f.bench?.baseline)
        return "Baseline saved — change one thing, re-run, and the grade lands here.";
      return "No reading yet — set a baseline to start.";
    case "latency": {
      if (!f.latency) return "No reading yet — open the station and Compy traces the path.";
      const timer =
        f.latency.timer_current_ms != null
          ? ` · timer ${f.latency.timer_current_ms.toFixed(2)}ms`
          : "";
      return `MSI ${f.latency.msi.msi_on} on · ${f.latency.msi.msi_off} off${timer} — MSI on and a low timer mean a shorter mouse-to-screen trip.`;
    }
    case "tuning":
      return (
        f.tuningHeadline ??
        "No reading yet — undervolt in AMD's tool, play a session, and Compy grades whether it held."
      );
    case "blackbox": {
      if (!f.crash) return "No reading yet — scan and Compy reads Windows' own crash record.";
      const n = f.crash.incidents.length;
      if (n === 0) return "Scanned clean — no crashes or freezes in Windows' record.";
      return n === 1
        ? "1 incident recorded — read what happened in plain English."
        : `${n} incidents recorded — read what happened in plain English.`;
    }
  }
}
