import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — same pattern as sweep-guard.test.ts.)

// Doctrine voice guard (baptism spec 2026-06-12 §A.2; voice law RECEIPTS_DOCTRINE.md §5).
// The worst RETIRED defensive/self-gag phrases are grep-banned from app source so the old voice
// can't regrow: confident, measured, tailored — never fabricating — replaced them on 2026-06-12.
// If this fails: rewrite the line in doctrine voice (quote the measurement, celebrate the win);
// never re-ship the apology.
const RETIRED_PHRASES = [
  "nothing to sell you here", // the live-caught trigger (Check/FirstCheck collapsed-green heads)
  "probably fine", // "your PC is probably fine"-class hedging
  "probably already fine",
  "already where it should be", // the shy win — doctrine celebrates a measured clean instead
  "nothing worth fixing today", // win states now say what was MEASURED, not what isn't worth doing
];

describe("doctrine voice guard: retired defensive phrases stay retired", () => {
  it("no retired phrase appears in src/ app code (this guard excluded)", () => {
    const files = (readdirSync("src", { recursive: true }) as string[]).filter(
      (f) => /\.(tsx?|css|json)$/.test(f) && !f.endsWith("voice-guard.test.ts"),
    );
    const offenders: string[] = [];
    for (const rel of files) {
      const text = readFileSync(join("src", rel), "utf8").toLowerCase();
      for (const phrase of RETIRED_PHRASES) {
        if (text.includes(phrase)) offenders.push(`${rel}: "${phrase}"`);
      }
    }
    expect(offenders, `retired defensive voice found:\n${offenders.join("\n")}`).toEqual([]);
  });
});
