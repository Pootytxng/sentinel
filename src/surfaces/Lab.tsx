import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  BenchmarkState,
  BlackBoxReport,
  LatencyReport,
  Verdict,
  SessionSummary,
  ArmedComparison,
  ComparisonResult,
} from "../types";
import { BenchmarkTab } from "./Benchmark";
import { LatencyTab } from "./Latency";
import { peekProbe, cachedProbe } from "../data/probe-cache";
import { BlackBox } from "./BlackBox";
import { tuningGuideForVendor } from "../data/tuning-guides";
import { measureTuning, tuningEvidence } from "../data/tuning-measure";
import { labLatestReadings } from "./lab-v2-data";
import { TuningInstrument } from "./TuningInstrument";
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

  return (
    <section className="lab-root">
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

        {/* Welcome band — a static signpost for newcomers (bathroom law): what each instrument
            answers, in plain words. Deliberately KNOBLESS (doorknob law): no cmp-door, no click
            handler — the instrument cards below stay the only doors in the room. Folds away once the
            reader has opened any instrument (welcomeSeen): it just renames the cards below it. */}
        {!welcomeSeen && (
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

        {/* Latest readings (fill pass, spec 2026-07-05): ONE quiet foot-of-room strip consolidating
            the newest value per instrument — an at-a-glance overview over the SAME reads the cards
            above already made (zero new IPC). V2 rooms only; classic Lab renders untouched. */}
        {v2 && (
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

const ICONS: Record<string, ReactNode> = {
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

function LabSection({
  icon,
  name,
  oneLiner,
  summary,
  children,
  onFirstOpen,
}: {
  icon: string;
  name: string;
  oneLiner: string;
  summary: string;
  children: ReactNode;
  // Fired the FIRST time this section is expanded — lets Lab retire the welcome band once the reader
  // has found a door. Opt-in (undefined = no-op), so the section stays a self-contained collapsible.
  onFirstOpen?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = () =>
    setOpen((o) => {
      if (!o) onFirstOpen?.(); // opening (not closing) is the "found a door" signal
      return !o;
    });
  return (
    <div className={`lab-card ${open ? "lab-card-open" : ""}`} data-instrument={name}>
      {/* WAI-ARIA accordion: the toggle button is wrapped in a native heading so screen-reader
          users get the instrument list as a navigable h3 structure (under Lab's h2). `font: inherit`
          + `margin: 0` on .lab-card-heading keep the visual byte-identical to a bare button. */}
      <h3 className="lab-card-heading">
        <button className="lab-card-head cmp-door" onClick={toggle} aria-expanded={open}>
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
            <span className="lab-card-oneliner">{oneLiner}</span>
          </span>
          <span className="lab-card-summary">{summary}</span>
          <span className="cmp-door-chevron cmp-door-chevron-end" aria-hidden="true">▸</span>
        </button>
      </h3>
      {open && <div className="lab-card-body">{children}</div>}
    </div>
  );
}
