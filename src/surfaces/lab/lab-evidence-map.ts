// The readings side of the Lab's Rig Evidence Map (owner verdict, 2026-07-29).
//
// `lab-deck-data.ts` answers "which part of this machine does the thing I'm looking at touch?".
// This module answers the second half: "and what does that part read RIGHT NOW?" — using only the
// hardware snapshot the app already holds. No new IPC, no new command, no probe of its own.
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

import type { HardwareInfo } from "../../App";
import { fmtGB, fmtGHz } from "../hardware-format";
import type { LabSubsystem } from "./lab-deck-data";

/** Stable ids — the surface turns these into words via i18n, so no copy lives in this module. */
export type LabReadingKey = "cores" | "clock" | "vram" | "driver" | "memory" | "storage" | "refresh";

/** A reading is either a plain stated fact, or a proportion with a denominator worth seeing.
 *  `pct` is 0..1 and is only ever a real ratio of two real numbers. */
export type LabReading =
  | { kind: "fact"; key: LabReadingKey; value: string }
  | { kind: "gauge"; key: LabReadingKey; value: string; den: string; pct: number };

/** The volume the storage recommendations are actually about: Windows' system drive. Falls back to
 *  the first reported disk rather than inventing a mount point, and to nothing if there are none. */
function systemVolume(hw: HardwareInfo): HardwareInfo["disks"][number] | null {
  return hw.disks.find((d) => /^C/i.test(d.mount_point)) ?? hw.disks[0] ?? null;
}

const ratio = (part: number, whole: number) => Math.min(1, Math.max(0, whole > 0 ? part / whole : 0));

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
      // The FIRST reported GPU, matching what the hologram highlights (`gpu-0`). Driver version is
      // here because half the GPU catalog is driver-side: it is the thing being changed.
      const gpu = hw.gpus[0];
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
      // The display path has no modelled rig part (rigKindForSubsystem → null), but it does have a
      // real reading, and current-vs-max refresh is exactly what `monitor-max-refresh` moves.
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
