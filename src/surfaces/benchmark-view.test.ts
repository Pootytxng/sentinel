import { describe, it, expect } from "vitest";
import {
  benchmarkAttribution,
  changeAttribution,
  changesBetweenRuns,
  componentLabel,
  verdictLabel,
  verdictTone,
  fmtDelta,
  trialVerdictLabel,
  trialVerdictTone,
  trialReasonText,
  benchRigTier,
  fmtLocalWinTopPct,
  fmtLocalWinPercentile,
} from "./benchmark-view";
import type { CompyChangeFact, Fact, MachineModel, TrialVerdict } from "../types";
import wire from "../test/fixtures/machine-model.wire.json";

const GIB = 1024 ** 3;

describe("componentLabel", () => {
  it("maps each component to a friendly label", () => {
    expect(componentLabel("cpu")).toBe("CPU");
    expect(componentLabel("ram")).toBe("Memory");
    expect(componentLabel("gpu")).toBe("GPU");
    expect(componentLabel("disk")).toBe("Disk");
  });
});

describe("verdict", () => {
  it("labels each verdict honestly", () => {
    expect(verdictLabel("improved")).toBe("Improved");
    expect(verdictLabel("no-measurable-change")).toBe("No measurable change");
    expect(verdictLabel("regressed")).toBe("Regressed");
  });
  it("tones: improved=ready, regressed=attention (never red Critical), no-change=neutral(info)", () => {
    expect(verdictTone("improved")).toBe("ready");
    expect(verdictTone("regressed")).toBe("attention");
    expect(verdictTone("regressed")).not.toBe("danger");
    expect(verdictTone("no-measurable-change")).toBe("info");
  });
});

describe("fmtDelta", () => {
  it("signs non-zero deltas and rounds to 1 decimal", () => {
    expect(fmtDelta(4.21)).toBe("+4.2%");
    expect(fmtDelta(-1.14)).toBe("-1.1%");
    expect(fmtDelta(0)).toBe("0%");
    expect(fmtDelta(0.04)).toBe("0%");
  });
});

describe("changeAttribution — a multi-change delta never reads as a single change's win", () => {
  // Panel-review brief 2026-07-15 §2 (bug→guard): with >1 change between the two runs the
  // measurement can only speak for the stack — the lead must say "combined" and the caveat
  // must refuse to split the credit.
  it("one change: plain lead, no caveat", () => {
    const a = changeAttribution(1);
    expect(a.lead).toBe("Measuring the effect of:");
    expect(a.caveat).toBeNull();
  });
  it("several changes: combined lead + credit-refusing caveat naming the count", () => {
    const a = changeAttribution(3);
    expect(a.lead).toBe("Measuring the combined effect of:");
    expect(a.caveat).toContain("These 3 changes were measured together");
    expect(a.caveat).toContain("can't be credited to any one of them");
  });
});

describe("changesBetweenRuns — the ONE attribution window every surface filters by", () => {
  const window = { baseline_at: "2026-07-01T10:00:00Z", latest_at: "2026-07-02T10:00:00Z" };
  const at = (applied_at: string) => ({ applied_at });

  it("keeps only changes applied strictly after the baseline and no later than the latest run", () => {
    const kept = changesBetweenRuns(window, [
      at("2026-07-01T09:00:00Z"), // before the baseline — a change the baseline already measured
      at("2026-07-01T10:00:00Z"), // AT the baseline instant — exclusive, already in the baseline
      at("2026-07-01T12:00:00Z"), // in the window
      at("2026-07-02T10:00:00Z"), // AT the latest run — inclusive, the run measured it
      at("2026-07-02T11:00:00Z"), // after the latest run — the result never saw it
    ]);
    expect(kept.map((c) => c.applied_at)).toEqual([
      "2026-07-01T12:00:00Z",
      "2026-07-02T10:00:00Z",
    ]);
  });

  it("no recorded window (missing either timestamp, or no bench) → no attribution, never a guess", () => {
    const c = [at("2026-07-01T12:00:00Z")];
    expect(changesBetweenRuns(null, c)).toEqual([]);
    expect(changesBetweenRuns({ baseline_at: window.baseline_at, latest_at: null }, c)).toEqual([]);
    expect(changesBetweenRuns({ baseline_at: null, latest_at: window.latest_at }, c)).toEqual([]);
  });

  it("unparseable timestamps drop out rather than mis-attributing", () => {
    expect(changesBetweenRuns(window, [at("not-a-date"), at("2026-07-01T12:00:00Z")])).toHaveLength(1);
    expect(changesBetweenRuns({ baseline_at: "garbage", latest_at: window.latest_at }, [at("2026-07-01T12:00:00Z")])).toEqual([]);
  });
});

describe("trial verdict", () => {
  const keep: TrialVerdict = { verdict: "keep", effect_pct: 6, ci_lo_pct: 4, ci_hi_pct: 8, metric: "1% low" };
  const revert: TrialVerdict = { verdict: "revert", effect_pct: -7, ci_lo_pct: -9, ci_hi_pct: -5, metric: "0.1% low" };
  const noChange: TrialVerdict = { verdict: "inconclusive", reason: "within-noise" };
  it("labels + tones each verdict", () => {
    expect(trialVerdictLabel(keep)).toBe("Helped");
    expect(trialVerdictTone(keep)).toBe("ready");
    expect(trialVerdictLabel(revert)).toBe("Hurt — reverted");
    expect(trialVerdictTone(revert)).toBe("info");
    expect(trialVerdictLabel(noChange)).toBe("No measurable change");
    expect(trialVerdictTone(noChange)).toBe("info");
  });
  it("P7-severity: a hurt change that was put back is calm; danger only while it is still applied", () => {
    // Rolled back: still reported as having hurt, but not red "Critical".
    expect(trialVerdictTone(revert, true)).toBe("info");
    expect(trialVerdictLabel(revert, undefined, true)).toBe("Hurt — reverted");
    // Rollback failed: the harmful change is still on the machine, so danger stays and the
    // label must not claim it was reverted.
    expect(trialVerdictTone(revert, false)).toBe("danger");
    expect(trialVerdictLabel(revert, undefined, false)).toBe("Hurt — still applied");
    // The flag never changes the other verdicts.
    expect(trialVerdictTone(keep, false)).toBe("ready");
    expect(trialVerdictLabel(keep, undefined, false)).toBe("Helped");
    expect(trialVerdictTone(noChange, false)).toBe("info");
  });
  it("explains inconclusive reasons", () => {
    expect(trialReasonText("within-noise")).toMatch(/noise/);
    expect(trialReasonText("invalid-trial")).toMatch(/invalid/);
  });
});

describe("benchRigTier (A2 hardware-tier segmentation)", () => {
  it("classifies a strong-on-all-axes rig as High and names the measured inputs", () => {
    const ctx = benchRigTier({
      gpus: [{ vram_bytes: 16 * GIB }],
      cpu_cores_physical: 8,
      ram_total_bytes: 32 * GIB,
    });
    expect(ctx).not.toBeNull();
    expect(ctx!.tier).toBe("High");
    // Honest, transparent basis — exactly the three facts it read (matches rig-tier.ts wording).
    expect(ctx!.basis).toBe("rough, from 16 GB VRAM · 8 cores · 32 GB RAM");
  });

  it("is conservative: one weak axis drops it to Entry (a strong spec can't carry it)", () => {
    // 16 GB VRAM + 32 GB RAM but only 2 cores → Entry, never inflated to High/Mid.
    const ctx = benchRigTier({
      gpus: [{ vram_bytes: 16 * GIB }],
      cpu_cores_physical: 2,
      ram_total_bytes: 32 * GIB,
    });
    expect(ctx!.tier).toBe("Entry");
  });

  it("reads the LARGEST VRAM across adapters (discrete dGPU, not the iGPU)", () => {
    const ctx = benchRigTier({
      gpus: [{ vram_bytes: 1 * GIB }, { vram_bytes: 12 * GIB }],
      cpu_cores_physical: 8,
      ram_total_bytes: 16 * GIB,
    });
    expect(ctx!.tier).toBe("High");
    expect(ctx!.basis).toContain("12 GB VRAM");
  });

  it("treats a missing GPU list as 0 VRAM rather than throwing", () => {
    const ctx = benchRigTier({ cpu_cores_physical: 8, ram_total_bytes: 16 * GIB });
    expect(ctx!.tier).toBe("Entry"); // <6 GB VRAM floor
    expect(ctx!.basis).toContain("0 GB VRAM");
  });

  it("returns null when nothing is readable — never a fabricated tier", () => {
    expect(benchRigTier({ gpus: [], cpu_cores_physical: 0, ram_total_bytes: 0 })).toBeNull();
  });
});

describe("fmtLocalWinTopPct (A2 LOCAL percentile stub)", () => {
  it("shows nothing when there's no rankable percentile yet", () => {
    // null/undefined (too few wins → backend sends null) and non-finite all suppress the row.
    expect(fmtLocalWinTopPct(null)).toBeNull();
    expect(fmtLocalWinTopPct(undefined)).toBeNull();
    expect(fmtLocalWinTopPct(NaN)).toBeNull();
    expect(fmtLocalWinTopPct(Infinity)).toBeNull();
  });

  it("renders the complement (top %) of the percentile — higher percentile → smaller top %", () => {
    // Strongest self-inclusive win of 4 ≈ 87.5th percentile → top ~13% (round of 12.5).
    expect(fmtLocalWinTopPct(87.5)).toBe("Top 13% of your verified wins");
    // The midpoint maps to top half.
    expect(fmtLocalWinTopPct(50)).toBe("Top 50% of your verified wins");
    // A weak win (low percentile) honestly reads as a large top %.
    expect(fmtLocalWinTopPct(12.5)).toBe("Top 88% of your verified wins");
  });

  it("clamps the boundaries to 1..=100 (never 'top 0%')", () => {
    expect(fmtLocalWinTopPct(100)).toBe("Top 1% of your verified wins");
    expect(fmtLocalWinTopPct(0)).toBe("Top 100% of your verified wins");
  });
});

describe("fmtLocalWinPercentile (Expert view §2 — the true percentile, unrounded)", () => {
  it("shows nothing when there's no rankable percentile yet (same guards as the bucketed form)", () => {
    expect(fmtLocalWinPercentile(null)).toBeNull();
    expect(fmtLocalWinPercentile(undefined)).toBeNull();
    expect(fmtLocalWinPercentile(NaN)).toBeNull();
    expect(fmtLocalWinPercentile(Infinity)).toBeNull();
  });

  it("renders the raw percentile at 1 decimal — no clamping, no bucketing", () => {
    expect(fmtLocalWinPercentile(87.5)).toBe(
      "Percentile 87.5 of your verified wins (top 12.5%)",
    );
    expect(fmtLocalWinPercentile(50)).toBe("Percentile 50.0 of your verified wins (top 50.0%)");
    // The boundaries stay honest raw values (fmtLocalWinTopPct clamps these to 1/100).
    expect(fmtLocalWinPercentile(100)).toBe("Percentile 100.0 of your verified wins (top 0.0%)");
    expect(fmtLocalWinPercentile(0)).toBe("Percentile 0.0 of your verified wins (top 100.0%)");
  });
});

describe("benchmarkAttribution — the Test verdict's claim, read off the Machine Model (#452)", () => {
  const window = { baseline_at: "2026-07-01T10:00:00Z", latest_at: "2026-07-02T10:00:00Z" };
  const WIRE = wire as unknown as MachineModel;
  function fact<T>(value: T | null): Fact<T> {
    return { value, class: "recorded-historically", source: "test", freshness: "stamped" };
  }
  function row(id: string, appliedAt: string | null, onThisRig: boolean | null = true): CompyChangeFact {
    return {
      id,
      title: id,
      applied_at: fact(appliedAt),
      status: fact("applied"),
      still_active: fact(true),
      rolled_back_at: fact<string>(null),
      on_this_rig: fact(onThisRig),
      reversible: fact(true),
    };
  }
  function modelWith(rows: CompyChangeFact[], totalRecorded = rows.length): MachineModel {
    const compy_changes = { ...WIRE.compy_changes, total_recorded: totalRecorded, changes: rows };
    delete compy_changes.ledger_unreadable;
    return { ...WIRE, compy_changes };
  }
  const titles = (a: ReturnType<typeof benchmarkAttribution>) =>
    a.kind === "counted" ? a.credited.map((c) => c.title) : a.kind;

  it("model not read yet → pending; read failed → unknown; ledger unreadable → unknown", () => {
    expect(benchmarkAttribution(window, undefined, false)).toEqual({ kind: "pending" });
    expect(benchmarkAttribution(window, null, false)).toEqual({ kind: "unknown" });
    const unreadable = modelWith([]);
    unreadable.compy_changes.ledger_unreadable = "locked";
    expect(benchmarkAttribution(window, unreadable, false)).toEqual({ kind: "unknown" });
  });

  it("credits exactly the changesBetweenRuns window: after the baseline, no later than the latest run", () => {
    const m = modelWith([
      row("before", "2026-07-01T09:00:00Z"),
      row("at-baseline", "2026-07-01T10:00:00Z"),
      row("inside", "2026-07-01T12:00:00Z"),
      row("at-latest", "2026-07-02T10:00:00Z"),
      row("after", "2026-07-02T11:00:00Z"),
      row("undated", null),
    ]);
    expect(titles(benchmarkAttribution(window, m, false))).toEqual(["inside", "at-latest"]);
  });

  it("a row the ledger places on another PC is never credited — counted in otherRig instead", () => {
    const a = benchmarkAttribution(
      window,
      modelWith([row("here", "2026-07-01T12:00:00Z", true), row("elsewhere", "2026-07-01T13:00:00Z", false)]),
      false,
    );
    expect(titles(a)).toEqual(["here"]);
    expect(a).toMatchObject({ otherRig: 1, rigUnknown: 0 });
  });

  it("a row whose PC is unknown is credited AND counted in rigUnknown", () => {
    const a = benchmarkAttribution(window, modelWith([row("maybe", "2026-07-01T12:00:00Z", null)]), false);
    expect(titles(a)).toEqual(["maybe"]);
    expect(a).toMatchObject({ otherRig: 0, rigUnknown: 1 });
  });

  // #599: status was ignored, so a change undone after the runs still read as part of the setup.
  it("a credited row the ledger says was rolled back stays credited, and is marked rolled back", () => {
    const undone: CompyChangeFact = {
      ...row("undone", "2026-07-01T12:00:00Z"),
      status: fact("rolled_back"),
      still_active: fact<boolean>(null),
      rolled_back_at: fact("2026-07-03T09:00:00Z"),
    };
    const a = benchmarkAttribution(window, modelWith([undone, row("kept", "2026-07-01T13:00:00Z")]), false);
    expect(a.kind === "counted" && a.credited).toEqual([
      { id: "undone", title: "undone", rolledBack: true },
      { id: "kept", title: "kept", rolledBack: false },
    ]);
  });

  it("the shipped wire fixture's rolled-back row is marked from its real status field", () => {
    // chg-2 in the fixture is rolled_back with an unknown PC — credited, rigUnknown, and rolled back.
    const a = benchmarkAttribution(
      { baseline_at: "2026-07-05T00:00:00Z", latest_at: "2026-07-05T23:00:00Z" },
      WIRE,
      false,
    );
    expect(a.kind === "counted" && a.credited).toEqual([
      { id: "chg-2", title: "Turn on hardware-accelerated GPU scheduling", rolledBack: true },
    ]);
  });

  it("a ledger known incomplete withdraws only the EMPTY claim — a named row is still named", () => {
    expect(benchmarkAttribution(window, modelWith([]), true)).toEqual({ kind: "unknown" });
    expect(benchmarkAttribution(window, modelWith([row("x", "2026-07-01T13:00:00Z", false)]), true)).toEqual({ kind: "unknown" });
    expect(titles(benchmarkAttribution(window, modelWith([row("named", "2026-07-01T12:00:00Z")]), true))).toEqual(["named"]);
  });

  it("no window → nothing credited, and no floor claim either", () => {
    const m = modelWith([row("x", "2026-07-01T12:00:00Z")], 40);
    expect(benchmarkAttribution({ baseline_at: null, latest_at: window.latest_at }, m, false)).toMatchObject({
      kind: "counted",
      credited: [],
      truncated: false,
    });
  });

  it("truncated only when rows were cut AND every listed row is newer than the baseline", () => {
    const inside = row("inside", "2026-07-01T12:00:00Z");
    // Cut, and the oldest listed row is inside the window: older rows could be too.
    expect(benchmarkAttribution(window, modelWith([inside], 40), false)).toMatchObject({
      truncated: true,
      listed: 1,
      totalRecorded: 40,
    });
    // Cut, but a listed row predates the baseline: the cut rows are older still, so none is missing.
    expect(
      benchmarkAttribution(window, modelWith([inside, row("old", "2026-06-01T12:00:00Z")], 40), false),
    ).toMatchObject({ truncated: false });
    // Nothing cut.
    expect(benchmarkAttribution(window, modelWith([inside]), false)).toMatchObject({ truncated: false });
  });
});
