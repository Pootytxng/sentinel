import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { MonitorV2 } from "./MonitorV2";
import { BlackbookV2 } from "./BlackbookV2";
import type { SessionSummary } from "../types";

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
vi.mock("./MonitorBasic", () => ({ MonitorBasic: () => <div data-testid="basic-stub" /> }));
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
  delete document.documentElement.dataset.viewMode;
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

const ROOMS: { name: string; label: string; title: string; mount: () => HTMLElement }[] = [
  {
    name: "MonitorV2",
    label: "Live telemetry",
    title: "Monitor",
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
    title: "Blackbook",
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
  for (const room of ROOMS) {
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
  for (const room of ROOMS) {
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
  for (const room of ROOMS) {
    it(`${room.name}: no live room state → no LED in the eyebrow`, () => {
      const on = mountWithFlag(room, "1");
      expect(on.querySelector(".hud-masthead-eyebrow .hud-led")).toBeNull();
    });
  }
});
