import { describe, it, expect, vi, afterEach } from "vitest";
import {
  PROFILE_KEY,
  USE_PROFILES,
  DEFAULT_PROFILE,
  PROFILE_META,
  isUseProfile,
  readProfile,
  writeProfile,
  profileMeta,
} from "./profile-store";

afterEach(() => {
  vi.restoreAllMocks();
  try {
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

describe("profile-store", () => {
  it("defaults to the honest neutral profile when unset", () => {
    expect(readProfile()).toBe(DEFAULT_PROFILE);
    expect(DEFAULT_PROFILE).toBe("idle");
  });

  it("round-trips every known profile through localStorage", () => {
    for (const p of USE_PROFILES) {
      writeProfile(p);
      expect(localStorage.getItem(PROFILE_KEY)).toBe(p);
      expect(readProfile()).toBe(p);
    }
  });

  it("falls back to default on an unknown/legacy stored value", () => {
    localStorage.setItem(PROFILE_KEY, "gpu-overclock");
    expect(readProfile()).toBe(DEFAULT_PROFILE);
  });

  it("isUseProfile recognizes exactly the four profiles and nothing else", () => {
    for (const p of USE_PROFILES) expect(isUseProfile(p)).toBe(true);
    expect(isUseProfile("nonsense")).toBe(false);
    expect(isUseProfile("")).toBe(false);
    expect(isUseProfile(null)).toBe(false);
    expect(isUseProfile(42)).toBe(false);
  });

  it("never throws when localStorage.getItem throws — yields the default (no blank app)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(() => readProfile()).not.toThrow();
    expect(readProfile()).toBe(DEFAULT_PROFILE);
  });

  it("never throws when localStorage.setItem throws — selection just doesn't persist", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    expect(() => writeProfile("gaming")).not.toThrow();
  });

  it("provides metadata for every profile with a non-empty label and blurb", () => {
    for (const p of USE_PROFILES) {
      const m = profileMeta(p);
      expect(m.id).toBe(p);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.blurb.length).toBeGreaterThan(0);
      expect(PROFILE_META[p]).toBe(m);
    }
  });
});
