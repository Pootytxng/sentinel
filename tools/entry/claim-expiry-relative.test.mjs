// Guard: a claim whose expiry is a bare term ("12 hours") expires that long after it was POSTED.
// Read without the posting time it parsed as null, which is "never expired": the claim on #313,
// posted 2026-09-01T23:56Z with "12 hours", refused every writer whose scope touched its one file for
// as long as nobody hand-retired it. Both readers hold the posting time; both must pass it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { claimExpiry } from "./claim.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(HERE, rel), "utf8");
const POSTED = "2026-09-01T23:56:20Z";

describe("claimExpiry — a bare term counts from the posting time", () => {
  it("reads the #313 spelling against its posting time, and every common variant", () => {
    expect(claimExpiry("12 hours", { anchor: POSTED }).toISOString()).toBe("2026-09-02T11:56:20.000Z");
    expect(claimExpiry("12h", { anchor: POSTED }).toISOString()).toBe("2026-09-02T11:56:20.000Z");
    expect(claimExpiry("~12 hrs", { anchor: POSTED }).toISOString()).toBe("2026-09-02T11:56:20.000Z");
    expect(claimExpiry("(6 hour alarm)", { anchor: POSTED }).toISOString()).toBe("2026-09-02T05:56:20.000Z");
    expect(claimExpiry("2 days", { anchor: POSTED }).toISOString()).toBe("2026-09-03T23:56:20.000Z");
    expect(claimExpiry("1.5 h", { anchor: new Date(POSTED) }).toISOString()).toBe("2026-09-02T01:26:20.000Z");
  });

  it("without a posting time a bare term stays unreadable, which is live — never assumed past", () => {
    expect(claimExpiry("12 hours")).toBeNull();
    expect(claimExpiry("12 hours", { anchor: null })).toBeNull();
    expect(claimExpiry("12 hours", { anchor: "not a time" })).toBeNull();
    expect(claimExpiry("soon", { anchor: POSTED })).toBeNull();
    expect(claimExpiry("", { anchor: POSTED })).toBeNull();
  });

  it("an absolute spelling wins over the anchor, exactly as before", () => {
    expect(claimExpiry("2026-09-02T04:55Z (12 hours)", { anchor: POSTED }).toISOString()).toBe("2026-09-02T04:55:00.000Z");
    expect(claimExpiry("2026-09-03", { anchor: POSTED }).toISOString()).toBe("2026-09-03T23:59:59.000Z");
  });

  it("both readers pass the posting time", () => {
    for (const rel of ["gather.mjs", "preflight.mjs"]) {
      const src = read(rel);
      const calls = src.match(/claimExpiry\([^;]*\)/g) ?? [];
      expect(calls.length, `${rel} calls claimExpiry`).toBeGreaterThan(0);
      for (const call of calls) expect(call, `${rel}: ${call}`).toMatch(/anchor:\s*\w+\.postedAt/);
    }
  });
});
