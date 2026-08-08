import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import { invoke } from "@tauri-apps/api/core";
import { useReducedMotion } from "../design/use-motion";
import { ArcGauge } from "../design/console/ArcGauge";
import { Term } from "../design/Term";
import { Dock, type DockNode } from "../design/console/Dock";
import { ReticleCursor } from "../design/console/ReticleCursor";
import { RigViewer } from "./rig/RigViewer";
import { buildRigParts } from "./rig/rig-parts";
import { rigPartReadings, subsystemForRigPart, type LabReadingKey, type LabSubsystem } from "./lab-evidence-map";
import { OptimizeStation, type LabFastPathProps } from "./lab/OptimizeStation";
import {
  LAB_STATION_ORDER,
  labStations,
  type LabStationKey,
  type LabStationFacts,
} from "./lab-guided-data";
import { stationHasReading } from "./lab-bento-data";
import { changesBetweenRuns } from "./benchmark-view";
import { safeFixesReady } from "./optimize-v2-data";
import { deriveReverted } from "./use-scan";
import { peekProbe, cachedProbe } from "../data/probe-cache";
import { measureTuning, tuningEvidence } from "../data/tuning-measure";
import { tuningGuideForVendorForLanguage } from "../data/tuning-guides";
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
  const { t, i18n } = useTranslation();
  const reduced = useReducedMotion();
  // Station name lookup, translated — the SAME shape Lab/LabBento build from their own `t`, so a
  // station's name can never disagree across the three faces.
  const stations = labStations(t);

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
  const tuningGuide = tuningGuideForVendorForLanguage(vendor, i18n.language);

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
    // Combined-effect honesty (panel-review brief 2026-07-15 §2): changes inside the graded
    // window — the SAME window every attributing surface filters by.
    stackedCount: changesBetweenRuns(bench, fast.changes ?? []).length,
  };

  // RIG EVIDENCE MAP (owner verdict 2026-07-29) — selecting a part in the hologram states what that
  // subsystem reads right now. The hologram stays the owner of its own selection; this is a mirror
  // of it, not a takeover (see RigViewer's `onSelectedIdChange` doc comment).
  //
  // Rig ids are NOT 1:1 with kinds (`ram-2`, `gpu-1`, `disk-1`, `vol-1` all exist), so the exact part
  // is resolved from the same builder the viewer renders from and stays intact through the reading
  // call. Reducing it to `kind` here would relabel GPU 0 / C: readings as whichever GPU or drive the
  // user actually selected. `t` keeps this list byte-identical to the one on screen.
  const [selectedRigId, setSelectedRigId] = useState<string | null>(null);
  const selectedPart = selectedRigId ? buildRigParts(hw, t).find((p) => p.id === selectedRigId) : undefined;
  const evidenceSubsystem: LabSubsystem | null = selectedPart ? subsystemForRigPart(selectedPart.kind) : null;
  // Honesty rail 2 of lab-evidence-map: an empty list is a legitimate answer and is SAID in words,
  // never padded with a dash. Several subsystems return nothing on purpose.
  const evidenceReadings = selectedPart ? rigPartReadings(selectedPart, hw) : [];

  // Detail view — exactly ONE station open at a time (the dock IS the menu). Clicking a node opens
  // it, clicking again closes, clicking another swaps. Optimize is included — it is NOT always-on.
  const [openStation, setOpenStation] = useState<LabStationKey | null>(null);
  const onDockOpen = (key: string) => {
    const k = key as LabStationKey;
    setOpenStation((cur) => (cur === k ? null : k));
  };
  // Post-check deep-link (tester J 2026-07-22, Phase 5): "Take me to the Lab" from the first-check
  // verdict lands here and auto-opens the Optimize station (the door to the safe-tweak toggles)
  // instead of dropping the user on the dock to hunt for it. Race-free: the intent is written to
  // localStorage BEFORE this face mounts. One-shot — cleared on read, so a normal Lab visit is
  // unaffected.
  useEffect(() => {
    let pending: string | null = null;
    try {
      pending = localStorage.getItem("compy_lab_open_station");
      if (pending) localStorage.removeItem("compy_lab_open_station");
    } catch {
      /* ignore — no deep-link this visit */
    }
    if (pending === "optimize") setOpenStation("optimize");
  }, []);

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
      name: stations.optimize.name,
      icon: STATION_ICON.optimize,
      primary: true,
      measured: stackApplied || safeReady > 0,
    },
    ...measureKeys.map((k) => ({
      key: k,
      name: stations[k].name,
      icon: STATION_ICON[k],
      measured: stationHasReading(k, facts),
    })),
  ];

  return (
    <div className="lab-console" data-motion={reduced ? "reduced" : "full"}>
      {/* No lede (owner header-slop law 2026-07-10): the console opens straight on the stage —
          header space above carries header-format text only; the reversibility reassurance lives in
          the Optimize panel, next to the one control it qualifies. */}

      {/* CONSOLE STAGE — bracketed frame, real 3D hologram center, four corner arc gauges. */}
      <div className="lc-stage" ref={stageRef}>
        <span className="lc-brk lc-brk-tl" />
        <span className="lc-brk lc-brk-tr" />
        <span className="lc-brk lc-brk-bl" />
        <span className="lc-brk lc-brk-br" />
        <div className="lc-corner lc-tl">
          {/* Same "how we calculate this" line the Home console carries (consumer-panel Phase 2). */}
          <ArcGauge
            label={t("lab.labConsole.readinessLabel")}
            value={readinessScore}
            max={100}
            unit={t("lab.labConsole.unitScore")}
            tone="accent"
            note={
              readinessKnown
                ? t("lab.labConsole.readinessNote", {
                    passed: Math.max(0, readiness!.checks.length - readiness!.attention_count - readiness!.unknown_count),
                    total: readiness!.checks.length,
                  })
                : undefined
            }
          />
        </div>
        <div className="lc-corner lc-tr">
          <ArcGauge label={t("lab.labConsole.avgFpsLabel")} value={avgFps} max={240} unit={t("lab.labConsole.unitFps")} measured={avgFps != null} />
        </div>
        <div className="lc-corner lc-bl">
          <ArcGauge
            label={t("lab.labConsole.safeStackLabel")}
            value={fast.recs != null ? safeReady : null}
            max={Math.max(1, safeReady)}
            unit={t("lab.labConsole.unitReady")}
            tone="accent"
            measured={fast.recs != null}
          />
        </div>
        <div className="lc-corner lc-br">
          <ArcGauge
            label={
              /* align="end": this gauge sits at the stage's right edge — a left-anchored tooltip
                 rendered 126px past the window (self-review catch 2026-07-11). */
              <Term id="one-percent-lows" align="end">{t("lab.labConsole.oneLowLabel")}</Term>
            }
            value={lowFps}
            max={240}
            unit={t("lab.labConsole.unitFrames")}
            tone="warn"
            measured={lowFps != null}
          />
        </div>
        <div className="lc-rig">
          {/* chromeless — just the recognizable 3D hologram; the console frames it (brackets +
              corner gauges), so the viewer's own control bar / caption / "add a part" form are
              hidden (they collided with the corner gauges). */}
          <RigViewer hw={hw} chromeless onSelectedIdChange={setSelectedRigId} />
        </div>
        <ReticleCursor scopeRef={stageRef} />
      </div>

      {/* RIG EVIDENCE MAP — appears only once a part is selected; nothing selected means no panel,
          not an empty one. Outside .lc-stage so it never collides with the corner gauges, and above
          the dock so the reading sits next to the hologram that produced it. */}
      {evidenceSubsystem && (
        <div className="lc-evidence" aria-live="polite">
          <div className="lc-evidence-head">
            <span className="lc-evidence-name">
              {t(`lab.labConsole.evidence.subsystem.${evidenceSubsystem}`)}
            </span>
            <span className="lc-evidence-part">{selectedPart?.name}</span>
          </div>
          {evidenceReadings.length > 0 ? (
            <dl className="lc-evidence-list">
              {evidenceReadings.map((r) => (
                <div className="lc-evidence-row" key={r.key}>
                  <dt>{t(`lab.labConsole.evidence.reading.${r.key satisfies LabReadingKey}`)}</dt>
                  <dd>
                    <span className="lc-evidence-value">{r.value}</span>
                    {r.kind === "gauge" && (
                      <>
                        <span className="lc-evidence-den">{r.den}</span>
                        {/* Proportion only — no colour-by-threshold. None of the app's audited
                            thresholds apply to these fields, so a reading is stated, not graded. */}
                        <span className="lc-evidence-bar" aria-hidden="true">
                          <span style={{ width: `${Math.round(r.pct * 100)}%` }} />
                        </span>
                      </>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="lc-evidence-empty">{t("lab.labConsole.evidence.empty")}</p>
          )}
        </div>
      )}

      {/* DOCK — Optimize primary + the measure stations. */}
      <Dock nodes={dockNodes} activeKey={openStation} onOpen={onDockOpen} />

      {/* ONE open panel: Optimize (inline OptimizeStation) OR a measure body. */}
      {openStation && (
        <div className="lc-detail lab-card" id="lab-console-detail">
          <div className="lc-detail-head">
            <span className="lc-detail-name">{stations[openStation].name}</span>
            <button className="lc-detail-close" onClick={() => setOpenStation(null)} aria-label={t("lab.labConsole.closeStationAriaLabel")}>
              {t("lab.labConsole.close")}
            </button>
          </div>
          <div className="lab-card-body">
            {openStation === "optimize" && (
              /* The room's reassurance, relocated from the header (owner header-slop law 2026-07-10)
                 to its context. This note does NOT census which stations mutate — the Lab has several
                 mutators (this Optimize station, Benchmark's "Measure this tweak" tweak-trial, and the
                 armed Controlled experiments bench), and each discloses its own mutation at its own
                 surface. Two prior attempts to census the room from here shipped FALSE claims — "the
                 only station ... that changes anything" (self-review round 1), then "everything else
                 just reads" (round 2, which missed Benchmark's ungated tweak-trial). So we state the
                 one thing true across every station instead: everything here is reversible (rollback-
                 first, LOCKED rule 3). The undo half stays on Fix's consent line beside the apply
                 controls (title-header law) so the panel never says undo twice. */
              <p className="lc-detail-note">
                {t("lab.labConsole.optimizeReassurance")}
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
