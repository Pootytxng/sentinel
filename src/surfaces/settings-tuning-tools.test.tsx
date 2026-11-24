import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";

// D6 Settings → Tuning tools (owner decision 2026-11-24, plan _train/d6-test-room-opt-in-plan-v2.md, review
// items 1-2): turning the tools ON is immediate; turning them OFF is refused, with a sentence, while a Trial,
// a benchmark run or a Gaming Mode session holds something, or while any of those reads fails.

const state = {
  experiments: [] as unknown,
  bench: { running: false } as unknown,
  trial: { running: false } as unknown,
  slot: null as unknown,
  slotReject: false,
};
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_experiments") return Promise.resolve(state.experiments);
    if (cmd === "get_benchmark_state") return Promise.resolve(state.bench);
    if (cmd === "get_trial_state") return Promise.resolve(state.trial);
    if (cmd === "get_gaming_session_state") {
      return state.slotReject ? Promise.reject(new Error("unreadable")) : Promise.resolve(state.slot);
    }
    return Promise.resolve(null);
  }),
}));

import Settings from "./Settings";

const props = {
  appVersion: "0.1.0",
  rulesSourceLabel: "Rules: Built-in",
  onBack: vi.fn(),
  canGoBack: false,
  onForward: vi.fn(),
  canGoForward: false,
  onRerunSetup: vi.fn(),
  onClose: vi.fn(),
};

const flush = () =>
  act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
const toggle = () => screen.getByRole("switch", { name: "Tuning tools" });

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("compy_tuning_tools", "1");
  Object.assign(state, {
    experiments: [],
    bench: { running: false },
    trial: { running: false },
    slot: null,
    slotReject: false,
  });
});
afterEach(() => {
  cleanup();
  // The switch writes "0" in some cases; never leak it into a later test.
  localStorage.removeItem("compy_tuning_tools");
});

describe("Settings → Tuning tools", () => {
  it("says what it does and that it changes nothing on the PC", () => {
    render(<Settings {...props} />);
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/changes nothing on your PC; it only shows or hides those tools/)).toBeInTheDocument();
  });

  // Control for the refusals below: with nothing running the switch turns off and the choice is stored.
  it("turns off when nothing is running", async () => {
    render(<Settings {...props} />);
    fireEvent.click(toggle());
    await flush();
    expect(localStorage.getItem("compy_tuning_tools")).toBe("0");
    expect(toggle().getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("tuning-tools-refusal")).toBeNull();
  });

  it("turns on at once, reading nothing", async () => {
    localStorage.setItem("compy_tuning_tools", "0");
    render(<Settings {...props} />);
    fireEvent.click(toggle());
    expect(localStorage.getItem("compy_tuning_tools")).toBe("1");
  });

  // Break check: in Settings.changeTuningTools, call setTuningTools(false) without awaiting the refusal and
  // every row below stores "0".
  it.each([
    ["a running Trial", () => (state.experiments = [{ status: "running" }]), /A Trial is in progress/],
    ["an unreadable Trial list", () => (state.experiments = null), /couldn't read whether a Trial is in progress/],
    ["a benchmark run", () => (state.bench = { running: true }), /Benchmark is running/],
    ["a tweak trial", () => (state.trial = { running: true }), /Benchmark is running/],
    ["an unreadable benchmark state", () => (state.bench = null), /couldn't read whether Benchmark is running/],
    ["a live or pending Gaming Mode session", () => (state.slot = { phase: "active" }), /A Gaming Mode session is on or waiting/],
    ["an unreadable Gaming Mode slot", () => (state.slotReject = true), /couldn't read Gaming Mode's session/],
  ])("refuses to turn off with %s, and says why", async (_name, arrange, sentence) => {
    arrange();
    render(<Settings {...props} />);
    fireEvent.click(toggle());
    await flush();
    expect(localStorage.getItem("compy_tuning_tools")).toBe("1");
    expect(toggle().getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("tuning-tools-refusal").textContent).toMatch(sentence);
  });
});
