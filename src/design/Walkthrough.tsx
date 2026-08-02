import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
// Side-effect import: guarantees the i18next instance is initialized before this file's t() calls run.
import "../i18n";
import {
  type Walkthrough as WT,
  type WalkthroughStep,
  type GpuVendor,
  resolveVariant,
} from "../surfaces/walkthroughs";
import { openGuidedUri } from "../surfaces/guided";
import { bumpLocalStat } from "../data/local-stats";
import { useReducedMotion } from "./use-motion";
import "./Walkthrough.css";

// Animated schematic walkthrough (spec 2026-06-06; presentation reworked 2026-06-12 §B — the
// stacked five-panel storyboard read as clutter). ONE token-only abstracted window + a stepper
// (prev/next + jump dots, keyboard accessible): step N highlights in place, captions rail along.
// Auto-advance runs only when motion is allowed AND the user hasn't taken the wheel; when motion is
// reduced it is a manual stepper — never an auto-loop, never the 5-stack. It NEVER dresses as real
// OS chrome — it's labeled a schematic. Motion gates on the APP's own signal (useReducedMotion,
// which follows Windows by default since the 2026-08-01 Direction D gate), NOT raw prefers-reduced-motion — see src/design/use-motion.ts.

function Stage({ steps, active, cursor }: { steps: WalkthroughStep[]; active: number; cursor: boolean }) {
  const cur = steps[active] ?? steps[0];
  return (
    <div className="wt-stage" aria-hidden="true">
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
      {cursor && <span className="wt-cursor" style={{ left: `${cur.x}%`, top: `${cur.y}%` }} />}
    </div>
  );
}

export function Walkthrough({ walkthrough, vendor }: { walkthrough: WT; vendor: GpuVendor }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [variantIdx, setVariantIdx] = useState(() => {
    const i = walkthrough.variants.findIndex((v) => v.vendor === vendor);
    return i >= 0 ? i : 0;
  });
  const variant = walkthrough.variants[variantIdx] ?? resolveVariant(walkthrough, vendor);
  const steps = variant.steps;
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  // The user taking the wheel (prev/next/dot) ends auto-advance for good — a stepper the user
  // drives must never yank the step away. Reduced-motion never auto-advances at all.
  const [manual, setManual] = useState(false);

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
    if (reduced || manual || paused || steps.length <= 1) return;
    const id = window.setInterval(() => setActive((a) => (a + 1) % steps.length), 2200);
    return () => window.clearInterval(id);
  }, [reduced, manual, paused, steps.length]);

  const goTo = (i: number) => {
    setManual(true);
    setActive(((i % steps.length) + steps.length) % steps.length);
  };

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
          <div className="wt-variants" role="tablist" aria-label={t("common.walkthrough.whichCard")}>
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

      {/* ONE panel always (§B) — the active step highlights in place; the cursor glide only runs
          while auto-advance does. */}
      <Stage steps={steps} active={active} cursor={!reduced && !manual} />

      <div className="wt-stepper">
        <button
          type="button"
          className="wt-step-btn"
          onClick={() => goTo(active - 1)}
          aria-label={t("common.walkthrough.previousStep")}
        >
          ‹
        </button>
        <div className="wt-dots" role="group" aria-label={t("common.walkthrough.steps")}>
          {steps.map((_, i) => (
            <button
              key={i}
              type="button"
              className={`wt-dot ${i === active ? "wt-dot-on" : ""}`}
              aria-label={t("common.walkthrough.stepN", { n: i + 1 })}
              aria-current={i === active ? "step" : undefined}
              onClick={() => goTo(i)}
            />
          ))}
        </div>
        <button
          type="button"
          className="wt-step-btn"
          onClick={() => goTo(active + 1)}
          aria-label={t("common.walkthrough.nextStep")}
        >
          ›
        </button>
      </div>

      <ol className="wt-steps">
        {steps.map((s, i) => (
          <li key={i} className={`wt-step ${i === active ? "wt-step-on" : ""}`}>
            <span className="wt-step-num">{i + 1}</span>
            <span className="wt-step-cap">{s.caption}</span>
          </li>
        ))}
      </ol>

      <div className="wt-foot">
        <span className="wt-honest">{t("common.walkthrough.schematicNote")}</span>
        {walkthrough.deepLink && (
          <button
            type="button"
            className="wt-open"
            onClick={() => openGuidedUri(walkthrough.deepLink!)}
          >
            {walkthrough.deepLinkLabel ?? t("common.walkthrough.openIt")}
          </button>
        )}
      </div>
    </div>
  );
}
