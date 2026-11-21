// bug->guard (owner, 2026-08-06) — this file replaces home-console-calm-default-guard.test.tsx,
// whose contract the owner overturned the day it landed.
//
// The complaint was: "it just looks to intimidating rather than this intuitive easy to use and
// understand portal for everyone." The first answer was to move the dense half of Home behind
// `useExpertView()`. The owner rejected that reading outright:
//
//   "the expert view doesnt seemingly even need to be an option the information it displayed should
//    be standard my only worry with that was only if it was overbearing or caused to much congestion
//    aesthetically the better option is to integrate and structure the layout in a neat style that
//    avoided too m,uch text or paragrapgh style descriptions with better grouping and boxed
//    templates"
//
// So the defect was never "too much information" — it was "unstructured information". Hiding it
// answered a question nobody asked and cost the enthusiast half of the product. The fix is LAYOUT:
// live state stays on the rig's annotation planes, the static detected record moves into boxed
// templates below the stage, and NOTHING is gated.
//
// What this guard pins, so the switch cannot creep back:
//   1. Every readout renders on the DEFAULT face, with an empty localStorage. (2026-11-20: the readiness
//      ring left Home by owner decision, so the readout is the four measured readings; that none comes
//      back as a score is pinned in home-console.test.tsx. This guard still protects: all four readings,
//      the rig, the controls and the boxed record are on the default face and nothing is gated.)
//   2. `compy_expert_view` changes nothing on Home — flipping it must be a no-op, in both directions.
//   3. The record is BOXED and inert: no button, no expand, nothing to discover.
//   4. Rows are label + value, never prose — the mechanical form of "no paragraph style descriptions".
//   5. No number is owned twice: live figures on the planes, static facts in the boxes.
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";
import { HomeConsole } from "./HomeConsole";
import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
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

vi.mock("../design/use-motion", () => ({ useReducedMotion: () => true }));

// The stub echoes the two knob props back into the DOM — that is how the knob test observes state
// it otherwise could not reach (the real bay is three.js and lazy).
vi.mock("./rig/RigHologram", () => ({
  RigHologram: (p: { exploded: boolean; autoRotate: boolean }) => (
    <div
      data-testid="rig-hologram"
      data-exploded={String(p.exploded)}
      data-autorotate={String(p.autoRotate)}
    />
  ),
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

afterEach(cleanup);
beforeEach(() => localStorage.clear());

// A fully-reporting rig: all four boxes have rows, so "the record is complete on the default face"
// is a real assertion rather than a vacuous one. (The empty-record honesty path — a machine that
// reports no modules or disks drops those boxes entirely — is pinned in home-console.test.tsx.)
const hw = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_arch: { family_label: "Ryzen 7 9850X3D", architecture: "Zen 5", generation: "9000" },
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [
    {
      name: "AMD Radeon RX 9070 XT",
      vram_bytes: 16 * 1024 ** 3,
      driver_version: "25.5.1",
      driver_date: "2026-05-02",
    },
  ],
  disks: [
    {
      mount_point: "C:\\",
      total_bytes: 1000 * 1024 ** 3,
      available_bytes: 130 * 1024 ** 3,
      file_system: "NTFS",
    },
  ],
  memory_modules: [
    {
      capacity_bytes: 16 * 1024 ** 3,
      speed_mhz: 6000,
      rated_speed_mhz: 6000,
      type_name: "DDR5",
      manufacturer: "Corsair",
      xmp_expo_status: "running_at_rated",
    },
    {
      capacity_bytes: 16 * 1024 ** 3,
      speed_mhz: 6000,
      rated_speed_mhz: 6000,
      type_name: "DDR5",
      manufacturer: "Corsair",
      xmp_expo_status: "running_at_rated",
    },
  ],
  physical_disks: [
    {
      friendly_name: "Samsung SSD 990 PRO",
      media_type: "SSD",
      bus_type: "NVMe",
      size_bytes: 1000 * 1024 ** 3,
    },
  ],
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

// A measured session, so the 1% low and the avg fps both have real numbers to render. An ABSENT
// reading would render ArcGauge's NOT-YET, and "is it on screen?" could not tell the difference
// between gated-away and honestly-empty.
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

const mount = () =>
  render(
    <ShellV2
      items={railFor(true)}
      activeId="home"
      onNavigate={() => {}}
      ledger={[]}
     
    >
      <HomeConsole
        hw={hw}
        readiness={readiness}
        priorities={priorities}
        sessions={[session]}
        changes={[change]}
        onRunCheck={() => {}}
        onSeeInFix={() => {}}
      />
    </ShellV2>,
  );

/** Flip the preference the way Settings does — setItem + the custom event, no reload. */
const setExpert = (on: boolean) =>
  act(() => {
    localStorage.setItem("compy_expert_view", on ? "1" : "0");
    window.dispatchEvent(new Event("compy:expert-view"));
  });

/** Everything Home puts on screen, as one comparable string. Used to prove the preference is inert. */
const faceOf = (c: HTMLElement) =>
  [
    // By FACT, not by position (issue #49): these four used to be four corner anchors on the
    // canvas plus a value on the annotation plane, and a selector naming a corner stops guarding
    // anything the moment the room is re-laid-out. `data-read` moves with the reading.
    ["avgFps", "low1", "gpuTemp", "cpuTemp"]
      .map((q) => `${q}:${c.querySelector(`[data-read="${q}"]`) ? 1 : 0}`)
      .join(","),
    `seg:${c.querySelectorAll(".hc-seg-group").length}`,
    `ann:${c.querySelectorAll(".hc-ann").length}`,
    `rig:${c.querySelector('[data-testid="rig-hologram"]') ? 1 : 0}`,
    `box:${Array.from(c.querySelectorAll(".hc-spec-title"))
      .map((e) => e.textContent)
      .join("|")}`,
    `row:${c.querySelectorAll(".hc-spec-row").length}`,
  ].join(" ");

const specRows = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLElement>(".hc-spec-row")).map((r) => ({
    k: r.querySelector(".hc-spec-k")?.textContent ?? "",
    v: r.querySelector(".hc-spec-v")?.textContent ?? "",
  }));

describe("Home's standard readout (owner 2026-08-06 — structure it, do not hide it)", () => {
  it("puts the WHOLE readout on the default face — empty localStorage, nothing gated", async () => {
    const r = mount();
    const c = r.container;
    // The readings. The 1% low and GPU temp were briefly expert-only; the owner put them back.
    // CPU temp joined them on the face in issue #49, when it moved off the annotation plane.
    const read = (id: string) => c.querySelector(`[data-read="${id}"]`);
    expect(read("avgFps"), "the avg-fps reading left the default face").toBeTruthy();
    expect(read("low1"), "the 1% low is gated again — it must be standard").toBeTruthy();
    expect(read("gpuTemp"), "the GPU temp is gated again — it must be standard").toBeTruthy();
    expect(read("cpuTemp"), "the CPU temp left the default face").toBeTruthy();
    // The bay is lazy() — await it rather than reading the Suspense fallback and calling it gone.
    expect(await r.findByTestId("rig-hologram"), "the rig left the default face").toBeTruthy();
    expect(c.querySelectorAll(".hc-ann").length, "the annotation planes left the default face").toBe(2);
    // Two control groups: the 2D/3D choice and the explode/orbit knobs. Both standard.
    expect(c.querySelector('.hc-seg-group[role="tablist"]'), "the 2D/3D choice is gone").toBeTruthy();
    expect(
      c.querySelectorAll(".hc-seg-group").length,
      "the explode/orbit knobs are gated again — they are part of the standard readout",
    ).toBe(2);
    // The detected record: four boxes, all present because this rig reports all four.
    expect(c.querySelector(".hc-specs"), "the detected record left the default face").toBeTruthy();
    expect(c.querySelectorAll(".hc-spec").length, "the detected record lost a box").toBe(4);
    expect(c.textContent, "the detected GPU is no longer named on the default face").toContain("9070 XT");
  });

  it("THE GUARD: compy_expert_view is inert on Home — flipping it changes nothing, either way", async () => {
    const r = mount();
    const c = r.container;
    await r.findByTestId("rig-hologram");
    const standard = faceOf(c);

    setExpert(true);
    expect(
      faceOf(c),
      "expert view ADDS something to Home again — the owner's call is that this information is standard, and congestion is answered with layout, not a switch",
    ).toBe(standard);

    setExpert(false);
    expect(faceOf(c), "expert view REMOVES something from Home again").toBe(standard);
  });

  it("the record is a BOXED template, not a floating expandable — nothing to hover or discover", () => {
    const c = mount().container;
    const specs = c.querySelector<HTMLElement>(".hc-specs")!;
    // Every box announces itself, so the grouping is readable without interaction.
    expect(specs.querySelectorAll(".hc-spec-title").length).toBe(4);
    expect(specs.querySelectorAll(".hc-spec-row").length).toBeGreaterThan(8);
    // The congestion fix is structural. If a control appears here, the record has regressed into
    // the hover-to-expand callout it replaced.
    expect(specs.querySelectorAll("button").length, "the record grew an affordance").toBe(0);
    expect(specs.querySelector("[aria-expanded]"), "the record grew an expand/collapse").toBeNull();
    // The planes carry live state as plain text — they are labels, not controls.
    expect(
      Array.from(c.querySelectorAll(".hc-ann")).reduce((n, p) => n + p.querySelectorAll("button").length, 0),
      "an annotation plane grew a button — the floating expandable callout is back",
    ).toBe(0);
  });

  it('label + value, never prose — the mechanical form of "no paragraph style descriptions"', () => {
    const c = mount().container;
    const rows = specRows(c);
    expect(rows.length).toBeGreaterThan(8);
    for (const { k, v } of rows) {
      expect(k.length, `record label is a sentence, not a label: "${k}"`).toBeLessThanOrEqual(24);
      expect(v.length, `record value is a sentence, not a value: "${v}"`).toBeLessThanOrEqual(64);
      // A period followed by a space is the tell of prose; "M.2" and "25.5.1" survive it.
      expect(v, `record value reads as a sentence: "${v}"`).not.toMatch(/\. /);
    }
    expect(c.querySelector(".hc-specs p"), "a paragraph landed in the detected record").toBeNull();
  });

  it("no number is owned twice: live figures on the planes, static facts in the boxes", () => {
    const c = mount().container;
    const specs = c.querySelector(".hc-specs")!.textContent ?? "";
    const planes = Array.from(c.querySelectorAll(".hc-ann"))
      .map((p) => p.textContent ?? "")
      .join(" ");
    // A used/total ratio is LIVE state. In the record it would be a fact that goes stale on screen.
    expect(specs, "a live used/total figure leaked into the static record").not.toMatch(/\d\s*\/\s*\d+(\.\d+)?\s*GB/);
    // ...and the driver build is a static fact. On a plane it is noise beside a moving number.
    expect(planes, "the driver build leaked onto the live annotation planes").not.toContain("25.5.1");
  });

  it("the explode/orbit knobs are standard, and they drive the rig", async () => {
    const r = mount();
    const c = r.container;
    await r.findByTestId("rig-hologram"); // lazy() bay — the knobs act on it, so wait for it
    const knobs = c.querySelectorAll(".hc-seg-group")[1]!;
    const rig = () => c.querySelector('[data-testid="rig-hologram"]')!;
    const restingRotate = rig().getAttribute("data-autorotate");

    const [explode, orbit] = Array.from(knobs.querySelectorAll("button"));
    act(() => {
      explode!.click();
      orbit!.click();
    });
    expect(rig().getAttribute("data-exploded"), "the explode knob stopped exploding the rig").toBe("true");
    expect(rig().getAttribute("data-autorotate"), "the orbit knob stopped toggling").not.toBe(restingRotate);

    // Stranding used to be the hazard here: the knobs rode the flip side, so leaving expert view hid
    // the only control that could reassemble an exploded rig. Standard knobs make that unreachable —
    // pinned so a future gate cannot quietly recreate it.
    setExpert(true);
    setExpert(false);
    expect(
      c.querySelectorAll(".hc-seg-group")[1],
      "the knobs vanished with a preference flip — an exploded rig with no control to reassemble it",
    ).toBeTruthy();
  });
});
