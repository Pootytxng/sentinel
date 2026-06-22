import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { HardwareInfo } from "../App";
import type { SessionSummary } from "../types";
import {
  gradeFps,
  gradeLow1,
  gradeFrametimeMs,
  gradeGpuTempC,
  gradeColor,
  type Grade,
} from "../data/metric-grade";
import { AnimatedNumber } from "../design/AnimatedNumber";
import { RigViewer } from "./rig/RigViewer";
import { HardwareGrid } from "./HardwareGrid";
import { SetupLauncherCard } from "./setup/SetupLauncherCard";
import "./HardwareSection.css";
import "./DashboardV2.css";

// DashboardV2 — the premium telemetry-dashboard prototype (owner: evolve toward ui-spec.md, 2026-06-15).
// Brings the spec's best moves into Compy WITHOUT scrapping the app or the doctrine: Vercel-grade dark
// cards, monospace telemetry (no layout-shift), and gradient area charts — but on Compy's OWN identity
// (teal, not emerald/blue) and lean stack (custom SVG charts, no heavy recharts dep). All data is REAL:
// live CPU/GPU sensors polled here, headline numbers from the last measured session. No fabrication.
// Flag-gated (compy_dash_v2, default OFF).

type CpuSnap = { usage_overall_pct: number; frequency_mhz: number; ram_used_bytes: number; ram_total_bytes: number };
type GpuSnap = { temperature_c: number | null; utilization_gpu_pct: number | null; name: string; vendor: string };

const N = 48; // rolling-buffer length (~48s at 1 Hz)

// Lean gradient area chart (custom SVG — no recharts). Smooth-ish polyline + a gradient fill fading into
// the card. Honest: it draws exactly the values handed to it (a rolling window of live sensor reads).
function AreaChart({ values, max, id }: { values: number[]; max: number; id: string }) {
  const w = 100;
  const h = 36;
  if (values.length < 2) {
    return <svg className="d2-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true" />;
  }
  const step = w / (N - 1);
  const pts = values.map((v, i) => {
    const x = (i + (N - values.length)) * step;
    const y = h - Math.max(0, Math.min(1, v / max)) * h;
    return [x, y] as const;
  });
  const line = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${pts[0][0].toFixed(2)},${h} ${line} ${pts[pts.length - 1][0].toFixed(2)},${h}`;
  return (
    <svg className="d2-chart" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={`d2grad-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--ix-accent, #2ee6c0)" stopOpacity="0.34" />
          <stop offset="100%" stopColor="var(--ix-accent, #2ee6c0)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#d2grad-${id})`} />
      <polyline points={line} fill="none" stroke="var(--ix-accent, #2ee6c0)" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function DashboardV2({ hw, sessions }: { hw: HardwareInfo; sessions: SessionSummary[] }) {
  const [cpu, setCpu] = useState<CpuSnap | null>(null);
  const [gpu, setGpu] = useState<GpuSnap | null>(null);
  const cpuHist = useRef<number[]>([]);
  const gpuHist = useRef<number[]>([]);
  const [, tick] = useState(0);
  // Home rig view: 3D hologram is the DEFAULT (the "tailored to your hardware" centerpiece); the
  // choice persists so a cards-preferring user isn't re-toggling a heavy WebGL view every visit.
  const [rig3d, setRig3d] = useState(() => {
    try {
      return localStorage.getItem("compy_home_rig_3d") !== "0";
    } catch {
      return true;
    }
  });
  const chooseRig3d = (v: boolean) => {
    setRig3d(v);
    try {
      localStorage.setItem("compy_home_rig_3d", v ? "1" : "0");
    } catch {
      /* localStorage unavailable — session-only choice */
    }
  };

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const c = await invoke<CpuSnap>("get_cpu_sensors");
        if (!cancelled && c) {
          setCpu(c);
          cpuHist.current = [...cpuHist.current, c.usage_overall_pct].slice(-N);
        }
      } catch {
        /* not under Tauri / sensor unavailable — chart just stays sparse */
      }
      try {
        const g = await invoke<GpuSnap[]>("get_gpu_sensors");
        const g0 = g?.[0] ?? null;
        if (!cancelled && g0) {
          setGpu(g0);
          gpuHist.current = [...gpuHist.current, g0.utilization_gpu_pct ?? 0].slice(-N);
        }
      } catch {
        /* ignore */
      }
      if (!cancelled) tick((t) => t + 1);
    };
    poll();
    const iv = window.setInterval(poll, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(iv);
    };
  }, []);

  const last = sessions[0];
  const gpuName = gpu?.name || hw.gpus?.[0]?.name || "GPU";
  const cpuName = hw.cpu_arch?.family_label || hw.cpu_brand || "CPU";
  // Hardware-tailored grading context: FPS/frametime are judged against THIS rig's refresh rate.
  const rig = { refreshHz: hw.display?.current_refresh_rate_hz ?? null };
  const gpuTempColor = gradeColor(gradeGpuTempC(gpu?.temperature_c ?? null));

  return (
    <div className="d2-root">
      {/* Front door — always-present guided Setup & Tour launcher (opens the HoloLens flow). */}
      <SetupLauncherCard />

      {/* Live telemetry — CPU + GPU, big monospace value over a gradient area chart of real reads. */}
      <div className="d2-grid d2-grid-2">
        <section className="d2-card d2-live">
          <div className="d2-live-head">
            <span className="d2-eyebrow">CPU · Live</span>
            <span className="d2-live-sub">{cpuName}</span>
          </div>
          <div className="d2-live-value">
            <span className="d2-num">{cpu ? <AnimatedNumber value={cpu.usage_overall_pct} /> : "—"}</span>
            <span className="d2-unit">%</span>
            <span className="d2-live-meta">{cpu ? `${(cpu.frequency_mhz / 1000).toFixed(2)} GHz` : ""}</span>
          </div>
          <AreaChart values={cpuHist.current} max={100} id="cpu" />
        </section>

        <section className="d2-card d2-live">
          <div className="d2-live-head">
            <span className="d2-eyebrow">GPU · Live</span>
            <span className="d2-live-sub">{gpuName}</span>
          </div>
          <div className="d2-live-value">
            <span className="d2-num">{gpu?.utilization_gpu_pct != null ? <AnimatedNumber value={gpu.utilization_gpu_pct} /> : "—"}</span>
            <span className="d2-unit">%</span>
            <span className="d2-live-meta" style={gpuTempColor ? { color: gpuTempColor } : undefined}>{gpu?.temperature_c != null ? `${gpu.temperature_c.toFixed(0)}°C` : ""}</span>
          </div>
          <AreaChart values={gpuHist.current} max={100} id="gpu" />
        </section>
      </div>

      {/* Last measured session — the headline numbers, monospace. Honest label; empty when no session. */}
      <div className="d2-section-label">
        Last session{last ? ` · ${(last.process_name || "").replace(/\.exe$/i, "")}` : ""}
      </div>
      {last ? (
        <div className="d2-grid d2-grid-4">
          <Metric label="Avg FPS" animate={last.avg_fps} fmt={(v) => v.toFixed(0)} grade={gradeFps(last.avg_fps, rig)} />
          <Metric label="1% low" animate={last.low1_fps_est} fmt={(v) => v.toFixed(0)} grade={gradeLow1(last.low1_fps_est, last.avg_fps)} />
          <Metric label="Frametime" animate={last.avg_frametime_ms} fmt={(v) => v.toFixed(1)} unit="ms" grade={gradeFrametimeMs(last.avg_frametime_ms, rig)} />
          <Metric label="Peak GPU" animate={last.peak_gpu_temp_c ?? undefined} value="—" fmt={(v) => v.toFixed(0)} unit="°C" grade={gradeGpuTempC(last.peak_gpu_temp_c)} />
        </div>
      ) : (
        <div className="d2-card d2-empty">Play a game with monitoring on — your FPS, 1% low and frametime land here.</div>
      )}

      {/* Hardware — dense spec cards, or the 3D rig hologram (lazy-loaded; real parts only). */}
      <div className="d2-rig-head">
        <div className="d2-section-label">This rig</div>
        <div className="hw-view-toggle" role="tablist" aria-label="Rig view">
          <button
            type="button"
            role="tab"
            aria-selected={!rig3d}
            className={`hw-view-btn ${!rig3d ? "hw-view-on" : ""}`}
            onClick={() => chooseRig3d(false)}
          >
            Cards
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={rig3d}
            className={`hw-view-btn ${rig3d ? "hw-view-on" : ""}`}
            onClick={() => chooseRig3d(true)}
          >
            3D
          </button>
        </div>
      </div>
      {rig3d ? (
        <RigViewer hw={hw} />
      ) : (
        // The detailed "Your hardware" grid — the full per-component detail (incl. the EDID monitor
        // model, Display, Network, and the A1 BIOS/XMP/SMART surfacing) the owner wanted on Home, not a
        // sparse 4-metric summary. The 3D rig stays the default centerpiece; this is the Cards toggle.
        <HardwareGrid hw={hw} />
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  unit,
  sub,
  grade,
  mono = true,
  animate,
  fmt,
}: {
  label: string;
  value?: string;
  unit?: string;
  sub?: string;
  grade?: Grade;
  mono?: boolean;
  // When provided, the value counts up / glides to this number (reduced-motion-honored). `value` is
  // the fallback rendered when `animate` is absent (e.g. an unmeasured "—").
  animate?: number;
  fmt?: (n: number) => string;
}) {
  // Hardware-tailored color: green/amber/red per the rig's ranges; neutral metrics inherit the ink.
  const color = grade ? gradeColor(grade) : "";
  return (
    <section className="d2-card d2-metric">
      <span className="d2-eyebrow">{label}</span>
      <span
        className={`d2-metric-value ${mono ? "d2-mono" : "d2-text"}`}
        style={color ? { color } : undefined}
      >
        {animate != null ? <AnimatedNumber value={animate} format={fmt} /> : value}
        {unit && <span className="d2-unit">{unit}</span>}
      </span>
      {sub && <span className="d2-metric-sub">{sub}</span>}
    </section>
  );
}
