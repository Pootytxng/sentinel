import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { type Ambiance, readStepAsideGame } from "./theme";
import "./AmbientBackdrop.css";

// Dependency-free canvas "hyperspeed" — light streaks warping out from a vanishing point, colors
// from the active theme's streak tokens. No deps, no Three.js, no remote (CSP stays strict).
//
// THE COURTESY / STEP-ASIDE RULE (mandatory, spec §3/§4): the backdrop freezes + clears when
//   (a) an FPS capture / game session is active (reuse get_fps_status),
//   (b) prefers-reduced-motion is set, or
//   (c) the document is hidden.
// It resumes when idle. (Battery / low-GPU detection is a TODO — see note below.)

const VP = { x: 0.8, y: 0.18 }; // vanishing point, top-right (provisional, spec §3)
const COUNT: Record<Exclude<Ambiance, "off">, number> = { calm: 48, full: 140 };
const SPEED: Record<Exclude<Ambiance, "off">, number> = { calm: 0.5, full: 1 };

type Streak = { ang: number; dist: number; speed: number; ci: number };

function readColors(): { base: string; streaks: string[] } {
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string) => cs.getPropertyValue(n).trim();
  return {
    base: v("--ix-base") || "#07090e",
    streaks: [v("--ix-streak-1"), v("--ix-streak-2"), v("--ix-streak-3")].map(
      (c, i) => c || ["#22d3ee", "#2ee6c0", "#5eead4"][i],
    ),
  };
}

export function AmbientBackdrop({
  ambiance,
  themeKey,
}: {
  ambiance: Ambiance;
  themeKey: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [reduced, setReduced] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [gameActive, setGameActive] = useState(false);
  // "Step aside when I play" preference (default ON). Read on mount + on the Settings change event;
  // when OFF, the game-freeze is skipped (reduced-motion + hidden stay UNCONDITIONAL below).
  const [freezeOnGame, setFreezeOnGame] = useState<boolean>(readStepAsideGame);
  useEffect(() => {
    const on = () => setFreezeOnGame(readStepAsideGame());
    window.addEventListener("compy:stepaside-changed", on);
    return () => window.removeEventListener("compy:stepaside-changed", on);
  }, []);

  // (b) prefers-reduced-motion
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);

  // (c) document hidden
  useEffect(() => {
    const on = () => setHidden(document.visibilityState === "hidden");
    on();
    document.addEventListener("visibilitychange", on);
    return () => document.removeEventListener("visibilitychange", on);
  }, []);

  // (a) active game / FPS capture — reuse the existing monitoring state, polled lightly.
  useEffect(() => {
    if (ambiance === "off") return;
    let cancelled = false;
    const poll = () => {
      try {
        invoke<{ active: boolean }>("get_fps_status")
          .then((s) => !cancelled && setGameActive(!!s?.active))
          .catch(() => {});
      } catch {
        /* not running under Tauri (e.g. tests) — treat as not active */
      }
    };
    poll();
    const id = window.setInterval(poll, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [ambiance]);

  // reduced-motion + hidden-document are UNCONDITIONAL freezes (a11y/efficiency); the game-freeze is
  // the user-toggleable courtesy (default ON).
  const paused = ambiance === "off" || reduced || hidden || (gameActive && freezeOnGame);

  useEffect(() => {
    if (ambiance === "off") return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return; // jsdom has no 2d context — render nothing, no crash

    let { base, streaks: colors } = readColors();
    let raf = 0;
    let W = 0;
    let H = 0;
    let dpr = 1;
    let streaks: Streak[] = [];

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const seed = () => {
      const n = COUNT[ambiance];
      streaks = Array.from({ length: n }, () => ({
        ang: Math.random() * Math.PI * 2,
        dist: Math.random() * 240,
        speed: 0.6 + Math.random() * 1.4,
        ci: Math.floor(Math.random() * colors.length),
      }));
    };
    resize();
    seed();

    const clearToBase = () => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, W, H);
    };

    let last = performance.now();
    const frame = (t: number) => {
      const dt = Math.min(40, t - last) / 16.67; // normalize to ~60fps steps, cap big gaps
      last = t;
      const vpx = W * VP.x;
      const vpy = H * VP.y;
      const maxR = Math.hypot(W, H) * 1.1;
      const spd = SPEED[ambiance];
      clearToBase();
      for (const s of streaks) {
        s.dist += (s.speed + s.dist * 0.012) * spd * dt;
        if (s.dist > maxR) {
          s.ang = Math.random() * Math.PI * 2;
          s.dist = Math.random() * 60;
          s.speed = 0.6 + Math.random() * 1.4;
          s.ci = Math.floor(Math.random() * colors.length);
          continue;
        }
        const dx = Math.cos(s.ang);
        const dy = Math.sin(s.ang);
        const tail = Math.max(0, s.dist - (10 + s.dist * 0.1));
        const alpha = Math.min(0.85, s.dist / (maxR * 0.5)) * (ambiance === "full" ? 0.9 : 0.6);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = colors[s.ci];
        ctx.lineWidth = Math.max(0.6, s.dist * 0.0022 * (ambiance === "full" ? 1.4 : 1));
        ctx.beginPath();
        ctx.moveTo(vpx + dx * tail, vpy + dy * tail);
        ctx.lineTo(vpx + dx * s.dist, vpy + dy * s.dist);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };

    const onResize = () => resize();
    window.addEventListener("resize", onResize);

    if (paused) {
      clearToBase(); // frozen = obsidian base, no streaks (gets out of the way)
    } else {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
    // Re-run when paused state, ambiance, or theme changes (theme refreshes colors via readColors).
  }, [paused, ambiance, themeKey]);

  if (ambiance === "off") return null;
  return (
    <>
      <canvas ref={canvasRef} className="ix-backdrop" aria-hidden="true" />
      <div className="ix-vignette" aria-hidden="true" />
    </>
  );
}

// TODO(reskin): battery + low-GPU detection for the full courtesy rule (spec §3) — calm/freeze on
// battery or weak GPU. Needs a navigator.getBattery()/heuristic pass; deferred this increment.
