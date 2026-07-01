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
  GPU_SCOPE_KEY,
  GPU_SCOPES,
  DEFAULT_GPU_SCOPE,
  GPU_SCOPE_META,
  isGpuScope,
  readGpuScope,
  writeGpuScope,
  gpuScopeMeta,
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

describe("GPU profile scope store", () => {
  it("defaults to global when nothing is saved", () => {
    expect(readGpuScope()).toBe(DEFAULT_GPU_SCOPE);
    expect(DEFAULT_GPU_SCOPE).toBe("global");
  });

  it("round-trips every known scope through localStorage", () => {
    for (const s of GPU_SCOPES) {
      writeGpuScope(s);
      expect(localStorage.getItem(GPU_SCOPE_KEY)).toBe(s);
      expect(readGpuScope()).toBe(s);
    }
  });

  it("falls back to default on an unknown/legacy stored value", () => {
    localStorage.setItem(GPU_SCOPE_KEY, "per-rig");
    expect(readGpuScope()).toBe(DEFAULT_GPU_SCOPE);
  });

  it("isGpuScope recognizes exactly the known scopes and nothing else", () => {
    for (const s of GPU_SCOPES) expect(isGpuScope(s)).toBe(true);
    expect(isGpuScope("per-rig")).toBe(false);
    expect(isGpuScope("")).toBe(false);
    expect(isGpuScope(null)).toBe(false);
    expect(isGpuScope(42)).toBe(false);
  });

  it("readGpuScope never throws when getItem throws — yields the default", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("The operation is insecure.", "SecurityError");
    });
    expect(() => readGpuScope()).not.toThrow();
    expect(readGpuScope()).toBe(DEFAULT_GPU_SCOPE);
  });

  it("writeGpuScope never throws when setItem throws — selection just doesn't persist", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("QuotaExceededError", "QuotaExceededError");
    });
    expect(() => writeGpuScope("per-game")).not.toThrow();
  });

  it("provides metadata for every scope with a non-empty label and blurb", () => {
    for (const s of GPU_SCOPES) {
      const m = gpuScopeMeta(s);
      expect(m.id).toBe(s);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.blurb.length).toBeGreaterThan(0);
      expect(GPU_SCOPE_META[s]).toBe(m);
    }
  });
});
