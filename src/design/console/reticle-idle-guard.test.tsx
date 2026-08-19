// bug->guard, 2026-08-19 — the third instance of one failure class, filed as issue #142.
//
// `ReticleCursor` starts a requestAnimationFrame loop on pointerenter and only stops it on
// pointerleave. Between those two events the loop runs FOREVER at display refresh rate, writing a
// `transform` on the reticle element every frame — including the normal case where the pointer is
// resting somewhere inside the window while the user reads the screen. The lerp (`rx += (tx-rx)*0.35`)
// converges asymptotically and never reaches the target, so "settled" never ends the loop on its own:
// after ~20 frames every write is sub-pixel-identical to the one before it, and the app keeps paying
// a frame callback plus a compositor-visible style write for the lifetime of the visit.
//
// Same class as the two idle loops fixed under #127 (the 3D rig's orbit-controls loop and the ambient
// raster): a decorative loop that costs frames while producing an identical frame. It matters here
// because of the standing owner bar — Compy must be the least resource-hungry app on the PC.
//
// The contract this pins is behavioural, not textual: drive the component's own rAF loop through a
// fake scheduler and assert the loop PARKS itself when there is nothing left to move, and WAKES when
// there is. Falsified against the pre-fix source (2026-08-19): parks / wakes / snap-repaint all fail
// (the loop never stops scheduling) while the pointerleave test still passes — it goes red for the
// defect, not for the surrounding behaviour.
import { render } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useRef } from "react";

vi.mock("../use-motion", () => ({ useReducedMotion: () => false }));
vi.mock("../use-hud", () => ({ useHudFrameFlag: () => false }));

import { ReticleCursor } from "./ReticleCursor";

// ── a fake frame scheduler, so "does it stop?" is a countable fact ─────────────────────────────
let pending = new Map<number, FrameRequestCallback>();
let nextId = 1;
const realRaf = globalThis.requestAnimationFrame;
const realCancel = globalThis.cancelAnimationFrame;

beforeEach(() => {
  pending = new Map();
  nextId = 1;
  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  }) as typeof requestAnimationFrame;
  globalThis.cancelAnimationFrame = ((id: number) => {
    pending.delete(id);
  }) as typeof cancelAnimationFrame;
});
afterEach(() => {
  globalThis.requestAnimationFrame = realRaf;
  globalThis.cancelAnimationFrame = realCancel;
});

/** Run `n` frames. A parked loop schedules nothing, so extra frames are free no-ops. */
const flush = (n = 1) => {
  for (let i = 0; i < n; i++) {
    const due = [...pending.values()];
    pending.clear();
    due.forEach((cb) => cb(i));
  }
};

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} data-testid="scope">
      <button data-target>go</button>
      <ReticleCursor scopeRef={ref} />
    </div>
  );
}

const mount = () => {
  const { getByTestId } = render(<Harness />);
  const scope = getByTestId("scope");
  return {
    scope,
    button: scope.querySelector("button")!,
    reticle: scope.querySelector(".lc-reticle") as HTMLElement,
  };
};

const move = (el: Element, clientX: number, clientY: number) =>
  el.dispatchEvent(new MouseEvent("pointermove", { clientX, clientY, bubbles: true }));

describe("ReticleCursor idle cost (#142)", () => {
  it("parks the frame loop once the pointer stops moving", () => {
    const { scope, reticle } = mount();
    scope.dispatchEvent(new MouseEvent("pointerenter"));
    expect(pending.size, "entering the scope must start the loop").toBe(1);

    move(scope, 120, 80);
    flush(200);

    expect(
      pending.size,
      "the reticle is still scheduling a frame with a motionless pointer — that is a permanent idle cost for the whole visit (#142)",
    ).toBe(0);
    // Parking is only honest if it happens AT the target, not wherever the lerp gave up.
    expect(reticle.style.transform).toContain("translate(120px, 80px)");
  });

  it("wakes on the next move and parks again at the new position", () => {
    const { scope, reticle } = mount();
    scope.dispatchEvent(new MouseEvent("pointerenter"));
    move(scope, 120, 80);
    flush(200);

    move(scope, 300, 240);
    expect(pending.size, "a parked loop must restart on the next pointer move").toBe(1);
    flush(200);
    expect(pending.size).toBe(0);
    expect(reticle.style.transform).toContain("translate(300px, 240px)");
  });

  it("still repaints the corner-spread when a target is hovered while parked", () => {
    // The snap scale is written by the same loop, so parking must not swallow it.
    const { scope, button, reticle } = mount();
    scope.dispatchEvent(new MouseEvent("pointerenter"));
    move(scope, 120, 80);
    flush(200);

    button.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    flush(5);
    expect(reticle.style.transform, "hovering a target must still spread the brackets").toContain(
      "scale(1.7)",
    );
    expect(pending.size, "one frame is enough for a scale change — it must not leave a loop running").toBe(0);

    button.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    flush(5);
    expect(reticle.style.transform).toContain("scale(1)");
    expect(pending.size).toBe(0);
  });

  it("still stops the loop when the pointer leaves the scope", () => {
    const { scope } = mount();
    scope.dispatchEvent(new MouseEvent("pointerenter"));
    move(scope, 400, 400);
    flush(3);
    expect(pending.size, "mid-flight the loop is expected to be running").toBe(1);

    scope.dispatchEvent(new MouseEvent("pointerleave"));
    expect(pending.size, "leaving the scope must cancel the in-flight frame").toBe(0);
  });
});
