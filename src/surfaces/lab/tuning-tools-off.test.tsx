import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import type { AppliedChange } from "../../types";

// D6 "Tuning tools" off (owner decision 2026-11-24, plan _train/d6-test-room-opt-in-plan-v2.md). Pins what
// Test shows with the tools off: Compy's changes and their undo (owner decision 2), Diagnostics and Crash &
// Freeze Rescue (decision 1), the Gaming Mode pane whenever the session slot is not empty (review item 1),
// and the "Turned off outside Compy" turn-on for an existing Nagle row (Nagle decision). And what it hides:
// Benchmark, Latency, Tuning and the bench's summary tiles. Each block names its break check.

const slot: { value: unknown; reject: boolean } = { value: null, reject: false };
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_gaming_session_state") {
      return slot.reject ? Promise.reject(new Error("unreadable")) : Promise.resolve(slot.value);
    }
    return Promise.resolve(null);
  }),
}));
vi.mock("../../design/use-motion", () => ({ useReducedMotion: () => true }));
vi.mock("../rig/RigViewer", () => ({ RigViewer: () => <div data-testid="rig-hologram" /> }));
// The real pane polls its own commands; what is pinned here is only WHETHER it is mounted.
vi.mock("../GamingMode", () => ({ GamingMode: () => <div data-testid="gaming-pane-stub" /> }));

const { LabConsole } = await import("../LabConsole");
const { ChangesFace } = await import("./ChangesFace");
const { ConfirmProvider } = await import("../../design/ConfirmDialog");
import type { LabFastPathProps } from "./OptimizeStation";
import type { HardwareInfo } from "../../App";

const ch = (id: string, rec_id: string, title: string, extra: Partial<AppliedChange> = {}): AppliedChange =>
  ({
    id,
    rec_id,
    rec_title: title,
    applied_at: "2026-11-20T18:00:00Z",
    snapshot: null,
    status: "applied",
    is_still_active: true,
    active_check: "on",
    ...extra,
  }) as unknown as AppliedChange;

// A normal row, a startup-entry row and a row recorded without its result: each keeps its Undo (review M3).
const LEDGER = [
  ch("c1", "game-mode", "Game Mode"),
  ch("c2", "startup-entry:Updater", "Updater at startup"),
  ch("c3", "sysmain-disable", "SysMain", { result_unconfirmed: true }),
];

const onRollback = vi.fn();
const fast = (over: Partial<LabFastPathProps> = {}): LabFastPathProps => ({
  recs: [],
  startup: [],
  changes: [],
  busyId: null,
  isAppliable: () => true,
  activeChangeFor: () => undefined,
  onToggleRec: () => {},
  onToggleStartup: () => {},
  onRollback,
  onApplyBatch: async () => ({ applied: 0, skipped: [] }),
  onOpenLibrary: () => {},
  onChanged: () => {},
  sessions: [],
  gpus: [],
  vendor: "amd",
  gamingEnabled: true,
  ...over,
});

const hw = {
  cpu_brand: "AMD Ryzen 7",
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
  disks: [],
  memory_modules: [],
  physical_disks: [],
  os_name: "Windows",
  os_version: "11",
} as unknown as HardwareInfo;

const flush = () =>
  act(async () => {
    for (let i = 0; i < 4; i++) await Promise.resolve();
  });

const renderConsole = (f: LabFastPathProps = fast()) =>
  render(
    <ConfirmProvider>
      <LabConsole
        fast={f}
        diagnostics={<div data-testid="diag" />}
        diagnosticsCaptured
        vendor="amd"
        hw={hw}
        hud
        ledState="ok"
        classicVerdict="Everything checked out."
      />
    </ConfirmProvider>,
  );

const renderFace = (f: LabFastPathProps) =>
  render(
    <ConfirmProvider>
      <ChangesFace {...f} />
    </ConfirmProvider>,
  );

const dockText = () =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".dock-node")).map((b) => b.textContent ?? "");

beforeEach(() => {
  localStorage.clear();
  slot.value = null;
  slot.reject = false;
  onRollback.mockClear();
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("compy_tuning_tools");
});

describe("Test with the tuning tools OFF", () => {
  beforeEach(() => localStorage.setItem("compy_tuning_tools", "0"));

  // Break check: drop `(tools || !TUNING_STATIONS.has(k))` from measureKeys (LabConsole) and the
  // Benchmark/Latency/Tuning nodes come back.
  it("lists station 1 as Compy's changes plus Diagnostics and Crash & Freeze Rescue, and no tuning station", async () => {
    renderConsole();
    await flush();
    const nodes = dockText();
    expect(nodes.some((s) => /Your changes/.test(s))).toBe(true);
    expect(nodes.some((s) => /Diagnostics/.test(s))).toBe(true);
    expect(nodes.some((s) => /Crash & Freeze/.test(s))).toBe(true);
    // Tuning is matched by its dock line ("Fine-tune settings…"), since "Tuning" alone could be a substring.
    for (const hidden of [/Benchmark/, /Latency/, /Fine-tune settings/, /Optimize/]) {
      expect(nodes.some((s) => hidden.test(s))).toBe(false);
    }
  });

  // Break check: remove the `{tools && (` wrapper around the Proven reading and its testid renders.
  it("stands the bench's summary tiles down (Proven, Noise floor, Safe stack); Instruments read stays", async () => {
    renderConsole();
    await flush();
    expect(screen.queryByTestId("lc-reading-proven")).toBeNull();
    expect(screen.queryByTestId("lc-reading-noise")).toBeNull();
    expect(screen.queryByTestId("lc-reading-safe-stack")).toBeNull();
    expect(document.querySelectorAll(".lc-readings .lc-reading").length).toBe(1);
  });

  // Break check: render <OptimizeStation> regardless of `tools` and the changes face is gone.
  it("opens station 1 onto Compy's changes, with every Undo, and not the Optimize switches", async () => {
    renderConsole(fast({ changes: LEDGER }));
    await flush();
    const node = Array.from(document.querySelectorAll<HTMLButtonElement>(".dock-node")).find((b) =>
      /Your changes/.test(b.textContent ?? ""),
    )!;
    fireEvent.click(node);
    await flush();
    expect(screen.getByTestId("lab-changes-face")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /apply reviewed/i })).toBeNull();
    const undo = Array.from(document.querySelectorAll<HTMLButtonElement>(".fix-ghost-rollback"));
    expect(undo).toHaveLength(3);
    undo.forEach((b) => expect(b.disabled).toBe(false));
    fireEvent.click(undo[1]);
    expect(onRollback).toHaveBeenCalledTimes(1);
  });
});

describe("the changes face on its own", () => {
  // Break check: change `showGaming` to `slot === "present"` and the unreadable case loses the pane;
  // change it to `!!props.gamingEnabled` and the empty case shows a Gaming Mode start.
  it.each([
    ["a live or pending session", { value: { phase: "active" }, reject: false }, true],
    ["a slot Compy couldn't read", { value: null, reject: true }, true],
    ["an empty slot", { value: null, reject: false }, false],
  ])("Gaming Mode pane with %s", async (_name, s, shown) => {
    Object.assign(slot, s);
    renderFace(fast({ changes: LEDGER }));
    await flush();
    expect(!!screen.queryByTestId("lab-changes-gaming")).toBe(shown);
    expect(!!screen.queryByTestId("gaming-pane-stub")).toBe(shown);
  });

  // Break check: drop the `reverted.length > 0 &&` section and the Nagle turn-on is gone.
  it("offers 'Turned off outside Compy' for an EXISTING Nagle row (Nagle decision: re-apply allowed)", async () => {
    renderFace(
      fast({ changes: [ch("n1", "nagle-disable", "Lower network latency", { is_still_active: false, active_check: "off" })] }),
    );
    await flush();
    const off = screen.getByTestId("lab-changes-off");
    expect(off.textContent).toContain("Turned off outside Compy");
    expect(Array.from(off.querySelectorAll("button")).some((b) => /Lower network latency/.test(b.textContent ?? ""))).toBe(
      true,
    );
  });

  it("says the tools are off and how to turn them on, and that this changes nothing on the PC", async () => {
    renderFace(fast());
    await flush();
    const face = screen.getByTestId("lab-changes-face");
    expect(face.textContent).toContain("Settings → Tuning tools");
    expect(face.textContent).toContain("changes nothing on your PC");
    expect(screen.getByTestId("lab-changes-ledger")).toBeInTheDocument();
  });
});

describe("Test with the tuning tools ON is unchanged", () => {
  // Control for the OFF block: the same harness with the tools on shows every station and tile.
  it("lists Optimize, Benchmark, Latency and Tuning and the three tiles", async () => {
    localStorage.setItem("compy_tuning_tools", "1");
    renderConsole();
    await flush();
    const nodes = dockText();
    for (const shown of [/Optimize/, /Benchmark/, /Latency/, /Fine-tune settings/, /Diagnostics/, /Crash & Freeze/]) {
      expect(nodes.some((s) => shown.test(s))).toBe(true);
    }
    expect(screen.getByTestId("lc-reading-proven")).toBeInTheDocument();
    expect(screen.getByTestId("lc-reading-safe-stack")).toBeInTheDocument();
  });
});
