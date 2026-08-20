import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { HomeRoom } from "./HomeRoom";
import { ShellV2 } from "../design/ShellV2";
import { ConfirmProvider } from "../design/ConfirmDialog";
import { railFor } from "../design/homeRail";
import {
  homeCareEntry,
  fastPathReadyHeadline as fastPathReadyHeadlineRaw,
  fastPathApplyLabel as fastPathApplyLabelRaw,
  fastPathAppliedNote,
} from "./home-intake-data";
import { interviewQuestions } from "./home-interview-data";
import i18n from "../i18n";
import type {
  AppliedChange,
  GameReadiness,
  IntelligenceHeadline,
  Priorities,
  Recommendation,
  SessionSummary,
} from "../types";
import type { HardwareInfo } from "../App";

// RENDER GUARDS FOR THE INTERVIEW (design foundation step ③, issue #177) — the successor to
// home-intake.test.tsx, which guarded the intake BAND this replaced.
//
// The band is deleted, not disabled. Its rows, its panel and its flag are gone from src, so the
// tests that interrogated `.hc-intake-row` are gone with them: a test that renders a deleted
// element proves nothing and rots into noise. What survives here is every property that was about
// the USER rather than about the band's markup, re-aimed at the thing that now carries it:
//
//   1. The retired question stays retired — UNCONDITIONALLY now, not just in an off-state.
//   2. The interview's flag really gates it, and "0" is a real off switch.
//   3. The Care entry is visible in EVERY flag state (#91) and lands ON the crash evidence (§4).
//   4. No dead ends: nothing offers a room the live rail does not render.
//   5. The fast path applies EXACTLY the safeFixesReadyList stack, behind a confirm.
//   6. Copy honesty: real singular/plural, never "(s)".
//
// The Sheet portals to <body>, so interview assertions query `document`, not the container.

vi.mock("./rig/RigHologram", () => ({
  RigHologram: () => <div data-testid="rig-hologram" />,
}));

const intel = vi.hoisted(() => ({ headline: null as IntelligenceHeadline | null }));

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
    if (cmd === "get_intelligence_headline") return Promise.resolve(intel.headline);
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
  intel.headline = null;
});

const HOME_CARE_ENTRY = homeCareEntry(i18n.t);
const Q = interviewQuestions(i18n.t);
const fastPathReadyHeadline = (n: number) => fastPathReadyHeadlineRaw(n, i18n.t);
const fastPathApplyLabel = (n: number) => fastPathApplyLabelRaw(n, i18n.t);

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
  limiters: [],
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

// The rooms the live rail actually renders (labGround DEFAULT ON) — App derives this exact list.
const liveRooms = railFor(true, true)
  .filter((r) => r.id !== "home")
  .map((r) => ({ key: r.id, name: r.label }));

function rec(over: Partial<Recommendation> & { id: string }): Recommendation {
  return {
    id: over.id,
    title: over.title ?? over.id,
    category: over.category ?? "system",
    severity: over.severity ?? "safe",
    description: over.description ?? "",
    impact: over.impact ?? "",
    downside: over.downside ?? null,
    applies_to: over.applies_to ?? "all",
    currently_applied: over.currently_applied ?? false,
    provenance: over.provenance ?? "verified",
    eligible: over.eligible,
    ineligible_reason: over.ineligible_reason ?? null,
  };
}

const baseProps = {
  hw,
  readiness,
  priorities,
  sessions: [session],
  changes: [change],
  onRunCheck: () => {},
  onSeeInFix: () => {},
};

/**
 * Render Home with whatever flag state the test has already set — nothing is implied.
 * The polarity cases below use THIS one, because a harness that quietly writes the key would make
 * "what a fresh install gets" untestable.
 */
function renderHomeRaw(extra: Partial<React.ComponentProps<typeof HomeRoom>> = {}) {
  return render(
    <ConfirmProvider>
      <ShellV2 items={railFor(true, true)} activeId="home" onNavigate={() => {}} ledgerCount={1}>
        <HomeRoom {...baseProps} {...extra} />
      </ShellV2>
    </ConfirmProvider>,
  );
}

/**
 * Render Home with the interview OPTED IN, which is what every test about the interview's CONTENT
 * needs. `compy_home_interview` defaults OFF (theme.ts — it stands in for an owner decision, see
 * docs/decisions/2026-08-20-home-interview-default.md), so the door does not exist until something
 * asks for it. A test that already set the key explicitly keeps its own value.
 */
function renderHome(extra: Partial<React.ComponentProps<typeof HomeRoom>> = {}) {
  if (localStorage.getItem("compy_home_interview") === null) {
    localStorage.setItem("compy_home_interview", "1");
  }
  return renderHomeRaw(extra);
}

/** The front door button on Home — the ONE primary action, and the interview's only opener. */
const door = () => document.querySelector(".hc-front-door") as HTMLButtonElement | null;
/** Answers live inside the portalled Sheet. */
const answers = () =>
  Array.from(document.querySelectorAll(".hi-answer")) as HTMLButtonElement[];
const answerNamed = (label: string) =>
  answers().find((b) => b.textContent === label) as HTMLButtonElement;
const action = () => document.querySelector(".hi-action") as HTMLButtonElement | null;
/** Open the interview and return nothing — every helper below reads from `document`. */
function openInterview() {
  fireEvent.click(door() as HTMLElement);
}

// bug -> guard (owner caught it on his own desk 2026-08-18, and this is its second tightening).
// The owner removed the band's question on sight — "the what are you here to do text box was ugly
// looks cleaner without it" — and six days later UX-1 shipped those exact words back as the
// LARGEST control on the front door, because the guard of the day interrogated the PANEL while the
// words had moved to a button.
//
// The interview REPLACES that band, so the guard has to get stronger, not quieter. It is now
// unconditional: there is no flag state, no default and no opt-in under which the retired words
// come back, because the band they belonged to no longer exists in src at all. What ships in its
// place is a plainly different thing — a single button that says what it does for the user, and a
// question that only appears after they ask for it — and if a future train re-introduces the old
// wording anywhere on Home, this fails before it reaches him.
describe("the retired intake band stays retired (owner removed it on sight, 2026-08-12)", () => {
  const FLAG_STATES: [string, () => void][] = [
    ["absent (what a fresh install gets — reads OFF)", () => localStorage.removeItem("compy_home_interview")],
    ['"0" (the explicit off switch)', () => localStorage.setItem("compy_home_interview", "0")],
    ['"1" (explicitly on)', () => localStorage.setItem("compy_home_interview", "1")],
    ["junk (anything but \"1\" reads OFF)", () => localStorage.setItem("compy_home_interview", "true")],
  ];

  for (const [name, set] of FLAG_STATES) {
    it(`renders no intake band with the flag ${name}`, () => {
      set();
      const c = renderHomeRaw({
        rooms: liveRooms,
        recs: [rec({ id: "safe-ok" })],
        isAppliable: () => true,
        onApplyBatch: async () => ({ applied: 0, skipped: [] }),
      }).container;
      expect(c.querySelector(".hc-intake"), "the intake panel is back").toBeNull();
      expect(c.querySelector(".hc-intake-row"), "an intake row is back").toBeNull();
      expect(
        c.textContent ?? "",
        `the retired intake question is on Home with the flag ${name}`,
      ).not.toContain("What are you here to do");
    });
  }

  it("the front door names what it DOES for the user — it does not put a question on Home", () => {
    const c = renderHome({ rooms: liveRooms }).container;
    const btn = door();
    expect(btn, "the front door is missing").not.toBeNull();
    // A real button, not a div dressed as one (doorknob-guard's law, held here at the render).
    expect(btn!.tagName).toBe("BUTTON");
    expect(btn!.textContent).toBe(i18n.t("home.interview.ui.door"));
    // The question is not on the screen until the user asks for it.
    expect(c.textContent ?? "").not.toContain(Q.start.question);
    expect(document.querySelector(".hi-question")).toBeNull();
  });
});

// The flag. `compy_home_interview` is a NEW key, deliberately not the band's — a flag that outlives
// the thing it named is how a recorded owner decision quietly gets reversed. It DEFAULTS OFF, which
// is the answer the owner actually gave: he switched the band off on sight (4d1afa92) and switched
// it off again when he caught UX-1 bypassing him (8db70795). Retiring his key and defaulting the
// successor ON would have been the same bypass under a new name — the self-review caught exactly
// that on the first draft of this file. Polarity, defaults and the storage-throws case are pinned
// separately and in isolation by home-interview-default-guard.test.ts; what THIS block proves is the
// rendered consequence on Home, from the state a fresh install is really in (nothing in
// localStorage), because a test that always sets the key explicitly passes under either default and
// proves nothing.
describe("the interview's flag (compy_home_interview — DEFAULT OFF, \"1\" opts in)", () => {
  it("key ABSENT: NO front door — a first-run user gets Home exactly as he left it", () => {
    renderHomeRaw({ rooms: liveRooms });
    expect(localStorage.getItem("compy_home_interview")).toBeNull();
    expect(door()).toBeNull();
    expect(document.querySelector(".hi-question")).toBeNull();
  });

  it('key "1": the front door is there and opens the interview', () => {
    localStorage.setItem("compy_home_interview", "1");
    renderHomeRaw({ rooms: liveRooms });
    expect(door()).not.toBeNull();
    openInterview();
    expect(document.querySelector(".hi-question")).not.toBeNull();
  });

  it('only the literal "1" turns it on, so a junk value stays OFF', () => {
    for (const junk of ["true", "", "yes", "ON", "0", "2"]) {
      localStorage.setItem("compy_home_interview", junk);
      renderHomeRaw({ rooms: liveRooms });
      expect(door(), `value ${JSON.stringify(junk)}`).toBeNull();
      cleanup();
    }
  });

  it("opens on click and asks ONE question, with no way to get stuck", () => {
    renderHome({ rooms: liveRooms });
    openInterview();
    // One question, and it is the root.
    const questions = document.querySelectorAll(".hi-question");
    expect(questions.length, "more than one question is on screen at once").toBe(1);
    expect(questions[0].textContent).toBe(Q.start.question);
    // Every answer is offered, including the not-sure one — which is the same SIZE as the rest,
    // just quieter (decision 2 calls it first-class; fine print is not first-class).
    expect(answers().map((b) => b.textContent)).toEqual(Q.start.choices.map((c) => c.label));
    const unsure = answers().filter((b) => b.dataset.unsure === "yes");
    expect(unsure.length, "exactly one not-sure answer per screen (law 1)").toBe(1);
    // Nothing to go back to yet — the first screen is the root.
    expect(document.querySelector(".hi-back")).toBeNull();
  });

  it("back really goes back, so a wrong guess is not a restart", () => {
    renderHome({ rooms: liveRooms });
    openInterview();
    fireEvent.click(answerNamed(Q.start.choices[0].label)); // "it crashed…"
    expect(document.querySelector(".hi-question")?.textContent).toBe(Q.crash.question);
    fireEvent.click(document.querySelector(".hi-back") as HTMLElement);
    expect(document.querySelector(".hi-question")?.textContent).toBe(Q.start.question);
  });

  it("every answer reaches a finding that offers exactly ONE action — never a dead end (law 1)", () => {
    // Walk EVERY leaf of the tree. Law 1 is not "most branches answer something" — one branch that
    // ends on a card with nothing to press is the whole failure, and it is invisible unless the
    // sweep is exhaustive.
    for (const top of Q.start.choices) {
      const leaves =
        top.next.kind === "question" ? Q[top.next.id].choices.map((c) => c.label) : [null];
      for (const leaf of leaves) {
        renderHome({
          rooms: liveRooms,
          recs: [rec({ id: "safe-ok" })],
          isAppliable: () => true,
          onApplyBatch: async () => ({ applied: 0, skipped: [] }),
        });
        openInterview();
        fireEvent.click(answerNamed(top.label));
        if (leaf) fireEvent.click(answerNamed(leaf));
        const where = `${top.id}/${leaf ?? "-"}`;
        expect(document.querySelector(".hi-level"), `${where}: no level chip`).not.toBeNull();
        expect(document.querySelector(".hi-sentence"), `${where}: no sentence`).not.toBeNull();
        const btn = action();
        expect(btn, `${where}: the finding offers nothing to do`).not.toBeNull();
        expect(btn!.textContent?.trim().length, `${where}: blank action`).toBeGreaterThan(0);
        // Every finding is escapable — start over is always there, so a wrong turn is never final.
        expect(document.querySelector(".hi-restart"), `${where}: no way back out`).not.toBeNull();
        cleanup();
      }
    }
  });

  it("says so plainly when it has measured nothing, instead of dressing up an absence (law 2)", () => {
    // No sessions, no readiness, no recs → the honest empty state, and still an action.
    renderHome({ rooms: liveRooms, sessions: [], changes: [], readiness: null, recs: null });
    openInterview();
    fireEvent.click(answerNamed(Q.start.choices.find((c) => c.unsure)!.label));
    expect(document.querySelector(".hi-level")?.getAttribute("data-level")).toBe("unknown");
    expect(document.querySelector(".hi-evidence-list")).toBeNull();
    expect(document.querySelector(".hi-noevidence")?.textContent).toBe(
      i18n.t("home.interview.ui.noEvidence"),
    );
    expect(action(), "an unmeasured finding is a dead end").not.toBeNull();
  });

  it("quotes a real reading when it has one, and says MEASURED only then (law 2)", async () => {
    renderHome({ rooms: liveRooms, recs: [rec({ id: "safe-ok" })], isAppliable: () => true });
    openInterview();
    fireEvent.click(answerNamed(Q.start.choices.find((c) => c.unsure)!.label));
    // readiness is live in baseProps → the sweep is measured and quotes the check count.
    await waitFor(() =>
      expect(document.querySelector(".hi-level")?.getAttribute("data-level")).toBe("measured"),
    );
    const lines = Array.from(document.querySelectorAll(".hi-evidence-list li")).map(
      (n) => n.textContent,
    );
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join(" ")).toContain("3");
    expect(document.querySelector(".hi-noevidence")).toBeNull();
  });
});

// bug->guard (issue #91 Compy Care Tier 1, discovery contract — extracted 2026-08-12): crash rescue
// used to be an intake ROW, so it inherited the band's flag. The Settings failsafe took crash
// rescue down with the optimization band, and the population most likely to switch a busy band off
// overlaps hard with the population whose PC keeps crashing. The contract turns on one word: the
// Care entry is always visible on Home INDEPENDENT of any such flag. The band is gone and the
// interview took its place — so the divorce is now re-pinned against the interview's flag, because
// "independent of the band" would be a guard against a thing that no longer exists.
describe("Care entry — visible in EVERY state of compy_home_interview (#91)", () => {
  const careEl = (c: HTMLElement) => c.querySelector(".hc-care-entry") as HTMLElement | null;
  const states: Array<[string, () => void]> = [
    ["absent (what a fresh install really gets — the door is OFF)", () => localStorage.removeItem("compy_home_interview")],
    ['"0" (the explicit off switch — the case the extraction exists for)', () => localStorage.setItem("compy_home_interview", "0")],
    ['"1" (explicitly on)', () => localStorage.setItem("compy_home_interview", "1")],
    ["junk (anything but \"1\" is OFF)", () => localStorage.setItem("compy_home_interview", "false")],
  ];

  for (const [name, set] of states) {
    it(`renders with the flag ${name}`, () => {
      set();
      const c = renderHomeRaw({ rooms: liveRooms }).container;
      expect(
        careEl(c),
        `crash rescue vanished with compy_home_interview ${name} — it is gated on the interview again`,
      ).not.toBeNull();
    });
  }

  it('the interview itself still obeys "0" — the entry is independent, not always-on-everything', () => {
    localStorage.setItem("compy_home_interview", "0");
    const c = renderHome({ rooms: liveRooms }).container;
    expect(door(), "the failsafe stopped working — the flag is decorative").toBeNull();
    expect(careEl(c)).not.toBeNull();
  });

  it("routes to the crash station FROM the failsafe state, not just the default one", () => {
    localStorage.setItem("compy_home_interview", "0");
    const onOpenLabStation = vi.fn();
    const c = renderHome({ rooms: liveRooms, onOpenLabStation }).container;
    fireEvent.click(careEl(c) as HTMLElement);
    expect(onOpenLabStation).toHaveBeenCalledWith(HOME_CARE_ENTRY.station);
  });

  it("stands down when the rail has no room to send the click to (no dead ends)", () => {
    const roomsNoLab = liveRooms.filter((r) => r.key !== HOME_CARE_ENTRY.room);
    const c = renderHome({ rooms: roomsNoLab }).container;
    expect(careEl(c)).toBeNull();
  });
});

// bug->guard (SESSION_HANDOFF §4, tester 2026-08-09): "it crashed or froze" was answered by
// dropping the user in the Lab, where the one instrument that reads Windows' crash record was a
// dock node called "Black Box". The tester never found it and went to Event Viewer instead. Two
// causes: the route landed on the ROOM, and the destination was named after an insider metaphor.
// Both doors to that evidence — the Care entry on Home's body, and the interview's crash branch —
// are held to the same standard here.
describe("Crash & Freeze Rescue — every door lands ON the evidence (§4)", () => {
  const careEl = (c: HTMLElement) => c.querySelector(".hc-care-entry") as HTMLElement | null;

  it("the Care entry deep-links to the crash station instead of dropping the user on the Lab dock", () => {
    const onNavigate = vi.fn();
    const onOpenLabStation = vi.fn();
    const c = renderHome({ rooms: liveRooms, onNavigate, onOpenLabStation }).container;
    fireEvent.click(careEl(c)!);
    expect(onOpenLabStation).toHaveBeenCalledWith("blackbox");
    expect(onNavigate, "the Care entry still fired a bare room nav — that IS the dead end").not.toHaveBeenCalled();
  });

  it("still navigates to the room when no station writer is wired (never a dead click)", () => {
    const onNavigate = vi.fn();
    const c = renderHome({ rooms: liveRooms, onNavigate }).container;
    fireEvent.click(careEl(c)!);
    expect(onNavigate, "an isolated mount lost the entry's only exit").toHaveBeenCalledWith(
      HOME_CARE_ENTRY.room,
    );
  });

  it("EVERY crash answer in the interview lands on that same station, and closes behind itself", () => {
    for (const leaf of Q.crash.choices) {
      const onOpenLabStation = vi.fn();
      const onNavigate = vi.fn();
      renderHome({ rooms: liveRooms, onOpenLabStation, onNavigate });
      openInterview();
      fireEvent.click(answerNamed(Q.start.choices[0].label));
      fireEvent.click(answerNamed(leaf.label));
      fireEvent.click(action() as HTMLElement);
      expect(onOpenLabStation, `crash answer "${leaf.id}"`).toHaveBeenCalledWith("blackbox");
      expect(onNavigate, `crash answer "${leaf.id}" fired a bare room nav`).not.toHaveBeenCalled();
      // Acting closes the sheet — the user is looking at the instrument, not at a panel over it.
      expect(document.querySelector(".hi-question")).toBeNull();
      expect(document.querySelector(".hi-sentence")).toBeNull();
      cleanup();
    }
  });

  it("falls back to something real when the rail has no Lab to send them to (law 1)", () => {
    // No dead ends means no dead ends even on a stripped rail: the finding degrades to the
    // read-only check, which needs no room at all.
    const onRunCheck = vi.fn();
    const onOpenLabStation = vi.fn();
    renderHome({
      rooms: liveRooms.filter((r) => r.key !== "lab"),
      onRunCheck,
      onOpenLabStation,
    });
    openInterview();
    fireEvent.click(answerNamed(Q.start.choices[0].label));
    fireEvent.click(answerNamed(Q.crash.choices[0].label));
    fireEvent.click(action() as HTMLElement);
    expect(onOpenLabStation, "offered a station in a room the rail does not render").not.toHaveBeenCalled();
    expect(onRunCheck, "the finding had nothing left to offer").toHaveBeenCalled();
  });
});

// The fast path (the band's option C, carried over intact). The allowlist is the whole point: the
// one-tap batch must apply EXACTLY safeFixesReadyList — safe · appliable · not-applied · eligible —
// and nothing broader, ever. This is the only mutating path in the interview, and it calls the same
// audited primitive the room already owned; ③ opened no new mutation path.
describe("the interview's fast path applies EXACTLY the safeFixesReadyList stack (the allowlist)", () => {
  /** Walk to the sweep finding, which is where the one-tap stack is offered. */
  function openSweep() {
    openInterview();
    fireEvent.click(answerNamed(Q.start.choices.find((c) => c.unsure)!.label));
  }

  it("offers the stack, labelled by its real count, and promises the undo up front (law 4)", () => {
    renderHome({
      rooms: liveRooms,
      recs: [rec({ id: "safe-a" }), rec({ id: "safe-b" })],
      isAppliable: () => true,
      onApplyBatch: async () => ({ applied: 2, skipped: [] }),
    });
    openSweep();
    expect(action()?.textContent).toBe(i18n.t("home.interview.f.act.fastpath", { count: 2 }));
    expect(action()?.dataset.mutating, "a mutating action is not marked as one").toBe("yes");
    // The rollback promise stands under the button, in front of the user — not inside a confirm
    // dialog they have not opened yet.
    expect(document.querySelector(".hi-undo")?.textContent).toBe(
      i18n.t("home.interview.f.act.undo"),
    );
  });

  it("never offers it when the stack is empty — it does not invent work", () => {
    renderHome({
      rooms: liveRooms,
      recs: [rec({ id: "mod-only", severity: "moderate" })], // not safe → empty stack
      isAppliable: () => true,
      onApplyBatch: async () => ({ applied: 0, skipped: [] }),
    });
    openSweep();
    expect(action()?.dataset.mutating).toBeUndefined();
    expect(document.querySelector(".hi-undo"), "an undo promise with nothing to undo").toBeNull();
  });

  it("never offers it while the catalog is still loading — it does not guess a count", () => {
    renderHome({ rooms: liveRooms, recs: null, isAppliable: () => true });
    openSweep();
    expect(action()?.dataset.mutating).toBeUndefined();
  });

  it("confirm → onApplyBatch with ONLY the safe·appliable·not-applied·eligible rec", async () => {
    const onApplyBatch = vi.fn(async () => ({ applied: 1, skipped: [] }));
    const recs = [
      rec({ id: "safe-ok", severity: "safe", currently_applied: false, eligible: true }),
      rec({ id: "safe-applied", severity: "safe", currently_applied: true }), // already on
      rec({ id: "safe-inelig", severity: "safe", eligible: false }), // not for this rig
      rec({ id: "safe-noappl", severity: "safe" }), // not in the appliable allowlist
      rec({ id: "mod-ok", severity: "moderate" }), // not safe-tier
    ];
    const appliable = new Set(["safe-ok", "safe-applied", "safe-inelig", "mod-ok"]);
    renderHome({
      rooms: liveRooms,
      recs,
      isAppliable: (id: string) => appliable.has(id),
      onApplyBatch,
    });
    openSweep();
    expect(action()?.textContent).toBe(i18n.t("home.interview.f.act.fastpath", { count: 1 }));
    fireEvent.click(action() as HTMLElement);

    // The confirm names the count and the rollback guarantee before anything changes.
    const go = await waitFor(() => {
      const el = document.querySelector(".cmp-confirm-go");
      if (!el) throw new Error("confirm dialog not open");
      return el as HTMLButtonElement;
    });
    expect(document.querySelector(".cmp-confirm-title")?.textContent).toContain(fastPathReadyHeadline(1));
    expect(go.textContent).toBe(fastPathApplyLabel(1));
    fireEvent.click(go);

    await waitFor(() => expect(onApplyBatch).toHaveBeenCalledTimes(1));
    expect(onApplyBatch).toHaveBeenCalledWith(["safe-ok"]);

    // Afterwards the card reports the REAL counts and stops offering the same apply again.
    await waitFor(() =>
      expect(document.querySelector(".hi-applied")?.textContent).toBe(
        fastPathAppliedNote(1, 0, i18n.t),
      ),
    );
    expect(action(), "it offered the same apply a second time").toBeNull();
    // Nothing was skipped, so there is nothing to disclose.
    expect(document.querySelector(".hi-skipped")).toBeNull();
  });

  // bug->guard, promoted from a source contract to a behavioural one (J, 2026-07-22). "1 safe
  // tweak not applied" named a count and nothing else, so a user told something was skipped had no
  // way to learn which one or why — the batch primitive returns title+reason per skip and the
  // receipt threw it away one line after it arrived. fastpath-skipped-detail-guard.test.ts pins
  // the source contract and says plainly it cannot do more; this drives the real path and reads
  // the rendered words, which is the stronger form that guard asked for.
  it("names WHICH tweaks were skipped and WHY — never a bare count", async () => {
    const skipped = [
      { title: "Hardware-accelerated GPU scheduling", reason: "already on for this GPU" },
      { title: "Game DVR background recording", reason: "not present on this build of Windows" },
    ];
    const onApplyBatch = vi.fn(async () => ({ applied: 1, skipped }));
    renderHome({
      rooms: liveRooms,
      recs: [rec({ id: "safe-a" }), rec({ id: "safe-b" }), rec({ id: "safe-c" })],
      isAppliable: () => true,
      onApplyBatch,
    });
    openSweep();
    fireEvent.click(action() as HTMLElement);
    fireEvent.click(
      await waitFor(() => {
        const el = document.querySelector(".cmp-confirm-go");
        if (!el) throw new Error("confirm dialog not open");
        return el as HTMLButtonElement;
      }),
    );
    await waitFor(() => expect(onApplyBatch).toHaveBeenCalled());

    // The headline counts both sides honestly…
    await waitFor(() =>
      expect(document.querySelector(".hi-applied")?.textContent).toBe(
        fastPathAppliedNote(1, 2, i18n.t),
      ),
    );
    // …and the disclosure answers "which, and why?" for every one of them.
    const lines = Array.from(document.querySelectorAll(".hi-skipped-list li")).map(
      (n) => n.textContent ?? "",
    );
    expect(lines).toHaveLength(skipped.length);
    for (const item of skipped) {
      const line = lines.find((l) => l.includes(item.title));
      expect(line, `no line names "${item.title}"`).toBeTruthy();
      expect(line, `"${item.title}" is named without its reason — half the dead end`).toContain(
        item.reason,
      );
    }
  });

  it("cancelling the confirm does NOT apply anything", async () => {
    const onApplyBatch = vi.fn(async () => ({ applied: 1, skipped: [] }));
    renderHome({
      rooms: liveRooms,
      recs: [rec({ id: "safe-ok" })],
      isAppliable: () => true,
      onApplyBatch,
    });
    openSweep();
    fireEvent.click(action() as HTMLElement);
    const cancel = await waitFor(() => {
      const el = document.querySelector(".cmp-confirm-cancel");
      if (!el) throw new Error("confirm dialog not open");
      return el as HTMLButtonElement;
    });
    fireEvent.click(cancel);
    expect(onApplyBatch).not.toHaveBeenCalled();
    // Still on the card, still offering it — cancelling is not a dead end either.
    expect(action()).not.toBeNull();
  });
});

describe("copy honesty (pure data)", () => {
  it("headline / apply-label are honest singular vs plural, never '(s)'", () => {
    for (const s of [
      fastPathReadyHeadline(1),
      fastPathReadyHeadline(4),
      fastPathApplyLabel(1),
      fastPathApplyLabel(4),
      i18n.t("home.interview.f.act.fastpath", { count: 1 }),
      i18n.t("home.interview.f.act.fastpath", { count: 4 }),
    ]) {
      expect(s).not.toMatch(/\(s\)/);
    }
    expect(fastPathReadyHeadline(1)).toContain("1 safe tweak is ready");
    expect(fastPathReadyHeadline(4)).toContain("4 safe tweaks are ready");
    expect(fastPathApplyLabel(1)).toBe("Apply 1 safe tweak · one tap");
    expect(fastPathApplyLabel(4)).toBe("Apply 4 safe tweaks · one tap");
    expect(i18n.t("home.interview.f.act.fastpath", { count: 1 })).toContain("1 safe change");
    expect(i18n.t("home.interview.f.act.fastpath", { count: 4 })).toContain("4 safe changes");
  });

  it("no answer or finding names a room — the words stay the user's, not the app's", () => {
    // The rail gets relabelled (Monitor→Live, Blackbook→History, Lab→Test, 2026-08-12). Copy that
    // hardcodes a room name drifts silently the next time it does.
    const strings = [
      ...Object.values(Q).flatMap((q) => [q.question, ...q.choices.map((c) => c.label)]),
    ];
    for (const s of strings) {
      expect(s, `"${s}" names a room`).not.toMatch(/\b(Monitor|Blackbook|Lab|Live|History)\b/);
    }
  });
});
