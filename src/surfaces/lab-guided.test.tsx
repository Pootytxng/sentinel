import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

// Lab + the embedded instrument tabs poll on mount; mock invoke so they don't throw.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import Lab from "./Lab";

// Guards for the guided Lab bench (spec 2026-07-05-lab-linear-guided-bench).
// The redesign is behind compy_lab_guided, DEFAULT OFF — these tests pin the reversibility
// contract: with the flag off (absent OR explicitly "0"), today's Lab renders byte-identical,
// with zero guided-bench DOM present.

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const renderClassic = () =>
  render(<Lab v2 vendor="amd" diagnostics={<div data-testid="diag" />} diagnosticsCaptured />)
    .container;

describe("compy_lab_guided flag-off byte-identity", () => {
  it("flag absent and flag='0' render byte-identical HTML", () => {
    const absent = renderClassic().innerHTML;
    cleanup();
    localStorage.setItem("compy_lab_guided", "0");
    const off = renderClassic().innerHTML;
    expect(off).toBe(absent);
  });

  it("flag off: classic Lab untouched — welcome band, classic order, readings strip, no guided DOM", () => {
    const c = renderClassic();
    // Classic markers all present.
    expect(c.querySelector(".lab-welcome")).not.toBeNull();
    expect(c.querySelector(".lab-readings")).not.toBeNull();
    const names = Array.from(c.querySelectorAll(".lab-card-name")).map((n) => n.textContent);
    expect(names).toEqual(["Benchmark", "Black Box", "Latency", "Tuning", "Diagnostics"]);
    // Zero guided-bench DOM: no root marker, no router, no stations, no walk affordance.
    expect(c.querySelector("[data-guided]")).toBeNull();
    expect(c.querySelector(".lab-router")).toBeNull();
    expect(c.querySelector(".lab-station-lines")).toBeNull();
    expect(c.querySelector(".lab-walk")).toBeNull();
  });

  it("flag on: the root wears the guided marker (the preview toggle has a live hook)", () => {
    localStorage.setItem("compy_lab_guided", "1");
    expect(renderClassic().querySelector("[data-guided]")).not.toBeNull();
  });
});
