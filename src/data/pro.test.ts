import { describe, it, expect } from "vitest";
import { proStateFrom, showsProFeature } from "./pro";
import type { LicenseStatus } from "../types";

const status = (over: Partial<LicenseStatus>): LicenseStatus => ({
  tier: "free",
  valid: false,
  reason: "licensing not active",
  expires_at: null,
  ...over,
});

describe("Compy Pro gating plumbing", () => {
  it("is INERT while licensing is disarmed — armed false, Pro features render in full (nothing paywalled)", () => {
    const s = proStateFrom(status({ reason: "licensing not active" }));
    expect(s.armed).toBe(false);
    expect(s.isPro).toBe(false);
    expect(showsProFeature(s)).toBe(true); // free for everyone today
  });

  it("while still loading (no status), renders in full (never flashes a paywall)", () => {
    const s = proStateFrom(null);
    expect(s.ready).toBe(false);
    expect(showsProFeature(s)).toBe(true);
  });

  it("ARMED + free user → the gate locks (the only case that paywalls)", () => {
    const s = proStateFrom(status({ reason: "no license" }));
    expect(s.armed).toBe(true);
    expect(s.isPro).toBe(false);
    expect(showsProFeature(s)).toBe(false);
  });

  it("ARMED + valid Pro license → renders in full", () => {
    const s = proStateFrom(status({ reason: "active", valid: true, tier: "pro" }));
    expect(s.armed).toBe(true);
    expect(s.isPro).toBe(true);
    expect(showsProFeature(s)).toBe(true);
  });

  it("a valid but non-Pro tier is not Pro", () => {
    const s = proStateFrom(status({ reason: "active", valid: true, tier: "free" }));
    expect(s.isPro).toBe(false);
  });
});
