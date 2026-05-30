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
type CpuLite = { usage_overall_pct: number };
type FpsLite = {
  active: boolean;
  sample: { fps: number; avg_frametime_ms: number } | null;
};

// Compact always-on-top HUD rendered in the transparent overlay window. It
// only displays — start/stop of FPS capture lives in the main window. GPU and
// CPU readouts work with no elevation; FPS shows once capture is enabled.
export default function Overlay() {
  const [gpu, setGpu] = useState<GpuLite | null>(null);
  const [cpu, setCpu] = useState<number | null>(null);
  const [fps, setFps] = useState<FpsLite | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const [g, c, f] = await Promise.all([
          invoke<GpuLite[]>("get_gpu_sensors"),
          invoke<CpuLite>("get_cpu_sensors"),
          invoke<FpsLite>("get_fps_status"),
        ]);
        if (cancelled) return;
        setGpu(g[0] ?? null);
        setCpu(Math.round(c.usage_overall_pct));
        setFps(f);
      } catch {
        /* transient — keep last values */
      }
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
      {sample && (
        <div className="ovl-row">
          <span className="ovl-k">frametime</span>
          <span className="ovl-v">{sample.avg_frametime_ms.toFixed(1)} ms</span>
        </div>
      )}
      {gpu && (
        <div className="ovl-row">
          <span className="ovl-k">GPU</span>
          <span className="ovl-v">
            {gpu.utilization_gpu_pct ?? "—"}% · {gpu.temperature_c ?? "—"}°C
          </span>
        </div>
      )}
      <div className="ovl-row">
        <span className="ovl-k">CPU</span>
        <span className="ovl-v">{cpu ?? "—"}%</span>
      </div>
    </div>
  );
}
