import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";
import { postureLine } from "./command-center-data";
import { activeChangeCount } from "./dashboard-data";
import { HomeConsole } from "./HomeConsole";
// i18n update (2026-07-23): postureLine now takes a TFunction as its last param — the real
// i18next instance (English default, same as every assertion below already expects).
import i18n from "../i18n";
import type { AppliedChange, GameReadiness, Priorities, SessionSummary } from "../types";
import type { HardwareInfo } from "../App";
import { readFileSync } from "fs";
import { join } from "path";

// HomeConsole — the console cold-open stage (plan 2026-07-10-console-hud-phase2-home, Task 2+).
// Pins the honesty rail (absent readings render ArcGauge's NOT-YET, never a fabricated number;
// measured readings render the real session/check numbers), the real postureLine verdict in the
// masthead, and the header-slop law (no lede/explainer node anywhere in the console header).

// The gauge probes poll on mount; a mutable holder lets tests take the GPU sensor away.
// headline feeds get_intelligence_headline (Intelligence Phase 1's Home line — null = the
// engine reached no improved/regressed verdict, the honest default); calls records every
// invoke so the flag-off pin can assert the IPC was never made.
const state = vi.hoisted(() => ({
  gpuSensors: [{ temperature_c: 62 }] as unknown,
  headline: null as unknown,
  calls: [] as string[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    state.calls.push(cmd);
    if (cmd === "get_gpu_sensors") return Promise.resolve(state.gpuSensors);
    if (cmd === "get_memory_pressure")
      return Promise.resolve({
        used_bytes: 14.2 * 1024 ** 3,
        total_bytes: 29.4 * 1024 ** 3,
        level: "ok",
      });
    if (cmd === "get_intelligence_headline") return Promise.resolve(state.headline);
    return Promise.resolve(null);
  },
}));

// Reduced motion simplifies gauge assertions (useCountTo snaps instead of tweening).
vi.mock("../design/use-motion", () => ({ useReducedMotion: () => true }));

// RigHologram pulls in the ~600KB three.js bundle lazily — stub it so this stays a DOM test.
vi.mock("./rig/RigHologram", () => ({
  RigHologram: () => <div data-testid="rig-hologram" />,
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
beforeEach(() => {
  localStorage.clear();
  state.gpuSensors = [{ temperature_c: 62 }];
  state.headline = null;
  state.calls = [];
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

const props: {
  hw: HardwareInfo;
  readiness: GameReadiness | null;
  priorities: Priorities | null;
  sessions: SessionSummary[];
  changes: AppliedChange[];
  onRunCheck: () => void;
  onSeeInFix: () => void;
  fixRoomLabel?: string;
  onNavigate?: (key: string) => void;
  rooms?: { key: string; name: string }[];
} = {
  hw,
  readiness,
  priorities,
  sessions: [session],
  changes: [change],
  onRunCheck: () => {},
  onSeeInFix: () => {},
};

const mount = (p = props) =>
  render(
    <ShellV2
      items={railFor(true)}
      activeId="home"
      onNavigate={() => {}}
      ledgerCount={1}
     
    >
      <HomeConsole {...p} />
    </ShellV2>,
  );

describe("HomeConsole — masthead (the proven HomeHud register)", () => {
  // UX-1 REPLACES the title-header law FOR HOME (docs/decisions/2026-08-11-design-foundation.md
  // decision 1; the old law was owner 2026-07-10 ×2 and is still in force in the other rooms).
  // The law it replaced put the room's NAME in the h1 and pushed the answer into the body a step
  // smaller — which the navigation audit measured as the screen's central defect: the only element
  // over 19px was the word "Home". This test is the inverse pin, and it is deliberately strict in
  // both directions: the verdict must be IN the h1, and the room title must be GONE (not merely
  // demoted), because a second copy of a label the rail already renders is the noise TYPE-1 cleared.
  it("UX-1 front-door law: the h1 IS the verdict, the room title is gone, and it renders ONCE", () => {
    const posture = postureLine(readiness, priorities, activeChangeCount(props.changes), i18n.t);
    const c = mount().container;
    const h1 = c.querySelector(".v2-verdict h1")!;
    expect(h1.querySelector(".hc-headline")!.textContent).toBe(posture.headline);
    expect(h1.textContent).not.toContain("Home");
    // One-mention law survives the move: postureLine's real output appears exactly once on the
    // whole screen, and that one instance is now in the header rather than the body.
    const lines = Array.from(c.querySelectorAll(".hc-verdict-line"));
    expect(lines).toHaveLength(1);
    expect(lines[0].textContent).toBe(posture.headline);
    expect(lines[0].closest(".v2-verdict")).not.toBeNull();
    expect(lines[0].closest(".home-console")).toBeNull();
    expect(c.querySelector(".hc-masthead-eyebrow .hc-led-ok")).not.toBeNull();
    expect(c.querySelector(".hc-led-scan")).toBeNull();
    // The check line is a plain sentence now, not the `3/3` ratio the navigation audit put on its
    // own jargon list (2026-08-11 §3). Same measured fact, said the way a person would say it.
    expect(c.querySelector(".v2-measured")!.textContent).toContain("All 3 checks look good");
  });

  // UX-1 decision 1's second half: ONE action. The front door is the screen's only filled primary
  // and it must open something real — a primary button that promises a room with nothing in it is
  // the dead end the whole design foundation exists to remove.
  //
  // REWRITTEN 2026-08-20 (design foundation step 3, issue #177). The version before this one
  // mounted the intake band's flag and asserted the door said "What are you here to do?" — the
  // exact words the owner removed on sight on 2026-08-12. It was correct to gate it behind an
  // explicit opt-in, but the door it was describing is gone: the band was deleted and the
  // interview took its place. What the door says now is what it DOES for the user, and what it
  // opens is a question asked one at a time, after they ask for it.
  it("one action: the front door is the single filled primary, and it opens something real", () => {
    // No opt-in needed: `compy_home_interview` defaults ON since the owner's 2026-08-20 answer
    // (theme.ts; docs/decisions/2026-08-20-home-interview-default.md §OWNER ANSWERED).
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    const door = c.querySelector<HTMLButtonElement>(".v2-verdict-action .hc-front-door")!;
    expect(door, "Home has no primary action").not.toBeNull();
    expect(door.textContent).toBe(i18n.t("home.interview.ui.door"));
    // Exactly one filled primary on the screen, or per Duolingo there are none.
    expect(c.querySelectorAll(".hc-front-door")).toHaveLength(1);
    // Closed on arrival: Home asks nothing until the user asks first.
    expect(door.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".hi-question")).toBeNull();
    // …and it really is a door: it opens onto one question, in plain words.
    act(() => {
      door.click();
    });
    expect(door.getAttribute("aria-expanded")).toBe("true");
    const q = document.querySelector(".hi-question");
    expect(q, "the front door opened onto nothing — that IS the dead end").not.toBeNull();
    expect(q!.textContent).toBe(i18n.t("home.interview.q.start.question"));
    expect(document.querySelectorAll(".hi-answer").length).toBeGreaterThan(1);
  });

  it("the door names what it does — the retired question is not on Home in any form", () => {
    // The owner's front door, his call (4d1afa92). Duplicated deliberately from
    // home-interview.test.tsx: that file guards the flag, this one guards the SCREEN, and the
    // 2026-08-18 regression got through precisely because each assumed the other was watching.
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    expect(c.textContent ?? "").not.toContain("What are you here to do");
    expect(c.querySelector(".hc-intake"), "the intake band is back").toBeNull();
  });

  it('the switch really is one: "0" leaves Home with no front door at all', () => {
    localStorage.setItem("compy_home_interview", "0");
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    expect(c.querySelector(".hc-front-door")).toBeNull();
    expect(document.querySelector(".hi-question")).toBeNull();
  });

  // THE DEFAULT, FLIPPED BY THE OWNER (2026-08-20). The version of this test before the flip
  // pinned the COST of default-OFF out loud: with the interview off, UX-1 decision 1's "verdict +
  // ONE action" front door had NO action — the state every real install was in. That measured fact
  // went in front of the owner and he said YES (docs/decisions/2026-08-20-home-interview-default.md
  // §OWNER ANSWERED), so this test now pins the rendered consequence from the exact state a fresh
  // install is really in: nothing in localStorage, and Home leads with the door.
  it("default ON: a fresh install's Home leads with the front door as its one filled primary", () => {
    expect(localStorage.getItem("compy_home_interview")).toBeNull();
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    expect(c.querySelector(".hc-front-door"), "the fresh-install front door is missing").not.toBeNull();
    expect(c.querySelectorAll(".hc-front-door")).toHaveLength(1);
    // Neither of these was ever gated on the flag; they ride along in every state.
    expect(c.querySelector(".hc-rerun-band, .v2-measured")).not.toBeNull();
    expect(c.querySelector(".hc-care-entry")).not.toBeNull();
  });

  it("attention state: verdict strip carries the warn tone class + the real headline", () => {
    const attn: GameReadiness = {
      ...readiness,
      checks: [
        { id: "a", label: "Refresh rate", status: "attention", detail: "", value: null },
        { id: "b", label: "B", status: "ready", detail: "", value: null },
        { id: "c", label: "C", status: "ready", detail: "", value: null },
      ],
      ready_count: 2,
      attention_count: 1,
    };
    const posture = postureLine(attn, priorities, activeChangeCount(props.changes), i18n.t);
    const c = mount({ ...props, readiness: attn }).container;
    expect(posture.tone).toBe("attention");
    // UX-1: the tone class rides the verdict line itself now that the line IS the h1's content —
    // there is no separate strip wrapper left to carry it.
    const line = c.querySelector(".hc-verdict-line")!;
    expect(line.className).toContain("hc-verdict-attention");
    expect(line.textContent).toBe(posture.headline);
    expect(c.querySelector(".v2-verdict h1")!.textContent).toContain(posture.headline);
  });

  // BUG→GUARD (owner catch 2026-08-20, issue #180 §C — the second catch of this defect class,
  // after the 2026-07-10 title-header law): the attention posture's sentence is the flagged
  // CHECK's full detail paragraph. That copy belongs to the check row in Test, and it used to
  // render verbatim as Home's header dek — fine print under a 40px verdict, pushing the one
  // primary button 90px down the page. The owner's pick: the headline NAMES the check (the
  // 2026-07-17 named-headline guard), the paragraph stays in Test, and the measured band routes
  // there ("Fix in Test →"). This pins the paragraph OUT of Home's header for good.
  it("attention state: the check's fine-print detail never renders in the header — the dek stands down", () => {
    const detail =
      "'Hardware GPU scheduling' — you turned it on with Compy and it's currently off, changed " +
      "outside Compy (by Windows, another app, or you). Not an error: turn it back on or roll " +
      "it back in Test — either one clears this.";
    const attn: GameReadiness = {
      ...readiness,
      checks: [
        { id: "applied-changes", label: "Applied Compy changes", status: "attention", detail, value: null },
        { id: "b", label: "B", status: "ready", detail: "", value: null },
      ],
      ready_count: 1,
      attention_count: 1,
    };
    const c = mount({ ...props, readiness: attn }).container;
    // No because-line node at all in the attention state…
    expect(c.querySelector(".v2-verdict-sub"), "attention dek must stand down").toBeNull();
    // …so the paragraph is nowhere in the header. The named headline stays.
    expect(c.querySelector(".v2-verdict")!.textContent).not.toContain("turn it back on");
    expect(c.querySelector(".hc-verdict-line")!.textContent).toContain("Applied Compy changes");
  });

  it("header-slop pin: no lede/explainer node anywhere in the console header", () => {
    const c = mount().container;
    expect(c.querySelector(".home-console-lede")).toBeNull();
    expect(c.querySelector(".hc-lede")).toBeNull();
    // UX-1 inverts the old "no sub line" half of this pin: the sub slot is no longer slop, it is
    // the because-line that belongs directly under the verdict it explains. What stays banned is a
    // free-floating explainer — the sub must carry the dek and nothing else.
    const sub = c.querySelector(".v2-verdict-sub");
    if (sub) expect(sub.querySelector(".hc-verdict-dek")).not.toBeNull();
  });
});

describe("HomeConsole — the console stage (the real rig + its honest readout)", () => {
  // All five readings are STANDARD — no expert flag, no scaffold (owner 2026-08-06: "the
  // information it displayed should be standard"). The congestion answer is layout, not a switch;
  // the readout stays whole for everyone. Pinned in home-console-standard-readout-guard.test.tsx.
  //
  // They are anchored by `data-read`, NOT by where they sit. Issue #49 moved them off the canvas
  // corners into the readout strip under the rig, and every selector here that named a corner
  // (.hc-tl/.hc-tr/.hc-bl/.hc-br) would have gone quietly green-then-null on a layout change while
  // the honesty contract it guards was untouched. A reading is identified by the fact it states.

  /** The visible reading, whichever instrument renders it — the ring keeps ArcGauge, the four raw
      numbers are readout cells. Both print "— —" and say why when there is nothing measured. */
  const readout = (c: HTMLElement, id: string) => {
    const el = c.querySelector<HTMLElement>(`[data-read="${id}"]`);
    if (!el) throw new Error(`no reading named ${id}`);
    const v = el.querySelector(".ag-v") ?? el.querySelector(".hc-read-n");
    return {
      el,
      value: v!.textContent,
      /** Honest-unmeasured: NOT YET on the ring, the reason line in a readout cell. */
      unmeasured: el.querySelector(".ag-tag-ny") ?? el.querySelector(".hc-read-none"),
    };
  };

  it("renders the recognizable rig hologram at center-stage", async () => {
    mount();
    const rig = await screen.findByTestId("rig-hologram");
    expect(rig.closest(".hc-stage")).not.toBeNull();
  });

  it("honest NOT-YET: no sessions + no GPU reading → FPS/1%-low/GPU readings say so, no numbers", () => {
    state.gpuSensors = null;
    const c = mount({ ...props, sessions: [] }).container;
    for (const id of ["avgFps", "low1", "gpuTemp"]) {
      const r = readout(c, id);
      expect(r.unmeasured, `${id} must say why there is no reading`).not.toBeNull();
      expect(r.value, `${id} readout`).toBe("— —");
    }
  });

  it("measured session → Avg FPS and 1% low render the real numbers", () => {
    const c = mount().container;
    expect(readout(c, "avgFps").value).toBe("142");
    expect(readout(c, "avgFps").unmeasured).toBeNull();
    expect(readout(c, "low1").value).toBe("98");
    expect(readout(c, "low1").unmeasured).toBeNull();
  });

  it("Readiness = the real ready/total ratio; NOT-YET while checks are running", () => {
    const c = mount().container;
    expect(readout(c, "readiness").value).toBe("100");
    cleanup();
    const checking = mount({ ...props, readiness: null, priorities: null }).container;
    expect(readout(checking, "readiness").unmeasured).not.toBeNull();
    expect(checking.querySelector(".v2-measured")!.textContent).toContain("Checking your PC now");
  });

  it("GPU temp reading shows the polled value once it lands", async () => {
    const c = mount().container;
    await waitFor(() => expect(readout(c, "gpuTemp").value).toBe("62"));
    expect(readout(c, "gpuTemp").unmeasured).toBeNull();
  });

  // issue #49 — the CPU temperature moved off the annotation plane into the readout beside the
  // other four. It is the one reading this dev machine cannot take, so it is also the one that
  // proves the unmeasured path end to end: a dash, and the SPECIFIC reason, not a generic one.
  it("CPU temp: unreadable stays unreadable, and still points at the fix", () => {
    const c = mount().container;
    const r = readout(c, "cpuTemp");
    expect(r.value).toBe("— —");
    expect(r.unmeasured!.textContent).toBe("no CPU temp — see below");
    // …and it is stated exactly once. It used to print on the annotation plane; printing it in
    // both places would be the same number twice on one screen.
    expect(c.querySelectorAll(".hc-ann .hc-callout-v").length).toBeLessThanOrEqual(3);
  });
});

// The ground rail's rooms minus home itself — what App threads at default-ON (Task 3).
const groundRooms = [
  { key: "play", name: "Monitor" },
  { key: "learn", name: "Blackbook" },
  { key: "lab", name: "Lab" },
];

// The ShellV2 rail renders buttons with the same room names, so every dock assertion scopes
// to the .dock subtree (the console's doors, not the app rail).
const dockNode = (c: HTMLElement, name: string): HTMLElement | null => {
  const nodes = Array.from(c.querySelectorAll<HTMLElement>(".dock .dock-node"));
  return nodes.find((n) => n.querySelector(".dock-nm")?.textContent === name) ?? null;
};

describe("HomeConsole — the Dock into the rooms (navigation, honest doors)", () => {
  it("renders one dock door per passed room and clicking fires onNavigate with that key", () => {
    const nav = vi.fn();
    const c = mount({ ...props, rooms: groundRooms, onNavigate: nav }).container;
    expect(c.querySelectorAll(".dock .dock-node")).toHaveLength(3);
    fireEvent.click(dockNode(c, "Monitor")!);
    expect(nav).toHaveBeenCalledWith("play");
    fireEvent.click(dockNode(c, "Blackbook")!);
    expect(nav).toHaveBeenCalledWith("learn");
  });

  it("no door for a room not in the list; no rooms → no dock at all (honest doors)", () => {
    const c = mount({
      ...props,
      rooms: [{ key: "play", name: "Monitor" }],
      onNavigate: () => {},
    }).container;
    expect(dockNode(c, "Monitor")).not.toBeNull();
    expect(dockNode(c, "Blackbook")).toBeNull();
    cleanup();
    const bare = mount().container;
    expect(bare.querySelector(".dock")).toBeNull();
  });

  it("the guided-action room glows primary: 'fix' when the rail has one, else the Lab (ground)", () => {
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    expect(dockNode(c, "Lab")!.className).toContain("dock-node-primary");
    expect(dockNode(c, "Monitor")!.className).not.toContain("dock-node-primary");
    cleanup();
    const classic = mount({
      ...props,
      rooms: [
        { key: "fix", name: "Optimize" },
        ...groundRooms.filter((r) => r.key !== "lab"),
      ],
      onNavigate: () => {},
    }).container;
    expect(dockNode(classic, "Optimize")!.className).toContain("dock-node-primary");
  });

  it("Home never marks a room active (activeKey stays null)", () => {
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    expect(c.querySelector(".dock-node-active")).toBeNull();
  });

  it("ONE forward affordance: the dock suppresses RoomShell's ForwardDoor; no dock → door stays (bug→guard, self-reviewer 2026-07-10)", () => {
    // With the dock rendered, RoomShell's own "Find what's worth fixing → Lab" door would be a
    // second go-to-Lab control stacked right under the Lab dock node — the duplication catch.
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    expect(c.querySelector(".dock")).not.toBeNull();
    expect(c.querySelector(".v2-door")).toBeNull();
    cleanup();
    const bare = mount().container;
    expect(bare.querySelector(".dock")).toBeNull();
    expect(bare.querySelector(".v2-door")).not.toBeNull();
  });
});

describe("HomeConsole — motion contract (Task 4)", () => {
  it("reduced motion → the console root carries data-motion='reduced' (still page)", () => {
    // use-motion is mocked reduced=true for this whole file — the still-page branch.
    const c = mount().container;
    expect(c.querySelector(".home-console")!.getAttribute("data-motion")).toBe("reduced");
    // The reticle Target Cursor renders nothing under reduced motion (kit contract).
    expect(c.querySelector(".lc-reticle")).toBeNull();
  });

  it("never paints the vendor MagicBento purple — the console is token-only", () => {
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    expect(c.innerHTML).not.toMatch(/132\s*,\s*0\s*,\s*255/);
  });
});

// B6a (owner direction 2026-07-14, restructured 2026-08-06): the detected record is STANDARD and
// always open — four boxed templates under the stage, no expand affordance and no expert flag
// ("the information it displayed should be standard … better grouping and boxed templates").
// Same HardwareInfo the Cards view renders; a missing field omits its row (never a placeholder).
const denseHw = {
  ...hw,
  gpus: [
    {
      name: "AMD Radeon RX 9070 XT",
      vram_bytes: 16 * 1024 ** 3,
      driver_version: "25.5.1",
      driver_date: "2026-05-02",
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
} as unknown as HardwareInfo;

describe("HomeConsole — the detected record (boxed templates, always open)", () => {
  // Grab a box by its title so the assertions read as the user sees them — "the Graphics box",
  // not "the third grid child". A box the machine did not report is ABSENT, so `?? null` is the
  // honest lookup and the empty-record test below leans on exactly that.
  const box = (c: HTMLElement, title: string) =>
    Array.from(c.querySelectorAll<HTMLElement>(".hc-spec")).find(
      (b) => b.querySelector(".hc-spec-title")?.textContent === title,
    ) ?? null;

  it("the record is open by default — boxed, and behind NO affordance", () => {
    const c = mount({ ...props, hw: denseHw }).container;
    expect(c.querySelector(".hc-specs")).not.toBeNull();
    expect(box(c, "Graphics")).not.toBeNull();
    // The whole point of the restructure: nothing to click, nothing to discover, nothing gated.
    expect(c.querySelectorAll(".hc-specs button")).toHaveLength(0);
    expect(c.querySelector(".hc-specs [aria-expanded]")).toBeNull();
  });

  it("the Graphics box carries the DETECTED record (model, VRAM, driver)", () => {
    const c = mount({ ...props, hw: denseHw }).container;
    const gpu = box(c, "Graphics")!;
    expect(gpu.textContent).toContain("AMD Radeon RX 9070 XT");
    expect(gpu.textContent).toContain("16 GB");
    expect(gpu.textContent).toContain("25.5.1");
  });

  it("Memory boxes one row per module (capacity · type · speed · manufacturer)", () => {
    const c = mount({ ...props, hw: denseHw }).container;
    const ram = box(c, "Memory")!;
    expect(ram.textContent).toContain("slot 1");
    expect(ram.textContent).toContain("16 GB · DDR5 · 6000 MT/s · Corsair");
    expect(ram.querySelectorAll(".hc-spec-row")).toHaveLength(2);
  });

  it("honesty: a missing field omits its ROW; an empty record renders NO box at all", () => {
    // Default fixture: gpus[0] has no driver fields → no driver row, no fabricated value.
    const c = mount().container;
    expect(box(c, "Graphics")!.textContent).not.toContain("driver");
    // memory_modules / physical_disks are empty in the default fixture → no hollow frames.
    expect(box(c, "Memory")).toBeNull();
    expect(box(c, "Storage")).toBeNull();
  });
});

describe("HomeConsole — the #1-limiter readout (measured fact + its fix route)", () => {
  it("renders the top limiter's real title, quiet confidence tag, and the jump control", () => {
    const jump = vi.fn();
    const c = mount({ ...props, onSeeInFix: jump, fixRoomLabel: "Test" }).container;
    const row = c.querySelector(".hc-limiter")!;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain("C: drive is 87% full");
    expect(row.querySelector(".hc-limiter-tag")!.textContent).toContain("high confidence");
    fireEvent.click(row.querySelector("button")!);
    expect(jump).toHaveBeenCalled();
  });

  // BENTO (2026-08-12): the limiter's TILE must always render — a half-width tile that sometimes
  // doesn't render leaves a hole under the two-row hero (`bento: no conditional partial tile`, and
  // the self-review FAIL that guard came from). What must never appear is a fabricated verdict: the
  // ROW is still absent, and the empty line states only which null case it is in. It cannot say
  // "nothing is wrong" — topLimiter is also null when the verdict above already names the limiter.
  it("no limiter ⇒ no limiter ROW, and the empty line names its own null case (never an all-clear)", () => {
    const clean = mount({
      ...props,
      priorities: { ...(priorities as Priorities), limiters: [] },
    }).container;
    expect(topLimiterRows(clean)).toHaveLength(0);
    expect(clean.querySelector(".hc-none")!.textContent).toContain("the verdict above covers it");
    cleanup();
    const loading = mount({ ...props, priorities: null }).container;
    expect(topLimiterRows(loading)).toHaveLength(0);
    expect(loading.querySelector(".hc-none")!.textContent).toContain("Still reading this PC");
  });
});

// The check→fix hallway (2026-08-06). The masthead band NAMES a fix count; before this it named it
// and stopped, leaving the user to hunt for the fixes in another room. A named flag carries its own
// route inline ([[flags-name-it-and-fix-it-inline]]) — and it must be a LINK, because the band's
// Re-run button is Home's ONE primary action and a rival button would break that rule.
describe("HomeConsole — the masthead band's route to the fixes", () => {
  it("offers the route, and only a link, when the band reports something to fix", () => {
    const jump = vi.fn();
    const attn: GameReadiness = {
      ...readiness,
      checks: [{ id: "ref", label: "Refresh rate below max", status: "attention", detail: "", value: null }],
      attention_count: 1,
    };
    const c = mount({ ...props, readiness: attn, onSeeInFix: jump, fixRoomLabel: "Test" }).container;
    const band = c.querySelector(".rcb")!;
    const fix = band.querySelector<HTMLButtonElement>(".rcb-fix")!;
    expect(fix, "the band names a fix count with no way to reach the fixes").not.toBeNull();
    expect(fix.textContent).toContain("Fix in Test");
    // One primary action, never two — and since 2026-08-18 not even one BOX: the band's controls
    // are inline links (.rcb-fix, .rcb-run), so the row stays type rather than growing a control.
    expect(band.querySelectorAll(".rcb-run").length).toBe(1);
    expect(band.querySelector(".rcb-btn"), "the bordered Re-run button is back").toBeNull();
    fireEvent.click(fix);
    expect(jump).toHaveBeenCalled();
  });

  it("shows NO route when there is nothing to fix — a clean rig is not sent anywhere", () => {
    const c = mount({ ...props, fixRoomLabel: "Test" }).container;
    expect(c.querySelector(".rcb")).not.toBeNull();
    expect(c.querySelector(".rcb-fix")).toBeNull();
  });
});

// bug→guard (self-review 2026-07-17): the fix that made the attention verdict NAME the top
// flagged check introduced a DUPLICATION — when that same item is ALSO the #1 limiter, its title
// rendered twice on Home (the gold verdict headline + the "top limiter" row ~500px below). The
// limiter row must stand down and let the verdict own the story (one-owner-per-screen, P5 voice).
const topLimiterRows = (c: HTMLElement) =>
  Array.from(c.querySelectorAll(".hc-limiter")).filter(
    (r) => r.querySelector(".hc-limiter-label")?.textContent === "top limiter",
  );

describe("HomeConsole — verdict/top-limiter one-owner dedup", () => {
  it("the top-limiter row stands down when the verdict headline already names it (no double string)", () => {
    // The sole attention check has the SAME title as the sole limiter (the live-machine collision).
    const attn: GameReadiness = {
      ...readiness,
      checks: [
        { id: "disk", label: "C: drive is 87% full", status: "attention", detail: "Free up space.", value: null },
        { id: "b", label: "B", status: "ready", detail: "", value: null },
      ],
      ready_count: 1,
      attention_count: 1,
    };
    const c = mount({ ...props, readiness: attn }).container;
    // The verdict owns the story…
    expect(c.querySelector(".hc-verdict-line")!.textContent).toBe("C: drive is 87% full");
    // …and the "top limiter" row does not restate it.
    expect(topLimiterRows(c)).toHaveLength(0);
    // The exact title appears exactly once across the whole console (the regression was twice).
    expect((c.textContent!.match(/C: drive is 87% full/g) ?? []).length).toBe(1);
  });

  it("a DIFFERENT flagged check does not suppress an unrelated top limiter (no false standdown)", () => {
    const attn: GameReadiness = {
      ...readiness,
      checks: [
        { id: "ref", label: "Refresh rate below max", status: "attention", detail: "Bump it.", value: null },
        { id: "b", label: "B", status: "ready", detail: "", value: null },
      ],
      ready_count: 1,
      attention_count: 1,
    };
    const c = mount({ ...props, readiness: attn }).container;
    expect(c.querySelector(".hc-verdict-line")!.textContent).toBe("Refresh rate below max");
    const row = topLimiterRows(c)[0];
    expect(row).not.toBeUndefined();
    expect(row.textContent).toContain("C: drive is 87% full");
  });
});

// Intelligence Phase 1, decision 7: Home carries at most ONE concise line — the engine's own
// verdict sentence verbatim (get_intelligence_headline is non-null ONLY for a real
// improved/regressed verdict, engine-enforced). Flag "0" must render nothing AND never fetch.
const headlineFixture = {
  text: "1% lows improved 10.1% vs your previous Valorant session. Most likely: GPU driver updated (medium confidence).",
  verdict: "improved",
  game: "Valorant",
  session_started_at: "2026-07-10T20:00:00Z",
};

// Two rows share .hc-limiter (deliberate class reuse). They used to be told apart by their
// micro-labels; since the bento conversion (2026-08-12) each lives in its own tile and the label IS
// the tile title, so the last-session row is located by its wrapper instead. The wrapper exists for
// exactly this reason — <BentoTile> takes no className.
const intelRow = (c: HTMLElement): HTMLElement | null =>
  c.querySelector<HTMLElement>(".hc-lastsession .hc-limiter");

describe("HomeConsole — the last-session intelligence line (Intelligence Phase 1)", () => {
  it("renders the engine's headline verbatim with the door into Monitor (rooms has play)", async () => {
    state.headline = headlineFixture;
    const nav = vi.fn();
    const c = mount({ ...props, rooms: groundRooms, onNavigate: nav }).container;
    await waitFor(() => expect(intelRow(c)).not.toBeNull());
    const row = intelRow(c)!;
    expect(row.querySelector(".hc-limiter-title")!.textContent).toBe(headlineFixture.text);
    // The headline sentence already names the game — the row adds no second game tag.
    expect(row.querySelectorAll(".hc-limiter-tag")).toHaveLength(0);
    const door = row.querySelector("button")!;
    expect(door.textContent).toBe("See in Monitor");
    fireEvent.click(door);
    expect(nav).toHaveBeenCalledWith("play");
    // The limiter row is untouched beside it — two rows, each with its own label.
    expect(c.querySelectorAll(".hc-limiter")).toHaveLength(2);
  });

  it("honest door: no Monitor on the rail ⇒ the line renders without a dead-end button", async () => {
    state.headline = headlineFixture;
    const c = mount({
      ...props,
      rooms: [{ key: "lab", name: "Lab" }],
      onNavigate: () => {},
    }).container;
    await waitFor(() => expect(intelRow(c)).not.toBeNull());
    expect(intelRow(c)!.querySelector("button")).toBeNull();
  });

  it("no verdict ⇒ no line: a null headline renders nothing (never a fabricated sentence)", async () => {
    state.headline = null;
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    await waitFor(() => expect(state.calls).toContain("get_intelligence_headline"));
    expect(intelRow(c)).toBeNull();
  });

  it('compy_intelligence "0" failsafe: no line AND the IPC is never invoked', async () => {
    localStorage.setItem("compy_intelligence", "0");
    state.headline = headlineFixture; // even a ready headline must not leak through
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    await new Promise((r) => setTimeout(r, 0));
    expect(intelRow(c)).toBeNull();
    expect(state.calls).not.toContain("get_intelligence_headline");
  });
});

// bug→guard (self-reviewer 2026-07-18, flagged intermittently while reviewing §4H in 2D):
// the four .hc-corner ArcGauges used to be ALWAYS present inside .hc-stage (z-index:2, pinned 22px
// from each stage edge, ~56px tall) regardless of rig view mode. In 2D card mode
// (compy_home_rig_3d="0") .hc-stage-cards renders the full HardwareGrid; a full-height viewport
// (was max-height:420px) let a tall grid scroll its rows UNDER the top/bottom gauges — padding
// can't help a scroll container mid-scroll. The original fix confined the viewport to the
// gauge-free MIDDLE band.
//
// ISSUE #49 KILLED THE COLLISION AT THE ROOT rather than working around it: the approved direction
// is that nothing may cover rig content, so the gauges AND the floating control row left the canvas
// for the panel below it. The guard follows the defect instead of the workaround — the old
// "confined to the middle band" bound is no longer the property that keeps the bug dead, and
// asserting it would now be asserting a reserve for overlays that must never come back. What keeps
// it dead is: (1) nothing is positioned over the canvas at all, and (2) the card viewport is still
// a bounded scroller that cannot exceed the stage's own content box.
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const block = (css: string, selector: string) => {
  const m = stripComments(css).match(
    new RegExp(`${selector.replace(/[.[\]"=]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
  );
  if (!m) throw new Error(`selector ${selector} not found`);
  return m[1];
};

describe("HomeConsole — nothing covers the rig canvas (bug→guard, issue #49)", () => {
  it("2D mode: the card path renders, and NOTHING is layered over it", () => {
    localStorage.setItem("compy_home_rig_3d", "0");
    const c = mount().container;
    const stage = c.querySelector(".hc-stage")!;
    // The 2D fallback renders the real HardwareGrid, not the 3D hologram…
    expect(stage.querySelector(".hc-stage-cards .grid")).not.toBeNull();
    expect(stage.querySelector('[data-testid="rig-hologram"]')).toBeNull();
    // …and the things that used to sit on top of it are OUT of the canvas box entirely. Not hidden,
    // not z-ordered under — out. Each one is still on screen, one level up on the panel.
    expect(stage.querySelector(".hc-readout"), "the readout is back over the canvas").toBeNull();
    expect(stage.querySelector(".hc-controls"), "the control row is back over the canvas").toBeNull();
    expect(stage.querySelector(".hc-corner"), "a corner gauge is pinned to the canvas again").toBeNull();
    const panel = c.querySelector(".hc-panel")!;
    expect(panel.querySelector(".hc-readout"), "the readout left the panel").not.toBeNull();
    expect(panel.querySelector(".hc-controls"), "the controls left the panel").not.toBeNull();
    // Every reading survived the move. This is the half that matters: the fix must not have been
    // "we removed the things that were in the way".
    for (const id of ["readiness", "avgFps", "low1", "gpuTemp", "cpuTemp"]) {
      expect(c.querySelector(`[data-read="${id}"]`), `${id} was lost in the move`).not.toBeNull();
    }
  });

  it("3D mode: the annotation plane is the ONE thing over the canvas, and it cannot be clicked", () => {
    const c = mount().container;
    const stage = c.querySelector(".hc-stage")!;
    // The labels are allowed over the glass — they are the hologram's own captions. What is not
    // allowed is for them to take a click away from drag-orbit, which is why the plane is
    // pointer-events:none in CSS and carries no buttons in the DOM.
    expect(stage.querySelectorAll(".hc-ann").length).toBe(2);
    const css = readFileSync(join("src", "surfaces", "home-console.css"), "utf8");
    expect(block(css, ':root[data-v2="on"] .hc-ann')).toMatch(/pointer-events:\s*none/);
    expect(
      Array.from(stage.querySelectorAll(".hc-ann")).reduce((n, p) => n + p.querySelectorAll("button").length, 0),
      "an annotation plane grew a control over the canvas",
    ).toBe(0);
  });

  it("CSS: .hc-stage-cards is still a bounded scroll viewport, and it may not exceed the stage box", () => {
    const css = readFileSync(join("src", "surfaces", "home-console.css"), "utf8");
    const cards = block(css, ':root[data-v2="on"] .hc-stage-cards');
    expect(cards).toMatch(/overflow-y:\s*auto/); // a scroll viewport (clips, then scrolls), not clip
    const m = cards.match(/max-height:\s*(\d+)px/);
    expect(m, "max-height must be an explicit px bound").not.toBeNull();
    const maxH = Number(m![1]);
    // DERIVED bound: read the stage's own min-height AND padding so the two can never drift apart.
    // With the overlays gone the viewport may use the whole content box — but never more than it,
    // which is what keeps a tall HardwareGrid a scroller instead of a stage-stretching column.
    const stage = block(css, ':root[data-v2="on"] .hc-stage');
    const minM = stage.match(/min-height:\s*(\d+)px/);
    const padM = stage.match(/padding:\s*(\d+)px/);
    expect(minM, ".hc-stage must declare an explicit min-height").not.toBeNull();
    expect(padM, ".hc-stage must declare an explicit px padding").not.toBeNull();
    const content = Number(minM![1]) - 2 * Number(padM![1]);
    expect(maxH).toBeLessThanOrEqual(content);
    expect(maxH).toBeGreaterThan(0);
  });

  it("CSS: the stage floor compresses on a short viewport, so the readings clear the fold", () => {
    // bug→guard (self-review round 3, issue #49, 2026-08-23). At 1280×720 the scroll lane is only
    // ~595px tall. The comfortable-viewport stage box (min-height 500 + 2×20 padding = 540) pushed
    // .hc-readout to content-offset ~568, so .v2-content's own overflow sliced the strip in half —
    // the five LABELS were on screen with none of their VALUES. Five labelled readings showing no
    // numbers do not read as "scroll down", they read as five readings that came back empty, which
    // is an honest-measurement failure. Round 2's HUD margin reserve could not fix this: it stops
    // scrolled content entering the readout's band, it cannot create height a 720px window lacks.
    const css = readFileSync(join("src", "surfaces", "home-console.css"), "utf8");

    const mq = /@media\s*\(max-height:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(mq, "Health must carry a short-viewport override for the stage floor").not.toBeNull();
    const threshold = Number(mq![1]);
    const inside = mq![2];

    // Below the owner's real 980px-tall window, so his viewport keeps the approved comp's
    // proportions; at or above 720, so the size this defect was measured at is actually covered.
    expect(threshold).toBeLessThan(980);
    expect(threshold).toBeGreaterThanOrEqual(720);

    const stageMin = Number(/\.hc-stage\s*\{[^}]*min-height:\s*(\d+)px/.exec(inside)?.[1]);
    const cardsMax = Number(/\.hc-stage-cards\s*\{[^}]*max-height:\s*(\d+)px/.exec(inside)?.[1]);
    expect(Number.isFinite(stageMin), "the override must set an explicit stage min-height").toBe(true);
    expect(Number.isFinite(cardsMax), "the override must re-bound the card viewport too").toBe(true);

    // A FLOOR IS NOT ENOUGH, and this is the round-4 defect (self-review, issue #49): the rig is an
    // r3f <Canvas> that measures its parent and writes its own inline pixel size, while the parent
    // -- given no `height` -- is sized by that canvas in turn. Lowering a floor under a box that is
    // already taller than the floor changes nothing, so on the launch-then-shrink path (the one
    // every human and every capture harness takes) the canvas kept its old inline height and the
    // readings stayed sliced, even though getComputedStyle reported the new min-height correctly.
    // The override must therefore state an authoritative `height` for both boxes.
    const stageH = Number(/\.hc-stage\s*\{[^}]*[^-]height:\s*(\d+)px/.exec(inside)?.[1]);
    const rigH = Number(/\.hc-rig\s*\{[^}]*[^-]height:\s*(\d+)px/.exec(inside)?.[1]);
    expect(
      Number.isFinite(stageH),
      "the override must set an explicit stage HEIGHT, not only a min-height: a floor cannot " +
        "shrink a box whose rendered height comes from the canvas inside it",
    ).toBe(true);
    expect(
      Number.isFinite(rigH),
      "the override must set an explicit rig HEIGHT for the same reason",
    ).toBe(true);
    expect(stageH, "the stated height and floor must agree").toBe(stageMin);

    // MEASURED at 1280×720 on the installed build (self-review round 3): the scroll lane is 595px,
    // the furniture above the stage costs 28px, and .hc-readout is 170px tall. The whole strip has
    // to fit above the fold, so the stage BOX (min-height + its 2×20px padding) can be at most
    // 595 − 28 − 170 = 397px, i.e. a min-height of 357px. Anything taller slices the values off.
    const pad = Number(/:root\[data-v2="on"\] \.hc-stage \{[^}]*padding:\s*(\d+)px/.exec(css)?.[1]);
    expect(Number.isFinite(pad)).toBe(true);
    expect(
      stageMin + 2 * pad,
      "the compressed stage box must leave the readout strip fully above the fold at 1280×720",
    ).toBeLessThanOrEqual(397);

    // The base derivation still has to hold inside the override, or a tall HardwareGrid stretches
    // the stage instead of scrolling inside it — the exact thing the base bound exists to stop.
    expect(cardsMax).toBeLessThanOrEqual(stageMin - 2 * pad);
    expect(cardsMax).toBeGreaterThan(0);
  });
});
