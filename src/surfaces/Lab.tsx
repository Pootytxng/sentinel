import { Fragment, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  AppliedChange,
  BenchmarkState,
  BlackBoxReport,
  LatencyReport,
  Verdict,
  SessionSummary,
  ArmedComparison,
  ComparisonResult,
} from "../types";
import { changesBetweenRuns } from "./benchmark-view";
import { BenchmarkTab } from "./Benchmark";
import { LatencyTab } from "./Latency";
import { peekProbe, cachedProbe } from "../data/probe-cache";
import { BlackBox } from "./BlackBox";
import { tuningGuideForVendor } from "../data/tuning-guides";
import { measureTuning, tuningEvidence } from "../data/tuning-measure";
import { labLatestReadings } from "./lab-v2-data";
import {
  LAB_ROUTER,
  LAB_ROUTER_LEAD_OPTIMIZE,
  LAB_STATION_ORDER,
  LAB_STATIONS,
  stationReading,
  type LabStationKey,
} from "./lab-guided-data";
import { readLabGuided, readLabBento } from "../design/theme";
import { useReducedMotion } from "../design/use-motion";
import { LabBento } from "./LabBento";
import { TuningInstrument } from "./TuningInstrument";
import { OptimizeStation, type LabFastPathProps } from "./lab/OptimizeStation";
import { safeFixesReady } from "./optimize-v2-data";
import { deriveReverted } from "./use-scan";
import { type GpuVendor } from "./walkthroughs";
import "./Lab.css";

// LAB — the measured instruments, visible to everyone (halfway-home §1: navigation never teleports).
// Each instrument is an INLINE collapsible section ON Lab — summary header + expand reveals the full
// existing Benchmark/Latency UI right here (no route to another tab). Existing commands only.

const VERDICT_LABEL: Record<Verdict, string> = {
  improved: "Improved",
  "no-measurable-change": "No measurable change",
  regressed: "Regressed",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

// One-time-seen flag for the welcome band (mirrors compy_sessions_seen_v1 in App.tsx): the band names
// every instrument a second time over the cards below it, so once the reader has opened ANY instrument
// — they've found the doors — it folds away. A truly first-ever visit still gets the signpost.
const WELCOME_SEEN_KEY = "compy_lab_welcome_seen_v1";
function readWelcomeSeen(): boolean {
  try {
    return localStorage.getItem(WELCOME_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

export default function Lab({
  diagnostics,
  vendor = "any",
  v2 = false,
  onBenchState,
  diagnosticsCaptured = false,
  ground = false,
  fast,
  changes,
}: {
  diagnostics?: ReactNode;
  vendor?: GpuVendor;
  // V2 shell composition (V2-7, spec 2026-07-02-v2-shell-sourcing-and-plan): the room shell
  // provides the ONE room summary via RoomShell, so the standalone head (title + read-only
  // promise + benchmark chip) yields to it (one-mention law). Absent = classic, byte-identical
  // (test-pinned). The benchmark state feeds the room verdict up through onBenchState instead
  // of a second get_benchmark_state read.
  v2?: boolean;
  onBenchState?: (bench: BenchmarkState) => void;
  // Whether the system report behind the diagnostics slot actually has sections (fill pass,
  // spec 2026-07-05) — the strip must never claim "captured" for an empty report.
  diagnosticsCaptured?: boolean;
  // Proving-ground mode (spec 2026-07-08-lab-proving-ground, phase 1): rendered ONLY inside the
  // merged LabGround room (behind `compy_lab_ground`, DEFAULT OFF). Collapses the three nav idioms
  // into ONE slim linear spine — the intake router as front door + the numbered station
  // progression — suppressing bento/guided/classic/welcome/readings. Additive: `ground` defaults
  // false, so every existing (flag-off) render path is byte-identical (test-pinned). Same
  // instruments, same reads — the merged room just leads with the tweaks and offers the
  // measure→prove utility beside them.
  ground?: boolean;
  // The fast-path prop bundle (§8.3) — the SAME audited apply handlers the OptimizeV2 room gets.
  // Used ONLY in `ground` mode to render station 1's <OptimizeStation> body + derive its live
  // reading; every non-ground path leaves it undefined and never reads it (byte-identity holds by
  // construction). Optional so classic/guided/bento callers pass nothing.
  fast?: LabFastPathProps;
  // App's Trust Ledger (combined-effect honesty, panel-review brief 2026-07-15 §2): the benchmark
  // station reading needs it to tell one change's win from a stack's. Ground mode already carries
  // the same list inside `fast.changes` — this prop is for the non-ground faces (LabV2 → bento).
  changes?: AppliedChange[];
}) {
  // Seed from the probe cache so re-opening Advanced paints last-known instantly instead of cold-
  // re-running get_latency_diagnostics (a synchronous MSI/timer/USB scan) every visit.
  const [bench, setBench] = useState<BenchmarkState | null>(() => peekProbe("benchmark-state") ?? null);
  const [latency, setLatency] = useState<LatencyReport | null>(() => peekProbe("latency-diag") ?? null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [armed, setArmed] = useState<ArmedComparison | null>(null);
  const [latestCmp, setLatestCmp] = useState<ComparisonResult | null>(null);
  // Black Box is on-demand — null until the user scans this visit (the strip shows an honest "—").
  const [bbReport, setBbReport] = useState<BlackBoxReport | null>(null);
  // Welcome band: shown on a truly first-ever visit, hidden once any instrument has been opened.
  const [welcomeSeen, setWelcomeSeen] = useState(readWelcomeSeen);
  // Guided bench (spec 2026-07-05-lab-linear-guided-bench, DEFAULT OFF): router + numbered
  // stations + walk-through around the SAME instruments. Live-reactive so the Settings preview
  // toggle re-renders an already-mounted Lab without a reload (same pattern as living-changed).
  const [guided, setGuided] = useState(readLabGuided);
  useEffect(() => {
    const onChange = () => setGuided(readLabGuided());
    window.addEventListener("compy:lab-guided-changed", onChange);
    return () => window.removeEventListener("compy:lab-guided-changed", onChange);
  }, []);
  // Bento checkup face (spec 2026-07-05-lab-bento-checkup, DEFAULT OFF): the station grid +
  // checkup report replace the router/welcome as the room's face; the stations render below in
  // the guided numbered form (the grid's left→right order continues into the bench). Same
  // live-reactive pattern as the guided flag. Bento subsumes the router when both are on.
  const [bento, setBento] = useState(readLabBento);
  useEffect(() => {
    const onChange = () => setBento(readLabBento());
    window.addEventListener("compy:lab-bento-changed", onChange);
    return () => window.removeEventListener("compy:lab-bento-changed", onChange);
  }, []);
  const reduced = useReducedMotion();
  // Router → station jump: an incrementing pulse per station tells that LabSection to expand
  // (in-room scroll + expand — navigation never teleports). Jumping through the router counts as
  // finding a door, same as clicking the card head.
  const [pulses, setPulses] = useState<Partial<Record<LabStationKey, number>>>({});
  // Bento detail view (owner feedback 2026-07-05: the grid IS the menu — a second standing list
  // of the same five stations below it is clutter). Exactly ONE station renders at a time:
  // clicking a card opens it, clicking again closes, clicking another swaps.
  const [openStation, setOpenStation] = useState<LabStationKey | null>(null);
  const openBentoStation = (k: LabStationKey) => {
    markInstrumentOpened();
    setOpenStation((cur) => (cur === k ? null : k));
    requestAnimationFrame(() => {
      document
        .getElementById("lab-bento-detail")
        ?.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
    });
  };
  const jumpToStation = (k: LabStationKey) => {
    markInstrumentOpened();
    setPulses((p) => ({ ...p, [k]: (p[k] ?? 0) + 1 }));
    requestAnimationFrame(() => {
      const el = document.getElementById(`lab-station-${k}`);
      el?.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "start" });
    });
  };
  const markInstrumentOpened = () => {
    if (welcomeSeen) return;
    setWelcomeSeen(true);
    try {
      localStorage.setItem(WELCOME_SEEN_KEY, "1");
    } catch {
      /* localStorage unavailable — band just won't persist its hidden state */
    }
  };

  // v1 ships the AMD GPU undervolt guide only — the hardware-verified path (locked rule #5). No tuning
  // instrument on non-AMD rigs until their own verified-sensor gate (NVIDIA NVML, Intel, Ryzen PBO).
  const tuningGuide = tuningGuideForVendor(vendor);

  // Recent-results summary — existing commands, read once on mount (no polling, ZERO new IPC).
  useEffect(() => {
    cachedProbe("benchmark-state", () => invoke<BenchmarkState>("get_benchmark_state"), 30_000)
      .then((b) => {
        setBench(b);
        onBenchState?.(b); // feed the V2 room verdict — same read, no second IPC
      })
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
  // §A tailoring gate (spec 2026-06-12): the undervolt OFFER inside the instrument requires
  // measured headroom evidence from this rig; the section itself stays (it's also the gauge for
  // a tune the user already did). Vendor gating remains tuningGuideForVendor (rule #5).
  const tuningEvidenceVerdict = tuningEvidence(sessions);

  const benchSummary = bench
    ? bench.efficacy
      ? `Last verdict: ${VERDICT_LABEL[bench.efficacy.overall]}`
      : bench.baseline
        ? `Baseline set${bench.baseline_at ? ` · ${fmtDate(bench.baseline_at)}` : ""}`
        : "No baseline yet"
    : "—";

  // Promote the most meaningful at-a-glance signal to the Lab header: the last benchmark verdict, if
  // one exists. Existing data only — absent (no chip) when no benchmark has been graded yet (honest "—"
  // lives on the card itself). Read-only, no fabrication.
  const benchVerdict = bench?.efficacy ? VERDICT_LABEL[bench.efficacy.overall] : null;

  const latencySummary = latency
    ? `MSI ${latency.msi.msi_on} on · ${latency.msi.msi_off} off${
        latency.timer_current_ms != null ? ` · timer ${latency.timer_current_ms.toFixed(2)}ms` : ""
      }`
    : "—";

  const tuningSummary = measurement ? measurement.headline : "Undervolt guide + stability";

  // Guided bench: the stations this rig actually has, in the §B diagnostic order. The Tuning and
  // Diagnostics gates are the SAME ones the classic path uses (vendor + slot content) — the flag
  // never adds or removes an instrument, it only orders and signposts them.
  const stationKeys = LAB_STATION_ORDER.filter(
    (k) => (k !== "tuning" || !!tuningGuide) && (k !== "diagnostics" || !!diagnostics),
  );

  // §8 the blended spine — station 1 "Optimize" is prepended to the spine in GROUND mode only, and
  // only when there are tweaks to offer (recs loaded + non-empty). This is the ONLY place the
  // measure order gains a member; non-ground faces use the untouched 5-station `stationKeys`, so
  // classic/guided/bento are byte-identical by construction.
  const showOptimize = ground && !!fast?.recs && fast.recs.length > 0;
  // Ground spine: optimize (when there are tweaks) leads, the measure stations follow. Non-ground
  // faces use the untouched 5-station measure order, so classic/guided/bento are byte-identical.
  const spineKeys: LabStationKey[] = ground
    ? [...(showOptimize ? (["optimize"] as LabStationKey[]) : []), ...stationKeys]
    : stationKeys;
  // The intake router, ground-only lead prepended so "just make it fast" is the first choice.
  const routerRows = showOptimize ? [LAB_ROUTER_LEAD_OPTIMIZE, ...LAB_ROUTER] : LAB_ROUTER;
  // Station 1's live reading (§8.1) — the SAME measured count the room verdict shows (safeFixesReady
  // over the same recs, excluding drifted). Derived here, zero new IPC.
  const groundReverted = deriveReverted(fast?.changes ?? []);
  const safeReady =
    fast?.recs != null
      ? safeFixesReady(
          fast.recs,
          fast.isAppliable ?? (() => false),
          new Set(groundReverted.map((r) => r.rec_id)),
        )
      : 0;
  const stackApplied = showOptimize && safeReady === 0;
  // Combined-effect honesty (panel-review brief 2026-07-15 §2): Trust Ledger changes inside the
  // graded window — the SAME window labVerdict/the efficacy card filter by, so every rendering of
  // this result agrees on whose win it is. Ground carries the ledger in fast.changes; the
  // non-ground faces get it via the changes prop (LabV2 threads App's list down).
  const stackedCount = changesBetweenRuns(bench, changes ?? fast?.changes ?? []).length;

  // The identical instrument bodies the classic path renders — one source for both layouts. Station
  // 1 "Optimize" renders the fast-path apply surface (ground mode only; `fast` is present there).
  const stationBody = (k: LabStationKey): ReactNode => {
    switch (k) {
      case "optimize":
        return fast ? <OptimizeStation {...fast} /> : null;
      case "diagnostics":
        return diagnostics;
      case "benchmark":
        // In the proving ground, Benchmark is the "prove it" station — the Two Futures measured
        // split (per-part efficacy emphasis) is its payoff, so surface it regardless of the
        // standalone compy_two_futures flag (§2). Non-ground keeps the flag-gated behavior.
        return <BenchmarkTab provingGround={ground} />;
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

  return (
    <section
      className="lab-root"
      data-guided={(!ground && (guided || bento)) || undefined}
      data-bento={(!ground && bento) || undefined}
      data-ground={ground || undefined}
    >
      <div className="lab-dotgrid" aria-hidden="true" />
      <div className="lab-inner">
        {/* Under the V2 shell the RoomShell verdict is the ONE summary — the standalone head
            (title + read-only promise + benchmark chip) yields to it (one-mention law). */}
        {!v2 && (
        <header className="lab-head">
          <div className="lab-head-row">
            <h2 className="lab-title">Advanced</h2>
            {/* The last benchmark verdict — the room's most meaningful at-a-glance signal — surfaced
                on the header so it's read before any scrolling. Existing data only; absent when none. */}
            {benchVerdict && (
              <span className="lab-head-bench">
                Last benchmark: <strong>{benchVerdict}</strong>
              </span>
            )}
          </div>
          <p className="lab-sub">
            Your rig's instrument panel. Everything here only measures — nothing in Advanced
            changes your PC. Start with Benchmark.
          </p>
        </header>
        )}

        {/* Bento checkup face (flag-on): station cards left→right in bench order + the
            synthesized checkup report. Cards are doors onto the SAME router jump the guided
            rows use; the grid subsumes the router (one navigation idiom per room). */}
        {bento && !ground && (
          <LabBento
            keys={stationKeys}
            facts={{
              bench,
              latency,
              tuningHeadline: measurement?.headline ?? null,
              crash: bbReport,
              diagnosticsCaptured,
              // Bento is non-ground → no optimize card; the fields are inert here.
              safeReady: 0,
              stackApplied: false,
              stackedCount,
            }}
            onOpen={openBentoStation}
            openStation={openStation}
          />
        )}

        {/* Bento detail — ONE station at a time (owner feedback: no duplicate standing list
            under the grid). Header + the identical instrument body; close returns to the menu. */}
        {bento && !ground && openStation && (
          <div
            className="lab-card lab-bento-detail"
            id="lab-bento-detail"
            data-instrument={LAB_STATIONS[openStation].name}
          >
            <div className="lab-bento-detail-head">
              <span className="lab-station-num" aria-hidden="true">
                {stationKeys.indexOf(openStation) + 1}
              </span>
              <svg
                className="lab-card-icon"
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                {ICONS[STATION_ICON[openStation]]}
              </svg>
              <span className="lab-bento-detail-name">{LAB_STATIONS[openStation].name}</span>
              <button
                className="lab-bento-detail-close"
                onClick={() => setOpenStation(null)}
                aria-label="Close station"
              >
                Close
              </button>
            </div>
            <div className="lab-card-body">{stationBody(openStation)}</div>
          </div>
        )}

        {/* "What are you here to do?" — the plain-language router leads the guided bench
            (deslop directive #1: the walk-the-bench step-through was redundant with the station
            contract lines and is gone; asking what you're here to do and jumping you straight to
            the right tool IS the guided experience). Rows are doors — click scrolls to and
            expands that station in place (never teleports). Filtered to the stations this rig
            has, so a row can never point at a missing tool. Proving-ground (`ground`) mode reuses
            this exact front door — the one intake idiom for the merged room. */}
        {((guided && !bento) || ground) && (
          <nav className="lab-router" aria-label="What are you here to do?">
            <div className="lab-router-title">What are you here to do?</div>
            <p className="lab-router-sub">
              Pick the line that sounds like you — it opens the right tool below.
            </p>
            {routerRows.filter((r) => spineKeys.includes(r.station)).map((r) => (
              <button
                key={r.station}
                className="lab-router-row cmp-door"
                onClick={() => jumpToStation(r.station)}
              >
                <span className="lab-router-symptom">“{r.symptom}”</span>
                <span className="lab-router-station">{LAB_STATIONS[r.station].name}</span>
                <span className="lab-router-because">{r.because}</span>
                <span className="cmp-door-chevron cmp-door-chevron-end" aria-hidden="true">▸</span>
              </button>
            ))}
          </nav>
        )}

        {/* Welcome band — a static signpost for newcomers (bathroom law): what each instrument
            answers, in plain words. Deliberately KNOBLESS (doorknob law): no cmp-door, no click
            handler — the instrument cards below stay the only doors in the room. Folds away once the
            reader has opened any instrument (welcomeSeen): it just renames the cards below it.
            Guided bench: hidden — every station's own contract lines carry the same signposting,
            so the band would state each instrument's purpose twice on one screen. */}
        {!welcomeSeen && !guided && !bento && !ground && (
        <div className="lab-welcome">
          <span className="lab-welcome-row">
            <span className="lab-welcome-term">Benchmark</span>
            <span className="lab-welcome-gloss">did a change actually move anything?</span>
          </span>
          <span className="lab-welcome-row">
            <span className="lab-welcome-term">Latency</span>
            <span className="lab-welcome-gloss">what's slowing the trip from mouse to screen?</span>
          </span>
          {tuningGuide && (
            <span className="lab-welcome-row">
              <span className="lab-welcome-term">Tuning</span>
              <span className="lab-welcome-gloss">did your AMD undervolt hold up?</span>
            </span>
          )}
          {diagnostics && (
            <span className="lab-welcome-row">
              <span className="lab-welcome-term">Diagnostics</span>
              <span className="lab-welcome-gloss">the raw facts Compy read about this rig.</span>
            </span>
          )}
          <span className="lab-welcome-row">
            <span className="lab-welcome-term">Black Box</span>
            <span className="lab-welcome-gloss">what crashed or froze — read Windows' own record, in plain English.</span>
          </span>
        </div>
        )}

        {/* Guided bench (flag-on): the same five instruments as numbered stations in the
            diagnostic order — know your rig → measure change → chase input lag → tame heat →
            explain a failure. Each station wraps the IDENTICAL instrument body the classic path
            renders (same components, same reads); only the header contract around them is new.
            Numbering is computed over the stations this rig actually has (vendor/diagnostics
            gates unchanged) — never hardcoded. */}
        {((guided && !bento) || ground) &&
          spineKeys.map((k, i) => (
            <Fragment key={k}>
              <LabSection
                icon={STATION_ICON[k]}
                name={LAB_STATIONS[k].name}
                anchorId={`lab-station-${k}`}
                openPulse={pulses[k]}
                // Station 1 "Optimize" is the fast path the owner came for — it LEADS open so the
                // enable-all hero is visible without a click (Directive 2); the measure stations
                // stay collapsed accordions. Shared card frame + number + contract = one spine.
                defaultOpen={k === "optimize"}
                station={{
                  n: i + 1,
                  forLine: LAB_STATIONS[k].forLine,
                  whenLine: LAB_STATIONS[k].whenLine,
                  readingLine: stationReading(k, {
                    bench,
                    latency,
                    tuningHeadline: measurement?.headline ?? null,
                    crash: bbReport,
                    diagnosticsCaptured,
                    safeReady,
                    stackApplied,
                    stackedCount,
                  }),
                  connectsLine: LAB_STATIONS[k].connectsLine,
                }}
                onFirstOpen={markInstrumentOpened}
              >
                {stationBody(k)}
              </LabSection>
            </Fragment>
          ))}

        {!guided && !bento && !ground && (
        <>
        <LabSection
          icon="chart"
          name="Benchmark"
          oneLiner="Run it, change one thing, re-run — Compy tells you if it actually moved, honestly."
          summary={benchSummary}
          onFirstOpen={markInstrumentOpened}
        >
          <BenchmarkTab />
        </LabSection>

        {/* Black Box (Paramedic Mode) — READ-ONLY crash/freeze evidence reader. On-demand scan of
            the record Windows already keeps + Compy's own last-vitals overlay. Zero causal claims.
            Promoted to slot 2 (after Benchmark): it's the instrument you reach for in a crisis, so it
            shouldn't be buried last. Sections are independent inline collapsibles — order is purely
            presentational, no logic depends on it. */}
        <LabSection
          icon="blackbox"
          name="Black Box"
          oneLiner="Read the crash and freeze evidence Windows recorded — plain English, with your last vitals."
          summary="Crash & freeze record"
          onFirstOpen={markInstrumentOpened}
        >
          <BlackBox onReport={setBbReport} />
        </LabSection>

        <LabSection
          icon="pulse"
          name="Latency"
          oneLiner="The path from your mouse to the screen — Compy names what's adding delay."
          summary={latencySummary}
          onFirstOpen={markInstrumentOpened}
        >
          <LatencyTab />
        </LabSection>

        {/* Tuning — the guide (shared single source) + the read-only stability/thermal readout that
            measures whether a vendor-tool undervolt actually held up. AMD-only in v1 (the verified
            sensor path). A gauge, not a control — nothing here changes the system. */}
        {tuningGuide && (
          <LabSection
            icon="tune"
            name="Tuning"
            oneLiner="Undervolt in AMD's own tool — Compy measures whether temps dropped and frames held."
            summary={tuningSummary}
            onFirstOpen={markInstrumentOpened}
          >
            <TuningInstrument
              guide={tuningGuide}
              vendor={vendor}
              measurement={measurement}
              recentSessions={sessions.slice(0, 5)}
              evidence={tuningEvidenceVerdict}
            />
          </LabSection>
        )}

        {/* Diagnostics — read-only forensics, re-homed into Lab as a third instrument (one-rail §1). */}
        {diagnostics && (
          <LabSection
            icon="terminal"
            name="Diagnostics"
            oneLiner="Read-only system forensics — what Compy detected about this rig, raw."
            summary="System report"
            onFirstOpen={markInstrumentOpened}
          >
            {diagnostics}
          </LabSection>
        )}
        </>
        )}

        {/* Latest readings (fill pass, spec 2026-07-05): ONE quiet foot-of-room strip consolidating
            the newest value per instrument — an at-a-glance overview over the SAME reads the cards
            above already made (zero new IPC). V2 rooms only; classic Lab renders untouched.
            Guided bench: absent — each station's "what the reading means" line carries the same
            live value, so the strip would state every reading twice (superseded per the spec). */}
        {v2 && !guided && !bento && !ground && (
          <div className="lab-readings">
            <span className="lab-readings-k">Latest readings</span>
            {labLatestReadings({
              bench,
              latency,
              tuning: { present: !!tuningGuide, headline: measurement?.headline ?? null },
              crash: bbReport,
              diagnostics: { present: !!diagnostics, captured: diagnosticsCaptured },
            }).map((r) => (
              <span className="lab-reading" key={r.label}>
                <span className="lab-reading-l">{r.label}</span>
                <span className="lab-reading-v">{r.value}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

// Station → icon, reusing the exact glyphs the classic cards wear (same instrument, same face).
const STATION_ICON: Record<LabStationKey, string> = {
  optimize: "bolt",
  diagnostics: "terminal",
  benchmark: "chart",
  latency: "pulse",
  tuning: "tune",
  blackbox: "blackbox",
};

const ICONS: Record<string, ReactNode> = {
  // Bolt — station 1 "Optimize": one tap, the safe stack goes live.
  bolt: <path d="M13 2L5 14h6l-1 8 8-12h-6l1-8z" />,
  chart: (
    <>
      <line x1="4" y1="20" x2="20" y2="20" />
      <rect x="5.5" y="11" width="3" height="7" />
      <rect x="10.5" y="7" width="3" height="11" />
      <rect x="15.5" y="13" width="3" height="5" />
    </>
  ),
  pulse: <path d="M3 12h4l2-6 4 12 2-6h6" />,
  tune: (
    <>
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9" cy="8" r="2.4" />
      <circle cx="15" cy="16" r="2.4" />
    </>
  ),
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3" />
      <line x1="13" y1="15" x2="17" y2="15" />
    </>
  ),
  // Flight-recorder: a sturdy box with a recorded pulse line inside — "records what happened,
  // read it after." Matches the Black Box metaphor (evidence, not magic).
  blackbox: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M6 12h2l1.5-3 2 6 1.5-3H18" />
    </>
  ),
};

// The four-line station contract (guided bench §B). Line 3 is live — the same value the
// instrument body shows — so the header can never disagree with the instrument under it.
type StationContract = {
  n: number;
  forLine: string;
  whenLine: string;
  readingLine: string;
  connectsLine: string;
};

function LabSection({
  icon,
  name,
  oneLiner,
  summary,
  station,
  anchorId,
  openPulse,
  children,
  onFirstOpen,
  defaultOpen,
}: {
  icon: string;
  name: string;
  // Classic face (one-liner + summary chip). Absent on the guided face — their facts live in the
  // station contract lines instead (the same fact never renders twice on one card).
  oneLiner?: string;
  summary?: string;
  // Guided face: the numbered four-line station contract, rendered above the instrument body.
  station?: StationContract;
  anchorId?: string;
  // Router jump: each increment forces this section open (never closed) — the router's "take me
  // to my tool" is an expand, not a toggle.
  openPulse?: number;
  children: ReactNode;
  // Fired the FIRST time this section is expanded — lets Lab retire the welcome band once the reader
  // has found a door. Opt-in (undefined = no-op), so the section stays a self-contained collapsible.
  onFirstOpen?: () => void;
  // §8: station 1 "Optimize" starts EXPANDED so the enable-all hero leads without a click; every
  // other station stays collapsed. Still a real toggle — the user can fold the hero away.
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!defaultOpen);
  const toggle = () =>
    setOpen((o) => {
      if (!o) onFirstOpen?.(); // opening (not closing) is the "found a door" signal
      return !o;
    });
  // A router jump expands (never collapses) the target station. The caller already counted the
  // jump as "found a door", so onFirstOpen isn't re-fired here.
  useEffect(() => {
    if (openPulse) setOpen(true);
  }, [openPulse]);
  return (
    <div
      className={`lab-card ${open ? "lab-card-open" : ""}`}
      data-instrument={name}
      id={anchorId}
    >
      {/* WAI-ARIA accordion: the toggle button is wrapped in a native heading so screen-reader
          users get the instrument list as a navigable h3 structure (under Lab's h2). `font: inherit`
          + `margin: 0` on .lab-card-heading keep the visual byte-identical to a bare button. */}
      <h3 className="lab-card-heading">
        <button className="lab-card-head cmp-door" onClick={toggle} aria-expanded={open}>
          {station && (
            <span className="lab-station-num" aria-label={`Station ${station.n}`}>
              {station.n}
            </span>
          )}
          <svg
            className="lab-card-icon"
            viewBox="0 0 24 24"
            width="22"
            height="22"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {ICONS[icon]}
          </svg>
          <span className="lab-card-text">
            <span className="lab-card-name">{name}</span>
            {oneLiner && <span className="lab-card-oneliner">{oneLiner}</span>}
          </span>
          {summary && <span className="lab-card-summary">{summary}</span>}
          <span className="cmp-door-chevron cmp-door-chevron-end" aria-hidden="true">▸</span>
        </button>
      </h3>
      {/* The four-line station contract — always visible on the card face (it's the signpost),
          above the expandable instrument body. Static text + the live reading line; KNOBLESS
          (the head button above stays the card's only door). */}
      {station && (
        <dl className="lab-station-lines">
          <div className="lab-station-line">
            <dt>What it's for</dt>
            <dd>{station.forLine}</dd>
          </div>
          <div className="lab-station-line">
            <dt>Reach for it when</dt>
            <dd>{station.whenLine}</dd>
          </div>
          <div className="lab-station-line">
            <dt>What the reading means</dt>
            <dd>{station.readingLine}</dd>
          </div>
          <div className="lab-station-line">
            <dt>How it connects</dt>
            <dd>{station.connectsLine}</dd>
          </div>
        </dl>
      )}
      {open && <div className="lab-card-body">{children}</div>}
    </div>
  );
}
