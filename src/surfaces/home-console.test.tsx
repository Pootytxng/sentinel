import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent, act } from "@testing-library/react";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";
import { postureLine } from "./command-center-data";
import { inEffectCounts } from "../data/machine-model";
import { HomeConsole } from "./HomeConsole";
import { READING_ROWS } from "../design/console/Reading";
// i18n update (2026-07-23): postureLine now takes a TFunction as its last param — the real
// i18next instance (English default, same as every assertion below already expects).
import i18n from "../i18n";
import type {
  AppliedChange,
  GameReadiness,
  PendingCareIncident,
  Priorities,
  SessionSummary,
} from "../types";
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
  pendingCare?: PendingCareIncident | null;
  onOpenCareIncident?: (incidentId: string) => void;
  onDismissCareIncident?: (incidentId: string) => void;
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
    const posture = postureLine(readiness, priorities, inEffectCounts(null), i18n.t);
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
    expect(c.querySelector(".v2-eyebrow .v2-eyebrow-dot-ok")).not.toBeNull();
    expect(c.querySelector(".v2-eyebrow-dot-scan")).toBeNull();
    // The check line is a plain sentence now, not the `3/3` ratio the navigation audit put on its
    // own jargon list (2026-08-11 §3). Same measured fact, said the way a person would say it.
    // QUERIED BY THE BAND'S OWN CLASS, not by the shell slot it used to occupy (owner ruling
    // 2026-08-23): 01-health-approved.png draws nothing under the verdict, so the band moved out
    // of `measured` and into `below`. What this test cares about is the SENTENCE, which is
    // unchanged — pinning it to a slot was pinning the wrong thing.
    expect(c.querySelector(".rcb")!.textContent).toContain("All 3 checks look good");
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
    // THE LABEL IS EARNED (owner direction 2026-08-26). `props` mounts a healthy PC, and on a
    // healthy PC "Help me with my PC" is Compy implying a problem it never measured. The
    // detection-gated pair is pinned in full by home-console-front-door-gate.test.tsx; this line
    // asserts the half this mount is in, so the two files fail together rather than one covering
    // for the other.
    expect(door.textContent).toBe(i18n.t("home.interview.ui.doorClear"));
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
    // Neither of these was ever gated on the flag; they ride along in every state. (`.rcb` is
    // the band's own root; it moved out of the shell's `measured` slot on 2026-08-23.)
    expect(c.querySelector(".rcb")).not.toBeNull();
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
    const posture = postureLine(attn, priorities, inEffectCounts(null), i18n.t);
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
    // THE DEK STANDS DOWN; A COUNT STANDS UP (owner ruling 2026-08-23). §C barred the flagged
    // check's DETAIL PARAGRAPH from the header, and that is still what this test guards — the
    // assertion below it, which is the one that actually catches the defect, is untouched.
    // 01-health-approved.png draws "15 of 16 checks look good." in this exact position, so the
    // sub node exists again; what may never come back is the paragraph.
    const sub = c.querySelector(".v2-verdict-sub");
    expect(sub, "the comp's count line").not.toBeNull();
    // THE ROUTE JOINED THE COUNT (owner ruling 2026-08-26), and the PARAGRAPH still may not.
    // The DIR-1 walk found this state naming a problem with no way to act on it on screen; asked
    // directly, the owner chose one short route line over both the paragraph and the status quo.
    // `fixRoomLabel` defaults to "Lab" in isolation — App passes the live rail's label.
    expect(sub!.textContent, "the count, then one route — never the check's prose").toBe(
      "1 of 2 checks looks good. What to do about it is in Lab.",
    );
    // …and the route is a real one: it fires the same handler the Re-run band's button fires.
    const seen: string[] = [];
    const routed = mount({
      ...props,
      readiness: attn,
      onSeeInFix: () => seen.push("fix"),
    }).container;
    act(() => {
      routed.querySelector<HTMLButtonElement>(".hc-verdict-next")!.click();
    });
    expect(seen, "the route line is decoration, not a door").toEqual(["fix"]);
    // …so the paragraph is nowhere in the header. The named headline stays.
    expect(c.querySelector(".v2-verdict")!.textContent).not.toContain("turn it back on");
    expect(c.querySelector(".hc-verdict-line")!.textContent).toContain("Applied Compy changes");
  });

  // BUG -> GUARD (self-caught 2026-08-26, DIR-1 first-timer walk). The limiter row stands DOWN
  // when the verdict headline already names it, and the code comment justifying that stand-down
  // said the fix route "still lives in the verdict dek + the Dock". The dek had been stood down in
  // this very state by #180 §C, so the justification named a sibling that no longer renders — the
  // exact shape of the #219 miss, where four documents said Home listed the remaining checks
  // "in full below" and it did not. A sentence about what a screen shows is a claim, and an
  // unverified claim is the same defect in a comment as in a doc.
  //
  // Both halves are pinned: the SENTENCE (so it cannot silently go stale again) and the BEHAVIOUR
  // it depends on (so the route it now names cannot quietly disappear the way the dek did).
  it("limiter stand-down: the comment names a route that actually renders", () => {
    const source = readFileSync("src/surfaces/HomeConsole.tsx", "utf8");
    const justification = source.match(/the limiter row stands down[\s\S]*?Mirrors the dek/)?.[0];
    expect(justification, "the stand-down comment moved — re-pin it").toBeTruthy();
    expect(justification, "the dek does NOT render in the attention state; it cannot be the route")
      .not.toMatch(/route still lives in the verdict dek/);
    expect(justification).toContain("the primary action + the Dock");

    // …and the route it now names is really on screen in the state the stand-down fires in.
    const attn: GameReadiness = {
      ...readiness,
      checks: [
        {
          id: "applied-changes",
          label: "Applied Compy changes",
          status: "attention",
          detail: "Turn it back on or roll it back in Test.",
          value: null,
        },
        { id: "b", label: "B", status: "ready", detail: "", value: null },
      ],
      ready_count: 1,
      attention_count: 1,
    };
    const c = mount({ ...props, readiness: attn }).container;
    expect(c.querySelector(".hc-verdict-line")!.textContent).toContain("Applied Compy changes");
    expect(c.querySelector(".hc-front-door"), "the ONE action UX-1 decision 1 promoted").not.toBeNull();
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
    const v = el.querySelector(".ag-v") ?? el.querySelector(".rd-n");
    return {
      el,
      value: v!.textContent,
      /** Honest-unmeasured: NOT YET on the ring, the reason line in a readout cell. */
      unmeasured: el.querySelector(".ag-tag-ny") ?? el.querySelector(".rd-none"),
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
      // ONE dash, not two (owner ruling 2026-08-23). Every approved comp draws a single em-dash
      // for a reading with no source; the doubled dash was mine and read as a redaction.
      expect(r.value, `${id} readout`).toBe("—");
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
    // `.rcb` = the band's own root. It moved out of the shell's `measured` slot on 2026-08-23
    // (see the note on the front-door test above); the sentence it prints is unchanged.
    expect(checking.querySelector(".rcb")!.textContent).toContain("Checking your PC now");
  });

  // P7-score (Constitution §34, §26): a check Compy could not read is not a failing check. It is
  // left out of the ratio and named beside the number; the grade words are calm. Fails on the code
  // before this slice (13 of 16 = 81 "FAIR", and "2 couldn't be read" nowhere).
  it("unreadable checks are left out of the readiness ratio and said beside it, never graded as failures", () => {
    const some: GameReadiness = {
      ...readiness,
      checks: Array.from({ length: 16 }, (_, i) => ({ id: `c${i}`, label: `C${i}`, status: i < 13 ? "ready" : i < 14 ? "attention" : "unknown", detail: "", value: null })),
      ready_count: 13,
      attention_count: 1,
      unknown_count: 2,
    };
    const c = mount({ ...props, readiness: some }).container;
    const r = readout(c, "readiness");
    expect(r.value).toBe("93"); // 13 of the 14 READABLE checks, not 13 of 16
    expect(r.el.textContent).toContain("13 of 14 checks passed");
    expect(r.el.textContent).toContain("2 couldn't be read");
    expect(r.el.textContent).toContain("Good");
    expect(r.el.textContent).not.toMatch(/NEEDS WORK|FAIR|GOOD/);
    cleanup();
    // Nothing readable at all: no ratio, no grade — the honest not-yet, never 0.
    const none: GameReadiness = { ...some, checks: some.checks.map((k) => ({ ...k, status: "unknown" })), ready_count: 0, attention_count: 0, unknown_count: 16 };
    const n = mount({ ...props, readiness: none }).container;
    expect(readout(n, "readiness").unmeasured).not.toBeNull();
    expect(readout(n, "readiness").value).not.toMatch(/\d/);
    expect(n.textContent).toContain("16 couldn't be read");
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
    expect(r.value).toBe("—");
    // "No reading" is the comp's wording (01-health-approved.png prints exactly that under CPU
    // TEMP); "see below" is C-19's requirement that an unmeasured reading is never a dead end,
    // and the CpuTempOffer tile it points at is literally below this strip. Both, in one line.
    expect(r.unmeasured!.textContent).toBe("No reading · see below");
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
    // P7-confidence: a high inference band reads "Likely" (one vocabulary); the band stays on data-confidence.
    expect(row.querySelector(".hc-limiter-tag")!.textContent).toContain("Likely");
    expect(row.querySelector(".hc-limiter-tag [data-confidence]")!.getAttribute("data-confidence")).toBe("high");
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

    // The bound was a literal (460), then a variable (--hc-rig-h). Both had to be kept in step with
    // the stage BY HAND, and round 9 retired that whole habit: the ceiling is now the box this
    // viewport is actually laid into, which cannot drift from itself. A percentage only resolves
    // against a DEFINITE parent, though, so the two rules that make it definite are part of this
    // guard -- without them the bound silently computes to `none` and a tall HardwareGrid goes back
    // to stretching the stage instead of scrolling inside it.
    expect(cards, "the card viewport rides the box it is laid into").toMatch(/max-height:\s*100%/);

    const stage = block(css, ':root[data-v2="on"] .hc-stage');
    expect(stage, "the stage must resolve a definite height for that percentage").toMatch(
      /(^|[^-])height:\s*var\(--hc-stage-max\)/m,
    );
    expect(stage, "...and STRETCH it into the rig, not centre an auto-sized box inside it").toMatch(
      /place-items:\s*stretch/,
    );
    const rig = block(css, ':root[data-v2="on"] .hc-rig');
    expect(
      rig,
      "a height on the rig is a restated number again -- and a percentage there needs a definite " +
        "parent, the exact property the r3f canvas circularity takes away",
    ).not.toMatch(/(^|[^-])height:/m);
  });

  it("CSS: no readout track is sized by its content (measured width budget)", () => {
    // bug->guard, self-review rounds 6, 7, 8 AND 9 (issue #49, 2026-08-23). ONE collision, four
    // mechanisms, one root cause -- a track sized by its CONTENT, in a strip whose content is
    // translated and wraps:
    //   R6 -- a bare 1.4fr's AUTOMATIC minimum is min-content, so the readiness track overflowed
    //         the CONTAINER and "READINESS" touched "AVG FPS".
    //   R7 -- a 1.4/5.4 share is 126px where the instrument needs ~151, so the overflow simply
    //         moved INSIDE the cell. Track made `auto`.
    //   R8 -- `auto` IS max-content, and the gauge's note ("= 15 of 16 checks passed", a TRANSLATED
    //         string) runs ~187px unwrapped, so the track took 253px and starved the four readings.
    //   R9 -- flooring the readings at max-content released THEIRS: the CPU cell carries "no CPU
    //         temp -- see below" (161px, the owner-decided offer line, #134/Q9c), which starved the
    //         readiness cell to 26px and printed its label on top of AVG FPS at every size.
    // Every one of those numbers was a scrollWidth read inside a box an earlier round had clamped,
    // and a scrollWidth measured inside a clamped box is NOT max-content. So the rule is absolute
    // and it holds in BOTH directions: no track here is content-sized. Every track is flex with an
    // explicit px floor derived from what CANNOT break -- the ring plus the longest unbreakable
    // WORD, never the longest string. Sentence-length strings wrap, and a wrapped line only makes
    // the strip taller, which the panel now absorbs by shrinking the stage (see the fluid-
    // composition guard) instead of by clipping anything.
    // ROUND 11 (#225, 2026-08-27) -- THIS CONSTANT WAS THE BUG. It said 565 and the strip is 547,
    // so every budget below was checked against 18px that do not exist and the guard stayed green
    // while the CPU-temp cell hung 10.7px off the strip's right edge, printing "CPU TEM". That is
    // rounds 6-9's own root cause -- a number nobody re-measured -- moved onto the guard itself.
    // Re-measured on the INSTALLED build 98653732 over CDP, Health room, OS window 1296x729 (the
    // window chrome is 16x9, so that is the CLIENT 1280x720 this line names):
    //   .hc-readout clientWidth 547, padding 16 each side => 515px content box.
    // To re-take it: launch with the WebView2 debug port, go to Health, size the OS window to
    // 1296x729, and read document.querySelector(".hc-readout").clientWidth. Do NOT copy a number
    // from an OS window of 1280x720 -- that is a 1264px client, NARROWER than the supported floor.
    const CLIENT = 547; // .hc-readout clientWidth at CLIENT 1280x720, the narrowest supported size
    const READS = [73, 73, 76, 76]; // widest UNBREAKABLE child of each reading cell, measured there
    const HAIRLINE = 1;
    const LABEL = 84; // "Readiness" at the 13px type floor -- one word, so it cannot wrap

    // ROUND 12 (Wave 1 Lane B self-review at 5ee0de97, 2026-09-03): READS are the VALUES, and the
    // widest unbreakable child of a measured cell is not its value -- it is the MEASURED pill. Read
    // on the installed build at CLIENT 1280x720: .rd-tag 92.6px wide inside a 74.3px content box,
    // three pills overlapping their neighbours' hairlines by 3.6-5.3px. Green the whole time,
    // because READS never counted the pill. Its width is derived from reading.css so a change to
    // its tracking or padding moves this floor with it; only the glyph run is a measured constant.
    const PILL_GLYPHS = 70.2; // "MEASURED", Geist Sans uppercase at the 13px label size, 2026-09-03
    const readingCss = stripComments(
      readFileSync(join("src", "design", "console", "reading.css"), "utf8"),
    );
    const tag = /\.rd-tag\s*\{([^}]*)\}/.exec(readingCss)?.[1] ?? "";
    const typeScale = readFileSync(join("src", "design", "type-scale.css"), "utf8");
    const labelPx = Number(/--type-label:\s*(\d+(?:\.\d+)?)px/.exec(typeScale)?.[1]);
    const tracking = Number(/letter-spacing:\s*(\d*\.?\d+)em/.exec(tag)?.[1]);
    const padX = Number(/padding:\s*\d+px\s+(\d+)px/.exec(tag)?.[1]);
    const borderPx = Number(/border:\s*(\d+)px/.exec(tag)?.[1]);
    expect(
      [labelPx, tracking, padX, borderPx].every(Number.isFinite),
      ".rd-tag must declare em tracking, px padding and a px border at the --type-label size",
    ).toBe(true);
    const PILL = PILL_GLYPHS + "MEASURED".length * tracking * labelPx + 2 * padX + 2 * borderPx;

    const css = readFileSync(join("src", "surfaces", "home-console.css"), "utf8");
    const tokens = readFileSync(join("src", "design", "tokens-v2.css"), "utf8");
    const readout = block(css, ':root[data-v2="on"] .hc-readout');
    const divider = /\.hc-readout\s*>\s*\*\s*\+\s*\*\s*\{([^}]*)\}/.exec(stripComments(css));
    expect(divider, "the readout must still draw a hairline between readings").not.toBeNull();

    // The instrument's own floor comes from the shared kit, not from a number retyped here: if the
    // ring grows, this guard tightens on its own.
    const kit = stripComments(
      readFileSync(join("src", "design", "console", "arc-gauge.css"), "utf8"),
    );
    const ring = Number(/\.arc-gauge > svg\s*\{[^}]*width:\s*(\d+)px/.exec(kit)?.[1]);
    const kitGap = Number(/\.arc-gauge\s*\{[^}]*gap:\s*(\d+)px/.exec(kit)?.[1]);
    expect(
      Number.isFinite(ring) && Number.isFinite(kitGap),
      "arc-gauge.css must still declare the ring width and its label gap",
    ).toBe(true);
    // ROUND 12: five pill-wide floors do not fit beside a 150px instrument in 515px, and the type
    // floor, the pill's one appearance and the single row are all fixed -- so the INSTRUMENT gives.
    // Health's cell lets the gauge's label wrap UNDER the ring (flex-wrap, the browser measuring,
    // no breakpoint), so its floor is the wider of the ring and the word "Readiness", not their
    // sum. Accepted only when the wrap is declared and the label keeps its whole word as its basis.
    const plain = stripComments(css);
    const arcCell = /\.hc-read-arc\s+\.ag-as-ring\s*\{([^}]*)\}/.exec(plain)?.[1] ?? "";
    const arcLabel = /\.hc-read-arc\s+\.ag-as-ring\s*>\s*\.ag-label\s*\{([^}]*)\}/.exec(plain)?.[1] ?? "";
    const wraps = /flex-wrap:\s*wrap/.test(arcCell);
    if (wraps) {
      const basis = Number(/flex:\s*1\s+1\s+(\d+)px/.exec(arcLabel)?.[1]);
      expect(
        basis,
        "the wrapped label's flex-basis must be at least the word \"Readiness\" (" + LABEL +
          "px), or it is squeezed before it wraps",
      ).toBeGreaterThanOrEqual(LABEL);
    }
    const GAUGE_MIN = wraps ? Math.max(ring, LABEL) : ring + kitGap + LABEL;

    // A length here may be a px literal, a v2 token, or the strip's own local variable. Resolve it,
    // so the budget is checked against what the browser will actually use.
    const len = (raw: string | undefined, where: string): number => {
      expect(raw, where + " must declare a length").toBeTruthy();
      const v = (raw ?? "").trim();
      const direct = /^(\d+(?:\.\d+)?)px$/.exec(v);
      if (direct) return Number(direct[1]);
      const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
      expect(ref, where + ' must be a px literal or one var(), got "' + v + '"').not.toBeNull();
      const name = ref![1];
      const find = (hay: string) => new RegExp(name + ":\\s*(\\d+(?:\\.\\d+)?)px").exec(hay);
      const hit = find(readout) ?? find(tokens);
      expect(hit, name + " must resolve to a px value (locally or in tokens-v2.css)").not.toBeNull();
      return Number(hit![1]);
    };

    // COLUMN gap specifically: round 10 gave the strip a row gap too, and only the column one
    // is spent on width. A bare `gap:` would silently read whichever came first.
    const gap = len(/column-gap:\s*([^;]+);/.exec(readout)?.[1], ".hc-readout column-gap");
    const pad = len(/padding:\s*([^;]+);/.exec(readout)?.[1], ".hc-readout padding");
    const sep = len(
      /padding-left:\s*([^;]+);/.exec(divider![1])?.[1],
      ".hc-readout > * + * padding-left",
    );

    const cols = /grid-template-columns:\s*([^;]+);/.exec(readout);
    expect(cols, ".hc-readout must declare its tracks explicitly").not.toBeNull();
    const norm = cols![1].replace(/\s+/g, "");

    // (1) NOTHING content-sized may appear in the template at all. Each of the four rounds above
    //     shipped one of these words, and each one starved a different cell.
    for (const banned of ["auto", "max-content", "min-content", "fit-content"]) {
      expect(
        norm,
        "`" + banned + "` sizes a track by its CONTENT, and this strip's content is translated: " +
          "rounds 6-9 each shipped one of these, and each time a reading or the instrument was " +
          "printed on top of its neighbour",
      ).not.toContain(banned);
    }

    // (2) Every track is minmax(<px floor>, <n>fr) -- an explicit floor so nothing can starve it,
    //     a flex share so nothing INSIDE it can widen it. Anything else in the template fails here.
    const expanded = norm.replace(
      /repeat\((\d+),(minmax\(\d+px,\d+fr\))\)/g,
      (_m, n: string, track: string) => track.repeat(Number(n)),
    );
    const parts = expanded.match(/minmax\(\d+px,\d+fr\)/g) ?? [];
    expect(
      parts.join(""),
      "every readout track must be minmax(<px floor>, <n>fr); got " + norm,
    ).toBe(expanded);
    expect(parts.length, "the strip is the readiness instrument plus four readings").toBe(5);
    const floors = parts.map((p) => Number(/(\d+)px/.exec(p)![1]));

    // (3) Each floor clears its own unbreakable content...
    expect(
      floors[0],
      "the readiness track must fit the ring, its gap and the word \"Readiness\" (" + GAUGE_MIN +
        "px) -- a starved instrument prints its label over the reading beside it",
    ).toBeGreaterThanOrEqual(GAUGE_MIN);
    READS.forEach((w, i) => {
      const widest = Math.max(w, PILL);
      expect(
        floors[i + 1],
        "reading " + (i + 1) + " must fit its widest unbreakable child (" + widest.toFixed(1) +
          "px: its value, or the MEASURED pill, whichever is wider) plus the hairline and its " +
          "padding: a reading clipped by its neighbour is a reading nobody can read",
      ).toBeGreaterThanOrEqual(widest + HAIRLINE + sep);
    });

    // (4) ...and all five together still fit the narrowest supported strip, or the browser
    //     over-subscribes the row and puts one cell on top of another exactly as before.
    const content = CLIENT - 2 * pad;
    const needed = floors.reduce((a, b) => a + b, 0) + 4 * gap;
    expect(
      needed,
      "at 1280x720 the five floors need " + needed + "px of a " + content + "px strip. Buy the " +
        "difference back from gap/padding (they carry no reading) -- never from the 13px type " +
        "floor, and never by wrapping the strip to a second row.",
    ).toBeLessThanOrEqual(content);
  });

  it("CSS: the five readings share ONE set of rows, so a wrapped label cannot move its value", () => {
    // bug->guard, self-review round 10 (issue #49, 2026-08-23). Every reading is label · value ·
    // attestation, and each cell used to be a flex column sizing those three rows FOR ITSELF. At
    // 1280x720 "GPU TEMP" and "CPU TEMP" wrap to two lines where "AVG FPS" and "1% LOW" do not, so
    // their values sat 17px lower than their neighbours' and the row of numbers stopped being a
    // row. The approved comp reads across; a staggered row does not.
    // Width cannot fix this. There is no width to give at 720p, and the next translation wraps a
    // different label anyway -- which is the same "a number nobody re-measured" failure class as
    // rounds 3, 5, 8 and 9, one axis over. Sharing the rows removes the dependency instead: row 1
    // is as tall as the tallest label, row 2 as the tallest value, row 3 as the tallest
    // attestation, in every language, however many lines any one label takes.
    // SLICE 3 SPLIT THIS CONTRACT ACROSS TWO FILES, so the guard reads both. The cell is the shared
    // kit's now (design/console/reading.css) and the strip is still Health's (home-console.css);
    // either half alone looks fine while the pair is broken, which is exactly the seam a promotion
    // creates. READING_ROWS is the one number both sides are checked against -- never a literal 3.
    const css = readFileSync(join("src", "surfaces", "home-console.css"), "utf8");
    const kit = readFileSync(join("src", "design", "console", "reading.css"), "utf8");
    const readout = block(css, ':root[data-v2="on"] .hc-readout');
    // EVERY rule that touches the class, not just the first one: a cell can be styled by a shared
    // rule AND by its own, and block() would only ever see whichever came first.
    const rulesFor = (cls: string, source: string) =>
      Array.from(stripComments(source).matchAll(/([^{}]+)\{([^}]*)\}/g))
        .filter(([, sel]) => new RegExp("\\" + cls + "(?![\\w-])").test(sel))
        .map(([, , body]) => body)
        .join("\n");
    const read = rulesFor(".reading", kit);
    const arc = rulesFor(".hc-read-arc", css);

    const rows = /grid-template-rows:\s*([^;]+);/.exec(readout);
    expect(rows, ".hc-readout must own the rows the readings are laid onto").not.toBeNull();
    const trackCount = rows![1].trim().split(/\s+/).length;
    expect(
      trackCount,
      "label, value and attestation -- Reading.tsx's READING_ROWS, which is what its cells span",
    ).toBe(READING_ROWS);

    expect(
      read,
      "a reading may not size its own rows: a flex column (or any independent grid) lets a label " +
        "that wraps push ONLY its own value down, which is exactly how the row broke",
    ).toMatch(/grid-template-rows:\s*subgrid/);
    expect(read, "...and it has to be a grid for that to mean anything").toMatch(/display:\s*grid/);
    expect(read, "a subgrid item must cover the tracks it borrows").toMatch(/align-self:\s*stretch/);

    // The span and the track count are the same fact stated twice, so DERIVE both from READING_ROWS
    // -- a cell that spans 2 of 3 rows silently stops sharing the third.
    for (const [what, blk] of [[".reading (kit)", read], [".hc-read-arc", arc]] as const) {
      const span = /grid-row:\s*span\s*(\d+)/.exec(blk);
      expect(span, what + " must span the strip's rows explicitly").not.toBeNull();
      expect(
        Number(span![1]),
        what + " spans " + span![1] + " of .hc-readout's " + trackCount + " rows. Add a row to the " +
          "strip without adding it here and the cells quietly stop sharing it.",
      ).toBe(READING_ROWS);
    }
  });

  it("CSS: Health is ONE fluid composition — no breakpoint, and no constant that can go stale", () => {
    // bug->guard, self-review rounds 3, 4, 5 AND 9 (issue #49, 2026-08-23). Four findings, one rule.
    //
    // R3: at 1280x720 the 540px stage pushed .hc-readout past .v2-content's clip -- five LABELS on
    //     screen with none of their five VALUES. That does not read as "scroll down", it reads as
    //     five readings that came back empty: an honest-measurement failure, not a cosmetic one.
    // R4: a lower min-height ALONE did nothing. The rig is an r3f <Canvas> that measures its parent
    //     and writes its own inline pixel size, so a parent carrying only a floor is in turn sized
    //     by that canvas. An authoritative height is what breaks the circle from the outside.
    // R5: both fixes shipped as an @media block, which the approved handoff rules out in as many
    //     words -- "no responsive media queries. Do not add breakpoints as a shortcut."
    // R9: their replacement was a clamp() that subtracted --hc-panel-below, a HAND-MEASURED height
    //     for the control row + readout strip. That number was wrong in rounds 3, 5, 8 and 9,
    //     always the same way: the strip's height is however many lines its TRANSLATED strings wrap
    //     to, which depends on the width they are given, which depends on the stage. No measurement
    //     taken before a fix survives the fix. So .hc-panel may name FIXED CHROME and nothing else,
    //     and the browser does the measuring -- which is the one measurement that cannot go stale.
    const css = readFileSync(join("src", "surfaces", "home-console.css"), "utf8");
    const bare = stripComments(css);

    // A comment NAMING the retired block is not a breakpoint, so compare against the rules alone.
    expect(
      bare,
      "no @media in Health: the approved handoff forbids breakpoints as a shortcut",
    ).not.toMatch(/@media/);

    for (const dead of ["--hc-panel-below", "--hc-rig-h", "--hc-stage-h"]) {
      expect(
        bare,
        dead + " was a height derived from content that wraps under translation. Round 9 deleted " +
          "it; bringing it back re-opens a defect that took four rounds to kill.",
      ).not.toContain(dead);
    }

    const panel = block(css, ':root[data-v2="on"] .hc-panel');

    // Nothing on the panel may be a number someone had to measure off the screen. Two of these are
    // the approved comp's stage bounds; the other three are FIXED chrome -- a shell bar, a HUD
    // band, a margin -- none of them text whose height can change in another language.
    const ALLOWED: Record<string, string> = {
      "hc-stage-min": "the rig's usable floor",
      "hc-stage-max": "the approved comp's stage height",
      "hc-chrome-top": "46px shell topbar + 26px .v2-content padding-top",
      "hc-comp-drop": "the approved comp's offset of this card below the row top",
      "hc-hud-reserve": "hud-frame.css's own band height",
      "hc-stage-slack": "margin above the lane's clip",
    };
    const px: Record<string, number> = {};
    for (const [, name, raw] of Array.from(panel.matchAll(/(--[\w-]+):\s*([^;]+);/g))) {
      const key = name.slice(2);
      expect(
        Object.keys(ALLOWED),
        name + " is a new constant on .hc-panel. Only FIXED chrome may live here -- anything " +
          "measured off content goes stale the moment a string is translated (round 9).",
      ).toContain(key);
      const lit = /^(\d+)px$/.exec(raw.trim());
      expect(
        lit,
        name + " must be a plain px literal (" + ALLOWED[key] + "), never a calc() or clamp(): a " +
          "derivation here is how the stale constant got in.",
      ).not.toBeNull();
      px[key] = Number(lit![1]);
    }
    for (const key of Object.keys(ALLOWED)) {
      expect(px, "--" + key + " must still be declared on .hc-panel").toHaveProperty(key);
    }

    // The panel is capped at the room the lane actually has, and every subtrahend is named.
    const cap = /max-height:\s*calc\(([\s\S]*?)\)\s*;/.exec(panel);
    expect(cap, ".hc-panel must cap itself at the viewport minus its chrome").not.toBeNull();
    expect(cap![1], "the cap must track the VIEWPORT, not a breakpoint").toContain("100vh");
    for (const key of ["hc-chrome-top", "hc-comp-drop", "hc-hud-reserve", "hc-stage-slack"]) {
      expect(cap![1], "--" + key + " must be part of the cap").toContain("var(--" + key + ")");
    }
    // #225 round 2 dropped the panel --hc-comp-drop below the row top to match the approved comp.
    // A drop that is NOT also subtracted from the cap is the same arithmetic defect rounds 3-9
    // paid for, one level up: the panel would still believe it may fill the lane from the top, so
    // at 1280x720 its bottom would land ~48px under the clip and a reading would go with it. The
    // margin and the cap must therefore spend the SAME token -- pinned here so neither can drift
    // from the other, and so the literal can never be restated as a second number.
    expect(
      panel,
      "the drop must be applied as margin-top: var(--hc-comp-drop) -- a second literal here is " +
        "how the cap and the offset stop agreeing",
    ).toMatch(/margin-top:\s*var\(--hc-comp-drop\)\s*;/);
    expect(
      cap![1],
      "the cap may not subtract the stage's own bounds -- the stage is INSIDE the panel, and " +
        "subtracting a child from its parent is how the arithmetic drifted in the first place",
    ).not.toContain("hc-stage-m");

    // WHAT THE CAP IS, stated exactly, because round 11 caught this guard overstating it: a CEILING
    // against the lane's visible height. It is deliberately NOT a promise that the panel FITS the
    // lane, and it cannot be one -- the panel starts below the room's verdict headline, a translated
    // sentence whose height is precisely the content measurement rounds 3, 5, 8 and 9 proved cannot
    // be pinned. (It measured 106 in English on 40aca1ca. Do NOT encode that; encoding it is the
    // mistake those four rounds were.) Measured at an exact 1280x720 inner viewport on 40aca1ca:
    // the lane clips at 684, the panel's own content is 596 -- under the 598 the cap allows, so at
    // that size the cap is not even the binding constraint -- and the panel's bottom PADDING lands
    // ~18px below the clip while its last painted text ends at 672, above it. The lane scrolls, so
    // that is a short border, not a lost reading. What keeps readings readable is the never-clip net
    // and the fact that only the stage shrinks.
    const SHORT = 720;
    const capAt = (viewport: number) =>
      viewport -
      px["hc-chrome-top"] -
      px["hc-comp-drop"] -
      px["hc-hud-reserve"] -
      px["hc-stage-slack"];
    expect(
      capAt(SHORT),
      "at 1280x720 the cap must still leave the rig its usable floor -- inflate the named chrome " +
        "past this and the stage has nowhere left to stand",
    ).toBeGreaterThan(px["hc-stage-min"]);
    // ROUND 12b (Wave 1 Lane B self-review round 2 at 1dd701b1, 2026-09-03): the floor must ALSO
    // leave the readout its WRAPPED height. Round 12 let the readiness label wrap under its ring
    // below 150px, which at an exact 1280x720 makes the strip 83px taller than inline -- and the
    // stage was already standing on its floor, so the panel overflowed by 41px and "14 of 16 checks
    // passed" was reachable only by a scroll nobody was shown. The horizontal budget was re-derived
    // to the pixel and the vertical one was never looked at. The panel's non-stage content at that
    // size -- control row + wrapped readout + padding -- measured 269px on the installed 1dd701b1
    // (scrollHeight 589 with the stage at 320). That is a CONTENT measurement, so it is not the
    // authority: the self-reviewer's live `.hc-panel` scrollHeight === clientHeight check at all
    // three sizes is (rubric item 5). This pin only refuses the floor being raised back past the
    // last measured budget, and asks one more wrapped 13px line of room beyond it.
    const NON_STAGE_720 = 269; // measured 2026-09-03, installed 1dd701b1, 1280x720, English
    const BORDERS = 2; // .hc-panel's own 1px top + bottom border, inside its border-box max-height
    const LINE = 18; // one wrapped line at the 13px label floor, line-height 1.35 -> 17.55
    expect(
      capAt(SHORT) - BORDERS - NON_STAGE_720 - px["hc-stage-min"],
      "at 1280x720 the wrapped readout plus the rig's floor must fit the panel's cap with one more " +
        "wrapped line to spare -- lower --hc-stage-min or shrink the strip; a note nobody can see " +
        "is the clipped reading rounds 3-9 paid for",
    ).toBeGreaterThanOrEqual(LINE);
    // ...and the owner's real window and 1080p must still be able to give the comp its full stage.
    for (const v of [980, 1080]) {
      expect(
        capAt(v),
        v + "px of viewport must still fit the approved comp's stage",
      ).toBeGreaterThan(px["hc-stage-max"]);
    }

    // WHICH child gives ground is now the entire mechanism, so pin it. The control row and the
    // readout are text at a fixed type size; shrinking either is how rounds 3 and 4 sliced the
    // readings off the bottom of the room.
    const fixed = /\.hc-panel\s*>\s*\.hc-controls,[\s\S]{0,160}?\.hc-panel\s*>\s*\.hc-readout\s*\{([^}]*)\}/.exec(bare);
    expect(fixed, "the control row and the readout must be pinned flex: none").not.toBeNull();
    expect(fixed![1], "a shrinkable readout is a clipped reading waiting to happen").toMatch(/flex:\s*none/);

    const stage = block(css, ':root[data-v2="on"] .hc-stage');
    // R4's lesson, still load-bearing -- only now the authoritative height is the flex BASE, which
    // flex-shrink resolves to a definite used height without ever asking the canvas.
    expect(stage, "the stage asks for the approved comp's height").toMatch(
      /(^|[^-])height:\s*var\(--hc-stage-max\)/m,
    );
    expect(stage, "...and never goes below the rig's usable floor").toMatch(
      /min-height:\s*var\(--hc-stage-min\)/,
    );
    const flex = /(^|[^-])flex:\s*([^;]+);/m.exec(stage);
    expect(flex, "the stage must declare the flex that lets it give ground").not.toBeNull();
    expect(
      flex![2].trim().split(/\s+/)[1],
      "the stage is the ONE shrinkable child: a rendered canvas is smaller, while every other " +
        "block on this panel is text that would have to be cut",
    ).toBe("1");

    const rig = block(css, ':root[data-v2="on"] .hc-rig');
    expect(
      rig,
      "the rig may not state a height of its own: a restated number drifts, and a percentage needs " +
        "a definite parent -- the exact property the canvas circularity takes away. Grid stretch " +
        "hands it the stage's resolved box instead.",
    ).not.toMatch(/(^|[^-])height:/m);

    // The net, for the case where the stage is already at its floor and the panel still cannot fit.
    expect(
      panel,
      "the leftover must become a SCROLL, never a clip. Round 3 lost five values to the lane's " +
        "clip silently; a scrollbar is ugly, but a reading nobody can reach is dishonest.",
    ).toMatch(/overflow-y:\s*auto/);

    // The HUD reserve is hud-frame.css's number (self-review round 2 owns the 36px). If that band
    // grows and Health's reserve does not, the strip is back underneath it.
    const hud = stripComments(
      readFileSync(join("src", "design", "console", "hud-frame.css"), "utf8"),
    );
    const hudMargin = Number(
      /\.v2-shell-hud \.v2-content\s*\{[^}]*margin-bottom:\s*(\d+)px/.exec(hud)?.[1],
    );
    expect(Number.isFinite(hudMargin), "hud-frame.css must still declare the band's reserve").toBe(true);
    expect(
      px["hc-hud-reserve"],
      "Health must reserve at least the HUD readout band's own height",
    ).toBeGreaterThanOrEqual(hudMargin);
  });
});

// ── 01-health-approved.png, the narrative column below the fold (owner ruling 2026-08-23) ────────
// The comp draws three symptom CARDS (glyph · title · one grey line · chevron) and, under a rule,
// one rescue ROW (life ring · name · the user's own symptom · Open). These pin the parts that were
// wrong, and one that must never come back.
describe("HomeConsole — the symptom cards and the rescue row match the comp", () => {
  it("each card carries a glyph, the interview's own title, and its own second line", () => {
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    const rows = Array.from(c.querySelectorAll(".hc-happening-row"));
    expect(rows.length, "the three shortcuts are gone").toBe(3);
    for (const row of rows) {
      expect(row.querySelector(".hc-happening-ico svg"), "a card with no glyph").not.toBeNull();
      expect(row.querySelector(".hc-happening-label")!.textContent!.length).toBeGreaterThan(0);
      // The grey line is the CHOICE's own hint, threaded out of home-interview-data — not copy
      // authored on this surface. If it ever renders empty the two have drifted apart.
      const sub = row.querySelector(".hc-happening-sub");
      expect(sub, "the card's description line is missing").not.toBeNull();
      expect(sub!.textContent!.length).toBeGreaterThan(0);
    }
    // A HEALTHY PC GETS THE GOAL CARDS (owner direction 2026-08-26). `props` mounts with nothing
    // flagged, so the symptom set is not earned here and the first card is the first GOAL answer.
    // Both sets, and the switch between them, are pinned by home-console-front-door-gate.test.tsx.
    expect(rows[0].querySelector(".hc-happening-sub")!.textContent).toBe(
      "Free up what your games are competing with.",
    );
  });

  it("the rescue row is name + symptom + Open, and the method line stays off it", () => {
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    const entry = c.querySelector(".hc-care-entry")!;
    expect(entry.querySelector(".hc-care-ico svg"), "the life ring is missing").not.toBeNull();
    // P6-door: the one Care door is named for the user's situation, not for the station.
    expect(entry.querySelector(".hc-care-label")!.textContent).toBe("Something's wrong");
    expect(entry.querySelector(".hc-care-symptom")!.textContent).toBe(
      "It crashes, freezes or stutters and I don't know why",
    );
    expect(entry.querySelector(".hc-care-open")!.textContent).toContain("Open");
    // The comp draws ONE description line. `because` ("reads Windows' own crash & freeze record in
    // plain English") is a METHOD note and belongs to the station this row opens, not to the door.
    expect(entry.querySelector(".hc-care-because"), "the method line is back on the door").toBeNull();
    expect(entry.textContent, "…and not smuggled in unclassed either").not.toContain("plain English");
  });
});

// ── The Care notice (Tier 1 plan task 9 — the observer's only visible surface) ───────────────────
//
// The notice is what the incident observer produces. It is the one thing on Home the user did not
// ask for, so every assertion below is about restraint: it says WHAT happened, it offers two real
// exits, and it never displaces the permanent rescue door underneath it.
describe("HomeConsole — the Care notice", () => {
  const pending = {
    incident_id: "a1b2c3d4e5f60718",
    occurred_at: "2026-08-24T21:14:00Z",
    occurred_display: "yesterday, 9:14 PM",
    kind: "App crash",
    app_label: "cyberpunk2077.exe",
    summary: "Cyberpunk 2077 closed unexpectedly.",
  };
  const withNotice = { ...props, rooms: groundRooms, onNavigate: () => {}, pendingCare: pending };

  it("renders nothing at all when the observer has nothing to say", () => {
    const c = mount({ ...props, rooms: groundRooms, onNavigate: () => {} }).container;
    expect(c.querySelector(".hc-notice"), "a notice rendered with no pending incident").toBeNull();
    // …and the permanent door is still there. This is the pairing that matters: the door does not
    // depend on the notice, so a machine that has never crashed still learns where rescue lives.
    expect(c.querySelector(".hc-care-entry"), "the rescue door vanished with the notice").not.toBeNull();
  });

  it("states what happened, to which app, and when — and stops there", () => {
    const c = mount(withNotice).container;
    const notice = c.querySelector(".hc-notice")!;
    expect(notice, "the notice did not render for a pending incident").not.toBeNull();
    expect(notice.querySelector(".hc-notice-head")!.textContent).toBe("Cyberpunk 2077 closed unexpectedly.");
    const meta = notice.querySelector(".hc-notice-meta")!.textContent!;
    expect(meta).toContain("App crash");
    expect(meta).toContain("cyberpunk2077.exe");
    expect(meta).toContain("yesterday, 9:14 PM");
    // No cause, no confidence, no fix. Compy has not looked yet — it has only noticed.
    expect(notice.textContent, "the notice speculates about a cause it has not established")
      .not.toMatch(/because|caused|likely|probably|driver|overheat/i);
  });

  it("drops the app clause when Windows did not name an app", () => {
    const c = mount({ ...withNotice, pendingCare: { ...pending, app_label: null } }).container;
    const meta = c.querySelector(".hc-notice-meta")!.textContent!;
    expect(meta).toContain("App crash");
    expect(meta).toContain("yesterday, 9:14 PM");
    // An empty separator ("App crash ·  · yesterday") is how a missing field reads as a bug.
    expect(meta, "the app slot rendered empty rather than being dropped").not.toMatch(/·\s*·/);
  });

  it("keeps the permanent rescue door BELOW it, not replaced by it", () => {
    const c = mount(withNotice).container;
    const notice = c.querySelector(".hc-notice")!;
    const door = c.querySelector(".hc-care")!;
    expect(door, "the notice replaced the permanent rescue door").not.toBeNull();
    expect(
      notice.compareDocumentPosition(door) & Node.DOCUMENT_POSITION_FOLLOWING,
      "the transient notice now renders below the permanent door",
    ).toBeTruthy();
  });

  it("hands the exact incident id to the open handler", () => {
    // The whole point of task 8's deep-link: the user clicks one crash and lands on THAT crash.
    const opened: string[] = [];
    const c = mount({ ...withNotice, onOpenCareIncident: (id: string) => opened.push(id) }).container;
    fireEvent.click(c.querySelector(".hc-notice-open")!);
    expect(opened, "the open button did not carry the incident id").toEqual(["a1b2c3d4e5f60718"]);
  });

  it("offers a dismiss that is a real, findable button", () => {
    const dismissed: string[] = [];
    const c = mount({ ...withNotice, onDismissCareIncident: (id: string) => dismissed.push(id) }).container;
    const btn = c.querySelector(".hc-notice-dismiss")!;
    expect(btn.tagName, "the dismiss is not a button — it cannot be reached by keyboard").toBe("BUTTON");
    fireEvent.click(btn);
    expect(dismissed).toEqual(["a1b2c3d4e5f60718"]);
  });

  it("gives both exits the same element weight", () => {
    // A dismiss rendered as a link, or as text, next to a filled primary is the dark pattern: it
    // reads as "the only real choice is to look". Both are buttons, side by side, in one group.
    const c = mount(withNotice).container;
    const acts = c.querySelector(".hc-notice-acts")!;
    const buttons = acts.querySelectorAll("button");
    expect(buttons.length, "the notice's action group is not exactly two buttons").toBe(2);
    expect(buttons[0].textContent).toBe("Find out why");
    expect(buttons[1].textContent).toBe("Not now");
  });

  it("is a labelled region, not an alert that steals focus", () => {
    // role="alert" would interrupt a screen-reader user mid-sentence for something that already
    // happened and is not urgent. A named region is findable without being an interruption.
    const c = mount(withNotice).container;
    const notice = c.querySelector(".hc-notice")!;
    expect(notice.tagName).toBe("SECTION");
    expect(notice.getAttribute("aria-label"), "the notice lost its accessible name").toBe(
      "Something Compy noticed",
    );
    expect(notice.getAttribute("role"), "the notice became an alert").toBeNull();
  });
});
