import { useEffect, type RefObject } from "react";
import { gsap } from "gsap";

// MagneticLayer (§A.3) — delegated magnetic pull for [data-magnetic] elements inside `scopeRef`
// (today: the rail's room tabs; any future adopter just carries the attribute). While the
// pointer is over a magnetic element it drifts a few px toward the cursor (GSAP quickTo,
// transform-only); on leave it eases home. Mounted by ShellV2 only while useJarvisActive()
// (flag on + motion full) — unmount tweens every displaced element back to rest, so a
// mid-session reduced-motion flip can't strand a translated button. Coarse pointers get
// nothing (touch has no cursor to be magnetic to).
//
// Restraint rails: MAX_PULL is small on purpose ("felt not seen"), the ease is exponential-out
// (no bounce/elastic — banned), and elements with their own transform identity (the Dock's
// magnify lift) deliberately do NOT carry data-magnetic — one motion idea per element.

const MAX_PULL = 4; // px, each axis
const PULL_FACTOR = 0.2; // fraction of the cursor's offset from element center

const clamp = (v: number) => Math.max(-MAX_PULL, Math.min(MAX_PULL, v));

export function MagneticLayer({ scopeRef }: { scopeRef: RefObject<HTMLElement | null> }) {
  useEffect(() => {
    const scope = scopeRef.current;
    if (!scope) return;
    try {
      if (matchMedia("(pointer: coarse)").matches) return;
    } catch {
      /* no matchMedia — assume fine pointer */
    }

    let active: HTMLElement | null = null;
    // Center cached at entry: the element translates while magnetized, so a live rect would
    // chase its own transform (feedback wobble). At entry the transform is at/near rest.
    let cx = 0;
    let cy = 0;
    let xTo: ((v: number) => void) | null = null;
    let yTo: ((v: number) => void) | null = null;

    const release = (el: HTMLElement) => {
      gsap.to(el, { x: 0, y: 0, duration: 0.4, ease: "expo.out", overwrite: "auto" });
    };

    const onOver = (e: PointerEvent) => {
      const t =
        e.target instanceof Element
          ? (e.target.closest("[data-magnetic]") as HTMLElement | null)
          : null;
      if (!t || t === active) return;
      if (active) release(active);
      active = t;
      const r = t.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      xTo = gsap.quickTo(t, "x", { duration: 0.3, ease: "power3.out" });
      yTo = gsap.quickTo(t, "y", { duration: 0.3, ease: "power3.out" });
    };
    const onMove = (e: PointerEvent) => {
      if (!active || !xTo || !yTo) return;
      xTo(clamp((e.clientX - cx) * PULL_FACTOR));
      yTo(clamp((e.clientY - cy) * PULL_FACTOR));
    };
    const onOut = (e: PointerEvent) => {
      if (!active) return;
      const to =
        e.relatedTarget instanceof Element ? e.relatedTarget.closest("[data-magnetic]") : null;
      if (to === active) return;
      release(active);
      active = null;
      xTo = yTo = null;
    };

    scope.addEventListener("pointerover", onOver);
    scope.addEventListener("pointermove", onMove);
    scope.addEventListener("pointerout", onOut);
    return () => {
      scope.removeEventListener("pointerover", onOver);
      scope.removeEventListener("pointermove", onMove);
      scope.removeEventListener("pointerout", onOut);
      if (active) gsap.set(active, { x: 0, y: 0 });
      active = null;
    };
  }, [scopeRef]);

  return null;
}

export default MagneticLayer;
