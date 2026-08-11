import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { HomeRoom } from "./HomeRoom";
import { ShellV2 } from "../design/ShellV2";
import { ConfirmProvider } from "../design/ConfirmDialog";
import { railFor } from "../design/homeRail";
import {
  homeIntakeRows,
  homeIntakeFastpath,
  fastPathReadyHeadline as fastPathReadyHeadlineRaw,
  fastPathApplyLabel as fastPathApplyLabelRaw,
  fastPathAppliedNote as fastPathAppliedNoteRaw,
} from "./home-intake-data";
// i18n update (2026-07-23): home-intake-data.ts's exports now take a TFunction as their last param
// (Simplified Chinese translation pass). These test-local aliases resolve them through the real
// i18next instance (English is the default language, matching what every assertion below already
// expects) under their ORIGINAL names, so every existing call site in this file below keeps
// reading the exact same shipped text, unchanged — same text, just sourced from locale JSON
// instead of a literal in the .ts file.
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

// English-resolved re-exports under the ORIGINAL names (see the i18n-update note above) — every
// call site below (HOME_INTAKE_ROWS.find(...), fastPathReadyHeadline(2), etc.) is untouched.
const HOME_INTAKE_ROWS = homeIntakeRows(i18n.t);
const HOME_INTAKE_FASTPATH = homeIntakeFastpath(i18n.t);
const fastPathReadyHeadline = (n: number) => fastPathReadyHeadlineRaw(n, i18n.t);
const fastPathApplyLabel = (n: number) => fastPathApplyLabelRaw(n, i18n.t);
const fastPathAppliedNote = (applied: number, skipped: number) =>
  fastPathAppliedNoteRaw(applied, skipped, i18n.t);

// Guards for the Home intake band (BACKLOG:916 — the pre-room intent router + one-tap fast path,
// behind compy_home_intake, DEFAULT OFF). The owner's greenlit direction (2026-07-14):
//   "lift the proven 'what are you here to do?' idiom up one level to Home, where the rows route to
//    the right ROOM instead of the right Lab station / i like option a / … c might be good to have
//    as an always available option … some combination of both might be best ill let you decide"
// Decoded → option A (intent rows above the doors) + option C (always-available one-tap fast path),
// option B (door-level hints) declined. These tests pin: (1) flag gating; (2) rows route to the
// live rail's room key with no dead ends and a live-resolved label; (3) the fast path's honest
// state machine (loading / all-clear / ready); (4) the fast path applies EXACTLY the
// safeFixesReadyList stack (safe · appliable · not-applied · eligible), never a broader set; and
// (5) copy honesty (singular/plural, never "(s)"; the taxonomy only ever routes to real rooms).

vi.mock("./rig/RigHologram", () => ({
  RigHologram: () => <div data-testid="rig-hologram" />,
}));

// Mutable holder for the Intelligence headline the console fetches (get_intelligence_headline).
// vi.hoisted so the vi.mock factory below (also hoisted above imports) can close over it; each test
// sets intel.headline to drive the LAST SESSION block on/off, afterEach resets it to null.
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

// The rooms the live rail actually renders (labGround DEFAULT ON) — App derives this exact list:
// railFor(merged, ground).filter(home).map(key/name). Under ground the rooms are Monitor/Blackbook/Lab.
const liveRooms = railFor(true, true)
  .filter((r) => r.id !== "home")
  .map((r) => ({ key: r.id, name: r.label }));

// A Recommendation factory — only the fields safeFixesReadyList reads matter; the rest are filler.
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

// Render HomeRoom (console DEFAULT ON) inside the real shell + a ConfirmProvider (so the option-C
// apply flow can open its dialog). Extra props (rooms/recs/isAppliable/onApplyBatch/onNavigate)
// spread over the base fixtures.
function renderHome(extra: Partial<React.ComponentProps<typeof HomeRoom>> = {}) {
  return render(
    <ConfirmProvider>
      <ShellV2
        items={railFor(true, true)}
        activeId="home"
        onNavigate={() => {}}
        ledgerCount={1}
        version="0.1.0"
      >
        <HomeRoom {...baseProps} {...extra} />
      </ShellV2>
    </ConfirmProvider>,
  );
}

describe("Home intake band — flag gating (compy_home_intake DEFAULT OFF)", () => {
  it("key ABSENT: the band never renders even with rooms + fast-path fully wired", () => {
    const c = renderHome({
      rooms: liveRooms,
      recs: [rec({ id: "safe-ok" })],
      isAppliable: () => true,
      onApplyBatch: async () => ({ applied: 0, skipped: [] }),
    }).container;
    expect(c.querySelector(".home-console")).not.toBeNull(); // the console still mounts
    expect(c.querySelector(".hc-intake")).toBeNull(); // …but the band stays dark
  });

  it("key '0' (explicit off): still no band", () => {
    localStorage.setItem("compy_home_intake", "0");
    const c = renderHome({ rooms: liveRooms }).container;
    expect(c.querySelector(".hc-intake")).toBeNull();
  });

  it("key '1': the band renders", () => {
    localStorage.setItem("compy_home_intake", "1");
    const c = renderHome({ rooms: liveRooms }).container;
    expect(c.querySelector(".hc-intake")).not.toBeNull();
  });
});

describe("Home intake band — intent rows (option A): route to the live room, no dead ends", () => {
  it("renders exactly the rows whose room the live rail shows, with the LIVE-resolved label", () => {
    localStorage.setItem("compy_home_intake", "1");
    const c = renderHome({ rooms: liveRooms }).container;
    const rows = c.querySelectorAll(".hc-intake-row");
    // Every HOME_INTAKE_ROWS row routes to play/learn/lab, all present under the live rail → all render.
    const expected = HOME_INTAKE_ROWS.filter((r) => liveRooms.some((rm) => rm.key === r.room));
    expect(rows.length).toBe(expected.length);
    expect(rows.length).toBe(HOME_INTAKE_ROWS.length);
    // The room chip shows the rail's LABEL (Monitor/Blackbook/Lab), never the raw nav id.
    const chips = Array.from(c.querySelectorAll(".hc-intake-row-room")).map((n) => n.textContent);
    expect(chips).toContain("Monitor →");
    expect(chips).toContain("Blackbook →");
    expect(chips).toContain("Lab →");
    // …and never leaks a raw id.
    expect(chips.some((t) => /\b(play|learn)\b/.test(t ?? ""))).toBe(false);
  });

  it("filters out any row whose room the rail does NOT render (no dead-end doors)", () => {
    localStorage.setItem("compy_home_intake", "1");
    // A rail missing Monitor (play) — the "how did my last session go?" row must vanish.
    const roomsNoMonitor = liveRooms.filter((r) => r.key !== "play");
    const c = renderHome({ rooms: roomsNoMonitor }).container;
    const rows = c.querySelectorAll(".hc-intake-row");
    const expected = HOME_INTAKE_ROWS.filter((r) => roomsNoMonitor.some((rm) => rm.key === r.room));
    expect(rows.length).toBe(expected.length);
    expect(rows.length).toBeLessThan(HOME_INTAKE_ROWS.length);
    const symptoms = Array.from(c.querySelectorAll(".hc-intake-row-symptom")).map(
      (n) => n.textContent,
    );
    const playRow = HOME_INTAKE_ROWS.find((r) => r.room === "play")!;
    expect(symptoms).not.toContain(playRow.symptom);
  });

  it("clicking a row navigates to that room's nav key (option A routing)", () => {
    localStorage.setItem("compy_home_intake", "1");
    const onNavigate = vi.fn();
    const c = renderHome({ rooms: liveRooms, onNavigate }).container;
    const rows = Array.from(c.querySelectorAll(".hc-intake-row"));
    // Click the Monitor (play) row and the Lab row; assert the raw nav KEY, not the label.
    const playRow = HOME_INTAKE_ROWS.find((r) => r.room === "play")!;
    const labRow = HOME_INTAKE_ROWS.find((r) => r.room === "lab")!;
    const findRow = (symptom: string) =>
      rows.find((el) => el.querySelector(".hc-intake-row-symptom")?.textContent === symptom)!;
    fireEvent.click(findRow(playRow.symptom));
    expect(onNavigate).toHaveBeenCalledWith("play");
    fireEvent.click(findRow(labRow.symptom));
    expect(onNavigate).toHaveBeenCalledWith("lab");
  });
});

// bug->guard (SESSION_HANDOFF §4, tester 2026-08-09): "it crashed or froze" was answered by
// dropping the user in the Lab, where the one instrument that reads Windows' crash record was a
// dock node called "Black Box". The tester never found it and went to Event Viewer instead. Two
// causes, both guarded here: the row routed to the ROOM, and the destination was named after an
// insider metaphor rather than the problem. Either one regressing re-opens the same dead end.
describe("Crash & Freeze rescue — the crash row lands ON the evidence (§4)", () => {
  const crashRow = () => {
    const row = HOME_INTAKE_ROWS.find((r) => r.station === "blackbox");
    expect(row, 'no intake row deep-links to "blackbox" — the crash symptom routes to the room again')
      .toBeTruthy();
    return row!;
  };

  const findRowEl = (c: HTMLElement, symptom: string) =>
    Array.from(c.querySelectorAll(".hc-intake-row")).find(
      (el) => el.querySelector(".hc-intake-row-symptom")?.textContent === symptom,
    )!;

  it("deep-links to the crash station instead of dropping the user on the Lab dock", () => {
    localStorage.setItem("compy_home_intake", "1");
    const onNavigate = vi.fn();
    const onOpenLabStation = vi.fn();
    const row = crashRow();
    const c = renderHome({ rooms: liveRooms, onNavigate, onOpenLabStation }).container;
    fireEvent.click(findRowEl(c, row.symptom));
    expect(onOpenLabStation).toHaveBeenCalledWith("blackbox");
    // The bare room nav is the bug: it lands on the dock with the station still to be hunted for.
    expect(onNavigate, "the crash row still fired a bare room nav — that IS the dead end").not.toHaveBeenCalled();
  });

  it("still navigates to the room when no station writer is wired (never a dead click)", () => {
    localStorage.setItem("compy_home_intake", "1");
    const onNavigate = vi.fn();
    const row = crashRow();
    const c = renderHome({ rooms: liveRooms, onNavigate }).container;
    fireEvent.click(findRowEl(c, row.symptom));
    expect(onNavigate, "an isolated mount lost the row's only exit").toHaveBeenCalledWith(row.room);
  });

  it("leaves every station-less row on the plain room nav", () => {
    localStorage.setItem("compy_home_intake", "1");
    const onNavigate = vi.fn();
    const onOpenLabStation = vi.fn();
    const plain = HOME_INTAKE_ROWS.filter((r) => !r.station);
    expect(plain.length, "every row deep-links now — this test no longer proves anything").toBeGreaterThan(0);
    const c = renderHome({ rooms: liveRooms, onNavigate, onOpenLabStation }).container;
    for (const row of plain) {
      fireEvent.click(findRowEl(c, row.symptom));
      expect(onNavigate).toHaveBeenCalledWith(row.room);
    }
    expect(onOpenLabStation, "a station-less row hijacked the station writer").not.toHaveBeenCalled();
  });
});

describe("Home intake band — one-owner stand-down (rubric 3: no duplicate 'last session' route)", () => {
  // The LAST SESSION verdict block on the same Home screen already answers "how did my last session
  // go?" with the engine's own verdict line + a See-in-Monitor door. When it's live, the intake row
  // asking that same question and routing to that same room stands down (P5 one-owner-per-screen
  // voice law) — mirrors the verdictNamesLimiter/topLimiter standdown. Guards the self-reviewer
  // catch (2026-07-14, rubric 3 duplication): without this, the row and the block both answer the
  // same question and both route to Monitor on one screen.
  const lastSessionHeadline: IntelligenceHeadline = {
    text: "1% lows rose 114.9% vs your previous Cyberpunk session",
    verdict: "improved",
    game: "Cyberpunk 2077",
    session_started_at: "2026-07-01T18:00:00Z",
  };

  it("stands the play/'last session' row down when the LAST SESSION block owns that question", async () => {
    localStorage.setItem("compy_home_intake", "1");
    // compy_intelligence DEFAULTS ON (cleared each test) → the console fetches; feed it a real verdict.
    intel.headline = lastSessionHeadline;
    const c = renderHome({ rooms: liveRooms, onNavigate: () => {} }).container;
    // The engine's verdict line lands — the block that OWNS the last-session question is live.
    await waitFor(() => expect(c.textContent).toContain(lastSessionHeadline.text));
    const playRow = HOME_INTAKE_ROWS.find((r) => r.room === "play")!;
    const symptoms = Array.from(c.querySelectorAll(".hc-intake-row-symptom")).map((n) => n.textContent);
    // …so the intake row asking the SAME question + routing to the SAME room stands down.
    expect(symptoms).not.toContain(playRow.symptom);
    expect(c.querySelectorAll(".hc-intake-row").length).toBe(HOME_INTAKE_ROWS.length - 1);
    // The other intents are untouched (learn/lab still route).
    expect(symptoms).toContain(HOME_INTAKE_ROWS.find((r) => r.room === "learn")!.symptom);
    expect(symptoms).toContain(HOME_INTAKE_ROWS.find((r) => r.room === "lab")!.symptom);
  });

  it("keeps the play row when there is NO last-session verdict (nothing owns it yet)", async () => {
    localStorage.setItem("compy_home_intake", "1");
    intel.headline = null; // get_intelligence_headline → null → the LAST SESSION block never renders
    const c = renderHome({ rooms: liveRooms }).container;
    // All rows present incl. the play row — the stand-down is conditioned on a live verdict, not always-on.
    await waitFor(() =>
      expect(c.querySelectorAll(".hc-intake-row").length).toBe(HOME_INTAKE_ROWS.length),
    );
    const playRow = HOME_INTAKE_ROWS.find((r) => r.room === "play")!;
    const symptoms = Array.from(c.querySelectorAll(".hc-intake-row-symptom")).map((n) => n.textContent);
    expect(symptoms).toContain(playRow.symptom);
  });
});

describe("Home intake band — fast path (option C): honest state machine", () => {
  it("recs === null → the loading line, no apply button", () => {
    localStorage.setItem("compy_home_intake", "1");
    const c = renderHome({
      rooms: liveRooms,
      recs: null,
      isAppliable: () => true,
      onApplyBatch: async () => ({ applied: 0, skipped: [] }),
    }).container;
    const fast = c.querySelector(".hc-intake-fast");
    expect(fast).not.toBeNull();
    expect(fast?.textContent).toContain(HOME_INTAKE_FASTPATH.loading);
    expect(c.querySelector(".hc-intake-fast-btn")).toBeNull();
  });

  it("empty safe stack → the all-clear line, no apply button (never invents work)", () => {
    localStorage.setItem("compy_home_intake", "1");
    const c = renderHome({
      rooms: liveRooms,
      recs: [rec({ id: "mod-only", severity: "moderate" })], // not safe → empty stack
      isAppliable: () => true,
      onApplyBatch: async () => ({ applied: 0, skipped: [] }),
    }).container;
    const fast = c.querySelector(".hc-intake-fast");
    expect(fast?.textContent).toContain(HOME_INTAKE_FASTPATH.allClear);
    expect(c.querySelector(".hc-intake-fast-btn")).toBeNull();
  });

  it("a ready safe stack → the ready headline + apply button labelled by count", () => {
    localStorage.setItem("compy_home_intake", "1");
    const c = renderHome({
      rooms: liveRooms,
      recs: [rec({ id: "safe-a" }), rec({ id: "safe-b" })],
      isAppliable: () => true,
      onApplyBatch: async () => ({ applied: 2, skipped: [] }),
    }).container;
    const fast = c.querySelector(".hc-intake-fast");
    expect(fast?.textContent).toContain(fastPathReadyHeadline(2));
    const btn = c.querySelector(".hc-intake-fast-btn");
    expect(btn).not.toBeNull();
    expect(btn?.textContent).toBe(fastPathApplyLabel(2));
  });
});

describe("Home intake band — fast path applies EXACTLY the safeFixesReadyList stack (the allowlist)", () => {
  it("confirm → onApplyBatch with only the safe·appliable·not-applied·eligible rec, then the honest receipt", async () => {
    localStorage.setItem("compy_home_intake", "1");
    const onApplyBatch = vi.fn(async () => ({ applied: 1, skipped: [] }));
    // A deliberately mixed catalog — only "safe-ok" survives every filter.
    const recs = [
      rec({ id: "safe-ok", severity: "safe", currently_applied: false, eligible: true }),
      rec({ id: "safe-applied", severity: "safe", currently_applied: true }), // already on
      rec({ id: "safe-inelig", severity: "safe", eligible: false }), // not for this rig
      rec({ id: "safe-noappl", severity: "safe" }), // not in the appliable allowlist
      rec({ id: "mod-ok", severity: "moderate" }), // not safe-tier
    ];
    // The appliable allowlist deliberately EXCLUDES "safe-noappl" (and includes a moderate to prove
    // severity is still filtered independently).
    const appliable = new Set(["safe-ok", "safe-applied", "safe-inelig", "mod-ok"]);
    const c = renderHome({
      rooms: liveRooms,
      recs,
      isAppliable: (id: string) => appliable.has(id),
      onApplyBatch,
    }).container;

    // Only one safe fix is ready → the button + headline both count 1.
    const btn = c.querySelector(".hc-intake-fast-btn") as HTMLButtonElement;
    expect(btn.textContent).toBe(fastPathApplyLabel(1));
    fireEvent.click(btn);

    // The confirm dialog opens; its confirm button shares the apply label, so target it by CLASS.
    const go = await waitFor(() => {
      const el = document.querySelector(".cmp-confirm-go");
      if (!el) throw new Error("confirm dialog not open");
      return el as HTMLButtonElement;
    });
    fireEvent.click(go);

    await waitFor(() => expect(onApplyBatch).toHaveBeenCalledTimes(1));
    expect(onApplyBatch).toHaveBeenCalledWith(["safe-ok"]);

    // The receipt reports the REAL applied/skipped counts (honest, no "(s)").
    await waitFor(() =>
      expect(c.querySelector(".hc-intake-fast")?.textContent).toContain(
        fastPathAppliedNote(1, 0),
      ),
    );
  });

  it("cancelling the confirm does NOT apply anything", async () => {
    localStorage.setItem("compy_home_intake", "1");
    const onApplyBatch = vi.fn(async () => ({ applied: 1, skipped: [] }));
    const c = renderHome({
      rooms: liveRooms,
      recs: [rec({ id: "safe-ok" })],
      isAppliable: () => true,
      onApplyBatch,
    }).container;
    fireEvent.click(c.querySelector(".hc-intake-fast-btn") as HTMLButtonElement);
    const cancel = await waitFor(() => {
      const el = document.querySelector(".cmp-confirm-cancel");
      if (!el) throw new Error("confirm dialog not open");
      return el as HTMLButtonElement;
    });
    fireEvent.click(cancel);
    expect(onApplyBatch).not.toHaveBeenCalled();
  });
});

describe("Home intake band — copy honesty (pure data)", () => {
  it("headline / apply-label / receipt are honest singular vs plural, never '(s)'", () => {
    for (const s of [
      fastPathReadyHeadline(1),
      fastPathReadyHeadline(4),
      fastPathApplyLabel(1),
      fastPathApplyLabel(4),
      fastPathAppliedNote(1, 0),
      fastPathAppliedNote(3, 0),
      fastPathAppliedNote(1, 1),
      fastPathAppliedNote(2, 3),
    ]) {
      expect(s).not.toMatch(/\(s\)/);
    }
    expect(fastPathReadyHeadline(1)).toContain("1 safe tweak is ready");
    expect(fastPathReadyHeadline(4)).toContain("4 safe tweaks are ready");
    expect(fastPathApplyLabel(1)).toBe("Apply 1 safe tweak · one tap");
    expect(fastPathApplyLabel(4)).toBe("Apply 4 safe tweaks · one tap");
    // Receipt names applied AND skipped, honestly.
    expect(fastPathAppliedNote(1, 0)).toBe("Applied 1 safe tweak — all reversible from Applied.");
    expect(fastPathAppliedNote(2, 3)).toContain("3 were skipped");
    expect(fastPathAppliedNote(2, 1)).toContain("1 was skipped");
  });

  it("every intake row routes to a real room key (play/learn/lab)", () => {
    for (const row of HOME_INTAKE_ROWS) {
      expect(["play", "learn", "lab"]).toContain(row.room);
      // The because-line names the room's ACTION, so it must not hardcode a rail label that could drift.
      expect(row.because).not.toMatch(/\b(Monitor|Blackbook|Lab)\b/);
    }
  });
});
