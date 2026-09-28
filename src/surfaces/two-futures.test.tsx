import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { TwoFutures } from "./TwoFutures";
import { BenchmarkTab } from "./Benchmark";
import { hasMeasuredPair, partGlow } from "./two-futures-view";
import { readTwoFutures } from "../design/theme";
import type {
  BenchmarkState,
  CompyChangeFact,
  Efficacy,
  Fact,
  MachineModel,
  RunReport,
} from "../types";
import type { HardwareInfo } from "../App";
import type { BenchmarkAttribution } from "./benchmark-view";
import { invalidateProbe } from "../data/probe-cache";
import wire from "../test/fixtures/machine-model.wire.json";

// THE ANTI-FABRICATION GUARD (spec 2026-07-07-two-futures-measured-split, required in the same
// train as the feature): the split view renders NOTHING but the honest empty state unless a real
// measured pair exists — baseline + latest from DISTINCT runs with backend-computed efficacy —
// and when it does render, every number is a struct field (no literal fallbacks, tier-1
// source-grep below). One side measured + one side inferred must never paint.

vi.mock("./rig/TwoFuturesScene", () => ({
  default: () => <div data-testid="tf-scene" />,
}));

const NO_PAIR = {
  running: false,
  latest: null,
  latest_at: null,
  baseline: null,
  baseline_at: null,
  efficacy: null,
  error: null,
};

// Settable benchmark state so the BenchmarkTab wiring can be pinned both without and WITH a
// measured pair (the subsume guard below).
const mocks = vi.hoisted(() => ({ bench: null as unknown, model: null as unknown }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "get_benchmark_state") return Promise.resolve(mocks.bench ?? NO_PAIR);
    if (cmd === "get_applied_changes") return Promise.resolve([]);
    // The attribution reads the Machine Model (#452): a readable, empty ledger unless a test says otherwise.
    if (cmd === "get_machine_model") return Promise.resolve(mocks.model ?? modelWith([]));
    if (cmd === "get_recommendations") return Promise.resolve([]);
    if (cmd === "get_appliable_rec_ids") return Promise.resolve([]);
    if (cmd === "get_fps_status") return Promise.resolve({ active: false });
    if (cmd === "get_hardware_info") return Promise.resolve(hw);
    return Promise.resolve(null);
  },
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  mocks.bench = null;
  mocks.model = null;
  invalidateProbe();
});

const hw = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
  disks: [],
  memory_modules: [],
  physical_disks: [],
  os_name: "Windows",
  os_version: "11",
} as unknown as HardwareInfo;

const run = (scores: [number, number, number, number]): RunReport => ({
  components: [
    { component: "cpu", score: scores[0], measured: true },
    { component: "ram", score: scores[1], measured: true },
    { component: "gpu", score: scores[2], measured: true },
    { component: "disk", score: scores[3], measured: true },
  ],
  confidence: "clean",
  notes: [],
});

const efficacy: Efficacy = {
  per_component: [
    { component: "cpu", before: 62, after: 71, delta_pct: 14.5, verdict: "improved" },
    { component: "ram", before: 55, after: 53, delta_pct: -3.6, verdict: "regressed" },
    { component: "gpu", before: 80, after: 80, delta_pct: 0.2, verdict: "no-measurable-change" },
    { component: "disk", before: 47, after: 49, delta_pct: 4.3, verdict: "improved" },
  ],
  overall: "improved",
  noise_floor_pct: 3,
};

const pair: BenchmarkState = {
  running: false,
  latest: run([71, 53, 80, 49]),
  latest_at: "2026-07-07T18:30:00Z",
  baseline: run([62, 55, 80, 47]),
  baseline_at: "2026-07-01T10:00:00Z",
  efficacy,
  error: null,
};

describe("the one law — no measured pair → no split view, ever", () => {
  const empties: [string, BenchmarkState | null][] = [
    ["no state at all", null],
    ["baseline only", { ...pair, latest: null, latest_at: null, efficacy: null }],
    ["latest only", { ...pair, baseline: null, baseline_at: null, efficacy: null }],
    [
      "same run shown twice (latest_at === baseline_at)",
      { ...pair, latest_at: pair.baseline_at },
    ],
    ["both runs but no backend efficacy", { ...pair, efficacy: null }],
  ];

  for (const [name, bench] of empties) {
    it(`${name} → honest empty state, no 3D, no numbers`, () => {
      const c = render(<TwoFutures bench={bench} hw={hw} />);
      expect(c.getByTestId("two-futures-empty")).toBeTruthy();
      expect(c.queryByTestId("two-futures-split")).toBeNull();
      expect(c.queryByTestId("tf-scene")).toBeNull();
      // The empty state pitches honestly — and shows not a single digit.
      expect(c.getByText(/earn this view/i)).toBeTruthy();
      expect(c.getByTestId("two-futures-empty").textContent).not.toMatch(/\d/);
    });
  }

  it("hasMeasuredPair narrows exactly the full-pair shape", () => {
    expect(hasMeasuredPair(pair)).toBe(true);
    for (const [, bench] of empties) expect(hasMeasuredPair(bench)).toBe(false);
  });
});

describe("with a measured pair — every number is a struct field", () => {
  it("renders the split with the exact per-component before → after (±delta%) rows", async () => {
    const c = render(<TwoFutures bench={pair} hw={hw} />);
    expect(c.getByTestId("two-futures-split")).toBeTruthy();
    expect(await c.findByTestId("tf-scene")).toBeTruthy(); // lazy 3D chunk resolves async
    // CPU row: before/after/delta straight off the efficacy struct.
    const rows = c.container.querySelectorAll(".tf-row");
    expect(rows.length).toBe(4);
    expect(rows[0].textContent).toContain("CPU");
    expect(rows[0].textContent).toContain("62");
    expect(rows[0].textContent).toContain("71");
    expect(rows[0].textContent).toContain("+14.5%");
    expect(rows[0].textContent).toContain("Improved");
    expect(rows[1].textContent).toContain("-3.6%");
    expect(rows[1].textContent).toContain("Regressed");
    expect(rows[2].textContent).toContain("No measurable change");
    // Noise floor comes from the struct too.
    expect(c.getByText(/±3%/)).toBeTruthy();
  });

  it("hardware unreadable → no 3D, but the measured rail still renders", () => {
    const c = render(<TwoFutures bench={pair} hw={null} />);
    expect(c.getByTestId("two-futures-split")).toBeTruthy();
    expect(c.queryByTestId("tf-scene")).toBeNull();
    expect(c.container.querySelectorAll(".tf-row").length).toBe(4);
  });
});

describe("tier-1 source grep-guard — no fallback numbers, no demo data, v2 perf conventions", () => {
  const sources = [
    join("src", "surfaces", "TwoFutures.tsx"),
    join("src", "surfaces", "two-futures-view.ts"),
    join("src", "surfaces", "rig", "TwoFuturesScene.tsx"),
  ];

  it("no numeric fallback (`?? n` / `|| n`) and no placeholder/demo vocabulary", () => {
    for (const rel of sources) {
      const src = readFileSync(rel, "utf8");
      expect(src, `${rel} must not fall back to a literal number`).not.toMatch(
        /(\?\?|\|\|)\s*[\d.]/,
      );
      expect(src, `${rel} must not carry demo/placeholder data`).not.toMatch(
        /\b(demo|placeholder|sample|fake|dummy)\b/i,
      );
    }
  });

  it("scene keeps the v2 rest law: demand frameloop, no auto-rotate", () => {
    const scene = readFileSync(join("src", "surfaces", "rig", "TwoFuturesScene.tsx"), "utf8");
    expect(scene).toContain('frameloop="demand"');
    expect(scene).toContain("autoRotate={false}");
  });

  it("scene clamps orbit azimuth — the camera can never swap the rigs under the fixed heads", () => {
    // bug→guard (self-review catch): unclamped azimuth let a drag rotate past ±90°, putting the
    // Baseline rig under the "Now" head and vice versa.
    const scene = readFileSync(join("src", "surfaces", "rig", "TwoFuturesScene.tsx"), "utf8");
    expect(scene).toContain("minAzimuthAngle");
    expect(scene).toContain("maxAzimuthAngle");
  });

  it("the Two Futures CSS block stays on theme tokens (no raw hex — no invented palette)", () => {
    const css = readFileSync(join("src", "surfaces", "Benchmark.css"), "utf8");
    const tf = css.slice(css.indexOf("Two Futures measured split"));
    expect(tf.length).toBeGreaterThan(0);
    expect(tf).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("flag compy_two_futures — DEFAULT OFF", () => {
  it("fresh storage reads OFF; only an explicit \"1\" opts in", () => {
    expect(readTwoFutures()).toBe(false);
    localStorage.setItem("compy_two_futures", "0");
    expect(readTwoFutures()).toBe(false);
    localStorage.setItem("compy_two_futures", "1");
    expect(readTwoFutures()).toBe(true);
  });

  it("flag off (default): the Benchmark station renders no Two Futures section", async () => {
    const c = render(<BenchmarkTab />);
    await c.findByText("Baseline"); // surface settled
    expect(c.queryByText("Two futures")).toBeNull();
    expect(c.queryByTestId("two-futures-empty")).toBeNull();
  });

  it("flag on: the section mounts (honest empty state here — mocked state has no pair)", async () => {
    localStorage.setItem("compy_two_futures", "1");
    const c = render(<BenchmarkTab />);
    expect(await c.findByText("Two futures")).toBeTruthy();
    expect(c.getByTestId("two-futures-empty")).toBeTruthy();
    expect(c.queryByTestId("tf-scene")).toBeNull();
  });

  // bug→guard (self-review catch): with the flag on AND a pair, the classic efficacy card
  // rendered the same overall pill + the same 4 delta/verdict rows directly above the split.
  // The split SUBSUMES it — one readout, not two adjacent copies.
  it("flag on + measured pair: the split subsumes the efficacy card (no duplicate readout)", async () => {
    mocks.bench = pair;
    localStorage.setItem("compy_two_futures", "1");
    const c = render(<BenchmarkTab />);
    expect(await c.findByTestId("two-futures-split")).toBeTruthy();
    expect(c.queryByText("Since your baseline")).toBeNull();
    // The attribution line the efficacy card carried moved into the split (it lands once the
    // Machine Model read resolves, so it is awaited).
    expect(await c.findByText(/No Compy changes recorded since the baseline/)).toBeTruthy();
  });

  it("flag off + measured pair: today's efficacy card renders unchanged, no split", async () => {
    mocks.bench = pair;
    const c = render(<BenchmarkTab />);
    expect(await c.findByText("Since your baseline")).toBeTruthy();
    expect(c.queryByText("Two futures")).toBeNull();
    expect(c.queryByTestId("two-futures-split")).toBeNull();
  });
});

// Combined-effect attribution (panel-review brief 2026-07-15 §2, bug→guard): a delta measured
// with >1 change active belongs to the stack — both attribution surfaces (the split and the
// efficacy card) must say "combined" and refuse to credit any single change.
function fact<T>(value: T | null): Fact<T> {
  return { value, class: "recorded-historically", source: "test", freshness: "stamped" };
}
// A Machine Model row applied on this PC, inside the baseline→latest window of `pair`.
function row(id: string, title: string): CompyChangeFact {
  return {
    id,
    title,
    applied_at: fact("2026-07-03T12:00:00Z"),
    status: fact("applied"),
    still_active: fact(true),
    rolled_back_at: fact<string>(null),
    on_this_rig: fact(true),
    reversible: fact(true),
  };
}
const WIRE = wire as unknown as MachineModel;
function modelWith(rows: CompyChangeFact[]): MachineModel {
  const compy_changes = { ...WIRE.compy_changes, total_recorded: rows.length, changes: rows };
  delete compy_changes.ledger_unreadable;
  return { ...WIRE, compy_changes };
}
// What `benchmarkAttribution` hands the card for rows applied here: nothing left out, nothing cut.
function counted(titles: string[]): BenchmarkAttribution {
  return {
    kind: "counted",
    credited: titles.map((title, i) => ({ id: `c${i}`, title, rolledBack: false })),
    otherRig: 0,
    rigUnknown: 0,
    truncated: false,
    listed: titles.length,
    totalRecorded: titles.length,
  };
}

describe("combined-effect attribution — the stack gets the credit, never one change", () => {
  it("one change: plain attribution, no combined caveat", () => {
    const c = render(<TwoFutures bench={pair} hw={null} attribution={counted(["Game Mode"])} />);
    const line = c.container.querySelector(".bench-change")!;
    expect(line.textContent).toContain("Measuring the effect of: Game Mode.");
    expect(line.textContent).not.toMatch(/combined/i);
  });

  it("two changes in the split: combined lead + credit-refusing caveat", () => {
    const c = render(
      <TwoFutures
        bench={pair}
        hw={null}
        attribution={counted(["Game Mode", "Power plan"])}
      />,
    );
    const line = c.container.querySelector(".bench-change")!;
    expect(line.textContent).toContain("Measuring the combined effect of: Game Mode, Power plan.");
    expect(line.textContent).toContain("These 2 changes were measured together");
    expect(line.textContent).toContain("can't be credited to any one of them");
  });

  it("two changes in the efficacy card (flag off): same combined wording", async () => {
    mocks.bench = pair;
    mocks.model = modelWith([row("a", "Game Mode"), row("b", "Power plan")]);
    const c = render(<BenchmarkTab />);
    expect(await c.findByText("Since your baseline")).toBeTruthy();
    await c.findByText(/Measuring the combined effect of/);
    const line = c.container.querySelector(".bench-change")!;
    expect(line.textContent).toContain("Measuring the combined effect of: Game Mode, Power plan.");
    expect(line.textContent).toContain("These 2 changes were measured together");
  });
});

describe("partGlow — measured emphasis only, neutral without data", () => {
  it("no efficacy / structural parts / within-noise → exactly neutral", () => {
    expect(partGlow(null, "cpu")).toBe(1);
    expect(partGlow(efficacy, "board")).toBe(1);
    expect(partGlow(efficacy, "cooler")).toBe(1);
    expect(partGlow(efficacy, "psu")).toBe(1);
    expect(partGlow(efficacy, "gpu")).toBe(1); // 0.2% — within noise, verdict says so
  });

  it("scales by the measured delta and clamps", () => {
    expect(partGlow(efficacy, "cpu")).toBeCloseTo(1 + 14.5 * 0.08); // improved → brighter
    expect(partGlow(efficacy, "ram")).toBeCloseTo(1 - 3.6 * 0.08); // regressed → dimmer
    expect(partGlow(efficacy, "storage")).toBeCloseTo(1 + 4.3 * 0.08); // storage ↔ disk row
    const huge: Efficacy = {
      ...efficacy,
      per_component: [
        { component: "cpu", before: 10, after: 99, delta_pct: 890, verdict: "improved" },
        { component: "ram", before: 99, after: 10, delta_pct: -89, verdict: "regressed" },
      ],
    };
    expect(partGlow(huge, "cpu")).toBe(2.2);
    expect(partGlow(huge, "ram")).toBe(0.6);
  });
});

// #452: the line reads what the Machine Model could and could not say. Each "could not" is its own
// sentence, never folded into the count or the named list.
describe("attribution off the Machine Model — the line says what it does not know", () => {
  const base = counted(["Game Mode"]) as Extract<BenchmarkAttribution, { kind: "counted" }>;

  it("pending: no claim yet, so no sentence — the split still renders", () => {
    const c = render(<TwoFutures bench={pair} hw={null} attribution={{ kind: "pending" }} />);
    expect(c.getByTestId("two-futures-split")).toBeTruthy();
    expect(c.container.querySelector(".bench-change")).toBeNull();
  });

  it("unknown: withdraws instead of crediting the user", () => {
    const c = render(<TwoFutures bench={pair} hw={null} attribution={{ kind: "unknown" }} />);
    expect(c.container.querySelector(".bench-change")!.textContent).toBe(
      "Compy can't read its own record, so it can't say whether any of its changes are part of this result.",
    );
  });

  it("a row left out for being another PC's is said so, in the plural the count needs", () => {
    const c = render(<TwoFutures bench={pair} hw={null} attribution={{ ...base, otherRig: 2 }} />);
    const line = c.container.querySelector(".bench-change")!.textContent!;
    expect(line).toContain("Measuring the effect of: Game Mode.");
    expect(line).toContain("2 Compy changes in this window were made on another PC and are not counted here.");
  });

  it("a credited row whose PC is unknown is said so", () => {
    const c = render(<TwoFutures bench={pair} hw={null} attribution={{ ...base, rigUnknown: 1 }} />);
    expect(c.container.querySelector(".bench-change")!.textContent).toContain(
      "1 of these was recorded before Compy stamped which PC it was on, so it may not have been this one.",
    );
  });

  // #599: a change undone after the runs is still what they measured, so it keeps its credit —
  // but the line must not read as if it were still on.
  it("a credited row rolled back since keeps its credit and says it was rolled back", () => {
    const attr = {
      ...base,
      credited: [
        { id: "a", title: "Game Mode", rolledBack: true },
        { id: "b", title: "Power plan", rolledBack: false },
      ],
      listed: 2,
      totalRecorded: 2,
    };
    const c = render(<TwoFutures bench={pair} hw={null} attribution={attr} />);
    const line = c.container.querySelector(".bench-change")!;
    expect(line.textContent).toContain(
      "Measuring the combined effect of: Game Mode (since rolled back), Power plan.",
    );
    const marks = line.querySelectorAll(".bench-rolled-back");
    expect(marks).toHaveLength(1);
    expect([...line.querySelectorAll("strong")].map((n) => n.textContent)).toEqual(["Game Mode", "Power plan"]);
  });

  it("a row still in place carries no rolled-back mark", () => {
    const c = render(<TwoFutures bench={pair} hw={null} attribution={base} />);
    const line = c.container.querySelector(".bench-change")!;
    expect(line.textContent).not.toContain("rolled back");
    expect(line.querySelector(".bench-rolled-back")).toBeNull();
  });

  it("a display-capped list is called a floor, with the exact shown-of-total", () => {
    const c = render(
      <TwoFutures
        bench={pair}
        hw={null}
        attribution={{ ...base, truncated: true, listed: 25, totalRecorded: 40 }}
      />,
    );
    expect(c.container.querySelector(".bench-change")!.textContent).toContain(
      "Compy's model lists only its newest 25 of 40 recorded changes",
    );
  });
});
