import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { WalkthroughDisclosure } from "./WalkthroughDisclosure";
import { Walkthrough } from "./Walkthrough";
import { RoomActiveContext } from "../data/use-room-active";
import { readLocalStats } from "../data/local-stats";
import { walkthroughForKey } from "../surfaces/walkthroughs";

// bug→guard (Q7 idle-cost audit, 2026-08-04): TWO defects, one root cause.
//
// `<details>` does not gate MOUNTING. React renders its children into the DOM whatever `open` says —
// the browser just hides them — so an unconditional `<Walkthrough>` inside a collapsed disclosure
// mounted anyway, and its effects ran. Check and Fix did exactly that on every walkthrough-bearing
// row. Two things went wrong, and only one of them was about performance:
//
//   1. IDLE COST — each mount starts a 2.2s auto-advance carousel. App.tsx keeps Optimize mounted
//      behind `display: none` after the first visit, so one trip there left N carousels ticking in
//      every other room, and behind a fullscreen game — the exact thing Compy exists to prevent.
//   2. A FABRICATED NUMBER — mounting bumps `walkthroughsOpened`, and the Export modal shows that
//      count back to the user ("N walkthroughs opened"). It was counting disclosures nobody opened.
//      That is a receipts-doctrine problem, not a perf one: never claim what wasn't measured.
//
// `keepalive-idle-guard.test.ts` pins the STRUCTURE (a timer in the keepalive must reference both
// idle signals). This pins the BEHAVIOUR, because structure alone can't tell whether the gate landed
// on the right effect. The five existing call-site tests (Lab, Learn, TuningInstrument,
// slim-row-proof-guard) only assert on the `<summary>` label, so they pass whether the disclosure
// mounts its walkthrough eagerly or not — none of them would have caught either defect.

const WT = () => walkthroughForKey("amd-gpu-undervolt")!;
const carousel = () => document.querySelector(".wt-root");
const openedCount = () => readLocalStats().walkthroughsOpened;
/** Index of the step currently highlighted — the thing auto-advance moves. */
const activeStep = (root: HTMLElement) =>
  [...root.querySelectorAll(".wt-step")].findIndex((el) => el.className.includes("wt-step-on"));
const stepCount = (root: HTMLElement) => root.querySelectorAll(".wt-step").length;

afterEach(() => {
  cleanup();
  try {
    localStorage.clear(); // resets both the "opened" counter and the motion pref to their defaults
  } catch {
    /* no localStorage */
  }
});

describe("WalkthroughDisclosure — closed means not mounted", () => {
  it("mounts NOTHING while collapsed: no carousel, and no 'opened' credit", () => {
    render(<WalkthroughDisclosure label="Show me the way" walkthrough={WT()} vendor="amd" />);

    // The label is on screen — the row still offers the walkthrough...
    expect(screen.getByText("Show me the way")).toBeInTheDocument();
    // ...but nothing behind it exists yet. Not hidden: absent.
    expect(carousel()).toBeNull();
    expect(openedCount()).toBe(0);
  });

  it("clicking the summary opens it for real — the controlled <details> actually toggles", () => {
    // Worth pinning on its own: this is a CONTROLLED `<details>` (`open` from state, click
    // preventDefault'd). If that wiring broke, the disclosure would silently stop opening, and the
    // test above would still pass — "mounts nothing" is only correct while "opens on click" holds.
    render(<WalkthroughDisclosure label="Show me the way" walkthrough={WT()} vendor="amd" />);

    fireEvent.click(screen.getByText("Show me the way"));
    expect(carousel()).not.toBeNull();
    expect(document.querySelector("details")?.open).toBe(true);

    fireEvent.click(screen.getByText("Show me the way"));
    expect(carousel()).toBeNull(); // closing unmounts again — the timer goes with it
    expect(document.querySelector("details")?.open).toBe(false);
  });

  it("counts a walkthrough as opened only when the user opens it", () => {
    render(<WalkthroughDisclosure label="Show me the way" walkthrough={WT()} vendor="amd" />);
    expect(openedCount()).toBe(0);

    fireEvent.click(screen.getByText("Show me the way"));
    expect(openedCount()).toBe(1); // one real open = one count, no more and no less
  });
});

describe("Walkthrough auto-advance stands down when nobody can see it", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // Motion is left at its "full" default (owner decision: motion on, OS override) — reduced motion
  // never auto-advances at all, so it would prove nothing here.

  /**
   * Exactly one auto-advance interval. Always tick ONE at a time and assert in between: the carousel
   * wraps (`(a + 1) % steps.length`), so advancing N ticks at once on an N-step walkthrough lands
   * back on step 0 and a completely ungated timer reads as "never moved". That false pass is not
   * hypothetical — it is what the first draft of this file did, and re-breaking the gate on purpose
   * is the only reason it was caught.
   */
  const tick = () =>
    act(() => {
      vi.advanceTimersByTime(2200);
    });

  it("advances on its own when the room is on screen (the baseline)", () => {
    // If this one ever fails, every "does NOT advance" test below is vacuous.
    const { container } = render(<Walkthrough walkthrough={WT()} vendor="amd" />);
    expect(stepCount(container)).toBeGreaterThan(2); // >1 or the effect bails; >2 for the resume test
    expect(activeStep(container)).toBe(0);
    tick();
    expect(activeStep(container)).toBe(1);
  });

  it("does NOT advance inside a hidden room, though the window is perfectly visible", () => {
    // The keepalive case, and the reason `useDocumentVisible` alone was not enough: the user is
    // looking at Home, Optimize sits behind `display: none`, and `document.hidden` is false.
    const { container } = render(
      <RoomActiveContext.Provider value={false}>
        <Walkthrough walkthrough={WT()} vendor="amd" />
      </RoomActiveContext.Provider>,
    );
    for (let i = 0; i < 5; i++) {
      tick();
      expect(activeStep(container), `advanced on tick ${i + 1} inside a hidden room`).toBe(0);
    }
  });

  it("does NOT advance while the window is hidden (minimized, or behind a fullscreen game)", () => {
    const spy = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    try {
      const { container } = render(<Walkthrough walkthrough={WT()} vendor="amd" />);
      for (let i = 0; i < 5; i++) {
        tick();
        expect(activeStep(container), `advanced on tick ${i + 1} behind a game`).toBe(0);
      }
    } finally {
      spy.mockRestore();
    }
  });

  it("resumes from where it stopped when the room comes back — no jump to re-read", () => {
    const wt = WT();
    const room = (active: boolean) => (
      <RoomActiveContext.Provider value={active}>
        <Walkthrough walkthrough={wt} vendor="amd" />
      </RoomActiveContext.Provider>
    );
    const { container, rerender } = render(room(true));
    tick();
    expect(activeStep(container)).toBe(1);

    rerender(room(false));
    for (let i = 0; i < 5; i++) {
      tick();
      expect(activeStep(container), `advanced on tick ${i + 1} after the room went away`).toBe(1);
    }

    rerender(room(true));
    tick();
    expect(activeStep(container)).toBe(2); // picks up at step 2, not restarted from the top
  });
});
