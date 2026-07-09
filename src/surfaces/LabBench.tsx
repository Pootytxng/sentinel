import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { ParticleCard } from "../design/vendor/MagicBento/MagicBento";
import { useReducedMotion } from "../design/use-motion";
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
} from "../types";
import type { GpuVendor } from "./walkthroughs";
import "./lab-bench.css";

// LabBench — the Lab's face as THE INSTRUMENT BENCH (spec 2026-07-09-lab-redesign-direction-
// proposal, Phase 1, owner-approved): a bento grid of living station bays that REPLACES the linear
// numbered "ground spine". The bento primitive is the same vendored MagicBento ParticleCard used by
// LabBento, retinted to the theme accent (the vendor purple can never paint). The HERO bay is
// station 1 "Optimize" — the enable-all fast path, rendered INLINE (dominant 2×2 span). The
// measure/prove stations are compact door bays: clicking one opens exactly ONE detail panel below
// (the identical instrument body the classic Lab renders). Rendered by LabGround for the Lab tab
// ONLY when `compy_lab_ground` is on (DEFAULT OFF) — flag off, the untouched LabV2 renders, so the
// app is byte-identical.
//
// Phase 1 keeps the bays STATIC (enableTilt/enableMagnetism OFF) — the bolder cursor reactivity +
// staggered reveal land in Task 3, the data-reactive hero gauge in Task 4. Everything animated
// gates on the app's resolved reduced-motion ([[motion-on-by-default-override-os]]).

// Theme accent → "r, g, b" for the vendor's rgba() glow strings (same helper LabBento uses; kept
// local so LabBento stays untouched). A parse failure falls back to neutral gray — the vendor
// purple (132,0,255) can never paint.
function accentRgb(el: HTMLElement): string {
  const raw = getComputedStyle(el).getPropertyValue("--ix-accent").trim();
  const hex = /^#([0-9a-f]{6})$/i.exec(raw);
  if (hex) {
    const n = parseInt(hex[1], 16);
    return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(raw);
  if (rgb) return `${rgb[1]}, ${rgb[2]}, ${rgb[3]}`;
  return "160, 160, 160";
}

const GLOW_RADIUS = 260;

export function LabBench({
  fast,
  diagnostics,
  diagnosticsCaptured = false,
  vendor = "any",
}: {
  // The fast-path prop bundle — the SAME audited apply handlers the OptimizeV2 room gets (zero new
  // IPC, zero new mutation primitive). Threaded straight into the hero bay's <OptimizeStation>.
  fast: LabFastPathProps;
  diagnostics?: ReactNode;
  // Whether the system report behind the Diagnostics bay actually has sections (never claim
  // "Measured" for an empty report).
  diagnosticsCaptured?: boolean;
  vendor?: GpuVendor;
}) {
  const reduced = useReducedMotion();

  // v1 ships the AMD undervolt guide only (locked rule #5) — Tuning is a bay only on AMD.
  const tuningGuide = tuningGuideForVendor(vendor);

  // The measure-station reads — the SAME on-mount probes Lab does (no polling, ZERO new IPC). Seed
  // from the probe cache so re-opening the bench paints last-known instantly. LabBench owns these
  // now that it is the ground face (Lab's `ground` mode is dead code post-Instrument-Bench).
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

  // Detail view — exactly ONE measure station open at a time (the grid IS the menu). Clicking a bay
  // opens it, clicking again closes, clicking another swaps. The hero (Optimize) is always inline,
  // never a door.
  const [openStation, setOpenStation] = useState<LabStationKey | null>(null);
  const openMeasure = (k: LabStationKey) => {
    setOpenStation((cur) => (cur === k ? null : k));
    requestAnimationFrame(() => {
      document
        .getElementById("lab-bench-detail")
        ?.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
    });
  };

  // The identical instrument bodies the classic Lab renders — one source for both layouts. (No
  // "optimize" case: the hero bay renders <OptimizeStation> inline, above.)
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

  // Accent glow color, computed from the mounted grid so it tracks the live theme.
  const gridRef = useRef<HTMLDivElement>(null);
  const [rgb, setRgb] = useState("160, 160, 160");
  useEffect(() => {
    if (gridRef.current) setRgb(accentRgb(gridRef.current));
  }, []);

  // Cursor-following border glow (the vendor GlobalSpotlight's per-card math, minus its
  // body-appended screen-blend overlay — too loud for the instrument voice). Pointer-driven custom
  // props only; skipped entirely under reduced motion.
  useEffect(() => {
    if (reduced) return;
    const grid = gridRef.current;
    if (!grid) return;
    const proximity = GLOW_RADIUS * 0.5;
    const fade = GLOW_RADIUS * 0.75;
    const cardsOf = () => grid.querySelectorAll<HTMLElement>(".lab-bench-card");
    const onMove = (e: PointerEvent) => {
      cardsOf().forEach((card) => {
        const r = card.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = Math.hypot(e.clientX - cx, e.clientY - cy) - Math.max(r.width, r.height) / 2;
        const eff = Math.max(0, d);
        const glow = eff <= proximity ? 1 : eff <= fade ? (fade - eff) / (fade - proximity) : 0;
        card.style.setProperty("--glow-x", `${((e.clientX - r.left) / r.width) * 100}%`);
        card.style.setProperty("--glow-y", `${((e.clientY - r.top) / r.height) * 100}%`);
        card.style.setProperty("--glow-intensity", glow.toFixed(3));
      });
    };
    const onLeave = () => {
      cardsOf().forEach((c) => c.style.setProperty("--glow-intensity", "0"));
    };
    grid.addEventListener("pointermove", onMove);
    grid.addEventListener("pointerleave", onLeave);
    return () => {
      grid.removeEventListener("pointermove", onMove);
      grid.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced]);

  const glowStyle = { "--glow-rgb": rgb } as CSSProperties;

  return (
    <div className="lab-bench">
      {/* The needle rule: the read-only promise leads the room, so nobody's afraid to poke. The
          hero is the one place that changes your PC — and it snapshots its undo first. */}
      <p className="lab-bench-lede">
        Your rig's instrument bench. Everything past the first bay only <em>reads</em> — measure
        freely. The one tap that changes anything captures its undo first.
      </p>

      <div className="lab-bench-grid" ref={gridRef} data-motion={reduced ? "reduced" : "full"}>
        {/* HERO bay — station 1 "Optimize" (the enable-all fast path), rendered inline as the
            dominant bay. Phase 1: spotlight/glow only, no tilt (tilting a form-filled hero is
            nauseating and breaks click targets) — the bolder tilt/magnetism lands on the compact
            measure doors in Task 3. */}
        {showOptimize && (
          <ParticleCard
            className="lab-bench-card lab-bench-hero"
            style={{ ...glowStyle, "--bay-i": 0 } as CSSProperties}
            disableAnimations={reduced}
            particleCount={6}
            glowColor={rgb}
            enableTilt={false}
            enableMagnetism={false}
            clickEffect={false}
          >
            <div className="lab-bench-hero-head">
              <span className="lab-bench-n">01</span>
              <span className="lab-bench-hero-name">{LAB_STATIONS.optimize.name}</span>
              <span className="lab-bench-hero-for">{LAB_STATIONS.optimize.forLine}</span>
            </div>
            <div className="lab-bench-hero-body">
              <OptimizeStation {...fast} />
            </div>
          </ParticleCard>
        )}

        {/* MEASURE bays — the read-only prove-it stations as compact doors. Phase 1 static
            (tilt/magnetism OFF); Task 3 turns them alive. */}
        {measureKeys.map((k, i) => {
          const n = (showOptimize ? 1 : 0) + i + 1;
          const hasReading = stationHasReading(k, facts);
          return (
            <ParticleCard
              key={k}
              className="lab-bench-card lab-bench-measure"
              style={{ ...glowStyle, "--bay-i": n } as CSSProperties}
              disableAnimations={reduced}
              particleCount={5}
              glowColor={rgb}
              // Task 3 — the JARVIS reactivity the owner missed: small tilt + magnetism on the
              // compact doors (the vendor's built-in low factors), motion-branch only. The hero
              // stays tilt-free (tilting a form-filled bay is nauseating).
              enableTilt={!reduced}
              enableMagnetism={!reduced}
              clickEffect={!reduced}
            >
              <button
                className="lab-bench-door"
                data-reactive={reduced ? "off" : "on"}
                onClick={() => openMeasure(k)}
                aria-label={`Open station ${n} — ${LAB_STATIONS[k].name}`}
                aria-pressed={openStation === k}
              >
                <span className="lab-bench-top">
                  <span className="lab-bench-n">{String(n).padStart(2, "0")}</span>
                  <span
                    className={`lab-bench-led ${hasReading ? "lab-bench-led-read" : ""}`}
                    aria-hidden="true"
                  />
                  <span className="lab-bench-state">{hasReading ? "Measured" : "Not yet"}</span>
                </span>
                <span className="lab-bench-name">{LAB_STATIONS[k].name}</span>
                <span className="lab-bench-for">{LAB_STATIONS[k].forLine}</span>
              </button>
            </ParticleCard>
          );
        })}
      </div>

      {/* Detail — the ONE open measure station (header + the identical instrument body). Close
          returns to the bench. */}
      {openStation && (
        <div
          className="lab-card lab-bench-detail"
          id="lab-bench-detail"
          data-instrument={LAB_STATIONS[openStation].name}
        >
          <div className="lab-bench-detail-head">
            <span className="lab-bench-detail-name">{LAB_STATIONS[openStation].name}</span>
            <button
              className="lab-bench-detail-close"
              onClick={() => setOpenStation(null)}
              aria-label="Close station"
            >
              Close
            </button>
          </div>
          <div className="lab-card-body">{stationBody(openStation)}</div>
        </div>
      )}
    </div>
  );
}

export default LabBench;
