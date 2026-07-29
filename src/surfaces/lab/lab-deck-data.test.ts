// LAB DECK data guards — the IA layer of the decision-journey Lab (recovery items 12/13/15).
//
// Guard 1  CATALOG COVERAGE: every recommendation the Rust catalog can emit is placed in a user
//          goal DELIBERATELY, and every category it can emit has a named fallback. A new tweak
//          therefore cannot drift into a group by accident — adding one to recommendations.rs
//          fails this test until someone decides which goal it serves.
// Guard 2  Section 2 renders a group ONLY when real supported recs exist ("only show a group when
//          real supported recommendations exist" — never an empty shelf).
// Guard 3  Section 1 cannot disagree with Section 2: nextBestMove picks from the same live set the
//          fix rows use, respects dismissals/drift, and states its evidence honestly.
// Guard 4  Section 4 can never offer a door to a station this rig doesn't have.
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — @types/node is not a project dependency.)

import type { Priorities, Recommendation } from "../../types";
import type { LabStationKey } from "../lab-guided-data";
import {
  LAB_GOAL_ORDER,
  categoryGoal,
  explicitGoal,
  goalOf,
  groupByGoal,
  labProblems,
  nextBestMove,
} from "./lab-deck-data";

// ───────────────────────────── fixtures ─────────────────────────────

const rec = (over: Partial<Recommendation> & { id: string }): Recommendation => ({
  title: over.id,
  category: "Windows",
  severity: "safe",
  description: "d",
  impact: "i",
  downside: null,
  applies_to: "Currently: Off",
  currently_applied: false,
  provenance: "expected-impact",
  ...over,
});

const ALL_APPLIABLE = () => true;
const t = ((key: string) => key) as never; // labProblems only needs a key→string function

// ─────────────────── guard 1: the Rust catalog is fully placed ───────────────────

// Pair each `id: "…"` with the `category: "…"` that follows it inside the same struct literal.
// Lexical on purpose: this must fail on a NEW entry in recommendations.rs without anyone
// remembering to update a fixture.
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

describe("goal taxonomy covers the real catalog", () => {
  const catalog = rustCatalog();

  it("reads the catalog at all (the guard is wired to the Rust source, not a fixture)", () => {
    expect(catalog.length).toBeGreaterThanOrEqual(13);
    expect(catalog.map((c) => c.id)).toContain("power-ultimate");
  });

  it("every catalog id is placed in a goal DELIBERATELY — a new tweak must be decided, not defaulted", () => {
    const unplaced = catalog.filter((c) => explicitGoal(c.id) === null).map((c) => c.id);
    expect(unplaced).toEqual([]);
  });

  it("every catalog category has a named fallback, so nothing lands in stability by accident", () => {
    const unknown = [...new Set(catalog.map((c) => c.category))].filter(
      (c) => categoryGoal(c) === null,
    );
    expect(unknown).toEqual([]);
  });

  it("an unknown rec falls back to the group that promises least", () => {
    // A signed remote rule, or a tweak from a newer build than this frontend.
    expect(goalOf({ id: "not-in-any-map", category: "Something New" })).toBe("stability");
  });
});

// ─────────────────── guard 2: groups only exist when populated ───────────────────

describe("groupByGoal", () => {
  it("returns ONLY non-empty groups, in the owner's order", () => {
    const groups = groupByGoal([
      rec({ id: "reserved-storage-off", category: "Storage" }), // cleanup
      rec({ id: "gpu-prefer-discrete", category: "GPU" }), // fps
      rec({ id: "power-ultimate", category: "Power" }), // latency
    ]);
    expect(groups.map((g) => g.goal)).toEqual(["fps", "latency", "cleanup"]);
    expect(groups.every((g) => g.recs.length > 0)).toBe(true);
  });

  it("no recs → no groups at all (an empty shelf is never rendered)", () => {
    expect(groupByGoal([])).toEqual([]);
  });

  it("every rec lands in exactly one group — nothing is dropped, nothing is duplicated", () => {
    const recs = rustCatalog().map((c) => rec({ id: c.id, category: c.category }));
    const placed = groupByGoal(recs).flatMap((g) => g.recs.map((r) => r.id));
    expect(placed.sort()).toEqual(recs.map((r) => r.id).sort());
  });

  it("the order constant is the five goals the owner named", () => {
    expect(LAB_GOAL_ORDER).toEqual(["fps", "latency", "stability", "image", "cleanup"]);
  });
});

// ─────────────────── guard 3: your next best move ───────────────────

describe("nextBestMove", () => {
  it("says UNKNOWN before a scan — it never shows a confident empty room", () => {
    expect(nextBestMove({ recs: null, isAppliable: ALL_APPLIABLE })).toEqual({ state: "unknown" });
  });

  it("NONE when this rig genuinely had nothing to change", () => {
    expect(nextBestMove({ recs: [], isAppliable: ALL_APPLIABLE })).toEqual({ state: "none" });
  });

  it("ALL-CLEAR (with the count) when everything open is already applied", () => {
    const state = nextBestMove({
      recs: [rec({ id: "power-ultimate", currently_applied: true })],
      isAppliable: ALL_APPLIABLE,
    });
    expect(state).toEqual({ state: "all-clear", applied: 1 });
  });

  it("prefers the recommendation the check just carried, and says so", () => {
    const state = nextBestMove({
      recs: [rec({ id: "a" }), rec({ id: "b" })],
      isAppliable: ALL_APPLIABLE,
      carriedRecIds: ["b"],
    });
    expect(state.state).toBe("move");
    if (state.state !== "move") return;
    expect(state.move.rec.id).toBe("b");
    expect(state.move.evidence).toEqual({ from: "check" });
    expect(state.remaining).toBe(1);
  });

  it("otherwise prefers a MEASURED limiter, carrying its own reason and confidence untouched", () => {
    const priorities = {
      limiters: [
        { id: "l1", title: "T", reason: "Your GPU sat at 99% while frames dropped", linked: null, rec_ids: ["b"], confidence: "high", status: "limiter" },
      ],
      already_fine: [],
      not_worth_touching: [],
      session_hint: null,
      upgrade_path: null,
    } as unknown as Priorities;
    const state = nextBestMove({
      recs: [rec({ id: "a" }), rec({ id: "b" })],
      isAppliable: ALL_APPLIABLE,
      priorities,
    });
    expect(state.state).toBe("move");
    if (state.state !== "move") return;
    expect(state.move.rec.id).toBe("b");
    expect(state.move.evidence).toEqual({
      from: "limiter",
      reason: "Your GPU sat at 99% while frames dropped",
      confidence: "high",
    });
  });

  it("falls back to the catalog WITHOUT inventing a reason", () => {
    const state = nextBestMove({ recs: [rec({ id: "a" })], isAppliable: ALL_APPLIABLE });
    expect(state.state).toBe("move");
    if (state.state !== "move") return;
    expect(state.move.evidence).toEqual({ from: "catalog" });
    expect(state.remaining).toBe(0);
  });

  it("ranks the safe one-tap fixes ahead of the judgment calls", () => {
    const state = nextBestMove({
      recs: [rec({ id: "hard", severity: "advanced" }), rec({ id: "easy", severity: "safe" })],
      isAppliable: ALL_APPLIABLE,
    });
    expect(state.state === "move" && state.move.rec.id).toBe("easy");
  });

  it("never re-offers a rec the user declined (Not for me)", () => {
    const state = nextBestMove({
      recs: [rec({ id: "a" })],
      isAppliable: ALL_APPLIABLE,
      dismissedIds: new Set(["a"]),
    });
    expect(state).toEqual({ state: "none" });
  });

  it("never re-offers a DRIFTED rec — the restore row in Optimize owns that state (one mention)", () => {
    const state = nextBestMove({
      recs: [rec({ id: "a" })],
      isAppliable: ALL_APPLIABLE,
      revertedIds: new Set(["a"]),
      activeCount: 1,
    });
    expect(state).toEqual({ state: "all-clear", applied: 1 });
  });

  it("an ineligible rec is out of the denominator entirely — never a move, never a count", () => {
    const state = nextBestMove({
      recs: [rec({ id: "a", eligible: false })],
      isAppliable: ALL_APPLIABLE,
    });
    expect(state).toEqual({ state: "none" });
  });

  it("states canApply honestly: a guided-only rec is a move, but not a one-tap one", () => {
    const state = nextBestMove({
      recs: [rec({ id: "manual-only", severity: "moderate" })],
      isAppliable: () => false,
    });
    expect(state.state).toBe("move");
    if (state.state !== "move") return;
    expect(state.move.canApply).toBe(false);
  });
});

// ─────────────────── guard 4: problem doors are never dead ends ───────────────────

describe("labProblems", () => {
  const all = new Set<LabStationKey>(["benchmark", "latency", "tuning", "blackbox", "diagnostics"]);

  it("offers the six problems the owner named, in symptom order", () => {
    expect(labProblems(all, t).map((p) => p.key)).toEqual([
      "stutter",
      "unstableFps",
      "inputDelay",
      "crashes",
      "heat",
      "changed",
    ]);
  });

  it("drops any problem whose instrument this rig does not have (Tuning is AMD-only)", () => {
    const noTuning = new Set<LabStationKey>([...all].filter((s) => s !== "tuning"));
    const keys = labProblems(noTuning, t).map((p) => p.key);
    expect(keys).not.toContain("heat");
    expect(keys).toContain("stutter");
  });

  it("every row points at a station that is actually present", () => {
    for (const p of labProblems(all, t)) expect(all.has(p.station)).toBe(true);
  });

  it("no stations → no rows (a problem list with no answers is not shown)", () => {
    expect(labProblems(new Set<LabStationKey>(), t)).toEqual([]);
  });
});
