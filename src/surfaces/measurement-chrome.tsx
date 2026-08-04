// Measurement chrome — one visual vocabulary for the two rooms that report a verdict.
//
// Monitor's "What changed?" debrief and the Lab's experiment bench answer the same question from
// two directions, and each had independently grown the same two pieces of chrome: an uppercase
// eyebrow naming a block, and a verdict word whose COLOUR carries the state. Nothing was shared, so
// they drifted on every number that had no reason to differ — 10.5 vs 11.5px eyebrows, 0.07 vs
// 0.04em tracking, mono vs sans, 12.5/600 vs 13.5/650 verdict type — and, worse, on the semantics:
// "comparable" and "worth-testing" were the same GOOD state wearing two different variables, with
// nothing in the code saying they were the same idea.
//
// Geometry and typography live here exactly once. The PALETTE deliberately does not — Monitor and
// the Lab are different rooms on different token families (--* vs --ix-*) and the per-room accent
// work is intentional. The bridge is `tone`: four states both rooms already had, now named the same
// thing, resolved from scope-local custom properties each host declares on its own root (`.wcp` in
// App.css, `.exp-bench` in ExperimentBench.css).
//
// Those declarations MUST be same-element on the room root and never hoisted to :root — a var()
// chain inside a custom property substitutes using the scope at its DECLARING element, so a
// :root-level --mc-good could not follow a room override. measurement-chrome-guard.test.ts pins it.
//
// Backlog: "Measurement Platform 2.0 follow-up — comparability vocabulary chrome convergence".
// Decision doc: docs/superpowers/specs/2026-07-18-prove-a-change-overlap.md §1/§5. Merging or
// renaming the rooms themselves stays owner territory; this is chrome only.
import type { ReactNode } from "react";
import type { Comparability } from "../types";
import "./measurement-chrome.css";

/** The four states a measurement room can report. Rooms map their own vocabulary onto these. */
export type ChromeTone = "good" | "caution" | "bad" | "neutral";

/**
 * The uppercase label that names a block ("MOST LIKELY CAUSE", "PAST EXPERIMENTS").
 * `className` is for POSITION only (a host may need it inline, or spaced differently) — type is
 * the shared vocabulary's and the guard test keeps it that way.
 */
export function SectionLabel({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <span className={className ? `mc-eyebrow ${className}` : "mc-eyebrow"}>{children}</span>;
}

/** The verdict word itself. The state reads through its colour — the house idiom, not a stripe. */
export function VerdictBand({
  tone,
  children,
  className,
}: {
  tone: ChromeTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span className={className ? `mc-verdict ${className}` : "mc-verdict"} data-tone={tone}>
      {children}
    </span>
  );
}

// The correspondence the two rooms never wrote down. Reading these side by side is the point:
// "comparable" ≡ "worth-testing" (go), "partial" ≡ "plausible-unproven" (proceed with stated
// limits), "not-comparable" ≡ "risk-exceeds-value" (don't trust / don't do it).
export const COMPARABILITY_TONE: Record<Comparability, ChromeTone> = {
  comparable: "good",
  partial: "caution",
  "not-comparable": "bad",
  unknown: "neutral",
};

// The simulator's verdict is a plain string over IPC, so this map is written out in FULL against
// experiment.rs's seven (SimulatorReport::verdict, experiment.rs:490) rather than listing the three
// that happen to carry a colour. The old CSS tinted only those three and left the other four on the
// primary ink by default — which read as an emphatic answer for what are, honestly, non-answers.
// Naming all seven is the point of this module: nothing falls into a bucket by accident.
export const SIMULATION_TONE: Record<string, ChromeTone> = {
  "worth-testing": "good",
  "plausible-unproven": "caution",
  "risk-exceeds-value": "bad",
  // The four honest non-answers — nothing to learn, nothing to promise. Quiet, not coloured.
  "insufficient-evidence": "neutral",
  "unlikely-to-matter": "neutral",
  "already-configured": "neutral",
  "not-applicable": "neutral",
};

/** Safety net for a verdict added to experiment.rs before it is added here: quiet, never coloured. */
export function simulationTone(verdict: string): ChromeTone {
  return SIMULATION_TONE[verdict] ?? "neutral";
}
