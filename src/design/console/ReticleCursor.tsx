import { useEffect, useRef, type RefObject } from "react";
import { useReducedMotion } from "../use-motion";
import { useHudFrameFlag } from "../use-hud";
import "./reticle.css";

// ReticleCursor — a game-HUD Target Cursor (reactbits) scoped to a container. It follows the pointer
// INSIDE `scopeRef` and snaps (corner-spread) over interactive targets ([data-target]/button).
// `cursor: none` is toggled on the scope only while the pointer is inside it, so the native cursor
// is untouched outside the scope. Two scopes exist (compy_hud_frame, console-HUD §viewport frame,
// 2026-07-15): the app-shell instance ShellV2 mounts with `appWide` while the flag is ON, and the
// classic stage-scoped instances, which SELF-DEFER while that flag is on (one reticle, never two —
// centralized here so mount sites need no flag logic; flag "0" hands control back to the stages).
// Text-entry surfaces (input/textarea/select/contenteditable) escape the reticle: the CSS restores
// the native cursor there and the move handler hides the brackets. Renders nothing under reduced
// motion (Compy's resolved setting) or a coarse pointer — the native cursor stays.
const TEXT_ENTRY = 'input, textarea, select, [contenteditable="true"]';

export function ReticleCursor({
  scopeRef,
  appWide,
}: {
  scopeRef: RefObject<HTMLElement | null>;
  appWide?: boolean;
}) {
  const reduced = useReducedMotion();
  const hudFrame = useHudFrameFlag();
  const coarse =
    typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches;
  const standDown = hudFrame && !appWide; // a stage instance defers to the shell's global reticle
  const elRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduced || coarse || standDown) return;
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
    let escaped = false;
    const onMove = (e: PointerEvent) => {
      const r = scope.getBoundingClientRect();
      tx = e.clientX - r.left;
      ty = e.clientY - r.top;
      // Over text entry the native cursor comes back (reticle.css) — hide the brackets with it.
      const esc = e.target instanceof Element && !!e.target.closest(TEXT_ENTRY);
      if (esc !== escaped) {
        escaped = esc;
        el.style.opacity = escaped ? "0" : "1";
      }
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
      e.target instanceof Element && !!e.target.closest("[data-target], button:not(:disabled)");
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
  }, [reduced, coarse, standDown, scopeRef]);

  if (reduced || coarse || standDown) return null;
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
