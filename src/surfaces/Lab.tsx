import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BenchmarkState, LatencyReport, Verdict } from "../types";
import "./Lab.css";

// LAB — the measured instruments, visible to everyone (spec 2026-06-06-check-play-lab). v1 is the
// launcher + recent-results room: two cards (Benchmark / Latency) with a plain-English one-liner +
// real recent results, whose primary action routes into the EXISTING full benchmark/latency UIs
// (not rebuilt this pass). Existing commands only; calm dot-grid ambiance.

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

export default function Lab({
  onOpenBenchmark,
  onOpenLatency,
}: {
  onOpenBenchmark: () => void;
  onOpenLatency: () => void;
}) {
  const [bench, setBench] = useState<BenchmarkState | null>(null);
  const [latency, setLatency] = useState<LatencyReport | null>(null);

  // Recent results — existing commands, read once on mount (no polling).
  useEffect(() => {
    invoke<BenchmarkState>("get_benchmark_state").then(setBench).catch(() => {});
    invoke<LatencyReport>("get_latency_diagnostics").then(setLatency).catch(() => {});
  }, []);

  const benchLines: string[] = bench
    ? bench.efficacy
      ? [`Last verdict: ${VERDICT_LABEL[bench.efficacy.overall]}`]
      : bench.baseline
        ? [`Baseline set${bench.baseline_at ? ` · ${fmtDate(bench.baseline_at)}` : ""}`]
        : ["No baseline yet — run one to measure a change"]
    : ["—"];

  const latencyLines: string[] = latency
    ? [
        `MSI mode: ${latency.msi.msi_on} on · ${latency.msi.msi_off} off`,
        latency.timer_current_ms != null
          ? `Timer resolution: ${latency.timer_current_ms.toFixed(2)} ms`
          : "Timer resolution: —",
      ]
    : ["—"];

  return (
    <section className="lab-root">
      <div className="lab-dotgrid" aria-hidden="true" />
      <div className="lab-inner">
        <header className="lab-head">
          <h2 className="lab-title">Lab</h2>
          <p className="lab-sub">The measured instruments — prove it, don't vibe it.</p>
        </header>

        <div className="lab-cards">
          <LabCard
            icon="chart"
            name="Benchmark"
            oneLiner="Run it, change one thing, re-run — Compy tells you if it actually moved, honestly."
            lines={benchLines}
            action="Run a baseline"
            onAction={onOpenBenchmark}
          />
          <LabCard
            icon="pulse"
            name="Latency"
            oneLiner="The path from your mouse to the screen — Compy names what's adding delay."
            lines={latencyLines}
            action="Measure input path"
            onAction={onOpenLatency}
          />
        </div>
      </div>
    </section>
  );
}

const ICONS: Record<string, React.ReactNode> = {
  chart: (
    <>
      <line x1="4" y1="20" x2="20" y2="20" />
      <rect x="5.5" y="11" width="3" height="7" />
      <rect x="10.5" y="7" width="3" height="11" />
      <rect x="15.5" y="13" width="3" height="5" />
    </>
  ),
  pulse: <path d="M3 12h4l2-6 4 12 2-6h6" />,
};

function LabCard({
  icon,
  name,
  oneLiner,
  lines,
  action,
  onAction,
}: {
  icon: string;
  name: string;
  oneLiner: string;
  lines: string[];
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="lab-card">
      <div className="lab-card-head">
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
        <span className="lab-card-name">{name}</span>
      </div>
      <p className="lab-card-oneliner">{oneLiner}</p>
      <ul className="lab-recent">
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
      <button className="lab-action" onClick={onAction}>
        {action} →
      </button>
    </div>
  );
}
