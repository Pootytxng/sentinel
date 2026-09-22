import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { HardwareInfo } from "../App";
import type { ComponentEvidence, ComponentEvidenceReport, MachineModel } from "../types";
import wire from "../test/fixtures/machine-model.wire.json";

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

// The Shared Machine Model the identity rows read (#451). The wire fixture is what the Rust side
// proves serde emits (machine-model-contract.test.ts), so a shape drift there reds this file too.
// Each test mutates a deep copy — the fixture module object stays pristine across tests.
function baseModel(mutate?: (m: MachineModel) => void): MachineModel {
  const m = JSON.parse(JSON.stringify(wire)) as MachineModel;
  mutate?.(m);
  return m;
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

type Gpu = HardwareInfo["gpus"][number];
const gpu = (over: Partial<Gpu> = {}): Gpu => ({
  name: "Radeon RX 9070 XT",
  vram_bytes: 16 * 1024 ** 3,
  driver_version: "25.5.1",
  driver_date: "2026-05-01",
  driver_age_days: 40,
  video_processor: "",
  current_refresh_rate_hz: 250,
  ...over,
});

// The card whose label is `label`, as one element, so a test asserts on ONE card's text and not on
// a word that also appears elsewhere in the grid.
function cardByLabel(container: HTMLElement, label: string): HTMLElement {
  const card = Array.from(container.querySelectorAll<HTMLElement>(".card")).find(
    (c) => c.querySelector(".card-label")?.textContent === label,
  );
  if (!card) throw new Error(`no card labelled ${label}`);
  return card;
}

// The `Driver` / `Display` detail row's value inside a card.
function detailValue(card: HTMLElement, key: string): string | null {
  const row = Array.from(card.querySelectorAll<HTMLElement>(".detail")).find(
    (d) => d.querySelector(".detail-key")?.textContent === key,
  );
  return row?.querySelector(".detail-value")?.textContent ?? null;
}

describe("HardwareGrid detection surfacing", () => {
  it("flags RAM running below rated with an actionable EXPO/XMP hint", () => {
    render(
      <HardwareGrid
        hw={baseHw({
          memory_modules: [
            mod({ speed_mhz: 4800, rated_speed_mhz: 6000, xmp_expo_status: "running_below_rated" }),
          ],
        })}
        model={baseModel()}
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
    render(
      <HardwareGrid
        hw={baseHw({ memory_modules: [mod({ xmp_expo_status: "running_at_rated" })] })}
        model={baseModel()}
      />
    );
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
        model={baseModel()}
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
        model={baseModel()}
      />
    );
    expect(screen.getByText(/SMART reports Warning/i)).toBeTruthy();
    warn.unmount();

    render(
      <HardwareGrid
        hw={baseHw({ physical_disks: phys, disk_health: [{ friendly_name: "CT1000P510SSD5", health: "Healthy" }] })}
        model={baseModel()}
      />
    );
    expect(screen.queryByText(/SMART reports/i)).toBeNull();
    expect(screen.getByText(/Healthy/)).toBeTruthy();
  });
});

// Shared Machine Model, slice 3 (#451) — the six identity rows (CPU, primary GPU, GPU driver, RAM,
// display mode, Windows) read `model.identity` and nothing else. The invariants pinned here are the
// honesty ones green tsc cannot see: a missing value prints its producer's reason (never "—" or
// "0 GB"), a cached value is never called live, two disagreeing producers both print, a failed model
// read leaves the six rows unread while every other card still renders from the inventory, and the
// model's word beats a differing inventory value.
describe("HardwareGrid identity rows (Shared Machine Model, #451)", () => {
  const WINDOWS = "Windows 11 Pro (build 26200.4351)";
  const known = () =>
    baseModel((m) => {
      m.identity.windows = {
        value: WINDOWS,
        class: "directly-observed",
        source: "hardware::get_hardware_info",
        freshness: "unstamped-cache",
      };
    });

  it("prints every known identity fact from the model, and the inventory's differing CPU name loses", () => {
    const { container } = render(
      <HardwareGrid hw={baseHw({ cpu_brand: "Test CPU", gpus: [gpu()] })} model={known()} />
    );
    expect(cardByLabel(container, "CPU").querySelector(".card-value")?.textContent).toBe("AMD Ryzen 7 7800X3D");
    expect(cardByLabel(container, "Memory").querySelector(".card-value")?.textContent).toBe("32 GB");
    const graphics = cardByLabel(container, "Graphics");
    expect(graphics.querySelector(".card-value")?.textContent).toBe("Radeon RX 9070 XT");
    // The model's driver version, with the inventory's age beside it.
    expect(detailValue(graphics, "Driver")).toBe("25.5.1 · 1 mo old");
    expect(detailValue(graphics, "Display")).toBe("2560×1440 @ 250 Hz");
    expect(cardByLabel(container, "System").querySelector(".card-value")?.textContent).toBe(WINDOWS);
    // The inventory's own CPU string is nowhere: the model is the single source for identity.
    expect(screen.queryByText(/Test CPU/)).toBeNull();
    // No known fact needs a reason line.
    expect(container.querySelectorAll(".hw-fact-reason")).toHaveLength(0);
  });

  it("never labels an unstamped-cache value as live, current, or fresh", () => {
    const { container } = render(<HardwareGrid hw={baseHw({ gpus: [gpu()] })} model={known()} />);
    // Every fixture identity fact is `unstamped-cache`; the grid prints the value and no freshness word.
    // (The disagreement note is the one place a producer is named, and it says "Current fingerprint"
    // about the PRODUCER — so it is excluded from this sweep, which covers the cards alone.)
    const cards = container.querySelector(".grid")?.textContent ?? "";
    expect(cards).not.toMatch(/\blive\b/i);
    expect(cards).not.toMatch(/\bfresh\b/i);
    expect(cards).not.toMatch(/unstamped|cache/i);
  });

  it("shows the producer's reason for an unknown RAM total — never 0 GB or a dash", () => {
    const reason = "The memory total read returned nothing, so the installed RAM is unknown rather than assumed.";
    const { container } = render(
      <HardwareGrid
        hw={baseHw({ ram_total_bytes: 0, ram_used_bytes: 0 })}
        model={baseModel((m) => {
          m.identity.ram_gb = {
            value: null,
            class: "unavailable",
            source: "hardware::get_hardware_info",
            freshness: "not-applicable",
            unknown_reason: reason,
          };
          m.identity.disagreements = [];
        })}
      />
    );
    const memory = cardByLabel(container, "Memory");
    const value = memory.querySelector(".card-value")?.textContent;
    expect(value).toBe("Unknown");
    expect(value).not.toMatch(/GB|—/);
    expect(memory.querySelector(".hw-fact-reason")?.textContent).toBe(reason);
    // A zero inventory total prints no percentage either (a share of nothing is not a number).
    expect(detailValue(memory, "In use")).toBe("0.0 GB");
  });

  it("shows the reason for an empty driver fact on the primary adapter, with no dash", () => {
    const reason = "The adapter reported no driver version.";
    const { container } = render(
      <HardwareGrid
        hw={baseHw({ gpus: [gpu({ driver_version: "", driver_age_days: null })] })}
        model={baseModel((m) => {
          m.identity.gpu_driver = {
            value: null,
            class: "unavailable",
            source: "hardware::current_fingerprint",
            freshness: "not-applicable",
            unknown_reason: reason,
          };
        })}
      />
    );
    const graphics = cardByLabel(container, "Graphics");
    expect(detailValue(graphics, "Driver")).toBe("Unknown");
    expect(graphics.textContent).toContain(reason);
    expect(graphics.textContent).not.toContain("—");
  });

  it("falls back to a fixed sentence when a missing fact carries no reason at all", () => {
    const { container } = render(
      <HardwareGrid
        hw={baseHw()}
        model={baseModel((m) => {
          m.identity.windows = {
            value: null,
            class: "unavailable",
            source: "hardware::get_hardware_info",
            freshness: "not-applicable",
          };
        })}
      />
    );
    const system = cardByLabel(container, "System");
    expect(system.querySelector(".card-value")?.textContent).toBe("Unknown");
    expect(system.querySelector(".hw-fact-reason")?.textContent).toBe("No reason was recorded for the missing value.");
  });

  it("prints both producers and both values when two readings of a field disagree", () => {
    const { container } = render(<HardwareGrid hw={baseHw()} model={baseModel()} />);
    const note = container.querySelector(".hw-disagree");
    expect(note).not.toBeNull();
    expect(screen.getByText("Two readings of Memory disagree")).toBeTruthy();
    expect(screen.getByText("Current fingerprint: 32")).toBeTruthy();
    expect(screen.getByText("Saved baseline: 16")).toBeTruthy();
    expect(note?.textContent).toContain("different rounding conventions");
    // The card itself still carries the canonical value — the disagreement is reported, not resolved.
    expect(cardByLabel(container, "Memory").querySelector(".card-value")?.textContent).toBe("32 GB");
  });

  it("renders no disagreement note when the producers agree", () => {
    const { container } = render(
      <HardwareGrid hw={baseHw()} model={baseModel((m) => void (m.identity.disagreements = []))} />
    );
    expect(container.querySelector(".hw-disagree")).toBeNull();
  });

  it("leaves the six identity rows unreadable, with the reason, when the model read failed — other cards unchanged", () => {
    const { container } = render(
      <HardwareGrid
        hw={baseHw({
          gpus: [gpu()],
          network_adapters: [{ name: "Realtek Gaming 2.5GbE", physical: true, connected: true, medium: "wired" }],
          bios_info: { manufacturer: "AMI", version: "1.A95", release_date: "2026-03-15", release_date_age_days: 98 },
        })}
        model={null}
      />
    );
    expect(screen.getAllByText("Unreadable")).toHaveLength(6);
    expect(
      screen.getAllByText("The shared Machine Model could not be read, so this value is left unread rather than guessed."),
    ).toHaveLength(6);
    expect(container.querySelector(".hw-disagree")).toBeNull();
    // Inventory-backed rows still print: hostname, BIOS, cores, VRAM, network.
    expect(screen.getByText("test-rig")).toBeTruthy();
    expect(screen.getByText(/1\.A95/)).toBeTruthy();
    expect(detailValue(cardByLabel(container, "CPU"), "Physical cores")).toBe("8");
    expect(detailValue(cardByLabel(container, "Graphics"), "VRAM")).toBe("16.0 GB");
    expect(screen.getByText("Realtek Gaming 2.5GbE")).toBeTruthy();
    expect(cardByLabel(container, "Network").querySelector(".card-value")?.textContent).toBe("Ethernet");
  });

  it("says the model is still being read, with no reason line, before the first read lands", () => {
    const { container } = render(<HardwareGrid hw={baseHw()} model={undefined} />);
    expect(screen.getAllByText("Reading…")).toHaveLength(6);
    expect(container.querySelectorAll(".hw-fact-reason")).toHaveLength(0);
  });

  it("keeps a secondary adapter's driver on the inventory while the primary reads the model", () => {
    const { container } = render(
      <HardwareGrid
        hw={baseHw({ gpus: [gpu(), gpu({ name: "Intel UHD 770", driver_version: "31.0.101", driver_age_days: 200 })] })}
        model={known()}
      />
    );
    const graphics = cardByLabel(container, "Graphics");
    const drivers = Array.from(graphics.querySelectorAll<HTMLElement>(".detail"))
      .filter((d) => d.querySelector(".detail-key")?.textContent === "Driver")
      .map((d) => d.querySelector(".detail-value")?.textContent);
    expect(drivers).toEqual(["25.5.1 · 1 mo old", "31.0.101 · 6 mo old"]);
  });

  it("keeps the panel's higher maximum refresh rate beside the model's display mode", () => {
    const { container } = render(
      <HardwareGrid
        hw={baseHw({ display: { width: 2560, height: 1440, current_refresh_rate_hz: 250, max_refresh_rate_hz: 360 } })}
        model={known()}
      />
    );
    expect(detailValue(cardByLabel(container, "Graphics"), "Display")).toBe("2560×1440 @ 250 Hz (max 360 Hz)");
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
    const { container } = render(<HardwareGrid hw={baseHw()} model={baseModel()} />);

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
    const { container } = render(<HardwareGrid hw={baseHw()} model={baseModel()} />);

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
    const { container } = render(<HardwareGrid hw={baseHw()} model={baseModel()} />);

    await screen.findByText("Memory");
    await waitFor(() => {
      expect(container.querySelector(".card-lit")).toBeNull();
      expect(container.querySelector(".hw-evi")).toBeNull();
    });
  });

  it("carries the evidence band onto the disclosure class so the band drives the styling", async () => {
    state.evidence = { components: [memEvi({ confidence: "low" })], sessions_considered: 2 };
    const { container } = render(<HardwareGrid hw={baseHw()} model={baseModel()} />);

    await screen.findByText("low confidence");
    const evi = container.querySelector(".hw-evi");
    expect(evi?.classList.contains("hw-evi-low")).toBe(true);
    expect(evi?.classList.contains("hw-evi-medium")).toBe(false);
  });
});
