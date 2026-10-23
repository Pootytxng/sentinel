import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IntelSessionRef, SessionSummary, WhatChangedOutcome } from "../types";
import i18n from "../i18n";

// #608 remainder (#671): the Trial bench, Care's what-changed panel, the Tuning gauge and the Home
// live strip may state only what was measured. The Monitor room learned this in
// measurement-display-guard.test.tsx; these four faces still printed a raw unknown. A legacy
// running experiment read "avg 0 fps · 1% low 0 fps", a what-changed session line read
// "1% low 0.0 · avg NaN" (or threw on a missing value), the Tuning gauge graded an unmeasured
// session "rough" or "smooth", and the Home strip passed the raw number through to a Reading that
// wore the MEASURED tag. The sampler's unknown is 0, and an older or malformed record can carry a
// negative, a non-finite value or nothing at all. Every one of those must render as the surface's
// localized "not measured" and never as a number or a grade, in every locale. Measured readings
// must stay exactly as they were.

const harness = vi.hoisted(() => ({
  experiments: [] as unknown[],
  recs: [] as unknown[],
  sessions: [] as unknown[],
  sim: null as unknown,
  outcome: null as unknown,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    switch (cmd) {
      case "get_experiment_gate":
        return Promise.resolve(true);
      case "get_experiments":
        return Promise.resolve(harness.experiments);
      case "get_recommendations":
        return Promise.resolve(harness.recs);
      case "get_session_summaries":
        return Promise.resolve(harness.sessions);
      case "simulate_optimization":
        return harness.sim ? Promise.resolve(harness.sim) : Promise.reject("no sim");
      case "what_changed_for_session":
        return Promise.resolve(harness.outcome);
      default:
        return Promise.resolve(null);
    }
  },
}));

// HomeConsole: reduced motion snaps the gauges, and the three.js rig stays out of a DOM test.
vi.mock("../design/use-motion", () => ({ useReducedMotion: () => true }));
vi.mock("./rig/RigHologram", () => ({ RigHologram: () => <div data-testid="rig-hologram" /> }));

import ExperimentBench from "./ExperimentBench";
import { SessionInvestigator, WhatChangedPanel } from "./WhatChangedPanel";
import { TuningInstrument } from "./TuningInstrument";
import { liveStrip } from "./command-center-data";
import { HomeConsole } from "./HomeConsole";
import { HomeHud } from "./HomeHud";
import { HomeV2 } from "./HomeV2";
import { interviewFinding, interviewQuestions, type InterviewFacts } from "./home-interview-data";
import { prettyGameName } from "./game-name";
import { ShellV2 } from "../design/ShellV2";
import { railFor } from "../design/homeRail";
import { TUNING_GUIDE_BY_ID } from "../data/tuning-guides";
import type { HardwareInfo } from "../App";

/** Every shape of "not measured" a session record has been seen to carry, or could. */
const UNKNOWN: unknown[] = [0, -0, -5, Number.NaN, Number.POSITIVE_INFINITY, null, undefined];
const LOCALES = ["en", "zh-CN"] as const;
const cases = UNKNOWN.map((v) => [String(v), v] as const);

function sess(over: Record<string, unknown> = {}): SessionSummary {
  return {
    started_at: "2026-07-17T02:00:00Z",
    duration_secs: 1800,
    process_name: "Valorant",
    samples: 5400,
    avg_fps: 244,
    avg_frametime_ms: 4.1,
    low1_fps_est: 182,
    peak_gpu_temp_c: 61,
    peak_gpu_usage_pct: 88,
    peak_ram_used_bytes: null,
    ram_total_bytes: null,
    compy_changes_active: 0,
    ...over,
  } as SessionSummary;
}

// ── Trial bench fixtures (mirror ExperimentBench.test.tsx) ──
const RUNNING = {
  id: "exp:2-0",
  rec_id: "hags",
  rec_title: "Hardware-accelerated GPU scheduling",
  game: "Valorant",
  hypothesis: "HAGS may lower frame-time variance",
  created_at: "2026-07-17T00:00:00Z",
  status: "running",
  baseline_avg_fps: 240,
  baseline_low1_fps: 180,
  active_changes_at_start: 0,
  attribution_warning: null,
  noise_floor_pct: 3.0,
  treatment: null,
  verdict: null,
  kept: false,
  stop_reason: null,
  concluded_at: null,
  baseline_session_id: "2026-07-16T22:00:00Z",
  applied_at: "2026-07-17T00:00:00Z",
};
/** A pre-lane-2b record: no baseline session id, no apply time, and nothing guarantees its numbers. */
const LEGACY = { ...RUNNING, baseline_session_id: null, applied_at: null };
const REC = { id: "test-rec", title: "Test tweak", eligible: true, currently_applied: false };
const SIM = {
  rec_id: "test-rec",
  rec_title: "Test tweak",
  verdict: "worth-testing",
  confidence: "medium",
  why: "This setting plausibly affects frame pacing on this class of GPU.",
  hardware_factor: "Your RX 9070 XT supports the underlying feature.",
  metric_to_watch: "1% low FPS",
  disproof: "1% low FPS stays within the 3% noise floor across a full session.",
  is_promise: false,
};

// ── What-changed fixtures (mirror what-changed-rollback-guard.test.tsx) ──
const sref = (started_at: string, over: Record<string, unknown> = {}): IntelSessionRef =>
  ({
    started_at,
    game: "Valorant",
    duration_secs: 3600,
    samples: 3400,
    avg_fps: 244.0,
    low1_fps: 101.4,
    gaming_mode_active: true,
    hw_hash: "hw1",
    ...over,
  }) as IntelSessionRef;
const report = (baseline: IntelSessionRef, current: IntelSessionRef): WhatChangedOutcome => ({
  kind: "report",
  baseline,
  current,
  game: "Valorant",
  verdict: "regressed",
  headline: "1% lows dropped vs your previous Valorant session.",
  observations: [],
  noise_floor_pct: 3.0,
  events_between: [],
  leading_hypotheses: [],
  ruled_out: [],
  unknowns: [],
  next_action: "Play one more session and compare.",
  next_action_rec_id: null,
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
});

// ── Home fixtures (mirror home-console.test.tsx) ──
const hw = {
  cpu_brand: "AMD Ryzen 7 9850X3D",
  cpu_arch: { family_label: "Ryzen 7 9850X3D", architecture: "Zen 5", generation: "9000" },
  cpu_cores_logical: 16,
  cpu_cores_physical: 8,
  cpu_frequency_mhz: 5100,
  ram_total_bytes: 32 * 1024 ** 3,
  ram_used_bytes: 16 * 1024 ** 3,
  gpus: [{ name: "AMD Radeon RX 9070 XT", vram_bytes: 16 * 1024 ** 3 }],
  disks: [],
  memory_modules: [],
  physical_disks: [],
  display: { current_refresh_rate_hz: 165 },
  os_name: "Windows",
  os_version: "11",
} as unknown as HardwareInfo;
const mountHome = (sessions: SessionSummary[]) =>
  render(
    <ShellV2 items={railFor(true)} activeId="home" onNavigate={() => {}} ledgerCount={0}>
      <HomeConsole
        hw={hw}
        readiness={null}
        priorities={null}
        sessions={sessions}
        changes={[]}
        onRunCheck={() => {}}
        onSeeInFix={() => {}}
      />
    </ShellV2>,
  );

// HomeRoom's two flag-off faces of the same strip take the console's props.
const mountFace = (Face: typeof HomeHud | typeof HomeV2, sessions: SessionSummary[]) =>
  render(
    <ShellV2 items={railFor(true)} activeId="home" onNavigate={() => {}} ledgerCount={0}>
      <Face
        hw={hw}
        readiness={null}
        priorities={null}
        sessions={sessions}
        changes={[]}
        onRunCheck={() => {}}
        onSeeInFix={() => {}}
      />
    </ShellV2>,
  );

// Canvas-backed children only need a context that accepts calls.
const noopCtx = new Proxy(
  {},
  {
    get: (_t, p) =>
      typeof p === "string" && /^(fillStyle|strokeStyle|lineWidth|globalAlpha|font|lineJoin|lineCap|textAlign|textBaseline)$/.test(p)
        ? ""
        : () => ({ addColorStop: () => {}, width: 0 }),
    set: () => true,
  },
);
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
beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    noopCtx as unknown as CanvasRenderingContext2D,
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  harness.experiments = [];
  harness.recs = [];
  harness.sessions = [];
  harness.sim = null;
  harness.outcome = null;
});
afterAll(async () => {
  await i18n.changeLanguage("en");
});

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts) as string;
const text = (el: Element | null) => (el?.textContent ?? "").trim();
const bolds = (el: Element | null) => Array.from(el?.querySelectorAll("b") ?? []).map((b) => text(b));
/** The digits a line states once the "1%" in "1% low" is set aside. */
const digits = (s: string) => s.replace(/1\s?%/g, "").match(/\d+/g) ?? [];

// Same flow as ExperimentBench.test.tsx: wait for the option to exist, fire, then prove the pick took.
const pickChange = async (value: string) => {
  const trigger = await screen.findByRole("combobox");
  await waitFor(() => expect(trigger).toBeEnabled());
  fireEvent.click(trigger);
  const option = await waitFor(() => {
    const el = document.querySelector(`[role="listbox"] [data-value="${value}"]`);
    expect(el, `no option [data-value="${value}"] yet`).not.toBeNull();
    return el as HTMLElement;
  });
  const label = option.textContent ?? "";
  fireEvent.click(option);
  await waitFor(() => expect(trigger).toHaveTextContent(label));
};

describe.each(LOCALES)("unknown FPS on the bench, Care, Tuning and Home never reads as a number (%s)", (lng) => {
  beforeAll(async () => {
    await i18n.changeLanguage(lng);
  });

  // ── Trial bench: the running experiment's baseline line (ExperimentBench running panel) ──
  describe("Trial bench running baseline", () => {
    const line = async () => {
      render(<ExperimentBench />);
      const panel = await screen.findByTestId("experiment-running");
      return panel.querySelector(".exp-running-baseline")!;
    };

    it("measured: the baseline line is byte-identical to before", async () => {
      harness.experiments = [LEGACY];
      const el = await line();
      const game = prettyGameName("Valorant");
      expect(text(el)).toBe(
        `${t("lab.experimentBench.runningBaselinePre", { game })} 240 ${t("lab.experimentBench.baselineMid")} 180 ${t("lab.experimentBench.fpsUnit")}`,
      );
    });

    const nm = () => t("lab.experimentBench.notMeasured");
    const shapes = [
      ["avg", { baseline_avg_fps: "U" }, (n: string) => [n, "180"], ["180"]],
      ["1% low", { baseline_low1_fps: "U" }, (n: string) => ["240", n], ["240"]],
      ["both", { baseline_avg_fps: "U", baseline_low1_fps: "U" }, (n: string) => [n, n], []],
    ] as const;
    describe.each(shapes)("legacy record, unknown %s", (_name, over, slots, kept) => {
      it.each(cases)("%s renders as not measured, never a number or a unit", async (_label, v) => {
        const fields = Object.fromEntries(Object.keys(over).map((k) => [k, v]));
        harness.experiments = [{ ...LEGACY, ...fields }];
        const el = await line();
        expect(bolds(el)).toEqual(slots(nm()));
        expect(digits(text(el))).toEqual(kept);
        expect(text(el)).not.toMatch(/NaN|Infinity/);
        expect(text(el)).not.toContain(`${nm()} ${t("lab.experimentBench.fpsUnit")}`);
      });
    });
  });

  // REGRESSION PIN (green on main): the start-baseline line only ever quotes a usable reading.
  describe("Trial bench start baseline (regression pin)", () => {
    it("measured: quotes the real before-reading", async () => {
      harness.recs = [REC];
      harness.sim = SIM;
      harness.sessions = [sess()];
      const { container } = render(<ExperimentBench />);
      await screen.findByTestId("experiment-bench");
      await pickChange("test-rec");
      const el = await waitFor(() => {
        const b = container.querySelector(".exp-baseline");
        expect(b).not.toBeNull();
        return b!;
      });
      expect(bolds(el)).toEqual(["244", "182"]);
    });

    it.each(cases.flatMap(([l, v]) => [[`avg ${l}`, { avg_fps: v }], [`1% low ${l}`, { low1_fps_est: v }]] as const))(
      "unknown %s is never offered as the baseline",
      async (_label, over) => {
        harness.recs = [REC];
        harness.sim = SIM;
        harness.sessions = [sess(over)];
        const { container } = render(<ExperimentBench />);
        await screen.findByTestId("experiment-bench");
        await pickChange("test-rec");
        await waitFor(() => expect(container.textContent).toContain(t("lab.experimentBench.noBaselineYet")));
        expect(container.querySelector(".exp-baseline")).toBeNull();
      },
    );
  });

  // REGRESSION PIN (green on main): the latest-session fineprint only ever quotes a usable reading.
  describe("Trial bench treatment fineprint (regression pin)", () => {
    const fineprint = async () => {
      render(<ExperimentBench />);
      const panel = await screen.findByTestId("experiment-running");
      return panel.querySelector(".exp-fineprint")!;
    };

    it("measured: quotes the real after-reading", async () => {
      harness.experiments = [RUNNING];
      harness.sessions = [sess()];
      expect(bolds(await fineprint())).toEqual(["244", "182"]);
    });

    it.each(cases.flatMap(([l, v]) => [[`avg ${l}`, { avg_fps: v }], [`1% low ${l}`, { low1_fps_est: v }]] as const))(
      "unknown %s is never quoted as the latest session",
      async (_label, over) => {
        harness.experiments = [RUNNING];
        harness.sessions = [sess(over)];
        const el = await fineprint();
        expect(text(el)).toBe(t("lab.experimentBench.runningNoTreatment", { game: prettyGameName("Valorant") }));
      },
    );
  });

  // ── Care: the what-changed panel's session lines ("show the working") ──
  describe("Care what-changed session lines", () => {
    const nm = () => t("optimize.whatChangedPanel.sessionLine.notMeasured");
    const tail = (low1: string, avg: string) =>
      t("optimize.whatChangedPanel.sessionLine.main", { when: "", low1, avg });
    const open = async (outcome: WhatChangedOutcome) => {
      harness.outcome = outcome;
      const { container } = render(<WhatChangedPanel startedAt="2026-07-10T20:00:00Z" />);
      const toggle = await waitFor(() => {
        const b = container.querySelector<HTMLButtonElement>(".wcp-detail-toggle");
        expect(b).not.toBeNull();
        return b!;
      });
      fireEvent.click(toggle);
      const lines = Array.from(container.querySelectorAll(".wcp-session"));
      expect(lines).toHaveLength(2);
      return lines.map(text);
    };

    it("measured: both lines are byte-identical to before", async () => {
      const [before, after] = await open(
        report(sref("2026-07-08T20:00:00Z"), sref("2026-07-10T20:00:00Z", { low1_fps: 92.1, avg_fps: 230.5 })),
      );
      expect(before.endsWith(tail("101.4", "244.0"))).toBe(true);
      expect(after.endsWith(tail("92.1", "230.5"))).toBe(true);
    });

    it.each(cases)("unknown %s renders as not measured on either line", async (_label, v) => {
      const [before, after] = await open(
        report(sref("2026-07-08T20:00:00Z", { low1_fps: v }), sref("2026-07-10T20:00:00Z", { avg_fps: v })),
      );
      expect(before.endsWith(tail(nm(), "244.0")), before).toBe(true);
      expect(after.endsWith(tail("101.4", nm())), after).toBe(true);
      for (const l of [before, after]) expect(l).not.toMatch(/NaN|Infinity|-5\.0| 0\.0/);
    });
  });

  // ── Care: the session investigator's baseline/current pickers (expert view) ──
  describe("Care session investigator pickers", () => {
    const nm = () => t("optimize.whatChangedPanel.sessionLine.notMeasured");
    const tail = (low1: string, avg: string) =>
      t("optimize.whatChangedPanel.sessionLine.main", { when: "", low1, avg });
    const older = (over: Record<string, unknown> = {}) =>
      sess({ started_at: "2026-07-08T20:00:00Z", avg_fps: 240.2, low1_fps_est: 190.1, ...over });
    const newer = (over: Record<string, unknown> = {}) =>
      sess({ started_at: "2026-07-10T20:00:00Z", avg_fps: 230.5, low1_fps_est: 150.4, ...over });
    const pickers = async (sessions: SessionSummary[]) => {
      localStorage.setItem("compy_expert_view", "1");
      render(<SessionInvestigator sessions={sessions} />);
      const triggers = await screen.findAllByRole("combobox");
      expect(triggers).toHaveLength(2);
      return triggers;
    };
    const optionText = async (trigger: HTMLElement, value: string) => {
      fireEvent.click(trigger);
      const option = await waitFor(() => {
        const el = document.querySelector(`[role="listbox"] [data-value="${value}"]`);
        expect(el).not.toBeNull();
        return el!;
      });
      return text(option);
    };

    it("measured: the picker labels are byte-identical to before", async () => {
      const [base, cur] = await pickers([older(), newer()]);
      expect(text(base).endsWith(tail("190.1", "240.2"))).toBe(true);
      expect(text(cur).endsWith(tail("150.4", "230.5"))).toBe(true);
      expect((await optionText(base, "2026-07-10T20:00:00Z")).endsWith(tail("150.4", "230.5"))).toBe(true);
    });

    it.each(cases)("unknown %s renders as not measured in the trigger and the option", async (_label, v) => {
      const [base, cur] = await pickers([older({ avg_fps: v }), newer({ low1_fps_est: v })]);
      expect(text(base).endsWith(tail("190.1", nm())), text(base)).toBe(true);
      expect(text(cur).endsWith(tail(nm(), "230.5")), text(cur)).toBe(true);
      const opt = await optionText(base, "2026-07-10T20:00:00Z");
      expect(opt.endsWith(tail(nm(), "230.5")), opt).toBe(true);
    });
  });

  // ── Tuning gauge: the recent-sessions smoothness word ──
  describe("Tuning gauge smoothness", () => {
    const guide = TUNING_GUIDE_BY_ID.get("amd-gpu-undervolt")!;
    const word = (s: SessionSummary) => {
      const { container } = render(
        <TuningInstrument
          guide={guide}
          vendor="amd"
          measurement={null}
          recentSessions={[s]}
          evidence={{ qualifies: true, reason: "your GPU peaked at 92°C across your last 3 monitored sessions" }}
        />,
      );
      return text(container.querySelector(".tg-recent-smooth"));
    };
    const grades = () =>
      ["smooth", "someDips", "rough"].map((g) => t(`blackbook.tuningInstrument.smoothness.${g}`));

    it("measured: the grade is unchanged", () => {
      expect(word(sess({ avg_fps: 140, low1_fps_est: 138 }))).toBe(t("blackbook.tuningInstrument.smoothness.smooth"));
      cleanup();
      expect(word(sess({ avg_fps: 100, low1_fps_est: 60 }))).toBe(t("blackbook.tuningInstrument.smoothness.someDips"));
      cleanup();
      expect(word(sess({ avg_fps: 100, low1_fps_est: 40 }))).toBe(t("blackbook.tuningInstrument.smoothness.rough"));
    });

    it.each(cases.flatMap(([l, v]) => [[`avg ${l}`, { avg_fps: v }], [`1% low ${l}`, { low1_fps_est: v }]] as const))(
      "unknown %s is not measured, never a grade",
      (_label, over) => {
        const w = word(sess({ avg_fps: 140, low1_fps_est: 120, ...over }));
        expect(w).toBe(t("blackbook.tuningInstrument.smoothness.notMeasured"));
        expect(grades()).not.toContain(w);
      },
    );
  });

  // ── Home: the live strip and the two FPS readings it feeds ──
  describe("Home live strip", () => {
    it("measured: the strip passes the real numbers through", () => {
      const s = liveStrip([sess({ avg_fps: 142.3, low1_fps_est: 98.4 })], i18n.t);
      expect(s).toMatchObject({ kind: "data", avgFps: 142.3, low1Est: 98.4 });
    });

    it.each(cases)("unknown %s comes out of the strip as null, never the raw value", (_label, v) => {
      expect(liveStrip([sess({ avg_fps: v })], i18n.t)).toMatchObject({ kind: "data", avgFps: null, low1Est: 182 });
      expect(liveStrip([sess({ low1_fps_est: v })], i18n.t)).toMatchObject({ kind: "data", avgFps: 244, low1Est: null });
    });

    const reading = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-read="${id}"]`)!;

    it("measured: the Avg FPS and 1% low readings show the real numbers", () => {
      const c = mountHome([sess({ avg_fps: 142.3, low1_fps_est: 98.4 })]).container;
      expect(text(reading(c, "avgFps").querySelector(".rd-n"))).toBe("142");
      expect(text(reading(c, "low1").querySelector(".rd-n"))).toBe("98");
      expect(reading(c, "avgFps").querySelector(".rd-none")).toBeNull();
    });

    it.each(cases)("unknown %s reads as no reading, untagged and ungraded", (_label, v) => {
      const empty = mountHome([]).container;
      const emptyClass = { avgFps: reading(empty, "avgFps").className, low1: reading(empty, "low1").className };
      cleanup();
      for (const [id, over] of [
        ["avgFps", { avg_fps: v }],
        ["low1", { low1_fps_est: v }],
      ] as const) {
        const c = mountHome([sess(over)]).container;
        const el = reading(c, id);
        expect(text(el.querySelector(".rd-n")), id).toBe("—");
        expect(text(el.querySelector(".rd-none")), id).toBe(t("common.arcGauge.noReading"));
        expect(el.querySelector(".rd-tag"), id).toBeNull();
        expect(el.className, id).toBe(emptyClass[id]);
        cleanup();
      }
    });
  });

  // ── Home: the flag-off faces of the same strip (HomeRoom falls back to them) ──
  describe.each([
    {
      name: "HomeHud",
      Face: HomeHud,
      ns: "home.homeHud.ledger",
      avg: ".hud-hero-num .hud-reading",
      unit: ".hud-hero-num .hud-unit",
      low: ".hud-hero-num .hud-note",
    },
    {
      name: "HomeV2",
      Face: HomeV2,
      ns: "home.homeV2.stats",
      avg: ".hv2-stat-n",
      unit: ".hv2-stat-n .hv2-stat-unit",
      low: ".hv2-stat .hv2-stat-d",
    },
  ])("Home strip fallback face $name", ({ Face, ns, avg, unit, low }) => {
    const lowNum = (el: Element | null) => el?.querySelector("[class*='mono']") ?? null;
    const ungraded = (el: Element | null) => {
      expect(el?.className ?? "").not.toMatch(/grade-/);
      expect((el as HTMLElement | null)?.style.color ?? "").toBe("");
    };

    it("measured: the average, unit and 1% low line are unchanged", () => {
      const c = mountFace(Face, [sess({ avg_fps: 142.3, low1_fps_est: 98.4 })]).container;
      expect(text(c.querySelector(unit))).toBe(t(`${ns}.fpsAvg`));
      expect(text(c.querySelector(avg)).replace(text(c.querySelector(unit)), "")).toBe("142");
      expect(text(c.querySelector(low))).toBe(`${t(`${ns}.onePercentLowLabel`)} 98 ${t(`${ns}.estimateSuffix`)}`);
    });

    it.each(cases)("unknown average %s: the absent mark, said in words, and no grade", (_label, v) => {
      const c = mountFace(Face, [sess({ avg_fps: v })]).container;
      expect(text(c.querySelector(unit))).toBe(`${t(`${ns}.fpsAvg`)} · ${t(`${ns}.notMeasured`)}`);
      expect(text(c.querySelector(avg)).replace(text(c.querySelector(unit)), "")).toBe("—");
      ungraded(c.querySelector(avg));
      expect(c.querySelector(".hud-ring-wrap")).toBeNull();
      // The low is still a measured fact; without an average it cannot be graded.
      expect(text(c.querySelector(low))).toBe(`${t(`${ns}.onePercentLowLabel`)} 182 ${t(`${ns}.estimateSuffix`)}`);
      ungraded(lowNum(c.querySelector(low)));
      expect(text(c.querySelector(avg))).not.toMatch(/NaN|Infinity|\d/);
    });

    it.each(cases)("unknown 1% low (%s): said in words, no estimate suffix, no grade", (_label, v) => {
      const c = mountFace(Face, [sess({ low1_fps_est: v })]).container;
      expect(text(c.querySelector(low))).toBe(`${t(`${ns}.onePercentLowLabel`)} ${t(`${ns}.notMeasured`)}`);
      ungraded(lowNum(c.querySelector(low)));
      expect(text(c.querySelector(avg)).replace(text(c.querySelector(unit)), "")).toBe("244");
    });

    // The trend under the strip is a measurement too: an unmeasured session is no point on it.
    it.each(cases)("sparkline: an unknown average (%s) is not plotted", (_label, v) => {
      const c = mountFace(Face, [
        sess({ started_at: "2026-07-17T01:00:00Z", avg_fps: 140 }),
        sess({ started_at: "2026-07-17T02:00:00Z", avg_fps: v }),
        sess({ started_at: "2026-07-17T03:00:00Z", avg_fps: 150 }),
      ]).container;
      const pts = c.querySelector(".ds-spark polyline")?.getAttribute("points") ?? "";
      expect(pts.trim().split(/\s+/)).toHaveLength(2);
      expect(pts).not.toMatch(/NaN|Infinity/);
    });
  });

  // ── Home interview: the session it quotes as evidence ──
  // The interview reads the strip's session. An unmeasured FPS is no FPS evidence: no quoted
  // number, and no `measured` chip earned on it. The session's peak GPU temperature is a separate
  // measured fact, so it stays quotable when the FPS was not measured.
  describe("Home interview evidence", () => {
    const facts = (lastSession: InterviewFacts["lastSession"]): InterviewFacts => ({
      recsLoaded: false,
      safeStackReady: 0,
      fastPathWired: false,
      activeChanges: null,
      sessionCount: lastSession ? 1 : 0,
      lastSession,
      readiness: null,
      gpuTempC: null,
      rooms: ["play", "learn", "lab"],
    });
    const fpsLine = (game: string, avg: number, low: number) =>
      t("home.interview.f.ev.lastSession", { game, avg, low });
    const peakLine = (temp: number) => t("home.interview.f.ev.peakTemp", { temp });
    // Every finding that quotes the session's FPS, and so may only earn `measured` on it.
    const FPS_FINDINGS = ["wantScores", "slowSometimes", "stutter", "slowUnsure", "crashInGame"] as const;

    it("measured: the finding quotes the session's FPS and earns its chip on it", () => {
      const f = interviewFinding("wantScores", facts({ game: "Valorant", avgFps: 142.3, low1: 98.4, peakTempC: 61 }), i18n.t);
      expect(f.evidence).toContain(fpsLine("Valorant", 142, 98));
      expect(f.level).toBe("measured");
    });

    describe.each(cases)("unknown %s", (_label, v) => {
      it.each(FPS_FINDINGS)("%s quotes no FPS and earns no measured chip on it", (id) => {
        for (const s of [
          { game: "Valorant", avgFps: v, low1: 98.4, peakTempC: 61 },
          { game: "Valorant", avgFps: 142.3, low1: v, peakTempC: 61 },
        ]) {
          const f = interviewFinding(id, facts(s as InterviewFacts["lastSession"]), i18n.t);
          for (const line of f.evidence) expect(line).not.toMatch(/FPS|NaN|Infinity/);
          expect(f.evidence.some((line) => line.includes("Valorant")), f.evidence.join(" | ")).toBe(false);
          expect(f.level).not.toBe("measured");
        }
      });

      it("heat still quotes the session's measured peak temperature", () => {
        const f = interviewFinding("heat", facts({ game: "Valorant", avgFps: v, low1: v, peakTempC: 61 } as InterviewFacts["lastSession"]), i18n.t);
        expect(f.evidence).toEqual([peakLine(61)]);
        expect(f.level).toBe("likely");
      });

      it("Home hands the interview the session, so heat quotes its peak temperature", async () => {
        mountHome([sess({ avg_fps: v, low1_fps_est: v, peak_gpu_temp_c: 61 })]);
        fireEvent.click(document.querySelector(".hc-front-door") as HTMLElement);
        const heat = interviewQuestions(i18n.t).start.choices.find((c) => c.next.kind === "finding" && c.next.id === "heat")!;
        fireEvent.click(Array.from(document.querySelectorAll(".hi-answer")).find((b) => b.textContent === heat.label) as HTMLElement);
        await waitFor(() => expect(document.querySelector(".hi-level")?.getAttribute("data-level")).toBe("likely"));
        expect(Array.from(document.querySelectorAll(".hi-evidence-list li")).map((li) => text(li))).toEqual([peakLine(61)]);
      });
    });
  });
});
