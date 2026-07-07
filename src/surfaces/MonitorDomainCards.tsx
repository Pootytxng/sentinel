import { useState } from "react";
import SpotlightCard from "../design/vendor/SpotlightCard/SpotlightCard";
import { gradeRamPct, gradeColor } from "../data/metric-grade";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
import type { GpuVendor } from "./walkthroughs";
import { fmtGB, fmtGHz } from "./hardware-format";
import {
  CpuMonitorPanel,
  GpuMonitorPanel,
  CoreBar,
  MetricRow,
  Sparkline,
  type CpuSensorSnapshot,
  type GpuSensorSnapshot,
  type MemoryPressure,
  type CpuTemp,
} from "./monitor-panels";
import "./MonitorDomainCards.css";

// MonitorDomainCards (T3+T4b, spec 2026-07-06-firstcheck-monitor-mvp-train) — the deep
// Monitoring panels re-laid SUMMARY-FIRST: one compact instrument card per domain (CPU · GPU ·
// Memory · Cores) with a headline value, a token-CSS gauge and the existing spark; clicking a
// card opens the FULL classic panel beneath the grid — summary-first, never summary-only, every
// reading ≤1 click (the kernel-driver CPU-temp note lives in the expanded CPU panel, once).
// Presentation only: same audited read-only polls, same 1 Hz cadence, no continuous GPU-hungry
// animation (gauge/slide transitions are value-event-driven; the card-face grid backdrop is a
// whisper-opacity CSS pulse, static under reduced motion).

// Sliding-number live value (T4b, reimplemented locally in token CSS — no new dep): each digit
// is a vertical reel that translates on change (event-driven transform, composited). Digits are
// keyed from the RIGHT so 99→100 slides sanely. Reduced motion → plain text.
export function SlidingNumber({ value, reduced }: { value: string; reduced: boolean }) {
  if (reduced) return <span className="sln">{value}</span>;
  const chars = value.split("");
  return (
    <span className="sln" role="text" aria-label={value}>
      {chars.map((c, i) => {
        const k = chars.length - 1 - i;
        if (!/\d/.test(c)) {
          return (
            <span key={`c${k}`} className="sln-char" aria-hidden="true">
              {c}
            </span>
          );
        }
        return (
          <span key={`d${k}`} className="sln-digit" aria-hidden="true">
            <span className="sln-reel" style={{ transform: `translateY(${-Number(c)}em)` }}>
              {Array.from({ length: 10 }, (_, d) => (
                <span key={d}>{d}</span>
              ))}
            </span>
          </span>
        );
      })}
    </span>
  );
}

// Token-CSS arc gauge (T4b — Animata-style donut redrawn from scratch on theme tokens).
// Purely presentational; `pct` is the already-measured value, never an estimate.
function Donut({ pct, color }: { pct: number; color?: string }) {
  const r = 22;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <svg className="mdc-donut" viewBox="0 0 56 56" aria-hidden="true">
      <circle className="mdc-donut-track" cx="28" cy="28" r={r} />
      <circle
        className="mdc-donut-fill"
        cx="28"
        cy="28"
        r={r}
        style={color ? { stroke: color } : undefined}
        strokeDasharray={`${(clamped / 100) * c} ${c}`}
      />
    </svg>
  );
}

type CardId = string; // "cpu" | "mem" | "cores" | `gpu-${vendor}-${index}`

export function MonitorDomainCards({
  cpuSamples,
  gpuSamples,
  cpuTemp,
  mem,
  reduced,
}: {
  cpuSamples: CpuSensorSnapshot[];
  gpuSamples: GpuSensorSnapshot[][];
  cpuTemp: CpuTemp | null;
  mem: MemoryPressure | null;
  reduced: boolean;
}) {
  const [open, setOpen] = useState<CardId | null>(null);
  const latestCpu = cpuSamples[cpuSamples.length - 1] ?? null;
  const latestGpu = gpuSamples[gpuSamples.length - 1] ?? [];

  if (!latestCpu && latestGpu.length === 0) return null; // parent shows "Collecting first sample…"

  const toggle = (id: CardId) => setOpen((o) => (o === id ? null : id));

  // Same first-sample honesty as CpuMonitorPanel: sysinfo needs two samples for a delta.
  const warmingUp =
    latestCpu != null && cpuSamples.length < 2 && latestCpu.usage_per_core_pct.every((v) => v === 0);
  const cpuPct = latestCpu && !warmingUp ? Math.round(latestCpu.usage_overall_pct) : null;
  const ramPct =
    latestCpu && latestCpu.ram_total_bytes > 0
      ? Math.round((latestCpu.ram_used_bytes / latestCpu.ram_total_bytes) * 100)
      : null;
  const ramColor = gradeColor(gradeRamPct(ramPct));
  const gpuHistoryFor = (gpu: GpuSensorSnapshot) =>
    gpuSamples.map((snap) => snap.find((g) => g.index === gpu.index && g.vendor === gpu.vendor) ?? null);

  const cards: {
    id: CardId;
    label: string;
    sub: string;
    value: string;
    unit: string;
    color?: string;
    donutPct: number | null;
    spark?: { data: (number | null)[]; min: number; max: number; color: string };
    face?: React.ReactNode;
    detail: React.ReactNode;
  }[] = [];

  if (latestCpu) {
    cards.push({
      id: "cpu",
      label: "CPU",
      sub: `${latestCpu.usage_per_core_pct.length} cores${latestCpu.frequency_mhz > 0 ? ` · ${fmtGHz(latestCpu.frequency_mhz)}` : ""}`,
      value: cpuPct == null ? "—" : String(cpuPct),
      unit: "%",
      donutPct: cpuPct,
      spark: {
        data: cpuSamples.map((s) => Math.round(s.usage_overall_pct)),
        min: 0,
        max: 100,
        color: "#6aa9ff",
      },
      detail: <CpuMonitorPanel cpu={latestCpu} history={cpuSamples} cpuTemp={cpuTemp} />,
    });
  }

  for (const gpu of latestGpu) {
    const vendor: GpuVendor = gpu.vendor.toLowerCase() === "amd" ? "amd" : "nvidia";
    // NVIDIA stays deliberately ungraded (LOCKED rule #5) — the shared helper enforces it.
    const tempColor = gradeColor(gradeGpuTempForVendor(vendor, gpu.temperature_c));
    cards.push({
      id: `gpu-${gpu.vendor}-${gpu.index}`,
      label: "GPU",
      sub: gpu.name,
      value: gpu.temperature_c == null ? "—" : String(Math.round(gpu.temperature_c)),
      unit: gpu.temperature_c == null ? "" : "°C",
      color: tempColor,
      donutPct: gpu.utilization_gpu_pct,
      spark: {
        data: gpuHistoryFor(gpu).map((s) => s?.temperature_c ?? null),
        min: 20,
        max: 100,
        color: "#f87171",
      },
      detail: <GpuMonitorPanel gpu={gpu} history={gpuHistoryFor(gpu)} />,
    });
  }

  if (latestCpu && latestCpu.ram_total_bytes > 0) {
    cards.push({
      id: "mem",
      label: "Memory",
      sub: `${fmtGB(latestCpu.ram_used_bytes)} / ${fmtGB(latestCpu.ram_total_bytes)}`,
      value: ramPct == null ? "—" : String(ramPct),
      unit: "%",
      color: ramColor,
      donutPct: ramPct,
      spark: {
        data: cpuSamples.map((s) =>
          s.ram_total_bytes > 0 ? Math.round((s.ram_used_bytes / s.ram_total_bytes) * 100) : null,
        ),
        min: 0,
        max: 100,
        color: "#a78bfa",
      },
      detail: (
        <div className="monitor-panel">
          <div className="monitor-panel-head">
            <div className="monitor-panel-name">Memory</div>
            <div className="monitor-panel-sub">
              {mem ? `pressure · ${mem.level}` : "pressure probe unavailable"}
            </div>
          </div>
          <div className="monitor-metrics">
            <MetricRow
              label="Memory used"
              value={ramPct}
              unit="%"
              history={cpuSamples.map((s) =>
                s.ram_total_bytes > 0 ? Math.round((s.ram_used_bytes / s.ram_total_bytes) * 100) : null,
              )}
              min={0}
              max={100}
              color="#a78bfa"
              sublabel={`${fmtGB(latestCpu.ram_used_bytes)} / ${fmtGB(latestCpu.ram_total_bytes)}`}
            />
            {mem && mem.swap_total_bytes > 0 && (
              <MetricRow
                label="Swap used"
                value={Math.round((mem.swap_used_bytes / mem.swap_total_bytes) * 100)}
                unit="%"
                history={[Math.round((mem.swap_used_bytes / mem.swap_total_bytes) * 100)]}
                min={0}
                max={100}
                color="#8a93a8"
                sublabel={`${fmtGB(mem.swap_used_bytes)} / ${fmtGB(mem.swap_total_bytes)}`}
              />
            )}
          </div>
          {mem && mem.advisory && <p className="mdc-mem-advisory">{mem.advisory}</p>}
          {mem && mem.top_consumers.length > 0 && (
            <ul className="mem-consumers">
              {mem.top_consumers.map((c) => (
                <li key={c.name}>
                  <span className="mem-consumer-name">{c.name}</span>
                  <span className="mem-consumer-bytes">{fmtGB(c.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ),
    });
  }

  if (latestCpu) {
    cards.push({
      id: "cores",
      label: "Cores",
      sub: "per-core load",
      value: "",
      unit: "",
      donutPct: null,
      face: (
        <div className="mdc-minicores" aria-hidden="true">
          {latestCpu.usage_per_core_pct.map((pct, i) => (
            <span
              key={i}
              className="mdc-minicore"
              style={{ transform: `scaleY(${Math.max(0.08, Math.min(100, warmingUp ? 0 : pct) / 100)})` }}
            />
          ))}
        </div>
      ),
      detail: (
        <div className="monitor-panel">
          <div className="monitor-panel-head">
            <div className="monitor-panel-name">Per-core load</div>
            <div className="monitor-panel-sub">
              {latestCpu.usage_per_core_pct.length} logical cores
            </div>
          </div>
          <div className="cpu-core-grid">
            {latestCpu.usage_per_core_pct.map((pct, i) => (
              <CoreBar key={i} index={i} percent={warmingUp ? 0 : pct} />
            ))}
          </div>
        </div>
      ),
    });
  }

  const openCard = cards.find((c) => c.id === open) ?? null;

  return (
    <div className="mdc-root">
      <div className="mdc-grid">
        {cards.map((card) => (
          <SpotlightCard key={card.id} className="mdc-card" spotlightColor="rgba(255, 255, 255, 0.07)">
            <div className="mdc-bg" aria-hidden="true" />
            <button
              type="button"
              className={`mdc-face ${open === card.id ? "mdc-face-open" : ""}`}
              aria-expanded={open === card.id}
              aria-controls="mdc-detail"
              onClick={() => toggle(card.id)}
            >
              <div className="mdc-head">
                <span className="mdc-k">{card.label}</span>
                <span className="mdc-sub" title={card.sub}>
                  {card.sub}
                </span>
              </div>
              <div className="mdc-mid">
                {card.donutPct != null && <Donut pct={card.donutPct} color={card.color} />}
                {card.face}
                {card.value !== "" && (
                  <span className="mdc-value" style={card.color ? { color: card.color } : undefined}>
                    <SlidingNumber value={card.value} reduced={reduced} />
                    <span className="mdc-unit">{card.unit}</span>
                  </span>
                )}
              </div>
              {card.spark && (
                <div className="mdc-spark">
                  <Sparkline
                    data={card.spark.data}
                    min={card.spark.min}
                    max={card.spark.max}
                    color={card.spark.color}
                  />
                </div>
              )}
            </button>
          </SpotlightCard>
        ))}
      </div>

      {/* The one-click detail — the FULL classic panel, untouched (summary-first, never
          summary-only). Rendered full-width under the grid so the cards never jump. */}
      {openCard && (
        <div id="mdc-detail" className="mdc-detail">
          {openCard.detail}
        </div>
      )}
    </div>
  );
}
