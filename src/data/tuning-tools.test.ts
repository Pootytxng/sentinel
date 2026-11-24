import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AppliedChange } from "../types";
import type { TuningToolsFacts } from "./tuning-tools";

// D6 "Tuning tools" (owner decision 2026-11-24: Test's tools behind an opt-in; Nagle tuning-only).
// Plan: _train/d6-test-room-opt-in-plan-v2.md. Each block names its break check: the one-line edit to the
// code under test that must turn it red.

const calls: Record<string, () => Promise<unknown>> = {};
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => (calls[cmd] ? calls[cmd]() : Promise.resolve(null))),
}));

const {
  decideTuningTools,
  layerOneRecs,
  readTuningTools,
  readTuningToolsChoice,
  setTuningTools,
  TUNING_ONLY_REC_IDS,
  TUNING_STATIONS,
  tuningRunInProgress,
} = await import("./tuning-tools");
const { tuningToolsOffRefusal } = await import("./tuning-tools-refusal");

const KEY = "compy_tuning_tools";
const row = { id: "c1", rec_id: "game-mode", rec_title: "Game Mode", status: "rolled_back" } as unknown as AppliedChange;

beforeEach(() => {
  localStorage.clear();
  for (const k of Object.keys(calls)) delete calls[k];
});
// setTuningTools(false) below must not leak "off" into a later test.
afterEach(() => localStorage.removeItem(KEY));

describe("the stored preference", () => {
  // Break check: make readTuningTools return `readTuningToolsChoice() === "on"` and the first case fails.
  it("shows the tools while no choice is stored (nothing is hidden on a decision not made)", () => {
    expect(readTuningToolsChoice()).toBeNull();
    expect(readTuningTools()).toBe(true);
  });

  it("round-trips on/off and tells mounted surfaces", () => {
    const seen = vi.fn();
    window.addEventListener("compy:tuning-tools", seen);
    try {
      setTuningTools(false);
      expect(localStorage.getItem(KEY)).toBe("0");
      expect(readTuningTools()).toBe(false);
      setTuningTools(true);
      expect(localStorage.getItem(KEY)).toBe("1");
      expect(readTuningTools()).toBe(true);
      expect(seen).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener("compy:tuning-tools", seen);
    }
  });

  it("treats a garbage value as no choice", () => {
    localStorage.setItem(KEY, "maybe");
    expect(readTuningToolsChoice()).toBeNull();
    expect(readTuningTools()).toBe(true);
  });
});

describe("the first-run decision (review item 4, review r1 F1)", () => {
  /** A new install: every read answered, the ledger vouched complete, nothing anywhere. */
  const fresh: TuningToolsFacts = { ledger: [], ledgerComplete: true, slot: "empty", experiments: 0 };

  // Control for every "undecided"/"on" case below.
  it("all reads answered, the ledger vouched complete and everything empty -> off (a new install)", () => {
    expect(decideTuningTools(fresh)).toBe("off");
  });

  // Break check: delete the `f.ledger === null` clause and this returns "off" — the trap where App's initial
  // `changes = []` (before get_applied_changes answers) persisted "off" for every user.
  it("waits for the ledger's first answer: no answer yet is undecided, never off", () => {
    expect(decideTuningTools({ ...fresh, ledger: null })).toBe("undecided");
  });

  // Break check (F1): delete `f.ledgerComplete !== true` and both cases return "off". get_applied_changes
  // answers [] for a corrupt or AV-locked history, so [] alone proves nothing.
  it.each([
    ["known incomplete (quarantined or unreadable)", false],
    ["unknown (the health probe failed or answered nothing)", null],
  ])("an empty ledger whose health is %s is undecided", (_name, complete) => {
    expect(decideTuningTools({ ...fresh, ledgerComplete: complete as boolean | null })).toBe("undecided");
  });

  // Break check (F1): delete the `f.experiments > 0` line and this returns "off".
  it("an empty ledger with a Trial record (any status, e.g. running) is on", () => {
    expect(decideTuningTools({ ...fresh, experiments: 1 })).toBe("on");
    expect(decideTuningTools({ ...fresh, ledgerComplete: null, experiments: 2 })).toBe("on");
  });

  // Break check: delete `f.experiments === null` and this returns "off".
  it("a failed Trial-records read is undecided", () => {
    expect(decideTuningTools({ ...fresh, experiments: null })).toBe("undecided");
  });

  // Break check: delete the `f.slot === "unread"` clause and the unread case returns "off".
  it("an unreadable or unanswered Gaming Mode slot is undecided (readSessionSlot would have said none)", () => {
    expect(decideTuningTools({ ...fresh, slot: "unread" })).toBe("undecided");
    expect(decideTuningTools({ ...fresh, slot: null })).toBe("undecided");
  });

  // Break check: change `f.ledger.length > 0` to `f.ledger.some(c => c.status === "applied")` and the
  // rolled-back row case fails.
  it("any ledger row, applied or undone, starts on, whatever else is unknown", () => {
    expect(decideTuningTools({ ledger: [row], ledgerComplete: null, slot: "unread", experiments: null })).toBe("on");
  });

  // Break check: delete the `f.slot === "present"` line and this returns "off".
  it("a Gaming Mode session file starts on, even with an empty ledger", () => {
    expect(decideTuningTools({ ...fresh, slot: "present" })).toBe("on");
  });

  it("owner decision 4: a benchmark-only user and a clean-stop Gaming Mode user start off", () => {
    // Neither leaves a ledger row, a Trial record or a slot file, so both are the fresh case by construction.
    expect(decideTuningTools(fresh)).toBe("off");
  });
});

describe("what keeps a tool on screen with the tools off (review r1 F2)", () => {
  // Break check: make `trial` `=== "running"` and the unknown case hides the Trials bench.
  it("a running or unreadable Trial keeps the Trials bench", () => {
    expect(tuningRunInProgress("running", false, false).trial).toBe(true);
    expect(tuningRunInProgress("unknown", false, false).trial).toBe(true);
    expect(tuningRunInProgress(null, false, false).trial).toBe(true);
    expect(tuningRunInProgress("none", false, false).trial).toBe(false);
  });

  // Break check: make `bench` `bench === true || tweak === true` and the failed-read cases hide Benchmark.
  it("a running or unreadable benchmark run or tweak trial keeps the Benchmark station", () => {
    expect(tuningRunInProgress("none", true, false).bench).toBe(true);
    expect(tuningRunInProgress("none", false, true).bench).toBe(true);
    expect(tuningRunInProgress("none", null, false).bench).toBe(true);
    expect(tuningRunInProgress("none", false, null).bench).toBe(true);
    expect(tuningRunInProgress("none", false, false).bench).toBe(false);
  });
});

describe("Nagle is tuning-layer only", () => {
  const recs = [{ id: "game-mode" }, { id: "nagle-disable" }, { id: "hags-enable" }];

  // Break check: empty TUNING_ONLY_REC_IDS and the first assertion fails.
  it("layerOneRecs drops nagle-disable and keeps the rest in order", () => {
    expect(TUNING_ONLY_REC_IDS.has("nagle-disable")).toBe(true);
    expect(layerOneRecs(recs).map((r) => r.id)).toEqual(["game-mode", "hags-enable"]);
  });

  it("passes null (loading) and undefined (not wired) through unchanged", () => {
    expect(layerOneRecs(null)).toBeNull();
    expect(layerOneRecs(undefined)).toBeUndefined();
  });

  it("owner note: pcie-aspm-off and usb-selective-suspend-off are NOT tuning-only (unchanged)", () => {
    expect(TUNING_ONLY_REC_IDS.has("pcie-aspm-off")).toBe(false);
    expect(TUNING_ONLY_REC_IDS.has("usb-selective-suspend-off")).toBe(false);
  });

  it("the hidden stations are exactly Benchmark, Latency and Tuning (Diagnostics and Crash & Freeze stay)", () => {
    expect([...TUNING_STATIONS].sort()).toEqual(["benchmark", "latency", "tuning"]);
  });
});

describe("turning the tools off is refused while something they hold is in progress (review items 1-2)", () => {
  const idle = () => {
    calls.get_experiments = () => Promise.resolve([]);
    calls.get_benchmark_state = () => Promise.resolve({ running: false });
    calls.get_trial_state = () => Promise.resolve({ running: false });
    calls.get_gaming_session_state = () => Promise.resolve(null);
  };

  // Control for every case below: with everything idle the switch is allowed.
  it("allows it when nothing is running and every read answered", async () => {
    idle();
    expect(await tuningToolsOffRefusal(true)).toBeNull();
  });

  // Break check (each row): delete the matching `return` in tuning-tools-refusal.ts and that row returns null.
  it.each([
    ["a running Trial", () => (calls.get_experiments = () => Promise.resolve([{ status: "running" }])), true, "trial"],
    ["a pending Trial", () => (calls.get_experiments = () => Promise.resolve([{ status: "pending" }])), true, "trial"],
    ["the guided journey mid-way", () => {}, false, "trial"],
    ["an unreadable Trial list", () => (calls.get_experiments = () => Promise.reject(new Error("x"))), true, "trialUnread"],
    ["a benchmark run", () => (calls.get_benchmark_state = () => Promise.resolve({ running: true })), true, "bench"],
    ["a tweak trial", () => (calls.get_trial_state = () => Promise.resolve({ running: true })), true, "bench"],
    ["an unreadable benchmark state", () => (calls.get_benchmark_state = () => Promise.reject(new Error("x"))), true, "benchUnread"],
    ["an unreadable tweak-trial state", () => (calls.get_trial_state = () => Promise.resolve(null)), true, "benchUnread"],
    ["a live or pending Gaming Mode session", () => (calls.get_gaming_session_state = () => Promise.resolve({ phase: "active" })), true, "gaming"],
    ["an unreadable Gaming Mode slot", () => (calls.get_gaming_session_state = () => Promise.reject(new Error("x"))), true, "gamingUnread"],
  ])("refuses with %s", async (_name, arrange, journeyIdle, expected) => {
    idle();
    arrange();
    expect(await tuningToolsOffRefusal(journeyIdle as boolean)).toBe(expected);
  });
});
