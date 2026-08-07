// bug->guard (owner, 2026-08-06): "im still not satisfied with the layout of compy it just looks
// to intimidating rather than this intuitive easy to use and understand portal for everyone with a
// techy enthusiast catering flip side."
//
// UI_VISION_BACKLOG frames it exactly: "the symptom is INTIMIDATION, not clutter" and the work is
// "calming the DEFAULT face, not building a second mode — anything that is only legible to an
// enthusiast is a candidate to move behind the flip side rather than to delete."
//
// Home was the ONE room never wired to `useExpertView()`, the preference eight other surfaces
// already honour. Four gauges, two floating spec planes and three segmented control groups all
// landed at once on the app's opening screen. This guard pins the split:
//
//   DEFAULT FACE — the plain answer: readiness (tl), avg fps (tr), the rig AND its labels, the
//                  2D/3D choice.
//   FLIP SIDE    — enthusiast-legible instrumentation: the 1% low (a term that needs a glossary to
//                  parse at all), the GPU temp, the dense detected-hardware record behind each
//                  callout (module timings, disk serials, driver builds), the explode/orbit knobs.
//
// The annotation PLANES are deliberately on the default face. "Memory · 14.2 / 29.4 GB" is the
// reassuring "here is your PC" line a non-technical user opened Home for; gating it would leave a
// nameless 3D object, which is less legible rather than calmer. The cut is the RECORD, not the
// label — a Callout with no `dense` rows renders as plain text, with no +, button or expansion.
//
// Three ways this rots silently, all covered below: (1) a later surface lands a new readout on the
// default face ungated and the intimidation creeps back; (2) the gate goes on too much and the
// non-expert loses the rig view; (3) the preference stops being REACTIVE and Settings needs a
// reload to take effect — the whole point of the custom event.
//
// The stranding case is its own test. The explode/orbit knobs ride the flip side, so leaving expert
// view with the rig exploded would hide the only control that can reassemble it — a calm face the
// user cannot undo. Leaving expert view must reset them.
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

// The stub echoes the two knob props back into the DOM — that is how the stranding test observes
// state it otherwise could not reach (the real bay is three.js and lazy).
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

// A measured session, so the 1% low and the avg fps both have real numbers to render. An ABSENT
// reading would render ArcGauge's NOT-YET and the "is it gone?" assertions could not tell the
// difference between gated-away and honestly-empty.
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
      ledgerCount={1}
      version="0.1.0"
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

describe("Home's calm default face (owner 2026-08-06 — intimidation, not clutter)", () => {
  it("keeps the plain answer on the default face: readiness, avg fps, the rig, the 2D/3D choice", async () => {
    const r = mount();
    const c = r.container;
    // These are the readings a non-technical gamer opened the app to get. Gating any of them would
    // be calming the face by emptying it, which is not the ask.
    expect(c.querySelector(".hc-tl"), "the readiness gauge left the default face").toBeTruthy();
    expect(c.querySelector(".hc-tr"), "the avg-fps gauge left the default face").toBeTruthy();
    // The bay is lazy() — await it rather than reading the Suspense fallback and calling it gone.
    expect(await r.findByTestId("rig-hologram"), "the rig left the default face").toBeTruthy();
    // Comfort control, NOT instrumentation: gating it would strand a non-expert inside the 3D view
    // with no way back to cards.
    const tablist = c.querySelector('.hc-seg-group[role="tablist"]');
    expect(tablist, "the 2D/3D choice is gone — a non-expert cannot leave the 3D view").toBeTruthy();
    // The labels are the calm half of the rig: gate them and the hologram is a nameless object.
    expect(c.querySelectorAll(".hc-ann").length, "the annotation planes left the default face").toBe(2);
    expect(c.textContent, "the detected GPU is no longer named on the default face").toContain("9070 XT");
  });

  it("moves the enthusiast-only instrumentation behind the flip side", () => {
    const c = mount().container;
    expect(
      c.querySelector(".hc-bl"),
      'the 1% low renders by default again — it needs a glossary Term to parse, so it is the definition of enthusiast-legible',
    ).toBeNull();
    expect(c.querySelector(".hc-br"), "the GPU temp gauge renders by default again").toBeNull();
    // The planes stay; what goes is the RECORD behind them. No `dense` rows means the Callout is
    // plain text — no `+`, no button, no expansion to a spec sheet.
    expect(
      c.querySelectorAll(".hc-callout-x").length,
      "a callout is expandable on the default face again — module timings and driver builds are the enthusiast record",
    ).toBe(0);
    expect(
      c.querySelectorAll(".hc-callout-more").length,
      "the + affordance is back on the default face",
    ).toBe(0);
    expect(
      c.querySelectorAll(".hc-seg-group").length,
      "a second control group renders by default — the explode/orbit knobs are enthusiast fiddling",
    ).toBe(1);
  });

  it("restores every gated readout when the flip side is on", () => {
    localStorage.setItem("compy_expert_view", "1");
    const c = mount().container;
    expect(c.querySelector(".hc-bl"), "expert view no longer restores the 1% low").toBeTruthy();
    expect(c.querySelector(".hc-br"), "expert view no longer restores the GPU temp").toBeTruthy();
    expect(
      c.querySelectorAll(".hc-callout-x").length,
      "expert view no longer restores any expandable callout — the detected record is unreachable",
    ).toBeGreaterThan(0);
    expect(c.querySelectorAll(".hc-seg-group").length, "expert view no longer restores the explode/orbit knobs").toBe(2);
    // The default face keeps everything it already had — the flip side ADDS, it never swaps.
    expect(c.querySelector(".hc-tl"), "expert view swapped the readiness gauge away").toBeTruthy();
    expect(c.querySelector(".hc-tr"), "expert view swapped the avg-fps gauge away").toBeTruthy();
  });

  it("reacts to the preference LIVE, without a remount", () => {
    // The custom event is the whole reason use-expert-view exists: Settings flips the toggle in a
    // different room and Home must already be right when the user walks back in.
    const c = mount().container;
    expect(c.querySelector(".hc-br")).toBeNull();
    setExpert(true);
    expect(c.querySelector(".hc-br"), "flipping the preference needed a reload to reach Home").toBeTruthy();
    setExpert(false);
    expect(c.querySelector(".hc-br"), "flipping the preference back left the detail on screen").toBeNull();
  });

  it("does not STRAND the explode/orbit state when the knobs go away", async () => {
    localStorage.setItem("compy_expert_view", "1");
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

    // Now leave the flip side. The knobs vanish with it — so their state must not survive them.
    setExpert(false);
    expect(
      rig().getAttribute("data-exploded"),
      "left expert view with the rig still exploded and no control left to reassemble it",
    ).toBe("false");
    expect(
      rig().getAttribute("data-autorotate"),
      "left expert view with the rig still spinning and no control left to stop it",
    ).toBe(restingRotate);
  });
});
