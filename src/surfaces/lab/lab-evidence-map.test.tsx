// RIG EVIDENCE MAP guards — the Lab hologram's functional purpose (owner verdict, 2026-07-29).
//
// The owner's line was "the Lab hologram must have a unique functional purpose", and the shape he
// named was a map: whatever you selected — a recommendation, a symptom, an instrument — highlights
// the part of YOUR machine it touches and states what that part reads. Home keeps overall rig
// identity; the Lab owns per-decision evidence.
//
// Which makes the whole thing a claim about the user's hardware, so these guards are honesty
// guards first and behaviour guards second:
//
//   Guard 1  MAPPING IS DECIDED, NEVER GUESSED. Every id the Rust catalog can emit has a
//            deliberate placement, no placement names a rec that no longer exists, and anything
//            unknown or ambiguous stays system-wide instead of pointing at a part.
//   Guard 2  THE FOCUS CONTRACT HOLDS. Every part kind the map can ask for is a kind
//            `buildRigParts` really produces — a kind the rig model can't make would highlight
//            nothing, silently.
//   Guard 3  NO FABRICATED READING. Every value comes from a real HardwareInfo field; missing,
//            zero or blank produces no reading at all, and the subsystems with no snapshot data
//            stay empty on purpose.
//   Guard 4  SELECTION REALLY MOVES THE MAP, and the map stays a map: no snapshot → no map, no
//            second hologram, and not one button inside it (no second router, no duplicate
//            instrument, no hidden mutation path).
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — @types/node is not a project dependency.)

import type { HardwareInfo } from "../../App";
import type { LabStationKey } from "../lab-guided-data";
import { buildRigParts, type RigPartKind } from "../rig/rig-parts";
import {
  explicitSubsystem,
  rigKindForSubsystem,
  subsystemForStation,
  subsystemOf,
  type LabSubsystem,
} from "./lab-deck-data";
import { subsystemReadings } from "./lab-evidence-map";

// The hologram is stubbed to REPORT what the host pointed it at. The real RigViewer is a three.js
// canvas jsdom can't draw, but `focusKind` is the whole contract between the deck and the asset —
// capturing it here proves selection reaches the model without pretending to render WebGL.
vi.mock("../rig/RigViewer", () => ({
  RigViewer: (p: { focusKind?: string | null; chromeless?: boolean }) => (
    <div
      data-testid="rig-hologram"
      data-focus={p.focusKind ?? "none"}
      data-chromeless={p.chromeless ? "yes" : "no"}
    />
  ),
}));
// Tuning's instrument reads a session list, so the probe answers with a real empty array rather
// than null. Nothing here reaches a mutation — the map adds no apply path and must never prove one.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) =>
    Promise.resolve(cmd === "get_session_summaries" ? [] : null),
  ),
}));

class IOStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", IOStub);

const { LabDeck } = await import("./LabDeck");
const { ConfirmProvider } = await import("../../design/ConfirmDialog");

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("compy_motion", "reduced");
});

// ───────────────────────────── fixtures ─────────────────────────────

// The dev rig, in the shape the probe really returns (cast — HardwareInfo is much larger). Every
// number below is the number the assertions expect to see on screen; nothing is rounded for looks.
const RAW = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  memory_modules: [
    { capacity_bytes: 16 * 1024 ** 3, speed_mhz: 6000, type_name: "DDR5", manufacturer: "G.Skill" },
    { capacity_bytes: 16 * 1024 ** 3, speed_mhz: 6000, type_name: "DDR5", manufacturer: "G.Skill" },
  ],
  gpus: [
    {
      name: "AMD Radeon RX 9070 XT",
      vram_bytes: 16 * 1024 ** 3,
      driver_version: "25.5.1",
      driver_date: "",
      driver_age_days: 20,
      video_processor: "AMD Radeon Graphics Processor",
      current_refresh_rate_hz: 165,
    },
  ],
  physical_disks: [
    {
      friendly_name: "Samsung SSD 990 PRO 2TB",
      media_type: "SSD",
      bus_type: "NVMe",
      size_bytes: 2 * 1024 ** 4,
    },
  ],
  // D: first ON PURPOSE — the storage reading must be about Windows' system drive, not whichever
  // volume the probe happened to list first.
  disks: [
    {
      mount_point: "D:\\",
      total_bytes: 4 * 1024 ** 4,
      available_bytes: 1024 ** 4,
      file_system: "NTFS",
    },
    {
      mount_point: "C:\\",
      total_bytes: 2 * 1024 ** 4,
      available_bytes: 512 * 1024 ** 3,
      file_system: "NTFS",
    },
  ],
  display: { width: 2560, height: 1440, current_refresh_rate_hz: 144, max_refresh_rate_hz: 165 },
  windows_version: { product_name: "Windows 11 Pro", build: "26200", ubr: "1" },
  os_name: "Windows",
  os_version: "11",
  kernel_version: "10.0.26200",
  hostname: "DESKTOP-X",
};

// Kept RAW (untyped) as well as cast, so the variants below can blank a field the real type
// declares non-null — a probe that read nothing is exactly the case these guards care about.
const HW = RAW as unknown as HardwareInfo;
const withHw = (over: Record<string, unknown>) => ({ ...RAW, ...over }) as unknown as HardwareInfo;

const ALL_SUBSYSTEMS: LabSubsystem[] = [
  "cpu",
  "gpu",
  "memory",
  "storage",
  "display",
  "network",
  "audio",
  "thermals",
  "system",
];

const rec = (over: Record<string, unknown> = {}) =>
  ({
    id: "power-ultimate",
    title: "Ultimate Performance power plan",
    category: "Power",
    severity: "safe",
    description: "Windows' hidden power plan, which stops the CPU idling between frames.",
    impact: "Switches the active power plan.",
    downside: null,
    applies_to: "Currently Balanced",
    currently_applied: false,
    provenance: "verified",
    eligible: true,
    ...over,
  }) as never;

const GPU_REC = rec({
  id: "gpu-prefer-discrete",
  title: "Prefer the discrete GPU",
  category: "GPU",
  applies_to: "Currently auto",
});

// A subject whose readings are GAUGES rather than facts — the CPU's are both plain facts, so a
// bar-shaped assertion needs a rec that really points at a filled/total pair.
const STORAGE_REC = rec({
  id: "storage-c-low",
  title: "Free up room on the system drive",
  category: "Storage",
  applies_to: "512 GB free",
});

// ─────────────── guard 1: the mapping is decided, never guessed ───────────────

// Same lexical read as the goal guard next door: this must fail when someone adds a tweak to
// recommendations.rs without deciding which part of the machine it touches.
function rustCatalog(): { id: string; category: string }[] {
  const src = readFileSync(join("src-tauri", "src", "recommendations.rs"), "utf8");
  const out: { id: string; category: string }[] = [];
  let pending: string | null = null;
  for (const line of src.split("\n")) {
    if (/^\s*\/\//.test(line)) continue;
    const id = line.match(/^\s*id:\s*"([a-z0-9-]+)"/);
    if (id) {
      pending = id[1];
      continue;
    }
    const cat = line.match(/^\s*category:\s*"([A-Za-z ]+)"/);
    if (cat && pending) {
      out.push({ id: pending, category: cat[1] });
      pending = null;
    }
  }
  return out;
}

// The other direction: the ids the table CLAIMS. Read from the source because the table itself is
// deliberately private — nothing but this guard has a reason to enumerate it.
function mappedIds(): string[] {
  const src = readFileSync(join("src", "surfaces", "lab", "lab-deck-data.ts"), "utf8");
  const block = src.match(
    /const SUBSYSTEM_BY_REC_ID: Record<string, LabSubsystem> = \{([\s\S]*?)\n\};/,
  );
  expect(block).not.toBeNull();
  return [...block![1].matchAll(/^\s*"([a-z0-9-]+)":/gm)].map((m) => m[1]);
}

describe("guard 1 — every recommendation's subsystem is a decision on the record", () => {
  const catalog = rustCatalog();

  it("reads the real catalog (wired to the Rust source, not a fixture)", () => {
    expect(catalog.length).toBeGreaterThanOrEqual(13);
    expect(catalog.map((c) => c.id)).toContain("power-ultimate");
  });

  it("every catalog id is placed DELIBERATELY — a new tweak must be decided, not defaulted", () => {
    const unplaced = catalog.filter((c) => explicitSubsystem(c.id) === null).map((c) => c.id);
    expect(unplaced).toEqual([]);
  });

  it("no placement names a recommendation that no longer exists", () => {
    const live = new Set(catalog.map((c) => c.id));
    expect(mappedIds().filter((id) => !live.has(id))).toEqual([]);
  });

  it("no shipping recommendation reaches its part through the category fallback", () => {
    // The fallback exists for rules newer than this frontend, not as a shortcut for the catalog we
    // ship: for every id we ship, the explicit decision IS the answer.
    for (const c of catalog) expect(subsystemOf(c)).toBe(explicitSubsystem(c.id));
  });

  it("the placements the user can check by eye are the right ones", () => {
    expect(subsystemOf({ id: "power-ultimate", category: "Power" })).toBe("cpu");
    expect(subsystemOf({ id: "hags-enable", category: "GPU" })).toBe("gpu");
    expect(subsystemOf({ id: "monitor-max-refresh", category: "Display" })).toBe("display");
    expect(subsystemOf({ id: "storage-c-low", category: "Storage" })).toBe("storage");
    // Category says Windows, but SysMain is a disk-prefetch service — the id wins.
    expect(subsystemOf({ id: "sysmain-disable", category: "Windows" })).toBe("storage");
    // Category says Power, but hybrid shutdown changes how Windows boots, not what the CPU does.
    expect(subsystemOf({ id: "fast-startup-off", category: "Power" })).toBe("system");
  });

  it("an unknown recommendation stays system-wide — it never guesses a part", () => {
    // A signed remote rule, or a tweak from a newer build than this frontend.
    expect(subsystemOf({ id: "not-in-any-map", category: "Something New" })).toBe("system");
    expect(explicitSubsystem("not-in-any-map")).toBeNull();
  });

  it("only the categories that can answer honestly have a fallback", () => {
    expect(subsystemOf({ id: "unknown-1", category: "GPU" })).toBe("gpu");
    expect(subsystemOf({ id: "unknown-2", category: "Display" })).toBe("display");
    expect(subsystemOf({ id: "unknown-3", category: "Storage" })).toBe("storage");
    // Power and Windows hold recs that touch different components, so the category alone is not
    // evidence — an unknown rec in either stays system-wide.
    expect(subsystemOf({ id: "unknown-4", category: "Power" })).toBe("system");
    expect(subsystemOf({ id: "unknown-5", category: "Windows" })).toBe("system");
  });

  it("every instrument has a placement, and only Tuning claims a component", () => {
    const stations: LabStationKey[] = [
      "optimize",
      "diagnostics",
      "benchmark",
      "latency",
      "tuning",
      "blackbox",
    ];
    // An instrument measures the whole pipeline; pointing Benchmark at one part would be a claim
    // about causation that nothing measured. Tuning is the exception because the AMD tuning guide
    // IS about the graphics card.
    expect(subsystemForStation("tuning")).toBe("gpu");
    for (const key of stations.filter((k) => k !== "tuning")) {
      expect(subsystemForStation(key)).toBe("system");
    }
  });
});

// ─────────────── guard 2: the focus contract holds ───────────────

describe("guard 2 — the map can only ask the rig model for parts it really builds", () => {
  const kinds = new Set<RigPartKind>(buildRigParts(HW).map((p) => p.kind));

  it("every part kind the map asks for is a kind buildRigParts produces", () => {
    for (const sub of ALL_SUBSYSTEMS) {
      const kind = rigKindForSubsystem(sub);
      if (kind !== null) expect(kinds.has(kind)).toBe(true);
    }
  });

  it("the subsystems with no modelled part highlight NOTHING rather than the nearest thing", () => {
    // Display, network and audio are real subsystems with no part in the rig model, and `system` is
    // system-wide by definition. Each returns null so the hologram keeps its hands off.
    expect(rigKindForSubsystem("display")).toBeNull();
    expect(rigKindForSubsystem("network")).toBeNull();
    expect(rigKindForSubsystem("audio")).toBeNull();
    expect(rigKindForSubsystem("system")).toBeNull();
  });

  it("the ones that DO have a part point at the right one", () => {
    expect(rigKindForSubsystem("cpu")).toBe("cpu");
    expect(rigKindForSubsystem("gpu")).toBe("gpu");
    expect(rigKindForSubsystem("memory")).toBe("ram");
    expect(rigKindForSubsystem("storage")).toBe("storage");
    expect(rigKindForSubsystem("thermals")).toBe("cooler");
  });
});

// ─────────────── guard 3: no fabricated reading ───────────────

const keys = (sub: LabSubsystem, hw: HardwareInfo = HW) =>
  subsystemReadings(sub, hw).map((r) => r.key);

describe("guard 3 — every reading is a real field of this PC, or there is no reading", () => {
  it("the processor states its real cores/threads and clock", () => {
    expect(subsystemReadings("cpu", HW)).toEqual([
      { kind: "fact", key: "cores", value: "8 · 16" },
      { kind: "fact", key: "clock", value: "5.10 GHz" },
    ]);
  });

  it("a probe that reported no cores or no clock says nothing about them", () => {
    expect(keys("cpu", withHw({ cpu_cores_physical: 0 }))).toEqual(["clock"]);
    expect(keys("cpu", withHw({ cpu_cores_logical: 0 }))).toEqual(["clock"]);
    // fmtGHz(0) renders an em dash — a dash dressed up as data is exactly what rail 2 bars.
    expect(keys("cpu", withHw({ cpu_frequency_mhz: 0 }))).toEqual(["cores"]);
    expect(
      subsystemReadings("cpu", withHw({ cpu_cores_physical: 0, cpu_frequency_mhz: 0 })),
    ).toEqual([]);
  });

  it("the graphics card states its real VRAM and driver", () => {
    expect(subsystemReadings("gpu", HW)).toEqual([
      { kind: "fact", key: "vram", value: "16.0 GB" },
      { kind: "fact", key: "driver", value: "25.5.1" },
    ]);
  });

  it("no GPU detected → no GPU readings (never a placeholder card)", () => {
    expect(subsystemReadings("gpu", withHw({ gpus: [] }))).toEqual([]);
  });

  it("a blank driver string or zero VRAM drops that line only", () => {
    const noDriver = withHw({ gpus: [{ ...RAW.gpus[0], driver_version: "   " }] });
    expect(keys("gpu", noDriver)).toEqual(["vram"]);
    const noVram = withHw({ gpus: [{ ...RAW.gpus[0], vram_bytes: 0 }] });
    expect(keys("gpu", noVram)).toEqual(["driver"]);
  });

  it("memory is in-use of installed, as a real ratio", () => {
    expect(subsystemReadings("memory", HW)).toEqual([
      { kind: "gauge", key: "memory", value: "16.0 GB", den: "32.0 GB", pct: 0.5 },
    ]);
  });

  it("no installed total → no memory gauge (a bar over zero is a lie)", () => {
    expect(subsystemReadings("memory", withHw({ ram_total_bytes: 0 }))).toEqual([]);
  });

  it("storage reads the SYSTEM drive's free space, not whichever volume came first", () => {
    expect(subsystemReadings("storage", HW)).toEqual([
      { kind: "gauge", key: "storage", value: "512.0 GB", den: "2048.0 GB", pct: 0.25 },
    ]);
  });

  it("no C: volume → the first reported one, and no volumes at all → nothing", () => {
    const dOnly = withHw({ disks: [RAW.disks[0]] });
    expect(subsystemReadings("storage", dOnly)).toEqual([
      { kind: "gauge", key: "storage", value: "1024.0 GB", den: "4096.0 GB", pct: 0.25 },
    ]);
    expect(subsystemReadings("storage", withHw({ disks: [] }))).toEqual([]);
    expect(
      subsystemReadings("storage", withHw({ disks: [{ ...RAW.disks[1], total_bytes: 0 }] })),
    ).toEqual([]);
  });

  it("the display states current against max refresh", () => {
    expect(subsystemReadings("display", HW)).toEqual([
      { kind: "gauge", key: "refresh", value: "144 Hz", den: "165 Hz", pct: 144 / 165 },
    ]);
  });

  it("no display, or a refresh rate Windows didn't report, states nothing", () => {
    expect(subsystemReadings("display", withHw({ display: null }))).toEqual([]);
    expect(
      subsystemReadings("display", withHw({ display: { ...RAW.display, max_refresh_rate_hz: 0 } })),
    ).toEqual([]);
    expect(
      subsystemReadings(
        "display",
        withHw({ display: { ...RAW.display, current_refresh_rate_hz: 0 } }),
      ),
    ).toEqual([]);
  });

  it("cooling, network, sound and system-wide are empty ON PURPOSE, not by omission", () => {
    // Cooling: Compy ships no driver, so it has no temperature of its own to state (LOCKED rule 1).
    // Network: nothing in the catalog routes there. Sound: the snapshot carries no audio state.
    // System: no single part, no single number.
    for (const sub of ["thermals", "network", "audio", "system"] as LabSubsystem[]) {
      expect(subsystemReadings(sub, HW)).toEqual([]);
    }
  });

  it("no reading anywhere is a dash, a placeholder or an unformatted zero", () => {
    const values = ALL_SUBSYSTEMS.flatMap((s) => subsystemReadings(s, HW)).flatMap((r) =>
      r.kind === "gauge" ? [r.value, r.den] : [r.value],
    );
    expect(values.length).toBeGreaterThan(0);
    for (const v of values) {
      expect(v.trim()).not.toBe("");
      expect(v).not.toContain("—");
      expect(v).not.toMatch(/^(0|0\.0|N\/A|--|\?+)( |$)/);
    }
  });

  it("every proportion is a real clamped ratio, never a number that overflows its bar", () => {
    const over = withHw({ ram_used_bytes: 64 * 1024 ** 3 }); // more used than installed
    const [g] = subsystemReadings("memory", over);
    expect(g.kind).toBe("gauge");
    expect(g.kind === "gauge" && g.pct).toBe(1);
    for (const sub of ALL_SUBSYSTEMS) {
      for (const r of subsystemReadings(sub, HW)) {
        if (r.kind !== "gauge") continue;
        expect(r.pct).toBeGreaterThanOrEqual(0);
        expect(r.pct).toBeLessThanOrEqual(1);
      }
    }
  });

  it("no subsystem invents a grade, verdict or threshold word", () => {
    // No audited threshold in this app applies to these fields (tuning-measure.ts owns the only
    // ones), so a reading is stated, not scored.
    const shapes = ALL_SUBSYSTEMS.flatMap((s) => subsystemReadings(s, HW)).map((r) =>
      Object.keys(r).sort().join(","),
    );
    for (const shape of shapes) {
      expect(["key,kind,value", "den,key,kind,pct,value"]).toContain(shape);
    }
  });
});

// ─────────────── guard 4: selection moves the map, and it stays a map ───────────────

type DeckOpts = { recs?: never[] | null; hw?: HardwareInfo | null };

// ASYNC ON PURPOSE. The deck loads the real RigViewer through a module-scope `React.lazy`, so the
// first mount in this file returns the `.ld-map-wait` fallback and only resolves a microtask later.
// Awaiting the flush here makes every test see the settled map — otherwise whichever test happened
// to mount first would be the only one missing a hologram, which is a test-order trap, not a guard.
const renderDeck = async (opts: DeckOpts = {}) => {
  const fast = {
    recs: opts.recs === undefined ? [rec()] : opts.recs,
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
  } as never;
  let container!: HTMLElement;
  await act(async () => {
    container = render(
      <ConfirmProvider>
        <LabDeck
          fast={fast}
          diagnostics={<div data-testid="diag" />}
          diagnosticsCaptured
          priorities={null}
          activeCount={0}
          hw={opts.hw === undefined ? HW : opts.hw}
        />
      </ConfirmProvider>,
    ).container;
  });
  return container;
};

const text = (el: Element | null) => el?.textContent ?? "";
const door = (c: HTMLElement, id: string) =>
  c.querySelector<HTMLButtonElement>(`[aria-controls="${id}-body"]`);
const focus = (c: HTMLElement) =>
  c.querySelector<HTMLElement>('[data-testid="rig-hologram"]')?.dataset.focus ?? null;

describe("guard 4 — the map answers to the selection, and never becomes a second Lab", () => {
  it("no hardware snapshot → NO map at all (never a hologram of a PC we haven't read)", async () => {
    const c = await renderDeck({ hw: null });
    expect(c.querySelector(".ld-map")).toBeNull();
    expect(c.querySelector('[data-testid="rig-hologram"]')).toBeNull();
    // …and the deck itself is unharmed: several guards mount it without hardware.
    expect(c.querySelector(".ld-move")).not.toBeNull();
  });

  it("with a snapshot: exactly ONE map, ONE hologram, and it is the real chromeless asset", async () => {
    const c = await renderDeck();
    expect(c.querySelectorAll(".ld-map").length).toBe(1);
    const holo = c.querySelectorAll('[data-testid="rig-hologram"]');
    expect(holo.length).toBe(1); // no decorative duplicate
    expect((holo[0] as HTMLElement).dataset.chromeless).toBe("yes");
  });

  it("at rest it maps the NEXT MOVE — named part, real readings, no 'for' clause", async () => {
    const c = await renderDeck(); // power-ultimate → the processor
    expect(text(c.querySelector(".ld-map-part-name"))).toBe("Touches your processor");
    expect(focus(c)).toBe("cpu");
    // Nothing was selected yet, so there is nothing to say it's "for".
    expect(c.querySelector(".ld-map-for")).toBeNull();
    const readings = Array.from(c.querySelectorAll(".ld-map-item")).map((n) => text(n));
    expect(readings.some((s) => s.includes("8 · 16"))).toBe(true);
    expect(readings.some((s) => s.includes("5.10 GHz"))).toBe(true);
    expect(text(c.querySelector(".ld-map-src"))).toBe("Read from this PC.");
  });

  it("opening an instrument re-points the map at what THAT measures, and names it", async () => {
    const c = await renderDeck();
    fireEvent.click(door(c, "ld-prove-tuning")!);
    // Tuning is the AMD graphics guide — the one instrument that honestly claims a component.
    expect(text(c.querySelector(".ld-map-part-name"))).toBe("Touches your graphics card");
    expect(text(c.querySelector(".ld-map-for"))).toContain("Tuning");
    expect(focus(c)).toBe("gpu");
    const readings = Array.from(c.querySelectorAll(".ld-map-item")).map((n) => text(n));
    expect(readings.some((s) => s.includes("16.0 GB"))).toBe(true);
    expect(readings.some((s) => s.includes("25.5.1"))).toBe(true);
    // Closing it returns the map to the next move rather than stranding the old selection.
    fireEvent.click(door(c, "ld-prove-tuning")!);
    expect(text(c.querySelector(".ld-map-part-name"))).toBe("Touches your processor");
    expect(c.querySelector(".ld-map-for")).toBeNull();
  });

  it("an instrument that measures the whole pipeline says so instead of blaming a part", async () => {
    const c = await renderDeck();
    fireEvent.click(door(c, "ld-prove-benchmark")!);
    expect(text(c.querySelector(".ld-map-part-name"))).toBe(
      "Touches how Windows behaves, not one part",
    );
    expect(text(c.querySelector(".ld-map-for"))).toContain("Benchmark");
    expect(focus(c)).toBe("none"); // hands off the hologram's selection
  });

  it("opening a symptom re-points the map and names the symptom in the user's words", async () => {
    const c = await renderDeck();
    fireEvent.click(door(c, "ld-problem-stutter")!);
    expect(text(c.querySelector(".ld-map-for"))).toContain("The game hitches or stutters");
    expect(focus(c)).toBe("none");
    // "It runs hot or loud" routes to Tuning, which IS about the graphics card.
    fireEvent.click(door(c, "ld-problem-heat")!);
    expect(text(c.querySelector(".ld-map-part-name"))).toBe("Touches your graphics card");
    expect(text(c.querySelector(".ld-map-for"))).toContain("It runs hot or loud");
    expect(focus(c)).toBe("gpu");
  });

  it("the experiments row is named as itself, not as the Optimize station it shares a key with", async () => {
    const c = await renderDeck();
    fireEvent.click(door(c, "ld-prove-experiments")!);
    expect(text(c.querySelector(".ld-map-for"))).toContain("Experiments");
    expect(text(c.querySelector(".ld-map-for"))).not.toContain("Optimize");
  });

  it("a part this PC has no reading for says so, instead of showing an empty frame", async () => {
    const c = await renderDeck({ recs: [GPU_REC] as never, hw: withHw({ gpus: [] }) });
    expect(text(c.querySelector(".ld-map-part-name"))).toBe("Touches your graphics card");
    expect(c.querySelector(".ld-map-list")).toBeNull();
    expect(text(c.querySelector(".ld-map-src"))).toBe(
      "Compy has no reading for this part on this PC.",
    );
  });

  // GUARD (bug→guard, consumer panel 2026-07-29 — 4/5 seats). A system-wide subject lights no part of
  // the rig, which is correct and unfabricatable: `rigKindForSubsystem` returns null and inventing a
  // highlight would be inventing topology. But the map used to say NOTHING in that state (the "no
  // reading" line was suppressed for `system`), so an unlit hologram beside a caption conceding "not
  // one part" read to every seat as decoration that had failed. Absence must be DECLARED — as a typed
  // state on the element and as a sentence the user can read — never left as silence.
  it("a system-wide subject declares why nothing is lit, instead of showing an unlit rig in silence", async () => {
    // `fast-startup-off` is a Power rec the subsystem map places at `system` on purpose (guard 1).
    const c = await renderDeck({
      recs: [rec({ id: "fast-startup-off", title: "Turn off Fast Startup" })] as never,
    });
    expect(c.querySelector(".ld-map")?.getAttribute("data-focus")).toBe("whole");
    expect(focus(c)).toBe("none"); // hands off the hologram's selection — nothing is lit
    expect(text(c.querySelector(".ld-map-part-name"))).toBe(
      "Touches how Windows behaves, not one part",
    );
    // The sentence that turns the unlit rig from a failure into information.
    expect(text(c.querySelector(".ld-map-src"))).toContain("Nothing to single out");
    expect(text(c.querySelector(".ld-map-src"))).toContain("shown intact");
    // …and it must NOT borrow the per-part wording, which would claim a missing reading instead.
    expect(text(c.querySelector(".ld-map-src"))).not.toContain("no reading for this part");
  });

  it("a subject with a real part declares the part state, so the two are never confusable", async () => {
    const c = await renderDeck({ recs: [GPU_REC] as never });
    expect(c.querySelector(".ld-map")?.getAttribute("data-focus")).toBe("part");
    expect(focus(c)).toBe("gpu");
  });

  it("the map contains NOT ONE control — no second router, no duplicate instrument, no apply", async () => {
    const c = await renderDeck();
    const map = c.querySelector(".ld-map")!;
    expect(map.querySelectorAll("button, a, input, select, [role='button']").length).toBe(0);
    // …and the same holds in the state that draws the most: a gauge subject, bar and all.
    const g = await renderDeck({ recs: [STORAGE_REC] as never });
    const gmap = g.querySelector(".ld-map")!;
    expect(gmap.querySelectorAll("button, a, input, select, [role='button']").length).toBe(0);
    // Its bar is decoration over a number that is already stated in words, so it is hidden from
    // the screen reader rather than read out as an unlabelled graphic.
    expect(gmap.querySelector(".ld-map-bar")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("the readings it shows are not a second copy of the row readings", async () => {
    // Every visible number in the map is a hardware fact; the rows' readings are instrument state.
    // Overlap would be the duplicate-instrument smell the owner barred.
    const c = await renderDeck();
    const mapText = text(c.querySelector(".ld-map"));
    const rowReadings = Array.from(c.querySelectorAll(".ld-row-reading")).map((n) => text(n).trim());
    for (const r of rowReadings.filter((s) => s.length > 0)) {
      expect(mapText).not.toContain(r);
    }
  });
});
