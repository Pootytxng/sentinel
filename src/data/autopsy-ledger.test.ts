import { describe, it, expect, beforeEach } from "vitest";
import {
  AUTOPSY_SCHEMA_VERSION,
  autopsyStats,
  migrateLedger,
  readAutopsyLedger,
  recordAutopsy,
  type AutopsyLedgerEntry,
} from "./autopsy-ledger";
import type { AutopsyResult } from "./knowledge-autopsy";

// Build a synthetic AutopsyResult with just the fields the ledger reads.
function res(
  real: number,
  placebo: number,
  risky: number,
  unknown: number,
  scamFlags = 0,
): AutopsyResult {
  return { truncated: false, hits: [], grade: { real, placebo, risky, unknown }, scamFlags };
}

const LEDGER_KEY = "compy_autopsy_ledger_v1";

beforeEach(() => {
  localStorage.clear();
});

describe("autopsyStats", () => {
  it("is all-zero / null for an empty ledger (no fabricated record)", () => {
    const s = autopsyStats([]);
    expect(s.count).toBe(0);
    expect(s.gradedTweaks).toBe(0);
    expect(s.realPct).toBe(0);
    expect(s.placeboPct).toBe(0);
    expect(s.riskyPct).toBe(0);
    expect(s.lastAt).toBeNull();
  });

  it("computes percentages over RECOGNIZED tweaks only (unknown excluded from the split)", () => {
    const entries: AutopsyLedgerEntry[] = [
      { at: 10, real: 3, placebo: 1, risky: 1, unknown: 2, scamFlags: 1 },
    ];
    const s = autopsyStats(entries);
    expect(s.count).toBe(1);
    expect(s.gradedTweaks).toBe(5); // 3 + 1 + 1 (unknown is NOT a verdict)
    expect(s.realPct).toBe(60);
    expect(s.placeboPct).toBe(20);
    expect(s.riskyPct).toBe(20);
    expect(s.unknown).toBe(2);
    expect(s.scamFlags).toBe(1);
    expect(s.lastAt).toBe(10);
  });

  it("aggregates across multiple gradings and reports the latest timestamp", () => {
    const entries: AutopsyLedgerEntry[] = [
      { at: 100, real: 1, placebo: 0, risky: 1, unknown: 0, scamFlags: 0 },
      { at: 300, real: 1, placebo: 1, risky: 0, unknown: 3, scamFlags: 2 },
      { at: 200, real: 0, placebo: 0, risky: 0, unknown: 1, scamFlags: 0 },
    ];
    const s = autopsyStats(entries);
    expect(s.count).toBe(3);
    expect(s.real).toBe(2);
    expect(s.placebo).toBe(1);
    expect(s.risky).toBe(1);
    expect(s.unknown).toBe(4);
    expect(s.scamFlags).toBe(2);
    expect(s.gradedTweaks).toBe(4);
    expect(s.realPct).toBe(50);
    expect(s.lastAt).toBe(300); // max, not last-in-array
  });

  it("never divides by zero when only unknowns were recognized", () => {
    const s = autopsyStats([{ at: 1, real: 0, placebo: 0, risky: 0, unknown: 5, scamFlags: 0 }]);
    expect(s.gradedTweaks).toBe(0);
    expect(s.realPct).toBe(0);
    expect(s.unknown).toBe(5);
  });
});

describe("recordAutopsy", () => {
  it("appends a compact summary and persists it (round-trips through localStorage)", () => {
    recordAutopsy(res(2, 1, 0, 1, 1), 1000);
    const led = readAutopsyLedger();
    expect(led).toHaveLength(1);
    expect(led[0]).toEqual({ at: 1000, real: 2, placebo: 1, risky: 0, unknown: 1, scamFlags: 1 });
  });

  it("stores ONLY verdict counts — never any pasted text or hits (privacy)", () => {
    recordAutopsy(res(1, 0, 0, 0, 0), 1);
    const raw = localStorage.getItem(LEDGER_KEY) ?? "";
    expect(raw).not.toContain("hits");
    expect(raw).not.toContain("truncated");
    // Entries live inside the versioned envelope now; each entry still carries ONLY verdict counts.
    expect(Object.keys(JSON.parse(raw).entries[0]).sort()).toEqual(
      ["at", "placebo", "real", "risky", "scamFlags", "unknown"].sort(),
    );
  });

  it("does NOT record an autopsy that recognized nothing (no blank-run pollution)", () => {
    const led = recordAutopsy(res(0, 0, 0, 0, 0), 1);
    expect(led).toHaveLength(0);
    expect(readAutopsyLedger()).toHaveLength(0);
  });

  it("records when only an unknown OR only a scam flag was found (still a real grading)", () => {
    recordAutopsy(res(0, 0, 0, 1, 0), 1); // a recognized-but-unmatched line
    recordAutopsy(res(0, 0, 0, 0, 1), 2); // a snake-oil trick flagged
    expect(readAutopsyLedger()).toHaveLength(2);
  });

  it("caps the ledger at 100 entries (FIFO — newest kept)", () => {
    for (let i = 0; i < 105; i++) recordAutopsy(res(1, 0, 0, 0, 0), i);
    const led = readAutopsyLedger();
    expect(led).toHaveLength(100);
    expect(led[0].at).toBe(5); // first 5 rolled off
    expect(led[led.length - 1].at).toBe(104);
  });
});

describe("readAutopsyLedger", () => {
  it("returns [] when absent, non-array, or corrupt JSON (never throws)", () => {
    expect(readAutopsyLedger()).toEqual([]);
    localStorage.setItem(LEDGER_KEY, "not json{");
    expect(readAutopsyLedger()).toEqual([]);
    localStorage.setItem(LEDGER_KEY, '{"not":"array"}');
    expect(readAutopsyLedger()).toEqual([]);
  });

  it("filters out malformed entries, keeping the valid ones", () => {
    localStorage.setItem(
      LEDGER_KEY,
      JSON.stringify([
        { at: 1, real: 1, placebo: 0, risky: 0, unknown: 0, scamFlags: 0 }, // valid
        { at: "nope", real: 1, placebo: 0, risky: 0, unknown: 0, scamFlags: 0 }, // bad at
        { real: 1 }, // missing fields
        null,
      ]),
    );
    const led = readAutopsyLedger();
    expect(led).toHaveLength(1);
    expect(led[0].at).toBe(1);
  });
});

// Schema versioning / migration (A3). The persisted form is a versioned ENVELOPE so a future change to
// AutopsyLedgerEntry's shape can migrate old localStorage data forward instead of silently dropping it.
// Older builds wrote a BARE ARRAY (no envelope) — that legacy form must still be read losslessly.
describe("autopsy ledger schema versioning / migration", () => {
  const valid: AutopsyLedgerEntry = { at: 1, real: 1, placebo: 0, risky: 0, unknown: 0, scamFlags: 0 };

  it("exposes a positive integer schema version", () => {
    expect(Number.isInteger(AUTOPSY_SCHEMA_VERSION)).toBe(true);
    expect(AUTOPSY_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("new writes persist a versioned envelope { v, entries }, not a bare array", () => {
    recordAutopsy(res(2, 1, 0, 0, 0), 5);
    const stored = JSON.parse(localStorage.getItem(LEDGER_KEY) ?? "null");
    expect(Array.isArray(stored)).toBe(false); // no longer a bare array
    expect(stored.v).toBe(AUTOPSY_SCHEMA_VERSION);
    expect(Array.isArray(stored.entries)).toBe(true);
    expect(stored.entries[0]).toMatchObject({ at: 5, real: 2, placebo: 1 });
  });

  it("migrates a legacy bare array (pre-envelope) forward on read", () => {
    localStorage.setItem(LEDGER_KEY, JSON.stringify([valid, { at: 2, real: 0, placebo: 0, risky: 1, unknown: 0, scamFlags: 0 }]));
    const led = readAutopsyLedger();
    expect(led).toHaveLength(2);
    expect(led[0]).toEqual(valid);
  });

  it("upgrades the stored form to the envelope after the next record (legacy → versioned)", () => {
    localStorage.setItem(LEDGER_KEY, JSON.stringify([valid])); // legacy bare array on disk
    recordAutopsy(res(0, 1, 0, 0, 0), 9); // appends; read-migrate-write upgrades the on-disk shape
    const stored = JSON.parse(localStorage.getItem(LEDGER_KEY) ?? "null");
    expect(stored.v).toBe(AUTOPSY_SCHEMA_VERSION);
    expect(stored.entries).toHaveLength(2); // the legacy entry was preserved, not dropped
    expect(stored.entries[0]).toEqual(valid);
  });

  describe("migrateLedger (pure)", () => {
    it("reads a legacy bare array, sanitizing malformed entries", () => {
      expect(migrateLedger([valid, { real: 1 }, null, 7])).toEqual([valid]);
    });

    it("reads a current versioned envelope", () => {
      expect(migrateLedger({ v: AUTOPSY_SCHEMA_VERSION, entries: [valid] })).toEqual([valid]);
    });

    it("reads entries DEFENSIVELY from a newer-than-current envelope (downgrade never nukes history)", () => {
      // A newer build wrote v=current+1; an older build must still surface the recognizable entries.
      expect(migrateLedger({ v: AUTOPSY_SCHEMA_VERSION + 1, entries: [valid] })).toEqual([valid]);
    });

    it("returns [] for an envelope whose entries are not an array", () => {
      expect(migrateLedger({ v: AUTOPSY_SCHEMA_VERSION, entries: "nope" })).toEqual([]);
    });

    it("returns [] for non-ledger shapes (object without v/entries, primitives, null)", () => {
      expect(migrateLedger({ not: "a ledger" })).toEqual([]);
      expect(migrateLedger(42)).toEqual([]);
      expect(migrateLedger(null)).toEqual([]);
      expect(migrateLedger(undefined)).toEqual([]);
    });

    it("is lossless + idempotent across a JSON round-trip of the envelope", () => {
      const entries = [valid, { at: 3, real: 0, placebo: 2, risky: 0, unknown: 1, scamFlags: 0 }];
      const envelope = { v: AUTOPSY_SCHEMA_VERSION, entries };
      const once = migrateLedger(JSON.parse(JSON.stringify(envelope)));
      expect(once).toEqual(entries);
      // re-wrapping the migrated output and migrating again yields the same entries
      expect(migrateLedger({ v: AUTOPSY_SCHEMA_VERSION, entries: once })).toEqual(entries);
    });
  });
});
