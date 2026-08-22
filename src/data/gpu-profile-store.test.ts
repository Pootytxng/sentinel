// GPU profile before/after delta — read-only, local-only, honesty-guarded. Tests the pure delta
// engine (the load-bearing logic) plus the corruption-proof storage layer.
import { describe, it, expect, beforeEach } from "vitest";
import {
  GPU_PROFILE_KEY,
  type GpuProfileSnapshot,
  readGpuProfiles,
  writeGpuProfileSlot,
  clearGpuProfiles,
  computeGpuProfileDelta,
  hasAnyChange,
  deltaSummary,
  liveGpuProfileSnapshot,
  gpuVendorLabel,
} from "./gpu-profile-store";

beforeEach(() => localStorage.clear());

const snap = (over: Partial<GpuProfileSnapshot> = {}): GpuProfileSnapshot => ({
  capturedAt: "2026-07-01T00:00:00Z",
  vendor: "AMD",
  model: "Radeon RX 9070 XT",
  driverVersion: "24.6.1",
  hagsEnabled: true,
  powerModeLabel: "Balanced",
  peakTempC: 72,
  ...over,
});

describe("gpu-profile-store · storage", () => {
  it("starts empty and round-trips a slot", () => {
    expect(readGpuProfiles()).toEqual({ before: null, after: null });
    const b = snap();
    writeGpuProfileSlot("before", b);
    expect(readGpuProfiles()).toEqual({ before: b, after: null });
    const a = snap({ peakTempC: 65 });
    writeGpuProfileSlot("after", a);
    expect(readGpuProfiles()).toEqual({ before: b, after: a });
  });

  it("clear wipes both slots", () => {
    writeGpuProfileSlot("before", snap());
    clearGpuProfiles();
    expect(readGpuProfiles()).toEqual({ before: null, after: null });
  });

  it("corrupt or foreign-shaped storage degrades to empty, never throws", () => {
    localStorage.setItem(GPU_PROFILE_KEY, "{not json");
    expect(readGpuProfiles()).toEqual({ before: null, after: null });
    // Foreign types coerce field-by-field; a snapshot with no capturedAt is discarded entirely.
    localStorage.setItem(
      GPU_PROFILE_KEY,
      JSON.stringify({ before: { vendor: 5 }, after: { capturedAt: "t", peakTempC: "hot" } }),
    );
    const p = readGpuProfiles();
    expect(p.before).toBeNull(); // no capturedAt → not a snapshot
    expect(p.after).toEqual({
      capturedAt: "t",
      vendor: null,
      model: null,
      driverVersion: null,
      hagsEnabled: null,
      powerModeLabel: null,
      peakTempC: null, // "hot" is not a finite number → null, never fabricated
    });
  });
});

describe("gpu-profile-store · delta engine", () => {
  it("marks unchanged fields 'same' and moved fields 'changed'", () => {
    const before = snap();
    const after = snap({ driverVersion: "24.7.1", peakTempC: 65 });
    const d = computeGpuProfileDelta(before, after);
    const by = Object.fromEntries(d.map((x) => [x.key, x]));
    expect(by.vendor.status).toBe("same");
    expect(by.model.status).toBe("same");
    expect(by.driverVersion.status).toBe("changed");
    expect(by.peakTempC.status).toBe("changed");
    expect(hasAnyChange(d)).toBe(true);
  });

  it("never invents a change from a missing read (unknown, not changed)", () => {
    // before knows the driver, after did not read it → unknown, not a fabricated change.
    const before = snap({ driverVersion: "24.6.1" });
    const after = snap({ driverVersion: null });
    const d = computeGpuProfileDelta(before, after);
    const drv = d.find((x) => x.key === "driverVersion")!;
    expect(drv.status).toBe("unknown");
    expect(drv.afterText).toBe("—");
  });

  it("a null snapshot yields all-unknown, never a crash", () => {
    const d = computeGpuProfileDelta(null, snap());
    expect(d.every((x) => x.status === "unknown")).toBe(true);
    expect(hasAnyChange(d)).toBe(false);
    expect(computeGpuProfileDelta(null, null).every((x) => x.status === "unknown")).toBe(true);
  });

  it("temp direction: down = cooler, up = warmer, flat = equal", () => {
    const cooler = computeGpuProfileDelta(snap({ peakTempC: 80 }), snap({ peakTempC: 68 }));
    const t1 = cooler.find((x) => x.key === "peakTempC")!;
    expect(t1.direction).toBe("down");
    expect(t1.numericDelta).toBe(-12);

    const warmer = computeGpuProfileDelta(snap({ peakTempC: 68 }), snap({ peakTempC: 80 }));
    expect(warmer.find((x) => x.key === "peakTempC")!.direction).toBe("up");

    const same = computeGpuProfileDelta(snap({ peakTempC: 70 }), snap({ peakTempC: 70 }));
    const t3 = same.find((x) => x.key === "peakTempC")!;
    expect(t3.direction).toBe("flat");
    expect(t3.status).toBe("same");
  });

  it("temp with a missing side has no numeric delta and 'none' direction", () => {
    const d = computeGpuProfileDelta(snap({ peakTempC: 70 }), snap({ peakTempC: null }));
    const t = d.find((x) => x.key === "peakTempC")!;
    expect(t.numericDelta).toBeNull();
    expect(t.direction).toBe("none");
    expect(t.status).toBe("unknown");
  });

  it("boolean HAGS formats On/Off and diffs correctly", () => {
    const d = computeGpuProfileDelta(snap({ hagsEnabled: false }), snap({ hagsEnabled: true }));
    const h = d.find((x) => x.key === "hagsEnabled")!;
    expect(h.beforeText).toBe("Off");
    expect(h.afterText).toBe("On");
    expect(h.status).toBe("changed");
  });

  it("formats temperature with units and dash for unread", () => {
    const d = computeGpuProfileDelta(snap({ peakTempC: 72 }), snap({ peakTempC: null }));
    const t = d.find((x) => x.key === "peakTempC")!;
    expect(t.beforeText).toBe("72 °C");
    expect(t.afterText).toBe("—");
  });
});

describe("gpu-profile-store · summary", () => {
  it("says 'no changes' when nothing moved", () => {
    expect(deltaSummary(computeGpuProfileDelta(snap(), snap()))).toBe(
      "No changes between these two snapshots.",
    );
  });

  it("counts changed settings and phrases a cooler temp honestly (no FPS claim)", () => {
    const s = deltaSummary(
      computeGpuProfileDelta(snap({ peakTempC: 80 }), snap({ driverVersion: "24.7.1", peakTempC: 68 })),
    );
    expect(s).toContain("2 settings changed");
    expect(s).toContain("peak temp 12 °C cooler");
    expect(s).not.toMatch(/fps|faster|performance|boost/i);
  });

  it("pluralizes a single change and reports a warmer temp", () => {
    const s = deltaSummary(computeGpuProfileDelta(snap({ peakTempC: 68 }), snap({ peakTempC: 75 })));
    expect(s).toContain("1 setting changed");
    expect(s).toContain("peak temp 7 °C warmer");
  });

  it("unknown-only diffs are reported as no changes (honesty: missing ≠ moved)", () => {
    expect(deltaSummary(computeGpuProfileDelta(null, snap()))).toBe(
      "No changes between these two snapshots.",
    );
  });
});

// C-14 (2026-08-22) — the live snapshot builder that finally connects this surface to a real rig.
// Every assertion here is an honesty assertion: the ONE thing that must never happen is a field
// reported as read when the machine never gave us one.
describe("liveGpuProfileSnapshot", () => {
  const AT = "2026-08-22T16:00:00.000Z";

  it("reads vendor, model and driver straight off the detected GPU", () => {
    const s = liveGpuProfileSnapshot(
      { name: "AMD Radeon RX 9070 XT", driver_version: "32.0.12033.1030" },
      [],
      AT,
    );
    expect(s).toMatchObject({
      capturedAt: AT,
      vendor: "AMD",
      model: "AMD Radeon RX 9070 XT",
      driverVersion: "32.0.12033.1030",
    });
  });

  it("never invents a vendor from an unrecognisable GPU name", () => {
    expect(gpuVendorLabel("Microsoft Basic Display Adapter")).toBeNull();
    expect(gpuVendorLabel("")).toBeNull();
    expect(gpuVendorLabel(null)).toBeNull();
    expect(liveGpuProfileSnapshot({ name: "Some Unknown Accelerator" }, [], AT).vendor).toBeNull();
  });

  it("recognises the three vendors from either the brand or the product line", () => {
    expect(gpuVendorLabel("NVIDIA GeForce RTX 3060 Ti")).toBe("NVIDIA");
    expect(gpuVendorLabel("GeForce GTX 1660")).toBe("NVIDIA");
    expect(gpuVendorLabel("Radeon RX 6600")).toBe("AMD");
    expect(gpuVendorLabel("Intel Arc A770")).toBe("Intel");
  });

  it("takes hagsEnabled from the hags-enable rec's real machine read", () => {
    const on = liveGpuProfileSnapshot({ name: "Radeon RX 9070 XT" }, [
      { id: "hags-enable", currently_applied: true },
    ], AT);
    expect(on.hagsEnabled).toBe(true);

    const off = liveGpuProfileSnapshot({ name: "Radeon RX 9070 XT" }, [
      { id: "hags-enable", currently_applied: false },
    ], AT);
    expect(off.hagsEnabled).toBe(false);
  });

  it("leaves hagsEnabled UNREAD (null) when the rec is absent or ineligible — never false", () => {
    expect(liveGpuProfileSnapshot({ name: "Radeon" }, [], AT).hagsEnabled).toBeNull();
    expect(liveGpuProfileSnapshot({ name: "Radeon" }, null, AT).hagsEnabled).toBeNull();
    expect(
      liveGpuProfileSnapshot({ name: "Radeon" }, [
        { id: "hags-enable", currently_applied: false, eligible: false },
      ], AT).hagsEnabled,
    ).toBeNull();
  });

  it("never reports a power mode or a peak temp, because neither is readable here", () => {
    const s = liveGpuProfileSnapshot({ name: "AMD Radeon RX 9070 XT" }, [
      { id: "hags-enable", currently_applied: true },
    ], AT);
    // LOCKED rule 6: AMD profile state is not user-mode readable. Peak temp belongs to a monitored
    // session the Lab does not hold. Both stay absent rather than defaulted.
    expect(s.powerModeLabel).toBeNull();
    expect(s.peakTempC).toBeNull();
  });

  it("degrades to an all-unread snapshot when no GPU was detected at all", () => {
    const s = liveGpuProfileSnapshot(null, [], AT);
    expect(s).toEqual({
      capturedAt: AT,
      vendor: null,
      model: null,
      driverVersion: null,
      hagsEnabled: null,
      powerModeLabel: null,
      peakTempC: null,
    });
  });

  it("produces a snapshot the delta engine reports as all-unknown, not as changes", () => {
    const a = liveGpuProfileSnapshot(null, [], AT);
    const b = liveGpuProfileSnapshot(null, [], "2026-08-22T17:00:00.000Z");
    const deltas = computeGpuProfileDelta(a, b);
    expect(hasAnyChange(deltas)).toBe(false);
  });
});
