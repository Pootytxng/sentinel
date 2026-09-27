import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lsGet, lsSet } from "./safe-storage";

const KEY = "compy_safe_storage_test_key";

describe("safe-storage", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("lsGet returns null for a key that was never stored", () => {
    expect(lsGet(KEY)).toBeNull();
  });

  it("lsSet then lsGet round-trips the stored string", () => {
    lsSet(KEY, "dark");
    expect(lsGet(KEY)).toBe("dark");
    expect(localStorage.getItem(KEY)).toBe("dark");
  });

  it("lsSet overwrites an existing value", () => {
    lsSet(KEY, "first");
    lsSet(KEY, "second");
    expect(lsGet(KEY)).toBe("second");
  });

  it("lsGet preserves an empty string rather than coercing it to null", () => {
    lsSet(KEY, "");
    expect(lsGet(KEY)).toBe("");
  });

  it("lsGet returns null (does not throw) when getItem throws a SecurityError", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => lsGet(KEY)).not.toThrow();
    expect(lsGet(KEY)).toBeNull();
    expect(spy).toHaveBeenCalledWith(KEY);
  });

  it("lsSet swallows a setItem throw (quota exceeded / disabled store)", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => lsSet(KEY, "value")).not.toThrow();
    expect(lsSet(KEY, "value")).toBeUndefined();
    expect(spy).toHaveBeenCalledWith(KEY, "value");
  });

  it("a failed lsSet leaves no value behind for lsGet", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    lsSet(KEY, "value");
    vi.restoreAllMocks();
    expect(lsGet(KEY)).toBeNull();
  });

  it("lsGet recovers once storage stops throwing", () => {
    lsSet(KEY, "kept");
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("transient");
    });
    expect(lsGet(KEY)).toBeNull();
    spy.mockRestore();
    expect(lsGet(KEY)).toBe("kept");
  });
});
