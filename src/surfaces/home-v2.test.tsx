import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { HomeV2 } from "./HomeV2";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";
import { postureLine } from "./command-center-data";
import { inEffectCounts } from "../data/machine-model";
// i18n update (2026-07-23): postureLine now takes a TFunction as its last param — the real
// i18next instance (English default, same as every assertion below already expects).
import i18n from "../i18n";
import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";

// V2-3 guards (bug→guard tier 1): the V2 Home room composes RoomShell (one verdict, one door),
// its verdict IS postureLine's measured output (never a parallel copy), the scan sweep renders
// ONLY while checks are actually running, part-tags stay honest (CPU temp n/a by design; live
// values only when the probe returned one), and every empty state is honest (no fabricated
// session numbers, no invented limiter on a clean rig).

// The r3f hologram can't mount in jsdom — stub it (the REAL scene is covered by rig-parts tests
// + the live self-review). The stage/tags/sweep around it are what this file pins.
vi.mock("./rig/RigHologram", () => ({
  RigHologram: () => <div data-testid="rig-hologram" />,
}));

// Settable for the hybrid-laptop case; reset after each test.
const sensors = vi.hoisted(() => ({ list: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "get_build_stamp") return Promise.resolve("ab12cd3 · dev");
    if (cmd === "get_gpu_sensors") return Promise.resolve(sensors.list ?? [{ vendor: "AMD", name: "AMD Radeon RX 9070 XT", temperature_c: 62 }]);
    if (cmd === "get_memory_pressure")
      return Promise.resolve({
        used_bytes: 14.2 * 1024 ** 3,
        total_bytes: 29.4 * 1024 ** 3,
        level: "ok",
      });
    return Promise.resolve(null);
  },
}));

beforeAll(() => {
  // jsdom lacks both observers the vendored components use (ElectricBorder → ResizeObserver,
  // CountUp/DecryptedText → IntersectionObserver). Inert stubs — animation just never starts.
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
});

const hw = {
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

const readiness: GameReadiness = {
  checks: [
    { id: "a", label: "A", status: "ready", detail: "", value: null },
    { id: "b", label: "B", status: "ready", detail: "", value: null },
    { id: "c", label: "C", status: "ready", detail: "", value: null },
  ],
  ready_count: 3,
  attention_count: 0,
  unknown_count: 0,
  advisory_count: 0,
  advisory: "",
  dismissed_ids: [],
  drifts: [],
};

const priorities: Priorities = {
  limiters: [
    { id: "disk", title: "C: drive is 87% full", reason: "Below ~10% free, load times suffer.", linked: null, confidence: "high", status: "attention" },
    { id: "drv", title: "GPU driver update available", reason: "Newer may help in recent titles.", linked: null, confidence: "medium", status: "unknown" },
  ],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
};

const cleanPriorities: Priorities = { ...priorities, limiters: [] };

const session = {
  started_at: "2026-07-01T18:00:00Z",
  duration_secs: 3600,
  process_name: "cyberpunk2077.exe",
  samples: 1000,
  avg_fps: 142.3,
  avg_frametime_ms: 7,
  low1_fps_est: 98.4,
  peak_gpu_temp_c: 71,
  peak_gpu_usage_pct: 97,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 1,
} as SessionSummary;

const change = {
  id: "ch1",
  rec_id: "hags-enable",
  rec_title: "Hardware-accelerated GPU scheduling",
  applied_at: "2026-06-28T18:22:00Z",
  snapshot: null,
  status: "applied",
  is_still_active: true,
} as unknown as AppliedChange;

function mount(over?: Partial<Parameters<typeof HomeV2>[0]>) {
  const props = {
    hw,
    readiness,
    priorities,
    sessions: [session],
    changes: [change],
    onRunCheck: vi.fn(),
    onSeeInFix: vi.fn(),
    ...over,
  };
  const utils = render(
    <ShellV2
      items={railFor(true)}
      activeId="home"
      onNavigate={() => {}}
      ledger={props.changes}
     
    >
      <HomeV2 {...props} />
    </ShellV2>,
  );
  return { ...utils, props };
}

// Reduced motion → plain text/numbers (no DecryptedText/CountUp/ElectricBorder) — the paths the
// honesty assertions read directly.
const useReduced = () => localStorage.setItem("compy_motion", "reduced");

describe("HomeV2 — RoomShell composition", () => {
  it("renders ONE verdict (postureLine's real output) and ONE forward door to Optimize", () => {
    useReduced();
    const { container } = mount();
    const expected = postureLine(readiness, priorities, inEffectCounts(null), i18n.t);
    const h1s = container.querySelectorAll(".v2-verdict h1");
    expect(h1s.length).toBe(1);
    expect(h1s[0].textContent).toBe(expected.headline);
    const doors = container.querySelectorAll(".v2-door");
    expect(doors.length).toBe(1);
    expect(doors[0].textContent).toContain("Find what's worth fixing");
  });

  it("measured line derives from real readiness counts", () => {
    useReduced();
    mount();
    expect(
      screen.getByText("3/3 checks measured · nothing needs urgent attention"),
    ).toBeTruthy();
  });
});

describe("HomeV2 — scan sweep is tied to REAL check activity", () => {
  it("renders the sweep only while readiness is unresolved", () => {
    const { container, unmount } = mount({ readiness: null, priorities: null });
    expect(container.querySelector(".hv2-scan")).toBeTruthy();
    expect(screen.getByText("running checks…")).toBeTruthy();
    unmount();
    const { container: settled } = mount();
    expect(settled.querySelector(".hv2-scan")).toBeNull();
  });

  it("reduced motion → no sweep even while checking (frozen, honest stillness)", () => {
    useReduced();
    const { container } = mount({ readiness: null, priorities: null });
    // The CSS kills the animation; the JS side also skips the element under reduced motion.
    expect(container.querySelector(".hv2-scan")).toBeNull();
  });
});

describe("HomeV2 — part-tags stay honest", () => {
  it("CPU tag says temp n/a by design (LOCKED rule #1 — no kernel driver, no CPU temp)", () => {
    useReduced();
    mount();
    expect(screen.getByText("temp n/a — by design")).toBeTruthy();
  });

  // Review 2026-11-03: HomeV2 named gpus[0] (a hybrid laptop's iGPU) and paired the first snapshot.
  it("a hybrid laptop's GPU tag names the primary GPU and shows its own reading", async () => {
    useReduced();
    sensors.list = [{ vendor: "NVIDIA", name: "NVIDIA GeForce RTX 4060 Laptop GPU", temperature_c: 91 }];
    try {
      mount({
        hw: {
          ...hw,
          gpus: [
            { name: "Intel(R) UHD Graphics 770", vram_bytes: 128 * 1024 ** 2 },
            { name: "NVIDIA GeForce RTX 4060 Laptop GPU", vram_bytes: 8 * 1024 ** 3 },
          ],
        } as never,
      });
      expect(await screen.findByText("91°C")).toBeTruthy();
      expect(screen.getByText("RTX 4060 Laptop GPU")).toBeTruthy();
    } finally {
      sensors.list = null;
    }
  });

  it("GPU tag shows the live temp once the probe returns; storage % is the real C: math", async () => {
    useReduced();
    mount();
    expect(await screen.findByText("62°C")).toBeTruthy();
    expect(screen.getByText("C: 87% full")).toBeTruthy(); // (1000-130)/1000
  });
});

describe("HomeV2 — honest empty states", () => {
  it("no sessions → the honest capture line, never fabricated fps", () => {
    useReduced();
    mount({ sessions: [] });
    expect(
      screen.getByText("Play a session to see this — Compy captures it from outside the game."),
    ).toBeTruthy();
  });

  it("empty ledger → 'nothing applied yet'", () => {
    useReduced();
    mount({ changes: [] });
    expect(screen.getByText(/nothing applied yet/)).toBeTruthy();
  });

  it("clean rig → no invented limiter", () => {
    useReduced();
    mount({ priorities: cleanPriorities });
    expect(screen.getByText(/measured clean on this rig/)).toBeTruthy();
    expect(document.querySelectorAll(".hv2-row").length).toBe(1);
  });

  it("priorities not resolved yet → skeleton, never placeholder claims", () => {
    useReduced();
    const { container } = mount({ priorities: null });
    expect(container.querySelectorAll(".hv2-skel").length).toBeGreaterThan(0);
  });
});

// Glanceable fill (spec 2026-07-05): drift-watch + drive-health cards are measured-or-honestly-
// absent — empty sources render the honest copy (no number), populated sources render the real
// value from props. No fabricated-value path exists.
describe("HomeV2 — glance cards (fill pass)", () => {
  it("no drifts → \"Nothing's drifted\" (ok), never a fabricated count", () => {
    useReduced();
    mount();
    expect(screen.getByText("Nothing's drifted")).toBeTruthy();
    // The note names what drift actually folds — readiness-check observations, never the
    // applied-change list (readiness.rs). It used to say "every applied change is still holding",
    // which claimed a set drift never reads; see ledger-health-home-guard.test.tsx.
    expect(screen.getByText("no check Compy watches has slipped since last time")).toBeTruthy();
  });

  it("N drifts → honest count, then a pointer to the Care view's list, never the names restated (P6-timeline)", () => {
    useReduced();
    const open = vi.fn();
    mount({
      onOpenLabStation: open,
      readiness: {
        ...readiness,
        drifts: [
          { id: "d1", label: "Game Mode", detail: "", noticed_at: "2026-07-04T10:00:00Z" },
          { id: "d2", label: "Power plan", detail: "", noticed_at: "2026-07-04T10:00:00Z" },
          { id: "d3", label: "SysMain", detail: "", noticed_at: "2026-07-04T10:00:00Z" },
        ],
      },
    });
    expect(screen.getByText("3 settings changed since they were last good")).toBeTruthy();
    expect(screen.queryByText(/Game Mode/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "see what changed" }));
    expect(open).toHaveBeenCalledWith("blackbox");
    cleanup();
    // Without the deep-link the pointer is text that still names where the list is.
    mount({ readiness: { ...readiness, drifts: [{ id: "d1", label: "Game Mode", detail: "", noticed_at: "2026-07-04T10:00:00Z" }] } });
    expect(screen.getByText("listed on Crash & Freeze Rescue")).toBeTruthy();
    expect(screen.queryByText(/Game Mode/)).toBeNull();
  });

  it("readiness unresolved → drift card claims nothing", () => {
    useReduced();
    mount({ readiness: null, priorities: null });
    expect(screen.getByText("drift status lands with the current check")).toBeTruthy();
    expect(screen.queryByText("Nothing's drifted")).toBeNull();
  });

  it("no SMART reads → honest absence, no drive count", () => {
    useReduced();
    mount(); // fixture hw has no disk_health entries
    expect(screen.getByText(/no SMART reading from this rig/)).toBeTruthy();
    expect(screen.queryByText("Drives healthy")).toBeNull();
  });

  it("all drives Healthy → 'Drives healthy' with the real count; Unknown reads omitted", () => {
    useReduced();
    mount({
      hw: {
        ...hw,
        disk_health: [
          { friendly_name: "CT1000P510SSD5", health: "Healthy" },
          { friendly_name: "WD Blue", health: "Healthy" },
          { friendly_name: "Mystery Drive", health: "Unknown" }, // no SMART read → omitted
        ],
      } as HardwareInfo,
    });
    expect(screen.getByText("Drives healthy")).toBeTruthy();
    expect(screen.getByText("2 drives · SMART OK")).toBeTruthy();
  });

  it("a flagged drive is named with its measured status (warn)", () => {
    useReduced();
    mount({
      hw: {
        ...hw,
        disk_health: [
          { friendly_name: "CT1000P510SSD5", health: "Warning" },
          { friendly_name: "WD Blue", health: "Healthy" },
        ],
      } as HardwareInfo,
    });
    expect(screen.getByText("CT1000P510SSD5 — Warning")).toBeTruthy();
    expect(screen.queryByText("Drives healthy")).toBeNull();
  });
});

// Deslop directive #4 (bug→guard): the last-session numbers are GRADED against this rig, never
// plain white — the value element must carry the hardware-derived tone class. Neutral (nothing
// measured) stays unclassed/uncolored: honesty means no grade is also visible as no color.
describe("HomeV2 — last-session numbers carry hardware-graded tone", () => {
  it("fps avg is graded vs the display's refresh; 1% low vs the session's own average", () => {
    useReduced();
    const { container } = mount();
    // 142.3 avg on the fixture's 165 Hz panel → ratio 0.86 → good
    const fpsEl = container.querySelector(".hv2-stat-n");
    expect(fpsEl?.className).toContain("hv2-grade-good");
    expect(fpsEl?.textContent).toContain("142");
    // 98.4 low vs 142.3 avg → ratio 0.69 → ok
    const lowEl = container.querySelector(".hv2-grade-ok");
    expect(lowEl?.textContent).toBe("98");
  });

  it("ungraded (neutral) session numbers stay plain — no tone class, no invented grade", () => {
    useReduced();
    const { container } = mount({
      sessions: [{ ...session, avg_fps: 0, low1_fps_est: 0 } as SessionSummary],
    });
    expect(container.querySelector('[class*="hv2-grade-"]')).toBeNull();
  });
});

describe("HomeV2 — priorities rows", () => {
  // "See in Lab", not "See in Optimize" — the 2026-08-06 generation prune deleted the standalone
  // Optimize room, so the fixRoomLabel default this isolation mount falls back to now names the Lab.
  it("ranks the first limiter 'biggest limiter'; rows route to the fixes", () => {
    useReduced();
    const { props } = mount();
    expect(screen.getByText("biggest limiter")).toBeTruthy();
    // P7-confidence; the word is now a glossed Term inside the [data-confidence] wrapper (self-review 2026-10-28)
    expect(screen.getByText("Likely").closest("[data-confidence]")?.getAttribute("data-confidence")).toBe("medium");
    fireEvent.click(screen.getAllByRole("button", { name: "See in Lab" })[0]);
    expect(props.onSeeInFix).toHaveBeenCalled();
  });

  it("Re-run check is the single primary action", () => {
    useReduced();
    const { props, container } = mount();
    expect(container.querySelectorAll(".v2-verdict-action").length).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Re-run check" }));
    expect(props.onRunCheck).toHaveBeenCalled();
  });
});
