// bug → guard (self-review FAIL, 2026-08-06). The idle stand-down in LenisSpine parked the rAF loop
// and cut 6.5 CPU points off an unattended window — and traded a user-visible regression for them.
//
// Lenis eases on a CLOCK. `raf(time)` derives deltaTime from the previous call and damps by
// 1-e^(-λ·Δt). Park the loop for four seconds and the next call reports Δt≈4000 ms, which saturates
// that factor to ~1: the lane jumps to the target in a single frame instead of easing to it. The
// live reproduction was a 13-frame curve on the first scroll of a session and one 137 px jump, then
// flat, on every scroll after a park. Every wake path — wheel, keydown, touch, pointer, scrollbar,
// and returning from a hidden window — funnels through the same wake()/loop() pair, so all of them
// carried it.
//
// The static guard in src/shell-idle-guard.test.ts proves the loop can STOP. Nothing proved it could
// stop and still ease afterwards, and green tests are exactly what shipped the snap. So this one is
// behavioural: park the spine for real, walk away for four seconds, scroll, and read the timestamp
// Lenis actually receives. It fails on the un-fixed component.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { LenisSpine } from "./LenisSpine";

// Hoisted: vi.mock's factory runs before module-scope consts exist.
const { rafTimes } = vi.hoisted(() => ({ rafTimes: [] as number[] }));

vi.mock("lenis", () => ({
  default: class FakeLenis {
    constructor(_opts: unknown) {}
    /** The whole point of the fixture: record what the library is told the time is. */
    raf(time: number) {
      rafTimes.push(time);
    }
    stop() {}
    start() {}
    destroy() {}
  },
}));

/** One frame in flight at a time — the spine never queues two, and a single slot makes the
 *  "did it park?" question answerable by looking at the slot. */
let queued: FrameRequestCallback | null = null;
let clock = 0;
let nextId = 1;

/** Advance wall time by `dt` and run the pending frame, if any. */
function frame(dt: number) {
  clock += dt;
  const cb = queued;
  queued = null;
  cb?.(clock);
}

/** Move time forward WITHOUT running a frame — the user walking away from a parked spine. */
function elapse(dt: number) {
  clock += dt;
}

/** The most recent timestamp Lenis was handed. NaN if it was never ticked, which every delta
 *  assertion below inherits — a silently inert fixture fails loudly rather than passing. */
function last(): number {
  return rafTimes.length ? rafTimes[rafTimes.length - 1] : NaN;
}

async function mountSpine() {
  const wrapper = document.createElement("div");
  const content = document.createElement("div");
  wrapper.appendChild(content);
  document.body.appendChild(wrapper);
  render(<LenisSpine wrapperRef={{ current: wrapper }} contentRef={{ current: content }} />);
  // The spine dynamic-imports lenis, then attaches listeners and arms once. Let the module graph
  // settle on a real macrotask — counting microtask turns is a guess that silently yields an inert
  // fixture, and an inert fixture passes every assertion below.
  await new Promise((r) => setTimeout(r, 0));
  expect(
    queued,
    "the spine did not arm on mount — the lenis mock never resolved, so this file is proving nothing",
  ).not.toBe(null);
  return wrapper;
}

beforeEach(() => {
  rafTimes.length = 0;
  queued = null;
  clock = 1000;
  nextId = 1;
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queued = cb;
    return nextId++;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    queued = null;
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Park the spine by running frames until it stops re-arming, and assert it really did. */
function runUntilParked() {
  for (let i = 0; i < 200 && queued; i++) frame(20);
  expect(queued, "the spine never parked — the idle stand-down is broken, not just the wake").toBe(
    null,
  );
}

describe("LenisSpine hides the parked interval from Lenis's clock", () => {
  it("the first frame after a long park carries a normal delta, not the park's length", async () => {
    const wrapper = await mountSpine();
    runUntilParked();

    const beforePark = last();
    expect(beforePark, "Lenis was never ticked at all — the fixture is not wired").not.toBeNaN();

    elapse(4000); // away from the keyboard
    fireEvent.wheel(wrapper); // ...and back
    frame(16);

    const delta = last() - beforePark;
    expect(
      delta,
      `Lenis was told ${delta.toFixed(0)}ms elapsed across a 4000ms park. Its damping factor is\n` +
        `1-e^(-λ·Δt), which saturates to ~1 at that scale: the lane will TELEPORT to the scroll\n` +
        `target instead of easing to it, on every scroll after the app sits still. The parked\n` +
        `interval must be subtracted from the timestamps passed to lenis.raf().`,
    ).toBeLessThanOrEqual(50);
    expect(delta, "time went backwards or stood still across the wake").toBeGreaterThan(0);
  });

  it("every wake path is covered, not just the wheel", async () => {
    // keydown (Page Down / arrows) and pointerdown (scrollbar drag) reach the same wake(), but a
    // future fix wired into one listener instead of wake() would pass the test above and leave the
    // rest snapping. Cheap to prove, so prove it.
    for (const type of ["keydown", "pointerdown", "touchstart", "scroll"] as const) {
      rafTimes.length = 0;
      const wrapper = await mountSpine();
      runUntilParked();
      const beforePark = last();

      elapse(4000);
      fireEvent(wrapper, new Event(type, { bubbles: false }));
      frame(16);

      expect(
        last() - beforePark,
        `waking via "${type}" hands Lenis the whole parked interval`,
      ).toBeLessThanOrEqual(50);
      cleanup();
      document.body.innerHTML = "";
    }
  });

  it("the clock Lenis sees never runs backwards, across any number of parks", async () => {
    // The obvious wrong fix is to re-base the timestamp on wake (pass performance.now() - something,
    // or reset an offset rather than accumulate it). That fixes the first park and rewinds the clock
    // on the second, which is a different animation bug with the same symptom.
    const wrapper = await mountSpine();
    for (let round = 0; round < 3; round++) {
      runUntilParked();
      elapse(4000);
      fireEvent.wheel(wrapper);
      frame(16);
    }
    const rising = rafTimes.every((t, i) => i === 0 || t > rafTimes[i - 1]);
    expect(rising, `timestamps handed to Lenis: ${rafTimes.join(", ")}`).toBe(true);
  });

  it("a hidden window is treated as a park too", async () => {
    const wrapper = await mountSpine();
    runUntilParked();
    const beforePark = last();

    // Minimised / behind the game: visibilitychange stops the loop on its own path. If that path
    // does not record the park, coming back after ten minutes snaps on the first scroll.
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    elapse(4000);
    hidden.mockReturnValue(false);
    document.dispatchEvent(new Event("visibilitychange"));

    fireEvent.wheel(wrapper);
    frame(16);
    expect(
      last() - beforePark,
      "returning from a hidden window hands Lenis the whole hidden interval",
    ).toBeLessThanOrEqual(50);
  });
});
