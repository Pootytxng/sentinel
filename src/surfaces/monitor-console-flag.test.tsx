import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MonitorV2 } from "./MonitorV2";
import type { SessionSummary } from "../types";

// Guards for the Monitor console preview flag (plan 2026-07-10-console-hud-phase3-monitor,
// Task 1). compy_monitor_console is DEFAULT OFF the whole phase: key absent or "0", MonitorV2
// renders exactly today's tree (absent === "0" pinned byte-identical for BOTH compy_editorial
// states, so the default can't drift ON silently). Literal "1" swaps ONLY the Live face for
// the console instrument cluster (`.monitor-console`) — the Sessions segment renders the same
// audited face in both flag states. Post-flip lesson from home-console-flag.test.tsx encoded:
// monitor-v2.test.tsx mounts MonitorV2 with the key ABSENT and pins the CLASSIC faces — if
// this default ever flips, that suite must be re-pointed the same commit, not left lying.

// Play and MonitorBasic are the audited heavy surfaces — composed VERBATIM with the same
// props and covered by their own suites (same stubbing rationale as monitor-v2.test.tsx).
vi.mock("./Play", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    default: (props: { view: string }) => <div data-testid={`play-${props.view}`} />,
  };
});
vi.mock("./MonitorBasic", () => ({
  MonitorBasic: () => <div data-testid="monitor-basic" />,
}));
// MonitorV2's one-shot sensor pre-warm (read-only) — jsdom has no Tauri IPC.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(null) }));

beforeAll(() => {
  class RO {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= RO;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= IO;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  delete document.documentElement.dataset.viewMode;
});

const session: SessionSummary = {
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

function mount() {
  return render(
    <MonitorV2
      active
      sessions={[session]}
      sessionsSeenAt=""
      priorities={null}
      recs={[]}
      apply={vi.fn()}
      busyId={null}
      onExport={vi.fn()}
      changes={[]}
      rollback={vi.fn()}
      vendor="amd"
    />,
  );
}

// Reduced motion keeps the render deterministic for the byte-compares (no DecryptedText churn).
const useReduced = () => localStorage.setItem("compy_motion", "reduced");
const useAdvanced = () => localStorage.setItem("compy_view_mode", "advanced");

describe("Monitor console DEFAULT OFF — absent === '0', today's tree exactly (the failsafe contract)", () => {
  it("hud default (editorial absent): key absent renders the classic Basic face, byte-identical to key '0'", () => {
    useReduced();
    const absent = mount().container.innerHTML;
    expect(absent).toContain("monitor-basic");
    expect(absent).not.toContain("monitor-console");
    cleanup();
    localStorage.setItem("compy_monitor_console", "0");
    const off = mount().container.innerHTML;
    expect(off).toBe(absent);
  });

  it("classic failsafe (editorial '0'): key absent === key '0' there too", () => {
    useReduced();
    localStorage.setItem("compy_editorial", "0");
    const absent = mount().container.innerHTML;
    expect(absent).toContain("monitor-basic");
    expect(absent).not.toContain("monitor-console");
    cleanup();
    localStorage.setItem("compy_monitor_console", "0");
    const off = mount().container.innerHTML;
    expect(off).toBe(absent);
  });

  it("Advanced Live keeps the classic Play live face when the key is absent", () => {
    useReduced();
    useAdvanced();
    const { container } = mount();
    expect(screen.getByTestId("play-live")).toBeTruthy();
    expect(container.querySelector(".monitor-console")).toBeNull();
  });
});

describe("Monitor console '1' — the console face takes the Live segment ONLY", () => {
  it("Basic: the console root renders and the classic Basic live face does not", () => {
    useReduced();
    localStorage.setItem("compy_monitor_console", "1");
    const { container } = mount();
    expect(container.querySelector(".monitor-console")).not.toBeNull();
    expect(screen.queryByTestId("monitor-basic")).toBeNull();
  });

  it("Advanced Live: the console root renders and the classic Play live face does not", () => {
    useReduced();
    useAdvanced();
    localStorage.setItem("compy_monitor_console", "1");
    const { container } = mount();
    expect(container.querySelector(".monitor-console")).not.toBeNull();
    expect(screen.queryByTestId("play-live")).toBeNull();
  });

  it("Sessions segment is UNTOUCHED in both flag states (same audited face)", () => {
    useReduced();
    useAdvanced();
    localStorage.setItem("compy_monitor_console", "1");
    const { container } = mount();
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(screen.getByTestId("play-sessions")).toBeTruthy();
    expect(container.querySelector(".monitor-console")).toBeNull();
    cleanup();
    localStorage.setItem("compy_monitor_console", "0");
    useAdvanced();
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(screen.getByTestId("play-sessions")).toBeTruthy();
  });
});
