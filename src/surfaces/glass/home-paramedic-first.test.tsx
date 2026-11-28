// Home's first screen puts the Paramedic first (owner decision, constitution A38). Pins:
//  1. the Paramedic's "Check my PC" is the one primary action on Home, new user or not, with or without
//     the crash banner, and it comes before everything else on the page;
//  2. "Watch it work" is still on Home (the feature stays) but is a quiet button, not primary, in the
//     offer and after the demo finishes.
// "No readiness score or grade on Home" is pinned where the ring lived, in home-console.test.tsx
// (HomeGlass, the summary page, never had one). Home is composed the way App composes it: HomeGlass
// with TrustMoment in its latestChange slot.
//  3. e9 (card at 720): while the card is open, the rest of Home folds under the card's own row in a short window;
//     the crash banner and the first-win journey (TrustMoment, FirstWin) never fold (review r1 F1).
//     jsdom has no layout: the fold rule is read from glass-rooms.css and matched against this DOM; the real
//     geometry at 1280x720 was not measured.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import type { ReactNode } from "react";
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
import { FirstWin } from "../FirstWin";

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

function home(sessions: SessionSummary[], pendingCare: PendingCareIncident | null = null, latestChange?: ReactNode) {
  const { container } = render(
    <HomeGlass
      readiness={readiness()}
      priorities={null}
      sessions={sessions}
      pendingCare={pendingCare}
      onOpenCareIncident={vi.fn()}
      onDismissCareIncident={vi.fn()}
      onOpenGame={vi.fn()}
      onOpenLive={vi.fn()}
      onRunCheck={vi.fn()}
      onSeeChecks={vi.fn()}
      onOpenDetails={vi.fn()}
      latestChange={latestChange ?? <TrustMoment recs={[REC]} changes={[]} isAppliable={() => true} onChanged={vi.fn()} />}
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
    const door = within(paramedic).getByRole("button", { name: "Check my PC" });
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
    const door = within(paramedic).getByRole("button", { name: "Check my PC" });
    expect([...c.querySelectorAll<HTMLElement>(PRIMARY)]).toEqual([door]);
    expect(c.querySelector(".gl-head")!.nextElementSibling).toBe(paramedic);
  });

  // The crash banner used to carry a second green primary ("Find out why"). It is a quiet button now: Home has one
  // primary action with or without the banner, and it is the Paramedic card's own.
  it("with a crash banner showing, there is still exactly one primary action, and the Paramedic door still comes first", () => {
    const c = home([session], care);
    const paramedic = screen.getByTestId("paramedic");
    const door = within(paramedic).getByRole("button", { name: "Check my PC" });
    expect([...c.querySelectorAll<HTMLElement>(PRIMARY)]).toEqual([door]);
    const find = within(c.querySelector<HTMLElement>(".gl-banner")!).getByRole("button", { name: "Find out why" });
    expect(find.matches(PRIMARY)).toBe(false);
    expect(paramedic.compareDocumentPosition(find) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("with a crash banner and no history, the same single primary", () => {
    const c = home([], care);
    const door = within(screen.getByTestId("paramedic")).getByRole("button", { name: "Check my PC" });
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
      within(screen.getByTestId("paramedic")).getByRole("button", { name: "Check my PC" }),
    ]);
  }, 15000);
});

// e9 (card at 720): the fold is CSS (a short-window media query keyed on the card's data-home-fold), so the rule
// itself is read from glass-rooms.css and run as a selector against this DOM. Layout is not measured here.
describe("e9: while the card is open, the rest of Home folds under one row (short window)", () => {
  const css = readFileSync(join("src", "surfaces", "glass-rooms.css"), "utf8");
  const rule = /\n\s*([^{}\n]*\[data-home-fold="folded"\] ~ [^{}\n]*?)\s*\{\s*display: none;/.exec(css);
  const folded = () => [...document.querySelectorAll<HTMLElement>(rule![1])];
  beforeEach(() => document.documentElement.setAttribute("data-v2", "on"));
  afterEach(() => document.documentElement.removeAttribute("data-v2"));

  // No diagnosis comes back in this file (invoke answers null): the card shows its failed line, and
  // "Something else?" opens the questions, which is an open card.
  async function openCard() {
    const card = screen.getByTestId("paramedic");
    fireEvent.click(within(card).getByRole("button", { name: "Check my PC" }));
    fireEvent.click(await within(card).findByRole("button", { name: "Something else? Answer a few questions" }));
    return card;
  }
  const row = (card: HTMLElement) => within(card).getByRole("button", { name: "The rest of this page" });

  // The short-window query's own block: from "@media" to the first "}" at column 0 after it (review r1 F5).
  const mediaAt = css.indexOf("@media (max-height: 899.98px)");
  const mediaBlock = mediaAt < 0 ? "" : css.slice(mediaAt, css.indexOf("\n}", mediaAt) + 2);
  // A rule in that block that sets `prop: value` for a selector holding `has`: its selector, run on the DOM.
  const esc = (s: string) => s.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
  const ruleFor = (has: string, prop: string) => {
    const m = new RegExp("\\n\\s*([^{}\\n]*" + esc(has) + "[^{}\\n]*?)\\s*\\{\\s*" + esc(prop)).exec(mediaBlock);
    return m ? m[1] : null;
  };

  it("the fold lives inside the short-window media query, and only a folded card gets the taller cap", () => {
    expect(rule).not.toBeNull();
    expect(mediaBlock).not.toBe("");
    expect(mediaBlock).toContain(rule![0].trim());
    expect(mediaBlock).toMatch(/\.gl-para-card\[data-home-fold="folded"\] \{[^}]*--para-card-max: clamp\(260px, calc\(100vh - 240px - var\(--para-keep-banner\) - var\(--para-keep-journey\)\), 520px\);/);
    // Outside that query the row is never drawn: a taller page area keeps e8's layout.
    expect(css.slice(0, mediaAt)).toMatch(/\.gl-para-homefold \{\s*display: none;\s*\}/);
  });

  // review r1 F2: what stays after the card takes its height out of the folded cap.
  it("the folded cap makes room for the crash banner and for the first-win journey only when they follow the card", async () => {
    const keepBanner = ruleFor(":has(~ .gl-banner)", "--para-keep-banner: 84px;");
    const keepJourney = ruleFor(":has(~ :is(.trust-moment, .first-win))", "--para-keep-journey: 161px;");
    expect(keepBanner).not.toBeNull();
    expect(keepJourney).not.toBeNull();
    home([session], care);
    let card = await openCard();
    expect(document.querySelector(keepBanner!)).toBe(card);
    expect(document.querySelector(keepJourney!)).toBe(card);
    cleanup();
    home([session], null, <></>);
    card = await openCard();
    expect(document.querySelector(keepBanner!)).toBeNull();
    expect(document.querySelector(keepJourney!)).toBeNull();
  });

  it("open: the tiles and the lower half fold, the crash banner and the first-win journey stay; the row shows the rest again, its text unchanged", async () => {
    const c = home([session], care);
    const tiles = c.querySelector<HTMLElement>(".gl-kpis")!;
    const lower = c.querySelector<HTMLElement>(".gl-lower")!;
    const banner = c.querySelector<HTMLElement>(".gl-banner")!;
    const before = [tiles.textContent, lower.textContent];
    // Closed: no row, nothing folded.
    expect(screen.queryByTestId("paramedic-home-fold")).toBeNull();
    expect(folded()).toEqual([]);

    const card = await openCard();
    expect(card.getAttribute("data-home-fold")).toBe("folded");
    const room = c.querySelector<HTMLElement>(".gl-room")!;
    const after = [...room.children].slice([...room.children].indexOf(card) + 1);
    const trust = c.querySelector<HTMLElement>(".trust-moment")!;
    expect(after).toEqual(expect.arrayContaining([banner, tiles, lower, trust]));
    expect(folded()).toEqual([tiles, lower]);
    expect(folded().some((el) => el.contains(banner) || el.contains(trust))).toBe(false);
    expect(row(card).getAttribute("aria-expanded")).toBe("false");
    // review r1 F4: the note is the row's description while it shows.
    const note = within(card).getByText("Folded while this is open");
    expect(row(card).getAttribute("aria-describedby")).toBe(note.id);

    fireEvent.click(row(card));
    expect(row(card).getAttribute("aria-expanded")).toBe("true");
    expect(card.getAttribute("data-home-fold")).toBe("shown");
    expect(folded()).toEqual([]);
    expect(within(card).queryByText("Folded while this is open")).toBeNull();
    // Fold/hide only: the tiles and the lower half say exactly what they said before the card opened.
    expect([tiles.textContent, lower.textContent]).toEqual(before);
    expect(within(tiles).getAllByRole("button", { name: /elden/i })[0]).toBeTruthy();
  });

  it("the row is the card's last control, so Tab from it goes on to the page in its own order", async () => {
    home([session]);
    const card = await openCard();
    const controls = [...card.querySelectorAll<HTMLElement>("button, [tabindex='0']")];
    expect(controls[controls.length - 1]).toBe(row(card));
  });

  it("Escape: a shown page folds again first (focus stays on the row), the next Escape closes the card", async () => {
    const c = home([session]);
    const card = await openCard();
    fireEvent.click(row(card));
    row(card).focus();
    fireEvent.keyDown(row(card), { key: "Escape" });
    expect(row(card).getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(row(card));
    expect(card.getAttribute("data-open")).toBe("true");
    expect(folded()).toEqual(expect.arrayContaining([c.querySelector(".gl-kpis")]));

    fireEvent.keyDown(row(card), { key: "Escape" });
    expect(card.getAttribute("data-open")).toBe("false");
    expect(card.hasAttribute("data-home-fold")).toBe(false);
    expect(screen.queryByTestId("paramedic-home-fold")).toBeNull();
    expect(folded()).toEqual([]);
    expect(document.activeElement).toBe(within(card).getByRole("button", { name: "Check my PC" }));
  });

  it("closing brings Home back, and the next open folds it again", async () => {
    home([session]);
    let card = await openCard();
    fireEvent.click(row(card));
    expect(card.getAttribute("data-home-fold")).toBe("shown");
    fireEvent.click(within(card).getByRole("button", { name: "Close" }));
    expect(folded()).toEqual([]);
    card = await openCard();
    expect(card.getAttribute("data-home-fold")).toBe("folded");
    expect(row(card).getAttribute("aria-expanded")).toBe("false");
  });

  // review r1 F1: the first-win journey's live apply/undo status is never folded away while the card is open.
  it("TrustMoment's live demo status stays out of the fold, still a live region", async () => {
    const c = home([session]);
    fireEvent.click(screen.getByRole("button", { name: /watch it work/i }));
    const trust = c.querySelector<HTMLElement>(".trust-moment")!;
    const live = await within(trust).findByRole("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    await openCard();
    expect(folded()).toEqual(expect.arrayContaining([c.querySelector(".gl-kpis"), c.querySelector(".gl-lower")]));
    expect(folded().some((el) => el.contains(trust))).toBe(false);
    expect(within(trust).getByRole("status")).toBe(live);
  });

  it("FirstWin's verdict status stays out of the fold, still a live region", async () => {
    const active: AppliedChange = {
      id: "c-9",
      rec_id: "game-mode",
      rec_title: "Game Mode",
      applied_at: "2026-10-24T01:00:00Z",
      snapshot: null,
      status: "applied",
      is_still_active: true,
    };
    const c = home([session], null, <FirstWin changes={[active]} onChanged={vi.fn()} />);
    const win = c.querySelector<HTMLElement>(".first-win")!;
    fireEvent.click(win.querySelector<HTMLButtonElement>(".fw-btn-primary")!);
    const verdict = await within(win).findByRole("status");
    expect(verdict.getAttribute("aria-live")).toBe("polite");
    await openCard();
    expect(folded()).toEqual(expect.arrayContaining([c.querySelector(".gl-kpis"), c.querySelector(".gl-lower")]));
    expect(folded().some((el) => el.contains(win))).toBe(false);
    expect(within(win).getByRole("status")).toBe(verdict);
  });
});
