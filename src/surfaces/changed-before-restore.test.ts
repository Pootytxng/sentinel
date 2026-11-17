import { describe, it, expect } from "vitest";
import type { AppliedChange, ChangedBeforeIncident, IntelEvent } from "../types";
import { restorePlan, runRestore, trialInProgress, unrecordedLiveRead } from "./changed-before-restore";

// P6-restore's pure halves: which changes "Put back how it was" offers, and how a run reports.

const ANCHOR = "2026-10-23T16:00:00+00:00";
const END = "2026-10-24T12:00:00+00:00";

const apply = (id: string, at: string, rolledBack = false): IntelEvent => ({
  id: `apply:${id}`,
  timestamp: at,
  event_type: "change-applied",
  source: "trust-ledger",
  scope: "compy-applied",
  game: null,
  summary: `${id} applied`,
  detail: null,
  observed_between: null,
  since_rolled_back: rolledBack,
  rec_id: id,
});
const rollbackEvent = (id: string, at: string): IntelEvent => ({ ...apply(id, at), id: `rollback:${id}`, event_type: "change-rolled-back" });

const row = (id: string, rec: string, at: string, extra: Partial<AppliedChange> = {}): AppliedChange => ({
  id,
  rec_id: rec,
  rec_title: rec.toUpperCase(),
  applied_at: at,
  snapshot: null,
  status: "applied",
  is_still_active: true,
  active_check: "on",
  ...extra,
});

const cb = (events: IntelEvent[], extra: Partial<ChangedBeforeIncident> = {}): ChangedBeforeIncident => ({
  anchor_kind: "clean",
  anchor: { started_at: ANCHOR, game: "Game" },
  window_end: END,
  items: [
    { category: "compy-changes", status: "changed", events, unknown_reason: null, last_reading_at: null, checked_between: null },
  ],
  ...extra,
});

describe("restorePlan", () => {
  it("offers live in-window changes newest first, with what each returns to", () => {
    const plan = restorePlan(cb([apply("a1", "2026-10-23T17:00:00Z"), apply("b1", "2026-10-23T18:00:00Z")]), [
      row("a1", "a", "2026-10-23T17:00:00Z", { restores_label: "Off" }),
      row("b1", "b", "2026-10-23T18:00:00Z"),
    ])!;
    expect(plan.date).toBe(ANCHOR);
    expect(plan.groups.map((g) => [g.recId, g.restoresLabel])).toEqual([["b", null], ["a", "Off"]]);
    expect(plan.steps.map((s) => s.id)).toEqual(["b1", "a1"]);
    expect(plan.turnedOnAgain).toEqual([]);
    expect(plan.unconfirmed).toEqual([]);
  });

  it("undoes every in-window apply of a change applied twice, and returns to the oldest one's prior", () => {
    const plan = restorePlan(cb([apply("a1", "2026-10-23T17:00:00Z"), apply("a2", "2026-10-23T19:00:00Z")]), [
      row("a1", "a", "2026-10-23T17:00:00Z", { restores_label: "Off" }),
      row("a2", "a", "2026-10-23T19:00:00Z", { restores_label: "On" }),
    ])!;
    expect(plan.groups).toHaveLength(1);
    expect(plan.groups[0].rows.map((r) => r.id)).toEqual(["a2", "a1"]);
    expect(plan.groups[0].restoresLabel).toBe("Off");
    expect(plan.steps.map((s) => s.id)).toEqual(["a2", "a1"]);
    expect(plan.unconfirmed, "the older row of an offered change is not 'not offered'").toEqual([]);
  });

  // s35: a row with no saved undo was offered, and its undo could only fail.
  it("never offers a change with an in-window row that has no saved undo, and names it", () => {
    const plan = restorePlan(
      cb([apply("a1", "2026-10-23T17:00:00Z"), apply("b1", "2026-10-23T18:00:00Z"), apply("c1", "2026-10-23T18:30:00Z"), apply("c2", "2026-10-23T19:00:00Z")]),
      [
        row("a1", "a", "2026-10-23T17:00:00Z"),
        row("b1", "b", "2026-10-23T18:00:00Z", { undo_contract: false }),
        // The newest apply has an undo, but the older one doesn't: undoing only the newest would stop halfway.
        row("c1", "c", "2026-10-23T18:30:00Z", { undo_contract: false }),
        row("c2", "c", "2026-10-23T19:00:00Z"),
      ],
    )!;
    expect(plan.groups.map((g) => g.recId)).toEqual(["a"]);
    expect(plan.steps.map((s) => s.id)).toEqual(["a1"]);
    expect([...plan.noSavedUndo].sort()).toEqual(["B", "C"]);
    expect(plan.unconfirmed).toEqual([]);
    expect(plan.turnedOnAgain).toEqual([]);
    // Only such a change in the window: the plan still says why nothing is offered.
    const only = restorePlan(cb([apply("b1", "2026-10-23T18:00:00Z")]), [
      row("b1", "b", "2026-10-23T18:00:00Z", { undo_contract: false }),
    ])!;
    expect(only.steps).toEqual([]);
    expect(only.noSavedUndo).toEqual(["B"]);
  });

  it("never undoes an apply from before the window, or one already rolled back", () => {
    const plan = restorePlan(cb([apply("a2", "2026-10-23T19:00:00Z")]), [
      row("a0", "a", "2026-10-20T10:00:00Z"),
      row("a1", "a", "2026-10-23T17:00:00Z", { status: "rolled_back", active_check: null }),
      row("a2", "a", "2026-10-23T19:00:00Z"),
    ])!;
    expect(plan.steps.map((s) => s.id)).toEqual(["a2"]);
  });

  it("says a change turned on again after the crash is not offered, not that it can't be confirmed", () => {
    const plan = restorePlan(cb([apply("a1", "2026-10-23T17:00:00Z")]), [
      row("a1", "a", "2026-10-23T17:00:00Z"),
      row("a3", "a", "2026-10-25T09:00:00Z"),
    ])!;
    expect(plan.groups).toEqual([]);
    expect(plan.turnedOnAgain).toEqual(["A"]);
    expect(plan.unconfirmed).toEqual([]);
  });

  it("names an in-window change Compy can't confirm is on, and stays quiet about one that reads off", () => {
    const plan = restorePlan(
      cb([apply("a1", "2026-10-23T17:00:00Z"), apply("b1", "2026-10-23T18:00:00Z"), apply("c1", "2026-10-23T18:30:00Z")]),
      [
        row("a1", "a", "2026-10-23T17:00:00Z", { active_check: "unreadable" }),
        row("b1", "b", "2026-10-23T18:00:00Z", { active_check: "off" }),
        row("c1", "c", "2026-10-23T18:30:00Z"),
      ],
    )!;
    expect(plan.steps.map((s) => s.id)).toEqual(["c1"]);
    expect(plan.unconfirmed).toEqual(["A"]);
    expect(plan.turnedOnAgain).toEqual([]);
  });

  it("offers nothing without an anchor, without the ledger, or with no apply in the window", () => {
    const events = [apply("a1", "2026-10-23T17:00:00Z")];
    const rows = [row("a1", "a", "2026-10-23T17:00:00Z")];
    expect(restorePlan(cb(events, { anchor: null, anchor_kind: "none" }), rows)).toBeNull();
    expect(restorePlan(cb(events), undefined)).toBeNull();
    expect(restorePlan(cb([rollbackEvent("a1", "2026-10-23T18:00:00Z")]), rows)).toBeNull();
    expect(restorePlan(cb([apply("a1", "2026-10-23T17:00:00Z", true)]), [row("a1", "a", "2026-10-23T17:00:00Z", { status: "rolled_back", active_check: null })])).toBeNull();
  });
});

describe("runRestore", () => {
  const steps = [row("c", "c", "2026-10-23T19:00:00Z"), row("b", "b", "2026-10-23T18:00:00Z"), row("a", "a", "2026-10-23T17:00:00Z")];

  it("undoes one at a time in the order given", async () => {
    const seen: string[] = [];
    const out = await runRestore(steps, async (c) => {
      seen.push(c.id);
    });
    expect(seen).toEqual(["c", "b", "a"]);
    expect(out.map((r) => r.outcome)).toEqual(["undone", "undone", "undone"]);
  });

  it("stops at a failure and marks the rest not tried", async () => {
    const seen: string[] = [];
    const out = await runRestore(steps, async (c) => {
      seen.push(c.id);
      if (c.id === "b") throw "snapshot missing";
    });
    expect(seen).toEqual(["c", "b"]);
    expect(out.map((r) => r.outcome)).toEqual(["undone", "failed", "not-tried"]);
  });

  it("reports an undo that ran but wasn't saved as unrecorded, with the backend's live read, and stops", async () => {
    const msg =
      "The undo ran on Windows, but Compy couldn't save that to its history (disk full), so Test → Applied & history may still list this change as applied. But a live read still shows the setting as changed (it may have been set this way before Compy touched it), so check the setting in Windows.";
    const out = await runRestore(steps, async (c) => {
      if (c.id === "c") throw msg;
    });
    expect(out.map((r) => r.outcome)).toEqual(["unrecorded", "not-tried", "not-tried"]);
    expect(out[0].liveRead).toMatch(/^But a live read still shows the setting as changed/);
  });

  it("has no live read to show when the message carries none", () => {
    expect(unrecordedLiveRead("The undo ran on Windows, but Compy couldn't save that to its history")).toBeUndefined();
  });
});

describe("trialInProgress", () => {
  it("locks while a Trial runs or the journey is under way, and when the store can't be read", () => {
    expect(trialInProgress([], true)).toBe("none");
    expect(trialInProgress([{ status: "kept" }, { status: "aborted" }], true)).toBe("none");
    expect(trialInProgress([{ status: "running" }], true)).toBe("running");
    expect(trialInProgress([{ status: "pending" }], true)).toBe("running");
    expect(trialInProgress([], false)).toBe("running");
    expect(trialInProgress(null, true)).toBe("unknown");
  });
});
