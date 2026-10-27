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
  storedStutterStep,
  dismissStoredStep,
  markFinalShown,
  STORED_STEP_END_SESSIONS,
  SHOWN_KEY,
  MIN_PAYOFF_SESSIONS,
  type StutterResult,
  type CareStep,
} from "./care-next-step";
import type { CrashIncident, SessionSummary, WhatChangedReport } from "../types";

const h = vi.hoisted(() => ({
  incidents: [] as unknown[], sessions: [] as unknown[], nextAction: "", skipped: [] as string[], verdict: "",
}));

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((cmd: string, args?: Record<string, string>) => {
    if (cmd === "get_crash_blackbox") return Promise.resolve({ incidents: h.incidents, skipped_sources: h.skipped });
    if (cmd === "get_session_summaries") return Promise.resolve(h.sessions);
    if (cmd === "what_changed_between")
      return Promise.resolve({ kind: "report", ...report(args!.baselineStartedAt, h.nextAction || null, h.verdict || "regressed") });
    return Promise.resolve(null);
  }),
}));

const STEADY: [number, number][] = [[0, 120], [10, 121], [20, 120], [30, 119]];
const UNEVEN: [number, number][] = [[0, 140], [10, 140], [20, 100], [30, 100]];

const inc = (
  when: string,
  o: { tag?: string; step?: string; detail?: string; assessed?: boolean; app?: string | null } = {},
): CrashIncident => ({
  incident_id: `id-${when}`,
  headline: `Crash at ${when}`,
  tag: o.tag ?? "App crash",
  when,
  when_display: when,
  vitals: null,
  receipt: { source: "WER", event_ids: [], faulting_app: o.app ?? null, faulting_module: null, code: null, detail: "" },
  assessment:
    o.assessed === false
      ? null
      : {
          consistent_with: "a GPU driver fault",
          strength: "partial",
          evidence: ["e"],
          next_step: { headline: o.step ?? `STEP ${when}`, detail: o.detail ?? "Detail text.", reversible: true, research_only: false },
          beyond_us: false,
        },
});

const sess = (started_at: string, o: Partial<SessionSummary> = {}): SessionSummary =>
  ({
    started_at, duration_secs: 1200, process_name: "Valorant.exe", samples: MIN_BASELINE_SAMPLES + 100,
    avg_fps: 120, avg_frametime_ms: 8.3, low1_fps_est: 80, fps_series: STEADY, ...o,
  }) as SessionSummary;

function report(
  baseline: string,
  next_action: string | null,
  verdict = "regressed",
  comparable = "comparable",
): WhatChangedReport {
  const ref = (started_at: string) => ({
    started_at, game: "Valorant", duration_secs: 1200, samples: 700, avg_fps: 120, low1_fps: 80,
    gaming_mode_active: null, hw_hash: "hw1",
  });
  return {
    baseline: ref(baseline), current: ref("x"), game: "Valorant", verdict, headline: "H",
    observations: [], noise_floor_pct: 3, events_between: [], leading_hypotheses: [], ruled_out: [],
    unknowns: [], next_action, next_action_rec_id: null, confounded: false, gap_days: 2, notes: [],
    method_note: "", evidence_graph: { nodes: [], edges: [] },
    comparability: {
      verdict: comparable, reasons: [], changed_context: [], missing_context: [], candidate_causes: [],
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
  h.skipped = [];
  h.verdict = "";
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
  it("takes the stutter test only when the report measured a regression on a comparable pair", () => {
    const st = (verdict: string, comp: string): StutterResult => ({
      ...stutter("Roll back the driver"), report: report("b", "Roll back the driver", verdict, comp),
    });
    expect(pickCareStep(null, st("regressed", "partial"))?.source).toBe("stutter");
    expect(pickCareStep(null, st("no-change", "comparable"))).toBeNull();
    expect(pickCareStep(null, st("inconclusive", "comparable"))).toBeNull();
    expect(pickCareStep(null, st("regressed", "not-comparable"))).toBeNull();
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
  it("App crash / App hang also match the faulting app, case-insensitive", () => {
    const appStep = pickCareStep([inc("2026-10-20T10:00:00Z", { app: "Game.exe" })], null)!;
    const all = [
      inc("2026-10-22T10:00:00Z", { app: "Other.exe" }),
      inc("2026-10-23T10:00:00Z", { app: "GAME.EXE" }),
    ];
    expect(payoffFor(appStep, { at: anchorAt, basis: "shown" }, all, [], now)).toEqual({
      kind: "came-back", count: 1, firstAt: Date.parse("2026-10-23T10:00:00Z"),
    });
    expect(payoffFor(appStep, { at: anchorAt, basis: "shown" }, [all[0]], [], now).kind).toBe("none-since");
  });
  it("a skipped source qualifies the absence instead of claiming it", () => {
    const all = [inc("2026-10-20T10:00:00Z")];
    expect(payoffFor(step, { at: anchorAt, basis: "shown" }, all, [], now, true)).toEqual({
      kind: "none-since-partial", days: 4,
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
    // Short sessions and another rig (gpu, ram or display) are not counted; a driver update
    // (new hash, same gpu/ram/display) is the same rig.
    const onRig = { ...st, baseline: { ...(st as Extract<CareStep, { source: "stutter" }>).baseline, rig: { gpu: "GPU A", ram_gb: 16, display: "" } } } as CareStep;
    const short = sess("2026-10-24T10:00:00Z", { low1_fps_est: 10, samples: MIN_BASELINE_SAMPLES - 1 });
    const rig = sess("2026-10-24T12:00:00Z", { low1_fps_est: 10, hw_fingerprint: { hash: "hw2", gpu: "GPU B", gpu_driver: "", ram_gb: 16, display: "" } });
    const driver = sess("2026-10-24T13:00:00Z", { low1_fps_est: 79, hw_fingerprint: { hash: "hw9", gpu: "GPU A", gpu_driver: "new", ram_gb: 16, display: "" } });
    expect(payoffFor(onRig, a, [], [ok1, short, rig, driver], now)).toEqual({ kind: "sessions-steady", total: 2 });
  });
  it("stutter: later reads measure against the baseline STORED at first show", () => {
    const first = pickCareStep(null, stutter("Roll back the driver"))!;
    const anchor1 = anchorFor(first, [], new Date("2026-10-21T00:00:00Z"));
    // A later comparison picks a different steady session with a lower 1% low.
    const later: StutterResult = { ...stutter("Roll back the driver") };
    later.report = { ...later.report, baseline: { ...later.report.baseline, low1_fps: 40, started_at: "z" } };
    const again = pickCareStep(null, later)!;
    const anchor2 = anchorFor(again, [], new Date("2026-10-24T00:00:00Z"));
    expect(anchor2.at).toBe(anchor1.at);
    expect(anchor2.baseline?.low1).toBe(80);
    const s70 = sess("2026-10-22T10:00:00Z", { low1_fps_est: 70 });
    expect(payoffFor(again, anchor2, [], [s70], now).kind).toBe("sessions-back");
  });
});

describe("anchorFor: taken where recordable, else first shown", () => {
  it("uses the newest 'Did this help?' answer on the same reading as 'taken'", () => {
    localStorage.setItem("compy_bb_feedback", JSON.stringify([
      { when: "2026-10-20T10:00:00Z", consistent_with: "a GPU driver fault", vote: "yes", at: "2026-10-22T09:00:00Z" },
    ]));
    const all = [inc("2026-10-20T10:00:00Z")];
    const step = pickCareStep(all, null)!;
    expect(anchorFor(step, all)).toEqual({ at: Date.parse("2026-10-22T09:00:00Z"), basis: "taken" });
  });
  it("an answer on a record of another kind is not 'taken' for this step", () => {
    localStorage.setItem("compy_bb_feedback", JSON.stringify([
      { when: "2026-10-18T10:00:00Z", consistent_with: "a GPU driver fault", vote: "yes", at: "2026-10-22T09:00:00Z" },
    ]));
    const all = [inc("2026-10-18T10:00:00Z", { tag: "Blue screen" }), inc("2026-10-20T10:00:00Z")];
    const step = pickCareStep(all, null)!;
    expect(anchorFor(step, all).basis).toBe("shown");
  });
  it("records the first showing once and keeps it", () => {
    const step = pickCareStep([inc("2026-10-20T10:00:00Z")], null)!;
    const first = anchorFor(step, [], new Date("2026-10-21T00:00:00Z"));
    expect(anchorFor(step, [], new Date("2026-10-24T00:00:00Z"))).toEqual(first);
    expect(first.basis).toBe("shown");
  });
});

describe("the Care view renders exactly one next step at its top", () => {
  it("after a scan, one step: the newest record's; a recurrence since it was shown is reported", async () => {
    // The step was first shown before the newest record of the same kind arrived.
    localStorage.setItem(SHOWN_KEY, JSON.stringify({ "incident|App crash||SAME|Detail text.": "2026-10-15T00:00:00Z" }));
    h.incidents = [inc("2026-10-10T10:00:00Z", { step: "SAME" }), inc("2026-10-20T10:00:00Z", { step: "SAME" })];
    const { container } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelectorAll(".bb-next")).toHaveLength(1));
    const box = container.querySelector(".bb-next")!;
    // At the top: before the scan button and the incident list.
    expect(container.querySelector(".bb")!.children[1]).toBe(box);
    expect(box.querySelector(".bb-next-headline")!.textContent).toBe("SAME");
    expect(box.querySelector(".bb-next-payoff")!.textContent).toMatch(
      /Compy has tracked this step since .*App crash came back\. 1 record since then/,
    );
    // Exactly once on screen: the record points to the top instead of repeating it.
    expect(container.textContent!.split("SAME").length - 1).toBe(1);
    expect(screen.getAllByText("Shown as your next step above.")).toHaveLength(2); // both records carry it
  });

  it("a scan that skipped a source never claims a full absence", async () => {
    localStorage.setItem(SHOWN_KEY, JSON.stringify({ "incident|App crash||ONLY|Detail text.": "2026-10-01T00:00:00Z" }));
    h.incidents = [inc("2026-09-30T10:00:00Z", { step: "ONLY" })];
    h.skipped = ["System log"];
    const { container } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelector(".bb-next")).not.toBeNull());
    const text = container.querySelector(".bb-next-payoff")!.textContent!;
    expect(text).toMatch(/not a full count/);
    expect(text).not.toMatch(/measured absence/);
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
    // The report below does not repeat the next test.
    expect(container.textContent!.split("Roll back the GPU driver in the Trust Ledger").length - 1).toBe(1);
  });

  it("with neither, no step is shown: the honest end takes the slot (P6-unknown)", async () => {
    h.incidents = [inc("2026-10-20T10:00:00Z", { assessed: false })];
    const { container } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelector(".bb-list")).not.toBeNull());
    expect(container.querySelector(".bb-next")).toBeNull();
    expect(container.querySelector(".bb-honest-unknown")!.textContent).toMatch(/Not enough evidence yet/);
  });
});

describe("P6-next r2: separate steps stay separate; App crash / hang name the app", () => {
  it("a record with the same headline but a different detail keeps its own block", async () => {
    h.incidents = [
      inc("2026-10-10T10:00:00Z", { step: "Check the driver", detail: "Stop code A." }),
      inc("2026-10-20T10:00:00Z", { step: "Check the driver", detail: "Stop code B." }),
    ];
    const { container } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelector(".bb-next")).not.toBeNull());
    // P7-depth: the detail is the step's own instruction (it carries the stop code): ANSWER layer, no tap.
    expect(container.querySelector(".bb-next-detail")!.textContent).toBe("Stop code B.");
    expect(screen.getAllByText("Shown as your next step above.")).toHaveLength(1);
    const own = container.querySelectorAll(".bb-list .bb-nextstep-detail");
    expect([...own].map((e) => e.textContent)).toEqual(["Stop code A."]);
    // And the two keys (so the two anchors) differ.
    const a = pickCareStep([h.incidents[0] as CrashIncident], null)!;
    const b = pickCareStep([h.incidents[1] as CrashIncident], null)!;
    expect(a.key).not.toBe(b.key);
  });

  it("names the faulting app for an App crash recurrence, and for an App hang absence", async () => {
    localStorage.setItem(SHOWN_KEY, JSON.stringify({ "incident|App crash|valorant.exe|S|Detail text.": "2026-10-15T00:00:00Z" }));
    h.incidents = [inc("2026-10-20T10:00:00Z", { step: "S", app: "Valorant.exe" })];
    const { container } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelector(".bb-next")).not.toBeNull());
    expect(container.querySelector(".bb-next-payoff")!.textContent).toMatch(/Valorant\.exe crashed again\. 1 record since then/);
    cleanup();

    localStorage.setItem(SHOWN_KEY, JSON.stringify({ "incident|App hang|game.exe|H|Detail text.": "2026-10-01T00:00:00Z" }));
    h.incidents = [inc("2026-09-30T10:00:00Z", { step: "H", tag: "App hang", app: "Game.exe" })];
    const r2 = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(r2.container.querySelector(".bb-next")).not.toBeNull());
    expect(r2.container.querySelector(".bb-next-payoff")!.textContent).toMatch(/No Game\.exe hang recorded in the \d+ days since/);
  });

  it("without a named app the kind-only line stays", () => {
    const st = pickCareStep([inc("2026-10-20T10:00:00Z")], null)!;
    expect(st.source === "incident" && st.appLabel).toBeNull();
  });
});

describe("payoff copy never claims a fix", () => {
  it.each(["en", "zh-CN"])("%s nextStep copy has no fixed/solved/resolved wording", (loc) => {
    const d = JSON.parse(readFileSync(join("src", "i18n", "locales", loc, "gaming.json"), "utf8"));
    const text = JSON.stringify(d.blackBox.nextStep);
    expect(text).not.toMatch(/\b(fixed|solved|resolved|cured)\b|修复|解决/i);
  });
});

// P6-next-f2: a stutter step shown once stays the step (with its payoff) while its stored anchor
// lives, so "stayed within" can show after good sessions. It ends, or is retired, honestly.
describe("P6-next-f2: the stored stutter step outlives a good session", () => {
  const KEY = "stutter|valorant.exe|Roll back the GPU driver";
  const base = { low1: 80, noiseFloorPct: 3, startedAt: "2026-10-20T10:00:00Z", hwHash: "hw1" };
  const store = (extra: Record<string, unknown> = {}) =>
    localStorage.setItem(SHOWN_KEY, JSON.stringify({ [KEY]: { at: "2026-10-21T00:00:00Z", baseline: base }, ...extra }));
  const entry = (k = KEY) => JSON.parse(localStorage.getItem(SHOWN_KEY)!)[k];
  const fp = (hash: string, gpu = "") => ({ hash, gpu, gpu_driver: "", ram_gb: 16, display: "" });
  const good = (n: number) =>
    Array.from({ length: n }, (_, i) => sess(`2026-10-${String(22 + i).padStart(2, "0")}T10:00:00Z`));
  const notRegressed = (sessions: SessionSummary[], game = "Valorant.exe"): StutterResult => ({
    report: report("2026-10-20T10:00:00Z", null, "no-change"), game: "Valorant", processName: game, sessions,
  });

  it("after good sessions the stored step still shows, with a hedged 'stayed within' payoff", async () => {
    store();
    h.sessions = [sess("2026-10-20T10:00:00Z"), ...good(2)];
    h.verdict = "no-change";
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    const { container } = render(<BlackBox />);
    await waitFor(() => expect(container.querySelectorAll(".bb-next")).toHaveLength(1));
    const box = container.querySelector(".bb-next")!;
    expect(box.getAttribute("data-source")).toBe("stutter");
    expect(box.querySelector(".bb-next-headline")!.textContent).toBe("Roll back the GPU driver");
    // P7-depth: the "from" line is the EXPLANATION layer; the payoff stays in the answer. The block
    // can re-render once more after the anchor read settles, so query the live tree, never `box`.
    fireEvent.click(container.querySelector('[data-testid="bb-next-depth-why"] > summary')!);
    await waitFor(() => expect(container.querySelector(".bb-next-from")).not.toBeNull());
    expect(container.querySelector(".bb-next-from")!.textContent).toMatch(/From an earlier Valorant session comparison/);
    // Review MUST-FIX 2: a stored step's why says "an earlier comparison", never "the latest".
    expect(container.querySelector(".bb-next-why")!.textContent).toMatch(/from an earlier Valorant session comparison/);
    expect(container.querySelector(".bb-next-why")!.textContent).not.toMatch(/latest/);
    const pay = container.querySelector(".bb-next-payoff")!;
    expect(pay.className).toContain("bb-next-payoff-sessions-steady");
    expect(pay.textContent).toMatch(/In the 2 Valorant sessions since then, the 1% low stayed within 3%.*not proof/);
    // The user can stop tracking it: it is retired and the slot no longer shows it.
    fireEvent.click(screen.getByRole("button", { name: "Stop tracking this step" }));
    await waitFor(() => expect(container.querySelector(".bb-next")).toBeNull());
    expect(entry().retired).toBe("dismissed");
  });

  it("is only for its own game, and never over an assessed crash record", () => {
    store();
    expect(storedStutterStep(notRegressed(good(2), "Other.exe"))).toBeNull();
    const st = storedStutterStep(notRegressed(good(2)));
    expect(st).toMatchObject({ source: "stutter", stored: true, headline: "Roll back the GPU driver" });
    expect(pickCareStep([inc("2026-10-24T10:00:00Z")], notRegressed(good(2)), st)?.source).toBe("incident");
    expect(pickCareStep(null, notRegressed(good(2)), st)?.key).toBe(KEY);
  });

  it("ends after STORED_STEP_END_SESSIONS steady sessions (the comparison's own look-back)", () => {
    expect(STORED_STEP_END_SESSIONS).toBe(5);
    store();
    const five = storedStutterStep(notRegressed(good(5)))!;
    expect(payoffFor(five, anchorFor(five), [], good(5))).toEqual({ kind: "sessions-steady", total: 5 });
    expect(five.source === "stutter" && five.final).toBeFalsy();
    // Past the end: the final read is offered (and keeps being offered) until a view SHOWS it...
    expect(storedStutterStep(notRegressed(good(6)), undefined, "v1")).toMatchObject({ stored: true, final: true });
    expect(storedStutterStep(notRegressed(good(6)), undefined, "v2")).toMatchObject({ final: true });
    expect(entry().retired).toBeUndefined();
    expect(entry().finalView).toBeUndefined();
    // ...the view that renders it says so (BlackBox, once pickCareStep chose it)...
    markFinalShown(KEY, "v1");
    expect(entry().finalView).toBe("v1");
    expect(storedStutterStep(notRegressed(good(6)), undefined, "v1")).toMatchObject({ final: true });
    // ...and the step retires in the next Care view.
    expect(storedStutterStep(notRegressed(good(6)), undefined, "v2")).toBeNull();
    expect(entry().retired).toBe("ended");
    // Ended for good: fewer sessions on a later read do not bring it back.
    expect(storedStutterStep(notRegressed(good(2)))).toBeNull();
  });

  it("is retired when the rig changes", () => {
    store();
    const steady = sess("2026-10-20T10:00:00Z", { hw_fingerprint: fp("hw1", "GPU A") });
    // A driver update (new hash, same gpu/ram/display) is not a rig change.
    expect(storedStutterStep(notRegressed([steady, ...good(2), sess("2026-10-25T10:00:00Z", { hw_fingerprint: fp("hw9", "GPU A") })]))).not.toBeNull();
    expect(entry().retired).toBeUndefined();
    expect(storedStutterStep(notRegressed([steady, ...good(2), sess("2026-10-25T10:00:00Z", { hw_fingerprint: fp("hw2", "GPU B") })]))).toBeNull();
    expect(entry().retired).toBe("rig");
  });

  it("is retired when a new regressed step for another cause is shown, which then stays itself", () => {
    store();
    const fresh = pickCareStep(null, stutter("Turn off the overlay"), storedStutterStep(stutter("Turn off the overlay")))!;
    expect(fresh).toMatchObject({ stored: false, headline: "Turn off the overlay" });
    anchorFor(fresh, [], new Date("2026-10-24T00:00:00Z"));
    expect(entry().retired).toBe("replaced");
    expect(storedStutterStep(notRegressed(good(2)))?.headline).toBe("Turn off the overlay");
  });

  // Follow-up review 2026-10-26 §4 (two Care lifecycle defects). Both fail on the code before the fix.
  it("the same advice judged on different hardware is a fresh step: the old rig's baseline is not reused", () => {
    // Stored: judged on GPU A. Now: the same headline, judged on GPU B.
    localStorage.setItem(SHOWN_KEY, JSON.stringify({ [KEY]: { at: "2026-10-21T00:00:00Z", baseline: { ...base, rig: { gpu: "GPU A", ram_gb: 16, display: "" } } } }));
    const steadyB = sess("2026-10-26T10:00:00Z", { low1_fps_est: 50, hw_fingerprint: fp("hw2", "GPU B") });
    const onB: StutterResult = { ...stutter("Roll back the GPU driver", [steadyB]), report: report(steadyB.started_at, "Roll back the GPU driver", "regressed") };
    const step = pickCareStep(null, onB)!;
    expect(step).toMatchObject({ source: "stutter", key: KEY, baseline: { rig: { gpu: "GPU B" } } });
    const a = anchorFor(step, [], new Date("2026-10-27T00:00:00Z"));
    // Anchored now, against GPU B's own numbers; the GPU A entry is retired as a rig change.
    expect(a.at).toBe(Date.parse("2026-10-27T00:00:00Z"));
    expect(a.baseline).toMatchObject({ startedAt: steadyB.started_at, rig: { gpu: "GPU B" } });
    expect(entry().retired).toBeUndefined(); // re-inserted fresh under the same key
    expect(entry().baseline.rig.gpu).toBe("GPU B");
    // A driver update alone (same gpu/ram/display, new hash) keeps the anchor.
    localStorage.setItem(SHOWN_KEY, JSON.stringify({ [KEY]: { at: "2026-10-21T00:00:00Z", baseline: { ...base, rig: { gpu: "GPU B", ram_gb: 16, display: "" } } } }));
    expect(anchorFor(step, [], new Date("2026-10-27T00:00:00Z")).at).toBe(Date.parse("2026-10-21T00:00:00Z"));
  });

  it("a final read hidden behind a crash card is not 'shown': the step survives to the next view", async () => {
    store();
    h.sessions = [sess("2026-10-20T10:00:00Z"), ...good(6)];
    h.verdict = "no-change";
    // A crash record with a step wins the pick; the stutter step's final read is prepared but not rendered.
    h.incidents = [inc("2026-10-28T10:00:00Z")];
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    const { container, unmount } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelector(".bb-next")?.getAttribute("data-source")).toBe("incident"));
    // The stutter step's final read was prepared (6 steady sessions) but a crash card is what shows.
    expect(entry().finalView).toBeUndefined();
    expect(entry().retired).toBeUndefined();
    unmount();
    // The next view, with the crash gone: the final read shows, and only now counts as shown.
    h.incidents = [];
    localStorage.setItem(CARE_ARRIVAL_KEY, "stutter");
    const second = render(<BlackBox />);
    await waitFor(() => expect(second.container.querySelector(".bb-next")?.getAttribute("data-source")).toBe("stutter"));
    await waitFor(() => expect(entry().finalView).toBeDefined());
    fireEvent.click(second.container.querySelector('[data-testid="bb-next-depth-why"] > summary')!);
    expect(second.container.querySelector(".bb-next-final")).not.toBeNull();
    expect(entry().retired).toBeUndefined();
  });

  it("a retired step that regresses again starts a fresh anchor; dismiss without storage is harmless", () => {
    store();
    dismissStoredStep(KEY);
    const again = pickCareStep(null, stutter("Roll back the GPU driver"))!;
    const a = anchorFor(again, [], new Date("2026-10-26T00:00:00Z"));
    expect(a.at).toBe(Date.parse("2026-10-26T00:00:00Z"));
    expect(entry().retired).toBeUndefined();
    localStorage.clear();
    expect(() => dismissStoredStep(KEY)).not.toThrow();
  });
});

// P7-depth (Constitution §13): the step is ONE truth at three depths. The receipt shows the exact
// fields the step and its payoff were computed from, verbatim, and never a blank field.
describe("P7-depth: the next step's technical receipt", () => {
  it("an incident step: answer first; the receipt lists the record's exact fields, nothing invented", async () => {
    h.incidents = [inc("2026-10-20T10:00:00Z", { step: "Check the driver", detail: "Stop code B.", app: "Valorant.exe" })];
    const { container } = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(container.querySelector(".bb-next")).not.toBeNull());
    const box = container.querySelector(".bb-next")!;
    // The answer carries the headline and the payoff; the receipt is closed.
    expect(box.querySelector(".bb-next-headline")!.textContent).toBe("Check the driver");
    expect(box.querySelector(".bb-next-payoff")).not.toBeNull();
    expect(box.querySelector(".bb-next-receipt")).toBeNull();
    fireEvent.click(box.querySelector('[data-testid="bb-next-depth-receipt"] > summary')!);
    const dl = box.querySelector(".bb-next-receipt")!;
    const rows = Object.fromEntries([...dl.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]));
    expect(rows).toMatchObject({
      Source: "crash record",
      Kind: "App crash",
      "Faulting app": "Valorant.exe",
      Record: "id-2026-10-20T10:00:00Z",
      Recorded: "2026-10-20T10:00:00Z",
      "Consistent with": "a GPU driver fault",
      Research: "no",
    });
    expect(rows["Tracked since"]).toMatch(/^\d{4}-\d{2}-\d{2}T.*\((shown|answered)\)$/);
    expect(rows["Step id"]).toBeTruthy();
    // No blank value anywhere in the receipt.
    expect([...dl.querySelectorAll("dd")].every((dd) => dd.textContent!.trim() !== "")).toBe(true);
    // The explanation says why, in plain words, and names the kind.
    fireEvent.click(box.querySelector('[data-testid="bb-next-depth-why"] > summary')!);
    expect(box.querySelector(".bb-next-why")!.textContent).toMatch(/newest crash record is tagged App crash/);
    expect(box.querySelector(".bb-next-why")!.textContent).toMatch(/safe first thing to check/);
  });

  // Review of this slice, MUST-FIX 1: the why never says "safe first thing to check" for a step the
  // answer tags as worth researching or beyond Compy.
  it("a research step and a beyond step explain themselves as that, never as the safe first check", async () => {
    const research = inc("2026-10-20T10:00:00Z", { step: "Look into the driver timeout" });
    research.assessment!.next_step.research_only = true;
    h.incidents = [research];
    const first = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(first.container.querySelector(".bb-next")).not.toBeNull());
    fireEvent.click(first.container.querySelector('[data-testid="bb-next-depth-why"] > summary')!);
    expect(first.container.querySelector(".bb-next-why")!.textContent).toMatch(/lead worth researching/);
    expect(first.container.querySelector(".bb-next-why")!.textContent).not.toMatch(/safe first thing/);
    cleanup();
    const beyond = inc("2026-10-21T10:00:00Z", { step: "Take this to a person", detail: "Stop code 0x133." });
    beyond.assessment!.beyond_us = true;
    h.incidents = [beyond];
    const second = render(<BlackBox />);
    fireEvent.click(screen.getByRole("button", { name: /scan/i }));
    await waitFor(() => expect(second.container.querySelector(".bb-next")).not.toBeNull());
    // The stop code the user is told to share is in the answer, before any tap.
    expect(second.container.querySelector(".bb-next-detail:not(.bb-next-beyond)")!.textContent).toBe("Stop code 0x133.");
    fireEvent.click(second.container.querySelector('[data-testid="bb-next-depth-why"] > summary')!);
    expect(second.container.querySelector(".bb-next-why")!.textContent).toMatch(/beyond what Compy can safely narrow down/);
    expect(second.container.querySelector(".bb-next-why")!.textContent).not.toMatch(/safe first thing/);
  });
});
