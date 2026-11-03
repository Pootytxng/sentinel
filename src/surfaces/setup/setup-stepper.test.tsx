import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";

// The tour's 3D stage is lazy three.js — mock it out (these guards test the chrome, not WebGL).
vi.mock("./HardwareTourScene", () => ({ HardwareTourScene: () => null }));
// StepCheck's scan hook invokes on mount; keep the surface inert.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
// Deterministic steps: no rig parts ⇒ the 4 setup steps + the recap = 5 steps.
vi.mock("../rig/rig-parts", () => ({ buildRigParts: () => [] }));

import { SetupTour } from "./SetupTour";
import type { HardwareInfo } from "../../App";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmProvider } from "../../design/ConfirmDialog";

// Guards for the Setup & Tour stepper progress (React Bits Stepper, round-2 sourcing pass;
// DEFAULT ON since the owner approval 2026-07-06). These pin the reversibility contract
// (flag "0" — the Settings failsafe — restores the classic tick row with zero stepper DOM;
// flag absent renders the stepper), the indicator/connector composition, click-to-jump, and
// that the vendor purple can never paint.

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const renderTour = () =>
  render(<SetupTour hw={{} as HardwareInfo} rig={[]} onDone={() => {}} />).container;

describe("compy_setup_stepper flag-off byte-identity (the classic failsafe)", () => {
  it("flag absent renders the stepper (default ON — owner approval 2026-07-06)", () => {
    const c = renderTour();
    expect(c.querySelector(".st-progress-stepper")).not.toBeNull();
  });

  it("flag='0': the classic ticks render, zero stepper DOM", () => {
    localStorage.setItem("compy_setup_stepper", "0");
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

// Codebase review 2026-11-03: the tour's clean verdict printed "{{count}} checks came back right"
// with count = EVERY check, so unread checks (never limiters) and advisory ones read as passes.
describe("the first check counts only what it read", () => {
  afterEach(() => vi.mocked(invoke).mockImplementation((() => Promise.resolve(null)) as never));

  it("1 right + 3 unread reads as 1 right and 3 unread — never 4 right", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "get_game_readiness")
        return Promise.resolve({
          checks: ["a", "b", "c", "d"].map((id, n) => ({
            id,
            label: `Check ${id}`,
            status: n === 0 ? "ready" : "unknown",
            detail: "",
            value: null,
          })),
          ready_count: 1,
          attention_count: 0,
          unknown_count: 3,
          advisory_count: 0,
          advisory: "",
          dismissed_ids: [],
          drifts: [],
        });
      if (cmd === "priorities_from")
        return Promise.resolve({ limiters: [], already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null });
      if (cmd === "get_recommendations") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as never);
    render(
      <ConfirmProvider>
        <SetupTour hw={{} as HardwareInfo} rig={[]} onDone={() => {}} />
      </ConfirmProvider>,
    );
    for (let n = 0; n < 3; n++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Ready to play — everything Compy could read measured clean")).toBeTruthy();
    expect(screen.getByText("1 check came back right — measured on this rig, not assumed.")).toBeTruthy();
    expect(screen.getByText("3 checks couldn't be read on this PC, so they aren't counted either way.")).toBeTruthy();
    expect(screen.queryByText(/4 checks came back right/)).toBeNull();
  });

  // Desk review 2026-11-03: the tour said "14 checks came back right" and was the only count surface
  // that never named his 2 advisory checks.
  it("names advisory checks as noted, not graded — never counted as right", async () => {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      if (cmd === "get_game_readiness")
        return Promise.resolve({
          checks: ["a", "b", "c"].map((id, n) => ({
            id,
            label: `Check ${id}`,
            status: n === 0 ? "ready" : "advisory",
            detail: "",
            value: null,
          })),
          ready_count: 1,
          attention_count: 0,
          unknown_count: 0,
          advisory_count: 2,
          advisory: "",
          dismissed_ids: [],
          drifts: [],
        });
      if (cmd === "priorities_from")
        return Promise.resolve({ limiters: [], already_fine: [], not_worth_touching: [], session_hint: null, upgrade_path: null });
      if (cmd === "get_recommendations") return Promise.resolve([]);
      return Promise.resolve(null);
    }) as never);
    render(
      <ConfirmProvider>
        <SetupTour hw={{} as HardwareInfo} rig={[]} onDone={() => {}} />
      </ConfirmProvider>,
    );
    for (let n = 0; n < 3; n++) fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("1 check came back right — measured on this rig, not assumed.")).toBeTruthy();
    expect(screen.getByText("2 more are advisory: noted, not graded.")).toBeTruthy();
    expect(screen.queryByText(/3 checks came back right/)).toBeNull();
  });
});

describe("the tour's keys yield to an open confirm", () => {
  it("arrows and Esc do nothing while an apply confirm is up", () => {
    const done = vi.fn();
    render(
      <ConfirmProvider>
        <SetupTour hw={{} as HardwareInfo} rig={[]} onDone={done} />
      </ConfirmProvider>,
    );
    const count = () => document.querySelector(".st-count")!.textContent;
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(count()).toBe("2 / 5");
    const prompt = document.createElement("div");
    prompt.setAttribute("role", "alertdialog");
    prompt.setAttribute("aria-modal", "true");
    document.body.appendChild(prompt);
    try {
      fireEvent.keyDown(window, { key: "ArrowRight" });
      fireEvent.keyDown(window, { key: "ArrowLeft" });
      fireEvent.keyDown(window, { key: "Escape" });
      expect(count()).toBe("2 / 5");
      expect(done).not.toHaveBeenCalled();
    } finally {
      prompt.remove();
    }
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(count()).toBe("1 / 5");
  });
});
