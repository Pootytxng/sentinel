import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
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
type FpsLite = {
  active: boolean;
  sample: { fps: number; avg_frametime_ms: number } | null;
};

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
