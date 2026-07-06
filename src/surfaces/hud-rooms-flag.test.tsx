import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { OptimizeV2 } from "./OptimizeV2";
import { MonitorV2 } from "./MonitorV2";
import { BlackbookV2 } from "./BlackbookV2";
import { LabV2 } from "./LabV2";
import type { SessionSummary } from "../types";

// Four-room Instrument-HUD rollout guards (owner approval 2026-07-06 — supersedes
// hud-rooms-untouched.test.tsx, exactly as that checkpoint file said it would be; the flag
// is DEFAULT ON since the same approval, so "off" means the explicit "0" Settings failsafe).
// Pins, per room:
//   1. Flag "0" renders the pre-rollout tree with zero HUD DOM — the reversibility contract,
//      same as home-hud-flag.test.tsx; flag absent (the shipped default) renders the HUD.
//   2. Flag on adds ONLY the masthead eyebrow + the .hud-headline wrapper — removing them
//      restores the flag-off tree byte-for-byte (presentation-only proof: same verdict text,
//      same body, nothing else moved).
//   3. LED honesty: the eyebrow LED renders only from a REAL room state — Optimize scan
//      while the catalog loads / ok at all-clear; Monitor, Blackbook and Lab (no live state
//      computed at the shell) render no LED.

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

const optimizeProps = {
  isAppliable: () => true,
  onOpenLibrary: () => {},
  onChanged: () => {},
  vendor: "amd" as const,
  recs: [],
  startup: [],
  changes: [],
  busyId: null,
  activeChangeFor: () => undefined,
  onToggleRec: () => {},
  onToggleStartup: () => {},
  onRollback: () => {},
  onApplyBatch: () => Promise.resolve({ applied: 0, skipped: [] }),
  readiness: null,
  priorities: null,
  activeCount: 0,
};

const ROOMS: { name: string; label: string; mount: () => HTMLElement }[] = [
  {
    name: "OptimizeV2",
    label: "Repair bay",
    mount: () => render(<OptimizeV2 {...optimizeProps} />).container,
  },
  {
    name: "MonitorV2",
    label: "Live telemetry",
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
    label: "Field records",
    mount: () => render(<BlackbookV2 focusId={null} vendor="amd" onClose={() => {}} />).container,
  },
  {
    name: "LabV2",
    label: "Test bench",
    mount: () => render(<LabV2 vendor="amd" />).container,
  },
];

// Mount with a per-room clean first-run (composed surfaces persist their own state — e.g.
// Learn's grade-key fold — so storage is reset before every mount, keeping the flag the
// ONLY delta between comparisons).
const mountWithFlag = (room: (typeof ROOMS)[number], flag: string | null) => {
  localStorage.clear();
  if (flag != null) localStorage.setItem("compy_editorial", flag);
  return room.mount();
};

describe("HUD four-room rollout: flag-off byte-identity (the classic failsafe)", () => {
  for (const room of ROOMS) {
    it(`${room.name}: flag='0' renders zero HUD DOM; flag absent (default ON) renders the masthead`, () => {
      const off = mountWithFlag(room, "0");
      expect(off.querySelector(".hud-masthead-eyebrow")).toBeNull();
      expect(off.querySelector("[class*='hud-']")).toBeNull();
      cleanup();
      const absent = mountWithFlag(room, null);
      expect(absent.querySelector(".hud-masthead-eyebrow")).not.toBeNull();
    });
  }
});

describe("HUD four-room rollout: flag-on adds ONLY the masthead (presentation-only proof)", () => {
  for (const room of ROOMS) {
    it(`${room.name}: eyebrow reads "${room.label}", and removing masthead + unwrapping the headline restores the flag-off tree`, () => {
      const off = mountWithFlag(room, "0").innerHTML;
      cleanup();
      const on = mountWithFlag(room, "1");
      const eyebrow = on.querySelector(".hud-masthead-eyebrow");
      expect(eyebrow).not.toBeNull();
      expect(eyebrow!.textContent).toContain(room.label);
      const headline = on.querySelector(".hud-headline");
      expect(headline).not.toBeNull();
      // Strip exactly what the flag added; everything left must be the flag-off tree.
      eyebrow!.remove();
      headline!.replaceWith(...Array.from(headline!.childNodes));
      expect(on.innerHTML).toBe(off);
    });
  }
});

describe("HUD four-room rollout: LED honesty (real state or no LED)", () => {
  it("Optimize: all-clear catalog → ok LED; catalog still loading → scan LED", () => {
    const clear = mountWithFlag(ROOMS[0], "1");
    expect(clear.querySelector(".hud-masthead-eyebrow .hud-led-ok")).not.toBeNull();
    expect(clear.querySelector(".hud-led-scan")).toBeNull();
    cleanup();
    localStorage.clear();
    localStorage.setItem("compy_editorial", "1");
    const loading = render(<OptimizeV2 {...optimizeProps} recs={null} />).container;
    expect(loading.querySelector(".hud-masthead-eyebrow .hud-led-scan")).not.toBeNull();
  });

  for (const room of ROOMS.slice(1)) {
    it(`${room.name}: no live room state → no LED in the eyebrow`, () => {
      const on = mountWithFlag(room, "1");
      expect(on.querySelector(".hud-masthead-eyebrow .hud-led")).toBeNull();
    });
  }
});
