// P9-gpu-fit-unknowns (ROADMAP Phase 9: "PSU capacity/connectors where knowable; physical/thermal
// constraints where knowable"; Exit: never a part in isolation). Under "GPU was the measured limiter",
// one line names what Compy cannot check before any card: the power supply's capacity and connectors,
// and the case's room and airflow. Software can't read a PSU, so it is never guessed: a power supply
// the user added (Test -> Add a part) is named as what they told Compy, never read as a capacity.
import type { ManualPart } from "./rig/manual-parts";

export type UpgradeFitLine =
  | { key: "optimize.check.upgradeFitGpuUnknown" }
  | { key: "optimize.check.upgradeFitGpuUserPsu"; name: string };

/** Pure: the fit line under an upgrade-path item, or null when the item has none. */
export function upgradeFitLine(kind: string, manualParts: readonly ManualPart[]): UpgradeFitLine | null {
  if (kind !== "gpu") return null;
  const psu = manualParts.find((p) => p.kind === "psu" && p.name.trim() !== "");
  return psu
    ? { key: "optimize.check.upgradeFitGpuUserPsu", name: psu.name.trim() }
    : { key: "optimize.check.upgradeFitGpuUnknown" };
}
