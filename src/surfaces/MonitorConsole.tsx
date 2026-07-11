import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary } from "../types";
import { readDisplayRefreshHz } from "../design/theme";
import { useDocumentVisible } from "../data/use-document-visible";
import { useReducedMotion } from "../design/use-motion";
import {
  gradeFps,
  gradeLow1,
  gradeFrametimeMs,
  gradeRamPct,
  gradeColor,
  type Grade,
} from "../data/metric-grade";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
import { ArcGauge, type ArcTone } from "../design/console/ArcGauge";
import { Oscilloscope } from "../design/console/Oscilloscope";
import { ReticleCursor } from "../design/console/ReticleCursor";
import { Term } from "../design/Term";
import { readoutStats, type ReadoutStats } from "./monitor-console-data";
import { SessionWaterfall } from "./monitor/SessionWaterfall";
import { prettyGameName } from "./game-name";
import { shortVerdict, fmtDur } from "./Play";
import type { GpuVendor } from "./walkthroughs";
import "./monitor-console.css";

// MonitorConsole — the Monitor room's Live face as the console instrument cluster (plan
// 2026-07-10-console-hud-phase3-monitor; direction spec 2026-07-09-compy-console-hud-direction,
// Monitor row: the arc gauges + oscilloscope traces are REAL live telemetry, not decoration —
// deliberately NO hologram, NO parallax). Behind compy_monitor_console, DEFAULT OFF; flag off,
// MonitorV2 renders exactly today's faces (pinned by monitor-console-flag.test.tsx).
//
// Honesty contract: presentation only over the SAME audited read-only polls MonitorBasic /
// Play's live card run — the identical three 1 Hz commands, cadence, cancellation, and
// visibility gate, ported verbatim (zero new IPC, zero src-tauri). Every instrument value
// traces to a real sample: the fps trace buffers the real polled capture samples (cleared the
// moment the helper stops — a frozen trace can never pose as live), the frametime trace draws
// the backend's real per-frame window (recent_frametimes_ms, the same stream the Overlay
// draws), and gauges render null as ArcGauge's honest NOT-YET — never a fabricated 0. GPU temp
// tone is vendor-gated via gradeGpuTempForVendor (NVIDIA stays ungraded — LOCKED rule 5).

type CpuSnap = {
  usage_overall_pct: number;
  frequency_mhz: number;
  ram_used_bytes: number;
  ram_total_bytes: number;
};
type GpuSnap = { vendor?: string; temperature_c: number | null; utilization_gpu_pct: number | null };
// Same wire shape monitor-panels/Overlay already type — real backend fields, nothing invented.
type FpsSample = {
  fps: number;
  low1_fps: number;
  avg_frametime_ms: number;
  recent_frametimes_ms: number[];
};
type FpsLite = { active: boolean; status: string; sample: FpsSample | null };

// Same corner set as Play's overlay config (ported, not forked).
const CORNERS: [string, string][] = [
  ["top-left", "↖"],
  ["top-right", "↗"],
  ["bottom-left", "↙"],
  ["bottom-right", "↘"],
];

// Hottest GPU wins (same pick rule as MonitorBasic / Play's live card).
function pickGpu(list: GpuSnap[]): GpuSnap | null {
  if (!list || list.length === 0) return null;
  return [...list].sort((a, b) => (b.temperature_c ?? -1) - (a.temperature_c ?? -1))[0];
}

// Grade → ArcGauge/Oscilloscope tone — HomeConsole's mapping: "ok" rides the accent (fine, not
// celebrated), "bad" warns; neutral never borrows a judgment color.
const arcTone = (g: Grade): ArcTone =>
  g === "good" ? "good" : g === "ok" ? "accent" : g === "bad" ? "warn" : "neutral";

// The fps trace window: 1 Hz polled samples, so ~2 minutes of capture history.
const FPS_CAP = 120;
// The frametime window is the backend's own cap (MAX_FRAMETIME_POINTS in fps.rs).
const FT_CAP = 240;

export function MonitorConsole({
  active,
  vendor = "any",
  mode,
  sessions = [],
  onFpsActive,
  onOpenSessions,
}: {
  active: boolean;
  vendor?: GpuVendor;
  /** Basic shows the core instrument set; Advanced the full cluster (the existing faces' split). */
  mode: "basic" | "advanced";
  /** Session history (newest-first): the waterfall's SESSIONS layers in both modes, plus
   *  Basic's last-session door content (Advanced reaches the list via its own tab). */
  sessions?: SessionSummary[];
  /** Mirrors the room's live capture state up to MonitorV2 (the V2-8 forward-door rule). */
  onFpsActive?: (active: boolean) => void;
  /** Basic's route into Advanced → Sessions (never a dead end) — same door MonitorBasic has. */
  onOpenSessions?: () => void;
}) {
  const reduced = useReducedMotion();
  const [cpu, setCpu] = useState<CpuSnap | null>(null);
  const [gpu, setGpu] = useState<GpuSnap | null>(null);
  const [fps, setFps] = useState<FpsLite | null>(null);
  const [fpsBusy, setFpsBusy] = useState(false);
  // In-game overlay — the SAME audited commands Play's live face runs, ported verbatim (owner
  // §A0 item 1: the control must exist on the console face; density/backdrop stay classic-only
  // for now — logged in UI_VISION_BACKLOG as an explicit residual).
  const [overlayOn, setOverlayOn] = useState(false);
  const [corner, setCorner] = useState<string>(
    () => localStorage.getItem("compy_overlay_corner") ?? "top-left",
  );
  // Caller-owned trace buffer (Oscilloscope is a pure render): real polled fps values only.
  const fpsH = useRef<number[]>([]);
  // The frametime window with a CONTENT-STABLE reference (self-review round-1 catch, bug→guard):
  // every 1 Hz poll deserializes a fresh array even when the frames didn't change, and a
  // reference-new-but-equal array rebuilt the ribbon geometry + repainted the demand-mode canvas
  // every tick. Keep the previous array unless the VALUES differ, so downstream memos hold.
  const ftWin = useRef<number[]>([]);
  const visible = useDocumentVisible();
  const stageRef = useRef<HTMLDivElement>(null);

  // Cursor-follow spotlight (Phase 2's exact mechanism, event-driven — no rAF loop): the
  // pointer handler writes --glow-x/--glow-y/--glow-intensity on the instrument stage; a
  // border-masked ::after consumes them. Reduced pins intensity to 0 (still page).
  // Deliberately NO parallax over the traces — readability outranks depth on a data surface.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (reduced) {
      stage.style.setProperty("--glow-intensity", "0");
      return;
    }
    const onMove = (e: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = (e.clientY - r.top) / r.height;
      stage.style.setProperty("--glow-x", `${nx * 100}%`);
      stage.style.setProperty("--glow-y", `${ny * 100}%`);
      stage.style.setProperty("--glow-intensity", "1");
      // v3 depth chrome (§A0 item 5 amendment): the WHOLE stage tilts a few degrees toward the
      // pointer — a uniform transform, so plot ink and grid move together and a spike's position
      // never lies (the "depth moves the panel, never warps the data ink" rail).
      stage.style.setProperty("--tilt-x", `${(-(ny * 2 - 1) * 2).toFixed(2)}deg`);
      stage.style.setProperty("--tilt-y", `${((nx * 2 - 1) * 2.5).toFixed(2)}deg`);
    };
    const onLeave = () => {
      stage.style.setProperty("--glow-intensity", "0");
      stage.style.setProperty("--tilt-x", "0deg");
      stage.style.setProperty("--tilt-y", "0deg");
    };
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);
    return () => {
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced]);

  // Same 1 Hz read-only poll as MonitorBasic / Play live — verbatim commands, cadence,
  // cancellation, and the tab+window visibility gate (sensors idle in the background).
  useEffect(() => {
    if (!active || !visible) return;
    let cancelled = false;
    const tick = () => {
      invoke<CpuSnap>("get_cpu_sensors").then((c) => !cancelled && c && setCpu(c)).catch(() => {});
      invoke<GpuSnap[]>("get_gpu_sensors").then((g) => !cancelled && setGpu(pickGpu(g))).catch(() => {});
      invoke<FpsLite>("get_fps_status")
        .then((f) => {
          if (cancelled || !f) return;
          // Honesty rail: buffer only live real samples; the moment the helper reports stopped
          // the buffer clears, so the trace goes to its no-signal state (never frozen-as-live).
          if (f.active && f.sample) {
            fpsH.current = [...fpsH.current, f.sample.fps].slice(-FPS_CAP);
            const next = f.sample.recent_frametimes_ms;
            const prev = ftWin.current;
            if (prev.length !== next.length || prev.some((v, i) => v !== next[i])) {
              ftWin.current = next;
            }
          } else if (!f.active) {
            fpsH.current = [];
            ftWin.current = [];
          }
          setFps(f);
        })
        .catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active, visible]);

  // V2-8: mirror the already-polled capture state up to the shell (no-op without the callback).
  const fpsActive = fps?.active ?? false;
  useEffect(() => {
    onFpsActive?.(fpsActive);
  }, [onFpsActive, fpsActive]);

  // Reflect the actual overlay window state (existing command, same read Play makes).
  useEffect(() => {
    invoke<boolean>("overlay_visible").then(setOverlayOn).catch(() => {});
  }, [active]);

  const toggleOverlay = async () => {
    try {
      if (overlayOn) {
        await invoke("hide_overlay");
        setOverlayOn(false);
      } else {
        await invoke("show_overlay");
        setOverlayOn(true);
        invoke("set_overlay_corner", { corner }).catch(() => {});
      }
    } catch {
      /* leave as-is */
    }
  };

  const chooseCorner = async (c: string) => {
    setCorner(c);
    localStorage.setItem("compy_overlay_corner", c);
    try {
      await invoke("set_overlay_corner", { corner: c });
    } catch {
      /* applies next time the overlay is shown */
    }
  };

  // The existing audited capture commands — identical semantics to MonitorBasic/Play's button.
  const toggleCapture = useCallback(async () => {
    setFpsBusy(true);
    try {
      if (fps?.active) {
        await invoke("stop_fps_capture");
        fpsH.current = [];
        ftWin.current = [];
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
  const live = fpsActive && sample != null;
  const ramPct = cpu?.ram_total_bytes
    ? Math.round((cpu.ram_used_bytes / cpu.ram_total_bytes) * 100)
    : null;
  const latest = sessions[0] ?? null;

  const gpuGrade = gradeGpuTempForVendor(vendor, gpu?.temperature_c ?? null);
  const low1Grade: Grade = sample ? gradeLow1(sample.low1_fps, sample.fps) : "neutral";

  // v3 (UI_VISION_BACKLOG §A0): the frame budget for THIS rig's display — the spike detector's
  // floor and the trace's budget line. Consumer-term readouts derive from the same real windows.
  const ftBudget = rig.refreshHz ? 1000 / rig.refreshHz : undefined;
  const stats: ReadoutStats = live
    ? readoutStats(fpsH.current, ftWin.current, ftBudget)
    : { maxFps: null, avgFps: null, lowestLatencyMs: null, spikeCount: null };
  const ink = (g: Grade) => {
    const c = gradeColor(g);
    return c ? { color: c } : undefined;
  };

  return (
    <div className={`monitor-console mc-${mode}`} data-motion={reduced ? "reduced" : "full"}>
      {/* The room's real capture control — same audited toggle the classic tiles carry. */}
      <div className="mc-capture">
        <button
          type="button"
          className={`mc-cap ${fpsActive ? "mc-cap-on" : ""}`}
          disabled={fpsBusy}
          onClick={toggleCapture}
        >
          {fpsBusy ? "…" : fpsActive ? "Stop capture" : "Start capture"}
        </button>
        <span className="mc-cap-status" style={live ? { color: gradeColor(low1Grade) || undefined } : undefined}>
          {live ? (
            <>
              {Math.round(sample.low1_fps)} <Term id="one-percent-lows">1% low</Term> · est
            </>
          ) : fps?.status === "declined" ? (
            "admin permission declined — tap Start capture to allow it"
          ) : fpsActive ? (
            "capturing — focus a DX11/DX12 game"
          ) : (
            "start capture, then play"
          )}
        </span>
        {/* The in-game overlay's control — the room's other real action (§A0 item 1). */}
        <span className="mc-ov">
          <button
            type="button"
            className={`mc-cap ${overlayOn ? "mc-cap-on" : ""}`}
            onClick={toggleOverlay}
          >
            {overlayOn ? "Overlay on" : "Overlay"}
          </button>
          {overlayOn &&
            CORNERS.map(([c, glyph]) => (
              <button
                key={c}
                type="button"
                className={`mc-ov-corner ${corner === c ? "mc-ov-corner-on" : ""}`}
                aria-label={`Overlay corner ${c.replace("-", " ")}`}
                onClick={() => chooseCorner(c)}
              >
                {glyph}
              </button>
            ))}
        </span>
      </div>

      {/* THE INSTRUMENT STAGE — the signature instruments: the motion IS the data, real
          buffered samples only. Spotlight + reticle live here; NO hologram, NO parallax. */}
      <div className="mc-stage" ref={stageRef}>
        {/* Consumer-term readouts (owner direction §A0 item 6) — measured values only, em-dash
            when nothing is measured. Same windows the traces draw; spike count = the SAME
            detector as the markers (one source, can't disagree). */}
        <div className="mc-readouts">
          <div className="mc-readout">
            <span className="mc-readout-v" style={ink(gradeFps(stats.maxFps, rig))}>
              {stats.maxFps == null ? "—" : Math.round(stats.maxFps)}
            </span>
            <span className="mc-readout-k">MAX FPS</span>
          </div>
          <div className="mc-readout">
            <span className="mc-readout-v" style={ink(gradeFps(stats.avgFps, rig))}>
              {stats.avgFps == null ? "—" : Math.round(stats.avgFps)}
            </span>
            <span className="mc-readout-k">AVG FPS</span>
          </div>
          <div className="mc-readout">
            <span
              className="mc-readout-v"
              style={ink(gradeFrametimeMs(stats.lowestLatencyMs, rig))}
            >
              {stats.lowestLatencyMs == null ? "—" : `${stats.lowestLatencyMs.toFixed(1)} ms`}
            </span>
            <span className="mc-readout-k">LOWEST LATENCY</span>
          </div>
          <div className="mc-readout">
            <span
              className="mc-readout-v"
              style={stats.spikeCount ? ink("bad") : undefined}
            >
              {stats.spikeCount == null ? "—" : stats.spikeCount}
            </span>
            <span className="mc-readout-k">SPIKES</span>
          </div>
        </div>

        {/* THE HERO — the v4 Session Waterfall (owner-picked concept B + A's drag-segment,
            plan 2026-07-10-monitor-v4-session-waterfall; the v3 ribbon is deleted). LIVE mode
            recedes the same real per-frame window; SESSIONS mode compares the last games'
            recorded timelines. Always mounted — each mode carries its own honest empty. */}
        <SessionWaterfall
          ftWin={ftWin.current}
          live={live}
          budget={ftBudget}
          sessions={sessions}
          reduced={reduced}
        />
        <div className="mc-scopes">
          <Oscilloscope
            samples={live ? fpsH.current : []}
            cap={FPS_CAP}
            label="fps"
            unit="fps"
            tone={live ? arcTone(gradeFps(sample.fps, rig)) : "accent"}
            reduced={reduced}
          />
          <Oscilloscope
            samples={live ? ftWin.current : []}
            cap={FT_CAP}
            label="frametime"
            unit="ms"
            tone={live ? arcTone(gradeFrametimeMs(sample.avg_frametime_ms, rig)) : "accent"}
            reduced={reduced}
            budget={ftBudget}
            spikes
          />
        </div>

        {/* Honest gauges over the same sensor reads the tiles surface; null ⇒ NOT-YET, never 0.
            CPU utilisation stays deliberately ungraded (high while gaming is fine). */}
        <div className="mc-gauges">
          <ArcGauge
            label="GPU temp"
            value={gpu?.temperature_c ?? null}
            max={100}
            unit="°C"
            tone={arcTone(gpuGrade)}
            measured={gpu?.temperature_c != null}
          />
          {mode === "advanced" && (
            <ArcGauge
              label="GPU load"
              value={gpu?.utilization_gpu_pct ?? null}
              max={100}
              unit="%"
              tone="neutral"
              measured={gpu?.utilization_gpu_pct != null}
            />
          )}
          <ArcGauge
            label="CPU"
            value={cpu ? Math.round(cpu.usage_overall_pct) : null}
            max={100}
            unit="%"
            tone="neutral"
            measured={cpu != null}
          />
          <ArcGauge
            label="RAM"
            value={ramPct}
            max={100}
            unit="%"
            tone={arcTone(gradeRamPct(ramPct))}
            measured={ramPct != null}
          />
        </div>

        {/* The game-HUD Target Cursor, stage-scoped (kit handles reduced/coarse-pointer null
            + the rAF pointerleave stop — Phase-1's review fix). */}
        <ReticleCursor scopeRef={stageRef} />
      </div>

      {/* Same honesty micro-line the classic face carries — method stated. */}
      <p className="mc-honest">
        <Term id="etw">ETW</Term> · external · anti-cheat safe — no injection, no kernel driver.
      </p>

      {/* Basic collapses Sessions away, so it keeps MonitorBasic's door (never a dead end);
          Advanced reaches sessions via its own tab. */}
      {mode === "basic" && latest && (
        <button type="button" className="mc-last cmp-door" onClick={onOpenSessions}>
          <span className="mc-last-k">Last session</span>
          <span className="mc-last-v">
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

export default MonitorConsole;
