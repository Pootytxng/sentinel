import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MonitorConsole } from "./MonitorConsole";
import type { SessionSummary } from "../types";

// MonitorConsole guards (plan 2026-07-10-console-hud-phase3-monitor, Task 3): the instruments
// draw ONLY real polled telemetry — (a) a live fps stream feeds the fps + frametime
// oscilloscopes and the gauges show measured values with graded ink; (b) helper stopped ⇒
// honest STOPPED/no-signal states, never a frozen-as-live trace, never a fabricated number;
// (c) capture state keeps mirroring up via onFpsActive (the V2-8 door); (d) NVIDIA GPU temp
// stays ungraded (LOCKED rule 5); (e) header-slop pin — no headings/ledes in the subtree.

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

// jsdom has no WebGL — the lazy 3D hero is covered by ribbon-profile.test.ts (pure geometry)
// + the live self-review; here we pin its mount/unmount contract.
vi.mock("./monitor/FrametimeRibbon", () => ({
  FrametimeRibbon: () => <div data-testid="frametime-ribbon" />,
}));

const cpuSnap = {
  usage_overall_pct: 34.2,
  frequency_mhz: 5100,
  ram_used_bytes: 14.2 * 1024 ** 3,
  ram_total_bytes: 29.4 * 1024 ** 3,
};
const gpuSnap = [{ vendor: "amd", temperature_c: 62, utilization_gpu_pct: 97 }];
const liveFps = {
  active: true,
  status: "capturing",
  sample: {
    fps: 142.3,
    low1_fps: 98.4,
    avg_frametime_ms: 7.0,
    recent_frametimes_ms: [7.1, 6.9, 7.3, 7.0],
  },
};
const stoppedFps = { active: false, status: "idle", sample: null };

function mockPolls(fpsImpl: () => unknown) {
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "get_cpu_sensors") return Promise.resolve(cpuSnap);
    if (cmd === "get_gpu_sensors") return Promise.resolve(gpuSnap);
    if (cmd === "get_fps_status") return Promise.resolve(fpsImpl());
    return Promise.resolve(null);
  });
}

const session = {
  started_at: "2026-07-03T00:00:00Z",
  duration_secs: 2520,
  process_name: "valorant.exe",
  samples: 3412,
  avg_fps: 240.2,
  avg_frametime_ms: 4.2,
  low1_fps_est: 190.1,
  peak_gpu_temp_c: 72,
  peak_gpu_usage_pct: 98,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 1,
} as SessionSummary;

function mount(over: Partial<Parameters<typeof MonitorConsole>[0]> = {}) {
  const props = {
    active: true,
    vendor: "amd" as const,
    mode: "basic" as const,
    sessions: [session],
    onFpsActive: vi.fn(),
    onOpenSessions: vi.fn(),
    ...over,
  };
  const utils = render(<MonitorConsole {...props} />);
  return { ...utils, props };
}

beforeEach(() => {
  // Snap CountTo/motion so gauge numbers render final values immediately.
  localStorage.setItem("compy_motion", "reduced");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  invokeMock.mockReset();
});

describe("MonitorConsole — live stream feeds real instruments (a)", () => {
  it("fps + frametime oscilloscopes draw the buffered real samples; gauges show measured values with graded ink", async () => {
    mockPolls(() => liveFps);
    const { container } = mount();
    await waitFor(() => {
      // Both scopes carry a trace — the frametime one with one point per real frame sample.
      const traces = container.querySelectorAll(".osc-trace");
      expect(traces.length).toBe(2);
    });
    const ftPts = container
      .querySelectorAll(".osc-trace")[1]
      ?.getAttribute("points")
      ?.trim()
      .split(/\s+/);
    expect(ftPts).toHaveLength(liveFps.sample.recent_frametimes_ms.length);
    // Latest readouts are the real values.
    expect(screen.getByText(/142\s*fps/)).toBeTruthy();
    expect(screen.getByText(/7\s*ms/)).toBeTruthy();
    // Gauges: AMD GPU temp 62°C grades (non-neutral ink), CPU stays deliberately ungraded.
    const gauges = container.querySelectorAll(".arc-gauge");
    expect(gauges.length).toBeGreaterThanOrEqual(3);
    expect(container.querySelector(".arc-gauge.ag-good")).not.toBeNull();
    await waitFor(() => expect(screen.getByText("62")).toBeTruthy());
    expect(screen.getByText("34")).toBeTruthy(); // CPU %
    expect(screen.getByText("48")).toBeTruthy(); // RAM % (14.2/29.4)
  });

  it("consumer-term readouts derive from the same real windows (v3 T2)", async () => {
    mockPolls(() => liveFps);
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll(".osc-trace").length).toBe(2));
    for (const label of ["MAX FPS", "AVG FPS", "LOWEST LATENCY", "SPIKES"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // One poll buffered fps 142.3 → MAX and AVG both read 142; lowest latency = min(6.9…) ms.
    const values = [...container.querySelectorAll(".mc-readout-v")].map((n) => n.textContent);
    expect(values[0]).toBe("142");
    expect(values[1]).toBe("142");
    expect(values[2]).toBe("6.9 ms");
    expect(values[3]).toBe("0");
  });

  it("the 3D ribbon hero mounts ONLY on a live window; stopped ⇒ gone (v3 T4)", async () => {
    let live = true;
    mockPolls(() => (live ? liveFps : stoppedFps));
    mount();
    expect(await screen.findByTestId("frametime-ribbon")).toBeTruthy();
    live = false;
    await waitFor(() => expect(screen.queryByTestId("frametime-ribbon")).toBeNull(), {
      timeout: 3000,
    });
  }, 8000);

  it("overlay control rides the same audited commands (v3 T4): show on toggle, corner picker persists", async () => {
    mockPolls(() => liveFps);
    mount();
    const btn = await screen.findByRole("button", { name: "Overlay" });
    btn.click();
    await waitFor(() => expect(invokeMock).toHaveBeenCalledWith("show_overlay"));
    const corner = await screen.findByRole("button", { name: "Overlay corner bottom right" });
    corner.click();
    await waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("set_overlay_corner", { corner: "bottom-right" }),
    );
    expect(localStorage.getItem("compy_overlay_corner")).toBe("bottom-right");
  });

  it("capture ON mirrors up via onFpsActive (c)", async () => {
    mockPolls(() => liveFps);
    const { props } = mount();
    await waitFor(() => expect(props.onFpsActive).toHaveBeenLastCalledWith(true));
  });
});

describe("MonitorConsole — helper stopped ⇒ honest stillness (b)", () => {
  it("stopped ⇒ no-signal on BOTH scopes, Start capture control, no fabricated numbers", async () => {
    mockPolls(() => stoppedFps);
    const { container } = mount();
    await waitFor(() => {
      expect(container.querySelectorAll(".osc-nosignal").length).toBe(2);
    });
    expect(container.querySelectorAll(".osc-trace").length).toBe(0);
    expect(container.querySelectorAll(".osc-read").length).toBe(0); // no readout invented
    expect(screen.getByRole("button", { name: "Start capture" })).toBeTruthy();
    expect(screen.getByText("start capture, then play")).toBeTruthy();
    // v3 readouts show honest em-dashes, never fabricated zeros.
    const values = [...container.querySelectorAll(".mc-readout-v")].map((n) => n.textContent);
    expect(values).toEqual(["—", "—", "—", "—"]);
  });

  it("a live trace CLEARS when the helper stops — never frozen-as-live (and the door signal follows)", async () => {
    let live = true;
    mockPolls(() => (live ? liveFps : stoppedFps));
    const { container, props } = mount();
    await waitFor(() => expect(container.querySelectorAll(".osc-trace").length).toBe(2));
    live = false; // next 1 Hz poll reports stopped
    await waitFor(
      () => expect(container.querySelectorAll(".osc-nosignal").length).toBe(2),
      { timeout: 3000 },
    );
    expect(container.querySelectorAll(".osc-trace").length).toBe(0);
    expect(props.onFpsActive).toHaveBeenLastCalledWith(false);
  }, 8000);
});

describe("MonitorConsole — vendor honesty (d)", () => {
  it("NVIDIA fixture ⇒ the GPU temp gauge stays ungraded (LOCKED rule 5)", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "get_cpu_sensors") return Promise.resolve(cpuSnap);
      if (cmd === "get_gpu_sensors")
        return Promise.resolve([{ vendor: "nvidia", temperature_c: 62, utilization_gpu_pct: 97 }]);
      if (cmd === "get_fps_status") return Promise.resolve(stoppedFps);
      return Promise.resolve(null);
    });
    mount({ vendor: "nvidia" });
    await waitFor(() => expect(screen.getByText("62")).toBeTruthy());
    const gpuGauge = screen.getByText("GPU temp").closest(".arc-gauge");
    expect(gpuGauge?.classList.contains("ag-neutral")).toBe(true);
    expect(gpuGauge?.classList.contains("ag-good")).toBe(false);
    expect(gpuGauge?.classList.contains("ag-warn")).toBe(false);
  });
});

describe("MonitorConsole — motion contract (Task 4)", () => {
  it("reduced motion → the console root carries data-motion='reduced' (still page), no reticle", async () => {
    mockPolls(() => liveFps);
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".monitor-console")).not.toBeNull());
    expect(container.querySelector(".monitor-console")!.getAttribute("data-motion")).toBe(
      "reduced",
    );
    // The reticle Target Cursor renders nothing under reduced motion (kit contract).
    expect(container.querySelector(".lc-reticle")).toBeNull();
  });

  it("full motion → data-motion='full' (the reveal/spotlight CSS keys off it)", async () => {
    localStorage.setItem("compy_motion", "full");
    mockPolls(() => liveFps);
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".monitor-console")).not.toBeNull());
    expect(container.querySelector(".monitor-console")!.getAttribute("data-motion")).toBe("full");
  });

  it("never paints the vendor MagicBento purple — the console is token-only", async () => {
    mockPolls(() => liveFps);
    const { container } = mount();
    await waitFor(() => expect(container.querySelectorAll(".osc-trace").length).toBe(2));
    expect(container.innerHTML).not.toMatch(/132\s*,\s*0\s*,\s*255/);
  });
});

describe("MonitorConsole — laws (e) + the mode split", () => {
  it("header-slop pin: no headings or lede strips inside the console subtree", async () => {
    mockPolls(() => liveFps);
    const { container } = mount();
    await waitFor(() => expect(container.querySelector(".monitor-console")).not.toBeNull());
    expect(container.querySelectorAll("h1, h2, h3").length).toBe(0);
  });

  it("Advanced shows the fuller cluster (GPU load gauge); Basic the core set", async () => {
    mockPolls(() => liveFps);
    const basic = mount({ mode: "basic" });
    await waitFor(() => expect(screen.getByText("GPU temp")).toBeTruthy());
    expect(screen.queryByText("GPU load")).toBeNull();
    cleanup();
    mockPolls(() => liveFps);
    mount({ mode: "advanced" });
    await waitFor(() => expect(screen.getByText("GPU load")).toBeTruthy());
    void basic;
  });

  it("Basic keeps the last-session door (never a dead end); Advanced has the Sessions tab instead", async () => {
    mockPolls(() => liveFps);
    const { props } = mount({ mode: "basic" });
    await waitFor(() => expect(screen.getByText(/Last session/)).toBeTruthy());
    screen.getByText(/Last session/).closest("button")!.click();
    expect(props.onOpenSessions).toHaveBeenCalled();
    cleanup();
    mockPolls(() => liveFps);
    mount({ mode: "advanced" });
    await waitFor(() => expect(screen.getByText("GPU load")).toBeTruthy());
    expect(screen.queryByText(/Last session/)).toBeNull();
  });
});
