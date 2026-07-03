import type { SessionSummary } from "../types";
import { prettyGameName } from "./game-name";
import { shortVerdict, fmtDur } from "./Play";

// Pure verdict/measured derivations for the V2 Monitor room (V2-5, spec
// 2026-07-02-v2-shell-sourcing-and-plan). Same contract as optimizeVerdict: measured facts
// only, branch-proper copy (never "(s)" — the plain-language bar).
//
// The headline grades with the SAME shortVerdict the debrief/Basic tiles use (one source), so
// the room's answer line can never disagree with the session rows below it. Sessions arrive as
// [] both while loading and when none exist — "nothing measured yet" is the honest line for
// both (Compy has measured nothing either way; there is no fabricated "loading" claim).

export type MonitorVerdictLine = { headline: string; sub?: string };

export function monitorVerdict(sessions: SessionSummary[]): MonitorVerdictLine {
  const latest = sessions[0];
  if (!latest) {
    return {
      headline: "No game sessions measured yet.",
      sub: "Start capture and play — the debrief lands here when the session ends.",
    };
  }
  const game = prettyGameName(latest.process_name) || "your last game";
  const fps = Math.round(latest.avg_fps);
  const grade = shortVerdict(latest);
  const headline =
    grade === "Smooth"
      ? `Last session ran smooth — ${game} at ${fps} fps average.`
      : grade === "Some dips"
        ? `Last session had some dips — ${game} at ${fps} fps average.`
        : `Last session ran rough — ${game} at ${fps} fps average.`;
  return {
    // "live estimate, not benchmark-grade" is the F3 honesty framing, kept on the room's
    // answer line so the verdict never overclaims what a 1 Hz sampler can prove.
    sub: `Measured over ${fmtDur(latest.duration_secs)} · ${latest.samples.toLocaleString()} samples · a live estimate, not a benchmark.`,
    headline,
  };
}

// The provenance line under the verdict: how much real data this room is standing on. The
// 1 Hz cadence is the code's actual poll interval (Play/MonitorBasic/LiveCharts), stated
// plainly; "while you watch" is literal — the pollers are demand-gated on tab + visibility.
export function monitorMeasuredLine(sessions: SessionSummary[]): string {
  const meters = "live meters read this rig once a second while you watch";
  if (sessions.length === 0) return `no sessions on record · ${meters}`;
  if (sessions.length === 1) return `1 session on record · ${meters}`;
  return `${sessions.length} sessions on record · ${meters}`;
}
