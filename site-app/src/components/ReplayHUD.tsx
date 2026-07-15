// Monitor session Replay HUD — the record deck's instrument core.
//
// HONESTY CONTRACT (see src/data/session-replay.json provenance note):
// sessions.rs never persisted a per-frame fps series, so this deck animates ONLY what
// has true time data — the session clock, the ~1Hz sample counter, and the 51 recorded
// events at their real timestamps. The fps numbers appear ONLY as end-of-session
// measured results. No invented fps-over-time trace, no gain claim.
//
// SCRUB MODE (Design Director change #5): with JS + motion allowed, the page scroll IS
// the transport — the .record section becomes a runway, the deck pins, and scroll
// position scrubs the real 3:00:05 session bidirectionally (event-timeline canvas,
// session clock, sample counter, event feed), landing on the measured results as the
// deck unpins. SSR / no-JS / reduced-motion render the finished measured summary with
// no runway and no dead control (doorknob law).
import { useEffect, useRef, useState } from "react";
import replay from "../data/session-replay.json";
import "../styles/replay.css";

const DURATION = replay.durationSecs;
const EVENTS = replay.events;
const FEED_ROWS = 5;
const DONE_AT = 0.985; // scrub progress where the results stamp lands

// Density-weighted transport (Director review 2026-07-15): all 51 recorded events land
// in the first ~38% of the 3h session, so a linear scroll→time map idles for most of
// the runway. Spend ACTIVE_SHARE of the scroll on the event-dense span (0 → last event)
// and compress the quiet tail into a fast coda. Transport SPEED only — every clock
// reading, sample count, and event timestamp stays true to the record.
const LAST_EVENT = Math.max(...EVENTS.map((e) => e.atSecs));
const ACTIVE_SHARE = 0.85;

function timeOf(p: number): number {
  if (p >= 1) return DURATION;
  if (p <= ACTIVE_SHARE) return (p / ACTIVE_SHARE) * LAST_EVENT;
  return LAST_EVENT + ((p - ACTIVE_SHARE) / (1 - ACTIVE_SHARE)) * (DURATION - LAST_EVENT);
}

function clock(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function ReplayHUD() {
  const [scrub, setScrub] = useState(false);
  const [progress, setProgress] = useState(1); // 1 = finished summary (the SSR state)
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const progressRef = useRef(1);

  // Arm scrub mode: only with JS + motion allowed. Adds the runway class to the
  // .record section so static/reduced users never get dead scroll height.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const section = rootRef.current?.closest<HTMLElement>("[data-record]");
    const runway = section?.querySelector<HTMLElement>("[data-runway]");
    if (!section || !runway) return;
    section.classList.add("record--scrub");
    setScrub(true);
    let raf = 0;
    const measure = () => {
      raf = 0;
      const rect = runway.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      const p = travel > 60 ? Math.min(1, Math.max(0, -rect.top / travel)) : 1;
      progressRef.current = p;
      setProgress(p);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      section.classList.remove("record--scrub");
    };
  }, []);

  // Event-timeline canvas: 51 real events at their true timestamps, hour graticule,
  // playhead riding the scrub. An event TIMELINE, not an fps trace — the record
  // genuinely contains these timestamps and nothing per-frame.
  const drawTimeline = () => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    const W = cv.clientWidth;
    const H = cv.clientHeight;
    if (!W || !H) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pw = Math.round(W * dpr);
    const ph = Math.round(H * dpr);
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const elapsed = timeOf(progressRef.current);
    const base = H - 16;
    const xOf = (t: number) => 1 + (t / DURATION) * (W - 2);

    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(242,237,228,0.16)";
    ctx.beginPath();
    ctx.moveTo(0, base + 0.5);
    ctx.lineTo(W, base + 0.5);
    ctx.stroke();

    ctx.font = "9px 'JetBrains Mono', ui-monospace, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(168,159,146,0.95)"; // --fg-dim — hour labels clear the AA floor
    for (let h = 1; h * 3600 <= DURATION; h++) {
      const x = Math.round(xOf(h * 3600)) + 0.5;
      ctx.strokeStyle = "rgba(242,237,228,0.10)";
      ctx.beginPath();
      ctx.moveTo(x, 10);
      ctx.lineTo(x, base);
      ctx.stroke();
      ctx.fillText(`${h}H`, Math.min(x, W - 12), base + 12);
    }

    for (const e of EVENTS) {
      const x = Math.round(xOf(e.atSecs)) + 0.5;
      const passed = e.atSecs <= elapsed;
      ctx.strokeStyle = passed ? "rgba(255,154,30,0.85)" : "rgba(242,237,228,0.20)";
      ctx.beginPath();
      ctx.moveTo(x, base - 12);
      ctx.lineTo(x, base);
      ctx.stroke();
    }

    const px = xOf(elapsed);
    ctx.strokeStyle = "#ff9a1e";
    ctx.beginPath();
    ctx.moveTo(px, 4);
    ctx.lineTo(px, base);
    ctx.stroke();
    ctx.fillStyle = "#ffbe5c";
    ctx.beginPath();
    ctx.arc(px, base, 2.5, 0, Math.PI * 2);
    ctx.fill();
  };

  useEffect(() => {
    if (scrub) drawTimeline();
  });

  useEffect(() => {
    if (!scrub || !canvasRef.current) return;
    const ro = new ResizeObserver(() => drawTimeline());
    ro.observe(canvasRef.current);
    return () => ro.disconnect();
  }, [scrub]);

  const elapsed = timeOf(progress);
  const done = !scrub || progress >= DONE_AT;
  const samples = done
    ? replay.samples
    : Math.floor((elapsed / DURATION) * replay.samples);
  const passedEvents = EVENTS.filter((e) => e.atSecs <= elapsed);
  const visibleEvents = passedEvents.slice(-FEED_ROWS);

  return (
    <div
      className="rhud panel"
      ref={rootRef}
      aria-label="Replay of a real recorded Monitor session"
    >
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

      {scrub && (
        <div className="rhud-timeline" aria-hidden="true">
          <canvas ref={canvasRef} />
        </div>
      )}

      <div className={scrub ? "rhud-swap" : undefined}>
        {!done ? (
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
                <span className="rhud-label">events passed</span>
                <span className="rhud-value readout">
                  {passedEvents.length} / {EVENTS.length}
                </span>
              </div>
            </div>
            <div className="rhud-track" aria-hidden="true">
              <div className="rhud-fill" style={{ width: `${(elapsed / DURATION) * 100}%` }} />
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
            <p className="rhud-scrubhint mono">
              scroll scrubs the record · rewind by scrolling back
            </p>
          </div>
        ) : (
          <div className="rhud-results">
            {scrub && (
              <p className="rhud-endstamp mono">T+{clock(DURATION)} · end of record</p>
            )}
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
          </div>
        )}
      </div>

      <footer className="rhud-cap mono">
        {replay.rig} — every number read on-device. Measurement showcase only: no gain
        claim, nothing attributed to Compy changes.
      </footer>
    </div>
  );
}
