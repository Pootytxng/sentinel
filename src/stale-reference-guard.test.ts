import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// bug -> guard (2026-06-20). After the classic-surface retirement, user-facing copy kept naming
// standalone tabs that no longer exist ("Startup tab", "Latency tab", "Optimize" — owner/audit-caught).
// Current rooms: Home / Check / Monitor / Tune / Blackbook / Advanced. This guard forbids the Blackbook
// data copy from naming a RETIRED standalone tab, so the class can't recur.
//
// Matches only "<Retired> tab" — NOT "<Retired> section" (Benchmark/Latency/Diagnostics still exist as
// CARDS inside Advanced), NOT "Optimize Drives" (a real Windows tool), and NOT current rooms.

// The Blackbook data sources. Add new src/data/*.json here when one is introduced.
const DATA_FILES = [
  "guides.json",
  "walkthroughs.json",
  "tricks.json",
  "tuning-guides.json",
  "terms.json",
  "tweaks.json",
];

const RETIRED_TAB =
  /\b(Optimize|Readiness|Priorities|Sessions|Monitoring|Benchmark|Latency|Diagnostics|Garage|Overview|Startup) tab\b/g;

describe("no stale references to retired tabs (Blackbook data copy)", () => {
  for (const file of DATA_FILES) {
    it(`${file} names no retired tab`, () => {
      const text = readFileSync(join("src", "data", file), "utf8");
      const hits = text.match(RETIRED_TAB) || [];
      expect(hits).toEqual([]);
    });
  }
});
