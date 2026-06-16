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
} from "../design/theme";
import { SessionDebrief } from "./SessionDebrief";
import { SessionTrends } from "./SessionTrends";
import { LiveCharts } from "./LiveCharts";
import { prettyGameName } from "./game-name";
import { type GpuVendor } from "./walkthroughs";
import "./Play.css";

// PLAY — live + debrief (halfway-home §1: navigation never teleports). The live-monitor card +
// overlay controls operate the SAME backend state via the SAME existing commands; session rows
// expand IN PLACE into the full existing debrief (no route to another tab). Zero new IPC.

type GpuLite = { temperature_c: number | null; utilization_gpu_pct: number | null };
type CpuLite = { usage_overall_pct: number };
type FpsLite = { active: boolean; sample: { fps: number; low1_fps: number } | null };
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

function shortVerdict(s: SessionSummary): string {
  const ratio = s.avg_fps > 0 ? s.low1_fps_est / s.avg_fps : 1;
  if (ratio >= 0.75) return "Smooth";
  if (ratio >= 0.55) return "Some dips";
  return "Rough";
}

function fmtDur(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m ${sec % 60}s`;
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

  // Live readout — same sensor commands the Monitoring tab uses, polled only while Play is active.
  useEffect(() => {
    if (!active) return;
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
  }, [active]);

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

  return (
    <section className="play-root">
      <header className="play-head">
        <h2 className="play-title">Monitor</h2>
        <p className="play-sub">Live while you play, and the debriefs after.</p>
      </header>

      {/* Live telemetry charts (dashboard energy) — rolling CPU/GPU/memory from real sensors. dash_v2. */}
      {typeof document !== "undefined" && document.documentElement.dataset.dashV2 === "on" && <LiveCharts />}

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
              <div className="play-metric-value">{sample ? Math.round(sample.fps) : "—"}</div>
              <div className="play-metric-label">FPS</div>
            </div>
            <div className="play-metric">
              <div className="play-metric-value">{sample ? Math.round(sample.low1_fps) : "—"}</div>
              <div className="play-metric-label">1% low</div>
            </div>
            <div className="play-metric">
              <div className="play-metric-value">{gpu?.temperature_c == null ? "—" : `${gpu.temperature_c}°`}</div>
              <div className="play-metric-label">GPU temp</div>
            </div>
            <div className="play-metric">
              <div className="play-metric-value">{cpu == null ? "—" : `${cpu}%`}</div>
              <div className="play-metric-label">CPU</div>
            </div>
          </div>
          <p className="play-honest">ETW · external · anti-cheat safe — no injection, no kernel driver.</p>
        </div>

        {/* Overlay card */}
        <div className="play-card">
          <div className="play-card-head">
            <span className="play-card-title">In-game overlay</span>
            <button className={`play-btn ${overlayOn ? "play-btn-on" : ""}`} onClick={toggleOverlay}>
              {overlayOn ? "Hide overlay" : "Show overlay"}
            </button>
          </div>
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
        </div>
      </div>

      {/* Full monitoring — the deep classic Monitoring panels (memory pressure, per-core, charts),
          ALWAYS inline (§3: no dropdown — Play is monitoring's home turf, so it shouldn't be a door on
          its own page). Polling stays gated by MonitoringTab's `active` prop (only while Play is the
          live room), so the cost stays honest without a collapse. */}
      {deepMonitoring && (
        <div className="play-monitor">
          <div className="play-monitor-head">
            <span className="play-monitor-title">Full monitoring &amp; charts</span>
            <span className="play-monitor-sub">memory pressure · per-core · live graphs</span>
          </div>
          <div className="play-monitor-body">{deepMonitoring}</div>
        </div>
      )}

      {/* Sessions — rows expand IN PLACE into the full debrief (no route; navigation never teleports). */}
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
                        {s.avg_fps.toFixed(0)} avg · {s.low1_fps_est.toFixed(0)} 1% low
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
        <SessionTrends sessions={sessions} />
      </div>
    </section>
  );
}
