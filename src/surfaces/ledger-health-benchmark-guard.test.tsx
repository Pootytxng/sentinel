// bug → guard, third and worst instance of the ledger-completeness class (Optimize/Fix closed by
// `b60a314`/`a1d5f53`, the Blackbook Logbook by `61e092c`).
//
// `get_applied_changes` degrades a Trust Ledger it cannot READ to an empty array. On the Benchmark
// tab both attributing cards print that emptiness as:
//
//     "No Compy changes recorded since the baseline — this reflects manual or ambient changes."
//
// That sentence does not merely under-report an absence — it ASSIGNS CAUSATION, handing the measured
// delta to the user or their environment. On a record Compy cannot read, that is a fabricated causal
// claim. The rule, in the wording intelligence.rs uses for the same distinction: the user must be
// able to tell "Compy did nothing" apart from "Compy can't tell you what it did".
//
// Both failure shapes mean incomplete and both are pinned below — transient (load_history() failing
// RIGHT NOW) and durable (quarantined on an earlier run, so every later load returns Ok(vec![])
// forever, byte-identical to a genuine first run). And the case that is NOT a defect: health UNKNOWN
// (the probe itself failed) must leave the surface EXACTLY as it was, byte for byte — claiming
// incompleteness from a failed read is the same sin, mirrored.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import type { AppliedChange, BenchmarkState, CompyChangeFact, Fact, MachineModel } from "../types";
import { invalidateProbe } from "../data/probe-cache";
import wire from "../test/fixtures/machine-model.wire.json";

const health: { value: unknown; reject: boolean } = { value: null, reject: false };
const bench: { state: BenchmarkState | null } = { state: null };
// The attribution reads the Machine Model (#452): its `compy_changes` rows, and its own word on
// whether the ledger behind them was readable.
const model: { value: MachineModel | null } = { value: null };

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    switch (cmd) {
      case "get_benchmark_state":
        return Promise.resolve(bench.state);
      case "get_ledger_health":
        return health.reject ? Promise.reject(new Error("ipc down")) : Promise.resolve(health.value);
      case "get_machine_model":
        return Promise.resolve(model.value);
      case "get_fps_status":
        return Promise.resolve({ active: false });
      case "get_recommendations":
      case "get_appliable_rec_ids":
        return Promise.resolve([]);
      // No hardware → no rig-tier band and no lazy 3D stage; this file is about one sentence.
      case "get_hardware_info":
        return Promise.reject(new Error("no hw"));
      default:
        return Promise.resolve(null);
    }
  }),
}));

import { invoke } from "@tauri-apps/api/core";
import { BenchmarkTab } from "./Benchmark";

const BASELINE_AT = "2026-08-01T10:00:00.000Z";
const LATEST_AT = "2026-08-02T10:00:00.000Z";

const MEASURED: BenchmarkState = {
  running: false,
  baseline: { components: [], confidence: "good", notes: [] },
  baseline_at: BASELINE_AT,
  latest: { components: [], confidence: "good", notes: [] },
  latest_at: LATEST_AT,
  efficacy: {
    per_component: [{ component: "cpu", before: 100, after: 110, delta_pct: 10, verdict: "better" }],
    overall: "better",
    noise_floor_pct: 3,
  },
  error: null,
} as unknown as BenchmarkState;

// No pair → no attribution line anywhere → nothing for the disclosure to qualify.
const UNMEASURED: BenchmarkState = {
  running: false,
  baseline: null,
  baseline_at: null,
  latest: null,
  latest_at: null,
  efficacy: null,
  error: null,
} as unknown as BenchmarkState;

const CHANGE: AppliedChange = {
  id: "chg-1",
  rec_id: "hags-enable",
  rec_title: "Hardware-accelerated GPU scheduling",
  applied_at: "2026-08-01T12:00:00.000Z", // inside the baseline→latest window
  snapshot: null,
  status: "applied",
  is_still_active: true,
} as unknown as AppliedChange;

const HEALTHY = { complete: true, error: null, quarantined: false };
const UNREADABLE = { complete: false, error: "failed to read history.json", quarantined: false };
const QUARANTINED = { complete: false, error: null, quarantined: true };

const UNREADABLE_TITLE = "Compy can't read its own record right now";
const QUARANTINED_TITLE = "Compy can't tell you everything it did";
// The exact causal half of the sentence — the thing that must never survive an unreadable ledger.
const CAUSAL_CLAIM = "this reflects manual or ambient changes";
const WITHDRAWN =
  "Compy can't read its own record, so it can't say whether any of its changes are part of this result.";

// The claim is read off the ELEMENT that carries it, not matched as a page substring: a substring
// matcher keeps passing after a reword, which is exactly the failure this file exists to catch.
const efficacyClaim = (c: HTMLElement) => c.querySelector(".bench-change");
const splitClaim = (c: HTMLElement) =>
  c.querySelector('[data-testid="two-futures-split"] .bench-change');

function fact<T>(value: T | null): Fact<T> {
  return { value, class: "recorded-historically", source: "test", freshness: "stamped" };
}
function row(id: string, title: string, appliedAt: string, onThisRig: boolean | null): CompyChangeFact {
  return {
    id,
    title,
    applied_at: fact(appliedAt),
    status: fact("applied"),
    still_active: fact(true),
    rolled_back_at: fact<string>(null),
    on_this_rig: fact(onThisRig),
    reversible: fact(true),
  };
}
const WIRE = wire as unknown as MachineModel;
// A model that READ the ledger and found exactly `rows`.
function modelWith(rows: CompyChangeFact[]): MachineModel {
  const compy_changes = { ...WIRE.compy_changes, total_recorded: rows.length, changes: rows };
  delete compy_changes.ledger_unreadable;
  return { ...WIRE, compy_changes };
}
// A model whose own ledger read failed: counts are 0 because nothing was read, and it says so.
function unreadableModel(reason: string): MachineModel {
  return { ...WIRE, compy_changes: { ...modelWith([]).compy_changes, ledger_unreadable: reason } };
}

beforeEach(() => {
  health.value = HEALTHY;
  health.reject = false;
  bench.state = MEASURED;
  model.value = modelWith([]);
  invalidateProbe();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

async function mount(provingGround = false) {
  const r = render(<BenchmarkTab provingGround={provingGround} />);
  // Flush get_benchmark_state, then the health probe its result keys.
  // …and the Machine Model read the attribution keys off (one IPC, shared while in flight).
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
  return r;
}

describe("the efficacy card may not blame the user for a ledger it can't read", () => {
  it("an unreadable ledger withdraws the attribution instead of assigning it", async () => {
    health.value = UNREADABLE;
    const { container } = await mount();

    expect(efficacyClaim(container)?.textContent).toBe(WITHDRAWN);
    expect(container.textContent).not.toContain(CAUSAL_CLAIM);
    expect(screen.getByText(UNREADABLE_TITLE)).toBeTruthy();
  });

  it("a quarantined ledger does the same — the durable shape loads clean-and-empty forever", async () => {
    health.value = QUARANTINED;
    const { container } = await mount();

    expect(efficacyClaim(container)?.textContent).toBe(WITHDRAWN);
    expect(container.textContent).not.toContain(CAUSAL_CLAIM);
    expect(screen.getByText(QUARANTINED_TITLE)).toBeTruthy();
  });

  it("a healthy ledger keeps the original sentence — the honest empty case is untouched", async () => {
    const { container } = await mount();

    expect(efficacyClaim(container)?.textContent).toContain(CAUSAL_CLAIM);
    expect(container.querySelector(".ledger-health")).toBeNull();
  });

  it("the disclosure is read BEFORE the card whose claim it qualifies", async () => {
    health.value = QUARANTINED;
    const { container } = await mount();

    const box = container.querySelector(".ledger-health")!;
    const claim = efficacyClaim(container)!;
    expect(box).toBeTruthy();
    // A caveat printed under the thing it qualifies has already failed at its job.
    expect(box.compareDocumentPosition(claim) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a PARTIAL list still gets the disclosure — it is the dangerous case, because it looks whole", async () => {
    health.value = QUARANTINED;
    model.value = modelWith([row(CHANGE.id, CHANGE.rec_title, CHANGE.applied_at, true)]);
    const { container } = await mount();

    // Narrowing applies only to the EMPTY branch; a named change is still named.
    expect(efficacyClaim(container)?.textContent).toContain("Hardware-accelerated GPU scheduling");
    expect(container.querySelector(".ledger-health")).toBeTruthy();
  });
});

describe("Two Futures subsumes the efficacy card, so it inherits the same refusal", () => {
  it("an unreadable ledger withdraws the split view's attribution too", async () => {
    health.value = UNREADABLE;
    const { container } = await mount(true);

    expect(splitClaim(container)?.textContent).toBe(WITHDRAWN);
    expect(container.textContent).not.toContain(CAUSAL_CLAIM);
    expect(screen.getByText(UNREADABLE_TITLE)).toBeTruthy();
  });

  it("a quarantined ledger does the same on the split view", async () => {
    health.value = QUARANTINED;
    const { container } = await mount(true);

    expect(splitClaim(container)?.textContent).toBe(WITHDRAWN);
    expect(container.textContent).not.toContain(CAUSAL_CLAIM);
    expect(screen.getByText(QUARANTINED_TITLE)).toBeTruthy();
  });

  it("healthy keeps the original sentence on the split view", async () => {
    const { container } = await mount(true);

    expect(splitClaim(container)?.textContent).toContain(CAUSAL_CLAIM);
    expect(container.querySelector(".ledger-health")).toBeNull();
  });

  it("the disclosure precedes the split view as well", async () => {
    health.value = UNREADABLE;
    const { container } = await mount(true);

    const box = container.querySelector(".ledger-health")!;
    const claim = splitClaim(container)!;
    expect(box.compareDocumentPosition(claim) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("only ONE disclosure exists — the two cards are mutually exclusive, so it can never double", async () => {
    health.value = QUARANTINED;
    const { container } = await mount(true);

    expect(container.querySelectorAll(".ledger-health").length).toBe(1);
    // The efficacy card is subsumed when the split renders; two attribution lines would be a
    // duplicate claim, and a duplicate disclosure over it.
    expect(efficacyClaim(container)).toBe(splitClaim(container));
  });
});

describe("the tab reads no ledger list of its own (#453)", () => {
  it("never calls get_applied_changes; the model and the health probe are its only ledger sources", async () => {
    await mount();
    const called = vi.mocked(invoke).mock.calls.map(([cmd]) => cmd);
    expect(called).not.toContain("get_applied_changes");
    expect(called).toContain("get_ledger_health");
    expect(called).toContain("get_machine_model");
  });
});

describe("no claim, no disclosure", () => {
  it("a tab with no measured pair makes no attribution, so it gets no warning either", async () => {
    bench.state = UNMEASURED;
    health.value = QUARANTINED;
    const { container } = await mount(true);

    // The honest empty state, not a claim about the ledger — nothing here to qualify.
    expect(container.querySelector('[data-testid="two-futures-empty"]')).toBeTruthy();
    expect(container.querySelector(".ledger-health")).toBeNull();
  });
});

describe("UNKNOWN health is not incompleteness — a failed probe may not manufacture a warning", () => {
  it("leaves the efficacy card BYTE-IDENTICAL to a healthy ledger", async () => {
    const healthy = (await mount()).container.innerHTML;
    cleanup();

    health.reject = true;
    const unknown = (await mount()).container.innerHTML;

    expect(unknown).toBe(healthy);
  });

  it("leaves the split view BYTE-IDENTICAL to a healthy ledger", async () => {
    const healthy = (await mount(true)).container.innerHTML;
    cleanup();

    health.reject = true;
    const unknown = (await mount(true)).container.innerHTML;

    expect(unknown).toBe(healthy);
  });

  it("a ledger that reports itself COMPLETE is left alone", async () => {
    // complete:true is the backend vouching for the list. Not our place to second-guess it.
    const { container } = await mount();

    expect(efficacyClaim(container)?.textContent).toContain(CAUSAL_CLAIM);
    expect(container.querySelector(".ledger-health")).toBeNull();
  });
});

// #452: the attribution now reads the Machine Model, which carries two things a bare
// `get_applied_changes` list never did — its own word on whether the ledger was readable, and which
// PC each row was applied on. Both are pinned here.
describe("the Machine Model's own word on the ledger outranks a health probe that says complete", () => {
  it("a model that could not read the ledger withdraws the claim even when health says COMPLETE", async () => {
    model.value = unreadableModel("history.json is locked");
    const { container } = await mount();

    expect(efficacyClaim(container)?.textContent).toBe(WITHDRAWN);
    expect(container.textContent).not.toContain(CAUSAL_CLAIM);
  });

  it("no model at all (the read failed) withdraws too — never the empty sentence off nothing", async () => {
    model.value = null;
    const { container } = await mount(true);

    expect(splitClaim(container)?.textContent).toBe(WITHDRAWN);
    expect(container.textContent).not.toContain(CAUSAL_CLAIM);
  });
});

describe("which PC a change was applied on decides whether it is credited", () => {
  const IN_WINDOW = "2026-08-01T12:00:00.000Z";

  it("a change the ledger places on ANOTHER PC is never named, and the line says it was left out", async () => {
    model.value = modelWith([row("chg-x", "Power plan", IN_WINDOW, false)]);
    const { container } = await mount();

    const line = efficacyClaim(container)?.textContent ?? "";
    expect(line).not.toContain("Power plan");
    expect(line).toContain(CAUSAL_CLAIM);
    expect(line).toContain(
      "1 Compy change in this window was made on another PC and is not counted here.",
    );
  });

  it("a change on THIS PC is named as the thing being measured", async () => {
    model.value = modelWith([row("chg-y", "Game Mode", IN_WINDOW, true)]);
    const { container } = await mount(true);

    const line = splitClaim(container)?.textContent ?? "";
    expect(line).toContain("Measuring the effect of: Game Mode.");
    expect(line).not.toContain(CAUSAL_CLAIM);
    expect(line).not.toContain("another PC");
  });

  it("a change whose PC the ledger could not name is credited AND said to be uncertain", async () => {
    model.value = modelWith([row("chg-z", "Game Mode", IN_WINDOW, null)]);
    const { container } = await mount();

    const line = efficacyClaim(container)?.textContent ?? "";
    expect(line).toContain("Measuring the effect of: Game Mode.");
    expect(line).toContain("1 of these was recorded before Compy stamped which PC it was on");
  });

  it("a change outside the baseline→latest window is not credited", async () => {
    model.value = modelWith([row("chg-old", "Game Mode", "2026-07-01T12:00:00.000Z", true)]);
    const { container } = await mount();

    expect(efficacyClaim(container)?.textContent).toContain(CAUSAL_CLAIM);
  });
});
