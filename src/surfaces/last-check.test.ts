import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { TFunction } from "i18next";
import { LAST_CHECK_KEY, recordLastCheck, readLastCheck, formatCheckAge } from "./last-check";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = 1_800_000_000_000;

// Echo t: returns "key|n" so assertions can see which key + interpolation value was chosen.
const echoT = vi.fn((key: string, opts?: { n?: number }) =>
  opts && opts.n !== undefined ? `${key}|${opts.n}` : key,
) as unknown as TFunction;

const age = (ms: number, t?: TFunction) => formatCheckAge(NOW - ms, NOW, t);

describe("last-check storage", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    localStorage.clear();
  });

  it("uses the versioned storage key", () => {
    expect(LAST_CHECK_KEY).toBe("compy_last_check_v1");
  });

  it("readLastCheck returns null when nothing is stored", () => {
    expect(readLastCheck()).toBeNull();
  });

  it("recordLastCheck stamps Date.now() and round-trips through readLastCheck", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    recordLastCheck({ total: 12, green: 7, advisory: 1, unread: 1, fixCount: 3 });
    expect(JSON.parse(localStorage.getItem(LAST_CHECK_KEY) as string)).toEqual({
      total: 12,
      green: 7,
      advisory: 1,
      unread: 1,
      fixCount: 3,
      at: NOW,
    });
    expect(readLastCheck()).toEqual({ at: NOW, total: 12, green: 7, advisory: 1, unread: 1, fixCount: 3 });
  });

  it("readLastCheck strips unknown extra fields", () => {
    localStorage.setItem(
      LAST_CHECK_KEY,
      JSON.stringify({ at: 1, total: 2, green: 1, advisory: 0, unread: 0, fixCount: 1, stale: "extra" }),
    );
    expect(readLastCheck()).toEqual({ at: 1, total: 2, green: 1, advisory: 0, unread: 0, fixCount: 1 });
  });

  // Desk review 2026-11-03: a record from before the split counted advisory checks in `green`, so the
  // band printed "all 16 looked good" over two checks Compy doesn't grade. It is not read back.
  it("readLastCheck drops a record written before the advisory/unread split", () => {
    localStorage.setItem(LAST_CHECK_KEY, JSON.stringify({ at: 1, total: 16, green: 16, fixCount: 0 }));
    expect(readLastCheck()).toBeNull();
  });

  it("readLastCheck rejects malformed JSON and wrong-shaped records", () => {
    const bad = [
      "{not json",
      "null",
      "42",
      '"string"',
      "[]",
      JSON.stringify({ total: 2, green: 1, fixCount: 1 }),
      JSON.stringify({ at: "1", total: 2, green: 1, fixCount: 1 }),
      JSON.stringify({ at: 1, total: 2, green: null, fixCount: 1 }),
      JSON.stringify({ at: 1, total: 2, green: 1 }),
    ];
    for (const raw of bad) {
      localStorage.setItem(LAST_CHECK_KEY, raw);
      expect(readLastCheck(), raw).toBeNull();
    }
  });

  it("readLastCheck returns null when getItem throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(() => readLastCheck()).not.toThrow();
    expect(readLastCheck()).toBeNull();
  });

  it("recordLastCheck swallows a setItem throw", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => recordLastCheck({ total: 1, green: 1, advisory: 0, unread: 0, fixCount: 0 })).not.toThrow();
    vi.restoreAllMocks();
    expect(readLastCheck()).toBeNull();
  });
});

describe("formatCheckAge (English fallback, no t)", () => {
  it.each([
    [0, "just now"],
    [MIN - 1, "just now"],
    [-5 * MIN, "just now"],
    [MIN, "1m ago"],
    [59 * MIN + 59_999, "59m ago"],
    [HOUR, "1h ago"],
    [23 * HOUR + 59 * MIN, "23h ago"],
    [DAY, "yesterday"],
    [2 * DAY - 1, "yesterday"],
    [2 * DAY, "2d ago"],
    [6 * DAY + 23 * HOUR, "6d ago"],
    [7 * DAY, "1w ago"],
    [13 * DAY, "1w ago"],
    [14 * DAY, "2w ago"],
    [70 * DAY, "10w ago"],
  ])("age %i ms -> %s", (ms, expected) => {
    expect(age(ms)).toBe(expected);
  });
});

describe("formatCheckAge (with t)", () => {
  afterEach(() => vi.mocked(echoT).mockClear());

  it("routes every bucket through the matching locale key with n", () => {
    expect(age(0, echoT)).toBe("optimize.rerunCheckBand.age.justNow");
    expect(age(5 * MIN, echoT)).toBe("optimize.rerunCheckBand.age.minutesAgo|5");
    expect(age(3 * HOUR, echoT)).toBe("optimize.rerunCheckBand.age.hoursAgo|3");
    expect(age(DAY, echoT)).toBe("optimize.rerunCheckBand.age.yesterday");
    expect(age(4 * DAY, echoT)).toBe("optimize.rerunCheckBand.age.daysAgo|4");
    expect(age(21 * DAY, echoT)).toBe("optimize.rerunCheckBand.age.weeksAgo|3");
  });

  it("passes English defaultValue templates so a missing key degrades to English", () => {
    age(5 * MIN, echoT);
    expect(echoT).toHaveBeenCalledWith("optimize.rerunCheckBand.age.minutesAgo", {
      defaultValue: "{{n}}m ago",
      n: 5,
    });
    age(0, echoT);
    expect(echoT).toHaveBeenCalledWith("optimize.rerunCheckBand.age.justNow", { defaultValue: "just now" });
  });
});
