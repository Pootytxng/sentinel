import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary } from "../types";
import { readDisplayRefreshHz } from "../design/theme";
import { useDocumentVisible } from "../data/use-document-visible";
import { gradeFps, gradeLow1, gradeRamPct, gradeColor, type Grade } from "../data/metric-grade";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
import { Term } from "../design/Term";
import { prettyGameName } from "./game-name";
import { shortVerdict, fmtDur } from "./Play";
import type { GpuVendor } from "./walkthroughs";
import "./MonitorBasic.css";

// MonitorBasic — the BASIC face of Monitor (P2 UI slim-down, plan §4.3/§5.2): one glanceable answer
// to "how is it running?" — 4 big tiles (FPS · GPU temp · CPU · RAM) + the last-session line. Only
// mounted when the compy_basic_advanced split is ON and the mode is Basic; Advanced (and flag off)
// renders today's full Play panels untouched. Same audited read-only sensor commands + the existing
// FPS-capture toggle — zero new IPC, nothing mutated. Grades reuse the shared hardware-tailored
// helpers, so NVIDIA GPU temp stays deliberately ungraded (LOCKED rule #5 — sensor confidence copy
// and gating unchanged; the "not yet hardware-verified" wording lives in the Advanced panels as-is).

type CpuSnap = {
  usage_overall_pct: number;
  frequency_mhz: number;
  ram_used_bytes: number;
  ram_total_bytes: number;
};
type GpuSnap = { vendor?: string; temperature_c: number | null; utilization_gpu_pct: number | null };
type FpsLite = { active: boolean; status: string; sample: { fps: number; low1_fps: number } | null };

// Hottest GPU wins (same pick rule as Play's live card) — the interesting one on a hybrid rig.
function pickGpu(list: GpuSnap[]): GpuSnap | null {
  if (!list || list.length === 0) return null;
  return [...list].sort((a, b) => (b.temperature_c ?? -1) - (a.temperature_c ?? -1))[0];
}

function gradeStyle(g: Grade): { color: string } | undefined {
  const c = gradeColor(g);
  return c ? { color: c } : undefined;
}

export function MonitorBasic({
  active,
  vendor = "any",
  sessions,
  onOpenSessions,
}: {
  active: boolean;
  vendor?: GpuVendor;
  sessions: SessionSummary[];
  /** Routes to Advanced → Sessions (the full debrief) — the last-session line is a door, not a dead end. */
  onOpenSessions: () => void;
}) {
  const [cpu, setCpu] = useState<CpuSnap | null>(null);
  const [gpu, setGpu] = useState<GpuSnap | null>(null);
  const [fps, setFps] = useState<FpsLite | null>(null);
  const [fpsBusy, setFpsBusy] = useState(false);
  const visible = useDocumentVisible();

  // Same 1 Hz read-only poll as Play's live card / LiveCharts, demand-gated on tab + window
  // visibility so Basic never keeps the sensor threads awake in the background.
  useEffect(() => {
    if (!active || !visible) return;
    let cancelled = false;
    const tick = () => {
      invoke<CpuSnap>("get_cpu_sensors").then((c) => !cancelled && c && setCpu(c)).catch(() => {});
      invoke<GpuSnap[]>("get_gpu_sensors").then((g) => !cancelled && setGpu(pickGpu(g))).catch(() => {});
      invoke<FpsLite>("get_fps_status").then((f) => !cancelled && setFps(f)).catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active, visible]);

  // The existing audited capture commands — identical semantics to Play's button.
  const toggleCapture = useCallback(async () => {
    setFpsBusy(true);
    try {
      if (fps?.active) {
        await invoke("stop_fps_capture");
        setFps((p) => (p ? { ...p, active: false, sample: null } : p));
      } else {
        await invoke("start_fps_capture");
      }
    } catch {
      /* surfaced via the next poll */
    } finally {
      setFpsBusy(false);
    }
  }, [fps?.active]);

  const rig = { refreshHz: readDisplayRefreshHz() };
  const sample = fps?.sample ?? null;
  const ramPct = cpu?.ram_total_bytes
    ? Math.round((cpu.ram_used_bytes / cpu.ram_total_bytes) * 100)
    : null;
  const latest = sessions[0] ?? null;

  return (
    <div className="mb-root">
      <div className="mb-tiles">
        {/* FPS — live capture sample; the capture toggle lives with its tile so "—" is never a dead end. */}
        <section className="mb-tile">
          <div className="mb-tile-head">
            <span className="mb-tile-k">
              <Term id="hz-vs-fps">FPS</Term>
            </span>
            <button className={`mb-cap ${fps?.active ? "mb-cap-on" : ""}`} disabled={fpsBusy} onClick={toggleCapture}>
              {fpsBusy ? "…" : fps?.active ? "Stop capture" : "Start capture"}
            </button>
          </div>
          <div className="mb-tile-v" style={sample ? gradeStyle(gradeFps(sample.fps, rig)) : undefined}>
            {sample ? Math.round(sample.fps) : "—"}
          </div>
          <div className="mb-tile-m" style={sample ? gradeStyle(gradeLow1(sample.low1_fps, sample.fps)) : undefined}>
            {sample ? (
              <>
                {Math.round(sample.low1_fps)} <Term id="one-percent-lows">1% low</Term> · est
              </>
            ) : fps?.status === "declined" ? (
              "admin permission declined — tap Start capture to allow it"
            ) : fps?.active ? (
              "capturing — focus a DX11/DX12 game"
            ) : (
              "start capture, then play"
            )}
          </div>
        </section>

        {/* GPU temp — vendor-gated grading (NVIDIA stays ungraded/neutral, LOCKED rule #5). */}
        <section className="mb-tile">
          <div className="mb-tile-head">
            <span className="mb-tile-k">GPU temp</span>
          </div>
          <div className="mb-tile-v" style={gradeStyle(gradeGpuTempForVendor(vendor, gpu?.temperature_c ?? null))}>
            {gpu?.temperature_c == null ? "—" : `${Math.round(gpu.temperature_c)}°C`}
          </div>
          <div className="mb-tile-m">
            {gpu?.utilization_gpu_pct != null ? `${Math.round(gpu.utilization_gpu_pct)}% busy` : "waiting for sensors"}
          </div>
        </section>

        {/* CPU — utilisation stays ungraded by design (high while gaming is fine). */}
        <section className="mb-tile">
          <div className="mb-tile-head">
            <span className="mb-tile-k">CPU</span>
          </div>
          <div className="mb-tile-v">{cpu ? `${Math.round(cpu.usage_overall_pct)}%` : "—"}</div>
          <div className="mb-tile-m">{cpu ? `${(cpu.frequency_mhz / 1000).toFixed(2)} GHz` : "waiting for sensors"}</div>
        </section>

        {/* RAM — pressure-graded (same gradeRamPct as LiveCharts/Home). */}
        <section className="mb-tile">
          <div className="mb-tile-head">
            <span className="mb-tile-k">RAM</span>
          </div>
          <div className="mb-tile-v" style={gradeStyle(gradeRamPct(ramPct))}>
            {ramPct == null ? "—" : `${ramPct}%`}
          </div>
          <div className="mb-tile-m">
            {cpu?.ram_total_bytes
              ? `${(cpu.ram_used_bytes / 1024 ** 3).toFixed(1)} / ${(cpu.ram_total_bytes / 1024 ** 3).toFixed(0)} GB`
              : "waiting for sensors"}
          </div>
        </section>
      </div>

      {/* The same honesty line the full card carries — method stated, no injection, no kernel driver. */}
      <p className="mb-honest">
        <Term id="etw">ETW</Term> · external · anti-cheat safe — no injection, no kernel driver.
      </p>

      {/* Last-session summary (plan §4.3) — a door into the full debrief, never a dead end. */}
      {latest && (
        <button className="mb-last cmp-door" onClick={onOpenSessions}>
          <span className="mb-last-k">Last session</span>
          <span className="mb-last-v">
            {prettyGameName(latest.process_name) || "Unknown game"} · {shortVerdict(latest)} ·{" "}
            {fmtDur(latest.duration_secs)} · {latest.avg_fps.toFixed(0)} avg
          </span>
          <span className="cmp-door-chevron cmp-door-chevron-end" aria-hidden="true">
            ▸
          </span>
        </button>
      )}
    </div>
  );
}
