import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./DashboardV2.css";
import "./LiveCharts.css";
import { gradeRamPct, gradeColor } from "../data/metric-grade";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
import { AnimatedNumber } from "../design/AnimatedNumber";
import { useDocumentVisible } from "../data/use-document-visible";

// LiveCharts — a rolling live-telemetry panel for the Monitor tab (owner: bring the Home dashboard's
// live charts here too, 2026-06-15). Three d2-style cards (CPU · GPU · memory), each a big monospace
// value over a custom-SVG gradient area chart of REAL polled sensor reads. No recharts, no fabrication;
// CPU/RAM are always available (even idle), GPU when sensors report. Flag-gated by the parent.

type CpuSnap = { usage_overall_pct: number; frequency_mhz: number; ram_used_bytes: number; ram_total_bytes: number };
type GpuSnap = { vendor: string; temperature_c: number | null; utilization_gpu_pct: number | null };

const N = 56;

function Area({ values, id }: { values: number[]; id: string }) {
  const w = 100, h = 38;
  if (values.length < 2) return <svg className="d2-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" />;
  const step = w / (N - 1);
  const pts = values.map((v, i) => [(i + (N - values.length)) * step, h - Math.max(0, Math.min(1, v / 100)) * h] as const);
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${pts[0][0].toFixed(2)},${h} ${line} ${pts[pts.length - 1][0].toFixed(2)},${h}`;
  return (
    <svg className="d2-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`lc-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ix-accent, #2ee6c0)" stopOpacity="0.34" />
          <stop offset="100%" stopColor="var(--ix-accent, #2ee6c0)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#lc-${id})`} />
      <polyline points={line} fill="none" stroke="var(--ix-accent, #2ee6c0)" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function LiveCharts() {
  const [cpu, setCpu] = useState<CpuSnap | null>(null);
  const [gpu, setGpu] = useState<GpuSnap | null>(null);
  const cpuH = useRef<number[]>([]);
  const gpuH = useRef<number[]>([]);
  const ramH = useRef<number[]>([]);
  const [, tick] = useState(0);
  const visible = useDocumentVisible();

  useEffect(() => {
    // Pause the 1 Hz sensor poll while this window is hidden/minimized — no point reading sensors the
    // user can't see, and it lets the backend sensor threads idle. Resumes immediately on focus.
    if (!visible) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const c = await invoke<CpuSnap>("get_cpu_sensors");
        if (!cancelled && c) {
          setCpu(c);
          cpuH.current = [...cpuH.current, c.usage_overall_pct].slice(-N);
          if (c.ram_total_bytes) ramH.current = [...ramH.current, (c.ram_used_bytes / c.ram_total_bytes) * 100].slice(-N);
        }
      } catch { /* ignore */ }
      try {
        const g = await invoke<GpuSnap[]>("get_gpu_sensors");
        const g0 = g?.[0] ?? null;
        if (!cancelled && g0) {
          setGpu(g0);
          gpuH.current = [...gpuH.current, g0.utilization_gpu_pct ?? 0].slice(-N);
        }
      } catch { /* ignore */ }
      if (!cancelled) tick((t) => t + 1);
    };
    poll();
    const iv = window.setInterval(poll, 1000);
    return () => { cancelled = true; window.clearInterval(iv); };
  }, [visible]);

  const ramPct = cpu?.ram_total_bytes ? Math.round((cpu.ram_used_bytes / cpu.ram_total_bytes) * 100) : null;
  // Hardware-tailored grade colors — GPU temp + RAM pressure carry green/amber/red; utilization stays
  // neutral (high util is good while gaming). No refresh needed here (no FPS/frametime in this panel).
  // GPU temp is vendor-gated (LOCKED rule #5): NVIDIA NVML temp is unverified → neutral (one source).
  const gpuTempColor = gradeColor(gradeGpuTempForVendor(gpu?.vendor, gpu?.temperature_c ?? null));
  const ramColor = gradeColor(gradeRamPct(ramPct));

  return (
    <div className="lc-grid">
      <section className="d2-card d2-live">
        <div className="d2-live-head"><span className="d2-eyebrow">CPU</span><span className="d2-live-sub">{cpu ? `${(cpu.frequency_mhz / 1000).toFixed(2)} GHz` : ""}</span></div>
        <div className="d2-live-value"><span className="d2-num">{cpu ? <AnimatedNumber value={cpu.usage_overall_pct} /> : "—"}</span><span className="d2-unit">%</span></div>
        <Area values={cpuH.current} id="cpu" />
      </section>
      <section className="d2-card d2-live">
        <div className="d2-live-head"><span className="d2-eyebrow">GPU</span><span className="d2-live-sub" style={gpuTempColor ? { color: gpuTempColor } : undefined}>{gpu?.temperature_c != null ? `${gpu.temperature_c.toFixed(0)}°C` : ""}</span></div>
        <div className="d2-live-value"><span className="d2-num">{gpu?.utilization_gpu_pct != null ? <AnimatedNumber value={gpu.utilization_gpu_pct} /> : "—"}</span><span className="d2-unit">%</span></div>
        <Area values={gpuH.current} id="gpu" />
      </section>
      <section className="d2-card d2-live">
        <div className="d2-live-head"><span className="d2-eyebrow">Memory</span><span className="d2-live-sub">{cpu ? `${(cpu.ram_used_bytes / 1024 ** 3).toFixed(1)} / ${(cpu.ram_total_bytes / 1024 ** 3).toFixed(0)} GB` : ""}</span></div>
        <div className="d2-live-value"><span className="d2-num" style={ramColor ? { color: ramColor } : undefined}>{ramPct != null ? <AnimatedNumber value={ramPct} /> : "—"}</span><span className="d2-unit">%</span></div>
        <Area values={ramH.current} id="ram" />
      </section>
    </div>
  );
}
