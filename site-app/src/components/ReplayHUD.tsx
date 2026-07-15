// Monitor session Replay HUD — the hero's living centerpiece.
//
// HONESTY CONTRACT (see src/data/session-replay.json provenance note):
// sessions.rs never persisted a per-frame fps series, so this replay animates ONLY what
// has true time data — the session clock, the ~1Hz sample counter, and the 51 recorded
// events at their real (time-compressed) timestamps. The fps numbers appear ONLY as
// end-of-session measured results. No invented fps-over-time trace, no gain claim.
//
// SSR/no-JS renders the measured summary directly (no dead play button — doorknob law);
// hydration adds the replay control. Reduced motion: play jumps straight to the results.
import { useEffect, useRef, useState } from "react";
import replay from "../data/session-replay.json";
import "../styles/replay.css";

const REPLAY_MS = 32000;
const SPEED = Math.round((replay.durationSecs * 1000) / REPLAY_MS); // ≈ ×338
const FEED_ROWS = 5;

function clock(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type Mode = "summary" | "playing";

export default function ReplayHUD() {
  const [hydrated, setHydrated] = useState(false);
  const [mode, setMode] = useState<Mode>("summary");
  const [elapsed, setElapsed] = useState(0); // session-seconds
  const [hasPlayed, setHasPlayed] = useState(false);
  const rafRef = useRef(0);

  useEffect(() => {
    setHydrated(true);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const play = () => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setElapsed(replay.durationSecs);
      setHasPlayed(true);
      setMode("summary");
      return;
    }
    setMode("playing");
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / REPLAY_MS);
      setElapsed(p * replay.durationSecs);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setHasPlayed(true);
        setMode("summary");
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  };

  const skip = () => {
    cancelAnimationFrame(rafRef.current);
    setElapsed(replay.durationSecs);
    setHasPlayed(true);
    setMode("summary");
  };

  const playing = mode === "playing";
  const samples = playing
    ? Math.floor((elapsed / replay.durationSecs) * replay.samples)
    : replay.samples;
  const visibleEvents = playing
    ? replay.events.filter((e) => e.atSecs <= elapsed).slice(-FEED_ROWS)
    : [];
  const progress = playing ? elapsed / replay.durationSecs : 1;

  return (
    <div className="rhud panel" aria-label="Replay of a real recorded Monitor session">
      <header className="rhud-top">
        <span className="chip chip--accent">
          <span className="dot" aria-hidden="true" />
          replay · real recorded session
        </span>
        <span className="chip">monitor · read-only telemetry</span>
      </header>

      <div className="rhud-meta readout">
        <span>{replay.game}</span>
        <span className="rhud-sep" aria-hidden="true">·</span>
        <span>{clock(replay.durationSecs)} session</span>
        <span className="rhud-sep" aria-hidden="true">·</span>
        <span>{replay.startedAt.slice(0, 10)}</span>
      </div>

      {playing ? (
        <div className="rhud-live" aria-live="off">
          <div className="rhud-grid">
            <div className="rhud-cell">
              <span className="rhud-label">session clock</span>
              <span className="rhud-value readout">{clock(elapsed)}</span>
            </div>
            <div className="rhud-cell">
              <span className="rhud-label">samples read</span>
              <span className="rhud-value readout">{samples.toLocaleString("en-US")}</span>
            </div>
            <div className="rhud-cell">
              <span className="rhud-label">replay speed</span>
              <span className="rhud-value readout">×{SPEED}</span>
            </div>
          </div>
          <div className="rhud-track" aria-hidden="true">
            <div className="rhud-fill" style={{ width: `${progress * 100}%` }} />
          </div>
          <ol className="rhud-feed readout" aria-label="Recorded session events">
            {visibleEvents.map((e) => (
              <li key={`${e.atSecs}-${e.label}`}>
                <span className="rhud-t">T+{clock(e.atSecs)}</span>
                <span className="rhud-kind">{e.kind}</span>
                <span className="rhud-evlabel">{e.label}</span>
              </li>
            ))}
            {visibleEvents.length === 0 && (
              <li className="rhud-quiet">
                <span className="rhud-t">T+{clock(elapsed)}</span>
                <span className="rhud-evlabel">no events yet — smooth so far</span>
              </li>
            )}
          </ol>
          <button className="btn btn--ghost rhud-skip" onClick={skip} type="button">
            skip to results ⏭
          </button>
        </div>
      ) : (
        <div className="rhud-results">
          <p className="rhud-computed mono">
            computed from {replay.samples.toLocaleString("en-US")} on-device samples
          </p>
          <div className="rhud-grid rhud-grid--results">
            <div className="rhud-cell">
              <span className="rhud-label">avg fps</span>
              <span className="rhud-value rhud-value--big readout">{replay.avgFps.toFixed(1)}</span>
            </div>
            <div className="rhud-cell">
              <span className="rhud-label">1% low</span>
              <span className="rhud-value rhud-value--big readout">
                {replay.low1FpsEst.toFixed(1)}
              </span>
            </div>
            <div className="rhud-cell">
              <span className="rhud-label">avg frametime</span>
              <span className="rhud-value readout">{replay.avgFrametimeMs.toFixed(1)} ms</span>
            </div>
            <div className="rhud-cell">
              <span className="rhud-label">peak gpu</span>
              <span className="rhud-value readout">
                {replay.peakGpuUsagePct}% · {replay.peakGpuTempC}°C
              </span>
            </div>
          </div>
          {hydrated && (
            <button className="btn btn--primary rhud-play" onClick={play} type="button">
              {hasPlayed ? "↺ replay the session" : "▶ replay the session"}
            </button>
          )}
        </div>
      )}

      <footer className="rhud-cap mono">
        {replay.rig} — every number read on-device. Measurement showcase only: no gain
        claim, nothing attributed to Compy changes.
      </footer>
    </div>
  );
}
