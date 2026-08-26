import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";
import { HomeConsole } from "./HomeConsole";
import { INTERVIEW_ROOT, groupChoices, interviewQuestions } from "./home-interview-data";
import i18n from "../i18n";
import type {
  AppliedChange,
  GameReadiness,
  PendingCareIncident,
  Priorities,
  SessionSummary,
} from "../types";
import type { HardwareInfo } from "../App";

// ── THE DETECTION GATE ──────────────────────────────────────────────────────────────────────────
//
// OWNER DIRECTION, 2026-08-26, in his own words:
//
//   "i feel like offering help should only be an option if there an indicator that something was
//    detected from your pc that it would even inquire that. also we have to remember that compy
//    also does performance optimization and there should perhaps be an option that doesnt indicate
//    there is an issue whaatsoever ... the home page options all seem to only point towards some
//    sort of 'issue' which shouldnt be the only rerason people are here in the first place"
//
// It came out of the DIR-1 first-timer walk, which found Health offering two doors to the same
// question. The answer was not to delete one of them: it was that BOTH were symptom-framed, and a
// front door built only out of symptoms tells a healthy PC's owner either that they are in the
// wrong place, or — worse — that Compy found something. The second reading is the honest-measurement
// law failing in the direction nothing guarded: not a fabricated NUMBER, a fabricated PREMISE.
//
// So the symptom framing is now EARNED by something Compy actually measured, and the un-earned
// state offers Compy's other specialty instead. This file is the guard, and it is written to fail
// in BOTH directions — a change that makes the symptom cards permanent again fails here, and so
// does a change that makes them unreachable when the PC really did flag something.
//
// WHY A SEPARATE FILE. home-console.test.tsx mounts one healthy PC and asserts a hundred other
// things about it. A rule whose whole content is "these two states differ" cannot be pinned from a
// single state, and burying it among 52 unrelated cases is how the next reader mistakes it for an
// incidental assertion instead of a recorded owner decision.

const state = vi.hoisted(() => ({ gpuSensors: [{ temperature_c: 62 }] as unknown }));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "get_gpu_sensors") return Promise.resolve(state.gpuSensors);
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
vi.mock("./rig/RigHologram", () => ({ RigHologram: () => <div data-testid="rig-hologram" /> }));

beforeAll(() => {
  class Obs {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).ResizeObserver ??= Obs;
  (globalThis as Record<string, unknown>).IntersectionObserver ??= Obs;
});
afterEach(cleanup);
beforeEach(() => localStorage.clear());

const hw = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
  disks: [],
  memory_modules: [],
  physical_disks: [],
  display: { current_refresh_rate_hz: 165 },
  os_name: "Windows",
  os_version: "11",
} as unknown as HardwareInfo;

const clean: GameReadiness = {
  checks: [
    { id: "a", label: "A", status: "ready", detail: "", value: null },
    { id: "b", label: "B", status: "ready", detail: "", value: null },
  ],
  ready_count: 2,
  attention_count: 0,
  unknown_count: 0,
  advisory_count: 0,
  advisory: "",
  dismissed_ids: [],
  drifts: [],
};

const flagged: GameReadiness = {
  ...clean,
  checks: [
    {
      id: "refresh-rate",
      label: "Display is running below its top refresh rate",
      status: "attention",
      detail: "Running at 60 Hz but the display supports 165 Hz. Set the higher rate in Windows.",
      value: "60 / 165 Hz",
    },
    { id: "b", label: "B", status: "ready", detail: "", value: null },
  ],
  ready_count: 1,
  attention_count: 1,
};

const incident: PendingCareIncident = {
  incident_id: "inc-1",
  occurred_at: "2026-08-25T21:42:00-04:00",
  occurred_display: "Aug 25, 9:42 PM",
  kind: "App crash",
  app_label: "cyberpunk2077.exe",
  summary: "Windows recorded an app crash.",
};

const priorities: Priorities = {
  limiters: [],
  already_fine: [],
  not_worth_touching: [],
  session_hint: null,
  upgrade_path: null,
};

const groundRooms = [
  { key: "play", name: "Live" },
  { key: "learn", name: "History" },
  { key: "lab", name: "Test" },
];

type Props = Parameters<typeof HomeConsole>[0];

const mount = (over: Partial<Props> = {}) =>
  render(
    <ShellV2 items={railFor(false, true)} activeId="home" onNavigate={() => {}} ledgerCount={0}>
      <HomeConsole
        hw={hw}
        readiness={clean}
        priorities={priorities}
        sessions={[] as SessionSummary[]}
        changes={[] as AppliedChange[]}
        onRunCheck={() => {}}
        onSeeInFix={() => {}}
        rooms={groundRooms}
        onNavigate={() => {}}
        {...over}
      />
    </ShellV2>,
  ).container;

const t = (k: string) => i18n.t(k) as string;
const door = (c: Element) => c.querySelector(".hc-front-door")!.textContent;
const eyebrow = (c: Element) => c.querySelector(".hc-happening-q")!.textContent;
const cards = (c: Element) =>
  Array.from(c.querySelectorAll(".hc-happening-label")).map((n) => n.textContent);

/** The interview's own words for a start answer — never re-typed here (see the note below). */
const answer = (id: string) => {
  const choice = interviewQuestions(i18n.t)[INTERVIEW_ROOT].choices.find((c) => c.id === id);
  expect(choice, `the start screen has no answer "${id}" — the gate points at a dead id`).toBeTruthy();
  return choice!.label;
};

describe("the front door's framing is earned, never assumed", () => {
  // NON-VACUITY FIRST. Every assertion below compares two sets, and a test that compares a set with
  // itself passes forever while proving nothing. This is the floor the rest of the file stands on.
  it("the two shortcut sets are real, different, and made of answers that exist", () => {
    const clearCards = cards(mount());
    const flaggedCards = cards(mount({ readiness: flagged }));
    expect(clearCards.length, "Home shows no shortcuts at all").toBeGreaterThan(0);
    expect(flaggedCards.length, "the detected state lost its shortcuts").toBeGreaterThan(0);
    expect(clearCards, "the gate is a no-op — both states show the same cards").not.toEqual(
      flaggedCards,
    );
    // No overlap: a card that appears in both states is a card the gate does not actually gate.
    expect(clearCards.filter((l) => flaggedCards.includes(l))).toEqual([]);
    // And every label is the interview's OWN wording. Home may not author symptom copy: if these
    // strings were typed on this surface, a reworded answer would leave the card behind saying
    // something the interview no longer says.
    expect(flaggedCards).toEqual([answer("crash"), answer("slow"), answer("unsure")]);
    expect(clearCards).toEqual([answer("moreFps"), answer("watchFps"), answer("scores")]);
  });

  it("nothing detected: the door offers to improve the PC, and no card implies a fault", () => {
    const c = mount();
    expect(door(c), "a healthy PC is being offered help it did not ask for").toBe(
      t("home.interview.ui.doorClear"),
    );
    expect(eyebrow(c)).toBe(t("home.homeConsole.happening.eyebrowClear"));
    // The strongest half of the rule: the symptom framing is not merely demoted, it is ABSENT.
    const text = c.textContent ?? "";
    for (const id of ["crash", "slow"]) {
      expect(text, `"${answer(id)}" is on a screen where Compy measured nothing wrong`).not.toContain(
        answer(id),
      );
    }
  });

  it("a flagged check earns the symptom framing back", () => {
    const c = mount({ readiness: flagged });
    expect(door(c)).toBe(t("home.interview.ui.door"));
    expect(eyebrow(c)).toBe(t("home.homeConsole.happening.eyebrow"));
    expect(cards(c)).toContain(answer("crash"));
  });

  it("a recorded incident earns it too, on its own, with every check passing", () => {
    // The two triggers are independent on purpose. An incident the observer read out of Windows is
    // evidence whether or not any readiness check flagged — and a crash is the single state where
    // burying "it crashed or froze" would do the most harm.
    const c = mount({ readiness: clean, pendingCare: incident });
    expect(door(c)).toBe(t("home.interview.ui.door"));
    expect(cards(c)).toContain(answer("crash"));
  });

  it("the interview keeps both halves — a symptom half and a goal half", () => {
    // The gate above chooses BETWEEN the halves; this is the guard that there are two halves to
    // choose between. Deleting the goal answers would leave the code above green (it would show
    // an empty set) while quietly returning the front door to symptoms-only, which is the exact
    // thing the owner asked to change.
    const groups = groupChoices(interviewQuestions(i18n.t)[INTERVIEW_ROOT].choices, i18n.t);
    const byId = Object.fromEntries(groups.map((g) => [g.id, g]));
    expect(byId.wrong?.choices.length, "the symptom half is empty").toBeGreaterThan(0);
    expect(byId.goal?.choices.length, "the goal half is empty — this is the 2026-08-26 rule").toBeGreaterThan(0);
    // Each half is labelled, and the ungrouped remainder is not — a heading over one answer is
    // noise, and the not-sure answer belongs to neither half.
    expect(byId.wrong?.heading).toBeTruthy();
    expect(byId.goal?.heading).toBeTruthy();
    expect(byId.other?.heading).toBeNull();
    // Every start answer lands in exactly one group, so a new answer cannot go unrendered.
    const total = groups.reduce((n, g) => n + g.choices.length, 0);
    expect(total).toBe(interviewQuestions(i18n.t)[INTERVIEW_ROOT].choices.length);
  });

  it("every goal answer ends somewhere real — no dead ends in the new half", () => {
    // Law 1 of the interview, applied to the answers added on 2026-08-26. A goal answer that
    // resolves to a finding id nothing implements would render an empty card.
    const goal = groupChoices(interviewQuestions(i18n.t)[INTERVIEW_ROOT].choices, i18n.t).find(
      (g) => g.id === "goal",
    )!;
    for (const c of goal.choices) {
      expect(c.next.kind, `"${c.label}" goes nowhere`).toBe("finding");
      expect(c.hint, `"${c.label}" has no second line — Home's cards need one`).toBeTruthy();
    }
  });
});
