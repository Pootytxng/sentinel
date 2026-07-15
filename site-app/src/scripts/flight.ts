// flight.ts — the Flight Test hero engine (rework 2026-07-15).
// Draws the REAL recorded session trace (per-second 1% low fps, Marvel Rivals
// 2026-06-25 — see ../data/flight-session.json provenance note), runs the boot
// count-up over the real sample total, a looping scan playhead, and a crosshair
// that reads real values off the trace. Everything animated is gated on
// prefers-reduced-motion; reduced users get the finished static page (the canvas
// still draws once — it's real data, not decoration-only).
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import flight from "../data/flight-session.json";

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const finePointer = window.matchMedia("(pointer: fine)").matches;

const hero = document.querySelector<HTMLElement>("[data-flight]");
const canvas = document.querySelector<HTMLCanvasElement>("[data-wave]");
const boot = document.querySelector<HTMLElement>("[data-boot]");
const xhair = document.querySelector<HTMLElement>("[data-xhair]");
const xhairRead = document.querySelector<HTMLElement>("[data-xhair-read]");
const playRead = document.querySelector<HTMLElement>("[data-play-read]");

const series = flight.series as [number, number][];
const events = flight.events as { at: number; label: string }[];
const duration = flight.durationSecs;

const css = (name: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const clock = (secs: number) => {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
};

// nearest sample to a session-time t (series timestamps are monotonic)
const sampleAt = (t: number): [number, number] => {
  let lo = 0;
  let hi = series.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (series[mid][0] <= t) lo = mid;
    else hi = mid;
  }
  return t - series[lo][0] <= series[hi][0] - t ? series[lo] : series[hi];
};

/* ---------------- canvas trace ---------------- */

let W = 0;
let H = 0;
let dpr = 1;
let base: HTMLCanvasElement | null = null; // prerendered full trace
let drawProgress = reduced ? 1 : 0; // entrance sweep 0→1 (left to right)

// value domain, padded around the real min/max so the trace breathes
const vLo = flight.seriesMin - (flight.seriesMax - flight.seriesMin) * 0.12;
const vHi = flight.seriesMax + (flight.seriesMax - flight.seriesMin) * 0.18;

// The hero stacks its copy at the bottom (justify-end) and .flight-body reserves
// the trace's airspace with a 150px margin-top, so a copy-free zone exists at EVERY
// width by construction (at ≤1440 the type fills the whole viewport-height hero and
// the hero grows past the viewport instead of squeezing the band into the copy).
// The band bottom is MEASURED against the kicker — the first visible copy — never
// assumed from a proportion: three self-review rounds (2026-07-15) proved that any
// proportional floor eventually re-enters the copy at some width.
const kickEl =
  hero?.querySelector<HTMLElement>(".flight-kick") ??
  hero?.querySelector<HTMLElement>(".flight-body") ??
  null;
let bTopPx = 0;
let bBotPx = 0;
function measureBand() {
  bBotPx = H * 0.28;
  if (kickEl && hero) {
    const kickTop = kickEl.getBoundingClientRect().top - hero.getBoundingClientRect().top;
    // 14px above the kicker hairline; no proportional floor — measurement wins
    bBotPx = Math.min(H * 0.6, kickTop - 14);
  }
  bTopPx = Math.max(28, Math.min(H * 0.12, bBotPx - H * 0.16));
  // degenerate-layout guard (mid-font-swap transients): keep ≥70px of band,
  // never inverted — the CSS reservation makes this unreachable in steady state
  if (bBotPx - bTopPx < 70) {
    bBotPx = Math.max(90, bBotPx);
    bTopPx = Math.max(20, bBotPx - 70);
  }
  // the crosshair chip rides the band's midline (CSS reads the var)
  hero?.style.setProperty("--band-chip-y", `${Math.round((bTopPx + bBotPx) / 2)}px`);
}
const bandTop = () => bTopPx;
const bandBot = () => bBotPx;
const xOf = (t: number) => (t / duration) * W;
const yOf = (v: number) => {
  const f = (v - vLo) / (vHi - vLo);
  return bandBot() - f * (bandBot() - bandTop());
};

function prerender() {
  if (!canvas) return;
  base = document.createElement("canvas");
  base.width = Math.round(W * dpr);
  base.height = Math.round(H * dpr);
  const ctx = base.getContext("2d");
  if (!ctx) return;
  ctx.scale(dpr, dpr);

  const accent = css("--accent") || "#ff9a1e";
  const faint = css("--fg-faint") || "#6f685c";

  // min/max hairlines with their REAL values silk-screened on
  ctx.strokeStyle = "rgba(242,237,228,0.10)";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 6]);
  for (const v of [flight.seriesMax, flight.seriesMin]) {
    const y = yOf(v);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.font = "10px JetBrains Mono, Consolas, monospace";
  ctx.fillStyle = faint;
  ctx.fillText(`${flight.seriesMax.toFixed(1)} MAX`, 8, yOf(flight.seriesMax) - 6);
  ctx.fillText(`${flight.seriesMin.toFixed(1)} MIN`, 8, yOf(flight.seriesMin) + 14);

  // real process-event ticks along the band top
  ctx.fillStyle = "rgba(255,154,30,0.30)";
  for (const ev of events) {
    ctx.fillRect(xOf(ev.at), bandTop() - 3, 1, 7);
  }

  // area fill under the trace
  const grad = ctx.createLinearGradient(0, bandTop(), 0, bandBot());
  grad.addColorStop(0, "rgba(255,154,30,0.11)");
  grad.addColorStop(1, "rgba(255,154,30,0)");
  ctx.beginPath();
  ctx.moveTo(xOf(series[0][0]), bandBot());
  for (const [t, v] of series) ctx.lineTo(xOf(t), yOf(v));
  ctx.lineTo(xOf(series[series.length - 1][0]), bandBot());
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // the trace itself, with a soft glow pass baked into the prerender
  ctx.beginPath();
  for (let i = 0; i < series.length; i++) {
    const [t, v] = series[i];
    if (i === 0) ctx.moveTo(xOf(t), yOf(v));
    else ctx.lineTo(xOf(t), yOf(v));
  }
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.4;
  ctx.shadowColor = "rgba(255,154,30,0.5)";
  ctx.shadowBlur = 10;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.stroke();
}

function frame(playT: number | null) {
  if (!canvas || !base) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // entrance sweep: reveal the prerendered trace left→right
  const sw = Math.max(1, Math.round(base.width * drawProgress));
  ctx.drawImage(base, 0, 0, sw, base.height, 0, 0, sw, base.height);

  if (playT !== null) {
    const [t, v] = sampleAt(playT);
    const x = xOf(t) * dpr;
    const y = yOf(v) * dpr;
    ctx.strokeStyle = "rgba(255,154,30,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, bandTop() * dpr - 10 * dpr);
    ctx.lineTo(x, bandBot() * dpr);
    ctx.stroke();
    ctx.fillStyle = css("--accent-bright") || "#ffbe5c";
    ctx.beginPath();
    ctx.arc(x, y, 3 * dpr, 0, Math.PI * 2);
    ctx.fill();
    if (playRead) playRead.textContent = `T+${clock(t)} · ${v.toFixed(1)} 1% LOW`;
  }
}

function resize() {
  if (!canvas || !hero) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = hero.clientWidth;
  H = hero.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  measureBand();
  prerender();
  frame(reduced ? null : lastPlayT);
}

/* ---------------- scan playhead + crosshair ---------------- */

const LOOP_SECS = 75; // one full session sweep every 75s of wall time
let lastPlayT = 0;
let pointerT: number | null = null; // crosshair overrides the scan while active
let rafId = 0;
let t0 = performance.now();

function loop(now: number) {
  if (!document.hidden) {
    if (pointerT === null) {
      lastPlayT = (((now - t0) / 1000) % LOOP_SECS) / LOOP_SECS * duration;
      frame(lastPlayT);
    }
  }
  rafId = requestAnimationFrame(loop);
}

function bindCrosshair() {
  if (!hero || !xhair || !xhairRead || !finePointer) return;
  hero.style.cursor = "crosshair";
  hero.addEventListener("pointermove", (e) => {
    const r = hero.getBoundingClientRect();
    const x = e.clientX - r.left;
    if (x < 0 || x > r.width) return;
    pointerT = (x / r.width) * duration;
    const [t, v] = sampleAt(pointerT);
    xhair.hidden = false;
    xhair.style.left = `${x}px`;
    xhairRead.textContent = `T+${clock(t)} · ${v.toFixed(1)} 1% LOW`;
    // flip the chip when near the right edge so it never clips
    (xhairRead as HTMLElement).style.left = x > r.width - 220 ? "auto" : "10px";
    (xhairRead as HTMLElement).style.right = x > r.width - 220 ? "10px" : "auto";
    frame(pointerT);
  });
  hero.addEventListener("pointerleave", () => {
    pointerT = null;
    xhair.hidden = true;
    if (reduced) frame(null);
  });
}

/* ---------------- boot + entrance ---------------- */

function entrance() {
  const lines = gsap.utils.toArray<HTMLElement>("[data-fx-line]");
  const soft = ["[data-fx-kick]", "[data-fx-row]", "[data-fx-strip]"];
  gsap.set(lines, { yPercent: 112 });
  gsap.set(soft, { autoAlpha: 0, y: 14 });

  const tl = gsap.timeline();

  if (boot) {
    const countEl = boot.querySelector<HTMLElement>("[data-boot-count]");
    const ruleEl = boot.querySelector<HTMLElement>("[data-boot-rule]");
    const counter = { n: 0 };
    tl.to(counter, {
      n: flight.samples,
      duration: 1.5,
      ease: "power3.out",
      onUpdate() {
        if (countEl) countEl.textContent = Math.round(counter.n).toLocaleString("en-US");
      },
    });
    if (ruleEl) tl.to(ruleEl, { scaleX: 1, duration: 1.5, ease: "power3.out" }, 0);
    tl.to(boot, {
      yPercent: -100,
      duration: 0.7,
      ease: "power4.inOut",
      delay: 0.2,
      onComplete() {
        boot.setAttribute("data-boot-done", "1");
        boot.remove();
        document.documentElement.classList.remove("booting");
      },
    });
  }

  // trace sweeps in left→right as the type rises
  tl.to(
    { p: 0 },
    {
      p: 1,
      duration: 1.8,
      ease: "power2.inOut",
      onUpdate() {
        drawProgress = (this.targets()[0] as { p: number }).p;
        if (pointerT === null) frame(null);
      },
      onComplete() {
        drawProgress = 1;
      },
    },
    boot ? "-=0.45" : 0
  );
  tl.to(
    lines,
    { yPercent: 0, duration: 1.1, ease: "expo.out", stagger: 0.09 },
    boot ? "-=1.7" : 0.1
  );
  tl.to(soft, { autoAlpha: 1, y: 0, duration: 0.9, ease: "power3.out", stagger: 0.08 }, "-=0.8");
}

function scrollScenes() {
  gsap.registerPlugin(ScrollTrigger);
  const bigs = gsap.utils.toArray<HTMLElement>(".fh1-big");
  if (bigs.length === 2 && hero) {
    gsap.to(bigs[0], {
      xPercent: -5,
      ease: "none",
      scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.6 },
    });
    gsap.to(bigs[1], {
      xPercent: 3.5,
      ease: "none",
      scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.6 },
    });
  }
}

/* ---------------- init ---------------- */

if (hero && canvas) {
  resize();
  window.addEventListener("resize", resize);
  // the display font swapping in changes how tall the type block wraps, which
  // moves .flight-body — re-measure the band once the real fonts are live
  document.fonts?.ready.then(() => resize());
  bindCrosshair();

  if (!reduced) {
    entrance();
    scrollScenes();
    rafId = requestAnimationFrame(loop);
  } else {
    // reduced motion: finished page, static full trace, no scan loop.
    // The boot overlay was never revealed (inline gate); make sure it's gone anyway.
    boot?.remove();
    document.documentElement.classList.remove("booting");
    frame(null);
  }
}
