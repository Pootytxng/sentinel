import { useEffect, type RefObject } from "react";

// LenisSpine (§A.5) — the smooth-scroll spine on the shell's ONE content lane (.v2-content).
// Mounted by ShellV2 only while useJarvisActive() (flag on + motion full), so flag-off and
// reduced-motion keep native scroll untouched. Perf rails (directive :153-157): the rAF loop
// stops whenever the document is hidden (never competes with the game being optimized), and
// the whole instance is destroyed on unmount. `lenis` is dynamic-imported so the chunk loads
// only when the layer is actually on.
//
// Nested scrollers (Learn list, stage cards, drawers…) must keep native wheel behavior: the
// `prevent` callback walks from the wheel target up to the wrapper and yields to any ancestor
// that genuinely scrolls (overflow-y auto/scroll AND overflowing content) — no per-surface
// data-lenis-prevent bookkeeping to drift out of date.

type LenisLike = {
  raf(time: number): void;
  stop(): void;
  start(): void;
  destroy(): void;
};

function hasNestedScroller(node: HTMLElement | null, stopAt: HTMLElement): boolean {
  let el: HTMLElement | null = node;
  while (el && el !== stopAt) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") return true;
    }
    el = el.parentElement;
  }
  return false;
}

export function LenisSpine({
  wrapperRef,
  contentRef,
}: {
  wrapperRef: RefObject<HTMLElement | null>;
  contentRef: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) return;

    let disposed = false;
    let lenis: LenisLike | null = null;
    let raf = 0;

    const loop = (time: number) => {
      lenis?.raf(time);
      raf = requestAnimationFrame(loop);
    };
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
        lenis?.stop();
      } else if (lenis && !raf) {
        lenis.start();
        raf = requestAnimationFrame(loop);
      }
    };

    void (async () => {
      try {
        const { default: Lenis } = await import("lenis");
        if (disposed) return;
        lenis = new Lenis({
          wrapper,
          content,
          prevent: (node: HTMLElement) => hasNestedScroller(node, wrapper),
        }) as unknown as LenisLike;
      } catch {
        // No ResizeObserver (jsdom) or module failure — the spine stays inert and the
        // lane keeps native scroll. Progressive enhancement, never a broken scroll.
        return;
      }
      raf = requestAnimationFrame(loop);
      document.addEventListener("visibilitychange", onVisibility);
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      lenis?.destroy();
      lenis = null;
    };
  }, [wrapperRef, contentRef]);

  return null;
}

export default LenisSpine;
