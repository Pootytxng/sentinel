// CR-undo-entry-disable (r2 NIT of CR-footer-reversible). A live change whose stored history
// resolves to no undo (`undo_contract: false`, `hasUndo` false) used to disable Roll back only on
// the Applied card; the details sheet's Roll back, the debrief's "Revert it" and the What-changed
// shortcut stayed enabled and ended in App's refusal. Every entry now disables the same way and
// shows the Applied card's reason line (`optimize.fix.noSavedUndo`). Each test fails on the old code.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { WhatChangedPanel } from "./WhatChangedPanel";
import { SessionDebrief } from "./SessionDebrief";
import { ActionDetailsSheet } from "./ActionDetails";
import { ConfirmProvider } from "../design/ConfirmDialog";
import type { WhatChangedOutcome, IntelSessionRef, AppliedChange, ComparisonResult, SessionSummary } from "../types";

const REASON = "Compy has no saved undo for this change.";

const harness = vi.hoisted(() => ({ outcome: null as unknown, comparison: null as unknown, dismissed: 0 }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "what_changed_for_session") return Promise.resolve(harness.outcome);
    if (cmd === "get_latest_comparison") return Promise.resolve(harness.comparison);
    if (cmd === "dismiss_comparison") {
      harness.dismissed += 1;
      harness.comparison = null;
      return Promise.resolve(null);
    }
    return Promise.resolve(null);
  },
}));

const REC_ID = "disable-xbox-gamebar";
const sref = (started_at: string, low1_fps: number): IntelSessionRef => ({
  started_at,
  game: "Valorant",
  duration_secs: 3600,
  samples: 3400,
  avg_fps: 244.0,
  low1_fps,
  gaming_mode_active: true,
  hw_hash: "hw1",
});

const report: WhatChangedOutcome = {
  kind: "report",
  baseline: sref("2026-07-08T20:00:00Z", 101.4),
  current: sref("2026-07-10T20:00:00Z", 92.1),
  game: "Valorant",
  verdict: "regressed",
  headline: "1% lows dropped 9.2% vs your previous Valorant session.",
  observations: [],
  noise_floor_pct: 3.0,
  events_between: [],
  leading_hypotheses: [],
  ruled_out: [],
  unknowns: [],
  next_action: "Roll back the change in the Trust Ledger, play one more session, and compare — that isolates it.",
  next_action_rec_id: REC_ID,
  confounded: false,
  gap_days: 2,
  notes: [],
  method_note: "Deterministic comparison of two recorded sessions; local records only.",
  evidence_graph: { nodes: [], edges: [] },
  comparability: {
    verdict: "comparable",
    reasons: ["Same game, same PC, same capture method, and no changed condition detected."],
    changed_context: [],
    missing_context: [],
    candidate_causes: [],
    shared_metrics: ["avg fps", "1% low"],
    confidence_limit: "high",
    allowed_conclusions: ["A measured difference can be attributed to what changed between them."],
  },
};

const row = (undo_contract?: boolean): AppliedChange => ({
  id: "chg-1",
  rec_id: REC_ID,
  rec_title: "Turn off Xbox Game Bar",
  applied_at: "2026-07-09T18:00:00Z",
  snapshot: {},
  status: "applied",
  is_still_active: true,
  active_check: "on",
  ...(undo_contract === undefined ? {} : { undo_contract }),
});

beforeEach(() => {
  harness.outcome = report;
  harness.comparison = null;
  harness.dismissed = 0;
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe("What changed? shortcut", () => {
  const mount = (c: AppliedChange, onRollback = vi.fn().mockResolvedValue(undefined)) =>
    render(
      <WhatChangedPanel
        startedAt="2026-07-10T20:00:00Z"
        activeChangeFor={(id) => (id === c.rec_id ? c : undefined)}
        onRollback={onRollback}
      />,
    );
  const btn = (el: HTMLElement) => el.querySelector<HTMLButtonElement>(".wcp-next-rollback");

  it("is disabled with the reason line when the row has no saved undo", async () => {
    const onRollback = vi.fn().mockResolvedValue(undefined);
    const { container } = mount(row(false), onRollback);
    await waitFor(() => expect(btn(container)).toBeTruthy());
    expect(btn(container)!.disabled).toBe(true);
    expect(container.querySelector(".wcp-next-noundo")?.textContent).toBe(REASON);
    fireEvent.click(btn(container)!);
    expect(onRollback).not.toHaveBeenCalled();
  });

  it("stays enabled, with no reason line, for a row with an undo (or an older payload that didn't say)", async () => {
    for (const c of [row(true), row()]) {
      const { container, unmount } = mount(c);
      await waitFor(() => expect(btn(container)).toBeTruthy());
      expect(btn(container)!.disabled).toBe(false);
      expect(container.querySelector(".wcp-next-noundo")).toBeNull();
      unmount();
    }
  });
});

const debriefSession: SessionSummary = {
  started_at: "2026-07-10T20:00:00Z",
  duration_secs: 5400,
  process_name: "Valorant",
  samples: 900,
  avg_fps: 142.4,
  avg_frametime_ms: 7.0,
  low1_fps_est: 118.2,
  peak_gpu_temp_c: 71,
  peak_gpu_usage_pct: 98,
  peak_ram_used_bytes: null,
  ram_total_bytes: null,
  compy_changes_active: 2,
  stutter_insight: null,
};

const cmp: ComparisonResult = {
  rec_id: REC_ID,
  rec_title: "Turn off Xbox Game Bar",
  game: "Valorant",
  baseline_avg_fps: 240.2,
  baseline_low1_fps: 101.4,
  after_avg_fps: 238.1,
  after_low1_fps: 92.1,
  delta_avg_pct: -0.9,
  delta_low1_pct: -9.2,
  noise_floor_pct: 3.0,
  verdict: "regressed",
};

describe("debrief's Revert it", () => {
  const mount = (c: AppliedChange, rollback = vi.fn().mockResolvedValue(true)) =>
    render(
      <ConfirmProvider>
        <SessionDebrief
          s={debriefSession}
          priorities={null}
          recs={[]}
          apply={vi.fn()}
          busyId={null}
          onExport={vi.fn()}
          changes={[c]}
          rollback={rollback}
        />
      </ConfirmProvider>,
    );
  const revert = (el: HTMLElement) =>
    Array.from(el.querySelectorAll<HTMLButtonElement>(".cmp-actions button")).find((b) =>
      b.textContent?.startsWith("Revert it"),
    );

  it("is disabled with the reason line when the change it would undo has no saved undo", async () => {
    harness.comparison = cmp;
    const rollback = vi.fn().mockResolvedValue(true);
    const { container } = mount(row(false), rollback);
    await waitFor(() => expect(revert(container)).toBeTruthy());
    expect(revert(container)!.disabled).toBe(true);
    expect(container.querySelector(".cmp-noundo")?.textContent).toBe(REASON);
    fireEvent.click(revert(container)!);
    expect(rollback).not.toHaveBeenCalled();
  });

  // CR-debrief-no-undo-dismiss (s33 opus SHOULD-FIX): no saved undo, a non-improved result and no
  // next suspect left only the disabled "Revert it", so the card could never be cleared.
  it("offers a Dismiss that clears the card and undoes nothing when Revert it can't run", async () => {
    harness.comparison = cmp;
    const rollback = vi.fn().mockResolvedValue(true);
    const { container } = mount(row(false), rollback);
    await waitFor(() => expect(revert(container)).toBeTruthy());
    const dismiss = container.querySelector<HTMLButtonElement>('[data-testid="cmp-dismiss"]');
    expect(dismiss?.textContent).toBe("Dismiss");
    expect(dismiss!.disabled).toBe(false);
    fireEvent.click(dismiss!);
    await waitFor(() => expect(container.querySelector('[data-testid="cmp-card"]')).toBeNull());
    expect(harness.dismissed).toBe(1);
    expect(rollback).not.toHaveBeenCalled();
  });

  it("shows no extra Dismiss when Revert it can run", async () => {
    harness.comparison = cmp;
    const { container } = mount(row(true));
    await waitFor(() => expect(revert(container)).toBeTruthy());
    expect(container.querySelector('[data-testid="cmp-dismiss"]')).toBeNull();
  });

  it("stays enabled, with no reason line, when the change has an undo", async () => {
    harness.comparison = cmp;
    const { container } = mount(row(true));
    await waitFor(() => expect(revert(container)).toBeTruthy());
    expect(revert(container)!.disabled).toBe(false);
    expect(container.querySelector(".cmp-noundo")).toBeNull();
  });
});

describe("details sheet's Roll back", () => {
  const mount = (noUndo: boolean | undefined, onRollback = vi.fn()) =>
    render(
      <ActionDetailsSheet
        rec={{ id: REC_ID, title: "Turn off Xbox Game Bar" }}
        applied
        busy={false}
        noUndo={noUndo}
        onApply={vi.fn()}
        onRollback={onRollback}
        onClose={vi.fn()}
      />,
    );
  const btn = () => document.querySelector<HTMLButtonElement>(".ad-rollback");

  it("is disabled with the reason line for a change with no saved undo", () => {
    const onRollback = vi.fn();
    mount(true, onRollback);
    expect(btn()!.disabled).toBe(true);
    expect(document.querySelector(".ad-noundo")?.textContent).toBe(REASON);
    fireEvent.click(btn()!);
    expect(onRollback).not.toHaveBeenCalled();
  });

  it("stays enabled without the prop (every existing caller) and with an undo", () => {
    for (const v of [undefined, false]) {
      const { unmount } = mount(v);
      expect(btn()!.disabled).toBe(false);
      expect(document.querySelector(".ad-noundo")).toBeNull();
      unmount();
    }
  });
});
