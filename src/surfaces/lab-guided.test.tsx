import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// Lab + the embedded instrument tabs poll on mount; mock invoke so they don't throw.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import Lab from "./Lab";
import { LAB_ROUTER } from "./lab-guided-data";

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

const renderGuided = () => {
  localStorage.setItem("compy_lab_guided", "1");
  return renderClassic();
};

describe("guided bench stations (§B)", () => {
  it("orders the stations Diagnostics → Benchmark → Latency → Tuning → Black Box, numbered 1..5", () => {
    const c = renderGuided();
    const names = Array.from(c.querySelectorAll(".lab-card-name")).map((n) => n.textContent);
    expect(names).toEqual(["Diagnostics", "Benchmark", "Latency", "Tuning", "Black Box"]);
    const nums = Array.from(c.querySelectorAll(".lab-station-num")).map((n) => n.textContent);
    expect(nums).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("every station carries the four contract lines, labeled", () => {
    const c = renderGuided();
    const stations = Array.from(c.querySelectorAll(".lab-station-lines"));
    expect(stations).toHaveLength(5);
    for (const s of stations) {
      const labels = Array.from(s.querySelectorAll("dt")).map((d) => d.textContent);
      expect(labels).toEqual([
        "What it's for",
        "Reach for it when",
        "What the reading means",
        "How it connects",
      ]);
    }
  });

  it("numbering is computed over the stations this rig has (no gaps when Tuning/Diagnostics are absent)", () => {
    localStorage.setItem("compy_lab_guided", "1");
    const c = render(<Lab v2 vendor="nvidia" />).container; // no tuning guide, no diagnostics slot
    const names = Array.from(c.querySelectorAll(".lab-card-name")).map((n) => n.textContent);
    expect(names).toEqual(["Benchmark", "Latency", "Black Box"]);
    const nums = Array.from(c.querySelectorAll(".lab-station-num")).map((n) => n.textContent);
    expect(nums).toEqual(["1", "2", "3"]);
  });

  it("with nothing measured, reading lines are an honest 'No reading yet' — never a placeholder number", () => {
    const c = renderGuided(); // invoke mock resolves null for every probe
    const readings = Array.from(c.querySelectorAll(".lab-station-line"))
      .filter((l) => l.querySelector("dt")!.textContent === "What the reading means")
      .map((l) => l.querySelector("dd")!.textContent!);
    // Benchmark, Latency, Tuning, Black Box: nothing run yet → "No reading yet".
    // Diagnostics: captured (the fixture passes diagnosticsCaptured) → the captured line.
    expect(readings.filter((r) => r.startsWith("No reading yet"))).toHaveLength(4);
    expect(readings.some((r) => /\d/.test(r) && !r.startsWith("No reading yet"))).toBe(false);
  });

  it("the reading line pulls the SAME live value the instrument body shows (benchmark verdict)", async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      Promise.resolve(
        cmd === "get_benchmark_state"
          ? { baseline: {}, baseline_at: null, efficacy: { overall: "improved" } }
          : cmd === "get_session_summaries"
            ? [] // an array, so the tuning measurement path never sees null mid-render
            : null,
      ),
    );
    renderGuided();
    const line = await screen.findByText(/Last verdict: Improved/);
    expect(line.textContent).toMatch(/moved more than the run's own noise/);
    vi.mocked(invoke).mockImplementation(() => Promise.resolve(null));
  });
});

describe("'Which tool do I need?' router (§A)", () => {
  it("pins the symptom→station map literally (the spec's copy, word for word)", () => {
    expect(LAB_ROUTER).toEqual([
      {
        symptom: "My aim/clicks feel a beat behind",
        station: "latency",
        because: "it traces mouse→screen and names what's adding delay",
      },
      {
        symptom: "Did that tweak actually help — or did I imagine it?",
        station: "benchmark",
        because: "it grades a real before/after against a noise floor",
      },
      {
        symptom: "It runs hot / loud, I want it cooler without losing frames",
        station: "tuning",
        because: "it measures whether an undervolt dropped temps AND held frames",
      },
      {
        symptom: "It crashed or froze and I don't know why",
        station: "blackbox",
        because: "it reads Windows' own crash & freeze record in plain English",
      },
      {
        symptom: "I just want to know what's in this rig",
        station: "diagnostics",
        because: "read-only forensics — everything Compy detected, raw",
      },
    ]);
  });

  it("renders one row per station this rig has — never a row for a missing tool", () => {
    const c = renderGuided();
    expect(c.querySelectorAll(".lab-router-row")).toHaveLength(5);
    cleanup();
    localStorage.setItem("compy_lab_guided", "1");
    const bare = render(<Lab v2 vendor="nvidia" />).container; // no Tuning, no Diagnostics
    const stations = Array.from(bare.querySelectorAll(".lab-router-station")).map(
      (s) => s.textContent,
    );
    expect(stations).toEqual(["Latency", "Benchmark", "Black Box"]);
  });

  it("flag on: the 'Latest readings' strip is gone — its role lives in the station reading lines", () => {
    const c = renderGuided();
    expect(c.querySelector(".lab-readings")).toBeNull();
    // Every present station still carries a live reading line (the strip's role, absorbed).
    expect(
      Array.from(c.querySelectorAll(".lab-station-line dt")).filter(
        (d) => d.textContent === "What the reading means",
      ),
    ).toHaveLength(5);
  });

  it("clicking a row expands that station in place (no teleport)", () => {
    const c = renderGuided();
    const rows = Array.from(c.querySelectorAll<HTMLButtonElement>(".lab-router-row"));
    const latencyRow = rows.find((r) => r.textContent!.includes("a beat behind"))!;
    fireEvent.click(latencyRow);
    const card = c.querySelector("#lab-station-latency")!;
    expect(card.querySelector(".lab-card-head")!.getAttribute("aria-expanded")).toBe("true");
  });
});
