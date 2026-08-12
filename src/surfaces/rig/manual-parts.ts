import { useCallback, useEffect, useState } from "react";
import type { TFunction } from "i18next";
import type { Vec3, RigPartKind } from "./rig-parts";

// Same-document sync between hook instances (the Lab mounts the add-a-part form in its own chrome
// while the chromeless RigViewer draws the hologram — two instances of this hook must see one list,
// or a part added in the Lab would not appear in the model until remount). localStorage 'storage'
// events do NOT fire in the same document, so instances broadcast over a window CustomEvent.
// Receivers bail out on reference equality, which terminates the echo after one hop.
const SYNC_EVENT = "compy:rig-manual-parts-changed";

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

// Language-aware DISPLAY accessor for a manual kind's label — MANUAL_KINDS above stays the frozen
// English source of truth (its `.value`s are still enumerated directly for the kind list / form
// options); components render text through this instead of reading `.label` off MANUAL_KINDS.
export function manualKindLabel(kind: ManualKind, t?: TFunction): string {
  const fallback = MANUAL_KINDS.find((k) => k.value === kind)?.label ?? kind;
  if (!t) return fallback;
  return t(`gaming.rigViewer.manualKinds.${kind}`, { defaultValue: fallback });
}

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
  // Receive: another instance in this document changed the list. Reference-equality bailout stops
  // the echo (our own broadcast comes back with the array we already hold).
  useEffect(() => {
    const onSync = (e: Event) => {
      const next = (e as CustomEvent<ManualPart[]>).detail;
      if (Array.isArray(next)) setParts((prev) => (prev === next ? prev : next));
    };
    window.addEventListener(SYNC_EVENT, onSync);
    return () => window.removeEventListener(SYNC_EVENT, onSync);
  }, []);
  // Persist + broadcast: runs post-commit on every real change (including the initial mount, which
  // harmlessly converges all instances onto the newest ref — content is identical).
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(parts));
    } catch {
      /* storage unavailable — session-only is fine */
    }
    window.dispatchEvent(new CustomEvent(SYNC_EVENT, { detail: parts }));
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
