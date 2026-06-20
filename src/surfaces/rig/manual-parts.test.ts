import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import {
  MANUAL_KINDS,
  manualGeom,
  manualPlacement,
  useManualParts,
  type ManualKind,
} from "./manual-parts";

const KEY = "compy_rig_manual_parts";
const ALL_KINDS: ManualKind[] = ["psu", "cooler", "storage", "other"];

describe("MANUAL_KINDS", () => {
  it("lists exactly the four expected kinds, in order, each with value + label", () => {
    expect(MANUAL_KINDS).toEqual([
      { value: "psu", label: "Power supply" },
      { value: "cooler", label: "CPU cooler" },
      { value: "storage", label: "Drive" },
      { value: "other", label: "Other" },
    ]);
  });

  it("has a unique value for every entry", () => {
    const values = MANUAL_KINDS.map((k) => k.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("gives every entry a non-empty human label", () => {
    for (const k of MANUAL_KINDS) {
      expect(typeof k.label).toBe("string");
      expect(k.label.length).toBeGreaterThan(0);
    }
  });

  it("covers the full ManualKind union (values match the canonical kind list)", () => {
    expect(MANUAL_KINDS.map((k) => k.value).sort()).toEqual([...ALL_KINDS].sort());
  });
});

describe("manualGeom", () => {
  it("maps psu/cooler/storage to their own geometry kind", () => {
    expect(manualGeom("psu")).toBe("psu");
    expect(manualGeom("cooler")).toBe("cooler");
    expect(manualGeom("storage")).toBe("storage");
  });

  it("falls back to 'cpu' geometry for 'other'", () => {
    expect(manualGeom("other")).toBe("cpu");
  });

  it("returns a value for every ManualKind", () => {
    for (const kind of ALL_KINDS) {
      expect(typeof manualGeom(kind)).toBe("string");
      expect(manualGeom(kind).length).toBeGreaterThan(0);
    }
  });
});

describe("manualPlacement", () => {
  it("returns the exact assembled/exploded/rotation vectors for psu", () => {
    expect(manualPlacement("psu", 0)).toEqual({
      assembled: [0.1, -1.85, -0.25],
      exploded: [0.4, -3.1, 0.7],
      rotation: [0, -0.4, 0],
    });
  });

  it("returns the exact assembled/exploded/rotation vectors for cooler", () => {
    expect(manualPlacement("cooler", 0)).toEqual({
      assembled: [0.05, 1.15, -0.16],
      exploded: [0.3, 3.3, 0.7],
      rotation: [0.4, 0, 0.2],
    });
  });

  it("returns the exact assembled/exploded/rotation vectors for storage", () => {
    expect(manualPlacement("storage", 0)).toEqual({
      assembled: [-0.55, -0.85, -0.6],
      exploded: [-3.1, -1.4, 0.9],
      rotation: [0, 0.6, 0.5],
    });
  });

  it("each placement has the three Vec3 fields, all length-3 numeric tuples", () => {
    for (const kind of ALL_KINDS) {
      const p = manualPlacement(kind, 0);
      for (const field of ["assembled", "exploded", "rotation"] as const) {
        const vec = p[field];
        expect(Array.isArray(vec)).toBe(true);
        expect(vec).toHaveLength(3);
        for (const n of vec) expect(typeof n).toBe("number");
      }
    }
  });

  it("fixed kinds (psu/cooler/storage) ignore the index arg", () => {
    for (const kind of ["psu", "cooler", "storage"] as const) {
      expect(manualPlacement(kind, 5)).toEqual(manualPlacement(kind, 0));
    }
  });

  it("'other' stacks down the Y axis as the index grows (assembled + exploded)", () => {
    const a0 = manualPlacement("other", 0);
    const a1 = manualPlacement("other", 1);
    // index only shifts Y; X and Z are fixed.
    expect(a0.assembled).toEqual([1.3, -0.6, 0.2]);
    expect(a1.assembled).toEqual([1.3, -0.6 - 0.5, 0.2]);
    expect(a0.exploded).toEqual([3.2, -0.6, 0.9]);
    expect(a1.exploded).toEqual([3.2, -0.6 - 0.6, 0.9]);
    // rotation is index-independent for 'other'.
    expect(a0.rotation).toEqual([0, -0.5, 0]);
    expect(a1.rotation).toEqual(a0.rotation);
  });

  it("'other' yields a distinct placement per index", () => {
    expect(manualPlacement("other", 0)).not.toEqual(manualPlacement("other", 1));
    expect(manualPlacement("other", 1)).not.toEqual(manualPlacement("other", 2));
  });

  it("the four kinds produce four distinct placements (at the same index)", () => {
    const placements = ALL_KINDS.map((k) => JSON.stringify(manualPlacement(k, 0)));
    expect(new Set(placements).size).toBe(ALL_KINDS.length);
  });
});

describe("useManualParts (localStorage round-trip)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("starts empty when localStorage is unset", () => {
    const { result } = renderHook(() => useManualParts());
    expect(result.current.parts).toEqual([]);
  });

  it("add() appends a part (with a generated id) and persists it to localStorage", () => {
    const { result } = renderHook(() => useManualParts());
    act(() => {
      result.current.add({ kind: "psu", name: "Seasonic 750" });
    });
    expect(result.current.parts).toHaveLength(1);
    const part = result.current.parts[0];
    expect(part.kind).toBe("psu");
    expect(part.name).toBe("Seasonic 750");
    expect(typeof part.id).toBe("string");
    expect(part.id.length).toBeGreaterThan(0);

    const stored = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].kind).toBe("psu");
    expect(stored[0].name).toBe("Seasonic 750");
    expect(stored[0].id).toBe(part.id);
  });

  it("add() assigns unique ids across multiple parts", () => {
    const { result } = renderHook(() => useManualParts());
    act(() => {
      result.current.add({ kind: "cooler", name: "Tower cooler" });
      result.current.add({ kind: "storage", name: "Spare drive" });
    });
    expect(result.current.parts).toHaveLength(2);
    expect(result.current.parts[0].id).not.toBe(result.current.parts[1].id);
  });

  it("remove() drops the matching id and persists the removal", () => {
    const { result } = renderHook(() => useManualParts());
    act(() => {
      result.current.add({ kind: "psu", name: "Unit A" });
      result.current.add({ kind: "other", name: "Unit B" });
    });
    const removeId = result.current.parts[0].id;
    const keepId = result.current.parts[1].id;
    act(() => {
      result.current.remove(removeId);
    });
    expect(result.current.parts).toHaveLength(1);
    expect(result.current.parts[0].id).toBe(keepId);

    const stored = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].id).toBe(keepId);
  });

  it("loads pre-existing parts from localStorage on mount", () => {
    const seeded = [{ id: "m-seed-0", kind: "storage", name: "Existing drive" }];
    localStorage.setItem(KEY, JSON.stringify(seeded));
    const { result } = renderHook(() => useManualParts());
    expect(result.current.parts).toEqual(seeded);
  });

  it("treats malformed (non-array) stored JSON as empty", () => {
    localStorage.setItem(KEY, JSON.stringify({ not: "an array" }));
    const { result } = renderHook(() => useManualParts());
    expect(result.current.parts).toEqual([]);
  });

  it("treats unparseable stored JSON as empty", () => {
    localStorage.setItem(KEY, "{not json");
    const { result } = renderHook(() => useManualParts());
    expect(result.current.parts).toEqual([]);
  });

  it("carries an optional note through the round-trip", () => {
    const { result } = renderHook(() => useManualParts());
    act(() => {
      result.current.add({ kind: "other", name: "Capture card", note: "PCIe slot 3" });
    });
    expect(result.current.parts[0].note).toBe("PCIe slot 3");
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    expect(stored[0].note).toBe("PCIe slot 3");
  });
});
