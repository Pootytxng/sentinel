// compy_intelligence guards (Intelligence Phase 1, spec 2026-07-16-intelligence-foundation-train1,
// decision 7). The flag ships DEFAULT ON (graduated-flag convention); "0" is the devtools failsafe
// and must restore the prior tree byte-identically — AND must never even invoke the read-only
// intelligence IPC (flag off = zero fetches, not just zero pixels). Pins:
//   • WhatChangedPanel default-ON renders the engine's outcome verbatim (unavailable reason /
//     report headline + §7 language), "0" renders NOTHING and never calls what_changed_for_session.
//   • BlackbookV2 default-ON fetches the timeline ONCE, tapes only scope-"observed" rows (decision
//     15 non-duplication), "0" never calls get_intelligence_timeline and the tape is byte-identical
//     to an ON mount with nothing observed (the flag can only ever ADD observed rows).
// use-hud.ts's useIntelligenceFlag comment names this file as its pin — keep the name in sync.
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { WhatChangedPanel } from "./WhatChangedPanel";
import { BlackbookV2 } from "./BlackbookV2";
import type {
  WhatChangedOutcome,
  IntelSessionRef,
  IntelHypothesis,
  IntelligenceTimeline,
  IntelEvent,
} from "../types";

// Mutable harness: each test sets the engine's answer; every invoke is recorded so the
// flag-off pins can assert the IPC was never made (not merely that nothing rendered).
const harness = vi.hoisted(() => ({
  calls: [] as { cmd: string; args: unknown }[],
  outcome: null as unknown,
  timeline: null as unknown,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string, args?: unknown) => {
    harness.calls.push({ cmd, args });
    if (cmd === "what_changed_for_session") return Promise.resolve(harness.outcome);
    if (cmd === "get_intelligence_timeline") return Promise.resolve(harness.timeline);
    return Promise.resolve(null);
  },
}));
// Learn is the audited heavy surface (its own suites cover it) — stubbed to a marker so the
// BlackbookV2 mounts are deterministic and the assertions are purely about the flag branch.
vi.mock("./Learn", () => ({ default: () => <div data-testid="learn-stub" /> }));

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

const emptyTimeline: IntelligenceTimeline = {
  events: [],
  dropped_unparseable: 0,
  generated_at: "2026-07-10T00:00:00Z",
};

beforeEach(() => {
  harness.calls = [];
  harness.outcome = null;
  harness.timeline = emptyTimeline;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

const calledCmds = () => harness.calls.map((c) => c.cmd);
// Let any pending (possibly rejected) invoke promises settle before asserting absence.
const settle = () => new Promise((r) => setTimeout(r, 0));

// ───────────────────────────── WhatChangedPanel fixtures ─────────────────────────────

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

const leader: IntelHypothesis = {
  id: "gpu-driver-change",
  title: "GPU driver updated",
  confidence: "medium",
  supporting_evidence: ["GPU driver changed: 24.10.1 → 25.1.1 between these sessions."],
  contradicting_evidence: [],
  missing_evidence: [],
  next_test: null,
};

const report: WhatChangedOutcome = {
  kind: "report",
  baseline: sref("2026-07-08T20:00:00Z", 92.1),
  current: sref("2026-07-10T20:00:00Z", 101.4),
  game: "Valorant",
  verdict: "improved",
  headline:
    "1% lows improved 10.1% vs your previous Valorant session. Most likely: GPU driver updated (medium confidence).",
  observations: [],
  noise_floor_pct: 3.0,
  events_between: [],
  leading_hypotheses: [leader],
  ruled_out: [],
  unknowns: [],
  next_action:
    "Play one more Valorant session with nothing else changed — if the gain holds, the driver is the likely cause.",
  confounded: false,
  gap_days: 2,
  notes: [],
  method_note: "Deterministic comparison of two recorded sessions; local records only.",
  evidence_graph: { nodes: [], edges: [] },
  // Task F/G — a driver change keeps the sessions comparable while flagging the driver as the first
  // candidate to check (comparability.rs derive), so this fixture renders the "Directly comparable"
  // banner with a candidate cause, not a limit.
  comparability: {
    verdict: "comparable",
    reasons: ["Same game, same PC, same capture method, and no changed condition detected."],
    changed_context: ["GPU driver: 24.10.1 → 25.1.1"],
    missing_context: [],
    candidate_causes: [
      "The GPU driver changed (24.10.1 → 25.1.1) — a candidate explanation to check first, not a proven cause.",
    ],
    shared_metrics: ["avg fps", "1% low"],
    confidence_limit: "high",
    allowed_conclusions: [
      "These sessions are directly comparable — same game, same PC, same capture method.",
      "A measured difference can be attributed to what changed between them.",
    ],
  },
};

// A not-comparable report: the sessions ran on different hardware, so the comparability banner
// (its reasons + changed_context) is the SOLE owner of the "why". Even though this fixture
// deliberately carries a non-empty leading_hypotheses (a hostile producer that DID push a cause),
// the surface must refuse to render a "Most likely cause" card — otherwise it would triple-state
// the hardware break the banner already carries. Guards the WhatChangedReportView showLeader
// invariant against a future backend regression (the current backend leaves this empty).
const notComparableReport: WhatChangedOutcome = {
  ...report,
  verdict: "inconclusive",
  headline:
    "These sessions ran on different hardware setups — not an apples-to-apples comparison.",
  confounded: false,
  // Hostile input: a cause is present in the data; the surface must still suppress it.
  leading_hypotheses: [{ ...leader, id: "hardware-change", title: "Hardware changed" }],
  next_action: "Compare sessions recorded on the same hardware setup.",
  comparability: {
    verdict: "not-comparable",
    reasons: ["These sessions ran on different hardware — a direct comparison isn't possible."],
    changed_context: ["GPU: Radeon RX 9070 XT → GeForce RTX 4070"],
    missing_context: [],
    candidate_causes: [],
    shared_metrics: ["avg fps", "1% low"],
    confidence_limit: "unknown",
    allowed_conclusions: [],
  },
};

const unavailable: WhatChangedOutcome = {
  kind: "unavailable",
  reason: "First recorded Valorant session — nothing earlier to compare against.",
};

const mountPanel = () => render(<WhatChangedPanel startedAt="2026-07-10T20:00:00Z" />);

describe("WhatChangedPanel — compy_intelligence default ON", () => {
  it('renders the "unavailable" outcome as the honest empty state, reason verbatim', async () => {
    harness.outcome = unavailable;
    const { container } = mountPanel();
    await waitFor(() => expect(container.querySelector(".wcp-unavailable")).toBeTruthy());
    expect(container.querySelector(".wcp-tag")?.textContent).toBe("What changed?");
    expect(container.textContent).toContain(
      "First recorded Valorant session — nothing earlier to compare against.",
    );
    // The invoke carries the session key camelCased (Tauri 2 arg convention) — contract pin.
    const call = harness.calls.find((c) => c.cmd === "what_changed_for_session");
    expect(call?.args).toEqual({ startedAt: "2026-07-10T20:00:00Z" });
  });

  it("renders a report: verdict class, headline verbatim, leader under 'Most likely cause', §7 disclosure", async () => {
    harness.outcome = report;
    const { container } = mountPanel();
    await waitFor(() => expect(container.querySelector(".wcp-improved")).toBeTruthy());
    expect(container.querySelector("h3.wcp-headline")?.textContent).toBe(
      "1% lows improved 10.1% vs your previous Valorant session. Most likely: GPU driver updated (medium confidence).",
    );
    expect(container.textContent).toContain("Most likely cause");
    expect(container.querySelector(".wcp-hypo-lead .wcp-hypo-conf")?.textContent).toBe(
      "medium confidence",
    );
    expect(container.textContent).toContain("Next test");
    // The working stays folded behind the §7 disclosure until asked.
    expect(container.querySelector(".wcp-detail-toggle")?.textContent).toContain(
      "Show the working",
    );
    expect(container.querySelector(".wcp-detail")).toBeNull();
  });

  it("suppresses the 'Most likely cause' card on a not-comparable report — the banner owns the why, no triple-state", async () => {
    harness.outcome = notComparableReport;
    const { container } = mountPanel();
    await waitFor(() => expect(container.querySelector(".wcp-inconclusive")).toBeTruthy());
    // The comparability banner renders and carries the hardware break...
    expect(container.querySelector(".wcp-compare")).toBeTruthy();
    // ...but the surface refuses a "Most likely cause" card even though the fixture supplied one.
    expect(container.textContent).not.toContain("Most likely cause");
    expect(container.querySelector(".wcp-hypo-lead")).toBeNull();
    // The actionable next test still shows — it's the one thing the banner doesn't express.
    expect(container.textContent).toContain("Next test");
  });
});

describe('WhatChangedPanel — compy_intelligence "0" failsafe', () => {
  it("renders NOTHING and never invokes the engine (zero fetches, not just zero pixels)", async () => {
    localStorage.setItem("compy_intelligence", "0");
    harness.outcome = report; // even a ready report must not leak through
    const { container } = mountPanel();
    await settle();
    expect(container.innerHTML).toBe("");
    expect(calledCmds()).not.toContain("what_changed_for_session");
  });
});

// ───────────────────────────── BlackbookV2 observed fetch ─────────────────────────────

const observedEvent = (over: Partial<IntelEvent> = {}): IntelEvent => ({
  id: "gpu-driver-change:2026-07-07T10:00:00Z",
  timestamp: "2026-07-07T10:00:00Z",
  event_type: "gpu-driver-change",
  source: "rig-fingerprint",
  scope: "observed",
  game: null,
  summary: "GPU driver changed: 24.10.1 → 25.1.1",
  detail: "Noticed between two Compy readings — the exact time isn't recorded, only the window.",
  observed_between: ["2026-07-06T09:00:00Z", "2026-07-07T10:00:00Z"],
  since_rolled_back: false,
  ...over,
});

// Reduced motion keeps the render deterministic for the byte-compare (no DecryptedText churn).
const useReduced = () => localStorage.setItem("compy_motion", "reduced");

const mountBlackbook = () =>
  render(<BlackbookV2 focusId={null} vendor="amd" onClose={() => {}} />);

describe("BlackbookV2 — compy_intelligence default ON tapes observed machine changes", () => {
  it("fetches the timeline and tapes the observed row, summary verbatim", async () => {
    useReduced();
    harness.timeline = { ...emptyTimeline, events: [observedEvent()] };
    const { container } = mountBlackbook();
    await waitFor(() =>
      expect(container.textContent).toContain("GPU driver changed: 24.10.1 → 25.1.1"),
    );
    expect(calledCmds()).toContain("get_intelligence_timeline");
  });

  it("tapes ONLY scope-observed events — a compy-applied event never doubles the tape (decision 15)", async () => {
    useReduced();
    harness.timeline = {
      ...emptyTimeline,
      events: [observedEvent({ scope: "compy-applied", summary: "Enabled HAGS" })],
    };
    const { container } = mountBlackbook();
    await settle();
    expect(calledCmds()).toContain("get_intelligence_timeline");
    expect(container.textContent).not.toContain("Enabled HAGS");
  });
});

describe('BlackbookV2 — compy_intelligence "0" failsafe', () => {
  it("never invokes the timeline IPC, and the tape is byte-identical to ON-with-nothing-observed", async () => {
    useReduced();
    harness.timeline = emptyTimeline;
    const on = mountBlackbook();
    await settle();
    const onHtml = on.container.innerHTML;
    expect(calledCmds()).toContain("get_intelligence_timeline");
    cleanup();

    harness.calls = [];
    localStorage.setItem("compy_motion", "reduced");
    localStorage.setItem("compy_intelligence", "0");
    const off = mountBlackbook();
    await settle();
    expect(calledCmds()).not.toContain("get_intelligence_timeline");
    expect(off.container.innerHTML).toBe(onHtml);
  });
});
