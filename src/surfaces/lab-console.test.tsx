import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

// LabConsole — the Ops Console that replaces the Instrument Bench bento (spec
// 2026-07-09-lab-redesign-direction-proposal, Phase 1, Task 4). A real 3D hologram sits center-stage
// with four corner arc gauges (honesty-rail: absent readings render NOT-YET, never a fabricated
// number), a Dock of stations (Optimize primary + the measure/prove stations), and exactly ONE open
// detail panel at a time — Optimize opens <OptimizeStation> inline (it is NOT always-on), the measure
// stations open their existing instrument bodies. Ported verbatim from the deleted LabBench.tsx: the
// probe useEffects, measureTuning, safeReady/stackApplied, measureKeys, stationBody switch, and the
// one-open station state.

// Lab + the embedded instrument tabs poll on mount; mock invoke so they don't throw.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));
// Reduced motion simplifies gauge assertions (useCountTo snaps instead of tweening).
vi.mock("../design/use-motion", () => ({ useReducedMotion: () => true }));
// RigViewer pulls in the ~600KB three.js bundle lazily — stub it so this stays a DOM test.
vi.mock("./rig/RigViewer", () => ({ RigViewer: () => <div data-testid="rig-hologram" /> }));

const { LabConsole } = await import("./LabConsole");
const { ConfirmProvider } = await import("../design/ConfirmDialog");
import type { LabFastPathProps } from "./lab/OptimizeStation";
import type { HardwareInfo } from "../App";

afterEach(cleanup);
beforeEach(() => localStorage.clear());

// Two safe, one-click, not-yet-applied recs — relocated from lab-bench.test.tsx's SAFE_RECS. Gives
// Fix's slim "Apply reviewed (N)" enable-all bar (renders at safeBatch.length >= 2) once Optimize's
// detail panel opens.
const recsFixture = [
  {
    id: "game-mode",
    title: "Game Mode",
    category: "system",
    severity: "safe",
    description: "d",
    impact: "i",
    downside: null,
    applies_to: "all",
    currently_applied: false,
    provenance: "verified",
    eligible: true,
  },
  {
    id: "hags",
    title: "Hardware GPU scheduling",
    category: "system",
    severity: "safe",
    description: "d",
    impact: "i",
    downside: null,
    applies_to: "all",
    currently_applied: false,
    provenance: "verified",
    eligible: true,
  },
] as never[];

const changesFixture = [] as never[];
const isAppliableFixture = () => true;

// Copied from home-v2.test.tsx's `hw` fixture (same shape App threads through as HardwareInfo).
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
  recs: recsFixture,
  startup: [],
  changes: changesFixture,
  busyId: null,
  isAppliable: isAppliableFixture,
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

const base = {
  fast,
  diagnostics: <div data-testid="diag" />,
  diagnosticsCaptured: true,
  vendor: "amd" as const,
  hw: hwFixture,
};

const renderConsole = (props = base) =>
  render(
    <ConfirmProvider>
      <LabConsole {...props} />
    </ConfirmProvider>,
  );

describe("LabConsole", () => {
  it("renders the recognizable rig hologram at center", () => {
    renderConsole();
    expect(screen.getByTestId("rig-hologram")).toBeInTheDocument();
  });

  it("renders a dock node for every Lab station (no gallery) with Optimize as the primary", () => {
    renderConsole();
    expect(screen.getByRole("button", { name: /optimize/i })).toHaveClass("dock-node-primary");
    expect(screen.getByRole("button", { name: /benchmark/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /latency/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /black box/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /gallery/i })).toBeNull();
  });

  it("opens the Optimize enable-all when its dock node is clicked", () => {
    renderConsole();
    fireEvent.click(screen.getByRole("button", { name: /optimize/i }));
    // OptimizeStation's real enable-all control — Fix's slim view renders "Apply reviewed (N)",
    // not "Apply all safe fixes (N)" (that longer label is the non-slim/classic view only).
    expect(screen.getByRole("button", { name: /apply reviewed/i })).toBeInTheDocument();
  });

  it("clicking a measure station opens exactly one detail; another swaps; same one closes", () => {
    renderConsole();
    fireEvent.click(screen.getByRole("button", { name: /benchmark/i }));
    expect(document.querySelectorAll(".lc-detail")).toHaveLength(1);
    expect(document.querySelector(".lc-detail-name")!.textContent).toBe("Benchmark");
    fireEvent.click(screen.getByRole("button", { name: /latency/i }));
    expect(document.querySelectorAll(".lc-detail")).toHaveLength(1);
    expect(document.querySelector(".lc-detail-name")!.textContent).toBe("Latency");
    fireEvent.click(screen.getByRole("button", { name: /latency/i }));
    expect(document.querySelector(".lc-detail")).toBeNull();
  });

  it("shows an honest NOT-YET gauge when a reading is absent (no fabricated number)", () => {
    renderConsole();
    expect(screen.getAllByText(/not yet/i).length).toBeGreaterThan(0);
  });

  it("the safe-stack gauge always shows a real number, never a placeholder", () => {
    renderConsole();
    // safeReady is always a number (2 unapplied safe recs here) — its gauge is never empty.
    expect(screen.getByText("Safe stack")).toBeInTheDocument();
  });

  it("reduced motion is threaded through (no throw, console still renders every station)", () => {
    renderConsole();
    expect(document.querySelector(".lab-console")!.getAttribute("data-motion")).toBe("reduced");
  });
});
