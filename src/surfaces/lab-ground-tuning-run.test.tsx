import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";

// D6 review r1 F2: a running Trial's "Restore now" and a running benchmark's Cancel are never hidden. With
// "off" stored (by the first-run decision, an edited store or a restored backup), Test still shows the Trials
// bench (which holds Restore now and the guided journey) while a Trial is running, and the Benchmark station
// (which holds the run's and the tweak trial's Cancel) while a benchmark run or tweak trial is running; a read
// that fails counts as running. With nothing running both stand down again.
//
// The bench and the station are asserted through their containers (the ExperimentBench mount and the
// Benchmark dock node): the Restore now / Cancel controls themselves are those surfaces' own, unchanged code.

const state = {
  experiments: [] as unknown,
  experimentsReject: false,
  bench: { running: false } as unknown,
  trial: { running: false } as unknown,
};
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string) => {
    if (cmd === "get_experiments") {
      return state.experimentsReject ? Promise.reject(new Error("unreadable")) : Promise.resolve(state.experiments);
    }
    if (cmd === "get_benchmark_state") return Promise.resolve(state.bench);
    if (cmd === "get_trial_state") return Promise.resolve(state.trial);
    // List commands answer a list in the product (LabConsole's tuning evidence filters them).
    if (cmd === "get_session_summaries" || cmd === "get_tuning_comparability") return Promise.resolve([]);
    return Promise.resolve(null);
  }),
}));
vi.mock("./rig/RigViewer", () => ({ RigViewer: () => <div data-testid="rig-hologram" /> }));
vi.mock("./ExperimentBench", () => ({ default: () => <div data-testid="trials-bench-stub" /> }));
vi.mock("./GpuProfile", () => ({ GpuProfile: () => <div data-testid="gpu-profile-stub" /> }));
vi.mock("../design/use-motion", () => ({ useReducedMotion: () => true }));
class IOStub {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}
vi.stubGlobal("IntersectionObserver", IOStub);

const { LabGround } = await import("./LabGround");
const { ConfirmProvider } = await import("../design/ConfirmDialog");

const hw = {
  cpu_brand: "AMD Ryzen 7",
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  ram_total_bytes: 32 * 1024 ** 3,
  gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
} as never;

const flush = () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });

const mount = () =>
  render(
    <ConfirmProvider>
      <LabGround
        hw={hw}
        isAppliable={() => true}
        onOpenLibrary={() => {}}
        onChanged={() => {}}
        vendor="amd"
        sessions={[]}
        gpus={[]}
        recs={[]}
        startup={[]}
        changes={[]}
        busyId={null}
        activeChangeFor={() => undefined}
        onToggleRec={() => {}}
        onToggleStartup={() => {}}
        onRollback={() => {}}
        onApplyBatch={async () => ({ applied: 0, skipped: [] })}
        activeCount={0}
        diagnostics={<div data-testid="diag" />}
        diagnosticsCaptured
      />
    </ConfirmProvider>,
  ).container;

const dockNames = (c: HTMLElement) =>
  Array.from(c.querySelectorAll(".dock-node .dock-nm")).map((n) => n.textContent ?? "");

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("compy_tuning_tools", "0");
  Object.assign(state, {
    experiments: [],
    experimentsReject: false,
    bench: { running: false },
    trial: { running: false },
  });
});
afterEach(() => {
  cleanup();
  localStorage.removeItem("compy_tuning_tools");
});

describe("stored 'off' never hides a running Trial's or benchmark's own controls", () => {
  // Control for both cases below: nothing running -> the bench, Benchmark and the GPU captures stand down.
  it("with nothing running, the Trials bench and Benchmark are hidden", async () => {
    const c = mount();
    await flush();
    expect(c.querySelector('[data-testid="trials-bench-stub"]')).toBeNull();
    expect(dockNames(c)).not.toContain("Benchmark");
    expect(c.querySelector('[data-testid="gpu-profile-stub"]')).toBeNull();
  });

  // Break check: in LabGround, make `below` depend on `tools` alone and the bench (Restore now) is gone.
  it.each([
    ["a running Trial", () => (state.experiments = [{ status: "running" }])],
    ["a pending Trial", () => (state.experiments = [{ status: "pending" }])],
    ["an unreadable Trial list", () => (state.experimentsReject = true)],
  ])("%s keeps the Trials bench (Restore now) on screen; the GPU captures stay hidden", async (_n, arrange) => {
    arrange();
    const c = mount();
    await flush();
    expect(c.querySelector('[data-testid="trials-bench-stub"]')).not.toBeNull();
    expect(c.querySelector('[data-testid="gpu-profile-stub"]')).toBeNull();
  });

  // Break check: in LabConsole's measureKeys drop `(k === "benchmark" && tuningRunBench)` and Benchmark (its
  // Cancel) is gone.
  it.each([
    ["a benchmark run", () => (state.bench = { running: true })],
    ["a tweak trial", () => (state.trial = { running: true })],
    ["an unreadable benchmark state", () => (state.bench = null)],
  ])("%s keeps the Benchmark station (Cancel) listed; Latency and Tuning stay hidden", async (_n, arrange) => {
    arrange();
    const c = mount();
    await flush();
    const names = dockNames(c);
    expect(names).toContain("Benchmark");
    expect(names).not.toContain("Latency");
  });
});
