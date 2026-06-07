import { useEffect, useRef, useState } from "react";
import "./Wordmark.css";

// Wordmark Law v2 (kernel §1 final): the pulse-C IS the C — "Compy" is ONE word, not logo-then-name.
// The glyph viewBox is cropped to the C's stroke bounds (218 218 510 588 on the master geometry), the
// pulse is trimmed to end at the C's mouth (648,512), and "ompy" is kerned tight (≈ -1px @ 19px,
// scaled by em) so it reads as a single word. Reference: site/index.html header mark. Accent-driven
// so it follows the active theme.
export function Wordmark({ size = 19, className = "" }: { size?: number; className?: string }) {
  const w = (18 / 19) * size;
  const h = (21 / 19) * size;
  // Fidgeter's reward (shadow realm, Six Laws): triple-click the mark → the launch heartbeat redraws
  // once. Pure delight — nothing changes, nothing unlocks. `cmp-shadow` marks a DELIBERATE knobless
  // interaction: the sanctioned exception to the doorknob law (an egg must never wear a knob), so it
  // stays invisible until found. Removing it leaves zero trace.
  const [beat, setBeat] = useState(0);
  const taps = useRef<number[]>([]);
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
      </svg>
      <span className="cmp-wordmark-rest">ompy</span>
    </span>
  );
}
