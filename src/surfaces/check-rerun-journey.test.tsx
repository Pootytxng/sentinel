import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
// (fs/path typed by src/test-node-shims.d.ts — @types/node is not a project dependency.)

// The RE-RUN check journey (recovery items 1/3 — the correction pass, 2026-07-28).
//
// The truth matrix originally scheduled "add a destination CTA to the re-run Check surface". Tracing
// the shipped default proved that surface is not what users receive, so this file pins the three
// facts that make the item resolved — and would fail loudly if a future change reintroduced the seam
// by rerouting the re-run somewhere without a CTA, or by flipping a nav flag's default polarity.
//
//   1. Both nav flags that decide which faces exist are DEFAULT-ON.
//   2. Consequently App's standalone <Check> render is dead code on the default path, while Home's
//      re-run band re-opens the SAME FirstCheck arc — the one that carries the CTA + typed handoff.
//   3. The one live <Check> is mounted INSIDE the Optimize station, so there is no room to hop to.
//
// Tests 1+3 are behavioral. Test 2 reads App.tsx source on purpose: the claim under test is a
// WIRING claim ("re-run opens the arc that has the CTA"), and rendering all of App to assert it
// would prove less, more slowly. Same guard style as src/appliable-parity.test.ts.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
vi.mock("../design/use-motion", () => ({ useReducedMotion: () => true }));
vi.mock("./rig/RigViewer", () => ({ RigViewer: () => <div data-testid="rig-hologram" /> }));

const { LabConsole } = await import("./LabConsole");
const { ConfirmProvider } = await import("../design/ConfirmDialog");
const { writeHandoff } = await import("../data/check-handoff");
const { readOptimizeMerged } = await import("../data/nav-flags");
const { readLabGround } = await import("../design/theme");
import type { LabFastPathProps } from "./lab/OptimizeStation";
import type { HardwareInfo } from "../App";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

const APP_SRC = readFileSync(join("src", "App.tsx"), "utf8");

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

const fast: LabFastPathProps = {
  recs: [],
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
};

describe("which check surfaces a user actually receives", () => {
  it("both nav flags are default-ON — the faces under test are the shipped ones", () => {
    // Fresh profile, nothing set. If either default ever flips, every claim below is re-opened.
    expect(readLabGround()).toBe(true);
    expect(readOptimizeMerged()).toBe(true);
    // The escape hatches still work — this is a default claim, not an absolute one.
    localStorage.setItem("compy_lab_ground", "0");
    localStorage.setItem("compy_optimize", "0");
    expect(readLabGround()).toBe(false);
    expect(readOptimizeMerged()).toBe(false);
  });

  it("Home's re-run band re-opens the same check arc — same CTA, same handoff", () => {
    // Re-run is not a second implementation of the check: the band flips the FirstCheck arc back on.
    expect(APP_SRC).toContain("onRunCheck={() => setShowFirstCheck(true)}");
    // ...and that arc is the one wired to the destination CTA + the typed handoff.
    const arcStart = APP_SRC.indexOf("<FirstCheck");
    expect(arcStart).toBeGreaterThan(-1);
    const arc = APP_SRC.slice(arcStart, APP_SRC.indexOf("/>", arcStart));
    expect(arc).toContain("onGoToLab=");
    expect(arc).toContain('writeHandoff({ station: "optimize"');
    // The standalone Check room is gated behind the OFF position of a default-ON flag, so it is not
    // a surface that needs its own CTA. (Guarding the literal keeps a future un-gating honest.)
    expect(APP_SRC).toContain('activeTab === "Check" && !optimizeMerged');
  });
});

describe("the hygiene check is inside Optimize, not a room away", () => {
  it("renders within the Optimize station body, under its own disclosure", () => {
    writeHandoff({ station: "optimize", rec_ids: [], source: "first-check" });
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
    const station = document.querySelector(".lab-optimize");
    expect(station).toBeTruthy();
    const check = station!.querySelector(".check-root");
    // Containment IS the claim: reaching it costs a disclosure, never a navigation.
    expect(check).toBeTruthy();
    expect(check!.closest("details.lab-optimize-more")).toBeTruthy();
    // It carries its own re-run control, so a user standing in Optimize can re-scan in place.
    expect(check!.querySelector(".check-rerun")).toBeTruthy();
  });
});
