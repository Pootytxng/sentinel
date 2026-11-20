// Home's first screen puts the Paramedic first (owner decision, constitution A38). Pins three outcomes:
//  1. the Paramedic's "Something's wrong" is the one primary action on Home, new user or not, and it
//     comes before everything else on the page;
//  2. "Watch it work" is still on Home (the feature stays) but is a quiet button, not primary;
//  3. Home shows no readiness score and no grade word, with or without history.
// Home is composed the way App composes it: HomeGlass with TrustMoment in its latestChange slot.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve(null),
}));

import "../../i18n";
import type { GameReadiness, Recommendation, SessionSummary } from "../../types";
import { HomeGlass } from "./HomeGlass";
import { TrustMoment } from "../TrustMoment";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

const REC: Recommendation = {
  id: "game-mode",
  title: "Game Mode",
  category: "system",
  severity: "safe",
  description: "",
  impact: "",
  downside: null,
  applies_to: "",
  currently_applied: false,
  provenance: "verified",
};

const session = {
  started_at: "2026-10-29T20:00:00Z",
  duration_secs: 2820,
  process_name: "eldenring.exe",
  samples: 2800,
  avg_fps: 141,
  avg_frametime_ms: 7.1,
  low1_fps_est: 96,
  peak_gpu_temp_c: null,
  peak_gpu_usage_pct: null,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: null,
} as SessionSummary;

const readiness = (): GameReadiness => ({
  checks: Array.from({ length: 14 }, (_, i) => ({
    id: `c${i}`,
    label: `Check ${i}`,
    status: i === 0 ? ("attention" as const) : ("ready" as const),
    detail: "",
    value: null,
  })),
  ready_count: 13,
  attention_count: 1,
  unknown_count: 0,
  advisory_count: 0,
  advisory: "",
  dismissed_ids: [],
  drifts: [],
});

function home(sessions: SessionSummary[]) {
  const { container } = render(
    <HomeGlass
      readiness={readiness()}
      priorities={null}
      sessions={sessions}
      pendingCare={null}
      onOpenCareIncident={vi.fn()}
      onDismissCareIncident={vi.fn()}
      onOpenGame={vi.fn()}
      onOpenProblems={vi.fn()}
      onOpenLive={vi.fn()}
      onRunCheck={vi.fn()}
      onSeeChecks={vi.fn()}
      onOpenDetails={vi.fn()}
      latestChange={<TrustMoment recs={[REC]} changes={[]} isAppliable={() => true} onChanged={vi.fn()} />}
    />,
  );
  return container;
}

/** Every control styled as a page's primary action: the green .gl-cta, the Trust card's accent button,
 *  the shared .v2-primary, or anything marked primary. */
const PRIMARY = ".gl-cta, .tm-btn-primary, .v2-primary, [data-primary], [class*='primary']";

describe("Home puts the Paramedic first", () => {
  it("no history: the Paramedic entry is the only primary action, and it comes first", () => {
    const c = home([]);
    const paramedic = screen.getByTestId("paramedic");
    const door = within(paramedic).getByRole("button", { name: "Something's wrong" });
    const primaries = [...c.querySelectorAll<HTMLElement>(PRIMARY)];
    expect(primaries).toEqual([door]);
    // Nothing but the header comes before it, so it is in the first screenful, not under the fold.
    const head = c.querySelector(".gl-head")!;
    expect(head.nextElementSibling).toBe(paramedic);
    // The trust demo sits after it in the page.
    const trust = c.querySelector(".trust-moment")!;
    expect(paramedic.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("with history: the same single primary, in the same place", () => {
    const c = home([session]);
    const paramedic = screen.getByTestId("paramedic");
    const door = within(paramedic).getByRole("button", { name: "Something's wrong" });
    expect([...c.querySelectorAll<HTMLElement>(PRIMARY)]).toEqual([door]);
    expect(c.querySelector(".gl-head")!.nextElementSibling).toBe(paramedic);
  });

  it("'Watch it work' is still on Home, but quiet: not primary-styled", () => {
    const c = home([]);
    const watch = screen.getByRole("button", { name: /watch it work/i });
    expect(watch.classList.contains("tm-btn-primary")).toBe(false);
    expect(watch.matches(PRIMARY)).toBe(false);
    // It sits in the Trust card's own action row beside "No thanks", as a plain button.
    expect(watch.className).toBe("tm-btn");
    expect(within(c.querySelector(".tm-actions") as HTMLElement).getByRole("button", { name: /no thanks/i })).toBeTruthy();
  });

  it("shows no readiness score or grade word, with or without history", () => {
    for (const sessions of [[], [session]]) {
      const c = home(sessions);
      const text = c.textContent ?? "";
      expect(text).not.toMatch(/readiness|\bscore\b|\bgrade\b/i);
      // The grade words the retired ring printed (en home.homeConsole.stage.readinessGrade).
      // (Matched as a whole element's text: "Good morning" and "Worth a look: ..." are ordinary sentences.)
      const words = [...c.querySelectorAll("*")].map((el) => (el.textContent ?? "").trim());
      expect(words.filter((w) => w === "Good" || w === "Fair" || w === "Worth a look")).toEqual([]);
      // No ring either (the ratio "13 of 14 checks look right" is a fact on the Windows setup card, not a score).
      expect(c.querySelector("[data-read='readiness'], .ag-v, .ag-as-ring")).toBeNull();
      cleanup();
    }
  });
});
