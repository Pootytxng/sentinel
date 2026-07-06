import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

// The tour's 3D stage is lazy three.js — mock it out (these guards test the chrome, not WebGL).
vi.mock("./HardwareTourScene", () => ({ HardwareTourScene: () => null }));
// StepCheck's scan hook invokes on mount; keep the surface inert.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
// Deterministic steps: no rig parts ⇒ the 4 setup steps + the recap = 5 steps.
vi.mock("../rig/rig-parts", () => ({ buildRigParts: () => [] }));

import { SetupTour } from "./SetupTour";
import type { HardwareInfo } from "../../App";

// Guards for the Setup & Tour stepper progress (React Bits Stepper, round-2 sourcing pass).
// Behind compy_setup_stepper, DEFAULT OFF — these pin the reversibility contract (flag off ⇒
// today's tour byte-identical), the indicator/connector composition, click-to-jump, and that
// the vendor purple can never paint.

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const renderTour = () =>
  render(<SetupTour hw={{} as HardwareInfo} rig={[]} onDone={() => {}} />).container;

describe("compy_setup_stepper flag-off byte-identity", () => {
  it("flag absent and flag='0' render byte-identical HTML", () => {
    const absent = renderTour().innerHTML;
    cleanup();
    localStorage.setItem("compy_setup_stepper", "0");
    const off = renderTour().innerHTML;
    expect(off).toBe(absent);
  });

  it("flag off: the classic ticks render, zero stepper DOM", () => {
    const c = renderTour();
    expect(c.querySelectorAll(".st-tick")).toHaveLength(5);
    expect(c.querySelector(".st-progress-stepper")).toBeNull();
    expect(c.querySelector(".step-indicator")).toBeNull();
  });
});

const renderStepper = () => {
  localStorage.setItem("compy_setup_stepper", "1");
  return renderTour();
};

describe("stepper progress (flag on)", () => {
  it("one numbered indicator per step, a connector between each — ticks gone", () => {
    const c = renderStepper();
    expect(c.querySelectorAll(".step-indicator")).toHaveLength(5);
    expect(c.querySelectorAll(".step-connector")).toHaveLength(4);
    expect(c.querySelector(".st-tick")).toBeNull();
    // Steps ahead show their number; the current step shows the active dot instead.
    const numbers = Array.from(c.querySelectorAll(".step-number")).map((n) => n.textContent);
    expect(numbers).toEqual(["2", "3", "4", "5"]);
    expect(c.querySelectorAll(".active-dot")).toHaveLength(1);
  });

  it("everything else about the tour is untouched: same count line, same nav buttons", () => {
    const c = renderStepper();
    expect(c.querySelector(".st-count")!.textContent).toBe("1 / 5");
    expect(c.querySelector(".st-nav")).not.toBeNull();
  });

  it("advancing marks the passed step complete (check icon) and fills its connector", () => {
    const c = renderStepper();
    fireEvent.click(
      Array.from(c.querySelectorAll("button")).find((b) => b.textContent === "Next")!,
    );
    expect(c.querySelector(".st-count")!.textContent).toBe("2 / 5");
    const statuses = Array.from(c.querySelectorAll(".step-indicator-inner")).map((n) =>
      n.getAttribute("data-status"),
    );
    expect(statuses).toEqual(["complete", "active", "inactive", "inactive", "inactive"]);
    expect(c.querySelectorAll(".check-icon")).toHaveLength(1);
  });

  it("clicking an indicator hops straight to that step (the arrow keys' free navigation)", () => {
    const c = renderStepper();
    const indicators = c.querySelectorAll<HTMLElement>(".step-indicator");
    fireEvent.click(indicators[2]);
    expect(c.querySelector(".st-count")!.textContent).toBe("3 / 5");
  });

  it("the vendor purple never paints — colors come from theme tokens in CSS", () => {
    const c = renderStepper();
    expect(c.innerHTML.toLowerCase()).not.toContain("5227ff");
    expect(c.innerHTML).not.toContain("82, 39, 255");
  });
});
