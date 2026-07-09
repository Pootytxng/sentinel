import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

// Guards for the Instrument Bench (spec 2026-07-09-lab-redesign-direction-proposal, Phase 1) —
// LabBench replaces the Lab's linear ground spine with a bento grid of living station bays. The
// hero bay is station 1 "Optimize" (the enable-all fast path, rendered inline); the measure/prove
// stations are compact door bays that open one detail at a time. Everything animated gates on the
// app's resolved reduced-motion. These pin: every station has a bay + no gallery bay survives; the
// hero renders the audited enable-all control; the reduced-motion path is static; and the vendor
// purple can never paint (accent-retint law).

// Lab + the embedded instrument tabs poll on mount; mock invoke so they don't throw.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

// Fix's apply-all consent sheet mounts under a ConfirmProvider; the hero bay renders Fix.
const { LabBench } = await import("./LabBench");
const { ConfirmProvider } = await import("../design/ConfirmDialog");
import type { LabFastPathProps } from "./lab/OptimizeStation";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

// Two safe, one-click, not-yet-applied recs → the hero's "Apply reviewed (N)" enable-all bar shows
// (Fix renders the batch bar only at safeBatch.length >= 2).
const SAFE_RECS = [
  {
    id: "game-mode",
    title: "Game Mode",
    category: "system",
    severity: "safe",
    description: "d",
    impact: "i",
    downside: null,
    applies_to: "all",
    currently_applied: false,
    provenance: "verified",
    eligible: true,
  },
  {
    id: "hags",
    title: "Hardware GPU scheduling",
    category: "system",
    severity: "safe",
    description: "d",
    impact: "i",
    downside: null,
    applies_to: "all",
    currently_applied: false,
    provenance: "verified",
    eligible: true,
  },
] as never[];

const fastProps = (recs: never[] = SAFE_RECS): LabFastPathProps => ({
  recs,
  startup: [],
  changes: [],
  busyId: null,
  isAppliable: () => true,
  activeChangeFor: () => undefined,
  onToggleRec: () => {},
  onToggleStartup: () => {},
  onRollback: () => {},
  onApplyBatch: async () => ({ applied: 0, skipped: [] }),
  onOpenLibrary: () => {},
  onChanged: () => {},
  sessions: [],
  gpus: [],
  vendor: "amd",
});

const renderBench = (recs: never[] = SAFE_RECS) =>
  render(
    <ConfirmProvider>
      <LabBench
        fast={fastProps(recs)}
        vendor="amd"
        diagnostics={<div data-testid="diag" />}
        diagnosticsCaptured
      />
    </ConfirmProvider>,
  ).container;

describe("LabBench — bento grid of station bays", () => {
  it("renders a bay for every station: hero Optimize + the 5 measure bays, no Gallery", () => {
    const c = renderBench();
    // Hero bay = station 1 Optimize.
    expect(c.querySelector(".lab-bench-hero")).not.toBeNull();
    expect(c.querySelector(".lab-bench-hero-name")!.textContent).toBe("Optimize");
    // Measure bays in bench order.
    const measure = Array.from(c.querySelectorAll(".lab-bench-name")).map((n) => n.textContent);
    expect(measure).toEqual(["Diagnostics", "Benchmark", "Latency", "Tuning", "Black Box"]);
    // The rejected drag telemetry gallery is gone — no bay for it anywhere.
    expect(c.innerHTML).not.toContain("Gallery");
  });

  it("the hero bay renders the audited enable-all control (the fast path leads)", () => {
    const c = renderBench();
    const applyAll = Array.from(c.querySelectorAll<HTMLButtonElement>("button")).find((b) =>
      /Apply reviewed/i.test(b.textContent ?? ""),
    );
    expect(applyAll, "hero shows the Apply-reviewed enable-all bar").toBeDefined();
  });

  it("no hero bay when there are no tweaks — just the measure bays, no throw", () => {
    const c = renderBench([]);
    expect(c.querySelector(".lab-bench-hero")).toBeNull();
    const measure = Array.from(c.querySelectorAll(".lab-bench-name")).map((n) => n.textContent);
    expect(measure).toEqual(["Diagnostics", "Benchmark", "Latency", "Tuning", "Black Box"]);
  });

  it("clicking a measure bay opens exactly ONE detail; clicking again closes; another swaps", () => {
    const c = renderBench();
    const doorFor = (name: string) =>
      Array.from(c.querySelectorAll<HTMLButtonElement>(".lab-bench-door")).find((d) =>
        d.textContent!.includes(name),
      )!;
    fireEvent.click(doorFor("Benchmark"));
    let details = c.querySelectorAll(".lab-bench-detail");
    expect(details).toHaveLength(1);
    expect(details[0].getAttribute("data-instrument")).toBe("Benchmark");
    fireEvent.click(doorFor("Latency"));
    details = c.querySelectorAll(".lab-bench-detail");
    expect(details).toHaveLength(1);
    expect(details[0].getAttribute("data-instrument")).toBe("Latency");
    fireEvent.click(doorFor("Latency"));
    expect(c.querySelector(".lab-bench-detail")).toBeNull();
  });

  it("reduced-motion path is static — the grid is marked reduced and still renders every bay", () => {
    localStorage.setItem("compy_motion", "reduced");
    const c = renderBench();
    const grid = c.querySelector(".lab-bench-grid")!;
    expect(grid.getAttribute("data-motion")).toBe("reduced");
    // Every bay still present (static, no tilt/particle side-effects thrown).
    expect(c.querySelector(".lab-bench-hero")).not.toBeNull();
    expect(c.querySelectorAll(".lab-bench-measure")).toHaveLength(5);
  });

  it("the vendor purple never paints — glow is the computed theme accent (or neutral fallback)", () => {
    const c = renderBench();
    expect(c.innerHTML).not.toContain("132, 0, 255");
  });

  // Task 3 — bolder reactivity, reduced-motion-gated. The measure doors expose data-reactive
  // mirroring the ParticleCard tilt/magnetism state (on = !reduced), so the reduced contract is
  // pinned in the DOM without reaching into vendor internals.
  it("reduced motion disables tilt/magnetism — every measure door is data-reactive='off'", () => {
    localStorage.setItem("compy_motion", "reduced");
    const c = renderBench();
    expect(c.querySelector(".lab-bench-grid")!.getAttribute("data-motion")).toBe("reduced");
    const doors = Array.from(c.querySelectorAll(".lab-bench-door"));
    expect(doors).toHaveLength(5);
    expect(doors.every((d) => d.getAttribute("data-reactive") === "off")).toBe(true);
  });

  it("full motion enables reactivity — every measure door is data-reactive='on'", () => {
    const c = renderBench(); // default pref is "full" (motion on, override OS)
    expect(c.querySelector(".lab-bench-grid")!.getAttribute("data-motion")).toBe("full");
    const doors = Array.from(c.querySelectorAll(".lab-bench-door"));
    expect(doors.every((d) => d.getAttribute("data-reactive") === "on")).toBe(true);
  });
});

// Task 4 — the honesty rail: the hero gauge animates a REAL measured number (safe stack applied vs
// total) and renders ONLY when that source exists. No fabricated/placeholder value ever paints.
const MODERATE_ONLY = [
  { ...(SAFE_RECS[0] as Record<string, unknown>), id: "moderate-only", severity: "moderate" },
] as never[];

describe("hero gauge (honesty rail, Task 4)", () => {
  it("renders the gauge when a measured safe stack exists — applied vs total", () => {
    const c = renderBench(); // 2 safe, none applied → 0 / 2
    const gauge = c.querySelector(".lab-gauge");
    expect(gauge).not.toBeNull();
    expect(gauge!.getAttribute("aria-label")).toBe("0 of 2 safe tweaks applied");
    expect(c.querySelector(".lab-gauge-num")!.textContent).toBe("0");
    expect(c.querySelector(".lab-gauge-den")!.textContent).toBe("/2");
  });

  it("NO gauge when there's no safe stack (hero still present) — never a placeholder", () => {
    const c = renderBench(MODERATE_ONLY);
    expect(c.querySelector(".lab-bench-hero")).not.toBeNull(); // hero renders (recs present)
    expect(c.querySelector(".lab-gauge")).toBeNull(); // but no measured source → no gauge
  });
});
