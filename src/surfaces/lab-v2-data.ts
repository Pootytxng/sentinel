import type { BenchComponent, BenchmarkState, ComponentEfficacy } from "../types";

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

const COMPONENT_LABEL: Record<BenchComponent, string> = {
  cpu: "CPU",
  ram: "RAM",
  gpu: "GPU",
  disk: "Disk",
};

// "+4.2%" / "-6.3%" — the sign IS the evidence, never dropped on positives.
const fmtDelta = (pct: number): string => `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;

// Noise floor prints as tersely as the number allows (2% not 2.0%).
const fmtFloor = (pct: number): string =>
  Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;

// The components that earned the overall grade, with their measured deltas.
const evidence = (per: ComponentEfficacy[], verdict: string): string =>
  per
    .filter((c) => c.verdict === verdict)
    .map((c) => `${COMPONENT_LABEL[c.component]} ${fmtDelta(c.delta_pct)}`)
    .join(" · ");

export function labVerdict(bench: BenchmarkState | null): LabVerdictLine {
  const efficacy = bench?.efficacy ?? null;
  if (efficacy) {
    const floor = fmtFloor(efficacy.noise_floor_pct);
    if (efficacy.overall === "improved") {
      const ev = evidence(efficacy.per_component, "improved");
      return {
        headline: "Your last benchmarked change improved this PC.",
        sub: ev
          ? `Measured: ${ev} — graded against a ${floor} noise floor.`
          : `Graded against a ${floor} noise floor.`,
      };
    }
    if (efficacy.overall === "regressed") {
      const ev = evidence(efficacy.per_component, "regressed");
      return {
        headline: "Your last benchmarked change made things worse.",
        sub: ev
          ? `Measured: ${ev} — graded against a ${floor} noise floor. Undo it, or re-run to confirm.`
          : `Graded against a ${floor} noise floor. Undo it, or re-run to confirm.`,
      };
    }
    return {
      headline: "Your last benchmarked change made no measurable difference.",
      sub: `Every component stayed inside the ${floor} noise floor — we call that noise, not a win.`,
    };
  }
  if (bench?.baseline) {
    // The Benchmark card right below coaches "change one thing, re-run" AND names when the
    // baseline was saved — so the sub repeats neither (V2-9 punch j: the same fact never
    // renders twice on one screen).
    return {
      headline: "Baseline recorded — your next benchmark run gets graded against it.",
      sub: "The grade lands here the moment you re-run.",
    };
  }
  return {
    headline: "Nothing graded in the Lab yet.",
    sub: "Start with Benchmark — set a baseline, change one thing, re-run. Compy tells you if it actually moved.",
  };
}

// The provenance line under the verdict: how many instruments this rig gets (the count is
// computed by the room from the same gates the body uses — vendor + diagnostics — never
// hardcoded) and the room's standing read-only guarantee, stated plainly.
export function labMeasuredLine(instruments: number): string {
  const count = instruments === 1 ? "1 instrument" : `${instruments} instruments`;
  return `${count} · they only measure — nothing in the Lab changes your PC`;
}
