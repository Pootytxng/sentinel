import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Lab + the embedded Benchmark/Latency tabs poll on mount; mock invoke so they don't throw.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(null)) }));

import { LabV2 } from "./LabV2";
import Lab from "./Lab";
import { labVerdict, labMeasuredLine } from "./lab-v2-data";
import { invalidateProbe } from "../data/probe-cache";
import type { BenchmarkState, Efficacy } from "../types";

// V2-7 guards (bug→guard tier 1): the V2 Lab room composes RoomShell (one verdict, NO door —
// Lab is the journey's last chapter — and deliberately NO primary action: the instruments ARE
// the work), its verdict is a PURE derivation from the same benchmark state the Benchmark card
// grades (honest nothing-graded state; the grade names its measured evidence in the same breath
// — the punch (h) law; branch-proper copy, never "(s)"), the measured line's instrument count is
// computed from the same gates the body uses (never hardcoded), the one-mention law holds (Lab's
// standalone head yields to the room verdict), and the CLASSIC Lab render stays pinned unchanged.

beforeAll(() => {
  // jsdom lacks the observers the vendored DecryptedText uses; inert stubs, animation never starts.
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

afterEach(() => {
  cleanup();
  localStorage.clear();
  invalidateProbe(); // the probe cache is module-level — isolate the bench seed between tests
});

const useReduced = () => localStorage.setItem("compy_motion", "reduced");

const state = (over: Partial<BenchmarkState> = {}): BenchmarkState => ({
  running: false,
  latest: null,
  latest_at: null,
  baseline: null,
  baseline_at: null,
  efficacy: null,
  error: null,
  ...over,
});

const efficacy = (over: Partial<Efficacy> = {}): Efficacy => ({
  per_component: [],
  overall: "improved",
  noise_floor_pct: 2,
  ...over,
});

describe("labVerdict — pure, measured, evidence named in the same breath", () => {
  it("nothing benchmarked (or still loading) → the honest nothing-graded line", () => {
    for (const bench of [null, state()]) {
      const v = labVerdict(bench);
      expect(v.headline).toBe("Nothing graded in the Lab yet.");
      expect(v.sub).toBe(
        "Start with Benchmark — set a baseline, change one thing, re-run. Compy tells you if it actually moved.",
      );
    }
  });

  it("baseline set, nothing graded yet → the next-run coaching, with the real date", () => {
    const v = labVerdict(
      state({ baseline: { components: [], confidence: "clean", notes: [] }, baseline_at: "2026-07-01T10:00:00Z" }),
    );
    expect(v.headline).toBe("Baseline recorded — your next benchmark run gets graded against it.");
    expect(v.sub).toContain(new Date("2026-07-01T10:00:00Z").toLocaleDateString());
    // No date recorded → no invented one.
    const noDate = labVerdict(state({ baseline: { components: [], confidence: "clean", notes: [] } }));
    expect(noDate.sub).toBe("The grade lands here the moment you re-run.");
  });

  it("improved → the grade NAMES its component evidence with deltas (punch-h law)", () => {
    const v = labVerdict(
      state({
        efficacy: efficacy({
          per_component: [
            { component: "cpu", before: 100, after: 104.2, delta_pct: 4.2, verdict: "improved" },
            { component: "ram", before: 100, after: 100.5, delta_pct: 0.5, verdict: "no-measurable-change" },
          ],
          overall: "improved",
        }),
      }),
    );
    expect(v.headline).toBe("Your last benchmarked change improved this PC.");
    expect(v.sub).toBe("Measured: CPU +4.2% — graded against a 2% noise floor.");
  });

  it("regressed → names the components that got worse, and coaches the undo", () => {
    const v = labVerdict(
      state({
        efficacy: efficacy({
          per_component: [
            { component: "disk", before: 100, after: 93.7, delta_pct: -6.3, verdict: "regressed" },
          ],
          overall: "regressed",
          noise_floor_pct: 2.5,
        }),
      }),
    );
    expect(v.headline).toBe("Your last benchmarked change made things worse.");
    expect(v.sub).toBe(
      "Measured: Disk -6.3% — graded against a 2.5% noise floor. Undo it, or re-run to confirm.",
    );
  });

  it("no measurable change → the noise-floor honesty line, no component list", () => {
    const v = labVerdict(state({ efficacy: efficacy({ overall: "no-measurable-change" }) }));
    expect(v.headline).toBe("Your last benchmarked change made no measurable difference.");
    expect(v.sub).toBe(
      "Every component stayed inside the 2% noise floor — we call that noise, not a win.",
    );
  });

  it("never '(s)' across every branch, and the measured line is branch-proper", () => {
    const branches: (BenchmarkState | null)[] = [
      null,
      state(),
      state({ baseline: { components: [], confidence: "clean", notes: [] } }),
      state({ efficacy: efficacy({ overall: "improved" }) }),
      state({ efficacy: efficacy({ overall: "regressed" }) }),
      state({ efficacy: efficacy({ overall: "no-measurable-change" }) }),
    ];
    for (const bench of branches) {
      const v = labVerdict(bench);
      expect(`${v.headline} ${v.sub ?? ""}`).not.toContain("(s)");
    }
    expect(labMeasuredLine(3)).toBe(
      "3 instruments · they only measure — nothing in the Lab changes your PC",
    );
    expect(labMeasuredLine(1)).toContain("1 instrument ·");
    expect(labMeasuredLine(1)).not.toContain("(s)");
  });
});

describe("LabV2 — RoomShell composition", () => {
  it("renders ONE verdict (the pure helper's output) and NO door — the last chapter", () => {
    useReduced();
    const { container } = render(<LabV2 vendor="amd" />);
    const h1s = container.querySelectorAll(".v2-verdict h1");
    expect(h1s.length).toBe(1);
    expect(h1s[0].textContent).toBe("Nothing graded in the Lab yet.");
    expect(container.querySelectorAll(".v2-door").length).toBe(0);
  });

  it("no primary action — the instruments ARE the room's work", () => {
    useReduced();
    const { container } = render(<LabV2 vendor="amd" />);
    expect(container.querySelector(".v2-verdict-action")).toBeNull();
  });

  it("measured line: the instrument count is computed from the body's own gates", () => {
    useReduced();
    // AMD + diagnostics slot: Benchmark + Black Box + Latency + Tuning + Diagnostics = 5.
    render(<LabV2 vendor="amd" diagnostics={<div>diag</div>} />);
    expect(screen.getByText(labMeasuredLine(5))).toBeTruthy();
    cleanup();
    // Non-AMD, no diagnostics: the always-on three.
    render(<LabV2 vendor="nvidia" />);
    expect(screen.getByText(labMeasuredLine(3))).toBeTruthy();
  });

  it("one-mention law: Lab's standalone head yields to the room verdict", () => {
    useReduced();
    const { container } = render(<LabV2 vendor="amd" />);
    expect(container.querySelector(".lab-head")).toBeNull();
    expect(container.querySelector(".lab-title")).toBeNull();
    expect(container.querySelector(".lab-head-bench")).toBeNull();
    // …but the working face is intact: the instrument cards render.
    expect(screen.getByRole("button", { name: /Benchmark/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Latency/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Black Box/ })).toBeTruthy();
  });
});

describe("classic Lab — pinned unchanged (flag-off byte-identity at the render level)", () => {
  it("keeps its standalone head (title + read-only promise) and renders no RoomShell chrome", () => {
    const { container } = render(<Lab vendor="amd" />);
    expect(screen.getByRole("heading", { name: "Advanced" })).toBeTruthy();
    expect(screen.getByText(/nothing in Advanced\s+changes your PC/)).toBeTruthy();
    expect(container.querySelector(".v2-verdict")).toBeNull();
    expect(container.querySelector(".v2-door")).toBeNull();
  });
});
