import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import DecryptedText from "./vendor/DecryptedText/DecryptedText";

// bug→guard (V2-15, 2026-07-03): the V2 room verdict headline (DecryptedText, animateOn="view")
// re-fired its per-character scramble from scratch on EVERY re-mount, because it gated on
// `hasAnimated` component state (reset each mount). Returning to a room re-churned the headline for
// ~1s — the tab-switch "stick" Cowork caught visually (long-task profiling never saw it: sub-50ms
// churn). Fix: a module-level decode-once registry — a given text scrambles ONCE, then renders
// resolved instantly on any later re-mount. This guard pins that behavior so it can't regress.
//
// jsdom has no layout, so we stub IntersectionObserver to report "in view" synchronously on observe,
// and use fake timers to drive the scramble interval deterministically.

class ImmediateIO {
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe(el: Element) {
    this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const TEXT = "READY TO PLAY ON THIS RIG";
const hidden = () => document.querySelector('[aria-hidden="true"]')?.textContent ?? "";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IntersectionObserver", ImmediateIO as unknown as typeof IntersectionObserver);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DecryptedText decode-once (no re-scramble on re-mount)", () => {
  it("scrambles on FIRST view, then renders resolved INSTANTLY on re-mount", () => {
    // ── first mount: the IntersectionObserver fires → the scramble starts ──
    const first = render(<DecryptedText text={TEXT} animateOn="view" sequential speed={10} useOriginalCharsOnly />);
    act(() => {
      vi.advanceTimersByTime(40); // a few interval ticks in — mid-scramble
    });
    // mid-scramble the visible text is NOT yet the resolved headline (it's churning)
    expect(hidden()).not.toBe(TEXT);
    // let it finish decoding + register the text as decoded-once
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(hidden()).toBe(TEXT); // resolved
    first.unmount();

    // ── re-mount the SAME text (as a room revisit does) ──
    render(<DecryptedText text={TEXT} animateOn="view" sequential speed={10} useOriginalCharsOnly />);
    // BEFORE advancing any timers: it must already be the resolved text — no scramble kicked off.
    expect(hidden()).toBe(TEXT);
    // and advancing time changes nothing (no interval churning the headline)
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(hidden()).toBe(TEXT);
  });

  it("still scrambles a DIFFERENT (not-yet-seen) text on first view", () => {
    const other = "NOTHING NEEDS ATTENTION TODAY";
    render(<DecryptedText text={other} animateOn="view" sequential speed={10} useOriginalCharsOnly />);
    act(() => {
      vi.advanceTimersByTime(40);
    });
    expect(hidden()).not.toBe(other); // a new verdict still gets its one reveal
  });
});
