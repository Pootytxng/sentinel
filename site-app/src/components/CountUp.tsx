// Mono tabular count-up for receipt numerals. Renders the FINAL value in static HTML
// (SEO/no-JS/reduced-motion all see the real number); animation only ever replays the
// climb toward that same real value — it never invents data.
import { useEffect, useRef } from "react";

interface Props {
  value: number;
  decimals?: number;
  durationMs?: number;
  suffix?: string;
}

export default function CountUp({ value, decimals = 0, durationMs = 1400, suffix = "" }: Props) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / durationMs);
          const eased = 1 - Math.pow(1 - p, 3);
          el.textContent = (value * eased).toFixed(decimals) + suffix;
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, decimals, durationMs, suffix]);

  return (
    <span ref={ref} className="readout">
      {value.toFixed(decimals) + suffix}
    </span>
  );
}
