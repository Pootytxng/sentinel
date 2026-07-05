import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { OptimizeV2 } from "./OptimizeV2";
import { MonitorV2 } from "./MonitorV2";
import { BlackbookV2 } from "./BlackbookV2";
import { LabV2 } from "./LabV2";
import type { SessionSummary } from "../types";

// Editorial rollout guards (spec 2026-07-05-ui-deslop-organic-directive): the four remaining
// rooms wear the editorial masthead ONLY under compy_editorial — flag off (absent OR "0"),
// each room renders byte-identical with zero editorial DOM (P-series contract, same standard
// as home-editorial-flag.test.tsx). Flag on, each room's masthead eyebrow is pinned and the
// verdict stays the pure helper's text (composed, not decoded).

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
// suites); what this file pins is the masthead contract around them.
const ROOMS: { name: string; eyebrow: string; mount: () => HTMLElement }[] = [
  {
    name: "OptimizeV2",
    eyebrow: "The fix list",
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
    eyebrow: "Live telemetry",
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
    eyebrow: "Claims, graded",
    mount: () => render(<BlackbookV2 focusId={null} vendor="amd" onClose={() => {}} />).container,
  },
  {
    name: "LabV2",
    eyebrow: "The bench",
    mount: () => render(<LabV2 vendor="amd" />).container,
  },
];

describe("compy_editorial flag-off byte-identity (rollout rooms)", () => {
  for (const room of ROOMS) {
    it(`${room.name}: flag absent and flag='0' render byte-identical, zero editorial DOM`, () => {
      const absent = room.mount().innerHTML;
      cleanup();
      // Composed surfaces persist their own first-run state (e.g. Learn's grade-key fold) —
      // clear it so the SECOND mount is the same first-run, isolating the flag as the only delta.
      localStorage.clear();
      localStorage.setItem("compy_editorial", "0");
      const off = room.mount();
      expect(off.innerHTML).toBe(absent);
      expect(off.querySelector(".edh-masthead-eyebrow")).toBeNull();
    });
  }
});

describe("compy_editorial flag-on masthead (rollout rooms)", () => {
  for (const room of ROOMS) {
    it(`${room.name}: wears its eyebrow inside the ONE RoomShell verdict`, () => {
      localStorage.setItem("compy_editorial", "1");
      const c = room.mount();
      const eyebrows = c.querySelectorAll(".edh-masthead-eyebrow");
      expect(eyebrows).toHaveLength(1);
      expect(eyebrows[0].textContent).toBe(room.eyebrow);
      expect(c.querySelectorAll(".v2-verdict h1")).toHaveLength(1);
    });
  }
});
