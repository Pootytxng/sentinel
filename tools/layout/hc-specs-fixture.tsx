// The page the Chromium layout regression renders (#646): the REAL HomeConsole, with the hardware
// record the jsdom detected-record tests use, mounted exactly as App would mount it. Nothing here
// touches a spec card: the test drives the width of the host and of the `.hc-specs` section and reads
// boxes back through CDP. Lives outside `src/` on purpose: PR #624's DOM-mutation census scans
// `src/`, and a fixture that mounts a React root is not an app write.
import { createRoot } from "react-dom/client";
import { HomeConsole } from "../../src/surfaces/HomeConsole";
import type { HardwareInfo } from "../../src/App";

// Long model strings on purpose: the overflow in #614 was a value that could not wrap inside a track
// narrower than the 230px minimum, so the fixture carries the widest real values the Cards view shows.
export const hw = {
  cpu_brand: "AMD Ryzen 7 9850X3D 8-Core Processor",
  cpu_arch: { family_label: "Ryzen 7 9850X3D", architecture: "Zen 5", generation: "9000" },
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [
    {
      name: "AMD Radeon RX 9070 XT",
      vram_bytes: 16 * 1024 ** 3,
      driver_version: "32.0.21001.9024",
      driver_date: "2026-05-02",
    },
  ],
  disks: [
    {
      mount_point: "C:\\",
      total_bytes: 1000 * 1024 ** 3,
      available_bytes: 130 * 1024 ** 3,
      file_system: "NTFS",
    },
  ],
  memory_modules: [
    {
      capacity_bytes: 16 * 1024 ** 3,
      speed_mhz: 6000,
      rated_speed_mhz: 6000,
      type_name: "DDR5",
      manufacturer: "Corsair",
      xmp_expo_status: "running_at_rated",
    },
    {
      capacity_bytes: 16 * 1024 ** 3,
      speed_mhz: 6000,
      rated_speed_mhz: 6000,
      type_name: "DDR5",
      manufacturer: "Corsair",
      xmp_expo_status: "running_at_rated",
    },
  ],
  physical_disks: [
    {
      friendly_name: "Samsung SSD 990 PRO with Heatsink 2TB",
      media_type: "SSD",
      bus_type: "NVMe",
      size_bytes: 2000 * 1000 ** 3,
    },
    {
      friendly_name: "WD Blue SN580 1TB",
      media_type: "SSD",
      bus_type: "NVMe",
      size_bytes: 1000 * 1000 ** 3,
    },
  ],
  display: { current_refresh_rate_hz: 165 },
  os_name: "Windows",
  os_version: "11",
} as unknown as HardwareInfo;

/** Mount HomeConsole into `host`; resolves once the spec grid is in the DOM. */
export function mount(host: HTMLElement): Promise<void> {
  createRoot(host).render(
    <HomeConsole
      hw={hw}
      readiness={null}
      priorities={null}
      sessions={[]}
      changes={[]}
      onRunCheck={() => {}}
      onSeeInFix={() => {}}
    />,
  );
  return new Promise((resolve) => {
    const tick = () => (host.querySelector(".hc-specs-grid") ? resolve() : requestAnimationFrame(tick));
    tick();
  });
}
