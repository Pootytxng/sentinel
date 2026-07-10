import { useEffect, useRef, type RefObject } from "react";
import { useReducedMotion } from "../use-motion";
import "./reticle.css";

// ReticleCursor — a game-HUD Target Cursor (reactbits) scoped to a container. It follows the pointer
// INSIDE `scopeRef` and snaps (corner-spread) over interactive targets ([data-target]/button). It is
// deliberately STAGE-SCOPED, never app-wide: `cursor: none` is toggled on the scope only while the
// pointer is inside it, so the native cursor is untouched everywhere else. Renders nothing under
// reduced motion (Compy's resolved setting) or a coarse pointer — the native cursor stays.
export function ReticleCursor({ scopeRef }: { scopeRef: RefObject<HTMLElement | null> }) {
  const reduced = useReducedMotion();
  const coarse =
    typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced || coarse) return;
    const scope = scopeRef.current;
    const el = elRef.current;
    if (!scope || !el) return;

    let rx = 0,
      ry = 0,
      tx = 0,
      ty = 0,
      raf = 0,
      snap = false;
    const loop = () => {
      rx += (tx - rx) * 0.35;
      ry += (ty - ry) * 0.35;
      el.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%) scale(${snap ? 1.7 : 1})`;
      raf = requestAnimationFrame(loop);
    };
    const onMove = (e: PointerEvent) => {
      const r = scope.getBoundingClientRect();
      tx = e.clientX - r.left;
      ty = e.clientY - r.top;
    };
    const onEnter = () => {
      scope.classList.add("lc-has-reticle");
      el.style.opacity = "1";
      if (!raf) raf = requestAnimationFrame(loop);
    };
    const onLeave = () => {
      scope.classList.remove("lc-has-reticle");
      el.style.opacity = "0";
      // Stop the rAF loop while the pointer is away — an invisible reticle must not write a
      // transform every frame for the tab's whole lifetime (idle-GPU discipline). onEnter restarts it.
      if (raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const isTarget = (e: Event) =>
      e.target instanceof Element && !!e.target.closest("[data-target], button");
    const onOver = (e: Event) => {
      if (isTarget(e)) snap = true;
    };
    const onOut = (e: Event) => {
      if (isTarget(e)) snap = false;
    };

    scope.addEventListener("pointermove", onMove);
    scope.addEventListener("pointerenter", onEnter);
    scope.addEventListener("pointerleave", onLeave);
    scope.addEventListener("pointerover", onOver);
    scope.addEventListener("pointerout", onOut);
    return () => {
      cancelAnimationFrame(raf);
      scope.removeEventListener("pointermove", onMove);
      scope.removeEventListener("pointerenter", onEnter);
      scope.removeEventListener("pointerleave", onLeave);
      scope.removeEventListener("pointerover", onOver);
      scope.removeEventListener("pointerout", onOut);
      scope.classList.remove("lc-has-reticle");
    };
  }, [reduced, coarse, scopeRef]);

  if (reduced || coarse) return null;
  return (
    <div className="lc-reticle" ref={elRef} aria-hidden="true">
      <span className="lc-ret-c tl" />
      <span className="lc-ret-c tr" />
      <span className="lc-ret-c bl" />
      <span className="lc-ret-c br" />
      <span className="lc-ret-dot" />
    </div>
  );
}
export default ReticleCursor;
