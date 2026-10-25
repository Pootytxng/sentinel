// P6-next: the Care view shows exactly ONE next step at its top (newest assessed crash record's
// next_step first, else the stutter comparison's next test), and a MEASURED payoff line under it.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";
import { BlackBox } from "./BlackBox";
import { CARE_ARRIVAL_KEY } from "./care-arrival";
import { MIN_BASELINE_SAMPLES } from "./baseline-grade";
import {
  pickCareStep,
  payoffFor,
  anchorFor,
  SHOWN_KEY,
  MIN_PAYOFF_SESSIONS,
  type StutterResult,
  type CareStep,
} from "./care-next-step";
import type { CrashIncident, SessionSummary, WhatChangedReport } from "../types";

const h = vi.hoisted(() => ({ incidents: [] as unknown[], sessions: [] as unknown[], nextAction: "" }));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: Record<string, string>) => {
    if (cmd === "get_crash_blackbox") return Promise.resolve({ incidents: h.incidents, skipped_sources: [] });
    if (cmd === "get_session_summaries") return Promise.resolve(h.sessions);
    if (cmd === "what_changed_between")
      return Promise.resolve({ kind: "report", ...report(args!.baselineStartedAt, h.nextAction || null) });
    return Promise.resolve(null);
  }),
}));

const STEADY: [number, number][] = [[0, 120], [10, 121], [20, 120], [30, 119]];
const UNEVEN: [number, number][] = [[0, 140], [10, 140], [20, 100], [30, 100]];

const inc = (when: string, o: { tag?: string; step?: string; assessed?: boolean } = {}): CrashIncident => ({
  incident_id: `id-${when}`,
  headline: `Crash at ${when}`,
  tag: o.tag ?? "App crash",
  when,
  when_display: when,
  vitals: null,
  receipt: { source: "WER", event_ids: [], faulting_app: null, faulting_module: null, code: null, detail: "" },
  assessment:
    o.assessed === false
      ? null
      : {
          consistent_with: "a GPU driver fault",
          strength: "partial",
          evidence: ["e"],
          next_step: { headline: o.step ?? `STEP ${when}`, detail: "Detail text.", reversible: true, research_only: false },
          beyond_us: false,
        },
});

const sess = (started_at: string, o: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    started_at, duration_secs: 1200, process_name: "Valorant.exe", samples: MIN_BASELINE_SAMPLES + 100,
    avg_fps: 120, avg_frametime_ms: 8.3, low1_fps_est: 80, fps_series: STEADY, ...o,
  }) as SessionSummary;

function report(baseline: string, next_action: string | null): WhatChangedReport {
  const ref = (started_at: string) => ({
    started_at, game: "Valorant", duration_secs: 1200, samples: 700, avg_fps: 120, low1_fps: 80,
    gaming_mode_active: null, hw_hash: "hw1",
  });
  return {
    baseline: ref(baseline), current: ref("x"), game: "Valorant", verdict: "regressed", headline: "H",
    observations: [], noise_floor_pct: 3, events_between: [], leading_hypotheses: [], ruled_out: [],
    unknowns: [], next_action, next_action_rec_id: null, confounded: false, gap_days: 2, notes: [],
    method_note: "", evidence_graph: { nodes: [], edges: [] },
    comparability: {
      verdict: "comparable", reasons: [], changed_context: [], missing_context: [], candidate_causes: [],
      shared_metrics: [], confidence_limit: "high", allowed_conclusions: [],
    },
  } as unknown as WhatChangedReport;
}

const stutter = (next: string | null, sessions: SessionSummary[] = []): StutterResult => ({
  report: report("2026-10-01T10:00:00Z", next), game: "Valorant", processName: "Valorant.exe", sessions,
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  h.incidents = [];
  h.sessions = [];
  h.nextAction = "";
});

describe("pickCareStep: one step, by the documented priority", () => {
  it("takes the NEWEST assessed crash record, over an older one and over the stutter test", () => {
    const s = pickCareStep(
      [inc("2026-10-10T10:00:00Z"), inc("2026-10-20T10:00:00Z"), inc("2026-10-25T10:00:00Z", { assessed: false })],
      stutter("Roll back the driver"),
    );
    expect(s?.source).toBe("incident");
    expect(s?.headline).toBe("STEP 2026-10-20T10:00:00Z");
  });
  it("falls back to the stutter comparison's next test, else nothing", () => {
    expect(pickCareStep([inc("2026-10-10T10:00:00Z", { assessed: false })], stutter("Roll back the driver"))?.headline)
      .toBe("Roll back the driver");
    expect(pickCareStep([], stutter(null))).toBeNull();
    expect(pickCareStep(null, null)).toBeNull();
  });
});

describe("payoffFor: measured recurrence or absence, never a verdict", () => {
  const now = new Date("2026-10-25T12:00:00Z");
  const anchorAt = Date.parse("2026-10-21T12:00:00Z");
  const step = pickCareStep([inc("2026-10-20T10:00:00Z", { step: "S" })], null)!;

  it("a later record of the same kind is a recurrence; another kind is not", () => {
    const all = [inc("2026-10-20T10:00:00Z"), inc("2026-10-22T10:00:00Z", { tag: "Blue screen" }), inc("2026-10-23T10:00:00Z"), inc("2026-10-24T10:00:00Z")];
    expect(payoffFor(step, { at: anchorAt, basis: "shown" }, all, [], now)).toEqual({
      kind: "came-back", count: 2, firstAt: Date.parse("2026-10-23T10:00:00Z"),
    });
  });
  it("none since: whole days counted; under a day is too soon", () => {
    const all = [inc("2026-10-20T10:00:00Z")];
    expect(payoffFor(step, { at: anchorAt, basis: "shown" }, all, [], now)).toEqual({ kind: "none-since", days: 4 });
    expect(payoffFor(step, { at: now.getTime() - 3_600_000, basis: "shown" }, all, [], now)).toEqual({ kind: "too-soon" });
  });
  it("stutter: sessions of the game since the anchor against the steady 1% low and the noise floor", () => {
    const st: CareStep = pickCareStep(null, stutter("Roll back the driver"))!;
    const a = { at: anchorAt, basis: "shown" as const };
    const before = sess("2026-10-20T10:00:00Z", { low1_fps_est: 50 });
    const ok1 = sess("2026-10-22T10:00:00Z", { low1_fps_est: 78 }); // within 3% of 80
    const ok2 = sess("2026-10-23T10:00:00Z", { low1_fps_est: 81 });
    const bad = sess("2026-10-24T10:00:00Z", { low1_fps_est: 70 });
    const other = sess("2026-10-24T11:00:00Z", { low1_fps_est: 10, process_name: "Other.exe" });
    expect(payoffFor(st, a, [], [before, ok1, ok2, bad, other], now)).toEqual({ kind: "sessions-back", bad: 1, total: 3 });
    expect(payoffFor(st, a, [], [before, ok1, ok2, other], now)).toEqual({ kind: "sessions-steady", total: 2 });
    expect(payoffFor(st, a, [], [before, ok1], now)).toEqual({ kind: "not-enough-sessions", total: 1 });
    expect(MIN_PAYOFF_SESSIONS).toBe(2);
  });
});

describe("anchorFor: taken where recordable, else first shown", () => {
  it("uses the newest 'Did this help?' answer on the same reading as 'taken'", () => {
    localStorage.setItem("compy_bb_feedback", JSON.stringify([
      { when: "w", consistent_with: "a GPU driver fault", vote: "yes", at: "2026-10-22T09:00:00Z" },
    ]));
    const step = pickCareStep([inc("2026-10-20T10:00:00Z")], null)!;
    expect(anchorFor(step)).toEqual({ at: Date.parse("2026-10-22T09:00:00Z"), basis: "taken" });
  });
  it("records the first showing once and keeps it", () => {
    const step = pickCareStep([inc("2026-10-20T10:00:00Z")], null)!;
    const first = anchorFor(step, new Date("2026-10-21T00:00:00Z"));
    expect(anchorFor(step, new Date("2026-10-24T00:00:00Z"))).toEqual(first);
    expect(first.basis).toBe("shown");
  });
});

describe("the Care view renders exactly one next step at its top", () => {
  it("after a scan, one step: the newest record's; a recurrence since it was shown is reported", async () => {
    // The step was first shown before the newest record of the same kind arrived.
    localStorage.setItem(SHOWN_KEY, JSON.stringify({ "incident|App crash|SAME": "2026-10-15T00:00:00Z" }));
    h.incidents = [inc("2026-10-10T10:00:00Z", { step: "SAME" }), inc("2026-10-20T10:00:00Z", { step: "SAME" })];
    const { container } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelectorAll(".bb-next")).toHaveLength(1));
    const box = container.querySelector(".bb-next")!;
    // At the top: before the scan button and the incident list.
    expect(container.querySelector(".bb")!.children[1]).toBe(box);
    expect(box.querySelector(".bb-next-headline")!.textContent).toBe("SAME");
    expect(box.querySelector(".bb-next-payoff")!.textContent).toMatch(/App crash came back\. 1 record since Compy first showed this step/);
  });

  it("with no assessed record, the stutter comparison's next test is the one step", async () => {
    h.sessions = [sess("2026-10-20T10:00:00Z"), sess("2026-10-24T10:00:00Z", { fps_series: UNEVEN })];
    h.nextAction = "Roll back the GPU driver in the Trust Ledger";
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    const { container } = render(<BlackBox />);
    await waitFor(() => expect(container.querySelectorAll(".bb-next")).toHaveLength(1));
    const box = container.querySelector(".bb-next")!;
    expect(box.getAttribute("data-source")).toBe("stutter");
    expect(box.querySelector(".bb-next-headline")!.textContent).toBe("Roll back the GPU driver in the Trust Ledger");
    expect(box.querySelector(".bb-next-payoff")!.textContent).toMatch(/Not enough play to tell yet/);
    expect(box.querySelector("button")).toBeNull(); // read-only
  });

  it("with neither, nothing is shown", async () => {
    h.incidents = [inc("2026-10-20T10:00:00Z", { assessed: false })];
    const { container } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelector(".bb-list")).not.toBeNull());
    expect(container.querySelector(".bb-next")).toBeNull();
  });
});

describe("payoff copy never claims a fix", () => {
  it.each(["en", "zh-CN"])("%s nextStep copy has no fixed/solved/resolved wording", (loc) => {
    const d = JSON.parse(readFileSync(join("src", "i18n", "locales", loc, "gaming.json"), "utf8"));
    const text = JSON.stringify(d.blackBox.nextStep);
    expect(text).not.toMatch(/\b(fixed|solved|resolved|cured)\b|修复|解决/i);
  });
});
