import { describe, it, expect } from "vitest";
import { REC_MUTATIONS, recMutation } from "./rec-mutations";
import type { RecMutation } from "./rec-mutations";

// Type guard mirroring the RecMutation contract: required `changes`/`reverts`
// strings, optional boolean `elevated`/`restart`.
const isRecMutation = (m: unknown): m is RecMutation => {
  if (typeof m !== "object" || m === null) return false;
  const r = m as Record<string, unknown>;
  if (typeof r.changes !== "string") return false;
  if (typeof r.reverts !== "string") return false;
  if (r.elevated !== undefined && typeof r.elevated !== "boolean") return false;
  if (r.restart !== undefined && typeof r.restart !== "boolean") return false;
  return true;
};

describe("recMutation", () => {
  it("returns the matching entry for a known id (identity with REC_MUTATIONS)", () => {
    expect(recMutation("game-mode")).toBe(REC_MUTATIONS["game-mode"]);
  });

  it("returns null for an unknown id", () => {
    expect(recMutation("not-a-real-rec")).toBeNull();
  });

  it("returns null for an empty-string id", () => {
    expect(recMutation("")).toBeNull();
  });

  // FINDING (reality, not a fix): recMutation uses `REC_MUTATIONS[id] ?? null`
  // on a plain object literal, so inherited Object.prototype keys resolve to the
  // prototype member (which is non-null) INSTEAD of null. We assert the actual
  // behavior here; this is a latent quirk, not a behavior the tests should mask.
  // No production rec id collides with a prototype name, so it is harmless today,
  // but a hardened lookup would use Object.hasOwn / a null-prototype map.
  it("resolves inherited Object.prototype keys to the prototype member (current behavior)", () => {
    expect(recMutation("toString")).toBe(Object.prototype.toString);
    expect(recMutation("hasOwnProperty")).toBe(Object.prototype.hasOwnProperty);
  });
});

describe("REC_MUTATIONS", () => {
  it("has at least one entry", () => {
    expect(Object.keys(REC_MUTATIONS).length).toBeGreaterThan(0);
  });

  it("every key is a non-empty string", () => {
    for (const key of Object.keys(REC_MUTATIONS)) {
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it("every entry conforms to the RecMutation type", () => {
    for (const [key, entry] of Object.entries(REC_MUTATIONS)) {
      expect(isRecMutation(entry), `entry "${key}" should match RecMutation`).toBe(true);
    }
  });

  it("every entry has non-empty changes and reverts copy", () => {
    for (const [key, entry] of Object.entries(REC_MUTATIONS)) {
      expect(entry.changes.length, `changes for "${key}"`).toBeGreaterThan(0);
      expect(entry.reverts.length, `reverts for "${key}"`).toBeGreaterThan(0);
    }
  });

  // Specific known entries, asserted against the imported data (never retyping
  // the user-facing copy as literal fixtures — doctrine guards scan test files).
  it("'game-mode' is non-elevated with no restart (per the data)", () => {
    const m = REC_MUTATIONS["game-mode"];
    expect(m).toBeDefined();
    expect(m.elevated).toBeUndefined();
    expect(m.restart).toBeUndefined();
    // Removed 2026-08-03: this line read `expect(m.changes).toBe(REC_MUTATIONS["game-mode"].changes)`
    // where `m` IS `REC_MUTATIONS["game-mode"]` — algebraically `a === a`, true no matter what
    // `changes` ever held. Non-emptiness is already covered for every entry by the loop above, so
    // the line added no coverage in either direction. The two assertions above are the real subject
    // of this test (non-elevated, no restart), and they can fail.
  });

  it("'hags-enable' is both elevated and restart-required (per the data)", () => {
    const m = REC_MUTATIONS["hags-enable"];
    expect(m).toBeDefined();
    expect(m.elevated).toBe(true);
    expect(m.restart).toBe(true);
  });

  it("'windows-search-disable' is elevated and not restart-required (per the data)", () => {
    const m = REC_MUTATIONS["windows-search-disable"];
    expect(m).toBeDefined();
    expect(m.elevated).toBe(true);
    expect(m.restart).toBeUndefined();
  });
});

describe("recMutation / REC_MUTATIONS consistency", () => {
  it("for every key, recMutation returns that same entry by reference", () => {
    for (const key of Object.keys(REC_MUTATIONS)) {
      expect(recMutation(key)).toBe(REC_MUTATIONS[key]);
    }
  });
});
