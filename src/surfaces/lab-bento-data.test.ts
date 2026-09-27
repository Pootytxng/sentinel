import { describe, it, expect } from "vitest";
import type { TFunction } from "i18next";
import { stationHasReading, labNotes, labBentoCards, labCheckup } from "./lab-bento-data";
import { LAB_STATION_ORDER, type LabStationFacts, type LabStationKey } from "./lab-guided-data";
import type { BenchmarkState, BlackBoxReport, LatencyReport, RunReport, Efficacy } from "../types";

// Key-echo stub: assertions pin i18n keys + interpolation args, never English copy.
const t = ((k: string, o?: Record<string, unknown>) =>
  o ? `${k}:${JSON.stringify(o)}` : k) as unknown as TFunction;

const run: RunReport = { components: [], confidence: "clean", notes: [] };
const efficacy = (overall: Efficacy["overall"]): Efficacy => ({ per_component: [], overall, noise_floor_pct: 2 });
const bench = (p: Partial<BenchmarkState>): BenchmarkState => ({
  running: false,
  latest: null,
  latest_at: null,
  baseline: null,
  baseline_at: null,
  efficacy: null,
  error: null,
  ...p,
});
const latency = (timer_current_ms: number | null): LatencyReport => ({
  msi_devices: [],
  msi: { total: 3, msi_on: 2, msi_off: 1 },
  msi_active: { active_on: 0, active_off: 0, unknown: 0, advertised_but_inactive: 0 },
  msi_advisory: null,
  line_irq_receipts: [],
  timer: null,
  timer_current_ms,
  cpu: null,
  cpu_affinity_advisory: null,
  usb: [],
  usb_advisory: null,
});
const crash = (n: number): BlackBoxReport =>
  ({ incidents: Array.from({ length: n }, (_, i) => ({ incident_id: `i${i}` })), skipped_sources: [] }) as unknown as BlackBoxReport;

const unread = (p: Partial<LabStationFacts> = {}): LabStationFacts => ({
  bench: null,
  latency: null,
  tuningHeadline: null,
  crash: null,
  diagnosticsCaptured: false,
  safeReady: 0,
  stackApplied: false,
  stackedCount: 0,
  ...p,
});

const allRead = (): LabStationFacts =>
  unread({
    bench: bench({ efficacy: efficacy("improved") }),
    latency: latency(0.5),
    tuningHeadline: "tuning-headline",
    crash: crash(0),
    diagnosticsCaptured: true,
    stackApplied: true,
  });

describe("stationHasReading", () => {
  it("is false for every station when nothing has been read", () => {
    const keys: LabStationKey[] = ["optimize", ...LAB_STATION_ORDER];
    for (const k of keys) expect(stationHasReading(k, unread())).toBe(false);
  });

  it("is true for every station when all facts are present", () => {
    const keys: LabStationKey[] = ["optimize", ...LAB_STATION_ORDER];
    for (const k of keys) expect(stationHasReading(k, allRead())).toBe(true);
  });

  it("counts a benchmark baseline alone as a reading, but not an empty bench state", () => {
    expect(stationHasReading("benchmark", unread({ bench: bench({ baseline: run }) }))).toBe(true);
    expect(stationHasReading("benchmark", unread({ bench: bench({}) }))).toBe(false);
  });

  it("treats a clean Black Box scan (zero incidents) and an empty-string tuning headline as reads", () => {
    expect(stationHasReading("blackbox", unread({ crash: crash(0) }))).toBe(true);
    expect(stationHasReading("tuning", unread({ tuningHeadline: "" }))).toBe(true);
  });

  it("optimize follows stackApplied, independent of safeReady", () => {
    expect(stationHasReading("optimize", unread({ safeReady: 3, stackApplied: false }))).toBe(false);
    expect(stationHasReading("optimize", unread({ stackApplied: true }))).toBe(true);
  });
});

describe("labNotes", () => {
  it("returns one note key per station, exhaustively", () => {
    const notes = labNotes(t);
    expect(Object.keys(notes).sort()).toEqual(
      ["benchmark", "blackbox", "diagnostics", "latency", "optimize", "tuning"],
    );
    for (const [k, v] of Object.entries(notes)) expect(v).toBe(`lab.labBento.notes.${k}`);
  });
});

describe("labBentoCards", () => {
  it("numbers cards 1-based over the passed keys, in order", () => {
    const cards = labBentoCards(["latency", "blackbox"], unread(), t);
    expect(cards.map((c) => [c.key, c.n])).toEqual([
      ["latency", 1],
      ["blackbox", 2],
    ]);
  });

  it("wires name/forLine/note from the station tables and reading from stationReading", () => {
    const [card] = labBentoCards(["latency"], unread({ latency: latency(0.5) }), t);
    expect(card.name).toBe("lab.stations.latency.name");
    expect(card.forLine).toBe("lab.stations.latency.forLine");
    expect(card.note).toBe("lab.labBento.notes.latency");
    expect(card.reading).toBe(
      `lab.stations.reading.latencyWithTimer:${JSON.stringify({ on: 2, off: 1, ms: "0.50" })}`,
    );
    expect(card.hasReading).toBe(true);
  });

  it("returns an empty list for no keys", () => {
    expect(labBentoCards([], allRead(), t)).toEqual([]);
  });
});

describe("labCheckup", () => {
  it("not-started: no station read, next points at station 1", () => {
    const cards = labBentoCards(LAB_STATION_ORDER, unread(), t);
    const r = labCheckup(cards, t);
    expect(r.headline).toBe("lab.labBento.checkup.notStarted.headline");
    expect(r.sub).toBe("lab.labBento.checkup.notStarted.sub");
    expect(r.next).toBe(
      `lab.labBento.checkup.next:${JSON.stringify({
        n: 1,
        name: "lab.stations.diagnostics.name",
        forLine: "lab.stations.diagnostics.forLine",
      })}`,
    );
    expect(r.lines).toHaveLength(5);
    expect(r.lines.every((l) => !l.hasReading)).toBe(true);
  });

  it("in-progress: interpolates read/total and points next at the FIRST unread in order", () => {
    const f = unread({ diagnosticsCaptured: true, crash: crash(2) });
    const r = labCheckup(labBentoCards(LAB_STATION_ORDER, f, t), t);
    expect(r.headline).toBe(
      `lab.labBento.checkup.inProgress.headline:${JSON.stringify({ read: 2, total: 5 })}`,
    );
    expect(r.sub).toBe("lab.labBento.checkup.inProgress.sub");
    expect(r.next).toContain('"n":2');
    expect(r.next).toContain("lab.stations.benchmark.name");
    const bb = r.lines.find((l) => l.key === "blackbox")!;
    expect(bb.reading).toBe(`lab.stations.reading.blackboxIncidents:${JSON.stringify({ count: 2 })}`);
  });

  it("complete: every station read, next is null, lines mirror the cards", () => {
    const cards = labBentoCards(LAB_STATION_ORDER, allRead(), t);
    const r = labCheckup(cards, t);
    expect(r.headline).toBe("lab.labBento.checkup.complete.headline");
    expect(r.sub).toBe("lab.labBento.checkup.complete.sub");
    expect(r.next).toBeNull();
    expect(r.lines).toEqual(
      cards.map((c) => ({ key: c.key, name: c.name, reading: c.reading, hasReading: c.hasReading })),
    );
  });

  it("empty card list reads as not-started with no next step", () => {
    const r = labCheckup([], t);
    expect(r.headline).toBe("lab.labBento.checkup.notStarted.headline");
    expect(r.next).toBeNull();
    expect(r.lines).toEqual([]);
  });
});
