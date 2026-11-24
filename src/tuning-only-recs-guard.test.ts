import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { layerOneRecs } from "./data/tuning-tools";
import { safeStackOf } from "./surfaces/lab/OptimizeStation";
import type { Recommendation } from "./types";

// D6 Nagle decision (owner, 2026-11-24): "Nagle tuning-only". nagle-disable is listed only in Test's Optimize
// switches (shown with the Tuning tools on). Every other surface App feeds the catalog to (Home's health check
// and trust loop, the interview's one-tap fast path, Live) gets layerOneRecs(recs). An EXISTING Nagle row keeps
// its undo and its "Turned off outside Compy" turn-on (pinned in lab/tuning-tools-off.test.tsx); the
// Something's-wrong card only re-applies existing rows (turnBackOn), so it has no fresh Nagle apply to gate.

const APP = readFileSync(join(__dirname, "App.tsx"), "utf8");

const rec = (id: string): Recommendation =>
  ({ id, title: id, severity: "safe", eligible: true, currently_applied: false }) as unknown as Recommendation;

describe("Nagle is tuning-layer only", () => {
  // Break check: in App.tsx change any HomeRoom/TrustMoment/MonitorV2 `recs={homeRecs}` back to `recs={recs}`
  // and the count below goes up.
  it("App hands the full catalog to exactly one surface: Test (LabGround)", () => {
    const full = APP.match(/recs=\{recs\}/g) ?? [];
    expect(full).toHaveLength(1);
    const i = APP.indexOf("recs={recs}");
    const lastTag = APP.lastIndexOf("<", i);
    expect(APP.slice(lastTag, lastTag + 12)).toMatch(/^<LabGround/);
    expect((APP.match(/recs=\{homeRecs( \?\? \[\])?\}/g) ?? []).length).toBeGreaterThanOrEqual(3);
    expect(APP).toMatch(/const homeRecs = useMemo\(\(\) => layerOneRecs\(recs\), \[recs\]\)/);
  });

  // Break check: empty TUNING_ONLY_REC_IDS and a safe Nagle rec joins the one-tap stack.
  it("the one-tap stack built from Home's recs never includes Nagle, even when it is safe and appliable", () => {
    const recs = [rec("game-mode"), rec("nagle-disable")];
    expect(safeStackOf(recs, () => true).map((r) => r.id)).toContain("nagle-disable");
    expect(safeStackOf(layerOneRecs(recs), () => true).map((r) => r.id)).toEqual(["game-mode"]);
  });
});
