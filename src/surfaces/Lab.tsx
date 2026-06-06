import { useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BenchmarkState, LatencyReport, Verdict } from "../types";
import { BenchmarkTab } from "./Benchmark";
import { LatencyTab } from "./Latency";
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

export default function Lab({ diagnostics }: { diagnostics?: ReactNode }) {
  const [bench, setBench] = useState<BenchmarkState | null>(null);
  const [latency, setLatency] = useState<LatencyReport | null>(null);

  // Recent-results summary — existing commands, read once on mount (no polling).
  useEffect(() => {
    invoke<BenchmarkState>("get_benchmark_state").then(setBench).catch(() => {});
    invoke<LatencyReport>("get_latency_diagnostics").then(setLatency).catch(() => {});
  }, []);

  const benchSummary = bench
    ? bench.efficacy
      ? `Last verdict: ${VERDICT_LABEL[bench.efficacy.overall]}`
      : bench.baseline
        ? `Baseline set${bench.baseline_at ? ` · ${fmtDate(bench.baseline_at)}` : ""}`
        : "No baseline yet"
    : "—";

  const latencySummary = latency
    ? `MSI ${latency.msi.msi_on} on · ${latency.msi.msi_off} off${
        latency.timer_current_ms != null ? ` · timer ${latency.timer_current_ms.toFixed(2)}ms` : ""
      }`
    : "—";

  return (
    <section className="lab-root">
      <div className="lab-dotgrid" aria-hidden="true" />
      <div className="lab-inner">
        <header className="lab-head">
          <h2 className="lab-title">Lab</h2>
          <p className="lab-sub">The measured instruments — prove it, don't vibe it.</p>
        </header>

        <LabSection
          icon="chart"
          name="Benchmark"
          oneLiner="Run it, change one thing, re-run — Compy tells you if it actually moved, honestly."
          summary={benchSummary}
        >
          <BenchmarkTab />
        </LabSection>

        <LabSection
          icon="pulse"
          name="Latency"
          oneLiner="The path from your mouse to the screen — Compy names what's adding delay."
          summary={latencySummary}
        >
          <LatencyTab />
        </LabSection>

        {/* Diagnostics — read-only forensics, re-homed into Lab as a third instrument (one-rail §1). */}
        {diagnostics && (
          <LabSection
            icon="terminal"
            name="Diagnostics"
            oneLiner="Read-only system forensics — what Compy detected about this rig, raw."
            summary="System report"
          >
            {diagnostics}
          </LabSection>
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
  terminal: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9l3 3-3 3" />
      <line x1="13" y1="15" x2="17" y2="15" />
    </>
  ),
};

function LabSection({
  icon,
  name,
  oneLiner,
  summary,
  children,
}: {
  icon: string;
  name: string;
  oneLiner: string;
  summary: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`lab-card ${open ? "lab-card-open" : ""}`}>
      <button className="lab-card-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
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
        <span className={`lab-card-caret ${open ? "lab-card-caret-open" : ""}`} aria-hidden="true">
          ▸
        </span>
      </button>
      {open && <div className="lab-card-body">{children}</div>}
    </div>
  );
}
