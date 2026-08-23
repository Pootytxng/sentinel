import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup, fireEvent, within } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { MonitorV2 } from "./MonitorV2";
import { BlackbookV2 } from "./BlackbookV2";
import type { SessionSummary } from "../types";
import type { ReactNode } from "react";

// Instrument-HUD rollout guards (owner approval 2026-07-06 — supersedes
// hud-rooms-untouched.test.tsx, exactly as that checkpoint file said it would be; the flag
// is DEFAULT ON since the same approval, so "off" means the explicit "0" Settings failsafe).
// Was FOUR rooms; the generation prune (2026-08-06) deleted OptimizeV2 and LabV2 — the Lab is
// LabGround now (lab-ground.test.tsx) and Optimize lives INSIDE it (lab/OptimizeStation) — so
// this suite pins the two HUD rooms that still exist as standalone surfaces.
// Pins, per room:
//   1. Flag "0" renders the pre-rollout tree with zero HUD DOM — the reversibility contract,
//      same as home-hud-flag.test.tsx; flag absent (the shipped default) renders the HUD.
//   2. TITLE-HEADER LAW (owner 2026-07-10 round 2, bug→guard: he caught "1 change you applied
//      was turned off outside compy" standing as a header): under the HUD the room h1 is the
//      room TITLE and nothing else — never a status/notification/description sentence. The
//      header sub is gone (its facts live in body context). Flag "0" keeps the classic
//      contract: the verdict sentence IS the h1.
//   3. LED honesty: the eyebrow LED renders only from a REAL room state — Monitor and Blackbook
//      compute none at the shell, so neither renders one. (The scan/ok LED pair was pinned on
//      OptimizeV2, which no longer exists.)

vi.mock("./Play", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, default: () => <div data-testid="play-stub" /> };
});
vi.mock("./MonitorConsole", () => ({
  // Since issue #49 slice 4 the live face composes the room's shell itself; `bar` (the segment
  // control) is the ROOM's and is handed down to it. The stub passes it through so the Sessions
  // face — the one MonitorV2 still composes — stays reachable from here.
  MonitorConsole: (props: { bar?: ReactNode }) => (
    <div data-testid="console-stub">{props.bar}</div>
  ),
}));
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

// `hud: false` = this room no longer wears the Instrument-HUD masthead at all. Monitor left it
// in issue #49 slice 4 (see the Monitor-specific guard below); History follows in slice 5, and the
// day this list has no `hud: true` room left, this suite retires with the rollout it pins.
const ROOMS: {
  name: string;
  label: string;
  title: string;
  hud: boolean;
  mount: () => HTMLElement;
}[] = [
  {
    name: "MonitorV2",
    label: "Live telemetry",
    title: "Live",
    hud: false,
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
    title: "History",
    hud: true,
    mount: () => render(<BlackbookV2 focusId={null} vendor="amd" onClose={() => {}} />).container,
  },
];

// Mount with a per-room clean first-run (composed surfaces persist their own state — e.g.
// Learn's grade-key fold — so storage is reset before every mount, keeping the flag the
// ONLY delta between comparisons). The Blackbook console (default-ON since 2026-07-13) is
// pinned "0" so BlackbookV2 stays on the classic Learn/HUD composition this suite exists to
// test (the console face has its own contract: blackbook-console*.test.tsx).
const mountWithFlag = (room: (typeof ROOMS)[number], flag: string | null) => {
  localStorage.clear();
  localStorage.setItem("compy_blackbook_console", "0");
  if (flag != null) localStorage.setItem("compy_editorial", flag);
  return room.mount();
};

describe("HUD room rollout: flag-off byte-identity (the classic failsafe)", () => {
  for (const room of ROOMS.filter((r) => r.hud)) {
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

describe("HUD room rollout: title-header law (h1 = the room title, never a status sentence)", () => {
  for (const room of ROOMS.filter((r) => r.hud)) {
    it(`${room.name}: flag on → eyebrow "${room.label}", h1 exactly "${room.title}", no header sub; flag '0' keeps the classic verdict-sentence h1`, () => {
      // Classic contract: the verdict SENTENCE is the h1 (never the bare title).
      const off = mountWithFlag(room, "0");
      const offH1 = off.querySelector(".v2-verdict h1");
      expect(offH1).not.toBeNull();
      expect(offH1!.textContent!.trim()).not.toBe(room.title);
      cleanup();
      // HUD contract (owner title-header law 2026-07-10): header = eyebrow + TITLE, nothing else.
      const on = mountWithFlag(room, "1");
      const eyebrow = on.querySelector(".hud-masthead-eyebrow");
      expect(eyebrow).not.toBeNull();
      expect(eyebrow!.textContent).toContain(room.label);
      const headline = on.querySelector(".hud-headline");
      expect(headline).not.toBeNull();
      expect(headline!.textContent).toBe(room.title);
      // The header carries no sub — verdict facts live in their body context now.
      expect(on.querySelector(".v2-verdict-sub")).toBeNull();
    });
  }

  // ISSUE #49 SLICE 4 — Monitor left the HUD masthead, and this replaces the two rows it used to
  // fill in the loops above. It is not a relaxation: the old pins were "under the flag the h1 is
  // the bare title `Live`" and "the header carries no sub". What the owner's title-header law
  // (2026-07-10 round 2) actually caught was a NOTIFICATION standing in a header — "1 change you
  // applied was turned off outside compy" — and UX-1 then replaced the law for Home outright
  // (docs/decisions/2026-08-11-design-foundation.md decision 1: the front door is a verdict,
  // because the room title is redundant with the rail that navigated here and the verdict is
  // redundant with nothing). The approved four-room direction extends that to Live. So what is
  // pinned now is the part that still protects the user: the header is the room's MEASURED
  // verdict, the same sentence in both flag states, and no HUD chrome survives in either.
  it("Monitor: no HUD masthead in EITHER flag state — the four-room header replaced it, identically", () => {
    for (const flag of ["0", "1"]) {
      const c = mountWithFlag(ROOMS[0], flag);
      fireEvent.click(within(c).getByRole("tab", { name: "Sessions" }));
      expect(c.querySelector(".hud-masthead-eyebrow"), `flag ${flag}`).toBeNull();
      expect(c.querySelector(".hud-headline"), `flag ${flag}`).toBeNull();
      // The room's own eyebrow, and an h1 that is the measured verdict — never the bare title.
      expect(c.querySelector(".mc-masthead-eyebrow")!.textContent).toContain("Session monitor");
      const h1 = c.querySelector(".v2-verdict h1")!;
      expect(h1.textContent!.trim()).not.toBe(ROOMS[0].title);
      expect(h1.textContent).toContain("Last session ran smooth");
      // LED honesty, carried: nothing is being captured in this fixture, so nothing is lit.
      expect(c.querySelector(".mc-masthead-eyebrow .mc-led-on")).toBeNull();
      cleanup();
    }
  });

  it("Monitor: the sessions-hero top row is hidden ONLY under the classic verdict header (bug→guard, 2026-07-10 self-review catch)", () => {
    // The relocated last-session line (incl. "live estimate") lives on .play-hero-top; the old
    // one-mention hide must key off the CLASSIC header still carrying the summary — under the
    // HUD's title header the row is the line's one home and must not be display:none'd.
    const css = readFileSync(join("src", "surfaces", "monitor-v2.css"), "utf8");
    const rule = css
      .split("}")
      .find((block) => block.includes(".play-hero-top") && block.includes("display: none"));
    expect(rule).toBeDefined();
    expect(rule).toContain(':not([data-hud="on"])');
  });

  it("BlackbookV2: the browse-mode Autopsy hint returns under the HUD (its coaching left the header)", () => {
    const on = mountWithFlag(ROOMS[1], "1");
    expect(on.querySelector(".lx-autopsy-hint")).not.toBeNull();
    cleanup();
    // Classic v2 (flag '0'): the RoomShell verdict sub still coaches — the hint stays yielded.
    const off = mountWithFlag(ROOMS[1], "0");
    expect(off.querySelector(".lx-autopsy-hint")).toBeNull();
  });
});

describe("HUD room rollout: LED honesty (real state or no LED)", () => {
  // The scan/ok LED pair was pinned on OptimizeV2, deleted in the 2026-08-06 generation prune.
  // Optimize's live home is lab/OptimizeStation inside LabGround, which renders no masthead of
  // its own — so no room in this suite computes a live state, and none may show an LED.
  for (const room of ROOMS.filter((r) => r.hud)) {
    it(`${room.name}: no live room state → no LED in the eyebrow`, () => {
      const on = mountWithFlag(room, "1");
      expect(on.querySelector(".hud-masthead-eyebrow .hud-led")).toBeNull();
    });
  }
});
