import { describe, it, expect, vi, afterEach, beforeAll, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { HomeRoom } from "./HomeRoom";
import { HomeV2 } from "./HomeV2";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";
import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";

// Guards for the Instrument-HUD Home (spec 2026-07-05-ui-deslop-organic-directive, CORRECTED
// direction — editorial retired; DEFAULT ON since the owner approval 2026-07-06). These pin
// the reversibility contract: flag "0" (the Settings failsafe) restores HomeV2 byte-identical
// with zero HUD DOM; flag absent renders the HUD (the shipped default) with the SAME measured
// numbers (graded ink classes included — the deslop #4 bug→guard carries over), and the ring
// gauge renders ONLY when both sides of its ratio were actually measured.

vi.mock("./rig/RigHologram", () => ({
  RigHologram: () => <div data-testid="rig-hologram" />,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "get_build_stamp") return Promise.resolve("ab12cd3 · dev");
    if (cmd === "get_gpu_sensors") return Promise.resolve([{ temperature_c: 62 }]);
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

// This file pins the compy_editorial (HomeHud/HomeV2) layer THROUGH HomeRoom. Since the
// compy_home_console DEFAULT-ON flip (owner-approved 2026-07-10), HomeRoom's default branch
// is the console — pin the console failsafe "0" here so these tests keep exercising the
// layer they guard. The console's own default is pinned in home-console-flag.test.tsx.
beforeEach(() => {
  localStorage.setItem("compy_home_console", "0");
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
    {
      id: "disk",
      title: "C: drive is 87% full",
      reason: "Below ~10% free, load times suffer.",
      linked: null,
      confidence: "high",
      status: "attention",
    },
  ],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
};

// 142 avg on a 165 Hz display grades "good"; 98 vs 142 avg (69%) grades "ok" — both non-neutral,
// so the graded-ink pins below assert on real tone classes, not accidents of neutral.
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

const props = {
  hw,
  readiness,
  priorities,
  sessions: [session],
  changes: [change],
  onRunCheck: () => {},
  onSeeInFix: () => {},
};

const shell = (child: React.ReactNode) => (
  <ShellV2
    items={railFor(true)}
    activeId="home"
    onNavigate={() => {}}
    ledgerCount={1}
    version="0.1.0"
  >
    {child}
  </ShellV2>
);

describe("Instrument-HUD flag-off byte-identity (the classic failsafe)", () => {
  it("flag='0' renders byte-identical to HomeV2 directly", () => {
    // HudFrame prints the live wall clock (HH:MM:SS, HudFrame.tsx). The two renders below happen
    // microseconds apart, so ~1 run in 5 straddled a second boundary and the readout alone differed
    // — a false-red on a byte-identity failsafe (diagnosed 2026-07-17). Freeze the clock so both
    // renders capture the identical instant; the DOM equality this test actually guards is unaffected.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T12:00:00"));
    try {
      const direct = render(shell(<HomeV2 {...props} />)).container.innerHTML;
      cleanup();
      localStorage.setItem("compy_editorial", "0");
      const off = render(shell(<HomeRoom {...props} />)).container.innerHTML;
      expect(off).toBe(direct);
    } finally {
      vi.useRealTimers();
    }
  });

  it("flag='0': zero HUD DOM present", () => {
    localStorage.setItem("compy_editorial", "0");
    const c = render(shell(<HomeRoom {...props} />)).container;
    expect(c.querySelector("[data-hud-home]")).toBeNull();
    expect(c.querySelector(".hud-grid")).toBeNull();
    expect(c.querySelector(".hud-headline")).toBeNull();
  });

  it("flag absent renders the HUD (default ON — owner approval 2026-07-06)", () => {
    const c = render(shell(<HomeRoom {...props} />)).container;
    expect(c.querySelector("[data-hud-home]")).not.toBeNull();
  });
});

describe("Instrument-HUD flag-on pilot (same measured numbers, new presentation)", () => {
  const mountOn = () => {
    localStorage.setItem("compy_editorial", "1");
    return render(shell(<HomeRoom {...props} />)).container;
  };

  it("renders the HUD Home with the console masthead over the real verdict", () => {
    const c = mountOn();
    expect(c.querySelector("[data-hud-home]")).not.toBeNull();
    // The verdict is postureLine's real output, in the ONE RoomShell h1 (one-mention law).
    expect(c.querySelectorAll(".v2-verdict h1")).toHaveLength(1);
    expect(c.querySelector(".hud-headline")).not.toBeNull();
    // The status LED reflects the REAL resolved state (checks done, nothing flagged → ok).
    expect(c.querySelector(".hud-masthead-eyebrow .hud-led-ok")).not.toBeNull();
    expect(c.querySelector(".hud-led-scan")).toBeNull();
  });

  it("session numbers stay graded (deslop #4 bug→guard carried to the pilot): fps + 1% low carry tone classes and real values", () => {
    const c = mountOn();
    const fps = c.querySelector(".hud-reading");
    expect(fps?.className).toMatch(/hud-grade-(good|ok|bad)/);
    // 1% low renders the measured estimate with its own grade class.
    const low = Array.from(c.querySelectorAll(".hud-note .hud-mono")).find((n) =>
      /^98$/.test(n.textContent ?? ""),
    );
    expect(low).toBeTruthy();
    expect(low?.className).toMatch(/hud-grade-(good|ok|bad)/);
  });

  it("ring gauge is the real fps-vs-refresh ratio, only when both sides were measured", () => {
    const c = mountOn();
    // 142.3 / 165 Hz → 86% — a measured ratio, not a score.
    expect(c.querySelector(".hud-ring")).not.toBeNull();
    expect(c.querySelector(".hud-ring-pct")?.textContent).toBe("86%");
    expect(c.querySelector(".hud-ring-cap")?.textContent).toBe("vs 165 Hz");
    cleanup();
    // No refresh reading → no ring (never a fabricated reference).
    localStorage.setItem("compy_editorial", "1");
    const noHz = render(
      shell(<HomeRoom {...props} hw={{ ...hw, display: null } as unknown as HardwareInfo} />),
    ).container;
    expect(noHz.querySelector(".hud-ring")).toBeNull();
  });

  it("docket ranks are real order and the column renders honest measured entries", () => {
    const c = mountOn();
    const ranks = Array.from(c.querySelectorAll(".hud-rank")).map((n) => n.textContent);
    expect(ranks).toEqual(["01"]);
    // Trust ledger shows the real applied change, not an invented stat.
    expect(c.textContent).toContain("Hardware-accelerated GPU scheduling");
    // CPU temp stays honestly absent (LOCKED rule 1 voice — plain-English refusal, no jargon).
    expect(c.textContent).toContain("no temp — Compy won't ship a kernel driver");
  });

  it("readout strip carries the real check counts; scan state only while checks run", () => {
    const c = mountOn();
    expect(c.querySelector(".v2-measured")?.textContent).toContain("3/3");
    expect(c.querySelector(".hud-sweep")).toBeNull();
    cleanup();
    localStorage.setItem("compy_editorial", "1");
    const checking = render(
      shell(<HomeRoom {...props} readiness={null} priorities={null} />),
    ).container;
    expect(checking.querySelector(".hud-sweep")).not.toBeNull();
    expect(checking.querySelector(".hud-led-scan")).not.toBeNull();
    expect(checking.querySelector(".v2-measured")?.textContent).toContain("running checks…");
  });

  it("honest empty state: no sessions → no fabricated numbers, no ring", () => {
    localStorage.setItem("compy_editorial", "1");
    const c = render(shell(<HomeRoom {...props} sessions={[]} />)).container;
    expect(c.textContent).toContain("Nothing on the books yet");
    expect(c.querySelector(".hud-grade-good")).toBeNull();
    expect(c.querySelector(".hud-ring")).toBeNull();
  });
});
