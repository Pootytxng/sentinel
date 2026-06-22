import { useEffect, useLayoutEffect, useRef, useState } from "react";
import "./SegmentedControl.css";

// SegmentedControl — the shared measured-glide segmented control, extracted from Optimize (the
// Optimize merge was the pattern-setter; Monitor is the second consumer, so the Executor "don't
// pre-abstract" caveat is satisfied). ONE accent pill glides between segments on selection — the
// satisfying "react to the interaction" motion, purposeful not playful. The pill's left/width are
// MEASURED from the live DOM (offsetLeft/Width of the selected tab) so it fits any label width;
// useLayoutEffect seats it before paint (no first-frame jump) and a ResizeObserver re-seats it on
// layout changes. Token-driven (recolors per theme), motion-gated, no shimmer/sheen.
//
// CONTRAST LAW (pinned, see SegmentedControl.css): the active label rides --ix-accent-ink on a FLAT
// --ix-accent fill — exactly what theme-contrast.test.ts proves. Keep the fill flat (not a gradient).

export type Segment = { id: string; label: string };

type Props = {
  segments: Segment[];
  value: string;
  onChange: (id: string) => void;
  /** Accessible name for the tablist (e.g. "Optimize sections" / "Monitor sections"). */
  "aria-label"?: string;
};

export function SegmentedControl({ segments, value, onChange, "aria-label": ariaLabel }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pill, setPill] = useState<{ left: number; width: number; ready: boolean }>({
    left: 0,
    width: 0,
    ready: false,
  });
  const measurePill = () => {
    const el = ref.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (el) setPill({ left: el.offsetLeft, width: el.offsetWidth, ready: true });
  };
  useLayoutEffect(measurePill, [value, segments]);
  useEffect(() => {
    const c = ref.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measurePill);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  return (
    <div className="seg-control" role="tablist" aria-label={ariaLabel} ref={ref}>
      {/* the gliding accent pill — sits behind the active tab's text, glides to the selection */}
      <span
        className="seg-indicator"
        aria-hidden="true"
        style={{ transform: `translateX(${pill.left}px)`, width: `${pill.width}px`, opacity: pill.ready ? 1 : 0 }}
      />
      {segments.map((s) => (
        <button
          key={s.id}
          role="tab"
          aria-selected={value === s.id}
          className={`seg-btn ${value === s.id ? "seg-btn-on" : ""}`}
          onClick={() => onChange(s.id)}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}

export default SegmentedControl;
