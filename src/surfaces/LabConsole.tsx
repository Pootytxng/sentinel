import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import "../i18n";
import { invoke } from "@tauri-apps/api/core";
import { useReducedMotion } from "../design/use-motion";
import { ArcGauge } from "../design/console/ArcGauge";
import { Dock, type DockNode } from "../design/console/Dock";
import { BentoGrid, BentoTile } from "../design/bento/BentoGrid";
import { RoomShell } from "../design/room-shell";
import { RoomEyebrow } from "../design/room-eyebrow";
import { ReticleCursor } from "../design/console/ReticleCursor";
import { RigViewer } from "./rig/RigViewer";
import { RigManualParts } from "./rig/RigManualParts";
import { buildRigParts, type RigSelection } from "./rig/rig-parts";
import { rigPartReadings, subsystemForRigPart, type LabReadingKey, type LabSubsystem } from "./lab-evidence-map";
import { OptimizeStation, type LabFastPathProps } from "./lab/OptimizeStation";
import {
  LAB_STATION_ORDER,
  labStations,
  type LabStationKey,
  type LabStationFacts,
} from "./lab-guided-data";
import { stationHasReading } from "./lab-bento-data";
import { STATION_ICON } from "./station-icons";
import { changesBetweenRuns } from "./benchmark-view";
import { safeFixesReady } from "./optimize-v2-data";
import { deriveReverted } from "./use-scan";
import { peekProbe, cachedProbe } from "../data/probe-cache";
import { measureTuning, tuningEvidence } from "../data/tuning-measure";
import { tuningGuideForVendorForLanguage } from "../data/tuning-guides";
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
  ScoreboardView,
  TrialState,
} from "../types";
import type { GpuVendor } from "./walkthroughs";
import type { HardwareInfo } from "../App";
import "./lab-console.css";

/**
 * HOW CLOSE THE BENCH SITS TO ITS RIG.
 *
 * Round 2's 6.3 was derived by measuring the BRIGHT CORE (the lit motherboard cluster) against the
 * comp, and the round-2 Codex review (2026-08-27) rejected exactly that yardstick: the comp's
 * subject is the COMPLETE visible silhouette — the outer holo case shell plus the floor ring — and
 * at 6.3 that silhouette overflowed the stage on all four edges. The core parity the old comment
 * claimed was real, and beside the point.
 *
 * 10.2 is measured against the complete silhouette instead. In the approved comp the silhouette
 * spans 54.5% of the stage's width and 88.5% of its height, fully contained, side margins ~150 px.
 * Iterating distance on the live stage (6.3 → 9.0 → 9.4 → 10.2 at 1500×980): the case body clears
 * the sides by 9.0, but the floor ring stays cropped at the stage's bottom edge through 9.4 —
 * the framing centers on the case, so the ring is the last thing to come inside — and first sits
 * fully in frame near 10.0. At 10.2 the ring spans ~53.5% of the stage's width (comp 54.5%), side
 * margins match the comp within ~10 px, and every part of the silhouette is inside the stage at
 * 1280×720, 1500×980 and 1920×1080 (verified per-resolution, not assumed). Note this lands ABOVE
 * the hologram's 9.5 bay default: the bench's dominance comes from its 58.2% panel share, not from
 * a closer camera — round 1's "pull the camera in" theory is retired by measurement.
 *
 * The bench stage is pinned to aspect 1.2, which is `FIT_REF_ASPECT` exactly, so
 * `fitCameraDistance` returns this untouched and the framing is identical at every window size. It
 * is a Test-room value passed through one optional prop — no other caller's framing moves.
 */
const BENCH_CAMERA_DIST = 10.2;

/* Round 4 (#224): containment alone was not the comp. At 10.2 the whole silhouette is inside the
 * stage, but the default aim (target y 0.2, which centers the CASE) leaves the floor ring hugging
 * the stage's bottom edge — ~0-5 px of air at 1500×980 where the comp draws ~45-50 px. Aiming the
 * camera lower moves the composition UP in frame: bottom air grows, the top margin pays for it,
 * and distance 10.2 (with everything measured above) is preserved.
 *
 * -0.45 is measured, not styled: ring-apex row-scan (5px-thick runs, so the grid's 1px lines don't
 * count) puts the bottom air at 31 px of a 371-px stage at 1280×720, 46/561 at 1500×980, 60/732 at
 * 1920×1080 — 8.2-8.4% everywhere (one aim, pinned 1.2 stage aspect), the comp's ~45-50/561 ≈ 8-9%.
 * -0.35 measured 39/561, short of the comp band. Top air stays visible at every size (~15 px at
 * 1280, ~28 px at 1500), nothing clips. */
const BENCH_CAMERA_TARGET_Y = -0.45;

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

export function LabConsole({
  fast,
  diagnostics,
  diagnosticsCaptured = false,
  vendor = "any",
  hw,
  hud,
  ledState,
  classicVerdict,
  below,
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
  /* THE ROOM COMPOSES ITSELF NOW (issue #49 slice 6). The console used to be a child of a RoomShell
     LabGround owned; the approved direction gives Test a narrative column and an evidence column,
     and every piece of both is state THIS component holds (which station is open, what the rig has
     selected, what the bench has measured). Lifting that state up to write the shell above it would
     have meant threading six setters through a wrapper for no gain, so the shell came down here
     instead — the same move Live made in slice 4.

     `hud` is `compy_editorial`, and it chooses the SHELL, exactly as it does on History. False is
     the devtools failsafe and must keep rendering the whole room the classic way; the failsafe
     breaking because a new branch quietly became the only branch is a bug this repo has already
     shipped once. */
  hud: boolean;
  // The room verdict's LED state, computed by LabGround from the SAME optimizeVerdict the classic
  // headline speaks — so the dot and the sentence can never disagree about the room.
  ledState: "ok" | "warn" | "scan";
  // The classic (flag-off) h1: the verdict sentence, with its DecryptedText treatment intact.
  classicVerdict: ReactNode;
  // Full-width content under both columns — the GPU profile surface and the experiments bench.
  below?: ReactNode;
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
  // Test's own reading set (spec 2026-08-21-test-rig-reading-set) — the bench's evidence, not the
  // machine's verdict. Both commands are already registered/invoked elsewhere (Benchmark.tsx); zero
  // new backend surface.
  const [scoreboard, setScoreboard] = useState<ScoreboardView | null>(null);
  const [trial, setTrial] = useState<TrialState | null>(null);

  useEffect(() => {
    cachedProbe("benchmark-state", () => invoke<BenchmarkState>("get_benchmark_state"), 30_000)
      .then(setBench)
      .catch(() => {});
    cachedProbe("latency-diag", () => invoke<LatencyReport>("get_latency_diagnostics"), 60_000)
      .then(setLatency)
      .catch(() => {});
    invoke<ScoreboardView>("get_scoreboard").then(setScoreboard).catch(() => {});
    invoke<TrialState>("get_trial_state").then(setTrial).catch(() => {});
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
  //
  // The hologram also draws two things `buildRigParts` knows nothing about — the user's manually
  // added parts, and the fans — and BOTH are clickable. Resolving through the builder alone meant a
  // click on either highlighted it in the model and then rendered no panel at all: a dead end with
  // no sentence explaining itself, which reads as a broken app. `selectedRig` carries what the
  // hologram actually drew, so every click now answers.
  const [selectedRig, setSelectedRig] = useState<RigSelection | null>(null);
  const selectedPart =
    selectedRig?.source === "part" ? buildRigParts(hw, t).find((p) => p.id === selectedRig.id) : undefined;
  const evidenceSubsystem: LabSubsystem | null = selectedPart ? subsystemForRigPart(selectedPart.kind) : null;
  // Honesty rail 2 of lab-evidence-map: an empty list is a legitimate answer and is SAID in words,
  // never padded with a dash. Several subsystems return nothing on purpose.
  const evidenceReadings = selectedPart ? rigPartReadings(selectedPart, hw) : [];
  // A fan is the one non-part with a measurement of its own: its rpm comes from the same sensor
  // read the hologram is already showing, so stating it invents nothing. A fan with no monitor
  // publishing has `rpm: null` and says so; a part the user typed in himself is never presented as
  // something Compy measured.
  const evidenceFallback = (() => {
    if (!selectedRig || selectedRig.source === "part") return null;
    const isFan = selectedRig.source === "fan";
    const rpm = selectedRig.source === "fan" ? selectedRig.rpm : null;
    return {
      name: selectedRig.name,
      subsystemLabel: isFan
        ? t("lab.labConsole.evidence.subsystem.thermals")
        : t("lab.labConsole.evidence.userAddedSubsystem"),
      // Exactly one of the two: a real measurement, or the honest reason there isn't one.
      reading: rpm !== null ? t("lab.labConsole.evidence.fanSpeed", { rpm }) : null,
      note:
        rpm !== null
          ? null
          : isFan
            ? t("lab.labConsole.evidence.fanUnread")
            : t("lab.labConsole.evidence.userAddedNote"),
    };
  })();

  // Detail view — exactly ONE station open at a time (the dock IS the menu). Clicking a node opens
  // it, clicking again closes, clicking another swaps. Optimize is included — it is NOT always-on.
  const [openStation, setOpenStation] = useState<LabStationKey | null>(null);
  // The optional exact-incident selector that rides alongside a `blackbox` deep-link (Tier 1 task
  // 9). One-shot, like the station key: read and cleared on mount, so a later ordinary visit to the
  // Lab never re-opens somebody's old crash.
  const [openIncidentId, setOpenIncidentId] = useState<string | null>(null);
  // "Add a part Compy can't detect" is a disclosure in the station list now (04-test-approved.png
  // draws it as the list's last row). Closed by default; the form stays mounted either way.
  const [manualOpen, setManualOpen] = useState(false);
  // The eyebrow's dateline — the date this bench is being read (today), never fabricated. Same
  // rule, same helper shape as Health's masthead dateline.
  const dateline = new Date().toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  // bug->guard, #222 frontend/IPC contract audit (2026-08-25). The localStorage key is one-shot,
  // but the React state DERIVED from it was set once on mount and never cleared. Closing Black Box
  // and reopening it BY HAND — still on the Lab tab, so nothing remounts — handed the old id
  // straight back to <BlackBox>, which fired an unrequested scan and re-marked a crash the user had
  // already walked away from. Every hand-driven station change now drops the selection: the
  // deep-link is a one-time delivery, not a mode the room stays in.
  const closeStation = () => {
    setOpenStation(null);
    setOpenIncidentId(null);
  };
  const onDockOpen = (key: string) => {
    const k = key as LabStationKey;
    setOpenIncidentId(null);
    setOpenStation((cur) => (cur === k ? null : k));
  };
  // Station deep-link (tester J 2026-07-22, Phase 5): "Take me to Test" from the first-check
  // verdict lands here and auto-opens the Optimize station (the door to the safe-tweak toggles)
  // instead of dropping the user on the dock to hunt for it. Race-free: the intent is written to
  // localStorage BEFORE this face mounts. One-shot — cleared on read, so a normal Lab visit is
  // unaffected.
  //
  // Generalised 2026-08-11 (crash-rescue discoverability, SESSION_HANDOFF §4): Home's "it crashed
  // or froze" row deep-links to `blackbox` through the same key, so the reader takes any station
  // — but only one this rig ACTUALLY renders. `stationBody` returns null for a station whose data
  // is absent (Tuning without a guide, Diagnostics without slots), and measureKeys filters those
  // off the dock; honouring the raw key regardless would open an empty panel the dock has no node
  // for. A stale or unknown value is dropped, and the user simply lands on the dock.
  useEffect(() => {
    let pending: string | null = null;
    let incident: string | null = null;
    try {
      pending = localStorage.getItem("compy_lab_open_station");
      if (pending) localStorage.removeItem("compy_lab_open_station");
      // BOTH keys are consumed and cleared here, and the incident key is cleared even when the
      // station is missing or unrenderable. A one-shot that survives its own visit is not one-shot:
      // it would silently re-select a stale crash the next time anything opened this console.
      incident = localStorage.getItem("compy_lab_open_incident");
      if (incident) localStorage.removeItem("compy_lab_open_incident");
    } catch {
      /* ignore — no deep-link this visit */
    }
    if (!pending) return;
    const openable: LabStationKey[] = ["optimize", ...measureKeys];
    const target = openable.find((k) => k === pending);
    if (target) setOpenStation(target);
    // The incident selector only means anything at the station that can honour it.
    if (target === "blackbox" && incident) setOpenIncidentId(incident);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount by design
  }, []);

  // AN OPENED STATION HAS TO BE ON SCREEN (DIR-1 first-timer walk, 2026-08-26, finding #1). The
  // detail panel renders BELOW the dock, so opening a station could put the thing the user just
  // asked for entirely below the fold — and the deep-link path was worse than a hand click: coming
  // from Health's "It crashed, froze, or restarted" → "Read the crash record", the walk measured
  // `aria-pressed="true"` on the Crash & Freeze Rescue node and `#lab-console-detail` present in
  // the DOM, while the only thing on screen was this room's unrelated hero. Press a button, see
  // nothing change: the exact dead end this walk was looking for.
  //
  // `block: "nearest"` is the whole restraint. Already fully visible → it does nothing, so a hand
  // click near the top of the dock does not yank the dock off screen and cost the user the way to
  // switch stations. Taller than the lane (the usual case) → the spec aligns its top edge to the
  // top of the view, which is the deep-link behaviour we want. Instant, not smooth: this is
  // navigation mechanics, and reduced motion must not be able to turn it off.
  //
  // Ordering, deliberately relied upon: a deep-link arrives with a ROOM change, and ShellV2 resets
  // the shared lane to its top in that same commit. This effect cannot fight it, because the mount
  // effect above only sets state — the panel does not exist until the NEXT commit, so this scroll
  // runs strictly after the reset rather than being erased by it.
  const detailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!openStation) return;
    detailRef.current?.scrollIntoView({ block: "nearest" });
  }, [openStation]);

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
        return <BlackBox onReport={setBbReport} selectedIncidentId={openIncidentId} />;
    }
  };

  // HONESTY RAIL (corner gauges) — every value traces to a real measured source; an absent one is
  // `null` (ArcGauge's NOT-YET), never a fabricated 0. Test answers "what can this bench prove, and
  // what has it proved?" — a verdict about the EVIDENCE, not the machine (spec
  // 2026-08-21-test-rig-reading-set §2). Readiness/avg-FPS/1%-low are Health's verdict numbers and
  // stay there; nothing here should ever be readable on Health.

  // TL — Proven: the awards ledger only records Keep verdicts (types.ts AwardEntry), so this is
  // literally "changes this bench has verified". scoreboard === null → unread, NOT-YET.
  const provenCount = scoreboard ? scoreboard.awards.length : null;

  // TR — Noise floor: the bench's own instrument constant — how big an effect this rig can even
  // resolve. get_trial_state's noise floor (game-frametime spread) once a calibration has produced
  // one, else the fallback already fetched for Tuning (get_latest_comparison, same field, same
  // measurement kind). Deliberately NEVER bench.efficacy.noise_floor_pct — that is the synthetic
  // bench's run-to-run spread, a different measurement wearing the same field name.
  const noiseFloorPct = trial && trial.noise_floor_pct != null ? trial.noise_floor_pct : (latestCmp?.noise_floor_pct ?? null);

  // BR — Instruments read: how far through the bench this rig has gone. Same `stationHasReading`
  // the dock already uses to mark nodes measured, so the gauge and the dock can never disagree.
  const instrumentsRead = measureKeys.filter((k) => stationHasReading(k, facts)).length;
  const instrumentsTotal = measureKeys.length;

  // Each node carries its station's dockLine — the subtitle 04-test-approved.png prints under the
  // name — so the list says in plain words what each station is for, which is what the "start here"
  // six equal buttons lacked (intimidation pass 2026-08-21). It is deliberately NOT whenLine: that
  // sentence is the symptom that sends you here, it still feeds the command palette's search, and
  // the comp draws the task instead. See LabStationInfo.dockLine.
  const dockNodes: DockNode[] = [
    {
      key: "optimize",
      name: stations.optimize.name,
      icon: STATION_ICON.optimize,
      primary: true,
      measured: stackApplied || safeReady > 0,
      hint: stations.optimize.dockLine,
    },
    ...measureKeys.map((k) => ({
      key: k,
      name: stations[k].name,
      icon: STATION_ICON[k],
      measured: stationHasReading(k, facts),
      hint: stations[k].dockLine,
    })),
  ];

  // The safe stack's "on" count — the complement of safeReady over the same recs, so the gauge can
  // read "12 on · all applied" once the stack is in, instead of "0 ready" on an empty ring, which
  // the installed build showed as the room's bottom-left alarm (intimidation pass 2026-08-21).
  const safeOn = (fast.recs ?? []).filter((r) => r.severity === "safe" && r.currently_applied).length;

  return (
    <RoomShell
      room="lab"
      /* THE NARRATIVE COLUMN (04-test-approved.png). Same grammar Health and Live already speak:
         a dotted eyebrow, one human sentence, one short explanation, one dominant action. The
         Instrument-HUD masthead is gone from this room as it went from Live and History -- the
         rail that navigated here already said "Test", and a masthead repeating it pushed the
         room's own sentence a third smaller than the label above it. */
      /* Its own slot, not a passenger in `verdict` (#211): inside it the eyebrow rendered inside the
         <h1>. Same condition as the verdict below — the classic verdict draws no eyebrow at all. */
      eyebrow={
        hud ? (
          <RoomEyebrow
            dot={ledState}
            label={t("lab.labConsole.narrative.eyebrow")}
            dateline={dateline}
          />
        ) : undefined
      }
      verdict={hud ? <span className="lc-headline">{t("lab.labConsole.narrative.headline")}</span> : classicVerdict}
      sub={hud ? t("lab.labConsole.narrative.sub") : undefined}
      /* THE ONE DOMINANT ACTION. It opens the SAME Optimize station the list row below opens, by
         the same setter -- one door, two handles, never two code paths. The line under it is the
         comp's, and it is a positioning sentence, not a claim: it says when to pick this, and
         promises no result. */
      primaryAction={
        hud ? (
          <>
            <button
              type="button"
              className="lc-start v2-primary"
              aria-controls="lab-console-detail"
              aria-expanded={openStation === "optimize"}
              onClick={() => onDockOpen("optimize")}
            >
              {t("lab.labConsole.narrative.action")}
            </button>
            <p className="lc-action-note">{t("lab.labConsole.narrative.actionNote")}</p>
          </>
        ) : undefined
      }
      /* THE SAFETY PROMISE, kept visible exactly as the handoff requires: one reversible change,
         one measured result, restore by default. It is the room's standing contract, so it sits at
         the foot of the story column rather than inside the one station it would otherwise look
         like it only qualified. */
      footnote={hud ? t("lab.labConsole.narrative.safety") : undefined}
      /* THE EVIDENCE COLUMN — the real rig on the bench, and under it the four readings this bench
         can actually vouch for. The corner gauges LEFT the canvas: the handoff says not to cover it
         with click targets or diagrams, and four rings floating over the hologram were doing
         exactly that. Strip form also lets each reading keep its label, its value and its honest
         note at full size instead of shrunk into a corner.

         The reading set is deliberately Proven / Noise floor / Safe stack / Instruments read.
         04-test-approved.png draws READINESS, AVG FPS and 1% LOW here, and those are NOT adopted:
         the handoff names them as "the older duplicated Health metrics shown in an early generated
         draft", and the comp itself carries the caveat that its values are examples, not a licence.
         Those three numbers are Health's verdict and stay there; this room answers what the BENCH
         can prove, not what the machine scores. */
      aside={
        hud ? (
          <section className="lc-bench" aria-label={t("lab.labConsole.bench.aria")}>
            <div className="lc-stage" data-motion={reduced ? "reduced" : "full"} ref={stageRef}>
              <div className="lc-rig">
                {/* chromeless — just the recognizable 3D hologram; the bench frames it, so the
                    viewer's own control bar / caption / "add a part" form stay hidden (that form
                    lives in the station list now, where the comp puts it). */}
                <RigViewer
                  hw={hw}
                  chromeless
                  cameraDist={BENCH_CAMERA_DIST}
                  cameraTargetY={BENCH_CAMERA_TARGET_Y}
                  onSelectedIdChange={(_id, what) => setSelectedRig(what)}
                />
              </div>
              <ReticleCursor scopeRef={stageRef} />
            </div>
            {/* THE APPROVED RHYTHM (2026-08-27, Codex REJECT of 9bef1cc2). Four cells: ARC, NUMERAL,
                NUMERAL, ARC — and under each, exactly ONE supporting line. The rejected build drew
                four heavy rings and stacked a unit line AND a stamp AND a gloss under every one of
                them, which is why the strip read denser and taller than the composition it was
                copying. The arcs stay where a scale genuinely exists (proven-out-of-proven,
                applied-out-of-applicable); the raw magnitudes lose theirs, because any ceiling for
                a noise floor is invented and an invented ceiling drawn as an arc is a claim.

                One line, not two: a cell that has a FACT to state (`= all 8 applied`) states it, and
                a cell that has only provenance to state stamps MEASURED. They never both appear —
                `measured` is switched off exactly when a note is present. The label glosses the
                rejected build printed as a permanent fifth line ("= a change must beat this to
                count") are gone from the first viewport; the honest states they sat beside —
                NOT YET, NO READING, MEASURED — all survive untouched. */}
            <div className="lc-readings">
              <div className="lc-reading">
                {/* Proven — the room's entire payoff: how many changes this bench has verified
                    before/after (awards ledger, Keep verdicts only). Full ring once N > 0. No unit
                    word: the label already says what the number counts, and the comp's arcs carry
                    a bare number. */}
                <ArcGauge
                  label={t("lab.labConsole.provenLabel")}
                  value={provenCount}
                  max={Math.max(1, provenCount ?? 1)}
                  unit=""
                  tone="accent"
                  measured={provenCount != null}
                />
              </div>
              <div className="lc-reading">
                {/* Noise floor — the bench's own instrument constant: how big an effect this rig can
                    even resolve. A magnitude, so it prints as a numeral; the ± unit stays, because
                    dropping it would turn a tolerance into a score. */}
                <ArcGauge
                  label={t("lab.labConsole.noiseFloorLabel")}
                  value={noiseFloorPct}
                  max={10}
                  unit={t("lab.labConsole.unitPct")}
                  variant="numeral"
                  measured={noiseFloorPct != null}
                />
              </div>
              <div className="lc-reading">
                {/* Instruments read — how far through the bench this rig has gone. Same
                    stationHasReading the dock uses to mark nodes measured, so this and the dock can
                    never disagree. Always defined (no probe to await), never NOT-YET. Its one line
                    is the denominator, which says more than MEASURED could. */}
                <ArcGauge
                  label={t("lab.labConsole.instrumentsReadLabel")}
                  value={instrumentsRead}
                  max={Math.max(1, instrumentsTotal)}
                  /* NO UNIT. The label already ends in the word "read", so a "read" unit printed
                     INSTRUMENTS READ / READ under the ring -- the duplication the owner caught. */
                  unit=""
                  variant="numeral"
                  measured={false}
                  note={t("lab.labConsole.instrumentsReadNote", { read: instrumentsRead, total: instrumentsTotal })}
                />
              </div>
              <div className="lc-reading">
                {/* Two honest states over the same recs: work left → "N ready" (as before); nothing
                    left → "N on" with a full ring and an "all N applied" note. recs not loaded →
                    NOT-YET, never a fabricated 0 (bug→guard 2026-07-09, unchanged). */}
                <ArcGauge
                  label={t("lab.labConsole.safeStackLabel")}
                  value={fast.recs != null ? (safeReady > 0 ? safeReady : safeOn) : null}
                  max={Math.max(1, safeReady > 0 ? safeReady : safeOn)}
                  unit={safeReady > 0 ? t("lab.labConsole.unitReady") : t("lab.labConsole.unitOn")}
                  tone="accent"
                  measured={fast.recs != null && safeReady > 0}
                  note={
                    fast.recs != null && safeReady === 0
                      ? safeOn > 0
                        ? t("lab.labConsole.safeStackAllOn", { count: safeOn })
                        : t("lab.labConsole.safeStackNone")
                      : undefined
                  }
                />
              </div>
            </div>
            {/* THE RIG'S ANSWER — what the selected part reads right now. It left the bento with
                the grid but not the bench: it sits directly under the hologram that fills it, and
                it still carries an honest idle line rather than a fabricated reading. */}

              <div className="lc-evidence" aria-live="polite">
                {evidenceSubsystem ? (
                  <>
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
                  </>
                ) : evidenceFallback ? (
                  /* The two things that are NOT in the parts list — a fan, or a part the user added
                     himself. Same shape and same rails: a real rpm reading when a monitor is publishing
                     one, and otherwise a sentence saying why there is nothing to read. */
                  <>
                    <div className="lc-evidence-head">
                      <span className="lc-evidence-name">{evidenceFallback.subsystemLabel}</span>
                      <span className="lc-evidence-part">{evidenceFallback.name}</span>
                    </div>
                    {evidenceFallback.reading ? (
                      <dl className="lc-evidence-list">
                        <div className="lc-evidence-row">
                          <dt>{t("lab.labConsole.evidence.reading.fanSpeed")}</dt>
                          <dd>
                            <span className="lc-evidence-value">{evidenceFallback.reading}</span>
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="lc-evidence-empty">{evidenceFallback.note}</p>
                    )}
                  </>
                ) : null}
              </div>
          </section>
        ) : undefined
      }
      below={below}
    >
      {hud ? (
        <>
          {/* THE STATION LIST — every current station, in one grouped list, as the comp draws it:
              ruled document rows, not six equal buttons. Same <Dock>, same nodes, same
              aria-pressed, same click/focus handlers and the same tab order; `layout="list"` is a
              restyle of the node, because the handoff requires existing Dock keyboard behaviour to
              survive this room. */}
          <Dock
            nodes={dockNodes}
            activeKey={openStation}
            onOpen={onDockOpen}
            primaryEyebrow={t("lab.labConsole.startHere")}
            layout="list"
          />
          {/* ADD A PART COMPY CAN'T DETECT — the comp's last row in the list. A disclosure, never a
              removal: the form is the SAME <RigManualParts/> with the same synced hook state as the
              hologram beside it, and it stays MOUNTED when closed (`hidden`), so a part added here
              still draws in the model immediately and nothing about manual-parts behaviour moved. */}
          <button
            type="button"
            className="lc-route"
            aria-expanded={manualOpen}
            aria-controls="lab-manual-parts"
            onClick={() => setManualOpen((v) => !v)}
          >
            <span className="lc-route-ic" aria-hidden="true">
              +
            </span>
            <span className="lc-route-nm">{t("lab.labConsole.addPartRoute")}</span>
            <span className="lc-route-go" aria-hidden="true">
              &rsaquo;
            </span>
          </button>
          <div className="lc-manual" id="lab-manual-parts" hidden={!manualOpen}>
            <RigManualParts />
          </div>
        </>
      ) : (
        /* THE CLASSIC COMPOSITION — `compy_editorial` off, the devtools failsafe, unchanged from
           what it always was: the bento (reading · stage with its four CORNER gauges · parts you
           added) and the grid dock under it. This branch exists to still work when the new one does
           not, so it is never gated on anything the new one needs. */
        <div className="lab-console" data-motion={reduced ? "reduced" : "full"}>
          <BentoGrid>
          <BentoTile span="half" title={t("lab.labConsole.tiles.reading")}>
            <div className="lc-evidence" aria-live="polite">
              {evidenceSubsystem ? (
                <>
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
                </>
              ) : evidenceFallback ? (
                /* The two things that are NOT in the parts list — a fan, or a part the user added
                   himself. Same shape and same rails: a real rpm reading when a monitor is publishing
                   one, and otherwise a sentence saying why there is nothing to read. */
                <>
                  <div className="lc-evidence-head">
                    <span className="lc-evidence-name">{evidenceFallback.subsystemLabel}</span>
                    <span className="lc-evidence-part">{evidenceFallback.name}</span>
                  </div>
                  {evidenceFallback.reading ? (
                    <dl className="lc-evidence-list">
                      <div className="lc-evidence-row">
                        <dt>{t("lab.labConsole.evidence.reading.fanSpeed")}</dt>
                        <dd>
                          <span className="lc-evidence-value">{evidenceFallback.reading}</span>
                        </dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="lc-evidence-empty">{evidenceFallback.note}</p>
                  )}
                </>
              ) : null}
            </div>
          </BentoTile>
          <BentoTile span="hero" title={t("lab.labConsole.tiles.stage")}>
            <div className="lc-stage" data-motion={reduced ? "reduced" : "full"} ref={stageRef}>
              <div className="lc-corner lc-tl">
                {/* Proven — the room's entire payoff: how many changes this bench has verified
                    before/after (awards ledger, Keep verdicts only). Full ring once N > 0. */}
                <ArcGauge
                  label={t("lab.labConsole.provenLabel")}
                  value={provenCount}
                  max={Math.max(1, provenCount ?? 1)}
                  unit={t("lab.labConsole.unitKept")}
                  tone="accent"
                  measured={provenCount != null}
                  note={
                    provenCount != null
                      ? t(provenCount > 0 ? "lab.labConsole.provenNoteSome" : "lab.labConsole.provenNoteNone")
                      : undefined
                  }
                />
              </div>
              <div className="lc-corner lc-tr">
                {/* Noise floor — the bench's own instrument constant: how big an effect this rig can
                    even resolve. Fixed 10% display ceiling (a typical noise floor is a few percent;
                    this is a reading, not a graded score, so a rare spike just fills the ring). */}
                <ArcGauge
                  label={t("lab.labConsole.noiseFloorLabel")}
                  value={noiseFloorPct}
                  max={10}
                  unit={t("lab.labConsole.unitPct")}
                  measured={noiseFloorPct != null}
                  note={noiseFloorPct != null ? t("lab.labConsole.noiseFloorNote") : undefined}
                />
              </div>
              <div className="lc-corner lc-bl">
                {/* Two honest states over the same recs: work left → "N ready" (as before); nothing
                    left → "N on" with a full ring and an "= all N applied" note. recs not loaded →
                    NOT-YET, never a fabricated 0 (bug→guard 2026-07-09, unchanged). */}
                <ArcGauge
                  label={t("lab.labConsole.safeStackLabel")}
                  value={fast.recs != null ? (safeReady > 0 ? safeReady : safeOn) : null}
                  max={Math.max(1, safeReady > 0 ? safeReady : safeOn)}
                  unit={safeReady > 0 ? t("lab.labConsole.unitReady") : t("lab.labConsole.unitOn")}
                  tone="accent"
                  measured={fast.recs != null}
                  note={
                    fast.recs != null && safeReady === 0
                      ? safeOn > 0
                        ? t("lab.labConsole.safeStackAllOn", { count: safeOn })
                        : t("lab.labConsole.safeStackNone")
                      : undefined
                  }
                />
              </div>
              <div className="lc-corner lc-br">
                {/* Instruments read — how far through the bench this rig has gone. Same
                    stationHasReading the dock uses to mark nodes measured, so this and the dock can
                    never disagree. Always defined (no probe to await), never NOT-YET. */}
                <ArcGauge
                  label={t("lab.labConsole.instrumentsReadLabel")}
                  value={instrumentsRead}
                  max={Math.max(1, instrumentsTotal)}
                  /* NO UNIT. The label already ends in the word "read", so a "read" unit printed
                     INSTRUMENTS READ / READ under the ring -- the duplication the owner caught.
                     The note below still says how far through the bench this rig has gone. */
                  unit=""
                  note={t("lab.labConsole.instrumentsReadNote", { read: instrumentsRead, total: instrumentsTotal })}
                />
              </div>
              <div className="lc-rig">
                {/* chromeless — just the recognizable 3D hologram; the console frames it (brackets +
                    corner gauges), so the viewer's own control bar / caption / "add a part" form are
                    hidden (they collided with the corner gauges). */}
                <RigViewer
                  hw={hw}
                  chromeless
                  cameraDist={BENCH_CAMERA_DIST}
                  cameraTargetY={BENCH_CAMERA_TARGET_Y}
                  onSelectedIdChange={(_id, what) => setSelectedRig(what)}
                />
              </div>
              <ReticleCursor scopeRef={stageRef} />
            </div>
          </BentoTile>
          <BentoTile span="half" title={t("lab.labConsole.tiles.manual")}>
            <div className="lc-manual">
              <RigManualParts />
            </div>
          </BentoTile>
          </BentoGrid>
          <Dock
            nodes={dockNodes}
            activeKey={openStation}
            onOpen={onDockOpen}
            primaryEyebrow={t("lab.labConsole.startHere")}
          />
        </div>
      )}
      {openStation && (
        <BentoTile
          span="full"
          title={stations[openStation].name}
          badge={
            <button className="lc-detail-close" onClick={closeStation} aria-label={t("lab.labConsole.closeStationAriaLabel")}>
              {t("lab.labConsole.close")}
            </button>
          }
        >
          <div className="lc-detail" id="lab-console-detail" ref={detailRef}>
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
        </BentoTile>
      )}
    </RoomShell>
  );
}

export default LabConsole;
