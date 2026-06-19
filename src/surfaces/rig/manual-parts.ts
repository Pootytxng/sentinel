import { useCallback, useEffect, useState } from "react";
import type { Vec3, RigPartKind } from "./rig-parts";

// User-added parts — the manual fallback for hardware Compy can't read in software (PSU, cooler
// model, an extra drive…). Stored per-rig in localStorage. ALWAYS rendered + labelled "user-added"
// (distinct from detected) so the honesty line never blurs: detected = measured, manual = you told us.

export type ManualKind = "psu" | "cooler" | "storage" | "other";
export interface ManualPart {
  id: string;
  kind: ManualKind;
  name: string;
  note?: string;
}

export const MANUAL_KINDS: { value: ManualKind; label: string }[] = [
  { value: "psu", label: "Power supply" },
  { value: "cooler", label: "CPU cooler" },
  { value: "storage", label: "Drive" },
  { value: "other", label: "Other" },
];

const KEY = "compy_rig_manual_parts";

function load(): ManualPart[] {
  try {
    const v = localStorage.getItem(KEY);
    const parsed = v ? JSON.parse(v) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function useManualParts() {
  const [parts, setParts] = useState<ManualPart[]>(load);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(parts));
    } catch {
      /* storage unavailable — session-only is fine */
    }
  }, [parts]);
  const add = useCallback(
    (p: Omit<ManualPart, "id">) =>
      setParts((prev) => [...prev, { ...p, id: `m-${Date.now()}-${prev.length}` }]),
    [],
  );
  const remove = useCallback((id: string) => setParts((prev) => prev.filter((p) => p.id !== id)), []);
  return { parts, add, remove };
}

// The holographic geometry to reuse for a manual kind, and where to place it (mirrors the ghost
// slots so a user-added PSU/cooler lands where you'd expect; "other"/extra items stack on the right).
export function manualGeom(kind: ManualKind): RigPartKind {
  switch (kind) {
    case "psu":
      return "psu";
    case "cooler":
      return "cooler";
    case "storage":
      return "storage";
    default:
      return "cpu";
  }
}

export function manualPlacement(
  kind: ManualKind,
  index: number,
): { assembled: Vec3; exploded: Vec3; rotation: Vec3 } {
  switch (kind) {
    case "psu":
      return { assembled: [0.1, -1.85, -0.25], exploded: [0.4, -3.1, 0.7], rotation: [0, -0.4, 0] };
    case "cooler":
      return { assembled: [0.05, 1.15, -0.16], exploded: [0.3, 3.3, 0.7], rotation: [0.4, 0, 0.2] };
    case "storage":
      return {
        assembled: [-0.55, -0.85, -0.6],
        exploded: [-3.1, -1.4, 0.9],
        rotation: [0, 0.6, 0.5],
      };
    default:
      return {
        assembled: [1.3, -0.6 - index * 0.5, 0.2],
        exploded: [3.2, -0.6 - index * 0.6, 0.9],
        rotation: [0, -0.5, 0],
      };
  }
}
