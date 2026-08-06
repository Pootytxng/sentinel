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
//
// IDLE STAND-DOWN (2026-08-06, Q7 idle-cost teardown). The loop used to re-arm unconditionally and
// was stopped only by `document.hidden` — so a VISIBLE window with nobody at the keyboard ticked
// every frame forever, in every room, for the whole session. Measured
// (docs/perf/raw/idle-attribution.json): the frame loops were 6.561 of the 51.733 CPU points the
// idle app burned, and this was the top registration site in the sample. Smooth scroll only has
// work to do while the lane is actually moving, so the loop now parks IDLE_AFTER_MS after the last
// pixel of motion and wakes on input — the ReticleCursor pattern, applied to scroll.
//
// Parking is keyed on OBSERVED MOTION (wrapper.scrollTop actually changed), not on any Lenis event
// or flag: whatever the library does internally, "the lane has not moved for a second" is a fact,
// and it cannot leave the loop running for a scroll that already ended.

type LenisLike = {
  raf(time: number): void;
  stop(): void;
  start(): void;
  destroy(): void;
};

/** How long the loop keeps ticking after the lane stops moving. One second of frames costs ~0.1% of
 *  a core; anything shorter risks parking inside the tail of a lerp the user can still see. */
const IDLE_AFTER_MS = 1000;

/** Every way a user can start a scroll. `scroll` on the wrapper covers scrollbar drags, focus jumps
 *  and programmatic scrollTo — and it also fires while Lenis is moving the lane, which harmlessly
 *  re-confirms the loop should stay awake. */
const WAKE_EVENTS = ["wheel", "touchstart", "touchmove", "keydown", "pointerdown"] as const;

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
    let lastMotion = 0;
    let lastTop = wrapper.scrollTop;

    // THE PARKED TIME IS HIDDEN FROM LENIS (self-review FAIL, 2026-08-06). Lenis eases on a clock:
    // `raf(time)` derives deltaTime from the previous call, and the damping factor is 1-e^(-λ·Δt).
    // Parking leaves a multi-second hole in that series, so the first frame after a wake saturates
    // the factor to ~1 and the lane TELEPORTS to the target instead of easing to it — smooth on the
    // first scroll of a session, an instant snap on every scroll after a park. Reproduced: a 4 s park
    // turned a 13-frame curve into one jump of 137 px, then flat.
    //
    // The interval is therefore subtracted from the timestamps Lenis sees: it is time during which
    // the spine did not exist, and the library has no business learning about it. Done through the
    // public raf(time) argument, never by writing the instance's internal clock, so a Lenis upgrade
    // cannot silently un-fix it. Guarded by src/design/jarvis/lenis-wake-guard.test.tsx.
    let parkedAt = 0;
    let parkedTotal = 0;

    /** Stop ticking, and record WHEN. Every path that parks goes through here — one that does not
     *  leaves its gap in Lenis's next deltaTime, which is exactly the defect above.
     *
     *  The stamp is taken on the TRANSITION into parked only (`raf` still holds a live handle).
     *  Parking twice is normal — the idle timer parks, the window is hidden some time later and
     *  parks again — and overwriting the stamp on that second call drops everything between the two
     *  parks from parkedTotal, handing it straight back to the easing clock. That is the same
     *  teleport as above, one layer down; it survived the first fix and was caught live on b3fc59ec
     *  (scrollTop 1000, 1000, 1000… — a zero-frame snap). Guarded by lenis-wake-guard.test.tsx. */
    const park = (at: number) => {
      if (raf) parkedAt = at;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    const loop = (time: number) => {
      lenis?.raf(time - parkedTotal);

      const top = wrapper.scrollTop;
      if (top !== lastTop) {
        lastTop = top;
        lastMotion = time;
      }
      if (time - lastMotion > IDLE_AFTER_MS) {
        park(time); // Parked. Nothing has moved for a second — the next input re-arms it.
        return;
      }
      raf = requestAnimationFrame(loop);
    };

    /** Arm the loop (or extend its life) — safe to call on every event of a burst. */
    const wake = () => {
      if (disposed || !lenis || document.hidden) return;
      const now = performance.now();
      lastMotion = now;
      if (raf) return; // already running: nothing was parked, nothing to discount
      if (parkedAt) parkedTotal += now - parkedAt;
      parkedAt = 0;
      raf = requestAnimationFrame(loop);
    };

    const onVisibility = () => {
      if (document.hidden) {
        // A hidden window is a park like any other — and the longest one there is. Left unrecorded,
        // the first scroll after the user comes back is the snap all over again.
        park(performance.now());
        lenis?.stop();
      } else {
        // Do NOT arm here: a window coming back to the foreground with nobody touching it is
        // exactly the case that used to cost a core. It wakes on the first real input.
        lenis?.start();
        lastTop = wrapper.scrollTop;
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
      for (const type of WAKE_EVENTS) {
        wrapper.addEventListener(type, wake, { passive: true });
      }
      wrapper.addEventListener("scroll", wake, { passive: true });
      document.addEventListener("visibilitychange", onVisibility);
      // One arming pass so a scroll restored on mount settles, then it parks on its own.
      wake();
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      raf = 0;
      for (const type of WAKE_EVENTS) wrapper.removeEventListener(type, wake);
      wrapper.removeEventListener("scroll", wake);
      document.removeEventListener("visibilitychange", onVisibility);
      lenis?.destroy();
      lenis = null;
    };
  }, [wrapperRef, contentRef]);

  return null;
}

export default LenisSpine;
