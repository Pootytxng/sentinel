import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { HardwareInfo } from "../App";
import type { ComponentEvidence, ComponentEvidenceReport } from "../types";

// Intelligence Phase 4 (§4H hardware twin) test rig. HardwareGrid now fetches get_component_evidence
// and gates it on the Intelligence flag, so both are driven deterministically here. The invoke mock
// DEFAULTS to no components + the flag ON, which is exactly the pre-Phase-4 render — so the four
// detection-surfacing tests below stay byte-green without touching them.
const state = vi.hoisted(() => ({
  flag: true,
  evidence: { components: [], sessions_considered: 0 } as ComponentEvidenceReport,
  reject: false, // when true, get_component_evidence rejects → the honest empty (never a fake highlight)
}));

vi.mock("../design/use-hud", () => ({
  useIntelligenceFlag: () => state.flag,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_component_evidence") {
      return state.reject ? Promise.reject("boom") : Promise.resolve(state.evidence);
    }
    return Promise.resolve(null);
  }),
}));

// Imported AFTER the mocks so HardwareGrid binds the mocked invoke/flag.
const { HardwareGrid } = await import("./HardwareGrid");

afterEach(() => {
  cleanup();
  state.flag = true;
  state.evidence = { components: [], sessions_considered: 0 };
  state.reject = false;
});

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

// Intelligence Phase 4 (§4H hardware twin) — the honesty invariants of the component-evidence
// highlight. A card lights ONLY when real evidence names it, at that evidence's own band; every
// other card stays neutral; the flag off or a fetch failure surfaces NOTHING (never a fabricated
// glow). These are exactly the "no decorative glow without meaning" rails green tsc can't see.
const memEvi = (over: Partial<ComponentEvidence> = {}): ComponentEvidence => ({
  component: "memory",
  confidence: "medium",
  headline: "A measured session pattern involves your memory.",
  reasons: ["Memory in use trended upward across your recent sessions."],
  next_test: "Run a controlled before/after to rule out other causes.",
  sources: ["memory-trend"],
  ...over,
});

describe("HardwareGrid component-evidence highlight (§4H)", () => {
  it("lights ONLY the implicated card, with its band + non-causal why, when evidence names it", async () => {
    state.evidence = { components: [memEvi()], sessions_considered: 4 };
    const { container } = render(<HardwareGrid hw={baseHw()} />);

    // The headline appears only after the async projection resolves — findBy waits for it.
    expect(await screen.findByText("A measured session pattern involves your memory.")).toBeTruthy();

    // Exactly one card is lit, and it is the Memory card (the component the evidence names).
    const lit = container.querySelectorAll(".card-lit");
    expect(lit).toHaveLength(1);
    expect(lit[0].querySelector(".card-label")?.textContent).toContain("Memory");

    // The band pill states the inherited band verbatim; the reason renders; the next test is offered.
    expect(screen.getByText("medium confidence")).toBeTruthy();
    expect(screen.getByText(/trended upward across your recent sessions/)).toBeTruthy();
    expect(screen.getByText("Next test")).toBeTruthy();
    expect(screen.getByText(/controlled before\/after/)).toBeTruthy();
  });

  it("stays fully neutral when the Intelligence flag is off — no card lit, no evidence disclosure", async () => {
    state.flag = false;
    state.evidence = { components: [memEvi()], sessions_considered: 4 };
    const { container } = render(<HardwareGrid hw={baseHw()} />);

    // Memory card always renders; wait for it, then prove nothing lit / no disclosure exists.
    await screen.findByText("Memory");
    await waitFor(() => {
      expect(container.querySelector(".card-lit")).toBeNull();
      expect(container.querySelector(".hw-evi")).toBeNull();
    });
    expect(screen.queryByText("A measured session pattern involves your memory.")).toBeNull();
  });

  it("shows NO highlight when the projection fetch fails (honest empty, never a fake glow)", async () => {
    state.reject = true;
    state.evidence = { components: [memEvi()], sessions_considered: 4 }; // ignored — the call rejects
    const { container } = render(<HardwareGrid hw={baseHw()} />);

    await screen.findByText("Memory");
    await waitFor(() => {
      expect(container.querySelector(".card-lit")).toBeNull();
      expect(container.querySelector(".hw-evi")).toBeNull();
    });
  });

  it("carries the evidence band onto the disclosure class so the band drives the styling", async () => {
    state.evidence = { components: [memEvi({ confidence: "low" })], sessions_considered: 2 };
    const { container } = render(<HardwareGrid hw={baseHw()} />);

    await screen.findByText("low confidence");
    const evi = container.querySelector(".hw-evi");
    expect(evi?.classList.contains("hw-evi-low")).toBe(true);
    expect(evi?.classList.contains("hw-evi-medium")).toBe(false);
  });
});
