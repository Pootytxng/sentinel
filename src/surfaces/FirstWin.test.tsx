// FirstWin — the follow-through after a user's first real change (P2 / issue #49).
//
// What these pin is not "the card renders". It is the things that would each turn a trust surface
// into a liar: claiming a change is live when the machine says otherwise, claiming a speed result
// no session has measured, and offering an undo that does not undo. Every honest state is falsified
// in BOTH directions — the good verdict must not appear on a reverted read, and the bad verdict
// must not appear on a clean one.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { AppliedChange, Recommendation } from "../types";
import { FIRST_WIN_KEY } from "./first-win-data";
import { ROLLBACK_UNRECORDED_LEAD } from "../data/rollback-error";

// A small STATE MACHINE, not a stub bag. The whole subject of this file is whether the verdict
// follows what the MACHINE says at the moment the button is pressed, so `machine` is what the next
// `get_recommendations` answers with. A fixed stub would pass even if the card never read at all.
const invokeMock = vi.hoisted(() => ({
  calls: [] as { cmd: string; args?: unknown }[],
  machine: null as unknown,
  readFails: false,
  rollbackFails: false,
  /** When set, rollback_change rejects with this exact string (what Tauri hands back for an Err). */
  rollbackError: null as string | null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: Record<string, unknown>) => {
    invokeMock.calls.push({ cmd, args });
    if (cmd === "get_recommendations") {
      return invokeMock.readFails
        ? Promise.reject(new Error("the scan could not run"))
        : Promise.resolve(invokeMock.machine);
    }
    if (cmd === "rollback_change") {
      if (invokeMock.rollbackError) return Promise.reject(invokeMock.rollbackError);
      return invokeMock.rollbackFails
        ? Promise.reject(new Error("the machine said no"))
        : Promise.resolve(null);
    }
    return Promise.reject(new Error(`no stub for "${cmd}"`));
  }),
}));

import { FirstWin } from "./FirstWin";

const CHANGE: AppliedChange = {
  id: "c-1",
  rec_id: "game-mode",
  rec_title: "Game Mode",
  applied_at: "2026-08-26T01:00:00Z",
  snapshot: null,
  status: "applied",
  is_still_active: true,
};

/** What the user actually reads for `game-mode` — the friendly headline, never `rec_title`. */
const FRIENDLY_NAME = "Help Windows focus on your game";

const rec = (currently_applied: boolean): Recommendation => ({
  id: "game-mode",
  title: "Game Mode",
  category: "system",
  severity: "safe",
  description: "",
  impact: "",
  downside: null,
  applies_to: "",
  currently_applied,
  provenance: "verified",
});

/** Renders the card against a machine that will answer the check with `machineSays`. */
function mount(machineSays: unknown, changes: AppliedChange[] = [CHANGE]) {
  invokeMock.machine = machineSays;
  const onChanged = vi.fn();
  const view = render(<FirstWin changes={changes} onChanged={onChanged} />);
  return { onChanged, view };
}

const check = () => fireEvent.click(screen.getByRole("button", { name: /check my pc again/i }));

beforeEach(() => {
  localStorage.clear();
  invokeMock.calls.length = 0;
  invokeMock.machine = null;
  invokeMock.readFails = false;
  invokeMock.rollbackFails = false;
  invokeMock.rollbackError = null;
});
afterEach(cleanup);

describe("FirstWin — when it speaks at all", () => {
  it("says nothing on a machine with no live change", () => {
    const { container } = render(<FirstWin changes={[]} onChanged={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("says nothing once it has been seen — it is a follow-through, not a nag", () => {
    localStorage.setItem(FIRST_WIN_KEY, "1");
    const { container } = render(<FirstWin changes={[CHANGE]} onChanged={vi.fn()} />);
    expect(container.textContent).toBe("");
  });

  it("names the change in plain English, not by its technical title", () => {
    // A first-timer is the entire audience for this card. `rec_title` is the engineer's name for
    // the setting; the friendly headline is the one a person can act on.
    mount([rec(true)]);
    expect(screen.getByText(FRIENDLY_NAME)).toBeInTheDocument();
    expect(document.body.textContent || "").not.toMatch(/Game Mode/);
  });

  it("offers the check without claiming anything yet", () => {
    mount([rec(true)]);
    expect(screen.getByRole("button", { name: /check my pc again/i })).toBeInTheDocument();
    // NOTHING is asserted about the machine, and nothing is read, before the user asks.
    expect(document.body.textContent || "").not.toMatch(/just read your PC/i);
    expect(invokeMock.calls).toEqual([]);
  });

  // #452: "first" vs "latest" is a fact about the ledger's history, not an in-effect count. A
  // change the user applied earlier still makes this one not their first even when its live check
  // no longer agrees; only an undone one (the demo leaves those) does not count.
  describe("the heading", () => {
    const earlier = (over: Partial<AppliedChange>): AppliedChange => ({
      ...CHANGE,
      id: "c-0",
      rec_id: "hags-enable",
      applied_at: "2026-08-25T01:00:00Z",
      ...over,
    });

    it("calls the only change the user made their first", () => {
      mount([rec(true)]);
      expect(screen.getByText("Your first change")).toBeInTheDocument();
    });

    it("is not 'first' when an earlier applied change no longer reads as live", () => {
      mount([rec(true)], [earlier({ is_still_active: false }), CHANGE]);
      expect(screen.getByText("Your latest change")).toBeInTheDocument();
      expect(screen.queryByText("Your first change")).toBeNull();
    });

    it("stays 'first' when the only earlier row was undone", () => {
      mount([rec(true)], [earlier({ status: "rolled_back", is_still_active: false }), CHANGE]);
      expect(screen.getByText("Your first change")).toBeInTheDocument();
    });
  });
});

describe("FirstWin — the proof, and its limits", () => {
  it("reads the machine at press time rather than trusting the ledger it was handed", async () => {
    // The defect this exists for: an earlier draft asked the PARENT to refresh and then read the
    // recs back through a ref. The parent's refresh resolves before React re-renders, so the ref
    // still held the pre-change list and a reverted setting would have been confirmed as held.
    // The read is now made here and awaited, so the verdict cannot come from stale data.
    mount([rec(false)]);
    check();
    await screen.findByText(/did not stay/i);
    expect(invokeMock.calls.map((c) => c.cmd)).toContain("get_recommendations");
  });

  it("confirms the change held when a fresh read agrees", async () => {
    mount([rec(true)]);
    check();
    await screen.findByText(/just read your PC again/i);
    expect(document.body.textContent || "").toMatch(/still set the way Compy left it/i);
    expect(document.body.textContent || "").not.toMatch(/did not stay/i);
  });

  it("says the change did NOT hold when the fresh read disagrees — and offers no undo for it", async () => {
    // The lie this prevents: reporting success off the LEDGER's memory. The ledger still says
    // active; the machine says otherwise, and the machine wins.
    mount([rec(false)]);
    check();
    await screen.findByText(/did not stay/i);
    expect(document.body.textContent || "").not.toMatch(/still set the way Compy left it/i);
    // Undoing something the machine just said is already off would be a second unfounded claim.
    expect(screen.queryByRole("button", { name: /put it back/i })).not.toBeInTheDocument();
  });

  it("refuses to judge a setting it could not find in the fresh read", async () => {
    mount([]);
    check();
    await screen.findByText(/could not read/i);
    expect(document.body.textContent || "").not.toMatch(/still set the way Compy left it/i);
    expect(document.body.textContent || "").not.toMatch(/did not stay/i);
  });

  it("does not read a failed scan as a reverted change", async () => {
    // A read that never ran is not evidence of anything. Calling it "reverted" would accuse the
    // user's PC of undoing a change on the strength of Compy's own failure.
    invokeMock.readFails = true;
    mount(null);
    check();
    await screen.findByText(/could not look/i);
    expect(document.body.textContent || "").not.toMatch(/did not stay/i);
    expect(document.body.textContent || "").not.toMatch(/still set the way Compy left it/i);
  });

  it("never turns a confirmed setting into a speed claim", async () => {
    // The single most tempting fabrication on this surface. No session has been played, so the
    // honest line names what proving it takes instead of promising frames.
    mount([rec(true)]);
    check();
    await screen.findByText(/just read your PC again/i);
    const text = document.body.textContent || "";
    expect(text).toMatch(/only playing can answer that/i);
    expect(text).not.toMatch(/\bfaster now\b|\bis now faster\b|\bimproved your\b/i);
  });
});

describe("FirstWin — the undo is real", () => {
  it("rolls back through the audited ledger call, not a local state flip", async () => {
    const { onChanged } = mount([rec(true)]);
    check();
    fireEvent.click(await screen.findByRole("button", { name: /put it back/i }));
    await screen.findByText(/back exactly the way it was/i);
    expect(invokeMock.calls).toContainEqual({ cmd: "rollback_change", args: { changeId: "c-1" } });
    // The rest of the app must be told, or Home keeps painting the pre-rollback ledger.
    expect(onChanged).toHaveBeenCalled();
  });

  it("does not claim the undo worked when the call failed — and says where the change still is", async () => {
    invokeMock.rollbackFails = true;
    const { onChanged } = mount([rec(true)]);
    check();
    fireEvent.click(await screen.findByRole("button", { name: /put it back/i }));
    await screen.findByText(/did not finish/i);
    expect(document.body.textContent || "").not.toMatch(/back exactly the way it was/i);
    expect(document.body.textContent || "").toMatch(/still on/i);
    // Nothing changed, so nothing to refresh — announcing a change that did not happen is the bug.
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("says the undo worked when it ran but couldn't be saved to history (#631)", async () => {
    invokeMock.rollbackError = `${ROLLBACK_UNRECORDED_LEAD} (disk full), so Test → Applied & history may still list this change as applied.`;
    mount([rec(true)]);
    check();
    fireEvent.click(await screen.findByRole("button", { name: /put it back/i }));
    await screen.findByText(/undo worked on Windows/i);
    const text = document.body.textContent || "";
    expect(text).not.toMatch(/still on/i);
    expect(text).not.toMatch(/did not finish/i);
  });

  it("keeps naming the same change after its own rollback empties the live set", async () => {
    // The trap: the card picks its subject FROM the live-change list, and its own undo removes the
    // last entry. Re-deriving would blank the sentence mid-read.
    invokeMock.machine = [rec(true)];
    const onChanged = vi.fn();
    const view = render(<FirstWin changes={[CHANGE]} onChanged={onChanged} />);
    check();
    fireEvent.click(await screen.findByRole("button", { name: /put it back/i }));
    await screen.findByText(/back exactly the way it was/i);
    // The parent's refresh lands: the ledger row is now rolled back, so nothing is live.
    view.rerender(
      <FirstWin
        changes={[{ ...CHANGE, status: "rolled_back", is_still_active: false }]}
        onChanged={onChanged}
      />,
    );
    expect(screen.getByText(FRIENDLY_NAME)).toBeInTheDocument();
    expect(document.body.textContent || "").toMatch(/back exactly the way it was/i);
  });

  it("is gone for good after Got it, and stays gone across a remount", async () => {
    const { view } = mount([rec(true)]);
    fireEvent.click(screen.getByRole("button", { name: /got it/i }));
    await waitFor(() => expect(view.container.textContent).toBe(""));
    cleanup();
    const again = render(<FirstWin changes={[CHANGE]} onChanged={vi.fn()} />);
    expect(again.container.textContent).toBe("");
  });
});
