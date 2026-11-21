// Home's first screen puts the Paramedic first (owner decision, constitution A38). Pins:
//  1. the Paramedic's "Something's wrong" is the one primary action on Home, new user or not, with or without
//     the crash banner, and it comes before everything else on the page;
//  2. "Watch it work" is still on Home (the feature stays) but is a quiet button, not primary, in the
//     offer and after the demo finishes.
// "No readiness score or grade on Home" is pinned where the ring lived, in home-console.test.tsx
// (HomeGlass, the summary page, never had one). Home is composed the way App composes it: HomeGlass
// with TrustMoment in its latestChange slot.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import type { AppliedChange } from "../../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "apply_recommendation") {
      const change: AppliedChange = {
        id: "c-1",
        rec_id: "game-mode",
        rec_title: "Game Mode",
        applied_at: "2026-10-24T01:00:00Z",
        snapshot: null,
        status: "applied",
        is_still_active: true,
      };
      return Promise.resolve(change);
    }
    return Promise.resolve(null);
  },
}));

import "../../i18n";
import type { GameReadiness, PendingCareIncident, Recommendation, SessionSummary } from "../../types";
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

const care: PendingCareIncident = {
  incident_id: "inc-1",
  occurred_at: "2026-10-30T13:44:00-07:00",
  occurred_display: "Oct 30, 1:44 PM",
  kind: "App crash",
  app_label: "Elden Ring",
  summary: "Elden Ring closed unexpectedly",
};

function home(sessions: SessionSummary[], pendingCare: PendingCareIncident | null = null) {
  const { container } = render(
    <HomeGlass
      readiness={readiness()}
      priorities={null}
      sessions={sessions}
      pendingCare={pendingCare}
      onDismissCareIncident={vi.fn()}
      onOpenGame={vi.fn()}
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
  it("no history, no crash banner: the Paramedic entry is the only primary action, and it comes first", () => {
    const c = home([]);
    const paramedic = screen.getByTestId("paramedic");
    const door = within(paramedic).getByRole("button", { name: "Something's wrong" });
    expect([...c.querySelectorAll<HTMLElement>(PRIMARY)]).toEqual([door]);
    // Nothing but the header comes before it, so it is in the first screenful, not under the fold.
    expect(c.querySelector(".gl-head")!.nextElementSibling).toBe(paramedic);
    // The trust demo sits after it in the page.
    const trust = c.querySelector(".trust-moment")!;
    expect(paramedic.compareDocumentPosition(trust) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("with history and no crash banner: the same single primary, in the same place", () => {
    const c = home([session]);
    const paramedic = screen.getByTestId("paramedic");
    const door = within(paramedic).getByRole("button", { name: "Something's wrong" });
    expect([...c.querySelectorAll<HTMLElement>(PRIMARY)]).toEqual([door]);
    expect(c.querySelector(".gl-head")!.nextElementSibling).toBe(paramedic);
  });

  // The crash banner used to carry a second green primary ("Find out why"). It is a quiet button now: Home has one
  // primary action with or without the banner, and it is the Paramedic card's own.
  it("with a crash banner showing, there is still exactly one primary action, and the Paramedic door still comes first", () => {
    const c = home([session], care);
    const paramedic = screen.getByTestId("paramedic");
    const door = within(paramedic).getByRole("button", { name: "Something's wrong" });
    expect([...c.querySelectorAll<HTMLElement>(PRIMARY)]).toEqual([door]);
    const find = within(c.querySelector<HTMLElement>(".gl-banner")!).getByRole("button", { name: "Find out why" });
    expect(find.matches(PRIMARY)).toBe(false);
    expect(paramedic.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("with a crash banner and no history, the same single primary", () => {
    const c = home([], care);
    const door = within(screen.getByTestId("paramedic")).getByRole("button", { name: "Something's wrong" });
    expect([...c.querySelectorAll<HTMLElement>(PRIMARY)]).toEqual([door]);
  });

  it("'Watch it work' is still on Home, but quiet: not primary-styled", () => {
    const c = home([]);
    const watch = screen.getByRole("button", { name: /watch it work/i });
    expect(watch.matches(PRIMARY)).toBe(false);
    // It sits in the Trust card's own action row beside "No thanks", as a plain button.
    expect(watch.className).toBe("tm-btn");
    expect(within(c.querySelector(".tm-actions") as HTMLElement).getByRole("button", { name: /no thanks/i })).toBeTruthy();
  });

  it("after the demo finishes, 'Got it' is quiet too: Home never has two primaries", async () => {
    const c = home([]);
    fireEvent.click(screen.getByRole("button", { name: /watch it work/i }));
    // The card pauses ~2.6 s on the applied receipt before the undo half runs.
    const gotIt = await screen.findByRole("button", { name: /got it/i }, { timeout: 8000 });
    expect(gotIt.className).toBe("tm-btn");
    expect([...c.querySelectorAll<HTMLElement>(PRIMARY)]).toEqual([
      within(screen.getByTestId("paramedic")).getByRole("button", { name: "Something's wrong" }),
    ]);
  }, 15000);
});
