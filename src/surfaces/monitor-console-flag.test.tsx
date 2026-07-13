import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { MonitorV2 } from "./MonitorV2";
import type { SessionSummary } from "../types";

// Guards for the Monitor console flag (plan 2026-07-10-console-hud-phase3-monitor). Since
// 2026-07-12 compy_monitor_console is DEFAULT ON (owner "flip it default on" after the v5
// flight-deck + session-stack eyeball, ship-approved-work-as-the-build): key absent or "1"
// renders the console instrument cluster (`.monitor-console`), byte-identical; the classic
// live tiles stay reachable ONLY behind the literal "0" failsafe, pinned for BOTH
// compy_editorial states so the failsafe can't drift ON silently. The Sessions segment renders
// the same audited face in every flag state. Sibling re-point (same commit): monitor-v2.test.tsx
// now sets the key to "0" so it keeps pinning the CLASSIC tree it always did — the default
// flipped, its subject didn't.

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

describe("Monitor console DEFAULT ON — absent renders the console face; '0' is the classic failsafe", () => {
  it("hud default (editorial absent): key absent renders the console face, byte-identical to key '1'", () => {
    useReduced();
    const absent = mount().container.innerHTML;
    expect(absent).toContain("monitor-console");
    expect(absent).not.toContain("monitor-basic");
    cleanup();
    localStorage.setItem("compy_monitor_console", "1");
    const on = mount().container.innerHTML;
    expect(on).toBe(absent);
  });

  it("classic failsafe ('0'): the literal '0' renders today's classic Basic face, no console — both editorial states", () => {
    useReduced();
    localStorage.setItem("compy_monitor_console", "0");
    const off = mount().container.innerHTML;
    expect(off).toContain("monitor-basic");
    expect(off).not.toContain("monitor-console");
    cleanup();
    localStorage.setItem("compy_editorial", "0");
    localStorage.setItem("compy_monitor_console", "0");
    const offEditorial = mount().container.innerHTML;
    expect(offEditorial).toContain("monitor-basic");
    expect(offEditorial).not.toContain("monitor-console");
  });

  it("Advanced Live: absent renders the console (default ON); '0' keeps the classic Play live face", () => {
    useReduced();
    useAdvanced();
    const on = mount();
    expect(on.container.querySelector(".monitor-console")).not.toBeNull();
    cleanup();
    localStorage.setItem("compy_monitor_console", "0");
    useAdvanced();
    const { container } = mount();
    expect(screen.getByTestId("play-live")).toBeTruthy();
    expect(container.querySelector(".monitor-console")).toBeNull();
  });
});

describe("Monitor console '1' — explicit on matches the default; console takes the Live segment ONLY", () => {
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

  it("Sessions segment is UNTOUCHED in every flag state (same audited face)", () => {
    useReduced();
    useAdvanced();
    // default ON (key absent): Sessions still the same audited face
    const first = mount();
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(screen.getByTestId("play-sessions")).toBeTruthy();
    expect(first.container.querySelector(".monitor-console")).toBeNull();
    cleanup();
    // classic failsafe
    localStorage.setItem("compy_monitor_console", "0");
    useAdvanced();
    mount();
    fireEvent.click(screen.getByRole("tab", { name: "Sessions" }));
    expect(screen.getByTestId("play-sessions")).toBeTruthy();
  });
});
