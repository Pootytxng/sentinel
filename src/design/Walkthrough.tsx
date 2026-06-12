import { useEffect, useRef, useState } from "react";
import {
  type Walkthrough as WT,
  type WalkthroughStep,
  type GpuVendor,
  resolveVariant,
} from "../surfaces/walkthroughs";
import { openGuidedUri } from "../surfaces/guided";
import { bumpLocalStat } from "../data/local-stats";
import "./Walkthrough.css";

// Animated schematic walkthrough (spec 2026-06-06). A token-only abstracted window + a cursor that
// glides click → click → done, synced to a 1·2·3 step list. Loops; hover/focus pauses. Under
// prefers-reduced-motion it becomes a static side-by-side storyboard (same data, no loop). It NEVER
// dresses as real OS chrome — it's labeled a schematic.

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

function Stage({
  steps,
  active,
  storyboard,
}: {
  steps: WalkthroughStep[];
  active: number;
  storyboard?: boolean;
}) {
  const cur = steps[active] ?? steps[0];
  return (
    <div className={`wt-stage ${storyboard ? "wt-stage-frame" : ""}`} aria-hidden="true">
      {/* Abstracted window — clearly NOT a screenshot: titlebar dots + muted sidebar + content rows. */}
      <div className="wt-titlebar">
        <span />
        <span />
        <span />
      </div>
      <div className="wt-body">
        <div className="wt-sidebar">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="wt-side-row" />
          ))}
        </div>
        <div className="wt-content">
          {[0, 1, 2].map((i) => (
            <span key={i} className="wt-content-row" />
          ))}
        </div>
      </div>
      {steps.map((s, i) => (
        <span
          key={i}
          className={`wt-hotspot ${i === active ? "wt-hotspot-on" : ""}`}
          style={{ left: `${s.x}%`, top: `${s.y}%` }}
        >
          <span className="wt-hotspot-num">{i + 1}</span>
          <span className="wt-hotspot-label">{s.label}</span>
        </span>
      ))}
      {!storyboard && <span className="wt-cursor" style={{ left: `${cur.x}%`, top: `${cur.y}%` }} />}
    </div>
  );
}

export function Walkthrough({ walkthrough, vendor }: { walkthrough: WT; vendor: GpuVendor }) {
  const reduced = usePrefersReducedMotion();
  const [variantIdx, setVariantIdx] = useState(() => {
    const i = walkthrough.variants.findIndex((v) => v.vendor === vendor);
    return i >= 0 ? i : 0;
  });
  const variant = walkthrough.variants[variantIdx] ?? resolveVariant(walkthrough, vendor);
  const steps = variant.steps;
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    setActive(0);
  }, [variantIdx]);

  // R3 Lane D — count each walkthrough actually shown (mount = the user opened it). Local-only.
  // Ref guard: StrictMode re-runs mount effects in dev (refs persist) — keep the count honest.
  const counted = useRef(false);
  useEffect(() => {
    if (counted.current) return;
    counted.current = true;
    bumpLocalStat("walkthroughsOpened");
  }, []);

  useEffect(() => {
    if (reduced || paused || steps.length <= 1) return;
    const id = window.setInterval(() => setActive((a) => (a + 1) % steps.length), 2200);
    return () => window.clearInterval(id);
  }, [reduced, paused, steps.length]);

  return (
    <div
      className="wt-root"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="wt-head">
        <span className="wt-title">{walkthrough.title}</span>
        {walkthrough.variants.length > 1 && (
          <div className="wt-variants" role="tablist" aria-label="Which card?">
            {walkthrough.variants.map((v, i) => (
              <button
                key={v.vendor}
                type="button"
                role="tab"
                aria-selected={i === variantIdx}
                className={`wt-variant ${i === variantIdx ? "wt-variant-on" : ""}`}
                onClick={() => setVariantIdx(i)}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {reduced ? (
        <div className="wt-storyboard">
          {steps.map((_, i) => (
            <Stage key={i} steps={steps} active={i} storyboard />
          ))}
        </div>
      ) : (
        <Stage steps={steps} active={active} />
      )}

      <ol className="wt-steps">
        {steps.map((s, i) => (
          <li key={i} className={`wt-step ${i === active && !reduced ? "wt-step-on" : ""}`}>
            <span className="wt-step-num">{i + 1}</span>
            <span className="wt-step-cap">{s.caption}</span>
          </li>
        ))}
      </ol>

      <div className="wt-foot">
        <span className="wt-honest">Schematic — menus vary slightly by version.</span>
        {walkthrough.deepLink && (
          <button
            type="button"
            className="wt-open"
            onClick={() => openGuidedUri(walkthrough.deepLink!)}
          >
            {walkthrough.deepLinkLabel ?? "Open it"}
          </button>
        )}
      </div>
    </div>
  );
}
