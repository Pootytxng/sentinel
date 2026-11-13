// The readings side of the Lab's Rig Evidence Map (owner verdict, 2026-07-29).
//
// A rig part the user selects in the hologram maps to a subsystem, and this module answers "what
// does that subsystem read RIGHT NOW?" — using only the hardware snapshot the app already holds. No
// new IPC, no new command, no probe of its own.
//
// THE HONESTY RAILS, because a reading is a claim about the user's machine:
//   1. Every value below is formatted from a real field of the live `HardwareInfo`. There is no
//      placeholder, no sample number, and no "typical for your class of PC" filler.
//   2. A field that isn't there, is zero, or is blank produces NO reading — never a dash dressed up
//      as data and never a guess. An empty list is a legitimate, honest answer; the surface says so
//      in words.
//   3. `thermals`, `network`, `audio` and `system` return nothing ON PURPOSE. The hardware snapshot
//      carries no temperature and no audio device state, and no catalog recommendation routes to the
//      network, so any line here would be invented. See the per-case notes at each branch.
//   4. No grading, no verdict, no colour-by-threshold. The only audited thresholds in this app live
//      in `src/data/tuning-measure.ts` and none of them apply to these fields, so a reading is
//      stated, not scored.

import type { HardwareInfo } from "../App";
import { primaryGpu } from "../data/gpu-sensor";
import { fmtGB, fmtGHz } from "./hardware-format";
import type { RigPart, RigPartKind } from "./rig/rig-parts";

/** Functional subsystems readings are grouped by — a narrower, purpose-built taxonomy for this
 *  bounded slice (the full goal-taxonomy `LabSubsystem` from the Lab-recovery branch is not ported
 *  here; only the readings half of that concept). */
export type LabSubsystem =
  | "cpu"
  | "gpu"
  | "memory"
  | "storage"
  | "display"
  | "network"
  | "audio"
  | "thermals"
  | "system";

/** Stable ids — the surface turns these into words via i18n, so no copy lives in this module. */
export type LabReadingKey =
  | "cores"
  | "clock"
  | "vram"
  | "driver"
  | "memory"
  | "storage"
  | "capacity"
  | "refresh";

/** A reading is either a plain stated fact, or a proportion with a denominator worth seeing.
 *  `pct` is 0..1 and is only ever a real ratio of two real numbers. */
export type LabReading =
  | { kind: "fact"; key: LabReadingKey; value: string }
  | { kind: "gauge"; key: LabReadingKey; value: string; den: string; pct: number };

/** The one place a rig part becomes the subsystem whose readings it shows. Inverts the authoritative
 *  `rigKindForSubsystem` forward mapping (owner-verdict 2026-07-29): board and psu carry no single
 *  subsystem's evidence, so they read as `"system"` — neutral, never guessed. */
export function subsystemForRigPart(kind: RigPartKind): LabSubsystem {
  switch (kind) {
    case "cpu":
      return "cpu";
    case "gpu":
      return "gpu";
    case "ram":
      return "memory";
    case "storage":
      return "storage";
    case "cooler":
      return "thermals";
    case "board":
    case "psu":
      return "system";
  }
}

/** The volume the storage recommendations are actually about: Windows' system drive. Falls back to
 *  the first reported disk rather than inventing a mount point, and to nothing if there are none. */
function systemVolume(hw: HardwareInfo): HardwareInfo["disks"][number] | null {
  return hw.disks.find((d) => /^C/i.test(d.mount_point)) ?? hw.disks[0] ?? null;
}

const ratio = (part: number, whole: number) => Math.min(1, Math.max(0, whole > 0 ? part / whole : 0));

function indexedReadingSource<T>(id: string, prefix: string, sources: readonly T[]): T | null {
  const match = new RegExp(`^${prefix}-(\\d+)$`).exec(id);
  if (!match) return null;
  return sources[Number(match[1])] ?? null;
}

/** Readings for one exact selected rig part. GPU and storage fail closed when the id does not
 *  resolve to the same source `buildRigParts()` used for that part; falling back to adapter 0 or C:
 *  would put another component's measurement under the selected part's name. */
export function rigPartReadings(part: Pick<RigPart, "id" | "kind">, hw: HardwareInfo): LabReading[] {
  if (part.kind === "gpu") {
    const gpu = indexedReadingSource(part.id, "gpu", hw.gpus);
    if (!gpu) return [];
    const out: LabReading[] = [];
    if (gpu.vram_bytes > 0) out.push({ kind: "fact", key: "vram", value: fmtGB(gpu.vram_bytes) });
    if (gpu.driver_version.trim()) {
      out.push({ kind: "fact", key: "driver", value: gpu.driver_version.trim() });
    }
    return out;
  }

  if (part.kind === "storage") {
    const physical = indexedReadingSource(part.id, "disk", hw.physical_disks ?? []);
    if (physical) {
      return physical.size_bytes > 0
        ? [{ kind: "fact", key: "capacity", value: fmtGB(physical.size_bytes) }]
        : [];
    }

    const volume = indexedReadingSource(part.id, "vol", hw.disks ?? []);
    if (!volume || volume.total_bytes <= 0) return [];
    return [
      {
        kind: "gauge",
        key: "storage",
        value: fmtGB(volume.available_bytes),
        den: fmtGB(volume.total_bytes),
        pct: ratio(volume.available_bytes, volume.total_bytes),
      },
    ];
  }

  return subsystemReadings(subsystemForRigPart(part.kind), hw);
}

export function subsystemReadings(sub: LabSubsystem, hw: HardwareInfo): LabReading[] {
  const out: LabReading[] = [];

  switch (sub) {
    case "cpu": {
      // Cores/threads is the shape of the thing a scheduling or power change acts on, and the
      // reported frequency is the other half. Both come straight from the probe.
      if (hw.cpu_cores_physical > 0 && hw.cpu_cores_logical > 0) {
        out.push({
          kind: "fact",
          key: "cores",
          value: `${hw.cpu_cores_physical} · ${hw.cpu_cores_logical}`,
        });
      }
      if (hw.cpu_frequency_mhz > 0) {
        out.push({ kind: "fact", key: "clock", value: fmtGHz(hw.cpu_frequency_mhz) });
      }
      return out;
    }

    case "gpu": {
      // CR-ts-gpu-first: the card games run on (the most-VRAM GPU, `primaryGpu`), never the first
      // reported adapter (on a hybrid laptop the iGPU). Driver version is here because half the GPU
      // catalog is driver-side: it is the thing being changed.
      const gpu = primaryGpu(hw.gpus);
      if (!gpu) return out;
      if (gpu.vram_bytes > 0) out.push({ kind: "fact", key: "vram", value: fmtGB(gpu.vram_bytes) });
      if (gpu.driver_version.trim()) {
        out.push({ kind: "fact", key: "driver", value: gpu.driver_version.trim() });
      }
      return out;
    }

    case "memory": {
      // In-use of installed. Direction is named by the label, not left to the bar.
      if (hw.ram_total_bytes <= 0) return out;
      out.push({
        kind: "gauge",
        key: "memory",
        value: fmtGB(hw.ram_used_bytes),
        den: fmtGB(hw.ram_total_bytes),
        pct: ratio(hw.ram_used_bytes, hw.ram_total_bytes),
      });
      return out;
    }

    case "storage": {
      // FREE of total, not used-of-total: free space is the quantity every storage recommendation in
      // the catalog is about, so it is the number that belongs next to one.
      const vol = systemVolume(hw);
      if (!vol || vol.total_bytes <= 0) return out;
      out.push({
        kind: "gauge",
        key: "storage",
        value: fmtGB(vol.available_bytes),
        den: fmtGB(vol.total_bytes),
        pct: ratio(vol.available_bytes, vol.total_bytes),
      });
      return out;
    }

    case "display": {
      // The display path has no modelled rig part (subsystemForRigPart never returns "display"), but
      // it does have a real reading, and current-vs-max refresh is exactly what `monitor-max-refresh`
      // moves.
      const d = hw.display;
      if (!d || d.max_refresh_rate_hz <= 0 || d.current_refresh_rate_hz <= 0) return out;
      out.push({
        kind: "gauge",
        key: "refresh",
        value: `${d.current_refresh_rate_hz} Hz`,
        den: `${d.max_refresh_rate_hz} Hz`,
        pct: ratio(d.current_refresh_rate_hz, d.max_refresh_rate_hz),
      });
      return out;
    }

    // Deliberately empty — each for its own reason, and each says so honestly on screen:
    //   thermals  the hologram can highlight the cooler, but Compy ships no driver, so it has no
    //             temperature of its own to state here (LOCKED rule 1). A monitor's shared-memory
    //             reading is a different surface's evidence, not a hardware-snapshot field.
    //   network   nothing in the catalog routes here, so there is no recommendation for a NIC
    //             reading to stand next to.
    //   audio     the hardware snapshot carries no audio device state at all.
    //   system    system-wide by definition: there is no single part and no single number.
    case "thermals":
    case "network":
    case "audio":
    case "system":
      return out;
  }
}
