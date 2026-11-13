// CR-ts-gpu-first: the Lab's GPU readings and Check's driver freshness read the card games run on
// (most VRAM, `primaryGpu`), never the first reported adapter (on a hybrid laptop the iGPU).
import { describe, expect, it } from "vitest";
import type { HardwareInfo } from "../App";
import { driverFreshness } from "./Check";
import { subsystemReadings } from "./lab-evidence-map";

const t = ((key: string, opts?: Record<string, unknown>) => `${key} ${JSON.stringify(opts ?? {})}`) as never;
const GB = 1024 ** 3;

describe("GPU readers on a hybrid rig", () => {
  it("the Lab shows the discrete card's VRAM and driver, not the iGPU's", () => {
    const hw = {
      gpus: [
        { name: "Intel(R) UHD Graphics", vram_bytes: 0.5 * GB, driver_version: "31.0.101.1" },
        { name: "NVIDIA GeForce RTX 4070", vram_bytes: 12 * GB, driver_version: "566.36" },
      ],
    } as unknown as HardwareInfo;
    const r = subsystemReadings("gpu", hw);
    expect(r).toContainEqual({ kind: "fact", key: "driver", value: "566.36" });
    expect(JSON.stringify(r)).not.toContain("31.0.101.1");
  });

  it("driver freshness judges the discrete card's driver date", () => {
    const igpu = { name: "Intel(R) UHD Graphics", driver_age_days: 20, vram_bytes: 0.5 * GB };
    const rtx = { name: "NVIDIA GeForce RTX 4070", driver_age_days: 400, vram_bytes: 12 * GB };
    expect(driverFreshness([igpu, rtx], t).tone).toBe("advisory");
    // The card's own date unreadable reads as unreadable, never as the iGPU's.
    expect(driverFreshness([igpu, { ...rtx, driver_age_days: null }], t).tone).toBe("skip");
    expect(driverFreshness([igpu], t).tone).toBe("pass");
  });
});
