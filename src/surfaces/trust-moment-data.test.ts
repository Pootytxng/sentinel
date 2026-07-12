import { describe, it, expect } from "vitest";
import { pickTrustDemoRec, shouldOfferTrustMoment, TRUST_DEMO_IDS } from "./trust-moment-data";
import type { Recommendation, AppliedChange } from "../types";

// Guards for the one-time "watch it work" trust loop (consumer-panel Phase 2). The demo must never
// run on anything but a whitelisted, safe, eligible, appliable, genuinely-OFF rec — and must never
// be offered to a rig that already has ledger history.

const rec = (over: Partial<Recommendation>): Recommendation =>
  ({
    id: "game-mode",
    title: "Enable Windows Game Mode",
    category: "gaming",
    severity: "safe",
    description: "",
    impact: "",
    downside: "",
    applies_to: "",
    currently_applied: false,
    provenance: "verified",
    eligible: true,
    ineligible_reason: null,
    ...over,
  }) as Recommendation;

const always = () => true;

describe("pickTrustDemoRec — the demo's honesty rails", () => {
  it("picks the first whitelisted rec that is safe, eligible, appliable, and OFF", () => {
    const r = pickTrustDemoRec([rec({})], always);
    expect(r?.id).toBe("game-mode");
  });

  it("respects whitelist preference order", () => {
    const r = pickTrustDemoRec(
      [rec({ id: "visual-effects" }), rec({ id: "game-bar-disable" })],
      always,
    );
    expect(r?.id).toBe("game-bar-disable");
  });

  it("never picks a rec that is already on (no fabricated before-state)", () => {
    expect(pickTrustDemoRec([rec({ currently_applied: true })], always)).toBeNull();
  });

  it("never picks non-safe, ineligible, non-appliable, or non-whitelisted recs", () => {
    expect(pickTrustDemoRec([rec({ severity: "moderate" })], always)).toBeNull();
    expect(pickTrustDemoRec([rec({ eligible: false })], always)).toBeNull();
    expect(pickTrustDemoRec([rec({})], () => false)).toBeNull();
    expect(pickTrustDemoRec([rec({ id: "nagle-disable" })], always)).toBeNull();
  });

  it("null recs (still loading) → null, never a placeholder", () => {
    expect(pickTrustDemoRec(null, always)).toBeNull();
  });

  it("every whitelisted id is an HKCU-only apply (list pinned — extending it means re-verifying no-UAC in actions.rs)", () => {
    expect([...TRUST_DEMO_IDS]).toEqual([
      "game-mode",
      "game-bar-disable",
      "visual-effects",
      "mouse-accel-off",
    ]);
  });
});

describe("shouldOfferTrustMoment — brand-new users only", () => {
  it("offered only when the ledger is empty and not already done/dismissed", () => {
    expect(shouldOfferTrustMoment([], false)).toBe(true);
    expect(shouldOfferTrustMoment([], true)).toBe(false);
    expect(shouldOfferTrustMoment([{ id: "x" } as AppliedChange], false)).toBe(false);
  });
});
