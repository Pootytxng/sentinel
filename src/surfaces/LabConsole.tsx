import { useEffect, useRef, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useReducedMotion } from "../design/use-motion";
import { ArcGauge } from "../design/console/ArcGauge";
import { Dock, type DockNode } from "../design/console/Dock";
import { ReticleCursor } from "../design/console/ReticleCursor";
import { RigViewer } from "./rig/RigViewer";
import { OptimizeStation, type LabFastPathProps } from "./lab/OptimizeStation";
import {
  LAB_STATION_ORDER,
  LAB_STATIONS,
  type LabStationKey,
  type LabStationFacts,
} from "./lab-guided-data";
import { stationHasReading } from "./lab-bento-data";
import { safeFixesReady } from "./optimize-v2-data";
import { deriveReverted } from "./use-scan";
import { peekProbe, cachedProbe } from "../data/probe-cache";
import { measureTuning, tuningEvidence } from "../data/tuning-measure";
import { tuningGuideForVendor } from "../data/tuning-guides";
import { latestSession } from "./dashboard-data";
import { BenchmarkTab } from "./Benchmark";
import { LatencyTab } from "./Latency";
import { BlackBox } from "./BlackBox";
import { TuningInstrument } from "./TuningInstrument";
import type {
  BenchmarkState,
  LatencyReport,
  BlackBoxReport,
  SessionSummary,
  ArmedComparison,
  ComparisonResult,
  GameReadiness,
} from "../types";
import type { GpuVendor } from "./walkthroughs";
import type { HardwareInfo } from "../App";
import "./lab-console.css";

// LabConsole — the Lab's face as THE OPS CONSOLE (spec 2026-07-09-lab-redesign-direction-proposal,
// Phase 1, Task 4, owner-approved). Replaces the Instrument Bench bento (LabBench, deleted) with a
// console room: a real 3D hologram center-stage, four corner arc gauges reading whatever this rig
// has actually measured (honesty rail — an absent reading renders NOT-YET, never a fabricated
// number), and a Dock of stations — Optimize primary, the measure/prove stations beside it. Exactly
// ONE detail panel is open at a time; Optimize is NOT always-on (that dominating always-on hero was
// the rejected shape) — it opens its own panel like every other station, just marked primary.
//
// The probe reads + facts derivation below are ported VERBATIM from the deleted LabBench.tsx — only
// the render changed, from a bento grid of bays to this console. Rendered by LabGround for the Lab
// tab ONLY when `compy_lab_ground` is on (DEFAULT ON since 2026-07-10) — flag "0", the untouched
// classic LabV2 renders.

// A small local icon map — the guided/bento data modules don't define one (checked before writing
// this). Presentation-only; never gates behavior.
const STATION_ICON: Record<LabStationKey, string> = {
  optimize: "⛭",
  diagnostics: "📋",
  benchmark: "📈",
  latency: "⚡",
  tuning: "🌡",
  blackbox: "🗃",
};

export function LabConsole({
  fast,
  diagnostics,
  diagnosticsCaptured = false,
  vendor = "any",
  hw,
  readiness = null,
}: {
  // The fast-path prop bundle — the SAME audited apply handlers the OptimizeV2 room gets (zero new
  // IPC, zero new mutation primitive). Threaded straight into the Optimize panel.
  fast: LabFastPathProps;
  diagnostics?: ReactNode;
  // Whether the system report behind the Diagnostics station actually has sections (never claim
  // "Measured" for an empty report).
  diagnosticsCaptured?: boolean;
  vendor?: GpuVendor;
  // The real hardware read, for the center hologram.
  hw: HardwareInfo;
  // Optional — LabGround already computes this for the room verdict. Absent (e.g. in isolated
  // tests) means the honesty rail renders the Readiness gauge as NOT-YET, never a guess.
  readiness?: GameReadiness | null;
}) {
  const reduced = useReducedMotion();

  // Cursor-follow accent spotlight on the stage — a border-masked glow that tracks the pointer
  // (the JARVIS "alive" the owner missed). Custom props only; skipped entirely under reduced motion.
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    // Reduced motion (incl. a mid-session flip): clear any stale glow the pointer handler left set,
    // and attach nothing.
    if (reduced) {
      stage.style.setProperty("--glow-intensity", "0");
      return;
    }
    const onMove = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      stage.style.setProperty("--glow-x", `${((e.clientX - r.left) / r.width) * 100}%`);
      stage.style.setProperty("--glow-y", `${((e.clientY - r.top) / r.height) * 100}%`);
      stage.style.setProperty("--glow-intensity", "1");
    };
    const onLeave = () => stage.style.setProperty("--glow-intensity", "0");
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);
    return () => {
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      stage.style.setProperty("--glow-intensity", "0");
    };
  }, [reduced]);

  // v1 ships the AMD undervolt guide only (locked rule #5) — Tuning is a station only on AMD.
  const tuningGuide = tuningGuideForVendor(vendor);

  // The measure-station reads — the SAME on-mount probes Lab does (no polling, ZERO new IPC). Seed
  // from the probe cache so re-opening the console paints last-known instantly.
  const [bench, setBench] = useState<BenchmarkState | null>(() => peekProbe("benchmark-state") ?? null);
  const [latency, setLatency] = useState<LatencyReport | null>(() => peekProbe("latency-diag") ?? null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [armed, setArmed] = useState<ArmedComparison | null>(null);
  const [latestCmp, setLatestCmp] = useState<ComparisonResult | null>(null);
  // Black Box is on-demand — null until the user scans this visit (honest "Not yet").
  const [bbReport, setBbReport] = useState<BlackBoxReport | null>(null);

  useEffect(() => {
    cachedProbe("benchmark-state", () => invoke<BenchmarkState>("get_benchmark_state"), 30_000)
      .then(setBench)
      .catch(() => {});
    cachedProbe("latency-diag", () => invoke<LatencyReport>("get_latency_diagnostics"), 60_000)
      .then(setLatency)
      .catch(() => {});
    if (tuningGuide) {
      invoke<SessionSummary[]>("get_session_summaries").then(setSessions).catch(() => {});
      invoke<ArmedComparison | null>("get_armed_comparison").then(setArmed).catch(() => {});
      invoke<ComparisonResult | null>("get_latest_comparison").then(setLatestCmp).catch(() => {});
    }
  }, [tuningGuide]);

  const measurement = measureTuning(armed, sessions, latestCmp);
  const tuningEvidenceVerdict = tuningEvidence(sessions);

  // Station 1's live reading inputs (§8.1) — the SAME measured count the room verdict shows
  // (safeFixesReady over the same recs, excluding drifted). Derived here; zero new IPC.
  const groundReverted = deriveReverted(fast.changes ?? []);
  const showOptimize = !!fast.recs && fast.recs.length > 0;
  const safeReady =
    fast.recs != null
      ? safeFixesReady(
          fast.recs,
          fast.isAppliable ?? (() => false),
          new Set(groundReverted.map((r) => r.rec_id)),
        )
      : 0;
  const stackApplied = showOptimize && safeReady === 0;

  // The measure/prove stations this rig actually has, in the §B diagnostic order (Tuning and
  // Diagnostics gate on vendor + slot content — the SAME gates the classic path uses).
  const measureKeys = LAB_STATION_ORDER.filter(
    (k) => (k !== "tuning" || !!tuningGuide) && (k !== "diagnostics" || !!diagnostics),
  );

  const facts: LabStationFacts = {
    bench,
    latency,
    tuningHeadline: measurement?.headline ?? null,
    crash: bbReport,
    diagnosticsCaptured,
    safeReady,
    stackApplied,
  };

  // Detail view — exactly ONE station open at a time (the dock IS the menu). Clicking a node opens
  // it, clicking again closes, clicking another swaps. Optimize is included — it is NOT always-on.
  const [openStation, setOpenStation] = useState<LabStationKey | null>(null);
  const onDockOpen = (key: string) => {
    const k = key as LabStationKey;
    setOpenStation((cur) => (cur === k ? null : k));
  };

  // The identical instrument bodies the classic Lab renders — one source for every layout. Optimize
  // opens <OptimizeStation> inline instead (handled by the caller, not this switch).
  const stationBody = (k: LabStationKey): ReactNode => {
    switch (k) {
      case "optimize":
        return null;
      case "diagnostics":
        return diagnostics;
      case "benchmark":
        // In the proving ground, Benchmark is the "prove it" station — the Two Futures measured
        // split is its payoff, surfaced regardless of the standalone compy_two_futures flag.
        return <BenchmarkTab provingGround />;
      case "latency":
        return <LatencyTab />;
      case "tuning":
        return tuningGuide ? (
          <TuningInstrument
            guide={tuningGuide}
            vendor={vendor}
            measurement={measurement}
            recentSessions={sessions.slice(0, 5)}
            evidence={tuningEvidenceVerdict}
          />
        ) : null;
      case "blackbox":
        return <BlackBox onReport={setBbReport} />;
    }
  };

  // HONESTY RAIL (corner gauges) — every value traces to a real measured source; an absent one is
  // `null` (ArcGauge's NOT-YET), never a fabricated 0. Readiness reuses the same ready/total ratio
  // the Command Center's signal ring derives (no invented 0–100 "score"); avg/1%-low FPS come from
  // the most recent session this rig actually ran (BenchmarkState carries no fps fields — that's
  // CPU/RAM/GPU/disk synthetic scoring, a different measurement).
  const readinessKnown = !!readiness && readiness.checks.length > 0;
  const readinessScore = readinessKnown
    ? Math.round(
        (100 * Math.max(0, readiness!.checks.length - readiness!.attention_count - readiness!.unknown_count)) /
          readiness!.checks.length,
      )
    : null;
  const latest = latestSession(fast.sessions ?? []);
  const avgFps = latest?.avg_fps ?? null;
  const lowFps = latest?.low1_fps_est ?? null;

  const dockNodes: DockNode[] = [
    {
      key: "optimize",
      name: LAB_STATIONS.optimize.name,
      icon: STATION_ICON.optimize,
      primary: true,
      measured: stackApplied || safeReady > 0,
    },
    ...measureKeys.map((k) => ({
      key: k,
      name: LAB_STATIONS[k].name,
      icon: STATION_ICON[k],
      measured: stationHasReading(k, facts),
    })),
  ];

  return (
    <div className="lab-console" data-motion={reduced ? "reduced" : "full"}>
      {/* No lede (owner header-slop law 2026-07-10): the console opens straight on the stage —
          header space above carries header-format text only; the undo/read-only promise lives in
          the Optimize panel, next to the one control it qualifies. */}

      {/* CONSOLE STAGE — bracketed frame, real 3D hologram center, four corner arc gauges. */}
      <div className="lc-stage" ref={stageRef}>
        <span className="lc-brk lc-brk-tl" />
        <span className="lc-brk lc-brk-tr" />
        <span className="lc-brk lc-brk-bl" />
        <span className="lc-brk lc-brk-br" />
        <div className="lc-corner lc-tl">
          <ArcGauge label="Readiness" value={readinessScore} max={100} unit="score" tone="accent" />
        </div>
        <div className="lc-corner lc-tr">
          <ArcGauge label="Avg FPS" value={avgFps} max={240} unit="fps" measured={avgFps != null} />
        </div>
        <div className="lc-corner lc-bl">
          <ArcGauge
            label="Safe stack"
            value={fast.recs != null ? safeReady : null}
            max={Math.max(1, safeReady)}
            unit="ready"
            tone="accent"
            measured={fast.recs != null}
          />
        </div>
        <div className="lc-corner lc-br">
          <ArcGauge
            label="1% low"
            value={lowFps}
            max={240}
            unit="frames"
            tone="warn"
            measured={lowFps != null}
          />
        </div>
        <div className="lc-rig">
          {/* chromeless — just the recognizable 3D hologram; the console frames it (brackets +
              corner gauges), so the viewer's own control bar / caption / "add a part" form are
              hidden (they collided with the corner gauges). */}
          <RigViewer hw={hw} chromeless />
        </div>
        <ReticleCursor scopeRef={stageRef} />
      </div>

      {/* DOCK — Optimize primary + the measure stations. */}
      <Dock nodes={dockNodes} activeKey={openStation} onOpen={onDockOpen} />

      {/* ONE open panel: Optimize (inline OptimizeStation) OR a measure body. */}
      {openStation && (
        <div className="lc-detail lab-card" id="lab-console-detail">
          <div className="lc-detail-head">
            <span className="lc-detail-name">{LAB_STATIONS[openStation].name}</span>
            <button className="lc-detail-close" onClick={() => setOpenStation(null)} aria-label="Close station">
              Close
            </button>
          </div>
          <div className="lab-card-body">
            {openStation === "optimize" && (
              /* The room's read-only promise, relocated from the header (owner header-slop law
                 2026-07-10) to its context: the one station that changes anything. The undo half
                 moved to Fix's consent line beside the apply controls (title-header law) — this
                 note keeps only the room-scope fact so the panel never says undo twice. */
              <p className="lc-detail-note">
                The only station in this room that changes anything — everything else just reads.
              </p>
            )}
            {openStation === "optimize" ? <OptimizeStation {...fast} /> : stationBody(openStation)}
          </div>
        </div>
      )}
    </div>
  );
}

export default LabConsole;
