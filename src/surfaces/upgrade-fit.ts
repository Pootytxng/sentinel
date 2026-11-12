// P9-gpu-fit-unknowns (ROADMAP Phase 9: "PSU capacity/connectors where knowable; physical/thermal
// constraints where knowable"; Exit: never a part in isolation). Under "GPU was the measured limiter",
// one line names what Compy cannot check before any card: the power supply's capacity and connectors,
// and the case's room and airflow. Software can't read a PSU, so it is never guessed: a power supply
// the user added (Test -> Add a part) is named as what they told Compy, never read as a capacity.
// P9-ssd-fit-unknowns ("motherboard compatibility"): under "Games are on an HDD", the free M.2 slots,
// SATA ports and drive bays a new drive needs are not readable here either, so the line says so.
import type { ManualPart } from "./rig/manual-parts";

export type UpgradeFitLine =
  | { key: "optimize.check.upgradeFitGpuUnknown" }
  | { key: "optimize.check.upgradeFitGpuUserPsu"; name: string }
  | { key: "optimize.check.upgradeFitSsd" };

/** Pure: the fit line under an upgrade-path item, or null when the item has none. */
export function upgradeFitLine(kind: string, manualParts: readonly ManualPart[]): UpgradeFitLine | null {
  if (kind === "ssd") return { key: "optimize.check.upgradeFitSsd" };
  if (kind !== "gpu") return null;
  // Review r1 nit: the stored list is unchecked JSON, so a malformed entry is skipped, never a crash.
  // The first named power supply is the one said (the user normally adds one).
  const psu = manualParts.find((p) => p?.kind === "psu" && typeof p.name === "string" && p.name.trim() !== "");
  return psu
    ? { key: "optimize.check.upgradeFitGpuUserPsu", name: psu.name.trim() }
    : { key: "optimize.check.upgradeFitGpuUnknown" };
}
