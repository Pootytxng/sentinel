import { useEffect, useRef, useState } from "react";
import "./Wordmark.css";

// Wordmark Law v2 (kernel §1 final): the pulse-C IS the C — "Compy" is ONE word, not logo-then-name.
// The glyph viewBox is cropped to the C's stroke bounds (218 218 510 588 on the master geometry), the
// pulse is trimmed to end at the C's mouth (648,512), and "ompy" is kerned tight (≈ -1px @ 19px,
// scaled by em) so it reads as a single word. Reference: site/index.html header mark. Accent-driven
// so it follows the active theme.
// Owner ruling 2026-08-26 (issue #213 A1): below this size the pulse is not drawn. At rail size the
// C's 104-unit stroke and the pulse's 58-unit stroke both land under ~2px, and the eye resolves an
// enclosed mark inside a ring as one glyph — the mark read "©ompy", a copyright symbol in front of
// the product's own name. The mark itself is APPROVED and untouched: this drops one flourish at the
// sizes where it stops being legible, and every size at or above the threshold draws it in full.
// The reading was his to rule on because the taste decree reserves the logo to the owner.
//
// The NUMBER is mine, and it is measured rather than guessed. The ruling said "below about 24px";
// a self-review capture of the mark at 16 / 19 / 20 / 22 / 24 with the live app's own token values
// read: enclosed blob at 16 and 19 (the © risk), marginal at 20, "clearly a legible zigzag" by 22,
// fully clean at 24. So the flourish is kept at 22 — Settings → About draws the mark at exactly
// that size, and dropping a legible pulse there would have retired part of an approved mark for no
// measured reason. The rail (16), the setup tour (19) and first-check (20) are all below it.
const PULSE_MIN_SIZE = 22;

export function Wordmark({ size = 19, className = "" }: { size?: number; className?: string }) {
  const w = (18 / 19) * size;
  const h = (21 / 19) * size;
  // Fidgeter's reward (shadow realm, Six Laws): triple-click the mark → the launch heartbeat redraws
  // once. Pure delight — nothing changes, nothing unlocks. `cmp-shadow` marks a DELIBERATE knobless
  // interaction: the sanctioned exception to the doorknob law (an egg must never wear a knob), so it
  // stays invisible until found. Removing it leaves zero trace.
  const [beat, setBeat] = useState(0);
  const taps = useRef<number[]>([]);
  // Below the threshold the egg is not lost, it is REVEALED — the pulse appears for the length of
  // its own redraw and then goes back into hiding, which is what the recommendation sent to the
  // owner on 2026-08-24 promised. A permanent reveal would put the © reading straight back, so the
  // window is closed by a timer rather than by `animationend`: under reduced motion the CSS sets
  // `animation: none` and that event never fires, which would strand the pulse on screen forever.
  const [revealing, setRevealing] = useState(false);
  const showPulse = size >= PULSE_MIN_SIZE || revealing;
  useEffect(() => {
    if (beat === 0) return;
    setRevealing(true);
    const id = setTimeout(() => setRevealing(false), 760); // 720ms redraw + a frame of slack
    return () => clearTimeout(id);
  }, [beat]);
  // The Konami handshake (shadow realm) replays the heartbeat too, via a window event.
  useEffect(() => {
    const onBeat = () => setBeat((b) => b + 1);
    window.addEventListener("compy:heartbeat", onBeat);
    return () => window.removeEventListener("compy:heartbeat", onBeat);
  }, []);
  const fidget = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 600), now];
    if (taps.current.length >= 3) {
      taps.current = [];
      setBeat((b) => b + 1);
    }
  };
  return (
    <span
      className={`cmp-wordmark cmp-shadow ${className}`}
      style={{ fontSize: size }}
      aria-label="Compy"
      onClick={fidget}
    >
      <svg
        className="cmp-wordmark-glyph"
        width={w}
        height={h}
        viewBox="218 218 510 588"
        aria-hidden="true"
      >
        <path
          d="M672 320 A240 240 0 1 0 672 704"
          fill="none"
          stroke="var(--ix-accent, #2ee6c0)"
          strokeWidth="104"
          strokeLinecap="round"
        />
        {/* At rest below PULSE_MIN_SIZE this is absent, not merely transparent — a sub-pixel stroke
            still fattens the ring it sits inside, which is the whole mechanism behind the © reading.
            It comes back for the length of the egg's redraw and then hides again. */}
        {showPulse && (
          <polyline
            key={beat}
            className={beat > 0 ? "cmp-wordmark-pulse" : ""}
            pathLength={1}
            points="360,512 424,512 460,434 514,594 556,470 602,512 648,512"
            fill="none"
            stroke="var(--ix-accent-text, #7ff0d0)"
            strokeWidth="58"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
      <span className="cmp-wordmark-rest">ompy</span>
    </span>
  );
}
