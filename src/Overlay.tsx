import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type OverlayDensity, readOverlayDensity } from "./design/theme";
import "./Overlay.css";

// Minimal shapes — the overlay only reads a few fields from the same sensor
// commands the main window uses.
type GpuLite = {
  vendor: string;
  name: string;
  temperature_c: number | null;
  utilization_gpu_pct: number | null;
};
type CpuLite = {
  usage_overall_pct: number;
  ram_used_bytes: number;
  ram_total_bytes: number;
};
// The fps stream already carries low1_fps + recent_frametimes_ms (the main window reads them); the
// overlay just reads more of the SAME payload — no new IPC.
type FpsLite = {
  active: boolean;
  sample: {
    fps: number;
    avg_frametime_ms: number;
    low1_fps: number;
    recent_frametimes_ms: number[];
  } | null;
};

// compy_overlay_v2: render the re-dressed (inverted-rule) overlay. DEFAULT ON (the redesign is the
// shipped app); "0" in Settings falls back to the classic overlay. Read here (the overlay is a
// separate window); it reacts to the cross-window `storage` event when Settings flips it or the density.
function readOverlayV2(): boolean {
  try {
    const v = localStorage.getItem("compy_overlay_v2");
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* ignore — default ON */
  }
  return true;
}

// A system can expose more than one GPU — AM5 desktop CPUs (incl. X3D) ship
// an integrated GPU alongside the discrete card, so ADLX enumerates both. The
// overlay shows one line, so pick the discrete gaming GPU: the adapter actually
// reporting a temperature wins (the iGPU usually reports none), then the busier
// one. Falls back to the first entry.
function pickPrimaryGpu(list: GpuLite[]): GpuLite | null {
  if (list.length === 0) return null;
  return [...list].sort((a, b) => {
    const at = a.temperature_c ?? -1;
    const bt = b.temperature_c ?? -1;
    if (bt !== at) return bt - at;
    return (b.utilization_gpu_pct ?? -1) - (a.utilization_gpu_pct ?? -1);
  })[0];
}

// Compact always-on-top HUD rendered in the transparent overlay window. It
// only displays — start/stop of FPS capture lives in the main window. GPU and
// CPU readouts work with no elevation; FPS shows once capture is enabled.
export default function Overlay() {
  const [gpu, setGpu] = useState<GpuLite | null>(null);
  const [cpu, setCpu] = useState<number | null>(null);
  const [ram, setRam] = useState<number | null>(null);
  const [fps, setFps] = useState<FpsLite | null>(null);
  const [v2, setV2] = useState<boolean>(readOverlayV2);
  const [density, setDensity] = useState<OverlayDensity>(readOverlayDensity);

  // React to Settings (main window) flipping the flag / density — `storage` fires in OTHER windows.
  useEffect(() => {
    const on = () => {
      setV2(readOverlayV2());
      setDensity(readOverlayDensity());
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Fetch each metric INDEPENDENTLY so one command failing doesn't blank the
    // others. (Previously a single Promise.all meant any one rejection wiped
    // every reading — e.g. CPU went blank if an unrelated call hiccuped.)
    const tick = () => {
      invoke<GpuLite[]>("get_gpu_sensors")
        .then((g) => !cancelled && setGpu(pickPrimaryGpu(g)))
        .catch(() => {});
      invoke<CpuLite>("get_cpu_sensors")
        .then((c) => {
          if (cancelled) return;
          setCpu(Math.round(c.usage_overall_pct));
          setRam(
            c.ram_total_bytes > 0
              ? Math.round((c.ram_used_bytes / c.ram_total_bytes) * 100)
              : null,
          );
        })
        .catch(() => {});
      invoke<FpsLite>("get_fps_status")
        .then((f) => !cancelled && setFps(f))
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const sample = fps?.sample ?? null;

  // ── v2: the inverted-rule overlay — the game is the hero. Flat near-opaque pill, mono, no glow/
  // glass/ambient; accent only on the unit + the frametime line. Three densities. ──
  if (v2) {
    const fpsNum = sample ? Math.round(sample.fps) : null;
    return (
      <div className={`ovl2 ovl2-${density}`}>
        <div className="ovl2-fps">
          <span className="ovl2-fps-num">{fpsNum ?? "—"}</span>
          <span className="ovl2-unit">fps</span>
        </div>
        {density !== "minimal" && (
          <div className="ovl2-row">
            <span>1% {sample ? Math.round(sample.low1_fps) : "—"}</span>
            <span className="ovl2-dot">·</span>
            <span>{gpu?.temperature_c ?? "—"}°C</span>
            <span className="ovl2-dot">·</span>
            <span>gpu {gpu?.utilization_gpu_pct ?? "—"}%</span>
          </div>
        )}
        {density === "full" && sample && sample.recent_frametimes_ms.length > 1 && (
          <Frametimeline samples={sample.recent_frametimes_ms} />
        )}
      </div>
    );
  }

  // ── classic overlay (flag off) — unchanged ──
  return (
    <div className="ovl">
      <div className="ovl-row ovl-fps">
        <span className="ovl-k">FPS</span>
        <span className="ovl-v">{sample ? Math.round(sample.fps) : "—"}</span>
      </div>
      <div className="ovl-row">
        <span className="ovl-k">frametime</span>
        <span className="ovl-v">
          {sample ? `${sample.avg_frametime_ms.toFixed(1)} ms` : "—"}
        </span>
      </div>
      <div className="ovl-row">
        <span className="ovl-k">GPU</span>
        <span className="ovl-v">
          {gpu
            ? `${gpu.utilization_gpu_pct ?? "—"}% · ${gpu.temperature_c ?? "—"}°C`
            : "—"}
        </span>
      </div>
      <div className="ovl-row">
        <span className="ovl-k">CPU</span>
        <span className="ovl-v">{cpu ?? "—"}%</span>
      </div>
      <div className="ovl-row">
        <span className="ovl-k">RAM</span>
        <span
          className={`ovl-v${
            ram != null && ram >= 90
              ? " ovl-crit"
              : ram != null && ram >= 80
                ? " ovl-warn"
                : ""
          }`}
        >
          {ram ?? "—"}%
        </span>
      </div>
    </div>
  );
}

// Frametime polyline (Full density) — the last N samples from the existing stream, scaled to their
// own min/max so spikes are visible (that's the point). Pure SVG, updated on the existing tick.
function Frametimeline({ samples }: { samples: number[] }) {
  const pts = samples.slice(-40);
  const W = 116;
  const H = 18;
  const max = Math.max(...pts);
  const min = Math.min(...pts);
  const range = max - min || 1;
  const points = pts
    .map((v, i) => {
      const x = pts.length > 1 ? (i / (pts.length - 1)) * W : 0;
      const y = H - ((v - min) / range) * (H - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="ovl2-ft" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      <polyline points={points} fill="none" stroke="var(--ix-accent)" strokeWidth="1.2" />
    </svg>
  );
}
