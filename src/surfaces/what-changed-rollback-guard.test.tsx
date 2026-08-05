// BACKLOG:236, Ledger half — the "What changed?" next-test line's inline rollback shortcut.
//
// WHY THIS GUARD EXISTS. The backend half (83ebfd8) added `next_action_rec_id`: the engine hands
// over a rec id ONLY where it read one still-active apply row off the Trust Ledger for the compared
// window. The sentence itself was deliberately left naming its own destination ("Roll back the
// change in the Trust Ledger, play one more session, and compare"), because the button is resolved
// against the LIVE ledger and therefore DISAPPEARS the moment the rollback lands — a sentence that
// pointed only at a button would then point at nothing. That pairing is the invariant: the shortcut
// may only ever ADD a route, never become the sole one, and it must never render pointing at a row
// that is no longer active.
//
// Owner law it satisfies ([[flags-name-it-and-fix-it-inline]], 2026-06-20): a flag names the
// specific thing it found AND carries its fix inline — no "go to another tab" dead-ends. Hence the
// button names the change ("Roll back \"…\""), rather than a bare "Roll back".
//
// The three props (activeChangeFor / onRollback / busy) are optional TOGETHER: every existing mount
// that passes none must render byte-identically to before this train.
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { WhatChangedPanel } from "./WhatChangedPanel";
import { SessionDebrief } from "./SessionDebrief";
import { ConfirmProvider } from "../design/ConfirmDialog";
import type {
  WhatChangedOutcome,
  IntelSessionRef,
  AppliedChange,
  ComparisonResult,
  SessionSummary,
} from "../types";

const harness = vi.hoisted(() => ({ outcome: null as unknown, comparison: null as unknown }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "what_changed_for_session") return Promise.resolve(harness.outcome);
    if (cmd === "get_latest_comparison") return Promise.resolve(harness.comparison);
    return Promise.resolve(null);
  },
}));

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

const REC_ID = "disable-xbox-gamebar";

// A report whose leader IS a Compy change — the only shape that carries a rec id.
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
  next_action:
    "Roll back the change in the Trust Ledger, play one more session, and compare — that isolates it.",
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

const liveRow: AppliedChange = {
  id: "chg-1",
  rec_id: REC_ID,
  rec_title: "Turn off Xbox Game Bar",
  applied_at: "2026-07-09T18:00:00Z",
  snapshot: {},
  status: "applied",
  is_still_active: true,
};

// The App-side resolver's contract, reproduced here so the guard pins the CONDITION (still-active
// applied row for this rec id), not one particular caller's implementation of it.
const resolver =
  (rows: AppliedChange[]) =>
  (recId: string): AppliedChange | undefined =>
    rows
      .slice()
      .reverse()
      .find((c) => c.rec_id === recId && c.status === "applied" && c.is_still_active);

const btn = (c: HTMLElement) => c.querySelector<HTMLButtonElement>(".wcp-next-rollback");
const nextLine = (c: HTMLElement) => c.querySelector(".wcp-next");

beforeEach(() => {
  harness.outcome = report;
  harness.comparison = null;
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe("WhatChangedPanel — next-test rollback shortcut (BACKLOG:236 Ledger half)", () => {
  it("renders the button, naming the specific change, when the id resolves to a live row", async () => {
    const { container } = render(
      <WhatChangedPanel
        startedAt="2026-07-10T20:00:00Z"
        activeChangeFor={resolver([liveRow])}
        onRollback={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    await waitFor(() => expect(nextLine(container)).toBeTruthy());
    // Names the thing it found — never a bare "Roll back".
    expect(btn(container)?.textContent).toBe('Roll back "Turn off Xbox Game Bar"');
  });

  it("hands the resolved ledger row — not the rec id — to the rollback handler", async () => {
    const onRollback = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <WhatChangedPanel
        startedAt="2026-07-10T20:00:00Z"
        activeChangeFor={resolver([liveRow])}
        onRollback={onRollback}
      />,
    );
    await waitFor(() => expect(btn(container)).toBeTruthy());
    fireEvent.click(btn(container)!);
    expect(onRollback).toHaveBeenCalledTimes(1);
    expect(onRollback.mock.calls[0][0]).toEqual(liveRow);
  });

  it("shows the busy face and refuses a second click while a rollback is in flight", async () => {
    const onRollback = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <WhatChangedPanel
        startedAt="2026-07-10T20:00:00Z"
        activeChangeFor={resolver([liveRow])}
        onRollback={onRollback}
        busy
      />,
    );
    await waitFor(() => expect(btn(container)).toBeTruthy());
    expect(btn(container)?.textContent).toBe("Rolling back…");
    expect(btn(container)?.disabled).toBe(true);
    fireEvent.click(btn(container)!);
    expect(onRollback).not.toHaveBeenCalled();
  });

  // The four ways the shortcut must stand down. In every one the sentence still renders and still
  // names the Trust Ledger itself, so the user is never left without a route.
  type PanelProps = Parameters<typeof WhatChangedPanel>[0];
  const at: PanelProps = { startedAt: "2026-07-10T20:00:00Z" };
  const standDown: [string, PanelProps][] = [
    ["no props at all (every pre-existing mount)", at],
    ["a resolver but no handler", { ...at, activeChangeFor: resolver([liveRow]) }],
    ["a handler but no resolver", { ...at, onRollback: vi.fn() }],
    [
      "the row was already rolled back (resolves to nothing)",
      {
        ...at,
        activeChangeFor: resolver([{ ...liveRow, status: "rolled_back", is_still_active: false }]),
        onRollback: vi.fn(),
      },
    ],
  ];

  it.each(standDown)("renders the sentence alone when %s", async (_name, props) => {
    const { container } = render(<WhatChangedPanel {...props} />);
    await waitFor(() => expect(nextLine(container)).toBeTruthy());
    expect(btn(container)).toBeNull();
    // The route survives without the shortcut — this is why the engine's prose names the Ledger.
    expect(nextLine(container)?.textContent).toContain("Trust Ledger");
  });

  it("stands down when the engine named no rec id, even with both props wired", async () => {
    harness.outcome = { ...report, next_action_rec_id: null };
    const { container } = render(
      <WhatChangedPanel
        startedAt="2026-07-10T20:00:00Z"
        activeChangeFor={resolver([liveRow])}
        onRollback={vi.fn()}
      />,
    );
    await waitFor(() => expect(nextLine(container)).toBeTruthy());
    expect(btn(container)).toBeNull();
  });

  it("never resolves a DIFFERENT rec's live row into this button", async () => {
    const { container } = render(
      <WhatChangedPanel
        startedAt="2026-07-10T20:00:00Z"
        activeChangeFor={resolver([{ ...liveRow, rec_id: "some-other-rec" }])}
        onRollback={vi.fn()}
      />,
    );
    await waitFor(() => expect(nextLine(container)).toBeTruthy());
    expect(btn(container)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// The composition half. A self-review caught what no isolated unit test could see: the panel is
// mounted INSIDE SessionDebrief, directly under a ComparisonCard that already owns a rollback
// control for its own rec — and in the primary flow (apply a fix here → `arm_comparison` for that
// rec → the next same-game session resolves it) the card's rec and the engine's
// `next_action_rec_id` are the SAME still-active row. Unguarded, that stacks two differently-worded
// buttons for ONE action in one card. The host resolver stands the shortcut down for exactly that
// rec — for EVERY verdict, because a `Roll back "X"` hanging under a card that just said "Keep it"
// would contradict it outright. Everywhere else the shortcut must still appear, or the suppression
// has quietly eaten the whole affordance.
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

// `game` must equal the session's process_name, else SessionDebrief drops it on arrival.
const cmp = (
  recId: string,
  verdict: ComparisonResult["verdict"] = "regressed",
): ComparisonResult => ({
  rec_id: recId,
  rec_title: "Turn off Xbox Game Bar",
  game: "Valorant",
  baseline_avg_fps: 240.2,
  baseline_low1_fps: 101.4,
  after_avg_fps: 238.1,
  after_low1_fps: 92.1,
  delta_avg_pct: -0.9,
  delta_low1_pct: -9.2,
  noise_floor_pct: 3.0,
  verdict,
});

const debriefProps = {
  s: debriefSession,
  priorities: null,
  recs: [],
  apply: vi.fn(),
  busyId: null,
  onExport: vi.fn(),
  changes: [liveRow],
  rollback: vi.fn().mockResolvedValue(undefined),
  activeChangeFor: resolver([liveRow]),
};

const mountDebrief = () =>
  render(
    <ConfirmProvider>
      <SessionDebrief {...debriefProps} />
    </ConfirmProvider>,
  );

const cardRevert = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLButtonElement>(".cmp-actions button")).find((b) =>
    b.textContent?.startsWith("Revert it"),
  );

describe("SessionDebrief — one action never gets two rollback buttons (BACKLOG:236)", () => {
  it("stands the shortcut down when the ComparisonCard already owns that rec", async () => {
    harness.comparison = cmp(REC_ID);
    const { container } = mountDebrief();
    // Wait for BOTH to have settled, or "absent" would just mean "not rendered yet".
    await waitFor(() => expect(cardRevert(container)).toBeTruthy());
    await waitFor(() => expect(nextLine(container)).toBeTruthy());
    expect(btn(container)).toBeNull();
    // Nothing is lost: the engine's own prose still routes to the Ledger.
    expect(nextLine(container)?.textContent).toContain("Trust Ledger");
  });

  it("stands down on an IMPROVED verdict too — the card says 'Keep it', so nothing may say roll back", async () => {
    harness.comparison = cmp(REC_ID, "improved");
    const { container } = mountDebrief();
    await waitFor(() => expect(container.querySelector(".cmp-actions")).toBeTruthy());
    await waitFor(() => expect(nextLine(container)).toBeTruthy());
    expect(cardRevert(container)).toBeUndefined(); // improved renders "Keep it", not "Revert it"
    expect(btn(container)).toBeNull();
  });

  it("still renders the shortcut when the card is about a DIFFERENT rec", async () => {
    harness.comparison = cmp("some-other-rec");
    const { container } = mountDebrief();
    await waitFor(() => expect(cardRevert(container)).toBeTruthy());
    await waitFor(() => expect(btn(container)).toBeTruthy());
    expect(btn(container)?.textContent).toBe('Roll back "Turn off Xbox Game Bar"');
  });

  it("still renders the shortcut when no comparison is armed at all", async () => {
    harness.comparison = null;
    const { container } = mountDebrief();
    await waitFor(() => expect(btn(container)).toBeTruthy());
    expect(container.querySelector(".cmp-actions")).toBeNull();
  });
});
