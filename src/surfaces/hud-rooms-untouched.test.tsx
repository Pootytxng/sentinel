import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { OptimizeV2 } from "./OptimizeV2";
import { MonitorV2 } from "./MonitorV2";
import { BlackbookV2 } from "./BlackbookV2";
import { LabV2 } from "./LabV2";
import type { SessionSummary } from "../types";

// Checkpoint guard (spec 2026-07-05-ui-deslop-organic-directive, CORRECTED direction):
// editorial is RETIRED and the Instrument-HUD pilot is HOME-ONLY until the owner eyeballs it —
// the other four rooms must render byte-identical whether the preview flag is on or off, with
// zero editorial/HUD DOM either way. When the rollout is approved this file is superseded by
// per-room flag guards (the home-hud-flag.test.tsx pattern).

vi.mock("./Check", () => ({ default: () => <div data-testid="check-stub" /> }));
vi.mock("./Fix", () => ({ default: () => <div data-testid="fix-stub" /> }));
vi.mock("./Play", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, default: () => <div data-testid="play-stub" /> };
});
vi.mock("./MonitorBasic", () => ({ MonitorBasic: () => <div data-testid="basic-stub" /> }));
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

// One light mount per room — the composed heavy surfaces are stubbed (covered by their own
// suites); what this file pins is that the flag changes NOTHING outside Home.
const ROOMS: { name: string; mount: () => HTMLElement }[] = [
  {
    name: "OptimizeV2",
    mount: () =>
      render(
        <OptimizeV2
          isAppliable={() => true}
          onOpenLibrary={() => {}}
          onChanged={() => {}}
          vendor="amd"
          recs={[]}
          startup={[]}
          changes={[]}
          busyId={null}
          activeChangeFor={() => undefined}
          onToggleRec={() => {}}
          onToggleStartup={() => {}}
          onRollback={() => {}}
          onApplyBatch={() => Promise.resolve({ applied: 0, skipped: [] })}
          readiness={null}
          priorities={null}
          activeCount={0}
        />,
      ).container,
  },
  {
    name: "MonitorV2",
    mount: () =>
      render(
        <MonitorV2
          active
          sessions={[session]}
          sessionsSeenAt=""
          priorities={null}
          recs={[]}
          apply={() => Promise.resolve()}
          busyId={null}
          onExport={() => {}}
          changes={[]}
          rollback={() => Promise.resolve()}
          vendor="amd"
        />,
      ).container,
  },
  {
    name: "BlackbookV2",
    mount: () => render(<BlackbookV2 focusId={null} vendor="amd" onClose={() => {}} />).container,
  },
  {
    name: "LabV2",
    mount: () => render(<LabV2 vendor="amd" />).container,
  },
];

describe("HUD pilot is Home-only: the four rooms ignore the flag (checkpoint contract)", () => {
  for (const room of ROOMS) {
    it(`${room.name}: flag on renders byte-identical to flag off, zero editorial/HUD DOM`, () => {
      const off = room.mount().innerHTML;
      cleanup();
      // Composed surfaces persist their own first-run state (e.g. Learn's grade-key fold) —
      // clear it so the SECOND mount is the same first-run, isolating the flag as the only delta.
      localStorage.clear();
      localStorage.setItem("compy_editorial", "1");
      const on = room.mount();
      expect(on.innerHTML).toBe(off);
      expect(on.querySelector(".edh-masthead-eyebrow")).toBeNull();
      expect(on.querySelector("[class*='hud-']")).toBeNull();
    });
  }
});
