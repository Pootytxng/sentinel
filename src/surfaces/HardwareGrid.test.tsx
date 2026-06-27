import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { HardwareGrid } from "./HardwareGrid";
import type { HardwareInfo } from "../App";

// Pins the detection-layer surfacing in the shared hardware grid: the ACTIONABLE flag (RAM below
// rated → enable EXPO/XMP) appears only when it should, the honest "at rated" case makes NO claim,
// BIOS version+age renders, and a SMART concern is flagged while a healthy drive stays quiet.
// These are the visual-honesty invariants green tsc can't catch (a wrong threshold would silently
// mislabel a rig). Guard per the "bug becomes guard" rule.

function baseHw(overrides: Partial<HardwareInfo> = {}): HardwareInfo {
  return {
    cpu_brand: "Test CPU",
    cpu_cores_logical: 16,
    cpu_cores_physical: 8,
    cpu_frequency_mhz: 5100,
    ram_total_bytes: 32 * 1024 ** 3,
    ram_used_bytes: 12 * 1024 ** 3,
    swap_total_bytes: 0,
    os_name: "Windows",
    os_version: "11",
    kernel_version: "10.0.26200",
    hostname: "test-rig",
    disks: [],
    gpus: [],
    physical_disks: [],
    disk_health: [],
    display: null,
    memory_modules: [],
    windows_version: null,
    cpu_arch: null,
    network_adapters: [],
    has_wired_ethernet_port: false,
    bios_info: null,
    virtualization: null,
    usb: null,
    ...overrides,
  };
}

type MemMod = HardwareInfo["memory_modules"][number];
const mod = (over: Partial<MemMod> = {}): MemMod => ({
  capacity_bytes: 16 * 1024 ** 3,
  speed_mhz: 6000,
  rated_speed_mhz: 6000,
  type_name: "DDR5",
  manufacturer: "G.Skill",
  xmp_expo_status: "running_at_rated",
  ...over,
});

describe("HardwareGrid detection surfacing", () => {
  it("flags RAM running below rated with an actionable EXPO/XMP hint", () => {
    render(
      <HardwareGrid
        hw={baseHw({
          memory_modules: [
            mod({ speed_mhz: 4800, rated_speed_mhz: 6000, xmp_expo_status: "running_below_rated" }),
          ],
        })}
      />
    );
    // "EXPO/XMP" and "BIOS" are Term-wrapped links now (split text nodes), so assert on the flag
    // container's full text rather than a single text node.
    expect(
      screen.getByText(
        (_, el) =>
          el?.className === "detail-flag" &&
          /enable\s+EXPO\/XMP\s+in\s+BIOS\s+to reach/i.test(el.textContent ?? ""),
      ),
    ).toBeTruthy();
    expect(screen.getByText(/4800 of 6000 MT\/s/i)).toBeTruthy();
    // The actionable concepts are now in-place glossary links.
    expect(screen.getByRole("button", { name: "EXPO/XMP" })).toBeTruthy();
  });

  it("makes NO XMP claim when RAM runs at its rated speed", () => {
    render(<HardwareGrid hw={baseHw({ memory_modules: [mod({ xmp_expo_status: "running_at_rated" })] })} />);
    expect(screen.queryByText(/enable EXPO\/XMP/i)).toBeNull();
  });

  it("shows BIOS version + age in the System card", () => {
    render(
      <HardwareGrid
        hw={baseHw({
          bios_info: {
            manufacturer: "American Megatrends",
            version: "1.A95",
            release_date: "2026-03-15",
            release_date_age_days: 98,
          },
        })}
      />
    );
    expect(screen.getByText(/1\.A95/)).toBeTruthy();
    expect(screen.getByText(/98 days old/)).toBeTruthy();
  });

  it("flags a SMART concern but stays quiet on a healthy drive", () => {
    const phys = [{ friendly_name: "CT1000P510SSD5", media_type: "SSD", bus_type: "NVMe", size_bytes: 1024 ** 4 }];
    const warn = render(
      <HardwareGrid
        hw={baseHw({ physical_disks: phys, disk_health: [{ friendly_name: "CT1000P510SSD5", health: "Warning" }] })}
      />
    );
    expect(screen.getByText(/SMART reports Warning/i)).toBeTruthy();
    warn.unmount();

    render(
      <HardwareGrid
        hw={baseHw({ physical_disks: phys, disk_health: [{ friendly_name: "CT1000P510SSD5", health: "Healthy" }] })}
      />
    );
    expect(screen.queryByText(/SMART reports/i)).toBeNull();
    expect(screen.getByText(/Healthy/)).toBeTruthy();
  });
});
