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
    // Reading offsetLeft/offsetWidth forces a synchronous reflow — skip it when the control is
    // hidden (offsetWidth 0, e.g. a keepalive'd surface toggling display:none on a tab switch): the
    // pill isn't visible anyway, and the reflow-on-hide was a measurable tab-switch hitch. It
    // re-measures correctly on show (offsetWidth > 0), where the reflow is legitimate.
    if (el && el.offsetWidth > 0) setPill({ left: el.offsetLeft, width: el.offsetWidth, ready: true });
  };
  useLayoutEffect(measurePill, [value, segments]);
  useEffect(() => {
    const c = ref.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    // Use the observer's own contentRect (no forced read) to skip entirely when the control has
    // collapsed to zero size — a display:none tab switch shouldn't trigger any layout work here.
    const ro = new ResizeObserver((entries) => {
      if (entries[0]?.contentRect.width === 0) return;
      measurePill();
    });
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
