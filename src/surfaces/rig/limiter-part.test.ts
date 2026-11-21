// P7-rig-limiter: the #1 limiter → the part it is about, or "away from the hardware", or nothing.
// Pins the honesty rules (one part only when exactly one fits; ambiguous hardware → no claim) and a
// drift guard against priorities.rs, so a limiter id added in Rust must be classified here before
// the build is green. Fails on the code before this slice (no limiter-part module).
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { DIMMED_GLOW, LIMITER_AWAY, LIMITER_PART_KIND, hddPartIds, limiterFocus, rigGlow } from "./limiter-part";
import type { RigPartKind } from "./rig-parts";

const part = (id: string, kind: RigPartKind, name = id, detected = true, hdd = false) => ({ id, kind, name, detected, hdd });
const RIG = [part("board", "board"), part("cpu", "cpu"), part("gpu-0", "gpu"), part("ram", "ram")];

describe("limiterFocus", () => {
  it("points at the one spinning drive when the slow-install-drive limiter fires", () => {
    expect(
      limiterFocus("install-drive", [...RIG, part("disk-0", "storage", "Samsung 990 PRO"), part("disk-1", "storage", "WD Blue 2TB", true, true)]),
    ).toEqual({ kind: "part", partId: "disk-1", partName: "WD Blue 2TB" });
  });

  // Review r1 MUST-FIX 2: the only drive drawn is not therefore the drive the check is about.
  it("points at no drive when none drawn is an HDD (an SSD is not the slow drive), or two are", () => {
    expect(limiterFocus("install-drive", [...RIG, part("disk-0", "storage", "NVMe SSD")])).toBeNull();
    expect(limiterFocus("install-drive", [...RIG, part("vol-0", "storage", "Volume C:")])).toBeNull(); // no media type
    expect(
      limiterFocus("install-drive", [...RIG, part("disk-0", "storage", "A", true, true), part("disk-1", "storage", "B", true, true)]),
    ).toBeNull();
    expect(limiterFocus("install-drive", RIG)).toBeNull(); // no drive drawn at all
  });

  it("ignores a ghost (undetected) part when counting", () => {
    expect(
      limiterFocus("install-drive", [...RIG, part("disk-0", "storage", "HDD", true, true), part("ghost", "storage", "HDD", false, true)]),
    ).toMatchObject({ kind: "part", partId: "disk-0" });
  });

  it("hddPartIds reads each physical drive's own media type, keyed like buildRigParts", () => {
    expect([...hddPartIds([{ media_type: "SSD" }, { media_type: "HDD" }, { media_type: " hdd " }, { media_type: "Unspecified" }, {}])]).toEqual([
      "disk-1",
      "disk-2",
    ]);
    expect(hddPartIds(undefined).size).toBe(0);
    expect(hddPartIds(null).size).toBe(0);
  });

  it("a setting or software limiter points away from the parts", () => {
    for (const id of LIMITER_AWAY) expect(limiterFocus(id, RIG), id).toEqual({ kind: "away" });
  });

  it("an id this build doesn't know, or no limiter, leaves the rig alone", () => {
    expect(limiterFocus("disk", RIG)).toBeNull();
    expect(limiterFocus(null, RIG)).toBeNull();
    expect(limiterFocus(undefined, RIG)).toBeNull();
    expect(limiterFocus("", RIG)).toBeNull();
  });
});

describe("rigGlow", () => {
  it("is 1 for every part when not dimmed, exactly as before", () => {
    expect(rigGlow(false, "cpu", null, null)).toBe(1);
    expect(rigGlow(false, "cpu", "gpu-0", "ram")).toBe(1);
  });
  it("dims every part except the one the user points at", () => {
    expect(rigGlow(true, "cpu", null, null)).toBe(DIMMED_GLOW);
    expect(rigGlow(true, "cpu", "cpu", null)).toBe(1);
    expect(rigGlow(true, "cpu", null, "cpu")).toBe(1);
    expect(DIMMED_GLOW).toBeGreaterThan(0); // dim, never hidden
    expect(DIMMED_GLOW).toBeLessThan(1);
  });
});

// Drift guard: every id priorities.rs can put in `limiters` is classified here (part or away), and
// nothing here names an id priorities.rs cannot emit as a limiter.
describe("the table matches what priorities.rs can call a limiter", () => {
  const rs = readFileSync(join("src-tauri", "src", "priorities.rs"), "utf8");
  // Readiness rules that are not advisory: ("id", rank, Confidence::X, false, Basis::Y)
  const fromReadiness = [...rs.matchAll(/\("([a-z0-9-]+)",\s*\d+,\s*Confidence::\w+,\s*false,\s*Basis::\w+\)/g)].map((m) => m[1]);
  // Direct limiter pushes: Bucket::Limiter(n), PriorityItem { id: "..." }
  const fromPushes = [...rs.matchAll(/Bucket::Limiter\(\d+\),\s*PriorityItem\s*\{\s*id:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
  const emitted = new Set([...fromReadiness, ...fromPushes]);

  it("found the limiter ids (the parser still reads the file)", () => {
    expect(fromReadiness.length).toBeGreaterThanOrEqual(5);
    expect(fromPushes.length).toBeGreaterThanOrEqual(2);
  });

  it("every limiter id is classified", () => {
    const classified = new Set([...Object.keys(LIMITER_PART_KIND), ...LIMITER_AWAY]);
    expect([...emitted].filter((id) => !classified.has(id))).toEqual([]);
  });

  it("nothing classified here is an id priorities.rs never emits as a limiter", () => {
    const classified = [...Object.keys(LIMITER_PART_KIND), ...LIMITER_AWAY];
    expect(classified.filter((id) => !emitted.has(id))).toEqual([]);
  });
});
