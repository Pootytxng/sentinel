import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// The Check → Optimize journey (recovery items 1/3/4, tester feedback 2026-07-22).
//
// The tester finished a Check, was told "1 safe tweak not applied", and landed somewhere with no
// idea where to act on it. This test walks the seam end to end at the COMPONENT level — the Check
// writes the typed handoff (data/check-handoff.ts), the Lab face reads it on mount, opens Optimize,
// and leads with the exact recs the Check named, marked so the user recognises them.
//
// The invariants under test are journey-level, not cosmetic:
//   · identity survives the hop (rec IDS, never prose or DOM matching)
//   · the destination states what IT can see now — open / already on / no longer applies
//   · arriving NEVER applies, dismisses, or changes anything
//   · the handoff is consumed once, so a later Lab visit is an ordinary visit

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../design/use-motion", () => ({ useReducedMotion: () => true }));
vi.mock("./rig/RigViewer", () => ({ RigViewer: () => <div data-testid="rig-hologram" /> }));

const { LabConsole } = await import("./LabConsole");
const { ConfirmProvider } = await import("../design/ConfirmDialog");
const { writeHandoff } = await import("../data/check-handoff");
import type { LabFastPathProps } from "./lab/OptimizeStation";
import type { HardwareInfo } from "../App";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const rec = (id: string, title: string, currently_applied = false) => ({
  id,
  title,
  category: "system",
  severity: "safe",
  description: `why ${id} matters`,
  impact: `impact of ${id}`,
  downside: null,
  applies_to: "all",
  currently_applied,
  provenance: "verified",
  eligible: true,
});

const RECS = [
  rec("game-mode", "Game Mode"),
  rec("hags", "Hardware GPU scheduling"),
  rec("gpu-scheduling-extra", "Third tweak"),
] as never[];

const hwFixture = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_arch: { family_label: "Ryzen 7 9850X3D", architecture: "Zen 5", generation: "9000" },
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
  disks: [
    {
      mount_point: "C:\\",
      total_bytes: 1000 * 1024 ** 3,
      available_bytes: 130 * 1024 ** 3,
      file_system: "NTFS",
    },
  ],
  memory_modules: [],
  physical_disks: [],
  display: { current_refresh_rate_hz: 165 },
  os_name: "Windows",
  os_version: "11",
} as unknown as HardwareInfo;

const makeFast = (over: Partial<LabFastPathProps> = {}): LabFastPathProps => ({
  recs: RECS,
  startup: [],
  changes: [],
  busyId: null,
  isAppliable: () => true,
  activeChangeFor: () => undefined,
  onToggleRec: () => {},
  onToggleStartup: () => {},
  onRollback: () => {},
  onApplyBatch: async () => ({ applied: 0, skipped: [] }),
  onOpenLibrary: () => {},
  onChanged: () => {},
  sessions: [],
  gpus: [],
  vendor: "amd",
  ...over,
});

const renderLab = (fast: LabFastPathProps = makeFast()) =>
  render(
    <ConfirmProvider>
      <LabConsole
        fast={fast}
        diagnostics={<div data-testid="diag" />}
        diagnosticsCaptured
        vendor="amd"
        hw={hwFixture}
      />
    </ConfirmProvider>,
  );

const carriedBanner = () => document.querySelector(".lab-carried");
const readyTitles = () =>
  Array.from(document.querySelectorAll(".fix-list .slimrow .slimrow-title")).map((n) =>
    (n.textContent ?? "").trim(),
  );

describe("Check → Optimize handoff: arriving with findings", () => {
  it("opens Optimize automatically — no hunting for where to act", () => {
    writeHandoff({ station: "optimize", rec_ids: ["hags"], source: "first-check" });
    renderLab();
    // OptimizeStation's own enable-all control proves the station body is mounted, unclicked.
    expect(screen.getByRole("button", { name: /apply reviewed/i })).toBeInTheDocument();
  });

  it("names the exact tweak the check found, not a count", () => {
    writeHandoff({ station: "optimize", rec_ids: ["hags"], source: "first-check" });
    renderLab();
    const banner = carriedBanner()!;
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain("found these during your check");
    expect(banner.querySelector(".lab-carried-list")!.textContent).toContain(
      "Hardware GPU scheduling",
    );
  });

  it("leads the list with the carried rec, marked so the user recognises it", () => {
    writeHandoff({ station: "optimize", rec_ids: ["hags"], source: "first-check" });
    renderLab();
    expect(readyTitles()[0]).toContain("Hardware GPU scheduling");
    const first = document.querySelector(".fix-list .slimrow")!;
    expect(first.classList.contains("slimrow-carried")).toBe(true);
    expect(first.querySelector(".cmp-carried-tag")!.textContent).toBe("From your check");
  });

  it("a manual-only finding is marked too, and still opens its real steps", () => {
    writeHandoff({ station: "optimize", rec_ids: ["monitor-max-refresh"], source: "check" });
    renderLab(
      makeFast({
        recs: [rec("game-mode", "Game Mode"), rec("monitor-max-refresh", "Monitor refresh rate")] as never[],
        // Compy has no safe switch for this one — it belongs to the guided "Needs your call" group.
        isAppliable: (id: string) => id !== "monitor-max-refresh",
      }),
    );
    const banner = carriedBanner()!;
    expect(banner.querySelector(".lab-carried-list")!.textContent).toContain("Monitor refresh rate");
    const guided = document.querySelector(".fix-row-advisory")!;
    expect(guided.classList.contains("fix-row-carried")).toBe(true);
    expect(guided.querySelector(".cmp-carried-tag")!.textContent).toBe("From your check");
    // Not a dead end: the row is a real door onto the real steps.
    expect(guided.querySelector(".fix-guided-toggle")).toBeTruthy();
  });

  it("several findings keep their identity and the order the check named them", () => {
    writeHandoff({
      station: "optimize",
      rec_ids: ["gpu-scheduling-extra", "game-mode"],
      source: "check",
    });
    renderLab();
    const titles = readyTitles();
    expect(titles[0]).toContain("Third tweak");
    expect(titles[1]).toContain("Game Mode");
    // The uncarried rec is still there — carrying context reorders, it never hides.
    expect(titles.join(" ")).toContain("Hardware GPU scheduling");
    expect(document.querySelectorAll(".fix-list .slimrow-carried")).toHaveLength(2);
  });

  it("a rec applied between the check and arrival is reported as already on, not re-offered", () => {
    writeHandoff({ station: "optimize", rec_ids: ["game-mode", "hags"], source: "check" });
    renderLab(makeFast({ recs: [rec("game-mode", "Game Mode", true), rec("hags", "Hardware GPU scheduling")] as never[] }));
    const banner = carriedBanner()!;
    expect(banner.querySelector(".lab-carried-list")!.textContent).toContain(
      "Hardware GPU scheduling",
    );
    expect(banner.textContent).toContain("already on");
    expect(banner.textContent).toContain("Game Mode");
    // The applied one is not sitting in the ready list waiting to be applied again.
    expect(readyTitles().join(" ")).not.toContain("Game Mode");
  });

  it("a rec that went stale before arrival is stated honestly, never invented", () => {
    writeHandoff({ station: "optimize", rec_ids: ["hags", "retired-tweak"], source: "check" });
    renderLab();
    const banner = carriedBanner()!;
    expect(banner.textContent).toContain("no longer applies to this rig");
    // Nothing named "retired-tweak" is fabricated into the list.
    expect(readyTitles().join(" ")).not.toContain("retired-tweak");
  });

  it("everything from the check already done → says so instead of an empty gesture", () => {
    writeHandoff({ station: "optimize", rec_ids: ["game-mode"], source: "check" });
    renderLab(makeFast({ recs: [rec("game-mode", "Game Mode", true)] as never[] }));
    const banner = carriedBanner()!;
    expect(banner.textContent).toContain("already on");
    expect(banner.querySelector(".lab-carried-list")).toBeNull();
  });

  it("arriving applies nothing — the audited path is still the user's explicit act", () => {
    const onToggleRec = vi.fn();
    const onApplyBatch = vi.fn(async () => ({ applied: 0, skipped: [] }));
    writeHandoff({ station: "optimize", rec_ids: ["hags", "game-mode"], source: "first-check" });
    renderLab(makeFast({ onToggleRec, onApplyBatch }));
    expect(onToggleRec).not.toHaveBeenCalled();
    expect(onApplyBatch).not.toHaveBeenCalled();
  });
});

describe("Check → Optimize handoff: arriving without findings", () => {
  it("no handoff → no arrival banner and no auto-opened station", () => {
    renderLab();
    expect(carriedBanner()).toBeNull();
    expect(screen.queryByRole("button", { name: /apply reviewed/i })).toBeNull();
  });

  it("an empty findings list still opens Optimize but claims nothing", () => {
    writeHandoff({ station: "optimize", rec_ids: [], source: "first-check" });
    renderLab();
    expect(screen.getByRole("button", { name: /apply reviewed/i })).toBeInTheDocument();
    expect(carriedBanner()).toBeNull();
  });

  it("a later Lab visit is an ordinary visit — the handoff is consumed once", () => {
    writeHandoff({ station: "optimize", rec_ids: ["hags"], source: "first-check" });
    renderLab();
    expect(carriedBanner()).toBeTruthy();
    cleanup();
    renderLab();
    expect(carriedBanner()).toBeNull();
  });

  it("stale intent (older than the age cap) is ignored, not replayed", () => {
    writeHandoff({
      station: "optimize",
      rec_ids: ["hags"],
      source: "first-check",
      at: Date.now() - 60 * 60 * 1000,
    });
    renderLab();
    expect(carriedBanner()).toBeNull();
    expect(screen.queryByRole("button", { name: /apply reviewed/i })).toBeNull();
  });
});
