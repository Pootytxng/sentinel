import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";

// Lab + the embedded instrument tabs poll on mount; mock invoke so they don't throw.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import Lab from "./Lab";
import { LAB_STATION_ORDER, LAB_STATIONS, stationReading } from "./lab-guided-data";
import {
  LAB_NOTES,
  labBentoCards,
  labCheckup,
  stationHasReading,
} from "./lab-bento-data";
import type { LabStationFacts } from "./lab-guided-data";

// Guards for the Lab bento checkup (spec 2026-07-05-lab-bento-checkup; DEFAULT ON since the
// owner approval 2026-07-06). These pin the reversibility contract (flag "0" — the Settings
// failsafe — restores the classic Lab with zero bento DOM in BOTH guided states; flag absent
// renders the bento), the chronological order, the one-source honesty of the readings, and
// that the vendor purple can never paint.

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const renderLab = () =>
  render(<Lab v2 vendor="amd" diagnostics={<div data-testid="diag" />} diagnosticsCaptured />)
    .container;

const NO_FACTS: LabStationFacts = {
  bench: null,
  latency: null,
  tuningHeadline: null,
  crash: null,
  diagnosticsCaptured: false,
};

describe("compy_lab_bento flag-off byte-identity (the classic failsafe)", () => {
  it("flag absent renders the bento (default ON — owner approval 2026-07-06)", () => {
    const absent = renderLab();
    expect(absent.querySelector(".lab-bento")).not.toBeNull();
  });

  it("flag='0': zero bento DOM in either guided mode", () => {
    for (const guided of ["0", "1"]) {
      cleanup();
      localStorage.clear();
      localStorage.setItem("compy_lab_guided", guided);
      localStorage.setItem("compy_lab_bento", "0");
      const c = renderLab();
      expect(c.querySelector(".lab-bento")).toBeNull();
      expect(c.querySelector("[data-bento]")).toBeNull();
    }
  });
});

const renderBento = () => {
  localStorage.setItem("compy_lab_bento", "1");
  return renderLab();
};

describe("bento face (flag on)", () => {
  it("cards run left→right in the bench order, numbered over the stations this rig has", () => {
    const c = renderBento();
    const names = Array.from(c.querySelectorAll(".lab-bento-name")).map((n) => n.textContent);
    expect(names).toEqual(["Diagnostics", "Benchmark", "Latency", "Tuning", "Black Box"]);
    const nums = Array.from(c.querySelectorAll(".lab-bento-n")).map((n) => n.textContent);
    expect(nums).toEqual(["01", "02", "03", "04", "05"]);
  });

  it("subsumes the router and welcome band; the readings strip yields to the report", () => {
    localStorage.setItem("compy_lab_guided", "1"); // even with guided on, bento leads
    const c = renderBento();
    expect(c.querySelector(".lab-router")).toBeNull();
    expect(c.querySelector(".lab-welcome")).toBeNull();
    expect(c.querySelector(".lab-readings")).toBeNull();
    expect(c.querySelector(".lab-bento-grid")).not.toBeNull();
  });

  it("no standing station list below — the grid IS the menu (owner feedback: no duplicate clutter)", () => {
    const c = renderBento();
    expect(c.querySelector(".lab-station-lines")).toBeNull();
    expect(c.querySelector(".lab-card")).toBeNull(); // no accordion cards until a door is opened
    expect(c.querySelector(".lab-bento-detail")).toBeNull(); // and no detail before a click
  });

  it("with nothing measured, card states are an honest 'Not yet' — never a placeholder", () => {
    const c = renderBento(); // invoke mock resolves null; only diagnostics is captured (fixture)
    const states = Array.from(c.querySelectorAll(".lab-bento-state")).map((s) => s.textContent);
    expect(states).toEqual(["Measured", "Not yet", "Not yet", "Not yet", "Not yet"]);
    // Honest readings live in the report (one place on the face — one-mention law: the card
    // carries the status chip only, so the same sentence never renders twice in the grid+report).
    expect(c.querySelector(".lab-bento-reading")).toBeNull();
    const readings = Array.from(c.querySelectorAll(".lab-bento-line-reading")).map(
      (r) => r.textContent!,
    );
    expect(readings.filter((r) => r.startsWith("No reading yet"))).toHaveLength(4);
  });

  it("clicking a card opens exactly ONE detail panel; click again closes; another swaps", () => {
    const c = renderBento();
    const doorFor = (name: string) =>
      Array.from(c.querySelectorAll<HTMLButtonElement>(".lab-bento-door")).find((d) =>
        d.textContent!.includes(name),
      )!;
    fireEvent.click(doorFor("Benchmark"));
    let details = c.querySelectorAll(".lab-bento-detail");
    expect(details).toHaveLength(1);
    expect(details[0].getAttribute("data-instrument")).toBe("Benchmark");
    expect(doorFor("Benchmark").getAttribute("aria-pressed")).toBe("true");
    // Swap to Latency — still exactly one panel.
    fireEvent.click(doorFor("Latency"));
    details = c.querySelectorAll(".lab-bento-detail");
    expect(details).toHaveLength(1);
    expect(details[0].getAttribute("data-instrument")).toBe("Latency");
    // Toggle closed.
    fireEvent.click(doorFor("Latency"));
    expect(c.querySelector(".lab-bento-detail")).toBeNull();
  });

  it("the vendor purple never paints — glow is the computed theme accent (or the neutral fallback)", () => {
    const c = renderBento();
    expect(c.innerHTML).not.toContain("132, 0, 255");
  });

  it("every card carries its lab note (the discover-something layer)", () => {
    const c = renderBento();
    const notes = Array.from(c.querySelectorAll(".lab-bento-note")).map((n) => n.textContent);
    expect(notes).toEqual(LAB_STATION_ORDER.map((k) => LAB_NOTES[k]));
  });
});

describe("checkup report (the annotated summary)", () => {
  it("names honest coverage and the first unread station as the ONE next step", () => {
    const c = renderBento(); // diagnostics captured → 1 of 5
    expect(c.querySelector(".lab-bento-report-headline")!.textContent).toBe(
      "Checkup in progress — 1 of 5 stations have readings.",
    );
    expect(c.querySelector(".lab-bento-next")!.textContent).toContain(
      "Next: station 2 — Benchmark.",
    );
    expect(c.querySelectorAll(".lab-bento-report-line")).toHaveLength(5);
  });

  it("zero readings = an honest, welcoming not-started state", () => {
    localStorage.setItem("compy_lab_bento", "1");
    const c = render(<Lab v2 vendor="nvidia" />).container; // 3 stations, nothing measured
    expect(c.querySelector(".lab-bento-report-headline")!.textContent).toBe(
      "Your checkup hasn't started yet.",
    );
    expect(c.querySelector(".lab-bento-next")!.textContent).toContain(
      "Next: station 1 — Benchmark.",
    );
  });
});

describe("pure data (one source, no drift)", () => {
  it("card readings ARE stationReading()'s output — the card can never disagree with the station", () => {
    const cards = labBentoCards(LAB_STATION_ORDER, NO_FACTS);
    for (const c of cards) {
      expect(c.reading).toBe(stationReading(c.key, NO_FACTS));
      expect(c.forLine).toBe(LAB_STATIONS[c.key].forLine);
    }
  });

  it("stationHasReading mirrors the reading branches (baseline counts as measured state)", () => {
    expect(LAB_STATION_ORDER.map((k) => stationHasReading(k, NO_FACTS))).toEqual(
      Array(5).fill(false),
    );
    expect(
      stationHasReading("benchmark", {
        ...NO_FACTS,
        bench: { baseline: {}, baseline_at: null, efficacy: null } as never,
      }),
    ).toBe(true);
    expect(stationHasReading("diagnostics", { ...NO_FACTS, diagnosticsCaptured: true })).toBe(
      true,
    );
  });

  it("full coverage → complete headline, no next step", () => {
    const full: LabStationFacts = {
      bench: { baseline: {}, baseline_at: null, efficacy: { overall: "improved" } } as never,
      latency: { msi: { msi_on: 2, msi_off: 1 }, timer_current_ms: 1 } as never,
      tuningHeadline: "held",
      crash: { incidents: [] } as never,
      diagnosticsCaptured: true,
    };
    const report = labCheckup(labBentoCards(LAB_STATION_ORDER, full));
    expect(report.headline).toBe("Full checkup complete — every station has a reading.");
    expect(report.next).toBeNull();
  });

  it("every station has a non-empty lab note", () => {
    for (const k of LAB_STATION_ORDER) {
      expect(LAB_NOTES[k].length).toBeGreaterThan(40);
    }
  });
});
