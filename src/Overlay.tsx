import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
// i18next init (side-effect import): the overlay is a separate window/module graph from the main
// one — main.tsx's own "./i18n" import doesn't cover a direct import of this file (e.g. by
// Overlay.test.tsx), so this guarantees the translator is ready before first render here too.
import "./i18n";
import {
  type OverlayDensity,
  type OverlayBackdrop,
  readOverlayDensity,
  readOverlayBackdrop,
  readDisplayRefreshHz,
} from "./design/theme";
import { gradeFps, gradeLow1, gradeColor } from "./data/metric-grade";
import { gradeGpuTempForVendor } from "./data/gpu-sensor";
import { asProgress, enoughLine, journeyRecordingMode, type JourneyMode } from "./surfaces/journey-enough";
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
  /** P5-enough: what the running capture has measured so far (monitoring.rs `FpsStatus::progress`). */
  progress?: unknown;
};

// compy_overlay_v2: render the re-dressed (inverted-rule) overlay. DEFAULT ON (the redesign is the
// shipped app). A stored "0" is SELF-HEALED to v2 (removed + default): no UI writes this flag
// anymore (the New Look hub is gone), so a stale "0" pinned the overlay to the CLASSIC layout —
// which ignores density, leaving the Play density picker a dead knob (owner hit it live
// 2026-06-11; same lockout class as the shell flags, a335f13). Read here (the overlay is a
// separate window); it reacts to the cross-window `storage` event when the density changes.
function readOverlayV2(): boolean {
  try {
    if (localStorage.getItem("compy_overlay_v2") === "0") {
      localStorage.removeItem("compy_overlay_v2"); // self-heal the lockout
    }
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
  const { t } = useTranslation();
  const [gpu, setGpu] = useState<GpuLite | null>(null);
  const [cpu, setCpu] = useState<number | null>(null);
  const [ram, setRam] = useState<number | null>(null);
  const [fps, setFps] = useState<FpsLite | null>(null);
  const [v2, setV2] = useState<boolean>(readOverlayV2);
  const [density, setDensity] = useState<OverlayDensity>(readOverlayDensity);
  const [backdrop, setBackdrop] = useState<OverlayBackdrop>(readOverlayBackdrop);
  const [refreshHz, setRefreshHz] = useState<number | null>(readDisplayRefreshHz);
  // P5-enough: the main window's guided journey is recording (journey-enough.ts flag), and which kind
  // of session (P5-realplay: a real-play session only counts down, never grades its halves).
  const [journey, setJourney] = useState<JourneyMode | null>(journeyRecordingMode);

  // React to the main window flipping the flag / density / backdrop / relaying the monitor
  // refresh — `storage` fires in OTHER windows.
  useEffect(() => {
    const on = () => {
      setV2(readOverlayV2());
      setDensity(readOverlayDensity());
      setBackdrop(readOverlayBackdrop());
      setRefreshHz(readDisplayRefreshHz());
      setJourney(journeyRecordingMode());
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
  // P5-enough: one quiet "enough yet?" line while a guided journey records. Display only, like the
  // rest of the overlay: this window is click-through and can't take focus (overlay-focus-guard).
  const progress = journey && fps?.active ? asProgress(fps.progress) : null;
  const enough = progress ? (
    <div className="ovl2-note" data-testid="overlay-enough">
      {enoughLine(progress, t, "overlay", journey ?? "pair")}
    </div>
  ) : null;

  // ── v2: the inverted-rule overlay — the game is the hero. Flat near-opaque pill, mono, no glow/
  // glass/ambient; accent only on the unit + the frametime line. Three densities. ──
  if (v2) {
    const fpsNum = sample ? Math.round(sample.fps) : null;
    // Hardware-tailored grade colors (same per-rig system as the app) — FPS/1%-low against this
    // display's refresh, GPU temp on the thermal ramp. Utilization stays neutral (good when busy).
    // GPU temp is vendor-gated (LOCKED rule #5): NVIDIA NVML temp is unverified → neutral, never a
    // graded color the user can't trust (one source, gradeGpuTempForVendor).
    const rig = { refreshHz };
    const fpsColor = gradeColor(gradeFps(sample?.fps ?? null, rig));
    const low1Color = gradeColor(gradeLow1(sample?.low1_fps ?? null, sample?.fps ?? null));
    const tempColor = gradeColor(gradeGpuTempForVendor(gpu?.vendor, gpu?.temperature_c ?? null));
    return (
      <div className={`ovl2 ovl2-${density}${backdrop === "off" ? " ovl2-nobg" : ""}`}>
        <div className="ovl2-fps">
          <span className="ovl2-fps-num" style={fpsColor ? { color: fpsColor } : undefined}>{fpsNum ?? "—"}</span>
          <span className="ovl2-unit">{t("app.overlay.fpsUnit")}</span>
        </div>
        {density !== "minimal" && (
          <div className="ovl2-row">
            <span>{t("app.overlay.lowLabel")} <span style={low1Color ? { color: low1Color } : undefined}>{sample ? Math.round(sample.low1_fps) : "—"}</span> <span className="ovl2-est">{t("app.overlay.est")}</span></span>
            <span className="ovl2-dot">·</span>
            <span><span style={tempColor ? { color: tempColor } : undefined}>{gpu?.temperature_c ?? "—"}</span>°C</span>
            {/* §2: Full density adds CPU USAGE (never CPU temp — no kernel driver); data already fetched. */}
            {density === "full" && (
              <>
                <span className="ovl2-dot">·</span>
                <span>{t("app.overlay.cpuLabel")} {cpu ?? "—"}%</span>
              </>
            )}
            <span className="ovl2-dot">·</span>
            <span>{t("app.overlay.gpuLabel")} {gpu?.utilization_gpu_pct ?? "—"}%</span>
          </div>
        )}
        {density === "full" && sample && sample.recent_frametimes_ms.length > 1 && (
          <Frametimeline samples={sample.recent_frametimes_ms} refreshHz={refreshHz} />
        )}
        {enough}
      </div>
    );
  }

  // ── classic overlay (flag off) — unchanged ──
  return (
    <div className="ovl">
      <div className="ovl-row ovl-fps">
        <span className="ovl-k">{t("app.overlay.classic.fps")}</span>
        <span className="ovl-v">{sample ? Math.round(sample.fps) : "—"}</span>
      </div>
      <div className="ovl-row">
        <span className="ovl-k">{t("app.overlay.classic.frametime")}</span>
        <span className="ovl-v">
          {sample ? `${sample.avg_frametime_ms.toFixed(1)} ms` : "—"}
        </span>
      </div>
      <div className="ovl-row">
        <span className="ovl-k">{t("app.overlay.classic.gpu")}</span>
        <span className="ovl-v">
          {gpu
            ? `${gpu.utilization_gpu_pct ?? "—"}% · ${gpu.temperature_c ?? "—"}°C`
            : "—"}
        </span>
      </div>
      <div className="ovl-row">
        <span className="ovl-k">{t("app.overlay.classic.cpu")}</span>
        <span className="ovl-v">{cpu ?? "—"}%</span>
      </div>
      <div className="ovl-row">
        <span className="ovl-k">{t("app.overlay.classic.ram")}</span>
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

// Frametime scale (pure, exported for tests). FIXED Y-scale, RTSS-style — the owner/tester-found
// honesty fix (2026-06-10): the old min/max auto-scale stretched STABLE frametimes (the good case)
// to fill the full height, rendering rock-steady pacing as jagged noise. A fixed ceiling means
// stable = a near-flat line low in the graph, and only genuine jumps rise. The ceiling anchors to
// the monitor's frame budget (≈3.5× budget, bounded 20–50 ms) so 60/120/165/240 Hz all put "flat
// at budget" at the same visual height; unknown refresh falls back to a plain 0–50 ms window.
export function frametimeScale(budgetMs: number | null): { ceilingMs: number; budgetMs: number | null } {
  if (budgetMs == null || !Number.isFinite(budgetMs) || budgetMs <= 0) {
    return { ceilingMs: 50, budgetMs: null };
  }
  return { ceilingMs: Math.min(50, Math.max(20, budgetMs * 3.5)), budgetMs };
}

// Frametime polyline (Full density) — last N samples from the existing stream on the FIXED scale
// above, plus a faint dashed reference line at the frame budget (1000/refresh ms): flat at or
// under the line = good, visible at a glance. Spikes past the ceiling pin to the top (still
// unmissable). Pure static SVG on the existing tick — no animation, reduced-motion clean.
export function Frametimeline({
  samples,
  refreshHz,
}: {
  samples: number[];
  refreshHz: number | null;
}) {
  const pts = samples.slice(-40);
  const W = 116;
  const H = 18;
  const { ceilingMs, budgetMs } = frametimeScale(
    refreshHz != null && refreshHz > 0 ? 1000 / refreshHz : null,
  );
  const y = (ms: number) => H - (Math.min(ms, ceilingMs) / ceilingMs) * (H - 2) - 1;
  const points = pts
    .map((v, i) => {
      const x = pts.length > 1 ? (i / (pts.length - 1)) * W : 0;
      return `${x.toFixed(1)},${y(v).toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className="ovl2-ft" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true">
      {budgetMs != null && (
        <line
          className="ovl2-ft-budget"
          x1="0"
          x2={W}
          y1={y(budgetMs).toFixed(1)}
          y2={y(budgetMs).toFixed(1)}
          stroke="var(--ix-text-3)"
          strokeOpacity="0.45"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      )}
      <polyline points={points} fill="none" stroke="var(--ix-accent)" strokeWidth="1.2" />
    </svg>
  );
}
