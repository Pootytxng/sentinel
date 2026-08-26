import { describe, it, expect } from "vitest";
import type { AppliedChange, Recommendation } from "../types";
import {
  activeChanges,
  pickFirstWinChange,
  shouldOfferFirstWin,
  verifyChangeHeld,
} from "./first-win-data";

const change = (over: Partial<AppliedChange>): AppliedChange => ({
  id: "c1",
  rec_id: "game-mode",
  rec_title: "Game Mode",
  applied_at: "2026-08-26T01:00:00Z",
  snapshot: null,
  status: "applied",
  is_still_active: true,
  ...over,
});

const rec = (over: Partial<Recommendation>): Recommendation => ({
  id: "game-mode",
  title: "Game Mode",
  category: "system",
  severity: "safe",
  description: "",
  impact: "",
  downside: null,
  applies_to: "",
  currently_applied: true,
  provenance: "verified",
  ...over,
});

describe("first-win eligibility", () => {
  it("says nothing on a machine that has never been changed", () => {
    expect(shouldOfferFirstWin([], false)).toBe(false);
    expect(pickFirstWinChange([])).toBeNull();
  });

  it("does not fire off a rolled-back entry — which is exactly what the trust demo leaves behind", () => {
    // TrustMoment applies and then rolls back, so a rig that has only watched the demo has ledger
    // rows but nothing live. Firing here would follow through on a change the user never made.
    const demo = [
      change({ id: "d1", status: "rolled_back", is_still_active: false, rolled_back_at: "2026-08-26T01:00:05Z" }),
    ];
    expect(shouldOfferFirstWin(demo, false)).toBe(false);
  });

  it("drops a ledger row the machine no longer carries, even while its status still reads applied", () => {
    // `status` is what was written at apply time; `is_still_active` is the ledger's live belief.
    // Something turned the setting back outside Compy — there is no win here to follow through on.
    expect(activeChanges([change({ is_still_active: false })])).toEqual([]);
  });

  it("fires once a real change is live, and never again once seen", () => {
    expect(shouldOfferFirstWin([change({})], false)).toBe(true);
    expect(shouldOfferFirstWin([change({})], true)).toBe(false);
  });

  it("picks the newest live change, not the first row in the array", () => {
    const picked = pickFirstWinChange([
      change({ id: "old", rec_title: "Old", applied_at: "2026-08-20T10:00:00Z" }),
      change({ id: "new", rec_title: "New", applied_at: "2026-08-26T09:00:00Z" }),
      change({ id: "mid", rec_title: "Mid", applied_at: "2026-08-24T10:00:00Z" }),
    ]);
    expect(picked?.id).toBe("new");
  });
});

describe("first-win verification — Compy's memory against a fresh look at the machine", () => {
  it("HELD when a fresh read agrees the change is on", () => {
    expect(verifyChangeHeld([rec({ currently_applied: true })], "game-mode")).toBe("held");
  });

  it("REVERTED when the fresh read disagrees — a finding, not something to soften away", () => {
    expect(verifyChangeHeld([rec({ currently_applied: false })], "game-mode")).toBe("reverted");
  });

  it("UNREADABLE rather than a guess when the setting is not in the fresh read at all", () => {
    expect(verifyChangeHeld([rec({ id: "something-else" })], "game-mode")).toBe("unreadable");
    expect(verifyChangeHeld([], "game-mode")).toBe("unreadable");
  });

  it("UNREADABLE when the scan itself has not answered — a null list is not evidence of anything", () => {
    // The failure this pins: treating "no data yet" as "not applied" would accuse the user's PC of
    // reverting a change every time the card rendered before the scan came back.
    expect(verifyChangeHeld(null, "game-mode")).toBe("unreadable");
  });
});
