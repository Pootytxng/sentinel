import { useCallback, useEffect, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { SessionSummary, Priorities, Recommendation, AppliedChange } from "../types";
import {
  type OverlayDensity,
  type OverlayBackdrop,
  readOverlayDensity,
  persistOverlayDensity,
  readOverlayBackdrop,
  persistOverlayBackdrop,
  readDisplayRefreshHz,
} from "../design/theme";
import { SessionDebrief } from "./SessionDebrief";
import { SessionTrends } from "./SessionTrends";
import { LiveCharts } from "./LiveCharts";
import { readMonitorCards } from "../design/theme";
import { prettyGameName } from "./game-name";
import { Term } from "../design/Term";
import { type GpuVendor } from "./walkthroughs";
import {
  gradeFps,
  gradeLow1,
  gradeFrametimeMs,
  gradeColor,
  type Grade,
} from "../data/metric-grade";
import { gradeGpuTempForVendor } from "../data/gpu-sensor";
import "./Play.css";

// PLAY — live + debrief (halfway-home §1: navigation never teleports). The live-monitor card +
// overlay controls operate the SAME backend state via the SAME existing commands; session rows
// expand IN PLACE into the full existing debrief (no route to another tab). Zero new IPC.

type GpuLite = { temperature_c: number | null; utilization_gpu_pct: number | null };
type CpuLite = { usage_overall_pct: number };
type FpsLite = { active: boolean; status: string; sample: { fps: number; low1_fps: number } | null };
type ArmedLite = { game: string } | null;

const CORNERS: [string, string][] = [
  ["top-left", "↖"],
  ["top-right", "↗"],
  ["bottom-left", "↙"],
  ["bottom-right", "↘"],
];

function pickGpu(list: GpuLite[]): GpuLite | null {
  if (list.length === 0) return null;
  return [...list].sort((a, b) => (b.temperature_c ?? -1) - (a.temperature_c ?? -1))[0];
}

// Exported for MonitorBasic (P2 Basic tiles' last-session line) — same verdict/duration wording
// everywhere, one source. Rendering here is unchanged.
export function shortVerdict(s: SessionSummary): string {
  const ratio = s.avg_fps > 0 ? s.low1_fps_est / s.avg_fps : 1;
  if (ratio >= 0.75) return "Smooth";
  if (ratio >= 0.55) return "Some dips";
  return "Rough";
}

export function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${sec % 60}s`;
}

// Inline color for a graded metric value — applied only when the grade is non-neutral (neutral
// inherits). Same hardware-tailored grading as Home / SessionDebrief / Overlay, so the SAME metric
// reads the same green/amber/red everywhere. Utilisation (CPU/GPU %) stays ungraded by design.
function gradeStyle(g: Grade): { color: string } | undefined {
  const c = gradeColor(g);
  return c ? { color: c } : undefined;
}

export default function Play({
  active,
  sessions,
  sessionsSeenAt,
  priorities,
  recs,
  apply,
  busyId,
  onExport,
  changes,
  rollback,
  deepMonitoring,
  vendor = "any",
  view = "all",
  onFpsActive,
  v2 = false,
}: {
  active: boolean;
  sessions: SessionSummary[];
  sessionsSeenAt: string;
  priorities: Priorities | null;
  recs: Recommendation[];
  apply: (rec: Recommendation) => Promise<void>;
  busyId: string | null;
  onExport: () => void;
  changes: AppliedChange[];
  rollback: (c: AppliedChange) => Promise<void>;
  deepMonitoring?: ReactNode;
  vendor?: GpuVendor;
  // Monitor restructure (spec 2026-06-21): the Monitor shell renders Play twice under a segmented
  // control. "all" (default) = today's whole surface byte-identical (flag-off path); "sessions" = the
  // session list + trends only (no live cards/charts); "live" = the live monitor + overlay + deep
  // monitoring only (no sessions). Mirrors Fix's `view`.
  view?: "all" | "sessions" | "live";
  // V2-8 (additive — absent = classic byte-identical): reports the polled FPS-capture state up so
  // the V2 Monitor room can close its forward door during a live session (P6 §2). Same
  // get_fps_status read the live card already makes — no second IPC, nothing new polled.
  onFpsActive?: (active: boolean) => void;
  // V2-9 (additive — absent = classic byte-identical): under the v2 room the RoomShell measured
  // line already states "N sessions on record", so the History & trends header drops its own
  // count (one screen never states the same fact twice — the punch (j) law).
  v2?: boolean;
}) {
  const [fps, setFps] = useState<FpsLite | null>(null);
  const [gpu, setGpu] = useState<GpuLite | null>(null);
  const [cpu, setCpu] = useState<number | null>(null);
  const [fpsBusy, setFpsBusy] = useState(false);
  const [overlayOn, setOverlayOn] = useState(false);
  const [density, setDensity] = useState<OverlayDensity>(readOverlayDensity);
  const [backdrop, setBackdrop] = useState<OverlayBackdrop>(readOverlayBackdrop);
  const [corner, setCorner] = useState<string>(
    () => localStorage.getItem("compy_overlay_corner") ?? "top-left",
  );
  const [armed, setArmed] = useState<ArmedLite>(null);
  const [openKey, setOpenKey] = useState<string | null>(null);
  // Live view collapses the overlay config (density/background/corner) behind a toggle so the landing
  // shows just the on/off button; "all" (flag-off) keeps it inline (byte-identical).
  const [overlayCfgOpen, setOverlayCfgOpen] = useState(false);

  // Hardware-tailored grade context (this rig's monitor refresh) — the same source SessionDebrief
  // uses, so Play's FPS/frametime grade matches Home / debrief / overlay.
  const rig = { refreshHz: readDisplayRefreshHz() };
  // NVIDIA NVML sensors aren't hardware-verified yet (LOCKED rule #5) — don't grade their temp as
  // authoritative; AMD/unknown stay graded. Routed through the shared gpu-sensor helper (one source).
  const tempGrade = (c: number | null | undefined): Grade => gradeGpuTempForVendor(vendor, c);

  // Live readout — same sensor commands the Monitoring tab uses, polled only while Play is active AND
  // the live view is actually showing. On the Sessions segment (the default landing) the live cards
  // aren't rendered, so polling there was pure waste that also kept the backend sensor threads awake —
  // demand-gate it on the segment, not just the tab. (LiveCharts + the deep MonitoringTab are already
  // mount-gated on `showLive`, so they never polled on Sessions; this closes the last segment-leak.)
  useEffect(() => {
    if (!active || view === "sessions") return;
    let cancelled = false;
    const tick = () => {
      invoke<GpuLite[]>("get_gpu_sensors").then((g) => !cancelled && setGpu(pickGpu(g))).catch(() => {});
      invoke<CpuLite>("get_cpu_sensors")
        .then((c) => !cancelled && setCpu(Math.round(c.usage_overall_pct)))
        .catch(() => {});
      invoke<FpsLite>("get_fps_status").then((f) => !cancelled && setFps(f)).catch(() => {});
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [active, view]);

  // V2-8: mirror the already-polled capture state up to the shell (no-op without the callback).
  const fpsActive = fps?.active ?? false;
  useEffect(() => {
    onFpsActive?.(fpsActive);
  }, [onFpsActive, fpsActive]);

  // Reflect the actual overlay window state + any armed comparison (existing commands).
  useEffect(() => {
    invoke<boolean>("overlay_visible").then(setOverlayOn).catch(() => {});
    invoke<ArmedLite>("get_armed_comparison").then(setArmed).catch(() => {});
  }, [active, sessions]);

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

  const chooseDensity = (d: OverlayDensity) => {
    setDensity(d);
    persistOverlayDensity(d); // overlay window reacts via the cross-window storage event
  };
  const chooseBackdrop = (b: OverlayBackdrop) => {
    setBackdrop(b);
    persistOverlayBackdrop(b); // same relay as density
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

  const sample = fps?.sample ?? null;
  const latest = sessions[0] ?? null;

  // Monitor restructure: which half(s) to render. "all" (flag-off) shows both, byte-identical to today.
  const showLive = view !== "sessions";
  const showSessions = view !== "live";
  // Live view collapses the overlay config; "all" keeps it inline.
  const collapseOverlayCfg = view === "live";
  const overlayCfgVisible = !collapseOverlayCfg || overlayOn || overlayCfgOpen;

  return (
    <section className="play-root">
      {/* The standalone "Monitor" title only shows in the classic (flag-off) surface; inside the merged
          Monitor shell the Sessions/Live segment label provides the context (no stacked headings). */}
      {view === "all" && (
        <header className="play-head">
          <h2 className="play-title">Monitor</h2>
          <p className="play-sub">Live while you play, and the debriefs after.</p>
        </header>
      )}

      {/* Last-session hero — the Sessions face surfaces the debrief that's otherwise buried below. */}
      {view === "sessions" && latest && (
        <div className="play-hero">
          <div className="play-hero-top">
            <span className="play-hero-game">{prettyGameName(latest.process_name) || "Last session"}</span>
            <span className="play-hero-verdict">{shortVerdict(latest)} · {fmtDur(latest.duration_secs)}</span>
          </div>
          <div className="play-hero-metrics">
            <div className="play-hero-metric">
              <span className="play-hero-value" style={gradeStyle(gradeFps(latest.avg_fps, rig))}>{latest.avg_fps.toFixed(0)}</span>
              <span className="play-hero-label"><Term id="hz-vs-fps">avg FPS</Term></span>
            </div>
            <div className="play-hero-metric">
              <span className="play-hero-value" style={gradeStyle(gradeLow1(latest.low1_fps_est, latest.avg_fps))}>{latest.low1_fps_est.toFixed(0)}</span>
              <span className="play-hero-label"><Term id="one-percent-lows">1% low</Term> · est</span>
            </div>
            <div className="play-hero-metric">
              <span className="play-hero-value" style={gradeStyle(gradeFrametimeMs(latest.avg_frametime_ms, rig))}>{latest.avg_frametime_ms.toFixed(1)}</span>
              <span className="play-hero-label">ms <Term id="frametime">frametime</Term></span>
            </div>
            <div className="play-hero-metric">
              <span className="play-hero-value" style={gradeStyle(tempGrade(latest.peak_gpu_temp_c))}>{latest.peak_gpu_temp_c == null ? "—" : `${latest.peak_gpu_temp_c}°C`}</span>
              <span className="play-hero-label">peak GPU</span>
            </div>
          </div>
        </div>
      )}

      {/* Live telemetry charts (dashboard energy) — rolling CPU/GPU/memory from real sensors. dash_v2.
          Superseded by the T3 domain cards (same three domains + Cores, one-click detail): when
          compy_monitor_cards is ON, LiveCharts yields — one screen never shows the same domain
          headlines twice (self-review catch, 2026-07-06). */}
      {showLive &&
        !readMonitorCards() &&
        typeof document !== "undefined" &&
        document.documentElement.dataset.dashV2 === "on" && <LiveCharts />}

      {showLive && (
      <div className="play-cards">
        {/* Live monitor card */}
        <div className="play-card">
          <div className="play-card-head">
            <span className="play-card-title">Live monitor</span>
            <button
              className={`play-btn ${fps?.active ? "play-btn-on" : ""}`}
              disabled={fpsBusy}
              onClick={toggleCapture}
            >
              {fpsBusy ? "…" : fps?.active ? "Stop FPS capture" : "Start FPS capture"}
            </button>
          </div>
          <div className="play-live">
            <div className="play-metric">
              <div className="play-metric-value" style={sample ? gradeStyle(gradeFps(sample.fps, rig)) : undefined}>{sample ? Math.round(sample.fps) : "—"}</div>
              <div className="play-metric-label"><Term id="hz-vs-fps">FPS</Term></div>
            </div>
            <div className="play-metric">
              <div className="play-metric-value" style={sample ? gradeStyle(gradeLow1(sample.low1_fps, sample.fps)) : undefined}>{sample ? Math.round(sample.low1_fps) : "—"}</div>
              <div className="play-metric-label"><Term id="one-percent-lows">1% low</Term> · est</div>
            </div>
            <div className="play-metric">
              <div className="play-metric-value" style={gradeStyle(tempGrade(gpu?.temperature_c ?? null))}>{gpu?.temperature_c == null ? "—" : `${gpu.temperature_c}°C`}</div>
              <div className="play-metric-label">GPU temp</div>
            </div>
            <div className="play-metric">
              <div className="play-metric-value">{cpu == null ? "—" : `${cpu}%`}</div>
              <div className="play-metric-label">CPU</div>
            </div>
          </div>
          {fps?.status === "declined" && (
            <p className="play-honest">
              Administrator permission was declined — tap “Start FPS capture” to allow it.
            </p>
          )}
          {fps?.active && !sample && fps?.status !== "declined" && (
            <p className="play-honest">
              Capturing… launch or focus a DX11/DX12 game to see frames (Vulkan/OpenGL aren't counted yet).
            </p>
          )}
          <p className="play-honest"><Term id="etw">ETW</Term> · external · anti-cheat safe — no injection, no kernel driver.</p>
        </div>

        {/* Overlay card */}
        <div className="play-card">
          <div className="play-card-head">
            <span className="play-card-title">In-game overlay</span>
            <button className={`play-btn ${overlayOn ? "play-btn-on" : ""}`} onClick={toggleOverlay}>
              {overlayOn ? "Hide overlay" : "Show overlay"}
            </button>
          </div>
          {overlayCfgVisible ? (
            <>
              <div className="play-field-label">Density</div>
              <div className="play-seg" role="group" aria-label="Overlay density">
                {(["minimal", "standard", "full"] as OverlayDensity[]).map((d) => (
                  <button
                    key={d}
                    className={`play-seg-btn ${density === d ? "play-seg-on" : ""}`}
                    aria-pressed={density === d}
                    onClick={() => chooseDensity(d)}
                  >
                    {d.charAt(0).toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
              <div className="play-field-label">Background</div>
              <div className="play-seg" role="group" aria-label="Overlay background">
                {(["on", "off"] as OverlayBackdrop[]).map((b) => (
                  <button
                    key={b}
                    className={`play-seg-btn ${backdrop === b ? "play-seg-on" : ""}`}
                    aria-pressed={backdrop === b}
                    onClick={() => chooseBackdrop(b)}
                  >
                    {b === "on" ? "On" : "Off"}
                  </button>
                ))}
              </div>
              <div className="play-field-label">Corner</div>
              <div className="play-corners">
                {CORNERS.map(([c, glyph]) => (
                  <button
                    key={c}
                    className={`play-corner ${corner === c ? "play-corner-on" : ""}`}
                    onClick={() => chooseCorner(c)}
                    title={c.replace("-", " ")}
                    aria-label={`Move the overlay to the ${c.replace("-", " ")} corner`}
                    aria-pressed={corner === c}
                  >
                    {glyph}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <button className="play-cfg-toggle" onClick={() => setOverlayCfgOpen(true)}>
              Overlay settings ▸
            </button>
          )}
        </div>
      </div>
      )}

      {/* Full monitoring — the deep classic Monitoring panels (memory pressure, per-core, charts).
          Polling stays gated by MonitoringTab's `active` prop (only while Play is the live room). */}
      {showLive && deepMonitoring && (
        <div className="play-monitor">
          <div className="play-monitor-head">
            <span className="play-monitor-title">Full monitoring &amp; charts</span>
            <span className="play-monitor-sub">memory pressure · per-core · live graphs</span>
          </div>
          <div className="play-monitor-body">{deepMonitoring}</div>
        </div>
      )}

      {/* Sessions — rows expand IN PLACE into the full debrief (no route; navigation never teleports). */}
      {showSessions && (
      <div className="play-sessions">
        <div className="play-section-label">Recent sessions</div>
        {sessions.length === 0 ? (
          <p className="play-empty">
            Play a session to see this — Compy captures it from outside the game.
          </p>
        ) : (
          <ul className="play-list">
            {/* Free view: the most recent 20. The full retained history + trends is the Pro panel below. */}
            {sessions.slice(0, 20).map((s, i) => {
              const key = `${s.started_at}-${i}`;
              const open = openKey === key;
              const unviewed = i === 0 && latest != null && latest.started_at !== sessionsSeenAt;
              const isArmed = armed != null && armed.game === s.process_name;
              return (
                <li key={key} className={`play-session-item ${open ? "play-session-open" : ""}`}>
                  <button
                    className="play-session cmp-door"
                    aria-expanded={open}
                    onClick={() => setOpenKey(open ? null : key)}
                  >
                    <span className="play-session-main">
                      {unviewed && <span className="play-dot" aria-label="new" />}
                      <span className="play-session-game">{prettyGameName(s.process_name) || "Unknown game"}</span>
                      <span className="play-session-meta">
                        {fmtDur(s.duration_secs)} · {shortVerdict(s)}
                        {isArmed && <span className="play-armed">comparison armed</span>}
                      </span>
                    </span>
                    <span className="play-session-right">
                      <span className="play-session-nums">
                        {s.avg_fps.toFixed(0)} avg · {s.low1_fps_est.toFixed(0)} 1% low (est)
                      </span>
                      <span className="cmp-door-chevron" aria-hidden="true">▸</span>
                    </span>
                  </button>
                  {open && (
                    <div className="play-debrief-wrap">
                      <SessionDebrief
                        s={s}
                        priorities={priorities}
                        recs={recs}
                        apply={apply}
                        busyId={busyId}
                        onExport={onExport}
                        changes={changes}
                        rollback={rollback}
                        vendor={vendor}
                        sessions={sessions}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {/* Compy Pro: long-term history & trends over the full retained set (ProGate — inert/free while
            licensing is disarmed, gated when armed + not Pro). Self-hides until there are ≥2 sessions. */}
        <SessionTrends sessions={sessions} hideCount={v2} />
      </div>
      )}
    </section>
  );
}
